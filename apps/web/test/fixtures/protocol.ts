/** Synthetic test responses only. Never imported by application runtime code. */
import type {
  BookLevel,
  IndexedOrder,
  MarketView,
  PositionView,
  TradeView,
} from "../../src/types/api";

export const fixtureAccount = "0xDe00000000000000000000000000000000000001";
export const FIXTURE_TOKENS = {
  quote: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  base: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
} as const;
/** Public market id and on-chain venue of the fixture market. */
export const FIXTURE_MARKET_ID = "00000000000000a1";
export const fixtureVenue = {
  chainId: 31337,
  exchange: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  marketId: "1",
};
const level = (price: string, quantity: number): BookLevel => ({
  priceExact: price,
  price: Number(price),
  quantity,
});
export const fixtureMarkets: MarketView[] = [
  {
    shareDecimals: 18,
    quoteTokenDecimals: 6,
    protocolVersion: 4,
    priceFormat: "raw-unit-ratio-x18",
    baseStep: "1000000000000000",
    priceTickRawX18: "10000",
    fees: { makerBps: 10, takerBps: 25 },
    makerRebateBps: 2_000,
    base: {
      token: FIXTURE_TOKENS.base,
      decimals: 18,
      symbol: "NVDA",
      name: "NVIDIA",
      live: {
        multiplier: "1000000000000000000",
        multiplierValue: 1,
        paused: false,
        tradable: true,
        halt: null,
      },
    },
    assetKey: "asset:NVDA",
    cutoff: "2027-01-15T08:20:00.000Z",
    description: "Test fixture only.",
    eventImpact: 37.400000000000034,
    id: FIXTURE_MARKET_ID,
    slug: `nvda-${FIXTURE_MARKET_ID}`,
    underlying: "US:NVDA",
    venue: fixtureVenue,
    lifecycle: "open",
    mapping: {
      conditionId: "0x0000000000000000000000000000000000000000000000000000000000beef01",
      noIndex: "2",
      source: "polymarket",
      sourceUrl: "/resolution?market=1#evidence-1",
      yesIndex: "1",
    },
    no: {
      bids: [level("216.95", 2), level("216.35", 3), level("215.75", 4)],
      asks: [level("217.85", 2), level("218.45", 3), level("219.05", 4)],
      bestBid: 216.95,
      bestAsk: 217.85,
      bestBidExact: "216.95",
      bestAskExact: "217.85",
      spread: 0.9000000000000057,
      depthUsd: 3913.2,
    },
    ordinaryReference: 236.82,
    probability: {
      ask: 0.58,
      bid: 0.56,
      value: 0.57,
      quality: "valid",
      observedAt: "2027-01-15T08:00:00.000Z",
    },
    question: "Is the test condition met?",
    quoteToken: FIXTURE_TOKENS.quote,
    residual: null,
    ticker: "NVDA",
    tradingOpen: "2027-01-15T07:59:00.000Z",
    volume24h: 0,
    yes: {
      bids: [level("254.35", 2), level("253.75", 3), level("253.15", 4)],
      asks: [level("255.25", 1), level("255.85", 3), level("256.45", 4), level("280", 1)],
      bestBid: 254.35,
      bestAsk: 255.25,
      bestBidExact: "254.35",
      bestAskExact: "255.25",
      spread: 0.9000000000000057,
      depthUsd: 4611.150000000001,
    },
  },
];
export const fixtureState: {
  orders: IndexedOrder[];
  trades: TradeView[];
  positions: PositionView[];
  balances: Record<string, string>;
} = {
  orders: [
    {
      maker: fixtureAccount,
      marketId: FIXTURE_MARKET_ID,
      branch: 0,
      side: 0,
      fundingKind: 0,
      tif: 0,
      quantity: "1000000000000000000",
      limitPriceRawX18: "256000000",
      expiry: "1800001199",
      maxFeeBps: 0,
      id: "1099511627776",
      filled: "1000000000000000000",
      remaining: "0",
      reserved: "0",
      status: "filled",
      confirmation: "confirmed",
      updatedBlock: "0",
    },
  ],
  trades: [
    {
      id: "0xabababababababababababababababababababababababababababababababab:3",
      marketId: FIXTURE_MARKET_ID,
      branch: 0,
      fillQuantity: "1000000000000000000",
      executionPriceRawX18: "255250000",
      blockTimestamp: "1800000000",
      takerOrderHash: "1099511627776",
      transactionHash: "0xabababababababababababababababababababababababababababababababab",
    },
  ],
  positions: [
    {
      marketId: FIXTURE_MARKET_ID,
      venue: fixtureVenue,
      conditionId: "1",
      shareDecimals: 18,
      quoteTokenDecimals: 6,
      protocolVersion: 4,
      baseToken: FIXTURE_TOKENS.base,
      baseTokenDecimals: 18,
      quoteYes: "1000000000",
      quoteNo: "1255250000",
      baseYes: "5000000000000000000",
      baseNo: "5000000000000000000",
      pricedYes: "0",
      pricedNo: "0",
      costYes: "0",
      costNo: "0",
      redeemable: false,
    },
  ],
  balances: {
    [FIXTURE_TOKENS.quote]: "99744750000",
    [FIXTURE_TOKENS.base]: "100000000000000000000",
  },
};
