/** Checks world orders and the quotes makers give them, and runs the short auction of the
 * orders the API fills at once (docs/version-2-plan.md §10.2). An order its taker chooses a
 * quote for stays open instead (`rfqs.ts`), on the same checks.
 *
 * 1. The order goes to every maker approved for worlds that is online (never the taker). Each
 *    quote is checked as it arrives against the world replica: the bundle and price it was
 *    asked for, the lifetime it has left, both sides' funds, the book trading, an unspent
 *    nonce, a low-s signature by the maker's wallet, or for the world vault one by a keeper for
 *    its current epoch that its `onWorldFill` hook would accept (`vaultHookProblem`).
 * 2. After the window, or once every maker has answered, the best quote that still stands on
 *    the latest replica wins: the lowest price for a buy, the most units for a stake, the
 *    highest bid for a cash-out; ties go to the earliest. One maker fills each order.
 * 3. Each maker hears what it won and whether it filled.
 *
 * With no world maker online nothing runs. Checking a quote reads no chain and no database. */
import { randomUUID } from "node:crypto";
import type { WorldFillRow } from "@conditional-stocks/db";
import {
  BOOK_STATE,
  bundlePays,
  bundleProblem,
  CONTRACT_NONCE_FLOOR,
  compactSignature,
  quoteNonceMaker,
  WORLD_BUY,
  WORLD_QUOTE_TYPES,
  WORLD_SELL,
  type WorldQuote,
  worldFee,
  worldQuoteDomain,
  worldQuoteMessage,
  worldQuoteProblem,
} from "@conditional-stocks/evm-client";
import {
  atomsOf,
  bookStateAt,
  type WorldState,
  worldCreditOf,
} from "@conditional-stocks/evm-client/world-ledger";
import { fillProblem, vaultHookProblem } from "@conditional-stocks/evm-client/world-risk";
import type { WorldIndexer } from "@conditional-stocks/indexer/worlds";
import { type Address, getAddress, type Hex, recoverTypedDataAddress } from "viem";
import type { CollectedQuote, RfqHub } from "../rfq/hub.ts";
import type { MakerIdentity } from "../rfq/protocol.ts";
import { type WorldMakerQuote, type WorldOrder, worldRfqRequest } from "../rfq/world-protocol.ts";

export interface WorldAuction {
  id: string;
  order: WorldOrder;
  quotes: CollectedQuote<WorldMakerQuote>[];
  /** The winning quote, as it fills, and its maker. */
  award: { maker: MakerIdentity; quote: WorldQuote; signature: Hex } | null;
  /** Why each other quote lost (by maker id). */
  dropped: Map<string, string>;
}

/** Nonces kept per maker as spent, so a reused one is refused before it can only revert. */
const SPENT_PER_MAKER = 4_096;
/** How long an owner-signed award is watched for its fill after it expires. */
const WATCH_GRACE_MS = 60_000;
const seconds = () => BigInt(Math.floor(Date.now() / 1000));
/** The time the chain will check a fill at: its next block, no earlier than the replica's head
 * nor this clock (quotes are signed at the chain's time and must not count as signed later). */
export const chainTime = (s: WorldState) => (s.timestamp > seconds() ? s.timestamp : seconds());

/** The `WorldQuote` a maker's answer to `order` signs. */
export const signedQuote = (order: WorldOrder, terms: WorldMakerQuote): WorldQuote => ({
  taker: order.taker,
  book: BigInt(order.book),
  mask: order.mask,
  units: terms.units,
  refund: terms.refund,
  sell: order.side === "sell",
  price: terms.price,
  expiry: terms.expiry,
  makerData: terms.makerData,
  nonce: terms.nonce,
});

/** Why `terms` does not answer `order` (null when it does): the bundle and price asked for. */
export function termsProblem(order: WorldOrder, terms: WorldMakerQuote): string | null {
  if (order.units !== null) {
    if (terms.units !== order.units || terms.refund !== order.refund)
      return "The quote is for another bundle than the order";
    if (order.side === "buy" ? terms.price > order.limit : terms.price < order.limit)
      return "The price is beyond the order's limit";
    return null;
  }
  if (order.stake === null || order.side !== "buy") return "Invalid order";
  if (terms.price !== order.stake) return "A quote for a stake is priced at the stake";
  if (terms.refund !== (order.conditional ? order.stake : 0n))
    return order.conditional
      ? "A conditional payout refunds the stake"
      : "A world bet has no refund";
  if (terms.units === 0n || terms.units < order.limit) return "Fewer units than the order accepts";
  return null;
}

/** The better of two standing quotes for `order`: lower price, more units, higher bid. */
export const better = (order: WorldOrder, a: WorldMakerQuote, b: WorldMakerQuote) =>
  order.side === "sell"
    ? a.price > b.price
    : order.stake !== null
      ? a.units > b.units
      : a.price < b.price;

export class WorldDesk {
  private readonly spent = new Map<Address, Set<bigint>>();
  /** Owner-signed awards awaiting their fill, by `${maker}:${nonce}`. */
  private readonly watching = new Map<string, { auction: WorldAuction; until: number }>();
  private sweep: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly options: {
      hub: RfqHub;
      indexer: WorldIndexer;
      chainId: number;
      /** The least lifetime a quote must have left when it arrives. */
      minQuoteSeconds: number;
      log?: (level: "info" | "warn", event: string, fields: Record<string, unknown>) => void;
    },
  ) {
    options.indexer.onFill((fill) => this.filled(fill));
  }

  /** Whether a world maker other than `taker` is online. */
  available(taker?: Address) {
    return this.options.hub.makers(taker, "world") > 0;
  }

  stop() {
    clearInterval(this.sweep);
  }

  /** Why `order` cannot go out now (null when it can): the book trading, the bundle valid for
   * it, the taker holding what it sells or the credit a stake costs, and a delegate's grant. */
  orderProblem(s: WorldState, order: WorldOrder, now: bigint, delegate?: Address): string | null {
    if (s.config.paused) return "The world books are paused";
    const b = s.books.get(order.book);
    if (!b) return "Unknown book";
    if (bookStateAt(s, b, now) !== BOOK_STATE.trading) return "The book is not trading";
    const stake = order.units === null;
    if (stake && (order.side !== "buy" || !order.stake || order.stake <= 0n))
      return "A stake is a positive amount to buy with";
    const bundle = stake
      ? { mask: order.mask, units: 1n, refund: order.conditional ? order.stake! : 0n }
      : { mask: order.mask, units: order.units!, refund: order.refund };
    const shape = bundleProblem(bundle, b.atoms);
    if (shape) return shape;
    if (!order.mask) return "Name the outcomes the order pays on";
    if (order.side === "sell") {
      const held = atomsOf(s, b.id, order.taker);
      for (let atom = 0; atom < b.atoms; atom++)
        if (held[atom]! < bundlePays(bundle, atom)) return "The taker does not hold the bundle";
    } else if (
      stake &&
      worldCreditOf(s, order.taker) < order.stake! + worldFee(order.stake!, b.def.feeBps)
    )
      return "Deposit enough to cover the stake and its fee";
    if (delegate) {
      const g = s.grants.get(`${order.taker}:${delegate}`);
      const permission = order.side === "sell" ? WORLD_SELL : WORLD_BUY;
      if (
        !g ||
        !(g.permissions & permission) ||
        g.revoked ||
        g.epoch !== (s.delegationEpochs.get(order.taker) ?? 0n) ||
        now >= g.expiresAt
      )
        return "Approve trading for this wallet first";
      if (b.def.feeBps > g.maxFeeBps) return "This book's fee exceeds your approved fee limit";
    }
    return null;
  }

  /** Why a maker's quote cannot fill `order` now, or null: everything the books and the vault's
   * hook check, the signature included, from the replica `s`. */
  async quoteProblem(
    s: WorldState,
    order: WorldOrder,
    maker: MakerIdentity,
    terms: WorldMakerQuote,
    now: bigint,
    minQuoteSeconds: number,
    delegate?: Address,
  ): Promise<string | null> {
    const checked = await this.checkQuote(s, order, maker, terms, now, minQuoteSeconds, delegate);
    return "problem" in checked ? checked.problem : null;
  }

  /** `quoteProblem`, also saying who signed a quote that fills: `standingProblem` checks the
   * quote again later without recovering the signer again. */
  async checkQuote(
    s: WorldState,
    order: WorldOrder,
    maker: MakerIdentity,
    terms: WorldMakerQuote,
    now: bigint,
    minQuoteSeconds: number,
    delegate?: Address,
  ): Promise<{ signer: Address } | { problem: string }> {
    const unsigned = this.unsignedProblem(s, order, maker, terms, now, minQuoteSeconds, delegate);
    if (unsigned) return { problem: unsigned };
    let signature: ReturnType<typeof compactSignature>;
    try {
      signature = compactSignature(terms.signature);
    } catch {
      return { problem: "Malformed signature" };
    }
    if (!signature.lowS) return { problem: "A high-s signature does not fill" };
    const { chainId, indexer } = this.options;
    const q = signedQuote(order, terms);
    const signer = await recoverTypedDataAddress({
      domain: worldQuoteDomain(chainId, indexer.deployment.books),
      types: WORLD_QUOTE_TYPES,
      primaryType: "WorldQuote",
      message: worldQuoteMessage(q),
      signature: signature.full,
    }).catch(() => null);
    if (!signer) return { problem: "Malformed signature" };
    const problem = this.signerProblem(s, maker, q, signer, now);
    return problem ? { problem } : { signer };
  }

  /** Why a quote that stood (signed by `signer`) no longer fills `order` on the replica `s`,
   * or null: every check of `quoteProblem` but the signature's recovery. */
  standingProblem(
    s: WorldState,
    order: WorldOrder,
    maker: MakerIdentity,
    terms: WorldMakerQuote,
    signer: Address,
    now: bigint,
    minQuoteSeconds: number,
    delegate?: Address,
  ): string | null {
    return (
      this.unsignedProblem(s, order, maker, terms, now, minQuoteSeconds, delegate) ??
      this.signerProblem(s, maker, signedQuote(order, terms), signer, now)
    );
  }

  /** What a quote must pass before its signature matters: the bundle and price asked for, its
   * lifetime, an unspent nonce naming its maker, and the fill itself on the replica. */
  private unsignedProblem(
    s: WorldState,
    order: WorldOrder,
    maker: MakerIdentity,
    terms: WorldMakerQuote,
    now: bigint,
    minQuoteSeconds: number,
    delegate?: Address,
  ): string | null {
    const shape = termsProblem(order, terms);
    if (shape) return shape;
    const q = signedQuote(order, terms);
    const range = worldQuoteProblem(q);
    if (range) return range;
    if (q.expiry < now + BigInt(minQuoteSeconds)) return "The quote expires too soon to fill";
    if (this.spent.get(maker.wallet)?.has(q.nonce)) return "This nonce has already filled";
    const contract = q.nonce >= CONTRACT_NONCE_FLOOR ? quoteNonceMaker(q.nonce) : null;
    if (contract && contract !== maker.wallet) return "The nonce names another maker";
    return fillProblem(s, q, contract ?? maker.wallet, now, delegate);
  }

  /** Whether `signer` may sign for the quote's maker: the maker's own wallet, or for a world
   * vault a keeper its `onWorldFill` hook accepts now. */
  private signerProblem(
    s: WorldState,
    maker: MakerIdentity,
    q: WorldQuote,
    signer: Address,
    now: bigint,
  ): string | null {
    const contract = q.nonce >= CONTRACT_NONCE_FLOOR ? quoteNonceMaker(q.nonce) : null;
    if (!contract)
      return signer === maker.wallet ? null : "The quote is not signed by the maker's wallet";
    const v = s.vaults.get(contract);
    if (!v) return "The maker contract is not a world vault this API follows";
    return vaultHookProblem(s, v, q, signer, now);
  }

  /** Collects the standing quotes for `order` and awards the best that still fills on the
   * latest replica (null when no maker is online or none quoted). */
  async run(order: WorldOrder, delegate?: Address): Promise<WorldAuction | null> {
    const { hub, indexer, chainId, minQuoteSeconds } = this.options;
    if (!this.available(order.taker)) return null;
    const started = Date.now();
    const s = indexer.trading(),
      now = chainTime(s);
    const problem = this.orderProblem(s, order, now, delegate);
    if (problem) throw new Error(problem);
    const book = s.books.get(order.book)!;
    const id = randomUUID();
    const quotes = await hub.collect<WorldMakerQuote>({
      id,
      kind: "world",
      exclude: order.taker,
      request: worldRfqRequest({
        id,
        sentAt: started,
        windowMs: hub.options.windowMs,
        minQuoteSeconds,
        chainId,
        books: indexer.deployment.books,
        book,
        state: s,
        now,
        order,
      }),
      validate: (maker, terms) =>
        this.quoteProblem(
          indexer.trading(),
          order,
          maker,
          terms,
          chainTime(indexer.trading()),
          minQuoteSeconds,
          delegate,
        ),
    });
    this.options.log?.("info", "world.rfq.request", {
      rfq: id,
      book: order.book,
      side: order.side,
      quotes: quotes.length,
      ms: Date.now() - started,
    });
    const auction: WorldAuction = { id, order, quotes, award: null, dropped: new Map() };
    if (!quotes.length) return auction;
    // Ranked best first; each is checked again on the replica as it is now.
    const ranked = [...quotes].sort((a, b) =>
      better(order, a.terms, b.terms)
        ? -1
        : better(order, b.terms, a.terms)
          ? 1
          : a.arrival - b.arrival,
    );
    const latest = indexer.trading(),
      at = chainTime(latest);
    for (const q of ranked) {
      if (auction.award) {
        auction.dropped.set(q.maker.id, "Another maker quoted a better price");
        continue;
      }
      const reason = await this.quoteProblem(latest, order, q.maker, q.terms, at, 1, delegate);
      if (reason) auction.dropped.set(q.maker.id, reason);
      else
        auction.award = {
          maker: q.maker,
          quote: signedQuote(order, q.terms),
          signature: q.terms.signature,
        };
    }
    return auction;
  }

  /** What the taker pays (a buy) or receives (a sell) for the award, with the fee. */
  cost(auction: WorldAuction) {
    const q = auction.award?.quote;
    if (!q) return null;
    const b = this.options.indexer.trading().books.get(Number(q.book))!;
    const fee = worldFee(q.price, b.def.feeBps);
    return { price: q.price, fee, total: q.sell ? q.price - fee : q.price + fee };
  }

  /** Tells every maker that quoted what came of it. `transaction` is the fill's (null when it
   * never executed or failed). */
  settle(auction: WorldAuction, transaction: Hex | null) {
    const { hub } = this.options;
    for (const q of auction.quotes) {
      const won = auction.award?.maker.id === q.maker.id;
      if (won) hub.awarded(q.maker.id);
      if (won && transaction) this.spend(q.maker.wallet, q.terms.nonce);
      hub.notify(q.maker.id, {
        type: "world.result",
        rfqId: auction.id,
        outcome: !won ? "lost" : transaction ? "filled" : "unfilled",
        transaction: won ? transaction : null,
        price: q.terms.price.toString(),
        units: q.terms.units.toString(),
        reason: !won
          ? (auction.dropped.get(q.maker.id) ?? "Another maker quoted a better price")
          : transaction
            ? null
            : "The order did not fill this quote",
      });
    }
  }

  /** Watches an award the taker's own wallet sends: its maker hears when it fills, or that it
   * did not once it expired. */
  watch(auction: WorldAuction) {
    const award = auction.award;
    if (!award) return this.settle(auction, null);
    // Losing makers hear now.
    this.settle(
      { ...auction, quotes: auction.quotes.filter((q) => q.maker.id !== award.maker.id) },
      null,
    );
    const filler = quoteNonceMaker(award.quote.nonce) ?? award.maker.wallet;
    this.watching.set(`${filler}:${award.quote.nonce}`, {
      auction: { ...auction, quotes: auction.quotes.filter((q) => q.maker.id === award.maker.id) },
      until: Number(award.quote.expiry) * 1000 + WATCH_GRACE_MS,
    });
    this.sweep ??= setInterval(() => {
      const now = Date.now();
      for (const [key, w] of this.watching)
        if (w.until <= now) {
          this.watching.delete(key);
          this.settle(w.auction, null);
        }
    }, 10_000);
    this.sweep.unref?.();
  }

  private filled(fill: WorldFillRow) {
    const key = `${getAddress(fill.maker)}:${fill.nonce}`;
    const w = this.watching.get(key);
    if (!w) return;
    this.watching.delete(key);
    this.settle(w.auction, fill.tx as Hex);
  }

  /** Remembers a nonce that filled, so a quote reusing it is refused on arrival. */
  spend(maker: Address, nonce: bigint) {
    const nonces = this.spent.get(maker) ?? new Set<bigint>();
    nonces.add(nonce);
    if (nonces.size > SPENT_PER_MAKER) nonces.delete(nonces.values().next().value!);
    this.spent.set(maker, nonces);
  }
}
