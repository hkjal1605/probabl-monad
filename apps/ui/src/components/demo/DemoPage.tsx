"use client";

import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import Link from "next/link";
import { LifecycleBadge } from "@/components/data/StatusBadge";
import { MarketCard } from "@/components/market/MarketCard";
import { MarketTriptych } from "@/components/market/MarketTriptych";
import { useDemo } from "@/components/providers/DemoProvider";
import { formatTime, formatUsd } from "@/lib/format/display";
import { FundsClient } from "@/modules/FundsPageModule/components/FundsClient";
import { Hero } from "@/modules/HomePageModule/components/Hero";
import { HowItWorks } from "@/modules/HomePageModule/components/HowItWorks";
import { MarketDataTabs } from "@/modules/MarketDetailPageModule/components/MarketDataTabs";
import { OrderTicket } from "@/modules/MarketDetailPageModule/components/OrderTicket";
import { MarketsExplorer } from "@/modules/MarketsPageModule/components/MarketsExplorer";
import { OrdersClient } from "@/modules/OrdersPageModule/components/OrdersClient";
import { PortfolioClient } from "@/modules/PortfolioPageModule/components/PortfolioClient";
import { DemoControls, DemoResolution } from "./DemoTools";

export function DemoPage({
  page,
  marketId,
}: {
  page: "home" | "markets" | "market" | "portfolio" | "orders" | "funds" | "resolution";
  marketId?: string | undefined;
}) {
  const demo = useDemo();
  if (!demo) return <p role="alert">Mode changed in another tab. Reload to continue.</p>;
  const { markets, state } = demo;
  if (page === "home")
    return (
      <main>
        <Hero market={markets[0] ?? null} />
        <section className="mx-auto max-w-[1280px] px-5 py-16 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-display text-3xl">Explore the demo markets</h2>
            <Button asChild variant="outline">
              <Link href="/markets">All markets</Link>
            </Button>
          </div>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {markets.slice(0, 3).map((market) => (
              <MarketCard key={market.id} market={market} now={state.now} />
            ))}
          </div>
        </section>
        <HowItWorks />
      </main>
    );
  if (page === "market") {
    const market = markets.find((item) => item.id === marketId);
    if (!market)
      return (
        <main className="mx-auto max-w-[1280px] px-5 py-16">
          <h1 className="text-3xl">Demo market not found</h1>
          <p className="my-4">Live market links are separate from the demo fixtures.</p>
          <Button asChild>
            <Link href="/markets">Explore demo markets</Link>
          </Button>
        </main>
      );
    return (
      <main className="mx-auto max-w-[1280px] px-5 py-8 sm:px-8">
        <Button asChild variant="ghost">
          <Link href="/markets">← All markets</Link>
        </Button>
        <section className="my-6 rounded-3xl border bg-card p-6 sm:p-8">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{market.ticker}</Badge>
            <LifecycleBadge state={market.lifecycle} />
            <Badge variant="brand">Interactive demo</Badge>
          </div>
          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            {market.question}
          </h1>
          <p className="mt-4 text-muted-foreground">
            Independent YES and NO books. Every demo fill updates your reservations and conditional
            claims immediately.
          </p>
        </section>
        <MarketTriptych market={market} />
        <div className="my-5 grid gap-3 sm:grid-cols-3">
          <Metric label="Simulated trading cutoff" value={formatTime(market.cutoff)} />
          <Metric
            label="Ordinary stock reference · simulated"
            value={formatUsd(market.ordinaryReference)}
          />
          <Metric label="YES − NO impact" value={formatUsd(market.eventImpact)} />
        </div>
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_410px]">
          <div className="min-w-0">
            <MarketDataTabs
              market={market}
              trades={state.trades.filter((trade) => trade.marketId === market.id)}
            />
          </div>
          <aside className="xl:sticky xl:top-24">
            <OrderTicket market={market} />
          </aside>
        </div>
      </main>
    );
  }
  const titles = {
    markets: "Find the event. Compare the branches.",
    portfolio: "Every outcome, in one place.",
    orders: "Orders, fills and released funds.",
    funds: "Your demo wallet and controls.",
    resolution: "Try every resolution outcome.",
  };
  const descriptions = {
    markets:
      "Search fictitious markets and watch their books and simulated event probabilities move. No live Polymarket connection is used.",
    portfolio:
      "Available whole tokens, conditional claims and order reservations all share one local ledger.",
    orders:
      "Try GTC and IOC orders, partial fills, cancellations and expiry. Simulation results appear immediately; these are not onchain confirmations.",
    funds:
      "Top up, split claims, transfer dummy assets or reset this tab’s simulation. Never send real tokens to a demo address.",
    resolution:
      "Walk through cutoff, evidence review, resolution and redemption. These controls simulate admin actions; they do not grant live admin permissions.",
  };
  return (
    <main className="mx-auto max-w-[1280px] px-5 py-14 sm:px-8">
      <p className="text-xs font-bold uppercase tracking-widest text-brand-strong">Demo · {page}</p>
      <h1 className="mt-4 font-display text-4xl tracking-tight sm:text-6xl">{titles[page]}</h1>
      <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{descriptions[page]}</p>
      {page === "markets" && <MarketsExplorer markets={markets} now={state.now} />}
      {page === "portfolio" && <PortfolioClient markets={markets} />}
      {page === "orders" && <OrdersClient markets={markets} />}
      {page === "funds" && (
        <>
          <DemoControls />
          <FundsClient markets={markets} />
        </>
      )}
      {page === "resolution" && <DemoResolution selected={marketId} />}
    </main>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 font-semibold">{value}</p>
    </div>
  );
}
