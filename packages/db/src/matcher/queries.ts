import {
  assertCursorContinuity,
  CanonicalInputError,
  canonicalParse,
  canonicalStringify,
  compareCursors,
  cursorKey,
  hashCanonical,
  normalizeMatcherEnvelope,
} from "@conditional-stocks/orderbook";
import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { Hex } from "viem";
import type { ApplicationDatabase } from "../connection.ts";
import {
  matcherCheckpoints as checkpoints,
  matcherDecisions as decisions,
  matcherEvents as events,
  matcherLeases as leases,
  matcherProposals as proposals,
} from "../schema.ts";
import { decisionFingerprint } from "./decisions.ts";
import { FencingError } from "./memory.ts";
import {
  ACTIVE_PROPOSAL_STATUSES,
  type FairnessDecision,
  type JournalEvent,
  type LeaseGrant,
  type MatcherStore,
  ProposalStatus,
  type ReceiptRecord,
  type RewindResult,
  type SimulationRecord,
  type StoredCheckpoint,
  type StoredProposal,
} from "./types.ts";

const active = ["persisted", "submitted", "mined"];
const parse = <T>(row: { payload: string } | undefined): T | null =>
  row ? canonicalParse<T>(row.payload) : null;
const eventRow = (row: { eventIndex: bigint; payload: string }): JournalEvent => ({
  ...canonicalParse<Omit<JournalEvent, "duplicateDelivery" | "index">>(row.payload),
  duplicateDelivery: false,
  index: row.eventIndex,
});
const initialFills = (proposal: StoredProposal["proposal"]) =>
  proposal.fills.map((fill) => ({
    buyOrderHash: fill.buyOrderHash,
    sellOrderHash: fill.sellOrderHash,
    fillQuantity: fill.fillQuantity,
    remainingQuantity: fill.fillQuantity,
  }));
function setStatus(
  proposal: StoredProposal,
  status: ProposalStatus,
  atMs: bigint,
  eventIndex: bigint | null,
  reason: string | null,
) {
  if (proposal.status === status && proposal.history.at(-1)?.eventIndex === eventIndex) return;
  proposal.status = status;
  if (eventIndex !== null) proposal.lastCanonicalEventIndex = eventIndex;
  proposal.history.push({ atMs, eventIndex, reason, status });
}
function assertExternalTransition(current: ProposalStatus, next: ProposalStatus) {
  if (current === next) return;
  if (
    !(
      (next === ProposalStatus.Submitted && current === ProposalStatus.Persisted) ||
      (next === ProposalStatus.Mined && current === ProposalStatus.Submitted) ||
      (next === ProposalStatus.Failed &&
        (current === ProposalStatus.Persisted || current === ProposalStatus.Submitted))
    )
  )
    throw new CanonicalInputError(`invalid external proposal transition ${current} -> ${next}`);
}

export function createMatcherQueries(database: ApplicationDatabase) {
  const db = () => database.session;
  // Canonical journal mutations are ordered across owners. This lock is scoped to matching,
  // never held during RPC/network work, and never blocks gateway/indexer/settlement writes.
  const mutate = <T>(work: () => Promise<T>) => database.locked("matching:journal", work);
  async function leaseRow(bookKey: string) {
    return (await db().select().from(leases).where(eq(leases.bookKey, bookKey)))[0];
  }
  async function assertLease(lease: LeaseGrant, nowMs: bigint) {
    nowMs = await database.nowMs();
    const current = await leaseRow(lease.bookKey);
    if (
      !current ||
      current.ownerId !== lease.ownerId ||
      current.fencingToken !== lease.fencingToken ||
      current.expiresAtMs <= nowMs
    )
      throw new FencingError(`stale fencing token for ${lease.bookKey}`);
  }
  async function acquireLease(
    bookKey: string,
    ownerId: string,
    nowMs: bigint,
    ttlMs: bigint,
  ): Promise<LeaseGrant | null> {
    if (ttlMs <= 0n || !ownerId) throw new RangeError("invalid matcher lease");
    return mutate(async () => {
      nowMs = await database.nowMs();
      const row = await leaseRow(bookKey);
      if (row && row.expiresAtMs > nowMs && row.ownerId !== ownerId) return null;
      const lease: LeaseGrant = {
        bookKey,
        ownerId,
        expiresAtMs: nowMs + ttlMs,
        fencingToken:
          row && row.expiresAtMs > nowMs ? row.fencingToken : (row?.fencingToken ?? 0n) + 1n,
      };
      await db()
        .insert(leases)
        .values(lease)
        .onConflictDoUpdate({ target: leases.bookKey, set: lease });
      return lease;
    });
  }
  async function renewLease(
    lease: LeaseGrant,
    nowMs: bigint,
    ttlMs: bigint,
  ): Promise<LeaseGrant | null> {
    if (ttlMs <= 0n) throw new RangeError("invalid matcher lease");
    return mutate(async () => {
      nowMs = await database.nowMs();
      const current = await leaseRow(lease.bookKey);
      if (
        !current ||
        current.ownerId !== lease.ownerId ||
        current.fencingToken !== lease.fencingToken ||
        current.expiresAtMs <= nowMs
      )
        return null;
      const renewed = { ...lease, expiresAtMs: nowMs + ttlMs };
      await db()
        .update(leases)
        .set({ expiresAtMs: renewed.expiresAtMs })
        .where(eq(leases.bookKey, lease.bookKey));
      return renewed;
    });
  }
  async function latestCanonicalEvent(): Promise<JournalEvent | null> {
    const [row] = await db()
      .select({ eventIndex: events.eventIndex, payload: events.payload })
      .from(events)
      .where(eq(events.canonical, true))
      .orderBy(desc(events.eventIndex))
      .limit(1);
    return row ? eventRow(row) : null;
  }
  async function findCanonicalEvent(input: JournalEvent["envelope"]): Promise<JournalEvent | null> {
    const envelope = normalizeMatcherEnvelope(input);
    const hash = hashCanonical(envelope);
    const [row] = await db()
      .select({ eventIndex: events.eventIndex, payload: events.payload })
      .from(events)
      .where(and(eq(events.canonical, true), eq(events.cursorKey, cursorKey(envelope.cursor))));
    if (!row) return null;
    const stored = eventRow(row);
    if (compareCursors(stored.envelope.cursor, envelope.cursor) !== 0 || stored.eventHash !== hash)
      throw new CanonicalInputError("journal has conflicting canonical events at one cursor");
    return { ...stored, duplicateDelivery: true };
  }
  async function appendEvent(input: JournalEvent["envelope"]): Promise<JournalEvent> {
    const envelope = normalizeMatcherEnvelope(input);
    const hash = hashCanonical(envelope);
    return mutate(async () => {
      const latest = await latestCanonicalEvent();
      if (latest) {
        if (compareCursors(envelope.cursor, latest.envelope.cursor) <= 0) {
          const existing = await findCanonicalEvent(envelope);
          if (!existing) throw new CanonicalInputError("journal cursor moved backwards");
          return existing;
        }
        assertCursorContinuity(latest.envelope.cursor, envelope.cursor);
      }
      const stored = { canonical: true, envelope, eventHash: hash };
      const [row] = await db()
        .insert(events)
        .values({
          canonical: true,
          blockNumber: envelope.cursor.blockNumber,
          cursorKey: cursorKey(envelope.cursor),
          eventHash: hash,
          payload: canonicalStringify(stored),
        })
        .returning({ eventIndex: events.eventIndex });
      if (!row) throw new Error("journal insert failed");
      return { ...stored, duplicateDelivery: false, index: row.eventIndex };
    });
  }
  async function eventsAfter(eventIndex: bigint): Promise<JournalEvent[]> {
    return (
      await db()
        .select({ eventIndex: events.eventIndex, payload: events.payload })
        .from(events)
        .where(and(eq(events.canonical, true), gt(events.eventIndex, eventIndex)))
        .orderBy(asc(events.eventIndex))
    ).map(eventRow);
  }
  async function getLatestEventIndex() {
    const [row] = await db()
      .select({ index: events.eventIndex })
      .from(events)
      .where(eq(events.canonical, true))
      .orderBy(desc(events.eventIndex))
      .limit(1);
    return row?.index ?? 0n;
  }
  async function saveCheckpoint(checkpoint: StoredCheckpoint["checkpoint"], eventIndex: bigint) {
    await mutate(async () => {
      if (eventIndex > (await getLatestEventIndex()))
        throw new CanonicalInputError("checkpoint is ahead of the event journal");
      const existing = parse<StoredCheckpoint>(
        (
          await db()
            .select({ payload: checkpoints.payload })
            .from(checkpoints)
            .where(eq(checkpoints.eventIndex, eventIndex))
        )[0],
      );
      if (existing) {
        if (existing.checkpoint.checkpointHash !== checkpoint.checkpointHash)
          throw new CanonicalInputError("conflicting checkpoints share an event index");
        return;
      }
      await db()
        .insert(checkpoints)
        .values({ eventIndex, payload: canonicalStringify({ checkpoint, eventIndex }) });
    });
  }
  async function getLatestCheckpoint() {
    return parse<StoredCheckpoint>(
      (
        await db()
          .select({ payload: checkpoints.payload })
          .from(checkpoints)
          .where(
            or(
              eq(checkpoints.eventIndex, 0n),
              sql`EXISTS (SELECT 1 FROM ${events} WHERE ${events.eventIndex} = ${checkpoints.eventIndex} AND ${events.canonical})`,
            ),
          )
          .orderBy(desc(checkpoints.eventIndex))
          .limit(1)
      )[0],
    );
  }
  async function getProposal(proposalId: Hex) {
    return parse<StoredProposal>(
      (
        await db()
          .select({ payload: proposals.payload })
          .from(proposals)
          .where(eq(proposals.proposalId, proposalId))
      )[0],
    );
  }
  async function listActiveProposals(): Promise<StoredProposal[]> {
    return (
      await db()
        .select({ payload: proposals.payload })
        .from(proposals)
        .where(inArray(proposals.status, active))
        .orderBy(asc(proposals.proposalId))
    ).map((row) => canonicalParse<StoredProposal>(row.payload));
  }
  async function writeProposal(proposal: StoredProposal) {
    await db()
      .update(proposals)
      .set({
        status: proposal.status,
        createdAfterEventIndex: proposal.createdAfterEventIndex,
        lastCanonicalEventIndex: proposal.lastCanonicalEventIndex,
        payload: canonicalStringify(proposal),
      })
      .where(eq(proposals.proposalId, proposal.proposal.proposalId));
  }
  async function persistProposal(
    proposal: StoredProposal["proposal"],
    lease: LeaseGrant,
    createdAfterEventIndex: bigint,
    nowMs: bigint,
  ): Promise<StoredProposal> {
    return mutate(async () => {
      await assertLease(lease, nowMs);
      if (lease.bookKey !== proposal.bookKey)
        throw new CanonicalInputError("proposal belongs to another lease");
      if (createdAfterEventIndex !== (await getLatestEventIndex()))
        throw new CanonicalInputError("proposal is not anchored to the journal head");
      const existing = await getProposal(proposal.proposalId);
      if (existing) {
        if (hashCanonical(existing.proposal) !== hashCanonical(proposal))
          throw new CanonicalInputError("proposal id collision");
        if (ACTIVE_PROPOSAL_STATUSES.has(existing.status)) return existing;
        if (
          ![ProposalStatus.Failed, ProposalStatus.Invalidated, ProposalStatus.Reorged].includes(
            existing.status as "failed" | "invalidated" | "reorged",
          )
        )
          throw new CanonicalInputError("confirmed proposal cannot be reactivated");
        Object.assign(existing, {
          createdAfterEventIndex,
          fencingToken: lease.fencingToken,
          lastCanonicalEventIndex: null,
          receipt: null,
          remainingFills: initialFills(proposal),
          simulation: null,
          status: ProposalStatus.Persisted,
          transactionHash: null,
        });
        existing.history.push({
          atMs: nowMs,
          eventIndex: null,
          reason: "deterministic reproposal",
          status: ProposalStatus.Persisted,
        });
        await writeProposal(existing);
        return existing;
      }
      const [activeForBook] = await db()
        .select({ id: proposals.proposalId })
        .from(proposals)
        .where(and(eq(proposals.bookKey, proposal.bookKey), inArray(proposals.status, active)))
        .limit(1);
      if (activeForBook)
        throw new CanonicalInputError(`book already has active proposal ${activeForBook.id}`);
      const record: StoredProposal = {
        createdAfterEventIndex,
        fencingToken: lease.fencingToken,
        history: [
          { atMs: nowMs, eventIndex: null, reason: null, status: ProposalStatus.Persisted },
        ],
        lastCanonicalEventIndex: null,
        proposal,
        receipt: null,
        remainingFills: initialFills(proposal),
        simulation: null,
        status: ProposalStatus.Persisted,
        transactionHash: null,
      };
      await db()
        .insert(proposals)
        .values({
          proposalId: proposal.proposalId,
          bookKey: proposal.bookKey,
          status: record.status,
          createdAfterEventIndex,
          payload: canonicalStringify(record),
        });
      return record;
    });
  }
  async function reconcileCanonicalEvent(
    event: JournalEvent,
    invalidatedProposalIds: readonly Hex[],
    nowMs: bigint,
  ) {
    await mutate(async () => {
      const [storedEvent] = await db()
        .select({ hash: events.eventHash })
        .from(events)
        .where(and(eq(events.eventIndex, event.index), eq(events.canonical, true)));
      if (!storedEvent || storedEvent.hash !== event.eventHash)
        throw new CanonicalInputError("cannot reconcile a non-canonical event");
      for (const id of invalidatedProposalIds) {
        const proposal = await getProposal(id);
        if (!proposal || !ACTIVE_PROPOSAL_STATUSES.has(proposal.status)) continue;
        setStatus(
          proposal,
          ProposalStatus.Invalidated,
          nowMs,
          event.index,
          `invalidated by ${event.envelope.event.type}`,
        );
        await writeProposal(proposal);
      }
      const chainEvent = event.envelope.event;
      if (chainEvent.type !== "order-filled") return;
      const rows = await db()
        .select({ payload: proposals.payload })
        .from(proposals)
        .where(
          and(
            inArray(proposals.status, active),
            sql`${proposals.createdAfterEventIndex} < ${event.index.toString()}::numeric`,
          ),
        )
        .orderBy(asc(proposals.createdAfterEventIndex), asc(proposals.proposalId));
      for (const row of rows) {
        const proposal = canonicalParse<StoredProposal>(row.payload);
        if (
          proposal.lastCanonicalEventIndex !== null &&
          proposal.lastCanonicalEventIndex >= event.index
        )
          continue;
        const fill = proposal.remainingFills.find(
          (item) =>
            item.remainingQuantity > 0n &&
            item.buyOrderHash === chainEvent.buyOrderHash &&
            item.sellOrderHash === chainEvent.sellOrderHash,
        );
        if (!fill) continue;
        if (chainEvent.fillQuantity > fill.remainingQuantity)
          throw new CanonicalInputError("canonical fill exceeds stored proposal reservation");
        fill.remainingQuantity -= chainEvent.fillQuantity;
        proposal.lastCanonicalEventIndex = event.index;
        if (proposal.remainingFills.every((item) => item.remainingQuantity === 0n))
          setStatus(proposal, ProposalStatus.Confirmed, nowMs, event.index, null);
        await writeProposal(proposal);
        break;
      }
    });
  }
  async function transitionProposal(
    proposalId: Hex,
    status: ProposalStatus,
    lease: LeaseGrant,
    nowMs: bigint,
    reason?: string,
  ) {
    return mutate(async () => {
      await assertLease(lease, nowMs);
      const proposal = await getProposal(proposalId);
      if (!proposal || proposal.proposal.bookKey !== lease.bookKey)
        throw new CanonicalInputError("proposal is missing or belongs to another lease");
      assertExternalTransition(proposal.status, status);
      setStatus(proposal, status, nowMs, null, reason ?? null);
      await writeProposal(proposal);
      return proposal;
    });
  }
  async function updateSettlement(
    proposalId: Hex,
    lease: LeaseGrant,
    nowMs: bigint,
    update: { receipt?: ReceiptRecord; simulation?: SimulationRecord; transactionHash?: Hex },
  ) {
    return mutate(async () => {
      await assertLease(lease, nowMs);
      const proposal = await getProposal(proposalId);
      if (!proposal || proposal.proposal.bookKey !== lease.bookKey)
        throw new CanonicalInputError("proposal is missing or belongs to another lease");
      if (
        update.transactionHash &&
        proposal.transactionHash &&
        proposal.transactionHash !== update.transactionHash
      )
        throw new CanonicalInputError("proposal transaction hash is immutable");
      if (
        update.receipt &&
        proposal.receipt &&
        canonicalStringify(proposal.receipt) !== canonicalStringify(update.receipt)
      )
        throw new CanonicalInputError("proposal receipt is immutable");
      Object.assign(proposal, update);
      await writeProposal(proposal);
      return proposal;
    });
  }
  async function appendDecision(decision: FairnessDecision) {
    await mutate(async () => {
      const fingerprint = decisionFingerprint(decision);
      const [previous] = await db()
        .select({ fingerprint: decisions.fingerprint })
        .from(decisions)
        .where(eq(decisions.bookKey, decision.bookKey))
        .orderBy(desc(decisions.decisionIndex))
        .limit(1);
      if (previous?.fingerprint === fingerprint) return;
      await db()
        .insert(decisions)
        .values({ bookKey: decision.bookKey, fingerprint, payload: canonicalStringify(decision) });
    });
  }
  async function listDecisions(): Promise<FairnessDecision[]> {
    return (
      await db()
        .select({ payload: decisions.payload })
        .from(decisions)
        .orderBy(asc(decisions.decisionIndex))
    ).map((row) => canonicalParse<FairnessDecision>(row.payload));
  }
  async function rewindToBlock(commonBlockNumber: bigint, nowMs: bigint): Promise<RewindResult> {
    return mutate(async () => {
      const orphanedRows = await db()
        .update(events)
        .set({ canonical: false })
        .where(
          and(
            eq(events.canonical, true),
            commonBlockNumber < 0n ? undefined : gt(events.blockNumber, commonBlockNumber),
          ),
        )
        .returning({ index: events.eventIndex });
      const orphanedEventIndexes = orphanedRows
        .map((row) => row.index)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const orphaned = new Set(orphanedEventIndexes);
      // Bind the orphaned indexes as one array, not thousands of SQL parameters; both
      // historical anchor columns and the small active set have dedicated indexes.
      const orphanedIds = orphanedEventIndexes.map(String);
      const rows = await db()
        .select({ payload: proposals.payload })
        .from(proposals)
        .where(
          or(
            inArray(proposals.status, active),
            sql`${proposals.createdAfterEventIndex} = ANY(${sql.param(orphanedIds)}::numeric[])`,
            sql`${proposals.lastCanonicalEventIndex} = ANY(${sql.param(orphanedIds)}::numeric[])`,
          ),
        );
      const reorgedProposalIds: Hex[] = [];
      for (const row of rows) {
        const proposal = canonicalParse<StoredProposal>(row.payload);
        if (
          ACTIVE_PROPOSAL_STATUSES.has(proposal.status) ||
          (proposal.lastCanonicalEventIndex !== null &&
            orphaned.has(proposal.lastCanonicalEventIndex)) ||
          orphaned.has(proposal.createdAfterEventIndex)
        ) {
          setStatus(proposal, ProposalStatus.Reorged, nowMs, null, "canonical chain rewind");
          await writeProposal(proposal);
          reorgedProposalIds.push(proposal.proposal.proposalId);
        }
      }
      await db().update(leases).set({ expiresAtMs: 0n });
      return { orphanedEventIndexes, reorgedProposalIds: reorgedProposalIds.sort() };
    });
  }
  return {
    exclusive: mutate,
    acquireLease,
    renewLease,
    appendEvent,
    eventsAfter,
    findCanonicalEvent,
    getLatestEventIndex,
    saveCheckpoint,
    getLatestCheckpoint,
    persistProposal,
    reconcileCanonicalEvent,
    listActiveProposals,
    getProposal,
    transitionProposal,
    updateSettlement,
    appendDecision,
    listDecisions,
    rewindToBlock,
    close: database.close,
  } satisfies MatcherStore;
}
export type MatcherQueries = ReturnType<typeof createMatcherQueries>;
