/** Venue history for the fit: each live leg's missing days come from its venue at the 20:00 UTC
 * cut (Kalshi's sparse hourly candles, Polymarket's price history), recorded days are kept, and
 * a leg already covered costs no request. */
import { describe, expect, test } from "bun:test";
import type { EventProbabilityRow } from "@conditional-stocks/db";
import { backfillProbabilities, type HistoryLeg, VenueHistory } from "../src/backfill.ts";
import { runFit } from "../src/fit.ts";

const DAY = 86_400;
const CUT = 20 * 3_600;
// 2026-11-04 12:00 UTC: the last cut passed is 2026-11-03 20:00.
const NOW = Date.parse("2026-11-04T12:00:00Z");
const TO_DAY = Math.floor((NOW / 1000 - CUT) / DAY);
const CONDITION = `0x${"ab".repeat(32)}`;
const KALSHI = `0x${"cd".repeat(32)}`;

/** A fetch answering from `routes` (by path prefix), recording every URL. */
function venue(routes: Record<string, (url: URL) => unknown>) {
  const urls: URL[] = [];
  const fetcher = (async (input: string) => {
    const url = new URL(input);
    urls.push(url);
    const route = Object.keys(routes).find((p) => url.pathname.startsWith(p));
    if (!route) return new Response("{}", { status: 404 });
    return Response.json(routes[route]!(url));
  }) as unknown as typeof fetch;
  return {
    urls,
    history: new VenueHistory(
      { gamma: "https://gamma.test", clob: "https://clob.test", kalshi: "https://kalshi.test/v2" },
      fetcher,
    ),
  };
}
const polymarketLeg: HistoryLeg = {
  condition: CONDITION,
  source: "polymarket",
  marketId: "42",
  yesIndex: 2,
};
const kalshiLeg: HistoryLeg = {
  condition: KALSHI,
  source: "kalshi",
  marketId: "KXFED-27APR-T5.50",
  yesIndex: 1,
};

describe("venue history", () => {
  test("Polymarket: the YES token's last price at or before each cut", async () => {
    const { history, urls } = venue({
      "/markets/42": () => ({
        conditionId: CONDITION,
        clobTokenIds: JSON.stringify(["111", "222"]),
      }),
      "/prices-history": (url) => {
        const start = Number(url.searchParams.get("startTs"));
        const end = Number(url.searchParams.get("endTs"));
        // Hourly prices, missing the day before the last.
        const out: { t: number; p: number }[] = [];
        for (let t = Math.ceil(start / 3_600) * 3_600; t <= end; t += 3_600)
          if (Math.floor(t / DAY) !== TO_DAY - 1) out.push({ t, p: 0.3 + (t % DAY) / DAY / 10 });
        return { history: out };
      },
    });
    const rows = await history.daily(polymarketLeg, TO_DAY - 2, TO_DAY);
    // The YES outcome is index set 2: the second token.
    expect(
      urls
        .filter((u) => u.pathname === "/prices-history")
        .every((u) => u.searchParams.get("market") === "222"),
    ).toBe(true);
    // Each cut's own price; the day with none takes the last price within the day before its
    // cut (23:00 the day before).
    expect(rows.map((r) => r.minute * 60)).toEqual([
      (TO_DAY - 2) * DAY + CUT,
      (TO_DAY - 2) * DAY + 23 * 3_600,
      TO_DAY * DAY + CUT,
    ]);
    expect(rows[0]!.mid).toBe(Math.round((0.3 + CUT / DAY / 10) * 1e6));
    expect(rows.every((r) => r.spread === null)).toBe(true);
  });

  test("Kalshi: the midpoint and spread of the last candle at or before each cut", async () => {
    const candle = (t: number, bid: string, ask: string) => ({
      end_period_ts: t,
      yes_bid: { close_dollars: bid },
      yes_ask: { close_dollars: ask },
      price: { previous_dollars: "0.83" },
    });
    const { history, urls } = venue({
      "/v2/markets/": () => ({ market: { event_ticker: "KXFED-27APR" } }),
      "/v2/events/": () => ({ event: { series_ticker: "KXFED" }, markets: [] }),
      "/v2/series/KXFED/markets/KXFED-27APR-T5.50/candlesticks": () => ({
        ticker: "KXFED-27APR-T5.50",
        // Sparse: an active hour before one cut, one exactly at another, none for a day.
        candlesticks: [
          candle((TO_DAY - 2) * DAY + CUT - 5 * 3_600, "0.40", "0.44"),
          candle((TO_DAY - 1) * DAY + CUT, "0.45", "0.47"),
          candle(TO_DAY * DAY + CUT + 3_600, "0.90", "0.95"),
        ],
      }),
    });
    const rows = await history.daily(kalshiLeg, TO_DAY - 2, TO_DAY);
    expect(rows).toEqual([
      {
        condition: KALSHI,
        minute: ((TO_DAY - 2) * DAY + CUT - 5 * 3_600) / 60,
        mid: 420_000,
        spread: 40_000,
      },
      { condition: KALSHI, minute: ((TO_DAY - 1) * DAY + CUT) / 60, mid: 460_000, spread: 20_000 },
      // The last day has no candle within the day before its cut (yesterday's is a day old).
    ]);
    const candles = urls.filter((u) => u.pathname.endsWith("/candlesticks"));
    expect(candles.every((u) => u.searchParams.get("period_interval") === "60")).toBe(true);
  });
});

describe("backfill", () => {
  test("fills only missing days, and skips a leg whose days are recorded", async () => {
    const recorded: EventProbabilityRow[] = [];
    // The Polymarket leg has 110 of 120 days; the Kalshi leg one.
    for (let d = TO_DAY - 109; d <= TO_DAY; d++)
      recorded.push({
        condition: CONDITION,
        minute: (d * DAY + CUT) / 60,
        mid: 300_000,
        spread: 10_000,
      });
    recorded.push({
      condition: KALSHI,
      minute: (TO_DAY * DAY + CUT - 60) / 60,
      mid: 500_000,
      spread: 10_000,
    });
    const written: EventProbabilityRow[] = [];
    const db = {
      dailyEventProbabilities: async () => recorded,
      recordEventProbabilities: async (rows: readonly EventProbabilityRow[]) =>
        void written.push(...rows),
    };
    const asked: string[] = [];
    const history = {
      daily: async (leg: HistoryLeg, from: number, to: number) => {
        asked.push(leg.source);
        const rows: EventProbabilityRow[] = [];
        for (let d = from; d <= to; d++)
          rows.push({
            condition: leg.condition,
            minute: (d * DAY + CUT) / 60,
            mid: 400_000,
            spread: 20_000,
          });
        return rows;
      },
    };
    const result = await backfillProbabilities({
      db: db as never,
      legs: [polymarketLeg, kalshiLeg, { ...kalshiLeg }],
      history,
      nowMs: NOW,
      log: () => {},
    });
    // The Polymarket leg is covered (≥ 90%): no request. The Kalshi leg's day is kept.
    expect(asked).toEqual(["kalshi"]);
    expect(result).toEqual({ legs: 1, rows: 119 });
    expect(written.some((r) => r.minute === (TO_DAY * DAY + CUT) / 60)).toBe(false);
  });

  test("the fit reads one row per condition and day, and five-minute rows only for gaps", async () => {
    const calls: [string, ...unknown[]][] = [];
    const db = {
      dailyEventProbabilities: async (...args: unknown[]) => {
        calls.push(["daily", ...args]);
        return [];
      },
      eventProbabilityHistory: async (...args: unknown[]) => {
        calls.push(["minutes", ...args]);
        return [];
      },
      putEventVolatilities: async () => {},
      putWorldCorrelations: async () => {},
      putWorldVols: async () => {},
      putWorldGaps: async () => {},
    };
    await runFit({
      db: db as never,
      client: {} as never,
      conditions: [CONDITION, KALSHI],
      underlyings: [],
      log: () => {},
      nowMs: NOW,
    });
    // Event-only books need no minutes at all.
    expect(calls.map(([name]) => name)).toEqual(["daily"]);
  });
});
