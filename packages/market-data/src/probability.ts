import type { Hex } from "./canonical.ts";
import { MarketDataError } from "./canonical.ts";

/** Prices and probabilities are fixed point with six decimals (1_000_000 = 1). */
export const PROBABILITY_SCALE = 1_000_000n;

export type ProbabilityQuality =
  | "crossed"
  | "disconnected"
  | "empty"
  | "low-depth"
  | "one-sided"
  | "stale"
  | "valid";

export interface ProbabilityPolicy {
  staleAfterMs: bigint;
  standardNotionalX6: bigint;
}

export interface ProbabilityTick {
  askDepthQuoteX6: string;
  bestAskX6: string | null;
  bestBidX6: string | null;
  bidDepthQuoteX6: string;
  conditionId: Hex;
  isStale: boolean;
  midpointX6: string | null;
  observedAtMs: string;
  quality: ProbabilityQuality;
  schemaVersion: 1;
  sourceHash: string;
  spreadX6: string | null;
  standardNotionalX6: string;
  /** The YES outcome's instrument (`EventOutcome.tokenId`). */
  yesTokenId: string;
}

/** A non-negative decimal with at most six decimals, as a six-decimal fixed-point integer. */
export const parseX6 = (value: unknown, name: string): bigint => {
  if (
    typeof value !== "string" ||
    value.length > 85 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)
  ) {
    throw new MarketDataError("INVALID_BOOK", `${name} must have at most six decimals`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * PROBABILITY_SCALE + BigInt(fraction.padEnd(6, "0"));
};

const quoteDepth = (book: Map<bigint, bigint>, cap: bigint): bigint => {
  let total = 0n;
  for (const [price, size] of book) {
    total += (price * size) / PROBABILITY_SCALE;
    if (total >= cap) return cap;
  }
  return total;
};

/** The YES side of one event market's book and the probability it implies. Venue books parse
 * their feed into `bids`/`asks` (price → size); the midpoint is usable only when the book is
 * connected, fresh, two-sided, uncrossed and at least `standardNotionalX6` deep on each side. */
export abstract class YesBook {
  protected readonly asks = new Map<bigint, bigint>();
  protected readonly bids = new Map<bigint, bigint>();
  protected connected = true;
  protected observedAtMs = 0n;
  protected sourceHash = "";

  constructor(
    readonly conditionId: Hex,
    readonly yesTokenId: string,
    readonly policy: ProbabilityPolicy,
  ) {
    if (policy.staleAfterMs <= 0n || policy.standardNotionalX6 <= 0n) {
      throw new MarketDataError("INVALID_POLICY", "probability policy values must be positive");
    }
  }

  disconnect(nowMs = BigInt(Date.now())): ProbabilityTick {
    this.connected = false;
    return this.tick(nowMs);
  }

  tick(nowMs = BigInt(Date.now())): ProbabilityTick {
    const bids = [...this.bids.keys()].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
    const asks = [...this.asks.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const bestBid = bids[0] ?? null;
    const bestAsk = asks[0] ?? null;
    const stale =
      this.observedAtMs === 0n ||
      this.observedAtMs > nowMs + 5_000n ||
      nowMs - this.observedAtMs > this.policy.staleAfterMs;
    const bidDepth = quoteDepth(this.bids, this.policy.standardNotionalX6);
    const askDepth = quoteDepth(this.asks, this.policy.standardNotionalX6);
    let quality: ProbabilityQuality = "valid";
    if (!this.connected) quality = "disconnected";
    else if (stale) quality = "stale";
    else if (bestBid === null && bestAsk === null) quality = "empty";
    else if (bestBid === null || bestAsk === null) quality = "one-sided";
    else if (bestBid >= bestAsk) quality = "crossed";
    else if (
      bidDepth < this.policy.standardNotionalX6 ||
      askDepth < this.policy.standardNotionalX6
    ) {
      quality = "low-depth";
    }
    const usable = quality === "valid" && bestBid !== null && bestAsk !== null;
    return {
      askDepthQuoteX6: askDepth.toString(),
      bestAskX6: bestAsk?.toString() ?? null,
      bestBidX6: bestBid?.toString() ?? null,
      bidDepthQuoteX6: bidDepth.toString(),
      conditionId: this.conditionId,
      isStale: stale,
      midpointX6: usable ? ((bestBid + bestAsk) / 2n).toString() : null,
      observedAtMs: this.observedAtMs.toString(),
      quality,
      schemaVersion: 1,
      sourceHash: this.sourceHash,
      spreadX6:
        bestBid !== null && bestAsk !== null && bestAsk >= bestBid
          ? (bestAsk - bestBid).toString()
          : null,
      standardNotionalX6: this.policy.standardNotionalX6.toString(),
      yesTokenId: this.yesTokenId,
    };
  }

  protected replace(target: Map<bigint, bigint>, next: Array<[bigint, bigint]>): void {
    target.clear();
    for (const [price, size] of next) if (size > 0n) target.set(price, size);
  }
}
