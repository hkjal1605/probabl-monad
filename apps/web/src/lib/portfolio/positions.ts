import type { IndexedOrder, MarketView, PositionView } from "@/types/api";

export interface ConditionalPositionRow {
  available: bigint;
  branch: 0 | 1;
  /** 0 = quote claims, 1 = base-token claims. */
  collateral: 0 | 1;
  /** Raw decimals of the claimed token. */
  decimals: number;
  key: string;
  kind: "quote" | "stock";
  market: MarketView;
  reserved: bigint;
  symbol: string;
  total: bigint;
}

/** Open claim-funded (fundingKind 1) reservations of one market, branch and collateral. */
const reservedClaims = (
  orders: IndexedOrder[],
  marketId: string,
  branch: 0 | 1,
  collateral: 0 | 1,
) =>
  orders
    .filter(
      (order) =>
        order.marketId === marketId &&
        order.branch === branch &&
        order.fundingKind === 1 &&
        order.status === "open" &&
        order.side === collateral,
    )
    .reduce((sum, order) => sum + BigInt(order.reserved), 0n);

/** YES/NO rows of each market's base-token claims and quote claims, in raw token units. */
export function conditionalPositionRows(
  markets: MarketView[],
  positions: PositionView[],
  orders: IndexedOrder[],
): ConditionalPositionRow[] {
  const rows = (collateral: 0 | 1) =>
    markets.flatMap((market) => {
      const position = positions.find((item) => item.marketId === market.id);
      return ([0, 1] as const).map((branch) => {
        const held =
          collateral === 0
            ? branch === 0
              ? position?.quoteYes
              : position?.quoteNo
            : branch === 0
              ? position?.baseYes
              : position?.baseNo;
        const available = BigInt(held ?? "0");
        const reserved = reservedClaims(orders, market.id, branch, collateral);
        return {
          available,
          branch,
          collateral,
          decimals: collateral === 0 ? market.quoteTokenDecimals : market.base.decimals,
          key: `${collateral === 0 ? "quote" : "stock"}-${market.id}-${branch}`,
          kind: collateral === 0 ? ("quote" as const) : ("stock" as const),
          market,
          reserved,
          symbol: collateral === 0 ? (market.quoteTokenMetadata?.symbol ?? "USDC") : market.ticker,
          total: available + reserved,
        };
      });
    });
  return [...rows(1), ...rows(0)].filter((row) => row.total > 0n);
}
