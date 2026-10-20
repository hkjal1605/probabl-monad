"use client";

import { EVENT_SOURCE_NAMES } from "@conditional-stocks/market-data";
import type { UTCTimestamp } from "lightweight-charts";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import {
  type LightweightChartSeries,
  LightweightPriceChart,
} from "@/components/market/LightweightPriceChart";
import { ProbabilityGauge } from "@/components/market/ProbabilityGauge";
import { useUiStore } from "@/components/providers/UiStateProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePriceHistory } from "@/hooks/useProtocolData";
import { formatCompactUsd, formatUsd, shortDate } from "@/lib/format/display";
import { type LinePoint, priceLines } from "@/lib/markets/history";
import { marketPath } from "@/lib/markets/identity";
import {
  bookDepthUsd,
  byTrading,
  currentSpotUsd,
  eventKey,
  eventMonogram,
  type MarketCategory,
  marketCategory,
  midpoint,
  mostTraded,
  spotImpactPercent,
} from "@/lib/markets/presentation";
import { safeExternalUrl } from "@/lib/markets/resolution";
import { cn } from "@/lib/utils";
import type { MarketView } from "@/types/api";

/** Chart and outcome values: dollars per whole token. */
const dollars = (value: number) => formatUsd(value);
const wholeDollars = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});
/** Axis ticks: whole dollars when every tick is one, else cents. */
const dollarTicks = (values: number[]) =>
  values.every((value) => Math.abs(value - Math.round(value)) < 1e-9)
    ? values.map((value) => wholeDollars.format(value))
    : values.map(dollars);
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
const line = (points: LinePoint[]) =>
  points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));

function EventImage({ market, className }: { market: MarketView; className?: string }) {
  return (
    <Avatar className={cn("rounded-xl after:rounded-xl", className)}>
      {market.imageUrl && (
        <AvatarImage
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
    <div className="flex items-center justify-between gap-4 border-border/60 border-b py-3 last:border-0">
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
  const series = useMemo<LightweightChartSeries[]>(() => {
    const lines = priceLines(history.points, market, { yes, no, spot });
    return [
      { id: "yes", label: "If YES", colorToken: "positive", data: line(lines.yes) },
      { id: "no", label: "If NO", colorToken: "danger", data: line(lines.no) },
      {
        id: "spot",
        label: "Spot",
        colorToken: "info",
        lineStyle: "dashed",
        data: line(lines.spot),
      },
    ];
  }, [history.points, market, yes, no, spot]);
  const empty =
    !history.isPending && series.every((s) => s.data.length < 2)
      ? "Prices are recorded every minute: the chart fills in as they arrive."
      : undefined;
  return (
    <div className="relative min-h-64 md:min-h-0">
      <LightweightPriceChart
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
function FeaturedEvent({ assets }: { assets: MarketView[] }) {
  const event = assets[0] as MarketView;
  const [selected, setSelected] = useState(() => ([...assets].sort(byTrading)[0] ?? event).id);
  const market = assets.find((asset) => asset.id === selected) ?? event;
  const live = { yes: midpoint(market.yes), no: midpoint(market.no), spot: currentSpotUsd(market) };
  const volume = assets.reduce((sum, asset) => sum + (asset.volume24h ?? 0), 0);
  const liquidity = assets.reduce((sum, asset) => sum + bookDepthUsd(asset), 0);
  const source = safeExternalUrl(event.mapping.sourceUrl);
  return (
    <Card
      variant="market"
      className="fade-in-0 flex min-h-0 animate-in flex-col p-4 duration-500 motion-reduce:animate-none sm:p-5"
    >
      <header className="flex items-start gap-4">
        <EventImage market={event} className="size-14" />
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-sm">
            {marketCategory(event)} ·{" "}
            {assets.length === 1 ? event.ticker : `${assets.length} stocks`}
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
        <EventChart market={market} live={live} />
      </div>
      <footer className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-border border-t pt-4 text-muted-foreground text-sm">
        <span className="tabular-nums">
          {formatCompactUsd(volume)} Vol · {formatCompactUsd(liquidity)} liquidity
        </span>
        <span className="flex items-center gap-2">
          Ends {shortDate(market.cutoff)}
          {source && (
            <>
              <span aria-hidden="true">·</span>
              <a
                href={source}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-0.5 transition-colors hover:text-foreground"
              >
                {EVENT_SOURCE_NAMES[event.mapping.source]}
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </a>
            </>
          )}
        </span>
      </footer>
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

function TradedMarket({ market }: { market: MarketView }) {
  return (
    <li className="flex flex-col gap-2">
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
            {market.ticker} · {formatCompactUsd(market.volume24h ?? 0)} vol
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

/** The markets traded most in the last 24 hours, whatever the category. */
function MostTraded({ markets }: { markets: MarketView[] }) {
  return (
    <Card variant="market" className="flex flex-col p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-foreground text-lg tracking-tight">Most Traded</h2>
        <span className="text-muted-foreground text-xs">Last 24 hours</span>
      </div>
      {markets.length ? (
        <ul className="mt-4 flex min-h-0 flex-1 flex-col justify-between gap-4">
          {markets.map((market) => (
            <TradedMarket key={market.id} market={market} />
          ))}
        </ul>
      ) : (
        <p className="m-auto py-10 text-center text-muted-foreground text-sm">
          No market is trading yet.
        </p>
      )}
    </Card>
  );
}

/** The top of the markets page: the selected category's leading event with its price chart
 * (about two thirds of the width), and the most traded markets beside it. */
export function HomeBanner({
  featured,
  category,
  markets,
}: {
  /** The first event of the selected category (its markets), if any. */
  featured: MarketView[] | undefined;
  category: MarketCategory;
  /** Every listed market: the most traded do not depend on the category. */
  markets: MarketView[];
}) {
  const traded = useMemo(() => mostTraded(markets), [markets]);
  const event = featured?.[0];
  return (
    <section
      aria-label="Featured markets"
      className="mb-6 grid gap-4 lg:h-[33rem] lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]"
    >
      {event && featured ? (
        <FeaturedEvent key={eventKey(event)} assets={featured} />
      ) : (
        <Card variant="market" className="flex min-h-80 items-center justify-center p-6">
          <p className="text-muted-foreground text-sm">No {category} markets are listed yet.</p>
        </Card>
      )}
      <MostTraded markets={traded} />
    </section>
  );
}
