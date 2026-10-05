/** Δ-vault client: transaction envelopes, one-round-trip state snapshots and the per-world view
 * of what a share owns. Mirrors contracts/src/vault (docs/delta-vault.md). */
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeFunctionData,
  getAddress,
  type Hex,
  keccak256,
  type PublicClient,
  stringToBytes,
  zeroAddress,
} from "viem";
import { deltaVaultAbi } from "./abi.ts";
import { unbatched } from "./multicall.ts";
import { type OrderWire, packOrder, packPlan, U128_MAX } from "./protocol.ts";
import type { Envelope } from "./transactions.ts";

export const DELTA_VAULT_ROLES = {
  admin: `0x${"0".repeat(64)}` as Hex,
  curator: keccak256(stringToBytes("CURATOR_ROLE")),
  keeper: keccak256(stringToBytes("KEEPER_ROLE")),
  guardian: keccak256(stringToBytes("GUARDIAN_ROLE")),
} as const;
export type DeltaVaultRole = keyof typeof DELTA_VAULT_ROLES;

/** Contract bounds (DeltaVaultBase). */
export const DELTA_VAULT_LIMITS = {
  maxMarkets: 8,
  maxOrders: 48,
  maxBandBps: 5000,
  maxCutoffBufferSeconds: 7 * 86_400,
  maxTtlSeconds: 86_400,
  maxOracleAgeSeconds: 3 * 86_400,
  maxFeeBps: 1000,
  minWithdrawLimitBps: 1000,
} as const;

/** Claims of one market per branch and collateral, raw units. */
export interface DeltaVaultClaims {
  yesQuote: bigint;
  noQuote: bigint;
  yesBase: bigint;
  noBase: bigint;
}
export interface DeltaVaultRisk {
  bandBps: number;
  cutoffBuffer: number;
  maxOrder: bigint;
  maxResting: bigint;
  maxImbalance: bigint;
}
export interface DeltaVaultLimits {
  maxTtl: number;
  maxOracleAge: number;
  maxFeeBps: number;
}
/** Everything the vault owns on the exchange: plain credit plus whole-funded escrow, and claims
 * including claim-funded escrow; `free*` exclude escrow. */
export interface DeltaVaultHoldings {
  quote: bigint;
  base: bigint;
  freeQuote: bigint;
  freeBase: bigint;
  markets: { market: number; claims: DeltaVaultClaims; free: DeltaVaultClaims }[];
}
export interface DeltaVaultExposure {
  imbalance: bigint;
  high: bigint;
  low: bigint;
  resting: bigint;
  crossed: boolean;
}
export interface DeltaVaultMarket {
  market: number;
  risk: DeltaVaultRisk;
  tick: bigint;
  cutoff: number;
  exposure: DeltaVaultExposure;
  /** Tracked order keys, including ones closed since the last prune. */
  orders: bigint[];
}
export interface DeltaVaultState {
  address: Address;
  exchange: Address;
  quote: Address;
  base: Address;
  priceFeed: Address;
  sequencerFeed: Address | null;
  module: Address;
  name: string;
  symbol: string;
  totalSupply: bigint;
  paused: boolean;
  admin: Address;
  caps: { quote: bigint; base: bigint };
  withdrawLimitBps: number;
  /** Shares that may still leave in the current withdrawal window. */
  withdrawable: bigint;
  limits: DeltaVaultLimits;
  holdings: DeltaVaultHoldings;
  markets: DeltaVaultMarket[];
  /** Oracle price in exchange units (raw quote per raw base x 1e18); null while unusable. */
  oraclePrice: bigint | null;
}

// ------------------------------------------------------------------ transactions

const deltaVaultCall = (
  vault: Address,
  functionName: string,
  args: readonly unknown[],
): Envelope => ({
  to: getAddress(vault),
  data: encodeFunctionData({
    abi: deltaVaultAbi,
    functionName: functionName as never,
    args: args as never,
  }),
  value: "0",
});
const amount = (value: bigint, allowZero = false) => {
  if (typeof value !== "bigint" || value < 0n || (!allowZero && value === 0n) || value > U128_MAX)
    throw new Error("Invalid amount");
  return value;
};
const recipient = (value: Address) => {
  const checked = getAddress(value);
  if (checked === zeroAddress) throw new Error("Zero address is not allowed");
  return checked;
};

/** Deposits up to the two budgets for at least `minShares` (the in-kind cost of the largest whole
 * share count that fits). The vault needs token allowances for both budgets. */
export const deltaVaultDeposit = (
  vault: Address,
  maxQuote: bigint,
  maxBase: bigint,
  minShares: bigint,
  receiver: Address,
) =>
  deltaVaultCall(vault, "deposit", [
    amount(maxQuote, true),
    amount(maxBase, true),
    amount(minShares, true),
    recipient(receiver),
  ]);
export const deltaVaultWithdraw = (
  vault: Address,
  shares: bigint,
  minQuote: bigint,
  minBase: bigint,
  receiver: Address,
  owner: Address,
) =>
  deltaVaultCall(vault, "withdraw", [
    amount(shares),
    amount(minQuote, true),
    amount(minBase, true),
    recipient(receiver),
    recipient(owner),
  ]);

/** A passive vault quote: the vault is the maker; it never names makers to fill against. */
export interface DeltaVaultQuote {
  order: OrderWire;
  /** Branch sequence the planner observed (`Book.seqYes`/`seqNo`). */
  nextSequence: bigint;
  deadline: bigint;
}
/** Keeper: cancel vault orders of `market` and post `quotes` there, atomically. */
export function deltaVaultUpdate(
  vault: Address,
  market: number,
  cancels: readonly bigint[],
  quotes: readonly DeltaVaultQuote[],
  tick: bigint,
) {
  if (cancels.length + quotes.length === 0 || cancels.length > DELTA_VAULT_LIMITS.maxOrders)
    throw new Error("Nothing to update, or too many cancellations");
  const placements = quotes.map((q) => {
    if (getAddress(q.order.maker) !== getAddress(vault) || q.order.delegate || q.order.tif !== 0)
      throw new Error("Vault quotes are vault-owned, owner-signed and resting");
    if (Number(q.order.marketId) !== market) throw new Error("Quote for another market");
    return { order: packOrder(q.order, tick), plan: packPlan(q.nextSequence, q.deadline, 0n) };
  });
  return deltaVaultCall(vault, "update", [market, cancels, placements]);
}
export const deltaVaultMerge = (vault: Address, market: number) =>
  deltaVaultCall(vault, "merge", [market]);
export const deltaVaultCancelAll = (vault: Address) => deltaVaultCall(vault, "cancelAll", []);
/** Permissionless: redeem a resolved market's claims and drop the market. */
export const deltaVaultSettle = (vault: Address, market: number) =>
  deltaVaultCall(vault, "settle", [market]);

export function validateDeltaVaultRisk(risk: DeltaVaultRisk): DeltaVaultRisk {
  if (
    !Number.isInteger(risk.bandBps) ||
    risk.bandBps < 1 ||
    risk.bandBps > DELTA_VAULT_LIMITS.maxBandBps ||
    !Number.isInteger(risk.cutoffBuffer) ||
    risk.cutoffBuffer < 0 ||
    risk.cutoffBuffer > DELTA_VAULT_LIMITS.maxCutoffBufferSeconds ||
    risk.maxOrder < 0n ||
    risk.maxOrder > risk.maxResting ||
    risk.maxResting >= 1n << 64n ||
    risk.maxImbalance < 0n ||
    risk.maxImbalance >= 1n << 96n
  )
    throw new Error("Invalid vault market risk");
  return risk;
}
export function validateDeltaVaultLimits(limits: DeltaVaultLimits): DeltaVaultLimits {
  const within = (value: number, low: number, high: number) =>
    Number.isInteger(value) && value >= low && value <= high;
  if (
    !within(limits.maxTtl, 1, DELTA_VAULT_LIMITS.maxTtlSeconds) ||
    !within(limits.maxOracleAge, 1, DELTA_VAULT_LIMITS.maxOracleAgeSeconds) ||
    !within(limits.maxFeeBps, 0, DELTA_VAULT_LIMITS.maxFeeBps)
  )
    throw new Error("Invalid vault limits");
  return limits;
}
export const deltaVaultAddMarket = (vault: Address, market: number, risk: DeltaVaultRisk) =>
  deltaVaultCall(vault, "addMarket", [market, validateDeltaVaultRisk(risk)]);
export const deltaVaultSetRisk = (vault: Address, market: number, risk: DeltaVaultRisk) =>
  deltaVaultCall(vault, "setRisk", [market, validateDeltaVaultRisk(risk)]);
export const deltaVaultRemoveMarket = (vault: Address, market: number) =>
  deltaVaultCall(vault, "removeMarket", [market]);
export const deltaVaultSetLimits = (vault: Address, limits: DeltaVaultLimits) =>
  deltaVaultCall(vault, "setLimits", [validateDeltaVaultLimits(limits)]);
export const deltaVaultSetCaps = (vault: Address, quoteCap: bigint, baseCap: bigint) =>
  deltaVaultCall(vault, "setCaps", [amount(quoteCap, true), amount(baseCap, true)]);
export function deltaVaultSetWithdrawLimit(vault: Address, bps: number) {
  if (!Number.isInteger(bps) || bps < DELTA_VAULT_LIMITS.minWithdrawLimitBps || bps > 10_000)
    throw new Error("The withdrawal limit must be 10%–100% of supply per day");
  return deltaVaultCall(vault, "setWithdrawLimit", [bps]);
}
export const deltaVaultPause = (vault: Address) => deltaVaultCall(vault, "pause", []);
export const deltaVaultUnpause = (vault: Address) => deltaVaultCall(vault, "unpause", []);
export const deltaVaultGrantRole = (
  vault: Address,
  role: Exclude<DeltaVaultRole, "admin">,
  to: Address,
) => deltaVaultCall(vault, "grantRole", [DELTA_VAULT_ROLES[role], recipient(to)]);
export const deltaVaultRevokeRole = (
  vault: Address,
  role: Exclude<DeltaVaultRole, "admin">,
  from: Address,
) => deltaVaultCall(vault, "revokeRole", [DELTA_VAULT_ROLES[role], recipient(from)]);

// ------------------------------------------------------------------ reads

const claims = (c: {
  yesQuote: bigint;
  noQuote: bigint;
  yesBase: bigint;
  noBase: bigint;
}): DeltaVaultClaims => ({
  yesQuote: c.yesQuote,
  noQuote: c.noQuote,
  yesBase: c.yesBase,
  noBase: c.noBase,
});

/** The vault in two multicall round trips: configuration and holdings, then its markets. Each
 * vault reads on its own: at its 8-market cap each read returns about 6 to 7 KB, and merged with
 * other vaults' reads they would pass the 24 KB a deployless multicall can return. */
export async function readDeltaVault(
  client: PublicClient,
  vault: Address,
): Promise<DeltaVaultState> {
  const address = getAddress(vault);
  const read = { address, abi: deltaVaultAbi } as const;
  const direct = unbatched(client);
  const [
    exchange,
    quote,
    base,
    priceFeed,
    sequencerFeed,
    module,
    name,
    symbol,
    totalSupply,
    paused,
    admin,
    caps,
    withdrawLimitBps,
    withdrawable,
    limits,
    holdings,
    markets,
  ] = await direct.multicall({
    allowFailure: false,
    // Deployless: works on chains without a Multicall3 deployment (anvil).
    deployless: true,
    contracts: [
      { ...read, functionName: "EXCHANGE" },
      { ...read, functionName: "QUOTE" },
      { ...read, functionName: "BASE" },
      { ...read, functionName: "PRICE_FEED" },
      { ...read, functionName: "SEQUENCER_FEED" },
      { ...read, functionName: "module" },
      { ...read, functionName: "name" },
      { ...read, functionName: "symbol" },
      { ...read, functionName: "totalSupply" },
      { ...read, functionName: "paused" },
      { ...read, functionName: "defaultAdmin" },
      { ...read, functionName: "caps" },
      { ...read, functionName: "withdrawLimitBps" },
      { ...read, functionName: "withdrawable" },
      { ...read, functionName: "limits" },
      { ...read, functionName: "holdings" },
      { ...read, functionName: "markets" },
    ],
  });
  const [price, details] = await Promise.all([
    client.readContract({ ...read, functionName: "oraclePrice" }).catch(() => null),
    direct.multicall({
      allowFailure: false,
      deployless: true,
      contracts: markets.flatMap((id) => [
        { ...read, functionName: "market", args: [id] } as const,
        { ...read, functionName: "exposure", args: [id] } as const,
        { ...read, functionName: "orders", args: [id] } as const,
      ]),
    }),
  ]);
  const detail = <T>(index: number) => details[index] as unknown as T;
  return {
    address,
    exchange: getAddress(exchange),
    quote: getAddress(quote),
    base: getAddress(base),
    priceFeed: getAddress(priceFeed),
    sequencerFeed: sequencerFeed === zeroAddress ? null : getAddress(sequencerFeed),
    module: getAddress(module),
    name,
    symbol,
    totalSupply,
    paused,
    admin: getAddress(admin),
    caps: { quote: caps[0], base: caps[1] },
    withdrawLimitBps,
    withdrawable,
    limits: {
      maxTtl: limits.maxTtl,
      maxOracleAge: limits.maxOracleAge,
      maxFeeBps: limits.maxFeeBps,
    },
    holdings: {
      quote: holdings.quote,
      base: holdings.base,
      freeQuote: holdings.freeQuote,
      freeBase: holdings.freeBase,
      markets: holdings.markets.map((market, i) => ({
        market,
        claims: claims(holdings.claims[i]!),
        free: claims(holdings.free[i]!),
      })),
    },
    markets: markets.map((market, i) => {
      const m = detail<{ risk: DeltaVaultRisk; tick: bigint; cutoff: number }>(3 * i);
      const e = detail<DeltaVaultExposure>(3 * i + 1);
      return {
        market,
        risk: {
          bandBps: m.risk.bandBps,
          cutoffBuffer: m.risk.cutoffBuffer,
          maxOrder: m.risk.maxOrder,
          maxResting: m.risk.maxResting,
          maxImbalance: m.risk.maxImbalance,
        },
        tick: m.tick,
        cutoff: m.cutoff,
        exposure: {
          imbalance: e.imbalance,
          high: e.high,
          low: e.low,
          resting: e.resting,
          crossed: e.crossed,
        },
        orders: [...detail<readonly bigint[]>(3 * i + 2)],
      };
    }),
    oraclePrice: price,
  };
}

// ------------------------------------------------------------------ what a share owns

/** Per-world holdings: quote and base the vault owns if each market's event happens (YES) or
 * not (NO). Plain holdings count in both worlds. */
export function deltaVaultWorlds(h: DeltaVaultHoldings) {
  const w = { yesQuote: h.quote, noQuote: h.quote, yesBase: h.base, noBase: h.base };
  for (const m of h.markets) {
    w.yesQuote += m.claims.yesQuote;
    w.noQuote += m.claims.noQuote;
    w.yesBase += m.claims.yesBase;
    w.noBase += m.claims.noBase;
  }
  return w;
}

/** Estimated quote value of the holdings from the stock price (exchange units) and each market's
 * YES probability (x1e6), pricing both branches' stock at spot. For display only: deposits and
 * withdrawals are in kind and never use a price. */
export function deltaVaultValue(
  h: DeltaVaultHoldings,
  spot: bigint,
  probability: (market: number) => bigint | null,
): bigint | null {
  const WAD = 10n ** 18n,
    PROB = 1_000_000n;
  let value = h.quote + (h.base * spot) / WAD;
  for (const m of h.markets) {
    const p = probability(m.market);
    if (p === null || p < 0n || p > PROB) return null;
    const yes = m.claims.yesQuote + (m.claims.yesBase * spot) / WAD,
      no = m.claims.noQuote + (m.claims.noBase * spot) / WAD;
    value += (yes * p + no * (PROB - p)) / PROB;
  }
  return value;
}

// ------------------------------------------------------------------ errors

const messages: Record<string, string> = {
  SeedRequired: "The vault opens once the operator makes the first deposit.",
  EmptyVault: "The vault holds nothing to deposit against.",
  CapExceeded: "The deposit would take the vault past its capacity.",
  Slippage: "The vault's holdings moved; review the updated amounts and try again.",
  WithdrawLimit: "Today's withdrawal allowance is used up; the rest opens in the next window.",
  UnsupportedToken: "The token transfer did not move the exact amount.",
  InvalidReceiver: "Choose a different receiving address.",
  InvalidAmount: "Enter a valid amount.",
  EnforcedPause: "Deposits are paused. Withdrawals stay open.",
  ERC20InsufficientBalance: "Your share balance is insufficient.",
  ERC20InsufficientAllowance: "The share allowance is insufficient.",
};

export function deltaVaultError(error: unknown): string | null {
  let data: Hex | undefined;
  if (typeof error === "string" && error.startsWith("0x")) data = error as Hex;
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName)
      return reverted.data.errorName;
    const raw = error.walk((e) => typeof (e as { data?: unknown }).data === "string") as {
      data?: Hex;
    } | null;
    data = raw?.data;
  }
  if (!data) return null;
  try {
    return decodeErrorResult({ abi: deltaVaultAbi, data }).errorName;
  } catch {
    return null;
  }
}

export function deltaVaultErrorMessage(
  error: unknown,
  fallback = "The vault action failed on chain.",
) {
  const name = deltaVaultError(error);
  return (name && messages[name]) ?? fallback;
}
