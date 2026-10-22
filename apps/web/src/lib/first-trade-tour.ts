/** The first-trade tour: a few hints from the markets list to a placed order, shown once to a
 * wallet that just finished the onboarding guide. Its progress lives in the browser, so it
 * survives navigation and reloads; once completed or skipped it never shows again. */

export const TOUR_STEPS = ["market", "side", "amount", "submit"] as const;
export type TourStep = (typeof TOUR_STEPS)[number];
export type TourState =
  | { status: "active"; step: TourStep }
  | { status: "done" }
  | { status: "skipped" };

export const TOUR_KEY = "probabl-first-trade-tour";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** The saved state, or null for a browser that never started the tour (or can't store it). */
export function readTour(storage: Storage | null): TourState | null {
  try {
    const value = JSON.parse(storage?.getItem(TOUR_KEY) ?? "null") as Partial<{
      status: string;
      step: string;
    }> | null;
    if (value?.status === "done" || value?.status === "skipped") return { status: value.status };
    if (value?.status === "active" && TOUR_STEPS.includes(value.step as TourStep))
      return { status: "active", step: value.step as TourStep };
  } catch {
    // Unreadable or blocked storage: as if never started.
  }
  return null;
}

export function writeTour(storage: Storage | null, state: TourState) {
  try {
    storage?.setItem(TOUR_KEY, JSON.stringify(state));
  } catch {
    // Private mode or blocked storage: the tour still runs for this page's life.
  }
}

/** The step after (or before) `step`, or null past either end. */
export function stepBeside(step: TourStep, by: 1 | -1): TourStep | null {
  return TOUR_STEPS[TOUR_STEPS.indexOf(step) + by] ?? null;
}

/** The market row the tour points at on the markets list: the first, in page order, whose market
 * the vaults quote on both sides (so a market order fills at once), else the first row. */
export function pickTourMarket<T extends { marketId: string }>(
  rows: readonly T[],
  quoted: ReadonlySet<string>,
): T | null {
  return rows.find((row) => quoted.has(row.marketId)) ?? rows[0] ?? null;
}

/** On-chain market ids the makers quote on both branches, both sides. */
export function fullyQuoted(
  prices: readonly { market: string; branch: 0 | 1; bid: string | null; ask: string | null }[],
): Set<string> {
  const sides = new Map<string, number>();
  for (const p of prices)
    if (p.bid !== null && p.ask !== null) sides.set(p.market, (sides.get(p.market) ?? 0) + 1);
  return new Set([...sides].filter(([, count]) => count >= 2).map(([market]) => market));
}
