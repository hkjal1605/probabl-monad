/** World keeper settings (`WK_CONFIG_PATH`, config.example.json): the vault it quotes for, the
 * pricing and risk policy (research spec §1.6–1.9 defaults), the gates on live references,
 * each underlying's volatility class, and gas limits. Anything missing takes its default;
 * anything malformed stops the keeper at start. */
import { type Address, getAddress, isAddress } from "viem";
import { DEFAULT_THEMES, type ThemePolicy } from "./model/correlation.ts";
import type { AssetKind } from "./model/fixing.ts";
import { DEFAULT_PRICING, type PricingPolicy } from "./pricing.ts";

export interface RiskPolicy {
  /** Capital one fill may lock, in shares of NAV. */
  perFill: number;
  /** A book's worst case: at most this share of NAV and `kelly` of the Kelly fraction. */
  perBook: number;
  kelly: number;
  /** Σ worst cases of the books on one leg. */
  perLeg: number;
  /** The worst case of a theme with its legs comonotone. */
  perTheme: number;
  /** CVaR₉₉ under a t-copula (ν = 4, correlations + 2 SE): above it γ doubles. */
  cvar: number;
  /** Capital locked (in-flight quotes included) over NAV. */
  maxUtilization: number;
  /** A requester's outstanding worst case, its share of a book's cap, and its new worst case
   * per 24 hours. */
  requesterOutstanding: number;
  requesterBookShare: number;
  requesterDaily: number;
  /** Quoting halts once the marked NAV falls this far (bps) within `drawdownWindowMs`. */
  maxDrawdownBps: number;
  drawdownWindowMs: number;
}
export interface QuotePolicy {
  /** Seconds a quote lives (at most the vault's `maxTtl`). */
  ttlSeconds: number;
  /** Within `nearSeconds` of a leg's scheduled resolution, quotes live `nearTtlSeconds`. */
  nearTtlSeconds: number;
  nearSeconds: number;
  /** No quote within this long of a leg's scheduled resolution. */
  stopSeconds: number;
  /** A standard ticket for indications, whole quote tokens. */
  indicationStake: string;
  indicationMs: number;
}
export interface ReferencePolicy {
  /** The oldest venue tick a quote prices from. */
  maxReferenceAgeMs: number;
  /** Venue spreads wider than this (probability) are not quoted on. */
  maxSpread: number;
  /** Legs priced outside [floor, 1 − floor] are not quoted. */
  probabilityFloor: number;
  /** A move over max(jumpPoints, jumpSigma·σ₁₅ₘ) starts the jump window. */
  jumpPoints: number;
  jumpSigma: number;
  jumpWindowMs: number;
  /** Spot older than this, or this far (bps) from the feed, is not quoted on. */
  maxSpotAgeMs: number;
  maxSpotDeviationBps: number;
  /** Testnets: price from a stale spot (outside market hours). */
  allowStaleSpot: boolean;
}
export interface UnderlyingSettings {
  kind: AssetKind;
  /** The token whose API spot price is the reference (else the feed alone). */
  token?: Address;
  /** Volatility override (annual) and its relative error; whether it is implied. */
  vol?: number;
  volSe?: number;
  implied?: boolean;
  skew1m?: number;
  skewSe?: number;
  /** Earnings dates (ISO) and the RMS earnings-day log move. */
  earnings?: { dates: string[]; jump: number };
}
export interface Settings {
  vault: Address;
  pricing: PricingPolicy;
  themes: ThemePolicy;
  risk: RiskPolicy;
  quotes: QuotePolicy;
  references: ReferencePolicy;
  underlyings: Record<string, UnderlyingSettings>;
  /** A leg's gap without a fit: zero, with this error (log units). */
  defaultGapSe: number;
  /** Reviewed gaps by `${condition}:${underlying}` (log move on YES), over any fit. */
  gaps: Record<string, { gap: number; se: number }>;
  /** Event themes counted as politics or decided by small groups. */
  politicsThemes: string[];
  insiderThemes: string[];
  /** Housekeeping cadence (settle, sync, model refresh), ms. */
  pollMs: number;
  receiptPollMs: number;
  minGasWei: string;
  dailyGasBudgetWei: string;
}

export const DEFAULT_RISK: RiskPolicy = {
  perFill: 0.005,
  perBook: 0.02,
  kelly: 0.25,
  perLeg: 0.06,
  perTheme: 0.15,
  cvar: 0.1,
  maxUtilization: 0.8,
  requesterOutstanding: 0.005,
  requesterBookShare: 0.25,
  requesterDaily: 0.01,
  maxDrawdownBps: 500,
  drawdownWindowMs: 86_400_000,
};
export const DEFAULT_QUOTES: QuotePolicy = {
  ttlSeconds: 10,
  nearTtlSeconds: 5,
  nearSeconds: 7_200,
  stopSeconds: 900,
  indicationStake: "100",
  indicationMs: 10_000,
};
export const DEFAULT_REFERENCES: ReferencePolicy = {
  maxReferenceAgeMs: 45_000,
  maxSpread: 0.1,
  probabilityFloor: 0.02,
  jumpPoints: 0.05,
  jumpSigma: 3,
  jumpWindowMs: 1_800_000,
  maxSpotAgeMs: 60_000,
  maxSpotDeviationBps: 150,
  allowStaleSpot: false,
};

const number = (value: unknown, name: string, min: number, max: number) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} must be a number from ${min} to ${max}`);
  return value;
};
/** Merges `input` over `defaults`, each value checked to lie in its range. */
function section<T extends object>(
  input: unknown,
  defaults: T,
  ranges: { [K in keyof T]?: [number, number] },
  name: string,
): T {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in defaults)) throw new Error(`Unknown setting ${name}.${key}`);
    const range = ranges[key as keyof T];
    if (range) out[key] = number(value, `${name}.${key}`, range[0], range[1]);
    else if (typeof value === typeof (defaults as Record<string, unknown>)[key]) out[key] = value;
    else throw new Error(`${name}.${key} has the wrong type`);
  }
  return out as T;
}

export function settings(input: unknown): Settings {
  const raw = (input ?? {}) as Record<string, unknown>;
  if (typeof raw.vault !== "string" || !isAddress(raw.vault))
    throw new Error("vault must be an address");
  const pricing = section(
    raw.pricing,
    DEFAULT_PRICING,
    {
      z: [0, 3],
      zPriorOnly: [0, 3],
      kappa0: [0, 0.5],
      kappaInsider: [0, 0.5],
      kappaScheduled: [0, 1],
      kappaJump: [0, 1],
      kappaRequesterCap: [0, 1],
      staleFactor: [0, 5],
      minMarkup: [0.001, 0.2],
      maxMarkup: [0.05, 3],
      maxConditionalMarkup: [0.05, 3],
      minUnitPrice: [0, 0.5],
      minTick: [0, 0.01],
      gammaNavFraction: [0.01, 10],
    },
    "pricing",
  );
  const curve = pricing.capital;
  if (
    !(
      curve.r0 >= 0 &&
      curve.rKink >= curve.r0 &&
      curve.rTop >= curve.rKink &&
      curve.kink > 0 &&
      curve.top > curve.kink &&
      curve.top <= 1
    )
  )
    throw new Error("pricing.capital must be a rising curve with 0 < kink < top ≤ 1");
  const themes = { ...DEFAULT_THEMES, ...((raw.themes ?? {}) as Partial<ThemePolicy>) };
  for (const p of [themes.sameTheme, themes.adjacentThemes, themes.unrelated])
    if (!(Math.abs(p.rho) < 1 && p.se > 0 && p.se < 1))
      throw new Error("Theme priors need |ρ| < 1 and 0 < SE < 1");
  const risk = section(
    raw.risk,
    DEFAULT_RISK,
    {
      perFill: [0, 1],
      perBook: [0, 1],
      kelly: [0, 1],
      perLeg: [0, 1],
      perTheme: [0, 1],
      cvar: [0, 1],
      maxUtilization: [0.01, 1],
      requesterOutstanding: [0, 1],
      requesterBookShare: [0, 1],
      requesterDaily: [0, 1],
      maxDrawdownBps: [1, 10_000],
      drawdownWindowMs: [60_000, 7 * 86_400_000],
    },
    "risk",
  );
  const quotes = section(
    raw.quotes,
    DEFAULT_QUOTES,
    {
      ttlSeconds: [3, 300],
      nearTtlSeconds: [3, 300],
      nearSeconds: [0, 7 * 86_400],
      stopSeconds: [0, 86_400],
      indicationMs: [1_000, 60_000],
    },
    "quotes",
  );
  if (!/^[1-9][0-9]{0,9}$/.test(quotes.indicationStake))
    throw new Error("quotes.indicationStake is whole tokens");
  const references = section(
    raw.references,
    DEFAULT_REFERENCES,
    {
      maxReferenceAgeMs: [1_000, 3_600_000],
      maxSpread: [0.001, 0.5],
      probabilityFloor: [0.001, 0.2],
      jumpPoints: [0.001, 0.5],
      jumpSigma: [0.5, 20],
      jumpWindowMs: [0, 86_400_000],
      maxSpotAgeMs: [1_000, 86_400_000],
      maxSpotDeviationBps: [1, 10_000],
    },
    "references",
  );
  const underlyings: Record<string, UnderlyingSettings> = {};
  for (const [symbol, value] of Object.entries(
    (raw.underlyings ?? {}) as Record<string, Record<string, unknown>>,
  )) {
    if (!/^[A-Z]{2,8}:[A-Z0-9][A-Z0-9.-]{0,22}$/.test(symbol))
      throw new Error(`Invalid underlying ${symbol}`);
    const kind = value.kind;
    if (kind !== "stock" && kind !== "etf" && kind !== "crypto")
      throw new Error(`${symbol}.kind is stock, etf or crypto`);
    const u: UnderlyingSettings = { kind };
    if (value.token !== undefined) {
      if (typeof value.token !== "string" || !isAddress(value.token))
        throw new Error(`${symbol}.token`);
      u.token = getAddress(value.token);
    }
    if (value.vol !== undefined) u.vol = number(value.vol, `${symbol}.vol`, 0.01, 5);
    if (value.volSe !== undefined) u.volSe = number(value.volSe, `${symbol}.volSe`, 0, 1);
    if (value.implied !== undefined) u.implied = value.implied === true;
    if (value.skew1m !== undefined) u.skew1m = number(value.skew1m, `${symbol}.skew1m`, -0.6, 0.6);
    if (value.skewSe !== undefined) u.skewSe = number(value.skewSe, `${symbol}.skewSe`, 0, 0.6);
    if (value.earnings !== undefined) {
      const e = value.earnings as { dates?: unknown; jump?: unknown };
      if (
        !Array.isArray(e.dates) ||
        e.dates.some((d) => typeof d !== "string" || !Number.isFinite(Date.parse(d)))
      )
        throw new Error(`${symbol}.earnings.dates are ISO dates`);
      u.earnings = {
        dates: e.dates as string[],
        jump: number(e.jump, `${symbol}.earnings.jump`, 0, 1),
      };
    }
    underlyings[symbol] = u;
  }
  const list = (value: unknown, fallback: string[]) =>
    Array.isArray(value) && value.every((t) => typeof t === "string")
      ? (value as string[])
      : fallback;
  return {
    vault: getAddress(raw.vault),
    pricing,
    themes,
    risk,
    quotes,
    references,
    underlyings,
    defaultGapSe:
      raw.defaultGapSe === undefined ? 0.03 : number(raw.defaultGapSe, "defaultGapSe", 0, 1),
    gaps: Object.fromEntries(
      Object.entries((raw.gaps ?? {}) as Record<string, { gap?: unknown; se?: unknown }>).map(
        ([key, g]) => {
          const m = /^(0x[0-9a-fA-F]{64}):([A-Z]{2,8}:[A-Z0-9][A-Z0-9.-]{0,22})$/.exec(key);
          if (!m) throw new Error(`gaps keys are "<condition>:<underlying>", not ${key}`);
          return [
            `${m[1]!.toLowerCase()}:${m[2]}`,
            {
              gap: number(g.gap, `gaps.${key}.gap`, -1, 1),
              se: number(g.se, `gaps.${key}.se`, 0, 1),
            },
          ];
        },
      ),
    ),
    politicsThemes: list(raw.politicsThemes, ["politics", "elections", "government", "military"]),
    insiderThemes: list(raw.insiderThemes, ["filings", "government", "military", "regulation"]),
    pollMs: raw.pollMs === undefined ? 15_000 : number(raw.pollMs, "pollMs", 1_000, 600_000),
    receiptPollMs:
      raw.receiptPollMs === undefined
        ? 500
        : number(raw.receiptPollMs, "receiptPollMs", 50, 10_000),
    minGasWei:
      typeof raw.minGasWei === "string" && /^[0-9]{1,30}$/.test(raw.minGasWei)
        ? raw.minGasWei
        : "1000000000000000",
    dailyGasBudgetWei:
      typeof raw.dailyGasBudgetWei === "string" && /^[0-9]{1,30}$/.test(raw.dailyGasBudgetWei)
        ? raw.dailyGasBudgetWei
        : "50000000000000000",
  };
}
