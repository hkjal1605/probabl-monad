import { describe, expect, test } from "bun:test";
import { kalshiConditionId } from "@conditional-stocks/market-data";
import { Logger } from "@conditional-stocks/shared";
import { getAddress, type PublicClient } from "viem";
import type { Admin, Evidence, Market } from "../src/admin.ts";
import { dailyLadders, weeklyLadders } from "../src/jobs/ladders.ts";
import {
  chooseRungs,
  inWindow,
  type Ladder,
  newYorkClock,
  planLadder,
  targetEvent,
} from "../src/ladders.ts";
import type { KalshiApi, KalshiEvent, KalshiStrike } from "../src/venues/kalshi-api.ts";

const HOUR = 3_600_000;
const MSTR = getAddress("0x00000000000000000000000000000000000000b1");
const COIN = getAddress("0x00000000000000000000000000000000000000b2");
const logger = new Logger({ service: "test", level: "silent" });
/** Tuesday Oct 20, 2026, 5 pm in New York (EDT), and that Friday's. */
const TUESDAY = Date.parse("2026-10-20T21:00:00Z");
const FRIDAY = Date.parse("2026-10-23T21:00:00Z");
const btc = (tokens: Ladder["tokens"]): Ladder => ({ series: "KXBTCD", fixing: "17:00", tokens });
const event = (fixing: number, ticker = "KXBTCD-26OCT2017"): KalshiEvent => ({
  eventTicker: ticker,
  fixing,
});
/** A strike ladder from 80,000 up in 250s, priced from 90% down by 10 points a rung. */
const strikes = (eventTicker: string): KalshiStrike[] =>
  Array.from({ length: 9 }, (_, i) => {
    const odds = 0.9 - i * 0.1;
    return {
      ticker: `${eventTicker}-T${80_000 + i * 250 - 0.01}`,
      status: "active",
      strikeType: "greater",
      bid: Number((odds - 0.01).toFixed(2)),
      ask: Number((odds + 0.01).toFixed(2)),
      openInterest: 100,
    };
  });
const market = (ticker: string, base: string, open: number): Market =>
  ({
    venue: { marketId: "1" },
    state: 2,
    tradingOpen: String(Math.floor(open / 1000)),
    tradingCutoff: "0",
    eventSource: "kalshi",
    eventConditionId: kalshiConditionId(ticker),
    baseToken: base,
    makerRebateBps: 0,
  }) as unknown as Market;
const creation = (ticker: string, base: string, open: number, status = "prepared") =>
  ({
    status,
    observations: [],
    envelope: {
      packetHash: `0x${ticker}`,
      packet: {
        kind: "market-creation",
        event: { source: "kalshi", marketId: ticker, conditionId: kalshiConditionId(ticker) },
        config: { baseToken: base, tradingOpen: String(Math.floor(open / 1000)) },
      },
    },
  }) as unknown as Evidence;

describe("ladder fixings", () => {
  test("New York's clock follows daylight saving", () => {
    expect(newYorkClock(TUESDAY)).toEqual({ weekday: "Tue", time: "17:00" });
    expect(newYorkClock(Date.parse("2026-12-01T22:00:00Z"))).toEqual({
      weekday: "Tue",
      time: "17:00",
    });
  });

  test("daily markets open within a day of a weekday fixing, with at least an hour to trade", () => {
    const ladder = btc([]);
    expect(inWindow("daily", ladder, TUESDAY, TUESDAY - 3 * HOUR)).toBe(true);
    expect(inWindow("daily", ladder, TUESDAY, TUESDAY - 25 * HOUR)).toBe(true);
    expect(inWindow("daily", ladder, TUESDAY, TUESDAY - 27 * HOUR)).toBe(false);
    // The cutoff is 30 minutes before the fixing; less than an hour of trading is left.
    expect(inWindow("daily", ladder, TUESDAY, TUESDAY - 80 * 60_000)).toBe(false);
    expect(
      inWindow("daily", ladder, TUESDAY + 4 * 24 * HOUR, TUESDAY + 4 * 24 * HOUR - 3 * HOUR),
    ).toBe(false);
    expect(inWindow("daily", { ...ladder, fixing: "14:00" }, TUESDAY, TUESDAY - 3 * HOUR)).toBe(
      false,
    );
  });

  test("weekly markets open two to seven days before a Friday fixing", () => {
    const ladder = btc([]);
    expect(inWindow("weekly", ladder, FRIDAY, FRIDAY - 75 * HOUR)).toBe(true);
    expect(inWindow("weekly", ladder, FRIDAY, FRIDAY - 33 * HOUR)).toBe(false);
    expect(inWindow("weekly", ladder, FRIDAY, FRIDAY - 8 * 24 * HOUR)).toBe(false);
    expect(inWindow("weekly", ladder, TUESDAY, TUESDAY - 75 * HOUR)).toBe(false);
    // The earliest due event is the target.
    const events = [event(FRIDAY + 7 * 24 * HOUR), event(FRIDAY), event(TUESDAY)];
    expect(targetEvent("weekly", ladder, events, FRIDAY - 75 * HOUR)?.fixing).toBe(FRIDAY);
    expect(targetEvent("daily", ladder, events, TUESDAY - 3 * HOUR)?.fixing).toBe(TUESDAY);
  });
});

describe("rungs", () => {
  test("the strikes nearest even odds, then either side, from tradable quotes only", () => {
    const list = strikes("E");
    const odds = (chosen: KalshiStrike[]) => chosen.map((s) => (s.bid + s.ask) / 2);
    expect(odds(chooseRungs(list, 3, new Set()))).toEqual([0.5, 0.3, 0.7]);
    expect(odds(chooseRungs(list, 2, new Set()))).toEqual([0.4, 0.6]);
    // A held rung covers its nearest target.
    const held = list[5]?.ticker ?? ""; // priced 40%
    expect(odds(chooseRungs(list, 2, new Set([held]), [held]))).toEqual([0.6]);
    // Excluded, wide, closed and "below" strikes are skipped; nothing outside 20–80% is chosen.
    const [, , , , even, below] = list.map((s) => s.ticker);
    const varied = list.map((s) =>
      s.ticker === below
        ? { ...s, strikeType: "less" }
        : s.ticker === even
          ? { ...s, ask: 0.7 }
          : s,
    );
    expect(odds(chooseRungs(varied, 1, new Set()))).toEqual([0.6]);
    expect(chooseRungs(list.slice(0, 1), 1, new Set())).toEqual([]);
  });
});

describe("planning a fixing", () => {
  const ladder = btc([
    { symbol: "MSTR", base: MSTR, rungs: 3 },
    { symbol: "COIN", base: COIN, rungs: 2 },
  ]);
  const fixing = event(FRIDAY, "KXBTCD-26OCT2317");
  const list = strikes(fixing.eventTicker);
  const tickerAt = (odds: number) =>
    list.find((s) => Math.abs((s.bid + s.ask) / 2 - odds) < 1e-9)?.ticker ?? "";

  test("each cadence counts its own markets on a shared event and leaves the other's strikes", () => {
    // MSTR's weekly market on the even strike opened Tuesday; COIN has an unfinished daily packet.
    const markets = [market(tickerAt(0.5), MSTR, FRIDAY - 75 * HOUR)];
    const evidence = [creation(tickerAt(0.4), COIN, FRIDAY - 20 * HOUR)];
    const [mstr, coin] = planLadder("daily", ladder, fixing, list, markets, evidence);
    // The even strike is the weekly market's: the next nearest (40% or 60%), then 30% and 70%.
    const daily = mstr?.specs.map((s) => s.marketId) ?? [];
    expect(daily).toHaveLength(3);
    expect(daily).not.toContain(tickerAt(0.5));
    expect(daily.slice(1)).toEqual([tickerAt(0.3), tickerAt(0.7)]);
    expect(coin?.specs.map((s) => s.marketId)).toEqual([tickerAt(0.4), tickerAt(0.6)]);
    expect(mstr?.specs[0]).toMatchObject({
      source: "kalshi",
      base: MSTR,
      cutoff: (FRIDAY - 30 * 60_000) / 1000,
    });
    const [weekly] = planLadder("weekly", ladder, fixing, list, markets, evidence);
    expect(weekly?.specs.map((s) => s.marketId)).toEqual([tickerAt(0.3), tickerAt(0.7)]);
    expect(weekly?.short).toBe(0);
  });
});

describe("ladder jobs", () => {
  /** An admin that records calls and creates every market it is asked to. */
  function fakeAdmin() {
    const calls: string[] = [];
    let next = 10;
    const fn =
      (name: string, value: (...args: never[]) => unknown) =>
      async (...args: never[]) => {
        calls.push(name);
        return value(...args);
      };
    const admin = {
      markets: fn("markets", () => []),
      evidence: fn("evidence", () => []),
      quote: fn("quote", () => "0x00000000000000000000000000000000000000c1"),
      fetchMetadata: fn("fetchMetadata", (_source: never, ticker: string) => ({
        snapshotId: ticker,
        normalized: {
          canonicalUrl: "https://kalshi.com/markets/kxbtcd",
          conditionId: kalshiConditionId(ticker),
          endTime: new Date(FRIDAY).toISOString(),
          rules: "rules",
        },
      })),
      prepare: fn("prepare", () => creation("x", MSTR, 0)),
      approve: fn("approve", () => creation("x", MSTR, 0, "approved")),
      execute: fn("execute", () => ({ action: "create-market", marketId: String(next++) })),
      lifecycle: fn("lifecycle", () => "0x1"),
      setMakerRebate: fn("setMakerRebate", () => "0x2"),
    };
    return { admin: admin as unknown as Admin, calls };
  }
  function fakeKalshi(events: KalshiEvent[]) {
    const calls: string[] = [];
    const kalshi = {
      openEvents: async (series: string) => {
        calls.push(`events:${series}`);
        return events;
      },
      strikes: async (ticker: string) => {
        calls.push(`strikes:${ticker}`);
        return strikes(ticker);
      },
    };
    return { kalshi: kalshi as unknown as KalshiApi, calls };
  }
  const context = (admin: Admin, kalshi: KalshiApi, ladders: Ladder[], cadence: string) => ({
    admin,
    kalshi,
    polygon: {} as PublicClient,
    vaults: [],
    ladders: {
      daily: cadence === "daily" ? ladders : [],
      weekly: cadence === "weekly" ? ladders : [],
    },
    execute: true,
    logger,
  });

  test("a fixing's markets are created once; later runs call neither Kalshi nor the API", async () => {
    const ladders = [btc([{ symbol: "MSTR", base: MSTR, rungs: 3 }])];
    const venue = fakeKalshi([event(FRIDAY, "KXBTCD-26OCT2317")]);
    const api = fakeAdmin();
    const realNow = Date.now;
    Date.now = () => FRIDAY - 75 * HOUR;
    try {
      await weeklyLadders.run(context(api.admin, venue.kalshi, ladders, "weekly"));
      expect(venue.calls).toEqual(["events:KXBTCD", "strikes:KXBTCD-26OCT2317"]);
      expect(api.calls.filter((c) => c === "execute")).toHaveLength(3);
      expect(api.calls.filter((c) => c === "lifecycle")).toHaveLength(3);
      venue.calls.length = 0;
      api.calls.length = 0;
      await weeklyLadders.run(context(api.admin, venue.kalshi, ladders, "weekly"));
      expect([...venue.calls, ...api.calls]).toEqual([]);
      // Nothing is due for the daily cadence that far ahead: one Kalshi read, no API call.
      await dailyLadders.run(context(api.admin, venue.kalshi, ladders, "daily"));
      expect([...venue.calls, ...api.calls]).toEqual(["events:KXBTCD"]);
    } finally {
      Date.now = realNow;
    }
  });

  test("a dry run creates nothing", async () => {
    const ladders = [btc([{ symbol: "COIN", base: COIN, rungs: 1 }])];
    const venue = fakeKalshi([event(TUESDAY)]);
    const api = fakeAdmin();
    const realNow = Date.now;
    Date.now = () => TUESDAY - 3 * HOUR;
    try {
      await dailyLadders.run({
        ...context(api.admin, venue.kalshi, ladders, "daily"),
        execute: false,
      });
      expect(api.calls).toEqual(["markets", "evidence"]);
    } finally {
      Date.now = realNow;
    }
  });
});
