import type {
  MatcherCheckpoint,
  MatcherEventEnvelope,
  MatchPreview,
  MatchProposal,
  PendingFillSnapshot,
} from "@conditional-stocks/orderbook";
import type { Hex } from "viem";

export const ProposalStatus = {
  Confirmed: "confirmed",
  Failed: "failed",
  Invalidated: "invalidated",
  Mined: "mined",
  Persisted: "persisted",
  Reorged: "reorged",
  Submitted: "submitted",
} as const;

export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

export const ACTIVE_PROPOSAL_STATUSES: ReadonlySet<ProposalStatus> = new Set([
  ProposalStatus.Persisted,
  ProposalStatus.Submitted,
  ProposalStatus.Mined,
]);

export interface LeaseGrant {
  bookKey: string;
  expiresAtMs: bigint;
  fencingToken: bigint;
  ownerId: string;
}

export interface ProposalTransition {
  atMs: bigint;
  eventIndex: bigint | null;
  reason: string | null;
  status: ProposalStatus;
}

export interface SimulationRecord {
  atBlockNumber: bigint;
  gasEstimate: bigint;
  ok: boolean;
  reason: string | null;
}

export interface ReceiptRecord {
  blockHash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  success: boolean;
  transactionHash: Hex;
}

export interface StoredProposal {
  createdAfterEventIndex: bigint;
  fencingToken: bigint;
  history: ProposalTransition[];
  lastCanonicalEventIndex: bigint | null;
  proposal: MatchProposal;
  receipt: ReceiptRecord | null;
  remainingFills: PendingFillSnapshot[];
  simulation: SimulationRecord | null;
  status: ProposalStatus;
  transactionHash: Hex | null;
}

export interface JournalEvent {
  canonical: boolean;
  duplicateDelivery: boolean;
  envelope: MatcherEventEnvelope;
  eventHash: Hex;
  index: bigint;
}

export interface StoredCheckpoint {
  checkpoint: MatcherCheckpoint;
  eventIndex: bigint;
}

export interface FairnessDecision {
  atMs: bigint;
  bookKey: string;
  fencingToken: bigint | null;
  optimizedBookHash: Hex | null;
  preview: MatchPreview;
  shadowBookHash: Hex | null;
}

export interface RewindResult {
  orphanedEventIndexes: bigint[];
  reorgedProposalIds: Hex[];
}

export interface MatcherSyncStore {
  acquireLease(bookKey: string, ownerId: string, nowMs: bigint, ttlMs: bigint): LeaseGrant | null;
  appendDecision(decision: FairnessDecision): void;
  appendEvent(envelope: MatcherEventEnvelope): JournalEvent;
  close(): void;
  eventsAfter(eventIndex: bigint): JournalEvent[];
  findCanonicalEvent(envelope: MatcherEventEnvelope): JournalEvent | null;
  getLatestCheckpoint(): StoredCheckpoint | null;
  getLatestEventIndex(): bigint;
  getProposal(proposalId: Hex): StoredProposal | null;
  listActiveProposals(): StoredProposal[];
  listDecisions(): FairnessDecision[];
  persistProposal(
    proposal: MatchProposal,
    lease: LeaseGrant,
    createdAfterEventIndex: bigint,
    nowMs: bigint,
  ): StoredProposal;
  reconcileCanonicalEvent(
    event: JournalEvent,
    invalidatedProposalIds: readonly Hex[],
    nowMs: bigint,
  ): void;
  renewLease(lease: LeaseGrant, nowMs: bigint, ttlMs: bigint): LeaseGrant | null;
  rewindToBlock(commonBlockNumber: bigint, nowMs: bigint): RewindResult;
  saveCheckpoint(checkpoint: MatcherCheckpoint, eventIndex: bigint): void;
  transitionProposal(
    proposalId: Hex,
    status: ProposalStatus,
    lease: LeaseGrant,
    nowMs: bigint,
    reason?: string,
  ): StoredProposal;
  updateSettlement(
    proposalId: Hex,
    lease: LeaseGrant,
    nowMs: bigint,
    update: {
      receipt?: ReceiptRecord;
      simulation?: SimulationRecord;
      transactionHash?: Hex;
    },
  ): StoredProposal;
}

/** Production PostgreSQL is asynchronous; the in-memory fault-test model may stay synchronous. */
export type MatcherStore = {
  [K in keyof MatcherSyncStore]: MatcherSyncStore[K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<R>
    : never;
} & {
  /** A consistent journal/proposal snapshot shared by all matcher instances. */
  exclusive?<T>(work: () => Promise<T>): Promise<T>;
};
