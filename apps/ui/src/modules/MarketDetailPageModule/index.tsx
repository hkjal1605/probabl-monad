import { Alert, AlertDescription, AlertTitle } from "@conditional-stocks/ui-kit/alert";
import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent } from "@conditional-stocks/ui-kit/card";
import { ArrowLeft, CircleAlert, Clock3, Gauge, GitCompareArrows } from "lucide-react";
import Link from "next/link";
import { LifecycleBadge } from "@/components/data/StatusBadge";
import { DemoPage } from "@/components/demo/DemoPage";
import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { formatTime, formatUsd, timeUntil } from "@/lib/format/display";
import { LiveMarketTriptych } from "./components/LiveMarketTriptych";
import { MarketDataTabs } from "./components/MarketDataTabs";
import { OrderTicket } from "./components/OrderTicket";
import { RefreshMarket } from "./components/RefreshMarket";

export async function MarketDetailPageModule({ marketId }: { marketId: string }) {
  if (await isDemoMode()) return <DemoPage page="market" marketId={marketId} />;
  const market = await serverApi.market(marketId);
  if (!market)
    return (
      <main className="mx-auto min-h-[60svh] w-full max-w-[1280px] px-5 py-14 sm:px-8">
        <Button asChild variant="ghost">
          <Link href="/markets">
            <ArrowLeft />
            Markets
          </Link>
        </Button>
        <div className="mt-8 rounded-2xl border border-dashed p-16 text-center">
          <p className="font-semibold">Market not found</p>
          <p className="mt-2 text-sm text-muted-foreground">
            It may not be indexed yet, or the market ID is incorrect.
          </p>
        </div>
      </main>
    );
  const trades = await serverApi.trades(market.id);
  const metrics = [
    {
      icon: Clock3,
      label: "Trading cutoff",
      value: timeUntil(market.cutoff),
      detail: formatTime(market.cutoff),
    },
    {
      icon: Gauge,
      label: "Ordinary stock reference",
      value: formatUsd(market.ordinaryReference),
      detail:
        market.ordinaryReference === null
          ? "No verified reference feed"
          : "Context only—not executable",
    },
    {
      icon: GitCompareArrows,
      label: "YES − NO impact",
      value: formatUsd(market.eventImpact),
      detail: "Difference between branch books",
    },
  ];
  return (
    <main className="mx-auto w-full max-w-[1280px] px-5 py-8 sm:px-8 lg:py-12">
      <RefreshMarket />
      <Button asChild variant="ghost" className="-ml-3">
        <Link href="/markets">
          <ArrowLeft />
          All markets
        </Link>
      </Button>
      <section className="mt-6 rounded-3xl border bg-card p-6 shadow-soft sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex size-11 items-center justify-center rounded-xl bg-foreground text-xs font-bold text-background">
                {market.ticker}
              </span>
              <LifecycleBadge state={market.lifecycle} />
              {market.sourceMode === "preview" && (
                <Badge variant="outline">Interface preview data</Badge>
              )}
            </div>
            <h1 className="mt-5 font-display text-4xl leading-[1.02] font-semibold tracking-[-0.055em] sm:text-6xl">
              {market.question}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
              Compare how {market.ticker} is valued under each event outcome, then trade against the
              branch-specific order book.
            </p>
          </div>
          <div className="rounded-2xl bg-muted/60 p-4 text-sm lg:max-w-sm">
            <p className="font-semibold">Read the three panels left to right</p>
            <p className="mt-2 leading-6 text-muted-foreground">
              The first is informational event context. The next two are independent, executable
              stock markets.
            </p>
          </div>
        </div>
      </section>
      <div className="mt-5">
        <LiveMarketTriptych market={market} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <Card size="sm" key={metric.label}>
            <CardContent>
              <metric.icon className="size-4 text-muted-foreground" />
              <p className="mt-4 text-xs text-muted-foreground">{metric.label}</p>
              <p className="mt-1 text-lg font-semibold">{metric.value}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{metric.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {market.residual !== null && Math.abs(market.residual) > 1 && (
        <Alert variant="warning" className="mt-5">
          <CircleAlert />
          <AlertTitle>Diagnostic consistency warning</AlertTitle>
          <AlertDescription>
            The probability-weighted branch values differ from the ordinary stock reference by{" "}
            {formatUsd(market.residual)}. Review source timing and depth before trading.
          </AlertDescription>
        </Alert>
      )}
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_410px]">
        <MarketDataTabs market={market} trades={trades} />
        <aside className="xl:sticky xl:top-24">
          <OrderTicket market={market} />
        </aside>
      </div>
    </main>
  );
}
