"use client";
import { ArrowRight, Check, RotateCcw, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChanceBar } from "@/components/worlds/Outcomes";
import { cn } from "@/lib/utils";
import { chancePercent, money } from "@/lib/worlds/format";
import { type Offer, previewOffers } from "@/lib/worlds/offer";
import type { Preview, Spec } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";

/** The stakes the cards show: the builder's first stakes. */
const STAKES = { allIn: "20", moneyBack: "100" } as const;
/** A world's price is reused this long: the samples come round every half minute or so, and a
 * card is an illustration (the builder prices the world afresh). */
const FRESH_MS = 5 * 60_000;
/** An edit is priced once it settles. */
const SETTLE_MS = 250;

/** The world the sentence above shows now (a curated world, the person's events, or the samples
 * in view) and the one it shows next, to price ahead; a curated world comes priced. */
export interface ShownWorld {
  spec: Spec;
  next: Spec | null;
  preview?: Preview | undefined;
  nextPreview?: Preview | undefined;
}

interface Priced {
  at: number;
  value: Preview | null;
  error: string | null;
}

/** What the world above pays, both ways, live: All-in's $20 and Money-back's $100, each ending
 * with its chance, from the same preview the builder shows. */
export function WorldPayouts({ shown }: { shown: ShownWorld | null }) {
  const priced = usePriced(shown);
  const spec = shown?.spec ?? null;
  const preview = priced?.value ?? null;
  const offers =
    preview?.offer && !preview.problems.length
      ? previewOffers(preview.offer, preview.marks ?? null, preview.world.feeBps, !!spec?.stock)
      : [];
  const problem = priced?.error ?? preview?.problems[0] ?? null;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {PRODUCTS.map((p) => (
        <ProductCard
          key={p.name}
          product={p}
          spec={spec}
          offer={offers.find((o) => o.name === p.name) ?? null}
          loading={!priced}
          problem={problem}
        />
      ))}
    </div>
  );
}

const PRODUCTS = [
  { name: "All-in", art: "/worlds/allin.webp", stake: Number(STAKES.allIn) },
  { name: "Money-back", art: "/worlds/moneyback.webp", stake: Number(STAKES.moneyBack) },
] as const;

function ProductCard({
  product,
  spec,
  offer,
  loading,
  problem,
}: {
  product: (typeof PRODUCTS)[number];
  spec: Spec | null;
  offer: Offer | null;
  loading: boolean;
  problem: string | null;
}) {
  const rows = offer && spec ? rowsOf(offer, spec) : [];
  const note = offer?.decline ?? (!loading && !offer ? (problem ?? "Not priced right now") : null);
  return (
    <article className="flex flex-col gap-5 rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
      <div className="flex items-center gap-4">
        <Art src={product.art} width={512} height={512} className="size-20 shrink-0 sm:size-24" />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-lg font-medium">{product.name}</h3>
          <div className="flex items-center gap-2 text-3xl font-medium tracking-[-0.02em] tabular-nums">
            <span className="text-muted-foreground">{money(product.stake)}</span>
            <ArrowRight className="size-5 text-muted-foreground" aria-hidden />
            {loading ? (
              <Skeleton className="h-8 w-24 rounded-lg" />
            ) : (
              <span className={offer?.payout ? "text-positive" : "text-muted-foreground"}>
                {offer?.payout ? money(offer.payout) : "—"}
              </span>
            )}
          </div>
        </div>
      </div>
      {loading ? (
        <ul className="flex flex-col gap-3" aria-hidden>
          {Array.from({ length: product.name === "All-in" ? 2 : 3 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows.
            <li key={i} className="flex flex-col gap-2.5 py-0.5">
              <Skeleton className="h-4 w-2/3 rounded-md" />
              <Skeleton className="ml-[34px] h-1.5 rounded-full" />
            </li>
          ))}
        </ul>
      ) : (
        rows.length > 0 && (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-col gap-1.5">
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
                    {r.pays}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <ChanceBar
                    share={r.chance / 1_000_000}
                    tone={BAR[r.kind]}
                    className="ml-[34px]"
                  />
                  <span className="w-10 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {chancePercent(r.chance)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </article>
  );
}

type Kind = "win" | "back" | "lose";

/** A product's endings as the card says them: All-in pays or doesn't ("Anything else");
 * Money-back pays, gives the stake back when an event fails, or loses on the stock. */
function rowsOf(offer: Offer, spec: Spec) {
  const chance = (key: Offer["endings"][number]["key"]) =>
    offer.endings.find((e) => e.key === key)?.chance ?? 0;
  const n = spec.legs.length;
  const happen = n === 1 ? "It happens" : n === 2 ? "Both happen" : "All happen";
  const fails = n === 1 ? "It doesn't happen" : "One doesn't happen";
  const stock = spec.stock;
  const symbol = stock?.underlying.split(":")[1] ?? "";
  const side = (s: "above" | "below") => (stock ? `${happen} · ${symbol} ${s}` : happen);
  const other = stock?.direction === "above" ? "below" : "above";
  const win = chance("win");
  const pays = offer.payout ? money(offer.payout) : "—";
  const rows: { key: string; kind: Kind; label: string; pays: string; chance: number }[] = [
    { key: "win", kind: "win", label: side(stock?.direction ?? "above"), pays, chance: win },
  ];
  if (offer.name === "All-in")
    rows.push({
      key: "else",
      kind: "lose",
      label: "Anything else",
      pays: "$0",
      chance: 1_000_000 - win,
    });
  else {
    rows.push({
      key: "back",
      kind: "back",
      label: fails,
      pays: `${money(offer.stake)} back`,
      chance: chance("world-fails"),
    });
    if (stock)
      rows.push({
        key: "lose",
        kind: "lose",
        label: side(other),
        pays: "$0",
        chance: chance("lose-in-world"),
      });
  }
  return rows;
}

/** The shown world's price, kept while the next one loads; worlds priced in the last few minutes
 * (the samples as they come round) answer from memory, and the next one is priced ahead. */
function usePriced(shown: ShownWorld | null): Priced | null {
  const cache = useRef(new Map<string, Priced>());
  const inflight = useRef(new Map<string, AbortController>());
  const [, setVersion] = useState(0);
  const [kept, setKept] = useState<Priced | null>(null);

  const key = shown ? JSON.stringify(shown.spec) : null;
  const nextKey = shown?.next ? JSON.stringify(shown.next) : null;
  const fresh = (k: string) => {
    const hit = cache.current.get(k);
    return hit && Date.now() - hit.at < FRESH_MS ? hit : null;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys stand for the specs.
  useEffect(() => {
    if (!shown || !key) return;
    const load = (k: string, spec: Spec) => {
      if (fresh(k) || inflight.current.has(k)) return;
      const controller = new AbortController();
      inflight.current.set(k, controller);
      worldsApi
        .preview(spec, STAKES, controller.signal)
        .then((value) => cache.current.set(k, { at: Date.now(), value, error: null }))
        .catch((error: Error) => {
          if (error.name !== "AbortError")
            cache.current.set(k, { at: Date.now(), value: null, error: error.message });
        })
        .finally(() => {
          inflight.current.delete(k);
          const oldest = cache.current.keys().next().value;
          if (cache.current.size > 40 && oldest !== undefined) cache.current.delete(oldest);
          setVersion((v) => v + 1);
        });
    };
    // A world no longer shown or next is not waited for.
    for (const [k, c] of inflight.current)
      if (k !== key && k !== nextKey) {
        c.abort();
        inflight.current.delete(k);
      }
    const ahead = () => {
      if (nextKey && shown.next && !shown.nextPreview) load(nextKey, shown.next);
    };
    // A curated world comes priced: nothing to ask.
    if (shown.preview || fresh(key)) {
      ahead();
      return;
    }
    const timer = setTimeout(() => {
      load(key, shown.spec);
      ahead();
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [key, nextKey]);
  useEffect(
    () => () => {
      for (const c of inflight.current.values()) c.abort();
    },
    [],
  );

  const given = shown?.preview;
  const current =
    useMemo(() => (given ? { at: 0, value: given, error: null } : null), [given]) ??
    (key ? (cache.current.get(key) ?? null) : null);
  useEffect(() => {
    if (current) setKept(current);
  }, [current]);
  return current ?? kept;
}

/** Generated art (public/worlds), drawn on black: it sits in a black tile, seamless on the dark
 * page and a framed picture on the light one. */
export function Art({
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
