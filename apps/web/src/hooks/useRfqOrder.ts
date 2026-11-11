"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Rfq } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";

/** An order out for quotes, as last heard from the API, and how far the API's clock is from
 * this one (ms to add to `Date.now()`), so its countdowns run on the API's time. */
export interface RfqOrder {
  rfq: Rfq;
  skew: number;
}

/** The wallet's order while it is out for quotes. `show` puts one on screen (the answer of
 * opening it, or of any call on it); from then on the API's stream keeps it current as quotes
 * arrive, are replaced, withdrawn or run out, and when it closes. A stream that breaks is
 * picked up again after one read of the order.
 *
 * Leaving the page leaves the order open: it stays until its owner cancels it, accepts a quote
 * or it runs out, and opening its world again shows it (`WorldTicket`). */
export function useRfqOrder(owner: string | null) {
  const [order, setOrder] = useState<RfqOrder | null>(null);
  const show = useCallback((rfq: Rfq | null) => {
    setOrder((current) => {
      if (!rfq) return null;
      // An older view (a stream frame behind a call's answer) changes nothing.
      if (current && current.rfq.id === rfq.id && current.rfq.now > rfq.now) return current;
      return { rfq, skew: rfq.now - Date.now() };
    });
  }, []);

  const id = order?.rfq.id ?? null;
  const open = order?.rfq.status === "open";
  useEffect(() => {
    if (!id || !open || !owner) return;
    const controller = new AbortController();
    followOrders(
      owner,
      controller.signal,
      (rfq) => {
        if (rfq.id === id) show(rfq);
      },
      () =>
        worldsApi.rfq
          .read(owner, id, controller.signal)
          .then(show)
          .catch(() => {}),
    );
    return () => controller.abort();
  }, [id, open, owner, show]);

  // Another wallet's order is not this one's to show.
  const shownFor = useRef(owner);
  useEffect(() => {
    if (shownFor.current !== owner) setOrder(null);
    shownFor.current = owner;
  }, [owner]);

  return { order, show };
}

/** Follows the wallet's orders over the API's stream (`onRfq` with each as it changes) until
 * `signal` aborts. A stream that breaks is picked up again after a pause that grows while it
 * keeps breaking, with `missed` first: a read that covers what the gap hid. */
export function followOrders(
  owner: string,
  signal: AbortSignal,
  onRfq: (rfq: Rfq) => void,
  missed: () => void,
) {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  signal.addEventListener("abort", () => clearTimeout(timer));
  const follow = () => {
    worldsApi.rfq
      .follow(owner, signal, (rfq) => {
        attempt = 0;
        onRfq(rfq);
      })
      .catch(() => {})
      .then(() => {
        if (signal.aborted) return;
        timer = setTimeout(
          () => {
            missed();
            follow();
          },
          Math.min(15_000, 1_000 * 2 ** attempt++),
        );
      });
  };
  follow();
}

/** The clock, once a second while `active` (a countdown on screen), and not at all otherwise. */
export function useSecond(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
