import { expect, test } from "bun:test";
import { approve, deposit, withdraw } from "@conditional-stocks/evm-client";
import { maxUint256 } from "viem";
import { protocolConfig } from "../src/config/protocol";
import { vaultAmount, verifiedVaultTransactions } from "../src/lib/trading/vault";
import type { WholeBalanceView } from "../src/types/api";

const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const token = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const exchange = protocolConfig.exchange;
const balance = (wallet: bigint, vault: bigint): WholeBalanceView => ({
  token,
  account: owner,
  decimals: 6,
  canonicalBalance: String(wallet),
  vaultAvailable: String(vault),
  reserved: "0",
  blockNumber: "1",
});

test("only positive uint96-precision vault amounts are accepted", () => {
  expect(vaultAmount("1.25", 6)).toBe(1_250_000n);
  for (const invalid of ["", "0", "-1", "0.0000001", "79228162514264.337593543950336"])
    expect(() => vaultAmount(invalid, 6)).toThrow();
});

test("deposits sign only the locally built approval and deposit", () => {
  const b = balance(1_000n, 500n);
  // A token's first deposit approves the exchange without limit; an exact approval (an older
  // API) is accepted too.
  for (const allowance of [maxUint256, 600n]) {
    const both = {
      transactions: [approve(token, exchange, allowance), deposit(exchange, token, 600n)],
    };
    expect(
      verifiedVaultTransactions({
        action: "deposit",
        owner,
        token,
        amount: 600n,
        balance: b,
        quote: both,
      }),
    ).toEqual(both.transactions);
  }
  const only = { transactions: [deposit(exchange, token, 600n)] };
  expect(
    verifiedVaultTransactions({
      action: "deposit",
      owner,
      token,
      amount: 600n,
      balance: b,
      quote: only,
    }),
  ).toHaveLength(1);
  // A different amount, spender or token is never signed.
  for (const transactions of [
    [deposit(exchange, token, 599n)],
    [approve(token, owner, 600n), deposit(exchange, token, 600n)],
    [approve(token, owner, maxUint256), deposit(exchange, token, 600n)],
    [approve(token, exchange, 599n), deposit(exchange, token, 600n)],
    [approve(exchange, exchange, maxUint256), deposit(exchange, token, 600n)],
    [approve(token, exchange, 600n), withdraw(exchange, token, 600n, owner)],
  ])
    expect(() =>
      verifiedVaultTransactions({
        action: "deposit",
        owner,
        token,
        amount: 600n,
        balance: b,
        quote: { transactions },
      }),
    ).toThrow();
  expect(() =>
    verifiedVaultTransactions({
      action: "deposit",
      owner,
      token,
      amount: 1_001n,
      balance: b,
      quote: { transactions: [deposit(exchange, token, 1_001n)] },
    }),
  ).toThrow("external wallet");
});

test("withdrawals pay the connected wallet from available credit only", () => {
  const b = balance(0n, 500n);
  const tx = withdraw(exchange, token, 500n, owner);
  expect(
    verifiedVaultTransactions({
      action: "withdraw",
      owner,
      token,
      amount: 500n,
      balance: b,
      quote: { transactions: [tx] },
    }),
  ).toEqual([tx]);
  expect(() =>
    verifiedVaultTransactions({
      action: "withdraw",
      owner,
      token,
      amount: 500n,
      balance: b,
      quote: { transactions: [withdraw(exchange, token, 500n, token)] },
    }),
  ).toThrow();
  expect(() =>
    verifiedVaultTransactions({
      action: "withdraw",
      owner,
      token,
      amount: 501n,
      balance: b,
      quote: { transactions: [withdraw(exchange, token, 501n, owner)] },
    }),
  ).toThrow("vault balance");
});
