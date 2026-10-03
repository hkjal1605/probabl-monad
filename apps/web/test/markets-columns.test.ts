import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { shortDate } from "../src/lib/format/display";
import { priceLines } from "../src/lib/markets/history";
import { eventMonogram } from "../src/lib/markets/presentation";
import { MarketsPageSkeleton } from "../src/modules/MarketsPageModule/components/MarketsPageSkeleton";
import { createUiStore } from "../src/stores/ui-store";
import { fixtureMarkets } from "./fixtures/protocol";

const first = fixtureMarkets[0];
if (!first) throw new Error("A fixture market is required");

test("close dates are short, with the year only when it is not this year's", () => {
  const now = new Date(2026, 5, 1);
  expect(shortDate(new Date(2026, 11, 31, 12).toISOString(), now)).toBe("Dec 31");
  expect(shortDate(new Date(2027, 0, 31, 12).toISOString(), now)).toBe("Jan 31, 2027");
  expect(shortDate("not a date", now)).toBe("—");
});

test("the Columns view is a market view, with its own loading table", () => {
  const store = createUiStore();
  store.getState().setFilters({ view: "Columns" });
  expect(store.getState().filters.view).toBe("Columns");
  const html = renderToStaticMarkup(createElement(MarketsPageSkeleton, { view: "Columns" }));
  for (const heading of [
    "Event / asset",
    "P(yes)",
    "If yes",
    "If no",
    "Impact",
    "24h vol",
    "Closes",
  ])
    expect(html).toContain(heading);
  expect(eventMonogram(first)).toBeTruthy();
});

test("a buy intent carries no quantity: the trader enters the amount", () => {
  const store = createUiStore();
  store.getState().setPrefill({ intent: "buy", marketId: first.id, branch: "NO", nonce: 1 });
  expect(store.getState().prefill).toEqual({
    intent: "buy",
    marketId: first.id,
    branch: "NO",
    nonce: 1,
  });
});

test("chart lines: recorded midpoints in display units and spot, each ending at its live value", () => {
  // Raw prices are quote per raw base x 1e18: 1e8 is $100 per whole token in 6-decimal quote.
  const lines = priceLines(
    [
      { time: 60, yes: "100000000", no: "120000000", spot: 110 },
      { time: 120, yes: null, no: "121000000", spot: null },
    ],
    first,
    { yes: 101, no: null, spot: 111.5 },
    180,
  );
  expect(lines.yes).toEqual([
    { time: 60, value: 100 },
    { time: 180, value: 101 },
  ]);
  // No live NO midpoint: the line ends at its last record.
  expect(lines.no).toEqual([
    { time: 60, value: 120 },
    { time: 120, value: 121 },
  ]);
  expect(lines.spot).toEqual([
    { time: 60, value: 110 },
    { time: 180, value: 111.5 },
  ]);
  // A live value no newer than the last record adds nothing.
  expect(
    priceLines(
      [{ time: 60, yes: null, no: null, spot: 110 }],
      first,
      { yes: null, no: null, spot: 9 },
      60,
    ).spot,
  ).toEqual([{ time: 60, value: 110 }]);
});
