import { expect, test } from "bun:test";
import { parsePriceRawX18, parseShareAmount } from "@conditional-stocks/domain";
import { groupMarkets, sortEventGroups } from "../src/lib/markets/presentation";
import { aggregateBook, marketsApi } from "../src/services/markets-api-service";
import { fixtureMarkets } from "./fixtures/protocol";

/** A market exactly as the indexer serves it (`marketView`). */
const indexed = (m = fixtureMarkets[0]!, patch: Record<string, unknown> = {}) => ({
  id: m.id,
  slug: m.slug,
  underlying: m.underlying,
  venue: m.venue,
  createdAt: m.createdAt ?? "2026-09-14T00:00:00.000Z",
  conditionId: m.venue.marketId,
  polymarketConditionId: m.mapping.conditionId,
  polymarketYesIndex: m.mapping.yesIndex,
  polymarketNoIndex: m.mapping.noIndex,
  state: 2,
  tradingOpen: String(Date.parse(m.tradingOpen) / 1000),
  tradingCutoff: String(Date.parse(m.cutoff) / 1000),
  priceTickRawX18: m.priceTickRawX18,
  baseStep: m.baseStep,
  makerFeeBps: m.fees.makerBps,
  takerFeeBps: m.fees.takerBps,
  makerRebateBps: m.makerRebateBps,
  quoteToken: m.quoteToken,
  quoteTokenDecimals: m.quoteTokenDecimals,
  quoteSymbol: "USDC",
  quoteName: "USD Coin",
  shareDecimals: m.shareDecimals,
  base: {
    token: m.base.token,
    decimals: m.base.decimals,
    symbol: "NVDA",
    name: "NVIDIA",
    live: m.base.live,
  },
  protocolVersion: 4,
  priceFormat: "raw-unit-ratio-x18",
  ...patch,
});

test("catalogue reads all books in one indexed batch and keeps one-sided executable prices", async () => {
  const originalFetch = globalThis.fetch;
  const markets = [
    fixtureMarkets[0]!,
    {
      ...fixtureMarkets[0]!,
      id: "00000000000000b2",
      venue: { ...fixtureMarkets[0]!.venue, marketId: "2" },
    },
  ].map((m, index) => ({
    ...m,
    createdAt: new Date(Date.UTC(2026, 8, 14 + index)).toISOString(),
  }));
  const paths: string[] = [];
  const orderbookView = { value: null as string | null };
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const path = url.pathname;
      paths.push(path);
      if (path === "/markets")
        return Response.json({
          // Raw quote units (6 decimals); the second market's volume is not counted yet.
          markets: markets.map((m, i) => indexed(m, { volume24h: i ? null : "1234500000" })),
        });
      if (path === "/orderbooks") {
        orderbookView.value = url.searchParams.get("view");
        return Response.json({
          books: Object.fromEntries(
            markets.map((m) => [
              m.id,
              {
                truncated: false,
                orders: [
                  {
                    branch: 0,
                    side: 1,
                    limitPriceRawX18: String(parsePriceRawX18("254.35", m)),
                    remaining: String(parseShareAmount("1", m)),
                  },
                ],
              },
            ]),
          ),
        });
      }
      if (path.endsWith("/polymarket"))
        return Response.json({
          metadata: {
            fetchedAtMs: String(Date.UTC(2026, 8, 14)),
            rawPayload: {
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.42","0.58"]',
            },
          },
        });
      throw new Error(`Unexpected request: ${path}`);
    }) as typeof fetch;
    const read = await marketsApi.liveMarkets();
    expect(read).toHaveLength(2);
    expect(read.every((m) => m.bookQuality === "available" && m.yes.bestAsk === 254.35)).toBe(true);
    expect(read.map((m) => m.createdAt)).toEqual(markets.map((m) => m.createdAt));
    expect(paths.filter((path) => path === "/orderbooks")).toHaveLength(1);
    expect(orderbookView.value).toBe("levels");
    expect(paths.filter((path) => path.endsWith("/polymarket"))).toHaveLength(1);
    expect(paths.some((path) => path.startsWith("/orderbook/"))).toBe(false);
    expect(read.every((market) => market.probability.value === 0.42)).toBe(true);
    // The indexer serves each market's 24-hour volume: no trade history is read for it.
    expect(read.map((market) => market.volume24h)).toEqual([1234.5, null]);
    expect(paths.some((path) => path.startsWith("/trades"))).toBe(false);
    const [first] = read;
    expect(first?.base.token).toBe(fixtureMarkets[0]!.base.token);
    expect(first?.yes.asks[0]?.quantity).toBe(1);
    // A catalogued stock symbol resolves its display identity and one asset key.
    expect(first?.ticker).toBe("NVDA");
    expect(first?.assetKey).toBe("asset:NVDA");
    expect(first?.assetMetadata?.name).toBe("NVIDIA");
    expect(first?.quoteTokenMetadata?.symbol).toBe("USDC");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("catalogue starts the compact books request without waiting for the markets response", async () => {
  const originalFetch = globalThis.fetch;
  let releaseMarkets: ((response: Response) => void) | undefined;
  let booksStarted = false;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/markets")
        return new Promise<Response>((resolve) => {
          releaseMarkets = resolve;
        });
      if (url.pathname === "/orderbooks") {
        booksStarted = true;
        return Response.json({ books: {} });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }) as typeof fetch;
    const read = marketsApi.liveMarkets();
    await Promise.resolve();
    expect(booksStarted).toBe(true);
    expect(releaseMarkets).toBeDefined();
    releaseMarkets?.(Response.json({ markets: [] }));
    expect(await read).toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("event ordering is newest-first by actual creation time and stable through depth changes", () => {
  const a = { ...fixtureMarkets[0]!, createdAt: "2026-09-14T10:00:00.000Z" };
  const b = {
    ...fixtureMarkets[0]!,
    id: "older-market",
    mapping: { ...fixtureMarkets[0]!.mapping, conditionId: "older-condition" },
    createdAt: "2026-09-13T10:00:00.000Z",
  };
  const first = sortEventGroups(groupMarkets([b, a]), "newest");
  expect(first.map((g) => g[0]?.id)).toEqual([a.id, b.id]);
  const deeper = { ...b, yes: { ...b.yes, depthUsd: 1_000_000 } };
  expect(sortEventGroups(groupMarkets([a, deeper]), "newest").map((g) => g[0]?.id)).toEqual([
    a.id,
    b.id,
  ]);
  expect(sortEventGroups(groupMarkets([a, b]), "oldest").map((g) => g[0]?.id)).toEqual([
    b.id,
    a.id,
  ]);
});

async function readOne(market: unknown) {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/markets") return Response.json({ markets: [market] });
      if (url.pathname === "/orderbooks") return Response.json({ books: {} });
      if (url.pathname.endsWith("/polymarket")) return Response.json({});
      throw new Error(`Unexpected request: ${url.pathname}`);
    }) as typeof fetch;
    return await marketsApi.liveMarkets();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("markets require v4 raw-unit semantics and a consistent base token", async () => {
  const [read] = await readOne(indexed());
  expect(read?.base).toMatchObject({
    token: fixtureMarkets[0]!.base.token,
    decimals: 18,
    symbol: "NVDA",
  });
  expect(read?.lifecycle).toBe("open");
  expect(read?.cutoff).toBe(fixtureMarkets[0]!.cutoff);
  expect(read?.fees).toEqual({ makerBps: 10, takerBps: 25 });
  expect(read?.makerRebateBps).toBe(2_000);
  // An API that does not serve the rebate yet means none.
  const [older] = await readOne(indexed(undefined, { makerRebateBps: undefined }));
  expect(older?.makerRebateBps).toBe(0);
  const live = fixtureMarkets[0]!.base.live;
  const bad = [
    indexed(undefined, { protocolVersion: 3 }),
    indexed(undefined, { priceFormat: "share-unit-ratio-x18" }),
    indexed(undefined, { quoteToken: "USDC" }),
    indexed(undefined, { base: { ...indexed().base, token: "NVDA" } }),
    indexed(undefined, { base: { ...indexed().base, decimals: 6 } }),
    indexed(undefined, { base: { ...indexed().base, live: { ...live, tradable: false } } }),
    indexed(undefined, {
      base: { ...indexed().base, live: { ...live, halt: "delisted", tradable: false } },
    }),
    // A market's fees must be whole bps within the exchange's 1,000 bps cap.
    indexed(undefined, { makerFeeBps: undefined }),
    indexed(undefined, { takerFeeBps: "25" }),
    indexed(undefined, { makerFeeBps: 1_001 }),
    indexed(undefined, { takerFeeBps: -1 }),
    indexed(undefined, { makerFeeBps: 2.5 }),
    // And its maker rebate whole bps of the taker fee, at most half of it.
    indexed(undefined, { makerRebateBps: 5_001 }),
    indexed(undefined, { makerRebateBps: 12.5 }),
    indexed(undefined, { makerRebateBps: "2000" }),
  ];
  for (const market of bad) await expect(readOne(market)).rejects.toThrow();
  // An issuer pause is shown, not hidden.
  const [paused] = await readOne(
    indexed(undefined, {
      base: {
        ...indexed().base,
        live: { ...live, paused: true, tradable: false, halt: "issuer-paused" },
      },
    }),
  );
  expect(paused?.base.live.halt).toBe("issuer-paused");
  // Uncatalogued tokens keep their on-chain symbol and group by token address.
  const [unknown] = await readOne(
    indexed(undefined, { base: { ...indexed().base, symbol: "ACME", name: "Acme" } }),
  );
  expect(unknown?.ticker).toBe("ACME");
  expect(unknown?.assetKey).toBe(`asset:${fixtureMarkets[0]!.base.token.toLowerCase()}`);
});

test("depth aggregates price levels and full orders in token units", () => {
  const m = fixtureMarkets[0]!;
  const price = String(parsePriceRawX18("10", m));
  const book = aggregateBook(
    [
      { branch: 0, side: 1, limitPriceRawX18: price, remaining: String(parseShareAmount("3", m)) },
      {
        branch: 0,
        side: 1,
        limitPriceRawX18: price,
        remaining: String(parseShareAmount("0.5", m)),
      },
      {
        branch: 0,
        side: 0,
        limitPriceRawX18: String(parsePriceRawX18("9", m)),
        remaining: String(parseShareAmount("4", m)),
      },
      { branch: 1, side: 0, limitPriceRawX18: price, remaining: "1" },
    ],
    0,
    m,
  );
  expect(book.asks).toEqual([{ priceExact: "10", price: 10, quantity: 3.5 }]);
  expect(book.bids).toEqual([{ priceExact: "9", price: 9, quantity: 4 }]);
  expect(book.bestAskExact).toBe("10");
  expect(book.spread).toBe(1);
});
