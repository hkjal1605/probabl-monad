/** Evidence packets of world books (docs/version-2-plan.md §10.1), under the same rules as the
 * exchange's: canonical JSON, content-addressed by `hashCanonical`, reviewed before any
 * transaction they authorize, and cited on chain by their hash.
 *
 * - `book-creation`: a curated book, each leg's venue event as fetched (snapshot and raw hash),
 *   the feed, fixing, strikes, cutoff and fee. The book's metadata URI names this packet.
 * - `event-resolution`: one event's final result on its venue, keyed by its oracle event key.
 *   The ½/½ payout of a voided venue market resolves the event INVALID.
 * - `book-fixing`: the fallback price of a book whose fixing cannot be proposed from its feed
 *   (a held proposal, or none by the deadline): the feed's rounds around the fixing and the
 *   observations behind the price. */
import { type Address, getAddress, isAddress } from "viem";
import {
  decimalInteger,
  type Hex,
  hashCanonical,
  isHex32,
  MarketDataError,
  object,
  requiredString,
} from "./canonical.ts";
import {
  type EventMarket,
  type EventSource,
  eventMarketId,
  noOutcome,
  yesOutcome,
} from "./event-market.ts";
import {
  type AttachmentReference,
  type PayoutVector,
  parseAttachments,
  payoutVector,
} from "./evidence.ts";

/** The world deployment a packet authorizes transactions for. */
export interface WorldEvidenceDeployment {
  chainId: string;
  books: Address;
  oracle: Address;
}
/** One leg of a book as fetched from its venue. */
export interface LegEvidence {
  eventKey: Hex;
  wantYes: boolean;
  source: EventSource;
  marketId: string;
  conditionId: Hex;
  yesIndex: "1" | "2";
  noIndex: "1" | "2";
  question: string;
  rules: string;
  endTime: string;
  canonicalUrl: string;
  resolutionSource: string;
  metadataSnapshotId: string;
  metadataRawHash: Hex;
  themes: string[];
}
export interface BookCreationEvidencePacket {
  kind: "book-creation";
  schemaVersion: 1;
  deployment: WorldEvidenceDeployment;
  title: string;
  legs: LegEvidence[];
  book: {
    /** Zero address for an event-only book. */
    feed: Address;
    /** e.g. "US:NVDA"; null for an event-only book. */
    underlying: string | null;
    feedDecimals: number | null;
    fixingTime: string;
    maxStaleness: string;
    /** Raw feed answers, ascending. */
    strikes: string[];
    cutoff: string;
    feeBps: string;
    /** The fixing rule as people read it. */
    fixingRule: string | null;
  };
  attachments: AttachmentReference[];
  preparedAt: string;
  preparer: Address;
}
export interface EventResolutionEvidencePacket {
  kind: "event-resolution";
  schemaVersion: 1;
  deployment: WorldEvidenceDeployment;
  event: {
    eventKey: Hex;
    source: EventSource;
    marketId: string;
    conditionId: Hex;
    yesIndex: string;
    noIndex: string;
  };
  official: {
    metadataRawHash: Hex;
    metadataSnapshotId: string;
    status: string;
    url: string;
  };
  payout: PayoutVector;
  /** YES (3), NO (4) or INVALID (5), as `EventOracle.resolve` takes it. */
  outcome: 3 | 4 | 5;
  polygon: {
    blockHash: Hex | null;
    blockNumber: string | null;
    chainId: "137";
    conditionalTokensAddress: Address;
    transactionHash: Hex | null;
  } | null;
  sourceObservations: { observedAt: string; payout: PayoutVector; status: string; url: string }[];
  sourceReference: string;
  attachments: AttachmentReference[];
  preparedAt: string;
  preparer: Address;
}
export interface BookFixingEvidencePacket {
  kind: "book-fixing";
  schemaVersion: 1;
  deployment: WorldEvidenceDeployment;
  book: { id: string; feed: Address; fixingTime: string; maxStaleness: string };
  /** The raw feed answer the book fixes at. */
  price: string;
  reason: string;
  /** The feed's rounds around the fixing time, as read. */
  rounds: { roundId: string; answer: string; updatedAt: string }[];
  sourceObservations: { observedAt: string; price: string; status: string; url: string }[];
  sourceReference: string;
  attachments: AttachmentReference[];
  preparedAt: string;
  preparer: Address;
}
export type WorldEvidencePacket =
  | BookCreationEvidencePacket
  | EventResolutionEvidencePacket
  | BookFixingEvidencePacket;
export interface WorldEvidenceEnvelope<T extends WorldEvidencePacket = WorldEvidencePacket> {
  packet: T;
  packetHash: Hex;
}

const invalid = (message: string, status = 400) =>
  new MarketDataError("INVALID_EVIDENCE", message, status);
const address = (value: unknown, name: string): Address => {
  if (typeof value !== "string" || !isAddress(value)) throw invalid(`${name} is not an address`);
  return getAddress(value);
};
const hex32 = (value: unknown, name: string): Hex => {
  if (!isHex32(value)) throw invalid(`${name} must be bytes32`);
  return value.toLowerCase() as Hex;
};
const isoTime = (value: unknown, name: string) => {
  const parsed = Date.parse(requiredString(value, name, 128));
  if (!Number.isFinite(parsed)) throw invalid(`${name} is invalid`);
  return new Date(parsed).toISOString();
};
const secureUrl = (value: unknown, name: string) => {
  const url = new URL(requiredString(value, name, 2_048));
  if (url.protocol !== "https:" && url.protocol !== "ipfs:")
    throw invalid(`${name} must use HTTPS or IPFS`);
  return url.toString();
};
const uriBytes = (uri: string) => new TextEncoder().encode(uri).length;

export const validateWorldDeployment = (value: unknown): WorldEvidenceDeployment => {
  const raw = object(value, "deployment");
  return {
    chainId: decimalInteger(raw.chainId, "deployment.chainId"),
    books: address(raw.books, "deployment.books"),
    oracle: address(raw.oracle, "deployment.oracle"),
  };
};

/** A leg as evidence, from a fresh venue snapshot of its event. The event key is the oracle's
 * `keccak256(abi.encode(condition, yesIndex, noIndex))`, computed by the caller. */
export function legEvidence(input: {
  metadata: EventMarket;
  metadataSnapshotId: string;
  metadataRawHash: Hex;
  eventKey: Hex;
  wantYes: boolean;
  themes?: string[];
}): LegEvidence {
  const m = input.metadata;
  if (!m.active || m.closed) throw invalid("Every leg must be an active, open venue market");
  const themes = [...new Set(input.themes ?? [])];
  if (themes.length > 8 || themes.some((t) => !/^[a-z0-9-]{1,32}$/.test(t)))
    throw invalid("themes are up to 8 lowercase slugs");
  return {
    eventKey: hex32(input.eventKey, "eventKey"),
    wantYes: input.wantYes === true,
    source: m.source,
    marketId: eventMarketId(m),
    conditionId: hex32(m.conditionId, "conditionId"),
    yesIndex: yesOutcome(m).indexSet,
    noIndex: noOutcome(m).indexSet,
    question: m.question,
    rules: m.rules,
    endTime: m.endTime,
    canonicalUrl: m.canonicalUrl,
    resolutionSource: m.resolutionSource,
    metadataSnapshotId: requiredString(input.metadataSnapshotId, "metadataSnapshotId", 256),
    metadataRawHash: hex32(input.metadataRawHash, "metadataRawHash"),
    themes,
  };
}

export function buildBookCreationEvidence(input: {
  deployment: WorldEvidenceDeployment;
  title: unknown;
  legs: LegEvidence[];
  book: unknown;
  attachments: unknown;
  preparedAt: string;
  preparer: Address;
}): WorldEvidenceEnvelope<BookCreationEvidencePacket> {
  const raw = object(input.book, "book");
  const feed = address(raw.feed, "book.feed");
  const eventOnly = BigInt(feed) === 0n;
  const strikes = Array.isArray(raw.strikes)
    ? raw.strikes.map((s, i) => decimalInteger(s, `book.strikes[${i}]`))
    : [];
  if (!input.legs.length || input.legs.length > 6) throw invalid("A world has 1 to 6 legs");
  if (new Set(input.legs.map((l) => l.eventKey)).size !== input.legs.length)
    throw invalid("Legs must be distinct events");
  const decimals =
    raw.feedDecimals === null || raw.feedDecimals === undefined ? null : raw.feedDecimals;
  if (
    decimals !== null &&
    (!Number.isInteger(decimals) || (decimals as number) < 0 || (decimals as number) > 18)
  )
    throw invalid("feedDecimals is 0 to 18");
  const packet: BookCreationEvidencePacket = {
    kind: "book-creation",
    schemaVersion: 1,
    deployment: validateWorldDeployment(input.deployment),
    title: requiredString(input.title, "title", 160),
    legs: input.legs,
    book: {
      feed,
      underlying: eventOnly ? null : requiredString(raw.underlying, "book.underlying", 32),
      feedDecimals: eventOnly ? null : (decimals as number | null),
      fixingTime: eventOnly ? "0" : decimalInteger(raw.fixingTime, "book.fixingTime"),
      maxStaleness: eventOnly ? "0" : decimalInteger(raw.maxStaleness, "book.maxStaleness"),
      strikes: eventOnly ? [] : strikes,
      cutoff: decimalInteger(raw.cutoff, "book.cutoff"),
      feeBps: decimalInteger(raw.feeBps, "book.feeBps", true),
      fixingRule:
        eventOnly || raw.fixingRule === undefined || raw.fixingRule === null
          ? null
          : requiredString(raw.fixingRule, "book.fixingRule", 256),
    },
    attachments: parseAttachments(input.attachments),
    preparedAt: isoTime(input.preparedAt, "preparedAt"),
    preparer: address(input.preparer, "preparer"),
  };
  if (!eventOnly && !packet.book.strikes.length) throw invalid("A priced book has strikes");
  for (let i = 1; i < packet.book.strikes.length; i++)
    if (BigInt(packet.book.strikes[i]!) <= BigInt(packet.book.strikes[i - 1]!))
      throw invalid("Strikes ascend");
  if (BigInt(packet.book.feeBps) > 1_000n) throw invalid("feeBps is at most 1,000");
  return { packet, packetHash: hashCanonical(packet) };
}

/** The oracle outcome of a venue payout: YES, NO, or INVALID for the ½/½ of a voided market. */
export const payoutOutcome = (payout: PayoutVector): 3 | 4 | 5 =>
  payout.denominator === "2" ? 5 : payout.yes === "1" ? 3 : 4;

export function buildEventResolutionEvidence(input: {
  deployment: WorldEvidenceDeployment;
  event: {
    eventKey: Hex;
    source: EventSource;
    marketId: string;
    conditionId: Hex;
    yesIndex: string;
    noIndex: string;
  };
  metadataRawHash: unknown;
  metadataSnapshotId: unknown;
  officialStatus: unknown;
  officialUrl: unknown;
  payout: unknown;
  polygon: unknown;
  sourceObservations: unknown;
  sourceReference: unknown;
  attachments: unknown;
  preparedAt: string;
  preparer: Address;
}): WorldEvidenceEnvelope<EventResolutionEvidencePacket> {
  const payout = payoutVector(input.payout);
  if (!Array.isArray(input.sourceObservations) || !input.sourceObservations.length)
    throw invalid("source observations are required");
  const observations = input.sourceObservations.map((item, i) => {
    const raw = object(item, `sourceObservations[${i}]`);
    return {
      observedAt: isoTime(raw.observedAt, `sourceObservations[${i}].observedAt`),
      payout: payoutVector(raw.payout),
      status: requiredString(raw.status, `sourceObservations[${i}].status`, 256),
      url: secureUrl(raw.url, `sourceObservations[${i}].url`),
    };
  });
  if (observations.some((o) => hashCanonical(o.payout) !== hashCanonical(payout)))
    throw new MarketDataError("CONFLICTING_EVIDENCE", "source observations disagree on payout");
  let polygon: EventResolutionEvidencePacket["polygon"] = null;
  if (input.event.source === "polymarket") {
    const raw = object(input.polygon, "polygon");
    if (raw.chainId !== "137") throw new MarketDataError("WRONG_NETWORK", "Polygon is chain 137");
    const optional = (v: unknown, name: string) =>
      v === undefined || v === null || v === "" ? null : hex32(v, name);
    polygon = {
      blockHash: optional(raw.blockHash, "polygon.blockHash"),
      blockNumber:
        raw.blockNumber === undefined || raw.blockNumber === null
          ? null
          : decimalInteger(raw.blockNumber, "polygon.blockNumber", true),
      chainId: "137",
      conditionalTokensAddress: address(
        raw.conditionalTokensAddress,
        "polygon.conditionalTokensAddress",
      ),
      transactionHash: optional(raw.transactionHash, "polygon.transactionHash"),
    };
  } else if (input.polygon !== undefined && input.polygon !== null)
    throw invalid("Kalshi settles off chain: no Polygon record");
  const sourceReference = secureUrl(input.sourceReference, "sourceReference");
  if (uriBytes(sourceReference) > 512) throw invalid("sourceReference exceeds the on-chain limit");
  const packet: EventResolutionEvidencePacket = {
    kind: "event-resolution",
    schemaVersion: 1,
    deployment: validateWorldDeployment(input.deployment),
    event: {
      eventKey: hex32(input.event.eventKey, "event.eventKey"),
      source: input.event.source,
      marketId: requiredString(input.event.marketId, "event.marketId", 256),
      conditionId: hex32(input.event.conditionId, "event.conditionId"),
      yesIndex: decimalInteger(input.event.yesIndex, "event.yesIndex"),
      noIndex: decimalInteger(input.event.noIndex, "event.noIndex"),
    },
    official: {
      metadataRawHash: hex32(input.metadataRawHash, "metadataRawHash"),
      metadataSnapshotId: requiredString(input.metadataSnapshotId, "metadataSnapshotId", 256),
      status: requiredString(input.officialStatus, "officialStatus", 256),
      url: secureUrl(input.officialUrl, "officialUrl"),
    },
    payout,
    outcome: payoutOutcome(payout),
    polygon,
    sourceObservations: observations,
    sourceReference,
    attachments: parseAttachments(input.attachments),
    preparedAt: isoTime(input.preparedAt, "preparedAt"),
    preparer: address(input.preparer, "preparer"),
  };
  return { packet, packetHash: hashCanonical(packet) };
}

export function buildBookFixingEvidence(input: {
  deployment: WorldEvidenceDeployment;
  book: { id: string; feed: Address; fixingTime: string; maxStaleness: string };
  price: unknown;
  reason: unknown;
  rounds: unknown;
  sourceObservations: unknown;
  sourceReference: unknown;
  attachments: unknown;
  preparedAt: string;
  preparer: Address;
}): WorldEvidenceEnvelope<BookFixingEvidencePacket> {
  const price = decimalInteger(input.price, "price");
  if (BigInt(price) >= 1n << 128n) throw invalid("price fits 128 bits");
  if (!Array.isArray(input.rounds) || input.rounds.length > 16)
    throw invalid("rounds lists up to 16");
  const rounds = input.rounds.map((r, i) => {
    const raw = object(r, `rounds[${i}]`);
    return {
      roundId: decimalInteger(raw.roundId, `rounds[${i}].roundId`),
      answer: decimalInteger(raw.answer, `rounds[${i}].answer`, true),
      updatedAt: decimalInteger(raw.updatedAt, `rounds[${i}].updatedAt`, true),
    };
  });
  if (!Array.isArray(input.sourceObservations) || !input.sourceObservations.length)
    throw invalid("source observations are required");
  const observations = input.sourceObservations.map((item, i) => {
    const raw = object(item, `sourceObservations[${i}]`);
    return {
      observedAt: isoTime(raw.observedAt, `sourceObservations[${i}].observedAt`),
      price: decimalInteger(raw.price, `sourceObservations[${i}].price`),
      status: requiredString(raw.status, `sourceObservations[${i}].status`, 256),
      url: secureUrl(raw.url, `sourceObservations[${i}].url`),
    };
  });
  if (observations.some((o) => o.price !== price))
    throw new MarketDataError("CONFLICTING_EVIDENCE", "source observations disagree on the price");
  const sourceReference = secureUrl(input.sourceReference, "sourceReference");
  if (uriBytes(sourceReference) > 512) throw invalid("sourceReference exceeds the on-chain limit");
  const packet: BookFixingEvidencePacket = {
    kind: "book-fixing",
    schemaVersion: 1,
    deployment: validateWorldDeployment(input.deployment),
    book: {
      id: decimalInteger(input.book.id, "book.id"),
      feed: address(input.book.feed, "book.feed"),
      fixingTime: decimalInteger(input.book.fixingTime, "book.fixingTime"),
      maxStaleness: decimalInteger(input.book.maxStaleness, "book.maxStaleness"),
    },
    price,
    reason: requiredString(input.reason, "reason", 1_024),
    rounds,
    sourceObservations: observations,
    sourceReference,
    attachments: parseAttachments(input.attachments),
    preparedAt: isoTime(input.preparedAt, "preparedAt"),
    preparer: address(input.preparer, "preparer"),
  };
  return { packet, packetHash: hashCanonical(packet) };
}

/** Throws unless the envelope is a supported world packet whose hash matches its content. */
export function assertWorldEvidenceIntegrity(envelope: WorldEvidenceEnvelope) {
  const p = envelope.packet;
  if (
    !["book-creation", "event-resolution", "book-fixing"].includes(p.kind) ||
    p.schemaVersion !== 1
  )
    throw invalid("Unsupported evidence schema cannot authorize a transaction", 409);
  validateWorldDeployment(p.deployment);
  if (p.kind === "event-resolution" && payoutOutcome(payoutVector(p.payout)) !== p.outcome)
    throw invalid("The outcome differs from the payout", 409);
  if (hashCanonical(p) !== envelope.packetHash)
    throw new MarketDataError(
      "TAMPERED_EVIDENCE",
      "packet hash does not match packet contents",
      409,
    );
}
