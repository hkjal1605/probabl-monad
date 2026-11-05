"use client";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CalendarSearch,
  Info,
  Pencil,
  Plus,
  Quote,
  Search,
  Sparkles,
  TriangleAlert,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChanceChain } from "@/components/worlds/ChanceChain";
import { Composer } from "@/components/worlds/Composer";
import { EventRow, EventSearchDialog } from "@/components/worlds/EventSearch";
import { LegRow } from "@/components/worlds/LegRow";
import { DotGrid, OutcomeTable } from "@/components/worlds/Outcomes";
import { WorldTicket } from "@/components/worlds/WorldTicket";
import { useMaxTenor } from "@/hooks/useWorlds";
import { cn } from "@/lib/utils";
import { calendarDay, money, stockPrice, strikeText, whenDay } from "@/lib/worlds/format";
import { atStake, type ProductName, previewOffers } from "@/lib/worlds/offer";
import type { Draft, LegEntry, Preview, Spec } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";
import {
  defaultStrike,
  EditableSentence,
  type LegState,
  type StockState,
} from "./EditableSentence";

const DAY = 86_400_000;
const nyDate = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
/** The first weekday on or after a date (or, back, the last on or before it). */
function weekdayFrom(date: string, back = false) {
  const d = new Date(`${date}T12:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + (back ? -1 : 1));
  return d.toISOString().slice(0, 10);
}

const READING = [
  "Reading your words",
  "Finding the events on Polymarket and Kalshi",
  "Pricing your world",
];

/** From someone's words to a world they can trade: read the opinion, show it as an editable
 * sentence with the real events behind it, price it live, and offer it. */
export function WorldBuilder() {
  const router = useRouter();
  const params = useSearchParams();
  const text = params.get("q")?.trim() ?? "";
  const [draft, setDraft] = useState<{
    text: string;
    draft: Draft | null;
    error: string | null;
  } | null>(null);
  const [legs, setLegs] = useState<LegState[]>([]);
  const [stock, setStock] = useState<StockState | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stakes, setStakes] = useState({ allIn: 20, moneyBack: 100 });
  const [product, setProduct] = useState<ProductName>("All-in");
  const [preview, setPreview] = useState<{
    key: string;
    value: Preview | null;
    error: string | null;
  } | null>(null);
  const [step, setStep] = useState(0);

  // 1. Read the words.
  useEffect(() => {
    if (!text) return;
    const controller = new AbortController();
    setDraft(null);
    setPreview(null);
    worldsApi
      .parse(text, controller.signal)
      .then((d) => {
        setDraft({ text, draft: d, error: null });
        setLegs(
          d.legs.map((l) => ({
            entry: l,
            wantYes: l.wantYes,
            note: l.note,
            alternatives: l.alternatives,
          })),
        );
        setStock(
          d.stock
            ? {
                underlying: d.stock.underlying,
                symbol: d.stock.symbol,
                name: d.stock.name,
                direction: d.stock.direction,
                strike:
                  d.stock.strike ??
                  (d.stock.spot ? defaultStrike(d.stock.spot, d.stock.direction) : "100"),
                date: d.stock.date ?? weekdayFrom(nyDate(Date.now() + 7 * DAY)),
                spot: d.stock.spot,
              }
            : null,
        );
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setDraft({ text, draft: null, error: error.message });
      });
    return () => controller.abort();
  }, [text]);
  useEffect(() => {
    if (draft) return;
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, READING.length - 1)), 1_400);
    return () => clearInterval(timer);
  }, [draft]);

  // 2. Price what it says, as it changes.
  const spec: Spec | null = useMemo(
    () =>
      legs.length
        ? {
            legs: legs.map((l) => ({ id: l.entry.id, wantYes: l.wantYes })),
            stock: stock
              ? {
                  underlying: stock.underlying,
                  direction: stock.direction,
                  strike: stock.strike,
                  date: stock.date,
                }
              : null,
          }
        : null,
    [legs, stock],
  );
  const key = spec ? JSON.stringify([spec, stakes]) : null;
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!spec || !key) return;
    const controller = new AbortController();
    const seq = ++previewSeq.current;
    const timer = setTimeout(() => {
      worldsApi
        .preview(
          spec,
          { allIn: String(stakes.allIn), moneyBack: String(stakes.moneyBack) },
          controller.signal,
        )
        .then((value) => {
          if (seq === previewSeq.current) setPreview({ key, value, error: null });
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError" && seq === previewSeq.current)
            setPreview({ key, value: null, error: error.message });
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, spec, stakes]);
  const current = preview?.value ?? null;
  const pricing = key !== null && preview?.key !== key;

  // The stock is read from tomorrow to the vault's tenor less a day (to open and fill the world).
  const maxTenor = useMaxTenor();
  const dates = useMemo(() => {
    const now = Date.now();
    const lastEnd = legs.length ? Math.max(...legs.map((l) => Date.parse(l.entry.endTime))) : now;
    const last = weekdayFrom(nyDate(now + ((maxTenor ?? 35 * 86_400) * 1000 - DAY)), true);
    const after = legs.length ? weekdayFrom(nyDate(Math.max(lastEnd, now + DAY))) : null;
    return {
      earliest: weekdayFrom(nyDate(now + DAY)),
      last,
      suggested: after && after > last ? last : after,
    };
  }, [legs, maxTenor]);

  const onStakes = useCallback((s: { allIn: number; moneyBack: number }) => setStakes(s), []);
  const onProduct = useCallback((p: ProductName) => setProduct(p), []);
  const addLeg = (e: LegEntry) => {
    setAdding(false);
    if (legs.some((l) => l.entry.id === e.id)) return;
    setLegs((ls) => [...ls, { entry: e, wantYes: true, note: null, alternatives: [] }]);
  };

  if (!text || editing)
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 pt-6 sm:pt-12">
        <BackLink />
        <h1 className="text-3xl leading-tight font-medium tracking-[-0.02em] sm:text-4xl">
          What do you think will happen?
        </h1>
        <Composer
          initial={draft?.text ?? text}
          autoFocus
          onSubmit={(t) => {
            setEditing(false);
            router.push(`/worlds/new?q=${encodeURIComponent(t)}`);
          }}
        />
      </div>
    );

  if (!draft)
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-8 pt-4 sm:pt-8">
        <TopBar text={text} />
        <div className="flex flex-col gap-3" aria-live="polite">
          {READING.map((r, i) => (
            <span
              key={r}
              className={cn(
                "flex items-center gap-2.5 text-sm transition-opacity duration-500",
                i <= step ? "opacity-100" : "opacity-30",
              )}
            >
              <Sparkles
                className={cn(
                  "size-4",
                  i === step ? "animate-pulse text-brand-strong" : "text-muted-foreground",
                )}
              />
              {r}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-11/12 rounded-xl" />
          <Skeleton className="h-12 w-3/4 rounded-xl" />
          <Skeleton className="mt-4 h-40 rounded-3xl" />
        </div>
      </div>
    );

  if (draft.error || !legs.length)
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 pt-4 sm:pt-8">
        <TopBar text={text} onEdit={() => setEditing(true)} />
        <div className="flex flex-col items-start gap-4 rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6">
          <span className="flex size-10 items-center justify-center rounded-full bg-secondary">
            <CalendarSearch className="size-5 text-muted-foreground" />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-medium">
              {draft.error ? "We couldn't read that" : "Which event is this about?"}
            </h2>
            {draft.error && <p className="text-sm text-muted-foreground">{draft.error}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-full" onClick={() => setAdding(true)}>
              <Search data-icon="inline-start" />
              Find an event
            </Button>
            <Button variant="secondary" className="rounded-full" onClick={() => setEditing(true)}>
              <Pencil data-icon="inline-start" />
              Say it another way
            </Button>
          </div>
        </div>
        {draft.draft?.suggestions.length ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Close to your words</h2>
            <div className="flex flex-col gap-1 rounded-3xl bg-card p-2 ring-1 ring-border">
              {draft.draft.suggestions.map((s) => (
                <EventRow key={s.id} event={s} onPick={addLeg} />
              ))}
            </div>
          </section>
        ) : null}
        <EventSearchDialog open={adding} onOpenChange={setAdding} onPick={addLeg} />
      </div>
    );

  const priced = stock !== null;
  const offers =
    current?.offer && !current.problems.length
      ? previewOffers(current.offer, current.marks ?? null, current.world.feeBps, priced).map((o) =>
          atStake(o, o.name === "Money-back" ? stakes.moneyBack : stakes.allIn),
        )
      : [];
  const offer = offers.find((o) => o.name === product) ?? offers[0] ?? null;
  const sentence = {
    legs: legs.map((l) => ({ label: l.entry.label, wantYes: l.wantYes })),
    stock: stock
      ? { symbol: stock.symbol, direction: stock.direction, strike: stock.strike, date: stock.date }
      : null,
  };
  const canonical = current?.world.legs ?? [];
  const analytics = current?.chance ?? null;
  const stockWords = stock
    ? `${stock.symbol} ${stock.direction} ${strikeText(stock.strike)}`
    : undefined;
  const firstEnd = legs.length
    ? legs.map((l) => l.entry.endTime).reduce((a, b) => (a < b ? a : b))
    : null;
  // The assistant's notes; the preview's (an event decided after the stock's date) show on the
  // event itself.
  const notes = (draft.draft?.notes ?? []).slice(0, 2);
  const lateFlag = (endTime: string) =>
    stock && nyDate(Date.parse(endTime)) > stock.date
      ? `Decided after ${calendarDay(stock.date)}`
      : null;
  const logo = current?.world.stock?.logo ?? null;

  return (
    <div className="flex flex-col gap-8 pt-4 sm:pt-8">
      <TopBar text={text} onEdit={() => setEditing(true)} />

      <section className="flex flex-col gap-4">
        <EditableSentence
          legs={legs}
          stock={stock}
          dates={dates}
          onLeg={(i, leg) => setLegs((ls) => ls.map((l, j) => (j === i ? leg : l)))}
          onRemoveLeg={(i) => setLegs((ls) => ls.filter((_, j) => j !== i))}
          onAddEvent={() => setAdding(true)}
          onStock={setStock}
        />
        {current?.problems.length ? (
          <Banner tone="warning" icon={<TriangleAlert />}>
            {current.problems[0]}
          </Banner>
        ) : null}
        {preview?.error && (
          <Banner tone="danger" icon={<TriangleAlert />}>
            {preview.error}
          </Banner>
        )}
        {current?.existing?.book && (
          <Link href={`/worlds/${current.existing.book}`} className="self-start">
            <Banner tone="brand" icon={<Users />}>
              Already open · join it
              <ArrowRight className="size-4" />
            </Banner>
          </Link>
        )}
      </section>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10">
        <aside className="lg:sticky lg:top-20 lg:order-last">
          <WorldTicket
            world={{ kind: "draft", spec: spec!, preview: current, pricing }}
            sentence={sentence}
            direction={stock?.direction ?? null}
            onStakes={onStakes}
            onProduct={onProduct}
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-10">
          <section className="flex flex-col gap-3">
            <Heading
              count={legs.length}
              aside={
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setAdding(true)}
                  disabled={legs.length >= 4}
                >
                  <Plus data-icon="inline-start" />
                  Add
                </Button>
              }
            >
              Events
            </Heading>
            {legs.map((l, i) => (
              <LegRow
                key={l.entry.id}
                leg={l.entry}
                wantYes={l.wantYes}
                note={l.note}
                flag={lateFlag(l.entry.endTime)}
                alternatives={l.alternatives}
                onSide={(wantYes) =>
                  setLegs((ls) => ls.map((x, j) => (j === i ? { ...x, wantYes } : x)))
                }
                onSwap={(e) =>
                  setLegs((ls) =>
                    ls.map((x, j) =>
                      j === i
                        ? {
                            entry: e,
                            wantYes: x.wantYes,
                            note: null,
                            alternatives: [x.entry, ...x.alternatives.filter((a) => a.id !== e.id)],
                          }
                        : x,
                    ),
                  )
                }
                onRemove={
                  legs.length > 1 ? () => setLegs((ls) => ls.filter((_, j) => j !== i)) : undefined
                }
              />
            ))}
            {notes.map((n) => (
              <p
                key={n}
                className="flex items-start gap-2 px-1 text-xs leading-4 text-muted-foreground"
              >
                <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                {n}
              </p>
            ))}
          </section>

          {stock && (
            <section className="flex flex-col gap-3">
              <Heading>Stock</Heading>
              <StockCard
                symbol={stock.symbol}
                name={stock.name}
                logo={logo}
                spot={stock.spot}
                strike={Number(stock.strike)}
                direction={stock.direction}
                date={stock.date}
                move={analytics?.move ? analytics.move / 1e6 : null}
              />
            </section>
          )}

          <section className="flex flex-col gap-3">
            <Heading>Chance</Heading>
            {analytics && canonical.length ? (
              <ChanceChain
                legs={canonical.map((l) => ({
                  label: l.label,
                  wantYes: l.wantYes,
                  source: l.source,
                  marketId: l.marketId,
                  image: l.image,
                  chance: analytics.legs.find((x) => x.eventKey === l.eventKey)?.chance ?? null,
                }))}
                chain={analytics.chain}
                naive={analytics.naive}
                stock={
                  stock && offer
                    ? {
                        words: `${stockWords} on ${calendarDay(stock.date)}`,
                        chance: offer.win,
                        world: analytics.world,
                        symbol: stock.symbol,
                        logo,
                      }
                    : null
                }
              />
            ) : current?.problems[0] ? null : (
              <Skeleton className="h-52 rounded-3xl" />
            )}
          </section>

          <section className="flex flex-col gap-3">
            <Heading
              aside={
                offer && (
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground tabular-nums">
                    {offer.name} · {money(offer.stake)}
                  </span>
                )
              }
            >
              Outcomes
            </Heading>
            {offer ? (
              <div className="flex flex-col gap-5 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5">
                <DotGrid endings={offer.endings} />
                <OutcomeTable
                  offer={offer}
                  priced={priced}
                  {...(stockWords ? { stockWords } : {})}
                  when={{
                    fixing: stock ? calendarDay(stock.date) : "When the last event is decided",
                    refund:
                      offer.name === "Money-back" && firstEnd
                        ? `From ${whenDay(firstEnd)}`
                        : "When an event fails",
                  }}
                />
              </div>
            ) : current?.problems[0] ? null : (
              <Skeleton className="h-64 rounded-3xl" />
            )}
          </section>
        </div>
      </div>
      <EventSearchDialog
        open={adding}
        onOpenChange={setAdding}
        onPick={addLeg}
        exclude={legs.map((l) => l.entry.id)}
      />
    </div>
  );
}

/** Back to the worlds, and the words this world was read from (tap to change them). */
function TopBar({ text, onEdit }: { text: string; onEdit?: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 rounded-full"
        aria-label="Back to worlds"
        render={<Link href="/worlds" />}
        nativeButton={false}
      >
        <ArrowLeft />
      </Button>
      <button
        type="button"
        disabled={!onEdit}
        onClick={onEdit}
        title={text}
        className="group flex h-9 min-w-0 items-center gap-2 rounded-full bg-secondary px-3.5 text-sm text-muted-foreground transition-colors outline-none enabled:hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Quote className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{text}</span>
        {onEdit && <Pencil className="size-3.5 shrink-0 opacity-70 group-hover:opacity-100" />}
      </button>
    </div>
  );
}

function BackLink() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="self-start rounded-full text-muted-foreground"
      render={<Link href="/worlds" />}
      nativeButton={false}
    >
      <ArrowLeft data-icon="inline-start" />
      Worlds
    </Button>
  );
}

function Heading({
  children,
  count,
  aside,
}: {
  children: ReactNode;
  count?: number;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-medium">
        {children}
        {count !== undefined && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </h2>
      {aside}
    </div>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "warning" | "danger" | "brand";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "brand" && "bg-brand-soft text-brand-strong",
      )}
    >
      {icon}
      {children}
    </div>
  );
}

/** Where the stock is against the price the world needs, on a scale of its typical move: the
 * shaded band is where it usually ends up by the date. */
function StockCard({
  symbol,
  name,
  logo,
  spot,
  strike,
  direction,
  date,
  move,
}: {
  symbol: string;
  name: string;
  logo: string | null;
  spot: number | null;
  strike: number;
  direction: "above" | "below";
  date: string;
  /** The typical move by the date, as a fraction (0.13 is ±13%). */
  move: number | null;
}) {
  const away = spot ? strike / spot - 1 : null;
  const span = Math.max(move ?? 0.1, Math.abs(away ?? 0) * 1.15, 0.02) * 1.6;
  const at = (x: number) => `${Math.min(97, Math.max(3, 50 + (x / span) * 50))}%`;
  const needs = away === null ? null : direction === "above" ? away : -away;
  // Marks closer than a label's width put their labels on their outer sides.
  const close = away !== null && Math.abs(away) / span < 0.42;
  return (
    <div className="flex flex-col gap-5 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-5">
      <div className="flex items-center gap-3">
        {logo ? (
          // biome-ignore lint/performance/noImgElement: small static token logos.
          <img src={logo} alt="" className="size-10 rounded-full" />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-strong">
            {symbol.slice(0, 2)}
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="font-medium">{symbol}</span>
          <span className="truncate text-xs text-muted-foreground">{name}</span>
        </div>
        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
          <CalendarDays className="size-3.5" aria-hidden />
          {calendarDay(date)}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <div className="relative h-10">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-secondary" />
          {move !== null && (
            <div
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/15"
              style={{ left: at(-move), right: `calc(100% - ${at(move)})` }}
              title={`Typical move ±${Math.round(move * 100)}%`}
            />
          )}
          {away !== null && (
            <div
              className={cn(
                "absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full",
                direction === "above" ? "bg-positive/50" : "bg-danger/50",
              )}
              style={
                direction === "above"
                  ? { left: at(away), right: 0 }
                  : { left: 0, right: `calc(100% - ${at(away)})` }
              }
            />
          )}
          <span
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-4 ring-card"
            style={{ left: at(0) }}
            aria-hidden
          />
          {away !== null && (
            <span
              className={cn(
                "absolute top-1/2 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
                direction === "above" ? "bg-positive" : "bg-danger",
              )}
              style={{ left: at(away) }}
              aria-hidden
            />
          )}
        </div>
        <div className="relative h-11 text-sm">
          <Mark
            at={at(0)}
            label="Now"
            value={stockPrice(spot)}
            side={close ? ((away ?? 0) > 0 ? "end" : "start") : "center"}
          />
          {away !== null && (
            <Mark
              at={at(away)}
              label={direction === "above" ? "Above" : "Below"}
              value={strikeText(String(strike))}
              tone={direction === "above" ? "text-positive" : "text-danger"}
              side={close ? (away > 0 ? "start" : "end") : "center"}
            />
          )}
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full bg-foreground/15" aria-hidden />
            Typical move {move === null ? "—" : `±${Math.round(move * 100)}%`}
          </span>
          {needs !== null && (
            <span className={cn("tabular-nums", needs <= 0 && "text-positive")}>
              {needs > 0
                ? `Needs ${direction === "above" ? "+" : "−"}${Math.abs((away ?? 0) * 100).toFixed(1)}%`
                : "Already there"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** A value under its mark on the stock's scale: centred on it, or to one side of it when another
 * mark is close, and kept inside the card at the edges. */
function Mark({
  at,
  label,
  value,
  tone,
  side,
}: {
  at: string;
  label: string;
  value: string;
  tone?: string;
  side: "center" | "start" | "end";
}) {
  const edge = Number.parseFloat(at);
  const align = edge < 15 ? "start" : edge > 85 ? "end" : side;
  return (
    <span
      className={cn(
        "absolute top-0 flex flex-col whitespace-nowrap",
        align === "start" && "items-start",
        align === "end" && "-translate-x-full items-end",
        align === "center" && "-translate-x-1/2 items-center",
      )}
      style={{
        left: edge < 15 && side !== "end" ? 0 : edge > 85 && side !== "start" ? "100%" : at,
      }}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", tone)}>{value}</span>
    </span>
  );
}
