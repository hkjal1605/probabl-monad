/** Chain index service: live replica, finalized persistence, reconciliation and read routes.
 *
 * Trading reads (markets, books, orders, stream) and wallet views are served from the confirmed
 * replica in memory with no database round trip; responses are memoized per replica revision,
 * so a burst of identical reads after a block costs one computation. PostgreSQL receives the
 * finalized trades and closed orders in coalesced transactions, plus a compressed checkpoint
 * when the replica changed (at a bounded cadence), and serves only history: trades and closed
 * orders, cached until a write adds rows to what a read covers. */
import type {
  ClosedOrderRecord,
  Database,
  FinalizedBatch,
  TradeRecord,
} from "@conditional-stocks/db";
import { parseMarketRef } from "@conditional-stocks/evm-client";
import {
  type ChainState,
  creditOf,
  encodeCheckpoint,
  type OrderState,
} from "@conditional-stocks/evm-client/ledger";
import type { Context, Hono } from "hono";
import { type Address, getAddress, type PublicClient } from "viem";
import { ChainFollower, type CommitNotice, type FinalizedNotice } from "./follower.ts";
import {
  closedOrderRecord,
  closedOrderView,
  type Deployment,
  liveOrder,
  marketIdentity,
  marketView,
  orderbookLevels,
  orderView,
  payoutCredits,
  positionsOf,
  publicIdOf,
  publicMarkets,
  reservedByToken,
  tradeRecord,
  tradeView,
} from "./projection.ts";
import { type Reconciliation, reconcile } from "./reconcile.ts";
import { createIndexStream, updateOf } from "./stream.ts";
import { TokenReader } from "./tokens.ts";
import { DailyVolume, windowStart } from "./volume.ts";

export interface IndexerOptions {
  client: PublicClient;
  /** Per-endpoint clients for the follower's failover (`FollowerOptions.endpoints`). */
  endpoints?: PublicClient[];
  exchange: Address;
  quote: Address;
  deploymentBlock: bigint;
  chainId: number;
  db: Database;
  pollMs?: number;
  finalityMs?: number;
  logRange?: bigint;
  finalityDepth?: bigint;
  /** Minimum interval between checkpoints of the finalized replica (default 5 minutes). */
  checkpointMs?: number;
  onError?(error: unknown): void;
}

/** Wallet images are rebuilt when the owner's replica state changes, else at this age: ERC-20
 * balances outside the exchange can change without an exchange event. */
const WALLET_REFRESH_MS = 15_000;
/** Every market is compared with chain storage at this interval; changed markets in between. */
const FULL_RECONCILE_MS = 600_000;
/** Queued finalized batches are coalesced into one transaction of at most this many rows. */
const MAX_WRITE_ROWS = 20_000;

interface Queued {
  block: bigint;
  trades: TradeRecord[];
  orders: ClosedOrderRecord[];
  /** Closed orders served from memory until written. */
  closed: OrderState[];
  checkpoint?: { block: string; hash: string; text?: string | undefined; state?: Uint8Array };
}
interface WalletImage {
  owner: Address;
  observedAt: number;
  blockNumber: string;
  positions: ReturnType<typeof positionsOf>;
  balances: Record<string, unknown>;
}

/** Finalized history reads. Concurrent identical reads share one query, and a result is kept
 * until a write adds rows to a scope it covers. */
class History {
  private entries = new Map<string, { scopes: string[]; value: Promise<unknown> }>();

  read<T>(key: string, scopes: string[], load: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) return cached.value as Promise<T>;
    if (this.entries.size >= 512) this.entries.delete(this.entries.keys().next().value!);
    const value = load();
    const entry = { scopes, value };
    this.entries.set(key, entry);
    value.catch(() => this.entries.get(key) === entry && this.entries.delete(key));
    return value;
  }

  invalidate(scopes: Set<string>) {
    if (!scopes.size) return;
    for (const [key, entry] of this.entries)
      if (entry.scopes.some((scope) => scopes.has(scope))) this.entries.delete(key);
  }
}

export class IndexerService {
  readonly domain: string;
  readonly deployment: Deployment;
  readonly follower: ChainFollower;
  readonly tokens: TokenReader;
  readonly stream = createIndexStream();
  reconciliation: Reconciliation | undefined;
  persistError: string | null = null;
  /** Confirmed trades not yet persisted, oldest first. */
  private tail: TradeRecord[] = [];
  /** Quote traded in the last 24 hours by finalized trades; unfinalized ones are in the tail. */
  private volume = new DailyVolume();
  private seeding: Promise<void> | undefined;
  private lastCheckpoint = 0;
  /** The finalized replica changed since the last checkpoint. */
  private changed = false;
  /** Finalized batches not yet written, in order (retried idempotently until they succeed). */
  private queue: Queued[] = [];
  private unpersisted = new Map<string, OrderState>();
  private writing: Promise<void> | undefined;
  /** Called after each write that stored finalized trades. */
  private tradeListeners = new Set<() => void>();
  private stopped = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private history = new History();
  private images = new Map<Address, { at: number; image: WalletImage }>();
  private index:
    | {
        revision: number;
        state: ChainState;
        byOwner: Map<Address, OrderState[]>;
        byMarket: Map<number, OrderState[]>;
      }
    | undefined;
  private responses = { epoch: "", bodies: new Map<string, string>() };
  private audits = {
    block: -1n,
    fullAt: 0,
    dirty: new Set<number>(),
    issues: new Map<number, string>(),
  };
  private liveBlock = -1n;

  constructor(readonly options: IndexerOptions) {
    this.domain = `${options.chainId}:${getAddress(options.exchange)}`;
    this.deployment = { chainId: options.chainId, exchange: getAddress(options.exchange) };
    this.tokens = new TokenReader(options.client);
    this.follower = new ChainFollower({
      client: options.client,
      ...(options.endpoints ? { endpoints: options.endpoints } : {}),
      exchange: getAddress(options.exchange),
      quote: getAddress(options.quote),
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

  async start() {
    await this.options.db.registerDeployment(this.domain);
    await this.follower.start();
    this.seedVolume();
    await this.refreshLive();
    await this.audit();
    this.timers.push(
      setInterval(
        () => void this.refreshLive().catch((error) => this.options.onError?.(error)),
        10_000,
      ),
      setInterval(() => {
        this.seedVolume();
        void this.audit().catch((error) => this.options.onError?.(error));
      }, 30_000),
    );
  }

  async stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.stream.stop();
    this.follower.stop();
    await this.follower.drain();
    this.stopped = true;
    await this.seeding;
    // Give queued finalized batches a bounded chance to land; the next start replays the rest.
    await Promise.race([this.writing, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }

  /** Confirmed replica for trading reads; throws while the chain stream is unhealthy. */
  trading(): ChainState {
    if (!this.follower.health().healthy) throw new Error("Live chain index unavailable");
    return this.follower.confirmed;
  }

  /** A market by public id (optionally slug-prefixed), market key, or on-chain venue id. A public
   * id resolves to its current venue on this deployment. */
  market(ref: string, s: ChainState = this.trading()) {
    const parsed = parseMarketRef(ref);
    if (!parsed) return undefined;
    return "venueId" in parsed
      ? s.markets.get(parsed.venueId)
      : publicMarkets(s).get(parsed.publicId);
  }

  /** The finalized replica: state no reorganization can change. Settlement (referral payouts)
   * reads it. */
  finalized(): ChainState {
    return this.follower.base;
  }

  /** Calls `listener` after each write that stored finalized trades, so work that reads them
   * (referral accrual) runs when there is something new instead of polling. */
  onPersistedTrades(listener: () => void) {
    this.tradeListeners.add(listener);
    return () => this.tradeListeners.delete(listener);
  }

  /** Custody views additionally require healthy persistence and reconciliation. */
  custody(): ChainState {
    const s = this.trading();
    if (this.persistError) throw new Error(`Finalized persistence failed: ${this.persistError}`);
    if (this.reconciliation && !this.reconciliation.healthy)
      throw new Error("Index reconciliation failed");
    return s;
  }

  private onCommit(notice: CommitNotice) {
    if (notice.rebuilt) {
      this.tail = this.tail.filter((t) => t.block <= this.follower.base.block);
      this.images.clear();
      this.audits.fullAt = 0;
    }
    for (const event of notice.events)
      switch (event.name) {
        case "Trade":
          this.tail.push(
            tradeRecord(event, notice.trades.get(`${event.block}:${event.logIndex}`)!),
          );
          break;
        // Tokens moved between a wallet and the exchange: its ERC-20 balances changed.
        case "Deposited":
        case "Withdrawn":
          for (const field of ["owner", "to"])
            if (typeof event.args[field] === "string") {
              const wallet = getAddress(event.args[field] as string);
              this.tokens.forget(wallet);
              this.images.delete(wallet);
            }
          break;
        // A market's lifecycle decides whether its positions are redeemable, for every holder.
        case "MarketState":
        case "MarketResolved":
          this.images.clear();
      }
    if (this.tail.length > 2_000) this.tail = this.tail.slice(-2_000);
    for (const owner of notice.changes.owners) this.images.delete(owner);
    for (const market of notice.changes.markets) this.audits.dirty.add(market);
    this.stream.publish(
      updateOf(notice.block, notice.changes, (id) => publicIdOf(notice.state, id)),
    );
  }

  /** Queues a finalized batch without waiting for the database: a slow or unavailable database
   * never holds up the live index. Only trades and closed orders are history the product reads;
   * every other event is folded into the replica, checkpointed when it changed. */
  private persist(notice: FinalizedNotice) {
    if (notice.events.length) this.changed = true;
    const trades = notice.events
      .filter((e) => e.name === "Trade")
      .map((e) => tradeRecord(e, notice.trades.get(`${e.block}:${e.logIndex}`)!));
    for (const t of trades) this.volume.add(t.market, t.blockTime, t.quote);
    const orders = notice.closed.map((o) =>
      closedOrderRecord(o, notice.base.markets.get(o.market)!),
    );
    for (const o of notice.closed) this.unpersisted.set(o.key, o);
    const due =
      this.changed && Date.now() - this.lastCheckpoint >= (this.options.checkpointMs ?? 300_000);
    if (!trades.length && !orders.length && !due) return;
    const queued: Queued = { block: notice.block, trades, orders, closed: notice.closed };
    if (due) {
      // Serialized now, matching `notice.block`; compressed off the event loop when written.
      this.lastCheckpoint = Date.now();
      this.changed = false;
      queued.checkpoint = {
        block: notice.block.toString(),
        hash: notice.hash,
        text: encodeCheckpoint(notice.base),
      };
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
      const batch: FinalizedBatch = { trades: [], orders: [] };
      let checkpoint: Queued["checkpoint"];
      for (const queued of this.queue) {
        const size = queued.trades.length + queued.orders.length;
        if (count && rows + size > MAX_WRITE_ROWS) break;
        batch.trades.push(...queued.trades);
        batch.orders.push(...queued.orders);
        checkpoint = queued.checkpoint ?? checkpoint;
        rows += size;
        count++;
      }
      const taken = this.queue.slice(0, count);
      try {
        if (checkpoint) {
          checkpoint.state ??= await Bun.zstdCompress(Buffer.from(checkpoint.text!));
          checkpoint.text = undefined;
          batch.checkpoint = {
            block: checkpoint.block,
            hash: checkpoint.hash,
            state: checkpoint.state,
          };
        }
        await this.options.db.persistFinalized(this.domain, batch);
        this.queue.splice(0, count);
        const block = taken.at(-1)!.block;
        this.tail = this.tail.filter((t) => t.block > block);
        for (const queued of taken)
          for (const o of queued.closed)
            if (this.unpersisted.get(o.key) === o) this.unpersisted.delete(o.key);
        const scopes = new Set<string>();
        if (batch.trades.length) scopes.add("trades");
        for (const t of batch.trades)
          for (const scope of [
            `trades:m:${t.market}`,
            `trades:o:${t.maker.toLowerCase()}`,
            `trades:o:${t.taker.toLowerCase()}`,
          ])
            scopes.add(scope);
        for (const o of batch.orders) scopes.add(`orders:o:${o.owner.toLowerCase()}`);
        this.history.invalidate(scopes);
        if (batch.trades.length) for (const listener of this.tradeListeners) listener();
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

  /** Counts the trades finalized by earlier runs into the 24-hour volume, once: one grouped
   * read of those up to the checkpoint this run resumed from (later blocks finalize again in
   * this run, and are counted as they do). Retried by the audit timer until it succeeds. */
  private seedVolume() {
    if (this.volume.ready || this.seeding || this.stopped) return;
    const through = this.follower.restored;
    const since = BigInt(windowStart(Date.now()) * 60);
    this.seeding = (
      through === undefined
        ? Promise.resolve([])
        : this.options.db.minuteVolumes(this.domain, since, through)
    )
      .then((rows) => this.volume.seed(rows))
      .catch((error) => this.options.onError?.(error))
      .finally(() => {
        this.seeding = undefined;
      });
  }

  /** Quote traded per market (by venue id, raw units) in the last 24 hours: finalized trades
   * from the window, unfinalized ones from the confirmed tail. Undefined until the trades of
   * earlier runs are counted. Callers must not modify the map. */
  dailyVolume(nowMs = Date.now()): ReadonlyMap<number, bigint> | undefined {
    if (!this.volume.ready) return undefined;
    const finalized = this.volume.window(nowMs);
    const base = this.follower.base.block,
      since = BigInt(windowStart(nowMs) * 60);
    const recent = this.tail.filter((t) => t.block > base && t.blockTime >= since);
    if (!recent.length) return finalized;
    const totals = new Map(finalized);
    for (const t of recent) totals.set(t.market, (totals.get(t.market) ?? 0n) + t.quote);
    return totals;
  }
  /** What a market response depends on besides the replica: the volume window's minute and
   * whether earlier runs' trades are counted yet. */
  private volumeKey() {
    return `${windowStart(Date.now())}:${this.volume.ready ? 1 : 0}`;
  }

  /** Market view with the base token's live issuer state, token identities and the quote
   * traded in the last 24 hours (raw units; null until counted). */
  view(
    s: ChainState,
    m: ChainState["markets"] extends Map<number, infer T> ? T : never,
    volume = this.dailyVolume(),
  ) {
    return {
      ...marketView(s, m, this.deployment, this.tokens.live.get(m.base), (token) =>
        this.tokens.identity.get(token),
      ),
      volume24h: volume ? (volume.get(m.id) ?? 0n).toString() : null,
    };
  }

  /** Issuer state can only change in a new block: nothing is read while the head stands still. */
  private async refreshLive() {
    const s = this.follower.confirmed;
    if (s.block === this.liveBlock) return;
    await this.tokens.refreshIdentity([...s.pools.keys()]);
    const bases = [...new Set([...s.markets.values()].map((m) => m.base))];
    const changed = new Set(await this.tokens.refreshLive(bases));
    this.liveBlock = s.block;
    if (!changed.size) return;
    const markets = [
      ...new Set(
        [...s.markets.values()]
          .filter((m) => changed.has(m.base))
          .map((m) => marketIdentity(s, m).id),
      ),
    ];
    this.stream.publish({ block: s.block.toString(), observedAt: Date.now(), markets, owners: [] });
  }

  /** Pools and ledger identities on every pass; markets that changed since the last pass (and
   * any that differed), and every market at a slower cadence. A block already checked is not
   * read again. */
  private async audit() {
    const s = this.follower.confirmed;
    const a = this.audits;
    if (this.reconciliation && s.block === a.block) return;
    const full = Date.now() - a.fullAt >= FULL_RECONCILE_MS;
    const dirty = a.dirty;
    a.dirty = new Set();
    const only = full ? undefined : new Set([...dirty, ...a.issues.keys()]);
    try {
      const result = await reconcile(this.options.client, this.options.exchange, s, only);
      if (full) {
        a.issues = result.marketIssues;
        a.fullAt = Date.now();
      } else
        for (const id of only!) {
          const issue = result.marketIssues.get(id);
          if (issue) a.issues.set(id, issue);
          else a.issues.delete(id);
        }
      a.block = BigInt(result.block);
      const checked = new Set(result.marketIssues.values());
      const issues = [
        ...result.issues.filter((issue) => !checked.has(issue)),
        ...a.issues.values(),
      ];
      this.reconciliation = {
        healthy: issues.length === 0,
        block: result.block,
        checkedAt: result.checkedAt,
        pools: result.pools,
        markets: s.markets.size,
        issues,
      };
    } catch (error) {
      for (const id of dirty) a.dirty.add(id);
      throw error;
    }
  }

  /** Open orders by owner and by market, rebuilt at most once per replica revision. */
  private orders(s: ChainState) {
    const revision = this.follower.revision;
    if (this.index?.state !== s || this.index.revision !== revision) {
      const byOwner = new Map<Address, OrderState[]>();
      const byMarket = new Map<number, OrderState[]>();
      for (const o of s.orders.values()) {
        (byOwner.get(o.owner) ?? byOwner.set(o.owner, []).get(o.owner)!).push(o);
        (byMarket.get(o.market) ?? byMarket.set(o.market, []).get(o.market)!).push(o);
      }
      this.index = { revision, state: s, byOwner, byMarket };
    }
    return this.index;
  }

  /** A JSON body memoized per replica revision and token state (and per second when it depends
   * on the time), shared by every identical request in between. */
  private memo(c: Context, key: string, timed: boolean, build: () => unknown) {
    const epoch = `${this.follower.revision}:${this.tokens.version}`;
    if (this.responses.epoch !== epoch) this.responses = { epoch, bodies: new Map() };
    const name = timed ? `${key}@${Math.floor(Date.now() / 1000)}` : key;
    let body = this.responses.bodies.get(name);
    if (body === undefined) {
      if (this.responses.bodies.size >= 256) this.responses.bodies.clear();
      body = JSON.stringify(build());
      this.responses.bodies.set(name, body);
    }
    return c.body(body, 200, { "content-type": "application/json" });
  }

  /** Positions and balances of one wallet: claims and vault credit from the replica, external
   * token balances from one batched RPC read. Rebuilt when the owner's state changes, else
   * served for up to `WALLET_REFRESH_MS`. */
  async wallet(owner: Address): Promise<WalletImage> {
    this.trading();
    const cached = this.images.get(owner);
    if (cached && Date.now() - cached.at < WALLET_REFRESH_MS) return cached.image;
    const tokens = [...this.follower.confirmed.pools.keys()];
    const external = await this.tokens.walletBalances(owner, tokens);
    const s = this.trading();
    const reserved = reservedByToken(s, this.orders(s).byOwner.get(owner) ?? []);
    const balances: Record<string, unknown> = {};
    for (const token of tokens) {
      const pool = s.pools.get(token);
      if (!pool) continue;
      balances[token] = {
        account: owner,
        token,
        decimals: pool.decimals,
        canonicalBalance: (external.get(token) ?? 0n).toString(),
        vaultAvailable: creditOf(s, owner, token).toString(),
        reserved: (reserved.get(token) ?? 0n).toString(),
        blockNumber: s.block.toString(),
      };
    }
    const image: WalletImage = {
      owner,
      observedAt: Date.now(),
      blockNumber: s.block.toString(),
      positions: positionsOf(s, owner, this.deployment),
      balances,
    };
    if (this.images.size >= 10_000) this.images.clear();
    this.images.set(owner, { at: image.observedAt, image });
    return image;
  }

  mount(app: Hono) {
    const { db } = this.options;
    this.stream.mount(
      app,
      () => this.trading(),
      async (owner) => this.wallet(getAddress(owner)).catch(() => undefined),
    );
    app.get("/health", (c) => {
      const health = this.follower.health();
      return c.json(
        {
          healthy: health.healthy,
          chain: "evm",
          head: {
            confirmedBlock: health.confirmedBlock.toString(),
            finalizedBlock: health.finalizedBlock.toString(),
          },
          streamLagMs: health.lagMs,
          persistError: this.persistError,
        },
        health.healthy ? 200 : 503,
      );
    });
    app.get("/reconciliation", (c) => {
      this.trading();
      if (!this.reconciliation) throw new Error("Reconciliation is not available yet");
      return c.json(this.reconciliation, this.reconciliation.healthy ? 200 : 503);
    });
    // One entry per public market (its current venue); `?venues=all` lists every on-chain
    // market, for venue-level tools such as the admin console.
    app.get("/markets", (c) => {
      const s = this.trading();
      const all = c.req.query("venues") === "all";
      return this.memo(c, `${all ? "markets:all" : "markets"}@${this.volumeKey()}`, false, () => {
        const volume = this.dailyVolume();
        return {
          markets: (all ? [...s.markets.values()] : [...publicMarkets(s).values()]).map((m) =>
            this.view(s, m, volume),
          ),
          block: s.block.toString(),
          confirmation: "confirmed",
        };
      });
    });
    app.get("/markets/:id", (c) => {
      const s = this.trading();
      const m = this.market(c.req.param("id"), s);
      return m
        ? this.memo(c, `market:${m.id}@${this.volumeKey()}`, false, () => this.view(s, m))
        : c.json({ error: "not-found" }, 404);
    });
    app.get("/orders", async (c) => {
      const s = this.trading();
      const raw = c.req.query("maker");
      const maker = raw ? getAddress(raw) : undefined;
      const open = c.req.query("status") === "open";
      const live = (maker ? (this.orders(s).byOwner.get(maker) ?? []) : [...s.orders.values()])
        .filter((o) => !open || o.status === "open")
        .map((o) => orderView(s, o, s.markets.get(o.market)!, this.deployment, "confirmed"));
      const rows: (ReturnType<typeof orderView> | ReturnType<typeof closedOrderView>)[] = live;
      if (maker && !open) {
        // Closed orders: those awaiting their write (captured before reading history), then
        // persisted ones.
        const seen = new Set(rows.map((o) => o.id));
        for (const o of this.unpersisted.values())
          if (o.owner === maker && !seen.has(o.key)) {
            seen.add(o.key);
            rows.push(orderView(s, o, s.markets.get(o.market)!, this.deployment, "finalized"));
          }
        const key = maker.toLowerCase();
        for (const record of await this.history.read(`orders:${key}`, [`orders:o:${key}`], () =>
          db.closedOrders(this.domain, maker),
        )) {
          const row = closedOrderView(record, s, this.deployment);
          if (!seen.has(row.id)) rows.push(row);
        }
      }
      rows.sort((a, b) => (BigInt(b.updatedBlock) > BigInt(a.updatedBlock) ? 1 : -1));
      return c.json({ orders: rows, truncated: false, nextCursor: null });
    });
    app.get("/orderbook/:id", (c) => {
      const s = this.trading();
      const m = this.market(c.req.param("id"), s);
      if (!m) return c.json({ error: "not-found" }, 404);
      return this.memo(c, `book:${m.id}`, true, () => ({
        orders: (this.orders(s).byMarket.get(m.id) ?? [])
          .filter((o) => liveOrder(o, s))
          .map((o) => orderView(s, o, m, this.deployment, "confirmed")),
        truncated: false,
        block: s.block.toString(),
      }));
    });
    app.get("/orderbooks", (c) => {
      const s = this.trading();
      if (c.req.query("view") === "levels")
        return this.memo(c, "levels", true, () => ({
          books: orderbookLevels(s),
          block: s.block.toString(),
        }));
      return this.memo(c, "books", true, () => {
        const books: Record<string, { orders: ReturnType<typeof orderView>[]; truncated: false }> =
          {};
        const byMarket = this.orders(s).byMarket;
        for (const [id, m] of publicMarkets(s))
          books[id] = {
            orders: (byMarket.get(m.id) ?? [])
              .filter((o) => liveOrder(o, s))
              .map((o) => orderView(s, o, m, this.deployment, "confirmed")),
            truncated: false,
          };
        return { books, block: s.block.toString() };
      });
    });
    app.get("/positions/:owner", async (c) => {
      this.custody();
      c.header("Cache-Control", "no-store");
      return c.json(await this.wallet(getAddress(c.req.param("owner"))));
    });
    app.get("/balances/:owner", async (c) => {
      this.custody();
      c.header("Cache-Control", "no-store");
      const image = await this.wallet(getAddress(c.req.param("owner")));
      const token = getAddress(c.req.query("token") ?? "");
      const balance = image.balances[token];
      return balance
        ? c.json(balance)
        : c.json({ error: "Token is not listed in this deployment" }, 404);
    });
    app.get("/payouts/:owner", (c) =>
      c.json({
        vault: this.options.exchange,
        payouts: payoutCredits(this.custody(), getAddress(c.req.param("owner")), this.deployment),
        nextCursor: null,
      }),
    );
    app.get("/resolutions/:id", (c) => {
      const s = this.custody();
      const m = this.market(c.req.param("id"), s);
      if (!m?.payouts) return c.json({ error: "not-found" }, 404);
      return c.json({
        admin: m.resolver,
        evidenceHash: m.evidence,
        evidenceUri: m.evidenceUri,
        yesPayout: String(m.payouts[0]),
        noPayout: String(m.payouts[1]),
        payoutDenominator: String(m.payouts[0] + m.payouts[1]),
        transactionHash: m.resolutionTx,
      });
    });
    app.get("/trades", async (c) => {
      const s = this.trading();
      const limit = Number(c.req.query("limit") ?? 100);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
        return c.json({ error: "Invalid limit" }, 400);
      const ref = c.req.query("marketId");
      const raw = c.req.query("owner");
      const owner = raw ? getAddress(raw) : undefined;
      // A public id covers every venue of that market on this deployment.
      const parsed = ref ? parseMarketRef(ref) : null;
      const markets = !ref
        ? undefined
        : !parsed
          ? []
          : "venueId" in parsed
            ? s.markets.has(parsed.venueId)
              ? [parsed.venueId]
              : []
            : [...s.markets.values()]
                .filter((m) => marketIdentity(s, m).id === parsed.publicId)
                .map((m) => m.id);
      if (markets && !markets.length) return c.json({ trades: [] });
      // The unpersisted tail is captured before history is read: a write completing in between
      // then shows its trades in either part (deduplicated), never in neither.
      const tail = this.tail
        .filter(
          (t) =>
            (!markets || markets.includes(t.market)) &&
            (!owner || t.maker === owner || t.taker === owner),
        )
        .reverse();
      const key = owner?.toLowerCase();
      const scopes = key
        ? [`trades:o:${key}`]
        : markets
          ? markets.map((m) => `trades:m:${m}`)
          : ["trades"];
      const rows = await this.history.read(
        `trades:${key ?? ""}:${markets?.join(",") ?? ""}:${limit}`,
        scopes,
        () =>
          db.trades(this.domain, {
            ...(markets ? { markets } : {}),
            ...(owner ? { owner } : {}),
            limit,
          }),
      );
      const seen = new Set(rows.map((r) => `${r.tx}:${r.logIndex}`));
      return c.json({
        trades: [
          ...tail
            .filter((t) => !seen.has(`${t.tx}:${t.logIndex}`))
            .map((t) => tradeView(t, s, this.deployment, "confirmed")),
          ...rows.map((r) => tradeView(r, s, this.deployment, "finalized")),
        ].slice(0, limit),
      });
    });
  }
}
