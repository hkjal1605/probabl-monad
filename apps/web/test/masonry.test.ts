import { expect, test } from "bun:test";
import { masonryLayout } from "../src/components/ui/masonry";

test("masonry fills the first row in order, then puts each item below the shortest column", () => {
  expect(masonryLayout([100, 50, 80, 40, 40], 3, 12)).toEqual({
    placed: [
      { column: 0, top: 0 },
      { column: 1, top: 0 },
      { column: 2, top: 0 },
      // Column 1 ends first (50 + 12), then column 2 (80 + 12).
      { column: 1, top: 62 },
      { column: 2, top: 92 },
    ],
    height: 132,
  });
});

test("masonry breaks ties to the left, stacks a single column and skips empty items' gaps", () => {
  expect(masonryLayout([10, 10, 10, 10], 2, 12).placed).toEqual([
    { column: 0, top: 0 },
    { column: 1, top: 0 },
    { column: 0, top: 22 },
    { column: 1, top: 22 },
  ]);
  expect(masonryLayout([30, 20], 1, 12)).toEqual({
    placed: [
      { column: 0, top: 0 },
      { column: 0, top: 42 },
    ],
    height: 62,
  });
  expect(masonryLayout([0, 50], 1, 12)).toEqual({
    placed: [
      { column: 0, top: 0 },
      { column: 0, top: 0 },
    ],
    height: 50,
  });
  expect(masonryLayout([], 3, 12).height).toBe(0);
});
