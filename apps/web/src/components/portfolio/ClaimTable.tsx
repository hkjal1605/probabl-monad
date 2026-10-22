"use client";
import {
  EmptyCurrentGroup,
  GROUP_BODY,
  MarketGroupHeader,
} from "@/components/portfolio/MarketGroup";
import { useWallet } from "@/components/providers/WalletProvider";
import { DataError, EmptyState, LoadingState } from "@/components/ui/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePositions } from "@/hooks/useProtocolData";
import { formatNumber, tokenAmount } from "@/lib/format/display";
import { midpoint } from "@/lib/markets/presentation";
import { groupByMarket } from "@/lib/portfolio/positions";
import { PositionActions } from "@/modules/PortfolioPageModule/components/PositionActions";
import { positionHasClaims } from "@/services/index-stream";
import type { MarketView, PositionView } from "@/types/api";

const COLUMNS = 4;

/** The member's conditional claims grouped by market (`currentMarketId`'s first, then the largest),
 * a row per claimed token with its YES and NO amounts, to split, merge or redeem. */
export function ClaimTable({
  markets,
  currentMarketId,
  showTitles = true,
}: {
  markets: MarketView[];
  currentMarketId?: string;
  /** Each market's question in its header row (a card already titled by it can leave it out). */
  showTitles?: boolean;
}) {
  const wallet = useWallet(),
    query = usePositions();
  if (!wallet.account) return <EmptyState>Connect your wallet to see claims.</EmptyState>;
  if (query.isInitialError)
    return (
      <DataError
        retry={() => {
          void query.refetch();
        }}
        message="Claim balances are unavailable."
      />
    );
  if (query.isPending) return <LoadingState />;
  const byId = new Map(markets.map((market) => [market.id, market]));
  const groups = groupByMarket(
    query.positions.filter(positionHasClaims),
    (position) => byId.get(position.marketId),
    currentMarketId,
    ([position]) => (position ? claimValue(position, byId.get(position.marketId)) : 0),
  );
  const current = currentMarketId ? byId.get(currentMarketId) : undefined;
  if (!groups.length)
    return (
      <EmptyState>
        No claims yet. Buying a market&apos;s YES or NO, or splitting tokens, gives you claims.
      </EmptyState>
    );
  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-card">
        <TableRow>
          <TableHead className="pl-3 sm:pl-4">Claim</TableHead>
          <TableHead className="px-2 text-right text-positive sm:px-3">YES</TableHead>
          <TableHead className="px-2 text-right text-danger sm:px-3">NO</TableHead>
          <TableHead>
            <span className="sr-only">Manage claims</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      {current && groups[0]?.market.id !== current.id && (
        <EmptyCurrentGroup market={current} columns={COLUMNS}>
          No claims in this market.
        </EmptyCurrentGroup>
      )}
      {groups.map(({ market, items: [position] }) =>
        position ? (
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
            {claimLines(market, position).map((line) => (
              <TableRow key={line.collateral} className="h-12">
                <TableCell className="h-12 py-2 pr-2 pl-3 sm:pr-3 sm:pl-4">
                  <span className="font-medium">{line.symbol}</span>
                  <p className="text-xs text-muted-foreground">
                    {line.collateral === 0 ? "Cash claims" : "Stock claims"}
                  </p>
                </TableCell>
                {[line.yes, line.no].map((amount, branch) => (
                  <TableCell
                    // biome-ignore lint/suspicious/noArrayIndexKey: The two branches, always in this order.
                    key={branch}
                    className={`h-12 px-2 py-2 text-right tabular-nums sm:px-3 ${BigInt(amount) === 0n ? "text-muted-foreground" : ""}`}
                  >
                    {formatNumber(
                      tokenAmount(amount, line.decimals),
                      line.collateral === 0 ? 2 : 4,
                    )}
                  </TableCell>
                ))}
                <TableCell className="h-12 py-2 pr-3 pl-2 text-right sm:pr-4 sm:pl-3">
                  <PositionActions
                    position={position}
                    market={market}
                    collateral={line.collateral}
                    disabled={!query.isDataFresh}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ) : null,
      )}
    </Table>
  );
}

/** A position's claims at their book midpoints and cash claims at par, to rank markets. */
function claimValue(position: PositionView, market: MarketView | undefined) {
  if (!market) return 0;
  const base = (amount: string, mark: number | null) =>
    tokenAmount(amount, position.baseTokenDecimals) * (mark ?? 0);
  return (
    tokenAmount(position.quoteYes, position.quoteTokenDecimals) +
    tokenAmount(position.quoteNo, position.quoteTokenDecimals) +
    base(position.baseYes, midpoint(market.yes)) +
    base(position.baseNo, midpoint(market.no))
  );
}

/** Quote claims and base-token claims, in raw token units. */
export function claimLines(market: MarketView, position: PositionView, includeEmpty = false) {
  const lines = [
    {
      collateral: 1 as const,
      symbol: market.base.symbol,
      decimals: position.baseTokenDecimals,
      yes: position.baseYes,
      no: position.baseNo,
    },
    {
      collateral: 0 as const,
      symbol: market.quoteTokenMetadata?.symbol ?? "USDC",
      decimals: position.quoteTokenDecimals,
      yes: position.quoteYes,
      no: position.quoteNo,
    },
  ];
  return includeEmpty
    ? lines
    : lines.filter((line) => BigInt(line.yes) > 0n || BigInt(line.no) > 0n);
}
