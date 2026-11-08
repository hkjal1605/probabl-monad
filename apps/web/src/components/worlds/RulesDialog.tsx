"use client";
import { ExternalLink } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { whenDay } from "@/lib/worlds/format";
import type { Venue } from "@/lib/worlds/types";
import { EventThumb, VenueMark } from "./primitives";

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
