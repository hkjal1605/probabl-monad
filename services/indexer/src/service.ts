/** Chain index service: live replica, finalized persistence, reconciliation and read routes.
 *
 * Trading reads (markets, books, orders, stream) and wallet views are served from the confirmed
 * replica in memory with no database round trip. PostgreSQL receives one batched transaction
 * per finalized advance (events and closed orders) plus a checkpoint at a bounded cadence, and
 * serves only history (trades, closed orders). */
import type { Database, FinalizedBatch, StoredEvent } from "@conditional-stocks/db";
import { parseMarketRef } from "@conditional-stocks/evm-client";
import {
  type ChainState,
  creditOf,
  type DecodedEvent,
  serializeState,
  type TradeDetails,
} from "@conditional-stocks/evm-client/ledger";
import type { Hono } from "hono";
import { type Address, getAddress, type PublicClient } from "viem";
import {
  ChainFollower,
  type CommitNotice,
  type FinalizedNotice,
  storedFromDecoded,
} from "./follower.ts";
import {
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
  reservedUnderlying,
  venueOf,
} from "./projection.ts";
import { type Reconciliation, reconcile } from "./reconcile.ts";
import { createIndexStream, updateOf } from "./stream.ts";
import { TokenReader } from "./tokens.ts";

export interface IndexerOptions {
  client: PublicClient;
  exchange: Address;
  quote: Address;
  deploymentBlock: bigint;
  chainId: number;
  db: Database;
  pollMs?: number;
  finalityMs?: number;
  logRange?: bigint;
  finalityDepth?: bigint;
  /** Minimum interval between checkpoints of the finalized replica. */
  checkpointMs?: number;
  onError?(error: unknown): void;
}

interface TailTrade {
  event: DecodedEvent;
  trade: TradeDetails;
}

export class IndexerService {
  readonly domain: string;
  readonly deployment: Deployment;
  readonly follower: ChainFollower;
  readonly tokens: TokenReader;
  readonly stream = createIndexStream();
  reconciliation: Reconciliation | undefined;
  persistError: string | null = null;
  private tail: TailTrade[] = [];
  private lastCheckpoint = 0;
  /** Finalized batches not yet written, in order (retried idempotently until they succeed). */
  private queue: (FinalizedBatch & { block: bigint })[] = [];
  private writing: Promise<void> | undefined;
  private stopped = false;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(readonly options: IndexerOptions) {
    this.domain = `${options.chainId}:${getAddress(options.exchange)}`;
    this.deployment = { chainId: options.chainId, exchange: getAddress(options.exchange) };
    this.tokens = new TokenReader(options.client);
    this.follower = new ChainFollower({
      client: options.client,
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
    await this.follower.start();
    await this.refreshLive();
    await this.audit();
    this.timers.push(
      setInterval(
        () => void this.refreshLive().catch((error) => this.options.onError?.(error)),
        10_000,
      ),
      setInterval(() => void this.audit().catch((error) => this.options.onError?.(error)), 30_000),
    );
  }

  async stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.follower.stop();
    await this.follower.drain();
    this.stopped = true;
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

  /** Custody views additionally require healthy persistence and reconciliation. */
  custody(): ChainState {
    const s = this.trading();
    if (this.persistError) throw new Error(`Finalized persistence failed: ${this.persistError}`);
    if (this.reconciliation && !this.reconciliation.healthy)
      throw new Error("Index reconciliation failed");
    return s;
  }

  private onCommit(notice: CommitNotice) {
    if (notice.rebuilt)
      this.tail = this.tail.filter((t) => t.event.block <= this.follower.base.block);
    for (const event of notice.events)
      if (event.name === "Trade")
        this.tail.push({ event, trade: notice.trades.get(`${event.block}:${event.logIndex}`)! });
    if (this.tail.length > 2_000) this.tail = this.tail.slice(-2_000);
    this.stream.publish(
      updateOf(notice.block, notice.changes, (id) => publicIdOf(notice.state, id)),
    );
  }

  /** Queues a finalized batch without waiting for the database: a slow or unavailable database
   * never holds up the live index. The checkpoint is serialized now, matching `notice.block`. */
  private persist(notice: FinalizedNotice) {
    const due = Date.now() - this.lastCheckpoint >= (this.options.checkpointMs ?? 300_000);
    if (due) this.lastCheckpoint = Date.now();
    this.queue.push({
      block: notice.block,
      events: notice.events.map((e) =>
        storedFromDecoded(e, notice.trades.get(`${e.block}:${e.logIndex}`)),
      ),
      orders: notice.closed.map((o) => ({
        key: o.key,
        owner: o.owner,
        market: o.market,
        updated_block: o.updatedBlock.toString(),
        data: orderView(
          notice.base,
          o,
          notice.base.markets.get(o.market)!,
          this.deployment,
          "finalized",
        ),
      })),
      ...(due
        ? {
            checkpoint: {
              block: notice.block.toString(),
              hash: notice.hash,
              state: serializeState(notice.base),
            },
          }
        : {}),
    });
    this.writing ??= this.write().finally(() => {
      this.writing = undefined;
    });
  }

  private async write() {
    let delay = 500;
    while (this.queue.length) {
      const { block, ...batch } = this.queue[0]!;
      try {
        await this.options.db.persistFinalized(this.domain, batch);
        this.queue.shift();
        this.tail = this.tail.filter((t) => t.event.block > block);
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

  /** Market view with the base token's live issuer state and token identities. */
  view(s: ChainState, m: ChainState["markets"] extends Map<number, infer T> ? T : never) {
    return marketView(s, m, this.deployment, this.tokens.live.get(m.base), (token) =>
      this.tokens.identity.get(token),
    );
  }

  private async refreshLive() {
    const s = this.follower.confirmed;
    await this.tokens.refreshIdentity([...s.pools.keys()]);
    const bases = [...new Set([...s.markets.values()].map((m) => m.base))];
    const changed = new Set(await this.tokens.refreshLive(bases));
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

  private async audit() {
    this.reconciliation = await reconcile(
      this.options.client,
      this.options.exchange,
      this.follower.confirmed,
    );
  }

  /** Positions and balances of one wallet: claims and vault credit from the replica, external
   * token balances from one batched RPC read. */
  async wallet(owner: Address) {
    const s = this.trading();
    const tokens = [...s.pools.keys()];
    const external = await this.tokens.walletBalances(owner, tokens);
    const balances: Record<string, unknown> = {};
    for (const token of tokens)
      balances[token] = {
        account: owner,
        token,
        decimals: s.pools.get(token)!.decimals,
        canonicalBalance: (external.get(token) ?? 0n).toString(),
        vaultAvailable: creditOf(s, owner, token).toString(),
        reserved: reservedUnderlying(s, owner, token).toString(),
        blockNumber: s.block.toString(),
      };
    return {
      owner,
      observedAt: Date.now(),
      blockNumber: s.block.toString(),
      positions: positionsOf(s, owner, this.deployment),
      balances,
    };
  }

  private tradeView(event: DecodedEvent | StoredEvent, trade: TradeDetails, confirmation: string) {
    const stored = "data" in event;
    const args = (stored ? event.data : event.args) as Record<string, unknown>;
    const fill = BigInt(args.fill as string | bigint),
      amounts = BigInt(args.amounts as string | bigint),
      fees = BigInt(args.fees as string | bigint);
    const mask = (1n << 128n) - 1n;
    const market = Number(args.market);
    return {
      id: `${stored ? event.tx : event.transactionHash}:${stored ? event.log_index : event.logIndex}`,
      marketId: publicIdOf(this.follower.confirmed, market),
      venue: venueOf(this.deployment, market),
      branch: Number((fill >> 160n) & 0xffn),
      blockTimestamp: String(stored ? event.block_time : event.timestamp),
      executionPriceRawX18: trade.price,
      fillQuantity: (fill & ((1n << 96n) - 1n)).toString(),
      executionQuote: (amounts & mask).toString(),
      buyerFee: (fees & mask).toString(),
      sellerFee: (fees >> 128n).toString(),
      takerSide: trade.takerSide,
      makerOrderHash: trade.makerKey,
      takerOrderHash: trade.takerKey,
      maker: trade.maker,
      taker: trade.taker,
      transactionHash: stored ? event.tx : event.transactionHash,
      confirmation,
    };
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
      const markets =
        c.req.query("venues") === "all" ? [...s.markets.values()] : [...publicMarkets(s).values()];
      return c.json({
        markets: markets.map((m) => this.view(s, m)),
        block: s.block.toString(),
        confirmation: "confirmed",
      });
    });
    app.get("/markets/:id", (c) => {
      const s = this.trading();
      const m = this.market(c.req.param("id"), s);
      return m ? c.json(this.view(s, m)) : c.json({ error: "not-found" }, 404);
    });
    app.get("/orders", async (c) => {
      const s = this.trading();
      const raw = c.req.query("maker");
      const maker = raw ? getAddress(raw) : undefined;
      const open = c.req.query("status") === "open";
      const rows = [...s.orders.values()]
        .filter((o) => (!maker || o.owner === maker) && (!open || o.status === "open"))
        .map((o) => orderView(s, o, s.markets.get(o.market)!, this.deployment, "confirmed"));
      if (maker && !open) {
        const seen = new Set(rows.map((o) => o.id));
        for (const row of await db.closedOrders(this.domain, maker)) {
          const order = row as { id: string };
          if (!seen.has(order.id)) rows.push(row as (typeof rows)[number]);
        }
      }
      rows.sort((a, b) => (BigInt(b.updatedBlock) > BigInt(a.updatedBlock) ? 1 : -1));
      return c.json({ orders: rows, truncated: false, nextCursor: null });
    });
    app.get("/orderbook/:id", (c) => {
      const s = this.trading();
      const m = this.market(c.req.param("id"), s);
      if (!m) return c.json({ error: "not-found" }, 404);
      return c.json({
        orders: [...s.orders.values()]
          .filter((o) => o.market === m.id && liveOrder(o, s))
          .map((o) => orderView(s, o, m, this.deployment, "confirmed")),
        truncated: false,
        block: s.block.toString(),
      });
    });
    app.get("/orderbooks", (c) => {
      const s = this.trading();
      if (c.req.query("view") === "levels")
        return c.json({ books: orderbookLevels(s), block: s.block.toString() });
      const books: Record<string, { orders: ReturnType<typeof orderView>[]; truncated: false }> =
        {};
      const listed = new Map(
        [...publicMarkets(s)].map(([id, m]) => {
          books[id] = { orders: [], truncated: false };
          return [m.id, id];
        }),
      );
      for (const o of s.orders.values()) {
        const id = listed.get(o.market);
        if (id !== undefined && liveOrder(o, s))
          books[id]!.orders.push(
            orderView(s, o, s.markets.get(o.market)!, this.deployment, "confirmed"),
          );
      }
      return c.json({ books, block: s.block.toString() });
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
      const rows = await db.trades(this.domain, {
        ...(markets ? { markets } : {}),
        ...(owner ? { owner } : {}),
        limit,
      });
      const tail = this.tail
        .filter(
          (t) =>
            (!markets || markets.includes(Number(t.event.args.market))) &&
            (!owner || t.trade.maker === owner || t.trade.taker === owner),
        )
        .reverse();
      const seen = new Set(rows.map((r) => `${r.tx}:${r.log_index}`));
      return c.json({
        trades: [
          ...tail
            .filter((t) => !seen.has(`${t.event.transactionHash}:${t.event.logIndex}`))
            .map((t) => this.tradeView(t.event, t.trade, "confirmed")),
          ...rows.map((r) =>
            this.tradeView(r, (r.data as { trade: TradeDetails }).trade, "finalized"),
          ),
        ].slice(0, limit),
      });
    });
  }
}
