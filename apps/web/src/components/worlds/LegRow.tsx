"use client";
import { ArrowLeftRight, ExternalLink, FileText, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { percent, whenDay } from "@/lib/worlds/format";
import type { LegEntry, Venue } from "@/lib/worlds/types";
import { EventRow } from "./EventSearch";
import { SideTag, VenueMark } from "./primitives";

/** What exactly counts, the pros' first question: the venue's wording, its deadline, its
 * resolution rules, and what a cancelled event does to the world. */
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
  };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-6">{leg.question}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <VenueMark source={leg.source} />
            {leg.endTime && <span>Closes {whenDay(leg.endTime)}</span>}
            <a
              href={leg.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              Open on the venue <ExternalLink className="size-3" />
            </a>
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto rounded-lg bg-secondary/60 p-3 text-sm leading-5 whitespace-pre-line text-muted-foreground">
          {leg.rules || "The venue's rules are on its page."}
        </div>
        <p className="text-xs leading-4 text-muted-foreground">
          The world follows the venue's result. If the venue cancels this event or settles it 50/50,
          the world counts as not happening: Money-back stakes are refunded.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** One event of a world: its question, side, venue odds and deadline; in a draft also the side
 * toggle, other events the words may mean, and remove. */
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
  aside?: ReactNode;
}) {
  const [rules, setRules] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const yes = chance ?? ("yes" in leg ? (leg.yes ?? null) : null);
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-3 ring-1 ring-border sm:p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            status === "passed" && "bg-positive-soft text-positive",
            status === "failed" && "bg-danger-soft text-danger",
            (!status || status === "open" || status === "frozen") &&
              "bg-secondary text-muted-foreground",
          )}
          role="img"
          aria-label={
            status === "passed" ? "Happened" : status === "failed" ? "Didn't happen" : "Open"
          }
        >
          {status === "passed" ? "✓" : status === "failed" ? "✗" : "●"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-sm leading-5">{leg.question}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <SideTag wantYes={wantYes} />
            <VenueMark source={leg.source} />
            {yes !== null && (
              <span className="tabular-nums">
                YES {percent(yes)}
                {!wantYes && ` · NO ${percent(1 - yes)}`}
              </span>
            )}
            {leg.endTime && <span>closes {whenDay(leg.endTime)}</span>}
            {status === "frozen" && <span className="text-warning">being decided</span>}
            {result && (
              <span className={status === "failed" ? "text-danger" : "text-positive"}>
                {result}
              </span>
            )}
          </span>
          {note && <span className="text-xs leading-4 text-muted-foreground italic">{note}</span>}
        </div>
        {aside}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {onSide && (
          <Segmented
            label="The side this world needs"
            value={wantYes ? "Happens" : "Doesn't happen"}
            options={["Happens", "Doesn't happen"] as const}
            onChange={(v) => onSide(v === "Happens")}
            variant="compact"
          />
        )}
        <Button variant="ghost" size="xs" onClick={() => setRules(true)}>
          <FileText data-icon="inline-start" />
          Rules
        </Button>
        {onSwap && alternatives.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setSwapping((s) => !s)}
            aria-expanded={swapping}
          >
            <ArrowLeftRight data-icon="inline-start" />
            Did you mean…
          </Button>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            onClick={onRemove}
          >
            <Trash2 data-icon="inline-start" />
            Remove
          </Button>
        )}
      </div>
      {swapping && onSwap && (
        <div className="-mx-1 flex flex-col border-t pt-2">
          {alternatives.map((a) => (
            <EventRow
              key={a.id}
              event={a}
              action="Use this"
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
        }}
      />
    </div>
  );
}
