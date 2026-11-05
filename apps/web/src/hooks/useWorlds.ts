"use client";
/** Reads of the worlds API with their refresh rules: the feed, a world's book, holders and
 * fills follow the world stream (and a slow poll as a backstop); stocks are read once a minute.
 * Each read aborts when its inputs change or its component goes away. */
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeWorlds, type WorldUpdate } from "@/lib/worlds/stream";
import type { BookView, FeedWorld, Holder, Stock, WorldFill } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";

export interface Read<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  refresh: () => void;
}

/** One read, refreshed every `everyMs` and whenever `follows(update)` says so. */
export function useRead<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  options: { everyMs?: number; follows?: (update: WorldUpdate) => boolean } = {},
): Read<T> {
  const [state, setState] = useState<{
    key: string | null;
    data?: T | undefined;
    error: Error | null;
  }>({
    key: null,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const followsRef = useRef(options.follows);
  followsRef.current = options.follows;
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` asks for a fresh read.
  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    loadRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data, error: null });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted && error.name !== "AbortError")
          setState((s) => ({ key, data: s.key === key ? s.data : undefined, error }));
      });
    return () => controller.abort();
  }, [key, tick]);
  useEffect(() => {
    if (key === null) return;
    const every = options.everyMs;
    const interval = every ? setInterval(refresh, every) : undefined;
    // Updates come in bursts (a fill touches its book and its owners): one read per burst.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = followsRef.current
      ? subscribeWorlds((update) => {
          if (!followsRef.current?.(update)) return;
          clearTimeout(pending);
          pending = setTimeout(refresh, 400);
        })
      : undefined;
    return () => {
      clearInterval(interval);
      clearTimeout(pending);
      unsubscribe?.();
    };
  }, [key, options.everyMs, refresh]);
  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : null,
    loading: key !== null && (!current || (state.data === undefined && !state.error)),
    refresh,
  };
}

let stocksCache: {
  at: number;
  value: Promise<{ stocks: Stock[]; maxTenor?: number | null }>;
} | null = null;
/** The stocks read (shared, at most once a minute). The shared read belongs to no one caller: a
 * caller that goes away stops listening, but never aborts it for the others (React's development
 * double mount did, and the stocks then never loaded). */
function readStocks() {
  if (!stocksCache || Date.now() - stocksCache.at > 60_000) {
    const value = worldsApi.stocks();
    stocksCache = { at: Date.now(), value };
    value.catch(() => {
      stocksCache = null;
    });
  }
  return stocksCache.value;
}
/** The stocks a world can fix on, with spot. */
export function useStocks() {
  return useRead("stocks", () => readStocks().then((r) => r.stocks), { everyMs: 60_000 });
}
/** How far ahead a world's stock can be read, in seconds (the vault's tenor), from the same read;
 * null while unknown. */
export function useMaxTenor() {
  const read = useRead("max-tenor", () => readStocks().then((r) => r.maxTenor ?? null), {
    everyMs: 60_000,
  });
  return read.data ?? null;
}

export function useWorldsFeed(sort: string, underlying: string) {
  return useRead<FeedWorld[]>(
    `feed:${sort}:${underlying}`,
    (signal) => worldsApi.feed(sort, underlying, signal),
    {
      everyMs: 30_000,
      follows: (u) => u.books.length > 0,
    },
  );
}

export function useBook(book: number | null) {
  return useRead<BookView>(
    book === null ? null : `book:${book}`,
    (signal) => worldsApi.book(book!, signal),
    {
      everyMs: 15_000,
      follows: (u) => u.books.includes(book!) || u.events.length > 0,
    },
  );
}

export function useHolders(book: number | null) {
  return useRead(
    book === null ? null : `holders:${book}`,
    (signal) => worldsApi.holders(book!, signal),
    {
      everyMs: 30_000,
      follows: (u) => u.books.includes(book!),
    },
  );
}

export function useFills(book: number | null) {
  return useRead<WorldFill[]>(
    book === null ? null : `fills:${book}`,
    (signal) => worldsApi.fills(book!, signal),
    {
      everyMs: 30_000,
      follows: (u) => u.books.includes(book!),
    },
  );
}

export type { Holder };
