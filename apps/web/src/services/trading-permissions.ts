import { requestJson } from "./api";

export interface TradingPermission {
  owner: string;
  available: boolean;
  delegate: string | null;
  active: boolean;
  block: string;
  quoteToken: string;
  quoteDecimals: number | null;
  grant: null | {
    market: string;
    expiresAt: string;
    maxOrderQuote: string;
    remainingQuote: string;
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
    signal ? { signal } : {},
  );
}
