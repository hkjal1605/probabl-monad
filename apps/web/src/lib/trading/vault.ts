import {
  approve,
  deposit,
  type Envelope,
  verifyEnvelope,
  withdraw,
} from "@conditional-stocks/evm-client";
import { getAddress, maxUint256 } from "viem";
import { protocolConfig } from "@/config/protocol";
import { parseAmountInput } from "@/lib/format/amount-input";
import type { WholeBalanceView } from "@/types/api";

/** The API's prepared transfer: a deposit may be preceded by an allowance approval. */
export interface VaultQuote {
  transactions: unknown[];
}
export function vaultAmount(text: string, decimals: number, symbol?: string) {
  const amount = parseAmountInput(text, decimals, symbol);
  if (amount <= 0n) throw new Error("Enter an amount above 0.");
  if (amount >= 1n << 96n) throw new Error("That amount is too large.");
  return amount;
}
/** The wallet signs only transactions built locally from the selected token and amount; the
 * API's copy must match them exactly, so it can never substitute a destination or token. */
export function verifiedVaultTransactions(input: {
  action: "deposit" | "withdraw";
  owner: string;
  token: string;
  amount: bigint;
  balance: WholeBalanceView;
  quote: VaultQuote;
}): Envelope[] {
  const { action, amount, balance, quote } = input;
  if (action === "withdraw" && BigInt(balance.vaultAvailable) < amount)
    throw new Error("Insufficient available vault balance");
  if (action === "deposit" && BigInt(balance.canonicalBalance) < amount)
    throw new Error("Deposit exceeds the external wallet balance");
  const exchange = protocolConfig.exchange,
    token = getAddress(input.token);
  const main =
    action === "deposit"
      ? deposit(exchange, token, amount)
      : withdraw(exchange, token, amount, getAddress(input.owner));
  const remote = quote?.transactions;
  if (!Array.isArray(remote) || remote.length < 1 || remote.length > (action === "deposit" ? 2 : 1))
    throw new Error("Vault transfer differs from the selected amount");
  const expected =
    remote.length === 2 ? [approval(token, exchange, amount, remote[0]), main] : [main];
  for (const [index, transaction] of expected.entries())
    verifyEnvelope(transaction, { transaction: remote[index] });
  return expected;
}

/** The allowance a deposit asks for: unlimited on a token's first deposit, so later deposits
 * of it need none; an API that still asks for exactly the amount is accepted too. Either way it
 * approves only the exchange, for the selected token. */
function approval(token: `0x${string}`, exchange: `0x${string}`, amount: bigint, remote: unknown) {
  const unlimited = approve(token, exchange, maxUint256);
  try {
    verifyEnvelope(unlimited, { transaction: remote });
    return unlimited;
  } catch {
    return approve(token, exchange, amount);
  }
}
