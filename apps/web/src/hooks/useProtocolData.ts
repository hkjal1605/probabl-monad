"use client";
import { useMemberAccount } from "@/components/providers/WalletProvider";
import { fetchTrades } from "@/modules/MarketDetailPageModule/utils/fetchTrades";
import { fetchMarkets } from "@/modules/MarketsPageModule/utils/fetchMarkets";
import { fetchPriceHistory } from "@/modules/MarketsPageModule/utils/fetchPriceHistory";
import { fetchOrders } from "@/modules/OrdersPageModule/utils/fetchOrders";
import { fetchPositions } from "@/modules/PortfolioPageModule/utils/fetchPositions";
import { fetchWalletTrades } from "@/modules/PortfolioPageModule/utils/fetchWalletTrades";
import { withMarketSpotPrices } from "@/services/spot-prices";
import { marketsStore } from "@/stores/useMarketsStore";
import { ordersStore } from "@/stores/useOrdersStore";
import { positionsStore } from "@/stores/usePositionsStore";
import { priceHistoryStore } from "@/stores/usePriceHistoryStore";
import { tradesStore } from "@/stores/useTradesStore";
import { walletTradesStore } from "@/stores/useWalletTradesStore";
import type { MarketView } from "@/types/api";
import { useReadFreshness } from "./useReadFreshness";
import { useResource } from "./useResource";
import { useSpotPrices } from "./useSpotPrices";

export function useMarkets(initial: MarketView[] = [], marketId?: string) {
  const key = marketId ?? "all";
  const query = useResource(marketsStore, key, (force) => fetchMarkets(key, force));
  const rows = query.data?.markets ?? initial;
  const spot = useSpotPrices(rows),
    freshness = useReadFreshness(query);
  const markets = withMarketSpotPrices(rows, spot.data, spot.now, spot.isError);
  return {
    ...query,
    ...freshness,
    markets: freshness.isDataFresh
      ? markets
      : markets.map((m) => ({ ...m, bookQuality: "unavailable" as const })),
  };
}
/** The member's own data: read only once its wallet signed in and joined. */
export function useOrders() {
  const account = useMemberAccount(),
    key = account ?? "";
  const query = useResource(ordersStore, key, (force) => fetchOrders(key, force), !!account);
  return { ...query, ...useReadFreshness(query), orders: query.data?.orders ?? [] };
}
export function usePositions() {
  const account = useMemberAccount(),
    key = account ?? "";
  const query = useResource(positionsStore, key, (force) => fetchPositions(key, force), !!account);
  return { ...query, ...useReadFreshness(query), positions: query.data?.positions ?? [] };
}
/** The connected wallet's trades: read by owner, refreshed only when the wallet changes. */
export function useWalletTrades() {
  const account = useMemberAccount(),
    key = account ?? "";
  const query = useResource(
    walletTradesStore,
    key,
    (force) => fetchWalletTrades(key, force),
    !!account,
  );
  return { ...query, ...useReadFreshness(query), trades: query.data?.trades ?? [] };
}
export function useTrades(marketId?: string) {
  const key = marketId ?? "all";
  const query = useResource(
    tradesStore,
    key,
    (force) => fetchTrades(key, force),
    marketId === undefined || !!marketId,
  );
  return { ...query, ...useReadFreshness(query), trades: query.data?.trades ?? [] };
}
/** A market's recorded prices (public id). They change once a minute: read at most that often. */
export function usePriceHistory(marketId?: string) {
  const key = marketId ?? "";
  const query = useResource(
    priceHistoryStore,
    key,
    (force) => fetchPriceHistory(key, force),
    !!marketId,
    60_000,
  );
  return { ...query, points: query.data?.points ?? [] };
}
