"use client";
import { useSyncExternalStore } from "react";
import {
  readTour,
  TOUR_KEY,
  TOUR_STEPS,
  type TourState,
  type TourStep,
  writeTour,
} from "@/lib/first-trade-tour";

/** The first-trade tour's state, read from the browser once and kept in step with other tabs. */
let state: TourState | null | undefined;
const listeners = new Set<() => void>();
const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const notify = () => {
  for (const listener of listeners) listener();
};

export const tourStore = {
  get(): TourState | null {
    if (state === undefined) state = typeof window === "undefined" ? null : readTour(storage());
    return state;
  },
  set(next: TourState) {
    state = next;
    writeTour(storage(), next);
    notify();
  },
  subscribe(listener: () => void) {
    if (!listeners.size && typeof window !== "undefined")
      window.addEventListener("storage", onStorage);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size && typeof window !== "undefined")
        window.removeEventListener("storage", onStorage);
    };
  },
};
function onStorage(event: StorageEvent) {
  if (event.key !== TOUR_KEY) return;
  state = undefined;
  notify();
}

/** Starts the tour from its first step. The onboarding guide offers it as it ends, and asking
 * for it there always starts it, even in a browser that finished or skipped it before (another
 * wallet set up here); it never starts unasked. */
export function startFirstTradeTour() {
  tourStore.set({ status: "active", step: "market" });
}
/** Ends the tour for good (or declines it before it starts). */
export function skipFirstTradeTour() {
  if (tourStore.get()?.status !== "done") tourStore.set({ status: "skipped" });
}
export function finishFirstTradeTour() {
  tourStore.set({ status: "done" });
}
/** Moves an active tour on to `step`, never back. */
export function reachTourStep(step: TourStep) {
  const current = tourStore.get();
  if (current?.status === "active" && TOUR_STEPS.indexOf(step) > TOUR_STEPS.indexOf(current.step))
    tourStore.set({ status: "active", step });
}

export function useFirstTradeTour() {
  return useSyncExternalStore(tourStore.subscribe, tourStore.get, () => null);
}
