import { WAD } from "@conditional-stocks/evm-client";
import type { MarketState } from "@conditional-stocks/evm-client/ledger";
import { SPOT_BATCH_SIZE, type SpotPricesResponse } from "@conditional-stocks/shared/spot-prices";
import { type Address, getAddress } from "viem";
import { BPS, decimal, PROB, TESTNETS } from "./numbers.ts";

/** What a service reads from the chain for one market, besides the book. */
export interface Units {
  chainId: number;
  quote: Address;
  quoteDecimals: number;
  baseDecimals: number;
  /** Issuer UI multiplier (WAD): economic shares per whole token. */
  multiplier: bigint;
}
/** Stock price and event probability of one market at one moment. */
export interface Reference {
  /** Quote raw per base raw x 1e18. */
  spot: bigint;
  /** YES probability x 1e6 (Polymarket midpoint). */
  probability: bigint;
  /** Oldest time behind the reference (ms). */
  observedAt: number;
  /** Polymarket bid-ask spread x 1e6. */
  spread: bigint;
  /** Reference publish time (ms), or the probability time when stale prices are allowed. */
  spotAt: number;
  /** Polymarket observation time (ms). */
  probabilityAt: number;
}
/** Reviewed unit conversion of a market's reference prices. */
export interface ReferencePolicy {
  base: Address;
  /** Reference-price units per whole token before the issuer's live UI multiplier. */
  basePriceMultiplier: string;
  quotePriceMultiplier: string;
}
export interface ReferenceLimits {
  /** Testnets only: accept stale reference prices (e.g. outside US market hours). */
  allowStaleSpot: boolean;
  maxFeedAgeMs: number;
  maxProbabilitySpreadX6: number;
  probabilityFloorX6: number;
}

export function apiOrigin(input: string) {
  const url = new URL(input);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Use an HTTPS API origin, or localhost for tests");
  return url.origin;
}
export async function json(url: string): Promise<unknown> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Reference HTTP read failed");
  }
  const body = await response.text();
  if (body.length > 512_000) throw new Error("Reference response too large");
  return JSON.parse(body);
}
function fresh(value: unknown, now: number, maxAge: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > now + 5000 ||
    now - value > maxAge
  )
    throw new Error("Stale or invalid reference time");
  return value;
}
export function reference(
  input: unknown,
  prices: unknown,
  market: Pick<MarketState, "condition" | "yesIndex" | "noIndex" | "tick">,
  policy: ReferencePolicy,
  s: ReferenceLimits,
  units: Units,
  now = Date.now(),
): Reference {
  const source = input as {
    metadata?: {
      normalized?: {
        conditionId?: string;
        active?: boolean;
        closed?: boolean;
        outcomes?: { label: string; tokenId: string; indexSet: string }[];
      };
    };
    probability?: Record<string, unknown>;
  };
  const metadata = source?.metadata?.normalized,
    tick = source?.probability;
  const yes = metadata?.outcomes?.find((o) => o.label === "YES"),
    no = metadata?.outcomes?.find((o) => o.label === "NO");
  if (
    !metadata ||
    !tick ||
    metadata.conditionId?.toLowerCase() !== market.condition.toLowerCase() ||
    tick.conditionId !== metadata.conditionId ||
    !yes ||
    !no ||
    metadata.outcomes?.length !== 2 ||
    yes.tokenId === no.tokenId ||
    metadata.closed !== false ||
    metadata.active !== true ||
    tick.yesTokenId !== yes.tokenId ||
    yes.indexSet !== String(market.yesIndex) ||
    no.indexSet !== String(market.noIndex) ||
    tick.schemaVersion !== 1 ||
    tick.quality !== "valid" ||
    tick.isStale !== false
  )
    throw new Error("Invalid/illiquid probability or condition mapping");
  const integer = (v: unknown) => {
    if (typeof v !== "string" || !/^[0-9]{1,20}$/.test(v))
      throw new Error("Invalid probability value");
    return BigInt(v);
  };
  const p = integer(tick.midpointX6),
    bid = integer(tick.bestBidX6),
    ask = integer(tick.bestAskX6),
    spread = integer(tick.spreadX6);
  if (
    bid <= 0n ||
    ask >= PROB ||
    bid >= ask ||
    (bid + ask) / 2n !== p ||
    ask - bid !== spread ||
    spread > BigInt(s.maxProbabilitySpreadX6) ||
    p < BigInt(s.probabilityFloorX6) ||
    p > PROB - BigInt(s.probabilityFloorX6) ||
    integer(tick.standardNotionalX6) <= 0n ||
    integer(tick.bidDepthQuoteX6) < integer(tick.standardNotionalX6) ||
    integer(tick.askDepthQuoteX6) < integer(tick.standardNotionalX6)
  )
    throw new Error("Probability outside liquidity/risk limits");
  const observedAt =
    typeof tick.observedAtMs === "string" && /^[0-9]{1,16}$/.test(tick.observedAtMs)
      ? Number(tick.observedAtMs)
      : tick.observedAtMs;
  const probabilityAt = fresh(observedAt, now, s.maxFeedAgeMs);
  const times = [probabilityAt];
  const response = prices as SpotPricesResponse;
  if (
    !response ||
    response.source !== "robinhood" ||
    response.chainId !== units.chainId ||
    !Array.isArray(response.prices) ||
    response.prices.length !== 2 ||
    getAddress(response.prices[0]!.token) !== units.quote ||
    getAddress(response.prices[1]!.token) !== policy.base
  )
    throw new Error("Invalid reference price identity");
  const stale = s.allowStaleSpot && TESTNETS.includes(units.chainId);
  let spotAt = probabilityAt;
  /** USD per whole token x 1e18 under the reviewed unit conversion. */
  const observe = (index: number, multiplier: string) => {
    const price = response.prices[index]!;
    if (
      !(price.status === "available" || (price.status === "stale" && stale)) ||
      typeof price.priceUsd !== "number" ||
      !Number.isFinite(price.priceUsd) ||
      price.priceUsd <= 0
    )
      throw new Error("Unusable spot price");
    if (!stale) {
      const published = fresh((price.priceTimestamp ?? 0) * 1000, now, s.maxFeedAgeMs);
      times.push(published, fresh((price.fetchedAt ?? 0) * 1000, now, s.maxFeedAgeMs));
      if (index === 1) spotAt = published;
    }
    const value = (decimal(String(price.priceUsd), 18) * decimal(multiplier, 18)) / WAD;
    if (value <= 0n) throw new Error("Unusable spot price");
    return value;
  };
  const quoteUsd = observe(0, policy.quotePriceMultiplier);
  // The reference prices one economic share; one whole token is `multiplier` shares.
  const tokenUsd = (observe(1, policy.basePriceMultiplier) * units.multiplier) / WAD;
  const spot =
    (tokenUsd * WAD * 10n ** BigInt(units.quoteDecimals)) /
    (quoteUsd * 10n ** BigInt(units.baseDecimals));
  if (spot <= 0n || spot * BPS < market.tick) throw new Error("Unsupported token units");
  return { spot, probability: p, spread, observedAt: Math.min(...times), spotAt, probabilityAt };
}
/** Reference prices of `tokens`, in their order, in as few requests as the API accepts. */
export async function fetchSpotPrices(
  origin: string,
  tokens: readonly Address[],
): Promise<SpotPricesResponse> {
  const batches: Address[][] = [];
  for (let i = 0; i < tokens.length; i += SPOT_BATCH_SIZE)
    batches.push(tokens.slice(i, i + SPOT_BATCH_SIZE));
  const responses = (await Promise.all(
    batches.map((batch) => json(`${origin}/v1/spot-prices?tokens=${batch.join(",")}`)),
  )) as SpotPricesResponse[];
  const first = responses[0];
  if (!first || responses.some((r) => !Array.isArray(r?.prices)))
    throw new Error("Invalid spot price response");
  return { ...first, prices: responses.flatMap((r) => r.prices) };
}
/** The two prices one market's reference reads, from a response covering several markets: its
 * quote token's, then its base token's. A missing price fails `reference`'s identity check. */
export function spotPair(
  response: SpotPricesResponse,
  quote: Address,
  base: Address,
): SpotPricesResponse {
  const find = (token: Address) => response.prices.filter((p) => getAddress(p.token) === token);
  return { ...response, prices: [...find(quote).slice(0, 1), ...find(base).slice(0, 1)] };
}
/** Polymarket metadata and the latest probability of one market's event. */
export const fetchPolymarket = (origin: string, market: number) =>
  json(`${origin}/v1/markets/${market}/polymarket`);
export async function fetchReference(
  origin: string,
  market: Pick<MarketState, "id" | "condition" | "yesIndex" | "noIndex" | "tick">,
  policy: ReferencePolicy,
  s: ReferenceLimits,
  units: Units,
) {
  const [source, prices] = await Promise.all([
    json(`${origin}/v1/markets/${market.id}/polymarket`),
    json(`${origin}/v1/spot-prices?tokens=${units.quote},${policy.base}`),
  ]);
  return reference(source, prices, market, policy, s, units);
}
