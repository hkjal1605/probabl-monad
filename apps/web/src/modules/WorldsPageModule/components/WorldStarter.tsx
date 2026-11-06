"use client";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { defaultStrike, EditableSentence } from "@/components/worlds/EditableSentence";
import { useMaxTenor, useRead, useStocks } from "@/hooks/useWorlds";
import { clampDate, monthAhead, nyDate, weekdayFrom, worldDates } from "@/lib/worlds/dates";
import { stashStart } from "@/lib/worlds/start";
import type { LegEntry, LegState, Stock, StockState } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";

/** The stock a world starts on, its side and its distance from spot. */
const START_SYMBOL = "NVDA";

/** Where a world starts on the worlds page: the builder's sentence with its parts laid out, so
 * every part a world is made of is in view and changes in place. Two events to choose (each
 * cycling through live Polymarket events), NVDA closing above 5% over its price, a month out. */
export function WorldStarter() {
  const router = useRouter();
  const [legs, setLegs] = useState<(LegState | null)[]>([null, null]);
  const [stock, setStock] = useState<StockState | null>(null);
  /** Once the person has changed the stock (or removed it), it is theirs: no default replaces it. */
  const [ownStock, setOwnStock] = useState(false);
  const [busy, setBusy] = useState(false);

  const stocks = useStocks();
  const maxTenor = useMaxTenor();
  const samples = useRead<LegEntry[]>("event-samples", (signal) => worldsApi.sampleEvents(signal));

  const chosen = legs.filter((l): l is LegState => l !== null);
  const dates = useMemo(
    () =>
      worldDates(
        legs.flatMap((l) => (l ? [l.entry.endTime] : [])),
        maxTenor,
      ),
    [legs, maxTenor],
  );

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

  // Each slot cycles through its own share of the samples, alternating as the server listed them
  // (a third or fourth slot starts later in the same share), so two slots never show the same
  // event; an event already chosen leaves its share without moving the others.
  const placeholders = useMemo(() => {
    const taken = new Set(legs.flatMap((l) => (l ? [l.entry.id] : [])));
    const list = samples.data ?? [];
    return legs.map((_, i) => {
      const own = list.filter((e, j) => j % 2 === i % 2 && !taken.has(e.id));
      const turn = Math.floor(i / 2) % Math.max(own.length, 1);
      return [...own.slice(turn), ...own.slice(0, turn)];
    });
  }, [samples.data, legs]);

  const ready = chosen.length > 0 && settled && !busy;
  const open = () => {
    if (!ready) return;
    setBusy(true);
    const param = stashStart(chosen, stock);
    router.push(`/worlds/new?w=${encodeURIComponent(param)}`);
  };

  return (
    <div className="flex flex-col gap-5 rounded-3xl bg-card p-5 text-left ring-1 ring-border sm:p-7">
      {settled ? (
        <EditableSentence
          legs={legs}
          stock={stock}
          dates={dates}
          placeholders={placeholders}
          onLeg={(i, leg) => setLegs((ls) => ls.map((l, j) => (j === i ? leg : l)))}
          // A chosen event goes back to its placeholder; an empty one goes away.
          onRemoveLeg={(i) =>
            setLegs((ls) =>
              ls[i] ? ls.map((l, j) => (j === i ? null : l)) : ls.filter((_, j) => j !== i),
            )
          }
          onAddEvent={() => setLegs((ls) => (ls.length < 4 ? [...ls, null] : ls))}
          onStock={(s) => {
            setOwnStock(true);
            setStock(s);
          }}
        />
      ) : (
        <StarterSkeleton />
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="mr-auto text-sm text-muted-foreground">
          {chosen.length ? "Tap any underlined part to change it" : "Tap an event to choose it"}
        </span>
        <Button size="lg" disabled={!ready} onClick={open}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          See my odds
          {!busy && <ArrowRight data-icon="inline-end" />}
        </Button>
      </div>
    </div>
  );
}

/** The sentence's shape while the stock list loads. */
function StarterSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <span className="h-10 w-11/12 animate-pulse rounded-xl bg-secondary sm:h-12" />
      <span className="h-10 w-3/4 animate-pulse rounded-xl bg-secondary sm:h-12" />
    </div>
  );
}
