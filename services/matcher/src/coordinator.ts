import {
  ACTIVE_PROPOSAL_STATUSES,
  type FairnessDecision,
  type JournalEvent,
  type LeaseGrant,
  type MatcherStore,
  ProposalStatus,
  type ReceiptRecord,
  type SimulationRecord,
  type StoredProposal,
} from "@conditional-stocks/db/matcher/types";
import {
  canonicalStringify,
  compareCursors,
  DeterministicMatcher,
  type EngineApplyResult,
  type MatcherEventEnvelope,
  type MatchProposal,
  MatchSkipReason,
  SlowReferenceMatcher,
} from "@conditional-stocks/orderbook";
import type { Hex } from "viem";
import { MatcherMetrics } from "./metrics.ts";

export class ShadowDivergenceError extends Error {
  override readonly name = "ShadowDivergenceError";
}

export interface MatcherAlert {
  context: Record<string, unknown>;
  message: string;
  type: "checkpoint-corruption" | "recovery-mismatch" | "shadow-divergence";
}

export interface CoordinatorHooks {
  afterCheckpointPersisted?: () => void;
  afterEventApplied?: (event: JournalEvent) => void;
  afterEventPersisted?: (event: JournalEvent) => void;
  afterProposalCommitted?: (proposal: MatchProposal) => void;
  afterProposalPersisted?: (proposal: StoredProposal) => void;
}

export interface CoordinatorOptions {
  checkpointEveryEvents?: bigint;
  hooks?: CoordinatorHooks;
  leaseTtlMs?: bigint;
  maxFillsPerProposal?: number;
  now?: () => bigint;
  onAlert?: (alert: MatcherAlert) => void;
  ownerId: string;
  shadow?: SlowReferenceMatcher;
}

export interface IngestResult {
  applyResult: EngineApplyResult;
  event: JournalEvent;
  proposals: MatchProposal[];
}

const defaultNow = (): bigint => BigInt(Date.now());

export class MatcherCoordinator {
  readonly #checkpointEveryEvents: bigint;
  readonly #hooks: CoordinatorHooks;
  readonly #leaseTtlMs: bigint;
  readonly #leases = new Map<string, LeaseGrant>();
  readonly #maxFills: number;
  readonly #now: () => bigint;
  readonly #onAlert: (alert: MatcherAlert) => void;
  readonly #ownerId: string;
  readonly #store: MatcherStore;
  readonly metrics = new MatcherMetrics();
  #matcher: DeterministicMatcher;
  #shadow: SlowReferenceMatcher;
  #tail: Promise<unknown> = Promise.resolve();
  #needsRecovery = false;
  #appliedIndex = 0n;

  constructor(store: MatcherStore, options: CoordinatorOptions) {
    if (options.ownerId.length === 0) throw new TypeError("matcher ownerId is required");
    this.#store = store;
    this.#ownerId = options.ownerId;
    this.#leaseTtlMs = options.leaseTtlMs ?? 15_000n;
    this.#checkpointEveryEvents = options.checkpointEveryEvents ?? 100n;
    this.#maxFills = options.maxFillsPerProposal ?? 32;
    this.#hooks = options.hooks ?? {};
    this.#now = options.now ?? defaultNow;
    this.#onAlert = options.onAlert ?? (() => undefined);
    this.#matcher = new DeterministicMatcher({ maxFillsPerProposal: this.#maxFills });
    this.#shadow = options.shadow ?? new SlowReferenceMatcher(this.#maxFills);
  }

  get checkpoint() {
    return this.#matcher.checkpoint();
  }

  recover(): Promise<void> {
    return this.#serialize(() => this.#recover(), false);
  }
  ingest(
    envelope: MatcherEventEnvelope,
    options: { propose?: boolean } = {},
  ): Promise<IngestResult> {
    return this.#serialize(() => this.#ingest(envelope, options));
  }
  processBook(
    bookKey: string,
    options: { retryTerminal?: boolean } = {},
  ): Promise<MatchProposal | null> {
    return this.#serialize(() => this.#processBook(bookKey, options));
  }
  recordSimulation(id: Hex, simulation: SimulationRecord): Promise<StoredProposal> {
    return this.#serialize(() => this.#recordSimulation(id, simulation));
  }
  markSubmitted(id: Hex, hash: Hex): Promise<StoredProposal> {
    return this.#serialize(() => this.#markSubmitted(id, hash));
  }
  recordReceipt(id: Hex, receipt: ReceiptRecord): Promise<StoredProposal> {
    return this.#serialize(() => this.#recordReceipt(id, receipt));
  }
  failProposal(id: Hex, reason: string): Promise<StoredProposal> {
    return this.#serialize(() => this.#failProposal(id, reason));
  }
  rewindToBlock(block: bigint): Promise<void> {
    return this.#serialize(() => this.#rewindToBlock(block), false);
  }

  #serialize<T>(work: () => Promise<T>, recover = true): Promise<T> {
    const pending = this.#tail.then(async () => {
      const execute = async () => {
        if (
          recover &&
          (this.#needsRecovery || this.#appliedIndex !== (await this.#store.getLatestEventIndex()))
        )
          await this.#recover();
        return work();
      };
      try {
        return await (this.#store.exclusive ? this.#store.exclusive(execute) : execute());
      } catch (error) {
        // PostgreSQL may roll back after the in-memory model changed. Never reuse that model.
        this.#needsRecovery = true;
        this.#leases.clear();
        throw error;
      }
    });
    this.#tail = pending.catch(() => undefined);
    return pending;
  }

  async #recover(): Promise<void> {
    const storedCheckpoint = await this.#store.getLatestCheckpoint();
    try {
      this.#matcher = storedCheckpoint
        ? DeterministicMatcher.fromCheckpoint(storedCheckpoint.checkpoint, {
            maxFillsPerProposal: this.#maxFills,
          })
        : new DeterministicMatcher({ maxFillsPerProposal: this.#maxFills });
      this.#shadow = storedCheckpoint
        ? SlowReferenceMatcher.fromCheckpoint(storedCheckpoint.checkpoint, this.#maxFills)
        : new SlowReferenceMatcher(this.#maxFills);
    } catch (error) {
      this.#onAlert({
        context: { error: error instanceof Error ? error.message : String(error) },
        message: "matcher checkpoint failed verification",
        type: "checkpoint-corruption",
      });
      throw error;
    }

    const checkpointIndex = storedCheckpoint?.eventIndex ?? 0n;
    const active = (await this.#store.listActiveProposals()).sort((left, right) =>
      left.createdAfterEventIndex === right.createdAfterEventIndex
        ? left.proposal.proposalId.localeCompare(right.proposal.proposalId)
        : left.createdAfterEventIndex < right.createdAfterEventIndex
          ? -1
          : 1,
    );
    const checkpointPending = new Set(
      this.#matcher
        .checkpoint()
        .books.flatMap((book) =>
          book.pendingProposal ? [book.pendingProposal.proposal.proposalId] : [],
        ),
    );
    const activeIds = new Set(active.map((record) => record.proposal.proposalId));
    for (const proposalId of checkpointPending) {
      if (activeIds.has(proposalId)) continue;
      this.#matcher.releaseProposal(proposalId);
      this.#shadow.releaseProposal(proposalId);
    }
    for (const record of active) {
      if (
        record.createdAfterEventIndex < checkpointIndex &&
        !checkpointPending.has(record.proposal.proposalId)
      ) {
        this.#recoveryMismatch("active proposal predates checkpoint but is absent from it", record);
      }
    }

    let activeIndex = 0;
    const activateBefore = (eventIndex: bigint, inclusive: boolean): void => {
      while (activeIndex < active.length) {
        const record = active[activeIndex];
        if (!record) break;
        const eligible = inclusive
          ? record.createdAfterEventIndex <= eventIndex
          : record.createdAfterEventIndex < eventIndex;
        if (!eligible) break;
        activeIndex += 1;
        if (checkpointPending.has(record.proposal.proposalId)) continue;
        this.#matcher.commitProposal(record.proposal);
        this.#shadow.commitProposal(record.proposal);
      }
    };

    for (const event of await this.#store.eventsAfter(checkpointIndex)) {
      activateBefore(event.index, false);
      const optimized = this.#matcher.apply(event.envelope);
      const shadow = this.#shadow.apply(event.envelope);
      this.#assertSame("recovery apply result", optimized, shadow, {
        eventHash: event.eventHash,
        eventIndex: event.index,
      });
      await this.#store.reconcileCanonicalEvent(
        event,
        optimized.invalidatedProposalIds,
        this.#now(),
      );
    }
    activateBefore(await this.#store.getLatestEventIndex(), true);
    this.#assertShadowState(await this.#store.getLatestEventIndex());

    const enginePending = new Map(
      this.#matcher
        .checkpoint()
        .books.flatMap((book) =>
          book.pendingProposal
            ? [[book.pendingProposal.proposal.proposalId, book.pendingProposal.fills] as const]
            : [],
        ),
    );
    for (const record of await this.#store.listActiveProposals()) {
      if (
        canonicalStringify(enginePending.get(record.proposal.proposalId)) !==
        canonicalStringify(record.remainingFills)
      ) {
        this.#recoveryMismatch(
          "engine reservations differ from durable proposal reservations",
          record,
        );
      }
    }
    this.#appliedIndex = await this.#store.getLatestEventIndex();
    this.#needsRecovery = false;
  }

  async #ingest(
    envelope: MatcherEventEnvelope,
    options: { propose?: boolean } = {},
  ): Promise<IngestResult> {
    const now = this.#now();
    const existing = await this.#store.findCanonicalEvent(envelope);
    if (
      existing &&
      this.#matcher.cursor &&
      compareCursors(existing.envelope.cursor, this.#matcher.cursor) < 0
    ) {
      return {
        applyResult: {
          affectedBookKeys: [],
          duplicate: true,
          eventHash: existing.eventHash,
          invalidatedProposalIds: [],
        },
        event: existing,
        proposals: [],
      };
    }
    this.#matcher.validate(envelope);
    const event = existing ?? (await this.#store.appendEvent(envelope));
    if (!event.duplicateDelivery) this.#hooks.afterEventPersisted?.(event);
    if (
      event.duplicateDelivery &&
      this.#matcher.cursor &&
      compareCursors(event.envelope.cursor, this.#matcher.cursor) < 0
    ) {
      return {
        applyResult: {
          affectedBookKeys: [],
          duplicate: true,
          eventHash: event.eventHash,
          invalidatedProposalIds: [],
        },
        event,
        proposals: [],
      };
    }
    const optimized = this.#matcher.apply(event.envelope);
    const shadow = this.#shadow.apply(event.envelope);
    this.#assertSame("event apply result", optimized, shadow, {
      eventHash: event.eventHash,
      eventIndex: event.index,
    });
    this.#hooks.afterEventApplied?.(event);
    if (optimized.duplicate) return { applyResult: optimized, event, proposals: [] };

    this.metrics.canonicalEvents += 1n;
    await this.#store.reconcileCanonicalEvent(event, optimized.invalidatedProposalIds, now);
    this.#appliedIndex = event.index;
    if (this.#checkpointEveryEvents > 0n && event.index % this.#checkpointEveryEvents === 0n) {
      this.#assertShadowState(event.index);
      await this.#store.saveCheckpoint(this.#matcher.checkpoint(), event.index);
      this.metrics.checkpoints += 1n;
      this.#hooks.afterCheckpointPersisted?.();
    }

    const proposals: MatchProposal[] = [];
    for (const bookKey of options.propose === false ? [] : optimized.affectedBookKeys) {
      const proposal = await this.#processBook(bookKey);
      if (proposal) proposals.push(proposal);
    }
    return { applyResult: optimized, event, proposals };
  }

  async #processBook(
    bookKey: string,
    options: { retryTerminal?: boolean } = {},
  ): Promise<MatchProposal | null> {
    const now = this.#now();
    let optimized = this.#matcher.preview(bookKey);
    if (!optimized.proposal && optimized.skip.reason === MatchSkipReason.NoCross) {
      this.metrics.recordSkip(optimized.skip.reason);
      return null;
    }
    const previousLease = this.#leases.get(bookKey);
    const lease = await this.#lease(bookKey, now);
    if (!lease) {
      this.metrics.leasesDenied += 1n;
      return null;
    }
    if (
      this.#store.exclusive &&
      (!previousLease || previousLease.fencingToken !== lease.fencingToken)
    ) {
      // A new owner must load reservations/terminal feedback written by its predecessor.
      await this.#recover();
      optimized = this.#matcher.preview(bookKey);
    }
    const shadow = this.#shadow.preview(bookKey);
    this.#assertSame("match preview", optimized, shadow, { bookKey });

    const decision: FairnessDecision = {
      atMs: now,
      bookKey,
      fencingToken: lease.fencingToken,
      optimizedBookHash: optimized.proposal?.preBookHash ?? this.#matcher.bookHash(bookKey),
      preview: optimized,
      shadowBookHash: shadow.proposal?.preBookHash ?? this.#shadow.bookHash(bookKey),
    };
    // The proposal itself carries the exact pre-book hash. Skips retain the
    // whole preview and are correlated to the checkpoint hash in operations.
    if (optimized.proposal) {
      decision.optimizedBookHash = optimized.proposal.preBookHash;
      decision.shadowBookHash = shadow.proposal?.preBookHash ?? null;
    }
    await this.#store.appendDecision(decision);

    if (!optimized.proposal) {
      this.metrics.recordSkip(optimized.skip.reason);
      return null;
    }
    const previous = await this.#store.getProposal(optimized.proposal.proposalId);
    if (
      options.retryTerminal === false &&
      previous &&
      !ACTIVE_PROPOSAL_STATUSES.has(previous.status)
    )
      return null;
    const record = await this.#store.persistProposal(
      optimized.proposal,
      lease,
      await this.#store.getLatestEventIndex(),
      now,
    );
    this.#hooks.afterProposalPersisted?.(record);
    this.#matcher.commitProposal(optimized.proposal);
    this.#shadow.commitProposal(optimized.proposal);
    this.metrics.proposals += 1n;
    this.#hooks.afterProposalCommitted?.(optimized.proposal);
    return optimized.proposal;
  }

  async #recordSimulation(proposalId: Hex, simulation: SimulationRecord): Promise<StoredProposal> {
    const record = await this.#requiredProposal(proposalId);
    const lease = await this.#requiredLease(record.proposal.bookKey);
    return await this.#store.updateSettlement(proposalId, lease, this.#now(), { simulation });
  }

  async #markSubmitted(proposalId: Hex, transactionHash: Hex): Promise<StoredProposal> {
    const record = await this.#requiredProposal(proposalId);
    if (record.status === ProposalStatus.Submitted) {
      if (record.transactionHash !== transactionHash) {
        throw new Error("submitted proposal has a different transaction hash");
      }
      return record;
    }
    if (record.status !== ProposalStatus.Persisted) {
      throw new Error(`proposal cannot be submitted from ${record.status}`);
    }
    const lease = await this.#requiredLease(record.proposal.bookKey);
    await this.#store.updateSettlement(proposalId, lease, this.#now(), { transactionHash });
    return await this.#store.transitionProposal(
      proposalId,
      ProposalStatus.Submitted,
      lease,
      this.#now(),
    );
  }

  async #recordReceipt(proposalId: Hex, receipt: ReceiptRecord): Promise<StoredProposal> {
    const record = await this.#requiredProposal(proposalId);
    const terminalStatus = receipt.success ? ProposalStatus.Mined : ProposalStatus.Failed;
    if (record.status === terminalStatus) {
      if (canonicalStringify(record.receipt) !== canonicalStringify(receipt)) {
        throw new Error("proposal already has a different receipt");
      }
      return record;
    }
    if (record.status !== ProposalStatus.Submitted) {
      throw new Error(`proposal cannot record a receipt from ${record.status}`);
    }
    if (record.transactionHash !== receipt.transactionHash) {
      throw new Error("receipt transaction hash does not match the submitted proposal");
    }
    const lease = await this.#requiredLease(record.proposal.bookKey);
    await this.#store.updateSettlement(proposalId, lease, this.#now(), { receipt });
    if (receipt.success) {
      return await this.#store.transitionProposal(
        proposalId,
        ProposalStatus.Mined,
        lease,
        this.#now(),
      );
    }
    const failed = await this.#store.transitionProposal(
      proposalId,
      ProposalStatus.Failed,
      lease,
      this.#now(),
      "settlement receipt reverted",
    );
    this.#matcher.releaseProposal(proposalId);
    this.#shadow.releaseProposal(proposalId);
    return failed;
  }

  async #failProposal(proposalId: Hex, reason: string): Promise<StoredProposal> {
    const record = await this.#requiredProposal(proposalId);
    if (!ACTIVE_PROPOSAL_STATUSES.has(record.status)) return record;
    const lease = await this.#requiredLease(record.proposal.bookKey);
    const failed = await this.#store.transitionProposal(
      proposalId,
      ProposalStatus.Failed,
      lease,
      this.#now(),
      reason,
    );
    this.#matcher.releaseProposal(proposalId);
    this.#shadow.releaseProposal(proposalId);
    return failed;
  }

  async activeProposals(): Promise<StoredProposal[]> {
    return await this.#store.listActiveProposals();
  }
  async proposal(proposalId: Hex): Promise<StoredProposal | null> {
    return await this.#store.getProposal(proposalId);
  }

  async #rewindToBlock(commonBlockNumber: bigint): Promise<void> {
    await this.#store.rewindToBlock(commonBlockNumber, this.#now());
    this.#leases.clear();
    this.metrics.reorgs += 1n;
    await this.#recover();
  }

  async close(): Promise<void> {
    await this.#tail;
    await this.#store.close();
  }

  async #lease(bookKey: string, now: bigint): Promise<LeaseGrant | null> {
    const existing = this.#leases.get(bookKey);
    if (existing && existing.expiresAtMs > now) {
      const renewed = await this.#store.renewLease(existing, now, this.#leaseTtlMs);
      if (renewed) {
        this.#leases.set(bookKey, renewed);
        return renewed;
      }
      this.#leases.delete(bookKey);
    }
    const acquired = await this.#store.acquireLease(bookKey, this.#ownerId, now, this.#leaseTtlMs);
    if (acquired) this.#leases.set(bookKey, acquired);
    return acquired;
  }

  async #requiredLease(bookKey: string): Promise<LeaseGrant> {
    const lease = await this.#lease(bookKey, this.#now());
    if (!lease) throw new Error(`matcher does not hold the lease for ${bookKey}`);
    return lease;
  }

  async #requiredProposal(proposalId: Hex): Promise<StoredProposal> {
    const record = await this.#store.getProposal(proposalId);
    if (!record) throw new Error(`unknown proposal ${proposalId}`);
    return record;
  }

  #assertShadowState(eventIndex: bigint): void {
    const optimized = this.#matcher.checkpoint();
    const shadow = this.#shadow.checkpoint();
    this.#assertSame("matcher checkpoint", optimized, shadow, { eventIndex });
  }

  #assertSame(
    label: string,
    optimized: unknown,
    shadow: unknown,
    context: Record<string, unknown>,
  ): void {
    if (canonicalStringify(optimized) === canonicalStringify(shadow)) return;
    this.metrics.shadowDivergences += 1n;
    const alert: MatcherAlert = {
      context: {
        ...context,
        optimized,
        shadow,
      },
      message: `${label} diverged from the independent shadow matcher`,
      type: "shadow-divergence",
    };
    this.#onAlert(alert);
    throw new ShadowDivergenceError(alert.message);
  }

  #recoveryMismatch(message: string, proposal: StoredProposal): never {
    const alert: MatcherAlert = {
      context: { proposalId: proposal.proposal.proposalId },
      message,
      type: "recovery-mismatch",
    };
    this.#onAlert(alert);
    throw new Error(message);
  }
}
