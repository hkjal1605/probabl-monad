"use client";
import { useEffect, useState } from "react";
import { useDemo } from "@/components/providers/DemoProvider";
import { protocolConfig } from "@/config/protocol";
import { logger } from "@/lib/logger";

export function useTradingReadiness(marketId: string) {
  const demo = useDemo();
  const isDemo = Boolean(demo);
  const [ready, setReady] = useState(false);
  const [reason, setReason] = useState("Checking trading services…");
  useEffect(() => {
    if (isDemo) return;
    if (
      !/^0x[0-9a-fA-F]{40}$/.test(protocolConfig.atomicRouter) ||
      /^0x0{40}$/.test(protocolConfig.atomicRouter)
    ) {
      setReady(false);
      setReason("Atomic trading contracts are not configured for this UI deployment.");
      return;
    }
    let stopped = false;
    let previousReady: boolean | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const response = await fetch(
          `/api/gateway/system/readiness?marketId=${encodeURIComponent(marketId)}`,
          { cache: "no-store", signal: AbortSignal.timeout(7000) },
        );
        const body = await response.json();
        if (!stopped) {
          const healthy =
            response.ok &&
            typeof body === "object" &&
            body !== null &&
            "healthy" in body &&
            body.healthy === true;
          if (healthy !== previousReady) {
            logger.info("trading.readiness.changed", {
              marketId,
              ready: healthy,
              status: response.status,
            });
            previousReady = healthy;
          }
          setReady(healthy);
          setReason(
            healthy
              ? "Trading services ready"
              : "Trading temporarily unavailable: indexer or reconciliation requires attention.",
          );
        }
      } catch (error) {
        if (!stopped) {
          if (previousReady !== false)
            logger.warn("trading.readiness.unavailable", { marketId, error });
          previousReady = false;
          setReady(false);
          setReason(
            "Trading services are unreachable. Cancellation and claim recovery remain available.",
          );
        }
      } finally {
        if (!stopped) timer = setTimeout(tick, 3000);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [marketId, isDemo]);
  if (demo) {
    const market = demo.markets.find((item) => item.id === marketId);
    const open = market?.lifecycle === "open" && demo.state.now < Date.parse(market.cutoff);
    return {
      ready: open,
      reason: open
        ? "Local demo ready"
        : "Trading is closed in this demo market. Visit Resolution to continue.",
    };
  }
  return { ready, reason };
}
