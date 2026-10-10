import { expect, test } from "bun:test";
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
  // ETH's reference is Jupiter's, which this fetcher fails.
  expect(eth).toMatchObject({ status: "unavailable", priceUsd: null, source: "jupiter:ETH" });
  expect(unknown).toMatchObject({ status: "unmapped", priceUsd: null });
  // One Robinhood request per symbol, never for stablecoins or unknown tokens; crypto is
  // one Jupiter read.
  expect(requested.filter((url) => url.startsWith("https://rh.example/")).sort()).toEqual([
    "https://rh.example/rhj/prices/AMD",
    "https://rh.example/rhj/prices/NFLX",
    "https://rh.example/rhj/prices/TSLA",
  ]);
  expect(requested.filter((url) => url.startsWith("https://lite-api.jup.ag/"))).toHaveLength(1);
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

test("prices crypto and pre-IPO assets from one Jupiter read, per share", async () => {
  const requested: string[] = [];
  const prices = new RobinhoodSpotPrices(10143, "https://rh.example/rhj", async (url) => {
    requested.push(url);
    if (url.startsWith("https://lite-api.jup.ag/price/v3?ids="))
      return new Response(
        JSON.stringify({
          cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: { usdPrice: 82_000 },
          PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh: { usdPrice: 125 },
        }),
      );
    return new Response("{}", { status: 404 });
  });
  const response = await prices.getPrices([
    { token: token(1), symbol: "BTC" },
    { token: token(2), symbol: "SPACEX" },
    { token: token(3), symbol: "SOL" },
  ]);
  const [btc, spacex, sol] = response.prices;
  expect(btc).toMatchObject({ status: "available", priceUsd: 82_000, source: "jupiter:BTC" });
  // SpaceX PreStocks carry 5 shares per token.
  expect(spacex).toMatchObject({ status: "available", priceUsd: 25, source: "jupiter:SPACEX" });
  expect(sol).toMatchObject({ status: "unavailable", priceUsd: null, source: "jupiter:SOL" });
  // One Jupiter read, and Robinhood is never asked for assets it does not quote.
  expect(requested).toHaveLength(1);
});
