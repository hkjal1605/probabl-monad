"use client";
import { MessageSquareQuote, Scale, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DataError } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Composer, EXAMPLES } from "@/components/worlds/Composer";
import { WorldCard } from "@/components/worlds/WorldCard";
import { worldsEnabled } from "@/config/protocol";
import { useWorldsFeed } from "@/hooks/useWorlds";

const SORTS = ["Live", "Closing soon", "Most backed", "New"] as const;
const SORT_KEYS: Record<(typeof SORTS)[number], string> = {
  Live: "live",
  "Closing soon": "soon",
  "Most backed": "backed",
  New: "new",
};

const STEPS = [
  {
    icon: MessageSquareQuote,
    title: "Say it",
    body: "“If the Fed cuts, NVDA closes above $200.” We find the real Polymarket and Kalshi events behind your words.",
  },
  {
    icon: Scale,
    title: "See the offer",
    body: "Bet it all happens, or get your money back if it doesn't. Every number on one screen: what you pay, what you get, how likely, when.",
  },
  {
    icon: Users,
    title: "Trade it in public",
    body: "Your world opens as its own market. Others see it and your position, and can back your view or say their own.",
  },
];

/** The worlds home: where a world starts (someone's words) and every world people trade. */
export function WorldsHome() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Live");
  const [stock, setStock] = useState("");
  const feed = useWorldsFeed(SORT_KEYS[sort], stock);
  const start = (text: string) => {
    setBusy(true);
    router.push(`/worlds/new?q=${encodeURIComponent(text)}`);
  };
  const stocks = useMemo(() => {
    const seen = new Map<string, string>();
    for (const w of feed.data ?? [])
      if (w.underlying && w.opinion?.symbol) seen.set(w.underlying, w.opinion.symbol);
    return [...seen.entries()];
  }, [feed.data]);

  return (
    <div className="flex flex-col gap-16 sm:gap-20">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-7 pt-6 sm:pt-14">
        <div className="flex flex-col gap-4">
          <span className="text-sm font-medium text-brand-strong">Worlds</span>
          <h1 className="text-[36px] leading-[1.08] font-medium tracking-[-0.025em] sm:text-[56px]">
            Say what you think
            <br className="hidden sm:block" /> will happen.
          </h1>
          <p className="max-w-xl text-base leading-6 text-muted-foreground">
            Name the events you believe in, and what a stock does if they happen. We turn your view
            into its own market, priced from Polymarket and Kalshi, and show you exactly what you'd
            win, what you'd get back, and how likely it is.
          </p>
        </div>
        {!worldsEnabled && (
          <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
            Worlds are not switched on for this network yet.
          </p>
        )}
        <Composer busy={busy} onSubmit={start} autoFocus />
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Or start from one of these
          </span>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.slice(0, 3).map((e) => (
              <Button
                key={e}
                variant="outline"
                size="sm"
                className="h-auto max-w-full py-1.5 text-left whitespace-normal"
                onClick={() => start(e)}
              >
                {e}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="flex flex-col gap-3 rounded-2xl p-1">
            <span className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-foreground">
                <s.icon className="size-4" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">Step {i + 1}</span>
            </span>
            <h2 className="text-lg font-medium">{s.title}</h2>
            <p className="text-sm leading-5 text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-2xl font-medium tracking-[-0.01em]">Worlds people are trading</h2>
            <p className="max-w-xl text-sm leading-5 text-muted-foreground">
              Every world here was opened by someone who put money on it. Back a view you share, or
              say your own.
            </p>
          </div>
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
              All stocks
            </Button>
            {stocks.map(([u, symbol]) => (
              <Button
                key={u}
                size="xs"
                variant={stock === u ? "secondary" : "ghost"}
                onClick={() => setStock(u)}
              >
                {symbol}
              </Button>
            ))}
          </div>
        )}
        {feed.error && !feed.data ? (
          <DataError message="The worlds feed is unavailable right now." retry={feed.refresh} />
        ) : feed.loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders.
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        ) : feed.data?.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {feed.data.map((w) => (
              <WorldCard key={w.book} world={w} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
            <p className="text-base font-medium">No one has opened a world yet.</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Be the first: say what you think will happen above, and your world becomes the first
              market here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
