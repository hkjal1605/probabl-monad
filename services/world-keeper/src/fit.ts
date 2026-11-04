/** The nightly fit (research spec §1.3–1.4): what the models read from the database.
 *
 * - Pair correlations of events, from their probit probabilities sampled daily at a fixed UTC
 *   time (the last tick before it): days outside 3–97% or with spreads over 6¢ dropped, changes
 *   winsorized at the median ± 4 MAD, the correlation summed over lags −1..1 against the bias of
 *   stale mids (Dimson / Scholes–Williams), used only with 30 days on which both moved, and its
 *   standard error from a stationary bootstrap in Fisher z (floored at 1/√(n − 3)).
 * - Each event's probit volatility per square-root day (1.4826 · MAD of the daily changes).
 * - Each underlying's realized volatility from its feed's rounds: daily OHLC, Yang–Zhang over 21
 *   and 63 days and an EWMA (λ 0.94), blended by `blendVolatility`, with a 15% relative error.
 * - Each event's gap on an underlying, by event study: over windows where its probability moved
 *   at least 5 points within an hour, the slope of the underlying's log move on the probability
 *   move (no intercept), with at least 8 such windows. */
import type { Database, EventProbabilityRow } from "@conditional-stocks/db";
import { type Address, type PublicClient, parseAbi } from "viem";
import { fisherZ, fromZ } from "./model/correlation.ts";
import { type AssetKind, blendVolatility, tradingDay } from "./model/fixing.ts";
import { clampProbability, normalQuantile, random } from "./model/normal.ts";

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function getRoundData(uint80) view returns (uint80, int256, uint256, uint256, uint80)",
]);
const DAY = 86_400;

/** A probability series sampled once a day at `hourUtc`: the last tick at or before it, within
 * a day; days with a spread over `maxSpread` or outside [lo, 1 − lo] are left out. */
export function dailyProbabilities(
  rows: readonly EventProbabilityRow[],
  hourUtc = 20,
  maxSpread = 0.06,
  lo = 0.03,
) {
  const sorted = [...rows].sort((a, b) => a.minute - b.minute);
  const out = new Map<number, number>();
  if (!sorted.length) return out;
  const first = Math.floor((sorted[0]!.minute * 60) / DAY),
    last = Math.floor((sorted.at(-1)!.minute * 60) / DAY);
  let i = 0;
  for (let day = first; day <= last; day++) {
    const cut = (day * DAY + hourUtc * 3_600) / 60;
    while (i + 1 < sorted.length && sorted[i + 1]!.minute <= cut) i++;
    const r = sorted[i]!;
    if (r.minute > cut || cut - r.minute > 1_440) continue;
    const p = r.mid / 1e6,
      spread = r.spread === null ? 0 : r.spread / 1e6;
    if (p < lo || p > 1 - lo || spread > maxSpread) continue;
    out.set(day, p);
  }
  return out;
}

/** Daily changes of Φ⁻¹(p) on consecutive days, winsorized at the median ± 4 MAD. */
export function probitChanges(daily: ReadonlyMap<number, number>) {
  const changes = new Map<number, number>();
  for (const [day, p] of daily) {
    const prev = daily.get(day - 1);
    if (prev !== undefined)
      changes.set(
        day,
        normalQuantile(clampProbability(p)) - normalQuantile(clampProbability(prev)),
      );
  }
  const values = [...changes.values()].sort((a, b) => a - b);
  if (values.length < 5) return changes;
  const median = values[Math.floor(values.length / 2)]!;
  const mad = [...values.map((v) => Math.abs(v - median))].sort((a, b) => a - b)[
    Math.floor(values.length / 2)
  ]!;
  if (mad > 0)
    for (const [day, v] of changes)
      changes.set(day, Math.min(median + 4 * mad, Math.max(median - 4 * mad, v)));
  return changes;
}

/** Σ over lags −1..1 of the cross-covariances over the long-run standard deviations. */
function leadLag(
  days: readonly number[],
  a: ReadonlyMap<number, number>,
  b: ReadonlyMap<number, number>,
) {
  const cov = (x: ReadonlyMap<number, number>, y: ReadonlyMap<number, number>, lag: number) => {
    let sum = 0,
      n = 0,
      mx = 0,
      my = 0;
    const pairs: [number, number][] = [];
    for (const d of days) {
      const u = x.get(d),
        v = y.get(d - lag);
      if (u !== undefined && v !== undefined) pairs.push([u, v]);
    }
    if (pairs.length < 3) return 0;
    for (const [u, v] of pairs) {
      mx += u;
      my += v;
    }
    mx /= pairs.length;
    my /= pairs.length;
    for (const [u, v] of pairs) {
      sum += (u - mx) * (v - my);
      n++;
    }
    return sum / n;
  };
  const cross = cov(a, b, -1) + cov(a, b, 0) + cov(a, b, 1);
  const va = cov(a, a, -1) + cov(a, a, 0) + cov(a, a, 1),
    vb = cov(b, b, -1) + cov(b, b, 0) + cov(b, b, 1);
  if (va <= 0 || vb <= 0) return null;
  return Math.max(-0.95, Math.min(0.95, cross / Math.sqrt(va * vb)));
}

/** A pair's correlation estimate, or null without 30 days on which both moved a tick. */
export function pairCorrelation(
  a: ReadonlyMap<number, number>,
  b: ReadonlyMap<number, number>,
  options: { minDays?: number; reps?: number; seed?: number } = {},
) {
  const days = [...a.keys()].filter((d) => b.has(d)).sort((x, y) => x - y);
  const moved = days.filter((d) => Math.abs(a.get(d)!) > 1e-6 && Math.abs(b.get(d)!) > 1e-6).length;
  if (moved < (options.minDays ?? 30)) return null;
  const rho = leadLag(days, a, b);
  if (rho === null) return null;
  // Stationary bootstrap (mean block 5) of the aligned days, resampled with their lags.
  const rng = random(options.seed ?? 7);
  const reps = options.reps ?? 500;
  const zs: number[] = [];
  for (let r = 0; r < reps; r++) {
    const ra = new Map<number, number>(),
      rb = new Map<number, number>();
    let k = Math.floor(rng.uniform() * days.length);
    for (let t = 0; t < days.length; t++) {
      if (rng.uniform() < 0.2) k = Math.floor(rng.uniform() * days.length);
      const d = days[k % days.length]!;
      for (const lag of [-1, 0, 1]) {
        const u = a.get(d - lag),
          v = b.get(d - lag);
        if (u !== undefined) ra.set(t * 3 + lag + 1, u);
        if (v !== undefined) rb.set(t * 3 + lag + 1, v);
      }
      k++;
    }
    const sample = leadLag(
      Array.from({ length: days.length }, (_, t) => t * 3 + 1),
      ra,
      rb,
    );
    if (sample !== null) zs.push(fisherZ(sample));
  }
  const mean = zs.reduce((x, y) => x + y, 0) / Math.max(1, zs.length);
  const sd = Math.sqrt(zs.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, zs.length - 1));
  return {
    rho: fromZ(fisherZ(rho)),
    se: Math.max(sd, 1 / Math.sqrt(Math.max(1, moved - 3))),
    samples: moved,
  };
}

/** An event's probit volatility per square-root day: 1.4826 · MAD of its daily changes. */
export function probitVolatility(changes: ReadonlyMap<number, number>) {
  const values = [...changes.values()];
  if (values.length < 10) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const mad = [...values.map((v) => Math.abs(v - median))].sort((a, b) => a - b)[
    Math.floor(values.length / 2)
  ]!;
  const vol = 1.4826 * mad;
  return vol > 0 ? { vol, samples: values.length } : null;
}

export interface Round {
  roundId: bigint;
  answer: number;
  updatedAt: number;
}
/** A feed's rounds back to `since` (unix seconds), newest first, read in multicalls of 100. A
 * gap of 20 missing ids in a row ends the walk. */
export async function feedRounds(client: PublicClient, feed: Address, since: number, max = 5_000) {
  const latest = (await client.readContract({
    address: feed,
    abi: feedAbi,
    functionName: "latestRoundData",
  })) as readonly bigint[];
  const rounds: Round[] = [];
  let id = latest[0]!,
    misses = 0;
  while (rounds.length < max && id > 0n && misses < 20) {
    const ids = Array.from({ length: 100 }, (_, i) => id - BigInt(i)).filter((x) => x > 0n);
    const reads = (await client.multicall({
      allowFailure: true,
      deployless: true,
      contracts: ids.map((roundId) => ({
        address: feed,
        abi: feedAbi,
        functionName: "getRoundData",
        args: [roundId],
      })) as never,
    })) as { status: string; result?: readonly bigint[] }[];
    let older = false;
    reads.forEach((r, i) => {
      if (r.status !== "success" || !r.result || r.result[1]! <= 0n) {
        misses++;
        return;
      }
      misses = 0;
      const updatedAt = Number(r.result[3]!);
      if (updatedAt < since) older = true;
      else rounds.push({ roundId: ids[i]!, answer: Number(r.result[1]!), updatedAt });
    });
    if (older) break;
    id -= 100n;
  }
  return rounds;
}

/** Daily open, high, low and close from rounds: ET trading days for stocks, UTC days for
 * crypto. */
export function dailyBars(rounds: readonly Round[], kind: AssetKind) {
  const sorted = [...rounds].sort((a, b) => a.updatedAt - b.updatedAt);
  const bars = new Map<number, { open: number; high: number; low: number; close: number }>();
  for (const r of sorted) {
    if (kind !== "crypto" && !tradingDay(r.updatedAt)) continue;
    const day =
      kind === "crypto"
        ? Math.floor(r.updatedAt / DAY)
        : Math.floor((r.updatedAt - 4 * 3_600) / DAY);
    const bar = bars.get(day);
    if (!bar) bars.set(day, { open: r.answer, high: r.answer, low: r.answer, close: r.answer });
    else {
      bar.high = Math.max(bar.high, r.answer);
      bar.low = Math.min(bar.low, r.answer);
      bar.close = r.answer;
    }
  }
  return [...bars.entries()].sort((a, b) => a[0] - b[0]).map(([, bar]) => bar);
}

/** Yang–Zhang volatility (annualized) over the last `n` bars. */
export function yangZhang(
  bars: readonly { open: number; high: number; low: number; close: number }[],
  n: number,
  perYear: number,
) {
  const window = bars.slice(-(n + 1));
  if (window.length < Math.min(n, 10) + 1) return null;
  const overnight: number[] = [],
    openClose: number[] = [];
  let rs = 0;
  for (let i = 1; i < window.length; i++) {
    const b = window[i]!,
      prev = window[i - 1]!;
    overnight.push(Math.log(b.open / prev.close));
    openClose.push(Math.log(b.close / b.open));
    rs +=
      Math.log(b.high / b.close) * Math.log(b.high / b.open) +
      Math.log(b.low / b.close) * Math.log(b.low / b.open);
  }
  const m = overnight.length;
  const variance = (xs: number[]) => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1);
  };
  const k = 0.34 / (1.34 + (m + 1) / Math.max(1, m - 1));
  const daily = variance(overnight) + k * variance(openClose) + (1 - k) * (rs / m);
  return daily > 0 ? Math.sqrt(daily * perYear) : null;
}

/** EWMA volatility (λ 0.94) of close-to-close returns, annualized. */
export function ewmaVolatility(bars: readonly { close: number }[], perYear: number, lambda = 0.94) {
  if (bars.length < 11) return null;
  let variance = 0,
    started = false;
  for (let i = 1; i < bars.length; i++) {
    const r = Math.log(bars[i]!.close / bars[i - 1]!.close);
    variance = started ? lambda * variance + (1 - lambda) * r * r : r * r;
    started = true;
  }
  return Math.sqrt(variance * perYear);
}

/** An event's gap on an underlying: the no-intercept slope of the underlying's log move on the
 * probability move over windows where the probability moved at least `jump` within an hour. */
export function eventStudyGap(
  probabilities: readonly EventProbabilityRow[],
  rounds: readonly Round[],
  options: { jump?: number; minWindows?: number } = {},
) {
  const jump = options.jump ?? 0.05;
  const p = [...probabilities].sort((a, b) => a.minute - b.minute);
  const s = [...rounds].sort((a, b) => a.updatedAt - b.updatedAt);
  if (p.length < 2 || s.length < 2) return null;
  const priceAt = (t: number) => {
    let lo = 0,
      hi = s.length - 1;
    if (s[0]!.updatedAt > t) return null;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (s[mid]!.updatedAt <= t) lo = mid;
      else hi = mid - 1;
    }
    return t - s[lo]!.updatedAt <= 3_600 ? s[lo]!.answer : null;
  };
  const windows: [number, number][] = [];
  let j = 0;
  for (let i = 0; i < p.length; i++) {
    while (j < i && p[i]!.minute - p[j]!.minute > 60) j++;
    const dp = (p[i]!.mid - p[j]!.mid) / 1e6;
    if (Math.abs(dp) < jump) continue;
    const s0 = priceAt(p[j]!.minute * 60),
      s1 = priceAt(p[i]!.minute * 60);
    if (s0 === null || s1 === null || s0 <= 0 || s1 <= 0) continue;
    windows.push([dp, Math.log(s1 / s0)]);
    j = i;
  }
  if (windows.length < (options.minWindows ?? 8)) return null;
  const sxx = windows.reduce((a, [x]) => a + x * x, 0);
  const sxy = windows.reduce((a, [x, y]) => a + x * y, 0);
  const gap = sxy / sxx;
  const residual =
    windows.reduce((a, [x, y]) => a + (y - gap * x) ** 2, 0) / Math.max(1, windows.length - 1);
  return { gap, error: Math.sqrt(residual / sxx), samples: windows.length };
}

/** Runs every fit over the events and underlyings of live books, and stores the results. */
export async function runFit(input: {
  db: Database;
  client: PublicClient;
  /** Conditions of live books, and each underlying's feed and class. */
  conditions: string[];
  underlyings: { symbol: string; feed: Address; kind: AssetKind; conditions: string[] }[];
  log: (event: string, detail?: Record<string, unknown>) => void;
  nowMs?: number;
}) {
  const { db, client, log } = input;
  const nowMs = input.nowMs ?? Date.now();
  const nowMinute = Math.floor(nowMs / 60_000);
  const group = (rows: readonly EventProbabilityRow[]) => {
    const by = new Map<string, EventProbabilityRow[]>();
    for (const r of rows) {
      const list = by.get(r.condition);
      if (list) list.push(r);
      else by.set(r.condition, [r]);
    }
    return by;
  };
  // The daily fits read one row per condition and day; the event study, five-minute rows of
  // the priced books' events over the feed's window.
  const daily = group(
    await db.dailyEventProbabilities(input.conditions, nowMinute - 120 * 1_440, nowMinute),
  );
  const studied = [...new Set(input.underlyings.flatMap((u) => u.conditions))];
  const minutes = group(
    studied.length ? await db.eventProbabilityHistory(studied, nowMinute - 100 * 1_440, 5) : [],
  );
  const changes = new Map<string, Map<number, number>>();
  for (const [condition, rows] of daily)
    changes.set(condition, probitChanges(dailyProbabilities(rows)));
  // Probit volatilities.
  const vols = [...changes].flatMap(([condition, c]) => {
    const v = probitVolatility(c);
    return v ? [{ condition, vol: v.vol, samples: v.samples }] : [];
  });
  await db.putEventVolatilities(vols);
  // Pair correlations.
  const keys = [...changes.keys()].sort();
  const correlations: {
    a: string;
    b: string;
    rho: number;
    error: number;
    samples: number;
    method: string;
  }[] = [];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const fit = pairCorrelation(changes.get(keys[i]!)!, changes.get(keys[j]!)!);
      if (fit)
        correlations.push({
          a: keys[i]!,
          b: keys[j]!,
          rho: fit.rho,
          error: fit.se,
          samples: fit.samples,
          method: "lead-lag",
        });
    }
  await db.putWorldCorrelations(correlations);
  // Realized volatility and gaps per underlying.
  const volRows: {
    underlying: string;
    vol: number;
    error: number;
    samples: number;
    method: string;
  }[] = [];
  const gapRows: {
    condition: string;
    underlying: string;
    gap: number;
    error: number;
    samples: number;
    method: string;
  }[] = [];
  for (const u of input.underlyings) {
    try {
      const rounds = await feedRounds(client, u.feed, Math.floor(nowMs / 1000) - 100 * DAY);
      const bars = dailyBars(rounds, u.kind);
      const perYear = u.kind === "crypto" ? 365 : 252;
      const vol = blendVolatility(
        u.kind,
        {
          yz21: yangZhang(bars, 21, perYear),
          yz63: yangZhang(bars, 63, perYear),
          ewma: ewmaVolatility(bars, perYear),
        },
        false,
      );
      volRows.push({
        underlying: u.symbol,
        vol,
        error: 0.15 * vol,
        samples: bars.length,
        method: "realized",
      });
      for (const condition of u.conditions) {
        const g = eventStudyGap(minutes.get(condition) ?? [], rounds);
        if (g) gapRows.push({ condition, underlying: u.symbol, ...g, method: "event-study" });
      }
    } catch (error) {
      log("fit-underlying-failed", { underlying: u.symbol, reason: (error as Error).message });
    }
  }
  await db.putWorldVols(volRows);
  await db.putWorldGaps(gapRows);
  log("fit-done", {
    conditions: changes.size,
    correlations: correlations.length,
    probitVols: vols.length,
    vols: volRows.length,
    gaps: gapRows.length,
  });
  return { correlations, vols: volRows, gaps: gapRows, probitVols: vols };
}
