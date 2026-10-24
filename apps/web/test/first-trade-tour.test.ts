import { expect, test } from "bun:test";
import {
  fullyQuoted,
  pickTourMarket,
  readTour,
  stepBeside,
  TOUR_KEY,
  tourPage,
  writeTour,
} from "../src/lib/first-trade-tour";
import {
  finishFirstTradeTour,
  skipFirstTradeTour,
  startFirstTradeTour,
  tourStore,
} from "../src/stores/first-trade-tour";

const memory = (initial?: string) => {
  const values = new Map<string, string>(initial ? [[TOUR_KEY, initial]] : []);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

test("progress round-trips through storage; anything else reads as never started", () => {
  const storage = memory();
  expect(readTour(storage)).toBeNull();
  writeTour(storage, { status: "active", step: "amount" });
  expect(readTour(storage)).toEqual({ status: "active", step: "amount" });
  writeTour(storage, { status: "skipped" });
  expect(readTour(storage)).toEqual({ status: "skipped" });
  for (const junk of ["{", '{"status":"active","step":"fly"}', '"done"', "null"])
    expect(readTour(memory(junk))).toBeNull();
  expect(readTour(null)).toBeNull();
});

test("blocked storage neither throws nor remembers", () => {
  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
  };
  expect(readTour(blocked)).toBeNull();
  expect(() => writeTour(blocked, { status: "done" })).not.toThrow();
});

test("steps run market, side, amount, submit", () => {
  expect(stepBeside("market", 1)).toBe("side");
  expect(stepBeside("submit", 1)).toBeNull();
  expect(stepBeside("amount", -1)).toBe("side");
  expect(stepBeside("market", -1)).toBeNull();
});

test("the tour points at the first market quoted on both branches, else the first row", () => {
  const quoted = fullyQuoted([
    { market: "7", branch: 0, bid: "1", ask: "2" },
    { market: "7", branch: 1, bid: "1", ask: "2" },
    // One branch only, or one side only: a market order could miss.
    { market: "3", branch: 0, bid: "1", ask: "2" },
    { market: "5", branch: 0, bid: null, ask: "2" },
    { market: "5", branch: 1, bid: "1", ask: "2" },
  ]);
  expect([...quoted]).toEqual(["7"]);
  const rows = [{ marketId: "3" }, { marketId: "5" }, { marketId: "7" }, { marketId: "9" }];
  expect(pickTourMarket(rows, quoted)).toEqual({ marketId: "7" });
  expect(pickTourMarket(rows, new Set())).toEqual({ marketId: "3" });
  expect(pickTourMarket([], quoted)).toBeNull();
});

test("asking for the tour starts it from the top, even after an earlier finish or skip", () => {
  skipFirstTradeTour();
  startFirstTradeTour();
  expect(tourStore.get()).toEqual({ status: "active", step: "market" });
  finishFirstTradeTour();
  startFirstTradeTour();
  expect(tourStore.get()).toEqual({ status: "active", step: "market" });
  // Declining never undoes a finished tour.
  finishFirstTradeTour();
  skipFirstTradeTour();
  expect(tourStore.get()).toEqual({ status: "done" });
});

test("the tour has steps on the markets list and market pages only", () => {
  expect(tourPage("/")).toBe("list");
  expect(tourPage("/category/daily")).toBe("list");
  expect(tourPage("/markets/nu-2105f594a980763f")).toBe("market");
  for (const page of ["/calendar", "/portfolio", "/vaults", "/learn", "/invites"])
    expect(tourPage(page)).toBeNull();
});
