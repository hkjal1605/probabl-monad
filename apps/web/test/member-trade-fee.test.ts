import { expect, test } from "bun:test";
import { memberTradeFee, type WalletTradeRow } from "../src/lib/portfolio/presentation";
import { fixtureMarkets, fixtureState } from "./fixtures/protocol";

const market = fixtureMarkets[0]!;
const e18 = (n: number) => `${BigInt(Math.round(n * 1e6)) * 10n ** 12n}`;
const usd = (n: number) => String(Math.round(n * 1e6));
// 2 YES at $20 (raw price: quote raw per share), fees 0.02 YES (buyer) and $0.40 (seller).
const trade = {
  ...fixtureState.trades[0]!,
  executionPriceRawX18: "20000000",
  fillQuantity: e18(2),
  buyerFee: e18(0.02),
  sellerFee: usd(0.4),
  takerOrderHash: "taker",
  makerOrderHash: "maker",
};
const row = (
  side: WalletTradeRow["side"],
  orderId: string,
  orderSide: number,
  patch: Partial<WalletTradeRow["trade"]> = {},
): WalletTradeRow => ({
  market,
  order: { ...fixtureState.orders[0]!, id: orderId, side: orderSide },
  side,
  trade: { ...trade, ...patch },
});

test("a fill's fee for the member, net of a maker's rebate, in quote units", () => {
  // Taker buying: the buyer's fee, in YES claims at the fill price.
  expect(memberTradeFee(row("Buy", "taker", 0, { takerSide: 0 }))).toBeCloseTo(0.4, 9);
  // Taker selling: the seller's fee, in quote claims.
  expect(memberTradeFee(row("Sell", "taker", 1, { takerSide: 1 }))).toBeCloseTo(0.4, 9);
  // Maker selling to a taker buyer: its own (seller's) fee less the rebate, paid in YES claims.
  expect(
    memberTradeFee(row("Sell", "maker", 1, { takerSide: 0, makerRebate: e18(0.01) })),
  ).toBeCloseTo(0.4 - 0.2, 9);
  // Maker buying from a taker seller with no fee of its own: the rebate alone, in quote claims.
  expect(
    memberTradeFee(
      row("Buy", "maker", 0, { takerSide: 1, buyerFee: "0", makerRebate: usd(0.1) }),
    ),
  ).toBeCloseTo(-0.1, 9);
  // Without the taker's side, the member's own order tells it.
  expect(memberTradeFee(row("Buy", "maker", 0, { buyerFee: "0", makerRebate: usd(0.1) }))).toBeCloseTo(
    -0.1,
    9,
  );
  // Both sides its own: both fees, less the rebate it paid itself.
  expect(
    memberTradeFee(row("Self-match", "taker", 0, { takerSide: 0, makerRebate: e18(0.01) })),
  ).toBeCloseTo(0.4 + 0.4 - 0.2, 9);
  // Fees not indexed.
  const { buyerFee: _, ...unfeed } = trade;
  expect(memberTradeFee({ ...row("Buy", "taker", 0), trade: unfeed })).toBeNull();
});
