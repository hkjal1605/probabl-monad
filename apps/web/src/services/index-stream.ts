import { SHARE_PROTOCOL_VERSION, tokenDecimals } from "@conditional-stocks/domain";
import type { PositionView, WholeBalanceView } from "../types/api";

const address = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
/** Public market ids: 16 hex digits. */
const marketId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{16}$/.test(v);
const onchainId = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,9}$/.test(v);
const venue = (v: any) =>
  !!v &&
  Number.isSafeInteger(v.chainId) &&
  v.chainId > 0 &&
  address(v.exchange) &&
  onchainId(v.marketId);
const amount = (v: unknown, bits = 256) =>
  typeof v === "string" && /^(0|[1-9][0-9]{0,39})$/.test(v) && BigInt(v) < 1n << BigInt(bits);
export interface StreamWallet {
  owner: string;
  observedAt: number;
  blockNumber: string;
  positions: PositionView[];
  balances: Record<string, WholeBalanceView>;
}
export function parseStreamWallet(value: any, owner: string): StreamWallet {
  if (
    !value ||
    value.owner !== owner ||
    !Number.isSafeInteger(value.observedAt) ||
    value.observedAt > Date.now() + 5000 ||
    Date.now() - value.observedAt > 30_000 ||
    !amount(value.blockNumber, 64) ||
    !Array.isArray(value.positions) ||
    !value.balances ||
    typeof value.balances !== "object"
  )
    throw new Error("Invalid streamed wallet");
  const balances: Record<string, WholeBalanceView> = {};
  for (const [token, balance] of Object.entries(value.balances) as [string, any][]) {
    if (
      !address(token) ||
      balance?.account !== owner ||
      balance.token !== token ||
      !Number.isInteger(balance.decimals) ||
      balance.decimals < 0 ||
      balance.decimals > 36 ||
      !amount(balance.canonicalBalance) ||
      !amount(balance.vaultAvailable) ||
      !amount(balance.reserved) ||
      !amount(balance.blockNumber, 64)
    )
      throw new Error("Invalid streamed balance");
    balances[token] = balance;
  }
  for (const p of value.positions) parsePosition(p);
  return { ...value, balances };
}
/** Claims of one market: quote and base-token claims per branch, in raw token units. */
export function parsePosition(p: any): PositionView {
  if (
    !p ||
    !marketId(p.marketId) ||
    !venue(p.venue) ||
    p.conditionId !== p.venue.marketId ||
    typeof p.redeemable !== "boolean" ||
    p.protocolVersion !== SHARE_PROTOCOL_VERSION ||
    !address(p.baseToken) ||
    p.baseTokenDecimals !== p.shareDecimals ||
    [p.quoteYes, p.quoteNo, p.baseYes, p.baseNo].some((n) => !amount(n, 96))
  )
    throw new Error("Invalid streamed position");
  tokenDecimals(p.shareDecimals);
  tokenDecimals(p.quoteTokenDecimals);
  return p as PositionView;
}
export const positionHasClaims = (p: PositionView) =>
  [p.quoteYes, p.quoteNo, p.baseYes, p.baseNo].some((value) => BigInt(value) > 0n);
/** Resources the index stream keeps current: it refreshes them when a frame names them, so they
 * neither poll nor age while the stream is healthy. */
export const STREAMED_RESOURCES: ReadonlySet<string> = new Set([
  "markets",
  "wallet-orders",
  "wallet-trades",
  "trades",
  "positions",
  "whole-balances",
  "trading-readiness",
  "payout-credits",
  "resolution",
]);

/** Streamed resources that still change without a frame naming them, and how often they are read
 * anyway while the stream is healthy: a wallet's token balances outside the exchange move with
 * transfers and mints the index never sees. */
export const STREAM_BACKSTOP_MS: Readonly<Record<string, number>> = { positions: 30_000 };

// The stream's health, as a store that notifies only when it flips (a frame extends it; it lapses
// on its own when frames stop), so subscribers don't re-render per frame.
let healthyUntil = 0,
  healthy = false,
  lapse: ReturnType<typeof setTimeout> | undefined;
const healthListeners = new Set<() => void>();
const setHealth = (next: boolean) => {
  if (next === healthy) return;
  healthy = next;
  for (const listener of healthListeners) listener();
};
export const setIndexStreamHealthy = (until: number) => {
  healthyUntil = until;
  clearTimeout(lapse);
  const left = until - Date.now();
  if (left > 0) lapse = setTimeout(() => setHealth(false), left);
  setHealth(left > 0);
};
export const indexStreamHealthy = () => Date.now() < healthyUntil;
/** For `useSyncExternalStore`: the stream's health, notified on each change. */
export const subscribeIndexHealth = (listener: () => void) => {
  healthListeners.add(listener);
  return () => {
    healthListeners.delete(listener);
  };
};
export const indexHealthSnapshot = () => healthy;
export const indexHealthServerSnapshot = () => false;

export function parseIndexUpdate(raw: string) {
  const value = JSON.parse(raw);
  if (
    !amount(value.block, 64) ||
    !Number.isSafeInteger(value.observedAt) ||
    value.observedAt > Date.now() + 5000 ||
    Date.now() - value.observedAt > 15_000 ||
    !Array.isArray(value.markets) ||
    !Array.isArray(value.owners) ||
    value.markets.some((id: unknown) => !marketId(id)) ||
    value.owners.some((owner: unknown) => !address(owner))
  )
    throw new Error("Invalid index stream update");
  const readiness = value.readiness ?? {};
  if (
    typeof readiness !== "object" ||
    readiness === null ||
    Object.entries(readiness).some(
      ([id, v]: [string, any]) =>
        !marketId(id) ||
        !v ||
        !["ready", "scheduled", "closed", "paused"].includes(v.reason) ||
        v.healthy !== (v.reason === "ready") ||
        !Number.isSafeInteger(v.checkedAt),
    )
  )
    throw new Error("Invalid streamed readiness");
  return { ...value, readiness } as {
    block: string;
    observedAt: number;
    markets: string[];
    owners: string[];
    wallet?: unknown;
    readiness: Record<string, unknown>;
  };
}
