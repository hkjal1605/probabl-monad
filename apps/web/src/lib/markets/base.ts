import type { MarketView, PositionView } from "@/types/api";

/** Why new exposure to the market's base token is halted, or null when it is tradable. */
export const baseHalt = (market: Pick<MarketView, "base">) =>
  market.base.live.tradable ? null : "The issuer has paused this token; trading is halted.";

/** Claims of one market: collateral 0 quote, 1 base token; branch 0 YES, 1 NO. */
export function claimBalance(
  position: PositionView | undefined,
  collateral: 0 | 1,
  branch: 0 | 1,
): bigint {
  if (!position) return 0n;
  const value =
    collateral === 0
      ? branch === 0
        ? position.quoteYes
        : position.quoteNo
      : branch === 0
        ? position.baseYes
        : position.baseNo;
  return BigInt(value);
}

/** Largest step-aligned base quantity within `raw` units. */
export const stepQuantity = (raw: bigint, step: bigint) =>
  raw > 0n && step > 0n ? (raw / step) * step : 0n;
