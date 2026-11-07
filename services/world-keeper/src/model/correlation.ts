/** Latent correlations between legs (research spec §1.3).
 *
 * Every pair starts from a prior by theme (same theme 0.15, adjacent themes 0.08, unrelated
 * 0.03, each with a standard error in Fisher z); a relation an admin or the relation job stated
 * as P(B | A) and P(B | ¬A) becomes the tetrachoric correlation that keeps both venue marginals;
 * and a fit from the venues' probability co-movement (`fit.ts`) is combined with the prior by
 * precision in Fisher z. Correlations are of the events' YES outcomes; a leg needing NO flips
 * the sign. */
import { bivariateNormalCdf, clampProbability, normalQuantile } from "./normal.ts";

export const fisherZ = (rho: number) => Math.atanh(Math.max(-0.999999, Math.min(0.999999, rho)));
export const fromZ = (z: number) => Math.tanh(z);

/** A pair's correlation and its standard error in Fisher z; `priorWeight` is the prior's share
 * of the posterior precision (how much of the error is the shared prior's). */
export interface PairEstimate {
  rho: number;
  se: number;
  priorWeight: number;
  source: "prior" | "data" | "relation" | "admin";
}

export interface ThemePolicy {
  sameTheme: { rho: number; se: number };
  adjacentThemes: { rho: number; se: number };
  unrelated: { rho: number; se: number };
  /** Pairs of themes counted as adjacent (e.g. ["ai", "market"]). */
  adjacent: [string, string][];
}
export const DEFAULT_THEMES: ThemePolicy = {
  sameTheme: { rho: 0.15, se: 0.15 },
  adjacentThemes: { rho: 0.08, se: 0.12 },
  unrelated: { rho: 0.03, se: 0.1 },
  adjacent: [
    ["ai", "market"],
    ["fed", "crypto"],
    ["fed", "market"],
    ["us-china", "market"],
    ["energy", "market"],
  ],
};

/** The prior of two events by their themes. */
export function themePrior(a: readonly string[], b: readonly string[], policy = DEFAULT_THEMES) {
  if (a.some((t) => b.includes(t))) return policy.sameTheme;
  const adjacent = policy.adjacent.some(
    ([x, y]) => (a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x)),
  );
  return adjacent ? policy.adjacentThemes : policy.unrelated;
}

/** The ρ with Φ₂(Φ⁻¹(pa), Φ⁻¹(pb); ρ) = p11, by bisection (Φ₂ increases in ρ). */
export function correlationForJoint(pa: number, pb: number, p11: number) {
  const ca = normalQuantile(clampProbability(pa)),
    cb = normalQuantile(clampProbability(pb));
  let lo = -0.999,
    hi = 0.999;
  const target = Math.min(Math.min(pa, pb), Math.max(Math.max(0, pa + pb - 1), p11));
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (bivariateNormalCdf(ca, cb, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The tetrachoric correlation a stated relation implies while keeping the venue marginals:
 * its odds ratio from P(B | A) and P(B | ¬A), applied to the 2×2 table with marginals pa, pb
 * (Plackett), then inverted through Φ₂. */
export function relationCorrelation(pa: number, pb: number, bGivenA: number, bGivenNotA: number) {
  const odds = (p: number) => clampProbability(p, 1e-6) / (1 - clampProbability(p, 1e-6));
  const ratio = odds(bGivenA) / odds(bGivenNotA);
  // Plackett: the p11 of a table with these margins and odds ratio.
  let p11: number;
  if (Math.abs(ratio - 1) < 1e-12) p11 = pa * pb;
  else {
    const s = 1 + (ratio - 1) * (pa + pb);
    p11 = (s - Math.sqrt(s * s - 4 * ratio * (ratio - 1) * pa * pb)) / (2 * (ratio - 1));
  }
  return correlationForJoint(pa, pb, p11);
}

/** Prior and data combined by precision in Fisher z. */
export function posterior(
  prior: { rho: number; se: number },
  data?: { rho: number; se: number } | null,
  source: PairEstimate["source"] = data ? "data" : "prior",
): PairEstimate {
  if (!data) return { rho: prior.rho, se: prior.se, priorWeight: 1, source };
  const w0 = 1 / prior.se ** 2,
    wd = 1 / data.se ** 2;
  const z = (fisherZ(prior.rho) * w0 + fisherZ(data.rho) * wd) / (w0 + wd);
  return { rho: fromZ(z), se: 1 / Math.sqrt(w0 + wd), priorWeight: w0 / (w0 + wd), source };
}

/** The correlation matrix of a book's legs, oriented to the world's way (a leg needing NO
 * negates its event's correlations), from each pair's estimate. */
export function legMatrix(
  wantYes: readonly boolean[],
  pair: (i: number, j: number) => PairEstimate,
): { rho: number[][]; estimates: PairEstimate[][] } {
  const n = wantYes.length;
  const rho = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j): number => (i === j ? 1 : 0)),
  );
  const estimates: PairEstimate[][] = Array.from({ length: n }, () => new Array(n));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const e = pair(i, j);
      const sign = wantYes[i] === wantYes[j] ? 1 : -1;
      rho[i]![j] = rho[j]![i] = sign * e.rho;
      estimates[i]![j] = estimates[j]![i] = { ...e, rho: sign * e.rho };
    }
  return { rho, estimates };
}
