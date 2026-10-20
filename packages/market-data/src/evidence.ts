import { type Address, getAddress, isAddress, keccak256, toBytes } from "viem";

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
  type EventOutcome,
  type EventSource,
  eventMarketId,
  noOutcome,
  yesOutcome,
} from "./event-market.ts";

export interface AttachmentReference {
  byteLength: string;
  contentHash: Hex;
  filename: string;
  mediaType: string;
  uri: string;
}

/** The one exchange contract (and chain) a packet can authorize transactions for. */
export interface EvidenceDeployment {
  chainId: string;
  exchange: Address;
}

export interface MarketConfigEvidence {
  /** Order step in raw base-token units. */
  baseStep: string;
  baseToken: Address;
  /** Fee rate of resting orders, in bps of what they receive (0 to `MAX_FEE_BPS`). */
  makerFeeBps: string;
  maxMarketOpenNotional: string;
  maxOrderNotional: string;
  maxOrderQuantity: string;
  maxWalletOpenNotional: string;
  metadataHash: Hex;
  metadataUri: string;
  minNotional: string;
  /** The event market's on-chain id and the index sets of its YES and NO outcomes. */
  eventConditionId: Hex;
  eventNoIndex: string;
  eventYesIndex: string;
  priceTickRawX18: string;
  quoteToken: Address;
  rulesHash: Hex;
  /** Fee rate of orders that fill on arrival, in bps of what they receive. */
  takerFeeBps: string;
  tradingCutoff: string;
  tradingOpen: string;
}

/** The venue market whose YES/NO question a local market trades on, as fetched. */
export interface EventEvidence {
  source: EventSource;
  /** The venue's id: Polymarket's Gamma market id, or the Kalshi ticker. */
  marketId: string;
  canonicalUrl: string;
  conditionId: Hex;
  endTime: string;
  metadataRawHash: Hex;
  metadataSnapshotId: string;
  no: EventOutcome;
  question: string;
  resolutionSource: string;
  rules: string;
  yes: EventOutcome;
}

export interface CreationEvidencePacket {
  deployment: EvidenceDeployment;
  attachments: AttachmentReference[];
  config: MarketConfigEvidence;
  event: EventEvidence;
  kind: "market-creation";
  preparedAt: string;
  preparer: Address;
  schemaVersion: 7;
  sourceUrls: string[];
}

export interface PayoutVector {
  denominator: "1" | "2";
  no: "0" | "1";
  yes: "0" | "1";
}

export interface ResolutionEvidencePacket {
  deployment: EvidenceDeployment;
  attachments: AttachmentReference[];
  kind: "market-resolution";
  localMarket: {
    /** The local market id (decimal); markets have no separate local condition. */
    conditionId: string;
    marketId: string;
    eventConditionId: Hex;
    eventNoIndex: string;
    eventYesIndex: string;
  };
  /** The venue's official record of the result. */
  official: {
    source: EventSource;
    marketId: string;
    metadataRawHash: Hex;
    metadataSnapshotId: string;
    status: string;
    url: string;
  };
  payout: PayoutVector;
  /** Polymarket's settlement on Polygon's Conditional Tokens; null for Kalshi, which settles off
   * chain. */
  polygon: {
    blockHash: Hex | null;
    blockNumber: string | null;
    chainId: "137";
    conditionalTokensAddress: Address;
    transactionHash: Hex | null;
  } | null;
  preparedAt: string;
  preparer: Address;
  schemaVersion: 4;
  sourceObservations: Array<{
    observedAt: string;
    payout: PayoutVector;
    status: string;
    url: string;
  }>;
  sourceReference: string;
}

export interface EvidenceEnvelope<T extends CreationEvidencePacket | ResolutionEvidencePacket> {
  packet: T;
  packetHash: Hex;
}

const address = (value: unknown, name: string): Address => {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new MarketDataError("INVALID_EVIDENCE", `${name} is not an address`);
  }
  return getAddress(value);
};

const hex32 = (value: unknown, name: string): Hex => {
  if (!isHex32(value)) {
    throw new MarketDataError("INVALID_EVIDENCE", `${name} must be bytes32`);
  }
  return value.toLowerCase() as Hex;
};

const isoTime = (value: unknown, name: string): string => {
  const input = requiredString(value, name, 128);
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) throw new MarketDataError("INVALID_EVIDENCE", `${name} is invalid`);
  return new Date(parsed).toISOString();
};

/** The exchange's fee-rate cap (`ConditionalStocksBase.MAX_FEE_BPS`). */
const MAX_FEE_BPS = 1_000;

const feeBps = (value: unknown, name: string): string => {
  const bps = decimalInteger(value, name, true);
  if (BigInt(bps) > BigInt(MAX_FEE_BPS))
    throw new MarketDataError("INVALID_EVIDENCE", `${name} exceeds ${MAX_FEE_BPS} bps`);
  return bps;
};

const secureUrl = (value: unknown, name: string): string => {
  const input = requiredString(value, name, 2_048);
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "ipfs:") {
    throw new MarketDataError("INVALID_EVIDENCE", `${name} must use HTTPS or IPFS`);
  }
  return url.toString();
};

export const parseAttachments = (input: unknown): AttachmentReference[] => {
  if (!Array.isArray(input) || input.length > 32) {
    throw new MarketDataError("INVALID_EVIDENCE", "attachments must contain at most 32 items");
  }
  const seen = new Set<string>();
  return input.map((item, index) => {
    const raw = object(item, `attachments[${index}]`);
    const reference: AttachmentReference = {
      byteLength: decimalInteger(raw.byteLength, `attachments[${index}].byteLength`, true),
      contentHash: hex32(raw.contentHash, `attachments[${index}].contentHash`),
      filename: requiredString(raw.filename, `attachments[${index}].filename`, 256),
      mediaType: requiredString(raw.mediaType, `attachments[${index}].mediaType`, 128),
      uri: secureUrl(raw.uri, `attachments[${index}].uri`),
    };
    if (seen.has(reference.contentHash)) {
      throw new MarketDataError("INVALID_EVIDENCE", "duplicate attachment hash");
    }
    seen.add(reference.contentHash);
    return reference;
  });
};

export const payoutVector = (input: unknown): PayoutVector => {
  const raw = object(input, "payout");
  const yes = decimalInteger(raw.yes, "payout.yes", true);
  const no = decimalInteger(raw.no, "payout.no", true);
  const denominator = decimalInteger(raw.denominator, "payout.denominator");
  if (
    !(
      (yes === "1" && no === "0" && denominator === "1") ||
      (yes === "0" && no === "1" && denominator === "1") ||
      (yes === "1" && no === "1" && denominator === "2")
    )
  ) {
    throw new MarketDataError("INVALID_PAYOUT", "payout must be YES, NO, or invalid 50/50");
  }
  return { denominator, no, yes } as PayoutVector;
};

const parseConfig = (input: unknown, metadata: EventMarket): MarketConfigEvidence => {
  const raw = object(input, "config");
  const metadataUri = secureUrl(raw.metadataUri, "config.metadataUri");
  const rules = requiredString(raw.rules, "config.rules", 64_000);
  const yes = yesOutcome(metadata);
  const no = noOutcome(metadata);
  const config: MarketConfigEvidence = {
    baseStep: decimalInteger(raw.baseStep, "config.baseStep"),
    baseToken: address(raw.baseToken, "config.baseToken"),
    makerFeeBps: feeBps(raw.makerFeeBps, "config.makerFeeBps"),
    maxMarketOpenNotional: decimalInteger(
      raw.maxMarketOpenNotional,
      "config.maxMarketOpenNotional",
    ),
    maxOrderNotional: decimalInteger(raw.maxOrderNotional, "config.maxOrderNotional"),
    maxOrderQuantity: decimalInteger(raw.maxOrderQuantity, "config.maxOrderQuantity"),
    maxWalletOpenNotional: decimalInteger(
      raw.maxWalletOpenNotional,
      "config.maxWalletOpenNotional",
    ),
    metadataHash: keccak256(toBytes(metadataUri)),
    metadataUri,
    minNotional: decimalInteger(raw.minNotional, "config.minNotional"),
    eventConditionId: metadata.conditionId,
    eventNoIndex: no.indexSet,
    eventYesIndex: yes.indexSet,
    priceTickRawX18: decimalInteger(raw.priceTickRawX18, "config.priceTickRawX18"),
    quoteToken: address(raw.quoteToken, "config.quoteToken"),
    rulesHash: keccak256(toBytes(rules)),
    takerFeeBps: feeBps(raw.takerFeeBps, "config.takerFeeBps"),
    tradingCutoff: decimalInteger(raw.tradingCutoff, "config.tradingCutoff"),
    tradingOpen: decimalInteger(raw.tradingOpen, "config.tradingOpen", true),
  };
  if (BigInt(config.tradingCutoff) <= BigInt(config.tradingOpen)) {
    throw new MarketDataError("INVALID_EVIDENCE", "trading cutoff must follow opening");
  }
  if (config.baseToken === config.quoteToken) {
    throw new MarketDataError("INVALID_EVIDENCE", "base and quote tokens must differ");
  }
  if (BigInt(config.maxOrderQuantity) % BigInt(config.baseStep) !== 0n)
    throw new MarketDataError(
      "INVALID_EVIDENCE",
      "maxOrderQuantity must be a multiple of baseStep",
    );
  if (new TextEncoder().encode(metadataUri).length > 512)
    throw new MarketDataError("INVALID_EVIDENCE", "metadataUri exceeds the onchain limit");
  return config;
};

const sourceUrls = (input: unknown): string[] => {
  if (!Array.isArray(input) || input.length === 0 || input.length > 16) {
    throw new MarketDataError("INVALID_EVIDENCE", "sourceUrls must contain 1-16 entries");
  }
  return [...new Set(input.map((value, index) => secureUrl(value, `sourceUrls[${index}]`)))];
};

const marketId = (value: unknown, name: string): string => {
  const id = decimalInteger(value, name);
  if (BigInt(id) > 4_294_967_295n)
    throw new MarketDataError("INVALID_EVIDENCE", `${name} is invalid`);
  return id;
};

export const validateDeployment = (value: unknown): EvidenceDeployment => {
  const raw = object(value, "deployment");
  return {
    chainId: decimalInteger(raw.chainId, "deployment.chainId"),
    exchange: address(raw.exchange, "deployment.exchange"),
  };
};

export const buildCreationEvidence = (input: {
  deployment: EvidenceDeployment;
  attachments: unknown;
  config: unknown;
  metadata: EventMarket;
  metadataRawHash: Hex;
  metadataSnapshotId: string;
  preparedAt: string;
  preparer: Address;
  sourceUrls: unknown;
}): EvidenceEnvelope<CreationEvidencePacket> => {
  // Inactive: an unnamed placeholder outcome Polymarket may name later, or a market its venue
  // has not opened. Resolution evidence has no such check: some resolved markets turn inactive.
  if (!input.metadata.active)
    throw new MarketDataError("UNSUPPORTED_MARKET", "The venue has not activated this market");
  const yes = yesOutcome(input.metadata);
  const no = noOutcome(input.metadata);
  const config = parseConfig(input.config, input.metadata);
  const packet: CreationEvidencePacket = {
    deployment: validateDeployment(input.deployment),
    attachments: parseAttachments(input.attachments),
    config,
    event: {
      source: input.metadata.source,
      marketId: eventMarketId(input.metadata),
      canonicalUrl: input.metadata.canonicalUrl,
      conditionId: input.metadata.conditionId,
      endTime: input.metadata.endTime,
      metadataRawHash: hex32(input.metadataRawHash, "metadataRawHash"),
      metadataSnapshotId: requiredString(input.metadataSnapshotId, "metadataSnapshotId", 256),
      no,
      question: input.metadata.question,
      resolutionSource: input.metadata.resolutionSource,
      rules: input.metadata.rules,
      yes,
    },
    kind: "market-creation",
    preparedAt: isoTime(input.preparedAt, "preparedAt"),
    preparer: address(input.preparer, "preparer"),
    schemaVersion: 7,
    sourceUrls: sourceUrls(input.sourceUrls),
  };
  return { packet, packetHash: hashCanonical(packet) };
};

export const buildResolutionEvidence = (input: {
  deployment: EvidenceDeployment;
  attachments: unknown;
  conditionId: unknown;
  marketId: unknown;
  /** The venue snapshot's source and the venue's id of the market. */
  source: EventSource;
  eventMarketId: unknown;
  metadataRawHash: unknown;
  metadataSnapshotId: unknown;
  officialStatus: unknown;
  officialUrl: unknown;
  payout: unknown;
  /** Required for Polymarket; Kalshi settles off chain and has none. */
  polygon: unknown;
  eventConditionId: unknown;
  eventNoIndex: unknown;
  eventYesIndex: unknown;
  preparedAt: unknown;
  preparer: unknown;
  sourceObservations: unknown;
  sourceReference: unknown;
}): EvidenceEnvelope<ResolutionEvidencePacket> => {
  const payout = payoutVector(input.payout);
  if (!Array.isArray(input.sourceObservations) || input.sourceObservations.length === 0) {
    throw new MarketDataError("INVALID_EVIDENCE", "source observations are required");
  }
  const observations = input.sourceObservations.map((item, index) => {
    const raw = object(item, `sourceObservations[${index}]`);
    return {
      observedAt: isoTime(raw.observedAt, `sourceObservations[${index}].observedAt`),
      payout: payoutVector(raw.payout),
      status: requiredString(raw.status, `sourceObservations[${index}].status`, 256),
      url: secureUrl(raw.url, `sourceObservations[${index}].url`),
    };
  });
  if (
    observations.some((observation) => hashCanonical(observation.payout) !== hashCanonical(payout))
  ) {
    throw new MarketDataError("CONFLICTING_EVIDENCE", "source observations disagree on payout");
  }
  const optionalHex = (value: unknown, name: string): Hex | null =>
    value === undefined || value === null || value === "" ? null : hex32(value, name);
  const optionalInteger = (value: unknown, name: string): string | null =>
    value === undefined || value === null || value === ""
      ? null
      : decimalInteger(value, name, true);
  const polygon = (): ResolutionEvidencePacket["polygon"] => {
    if (input.source === "kalshi") {
      if (input.polygon !== undefined && input.polygon !== null)
        throw new MarketDataError(
          "INVALID_EVIDENCE",
          "Kalshi settles off chain: no Polygon record",
        );
      return null;
    }
    const raw = object(input.polygon, "polygon");
    if (raw.chainId !== "137")
      throw new MarketDataError("WRONG_NETWORK", "Polygon evidence chainId must be 137");
    return {
      blockHash: optionalHex(raw.blockHash, "polygon.blockHash"),
      blockNumber: optionalInteger(raw.blockNumber, "polygon.blockNumber"),
      chainId: "137",
      conditionalTokensAddress: address(
        raw.conditionalTokensAddress,
        "polygon.conditionalTokensAddress",
      ),
      transactionHash: optionalHex(raw.transactionHash, "polygon.transactionHash"),
    };
  };
  if (input.source !== "polymarket" && input.source !== "kalshi")
    throw new MarketDataError("INVALID_EVIDENCE", "source must be polymarket or kalshi");
  const packet: ResolutionEvidencePacket = {
    deployment: validateDeployment(input.deployment),
    attachments: parseAttachments(input.attachments),
    kind: "market-resolution",
    localMarket: {
      conditionId: marketId(input.conditionId, "conditionId"),
      marketId: marketId(input.marketId, "marketId"),
      eventConditionId: hex32(input.eventConditionId, "eventConditionId"),
      eventNoIndex: decimalInteger(input.eventNoIndex, "eventNoIndex"),
      eventYesIndex: decimalInteger(input.eventYesIndex, "eventYesIndex"),
    },
    official: {
      source: input.source,
      marketId: requiredString(input.eventMarketId, "eventMarketId", 256),
      metadataRawHash: hex32(input.metadataRawHash, "metadataRawHash"),
      metadataSnapshotId: requiredString(input.metadataSnapshotId, "metadataSnapshotId", 256),
      status: requiredString(input.officialStatus, "officialStatus", 256),
      url: secureUrl(input.officialUrl, "officialUrl"),
    },
    payout,
    polygon: polygon(),
    preparedAt: isoTime(input.preparedAt, "preparedAt"),
    preparer: address(input.preparer, "preparer"),
    schemaVersion: 4,
    sourceObservations: observations,
    sourceReference: secureUrl(input.sourceReference, "sourceReference"),
  };
  return { packet, packetHash: hashCanonical(packet) };
};

export const assertEvidenceIntegrity = <
  T extends CreationEvidencePacket | ResolutionEvidencePacket,
>(
  envelope: EvidenceEnvelope<T>,
): void => {
  if (
    (envelope.packet.kind === "market-creation" && envelope.packet.schemaVersion !== 7) ||
    (envelope.packet.kind === "market-resolution" && envelope.packet.schemaVersion !== 4)
  ) {
    throw new MarketDataError(
      "INVALID_EVIDENCE",
      "Unsupported evidence schema cannot authorize a transaction",
      409,
    );
  }
  validateDeployment(envelope.packet.deployment);
  if (envelope.packet.kind === "market-resolution") {
    payoutVector(envelope.packet.payout);
    if (envelope.packet.localMarket.conditionId !== envelope.packet.localMarket.marketId)
      throw new MarketDataError(
        "INVALID_EVIDENCE",
        "The local condition must identify the market",
        409,
      );
    if (new TextEncoder().encode(envelope.packet.sourceReference).length > 512)
      throw new MarketDataError("INVALID_EVIDENCE", "Evidence URI exceeds the onchain limit", 409);
  }
  if (hashCanonical(envelope.packet) !== envelope.packetHash) {
    throw new MarketDataError(
      "TAMPERED_EVIDENCE",
      "packet hash does not match packet contents",
      409,
    );
  }
};

export const attachmentContentHash = (bytes: Uint8Array): Hex => keccak256(bytes);

export const assertAttachmentIntegrity = (
  reference: AttachmentReference,
  bytes: Uint8Array,
): void => {
  if (
    attachmentContentHash(bytes) !== reference.contentHash ||
    BigInt(bytes.byteLength) !== BigInt(reference.byteLength)
  ) {
    throw new MarketDataError(
      "TAMPERED_ATTACHMENT",
      `attachment ${reference.filename} is invalid`,
      409,
    );
  }
};
