"use client";
import { useQuery } from "@tanstack/react-query";
import { useDemo } from "@/components/providers/DemoProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import { protocolConfig } from "@/config/protocol";
import { api } from "@/lib/api/client";
import type { MarketView } from "@/lib/api/types";

export function useMarkets(initial: MarketView[] = []) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["markets", protocolConfig.chainId],
    queryFn: ({ signal }) => api.markets(signal),
    enabled: !demo,
    ...(initial.length ? { initialData: { markets: initial } } : {}),
    refetchInterval: 10_000,
  });
  return { ...query, markets: demo?.markets ?? query.data?.markets ?? initial };
}
export function useOrders() {
  const { account } = useWallet();
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["wallet-orders", account?.toLowerCase(), protocolConfig.chainId],
    queryFn: ({ signal }) => api.orders(account ?? "", signal),
    enabled: Boolean(account) && !demo,
    refetchInterval: 6_000,
  });
  return { ...query, orders: demo?.state.orders ?? query.data?.orders ?? [] };
}
export function usePositions() {
  const { account } = useWallet();
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["positions", account?.toLowerCase(), protocolConfig.chainId],
    queryFn: ({ signal }) => api.positions(account ?? "", signal),
    enabled: Boolean(account) && !demo,
    refetchInterval: 8_000,
  });
  return { ...query, positions: demo?.state.positions ?? query.data?.positions ?? [] };
}
export function useTrades(marketId: string) {
  const demo = useDemo();
  const query = useQuery({
    queryKey: ["trades", marketId, protocolConfig.chainId],
    queryFn: ({ signal }) => api.trades(marketId, signal),
    enabled: !demo && Boolean(marketId),
    refetchInterval: 5_000,
  });
  return {
    ...query,
    trades: demo
      ? demo.state.trades.filter((t) => t.marketId === marketId)
      : (query.data?.trades ?? []),
  };
}
