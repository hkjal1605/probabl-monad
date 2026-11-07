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

/** The event search: Polymarket and Kalshi, as you type. With nothing typed it offers
 * `suggestions` (live events to start from), else a line saying what it searches. */
export function EventSearchPanel({
  onPick,
  initial = "",
  exclude = [],
  suggestions = [],
  autoFocus = true,
}: {
  onPick: (e: LegEntry) => void;
  initial?: string;
  exclude?: string[];
  suggestions?: LegEntry[];
  autoFocus?: boolean;
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
  const offered = suggestions.filter((e) => !exclude.includes(e.id));
  // In a bottom sheet the field waits for a tap (focusing it would raise the keyboard over the
  // suggestions), and the results fill the sheet, scrolling clear of the keyboard.
  const sheet = useInSheet();
  return (
    <>
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus={autoFocus && !sheet}
          type="search"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Fed cut, trade deal, CPI, shutdown…"
          aria-label="Search events"
          className="h-11 rounded-full pl-10 text-base [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <div
        className={cn(
          "-mx-2 flex min-h-40 flex-col overflow-y-auto overscroll-contain",
          sheet && "flex-1 touch-auto pb-[var(--drawer-keyboard-inset,0px)]",
        )}
      >
        {term.length < 2 && offered.length > 0 && (
          <>
            <span className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
              Live on Polymarket
            </span>
            {offered.map((e) => (
              <EventRow key={e.id} event={e} onPick={onPick} action="Use" />
            ))}
          </>
        )}
        {term.length < 2 && !offered.length && (
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
          <EventRow key={e.id} event={e} onPick={onPick} />
        ))}
      </div>
    </>
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (e: LegEntry) => void;
  title?: string;
  initial?: string;
  exclude?: string[];
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
        {open && <EventSearchPanel onPick={onPick} initial={initial} exclude={exclude} />}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
