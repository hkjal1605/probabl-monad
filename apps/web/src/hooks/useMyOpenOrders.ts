"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BookView, Rfq } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";
import { followOrders } from "./useRfqOrder";

interface Mine {
  owner: string;
  rfqs: Map<string, Rfq>;
  /** ms to add to `Date.now()` for the API's clock, which the orders' times are on. */
  skew: number;
  books: Map<number, BookView>;
}

/** The signed-in wallet's orders out for quotes: one read of the open ones (the API holds them
 * in memory), then, while any is open, the wallet's order stream keeps them current (quotes
 * arriving, an order closing) and each order's world is read once. With none open nothing more
 * is read. */
export function useMyOpenOrders(owner: string | null) {
  const [state, setState] = useState<Mine | null>(null);
  /** The open orders as one answer has them, all at once (the first read, or a gap's). */
  const reset = useCallback((who: string, rfqs: Rfq[]) => {
    const open = rfqs.filter((r) => r.status === "open");
    setState((s) => ({
      owner: who,
      rfqs: new Map(open.map((r) => [r.id, r])),
      skew: open[0] ? open[0].now - Date.now() : (s?.skew ?? 0),
      books: s?.owner === who ? s.books : new Map(),
    }));
  }, []);
  /** One order as it changed: kept while open, gone once closed. */
  const take = useCallback((who: string, rfq: Rfq) => {
    setState((s) => {
      if (!s || s.owner !== who) return s;
      const held = s.rfqs.get(rfq.id);
      if (held && held.now > rfq.now) return s;
      const rfqs = new Map(s.rfqs);
      if (rfq.status === "open") rfqs.set(rfq.id, rfq);
      else rfqs.delete(rfq.id);
      return { ...s, rfqs, skew: rfq.now - Date.now() };
    });
  }, []);

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    worldsApi.rfq
      .list(owner, controller.signal)
      .then((rfqs) => reset(owner, rfqs))
      .catch(() => {});
    return () => controller.abort();
  }, [owner, reset]);

  const mine = state && state.owner === owner ? state : null;
  const open = mine !== null && mine.rfqs.size > 0;
  useEffect(() => {
    if (!owner || !open) return;
    const controller = new AbortController();
    followOrders(
      owner,
      controller.signal,
      (rfq) => take(owner, rfq),
      () =>
        worldsApi.rfq
          .list(owner, controller.signal)
          .then((rfqs) => reset(owner, rfqs))
          .catch(() => {}),
    );
    return () => controller.abort();
  }, [owner, open, take, reset]);

  const asked = useRef(new Set<number>());
  const wanted = mine
    ? [...new Set([...mine.rfqs.values()].map((r) => r.book))].filter((b) => !mine.books.has(b))
    : [];
  const wantedKey = wanted.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `wantedKey` says which books are missing.
  useEffect(() => {
    for (const id of wanted) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      worldsApi
        .book(id)
        .then((book) =>
          setState((s) => (s ? { ...s, books: new Map(s.books).set(book.id, book) } : s)),
        )
        .catch(() => asked.current.delete(id));
    }
  }, [wantedKey]);

  return {
    rfqs: mine ? [...mine.rfqs.values()] : [],
    books: mine?.books ?? new Map<number, BookView>(),
    skew: mine?.skew ?? 0,
  };
}
