"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LifecycleBadge } from "@/components/data/StatusBadge";
import { Avatar, AvatarFallback, AvatarLazyImage } from "@/components/ui/avatar";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { TableBody, TableCell, TableRow } from "@/components/ui/table";
import { marketPath } from "@/lib/markets/identity";
import { cn } from "@/lib/utils";
import type { MarketView } from "@/types/api";

/** A market as the account tables name it: its art, its stock's ticker (markets on one event differ
 * by it) and its question, linking to its page unless it is the one on screen. The question
 * truncates to one line (two on a phone); the full one shows on hover or focus. */
export function MarketIdentity({
  market,
  current = false,
  className,
}: {
  market: MarketView;
  current?: boolean;
  className?: string;
}) {
  const content = (
    <>
      <Avatar size="sm" className="rounded-md after:rounded-md">
        {market.imageUrl && (
          <AvatarLazyImage
            src={market.imageUrl}
            alt=""
            className="rounded-md"
            referrerPolicy="no-referrer"
          />
        )}
        <AvatarFallback className="rounded-md text-[10px]">
          {market.question.slice(0, 1)}
        </AvatarFallback>
      </Avatar>
      <span className="shrink-0 font-semibold text-foreground">{market.ticker}</span>
      <span className="line-clamp-2 min-w-0 font-normal text-muted-foreground group-hover/market:text-foreground sm:line-clamp-none sm:truncate">
        {market.question}
      </span>
    </>
  );
  const layout = cn("flex min-w-0 max-w-full items-center gap-2", className);
  if (current)
    return (
      <InfoTooltip content={market.question}>
        <span className={layout}>{content}</span>
      </InfoTooltip>
    );
  return (
    <InfoTooltip content={market.question}>
      <Link
        href={marketPath(market)}
        className={cn(
          layout,
          "group/market rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {content}
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/market:translate-x-0.5 group-hover/market:text-foreground"
        />
      </Link>
    </InfoTooltip>
  );
}

/** A market group's header row, spanning the table: the market, a "This market" mark for the one on
 * screen (pinned first by the caller), a badge when it isn't trading, and `children` at the right
 * (amounts that belong to the market rather than a row). Contained, so the header fits the table
 * rather than widening it, and on a phone what follows the question wraps below it. */
export function MarketGroupHeader({
  market,
  columns,
  current = false,
  showTitle = true,
  children,
}: {
  market: MarketView;
  columns: number;
  current?: boolean;
  showTitle?: boolean;
  children?: ReactNode;
}) {
  // Under a card that names the market, a trading market with nothing beside it needs no row.
  if (!showTitle && !children && market.lifecycle === "open") return null;
  return (
    <TableRow
      className={cn("hover:bg-transparent", current ? "bg-secondary" : "bg-secondary/60")}
      aria-current={current || undefined}
    >
      <th
        scope="rowgroup"
        colSpan={columns}
        className={cn(
          "h-10 px-3 py-1.5 text-left text-sm font-medium",
          current && "shadow-[inset_3px_0_0_var(--foreground)]",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 [contain:inline-size]">
          {showTitle && <MarketIdentity market={market} current={current} />}
          {current && showTitle && (
            <span className="shrink-0 rounded-sm bg-foreground/10 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
              This market
            </span>
          )}
          {market.lifecycle !== "open" && <LifecycleBadge state={market.lifecycle} />}
          <span className="flex-1" />
          {children}
        </div>
      </th>
    </TableRow>
  );
}

/** Separates a table's market groups (each its own `tbody`). */
export const GROUP_BODY = "border-t-8 border-card first-of-type:border-t-0";

/** A claim, order or fill's token, named in full and coloured by its branch (never by colour
 * alone), after an optional action ("Buy"). */
export function BranchToken({
  symbol,
  branch,
  action,
}: {
  symbol: string;
  branch: number;
  action?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 font-medium">
      <span
        aria-hidden="true"
        className={cn("h-4 w-0.5 rounded-full", branch === 0 ? "bg-positive" : "bg-danger")}
      />
      {action && <span className="text-foreground">{action}</span>}
      <span className={branch === 0 ? "text-positive" : "text-danger"}>
        {symbol}-{branch === 0 ? "YES" : "NO"}
      </span>
    </span>
  );
}

/** The market on screen when it has nothing to list but others do: its header and a note, pinned
 * first, so the list never reads as being about another market. */
export function EmptyCurrentGroup({
  market,
  columns,
  children,
}: {
  market: MarketView;
  columns: number;
  children: ReactNode;
}) {
  return (
    <TableBody className={GROUP_BODY} aria-label={`${market.ticker}: ${market.question}`}>
      <MarketGroupHeader market={market} columns={columns} current />
      <TableRow className="hover:bg-transparent">
        <TableCell
          colSpan={columns}
          className="h-10 py-2 pl-3 text-sm text-muted-foreground sm:pl-4"
        >
          {children}
        </TableCell>
      </TableRow>
    </TableBody>
  );
}
