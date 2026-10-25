"use client";
import { ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import {
  BranchToken,
  EmptyCurrentGroup,
  GROUP_BODY,
  MarketGroupHeader,
} from "@/components/portfolio/MarketGroup";
import { useMemberAccount } from "@/components/providers/WalletProvider";
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
import { explorerFor } from "@/config/protocol";
import { useOrders, useWalletTrades } from "@/hooks/useProtocolData";
import {
  displayPrice,
  formatNumber,
  formatUsd,
  shareAmount,
  shortTime,
  tokenAmount,
} from "@/lib/format/display";
import { groupByMarket } from "@/lib/portfolio/positions";
import { memberTradeFee, type WalletTradeRow, walletTradeRows } from "@/lib/portfolio/presentation";
import type { MarketView } from "@/types/api";

/** Rows shown at first and added per "Show more". */
const PAGE = 50;
const COLUMNS = 6;
const filledAt = (row: WalletTradeRow) => Number(row.trade.blockTimestamp);
const stamp = (seconds: string) => new Date(Number(seconds) * 1000).toISOString();

/** The member's fills in `markets`, grouped by market: `currentMarketId`'s (the market on screen)
 * first, then the market with the latest fill; newest first within each. */
export function WalletTradeTable({
  markets,
  currentMarketId,
  showTitles = true,
}: {
  markets: MarketView[];
  currentMarketId?: string;
  /** Each market's question in its header row (a card already titled by it can leave it out). */
  showTitles?: boolean;
}) {
  const member = useMemberAccount(),
    trades = useWalletTrades(),
    orders = useOrders();
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(
    () =>
      walletTradeRows(trades.trades, orders.orders, markets).sort(
        (a, b) => filledAt(b) - filledAt(a),
      ),
    [trades.trades, orders.orders, markets],
  );
  if (!member) return <EmptyState>Sign in to see your trades.</EmptyState>;
  if (trades.isInitialError || orders.isInitialError)
    return (
      <DataError
        retry={() => {
          void trades.refetch();
          void orders.refetch();
        }}
        message="Trade history is unavailable."
      />
    );
  if (trades.isPending || orders.isPending) return <LoadingState />;
  if (!rows.length)
    return <EmptyState>No trades yet. Your fills in every market show here.</EmptyState>;
  const groups = groupByMarket(
    rows.slice(0, shown),
    (row) => row.market,
    currentMarketId,
    (items) => Math.max(...items.map(filledAt)),
  );
  const current = currentMarketId
    ? markets.find((market) => market.id === currentMarketId)
    : undefined;
  return (
    <>
      <Table className="sm:min-w-[38rem]">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="pl-3 sm:pl-4">Trade</TableHead>
            <TableHead className="px-2 text-right sm:px-3">Price</TableHead>
            <TableHead className="px-2 text-right sm:px-3">Size</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Value</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Fee</TableHead>
            <TableHead>
              <span className="sr-only">Transaction</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        {current && groups[0]?.market.id !== current.id && (
          <EmptyCurrentGroup market={current} columns={COLUMNS}>
            No trades in this market.
          </EmptyCurrentGroup>
        )}
        {groups.map(({ market, items }) => (
          <TableBody
            key={market.id}
            className={GROUP_BODY}
            aria-label={`${market.ticker}: ${market.question}`}
          >
            <MarketGroupHeader
              market={market}
              columns={COLUMNS}
              current={market.id === currentMarketId}
              showTitle={showTitles}
            />
            {items.map((row) => {
              const { side, trade } = row;
              const price = displayPrice(trade.executionPriceRawX18, market);
              const size = shareAmount(trade.fillQuantity, market);
              const value = trade.executionQuote
                ? tokenAmount(trade.executionQuote, market.quoteTokenDecimals)
                : size * price;
              const fee = memberTradeFee(row);
              const explorer = explorerFor(market.venue);
              return (
                <TableRow key={trade.id} className="h-12">
                  <TableCell className="h-12 py-2 pr-2 pl-3 sm:pr-3 sm:pl-4">
                    <BranchToken symbol={market.ticker} branch={trade.branch} action={side} />
                    <p className="pl-2.5 text-xs text-muted-foreground tabular-nums">
                      {shortTime(stamp(trade.blockTimestamp))}
                    </p>
                  </TableCell>
                  <TableCell className="h-12 px-2 py-2 text-right tabular-nums sm:px-3">
                    {formatNumber(price)}
                  </TableCell>
                  <TableCell className="h-12 px-2 py-2 text-right tabular-nums sm:px-3">
                    {formatNumber(size, 4)}
                  </TableCell>
                  <TableCell className="hidden h-12 py-2 text-right tabular-nums sm:table-cell">
                    {formatUsd(value)}
                  </TableCell>
                  <TableCell className="hidden h-12 py-2 text-right tabular-nums lg:table-cell">
                    {fee === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : fee < 0 ? (
                      <InfoTooltip content="A maker rebate: it exceeded this fill's fee.">
                        <span className="text-positive">−{formatUsd(-fee)}</span>
                      </InfoTooltip>
                    ) : (
                      formatUsd(fee)
                    )}
                  </TableCell>
                  <TableCell className="h-12 py-2 pr-3 pl-1 text-right sm:pr-4">
                    {explorer && (
                      <a
                        href={`${explorer.replace(/\/$/, "")}/tx/${trade.transactionHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="View the transaction"
                        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <ArrowUpRight className="size-3.5" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        ))}
      </Table>
      {rows.length > shown && (
        <div className="flex justify-center border-t px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}
          </Button>
        </div>
      )}
    </>
  );
}
