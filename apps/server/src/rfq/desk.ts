/** Runs the RFQ for a market order.
 *
 * 1. The order goes to every approved maker online. Each quote is checked as it arrives,
 *    signature included (the signer must be the maker's approved wallet).
 * 2. After the window, or once every maker has answered, each submission attempt ranks the book
 *    and the quotes together and awards each quote what it beats the book for. The taker's one
 *    placement carries the awards (`placeWithQuotes`), and the exchange fills them first, from
 *    the makers' balances, then the book's orders.
 * 3. After the transaction, each maker hears what it filled.
 *
 * With no maker online nothing here runs: no timer, no read, no call. Quotes add no RPC call
 * either: they are checked against the replica and settle in the taker's own transaction. */
import { randomUUID } from "node:crypto";
import { type OrderWire, quoteNonceMaker } from "@conditional-stocks/evm-client";
import type { IndexerService } from "@conditional-stocks/indexer";
import { type Address, type Hex, type PublicClient, parseAbi, type TransactionReceipt } from "viem";
import { bookCandidates, type OrderPlanner } from "../trading/plan.ts";
import {
  quoteDigest,
  quotedPlan,
  quoteFill,
  quoteFills,
  quoteProblem,
  quoteSigner,
  selectQuotes,
  topOfBook,
} from "./auction.ts";
import type { CollectedQuote, RfqHub } from "./hub.ts";
import { rfqRequest } from "./protocol.ts";

export interface Auction {
  id: string;
  order: OrderWire;
  quotes: CollectedQuote[];
  /** What the latest plan awarded each quoting maker (by maker id). */
  awarded: Map<string, bigint>;
  /** Why a quote lost its award when the plan was made (by maker id). */
  dropped: Map<string, string>;
}

/** Nonces kept per maker as spent, so a reused one is refused before it can only be skipped. */
const SPENT_PER_MAKER = 4_096;
/** How long a maker contract's word on a signer (ERC-1271) is trusted before it is asked again. */
const SIGNER_TTL_MS = 5 * 60_000;
const erc1271 = parseAbi([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);
const seconds = () => BigInt(Math.floor(Date.now() / 1000));
const min = (a: bigint, b: bigint) => (a < b ? a : b);

export class RfqDesk {
  private readonly spent = new Map<Address, Set<bigint>>();
  /** Signers maker contracts vouched for (ERC-1271), by `${maker}:${signer}`. */
  private readonly vouched = new Map<string, { ok: boolean; until: number }>();

  constructor(
    private readonly options: {
      hub: RfqHub;
      indexer: IndexerService;
      /** Reads a maker contract's signer check (ERC-1271), once per signer and TTL. */
      client?: PublicClient;
      chainId: number;
      prepare: OrderPlanner;
      /** The least lifetime a quote must have left when it arrives. */
      minQuoteSeconds: number;
      log?: (level: "info" | "warn", event: string, fields: Record<string, unknown>) => void;
    },
  ) {}

  /** Whether `order` goes out for quotes: a market (immediate-or-cancel) order, with a maker
   * other than its owner online. */
  wants(order: OrderWire) {
    return order.tif === 1 && this.options.hub.makers(order.maker) > 0;
  }

  /** Collects the quotes for `order` that stand (null when none does). */
  async run(order: OrderWire): Promise<Auction | null> {
    const { hub, indexer, chainId, minQuoteSeconds } = this.options;
    const started = Date.now();
    const s = indexer.trading();
    const m = s.markets.get(Number(order.marketId));
    if (!m) return null;
    const id = randomUUID();
    const size = BigInt(order.quantity);
    const exchange = indexer.options.exchange;
    const quotes = await hub.collect({
      id,
      exclude: order.maker,
      request: rfqRequest({
        id,
        sentAt: started,
        windowMs: hub.options.windowMs,
        minQuoteSeconds,
        chainId,
        exchange,
        market: m,
        quoteToken: s.quote,
        quoteDecimals: s.pools.get(s.quote)?.decimals ?? null,
        baseDecimals: s.pools.get(m.base)?.decimals ?? null,
        order,
        book: topOfBook(s, m, order.branch, seconds()),
      }),
      validate: async (maker, q) => {
        // A quote is for up to its quantity: more than the order is capped at the order's size.
        const problem = quoteProblem({
          state: s,
          market: m,
          taker: order,
          maker: maker.wallet,
          quote: q,
          quantity: min(q.quantity, size),
          now: seconds(),
          minQuoteSeconds,
        });
        if (problem) return problem;
        if (this.spent.get(maker.wallet)?.has(q.nonce)) return "This nonce has already filled";
        const signer = await quoteSigner(chainId, exchange, m, order, q);
        // A nonce naming a contract (a Δ-vault) makes it the maker: it says who signs for it.
        const contract = quoteNonceMaker(q.nonce);
        if (!contract)
          return signer === maker.wallet ? null : "The quote is not signed by the maker's wallet";
        if (contract !== maker.wallet) return "The nonce names another maker";
        if (!signer) return "Malformed signature";
        const digest = quoteDigest(chainId, exchange, m, order, q);
        return (await this.vouches(contract, signer, digest, q.signature))
          ? null
          : "The maker contract does not accept this signer";
      },
    });
    this.options.log?.("info", "rfq.request", {
      rfq: id,
      market: order.marketId,
      quotes: quotes.length,
      ms: Date.now() - started,
    });
    if (!quotes.length) return null;
    return { id, order, quotes, awarded: new Map(), dropped: new Map() };
  }

  /** The plan of `order` now, with the planner's checks: the book's orders from the replica and
   * the auction's quotes, each awarded what it wins. */
  plan(order: OrderWire, auction: Auction) {
    const { indexer, prepare } = this.options;
    const s = indexer.trading();
    const prepared = prepare(order, s);
    const m = s.markets.get(Number(order.marketId))!;
    const now = seconds();
    const selection = selectQuotes({
      taker: order,
      candidates: bookCandidates(s, m, order, now),
      quotes: auction.quotes.map((q) => ({ source: q, terms: q.terms, maker: q.maker.wallet })),
      nextSequence: m.seq[order.branch]!,
      now,
      step: m.step,
      makerFeeBps: m.makerBps,
      takerFeeBps: m.takerBps,
      viable: (q, quantity) =>
        quoteProblem({
          state: s,
          market: m,
          taker: order,
          maker: q.maker,
          quote: q.terms,
          quantity,
          now,
          minQuoteSeconds: 1,
        }),
    });
    auction.awarded = new Map(selection.awards.map((a) => [a.quote.source.maker.id, a.quantity]));
    auction.dropped = new Map(selection.dropped.map((d) => [d.quote.source.maker.id, d.reason]));
    if (!selection.awards.length) return prepared;
    return {
      ...prepared,
      plan: quotedPlan(
        selection.plan,
        m.seq[order.branch]!,
        selection.awards.map((a) => quoteFill(m, order, a.quote.terms, a.quantity)),
      ),
    };
  }

  /** Tells every maker that quoted what it filled. `receipt` is the taker's transaction, or
   * null when it never executed. */
  settle(auction: Auction, receipt: TransactionReceipt | null) {
    const { hub, indexer } = this.options;
    const fills =
      receipt?.status === "success"
        ? quoteFills(receipt.logs, indexer.options.exchange)
        : new Map<Address, bigint>();
    for (const q of auction.quotes) {
      const awarded = auction.awarded.get(q.maker.id) ?? 0n;
      const filled = awarded ? (fills.get(q.maker.wallet) ?? 0n) : 0n;
      if (awarded) hub.awarded(q.maker.id);
      if (filled) this.spend(q.maker.wallet, q.terms.nonce);
      hub.notify(q.maker.id, {
        type: "rfq.result",
        rfqId: auction.id,
        outcome: !awarded
          ? "lost"
          : !filled
            ? "unfilled"
            : filled < awarded
              ? "partially_filled"
              : "filled",
        awarded: awarded.toString(),
        filled: filled.toString(),
        price: q.terms.price.toString(),
        transaction: receipt?.transactionHash ?? null,
        reason: !awarded
          ? (auction.dropped.get(q.maker.id) ??
            "Other quotes or resting orders filled the order at better prices")
          : !filled
            ? "The order did not take this quote (it failed, or the quote no longer filled)"
            : null,
      });
    }
  }

  /** Whether `maker` (a contract) accepts `signer`'s signatures, asking it at most once per TTL. */
  private async vouches(maker: Address, signer: Address, digest: Hex, signature: Hex) {
    const key = `${maker}:${signer}`;
    const known = this.vouched.get(key);
    if (known && known.until > Date.now()) return known.ok;
    const { client } = this.options;
    if (!client) return false;
    const ok = await client
      .readContract({
        address: maker,
        abi: erc1271,
        functionName: "isValidSignature",
        args: [digest, signature],
      })
      .then(
        (magic) => magic === "0x1626ba7e",
        () => false,
      );
    this.vouched.set(key, { ok, until: Date.now() + SIGNER_TTL_MS });
    return ok;
  }

  private spend(maker: Address, nonce: bigint) {
    const nonces = this.spent.get(maker) ?? new Set<bigint>();
    nonces.add(nonce);
    if (nonces.size > SPENT_PER_MAKER) nonces.delete(nonces.values().next().value!);
    this.spent.set(maker, nonces);
  }
}
