"use client";

import Link from "next/link";
import { useState } from "react";
import { OrderTable } from "@/components/portfolio/OrderTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataError, EmptyState, Page } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountGate } from "@/components/wallet/AccountGate";
import { useMarkets, useOrders, usePositions, useWalletTrades } from "@/hooks/useProtocolData";
import { useWalletAssets } from "@/hooks/useWalletAssets";
import { formatNumber, tokenAmount } from "@/lib/format/display";
import { groupMarkets, isResolved, sortEventGroups } from "@/lib/markets/presentation";
import { conditionalPositionRows } from "@/lib/portfolio/positions";
import { walletTradeRows } from "@/lib/portfolio/presentation";
import { positionHasClaims } from "@/services/index-stream";
import type { MarketView } from "@/types/api";
import { PortfolioEventCard } from "./PortfolioEventCard";
import { PortfolioEventSkeleton } from "./PortfolioEventSkeleton";
import { PortfolioTradeHistory } from "./PortfolioTradeHistory";
import { PortfolioVault } from "./PortfolioVault";
import { TradingPermissionCard } from "./TradingPermissionCard";

const hasClaims = positionHasClaims;
const TABS = ["Trading Account", "Positions", "Orders", "Claims", "Trade History"] as const;
type Tab = (typeof TABS)[number];

export function PortfolioClient({ markets: initial }: { markets: MarketView[] }) {
  const [tab, setTab] = useState<Tab>("Trading Account");
  const marketQuery = useMarkets(initial);
  const { markets } = marketQuery;
  const ordersQuery = useOrders();
  const positionsQuery = usePositions();
  const tradesQuery = useWalletTrades();
  const assetQuery = useWalletAssets(markets);
  const activeOrders = ordersQuery.orders.filter((order) => order.status === "open");
  const balances = assetQuery.balances
    .map((asset) => {
      const vault = BigInt(asset.balance.vaultAvailable);
      const walletAmount = BigInt(asset.balance.canonicalBalance);
      const reserved = BigInt(asset.balance.reserved);
      return { ...asset, vault, walletAmount, reserved, available: vault };
    })
    .filter((asset) => asset.available > 0n || asset.walletAmount > 0n || asset.reserved > 0n);
  const claims = positionsQuery.positions.filter(hasClaims);
  const valuesKnown =
    assetQuery.isDataFresh &&
    marketQuery.isDataFresh &&
    balances.every((asset) => asset.available === 0n || asset.reference !== null);
  const total = valuesKnown
    ? balances.reduce(
        (sum, asset) =>
          sum + tokenAmount(asset.available.toString(), asset.decimals) * (asset.reference ?? 0),
        0,
      )
    : null;
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
  const tradeRows = walletTradeRows(tradesQuery.trades, ordersQuery.orders, markets);
  const eventsPending = marketQuery.isPending || ordersQuery.isPending || positionsQuery.isPending;
  const tradesPending = eventsPending || tradesQuery.isPending;
  const eventCards = (groups: MarketView[][], view: "positions" | "claims", empty: string) =>
    groups.length === 0 && eventsPending ? (
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
        <PortfolioEventCard
          key={group[0]?.mapping.conditionId ?? group[0]?.id}
          markets={group}
          view={view}
        />
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
                  Total balance
                </p>
                {assetQuery.isPending && balances.length === 0 ? (
                  <Skeleton className="mt-2 h-11 w-40" aria-label="Loading total balance" />
                ) : (
                  <p className="mt-2 text-3xl font-medium tracking-tight tabular-nums sm:text-[40px] sm:leading-11">
                    {total === null ? "—" : `$${formatNumber(total, 2)}`}
                  </p>
                )}
                <p className="mt-2 text-xs font-medium text-muted-foreground">
                  Available in vault · estimated value
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
                  {eventCards(positionEvents, "positions", "No event positions yet.")}
                </section>
              )}
              {tab === "Orders" && <OrderTable markets={markets} />}
              {tab === "Claims" && (
                <section aria-label="Claims" className="flex min-w-0 flex-col gap-5">
                  {eventCards(claimGroups, "claims", "No claims yet.")}
                </section>
              )}
              {tab === "Trade History" && (
                <PortfolioTradeHistory rows={tradeRows} isPending={tradesPending} />
              )}
            </div>
            <TradingPermissionCard />
          </div>
        </div>
      </AccountGate>
    </Page>
  );
}
