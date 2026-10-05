import { Pool, type PoolClient } from "pg";
import { databaseUrl } from "./postgres-url.ts";
import {
  type FinalizedBatch,
  InviteError,
  type MemberRecord,
  type Queries,
  queries,
  writeFinalized,
} from "./queries.ts";
import { initializeStorage, SCHEMA_VERSION } from "./schema.ts";

export type {
  Checkpoint,
  ClosedOrderRecord,
  FinalizedBatch,
  InviteCodeRecord,
  MemberRecord,
  MinutePrices,
  MinuteVolume,
  Queries,
  RefereeTotal,
  ReferralPayoutRecord,
  ReferralTotal,
  TradeRecord,
} from "./queries.ts";
export { InviteError, SignInCapacityError } from "./queries.ts";
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
    /** Serialized work under an advisory lock held by one connection, without a transaction:
     * each statement commits on its own, so a journal entry is durable before the action it
     * records (a payout's transfer) leaves the process. */
    async serialized<T>(lock: string, work: (q: Queries) => Promise<T>) {
      const client = await pool.connect();
      let reusable = false;
      try {
        await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [lock]);
        try {
          return await work(queries(client));
        } finally {
          await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lock]);
          reusable = true;
        }
      } finally {
        // A connection that could not unlock is closed instead, which releases the lock.
        client.release(!reusable);
      }
    },
    persistFinalized(domain: string, batch: FinalizedBatch) {
      return transaction(null, (tx) => writeFinalized(tx, domain, batch));
    },
    /** Joins `wallet` with `code`: one use of the code, and its owner as referrer for good. */
    redeemInvite(wallet: string, code: string, codeQuota: number): Promise<MemberRecord> {
      const key = wallet.slice(2).toLowerCase();
      return transaction(`member:${key}`, async (tx) => {
        const q = queries(tx);
        if (await q.member(wallet)) throw new InviteError("This wallet is already a member.");
        const used = await tx.query<{ owner: string | null }>(
          `UPDATE probabl.invite_codes SET uses = uses + 1
          WHERE code = $1 AND uses < max_uses AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())
            AND (owner IS NULL OR owner <> decode($2, 'hex'))
          RETURNING encode(owner, 'hex') AS owner`,
          [code, key],
        );
        if (used.rowCount !== 1)
          throw new InviteError(
            (await q.inviteRefusal(code, wallet)) ?? "This invite code cannot be used.",
          );
        const owner = used.rows[0]!.owner;
        await tx.query(
          `INSERT INTO probabl.members (wallet, code, referrer, code_quota)
          VALUES (decode($1, 'hex'), $2, $3::bytea, $4)`,
          [key, code, owner === null ? null : Buffer.from(owner, "hex"), codeQuota],
        );
        return (await q.member(wallet))!;
      });
    },
    /** A new single-use code owned by a member, within its quota. */
    createMemberInvite(wallet: string, code: string) {
      const key = wallet.slice(2).toLowerCase();
      return transaction(`member:${key}`, async (tx) => {
        const member = await queries(tx).member(wallet);
        if (!member) throw new InviteError("Join with an invite code first.");
        if (member.suspendedAt) throw new InviteError("This account is suspended.");
        const created = await tx.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM probabl.invite_codes WHERE owner = decode($1, 'hex')",
          [key],
        );
        if (created.rows[0]!.count >= member.codeQuota)
          throw new InviteError("You have created all the invite codes you can.");
        await tx.query(
          "INSERT INTO probabl.invite_codes (code, owner) VALUES ($1, decode($2, 'hex'))",
          [code, key],
        );
        return code;
      });
    },
    /** Accrues referral rewards for the next finalized trades: each side of a fill whose wallet
     * joined through a referrer (within `months` of joining, to the second as blocks are stamped;
     * its own trades excluded) gives that
     * referrer `rateBps` of its net fee, rounded down, in the claims the fee was charged in. A
     * taker's net fee is its fee less the maker rebate paid from it. One serialized transaction
     * per batch, so a crash never double-counts. */
    accrueReferrals(domain: string, options: { rateBps: number; months: number; limit?: number }) {
      return transaction(`referral-accrual:${domain}`, async (tx) => {
        const cursor = (
          await tx.query<{ block: string; log_index: number }>(
            `SELECT block::text, log_index FROM probabl.referral_cursor
            WHERE deployment = (SELECT id FROM probabl.deployments WHERE domain = $1)`,
            [domain],
          )
        ).rows[0];
        const result = (
          await tx.query<{
            trades: string;
            accruals: string;
            block: string | null;
            log_index: number | null;
          }>(
            `WITH d AS (SELECT id FROM probabl.deployments WHERE domain = $1),
            batch AS (
              SELECT block, log_index, block_time, market, branch, taker_side, buyer_fee, seller_fee,
                maker_rebate, maker, taker
              FROM probabl.trades WHERE deployment = (SELECT id FROM d) AND (block, log_index) > ($2::bigint, $3::int)
              ORDER BY block, log_index LIMIT $4::int),
            sides AS (
              SELECT block, log_index, block_time, market, branch, 0 AS role, maker AS referee,
                CASE WHEN taker_side = 0 THEN 0 ELSE 1 END AS collateral,
                CASE WHEN taker_side = 0 THEN seller_fee ELSE buyer_fee END AS fee
              FROM batch WHERE maker <> taker
              UNION ALL
              SELECT block, log_index, block_time, market, branch, 1, taker,
                CASE WHEN taker_side = 0 THEN 1 ELSE 0 END,
                (CASE WHEN taker_side = 0 THEN buyer_fee ELSE seller_fee END) - maker_rebate
              FROM batch WHERE maker <> taker),
            accrued AS (
              INSERT INTO probabl.referral_accruals (deployment, block, block_time, log_index, market,
                role, branch, collateral, rate_bps, fee, amount, referrer, referee)
              SELECT (SELECT id FROM d), s.block, s.block_time, s.log_index, s.market, s.role, s.branch,
                s.collateral, $5::int, s.fee, div(s.fee * $5::int, 10000), m.referrer, s.referee
              FROM sides s
              JOIN probabl.members m ON m.wallet = s.referee AND m.referrer IS NOT NULL
              JOIN probabl.members r ON r.wallet = m.referrer AND r.suspended_at IS NULL
              WHERE div(s.fee * $5::int, 10000) > 0
                AND s.block_time >= floor(extract(epoch FROM m.joined_at))
                AND s.block_time < floor(extract(epoch FROM m.joined_at + make_interval(months => $6::int)))
              ON CONFLICT DO NOTHING RETURNING 1),
            last AS (SELECT block, log_index FROM batch ORDER BY block DESC, log_index DESC LIMIT 1)
            SELECT (SELECT count(*) FROM batch)::text AS trades,
              (SELECT count(*) FROM accrued)::text AS accruals,
              (SELECT block::text FROM last) AS block, (SELECT log_index FROM last) AS log_index`,
            [
              domain,
              cursor?.block ?? "-1",
              cursor?.log_index ?? -1,
              options.limit ?? 5_000,
              options.rateBps,
              options.months,
            ],
          )
        ).rows[0]!;
        if (result.block !== null)
          await tx.query(
            `INSERT INTO probabl.referral_cursor
            VALUES ((SELECT id FROM probabl.deployments WHERE domain = $1), $2, $3)
            ON CONFLICT (deployment) DO UPDATE SET block = excluded.block, log_index = excluded.log_index`,
            [domain, result.block, result.log_index],
          );
        return { trades: Number(result.trades), accruals: Number(result.accruals) };
      });
    },
    close: () => pool.end(),
  };
}
export type Database = ReturnType<typeof database>;
