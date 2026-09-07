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
} from "@conditional-stocks/db/matcher/types";
import {
  assertCursorContinuity,
  CanonicalInputError,
  canonicalStringify,
  compareCursors,
  hashCanonical,
  normalizeMatcherEnvelope,
} from "@conditional-stocks/orderbook";
import type { Hex } from "viem";
import { decisionFingerprint } from "./decisions.ts";

const clone = <T>(value: T): T => structuredClone(value);

export class FencingError extends Error {
  override readonly name = "FencingError";
}

export class InMemoryMatcherStore implements MatcherStore {
  readonly #checkpoints: StoredCheckpoint[] = [];
  readonly #decisions: FairnessDecision[] = [];
  readonly #lastDecisionHashes = new Map<string, Hex>();
  readonly #events: JournalEvent[] = [];
  readonly #leases = new Map<string, LeaseGrant>();
  readonly #proposals = new Map<Hex, StoredProposal>();
  readonly #tokens = new Map<string, bigint>();
  #nextEventIndex = 1n;

  acquireLease(bookKey: string, ownerId: string, nowMs: bigint, ttlMs: bigint): LeaseGrant | null {
    if (ttlMs <= 0n) throw new RangeError("lease ttl must be positive");
    const current = this.#leases.get(bookKey);
    if (current && current.expiresAtMs > nowMs && current.ownerId !== ownerId) return null;
    if (current && current.expiresAtMs > nowMs && current.ownerId === ownerId) {
      const renewed = { ...current, expiresAtMs: nowMs + ttlMs };
      this.#leases.set(bookKey, renewed);
      return clone(renewed);
    }
    const fencingToken = (this.#tokens.get(bookKey) ?? 0n) + 1n;
    this.#tokens.set(bookKey, fencingToken);
    const lease = { bookKey, expiresAtMs: nowMs + ttlMs, fencingToken, ownerId };
    this.#leases.set(bookKey, lease);
    return clone(lease);
  }

  renewLease(lease: LeaseGrant, nowMs: bigint, ttlMs: bigint): LeaseGrant | null {
    const current = this.#leases.get(lease.bookKey);
    if (
      !current ||
      current.ownerId !== lease.ownerId ||
      current.fencingToken !== lease.fencingToken ||
      current.expiresAtMs <= nowMs
    ) {
      return null;
    }
    const renewed = { ...current, expiresAtMs: nowMs + ttlMs };
    this.#leases.set(lease.bookKey, renewed);
    return clone(renewed);
  }

  appendEvent(input: JournalEvent["envelope"]): JournalEvent {
    const envelope = normalizeMatcherEnvelope(input);
    const eventHash = hashCanonical(envelope);
    const canonical = this.#events.filter((item) => item.canonical);
    const latest = canonical.at(-1);
    if (latest) {
      const comparison = compareCursors(envelope.cursor, latest.envelope.cursor);
      if (comparison <= 0) {
        const existing = canonical.find(
          (item) => compareCursors(envelope.cursor, item.envelope.cursor) === 0,
        );
        if (!existing) throw new CanonicalInputError("journal cursor moved backwards");
        if (eventHash !== existing.eventHash) {
          throw new CanonicalInputError("journal has conflicting canonical events at one cursor");
        }
        return clone({ ...existing, duplicateDelivery: true });
      }
      assertCursorContinuity(latest.envelope.cursor, envelope.cursor);
    }
    const record: JournalEvent = {
      canonical: true,
      duplicateDelivery: false,
      envelope,
      eventHash,
      index: this.#nextEventIndex,
    };
    this.#nextEventIndex += 1n;
    this.#events.push(record);
    return clone(record);
  }

  eventsAfter(eventIndex: bigint): JournalEvent[] {
    return this.#events
      .filter((event) => event.canonical && event.index > eventIndex)
      .sort((left, right) => (left.index < right.index ? -1 : 1))
      .map(clone);
  }

  findCanonicalEvent(input: JournalEvent["envelope"]): JournalEvent | null {
    const envelope = normalizeMatcherEnvelope(input);
    const eventHash = hashCanonical(envelope);
    const existing = this.#events.find(
      (item) => item.canonical && compareCursors(envelope.cursor, item.envelope.cursor) === 0,
    );
    if (!existing) return null;
    if (existing.eventHash !== eventHash) {
      throw new CanonicalInputError("journal has conflicting canonical events at one cursor");
    }
    return clone({ ...existing, duplicateDelivery: true });
  }

  getLatestEventIndex(): bigint {
    return this.#events.filter((event) => event.canonical).at(-1)?.index ?? 0n;
  }

  saveCheckpoint(checkpoint: StoredCheckpoint["checkpoint"], eventIndex: bigint): void {
    if (eventIndex > this.getLatestEventIndex()) {
      throw new CanonicalInputError("checkpoint is ahead of the event journal");
    }
    const existing = this.#checkpoints.find((item) => item.eventIndex === eventIndex);
    if (existing) {
      if (existing.checkpoint.checkpointHash !== checkpoint.checkpointHash) {
        throw new CanonicalInputError("conflicting checkpoints share an event index");
      }
      return;
    }
    this.#checkpoints.push({ checkpoint: clone(checkpoint), eventIndex });
  }

  getLatestCheckpoint(): StoredCheckpoint | null {
    const canonicalIndexes = new Set(
      this.#events.filter((event) => event.canonical).map((event) => event.index),
    );
    const latest = this.#checkpoints
      .filter(
        (checkpoint) => checkpoint.eventIndex === 0n || canonicalIndexes.has(checkpoint.eventIndex),
      )
      .sort((left, right) => (left.eventIndex < right.eventIndex ? 1 : -1))[0];
    return latest ? clone(latest) : null;
  }

  persistProposal(
    proposal: StoredProposal["proposal"],
    lease: LeaseGrant,
    createdAfterEventIndex: bigint,
    nowMs: bigint,
  ): StoredProposal {
    this.#assertLease(lease, nowMs);
    if (createdAfterEventIndex !== this.getLatestEventIndex()) {
      throw new CanonicalInputError("proposal is not anchored to the journal head");
    }
    const existing = this.#proposals.get(proposal.proposalId);
    if (existing) {
      if (hashCanonical(existing.proposal) !== hashCanonical(proposal)) {
        throw new CanonicalInputError("proposal id collision");
      }
      if (ACTIVE_PROPOSAL_STATUSES.has(existing.status)) return clone(existing);
      if (
        existing.status !== ProposalStatus.Failed &&
        existing.status !== ProposalStatus.Invalidated &&
        existing.status !== ProposalStatus.Reorged
      ) {
        throw new CanonicalInputError("confirmed proposal cannot be reactivated");
      }
      existing.status = ProposalStatus.Persisted;
      existing.createdAfterEventIndex = createdAfterEventIndex;
      existing.fencingToken = lease.fencingToken;
      existing.lastCanonicalEventIndex = null;
      existing.receipt = null;
      existing.remainingFills = proposal.fills.map((fill) => ({
        buyOrderHash: fill.buyOrderHash,
        fillQuantity: fill.fillQuantity,
        remainingQuantity: fill.fillQuantity,
        sellOrderHash: fill.sellOrderHash,
      }));
      existing.history.push({
        atMs: nowMs,
        eventIndex: null,
        reason: "deterministic reproposal",
        status: ProposalStatus.Persisted,
      });
      existing.simulation = null;
      existing.transactionHash = null;
      return clone(existing);
    }
    const activeForBook = [...this.#proposals.values()].find(
      (item) =>
        item.proposal.bookKey === proposal.bookKey && ACTIVE_PROPOSAL_STATUSES.has(item.status),
    );
    if (activeForBook) {
      throw new CanonicalInputError(
        `book already has active proposal ${activeForBook.proposal.proposalId}`,
      );
    }
    const record: StoredProposal = {
      createdAfterEventIndex,
      fencingToken: lease.fencingToken,
      history: [
        {
          atMs: nowMs,
          eventIndex: null,
          reason: null,
          status: ProposalStatus.Persisted,
        },
      ],
      lastCanonicalEventIndex: null,
      proposal: clone(proposal),
      receipt: null,
      remainingFills: proposal.fills.map((fill) => ({
        buyOrderHash: fill.buyOrderHash,
        fillQuantity: fill.fillQuantity,
        remainingQuantity: fill.fillQuantity,
        sellOrderHash: fill.sellOrderHash,
      })),
      simulation: null,
      status: ProposalStatus.Persisted,
      transactionHash: null,
    };
    this.#proposals.set(proposal.proposalId, record);
    return clone(record);
  }

  reconcileCanonicalEvent(
    journalEvent: JournalEvent,
    invalidatedProposalIds: readonly Hex[],
    nowMs: bigint,
  ): void {
    const canonical = this.#events.find(
      (event) => event.index === journalEvent.index && event.canonical,
    );
    if (!canonical || canonical.eventHash !== journalEvent.eventHash) {
      throw new CanonicalInputError("cannot reconcile an event absent from the canonical journal");
    }
    for (const proposalId of invalidatedProposalIds) {
      const record = this.#proposals.get(proposalId);
      if (!record || !ACTIVE_PROPOSAL_STATUSES.has(record.status)) continue;
      this.#setStatus(
        record,
        ProposalStatus.Invalidated,
        nowMs,
        journalEvent.index,
        `invalidated by ${journalEvent.envelope.event.type}`,
      );
    }
    const event = journalEvent.envelope.event;
    if (event.type !== "order-filled") return;
    const record = [...this.#proposals.values()]
      .filter(
        (proposal) =>
          ACTIVE_PROPOSAL_STATUSES.has(proposal.status) &&
          proposal.createdAfterEventIndex < journalEvent.index &&
          (proposal.lastCanonicalEventIndex === null ||
            proposal.lastCanonicalEventIndex < journalEvent.index),
      )
      .sort((left, right) =>
        left.createdAfterEventIndex === right.createdAfterEventIndex
          ? left.proposal.proposalId.localeCompare(right.proposal.proposalId)
          : left.createdAfterEventIndex < right.createdAfterEventIndex
            ? -1
            : 1,
      )
      .find((proposal) =>
        proposal.remainingFills.some(
          (fill) =>
            fill.remainingQuantity > 0n &&
            fill.buyOrderHash === event.buyOrderHash &&
            fill.sellOrderHash === event.sellOrderHash,
        ),
      );
    if (!record) return;
    const fill = record.remainingFills.find(
      (item) =>
        item.remainingQuantity > 0n &&
        item.buyOrderHash === event.buyOrderHash &&
        item.sellOrderHash === event.sellOrderHash,
    );
    if (!fill || event.fillQuantity > fill.remainingQuantity) {
      throw new CanonicalInputError("canonical fill exceeds stored proposal reservation");
    }
    fill.remainingQuantity -= event.fillQuantity;
    record.lastCanonicalEventIndex = journalEvent.index;
    if (record.remainingFills.every((item) => item.remainingQuantity === 0n)) {
      this.#setStatus(record, ProposalStatus.Confirmed, nowMs, journalEvent.index, null);
    }
  }

  listActiveProposals(): StoredProposal[] {
    return [...this.#proposals.values()]
      .filter((proposal) => ACTIVE_PROPOSAL_STATUSES.has(proposal.status))
      .sort((left, right) => left.proposal.proposalId.localeCompare(right.proposal.proposalId))
      .map(clone);
  }

  getProposal(proposalId: Hex): StoredProposal | null {
    const record = this.#proposals.get(proposalId);
    return record ? clone(record) : null;
  }

  transitionProposal(
    proposalId: Hex,
    status: ProposalStatus,
    lease: LeaseGrant,
    nowMs: bigint,
    reason?: string,
  ): StoredProposal {
    this.#assertLease(lease, nowMs);
    const record = this.#proposals.get(proposalId);
    if (!record || record.proposal.bookKey !== lease.bookKey) {
      throw new CanonicalInputError("proposal is missing or belongs to another lease");
    }
    this.#assertExternalTransition(record.status, status);
    this.#setStatus(record, status, nowMs, null, reason ?? null);
    return clone(record);
  }

  updateSettlement(
    proposalId: Hex,
    lease: LeaseGrant,
    nowMs: bigint,
    update: {
      receipt?: ReceiptRecord;
      simulation?: SimulationRecord;
      transactionHash?: Hex;
    },
  ): StoredProposal {
    this.#assertLease(lease, nowMs);
    const record = this.#proposals.get(proposalId);
    if (!record || record.proposal.bookKey !== lease.bookKey) {
      throw new CanonicalInputError("proposal is missing or belongs to another lease");
    }
    if (
      update.transactionHash &&
      record.transactionHash &&
      record.transactionHash !== update.transactionHash
    ) {
      throw new CanonicalInputError("proposal transaction hash is immutable");
    }
    if (
      update.receipt &&
      record.receipt &&
      canonicalStringify(record.receipt) !== canonicalStringify(update.receipt)
    ) {
      throw new CanonicalInputError("proposal receipt is immutable");
    }
    if (update.simulation) record.simulation = clone(update.simulation);
    if (update.transactionHash) record.transactionHash = update.transactionHash;
    if (update.receipt) record.receipt = clone(update.receipt);
    return clone(record);
  }

  appendDecision(decision: FairnessDecision): void {
    const fingerprint = decisionFingerprint(decision);
    if (this.#lastDecisionHashes.get(decision.bookKey) === fingerprint) return;
    this.#lastDecisionHashes.set(decision.bookKey, fingerprint);
    this.#decisions.push(clone(decision));
  }

  listDecisions(): FairnessDecision[] {
    return this.#decisions.map(clone);
  }

  rewindToBlock(commonBlockNumber: bigint, nowMs: bigint): RewindResult {
    const orphanedEventIndexes: bigint[] = [];
    for (const event of this.#events) {
      if (event.canonical && event.envelope.cursor.blockNumber > commonBlockNumber) {
        event.canonical = false;
        orphanedEventIndexes.push(event.index);
      }
    }
    const orphaned = new Set(orphanedEventIndexes);
    const reorgedProposalIds: Hex[] = [];
    for (const proposal of this.#proposals.values()) {
      if (
        ACTIVE_PROPOSAL_STATUSES.has(proposal.status) ||
        (proposal.lastCanonicalEventIndex !== null &&
          orphaned.has(proposal.lastCanonicalEventIndex)) ||
        orphaned.has(proposal.createdAfterEventIndex)
      ) {
        this.#setStatus(proposal, ProposalStatus.Reorged, nowMs, null, "canonical chain rewind");
        reorgedProposalIds.push(proposal.proposal.proposalId);
      }
    }
    for (const [bookKey, lease] of this.#leases) {
      this.#leases.set(bookKey, { ...lease, expiresAtMs: nowMs });
    }
    return { orphanedEventIndexes, reorgedProposalIds: reorgedProposalIds.sort() };
  }

  close(): void {}

  #assertLease(lease: LeaseGrant, nowMs: bigint): void {
    const current = this.#leases.get(lease.bookKey);
    if (
      !current ||
      current.ownerId !== lease.ownerId ||
      current.fencingToken !== lease.fencingToken ||
      current.expiresAtMs <= nowMs
    ) {
      throw new FencingError(`stale fencing token for ${lease.bookKey}`);
    }
  }

  #setStatus(
    record: StoredProposal,
    status: ProposalStatus,
    atMs: bigint,
    eventIndex: bigint | null,
    reason: string | null,
  ): void {
    if (record.status === status && record.history.at(-1)?.eventIndex === eventIndex) return;
    record.status = status;
    if (eventIndex !== null) record.lastCanonicalEventIndex = eventIndex;
    record.history.push({ atMs, eventIndex, reason, status });
  }

  #assertExternalTransition(current: ProposalStatus, next: ProposalStatus): void {
    if (current === next) return;
    const valid =
      (next === ProposalStatus.Submitted && current === ProposalStatus.Persisted) ||
      (next === ProposalStatus.Mined && current === ProposalStatus.Submitted) ||
      (next === ProposalStatus.Failed &&
        (current === ProposalStatus.Persisted || current === ProposalStatus.Submitted));
    if (!valid)
      throw new CanonicalInputError(`invalid external proposal transition ${current} -> ${next}`);
  }
}
