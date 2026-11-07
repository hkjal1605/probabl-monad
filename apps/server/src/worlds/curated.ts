/** The worlds the worlds page opens on: a few stories, each two events people follow and a stock
 * they move, chosen so a first look shows what a world is and what it pays.
 *
 * Each is kept as events and a move, not a price: the target is the stock's live price moved by
 * `move` (at a step people say), and the date the first NYSE trading day after the later event
 * ends, so it never fixes before its events are known. A world is shown only while it can
 * be traded as shown (`curatedSpecs`); the caller also asks the makers to price it. */

import type { CatalogEntry } from "@conditional-stocks/market-data";
import { tradingDay } from "@conditional-stocks/world-keeper/src/model/fixing.ts";
import { closeOf, newYorkDate, nextClose, type OpinionSpec } from "./opinion.ts";

export interface CuratedWorld {
  /** What it is about (for the record; the page shows only the venue's words). */
  story: string;
  /** Catalog ids, each wanted to happen, in the sentence's order. */
  legs: string[];
  underlying: string;
  direction: "above" | "below";
  /** The target's distance from the live price, as a fraction of it. */
  move: number;
}

/** Researched 2026-11-07 against the live catalog and the Robinhood testnet world vault: every
 * leg a two-sided book at most 6¢ wide with $0.1M+ traded, and each world quoted for both
 * products (All-in $20 → 6–18×, Money-back $100 → 2.9–3.4×). The first is the one a visitor sees
 * first, on the page's own default stock. */
export const CURATED_WORLDS: CuratedWorld[] = [
  {
    story: "AI boom",
    // Anthropic IPO by December 31, 2026; NVIDIA the largest company on December 31.
    legs: ["polymarket:2413330", "polymarket:676739"],
    underlying: "US:NVDA",
    direction: "above",
    move: 0.1,
  },
  {
    story: "Crypto comeback",
    // Bitcoin reach $90,000 by December 31, 2026; no change in Fed rates in January 2027.
    legs: ["polymarket:1345531", "polymarket:3215012"],
    underlying: "US:COIN",
    direction: "above",
    move: 0.125,
  },
  {
    story: "Rate shock",
    // Another Fed rate hike in 2026; CPI above 3.8% for the year to November 2026.
    legs: ["polymarket:4620900", "kalshi:KXCPIYOY-26NOV-T3.8"],
    underlying: "US:QQQ",
    direction: "below",
    move: 0.045,
  },
  {
    story: "Apple's crown",
    // Apple the largest company on December 31; no change in Fed rates in January 2027.
    legs: ["polymarket:676741", "polymarket:3215012"],
    underlying: "US:AAPL",
    direction: "above",
    move: 0.095,
  },
];

/** A curated leg's market can be shown while it is open past the next two days, priced away from
 * the edges and quoted on both sides at most this wide. */
const MAX_SPREAD = 0.08;

/** A price as people say it: to $0.50 under $10, $1 under $100, $5 under $1,000, $25 under
 * $5,000, else $500 ("210", "640", "12.50"). */
export function readableStrike(price: number) {
  const step = price < 10 ? 0.5 : price < 100 ? 1 : price < 1_000 ? 5 : price < 5_000 ? 25 : 500;
  const value = Math.max(step, Math.round(price / step) * step);
  return step < 1 ? value.toFixed(2) : String(value);
}

/** The first NYSE close on a day after the New York day of `seconds`: a weekday that is not a
 * market holiday. A world fixes the trading day after its last event ends, never the same day:
 * a venue's end is when trading stops, and its result can come later. */
export function closeAfter(seconds: number) {
  let close = nextClose(closeOf(newYorkDate(seconds)) + 1);
  for (let i = 0; i < 10 && !tradingDay(close.time); i++) close = nextClose(close.time + 1);
  return close;
}

/** Each curated world that can be shown now, as its spec: every leg in the catalog, open past
 * the next two days, priced 3–97% on a book at most 8¢ wide; the stock tradable in worlds and
 * priced; the date the first close after the later leg is decided, inside the vault's tenor. */
export function curatedSpecs(
  worlds: readonly CuratedWorld[],
  entries: ReadonlyMap<string, CatalogEntry>,
  spots: ReadonlyMap<string, number | null>,
  nowMs: number,
  maxTenorSeconds: number,
): { world: CuratedWorld; spec: OpinionSpec }[] {
  const out: { world: CuratedWorld; spec: OpinionSpec }[] = [];
  for (const world of worlds) {
    const legs = world.legs.map((id) => entries.get(id));
    const open = legs.every((e) => {
      if (!e) return false;
      const end = Date.parse(e.endTime);
      return (
        e.yes !== null &&
        e.yes >= 0.03 &&
        e.yes <= 0.97 &&
        e.bid !== null &&
        e.ask !== null &&
        e.ask - e.bid <= MAX_SPREAD &&
        Number.isFinite(end) &&
        end >= nowMs + 2 * 86_400_000
      );
    });
    const spot = spots.get(world.underlying);
    if (!open || !spot || !(spot > 0)) continue;
    const decided = Math.max(...legs.map((e) => Date.parse(e?.endTime ?? "") / 1000));
    const close = closeAfter(decided);
    if (close.time > nowMs / 1000 + maxTenorSeconds - 86_400) continue;
    out.push({
      world,
      spec: {
        legs: world.legs.map((id) => ({ id, wantYes: true })),
        stock: {
          underlying: world.underlying,
          direction: world.direction,
          strike: readableStrike(
            spot * (world.direction === "above" ? 1 + world.move : 1 - world.move),
          ),
          date: close.date,
        },
      },
    });
  }
  return out;
}
