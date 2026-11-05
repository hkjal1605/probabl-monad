import { venueImageUrl } from "@/lib/markets/venue-images";
import type { Venue } from "./types";

/** Kalshi's artwork for a series, the same for every market in it: a market ticker starts with
 * its series ticker ("KXFEDDECISION-26DEC-H0" is in KXFEDDECISION). */
const kalshiSeriesImage = (marketId: string) => {
  const series = marketId.split("-")[0];
  return series ? `https://assets.kalshi.com/series-images-webp/${series}.webp` : null;
};

/** An event's picture as the app loads it (through `/media/<venue>/…`): the venue's own, or a
 * Kalshi market's series artwork when the catalog has none. */
export function eventImage(event: {
  source: Venue | null;
  marketId?: string | null | undefined;
  image?: string | null | undefined;
}): string | null {
  const raw =
    event.image ??
    (event.source === "kalshi" && event.marketId ? kalshiSeriesImage(event.marketId) : null);
  return venueImageUrl(raw);
}
