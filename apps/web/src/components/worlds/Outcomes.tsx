import { Check, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { chancePercent, money } from "@/lib/worlds/format";
import type { Offer } from "@/lib/worlds/offer";

type Ending = Offer["endings"][number];
/** An ending's colour, the same on its badge and its bar: green pays, red loses, blue gives the
 * stake back, grey loses because an event failed. */
const tone = (e: Ending) =>
  e.key === "win" ? "win" : e.key === "lose-in-world" ? "lose" : e.pays > 0 ? "back" : "fail";
const BAR = {
  win: "bg-positive",
  lose: "bg-danger/70",
  back: "bg-info",
  fail: "bg-muted-foreground/40",
} as const;
const BADGE = {
  win: "bg-positive-soft text-positive",
  lose: "bg-danger-soft text-danger",
  back: "bg-info-soft text-info",
  fail: "bg-secondary text-muted-foreground",
} as const;

/** How likely something is, as a length: a thin track with `share` (0 to 1) filled in `tone`. A
 * chance above nothing always shows a sliver. */
export function ChanceBar({
  share,
  tone,
  className,
}: {
  share: number;
  tone: string;
  className?: string | undefined;
}) {
  const width = share > 0 ? Math.min(100, Math.max(1, share * 100)) : 0;
  return (
    <div className={cn("h-1.5 flex-1 overflow-hidden rounded-full bg-secondary", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", tone)}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function label(e: Ending, priced: boolean, stockWords?: string) {
  if (e.key === "win")
    return priced ? `All happen, ${stockWords ?? "the stock on your side"}` : "All happen";
  if (e.key === "lose-in-world") return "All happen, the stock on the other side";
  return "An event doesn't happen";
}

/** Every way a product can end, with its chance, what it pays and when: a row per outcome
 * instead of a payoff chart (Anic & Wallmeier 2019), each with a bar as long as its chance. The
 * rows add to 100%. */
export function OutcomeTable({
  offer,
  priced,
  when,
  stockWords,
  className,
}: {
  offer: Offer;
  priced: boolean;
  /** When each ending pays: the fixing, and the earliest a failed event refunds. */
  when: { fixing: string; refund: string };
  stockWords?: string;
  className?: string | undefined;
}) {
  return (
    <ul className={cn("flex flex-col divide-y divide-border/70", className)}>
      {offer.endings.map((e) => {
        const t = tone(e);
        return (
          <li key={e.key} className="flex flex-col gap-2.5 py-3.5 first:pt-0 last:pb-0">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  BADGE[t],
                )}
              >
                {t === "win" ? (
                  <Check className="size-4" />
                ) : t === "back" ? (
                  <RotateCcw className="size-4" />
                ) : (
                  <X className="size-4" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="line-clamp-2 text-sm leading-5">
                  {label(e, priced, stockWords)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {e.key === "world-fails" ? when.refund : when.fixing}
                </span>
              </div>
              <span
                className={cn(
                  "shrink-0 text-right text-base font-medium tabular-nums",
                  t === "win" && "text-positive",
                  t === "back" && "text-info",
                  e.pays === 0 && "text-muted-foreground",
                )}
              >
                {e.pays > 0 ? money(e.pays) : "$0"}
                {t === "back" && " back"}
              </span>
            </div>
            <div className="flex items-center gap-3 pl-11">
              <ChanceBar share={e.chance / 1_000_000} tone={BAR[t]} />
              <span className="w-12 shrink-0 text-right text-sm font-medium tabular-nums">
                {chancePercent(e.chance)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
