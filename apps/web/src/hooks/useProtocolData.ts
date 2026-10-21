"use client";
import { useMemo } from "react";
import { useMemberAccount } from "@/components/providers/WalletProvider";
import { fetchTrades } from "@/modules/MarketDetailPageModule/utils/fetchTrades";
import { fetchMarkets } from "@/modules/MarketsPageModule/utils/fetchMarkets";
import { fetchPriceHistory } from "@/modules/MarketsPageModule/utils/fetchPriceHistory";
import { fetchOrders } from "@/modules/OrdersPageModule/utils/fetchOrders";
import { fetchPositions } from "@/modules/PortfolioPageModule/utils/fetchPositions";
import { fetchWalletTrades } from "@/modules/PortfolioPageModule/utils/fetchWalletTrades";
import type { PriceHistoryRange } from "@/services/price-history";
import { withQuotePrices } from "@/services/quote-prices";
import { withMarketSpotPrices } from "@/services/spot-prices";
import { marketsStore } from "@/stores/useMarketsStore";
import { ordersStore } from "@/stores/useOrdersStore";
import { positionsStore } from "@/stores/usePositionsStore";
import { priceHistoryStore } from "@/stores/usePriceHistoryStore";
import { tradesStore } from "@/stores/useTradesStore";
import { walletTradesStore } from "@/stores/useWalletTradesStore";
import type { MarketView } from "@/types/api";
import { useQuotePrices } from "./useQuotePrices";
import { useReadFreshness } from "./useReadFreshness";
import { useResource } from "./useResource";
import { useSpotPrices } from "./useSpotPrices";

const NO_MARKETS: MarketView[] = [];
/** One empty list for every hook without data yet, so memos depending on it hold. */
const NONE: never[] = [];

/** The markets with their live spot and RFQ prices folded in. The list (and each market object) is
 * rebuilt only when its inputs change, so components below can skip re-rendering. Books show
 * while the list is younger than its max age, even if the last refresh failed. */
export function useMarkets(initial: MarketView[] = NO_MARKETS, marketId?: string) {
  const key = marketId ?? "all";
  const query = useResource(marketsStore, key, (force) => fetchMarkets(key, force));
  const rows = query.data?.markets ?? initial;
  const spot = useSpotPrices(rows),
    quotes = useQuotePrices(),
    freshness = useReadFreshness(query);
  const current = freshness.isDataCurrent;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `spot.epoch` marks a spot price expiring, which `Date.now()` then reflects.
  const markets = useMemo(() => {
    const merged = withQuotePrices(
      withMarketSpotPrices(rows, spot.data, Date.now()),
      quotes.data,
      quotes.fresh,
    );
    return current ? merged : merged.map((m) => ({ ...m, bookQuality: "unavailable" as const }));
  }, [rows, spot.data, spot.epoch, quotes.data, quotes.fresh, current]);
  return { ...query, ...freshness, markets };
}
/** The member's own data: read only once its wallet signed in and joined. */
export function useOrders() {
  const account = useMemberAccount(),
    key = account ?? "";
  const query = useResource(ordersStore, key, (force) => fetchOrders(key, force), !!account);
  return { ...query, ...useReadFreshness(query), orders: query.data?.orders ?? NONE };
}
export function usePositions() {
  const account = useMemberAccount(),
    key = account ?? "";
  const query = useResource(positionsStore, key, (force) => fetchPositions(key, force), !!account);
  return { ...query, ...useReadFreshness(query), positions: query.data?.positions ?? NONE };
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
  return { ...query, ...useReadFreshness(query), trades: query.data?.trades ?? NONE };
}
export function useTrades(marketId?: string) {
  const key = marketId ?? "all";
  const query = useResource(
    tradesStore,
    key,
    (force) => fetchTrades(key, force),
    marketId === undefined || !!marketId,
  );
  return { ...query, ...useReadFreshness(query), trades: query.data?.trades ?? NONE };
}
/** A market's recorded prices (public id). They change once a minute: read at most that often. */
export function usePriceHistory(marketId?: string, range: PriceHistoryRange = "all") {
  const query = useResource(
    priceHistoryStore,
    `${marketId ?? ""}:${range}`,
    (force) => fetchPriceHistory(marketId ?? "", range, force),
    !!marketId,
    60_000,
  );
  return { ...query, points: query.data?.points ?? NONE };
}
