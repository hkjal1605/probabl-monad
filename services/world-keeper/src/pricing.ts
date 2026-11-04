/** A bundle's price (research spec §1.6), from a cached book model and the vault's risk state,
 * with no I/O:
 *
 *   ask = V_c + z·SD_V + max(0, A_FLB) + max(0, A_hor) + I⁺ + O + C(ΔK) + R(ΔL)
 *   bid = V_c − z·SD_V + min(0, A_FLB) + min(0, A_hor) − I⁻ − O − C(ΔK) − R(ΔL)
 *
 * - V_c, the posterior center; SD_V = √(∇Vᵀ Σ_θ ∇V), the model's uncertainty (an ellipsoid,
 *   not box corners); A_FLB and A_hor, the one-sided favorite–longshot and horizon terms.
 * - I±, information: each leg tilted κᵢ in logit against the vault (multiplicative in odds, as a
 *   Glosten–Milgrom binary implies), linearized through the leg's sensitivity.
 * - O, the free option a firm quote gives while it lives and its reference ages.
 * - C, capital at its shadow cost: τ_eff·NAV·∫ r(x)dx over the utilization the fill moves
 *   through, on a kinked curve (1% → 5% at 60% → 40% at 80%), so splitting saves nothing.
 * - R, inventory: (γ/2)[Var ΔX + 2·Cov(X, ΔX)] with γ = 1/(¼·NAV), negative for offsetting
 *   trades and growing with size (the depth curve).
 * C and R are signed: a fill that frees capital or offsets risk is credited.
 *
 * Guards: every ask is at least 1% over the center and every bid 1% under (no quote crosses
 * fair, so no round trip between books profits), markups over 60% (30% inside the world for a
 * conditional payout) and world bets under half a cent are declined. A conditional payout's 1%
 * is of the bet inside it, its value net of the refund units: the refund is the stake coming
 * back, and a markup on it would be many times the bet's. */
import { type BookModel, bundleSensitivity, valueDeviation } from "./model/book.ts";

export interface CapitalCurve {
  /** r(0), r at `kink` utilization, r at `top` (the most the vault uses). */
  r0: number;
  kink: number;
  rKink: number;
  top: number;
  rTop: number;
}
export interface PricingPolicy {
  /** Ambiguity aversion: z standard deviations of model uncertainty (0.75 for prior-only). */
  z: number;
  zPriorOnly: number;
  /** Per-leg logit tilts. */
  kappa0: number;
  kappaInsider: number;
  /** Ramps to this over the last 24 hours before a scheduled resolution. */
  kappaScheduled: number;
  /** For 30 minutes after a probability jump. */
  kappaJump: number;
  kappaRequesterCap: number;
  /** Weight of the stale-quote option. */
  staleFactor: number;
  minMarkup: number;
  maxMarkup: number;
  maxConditionalMarkup: number;
  /** Smallest world-bet price per unit (raw quote per raw unit). */
  minUnitPrice: number;
  /** Smallest ask over the center, per unit of the bundle's largest payout. */
  minTick: number;
  capital: CapitalCurve;
  /** γ = 1 / (gammaNavFraction · NAV). */
  gammaNavFraction: number;
  /** Count the books' taker fee as the vault's revenue (true while the vault is protocol capital,
   * v2.0): quotes improve by up to the fee, never past the bracket. Off once outside LPs join. */
  feeCredit: boolean;
}
export const DEFAULT_PRICING: PricingPolicy = {
  z: 0.5,
  zPriorOnly: 0.75,
  kappa0: 0.02,
  kappaInsider: 0.02,
  kappaScheduled: 0.1,
  kappaJump: 0.05,
  kappaRequesterCap: 0.3,
  staleFactor: 0.4,
  minMarkup: 0.01,
  maxMarkup: 0.6,
  maxConditionalMarkup: 0.3,
  minUnitPrice: 0.005,
  minTick: 0.0002,
  capital: { r0: 0.01, kink: 0.6, rKink: 0.05, top: 0.8, rTop: 0.4 },
  gammaNavFraction: 0.25,
  feeCredit: true,
};

/** The capital rate at utilization x (annual). */
export function capitalRate(c: CapitalCurve, x: number) {
  if (x <= c.kink) return c.r0 + ((c.rKink - c.r0) * Math.max(0, x)) / c.kink;
  return c.rKink + ((c.rTop - c.rKink) * (x - c.kink)) / (c.top - c.kink);
}
/** ∫ r(x) dx from `from` to `to` (signed: negative when utilization falls). */
export function capitalIntegral(c: CapitalCurve, from: number, to: number): number {
  if (to < from) return -capitalIntegral(c, to, from);
  const F = (x: number) => {
    const a = Math.min(x, c.kink);
    let v = c.r0 * a + ((c.rKink - c.r0) * a * a) / (2 * c.kink);
    if (x > c.kink) {
      const b = x - c.kink;
      v += c.rKink * b + ((c.rTop - c.rKink) * b * b) / (2 * (c.top - c.kink));
    }
    return v;
  };
  return F(Math.max(0, to)) - F(Math.max(0, from));
}

/** What a bundle does to the vault, from the risk engine. */
export interface RiskImpact {
  /** Change in capital locked (worst case after netting, in-flight quotes included), raw. */
  deltaK: number;
  /** Utilization before the fill. */
  utilization: number;
  nav: number;
  /** Var(ΔX) and Cov(X, ΔX) of the vault's terminal value, raw². */
  variance: number;
  covariance: number;
  /** γ multiplier (2 while the vault's CVaR is over its soft limit). */
  gammaScale: number;
}

export interface QuoteInput {
  model: BookModel;
  /** The bundle per atom, raw units, as the taker receives (buy) or delivers (sell) it. */
  holding: readonly number[];
  /** "ask": the vault sells; "bid": it buys. */
  side: "ask" | "bid";
  /** Per-leg κ (logit units), from the schedule, jumps, insider risk and the requester. */
  kappa: readonly number[];
  /** Seconds the quote lives plus its reference's age. */
  staleSeconds: number;
  /** Whether every pair rests on priors alone (z rises). */
  priorOnly: boolean;
  risk: RiskImpact;
  policy: PricingPolicy;
}
export interface Quote {
  price: number;
  center: number;
  point: number;
  markup: number;
  components: {
    ambiguity: number;
    flb: number;
    horizon: number;
    information: number;
    stale: number;
    capital: number;
    inventory: number;
  };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

/** The price of one bundle (no guards: `guardQuote` applies them). */
export function priceBundle(input: QuoteInput): Quote {
  const { model, holding, side, policy, risk } = input;
  const { value, point, gradient } = bundleSensitivity(model, holding);
  const sd = valueDeviation(model, gradient);
  const z = input.priorOnly ? policy.zPriorOnly : policy.z;
  let flb = 0,
    horizon = 0;
  for (let a = 0; a < model.atoms; a++) {
    flb += holding[a]! * model.flb[a]!;
    horizon += holding[a]! * model.attenuation[a]!;
  }
  // Information: each leg tilted in logit against the vault's side, through its sensitivity.
  let information = 0,
    staleVariance = 0;
  model.params.forEach((p, k) => {
    if (p.kind === "q") {
      const i = Number(p.name.slice(2));
      const q = model.legInfo[i]!.q,
        g = gradient[k]!;
      const kappa = input.kappa[i] ?? policy.kappa0;
      const direction = (side === "ask" ? 1 : -1) * Math.sign(g);
      information += Math.abs(g) * Math.abs(sigmoid(logit(q) + direction * kappa) - q);
      staleVariance += (g * model.legInfo[i]!.probabilityVol) ** 2 / 86_400;
    } else if (p.kind === "spot") {
      staleVariance += (gradient[k]! * model.spotVol) ** 2 / (252 * 23_400);
    }
  });
  const stale = policy.staleFactor * Math.sqrt(Math.max(0, input.staleSeconds) * staleVariance);
  const years = model.tauEff / (365 * 86_400);
  const capital =
    risk.nav > 0
      ? years *
        risk.nav *
        capitalIntegral(policy.capital, risk.utilization, risk.utilization + risk.deltaK / risk.nav)
      : 0;
  const gamma = risk.nav > 0 ? risk.gammaScale / (policy.gammaNavFraction * risk.nav) : 0;
  const inventory = (gamma / 2) * (risk.variance + 2 * risk.covariance);
  const ambiguity = z * sd;
  const price =
    side === "ask"
      ? value +
        ambiguity +
        Math.max(0, flb) +
        Math.max(0, horizon) +
        information +
        stale +
        capital +
        inventory
      : value -
        ambiguity +
        Math.min(0, flb) +
        Math.min(0, horizon) -
        information -
        stale -
        capital -
        inventory;
  return {
    price,
    center: value,
    point,
    markup: value > 0 ? price / value - 1 : 0,
    components: {
      ambiguity,
      flb: side === "ask" ? Math.max(0, flb) : Math.min(0, flb),
      horizon: side === "ask" ? Math.max(0, horizon) : Math.min(0, horizon),
      information,
      stale,
      capital,
      inventory,
    },
  };
}

/** The bracket and markup guards: the price to quote, or why not to. */
export function guardQuote(
  quote: Quote,
  options: {
    side: "ask" | "bid";
    maxPay: number;
    minPay: number;
    policy: PricingPolicy;
    /** Units, for the unit-price floor of a world bet (null for other bundles). */
    worldBetUnits: number | null;
    /** The center value of the bundle's refund units (zero without them). */
    refundValue?: number;
  },
): { price: number } | { decline: string } {
  const { policy, side } = options;
  const v = quote.center;
  if (!(v > 0) || !Number.isFinite(quote.price)) return { decline: "No fair value" };
  // What the markups apply to: the bundle, net of its refund units.
  const risky = Math.max(v - (options.refundValue ?? 0), 0);
  if (side === "ask") {
    const floor = Math.max(v + risky * policy.minMarkup, v + policy.minTick * options.maxPay);
    const price = Math.max(quote.price, floor);
    if (price > v + risky * policy.maxMarkup)
      return { decline: "Too uncertain to quote at a fair markup" };
    if (options.worldBetUnits && price / options.worldBetUnits < policy.minUnitPrice)
      return { decline: "World bets under half a cent are not quoted" };
    if (price > options.maxPay) return { decline: "The price exceeds what the bundle pays" };
    return { price };
  }
  const ceiling = v - risky * policy.minMarkup;
  const price = Math.min(quote.price, ceiling);
  if (price < v - risky * policy.maxMarkup)
    return { decline: "Too uncertain to bid at a fair markup" };
  if (price <= options.minPay)
    return { decline: "The bid is not above what the bundle surely pays" };
  return { price };
}

/** The most units `stake` buys of `unit` (atoms per unit) plus `refund` units of atom 0, at the
 * vault's ask: bisection on the price, which increases in the units. `price(n)` returns the
 * guarded ask of n units, or null when n is declined. */
export function unitsForStake(
  stake: number,
  unitPrice: number,
  price: (units: number) => number | null,
): number {
  if (!(stake > 0) || !(unitPrice > 0)) return 0;
  let lo = 0,
    hi = Math.ceil(stake / unitPrice) + 1;
  for (let iter = 0; iter < 80 && hi - lo > 1; iter++) {
    const mid = Math.floor((lo + hi) / 2);
    const p = price(mid);
    if (p !== null && p <= stake) lo = mid;
    else hi = mid;
  }
  return lo;
}
