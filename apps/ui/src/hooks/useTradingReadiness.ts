"use client";
import { useQuery } from "@tanstack/react-query";
import { useDemo } from "@/components/providers/DemoProvider";
import { protocolConfig } from "@/config/protocol";
import { api } from "@/lib/api/client";

export function useTradingReadiness(marketId: string) {
  const demo = useDemo();
  const configured =
    /^0x[0-9a-fA-F]{40}$/.test(protocolConfig.atomicRouter) &&
    !/^0x0{40}$/.test(protocolConfig.atomicRouter);
  const query = useQuery({
    queryKey: ["trading-readiness", marketId, protocolConfig.chainId],
    queryFn: ({ signal }) => api.readiness(marketId, signal),
    enabled: !demo && configured,
    refetchInterval: 3000,
    retry: false,
    staleTime: 0,
  });
  if (demo) {
    const market = demo.markets.find((m) => m.id === marketId),
      ready = market?.lifecycle === "open" && demo.state.now < Date.parse(market.cutoff);
    return {
      ready,
      reason: ready
        ? "Local demo ready"
        : "Trading is closed in this demo market. Visit Resolution to continue.",
    };
  }
  const ready = configured && !query.isError && query.data?.healthy === true;
  return {
    ready,
    reason: !configured
      ? "Atomic trading contracts are not configured for this UI deployment."
      : query.isPending
        ? "Checking trading services…"
        : ready
          ? "Trading services ready"
          : "Trading is temporarily unavailable. Cancellation and claim recovery remain available.",
  };
}
