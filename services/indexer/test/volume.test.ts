import { expect, test } from "bun:test";
import { DailyVolume, WINDOW_MINUTES, windowStart } from "../src/volume.ts";

const MINUTE = 60_000;
/** A clock at the start of minute `m`, and a block time inside minute `m`. */
const at = (m: number) => m * MINUTE;
const time = (m: number) => BigInt(m * 60 + 30);
const NOW = 30_000_000; // A minute number.

test("sums each market's trades over the 24 hours before the current minute, and that minute", () => {
  const v = new DailyVolume();
  v.seed([], at(NOW));
  v.add(1, time(NOW - WINDOW_MINUTES), 5n, at(NOW));
  v.add(1, time(NOW - 10), 7n, at(NOW));
  v.add(2, time(NOW - 10), 3n, at(NOW));
  v.add(1, time(NOW), 11n, at(NOW));
  expect([...v.window(at(NOW))]).toEqual([
    [1, 23n],
    [2, 3n],
  ]);
  // A minute later the oldest bucket leaves the window; a market without trades leaves the map.
  expect([...v.window(at(NOW + 1))]).toEqual([
    [1, 18n],
    [2, 3n],
  ]);
  expect([...v.window(at(NOW + WINDOW_MINUTES - 9))]).toEqual([[1, 11n]]);
  expect(v.window(at(NOW + WINDOW_MINUTES + 1)).size).toBe(0);
});

test("trades already outside the window, empty fills and a clock stepping back are never counted", () => {
  const v = new DailyVolume();
  v.add(1, time(NOW - WINDOW_MINUTES - 1), 100n, at(NOW));
  v.add(1, time(NOW), 0n, at(NOW));
  expect(v.window(at(NOW)).size).toBe(0);
  v.add(1, time(NOW - 5), 4n, at(NOW));
  v.window(at(NOW + WINDOW_MINUTES));
  // The clock moves back: a trade in that evicted bucket's minute is not counted into it.
  v.add(1, time(NOW - 5), 9n, at(NOW));
  expect(v.window(at(NOW + WINDOW_MINUTES)).size).toBe(0);
});

test("earlier runs' trades are seeded as older buckets, whenever the read arrives", () => {
  const v = new DailyVolume();
  // This run finalizes trades before the seed read returns.
  v.add(1, time(NOW - 3), 10n, at(NOW));
  v.add(2, time(NOW - 2), 20n, at(NOW));
  expect(v.ready).toBe(false);
  v.seed(
    [
      { market: 1, minute: NOW - 100, quote: 1n },
      { market: 2, minute: NOW - 50, quote: 2n },
      { market: 1, minute: NOW - 30, quote: 3n },
      // Outside the window, or empty: ignored.
      { market: 3, minute: NOW - WINDOW_MINUTES - 1, quote: 1_000n },
      { market: 3, minute: NOW - 1, quote: 0n },
    ],
    at(NOW),
  );
  expect(v.ready).toBe(true);
  expect([...v.window(at(NOW))]).toEqual([
    [1, 14n],
    [2, 22n],
  ]);
  // The seeded buckets, being older, leave the window first.
  expect([...v.window(at(NOW - 99 + WINDOW_MINUTES))]).toEqual([
    [1, 13n],
    [2, 22n],
  ]);
  expect([...v.window(at(NOW - 29 + WINDOW_MINUTES))]).toEqual([
    [1, 10n],
    [2, 20n],
  ]);
  expect(windowStart(at(NOW))).toBe(NOW - WINDOW_MINUTES);
});
