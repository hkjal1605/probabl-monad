import { Check, Link2, TrendingDown, TrendingUp, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { percent, perThousand } from "@/lib/worlds/format";
import type { Venue } from "@/lib/worlds/types";
import { EventThumb } from "./primitives";

export interface ChainLeg {
  label: string;
  wantYes: boolean;
  source: Venue | null;
  /** The leg's own chance of going the world's way, x 1e6 (null once decided). */
  chance: number | null;
  /** Decided already the world's way. */
  passed?: boolean;
  marketId?: string | null;
  image?: string | null;
}

/** How likely a world is, walked on one base of 1,000: each event in turn, then the stock. In
 * Tversky and Kahneman's studies this sequence cut misjudged joint chances from 65% to 11%. */
export function ChanceChain({
  legs,
  chain,
  naive,
  stock,
  className,
}: {
  legs: ChainLeg[];
  /** P(legs 0..k all go the world's way) per open leg, x 1e6. */
  chain: number[];
  naive: number[];
  /** The stock step: its words, and P(world and the stock's side), x 1e6. */
  stock: {
    words: string;
    chance: number;
    world: number;
    symbol?: string;
    logo?: string | null;
  } | null;
  className?: string | undefined;
}) {
  const open = legs.filter((l) => !l.passed);
  const rows: { id: string; count: number; icon: ReactNode; label: ReactNode; of: string }[] = [];
  open.forEach((leg, k) => {
    const value = chain[k] ?? null;
    if (value === null) return;
    const previous = k === 0 ? 1_000_000 : (chain[k - 1] ?? 1_000_000);
    rows.push({
      id: `leg-${leg.label}`,
      count: value,
      icon: <EventThumb event={leg} className="size-8 rounded-lg after:rounded-lg" />,
      label: (
        <span className="flex min-w-0 items-center gap-1.5">
          <Side wantYes={leg.wantYes} />
          <span className="truncate">{leg.label}</span>
        </span>
      ),
      of: percent(value / Math.max(1, previous)),
    });
  });
  if (stock) {
    const world = stock.world || (chain.at(-1) ?? 0);
    rows.push({
      id: "stock",
      count: stock.chance,
      icon: stock.logo ? (
        // biome-ignore lint/performance/noImgElement: small static token logos.
        <img src={stock.logo} alt="" className="size-8 rounded-full" />
      ) : (
        <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-strong">
          {stock.symbol?.slice(0, 2) ?? "$"}
        </span>
      ),
      label: <span className="truncate">{stock.words}</span>,
      of: percent(stock.chance / Math.max(1, world)),
    });
  }
  const passed = legs.filter((l) => l.passed);
  const last = chain.at(-1) ?? 0,
    unrelated = naive.at(-1) ?? 0;
  const linked = open.length > 1 && Math.abs(last - unrelated) > unrelated * 0.12;
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5",
        className,
      )}
    >
      <ol className="flex flex-col gap-4">
        <li className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-[11px] font-semibold text-muted-foreground">
            ∑
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">All futures</span>
              <span className="text-base font-medium text-muted-foreground tabular-nums">
                1,000
              </span>
            </div>
            <Bar share={1} tone="bg-muted-foreground/25" />
          </div>
        </li>
        {rows.map((r, i) => (
          <li key={r.id} className="flex items-center gap-3">
            {r.icon}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-sm">{r.label}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">{r.of}</span>
                  <span
                    className={cn(
                      "w-12 text-right text-base font-medium tabular-nums",
                      i === rows.length - 1 && "text-positive",
                    )}
                  >
                    {perThousand(r.count)}
                  </span>
                </span>
              </div>
              <Bar
                share={r.count / 1_000_000}
                tone={i === rows.length - 1 ? "bg-positive" : "bg-foreground/60"}
              />
            </div>
          </li>
        ))}
      </ol>
      {(passed.length > 0 || linked) && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {passed.map((l) => (
            <span
              key={l.label}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-positive-soft px-2.5 py-1 text-xs text-positive"
            >
              <Check className="size-3.5 shrink-0" />
              <span className="truncate">{l.label}</span>
            </span>
          ))}
          {linked && (
            <span
              title="These events move together, so the world's chance differs from multiplying them"
              className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground tabular-nums"
            >
              <Link2 className="size-3.5" />
              {perThousand(last)} linked vs {perThousand(unrelated)} unlinked
              {last > unrelated ? (
                <TrendingUp className="size-3.5 text-positive" />
              ) : (
                <TrendingDown className="size-3.5 text-danger" />
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Side({ wantYes }: { wantYes: boolean }) {
  return (
    <span
      role="img"
      aria-label={wantYes ? "Happens" : "Doesn't happen"}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full",
        wantYes ? "bg-positive-soft text-positive" : "bg-danger-soft text-danger",
      )}
    >
      {wantYes ? <Check className="size-2.5" /> : <X className="size-2.5" />}
    </span>
  );
}

function Bar({ share, tone }: { share: number; tone: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn("h-full rounded-full", tone)}
        style={{ width: `${Math.max(0.8, share * 100)}%` }}
      />
    </div>
  );
}
