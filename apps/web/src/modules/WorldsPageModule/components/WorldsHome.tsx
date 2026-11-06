"use client";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { EXAMPLES } from "@/components/worlds/Composer";
import { ChanceBar } from "@/components/worlds/Outcomes";
import { Chip, Sentence } from "@/components/worlds/Sentence";
import { WorldCard } from "@/components/worlds/WorldCard";
import { worldsEnabled } from "@/config/protocol";
import { useStocks, useWorldsFeed } from "@/hooks/useWorlds";
import { cn } from "@/lib/utils";
import { chancePercent } from "@/lib/worlds/format";
import { WorldStarter } from "./WorldStarter";

const SORTS = ["Live", "Closing soon", "Most backed", "New"] as const;
const SORT_KEYS: Record<(typeof SORTS)[number], string> = {
  Live: "live",
  "Closing soon": "soon",
  "Most backed": "backed",
  New: "new",
};

/** The opinions of `EXAMPLES`, as a glance reads them: an event, then the stock's move. */
const STARTERS = [
  { event: "Fed cuts", symbol: "NVDA", up: true, price: "$200" },
  { event: "No shutdown", symbol: "BTC", up: true, price: "$120k" },
  { event: "Hot CPI", symbol: "SPY", up: false, price: "$650" },
].map((s, i) => ({ ...s, text: EXAMPLES.at(i) ?? "" }));

/** The worked example of docs: P(win) 25.1%, P(the world happens, NVDA below) 36.9%, P(no cut)
 * 38%; All-in $20 pays $74.71, Money-back $100 pays $235 or gives the $100 back. Chances x 1e6. */
const PRODUCTS = [
  {
    name: "All-in",
    art: "/worlds/allin.webp",
    stake: "$20",
    best: "$75",
    rows: [
      { kind: "win", label: "Fed cuts · NVDA above", pays: "$75", chance: 251_000 },
      { kind: "lose", label: "Anything else", pays: "$0", chance: 749_000 },
    ],
  },
  {
    name: "Money-back",
    art: "/worlds/moneyback.webp",
    stake: "$100",
    best: "$235",
    rows: [
      { kind: "win", label: "Fed cuts · NVDA above", pays: "$235", chance: 251_000 },
      { kind: "back", label: "Fed doesn't cut", pays: "$100", chance: 380_000 },
      { kind: "lose", label: "Fed cuts · NVDA below", pays: "$0", chance: 369_000 },
    ],
  },
] as const;

/** The worlds home: where a world starts (someone's words) and every world people trade. */
export function WorldsHome() {
  const router = useRouter();
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Live");
  const [stock, setStock] = useState("");
  const feed = useWorldsFeed(SORT_KEYS[sort], stock);
  const listed = useStocks();
  const logos = useMemo(
    () => new Map((listed.data ?? []).map((s) => [s.underlying, s.logo] as const)),
    [listed.data],
  );
  const start = (text: string) => router.push(`/worlds/new?q=${encodeURIComponent(text)}`);
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
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-7 pt-4 text-center sm:pt-12">
        <h1 className="text-[40px] leading-[1.02] font-medium tracking-[-0.035em] sm:text-[64px]">
          Bet on your <span className="text-brand-strong">what&nbsp;if.</span>
        </h1>
        {!worldsEnabled && (
          <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
            Worlds are off on this network.
          </p>
        )}
        <div id="say" className="w-full text-left">
          <WorldStarter />
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {STARTERS.map((s) => (
            <button
              key={s.text}
              type="button"
              title={s.text}
              onClick={() => start(s.text)}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-secondary px-3.5 text-sm font-medium transition-colors outline-none hover:bg-secondary/70 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span>{s.event}</span>
              <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="font-semibold">{s.symbol}</span>
              <Move up={s.up} />
              <span className="tabular-nums">{s.price}</span>
            </button>
          ))}
        </div>
      </section>

      {/* The two payouts, on one example */}
      <section className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <h2 className="text-[28px] leading-tight font-medium tracking-[-0.02em] sm:text-4xl">
            Two ways to win
          </h2>
          <Sentence size="large" className="text-muted-foreground">
            If <Chip>the Fed cuts in December</Chip>, <Chip tone="stock">NVDA</Chip> closes{" "}
            <Chip tone="value">above $215</Chip> on <Chip tone="value">Dec 3</Chip>
          </Sentence>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {PRODUCTS.map((p) => (
            <article
              key={p.name}
              className="flex flex-col gap-5 rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6"
            >
              <div className="flex items-center gap-4">
                <Art src={p.art} width={512} height={512} className="size-20 shrink-0 sm:size-24" />
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="text-lg font-medium">{p.name}</h3>
                  <p className="flex items-center gap-2 text-3xl font-medium tracking-[-0.02em] tabular-nums">
                    <span className="text-muted-foreground">{p.stake}</span>
                    <ArrowRight className="size-5 text-muted-foreground" aria-hidden />
                    <span className="text-positive">{p.best}</span>
                  </p>
                </div>
              </div>
              <ul className="flex flex-col gap-3">
                {p.rows.map((r) => (
                  <li key={r.label} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2.5 text-sm">
                      <Outcome kind={r.kind} />
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          r.kind === "win" && "text-positive",
                          r.kind === "lose" && "text-muted-foreground",
                        )}
                      >
                        {r.kind === "back" ? `${r.pays} back` : r.pays}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <ChanceBar
                        share={r.chance / 1_000_000}
                        tone={BAR[r.kind]}
                        className="ml-[34px]"
                      />
                      <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                        {chancePercent(r.chance)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
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

/** Generated art (public/worlds), drawn on black: it sits in a black tile, seamless on the dark
 * page and a framed picture on the light one. */
function Art({
  src,
  width,
  height,
  className,
}: {
  src: string;
  width: number;
  height: number;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-3xl bg-black", className)}>
      {/* biome-ignore lint/performance/noImgElement: static art served as is. */}
      <img
        src={src}
        alt=""
        width={width}
        height={height}
        decoding="async"
        loading="lazy"
        className="size-full object-cover"
      />
    </div>
  );
}

function Move({ up }: { up: boolean }) {
  return up ? (
    <ArrowUpRight className="size-4 text-positive" aria-label="above" />
  ) : (
    <ArrowDownRight className="size-4 text-danger" aria-label="below" />
  );
}

type Kind = "win" | "back" | "lose";
const OUTCOME: Record<Kind, { icon: ReactNode; className: string }> = {
  win: { icon: <Check className="size-3.5" />, className: "bg-positive-soft text-positive" },
  back: { icon: <RotateCcw className="size-3.5" />, className: "bg-info-soft text-info" },
  lose: { icon: <X className="size-3.5" />, className: "bg-secondary text-muted-foreground" },
};
function Outcome({ kind }: { kind: Kind }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full",
        OUTCOME[kind].className,
      )}
    >
      {OUTCOME[kind].icon}
    </span>
  );
}

const BAR: Record<Kind, string> = {
  win: "bg-positive",
  back: "bg-info",
  lose: "bg-muted-foreground/40",
};
