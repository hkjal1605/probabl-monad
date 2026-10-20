import type { Hex } from "./canonical.ts";
import { MarketDataError } from "./canonical.ts";
import type { NormalizedKalshiMarket } from "./kalshi/metadata.ts";
import type { NormalizedPolymarketMarket } from "./polymarket/metadata.ts";

/** A venue whose YES/NO markets local markets are conditioned on. */
export type EventSource = "polymarket" | "kalshi";
export const EVENT_SOURCES: readonly EventSource[] = ["polymarket", "kalshi"];
export const EVENT_SOURCE_NAMES: Record<EventSource, string> = {
  polymarket: "Polymarket",
  kalshi: "Kalshi",
};

/** One side of a binary event market. `indexSet` is the side's on-chain index (1 or 2); `tokenId`
 * names the venue's instrument for it (a Polymarket CLOB token, a Kalshi ticker and side). */
export interface EventOutcome {
  indexSet: "1" | "2";
  label: "NO" | "YES";
  tokenId: string;
}

/** What every normalized event market carries, whatever its venue. */
export interface EventMarketFields {
  active: boolean;
  canonicalUrl: string;
  closed: boolean;
  /** The 32-byte id local markets reference on chain. */
  conditionId: Hex;
  endTime: string;
  imageUrl?: string | null;
  mappingHash: Hex;
  outcomes: [EventOutcome, EventOutcome];
  question: string;
  resolutionSource: string;
  resolutionStatus: string | null;
  rules: string;
  schemaVersion: 1;
}

/** A normalized event market from any venue, discriminated by `source`. */
export type EventMarket = NormalizedPolymarketMarket | NormalizedKalshiMarket;

/** The venue's own id of an event market: Polymarket's Gamma market id, or the Kalshi ticker. */
export const eventMarketId = (market: EventMarket): string =>
  market.source === "kalshi" ? market.ticker : market.gammaMarketId;

/** The venue of a market's event, from the page its on-chain metadata URI links to. */
export const eventSourceOf = (metadataUri: string): EventSource => {
  try {
    const host = new URL(metadataUri).hostname;
    return host === "kalshi.com" || host.endsWith(".kalshi.com") ? "kalshi" : "polymarket";
  } catch {
    return "polymarket";
  }
};

export const yesOutcome = (market: Pick<EventMarket, "outcomes">): EventOutcome => {
  const outcome = market.outcomes.find((item) => item.label === "YES");
  if (!outcome) throw new MarketDataError("INVALID_METADATA", "YES outcome is missing");
  return outcome;
};

export const noOutcome = (market: Pick<EventMarket, "outcomes">): EventOutcome => {
  const outcome = market.outcomes.find((item) => item.label === "NO");
  if (!outcome) throw new MarketDataError("INVALID_METADATA", "NO outcome is missing");
  return outcome;
};
