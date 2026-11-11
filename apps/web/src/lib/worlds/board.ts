/** An order on the public board, in the words its world is said with: the events it needs, the
 * stock's move it bets on (from the atoms of its mask, which may be the other side of the
 * world's own opinion), and what kind of bet it is. Display only. */
import { nyDate } from "./dates";
import { legLabel } from "./format";
import { feeOn, type ProductName } from "./offer";
import { startParam } from "./start";
import type { BoardRfq, BookView, Spec, Venue } from "./types";

export interface OrderWorld {
  legs: {
    eventKey: string;
    label: string;
    wantYes: boolean;
    /** The chance of the side the world needs, x 1e6. */
    chance: number | null;
    source: Venue | null;
    url: string | null;
    endTime: string | null;
    /** Decided already: it went the world's way, or against it. */
    outcome: "passed" | "failed" | null;
  }[];
  stock: { symbol: string; direction: "above" | "below"; strike: string; date: string } | null;
}

/** The world an order of `mask` bets on, from its book. */
export function orderWorld(book: BookView, mask: number): OrderWorld {
  const outcome = book.products.find((p) => p.mask === mask)?.outcome;
  const direction = outcome?.kind === "above" || outcome?.kind === "below" ? outcome.kind : null;
  const o = book.opinion;
  const strike = direction
    ? (book.strikes[(outcome?.strike ?? 1) - 1]?.price ?? o?.strike ?? null)
    : null;
  const date = o?.fixingDate ?? (book.fixingTime ? nyDate(Number(book.fixingTime) * 1000) : null);
  const symbol = o?.symbol ?? book.underlying?.split(":").at(-1) ?? null;
  return {
    legs: book.legs.map((l) => ({
      eventKey: l.eventKey,
      label: legLabel(l.venue?.question ?? "An event"),
      wantYes: l.wantYes,
      chance: book.analytics?.legs.find((x) => x.eventKey === l.eventKey)?.chance ?? null,
      source: l.venue?.source ?? null,
      url: l.venue?.url ?? null,
      endTime: l.venue?.endTime ?? null,
      outcome: l.outcome,
    })),
    stock: direction && strike && date && symbol ? { symbol, direction, strike, date } : null,
  };
}

/** Where an order of `mask` is placed and shown: the builder with its world's parts (each event
 * as the catalog names it, the stock's move the order bets on), or the world's own page when its
 * book does not say them all. */
export function orderHref(book: BookView, mask: number) {
  const { stock } = orderWorld(book, mask);
  const legs = book.legs.map((l) =>
    l.venue ? { id: `${l.venue.source}:${l.venue.marketId}`, wantYes: l.wantYes } : null,
  );
  const whole =
    legs.every((l) => l !== null) && (stock ? book.underlying !== null : book.eventOnly);
  if (!whole) return `/worlds/${book.id}`;
  const spec: Spec = {
    legs: legs.filter((l): l is Spec["legs"][number] => l !== null),
    stock:
      stock && book.underlying
        ? {
            underlying: book.underlying,
            direction: stock.direction,
            strike: stock.strike,
            date: stock.date,
          }
        : null,
  };
  return `/worlds/new?w=${encodeURIComponent(startParam(spec))}`;
}

/** Which of the two bets an order (or a fill) is: Money-back returns the stake if an event
 * fails. */
export const productOf = (o: { conditional?: boolean; refund: string }): ProductName =>
  o.conditional || BigInt(o.refund) > 0n ? "Money-back" : "All-in";

/** What an order by stake costs its taker, fee included, in raw units. */
export function orderCost(order: BoardRfq["order"], feeBps: number) {
  const stake = BigInt(order.stake ?? "0");
  return stake + feeOn(stake, feeBps);
}

/** The best standing quote of an order that fills now (the board lists them best first). */
export const bestQuote = (rfq: BoardRfq) => rfq.quotes.find((q) => q.fills) ?? null;
/** A wallet's own quote on an order. */
export const quoteOf = (rfq: BoardRfq, wallet: string | null) =>
  wallet
    ? (rfq.quotes.find((q) => q.wallet?.toLowerCase() === wallet.toLowerCase()) ?? null)
    : null;
