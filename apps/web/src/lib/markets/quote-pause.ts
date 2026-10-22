import type { MarketView } from "@/types/api";

/** Why no vault quotes an open market:
 * - `probability`: its event market (Polymarket or Kalshi) gives no usable price right now (a
 *   book with one side empty or too thin, or a stale feed), and every vault quote is priced
 *   from it;
 * - `vault`: the price is usable but no vault quotes the market (a vault safety check, its
 *   cutoff near, or no vault covering it).
 * Null while the market is quoted or not trading, and while the makers' prices are not live or
 * quote no market at all: an outage is not this market's pause. */
export type QuotePause = "probability" | "vault";

export function quotePause(
  market: Pick<MarketView, "lifecycle" | "probability" | "yes" | "no">,
  makers: { live: boolean; quoted: number },
): QuotePause | null {
  if (market.lifecycle !== "open" || !makers.live || makers.quoted === 0) return null;
  if (market.yes.quote || market.no.quote) return null;
  return market.probability.quality === "valid" ? "vault" : "probability";
}

/** The event market's venue, as people know it. */
export const eventVenue = (source: MarketView["mapping"]["source"]) =>
  source === "kalshi" ? "Kalshi" : "Polymarket";
