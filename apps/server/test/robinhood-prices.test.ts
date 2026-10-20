import { expect, test } from "bun:test";
import { CoinbaseCryptoPrices } from "../src/market-data/coinbase.ts";
import { RobinhoodSpotPrices } from "../src/market-data/robinhood.ts";

const token = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const quote = (symbol: string, bid: string, ask: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      quotes: [
        {
          tokenSymbol: symbol,
          bid,
          ask,
          currency: "USD",
          isTradingHalt: false,
          generatedAt: new Date().toISOString(),
          ...extra,
        },
      ],
    }),
  );

test("prices stocks at Robinhood's bid/ask midpoint, stablecoins at their peg, nothing else", async () => {
  const requested: string[] = [];
  const prices = new RobinhoodSpotPrices(46630, "https://rh.example/rhj", async (url) => {
    requested.push(url);
    if (url.endsWith("/TSLA")) return quote("TSLA", "357.68", "357.72");
    if (url.endsWith("/AMD")) return quote("AMD", "630.40", "630.90", { isTradingHalt: true });
    return new Response("{}", { status: 404 });
  });
  const response = await prices.getPrices([
    { token: token(1), symbol: "USDG" },
    { token: token(2), symbol: "TSLA" },
    { token: token(3), symbol: "TSLA" },
    { token: token(4), symbol: "AMD" },
    { token: token(5), symbol: "NFLX" },
    { token: token(6), symbol: "ETH" },
    { token: token(7), symbol: "UNKNOWN" },
  ]);
  expect(response.source).toBe("robinhood");
  expect(response.chainId).toBe(46630);
  const [usdg, tsla, tsla2, amd, nflx, eth, unknown] = response.prices;
  expect(usdg).toMatchObject({ status: "available", priceUsd: 1, source: "usd-peg" });
  expect(tsla).toMatchObject({ status: "available", priceUsd: 357.7, source: "robinhood:TSLA" });
  expect(tsla2!.priceUsd).toBe(357.7);
  // A trading halt, a failed read and an asset without a source are never priced.
  expect(amd).toMatchObject({ status: "unavailable", priceUsd: null });
  expect(nflx).toMatchObject({ status: "unavailable", priceUsd: null, source: "robinhood:NFLX" });
  expect(eth).toMatchObject({ status: "unavailable", priceUsd: null, source: null });
  expect(unknown).toMatchObject({ status: "unmapped", priceUsd: null });
  // One request per symbol, never for stablecoins, crypto or unknown tokens.
  expect(requested.sort()).toEqual([
    "https://rh.example/rhj/prices/AMD",
    "https://rh.example/rhj/prices/NFLX",
    "https://rh.example/rhj/prices/TSLA",
  ]);
});

test("callers within the cache window share one request per symbol", async () => {
  let reads = 0;
  const prices = new RobinhoodSpotPrices(
    46630,
    undefined,
    async () => {
      reads++;
      return quote("PLTR", "188.40", "188.53");
    },
    60_000,
  );
  const ask = () => prices.getPrices([{ token: token(9), symbol: "PLTR" }]);
  const results = await Promise.all([ask(), ask(), ask()]);
  await ask();
  expect(reads).toBe(1);
  expect(results.every((r) => r.prices[0]!.priceUsd === 188.465)).toBe(true);
});

test("rejects malformed quotes and never reports a price from the future", async () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const prices = new RobinhoodSpotPrices(46630, undefined, async (url) =>
    url.endsWith("/AMZN")
      ? quote("AMZN", "251.14", "251.39", { generatedAt: future })
      : quote("AAPL", "200", "199"),
  );
  const [amzn, aapl] = (
    await prices.getPrices([
      { token: token(10), symbol: "AMZN" },
      { token: token(11), symbol: "AAPL" },
    ])
  ).prices;
  expect(amzn!.priceTimestamp! <= Math.floor(Date.now() / 1000)).toBe(true);
  expect(amzn!.status).toBe("available");
  // An ask below the bid is not a quote.
  expect(aapl).toMatchObject({ status: "unavailable", priceUsd: null });
});

test("prices crypto at Coinbase's bid/ask midpoint, once per asset, wrapped tokens included", async () => {
  const requested: string[] = [];
  const coinbase = new CoinbaseCryptoPrices("https://cb.example", async (url) => {
    requested.push(url);
    if (url.endsWith("/ETH-USD/ticker"))
      return Response.json({ bid: "2431.67", ask: "2431.74", time: new Date().toISOString() });
    return new Response("{}", { status: 404 });
  });
  const prices = new RobinhoodSpotPrices(
    46630,
    "https://rh.example/rhj",
    async () => new Response("{}", { status: 404 }),
    undefined,
    coinbase,
  );
  const response = await prices.getPrices([
    { token: token(1), symbol: "WETH" },
    { token: token(2), symbol: "ETH" },
    { token: token(3), symbol: "cbBTC" },
  ]);
  const [weth, eth, cbbtc] = response.prices;
  expect(weth).toMatchObject({
    status: "available",
    priceUsd: 2431.705,
    source: "coinbase:ETH-USD",
  });
  expect(eth).toMatchObject({ status: "available", priceUsd: 2431.705 });
  // A failed read is never priced.
  expect(cbbtc).toMatchObject({
    status: "unavailable",
    priceUsd: null,
    source: "coinbase:BTC-USD",
  });
  expect(requested.sort()).toEqual([
    "https://cb.example/products/BTC-USD/ticker",
    "https://cb.example/products/ETH-USD/ticker",
  ]);
});
