import { expect, test } from "bun:test";
import { emptyState } from "@conditional-stocks/evm-client/ledger";
import type { SpotPrice } from "@conditional-stocks/shared/spot-prices";
import { HISTORY_POINTS, PriceRecorder, priceHistory } from "../src/market-data/history.ts";

const NOW_MS = Date.UTC(2026, 9, 1, 12, 0, 2);
const NOW = Math.floor(NOW_MS / 1000);
const QUOTE = "0x00000000000000000000000000000000000000A1";
const TSLA = "0x00000000000000000000000000000000000000B1";
const AMD = "0x00000000000000000000000000000000000000B2";

const spot = (token: string, priceUsd: number, over: Partial<SpotPrice> = {}): SpotPrice => ({
  token,
  symbol: null,
  source: "robinhood:X",
  kind: "stock",
  status: "available",
  priceUsd,
  priceTimestamp: NOW - 5,
  fetchedAt: NOW,
  valuationCompatible: false,
  ...over,
});

test("records each open market's book midpoints and its stock's price per whole token", async () => {
  const s = emptyState(QUOTE);
  const market = (id: number, base: string, state = 2) =>
    s.markets.set(id, { id, base, state, cutoff: BigInt(NOW + 3_600), tick: 10n } as never);
  market(1, TSLA);
  market(2, AMD);
  market(3, AMD, 5); // Resolved: not recorded.
  const order = (key: string, branch: number, side: number, ticks: bigint) =>
    s.orders.set(key, {
      market: 1,
      branch,
      side,
      ticks,
      status: "open",
      expiry: BigInt(NOW + 600),
      owner: QUOTE,
      epoch: 0n,
    } as never);
  order("a", 0, 0, 100n);
  order("b", 0, 1, 120n);
  const asked: string[][] = [];
  const rows: unknown[] = [];
  await new PriceRecorder({
    indexer: {
      domain: "test",
      trading: () => s,
      tokens: {
        identity: new Map([[TSLA, { symbol: "TSLA" }]]),
        // Two economic shares per TSLA token.
        live: new Map([[TSLA, { multiplier: 2n * 10n ** 18n }]]),
      },
    } as never,
    prices: {
      getPrices: async (tokens) => {
        asked.push(tokens.map((t) => `${t.token}:${t.symbol}`));
        return {
          source: "robinhood",
          displayOnly: true,
          chainId: 1,
          asOf: NOW,
          // AMD's trading is halted: no spot is recorded for it.
          prices: [spot(TSLA, 100.5), spot(AMD, 600, { status: "unavailable", priceUsd: null })],
        };
      },
    },
    db: { recordPrices: async (_domain, minute) => void rows.push(...minute) },
  }).record(NOW_MS);
  // One batched reference read for the open markets' stocks.
  expect(asked).toEqual([[`${TSLA}:TSLA`, `${AMD}:null`]]);
  const minute = Math.floor(NOW_MS / 60_000);
  expect(rows).toEqual([
    { market: 1, minute, yes: 1_100n, no: null, spot: "201" },
    { market: 2, minute, yes: null, no: null, spot: null },
  ]);
});

test("a branch the RFQ makers price records the midpoint of the better bid and ask", async () => {
  const s = emptyState(QUOTE);
  for (const id of [1, 2])
    s.markets.set(id, {
      id,
      base: TSLA,
      state: 2,
      cutoff: BigInt(NOW + 3_600),
      tick: 10n,
    } as never);
  // Market 1's YES book: 1,000 bid, 1,200 ask.
  for (const [key, side, ticks] of [
    ["a", 0, 100n],
    ["b", 1, 120n],
  ] as const)
    s.orders.set(key, {
      market: 1,
      branch: 0,
      side,
      ticks,
      status: "open",
      expiry: BigInt(NOW + 600),
      owner: QUOTE,
      epoch: 0n,
    } as never);
  const rows: { market: number; yes: bigint | null; no: bigint | null }[] = [];
  await new PriceRecorder({
    indexer: {
      domain: "test",
      trading: () => s,
      tokens: { identity: new Map(), live: new Map() },
    } as never,
    prices: {
      getPrices: async () => ({
        source: "robinhood",
        displayOnly: true,
        chainId: 1,
        asOf: NOW,
        prices: [],
      }),
    },
    db: { recordPrices: async (_domain, minute) => void rows.push(...(minute as never[])) },
    quotes: () => [
      { market: 1, branch: 0, bid: 1_050n, ask: 1_250n, at: NOW_MS },
      { market: 1, branch: 1, bid: 900n, ask: 1_000n, at: NOW_MS },
      // One-sided: no midpoint.
      { market: 2, branch: 0, bid: null, ask: 500n, at: NOW_MS },
    ],
  }).record(NOW_MS);
  expect(rows.map(({ market, yes, no }) => ({ market, yes, no }))).toEqual([
    // YES: the makers' 1,050 bid and the book's 1,200 ask; NO: the makers' alone.
    { market: 1, yes: 1_125n, no: 950n },
    { market: 2, yes: null, no: null },
  ]);
});

test("histories cover their range in at most 360 points; `all` starts at the first record", async () => {
  const reads: [number, number][] = [];
  const db = {
    firstPriceMinute: async (_domain: string, market: number) => (market === 1 ? 1_000 : null),
    priceHistory: async (_domain: string, market: number, since: number, bucket: number) => {
      reads.push([since, bucket]);
      return [{ market, minute: since, yes: 5n, no: null, spot: "1.5" }];
    },
  };
  const now = 21_000 * 60_000;
  expect(await priceHistory(db, "test", 1, "1d", now)).toEqual({
    interval: 5 * 60,
    points: [{ time: (21_000 - 1_440) * 60, yes: "5", no: null, spot: 1.5 }],
  });
  await priceHistory(db, "test", 1, "1w", now);
  await priceHistory(db, "test", 1, "all", now);
  expect(reads).toEqual([
    [21_000 - 1_440, 5],
    [21_000 - 10_080, 29],
    [1_000, Math.ceil(20_001 / HISTORY_POINTS)],
  ]);
  // A market never recorded has no history and costs no range read.
  expect(await priceHistory(db, "test", 2, "all", now)).toEqual({ interval: 60, points: [] });
  expect(reads).toHaveLength(3);
});
