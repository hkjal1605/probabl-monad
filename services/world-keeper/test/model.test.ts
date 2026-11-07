/** The pricing model: numerics, the joint law (docs/version-2-plan.md §18's table), the fixing,
 * the coherence properties of §15, and the research spec's worked cases. */
import { describe, expect, test } from "bun:test";
import {
  buildBookModel,
  bundleSensitivity,
  type LegInput,
  valueDeviation,
} from "../src/model/book.ts";
import {
  correlationForJoint,
  posterior,
  relationCorrelation,
  themePrior,
} from "../src/model/correlation.ts";
import {
  blendVolatility,
  bucketsFromDigitals,
  digitals,
  isotonicDecreasing,
  resolvedShare,
  varianceYears,
  worldForwardRatio,
} from "../src/model/fixing.ts";
import {
  allPassProbability,
  equicorrelated,
  frechetBounds,
  joint,
  marginals,
  mvnLower,
  outcomeDistribution,
} from "../src/model/joint.ts";
import { factorFit, nearestCorrelation, symmetricEigen } from "../src/model/linalg.ts";
import {
  bivariateNormalCdf,
  hermiteRule,
  normalCdf,
  normalPdf,
  normalQuantile,
  random,
  studentT4Quantile,
} from "../src/model/normal.ts";
import {
  capitalIntegral,
  capitalRate,
  DEFAULT_PRICING,
  guardQuote,
  priceBundle,
  unitsForStake,
} from "../src/pricing.ts";

const DAY = 86_400;
const close = (actual: number, expected: number, tolerance: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

describe("numerics", () => {
  test("Φ, φ and Φ⁻¹ to full precision", () => {
    for (const [x, v] of [
      [0, 0.5],
      [1, 0.8413447460685429],
      [-1.5, 0.06680720126885807],
      [2, 0.9772498680518208],
      [-5, 2.866515718791939e-7],
      [-8, 6.22096057427178e-16],
    ] as const)
      expect(Math.abs(normalCdf(x) - v) / v).toBeLessThan(1e-13);
    for (const p of [1e-12, 1e-6, 0.001, 0.02, 0.15, 0.5, 0.85, 0.98, 0.999999])
      expect(Math.abs(normalCdf(normalQuantile(p)) - p) / Math.min(p, 1 - p)).toBeLessThan(1e-12);
    close(normalPdf(0), 1 / Math.sqrt(2 * Math.PI), 1e-15);
    expect(normalQuantile(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(normalQuantile(1)).toBe(Number.POSITIVE_INFINITY);
  });

  test("Gauss–Hermite integrates normal moments exactly", () => {
    for (const n of [5, 12, 16, 20, 24]) {
      const { nodes, weights } = hermiteRule(n);
      const moment = (k: number) => nodes.reduce((sum, x, i) => sum + weights[i]! * x ** k, 0);
      close(moment(0), 1, 1e-13);
      close(moment(2), 1, 1e-12);
      close(moment(4), 3, 1e-11);
      close(moment(1), 0, 1e-13);
    }
  });

  test("Φ₂ meets its closed forms, its bounds and a brute-force integral", () => {
    for (const r of [-0.999, -0.9, -0.5, 0, 0.3, 0.8, 0.95, 0.999])
      close(bivariateNormalCdf(0, 0, r), 0.25 + Math.asin(r) / (2 * Math.PI), 1e-15);
    // A brute-force integral of the density over a grid.
    const brute = (h: number, k: number, r: number) => {
      const cells = 40_000,
        step = (h + 8) / cells;
      let sum = 0;
      for (let i = 0; i < cells; i++) {
        const x = -8 + (i + 0.5) * step;
        sum += normalPdf(x) * normalCdf((k - r * x) / Math.sqrt(1 - r * r)) * step;
      }
      return sum;
    };
    for (const [h, k, r] of [
      [1, -0.5, 0.6],
      [-1.2, 0.4, -0.7],
      [0.3, 0.3, 0.97],
      [-2, -1, 0.2],
    ] as const)
      close(bivariateNormalCdf(h, k, r), brute(h, k, r), 1e-8);
    close(bivariateNormalCdf(1, 2, 1), normalCdf(1), 1e-15);
    close(bivariateNormalCdf(1, 2, -1), normalCdf(1) - normalCdf(-2), 1e-15);
  });

  test("the t₄ quantile, the generator and the eigen solver", () => {
    close(studentT4Quantile(0.975), 2.776445105, 1e-8);
    close(studentT4Quantile(0.5), 0, 1e-15);
    close(studentT4Quantile(0.01), -3.746947388, 1e-8);
    const a = random(42),
      b = random(42);
    for (let i = 0; i < 100; i++) expect(a.normal()).toBe(b.normal());
    const m = [
      [2, 1, 0],
      [1, 3, 1],
      [0, 1, 4],
    ];
    const { values, vectors } = symmetricEigen(m);
    for (let k = 0; k < 3; k++)
      for (let i = 0; i < 3; i++) {
        const mv = m[i]!.reduce((s, x, j) => s + x * vectors[j]![k]!, 0);
        close(mv, values[k]! * vectors[i]![k]!, 1e-10);
      }
  });
});

describe("the joint law", () => {
  const q = [0.35, 0.15, 0.3];

  test("reproduces the plan's table of P(W) by latent correlation", () => {
    for (const [rho, p] of [
      [0, 0.01575],
      [0.1, 0.0238],
      [0.146, 0.028],
      [0.2, 0.0332],
      [0.4, 0.0559],
      [0.7, 0.1006],
    ] as const)
      close(joint(q, equicorrelated(3, rho)).world, p, 0.00006);
  });

  test("keeps every leg's own chance and the Fréchet bounds", () => {
    const rng = random(3);
    for (let trial = 0; trial < 60; trial++) {
      const n = 1 + Math.floor(rng.uniform() * 6);
      const ps = Array.from({ length: n }, () => 0.03 + 0.94 * rng.uniform());
      // A random correlation matrix from random loadings on three factors.
      const b = ps.map(() => [0, 1, 2].map(() => (rng.uniform() - 0.4) * 0.8));
      const r = ps.map((_, i) =>
        ps.map((_, j) =>
          i === j
            ? 1
            : b[i]!.reduce((s, x, k) => s + x * b[j]![k]!, 0) /
              Math.sqrt(
                (1 + b[i]!.reduce((s, x) => s + x * x, 0)) *
                  (1 + b[j]!.reduce((s, x) => s + x * x, 0)),
              ),
        ),
      );
      const law = joint(ps, r);
      const m = marginals(law.dist, n);
      for (let i = 0; i < n; i++) close(m[i]!, ps[i]!, 2e-6);
      close(
        law.dist.reduce((a, x) => a + x, 0),
        1,
        1e-9,
      );
      const { lower, upper } = frechetBounds(ps);
      expect(law.world).toBeGreaterThanOrEqual(lower - 1e-12);
      expect(law.world).toBeLessThanOrEqual(upper + 1e-12);
    }
  });

  test("agrees with Genz's method and the all-pass integral", () => {
    const r = equicorrelated(4, 0.25);
    const ps = [0.4, 0.6, 0.2, 0.75];
    const law = joint(ps, r);
    close(mvnLower(ps.map(normalQuantile), r), law.world, 2e-5);
    close(allPassProbability(ps, r), law.world, 1e-9);
    // A matrix no three factors fit falls back to Genz on the matrix itself.
    const odd = [
      [1, 0.9, -0.8, 0.1, 0.5],
      [0.9, 1, -0.6, -0.3, 0.2],
      [-0.8, -0.6, 1, 0.4, -0.5],
      [0.1, -0.3, 0.4, 1, 0.7],
      [0.5, 0.2, -0.5, 0.7, 1],
    ];
    const fixed = nearestCorrelation(odd);
    const ps5 = [0.5, 0.45, 0.4, 0.55, 0.6];
    const l = joint(ps5, odd);
    close(l.world, mvnLower(ps5.map(normalQuantile), fixed), 1e-9);
  });

  test("exact logic overrides the model", () => {
    const r = equicorrelated(3, 0.2);
    const base = joint(q, r).world;
    // Leg 0 implies leg 2: the world is "legs 0 and 1".
    const implied = joint(q, r, [{ kind: "implies", a: 0, b: 2 }]).world;
    close(implied, joint([0.35, 0.15], equicorrelated(2, 0.2)).world, 1e-9);
    expect(implied).toBeGreaterThan(base);
    expect(joint(q, r, [{ kind: "exclusive", a: 0, b: 1 }]).world).toBe(0);
  });

  test("factor fits reproduce one-factor structures exactly", () => {
    const { loadings, misfit } = factorFit(equicorrelated(5, 0.3), 1);
    expect(misfit).toBeLessThan(1e-8);
    for (const row of loadings) close(Math.abs(row[0]!), Math.sqrt(0.3), 1e-8);
    expect(outcomeDistribution([0.5], [[0]]).length).toBe(2);
  });
});

describe("correlation estimates", () => {
  test("theme priors, precision weighting and stated relations", () => {
    expect(themePrior(["ai"], ["ai", "market"]).rho).toBe(0.15);
    expect(themePrior(["ai"], ["market"]).rho).toBe(0.08);
    expect(themePrior(["energy"], ["elections"]).rho).toBe(0.03);
    const p = posterior({ rho: 0.15, se: 0.15 }, { rho: 0.5, se: 0.05 });
    expect(p.rho).toBeGreaterThan(0.4);
    expect(p.rho).toBeLessThan(0.5);
    expect(p.se).toBeLessThan(0.05);
    close(p.priorWeight, 0.1, 1e-12);
    // A relation stated from a known latent correlation inverts back to it.
    const rho = 0.35,
      pa = 0.3,
      pb = 0.6;
    const p11 = bivariateNormalCdf(normalQuantile(pa), normalQuantile(pb), rho);
    close(correlationForJoint(pa, pb, p11), rho, 1e-6);
    const bGivenA = p11 / pa,
      bGivenNotA = (pb - p11) / (1 - pa);
    close(relationCorrelation(pa, pb, bGivenA, bGivenNotA), rho, 1e-6);
    // Conditionals that disagree with the venue's marginal keep the venue's marginal.
    expect(relationCorrelation(0.3, 0.6, 0.9, 0.2)).toBeGreaterThan(0.5);
  });
});

describe("the fixing", () => {
  test("variance time counts trading days and 0.1 per weekend", () => {
    // Monday 2026-11-02 14:30 UTC to Monday 2026-11-09 14:30 UTC: 5 trading days and a weekend.
    const from = Date.UTC(2026, 10, 2, 14, 30) / 1000;
    close(varianceYears(from, from + 7 * DAY, "stock") * 252, 5.1, 0.02);
    close(varianceYears(from, from + 7 * DAY, "crypto") * 365, 7, 1e-9);
    // Thanksgiving 2026-11-26 is a holiday gap.
    const wed = Date.UTC(2026, 10, 25, 14, 30) / 1000;
    close(varianceYears(wed, wed + 2 * DAY, "stock") * 252, 1.1, 0.02);
  });

  test("a leg resolving after the fixing moves it only by the share resolved", () => {
    expect(resolvedShare(0.3, 10 * DAY, 5 * DAY)).toBe(1);
    expect(resolvedShare(0.3, 0, 5 * DAY)).toBe(0);
    const half = resolvedShare(0.3, 10 * DAY, 20 * DAY);
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.8);
    expect(resolvedShare(0.3, 19 * DAY, 20 * DAY)).toBeGreaterThan(half);
  });

  test("the forward averages to spot over the joint law", () => {
    const ps = [0.35, 0.15, 0.3];
    const law = joint(ps, equicorrelated(3, 0.146));
    const fx = {
      kind: "stock" as const,
      fixingIn: 28 * DAY,
      tau: 20 / 252,
      vol: 0.47,
      implied: false,
      skew1m: -0.15,
      earningsJump: null,
      legs: ps.map((p, i) => ({ p, gap: [0.08, 0.02, 0.05][i]!, resolvesIn: 20 * DAY })),
    };
    const ratio = worldForwardRatio(fx, law.dist);
    // Σ_ω P(ω) F_ω = S₀: recompute the average with each outcome's own forward.
    let avg = 0;
    for (let o = 0; o < law.dist.length; o++) {
      let e = 0;
      fx.legs.forEach((l, i) => {
        e += l.gap * (((o >> i) & 1) - l.p);
      });
      avg += law.dist[o]! * Math.exp(e);
    }
    const allIn = Math.exp(fx.legs.reduce((s, l) => s + l.gap * (1 - l.p), 0));
    close(ratio * avg, allIn, 1e-12);
    expect(ratio).toBeGreaterThan(1.08);
    expect(ratio).toBeLessThan(1.14);
  });

  test("digitals fall with the strike, sum to one in buckets, and carry the skew", () => {
    const strikes = [220, 230, 240, 250, 260];
    const flat = digitals(strikes, 231.5, 0.13 ** 2, 28 / 365, 0);
    for (let i = 1; i < flat.length; i++) expect(flat[i]!).toBeLessThan(flat[i - 1]!);
    // Without skew, D = N(d₂).
    const v = 0.13;
    close(flat[2]!, normalCdf((Math.log(231.5 / 240) - 0.5 * v * v) / v), 1e-12);
    const skewed = digitals(strikes, 231.5, 0.13 ** 2, 28 / 365, -0.15);
    expect(skewed[2]!).toBeGreaterThan(flat[2]!);
    const buckets = bucketsFromDigitals(skewed);
    close(
      buckets.reduce((a, b) => a + b, 0),
      1,
      1e-12,
    );
    for (const [i, v] of isotonicDecreasing([0.5, 0.6, 0.4, 0.45, 0.1]).entries())
      close(v, [0.55, 0.55, 0.425, 0.425, 0.1][i]!, 1e-15);
    expect(blendVolatility("stock", { yz21: 0.05, yz63: 0.05, ewma: 0.05 }, false)).toBe(0.2);
    close(blendVolatility("stock", { yz21: 0.4, yz63: 0.4, ewma: 0.4 }, false), 0.44, 1e-12);
  });
});

const legs3 = (): LegInput[] =>
  [0.35, 0.15, 0.3].map((yes, i) => ({
    yes,
    halfSpread: [0.005, 0.01, 0.005][i]!,
    venueGap: 0,
    wantYes: true,
    resolvesIn: 28 * DAY,
    probitVol: 0.1,
    politics: false,
  }));
const maya = (strikes = [220, 230, 240, 250, 260]) =>
  buildBookModel({
    legs: legs3(),
    pair: () => ({ rho: 0.146, se: 0.1, priorWeight: 0.5, source: "data" }),
    logic: [],
    stock: {
      kind: "stock",
      spot: 209.06,
      strikes,
      vol: 0.47,
      volSe: 0.085,
      implied: false,
      skew1m: 0,
      skewSe: 0.08,
      earningsJump: null,
      gaps: [
        { gap: 0.08, se: 0.02 },
        { gap: 0.02, se: 0.01 },
        { gap: 0.05, se: 0.015 },
      ],
      fixingIn: 28 * DAY,
      tau: 20 / 252,
    },
    decidesIn: 28 * DAY,
  });

describe("book models", () => {
  test("atoms are a distribution and the world matches the joint law", () => {
    const m = maya();
    expect(m.atoms).toBe(7);
    close(
      m.point.reduce((a, x) => a + x, 0),
      1,
      1e-12,
    );
    close(
      m.center.reduce((a, x) => a + x, 0),
      1,
      1e-12,
    );
    close(1 - m.point[0]!, 0.027987, 2e-6);
    // The center is above the point: P(W) is convex in the correlation.
    expect(m.worldCenter).toBeGreaterThan(m.world);
  });

  test("a bundle and its complement are worth exactly its units", () => {
    const m = maya();
    const units = 1_000;
    const above = [0, 0, 0, 0, units, units, units];
    const rest = above.map((x) => units - x);
    close(bundleSensitivity(m, above).value + bundleSensitivity(m, rest).value, units, 1e-9);
    // A full set has no uncertainty.
    expect(valueDeviation(m, bundleSensitivity(m, new Array(7).fill(units)).gradient)).toBeLessThan(
      1e-9,
    );
  });

  test("the pair gradient (Plackett) matches a finite difference", () => {
    const pair = (rho: number) =>
      buildBookModel({
        legs: legs3(),
        pair: (i, j) => ({
          rho: i === 0 && j === 1 ? rho : 0.146,
          se: 0.1,
          priorWeight: 0.5,
          source: "data",
        }),
        logic: [],
        stock: null,
        decidesIn: 28 * DAY,
      });
    const m = pair(0.146);
    const k = m.params.findIndex((p) => p.name === "rho:0:1");
    const h = 1e-4,
      dz = Math.atanh(0.146);
    const up = pair(Math.tanh(dz + h)).point[1]!,
      down = pair(Math.tanh(dz - h)).point[1]!;
    close(m.jacobian[k]![1]!, (up - down) / (2 * h), 1e-7);
  });

  test("τ_eff ends early when a leg can fail early", () => {
    const legs = legs3();
    legs[0]!.resolvesIn = 7 * DAY;
    const m = buildBookModel({
      legs,
      pair: () => ({ rho: 0.146, se: 0.1, priorWeight: 0.5, source: "data" }),
      logic: [],
      stock: null,
      decidesIn: 28 * DAY,
    });
    close(m.tauEff / DAY, 7 + 21 * 0.35, 0.01);
  });
});

describe("prices", () => {
  const risk = (deltaK: number, variance: number) => ({
    deltaK,
    utilization: 0.3,
    nav: 1_000_000,
    variance,
    covariance: 0,
    gammaScale: 1,
  });
  test("the research's case (a1): the 3-leg world at about 3.5¢ over 2.8¢", () => {
    const m = buildBookModel({
      legs: legs3(),
      pair: () => ({ rho: 0.146, se: 0.1, priorWeight: 0.5, source: "data" }),
      logic: [],
      stock: null,
      decidesIn: 28 * DAY,
    });
    const units = 100 / 0.0355,
      P = m.center[1]!;
    const q = priceBundle({
      model: m,
      holding: [0, units],
      side: "ask",
      kappa: [0.02, 0.02, 0.02],
      staleSeconds: 15,
      priorOnly: false,
      risk: risk(units * (1 - 0.0355), units * units * P * (1 - P)),
      policy: DEFAULT_PRICING,
    });
    const cents = (x: number) => (100 * x) / units;
    close(cents(q.price), 3.53, 0.05);
    close(cents(q.components.ambiguity), 0.38, 0.02);
    close(cents(q.components.capital), 0.22, 0.01);
    close(cents(q.components.information), 0.1, 0.01);
    close(cents(q.components.inventory), 0.015, 0.002);
  });

  test("the research's case (b): a 40% leg at 40.8¢ / 39.0¢", () => {
    const m = buildBookModel({
      legs: [
        {
          yes: 0.4,
          halfSpread: 0.005,
          venueGap: 0,
          wantYes: true,
          resolvesIn: 28 * DAY,
          probitVol: 0.1,
          politics: false,
        },
      ],
      pair: () => ({ rho: 0, se: 0.1, priorWeight: 1, source: "prior" }),
      logic: [],
      stock: null,
      decidesIn: 28 * DAY,
    });
    const units = 250,
      P = 0.4;
    const ask = priceBundle({
      model: m,
      holding: [0, units],
      side: "ask",
      kappa: [0.02],
      staleSeconds: 15,
      priorOnly: false,
      risk: risk(units * 0.6, units * units * P * (1 - P)),
      policy: DEFAULT_PRICING,
    });
    const bid = priceBundle({
      model: m,
      holding: [0, units],
      side: "bid",
      kappa: [0.02],
      staleSeconds: 15,
      priorOnly: false,
      risk: risk(-units * 0.4, units * units * P * (1 - P)),
      policy: DEFAULT_PRICING,
    });
    close((100 * ask.price) / units, 40.8, 0.05);
    close((100 * bid.price) / units, 38.95, 0.1);
  });

  test("conditional payouts and world bets on Maya's book", () => {
    const m = maya();
    const D = (m.center[4]! + m.center[5]! + m.center[6]!) / (1 - m.center[0]!);
    // The research's in-world fair is 36.6% at ψ = 0.
    close(D, 0.366, 0.012);
  });

  test("the capital curve integrates exactly and is path independent", () => {
    const c = DEFAULT_PRICING.capital;
    expect(capitalRate(c, 0)).toBe(0.01);
    close(capitalRate(c, 0.6), 0.05, 1e-15);
    close(capitalRate(c, 0.8), 0.4, 1e-15);
    let numeric = 0;
    const cells = 55_000;
    for (let i = 0; i < cells; i++)
      numeric += (capitalRate(c, 0.2 + ((i + 0.5) * 0.55) / cells) * 0.55) / cells;
    close(capitalIntegral(c, 0.2, 0.75), numeric, 1e-9);
    close(
      capitalIntegral(c, 0.1, 0.5) + capitalIntegral(c, 0.5, 0.7),
      capitalIntegral(c, 0.1, 0.7),
      1e-15,
    );
    close(capitalIntegral(c, 0.7, 0.1), -capitalIntegral(c, 0.1, 0.7), 1e-15);
  });

  test("guards bracket the center and decline what they must", () => {
    const base = {
      center: 100,
      point: 100,
      markup: 0,
      components: {
        ambiguity: 0,
        flb: 0,
        horizon: 0,
        information: 0,
        stale: 0,
        capital: 0,
        inventory: 0,
      },
    };
    const g = (price: number, side: "ask" | "bid", units: number | null = null) =>
      guardQuote(
        { ...base, price },
        { side, maxPay: 1_000, minPay: 0, policy: DEFAULT_PRICING, worldBetUnits: units },
      );
    expect(g(100.2, "ask")).toEqual({ price: 101 });
    expect(g(99.5, "bid")).toEqual({ price: 99 });
    expect("decline" in g(170, "ask")).toBe(true);
    expect("decline" in g(30, "bid")).toBe(true);
    expect("decline" in g(101, "ask", 1_000_000)).toBe(true); // 0.01¢ a unit
  });

  test("a stake buys the most units its price allows", () => {
    const price = (n: number) => n * 0.03 + Math.sqrt(n);
    const n = unitsForStake(100, 0.03, price);
    expect(price(n)).toBeLessThanOrEqual(100);
    expect(price(n + 1)).toBeGreaterThan(100);
  });
});
