import { AsyncLocalStorage } from "node:async_hooks";
import { canonicalParse, canonicalStringify, hashCanonical } from "@conditional-stocks/orderbook";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { type ApplicationDatabase, boundedLimit, nonceQueries } from "../connection.ts";
import {
  settlementAttempts as attemptRows,
  settlementBatches as batches,
  settlementBooks as books,
  iocIntents as intents,
} from "../schema.ts";
import {
  type BatchStatus,
  type IocIntent,
  SETTLEMENT_SCHEMA_VERSION,
  type SettlementAttempt,
  type SettlementBatch,
  type SettlementBatchPayload,
} from "./types.ts";

const pending = ["queued", "simulated", "submitted", "mined"];
const terminal = ["confirmed", "failed", "quarantined"];
const now = () => BigInt(Date.now());
const parse = <T>(row: { payload: string } | undefined): T | null =>
  row ? canonicalParse<T>(row.payload) : null;
export function createSettlementQueries(database: ApplicationDatabase) {
  const ownership = new AsyncLocalStorage<{
    batchId: Hex;
    owner: string;
    token: bigint;
    ttlMs: bigint;
  }>();
  const db = () => database.session;
  const { allocateNonce, peekNonce } = nonceQueries(database);
  const locked = <T>(id: string, work: () => Promise<T>) =>
    database.locked(`settlement:batch:${id}`, work);
  async function getBatch(batchId: Hex): Promise<SettlementBatch | null> {
    const result = parse<SettlementBatch>(
      (
        await db()
          .select({ payload: batches.payload })
          .from(batches)
          .where(eq(batches.batchId, batchId))
      )[0],
    );
    if (result && result.payload.schemaVersion !== SETTLEMENT_SCHEMA_VERSION)
      throw new Error("Unsupported settlement payload version");
    return result;
  }
  async function enqueue(batchId: Hex, payload: SettlementBatchPayload): Promise<SettlementBatch> {
    if (payload.schemaVersion !== SETTLEMENT_SCHEMA_VERSION)
      throw new Error("Unsupported settlement payload version");
    const payloadHash = hashCanonical(payload);
    return locked(batchId, async () => {
      const existing = await getBatch(batchId);
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new Error("settlement batch id collision");
        return existing;
      }
      const atMs = now();
      const batch: SettlementBatch = {
        batchId,
        createdAtMs: atMs,
        error: null,
        feedbackDeliveredAtMs: null,
        leaseExpiresAtMs: null,
        leaseOwner: null,
        leaseToken: 0n,
        minedBlockNumber: null,
        payload,
        payloadHash,
        simulationBlock: null,
        status: "queued",
        updatedAtMs: atMs,
      };
      await db()
        .insert(batches)
        .values({
          batchId,
          status: batch.status,
          payloadHash,
          intentId: payload.kind === "ioc" ? payload.intentId : null,
          payload: canonicalStringify(batch),
        });
      const orders =
        payload.kind === "ioc"
          ? [payload.takerOrder]
          : payload.proposal.fills.map((fill) => fill.buyOrder);
      const unique = [
        ...new Map(
          orders.map((order) => [
            `${order.marketId}:${order.branch}`,
            { batchId, marketId: order.marketId, branch: order.branch },
          ]),
        ).values(),
      ];
      if (unique.length) await db().insert(books).values(unique);
      return batch;
    });
  }
  async function writeBatch(batch: SettlementBatch) {
    await db()
      .update(batches)
      .set({
        status: batch.status,
        feedbackPending: batch.feedbackDeliveredAtMs === null && terminal.includes(batch.status),
        payload: canonicalStringify(batch),
      })
      .where(eq(batches.batchId, batch.batchId));
  }
  async function claim(batchId: Hex, owner: string, atMs: bigint, ttlMs: bigint) {
    if (!owner || ttlMs <= 0n) throw new RangeError("invalid worker lease");
    return locked(batchId, async () => {
      atMs = await database.nowMs();
      const batch = await getBatch(batchId);
      if (!batch || terminal.includes(batch.status)) return null;
      if (batch.leaseOwner && batch.leaseOwner !== owner && (batch.leaseExpiresAtMs ?? 0n) > atMs)
        return null;
      batch.leaseOwner = owner;
      batch.leaseToken += 1n;
      batch.leaseExpiresAtMs = atMs + ttlMs;
      batch.updatedAtMs = atMs;
      await writeBatch(batch);
      return batch;
    });
  }
  async function withClaim<T>(
    batchId: Hex,
    owner: string,
    ttlMs: bigint,
    work: (batch: SettlementBatch) => Promise<T>,
  ): Promise<T | SettlementBatch> {
    const batch = await claim(batchId, owner, 0n, ttlMs);
    if (!batch) {
      const existing = await getBatch(batchId);
      if (!existing) throw new Error("settlement batch is missing");
      return existing;
    }
    return ownership.run({ batchId, owner, token: batch.leaseToken, ttlMs }, () => work(batch));
  }
  async function assertOwnership(batchId: Hex): Promise<SettlementBatch> {
    const grant = ownership.getStore();
    const batch = await getBatch(batchId);
    if (
      !grant ||
      grant.batchId !== batchId ||
      !batch ||
      terminal.includes(batch.status) ||
      batch.leaseOwner !== grant.owner ||
      batch.leaseToken !== grant.token ||
      (batch.leaseExpiresAtMs ?? 0n) <= (await database.nowMs())
    )
      throw new Error("settlement worker lease lost; stale owner is fenced");
    return batch;
  }
  async function renewClaim(batchId: Hex): Promise<void> {
    await locked(batchId, async () => {
      const batch = await assertOwnership(batchId);
      batch.leaseExpiresAtMs = (await database.nowMs()) + (ownership.getStore()?.ttlMs ?? 0n);
      await writeBatch(batch);
    });
  }
  async function listProcessable(limit = 100): Promise<SettlementBatch[]> {
    return (
      await db()
        .select({ payload: batches.payload })
        .from(batches)
        .where(inArray(batches.status, pending))
        .orderBy(asc(batches.sequence))
        .limit(boundedLimit(limit))
    ).map((row) => canonicalParse<SettlementBatch>(row.payload));
  }
  async function hasProcessableBook(marketId: Hex, branch: number) {
    return (
      (
        await db()
          .select({ id: books.batchId })
          .from(books)
          .innerJoin(batches, eq(books.batchId, batches.batchId))
          .where(
            and(
              eq(books.marketId, marketId),
              eq(books.branch, branch),
              inArray(batches.status, pending),
            ),
          )
          .limit(1)
      ).length !== 0
    );
  }
  async function transition(
    batchId: Hex,
    status: BatchStatus,
    update: Partial<Pick<SettlementBatch, "error" | "minedBlockNumber" | "simulationBlock">> = {},
  ) {
    return locked(batchId, async () => {
      const batch = await assertOwnership(batchId);
      const allowed: Record<BatchStatus, BatchStatus[]> = {
        queued: ["simulated", "quarantined", "failed"],
        simulated: ["simulated", "submitted", "quarantined", "failed"],
        submitted: ["submitted", "mined", "quarantined", "failed"],
        mined: ["mined", "submitted", "confirmed", "quarantined", "failed"],
        confirmed: [],
        failed: [],
        quarantined: [],
      };
      if (!allowed[batch.status].includes(status))
        throw new Error(`invalid settlement transition ${batch.status} -> ${status}`);
      Object.assign(batch, update, { status, updatedAtMs: now() });
      if (terminal.includes(status)) {
        batch.leaseOwner = null;
        batch.leaseExpiresAtMs = null;
        batch.feedbackDeliveredAtMs = null;
      }
      await writeBatch(batch);
      return batch;
    });
  }
  async function listFeedbackPending(limit = 100): Promise<SettlementBatch[]> {
    return (
      await db()
        .select({ payload: batches.payload })
        .from(batches)
        .where(eq(batches.feedbackPending, true))
        .orderBy(asc(batches.sequence))
        .limit(boundedLimit(limit))
    ).map((row) => canonicalParse<SettlementBatch>(row.payload));
  }
  async function markFeedbackDelivered(batchId: Hex, atMs: bigint) {
    await locked(batchId, async () => {
      const batch = await getBatch(batchId);
      if (!batch) throw new Error("settlement batch is missing");
      batch.feedbackDeliveredAtMs = atMs;
      batch.updatedAtMs = atMs;
      await writeBatch(batch);
    });
  }
  const attemptKey = (batchId: Hex, callIndex: number, attempt: number) =>
    and(
      eq(attemptRows.batchId, batchId),
      eq(attemptRows.callIndex, callIndex),
      eq(attemptRows.attempt, attempt),
    );
  async function getAttempt(batchId: Hex, callIndex: number, attempt: number) {
    return parse<SettlementAttempt>(
      (
        await db()
          .select({ payload: attemptRows.payload })
          .from(attemptRows)
          .where(attemptKey(batchId, callIndex, attempt))
      )[0],
    );
  }
  async function addAttempt(attempt: SettlementAttempt): Promise<SettlementAttempt> {
    return locked(attempt.batchId, async () => {
      await assertOwnership(attempt.batchId);
      const existing = await getAttempt(attempt.batchId, attempt.callIndex, attempt.attempt);
      if (existing) {
        if (
          existing.transactionHash !== attempt.transactionHash ||
          existing.rawTransaction !== attempt.rawTransaction ||
          existing.nonce !== attempt.nonce
        )
          throw new Error("settlement attempt collision");
        return existing;
      }
      await db()
        .insert(attemptRows)
        .values({
          batchId: attempt.batchId,
          callIndex: attempt.callIndex,
          attempt: attempt.attempt,
          transactionHash: attempt.transactionHash,
          nonce: attempt.nonce,
          payload: canonicalStringify(attempt),
        });
      return attempt;
    });
  }
  async function attempts(batchId: Hex, callIndex?: number): Promise<SettlementAttempt[]> {
    return (
      await db()
        .select({ payload: attemptRows.payload })
        .from(attemptRows)
        .where(
          and(
            eq(attemptRows.batchId, batchId),
            callIndex === undefined ? undefined : eq(attemptRows.callIndex, callIndex),
          ),
        )
        .orderBy(asc(attemptRows.callIndex), asc(attemptRows.attempt))
    ).map((row) => canonicalParse<SettlementAttempt>(row.payload));
  }
  async function updateAttempt(
    batchId: Hex,
    callIndex: number,
    attemptNumber: number,
    status: SettlementAttempt["status"],
  ) {
    await locked(batchId, async () => {
      await assertOwnership(batchId);
      const attempt = await getAttempt(batchId, callIndex, attemptNumber);
      if (!attempt) throw new Error("settlement attempt is missing");
      if (attempt.status === status) return;
      attempt.status = status;
      attempt.updatedAtMs = now();
      await db()
        .update(attemptRows)
        .set({ payload: canonicalStringify(attempt) })
        .where(attemptKey(batchId, callIndex, attemptNumber));
    });
  }
  async function persistPreparedBatch(
    address: Address,
    pendingNonce: bigint,
    values: SettlementAttempt[],
  ) {
    await database.transaction(async () => {
      for (const attempt of values) {
        if ((await allocateNonce(address, pendingNonce)) !== attempt.nonce)
          throw new Error("nonce ownership changed while preparing settlement");
        await addAttempt(attempt);
      }
    });
  }
  async function waitingIntents(limit = 100): Promise<IocIntent[]> {
    return (
      await db()
        .select({ payload: intents.payload })
        .from(intents)
        .where(eq(intents.status, "waiting-match"))
        .orderBy(asc(intents.sequence))
        .limit(boundedLimit(limit))
    ).map((row) => canonicalParse<IocIntent>(row.payload));
  }
  async function getIntent(intentId: Hex) {
    return parse<IocIntent>(
      (
        await db()
          .select({ payload: intents.payload })
          .from(intents)
          .where(eq(intents.intentId, intentId))
      )[0],
    );
  }
  async function finishIntent(intentId: Hex, status: "unfilled" | "expired") {
    await database.locked(`settlement:intent:${intentId}`, async () => {
      const intent = await getIntent(intentId);
      if (intent?.status !== "waiting-match") return;
      await db()
        .update(intents)
        .set({ status, payload: canonicalStringify({ ...intent, status }) })
        .where(eq(intents.intentId, intentId));
    });
  }
  async function batchForIntent(intentId: Hex) {
    return parse<SettlementBatch>(
      (
        await db()
          .select({ payload: batches.payload })
          .from(batches)
          .where(eq(batches.intentId, intentId))
          .orderBy(desc(batches.sequence))
          .limit(1)
      )[0],
    );
  }
  async function markIntentPlanned(intentId: Hex) {
    await database.locked(`settlement:intent:${intentId}`, async () => {
      const intent = await getIntent(intentId);
      if (!intent) throw new Error("IOC intent not found");
      if (intent.status !== "waiting-match" && intent.status !== "planned")
        throw new Error("IOC intent is terminal");
      await db()
        .update(intents)
        .set({ status: "planned", payload: canonicalStringify({ ...intent, status: "planned" }) })
        .where(eq(intents.intentId, intentId));
    });
  }
  async function enqueuePlannedIntent(
    batchId: Hex,
    payload: SettlementBatchPayload,
    intentId: Hex,
  ) {
    return database.locked(`settlement:intent:${intentId}`, async () => {
      const existing = await batchForIntent(intentId);
      if (existing && existing.batchId !== batchId)
        throw new Error("IOC intent already has a settlement batch");
      const batch = await enqueue(batchId, payload);
      await markIntentPlanned(intentId);
      return batch;
    });
  }
  async function enqueueIntent(intent: IocIntent) {
    return database.locked(`settlement:intent:${intent.intentId}`, async () => {
      const existing = await getIntent(intent.intentId);
      if (existing) {
        if (hashCanonical(existing) !== hashCanonical(intent))
          throw new Error("IOC intent collision");
        return existing;
      }
      await db()
        .insert(intents)
        .values({
          intentId: intent.intentId,
          status: intent.status,
          payload: canonicalStringify(intent),
        });
      return intent;
    });
  }
  return {
    withClaim,
    renewClaim,
    enqueue,
    getBatch,
    claim,
    listProcessable,
    hasProcessableBook,
    transition,
    listFeedbackPending,
    markFeedbackDelivered,
    addAttempt,
    getAttempt,
    attempts,
    updateAttempt,
    allocateNonce,
    peekNonce,
    persistPreparedBatch,
    waitingIntents,
    finishIntent,
    batchForIntent,
    enqueuePlannedIntent,
    enqueueIntent,
    getIntent,
    markIntentPlanned,
    close: database.close,
  };
}
export type SettlementQueries = ReturnType<typeof createSettlementQueries>;
