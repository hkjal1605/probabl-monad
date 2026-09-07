import { afterEach, describe, expect, test } from "bun:test";
import { createSettlementQueries, type SettlementQueries } from "@conditional-stocks/db/settlement";
import type {
  CanonicalSettlementSource,
  MatcherFeedback,
  PreparedSettlementTransaction,
  SettlementCall,
  SettlementChain,
  SettlementContext,
  SettlementReceipt,
} from "@conditional-stocks/db/settlement/types";
import { testDatabase } from "@conditional-stocks/db/testing";
import {
  Branch,
  FundingKind,
  hashOrder,
  type Order,
  Side,
  TimeInForce,
} from "@conditional-stocks/domain";
import {
  hashCanonical,
  MATCHER_ENGINE_VERSION,
  MATCHER_SCHEMA_VERSION,
  type MatchProposal,
} from "@conditional-stocks/orderbook";
import { getAddress, type Hex, keccak256, toBytes } from "viem";
import type { SettlementEnvironment } from "../src/chain.ts";
import { SettlementWorker } from "../src/worker.ts";

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
  limitPriceRawX18: side === Side.Buy ? 210_000_000n : 200_000_000n,
  maker,
  marketId,
  nonce: 0n,
  quantity: 10n ** 18n,
  recipient: maker,
  salt: `0x${saltByte.repeat(64)}` as Hex,
  maxFeeBps: 0,
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
        askQueue: { orderHashes: [sellOrderHash], priceRawX18: sellOrder.limitPriceRawX18 },
        bidQueue: { orderHashes: [buyOrderHash], priceRawX18: buyOrder.limitPriceRawX18 },
        buyOrderHash,
        executionPriceRawX18: buyOrder.limitPriceRawX18,
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
        executionPriceRawX18: buyOrder.limitPriceRawX18,
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

const stores: SettlementQueries[] = [];
const setup = async (clock = { value: 1_000n }) => {
  const store = createSettlementQueries((await testDatabase()).database);
  stores.push(store);
  const chain = new FakeChain();
  const source = new FakeSource();
  const feedback = new FakeFeedback();
  const worker = new SettlementWorker(store, chain, source, {
    environment,
    feedback,
    now: () => clock.value,
  });
  return { chain, clock, feedback, source, store, worker };
};

afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});

test("safety blocks first broadcast and prepared retries without consuming another nonce", async () => {
  const f = await setup();
  let blocked = true;
  const worker = new SettlementWorker(f.store, f.chain, f.source, {
    environment,
    now: () => f.clock.value,
    safety: {
      assertCanTrade: async () => {
        if (blocked) throw new Error("freeze");
      },
    },
  });
  const proposal = makeProposal();
  f.source.setProposal(proposal);
  await worker.enqueueProposal(proposal);
  await worker.process(proposal.batchId);
  expect(f.chain.broadcasts).toHaveLength(0);
  expect(await f.store.peekNonce(relayer, 7n)).toBe(7n);
  blocked = false;
  f.chain.failNextBroadcast = true;
  await expect(worker.process(proposal.batchId)).rejects.toThrow("RPC unavailable");
  blocked = true;
  await worker.process(proposal.batchId);
  expect(f.chain.broadcasts).toHaveLength(0);
  blocked = false;
  await worker.process(proposal.batchId);
  expect(f.chain.broadcasts).toHaveLength(1);
  expect((await f.store.attempts(proposal.batchId))[0]?.nonce).toBe(7n);
});

test("failed signing does not leave a nonce hole", async () => {
  const f = await setup();
  const proposal = makeProposal();
  f.source.setProposal(proposal);
  await f.worker.enqueueProposal(proposal);
  const prepare = f.chain.prepare.bind(f.chain);
  f.chain.prepare = async () => {
    throw new Error("signing failed");
  };
  await expect(f.worker.process(proposal.batchId)).rejects.toThrow("signing failed");
  expect(await f.store.peekNonce(relayer, 7n)).toBe(7n);
  expect(await f.store.attempts(proposal.batchId)).toHaveLength(0);
  f.chain.prepare = prepare;
  await f.worker.process(proposal.batchId);
  expect((await f.store.attempts(proposal.batchId))[0]?.nonce).toBe(7n);
});

test("runtime plans IOC from canonical liquidity and terminates an empty IOC", async () => {
  const f = await setup();
  const source: CanonicalSettlementSource = {
    context: () => f.source.context(),
    fillsConfirmed: () => f.source.fillsConfirmed(),
    iocBook: async () => ({
      cursor,
      orders: [{ order: order(seller, Side.Sell, "f"), remaining: 10n ** 18n, sequence: 1n }],
    }),
  };
  const worker = new SettlementWorker(f.store, f.chain, source, {
    environment,
    now: () => 1500000n,
  });
  const taker = { ...order(buyer, Side.Buy, "e"), tif: TimeInForce.Ioc };
  const orderHash = hashOrder(taker, { chainId: 31337n, verifyingContract: exchange });
  await worker.enqueueIocIntent({
    order: taker,
    orderHash,
    signature: "0x1234",
    protection: {
      maxQuantity: taker.quantity,
      worstPriceRawX18: taker.limitPriceRawX18,
      maxNotional: 210000000n,
    },
  });
  await worker.planIocIntents();
  expect((await f.store.getIntent(orderHash))?.status).toBe("planned");
  expect((await f.store.batchForIntent(orderHash))?.payload.kind).toBe("ioc");
  const second = { ...taker, salt: `0x${"99".repeat(32)}` as Hex, branch: Branch.No };
  const secondHash = hashOrder(second, { chainId: 31337n, verifyingContract: exchange });
  source.iocBook = async () => ({ cursor, orders: [] });
  await worker.enqueueIocIntent({
    order: second,
    orderHash: secondHash,
    signature: "0x1234",
    protection: {
      maxQuantity: second.quantity,
      worstPriceRawX18: second.limitPriceRawX18,
      maxNotional: 210000000n,
    },
  });
  await worker.planIocIntents();
  expect((await f.store.getIntent(secondHash))?.status).toBe("unfilled");
});

describe("settlement worker", () => {
  test("persists, broadcasts, mines, and confirms exactly once", async () => {
    const { chain, feedback, source, store, worker } = await setup();
    const proposal = makeProposal();
    source.setProposal(proposal);
    expect((await worker.enqueueProposal(proposal)).status).toBe("queued");
    expect((await worker.enqueueProposal(proposal)).status).toBe("queued");

    expect((await worker.process(proposal.batchId)).status).toBe("submitted");
    expect(await store.attempts(proposal.batchId)).toHaveLength(1);
    expect(chain.broadcasts).toHaveLength(1);
    const attempt = (await store.attempts(proposal.batchId))[0];
    if (!attempt) throw new Error("attempt missing");
    chain.receipts.set(attempt.transactionHash, {
      blockNumber: 101n,
      status: "success",
      transactionHash: attempt.transactionHash,
    });
    expect((await worker.process(proposal.batchId)).status).toBe("mined");
    source.confirmed = true;
    expect((await worker.process(proposal.batchId)).status).toBe("confirmed");
    expect(feedback.confirmedIds).toEqual([proposal.batchId]);
  });

  test("replaces a stuck transaction with the same nonce and bumped fees", async () => {
    const state = await setup();
    const proposal = makeProposal("d");
    state.source.setProposal(proposal);
    await state.worker.enqueueProposal(proposal);
    await state.worker.process(proposal.batchId);
    state.clock.value += 31_000n;
    await state.worker.process(proposal.batchId);
    const attempts = await state.store.attempts(proposal.batchId);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.nonce).toBe(attempts[0]?.nonce);
    expect(attempts[1]?.replaces).toBe(attempts[0]?.transactionHash);
    expect(attempts[1]?.maxFeePerGas).toBeGreaterThan(attempts[0]?.maxFeePerGas ?? 0n);
  });

  test("rebroadcasts a prepared outbox record after a crash", async () => {
    const state = await setup();
    const proposal = makeProposal("e");
    state.source.setProposal(proposal);
    await state.worker.enqueueProposal(proposal);
    state.chain.failNextBroadcast = true;
    await expect(state.worker.process(proposal.batchId)).rejects.toThrow("RPC unavailable");
    expect((await state.store.getBatch(proposal.batchId))?.status).toBe("submitted");
    expect((await state.store.attempts(proposal.batchId))[0]?.status).toBe("prepared");
    await state.worker.process(proposal.batchId);
    expect((await state.store.attempts(proposal.batchId))[0]?.status).toBe("broadcast");
    expect(state.chain.broadcasts).toHaveLength(1);
  });

  test("recognizes the original receipt after preparing a replacement", async () => {
    const f = await setup();
    const proposal = makeProposal();
    f.source.setProposal(proposal);
    await f.worker.enqueueProposal(proposal);
    await f.worker.process(proposal.batchId);
    f.clock.value += 31_000n;
    f.chain.failNextBroadcast = true;
    await expect(f.worker.process(proposal.batchId)).rejects.toThrow("RPC unavailable");
    const original = (await f.store.attempts(proposal.batchId))[0];
    if (!original) throw new Error("missing original");
    f.chain.receipts.set(original.transactionHash, {
      blockNumber: 101n,
      status: "success",
      transactionHash: original.transactionHash,
    });
    expect((await f.worker.process(proposal.batchId)).status).toBe("mined");
    expect(f.chain.broadcasts).toHaveLength(1);
    f.source.confirmed = true;
    expect((await f.worker.process(proposal.batchId)).status).toBe("confirmed");
  });

  test("does not replay a prepared transaction against an orphaned proposal anchor", async () => {
    const f = await setup();
    const proposal = makeProposal();
    f.source.setProposal(proposal);
    await f.worker.enqueueProposal(proposal);
    f.chain.failNextBroadcast = true;
    await expect(f.worker.process(proposal.batchId)).rejects.toThrow();
    f.source.contextValue.anchorCanonical = false;
    await f.worker.process(proposal.batchId);
    expect(f.chain.broadcasts).toHaveLength(0);
    expect(await f.store.attempts(proposal.batchId)).toHaveLength(1);
  });

  test("returns orphaned pre-confirmation receipts to same-nonce monitoring", async () => {
    const f = await setup();
    const proposal = makeProposal();
    f.source.setProposal(proposal);
    await f.worker.enqueueProposal(proposal);
    await f.worker.process(proposal.batchId);
    const original = (await f.store.attempts(proposal.batchId))[0];
    if (!original) throw new Error("missing original");
    f.chain.receipts.set(original.transactionHash, {
      blockNumber: 101n,
      status: "success",
      transactionHash: original.transactionHash,
    });
    await f.worker.process(proposal.batchId);
    f.chain.receipts.clear();
    expect((await f.worker.process(proposal.batchId)).status).toBe("submitted");
    expect(await f.store.attempts(proposal.batchId)).toHaveLength(1);
  });

  test("quarantines unsafe anchors and retries matcher feedback durably", async () => {
    const state = await setup();
    const proposal = makeProposal("f");
    state.source.setProposal(proposal);
    state.source.contextValue.anchorCanonical = false;
    state.feedback.failDelivery = true;
    await state.worker.enqueueProposal(proposal);
    expect((await state.worker.process(proposal.batchId)).status).toBe("quarantined");
    expect(state.chain.broadcasts).toHaveLength(0);
    await state.worker.deliverFeedback();
    expect((await state.store.getBatch(proposal.batchId))?.feedbackDeliveredAtMs).toBeNull();
    state.feedback.failDelivery = false;
    await state.worker.deliverFeedback();
    expect(state.feedback.failures).toEqual([proposal.batchId]);
    expect((await state.store.getBatch(proposal.batchId))?.feedbackDeliveredAtMs).not.toBeNull();
  });

  test("classifies reverted receipts and never resubmits the batch", async () => {
    const state = await setup();
    const proposal = makeProposal("9");
    state.source.setProposal(proposal);
    await state.worker.enqueueProposal(proposal);
    await state.worker.process(proposal.batchId);
    const attempt = (await state.store.attempts(proposal.batchId))[0];
    if (!attempt) throw new Error("attempt missing");
    state.chain.receipts.set(attempt.transactionHash, {
      blockNumber: 101n,
      status: "reverted",
      transactionHash: attempt.transactionHash,
    });
    expect((await state.worker.process(proposal.batchId)).status).toBe("failed");
    expect((await state.worker.process(proposal.batchId)).status).toBe("failed");
    expect(state.chain.broadcasts).toHaveLength(1);
  });

  test("validates and executes a bounded IOC plan as one atomic router call", async () => {
    const state = await setup();
    const taker = {
      ...order(buyer, Side.Buy, "7"),
      tif: TimeInForce.Ioc,
    };
    const orderHash = hashOrder(taker, { chainId: 31337n, verifyingContract: exchange });
    const intentInput = {
      order: taker,
      orderHash,
      protection: {
        maxNotional: 210_000_000n,
        maxQuantity: taker.quantity,
        worstPriceRawX18: taker.limitPriceRawX18,
      },
      signature: "0x1234" as Hex,
    };
    expect((await state.worker.enqueueIocIntent(intentInput)).status).toBe("waiting-match");
    state.clock.value += 1n;
    expect((await state.worker.enqueueIocIntent(intentInput)).status).toBe("waiting-match");
    const makerOrder = order(seller, Side.Sell, "8");
    const makerHash = hashOrder(makerOrder, { chainId: 31337n, verifyingContract: exchange });
    state.source.contextValue.orders = [
      { id: makerHash, remaining: makerOrder.quantity, sequence: 10n, status: "open" },
    ];
    const batch = await state.worker.enqueueIocPlan({
      cursor,
      fillQuantities: [makerOrder.quantity],
      intentId: orderHash,
      kind: "ioc",
      makerOrders: [makerOrder],
    });
    expect((await state.worker.process(batch.batchId)).status).toBe("submitted");
    expect(await state.store.attempts(batch.batchId)).toHaveLength(1);
    expect(state.chain.broadcasts).toHaveLength(1);
  });
});
