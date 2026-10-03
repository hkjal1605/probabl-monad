"use client";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { indexStreamHealthy } from "@/services/index-stream";
import { emptyResource, type ResourceStore } from "@/stores/createResourceStore";

export function useResource<T>(
  resource: ResourceStore<T>,
  key: string,
  load: (force?: boolean) => Promise<void>,
  enabled = true,
  /** How old data may get before it is read again (resources that change slowly read less). */
  refreshMs = 10_000,
) {
  const latest = useRef(load);
  latest.current = load;
  const entry = useStore(resource.store, (s) =>
    enabled ? (s.entries[key] ?? emptyResource) : emptyResource,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: The loader is read through a ref; a store reset (generation) resubscribes.
  useEffect(() => {
    if (!enabled) return;
    const existing = resource.active.get(key);
    if (existing) existing.count++;
    else resource.active.set(key, { count: 1, refresh: () => load(true) });
    void latest.current();
    const timer = setInterval(() => {
      if (document.hidden) return;
      const current = resource.get(key);
      if ((current.streamUntil ?? 0) > Date.now() && !current.error) return;
      const covered = [
        "markets",
        "wallet-orders",
        "wallet-trades",
        "trades",
        "positions",
        "whole-balances",
        "trading-readiness",
        "payout-credits",
        "resolution",
      ].includes(resource.name);
      if (covered && indexStreamHealthy() && !current.error && current.data !== undefined) return;
      if (Date.now() - current.updatedAt >= (current.error ? 30_000 : refreshMs))
        void latest.current(true);
    }, 10_000);
    return () => {
      clearInterval(timer);
      const active = resource.active.get(key);
      if (active && --active.count === 0) resource.active.delete(key);
    };
  }, [resource, key, enabled, refreshMs, resource.generation()]);
  return {
    data: entry.data,
    error: entry.error,
    isError: !!entry.error,
    isPending: enabled && entry.data === undefined && !entry.error,
    isFetching: entry.loading,
    dataUpdatedAt: entry.updatedAt,
    failureCount: entry.error ? 1 : 0,
    refetch: () => latest.current(true),
  };
}
