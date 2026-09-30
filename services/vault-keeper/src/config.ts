import { decimal } from "@conditional-stocks/operator";
import { type Address, getAddress } from "viem";

/** The Δ-model of one registered vault market. */
export interface MarketModel {
  market: number;
  /** δ₀: the YES-world stock premium over the NO world, in bps of spot (negative when the event
   * lowers the stock). */
  anchorBps: number;
  /** δ̂ falls this many bps per 1% of stock inventory the vault is long YES (and rises when it is
   * long NO): the depth of price discovery. */
  impactBps: number;
  /** Bound on |δ̂| in bps; keep it inside the vault's price band. */
  maxGapBps: number;
  /** Quote notional per ladder (bids or asks of one branch), in whole quote tokens. */
  orderQuote: string;
}
export interface Settings {
  vault: Address;
  /** Reviewed unit conversion: reference-price units per whole token before the issuer's live UI
   * multiplier (usually "1"). */
  basePriceMultiplier: string;
  quotePriceMultiplier: string;
  markets: MarketModel[];
  /** Testnets only: quote from stale reference prices (e.g. outside US market hours). */
  allowStaleSpot: boolean;
  quoteLevels: number;
  levelSpacingBps: number;
  halfSpreadBps: number;
  adverseSelectionBps: number;
  maxHalfSpreadBps: number;
  /** A resting quote is replaced once its price is this far from the target. */
  repriceBps: number;
  ttlSeconds: number;
  pollMs: number;
  maxFeedAgeMs: number;
  /** Largest gap between the stock price's and the probability's observation times. */
  maxSkewMs: number;
  /** Largest distance between the reference price and the vault's Chainlink price. */
  maxOracleDeviationBps: number;
  /** Quotes keep this far inside the vault's band so oracle updates in flight do not revert. */
  bandMarginBps: number;
  maxProbabilitySpreadX6: number;
  probabilityFloorX6: number;
  /** Quoting stops while other traders' books imply a probability this far from Polymarket's. */
  maxProbabilityDriftX6: number;
  jumpBps: number;
  probabilityJumpX6: number;
  cooldownMs: number;
  /** Vault-wide halt once trading loses this share of value since the checkpoint. */
  maxDrawdownBps: number;
  drawdownWindowMs: number;
  /** Plain quote and stock kept unreserved for withdrawals, in bps of plain holdings. */
  reserveBps: number;
  /** Spreads and price impact grow over this many seconds before quoting stops... */
  wideningSeconds: number;
  /** ...up to this multiple. */
  wideningFactor: number;
  /** Paired claims worth at least this (whole quote tokens) are merged back into credit. */
  mergeQuote: string;
  /** Native gas balance kept for cancellations. */
  minGasWei: string;
  dailyGasBudgetWei: string;
}

export function settings(input: unknown): Settings {
  const raw = input as Partial<Settings>;
  if (!raw || typeof raw.vault !== "string" || !Array.isArray(raw.markets))
    throw new Error("Configure the vault address and its markets");
  if (raw.markets.length > 8) throw new Error("A vault has at most eight markets");
  const result: Settings = {
    basePriceMultiplier: "1",
    quotePriceMultiplier: "1",
    allowStaleSpot: false,
    quoteLevels: 2,
    levelSpacingBps: 25,
    halfSpreadBps: 40,
    adverseSelectionBps: 20,
    maxHalfSpreadBps: 1500,
    repriceBps: 15,
    ttlSeconds: 300,
    pollMs: 10_000,
    maxFeedAgeMs: 30_000,
    maxSkewMs: 15_000,
    maxOracleDeviationBps: 150,
    bandMarginBps: 50,
    maxProbabilitySpreadX6: 50_000,
    probabilityFloorX6: 20_000,
    maxProbabilityDriftX6: 150_000,
    jumpBps: 300,
    probabilityJumpX6: 80_000,
    cooldownMs: 60_000,
    maxDrawdownBps: 300,
    drawdownWindowMs: 86_400_000,
    reserveBps: 2000,
    wideningSeconds: 86_400,
    wideningFactor: 3,
    mergeQuote: "100",
    minGasWei: "1000000000000000",
    dailyGasBudgetWei: "10000000000000000",
    ...raw,
    vault: getAddress(raw.vault),
    markets: raw.markets,
  };
  const ranges: Record<string, [number, number]> = {
    quoteLevels: [1, 8],
    levelSpacingBps: [1, 500],
    halfSpreadBps: [1, 2000],
    adverseSelectionBps: [0, 2000],
    maxHalfSpreadBps: [1, 4000],
    repriceBps: [1, 1000],
    ttlSeconds: [30, 86_400],
    pollMs: [1000, 60_000],
    maxFeedAgeMs: [1000, 900_000],
    maxSkewMs: [0, 900_000],
    maxOracleDeviationBps: [1, 2000],
    bandMarginBps: [0, 1000],
    maxProbabilitySpreadX6: [1, 200_000],
    probabilityFloorX6: [1, 100_000],
    maxProbabilityDriftX6: [1, 1_000_000],
    jumpBps: [1, 5000],
    probabilityJumpX6: [1, 500_000],
    cooldownMs: [1000, 3_600_000],
    maxDrawdownBps: [1, 5000],
    drawdownWindowMs: [60_000, 7 * 86_400_000],
    reserveBps: [0, 9000],
    wideningSeconds: [0, 30 * 86_400],
  };
  for (const [field, [low, high]] of Object.entries(ranges)) {
    const value = result[field as keyof Settings];
    if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high)
      throw new Error(`Invalid ${field}`);
  }
  if (
    typeof result.wideningFactor !== "number" ||
    !(result.wideningFactor >= 1 && result.wideningFactor <= 10)
  )
    throw new Error("Invalid wideningFactor");
  if (typeof result.allowStaleSpot !== "boolean") throw new Error("Invalid allowStaleSpot");
  if (
    result.ttlSeconds * 1000 < result.pollMs * 3 ||
    result.maxHalfSpreadBps < result.halfSpreadBps ||
    result.halfSpreadBps + result.levelSpacingBps * (result.quoteLevels - 1) >
      result.maxHalfSpreadBps ||
    result.repriceBps > result.halfSpreadBps
  )
    throw new Error("Invalid refresh/spread policy");
  const positive = (value: unknown) => typeof value === "string" && decimal(value, 18) > 0n;
  for (const value of [
    result.basePriceMultiplier,
    result.quotePriceMultiplier,
    result.mergeQuote,
    result.minGasWei,
    result.dailyGasBudgetWei,
  ])
    if (!positive(value)) throw new Error("Positive unit conversions and limits required");
  const seen = new Set<number>();
  for (const m of result.markets) {
    if (!Number.isSafeInteger(m.market) || m.market <= 0 || seen.has(m.market))
      throw new Error("Duplicate/invalid market model");
    seen.add(m.market);
    if (
      !Number.isInteger(m.maxGapBps) ||
      m.maxGapBps < 0 ||
      m.maxGapBps > 5000 ||
      !Number.isInteger(m.anchorBps) ||
      Math.abs(m.anchorBps) > m.maxGapBps ||
      !Number.isInteger(m.impactBps) ||
      m.impactBps < 0 ||
      m.impactBps > 10_000 ||
      !positive(m.orderQuote)
    )
      throw new Error(`Invalid Δ-model for market ${m.market}`);
  }
  return result;
}
