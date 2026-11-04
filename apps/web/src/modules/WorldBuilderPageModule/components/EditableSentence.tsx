"use client";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { DatePicker, StrikeEditor } from "@/components/worlds/Editors";
import { EventRow } from "@/components/worlds/EventSearch";
import { VenueMark } from "@/components/worlds/primitives";
import { Chip, joinParts, Sentence } from "@/components/worlds/Sentence";
import { StockList } from "@/components/worlds/StockPicker";
import { calendarDay, midSentence, percent, strikeText, whenDay } from "@/lib/worlds/format";
import type { LegEntry, Stock } from "@/lib/worlds/types";

export interface LegState {
  entry: LegEntry;
  wantYes: boolean;
  note: string | null;
  alternatives: LegEntry[];
}
export interface StockState {
  underlying: string;
  symbol: string;
  name: string;
  direction: "above" | "below";
  strike: string;
  date: string;
  spot: number | null;
}

/** The world as the sentence the user said, every defining part a chip they can change in
 * place: an event's side or another event, the stock, above or below, the price, the date. */
export function EditableSentence({
  legs,
  stock,
  dates,
  onLeg,
  onRemoveLeg,
  onAddEvent,
  onStock,
}: {
  legs: LegState[];
  stock: StockState | null;
  dates: { earliest: string; last: string; suggested: string | null };
  onLeg: (i: number, leg: LegState) => void;
  onRemoveLeg: (i: number) => void;
  onAddEvent: () => void;
  onStock: (stock: StockState | null) => void;
}) {
  const events = joinParts(legs, (l, i) => (
    <LegChip
      key={l.entry.id}
      leg={l}
      onChange={(next) => onLeg(i, next)}
      onRemove={legs.length > 1 ? () => onRemoveLeg(i) : null}
    />
  ));
  return (
    <Sentence size="display">
      {stock ? (
        <>
          If {events}, <StockChip stock={stock} onStock={onStock} /> closes{" "}
          <Chip
            tone="value"
            interactive
            role="button"
            tabIndex={0}
            aria-label={`Switch to ${stock.direction === "above" ? "below" : "above"}`}
            onClick={() =>
              onStock({ ...stock, direction: stock.direction === "above" ? "below" : "above" })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onStock({ ...stock, direction: stock.direction === "above" ? "below" : "above" });
              }
            }}
          >
            {stock.direction}
          </Chip>{" "}
          <Popover>
            <PopoverTrigger nativeButton={false} render={<Chip tone="value" interactive />}>
              {strikeText(stock.strike)}
            </PopoverTrigger>
            <PopoverContent>
              <StrikeEditor
                strike={stock.strike}
                spot={stock.spot}
                direction={stock.direction}
                onChange={(strike) => onStock({ ...stock, strike })}
              />
            </PopoverContent>
          </Popover>{" "}
          on{" "}
          <Popover>
            <PopoverTrigger nativeButton={false} render={<Chip tone="value" interactive />}>
              {calendarDay(stock.date)}
            </PopoverTrigger>
            <PopoverContent className="w-96">
              <DatePicker
                value={stock.date}
                earliest={dates.earliest}
                lastDate={dates.last}
                suggested={dates.suggested}
                onChange={(date) => onStock({ ...stock, date })}
              />
            </PopoverContent>
          </Popover>
        </>
      ) : (
        <>
          {events}{" "}
          {legs.length === 1 ? "happens" : legs.length === 2 ? "both happen" : "all happen"}
          <AddStock onStock={onStock} dates={dates} />
        </>
      )}{" "}
      <Button
        variant="ghost"
        size="sm"
        className="ml-1 h-auto translate-y-[-0.18em] rounded-full px-2 py-1 align-middle text-sm font-medium text-muted-foreground"
        onClick={onAddEvent}
        disabled={legs.length >= 4}
      >
        <Plus data-icon="inline-start" />
        event
      </Button>
    </Sentence>
  );
}

function LegChip({
  leg,
  onChange,
  onRemove,
}: {
  leg: LegState;
  onChange: (leg: LegState) => void;
  onRemove: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const e = leg.entry;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        render={<Chip tone={leg.wantYes ? "event" : "no"} interactive />}
      >
        {midSentence(e.label)}
      </PopoverTrigger>
      <PopoverContent className="flex w-[26rem] flex-col gap-3">
        <PopoverTitle className="leading-5">{e.question}</PopoverTitle>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <VenueMark source={e.source} />
          <span className="tabular-nums">YES {percent(e.yes)}</span>
          <span>closes {whenDay(e.endTime)}</span>
        </span>
        <Segmented
          label="The side this world needs"
          value={leg.wantYes ? "It happens" : "It doesn't happen"}
          options={["It happens", "It doesn't happen"] as const}
          onChange={(v) => onChange({ ...leg, wantYes: v === "It happens" })}
          variant="compact"
        />
        {leg.alternatives.length > 0 && (
          <div className="flex flex-col gap-1 border-t pt-2">
            <span className="px-2 text-xs font-medium text-muted-foreground">Or did you mean</span>
            {leg.alternatives.slice(0, 3).map((a) => (
              <EventRow
                key={a.id}
                event={a}
                action="Use"
                onPick={(next) => {
                  setOpen(false);
                  onChange({
                    entry: next,
                    wantYes: leg.wantYes,
                    note: null,
                    alternatives: [e, ...leg.alternatives.filter((x) => x.id !== next.id)],
                  });
                }}
              />
            ))}
          </div>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start text-muted-foreground"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            <Trash2 data-icon="inline-start" />
            Remove this event
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function StockChip({
  stock,
  onStock,
}: {
  stock: StockState;
  onStock: (s: StockState | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger nativeButton={false} render={<Chip tone="stock" interactive />}>
        {stock.symbol}
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-2">
        <StockList
          selected={stock.underlying}
          onPick={(s: Stock) => {
            setOpen(false);
            const sameDirection = stock.direction;
            const strike = s.spot ? defaultStrike(s.spot, sameDirection) : stock.strike;
            onStock({
              ...stock,
              underlying: s.underlying,
              symbol: s.symbol,
              name: s.name,
              spot: s.spot,
              strike,
            });
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          onClick={() => {
            setOpen(false);
            onStock(null);
          }}
        >
          No stock: just the events
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function AddStock({
  onStock,
  dates,
}: {
  onStock: (s: StockState) => void;
  dates: { suggested: string | null; earliest: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        render={
          <span className="ml-[0.3em] cursor-pointer rounded-[0.32em] border border-dashed border-border px-[0.28em] text-[0.7em] align-[0.12em] text-muted-foreground hover:text-foreground" />
        }
      >
        + a stock
      </PopoverTrigger>
      <PopoverContent>
        <StockList
          onPick={(s) => {
            setOpen(false);
            onStock({
              underlying: s.underlying,
              symbol: s.symbol,
              name: s.name,
              direction: "above",
              strike: s.spot ? defaultStrike(s.spot, "above") : "100",
              date: dates.suggested ?? dates.earliest,
              spot: s.spot,
            });
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** A starting price: 5% past spot on the user's side, at a readable step. */
export function defaultStrike(spot: number, direction: "above" | "below") {
  const usd = spot * (direction === "above" ? 1.05 : 0.95);
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
