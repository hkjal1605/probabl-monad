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
  /** Stock claims bought in fills and the raw quote paid for them (zero for quote claims). */
  priced: bigint;
  cost: bigint;
}

/** YES/NO rows of each market's base-token claims and quote claims, in raw token units. Positions
 * and open claim-funded (fundingKind 1) reservations are indexed once, so this is linear in the
 * markets, positions and orders rather than their product. */
export function conditionalPositionRows(
  markets: MarketView[],
  positions: PositionView[],
  orders: IndexedOrder[],
): ConditionalPositionRow[] {
  const byMarket = new Map(positions.map((position) => [position.marketId, position]));
  const reservations = new Map<string, bigint>();
  for (const order of orders)
    if (order.fundingKind === 1 && order.status === "open") {
      const key = `${order.marketId}:${order.branch}:${order.side}`;
      reservations.set(key, (reservations.get(key) ?? 0n) + BigInt(order.reserved));
    }
  const rows = (collateral: 0 | 1) =>
    markets.flatMap((market) => {
      const position = byMarket.get(market.id);
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
        const reserved = reservations.get(`${market.id}:${branch}:${collateral}`) ?? 0n;
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
          priced:
            collateral === 1
              ? BigInt((branch === 0 ? position?.pricedYes : position?.pricedNo) ?? "0")
              : 0n,
          cost:
            collateral === 1
              ? BigInt((branch === 0 ? position?.costYes : position?.costNo) ?? "0")
              : 0n,
        };
      });
    });
  return [...rows(1), ...rows(0)].filter((row) => row.total > 0n);
}
