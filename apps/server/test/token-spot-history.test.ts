/** A token's spot history for charts without a market (worlds): read from one of its markets'
 * recordings (an open one first), spot prices only, one read per market, range and minute. */
import { expect, test } from "bun:test";
import { Hono } from "hono";
import { mountMarketData } from "../src/market-data/routes.ts";

const NVDA = "0x00000000000000000000000000000000000000aa";
const markets = new Map([
  [1, { id: 1, base: NVDA, state: 3 }],
  [2, { id: 2, base: NVDA.toUpperCase().replace("0X", "0x"), state: 2 }],
  [3, { id: 3, base: NVDA, state: 3 }],
  [4, { id: 4, base: "0x00000000000000000000000000000000000000bb", state: 2 }],
]);

function app() {
  const reads: { market: number; first: number; bucket: number }[] = [];
  const server = new Hono();
  mountMarketData(server, {
    indexer: { domain: "test", trading: () => ({ markets }) } as never,
    prices: {} as never,
    events: (() => ({})) as never,
    probabilities: {} as never,
    db: {
      firstPriceMinute: async () => null,
      priceHistory: async (_: string, market: number, first: number, bucket: number) => {
        reads.push({ market, first, bucket });
        return [
          { minute: first, yes: null, no: null, spot: 201.5 },
          { minute: first + 1, yes: null, no: null, spot: null },
          { minute: first + 2, yes: null, no: null, spot: 203.25 },
        ];
      },
    } as never,
  });
  return { server, reads };
}

test("a token's history is its open market's recorded spot, only the prices it has", async () => {
  const { server, reads } = app();
  const response = await server.request(`/v1/tokens/${NVDA}/spot-history?range=1w`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { points: { time: number; price: number }[] };
  // Market 2 is NVDA's open one (the closed ones stopped recording).
  expect(reads.map((r) => r.market)).toEqual([2]);
  expect(body.points.map((p) => p.price)).toEqual([201.5, 203.25]);
  expect(body.points[1]!.time - body.points[0]!.time).toBe(120);
  // The same minute's read serves the next viewer.
  await server.request(`/v1/tokens/${NVDA}/spot-history?range=1w`);
  expect(reads).toHaveLength(1);
});

test("an unknown token or range is refused", async () => {
  const { server, reads } = app();
  expect((await server.request(`/v1/tokens/${"0x" + "cc".repeat(20)}/spot-history`)).status).toBe(
    404,
  );
  expect((await server.request(`/v1/tokens/nvda/spot-history`)).status).toBe(400);
  expect((await server.request(`/v1/tokens/${NVDA}/spot-history?range=5y`)).status).toBe(400);
  expect(reads).toEqual([]);
});
