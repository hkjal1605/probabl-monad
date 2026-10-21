import { expect, test } from "bun:test";
import { agenda, calendarEvents, dayKey, strikeLabel } from "../src/lib/markets/calendar";
import type { MarketView } from "../src/types/api";
import { fixtureMarkets } from "./fixtures/protocol";

const base = fixtureMarkets[0] as MarketView;
const NOW = new Date(2026, 9, 21, 12, 0).getTime();
const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
let n = 0;
/** A market on its own event condition, `at` hours from now. */
function market(question: string, at: number, extra: Partial<MarketView> = {}): MarketView {
  n++;
  return {
    ...base,
    id: n.toString(16).padStart(16, "0"),
    ticker: extra.ticker ?? "MSTR",
    question,
    tradingOpen: hours(at - 20),
    cutoff: hours(at - 0.5),
    lifecycle: "open",
    mapping: {
      ...base.mapping,
      source: "kalshi",
      conditionId: `0x${n.toString(16).padStart(64, "0")}`,
    },
    event: { endTime: hours(at), series: "KXBTCD", eventTicker: "KXBTCD-26OCT2117", result: null },
    ...extra,
  };
}

test("strike labels read the level each venue question names", () => {
  expect(strikeLabel("Bitcoin price on Oct 23, 2026: $83,500 or above?")).toBe("≥ $83,500");
  expect(strikeLabel("Will Bitcoin reach $90,000 by December 31, 2026?")).toBe("↑ $90,000");
  expect(strikeLabel("Will Bitcoin dip to $70,000 by December 31, 2026?")).toBe("↓ $70,000");
  expect(
    strikeLabel("Will the gold close price be above 4134.99 USD/t.oz on October 23, 2026?"),
  ).toBe("> $4,134.99");
  expect(strikeLabel("Will the U.S. invade Iran before 2027?")).toBeNull();
});

test("a Kalshi ladder's strikes join one entry per fixing, each with its stocks; other events stand alone", () => {
  const strike = (level: string, ticker: string) =>
    market(`Bitcoin price on Oct 21, 2026: $${level} or above?`, 5, { ticker });
  const high = strike("83,250", "COIN"),
    low = strike("81,750", "MSTR");
  // A second stock on the low strike shares its condition.
  const lowEth = { ...low, id: "00000000000000ff", ticker: "ETH" };
  const fed = market("Will the Fed increase interest rates by 25 bps?", 24 * 40, {
    mapping: { ...base.mapping, source: "polymarket", conditionId: `0x${"f".repeat(64)}` },
    event: { endTime: hours(24 * 40), result: null },
  });
  const [ladder, event] = calendarEvents([high, low, lowEth, fed]);
  expect(ladder).toMatchObject({
    title: "Bitcoin 5 PM ET close",
    kind: "daily",
    topic: "Crypto",
    tickers: ["COIN", "ETH", "MSTR"],
  });
  expect(ladder?.strikes.map((s) => [s.label, s.markets.map((m) => m.ticker)])).toEqual([
    ["≥ $81,750", ["ETH", "MSTR"]],
    ["≥ $83,250", ["COIN"]],
  ]);
  expect(event).toMatchObject({ title: fed.question, kind: "event", topic: "Economy" });
});

test("the agenda lays events on the coming days, later ones by month, and what just resolved", () => {
  const soon = market("Bitcoin price on Oct 21, 2026: $82,000 or above?", 5);
  const overdue = market("Bitcoin price on Oct 20, 2026: $82,000 or above?", -2, {
    event: { endTime: hours(-2), series: "KXBTCD", eventTicker: "KXBTCD-26OCT2017", result: null },
  });
  const nextWeek = market("Will CPI rise more than 0.2% in October 2026?", 24 * 8, {
    event: { endTime: hours(24 * 8), series: "KXCPI", eventTicker: "KXCPI-26OCT", result: null },
  });
  const december = market("Will the Fed increase interest rates by 25 bps?", 24 * 50, {
    event: { endTime: hours(24 * 50), series: "KXFED", eventTicker: "KXFED-26DEC", result: null },
  });
  const done = market("Bitcoin price on Oct 20, 2026: $81,000 or above?", -20, {
    lifecycle: "resolved",
    event: { endTime: hours(-20), series: "KXBTCD", eventTicker: "KXBTCD-26OCT19", result: "yes" },
  });
  const laid = agenda(calendarEvents([soon, overdue, nextWeek, december, done]), NOW);
  expect(laid.days).toHaveLength(14);
  expect(laid.days[0]?.key).toBe(dayKey(NOW));
  // Today holds the overdue fixing (awaiting its result) and the one coming up.
  expect(laid.days[0]?.events.map((e) => e.at)).toEqual([
    Date.parse(hours(-2)),
    Date.parse(hours(5)),
  ]);
  expect(laid.days.find((d) => d.key === dayKey(Date.parse(hours(24 * 8))))?.events).toHaveLength(
    1,
  );
  expect(laid.later.map((m) => m.events.length)).toEqual([1]);
  expect(laid.resolved.map((e) => e.result)).toEqual(["yes"]);
});
