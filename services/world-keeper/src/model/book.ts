/** A book's pricing model (research spec §1.5): the chance of every atom at the posterior
 * center, and everything a quote needs to charge for model uncertainty from memory.
 *
 * Uncertain inputs θ: each pair's latent correlation (in Fisher z), each leg's chance, each
 * leg's gap on the underlying, the volatility and the skew; the spot's log level is carried for
 * the stale-quote charge only. Pair errors share a common component (the shared prior), a part
 * per leg and a part per pair, so two pairs sharing a leg or a prior are correlated 0.5.
 *
 * - The center: E_θ[P(a)], a 5-node Gauss–Hermite integral along the common correlation shift,
 *   plus the second-order term ½·Σ ∂²P/∂θ² Var θ for each leg's chance and the fixing inputs.
 * - The Jacobian J = ∂P(a)/∂θ at the point estimate: pairs by Plackett's identity,
 *   ∂P(W)/∂ρᵢⱼ = φ₂(cᵢ, cⱼ; ρᵢⱼ)·P(other legs | Xᵢ = cᵢ, Xⱼ = cⱼ); the rest by central differences.
 *   A bundle's uncertainty is then √(∇Vᵀ Σ_θ ∇V) with ∇V = Jᵀh, a few multiplications per quote.
 * - Two one-sided systematic terms, as atom shifts: the favorite–longshot calibration
 *   q → σ(b·logit q) and the horizon attenuation of correlations fit on daily changes.
 * - τ_eff: the expected time until the book decides (a leg failing decides it early). */

import { fisherZ, fromZ, type PairEstimate } from "./correlation.ts";
import { type AssetKind, type FixingInputs, fixingBuckets, varianceYears } from "./fixing.ts";
import { joint, type LegLogic, mvnLower, passProbability } from "./joint.ts";
import { type Matrix, nearestCorrelation } from "./linalg.ts";
import {
  bivariateNormalPdf,
  clampProbability,
  hermiteRule,
  normalCdf,
  normalQuantile,
} from "./normal.ts";

/** One open leg of a book, as the model takes it. */
export interface LegInput {
  /** The venue's YES midpoint and half its spread. */
  yes: number;
  halfSpread: number;
  /** How far two venues listing the event disagree (zero for one venue). */
  venueGap: number;
  wantYes: boolean;
  /** Seconds until the venue expects the event to resolve. */
  resolvesIn: number;
  /** The event's probability volatility per square-root day, in probit units. */
  probitVol: number;
  /** A politics, government or military event (calibration slope +0.05). */
  politics: boolean;
}
/** The stock part of a priced book. Prices are feed answers as numbers. */
export interface StockInput {
  kind: AssetKind;
  spot: number;
  strikes: number[];
  vol: number;
  /** Relative standard error of the volatility (0.15 realized, 0.05 implied). */
  volSe: number;
  implied: boolean;
  skew1m: number;
  skewSe: number;
  earningsJump: number | null;
  /** Per leg, oriented: the log-move when the leg goes the world's way, and its error. */
  gaps: { gap: number; se: number }[];
  /** Seconds until the fixing, and its variance years (`varianceYears`). */
  fixingIn: number;
  tau: number;
}
export interface BookInputs {
  legs: LegInput[];
  /** Event-level estimates (YES outcomes) of each pair of legs, i < j. */
  pair: (i: number, j: number) => PairEstimate;
  logic: LegLogic[];
  stock: StockInput | null;
  /** Seconds until the book decides if every leg passes (the fixing, or the last leg). */
  decidesIn: number;
}
export interface Parameter {
  name: string;
  kind: "pair" | "q" | "gap" | "vol" | "skew" | "spot";
  variance: number;
}
export interface BookModel {
  atoms: number;
  legs: number;
  /** Oriented chances of the open legs. */
  q: number[];
  /** The point estimate and the posterior center of every atom's chance. */
  point: Float64Array;
  center: Float64Array;
  world: number;
  worldCenter: number;
  params: Parameter[];
  /** ∂P(a)/∂θₚ, one array per parameter. */
  jacobian: Float64Array[];
  /** Covariance of the pair parameters, by their positions in `params`. */
  pairs: { index: number; i: number; j: number }[];
  pairCovariance: number[][];
  /** Atom shifts of the systematic terms. */
  flb: Float64Array;
  attenuation: Float64Array;
  /** Expected seconds until the book decides. */
  tauEff: number;
  /** Per leg: the chance after logic is applied, the stale-quote volatility in probability per
   * √day, and seconds to resolution. */
  legInfo: { q: number; halfSpread: number; probabilityVol: number; resolvesIn: number }[];
  forward: number | null;
  variance: number | null;
  /** Spot volatility (annual) for the stale-quote charge. */
  spotVol: number;
  /** The chance chain at the point estimate, legs in book order: P(legs 0..k all go the
   * world's way) for each k (the last is P(W)), and the same chain if the legs were unrelated
   * (the product of their chances). What a world page explains its chance with. */
  chain: number[];
  naive: number[];
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
/** The favorite–longshot calibration slope by horizon (and +0.05 for politics, cap 1.2). */
export function calibrationSlope(resolvesIn: number, politics: boolean) {
  const days = resolvesIn / 86_400;
  const base = days <= 1 ? 1 : days <= 7 ? 1.03 : days <= 30 ? 1.05 : 1.1;
  return Math.min(1.2, base + (politics ? 0.05 : 0));
}

/** Atom chances from the legs' chances and correlation matrix, and the fixing inputs. */
function evaluate(
  inputs: BookInputs,
  q: readonly number[],
  r: Matrix,
  stock: StockInput | null,
): { atoms: Float64Array; world: number; dist: Float64Array } {
  const n = q.length;
  const law = n ? joint(q, r, inputs.logic) : { dist: new Float64Array([1]), world: 1 };
  if (!stock)
    return {
      atoms: new Float64Array([1 - law.world, law.world]),
      world: law.world,
      dist: law.dist,
    };
  const atoms = new Float64Array(stock.strikes.length + 2);
  atoms[0] = 1 - law.world;
  const buckets = stockBuckets(stock, q, inputs.legs, law.dist);
  for (let j = 0; j < buckets.length; j++) atoms[j + 1] = law.world * buckets[j]!;
  return { atoms, world: law.world, dist: law.dist };
}

function fixingOf(
  stock: StockInput,
  q: readonly number[],
  legs: readonly LegInput[],
): FixingInputs {
  return {
    kind: stock.kind,
    fixingIn: stock.fixingIn,
    tau: stock.tau,
    vol: stock.vol,
    implied: stock.implied,
    skew1m: stock.skew1m,
    earningsJump: stock.earningsJump,
    legs: q.map((p, i) => ({ p, gap: stock.gaps[i]?.gap ?? 0, resolvesIn: legs[i]!.resolvesIn })),
  };
}
function stockBuckets(
  stock: StockInput,
  q: readonly number[],
  legs: readonly LegInput[],
  dist: Float64Array,
) {
  return fixingBuckets(fixingOf(stock, q, legs), stock.strikes, stock.spot, dist).buckets;
}

/** The oriented correlation matrix with every pair's Fisher z moved by `shift(p)`. */
function matrix(
  n: number,
  wantYes: readonly boolean[],
  estimates: PairEstimate[][],
  shift: (i: number, j: number) => number,
): Matrix {
  const r: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const e = estimates[i]![j]!;
      const sign = wantYes[i] === wantYes[j] ? 1 : -1;
      r[i]![j] = r[j]![i] = sign * fromZ(fisherZ(e.rho) + shift(i, j));
    }
  return n > 1 ? nearestCorrelation(r) : r;
}

/** P(Xₒ ≤ cₒ | X at `fixed` = c there) for the other legs `others` of the kept set. */
function conditionalPass(c: readonly number[], r: Matrix, fixed: number[], others: number[]) {
  if (!others.length) return 1;
  // Schur complement of the fixed block.
  const f = fixed.length;
  const a = fixed.map((i) => fixed.map((j) => r[i]![j]!));
  const inv =
    f === 1
      ? [[1 / a[0]![0]!]]
      : (() => {
          const det = a[0]![0]! * a[1]![1]! - a[0]![1]! * a[1]![0]!;
          return [
            [a[1]![1]! / det, -a[0]![1]! / det],
            [-a[1]![0]! / det, a[0]![0]! / det],
          ];
        })();
  const coef = others.map((o) =>
    fixed.map((_, k) => fixed.reduce((sum, j, l) => sum + r[o]![j]! * inv[l]![k]!, 0)),
  );
  const mean = others.map((_, m) => fixed.reduce((sum, j, k) => sum + coef[m]![k]! * c[j]!, 0));
  const cov = others.map((o, m) =>
    others.map((p) => r[o]![p]! - fixed.reduce((sum, j, k) => sum + coef[m]![k]! * r[j]![p]!, 0)),
  );
  const sd = cov.map((row, m) => Math.sqrt(Math.max(1e-12, row[m]!)));
  const bounds = others.map((o, m) => (c[o]! - mean[m]!) / sd[m]!);
  if (others.length === 1) return normalCdf(bounds[0]!);
  const corr = cov.map((row, m) => row.map((v, l) => (m === l ? 1 : v / (sd[m]! * sd[l]!))));
  return mvnLower(bounds, corr, 1024);
}

export function buildBookModel(inputs: BookInputs): BookModel {
  const { legs, stock } = inputs;
  const n = legs.length;
  const wantYes = legs.map((l) => l.wantYes);
  const q = legs.map((l) => clampProbability(l.wantYes ? l.yes : 1 - l.yes, 1e-6));
  const estimates: PairEstimate[][] = Array.from({ length: n }, () => new Array<PairEstimate>(n));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) estimates[i]![j] = inputs.pair(i, j);
  const r0 = matrix(n, wantYes, estimates, () => 0);
  const base = evaluate(inputs, q, r0, stock);
  const count = base.atoms.length;

  // ---- the center: Gauss–Hermite along the common correlation shift
  const common = (i: number, j: number) =>
    estimates[i]![j]!.se * Math.sqrt(0.5 * estimates[i]![j]!.priorWeight);
  const center = new Float64Array(count);
  let worldCenter = 0;
  const { nodes, weights } = hermiteRule(5);
  for (let g = 0; g < 5; g++) {
    const shifted =
      n > 1 && nodes[g] !== 0
        ? evaluate(
            inputs,
            q,
            matrix(n, wantYes, estimates, (i, j) => common(i, j) * nodes[g]!),
            stock,
          )
        : base;
    for (let a = 0; a < count; a++) center[a]! += weights[g]! * shifted.atoms[a]!;
    worldCenter += weights[g]! * shifted.world;
  }

  // ---- parameters, Jacobian and second-order center terms
  const params: Parameter[] = [];
  const jacobian: Float64Array[] = [];
  const pairs: BookModel["pairs"] = [];
  const add = (p: Parameter, column: Float64Array) => {
    params.push(p);
    jacobian.push(column);
    return params.length - 1;
  };
  // Buckets given the world, at the point estimate: pair moves change P(W) only.
  const share = new Float64Array(count);
  if (base.world > 0) for (let a = 1; a < count; a++) share[a] = base.atoms[a]! / base.world;
  else for (let a = 1; a < count; a++) share[a] = 1 / (count - 1);
  const c = q.map((p) => normalQuantile(p));
  const kept = (() => {
    const implied = new Set<number>();
    for (const l of inputs.logic) if (l.kind === "implies" && !implied.has(l.a)) implied.add(l.b);
    return Array.from({ length: n }, (_, i) => i).filter((i) => !implied.has(i));
  })();
  const impossible = inputs.logic.some((l) => l.kind === "exclusive");
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const e = estimates[i]![j]!;
      const column = new Float64Array(count);
      if (!impossible && kept.includes(i) && kept.includes(j)) {
        const rho = r0[i]![j]!;
        const others = kept.filter((k) => k !== i && k !== j);
        const dW = bivariateNormalPdf(c[i]!, c[j]!, rho) * conditionalPass(c, r0, [i, j], others);
        // dρ_oriented / dz_event = sign·(1 − ρ²); the event-level ρ has the same magnitude.
        const sign = wantYes[i] === wantYes[j] ? 1 : -1;
        const dz = dW * sign * (1 - rho * rho);
        column[0] = -dz;
        for (let a = 1; a < count; a++) column[a] = dz * share[a]!;
      }
      const index = add({ name: `rho:${i}:${j}`, kind: "pair", variance: e.se * e.se }, column);
      pairs.push({ index, i, j });
    }
  const pairCovariance = pairs.map((p) =>
    pairs.map((s) => {
      const a = estimates[p.i]![p.j]!,
        b = estimates[s.i]![s.j]!;
      if (p === s) return a.se * a.se;
      const shares = p.i === s.i || p.i === s.j || p.j === s.i || p.j === s.j;
      return (
        a.se *
        b.se *
        (0.5 * Math.sqrt(a.priorWeight * b.priorWeight) +
          (shares ? 0.5 * Math.sqrt((1 - a.priorWeight) * (1 - b.priorWeight)) : 0))
      );
    }),
  );
  /** Central differences in one input: first and second derivatives of every atom. */
  const difference = (step: number, at: (delta: number) => Float64Array) => {
    const up = at(step),
      down = at(-step);
    const first = new Float64Array(count),
      second = new Float64Array(count);
    for (let a = 0; a < count; a++) {
      first[a] = (up[a]! - down[a]!) / (2 * step);
      second[a] = (up[a]! + down[a]! - 2 * base.atoms[a]!) / (step * step);
    }
    return { first, second };
  };
  const curvature = (second: Float64Array, variance: number) => {
    for (let a = 0; a < count; a++) center[a]! += 0.5 * second[a]! * variance;
  };
  for (let i = 0; i < n; i++) {
    const l = legs[i]!;
    const variance = l.halfSpread ** 2 / 3 + (l.venueGap / 2) ** 2;
    const step = Math.max(1e-4, 0.5 * Math.sqrt(variance));
    const moved = (delta: number) => {
      const next = [...q];
      next[i] = clampProbability(q[i]! + delta, 1e-6);
      return evaluate(inputs, next, r0, stock).atoms;
    };
    const d = difference(step, moved);
    add({ name: `q:${i}`, kind: "q", variance }, d.first);
    curvature(d.second, variance);
  }
  if (stock) {
    const withStock = (s: StockInput) => {
      const atoms = new Float64Array(count);
      atoms[0] = 1 - base.world;
      const buckets = stockBuckets(s, q, legs, base.dist);
      for (let j = 0; j < buckets.length; j++) atoms[j + 1] = base.world * buckets[j]!;
      return atoms;
    };
    stock.gaps.forEach((g, i) => {
      if (g.se <= 0) return;
      const d = difference(0.5 * g.se, (delta) =>
        withStock({
          ...stock,
          gaps: stock.gaps.map((x, k) => (k === i ? { ...x, gap: x.gap + delta } : x)),
        }),
      );
      add({ name: `gap:${i}`, kind: "gap", variance: g.se * g.se }, d.first);
      curvature(d.second, g.se * g.se);
    });
    const volVar = stock.volSe ** 2;
    const dv = difference(0.1, (delta) =>
      withStock({ ...stock, vol: stock.vol * Math.exp(delta) }),
    );
    add({ name: "lnvol", kind: "vol", variance: volVar }, dv.first);
    curvature(dv.second, volVar);
    const ds = difference(0.05, (delta) => withStock({ ...stock, skew1m: stock.skew1m + delta }));
    add({ name: "skew", kind: "skew", variance: stock.skewSe ** 2 }, ds.first);
    curvature(ds.second, stock.skewSe ** 2);
    const dl = difference(0.005, (delta) =>
      withStock({ ...stock, spot: stock.spot * Math.exp(delta) }),
    );
    add({ name: "lnspot", kind: "spot", variance: 0 }, dl.first);
  }
  // The center remains a distribution.
  let total = 0;
  for (let a = 0; a < count; a++) {
    center[a] = Math.max(0, center[a]!);
    total += center[a]!;
  }
  for (let a = 0; a < count; a++) center[a]! /= total;

  // ---- systematic one-sided terms
  const calibrated = q.map((p, i) =>
    clampProbability(
      sigmoid(calibrationSlope(legs[i]!.resolvesIn, legs[i]!.politics) * logit(p)),
      1e-6,
    ),
  );
  const flbAtoms = evaluate(inputs, calibrated, r0, stock).atoms;
  const attenuated =
    n > 1
      ? evaluate(
          inputs,
          q,
          matrix(n, wantYes, estimates, (i, j) => {
            const e = estimates[i]![j]!;
            const ratio = Math.sqrt(
              Math.min(legs[i]!.resolvesIn, legs[j]!.resolvesIn) /
                Math.max(legs[i]!.resolvesIn, legs[j]!.resolvesIn, 1),
            );
            const factor = 1 - (1 - e.priorWeight) * (1 - ratio);
            return fisherZ(e.rho * factor) - fisherZ(e.rho);
          }),
          stock,
        ).atoms
      : base.atoms;
  const flb = new Float64Array(count),
    attenuation = new Float64Array(count);
  for (let a = 0; a < count; a++) {
    flb[a] = flbAtoms[a]! - base.atoms[a]!;
    attenuation[a] = attenuated[a]! - base.atoms[a]!;
  }

  // ---- τ_eff: the book is undecided while every leg resolved so far has passed
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (x, y) => legs[x]!.resolvesIn - legs[y]!.resolvesIn,
  );
  let tauEff = 0,
    t = 0,
    mask = 0;
  for (const i of order) {
    const until = Math.min(legs[i]!.resolvesIn, inputs.decidesIn);
    if (until > t) tauEff += (until - t) * (mask ? passProbability(base.dist, mask) : 1);
    t = Math.max(t, until);
    mask |= 1 << i;
  }
  if (inputs.decidesIn > t)
    tauEff += (inputs.decidesIn - t) * (mask ? passProbability(base.dist, mask) : 1);

  const fx = stock
    ? fixingBuckets(fixingOf(stock, q, legs), stock.strikes, stock.spot, base.dist)
    : null;
  const chain: number[] = [],
    naive: number[] = [];
  let product = 1;
  for (let k = 0; k < n; k++) {
    product *= q[k]!;
    naive.push(product);
    chain.push(k === n - 1 ? base.world : passProbability(base.dist, (1 << (k + 1)) - 1));
  }
  return {
    atoms: count,
    legs: n,
    q,
    point: base.atoms,
    center,
    world: base.world,
    worldCenter,
    params,
    jacobian,
    pairs,
    pairCovariance,
    flb,
    attenuation,
    tauEff,
    legInfo: legs.map((l, i) => ({
      q: q[i]!,
      halfSpread: l.halfSpread,
      // dq = φ(c)·dz: the probit volatility in probability units.
      probabilityVol: (l.probitVol * Math.exp(-0.5 * c[i]! ** 2)) / Math.sqrt(2 * Math.PI),
      resolvesIn: l.resolvesIn,
    })),
    forward: fx?.forward ?? null,
    variance: fx?.variance ?? null,
    spotVol: stock?.vol ?? 0,
    chain,
    naive,
  };
}

/** A bundle's center value, point value and the gradient of its value in every parameter. */
export function bundleSensitivity(model: BookModel, holding: readonly number[]) {
  let value = 0,
    point = 0;
  for (let a = 0; a < model.atoms; a++) {
    value += holding[a]! * model.center[a]!;
    point += holding[a]! * model.point[a]!;
  }
  const gradient = model.jacobian.map((column) => {
    let g = 0;
    for (let a = 0; a < model.atoms; a++) g += holding[a]! * column[a]!;
    return g;
  });
  return { value, point, gradient };
}

/** √(∇Vᵀ Σ_θ ∇V): the bundle value's standard deviation over parameter uncertainty. */
export function valueDeviation(model: BookModel, gradient: readonly number[]) {
  let variance = 0;
  model.params.forEach((p, k) => {
    if (p.kind !== "pair") variance += gradient[k]! ** 2 * p.variance;
  });
  for (let x = 0; x < model.pairs.length; x++)
    for (let y = 0; y < model.pairs.length; y++)
      variance +=
        gradient[model.pairs[x]!.index]! *
        gradient[model.pairs[y]!.index]! *
        model.pairCovariance[x]![y]!;
  return Math.sqrt(Math.max(0, variance));
}

export { varianceYears };
