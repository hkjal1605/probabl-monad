import {
  canonicalStringify,
  type Hex,
  hashCanonical,
  type NormalizedKalshiMarket,
} from "@conditional-stocks/market-data";
import type { Pool, PoolClient } from "pg";

/** A stored Kalshi market and event as fetched; evidence refers to it by `snapshotId`. */
export interface KalshiSnapshot {
  fetchedAtMs: string;
  normalized: NormalizedKalshiMarket;
  rawHash: Hex;
  rawPayload: unknown;
  snapshotId: string;
}

/** A Kalshi market whose book the ingestor follows. */
export interface KalshiSubscription {
  conditionId: Hex;
  ticker: string;
  metadataSnapshotId: string;
}

type Connection = Pick<Pool, "query"> | PoolClient;

/** Kalshi source data, next to Polymarket's in the ingestor's `operations` schema. */
export async function initializeKalshiStorage(pool: Pool) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('kalshi-storage-schema'))");
    await tx.query(`CREATE TABLE IF NOT EXISTS operations.kalshi_snapshots (
      snapshot_id text PRIMARY KEY, ticker text NOT NULL, condition_id text NOT NULL,
      observed_at_ms numeric(78,0) NOT NULL, payload text NOT NULL)`);
    await tx.query(`CREATE TABLE IF NOT EXISTS operations.kalshi_heads (
      ticker text PRIMARY KEY, condition_id text NOT NULL,
      snapshot_id text NOT NULL REFERENCES operations.kalshi_snapshots(snapshot_id),
      observed_at_ms numeric(78,0) NOT NULL)`);
    await tx.query(`CREATE INDEX IF NOT EXISTS kalshi_head_condition_idx
      ON operations.kalshi_heads(condition_id)`);
    await tx.query(`CREATE TABLE IF NOT EXISTS operations.kalshi_subscriptions (
      condition_id text PRIMARY KEY, sequence bigserial NOT NULL UNIQUE, payload text NOT NULL)`);
    await tx.query("COMMIT");
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}

export function createKalshiQueries(pool: Pool) {
  async function metadata(snapshotId: string, db: Connection = pool) {
    const row = await db.query(
      "SELECT payload FROM operations.kalshi_snapshots WHERE snapshot_id=$1",
      [snapshotId],
    );
    return row.rows[0] ? (JSON.parse(row.rows[0].payload) as KalshiSnapshot) : null;
  }
  /** Stores a fetched snapshot (once per distinct payload) and makes it its ticker's newest. */
  async function appendMetadata(rawPayload: unknown, normalized: NormalizedKalshiMarket) {
    const rawHash = hashCanonical(rawPayload);
    const snapshot: KalshiSnapshot = {
      fetchedAtMs: Date.now().toString(),
      normalized,
      rawHash,
      rawPayload,
      snapshotId: rawHash,
    };
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `kalshi:metadata:${normalized.ticker}`,
      ]);
      const inserted = await tx.query(
        `INSERT INTO operations.kalshi_snapshots
        (snapshot_id,ticker,condition_id,observed_at_ms,payload) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT DO NOTHING`,
        [
          rawHash,
          normalized.ticker,
          normalized.conditionId,
          snapshot.fetchedAtMs,
          canonicalStringify(snapshot),
        ],
      );
      await tx.query(
        `INSERT INTO operations.kalshi_heads (ticker,condition_id,snapshot_id,observed_at_ms)
        VALUES($1,$2,$3,$4) ON CONFLICT (ticker) DO UPDATE SET snapshot_id=EXCLUDED.snapshot_id,
        observed_at_ms=EXCLUDED.observed_at_ms
        WHERE operations.kalshi_heads.observed_at_ms <= EXCLUDED.observed_at_ms`,
        [normalized.ticker, normalized.conditionId, rawHash, snapshot.fetchedAtMs],
      );
      // A new row is exactly `snapshot`; an existing one keeps its first observation.
      const stored = inserted.rowCount ? snapshot : ((await metadata(rawHash, tx)) ?? snapshot);
      await tx.query("COMMIT");
      return stored;
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      tx.release();
    }
  }
  async function latestMetadataByCondition(conditionId: Hex) {
    const row = await pool.query(
      `SELECT s.payload FROM operations.kalshi_heads h
      JOIN operations.kalshi_snapshots s ON s.snapshot_id=h.snapshot_id WHERE h.condition_id=$1`,
      [conditionId.toLowerCase()],
    );
    return row.rows[0] ? (JSON.parse(row.rows[0].payload) as KalshiSnapshot) : null;
  }
  async function latestMetadataByTicker(ticker: string) {
    const row = await pool.query(
      `SELECT s.payload FROM operations.kalshi_heads h
      JOIN operations.kalshi_snapshots s ON s.snapshot_id=h.snapshot_id WHERE h.ticker=$1`,
      [ticker],
    );
    return row.rows[0] ? (JSON.parse(row.rows[0].payload) as KalshiSnapshot) : null;
  }
  /** Follows a market; an existing subscription keeps its ticker and moves to the newer snapshot. */
  async function addSubscription(record: KalshiSubscription) {
    const existing = await pool.query(
      "SELECT payload FROM operations.kalshi_subscriptions WHERE condition_id=$1",
      [record.conditionId],
    );
    const current = existing.rows[0]
      ? (JSON.parse(existing.rows[0].payload) as KalshiSubscription)
      : null;
    if (current && current.ticker !== record.ticker)
      throw new Error(`immutable subscription conflict for ${record.conditionId}`);
    await pool.query(
      `INSERT INTO operations.kalshi_subscriptions(condition_id,payload) VALUES($1,$2)
      ON CONFLICT (condition_id) DO UPDATE SET payload=EXCLUDED.payload`,
      [record.conditionId, canonicalStringify(record)],
    );
    return record;
  }
  async function subscriptions() {
    const rows = await pool.query(
      "SELECT payload FROM operations.kalshi_subscriptions ORDER BY sequence ASC",
    );
    return rows.rows.map((row) => JSON.parse(row.payload) as KalshiSubscription);
  }
  return {
    appendMetadata,
    addSubscription,
    metadata,
    latestMetadataByCondition,
    latestMetadataByTicker,
    subscriptions,
  };
}
export type KalshiQueries = ReturnType<typeof createKalshiQueries>;
