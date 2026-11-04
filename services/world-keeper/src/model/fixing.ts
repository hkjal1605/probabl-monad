/** The stock inside the world and its fixing (research spec §1.4).
 *
 * - Forward in leg outcome ω: F_ω = c·S₀·exp(Σᵢ gᵢ(x̃ᵢ(ω) − pᵢ)), c normalizing over the joint law
 *   so the stock averages to spot. A leg resolving after the fixing moves the fixing only by the
 *   share φᵢ of its uncertainty resolved by then: x̃ᵢ = pᵢ + φᵢ(xᵢ − pᵢ), with
 *   φᵢ = [Φ₂(cᵢ, cᵢ; τ_fix/τᵢ) − pᵢ²] / (pᵢ(1 − pᵢ)).
 * - Log variance in the world: σ²τ, less the event variance an implied volatility already holds
 *   for legs resolved by the fixing, plus their jump dispersion and an earnings jump on realized
 *   volatility; floored at 0.7·σ²τ.
 * - Time: stocks in trading days (each weekend or holiday gap adds 0.1 day) over 252; crypto in
 *   calendar days over 365.
 * - Smile, sticky-moneyness: σ(k) = σ_ATM + ψ(τ)·k, k = ln(K/F), ψ(τ) = ψ₁ₘ(τ/1M)^−0.4 within
 *   ±0.6; the digital is −∂C/∂K with its skew term, D(K) = N(d₂) − φ(d₂)√τ·ψ, made monotone. */
import {
  bivariateNormalCdf,
  clampProbability,
  normalCdf,
  normalPdf,
  normalQuantile,
} from "./normal.ts";

export type AssetKind = "stock" | "etf" | "crypto";
export const VOL_FLOORS: Record<AssetKind, number> = { stock: 0.2, etf: 0.12, crypto: 0.35 };
export const SKEW_PRIORS: Record<AssetKind, { psi: number; se: number }> = {
  stock: { psi: -0.15, se: 0.1 },
  etf: { psi: -0.3, se: 0.1 },
  crypto: { psi: 0, se: 0.1 },
};

/** NYSE full-day closures, 2025 to 2028 (ET dates). */
const HOLIDAYS = new Set([
  "2025-01-01",
  "2025-01-09",
  "2025-01-20",
  "2025-02-17",
  "2025-04-18",
  "2025-05-26",
  "2025-06-19",
  "2025-07-04",
  "2025-09-01",
  "2025-11-27",
  "2025-12-25",
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
  "2028-01-17",
  "2028-02-21",
  "2028-04-14",
  "2028-05-29",
  "2028-06-19",
  "2028-07-04",
  "2028-09-04",
  "2028-11-23",
  "2028-12-25",
]);
const ET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});
/** Whether NYSE trades on the ET calendar day containing `seconds`. */
export function tradingDay(seconds: number) {
  const parts = Object.fromEntries(
    ET.formatToParts(new Date(seconds * 1000)).map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  return !HOLIDAYS.has(`${parts.year}-${parts.month}-${parts.day}`);
}

/** Years of variance from `now` to `fixing` (unix seconds): trading days (and 0.1 day per
 * weekend or holiday gap) over 252 for stocks and ETFs, calendar days over 365 for crypto. */
export function varianceYears(now: number, fixing: number, kind: AssetKind) {
  if (fixing <= now) return 0;
  if (kind === "crypto") return (fixing - now) / (365 * 86_400);
  let days = 0,
    inGap = false,
    gapCovered = 0,
    gapLength = 0;
  const DAY = 86_400;
  // Walk ET-day by ET-day in 1-hour steps, so DST shifts and partial days count exactly.
  for (let t = now; t < fixing; ) {
    const step = Math.min(3_600, fixing - t);
    const trading = tradingDay(t + step / 2);
    if (trading) {
      if (inGap) {
        days += 0.1 * Math.min(1, gapCovered / Math.max(gapLength, 1));
        inGap = false;
      }
      days += step / DAY;
    } else {
      if (!inGap) {
        inGap = true;
        gapCovered = 0;
        gapLength = 0;
        // The whole gap's length, to prorate the 0.1 day by how much of it is covered.
        for (let u = t; !tradingDay(u + 1_800) && gapLength < 10 * DAY; u += 3_600)
          gapLength += 3_600;
      }
      gapCovered += step;
    }
    t += step;
  }
  if (inGap) days += 0.1 * Math.min(1, gapCovered / Math.max(gapLength, 1));
  return days / 252;
}

/** The share of leg uncertainty resolved by the fixing when the leg resolves later. */
export function resolvedShare(p: number, fixingIn: number, resolvesIn: number) {
  if (resolvesIn <= fixingIn) return 1;
  if (fixingIn <= 0) return 0;
  const q = clampProbability(p, 1e-9),
    c = normalQuantile(q);
  const share = (bivariateNormalCdf(c, c, fixingIn / resolvesIn) - q * q) / (q * (1 - q));
  return Math.min(1, Math.max(0, share));
}

/** One leg as the fixing sees it (oriented to the world's way). */
export interface FixingLeg {
  p: number;
  /** Log-move of the underlying when the leg goes the world's way rather than not. */
  gap: number;
  /** Seconds until the leg resolves. */
  resolvesIn: number;
  /** Jump dispersion around the gap at resolution (default 0.5·|gap|). */
  dispersion?: number;
}
export interface FixingInputs {
  kind: AssetKind;
  /** Seconds until the fixing. */
  fixingIn: number;
  /** Variance years until the fixing (`varianceYears`). */
  tau: number;
  /** Annualized volatility and whether it is implied (holds the legs' event variance). */
  vol: number;
  implied: boolean;
  /** ψ at one month. */
  skew1m: number;
  /** RMS earnings-day log move when earnings fall before the fixing (realized vol only). */
  earningsJump: number | null;
  legs: FixingLeg[];
}

/** The world's forward relative to spot (F_W / S₀) under the joint law `dist` of the legs. */
export function worldForwardRatio(fx: FixingInputs, dist: Float64Array) {
  const n = fx.legs.length;
  const share = fx.legs.map((l) => resolvedShare(l.p, fx.fixingIn, l.resolvesIn));
  const exponent = (o: number) => {
    let e = 0;
    for (let i = 0; i < n; i++) {
      const l = fx.legs[i]!,
        x = (o >> i) & 1;
      e += l.gap * share[i]! * (x - l.p);
    }
    return e;
  };
  let norm = 0;
  for (let o = 0; o < dist.length; o++) norm += dist[o]! * Math.exp(exponent(o));
  return Math.exp(exponent(dist.length - 1)) / norm;
}

/** The world's log variance to the fixing. */
export function worldVariance(fx: FixingInputs) {
  const base = fx.vol * fx.vol * fx.tau;
  let w = base;
  for (const l of fx.legs) {
    if (l.resolvesIn > fx.fixingIn) continue;
    if (fx.implied) w -= l.p * (1 - l.p) * l.gap * l.gap;
    const d = l.dispersion ?? 0.5 * Math.abs(l.gap);
    w += d * d;
  }
  if (!fx.implied && fx.earningsJump) w += fx.earningsJump ** 2;
  return Math.max(0.7 * base, w);
}

/** ψ at variance years `tau` from its one-month value. */
export const skewAt = (skew1m: number, tau: number) =>
  Math.max(-0.6, Math.min(0.6, skew1m * Math.max(tau / (1 / 12), 1e-3) ** -0.4));

/** P(S_T ≥ K | W) for each strike (ascending), with the skew term, made non-increasing. */
export function digitals(
  strikes: readonly number[],
  forward: number,
  variance: number,
  tau: number,
  skew1m: number,
) {
  if (tau <= 0 || variance <= 0) return strikes.map((k) => (forward >= k ? 1 : 0));
  const atm = Math.sqrt(variance / tau);
  const psi = skewAt(skew1m, tau);
  const d = strikes.map((k) => {
    const m = Math.log(k / forward);
    const sigma = Math.max(0.05 * atm, atm + psi * m);
    const v = sigma * Math.sqrt(tau);
    const d2 = (Math.log(forward / k) - 0.5 * v * v) / v;
    return Math.min(1, Math.max(0, normalCdf(d2) - normalPdf(d2) * Math.sqrt(tau) * psi));
  });
  return isotonicDecreasing(d);
}

/** The closest non-increasing sequence in least squares (pool adjacent violators). */
export function isotonicDecreasing(values: readonly number[]) {
  const blocks: { sum: number; count: number }[] = [];
  for (const v of values) {
    blocks.push({ sum: v, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!,
        prev = blocks[blocks.length - 2]!;
      if (prev.sum / prev.count >= last.sum / last.count) break;
      prev.sum += last.sum;
      prev.count += last.count;
      blocks.pop();
    }
  }
  return blocks.flatMap((b) => new Array<number>(b.count).fill(b.sum / b.count));
}

/** The world's bucket chances (m + 1 of them, summing to one) from the digitals. */
export function bucketsFromDigitals(d: readonly number[]) {
  const out: number[] = [];
  let above = 1;
  for (const x of d) {
    out.push(Math.max(0, above - x));
    above = x;
  }
  out.push(Math.max(0, above));
  return out;
}

/** Everything the fixing contributes to a book's atoms: bucket chances given the world. */
export function fixingBuckets(
  fx: FixingInputs,
  strikes: readonly number[],
  spot: number,
  dist: Float64Array,
) {
  const forward = spot * worldForwardRatio(fx, dist);
  const variance = worldVariance(fx);
  return {
    forward,
    variance,
    buckets: bucketsFromDigitals(digitals(strikes, forward, variance, fx.tau, fx.skew1m)),
  };
}

/** The blended realized volatility of the spec: 1.10·√(0.4·YZ₂₁² + 0.4·YZ₆₃² + 0.2·EWMA²), or for
 * at most five trading days √(0.5·EWMA² + 0.5·YZ₂₁²) (both times 1.10), floored by class. */
export function blendVolatility(
  kind: AssetKind,
  inputs: { yz21: number | null; yz63: number | null; ewma: number | null },
  shortHorizon: boolean,
) {
  const { yz21, yz63, ewma } = inputs;
  const parts = shortHorizon
    ? [
        [0.5, ewma],
        [0.5, yz21],
      ]
    : [
        [0.4, yz21],
        [0.4, yz63],
        [0.2, ewma],
      ];
  let weight = 0,
    variance = 0;
  for (const [w, v] of parts as [number, number | null][])
    if (v !== null && Number.isFinite(v) && v > 0) {
      weight += w;
      variance += w * v * v;
    }
  const raw = weight ? 1.1 * Math.sqrt(variance / weight) : 0;
  return Math.max(VOL_FLOORS[kind], raw);
}
