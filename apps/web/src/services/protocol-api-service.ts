import { ApiError, requestJson } from "./api";

export { ApiError, requestJson } from "./api";

import type { ResolutionView, TradeView } from "../types/api";
export const api = {
  /** A wallet's own trades (maker or taker), newest first: its member session reads them. */
  walletTrades: (owner: string, signal?: AbortSignal) =>
    requestJson<{ trades: TradeView[] }>(`/trades?owner=${encodeURIComponent(owner)}&limit=1000`, {
      auth: true,
      ...(signal ? { signal } : {}),
    }),
  /** A trading call as the signed-in wallet: the sign-in it was reviewed under, or the current. */
  prepare: <T>(path: string, body: unknown, auth: string | true) =>
    requestJson<T>(`/v1/${path}`, { body, auth }),
  resolution: async (marketId: string, signal?: AbortSignal) => {
    try {
      return await requestJson<ResolutionView>(
        `/resolutions/${encodeURIComponent(marketId)}`,
        signal ? { signal } : {},
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  readiness: async (marketId: string, signal?: AbortSignal) => {
    const result = await requestJson<{ healthy: boolean; reason?: string; checkedAt?: number }>(
      `/v1/system/readiness?marketId=${encodeURIComponent(marketId)}`,
      signal ? { signal } : {},
    );
    if (
      typeof result?.healthy !== "boolean" ||
      (result.checkedAt !== undefined &&
        (!Number.isSafeInteger(result.checkedAt) ||
          result.checkedAt <= 0 ||
          result.checkedAt > Date.now() + 5000)) ||
      (result.reason !== undefined &&
        !["ready", "closed", "scheduled", "paused", "halted", "unavailable"].includes(
          result.reason,
        )) ||
      (result.reason !== undefined && result.healthy !== (result.reason === "ready"))
    )
      throw new Error("Invalid trading readiness response");
    return result;
  },
};
