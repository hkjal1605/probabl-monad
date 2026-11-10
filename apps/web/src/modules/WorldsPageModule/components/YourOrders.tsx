"use client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemberAccount } from "@/components/providers/WalletProvider";
import { Countdown, ProductTag, Stat } from "@/components/worlds/OrderParts";
import { WorldCell } from "@/components/worlds/WorldCell";
import { useMyOpenOrders } from "@/hooks/useMyOpenOrders";
import { useSecond } from "@/hooks/useRfqOrder";
import { orderCost, orderHref, orderWorld } from "@/lib/worlds/board";
import { dollars, money, multiple } from "@/lib/worlds/format";
import type { BookView, Rfq } from "@/lib/worlds/types";

/** The signed-in wallet's orders still out for quotes, the one closing soonest first, each a tap
 * from its board in the builder. Left out when there is none. */
export function YourOrders() {
  const owner = useMemberAccount();
  const mine = useMyOpenOrders(owner);
  const now = useSecond(mine.rfqs.length > 0) + mine.skew;
  const rfqs = mine.rfqs.filter((r) => r.expiresAt > now).sort((a, b) => a.expiresAt - b.expiresAt);
  if (!rfqs.length) return null;
  return (
    <section className="flex flex-col gap-5" aria-labelledby="your-orders-title">
      <h2
        id="your-orders-title"
        className="text-[28px] leading-tight font-medium tracking-[-0.02em] sm:text-4xl"
      >
        Your open orders
      </h2>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rfqs.map((rfq) => (
          <li key={rfq.id} className="min-w-0">
            <OrderCard rfq={rfq} book={mine.books.get(rfq.book) ?? null} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function OrderCard({ rfq, book, now }: { rfq: Rfq; book: BookView | null; now: number }) {
  const paid = dollars(orderCost(rfq.order, book?.feeBps ?? 0));
  // The API lists the quotes that fill first, the best of them first.
  const best = rfq.quotes.find((q) => !q.problem && Number(q.expiry) * 1000 > now) ?? null;
  const quotes = rfq.quotes.filter((q) => !q.problem).length;
  const left = rfq.expiresAt - now;
  return (
    <Link
      href={book ? orderHref(book, rfq.order.mask) : `/worlds/${rfq.book}`}
      className="group flex min-w-0 flex-col gap-3.5 rounded-xl bg-card p-4 ring-1 ring-border transition-[box-shadow,transform] outline-none hover:-translate-y-0.5 hover:ring-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <WorldCell world={book ? orderWorld(book, rfq.order.mask) : null} />
        <ChevronRight
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden
        />
      </div>
      <dl className="grid grid-cols-3 gap-2 border-t pt-3">
        <Stat label="You pay">
          <div className="flex flex-col gap-1">
            {book ? (
              <span className="text-sm font-medium tabular-nums">
                {money(paid, { cents: true })}
              </span>
            ) : (
              <span className="h-5 w-14 rounded bg-secondary" />
            )}
            <ProductTag product={rfq.order.conditional ? "Money-back" : "All-in"} />
          </div>
        </Stat>
        <Stat label="Best quote">
          {best ? (
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
                {money(dollars(best.units))}
                <span className="rounded-full bg-positive-soft px-1.5 py-px text-[11px] font-semibold text-positive">
                  {multiple(dollars(best.units), paid)}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground">
                {quotes === 1 ? "1 quote" : `${quotes} quotes`}
              </span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">No quote yet</span>
          )}
        </Stat>
        <Stat label="Closes in" className="items-end text-right">
          <Countdown left={left} share={left / Math.max(1, rfq.expiresAt - rfq.createdAt)} />
        </Stat>
      </dl>
    </Link>
  );
}
