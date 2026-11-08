"use client";
/** A member's world account, one copy for the whole page: the header (on worlds pages), the
 * ticket, the deposit dialog and My worlds share each read instead of making their own. Nothing
 * is read until something on screen asks for it (`useWorldAccount` for the permission, the
 * deployment and the wallet's dollars; `useWorldPositions` for the balance and positions), and a
 * read stops when the last thing showing it goes away, so a page that shows no world account
 * reads none of it. */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { type Address, erc20Abi, getAddress } from "viem";
import { readContract } from "viem/actions";
import { useMemberAccount, useWallet } from "@/components/providers/WalletProvider";
import { toast } from "@/components/ui/toast";
import { useAccountStep } from "@/components/wallet/AccountGate";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { type Read, useRead } from "@/hooks/useWorlds";
import { rpc } from "@/lib/trading/rpc";
import type { WorldUpdate } from "@/lib/worlds/stream";
import type { WorldWallet } from "@/lib/worlds/types";
import { worldsApi } from "@/services/worlds-api";

type Part = "account" | "positions";
type Tx = { to: string; data: string; value: string };

function useWorldAccountState() {
  const wallet = useWallet();
  const owner = useMemberAccount();
  const step = useAccountStep();
  const [wanted, setWanted] = useState<Record<Part, number>>({ account: 0, positions: 0 });
  /** Asks for a part while the caller is on screen; the returned function lets it go. */
  const want = useCallback((part: Part) => {
    setWanted((w) => ({ ...w, [part]: w[part] + 1 }));
    return () => setWanted((w) => ({ ...w, [part]: w[part] - 1 }));
  }, []);
  const lower = owner?.toLowerCase();
  const mine = (u: WorldUpdate) => u.owners.some((o) => o.toLowerCase() === lower);
  const account = wanted.account > 0 && owner ? owner : null;

  const permission = useRead(
    account ? `world-permission:${account}` : null,
    (signal) => worldsApi.permission(account!, signal),
    { everyMs: 30_000, follows: mine },
  );
  // The deployment never changes while the page is open: read once, when first wanted.
  const [deploymentWanted, setDeploymentWanted] = useState(false);
  if (wanted.account > 0 && !deploymentWanted) setDeploymentWanted(true);
  const deployment = useRead(deploymentWanted ? "world-deployment" : null, (signal) =>
    worldsApi.deployment(signal),
  );
  const quote = deployment.data ? (getAddress(deployment.data.quote) as Address) : null;
  const balance = useRead(
    account && quote ? `world-wallet-balance:${account}:${quote}` : null,
    () =>
      readContract(rpc(), {
        address: quote!,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [getAddress(account!)],
      }),
    { everyMs: 15_000, follows: mine },
  );
  // Values move with the makers' marks (the poll) and with any book's trades (the stream).
  const positions: Read<WorldWallet> = useRead(
    wanted.positions > 0 && owner ? `world-wallet:${owner}` : null,
    (signal) => worldsApi.wallet(owner!, signal),
    { everyMs: 20_000, follows: (u) => mine(u) || u.books.length > 0 },
  );
  const { busy, run } = useAsyncAction(`worlds:${owner ?? "none"}`);

  const refresh = () => {
    permission.refresh();
    balance.refresh();
    positions.refresh();
  };
  /** Waits (up to 15 s) until a read shows the change a transaction made. */
  const settle = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 15; i++) {
      if (await check().catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  };
  const send = async (txs: Tx[], assertCurrent: () => void) => {
    let hash = "";
    for (const tx of txs) {
      assertCurrent();
      hash = await wallet.sendTransaction(tx);
    }
    return hash;
  };
  const credit = permission.data ? BigInt(permission.data.credit) : null;
  const creditNow = async () => BigInt((await worldsApi.permission(owner!)).credit);

  const enable = () =>
    run(async (assertCurrent) => {
      await wallet.ensureNetwork();
      assertCurrent();
      const delegate = permission.data?.delegate;
      if (!delegate) throw new Error("One-tap trading is not available right now.");
      const { delegateTransactions } = await import("@/lib/worlds/account");
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
      const { depositTransactions } = await import("@/lib/worlds/account");
      const before = credit ?? 0n;
      await send(await depositTransactions(quote, amount), assertCurrent);
      await settle(async () => (await creditNow()) > before);
      refresh();
      toast.add({ type: "success", title: "Funds added to your world balance" });
      onDone?.();
    });

  const withdraw = (amount: bigint) =>
    run(async (assertCurrent) => {
      await wallet.ensureNetwork();
      assertCurrent();
      const { withdrawTransactions } = await import("@/lib/worlds/account");
      const before = credit ?? 0n;
      await send(await withdrawTransactions(getAddress(owner!), amount), assertCurrent);
      await settle(async () => (await creditNow()) < before);
      refresh();
      toast.add({ type: "success", title: "Sent back to your wallet" });
    });

  return {
    want,
    positions,
    account: {
      owner,
      step,
      /** Sends prepared, verified transactions in order from the wallet. */
      sendAll: async (txs: Tx[], assertCurrent: () => void) => {
        await wallet.ensureNetwork();
        return send(txs, assertCurrent);
      },
      permission: permission.data,
      permissionLoaded: permission.data !== undefined || permission.error !== null,
      credit,
      walletBalance: balance.data ?? null,
      /** Whether the wallet's dollars could be read (false while loading or after a failure). */
      walletBalanceLoaded: balance.data !== undefined,
      quote,
      busy,
      run,
      enable,
      deposit,
      withdraw,
      refresh,
    },
  };
}

type State = ReturnType<typeof useWorldAccountState>;
const WorldAccountContext = createContext<State | null>(null);

export function WorldAccountProvider({ children }: { children: ReactNode }) {
  const state = useWorldAccountState();
  return <WorldAccountContext value={state}>{children}</WorldAccountContext>;
}

function useWorldAccountContext() {
  const state = useContext(WorldAccountContext);
  if (!state) throw new Error("A world account is read inside WorldAccountProvider.");
  return state;
}

/** The member's world account and its actions; while the caller is on screen, its permission,
 * the deployment and the wallet's dollars are read (once, for every caller). */
export function useWorldAccount() {
  const { want, account } = useWorldAccountContext();
  useEffect(() => want("account"), [want]);
  return account;
}
export type WorldAccount = State["account"];

/** The member's world balance and positions (`/v2/positions`), read while the caller is on
 * screen (once, for every caller). */
export function useWorldPositions() {
  const { want, positions } = useWorldAccountContext();
  useEffect(() => want("positions"), [want]);
  return positions;
}

/** Whether a world account action is under way, without reading the account. */
export function useWorldAccountBusy() {
  return useWorldAccountContext().account.busy;
}
