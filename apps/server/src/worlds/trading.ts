/** World orders the API fills for a wallet through its grant to the trading delegate
 * (`fillQuoteFor`), and the owner-signed path, where the API runs the RFQ and the wallet sends
 * the winning quote itself (`fillQuote`).
 *
 * A delegated fill is journaled before broadcast (`world_submissions`, the exact signed bytes),
 * idempotent by the client's request id, and within a daily count per wallet. It shares the
 * delegate's nonce lock with the exchange's delegated orders. */
import { createHash } from "node:crypto";
import type { Database } from "@conditional-stocks/db";
import {
  address,
  U128_MAX,
  unsigned,
  worldBooksCalls,
  worldErrorMessage,
} from "@conditional-stocks/evm-client";
import type { WorldIndexer } from "@conditional-stocks/indexer/worlds";
import { type Address, getAddress, type Hex, keccak256, type PublicClient } from "viem";
import type { WorldOrder } from "../rfq/world-protocol.ts";
import { nonceLock, type TradingSigner } from "../trading/delegated.ts";
import type { WorldAuction, WorldDesk } from "./desk.ts";

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
    },
  ) {
    this.nonce = nonceLock(options.signer.address);
  }

  /** Fills `order` for `owner` through its grant: RFQ, then `fillQuoteFor` by the delegate.
   * Retrying the same `clientId` never creates a second transaction. */
  async submit(owner: Address, order: WorldOrder, clientId: string) {
    const { db, indexer, desk, client, signer } = this.options;
    if (!/^[A-Za-z0-9-]{8,64}$/.test(clientId)) throw new Error("Invalid client request id");
    if (order.taker !== owner)
      throw new Error("The order's taker differs from the signed-in wallet");
    const domain = indexer.domain;
    const termsHash = createHash("sha256").update(json(order)).digest("hex");
    let auction: WorldAuction | null = null;
    const journaled = await db.worldSubmission(domain, owner, clientId);
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
      const submission = await db.locked(`world-delegated:${domain}:${owner}`, async (q) => {
        const existing = await q.worldSubmission(domain, owner, clientId);
        if (existing) {
          if (existing.terms_hash !== termsHash || getAddress(existing.delegate) !== signer.address)
            throw new Error("Delegated submission identity mismatch");
          return existing;
        }
        if (!auction?.award) throw new Error("The order's quote is no longer available");
        if ((await q.worldSubmissionCount(domain, owner)) >= DAILY_LIMIT)
          throw new Error("Daily delegated order limit reached");
        const envelope = worldBooksCalls(indexer.deployment.books).fillQuoteFor(
          auction.award.quote,
          auction.award.signature,
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
          await client.sendRawTransaction({ serializedTransaction: raw }).catch(() => {
            // Journaled: an ambiguous send is resolved by the receipt below or a retry.
          });
          return { terms_hash: termsHash, delegate: signer.address, tx_hash: hash, raw };
        });
      });
      const hash = submission.tx_hash as Hex;
      let receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
      if (!receipt) {
        await client
          .sendRawTransaction({ serializedTransaction: submission.raw as Hex })
          .catch(() => {});
        receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
      }
      if (receipt.status !== "success")
        throw new Error("The fill did not execute: the quote no longer filled. Ask again.");
      transaction = hash;
      // The world view reaches the fill's block before the answer, so a read right after it
      // shows the position.
      indexer.follower.poke();
      await indexer.follower.reached(receipt.blockNumber, 10_000).catch(() => {});
      return {
        transactionHash: hash,
        ...(auction ? { rfq: auctionSummary(auction) } : {}),
      };
    } finally {
      if (auction) desk.settle(auction, transaction);
    }
  }
}
