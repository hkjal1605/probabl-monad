"use client";
import { useMemo, useState } from "react";
import {
  BranchToken,
  EmptyCurrentGroup,
  GROUP_BODY,
  MarketGroupHeader,
} from "@/components/portfolio/MarketGroup";
import { useWallet } from "@/components/providers/WalletProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DataError, EmptyState, LoadingState } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountStepEmpty } from "@/components/wallet/AccountGate";
import { useOrderRecovery } from "@/hooks/useOrderRecovery";
import { useRerenderAt } from "@/hooks/useRerenderAt";
import {
  displayPrice,
  formatNumber,
  shareAmount,
  shortTime,
  tokenAmount,
} from "@/lib/format/display";
import { groupByMarket } from "@/lib/portfolio/positions";
import type { IndexedOrder, MarketView } from "@/types/api";

const VIEWS = ["Open", "History", "All"] as const;
type View = (typeof VIEWS)[number];
/** Rows shown at first and added per "Show more": the list can hold 1,000 orders. */
const PAGE = 50;
/** Lifecycles whose open orders can only release their escrow. */
const CLOSED = new Set(["frozen", "awaiting-resolution", "resolved", "redeemable", "archived"]);
const placedAt = (order: IndexedOrder) => (order.createdAt ? Date.parse(order.createdAt) : 0);

/** The member's orders grouped by market: `currentMarketId`'s (the market on screen) first, then
 * the market with the latest order. Open orders by default; History holds the closed ones. */
export function OrderTable({
  markets,
  currentMarketId,
}: {
  markets: MarketView[];
  currentMarketId?: string;
}) {
  const wallet = useWallet(),
    query = useOrderRecovery();
  const [view, setView] = useState<View>("Open"),
    [shown, setShown] = useState(PAGE);
  const marketsById = useMemo(() => new Map(markets.map((m) => [m.id, m])), [markets]);
  // An open order's expiry turns its "Cancel" into "Release escrow" with no data changing.
  useRerenderAt(
    query.orders.filter((o) => o.status === "open").map((o) => Number(o.expiry) * 1000),
  );
  if (wallet.access !== "member" && wallet.access !== "suspended")
    return <AccountStepEmpty>Connect to see your orders.</AccountStepEmpty>;
  const openCount = query.orders.filter((o) => o.status === "open").length;
  const orders = query.orders
    .filter((o) => view === "All" || (view === "Open") === (o.status === "open"))
    .sort((a, b) => placedAt(b) - placedAt(a));
  const groups = groupByMarket(
    orders.slice(0, shown),
    (order) => marketsById.get(order.marketId),
    currentMarketId,
    (items) => Math.max(...items.map(placedAt)),
  );
  const columns = view === "Open" ? 6 : 7;
  const current = currentMarketId ? marketsById.get(currentMarketId) : undefined;
  return (
    <section aria-label="Orders" className="min-w-0">
      <div className="flex items-center gap-3 border-b px-3 py-2 sm:px-4">
        <Segmented
          label="Order status"
          variant="timeframe"
          value={view}
          options={VIEWS}
          onChange={(next) => {
            setView(next);
            setShown(PAGE);
          }}
          renderOption={(option) =>
            option === "Open" && openCount > 0 ? (
              <>
                Open <span className="text-muted-foreground tabular-nums">{openCount}</span>
              </>
            ) : (
              option
            )
          }
        />
      </div>
      {(query.data?.truncated || query.data?.openTruncated) && (
        <p role="status" className="border-b px-3 py-2 text-xs font-medium text-warning sm:px-4">
          {query.data.openTruncated
            ? "The open-order limit was reached. This list and reservation totals may be incomplete."
            : "Showing the most recent order history plus older open orders. Earlier closed orders are not included."}
        </p>
      )}
      {query.isInitialError ? (
        <DataError
          message="Order history is unavailable. Existing orders are not cancelled."
          retry={() => {
            void query.refetch();
          }}
        />
      ) : query.isPending ? (
        <LoadingState />
      ) : !groups.length ? (
        <EmptyState>
          {view === "Open"
            ? "No open orders. Limit orders rest here until they fill or you cancel them."
            : "No past orders yet."}
        </EmptyState>
      ) : (
        <Table className="sm:min-w-[38rem]">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="pl-3 sm:pl-4">Order</TableHead>
              <TableHead className="px-2 text-right sm:px-3">Price</TableHead>
              <TableHead className="px-2 text-right sm:px-3">Filled</TableHead>
              <TableHead className="hidden text-right sm:table-cell">
                <InfoTooltip content="What the order holds until it fills or is cancelled: tokens, or claims for an order that sells or spends claims.">
                  <span>Reserved</span>
                </InfoTooltip>
              </TableHead>
              {view !== "Open" && <TableHead className="hidden sm:table-cell">Status</TableHead>}
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {current && groups[0]?.market.id !== current.id && (
            <EmptyCurrentGroup market={current} columns={columns}>
              {view === "Open" ? "No open orders in this market." : "No orders in this market."}
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
                columns={columns}
                current={market.id === currentMarketId}
              />
              {items.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  market={market}
                  showStatus={view !== "Open"}
                  canceling={query.canceling}
                  pending={query.pending.has(order.id)}
                  cancel={query.cancel}
                />
              ))}
            </TableBody>
          ))}
        </Table>
      )}
      {orders.length > shown && (
        <div className="flex justify-center border-t px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, orders.length - shown)} more of {orders.length - shown}
          </Button>
        </div>
      )}
    </section>
  );
}

function OrderRow({
  order,
  market,
  showStatus,
  canceling,
  pending,
  cancel,
}: {
  order: IndexedOrder;
  market: MarketView;
  showStatus: boolean;
  canceling: string | null;
  pending: boolean;
  cancel: ReturnType<typeof useOrderRecovery>["cancel"];
}) {
  const filled = BigInt(order.filled),
    quantity = BigInt(order.quantity);
  const partial = filled > 0n && BigInt(order.remaining) > 0n;
  const expired = BigInt(order.expiry) <= BigInt(Math.floor(Date.now() / 1000));
  const closed = CLOSED.has(market.lifecycle);
  const branch = order.branch === 0 ? "YES" : "NO";
  const percent = quantity > 0n ? Number((filled * 10_000n) / quantity) / 100 : 0;
  return (
    <TableRow className="h-12">
      <TableCell className="h-12 py-2 pr-2 pl-3 sm:pr-3 sm:pl-4">
        <BranchToken
          symbol={market.ticker}
          branch={order.branch}
          action={order.side === 0 ? "Buy" : "Sell"}
        />
        <p className="pl-2.5 text-xs text-muted-foreground">
          {order.tif === 0 ? "Limit" : "IOC"}
          {placedAt(order) > 0 && ` · ${shortTime(order.createdAt ?? "")}`}
        </p>
      </TableCell>
      <TableCell className="h-12 px-2 py-2 text-right tabular-nums sm:px-3">
        {formatNumber(displayPrice(order.limitPriceRawX18, market))}
      </TableCell>
      <TableCell className="h-12 px-2 py-2 text-right tabular-nums sm:px-3">
        {formatNumber(shareAmount(order.filled, market), 2)}
        <span className="text-muted-foreground">
          {" / "}
          {formatNumber(shareAmount(order.quantity, market), 2)}
        </span>
        <span
          aria-hidden="true"
          className="mt-1 ml-auto block h-0.5 w-16 overflow-hidden rounded-full bg-muted"
        >
          <span
            className="block h-full rounded-full bg-foreground/60"
            style={{ width: `${percent}%` }}
          />
        </span>
      </TableCell>
      <TableCell className="hidden h-12 py-2 text-right tabular-nums sm:table-cell">
        {order.status === "open" ? (
          order.side === 0 ? (
            `${formatNumber(tokenAmount(order.reserved, market.quoteTokenDecimals))} ${market.quoteTokenMetadata?.symbol ?? "USDC"}${order.fundingKind === 1 ? `-${branch}` : ""}`
          ) : (
            `${formatNumber(tokenAmount(order.reserved, market.base.decimals), 4)} ${market.ticker}${order.fundingKind === 1 ? `-${branch}` : ""}`
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      {showStatus && (
        <TableCell className="hidden h-12 py-2 sm:table-cell">
          <Badge
            variant={partial ? "warning" : order.status === "open" ? "positive" : "secondary"}
            className="capitalize"
          >
            {partial ? "Partially filled" : order.status}
          </Badge>
        </TableCell>
      )}
      <TableCell className="h-12 py-2 pr-3 pl-2 text-right sm:pr-4 sm:pl-3">
        {order.status === "open" && (
          <Button
            size="xs"
            variant="outline"
            disabled={canceling !== null || pending}
            onClick={() => cancel(order.id, expired ? "expired" : closed ? "closed" : "cancel")}
          >
            {canceling === order.id && <Spinner className="animate-spin" />}
            {pending ? "Pending chain" : expired || closed ? "Release escrow" : "Cancel"}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
