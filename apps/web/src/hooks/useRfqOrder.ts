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
 * An order needs its owner in front of it (nothing fills until a quote is accepted), so leaving
 * the page, or the component, cancels it: no maker keeps funds aside for a screen nobody sees. */
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
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mine = (rfq: Rfq) => {
      attempt = 0;
      if (rfq.id === id) show(rfq);
    };
    const follow = () => {
      worldsApi.rfq
        .follow(owner, controller.signal, mine)
        .catch(() => {})
        .then(() => {
          if (controller.signal.aborted) return;
          timer = setTimeout(
            () => {
              worldsApi.rfq
                .read(owner, id, controller.signal)
                .then(mine)
                .catch(() => {});
              follow();
            },
            Math.min(15_000, 1_000 * 2 ** attempt++),
          );
        });
    };
    follow();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, open, owner, show]);

  // Another wallet's order is not this one's to show.
  const shownFor = useRef(owner);
  useEffect(() => {
    if (shownFor.current !== owner) setOrder(null);
    shownFor.current = owner;
  }, [owner]);

  // Leaving cancels the open order (the call outlives the page).
  const live = useRef<string | null>(null);
  live.current = open ? id : null;
  useEffect(() => {
    const leave = () => {
      if (live.current) void worldsApi.rfq.cancel(live.current, true).catch(() => {});
      live.current = null;
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);

  return { order, show };
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
