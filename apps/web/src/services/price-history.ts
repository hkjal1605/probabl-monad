import { requestJson } from "./api";

/** One recorded minute of a market: book midpoints (raw quote per raw base x 1e18) and the
 * stock's USD reference price per whole token; null where none was current. */
export interface PriceHistoryPoint {
  /** Unix seconds. */
  time: number;
  yes: string | null;
  no: string | null;
  spot: number | null;
}
export interface PriceHistory {
  marketId: string;
  range: "1d" | "1w" | "1m" | "all";
  /** Seconds each point stands for (its last record). */
  interval: number;
  points: PriceHistoryPoint[];
}

export type PriceHistoryRange = PriceHistory["range"];

/** A market's (public id) recorded prices over `range` (the last day, week, month or all of
 * them), at most 360 points. */
export const getPriceHistory = (marketId: string, range: PriceHistoryRange, signal?: AbortSignal) =>
  requestJson<PriceHistory>(
    `/v1/markets/${encodeURIComponent(marketId)}/price-history?range=${range}`,
    signal ? { signal } : {},
  );
