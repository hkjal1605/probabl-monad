import type { Order } from "@conditional-stocks/domain";
import type { ChainCursor, MatchProposal } from "@conditional-stocks/orderbook";
import type { Address, Hex } from "viem";

export const SETTLEMENT_SCHEMA_VERSION = 2 as const;

export const BatchStatus = {
  Confirmed: "confirmed",
  Failed: "failed",
  Mined: "mined",
  Quarantined: "quarantined",
  Queued: "queued",
  Simulated: "simulated",
  Submitted: "submitted",
} as const;

export type BatchStatus = (typeof BatchStatus)[keyof typeof BatchStatus];

export interface GtcBatchPayload {
  kind: "gtc";
  proposal: MatchProposal;
  schemaVersion: typeof SETTLEMENT_SCHEMA_VERSION;
}

export interface IocBatchPayload {
  cursor: ChainCursor;
  fillQuantities: bigint[];
  intentId: Hex;
  kind: "ioc";
  makerOrders: Order[];
  schemaVersion: typeof SETTLEMENT_SCHEMA_VERSION;
  takerOrder: Order;
  takerSignature: Hex;
}

export type SettlementBatchPayload = GtcBatchPayload | IocBatchPayload;

export interface SettlementBatch {
  batchId: Hex;
  createdAtMs: bigint;
  error: { classification: string; message: string } | null;
  feedbackDeliveredAtMs: bigint | null;
  leaseExpiresAtMs: bigint | null;
  leaseOwner: string | null;
  leaseToken: bigint;
  minedBlockNumber: bigint | null;
  payload: SettlementBatchPayload;
  payloadHash: Hex;
  simulationBlock: bigint | null;
  status: BatchStatus;
  updatedAtMs: bigint;
}

export const AttemptStatus = {
  Broadcast: "broadcast",
  Mined: "mined",
  Prepared: "prepared",
  Reverted: "reverted",
} as const;

export type AttemptStatus = (typeof AttemptStatus)[keyof typeof AttemptStatus];

export interface SettlementAttempt {
  attempt: number;
  batchId: Hex;
  callIndex: number;
  createdAtMs: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  nonce: bigint;
  rawTransaction: Hex;
  replaces: Hex | null;
  status: AttemptStatus;
  transactionHash: Hex;
  updatedAtMs: bigint;
}

export interface IocIntent {
  createdAtMs: bigint;
  intentId: Hex;
  order: Order;
  orderHash: Hex;
  protection: { maxNotional: bigint; maxQuantity: bigint; worstPriceRawX18: bigint };
  signature: Hex;
  status: "planned" | "waiting-match" | "unfilled" | "expired";
}

export interface SettlementCall {
  data: Hex;
  expectedFills: Array<{
    buyOrderHash: Hex;
    executionPriceRawX18: bigint;
    fillQuantity: bigint;
    sellOrderHash: Hex;
  }>;
  to: Address;
}

export interface SettlementContext {
  anchorCanonical: boolean;
  confirmedThrough: bigint;
  finalizedThrough: bigint;
  marketStates: Array<{ marketId: Hex; state: number }>;
  orders: Array<{ id: Hex; remaining: bigint; sequence: bigint; status: string }>;
  tradingPaused: boolean;
}

export interface PreparedSettlementTransaction {
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  nonce: bigint;
  rawTransaction: Hex;
  transactionHash: Hex;
}

export interface SettlementReceipt {
  blockNumber: bigint;
  status: "reverted" | "success";
  transactionHash: Hex;
}

export interface SettlementChain {
  readonly relayerAddress: Address;
  broadcast(rawTransaction: Hex): Promise<Hex>;
  pendingNonce(): Promise<bigint>;
  prepare(
    call: SettlementCall,
    nonce: bigint,
    fees?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  ): Promise<PreparedSettlementTransaction>;
  receipt(transactionHash: Hex): Promise<SettlementReceipt | null>;
  simulate(call: SettlementCall, blockNumber: bigint): Promise<{ gas: bigint }>;
}

export interface CanonicalSettlementSource {
  iocBook?(order: Order): Promise<{
    cursor: ChainCursor;
    orders: Array<{ order: Order; remaining: bigint; sequence: bigint }>;
  }>;
  context(cursor: ChainCursor, orderHashes: Hex[]): Promise<SettlementContext>;
  fillsConfirmed(
    expectedFills: SettlementCall["expectedFills"],
    transactionHashes: Hex[],
  ): Promise<boolean>;
}

export interface MatcherFeedback {
  confirmed(batchId: Hex): Promise<void>;
  failed(batchId: Hex, classification: string, message: string): Promise<void>;
}
