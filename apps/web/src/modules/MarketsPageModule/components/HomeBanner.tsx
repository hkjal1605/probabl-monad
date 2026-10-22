"use client";

import { ArrowRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { LazyPriceChart } from "@/components/market/LazyPriceChart";
import type { LightweightChartSeries } from "@/components/market/LightweightPriceChart";
import { ProbabilityGauge } from "@/components/market/ProbabilityGauge";
import { dollars, dollarTicks, priceSeries } from "@/components/market/priceSeries";
import { useUiStore } from "@/components/providers/UiStateProvider";
import { Avatar, AvatarFallback, AvatarImage, AvatarLazyImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePriceHistory } from "@/hooks/useProtocolData";
import { shortTime } from "@/lib/format/display";
import { resolvingSoon } from "@/lib/markets/calendar";
import { eventTime, type MarketTab, marketTopic } from "@/lib/markets/categories";
import { priceLines } from "@/lib/markets/history";
import { marketPath } from "@/lib/markets/identity";
import {
  byTrading,
  currentSpotUsd,
  eventKey,
  eventMonogram,
  midpoint,
  spotImpactPercent,
} from "@/lib/markets/presentation";
import { cn } from "@/lib/utils";
import type { MarketView } from "@/types/api";

const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;

function EventImage({ market, className }: { market: MarketView; className?: string }) {
  return (
    <Avatar className={cn("rounded-xl after:rounded-xl", className)}>
      {market.imageUrl && (
        <AvatarLazyImage
          src={market.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="rounded-xl"
        />
      )}
      <AvatarFallback className="rounded-xl text-xs">{eventMonogram(market)}</AvatarFallback>
    </Avatar>
  );
}

function StockIcon({ market, className }: { market: MarketView; className?: string }) {
  return (
    <Avatar size="sm" className={className}>
      {market.assetMetadata?.image && <AvatarImage src={market.assetMetadata.image} alt="" />}
      <AvatarFallback className="text-[9px]">{market.ticker.slice(0, 2)}</AvatarFallback>
    </Avatar>
  );
}

/** One outcome's live value, as prediction markets list outcomes: a colored key, its name, its price. */
function Outcome({
  color,
  label,
  value,
  detail,
}: {
  color: LightweightChartSeries["colorToken"];
  label: string;
  value: number | null;
  detail: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-border/60 border-b py-2.5 last:border-0">
      <dt className="flex items-center gap-2.5 text-base text-foreground">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-full"
          style={{ backgroundColor: `var(--${color})` }}
        />
        {label}
      </dt>
      <dd className="text-right">
        <span className="block font-semibold text-xl text-foreground tabular-nums leading-none">
          {value === null ? "—" : dollars(value)}
        </span>
        <span className="mt-1.5 block text-muted-foreground text-xs tabular-nums">{detail}</span>
      </dd>
    </div>
  );
}

function VersusSpot({ value }: { value: number | null }) {
  return value === null ? (
    <>No spot reference</>
  ) : (
    <>
      <span className={value >= 0 ? "text-positive" : "text-destructive"}>{signed(value)}</span> vs
      spot
    </>
  );
}

/** The selected market's prices over time: YES and NO book midpoints and the stock's spot, as
 * recorded each minute, ending at the live values. */
function EventChart({
  market,
  live,
}: {
  market: MarketView;
  live: { yes: number | null; no: number | null; spot: number | null };
}) {
  const history = usePriceHistory(market.id);
  const { yes, no, spot } = live;
  const series = useMemo(
    () => priceSeries(priceLines(history.points, market, { yes, no, spot })),
    [history.points, market, yes, no, spot],
  );
  const empty =
    !history.isPending && series.every((s) => s.data.length < 2)
      ? "Prices are recorded every minute: the chart fills in as they arrive."
      : undefined;
  return (
    <div className="relative min-h-64 md:min-h-0">
      <LazyPriceChart
        variant="banner"
        series={series}
        formatValue={dollars}
        formatTicks={dollarTicks}
        emptyMessage={empty}
        ariaLabel={`${market.ticker} prices if YES and if NO, and its spot price, over time`}
      />
    </div>
  );
}

function StockPicker({
  assets,
  value,
  onChange,
}: {
  assets: MarketView[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Stock"
      variant="outline"
      spacing={1.5}
      className="max-w-full flex-nowrap overflow-x-auto [scrollbar-width:none]"
      value={[value]}
      onValueChange={(next) => {
        const id = next[0];
        if (id) onChange(id);
      }}
    >
      {assets.map((asset) => (
        <ToggleGroupItem
          key={asset.id}
          value={asset.id}
          className="h-8 gap-1.5 rounded-full pr-3 pl-1 text-foreground aria-pressed:border-foreground/30"
        >
          <StockIcon market={asset} className="size-6" />
          {asset.ticker}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The event leading the selected category: its question and probability, one of its stocks'
 * prices if YES, if NO and spot, and their chart. */
/** Whether the screen is md wide or wider, read once mounted: a phone leaves the featured event
 * out (the feed's first card is the same event), so its chart and price history never load there. */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = matchMedia("(min-width: 48rem)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

function FeaturedEvent({ assets }: { assets: MarketView[] }) {
  const event = assets[0] as MarketView;
  const [selected, setSelected] = useState(() => ([...assets].sort(byTrading)[0] ?? event).id);
  const market = assets.find((asset) => asset.id === selected) ?? event;
  const live = { yes: midpoint(market.yes), no: midpoint(market.no), spot: currentSpotUsd(market) };
  const wide = useWide();
  return (
    <Card
      variant="market"
      className="fade-in-0 flex min-h-0 animate-in flex-col p-4 duration-500 motion-reduce:animate-none max-md:hidden sm:p-5 lg:col-span-2"
    >
      <header className="flex items-start gap-4">
        <EventImage market={event} className="size-14" />
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-sm">
            {marketTopic(event)} · {assets.length === 1 ? event.ticker : `${assets.length} stocks`}
          </p>
          <h2 className="mt-1 text-balance font-semibold text-foreground text-xl leading-snug tracking-tight sm:text-2xl lg:line-clamp-2">
            <Link
              href={marketPath(market)}
              title={event.question}
              className="underline-offset-4 hover:underline"
            >
              {event.question}
            </Link>
          </h2>
        </div>
        <ProbabilityGauge probability={event.probability} conditionId={event.mapping.conditionId} />
      </header>
      {assets.length > 1 && (
        <div className="mt-4">
          <StockPicker assets={assets} value={market.id} onChange={setSelected} />
        </div>
      )}
      <div className="mt-5 grid min-h-0 flex-1 gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,9fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <dl className="flex flex-col">
            <Outcome
              color="positive"
              label="If YES"
              value={live.yes}
              detail={<VersusSpot value={spotImpactPercent(market, "YES")} />}
            />
            <Outcome
              color="danger"
              label="If NO"
              value={live.no}
              detail={<VersusSpot value={spotImpactPercent(market, "NO")} />}
            />
            <Outcome color="info" label="Spot" value={live.spot} detail="Live price" />
          </dl>
          <Button
            size="lg"
            className="mt-auto w-full sm:w-fit"
            nativeButton={false}
            render={<Link href={marketPath(market)} />}
          >
            Trade {market.ticker}
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        </div>
        {wide ? <EventChart market={market} live={live} /> : <div className="min-w-0" />}
      </div>
    </Card>
  );
}

/** Buy the branch: opens the market's ticket on it (an intent, never submitted). */
function BuyPrice({ market, branch }: { market: MarketView; branch: "YES" | "NO" }) {
  const setPrefill = useUiStore((s) => s.setPrefill);
  const price = midpoint(branch === "YES" ? market.yes : market.no);
  return (
    <Link
      href={marketPath(market)}
      aria-label={`Buy ${market.ticker} if ${branch}`}
      onClick={() => setPrefill({ intent: "buy", marketId: market.id, branch, nonce: Date.now() })}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
        branch === "YES"
          ? "bg-positive-soft text-positive hover:bg-positive/20"
          : "bg-danger-soft text-destructive hover:bg-destructive/20",
      )}
    >
      <span>{branch === "YES" ? "Yes" : "No"}</span>
      <span className="tabular-nums">{price === null ? "—" : dollars(price)}</span>
    </Link>
  );
}

function ResolvingMarket({ market }: { market: MarketView }) {
  return (
    <li className="flex flex-col gap-2 max-md:w-[80%] max-md:shrink-0 max-md:snap-start max-md:justify-between max-md:rounded-xl max-md:bg-card max-md:p-3">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <EventImage market={market} className="size-11" />
          <StockIcon
            market={market}
            className="-right-1.5 -bottom-1.5 absolute size-5 ring-2 ring-card"
          />
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={marketPath(market)}
            className="line-clamp-2 font-medium text-foreground text-sm leading-snug underline-offset-4 hover:underline"
          >
            {market.question}
          </Link>
          <p className="mt-1 text-muted-foreground text-xs tabular-nums">
            {market.ticker} · Resolves {shortTime(new Date(eventTime(market)).toISOString())}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <BuyPrice market={market} branch="YES" />
        <BuyPrice market={market} branch="NO" />
      </div>
    </li>
  );
}

/** The events resolving next, whatever the category (each as its most traded market), and the
 * way to the full calendar. */
function ResolvingSoon({
  markets,
  onViewCalendar,
}: {
  markets: MarketView[];
  onViewCalendar: () => void;
}) {
  return (
    <Card
      variant="market"
      className="flex min-w-0 flex-col p-4 max-md:overflow-visible max-md:rounded-none max-md:bg-transparent max-md:p-0 sm:p-5"
    >
      <h2 className="font-semibold text-foreground text-lg tracking-tight">Resolving soon</h2>
      {markets.length ? (
        // On a phone the markets are cards in a row that swipes sideways, the next one peeking in.
        <ul className="mt-4 flex min-h-0 flex-1 flex-col justify-between gap-4 max-md:-mx-4 max-md:mt-3 max-md:snap-x max-md:snap-mandatory max-md:scroll-px-4 max-md:flex-row max-md:justify-start max-md:gap-3 max-md:overflow-x-auto max-md:px-4 max-md:[scrollbar-width:none]">
          {markets.map((market) => (
            <ResolvingMarket key={market.id} market={market} />
          ))}
        </ul>
      ) : (
        <p className="m-auto py-10 text-center text-muted-foreground text-sm">
          No market resolves soon.
        </p>
      )}
      <Button variant="outline" className="mt-4 w-full max-md:mt-3" onClick={onViewCalendar}>
        <CalendarDays data-icon="inline-start" />
        View Calendar
      </Button>
    </Card>
  );
}

/** The top of the markets page, on the market grid's columns and gaps: the selected category's
 * leading event with its price chart across two columns, and the events resolving next in the
 * third, lined up with the cards below. */
export function HomeBanner({
  featured,
  category,
  markets,
  onViewCalendar,
}: {
  /** The first event of the selected category (its markets), if any. */
  featured: MarketView[] | undefined;
  category: MarketTab;
  /** Every listed market: what resolves next does not depend on the category. */
  markets: MarketView[];
  /** Opens the calendar, as its category tab does. */
  onViewCalendar: () => void;
}) {
  // Read when the markets change, not on a clock: the list refreshes, and so does this.
  const resolving = useMemo(() => resolvingSoon(markets, Date.now()), [markets]);
  const event = featured?.[0];
  return (
    <section aria-label="Featured markets" className="mb-3 grid gap-3 lg:h-[28rem] lg:grid-cols-3">
      {event && featured ? (
        <FeaturedEvent key={eventKey(event)} assets={featured} />
      ) : (
        <Card
          variant="market"
          className="flex min-h-80 items-center justify-center p-6 max-md:hidden lg:col-span-2"
        >
          <p className="text-muted-foreground text-sm">No {category} markets are listed yet.</p>
        </Card>
      )}
      <ResolvingSoon markets={resolving} onViewCalendar={onViewCalendar} />
    </section>
  );
}
