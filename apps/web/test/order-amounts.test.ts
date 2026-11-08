import { expect, test } from "bun:test";
import { stakeRawWithin, stakeText, stakeWithin } from "../src/lib/worlds/offer";

/** The books' fee on a price, as WorldBooks charges it (rounded up). */
const fee = (price: bigint, bps: number) => (price * BigInt(bps) + 9_999n) / 10_000n;

test("an order's fee comes out of it: a $20 order is a $19.80 stake and a $0.20 fee at 1%", () => {
  const stake = stakeRawWithin(20, 100);
  expect(stake).toBe(19_801_980n);
  expect(stake + fee(stake, 100)).toBe(20_000_000n);
  expect(stakeWithin(20, 100).toFixed(2)).toBe("19.80");
  expect((20 - stakeWithin(20, 100)).toFixed(2)).toBe("0.20");
});

test("the stake is the most an order buys: never more than the order, one unit more would be", () => {
  for (const bps of [0, 1, 37, 100, 200, 1_000])
    for (const amount of [1, 1.01, 9.99, 20, 33.33, 100, 257.5, 999.99, 1_000]) {
      const total = BigInt(Math.round(amount * 1_000_000));
      const stake = stakeRawWithin(amount, bps);
      expect(stake + fee(stake, bps)).toBeLessThanOrEqual(total);
      expect(stake + 1n + fee(stake + 1n, bps)).toBeGreaterThan(total);
    }
  // No fee: the whole order is the stake.
  expect(stakeRawWithin(50, 0)).toBe(50_000_000n);
  expect(stakeRawWithin(0, 100)).toBe(0n);
});

test("a stake goes to the API with at most six decimals and no trailing zeros", () => {
  expect(stakeText(stakeWithin(20, 100))).toBe("19.80198");
  expect(stakeText(100)).toBe("100");
  expect(stakeText(12.5)).toBe("12.5");
});
