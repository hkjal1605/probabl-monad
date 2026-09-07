// Audit fixture adapted from the repository settlement tests.
import {
  Branch,
  FundingKind,
  hashOrder,
  type Order,
  Side,
  TimeInForce,
} from "../../../packages/domain/src/index.ts";
import {
  hashCanonical,
  MATCHER_ENGINE_VERSION,
  MATCHER_SCHEMA_VERSION,
  type MatchProposal,
} from "../../../packages/orderbook/src/index.ts";
import { getAddress, type Hex, keccak256, toBytes } from "viem";

import type { SettlementEnvironment } from "../../../services/settlement-worker/src/chain.ts";
import { SettlementStore } from "../../../services/settlement-worker/src/store.ts";
import type {
  CanonicalSettlementSource,
  MatcherFeedback,
  PreparedSettlementTransaction,
  SettlementCall,
  SettlementChain,
  SettlementContext,
  SettlementReceipt,
} from "../../../services/settlement-worker/src/types.ts";
import { SettlementWorker } from "../../../services/settlement-worker/src/worker.ts";

const exchange = getAddress("0x1000000000000000000000000000000000000001");
const router = getAddress("0x2000000000000000000000000000000000000002");
const relayer = getAddress("0x3000000000000000000000000000000000000003");
const buyer = getAddress("0x4000000000000000000000000000000000000004");
const seller = getAddress("0x5000000000000000000000000000000000000005");
const marketId = `0x${"11".repeat(32)}` as Hex;
const cursor = {
  blockHash: `0x${"22".repeat(32)}` as Hex,
  blockNumber: 100n,
  blockTimestamp: 1_500n,
  chainId: 31337n,
  logIndex: 1,
  transactionHash: `0x${"33".repeat(32)}` as Hex,
  transactionIndex: 0,
};

const order = (maker: typeof buyer, side: Side, saltByte: string): Order => ({
  branch: Branch.Yes,
  expiry: 2_000n,
  fundingKind: FundingKind.WholeCollateral,
  limitPriceX18: side === Side.Buy ? 210n * 10n ** 18n : 200n * 10n ** 18n,
  maker,
  marketId,
  nonce: 0n,
  quantity: 10n ** 18n,
  recipient: maker,
  salt: `0x${saltByte.repeat(64)}` as Hex,
  side,
  tif: TimeInForce.Gtc,
});

const makeProposal = (suffix = "a"): MatchProposal => {
  const buyOrder = order(buyer, Side.Buy, suffix);
  const sellOrder = order(seller, Side.Sell, suffix === "a" ? "b" : "c");
  const buyOrderHash = hashOrder(buyOrder, { chainId: 31337n, verifyingContract: exchange });
  const sellOrderHash = hashOrder(sellOrder, { chainId: 31337n, verifyingContract: exchange });
  const unsigned = {
    bookKey: `${marketId}:0`,
    cursor,
    decisions: [
      {
        askQueue: { orderHashes: [sellOrderHash], priceX18: sellOrder.limitPriceX18 },
        bidQueue: { orderHashes: [buyOrderHash], priceX18: buyOrder.limitPriceX18 },
        buyOrderHash,
        executionPriceX18: buyOrder.limitPriceX18,
        fillQuantity: 10n ** 18n,
        makerOrderHash: buyOrderHash,
        makerSequence: 0n,
        sellOrderHash,
        step: 0,
        takerOrderHash: sellOrderHash,
        takerSequence: 1n,
      },
    ],
    engineVersion: MATCHER_ENGINE_VERSION,
    fills: [
      {
        buyOrder,
        buyOrderHash,
        executionPriceX18: buyOrder.limitPriceX18,
        fillQuantity: 10n ** 18n,
        makerOrderHash: buyOrderHash,
        sellOrder,
        sellOrderHash,
      },
    ],
    preBookHash: `0x${"44".repeat(32)}` as Hex,
    schemaVersion: MATCHER_SCHEMA_VERSION,
  };
  const proposalId = hashCanonical(unsigned);
  return { ...unsigned, batchId: proposalId, proposalId };
};

class FakeChain implements SettlementChain {
  readonly relayerAddress = relayer;
  broadcasts: Hex[] = [];
  failNextBroadcast = false;
  prepareCount = 0;
  receipts = new Map<Hex, SettlementReceipt>();

  async pendingNonce(): Promise<bigint> {
    return 7n;
  }
  async simulate(_call: SettlementCall, _blockNumber: bigint): Promise<{ gas: bigint }> {
    return { gas: 100_000n };
  }
  async prepare(
    call: SettlementCall,
    nonce: bigint,
    fees = { maxFeePerGas: 100n, maxPriorityFeePerGas: 2n },
  ): Promise<PreparedSettlementTransaction> {
    this.prepareCount += 1;
    const rawTransaction = keccak256(
      toBytes(`${call.data}:${nonce}:${fees.maxFeePerGas}:${this.prepareCount}`),
    );
    return {
      gas: 120_000n,
      ...fees,
      nonce,
      rawTransaction,
      transactionHash: keccak256(rawTransaction),
    };
  }
  async broadcast(rawTransaction: Hex): Promise<Hex> {
    if (this.failNextBroadcast) {
      this.failNextBroadcast = false;
      throw new Error("RPC unavailable");
    }
    this.broadcasts.push(rawTransaction);
    return keccak256(rawTransaction);
  }
  async receipt(transactionHash: Hex): Promise<SettlementReceipt | null> {
    return this.receipts.get(transactionHash) ?? null;
  }
}

class FakeSource implements CanonicalSettlementSource {
  confirmed = false;
  contextValue: SettlementContext = {
    anchorCanonical: true,
    confirmedThrough: 100n,
    finalizedThrough: 95n,
    marketStates: [{ marketId, state: 2 }],
    orders: [],
    tradingPaused: false,
  };

  setProposal(proposal: MatchProposal): void {
    this.contextValue.orders = proposal.fills.flatMap((fill) => [
      { id: fill.buyOrderHash, remaining: fill.fillQuantity, sequence: 0n, status: "open" },
      { id: fill.sellOrderHash, remaining: fill.fillQuantity, sequence: 1n, status: "open" },
    ]);
  }
  async context(): Promise<SettlementContext> {
    return this.contextValue;
  }
  async fillsConfirmed(): Promise<boolean> {
    return this.confirmed;
  }
}

class FakeFeedback implements MatcherFeedback {
  confirmedIds: Hex[] = [];
  failures: Hex[] = [];
  failDelivery = false;
  async confirmed(batchId: Hex): Promise<void> {
    if (this.failDelivery) throw new Error("matcher unavailable");
    this.confirmedIds.push(batchId);
  }
  async failed(batchId: Hex): Promise<void> {
    if (this.failDelivery) throw new Error("matcher unavailable");
    this.failures.push(batchId);
  }
}

const environment: SettlementEnvironment = {
  chainId: 31337,
  databasePath: "unused",
  exchange,
  indexerUrl: "http://indexer",
  internalToken: "test-secret",
  iocRouter: router,
  leaseTtlMs: 15_000n,
  matcherCallbackUrl: null,
  ownerId: "worker-a",
  port: 42071,
  privateKey: `0x${"01".repeat(32)}`,
  protocolAuthority: getAddress("0x6000000000000000000000000000000000000006"),
  replacementBumpBps: 1_250n,
  rpcUrl: "http://rpc",
  stuckMs: 30_000n,
};
export { makeProposal, FakeChain, FakeSource, FakeFeedback, environment, SettlementStore, SettlementWorker };
