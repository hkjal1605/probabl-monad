import { Check, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { inThousand, money, perThousand } from "@/lib/worlds/format";
import type { Offer } from "@/lib/worlds/offer";

type Ending = Offer["endings"][number];
/** An ending's colour, the same in the grid and the rows: green pays, red loses, blue gives the
 * stake back, grey loses because an event failed. */
const tone = (e: Ending) =>
  e.key === "win" ? "win" : e.key === "lose-in-world" ? "lose" : e.pays > 0 ? "back" : "fail";
const DOT = {
  win: "fill-positive",
  lose: "fill-danger/60",
  back: "fill-info/70",
  fail: "fill-muted-foreground/25",
} as const;
const BADGE = {
  win: "bg-positive-soft text-positive",
  lose: "bg-danger-soft text-danger",
  back: "bg-info-soft text-info",
  fail: "bg-secondary text-muted-foreground",
} as const;

/** 1,000 worlds as dots, coloured by how a product ends in each: icon arrays help readers at
 * every level of numeracy (Galesic et al. 2009). */
export function DotGrid({
  endings,
  className,
}: {
  endings: Offer["endings"];
  className?: string | undefined;
}) {
  const columns = 100,
    rows = 10,
    gap = 1.6,
    r = 0.6;
  // Whole dots per ending, largest remainders first, so they add to 1,000.
  const exact = endings.map((e) => e.chance / 1_000);
  const counts = exact.map(Math.floor);
  let left = 1_000 - counts.reduce((a, b) => a + b, 0);
  exact
    .map((x, i) => ({ i, rest: x - Math.floor(x) }))
    .sort((a, b) => b.rest - a.rest)
    .forEach(({ i }) => {
      if (left > 0) {
        counts[i]!++;
        left--;
      }
    });
  // The winning dots first (top left), then losses, then refunds.
  const order = endings
    .map((e, i) => ({ e, n: counts[i]! }))
    .sort((a, b) => rank(a.e.key) - rank(b.e.key));
  const dots: { x: number; y: number; tone: keyof typeof DOT }[] = [];
  let k = 0;
  for (const { e, n } of order)
    for (let j = 0; j < n && k < columns * rows; j++, k++)
      dots.push({ x: k % columns, y: Math.floor(k / columns), tone: tone(e) });
  return (
    <svg
      viewBox={`0 0 ${columns * gap} ${rows * gap}`}
      className={cn("w-full", className)}
      role="img"
      aria-label={endings.map((e) => `${inThousand(e.chance)} ${label(e, false)}`).join(", ")}
    >
      {dots.map((d, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of dots.
          key={i}
          cx={d.x * gap + gap / 2}
          cy={d.y * gap + gap / 2}
          r={r}
          className={DOT[d.tone]}
        />
      ))}
    </svg>
  );
}
const rank = (key: string) => (key === "win" ? 0 : key === "lose-in-world" ? 1 : 2);

function label(e: Ending, priced: boolean, stockWords?: string) {
  if (e.key === "win")
    return priced ? `All happen, ${stockWords ?? "the stock on your side"}` : "All happen";
  if (e.key === "lose-in-world") return "All happen, the stock on the other side";
  return "An event doesn't happen";
}

/** Every way a product can end, with its chance, what it pays and when: a row per outcome
 * instead of a payoff chart (Anic & Wallmeier 2019). The rows add to 1,000. */
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
          <li key={e.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
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
              <span className="line-clamp-2 text-sm leading-5">{label(e, priced, stockWords)}</span>
              <span className="text-xs text-muted-foreground">
                {e.key === "world-fails" ? when.refund : when.fixing}
              </span>
            </div>
            <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {perThousand(e.chance)}
              <span className="text-muted-foreground/70"> /1,000</span>
            </span>
            <span
              className={cn(
                "w-20 shrink-0 text-right text-base font-medium tabular-nums",
                t === "win" && "text-positive",
                t === "back" && "text-info",
                e.pays === 0 && "text-muted-foreground",
              )}
            >
              {e.pays > 0 ? money(e.pays) : "$0"}
              {t === "back" && <span className="block text-[11px] font-normal">back</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
