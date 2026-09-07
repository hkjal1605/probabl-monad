import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  bigint as pgBigint,
  pgSchema,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// EVM and cursor integers never pass through JavaScript Number or PostgreSQL int8.
export const uint = customType<{ data: bigint; driverData: string }>({
  dataType: () => "numeric(78,0)",
  toDriver: (value) => {
    if (value < 0n || value >= 1n << 256n) throw new RangeError("uint256 out of range");
    return value.toString();
  },
  fromDriver: (value) => BigInt(value),
});
const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
export const sharedSchema = pgSchema("probabl");
export const gatewaySchema = pgSchema("gateway");
export const matchingSchema = pgSchema("matching");
export const settlementSchema = pgSchema("settlement");
export const operationsSchema = pgSchema("operations");
const sequence = () => bigserial("sequence", { mode: "bigint" }).notNull().unique();
const payload = () => text("payload").notNull();

export const deploymentIdentity = sharedSchema.table("deployment_identity", {
  id: integer("id").primaryKey(),
  chainId: uint("chain_id").notNull(),
  exchange: text("exchange").notNull(),
  orderVersion: integer("order_version").notNull(),
});
export const relayerNonces = sharedSchema.table(
  "relayer_nonces",
  {
    chainId: uint("chain_id").notNull(),
    address: text("address").notNull(),
    nextNonce: uint("next_nonce").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.address] }),
    check("nonnegative_nonce", sql`${t.nextNonce} >= 0`),
  ],
);

export const authChallenges = gatewaySchema.table(
  "auth_challenges",
  {
    id: text("id").primaryKey(),
    address: text("address").notNull(),
    message: text("message").notNull(),
    expiresAtMs: uint("expires_at_ms").notNull(),
    consumedAtMs: uint("consumed_at_ms"),
  },
  (t) => [index("challenges_expiry_idx").on(t.expiresAtMs)],
);
export const authSessions = gatewaySchema.table(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    address: text("address").notNull(),
    expiresAtMs: uint("expires_at_ms").notNull(),
    revokedAtMs: uint("revoked_at_ms"),
  },
  (t) => [index("sessions_expiry_idx").on(t.expiresAtMs)],
);
export const gatewayOperations = gatewaySchema.table(
  "operations",
  {
    operationId: text("operation_id").primaryKey(),
    sequence: sequence(),
    address: text("address").notNull(),
    kind: text("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestDigest: text("request_digest").notNull(),
    leaseToken: uint("lease_token").notNull().default(sql`0`),
    leaseExpiresAtMs: uint("lease_expires_at_ms").notNull().default(sql`0`),
    orderHash: text("order_hash"),
    state: text("state").notNull(),
    payload: payload(),
  },
  (t) => [
    uniqueIndex("operation_idempotency_idx").on(t.address, t.kind, t.idempotencyKey),
    index("operation_order_hash_idx").on(t.address, t.orderHash, t.sequence),
    index("operation_pending_idx")
      .on(t.sequence)
      .where(sql`${t.state} NOT IN ('canonical','failed')`),
  ],
);
export const gatewayAttempts = gatewaySchema.table(
  "transaction_attempts",
  {
    operationId: text("operation_id")
      .notNull()
      .references(() => gatewayOperations.operationId),
    attempt: integer("attempt").notNull(),
    transactionHash: text("transaction_hash").notNull().unique(),
    payload: payload(),
  },
  (t) => [primaryKey({ columns: [t.operationId, t.attempt] })],
);

export const matcherEvents = matchingSchema.table(
  "events",
  {
    eventIndex: bigserial("event_index", { mode: "bigint" }).primaryKey(),
    canonical: boolean("canonical").notNull(),
    blockNumber: uint("block_number").notNull(),
    cursorKey: text("cursor_key").notNull(),
    eventHash: text("event_hash").notNull(),
    payload: payload(),
  },
  (t) => [
    uniqueIndex("matcher_canonical_cursor_idx").on(t.cursorKey).where(sql`${t.canonical}`),
    index("matcher_canonical_index_idx").on(t.eventIndex).where(sql`${t.canonical}`),
    index("matcher_canonical_block_idx").on(t.blockNumber).where(sql`${t.canonical}`),
  ],
);
export const matcherCheckpoints = matchingSchema.table("checkpoints", {
  eventIndex: uint("event_index").primaryKey(),
  payload: payload(),
});
export const matcherLeases = matchingSchema.table("leases", {
  bookKey: text("book_key").primaryKey(),
  ownerId: text("owner_id").notNull(),
  fencingToken: uint("fencing_token").notNull(),
  expiresAtMs: uint("expires_at_ms").notNull(),
});
export const matcherProposals = matchingSchema.table(
  "proposals",
  {
    proposalId: text("proposal_id").primaryKey(),
    bookKey: text("book_key").notNull(),
    status: text("status").notNull(),
    createdAfterEventIndex: uint("created_after_event_index").notNull(),
    lastCanonicalEventIndex: uint("last_canonical_event_index"),
    payload: payload(),
  },
  (t) => [
    index("matcher_proposal_created_idx").on(t.createdAfterEventIndex),
    index("matcher_proposal_canonical_idx").on(t.lastCanonicalEventIndex),
    index("matcher_active_idx")
      .on(t.createdAfterEventIndex)
      .where(sql`${t.status} IN ('persisted','submitted','mined')`),
    uniqueIndex("matcher_active_book_idx")
      .on(t.bookKey)
      .where(sql`${t.status} IN ('persisted','submitted','mined')`),
  ],
);
export const matcherDecisions = matchingSchema.table(
  "decisions",
  {
    decisionIndex: bigserial("decision_index", { mode: "bigint" }).primaryKey(),
    bookKey: text("book_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    payload: payload(),
  },
  (t) => [index("matcher_decision_book_idx").on(t.bookKey, t.decisionIndex)],
);

export const settlementBatches = settlementSchema.table(
  "batches",
  {
    batchId: text("batch_id").primaryKey(),
    sequence: sequence(),
    status: text("status").notNull(),
    payloadHash: text("payload_hash").notNull(),
    feedbackPending: boolean("feedback_pending").notNull().default(false),
    intentId: text("intent_id"),
    payload: payload(),
  },
  (t) => [
    index("settlement_pending_idx")
      .on(t.sequence)
      .where(sql`${t.status} IN ('queued','simulated','submitted','mined')`),
    index("settlement_feedback_idx").on(t.sequence).where(sql`${t.feedbackPending}`),
    index("settlement_intent_idx").on(t.intentId, t.sequence),
  ],
);
// Indexed book membership avoids scanning/deserializing every queued batch for each IOC.
export const settlementBooks = settlementSchema.table(
  "batch_books",
  {
    batchId: text("batch_id")
      .notNull()
      .references(() => settlementBatches.batchId),
    marketId: text("market_id").notNull(),
    branch: integer("branch").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.batchId, t.marketId, t.branch] }),
    index("settlement_book_idx").on(t.marketId, t.branch),
  ],
);
export const settlementAttempts = settlementSchema.table(
  "attempts",
  {
    batchId: text("batch_id")
      .notNull()
      .references(() => settlementBatches.batchId),
    callIndex: integer("call_index").notNull(),
    attempt: integer("attempt").notNull(),
    transactionHash: text("transaction_hash").notNull().unique(),
    nonce: uint("nonce").notNull(),
    payload: payload(),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.callIndex, t.attempt] })],
);
export const iocIntents = settlementSchema.table(
  "ioc_intents",
  {
    intentId: text("intent_id").primaryKey(),
    sequence: sequence(),
    status: text("status").notNull(),
    payload: payload(),
  },
  (t) => [index("ioc_waiting_idx").on(t.sequence).where(sql`${t.status} = 'waiting-match'`)],
);

export const evidencePackets = operationsSchema.table(
  "evidence_packets",
  {
    packetHash: text("packet_hash").primaryKey(),
    sequence: sequence(),
    packetId: text("packet_id").notNull().unique(),
    kind: text("kind").notNull(),
    marketId: text("market_id"),
    preparer: text("preparer").notNull(),
    preparedAt: text("prepared_at").notNull(),
    payload: payload(),
  },
  (t) => [index("evidence_market_idx").on(t.marketId, t.kind, t.sequence)],
);
export const evidenceReviews = operationsSchema.table("evidence_reviews", {
  reviewId: text("review_id").primaryKey(),
  sequence: sequence(),
  packetHash: text("packet_hash")
    .notNull()
    .unique()
    .references(() => evidencePackets.packetHash),
  reviewer: text("reviewer").notNull(),
  decision: text("decision").notNull(),
  reviewedAt: text("reviewed_at").notNull(),
  payload: payload(),
});
export const evidencePreviews = operationsSchema.table(
  "evidence_previews",
  {
    previewId: text("preview_id").primaryKey(),
    sequence: sequence(),
    packetHash: text("packet_hash")
      .notNull()
      .references(() => evidencePackets.packetHash),
    action: text("action").notNull(),
    payload: payload(),
  },
  (t) => [index("evidence_preview_packet_idx").on(t.packetHash, t.sequence)],
);
export const evidenceObservations = operationsSchema.table(
  "evidence_observations",
  {
    observationId: text("observation_id").primaryKey(),
    sequence: sequence(),
    packetHash: text("packet_hash")
      .notNull()
      .references(() => evidencePackets.packetHash),
    transactionHash: text("transaction_hash").notNull(),
    action: text("action").notNull(),
    payload: payload(),
  },
  (t) => [
    uniqueIndex("evidence_observation_tx_idx").on(t.packetHash, t.transactionHash),
    index("evidence_observation_packet_idx").on(t.packetHash, t.sequence),
  ],
);
export const evidenceActions = operationsSchema.table("evidence_actions", {
  id: text("id").primaryKey(),
  sequence: sequence(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  packetHash: text("packet_hash"),
  createdAt: text("created_at").notNull(),
  payload: payload(),
});
export const evidenceAttachments = operationsSchema.table(
  "evidence_attachments",
  {
    contentHash: text("content_hash").primaryKey(),
    content: bytes("content").notNull(),
  },
  (t) => [check("attachment_size", sql`octet_length(${t.content}) BETWEEN 1 AND 10485760`)],
);
export const evidenceAttachmentLinks = operationsSchema.table(
  "evidence_attachment_links",
  {
    packetHash: text("packet_hash")
      .notNull()
      .references(() => evidencePackets.packetHash),
    contentHash: text("content_hash")
      .notNull()
      .references(() => evidenceAttachments.contentHash),
  },
  (t) => [
    primaryKey({ columns: [t.packetHash, t.contentHash] }),
    index("evidence_attachment_content_idx").on(t.contentHash, t.packetHash),
  ],
);

export const polymarketSnapshots = operationsSchema.table("polymarket_snapshots", {
  snapshotId: text("snapshot_id").primaryKey(),
  gammaMarketId: text("gamma_market_id").notNull(),
  conditionId: text("condition_id").notNull(),
  observedAtMs: uint("observed_at_ms").notNull(),
  payload: payload(),
});
export const polymarketHeads = operationsSchema.table(
  "polymarket_heads",
  {
    gammaMarketId: text("gamma_market_id").primaryKey(),
    conditionId: text("condition_id").notNull(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => polymarketSnapshots.snapshotId),
    observedAtMs: uint("observed_at_ms").notNull(),
  },
  (t) => [
    index("polymarket_head_condition_idx").on(t.conditionId, t.observedAtMs, t.gammaMarketId),
  ],
);
export const polymarketTicks = operationsSchema.table("polymarket_ticks", {
  conditionId: text("condition_id").primaryKey(),
  observedAtMs: uint("observed_at_ms").notNull(),
  payload: payload(),
});
export const polymarketSubscriptions = operationsSchema.table("polymarket_subscriptions", {
  conditionId: text("condition_id").primaryKey(),
  sequence: sequence(),
  payload: payload(),
});
export const polymarketAlerts = operationsSchema.table("polymarket_alerts", {
  id: text("id").primaryKey(),
  sequence: sequence(),
  conditionId: text("condition_id"),
  code: text("code").notNull(),
  createdAtMs: uint("created_at_ms").notNull(),
  payload: payload(),
});
export const reconciliationRuns = operationsSchema.table(
  "reconciliation_runs",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    completedAt: text("completed_at").notNull(),
    deep: boolean("deep").notNull(),
    indexedBlock: uint("indexed_block").notNull(),
    indexedBlockHash: text("indexed_block_hash").notNull(),
    reportHash: text("report_hash").notNull().unique(),
    payload: payload(),
  },
  (t) => [index("reconciliation_deep_idx").on(t.id).where(sql`${t.deep}`)],
);
export const freezeSignals = operationsSchema.table(
  "freeze_signals",
  {
    scope: text("scope").primaryKey(),
    active: boolean("active").notNull(),
    code: text("code").notNull(),
    details: text("details").notNull(),
    detectedAt: text("detected_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    resolvedAt: text("resolved_at"),
    runId: pgBigint("run_id", { mode: "bigint" })
      .notNull()
      .references(() => reconciliationRuns.id),
  },
  (t) => [index("freeze_active_idx").on(t.scope).where(sql`${t.active}`)],
);
