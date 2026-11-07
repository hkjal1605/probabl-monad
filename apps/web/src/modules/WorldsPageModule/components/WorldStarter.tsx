"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { defaultStrike, EditableSentence } from "@/components/worlds/EditableSentence";
import { useSampleCycle } from "@/hooks/useSampleCycle";
import { useMaxTenor, useRead, useStocks } from "@/hooks/useWorlds";
import { clampDate, monthAhead, nyDate, weekdayFrom, worldDates } from "@/lib/worlds/dates";
import { specOf, stashStart } from "@/lib/worlds/start";
import type { LegEntry, LegState, Preview, Stock, StockState } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";
import type { ShownWorld } from "./WorldPayouts";

/** The stock a world starts on when there are no curated worlds to show. */
const START_SYMBOL = "NVDA";

/** A curated world as the sentence holds it, with what it pays. */
interface Curated {
  legs: LegState[];
  stock: StockState;
  preview: Preview;
}
const curatedOf = (p: Preview): Curated | null => {
  const s = p.world.stock;
  if (!s) return null;
  return {
    legs: p.world.legs.map((l) => ({ entry: l, wantYes: l.wantYes, note: null, alternatives: [] })),
    stock: {
      underlying: s.underlying,
      symbol: s.symbol,
      name: s.name,
      direction: s.direction,
      strike: s.strike,
      date: s.date,
      spot: s.spot,
    },
    preview: p,
  };
};

/** Where a world starts on the worlds page: the builder's sentence with its parts laid out, so
 * every part a world is made of is in view and changes in place.
 *
 * It opens on the curated worlds (two events, a stock, a target and a date each, priced), shown
 * one after another; the first change a person makes (an event, the stock, its side, price or
 * date) makes the world on screen theirs, and "Place bet" bets on it as shown. Without curated
 * worlds it starts from two open events (cycling through live Polymarket events) and NVDA
 * closing 5% over its price a month out. */
export function WorldStarter({
  onShown,
}: {
  /** The world the sentence shows now and the one it shows next; null until it shows one. */
  onShown?: (shown: ShownWorld | null) => void;
}) {
  const router = useRouter();
  const [legs, setLegs] = useState<(LegState | null)[]>([null, null]);
  const [stock, setStock] = useState<StockState | null>(null);
  /** Once the person has changed the stock (or removed it), it is theirs: no default replaces it. */
  const [ownStock, setOwnStock] = useState(false);
  /** Once the person changes anything, the curated world on screen is theirs: the tour ends. */
  const [adopted, setAdopted] = useState(false);
  const [busy, setBusy] = useState(false);

  const stocks = useStocks();
  const maxTenor = useMaxTenor();
  const samples = useRead("event-samples", (signal) => worldsApi.samples(signal));
  const loaded = samples.data !== undefined || samples.error !== null;

  // The curated worlds with as many events as the first (their slots step through them together).
  const tour = useMemo(() => {
    const all = (samples.data?.worlds ?? []).flatMap((p) => curatedOf(p) ?? []);
    const count = all[0]?.legs.length ?? 0;
    const same = all.filter((c) => c.legs.length === count);
    return same.length >= 2 ? same : [];
  }, [samples.data]);
  const touring = !adopted && tour.length > 0;
  const at = (step: number) => tour[step % tour.length] as Curated;

  const chosen = legs.filter((l): l is LegState => l !== null);

  // The starting stock, once the list (with spot) is in: NVDA, else the first one priced; null
  // when none is (the sentence then starts without one), undefined while the list loads.
  const first: Stock | null | undefined = stocks.data
    ? (stocks.data.find((x) => x.symbol === START_SYMBOL && x.spot !== null) ??
      stocks.data.find((x) => x.spot !== null) ??
      null)
    : undefined;
  useEffect(() => {
    if (ownStock || stock || !first || first.spot === null) return;
    const s = first;
    const spot = first.spot;
    const range = worldDates([], maxTenor);
    setStock({
      underlying: s.underlying,
      symbol: s.symbol,
      name: s.name,
      direction: "above",
      strike: defaultStrike(spot, "above"),
      date: clampDate(weekdayFrom(monthAhead(nyDate(Date.now()))), range),
      spot,
    });
  }, [ownStock, stock, first, maxTenor]);
  const settled = stock !== null || ownStock || Boolean(stocks.error) || first === null;
  const showing = loaded && (touring || settled);

  // Touring, each slot shows its event of each curated world in turn. Otherwise each open slot
  // has its own share of the sample events, alternating as the server listed them (a third or
  // fourth slot starts later in the same share), so two slots never show the same event; an
  // event already chosen leaves its share without moving the others. The open slots step
  // through their shares together, so every share is cut to the shortest one's length. The
  // first share runs shortest first and the second longest first, so each pair shown is about
  // as long as the others: the sentence's height, kept at the tallest pair's, leaves little room
  // unused.
  const events = samples.data?.events;
  const placeholders = useMemo(() => {
    if (touring)
      return (tour[0]?.legs ?? []).map((_, i) => tour.flatMap((c) => c.legs[i]?.entry ?? []));
    const taken = new Set(legs.flatMap((l) => (l ? [l.entry.id] : [])));
    const list = events ?? [];
    const length = (e: LegEntry) => e.label.length;
    const shares = legs.map((_, i) => {
      const own = list
        .filter((e, j) => j % 2 === i % 2 && !taken.has(e.id))
        .sort((a, b) => (i % 2 === 0 ? length(a) - length(b) : length(b) - length(a)));
      const turn = Math.floor(i / 2) % Math.max(own.length, 1);
      return [...own.slice(turn), ...own.slice(0, turn)];
    });
    const sets = Math.min(
      ...shares.flatMap((own, i) => (legs[i] === null && own.length ? [own.length] : [])),
    );
    return Number.isFinite(sets) ? shares.map((own) => own.slice(0, sets)) : shares;
  }, [touring, tour, events, legs]);
  const shownLegs: (LegState | null)[] = touring ? placeholders.map(() => null) : legs;
  const sets = touring
    ? tour.length
    : Math.max(0, ...placeholders.map((own, i) => (legs[i] === null ? own.length : 0)));

  const live = useRef<HTMLDivElement>(null);
  const ghosts = useRef<(HTMLDivElement | null)[]>([]);
  const epoch = useMemo(
    () => JSON.stringify([touring, legs.map((l) => (l ? [l.entry.id, l.wantYes] : null)), stock]),
    [touring, legs, stock],
  );
  const cycle = useSampleCycle({ count: sets, live, ghosts, epoch, ready: showing });

  /** The curated world shown at `step` becomes the person's: its events chosen, its stock set. */
  const adopt = (step: number) => {
    const c = at(step);
    setAdopted(true);
    setOwnStock(true);
    setStock(c.stock);
    return c.legs as (LegState | null)[];
  };

  const sentence = (step: number) => {
    const shownStock = touring ? at(step).stock : stock;
    const ends = touring
      ? at(step).legs.map((l) => l.entry.endTime)
      : legs.flatMap((l) => (l ? [l.entry.endTime] : []));
    return (
      <EditableSentence
        legs={shownLegs}
        stock={shownStock}
        dates={worldDates(ends, maxTenor)}
        placeholders={placeholders}
        step={step}
        onLeg={(i, leg) =>
          touring
            ? setLegs(adopt(step).map((l, j) => (j === i ? leg : l)))
            : setLegs((ls) => ls.map((l, j) => (j === i ? leg : l)))
        }
        // A chosen event goes back to its placeholder; an empty one goes away.
        onRemoveLeg={(i) =>
          touring
            ? setLegs(adopt(step).map((l, j) => (j === i ? null : l)))
            : setLegs((ls) =>
                ls[i] ? ls.map((l, j) => (j === i ? null : l)) : ls.filter((_, j) => j !== i),
              )
        }
        onAddEvent={() =>
          touring
            ? setLegs([...adopt(step), null])
            : setLegs((ls) => (ls.length < 4 ? [...ls, null] : ls))
        }
        onStock={(s) => {
          if (touring) setLegs(adopt(step));
          setOwnStock(true);
          setStock(s);
        }}
      />
    );
  };

  // The world on screen (and the next one, to price ahead): a curated world with its price, or
  // the chosen events with each open one as the sample it shows.
  const shown = useMemo<ShownWorld | null>(() => {
    if (!showing) return null;
    if (touring) {
      const now = tour[cycle.step % tour.length] as Curated;
      const next = tour[(cycle.step + 1) % tour.length] as Curated;
      return {
        spec: specOf(now.legs, now.stock),
        next: specOf(next.legs, next.stock),
        preview: now.preview,
        nextPreview: next.preview,
      };
    }
    const specAt = (step: number) => {
      const withSamples = legs.flatMap((l, i): LegState[] => {
        if (l) return [l];
        const own = placeholders[i] ?? [];
        const entry = own.length ? own[step % own.length] : undefined;
        return entry ? [{ entry, wantYes: true, note: null, alternatives: [] }] : [];
      });
      return withSamples.length ? specOf(withSamples, stock) : null;
    };
    const spec = specAt(cycle.step);
    return spec ? { spec, next: sets > 1 ? specAt(cycle.step + 1) : null } : null;
  }, [showing, touring, tour, cycle.step, legs, placeholders, stock, sets]);
  useEffect(() => {
    onShown?.(shown);
  }, [shown, onShown]);

  const ready = showing && !busy;
  // Touring, the button bets on the curated world on screen. Otherwise, with no event chosen
  // yet, it opens the first event's search: the step it needs.
  const open = () => {
    if (!ready) return;
    const now = touring ? at(cycle.step) : null;
    const betLegs = now ? now.legs : chosen;
    if (!betLegs.length) {
      live.current?.querySelector<HTMLElement>('[data-slot="event"]')?.click();
      return;
    }
    setBusy(true);
    const param = stashStart(betLegs, now ? now.stock : stock);
    router.push(`/worlds/new?w=${encodeURIComponent(param)}`);
  };

  return (
    // No box around it: the sentence sits on the page under the headline, centred like it, with
    // the one action under it.
    <div className="flex w-full flex-col items-center gap-7 text-center sm:gap-9">
      {showing ? (
        // The sentence as it is, over the same sentence laid out for every set shown (unseen):
        // the cell keeps the tallest one's height while they change.
        <div className="grid *:[grid-area:1/1]">
          <div ref={live} {...cycle.aim}>
            {sentence(cycle.step)}
          </div>
          {sets > 1 &&
            Array.from({ length: sets }, (_, set) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: each layout is its set's, by number.
                key={set}
                ref={(el) => {
                  ghosts.current[set] = el;
                }}
                className="invisible"
                aria-hidden
                inert
              >
                {sentence(set)}
              </div>
            ))}
        </div>
      ) : (
        <StarterSkeleton />
      )}
      <Button size="lg" disabled={!ready} onClick={open} className="min-w-44 text-base">
        {busy ? <Spinner data-icon="inline-start" /> : null}
        Place bet
      </Button>
    </div>
  );
}

/** The sentence's shape while the stock list loads. */
function StarterSkeleton() {
  return (
    <div className="flex w-full flex-col items-center gap-3" aria-hidden>
      <span className="h-10 w-11/12 animate-pulse rounded-xl bg-secondary sm:h-12" />
      <span className="h-10 w-3/4 animate-pulse rounded-xl bg-secondary sm:h-12" />
    </div>
  );
}
