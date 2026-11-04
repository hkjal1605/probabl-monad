/** Queries of the world tables (schema version 6): finalized fills, book metadata, delegated
 * fills, vault marks, product prices, and the world keeper's pricing inputs. Like `queries.ts`,
 * every statement is keyed by an index and batches write through `unnest`. */
import type { Pool, PoolClient } from "pg";

type Connection = Pick<Pool | PoolClient, "query">;

/** A finalized world fill. Hashes and addresses are lowercase 0x hex. */
export interface WorldFillRow {
  block: bigint;
  logIndex: number;
  blockTime: bigint;
  tx: string;
  book: number;
  maker: string;
  taker: string;
  delegate: string | null;
  mask: number;
  sell: boolean;
  units: bigint;
  refund: bigint;
  price: bigint;
  fee: bigint;
  nonce: bigint;
}
/** One leg of a book as its metadata records it: the venue event its key hashes. */
export interface WorldLegMetadata {
  eventKey: string;
  wantYes: boolean;
  source: "polymarket" | "kalshi";
  /** Polymarket's Gamma market id, or the Kalshi ticker. */
  marketId: string;
  conditionId: string;
  yesIndex: number;
  noIndex: number;
  question: string;
  url: string;
  /** When the venue expects the event to resolve (ISO time). */
  endTime: string;
  /** Pricing themes (e.g. "ai", "us-china"). */
  themes?: string[];
  metadataSnapshotId?: string;
}
/** What a book's metadata records besides its definition. */
export interface WorldBookMetadata {
  legs: WorldLegMetadata[];
  /** e.g. "US:NVDA"; null for an event-only book. */
  underlying: string | null;
  /** The feed's decimals (strikes are raw feed answers). */
  feedDecimals: number | null;
  /** The fixing rule as people read it (e.g. "NVDA's Dec 1 close"). */
  fixing: string | null;
  /** The URI whose keccak256 is the definition's `metadataHash`. */
  metadataUri: string;
  /** The definition itself, as JSON (bigints as decimal strings). */
  def: Record<string, unknown>;
}
export interface WorldBookRecord {
  defHash: string;
  book: number | null;
  title: string;
  kind: "curated" | "user";
  metadata: WorldBookMetadata;
  packetHash: string | null;
  createdAt: Date;
}
/** The latent correlation of two events' YES outcomes (`a` < `b` as hex), its standard error
 * in Fisher z and the effective sample behind it. */
export interface WorldCorrelationRecord {
  a: string;
  b: string;
  rho: number;
  error: number;
  samples: number;
  method: string;
  fittedAt: Date;
}
export interface EventVolatilityRecord {
  condition: string;
  /** Per square-root day, in probit units. */
  vol: number;
  samples: number;
  fittedAt: Date;
}
export interface WorldGapRecord {
  condition: string;
  underlying: string;
  gap: number;
  error: number;
  samples: number;
  method: string;
  fittedAt: Date;
}
export interface WorldVolRecord {
  underlying: string;
  vol: number;
  error: number;
  samples: number;
  method: string;
  fittedAt: Date;
}
export type LegRelationKind =
  | "independent"
  | "positive"
  | "negative"
  | "exclusive"
  | "implies"
  | "duplicate";
export interface LegRelationRecord {
  a: string;
  b: string;
  kind: LegRelationKind;
  pBGivenA: number | null;
  pBGivenNotA: number | null;
  confidence: number | null;
  source: string;
  model: string | null;
  reasoning: string | null;
  reviewer: string | null;
  updatedAt: Date;
}
export interface VaultMarkRecord {
  vault: string;
  batch: number;
  nav: bigint;
  guaranteed: bigint;
  best: bigint;
  inputsHash: string;
  inputs: unknown;
  tx: string | null;
  createdAt: Date;
}
/** One book product's best indicative prices in one minute, raw quote per unit x 1e6. */
export interface WorldPriceRow {
  book: number;
  product: string;
  minute: number;
  bid: number | null;
  ask: number | null;
}
/** One condition's YES midpoint and spread (x 1e6) in one minute. */
export interface EventProbabilityRow {
  condition: string;
  minute: number;
  mid: number;
  spread: number | null;
}
export interface WorldFinalizedBatch {
  fills: WorldFillRow[];
  checkpoint?: { block: string; hash: string; state: Uint8Array };
}

const hex = (value: string) => value.slice(2).toLowerCase();
const text = (values: bigint[]) => values.map(String);
const bounded = (limit: number, max = 1000) => Math.min(Math.max(Math.trunc(limit), 1), max);
const DEPLOYMENT = "(SELECT id FROM probabl.deployments WHERE domain = $1)";
const NEWEST = "ORDER BY block DESC, log_index DESC LIMIT";
const FILL = `f.block::text, f.log_index, f.block_time::text, encode(f.tx, 'hex') AS tx, f.book,
  encode(f.maker, 'hex') AS maker, encode(f.taker, 'hex') AS taker,
  encode(f.delegate, 'hex') AS delegate, f.mask, f.sell, f.units::text, f.refund::text,
  f.price::text, f.fee::text, f.nonce::text`;
// biome-ignore lint/suspicious/noExplicitAny: pg rows are untyped.
const fillRow = (r: any): WorldFillRow => ({
  block: BigInt(r.block),
  logIndex: r.log_index,
  blockTime: BigInt(r.block_time),
  tx: `0x${r.tx}`,
  book: r.book,
  maker: `0x${r.maker}`,
  taker: `0x${r.taker}`,
  delegate: r.delegate === null ? null : `0x${r.delegate}`,
  mask: r.mask,
  sell: r.sell,
  units: BigInt(r.units),
  refund: BigInt(r.refund),
  price: BigInt(r.price),
  fee: BigInt(r.fee),
  nonce: BigInt(r.nonce),
});
const BOOK = `encode(def_hash, 'hex') AS def_hash, book, title, kind, metadata, packet_hash,
  created_at`;
// biome-ignore lint/suspicious/noExplicitAny: pg rows are untyped.
const bookRecord = (r: any): WorldBookRecord => ({
  defHash: `0x${r.def_hash}`,
  book: r.book,
  title: r.title,
  kind: r.kind,
  metadata: r.metadata,
  packetHash: r.packet_hash,
  createdAt: r.created_at,
});
// biome-ignore lint/suspicious/noExplicitAny: pg rows are untyped.
const relationRecord = (r: any): LegRelationRecord => ({
  a: `0x${r.a}`,
  b: `0x${r.b}`,
  kind: r.kind,
  pBGivenA: r.p_b_given_a,
  pBGivenNotA: r.p_b_given_not_a,
  confidence: r.confidence,
  source: r.source,
  model: r.model,
  reasoning: r.reasoning,
  reviewer: r.reviewer === null ? null : `0x${r.reviewer}`,
  updatedAt: r.updated_at,
});

export function worldQueries(db: Connection) {
  const worldBook = async (
    domain: string,
    defHash: string,
  ): Promise<WorldBookRecord | undefined> => {
    const row = (
      await db.query(
        `SELECT ${BOOK} FROM probabl.world_books
        WHERE deployment = ${DEPLOYMENT} AND def_hash = decode($2, 'hex')`,
        [domain, hex(defHash)],
      )
    ).rows[0];
    return row ? bookRecord(row) : undefined;
  };
  return {
    worldBook,
    // ---------------------------------------------------------------- fills

    /** Finalized fills, newest first, of some books and/or one owner (taker or maker). */
    async worldFills(
      domain: string,
      options: { books?: number[]; owner?: string; limit: number },
    ): Promise<WorldFillRow[]> {
      const limit = bounded(options.limit);
      const { books, owner } = options;
      if (owner) {
        const scope = books ? " AND book = ANY($4::integer[])" : "";
        return (
          await db.query(
            `SELECT ${FILL} FROM (
              (SELECT * FROM probabl.world_fills WHERE deployment = ${DEPLOYMENT}
                AND taker = decode($2, 'hex')${scope} ${NEWEST} $3)
              UNION ALL
              (SELECT * FROM probabl.world_fills WHERE deployment = ${DEPLOYMENT}
                AND maker = decode($2, 'hex') AND taker <> decode($2, 'hex')${scope} ${NEWEST} $3)
            ) f ORDER BY f.block DESC, f.log_index DESC LIMIT $3`,
            [domain, hex(owner), limit, ...(books ? [books] : [])],
          )
        ).rows.map(fillRow);
      }
      if (books)
        return (
          await db.query(
            `SELECT ${FILL} FROM unnest($2::integer[]) AS b(id) CROSS JOIN LATERAL (
              SELECT * FROM probabl.world_fills WHERE deployment = ${DEPLOYMENT} AND book = b.id
              ${NEWEST} $3) f
            ORDER BY f.block DESC, f.log_index DESC LIMIT $3`,
            [domain, books, limit],
          )
        ).rows.map(fillRow);
      return (
        await db.query(
          `SELECT ${FILL} FROM probabl.world_fills f WHERE deployment = ${DEPLOYMENT} ${NEWEST} $2`,
          [domain, limit],
        )
      ).rows.map(fillRow);
    },
    /** Premium and fees per book since `since` (unix seconds), in blocks up to `through`. */
    async worldVolumes(domain: string, since: bigint, through: bigint) {
      return (
        await db.query<{ book: number; premium: string; fees: string; fills: string }>(
          `SELECT book, sum(price)::text AS premium, sum(fee)::text AS fees, count(*)::text AS fills
          FROM probabl.world_fills
          WHERE deployment = ${DEPLOYMENT} AND block_time >= $2 AND block <= $3
          GROUP BY book`,
          [domain, since.toString(), through.toString()],
        )
      ).rows.map((r) => ({
        book: r.book,
        premium: BigInt(r.premium),
        fees: BigInt(r.fees),
        fills: Number(r.fills),
      }));
    },

    // ---------------------------------------------------------------- books

    /** Registers a book's metadata before it exists (idempotent: a registered definition keeps
     * its first metadata). */
    async registerWorldBook(
      domain: string,
      book: {
        defHash: string;
        title: string;
        kind: "curated" | "user";
        metadata: WorldBookMetadata;
        packetHash?: string | null;
      },
    ): Promise<WorldBookRecord> {
      await db.query(
        `INSERT INTO probabl.world_books (deployment, def_hash, title, kind, metadata, packet_hash)
        VALUES (${DEPLOYMENT}, decode($2, 'hex'), $3, $4, $5, $6)
        ON CONFLICT (deployment, def_hash) DO NOTHING`,
        [
          domain,
          hex(book.defHash),
          book.title,
          book.kind,
          JSON.stringify(book.metadata),
          book.packetHash ?? null,
        ],
      );
      const record = await worldBook(domain, book.defHash);
      if (!record) throw new Error("The world book was not registered");
      return record;
    },
    /** Records the on-chain id of a registered definition. */
    async setWorldBookId(domain: string, defHash: string, book: number) {
      await db.query(
        `UPDATE probabl.world_books SET book = $3
        WHERE deployment = ${DEPLOYMENT} AND def_hash = decode($2, 'hex')
          AND (book IS NULL OR book = $3)`,
        [domain, hex(defHash), book],
      );
    },
    /** Every registered book of the deployment, newest first. */
    async worldBooks(domain: string, limit = 5_000): Promise<WorldBookRecord[]> {
      return (
        await db.query(
          `SELECT ${BOOK} FROM probabl.world_books WHERE deployment = ${DEPLOYMENT}
          ORDER BY created_at DESC LIMIT $2`,
          [domain, bounded(limit, 50_000)],
        )
      ).rows.map(bookRecord);
    },

    // ---------------------------------------------------------------- referrals

    /** A referrer's world rewards by the Monday they unlock on (unix seconds; the first Monday
     * 00:00 UTC after each fill), with the fees and fills behind them. */
    async worldReferralWeeks(domain: string, referrer?: string) {
      return (
        await db.query<{ unlock: string; amount: string; fee: string; fills: string }>(
          `SELECT (floor((block_time - 345600) / 604800) * 604800 + 345600 + 604800)::bigint::text
              AS unlock, sum(amount)::text AS amount, sum(fee)::text AS fee, count(*)::text AS fills
          FROM probabl.referral_accruals
          WHERE deployment = ${DEPLOYMENT}${referrer ? " AND referrer = decode($2, 'hex')" : ""}
          GROUP BY 1 ORDER BY 1`,
          referrer ? [domain, hex(referrer)] : [domain],
        )
      ).rows.map((r) => ({
        unlockAt: Number(r.unlock),
        amount: BigInt(r.amount),
        fee: BigInt(r.fee),
        fills: Number(r.fills),
      }));
    },

    // ---------------------------------------------------------------- delegated fills

    async worldSubmission(domain: string, owner: string, clientId: string) {
      return (
        await db.query<{ terms_hash: string; delegate: string; tx_hash: string; raw: string }>(
          `SELECT terms_hash, delegate, tx_hash, raw FROM probabl.world_submissions
          WHERE domain = $1 AND owner = $2 AND client_id = $3`,
          [domain, owner, clientId],
        )
      ).rows[0];
    },
    async worldSubmissionCount(domain: string, owner: string) {
      return Number(
        (
          await db.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM probabl.world_submissions
            WHERE domain = $1 AND owner = $2 AND created_at > now() - interval '1 day'`,
            [domain, owner],
          )
        ).rows[0]!.count,
      );
    },
    async recordWorldSubmission(
      domain: string,
      owner: string,
      clientId: string,
      termsHash: string,
      delegate: string,
      txHash: string,
      raw: string,
    ) {
      await db.query(
        `INSERT INTO probabl.world_submissions
        (domain, owner, client_id, terms_hash, delegate, tx_hash, raw)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [domain, owner, clientId, termsHash, delegate, txHash, raw],
      );
    },

    // ---------------------------------------------------------------- probability history

    /** Records one minute of probabilities; a minute already recorded is kept. */
    async recordEventProbabilities(rows: readonly EventProbabilityRow[]) {
      if (!rows.length) return;
      await db.query(
        `INSERT INTO probabl.event_probabilities (condition, minute, mid, spread)
        SELECT decode(r.condition, 'hex'), r.minute, r.mid, r.spread
        FROM unnest($1::text[], $2::bigint[], $3::integer[], $4::integer[])
          AS r(condition, minute, mid, spread)
        ON CONFLICT DO NOTHING`,
        [
          rows.map((r) => hex(r.condition)),
          rows.map((r) => String(r.minute)),
          rows.map((r) => r.mid),
          rows.map((r) => r.spread),
        ],
      );
    },
    /** Conditions' probabilities from minute `since`, the last in each `bucket` minutes, oldest
     * first: one range read of the key per condition. */
    async eventProbabilityHistory(
      conditions: readonly string[],
      since: number,
      bucket = 1,
    ): Promise<EventProbabilityRow[]> {
      if (!conditions.length) return [];
      return (
        await db.query<{ condition: string; minute: string; mid: number; spread: number | null }>(
          `SELECT DISTINCT ON (p.condition, p.minute / $3) encode(p.condition, 'hex') AS condition,
            p.minute::text, p.mid, p.spread
          FROM unnest($1::text[]) AS c(id) CROSS JOIN LATERAL (
            SELECT * FROM probabl.event_probabilities
            WHERE condition = decode(c.id, 'hex') AND minute >= $2) p
          ORDER BY p.condition, p.minute / $3, p.minute DESC`,
          [conditions.map(hex), String(since), String(Math.max(1, Math.floor(bucket)))],
        )
      ).rows.map((r) => ({
        condition: `0x${r.condition}`,
        minute: Number(r.minute),
        mid: r.mid,
        spread: r.spread,
      }));
    },

    /** Each condition's last probability at or before `hourUtc`:00 UTC of each day whose cut
     * falls in minutes [`since`, `until`], within the day before the cut: what the daily fit
     * reads, one index probe per condition and day instead of every minute between. Oldest
     * first. */
    async dailyEventProbabilities(
      conditions: readonly string[],
      since: number,
      until: number,
      hourUtc = 20,
    ): Promise<EventProbabilityRow[]> {
      if (!conditions.length || until < since) return [];
      const cut = Math.max(0, Math.min(23, Math.floor(hourUtc))) * 60;
      return (
        await db.query<{ condition: string; minute: string; mid: number; spread: number | null }>(
          `SELECT c.id AS condition, p.minute::text, p.mid, p.spread
          FROM unnest($1::text[]) AS c(id)
          CROSS JOIN generate_series($2::bigint, $3::bigint) AS d(day)
          CROSS JOIN LATERAL (
            SELECT minute, mid, spread FROM probabl.event_probabilities
            WHERE condition = decode(c.id, 'hex') AND minute <= d.day * 1440 + $4
              AND minute > d.day * 1440 + $4 - 1440
            ORDER BY minute DESC LIMIT 1) p
          ORDER BY c.id, p.minute`,
          [
            conditions.map(hex),
            String(Math.ceil((since - cut) / 1_440)),
            String(Math.floor((until - cut) / 1_440)),
            String(cut),
          ],
        )
      ).rows.map((r) => ({
        condition: `0x${r.condition}`,
        minute: Number(r.minute),
        mid: r.mid,
        spread: r.spread,
      }));
    },

    // ---------------------------------------------------------------- pricing inputs

    /** Correlations among `conditions` (both events in the list), or every one without. */
    async worldCorrelations(conditions?: readonly string[]): Promise<WorldCorrelationRecord[]> {
      const SELECT = `SELECT encode(a, 'hex') AS a, encode(b, 'hex') AS b, rho, error, samples,
        method, fitted_at FROM probabl.world_correlations`;
      const rows = conditions
        ? (
            await db.query(
              `${SELECT} WHERE a = ANY(SELECT decode(x, 'hex') FROM unnest($1::text[]) AS x)
                AND b = ANY(SELECT decode(x, 'hex') FROM unnest($1::text[]) AS x)`,
              [conditions.map(hex)],
            )
          ).rows
        : (await db.query(SELECT)).rows;
      return rows.map((r) => ({
        a: `0x${r.a}`,
        b: `0x${r.b}`,
        rho: r.rho,
        error: r.error,
        samples: r.samples,
        method: r.method,
        fittedAt: r.fitted_at,
      }));
    },
    /** Replaces each pair's estimate (ordered `a` < `b`), unless an admin set it. */
    async putWorldCorrelations(
      rows: readonly Omit<WorldCorrelationRecord, "fittedAt">[],
      options: { overrideAdmin?: boolean } = {},
    ) {
      if (!rows.length) return;
      const ordered = rows.map((r) => (hex(r.a) < hex(r.b) ? r : { ...r, a: r.b, b: r.a }));
      await db.query(
        `INSERT INTO probabl.world_correlations (a, b, rho, error, samples, method)
        SELECT decode(r.a, 'hex'), decode(r.b, 'hex'), r.rho, r.error, r.samples, r.method
        FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::integer[],
          $6::text[]) AS r(a, b, rho, error, samples, method)
        ON CONFLICT (a, b) DO UPDATE SET rho = excluded.rho, error = excluded.error,
          samples = excluded.samples, method = excluded.method, fitted_at = now()
        WHERE $7::boolean OR probabl.world_correlations.method <> 'admin'`,
        [
          ordered.map((r) => hex(r.a)),
          ordered.map((r) => hex(r.b)),
          ordered.map((r) => r.rho),
          ordered.map((r) => r.error),
          ordered.map((r) => r.samples),
          ordered.map((r) => r.method),
          options.overrideAdmin === true,
        ],
      );
    },
    async eventVolatilities(conditions?: readonly string[]): Promise<EventVolatilityRecord[]> {
      const SELECT = `SELECT encode(condition, 'hex') AS condition, vol, samples, fitted_at
        FROM probabl.event_volatility`;
      const rows = conditions
        ? (
            await db.query(
              `${SELECT} WHERE condition = ANY(SELECT decode(x, 'hex') FROM unnest($1::text[]) AS x)`,
              [conditions.map(hex)],
            )
          ).rows
        : (await db.query(SELECT)).rows;
      return rows.map((r) => ({
        condition: `0x${r.condition}`,
        vol: r.vol,
        samples: r.samples,
        fittedAt: r.fitted_at,
      }));
    },
    async putEventVolatilities(rows: readonly Omit<EventVolatilityRecord, "fittedAt">[]) {
      if (!rows.length) return;
      await db.query(
        `INSERT INTO probabl.event_volatility (condition, vol, samples)
        SELECT decode(r.condition, 'hex'), r.vol, r.samples
        FROM unnest($1::text[], $2::float8[], $3::integer[]) AS r(condition, vol, samples)
        ON CONFLICT (condition) DO UPDATE SET vol = excluded.vol, samples = excluded.samples,
          fitted_at = now()`,
        [rows.map((r) => hex(r.condition)), rows.map((r) => r.vol), rows.map((r) => r.samples)],
      );
    },
    async worldGaps(underlying?: string): Promise<WorldGapRecord[]> {
      return (
        underlying
          ? await db.query(
              `SELECT encode(condition, 'hex') AS condition, underlying, gap, error, samples,
                method, fitted_at FROM probabl.world_gaps WHERE underlying = $1`,
              [underlying],
            )
          : await db.query(
              `SELECT encode(condition, 'hex') AS condition, underlying, gap, error, samples,
                method, fitted_at FROM probabl.world_gaps`,
            )
      ).rows.map((r) => ({
        condition: `0x${r.condition}`,
        underlying: r.underlying,
        gap: r.gap,
        error: r.error,
        samples: r.samples,
        method: r.method,
        fittedAt: r.fitted_at,
      }));
    },
    async putWorldGaps(
      rows: readonly Omit<WorldGapRecord, "fittedAt">[],
      options: { overrideAdmin?: boolean } = {},
    ) {
      if (!rows.length) return;
      await db.query(
        `INSERT INTO probabl.world_gaps (condition, underlying, gap, error, samples, method)
        SELECT decode(r.condition, 'hex'), r.underlying, r.gap, r.error, r.samples, r.method
        FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::integer[],
          $6::text[]) AS r(condition, underlying, gap, error, samples, method)
        ON CONFLICT (condition, underlying) DO UPDATE SET gap = excluded.gap,
          error = excluded.error, samples = excluded.samples, method = excluded.method,
          fitted_at = now()
        WHERE $7::boolean OR probabl.world_gaps.method <> 'admin'`,
        [
          rows.map((r) => hex(r.condition)),
          rows.map((r) => r.underlying),
          rows.map((r) => r.gap),
          rows.map((r) => r.error),
          rows.map((r) => r.samples),
          rows.map((r) => r.method),
          options.overrideAdmin === true,
        ],
      );
    },
    async worldVols(): Promise<WorldVolRecord[]> {
      return (
        await db.query(
          "SELECT underlying, vol, error, samples, method, fitted_at FROM probabl.world_vols",
        )
      ).rows.map((r) => ({
        underlying: r.underlying,
        vol: r.vol,
        error: r.error,
        samples: r.samples,
        method: r.method,
        fittedAt: r.fitted_at,
      }));
    },
    async putWorldVols(
      rows: readonly Omit<WorldVolRecord, "fittedAt">[],
      options: { overrideAdmin?: boolean } = {},
    ) {
      if (!rows.length) return;
      await db.query(
        `INSERT INTO probabl.world_vols (underlying, vol, error, samples, method)
        SELECT * FROM unnest($1::text[], $2::float8[], $3::float8[], $4::integer[], $5::text[])
        ON CONFLICT (underlying) DO UPDATE SET vol = excluded.vol, error = excluded.error,
          samples = excluded.samples, method = excluded.method, fitted_at = now()
        WHERE $6::boolean OR probabl.world_vols.method <> 'admin'`,
        [
          rows.map((r) => r.underlying),
          rows.map((r) => r.vol),
          rows.map((r) => r.error),
          rows.map((r) => r.samples),
          rows.map((r) => r.method),
          options.overrideAdmin === true,
        ],
      );
    },
    /** Relations touching any of `conditions` (every relation without). */
    async legRelations(conditions?: readonly string[]): Promise<LegRelationRecord[]> {
      const SELECT = `SELECT encode(a, 'hex') AS a, encode(b, 'hex') AS b, kind, p_b_given_a,
        p_b_given_not_a, confidence, source, model, reasoning, encode(reviewer, 'hex') AS reviewer,
        updated_at FROM probabl.leg_relations`;
      if (!conditions) return (await db.query(SELECT)).rows.map(relationRecord);
      return (
        await db.query(
          `${SELECT} WHERE a = ANY(SELECT decode(x, 'hex') FROM unnest($1::text[]) AS x)
          UNION ${SELECT} WHERE b = ANY(SELECT decode(x, 'hex') FROM unnest($1::text[]) AS x)`,
          [conditions.map(hex)],
        )
      ).rows.map(relationRecord);
    },
    async putLegRelation(r: Omit<LegRelationRecord, "updatedAt">) {
      await db.query(
        `INSERT INTO probabl.leg_relations (a, b, kind, p_b_given_a, p_b_given_not_a, confidence,
          source, model, reasoning, reviewer)
        VALUES (decode($1, 'hex'), decode($2, 'hex'), $3, $4, $5, $6, $7, $8, $9, $10::bytea)
        ON CONFLICT (a, b) DO UPDATE SET kind = excluded.kind, p_b_given_a = excluded.p_b_given_a,
          p_b_given_not_a = excluded.p_b_given_not_a, confidence = excluded.confidence,
          source = excluded.source, model = excluded.model, reasoning = excluded.reasoning,
          reviewer = excluded.reviewer, updated_at = now()`,
        [
          hex(r.a),
          hex(r.b),
          r.kind,
          r.pBGivenA,
          r.pBGivenNotA,
          r.confidence,
          r.source,
          r.model,
          r.reasoning,
          r.reviewer === null ? null : Buffer.from(hex(r.reviewer), "hex"),
        ],
      );
    },

    // ---------------------------------------------------------------- marks and prices

    /** Records a mark (idempotent per batch: the first one stands, its transaction is added). */
    async recordVaultMark(domain: string, m: Omit<VaultMarkRecord, "createdAt">) {
      await db.query(
        `INSERT INTO probabl.vault_marks (deployment, vault, batch, nav, guaranteed, best,
          inputs_hash, inputs, tx)
        VALUES (${DEPLOYMENT}, decode($2, 'hex'), $3, $4, $5, $6, decode($7, 'hex'), $8,
          $9::bytea)
        ON CONFLICT (deployment, vault, batch) DO UPDATE SET tx = excluded.tx
        WHERE probabl.vault_marks.tx IS NULL`,
        [
          domain,
          hex(m.vault),
          m.batch,
          m.nav.toString(),
          m.guaranteed.toString(),
          m.best.toString(),
          hex(m.inputsHash),
          JSON.stringify(m.inputs),
          m.tx === null ? null : Buffer.from(hex(m.tx), "hex"),
        ],
      );
    },
    async vaultMarks(domain: string, vault: string, limit = 100): Promise<VaultMarkRecord[]> {
      return (
        await db.query(
          `SELECT encode(vault, 'hex') AS vault, batch, nav::text, guaranteed::text, best::text,
            encode(inputs_hash, 'hex') AS inputs_hash, inputs, encode(tx, 'hex') AS tx, created_at
          FROM probabl.vault_marks WHERE deployment = ${DEPLOYMENT} AND vault = decode($2, 'hex')
          ORDER BY batch DESC LIMIT $3`,
          [domain, hex(vault), bounded(limit)],
        )
      ).rows.map((r) => ({
        vault: `0x${r.vault}`,
        batch: r.batch,
        nav: BigInt(r.nav),
        guaranteed: BigInt(r.guaranteed),
        best: BigInt(r.best),
        inputsHash: `0x${r.inputs_hash}`,
        inputs: r.inputs,
        tx: r.tx === null ? null : `0x${r.tx}`,
        createdAt: r.created_at,
      }));
    },
    /** Records one minute of product prices; a minute another process recorded is kept. */
    async recordWorldPrices(domain: string, rows: readonly WorldPriceRow[]) {
      if (!rows.length) return;
      await db.query(
        `INSERT INTO probabl.world_prices (deployment, book, product, minute, bid, ask)
        SELECT ${DEPLOYMENT}, r.book, r.product, r.minute, r.bid, r.ask
        FROM unnest($2::integer[], $3::text[], $4::bigint[], $5::integer[], $6::integer[])
          AS r(book, product, minute, bid, ask)
        ON CONFLICT DO NOTHING`,
        [
          domain,
          rows.map((r) => r.book),
          rows.map((r) => r.product),
          rows.map((r) => String(r.minute)),
          rows.map((r) => r.bid),
          rows.map((r) => r.ask),
        ],
      );
    },
    /** One product's prices from minute `since`, the last in each `bucket` minutes. */
    async worldPriceHistory(
      domain: string,
      book: number,
      product: string,
      since: number,
      bucket: number,
    ): Promise<WorldPriceRow[]> {
      return (
        await db.query<{ minute: string; bid: number | null; ask: number | null }>(
          `SELECT DISTINCT ON (minute / $5) minute::text, bid, ask FROM probabl.world_prices
          WHERE deployment = ${DEPLOYMENT} AND book = $2 AND product = $3 AND minute >= $4
          ORDER BY minute / $5, minute DESC`,
          [domain, book, product, String(since), String(Math.max(1, Math.floor(bucket)))],
        )
      ).rows.map((r) => ({ book, product, minute: Number(r.minute), bid: r.bid, ask: r.ask }));
    },
  };
}
export type WorldQueries = ReturnType<typeof worldQueries>;

/** One transaction per finalized batch: the fills (one `unnest` statement) and the checkpoint.
 * Finalized rows never change, so a replayed batch writes nothing. */
export async function writeWorldFinalized(
  tx: PoolClient,
  domain: string,
  batch: WorldFinalizedBatch,
) {
  const f = batch.fills;
  if (f.length)
    await tx.query(
      `INSERT INTO probabl.world_fills (deployment, block, log_index, block_time, book, mask,
        sell, units, refund, price, fee, nonce, tx, maker, taker, delegate)
      SELECT ${DEPLOYMENT}, x.block, x.log_index, x.block_time, x.book, x.mask, x.sell, x.units,
        x.refund, x.price, x.fee, x.nonce, decode(x.tx, 'hex'), decode(x.maker, 'hex'),
        decode(x.taker, 'hex'), decode(x.delegate, 'hex')
      FROM unnest($2::bigint[], $3::integer[], $4::bigint[], $5::integer[], $6::integer[],
        $7::boolean[], $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[],
        $12::numeric[], $13::text[], $14::text[], $15::text[], $16::text[])
        AS x(block, log_index, block_time, book, mask, sell, units, refund, price, fee, nonce, tx,
          maker, taker, delegate)
      ON CONFLICT DO NOTHING`,
      [
        domain,
        text(f.map((r) => r.block)),
        f.map((r) => r.logIndex),
        text(f.map((r) => r.blockTime)),
        f.map((r) => r.book),
        f.map((r) => r.mask),
        f.map((r) => r.sell),
        text(f.map((r) => r.units)),
        text(f.map((r) => r.refund)),
        text(f.map((r) => r.price)),
        text(f.map((r) => r.fee)),
        text(f.map((r) => r.nonce)),
        f.map((r) => hex(r.tx)),
        f.map((r) => hex(r.maker)),
        f.map((r) => hex(r.taker)),
        f.map((r) => (r.delegate ? hex(r.delegate) : null)),
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
