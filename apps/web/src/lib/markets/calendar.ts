import type { EventSource } from "@conditional-stocks/market-data";
import type { MarketView } from "@/types/api";
import { eventTime, isPriceLadder, ladderCadence, marketTopic, type Topic } from "./categories";
import { eventKey } from "./presentation";

/** One strike of an event (a single venue question) and the stock markets conditioned on it. */
export interface CalendarStrike {
  key: string;
  /** "≥ $82,500", "↑ $90,000"; the question itself when it names no level. */
  label: string;
  question: string;
  markets: MarketView[];
}
/** A calendar entry: one venue event and every strike and stock market on it. */
export interface CalendarEvent {
  key: string;
  /** When it resolves (or fixes), ms. */
  at: number;
  /** When its markets stop trading (the earliest cutoff), ms. */
  closesAt: number;
  title: string;
  topic: Topic;
  kind: "daily" | "weekly" | "level" | "event";
  source: EventSource;
  sourceUrl: string;
  imageUrl: string | null;
  strikes: CalendarStrike[];
  /** Distinct stocks it moves. */
  tickers: string[];
  resolved: boolean;
  result: "yes" | "no" | null;
}

const RESOLVED = new Set(["resolved", "redeemable", "archived"]);

/** Readable names of Kalshi's ladder series (each strike's question repeats the date). */
const SERIES_TITLES: Record<string, string> = {
  KXBTCD: "Bitcoin 5 PM ET close",
  KXETHD: "Ether 5 PM ET close",
  KXSOLD: "Solana 5 PM ET close",
  KXGOLDD: "Gold daily close",
  KXGOLDW: "Gold weekly close",
  KXSILVERD: "Silver daily close",
  KXNASDAQ100U: "Nasdaq-100 4 PM ET close",
  KXINXU: "S&P 500 4 PM ET close",
  KXWTI: "WTI crude settlement",
  KXWTIW: "WTI crude weekly settlement",
};

const amount = (digits: string) =>
  Number(digits.replace(/,/g, "")).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** A ladder strike's level, as a compact label. */
export function strikeLabel(question: string): string | null {
  let match = /\$([\d,]+(?:\.\d+)?)\s*or\s*(above|below)/i.exec(question);
  if (match?.[1]) return `${match[2]?.toLowerCase() === "above" ? "≥" : "≤"} $${amount(match[1])}`;
  match = /\b(reach|hit|exceed)\s+\$?([\d,]+(?:\.\d+)?)/i.exec(question);
  if (match?.[2]) return `↑ $${amount(match[2])}`;
  match = /\bdip to\s+\$?([\d,]+(?:\.\d+)?)/i.exec(question);
  if (match?.[1]) return `↓ $${amount(match[1])}`;
  match = /\b(above|below)\s+\$?([\d,]+(?:\.\d+)?)/i.exec(question);
  if (match?.[2]) return `${match[1]?.toLowerCase() === "above" ? ">" : "<"} $${amount(match[2])}`;
  return null;
}

/** A level to sort strikes by (lowest first), or null. */
const levelOf = (label: string) => {
  const digits = /[\d,]+(?:\.\d+)?/.exec(label)?.[0];
  return digits ? Number(digits.replace(/,/g, "")) : null;
};

/** Calendar entries of `markets`, soonest first: a Kalshi ladder's strikes on one fixing join one
 * entry; every other venue question is its own entry. */
export function calendarEvents(markets: readonly MarketView[]): CalendarEvent[] {
  const strikes = new Map<string, MarketView[]>();
  for (const market of markets) {
    const key = eventKey(market);
    const list = strikes.get(key);
    if (list) list.push(market);
    else strikes.set(key, [market]);
  }
  const events = new Map<string, MarketView[][]>();
  for (const group of strikes.values()) {
    const first = group[0] as MarketView;
    const ladder = first.mapping.source === "kalshi" && isPriceLadder(first);
    const key =
      ladder && first.event?.eventTicker ? `kalshi:${first.event.eventTicker}` : eventKey(first);
    const list = events.get(key);
    if (list) list.push(group);
    else events.set(key, [group]);
  }
  return [...events]
    .map(([key, groups]): CalendarEvent => {
      const all = groups.flat();
      const first = groups[0]?.[0] as MarketView;
      const ladder = isPriceLadder(first);
      const cadence = ladderCadence(first);
      const series = first.event?.series;
      const entryStrikes = groups
        .map((group): CalendarStrike => {
          const market = group[0] as MarketView;
          return {
            key: eventKey(market),
            label: (ladder && strikeLabel(market.question)) || market.question,
            question: market.question,
            markets: [...group].sort((a, b) => a.ticker.localeCompare(b.ticker)),
          };
        })
        .sort((a, b) => (levelOf(a.label) ?? 0) - (levelOf(b.label) ?? 0));
      const results = new Set(all.map((m) => m.event?.result ?? null));
      return {
        key,
        at: Math.max(...all.map((m) => eventTime(m))),
        closesAt: Math.min(...all.map((m) => Date.parse(m.cutoff))),
        title:
          groups.length > 1 || (ladder && first.mapping.source === "kalshi")
            ? ((series && SERIES_TITLES[series]) ?? first.question.split(":")[0] ?? first.question)
            : first.question,
        topic: marketTopic(first),
        kind: cadence ?? (ladder ? "level" : "event"),
        source: first.mapping.source,
        sourceUrl: first.mapping.sourceUrl,
        imageUrl: all.find((m) => m.imageUrl)?.imageUrl ?? null,
        strikes: entryStrikes,
        tickers: [...new Set(all.map((m) => m.ticker))].sort(),
        resolved: all.every((m) => RESOLVED.has(m.lifecycle)),
        result: results.size === 1 ? ([...results][0] ?? null) : null,
      };
    })
    .sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
}

/** A local calendar day as `YYYY-MM-DD`. */
export const dayKey = (ms: number) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const startOfDay = (ms: number) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export interface AgendaDay {
  key: string;
  /** Local midnight, ms. */
  start: number;
  events: CalendarEvent[];
}
export interface Agenda {
  /** Today and the next `days - 1` days, each with its unresolved events (possibly none). */
  days: AgendaDay[];
  /** Unresolved events after those days, by month (`YYYY-MM`). */
  later: { key: string; start: number; events: CalendarEvent[] }[];
  /** Events resolved within the last three days, latest first. */
  resolved: CalendarEvent[];
}

/** `events` laid out for the calendar from `now`: the coming days one by one, later ones by
 * month, and what just resolved. Overdue unresolved events (past their time, awaiting the venue's
 * result) stay on today. */
export function agenda(events: readonly CalendarEvent[], now: number, days = 14): Agenda {
  const today = startOfDay(now);
  const window = Array.from({ length: days }, (_, i) => {
    const start = new Date(today);
    start.setDate(start.getDate() + i);
    return { key: dayKey(start.getTime()), start: start.getTime(), events: [] as CalendarEvent[] };
  });
  const end = (() => {
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return date.getTime();
  })();
  const later = new Map<string, { key: string; start: number; events: CalendarEvent[] }>();
  const resolved: CalendarEvent[] = [];
  for (const event of events) {
    if (event.resolved) {
      if (event.at >= now - 3 * 86_400_000) resolved.push(event);
      continue;
    }
    if (event.at < end) {
      const day = event.at < today ? window[0] : window.find((d) => d.key === dayKey(event.at));
      day?.events.push(event);
      continue;
    }
    const date = new Date(event.at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const month = later.get(key);
    if (month) month.events.push(event);
    else
      later.set(key, {
        key,
        start: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
        events: [event],
      });
  }
  return {
    days: window,
    later: [...later.values()].sort((a, b) => a.start - b.start),
    resolved: resolved.sort((a, b) => b.at - a.at),
  };
}
