"use client";
import { useEffect, useReducer } from "react";

/** Re-renders when the earliest of `times` (ms) still ahead arrives, then at the next: for what
 * changes with the clock alone, such as a market reaching its cutoff or an order expiring. One
 * timer at a time, never a clock. */
export function useRerenderAt(times: readonly number[]) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const now = Date.now();
  const next = times.reduce((soonest, t) => (t > now && t < soonest ? t : soonest), Infinity);
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(rerender, Math.min(2_147_483_647, next - Date.now() + 50));
    return () => clearTimeout(timer);
  }, [next]);
}
