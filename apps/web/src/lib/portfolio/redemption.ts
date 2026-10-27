import { planRedemption, type RedemptionPlan } from "@conditional-stocks/evm-client";
import { formatNumber, tokenAmount } from "@/lib/format/display";
import { claimBalance } from "@/lib/markets/base";
import { currentSpotUsd } from "@/lib/markets/presentation";
import type { MarketView, PositionView } from "@/types/api";

/** One kind of claim (stock or cash) a redemption pays out: what it burns and what it pays. */
export interface RedemptionLine {
  /** 0 cash (quote) claims, 1 stock (base-token) claims. */
  collateral: 0 | 1;
  symbol: string;
  decimals: number;
  yes: bigint;
  no: bigint;
  plan: RedemptionPlan;
}

/** Whether the market's claims can be redeemed now: resolved on chain, with its payout known. */
export const canRedeem = (market: MarketView) =>
  (market.lifecycle === "redeemable" || market.lifecycle === "archived") && !!market.payouts;

/** The market's result: YES, NO or INVALID (every claim pays half); null until it is known. */
export function resolvedOutcome(market: MarketView): "YES" | "NO" | "INVALID" | null {
  const [yes = 0, no = 0] = market.payouts ?? [];
  if (yes > 0 && no > 0) return "INVALID";
  return yes > 0 ? "YES" : no > 0 ? "NO" : null;
}

const symbolOf = (market: MarketView, collateral: 0 | 1) =>
  collateral === 1 ? market.base.symbol : (market.quoteTokenMetadata?.symbol ?? "USDC");

/** What redeeming pays, stock claims first: only the kinds that pay something. Losing claims
 * pay nothing and need no transaction, and under INVALID a lone raw unit (half a unit's payout)
 * cannot be paid. null while the payout is unknown. */
export function redemptionLines(market: MarketView, position: PositionView) {
  if (!market.payouts) return null;
  try {
    return ([1, 0] as const).flatMap((collateral): RedemptionLine[] => {
      const yes = claimBalance(position, collateral, 0),
        no = claimBalance(position, collateral, 1);
      if (yes + no === 0n) return [];
      const plan = planRedemption(yes, no, market.payouts ?? []);
      if (plan.credit === 0n) return [];
      const decimals = collateral === 1 ? position.baseTokenDecimals : position.quoteTokenDecimals;
      return [{ collateral, symbol: symbolOf(market, collateral), decimals, yes, no, plan }];
    });
  } catch {
    return null;
  }
}

/** The claims the result made worthless, e.g. "1.82 USDG-NO". */
export function losingClaims(market: MarketView, position: PositionView) {
  const [yesPays = 0, noPays = 0] = market.payouts ?? [];
  return ([1, 0] as const).flatMap((collateral) =>
    ([0, 1] as const).flatMap((branch) => {
      const held = claimBalance(position, collateral, branch);
      if (held === 0n || (branch === 0 ? yesPays : noPays) > 0) return [];
      return [`${claimAmount(market, collateral, held)}-${branch === 0 ? "YES" : "NO"}`];
    }),
  );
}

/** An amount of claims or their payout, as the claim lists show it: stock to 4 places, cash 2. */
export function claimAmount(market: MarketView, collateral: 0 | 1, raw: bigint) {
  const decimals = collateral === 1 ? market.base.decimals : market.quoteTokenDecimals;
  return `${formatNumber(tokenAmount(raw.toString(), decimals), collateral === 1 ? 4 : 2)} ${symbolOf(market, collateral)}`;
}

/** A redemption's payout in USD (cash at $1, stock at its spot); null when a stock has no spot. */
export function redemptionUsd(market: MarketView, lines: RedemptionLine[]) {
  let total = 0;
  for (const line of lines) {
    const price = line.collateral === 0 ? 1 : currentSpotUsd(market);
    if (price === null) return null;
    total += tokenAmount(line.plan.credit.toString(), line.decimals) * price;
  }
  return total;
}

/** Whether a position has claims to list: once its market can be redeemed, only claims that pay
 * something, so a market whose claims all lost leaves the list without a transaction. */
export function holdsClaims(position: PositionView, market: MarketView | undefined) {
  const held = ([0, 1] as const).some(
    (collateral) =>
      claimBalance(position, collateral, 0) > 0n || claimBalance(position, collateral, 1) > 0n,
  );
  if (!held) return false;
  if (!market || !canRedeem(market)) return true;
  const lines = redemptionLines(market, position);
  return lines === null || lines.length > 0;
}
