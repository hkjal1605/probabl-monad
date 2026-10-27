import { expect, test } from "bun:test";
import type { WalletAssetBalance } from "../src/hooks/useWalletAssets";
import { branchWeight, portfolioValue } from "../src/lib/portfolio/summary";
import type { BranchBook, MarketView, PositionView } from "../src/types/api";

const book = (bid: number | null, ask: number | null): BranchBook => ({
  bestAskExact: ask === null ? null : String(ask),
  bestBidExact: bid === null ? null : String(bid),
  bestAsk: ask,
  bestBid: bid,
  asks: [],
  bids: [],
  depthUsd: 0,
  spread: bid !== null && ask !== null ? ask - bid : null,
});

const market = {
  id: "market",
  base: {
    token: "SPY",
    decimals: 6,
    symbol: "SPY",
    name: null,
    live: {
      multiplier: "1000000000000000000",
      multiplierValue: 1,
      paused: false,
      tradable: true,
      halt: null,
    },
  },
  quoteToken: "USDC",
  shareDecimals: 6,
  quoteTokenDecimals: 6,
  ticker: "SPY",
  yes: book(590, 610),
  no: book(390, 410),
  probability: { ask: null, bid: null, observedAt: null, quality: "valid", value: 0.25 },
} as MarketView;

const balance = (
  token: string,
  available: string,
  reserved: string,
  reference: number | null,
): WalletAssetBalance =>
  ({
    token,
    symbol: token,
    decimals: 6,
    reference,
    balance: {
      token,
      account: "owner",
      decimals: 6,
      canonicalBalance: "0",
      vaultAvailable: available,
      reserved,
      blockNumber: "1",
    },
  }) as WalletAssetBalance;

const position = {
  marketId: "market",
  conditionId: "market",
  baseToken: "SPY",
  baseTokenDecimals: 6,
  baseYes: "1000000",
  baseNo: "0",
  pricedYes: "0",
  pricedNo: "0",
  costYes: "0",
  costNo: "0",
  quoteYes: "0",
  quoteNo: "10000000",
  redeemable: false,
} as PositionView;

const now = Math.floor(Date.now() / 1000);
const spot = (priceUsd: number) =>
  ({
    token: "SPY",
    symbol: "SPY",
    source: "robinhood:SPY",
    kind: "etf",
    status: "available",
    priceUsd,
    priceTimestamp: now,
    fetchedAt: now,
    valuationCompatible: true,
  }) as NonNullable<MarketView["spotReference"]>;
const claims = (held: Partial<PositionView>) => ({
  ...position,
  baseYes: "0",
  quoteNo: "0",
  ...held,
});

test("vault balances count at their reference, each claim at its branch's chance times its pay", () => {
  // 120 USDC (20 reserved by orders), 2 SPY at $500, 1 SPY-YES at its $600 midpoint with YES at
  // 25%, 10 USDC-NO at 75%.
  expect(
    portfolioValue(
      [market],
      [balance("USDC", "100000000", "20000000", 1), balance("SPY", "2000000", "0", 500)],
      [position],
      [],
    ),
  ).toBe(1277.5);
});

test("splitting cash or trading at a fair price leaves the value where it was", () => {
  // 10 USDC split into 10 USDC-YES and 10 USDC-NO is still worth 10.
  expect(
    portfolioValue([market], [], [claims({ quoteYes: "10000000", quoteNo: "10000000" })], []),
  ).toBe(10);
  // 600 USDC paid for 1 SPY-YES at its $600 midpoint: 1 SPY-YES and 600 USDC-NO (the refund).
  expect(
    portfolioValue([market], [], [claims({ baseYes: "1000000", quoteNo: "600000000" })], []),
  ).toBe(600);
});

test("a branch nothing prices is valued at the stock's spot; without one the value is withheld", () => {
  const unquoted = { ...market, yes: book(590, null) };
  const held = [claims({ baseYes: "2000000" })];
  expect(portfolioValue([{ ...unquoted, spotReference: spot(580) }], [], held, [])).toBe(290);
  expect(portfolioValue([unquoted], [], held, [])).toBeNull();
});

test("a resolved market's claims are worth their payout: the stock at spot, losing claims nothing", () => {
  const resolved = {
    ...market,
    lifecycle: "redeemable" as const,
    payouts: [1, 0] as [number, number],
    yes: book(null, null),
    no: book(null, null),
    probability: { ...market.probability, quality: "disconnected" as const, value: null },
  };
  // 1 SPY-YES redeems for 1 SPY at $81,000; 10,000 USDC-NO for nothing; 100 USDC free.
  const held = [claims({ baseYes: "1000000", quoteNo: "10000000000" })];
  expect(
    portfolioValue(
      [{ ...resolved, spotReference: spot(81_000) }],
      [balance("USDC", "100000000", "0", 1)],
      held,
      [],
    ),
  ).toBe(81_100);
  // A losing claim needs no price; an INVALID result pays each branch half.
  expect(portfolioValue([resolved], [], [claims({ quoteNo: "10000000" })], [])).toBe(0);
  expect(branchWeight({ ...resolved, payouts: [1, 1] }, 0)).toBe(0.5);
  // Not yet resolved and no probability: unknown.
  expect(branchWeight({ ...market, probability: resolved.probability }, 0)).toBeNull();
});
