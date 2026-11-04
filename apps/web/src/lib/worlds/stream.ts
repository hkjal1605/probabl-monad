"use client";
/** The world index's update stream (`/v2/stream`), shared: one EventSource for every listener on
 * the page (the HTTP/2 stream limit counts each), reopened with backoff, closed when the last
 * listener leaves. A frame names the books, owners and events that changed. */
import { apiUrl } from "@/services/constants";

export interface WorldUpdate {
  block: string;
  books: number[];
  owners: string[];
  events: string[];
}
type Listener = (update: WorldUpdate) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function open() {
  if (source || typeof window === "undefined" || !listeners.size) return;
  const s = new EventSource(apiUrl("/v2/stream"));
  source = s;
  const deliver = (event: MessageEvent) => {
    attempt = 0;
    try {
      const update = JSON.parse(String(event.data)) as WorldUpdate;
      for (const listener of listeners) listener(update);
    } catch {
      // A malformed frame changes nothing.
    }
  };
  s.addEventListener("worlds", deliver as EventListener);
  s.addEventListener("reset", deliver as EventListener);
  s.onerror = () => {
    if (s.readyState !== EventSource.CLOSED) return;
    source = null;
    clearTimeout(timer);
    timer = setTimeout(open, Math.min(30_000, 2_000 * 2 ** attempt++));
  };
}

/** Calls `listener` with each update until the returned function is called. */
export function subscribeWorlds(listener: Listener) {
  listeners.add(listener);
  open();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      source?.close();
      source = null;
      clearTimeout(timer);
    }
  };
}
