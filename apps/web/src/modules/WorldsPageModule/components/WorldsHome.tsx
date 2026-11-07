"use client";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { WorldCard } from "@/components/worlds/WorldCard";
import { worldsEnabled } from "@/config/protocol";
import { useStocks, useWorldsFeed } from "@/hooks/useWorlds";
import { Art, type ShownWorld, WorldPayouts } from "./WorldPayouts";
import { WorldStarter } from "./WorldStarter";

const SORTS = ["Live", "Closing soon", "Most backed", "New"] as const;
const SORT_KEYS: Record<(typeof SORTS)[number], string> = {
  Live: "live",
  "Closing soon": "soon",
  "Most backed": "backed",
  New: "new",
};

/** The worlds home: where a world starts (someone's words) and every world people trade. */
export function WorldsHome() {
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Live");
  const [shown, setShown] = useState<ShownWorld | null>(null);
  const [stock, setStock] = useState("");
  const feed = useWorldsFeed(SORT_KEYS[sort], stock);
  const listed = useStocks();
  const logos = useMemo(
    () => new Map((listed.data ?? []).map((s) => [s.underlying, s.logo] as const)),
    [listed.data],
  );
  const stocks = useMemo(() => {
    const seen = new Map<string, string>();
    for (const w of feed.data ?? [])
      if (w.underlying && w.opinion?.symbol) seen.set(w.underlying, w.opinion.symbol);
    return [...seen.entries()];
  }, [feed.data]);
  /** Back to the starter, with its first open event's search opened. */
  const focusStarter = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector<HTMLElement>('#say [data-slot="event"]')?.click();
  };

  return (
    <div className="flex flex-col gap-12 sm:gap-16">
      {/* Say it */}
      {/* As wide as the cards below it: the sentence gets the room to read in fewer, larger lines. */}
      <section className="mx-auto flex w-full flex-col items-center gap-5 pt-4 text-center sm:gap-7 sm:pt-12">
        <h1 className="text-[40px] leading-[1.02] font-medium tracking-[-0.035em] sm:text-[64px]">
          Bet on your <span className="text-brand-strong">what&nbsp;if.</span>
        </h1>
        {!worldsEnabled && (
          <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
            Worlds are off on this network.
          </p>
        )}
        <div id="say" className="w-full">
          <WorldStarter onShown={setShown} />
        </div>
      </section>

      {/* What the world above pays, both ways, live. */}
      <section>
        <WorldPayouts shown={shown} />
      </section>

      {/* Every world people trade */}
      <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="flex items-center gap-3 text-[28px] leading-tight font-medium tracking-[-0.02em] sm:text-4xl">
            <span className="relative flex size-2.5" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-positive opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2.5 rounded-full bg-positive" />
            </span>
            Live worlds
          </h2>
          <Segmented
            label="Sort worlds"
            value={sort}
            options={SORTS}
            onChange={setSort}
            variant="compact"
          />
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
                  onClick={() => setStock(u)}
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
        {feed.data?.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {feed.data.map((w) => (
              <WorldCard
                key={w.book}
                world={w}
                logo={w.underlying ? (logos.get(w.underlying) ?? null) : null}
              />
            ))}
          </div>
        ) : feed.loading && !feed.error ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders.
              <Skeleton key={i} className="h-72 rounded-3xl" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5 rounded-3xl bg-card px-6 py-12 text-center ring-1 ring-border">
            <Art src="/worlds/empty.webp" width={512} height={512} className="size-28" />
            {feed.error && !feed.data ? (
              <Button variant="outline" onClick={feed.refresh}>
                <RotateCcw data-icon="inline-start" />
                Try again
              </Button>
            ) : (
              <>
                <p className="text-lg font-medium">No worlds yet</p>
                <Button size="lg" onClick={focusStarter}>
                  Start the first
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
