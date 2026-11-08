import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarCheck, Users } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ago, calendarDay, moneyRaw } from "@/lib/worlds/format";
import { startParam } from "@/lib/worlds/start";
import type { ExploringWorld } from "@/lib/worlds/types";
import { SideTag } from "./primitives";
import { ChanceRing } from "./WorldCard";

/** A world someone priced but nobody holds yet, as the worlds page lists it: the stock's move,
 * the events it needs (each at its venue's chance now), what the makers last quoted and how
 * likely, how many explored it. The card opens it in the builder, priced afresh, to take a
 * position. */
export function ExploredCard({
  world: e,
  className,
}: {
  world: ExploringWorld;
  className?: string;
}) {
  const { world, quote } = e;
  const stock = world.stock;
  const product = quote.products.find((p) => p.name === "All-in") ?? quote.products[0];
  return (
    <Link
      href={`/worlds/new?w=${encodeURIComponent(startParam(e.spec))}`}
      aria-label={`${world.sentence}. Take a position`}
      className={cn(
        "group flex min-w-0 flex-col gap-5 rounded-xl bg-card p-5 ring-1 ring-border transition-[box-shadow,transform] outline-none hover:-translate-y-0.5 hover:ring-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0 sm:p-6",
        className,
      )}
    >
      {/* The stock's move, or the events alone */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {stock?.logo ? (
            // biome-ignore lint/performance/noImgElement: small static token logos.
            <img src={stock.logo} alt="" className="size-11 shrink-0 rounded-full" />
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
              <span className="text-xs text-muted-foreground">{calendarDay(stock.date)}</span>
            </div>
          ) : (
            <span className="text-xl leading-7 font-medium">
              {world.legs.length === 1 ? "One event" : `${world.legs.length} events`}
            </span>
          )}
        </div>
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground tabular-nums"
          title={`Priced by ${e.explorers} ${e.explorers === 1 ? "person" : "people"}`}
        >
          <Users className="size-3.5" aria-hidden />
          {e.explorers}
          <span className="sr-only">{e.explorers === 1 ? "person" : "people"} explored it</span>
        </span>
      </div>

      {/* The events it needs, each at the chance of the side it needs */}
      <ul className="flex flex-col gap-1.5">
        {world.legs.map((l) => (
          <li
            key={l.id}
            className="flex items-center gap-2.5 rounded-xl bg-secondary/60 px-3 py-2 text-sm"
          >
            <SideTag wantYes={l.wantYes} />
            <span className="min-w-0 flex-1 truncate">{l.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {l.yes === null ? "—" : `${Math.round((l.wantYes ? l.yes : 1 - l.yes) * 100)}%`}
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

      {/* What the makers last quoted, how likely, and the way in */}
      <div className="mt-auto flex items-end justify-between gap-4 border-t pt-4">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted-foreground">
            {product ? `${moneyRaw(product.stake, { cents: false })} →` : "Quoted"}
            <span className="text-muted-foreground/70"> · {ago(Date.parse(e.lastAt) / 1000)}</span>
          </span>
          <span className="text-2xl leading-8 font-medium tracking-[-0.01em] text-positive tabular-nums">
            {product ? moneyRaw(product.payout, { cents: false }) : "—"}
          </span>
        </div>
        <ChanceRing chance={quote.win} />
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand-strong">
          Place bet
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
            aria-hidden
          />
        </span>
      </div>
    </Link>
  );
}
