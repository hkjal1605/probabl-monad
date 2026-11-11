"use client";
import {
  ArrowLeft,
  ArrowRight,
  CalendarSearch,
  Pencil,
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
import { Composer } from "@/components/worlds/Composer";
import { defaultStrike, EditableSentence } from "@/components/worlds/EditableSentence";
import { EventRow, EventSearchDialog } from "@/components/worlds/EventSearch";
import { HERO_SENTENCE } from "@/components/worlds/Sentence";
import { StockChart } from "@/components/worlds/StockChart";
import { type BreakdownLeg, WorldBreakdown } from "@/components/worlds/WorldBreakdown";
import { WorldTicket } from "@/components/worlds/WorldTicket";
import { useMaxTenor, useStocks } from "@/hooks/useWorlds";
import { cn } from "@/lib/utils";
import { nyDate, weekdayFrom, worldDates } from "@/lib/worlds/dates";
import { addEvent, removeEvent, setEvent } from "@/lib/worlds/events";
import { calendarDay } from "@/lib/worlds/format";
import {
  atStake,
  type ProductName,
  previewOffers,
  stakeText,
  stakeWithin,
} from "@/lib/worlds/offer";
import { parseStart, specOf, startParam, takeStart } from "@/lib/worlds/start";
import type { Draft, LegEntry, LegState, Preview, Spec, StockState } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";

const DAY = 86_400_000;

const READING = [
  "Reading your words",
  "Finding the events on Polymarket and Kalshi",
  "Pricing your world",
];
/** A world chosen part by part (on the worlds page) has no words to read. */
const OPENING = ["Finding your events on Polymarket and Kalshi", "Pricing your world"];

/** From someone's words to a world they can trade: read the opinion, show it as an editable
 * sentence with the real events behind it, price it live, and offer it. A world chosen part by
 * part on the worlds page arrives as its spec (`?w=`) instead, and is priced straight away. */
export function WorldBuilder() {
  const router = useRouter();
  const params = useSearchParams();
  const text = params.get("q")?.trim() ?? "";
  const startRaw = params.get("w");
  const start = useMemo(() => (text ? null : parseStart(startRaw)), [text, startRaw]);
  const [draft, setDraft] = useState<{
    text: string;
    draft: Draft | null;
    error: string | null;
  } | null>(null);
  const [legs, setLegs] = useState<LegState[]>([]);
  /** The person took the last event out: the world stays on the page, asking for an event
   * (a reading that found no event asks which one it is about instead). */
  const [emptied, setEmptied] = useState(false);
  const [stock, setStock] = useState<StockState | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  // What the ticket's orders cost, fee included; they are priced at the stakes they buy.
  const [amounts, setAmounts] = useState({ allIn: 20, moneyBack: 100 });
  const [product, setProduct] = useState<ProductName>("All-in");
  const [preview, setPreview] = useState<{
    key: string;
    value: Preview | null;
    error: string | null;
  } | null>(null);
  const [step, setStep] = useState(0);
  /** The key of the last preview answered: one already in hand is not asked again. */
  const answered = useRef<string | null>(null);

  // 1a. A world chosen part by part: the parts the worlds page showed, else (a shared link or a
  // reload) the events and stock its first price names.
  useEffect(() => {
    if (!start) return;
    const param = startParam(start);
    const stashed = takeStart(param);
    setEmptied(false);
    if (stashed) {
      setLegs(stashed.legs);
      setStock(stashed.stock);
      setDraft({ text: "", draft: null, error: null });
      return;
    }
    const controller = new AbortController();
    setDraft(null);
    setPreview(null);
    const first = { allIn: 20, moneyBack: 100 };
    worldsApi
      .preview(
        start,
        { allIn: String(first.allIn), moneyBack: String(first.moneyBack) },
        controller.signal,
        // Every world the builder prices is one a person asked for.
        { explore: true },
      )
      .then((p) => {
        const nextLegs = p.world.legs.map((l) => ({
          entry: l,
          wantYes: l.wantYes,
          note: null,
          alternatives: [],
        }));
        const s = p.world.stock;
        const nextStock = s
          ? {
              underlying: s.underlying,
              symbol: s.symbol,
              name: s.name,
              direction: s.direction,
              strike: s.strike,
              date: s.date,
              spot: s.spot,
            }
          : null;
        const key = JSON.stringify([specOf(nextLegs, nextStock), first]);
        answered.current = key;
        setLegs(nextLegs);
        setStock(nextStock);
        setPreview({ key, value: p, error: null });
        setDraft({ text: "", draft: null, error: null });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setDraft({ text: "", draft: null, error: error.message });
      });
    return () => controller.abort();
  }, [start]);

  // 1b. Read the words.
  useEffect(() => {
    if (!text) return;
    const controller = new AbortController();
    setDraft(null);
    setPreview(null);
    setEmptied(false);
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
  const steps = text ? READING : OPENING;
  useEffect(() => {
    if (draft) return;
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 1_400);
    return () => clearInterval(timer);
  }, [draft, steps.length]);

  // 2. Price what it says, as it changes.
  const spec: Spec | null = useMemo(
    () => (legs.length ? specOf(legs, stock) : null),
    [legs, stock],
  );
  const feeBps = preview?.value?.world.feeBps ?? 100;
  const stakes = useMemo(
    () => ({
      allIn: stakeWithin(amounts.allIn, feeBps),
      moneyBack: stakeWithin(amounts.moneyBack, feeBps),
    }),
    [amounts, feeBps],
  );
  const key = spec ? JSON.stringify([spec, stakes]) : null;
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!spec || !key || answered.current === key) return;
    const controller = new AbortController();
    const seq = ++previewSeq.current;
    const timer = setTimeout(() => {
      worldsApi
        .preview(
          spec,
          { allIn: stakeText(stakes.allIn), moneyBack: stakeText(stakes.moneyBack) },
          controller.signal,
          { explore: true },
        )
        .then((value) => {
          if (seq !== previewSeq.current) return;
          answered.current = key;
          setPreview({ key, value, error: null });
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
  // Without an event there is no world to price: the last world's price is not this one's.
  const current = spec ? (preview?.value ?? null) : null;
  const pricing = key !== null && preview?.key !== key;

  // The stock is read from tomorrow to the vault's tenor less a day (to open and fill the world).
  const maxTenor = useMaxTenor();
  // The stocks list (shared, read once a minute): the chart finds its stock's token there.
  const stocks = useStocks();
  const dates = useMemo(
    () =>
      worldDates(
        legs.map((l) => l.entry.endTime),
        maxTenor,
      ),
    [legs, maxTenor],
  );

  const onAmounts = useCallback((a: { allIn: number; moneyBack: number }) => setAmounts(a), []);
  const onProduct = useCallback((p: ProductName) => setProduct(p), []);
  const addLeg = (e: LegEntry) => {
    setAdding(false);
    setLegs((ls) => addEvent(ls, e));
  };
  /** Takes an event out, with its place in the sentence; the last one leaves the selector. */
  const removeLeg = (i: number) => {
    if (legs.length === 1) setEmptied(true);
    setLegs((ls) => removeEvent(ls, i));
  };

  if ((!text && !start) || editing)
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
          {steps.map((r, i) => (
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
          <Skeleton className="mt-4 h-40 rounded-xl" />
        </div>
      </div>
    );

  if (draft.error || (!legs.length && !emptied))
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 pt-4 sm:pt-8">
        <TopBar text={text} onEdit={() => setEditing(true)} />
        <div className="flex flex-col items-start gap-4 rounded-xl bg-card p-5 ring-1 ring-border sm:p-6">
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
            <div className="flex flex-col gap-1 rounded-xl bg-card p-2 ring-1 ring-border">
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
          // The worlds page's size and line spacing.
          className={HERO_SENTENCE}
          dates={dates}
          onLeg={(i, leg) => setLegs((ls) => setEvent(ls, i, leg))}
          onRemoveLeg={removeLeg}
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

      {/* One grid: the events and the trade side by side, the stock across both under them. The
          trade comes first on a phone. */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <aside className="min-w-0 lg:col-start-2 lg:row-start-1">
          <WorldTicket
            world={{ kind: "draft", spec, preview: current, pricing }}
            sentence={sentence}
            direction={stock?.direction ?? null}
            onAmounts={onAmounts}
            onProduct={onProduct}
          />
        </aside>

        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <WorldBreakdown
            legs={legs.map(
              (l, i): BreakdownLeg => ({
                key: l.entry.id,
                question: l.entry.question,
                source: l.entry.source,
                marketId: l.entry.marketId,
                image: l.entry.image,
                url: l.entry.url,
                endTime: l.entry.endTime,
                rules: l.entry.rules,
                wantYes: l.wantYes,
                yes: l.entry.yes,
                note: l.note,
                flag: lateFlag(l.entry.endTime),
                alternatives: l.alternatives,
                onSide: (wantYes) =>
                  setLegs((ls) => ls.map((x, j) => (j === i ? { ...x, wantYes } : x))),
                onSwap: (e) =>
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
                  ),
                onRemove: () => removeLeg(i),
              }),
            )}
            notes={notes}
            onAdd={legs.length < 4 ? () => setAdding(true) : undefined}
            offer={offer}
            paid={offer?.name === "Money-back" ? amounts.moneyBack : amounts.allIn}
            outcomesLoading={spec !== null && !offer && !current?.problems[0]}
            stock={stock}
          />
        </div>

        {stock && (
          <div className="min-w-0 lg:col-span-2">
            <StockChart
              token={stocks.data?.find((x) => x.underlying === stock.underlying)?.token ?? null}
              symbol={stock.symbol}
              logo={logo}
              spot={stock.spot}
              strike={Number(stock.strike)}
              direction={stock.direction}
              date={stock.date}
              fixingTime={current?.world.fixingTime ?? null}
              events={legs.map((l) => ({
                key: l.entry.id,
                question: l.entry.question,
                endTime: l.entry.endTime,
                source: l.entry.source,
                marketId: l.entry.marketId,
                image: l.entry.image,
              }))}
              payout={offer?.payout ?? null}
              paid={
                offer ? (offer.name === "Money-back" ? amounts.moneyBack : amounts.allIn) : null
              }
            />
          </div>
        )}
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

/** Back to the worlds, and the words this world was read from (tap to change them); a world
 * chosen part by part has no words, only the way back. */
function TopBar({ text, onEdit }: { text: string; onEdit?: () => void }) {
  if (!text) return <BackLink />;
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
