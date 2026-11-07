// biome-ignore-all lint/correctness/noPrecisionLoss: published coefficients (Cody, Wichura), kept digit for digit.
/** The normal distribution and Gauss–Hermite quadrature, deterministic and in double precision:
 * everything the joint model and the fixing distribution integrate with. */

/** Φ(x), the standard normal CDF: W. J. Cody's rational approximations of erfc (relative error
 * below 1e-15 across the range), so tails far from the mean keep their precision. */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x === Number.POSITIVE_INFINITY) return 1;
  if (x === Number.NEGATIVE_INFINITY) return 0;
  const z = -x / Math.SQRT2;
  return 0.5 * erfc(z);
}

/** φ(x), the standard normal density. */
export const normalPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** erfc(x) after Cody (1969), "Rational Chebyshev approximations for the error function". */
function erfc(x: number): number {
  const ax = Math.abs(x);
  let result: number;
  if (ax < 0.5) {
    const t = x * x;
    const top =
      (((0.185777706184603153 * t + 3.1611237438705656) * t + 113.864154151050156) * t +
        377.485237685302021) *
        t +
      3209.37758913846947;
    const bottom =
      (((t + 23.6012909523441209) * t + 244.024637934444173) * t + 1282.61652607737228) * t +
      2844.23683343917062;
    return 1 - (x * top) / bottom;
  }
  if (ax < 4) {
    const top =
      (((((((2.15311535474403846e-8 * ax + 0.564188496988670089) * ax + 8.88314979438837594) * ax +
        66.1191906371416295) *
        ax +
        298.635138197400131) *
        ax +
        881.95222124176909) *
        ax +
        1712.04761263407058) *
        ax +
        2051.07837782607147) *
        ax +
      1230.33935479799725;
    const bottom =
      (((((((ax + 15.7449261107098347) * ax + 117.693950891312499) * ax + 537.181101862009858) *
        ax +
        1621.38957456669019) *
        ax +
        3290.79923573345963) *
        ax +
        4362.61909014324716) *
        ax +
        3439.36767414372164) *
        ax +
      1230.33935480374942;
    result = Math.exp(-ax * ax) * (top / bottom);
  } else {
    const z = 1 / (ax * ax);
    const top =
      ((((0.0163153871373020978 * z + 0.305326634961232344) * z + 0.360344899949804439) * z +
        0.125781726111229246) *
        z +
        0.0160837851487422766) *
        z +
      0.000658749161529837803;
    const bottom =
      ((((z + 2.56852019228982242) * z + 1.87295284992346725) * z + 0.527905102951428412) * z +
        0.0605183413124413191) *
        z +
      0.00233520497626869185;
    result = (Math.exp(-ax * ax) / ax) * (1 / Math.sqrt(Math.PI) - (z * top) / bottom);
  }
  return x < 0 ? 2 - result : result;
}

/** Φ⁻¹(p), the standard normal quantile: Wichura's AS 241 (PPND16), relative error about 1e-16. */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return Number.NEGATIVE_INFINITY;
    if (p === 1) return Number.POSITIVE_INFINITY;
    return Number.NaN;
  }
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (
      (q *
        (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r +
          45921.953931549871457) *
          r +
          13731.693765509461125) *
          r +
          1971.5909503065514427) *
          r +
          133.14166789178437745) *
          r +
          3.387132872796366608)) /
      (((((((5226.495278852545925 * r + 28729.085735721942674) * r + 39307.89580009271061) * r +
        21213.794301586595867) *
        r +
        5394.1960214247511077) *
        r +
        687.1870074920579083) *
        r +
        42.313330701600911252) *
        r +
        1)
    );
  }
  let r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let value: number;
  if (r <= 5) {
    r -= 1.6;
    value =
      (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r +
        0.24178072517745061177) *
        r +
        1.27045825245236838258) *
        r +
        3.64784832476320460504) *
        r +
        5.7694972214606914055) *
        r +
        4.6303378461565452959) *
        r +
        1.42343711074968357734) /
      (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r +
        0.0151986665636164571966) *
        r +
        0.14810397642748007459) *
        r +
        0.68976733498510000455) *
        r +
        1.6763848301838038494) *
        r +
        2.05319162663775882187) *
        r +
        1);
  } else {
    r -= 5;
    value =
      (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r +
        0.0012426609473880784386) *
        r +
        0.026532189526576123093) *
        r +
        0.29656057182850489123) *
        r +
        1.7848265399172913358) *
        r +
        5.4637849111641143699) *
        r +
        6.6579046435011037772) /
      (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r +
        1.8463183175100546818e-5) *
        r +
        7.868691311456132591e-4) *
        r +
        0.0148753612908506148525) *
        r +
        0.13692988092273580531) *
        r +
        0.59983220655588793769) *
        r +
        1);
  }
  return q < 0 ? -value : value;
}

/** Nodes and weights of n-point Gauss–Hermite quadrature for E[f(Z)], Z standard normal
 * (probabilists' weight e^(−x²/2)/√(2π)): Σ wᵢ f(xᵢ), exact for polynomials up to degree
 * 2n − 1. Found by Newton's method on the orthonormal Hermite recurrence (Golub–Welsch's
 * eigen-free form, as in Numerical Recipes' gauher), cached per n. */
const rules = new Map<number, { nodes: Float64Array; weights: Float64Array }>();
export function hermiteRule(n: number) {
  const cached = rules.get(n);
  if (cached) return cached;
  if (!Number.isInteger(n) || n < 1 || n > 64) throw new Error("1 to 64 quadrature nodes");
  // Physicists' rule (weight e^(−x²)), then rescaled: x → √2 x, w → w / √π.
  const x = new Float64Array(n),
    w = new Float64Array(n);
  const PIM4 = 0.7511255444649425; // π^(−1/4)
  const m = Math.floor((n + 1) / 2);
  let z = 0;
  for (let i = 0; i < m; i++) {
    if (i === 0) z = Math.sqrt(2 * n + 1) - 1.85575 * (2 * n + 1) ** -0.16667;
    else if (i === 1) z -= (1.14 * n ** 0.426) / z;
    else if (i === 2) z = 1.86 * z - 0.86 * x[0]!;
    else if (i === 3) z = 1.91 * z - 0.91 * x[1]!;
    else z = 2 * z - x[i - 2]!;
    let pp = 0;
    for (let iter = 0; iter < 100; iter++) {
      let p1 = PIM4,
        p2 = 0;
      for (let j = 0; j < n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = z * Math.sqrt(2 / (j + 1)) * p2 - Math.sqrt(j / (j + 1)) * p3;
      }
      pp = Math.sqrt(2 * n) * p2;
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) <= 1e-15) break;
    }
    x[i] = z;
    x[n - 1 - i] = -z;
    w[i] = 2 / (pp * pp);
    w[n - 1 - i] = w[i]!;
  }
  const nodes = new Float64Array(n),
    weights = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    nodes[i] = x[i]! * Math.SQRT2;
    weights[i] = w[i]! / Math.sqrt(Math.PI);
  }
  const rule = { nodes, weights };
  rules.set(n, rule);
  return rule;
}

/** Clamps a probability away from 0 and 1 by `eps` (quantiles of 0 and 1 are infinite). */
export const clampProbability = (p: number, eps = 1e-9) => Math.min(1 - eps, Math.max(eps, p));

/** Nodes (positive half) and weights of n-point Gauss–Legendre quadrature on [−1, 1], n even. */
const legendre = new Map<number, { x: Float64Array; w: Float64Array }>();
export function legendreRule(n: number) {
  const cached = legendre.get(n);
  if (cached) return cached;
  const half = Math.floor(n / 2);
  const x = new Float64Array(half),
    w = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5)),
      pp = 0;
    for (let iter = 0; iter < 100; iter++) {
      let p1 = 1,
        p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x[i] = z;
    w[i] = 2 / ((1 - z * z) * pp * pp);
  }
  const rule = { x, w };
  legendre.set(n, rule);
  return rule;
}

/** P(X > h, Y > k) for standard normals of correlation r: Genz's BVND (2004), accurate to
 * about 1e-15, including r near ±1. */
function bvnUpper(dh: number, dk: number, r: number): number {
  const { x, w } = legendreRule(Math.abs(r) < 0.3 ? 6 : Math.abs(r) < 0.75 ? 12 : 20);
  let h = dh,
    k = dk,
    hk = h * k,
    bvn = 0;
  const TWOPI = 2 * Math.PI;
  if (Math.abs(r) < 0.925) {
    const hs = (h * h + k * k) / 2,
      asr = Math.asin(r);
    for (let i = 0; i < x.length; i++)
      for (const sign of [-1, 1]) {
        const sn = Math.sin((asr * (sign * x[i]! + 1)) / 2);
        bvn += w[i]! * Math.exp((sn * hk - hs) / (1 - sn * sn));
      }
    return (bvn * asr) / (2 * TWOPI) + normalCdf(-h) * normalCdf(-k);
  }
  if (r < 0) {
    k = -k;
    hk = -hk;
  }
  if (Math.abs(r) < 1) {
    const as = (1 - r) * (1 + r);
    let a = Math.sqrt(as);
    const bs = (h - k) ** 2,
      c = (4 - hk) / 8,
      d = (12 - hk) / 16;
    let asr = -(bs / as + hk) / 2;
    if (asr > -100)
      bvn =
        a * Math.exp(asr) * (1 - (c * (bs - as) * (1 - (d * bs) / 5)) / 3 + (c * d * as * as) / 5);
    if (-hk < 100) {
      const b = Math.sqrt(bs);
      bvn -=
        Math.exp(-hk / 2) *
        Math.sqrt(TWOPI) *
        normalCdf(-b / a) *
        b *
        (1 - (c * bs * (1 - (d * bs) / 5)) / 3);
    }
    a /= 2;
    for (let i = 0; i < x.length; i++)
      for (const sign of [-1, 1]) {
        const xs = (a * (sign * x[i]! + 1)) ** 2,
          rs = Math.sqrt(1 - xs);
        asr = -(bs / xs + hk) / 2;
        if (asr > -100)
          bvn +=
            a *
            w[i]! *
            Math.exp(asr) *
            (Math.exp((-hk * (1 - rs)) / (2 * (1 + rs))) / rs - (1 + c * xs * (1 + d * xs)));
      }
    bvn = -bvn / TWOPI;
  }
  if (r > 0) return bvn + normalCdf(-Math.max(h, k));
  bvn = -bvn;
  if (k > h) bvn += normalCdf(k) - normalCdf(h);
  return bvn;
}

/** Φ₂(h, k; ρ) = P(X ≤ h, Y ≤ k) for standard normals of correlation ρ. */
export function bivariateNormalCdf(h: number, k: number, rho: number): number {
  if (rho >= 1) return normalCdf(Math.min(h, k));
  if (rho <= -1) return Math.max(0, normalCdf(h) - normalCdf(-k));
  return Math.min(1, Math.max(0, bvnUpper(-h, -k, rho)));
}

/** The density of a standard bivariate normal of correlation ρ at (h, k). */
export const bivariateNormalPdf = (h: number, k: number, rho: number) =>
  Math.exp(-(h * h - 2 * rho * h * k + k * k) / (2 * (1 - rho * rho))) /
  (2 * Math.PI * Math.sqrt(1 - rho * rho));

/** The Student-t quantile at 4 degrees of freedom, in closed form (Shaw 2006). */
export function studentT4Quantile(p: number): number {
  if (!(p > 0 && p < 1))
    return p === 0 ? Number.NEGATIVE_INFINITY : p === 1 ? Number.POSITIVE_INFINITY : Number.NaN;
  const alpha = 4 * p * (1 - p);
  const q = Math.cos(Math.acos(Math.sqrt(alpha)) / 3) / Math.sqrt(alpha);
  return Math.sign(p - 0.5) * 2 * Math.sqrt(Math.max(0, q - 1));
}

/** A deterministic generator (mulberry32) of uniforms in (0, 1), and normals by Box–Muller:
 * every simulation here is reproducible from its seed. */
export function random(seed: number) {
  let a = seed >>> 0;
  let spare: number | null = null;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4_294_967_296;
  };
  const normal = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    const r = Math.sqrt(-2 * Math.log(uniform())),
      theta = 2 * Math.PI * uniform();
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
  return { uniform, normal };
}
