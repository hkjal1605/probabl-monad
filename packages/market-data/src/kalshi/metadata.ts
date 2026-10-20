import { keccak256, stringToBytes } from "viem";
import { type Hex, hashCanonical, MarketDataError, object, requiredString } from "../canonical.ts";
import { type EventMarketFields, type EventOutcome, httpsImageUrl } from "../event-market.ts";
import type { PayoutVector } from "../evidence.ts";

export interface NormalizedKalshiMarket extends EventMarketFields {
  source: "kalshi";
  ticker: string;
  eventTicker: string;
  seriesTicker: string;
  /** Kalshi's market status, e.g. "active" (trading), "closed", "determined", "finalized". */
  status: string;
  /** The side Kalshi settled the market to, once known. */
  result: "yes" | "no" | null;
}

/** Statuses before a market closes; "active" alone trades. */
const OPEN_STATUSES = new Set(["initialized", "inactive", "active"]);
/** Statuses after which a result can no longer change ("settled" is the API's older name). */
const FINAL_STATUSES = new Set(["finalized", "settled"]);

/** The on-chain id of a Kalshi market. Kalshi has no condition ids, so a ticker's is its hash
 * under a prefix no Polymarket condition id can share. */
export const kalshiConditionId = (ticker: string): Hex =>
  keccak256(stringToBytes(`kalshi:${ticker}`));

/** Kalshi's public page of a series, which lists its markets. */
export const kalshiMarketUrl = (seriesTicker: string) =>
  `https://kalshi.com/markets/${encodeURIComponent(seriesTicker.toLowerCase())}`;

/** Kalshi's generic artwork for markets without their own, e.g. every strike of a price ladder. */
const FALLBACK_IMAGES = "kalshi-fallback-images.s3.amazonaws.com";

/** A market's artwork from its event's metadata (`GET /events/{event_ticker}/metadata`): its own
 * image (a candidate's photo, a party's logo), else the series image, never the generic icon. */
const kalshiImageUrl = (metadata: unknown, ticker: string): string | null => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const { image_url, market_details } = metadata as Record<string, unknown>;
  const details = Array.isArray(market_details) ? market_details : [];
  const own = details.find(
    (d) => d && typeof d === "object" && (d as Record<string, unknown>).market_ticker === ticker,
  ) as Record<string, unknown> | undefined;
  const specific = (value: unknown) => {
    const url = httpsImageUrl(value);
    return url && new URL(url).hostname !== FALLBACK_IMAGES ? url : null;
  };
  return specific(own?.image_url) ?? specific(image_url);
};

const isoTime = (value: unknown, name: string): string => {
  const timestamp = Date.parse(requiredString(value, name, 128));
  if (!Number.isFinite(timestamp))
    throw new MarketDataError("INVALID_METADATA", `${name} is invalid`);
  return new Date(timestamp).toISOString();
};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Normalizes a Kalshi market and its event, as `GET /markets/{ticker}` and
 * `GET /events/{event_ticker}` return them, with the event's metadata (artwork) when read:
 * `{ market, event, eventMetadata? }`. */
export const normalizeKalshiMarket = (input: unknown): NormalizedKalshiMarket => {
  const raw = object(input, "Kalshi snapshot");
  const market = object(raw.market, "market");
  const event = object(raw.event, "event");
  const ticker = requiredString(market.ticker, "ticker", 128);
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(ticker))
    throw new MarketDataError("INVALID_METADATA", "ticker is invalid");
  if (market.market_type !== "binary")
    throw new MarketDataError("UNSUPPORTED_MARKET", "only binary Kalshi markets are supported");
  const eventTicker = requiredString(market.event_ticker, "event_ticker", 128);
  if (event.event_ticker !== eventTicker)
    throw new MarketDataError("MAPPING_MISMATCH", "event does not match the market");
  const seriesTicker = requiredString(event.series_ticker, "series_ticker", 128);
  const status = requiredString(market.status, "status", 64);
  const conditionId = kalshiConditionId(ticker);
  const outcomes: [EventOutcome, EventOutcome] = [
    { indexSet: "1", label: "YES", tokenId: `${ticker}:yes` },
    { indexSet: "2", label: "NO", tokenId: `${ticker}:no` },
  ];
  // Most titles are whole questions; strike ladders name the strike in the subtitle only.
  const title = requiredString(market.title, "title");
  const strike = text(market.yes_sub_title);
  const question =
    title.startsWith("Will ") || !strike ? title : `${title.replace(/\?$/, "")}: ${strike}?`;
  const rules = [text(market.rules_primary), text(market.rules_secondary)]
    .filter(Boolean)
    .join("\n\n");
  const sources = Array.isArray(event.settlement_sources)
    ? event.settlement_sources.map((source) => text(object(source, "settlement source").name))
    : [];
  return {
    source: "kalshi",
    active: status === "active",
    canonicalUrl: kalshiMarketUrl(seriesTicker),
    closed: !OPEN_STATUSES.has(status),
    conditionId,
    endTime: isoTime(market.close_time, "close_time"),
    eventTicker,
    imageUrl: kalshiImageUrl(raw.eventMetadata, ticker),
    mappingHash: hashCanonical({ conditionId, outcomes, ticker }),
    outcomes,
    question,
    resolutionSource: sources.filter(Boolean).join("; ") || "unspecified",
    resolutionStatus: status,
    result: market.result === "yes" || market.result === "no" ? market.result : null,
    rules: requiredString(rules, "rules", 64_000),
    schemaVersion: 1,
    seriesTicker,
    status,
    ticker,
  };
};

/** Kalshi's final settlement of a market as a local payout, or null until it is final. */
export const kalshiPayout = (market: NormalizedKalshiMarket): PayoutVector | null => {
  if (!FINAL_STATUSES.has(market.status) || !market.result) return null;
  return market.result === "yes"
    ? { denominator: "1", no: "0", yes: "1" }
    : { denominator: "1", no: "1", yes: "0" };
};
