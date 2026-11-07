/** A world started part by part on the worlds page: its date range and default date, and the spec
 * that carries it to the builder. */
import { expect, test } from "bun:test";
import { clampDate, monthAhead, weekdayFrom, worldDates } from "../src/lib/worlds/dates";
import { parseStart, specOf, startParam, stashStart, takeStart } from "../src/lib/worlds/start";
import type { LegEntry, LegState, StockState } from "../src/lib/worlds/types";

test("a month ahead keeps the day, or the month's last when it has none", () => {
  expect(monthAhead("2026-11-06")).toBe("2026-12-06");
  expect(monthAhead("2026-12-15")).toBe("2027-01-15");
  expect(monthAhead("2027-01-31")).toBe("2027-02-28");
  expect(monthAhead("2028-01-31")).toBe("2028-02-29");
  // Sunday, Dec 6 reads on Monday, Dec 7.
  expect(weekdayFrom(monthAhead("2026-11-06"))).toBe("2026-12-07");
});

test("the picker runs from tomorrow to the tenor less a day; the default date stays inside it", () => {
  const now = Date.parse("2026-11-06T15:00:00Z");
  const year = worldDates([], 365 * 86_400, now);
  expect(year).toEqual({ earliest: "2026-11-09", last: "2027-11-05", suggested: null });
  const short = worldDates([], 14 * 86_400, now);
  expect(clampDate("2026-12-07", short)).toBe(short.last);
  // After the last event is decided.
  expect(worldDates(["2026-11-20T23:00:00Z"], 365 * 86_400, now).suggested).toBe("2026-11-20");
});

const entry = (id: string): LegEntry => ({
  id,
  source: "polymarket",
  marketId: id,
  question: `Will ${id} happen?`,
  label: `${id} happens`,
  event: id,
  outcome: null,
  yes: 0.4,
  bid: 0.39,
  ask: 0.41,
  endTime: "2026-12-31T00:00:00Z",
  url: "https://polymarket.com",
  image: null,
  rules: "",
  exclusive: false,
  group: id,
  volume: 1,
  themes: [],
});
const legs: LegState[] = [
  { entry: entry("polymarket:1"), wantYes: true, note: null, alternatives: [] },
  { entry: entry("polymarket:2"), wantYes: false, note: null, alternatives: [] },
];
const stock: StockState = {
  underlying: "US:NVDA",
  symbol: "NVDA",
  name: "NVIDIA",
  direction: "above",
  strike: "210",
  date: "2026-12-07",
  spot: 200,
};

test("the spec rides the URL and reads back exactly; the parts shown travel in memory", () => {
  const param = stashStart(legs, stock);
  expect(parseStart(param)).toEqual(specOf(legs, stock));
  expect(startParam(parseStart(param)!)).toBe(param);
  expect(takeStart(param)?.legs).toBe(legs);
  expect(takeStart(startParam(specOf(legs, null)))).toBeNull();
  // Events only.
  expect(parseStart(startParam(specOf(legs, null)))?.stock).toBeNull();
});

test("a spec parameter that is not one is refused", () => {
  const ok = specOf(legs, stock);
  for (const bad of [
    "",
    "not json",
    JSON.stringify({ legs: [] }),
    JSON.stringify({ ...ok, legs: [...ok.legs, ok.legs[0]] }),
    JSON.stringify({
      ...ok,
      legs: Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, wantYes: true })),
    }),
    JSON.stringify({ ...ok, stock: { ...ok.stock, direction: "sideways" } }),
    JSON.stringify({ ...ok, stock: { ...ok.stock, strike: "-5" } }),
    JSON.stringify({ ...ok, stock: { ...ok.stock, date: "next week" } }),
    JSON.stringify({ ...ok, stock: { ...ok.stock, underlying: "nvda" } }),
  ])
    expect(parseStart(bad)).toBeNull();
});
