import { displayPrice, shareAmount, tokenAmount } from "@/lib/format/display";
import type { IndexedOrder, MarketView, TradeView } from "@/types/api";

export interface WalletTradeRow {
  market: MarketView;
  order: IndexedOrder;
  side: "Buy" | "Sell" | "Self-match";
  trade: TradeView;
}

export function walletTradeRows(
  trades: TradeView[],
  orders: IndexedOrder[],
  markets: MarketView[],
): WalletTradeRow[] {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const marketById = new Map(markets.map((market) => [market.id, market]));
  return trades.flatMap((trade) => {
    const maker = trade.makerOrderHash ? orderById.get(trade.makerOrderHash) : undefined;
    const taker = trade.takerOrderHash ? orderById.get(trade.takerOrderHash) : undefined;
    const order = taker ?? maker;
    const market = marketById.get(trade.marketId);
    if (!order || !market) return [];
    return [
      {
        market,
        order,
        side: maker && taker ? "Self-match" : order.side === 0 ? "Buy" : "Sell",
        trade,
      },
    ];
  });
}

/** What a fill cost the member in fees, net of a maker's rebate, approximately in quote units: a
 * buyer's fee is taken in the claims bought (valued at the fill price), a seller's in quote claims,
 * and a maker's rebate comes in the claims the taker paid with. Null when the fees weren't
 * indexed. */
export function memberTradeFee({ market, order, side, trade }: WalletTradeRow): number | null {
  if (trade.buyerFee === undefined || trade.sellerFee === undefined) return null;
  const price = displayPrice(trade.executionPriceRawX18, market);
  const taker = side === "Self-match" || trade.takerOrderHash === order.id;
  const maker = side === "Self-match" || !taker;
  const takerBuys = (trade.takerSide ?? (taker ? order.side : 1 - order.side)) === 0;
  const buyerFee = shareAmount(trade.buyerFee, market) * price;
  const sellerFee = tokenAmount(trade.sellerFee, market.quoteTokenDecimals);
  const rebate = trade.makerRebate
    ? takerBuys
      ? shareAmount(trade.makerRebate, market) * price
      : tokenAmount(trade.makerRebate, market.quoteTokenDecimals)
    : 0;
  return (
    (taker ? (takerBuys ? buyerFee : sellerFee) : 0) +
    (maker ? (takerBuys ? sellerFee : buyerFee) - rebate : 0)
  );
}

export function wholeReserved(token: string, orders: IndexedOrder[], markets: MarketView[]) {
  const byId = new Map(markets.map((m) => [m.id, m]));
  return orders.reduce((total, order) => {
    if (order.status !== "open" || order.fundingKind !== 0) return total;
    const market = byId.get(order.marketId);
    if (!market) return total;
    const fundingToken = order.side === 0 ? market.quoteToken : market.base.token;
    return fundingToken === token ? total + BigInt(order.reserved) : total;
  }, 0n);
}
