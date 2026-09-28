/** Chain index service: live replica, finalized persistence, reconciliation and read routes.
 *
 * Trading reads (markets, books, orders, stream) and wallet views are served from the confirmed
 * replica in memory with no database round trip. PostgreSQL receives one batched transaction
 * per finalized advance (events and closed orders) plus a checkpoint at a bounded cadence, and
 * serves only history (trades, closed orders). */
import type { Database, FinalizedBatch, StoredEvent } from "@conditional-stocks/db";
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
  liveOrder,
  marketView,
  orderbookLevels,
  orderView,
  payoutCredits,
  positionsOf,
  reservedUnderlying,
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
  readonly follower: ChainFollower;
  readonly tokens: TokenReader;
  readonly stream = createIndexStream();
  reconciliation: Reconciliation | undefined;
  persistError: string | null = null;
  private tail: TailTrade[] = [];
  private lastCheckpoint = 0;
  /** Finalized batches not yet written (retried idempotently before newer ones). */
  private queue: FinalizedBatch[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(readonly options: IndexerOptions) {
    this.domain = `${options.chainId}:${getAddress(options.exchange)}`;
    this.tokens = new TokenReader(options.client);
    this.follower = new ChainFollower({
      client: options.client,
      exchange: getAddress(options.exchange),
      quote: getAddress(options.quote),
      deploymentBlock: options.deploymentBlock,
      domain: this.domain,
      db: options.db,
      ...(options.pollMs ? { pollMs: options.pollMs } : {}),
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
  }

  /** Confirmed replica for trading reads; throws while the chain stream is unhealthy. */
  trading(): ChainState {
    if (!this.follower.health().healthy) throw new Error("Live chain index unavailable");
    return this.follower.confirmed;
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
    for (const event of notice.events)
      if (event.name === "Trade")
        this.tail.push({ event, trade: notice.trades.get(`${event.block}:${event.logIndex}`)! });
    if (this.tail.length > 2_000) this.tail = this.tail.slice(-2_000);
    this.stream.publish(updateOf(notice.block, notice.changes));
  }

  private async persist(notice: FinalizedNotice) {
    this.queue.push({
      events: notice.events.map((e) =>
        storedFromDecoded(e, notice.trades.get(`${e.block}:${e.logIndex}`)),
      ),
      orders: notice.closed.map((o) => ({
        key: o.key,
        owner: o.owner,
        market: o.market,
        updated_block: o.updatedBlock.toString(),
        data: orderView(o, notice.base.markets.get(o.market)!, "finalized"),
      })),
    });
    try {
      while (this.queue.length) {
        const batch = this.queue[0]!;
        const last = this.queue.length === 1;
        const due =
          last && Date.now() - this.lastCheckpoint >= (this.options.checkpointMs ?? 300_000);
        await this.options.db.persistFinalized(this.domain, {
          ...batch,
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
        if (due) this.lastCheckpoint = Date.now();
        this.queue.shift();
      }
      this.tail = this.tail.filter((t) => t.event.block > notice.block);
      this.persistError = null;
    } catch (error) {
      this.persistError = error instanceof Error ? error.message : String(error);
      if (this.queue.length > 10_000) throw new Error("Finalized persistence backlog exceeded");
      this.options.onError?.(error);
    }
  }

  /** Market view with the base token's live issuer state and token identities. */
  view(s: ChainState, m: ChainState["markets"] extends Map<number, infer T> ? T : never) {
    return marketView(s, m, this.tokens.live.get(m.base), (token) =>
      this.tokens.identity.get(token),
    );
  }

  private async refreshLive() {
    const s = this.follower.confirmed;
    await this.tokens.refreshIdentity([...s.pools.keys()]);
    const bases = [...new Set([...s.markets.values()].map((m) => m.base))];
    const changed = new Set(await this.tokens.refreshLive(bases));
    if (!changed.size) return;
    const markets = [...s.markets.values()]
      .filter((m) => changed.has(m.base))
      .map((m) => String(m.id));
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
      positions: positionsOf(s, owner),
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
    return {
      id: `${stored ? event.tx : event.transactionHash}:${stored ? event.log_index : event.logIndex}`,
      marketId: String(args.market),
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
    app.get("/markets", (c) => {
      const s = this.trading();
      return c.json({
        markets: [...s.markets.values()].map((m) => this.view(s, m)),
        block: s.block.toString(),
        confirmation: "confirmed",
      });
    });
    app.get("/markets/:id", (c) => {
      const s = this.trading();
      const m = s.markets.get(Number(c.req.param("id")));
      return m ? c.json(this.view(s, m)) : c.json({ error: "not-found" }, 404);
    });
    app.get("/orders", async (c) => {
      const s = this.trading();
      const raw = c.req.query("maker");
      const maker = raw ? getAddress(raw) : undefined;
      const open = c.req.query("status") === "open";
      const rows = [...s.orders.values()]
        .filter((o) => (!maker || o.owner === maker) && (!open || o.status === "open"))
        .map((o) => orderView(o, s.markets.get(o.market)!, "confirmed"));
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
      const id = Number(c.req.param("id"));
      const m = s.markets.get(id);
      if (!m) return c.json({ error: "not-found" }, 404);
      return c.json({
        orders: [...s.orders.values()]
          .filter((o) => o.market === id && liveOrder(o, s))
          .map((o) => orderView(o, m, "confirmed")),
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
      for (const id of s.markets.keys()) books[String(id)] = { orders: [], truncated: false };
      for (const o of s.orders.values())
        if (liveOrder(o, s))
          books[String(o.market)]!.orders.push(orderView(o, s.markets.get(o.market)!, "confirmed"));
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
        payouts: payoutCredits(this.custody(), getAddress(c.req.param("owner"))),
        nextCursor: null,
      }),
    );
    app.get("/resolutions/:id", (c) => {
      const s = this.custody();
      const m = s.markets.get(Number(c.req.param("id")));
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
      const market = c.req.query("marketId");
      const raw = c.req.query("owner");
      const owner = raw ? getAddress(raw) : undefined;
      if (market && !s.markets.has(Number(market))) return c.json({ trades: [] });
      const markets = market ? [Number(market)] : undefined;
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
