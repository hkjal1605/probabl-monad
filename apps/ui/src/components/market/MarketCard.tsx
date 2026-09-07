import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent, CardHeader } from "@conditional-stocks/ui-kit/card";
import { ArrowRight, Clock3, Layers3 } from "lucide-react";
import Link from "next/link";
import { LifecycleBadge, QualityBadge } from "@/components/data/StatusBadge";
import type { MarketView } from "@/lib/api/types";
import { formatCompactUsd, formatProbability, formatUsd, timeUntil } from "@/lib/format/display";

export function MarketCard({ market, now }: { market: MarketView; now?: number | undefined }) {
  return (
    <Card className="transition-colors hover:border-brand/40">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-foreground text-xs font-bold text-background">
              {market.ticker.slice(0, 4)}
            </span>
            <div>
              <p className="font-semibold">{market.ticker}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Conditional stock</p>
            </div>
          </div>
          <LifecycleBadge state={market.lifecycle} />
        </div>
        <h3 className="mt-4 min-h-12 text-base leading-6 font-semibold">{market.question}</h3>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/35 p-2">
          <div className="rounded-lg bg-card p-3">
            <p className="text-[10px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
              Event
            </p>
            <p className="mt-2 text-xl font-semibold">
              {formatProbability(market.probability.value)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {market.sourceMode === "demo" ? "Simulated" : "Polymarket"}
            </p>
          </div>
          <div className="rounded-lg border-l-2 border-l-trade-buy bg-card p-3">
            <p className="text-[10px] font-bold tracking-[0.08em] text-trade-buy uppercase">
              If yes
            </p>
            <p className="mt-2 text-xl font-semibold">{formatUsd(market.yes.bestAsk)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Best ask</p>
          </div>
          <div className="rounded-lg border-l-2 border-l-trade-sell bg-card p-3">
            <p className="text-[10px] font-bold tracking-[0.08em] text-trade-sell uppercase">
              If no
            </p>
            <p className="mt-2 text-xl font-semibold">{formatUsd(market.no.bestAsk)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Best ask</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5">
              <Layers3 className="size-3.5" />
              Visible depth
            </span>
            <span className="font-medium text-foreground">
              {formatCompactUsd(market.yes.depthUsd + market.no.depthUsd)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="size-3.5" />
              Trading cutoff
            </span>
            <span className="font-medium text-foreground">{timeUntil(market.cutoff, now)}</span>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between">
          <QualityBadge quality={market.probability.quality} sourceMode={market.sourceMode} />
          <Button asChild variant="ghost" size="sm">
            <Link href={`/markets/${market.id}`}>
              Open market <ArrowRight />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
