/** How worlds say numbers: every chance as a plain percent, never "1 in X"; dollars and a
 * multiple beside it; dates as people say them. Display only. */

/** Quote tokens have six decimals (USDG). */
export const QUOTE_DECIMALS = 6;
const UNIT = 10 ** QUOTE_DECIMALS;

/** Raw quote units as dollars (a number, for display). */
export const dollars = (raw: string | bigint | number | null | undefined) =>
  raw === null || raw === undefined ? 0 : Number(raw) / UNIT;

/** "$1,538", "$12.40", "$0.25". */
export function money(value: number, options: { cents?: boolean } = {}) {
  const abs = Math.abs(value);
  const cents = options.cents ?? abs < 100;
  const text = abs.toLocaleString("en-US", {
    minimumFractionDigits: cents && abs % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
  return `${value < 0 ? "−" : ""}$${text}`;
}
export const moneyRaw = (raw: string | bigint | null | undefined, options?: { cents?: boolean }) =>
  money(dollars(raw), options);

/** A chance (x 1e6) as a percent: whole between 10% and 90% ("27%"), a tenth nearer the ends so a
 * small or near-certain chance never reads as 0% or 100% ("5.7%", "0.4%", "99.2%"), and "<0.1%"
 * or ">99.9%" past that. */
export function chancePercent(x6: number | null | undefined) {
  if (x6 === null || x6 === undefined || !Number.isFinite(x6)) return "—";
  const p = x6 / 10_000;
  if (p <= 0) return "0%";
  if (p >= 100) return "100%";
  if (p < 0.1) return "<0.1%";
  if (p > 99.9) return ">99.9%";
  return `${Number(p.toFixed(p < 10 || p > 90 ? 1 : 0))}%`;
}

/** "77×", "2.5×". */
export function multiple(payout: number, stake: number) {
  if (!(stake > 0) || !(payout > 0)) return "—";
  const m = payout / stake;
  return `${m >= 10 ? Math.round(m).toLocaleString("en-US") : m.toFixed(1).replace(/\.0$/, "")}×`;
}

/** A venue probability (0 to 1) as cents, the pros' unit: "35¢". */
export const cents = (p: number | null | undefined) =>
  p === null || p === undefined ? "—" : `${Math.round(p * 100)}¢`;
/** And as a plain percent. */
export const percent = (p: number | null | undefined) =>
  p === null || p === undefined ? "—" : `${Math.round(p * 100)}%`;

/** A day's formatter in a time zone, and with the year beside it. */
const days = (timeZone?: string) => {
  const base = { weekday: "short", month: "short", day: "numeric", timeZone } as const;
  return {
    plain: new Intl.DateTimeFormat("en-US", base),
    year: new Intl.DateTimeFormat("en-US", { ...base, year: "numeric" }),
    yearOf: new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }),
  };
};
const local = days(),
  utc = days("UTC"),
  ny = days("America/New_York");
/** "Fri, Dec 19", with the year when it is not this year's ("Thu, Jul 1, 2027"). */
const say = (f: ReturnType<typeof days>, d: Date) =>
  (f.yearOf.format(d) === f.yearOf.format(new Date()) ? f.plain : f.year).format(d);
/** "Fri, Dec 19" from a YYYY-MM-DD date. */
export const calendarDay = (date: string) => say(utc, new Date(`${date}T12:00:00Z`));
/** "Fri, Dec 19" in New York, where a stock's close is: for fixings. */
export const nyDay = (seconds: number) => say(ny, new Date(seconds * 1000));
/** "Fri, Dec 19" from an ISO time or unix seconds. */
export const whenDay = (value: string | number) =>
  say(local, typeof value === "number" ? new Date(value * 1000) : new Date(value));
/** "3h", "2d", "5m" until a time (unix seconds or ISO), or "now". */
export function until(value: string | number, now = Date.now()) {
  const t = typeof value === "number" ? value * 1000 : Date.parse(value);
  const ms = t - now;
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
/** "5m ago", "2h ago", "3d ago". */
export function ago(seconds: string | number, now = Date.now()) {
  const ms = now - Number(seconds) * 1000;
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** A stock price: "$209.06", "$97,450". */
export const stockPrice = (usd: number | null | undefined) =>
  usd === null || usd === undefined
    ? "—"
    : `$${usd.toLocaleString("en-US", { maximumFractionDigits: usd >= 1_000 ? 0 : 2, minimumFractionDigits: usd >= 1_000 ? 0 : 2 })}`;
/** A strike as typed: "$240", "$240.50". */
export const strikeText = (strike: string | null | undefined) =>
  strike ? `$${Number(strike).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—";

export const shortWallet = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** A label mid-sentence: "The Fed cut…" reads "the Fed cut…"; names and acronyms keep
 * their capitals. */
export const midSentence = (label: string) =>
  /^(The|A|An|There|Another|Any|Both|Each|Either|Every|No|Some|This|That|These|Those) /.test(label)
    ? label.charAt(0).toLowerCase() + label.slice(1)
    : label;

/** What a venue decided about an event: it happened, it didn't, or it was cancelled. */
export const venueResult = (state: string) =>
  state === "yes"
    ? "happened"
    : state === "no"
      ? "didn't happen"
      : state === "invalid"
        ? "cancelled"
        : null;

/** A venue question as a short label, as the API phrases legs: "Will the Fed cut?" → "The Fed
 * cut". */
export function legLabel(question: string) {
  const q = question
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^will\s+/i, "")
    .replace(/\?$/, "")
    // "Will CPI be above 3%?" reads "CPI is above 3%".
    .replace(/^(there|[^,]{1,60}?) be /i, "$1 is ");
  const label = q.charAt(0).toUpperCase() + q.slice(1);
  return label.length > 90 ? `${label.slice(0, 87).trimEnd()}…` : label;
}
