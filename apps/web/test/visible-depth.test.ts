import { expect, test } from "bun:test";
import { depthLevels, visibleDepthPerSide } from "../src/lib/markets/visible-depth";

test("orderbook depth consumes only complete, symmetric rows", () => {
  expect(visibleDepthPerSide(336, 28, 28)).toBe(5);
  expect(visibleDepthPerSide(615, 28, 28)).toBe(9);
  expect(visibleDepthPerSide(616, 28, 28)).toBe(10);
});

test("orderbook depth remains safe before layout is measurable", () => {
  expect(visibleDepthPerSide(0, 28, 28)).toBe(1);
  expect(visibleDepthPerSide(Number.NaN, 28, 28)).toBe(1);
  expect(visibleDepthPerSide(336, 28, 0)).toBe(1);
});

test("depth accumulates from the best price and skips empty levels", () => {
  const level = (price: number, quantity: number) => ({
    priceExact: String(price),
    price,
    quantity,
  });
  const asks = [level(10, 2), level(11, 0), level(12, 3)];
  expect(depthLevels(asks, 5).map((l) => [l.price, l.cumulative])).toEqual([
    [10, 2],
    [12, 5],
  ]);
  // The visible row budget applies after skipping empty levels.
  expect(depthLevels(asks, 1).map((l) => l.price)).toEqual([10]);
});
