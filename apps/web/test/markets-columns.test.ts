import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { shortDate } from "../src/lib/format/display";
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
