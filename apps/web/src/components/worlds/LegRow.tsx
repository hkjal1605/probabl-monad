"use client";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Hourglass,
  Sparkles,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { whenDay } from "@/lib/worlds/format";
import type { LegEntry, Venue } from "@/lib/worlds/types";
import { EventRow } from "./EventSearch";
import { EventThumb, SideSwitch, VenueMark } from "./primitives";

/** What exactly counts, the pros' first question: the venue's wording, its deadline, its
 * resolution rules, and what a cancelled event does to the world. A bottom sheet on a phone. */
export function RulesDialog({
  open,
  onOpenChange,
  leg,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leg: {
    question: string;
    source: Venue | null;
    url: string;
    endTime: string | null;
    rules: string | null;
    marketId?: string | null;
    image?: string | null;
  };
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-lg"
        sheetClassName="gap-4"
        scroll={false}
        header={
          <ResponsiveDialogHeader className="flex-row items-start gap-3">
            <EventThumb event={leg} className="size-10" />
            <div className="flex min-w-0 flex-col gap-1">
              <ResponsiveDialogTitle className="pr-6 leading-6">
                {leg.question}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <VenueMark source={leg.source} />
                {leg.endTime && <span>Closes {whenDay(leg.endTime)}</span>}
                <a
                  href={leg.url}
                  target="_blank"
                  rel="noreferrer"
                  className="-m-1 inline-flex items-center gap-1 p-1 hover:text-foreground"
                >
                  Open <ExternalLink className="size-3" />
                </a>
              </ResponsiveDialogDescription>
            </div>
          </ResponsiveDialogHeader>
        }
      >
        <div className="min-h-0 touch-auto overflow-y-auto overscroll-contain rounded-2xl bg-secondary/60 p-4 text-sm leading-6 whitespace-pre-line text-muted-foreground">
          {leg.rules || "The venue's rules are on its page."}
        </div>
        <p className="text-xs leading-4 text-muted-foreground">
          Cancelled or settled 50/50 counts as not happening.
        </p>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** One event of a world as a card: its picture, question and venue; the way it has to go (a
 * switch in a draft) with the chance of that side; its rules, and in a draft the events the
 * words may have meant instead. */
export function LegRow({
  leg,
  wantYes,
  status,
  chance,
  note,
  result,
  alternatives = [],
  onSide,
  onSwap,
  onRemove,
  flag,
  aside,
}: {
  leg:
    | LegEntry
    | {
        question: string;
        source: Venue | null;
        url: string;
        endTime: string | null;
        rules: string | null;
        yes?: number | null;
        marketId?: string | null;
        image?: string | null;
      };
  wantYes: boolean;
  /** A traded world's leg: open, or decided. */
  status?: "open" | "passed" | "failed" | "frozen" | undefined;
  /** The venue's YES chance (0 to 1). */
  chance?: number | null | undefined;
  note?: string | null | undefined;
  /** The venue's result, once decided ("happened", "didn't happen", "cancelled"). */
  result?: string | null | undefined;
  alternatives?: LegEntry[] | undefined;
  onSide?: ((wantYes: boolean) => void) | undefined;
  onSwap?: ((e: LegEntry) => void) | undefined;
  onRemove?: (() => void) | undefined;
  /** A caveat about this event in this world ("Decided after Thu, Dec 3"). */
  flag?: string | null | undefined;
  aside?: ReactNode;
}) {
  const [rules, setRules] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const yes = chance ?? ("yes" in leg ? (leg.yes ?? null) : null);
  const side = yes === null ? null : wantYes ? yes : 1 - yes;
  const decided = status === "passed" || status === "failed";
  return (
    <article className="flex flex-col gap-4 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5">
      <div className="flex items-start gap-3.5">
        <EventThumb event={leg} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3 className="line-clamp-2 text-[15px] leading-snug font-medium">{leg.question}</h3>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <VenueMark source={leg.source} />
            {leg.endTime && (
              <>
                <span aria-hidden>·</span>
                <span>Closes {whenDay(leg.endTime)}</span>
              </>
            )}
            {flag && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-warning">
                <Hourglass className="size-3" aria-hidden />
                {flag}
              </span>
            )}
          </span>
        </div>
        {aside}
        {!decided && (
          <div className="flex shrink-0 flex-col items-end">
            <span className="text-2xl leading-none font-medium tracking-[-0.01em] tabular-nums">
              {side === null ? "—" : `${Math.round(side * 100)}%`}
            </span>
            <span className="mt-1 text-[11px] text-muted-foreground">chance</span>
          </div>
        )}
      </div>

      {onSide ? (
        <SideSwitch wantYes={wantYes} onChange={onSide} className="w-full sm:w-fit" />
      ) : (
        <Status status={status} wantYes={wantYes} result={result} />
      )}

      {note && (
        <p className="flex items-start gap-2 text-xs leading-4 text-muted-foreground">
          <Sparkles className="mt-px size-3.5 shrink-0 text-brand-strong" aria-hidden />
          {note}
        </p>
      )}

      <div className="-mx-1.5 -mb-1.5 flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={() => setRules(true)}
        >
          <FileText data-icon="inline-start" />
          Rules
        </Button>
        {onSwap && alternatives.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => setSwapping((s) => !s)}
            aria-expanded={swapping}
          >
            <ArrowLeftRight data-icon="inline-start" />
            {alternatives.length} similar
            <ChevronDown
              data-icon="inline-end"
              className={cn("transition-transform", swapping && "rotate-180")}
            />
          </Button>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground hover:text-danger"
            onClick={onRemove}
          >
            <X data-icon="inline-start" />
            Remove
          </Button>
        )}
      </div>

      {swapping && onSwap && (
        <div className="-mx-2 -mt-2 flex flex-col gap-1 border-t pt-2">
          {alternatives.map((a) => (
            <EventRow
              key={a.id}
              event={a}
              action="Use"
              onPick={(e) => {
                setSwapping(false);
                onSwap(e);
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
          marketId: "marketId" in leg ? leg.marketId : null,
          image: "image" in leg ? leg.image : null,
        }}
      />
    </article>
  );
}

/** A traded world's leg: the side it needs while open, then how it went. */
function Status({
  status,
  wantYes,
  result,
}: {
  status: "open" | "passed" | "failed" | "frozen" | undefined;
  wantYes: boolean;
  result: string | null | undefined;
}) {
  const pill =
    "inline-flex h-9 items-center gap-1.5 self-start rounded-full px-3.5 text-sm font-medium";
  if (status === "passed")
    return (
      <span className={cn(pill, "bg-positive-soft text-positive")}>
        <Check className="size-4" />
        Went the world's way{result ? ` · ${result}` : ""}
      </span>
    );
  if (status === "failed")
    return (
      <span className={cn(pill, "bg-danger-soft text-danger")}>
        <X className="size-4" />
        {result ? `${result.charAt(0).toUpperCase()}${result.slice(1)}` : "Went the other way"}
      </span>
    );
  if (status === "frozen")
    return (
      <span className={cn(pill, "bg-warning-soft text-warning")}>
        <Hourglass className="size-4" />
        Being decided
      </span>
    );
  return (
    <span
      className={cn(
        pill,
        wantYes ? "bg-positive-soft text-positive" : "bg-danger-soft text-danger",
      )}
    >
      {wantYes ? <Check className="size-4" /> : <X className="size-4" />}
      {wantYes ? "Happens" : "Doesn't happen"}
    </span>
  );
}
