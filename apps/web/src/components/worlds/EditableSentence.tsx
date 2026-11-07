"use client";
import { Plus, Trash2 } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { DatePicker, StrikeEditor } from "@/components/worlds/Editors";
import { EventRow, EventSearchPanel } from "@/components/worlds/EventSearch";
import { VenueMark } from "@/components/worlds/primitives";
import { Chip, Sentence } from "@/components/worlds/Sentence";
import { StockList } from "@/components/worlds/StockPicker";
import { calendarDay, midSentence, percent, strikeText, whenDay } from "@/lib/worlds/format";
import type { LegEntry, LegState, Stock, StockState } from "@/lib/worlds/types";

/** The world as the sentence the user said, every defining part a chip they can change in
 * place: an event's side or another event, the stock, above or below, the price, the date.
 *
 * An event not chosen yet (`null`) is a placeholder chip showing `placeholders[i][step]` (one of
 * the live events to start from; the caller steps every open event together) that opens the
 * event search where it stands. The parts that move when a placeholder changes are marked
 * `data-atom` (see `useSampleCycle`). */
export function EditableSentence({
  legs,
  stock,
  dates,
  onLeg,
  onRemoveLeg,
  onAddEvent,
  onStock,
  placeholders,
  step = 0,
}: {
  legs: (LegState | null)[];
  stock: StockState | null;
  dates: { earliest: string; last: string; suggested: string | null };
  onLeg: (i: number, leg: LegState) => void;
  onRemoveLeg: (i: number) => void;
  onAddEvent: () => void;
  onStock: (stock: StockState | null) => void;
  placeholders?: LegEntry[][];
  step?: number;
}) {
  const chosen = legs.flatMap((l) => (l ? [l.entry.id] : []));
  // "A", "A and B", "A, B and C".
  const events = legs.map((l, i) => {
    const samples = placeholders?.[i] ?? [];
    return (
      <Fragment key={l ? l.entry.id : `slot-${i}`}>
        {i > 0 && (
          <>
            {i === legs.length - 1 && " "}
            <Atom k={`join-${i}`}>{i === legs.length - 1 ? "and" : ","}</Atom>{" "}
          </>
        )}
        {l ? (
          <LegChip
            leg={l}
            onChange={(next) => onLeg(i, next)}
            onRemove={legs.length > 1 || placeholders ? () => onRemoveLeg(i) : null}
          />
        ) : (
          <EventSlot
            atom={`slot-${i}`}
            shown={samples.length ? samples[step % samples.length] : undefined}
            samples={samples}
            exclude={chosen}
            onPick={(entry) => onLeg(i, { entry, wantYes: true, note: null, alternatives: [] })}
            onRemove={legs.length > 1 ? () => onRemoveLeg(i) : null}
          />
        )}
      </Fragment>
    );
  });
  return (
    <Sentence size="display">
      {stock ? (
        <>
          <Atom k="if">If</Atom> {events}
          <Atom k="comma">,</Atom> <StockChip stock={stock} onStock={onStock} />{" "}
          <Atom k="closes">closes</Atom>{" "}
          <Chip
            data-atom="direction"
            tone="value"
            interactive
            className="whitespace-nowrap"
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
            <PopoverTrigger
              nativeButton={false}
              data-atom="strike"
              render={<Chip tone="value" interactive className="whitespace-nowrap" />}
            >
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
          <Atom k="on">on</Atom>{" "}
          <Popover>
            <PopoverTrigger
              nativeButton={false}
              data-atom="date"
              render={<Chip tone="value" interactive className="whitespace-nowrap" />}
            >
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
          <Atom k="happens">
            {legs.length === 1 ? "happens" : legs.length === 2 ? "both happen" : "all happen"}
          </Atom>
          <AddStock onStock={onStock} dates={dates} />
        </>
      )}{" "}
      <Button
        data-atom="add"
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

/** A part of the sentence that can move when a placeholder changes. */
function Atom({ k, children }: { k: string; children: ReactNode }) {
  return <span data-atom={k}>{children}</span>;
}

/** An event not chosen yet: a chip the size of one, showing a live event it could be (`shown`),
 * that opens the event search where it stands. */
function EventSlot({
  atom,
  shown,
  samples,
  exclude,
  onPick,
  onRemove,
}: {
  atom: string;
  shown: LegEntry | undefined;
  samples: LegEntry[];
  exclude: string[];
  onPick: (e: LegEntry) => void;
  onRemove: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        data-slot="event"
        data-atom={atom}
        data-sample={shown?.id ?? ""}
        aria-label="Choose an event"
        render={<Chip tone="event" interactive className="text-muted-foreground/75" />}
      >
        <Words key={shown?.id ?? ""} text={shown ? midSentence(shown.label) : "an event"} />
      </PopoverTrigger>
      <PopoverContent className="flex max-h-[min(32rem,80dvh)] w-[26rem] flex-col gap-3">
        <EventSearchPanel
          suggestions={samples}
          exclude={exclude}
          onPick={(e) => {
            setOpen(false);
            onPick(e);
          }}
        />
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

/** A placeholder's words, each its own span (with the space after it, so the chip's underline
 * comes and goes with its words) so they can rise in one after another. */
function Words({ text }: { text: string }) {
  const words = text.split(" ");
  return words.map((word, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: a word's place is its identity (words repeat).
    <span key={i} data-word>
      {i < words.length - 1 ? `${word} ` : word}
    </span>
  ));
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
        data-atom={`leg-${e.id}`}
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

function StockChip({ stock, onStock }: { stock: StockState; onStock: (s: StockState) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        data-atom="stock"
        render={<Chip tone="stock" interactive />}
      >
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
        data-atom="add-stock"
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
