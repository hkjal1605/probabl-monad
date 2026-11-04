/** An entry of the ingestor's event catalog (services/polymarket-ingestor/src/catalog.ts): one
 * open Polymarket or Kalshi market a world could use as a leg, as the API's assistant and the
 * app read it. */
export type CatalogSource = "polymarket" | "kalshi";
export interface CatalogEntry {
  /** `${source}:${marketId}`. */
  id: string;
  source: CatalogSource;
  /** Gamma's market id, or the Kalshi ticker. */
  marketId: string;
  conditionId: `0x${string}`;
  /** The index sets of the YES and NO outcomes. */
  yesIndex: 1 | 2;
  noIndex: 1 | 2;
  question: string;
  /** The event the market belongs to, and its group (`${source}:${event id}`). */
  event: string;
  group: string;
  /** Whether the group's markets exclude one another (one winner). */
  exclusive: boolean;
  /** The market's own outcome within its event (a strike, a candidate). */
  outcome: string | null;
  rules: string;
  endTime: string;
  url: string;
  image: string | null;
  category: string;
  tags: string[];
  /** Themes the pricing engine's correlation priors know (keeper `themes`). */
  themes: string[];
  /** YES midpoint, bid and ask (0 to 1), when the venue quotes both sides. */
  yes: number | null;
  bid: number | null;
  ask: number | null;
  /** Lifetime volume and resting liquidity, in dollars. */
  volume: number;
  liquidity: number;
  updatedAtMs: number;
}
