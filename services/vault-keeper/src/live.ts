/** Live references for RFQ quotes, held in memory so a request prices without a read.
 *
 * Each event's Polymarket probability arrives over the ingestor's stream (pushed on every book
 * change), and the spot prices are polled every `spotPollMs` (the API caches them for 2 s). The
 * rounds hand over each market's Polymarket metadata, which `reference` validates the
 * probability against, as it does every round's. */
import type { MarketState } from "@conditional-stocks/evm-client/ledger";
import {
  fetchSpotPrices,
  type Reference,
  type ReferenceLimits,
  type ReferencePolicy,
  reference,
  spotPair,
  type Units,
} from "@conditional-stocks/operator";
import type { Address } from "viem";

type SpotPrices = Awaited<ReturnType<typeof fetchSpotPrices>>;
/** What the probability stream needs of a WebSocket (tests substitute their own). */
export interface StreamSocket {
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror?: ((event: unknown) => void) | null;
  close(): void;
}
interface Tick {
  observedAtMs?: unknown;
}
const observed = (tick: Tick | undefined) => Number(tick?.observedAtMs ?? 0) || 0;
const MAX_BACKOFF_MS = 30_000;

export class LiveReferences {
  private spot: SpotPrices | undefined;
  private readonly ticks = new Map<string, Tick>();
  private readonly metadata = new Map<number, unknown>();
  private readonly streams = new Map<
    string,
    { socket?: StreamSocket | undefined; retryMs: number }
  >();
  private poller: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly options: {
      origin: string;
      /** The quote token and every quoted vault's stock. */
      tokens: readonly Address[];
      spotPollMs: number;
      fetchSpot?: typeof fetchSpotPrices;
      connect?: (url: string) => StreamSocket;
      onError?: (event: string, detail: Record<string, unknown>) => void;
    },
  ) {}

  start() {
    const poll = async () => {
      try {
        this.spot = await (this.options.fetchSpot ?? fetchSpotPrices)(this.options.origin, [
          ...this.options.tokens,
        ]);
      } catch (error) {
        this.options.onError?.("rfq-spot-unavailable", { reason: (error as Error).message });
      }
      if (!this.stopped) this.poller = setTimeout(poll, this.options.spotPollMs);
    };
    void poll();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.poller);
    for (const stream of this.streams.values()) stream.socket?.close();
    this.streams.clear();
  }

  /** Records a round's Polymarket read of `market` (metadata and a probability tick) and keeps
   * its event's probability streaming from then on. */
  track(market: MarketState, source: unknown) {
    const s = source as { metadata?: unknown; probability?: Tick } | undefined;
    if (s?.metadata) this.metadata.set(market.id, s.metadata);
    const condition = market.condition.toLowerCase();
    if (s?.probability && observed(s.probability) >= observed(this.ticks.get(condition)))
      this.ticks.set(condition, s.probability);
    if (!this.streams.has(condition) && !this.stopped) this.open(condition);
  }

  private open(condition: string) {
    const entry = this.streams.get(condition) ?? { retryMs: 1_000 };
    this.streams.set(condition, entry);
    const url = `${this.options.origin.replace(/^http/, "ws")}/v1/polymarket/conditions/${condition}/stream`;
    let socket: StreamSocket;
    try {
      socket = this.options.connect?.(url) ?? (new WebSocket(url) as unknown as StreamSocket);
    } catch {
      return this.retry(condition, entry);
    }
    entry.socket = socket;
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { topic?: string; value?: Tick };
        if (message.topic !== `probability.${condition}` || !message.value) return;
        entry.retryMs = 1_000;
        if (observed(message.value) >= observed(this.ticks.get(condition)))
          this.ticks.set(condition, message.value);
      } catch {
        // Not a probability frame.
      }
    };
    socket.onclose = () => {
      if (entry.socket === socket) entry.socket = undefined;
      this.retry(condition, entry);
    };
  }

  private retry(condition: string, entry: { retryMs: number }) {
    if (this.stopped) return;
    const delay = entry.retryMs;
    entry.retryMs = Math.min(entry.retryMs * 2, MAX_BACKOFF_MS);
    setTimeout(() => {
      if (!this.stopped && this.streams.get(condition) === entry) this.open(condition);
    }, delay);
  }

  /** The market's reference from the latest probability and spot prices, validated as every
   * round's is (identity, liquidity, freshness under `limits.maxFeedAgeMs`). Throws when either
   * is missing or unusable. */
  reference(
    market: MarketState,
    policy: ReferencePolicy,
    limits: ReferenceLimits,
    units: Units,
    now = Date.now(),
  ): Reference {
    const metadata = this.metadata.get(market.id),
      tick = this.ticks.get(market.condition.toLowerCase());
    if (!metadata || !tick || !this.spot) throw new Error("Live reference unavailable");
    return reference(
      { metadata, probability: tick },
      spotPair(this.spot, units.quote, policy.base),
      market,
      policy,
      limits,
      units,
      now,
    );
  }
}
