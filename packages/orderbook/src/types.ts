import type { Branch, FundingKind, Order, Side, TimeInForce } from "@conditional-stocks/domain";
import type { Address, Hex } from "viem";

export const MATCHER_SCHEMA_VERSION = 2 as const;
export const MATCHER_ENGINE_VERSION = "orderbook-v2.0.0-raw-ratio" as const;

export const MarketState = {
  None: 0,
  Scheduled: 1,
  Open: 2,
  Frozen: 3,
  AwaitingResolution: 4,
  Resolved: 5,
  Redeemable: 6,
  Archived: 7,
} as const;

export type MarketState = (typeof MarketState)[keyof typeof MarketState];

export interface ChainCursor {
  blockHash: Hex;
  blockNumber: bigint;
  blockTimestamp: bigint;
  chainId: bigint;
  logIndex: number;
  transactionHash: Hex;
  transactionIndex: number;
}

export interface OrderOpenedEvent {
  type: "order-opened";
  order: Order;
  orderHash: Hex;
  reserved: bigint;
  sequence: bigint;
}

export interface OrderCancelledEvent {
  type: "order-cancelled";
  maker: Address;
  orderHash: Hex;
  reasonHash: Hex;
  releasedAmount: bigint;
  unfilledQuantity: bigint;
}

export interface OrderFilledEvent {
  type: "order-filled";
  branch: Branch;
  buyOrderHash: Hex;
  executionPriceRawX18: bigint;
  executionQuote: bigint;
  fillQuantity: bigint;
  makerOrderHash: Hex;
  marketId: Hex;
  sellOrderHash: Hex;
}

export interface MarketTermsConfiguredEvent {
  type: "market-terms-configured";
  baseStep: bigint;
  marketId: Hex;
  priceTickRawX18: bigint;
  tradingCutoff: bigint;
  tradingOpen: bigint;
}

export interface MarketStateChangedEvent {
  type: "market-state-changed";
  marketId: Hex;
  newState: MarketState;
  previousState: MarketState;
  reasonHash: Hex;
}

export interface NonceInvalidatedEvent {
  type: "nonce-invalidated";
  maker: Address;
  newMinimumNonce: bigint;
  oldMinimumNonce: bigint;
}

export interface EmergencyPauseChangedEvent {
  type: "emergency-pause-changed";
  paused: boolean;
  reasonHash: Hex;
}

export type MatcherChainEvent =
  | EmergencyPauseChangedEvent
  | MarketStateChangedEvent
  | MarketTermsConfiguredEvent
  | NonceInvalidatedEvent
  | OrderCancelledEvent
  | OrderFilledEvent
  | OrderOpenedEvent;

export interface MatcherEventEnvelope {
  cursor: ChainCursor;
  event: MatcherChainEvent;
}

export interface MarketTerms {
  baseStep: bigint;
  priceTickRawX18: bigint;
  state: MarketState;
  tradingCutoff: bigint;
  tradingOpen: bigint;
}

export interface BookOrder {
  maxFeeBps: number;
  branch: Branch;
  expiry: bigint;
  fundingKind: FundingKind;
  limitPriceRawX18: bigint;
  maker: Address;
  marketId: Hex;
  matchable: boolean;
  next: Hex | null;
  nonce: bigint;
  orderHash: Hex;
  pending: bigint;
  previous: Hex | null;
  quantity: bigint;
  recipient: Address;
  remaining: bigint;
  reserved: bigint;
  salt: Hex;
  sequence: bigint;
  side: Side;
  tif: TimeInForce;
}

export interface BookOrderSnapshot extends Omit<BookOrder, "next" | "previous"> {}

export interface PriceLevelSnapshot {
  orderHashes: Hex[];
  priceRawX18: bigint;
  totalAvailable: bigint;
}

export interface BestLevelSnapshot {
  orderHashes: Hex[];
  priceRawX18: bigint;
}

export interface MatchDecision {
  askQueue: BestLevelSnapshot;
  bidQueue: BestLevelSnapshot;
  buyOrderHash: Hex;
  executionPriceRawX18: bigint;
  fillQuantity: bigint;
  makerOrderHash: Hex;
  makerSequence: bigint;
  sellOrderHash: Hex;
  step: number;
  takerOrderHash: Hex;
  takerSequence: bigint;
}

export interface MatchFill {
  buyOrder: Order;
  buyOrderHash: Hex;
  executionPriceRawX18: bigint;
  fillQuantity: bigint;
  makerOrderHash: Hex;
  sellOrder: Order;
  sellOrderHash: Hex;
}

export interface MatchProposal {
  batchId: Hex;
  bookKey: string;
  cursor: ChainCursor;
  decisions: MatchDecision[];
  engineVersion: string;
  fills: MatchFill[];
  preBookHash: Hex;
  proposalId: Hex;
  schemaVersion: typeof MATCHER_SCHEMA_VERSION;
}

export const MatchSkipReason = {
  ActiveProposal: "active-proposal",
  InvalidZeroQuote: "invalid-zero-quote",
  MarketClosed: "market-closed",
  MarketCutoff: "market-cutoff",
  MarketTermsMissing: "market-terms-missing",
  NoCross: "no-cross",
  Paused: "paused",
} as const;

export type MatchSkipReason = (typeof MatchSkipReason)[keyof typeof MatchSkipReason];

export interface MatchSkip {
  bookKey: string;
  cursor: ChainCursor | null;
  reason: MatchSkipReason;
}

export type MatchPreview =
  | { proposal: MatchProposal; skip: null }
  | { proposal: null; skip: MatchSkip };

export interface PendingFillSnapshot {
  buyOrderHash: Hex;
  fillQuantity: bigint;
  remainingQuantity: bigint;
  sellOrderHash: Hex;
}

export interface PendingProposalSnapshot {
  fills: PendingFillSnapshot[];
  proposal: MatchProposal;
}

export interface OrderBookSnapshot {
  asks: PriceLevelSnapshot[];
  bids: PriceLevelSnapshot[];
  branch: Branch;
  highestSequence: bigint;
  marketId: Hex;
  orders: BookOrderSnapshot[];
  pendingProposal: PendingProposalSnapshot | null;
}

export interface MatcherCheckpointData {
  books: OrderBookSnapshot[];
  cursor: ChainCursor | null;
  emergencyPaused: boolean;
  engineVersion: string;
  lastEventHash: Hex | null;
  makerMinimumNonces: Array<{ maker: Address; minimumNonce: bigint }>;
  markets: Array<{ marketId: Hex; terms: MarketTerms }>;
  schemaVersion: typeof MATCHER_SCHEMA_VERSION;
}

export interface MatcherCheckpoint extends MatcherCheckpointData {
  checkpointHash: Hex;
}

export interface EngineApplyResult {
  affectedBookKeys: string[];
  duplicate: boolean;
  eventHash: Hex;
  invalidatedProposalIds: Hex[];
}
