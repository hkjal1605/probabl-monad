import { displayPrice } from "@/lib/format/display";
import type { PriceHistoryPoint } from "@/services/price-history";
import type { MarketView } from "@/types/api";

/** A line's points: unix seconds and display values, in time order. */
export interface LinePoint {
  time: number;
  value: number;
}
/** A market's YES, NO and spot lines from its recorded prices (display units, the stock's spot per
 * whole token), each ending at its live value when that is newer than the last record. A minute
 * without a value has no point, and spot is drawn only where YES or NO has one: alone (an empty
 * book, the vaults paused near the result) it would run on past them and cross them. */
export function priceLines(
  history: readonly PriceHistoryPoint[],
  market: MarketView,
  live: { yes: number | null; no: number | null; spot: number | null },
  now = Math.floor(Date.now() / 1000),
) {
  const lines: Record<"yes" | "no" | "spot", LinePoint[]> = { yes: [], no: [], spot: [] };
  for (const p of history) {
    if (p.yes !== null) lines.yes.push({ time: p.time, value: displayPrice(p.yes, market) });
    if (p.no !== null) lines.no.push({ time: p.time, value: displayPrice(p.no, market) });
    if (p.spot !== null && (p.yes !== null || p.no !== null))
      lines.spot.push({ time: p.time, value: p.spot });
  }
  const priced = (value: number | null): value is number =>
    value !== null && Number.isFinite(value);
  for (const key of ["yes", "no", "spot"] as const) {
    const value = live[key],
      line = lines[key];
    if (key === "spot" && !priced(live.yes) && !priced(live.no)) continue;
    if (priced(value) && (line.at(-1)?.time ?? 0) < now) line.push({ time: now, value });
  }
  return lines;
}
/** YES's premium over NO in percent, at each time both lines have a price. */
export function impactLine(lines: { yes: readonly LinePoint[]; no: readonly LinePoint[] }) {
  const no = new Map(lines.no.map((p) => [p.time, p.value]));
  return lines.yes.flatMap((p): LinePoint[] => {
    const n = no.get(p.time);
    return n !== undefined && n > 0 ? [{ time: p.time, value: ((p.value - n) / n) * 100 }] : [];
  });
}
