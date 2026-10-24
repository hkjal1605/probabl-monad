"use client";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { TokenIdentity } from "@/components/market/TokenIdentity";
import { useUiStore } from "@/components/providers/UiStateProvider";
import { Avatar, AvatarFallback, AvatarLazyImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCompactUsd, formatUsd, shortDate } from "@/lib/format/display";
import { marketTopic } from "@/lib/markets/categories";
import { marketPath } from "@/lib/markets/identity";
import { eventKey, eventMonogram, impactPercent, midpoint } from "@/lib/markets/presentation";
import { cn } from "@/lib/utils";
import type { MarketView } from "@/types/api";

/** Headings and fixed widths; the event column takes the rest, and the last holds trade actions. */
const COLUMNS = [
  ["Event / asset", "pl-4"],
  ["P(yes)", "w-36"],
  ["If yes", "w-32"],
  ["If no", "w-28"],
  ["Impact", "w-28"],
  ["24h vol", "w-24"],
  ["Closes", "w-28"],
] as const;

/** The column headings, shared with the loading skeleton. */
export function ColumnsHeader() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        {COLUMNS.map(([label, width]) => (
          <TableHead
            key={label}
            className={cn("text-[11px] font-medium tracking-[0.06em] uppercase", width)}
          >
            {label}
          </TableHead>
        ))}
        <TableHead className="w-40 pr-4">
          <span className="sr-only">Trade</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}
/** Table classes, shared with the loading skeleton: fixed columns, compact rows. */
export const COLUMNS_TABLE = "min-w-[72rem] table-fixed text-sm [&_td]:h-10 [&_td]:py-1";

const Dash = () => <span className="text-muted-foreground">—</span>;
/** A number right-aligned in a fixed box, so decimals line up under a left-aligned heading. */
const Figure = ({ children }: { children: ReactNode }) => (
  <span className="inline-block min-w-[4.5rem] text-right">{children}</span>
);

function Probability({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <Dash />;
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className="flex items-center gap-2.5">
      <span className="w-9 font-medium text-info">{percent}%</span>
      <span aria-hidden="true" className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-info" style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

function Impact({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <Dash />;
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex min-w-[4.5rem] items-center justify-end gap-1.5",
        up ? "text-positive" : "text-destructive",
      )}
    >
      <span aria-hidden="true" className="text-[9px]">
        {up ? "▲" : "▼"}
      </span>
      {`${up ? "+" : "−"}${Math.abs(value).toFixed(1)}%`}
    </span>
  );
}

const price = (value: number | null) => (value === null ? <Dash /> : formatUsd(value));

/** Buy YES and NO: open the market's ticket on that branch. Shown on hover or focus where there
 * is hover, always on touch screens. */
function TradeActions({ market }: { market: MarketView }) {
  const setPrefill = useUiStore((s) => s.setPrefill);
  return (
    <div className="relative z-10 flex justify-end gap-1.5 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:hover)]:opacity-0">
      {(["YES", "NO"] as const).map((branch) => (
        <Button
          key={branch}
          size="sm"
          variant={branch === "YES" ? "buy" : "sell"}
          className="px-2 font-semibold"
          nativeButton={false}
          render={
            <Link
              href={marketPath(market)}
              aria-label={`Buy ${market.ticker} if ${branch}`}
              onClick={() =>
                setPrefill({ intent: "buy", marketId: market.id, branch, nonce: Date.now() })
              }
            />
          }
        >
          Buy {branch}
        </Button>
      ))}
    </div>
  );
}

function EventRow({ market }: { market: MarketView }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="pl-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-8 rounded-md after:rounded-md">
            {market.imageUrl && (
              <AvatarLazyImage
                src={market.imageUrl}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="rounded-md"
              />
            )}
            <AvatarFallback className="rounded-md text-[10px]">
              {eventMonogram(market)}
            </AvatarFallback>
          </Avatar>
          <Link
            href={marketPath(market)}
            title={market.question}
            className="truncate font-semibold"
          >
            {market.question}
          </Link>
          <Badge
            variant="outline"
            className="h-[18px] rounded-sm text-[10px] tracking-[0.06em] text-muted-foreground uppercase"
          >
            {marketTopic(market)}
          </Badge>
        </div>
      </TableCell>
      <TableCell>
        <Probability value={market.probability.value} />
      </TableCell>
      {["yes", "no", "impact", "volume", "closes"].map((column) => (
        <TableCell key={column}>
          <Dash />
        </TableCell>
      ))}
      <TableCell className="pr-4" />
    </TableRow>
  );
}

function AssetRow({ market }: { market: MarketView }) {
  return (
    <TableRow className="group/row relative" data-tour-market={market.venue.marketId}>
      {/* Indented to the event's title: its image (2rem) and gap (0.75rem) past the padding. */}
      <TableCell className="pl-[3.75rem]">
        <Link
          href={marketPath(market)}
          className="after:absolute after:inset-0"
          aria-label={`Open ${market.ticker} market: ${market.question}`}
        >
          <TokenIdentity
            symbol={market.ticker}
            metadata={market.assetMetadata}
            showName={false}
            iconSize="sm"
          />
        </Link>
      </TableCell>
      <TableCell>
        <Dash />
      </TableCell>
      <TableCell>
        <Figure>{price(midpoint(market.yes))}</Figure>
      </TableCell>
      <TableCell>
        <Figure>{price(midpoint(market.no))}</Figure>
      </TableCell>
      <TableCell>
        <Impact value={impactPercent(market)} />
      </TableCell>
      <TableCell>
        <Figure>{market.volume24h === null ? <Dash /> : formatCompactUsd(market.volume24h)}</Figure>
      </TableCell>
      <TableCell>{shortDate(market.cutoff)}</TableCell>
      <TableCell className="pr-4">
        <TradeActions market={market} />
      </TableCell>
    </TableRow>
  );
}

/** Every event as a row with its probability, each followed by its assets' rows: both branches'
 * prices, the YES-over-NO impact, the day's volume and the trading cutoff. */
export function MarketsColumns({ groups }: { groups: MarketView[][] }) {
  return (
    <Card variant="market">
      <Table className={COLUMNS_TABLE}>
        <ColumnsHeader />
        <TableBody>
          {groups.map((assets) => {
            const market = assets[0];
            if (!market) return null;
            return (
              <Fragment key={eventKey(market)}>
                <EventRow market={market} />
                {assets.map((asset) => (
                  <AssetRow key={asset.id} market={asset} />
                ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
