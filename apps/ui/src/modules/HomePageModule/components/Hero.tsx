import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import { ArrowRight, CircleHelp, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { MarketView } from "@/lib/api/types";
import { formatProbability, formatUsd } from "@/lib/format/display";

export function Hero({ market }: { market: MarketView | null }) {
  return (
    <section className="relative overflow-hidden border-b">
      <div className="price-grid absolute inset-0 opacity-50" />
      <div className="relative mx-auto grid min-h-[650px] w-full max-w-[1280px] items-center gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_0.92fr] lg:py-28">
        <div className="min-w-0 max-w-3xl">
          <Badge variant="brand">Event-driven stock markets</Badge>
          <h1 className="mt-6 font-display text-5xl leading-[0.96] font-medium tracking-[-0.065em] sm:text-7xl lg:text-[84px]">
            Trade the stock outcome, not just the event.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground">
            Buy or sell a stock token at one value if an event resolves YES and another if it
            resolves NO. You choose the branch, price, and size.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild variant="brand" size="lg">
              <Link href="/markets">
                Explore markets <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/learn">
                <CircleHelp />
                Understand the payoff
              </Link>
            </Button>
          </div>
          <div className="mt-8 flex items-start gap-3 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" />
            <p>
              Self-custodied orders, deterministic matching, and onchain settlement. Market creation
              and resolution are manual admin functions in v1.
            </p>
          </div>
        </div>
        <div className="relative min-w-0">
          <div className="absolute -inset-5 rounded-[32px] border border-brand/15" />
          <div className="relative rounded-3xl border bg-card p-5 shadow-soft sm:p-7">
            <div className="flex min-w-0 items-start justify-between gap-3 sm:gap-5">
              <div className="min-w-0">
                <p className="text-xs font-bold tracking-[0.1em] text-brand-strong uppercase">
                  One event, two stock values
                </p>
                <h2 className="mt-3 break-words text-lg leading-6 font-semibold sm:text-xl sm:leading-7">
                  {market?.question ?? "A conditional market appears here when indexing begins."}
                </h2>
              </div>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-xs font-bold text-background">
                {market?.ticker ?? "CS"}
              </span>
            </div>
            <div className="mt-7 rounded-2xl bg-muted/55 p-3">
              <div className="grid grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 sm:gap-2">
                <div className="min-w-0 rounded-xl bg-card p-2.5 sm:p-4">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">Event</p>
                  <p className="mt-3 truncate text-lg font-semibold sm:text-2xl">
                    {formatProbability(market?.probability.value ?? null)}
                  </p>
                </div>
                <div className="min-w-0 rounded-xl border-l-2 border-l-trade-buy bg-card p-2.5 sm:p-4">
                  <p className="text-[10px] font-bold text-trade-buy uppercase">If yes</p>
                  <p className="mt-3 truncate text-lg font-semibold sm:text-2xl">
                    {formatUsd(market?.yes.bestAsk ?? null)}
                  </p>
                </div>
                <div className="min-w-0 rounded-xl border-l-2 border-l-trade-sell bg-card p-2.5 sm:p-4">
                  <p className="text-[10px] font-bold text-trade-sell uppercase">If no</p>
                  <p className="mt-3 truncate text-lg font-semibold sm:text-2xl">
                    {formatUsd(market?.no.bestAsk ?? null)}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Your decision</span>
                <span className="text-right font-semibold">Choose YES or NO stock</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">Your control</span>
                <span className="text-right font-semibold">Set a maximum buy price</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground">If the other side wins</span>
                <span className="text-right font-semibold">You keep the cash claim</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
