/** Crypto reference prices: the midpoint of Coinbase Exchange's best bid and ask on the asset's
 * USD book (`/products/{ASSET}-USD/ticker`, public and keyless). Robinhood's Stock Token API
 * prices no crypto. Every asset is read at most once per `ttlMs`, however many callers ask. */
import { ReadCache } from "@conditional-stocks/shared/read-cache";
import { midpoint, scaled } from "./decimal-price.ts";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const COINBASE_EXCHANGE_URL = "https://api.exchange.coinbase.com";
const ASSET = /^[A-Z0-9]{2,10}$/;

export class CoinbaseCryptoPrices {
  private quotes: ReadCache;

  constructor(
    private readonly base = COINBASE_EXCHANGE_URL,
    private readonly fetcher: Fetch = fetch,
    ttlMs = 2_000,
  ) {
    this.quotes = new ReadCache(ttlMs, 64);
  }

  /** The USD midpoint of a crypto asset ("ETH"), and when it was read (seconds): the bid and ask
   * are the live book's. */
  quote(asset: string): Promise<{ price: number; at: number }> {
    if (!ASSET.test(asset)) return Promise.reject(new Error("Invalid crypto asset"));
    return this.quotes.get(asset, async () => {
      const response = await this.fetcher(`${this.base}/products/${asset}-USD/ticker`, {
        headers: { "User-Agent": "probabl-api" },
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Coinbase ticker returned ${response.status}`);
      }
      const text = await response.text();
      if (text.length > 16 * 1024) throw new Error("Oversized Coinbase ticker");
      const body = JSON.parse(text) as { bid?: unknown; ask?: unknown };
      const bid = scaled(body.bid),
        ask = scaled(body.ask);
      if (bid === null || ask === null || bid <= 0n || ask < bid)
        throw new Error("Invalid Coinbase ticker");
      return { price: midpoint(bid, ask), at: Math.floor(Date.now() / 1000) };
    });
  }
}
