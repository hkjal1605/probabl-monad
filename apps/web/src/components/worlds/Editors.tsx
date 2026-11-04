"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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

/** The stock's price for the world: typed, or slid around spot, with the move it means. */
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
  const value = Number(strike);
  const move = spot ? (value / spot - 1) * 100 : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Closes {direction}</span>
        <div className="relative flex-1">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
            $
          </span>
          <Input
            value={text}
            inputMode="decimal"
            aria-label="The stock's price"
            className="pl-6 tabular-nums"
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
          <div className="flex flex-wrap gap-1.5">
            {[-10, -5, 0, 5, 10, 20].map((p) => (
              <Button
                key={p}
                size="xs"
                variant="secondary"
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

/** Weekday closes from tomorrow to `lastDate`; the first after every event marked. */
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
  const days = useMemo(() => {
    const out: string[] = [];
    const d = new Date(`${earliest}T12:00:00Z`);
    for (let i = 0; i < 60 && out.length < 30; i++) {
      const iso = d.toISOString().slice(0, 10);
      if (iso > lastDate) break;
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) out.push(iso);
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }, [earliest, lastDate]);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">
        The stock is read at the 4 pm New York close.
      </span>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {days.map((d) => (
          <Button
            key={d}
            size="sm"
            variant={d === value ? "default" : "secondary"}
            className={cn(
              "h-auto flex-col gap-0 py-1.5",
              d === suggested && d !== value && "ring-1 ring-primary/60",
            )}
            onClick={() => onChange(d)}
          >
            <span className="text-xs font-medium">{calendarDay(d).split(", ")[1]}</span>
            <span className="text-[10px] font-normal opacity-70">
              {calendarDay(d).split(", ")[0]}
            </span>
          </Button>
        ))}
      </div>
      {suggested && (
        <span className="text-xs text-muted-foreground">
          Outlined: the first close after every event is decided.
        </span>
      )}
    </div>
  );
}
