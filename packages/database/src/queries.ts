import type { Pool, PoolClient } from "pg";

type Connection = Pick<Pool | PoolClient, "query">;

export class SignInCapacityError extends Error {}

/** A finalized trade. Hashes and addresses are lowercase 0x hex. */
export interface TradeRecord {
  block: bigint;
  logIndex: number;
  blockTime: bigint;
  tx: string;
  market: number;
  branch: number;
  takerSide: number;
  makerSeq: bigint;
  takerSeq: bigint;
  quantity: bigint;
  /** The maker's limit price, raw quote per raw base x 1e18. */
  price: bigint;
  quote: bigint;
  buyerFee: bigint;
  sellerFee: bigint;
  /** Paid to the maker out of the taker's fee, in the claims that fee was charged in. */
  makerRebate: bigint;
  maker: string;
  taker: string;
}
/** One market's prices in one minute (unix time / 60): book midpoints, raw quote per raw base
 * x 1e18, and the stock's USD reference price per whole token (a decimal string). */
export interface MinutePrices {
  market: number;
  minute: number;
  yes: bigint | null;
  no: bigint | null;
  spot: string | null;
}
/** Quote traded in one market during one minute (unix time / 60), raw units. */
export interface MinuteVolume {
  market: number;
  minute: number;
  quote: bigint;
}
/** An order closed (filled or cancelled) at or before a finalized block. Its remaining quantity
 * is zero; it is filled when `filled` equals `quantity`. */
export interface ClosedOrderRecord {
  market: number;
  branch: number;
  seq: bigint;
  owner: string;
  delegate: string | null;
  side: number;
  fundingKind: number;
  tif: number;
  quantity: bigint;
  /** Limit price, raw quote per raw base x 1e18. */
  price: bigint;
  expiry: bigint;
  maxFeeBps: number;
  filled: bigint;
  feesPaid: bigint;
  placedAt: bigint;
  placedTx: string;
  updatedBlock: bigint;
}
export interface FinalizedBatch {
  trades: TradeRecord[];
  /** Orders that closed at or before the finalized block. */
  orders: ClosedOrderRecord[];
  /** The finalized replica as opaque bytes. */
  checkpoint?: { block: string; hash: string; state: Uint8Array };
}
export interface Checkpoint {
  block: string;
  hash: string;
  state: Buffer;
}

const bounded = (limit: number, max = 1000) => Math.min(Math.max(Math.trunc(limit), 1), max);
/** 0x hex to the bytea parameter form. */
const hex = (value: string) => value.slice(2).toLowerCase();
/** Resolved once per statement (an InitPlan), so every index below is probed directly. */
const DEPLOYMENT = "(SELECT id FROM probabl.deployments WHERE domain = $1)";
const TRADE = `t.block::text, t.log_index, t.block_time::text, t.market, t.branch, t.taker_side,
  t.maker_seq::text, t.taker_seq::text, t.quantity::text, t.price::text, t.quote::text,
  t.buyer_fee::text, t.seller_fee::text, t.maker_rebate::text, encode(t.tx, 'hex') AS tx,
  encode(t.maker, 'hex') AS maker, encode(t.taker, 'hex') AS taker`;
const NEWEST = "ORDER BY block DESC, log_index DESC LIMIT";
// biome-ignore lint/suspicious/noExplicitAny: pg rows are untyped.
const tradeRecord = (r: any): TradeRecord => ({
  block: BigInt(r.block),
  logIndex: r.log_index,
  blockTime: BigInt(r.block_time),
  tx: `0x${r.tx}`,
  market: r.market,
  branch: r.branch,
  takerSide: r.taker_side,
  makerSeq: BigInt(r.maker_seq),
  takerSeq: BigInt(r.taker_seq),
  quantity: BigInt(r.quantity),
  price: BigInt(r.price),
  quote: BigInt(r.quote),
  buyerFee: BigInt(r.buyer_fee),
  sellerFee: BigInt(r.seller_fee),
  makerRebate: BigInt(r.maker_rebate),
  maker: `0x${r.maker}`,
  taker: `0x${r.taker}`,
});
// biome-ignore lint/suspicious/noExplicitAny: pg rows are untyped.
const closedOrderRecord = (r: any): ClosedOrderRecord => ({
  market: r.market,
  branch: r.branch,
  seq: BigInt(r.seq),
  owner: `0x${r.owner}`,
  delegate: r.delegate === null ? null : `0x${r.delegate}`,
  side: r.side,
  fundingKind: r.funding_kind,
  tif: r.tif,
  quantity: BigInt(r.quantity),
  price: BigInt(r.price),
  expiry: BigInt(r.expiry),
  maxFeeBps: r.max_fee_bps,
  filled: BigInt(r.filled),
  feesPaid: BigInt(r.fees_paid),
  placedAt: BigInt(r.placed_at),
  placedTx: `0x${r.placed_tx}`,
  updatedBlock: BigInt(r.updated_block),
});

/** The only SQL surface of the services. Every statement is keyed by an index. */
export function queries(db: Connection) {
  return {
    async ping() {
      await db.query("SELECT 1");
    },

    // ---------------------------------------------------------------- chain index

    /** Idempotent; checks first so that restarts never consume identity values. */
    async registerDeployment(domain: string) {
      await db.query(
        `INSERT INTO probabl.deployments (domain) SELECT $1
        WHERE NOT EXISTS (SELECT 1 FROM probabl.deployments WHERE domain = $1)
        ON CONFLICT (domain) DO NOTHING`,
        [domain],
      );
    },
    async checkpoint(domain: string): Promise<Checkpoint | undefined> {
      return (
        await db.query<Checkpoint>(
          "SELECT block::text, hash, state FROM probabl.checkpoints WHERE domain=$1",
          [domain],
        )
      ).rows[0];
    },
    /** Finalized trades, newest first, of some markets and/or one owner (taker or maker). Each
     * branch is a top-N read of one index. */
    async trades(
      domain: string,
      options: { markets?: number[]; owner?: string; limit: number },
    ): Promise<TradeRecord[]> {
      const limit = bounded(options.limit);
      const { markets, owner } = options;
      if (owner) {
        const scope = markets ? " AND market = ANY($4::integer[])" : "";
        return (
          await db.query(
            `SELECT ${TRADE} FROM (
              (SELECT * FROM probabl.trades WHERE deployment = ${DEPLOYMENT}
                AND taker = decode($2, 'hex')${scope} ${NEWEST} $3)
              UNION ALL
              (SELECT * FROM probabl.trades WHERE deployment = ${DEPLOYMENT}
                AND maker = decode($2, 'hex') AND taker <> decode($2, 'hex')${scope} ${NEWEST} $3)
            ) t ORDER BY t.block DESC, t.log_index DESC LIMIT $3`,
            [domain, hex(owner), limit, ...(markets ? [markets] : [])],
          )
        ).rows.map(tradeRecord);
      }
      if (markets)
        return (
          await db.query(
            `SELECT ${TRADE} FROM unnest($2::integer[]) AS m(id) CROSS JOIN LATERAL (
              SELECT * FROM probabl.trades WHERE deployment = ${DEPLOYMENT} AND market = m.id
              ${NEWEST} $3) t
            ORDER BY t.block DESC, t.log_index DESC LIMIT $3`,
            [domain, markets, limit],
          )
        ).rows.map(tradeRecord);
      return (
        await db.query(
          `SELECT ${TRADE} FROM probabl.trades t WHERE deployment = ${DEPLOYMENT} ${NEWEST} $2`,
          [domain, limit],
        )
      ).rows.map(tradeRecord);
    },
    /** Quote traded per market and minute since `since` (unix seconds), in blocks up to
     * `through`: one index-only range read of the recent trades, grouped. */
    async minuteVolumes(domain: string, since: bigint, through: bigint): Promise<MinuteVolume[]> {
      return (
        await db.query<{ market: number; minute: string; quote: string }>(
          `SELECT market, (block_time / 60)::text AS minute, sum(quote)::text AS quote
          FROM probabl.trades
          WHERE deployment = ${DEPLOYMENT} AND block_time >= $2 AND block <= $3
          GROUP BY market, block_time / 60`,
          [domain, since.toString(), through.toString()],
        )
      ).rows.map((r) => ({ market: r.market, minute: Number(r.minute), quote: BigInt(r.quote) }));
    },
    /** Records one minute of market prices in one statement; a minute another API process
     * already recorded is kept. */
    async recordPrices(domain: string, rows: readonly MinutePrices[]) {
      if (!rows.length) return;
      await db.query(
        `INSERT INTO probabl.market_prices (deployment, market, minute, yes_price, no_price, spot)
        SELECT ${DEPLOYMENT}, r.market, r.minute, r.yes, r.no, r.spot
        FROM unnest($2::integer[], $3::bigint[], $4::numeric[], $5::numeric[], $6::numeric[])
          AS r(market, minute, yes, no, spot)
        ON CONFLICT DO NOTHING`,
        [
          domain,
          rows.map((r) => r.market),
          rows.map((r) => String(r.minute)),
          rows.map((r) => (r.yes === null ? null : r.yes.toString())),
          rows.map((r) => (r.no === null ? null : r.no.toString())),
          rows.map((r) => r.spot),
        ],
      );
    },
    /** One market's prices from minute `since` on, the last recorded in each `bucket` minutes,
     * oldest first: one range read of the key. */
    async priceHistory(
      domain: string,
      market: number,
      since: number,
      bucket: number,
    ): Promise<MinutePrices[]> {
      return (
        await db.query<{
          minute: string;
          yes: string | null;
          no: string | null;
          spot: string | null;
        }>(
          `SELECT DISTINCT ON (minute / $4) minute::text, yes_price::text AS yes,
            no_price::text AS no, spot::text
          FROM probabl.market_prices
          WHERE deployment = ${DEPLOYMENT} AND market = $2 AND minute >= $3
          ORDER BY minute / $4, minute DESC`,
          [domain, market, String(since), String(Math.max(1, Math.floor(bucket)))],
        )
      ).rows.map((r) => ({
        market,
        minute: Number(r.minute),
        yes: r.yes === null ? null : BigInt(r.yes),
        no: r.no === null ? null : BigInt(r.no),
        spot: r.spot,
      }));
    },
    /** The first minute recorded for a market, if any. */
    async firstPriceMinute(domain: string, market: number): Promise<number | null> {
      const row = (
        await db.query<{ minute: string }>(
          `SELECT minute::text FROM probabl.market_prices
          WHERE deployment = ${DEPLOYMENT} AND market = $2 ORDER BY minute LIMIT 1`,
          [domain, market],
        )
      ).rows[0];
      return row ? Number(row.minute) : null;
    },
    /** Closed orders of one owner, newest first. */
    async closedOrders(domain: string, owner: string, limit = 200): Promise<ClosedOrderRecord[]> {
      return (
        await db.query(
          `SELECT seq::text, expiry::text, placed_at::text, updated_block::text, market,
            max_fee_bps, branch, side, funding_kind, tif, quantity::text, price::text,
            filled::text, fees_paid::text, encode(owner, 'hex') AS owner,
            encode(delegate, 'hex') AS delegate, encode(placed_tx, 'hex') AS placed_tx
          FROM probabl.closed_orders WHERE deployment = ${DEPLOYMENT} AND owner = decode($2, 'hex')
          ORDER BY updated_block DESC LIMIT $3`,
          [domain, hex(owner), bounded(limit)],
        )
      ).rows.map(closedOrderRecord);
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

const text = (values: bigint[]) => values.map(String);

/** One transaction per batch: one statement per table (typed arrays through `unnest`), never a
 * statement per row. Finalized rows never change, so a replayed batch writes nothing. */
export async function writeFinalized(tx: PoolClient, domain: string, batch: FinalizedBatch) {
  const t = batch.trades;
  if (t.length)
    await tx.query(
      `INSERT INTO probabl.trades (deployment, block, log_index, block_time, market, branch,
        taker_side, maker_seq, taker_seq, quantity, price, quote, buyer_fee, seller_fee,
        maker_rebate, tx, maker, taker)
      SELECT ${DEPLOYMENT}, x.block, x.log_index, x.block_time, x.market, x.branch, x.taker_side,
        x.maker_seq, x.taker_seq, x.quantity, x.price, x.quote, x.buyer_fee, x.seller_fee,
        x.maker_rebate, decode(x.tx, 'hex'), decode(x.maker, 'hex'), decode(x.taker, 'hex')
      FROM unnest($2::bigint[], $3::integer[], $4::bigint[], $5::integer[], $6::smallint[],
        $7::smallint[], $8::bigint[], $9::bigint[], $10::numeric[], $11::numeric[],
        $12::numeric[], $13::numeric[], $14::numeric[], $15::numeric[], $16::text[], $17::text[],
        $18::text[])
        AS x(block, log_index, block_time, market, branch, taker_side, maker_seq, taker_seq,
          quantity, price, quote, buyer_fee, seller_fee, maker_rebate, tx, maker, taker)
      ON CONFLICT DO NOTHING`,
      [
        domain,
        text(t.map((r) => r.block)),
        t.map((r) => r.logIndex),
        text(t.map((r) => r.blockTime)),
        t.map((r) => r.market),
        t.map((r) => r.branch),
        t.map((r) => r.takerSide),
        text(t.map((r) => r.makerSeq)),
        text(t.map((r) => r.takerSeq)),
        text(t.map((r) => r.quantity)),
        text(t.map((r) => r.price)),
        text(t.map((r) => r.quote)),
        text(t.map((r) => r.buyerFee)),
        text(t.map((r) => r.sellerFee)),
        text(t.map((r) => r.makerRebate)),
        t.map((r) => hex(r.tx)),
        t.map((r) => hex(r.maker)),
        t.map((r) => hex(r.taker)),
      ],
    );
  const o = batch.orders;
  if (o.length)
    await tx.query(
      `INSERT INTO probabl.closed_orders (deployment, market, branch, seq, owner, delegate, side,
        funding_kind, tif, quantity, price, expiry, max_fee_bps, filled, fees_paid, placed_at,
        placed_tx, updated_block)
      SELECT ${DEPLOYMENT}, x.market, x.branch, x.seq, decode(x.owner, 'hex'),
        decode(x.delegate, 'hex'), x.side, x.funding_kind, x.tif, x.quantity, x.price, x.expiry,
        x.max_fee_bps, x.filled, x.fees_paid, x.placed_at, decode(x.placed_tx, 'hex'),
        x.updated_block
      FROM unnest($2::integer[], $3::smallint[], $4::bigint[], $5::text[], $6::text[],
        $7::smallint[], $8::smallint[], $9::smallint[], $10::numeric[], $11::numeric[],
        $12::bigint[], $13::integer[], $14::numeric[], $15::numeric[], $16::bigint[], $17::text[],
        $18::bigint[])
        AS x(market, branch, seq, owner, delegate, side, funding_kind, tif, quantity, price,
          expiry, max_fee_bps, filled, fees_paid, placed_at, placed_tx, updated_block)
      ON CONFLICT DO NOTHING`,
      [
        domain,
        o.map((r) => r.market),
        o.map((r) => r.branch),
        text(o.map((r) => r.seq)),
        o.map((r) => hex(r.owner)),
        o.map((r) => (r.delegate ? hex(r.delegate) : null)),
        o.map((r) => r.side),
        o.map((r) => r.fundingKind),
        o.map((r) => r.tif),
        text(o.map((r) => r.quantity)),
        text(o.map((r) => r.price)),
        text(o.map((r) => r.expiry)),
        o.map((r) => r.maxFeeBps),
        text(o.map((r) => r.filled)),
        text(o.map((r) => r.feesPaid)),
        text(o.map((r) => r.placedAt)),
        o.map((r) => hex(r.placedTx)),
        text(o.map((r) => r.updatedBlock)),
      ],
    );
  if (batch.checkpoint)
    await tx.query(
      `INSERT INTO probabl.checkpoints(domain, block, hash, state, updated_at) VALUES($1,$2,$3,$4,now())
      ON CONFLICT (domain) DO UPDATE SET block=EXCLUDED.block, hash=EXCLUDED.hash, state=EXCLUDED.state,
        updated_at=EXCLUDED.updated_at WHERE probabl.checkpoints.block < EXCLUDED.block`,
      [domain, batch.checkpoint.block, batch.checkpoint.hash, batch.checkpoint.state],
    );
}
