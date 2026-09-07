import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Card, CardContent } from "@conditional-stocks/ui-kit/card";
import { CircleDollarSign, GitCompareArrows, ShieldCheck } from "lucide-react";
import { QualityBadge } from "@/components/data/StatusBadge";
import type { MarketView } from "@/lib/api/types";
import { formatProbability, formatTime, formatUsd } from "@/lib/format/display";

function QuoteRange({ bid, ask }: { bid: number | null; ask: number | null }) {
  if (bid === null || ask === null)
    return <p className="mt-4 text-2xl font-semibold">No two-sided quote</p>;
  return (
    <p className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
      {formatUsd(bid)} <span className="text-base font-normal text-muted-foreground">to</span>{" "}
      {formatUsd(ask)}
    </p>
  );
}

export function MarketTriptych({ market }: { market: MarketView }) {
  return (
    <section aria-label="Market comparison" className="grid gap-3 lg:grid-cols-3">
      <Card className="border-brand/25">
        <CardContent>
          <div className="flex items-center justify-between">
            <Badge variant="brand">1 · Event probability</Badge>
            <GitCompareArrows className="size-4 text-brand-strong" />
          </div>
          <p className="mt-6 text-5xl font-semibold tracking-[-0.06em]">
            {formatProbability(market.probability.value)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {market.sourceMode === "demo"
              ? "Simulated YES probability · not a live feed"
              : "Polymarket-implied YES probability"}
          </p>
          <div className="mt-6 flex items-center justify-between border-t pt-4">
            <QualityBadge quality={market.probability.quality} sourceMode={market.sourceMode} />
            <span className="text-[11px] text-muted-foreground">
              {formatTime(market.probability.observedAt)}
            </span>
          </div>
        </CardContent>
      </Card>
      <Card className="border-t-2 border-t-trade-buy">
        <CardContent>
          <div className="flex items-center justify-between">
            <Badge variant="yes">2 · {market.ticker} if YES</Badge>
            <ShieldCheck className="size-4 text-trade-buy" />
          </div>
          <QuoteRange bid={market.yes.bestBid} ask={market.yes.bestAsk} />
          <p className="mt-2 text-sm text-muted-foreground">
            Executable bid to ask—not a guaranteed midpoint.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t pt-4 text-xs">
            <div>
              <p className="text-muted-foreground">Spread</p>
              <p className="mt-1 font-semibold">
                {market.yes.spread === null ? "—" : formatUsd(market.yes.spread)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Visible depth</p>
              <p className="mt-1 font-semibold">{formatUsd(market.yes.depthUsd)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="border-t-2 border-t-trade-sell">
        <CardContent>
          <div className="flex items-center justify-between">
            <Badge variant="no">3 · {market.ticker} if NO</Badge>
            <CircleDollarSign className="size-4 text-trade-sell" />
          </div>
          <QuoteRange bid={market.no.bestBid} ask={market.no.bestAsk} />
          <p className="mt-2 text-sm text-muted-foreground">
            Executable bid to ask—not a guaranteed midpoint.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t pt-4 text-xs">
            <div>
              <p className="text-muted-foreground">Spread</p>
              <p className="mt-1 font-semibold">
                {market.no.spread === null ? "—" : formatUsd(market.no.spread)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Visible depth</p>
              <p className="mt-1 font-semibold">{formatUsd(market.no.depthUsd)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
