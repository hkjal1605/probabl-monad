"use client";
import {
  approve,
  deltaVaultAbi,
  deltaVaultDeposit,
  deltaVaultErrorMessage,
  deltaVaultWithdraw,
} from "@conditional-stocks/evm-client";
import { erc20Abi, getAddress } from "viem";
import { useWallet } from "@/components/providers/WalletProvider";
import { toast } from "@/components/ui/toast";
import { deltaVaults } from "@/config/protocol";
import { depositBounds, withdrawBounds } from "@/lib/delta-vault/amounts";
import { publicClient } from "@/lib/trading/rpc";
import type { DeltaVaultView } from "@/services/delta-vaults-api-service";
import { refreshStores } from "@/stores/createResourceStore";
import { useAsyncAction } from "./useAsyncAction";

/** Deposits and withdrawals, signed by the wallet. Amounts come from the vault's own on-chain
 * previews read through the deployment RPC, never from the API; deposits approve exactly the
 * previewed amounts, and every call carries the user's slippage bounds. */
export function useDeltaVaultTransfer(vault: DeltaVaultView | undefined, onSuccess: () => void) {
  const wallet = useWallet();
  const { busy, run } = useAsyncAction([wallet.account, vault?.address].join(":"));
  const target = () => {
    if (!vault || !wallet.account) throw new Error("Connect a wallet first.");
    const address = getAddress(vault.address);
    if (!deltaVaults.includes(address)) throw new Error("This vault is not enabled in this app.");
    return { address, owner: getAddress(wallet.account) };
  };
  const done = (title: string) => {
    toast.add({ type: "success", title, description: "Vault balances update in a few seconds." });
    onSuccess();
    void refreshStores(["delta-vaults", "delta-vault-account", "positions", "whole-balances"]);
  };
  const failed = (error: unknown) =>
    new Error(deltaVaultErrorMessage(error, (error as Error).message));

  /** Deposits up to `quoteBudget` and `baseBudget` raw units, in the vault's current ratio. */
  const deposit = (quoteBudget: bigint, baseBudget: bigint) =>
    run(async (assertCurrent) => {
      const { address, owner } = target();
      await wallet.ensureNetwork();
      assertCurrent();
      const client = publicClient();
      const [shares, quoteIn, baseIn] = await client
        .readContract({
          address,
          abi: deltaVaultAbi,
          functionName: "previewDeposit",
          args: [quoteBudget, baseBudget],
        })
        .catch((error: unknown) => {
          throw failed(error);
        });
      const bounds = depositBounds({ shares, quoteIn, baseIn });
      const [quote, base] = await Promise.all([
        client.readContract({ address, abi: deltaVaultAbi, functionName: "QUOTE" }),
        client.readContract({ address, abi: deltaVaultAbi, functionName: "BASE" }),
      ]);
      for (const [token, amount] of [
        [quote, bounds.maxQuote],
        [base, bounds.maxBase],
      ] as const) {
        if (amount === 0n) continue;
        const allowance = await client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [owner, address],
        });
        assertCurrent();
        // Exact allowances: the vault can take only what this deposit was previewed at.
        if (allowance < amount) await wallet.sendTransaction(approve(token, address, amount));
      }
      assertCurrent();
      const hash = await wallet
        .sendTransaction(
          deltaVaultDeposit(address, bounds.maxQuote, bounds.maxBase, bounds.minShares, owner),
        )
        .catch((error: unknown) => {
          throw failed(error);
        });
      done(`Deposit confirmed · ${hash.slice(0, 10)}…`);
    });

  const withdraw = (shares: bigint) =>
    run(async (assertCurrent) => {
      const { address, owner } = target();
      if (shares <= 0n) throw new Error("Choose how many shares to withdraw.");
      await wallet.ensureNetwork();
      assertCurrent();
      const [quoteOut, baseOut] = await publicClient()
        .readContract({
          address,
          abi: deltaVaultAbi,
          functionName: "previewWithdraw",
          args: [shares],
        })
        .catch((error: unknown) => {
          throw failed(error);
        });
      const bounds = withdrawBounds({ quoteOut, baseOut });
      assertCurrent();
      const hash = await wallet
        .sendTransaction(
          deltaVaultWithdraw(address, shares, bounds.minQuote, bounds.minBase, owner, owner),
        )
        .catch((error: unknown) => {
          throw failed(error);
        });
      done(`Withdrawal confirmed · ${hash.slice(0, 10)}…`);
    });

  return { busy, deposit, withdraw };
}
