"use client";
import { useQueries } from "@tanstack/react-query";
import { useDemo } from "@/components/providers/DemoProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import { protocolConfig } from "@/config/protocol";
import { api } from "@/lib/api/client";
import type { MarketView } from "@/lib/api/types";

export function assetsForMarkets(markets: MarketView[]) {
  return [
    ...new Map(
      markets.flatMap(
        (market) =>
          [
            [
              market.quoteToken.toLowerCase(),
              {
                token: market.quoteToken,
                symbol: "USDG",
                decimals: market.quoteTokenDecimals,
                reference: 1,
              },
            ],
            [
              market.baseToken.toLowerCase(),
              {
                token: market.baseToken,
                symbol: market.ticker,
                decimals: market.baseTokenDecimals,
                reference: market.ordinaryReference,
              },
            ],
          ] as const,
      ),
    ).values(),
  ];
}
export function useWalletAssets(markets: MarketView[]) {
  const { account } = useWallet(),
    demo = useDemo(),
    assets = assetsForMarkets(markets);
  // One cache entry per account/chain/token: the ticket, Funds and Portfolio share each RPC-backed balance read.
  const queries = useQueries({
    queries: assets.map((asset) => ({
      queryKey: [
        "whole-balances",
        account?.toLowerCase(),
        protocolConfig.chainId,
        asset.token.toLowerCase(),
      ],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const balance = await api.balance(account ?? "", asset.token, signal);
        if (
          balance.account.toLowerCase() !== account?.toLowerCase() ||
          balance.token.toLowerCase() !== asset.token.toLowerCase() ||
          balance.decimals !== asset.decimals ||
          !/^(0|[1-9][0-9]{0,77})$/.test(balance.canonicalBalance) ||
          BigInt(balance.canonicalBalance) >= 1n << 256n
        )
          throw new Error("Invalid canonical balance or token metadata.");
        return balance;
      },
      enabled: Boolean(account) && !demo,
      refetchInterval: 8000,
    })),
  });
  const balances = assets.flatMap((asset, index) => {
    const balance = demo
      ? {
          canonicalBalance: demo.state.balances[asset.token.toLowerCase()] ?? "0",
          decimals: asset.decimals,
          blockNumber: String(demo.state.tick),
        }
      : queries[index]?.data;
    return balance ? [{ ...asset, balance }] : [];
  });
  return {
    assets,
    balances,
    isPending: queries.some((q) => q.isPending),
    isFetching: queries.some((q) => q.isFetching),
    isError: queries.some((q) => q.isError),
    refetch: () => Promise.all(queries.map((q) => q.refetch())),
  };
}
