"use client";
/** A world in one card: each event it needs (the side, that side's chance now, when it closes)
 * and how the chosen product can end (each ending's chance and what it pays, the chances as one
 * bar). Only what a person decides with is shown; an event's rules, the events its words may have
 * meant and its removal are a tap away. */
import { Check, Hourglass, Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { chancePercent, money, strikeText, whenDay } from "@/lib/worlds/format";
import type { Offer } from "@/lib/worlds/offer";
import type { LegEntry, Venue } from "@/lib/worlds/types";
import { EventRow } from "./EventSearch";
import { EventThumb, SideSwitch, SideTag, VenueMark } from "./primitives";
import { RulesDialog } from "./RulesDialog";

export interface BreakdownLeg {
  key: string;
  question: string;
  source: Venue | null;
  marketId: string | null;
  image: string | null;
  url: string;
  endTime: string | null;
  rules: string | null;
  wantYes: boolean;
  /** The venue's YES chance now (0 to 1). */
  yes: number | null;
  /** A traded world's event: open, being decided, or how it went. */
  status?: "open" | "passed" | "failed" | "frozen";
  /** The venue's result once decided ("happened", "didn't happen", "cancelled"). */
  result?: string | null;
  /** Why the words were read as this event (a draft). */
  note?: string | null;
  /** A caveat about it in this world ("Decided after Thu, Dec 3"). */
  flag?: string | null;
  /** In a draft: other events the words may have meant, and the ways to change it. */
  alternatives?: LegEntry[];
  onSide?: (wantYes: boolean) => void;
  onSwap?: (event: LegEntry) => void;
  onRemove?: () => void;
}

export function WorldBreakdown({
  legs,
  notes = [],
  onAdd,
  offer,
  paid,
  outcomesLoading = false,
  stock,
}: {
  legs: BreakdownLeg[];
  /** Notes about the whole reading (an event not found, a price left out). */
  notes?: string[];
  /** In a draft: add an event (absent once it has the most a world takes). */
  onAdd?: (() => void) | undefined;
  /** The product the ticket shows, with its endings; null when it has none to show. */
  offer: Offer | null;
  /** What its order costs, fee included (the outcomes are for that order). */
  paid?: number | undefined;
  /** The endings are still being priced (a placeholder holds their place). */
  outcomesLoading?: boolean;
  /** The stock condition, for the endings' words. */
  stock: { symbol: string; direction: "above" | "below"; strike: string } | null;
}) {
  const showOutcomes = offer !== null || outcomesLoading;
  return (
    <section
      aria-label="Events and outcomes"
      className="flex flex-col rounded-xl bg-card ring-1 ring-border"
    >
      <div className="flex flex-col px-4 pt-4 sm:px-5 sm:pt-5">
        <ul className="flex flex-col divide-y divide-border/70">
          {legs.map((l) => (
            <EventLine key={l.key} leg={l} />
          ))}
        </ul>
        {notes.map((n) => (
          <p
            key={n}
            className="flex items-start gap-2 pb-2 text-xs leading-4 text-muted-foreground"
          >
            <Sparkles className="mt-px size-3.5 shrink-0 text-brand-strong" aria-hidden />
            {n}
          </p>
        ))}
        {onAdd && (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-2 self-start text-muted-foreground"
            onClick={onAdd}
          >
            <Plus data-icon="inline-start" />
            Add event
          </Button>
        )}
      </div>
      {showOutcomes && (
        <div className="flex flex-col gap-3 border-t px-4 py-4 sm:px-5 sm:pb-5">
          <Label aside={offer ? `${offer.name} · ${money(paid ?? offer.stake)}` : null}>
            Outcomes
          </Label>
          {offer ? (
            <Outcomes offer={offer} stock={stock} />
          ) : (
            <Skeleton className="h-24 rounded-xl" />
          )}
        </div>
      )}
    </section>
  );
}

function Label({ children, aside }: { children: string; aside?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
      <h2>{children}</h2>
      {aside && <span className="tabular-nums">{aside}</span>}
    </div>
  );
}

/** One event: its picture and question; its venue, close and the side it needs; that side's
 * chance (or, once decided, how it went). */
function EventLine({ leg }: { leg: BreakdownLeg }) {
  const [rules, setRules] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const side = leg.yes === null ? null : leg.wantYes ? leg.yes : 1 - leg.yes;
  const decided = leg.status === "passed" || leg.status === "failed";
  const similar = leg.onSwap && leg.alternatives?.length ? leg.alternatives : [];
  const action =
    "text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";
  return (
    <li className="flex flex-col gap-2 py-3.5 first:pt-0">
      <div className="flex items-start gap-3">
        {/* Down to where the name's capitals start (Aeonik at 16/24: about 6 px below its line's
            top), so the picture, the name and the chance share one top edge. */}
        <EventThumb event={leg} className="mt-1.5 size-10" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="text-base leading-6 font-medium">{leg.question}</p>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted-foreground">
            {leg.onSide ? (
              <SideSwitch wantYes={leg.wantYes} onChange={leg.onSide} />
            ) : (
              <SideTag wantYes={leg.wantYes} />
            )}
            <VenueMark source={leg.source} />
            {leg.endTime && !decided && <span>Closes {whenDay(leg.endTime)}</span>}
            {leg.flag && (
              <span className="inline-flex items-center gap-1 text-warning">
                <Hourglass className="size-3" aria-hidden />
                {leg.flag}
              </span>
            )}
          </div>
          {leg.note && <p className="text-xs leading-4 text-muted-foreground">{leg.note}</p>}
          {/* Its rules, the events the words may have meant and its removal: together, last. */}
          <div className="flex items-center gap-3 whitespace-nowrap">
            <button type="button" className={action} onClick={() => setRules(true)}>
              Rules
            </button>
            {similar.length > 0 && (
              <button
                type="button"
                className={action}
                aria-expanded={swapping}
                onClick={() => setSwapping((s) => !s)}
              >
                {similar.length} similar
              </button>
            )}
            {leg.onRemove && (
              <button
                type="button"
                className={cn(action, "hover:text-danger")}
                onClick={leg.onRemove}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <Standing leg={leg} side={side} />
      </div>
      {swapping && leg.onSwap && (
        <div className="-mx-2 flex flex-col gap-1 rounded-2xl bg-secondary/50 p-1">
          {similar.map((a) => (
            <EventRow
              key={a.id}
              event={a}
              action="Use"
              onPick={(e) => {
                setSwapping(false);
                leg.onSwap?.(e);
              }}
            />
          ))}
        </div>
      )}
      <RulesDialog
        open={rules}
        onOpenChange={setRules}
        leg={{
          question: leg.question,
          source: leg.source,
          url: leg.url,
          endTime: leg.endTime,
          rules: leg.rules,
          marketId: leg.marketId,
          image: leg.image,
        }}
      />
    </li>
  );
}

/** The right of an event: the chance of the side it needs, or how it went. */
function Standing({ leg, side }: { leg: BreakdownLeg; side: number | null }) {
  const pill = "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium";
  if (leg.status === "passed")
    return (
      <span className={cn(pill, "bg-positive-soft text-positive")}>
        <Check className="size-3.5" aria-hidden />
        {leg.result ? capital(leg.result) : "Happened"}
      </span>
    );
  if (leg.status === "failed")
    return (
      <span className={cn(pill, "bg-danger-soft text-danger")}>
        <X className="size-3.5" aria-hidden />
        {leg.result ? capital(leg.result) : "Went the other way"}
      </span>
    );
  if (leg.status === "frozen")
    return (
      <span className={cn(pill, "bg-warning-soft text-warning")}>
        <Hourglass className="size-3.5" aria-hidden />
        Deciding
      </span>
    );
  return (
    <span className="w-14 shrink-0 text-right text-lg leading-6 font-medium tabular-nums">
      {side === null ? "—" : `${Math.round(side * 100)}%`}
      <span className="sr-only"> chance</span>
    </span>
  );
}
const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

type Ending = Offer["endings"][number];
/** An ending's colour, on its dot, its share of the bar and what it pays: green pays, blue gives
 * the stake back, red loses on the stock, grey loses on an event. */
const toneOf = (e: Ending) =>
  e.key === "win" ? "win" : e.key === "lose-in-world" ? "lose" : e.pays > 0 ? "back" : "fail";
const FILL = {
  win: "bg-positive",
  lose: "bg-danger/70",
  back: "bg-info",
  fail: "bg-muted-foreground/40",
} as const;
const PAYS = {
  win: "text-positive",
  lose: "text-muted-foreground",
  back: "text-info",
  fail: "text-muted-foreground",
} as const;

function endingWords(
  e: Ending,
  stock: { symbol: string; direction: string; strike: string } | null,
) {
  if (e.key === "win")
    return stock
      ? `All happen, ${stock.symbol} ${stock.direction} ${strikeText(stock.strike)}`
      : "All happen";
  if (e.key === "lose-in-world") return stock ? `All happen, ${stock.symbol} misses` : "All happen";
  return "An event doesn't happen";
}

/** Each ending once: its chance as a share of one bar, then a line with what it pays. They add to
 * 100%. */
function Outcomes({
  offer,
  stock,
}: {
  offer: Offer;
  stock: { symbol: string; direction: string; strike: string } | null;
}) {
  return (
    <>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
        {offer.endings.map((e) =>
          e.chance > 0 ? (
            <span
              key={e.key}
              className={cn("h-full min-w-1 transition-[flex-grow] duration-500", FILL[toneOf(e)])}
              style={{ flexGrow: e.chance }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {offer.endings.map((e) => {
          const t = toneOf(e);
          return (
            <li key={e.key} className="flex items-center gap-2.5 text-sm">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", FILL[t])} />
              <span className="min-w-0 flex-1 truncate">{endingWords(e, stock)}</span>
              <span className="w-14 shrink-0 text-right text-muted-foreground tabular-nums">
                {chancePercent(e.chance)}
              </span>
              <span className={cn("w-20 shrink-0 text-right font-medium tabular-nums", PAYS[t])}>
                {e.pays > 0 ? money(e.pays) : "$0"}
                {t === "back" && <span className="font-normal"> back</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
