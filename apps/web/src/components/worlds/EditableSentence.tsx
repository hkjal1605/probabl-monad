"use client";
import { Plus, Trash2 } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/ui/responsive-popover";
import { Segmented } from "@/components/ui/segmented";
import { DatePicker, StrikeEditor } from "@/components/worlds/Editors";
import { EventSearchPanel } from "@/components/worlds/EventSearch";
import { VenueMark } from "@/components/worlds/primitives";
import { Chip, Sentence } from "@/components/worlds/Sentence";
import { StockList } from "@/components/worlds/StockPicker";
import { usePhone } from "@/hooks/usePhone";
import { cn } from "@/lib/utils";
import { chosenEvent, MAX_EVENTS } from "@/lib/worlds/events";
import { calendarDay, midSentence, percent, strikeText, whenDay } from "@/lib/worlds/format";
import type { LegEntry, LegState, Stock, StockState } from "@/lib/worlds/types";

/** The world as the sentence the user said, every defining part a chip they can change in
 * place: an event's side or another event, the stock, above or below, the price, the date.
 *
 * An event's chip opens the event itself: its side, the search for another event to take its
 * place (one step: the event picked stands where this one stood), and its removal.
 *
 * The events are the ones chosen (`lib/worlds/events`): removing one takes its place out of the
 * sentence, and "+ event" (`onAddEvent`) opens the search for another. With none, the sentence
 * shows one empty selector, "Select an event", which opens the event search where it stands
 * (offering `suggestions`); the event picked there comes as `onLeg(0, …)`.
 *
 * A page showing examples before anything is chosen passes `null` for each event with
 * `placeholders`: a chip showing `placeholders[i][step]` (the caller steps every such event
 * together) that opens the same search. The parts that move when a placeholder changes are marked
 * `data-atom` (see `useSampleCycle`).
 *
 * Each chip opens its picker under it on a wide screen and as a bottom sheet on a phone. */
export function EditableSentence({
  legs,
  stock,
  dates,
  onLeg,
  onRemoveLeg,
  onAddEvent,
  onStock,
  placeholders,
  suggestions = [],
  step = 0,
  className,
}: {
  /** The events chosen; `null` for an example the page shows in an event's place. */
  legs: (LegState | null)[];
  stock: StockState | null;
  dates: { earliest: string; last: string; suggested: string | null };
  onLeg: (i: number, leg: LegState) => void;
  onRemoveLeg: (i: number) => void;
  onAddEvent: () => void;
  onStock: (stock: StockState | null) => void;
  placeholders?: LegEntry[][];
  /** Live events the empty selector's search offers before anything is typed. */
  suggestions?: LegEntry[];
  step?: number;
  /** Type size or leading for a page that gives the sentence more room. */
  className?: string;
}) {
  // With no event there is one selector to choose the first in.
  const slots: (LegState | null)[] = legs.length ? legs : [null];
  const chosen = slots.flatMap((l) => (l ? [l.entry.id] : []));
  // "A", "A and B", "A, B and C".
  const events = slots.map((l, i) => {
    const samples = placeholders?.[i] ?? [];
    return (
      <Fragment key={l ? l.entry.id : `slot-${i}`}>
        {i > 0 && (
          <>
            {i === slots.length - 1 && " "}
            <Atom k={`join-${i}`}>{i === slots.length - 1 ? "and" : ","}</Atom>{" "}
          </>
        )}
        {l ? (
          // Any event can go: the last one leaves the empty selector in its place.
          <LegChip
            leg={l}
            exclude={chosen}
            suggestions={suggestions}
            onChange={(next) => onLeg(i, next)}
            onRemove={() => onRemoveLeg(i)}
          />
        ) : (
          <EventSlot
            atom={`slot-${i}`}
            shown={samples.length ? samples[step % samples.length] : undefined}
            samples={samples.length ? samples : suggestions}
            exclude={chosen}
            onPick={(entry) => onLeg(i, chosenEvent(entry))}
            // The only selector stays: a world has an event.
            onRemove={slots.length > 1 ? () => onRemoveLeg(i) : null}
          />
        )}
      </Fragment>
    );
  });
  return (
    <Sentence size="display" className={className}>
      {stock ? (
        <>
          <Atom k="if">If</Atom> {events}
          <Atom k="comma">,</Atom> <StockChip stock={stock} onStock={onStock} />{" "}
          <Atom k="closes">closes</Atom>{" "}
          <Chip
            data-atom="direction"
            tone={stock.direction}
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
          <ResponsivePopover>
            <ResponsivePopoverTrigger
              nativeButton={false}
              data-atom="strike"
              render={<Chip tone="price" interactive className="whitespace-nowrap" />}
            >
              {strikeText(stock.strike)}
            </ResponsivePopoverTrigger>
            <ResponsivePopoverContent title={`${stock.symbol}'s price`} done>
              <StrikeEditor
                strike={stock.strike}
                spot={stock.spot}
                direction={stock.direction}
                onChange={(strike) => onStock({ ...stock, strike })}
              />
            </ResponsivePopoverContent>
          </ResponsivePopover>{" "}
          <Atom k="on">on</Atom> <DateChip stock={stock} dates={dates} onStock={onStock} />
        </>
      ) : (
        <>
          {events}{" "}
          <Atom k="happens">
            {slots.length === 1 ? "happens" : slots.length === 2 ? "both happen" : "all happen"}
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
        disabled={slots.length >= MAX_EVENTS}
        title={slots.length >= MAX_EVENTS ? `A world takes up to ${MAX_EVENTS} events` : undefined}
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

/** An event not chosen yet: a chip the size of one that opens the event search where it stands.
 * It shows a live event it could be (`shown`, an example), else asks for one. */
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
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger
        nativeButton={false}
        data-slot="event"
        data-atom={atom}
        data-sample={shown?.id ?? ""}
        aria-label="Choose an event"
        render={<Chip tone="event" interactive className="text-muted-foreground/75" />}
      >
        <Words key={shown?.id ?? ""} text={shown ? midSentence(shown.label) : "Select an event"} />
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent
        title="Choose an event"
        className="flex max-h-[min(32rem,80dvh)] w-[26rem] flex-col gap-3"
        size="tall"
        keyboard
        scroll={false}
      >
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
      </ResponsivePopoverContent>
    </ResponsivePopover>
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

/** An event chosen: its chip opens the event (its venue, chance and deadline), the side the
 * world needs of it, the search for another event to take its place, and its removal. */
function LegChip({
  leg,
  exclude,
  suggestions,
  onChange,
  onRemove,
}: {
  leg: LegState;
  /** The events already in the world (this one among them): never offered in its place. */
  exclude: string[];
  /** Live events the search offers before anything is typed. */
  suggestions: LegEntry[];
  onChange: (leg: LegState) => void;
  onRemove: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  const e = leg.entry;
  /** Another event takes this one's place. One the words may have meant is the same question
   * asked another way: it keeps the side, and this one stays among the ones meant. Any other
   * event starts as "it happens". */
  const swap = (next: LegEntry) => {
    setOpen(false);
    onChange(
      leg.alternatives.some((a) => a.id === next.id)
        ? {
            entry: next,
            wantYes: leg.wantYes,
            note: null,
            alternatives: [e, ...leg.alternatives.filter((x) => x.id !== next.id)],
          }
        : chosenEvent(next),
    );
  };
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger
        nativeButton={false}
        data-atom={`leg-${e.id}`}
        render={<Chip tone={leg.wantYes ? "event" : "no"} interactive />}
      >
        {midSentence(e.label)}
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent
        title={e.question}
        showTitle
        className="flex max-h-[min(34rem,80dvh)] w-[26rem] flex-col gap-3"
        sheetClassName="gap-4"
        size="tall"
        keyboard
        scroll={false}
        done
      >
        {/* This event: where it trades, its chance, its deadline, and the side the world needs. */}
        <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <VenueMark source={e.source} />
          <span className="tabular-nums">YES {percent(e.yes)}</span>
          <span>closes {whenDay(e.endTime)}</span>
        </span>
        <Segmented
          label="The side this world needs"
          value={leg.wantYes ? "It happens" : "It doesn't happen"}
          options={["It happens", "It doesn't happen"] as const}
          onChange={(v) => onChange({ ...leg, wantYes: v === "It happens" })}
          variant={phone ? "default" : "compact"}
          className={cn("shrink-0", phone && "w-full *:flex-1")}
        />
        {/* Another event in its place: the search an empty place opens, under a rule. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 border-t pt-3">
          <EventSearchPanel
            tight
            placeholder="Swap for another event"
            action="Use"
            similar={leg.alternatives.slice(0, 3)}
            suggestions={suggestions}
            exclude={exclude}
            onPick={swap}
          />
        </div>
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 self-start text-muted-foreground"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            <Trash2 data-icon="inline-start" />
            Remove this event
          </Button>
        )}
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

function StockChip({ stock, onStock }: { stock: StockState; onStock: (s: StockState) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger
        nativeButton={false}
        data-atom="stock"
        render={<Chip tone="stock" interactive />}
      >
        {stock.symbol}
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent
        title="Choose a stock"
        className="flex flex-col gap-2"
        size="tall"
        keyboard
        scroll={false}
      >
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
      </ResponsivePopoverContent>
    </ResponsivePopover>
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
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger
        nativeButton={false}
        data-atom="add-stock"
        render={
          <span className="ml-[0.3em] cursor-pointer rounded-[0.32em] border border-dashed border-border px-[0.28em] text-[0.7em] align-[0.12em] text-muted-foreground hover:text-foreground" />
        }
      >
        + a stock
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent
        title="Add a stock"
        className="flex flex-col gap-2"
        size="tall"
        keyboard
        scroll={false}
      >
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
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

/** The day the stock is read: a calendar of closes. On a phone, picking a day is the choice made
 * and closes the sheet; on a wide screen the popover stays for another look. */
function DateChip({
  stock,
  dates,
  onStock,
}: {
  stock: StockState;
  dates: { earliest: string; last: string; suggested: string | null };
  onStock: (s: StockState) => void;
}) {
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger
        nativeButton={false}
        data-atom="date"
        render={<Chip tone="value" interactive className="whitespace-nowrap" />}
      >
        {calendarDay(stock.date)}
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent title="The day it closes" className="w-96">
        <DatePicker
          value={stock.date}
          earliest={dates.earliest}
          lastDate={dates.last}
          suggested={dates.suggested}
          onChange={(date) => {
            onStock({ ...stock, date });
            if (phone) setOpen(false);
          }}
        />
      </ResponsivePopoverContent>
    </ResponsivePopover>
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
