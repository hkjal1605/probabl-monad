import {
  canonicalStringify,
  hashCanonical,
  type NormalizedPolymarketMarket,
} from "@conditional-stocks/market-data";
import { Pool, type PoolClient } from "pg";
import { databaseUrl } from "../postgres-url.ts";
import type { IngestorAlert, MetadataSnapshot, SubscriptionRecord } from "./types.ts";

export type { IngestorAlert, MetadataSnapshot, SubscriptionRecord } from "./types.ts";

type Connection = Pick<Pool, "query"> | PoolClient;
type Hex = `0x${string}`;

export function createPolymarketDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString: databaseUrl(connectionString),
    max: 4,
    application_name: "probabl-polymarket",
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
  });
  pool.on("error", () => console.error("Polymarket database idle connection failed"));
  return pool;
}

/** Polymarket source data is independent of any protocol deployment. */
export async function initializePolymarketStorage(
  pool: Pool,
  options: { createSchema?: boolean } = {},
) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('polymarket-storage-schema'))");
    // Production namespaces are provisioned by the database administrator; a
    // runtime role must never need database-wide CREATE. Disposable localhost
    // tests may explicitly request their own namespace.
    if (options.createSchema) await tx.query("CREATE SCHEMA IF NOT EXISTS operations");
    await tx.query(`CREATE TABLE IF NOT EXISTS operations.polymarket_snapshots (
      snapshot_id text PRIMARY KEY, gamma_market_id text NOT NULL, condition_id text NOT NULL,
      observed_at_ms numeric(78,0) NOT NULL, payload text NOT NULL)`);
    await tx.query(`CREATE TABLE IF NOT EXISTS operations.polymarket_heads (
      gamma_market_id text PRIMARY KEY, condition_id text NOT NULL,
      snapshot_id text NOT NULL REFERENCES operations.polymarket_snapshots(snapshot_id),
      observed_at_ms numeric(78,0) NOT NULL)`);
    await tx.query(`CREATE INDEX IF NOT EXISTS polymarket_head_condition_idx
      ON operations.polymarket_heads(condition_id,observed_at_ms,gamma_market_id)`);
    // Probability ticks are served from the live books only: the per-update tick table was
    // written on every book change and never read. The migration (schema owner) removes it.
    if (options.createSchema) await tx.query("DROP TABLE IF EXISTS operations.polymarket_ticks");
    await tx.query(`CREATE TABLE IF NOT EXISTS operations.polymarket_subscriptions (
      condition_id text PRIMARY KEY, sequence bigserial NOT NULL UNIQUE, payload text NOT NULL)`);
    await tx.query(`CREATE TABLE IF NOT EXISTS operations.polymarket_alerts (
      id text PRIMARY KEY, sequence bigserial NOT NULL UNIQUE, condition_id text,
      code text NOT NULL, created_at_ms numeric(78,0) NOT NULL, payload text NOT NULL)`);
    await tx.query("COMMIT");
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}

async function locked<T>(pool: Pool, key: string, work: (tx: PoolClient) => Promise<T>) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
    const result = await work(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}

export function createPolymarketQueries(pool: Pool) {
  async function metadata(
    snapshotId: string,
    db: Connection = pool,
  ): Promise<MetadataSnapshot | null> {
    const row = await db.query(
      "SELECT payload FROM operations.polymarket_snapshots WHERE snapshot_id=$1",
      [snapshotId],
    );
    return row.rows[0] ? JSON.parse(row.rows[0].payload) : null;
  }
  async function appendMetadata(rawPayload: unknown, normalized: NormalizedPolymarketMarket) {
    const rawHash = hashCanonical(rawPayload);
    const snapshot: MetadataSnapshot = {
      fetchedAtMs: Date.now().toString(),
      normalized,
      rawHash,
      rawPayload,
      snapshotId: rawHash,
    };
    return locked(pool, `polymarket:metadata:${normalized.gammaMarketId}`, async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO operations.polymarket_snapshots
        (snapshot_id,gamma_market_id,condition_id,observed_at_ms,payload) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT DO NOTHING`,
        [
          rawHash,
          normalized.gammaMarketId,
          normalized.conditionId.toLowerCase(),
          snapshot.fetchedAtMs,
          canonicalStringify(snapshot),
        ],
      );
      await tx.query(
        `INSERT INTO operations.polymarket_heads
        (gamma_market_id,condition_id,snapshot_id,observed_at_ms) VALUES($1,$2,$3,$4)
        ON CONFLICT (gamma_market_id) DO UPDATE SET condition_id=EXCLUDED.condition_id,
        snapshot_id=EXCLUDED.snapshot_id,observed_at_ms=EXCLUDED.observed_at_ms
        WHERE operations.polymarket_heads.snapshot_id <> EXCLUDED.snapshot_id
          AND operations.polymarket_heads.observed_at_ms <= EXCLUDED.observed_at_ms`,
        [
          normalized.gammaMarketId,
          normalized.conditionId.toLowerCase(),
          rawHash,
          snapshot.fetchedAtMs,
        ],
      );
      // A new row is exactly `snapshot`; an existing one keeps its first observation.
      return inserted.rowCount ? snapshot : ((await metadata(rawHash, tx)) ?? snapshot);
    });
  }
  async function appendAlert(
    code: string,
    conditionId: Hex | null,
    details: unknown,
  ): Promise<IngestorAlert> {
    const alert: IngestorAlert = {
      code,
      conditionId,
      details,
      createdAtMs: Date.now().toString(),
      id: crypto.randomUUID(),
    };
    await pool.query(
      `INSERT INTO operations.polymarket_alerts
      (id,code,condition_id,created_at_ms,payload) VALUES($1,$2,$3,$4,$5)`,
      [alert.id, code, conditionId, alert.createdAtMs, canonicalStringify(alert)],
    );
    return alert;
  }
  async function subscription(
    conditionId: Hex,
    db: Connection = pool,
  ): Promise<SubscriptionRecord | null> {
    const row = await db.query(
      "SELECT payload FROM operations.polymarket_subscriptions WHERE condition_id=$1",
      [conditionId.toLowerCase()],
    );
    return row.rows[0] ? JSON.parse(row.rows[0].payload) : null;
  }
  async function addSubscription(record: SubscriptionRecord) {
    return locked(
      pool,
      `polymarket:subscription:${record.conditionId.toLowerCase()}`,
      async (tx) => {
        const existing = await subscription(record.conditionId, tx);
        if (existing) {
          if (
            existing.conditionId.toLowerCase() !== record.conditionId.toLowerCase() ||
            existing.gammaMarketId !== record.gammaMarketId ||
            existing.yesTokenId !== record.yesTokenId
          )
            throw new Error(`immutable subscription conflict for ${record.conditionId}`);
          if (existing.metadataSnapshotId === record.metadataSnapshotId) return existing;
          const updated = { ...existing, metadataSnapshotId: record.metadataSnapshotId };
          await tx.query(
            "UPDATE operations.polymarket_subscriptions SET payload=$2 WHERE condition_id=$1",
            [record.conditionId.toLowerCase(), canonicalStringify(updated)],
          );
          return updated;
        }
        await tx.query(
          "INSERT INTO operations.polymarket_subscriptions(condition_id,payload) VALUES($1,$2)",
          [record.conditionId.toLowerCase(), canonicalStringify(record)],
        );
        return record;
      },
    );
  }
  async function latestMetadataByCondition(conditionId: Hex): Promise<MetadataSnapshot | null> {
    const row = await pool.query(
      `SELECT s.payload FROM operations.polymarket_heads h
      JOIN operations.polymarket_snapshots s ON s.snapshot_id=h.snapshot_id
      WHERE h.condition_id=$1 ORDER BY h.observed_at_ms DESC,h.gamma_market_id ASC LIMIT 1`,
      [conditionId.toLowerCase()],
    );
    return row.rows[0] ? JSON.parse(row.rows[0].payload) : null;
  }
  async function latestMetadataByGammaId(gammaMarketId: string): Promise<MetadataSnapshot | null> {
    const row = await pool.query(
      `SELECT s.payload FROM operations.polymarket_heads h
      JOIN operations.polymarket_snapshots s ON s.snapshot_id=h.snapshot_id
      WHERE h.gamma_market_id=$1`,
      [gammaMarketId],
    );
    return row.rows[0] ? JSON.parse(row.rows[0].payload) : null;
  }
  async function subscriptions(): Promise<SubscriptionRecord[]> {
    const rows = await pool.query(
      "SELECT payload FROM operations.polymarket_subscriptions ORDER BY sequence ASC",
    );
    return rows.rows.map((row) => JSON.parse(row.payload));
  }
  async function alerts(limit = 100): Promise<IngestorAlert[]> {
    const bounded = Math.min(Math.max(Math.trunc(Number.isFinite(limit) ? limit : 100), 1), 500);
    const rows = await pool.query(
      "SELECT payload FROM operations.polymarket_alerts ORDER BY sequence DESC LIMIT $1",
      [bounded],
    );
    return rows.rows.map((row) => JSON.parse(row.payload));
  }
  return {
    appendMetadata,
    appendAlert,
    addSubscription,
    metadata,
    latestMetadataByCondition,
    latestMetadataByGammaId,
    subscription,
    subscriptions,
    alerts,
    close: () => pool.end(),
  };
}
export type PolymarketQueries = ReturnType<typeof createPolymarketQueries>;
