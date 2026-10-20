import {
  formatPriceRawX18,
  formatShareAmount,
  MAX_ORDER_UINT128,
  parsePriceRawX18,
  parseTokenAmount,
} from "@conditional-stocks/domain";
import { currentSpotUsd } from "@/lib/markets/presentation";
import type { MarketView } from "@/types/api";

/** Round down to an onchain share step; never exceed the entered quote budget. */
export function quantityForSpend(spend: string, price: string, market: MarketView): string {
  const budget = parseTokenAmount(spend, market.quoteTokenDecimals);
  const rawPrice = parsePriceRawX18(price, market);
  const step = BigInt(market.baseStep);
  if (budget <= 0n || rawPrice <= 0n || step <= 0n)
    throw new Error("Enter a positive budget and price");
  const raw = ((budget * 10n ** 18n) / rawPrice / step) * step;
  if (raw <= 0n || raw >= 1n << 96n)
    throw new Error("Budget is outside the supported quantity range");
  return formatShareAmount(raw, market);
}

/** Best executable price: a buy takes the best ask, a sell hits the best bid. */
export function bestPriceFor(
  market: MarketView,
  branch: "YES" | "NO",
  side: "buy" | "sell",
): string | null {
  const book = branch === "YES" ? market.yes : market.no;
  return side === "buy" ? book.bestAskExact : book.bestBidExact;
}

/** The bound off the token's reference price for a market order the book cannot price: the
 * approved RFQ makers (Δ-vaults) quote it near that price, a spread and the event's gap away. */
export const REFERENCE_BOUND_BPS = 500;

/** What a market order's worst price is measured from: the book's best price on its side, else
 * the token's live reference price, which the RFQ makers quote around; null when neither is
 * known. */
export function marketPriceBasis(
  market: MarketView,
  branch: "YES" | "NO",
  side: "buy" | "sell",
): "book" | "reference" | null {
  if (bestPriceFor(market, branch, side)) return "book";
  return currentSpotUsd(market) === null ? null : "reference";
}

/** A market order is IOC with a signed, bounded worst price, never an unbounded order: the
 * book's best price ± `slippageBps`, or, with no book on its side, the token's reference price
 * ± `REFERENCE_BOUND_BPS`. */
export function marketPriceBound(
  market: MarketView,
  branch: "YES" | "NO",
  side: "buy" | "sell",
  slippageBps = 100,
): string {
  if (market.bookQuality && market.bookQuality !== "available")
    throw new Error("Wait for a fresh order book before setting a market-order bound");
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10000)
    throw new Error("No executable price bound");
  const book = bestPriceFor(market, branch, side);
  const spot = book ? null : currentSpotUsd(market);
  const price = book ?? spot?.toFixed(market.quoteTokenDecimals) ?? null;
  if (!price) throw new Error("No executable price bound");
  const bps = book ? slippageBps : REFERENCE_BOUND_BPS;
  const raw = parsePriceRawX18(price, market);
  const tick = BigInt(market.priceTickRawX18 ?? "1");
  if (tick <= 0n) throw new Error("Invalid market price tick");
  // Round inward to the tick grid so the bound never exceeds the stated slippage.
  const bound =
    side === "buy"
      ? ((raw * BigInt(10000 + bps)) / 10000n / tick) * tick
      : ((raw * BigInt(10000 - bps) + 10000n * tick - 1n) / (10000n * tick)) * tick;
  if (bound <= 0n || bound > MAX_ORDER_UINT128)
    throw new Error("Price is outside the supported range");
  return formatPriceRawX18(bound, market);
}
