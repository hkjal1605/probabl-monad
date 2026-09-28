import type { Pool, PoolClient } from "pg";

type Connection = Pick<Pool | PoolClient, "query">;

export class SignInCapacityError extends Error {}

export interface StoredEvent {
  block: string;
  log_index: number;
  tx: string;
  block_time: string;
  name: string;
  market: number | null;
  owner: string | null;
  counterparty: string | null;
  data: Record<string, unknown>;
}
export interface FinalizedBatch {
  events: StoredEvent[];
  /** Orders that closed at or before the finalized block (their final image). */
  orders: { key: string; owner: string; market: number; updated_block: string; data: unknown }[];
  checkpoint?: { block: string; hash: string; state: string };
}
export interface Checkpoint {
  block: string;
  hash: string;
  state: string;
}

/** The only SQL surface of the services. Every statement is keyed by an index. */
export function queries(db: Connection) {
  return {
    async ping() {
      await db.query("SELECT 1");
    },

    // ---------------------------------------------------------------- chain index

    async checkpoint(domain: string): Promise<Checkpoint | undefined> {
      return (
        await db.query<Checkpoint>(
          "SELECT block::text, hash, state FROM probabl.checkpoints WHERE domain=$1",
          [domain],
        )
      ).rows[0];
    },
    /** Events after `block` (exclusive) up to `through`, in chain order, for replay. */
    async eventsAfter(domain: string, block: bigint, through: bigint) {
      return (
        await db.query<StoredEvent>(
          `SELECT block::text, log_index, tx, block_time::text, name, market, owner, counterparty, data
          FROM probabl.events WHERE domain=$1 AND block>$2 AND block<=$3 ORDER BY block, log_index`,
          [domain, block.toString(), through.toString()],
        )
      ).rows;
    },
    async lastEventBlock(domain: string): Promise<bigint | null> {
      const row = (
        await db.query<{ block: string | null }>(
          "SELECT max(block)::text AS block FROM probabl.events WHERE domain=$1",
          [domain],
        )
      ).rows[0];
      return row?.block ? BigInt(row.block) : null;
    },
    /** Finalized trades, newest first, of some markets and/or one owner (taker or maker). */
    async trades(domain: string, options: { markets?: number[]; owner?: string; limit: number }) {
      const limit = Math.min(Math.max(Math.trunc(options.limit), 1), 1000);
      if (options.owner)
        return (
          await db.query<StoredEvent>(
            `(SELECT block::text, log_index, tx, block_time::text, name, market, owner, counterparty, data
              FROM probabl.events WHERE domain=$1 AND name='Trade' AND owner=$2
              ORDER BY block DESC, log_index DESC LIMIT $3)
            UNION ALL
            (SELECT block::text, log_index, tx, block_time::text, name, market, owner, counterparty, data
              FROM probabl.events WHERE domain=$1 AND name='Trade' AND counterparty=$2 AND owner<>$2
              ORDER BY block DESC, log_index DESC LIMIT $3)
            ORDER BY block DESC, log_index DESC LIMIT $3`,
            [domain, options.owner, limit],
          )
        ).rows;
      if (options.markets?.length === 1)
        return (
          await db.query<StoredEvent>(
            `SELECT block::text, log_index, tx, block_time::text, name, market, owner, counterparty, data
            FROM probabl.events WHERE domain=$1 AND name='Trade' AND market=$2
            ORDER BY block DESC, log_index DESC LIMIT $3`,
            [domain, options.markets[0], limit],
          )
        ).rows;
      return (
        await db.query<StoredEvent>(
          `SELECT block::text, log_index, tx, block_time::text, name, market, owner, counterparty, data
          FROM probabl.events WHERE domain=$1 AND name='Trade' AND ($2::integer[] IS NULL OR market=ANY($2))
          ORDER BY block DESC, log_index DESC LIMIT $3`,
          [domain, options.markets ?? null, limit],
        )
      ).rows;
    },
    /** Closed orders of one owner, newest first. */
    async closedOrders(domain: string, owner: string, limit = 200) {
      return (
        await db.query<{ data: Record<string, unknown> }>(
          "SELECT data FROM probabl.orders WHERE domain=$1 AND owner=$2 ORDER BY updated_block DESC LIMIT $3",
          [domain, owner, Math.min(Math.max(Math.trunc(limit), 1), 1000)],
        )
      ).rows.map((row) => row.data);
    },

    // ---------------------------------------------------------------- sign-in

    async sessionOwner(domain: string, tokenHash: string) {
      return (
        await db.query<{ owner: string }>(
          "SELECT owner FROM probabl.sessions WHERE token_hash=$1 AND domain=$2 AND expires_at>now()",
          [tokenHash, domain],
        )
      ).rows[0]?.owner;
    },
    async challenge(domain: string, owner: string, id: string) {
      return (
        await db.query<{ message: string }>(
          "SELECT message FROM probabl.auth_challenges WHERE id=$1 AND domain=$2 AND owner=$3 AND expires_at>now()",
          [id, domain, owner],
        )
      ).rows[0]?.message;
    },
    /** Bounded outstanding challenges: 1000 per deployment, 5 per wallet. */
    async createChallenge(domain: string, owner: string, id: string, message: string) {
      const inserted = await db.query(
        `INSERT INTO probabl.auth_challenges
        SELECT $1,$2,$3,$4,now()+interval '2 minutes'
        WHERE (SELECT count(*) FROM probabl.auth_challenges WHERE domain=$2 AND expires_at>now()) < 1000
          AND (SELECT count(*) FROM probabl.auth_challenges WHERE domain=$2 AND owner=$3 AND expires_at>now()) < 5`,
        [id, domain, owner, message],
      );
      if (inserted.rowCount !== 1)
        throw new SignInCapacityError("Too many pending sign-in requests; retry in a few minutes");
    },
    async consumeChallenge(domain: string, owner: string, id: string, tokenHash: string) {
      const consumed = await db.query(
        "DELETE FROM probabl.auth_challenges WHERE id=$1 AND domain=$2 AND owner=$3 AND expires_at>now()",
        [id, domain, owner],
      );
      if (consumed.rowCount !== 1) throw new Error("Challenge expired or already consumed");
      const issued = await db.query<{ expires_at_ms: string }>(
        `INSERT INTO probabl.sessions VALUES($1,$2,$3,now()+interval '30 days')
        RETURNING (extract(epoch from expires_at)*1000)::bigint::text AS expires_at_ms`,
        [tokenHash, domain, owner],
      );
      return Number(issued.rows[0]!.expires_at_ms);
    },
    /** Periodic maintenance, never on the request path. */
    async pruneExpired() {
      await db.query("DELETE FROM probabl.auth_challenges WHERE expires_at<=now()");
      await db.query("DELETE FROM probabl.sessions WHERE expires_at<=now()");
    },

    // ---------------------------------------------------------------- evidence

    async evidence(domain: string, hash: string) {
      return (
        await db.query("SELECT envelope FROM probabl.evidence WHERE domain=$1 AND hash=$2", [
          domain,
          hash,
        ])
      ).rows[0]?.envelope as unknown;
    },
    async putEvidence(
      domain: string,
      hash: string,
      market: string | null,
      envelope: unknown,
      attachments: string[],
    ) {
      await db.query(
        "INSERT INTO probabl.evidence(domain,hash,market,envelope) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING",
        [domain, hash, market, JSON.stringify(envelope)],
      );
      if (attachments.length)
        await db.query(
          `INSERT INTO probabl.evidence_attachments SELECT $1, unnest($2::text[]), $3 ON CONFLICT DO NOTHING`,
          [domain, attachments, hash],
        );
    },
    async evidenceForMarket(domain: string, market: string) {
      return (
        await db.query<{ hash: string }>(
          "SELECT hash FROM probabl.evidence WHERE domain=$1 AND market=$2",
          [domain, market],
        )
      ).rows;
    },
    async evidenceList(domain: string, limit = 200) {
      return (
        await db.query<{ hash: string; envelope: unknown }>(
          "SELECT hash, envelope FROM probabl.evidence WHERE domain=$1 ORDER BY created_at DESC LIMIT $2",
          [domain, limit],
        )
      ).rows;
    },
    async evidenceActions(domain: string, hash: string) {
      return (
        await db.query<{ kind: string; payload: unknown }>(
          "SELECT kind, payload FROM probabl.evidence_actions WHERE domain=$1 AND packet_hash=$2 ORDER BY created_at, id",
          [domain, hash],
        )
      ).rows;
    },
    /** Actions of many packets in one round trip (list views). */
    async evidenceActionsFor(domain: string, hashes: string[]) {
      if (!hashes.length) return [];
      return (
        await db.query<{ packet_hash: string; kind: string; payload: unknown }>(
          `SELECT packet_hash, kind, payload FROM probabl.evidence_actions
          WHERE domain=$1 AND packet_hash=ANY($2::text[]) ORDER BY created_at, id`,
          [domain, hashes],
        )
      ).rows;
    },
    async audit(domain: string, hash: string, kind: string, actor: string, payload: unknown) {
      await db.query(
        "INSERT INTO probabl.evidence_actions(id,domain,packet_hash,kind,actor,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
        [crypto.randomUUID(), domain, hash, kind, actor, JSON.stringify(payload)],
      );
    },
    async auditHistory(domain: string, limit = 500) {
      return (
        await db.query(
          "SELECT id, kind, actor, packet_hash, payload, created_at FROM probabl.evidence_actions WHERE domain=$1 ORDER BY created_at DESC, id DESC LIMIT $2",
          [domain, limit],
        )
      ).rows;
    },
    async putAttachment(domain: string, hash: string, content: Buffer) {
      await db.query("INSERT INTO probabl.attachments VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [
        domain,
        hash,
        content,
      ]);
    },
    async attachment(domain: string, hash: string): Promise<Buffer | undefined> {
      return (
        await db.query("SELECT content FROM probabl.attachments WHERE domain=$1 AND hash=$2", [
          domain,
          hash,
        ])
      ).rows[0]?.content;
    },
    async attachmentPackets(domain: string, hash: string) {
      return (
        await db.query<{ packet_hash: string }>(
          "SELECT packet_hash FROM probabl.evidence_attachments WHERE domain=$1 AND content_hash=$2",
          [domain, hash],
        )
      ).rows.map((row) => row.packet_hash);
    },

    // ---------------------------------------------------------------- faucet

    async faucetClaim(domain: string, owner: string) {
      const row = (
        await db.query<{ delivered: string[]; transactions: string[]; completed_at: Date | null }>(
          "SELECT delivered, transactions, completed_at FROM probabl.faucet_claims WHERE domain=$1 AND owner=$2",
          [domain, owner],
        )
      ).rows[0];
      return row
        ? {
            delivered: row.delivered,
            transactions: row.transactions,
            completedAt: row.completed_at,
          }
        : undefined;
    },
    async recordFaucetDelivery(
      domain: string,
      owner: string,
      delivered: string[],
      transaction: string | null,
      complete: boolean,
    ) {
      await db.query(
        `INSERT INTO probabl.faucet_claims (domain, owner, delivered, transactions, completed_at)
        VALUES($1,$2,$3::jsonb,$4::jsonb,CASE WHEN $5 THEN now() END)
        ON CONFLICT (domain, owner) DO UPDATE SET
          delivered=probabl.faucet_claims.delivered || EXCLUDED.delivered,
          transactions=probabl.faucet_claims.transactions || EXCLUDED.transactions,
          completed_at=COALESCE(probabl.faucet_claims.completed_at, EXCLUDED.completed_at)`,
        [
          domain,
          owner,
          JSON.stringify(delivered),
          JSON.stringify(transaction ? [transaction] : []),
          complete,
        ],
      );
    },
    async faucetClaimsSince(domain: string, seconds: number) {
      return Number(
        (
          await db.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM probabl.faucet_claims WHERE domain=$1 AND created_at>now()-make_interval(secs=>$2)",
            [domain, seconds],
          )
        ).rows[0]!.count,
      );
    },

    // ---------------------------------------------------------------- delegated submissions

    async delegatedSubmission(domain: string, owner: string, clientId: string) {
      return (
        await db.query<{
          order_terms_hash: string;
          delegate: string;
          tx_hash: string;
          raw: string;
        }>(
          "SELECT order_terms_hash, delegate, tx_hash, raw FROM probabl.delegated_submissions WHERE domain=$1 AND owner=$2 AND client_id=$3",
          [domain, owner, clientId],
        )
      ).rows[0];
    },
    async delegatedSubmissionCount(domain: string, owner: string) {
      return Number(
        (
          await db.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM probabl.delegated_submissions WHERE domain=$1 AND owner=$2 AND created_at>now()-interval '1 day'",
            [domain, owner],
          )
        ).rows[0]!.count,
      );
    },
    async recordDelegatedSubmission(
      domain: string,
      owner: string,
      clientId: string,
      orderTermsHash: string,
      delegate: string,
      txHash: string,
      raw: string,
    ) {
      await db.query(
        `INSERT INTO probabl.delegated_submissions
        (domain, owner, client_id, order_terms_hash, delegate, tx_hash, raw) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [domain, owner, clientId, orderTermsHash, delegate, txHash, raw],
      );
    },
  };
}
export type Queries = ReturnType<typeof queries>;

/** One transaction per finalized batch: multi-row inserts, never a statement per row. */
export async function writeFinalized(tx: PoolClient, domain: string, batch: FinalizedBatch) {
  if (batch.events.length)
    await tx.query(
      `INSERT INTO probabl.events
      SELECT $1, x.block, x.log_index, x.tx, x.block_time, x.name, x.market, x.owner, x.counterparty, x.data
      FROM jsonb_to_recordset($2::jsonb) AS x(block bigint, log_index integer, tx text, block_time bigint,
        name text, market integer, owner text, counterparty text, data jsonb)
      ON CONFLICT DO NOTHING`,
      [domain, JSON.stringify(batch.events)],
    );
  if (batch.orders.length)
    await tx.query(
      `INSERT INTO probabl.orders
      SELECT $1, x.key, x.owner, x.market, x.updated_block, x.data
      FROM jsonb_to_recordset($2::jsonb) AS x(key text, owner text, market integer, updated_block bigint, data jsonb)
      ON CONFLICT (domain, key) DO UPDATE SET updated_block=EXCLUDED.updated_block, data=EXCLUDED.data`,
      [domain, JSON.stringify(batch.orders)],
    );
  if (batch.checkpoint)
    await tx.query(
      `INSERT INTO probabl.checkpoints(domain, block, hash, state, updated_at) VALUES($1,$2,$3,$4,now())
      ON CONFLICT (domain) DO UPDATE SET block=EXCLUDED.block, hash=EXCLUDED.hash, state=EXCLUDED.state,
        updated_at=EXCLUDED.updated_at WHERE probabl.checkpoints.block <= EXCLUDED.block`,
      [domain, batch.checkpoint.block, batch.checkpoint.hash, batch.checkpoint.state],
    );
}
