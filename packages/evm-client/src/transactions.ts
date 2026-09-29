import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Hex,
} from "viem";
import { conditionalStocksAbi } from "./abi.ts";
import { type DelegateLimits, validateDelegateLimits } from "./delegation.ts";
import { type AtomicPlan, planWords } from "./planner.ts";
import { address, type OrderWire, packOrder, parseOrder, U128_MAX } from "./protocol.ts";

/** A wallet call: always to a known contract, never with value. */
export interface Envelope {
  to: Address;
  data: Hex;
  value: "0";
}

const call = (to: Address, data: Hex): Envelope => ({ to: getAddress(to), data, value: "0" });
const exchangeCall = (exchange: Address, functionName: string, args: readonly unknown[]) =>
  call(
    exchange,
    encodeFunctionData({
      abi: conditionalStocksAbi,
      functionName: functionName as never,
      args: args as never,
    }),
  );

/** Owner-signed placement. `tick` is the market's price tick. */
export function placement(exchange: Address, order: OrderWire, plan: AtomicPlan, tick: bigint) {
  const o = parseOrder(order);
  const words = planWords(plan);
  if (o.delegate)
    return exchangeCall(exchange, "placeFor", [
      o.maker,
      packOrder(o, tick),
      words.plan,
      words.makers,
    ]);
  return exchangeCall(exchange, "place", [packOrder(o, tick), words.plan, words.makers]);
}

export const cancel = (exchange: Address, key: string | bigint) =>
  exchangeCall(exchange, "cancel", [BigInt(key)]);
/** Cancels the owner's order `key` and places `order` in one transaction. */
export function replace(
  exchange: Address,
  key: string | bigint,
  order: OrderWire,
  plan: AtomicPlan,
  tick: bigint,
) {
  const o = parseOrder(order);
  if (o.delegate) throw new Error("Replacement is owner-signed");
  const words = planWords(plan);
  return exchangeCall(exchange, "replace", [
    BigInt(key),
    packOrder(o, tick),
    words.plan,
    words.makers,
  ]);
}
export function cancelMany(exchange: Address, keys: readonly (string | bigint)[]) {
  if (!keys.length || keys.length > 64) throw new Error("Cancel between 1 and 64 orders at once");
  return exchangeCall(exchange, "cancelMany", [keys.map(BigInt)]);
}

export function approve(token: Address, spender: Address, amount: bigint) {
  if (amount < 0n) throw new Error("Invalid allowance");
  return call(
    token,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [getAddress(spender), amount],
    }),
  );
}

function positive(amount: bigint) {
  if (typeof amount !== "bigint" || amount <= 0n || amount > U128_MAX)
    throw new Error("Invalid amount");
  return amount;
}

export const deposit = (exchange: Address, token: Address, amount: bigint) =>
  exchangeCall(exchange, "deposit", [address(token), positive(amount)]);
export const withdraw = (exchange: Address, token: Address, amount: bigint, to: Address) =>
  exchangeCall(exchange, "withdraw", [address(token), positive(amount), address(to)]);

export function position(
  exchange: Address,
  kind: "split" | "merge",
  market: number,
  collateral: number,
  amount: bigint,
) {
  if (collateral !== 0 && collateral !== 1) throw new Error("Invalid collateral");
  return exchangeCall(exchange, kind, [market, collateral, positive(amount)]);
}

export function redeem(
  exchange: Address,
  market: number,
  collateral: number,
  yes: bigint,
  no: bigint,
) {
  if ((collateral !== 0 && collateral !== 1) || yes < 0n || no < 0n || yes + no === 0n)
    throw new Error("Invalid redemption");
  return exchangeCall(exchange, "redeem", [market, collateral, yes, no]);
}

export function transferClaim(
  exchange: Address,
  market: number,
  branch: number,
  collateral: number,
  to: Address,
  amount: bigint,
) {
  if ((branch !== 0 && branch !== 1) || (collateral !== 0 && collateral !== 1))
    throw new Error("Invalid claim");
  return exchangeCall(exchange, "transferClaim", [
    market,
    branch,
    collateral,
    address(to),
    positive(amount),
  ]);
}

export function approveDelegate(
  exchange: Address,
  delegate: Address,
  limits: DelegateLimits,
  now?: bigint,
) {
  validateDelegateLimits(limits, now);
  return exchangeCall(exchange, "approveDelegate", [
    address(delegate),
    limits.market,
    Number(limits.expiresAt),
    limits.maxOrderQuote,
    limits.totalQuote,
    limits.maxFeeBps,
    limits.permissions,
  ]);
}
export const revokeDelegate = (exchange: Address, delegate: Address) =>
  exchangeCall(exchange, "revokeDelegate", [address(delegate)]);
export const revokeAllDelegates = (exchange: Address) =>
  exchangeCall(exchange, "revokeAllDelegates", []);
export const invalidateOrders = (exchange: Address) =>
  exchangeCall(exchange, "invalidateOrders", []);

// ------------------------------------------------------------------ governance

export interface MarketParams {
  base: Address;
  condition: Hex;
  yesIndex: number;
  noIndex: number;
  rulesHash: Hex;
  metadataHash: Hex;
  open: bigint;
  cutoff: bigint;
  tick: bigint;
  step: bigint;
  maxSteps: bigint;
  minNotional: bigint;
  maxOrder: bigint;
  maxWallet: bigint;
  maxMarket: bigint;
}

/** `underlying` is the bytes32 asset id (`underlyingId("US:NVDA")`); immutable once listed. */
export const listPool = (exchange: Address, token: Address, underlying: Hex) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(underlying) || BigInt(underlying) === 0n)
    throw new Error("Invalid underlying");
  return exchangeCall(exchange, "listPool", [address(token), underlying]);
};
export const createMarket = (exchange: Address, params: MarketParams, metadataUri: string) =>
  exchangeCall(exchange, "createMarket", [
    {
      ...params,
      base: address(params.base),
      open: Number(params.open),
      cutoff: Number(params.cutoff),
      maxSteps: Number(params.maxSteps),
    },
    metadataUri,
  ]);
/** 0 open, 1 freeze (reason), 2 freeze at cutoff, 3 begin resolution (commitment), 4 archive. */
export function lifecycle(exchange: Address, market: number, action: number, reason: Hex) {
  if (!Number.isInteger(action) || action < 0 || action > 4)
    throw new Error("Invalid lifecycle action");
  return exchangeCall(exchange, "lifecycle", [market, action, reason]);
}
export const resolve = (
  exchange: Address,
  market: number,
  yes: number,
  no: number,
  evidence: Hex,
  uri: string,
) => exchangeCall(exchange, "resolve", [market, yes, no, evidence, uri]);
export const configure = (
  exchange: Address,
  roles: { marketAdmin: Address; guardian: Address; resolutionAdmin: Address },
  makerBps: number,
  takerBps: number,
) =>
  exchangeCall(exchange, "configure", [
    address(roles.marketAdmin),
    address(roles.guardian),
    address(roles.resolutionAdmin),
    makerBps,
    takerBps,
  ]);
export const pause = (exchange: Address, paused: boolean, reason: Hex) =>
  exchangeCall(exchange, "pause", [paused, reason]);
export const claimFees = (
  exchange: Address,
  market: number,
  branch: number,
  collateral: number,
  to: Address,
  amount: bigint,
) =>
  exchangeCall(exchange, "claimFees", [market, branch, collateral, address(to), positive(amount)]);

/** The UI builds every call locally and accepts an API envelope only if it is identical. */
export function verifyEnvelope(expected: Envelope, value: unknown): Envelope {
  const actual = (value as { transaction?: Envelope })?.transaction;
  if (
    !actual ||
    getAddress(actual.to) !== expected.to ||
    actual.data.toLowerCase() !== expected.data.toLowerCase() ||
    actual.value !== "0"
  )
    throw new Error("API transaction differs from the locally reviewed action");
  return expected;
}

// ------------------------------------------------------------------ errors

const messages: Record<string, string> = {
  StalePlan: "The order book changed while placing the order. Review the latest quote.",
  InsufficientFunds: "Your available vault balance is insufficient for this action.",
  InvalidDelegation: "Trading permission is inactive or outside its limits.",
  DelegationInactive: "Trading permission was revoked, expired or replaced.",
  DelegateBudget: "The order exceeds your trading permission allowance.",
  FeeCap: "The current trading fee exceeds your approved fee limit.",
  NotTrading: "Trading is closed or paused for this market.",
  Expired: "The order expiry is invalid for this market.",
  CapExceeded: "The order exceeds a market or wallet risk limit.",
  InvalidOrder: "The order is not valid for this market or is no longer open.",
  FractionalRedemption: "Redeem an even total: a fractional raw unit cannot be paid.",
  Unauthorized: "This wallet is not authorized for the action.",
  InvalidState: "The market is not in the required state.",
  TransferFailed: "The token transfer failed. Check your balance and allowance.",
};

/** Protocol error name from a viem error or raw revert data, if recognized. */
export function protocolError(error: unknown): string | null {
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
    return decodeErrorResult({ abi: conditionalStocksAbi, data }).errorName;
  } catch {
    return null;
  }
}

export function protocolErrorMessage(error: unknown, fallback = "The action failed on chain.") {
  const name = protocolError(error);
  return (name && messages[name]) ?? fallback;
}
