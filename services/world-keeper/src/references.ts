/** Live references, held in memory so a quote prices without a read.
 *
 * - Each leg's venue probability streams from the ingestor (`/v1/conditions/:id/stream`, as the
 *   Δ-vault keeper reads it), seeded by one read; every tick is checked (the condition, a valid
 *   two-sided book, freshness) and kept with a 30-minute history for the jump gate.
 * - Spot: the API's reference price of each underlying's token when configured, polled, and
 *   each feed's latest round (one multicall per poll). A quote needs one fresh source, and both
 *   to agree when both exist. */
import type { Address, Hex, PublicClient } from "viem";
import { parseAbi } from "viem";

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function decimals() view returns (uint8)",
]);
const MAX_BACKOFF_MS = 30_000;
const HISTORY_MS = 1_800_000;

export interface LegTick {
  /** The YES midpoint and half the spread (probability). */
  yes: number;
  halfSpread: number;
  observedAtMs: number;
}
/** What the probability stream needs of a WebSocket (tests substitute their own). */
export interface StreamSocket {
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close(): void;
}

/** A tick as the ingestor serves it, checked: null unless usable. */
export function parseTick(condition: Hex, value: unknown): LegTick | null {
  const t = value as Record<string, unknown> | null;
  if (!t || t.schemaVersion !== 1 || t.quality !== "valid" || t.isStale !== false) return null;
  if (typeof t.conditionId !== "string" || t.conditionId.toLowerCase() !== condition.toLowerCase())
    return null;
  const x6 = (v: unknown) =>
    typeof v === "string" && /^[0-9]{1,7}$/.test(v) ? Number(v) / 1e6 : Number.NaN;
  const mid = x6(t.midpointX6),
    bid = x6(t.bestBidX6),
    ask = x6(t.bestAskX6);
  const observed = Number(t.observedAtMs);
  if (!(bid > 0 && ask < 1 && bid < ask && mid > 0 && mid < 1) || !Number.isFinite(observed))
    return null;
  return { yes: mid, halfSpread: (ask - bid) / 2, observedAtMs: observed };
}

export class LegReferences {
  private readonly ticks = new Map<string, LegTick[]>();
  private readonly streams = new Map<string, { socket?: StreamSocket; retryMs: number }>();
  private stopped = false;

  constructor(
    private readonly options: {
      origin: string;
      connect?: (url: string) => StreamSocket;
      fetch?: typeof fetch;
      onError?: (event: string, detail: Record<string, unknown>) => void;
    },
  ) {}

  stop() {
    this.stopped = true;
    for (const s of this.streams.values()) s.socket?.close();
    this.streams.clear();
  }

  /** Follows `condition` from now on (idempotent): one read now, then its stream. */
  follow(condition: Hex) {
    const key = condition.toLowerCase();
    if (this.streams.has(key) || this.stopped) return;
    this.streams.set(key, { retryMs: 1_000 });
    void (this.options.fetch ?? fetch)(`${this.options.origin}/v1/conditions/${key}/probability`, {
      signal: AbortSignal.timeout(8_000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((tick) => this.observe(key as Hex, tick))
      .catch(() => {});
    this.open(key);
  }

  /** Records a tick (from the stream, a read, or a test). */
  observe(condition: Hex, value: unknown) {
    const key = condition.toLowerCase();
    const tick = parseTick(key as Hex, value);
    if (!tick) return;
    const list = this.ticks.get(key) ?? [];
    if (list.length && list.at(-1)!.observedAtMs >= tick.observedAtMs) return;
    list.push(tick);
    while (list.length && tick.observedAtMs - list[0]!.observedAtMs > HISTORY_MS) list.shift();
    this.ticks.set(key, list);
  }

  /** The latest usable tick of a condition. */
  latest(condition: Hex) {
    return this.ticks.get(condition.toLowerCase())?.at(-1);
  }

  /** When the condition last jumped: a move over max(points, sigmas·σ of 15-minute moves)
   * within 15 minutes (null when it has not in the history kept). */
  lastJump(condition: Hex, points: number, sigmas: number) {
    const list = this.ticks.get(condition.toLowerCase()) ?? [];
    if (list.length < 2) return null;
    const window = 900_000;
    const moves: number[] = [];
    let jump: number | null = null;
    for (let i = 1; i < list.length; i++) {
      let j = i - 1;
      while (j > 0 && list[i]!.observedAtMs - list[j - 1]!.observedAtMs <= window) j--;
      moves.push(Math.abs(list[i]!.yes - list[j]!.yes));
    }
    const mean = moves.reduce((a, b) => a + b, 0) / moves.length;
    const sd = Math.sqrt(moves.reduce((a, b) => a + (b - mean) ** 2, 0) / moves.length);
    const threshold = Math.max(points, sigmas * sd);
    for (let i = 1; i < list.length; i++)
      if (moves[i - 1]! > threshold) jump = list[i]!.observedAtMs;
    return jump;
  }

  private open(key: string) {
    const entry = this.streams.get(key);
    if (!entry || this.stopped) return;
    const url = `${this.options.origin.replace(/^http/, "ws")}/v1/conditions/${key}/stream`;
    let socket: StreamSocket;
    try {
      socket = this.options.connect?.(url) ?? (new WebSocket(url) as unknown as StreamSocket);
    } catch {
      return this.retry(key, entry);
    }
    entry.socket = socket;
    socket.onmessage = (event) => {
      try {
        const m = JSON.parse(String(event.data)) as { topic?: string; value?: unknown };
        if (m.topic !== `probability.${key}`) return;
        entry.retryMs = 1_000;
        this.observe(key as Hex, m.value);
      } catch {
        // Not a probability frame.
      }
    };
    socket.onclose = () => {
      if (entry.socket === socket) delete entry.socket;
      this.retry(key, entry);
    };
  }
  private retry(key: string, entry: { retryMs: number }) {
    if (this.stopped) return;
    const delay = entry.retryMs;
    entry.retryMs = Math.min(delay * 2, MAX_BACKOFF_MS);
    setTimeout(() => this.streams.get(key) === entry && this.open(key), delay).unref?.();
  }
}

/** One underlying's spot in feed units (the feed's answer scale), and when it was observed. */
export interface Spot {
  price: number;
  observedAtMs: number;
  source: "api" | "feed";
}

export class SpotReferences {
  private readonly feeds = new Map<
    Address,
    { answer: number; decimals: number; updatedAtMs: number }
  >();
  private readonly api = new Map<Address, { usd: number; observedAtMs: number }>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly options: {
      client: PublicClient;
      origin: string;
      pollMs: number;
      /** Feeds to read, and the API token (if any) of each feed's underlying. */
      sources: () => { feed: Address; token?: Address }[];
      fetch?: typeof fetch;
      onError?: (event: string, detail: Record<string, unknown>) => void;
    },
  ) {}

  start() {
    const poll = async () => {
      try {
        await this.poll();
      } catch (error) {
        this.options.onError?.("spot-unavailable", { reason: (error as Error).message });
      }
      if (!this.stopped) this.timer = setTimeout(poll, this.options.pollMs);
    };
    void poll();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  async poll() {
    const sources = this.options.sources();
    const feeds = [...new Set(sources.map((s) => s.feed))];
    if (feeds.length) {
      const reads = (await this.options.client.multicall({
        allowFailure: true,
        deployless: true,
        contracts: feeds.flatMap((address) => [
          { address, abi: feedAbi, functionName: "latestRoundData" },
          { address, abi: feedAbi, functionName: "decimals" },
        ]) as never,
      })) as { status: string; result?: unknown }[];
      feeds.forEach((feed, i) => {
        const round = reads[2 * i],
          decimals = reads[2 * i + 1];
        if (round?.status !== "success" || decimals?.status !== "success") return;
        const r = round.result as readonly bigint[];
        const d = Number(decimals.result);
        if (r[1]! <= 0n) return;
        this.feeds.set(feed, {
          answer: Number(r[1]!),
          decimals: d,
          updatedAtMs: Number(r[3]!) * 1000,
        });
      });
    }
    const tokens = [...new Set(sources.flatMap((s) => (s.token ? [s.token] : [])))];
    if (tokens.length) {
      const response = await (this.options.fetch ?? fetch)(
        `${this.options.origin}/v1/spot-prices?tokens=${tokens.join(",")}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) throw new Error(`Spot prices: HTTP ${response.status}`);
      const body = (await response.json()) as {
        prices?: { token: string; status?: string; priceUsd?: number; priceTimestamp?: number }[];
      };
      for (const p of body.prices ?? [])
        if (
          (p.status === "available" || p.status === "stale") &&
          typeof p.priceUsd === "number" &&
          p.priceUsd > 0
        )
          this.api.set(p.token as Address, {
            usd: p.priceUsd,
            observedAtMs: p.status === "available" ? (p.priceTimestamp ?? 0) * 1000 : 0,
          });
    }
  }

  /** The underlying's spot in feed answer units, or why there is none: the API's price when
   * fresh (USD per share, scaled by the feed's decimals), else the feed's own latest round;
   * both must agree within `maxDeviationBps` when both are fresh. */
  spot(
    feed: Address,
    token: Address | undefined,
    limits: { maxAgeMs: number; maxDeviationBps: number; allowStale: boolean },
    nowMs = Date.now(),
  ): Spot | { problem: string } {
    const f = this.feeds.get(feed);
    if (!f) return { problem: "The feed has not been read" };
    const feedFresh = limits.allowStale || nowMs - f.updatedAtMs <= limits.maxAgeMs;
    const scale = 10 ** f.decimals;
    const a = token ? this.api.get(token) : undefined;
    const apiFresh =
      a !== undefined && (limits.allowStale || nowMs - a.observedAtMs <= limits.maxAgeMs);
    if (apiFresh && a) {
      const price = a.usd * scale;
      if (feedFresh && Math.abs(price - f.answer) / f.answer > limits.maxDeviationBps / 10_000)
        return { problem: "The spot price and the feed disagree" };
      return { price, observedAtMs: a.observedAtMs || nowMs, source: "api" };
    }
    if (!feedFresh) return { problem: "Spot is stale" };
    return { price: f.answer, observedAtMs: f.updatedAtMs, source: "feed" };
  }
}
