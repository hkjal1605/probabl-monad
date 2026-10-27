import { MarketDataError, object, RequestPacer } from "@conditional-stocks/market-data";
import { fetchJson } from "../fetch-json.ts";

/** What the ingestor reads from Kalshi; tests substitute their own. */
export interface KalshiSource {
  /** A market, its event and the event's metadata (artwork), as normalized together:
   * `{ market, event, eventMetadata? }`. */
  getMarket(ticker: string): Promise<unknown>;
  /** A market's order book (`GET /markets/{ticker}/orderbook`). */
  getOrderbook(ticker: string): Promise<unknown>;
}

const TICKER = /^[A-Z0-9][A-Z0-9._-]{0,127}$/;
/** Kalshi rate-limits its public API per address; market automation reads it from the same
 * host at half this rate. */
const READS_PER_SECOND = 6;
/** An event's artwork rarely changes, and its markets' metadata is polled every minute. */
const EVENT_METADATA_TTL_MS = 3_600_000;
const EVENT_METADATA_ENTRIES = 1_000;

/** Kalshi's public, keyless trade API (https://docs.kalshi.com). Reads are paced: a poll of
 * every live book or every market's metadata would otherwise arrive as one burst. */
export class OfficialKalshiSource implements KalshiSource {
  readonly #pacer = new RequestPacer(READS_PER_SECOND);
  /** Each event's metadata read, shared by its markets until it expires. */
  readonly #eventMetadata = new Map<string, { at: number; read: Promise<unknown> }>();

  constructor(readonly apiUrl: string) {}

  async getMarket(ticker: string): Promise<unknown> {
    const { market } = object(await this.#get(`/markets/${this.#ticker(ticker)}`), "response");
    const eventTicker = object(market, "market").event_ticker;
    if (typeof eventTicker !== "string" || !TICKER.test(eventTicker))
      throw new MarketDataError("INVALID_METADATA", "Kalshi market has no valid event ticker");
    const [response, eventMetadata] = await Promise.all([
      this.#get(`/events/${eventTicker}`),
      this.#metadataOf(eventTicker),
    ]);
    const { event } = object(response, "response");
    return eventMetadata ? { market, event, eventMetadata } : { market, event };
  }

  getOrderbook(ticker: string): Promise<unknown> {
    return this.#get(`/markets/${this.#ticker(ticker)}/orderbook`);
  }

  /** `GET /events/{ticker}/metadata`, or null when Kalshi cannot serve it: artwork is display
   * only, so it never fails a market's read, and a failure is not kept. */
  #metadataOf(eventTicker: string): Promise<unknown> {
    const cached = this.#eventMetadata.get(eventTicker);
    if (cached && Date.now() - cached.at < EVENT_METADATA_TTL_MS) return cached.read;
    const entry = { at: Date.now(), read: Promise.resolve<unknown>(null) };
    entry.read = this.#get(`/events/${eventTicker}/metadata`).catch(() => {
      if (this.#eventMetadata.get(eventTicker) === entry) this.#eventMetadata.delete(eventTicker);
      return null;
    });
    // Re-inserted, so the map's first key is the least recently read event.
    this.#eventMetadata.delete(eventTicker);
    this.#eventMetadata.set(eventTicker, entry);
    if (this.#eventMetadata.size > EVENT_METADATA_ENTRIES) {
      const oldest = this.#eventMetadata.keys().next().value;
      if (oldest !== undefined) this.#eventMetadata.delete(oldest);
    }
    return entry.read;
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
