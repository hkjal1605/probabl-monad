/** Kalshi's public, keyless trade API (https://docs.kalshi.com), read for the ladder jobs: a
 * series' open events and an event's strikes with their quotes. */

/** An open event of a series; strike ladders fix at `fixing`. */
export interface KalshiEvent {
  eventTicker: string;
  /** When the event's value is fixed (Kalshi's `strike_date`), in ms. */
  fixing: number;
}
/** One market of an event, with its YES quote in dollars. */
export interface KalshiStrike {
  ticker: string;
  status: string;
  /** "greater" and "greater_or_equal" are "above" strikes. */
  strikeType: string;
  bid: number;
  ask: number;
  openInterest: number;
}

const PAGES = 5;

export class KalshiApi {
  constructor(
    private readonly base: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async openEvents(series: string): Promise<KalshiEvent[]> {
    const events = await this.pages("events", { series_ticker: series, status: "open" }, 200);
    return events.flatMap((e) => {
      const fixing = Date.parse(String(e.strike_date ?? ""));
      return typeof e.event_ticker === "string" && Number.isFinite(fixing)
        ? [{ eventTicker: e.event_ticker, fixing }]
        : [];
    });
  }

  async strikes(eventTicker: string): Promise<KalshiStrike[]> {
    const markets = await this.pages(
      "markets",
      { event_ticker: eventTicker, status: "open" },
      1000,
    );
    return markets.flatMap((m) =>
      typeof m.ticker === "string"
        ? [
            {
              ticker: m.ticker,
              status: String(m.status ?? ""),
              strikeType: String(m.strike_type ?? ""),
              bid: Number(m.yes_bid_dollars ?? 0),
              ask: Number(m.yes_ask_dollars ?? 0),
              openInterest: Number(m.open_interest_fp ?? 0),
            },
          ]
        : [],
    );
  }

  /** A listing's items across its pages (`cursor`), at most `PAGES` of them. */
  private async pages(path: "events" | "markets", query: Record<string, string>, limit: number) {
    const items: Record<string, unknown>[] = [];
    let cursor = "";
    for (let page = 0; page < PAGES; page++) {
      const params = new URLSearchParams({ ...query, limit: String(limit) });
      if (cursor) params.set("cursor", cursor);
      const response = await this.fetcher(`${this.base}/${path}?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Kalshi /${path}: ${response.status}`);
      const body = (await response.json()) as Record<string, unknown>;
      const list = body[path];
      if (Array.isArray(list)) items.push(...(list as Record<string, unknown>[]));
      cursor = typeof body.cursor === "string" ? body.cursor : "";
      if (!cursor) break;
    }
    return items;
  }
}
