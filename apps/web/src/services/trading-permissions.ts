import { requestJson } from "./api";

export interface TradingPermission {
  owner: string;
  available: boolean;
  delegate: string | null;
  active: boolean;
  block: string;
  quoteToken: string;
  quoteDecimals: number | null;
  /** Decimals that share limits are expressed in (the listed stocks'); null before any listing. */
  baseDecimals: number | null;
  grant: null | {
    market: string;
    expiresAt: string;
    maxOrderQuote: string;
    remainingQuote: string;
    /** Sell limits, in raw base units. */
    maxOrderBase: string;
    remainingBase: string;
    maxFeeBps: number;
    permissions: number;
    revoked: boolean;
    /** Re-approval increments it and invalidates orders placed under older approvals. */
    generation: number;
  };
}
export function fetchTradingPermission(owner: string, signal?: AbortSignal) {
  return requestJson<TradingPermission>(
    `/v1/trading/permission?owner=${encodeURIComponent(owner)}`,
    { auth: true, ...(signal ? { signal } : {}) },
  );
}
