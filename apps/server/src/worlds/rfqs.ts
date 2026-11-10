/** World orders out for quotes (docs/version-2-plan.md §10.2).
 *
 * An order stays open for `rfqSeconds` (15 minutes by default, never past its book's cutoff).
 * It goes to every maker approved for worlds, online then or later, and each quote that passes
 * the desk's checks stands until its maker's own expiry, or until its maker replaces or
 * withdraws it or goes offline. Nothing fills by itself: the taker reads the standing quotes
 * and chooses one, which the trading delegate fills (`WorldTrading.execute`), or cancels the
 * request, or lets it run out. Makers hear how it ended.
 *
 * Anyone may be a maker for one order: open requests are public (`all`, `publicView`,
 * `watch`), and a wallet signs its own quote on one (`offer`), which stands beside the makers'
 * on the same checks, one per wallet, until it runs out, its wallet takes it back (`retract`)
 * or the taker turns it down.
 *
 * Open requests live in memory and are read from there: opening one, reading it and checking
 * its quotes cost no RPC call and no database read. The database keeps each request's row,
 * written behind the answer and never awaited by it, so a restart takes the open ones up again
 * and a wallet can list its past ones. Quotes are not stored: a restart drops every maker's
 * connection and with it its quotes, and makers quote again when they reconnect. */
import { randomUUID } from "node:crypto";
import type { Database, WorldRfqRecord } from "@conditional-stocks/db";
import { BOOK_STATE, CONTRACT_NONCE_FLOOR, worldFee } from "@conditional-stocks/evm-client";
import { bookStateAt, type WorldState } from "@conditional-stocks/evm-client/world-ledger";
import type { WorldIndexer } from "@conditional-stocks/indexer/worlds";
import { HTTPException } from "hono/http-exception";
import { type Address, getAddress, type Hex, type PublicClient } from "viem";
import type { OpenRequest, RfqHub } from "../rfq/hub.ts";
import type { MakerIdentity } from "../rfq/protocol.ts";
import {
  type WorldMakerQuote,
  type WorldOrder,
  type WorldRfqEnd,
  worldQuoteDeclined,
  worldRfqClosed,
  worldRfqRequest,
} from "../rfq/world-protocol.ts";
import { better, chainTime, signedQuote, type WorldDesk } from "./desk.ts";

/** A maker's quote standing on an open request. */
export interface StandingQuote {
  /** Names the quote to the taker choosing it. */
  id: string;
  maker: MakerIdentity;
  terms: WorldMakerQuote;
  /** Who signed it (the maker's wallet, or a vault's keeper), recovered when it arrived. */
  signer: Address;
  receivedAt: number;
  arrival: number;
}
/** The quote a taker chose. Its fill is in flight from the choice until the transaction
 * succeeded (the request is filled) or is known not to have (the request stays open). */
export interface ChosenQuote {
  id: string;
  maker: { id: string; label: string; wallet: Address | null };
  units: bigint;
  refund: bigint;
  price: bigint;
  nonce: bigint | null;
  /** The fill's transaction, once journaled. */
  tx: Hex | null;
  /** After this (ms) a fill not seen on chain can no longer land: its quote has expired. */
  until: number;
}
export interface OpenRfq {
  id: string;
  order: WorldOrder;
  createdAt: number;
  expiresAt: number;
  status: "open" | WorldRfqEnd;
  reason: string | null;
  closedAt: number | null;
  /** Standing quotes by maker id: a maker holds one. */
  quotes: Map<string, StandingQuote>;
  /** Quotes received in all. */
  received: number;
  chosen: ChosenQuote | null;
  request: OpenRequest<WorldMakerQuote> | null;
  /** The request's database writes, in order. */
  saved: Promise<void>;
}
export type RfqView = ReturnType<WorldRfqs["view"]>;

/** How long after its quote's expiry a fill in flight is given up on. */
const FILL_GRACE_MS = 60_000;
/** Closed requests kept in memory for reads that follow the close at once. */
const CLOSED_KEPT = 1_000;
const SWEEP_MS = 1_000;
/** How far past its request's end a wallet's quote may be signed to last (the clocks' slack). */
const OFFER_SLACK_MS = 60_000;

/** A wallet quoting an order of its own accord (the public board) is its own maker, named by
 * its address; makers on the stream are named by the market admin. */
const WALLET_MAKER = "wallet:";
export const walletMakerId = (wallet: Address) => `${WALLET_MAKER}${wallet}`;
const isWalletMaker = (id: string) => id.startsWith(WALLET_MAKER);
const walletMaker = (wallet: Address): MakerIdentity => ({
  id: walletMakerId(wallet),
  label: `${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
  wallet,
  worlds: true,
});

export class WorldRfqs {
  private readonly rfqs = new Map<string, OpenRfq>();
  private readonly byTaker = new Map<Address, Set<string>>();
  private readonly byTx = new Map<string, string>();
  private readonly closed = new Map<string, OpenRfq>();
  private readonly listeners = new Map<Address, Set<(rfq: OpenRfq) => void>>();
  private readonly watchers = new Set<(rfq: OpenRfq) => void>();
  private arrivals = 0;
  private readonly signers = new WeakMap<WorldMakerQuote, Address>();
  private readonly writes = new Set<Promise<void>>();
  private sweep: ReturnType<typeof setInterval> | undefined;

  constructor(
    readonly options: {
      hub: RfqHub;
      indexer: WorldIndexer;
      desk: WorldDesk;
      db: Database;
      chainId: number;
      /** The trading delegate, which fills the quote a taker chooses. */
      delegate: Address;
      /** The least lifetime a quote must have left when it arrives. */
      minQuoteSeconds: number;
      /** How long a request stays open. */
      rfqSeconds: number;
      /** Requests one wallet, and all wallets together, may have open. */
      maxOpenPerTaker: number;
      maxOpen: number;
      now?: () => number;
      log?: (level: "info" | "warn", event: string, fields: Record<string, unknown>) => void;
    },
  ) {
    // A fill in flight is confirmed by its own request's receipt; this covers the ones whose
    // request did not see it (a timeout, or a restart in between).
    options.indexer.onFill((fill) => {
      const id = this.byTx.get(fill.tx.toLowerCase());
      const rfq = id ? this.rfqs.get(id) : undefined;
      if (rfq?.chosen?.tx) this.filled(rfq, rfq.chosen.tx);
    });
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }
  /** The replica to build a frame from: the trading view, or while the chain stream is
   * unhealthy the last confirmed one (makers decide for themselves whether to quote). */
  private replica(): WorldState {
    try {
      return this.options.indexer.trading();
    } catch {
      return this.options.indexer.follower.confirmed;
    }
  }

  // ---------------------------------------------------------------- lifecycle

  /** Takes up the requests a restart left open: those run out are closed, a fill that was in
   * flight is looked up once (`client`), and the rest go out to the makers as they connect. */
  async restore(client: PublicClient) {
    const { db, indexer } = this.options;
    const rows = await db.openWorldRfqs(indexer.domain);
    const now = this.now();
    for (const row of rows) {
      const rfq = fromRecord(row);
      this.add(rfq);
      if (row.fill) {
        const tx = row.fill.tx as Hex;
        const receipt = await client.getTransactionReceipt({ hash: tx }).catch(() => null);
        if (receipt?.status === "success") {
          this.filled(rfq, tx);
          continue;
        }
        // Reverted: forgotten. Not mined: it may still land while the request is open.
        if (receipt) this.unchoose(rfq, tx);
        else if (rfq.chosen) rfq.chosen.until = rfq.expiresAt;
      }
      if (rfq.expiresAt <= now && !rfq.chosen) this.close(rfq, "expired", RAN_OUT);
      else rfq.request = this.listen(rfq);
    }
    return this.rfqs.size;
  }

  /** Stops the sweep and waits for the writes in flight. Open requests stay open in the
   * database for the next start. */
  async stop() {
    clearInterval(this.sweep);
    this.sweep = undefined;
    await this.flushed();
  }
  /** Settles once every write queued so far has reached the database. */
  async flushed() {
    while (this.writes.size) await Promise.allSettled([...this.writes]);
  }

  /** Opens `order` for quotes and resolves once the makers online have answered (or the quote
   * window passed): later quotes arrive while it stays open. `replaces` names a request of the
   * same wallet to cancel first. */
  async open(order: WorldOrder, replaces?: string): Promise<OpenRfq> {
    const { indexer, desk, delegate, hub } = this.options;
    const started = this.now();
    const s = indexer.trading();
    const problem = desk.orderProblem(s, order, chainTime(s), delegate);
    if (problem) throw new HTTPException(400, { message: problem });
    const old = replaces ? this.rfqs.get(replaces) : undefined;
    if (old && old.order.taker === order.taker && !old.chosen)
      this.close(old, "cancelled", "Replaced by a new request");
    const mine = this.byTaker.get(order.taker)?.size ?? 0;
    if (mine >= this.options.maxOpenPerTaker)
      throw new HTTPException(429, {
        message: `You have ${mine} requests open. Cancel one before asking again.`,
      });
    if (this.rfqs.size >= this.options.maxOpen)
      throw new HTTPException(503, { message: "Too many requests are open. Try again shortly." });
    const cutoff = Number(s.books.get(order.book)?.def.cutoff ?? 0) * 1000;
    const rfq: OpenRfq = {
      id: randomUUID(),
      order,
      createdAt: started,
      expiresAt: Math.min(started + this.options.rfqSeconds * 1000, cutoff),
      status: "open",
      reason: null,
      closedAt: null,
      quotes: new Map(),
      received: 0,
      chosen: null,
      request: null,
      saved: Promise.resolve(),
    };
    this.add(rfq);
    this.save(rfq, (db, domain) =>
      db.recordWorldRfq(domain, {
        id: rfq.id,
        taker: order.taker,
        book: order.book,
        mask: order.mask,
        sell: order.side === "sell",
        conditional: order.conditional,
        units: order.units,
        refund: order.refund,
        stake: order.stake,
        worst: order.limit,
        createdAt: new Date(rfq.createdAt),
        expiresAt: new Date(rfq.expiresAt),
      }),
    );
    rfq.request = this.listen(rfq);
    // Whoever watches the board hears of the order now, before any quote on it.
    this.emit(rfq);
    await rfq.request.firstRound;
    this.options.log?.("info", "world.rfq.opened", {
      rfq: rfq.id,
      book: order.book,
      side: order.side,
      makers: hub.makers(order.taker, "world"),
      quotes: rfq.quotes.size,
      ms: this.now() - started,
    });
    return rfq;
  }

  /** Asks the makers online that hold no quote that fills on the request again (its quotes ran
   * out, were withdrawn, or stopped filling); resolves once they answered or the quote window
   * passed. */
  async ask(taker: Address, id: string) {
    const { indexer, desk, delegate } = this.options;
    const rfq = this.mine(taker, id);
    if (rfq.chosen) throw new HTTPException(409, { message: FILL_IN_FLIGHT });
    // A quote that no longer fills gives way, so its maker is asked too.
    const s = indexer.trading(),
      now = chainTime(s);
    for (const [maker, q] of rfq.quotes)
      if (desk.standingProblem(s, rfq.order, q.maker, q.terms, q.signer, now, 1, delegate)) {
        rfq.quotes.delete(maker);
        rfq.request?.drop(maker);
      }
    await rfq.request?.ask();
    this.emit(rfq);
    return rfq;
  }

  /** Turns down one standing quote on `taker`'s open request: it leaves the request and fills
   * no more, and its maker hears at once (a vault's capacity for it is free again). The
   * request stays open; asking again brings that maker a new chance to quote. A quote already
   * gone is declined already. */
  decline(taker: Address, id: string, quoteId: string) {
    const rfq = this.mine(taker, id);
    if (rfq.chosen) throw new HTTPException(409, { message: FILL_IN_FLIGHT });
    for (const [maker, q] of rfq.quotes)
      if (q.id === quoteId) {
        rfq.quotes.delete(maker);
        rfq.request?.drop(maker);
        this.options.hub.notify(maker, worldQuoteDeclined(rfq.id));
        this.emit(rfq);
      }
    return rfq;
  }

  /** Cancels an open request of `taker`; its makers hear their quotes went unfilled. */
  cancel(taker: Address, id: string) {
    const rfq = this.mine(taker, id);
    if (rfq.chosen) throw new HTTPException(409, { message: FILL_IN_FLIGHT });
    this.close(rfq, "cancelled", "Cancelled by its owner");
    return rfq;
  }

  // ---------------------------------------------------------------- reads

  /** An open request of `taker`, or one closed a moment ago; undefined otherwise (older ones
   * are the database's). */
  get(taker: Address, id: string) {
    const rfq = this.rfqs.get(id) ?? this.closed.get(id);
    return rfq?.order.taker === taker ? rfq : undefined;
  }
  /** The requests `taker` has open, newest first. */
  list(taker: Address) {
    return [...(this.byTaker.get(taker) ?? [])]
      .flatMap((id) => this.rfqs.get(id) ?? [])
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  get size() {
    return this.rfqs.size;
  }

  /** A request as its taker reads it: every standing quote with its maker's expiry and whether
   * it fills now (`problem` says why not), the ones that fill first, best first. */
  view(rfq: OpenRfq) {
    const { indexer, desk, delegate, hub } = this.options;
    let s: WorldState | null = null;
    try {
      s = indexer.trading();
    } catch {}
    const o = rfq.order;
    const now = s ? chainTime(s) : BigInt(Math.floor(this.now() / 1000));
    const feeBps = this.replica().books.get(o.book)?.def.feeBps ?? 0;
    const quotes = [...rfq.quotes.values()]
      .map((q) => ({
        q,
        problem: s
          ? desk.standingProblem(s, o, q.maker, q.terms, q.signer, now, 1, delegate)
          : "The chain view is unavailable",
      }))
      .sort(
        (a, b) =>
          Number(Boolean(a.problem)) - Number(Boolean(b.problem)) ||
          (better(o, a.q.terms, b.q.terms) ? -1 : better(o, b.q.terms, a.q.terms) ? 1 : 0) ||
          // Equal quotes: the earlier (a wallet's own quote counts arrivals apart from the
          // stream's, so the time decides first).
          a.q.receivedAt - b.q.receivedAt ||
          a.q.arrival - b.q.arrival,
      )
      .map(({ q, problem }) => {
        const fee = worldFee(q.terms.price, feeBps);
        return {
          id: q.id,
          maker: q.maker.label,
          /** Names the maker across its quotes: a later quote of the same maker replaced its
           * earlier one. */
          makerId: q.maker.id,
          /** Whether the maker is a world vault (the protocol's own liquidity). */
          vault: indexer.deployment.vaults.includes(q.maker.wallet),
          units: q.terms.units,
          refund: q.terms.refund,
          price: q.terms.price,
          fee,
          /** What the taker pays (a buy) or receives (a sell), fee included. */
          total: o.side === "sell" ? q.terms.price - fee : q.terms.price + fee,
          /** The maker's own expiry, unix seconds: the quote fills only before it. */
          expiry: q.terms.expiry,
          receivedAt: q.receivedAt,
          problem,
        };
      });
    return {
      id: rfq.id,
      status: rfq.status,
      reason: rfq.reason,
      book: o.book,
      order: {
        side: o.side,
        mask: o.mask,
        units: o.units,
        refund: o.refund,
        stake: o.stake,
        conditional: o.conditional,
        limit: o.limit,
      },
      /** This API's clock (ms) as the view was made: what `expiresAt` and each quote's `expiry`
       * are counted down against, whatever the reader's own clock says. */
      now: Math.max(this.now(), Number(now) * 1000),
      createdAt: rfq.createdAt,
      expiresAt: rfq.expiresAt,
      closedAt: rfq.closedAt,
      /** World makers online now that may quote it. */
      makers: rfq.status === "open" ? hub.makers(o.taker, "world") : 0,
      received: rfq.received,
      quotes,
      /** The quote chosen: in flight while the request is open, filled once it is. */
      fill: rfq.chosen
        ? {
            quote: rfq.chosen.id,
            maker: rfq.chosen.maker.label,
            units: rfq.chosen.units,
            refund: rfq.chosen.refund,
            price: rfq.chosen.price,
            transactionHash: rfq.chosen.tx,
          }
        : null,
    };
  }

  /** Calls `listener` with each of `taker`'s requests as it changes (a quote arrives, is
   * replaced, withdrawn or runs out; the request fills, is cancelled or expires). */
  subscribe(taker: Address, listener: (rfq: OpenRfq) => void) {
    const set = this.listeners.get(taker) ?? new Set();
    set.add(listener);
    this.listeners.set(taker, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(taker);
    };
  }

  // ---------------------------------------------------------------- the public board

  /** Every open request, newest first. */
  all() {
    return [...this.rfqs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  /** An open request, or one closed a moment ago, whoever asks. */
  find(id: string) {
    return this.rfqs.get(id) ?? this.closed.get(id);
  }

  /** A request as anyone reads it: who asks, what for, how long it stays open and every
   * standing quote (its maker, what it gives, its own expiry and whether it fills now), best
   * first. A quote's id is its taker's to choose with, so it is left out; `wallet` names a
   * wallet quoting of its own accord, which is how a reader knows its own. */
  publicView(rfq: OpenRfq) {
    const view = this.view(rfq);
    const makers = new Map([...rfq.quotes.values()].map((q) => [q.id, q.maker]));
    const wallet = (maker: { id: string; wallet: Address | null } | undefined) =>
      maker && isWalletMaker(maker.id) ? maker.wallet : null;
    return {
      id: view.id,
      status: view.status,
      reason: view.reason,
      book: view.book,
      taker: rfq.order.taker,
      order: view.order,
      now: view.now,
      createdAt: view.createdAt,
      expiresAt: view.expiresAt,
      closedAt: view.closedAt,
      received: view.received,
      quotes: view.quotes.map((q) => ({
        maker: q.maker,
        makerId: q.makerId,
        wallet: wallet(makers.get(q.id)),
        vault: q.vault,
        units: q.units,
        refund: q.refund,
        price: q.price,
        expiry: q.expiry,
        receivedAt: q.receivedAt,
        fills: q.problem === null,
      })),
      /** The quote its taker chose, once it filled. */
      fill:
        rfq.status === "filled" && rfq.chosen
          ? {
              maker: rfq.chosen.maker.label,
              makerId: rfq.chosen.maker.id,
              wallet: wallet(rfq.chosen.maker),
              units: rfq.chosen.units,
              refund: rfq.chosen.refund,
              price: rfq.chosen.price,
              transactionHash: rfq.chosen.tx,
            }
          : null,
    };
  }

  /** Calls `listener` with every request as it changes, whoever asked it. */
  watch(listener: (rfq: OpenRfq) => void) {
    this.watchers.add(listener);
    return () => void this.watchers.delete(listener);
  }

  /** `wallet`'s own signed quote on an open request of another wallet: checked as a maker's is
   * (the bundle and price the order asks, its lifetime, both sides' funds on the replica, an
   * unspent wallet nonce, a low-s signature by `wallet`), then standing beside the makers' for
   * the taker to choose. A wallet holds one quote on a request: a later one replaces it. No
   * funds are set aside: the quote fills from the wallet's world credit if it is chosen, and
   * reads as not filling while that credit is short. */
  async offer(wallet: Address, id: string, terms: WorldMakerQuote) {
    const { indexer, desk, delegate, minQuoteSeconds } = this.options;
    const rfq = this.standing(id);
    if (rfq.order.taker === wallet)
      throw new HTTPException(400, { message: "This is your own order" });
    if (terms.nonce >= CONTRACT_NONCE_FLOOR)
      throw new HTTPException(400, { message: "A wallet's quote carries a wallet's nonce" });
    if (Number(terms.expiry) * 1000 > rfq.expiresAt + OFFER_SLACK_MS)
      throw new HTTPException(400, { message: "A quote lasts no longer than its order" });
    const maker = walletMaker(wallet);
    const s = indexer.trading();
    const checked = await desk.checkQuote(
      s,
      rfq.order,
      maker,
      terms,
      chainTime(s),
      minQuoteSeconds,
      delegate,
    );
    if ("problem" in checked)
      throw new HTTPException(400, { message: offerProblem(checked.problem, minQuoteSeconds) });
    // It may have closed, or been chosen from, while the signature was checked.
    this.standing(id);
    rfq.quotes.set(maker.id, {
      id: randomUUID(),
      maker,
      terms,
      signer: checked.signer,
      receivedAt: this.now(),
      arrival: ++this.arrivals,
    });
    rfq.received++;
    this.options.log?.("info", "world.rfq.offer", { rfq: rfq.id, maker: wallet });
    this.emit(rfq);
    return rfq;
  }

  /** Takes `wallet`'s own quote off an open request (one the taker is filling stays). A quote
   * already gone is taken back already. */
  retract(wallet: Address, id: string) {
    const rfq = this.find(id);
    if (!rfq) throw new HTTPException(404, { message: "No open order with this id" });
    const maker = walletMakerId(wallet);
    if (rfq.chosen?.maker.id === maker && rfq.status === "open")
      throw new HTTPException(409, { message: "The taker accepted this quote: it is filling" });
    if (rfq.quotes.delete(maker)) this.emit(rfq);
    return rfq;
  }

  /** An open request that takes quotes now. */
  private standing(id: string) {
    const rfq = this.rfqs.get(id);
    if (!rfq)
      throw this.closed.has(id)
        ? new HTTPException(409, { message: "This order is no longer open" })
        : new HTTPException(404, { message: "No open order with this id" });
    if (rfq.chosen)
      throw new HTTPException(409, { message: "The taker is filling a quote on this order" });
    return rfq;
  }

  // ---------------------------------------------------------------- the taker's choice

  /** The standing quote `taker` chose on its open request, checked on the replica as it is
   * now, and marked as the one being filled: until `unchoose` or `filled`, the request takes
   * no other choice, and the quote fills even if its maker withdraws it meanwhile. */
  choose(taker: Address, id: string, quoteId: string): StandingQuote {
    const { indexer, desk, delegate } = this.options;
    const rfq = this.mine(taker, id);
    if (rfq.chosen) throw new HTTPException(409, { message: FILL_IN_FLIGHT });
    const quote = [...rfq.quotes.values()].find((q) => q.id === quoteId);
    if (!quote)
      throw new HTTPException(409, {
        message: "This quote is no longer available. Choose another, or ask again.",
      });
    const s = indexer.trading();
    const problem = desk.standingProblem(
      s,
      rfq.order,
      quote.maker,
      quote.terms,
      quote.signer,
      chainTime(s),
      1,
      delegate,
    );
    if (problem) throw new HTTPException(409, { message: problem });
    rfq.chosen = {
      id: quote.id,
      maker: { id: quote.maker.id, label: quote.maker.label, wallet: quote.maker.wallet },
      units: quote.terms.units,
      refund: quote.terms.refund,
      price: quote.terms.price,
      nonce: quote.terms.nonce,
      tx: null,
      until: Number(quote.terms.expiry) * 1000 + FILL_GRACE_MS,
    };
    return quote;
  }

  /** The signed quote and signature a chosen quote fills with. */
  fillOf(rfq: OpenRfq, quote: StandingQuote) {
    return { quote: signedQuote(rfq.order, quote.terms), signature: quote.terms.signature };
  }

  /** The chosen quote's fill was journaled as `tx` (the database row is the journal's own). */
  journaled(rfq: OpenRfq, tx: Hex) {
    if (!rfq.chosen) return;
    rfq.chosen.tx = tx;
    this.byTx.set(tx.toLowerCase(), rfq.id);
    this.arm();
  }

  /** The chosen quote did not fill and will not (`tx` when its transaction was journaled): the
   * request is open to another choice. */
  unchoose(rfq: OpenRfq, tx: Hex | null) {
    if (!rfq.chosen || rfq.status !== "open") return;
    rfq.chosen = null;
    if (tx) {
      this.byTx.delete(tx.toLowerCase());
      this.save(rfq, (db, domain) => db.clearWorldRfqFill(domain, rfq.id, tx));
    }
    this.emit(rfq);
  }

  /** The chosen quote filled in `tx`: the request closes, its maker hears it filled and the
   * other makers that theirs lost. */
  filled(rfq: OpenRfq, tx: Hex) {
    if (rfq.status !== "open" || !rfq.chosen) return;
    rfq.chosen.tx = tx;
    const { hub, desk } = this.options;
    if (!isWalletMaker(rfq.chosen.maker.id)) hub.awarded(rfq.chosen.maker.id);
    if (rfq.chosen.maker.wallet && rfq.chosen.nonce !== null)
      desk.spend(rfq.chosen.maker.wallet, rfq.chosen.nonce);
    this.close(rfq, "filled", null);
  }

  // ---------------------------------------------------------------- internals

  private mine(taker: Address, id: string) {
    const rfq = this.rfqs.get(id);
    if (rfq?.order.taker !== taker) {
      const done = this.closed.get(id);
      throw done?.order.taker === taker
        ? new HTTPException(409, { message: `This request is ${done.status}` })
        : new HTTPException(404, { message: "No open request with this id" });
    }
    return rfq;
  }

  private add(rfq: OpenRfq) {
    this.rfqs.set(rfq.id, rfq);
    const mine = this.byTaker.get(rfq.order.taker) ?? new Set();
    mine.add(rfq.id);
    this.byTaker.set(rfq.order.taker, mine);
    if (rfq.chosen?.tx) this.byTx.set(rfq.chosen.tx.toLowerCase(), rfq.id);
    this.arm();
  }

  /** Puts the request in front of the makers and keeps its standing quotes. */
  private listen(rfq: OpenRfq) {
    const { hub, indexer, desk, chainId, minQuoteSeconds, delegate } = this.options;
    const order = rfq.order;
    return hub.open<WorldMakerQuote>({
      id: rfq.id,
      kind: "world",
      exclude: order.taker,
      request: (replay) => {
        const s = this.replica();
        return worldRfqRequest({
          id: rfq.id,
          sentAt: rfq.createdAt,
          windowMs: hub.options.windowMs,
          open: { expiresAt: rfq.expiresAt, replay },
          minQuoteSeconds,
          chainId,
          books: indexer.deployment.books,
          // biome-ignore lint/style/noNonNullAssertion: a request's book exists.
          book: s.books.get(order.book)!,
          state: s,
          now: chainTime(s),
          order,
        });
      },
      validate: async (maker, terms) => {
        const s = indexer.trading();
        const checked = await desk.checkQuote(
          s,
          order,
          maker,
          terms,
          chainTime(s),
          minQuoteSeconds,
          delegate,
        );
        if ("problem" in checked) return checked.problem;
        this.signers.set(terms, checked.signer);
        return null;
      },
      onQuote: (q) => {
        const signer = this.signers.get(q.terms);
        if (!signer || rfq.status !== "open") return;
        rfq.quotes.set(q.maker.id, {
          id: randomUUID(),
          maker: q.maker,
          terms: q.terms,
          signer,
          receivedAt: q.receivedAt,
          arrival: q.arrival,
        });
        rfq.received++;
        this.emit(rfq);
      },
      onWithdrawn: (q) => {
        if (rfq.quotes.get(q.maker.id)?.terms !== q.terms) return;
        rfq.quotes.delete(q.maker.id);
        this.emit(rfq);
      },
    });
  }

  private close(rfq: OpenRfq, status: WorldRfqEnd, reason: string | null) {
    if (rfq.status !== "open") return;
    const { hub } = this.options;
    rfq.status = status;
    rfq.reason = reason;
    rfq.closedAt = this.now();
    rfq.request?.close();
    rfq.request = null;
    const won = status === "filled" ? rfq.chosen : null;
    const result = (q: { units: bigint; price: bigint }, mine: boolean) => ({
      type: "world.result",
      rfqId: rfq.id,
      outcome: mine ? "filled" : won ? "lost" : "unfilled",
      transaction: mine ? (won?.tx ?? null) : null,
      price: q.price.toString(),
      units: q.units.toString(),
      reason: mine ? null : won ? "The taker chose another quote" : (reason ?? RAN_OUT),
    });
    // The maker that filled hears it even when its quote left the request meanwhile.
    if (won) hub.notify(won.maker.id, result(won, true));
    for (const q of rfq.quotes.values())
      if (q.id !== won?.id) hub.notify(q.maker.id, result(q.terms, false));
    hub.broadcast("world", worldRfqClosed(rfq.id, status), rfq.order.taker);
    rfq.quotes.clear();
    this.rfqs.delete(rfq.id);
    const mine = this.byTaker.get(rfq.order.taker);
    mine?.delete(rfq.id);
    if (!mine?.size) this.byTaker.delete(rfq.order.taker);
    if (rfq.chosen?.tx) this.byTx.delete(rfq.chosen.tx.toLowerCase());
    if (status !== "filled") rfq.chosen = null;
    this.closed.set(rfq.id, rfq);
    if (this.closed.size > CLOSED_KEPT) {
      const oldest = this.closed.keys().next().value;
      if (oldest !== undefined) this.closed.delete(oldest);
    }
    const closedAt = new Date(rfq.closedAt);
    this.save(rfq, async (db, domain) => {
      await db.closeWorldRfq(domain, rfq.id, {
        status,
        reason,
        quotes: rfq.received,
        at: closedAt,
      });
    });
    this.options.log?.("info", "world.rfq.closed", {
      rfq: rfq.id,
      status,
      quotes: rfq.received,
      ms: rfq.closedAt - rfq.createdAt,
    });
    this.emit(rfq);
  }

  /** Runs every second while a request is open: requests and quotes that ran out, books that
   * stopped trading, and fills in flight that can no longer land. */
  private arm() {
    if (this.sweep || !this.rfqs.size) return;
    this.sweep = setInterval(() => this.tick(), SWEEP_MS);
    this.sweep.unref?.();
  }
  /** One sweep (exposed for tests). */
  tick() {
    const nowMs = this.now();
    let s: WorldState | null = null;
    try {
      s = this.options.indexer.trading();
    } catch {}
    const now = s ? chainTime(s) : BigInt(Math.floor(nowMs / 1000));
    for (const rfq of [...this.rfqs.values()]) {
      if (rfq.chosen) {
        // A choice being filled holds the request until its fill can no longer land.
        if (!rfq.chosen.tx || nowMs < rfq.chosen.until) continue;
        this.unchoose(rfq, rfq.chosen.tx);
      }
      if (rfq.expiresAt <= nowMs) {
        this.close(rfq, "expired", RAN_OUT);
        continue;
      }
      const b = s?.books.get(rfq.order.book);
      if (s && (!b || bookStateAt(s, b, now) > BOOK_STATE.halted)) {
        this.close(rfq, "expired", "The world stopped trading");
        continue;
      }
      let changed = false;
      for (const [maker, q] of rfq.quotes)
        if (q.terms.expiry <= now) {
          rfq.quotes.delete(maker);
          rfq.request?.drop(maker);
          changed = true;
        }
      if (changed) this.emit(rfq);
    }
    if (!this.rfqs.size) {
      clearInterval(this.sweep);
      this.sweep = undefined;
    }
  }

  private emit(rfq: OpenRfq) {
    for (const listener of this.listeners.get(rfq.order.taker) ?? []) listener(rfq);
    for (const listener of this.watchers) listener(rfq);
  }

  /** Queues a write of `rfq`'s row after its earlier ones; a failure is logged, never thrown. */
  private save(rfq: OpenRfq, write: (db: Database, domain: string) => Promise<unknown>) {
    const { db, indexer, log } = this.options;
    const next = rfq.saved
      .then(() => write(db, indexer.domain))
      .then(
        () => {},
        (error) => log?.("warn", "world.rfq.write-failed", { rfq: rfq.id, error: String(error) }),
      );
    rfq.saved = next;
    this.writes.add(next);
    void next.finally(() => this.writes.delete(next));
  }
}

const RAN_OUT = "The request ran out before a quote was chosen";

/** Why a wallet's own quote was refused, said to the person who signed it. */
function offerProblem(problem: string, minQuoteSeconds: number) {
  switch (problem) {
    case "The maker cannot fund the sets it must split":
    case "The maker cannot pay the price":
      return "Your world balance does not cover this quote. Deposit more, or offer less.";
    case "Fewer units than the order accepts":
      return "This order asks for a higher payout than that.";
    case "The quote expires too soon to fill":
      return `Keep the quote open for at least ${minQuoteSeconds} seconds.`;
    case "The quote is not signed by the maker's wallet":
      return "The signature is not this wallet's. Sign with the wallet you are signed in with.";
    case "This nonce has already filled":
      return "This quote already filled once. Sign a new one.";
    case "The taker's credit does not cover the price and fee":
    case "The taker's trading permission is inactive":
    case "The trade exceeds the trading permission's budget":
    case "The book's fee exceeds the permission's fee cap":
      return "The taker cannot fill this order right now.";
    default:
      return problem;
  }
}
const FILL_IN_FLIGHT = "A fill of this request is in flight. Wait for it to settle.";

/** An open request as the database kept it: its order, and a fill that was in flight. */
function fromRecord(r: WorldRfqRecord): OpenRfq {
  return {
    id: r.id,
    order: {
      // The database keeps addresses in lower case; the replica and sessions checksum them.
      taker: getAddress(r.taker),
      book: r.book,
      mask: r.mask,
      side: r.sell ? "sell" : "buy",
      units: r.units,
      refund: r.refund,
      stake: r.stake,
      conditional: r.conditional,
      limit: r.worst,
    },
    createdAt: r.createdAt.getTime(),
    expiresAt: r.expiresAt.getTime(),
    status: "open",
    reason: null,
    closedAt: null,
    quotes: new Map(),
    received: r.quotes,
    chosen: r.fill
      ? {
          id: "",
          maker: { id: r.fill.maker, label: r.fill.makerLabel, wallet: null },
          units: r.fill.units,
          refund: r.fill.refund,
          price: r.fill.price,
          nonce: null,
          tx: r.fill.tx as Hex,
          until: r.expiresAt.getTime(),
        }
      : null,
    request: null,
    saved: Promise.resolve(),
  };
}

/** A request the database holds (closed, or open before this process took it up), as its taker
 * reads it: the shape of `WorldRfqs.view`, without quotes. */
export function recordView(r: WorldRfqRecord) {
  return {
    id: r.id,
    status: r.status,
    reason: r.reason,
    book: r.book,
    order: {
      side: r.sell ? ("sell" as const) : ("buy" as const),
      mask: r.mask,
      units: r.units,
      refund: r.refund,
      stake: r.stake,
      conditional: r.conditional,
      limit: r.worst,
    },
    now: Date.now(),
    createdAt: r.createdAt.getTime(),
    expiresAt: r.expiresAt.getTime(),
    closedAt: r.closedAt?.getTime() ?? null,
    makers: 0,
    received: r.quotes,
    quotes: [],
    fill: r.fill
      ? {
          quote: "",
          maker: r.fill.makerLabel,
          units: r.fill.units,
          refund: r.fill.refund,
          price: r.fill.price,
          transactionHash: r.fill.tx,
        }
      : null,
  };
}
