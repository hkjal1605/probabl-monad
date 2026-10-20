import {
  decimalInteger,
  type Hex,
  hashCanonical,
  isHex32,
  MarketDataError,
  object,
  requiredString,
} from "../canonical.ts";
import { type EventMarketFields, type EventOutcome, httpsImageUrl } from "../event-market.ts";

export interface NormalizedPolymarketMarket extends EventMarketFields {
  source: "polymarket";
  gammaMarketId: string;
  /** One outcome of a Polymarket event with exactly one winner (a YES/NO market itself). */
  negRisk: boolean;
  slug: string;
}

const stringArray = (value: unknown, name: string): string[] => {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new MarketDataError("INVALID_METADATA", `${name} is not valid JSON`);
    }
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new MarketDataError("INVALID_METADATA", `${name} must be a string array`);
  }
  return parsed;
};

const boolean = (value: unknown, name: string): boolean => {
  if (typeof value !== "boolean") {
    throw new MarketDataError("INVALID_METADATA", `${name} must be boolean`);
  }
  return value;
};

const isoTime = (value: unknown, name: string): string => {
  const input = requiredString(value, name, 128);
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp))
    throw new MarketDataError("INVALID_METADATA", `${name} is invalid`);
  return new Date(timestamp).toISOString();
};

const optionalString = (value: unknown, name: string): string | null => {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, name);
};

/** Display-only metadata: the full-size image, else the icon. Invalid artwork must not block
 * market creation. */
export const polymarketImageUrl = (input: unknown): string | null => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  for (const value of [raw.imageUrl, raw.image, raw.icon]) {
    const url = httpsImageUrl(value);
    if (url) return url;
  }
  return null;
};

export const normalizeGammaMarket = (input: unknown): NormalizedPolymarketMarket => {
  const raw = object(input, "Gamma market");
  const conditionId = requiredString(raw.conditionId, "conditionId", 66).toLowerCase();
  if (!isHex32(conditionId)) {
    throw new MarketDataError("INVALID_METADATA", "conditionId must be bytes32");
  }
  if (raw.negRiskOther === true) {
    throw new MarketDataError(
      "UNSUPPORTED_MARKET",
      'an "Other" outcome changes meaning whenever Polymarket adds an outcome',
    );
  }
  const labels = stringArray(raw.outcomes, "outcomes");
  const tokenIds = stringArray(raw.clobTokenIds, "clobTokenIds");
  if (labels.length !== 2 || tokenIds.length !== 2) {
    throw new MarketDataError("UNSUPPORTED_MARKET", "v1 requires exactly two outcomes");
  }
  const normalizedLabels = labels.map((label) => label.trim().toUpperCase());
  if (
    normalizedLabels.filter((label) => label === "YES").length !== 1 ||
    normalizedLabels.filter((label) => label === "NO").length !== 1
  ) {
    throw new MarketDataError("UNSUPPORTED_MARKET", "outcomes must contain exactly YES and NO");
  }
  const outcomes = labels.map(
    (_, index): EventOutcome => ({
      indexSet: index === 0 ? "1" : "2",
      label: normalizedLabels[index] as "NO" | "YES",
      tokenId: decimalInteger(tokenIds[index], `clobTokenIds[${index}]`),
    }),
  ) as [EventOutcome, EventOutcome];
  if (outcomes[0].tokenId === outcomes[1].tokenId) {
    throw new MarketDataError("INVALID_METADATA", "outcome token IDs must differ");
  }
  const slug = requiredString(raw.slug, "slug", 512);
  // A market of a multi-market event (a negative-risk outcome, a price-ladder strike) has its
  // own page under the event's.
  const event = Array.isArray(raw.events)
    ? (raw.events[0] as { slug?: unknown } | undefined)
    : undefined;
  const eventSlug = typeof event?.slug === "string" && event.slug !== slug ? event.slug : null;
  const mapping = {
    conditionId,
    outcomes,
  };
  return {
    source: "polymarket",
    active: boolean(raw.active, "active"),
    canonicalUrl: `https://polymarket.com/event/${eventSlug ? `${encodeURIComponent(eventSlug)}/` : ""}${encodeURIComponent(slug)}`,
    closed: boolean(raw.closed, "closed"),
    conditionId: conditionId as Hex,
    endTime: isoTime(raw.endDate ?? raw.endDateIso, "endDate"),
    gammaMarketId: requiredString(raw.id, "id", 256),
    imageUrl: polymarketImageUrl(raw),
    mappingHash: hashCanonical(mapping),
    negRisk: raw.negRisk === true,
    outcomes,
    question: requiredString(raw.question, "question"),
    resolutionSource: optionalString(raw.resolutionSource, "resolutionSource") ?? "unspecified",
    resolutionStatus: optionalString(raw.umaResolutionStatus, "umaResolutionStatus"),
    rules: requiredString(raw.description, "description", 64_000),
    schemaVersion: 1,
    slug,
  };
};
