import { expect, test } from "bun:test";
import { decimalInput, parseAmountInput } from "../src/lib/format/amount-input";
import { quantityForSpend } from "../src/lib/trading/entry";
import type { MarketView } from "../src/types/api";
import { fixtureMarkets } from "./fixtures/protocol";

test("typed numbers read the way people write them", () => {
  for (const [typed, exact] of [
    ["10", "10"],
    [" 10 ", "10"],
    ["1,000", "1000"],
    ["12,345.67", "12345.67"],
    ["2,5", "2.5"],
    [".5", "0.5"],
    ["5.", "5"],
    ["007", "7"],
    ["0.050", "0.050"],
    ["1 000", "1000"],
  ] as const)
    expect(decimalInput(typed)).toBe(exact);
  for (const typed of ["", " ", ".", "-1", "1e3", "abc", "1.2.3", "1,00,0", "$10"])
    expect(decimalInput(typed)).toBeNull();
});

test("amounts parse to raw units with messages a person can act on", () => {
  expect(parseAmountInput("10", 6)).toBe(10_000_000n);
  expect(parseAmountInput("1,000.5", 6)).toBe(1_000_500_000n);
  // Trailing zeros past the token's decimals are not extra precision.
  expect(parseAmountInput("1.0000000", 6)).toBe(1_000_000n);
  expect(() => parseAmountInput("", 6)).toThrow("Enter an amount.");
  expect(() => parseAmountInput("ten", 6)).toThrow("Enter a number, like 10 or 2.5.");
  expect(() => parseAmountInput("0.0000001", 6, "USDG")).toThrow(
    "USDG allows at most 6 decimal places.",
  );
  expect(() => parseAmountInput("1.5", 0, "SHARES")).toThrow("SHARES takes whole numbers only.");
});

test("a spend converts at the order's price, never with a parser's error", () => {
  const market = fixtureMarkets[0] as MarketView;
  const quantity = quantityForSpend("10", "158.12", market);
  expect(Number(quantity)).toBeGreaterThan(0);
  expect(Number(quantity) * 158.12).toBeLessThanOrEqual(10);
  expect(quantityForSpend("1,000", "158.12", market)).toBe(
    quantityForSpend("1000", "158.12", market),
  );
  // No price yet (a market order before its book or reference price loads).
  expect(() => quantityForSpend("10", "", market)).toThrow("Set a price first.");
  expect(() => quantityForSpend("", "158.12", market)).toThrow("Enter an amount.");
  expect(() => quantityForSpend("0", "158.12", market)).toThrow("Enter an amount above 0.");
  expect(() => quantityForSpend("10", "158.1234567891", market)).toThrow("Prices allow at most");
  expect(() => quantityForSpend("0.000001", "158.12", market)).toThrow("smallest step");
});
