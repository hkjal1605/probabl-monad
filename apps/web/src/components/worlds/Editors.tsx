"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useInSheet } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { calendarDay, stockPrice } from "@/lib/worlds/format";

/** A price at a step people use: $0.05 under $10, $0.5 under $100, $1 under $1,000, … */
export function roundStrike(usd: number) {
  const step =
    usd < 10
      ? 0.05
      : usd < 100
        ? 0.5
        : usd < 1_000
          ? 1
          : usd < 10_000
            ? 5
            : usd < 100_000
              ? 50
              : 500;
  const value = Math.max(step, Math.round(usd / step) * step);
  return value.toFixed(step < 1 ? 2 : 0);
}

/** The stock's price for the world: typed, or slid around spot, with the move it means. In a
 * bottom sheet its steps are one row of thumb-sized buttons. */
export function StrikeEditor({
  strike,
  spot,
  direction,
  onChange,
}: {
  strike: string;
  spot: number | null;
  direction: "above" | "below";
  onChange: (strike: string) => void;
}) {
  const [text, setText] = useState(strike);
  const sheet = useInSheet();
  const value = Number(strike);
  const move = spot ? (value / spot - 1) * 100 : null;
  return (
    <div className={cn("flex flex-col gap-3", sheet && "gap-4")}>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Closes {direction}</span>
        <div className="relative flex-1">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
            $
          </span>
          <Input
            value={text}
            inputMode="decimal"
            enterKeyHint="done"
            aria-label="The stock's price"
            className={cn("pl-6 tabular-nums", sheet && "h-11 text-base")}
            onChange={(e) => {
              const t = e.target.value.replace(/[^\d.]/g, "");
              setText(t);
              if (Number(t) > 0) onChange(String(Math.round(Number(t) * 100) / 100));
            }}
          />
        </div>
      </div>
      {spot !== null && (
        <>
          <Slider
            // Sliding it sideways in a sheet is not a swipe to close the sheet.
            data-base-ui-swipe-ignore=""
            className={sheet ? "py-2" : ""}
            min={-30}
            max={30}
            step={0.5}
            value={Math.max(-30, Math.min(30, move ?? 0))}
            onValueChange={(v) => {
              const next = roundStrike(
                spot * (1 + (Array.isArray(v) ? v[0]! : (v as number)) / 100),
              );
              setText(next);
              onChange(next);
            }}
            aria-label="Move from today's price"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Now {stockPrice(spot)}</span>
            <span
              className={cn(
                "tabular-nums",
                move !== null &&
                  Math.abs(move) > 0.05 &&
                  (move > 0 ? "text-positive" : "text-danger"),
              )}
            >
              {move === null ? "" : `${move > 0 ? "+" : ""}${move.toFixed(1)}% from now`}
            </span>
          </div>
          <div className={sheet ? "grid grid-cols-6 gap-1.5" : "flex flex-wrap gap-1.5"}>
            {[-10, -5, 0, 5, 10, 20].map((p) => (
              <Button
                key={p}
                size={sheet ? "sm" : "xs"}
                variant="secondary"
                className={sheet ? "h-10 px-0 text-sm" : ""}
                onClick={() => {
                  const next = roundStrike(spot * (1 + p / 100));
                  setText(next);
                  onChange(next);
                }}
              >
                {p === 0 ? "Today" : `${p > 0 ? "+" : ""}${p}%`}
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const monthName = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
/** A YYYY-MM month `n` months on. */
function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1, 12)).toISOString().slice(0, 7);
}
const WEEKDAYS = ["M", "T", "W", "T", "F"];

/** Weekday closes from `earliest` to `lastDate`, a month at a time; the first close after every
 * event outlined, and one tap away. In a bottom sheet its days are thumb-sized. */
export function DatePicker({
  value,
  earliest,
  lastDate,
  suggested,
  onChange,
}: {
  value: string;
  earliest: string;
  lastDate: string;
  suggested: string | null;
  onChange: (date: string) => void;
}) {
  const first = earliest.slice(0, 7),
    last = lastDate.slice(0, 7);
  const [month, setMonth] = useState(() => {
    const m = (value || earliest).slice(0, 7);
    return m < first ? first : m > last ? last : m;
  });
  // Monday to Friday columns, the month's first weekday under its own.
  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const out: (string | null)[] = [];
    const d = new Date(Date.UTC(y, m - 1, 1, 12));
    while (d.getUTCMonth() === m - 1) {
      const wd = d.getUTCDay();
      if (wd >= 1 && wd <= 5) {
        if (!out.length) for (let i = 1; i < wd; i++) out.push(null);
        out.push(d.toISOString().slice(0, 10));
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }, [month]);
  const jump = suggested && suggested >= earliest && suggested <= lastDate ? suggested : null;
  const sheet = useInSheet();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Button
          size={sheet ? "icon" : "icon-sm"}
          variant="ghost"
          aria-label="Previous month"
          disabled={month <= first}
          onClick={() => setMonth(addMonths(month, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm font-medium">
          {monthName.format(new Date(`${month}-01T12:00:00Z`))}
        </span>
        <Button
          size={sheet ? "icon" : "icon-sm"}
          variant="ghost"
          aria-label="Next month"
          disabled={month >= last}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {WEEKDAYS.map((w, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of weekday letters.
            key={i}
            className="text-center text-[11px] font-medium text-muted-foreground"
          >
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: blanks before the month's first day.
            <span key={`blank-${i}`} />
          ) : (
            <Button
              key={d}
              size="sm"
              variant={d === value ? "default" : "ghost"}
              disabled={d < earliest || d > lastDate}
              aria-label={calendarDay(d)}
              aria-pressed={d === value}
              className={cn(
                "rounded-xl tabular-nums",
                sheet ? "h-11 text-base" : "h-9",
                d === jump && d !== value && "ring-1 ring-primary/60",
              )}
              onClick={() => onChange(d)}
            >
              {Number(d.slice(8))}
            </Button>
          ),
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>At the 4 pm New York close</span>
        {jump && jump !== value && (
          <button
            type="button"
            className={cn(
              "font-medium text-primary hover:underline",
              sheet && "-my-2 py-2 text-sm",
            )}
            onClick={() => {
              onChange(jump);
              setMonth(jump.slice(0, 7));
            }}
          >
            After the events: {calendarDay(jump)}
          </button>
        )}
      </div>
    </div>
  );
}
