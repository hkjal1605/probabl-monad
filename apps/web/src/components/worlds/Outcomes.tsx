import { cn } from "@/lib/utils";
import { inThousand, money } from "@/lib/worlds/format";
import type { Offer } from "@/lib/worlds/offer";

const ENDING_TONE = {
  win: "bg-primary",
  "lose-in-world": "bg-danger/70",
  "world-fails": "bg-info/70",
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
  const columns = 50,
    rows = 20,
    gap = 1.6,
    r = 0.62;
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
  const dots: { x: number; y: number; tone: string }[] = [];
  let k = 0;
  for (const { e, n } of order)
    for (let j = 0; j < n && k < columns * rows; j++, k++)
      dots.push({ x: k % columns, y: Math.floor(k / columns), tone: e.key });
  return (
    <svg
      viewBox={`0 0 ${columns * gap} ${rows * gap}`}
      className={cn("w-full max-w-[520px]", className)}
      role="img"
      aria-label={endings
        .map((e) => `${inThousand(e.chance)} ${label(e.key, 0, false)}`)
        .join(", ")}
    >
      {dots.map((d, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of dots.
          key={i}
          cx={d.x * gap + gap / 2}
          cy={d.y * gap + gap / 2}
          r={r}
          className={cn(
            d.tone === "win" && "fill-primary",
            d.tone === "lose-in-world" && "fill-danger/55",
            d.tone === "world-fails" && "fill-muted-foreground/25",
          )}
        />
      ))}
    </svg>
  );
}
const rank = (key: string) => (key === "win" ? 0 : key === "lose-in-world" ? 1 : 2);

function label(key: Offer["endings"][number]["key"], refund: number, priced: boolean) {
  if (key === "win")
    return priced ? "Every event happens and the stock ends on your side" : "Every event happens";
  if (key === "lose-in-world") return "Every event happens, but the stock ends on the other side";
  return refund > 0 ? "An event doesn't happen: your stake comes back" : "An event doesn't happen";
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
  const refund = offer.endings.find((e) => e.key === "world-fails")?.pays ?? 0;
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 border-b pb-2 text-xs font-medium text-muted-foreground">
        <span>How this can end</span>
        <span className="text-right">Chance</span>
        <span className="w-20 text-right">You get</span>
      </div>
      {offer.endings.map((e) => (
        <div
          key={e.key}
          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-4 border-b py-3 last:border-b-0"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", ENDING_TONE[e.key])} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm leading-5">
                {e.key === "win" && priced && stockWords
                  ? `Every event happens and ${stockWords}`
                  : label(e.key, refund, priced)}
              </span>
              <span className="text-xs text-muted-foreground">
                {e.key === "world-fails" ? when.refund : when.fixing}
              </span>
            </div>
          </div>
          <span className="text-right text-sm tabular-nums">{inThousand(e.chance)}</span>
          <span
            className={cn(
              "w-20 text-right text-sm font-medium tabular-nums",
              e.key === "win" && e.pays > 0 && "text-positive",
              e.pays === 0 && "text-muted-foreground",
            )}
          >
            {e.pays > 0 ? money(e.pays) : "$0"}
            {e.key === "world-fails" && e.pays > 0 && (
              <span className="block text-[11px] font-normal text-muted-foreground">back</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
