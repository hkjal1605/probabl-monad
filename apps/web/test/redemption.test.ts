import { expect, test } from "bun:test";
import {
  canRedeem,
  holdsClaims,
  losingClaims,
  redemptionLines,
  redemptionUsd,
  resolvedOutcome,
} from "../src/lib/portfolio/redemption";
import type { MarketView, PositionView } from "../src/types/api";

const resolved = (payouts: [number, number] | null, lifecycle = "redeemable") =>
  ({
    id: "m",
    ticker: "COIN",
    lifecycle,
    payouts,
    base: { token: "COIN", decimals: 6, symbol: "COIN" },
    quoteToken: "USDG",
    quoteTokenDecimals: 6,
    quoteTokenMetadata: { symbol: "USDG" },
    spotReference: {
      status: "available",
      token: "COIN",
      priceUsd: 180,
      observedAt: new Date().toISOString(),
    },
  }) as unknown as MarketView;

/** A buy of COIN-YES with USDG: COIN-YES claims and the USDG-NO left from the split. */
const claims = (patch: Partial<PositionView> = {}) =>
  ({
    marketId: "m",
    baseTokenDecimals: 6,
    quoteTokenDecimals: 6,
    baseYes: "10000",
    baseNo: "0",
    quoteYes: "0",
    quoteNo: "1820000",
    ...patch,
  }) as PositionView;

test("a decided market redeems only the kind that pays; the losing kind needs no transaction", () => {
  const yes = resolved([1, 0]);
  expect(resolvedOutcome(yes)).toBe("YES");
  const lines = redemptionLines(yes, claims()) ?? [];
  expect(lines.map((line) => [line.symbol, line.plan.credit])).toEqual([["COIN", 10000n]]);
  expect(losingClaims(yes, claims())).toEqual(["1.82 USDG-NO"]);
  expect(redemptionUsd(yes, lines)).toBeCloseTo(1.8, 9);
  // NO won: the purchase is undone and the USDG comes back.
  const no = resolved([0, 1]);
  expect(redemptionLines(no, claims())?.map((line) => [line.symbol, line.plan.credit])).toEqual([
    ["USDG", 1820000n],
  ]);
  expect(losingClaims(no, claims())).toEqual(["0.0100 COIN-YES"]);
});

test("INVALID pays half of every claim, so both kinds redeem; a lone raw unit cannot", () => {
  const invalid = resolved([1, 1]);
  expect(resolvedOutcome(invalid)).toBe("INVALID");
  const lines = redemptionLines(invalid, claims()) ?? [];
  expect(lines.map((line) => [line.symbol, line.plan.credit])).toEqual([
    ["COIN", 5000n],
    ["USDG", 910000n],
  ]);
  expect(losingClaims(invalid, claims())).toEqual([]);
  expect(redemptionLines(invalid, claims({ baseYes: "1", quoteNo: "0" }))).toEqual([]);
});

test("Claims lists a resolved market only while something in it pays", () => {
  const yes = resolved([1, 0]);
  expect(holdsClaims(claims(), yes)).toBe(true);
  // Only the losing USDG-NO left: nothing to redeem, so the market leaves the list.
  expect(holdsClaims(claims({ baseYes: "0" }), yes)).toBe(false);
  expect(holdsClaims(claims({ baseYes: "0", quoteNo: "0" }), yes)).toBe(false);
  // Before redemption opens, or with no market data, every claim still lists.
  expect(holdsClaims(claims({ baseYes: "0" }), resolved(null, "awaiting-resolution"))).toBe(true);
  expect(holdsClaims(claims({ baseYes: "0" }), undefined)).toBe(true);
  expect(canRedeem(resolved([1, 0], "archived"))).toBe(true);
  expect(canRedeem(resolved(null))).toBe(false);
});
