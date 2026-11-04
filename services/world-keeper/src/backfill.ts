/** Venue probability history for the fit (docs/version-2-plan.md §10.3): an event that joined a
 * book recently has too few recorded days for a correlation fit (30 effective samples), so the
 * nightly fit first fills each live leg's missing days from its venue, one row per day at the
 * fit's 20:00 UTC cut. Recorded minutes win: a day already recorded is never overwritten.
 *
 * - Polymarket: the CLOB's `prices-history` of the leg's YES token (found on Gamma), hourly, the
 *   last price at or before each cut. Its spread is unknown (null).
 * - Kalshi: the market's hourly candlesticks (the series is found from its event), the bid–ask
 *   midpoint and spread of the last candle closing at or before the cut. Kalshi omits hours
 *   without activity, and its daily candles close at midnight New York, not at the cut. */
import type { Database, EventProbabilityRow } from "@conditional-stocks/db";
import { RequestPacer } from "@conditional-stocks/market-data";

const DAY = 86_400;
const CUT = 20 * 3_600;
/** Chunks of history per request (both venues refuse long ranges at hourly resolution). */
const CHUNK = 15 * DAY;

export interface HistoryLeg {
  condition: string;
  source: "polymarket" | "kalshi";
  /** Gamma's market id, or the Kalshi ticker. */
  marketId: string;
  /** The index set of the condition's YES outcome (1 or 2). */
  yesIndex: number;
}
export interface VenueEndpoints {
  gamma: string;
  clob: string;
  kalshi: string;
}
export const VENUE_ENDPOINTS: VenueEndpoints = {
  gamma: "https://gamma-api.polymarket.com",
  clob: "https://clob.polymarket.com",
  kalshi: "https://api.elections.kalshi.com/trade-api/v2",
};

const cutOf = (day: number) => day * DAY + CUT;
const x6 = (p: number) => Math.round(Math.min(1, Math.max(0, p)) * 1e6);

export class VenueHistory {
  private readonly polymarket = new RequestPacer(5);
  /** Kalshi limits reads per address; the ingestor and the ladder jobs share the host. */
  private readonly kalshi = new RequestPacer(2);

  constructor(
    private readonly endpoints: VenueEndpoints = VENUE_ENDPOINTS,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async json(pacer: RequestPacer, url: string): Promise<Record<string, unknown>> {
    for (let attempt = 1; ; attempt++) {
      const response = await pacer.run(() =>
        this.fetcher(url, { signal: AbortSignal.timeout(15_000) }),
      );
      if (response.status === 429 && attempt <= 3) {
        await Bun.sleep(1_000 * attempt);
        continue;
      }
      if (!response.ok) throw new Error(`${new URL(url).pathname}: ${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    }
  }

  /** One row per day in [fromDay, toDay] that the venue has a price for at the cut. */
  async daily(leg: HistoryLeg, fromDay: number, toDay: number): Promise<EventProbabilityRow[]> {
    return leg.source === "polymarket"
      ? this.polymarketDaily(leg, fromDay, toDay)
      : this.kalshiDaily(leg, fromDay, toDay);
  }

  private async polymarketDaily(leg: HistoryLeg, fromDay: number, toDay: number) {
    const market = await this.json(
      this.polymarket,
      `${this.endpoints.gamma}/markets/${encodeURIComponent(leg.marketId)}`,
    );
    const tokens = JSON.parse(String(market.clobTokenIds ?? "[]")) as string[];
    if (String(market.conditionId ?? "").toLowerCase() !== leg.condition.toLowerCase())
      throw new Error("Gamma's market is of another condition");
    const token = tokens[Math.log2(leg.yesIndex)];
    if (!token) throw new Error("No YES token");
    const points: { t: number; p: number }[] = [];
    for (let start = cutOf(fromDay) - DAY; start < cutOf(toDay); start += CHUNK) {
      const end = Math.min(start + CHUNK, cutOf(toDay));
      const params = new URLSearchParams({
        market: token,
        startTs: String(start),
        endTs: String(end),
        fidelity: "60",
      });
      const body = await this.json(
        this.polymarket,
        `${this.endpoints.clob}/prices-history?${params}`,
      );
      for (const h of (body.history as { t?: unknown; p?: unknown }[] | undefined) ?? [])
        if (typeof h.t === "number" && typeof h.p === "number") points.push({ t: h.t, p: h.p });
    }
    points.sort((a, b) => a.t - b.t);
    const rows: EventProbabilityRow[] = [];
    let i = -1;
    for (let day = fromDay; day <= toDay; day++) {
      const cut = cutOf(day);
      while (i + 1 < points.length && points[i + 1]!.t <= cut) i++;
      const point = points[i];
      // The last price within the day before the cut.
      if (!point || cut - point.t >= DAY) continue;
      rows.push({
        condition: leg.condition,
        minute: Math.floor(point.t / 60),
        mid: x6(point.p),
        spread: null,
      });
    }
    return rows;
  }

  private async kalshiDaily(leg: HistoryLeg, fromDay: number, toDay: number) {
    const ticker = encodeURIComponent(leg.marketId);
    const market = (await this.json(this.kalshi, `${this.endpoints.kalshi}/markets/${ticker}`))
      .market as { event_ticker?: string } | undefined;
    if (!market?.event_ticker) throw new Error("Kalshi market not found");
    const event = (
      await this.json(
        this.kalshi,
        `${this.endpoints.kalshi}/events/${encodeURIComponent(market.event_ticker)}`,
      )
    ).event as { series_ticker?: string } | undefined;
    if (!event?.series_ticker) throw new Error("Kalshi series not found");
    const series = encodeURIComponent(event.series_ticker);
    const flip = leg.yesIndex === 2;
    const candles: { t: number; bid: number; ask: number }[] = [];
    for (let start = cutOf(fromDay) - DAY; start < cutOf(toDay); start += CHUNK) {
      const end = Math.min(start + CHUNK, cutOf(toDay));
      const params = new URLSearchParams({
        start_ts: String(start),
        end_ts: String(end),
        period_interval: "60",
      });
      const body = await this.json(
        this.kalshi,
        `${this.endpoints.kalshi}/series/${series}/markets/${ticker}/candlesticks?${params}`,
      );
      for (const c of (body.candlesticks as Record<string, unknown>[] | undefined) ?? []) {
        const t = Number(c.end_period_ts);
        const bid = Number((c.yes_bid as { close_dollars?: string } | undefined)?.close_dollars);
        const ask = Number((c.yes_ask as { close_dollars?: string } | undefined)?.close_dollars);
        if (Number.isInteger(t) && bid >= 0 && ask > 0 && ask >= bid && ask <= 1)
          candles.push({ t, bid, ask });
      }
    }
    candles.sort((a, b) => a.t - b.t);
    const rows: EventProbabilityRow[] = [];
    let i = -1;
    for (let day = fromDay; day <= toDay; day++) {
      const cut = cutOf(day);
      while (i + 1 < candles.length && candles[i + 1]!.t <= cut) i++;
      const c = candles[i];
      if (!c || cut - c.t >= DAY) continue;
      const mid = (c.bid + c.ask) / 2;
      rows.push({
        condition: leg.condition,
        minute: Math.floor(c.t / 60),
        mid: x6(flip ? 1 - mid : mid),
        spread: x6(c.ask - c.bid),
      });
    }
    return rows;
  }
}

/** Fills each leg's missing days of the last `days` from its venue. Legs with most days
 * already recorded are skipped, so the venues are read once per new event, not every night. */
export async function backfillProbabilities(input: {
  db: Pick<Database, "dailyEventProbabilities" | "recordEventProbabilities">;
  legs: HistoryLeg[];
  history: Pick<VenueHistory, "daily">;
  days?: number;
  nowMs?: number;
  log: (event: string, detail?: Record<string, unknown>) => void;
}) {
  const days = input.days ?? 120;
  const nowMs = input.nowMs ?? Date.now();
  // The last cut already passed.
  const toDay = Math.floor((nowMs / 1000 - CUT) / DAY);
  const fromDay = toDay - days + 1;
  const legs = [
    ...new Map(input.legs.map((l) => [l.condition.toLowerCase(), l] as const)).values(),
  ];
  if (!legs.length) return { legs: 0, rows: 0 };
  const recorded = await input.db.dailyEventProbabilities(
    legs.map((l) => l.condition),
    fromDay * 1_440,
    toDay * 1_440 + CUT / 60,
  );
  const have = new Map<string, Set<number>>();
  for (const r of recorded) {
    const key = r.condition.toLowerCase();
    const set = have.get(key) ?? new Set();
    set.add(Math.floor((r.minute * 60 - CUT - 1) / DAY) + 1);
    have.set(key, set);
  }
  let fetched = 0,
    rows = 0;
  for (const leg of legs) {
    const known = have.get(leg.condition.toLowerCase()) ?? new Set();
    if (known.size >= days * 0.9) continue;
    try {
      const daily = (await input.history.daily(leg, fromDay, toDay)).filter(
        (r) => !known.has(Math.floor((r.minute * 60 - CUT - 1) / DAY) + 1),
      );
      fetched++;
      if (daily.length) await input.db.recordEventProbabilities(daily);
      rows += daily.length;
    } catch (error) {
      input.log("backfill-failed", {
        condition: leg.condition,
        source: leg.source,
        reason: (error as Error).message,
      });
    }
  }
  input.log("backfill-done", { legs: legs.length, fetched, rows });
  return { legs: fetched, rows };
}
