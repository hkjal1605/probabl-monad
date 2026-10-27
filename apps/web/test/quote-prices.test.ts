import { expect, test } from "bun:test";
import { parsePriceRawX18 } from "@conditional-stocks/domain";
import { parseQuotePrices, withQuotePrices } from "../src/services/quote-prices";
import { fixtureMarkets } from "./fixtures/protocol";

const market = fixtureMarkets[0]!;
const raw = (price: string) => parsePriceRawX18(price, market).toString();
const empty = { ...market.yes, bids: [], asks: [], bestBid: null, bestAsk: null };
const emptyBook = {
  ...market,
  yes: { ...empty, bestBidExact: null, bestAskExact: null, spread: null },
  no: {
    ...market.no,
    bids: [],
    asks: [],
    bestBid: null,
    bestAsk: null,
    bestBidExact: null,
    bestAskExact: null,
    spread: null,
  },
};

test("an empty book takes the makers' prices as its best bid and ask", () => {
  const quotes = parseQuotePrices({
    ttlMs: 30_000,
    prices: [{ market: 1, branch: 0, bid: raw("254"), ask: raw("256.5"), at: 1 }],
  });
  const [m] = withQuotePrices([emptyBook], quotes, true);
  expect(m?.yes).toMatchObject({
    bestBidExact: "254",
    bestAskExact: "256.5",
    bestBid: 254,
    bestAsk: 256.5,
    spread: 2.5,
    quote: { bid: "254", ask: "256.5" },
  });
  // NO has no maker price: unchanged.
  expect(m?.no).toEqual(emptyBook.no);
});

test("the better of the book and the makers' price stands; a stale copy changes nothing", () => {
  const quotes = parseQuotePrices({
    ttlMs: 30_000,
    // A bid above the book's 254.35, an ask above its 255.25.
    prices: [{ market: 1, branch: 0, bid: raw("254.95"), ask: raw("257"), at: 1 }],
  });
  const [m] = withQuotePrices([market], quotes, true);
  expect(m?.yes).toMatchObject({ bestBidExact: "254.95", bestAskExact: "255.25" });
  expect(m?.yes.bids).toEqual(market.yes.bids);
  expect(withQuotePrices([market], quotes, false)[0]).toBe(market);
  // Another market's prices leave this one alone.
  const other = parseQuotePrices({
    ttlMs: 30_000,
    prices: [{ market: 2, branch: 0, bid: null, ask: raw("1"), at: 1 }],
  });
  expect(withQuotePrices([market], other, true)[0]).toBe(market);
});

test("malformed prices are refused", () => {
  for (const prices of [
    [{ market: 1, branch: 2, bid: null, ask: null }],
    [{ market: "1", branch: 0, bid: null, ask: null }],
    [{ market: 1, branch: 0, bid: "-1", ask: null }],
    [{ market: 1, branch: 0, bid: "0", ask: null }],
  ])
    expect(() => parseQuotePrices({ ttlMs: 30_000, prices })).toThrow();
  expect(() => parseQuotePrices({ prices: [] })).toThrow();
});
