/** World orders the API fills for a wallet through its grant to the trading delegate
 * (`fillQuoteFor`): the quote a taker chose on its open request (`execute`), or the best quote
 * of a short auction (`submit`); and the owner-signed path, where the API runs the auction and
 * the wallet sends the winning quote itself (`fillQuote`).
 *
 * A delegated fill is journaled before broadcast (`world_submissions`, the exact signed bytes),
 * idempotent by the client's request id, and within a daily count per wallet. It shares the
 * delegate's nonce lock with the exchange's delegated orders. */
import { createHash } from "node:crypto";
import type { Database, Queries } from "@conditional-stocks/db";
import {
  address,
  U128_MAX,
  unsigned,
  type WorldQuote,
  worldBooksCalls,
  worldErrorMessage,
} from "@conditional-stocks/evm-client";
import type { WorldIndexer } from "@conditional-stocks/indexer/worlds";
import { type Address, getAddress, type Hex, keccak256, type PublicClient } from "viem";
import type { WorldOrder } from "../rfq/world-protocol.ts";
import { nonceLock, type TradingSigner } from "../trading/delegated.ts";
import type { WorldAuction, WorldDesk } from "./desk.ts";
import type { WorldRfqs } from "./rfqs.ts";

const DAILY_LIMIT = 500;
const json = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

/** A world order from a request body, for `taker`. */
export function parseWorldOrder(value: unknown, taker: Address): WorldOrder {
  const o = (value ?? {}) as Record<string, unknown>;
  if (!Number.isSafeInteger(o.book) || (o.book as number) <= 0) throw new Error("Invalid book");
  if (!Number.isInteger(o.mask) || (o.mask as number) <= 0 || (o.mask as number) > 0xffff)
    throw new Error("Invalid atom mask");
  if (o.side !== "buy" && o.side !== "sell") throw new Error("side is buy or sell");
  const stake = o.stake === undefined || o.stake === null ? null : unsigned(o.stake, U128_MAX);
  const units = o.units === undefined || o.units === null ? null : unsigned(o.units, U128_MAX);
  if ((stake === null) === (units === null)) throw new Error("Give either units or a stake");
  if (stake !== null && (o.side !== "buy" || stake === 0n)) throw new Error("A stake buys");
  if (units !== null && units === 0n && (o.refund === undefined || o.refund === "0"))
    throw new Error("An empty bundle");
  return {
    taker: address(taker),
    book: o.book as number,
    mask: o.mask as number,
    side: o.side,
    units,
    refund: units === null ? 0n : unsigned(o.refund ?? "0", U128_MAX),
    stake,
    conditional: stake !== null && o.conditional === true,
    limit: unsigned(o.limit ?? "0", U128_MAX),
  };
}

/** What a submission's RFQ came to, for the app. */
export const auctionSummary = (auction: WorldAuction) => ({
  id: auction.id,
  quotes: auction.quotes.length,
  award: auction.award
    ? {
        maker: auction.award.maker.label,
        units: auction.award.quote.units.toString(),
        refund: auction.award.quote.refund.toString(),
        price: auction.award.quote.price.toString(),
        expiry: auction.award.quote.expiry.toString(),
      }
    : null,
});

export class WorldTrading {
  private readonly nonce: ReturnType<typeof nonceLock>;

  constructor(
    private readonly options: {
      indexer: WorldIndexer;
      desk: WorldDesk;
      db: Database;
      client: PublicClient;
      signer: TradingSigner;
      /** The open requests, whose chosen quotes `execute` fills. */
      rfqs?: WorldRfqs;
    },
  ) {
    this.nonce = nonceLock(options.signer.address);
  }

  /** Fills `order` for `owner` through its grant: RFQ, then `fillQuoteFor` by the delegate.
   * Retrying the same `clientId` never creates a second transaction. */
  async submit(owner: Address, order: WorldOrder, clientId: string) {
    const { db, indexer, desk, signer } = this.options;
    if (!CLIENT_ID.test(clientId)) throw new Error("Invalid client request id");
    if (order.taker !== owner)
      throw new Error("The order's taker differs from the signed-in wallet");
    const termsHash = createHash("sha256").update(json(order)).digest("hex");
    let auction: WorldAuction | null = null;
    const journaled = await db.worldSubmission(indexer.domain, owner, clientId);
    if (!journaled) {
      auction = await desk.run(order, signer.address);
      if (!auction) throw new Error("No world maker is online to quote this order");
      if (!auction.award)
        throw new Error(
          auction.quotes.length
            ? "No quote still fills this order. Try again."
            : "No maker quoted this order. Try a smaller size or another price.",
        );
    }
    let transaction: Hex | null = null;
    try {
      const sent = await this.send(owner, clientId, termsHash, auction?.award ?? null);
      transaction = await this.confirm(sent);
      return {
        transactionHash: transaction,
        ...(auction ? { rfq: auctionSummary(auction) } : {}),
      };
    } finally {
      if (auction) desk.settle(auction, transaction);
    }
  }

  /** Fills the quote `owner` chose on its open request through its grant. The request stays
   * open if the fill does not execute, and closes as filled when it does. Retrying the same
   * `clientId` never creates a second transaction, and a request fills once: while a choice
   * is being filled it takes no other. */
  async execute(owner: Address, rfqId: string, quoteId: string, clientId: string) {
    const { db, indexer, rfqs } = this.options;
    if (!rfqs) throw new Error("Requests for quotes are unavailable");
    if (!CLIENT_ID.test(clientId)) throw new Error("Invalid client request id");
    const domain = indexer.domain;
    const termsHash = createHash("sha256")
      .update(json({ rfq: rfqId, quote: quoteId }))
      .digest("hex");
    // A retry is answered from the journal, whatever became of the request since.
    const journaled = await db.worldSubmission(domain, owner, clientId);
    if (journaled) {
      const transaction = await this.confirm(await this.send(owner, clientId, termsHash, null));
      const rfq = rfqs.get(owner, rfqId);
      if (rfq?.status === "open" && rfq.chosen?.tx === transaction) rfqs.filled(rfq, transaction);
      return { transactionHash: transaction, ...(rfq ? { rfq: rfqs.view(rfq) } : {}) };
    }
    const chosen = rfqs.choose(owner, rfqId, quoteId);
    // biome-ignore lint/style/noNonNullAssertion: `choose` found it open.
    const rfq = rfqs.get(owner, rfqId)!;
    let sent: Awaited<ReturnType<WorldTrading["send"]>>;
    try {
      sent = await this.send(
        owner,
        clientId,
        termsHash,
        rfqs.fillOf(rfq, chosen),
        async (q, tx) => {
          const kept = await q.journalWorldRfqFill(domain, rfqId, {
            maker: chosen.maker.id,
            makerLabel: chosen.maker.label,
            units: chosen.terms.units,
            refund: chosen.terms.refund,
            price: chosen.terms.price,
            tx,
          });
          if (!kept) throw new Error("This request is no longer open");
          rfqs.journaled(rfq, tx);
        },
      );
    } catch (error) {
      // Before the journal nothing was sent: the request takes another choice. After it the
      // transaction may be out (the journal's commit failed late): it stays in flight until
      // the fill shows on chain or its quote has expired.
      if (!rfq.chosen?.tx) rfqs.unchoose(rfq, null);
      throw error;
    }
    let transaction: Hex;
    try {
      transaction = await this.confirm(sent);
    } catch (error) {
      // Reverted: the choice is undone. Unknown (no receipt in time): it stays in flight until
      // the fill shows on chain or its quote has expired.
      if (error instanceof FillReverted) rfqs.unchoose(rfq, sent.tx_hash as Hex);
      throw error;
    }
    rfqs.filled(rfq, transaction);
    return { transactionHash: transaction, rfq: rfqs.view(rfq) };
  }

  /** The journaled submission of `clientId`, or `award` signed, journaled and broadcast now
   * (within `owner`'s lock; `journal` writes in the journal's own transaction, before the
   * broadcast). */
  private async send(
    owner: Address,
    clientId: string,
    termsHash: string,
    award: { quote: WorldQuote; signature: Hex } | null,
    journal?: (q: Queries, tx: Hex) => Promise<void>,
  ) {
    const { db, indexer, client, signer } = this.options;
    const domain = indexer.domain;
    return db.locked(`world-delegated:${domain}:${owner}`, async (q) => {
      const existing = await q.worldSubmission(domain, owner, clientId);
      if (existing) {
        if (existing.terms_hash !== termsHash || getAddress(existing.delegate) !== signer.address)
          throw new Error("Delegated submission identity mismatch");
        return existing;
      }
      if (!award) throw new Error("The order's quote is no longer available");
      if ((await q.worldSubmissionCount(domain, owner)) >= DAILY_LIMIT)
        throw new Error("Daily delegated order limit reached");
      const envelope = worldBooksCalls(indexer.deployment.books).fillQuoteFor(
        award.quote,
        award.signature,
      );
      try {
        await client.call({ account: signer.address, to: envelope.to, data: envelope.data });
      } catch (error) {
        throw new Error(worldErrorMessage(error, "The fill would not execute now."));
      }
      return this.nonce.run(async () => {
        const request = await client.prepareTransactionRequest({
          account: signer,
          chain: client.chain,
          to: envelope.to,
          data: envelope.data,
        });
        const raw = await signer.signTransaction(request as never);
        const hash = keccak256(raw);
        await q.recordWorldSubmission(
          domain,
          owner,
          clientId,
          termsHash,
          signer.address,
          hash,
          raw,
        );
        await journal?.(q, hash);
        await client.sendRawTransaction({ serializedTransaction: raw }).catch(() => {
          // Journaled: an ambiguous send is resolved by the receipt below or a retry.
        });
        return { terms_hash: termsHash, delegate: signer.address, tx_hash: hash, raw };
      });
    });
  }

  /** Waits for a journaled submission's receipt (sending it again when the node does not know
   * it) and, once it succeeded, for the world view to reach its block, so a read right after
   * the answer shows the position. Throws `FillReverted` when it did not execute. */
  private async confirm(submission: { tx_hash: string; raw: string }) {
    const { client, indexer } = this.options;
    const hash = submission.tx_hash as Hex;
    let receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
    if (!receipt) {
      await client
        .sendRawTransaction({ serializedTransaction: submission.raw as Hex })
        .catch(() => {});
      receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    }
    if (receipt.status !== "success") throw new FillReverted();
    indexer.follower.poke();
    await indexer.follower.reached(receipt.blockNumber, 10_000).catch(() => {});
    return hash;
  }
}

const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;
/** A fill's transaction was mined and reverted: its quote no longer filled. */
export class FillReverted extends Error {
  constructor() {
    super("The fill did not execute: the quote no longer filled. Ask again.");
  }
}
