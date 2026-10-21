import { expect, test } from "bun:test";
import { chartLevels } from "../src/components/market/priceSeries";
import type { IndexedOrder } from "../src/types/api";
import { fixtureMarkets, fixtureState } from "./fixtures/protocol";

const market = fixtureMarkets[0]!;
const share = 10n ** 18n;
const unpriced = fixtureState.positions[0]!;
const position = {
  ...unpriced,
  // 3 YES (1 reserved by a resting sell) bought for $46.82 in all; 2 of 4 NO bought for $50 (the
  // rest came without a price).
  baseYes: `${2n * share}`,
  pricedYes: `${3n * share}`,
  costYes: "46820000",
  baseNo: `${4n * share}`,
  pricedNo: `${2n * share}`,
  costNo: "50000000",
};
const order = (patch: Partial<IndexedOrder>): IndexedOrder => ({
  ...fixtureState.orders[0]!,
  status: "open",
  filled: "0",
  ...patch,
});
const orders = [
  order({ id: "1", side: 0, branch: 0, limitPriceRawX18: "15000000", remaining: `${share}` }),
  order({ id: "2", side: 0, branch: 0, limitPriceRawX18: "15000000", remaining: `${share / 2n}` }),
  order({ id: "3", side: 1, branch: 1, limitPriceRawX18: "26000000", remaining: `${2n * share}` }),
  order({ id: "4", side: 1, branch: 0, limitPriceRawX18: "17000000", status: "filled" }),
  order({ id: "5", marketId: "other", limitPriceRawX18: "14000000", remaining: `${share}` }),
  order({
    id: "6",
    side: 1,
    branch: 0,
    fundingKind: 1,
    limitPriceRawX18: "17000000",
    remaining: `${share}`,
    reserved: `${share}`,
  }),
];

test("the chart draws each branch's average entry with the claims held, and resting orders", () => {
  expect(chartLevels(market, [position], orders, { entry: true, orders: true })).toEqual([
    // Held claims include those the resting sell reserves.
    {
      seriesId: "yes",
      price: 15.606666,
      colorToken: "positive",
      lineStyle: "dashed",
      tag: "Avg Entry",
      label: `3.00 ${market.ticker}-YES`,
    },
    {
      seriesId: "no",
      price: 25,
      colorToken: "danger",
      lineStyle: "dashed",
      tag: "Avg Entry",
      label: `4.00 ${market.ticker}-NO`,
    },
    // Orders at one branch, side and price share a line: their remaining quantities add up.
    {
      seriesId: "yes",
      price: 15,
      colorToken: "warning",
      lineStyle: "dotted",
      tag: "Buy",
      label: `1.50 ${market.ticker}-YES`,
    },
    {
      seriesId: "no",
      price: 26,
      colorToken: "warning",
      lineStyle: "dotted",
      tag: "Sell",
      label: `2.00 ${market.ticker}-NO`,
    },
    {
      seriesId: "yes",
      price: 17,
      colorToken: "warning",
      lineStyle: "dotted",
      tag: "Sell",
      label: `1.00 ${market.ticker}-YES`,
    },
  ]);
});

test("lines turned off, unpriced claims and no position draw nothing", () => {
  expect(chartLevels(market, [position], orders, { entry: false, orders: false })).toEqual([]);
  expect(
    chartLevels(market, [position], orders, { entry: true, orders: false }).map((l) => l.label),
  ).toEqual([`3.00 ${market.ticker}-YES`, `4.00 ${market.ticker}-NO`]);
  expect(
    chartLevels(market, [position], orders, { entry: false, orders: true }).map((l) => l.tag),
  ).toEqual(["Buy", "Sell", "Sell"]);
  // Claims from splits or transfers only (none priced) have no entry to draw.
  expect(chartLevels(market, [unpriced], [], { entry: true, orders: true })).toEqual([]);
  expect(chartLevels(market, [], [], { entry: true, orders: true })).toEqual([]);
});
