/** The RFQ makers' (Δ-vaults') current prices for a standard $100 order, best across makers, by
 * on-chain market and branch (`/v1/rfq/prices`). A market order is quoted at about these prices,
 * so the app folds them into each branch's best bid and ask: every price, midpoint and chart
 * shows them while the book is empty, and the better of the two otherwise. */
import { formatPriceRawX18, parsePriceRawX18 } from "@conditional-stocks/domain";
import type { BranchBook, MarketView } from "@/types/api";
import { apiUrl } from "./constants";

export interface QuotePrice {
  /** On-chain market id. */
  market: string;
  branch: 0 | 1;
  /** Raw prices (quote per base x 1e18), or null when no maker quotes that side. */
  bid: string | null;
  ask: string | null;
}
export interface QuotePrices {
  /** How long the API keeps a maker's prices: older copies are not shown. */
  ttlMs: number;
  prices: QuotePrice[];
}

export const QUOTE_PRICES_PATH = "/v1/rfq/prices";
const RAW = /^[1-9][0-9]{0,38}$/;

export function parseQuotePrices(value: unknown): QuotePrices {
  const v = value as { ttlMs?: unknown; prices?: unknown };
  if (!v || !Number.isSafeInteger(v.ttlMs) || !Array.isArray(v.prices))
    throw new Error("Invalid quote prices");
  return {
    ttlMs: v.ttlMs as number,
    prices: v.prices.map((entry) => {
      const p = entry as Record<string, unknown>;
      const raw = (x: unknown) => {
        if (x === null) return null;
        if (typeof x !== "string" || !RAW.test(x)) throw new Error("Invalid quote price");
        return x;
      };
      if (!Number.isSafeInteger(p.market) || (p.branch !== 0 && p.branch !== 1))
        throw new Error("Invalid quote price");
      return { market: String(p.market), branch: p.branch, bid: raw(p.bid), ask: raw(p.ask) };
    }),
  };
}

export async function readQuotePrices(signal?: AbortSignal): Promise<QuotePrices> {
  const response = await fetch(apiUrl(QUOTE_PRICES_PATH), {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Quote prices unavailable (${response.status})`);
  }
  return parseQuotePrices(await response.json());
}

/** A branch's book with the makers' prices folded in: the higher bid and the lower ask of the
 * two, and the makers' own prices kept for display (`quote`). */
function fold(book: BranchBook, quote: QuotePrice | undefined, market: MarketView): BranchBook {
  if (!quote) return book;
  const side = (exact: string | null, raw: string | null, higher: boolean) => {
    if (raw === null) return exact;
    const own = formatPriceRawX18(BigInt(raw), market);
    if (exact === null) return own;
    const a = parsePriceRawX18(exact, market),
      b = BigInt(raw);
    return (higher ? b > a : b < a) ? own : exact;
  };
  const bestBidExact = side(book.bestBidExact, quote.bid, true),
    bestAskExact = side(book.bestAskExact, quote.ask, false);
  const bestBid = bestBidExact === null ? null : Number(bestBidExact),
    bestAsk = bestAskExact === null ? null : Number(bestAskExact);
  return {
    ...book,
    bestBidExact,
    bestAskExact,
    bestBid,
    bestAsk,
    spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
    quote: {
      bid: quote.bid === null ? null : formatPriceRawX18(BigInt(quote.bid), market),
      ask: quote.ask === null ? null : formatPriceRawX18(BigInt(quote.ask), market),
    },
  };
}

/** Markets with the makers' prices folded into both branches' books. `fresh` says the copy is
 * younger than the API's ttl (the app's own clock, so a skewed clock cannot keep it alive). */
export function withQuotePrices(
  markets: MarketView[],
  quotes: QuotePrices | undefined,
  fresh: boolean,
): MarketView[] {
  if (!fresh || !quotes?.prices.length) return markets;
  const prices = new Map(quotes.prices.map((p) => [`${p.market}:${p.branch}`, p]));
  return markets.map((m) => {
    const yes = prices.get(`${m.venue.marketId}:0`),
      no = prices.get(`${m.venue.marketId}:1`);
    return yes || no ? { ...m, yes: fold(m.yes, yes, m), no: fold(m.no, no, m) } : m;
  });
}
