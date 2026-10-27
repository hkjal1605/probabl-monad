/** Reference prices from Robinhood's Stock Token API (display and quoting reference only).
 *
 * Stocks and ETFs: the midpoint of Robinhood's live bid and ask for the underlying share
 * (`/prices/{symbol}`, which Robinhood caches for 15 s), per economic share; the token's UI
 * multiplier is applied downstream. A trading halt makes a price unavailable. USD stablecoins
 * are their peg; crypto is priced by `crypto` (Coinbase's books) when given; private companies
 * (pre-IPO tokens) by Jupiter, as on the Solana testnet. Other assets have no reference. Every
 * symbol is read at most once per `ttlMs`, however many callers ask, and concurrent callers share
 * one request. */
import { ReadCache } from "@conditional-stocks/shared/read-cache";
import {
  expireSpotPrice,
  SPOT_BATCH_SIZE,
  type SpotPrice,
  type SpotPricesResponse,
} from "@conditional-stocks/shared/spot-prices";
import { catalogAsset } from "@conditional-stocks/shared/token-catalog";
import type { CoinbaseCryptoPrices } from "./coinbase.ts";
import { midpoint, scaled } from "./decimal-price.ts";

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
export const JUPITER_PRICES_URL = "https://lite-api.jup.ag/price/v3";
/** Private companies Robinhood does not quote, priced by Jupiter's public price API from their
 * Solana mainnet pre-IPO tokens, as on the Solana testnet: the token and the issuer's UI
 * multiplier (shares per token), so a share costs the token's price / multiplier. */
export const JUPITER_REFERENCES: Readonly<Record<string, { mint: string; multiplier: number }>> = {
  OPENAI: { mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", multiplier: 1.4861347 },
  SPACEX: { mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", multiplier: 5 },
  KALSHI: { mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", multiplier: 1 },
  ANTHROPIC: { mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", multiplier: 1 },
};

export class RobinhoodSpotPrices implements SpotPriceSource {
  private quotes: ReadCache;
  private jupiterQuotes: ReadCache;

  constructor(
    private readonly chainId: number,
    private readonly base = ROBINHOOD_PRICES_URL,
    private readonly fetcher: Fetch = fetch,
    ttlMs = 2_000,
    private readonly crypto?: Pick<CoinbaseCryptoPrices, "quote">,
  ) {
    this.quotes = new ReadCache(ttlMs, 256);
    this.jupiterQuotes = new ReadCache(Math.max(ttlMs, 10_000), 16);
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

  /** Jupiter's USD prices of every mapped token, in one request per `ttlMs`. */
  private jupiter(): Promise<Map<string, number>> {
    return this.jupiterQuotes.get("all", async () => {
      const ids = Object.values(JUPITER_REFERENCES).map((r) => r.mint);
      const response = await this.fetcher(`${JUPITER_PRICES_URL}?ids=${ids.join(",")}`, {
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Jupiter prices returned ${response.status}`);
      }
      const text = await response.text();
      if (text.length > 64 * 1024) throw new Error("Oversized Jupiter price response");
      const body = JSON.parse(text) as Record<string, { usdPrice?: unknown } | null>;
      const prices = new Map<string, number>();
      for (const id of ids) {
        const price = body[id]?.usdPrice;
        if (typeof price === "number" && Number.isFinite(price) && price > 0) prices.set(id, price);
      }
      return prices;
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
          asset &&
          (asset.kind === "stock" || asset.kind === "etf") &&
          !JUPITER_REFERENCES[asset.symbol]
            ? [asset.symbol]
            : [],
        ),
      ),
    ];
    /** Crypto assets by their underlying's ticker ("CRYPTO:ETH" for WETH and ETH). */
    const cryptoOf = (asset: (typeof assets)[number]["asset"]) =>
      asset?.kind === "crypto" && asset.underlying?.startsWith("CRYPTO:")
        ? asset.underlying.slice("CRYPTO:".length)
        : null;
    const coins = this.crypto
      ? [...new Set(assets.flatMap(({ asset }) => cryptoOf(asset) ?? []))]
      : [];
    const jupiterWanted = assets.some(({ asset }) => asset && JUPITER_REFERENCES[asset.symbol]);
    const [quotes, coinQuotes, jupiter] = await Promise.all([
      Promise.all(
        symbols.map(
          async (symbol) => [symbol, await this.quote(symbol).catch(() => undefined)] as const,
        ),
      ).then((entries) => new Map(entries)),
      Promise.all(
        coins.map(
          async (coin) => [coin, await this.crypto?.quote(coin).catch(() => undefined)] as const,
        ),
      ).then((entries) => new Map(entries)),
      jupiterWanted
        ? this.jupiter().catch(() => new Map<string, number>())
        : new Map<string, number>(),
    ]);
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
      const reference = JUPITER_REFERENCES[asset.symbol];
      if (reference) {
        const usd = jupiter.get(reference.mint);
        if (usd === undefined) return none("unavailable", `jupiter:${asset.symbol}`);
        return expireSpotPrice(
          {
            ...none("available", `jupiter:${asset.symbol}`),
            priceUsd: usd / reference.multiplier,
            priceTimestamp: fetchedAt,
            fetchedAt,
          },
          now,
        );
      }
      if (kind === "crypto") {
        const coin = this.crypto ? cryptoOf(asset) : null;
        const quote = coin ? coinQuotes.get(coin) : undefined;
        if (!coin || !quote) return none("unavailable", coin ? `coinbase:${coin}-USD` : null);
        return expireSpotPrice(
          {
            ...none("available", `coinbase:${coin}-USD`),
            priceUsd: quote.price,
            priceTimestamp: Math.min(quote.at, fetchedAt),
            fetchedAt,
          },
          now,
        );
      }
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
