import type { WalletAssetBalance } from "@/hooks/useWalletAssets";
import { tokenAmount } from "@/lib/format/display";
import { currentSpotUsd, isResolved, midpoint } from "@/lib/markets/presentation";
import { type ConditionalPositionRow, conditionalPositionRows } from "@/lib/portfolio/positions";
import type { IndexedOrder, MarketView, PositionView } from "@/types/api";

/** The chance a market's branch pays: its share of the payout once the market resolved, else
 * the event's probability (YES) or its complement (NO); null when neither is known. */
export function branchWeight(market: MarketView, branch: 0 | 1): number | null {
  if (isResolved(market)) {
    const parts = market.payouts;
    const total = parts ? parts[0] + parts[1] : 0;
    return parts && total > 0 ? parts[branch] / total : null;
  }
  const p = market.probability.value;
  if (p === null || !Number.isFinite(p) || p < 0 || p > 1) return null;
  return branch === 0 ? p : 1 - p;
}

/** What a whole claimed token pays out in its branch, in USD: a cash claim $1; a stock claim its
 * branch's price (the book with the vaults' quotes folded in), or the stock's spot when nothing
 * prices the branch or the market resolved (its claims then redeem into the stock itself). */
function claimPayout(row: ConditionalPositionRow): number | null {
  if (row.kind === "quote") return 1;
  const mark = isResolved(row.market)
    ? null
    : midpoint(row.branch === 0 ? row.market.yes : row.market.no);
  return mark ?? currentSpotUsd(row.market);
}

/** Display-only USD estimate of an account: its vault balances (available and reserved by open
 * orders) at their reference prices, plus each conditional claim at the chance its branch pays
 * times what it pays there. Weighting both branches keeps a YES and a NO claim on the same asset
 * worth that asset, as split and merge make them, so a trade at fair prices leaves the total
 * where it was. Quote assets count as $1. null while a holding cannot be valued. */
export function portfolioValue(
  markets: MarketView[],
  balances: WalletAssetBalance[],
  positions: PositionView[],
  orders: IndexedOrder[],
): number | null {
  const quoteTokens = new Set(markets.map((market) => market.quoteToken));
  let total = 0;
  for (const asset of balances) {
    const held =
      tokenAmount(asset.balance.vaultAvailable, asset.decimals) +
      tokenAmount(asset.balance.reserved, asset.decimals);
    const reference = quoteTokens.has(asset.token) ? 1 : asset.reference;
    if (held === 0) continue;
    if (reference === null) return null;
    total += held * reference;
  }
  for (const row of conditionalPositionRows(markets, positions, orders)) {
    const weight = branchWeight(row.market, row.branch);
    // A losing claim pays nothing, whatever its asset's price.
    if (weight === 0) continue;
    const payout = claimPayout(row);
    if (weight === null || payout === null || !Number.isFinite(payout) || payout < 0) return null;
    // Claims are raw token units; prices are per whole token.
    total += tokenAmount(row.total.toString(), row.decimals) * weight * payout;
  }
  return total;
}
