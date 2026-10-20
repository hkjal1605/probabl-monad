import { MarketDataError, object, RequestPacer } from "@conditional-stocks/market-data";
import { fetchJson } from "../fetch-json.ts";

/** What the ingestor reads from Kalshi; tests substitute their own. */
export interface KalshiSource {
  /** A market and its event, as normalized together: `{ market, event }`. */
  getMarket(ticker: string): Promise<unknown>;
  /** A market's order book (`GET /markets/{ticker}/orderbook`). */
  getOrderbook(ticker: string): Promise<unknown>;
}

const TICKER = /^[A-Z0-9][A-Z0-9._-]{0,127}$/;
/** Kalshi rate-limits its public API per address; market automation reads it from the same
 * host at half this rate. */
const READS_PER_SECOND = 6;

/** Kalshi's public, keyless trade API (https://docs.kalshi.com). Reads are paced: a poll of
 * every live book or every market's metadata would otherwise arrive as one burst. */
export class OfficialKalshiSource implements KalshiSource {
  readonly #pacer = new RequestPacer(READS_PER_SECOND);

  constructor(readonly apiUrl: string) {}

  async getMarket(ticker: string): Promise<unknown> {
    const { market } = object(await this.#get(`/markets/${this.#ticker(ticker)}`), "response");
    const eventTicker = object(market, "market").event_ticker;
    if (typeof eventTicker !== "string" || !TICKER.test(eventTicker))
      throw new MarketDataError("INVALID_METADATA", "Kalshi market has no valid event ticker");
    const { event } = object(await this.#get(`/events/${eventTicker}`), "response");
    return { market, event };
  }

  getOrderbook(ticker: string): Promise<unknown> {
    return this.#get(`/markets/${this.#ticker(ticker)}/orderbook`);
  }

  #ticker(ticker: string) {
    if (!TICKER.test(ticker))
      throw new MarketDataError("INVALID_REQUEST", "Kalshi ticker is invalid");
    return ticker;
  }

  #get(path: string) {
    return this.#pacer.run(() => fetchJson(`${this.apiUrl}${path}`, "Kalshi"));
  }
}
