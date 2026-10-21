"use client";
import { useEffect, useReducer } from "react";
import { freshnessExpiry, type ReadState, readFreshness } from "@/services/read-policy";

/** `readFreshness` of a read, re-evaluated when its data expires (one timer at that moment, not a
 * clock) and when the tab regains focus. */
export function useReadFreshness(query: ReadState, maxAgeMs = 30_000) {
  const [, recheck] = useReducer((n: number) => n + 1, 0);
  const expiry = freshnessExpiry(query, maxAgeMs);
  useEffect(() => {
    if (expiry === null) return;
    const timer = setTimeout(recheck, Math.max(0, expiry - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [expiry]);
  useEffect(() => {
    // Timers are throttled in background tabs; re-evaluate when the tab comes back.
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);
  return readFreshness(query, Date.now(), maxAgeMs);
}
