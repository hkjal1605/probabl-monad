/** The transactions an approved world evidence packet authorizes, built from the packet alone,
 * as `admin.ts` does for the exchange: the API previews them and the automation rebuilds them
 * locally, and signs only when both agree. Each packet's hash is the evidence it cites on chain. */
import type {
  BookCreationEvidencePacket,
  WorldEvidenceEnvelope,
} from "@conditional-stocks/market-data";
import { type Address, getAddress, type Hex, zeroAddress, zeroHash } from "viem";
import { underlyingId } from "./identity.ts";
import { metadataHash } from "./protocol.ts";
import type { Envelope } from "./transactions.ts";
import {
  type BookDef,
  eventOracleCalls,
  eventResolutionHash,
  fixHash,
  worldBooksCalls,
} from "./worlds.ts";

export type WorldAdminAction =
  | "create-book"
  | "commit-event"
  | "resolve-event"
  | "commit-fix"
  | "resolve-fix";
export interface WorldAdminTransaction extends Envelope {
  chainId: number;
  /** The role key that signs it. */
  from: Address;
  action: WorldAdminAction;
}
export interface WorldAdminDeployment {
  chainId: number;
  books: Address;
  oracle: Address;
  /** `WorldBooks` roles. */
  bookAdmin: Address;
  booksResolutionAdmin: Address;
  /** `EventOracle` roles. */
  marketAdmin: Address;
  oracleResolutionAdmin: Address;
  /** Where book packets are served; a book's metadata URI is `worldMetadataUri(base, hash)`. */
  metadataBase: string;
}

/** The metadata URI of a book created from packet `packetHash`. */
export function worldMetadataUri(base: string, packetHash: Hex) {
  const url = new URL(base);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("World metadata is served over HTTPS");
  return `${url.origin}${url.pathname.replace(/\/$/, "")}/v2/books/packets/${packetHash.toLowerCase()}`;
}

/** The definition a book-creation packet describes, with its metadata URI. */
export function bookDefOf(p: BookCreationEvidencePacket, metadataUri: string): BookDef {
  const eventOnly = getAddress(p.book.feed) === zeroAddress;
  return {
    legs: p.legs.map((l) => ({ eventKey: l.eventKey, wantYes: l.wantYes })),
    feed: getAddress(p.book.feed),
    underlying: eventOnly || !p.book.underlying ? zeroHash : underlyingId(p.book.underlying),
    fixingTime: Number(p.book.fixingTime),
    maxStaleness: Number(p.book.maxStaleness),
    strikes: p.book.strikes.map(BigInt),
    cutoff: Number(p.book.cutoff),
    feeBps: Number(p.book.feeBps),
    metadataHash: metadataHash(metadataUri),
  };
}

/** The transaction `action` of an approved packet. Event resolutions and fallback fixings
 * cite the packet's hash as their evidence and its `sourceReference` as their URI. */
export function worldEvidenceTransaction(
  envelope: WorldEvidenceEnvelope,
  action: WorldAdminAction,
  d: WorldAdminDeployment,
  book?: bigint,
): WorldAdminTransaction {
  const p = envelope.packet,
    hash = envelope.packetHash;
  if (
    BigInt(p.deployment.chainId) !== BigInt(d.chainId) ||
    getAddress(p.deployment.books) !== getAddress(d.books) ||
    getAddress(p.deployment.oracle) !== getAddress(d.oracle)
  )
    throw new Error("The packet authorizes another world deployment");
  const books = worldBooksCalls(d.books),
    oracle = eventOracleCalls(d.oracle);
  const as = (from: Address, envelope: Envelope): WorldAdminTransaction => ({
    ...envelope,
    chainId: d.chainId,
    from: getAddress(from),
    action,
  });
  switch (action) {
    case "create-book":
      if (p.kind !== "book-creation") break;
      return as(
        d.bookAdmin,
        books.createBook(
          bookDefOf(p, worldMetadataUri(d.metadataBase, hash)),
          worldMetadataUri(d.metadataBase, hash),
        ),
      );
    case "commit-event":
    case "resolve-event": {
      if (p.kind !== "event-resolution") break;
      const key = p.event.eventKey;
      return action === "commit-event"
        ? as(
            d.marketAdmin,
            oracle.commit(
              key,
              eventResolutionHash(d.chainId, d.oracle, key, p.outcome, hash, p.sourceReference),
            ),
          )
        : as(d.oracleResolutionAdmin, oracle.resolve(key, p.outcome, hash, p.sourceReference));
    }
    case "commit-fix":
    case "resolve-fix": {
      if (p.kind !== "book-fixing") break;
      const id = BigInt(p.book.id);
      if (book !== undefined && book !== id) throw new Error("The packet fixes another book");
      const price = BigInt(p.price);
      return action === "commit-fix"
        ? as(
            d.bookAdmin,
            books.commitFix(id, fixHash(d.chainId, d.books, id, price, hash, p.sourceReference)),
          )
        : as(d.booksResolutionAdmin, books.resolveFix(id, price, hash, p.sourceReference));
    }
  }
  throw new Error(`A ${p.kind} packet does not authorize ${action}`);
}
