import {
  Branch,
  FundingKind,
  type Order,
  quoteForExecution,
  Side,
  TimeInForce,
  WAD,
} from "@conditional-stocks/domain";
import type { Address, Hex } from "viem";

import {
  type ChainCursor,
  MarketState,
  type MatcherEventEnvelope,
  type MatchFill,
  type OrderOpenedEvent,
} from "../src/index.ts";

export const MARKET = `0x${"ab".repeat(32)}` as Hex;
export const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;

export const hash = (value: number): Hex => `0x${value.toString(16).padStart(64, "0")}` as Hex;

export const address = (value: number): Address =>
  `0x${value.toString(16).padStart(40, "0")}` as Address;

export const order = (
  maker: number,
  side: Side,
  price: bigint,
  quantity = 10n * WAD,
  overrides: Partial<Order> = {},
): Order => ({
  branch: Branch.Yes,
  expiry: 10_000n,
  fundingKind: FundingKind.WholeCollateral,
  limitPriceRawX18: price,
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

export class Events {
  #blockNumber = 1n;
  #blockTimestamp = 100n;
  #logIndex = 0;

  envelope(
    event: MatcherEventEnvelope["event"],
    timestamp = this.#blockTimestamp,
  ): MatcherEventEnvelope {
    const cursor: ChainCursor = {
      blockHash: hash(Number(this.#blockNumber)),
      blockNumber: this.#blockNumber,
      blockTimestamp: timestamp,
      chainId: 46630n,
      logIndex: this.#logIndex,
      transactionHash: hash(10_000 + this.#logIndex),
      transactionIndex: this.#logIndex,
    };
    this.#logIndex += 1;
    return { cursor, event };
  }

  nextBlock(event: MatcherEventEnvelope["event"], timestamp: bigint): MatcherEventEnvelope {
    this.#blockNumber += 1n;
    this.#blockTimestamp = timestamp;
    this.#logIndex = 0;
    return this.envelope(event, timestamp);
  }

  configure(): MatcherEventEnvelope[] {
    return [
      this.envelope({
        type: "market-terms-configured",
        baseStep: WAD,
        marketId: MARKET,
        priceTickRawX18: WAD,
        tradingCutoff: 9_000n,
        tradingOpen: 10n,
      }),
      this.envelope({
        type: "market-state-changed",
        marketId: MARKET,
        newState: MarketState.Scheduled,
        previousState: MarketState.None,
        reasonHash: ZERO_HASH,
      }),
      this.envelope({
        type: "market-state-changed",
        marketId: MARKET,
        newState: MarketState.Open,
        previousState: MarketState.Scheduled,
        reasonHash: ZERO_HASH,
      }),
    ];
  }

  open(orderHash: Hex, sequence: bigint, value: Order): MatcherEventEnvelope {
    const event: OrderOpenedEvent = {
      type: "order-opened",
      order: value,
      orderHash,
      reserved:
        value.side === Side.Buy
          ? (value.quantity * value.limitPriceRawX18 + WAD - 1n) / WAD
          : value.quantity,
      sequence,
    };
    return this.envelope(event);
  }

  fill(fill: MatchFill): MatcherEventEnvelope {
    return this.envelope({
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
