"use client";
/** The public board of world orders out for quotes, and the trades as they happen: one stream
 * (`/v2/worlds/board/stream`) for everything on the Explore page. It sends the whole board when
 * it opens (and again whenever it reopens), then each order as it changes and each trade as it
 * confirms, so the page reads nothing on a timer. */
import { useEffect, useRef, useState } from "react";
import type { Board, BoardRfq, BookView, Trade } from "@/lib/worlds/types";
import { apiUrl } from "@/services/constants";
import { worldsApi } from "@/services/worlds-api";

/** How long an order that closed stays in its row, greyed, saying how it ended. */
export const CLOSED_ROW_MS = 6_000;

export interface BoardState {
  /** "loading" until the first board arrives; "offline" while the stream is down. */
  status: "loading" | "live" | "offline";
  available: boolean;
  /** Open orders, the one closing soonest first, and those that closed a moment ago (kept in
   * place). Every order stays open as long as the next, so a new one joins at the end and no
   * row moves under a finger. */
  rfqs: BoardRfq[];
  books: Map<number, BookView>;
  /** ms to add to `Date.now()` for the API's clock, which every countdown runs on. */
  skew: number;
  minQuoteSeconds: number;
  /** Trades confirmed since the page opened, newest first. */
  trades: Trade[];
  /** Counts the stream's reopenings: a reader that pages trades reads its first page again. */
  epoch: number;
}

const EMPTY: BoardState = {
  status: "loading",
  available: true,
  rfqs: [],
  books: new Map(),
  skew: 0,
  minQuoteSeconds: 10,
  trades: [],
  epoch: 0,
};

/** The board's order: the order closing soonest first (the oldest, when two close together). */
const bySoonest = (a: BoardRfq, b: BoardRfq) =>
  a.expiresAt - b.expiresAt || a.createdAt - b.createdAt;

/** Puts `rfq` in the list: in its own row if it has one, at the end if it is new. An older view
 * of the same order (a stream frame behind a call's answer) changes nothing. */
function place(list: BoardRfq[], rfq: BoardRfq) {
  const at = list.findIndex((r) => r.id === rfq.id);
  if (at < 0) return rfq.status === "open" ? [...list, rfq] : list;
  if ((list[at]?.now ?? 0) > rfq.now) return list;
  const next = [...list];
  next[at] = rfq;
  return next;
}

export function useWorldBoard() {
  const [state, setState] = useState<BoardState>(EMPTY);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  /** Shows an order as last heard (a stream frame, or the answer of a call on it). */
  const show = useRef((rfq: BoardRfq, book?: BookView | null) => {
    setState((s) => {
      const books = book && !s.books.has(book.id) ? new Map(s.books).set(book.id, book) : s.books;
      return { ...s, books, rfqs: place(s.rfqs, rfq), skew: rfq.now - Date.now() };
    });
    // A closed order leaves its row after a moment.
    if (rfq.status !== "open" && !timers.current.has(rfq.id))
      timers.current.set(
        rfq.id,
        setTimeout(() => {
          timers.current.delete(rfq.id);
          setState((s) => ({ ...s, rfqs: s.rfqs.filter((r) => r.id !== rfq.id) }));
        }, CLOSED_ROW_MS),
      );
  }).current;

  useEffect(() => {
    let source: EventSource | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const parse = <T>(event: Event) => {
      try {
        return JSON.parse(String((event as MessageEvent).data)) as T;
      } catch {
        return null;
      }
    };
    const open = () => {
      if (stopped) return;
      const s = new EventSource(apiUrl("/v2/worlds/board/stream"));
      source = s;
      s.addEventListener("board", (event) => {
        const board = parse<Board>(event);
        if (!board) return;
        attempt = 0;
        setState((prev) => {
          const books = new Map(prev.books);
          for (const b of board.books) books.set(b.id, b);
          // Orders this page still shows as open but the board no longer lists closed while
          // the stream was away.
          const open = new Set(board.rfqs.map((r) => r.id));
          const closing = prev.rfqs.filter((r) => r.status !== "open" && !open.has(r.id));
          return {
            status: "live",
            available: board.available,
            rfqs: [...board.rfqs, ...closing].sort(bySoonest),
            books,
            skew: board.now - Date.now(),
            minQuoteSeconds: board.minQuoteSeconds ?? 10,
            trades: prev.trades,
            epoch: prev.epoch + 1,
          };
        });
      });
      s.addEventListener("rfq", (event) => {
        const frame = parse<{ rfq: BoardRfq; book?: BookView | null }>(event);
        if (frame?.rfq) show(frame.rfq, frame.book);
      });
      s.addEventListener("trade", (event) => {
        const frame = parse<{ trade: Trade; book?: BookView | null }>(event);
        if (!frame?.trade) return;
        const { trade, book } = frame;
        setState((prev) => {
          if (
            prev.trades.some(
              (t) => t.transactionHash === trade.transactionHash && t.logIndex === trade.logIndex,
            )
          )
            return prev;
          const books =
            book && !prev.books.has(book.id) ? new Map(prev.books).set(book.id, book) : prev.books;
          return { ...prev, books, trades: [trade, ...prev.trades].slice(0, 200) };
        });
      });
      s.onerror = () => {
        // The browser reopens a stream that dropped by itself; one it gave up on is reopened
        // here. Either way the board is stale until the next one arrives.
        setState((prev) => (prev.status === "live" ? { ...prev, status: "offline" } : prev));
        if (s.readyState !== EventSource.CLOSED) return;
        source = null;
        clearTimeout(timer);
        timer = setTimeout(open, Math.min(30_000, 2_000 * 2 ** attempt++));
      };
    };
    open();
    const pending = timers.current;
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(timer);
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, [show]);

  // The stream sends each order's and trade's world. One it could not send (the API's chain
  // view was away just then) is read here, once.
  const asked = useRef(new Set<number>());
  useEffect(() => {
    if (state.status === "loading") return;
    const wanted = [...state.rfqs.map((r) => r.book), ...state.trades.map((t) => t.book)];
    for (const id of new Set(wanted)) {
      if (state.books.has(id) || asked.current.has(id)) continue;
      asked.current.add(id);
      worldsApi
        .book(id)
        .then((book) => setState((s) => ({ ...s, books: new Map(s.books).set(book.id, book) })))
        .catch(() => {});
    }
  }, [state.status, state.rfqs, state.trades, state.books]);

  return { ...state, show };
}
