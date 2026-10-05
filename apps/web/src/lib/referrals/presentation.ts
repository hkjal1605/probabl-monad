import { spotUsdValue, tokenPriceUsd } from "@conditional-stocks/shared/spot-prices";
import { shortAddress, tokenAmount } from "@/lib/format/display";
import type { RewardMarketView, TokenAmountView } from "@/services/referrals-api-service";
import type { MarketView } from "@/types/api";

/** USD per whole token from the markets' spot references, for display estimates only. The quote
 * stablecoin counts as $1 when it has no reference, as everywhere in the app. */
export function tokenPrices(markets: MarketView[], now = Date.now()) {
  const prices = new Map<string, number>();
  for (const m of markets) {
    prices.set(m.quoteToken.toLowerCase(), spotUsdValue(m.quoteSpotReference, now) ?? 1);
    const base = tokenPriceUsd(m.spotReference, 1, now);
    if (base !== null) prices.set(m.base.token.toLowerCase(), base);
  }
  return prices;
}
export const tokenValue = (a: TokenAmountView) =>
  a.decimals === null ? null : tokenAmount(a.amount, a.decimals);
export function amountUsd(a: TokenAmountView, prices: Map<string, number>) {
  const price = prices.get(a.token.toLowerCase()),
    value = tokenValue(a);
  return price === undefined || value === null ? null : value * price;
}
/** The amounts' sum in USD, or null when any token has no price. */
export function totalUsd(amounts: TokenAmountView[], prices: Map<string, number>) {
  let total = 0;
  for (const a of amounts) {
    const usd = amountUsd(a, prices);
    if (usd === null) return null;
    total += usd;
  }
  return total;
}
/** What an open market's claims are expected to pay: each side weighted by its probability. */
export function expectedUsd(market: RewardMarketView, prices: Map<string, number>) {
  if (market.probabilityYesX6 === null) return null;
  const yes = Math.min(1, Math.max(0, Number(market.probabilityYesX6) / 1e6));
  let total = 0;
  for (const a of market.accrued) {
    const usd = amountUsd(a, prices);
    if (usd === null) return null;
    total += usd * (a.branch === 0 ? yes : 1 - yes);
  }
  return total;
}
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const small = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });
/** "0.03 USDC", "0.0005 NVDA": small amounts keep their significant digits. */
export function formatAmount(a: TokenAmountView) {
  const value = tokenValue(a);
  const symbol = a.symbol ?? shortAddress(a.token);
  if (value === null) return `${a.amount} ${symbol} (raw)`;
  return `${value === 0 || value >= 1 ? whole.format(value) : small.format(value)} ${symbol}`;
}
/** Adds amounts of the same token. */
export function sumByToken(amounts: TokenAmountView[]) {
  const sums = new Map<string, TokenAmountView>();
  for (const a of amounts) {
    const key = a.token.toLowerCase();
    const prior = sums.get(key);
    sums.set(
      key,
      prior ? { ...prior, amount: (BigInt(prior.amount) + BigInt(a.amount)).toString() } : a,
    );
  }
  return [...sums.values()];
}
/** "Mon, Oct 12 · 00:00 UTC". */
export const unlockDate = (seconds: number) =>
  `${new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(seconds * 1000))} · 00:00 UTC`;
/** "in 3 days", "in 5 hours", "in 12 minutes", "now". */
export function unlockIn(seconds: number, now = Date.now()) {
  const ms = seconds * 1000 - now;
  if (ms <= 0) return "now";
  const days = Math.floor(ms / 86_400_000),
    hours = Math.floor(ms / 3_600_000),
    minutes = Math.max(1, Math.ceil(ms / 60_000));
  return days >= 1
    ? `in ${days} ${days === 1 ? "day" : "days"}`
    : hours >= 1
      ? `in ${hours} ${hours === 1 ? "hour" : "hours"}`
      : `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}
export const STATUS_LABEL: Record<RewardMarketView["status"], string> = {
  pending: "Market open",
  unlocking: "Unlocking",
  claimable: "Unlocked",
  lapsed: "Lapsed",
};
