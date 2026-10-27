import {
  formatPriceRawX18,
  formatShareAmount,
  formatTokenAmount,
  MAX_ORDER_UINT128,
  parsePriceRawX18,
  priceExponent,
  quoteForReservation,
} from "@conditional-stocks/domain";
import { decimalInput, decimalPlaces, parseAmountInput } from "@/lib/format/amount-input";
import { currentSpotUsd } from "@/lib/markets/presentation";
import type { MarketView } from "@/types/api";

/** A typed price as the market's exact decimal, or null while there is none (not yet loaded or
 * typed). Throws when it has more decimal places than the market's prices take. */
export function priceInput(text: string, market: MarketView): string | null {
  const value = decimalInput(text);
  if (value === null) return null;
  const places = priceExponent(market);
  if (decimalPlaces(value) > places)
    throw new Error(`Prices allow at most ${places} decimal places.`);
  return value;
}

/** The least an order in `market` can spend at `rawPrice` (raw quote units): the value of the
 * fewest whole steps reaching the market's minimum order value, which the exchange checks at the
 * order's price, rounded up; at least one step. */
export function leastSpend(market: MarketView, rawPrice: bigint): bigint {
  const step = BigInt(market.baseStep),
    minimum = BigInt(market.minNotional ?? "0");
  const shares = minimum > 0n ? ((minimum - 1n) * 10n ** 18n) / rawPrice + 1n : 1n;
  return quoteForReservation(((shares + step - 1n) / step) * step, rawPrice);
}

/** Shares a spend of the quote token buys at `price`, rounded down to an onchain share step, so
 * the order never exceeds the budget. Throws a message a person can act on; callers wait for a
 * price rather than call this without one. */
export function quantityForSpend(spend: string, price: string, market: MarketView): string {
  const symbol = market.quoteTokenMetadata?.symbol ?? "USDC";
  const budget = parseAmountInput(spend, market.quoteTokenDecimals, symbol);
  if (budget <= 0n) throw new Error("Enter an amount above 0.");
  const exact = priceInput(price, market);
  if (exact === null) throw new Error("Set a price first.");
  const rawPrice = parsePriceRawX18(exact, market);
  const step = BigInt(market.baseStep);
  if (step <= 0n) throw new Error("This market has no share step.");
  const raw = ((budget * 10n ** 18n) / rawPrice / step) * step;
  // Rounding down to whole steps can take a spend below the market's minimum order value.
  if (raw <= 0n || quoteForReservation(raw, rawPrice) < BigInt(market.minNotional ?? "0")) {
    const cents = 10n ** BigInt(Math.max(0, market.quoteTokenDecimals - 2));
    const least = ((leastSpend(market, rawPrice) + cents - 1n) / cents) * cents;
    throw new Error(
      `The smallest order here is ${formatTokenAmount(least, market.quoteTokenDecimals)} ${symbol} at this price.`,
    );
  }
  if (raw >= 1n << 96n) throw new Error("That amount is too large.");
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
