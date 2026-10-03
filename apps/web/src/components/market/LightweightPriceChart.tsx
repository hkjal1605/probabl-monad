"use client";

import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  LastPriceAnimationMode,
  type LineData,
  LineSeries,
  LineStyle,
  LineType,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { formatNumber } from "@/lib/format/display";

export interface LightweightChartSeries {
  colorToken: "danger" | "positive" | "primary" | "info" | "foreground";
  data: LineData<UTCTimestamp>[];
  id: string;
  label: string;
  lineStyle?: "solid" | "dashed";
}

interface LegendState {
  time: number | null;
  values: Record<string, number | null>;
}

const tokenColor = (styles: CSSStyleDeclaration, token: LightweightChartSeries["colorToken"]) =>
  styles.getPropertyValue(`--${token}`).trim();

const initialLegend = (series: LightweightChartSeries[]): LegendState => ({
  time: null,
  values: Object.fromEntries(series.map((item) => [item.id, item.data.at(-1)?.value ?? null])),
});

type Lines = Map<string, { api: ISeriesApi<"Line">; look: string }>;

/** Sets each series' data on `chart`, adding, restyling and removing lines to match `series`. */
function syncSeries(
  chart: IChartApi,
  lines: Lines,
  series: LightweightChartSeries[],
  banner: boolean,
) {
  const styles = getComputedStyle(document.documentElement);
  for (const item of series) {
    const look = `${item.colorToken}:${item.lineStyle ?? "solid"}:${item.label}`;
    let line = lines.get(item.id);
    if (line && line.look !== look) {
      chart.removeSeries(line.api);
      line = undefined;
    }
    if (!line) {
      const color = tokenColor(styles, item.colorToken);
      line = {
        look,
        api: chart.addSeries(LineSeries, {
          color,
          crosshairMarkerBorderColor: color,
          crosshairMarkerBackgroundColor: styles.getPropertyValue("--background").trim(),
          crosshairMarkerRadius: 4,
          lastPriceAnimation: banner
            ? LastPriceAnimationMode.Continuous
            : LastPriceAnimationMode.Disabled,
          lastValueVisible: !banner,
          lineStyle: item.lineStyle === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
          lineType: banner ? LineType.WithSteps : LineType.Simple,
          lineWidth: 2,
          priceLineVisible: false,
          title: banner ? "" : item.label,
        }),
      };
      lines.set(item.id, line);
    }
    line.api.setData(item.data);
  }
  const ids = new Set(series.map((item) => item.id));
  for (const [id, line] of lines)
    if (!ids.has(id)) {
      chart.removeSeries(line.api);
      lines.delete(id);
    }
  if (series.some((item) => item.data.length)) chart.timeScale().fitContent();
}

/** A line chart of prices over time. The chart is built once per theme and look; series data is
 * set in place, so live updates never rebuild it. `banner`: stepped lines with a live dot at
 * each end, a dotted grid and a fixed view (no scrolling or zooming). */
export function LightweightPriceChart({
  ariaLabel,
  compactScale = false,
  emptyMessage,
  series,
  valueSuffix = " USDC",
  formatValue,
  formatTicks,
  variant = "default",
}: {
  ariaLabel: string;
  compactScale?: boolean;
  emptyMessage?: string | undefined;
  series: LightweightChartSeries[];
  valueSuffix?: "%" | " USDC";
  /** Formats axis and legend values (pass a stable function); else numbers with `valueSuffix`. */
  formatValue?: (value: number) => string;
  /** Formats the price axis' ticks together (pass a stable function); else as `formatValue`. */
  formatTicks?: (values: number[]) => string[];
  variant?: "default" | "banner";
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lines = useRef<Lines>(new Map());
  const latest = useRef(series);
  latest.current = series;
  const { resolvedTheme } = useTheme();
  const [legend, setLegend] = useState<LegendState>(() => initialLegend(series));
  const format =
    formatValue ?? ((value: number) => `${formatNumber(value)}${valueSuffix === "%" ? "%" : ""}`);
  const banner = variant === "banner";

  // biome-ignore lint/correctness/useExhaustiveDependencies: `format` derives from formatValue and valueSuffix, both listed.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    void resolvedTheme;
    const styles = getComputedStyle(document.documentElement);
    const muted = styles.getPropertyValue("--muted-foreground").trim();
    const border = styles.getPropertyValue("--border").trim();
    const chart = createChart(element, {
      autoSize: true,
      crosshair: {
        mode: CrosshairMode.Normal,
        horzLine: { color: muted, labelVisible: false, visible: !banner },
        vertLine: banner
          ? { color: muted, labelVisible: false, style: LineStyle.Dashed, width: 1 }
          : { visible: false },
      },
      grid: {
        horzLines: { color: border, style: banner ? LineStyle.Dotted : LineStyle.Solid },
        vertLines: { visible: false },
      },
      handleScale: false,
      handleScroll: !banner,
      layout: {
        attributionLogo: true,
        background: { color: "transparent", type: ColorType.Solid },
        fontFamily: getComputedStyle(element).fontFamily,
        textColor: muted,
      },
      localization: {
        priceFormatter: format,
        ...(formatTicks ? { tickmarksPriceFormatter: formatTicks } : {}),
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: banner
          ? { bottom: 0.16, top: 0.22 }
          : compactScale
            ? { bottom: 0.3, top: 0.3 }
            : { bottom: 0.15, top: 0.15 },
      },
      timeScale: {
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: banner,
        lockVisibleTimeRangeOnResize: true,
        rightOffset: banner ? 0 : 2,
        secondsVisible: false,
        timeVisible: true,
      },
    });
    chartRef.current = chart;
    syncSeries(chart, lines.current, latest.current, banner);
    const crosshair = (param: MouseEventParams) => {
      if (typeof param.time !== "number") {
        setLegend(initialLegend(latest.current));
        return;
      }
      const values: Record<string, number | null> = {};
      for (const item of latest.current) {
        const line = lines.current.get(item.id);
        const point = line ? param.seriesData.get(line.api) : undefined;
        values[item.id] =
          point && "value" in point && typeof point.value === "number" ? point.value : null;
      }
      setLegend({ time: param.time, values });
    };
    chart.subscribeCrosshairMove(crosshair);
    return () => {
      chart.unsubscribeCrosshairMove(crosshair);
      chart.remove();
      chartRef.current = null;
      lines.current.clear();
    };
  }, [banner, compactScale, formatTicks, formatValue, resolvedTheme, valueSuffix]);

  // Series data, set in place on the built chart (which syncs them itself when rebuilt).
  useEffect(() => {
    if (chartRef.current) syncSeries(chartRef.current, lines.current, series, banner);
    setLegend(initialLegend(series));
  }, [banner, series]);

  return (
    <div className="relative size-full overflow-hidden" role="img" aria-label={ariaLabel}>
      <div ref={container} className="absolute inset-0" />
      <div
        className={
          banner
            ? "pointer-events-none absolute top-0 left-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums"
            : "pointer-events-none absolute top-2 left-3 z-10 flex flex-wrap items-center gap-3 text-xs tabular-nums"
        }
      >
        {series.map((item) => (
          <span key={item.id} className="inline-flex items-center gap-1.5">
            <span
              className={banner ? "size-2 rounded-full" : "size-1.5 rounded-full"}
              style={{ backgroundColor: `var(--${item.colorToken})` }}
            />
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-medium text-foreground">
              {legend.values[item.id] === null || legend.values[item.id] === undefined
                ? "—"
                : format(legend.values[item.id] as number)}
            </span>
          </span>
        ))}
        {legend.time !== null && (
          <span className="text-muted-foreground">
            {new Date(legend.time * 1000).toLocaleString()}
          </span>
        )}
      </div>
      {emptyMessage && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
