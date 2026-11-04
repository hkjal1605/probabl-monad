"use client";
/** A wallet's world account: what it needs before a world trade (the account step, one-tap
 * trading, funds on the world books) and the actions that get it there. */
import { type Address, erc20Abi, getAddress } from "viem";
import { readContract } from "viem/actions";
import { useMemberAccount, useWallet } from "@/components/providers/WalletProvider";
import { toast } from "@/components/ui/toast";
import { useAccountStep } from "@/components/wallet/AccountGate";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { rpc } from "@/lib/trading/rpc";
import {
  delegateTransactions,
  depositTransactions,
  withdrawTransactions,
} from "@/lib/worlds/account";
import { worldsApi } from "@/services/worlds-api";
import { useRead } from "./useWorlds";

export function useWorldAccount() {
  const wallet = useWallet();
  const owner = useMemberAccount();
  const step = useAccountStep();
  const lower = owner?.toLowerCase();
  const permission = useRead(
    owner ? `world-permission:${owner}` : null,
    (signal) => worldsApi.permission(owner!, signal),
    {
      everyMs: 30_000,
      follows: (u) => u.owners.some((o) => o.toLowerCase() === lower),
    },
  );
  const deployment = useRead("world-deployment", (signal) => worldsApi.deployment(signal));
  const quote = deployment.data ? (getAddress(deployment.data.quote) as Address) : null;
  const balance = useRead(
    owner && quote ? `world-wallet-balance:${owner}:${quote}` : null,
    () =>
      readContract(rpc(), {
        address: quote!,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [getAddress(owner!)],
      }),
    { everyMs: 15_000, follows: (u) => u.owners.some((o) => o.toLowerCase() === lower) },
  );
  const { busy, run } = useAsyncAction(`worlds:${owner ?? "none"}`);

  /** Waits (up to 15 s) until a read shows the change a transaction made. */
  const settle = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 15; i++) {
      if (await check().catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  };
  const send = async (
    txs: { to: string; data: string; value: string }[],
    assertCurrent: () => void,
  ) => {
    let hash = "";
    for (const tx of txs) {
      assertCurrent();
      hash = await wallet.sendTransaction(tx);
    }
    return hash;
  };

  const enable = () =>
    run(async (assertCurrent) => {
      await wallet.ensureNetwork();
      assertCurrent();
      const delegate = permission.data?.delegate;
      if (!delegate) throw new Error("One-tap trading is not available right now.");
      await send(await delegateTransactions(getAddress(delegate)), assertCurrent);
      await settle(async () => (await worldsApi.permission(owner!)).active);
      permission.refresh();
      toast.add({ type: "success", title: "One-tap trading is on for worlds" });
    });

  const deposit = (amount: bigint, onDone?: () => void) =>
    run(async (assertCurrent) => {
      if (!quote) throw new Error("The world deployment is not loaded yet.");
      await wallet.ensureNetwork();
      assertCurrent();
      const before = BigInt(permission.data?.credit ?? "0");
      await send(await depositTransactions(quote, amount), assertCurrent);
      await settle(async () => BigInt((await worldsApi.permission(owner!)).credit) > before);
      permission.refresh();
      balance.refresh();
      toast.add({ type: "success", title: "Funds added to your world balance" });
      onDone?.();
    });

  const withdraw = (amount: bigint) =>
    run(async (assertCurrent) => {
      await wallet.ensureNetwork();
      assertCurrent();
      await send(await withdrawTransactions(getAddress(owner!), amount), assertCurrent);
      await settle(
        async () =>
          BigInt((await worldsApi.permission(owner!)).credit) <
          BigInt(permission.data?.credit ?? "0"),
      );
      permission.refresh();
      balance.refresh();
      toast.add({ type: "success", title: "Sent back to your wallet" });
    });

  return {
    owner,
    step,
    /** Sends prepared, verified transactions in order from the wallet. */
    sendAll: async (
      txs: { to: string; data: string; value: string }[],
      assertCurrent: () => void,
    ) => {
      await wallet.ensureNetwork();
      return send(txs, assertCurrent);
    },
    permission: permission.data,
    permissionLoaded: permission.data !== undefined || permission.error !== null,
    credit: permission.data ? BigInt(permission.data.credit) : null,
    walletBalance: balance.data ?? null,
    quote,
    busy,
    run,
    enable,
    deposit,
    withdraw,
    refresh: () => {
      permission.refresh();
      balance.refresh();
    },
  };
}
export type WorldAccount = ReturnType<typeof useWorldAccount>;
