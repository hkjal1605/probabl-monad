/** The world books' index, beside the exchange's (`IndexerService`): a second `ChainFollower`
 * domain, `${chainId}:${worldBooks}`, over `WorldBooks`, `EventOracle` and the world vaults.
 *
 * Reads are served from the confirmed replica in memory and memoized per replica revision.
 * PostgreSQL receives the finalized fills and a compressed checkpoint, coalesced and retried
 * without ever holding up the follower; it also holds each book's off-chain metadata (its legs'
 * venue events), which is read once and again whenever a new book appears. Custody reads
 * (positions) additionally require healthy persistence and reconciliation, which compares the
 * replica with chain storage and fails closed. */
import type {
  Database,
  WorldBookRecord,
  WorldFillRow,
  WorldFinalizedBatch,
} from "@conditional-stocks/db";
import {
  applyWorldTransaction,
  cloneWorldState,
  decodeWorldLog,
  emptyWorldState,
  encodeWorldCheckpoint,
  fillRecord,
  mergeWorldTouched,
  restoreWorldState,
  StaleWorldCheckpointError,
  type WorldDeployment,
  type WorldEvent,
  type WorldState,
  type WorldTouched,
  worldTouched,
} from "@conditional-stocks/evm-client/world-ledger";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { type Address, getAddress, type Hex, type PublicClient } from "viem";
import {
  ChainFollower,
  type CommitNotice,
  type FinalizedNotice,
  type Ledger,
} from "../follower.ts";
import {
  accountOf,
  type BookPrices,
  bookView,
  eventView,
  fixingsBetween,
  positionsOf,
  vaultAccount,
  vaultView,
} from "./projection.ts";
import { reconcileWorlds, type WorldReconciliation } from "./reconcile.ts";

export interface WorldIndexerOptions {
  client: PublicClient;
  endpoints?: PublicClient[];
  deployment: WorldDeployment;
  /** The first block of the world deployment (the oracle's). */
  deploymentBlock: bigint;
  db: Database;
  pollMs?: number;
  finalityMs?: number;
  logRange?: bigint;
  finalityDepth?: bigint;
  checkpointMs?: number;
  onError?(error: unknown): void;
}

/** The world deployment's ledger for the follower. A checkpoint that followed other vaults is
 * stale: the index replays from the deployment block so a newly followed vault has its history. */
export function worldLedger(
  deployment: WorldDeployment,
): Ledger<WorldState, WorldTouched, WorldEvent> {
  const d = emptyWorldState(deployment).deployment;
  return {
    addresses: [d.books, d.oracle, ...d.vaults],
    empty: () => emptyWorldState(d),
    clone: cloneWorldState,
    restore(text) {
      const s = restoreWorldState(text);
      if (s.deployment.vaults.join() !== d.vaults.join())
        throw new StaleWorldCheckpointError("The followed vaults changed");
      return s;
    },
    stale: (error) => error instanceof StaleWorldCheckpointError,
    verify(restored) {
      const r = restored.deployment;
      if (r.books !== d.books || r.oracle !== d.oracle || r.quote !== d.quote)
        throw new Error("Checkpoint belongs to another world deployment");
    },
    decode: (log, timestamp) => decodeWorldLog(d, log, timestamp),
    touched: worldTouched,
    merge: mergeWorldTouched,
    apply: (s, events, changes) => void applyWorldTransaction(s, events, changes),
  };
}

/** One SSE frame of the world stream. */
export interface WorldUpdate {
  block: string;
  observedAt: number;
  books: number[];
  owners: string[];
  events: string[];
  vaults: string[];
}

const FULL_RECONCILE_MS = 600_000;
const HEARTBEAT_MS = 5_000;
const STREAM_CAPACITY = 2_000;
const MAX_WRITE_ROWS = 20_000;
const seconds = () => BigInt(Math.floor(Date.now() / 1000));
const json = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
const fillView = (f: WorldFillRow, finality: "confirmed" | "finalized") => ({
  book: f.book,
  block: f.block.toString(),
  logIndex: f.logIndex,
  time: f.blockTime.toString(),
  transactionHash: f.tx,
  maker: getAddress(f.maker),
  taker: getAddress(f.taker),
  delegate: f.delegate ? getAddress(f.delegate) : null,
  mask: f.mask,
  sell: f.sell,
  units: f.units.toString(),
  refund: f.refund.toString(),
  price: f.price.toString(),
  fee: f.fee.toString(),
  finality,
});

export class WorldIndexer {
  readonly domain: string;
  readonly follower: ChainFollower<WorldState, WorldTouched, WorldEvent>;
  reconciliation: WorldReconciliation | undefined;
  persistError: string | null = null;
  /** Indicative prices per book (the API's world RFQ hub sets it). */
  prices: BookPrices | undefined;
  /** Book metadata by definition hash. */
  private metadata = new Map<Hex, WorldBookRecord>();
  private metadataLoaded = false;
  private loading: Promise<void> | undefined;
  /** Confirmed fills not yet persisted, oldest first. */
  private tail: WorldFillRow[] = [];
  private queue: { block: bigint; fills: WorldFillRow[]; checkpoint?: string; hash?: Hex }[] = [];
  private writing: Promise<void> | undefined;
  private lastCheckpoint = 0;
  private changed = false;
  private stopped = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private responses = { epoch: "", bodies: new Map<string, string>() };
  private audits = {
    block: -1n,
    fullAt: 0,
    dirty: new Set<number>(),
    issues: new Map<number, string>(),
  };
  private clients = new Set<(update: WorldUpdate) => void>();
  private lastSent = 0;
  private fillListeners = new Set<() => void>();
  private confirmedFills = new Set<(fill: WorldFillRow) => void>();

  constructor(readonly options: WorldIndexerOptions) {
    const d = emptyWorldState(options.deployment).deployment;
    this.domain = `${d.chainId}:${d.books}`;
    this.follower = new ChainFollower({
      client: options.client,
      ...(options.endpoints ? { endpoints: options.endpoints } : {}),
      exchange: d.books,
      quote: d.quote,
      ledger: worldLedger(d),
      deploymentBlock: options.deploymentBlock,
      domain: this.domain,
      db: options.db,
      ...(options.pollMs ? { pollMs: options.pollMs } : {}),
      ...(options.finalityMs ? { finalityMs: options.finalityMs } : {}),
      ...(options.logRange ? { logRange: options.logRange } : {}),
      ...(options.finalityDepth !== undefined ? { finalityDepth: options.finalityDepth } : {}),
      onCommit: (notice) => this.onCommit(notice),
      onFinalized: (notice) => this.persist(notice),
      onError: (error) => options.onError?.(error),
    });
  }

  get deployment() {
    return this.follower.base.deployment;
  }

  async start() {
    await this.options.db.registerDeployment(this.domain);
    await this.follower.start();
    await this.loadMetadata().catch((error) => this.options.onError?.(error));
    await this.audit().catch((error) => this.options.onError?.(error));
    this.timers.push(
      setInterval(() => {
        void this.audit().catch((error) => this.options.onError?.(error));
        if (!this.metadataLoaded) void this.loadMetadata().catch(() => {});
      }, 30_000),
      setInterval(() => {
        if (this.clients.size && Date.now() - this.lastSent >= HEARTBEAT_MS)
          this.broadcast(this.update());
      }, HEARTBEAT_MS),
    );
    for (const timer of this.timers) timer.unref?.();
  }

  async stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.follower.stop();
    await this.follower.drain();
    this.stopped = true;
    await Promise.race([this.writing, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }

  /** Confirmed replica for trading reads; throws while the chain stream is unhealthy. */
  trading(): WorldState {
    if (!this.follower.health().healthy) throw new Error("Live world index unavailable");
    return this.follower.confirmed;
  }
  /** Custody reads also need healthy persistence and reconciliation. */
  custody(): WorldState {
    const s = this.trading();
    if (this.persistError) throw new Error(`Finalized persistence failed: ${this.persistError}`);
    if (this.reconciliation && !this.reconciliation.healthy)
      throw new Error("World index reconciliation failed");
    return s;
  }
  /** The finalized replica (settlement and referral accrual read it). */
  finalized(): WorldState {
    return this.follower.base;
  }

  /** A book's metadata (its legs' venue events), when registered. */
  meta(defHash: Hex) {
    return this.metadata.get(defHash.toLowerCase() as Hex);
  }
  /** Reads every book's metadata again (after a registration). */
  refreshMetadata() {
    return this.loadMetadata();
  }
  private loadMetadata() {
    this.loading ??= this.options.db
      .worldBooks(this.domain)
      .then((rows) => {
        for (const row of rows) this.metadata.set(row.defHash.toLowerCase() as Hex, row);
        this.metadataLoaded = true;
        this.responses.epoch = "";
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  /** Calls `listener` with each fill as the confirmed replica applies it. */
  onFill(listener: (fill: WorldFillRow) => void) {
    this.confirmedFills.add(listener);
    return () => this.confirmedFills.delete(listener);
  }

  /** Calls `listener` after each write that stored finalized fills. */
  onPersistedFills(listener: () => void) {
    this.fillListeners.add(listener);
    return () => this.fillListeners.delete(listener);
  }

  private onCommit(notice: CommitNotice<WorldState, WorldTouched, WorldEvent, never>) {
    if (notice.rebuilt) {
      this.tail = this.tail.filter((f) => f.block <= this.follower.base.block);
      this.audits.fullAt = 0;
    }
    let created = false;
    for (const e of notice.events) {
      if (e.name === "WorldFill") {
        const fill = row(fillRecord(e));
        this.tail.push(fill);
        for (const listener of this.confirmedFills) listener(fill);
      }
      if (e.name === "BookCreated") created = true;
    }
    if (this.tail.length > 2_000) this.tail = this.tail.slice(-2_000);
    for (const book of notice.changes.books) this.audits.dirty.add(book);
    // A new book's metadata was registered before it was created: read it now.
    if (created) void this.loadMetadata().catch((error) => this.options.onError?.(error));
    this.publish({
      block: notice.block.toString(),
      observedAt: Date.now(),
      books: [...notice.changes.books],
      owners: [...notice.changes.owners],
      events: [...notice.changes.events],
      vaults: [...notice.changes.vaults],
    });
  }

  /** Queues a finalized batch (fills, and a checkpoint when due) without waiting for the
   * database, and links newly created books to their registered metadata. */
  private persist(notice: FinalizedNotice<WorldState, WorldEvent, never, never>) {
    if (notice.events.length) this.changed = true;
    const fills = notice.events
      .filter((e) => e.name === "WorldFill")
      .map((e) => row(fillRecord(e)));
    for (const e of notice.events)
      if (e.name === "BookCreated")
        void this.options.db
          .setWorldBookId(this.domain, e.args.defHash as string, Number(e.args.book))
          .catch((error) => this.options.onError?.(error));
    const due =
      this.changed && Date.now() - this.lastCheckpoint >= (this.options.checkpointMs ?? 300_000);
    if (!fills.length && !due) return;
    const queued: (typeof this.queue)[number] = { block: notice.block, fills };
    if (due) {
      this.lastCheckpoint = Date.now();
      this.changed = false;
      queued.checkpoint = encodeWorldCheckpoint(notice.base);
      queued.hash = notice.hash;
    }
    this.queue.push(queued);
    this.writing ??= this.write().finally(() => {
      this.writing = undefined;
    });
  }

  private async write() {
    let delay = 500;
    while (this.queue.length) {
      let count = 0,
        rows = 0;
      const batch: WorldFinalizedBatch = { fills: [] };
      let checkpoint: { block: bigint; hash: Hex; text: string } | undefined;
      for (const q of this.queue) {
        if (count && rows + q.fills.length > MAX_WRITE_ROWS) break;
        batch.fills.push(...q.fills);
        if (q.checkpoint) checkpoint = { block: q.block, hash: q.hash!, text: q.checkpoint };
        rows += q.fills.length;
        count++;
      }
      const taken = this.queue.slice(0, count);
      try {
        if (checkpoint)
          batch.checkpoint = {
            block: checkpoint.block.toString(),
            hash: checkpoint.hash,
            state: await Bun.zstdCompress(Buffer.from(checkpoint.text)),
          };
        await this.options.db.persistWorldFinalized(this.domain, batch);
        this.queue.splice(0, count);
        const block = taken.at(-1)!.block;
        this.tail = this.tail.filter((f) => f.block > block);
        if (batch.fills.length) for (const listener of this.fillListeners) listener();
        this.persistError = null;
        delay = 500;
      } catch (error) {
        this.persistError = error instanceof Error ? error.message : String(error);
        this.options.onError?.(error);
        if (this.stopped) return;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    }
  }

  /** Every vault and the identities on every pass; books that changed since the last pass (and
   * any that differed), every book at a slower cadence. */
  private async audit() {
    const s = this.follower.confirmed;
    const a = this.audits;
    if (this.reconciliation && s.block === a.block) return;
    const full = Date.now() - a.fullAt >= FULL_RECONCILE_MS;
    const dirty = a.dirty;
    a.dirty = new Set();
    const only = full ? undefined : new Set([...dirty, ...a.issues.keys()]);
    try {
      const result = await reconcileWorlds(this.options.client, s, only);
      if (full) {
        a.issues = result.bookIssues;
        a.fullAt = Date.now();
      } else
        for (const id of only!) {
          const issue = result.bookIssues.get(id);
          if (issue) a.issues.set(id, issue);
          else a.issues.delete(id);
        }
      a.block = BigInt(result.block);
      const checked = new Set(result.bookIssues.values());
      const issues = [...result.issues.filter((i) => !checked.has(i)), ...a.issues.values()];
      this.reconciliation = {
        healthy: issues.length === 0,
        block: result.block,
        checkedAt: result.checkedAt,
        books: s.books.size,
        vaults: result.vaults,
        issues,
      };
    } catch (error) {
      for (const id of dirty) a.dirty.add(id);
      throw error;
    }
  }

  // ---------------------------------------------------------------- stream

  private update(): WorldUpdate {
    let block = "0";
    try {
      block = this.follower.confirmed.block.toString();
    } catch {}
    return { block, observedAt: Date.now(), books: [], owners: [], events: [], vaults: [] };
  }
  private publish(update: WorldUpdate) {
    const quiet =
      !update.books.length &&
      !update.owners.length &&
      !update.events.length &&
      !update.vaults.length;
    if (quiet && Date.now() - this.lastSent < HEARTBEAT_MS) return;
    this.broadcast(update);
  }
  private broadcast(update: WorldUpdate) {
    this.lastSent = Date.now();
    for (const client of this.clients) client(update);
  }

  // ---------------------------------------------------------------- reads

  /** A JSON body memoized per replica revision, metadata and price epoch (per second when it
   * depends on the time). */
  private memo(c: Context, key: string, build: () => unknown) {
    const epoch = `${this.follower.revision}:${this.metadata.size}:${Math.floor(Date.now() / 1000)}`;
    if (this.responses.epoch !== epoch) this.responses = { epoch, bodies: new Map() };
    let body = this.responses.bodies.get(key);
    if (body === undefined) {
      if (this.responses.bodies.size >= 256) this.responses.bodies.clear();
      body = json(build());
      this.responses.bodies.set(key, body);
    }
    return c.body(body, 200, { "content-type": "application/json" });
  }

  /** Every book's view (optionally filtered), newest first. */
  books(filter: { state?: string; underlying?: string; kind?: string } = {}) {
    const s = this.trading(),
      now = seconds();
    return [...s.books.values()]
      .map((b) => bookView(s, b, this.meta(b.defHash), now, this.prices))
      .filter(
        (v) =>
          (!filter.state || v.state === filter.state) &&
          (!filter.underlying || v.underlying === filter.underlying) &&
          (!filter.kind || v.kind === filter.kind),
      )
      .sort((a, b) => b.id - a.id);
  }
  book(id: number) {
    const s = this.trading(),
      b = s.books.get(id);
    return b ? bookView(s, b, this.meta(b.defHash), seconds(), this.prices) : undefined;
  }
  /** An owner's world wallet: credit, grants, positions and vault accounts. */
  wallet(owner: Address) {
    const s = this.custody(),
      now = seconds();
    return {
      owner,
      observedAt: Date.now(),
      blockNumber: s.block.toString(),
      ...accountOf(s, owner),
      positions: positionsOf(s, owner, now, this.prices),
      vaults: [...s.vaults.values()].map((v) => vaultAccount(v, owner)),
    };
  }

  mount(app: Hono) {
    const { db } = this.options;
    app.get("/v2/health", (c) => {
      const health = this.follower.health();
      return c.json(
        {
          healthy: health.healthy,
          head: {
            confirmedBlock: health.confirmedBlock.toString(),
            finalizedBlock: health.finalizedBlock.toString(),
          },
          streamLagMs: health.lagMs,
          persistError: this.persistError,
          metadata: this.metadataLoaded,
        },
        health.healthy ? 200 : 503,
      );
    });
    app.get("/v2/reconciliation", (c) => {
      this.trading();
      if (!this.reconciliation) throw new Error("Reconciliation is not available yet");
      return c.json(this.reconciliation, this.reconciliation.healthy ? 200 : 503);
    });
    app.get("/v2/deployment", (c) => {
      const s = this.trading();
      return c.json({
        chainId: s.deployment.chainId,
        books: s.deployment.books,
        oracle: s.deployment.oracle,
        quote: s.deployment.quote,
        vaults: s.deployment.vaults,
        paused: s.config.paused,
        roles: { books: s.config, oracle: s.oracle },
        block: s.block.toString(),
      });
    });
    app.get("/v2/books", (c) => {
      const filter = {
        state: c.req.query("state") ?? "",
        underlying: c.req.query("underlying") ?? "",
        kind: c.req.query("kind") ?? "",
      };
      return this.memo(c, `books:${filter.state}:${filter.underlying}:${filter.kind}`, () => ({
        books: this.books(filter),
        block: this.trading().block.toString(),
      }));
    });
    app.get("/v2/books/:book", (c) => {
      const id = Number(c.req.param("book"));
      if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "Invalid book" }, 400);
      return this.book(id)
        ? this.memo(c, `book:${id}`, () => this.book(id))
        : c.json({ error: "not-found" }, 404);
    });
    // The metadata a book's on-chain `metadataHash` commits to (its URI's content).
    app.get("/v2/books/meta/:defHash", async (c) => {
      const hash = c.req.param("defHash").toLowerCase() as Hex;
      if (!/^0x[0-9a-f]{64}$/.test(hash)) return c.json({ error: "Invalid hash" }, 400);
      const record = this.meta(hash) ?? (await db.worldBook(this.domain, hash));
      if (!record) return c.json({ error: "not-found" }, 404);
      c.header("Cache-Control", "public, max-age=31536000, immutable");
      return c.json({ title: record.title, kind: record.kind, ...record.metadata });
    });
    app.get("/v2/books/:book/fills", async (c) => {
      const id = Number(c.req.param("book"));
      const limit = Number(c.req.query("limit") ?? 100);
      if (!Number.isSafeInteger(id) || !Number.isInteger(limit) || limit < 1 || limit > 1000)
        return c.json({ error: "Invalid book or limit" }, 400);
      return c.json({ fills: await this.fills({ books: [id], limit }) });
    });
    app.get("/v2/fills", async (c) => {
      const limit = Number(c.req.query("limit") ?? 100);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
        return c.json({ error: "Invalid limit" }, 400);
      const raw = c.req.query("owner");
      return c.json({
        fills: await this.fills({ ...(raw ? { owner: getAddress(raw) } : {}), limit }),
      });
    });
    app.get("/v2/positions/:owner", (c) => {
      c.header("Cache-Control", "no-store");
      return c.text(json(this.wallet(getAddress(c.req.param("owner")))), 200, {
        "content-type": "application/json",
      });
    });
    app.get("/v2/vaults", (c) =>
      this.memo(c, "vaults", () => {
        const s = this.trading(),
          now = seconds();
        return { vaults: [...s.vaults.values()].map((v) => vaultView(s, v, now)) };
      }),
    );
    app.get("/v2/vaults/:vault", (c) => {
      const s = this.trading();
      const v = s.vaults.get(getAddress(c.req.param("vault")));
      if (!v) return c.json({ error: "not-found" }, 404);
      return this.memo(c, `vault:${v.address}`, () => vaultView(s, v, seconds()));
    });
    app.get("/v2/vaults/:vault/marks", async (c) => {
      const vault = getAddress(c.req.param("vault"));
      return c.json({
        marks: (await db.vaultMarks(this.domain, vault)).map((m) => ({
          batch: m.batch,
          nav: m.nav.toString(),
          guaranteed: m.guaranteed.toString(),
          best: m.best.toString(),
          inputsHash: m.inputsHash,
          transactionHash: m.tx,
          createdAt: m.createdAt.toISOString(),
        })),
      });
    });
    app.get("/v2/fixings", (c) => {
      const now = seconds();
      const from = BigInt(c.req.query("from") ?? String(now - 86_400n));
      const to = BigInt(c.req.query("to") ?? String(now + 7n * 86_400n));
      if (to < from || to - from > 90n * 86_400n)
        return c.json({ error: "Ask for at most 90 days" }, 400);
      return c.json({ fixings: fixingsBetween(this.trading(), from, to, now) });
    });
    app.get("/v2/events/:key", (c) => {
      const key = c.req.param("key").toLowerCase() as Hex;
      if (!/^0x[0-9a-f]{64}$/.test(key)) return c.json({ error: "Invalid event key" }, 400);
      return c.json(eventView(this.trading(), key));
    });
    app.get("/v2/stream", (c) => {
      const raw = c.req.query("owner");
      let owner: Address | undefined;
      try {
        owner = raw ? getAddress(raw) : undefined;
      } catch {
        return c.json({ error: "Invalid owner" }, 400);
      }
      if (this.clients.size >= STREAM_CAPACITY)
        return c.json({ error: "Stream capacity reached" }, 503);
      c.header("X-Accel-Buffering", "no");
      c.header("Cache-Control", "no-cache, no-transform");
      return streamSSE(c, async (stream) => {
        let pending: WorldUpdate | undefined = this.update();
        let wake: (() => void) | undefined;
        let reset = true;
        const union = (a: (string | number)[], b: (string | number)[]) => [
          ...new Set([...a, ...b]),
        ];
        const listener = (next: WorldUpdate) => {
          pending = pending
            ? {
                ...next,
                books: union(pending.books, next.books) as number[],
                owners: union(pending.owners, next.owners) as string[],
                events: union(pending.events, next.events) as string[],
                vaults: union(pending.vaults, next.vaults) as string[],
              }
            : next;
          wake?.();
        };
        this.clients.add(listener);
        stream.onAbort(() => {
          this.clients.delete(listener);
          wake?.();
        });
        try {
          while (!stream.aborted) {
            if (!pending) {
              await Promise.race([
                new Promise<void>((resolve) => {
                  wake = resolve;
                }),
                stream.sleep(HEARTBEAT_MS * 3),
              ]);
              wake = undefined;
              continue;
            }
            const next: WorldUpdate = pending;
            pending = undefined;
            let data = json(next);
            // A subscribed wallet's image rides along when it changed (or on reset).
            if (owner && (reset || next.owners.includes(owner)))
              try {
                data = `${data.slice(0, -1)},"wallet":${json(this.wallet(owner))}}`;
              } catch {}
            await stream.writeSSE({ event: reset ? "reset" : "worlds", id: next.block, data });
            reset = false;
          }
        } finally {
          this.clients.delete(listener);
        }
      });
    });
  }

  /** Fills newest first: the unpersisted tail (captured before history is read) and then the
   * finalized history, deduplicated. */
  async fills(options: { books?: number[]; owner?: Address; limit: number }) {
    const { books, owner, limit } = options;
    const tail = this.tail
      .filter(
        (f) =>
          (!books || books.includes(f.book)) &&
          (!owner || getAddress(f.maker) === owner || getAddress(f.taker) === owner),
      )
      .reverse();
    const rows = await this.options.db.worldFills(this.domain, {
      ...(books ? { books } : {}),
      ...(owner ? { owner } : {}),
      limit,
    });
    const seen = new Set(rows.map((r) => `${r.tx}:${r.logIndex}`));
    return [
      ...tail
        .filter((f) => !seen.has(`${f.tx}:${f.logIndex}`))
        .map((f) => fillView(f, "confirmed")),
      ...rows.map((f) => fillView(f, "finalized")),
    ].slice(0, limit);
  }
}

const row = (f: ReturnType<typeof fillRecord>): WorldFillRow => ({
  ...f,
  tx: f.tx.toLowerCase(),
  maker: f.maker.toLowerCase(),
  taker: f.taker.toLowerCase(),
  delegate: f.delegate?.toLowerCase() ?? null,
});
