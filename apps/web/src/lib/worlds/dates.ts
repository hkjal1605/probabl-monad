/** The days a world's stock can be read on, as New York calendar dates (YYYY-MM-DD). */

const DAY = 86_400_000;

/** The New York calendar date of an instant. */
export const nyDate = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));

/** The first weekday on or after a date (or, back, the last on or before it). */
export function weekdayFrom(date: string, back = false) {
  const d = new Date(`${date}T12:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + (back ? -1 : 1));
  return d.toISOString().slice(0, 10);
}

/** The same day a month later ("2026-01-31" → "2026-02-28"). */
export function monthAhead(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/** The range of a world's date picker: from tomorrow to the vault's tenor less a day (to open
 * and fill the world), and the day after the last event is decided (inside the range). */
export function worldDates(
  legEnds: readonly string[],
  maxTenorSeconds: number | null,
  nowMs = Date.now(),
) {
  const last = weekdayFrom(nyDate(nowMs + ((maxTenorSeconds ?? 35 * 86_400) * 1000 - DAY)), true);
  const lastEnd = legEnds.length ? Math.max(...legEnds.map((e) => Date.parse(e))) : null;
  const after = lastEnd === null ? null : weekdayFrom(nyDate(Math.max(lastEnd, nowMs + DAY)));
  return {
    earliest: weekdayFrom(nyDate(nowMs + DAY)),
    last,
    suggested: after && after > last ? last : after,
  };
}

/** A date inside the picker's range. */
export const clampDate = (date: string, range: { earliest: string; last: string }) =>
  date < range.earliest ? range.earliest : date > range.last ? range.last : date;
