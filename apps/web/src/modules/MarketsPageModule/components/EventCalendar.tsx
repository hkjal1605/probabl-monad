"use client";
import { EVENT_SOURCE_NAMES } from "@conditional-stocks/market-data";
import { ArrowUpRight, CalendarClock, Clock3, Radio } from "lucide-react";
import Link from "next/link";
import { memo, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ProbabilityGauge } from "@/components/market/ProbabilityGauge";
import { Avatar, AvatarFallback, AvatarImage, AvatarLazyImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProbabilityStream } from "@/hooks/useProbabilityStream";
import {
  type Agenda,
  type AgendaDay,
  type CalendarEvent,
  type CalendarStrike,
  calendarEvents,
  agenda as layOut,
} from "@/lib/markets/calendar";
import { marketPath } from "@/lib/markets/identity";
import { eventMonogram, impactPercent, midpoint } from "@/lib/markets/presentation";
import { safeExternalUrl } from "@/lib/markets/resolution";
import { cn } from "@/lib/utils";
import type { MarketView } from "@/types/api";

// Times show in the viewer's own zone, named once in the header.
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const longDay = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const monthFormat = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const zoneName = () =>
  new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value ?? "local time";

/** The current time, updated at each `step` boundary (one timer at a time, not per row). */
function useNow(step: number) {
  const [now, tick] = useReducer(() => Date.now(), Date.now());
  // biome-ignore lint/correctness/useExhaustiveDependencies: each tick arms the next one.
  useEffect(() => {
    const timer = setTimeout(tick, step - (Date.now() % step) + 5);
    return () => clearTimeout(timer);
  }, [now, step]);
  return now;
}

/** "in 3h 12m", "in 2d 4h", "12m ago": coarse, for scanning a list. */
function relative(at: number, now: number) {
  const ms = at - now,
    minutes = Math.round(Math.abs(ms) / 60_000);
  const span =
    minutes < 60
      ? `${Math.max(1, minutes)}m`
      : minutes < 48 * 60
        ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
        : `${Math.floor(minutes / 1440)}d${Math.floor((minutes % 1440) / 60) ? ` ${Math.floor((minutes % 1440) / 60)}h` : ""}`;
  return ms >= 0 ? `in ${span}` : `${span} ago`;
}

/** A ticking countdown, its own component so only it re-renders each second. */
function Countdown({ to, className }: { to: number; className?: string }) {
  const now = useNow(1_000);
  const left = Math.max(0, to - now);
  const days = Math.floor(left / 86_400_000),
    hours = Math.floor((left % 86_400_000) / 3_600_000),
    minutes = Math.floor((left % 3_600_000) / 60_000),
    seconds = Math.floor((left % 60_000) / 1000);
  const parts: [number, string][] = days
    ? [
        [days, "d"],
        [hours, "h"],
        [minutes, "m"],
      ]
    : [
        [hours, "h"],
        [minutes, "m"],
        [seconds, "s"],
      ];
  return (
    <span className={cn("inline-flex items-baseline gap-2 tabular-nums", className)}>
      {left === 0 ? (
        <span>Awaiting result</span>
      ) : (
        parts.map(([value, unit]) => (
          <span key={unit} className="inline-flex items-baseline">
            <span>{String(value).padStart(2, "0")}</span>
            <span className="ml-0.5 text-[0.55em] font-medium text-muted-foreground">{unit}</span>
          </span>
        ))
      )}
    </span>
  );
}

const KIND_LABELS: Record<CalendarEvent["kind"], string> = {
  daily: "Daily ladder",
  weekly: "Weekly ladder",
  level: "Price level",
  event: "Catalyst",
};

function EventArt({ event, className }: { event: CalendarEvent; className?: string }) {
  const first = event.strikes[0]?.markets[0];
  return (
    <Avatar className={cn("size-10 rounded-xl after:rounded-xl", className)}>
      {event.imageUrl && (
        <AvatarLazyImage src={event.imageUrl} referrerPolicy="no-referrer" className="rounded-xl" />
      )}
      <AvatarFallback className="rounded-xl text-[10px] font-semibold">
        {first ? eventMonogram(first) : "EV"}
      </AvatarFallback>
    </Avatar>
  );
}

/** A stock the event moves: its icon, ticker and how far its YES price sits from its NO price. */
const StockChip = memo(function StockChip({ market }: { market: MarketView }) {
  const gap = impactPercent(market, "YES");
  const yes = midpoint(market.yes),
    no = midpoint(market.no);
  return (
    <Link
      href={marketPath(market)}
      title={
        yes !== null && no !== null
          ? `${market.ticker}: $${yes.toFixed(2)} if YES, $${no.toFixed(2)} if NO`
          : `${market.ticker}: no live quote`
      }
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pr-2.5 pl-0.5 text-xs font-medium transition-colors hover:border-foreground/30",
      )}
    >
      <Avatar size="sm" className="size-6">
        {market.assetMetadata?.image && <AvatarImage src={market.assetMetadata.image} alt="" />}
        <AvatarFallback className="text-[9px]">{market.ticker.slice(0, 2)}</AvatarFallback>
      </Avatar>
      <span className="text-foreground">{market.ticker}</span>
      <span
        className={cn(
          "tabular-nums",
          gap === null ? "text-muted-foreground" : gap >= 0 ? "text-positive" : "text-destructive",
        )}
      >
        {gap === null ? "—" : `${gap >= 0 ? "+" : "−"}${Math.abs(gap).toFixed(1)}%`}
      </span>
    </Link>
  );
});

/** Each stock the event moves once (a ladder repeats it per strike), from its first strike. */
function firstPerStock(event: CalendarEvent): MarketView[] {
  const first = new Map<string, MarketView>();
  for (const market of event.strikes.flatMap((strike) => strike.markets))
    if (!first.has(market.ticker)) first.set(market.ticker, market);
  return [...first.values()];
}

/** A strike's live probability, as text. */
function StrikeOdds({ market }: { market: MarketView }) {
  const { probability } = useProbabilityStream(market.mapping.conditionId, market.probability);
  return (
    <span className="tabular-nums">
      {probability.value === null ? "—" : `${Math.round(probability.value * 100)}%`}
    </span>
  );
}

function StrikeRow({ strike, ladder }: { strike: CalendarStrike; ladder: boolean }) {
  const first = strike.markets[0];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ladder && first && (
        <span className="inline-flex h-7 min-w-28 items-center justify-between gap-2 rounded-lg bg-secondary px-2.5 text-xs font-semibold tabular-nums">
          <span>{strike.label}</span>
          <span className="text-muted-foreground">
            <StrikeOdds market={first} />
          </span>
        </span>
      )}
      {strike.markets.map((market) => (
        <StockChip key={market.id} market={market} />
      ))}
    </div>
  );
}

/** The event's strikes (a ladder's first few) and the stocks each moves. */
function Strikes({ event, limit = 4 }: { event: CalendarEvent; limit?: number }) {
  const [open, setOpen] = useState(false);
  const ladder = event.kind !== "event";
  const shown = open ? event.strikes : event.strikes.slice(0, limit);
  return (
    <div className="flex flex-col gap-2">
      {shown.map((strike) => (
        <StrikeRow key={strike.key} strike={strike} ladder={ladder} />
      ))}
      {event.strikes.length > limit && (
        <Button
          variant="link"
          size="xs"
          onClick={() => setOpen((value) => !value)}
          className="self-start px-0 text-muted-foreground hover:text-foreground"
        >
          {open ? "Show fewer strikes" : `+${event.strikes.length - limit} more strikes`}
        </Button>
      )}
    </div>
  );
}

function EventMeta({ event, now }: { event: CalendarEvent; now: number }) {
  const source = safeExternalUrl(event.sourceUrl);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Clock3 aria-hidden="true" className="size-3.5" />
        {event.closesAt > now
          ? `Trading closes ${timeFormat.format(event.closesAt)} · ${relative(event.closesAt, now)}`
          : "Trading closed"}
      </span>
      {source && (
        <a
          href={source}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-0.5 transition-colors hover:text-foreground"
        >
          Resolves on {EVENT_SOURCE_NAMES[event.source]}
          <ArrowUpRight aria-hidden="true" className="size-3" />
        </a>
      )}
    </div>
  );
}

function Chips({ event }: { event: CalendarEvent }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary">{event.topic}</Badge>
      <Badge
        variant={event.kind === "event" ? "warning" : "outline"}
        className={event.kind === "event" ? "" : "text-muted-foreground"}
      >
        {KIND_LABELS[event.kind]}
      </Badge>
    </div>
  );
}

/** One agenda row: its time (its date too, when `dated`), then the event, its strikes and the
 * stocks they move. */
const EventRow = memo(function EventRow({
  event,
  now,
  dated = false,
}: {
  event: CalendarEvent;
  now: number;
  dated?: boolean;
}) {
  const single = event.strikes.length === 1 && event.kind === "event";
  const first = event.strikes[0]?.markets[0];
  const overdue = event.at <= now;
  return (
    <article className="relative grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-4 py-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <div className="flex flex-col items-end gap-0.5 pt-0.5 text-right">
        <time
          dateTime={new Date(event.at).toISOString()}
          className="text-sm font-semibold tabular-nums text-foreground"
        >
          {dated ? dayFormat.format(event.at) : timeFormat.format(event.at)}
        </time>
        <span
          className={cn("text-xs tabular-nums", overdue ? "text-warning" : "text-muted-foreground")}
        >
          {overdue
            ? "Awaiting result"
            : dated
              ? timeFormat.format(event.at)
              : relative(event.at, now)}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-3 border-border border-l pl-4">
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-[1.35rem] left-[calc(4.75rem+0.75rem)] size-2.5 rounded-full ring-4 ring-background sm:left-[calc(6rem+0.75rem)]",
            overdue
              ? "bg-warning"
              : event.kind === "event"
                ? "bg-primary"
                : "bg-muted-foreground/40",
          )}
        />
        <header className="flex items-start gap-3">
          <EventArt event={event} />
          <div className="min-w-0 flex-1">
            <h3 className="text-balance font-medium text-foreground leading-snug">
              {first ? (
                <Link href={marketPath(first)} className="underline-offset-4 hover:underline">
                  {event.title}
                </Link>
              ) : (
                event.title
              )}
            </h3>
            <div className="mt-1.5">
              <Chips event={event} />
            </div>
          </div>
          {single && first && (
            <ProbabilityGauge
              probability={first.probability}
              conditionId={first.mapping.conditionId}
            />
          )}
        </header>
        <Strikes event={event} />
        <EventMeta event={event} now={now} />
      </div>
    </article>
  );
});

function NowLine({ now }: { now: number }) {
  return (
    <div className="relative my-1 flex items-center gap-3">
      <span className="w-[4.75rem] text-right text-xs font-semibold text-destructive tabular-nums sm:w-24">
        Now · {timeFormat.format(now)}
      </span>
      <span className="h-px flex-1 bg-destructive/60" />
    </div>
  );
}

const dayLabel = (start: number, now: number) => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((start - today.getTime()) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : dayFormat.format(start);
};

function DaySection({ day, now }: { day: AgendaDay; now: number }) {
  const label = dayLabel(day.start, now);
  const isToday = label === "Today";
  const upcomingIndex = isToday ? day.events.findIndex((e) => e.at > now) : -1;
  return (
    <section
      id={`day-${day.key}`}
      data-day={day.key}
      className="scroll-mt-[calc(var(--home-sticky,0px)+1rem)]"
    >
      <h2 className="flex items-baseline gap-3 border-border border-b pb-2">
        <span className="text-lg font-semibold tracking-tight text-foreground">{label}</span>
        <span className="text-sm text-muted-foreground">{longDay.format(day.start)}</span>
        <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">
          {day.events.length} {day.events.length === 1 ? "event" : "events"}
        </span>
      </h2>
      <div className="divide-y divide-border/60">
        {day.events.map((event, index) => (
          <div key={event.key}>
            {isToday && index === (upcomingIndex === -1 ? day.events.length : upcomingIndex) && (
              <NowLine now={now} />
            )}
            <EventRow event={event} now={now} />
          </div>
        ))}
        {isToday && upcomingIndex === -1 && day.events.length > 0 && <NowLine now={now} />}
      </div>
    </section>
  );
}

/** The two weeks ahead at a glance: each day's count; a tap jumps to it. */
function DateStrip({
  days,
  active,
  onSelect,
  now,
}: {
  days: AgendaDay[];
  active: string | null;
  onSelect: (day: AgendaDay) => void;
  now: number;
}) {
  const max = Math.max(1, ...days.map((d) => d.events.length));
  return (
    <nav
      aria-label="Days"
      className="sticky top-0 z-20 -mx-1 bg-background/90 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/75"
    >
      <ol className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {days.map((day) => {
          const count = day.events.length,
            isToday = dayLabel(day.start, now) === "Today";
          return (
            <li key={day.key} className="shrink-0">
              <Button
                variant="outline"
                aria-pressed={active === day.key}
                aria-label={`${longDay.format(day.start)}: ${count} ${count === 1 ? "event" : "events"}`}
                disabled={!count}
                onClick={() => onSelect(day)}
                className={cn(
                  "h-auto w-14 flex-col gap-0.5 rounded-xl px-1 py-1.5",
                  "disabled:opacity-45",
                  active === day.key
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card hover:border-foreground/30",
                  isToday && active !== day.key && "border-primary",
                )}
              >
                <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
                  {isToday ? "Today" : weekday.format(day.start)}
                </span>
                <span className="text-base font-semibold leading-none tabular-nums">
                  {new Date(day.start).getDate()}
                </span>
                <span className="mt-1 flex h-1 w-8 overflow-hidden rounded-full bg-current/15">
                  <span
                    className="rounded-full bg-current"
                    style={{ width: `${(count / max) * 100}%` }}
                  />
                </span>
              </Button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The soonest event: a live countdown, its strikes and stocks; the next two beside it. */
function NextUp({ events, now }: { events: CalendarEvent[]; now: number }) {
  const [lead, ...rest] = events;
  if (!lead) return null;
  return (
    <section aria-label="Next up" className="grid gap-3 lg:grid-cols-3">
      <article className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 lg:col-span-2">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary/15 blur-3xl"
        />
        <div className="relative flex flex-col gap-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Radio aria-hidden="true" className="size-3.5 text-primary" />
            Next up · {dayLabel(new Date(lead.at).setHours(0, 0, 0, 0), now)} at{" "}
            {timeFormat.format(lead.at)}
          </div>
          <div className="flex items-start gap-4">
            <EventArt event={lead} className="size-14" />
            <div className="min-w-0 flex-1">
              <h2 className="text-balance text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-2xl">
                {lead.title}
              </h2>
              <div className="mt-2">
                <Chips event={lead} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Resolves in</p>
              <Countdown
                to={lead.at}
                className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
              />
            </div>
            <EventMeta event={lead} now={now} />
          </div>
          <Strikes event={lead} limit={3} />
        </div>
      </article>
      <div className="grid gap-3">
        {rest.slice(0, 2).map((event) => {
          const first = event.strikes[0]?.markets[0];
          return (
            <article
              key={event.key}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <EventArt event={event} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-foreground tabular-nums">
                    {dayLabel(new Date(event.at).setHours(0, 0, 0, 0), now)} ·{" "}
                    {timeFormat.format(event.at)} · {relative(event.at, now)}
                  </p>
                  <h3 className="mt-1 line-clamp-2 font-medium leading-snug text-foreground">
                    {first ? (
                      <Link href={marketPath(first)} className="underline-offset-4 hover:underline">
                        {event.title}
                      </Link>
                    ) : (
                      event.title
                    )}
                  </h3>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {firstPerStock(event)
                  .slice(0, 4)
                  .map((market) => (
                    <StockChip key={market.id} market={market} />
                  ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LaterSection({ month, now }: { month: Agenda["later"][number]; now: number }) {
  return (
    <section className="flex flex-col">
      <h2 className="flex items-baseline gap-3 border-border border-b pb-2">
        <span className="text-lg font-semibold tracking-tight text-foreground">
          {monthFormat.format(month.start)}
        </span>
        <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">
          {month.events.length} {month.events.length === 1 ? "event" : "events"}
        </span>
      </h2>
      <div className="divide-y divide-border/60">
        {month.events.map((event) => (
          <EventRow key={event.key} event={event} now={now} dated />
        ))}
      </div>
    </section>
  );
}

function ResolvedSection({ events }: { events: CalendarEvent[] }) {
  if (!events.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="border-border border-b pb-2 text-lg font-semibold tracking-tight text-foreground">
        Just resolved
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {events.map((event) => {
          const first = event.strikes[0]?.markets[0];
          return (
            <li
              key={event.key}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
            >
              <EventArt event={event} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {first ? (
                    <Link href={marketPath(first)} className="hover:underline">
                      {event.title}
                    </Link>
                  ) : (
                    event.title
                  )}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {dateFormat.format(event.at)} · {event.tickers.join(", ")}
                  {event.strikes.length > 1 ? ` · ${event.strikes.length} strikes` : ""}
                </p>
              </div>
              {event.result ? (
                <Badge variant={event.result === "yes" ? "positive" : "destructive"}>
                  {event.result.toUpperCase()}
                </Badge>
              ) : (
                <Badge variant="secondary">Resolved</Badge>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const KINDS = ["All events", "Catalysts", "Price ladders"] as const;
type KindFilter = (typeof KINDS)[number];

/** The catalyst calendar: what resolves when, and which stocks each event moves. */
export function EventCalendar({ markets, loading }: { markets: MarketView[]; loading: boolean }) {
  const now = useNow(60_000);
  const [kind, setKind] = useState<KindFilter>("All events");
  const [active, setActive] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const events = useMemo(() => calendarEvents(markets), [markets]);
  const filtered = useMemo(
    () =>
      kind === "All events"
        ? events
        : events.filter((e) => (kind === "Catalysts" ? e.kind === "event" : e.kind !== "event")),
    [events, kind],
  );
  const laid = useMemo(() => layOut(filtered, now), [filtered, now]);
  const upcoming = useMemo(
    () => filtered.filter((e) => !e.resolved && e.at > now).slice(0, 3),
    [filtered, now],
  );
  const counts = useMemo(() => {
    const week = now + 7 * 86_400_000;
    const open = events.filter((e) => !e.resolved);
    return {
      today: laid.days[0]?.events.length ?? 0,
      week: open.filter((e) => e.at <= week).length,
      markets: open.reduce(
        (sum, e) => sum + e.strikes.reduce((n, s) => n + s.markets.length, 0),
        0,
      ),
      catalysts: events.filter((e) => !e.resolved && e.kind === "event").length,
      ladders: events.filter((e) => !e.resolved && e.kind !== "event").length,
    };
  }, [events, laid, now]);

  // The day in view follows the scroll: the top-most day section on screen below the page's
  // pinned header and filters.
  // biome-ignore lint/correctness/useExhaustiveDependencies: new day sections render when `laid` changes, and are observed then.
  useEffect(() => {
    const sections = root.current?.querySelectorAll<HTMLElement>("[data-day]");
    if (!sections?.length) return;
    const visible = new Map<string, number>();
    const pinned = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--home-sticky"),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.day ?? "";
          if (entry.isIntersecting) visible.set(key, entry.boundingClientRect.top);
          else visible.delete(key);
        }
        const top = [...visible].sort((a, b) => a[1] - b[1])[0];
        if (top) setActive(top[0]);
      },
      { rootMargin: `-${Math.round(pinned || 120)}px 0px -55% 0px` },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [laid]);

  const select = (day: AgendaDay) => {
    setActive(day.key);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById(`day-${day.key}`)
      ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  if (loading)
    return (
      <div
        className="flex flex-col gap-4"
        role="status"
        aria-busy="true"
        aria-label="Loading the calendar"
      >
        <Skeleton className="h-56 rounded-2xl" />
        <div className="flex gap-1.5">
          {Array.from({ length: 10 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
            <Skeleton key={i} className="h-16 w-14 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );

  const days = laid.days.filter((day) => day.events.length);
  return (
    <div ref={root} className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <CalendarClock aria-hidden="true" className="size-6 text-primary" />
            Event calendar
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Every scheduled catalyst a market resolves on, and the stocks it moves. Trade a stock if
            YES or if NO before the event, and see the result within hours.
          </p>
        </div>
        <dl className="flex gap-5 text-right">
          {(
            [
              ["Today", counts.today],
              ["Next 7 days", counts.week],
              ["Open markets", counts.markets],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <NextUp events={upcoming} now={now} />

      <div className="flex flex-col gap-1">
        <DateStrip days={laid.days} active={active} onSelect={select} now={now} />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <fieldset className="m-0 flex flex-wrap gap-1.5 min-w-0 border-0 p-0">
            <legend className="sr-only">Kind of event</legend>
            {KINDS.map((option) => {
              const count =
                option === "All events"
                  ? counts.catalysts + counts.ladders
                  : option === "Catalysts"
                    ? counts.catalysts
                    : counts.ladders;
              return (
                <Button
                  key={option}
                  variant="outline"
                  size="sm"
                  aria-pressed={kind === option}
                  onClick={() => setKind(option)}
                  className={cn(
                    "h-8 gap-1.5 rounded-full px-3 text-xs",
                    kind === option
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  )}
                >
                  {option}
                  <span className="tabular-nums opacity-70">{count}</span>
                </Button>
              );
            })}
          </fieldset>
          <p className="text-xs text-muted-foreground">All times in {zoneName()}</p>
        </div>
      </div>

      {days.length || laid.later.length ? (
        <div className="flex flex-col gap-8">
          {days.map((day) => (
            <DaySection key={day.key} day={day} now={now} />
          ))}
          {laid.later.map((month) => (
            <LaterSection key={month.key} month={month} now={now} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          Nothing scheduled{kind === "All events" ? "" : ` for ${kind.toLowerCase()}`} yet. New
          daily and weekly ladders open every trading day.
        </p>
      )}

      <ResolvedSection events={laid.resolved} />
    </div>
  );
}
