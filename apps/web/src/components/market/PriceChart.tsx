"use client";

import { useMemo, useState } from "react";
import { LazyPriceChart } from "@/components/market/LazyPriceChart";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { usePriceHistory } from "@/hooks/useProtocolData";
import { impactLine, priceLines } from "@/lib/markets/history";
import { currentSpotUsd, midpoint } from "@/lib/markets/presentation";
import type { PriceHistoryRange } from "@/services/price-history";
import type { MarketView } from "@/types/api";
import { chartLine, dollars, dollarTicks, priceSeries } from "./priceSeries";

/** Each range's window in seconds, and the recorded history that covers it. */
const ranges: Record<"1H" | "1D" | "1W" | "ALL", [number, PriceHistoryRange]> = {
  "1H": [3600, "1d"],
  "1D": [86400, "1d"],
  "1W": [604800, "1w"],
  ALL: [Infinity, "all"],
};

/** The market's recorded prices, as on the home page's banner: YES, NO and the stock's spot, or
 * YES's premium over NO (`Impact %`), each ending at the live values. */
export function PriceChart({
  market,
  mini = false,
}: {
  market: MarketView | null;
  mini?: boolean;
}) {
  const [range, setRange] = useState<keyof typeof ranges>("ALL");
  const [mode, setMode] = useState("YES vs NO");
  const [seconds, historyRange] = ranges[range];
  const history = usePriceHistory(market?.id, historyRange);
  const yes = market ? midpoint(market.yes) : null,
    no = market ? midpoint(market.no) : null,
    spot = market ? currentSpotUsd(market) : null;
  const series = useMemo(() => {
    if (!market) return [];
    const since = Math.floor(Date.now() / 1000) - seconds;
    const lines = priceLines(history.points, market, { yes, no, spot });
    for (const key of ["yes", "no", "spot"] as const)
      lines[key] = lines[key].filter((p) => p.time >= since);
    return mode === "Impact %"
      ? [
          {
            id: "impact",
            label: "YES vs NO",
            colorToken: "primary" as const,
            data: chartLine(impactLine(lines)),
          },
        ]
      : priceSeries(lines);
  }, [history.points, market, mode, seconds, yes, no, spot]);
  const emptyMessage =
    history.isPending || series.some((s) => s.data.length >= 2)
      ? undefined
      : history.isError
        ? "Price history is temporarily unavailable."
        : "Prices are recorded every minute: the chart fills in as they arrive.";
  const chart = (
    <LazyPriceChart
      ariaLabel={
        mode === "Impact %"
          ? "How far the price if YES sits above the price if NO, in percent, over time"
          : `${market?.ticker ?? "Stock"} prices if YES and if NO, and its spot price, over time`
      }
      emptyMessage={emptyMessage}
      series={series}
      {...(mode === "Impact %"
        ? { valueSuffix: "%" as const }
        : { formatValue: dollars, formatTicks: dollarTicks })}
    />
  );
  const viewport = (
    <div
      className={
        mini ? "flex aspect-video min-h-40 w-full" : "flex h-full min-h-[360px] w-full xl:min-h-0"
      }
    >
      {chart}
    </div>
  );
  if (mini)
    return (
      <figure className="min-w-0" aria-label="Conditional stock chart">
        {viewport}
      </figure>
    );
  return (
    <Card variant="panel" className="h-full min-h-0 min-w-0" aria-label="Conditional stock chart">
      <CardHeader className="flex flex-wrap justify-between gap-2">
        <Segmented
          label="Chart mode"
          variant="chart"
          value={mode}
          options={["YES vs NO", "Impact %"]}
          onChange={setMode}
        />
        <Segmented
          label="Chart range"
          variant="timeframe"
          value={range}
          options={["1H", "1D", "1W", "ALL"]}
          onChange={setRange}
        />
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 px-0">{viewport}</CardContent>
    </Card>
  );
}
