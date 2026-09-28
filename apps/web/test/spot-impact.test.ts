import { expect, test } from "bun:test";
import type { SpotPrice } from "@conditional-stocks/shared/spot-prices";
import { spotImpactPercent } from "../src/lib/markets/presentation";
import { fixtureMarkets } from "./fixtures/protocol";

const now = 1_800_000_000_000;
const seed = fixtureMarkets[0];
if (!seed) throw new Error("Missing market fixture");
const spot: SpotPrice = {
  token: seed.base.token,
  symbol: "NVDA",
  source: "Equity.US.NVDA/USD",
  kind: "stock",
  valuationCompatible: false,
  status: "available",
  priceUsd: 100,
  priceTimestamp: now / 1000,
  fetchedAt: now / 1000,
};
const market = {
  ...seed,
  spotReference: spot,
  yes: { ...seed.yes, bestBid: 119, bestAsk: 121 },
  no: { ...seed.no, bestBid: 79, bestAsk: 81 },
};

test("each branch is compared to spot independently, assuming a $1 quote", () => {
  expect(spotImpactPercent(market, "YES", now)).toBe(20);
  expect(spotImpactPercent(market, "NO", now)).toBe(-20);
  expect(spotImpactPercent({ ...market, quoteToken: "any-quote" }, "YES", now)).toBe(20);
  expect(spotImpactPercent({ ...market, no: { ...market.no, bestAsk: null } }, "YES", now)).toBe(
    20,
  );
  expect(
    spotImpactPercent({ ...market, spotReference: { ...spot, priceUsd: 120 } }, "YES", now),
  ).toBe(0);
});

test("missing, stale, invalid or mismatched data never produces a spot impact", () => {
  for (const price of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(
      spotImpactPercent({ ...market, spotReference: { ...spot, priceUsd: price } }, "YES", now),
    ).toBeNull();
  }
  for (const status of ["stale", "unavailable"] as const) {
    expect(
      spotImpactPercent({ ...market, spotReference: { ...spot, status } }, "YES", now),
    ).toBeNull();
  }
  expect(
    spotImpactPercent(
      {
        ...market,
        spotReference: { ...spot, token: "0x0000000000000000000000000000000000000001" },
      },
      "YES",
      now,
    ),
  ).toBeNull();
  expect(spotImpactPercent(market, "YES", now + 61_000)).toBeNull();
  expect(spotImpactPercent({ ...market, bookQuality: "unavailable" }, "YES", now)).toBeNull();
  expect(
    spotImpactPercent({ ...market, yes: { ...market.yes, bestAsk: null } }, "YES", now),
  ).toBeNull();
  expect(
    spotImpactPercent({ ...market, yes: { ...market.yes, bestAsk: 1 } }, "YES", now),
  ).toBeNull();
});
