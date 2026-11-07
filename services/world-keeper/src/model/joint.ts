/** Joint probabilities of a world's legs: a Gaussian copula (research spec §1.3).
 *
 * Leg i goes the world's way when its latent score Xᵢ falls below cᵢ = Φ⁻¹(qᵢ); the scores are
 * standard normal with the legs' (oriented) latent correlation matrix R. R is fit by the fewest
 * factors (1 to 3) that reproduce every pair within 0.01, Xᵢ = Σₖ βᵢₖ Fₖ + sᵢ εᵢ; given the
 * factors the legs are independent, so the probability of every outcome ω ∈ {0,1}ⁿ is a
 * Gauss–Hermite integral, accumulated per node as a product over the legs (2ⁿ terms). Each leg's
 * own chance is exactly qᵢ. When no three factors fit R within 0.01 (the research's 0.05 lets
 * an awkward matrix move P(W) by a quarter point), the world's probability is computed on R
 * itself by Genz's method on a fixed lattice (deterministic), and the factor fit serves the rest
 * of the distribution.
 *
 * Exact logic overrides the model: a leg implied by another leg of the world (a nested ladder,
 * or the "no" of an exclusive rival) adds no condition, and a world needing two exclusive
 * outcomes cannot happen. The world's probability is clamped to the Fréchet bounds
 * max(0, Σqᵢ − (n − 1)) ≤ P(W) ≤ min qᵢ. */
import { cholesky, factorFit, type Matrix, nearestCorrelation } from "./linalg.ts";
import { clampProbability, hermiteRule, normalCdf, normalQuantile } from "./normal.ts";

/** An exact link between two legs, in terms of each going the world's way. */
export interface LegLogic {
  /** `implies`: leg a going the world's way makes leg b go it too. `exclusive`: both cannot. */
  kind: "implies" | "exclusive";
  a: number;
  b: number;
}
export interface Joint {
  /** Every outcome's probability (bit i: leg i went the world's way), in outcome order. */
  dist: Float64Array;
  /** P(W), after logic, within the Fréchet bounds. */
  world: number;
  loadings: Matrix;
  /** The largest pair the factors miss by. */
  misfit: number;
}

/** Above this factor misfit on any pair, P(W) is integrated on the exact matrix (Genz). */
export const GENZ_MISFIT = 0.01;
/** Largest Σβ² of one leg: the idiosyncratic part never vanishes. */
export const MAX_COMMONALITY = 0.95;
/** Quadrature nodes per factor, by factor count: the integrands are smooth, so 24, 16 and 12
 * nodes integrate them to ~1e-10 at a cost that stays under 10⁵ node-outcome products. */
const NODES = [1, 24, 16, 12];

/** The fewest factors (up to three) that fit R within 0.01 (or the best three). */
export function fitFactors(r: Matrix) {
  const n = r.length;
  if (n === 1) return { loadings: [[0]], misfit: 0 };
  let best = factorFit(r, 1, MAX_COMMONALITY);
  for (let m = 2; m <= Math.min(3, n - 1) && best.misfit > 0.01; m++) {
    const next = factorFit(r, m, MAX_COMMONALITY);
    if (next.misfit < best.misfit) best = next;
  }
  return best;
}

/** Every outcome's probability under factor loadings `loadings` and chances `q`. */
export function outcomeDistribution(q: readonly number[], loadings: Matrix): Float64Array {
  const n = q.length;
  if (n < 1 || n > 12) throw new Error("1 to 12 legs");
  const width = loadings[0]?.length ?? 0;
  const used: number[] = [];
  for (let k = 0; k < width; k++)
    if (loadings.some((row) => Math.abs(row[k] ?? 0) > 1e-12)) used.push(k);
  const dims = used.length;
  const c = q.map((p) => normalQuantile(clampProbability(p)));
  const beta = loadings.map((row) => used.map((k) => row[k] ?? 0));
  const s = beta.map((b) => Math.sqrt(Math.max(1e-12, 1 - b.reduce((a, x) => a + x * x, 0))));
  const nodes = NODES[dims] ?? 12;
  const { nodes: x, weights: w } = hermiteRule(nodes);
  const total = dims === 0 ? 1 : nodes ** dims;
  const out = new Float64Array(1 << n);
  const dist = new Float64Array(1 << n);
  const conditional = new Float64Array(n);
  const point = new Float64Array(dims);
  for (let index = 0; index < total; index++) {
    let weight = 1,
      rest = index;
    for (let d = 0; d < dims; d++) {
      const node = rest % nodes;
      rest = Math.floor(rest / nodes);
      point[d] = x[node]!;
      weight *= w[node]!;
    }
    for (let i = 0; i < n; i++) {
      let shift = 0;
      for (let d = 0; d < dims; d++) shift += beta[i]![d]! * point[d]!;
      conditional[i] = normalCdf((c[i]! - shift) / s[i]!);
    }
    dist[0] = 1;
    let size = 1;
    for (let i = 0; i < n; i++) {
      const p = conditional[i]!;
      for (let o = 0; o < size; o++) {
        const v = dist[o]!;
        dist[o + size] = v * p;
        dist[o] = v * (1 - p);
      }
      size <<= 1;
    }
    for (let o = 0; o < size; o++) out[o]! += weight * dist[o]!;
  }
  return out;
}

/** P(X ≤ c) for X ~ N(0, R): Genz's sequential conditioning, variables ordered most
 * restrictive first, over a fixed Richtmyer lattice with antithetic points. Deterministic. */
export function mvnLower(c: readonly number[], r: Matrix, points = 4096): number {
  const n = c.length;
  if (n === 1) return normalCdf(c[0]!);
  const order = c.map((_, i) => i).sort((i, j) => c[i]! - c[j]!);
  const ordered = order.map((i) => order.map((j) => r[i]![j]!));
  const fixed = nearestCorrelation(ordered, 1e-8);
  const l = cholesky(fixed.map((row, i) => row.map((v, j) => (i === j ? v + 1e-10 : v))));
  const bound = order.map((i) => c[i]!);
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31];
  const z = primes.slice(0, n - 1).map((p) => Math.sqrt(p) % 1);
  const y = new Float64Array(n);
  let sum = 0;
  for (let i = 1; i <= points; i++)
    for (const anti of [false, true]) {
      let e = normalCdf(bound[0]! / l[0]![0]!),
        product = e;
      for (let j = 1; j < n; j++) {
        let u = (i * z[j - 1]! + 0.5) % 1;
        // Baker's transform keeps the lattice periodic.
        u = 1 - Math.abs(2 * u - 1);
        if (anti) u = 1 - u;
        y[j - 1] = normalQuantile(clampProbability(u * e, 1e-15));
        let shift = 0;
        for (let k = 0; k < j; k++) shift += l[j]![k]! * y[k]!;
        e = normalCdf((bound[j]! - shift) / l[j]![j]!);
        product *= e;
      }
      sum += product;
    }
  return sum / (2 * points);
}

/** The legs whose conditions remain once exact logic applies, or null when the world cannot
 * happen. */
export function applyLogic(n: number, logic: readonly LegLogic[]): number[] | null {
  if (logic.some((l) => l.kind === "exclusive")) return null;
  const implied = new Set<number>();
  for (const l of logic)
    if (l.kind === "implies" && l.a !== l.b && !implied.has(l.a)) implied.add(l.b);
  return Array.from({ length: n }, (_, i) => i).filter((i) => !implied.has(i));
}

/** max(0, Σqᵢ − (n − 1)) ≤ P(all) ≤ min qᵢ: what any joint law of the legs allows. */
export function frechetBounds(q: readonly number[]) {
  return {
    lower: Math.max(0, q.reduce((a, b) => a + b, 0) - (q.length - 1)),
    upper: Math.min(...q),
  };
}

/** The world's joint law: the outcome distribution, P(W) and the factor fit. */
export function joint(q: readonly number[], r: Matrix, logic: readonly LegLogic[] = []): Joint {
  const n = q.length;
  const fixed = n > 1 ? nearestCorrelation(r) : r;
  const { loadings, misfit } = fitFactors(fixed);
  const dist = outcomeDistribution(q, loadings);
  const kept = applyLogic(n, logic);
  let world: number;
  if (kept === null) world = 0;
  else if (kept.length === n) {
    world =
      misfit > GENZ_MISFIT
        ? mvnLower(
            q.map((p) => normalQuantile(clampProbability(p))),
            fixed,
          )
        : dist[dist.length - 1]!;
  } else {
    // Implied legs drop: the world is the event that the rest all go its way.
    let mask = 0;
    for (const i of kept) mask |= 1 << i;
    world = 0;
    for (let o = 0; o < dist.length; o++) if ((o & mask) === mask) world += dist[o]!;
  }
  if (kept !== null) {
    const { lower, upper } = frechetBounds(kept.map((i) => q[i]!));
    world = Math.min(upper, Math.max(lower, world));
  }
  return { dist, world, loadings, misfit };
}

/** Each leg's own chance under a distribution (they equal the inputs: a test of the integral). */
export function marginals(dist: Float64Array, n: number) {
  const out = new Array<number>(n).fill(0);
  for (let o = 0; o < dist.length; o++)
    for (let i = 0; i < n; i++) if ((o >> i) & 1) out[i]! += dist[o]!;
  return out;
}

/** The probability that every leg in `mask` goes the world's way. */
export function passProbability(dist: Float64Array, mask: number) {
  let p = 0;
  for (let o = 0; o < dist.length; o++) if ((o & mask) === mask) p += dist[o]!;
  return p;
}

/** A matrix with every pair at ρ. */
export const equicorrelated = (n: number, rho: number): Matrix =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : rho)));

/** P(every leg goes the world's way) alone: the factor integral of the product over the legs,
 * O(nodes · n), for unions of books' legs too large for the full outcome distribution. */
export function allPassProbability(q: readonly number[], r: Matrix): number {
  const n = q.length;
  if (!n) return 1;
  if (n === 1) return q[0]!;
  const fixed = nearestCorrelation(r);
  const { loadings, misfit } = fitFactors(fixed);
  const c = q.map((p) => normalQuantile(clampProbability(p)));
  if (misfit > GENZ_MISFIT) return mvnLower(c, fixed);
  const width = loadings[0]?.length ?? 0;
  const s = loadings.map((row) =>
    Math.sqrt(Math.max(1e-12, 1 - row.reduce((a, x) => a + x * x, 0))),
  );
  const nodes = NODES[width] ?? 12;
  const { nodes: x, weights: w } = hermiteRule(nodes);
  const total = width === 0 ? 1 : nodes ** width;
  let sum = 0;
  for (let index = 0; index < total; index++) {
    let weight = 1,
      rest = index;
    const point: number[] = [];
    for (let d = 0; d < width; d++) {
      const node = rest % nodes;
      rest = Math.floor(rest / nodes);
      point.push(x[node]!);
      weight *= w[node]!;
    }
    let product = 1;
    for (let i = 0; i < n; i++) {
      let shift = 0;
      for (let d = 0; d < width; d++) shift += loadings[i]![d]! * point[d]!;
      product *= normalCdf((c[i]! - shift) / s[i]!);
    }
    sum += weight * product;
  }
  return Math.min(Math.min(...q), Math.max(0, sum));
}
