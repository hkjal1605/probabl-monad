import {
  Branch,
  FundingKind,
  type Order,
  quoteForExecution,
  quoteForReservation,
  Side,
  TimeInForce,
  WAD,
} from "@conditional-stocks/domain";
import type { MatcherEventEnvelope, MatchFill } from "@conditional-stocks/orderbook";
import { MarketState } from "@conditional-stocks/orderbook";
import type { Address, Hex } from "viem";

export const MARKET = `0x${"cd".repeat(32)}` as Hex;
export const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;

export const hash = (value: number): Hex => `0x${value.toString(16).padStart(64, "0")}` as Hex;

export const address = (value: number): Address =>
  `0x${value.toString(16).padStart(40, "0")}` as Address;

export const order = (
  maker: number,
  side: Side,
  priceRawX18: bigint,
  quantity = 10n * WAD,
  overrides: Partial<Order> = {},
): Order => ({
  branch: Branch.Yes,
  expiry: 50_000n,
  fundingKind: FundingKind.WholeCollateral,
  limitPriceRawX18: priceRawX18,
  maker: address(maker),
  marketId: MARKET,
  nonce: 0n,
  quantity,
  recipient: address(maker),
  salt: hash(maker),
  maxFeeBps: 0,
  side,
  tif: TimeInForce.Gtc,
  ...overrides,
});

export class ChainEvents {
  #block = 1n;
  #sequence = 0n;

  event(event: MatcherEventEnvelope["event"]): MatcherEventEnvelope {
    const block = this.#block;
    this.#block += 1n;
    return {
      cursor: {
        blockHash: hash(Number(block)),
        blockNumber: block,
        blockTimestamp: 100n + block,
        chainId: 46630n,
        logIndex: 0,
        transactionHash: hash(Number(block + 10_000n)),
        transactionIndex: 0,
      },
      event,
    };
  }

  configure(): MatcherEventEnvelope[] {
    return [
      this.event({
        type: "market-terms-configured",
        baseStep: WAD,
        marketId: MARKET,
        priceTickRawX18: WAD,
        tradingCutoff: 40_000n,
        tradingOpen: 1n,
      }),
      this.event({
        type: "market-state-changed",
        marketId: MARKET,
        newState: MarketState.Scheduled,
        previousState: MarketState.None,
        reasonHash: ZERO_HASH,
      }),
      this.event({
        type: "market-state-changed",
        marketId: MARKET,
        newState: MarketState.Open,
        previousState: MarketState.Scheduled,
        reasonHash: ZERO_HASH,
      }),
    ];
  }

  open(orderHash: Hex, value: Order): MatcherEventEnvelope {
    const sequence = this.#sequence;
    this.#sequence += 1n;
    return this.event({
      type: "order-opened",
      order: value,
      orderHash,
      reserved:
        value.side === Side.Buy
          ? quoteForReservation(value.quantity, value.limitPriceRawX18)
          : value.quantity,
      sequence,
    });
  }

  fill(fill: MatchFill): MatcherEventEnvelope {
    return this.event({
      type: "order-filled",
      branch: fill.buyOrder.branch,
      buyOrderHash: fill.buyOrderHash,
      executionPriceRawX18: fill.executionPriceRawX18,
      executionQuote: quoteForExecution(fill.fillQuantity, fill.executionPriceRawX18),
      fillQuantity: fill.fillQuantity,
      makerOrderHash: fill.makerOrderHash,
      marketId: fill.buyOrder.marketId,
      sellOrderHash: fill.sellOrderHash,
    });
  }
}
