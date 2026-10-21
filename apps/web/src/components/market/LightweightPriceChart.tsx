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
import { LevelLines } from "./levelLines";

export interface LightweightChartSeries {
  colorToken: "danger" | "positive" | "primary" | "info" | "foreground" | "warning";
  data: LineData<UTCTimestamp>[];
  id: string;
  label: string;
  lineStyle?: "solid" | "dashed";
}

/** A short horizontal line at `price` on series `seriesId` (so on its price scale): a box at its
 * left end shows `tag` and `label`, and the axis its price. The scale keeps it in view. */
export interface LightweightChartLevel {
  colorToken: LightweightChartSeries["colorToken"];
  label: string;
  lineStyle: "dashed" | "dotted";
  price: number;
  seriesId: string;
  tag: string;
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

type Lines = Map<
  string,
  { api: ISeriesApi<"Line">; look: string; points: number; levels?: LevelLines }
>;
const NO_LEVELS: LightweightChartLevel[] = [];

/** Sets each series' data on `chart`, adding, restyling and removing lines to match `series`. The
 * view refits only when lines or their point counts change (a live tick moves the last point only),
 * so a user's pan and zoom survive live updates; the fixed banner always fits. */
function syncSeries(
  chart: IChartApi,
  lines: Lines,
  series: LightweightChartSeries[],
  banner: boolean,
) {
  const styles = getComputedStyle(document.documentElement);
  let refit = banner;
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
        points: -1,
      };
      lines.set(item.id, line);
    }
    line.api.setData(item.data);
    if (line.points !== item.data.length) refit = true;
    line.points = item.data.length;
  }
  const ids = new Set(series.map((item) => item.id));
  for (const [id, line] of lines)
    if (!ids.has(id)) {
      chart.removeSeries(line.api);
      lines.delete(id);
      refit = true;
    }
  if (refit && series.some((item) => item.data.length)) chart.timeScale().fitContent();
}

/** Draws each series' `levels` on it, attaching their primitive when it first has some. */
function syncLevels(
  chart: IChartApi,
  lines: Lines,
  levels: LightweightChartLevel[],
  format: (value: number) => string,
) {
  const styles = getComputedStyle(document.documentElement);
  const textColor = styles.getPropertyValue("--background").trim();
  const tagColor = styles.getPropertyValue("--secondary").trim();
  const tagTextColor = styles.getPropertyValue("--foreground").trim();
  for (const [id, line] of lines) {
    const own = levels.filter((level) => level.seriesId === id);
    if (!line.levels) {
      if (!own.length) continue;
      line.levels = new LevelLines(chart.options().layout.fontFamily, format);
      line.api.attachPrimitive(line.levels);
    }
    line.levels.set(
      own.map((level) => ({
        price: level.price,
        dashed: level.lineStyle === "dashed",
        tag: level.tag,
        tagColor,
        tagTextColor,
        label: level.label,
        color: tokenColor(styles, level.colorToken),
        textColor,
      })),
    );
  }
}

const priceScaleMargins = (banner: boolean, compactScale: boolean) =>
  banner
    ? { bottom: 0.16, top: 0.22 }
    : compactScale
      ? { bottom: 0.3, top: 0.3 }
      : { bottom: 0.15, top: 0.15 };

/** A line chart of prices over time. The chart is built once per theme and look; series data is
 * set in place, so live updates never rebuild it. `banner`: stepped lines with a live dot at
 * each end, a dotted grid and a fixed view (no scrolling or zooming). */
export function LightweightPriceChart({
  ariaLabel,
  compactScale = false,
  emptyMessage,
  series,
  levels = NO_LEVELS,
  valueSuffix = " USDC",
  formatValue,
  formatTicks,
  variant = "default",
}: {
  ariaLabel: string;
  compactScale?: boolean;
  emptyMessage?: string | undefined;
  series: LightweightChartSeries[];
  /** Short horizontal lines (average entries, resting orders) on the series. */
  levels?: LightweightChartLevel[];
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
  const latestLevels = useRef(levels);
  latestLevels.current = levels;
  const { resolvedTheme } = useTheme();
  // The hovered point's values; without a hover the legend shows each series' latest value.
  const [hover, setHover] = useState<LegendState | null>(null);
  const legend = hover ?? initialLegend(series);
  const format =
    formatValue ?? ((value: number) => `${formatNumber(value)}${valueSuffix === "%" ? "%" : ""}`);
  const formatRef = useRef(format);
  formatRef.current = format;
  const ticksRef = useRef(formatTicks);
  ticksRef.current = formatTicks;
  // The axis labels always go through the refs: the chart merges options and keeps an omitted
  // formatter, so leaving one out would keep the last mode's labels (dollars in Impact %).
  const tickLabels = (values: number[]) =>
    ticksRef.current ? ticksRef.current(values) : values.map((value) => formatRef.current(value));
  const banner = variant === "banner";

  // Built once per look and theme. Formats and margins change through `applyOptions` below, so
  // switching what the chart shows doesn't rebuild it.
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
        priceFormatter: (value: number) => formatRef.current(value),
        tickmarksPriceFormatter: tickLabels,
      },
      rightPriceScale: { borderVisible: false },
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
    syncLevels(chart, lines.current, latestLevels.current, (value) => formatRef.current(value));
    const crosshair = (param: MouseEventParams) => {
      if (typeof param.time !== "number") {
        setHover(null);
        return;
      }
      const values: Record<string, number | null> = {};
      for (const item of latest.current) {
        const line = lines.current.get(item.id);
        const point = line ? param.seriesData.get(line.api) : undefined;
        values[item.id] =
          point && "value" in point && typeof point.value === "number" ? point.value : null;
      }
      setHover({ time: param.time, values });
    };
    chart.subscribeCrosshairMove(crosshair);
    return () => {
      chart.unsubscribeCrosshairMove(crosshair);
      chart.remove();
      chartRef.current = null;
      lines.current.clear();
    };
  }, [banner, resolvedTheme]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `formatValue` and `valueSuffix` change what `formatRef` formats, so the axis redraws.
  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: {
        priceFormatter: (value: number) => formatRef.current(value),
        tickmarksPriceFormatter: tickLabels,
      },
      rightPriceScale: { scaleMargins: priceScaleMargins(banner, compactScale) },
    });
  }, [banner, compactScale, formatTicks, formatValue, valueSuffix, resolvedTheme]);

  // Series data and levels, set in place on the built chart (which syncs them itself when rebuilt).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    syncSeries(chart, lines.current, series, banner);
    syncLevels(chart, lines.current, levels, (value) => formatRef.current(value));
  }, [banner, series, levels]);

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
