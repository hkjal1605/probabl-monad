import type { UTCTimestamp } from "lightweight-charts";
import { formatUsd } from "@/lib/format/display";
import type { LinePoint } from "@/lib/markets/history";
import type { LightweightChartSeries } from "./LightweightPriceChart";

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
