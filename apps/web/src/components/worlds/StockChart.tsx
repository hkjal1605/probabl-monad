"use client";
/** A world's stock as one chart: its recorded price up to now, then the way to the day the world
 * pays, a line at now, at each event's deadline and at the payout, and past the payout the target
 * splitting where the price wins (green) from where it loses (red). The price is the token's, as
 * the market charts record it (once a minute). */
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRead } from "@/hooks/useWorlds";
import { cn } from "@/lib/utils";
import { calendarDay, money, stockPrice, strikeText } from "@/lib/worlds/format";
import type { Venue } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";
import { EventThumb } from "./primitives";

type Range = "1d" | "1w" | "1m" | "all";
const RANGES: { key: Range; label: string }[] = [
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
  { key: "all", label: "All" },
];
/** The chart's height, its plot's top, and the date row under it, in pixels. */
const HEIGHT = 216;
const TOP = 8;
const AXIS = 24;
/** The zone past the payout line: a fifth of the width, with room for its words. */
const ZONE = { share: 0.2, min: 84, max: 160 };
/** The share of the width before the zone the price so far takes; the rest is the way to the
 * payout. */
const PAST = 0.62;
/** The zone's outer corners. */
const RADIUS = 10;

export interface ChartEvent {
  key: string;
  question: string;
  /** When the venue expects it decided (ISO time). */
  endTime: string | null;
  source: Venue | null;
  marketId: string | null;
  image: string | null;
}

export function StockChart({
  token,
  symbol,
  logo,
  spot,
  strike,
  direction,
  date,
  fixingTime,
  events,
  payout,
  paid,
}: {
  /** Whose recorded price to chart; null when none is recorded. */
  token: string | null;
  symbol: string;
  logo: string | null;
  /** The price now (USD). */
  spot: number | null;
  strike: number;
  direction: "above" | "below";
  /** The close the world reads (YYYY-MM-DD, New York). */
  date: string;
  /** That close, unix seconds, when known. */
  fixingTime: number | null;
  events: ChartEvent[];
  /** What the chosen order pays if right, and what it costs (the zone's words). */
  payout: number | null;
  paid: number | null;
}) {
  const [range, setRange] = useState<Range>("1m");
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const clip = useId();
  const fade = useId();
  const history = useRead(
    token ? `spot-history:${token.toLowerCase()}:${range}` : null,
    (signal) => worldsApi.spotHistory(token!, range, signal),
    // Prices are recorded once a minute.
    { everyMs: 60_000, keep: true },
  );

  const chart = useMemo(() => {
    if (!width) return null;
    const now = Date.now() / 1000;
    const points = [...(history.data?.points ?? [])].filter((p) => p.time < now);
    if (spot !== null) points.push({ time: now, price: spot });
    const fix = Math.max(fixingTime ?? Date.parse(`${date}T21:00:00Z`) / 1000, now + 60);
    const deadlines = events.flatMap((e) => {
      const t = e.endTime ? Date.parse(e.endTime) / 1000 : Number.NaN;
      return Number.isFinite(t) && t > now ? [{ e, t }] : [];
    });
    // The world pays once the stock is read and every event is decided, whichever comes last.
    const pay = Math.max(fix, ...deadlines.map((d) => d.t));
    const start = points[0]?.time ?? now - 30 * 86_400;
    const bottom = HEIGHT - AXIS;
    const xPay = width - Math.round(Math.min(Math.max(width * ZONE.share, ZONE.min), ZONE.max));
    const xNow = Math.round(xPay * PAST);
    const xPast = (t: number) => (now > start ? ((t - start) / (now - start)) * xNow : xNow);
    const xFuture = (t: number) =>
      xNow + ((Math.min(Math.max(t, now), pay) - now) / (pay - now)) * (xPay - xNow);
    // Past the payout, square where it meets the line and rounded at the chart's edge.
    const r = RADIUS;
    const zone = `M${xPay},${TOP}H${width - r}A${r},${r} 0 0 1 ${width},${TOP + r}V${bottom - r}A${r},${r} 0 0 1 ${width - r},${bottom}H${xPay}Z`;
    // The prices, the target and the price now in view, with room on both sides of the target
    // for the words in its zone.
    const values = [...points.map((p) => p.price), strike];
    let lo = Math.min(...values),
      hi = Math.max(...values);
    const pad = (hi - lo || Math.max(hi * 0.02, 1)) * 0.1;
    lo -= pad;
    hi += pad;
    const span = hi - lo;
    lo = Math.min(lo, strike - span * 0.24);
    hi = Math.max(hi, strike + span * 0.24);
    const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - TOP);
    const line = points.map(
      (p, i) => `${i ? "L" : "M"}${xPast(p.time).toFixed(1)},${y(p.price).toFixed(1)}`,
    );
    const first = points[0],
      last = points.at(-1);
    const area =
      first && last
        ? `${line.join("")}L${xPast(last.time).toFixed(1)},${bottom}L${xPast(first.time).toFixed(1)},${bottom}Z`
        : null;
    const target = y(strike);
    // Price levels behind the line: round numbers, none crowding the target.
    const ticks = niceTicks(lo, hi, 3).filter((v) => Math.abs(y(v) - target) > 16);
    // Each event's deadline on the way to the payout, stacked where two would touch.
    let previous = -Infinity,
      lift = 0;
    const marks = deadlines
      .map((d) => ({ ...d, x: xFuture(d.t) }))
      .sort((a, b) => a.x - b.x)
      .map((m) => {
        lift = m.x - previous < 22 ? lift + 1 : 0;
        previous = m.x;
        return { ...m, lift };
      });
    // The stock's own day unless an event is decided after it.
    const payDay = pay > fix ? short(pay) : calendarDay(date).replace(/^\w+, /, "");
    return {
      start,
      points,
      bottom,
      xNow,
      xPay,
      xPast,
      y,
      line,
      area,
      target,
      ticks,
      marks,
      zone,
      payDay,
    };
  }, [width, history.data, spot, strike, fixingTime, date, events]);

  const pays = direction === "above";
  const shown = hover !== null && chart ? chart.points[hover] : null;
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!chart || chart.points.length < 2) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (x > chart.xNow) return setHover(null);
    let best = 0;
    for (let i = 1; i < chart.points.length; i++)
      if (
        Math.abs(chart.xPast(chart.points[i]!.time) - x) <
        Math.abs(chart.xPast(chart.points[best]!.time) - x)
      )
        best = i;
    setHover(best);
  };
  const Direction = pays ? ArrowUpRight : ArrowDownRight;
  const empty = !token
    ? `No price history for ${symbol} yet`
    : history.error && !history.data
      ? "Price history is unavailable right now"
      : history.data && !history.data.points.length
        ? `No price history for ${symbol} yet`
        : history.loading && !history.data
          ? "Loading prices…"
          : null;

  return (
    <section
      aria-label={`${symbol} price`}
      className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-border sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {logo && (
            // biome-ignore lint/performance/noImgElement: a small static token logo.
            <img src={logo} alt="" className="size-6 shrink-0 rounded-full" />
          )}
          <span className="text-sm font-medium">{symbol}</span>
          <span className="truncate text-sm tabular-nums">
            {stockPrice(shown ? shown.price : spot)}
            <span className="ml-1.5 text-xs text-muted-foreground">
              {shown && hover !== chart!.points.length - 1 ? when(shown.time, range) : "Now"}
            </span>
          </span>
        </div>
        <fieldset className="flex shrink-0 rounded-full bg-secondary p-0.5">
          <legend className="sr-only">Price history range</legend>
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "h-6 rounded-full px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                range === r.key
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </fieldset>
      </div>

      <div ref={box} className="relative w-full text-foreground" style={{ height: HEIGHT }}>
        {chart && (
          <>
            <svg
              width={width}
              height={HEIGHT}
              role="img"
              aria-label={`${symbol} ${stockPrice(spot)} now; the bet pays if it closes ${direction} ${strikeText(String(strike))} on ${calendarDay(date)}`}
              className="absolute inset-0 touch-pan-y overflow-visible"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            >
              <defs>
                <linearGradient id={fade} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
                <clipPath id={clip}>
                  <path d={chart.zone} />
                </clipPath>
              </defs>

              {/* Past the payout: where the price wins, and where it loses. */}
              <g clipPath={`url(#${clip})`}>
                <rect
                  x={chart.xPay}
                  y={TOP}
                  width={width - chart.xPay}
                  height={chart.target - TOP}
                  className={pays ? "fill-positive/15" : "fill-danger/12"}
                />
                <rect
                  x={chart.xPay}
                  y={chart.target}
                  width={width - chart.xPay}
                  height={chart.bottom - chart.target}
                  className={pays ? "fill-danger/12" : "fill-positive/15"}
                />
              </g>
              <text
                x={chart.xPay + 8}
                y={pays ? TOP + 17 : chart.bottom - 9}
                className="fill-positive text-[11px] font-medium"
              >
                {payout !== null ? `Pays ${money(payout)}` : "Pays"}
              </text>
              <text
                x={chart.xPay + 8}
                y={pays ? chart.bottom - 9 : TOP + 17}
                className="fill-danger text-[11px] font-medium"
              >
                {paid !== null ? `Lose ${money(paid)}` : "Loses"}
              </text>

              {/* Now, each event's deadline, and the payout. */}
              {chart.marks.map((m) => (
                <line
                  key={m.e.key}
                  x1={m.x}
                  x2={m.x}
                  y1={TOP}
                  y2={chart.bottom}
                  className="stroke-muted-foreground/45"
                  strokeDasharray="2 3"
                />
              ))}
              {[chart.xNow, chart.xPay].map((x) => (
                <line
                  key={x}
                  x1={x}
                  x2={x}
                  y1={TOP}
                  y2={chart.bottom}
                  className="stroke-muted-foreground/50"
                />
              ))}

              {/* The price so far. */}
              {chart.ticks.map((v) => (
                <g key={v}>
                  <line
                    x1={0}
                    x2={chart.xNow - 6}
                    y1={chart.y(v)}
                    y2={chart.y(v)}
                    className="stroke-border"
                    strokeDasharray="1 3"
                  />
                  <text x={0} y={chart.y(v) - 4} className="fill-muted-foreground text-[10px]">
                    {stockPrice(v)}
                  </text>
                </g>
              ))}
              {chart.area && <path d={chart.area} fill={`url(#${fade})`} />}
              {chart.line.length > 1 && (
                <path
                  d={chart.line.join("")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}

              {/* The target, across the whole chart. */}
              <line
                x1={0}
                x2={width}
                y1={chart.target}
                y2={chart.target}
                stroke="currentColor"
                strokeOpacity={0.7}
                strokeDasharray="4 4"
              />

              {shown && (
                <>
                  <line
                    x1={chart.xPast(shown.time)}
                    x2={chart.xPast(shown.time)}
                    y1={TOP}
                    y2={chart.bottom}
                    className="stroke-muted-foreground/50"
                  />
                  <circle
                    cx={chart.xPast(shown.time)}
                    cy={chart.y(shown.price)}
                    r={3.5}
                    fill="currentColor"
                  />
                </>
              )}
              {spot !== null && (
                <circle
                  cx={chart.xNow}
                  cy={chart.y(spot)}
                  r={4.5}
                  fill="currentColor"
                  className="stroke-card"
                  strokeWidth={2}
                />
              )}
            </svg>

            {/* The target's tag, at the end of its line. */}
            <span
              className="pointer-events-none absolute right-1 flex h-6 -translate-y-1/2 items-center gap-1 rounded-full bg-background px-2.5 text-xs font-medium whitespace-nowrap shadow-xs ring-1 ring-border tabular-nums"
              style={{ top: chart.target }}
            >
              <Direction
                className={cn("size-3.5", pays ? "text-positive" : "text-danger")}
                aria-hidden
              />
              Target {strikeText(String(strike))}
            </span>

            {/* Each event, at its deadline. */}
            {chart.marks.map((m) => (
              <span
                key={m.e.key}
                title={`${m.e.question} · decided by ${short(m.t)}`}
                className="absolute -translate-x-1/2"
                style={{ left: m.x, top: chart.bottom - 26 - m.lift * 24 }}
              >
                <EventThumb event={m.e} className="size-5 rounded-md ring-2 ring-card" />
              </span>
            ))}

            {empty && (
              <span
                className="pointer-events-none absolute flex items-center justify-center text-xs text-muted-foreground"
                style={{ left: 0, top: TOP, width: chart.xNow, height: chart.bottom - TOP }}
              >
                {empty}
              </span>
            )}

            {/* The dates: where the chart starts, now, each event, and the payout. */}
            <Dates
              width={width}
              top={chart.bottom + 6}
              labels={[
                { x: 0, text: when(chart.start, range, true), align: "start" },
                { x: chart.xNow, text: "Now", align: "center" },
                ...chart.marks.map((m) => ({
                  x: m.x,
                  text: short(m.t),
                  align: "center" as const,
                })),
                { x: chart.xPay, text: chart.payDay, align: "center" },
              ]}
            />
          </>
        )}
      </div>
    </section>
  );
}

/** The date row: each label where it belongs, dropped when it would touch one already placed
 * (the start, now and the close are placed first). */
function Dates({
  width,
  top,
  labels,
}: {
  width: number;
  top: number;
  labels: { x: number; text: string; align: "start" | "center" | "end" }[];
}) {
  const placed: { from: number; to: number }[] = [];
  const order = [labels[0]!, labels[1]!, labels.at(-1)!, ...labels.slice(2, -1)];
  const shown = order.filter((l) => {
    const w = l.text.length * 6.5 + 8;
    const from = l.align === "start" ? l.x : l.align === "end" ? l.x - w : l.x - w / 2;
    const span = { from: Math.max(0, from), to: Math.min(width, from + w) };
    if (placed.some((p) => span.from < p.to && p.from < span.to)) return false;
    placed.push(span);
    return true;
  });
  return (
    <>
      {shown.map((l) => (
        <span
          key={`${l.text}:${l.x}`}
          className={cn(
            "absolute text-[11px] whitespace-nowrap text-muted-foreground tabular-nums",
            l.align === "center" && "-translate-x-1/2",
            l.align === "end" && "-translate-x-full",
          )}
          style={{ left: l.x, top }}
        >
          {l.text}
        </span>
      ))}
    </>
  );
}

/** A width that follows its element's. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(Math.round(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round price levels from `lo` to `hi`, about `count` of them. */
function niceTicks(lo: number, hi: number, count: number) {
  const raw = (hi - lo) / count;
  if (!(raw > 0)) return [];
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dayTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
/** "Dec 9". */
const short = (seconds: number) => day.format(new Date(seconds * 1000));
/** A moment as the range reads best: a time in a day's chart, a date (and time) otherwise. */
function when(seconds: number, range: Range, axis = false) {
  const d = new Date(seconds * 1000);
  if (range === "1d") return time.format(d);
  return axis ? day.format(d) : dayTime.format(d);
}
