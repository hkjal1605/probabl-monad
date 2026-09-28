import type { Pool } from "pg";

/** Bump when a table or its meaning changes; a mismatch requires a fresh database/schema. */
export const SCHEMA_VERSION = 1;

/** The protocol's persistent state. Trading and custody reads are served from the in-memory
 * chain index; PostgreSQL keeps only what must survive a restart or is queried historically:
 * finalized events (history and fast replay), closed orders, one state checkpoint per
 * deployment, and off-chain workflows (sign-in, evidence, faucet, delegated submissions). */
const DDL = [
  "CREATE SCHEMA IF NOT EXISTS probabl",
  `CREATE TABLE IF NOT EXISTS probabl.schema_version (
    id boolean PRIMARY KEY DEFAULT true CHECK (id), version integer NOT NULL)`,
  // One row per deployment: the finalized replica, rewritten at a bounded cadence.
  `CREATE TABLE IF NOT EXISTS probabl.checkpoints (
    domain text PRIMARY KEY, block bigint NOT NULL, hash text NOT NULL, state text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now())`,
  // Every finalized protocol event, append-only. `owner`/`counterparty` are the taker and maker
  // owners of a Trade (the account of other events), resolved once when the event is indexed.
  `CREATE TABLE IF NOT EXISTS probabl.events (
    domain text NOT NULL, block bigint NOT NULL, log_index integer NOT NULL, tx text NOT NULL,
    block_time bigint NOT NULL, name text NOT NULL, market integer, owner text, counterparty text,
    data jsonb NOT NULL, PRIMARY KEY (domain, block, log_index))`,
  `CREATE INDEX IF NOT EXISTS events_trades_market ON probabl.events
    (domain, market, block DESC, log_index DESC) WHERE name = 'Trade'`,
  `CREATE INDEX IF NOT EXISTS events_trades_owner ON probabl.events
    (domain, owner, block DESC, log_index DESC) WHERE name = 'Trade'`,
  `CREATE INDEX IF NOT EXISTS events_trades_counterparty ON probabl.events
    (domain, counterparty, block DESC, log_index DESC) WHERE name = 'Trade'`,
  // Closed orders only (open orders live in the checkpointed replica).
  `CREATE TABLE IF NOT EXISTS probabl.orders (
    domain text NOT NULL, key text NOT NULL, owner text NOT NULL, market integer NOT NULL,
    updated_block bigint NOT NULL, data jsonb NOT NULL, PRIMARY KEY (domain, key))`,
  `CREATE INDEX IF NOT EXISTS orders_owner ON probabl.orders (domain, owner, updated_block DESC)`,
  `CREATE TABLE IF NOT EXISTS probabl.auth_challenges (
    id text PRIMARY KEY, domain text NOT NULL, owner text NOT NULL, message text NOT NULL,
    expires_at timestamptz NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS auth_challenges_owner ON probabl.auth_challenges (domain, owner)`,
  `CREATE INDEX IF NOT EXISTS auth_challenges_expiry ON probabl.auth_challenges (expires_at)`,
  `CREATE TABLE IF NOT EXISTS probabl.sessions (
    token_hash text PRIMARY KEY, domain text NOT NULL, owner text NOT NULL,
    expires_at timestamptz NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_expiry ON probabl.sessions (expires_at)`,
  `CREATE TABLE IF NOT EXISTS probabl.evidence (
    domain text NOT NULL, hash text NOT NULL, market text, envelope jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (domain, hash))`,
  `CREATE INDEX IF NOT EXISTS evidence_created ON probabl.evidence (domain, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS evidence_market ON probabl.evidence (domain, market)
    WHERE market IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS probabl.evidence_actions (
    id uuid PRIMARY KEY, domain text NOT NULL, packet_hash text NOT NULL, kind text NOT NULL,
    actor text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS evidence_actions_packet ON probabl.evidence_actions
    (domain, packet_hash, created_at)`,
  `CREATE INDEX IF NOT EXISTS evidence_actions_created ON probabl.evidence_actions
    (domain, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS probabl.attachments (
    domain text NOT NULL, hash text NOT NULL, content bytea NOT NULL,
    CHECK (octet_length(content) BETWEEN 1 AND 10485760), PRIMARY KEY (domain, hash))`,
  // Which packets reference an attachment (an index lookup instead of a JSON scan).
  `CREATE TABLE IF NOT EXISTS probabl.evidence_attachments (
    domain text NOT NULL, content_hash text NOT NULL, packet_hash text NOT NULL,
    PRIMARY KEY (domain, content_hash, packet_hash))`,
  `CREATE TABLE IF NOT EXISTS probabl.faucet_claims (
    domain text NOT NULL, owner text NOT NULL, delivered jsonb NOT NULL DEFAULT '[]'::jsonb,
    transactions jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz, PRIMARY KEY (domain, owner))`,
  `CREATE INDEX IF NOT EXISTS faucet_claims_created ON probabl.faucet_claims (domain, created_at)`,
  // Delegated placements the API signs: the exact signed bytes are journaled before broadcast.
  `CREATE TABLE IF NOT EXISTS probabl.delegated_submissions (
    domain text NOT NULL, owner text NOT NULL, client_id text NOT NULL,
    order_terms_hash text NOT NULL, delegate text NOT NULL, tx_hash text NOT NULL,
    raw text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (domain, owner, client_id))`,
  `CREATE INDEX IF NOT EXISTS delegated_submissions_owner_day ON probabl.delegated_submissions
    (domain, owner, created_at)`,
];

export async function initializeStorage(pool: Pool) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('probabl-storage-schema'))");
    for (const statement of DDL) await tx.query(statement);
    const row = (await tx.query("SELECT version FROM probabl.schema_version WHERE id")).rows[0];
    if (row && row.version !== SCHEMA_VERSION)
      throw new Error("Database schema belongs to another release: provision a fresh schema");
    if (!row)
      await tx.query("INSERT INTO probabl.schema_version VALUES (true, $1)", [SCHEMA_VERSION]);
    await tx.query("COMMIT");
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
