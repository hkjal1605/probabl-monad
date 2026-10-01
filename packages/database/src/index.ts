import { Pool, type PoolClient } from "pg";
import { databaseUrl } from "./postgres-url.ts";
import { type FinalizedBatch, type Queries, queries, writeFinalized } from "./queries.ts";
import { initializeStorage, SCHEMA_VERSION } from "./schema.ts";

export type {
  Checkpoint,
  ClosedOrderRecord,
  FinalizedBatch,
  MinuteVolume,
  Queries,
  TradeRecord,
} from "./queries.ts";
export { SignInCapacityError } from "./queries.ts";
export { SCHEMA_VERSION } from "./schema.ts";

export function createDatabase(options: {
  connectionString: string;
  max?: number;
  applicationName?: string;
}) {
  const pool = new Pool({
    connectionString: databaseUrl(options.connectionString),
    max: options.max ?? 8,
    application_name: options.applicationName ?? "probabl",
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
  });
  pool.on("error", () => console.error("Database idle connection failed"));
  return database(pool);
}

/** Injectable for tests; services receive only this typed surface, never raw SQL. */
export function database(pool: Pool) {
  async function transaction<T>(lock: string | null, work: (tx: PoolClient) => Promise<T>) {
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      if (lock) await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lock]);
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
  return {
    ...queries(pool),
    initialize: () => initializeStorage(pool),
    async verify() {
      const row = (await pool.query("SELECT version FROM probabl.schema_version WHERE id")).rows[0];
      if (row?.version !== SCHEMA_VERSION)
        throw new Error("Database schema does not match this release");
    },
    /** Serialized work under an advisory lock, in one transaction. */
    locked<T>(lock: string, work: (q: Queries) => Promise<T>) {
      return transaction(lock, (tx) => work(queries(tx)));
    },
    persistFinalized(domain: string, batch: FinalizedBatch) {
      return transaction(null, (tx) => writeFinalized(tx, domain, batch));
    },
    close: () => pool.end(),
  };
}
export type Database = ReturnType<typeof database>;
