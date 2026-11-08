import { ArrowDownRight, ArrowUpRight, CalendarCheck } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { calendarDay, chancePercent, money, moneyRaw, until } from "@/lib/worlds/format";
import { outcomeAtoms } from "@/lib/worlds/offer";
import type { FeedWorld } from "@/lib/worlds/types";
import { SideTag, WalletDot } from "./primitives";

/** What a stake of $20 pays in a world's All-in, from its indicated ask. */
function allInFor20(world: FeedWorld) {
  const key = world.opinion?.direction ? `bet:${world.opinion.direction}:1` : "bet:world";
  const ask = world.products.find((p) => p.key === key)?.ask;
  return ask ? 20 / (ask / 1_000_000) : null;
}
/** P(an All-in of this world pays), from the marks. */
function winChance(world: FeedWorld) {
  if (!world.marks) return null;
  const outcome = world.opinion?.direction
    ? { kind: world.opinion.direction, strike: 1 }
    : { kind: "world" };
  return outcomeAtoms(outcome, world.marks.length).reduce((s, a) => s + (world.marks![a] ?? 0), 0);
}

/** A world someone holds a position in, as the public feed shows it: the stock's move, the
 * events it needs, what $20 pays and how likely, and who is in. */
export function WorldCard({
  world,
  logo = null,
  className,
}: {
  world: FeedWorld;
  logo?: string | null;
  className?: string;
}) {
  const o = world.opinion;
  const stock =
    o?.symbol && o.direction && o.strike
      ? { symbol: o.symbol, direction: o.direction, strike: o.strike, fixingDate: o.fixingDate }
      : null;
  const payout = allInFor20(world);
  const chance = winChance(world);
  const decided = world.decided;
  const left = until(Number(world.cutoff));
  const people = [...new Set(world.latest.map((f) => f.taker))].slice(0, 4);
  return (
    <Link
      href={`/worlds/${world.book}`}
      className={cn(
        "group flex min-w-0 flex-col gap-5 rounded-xl bg-card p-5 ring-1 ring-border transition-[box-shadow,transform] outline-none hover:-translate-y-0.5 hover:ring-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0 sm:p-6",
        decided && "opacity-70",
        className,
      )}
    >
      {/* The stock's move, or the events alone */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {stock && logo ? (
            // biome-ignore lint/performance/noImgElement: small static token logos.
            <img src={logo} alt="" className="size-11 shrink-0 rounded-full" />
          ) : (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
              {stock ? stock.symbol.slice(0, 2) : <CalendarCheck className="size-5" />}
            </span>
          )}
          {stock ? (
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1 text-xl leading-7 font-medium tracking-[-0.01em] tabular-nums">
                {stock.symbol}
                {stock.direction === "above" ? (
                  <ArrowUpRight className="size-5 text-positive" aria-label="above" />
                ) : (
                  <ArrowDownRight className="size-5 text-danger" aria-label="below" />
                )}
                ${Number(stock.strike).toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </span>
              {stock.fixingDate && (
                <span className="text-xs text-muted-foreground">
                  {calendarDay(stock.fixingDate)}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xl leading-7 font-medium">
              {world.legs.length === 1 ? "One event" : `${world.legs.length} events`}
            </span>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums",
            decided
              ? "bg-secondary text-muted-foreground"
              : world.tradable
                ? "bg-positive-soft text-positive"
                : "bg-secondary text-muted-foreground",
          )}
        >
          {decided ? "Settled" : world.tradable ? (left === "now" ? "Closing" : left) : "Paused"}
        </span>
      </div>

      {/* The events it needs */}
      <ul className="flex flex-col gap-1.5">
        {world.legs.map((l) => (
          <li
            key={l.eventKey}
            className="flex items-center gap-2.5 rounded-xl bg-secondary/60 px-3 py-2 text-sm"
          >
            <SideTag wantYes={l.wantYes} />
            <span className="min-w-0 flex-1 truncate">{l.label ?? "An event"}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {l.outcome !== null
                ? l.outcome === "passed"
                  ? "✓"
                  : "✗"
                : l.chance !== null
                  ? // The chance of the side the world needs.
                    `${Math.round(l.chance / 10_000)}%`
                  : "—"}
            </span>
            <span
              role="img"
              aria-label={l.source === "kalshi" ? "Kalshi" : "Polymarket"}
              title={l.source === "kalshi" ? "Kalshi" : "Polymarket"}
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                l.source === "kalshi" ? "bg-positive" : "bg-info",
              )}
            />
          </li>
        ))}
      </ul>

      {/* What $20 pays, how likely, who is in */}
      <div className="mt-auto flex items-end justify-between gap-4 border-t pt-4">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">$20 →</span>
          <span className="text-2xl leading-8 font-medium tracking-[-0.01em] text-positive tabular-nums">
            {payout === null ? "—" : money(payout)}
          </span>
        </div>
        <ChanceRing chance={chance} />
        <div className="flex flex-col items-end gap-1">
          <span className="flex -space-x-1.5">
            {people.map((p) => (
              <WalletDot key={p} address={p} className="size-6 ring-2 ring-card" />
            ))}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {moneyRaw(world.staked, { cents: false })} in
          </span>
        </div>
      </div>
    </Link>
  );
}

/** A world's chance as a ring, and as a percent. */
export function ChanceRing({ chance }: { chance: number | null }) {
  const r = 16;
  const length = 2 * Math.PI * r;
  const share = chance === null ? 0 : Math.min(1, Math.max(0, chance / 1_000_000));
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 40 40" className="size-10 -rotate-90" aria-hidden>
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-secondary" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${share * length} ${length}`}
          className="stroke-positive"
        />
      </svg>
      <span className="flex flex-col leading-4">
        <span className="text-sm font-medium tabular-nums">{chancePercent(chance)}</span>
        <span className="text-[11px] text-muted-foreground">chance</span>
      </span>
    </div>
  );
}
