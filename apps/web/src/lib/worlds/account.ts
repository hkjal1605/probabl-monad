/** The wallet transactions of world trading, built here and checked against the API's copy
 * before the wallet sees them (`verifyEnvelope`), as the exchange's are:
 * - one-tap trading: a grant to the API's trading delegate on the world books, for 90 days,
 *   bounded per trade and in total (buys in dollars; cash-outs by the bundle's largest payout);
 * - funds: an allowance and a deposit into the world books' credit, and a withdrawal back;
 * - redemption of every decided world in one transaction. */
import {
  approve,
  type Envelope,
  verifyEnvelope,
  WORLD_BUY,
  WORLD_SELL,
  worldBooksCalls,
} from "@conditional-stocks/evm-client";
import { type Address, getAddress } from "viem";
import { worldBooks } from "@/config/protocol";
import { worldsApi } from "@/services/worlds-api";

const UNIT = 1_000_000n;
/** One-tap limits: $1,000 a trade, $10,000 in all; cash-outs of payouts up to $50,000. */
export const WORLD_GRANT = {
  maxBuy: 1_000n * UNIT,
  totalBuy: 10_000n * UNIT,
  maxSell: 50_000n * UNIT,
  totalSell: 1_000_000n * UNIT,
  maxFeeBps: 200,
  permissions: WORLD_BUY | WORLD_SELL,
};

/** The API's transactions, each matching the one built here, in order. */
function verified(expected: Envelope[], remote: unknown[]): Envelope[] {
  if (remote.length !== expected.length)
    throw new Error("API transaction differs from the locally reviewed action");
  return expected.map((e, i) => verifyEnvelope(e, { transaction: remote[i] }));
}

/** The grant for one-tap world trading. */
export async function delegateTransactions(delegate: Address) {
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 90 * 86_400 - 600);
  const limits = { expiresAt, ...WORLD_GRANT };
  const expected = [worldBooksCalls(worldBooks).approveDelegate(getAddress(delegate), limits)];
  const body = {
    expiresAt: expiresAt.toString(),
    maxBuy: limits.maxBuy.toString(),
    totalBuy: limits.totalBuy.toString(),
    maxSell: limits.maxSell.toString(),
    totalSell: limits.totalSell.toString(),
    maxFeeBps: limits.maxFeeBps,
    permissions: limits.permissions,
  };
  const prepared = await worldsApi.prepare("worlds/delegate/prepare", body);
  return verified(expected, prepared.transactions);
}

/** An allowance (when the books lack one) and a deposit of `amount` raw units. */
export async function depositTransactions(quote: Address, amount: bigint) {
  const prepared = await worldsApi.prepare("worlds/deposit/prepare", { amount: amount.toString() });
  const deposit = worldBooksCalls(worldBooks).deposit(amount);
  const expected =
    prepared.transactions.length === 2
      ? [approve(getAddress(quote), worldBooks, amount), deposit]
      : [deposit];
  return verified(expected, prepared.transactions);
}

export async function withdrawTransactions(owner: Address, amount: bigint) {
  const prepared = await worldsApi.prepare("worlds/withdraw/prepare", {
    amount: amount.toString(),
  });
  return verified([worldBooksCalls(worldBooks).withdraw(amount, owner)], prepared.transactions);
}

export async function redeemTransactions(books: number[]) {
  const prepared = await worldsApi.prepare("worlds/redeem/prepare", { books });
  // The API redeems the decided worlds among them: the call names exactly those.
  const remote = prepared.transactions as Envelope[];
  if (remote.length !== 1)
    throw new Error("API transaction differs from the locally reviewed action");
  for (const subset of subsets(books)) {
    const expected = worldBooksCalls(worldBooks).redeemMany(subset.map(BigInt));
    if (remote[0]?.data?.toLowerCase() === expected.data.toLowerCase())
      return [verifyEnvelope(expected, { transaction: remote[0] })];
  }
  throw new Error("API transaction differs from the locally reviewed action");
}
/** Order-preserving subsets, largest first (books to redeem are few). */
function subsets(list: number[]): number[][] {
  const out: number[][] = [];
  const n = Math.min(list.length, 10);
  for (let mask = (1 << n) - 1; mask > 0; mask--) out.push(list.filter((_, i) => (mask >> i) & 1));
  return out.sort((a, b) => b.length - a.length);
}
