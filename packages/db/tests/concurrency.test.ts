import { expect, test } from "bun:test";
import {
  canonicalStringify,
  MATCHER_ENGINE_VERSION,
  MATCHER_SCHEMA_VERSION,
} from "@conditional-stocks/orderbook";
import { eq } from "drizzle-orm";
import {
  createGatewayQueries,
  OperationLeaseLost,
  OperationLeaseUnavailable,
} from "../src/gateway/queries.ts";
import { gatewayOperations, settlementBatches } from "../src/schema.ts";
import { createSettlementQueries } from "../src/settlement/queries.ts";
import type { SettlementBatchPayload } from "../src/settlement/types.ts";
import { testDatabase } from "../src/testing.ts";

const address = "0x1000000000000000000000000000000000000001";
const hash = `0x${"11".repeat(32)}` as const;
const operation = {
  address: address as `0x${string}`,
  canonicalState: null,
  error: null,
  finalReceipt: null,
  idempotencyKey: "concurrency-01",
  kind: "order" as const,
  operationId: "operation",
  orderHash: hash,
  payload: {},
  requestDigest: hash,
  state: "accepted" as const,
  transactionHash: null,
};
const batch: SettlementBatchPayload = {
  kind: "gtc",
  schemaVersion: 2,
  proposal: {
    batchId: hash,
    proposalId: hash,
    bookKey: `${hash}:0`,
    decisions: [],
    fills: [],
    preBookHash: hash,
    schemaVersion: MATCHER_SCHEMA_VERSION,
    engineVersion: MATCHER_ENGINE_VERSION,
    cursor: {
      blockHash: hash,
      blockNumber: 1n,
      blockTimestamp: 1n,
      chainId: 31337n,
      logIndex: 0,
      transactionHash: hash,
      transactionIndex: 0,
    },
  },
};

test("operation leases reject competing requests and fence expired writers across independent pools", async () => {
  const fixture = await testDatabase();
  const a = createGatewayQueries(fixture.database);
  const b = createGatewayQueries(fixture.connect());
  const results = await Promise.all([
    a.beginOperation(operation),
    b.beginOperation({ ...operation, operationId: "duplicate" }),
  ]);
  expect(results.filter((result) => result.created)).toHaveLength(1);
  const id = results[0]?.operation.operationId;
  if (!id) throw new Error("operation fixture missing");
  await a.withOperation(id, async () => {
    await a.withOperation(id, async () => {
      await a.renewOperation(id);
    });
    await expect(b.withOperation(id, async () => "must not execute")).rejects.toBeInstanceOf(
      OperationLeaseUnavailable,
    );
    await expect(b.updateOperation(id, { state: "failed" })).rejects.toBeInstanceOf(
      OperationLeaseUnavailable,
    );
    await fixture.db
      .update(gatewayOperations)
      .set({ leaseExpiresAtMs: 0n })
      .where(eq(gatewayOperations.operationId, id));
    await b.withOperation(id, async () => {
      await b.updateOperation(id, { state: "canonical" });
      await expect(a.updateOperation(id, { state: "retryable" })).rejects.toBeInstanceOf(
        OperationLeaseLost,
      );
      await expect(a.renewOperation(id)).rejects.toBeInstanceOf(OperationLeaseLost);
      await expect(
        a.persistPreparedAttempt(
          {
            operationId: id,
            attempt: 0,
            nonce: 1n,
            createdAtMs: 1n,
            replaces: null,
            rawTransaction: "0x12",
            transactionHash: hash,
          },
          { address, pendingNonce: 1n },
        ),
      ).rejects.toBeInstanceOf(OperationLeaseLost);
    });
  });
  expect((await b.getOperation(id))?.state).toBe("canonical");
  expect(await b.peekNonce(address, 1n)).toBe(1n);
  expect(await b.listAttempts(id)).toEqual([]);
  await expect(
    a.withOperation(id, async () => {
      throw new Error("injected failure");
    }),
  ).rejects.toThrow("injected failure");
  expect(await b.withOperation(id, async () => "recovered")).toBe("recovered");
  await expect(a.withOperation(id, async () => {}, 0n)).rejects.toThrow("duration");
  await expect(a.withOperation("missing", async () => {})).rejects.toThrow("not found");
  await expect(a.renewOperation(id)).rejects.toBeInstanceOf(OperationLeaseLost);
});

test("an old request cannot release the lease of a replacement request", async () => {
  const fixture = await testDatabase();
  const a = createGatewayQueries(fixture.database);
  const b = createGatewayQueries(fixture.connect());
  await a.beginOperation(operation);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let replacement: Promise<void> | undefined;
  await a.withOperation(operation.operationId, async () => {
    await fixture.db
      .update(gatewayOperations)
      .set({ leaseExpiresAtMs: 0n })
      .where(eq(gatewayOperations.operationId, operation.operationId));
    replacement = b.withOperation(operation.operationId, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
  });
  try {
    await expect(a.withOperation(operation.operationId, async () => {})).rejects.toBeInstanceOf(
      OperationLeaseUnavailable,
    );
  } finally {
    release.resolve();
    await replacement;
  }
});

test("settlement claims use server time, fence takeover and do not reopen terminal batches", async () => {
  const fixture = await testDatabase();
  const a = createSettlementQueries(fixture.database);
  const b = createSettlementQueries(fixture.connect());
  await a.enqueue(hash, batch);
  await a.withClaim(hash, "owner-a", 60_000n, async () => {
    expect(await b.claim(hash, "owner-b", 1n << 200n, 60_000n)).toBeNull();
    await a.renewClaim(hash);
    const existing = await a.getBatch(hash);
    if (!existing) throw new Error("batch fixture missing");
    await fixture.db
      .update(settlementBatches)
      .set({ payload: canonicalStringify({ ...existing, leaseExpiresAtMs: 0n }) })
      .where(eq(settlementBatches.batchId, hash));
    await b.withClaim(hash, "owner-b", 60_000n, async (newer) => {
      expect(newer.leaseToken).toBe(existing.leaseToken + 1n);
      await b.transition(hash, "simulated");
      await expect(a.transition(hash, "failed")).rejects.toThrow("stale owner");
      await expect(a.renewClaim(hash)).rejects.toThrow("stale owner");
      await expect(b.transition(hash, "confirmed")).rejects.toThrow(
        "invalid settlement transition",
      );
      await b.transition(hash, "failed");
      await expect(b.transition(hash, "simulated")).rejects.toThrow("stale owner");
    });
  });
  expect(await a.claim(hash, "owner-a", 0n, 60_000n)).toBeNull();
  expect((await b.getBatch(hash))?.status).toBe("failed");
  expect(await b.listProcessable()).toEqual([]);
  expect(await b.listFeedbackPending()).toHaveLength(1);
  await b.markFeedbackDelivered(hash, 1n);
  expect(await b.listFeedbackPending()).toEqual([]);
});

test("transaction failures never implicitly replay in-memory side effects", async () => {
  const { database } = await testDatabase();
  for (const code of ["40001", "40P01", "08006"]) {
    let calls = 0;
    await expect(
      database.transaction(async () => {
        calls++;
        throw Object.assign(new Error("injected rollback"), { code });
      }),
    ).rejects.toThrow("injected rollback");
    expect(calls).toBe(1);
  }
});
