import { expect, test } from "bun:test";
import { createGatewayQueries } from "@conditional-stocks/db/gateway";
import { testDatabase } from "@conditional-stocks/db/testing";
import { Branch, FundingKind, type Order, Side, TimeInForce } from "@conditional-stocks/domain";
import {
  GatewayError,
  GatewayErrorCode,
  type ValidationSnapshot,
} from "@conditional-stocks/gateway";
import { type Address, type Hex, keccak256, toHex } from "viem";
import { createApp } from "./app.ts";
import {
  type CanonicalMarket,
  type CanonicalOrder,
  type CanonicalResolution,
  type CanonicalTransaction,
  IndexerClient,
  ViemGatewayChain,
} from "./chain.ts";
import type { ApiEnvironment } from "./environment.ts";
import { GatewayService, type SettlementIntentSink } from "./service.ts";

const maker: Address = "0x1000000000000000000000000000000000000001";
const other: Address = "0x2000000000000000000000000000000000000002";
const hash: Hex = `0x${"11".repeat(32)}`;
const env: ApiEnvironment = {
  authDomain: "probabl.test",
  authOrigin: "https://probabl.test",
  chainId: 31337,
  conditionalTokens: other,
  exchange: maker,
  indexerUrl: "http://127.0.0.1:1",
  iocRouter: other,
  marketRegistry: other,
  positionRouter: other,
  relayerPrivateKey: null,
  rpcUrl: "http://127.0.0.1:1",
  settlementWorkerUrl: "http://127.0.0.1:1",
  settlementWorkerToken: "test",
};
const wire = {
  branch: Branch.Yes,
  expiry: "1900",
  fundingKind: FundingKind.WholeCollateral,
  limitPriceRawX18: "200000000",
  maker,
  marketId: hash,
  nonce: "7",
  quantity: "1000000000000000000",
  recipient: maker,
  salt: hash,
  side: Side.Buy,
  tif: TimeInForce.Gtc,
  maxFeeBps: 0,
};
const snapshot: ValidationSnapshot = {
  chainId: 31337n,
  safeBlockNumber: 100n,
  safeBlockTimestamp: 1500n,
  tradingPaused: false,
  minimumNonce: 7n,
  marketOpenNotional: 0n,
  walletOpenNotional: 0n,
  market: {
    baseTokenDecimals: 18,
    quoteTokenDecimals: 6,
    protocolVersion: 2,
    priceFormat: "raw-unit-ratio-x18",
    baseStep: 10n ** 15n,
    baseToken: maker,
    quoteToken: other,
    conditionId: hash,
    conditionalTokens: other,
    maxMarketOpenNotional: 10_000_000_000n,
    maxOrderNotional: 1_000_000_000n,
    maxOrderQuantity: 10n ** 19n,
    maxWalletOpenNotional: 2_000_000_000n,
    minNotional: 10_000n,
    priceTickRawX18: 10_000n,
    quoteNoPositionId: 2n,
    quoteYesPositionId: 1n,
    stockNoPositionId: 4n,
    stockYesPositionId: 3n,
    state: 2,
    tradingCutoff: 2000n,
    tradingOpen: 1000n,
  },
};
class Chain extends ViemGatewayChain {
  authValid = true;
  signatureValid = true;
  balance = 10n ** 25n;
  allowance = 10n ** 25n;
  approved = true;
  simulationError = false;
  broadcastError = false;
  relayerEnabled = true;
  snapshotError = false;
  onSnapshot: (() => Promise<void>) | null = null;
  broadcasts: Hex[] = [];
  prepared: bigint[] = [];
  receiptValue: Awaited<ReturnType<ViemGatewayChain["receipt"]>> = null;
  constructor() {
    super(env);
  }
  override get relayerAddress() {
    return this.relayerEnabled ? other : null;
  }
  override async snapshot() {
    await this.onSnapshot?.();
    if (this.snapshotError) throw new Error("private database details");
    return structuredClone(snapshot);
  }
  override async funding() {
    return { allowance: this.allowance, approvedForAll: this.approved, balance: this.balance };
  }
  override async verifyAuthMessage() {
    return this.authValid;
  }
  override async verifyOrderSignature() {
    return this.signatureValid;
  }
  override async simulateOpen() {
    if (this.simulationError) throw new Error("simulation revert");
    return 1n;
  }
  override async pendingNonce() {
    return 7n;
  }
  override async prepareRelayedOpen(order: Order, signature: Hex, nonce: bigint) {
    this.prepared.push(nonce);
    const rawTransaction = toHex(nonce);
    return {
      rawTransaction,
      transactionHash: keccak256(rawTransaction),
      nonce,
      to: env.exchange,
      data: this.openOrderCalldata(order, signature),
    };
  }
  override async broadcast(raw: Hex) {
    if (this.broadcastError) throw new Error("RPC disconnected");
    this.broadcasts.push(raw);
    return keccak256(raw);
  }
  override async receipt() {
    return this.receiptValue;
  }
  override async validateRawTransaction(raw: Hex) {
    return { nonce: 12n, transactionHash: keccak256(raw) };
  }
  override async positionRouterApproved() {
    return this.approved;
  }
  override async simulateUserCall() {}
}
class Indexer extends IndexerClient {
  orderValue: CanonicalOrder | null = null;
  transactionValue: CanonicalTransaction | null = null;
  marketValue: CanonicalMarket | null = {
    ...snapshot.market,
    baseStep: "1000000000000000",
    maxMarketOpenNotional: "10000000000",
    maxOrderNotional: "1000000000",
    maxOrderQuantity: "10000000000000000000",
    maxWalletOpenNotional: "2000000000",
    minNotional: "10000",
    priceTickRawX18: "10000",
    tradingCutoff: "2000",
    tradingOpen: "1000",
    id: hash,
    metadataHash: hash,
    polymarketConditionId: hash,
    polymarketNoIndex: "1",
    polymarketYesIndex: "0",
    rulesHash: hash,
    stateReasonHash: hash,
  };
  resolutionValue: CanonicalResolution | null = {
    admin: maker,
    evidenceHash: hash,
    evidenceUri: "https://probabl.test/evidence",
    noPayout: "1",
    yesPayout: "1",
    payoutDenominator: "2",
    transactionHash: hash,
  };
  constructor() {
    super(env.indexerUrl);
  }
  override async order() {
    return this.orderValue;
  }
  override async transaction() {
    return this.transactionValue;
  }
  override async market() {
    return this.marketValue;
  }
  override async resolution() {
    return this.resolutionValue;
  }
}
async function setup() {
  const fixture = await testDatabase();
  const chain = new Chain();
  const indexer = new Indexer();
  const ioc = { enqueued: 0, state: "queued" };
  const settlement: SettlementIntentSink = {
    enqueueIoc: async () => {
      ioc.enqueued++;
      return { batchId: hash, state: ioc.state };
    },
    status: async () => ({ batchId: hash, state: ioc.state, error: null }),
  };
  const store = createGatewayQueries(fixture.database);
  const service = new GatewayService(env, store, chain, indexer, settlement);
  return { fixture, chain, indexer, ioc, store, service, settlement };
}

test("auth sessions are PostgreSQL-backed, reusable across API instances, and challenges are single-use", async () => {
  const { fixture, chain, indexer, settlement, service } = await setup();
  const challenge = await service.createChallenge({ address: maker });
  expect(challenge.message).toContain("https://probabl.test");
  const session = await service.verifyChallenge({
    address: maker,
    challengeId: challenge.challengeId,
    signature: "0x12",
  });
  const restarted = new GatewayService(
    env,
    createGatewayQueries(fixture.connect()),
    chain,
    indexer,
    settlement,
  );
  expect(await restarted.authenticate(`Bearer ${session.token}`)).toBe(maker);
  await expect(
    service.verifyChallenge({
      address: maker,
      challengeId: challenge.challengeId,
      signature: "0x12",
    }),
  ).rejects.toMatchObject({ status: 401 });
  for (const header of [undefined, "Basic x", "Bearer invalid", "Bearer a b"])
    await expect(service.authenticate(header)).rejects.toMatchObject({ status: 401 });
  for (const body of [null, [], {}, { address: "bad" }])
    await expect(service.createChallenge(body)).rejects.toBeInstanceOf(GatewayError);
  await expect(service.verifyChallenge({ address: maker, signature: "0x12" })).rejects.toThrow(
    "challengeId",
  );
  await expect(
    service.verifyChallenge({ address: maker, challengeId: "id", signature: "bad" }),
  ).rejects.toThrow("hex");
  chain.authValid = false;
  const invalid = await service.createChallenge({ address: maker });
  await expect(
    service.verifyChallenge({
      address: maker,
      challengeId: invalid.challengeId,
      signature: "0x12",
    }),
  ).rejects.toMatchObject({ status: 401 });
});

test("parallel API instances deduplicate one relayed order, and retry recovers durable signed bytes after restart", async () => {
  const { fixture, chain, indexer, settlement, service, store } = await setup();
  const second = new GatewayService(
    env,
    createGatewayQueries(fixture.connect()),
    chain,
    indexer,
    settlement,
  );
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  chain.onSnapshot = async () => {
    entered.resolve();
    await release.promise;
  };
  const request = { order: wire, signature: "0x12" };
  const first = service.submitOrder(request, maker, "parallel-0001");
  await entered.promise;
  try {
    expect((await second.submitOrder(request, maker, "parallel-0001")).operation.state).toBe(
      "accepted",
    );
    expect(chain.prepared).toEqual([]);
  } finally {
    release.resolve();
  }
  const result = await first;
  expect(result.operation.state).toBe("broadcast");
  expect(chain.prepared).toEqual([7n]);
  expect(result.attempts).toHaveLength(1);
  await expect(
    second.submitOrder({ ...request, signature: "0x34" }, maker, "parallel-0001"),
  ).rejects.toMatchObject({ status: 409 });
  await second.submitOrder(request, maker, "parallel-0001");
  expect(chain.prepared).toEqual([7n]);
  expect(new Set(chain.broadcasts).size).toBe(1);
  indexer.transactionValue = {
    blockHash: hash,
    blockNumber: "100",
    confirmation: "confirmed",
    hash: result.operation.transactionHash ?? hash,
    status: "success",
  };
  expect((await second.operation(result.operation.operationId, maker)).operation.state).toBe(
    "canonical",
  );
  expect(await store.pendingOperations()).toEqual([]);
  await expect(second.operation(result.operation.operationId, other)).rejects.toMatchObject({
    status: 403,
  });
  await expect(second.operation("missing", maker)).rejects.toMatchObject({ status: 404 });
});

test("broadcast failure retains the outbox; retry never reserves a fresh nonce", async () => {
  const { fixture, chain, indexer, settlement, store, service } = await setup();
  const request = { order: wire, signature: "0x12" };
  chain.broadcastError = true;
  await expect(service.submitOrder(request, maker, "outage-0001")).rejects.toMatchObject({
    status: 503,
  });
  const saved = (await store.pendingOperations())[0];
  if (!saved) throw new Error("outbox fixture missing");
  expect(saved.state).toBe("retryable");
  expect(await store.listAttempts(saved.operationId)).toHaveLength(1);
  chain.broadcastError = false;
  const recovered = new GatewayService(
    env,
    createGatewayQueries(fixture.connect()),
    chain,
    indexer,
    settlement,
  );
  await recovered.reconcilePending();
  expect((await recovered.operation(saved.operationId, maker)).operation.state).toBe("broadcast");
  expect(chain.prepared).toEqual([7n]);
  expect(new Set(chain.broadcasts).size).toBe(1);
});

test("recovery rotates past unprepared requests without blocking new submissions on a slow RPC", async () => {
  const { chain, service } = await setup();
  const request = { order: wire, signature: "0x12" };
  chain.snapshotError = true;
  for (let i = 0; i < 26; i++)
    await expect(service.submitOrder(request, maker, `old-request-${i}`)).rejects.toMatchObject({
      status: 503,
    });
  chain.snapshotError = false;
  chain.broadcastError = true;
  await expect(service.submitOrder(request, maker, "later-outbox-01")).rejects.toMatchObject({
    status: 503,
  });
  chain.broadcastError = false;
  await service.reconcilePending();
  expect(chain.broadcasts).toEqual([]);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  chain.receipt = async () => {
    entered.resolve();
    await release.promise;
    return null;
  };
  const recovery = service.reconcilePending();
  await entered.promise;
  try {
    const newOrder = await service.submitOrder(
      { ...request, order: { ...wire, salt: `0x${"22".repeat(32)}` } },
      maker,
      "new-request-01",
    );
    expect(newOrder.operation.state).toBe("broadcast");
  } finally {
    release.resolve();
    await recovery;
  }
  expect(chain.prepared).toEqual([7n, 8n]);
  expect(chain.broadcasts).toHaveLength(2);
});

test("validation failures are durable, RPC failure is retryable, and an accepted-but-unprepared request resumes", async () => {
  const { chain, service, store } = await setup();
  const request = { order: wire, signature: "0x12" };
  const failures = [
    {
      change: () => {
        chain.balance = 0n;
      },
      reset: () => {
        chain.balance = 10n ** 25n;
      },
      code: GatewayErrorCode.BalanceInsufficient,
    },
    {
      change: () => {
        chain.allowance = 0n;
      },
      reset: () => {
        chain.allowance = 10n ** 25n;
      },
      code: GatewayErrorCode.ApprovalMissing,
    },
    {
      change: () => {
        chain.signatureValid = false;
      },
      reset: () => {
        chain.signatureValid = true;
      },
      code: GatewayErrorCode.SignatureInvalid,
    },
    {
      change: () => {
        chain.simulationError = true;
      },
      reset: () => {
        chain.simulationError = false;
      },
      code: GatewayErrorCode.SimulationFailed,
    },
  ];
  for (const [index, failure] of failures.entries()) {
    failure.change();
    await expect(service.submitOrder(request, maker, `invalid-000${index}`)).rejects.toMatchObject({
      code: failure.code,
    });
    failure.reset();
    expect((await service.submitOrder(request, maker, `invalid-000${index}`)).operation.state).toBe(
      "failed",
    );
  }
  expect(chain.broadcasts).toEqual([]);
  chain.snapshotError = true;
  await expect(service.submitOrder(request, maker, "recover-0001")).rejects.toMatchObject({
    status: 503,
  });
  const saved = (await store.pendingOperations())[0];
  if (!saved) throw new Error("accepted fixture missing");
  expect(saved.error?.message).not.toContain("private database");
  // Equivalent to a process dying between durable acceptance and transaction preparation.
  await store.updateOperation(saved.operationId, { state: "accepted" });
  chain.snapshotError = false;
  expect((await service.submitOrder(request, maker, "recover-0001")).operation.state).toBe(
    "broadcast",
  );
  expect(chain.prepared).toHaveLength(1);
  for (const key of [undefined, "short", "invalid key long"])
    await expect(service.submitOrder(request, maker, key)).rejects.toThrow("Idempotency");
  await expect(service.prepareOrder({ order: wire }, other)).rejects.toMatchObject({ status: 403 });
  expect((await service.prepareOrder({ order: wire }, maker)).fundingReady).toBe(true);
});

test("IOC protection, persisted intent status and empty-fill termination work without a gateway nonce", async () => {
  const { chain, service, ioc } = await setup();
  const request = {
    order: { ...wire, tif: TimeInForce.Ioc },
    signature: "0x12",
    protection: {
      maxQuantity: wire.quantity,
      maxNotional: "200000000",
      worstPriceRawX18: wire.limitPriceRawX18,
    },
  };
  const result = await service.submitOrder(request, maker, "ioc-test-0001");
  expect(result.operation.state).toBe("submitted");
  expect(chain.prepared).toEqual([]);
  expect(ioc.enqueued).toBe(1);
  ioc.state = "unfilled";
  const refreshed = await service.operation(result.operation.operationId, maker);
  expect(refreshed.operation.state).toBe("failed");
  expect(refreshed.operation.error?.code).toBe("ioc-unfilled");
  await expect(
    service.submitOrder(
      { ...request, protection: { ...request.protection, maxNotional: "0" } },
      maker,
      "ioc-bad-0001",
    ),
  ).rejects.toThrow("cover");
  await expect(
    service.submitOrder(
      { ...request, protection: { ...request.protection, maxQuantity: 1 } },
      maker,
      "ioc-bad-0002",
    ),
  ).rejects.toThrow("decimal string");
});

test("user-signed cancellation and position actions share the PostgreSQL outbox without a relayer allocation", async () => {
  const { chain, indexer, service } = await setup();
  indexer.orderValue = {
    confirmation: "confirmed",
    id: hash,
    maker,
    marketId: hash,
    remaining: "1",
    reserved: "1",
    status: "open",
    updatedBlock: "100",
  };
  expect((await service.prepareCancellation({ orderHash: hash }, maker)).transaction.from).toBe(
    maker,
  );
  const cancelled = await service.submitCancellation(
    { orderHash: hash, signedTransaction: "0x1234" },
    maker,
    "cancel-0001",
  );
  expect(cancelled.operation.state).toBe("broadcast");
  expect(
    (
      await service.submitCancellation(
        { orderHash: hash, signedTransaction: "0x1234" },
        maker,
        "cancel-0001",
      )
    ).attempts,
  ).toHaveLength(1);
  const merge = { marketId: hash, recipient: maker, collateral: "quote", amount: "100" };
  chain.approved = false;
  expect((await service.preparePositionAction("merge", merge, maker)).approval).not.toBeNull();
  await expect(
    service.submitPositionAction(
      "merge",
      { ...merge, signedTransaction: "0x1235" },
      maker,
      "merge-0001",
    ),
  ).rejects.toThrow("approval");
  chain.approved = true;
  expect(
    (
      await service.submitPositionAction(
        "merge",
        { ...merge, signedTransaction: "0x1235" },
        maker,
        "merge-0001",
      )
    ).operation.state,
  ).toBe("broadcast");
  if (!indexer.marketValue) throw new Error("market fixture missing");
  indexer.marketValue.state = 6;
  const redeem = { ...merge, collateral: "base", indexSets: ["1", "2"], amounts: ["101", "103"] };
  expect((await service.preparePositionAction("redeem", redeem, maker)).preview).toMatchObject({
    payout: 101n,
  });
  expect(
    (
      await service.submitPositionAction(
        "redeem",
        { ...redeem, signedTransaction: "0x1236" },
        maker,
        "redeem-0001",
      )
    ).operation.state,
  ).toBe("broadcast");
  expect(chain.prepared).toEqual([]);
  for (const body of [
    { ...merge, amount: "0" },
    { ...merge, recipient: "bad" },
    { ...merge, collateral: "invalid" },
  ])
    await expect(service.preparePositionAction("merge", body, maker)).rejects.toBeInstanceOf(
      GatewayError,
    );
  await expect(
    service.preparePositionAction("redeem", { ...redeem, indexSets: ["1", "1"] }, maker),
  ).rejects.toThrow("position set");
  indexer.resolutionValue = null;
  await expect(service.preparePositionAction("redeem", redeem, maker)).rejects.toMatchObject({
    status: 503,
  });
  indexer.orderValue.status = "cancelled";
  await expect(service.prepareCancellation({ orderHash: hash }, maker)).rejects.toThrow(
    "cancelled",
  );
});

test("HTTP failures do not expose database query text and request logging preserves correlation", async () => {
  const { service } = await setup();
  const app = createApp(service);
  const invalid = await app.request("/v1/auth/challenge", { method: "POST", body: "{bad" });
  expect(invalid.status).toBe(400);
  expect(invalid.headers.get("x-request-id")).toBeTruthy();
  service.store.saveChallenge = async () => {
    throw new Error("SQL query with private bound parameters");
  };
  const failed = await app.request("/v1/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ address: maker }),
  });
  expect(failed.status).toBe(500);
  const body = await failed.json();
  expect(body.error.retryable).toBe(true);
  expect(JSON.stringify(body)).not.toContain("SQL query");
  expect((await createApp().request("/ready")).status).toBe(503);
});
