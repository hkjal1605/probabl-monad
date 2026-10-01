/** Reference prices from Robinhood's Stock Token API (display and quoting reference only).
 *
 * Stocks and ETFs: the midpoint of Robinhood's live bid and ask for the underlying share
 * (`/prices/{symbol}`, which Robinhood caches for 15 s), per economic share; the token's UI
 * multiplier is applied downstream. A trading halt makes a price unavailable. USD stablecoins
 * are their peg. Other assets have no reference. Every symbol is read at most once per
 * `ttlMs`, however many callers ask, and concurrent callers share one request. */
import { ReadCache } from "@conditional-stocks/shared/read-cache";
import {
  expireSpotPrice,
  SPOT_BATCH_SIZE,
  type SpotPrice,
  type SpotPricesResponse,
} from "@conditional-stocks/shared/spot-prices";
import { catalogAsset } from "@conditional-stocks/shared/token-catalog";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface TokenIdentity {
  token: string;
  symbol: string | null;
}
/** A price source the market-data routes serve. */
export interface SpotPriceSource {
  getPrices(tokens: TokenIdentity[]): Promise<SpotPricesResponse>;
}
interface Quote {
  /** USD per share, the bid/ask midpoint. */
  price: number;
  /** When Robinhood generated the quote, in seconds. */
  at: number;
  halted: boolean;
}

export const ROBINHOOD_PRICES_URL = "https://api.robinhood.com/rhj";
const SCALE = 10n ** 18n;
/** A decimal price string in 1e-18 units, or null when it is not one. */
const scaled = (value: unknown) => {
  if (typeof value !== "string" || !/^[0-9]{1,12}(\.[0-9]{1,18})?$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
};
/** The exact midpoint of two scaled prices, as the shortest decimal number. */
const midpoint = (bid: bigint, ask: bigint) => {
  const mid = (bid + ask) / 2n;
  return Number(`${mid / SCALE}.${(mid % SCALE).toString().padStart(18, "0")}`);
};

export class RobinhoodSpotPrices implements SpotPriceSource {
  private quotes: ReadCache;

  constructor(
    private readonly chainId: number,
    private readonly base = ROBINHOOD_PRICES_URL,
    private readonly fetcher: Fetch = fetch,
    ttlMs = 2_000,
  ) {
    this.quotes = new ReadCache(ttlMs, 256);
  }

  /** Robinhood's live quote of one stock or ETF symbol. */
  private quote(symbol: string): Promise<Quote> {
    return this.quotes.get(symbol, async () => {
      const response = await this.fetcher(`${this.base}/prices/${encodeURIComponent(symbol)}`, {
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Robinhood prices returned ${response.status}`);
      }
      const text = await response.text();
      if (text.length > 64 * 1024) throw new Error("Oversized Robinhood price response");
      const body = JSON.parse(text) as { quotes?: Record<string, unknown>[] };
      const q = body.quotes?.find((item) => item.tokenSymbol === symbol);
      const bid = scaled(q?.bid),
        ask = scaled(q?.ask),
        at = Date.parse(String(q?.generatedAt ?? ""));
      if (!q || bid === null || ask === null || bid <= 0n || ask < bid || !Number.isFinite(at))
        throw new Error("Invalid Robinhood quote");
      return {
        price: midpoint(bid, ask),
        at: Math.floor(at / 1000),
        halted: q.isTradingHalt === true,
      };
    });
  }

  async getPrices(tokens: TokenIdentity[]): Promise<SpotPricesResponse> {
    if (!tokens.length || tokens.length > SPOT_BATCH_SIZE)
      throw new Error("Invalid spot price batch");
    const now = Date.now();
    const fetchedAt = Math.floor(now / 1000);
    const assets = tokens.map((t) => ({ ...t, asset: catalogAsset(t.symbol) }));
    const symbols = [
      ...new Set(
        assets.flatMap(({ asset }) =>
          asset && (asset.kind === "stock" || asset.kind === "etf") ? [asset.symbol] : [],
        ),
      ),
    ];
    const quotes = new Map(
      await Promise.all(
        symbols.map(
          async (symbol) => [symbol, await this.quote(symbol).catch(() => undefined)] as const,
        ),
      ),
    );
    const prices = assets.map(({ token, symbol, asset }): SpotPrice => {
      const kind = asset?.kind ?? null;
      const valuationCompatible = kind === "stablecoin" || kind === "crypto";
      const none = (status: SpotPrice["status"], source: string | null): SpotPrice => ({
        token,
        symbol,
        source,
        kind,
        status,
        priceUsd: null,
        priceTimestamp: null,
        fetchedAt: null,
        valuationCompatible,
      });
      if (!asset) return none("unmapped", null);
      if (kind === "stablecoin")
        return {
          ...none("available", "usd-peg"),
          priceUsd: 1,
          priceTimestamp: fetchedAt,
          fetchedAt,
        };
      if (kind === "crypto") return none("unavailable", null);
      const source = `robinhood:${asset.symbol}`;
      const quote = quotes.get(asset.symbol);
      if (!quote || quote.halted) return none("unavailable", source);
      return expireSpotPrice(
        {
          ...none("available", source),
          priceUsd: quote.price,
          priceTimestamp: Math.min(quote.at, fetchedAt),
          fetchedAt,
        },
        now,
      );
    });
    return {
      source: "robinhood",
      displayOnly: true,
      chainId: this.chainId,
      asOf: fetchedAt,
      prices,
    };
  }
}
