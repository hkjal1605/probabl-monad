"use client";
import { ArrowUpRight, Landmark } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DataError, EmptyState } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WalletDot } from "@/components/worlds/primitives";
import { WorldCell } from "@/components/worlds/WorldCell";
import { protocolConfig } from "@/config/protocol";
import { safeExternalUrl } from "@/lib/markets/resolution";
import { cn } from "@/lib/utils";
import { orderWorld, productOf } from "@/lib/worlds/board";
import { ago, dollars, money, multiple, shortWallet } from "@/lib/worlds/format";
import type { BookView, Trade } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";
import { SCROLL_FADE, STICKY_HEAD, scrollMore, TRADES_CAP } from "./scroll";

const PAGE = 25;
const keyOf = (t: Trade) => `${t.transactionHash}:${t.logIndex}`;
/** Chain order, newest first. */
const newest = (a: Trade, b: Trade) =>
  a.block === b.block ? b.logIndex - a.logIndex : BigInt(a.block) < BigInt(b.block) ? 1 : -1;

/** How a trade's bet stands: still open, or how it settled for its taker. */
function resultOf(t: Trade, book: BookView | undefined) {
  if (t.sell) return null;
  if (!book || book.winner === null) return { label: "Open", tone: "muted" as const };
  if ((t.mask >> book.winner) & 1) return { label: "Won", tone: "positive" as const };
  return book.winner === 0 && BigInt(t.refund) > 0n
    ? { label: "Money back", tone: "info" as const }
    : { label: "Lost", tone: "danger" as const };
}

/** Everything a row says about its trade, for the table and the phone's list. */
function rowOf(t: Trade, book: BookView | undefined, me: string | null) {
  const price = BigInt(t.price),
    fee = BigInt(t.fee);
  const mine = (address: string) => me !== null && address.toLowerCase() === me.toLowerCase();
  return {
    trade: t,
    world: book ? orderWorld(book, t.mask) : null,
    kind: t.sell ? ("Cash-out" as const) : productOf(t),
    /** What the taker paid (a buy) or was paid (a cash-out), fee included. */
    paid: dollars(t.sell ? price - fee : price + fee),
    pays: dollars(t.units),
    result: resultOf(t, book),
    taker: mine(t.taker) ? "You" : shortWallet(t.taker),
    maker: mine(t.maker) ? "You" : t.vault ? "Vault" : shortWallet(t.maker),
  };
}
type Row = ReturnType<typeof rowOf>;

/** Every world trade, newest first: when, the bet, what its taker paid and what it pays if
 * right, who took it and who made it, how it stands, and its transaction. Trades made while
 * the page is open arrive on the board's stream (`live`) and join at the top; older ones load
 * a page at a time. Past a height cap the rows scroll inside the list (`./scroll`). */
export function TradeHistory({
  live,
  books,
  epoch,
  me,
}: {
  live: Trade[];
  books: Map<number, BookView>;
  /** Counts the stream's reopenings: after one, the first page is read again. */
  epoch: number;
  me: string | null;
}) {
  const [loaded, setLoaded] = useState<{ trades: Trade[]; next: string | null } | null>(null);
  const [extra, setExtra] = useState<Map<number, BookView>>(() => new Map());
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const take = (page: { books: BookView[] }) =>
    setExtra((prev) => {
      const next = new Map(prev);
      for (const b of page.books) next.set(b.id, b);
      return next;
    });
  // The first page: when the page opens, and again after the stream was away (the stream's
  // first opening is the page's own).
  const reopened = Math.max(0, epoch - 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reopened` and `attempt` ask for a fresh read.
  useEffect(() => {
    const controller = new AbortController();
    worldsApi
      .trades(PAGE, null, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        take(page);
        setLoaded({ trades: page.trades, next: page.next });
        setError(false);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted && e.name !== "AbortError") setError(true);
      });
    return () => controller.abort();
  }, [reopened, attempt]);

  const more = () => {
    if (!loaded?.next || loadingMore) return;
    setLoadingMore(true);
    worldsApi
      .trades(PAGE, loaded.next)
      .then((page) => {
        take(page);
        setLoaded((prev) => ({
          trades: [...(prev?.trades ?? []), ...page.trades],
          next: page.next,
        }));
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  // "5m ago" moves on by itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    // A trade heard on the stream and read in a page is one trade.
    const unique = new Map<string, Trade>();
    for (const t of [...live, ...(loaded?.trades ?? [])])
      if (!unique.has(keyOf(t))) unique.set(keyOf(t), t);
    return [...unique.values()]
      .sort(newest)
      .map((t) => rowOf(t, books.get(t.book) ?? extra.get(t.book), me));
  }, [live, loaded, books, extra, me]);

  if (error && !loaded)
    return <DataError retry={() => setAttempt((a) => a + 1)} message="Trades are unavailable." />;
  if (!loaded && !rows.length)
    return (
      <div className="flex flex-col gap-2" aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary/60" />
        ))}
      </div>
    );
  if (!rows.length) return <EmptyState>No trades yet.</EmptyState>;
  const explorer = safeExternalUrl(protocolConfig.explorerUrl)?.replace(/\/+$/, "") ?? null;
  const tx = (t: Trade) => (explorer ? `${explorer}/tx/${t.transactionHash}` : null);
  return (
    <div className="flex flex-col gap-4">
      {/* Wide screens: a table. */}
      <div className="hidden overflow-hidden rounded-xl ring-1 ring-border lg:block">
        <Table
          className="table-fixed"
          containerRef={scrollMore}
          containerClassName={cn(TRADES_CAP, SCROLL_FADE)}
        >
          <TableHeader className={STICKY_HEAD}>
            <TableRow>
              <TableHead className="w-[9%] pl-4">Time</TableHead>
              <TableHead className="w-[31%]">World</TableHead>
              <TableHead className="w-[11%]">Bet</TableHead>
              <TableHead className="w-[9%] text-right">Paid</TableHead>
              <TableHead className="w-[13%] text-right">Pays if right</TableHead>
              <TableHead className="w-[10%] pl-5">Taker</TableHead>
              <TableHead className="w-[10%]">Maker</TableHead>
              <TableHead className="w-[7%] pr-4 text-right">Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={keyOf(r.trade)}>
                <TableCell className="h-auto pl-4 text-xs text-muted-foreground">
                  <When row={r} now={now} href={tx(r.trade)} />
                </TableCell>
                <TableCell className="h-auto py-3 whitespace-normal">
                  <Link
                    href={`/worlds/${r.trade.book}`}
                    className="block rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <WorldCell world={r.world} />
                  </Link>
                </TableCell>
                <TableCell className="h-auto">
                  <Kind kind={r.kind} />
                </TableCell>
                <TableCell className="h-auto text-right text-sm tabular-nums">
                  {money(r.paid, { cents: true })}
                </TableCell>
                <TableCell className="h-auto text-right">
                  <Pays row={r} />
                </TableCell>
                <TableCell className="h-auto pl-5">
                  <Who name={r.taker} address={r.trade.taker} />
                </TableCell>
                <TableCell className="h-auto">
                  <Who name={r.maker} address={r.trade.maker} vault={r.trade.vault} />
                </TableCell>
                <TableCell className="h-auto pr-4 text-right">
                  <Result row={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Narrower screens: a trade a card, said as a sentence. */}
      <div className="overflow-hidden rounded-xl ring-1 ring-border lg:hidden">
        <div ref={scrollMore} className={cn(TRADES_CAP, SCROLL_FADE)}>
          <ul className="flex flex-col divide-y">
            {rows.map((r) => (
              <li key={keyOf(r.trade)} className="flex flex-col gap-2.5 p-4">
                <Link
                  href={`/worlds/${r.trade.book}`}
                  className="block rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <WorldCell world={r.world} />
                </Link>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
                  <Kind kind={r.kind} />
                  <span className="tabular-nums">
                    <span className="text-muted-foreground">
                      {r.kind === "Cash-out" ? "sold for " : "paid "}
                    </span>
                    {money(r.paid, { cents: true })}
                  </span>
                  {r.kind !== "Cash-out" && (
                    <span className="flex items-center gap-1.5 tabular-nums">
                      <span className="text-muted-foreground">pays</span>
                      <Pays row={r} inline />
                    </span>
                  )}
                  <span className="ml-auto">
                    <Result row={r} />
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Who name={r.taker} address={r.trade.taker} small />
                  <span>with</span>
                  <Who name={r.maker} address={r.trade.maker} vault={r.trade.vault} small />
                  <span className="ml-auto">
                    <When row={r} now={now} href={tx(r.trade)} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {loaded?.next && (
        <Button variant="secondary" className="self-center" disabled={loadingMore} onClick={more}>
          {loadingMore && <Spinner data-icon="inline-start" />}
          Show older trades
        </Button>
      )}
    </div>
  );
}

/** When a trade happened ("5m ago"; the exact time on hover), linking to its transaction. */
function When({ row, now, href }: { row: Row; now: number; href: string | null }) {
  const at = new Date(Number(row.trade.time) * 1000);
  const text = (
    <time dateTime={at.toISOString()} title={at.toLocaleString()}>
      {ago(row.trade.time, now)}
    </time>
  );
  if (!href) return text;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 hover:text-foreground"
    >
      {text}
      <ArrowUpRight className="size-3" aria-hidden />
      <span className="sr-only">Transaction</span>
    </a>
  );
}

function Kind({ kind }: { kind: Row["kind"] }) {
  return (
    <span
      className={cn(
        "w-fit rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        kind === "Money-back"
          ? "bg-info-soft text-info"
          : kind === "All-in"
            ? "bg-brand-soft text-brand-strong"
            : "bg-secondary text-muted-foreground",
      )}
    >
      {kind}
    </span>
  );
}

/** What the bet pays if right, and how many times what was paid. A cash-out pays nothing on. */
function Pays({ row, inline = false }: { row: Row; inline?: boolean }) {
  if (row.kind === "Cash-out") return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium tabular-nums",
        !inline && "justify-end",
      )}
    >
      {money(row.pays)}
      <span className="rounded-full bg-positive-soft px-1.5 py-px text-[11px] font-semibold text-positive">
        {multiple(row.pays, row.paid)}
      </span>
    </span>
  );
}

function Who({
  name,
  address,
  vault = false,
  small = false,
}: {
  name: string;
  address: string;
  vault?: boolean;
  small?: boolean;
}) {
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1.5", small ? "text-xs" : "text-sm")}
      title={address}
    >
      {vault ? (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Landmark className="size-2.5" aria-hidden />
        </span>
      ) : (
        <WalletDot address={address} className="size-4" />
      )}
      <span className={cn("truncate", name === "You" && "font-medium text-foreground")}>
        {name}
      </span>
    </span>
  );
}

function Result({ row }: { row: Row }) {
  const r = row.result;
  if (!r) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "text-xs font-medium whitespace-nowrap",
        r.tone === "positive" && "text-positive",
        r.tone === "danger" && "text-danger",
        r.tone === "info" && "text-info",
        r.tone === "muted" && "text-muted-foreground",
      )}
    >
      {r.label}
    </span>
  );
}
