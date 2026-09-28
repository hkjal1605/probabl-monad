"use client";

import { formatTokenAmount } from "@conditional-stocks/domain";
import { useWallet } from "@/components/providers/WalletProvider";
import { toast } from "@/components/ui/toast";
import type { WalletAsset, WalletAssetBalance } from "@/hooks/useWalletAssets";
import { type VaultQuote, vaultAmount, verifiedVaultTransactions } from "@/lib/trading/vault";
import { api } from "@/services/protocol-api-service";
import { refreshStores } from "@/stores/createResourceStore";
import { useAsyncAction } from "./useAsyncAction";

export interface VaultSelection {
  action: "deposit" | "withdraw";
  asset: WalletAsset;
}

export function useVaultTransfer({
  selection,
  amount,
  balances,
  fresh,
  refresh,
  onSuccess,
}: {
  selection: VaultSelection | null;
  amount: string;
  balances: WalletAssetBalance[];
  fresh: boolean;
  refresh: () => Promise<unknown>;
  onSuccess: () => void;
}) {
  const wallet = useWallet();
  const balance = balances.find((row) => row.token === selection?.asset.token)?.balance;
  const { busy, run } = useAsyncAction(
    [wallet.account, selection?.asset.token, selection?.action, amount].join(":"),
  );
  const submit = () =>
    run(async (assertCurrent) => {
      if (!wallet.account || !selection || !balance || !fresh)
        throw new Error("Wait for a fresh vault balance");
      const owner = wallet.account;
      const raw = vaultAmount(amount, selection.asset.decimals);
      await wallet.ensureNetwork();
      assertCurrent();
      const token = wallet.sessionToken ?? (await wallet.authenticate());
      assertCurrent();
      const quote = await api.prepare<VaultQuote>(
        `vault/${selection.action}/prepare`,
        { asset: selection.asset.token, amount: String(raw) },
        token,
      );
      assertCurrent();
      const transactions = verifiedVaultTransactions({
        action: selection.action,
        owner,
        token: selection.asset.token,
        amount: raw,
        balance,
        quote,
      });
      let hash = "";
      // An allowance approval, when needed, confirms before the deposit is signed.
      for (const transaction of transactions) {
        assertCurrent();
        hash = await wallet.sendTransaction(transaction);
      }
      toast.add({
        type: "success",
        title: `${selection.action === "deposit" ? "Deposit" : "Withdrawal"} confirmed · ${hash.slice(0, 10)}…`,
        description: "Vault balances update after indexing.",
      });
      onSuccess();
      void Promise.all([refresh(), refreshStores(["positions", "payout-credits"])]);
    });

  const maxAmount = () => {
    if (!selection || !balance) return "";
    const raw =
      selection.action === "deposit"
        ? BigInt(balance.canonicalBalance)
        : BigInt(balance.vaultAvailable);
    return formatTokenAmount(raw, selection.asset.decimals);
  };

  return { balance, busy, maxAmount, submit };
}
