import type {
  KalshiQueries,
  KalshiSnapshot,
  KalshiSubscription,
} from "@conditional-stocks/db/kalshi";
import {
  canonicalStringify,
  type Hex,
  KalshiYesBook,
  kalshiPayout,
  MarketDataError,
  normalizeKalshiMarket,
  type ProbabilityPolicy,
  type ProbabilityTick,
  requiredString,
} from "@conditional-stocks/market-data";
import { logger } from "../logger.ts";
import type { KalshiEnvironment } from "./environment.ts";
import type { KalshiSource } from "./source.ts";

type TickListener = (tick: ProbabilityTick) => void;
/** Stores an ingestor alert (shared with Polymarket's). */
export type AlertSink = (
  code: string,
  conditionId: Hex | null,
  details: unknown,
) => Promise<unknown>;

/** Failures that repeat while Kalshi stays unreachable are stored once per market per window. */
const REPEAT_WINDOW_MS = 600_000;

/** Kalshi markets the ingestor follows: metadata snapshots, which evidence refers to, and each
 * market's YES book, polled over REST (Kalshi's WebSocket needs an API key). Probabilities are
 * served from the books in memory, keyed by the market's derived condition id. A book is polled
 * while its market trades and metadata until the result is final, so the calls to Kalshi track
 * the live markets, not every market ever followed (daily ladders add several a day). */
export class KalshiIngestor {
  readonly #books = new Map<Hex, KalshiYesBook>();
  readonly #subscriptions = new Map<Hex, KalshiSubscription>();
  /** Newest stored metadata per condition. */
  readonly #latest = new Map<Hex, KalshiSnapshot>();
  readonly #listeners = new Map<Hex, Set<TickListener>>();
  readonly #alerted = new Map<string, number>();
  #timers: ReturnType<typeof setInterval>[] = [];
  #bookPass: Promise<void> | null = null;
  #metadataPass: Promise<void> | null = null;

  constructor(
    readonly environment: KalshiEnvironment,
    readonly store: KalshiQueries,
    readonly source: KalshiSource,
    readonly policy: ProbabilityPolicy,
    readonly alert: AlertSink,
  ) {}

  /** Whether `conditionId` is a followed Kalshi market. */
  tracks(conditionId: Hex): boolean {
    return this.#subscriptions.has(conditionId.toLowerCase() as Hex);
  }

  /** Fetches a market from Kalshi. `store: "always"` (explicit operator fetches, whose snapshot
   * ids evidence refers to) persists it; `"changes"` (polls) only when the normalized market
   * changed. */
  async fetchMetadata(
    tickerInput: unknown,
    store: "always" | "changes" = "always",
  ): Promise<KalshiSnapshot> {
    const ticker = requiredString(tickerInput, "ticker", 128);
    const raw = await this.source.getMarket(ticker);
    const normalized = normalizeKalshiMarket(raw);
    if (normalized.ticker !== ticker)
      throw new MarketDataError("MAPPING_MISMATCH", "Kalshi returned a different market");
    const previous =
      this.#latest.get(normalized.conditionId) ?? (await this.store.latestMetadataByTicker(ticker));
    const changed =
      !previous || canonicalStringify(previous.normalized) !== canonicalStringify(normalized);
    if (store === "changes" && previous && !changed) return previous;
    const snapshot = await this.store.appendMetadata(raw, normalized);
    this.#latest.set(normalized.conditionId, snapshot);
    if (previous && previous.normalized.status !== normalized.status)
      await this.alert("MANUAL_LIFECYCLE_REVIEW_REQUIRED", normalized.conditionId, {
        status: normalized.status,
        result: normalized.result,
      });
    return snapshot;
  }

  async track(snapshotIdInput: unknown): Promise<KalshiSubscription> {
    const snapshotId = requiredString(snapshotIdInput, "metadataSnapshotId", 256);
    const snapshot = await this.store.metadata(snapshotId);
    if (!snapshot) throw new MarketDataError("NOT_FOUND", "metadata snapshot not found", 404);
    const record = await this.store.addSubscription({
      conditionId: snapshot.normalized.conditionId,
      ticker: snapshot.normalized.ticker,
      metadataSnapshotId: snapshotId,
    });
    this.#follow(record);
    await this.refresh(record.conditionId);
    logger.info("kalshi.subscription.tracked", {
      conditionId: record.conditionId,
      ticker: record.ticker,
    });
    return record;
  }

  metadata(snapshotId: string): Promise<KalshiSnapshot | null> {
    return this.store.metadata(snapshotId);
  }

  async latestMetadata(conditionId: Hex): Promise<KalshiSnapshot | null> {
    const key = conditionId.toLowerCase() as Hex;
    const cached = this.#latest.get(key);
    if (cached) return cached;
    const snapshot = await this.store.latestMetadataByCondition(key);
    if (snapshot) this.#latest.set(key, snapshot);
    return snapshot;
  }

  probability(conditionId: Hex): ProbabilityTick {
    const tick = this.#books.get(conditionId.toLowerCase() as Hex)?.tick();
    if (!tick) throw new MarketDataError("NOT_FOUND", "probability is unavailable", 404);
    return tick;
  }

  subscribe(conditionId: Hex, listener: TickListener): () => void {
    const key = conditionId.toLowerCase() as Hex;
    const listeners = this.#listeners.get(key) ?? new Set<TickListener>();
    listeners.add(listener);
    this.#listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(key);
    };
  }

  /** Reads a followed market's book; a failed read disconnects it until the next one. */
  async refresh(conditionId: Hex): Promise<ProbabilityTick> {
    const key = conditionId.toLowerCase() as Hex;
    const record = this.#subscriptions.get(key);
    const book = this.#books.get(key);
    if (!record || !book) throw new MarketDataError("NOT_FOUND", "subscription not found", 404);
    try {
      const tick = book.applyOrderbook(await this.source.getOrderbook(record.ticker));
      this.#alerted.delete(`REST_RECONCILIATION_FAILED:${key}`);
      this.#publish(tick);
      return tick;
    } catch (error) {
      this.#publish(book.disconnect());
      await this.#alertOnce("REST_RECONCILIATION_FAILED", key, error);
      throw error;
    }
  }

  async start(): Promise<void> {
    const records = await this.store.subscriptions();
    for (const record of records) this.#follow(record);
    // The stored status decides which markets still need polling.
    await Promise.all(records.map((record) => this.latestMetadata(record.conditionId)));
    await this.refreshBooks();
    this.#timers = [
      setInterval(() => {
        this.#bookPass ??= this.refreshBooks().finally(() => {
          this.#bookPass = null;
        });
      }, this.environment.bookPollMs),
      setInterval(() => {
        this.#metadataPass ??= this.refreshMetadata().finally(() => {
          this.#metadataPass = null;
        });
      }, this.environment.metadataPollMs),
    ];
  }

  async stop(): Promise<void> {
    for (const timer of this.#timers) clearInterval(timer);
    this.#timers = [];
    await Promise.allSettled([this.#bookPass, this.#metadataPass]);
  }

  #follow(record: KalshiSubscription) {
    const key = record.conditionId.toLowerCase() as Hex;
    this.#subscriptions.set(key, record);
    if (!this.#books.has(key))
      this.#books.set(key, new KalshiYesBook(key, `${record.ticker}:yes`, this.policy));
  }

  /** Reads the book of every followed market that still trades; a closed market's last tick
   * stays served. */
  async refreshBooks() {
    await Promise.allSettled(
      [...this.#subscriptions.keys()]
        .filter((conditionId) => !this.#latest.get(conditionId)?.normalized.closed)
        .map((conditionId) => this.refresh(conditionId)),
    );
  }

  /** Re-reads the metadata of every followed market whose result is not final yet. */
  async refreshMetadata() {
    await Promise.all(
      [...this.#subscriptions.values()]
        .filter((record) => {
          const latest = this.#latest.get(record.conditionId.toLowerCase() as Hex);
          return !latest || !kalshiPayout(latest.normalized);
        })
        .map(async (record) => {
          try {
            await this.fetchMetadata(record.ticker, "changes");
            this.#alerted.delete(`METADATA_RECONCILIATION_FAILED:${record.conditionId}`);
          } catch (error) {
            await this.#alertOnce("METADATA_RECONCILIATION_FAILED", record.conditionId, error);
          }
        }),
    );
  }

  #publish(tick: ProbabilityTick) {
    for (const listener of this.#listeners.get(tick.conditionId) ?? []) {
      try {
        listener(tick);
      } catch (error) {
        logger.warn("kalshi.listener.failed", { error });
      }
    }
  }

  async #alertOnce(code: string, conditionId: Hex, error: unknown) {
    const key = `${code}:${conditionId}`;
    const last = this.#alerted.get(key);
    if (last !== undefined && Date.now() - last < REPEAT_WINDOW_MS) return;
    this.#alerted.set(key, Date.now());
    await this.alert(code, conditionId, {
      error: error instanceof Error ? error.message : String(error),
    }).catch((failure) => logger.error("kalshi.alert.failed", { error: failure }));
  }
}
