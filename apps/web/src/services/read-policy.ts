/** Read freshness, and the server's retry hint. */
export function retryAfterMs(header: string | null, now = Date.now()) {
  if (!header) return undefined;
  const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now;
  return Number.isFinite(delay) ? Math.max(0, Math.min(60_000, delay)) : undefined;
}
export interface ReadState {
  data: unknown;
  dataUpdatedAt: number;
  isError: boolean;
  failureCount: number;
  /** The index stream keeps the data current (it is refreshed when a frame names it). */
  isStreamed?: boolean;
}
/** Whether data may be shown, and whether it may be acted on. Data the index stream keeps current
 * does not age while the stream is healthy; other data expires `maxAgeMs` after it was read.
 * `isDataCurrent` is the display test: a failed refresh does not hide data that is still young.
 * `isDataFresh` also needs the last refresh to have succeeded, as actions require. */
export function readFreshness(query: ReadState, now = Date.now(), maxAgeMs = 30_000) {
  const hasData = query.data !== undefined;
  const observedAt =
    query.data && typeof query.data === "object" && "observedAt" in query.data
      ? query.data.observedAt
      : undefined;
  // Neither the read's time nor its source's observation ages data the healthy index stream keeps
  // current: it is not read again while nothing changed (a frame naming it rereads it).
  const sourceExpired =
    !query.isStreamed &&
    observedAt !== undefined &&
    (typeof observedAt !== "number" ||
      !Number.isSafeInteger(observedAt) ||
      observedAt <= 0 ||
      observedAt > now + 5000 ||
      now - observedAt > maxAgeMs);
  const expired =
    hasData &&
    (sourceExpired ||
      (!query.isStreamed &&
        (query.dataUpdatedAt <= 0 ||
          now < query.dataUpdatedAt ||
          now - query.dataUpdatedAt > maxAgeMs)));
  return {
    isInitialError: query.isError && !hasData,
    isRefreshError: hasData && (query.isError || query.failureCount > 0 || expired),
    isDataCurrent: hasData && !expired,
    isDataFresh: hasData && !query.isError && query.failureCount === 0 && !expired,
  };
}
/** When `readFreshness` next changes on its own (data expiring), or null if it won't. */
export function freshnessExpiry(query: ReadState, maxAgeMs = 30_000): number | null {
  if (query.data === undefined) return null;
  const observedAt =
    query.data && typeof query.data === "object" && "observedAt" in query.data
      ? query.data.observedAt
      : undefined;
  const times = [
    typeof observedAt === "number" && !query.isStreamed ? observedAt + maxAgeMs : null,
    query.isStreamed || query.dataUpdatedAt <= 0 ? null : query.dataUpdatedAt + maxAgeMs,
  ].filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}
