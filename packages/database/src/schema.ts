import type { Pool } from "pg";

/** Bump with a migration step below when a table or its meaning changes. */
export const SCHEMA_VERSION = 2;

/** The protocol's persistent state. Trading and custody reads are served from the in-memory
 * chain index; PostgreSQL keeps only what must survive a restart or is read historically:
 * finalized trades and closed orders (the history the product shows), one compressed state
 * checkpoint per deployment (restarts replay only the blocks after it), and off-chain workflows
 * (sign-in, evidence, faucet, delegated submissions). Every other protocol event lives in the
 * checkpointed replica and on chain, never in a table.
 *
 * The history tables are the high-volume ones: they key deployments by a smallint and store
 * hashes and addresses as bytea, and each index serves one query. */
const DDL = [
  "CREATE SCHEMA IF NOT EXISTS probabl",
  `CREATE TABLE IF NOT EXISTS probabl.schema_version (
    id boolean PRIMARY KEY DEFAULT true CHECK (id), version integer NOT NULL)`,
  // `${chainId}:${exchange}` of each indexed deployment, by compact id.
  `CREATE TABLE IF NOT EXISTS probabl.deployments (
    id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, domain text NOT NULL UNIQUE)`,
  // One row per deployment: the finalized replica, zstd-compressed, rewritten only when it
  // changed and at a bounded cadence.
  `CREATE TABLE IF NOT EXISTS probabl.checkpoints (
    domain text PRIMARY KEY, block bigint NOT NULL, hash text NOT NULL, state bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now())`,
  // Already compressed: stored out of line without a second compression pass.
  "ALTER TABLE probabl.checkpoints ALTER COLUMN state SET STORAGE EXTERNAL",
  // Finalized trades, append-only (columns ordered for alignment). Quantities and amounts are
  // raw token units; `price` is the maker's limit price (raw quote per raw base x 1e18).
  `CREATE TABLE IF NOT EXISTS probabl.trades (
    block bigint NOT NULL, block_time bigint NOT NULL, maker_seq bigint NOT NULL,
    taker_seq bigint NOT NULL, log_index integer NOT NULL, market integer NOT NULL,
    deployment smallint NOT NULL, branch smallint NOT NULL, taker_side smallint NOT NULL,
    quantity numeric(78,0) NOT NULL, price numeric(78,0) NOT NULL, quote numeric(78,0) NOT NULL,
    buyer_fee numeric(78,0) NOT NULL, seller_fee numeric(78,0) NOT NULL, tx bytea NOT NULL,
    maker bytea NOT NULL, taker bytea NOT NULL, PRIMARY KEY (deployment, block, log_index))`,
  `CREATE INDEX IF NOT EXISTS trades_market ON probabl.trades (deployment, market, block, log_index)`,
  `CREATE INDEX IF NOT EXISTS trades_maker ON probabl.trades (deployment, maker, block, log_index)`,
  `CREATE INDEX IF NOT EXISTS trades_taker ON probabl.trades (deployment, taker, block, log_index)`,
  // Recent trades by time, covering what windowed volume reads (an index-only range scan).
  `CREATE INDEX IF NOT EXISTS trades_time ON probabl.trades (deployment, block_time)
    INCLUDE (market, block, quote)`,
  // Each open market's book midpoints and its stock's reference price, once a minute: the price
  // charts. Midpoints are raw (quote per base x 1e18), absent without a two-sided book; spot is
  // USD per whole token (display only), absent when no reference was current. The key serves
  // the only read, one market's minutes since some time.
  `CREATE TABLE IF NOT EXISTS probabl.market_prices (
    minute bigint NOT NULL, market integer NOT NULL, deployment smallint NOT NULL,
    yes_price numeric(78,0), no_price numeric(78,0), spot numeric,
    PRIMARY KEY (deployment, market, minute))`,
  // Closed orders (open ones live in the checkpointed replica). The key serves the only read,
  // an owner's newest closed orders, and makes re-persisting a batch idempotent.
  `CREATE TABLE IF NOT EXISTS probabl.closed_orders (
    seq bigint NOT NULL, expiry bigint NOT NULL, placed_at bigint NOT NULL,
    updated_block bigint NOT NULL, market integer NOT NULL, max_fee_bps integer NOT NULL,
    deployment smallint NOT NULL, branch smallint NOT NULL, side smallint NOT NULL,
    funding_kind smallint NOT NULL, tif smallint NOT NULL, quantity numeric(78,0) NOT NULL,
    price numeric(78,0) NOT NULL, filled numeric(78,0) NOT NULL, fees_paid numeric(78,0) NOT NULL,
    owner bytea NOT NULL, delegate bytea, placed_tx bytea NOT NULL,
    PRIMARY KEY (deployment, owner, updated_block, market, branch, seq))`,
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

const P96 = "79228162514264337593543950336";
const P128 = "340282366920938463463374607431768211456";
const P160 = "1461501637330902918203684832716283019655932542976";
const address = (text: string) => `decode(substr(${text}, 3), 'hex')`;

/** Version 1 kept every protocol event (JSON) and closed orders as JSON views. Checkpoints
 * become bytes first (the legacy JSON stays readable); after the version 2 tables exist, trades
 * and closed orders are copied into them and the event log is dropped: the checkpoint and the
 * chain hold everything else. */
const FROM_V1_BEFORE = [
  "ALTER TABLE probabl.checkpoints ALTER COLUMN state TYPE bytea USING convert_to(state, 'UTF8')",
];
const FROM_V1_AFTER = [
  `INSERT INTO probabl.deployments (domain)
    SELECT domain FROM probabl.checkpoints UNION SELECT domain FROM probabl.events
    UNION SELECT domain FROM probabl.orders ON CONFLICT (domain) DO NOTHING`,
  `INSERT INTO probabl.trades (deployment, block, log_index, block_time, market, branch,
    taker_side, maker_seq, taker_seq, quantity, price, quote, buyer_fee, seller_fee, tx, maker, taker)
  SELECT d.id, e.block, e.log_index, e.block_time, e.market,
    mod(div(e.fill, ${P160}), 256), (e.data->'trade'->>'takerSide')::smallint,
    mod(div(e.fill, ${P96}), 4294967296), mod(div(e.fill, ${P128}), 4294967296),
    mod(e.fill, ${P96}), (e.data->'trade'->>'price')::numeric, mod(e.amounts, ${P128}),
    mod(e.fees, ${P128}), div(e.fees, ${P128}), ${address("e.tx")},
    ${address("e.data->'trade'->>'maker'")}, ${address("e.data->'trade'->>'taker'")}
  FROM (SELECT *, (data->>'fill')::numeric AS fill, (data->>'amounts')::numeric AS amounts,
      (data->>'fees')::numeric AS fees FROM probabl.events WHERE name = 'Trade') e
    JOIN probabl.deployments d ON d.domain = e.domain
  ON CONFLICT DO NOTHING`,
  `INSERT INTO probabl.closed_orders (deployment, market, branch, seq, owner, delegate, side,
    funding_kind, tif, quantity, price, expiry, max_fee_bps, filled, fees_paid, placed_at,
    placed_tx, updated_block)
  SELECT d.id, o.market, (o.data->>'branch')::smallint, (o.data->>'sequence')::bigint,
    ${address("o.owner")}, ${address("o.data->>'delegate'")}, (o.data->>'side')::smallint,
    (o.data->>'fundingKind')::smallint, (o.data->>'tif')::smallint,
    (o.data->>'quantity')::numeric, (o.data->>'limitPriceRawX18')::numeric,
    (o.data->>'expiry')::bigint, (o.data->>'maxFeeBps')::integer, (o.data->>'filled')::numeric,
    (o.data->>'feesPaid')::numeric,
    extract(epoch FROM (o.data->>'createdAt')::timestamptz)::bigint,
    ${address("o.data->>'transactionHash'")}, o.updated_block
  FROM probabl.orders o JOIN probabl.deployments d ON d.domain = o.domain
  ON CONFLICT DO NOTHING`,
  "DROP TABLE probabl.events",
  "DROP TABLE probabl.orders",
];

export async function initializeStorage(pool: Pool) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    // Migrations may copy large tables: no statement timeout inside this transaction.
    await tx.query("SET LOCAL statement_timeout = 0");
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('probabl-storage-schema'))");
    for (const statement of DDL.slice(0, 2)) await tx.query(statement);
    const row = (await tx.query("SELECT version FROM probabl.schema_version WHERE id")).rows[0];
    const version: number | undefined = row?.version;
    if (version !== undefined && version !== 1 && version !== SCHEMA_VERSION)
      throw new Error("Database schema belongs to another release: provision a fresh schema");
    if (version === 1) for (const statement of FROM_V1_BEFORE) await tx.query(statement);
    for (const statement of DDL.slice(2)) await tx.query(statement);
    if (version === 1) for (const statement of FROM_V1_AFTER) await tx.query(statement);
    await tx.query(
      `INSERT INTO probabl.schema_version VALUES (true, $1) ON CONFLICT (id) DO UPDATE
      SET version = EXCLUDED.version WHERE probabl.schema_version.version <> EXCLUDED.version`,
      [SCHEMA_VERSION],
    );
    await tx.query("COMMIT");
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
