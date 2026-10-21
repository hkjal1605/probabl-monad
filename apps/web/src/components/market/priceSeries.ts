import type { UTCTimestamp } from "lightweight-charts";
import {
  displayPrice,
  formatNumber,
  formatUsd,
  shareAmount,
  tokenAmount,
} from "@/lib/format/display";
import type { LinePoint } from "@/lib/markets/history";
import { conditionalPositionRows } from "@/lib/portfolio/positions";
import type { IndexedOrder, MarketView, PositionView } from "@/types/api";
import type { LightweightChartLevel, LightweightChartSeries } from "./LightweightPriceChart";

/** Chart and outcome values: dollars per whole token. */
export const dollars = (value: number) => formatUsd(value);
const wholeDollars = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});
/** Axis ticks: whole dollars when every tick is one, else cents. */
export const dollarTicks = (values: number[]) =>
  values.every((value) => Math.abs(value - Math.round(value)) < 1e-9)
    ? values.map((value) => wholeDollars.format(value))
    : values.map(dollars);

export const chartLine = (points: LinePoint[]) =>
  points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));

/** A market's YES, NO and spot lines (`priceLines`), as the banner and the market page draw them. */
export const priceSeries = (lines: Record<"yes" | "no" | "spot", LinePoint[]>) =>
  [
    { id: "yes", label: "If YES", colorToken: "positive", data: chartLine(lines.yes) },
    { id: "no", label: "If NO", colorToken: "danger", data: chartLine(lines.no) },
    {
      id: "spot",
      label: "Spot",
      colorToken: "info",
      lineStyle: "dashed",
      data: chartLine(lines.spot),
    },
  ] satisfies LightweightChartSeries[];

/** Which horizontal lines the YES vs NO chart draws. */
export interface ChartLines {
  entry: boolean;
  orders: boolean;
}

const WAD = 10n ** 18n;
const BRANCHES = [
  { seriesId: "yes", name: "YES", colorToken: "positive" },
  { seriesId: "no", name: "NO", colorToken: "danger" },
] as const;

/** The member's lines on a market's YES vs NO chart: each branch's average entry (the cost of its
 * priced claims, as the indexer keeps it, over their number) in the branch's colour, with the
 * claims held, and its resting orders, one line per branch, side and limit price. */
export function chartLevels(
  market: MarketView,
  positions: PositionView[],
  orders: IndexedOrder[],
  show: ChartLines,
): LightweightChartLevel[] {
  const levels: LightweightChartLevel[] = [];
  if (show.entry)
    for (const row of conditionalPositionRows([market], positions, orders))
      if (row.kind === "stock" && row.priced > 0n) {
        const { seriesId, name, colorToken } = BRANCHES[row.branch];
        levels.push({
          seriesId,
          price: displayPrice(((row.cost * WAD) / row.priced).toString(), market),
          colorToken,
          lineStyle: "dashed",
          tag: "Avg Entry",
          label: `${formatNumber(tokenAmount(row.total.toString(), row.decimals))} ${market.ticker}-${name}`,
        });
      }
  if (show.orders) {
    const resting = new Map<string, { order: IndexedOrder; remaining: bigint }>();
    for (const order of orders) {
      if (order.marketId !== market.id || order.status !== "open") continue;
      const key = `${order.branch}:${order.side}:${order.limitPriceRawX18}`;
      const level = resting.get(key);
      if (level) level.remaining += BigInt(order.remaining);
      else resting.set(key, { order, remaining: BigInt(order.remaining) });
    }
    for (const { order, remaining } of resting.values()) {
      const branch = BRANCHES[order.branch === 0 ? 0 : 1];
      levels.push({
        seriesId: branch.seriesId,
        price: displayPrice(order.limitPriceRawX18, market),
        colorToken: "warning",
        lineStyle: "dotted",
        tag: order.side === 0 ? "Buy" : "Sell",
        label: `${formatNumber(shareAmount(remaining.toString(), market))} ${market.ticker}-${branch.name}`,
      });
    }
  }
  return levels;
}
