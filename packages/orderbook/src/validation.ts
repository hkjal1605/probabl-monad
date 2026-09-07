import { Branch, FundingKind, type Order, Side, TimeInForce } from "@conditional-stocks/domain";
import { type Address, type Hex, isAddress, isHex } from "viem";

import { CanonicalInputError } from "./errors.ts";
import {
  type ChainCursor,
  MarketState,
  type MatcherChainEvent,
  type MatcherEventEnvelope,
} from "./types.ts";

const UINT64_MAX = 2n ** 64n - 1n;
const UINT128_MAX = 2n ** 128n - 1n;
const UINT256_MAX = 2n ** 256n - 1n;

const nonNegative = (value: bigint, name: string): bigint => {
  if (typeof value !== "bigint" || value < 0n)
    throw new CanonicalInputError(`${name} must be non-negative`);
  return value;
};

const positive = (value: bigint, name: string): bigint => {
  if (typeof value !== "bigint" || value <= 0n)
    throw new CanonicalInputError(`${name} must be positive`);
  return value;
};

const uint = (value: bigint, maximum: bigint, name: string, allowZero = true): bigint => {
  if (typeof value !== "bigint" || value < 0n || value > maximum || (!allowZero && value === 0n)) {
    throw new CanonicalInputError(`${name} is outside its unsigned integer range`);
  }
  return value;
};

const safeIndex = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CanonicalInputError(`${name} must be a non-negative safe integer`);
  }
  return value;
};

const hex = (value: Hex, bytes: number, name: string): Hex => {
  if (!isHex(value, { strict: true }) || value.length !== bytes * 2 + 2) {
    throw new CanonicalInputError(`${name} must be ${bytes} bytes`);
  }
  return value.toLowerCase() as Hex;
};

const address = (value: Address, name: string): Address => {
  if (!isAddress(value)) throw new CanonicalInputError(`${name} must be an address`);
  return value.toLowerCase() as Address;
};

const enumValue = <T extends number>(value: T, allowed: readonly T[], name: string): T => {
  if (!allowed.includes(value)) throw new CanonicalInputError(`${name} is invalid`);
  return value;
};

const feeCap = (value: number): number => {
  if (!Number.isInteger(value) || value < 0 || value > 1_000) {
    throw new CanonicalInputError("order.maxFeeBps must be an integer from 0 to 1000");
  }
  return value;
};

const normalizeOrder = (order: Order): Order => ({
  maxFeeBps: feeCap(order.maxFeeBps),
  branch: enumValue(order.branch, [Branch.Yes, Branch.No], "order.branch"),
  expiry: uint(order.expiry, UINT64_MAX, "order.expiry", false),
  fundingKind: enumValue(
    order.fundingKind,
    [FundingKind.WholeCollateral, FundingKind.ActiveClaim],
    "order.fundingKind",
  ),
  limitPriceRawX18: uint(order.limitPriceRawX18, UINT128_MAX, "order.limitPriceRawX18", false),
  maker: address(order.maker, "order.maker"),
  marketId: hex(order.marketId, 32, "order.marketId"),
  nonce: uint(order.nonce, UINT64_MAX, "order.nonce"),
  quantity: uint(order.quantity, UINT128_MAX, "order.quantity", false),
  recipient: address(order.recipient, "order.recipient"),
  salt: hex(order.salt, 32, "order.salt"),
  side: enumValue(order.side, [Side.Buy, Side.Sell], "order.side"),
  tif: enumValue(order.tif, [TimeInForce.Gtc, TimeInForce.Ioc], "order.tif"),
});

const normalizeCursor = (cursor: ChainCursor): ChainCursor => ({
  blockHash: hex(cursor.blockHash, 32, "cursor.blockHash"),
  blockNumber: nonNegative(cursor.blockNumber, "cursor.blockNumber"),
  blockTimestamp: nonNegative(cursor.blockTimestamp, "cursor.blockTimestamp"),
  chainId: positive(cursor.chainId, "cursor.chainId"),
  logIndex: safeIndex(cursor.logIndex, "cursor.logIndex"),
  transactionHash: hex(cursor.transactionHash, 32, "cursor.transactionHash"),
  transactionIndex: safeIndex(cursor.transactionIndex, "cursor.transactionIndex"),
});

const marketState = (value: MarketState, name: string): MarketState =>
  enumValue(
    value,
    [
      MarketState.None,
      MarketState.Scheduled,
      MarketState.Open,
      MarketState.Frozen,
      MarketState.AwaitingResolution,
      MarketState.Resolved,
      MarketState.Redeemable,
      MarketState.Archived,
    ],
    name,
  );

const normalizeEvent = (event: MatcherChainEvent): MatcherChainEvent => {
  switch (event.type) {
    case "order-opened": {
      const order = normalizeOrder(event.order);
      return {
        type: event.type,
        order,
        orderHash: hex(event.orderHash, 32, "event.orderHash"),
        reserved: uint(event.reserved, UINT256_MAX, "event.reserved", false),
        sequence: uint(event.sequence, UINT64_MAX, "event.sequence"),
      };
    }
    case "order-cancelled":
      return {
        type: event.type,
        maker: address(event.maker, "event.maker"),
        orderHash: hex(event.orderHash, 32, "event.orderHash"),
        reasonHash: hex(event.reasonHash, 32, "event.reasonHash"),
        releasedAmount: uint(event.releasedAmount, UINT256_MAX, "event.releasedAmount"),
        unfilledQuantity: uint(
          event.unfilledQuantity,
          UINT128_MAX,
          "event.unfilledQuantity",
          false,
        ),
      };
    case "order-filled":
      return {
        type: event.type,
        branch: enumValue(event.branch, [Branch.Yes, Branch.No], "event.branch"),
        buyOrderHash: hex(event.buyOrderHash, 32, "event.buyOrderHash"),
        executionPriceRawX18: uint(
          event.executionPriceRawX18,
          UINT128_MAX,
          "event.executionPriceRawX18",
          false,
        ),
        executionQuote: uint(event.executionQuote, UINT256_MAX, "event.executionQuote", false),
        fillQuantity: uint(event.fillQuantity, UINT128_MAX, "event.fillQuantity", false),
        makerOrderHash: hex(event.makerOrderHash, 32, "event.makerOrderHash"),
        marketId: hex(event.marketId, 32, "event.marketId"),
        sellOrderHash: hex(event.sellOrderHash, 32, "event.sellOrderHash"),
      };
    case "market-terms-configured":
      return {
        type: event.type,
        baseStep: uint(event.baseStep, UINT128_MAX, "event.baseStep", false),
        marketId: hex(event.marketId, 32, "event.marketId"),
        priceTickRawX18: uint(event.priceTickRawX18, UINT128_MAX, "event.priceTickRawX18", false),
        tradingCutoff: uint(event.tradingCutoff, UINT64_MAX, "event.tradingCutoff", false),
        tradingOpen: uint(event.tradingOpen, UINT64_MAX, "event.tradingOpen"),
      };
    case "market-state-changed":
      return {
        type: event.type,
        marketId: hex(event.marketId, 32, "event.marketId"),
        newState: marketState(event.newState, "event.newState"),
        previousState: marketState(event.previousState, "event.previousState"),
        reasonHash: hex(event.reasonHash, 32, "event.reasonHash"),
      };
    case "nonce-invalidated":
      return {
        type: event.type,
        maker: address(event.maker, "event.maker"),
        newMinimumNonce: uint(event.newMinimumNonce, UINT64_MAX, "event.newMinimumNonce"),
        oldMinimumNonce: uint(event.oldMinimumNonce, UINT64_MAX, "event.oldMinimumNonce"),
      };
    case "emergency-pause-changed":
      return {
        type: event.type,
        paused: event.paused,
        reasonHash: hex(event.reasonHash, 32, "event.reasonHash"),
      };
  }
};

export const normalizeMatcherEnvelope = (envelope: MatcherEventEnvelope): MatcherEventEnvelope => ({
  cursor: normalizeCursor(envelope.cursor),
  event: normalizeEvent(envelope.event),
});
