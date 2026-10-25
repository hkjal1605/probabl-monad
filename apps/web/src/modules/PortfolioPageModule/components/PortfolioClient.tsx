"use client";

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { ClaimTable } from "@/components/portfolio/ClaimTable";
import { OrderList } from "@/components/portfolio/OrderTable";
import { PositionTable } from "@/components/portfolio/PositionTable";
import { WalletTradeTable } from "@/components/portfolio/WalletTradeTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataError, EmptyState, Page } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountGate } from "@/components/wallet/AccountGate";
import { useOrderRecovery } from "@/hooks/useOrderRecovery";
import { useMarkets, usePositions, useWalletTrades } from "@/hooks/useProtocolData";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { formatNumber } from "@/lib/format/display";
import { groupMarkets, isResolved, sortEventGroups } from "@/lib/markets/presentation";
import { conditionalPositionRows } from "@/lib/portfolio/positions";
import { walletTradeRows } from "@/lib/portfolio/presentation";
import { portfolioValue } from "@/lib/portfolio/summary";
import { positionHasClaims } from "@/services/index-stream";
import type { MarketView } from "@/types/api";
import { PortfolioEventCard } from "./PortfolioEventCard";
import { PortfolioEventSkeleton } from "./PortfolioEventSkeleton";
import { PortfolioVault } from "./PortfolioVault";
import { TradingPermissionCard } from "./TradingPermissionCard";

const hasClaims = positionHasClaims;
const TABS = ["Trading Account", "Positions", "Orders", "Claims", "Trade History"] as const;
type Tab = (typeof TABS)[number];

/** The latest time per market id (a missing time counts as the earliest). */
function latestPerMarket(entries: [marketId: string, time: number][]) {
  const latest = new Map<string, number>();
  for (const [id, time] of entries) latest.set(id, Math.max(latest.get(id) ?? 0, time || 0));
  return latest;
}
/** The events with a market in `latest`, the one with the latest time first. */
function byLatest(groups: MarketView[][], latest: Map<string, number>) {
  return groups
    .map((group) => ({ group, at: Math.max(...group.map((m) => latest.get(m.id) ?? -1)) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => b.at - a.at)
    .map(({ group }) => group);
}

export function PortfolioClient({ markets: initial }: { markets: MarketView[] }) {
  const [tab, setTab] = useState<Tab>("Trading Account");
  const marketQuery = useMarkets(initial);
  const { markets } = marketQuery;
  // One cancel state for every event's orders, so a single cancellation runs at a time.
  const ordersQuery = useOrderRecovery();
  const positionsQuery = usePositions();
  const tradesQuery = useWalletTrades();
  const assetQuery = useWalletAssets(markets);
  const activeOrders = ordersQuery.orders.filter((order) => order.status === "open");
  const claims = positionsQuery.positions.filter(hasClaims);
  // The same value as the header's: vault balances and every claim, at fresh prices.
  const valuationFresh =
    assetQuery.isDataFresh &&
    marketQuery.isDataFresh &&
    positionsQuery.isDataFresh &&
    ordersQuery.isDataFresh &&
    ordersQuery.data?.openTruncated !== true;
  const valuationPending =
    assetQuery.isPending ||
    marketQuery.spotPending ||
    positionsQuery.isPending ||
    ordersQuery.isPending;
  const value = useMemo(
    () =>
      portfolioValue(markets, assetQuery.balances, positionsQuery.positions, ordersQuery.orders),
    [markets, assetQuery.balances, positionsQuery.positions, ordersQuery.orders],
  );
  const eventGroups = sortEventGroups(groupMarkets(markets), "newest");
  // Unresolved events holding claims or claims reserved by open orders (a resolved event's
  // claims are redeemed in Claims).
  const positionEvents = eventGroups.filter(
    (group) =>
      conditionalPositionRows(
        group.filter((market) => !isResolved(market)),
        positionsQuery.positions,
        ordersQuery.orders,
      ).length > 0,
  );
  const claimMarketIds = new Set(claims.map((position) => position.marketId));
  const claimGroups = eventGroups.filter((group) =>
    group.some((market) => claimMarketIds.has(market.id)),
  );
  const claimEvents = claimGroups.length;
  // Orders and trades: the events with the latest activity first.
  const orderEvents = byLatest(
    eventGroups,
    latestPerMarket(
      activeOrders.map((order) => [order.marketId, Date.parse(order.createdAt ?? "")]),
    ),
  );
  const tradeEvents = byLatest(
    eventGroups,
    latestPerMarket(
      walletTradeRows(tradesQuery.trades, ordersQuery.orders, markets).map(({ trade }) => [
        trade.marketId,
        Number(trade.blockTimestamp),
      ]),
    ),
  );
  const ordersPending = marketQuery.isPending || ordersQuery.isPending;
  const eventsPending = ordersPending || positionsQuery.isPending;
  const tradesPending = ordersPending || tradesQuery.isPending;
  /** A card per event, holding `table` of its markets (their questions shown when it has several). */
  const eventCards = (
    groups: MarketView[][],
    pending: boolean,
    empty: string,
    table: (markets: MarketView[], showTitles: boolean) => ReactNode,
  ) =>
    groups.length === 0 && pending ? (
      <>
        <PortfolioEventSkeleton />
        <PortfolioEventSkeleton />
      </>
    ) : groups.length === 0 ? (
      <Card variant="panel" className="rounded-xl bg-card">
        <EmptyState>{empty}</EmptyState>
      </Card>
    ) : (
      groups.map((group) => (
        <PortfolioEventCard key={group[0]?.mapping.conditionId ?? group[0]?.id} markets={group}>
          {table(group, group.length > 1)}
        </PortfolioEventCard>
      ))
    );

  return (
    <Page className="page-scrollbars-hidden max-w-[1280px] px-5 py-8 sm:px-6 sm:py-10">
      <AccountGate
        title="Your portfolio"
        description="Connect your wallet to view balances, event positions, claims, and fills."
      >
        <div className="flex flex-col gap-4">
          <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-4xl font-medium tracking-tight sm:text-[40px] sm:leading-11">
                Portfolio
              </h1>
              {ordersQuery.isPending || positionsQuery.isPending ? (
                <Skeleton className="mt-2 h-5 w-56" aria-label="Loading portfolio summary" />
              ) : (
                <p className="mt-2 text-sm font-medium text-muted-foreground">
                  {claimEvents} {claimEvents === 1 ? "event" : "events"} with claims ·{" "}
                  {activeOrders.length} open {activeOrders.length === 1 ? "order" : "orders"}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setTab("Claims")}
                disabled={!claimGroups.length}
              >
                View claims
              </Button>
              <Button size="lg" render={<Link href="/" />} nativeButton={false}>
                Explore markets
              </Button>
            </div>
          </header>

          {(marketQuery.isInitialError ||
            ordersQuery.isInitialError ||
            positionsQuery.isInitialError ||
            tradesQuery.isInitialError) && (
            <DataError
              message="Some portfolio data is temporarily unavailable."
              retry={() => {
                void marketQuery.refetch();
                void ordersQuery.refetch();
                void positionsQuery.refetch();
                void tradesQuery.refetch();
              }}
            />
          )}

          <Card variant="panel" className="rounded-xl bg-card">
            <CardContent className="px-0 py-7">
              <div>
                <p className="eyebrow uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                  Portfolio value
                </p>
                {valuationPending ? (
                  <Skeleton className="mt-2 h-11 w-40" aria-label="Loading portfolio value" />
                ) : (
                  <p className="mt-2 text-3xl font-medium tracking-tight tabular-nums sm:text-[40px] sm:leading-11">
                    {valuationFresh && value !== null ? `$${formatNumber(value, 2)}` : "—"}
                  </p>
                )}
                <p className="mt-2 text-xs font-medium text-muted-foreground">
                  Trading account and claims · estimated value
                </p>
              </div>
            </CardContent>
          </Card>

          {/* The tabs change the left column; trading permission stays on the right. */}
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex min-h-8 items-center overflow-x-auto">
                <Segmented
                  label="Portfolio section"
                  variant="category"
                  className="shrink-0"
                  value={tab}
                  options={TABS}
                  onChange={setTab}
                />
              </div>
              {tab === "Trading Account" && (
                <PortfolioVault
                  assets={assetQuery.assets}
                  balances={assetQuery.balances}
                  fresh={assetQuery.isDataFresh}
                  refresh={assetQuery.refetch}
                />
              )}
              {tab === "Positions" && (
                <section aria-label="Positions" className="flex min-w-0 flex-col gap-5">
                  {eventCards(
                    positionEvents,
                    eventsPending,
                    "No event positions yet.",
                    (group, showTitles) => (
                      <PositionTable markets={group} softClose showTitles={showTitles} />
                    ),
                  )}
                </section>
              )}
              {tab === "Orders" && (
                <section aria-label="Orders" className="flex min-w-0 flex-col gap-5">
                  {eventCards(
                    orderEvents,
                    ordersPending,
                    "No open orders. Limit orders rest here until they fill or you cancel them.",
                    (group, showTitles) => (
                      <OrderList markets={group} showTitles={showTitles} recovery={ordersQuery} />
                    ),
                  )}
                </section>
              )}
              {tab === "Claims" && (
                <section aria-label="Claims" className="flex min-w-0 flex-col gap-5">
                  {eventCards(claimGroups, eventsPending, "No claims yet.", (group, showTitles) => (
                    <ClaimTable markets={group} showTitles={showTitles} />
                  ))}
                </section>
              )}
              {tab === "Trade History" && (
                <section aria-label="Trade history" className="flex min-w-0 flex-col gap-5">
                  {eventCards(
                    tradeEvents,
                    tradesPending,
                    "No trades yet. Your fills in every market show here.",
                    (group, showTitles) => (
                      <WalletTradeTable markets={group} showTitles={showTitles} />
                    ),
                  )}
                </section>
              )}
            </div>
            <TradingPermissionCard />
          </div>
        </div>
      </AccountGate>
    </Page>
  );
}
