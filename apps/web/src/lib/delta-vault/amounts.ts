/** Amount arithmetic of Δ-vault deposits and withdrawals. Transaction bounds come from on-chain
 * previews; these helpers only apply the user's slippage tolerance and format what a share
 * holds. Display numbers are approximate; bounds are exact integers. */
import { formatTokenAmount } from "@conditional-stocks/domain";

export const DEFAULT_SLIPPAGE_BPS = 50n;
const BPS = 10_000n;
const WAD = 10n ** 18n;

/** Budgets and minimum shares of a deposit previewed at `quoteIn`/`baseIn` for `shares`. The
 * budgets are the previewed amounts, so the vault can never take more than was shown. */
export function depositBounds(
  preview: { shares: bigint; quoteIn: bigint; baseIn: bigint },
  slippageBps = DEFAULT_SLIPPAGE_BPS,
) {
  if (preview.shares <= 0n) throw new Error("The amount is too small for one vault share.");
  return {
    maxQuote: preview.quoteIn,
    maxBase: preview.baseIn,
    minShares: (preview.shares * (BPS - slippageBps)) / BPS,
  };
}

/** Minimum tokens a withdrawal previewed at `quoteOut`/`baseOut` may pay. */
export const withdrawBounds = (
  preview: { quoteOut: bigint; baseOut: bigint },
  slippageBps = DEFAULT_SLIPPAGE_BPS,
) => ({
  minQuote: (preview.quoteOut * (BPS - slippageBps)) / BPS,
  minBase: (preview.baseOut * (BPS - slippageBps)) / BPS,
});

/** Raw units behind one whole share (1e18 share units). */
export const perShare = (amount: bigint, supply: bigint) =>
  supply === 0n ? 0n : (amount * WAD) / supply;

/** Shares for a percentage of a balance; 100% is the whole balance, never more. */
export const sharesFor = (balance: bigint, percent: number) =>
  percent >= 100 ? balance : (balance * BigInt(Math.max(0, Math.round(percent * 100)))) / BPS;

/** Share of a deposit cap in use (0–100), or null without a cap. */
export function capacityPercent(held: bigint, cap: bigint) {
  if (cap === 0n) return null;
  const used = Number((held * 10_000n) / cap) / 100;
  return Math.min(100, used);
}

/** Exact token amount with at most `digits` fractional digits (truncated). */
export function tokenText(raw: bigint, decimals: number, digits = 4) {
  const [whole, fraction = ""] = formatTokenAmount(raw, decimals).split(".");
  const kept = fraction.slice(0, digits).replace(/0+$/, "");
  return kept ? `${whole}.${kept}` : (whole ?? "0");
}
