import { displayPrice } from "@/lib/format/display";
import type { PriceHistoryPoint } from "@/services/price-history";
import type { MarketView, TradeView } from "@/types/api";

export interface PricePoint {
  id: string;
  at: number;
  branch: number;
  price: number;
}
export function executionPoints(trades: TradeView[], market: MarketView, since = 0): PricePoint[] {
  return trades
    .filter((t) => t.marketId === market.id && (t.branch === 0 || t.branch === 1))
    .map((t) => ({
      id: t.id,
      at: Number(t.blockTimestamp),
      branch: t.branch,
      price: displayPrice(t.executionPriceRawX18, market),
    }))
    .filter(
      (p) => Number.isFinite(p.at) && p.at >= since && Number.isFinite(p.price) && p.price > 0,
    )
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
/** Compare the most recently executed prices, never invent a missing branch or imply historical book quotes. */
export function executionImpact(points: PricePoint[]): PricePoint[] {
  let yes: number | null = null,
    no: number | null = null;
  const result: PricePoint[] = [];
  for (const point of points) {
    if (point.branch === 0) yes = point.price;
    else no = point.price;
    if (yes !== null && no !== null && no > 0)
      result.push({ ...point, branch: 0, price: ((yes - no) / no) * 100 });
  }
  return result;
}
/** A line's points: unix seconds and display values, in time order. */
export interface LinePoint {
  time: number;
  value: number;
}
/** A market's YES, NO and spot lines from its recorded prices (display units, the stock's spot per
 * whole token), each ending at its live value when that is newer than the last record. A minute
 * without a value has no point. */
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
    if (p.spot !== null) lines.spot.push({ time: p.time, value: p.spot });
  }
  for (const key of ["yes", "no", "spot"] as const) {
    const value = live[key],
      line = lines[key];
    if (value !== null && Number.isFinite(value) && (line.at(-1)?.time ?? 0) < now)
      line.push({ time: now, value });
  }
  return lines;
}
