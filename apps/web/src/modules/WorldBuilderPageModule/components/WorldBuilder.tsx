"use client";
import { ArrowLeft, ArrowRight, Pencil, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChanceChain } from "@/components/worlds/ChanceChain";
import { Composer } from "@/components/worlds/Composer";
import { EventRow, EventSearchDialog } from "@/components/worlds/EventSearch";
import { LegRow } from "@/components/worlds/LegRow";
import { DotGrid, OutcomeTable } from "@/components/worlds/Outcomes";
import { SectionTitle } from "@/components/worlds/primitives";
import { WorldTicket } from "@/components/worlds/WorldTicket";
import { cn } from "@/lib/utils";
import {
  calendarDay,
  midSentence,
  money,
  stockPrice,
  strikeText,
  whenDay,
} from "@/lib/worlds/format";
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
/** The first weekday on or after a date. */
function weekdayFrom(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
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

  const dates = useMemo(() => {
    const now = Date.now();
    const lastEnd = legs.length ? Math.max(...legs.map((l) => Date.parse(l.entry.endTime))) : now;
    return {
      earliest: weekdayFrom(nyDate(now + DAY)),
      last: nyDate(now + 34 * DAY),
      suggested: legs.length ? weekdayFrom(nyDate(Math.max(lastEnd, now + DAY))) : null,
    };
  }, [legs]);

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
      <div className="mx-auto flex max-w-3xl flex-col gap-8 pt-6 sm:pt-12">
        <BackLink />
        <Quote text={text} />
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
          <Skeleton className="h-10 w-11/12 rounded-lg" />
          <Skeleton className="h-10 w-3/4 rounded-lg" />
        </div>
      </div>
    );

  if (draft.error || !legs.length)
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 pt-6 sm:pt-12">
        <BackLink />
        <Quote text={text} onEdit={() => setEditing(true)} />
        <div className="flex flex-col gap-2 rounded-2xl bg-card p-5 ring-1 ring-border">
          <h2 className="text-lg font-medium">
            {draft.error ? "We couldn't read that just now" : "Which event is this about?"}
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            {draft.error ??
              draft.draft?.notes[0] ??
              "A world needs at least one real event from Polymarket or Kalshi. Pick one, or say it another way."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => setAdding(true)}>Find an event</Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Say it another way
            </Button>
          </div>
        </div>
        {draft.draft?.suggestions.length ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Events close to your words
            </span>
            {draft.draft.suggestions.map((s) => (
              <EventRow key={s.id} event={s} onPick={addLeg} />
            ))}
          </div>
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
    ? `${stock.symbol} closes ${stock.direction} ${strikeText(stock.strike)} on ${calendarDay(stock.date)}`
    : undefined;
  const firstEnd = legs.length
    ? legs.map((l) => l.entry.endTime).reduce((a, b) => (a < b ? a : b))
    : null;
  const notes = [...(current?.notes ?? []), ...(draft.draft?.notes ?? [])].slice(0, 3);

  return (
    <div className="flex flex-col gap-8 pt-4 sm:pt-8">
      <div className="flex flex-col gap-4">
        <BackLink />
        <Quote text={text} onEdit={() => setEditing(true)} />
      </div>

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
        <p className="text-xs text-muted-foreground">
          Tap any underlined part to change it.{" "}
          {draft.draft?.source === "assistant"
            ? "Read by our assistant from your words: check each event below."
            : "Matched to your words: check each event below."}
        </p>
        {current?.problems.length ? (
          <div className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
            {current.problems[0]}
          </div>
        ) : null}
        {preview?.error && (
          <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {preview.error}
          </div>
        )}
        {current?.existing?.book && (
          <Link
            href={`/worlds/${current.existing.book}`}
            className="flex items-center justify-between gap-3 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand-strong"
          >
            Someone already opened this exact world. Trading here joins it.
            <ArrowRight className="size-4 shrink-0" />
          </Link>
        )}
      </section>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
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
            <SectionTitle
              aside={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAdding(true)}
                  disabled={legs.length >= 4}
                >
                  Add an event
                </Button>
              }
            >
              What has to happen
            </SectionTitle>
            {legs.map((l, i) => (
              <LegRow
                key={l.entry.id}
                leg={l.entry}
                wantYes={l.wantYes}
                note={l.note}
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
            {notes.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs leading-4 text-muted-foreground">
                {notes.map((n) => (
                  <li key={n}>· {n}</li>
                ))}
              </ul>
            )}
          </section>

          {stock && (
            <section className="flex flex-col gap-3">
              <SectionTitle>And the stock</SectionTitle>
              <div className="grid grid-cols-2 gap-4 rounded-xl bg-card p-4 ring-1 ring-border sm:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{stock.symbol} now</span>
                  <span className="text-lg font-medium tabular-nums">{stockPrice(stock.spot)}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Your price</span>
                  <span className="text-lg font-medium tabular-nums">
                    {stock.direction === "above" ? "≥ " : "< "}
                    {strikeText(stock.strike)}
                  </span>
                </div>
                <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                  <span className="text-xs text-muted-foreground">
                    In worlds like this, on {calendarDay(stock.date)}
                  </span>
                  <span className="text-lg font-medium tabular-nums">
                    {analytics?.forward && current?.world.stock
                      ? stockPrice(analytics.forward / 10 ** current.world.stock.decimals)
                      : "—"}
                    {analytics?.move ? (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        ±{Math.round((analytics.move / 1e6) * 100)}% typical move
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
              <p className="text-xs leading-4 text-muted-foreground">
                “In worlds like this” is where {stock.symbol} averages when these events happen,
                from how it has moved with them. It describes, it doesn't promise: events don't
                cause the price.
              </p>
            </section>
          )}

          <section className="flex flex-col gap-4">
            <SectionTitle>How likely is this world?</SectionTitle>
            {analytics && canonical.length ? (
              <ChanceChain
                legs={canonical.map((l) => ({
                  label: l.label,
                  wantYes: l.wantYes,
                  source: l.source,
                  chance: analytics.legs.find((x) => x.eventKey === l.eventKey)?.chance ?? null,
                }))}
                chain={analytics.chain}
                naive={analytics.naive}
                stock={
                  stock && offer
                    ? { words: stockWords!, chance: offer.win, world: analytics.world }
                    : null
                }
              />
            ) : (
              <ChainSkeleton problem={current?.problems[0] ?? null} />
            )}
          </section>

          <section className="flex flex-col gap-4">
            <SectionTitle
              aside={
                offer && (
                  <span className="text-xs text-muted-foreground">
                    {offer.name} · {money(offer.stake)}
                  </span>
                )
              }
            >
              How this can end
            </SectionTitle>
            {offer ? (
              <div className="flex flex-col gap-5 rounded-xl bg-card p-4 ring-1 ring-border">
                <OutcomeTable
                  offer={offer}
                  priced={priced}
                  {...(stockWords ? { stockWords: midSentence(stockWords) } : {})}
                  when={{
                    fixing: stock
                      ? `On ${calendarDay(stock.date)}`
                      : "When the last event is decided",
                    refund:
                      offer.name === "Money-back" && firstEnd
                        ? `The day an event fails, from ${whenDay(firstEnd)}`
                        : "When an event fails",
                  }}
                />
                <div className="flex flex-col gap-2">
                  <DotGrid endings={offer.endings} />
                  <span className="text-xs text-muted-foreground">
                    1,000 ways this could go: green pays, red loses
                    {offer.name === "Money-back"
                      ? ", grey gives your stake back"
                      : ", grey loses too"}
                    .
                  </span>
                </div>
              </div>
            ) : (
              <Skeleton className="h-48 rounded-xl" />
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

function BackLink() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="self-start text-muted-foreground"
      render={<Link href="/worlds" />}
      nativeButton={false}
    >
      <ArrowLeft data-icon="inline-start" />
      Worlds
    </Button>
  );
}

function Quote({ text, onEdit }: { text: string; onEdit?: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 h-auto w-0.5 self-stretch rounded-full bg-brand" />
      <p className="flex-1 text-sm leading-5 text-muted-foreground">
        <span className="text-xs font-medium text-muted-foreground/80">You said</span>
        <br />“{text}”
      </p>
      {onEdit && (
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil data-icon="inline-start" />
          Edit words
        </Button>
      )}
    </div>
  );
}

function ChainSkeleton({ problem }: { problem: string | null }) {
  if (problem) return <p className="text-sm text-muted-foreground">{problem}</p>;
  return (
    <div className="flex flex-col gap-3">
      {[100, 70, 40].map((w) => (
        <Skeleton key={w} className="h-8 rounded-lg" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}
