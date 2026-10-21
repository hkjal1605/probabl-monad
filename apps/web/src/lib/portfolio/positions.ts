import type { IndexedOrder, MarketView, PositionView, TradeView } from "@/types/api";

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
        };
      });
    });
  return [...rows(1), ...rows(0)].filter((row) => row.total > 0n);
}

const WAD = 10n ** 18n;

export interface EntryBasis {
  /** Average quote paid per stock claim, raw quote units per raw base unit x 1e18 (the exchange's
   * price format). */
  priceRawX18: bigint;
  /** Raw stock claims the average covers: those bought in fills and still held. */
  shares: bigint;
}

/** The average entry of `owner`'s stock claims on one market branch, from its own fills: quote
 * paid (less maker rebates) per claim received (less fees), by the average-cost method. A sell of
 * held claims takes its share of the cost out and keeps the average; a sell funded with whole
 * tokens leaves this branch's claims alone. Claims that came from no fill (a split, a transfer, or
 * fills older than the trade history read) are not covered: callers compare `shares` with the
 * position. Null without a held, bought claim. */
export function entryBasis(
  trades: readonly TradeView[],
  orders: readonly IndexedOrder[],
  owner: string,
  marketId: string,
  branch: 0 | 1,
): EntryBasis | null {
  const me = owner.toLowerCase();
  const funding = new Map(orders.map((order) => [order.id, order.fundingKind]));
  const fills = trades
    .filter(
      (t) =>
        t.marketId === marketId &&
        t.branch === branch &&
        (t.maker?.toLowerCase() === me || t.taker?.toLowerCase() === me),
    )
    .sort(
      (a, b) =>
        Date.parse(a.blockTimestamp) - Date.parse(b.blockTimestamp) ||
        Number(a.id.split(":")[1] ?? 0) - Number(b.id.split(":")[1] ?? 0),
    );
  let shares = 0n,
    cost = 0n;
  for (const t of fills) {
    const quantity = BigInt(t.fillQuantity);
    const quote =
      t.executionQuote !== undefined
        ? BigInt(t.executionQuote)
        : (quantity * BigInt(t.executionPriceRawX18)) / WAD;
    const asTaker = t.taker?.toLowerCase() === me,
      takerBuys = t.takerSide === 0;
    const buys = asTaker ? takerBuys : !takerBuys;
    // A maker's rebate comes in the claims the taker paid its fee in.
    const rebate = asTaker ? 0n : BigInt(t.makerRebate ?? "0");
    if (buys) {
      shares += quantity - BigInt(t.buyerFee ?? "0");
      cost += quote - (takerBuys ? 0n : rebate);
      continue;
    }
    if (takerBuys) shares += rebate;
    if (funding.get((asTaker ? t.takerOrderHash : t.makerOrderHash) ?? "") === 0) continue;
    const sold = quantity < shares ? quantity : shares;
    if (shares > 0n) cost -= (cost * sold) / shares;
    shares -= sold;
  }
  return shares > 0n && cost > 0n ? { priceRawX18: (cost * WAD) / shares, shares } : null;
}
