import { expect, test } from "bun:test";
import { entryBasis } from "../src/lib/portfolio/positions";
import type { IndexedOrder, TradeView } from "../src/types/api";

const me = "0x00000000000000000000000000000000000000Aa";
const other = "0x00000000000000000000000000000000000000Bb";
const E18 = 10n ** 18n;
const usd = (n: number) => BigInt(Math.round(n * 1e6));
const shares = (n: number) => BigInt(Math.round(n * 1000)) * 10n ** 15n;
let seq = 0;
/** A fill on market "m1" (6-decimal quote, 18-decimal stock). */
function fill(f: {
  qty: number;
  price: number;
  buyer: string;
  seller: string;
  takerBuys: boolean;
  branch?: 0 | 1;
  buyerFee?: bigint;
  makerRebate?: bigint;
  takerOrder?: string;
  makerOrder?: string;
}): TradeView {
  seq++;
  const quantity = shares(f.qty);
  return {
    id: `0xtx${seq}:${seq}`,
    marketId: "m1",
    branch: f.branch ?? 0,
    blockTimestamp: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    executionPriceRawX18: String((usd(f.price) * E18) / E18),
    executionQuote: String((quantity * usd(f.price)) / E18),
    fillQuantity: String(quantity),
    buyerFee: String(f.buyerFee ?? 0n),
    sellerFee: "0",
    makerRebate: String(f.makerRebate ?? 0n),
    takerSide: f.takerBuys ? 0 : 1,
    taker: f.takerBuys ? f.buyer : f.seller,
    maker: f.takerBuys ? f.seller : f.buyer,
    ...(f.takerOrder ? { takerOrderHash: f.takerOrder } : {}),
    ...(f.makerOrder ? { makerOrderHash: f.makerOrder } : {}),
    transactionHash: `0xtx${seq}`,
  };
}
/** The human price: for a 6-decimal quote and 18-decimal stock, raw quote units per whole share. */
const price = (basis: ReturnType<typeof entryBasis>) =>
  basis === null ? null : Number(basis.priceRawX18) / 1e6;
const order = (id: string, fundingKind: number) => ({ id, fundingKind }) as IndexedOrder;

test("buys average by quantity; fees raise the price of each claim received", () => {
  const trades = [
    fill({ qty: 1, price: 15.62, buyer: me, seller: other, takerBuys: true }),
    fill({ qty: 3, price: 16.02, buyer: me, seller: other, takerBuys: true }),
  ];
  const basis = entryBasis(trades, [], me, "m1", 0);
  expect(basis?.shares).toBe(shares(4));
  expect(price(basis)).toBeCloseTo((15.62 + 3 * 16.02) / 4, 6);
  // A 1% taker fee taken in stock claims: 0.99 claims for 10.00.
  const withFee = entryBasis(
    [
      fill({
        qty: 1,
        price: 10,
        buyer: me,
        seller: other,
        takerBuys: true,
        buyerFee: shares(0.01),
      }),
    ],
    [],
    me,
    "m1",
    0,
  );
  expect(withFee?.shares).toBe(shares(0.99));
  expect(price(withFee)).toBeCloseTo(10 / 0.99, 5);
  // A resting buy (the maker) whose taker sold gets its rebate in quote claims back.
  const rebated = entryBasis(
    [
      fill({
        qty: 1,
        price: 10,
        buyer: me,
        seller: other,
        takerBuys: false,
        makerRebate: usd(0.05),
      }),
    ],
    [],
    me,
    "m1",
    0,
  );
  expect(price(rebated)).toBeCloseTo(9.95, 6);
});

test("selling held claims keeps the average; a whole-token sell leaves the branch alone", () => {
  const trades = [
    fill({ qty: 2, price: 10, buyer: me, seller: other, takerBuys: true }),
    fill({ qty: 2, price: 14, buyer: me, seller: other, takerBuys: true }),
    // Sells 1 of the held claims at 20: the remaining 3 keep the 12.00 average.
    fill({ qty: 1, price: 20, buyer: other, seller: me, takerBuys: false, takerOrder: "claim" }),
    // Sells 5 YES funded with whole tokens: no held YES claims were spent.
    fill({ qty: 5, price: 19, buyer: other, seller: me, takerBuys: false, takerOrder: "whole" }),
  ];
  const basis = entryBasis(trades, [order("claim", 1), order("whole", 0)], me, "m1", 0);
  expect(basis?.shares).toBe(shares(3));
  expect(price(basis)).toBeCloseTo(12, 6);
  // Selling everything held leaves no basis; a sell of unknown funding never goes below zero.
  expect(
    entryBasis(
      [
        ...trades.slice(0, 2),
        fill({ qty: 9, price: 20, buyer: other, seller: me, takerBuys: true }),
      ],
      [],
      me,
      "m1",
      0,
    ),
  ).toBeNull();
});

test("only this wallet's fills on this branch count", () => {
  const trades = [
    fill({ qty: 1, price: 10, buyer: other, seller: me, takerBuys: true, makerOrder: "x" }),
    fill({ qty: 1, price: 30, buyer: other, seller: other, takerBuys: true }),
    fill({ qty: 2, price: 5, buyer: me, seller: other, takerBuys: true, branch: 1 }),
  ];
  expect(entryBasis(trades, [order("x", 0)], me, "m1", 0)).toBeNull();
  expect(price(entryBasis(trades, [], me, "m1", 1))).toBeCloseTo(5, 6);
  expect(entryBasis(trades, [], me.toLowerCase(), "m2", 1)).toBeNull();
});
