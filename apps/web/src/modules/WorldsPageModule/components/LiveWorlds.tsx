"use client";
import { ArrowRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { WorldCard } from "@/components/worlds/WorldCard";
import { useStocks, useWorldsFeed } from "@/hooks/useWorlds";
import { cn } from "@/lib/utils";
import { Art } from "./WorldPayouts";

const SORTS = ["Live", "Closing soon", "Most backed", "New"] as const;
const SORT_KEYS: Record<(typeof SORTS)[number], string> = {
  Live: "live",
  "Closing soon": "soon",
  "Most backed": "backed",
  New: "new",
};
/** Worlds the full list shows at first, and adds per "Show more". */
const PAGE = 12;

/** Every world someone holds a position in, sorted and filtered by stock: on the worlds page its
 * first `limit` with a way to the full list (`/worlds/live`), there a page at a time. Only the
 * worlds shown are read: the feed is asked for exactly that many. */
export function LiveWorlds({
  limit,
  heading = "h2",
  onStart,
}: {
  /** Shown on the worlds page: this many, then "View All". Without it, the full list. */
  limit?: number;
  heading?: "h1" | "h2";
  /** With no world yet: start one (the worlds page opens its starter; elsewhere a link to it). */
  onStart?: () => void;
}) {
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Live");
  const [stock, setStock] = useState("");
  const [shown, setShown] = useState(PAGE);
  const feed = useWorldsFeed(SORT_KEYS[sort], stock, limit ?? shown);
  const listed = useStocks();
  const logos = useMemo(
    () => new Map((listed.data ?? []).map((s) => [s.underlying, s.logo] as const)),
    [listed.data],
  );
  // Every traded world's stock (the server's list, whatever is filtered or shown).
  const stocks = (feed.data?.underlyings ?? []).map((u) => [u.underlying, u.symbol] as const);
  const worlds = feed.data?.worlds ?? [];
  const total = feed.data?.total ?? 0;
  const visible = worlds.slice(0, limit ?? shown);
  const Heading = heading;
  return (
    <section className="flex flex-col gap-5">
      {/* The title, its sort and (here) the way to the full list: on a phone the title and
          "View All" share the first line and the sort takes the next. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Heading className="order-1 flex items-center gap-3 text-[28px] leading-tight font-medium tracking-[-0.02em] sm:text-4xl">
          <span className="relative flex size-2.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-positive opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-positive" />
          </span>
          Live worlds
        </Heading>
        {limit !== undefined && (
          <ViewAll
            href="/worlds/live"
            label="View all live worlds"
            className="order-2 ml-auto sm:order-3 sm:ml-0"
          />
        )}
        <div className="order-3 basis-full sm:order-2 sm:ml-auto sm:basis-auto">
          <Segmented
            label="Sort worlds"
            value={sort}
            options={SORTS}
            onChange={(s) => {
              setSort(s);
              setShown(PAGE);
            }}
            variant="compact"
          />
        </div>
      </div>
      {stocks.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Button size="xs" variant={stock ? "ghost" : "secondary"} onClick={() => setStock("")}>
            All
          </Button>
          {stocks.map(([u, symbol]) => {
            const logo = logos.get(u);
            return (
              <Button
                key={u}
                size="xs"
                variant={stock === u ? "secondary" : "ghost"}
                onClick={() => {
                  setStock(u);
                  setShown(PAGE);
                }}
              >
                {logo && (
                  // biome-ignore lint/performance/noImgElement: small static token logos.
                  <img src={logo} alt="" className="size-4 rounded-full" />
                )}
                {symbol}
              </Button>
            );
          })}
        </div>
      )}
      {worlds.length ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {visible.map((w) => (
              <WorldCard
                key={w.book}
                world={w}
                logo={w.underlying ? (logos.get(w.underlying) ?? null) : null}
              />
            ))}
          </div>
          {limit === undefined && total > shown && (
            <ShowMore loading={feed.loading} onClick={() => setShown((n) => n + PAGE)} />
          )}
        </>
      ) : feed.loading && !feed.error ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders.
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 rounded-xl bg-card px-6 py-12 text-center ring-1 ring-border">
          <Art src="/worlds/empty.webp" width={512} height={512} className="size-28" />
          {feed.error && !feed.data ? (
            <Button variant="outline" onClick={feed.refresh}>
              <RotateCcw data-icon="inline-start" />
              Try again
            </Button>
          ) : (
            <>
              <p className="text-lg font-medium">No worlds yet</p>
              <Button
                size="lg"
                {...(onStart
                  ? { onClick: onStart }
                  : { render: <Link href="/worlds" />, nativeButton: false })}
              >
                Start the first
                <ArrowRight data-icon="inline-end" />
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** The way from a section's first cards to its own page, at the end of its title's row. */
export function ViewAll({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Button
      variant="secondary"
      className={cn("shrink-0", className)}
      aria-label={label}
      render={<Link href={href} />}
      nativeButton={false}
    >
      View All
      <ArrowRight data-icon="inline-end" />
    </Button>
  );
}

/** The next page of a list (read when asked for). */
export function ShowMore({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <Button
      variant="secondary"
      size="lg"
      className="self-center"
      disabled={loading}
      onClick={onClick}
    >
      {loading && <Spinner data-icon="inline-start" />}
      Show more
    </Button>
  );
}

/** A worlds list's own page: the way back to the worlds page above its list. */
export function ListPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 pt-4 sm:pt-8">
      <Button
        variant="ghost"
        size="sm"
        className="self-start rounded-full text-muted-foreground"
        render={<Link href="/worlds" />}
        nativeButton={false}
      >
        <ArrowRight data-icon="inline-start" className="rotate-180" />
        Worlds
      </Button>
      {children}
    </div>
  );
}
