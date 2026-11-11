"use client";
import { ExternalLink, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useInSheet } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { percent, whenDay } from "@/lib/worlds/format";
import type { LegEntry } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";
import { EventThumb, VenueMark } from "./primitives";

/** A venue event as a row: its picture, question, venue, chance and deadline, and one action
 * (a tap anywhere on the row takes it; the venue link is its own). */
export function EventRow({
  event,
  onPick,
  className,
  action = "Add",
}: {
  event: LegEntry;
  onPick: (e: LegEntry) => void;
  className?: string | undefined;
  action?: string;
}) {
  const decided = event.yes !== null && (event.yes < 0.03 || event.yes > 0.97);
  // A sheet's row is narrow: its facts wrap without separators left at a line's end, and the
  // deadline keeps its link beside it.
  const sheet = useInSheet();
  const dot = sheet ? null : <span aria-hidden>·</span>;
  const pickable = !decided && event.yes !== null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a larger target for the pointer; the button in it is the control for keyboards and screen readers.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the button in it takes the keys.
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-accent/60",
        pickable && "cursor-pointer active:bg-accent/60",
        className,
      )}
      onClick={(e) => {
        // The button and the venue link answer for themselves.
        if (pickable && !(e.target as Element).closest("a, button")) onPick(event);
      }}
    >
      <EventThumb event={event} className="size-10" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-sm leading-5 font-medium">{event.question}</span>
        <span
          className={cn(
            "flex flex-wrap items-center gap-y-0.5 text-xs text-muted-foreground",
            sheet ? "gap-x-3" : "gap-x-2",
          )}
        >
          <VenueMark source={event.source} />
          {dot}
          <span className="tabular-nums">{percent(event.yes)} yes</span>
          {dot}
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            {whenDay(event.endTime)}
            <a
              href={event.url}
              target="_blank"
              rel="noreferrer"
              aria-label="Open on the venue"
              className="-m-2 inline-flex items-center p-2 hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-3" />
            </a>
          </span>
        </span>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0 rounded-full px-3.5"
        disabled={!pickable}
        onClick={() => onPick(event)}
      >
        {decided ? "Decided" : event.yes === null ? "No price" : action}
      </Button>
    </div>
  );
}

/** The event search: Polymarket and Kalshi, as you type. With nothing typed it offers `similar`
 * (events the words may have meant) and `suggestions` (live events to start from), else a line
 * saying what it searches. */
export function EventSearchPanel({
  onPick,
  initial = "",
  exclude = [],
  suggestions = [],
  similar = [],
  autoFocus = true,
  placeholder = "Fed cut, trade deal, CPI, shutdown…",
  action = "Add",
  tight = false,
}: {
  onPick: (e: LegEntry) => void;
  initial?: string;
  exclude?: string[];
  suggestions?: LegEntry[];
  /** Events the words may have meant, offered first ("Or did you mean"). */
  similar?: LegEntry[];
  autoFocus?: boolean;
  placeholder?: string;
  /** What taking a found event is called on its row: "Add", or "Use" where it takes another
   * event's place. */
  action?: string;
  /** Under an event's own details in a popover: the list takes only the room of what it shows,
   * and nothing while it has nothing to show. A sheet's list fills it as ever. */
  tight?: boolean;
}) {
  const [q, setQ] = useState(initial);
  const [state, setState] = useState<{ q: string; events: LegEntry[] | null; error: boolean }>({
    q: "",
    events: null,
    error: false,
  });
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      worldsApi
        .searchEvents(term, controller.signal)
        .then((events) => setState({ q: term, events, error: false }))
        .catch((error: Error) => {
          if (error.name !== "AbortError") setState({ q: term, events: [], error: true });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);
  const term = q.trim();
  const shown = state.q === term ? state.events?.filter((e) => !exclude.includes(e.id)) : null;
  const meant = similar.filter((e) => !exclude.includes(e.id));
  const offered = suggestions.filter(
    (e) => !exclude.includes(e.id) && !meant.some((m) => m.id === e.id),
  );
  // In a bottom sheet the field waits for a tap (focusing it would raise the keyboard over the
  // suggestions), and the results fill the sheet, scrolling clear of the keyboard.
  const sheet = useInSheet();
  const idle = term.length < 2;
  const snug = tight && !sheet;
  // A snug list with nothing to offer yet is no list: only the field shows.
  if (snug && idle && !meant.length && !offered.length)
    return (
      <SearchField
        value={q}
        onChange={setQ}
        placeholder={placeholder}
        autoFocus={autoFocus && !sheet}
      />
    );
  return (
    <>
      <SearchField
        value={q}
        onChange={setQ}
        placeholder={placeholder}
        autoFocus={autoFocus && !sheet}
      />
      <div
        className={cn(
          "-mx-2 flex flex-col overflow-y-auto overscroll-contain",
          snug ? "min-h-0" : "min-h-40",
          sheet && "flex-1 touch-auto pb-[var(--drawer-keyboard-inset,0px)]",
        )}
      >
        {idle && meant.length > 0 && (
          <>
            <span className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
              Or did you mean
            </span>
            {meant.map((e) => (
              <EventRow key={e.id} event={e} onPick={onPick} action="Use" />
            ))}
          </>
        )}
        {idle && offered.length > 0 && (
          <>
            <span className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
              Live on Polymarket
            </span>
            {offered.map((e) => (
              <EventRow key={e.id} event={e} onPick={onPick} action="Use" />
            ))}
          </>
        )}
        {idle && !meant.length && !offered.length && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Polymarket and Kalshi events
          </p>
        )}
        {term.length >= 2 &&
          shown === null &&
          !state.error &&
          Array.from({ length: 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders.
            <Skeleton key={i} className="mx-2 my-1.5 h-14 rounded-2xl" />
          ))}
        {state.error && state.q === term && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Search is unavailable. Try again shortly.
          </p>
        )}
        {shown?.length === 0 && !state.error && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Nothing open matches “{term}”
          </p>
        )}
        {shown?.map((e) => (
          <EventRow key={e.id} event={e} onPick={onPick} action={action} />
        ))}
      </div>
    </>
  );
}

/** The search's field. */
function SearchField({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus: boolean;
}) {
  return (
    <div className="relative shrink-0">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        autoFocus={autoFocus}
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search events"
        className="h-11 rounded-full pl-10 text-base [&::-webkit-search-cancel-button]:hidden"
      />
    </div>
  );
}

/** Search Polymarket and Kalshi for an event to put in a world: a dialog on a wide screen, a
 * bottom sheet on a phone. */
export function EventSearchDialog({
  open,
  onOpenChange,
  onPick,
  title = "Add an event",
  initial = "",
  exclude = [],
  suggestions = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (e: LegEntry) => void;
  title?: string;
  initial?: string;
  exclude?: string[];
  /** Live events to offer before anything is typed. */
  suggestions?: LegEntry[];
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        className="flex max-h-[85dvh] flex-col gap-3 sm:max-w-xl"
        header={
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
        }
        size="tall"
        keyboard
        scroll={false}
      >
        {/* Mounted only while open, so each opening starts from `initial`. */}
        {open && (
          <EventSearchPanel
            onPick={onPick}
            initial={initial}
            exclude={exclude}
            suggestions={suggestions}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
