"use client";

import {
  formatPriceRawX18,
  formatShareAmount,
  formatTokenAmount,
} from "@conditional-stocks/domain";
import { useRouter } from "next/navigation";
import {
  BranchToken,
  EmptyCurrentGroup,
  GROUP_BODY,
  MarketGroupHeader,
} from "@/components/portfolio/MarketGroup";
import { useUiStore } from "@/components/providers/UiStateProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DataError, EmptyState, LoadingState } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOrders, usePositions } from "@/hooks/useProtocolData";
import { formatNumber, formatUsd, tokenAmount } from "@/lib/format/display";
import { stepQuantity } from "@/lib/markets/base";
import { marketPath } from "@/lib/markets/identity";
import { isResolved } from "@/lib/markets/presentation";
import {
  type ConditionalPositionRow,
  conditionalPositionRows,
  positionGroups,
  rowMark,
} from "@/lib/portfolio/positions";
import type { MarketView } from "@/types/api";

/** Close intent for a stock claim row: sell the held claims, step-aligned. */
export function closePrefill(row: ConditionalPositionRow) {
  const quantity =
    row.kind === "stock" ? stepQuantity(row.available, BigInt(row.market.baseStep)) : 0n;
  return {
    intent: "close" as const,
    marketId: row.market.id,
    branch: row.branch === 0 ? ("YES" as const) : ("NO" as const),
    quantity: formatShareAmount(quantity, row.market),
    nonce: Date.now(),
  };
}

const COLUMNS = 7;
const signed = (value: number, format: (value: number) => string) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${format(Math.abs(value))}`;

/** The member's positions grouped by market: a header row per market (the market, linking to its
 * page, and its cash claims beside it), then a row per stock claim. `currentMarketId`'s market, the one
 * on screen, comes first and is marked; closing one of its claims fills the ticket beside it. */
export function PositionTable({
  markets,
  currentMarketId,
  softClose = false,
  showTitles = true,
}: {
  markets: MarketView[];
  currentMarketId?: string;
  softClose?: boolean;
  /** Each market's question in its header row (a card already titled by it can leave it out). */
  showTitles?: boolean;
}) {
  const wallet = useWallet(),
    positions = usePositions(),
    orders = useOrders(),
    router = useRouter();
  const setPrefill = useUiStore((s) => s.setPrefill);
  if (!wallet.account) return <EmptyState>Connect your wallet to see positions.</EmptyState>;
  if (positions.isInitialError || orders.isInitialError)
    return (
      <DataError
        retry={() => {
          void positions.refetch();
          void orders.refetch();
        }}
        message="Positions or reservations are unavailable."
      />
    );
  if (orders.data?.openTruncated)
    return (
      <EmptyState>
        The open-order limit was reached. Position totals including reservations are unavailable.
        Available wallet claims can still be managed in the Claims tab.
      </EmptyState>
    );
  if (positions.isPending || orders.isPending) return <LoadingState />;
  // Open positions only: a resolved market's claims are redeemed in Claims.
  const groups = positionGroups(
    conditionalPositionRows(
      markets.filter((market) => !isResolved(market)),
      positions.positions,
      orders.orders,
    ),
    currentMarketId,
  );
  const current = markets.find((market) => market.id === currentMarketId);
  const resolvedNote = "This market has resolved. Claims that pay are redeemed in Claims.";
  if (!groups.length) {
    return (
      <EmptyState>
        {current && isResolved(current)
          ? resolvedNote
          : current
            ? `No open positions. Buy ${current.ticker}-YES or ${current.ticker}-NO in the ticket to open one.`
            : "No open positions yet."}
      </EmptyState>
    );
  }
  const closable = positions.isDataFresh && orders.isDataFresh;
  const close = (row: ConditionalPositionRow) => {
    setPrefill(closePrefill(row));
    if (row.market.id === currentMarketId)
      document
        .getElementById("trade-ticket")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    else router.push(marketPath(row.market));
  };
  return (
    <Table className="sm:min-w-[38rem]">
      <TableHeader className="sticky top-0 z-10 bg-card">
        <TableRow>
          <TableHead className="pl-3 sm:pl-4">Position</TableHead>
          <TableHead className="px-2 text-right sm:px-3">Size</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Value</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Avg entry</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Mark</TableHead>
          <TableHead className="px-2 text-right sm:px-3">
            <InfoTooltip content="Mark-to-entry on the claims bought in fills: their value at the book midpoint less what they cost.">
              <span>PnL</span>
            </InfoTooltip>
          </TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      {current && groups[0]?.market.id !== current.id && (
        <EmptyCurrentGroup market={current} columns={COLUMNS}>
          {isResolved(current) ? resolvedNote : "No position in this market."}
        </EmptyCurrentGroup>
      )}
      {groups.map((group) => (
        <TableBody
          key={group.market.id}
          className={GROUP_BODY}
          aria-label={`${group.market.ticker}: ${group.market.question}`}
        >
          <MarketGroupHeader
            market={group.market}
            columns={COLUMNS}
            current={group.market.id === currentMarketId}
            showTitle={showTitles}
          >
            {group.cash.length > 0 && <CashClaims rows={group.cash} />}
          </MarketGroupHeader>
          {group.stock.map((row) => (
            <StockRow
              key={row.key}
              row={row}
              softClose={softClose}
              closable={closable}
              onClose={() => close(row)}
            />
          ))}
        </TableBody>
      ))}
    </Table>
  );
}

/** A market's cash (quote) claims, as compact amounts rather than rows of their own. */
function CashClaims({ rows }: { rows: ConditionalPositionRow[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs font-normal">
      <span className="hidden text-muted-foreground md:inline">Cash</span>
      {rows.map((row) => {
        const branch = row.branch === 0 ? "YES" : "NO";
        const amount = formatNumber(tokenAmount(row.total.toString(), row.decimals));
        return (
          <InfoTooltip
            key={row.key}
            content={`${amount} ${row.symbol} paid out if the event resolves ${branch}. A YES and NO pair merges back into ${row.symbol} in the Claims tab.`}
          >
            <span className="inline-flex items-center gap-1 rounded-sm bg-background/70 px-1.5 py-0.5 tabular-nums">
              <span className={row.branch === 0 ? "text-positive" : "text-danger"}>
                {row.symbol}-{branch}
              </span>
              <span className="font-medium text-foreground">{amount}</span>
            </span>
          </InfoTooltip>
        );
      })}
    </span>
  );
}

function StockRow({
  row,
  softClose,
  closable,
  onClose,
}: {
  row: ConditionalPositionRow;
  softClose: boolean;
  closable: boolean;
  onClose: () => void;
}) {
  const { market, branch, symbol, decimals, available, reserved, total, priced, cost } = row;
  const size = tokenAmount(total.toString(), decimals);
  const mark = rowMark(row);
  // The indexer prices claims bought in fills (cost / priced, the exchange's price format).
  const entry =
    priced > 0n ? Number(formatPriceRawX18((cost * 10n ** 18n) / priced, market)) : null;
  const pricedSize = tokenAmount(priced.toString(), decimals);
  const pnl = entry !== null && mark !== null ? pricedSize * (mark - entry) : null;
  return (
    <TableRow className="h-12">
      <TableCell className="h-12 py-2 pr-2 pl-3 sm:pr-3 sm:pl-4">
        <BranchToken symbol={symbol} branch={branch} />
        {/* The columns a phone leaves out. */}
        <p className="pl-2.5 text-xs text-muted-foreground tabular-nums sm:hidden">
          {entry === null ? "No entry" : `Entry ${formatNumber(entry)}`}
          <br />
          Mark {formatNumber(mark)}
        </p>
      </TableCell>
      <TableCell className="h-12 px-2 py-2 text-right tabular-nums sm:px-3">
        {formatNumber(size, 4)}
        {reserved > 0n && (
          <p className="text-xs text-muted-foreground">
            {formatTokenAmount(reserved, decimals)} in orders
          </p>
        )}
      </TableCell>
      <TableCell className="hidden h-12 py-2 text-right tabular-nums sm:table-cell">
        {mark === null ? <span className="text-muted-foreground">—</span> : formatUsd(size * mark)}
      </TableCell>
      <TableCell className="hidden h-12 py-2 text-right tabular-nums sm:table-cell">
        {entry !== null ? (
          <>
            <InfoTooltip content="Average price paid in your fills, after fees and maker rebates. Selling held claims keeps the average.">
              <span>{formatNumber(entry)}</span>
            </InfoTooltip>
            {priced < total && (
              <p className="text-xs text-muted-foreground">
                on {formatShareAmount(priced, market)} of {formatShareAmount(total, market)}
              </p>
            )}
          </>
        ) : (
          <InfoTooltip content="No fill priced these claims: they came from a split or a transfer.">
            <span className="text-muted-foreground">—</span>
          </InfoTooltip>
        )}
      </TableCell>
      <TableCell className="hidden h-12 py-2 text-right tabular-nums sm:table-cell">
        {formatNumber(mark)}
      </TableCell>
      <TableCell className="h-12 px-2 py-2 text-right tabular-nums sm:px-3">
        {pnl !== null && entry !== null && mark !== null && Number.isFinite(pnl) ? (
          <span className={pnl > 0 ? "text-positive" : pnl < 0 ? "text-danger" : undefined}>
            {signed(pnl, formatUsd)}
            <p className="text-xs">{signed(((mark - entry) / entry) * 100, formatNumber)}%</p>
          </span>
        ) : (
          <InfoTooltip content="Needs an entry price and a mark.">
            <span className="text-muted-foreground">—</span>
          </InfoTooltip>
        )}
      </TableCell>
      <TableCell className="h-12 py-2 pr-3 pl-2 text-right sm:pr-4 sm:pl-3">
        <Button
          size="xs"
          variant={softClose ? "ghost" : "outline"}
          className={
            softClose
              ? "border-0 bg-danger-soft px-2.5 text-destructive hover:bg-danger-soft hover:text-destructive"
              : undefined
          }
          disabled={available === 0n || market.lifecycle !== "open" || !closable}
          onClick={onClose}
        >
          Close
        </Button>
      </TableCell>
    </TableRow>
  );
}
