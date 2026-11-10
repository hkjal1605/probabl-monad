"use client";
import { ChevronRight, Radio } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Countdown, ProductTag, Stat } from "@/components/worlds/OrderParts";
import { WorldCell } from "@/components/worlds/WorldCell";
import type { BoardState } from "@/hooks/useWorldBoard";
import { cn } from "@/lib/utils";
import { bestQuote, orderCost, orderWorld, productOf, quoteOf } from "@/lib/worlds/board";
import { dollars, money, multiple, shortWallet } from "@/lib/worlds/format";
import type { BoardRfq } from "@/lib/worlds/types";
import { ORDERS_CAP, SCROLL_FADE, STICKY_HEAD, scrollMore } from "./scroll";

/** How an order that just closed is said in its row. */
const ENDED: Record<Exclude<BoardRfq["status"], "open">, string> = {
  filled: "Filled",
  cancelled: "Cancelled",
  expired: "Ran out",
};

/** Everything a row says about its order, worked out once for the table and the cards. */
function rowOf(rfq: BoardRfq, board: BoardState, me: string | null, now: number) {
  const book = board.books.get(rfq.book);
  const paid = dollars(orderCost(rfq.order, book?.feeBps ?? 0));
  const best = bestQuote(rfq);
  const mine = quoteOf(rfq, me);
  const life = Math.max(1, rfq.expiresAt - rfq.createdAt);
  const left = Math.max(0, rfq.expiresAt - now);
  return {
    rfq,
    world: book ? orderWorld(book, rfq.order.mask) : null,
    product: productOf(rfq.order),
    paid,
    best: best ? dollars(best.units) : null,
    mine: mine ? dollars(mine.units) : null,
    leading: Boolean(mine && best && mine.makerId === best.makerId),
    own: me !== null && rfq.taker.toLowerCase() === me.toLowerCase(),
    open: rfq.status === "open",
    /** Just arrived: its row is marked for a moment, since it joins at the end. */
    fresh: now - rfq.createdAt < 5_000,
    left,
    share: left / life,
  };
}
type Row = ReturnType<typeof rowOf>;

/** The orders out for quotes right now: each row is one person's order, what they pay, the best
 * quote on it so far and how long it stays open. A row opens the order, where anyone can offer
 * their own quote. Rows keep their place: the order closing soonest is first and a new one joins
 * at the end (every order stays open as long as the next), so nothing moves under a finger; one
 * that closes stays a moment, greyed, saying how it ended. Past a height cap the rows scroll
 * inside the list (`./scroll`). */
export function OpenOrders({
  board,
  me,
  now,
  selected,
  onOpen,
}: {
  board: BoardState;
  me: string | null;
  /** The API's clock (ms). */
  now: number;
  /** The order whose detail is open. */
  selected: string | null;
  onOpen: (rfq: BoardRfq) => void;
}) {
  const rows = board.rfqs.map((rfq) => rowOf(rfq, board, me, now));
  if (board.status === "loading")
    return (
      <div className="flex flex-col gap-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-secondary/60" />
        ))}
      </div>
    );
  if (!rows.length)
    return (
      <Empty className="min-h-52 rounded-xl ring-1 ring-border">
        <EmptyHeader>
          <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <Radio className="size-5" aria-hidden />
          </span>
          <EmptyTitle>No open orders right now</EmptyTitle>
          <EmptyDescription>
            {board.available
              ? "World orders waiting for quotes show up here."
              : "Orders are not taking quotes on this network right now."}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="secondary" size="sm" render={<Link href="/worlds" />} nativeButton={false}>
          Build a world
        </Button>
      </Empty>
    );
  return (
    <>
      {/* Wide screens: a table. */}
      <div className="hidden overflow-hidden rounded-xl ring-1 ring-border md:block">
        <Table
          className="table-fixed"
          containerRef={scrollMore}
          containerClassName={cn(ORDERS_CAP, SCROLL_FADE)}
        >
          <TableHeader className={STICKY_HEAD}>
            <TableRow>
              <TableHead className="w-[38%] pl-4">World</TableHead>
              <TableHead className="w-[17%]">They pay</TableHead>
              <TableHead className="w-[19%]">Best quote</TableHead>
              <TableHead className="w-[13%]">Closes in</TableHead>
              <TableHead className="w-[13%] pr-4 text-right">
                <span className="sr-only">Quote</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.rfq.id}
                data-state={selected === r.rfq.id ? "selected" : undefined}
                className={cn(
                  "cursor-pointer transition-[background-color,opacity] duration-700",
                  !r.open && "pointer-events-none opacity-50",
                  r.open && (r.fresh || r.mine !== null) && "bg-brand-soft/30",
                )}
                onClick={() => onOpen(r.rfq)}
              >
                <TableCell className="h-auto py-3.5 pl-4 whitespace-normal">
                  <WorldCell world={r.world} />
                </TableCell>
                <TableCell className="h-auto">
                  <Pays row={r} />
                </TableCell>
                <TableCell className="h-auto">
                  <Best row={r} />
                </TableCell>
                <TableCell className="h-auto">
                  <Closes row={r} />
                </TableCell>
                <TableCell className="h-auto pr-4 text-right">
                  <Action row={r} onOpen={() => onOpen(r.rfq)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Phones: a card an order. The box is a pixel wider than its cards, so their rings show. */}
      <div ref={scrollMore} className={cn("-m-px p-px md:hidden", ORDERS_CAP, SCROLL_FADE)}>
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.rfq.id}>
              <article
                className={cn(
                  "flex flex-col gap-3.5 rounded-xl bg-card p-4 ring-1 ring-border transition-[box-shadow,opacity] duration-700",
                  !r.open && "opacity-50",
                  r.open && (r.fresh || r.mine !== null) && "ring-brand/40",
                )}
              >
                <WorldCell world={r.world} />
                <dl className="grid grid-cols-3 gap-2 border-t pt-3">
                  <Stat label="They pay">
                    <Pays row={r} />
                  </Stat>
                  <Stat label="Best quote">
                    <Best row={r} />
                  </Stat>
                  <Stat label="Closes in" className="items-end text-right">
                    <Closes row={r} />
                  </Stat>
                </dl>
                <Action row={r} wide onOpen={() => onOpen(r.rfq)} />
              </article>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** What the taker pays, and for which of the two bets. */
function Pays({ row }: { row: Row }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium tabular-nums">{money(row.paid, { cents: true })}</span>
      <ProductTag product={row.product} />
    </div>
  );
}

/** The best payout offered so far, as dollars and as a multiple of what the taker pays. */
function Best({ row }: { row: Row }) {
  if (row.best === null) return <span className="text-sm text-muted-foreground">No quote yet</span>;
  const n = row.rfq.quotes.length;
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
        {money(row.best)}
        <span className="rounded-full bg-positive-soft px-1.5 py-px text-[11px] font-semibold text-positive">
          {multiple(row.best, row.paid)}
        </span>
      </span>
      <span className="text-[11px] text-muted-foreground">
        {row.leading ? "yours" : n === 1 ? "1 quote" : `${n} quotes`}
      </span>
    </div>
  );
}

/** How long the order stays open: the time, and a line that drains with it. */
function Closes({ row }: { row: Row }) {
  if (!row.open)
    return (
      <span className="text-sm font-medium text-muted-foreground">
        {ENDED[row.rfq.status as keyof typeof ENDED]}
      </span>
    );
  return <Countdown left={row.left} share={row.share} />;
}

/** The row's one action: quote it, or see the quote this wallet has on it. An order is not
 * its own taker's to quote. */
function Action({ row, wide = false, onOpen }: { row: Row; wide?: boolean; onOpen: () => void }) {
  if (!row.open) return null;
  const className = wide ? "h-10 w-full" : undefined;
  const stop = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpen();
  };
  if (row.own)
    return (
      <Button variant="ghost" size="sm" className={className} onClick={stop}>
        Your order
        <ChevronRight data-icon="inline-end" />
      </Button>
    );
  if (row.mine !== null)
    return (
      <Button variant="secondary" size="sm" className={className} onClick={stop}>
        Your quote · {money(row.mine)}
      </Button>
    );
  return (
    <Button size="sm" className={className} onClick={stop}>
      Quote
    </Button>
  );
}

/** Who placed an order, as the detail view says it. */
export const takerName = (rfq: BoardRfq, me: string | null) =>
  me && rfq.taker.toLowerCase() === me.toLowerCase() ? "You" : shortWallet(rfq.taker);
