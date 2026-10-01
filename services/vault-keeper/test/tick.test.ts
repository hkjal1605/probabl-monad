import { expect, test } from "bun:test";
import type { TokenReader } from "@conditional-stocks/indexer";
import { fetchSpotPrices, spotPair } from "@conditional-stocks/operator";
import type { Address, PublicClient } from "viem";
import { Tick } from "../src/tick.ts";

const quote = "0x00000000000000000000000000000000000000a1" as Address;
const bases = [
  "0x00000000000000000000000000000000000000b1",
  "0x00000000000000000000000000000000000000b2",
] as Address[];

test("a round reads the spot prices once, each event once, the issuers once and the fees once", async () => {
  const calls = { spot: 0, events: [] as number[], issuers: 0, fees: 0 };
  const tick = new Tick({
    origin: "http://127.0.0.1",
    client: {
      estimateFeesPerGas: async () => {
        calls.fees++;
        return { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n };
      },
    } as unknown as PublicClient,
    tokens: {
      refreshLive: async () => {
        calls.issuers++;
        return [];
      },
    } as unknown as TokenReader,
    quote,
    bases,
    spotPrices: async (_origin, tokens) => {
      calls.spot++;
      expect(tokens).toEqual([quote, ...bases]);
      return { prices: [] } as never;
    },
    polymarket: async (_origin, market) => {
      calls.events.push(market);
      return { market };
    },
  });
  // Five vaults' markets on one event and one on another: prefetched, then read again.
  for (const market of [1, 2, 3, 4, 5]) tick.prefetch(market, "0xAA");
  tick.prefetch(6, "0xbb");
  const [, , event] = await Promise.all([
    tick.spotPrices(),
    tick.spotPrices(),
    tick.polymarket(3, "0xaa"),
    tick.polymarket(6, "0xBB"),
    tick.issuers(),
    tick.issuers(),
    tick.gasFees(),
  ]);
  expect(event).toEqual({ market: 1 });
  expect(calls).toEqual({ spot: 1, events: [1, 6], issuers: 1, fees: 1 });
  expect(await tick.gasFees()).toEqual({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n });
  expect(calls.fees).toBe(1);
});

test("without fee estimates every transaction estimates its own", async () => {
  const tick = new Tick({
    origin: "http://127.0.0.1",
    client: {
      estimateFeesPerGas: async () => {
        throw new Error("legacy chain");
      },
    } as unknown as PublicClient,
    tokens: {} as TokenReader,
    quote,
    bases,
  });
  expect(await tick.gasFees()).toBeUndefined();
});

test("spot prices are read in API-sized batches and paired per market", async () => {
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requested.push(url);
    const tokens = new URL(url).searchParams.get("tokens")!.split(",");
    return new Response(
      JSON.stringify({
        source: "robinhood",
        displayOnly: true,
        chainId: 1,
        asOf: 0,
        prices: tokens.map((token) => ({ token, priceUsd: 1 })),
      }),
    );
  }) as unknown as typeof fetch;
  try {
    const tokens = Array.from(
      { length: 120 },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as Address,
    );
    const all = await fetchSpotPrices("http://127.0.0.1", tokens);
    expect(requested).toHaveLength(3); // 50 + 50 + 20 tokens
    expect(all.prices.map((p) => p.token)).toEqual(tokens);
    const pair = spotPair(all, tokens[0]!, tokens[77]!);
    expect(pair.prices.map((p) => p.token)).toEqual([tokens[0]!, tokens[77]!]);
    // A token the response lacks leaves the pair short, which the reference check rejects.
    expect(spotPair(all, tokens[0]!, quote).prices).toHaveLength(1);
  } finally {
    globalThis.fetch = original;
  }
});
