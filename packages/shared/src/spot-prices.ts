/** Reference prices for display, never execution guarantees or contract settlement authority.
 * The opt-in market maker separately reviews units and risk before using these indicative
 * observations to choose its own quotes. */

export const SPOT_MAX_AGE_SECONDS = 120;
export const SPOT_MAX_CACHE_AGE_SECONDS = 60;
/** US equities publish only during trading sessions; their last price stays a valid display
 * reference for a day. Continuously traded crypto references must be two minutes fresh. */
export const SPOT_EQUITY_MAX_AGE_SECONDS = 24 * 60 * 60;
export const SPOT_POLL_MS = 15_000;
export const SPOT_BATCH_SIZE = 50;

export type SpotStatus = "available" | "stale" | "unavailable" | "unmapped" | "invalid";

export interface SpotPrice {
  /** Token address (the request key). */
  token: string;
  symbol: string | null;
  /** Reference feed (e.g. "Equity.US.NVDA/USD"), or null when the token is not catalogued. */
  source: string | null;
  kind: "stock" | "etf" | "stablecoin" | "crypto" | null;
  status: SpotStatus;
  /** USD per economic share (stocks) or per coin; NOT a token or execution price. */
  priceUsd: number | null;
  /** Publish time of the reference observation, in seconds. */
  priceTimestamp: number | null;
  fetchedAt: number | null;
  /** Ordinary units: a raw balance / 10^decimals is valued at priceUsd (stable/crypto). */
  valuationCompatible: boolean;
}

export interface SpotPricesResponse {
  source: "pyth";
  displayOnly: true;
  chainId: number;
  asOf: number;
  prices: SpotPrice[];
}

export const spotMaxAgeSeconds = (price: Pick<SpotPrice, "kind">) =>
  price.kind === "stock" || price.kind === "etf"
    ? SPOT_EQUITY_MAX_AGE_SECONDS
    : SPOT_MAX_AGE_SECONDS;

export function expireSpotPrice(price: SpotPrice, nowMs = Date.now()): SpotPrice {
  if (price.status !== "available") return price;
  const now = Math.floor(nowMs / 1000);
  if (
    price.fetchedAt === null ||
    price.fetchedAt > now + 5 ||
    now - price.fetchedAt > SPOT_MAX_CACHE_AGE_SECONDS ||
    price.priceTimestamp === null ||
    price.priceTimestamp > now + 5 ||
    now - price.priceTimestamp > spotMaxAgeSeconds(price)
  )
    return { ...price, status: "stale" };
  return price;
}

/** Floating point is allowed only at the display boundary, never for token amounts. */
export function spotUsdValue(price: SpotPrice | undefined, nowMs = Date.now()): number | null {
  if (!price || !price.valuationCompatible || expireSpotPrice(price, nowMs).status !== "available")
    return null;
  return typeof price.priceUsd === "number" && Number.isFinite(price.priceUsd) && price.priceUsd > 0
    ? price.priceUsd
    : null;
}

/** USD per whole base token: the per-share reference times the issuer's UI multiplier (shares
 * per token, 1 without one). Display/reference only. */
export function tokenPriceUsd(
  price: SpotPrice | number | null | undefined,
  multiplier: number,
  nowMs = Date.now(),
) {
  const usd =
    typeof price === "number"
      ? price
      : price && expireSpotPrice(price, nowMs).status === "available"
        ? price.priceUsd
        : null;
  if (
    typeof usd !== "number" ||
    !Number.isFinite(usd) ||
    usd <= 0 ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0
  )
    return null;
  const value = usd * multiplier;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export const isEvmAddress = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
