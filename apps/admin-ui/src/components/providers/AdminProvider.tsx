"use client";

import { Toaster } from "@conditional-stocks/ui-kit/sonner";
import { ThemeProvider } from "@conditional-stocks/ui-kit/theme";
import { TooltipProvider } from "@conditional-stocks/ui-kit/tooltip";
import { assertWalletContext, toRpcQuantity } from "@conditional-stocks/ui-kit/transaction";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toHex } from "viem";
import { adminConfig } from "@/config/protocol";
import { logger } from "@/lib/logger";

interface Provider {
  on?: (event: string, callback: () => void) => void;
  removeListener?: (event: string, callback: () => void) => void;
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
}
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
interface AdminSession {
  account: string | null;
  authenticate: () => Promise<void>;
  chainId: number | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  role: "operator" | "blocked" | "unverified";
  sendTransaction: (transaction: { data: string; to: string; value?: string }) => Promise<string>;
  token: string | null;
}
const Context = createContext<AdminSession | null>(null);
const wallet = () => {
  if (!window.ethereum) throw new Error("No EIP-1193 wallet is available.");
  return window.ethereum;
};

export function AdminProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 5_000 } },
      }),
  );
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!window.ethereum) return;
    const [accounts, chain] = await Promise.all([
      window.ethereum.request({ method: "eth_accounts" }) as Promise<string[]>,
      window.ethereum.request({ method: "eth_chainId" }) as Promise<string>,
    ]);
    const next = accounts[0] ?? null;
    setAccount(next);
    setChainId(Number.parseInt(chain, 16));
    setToken(next ? sessionStorage.getItem(`conditional-admin:${next.toLowerCase()}`) : null);
  }, []);
  useEffect(() => {
    const changed = () => {
      void refresh().catch((error) => logger.warn("wallet.refresh.failed", { error }));
    };
    changed();
    window.ethereum?.on?.("accountsChanged", changed);
    window.ethereum?.on?.("chainChanged", changed);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", changed);
      window.ethereum?.removeListener?.("chainChanged", changed);
    };
  }, [refresh]);
  const connect = useCallback(async () => {
    const accounts = (await wallet().request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts[0]) throw new Error("Wallet returned no account");
    setAccount(accounts[0]);
    const chain = (await wallet().request({ method: "eth_chainId" })) as string;
    setChainId(Number.parseInt(chain, 16));
  }, []);
  const authenticate = useCallback(async () => {
    if (!account) throw new Error("Connect an operator wallet first");
    const challengeResponse = await fetch("/api/gateway/auth/challenge", {
      body: JSON.stringify({ address: account }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!challengeResponse.ok) throw new Error("Could not create sign-in challenge");
    const challenge = (await challengeResponse.json()) as { challengeId: string; message: string };
    const signature = await wallet().request({
      method: "personal_sign",
      params: [toHex(challenge.message), account],
    });
    const response = await fetch("/api/gateway/auth/verify", {
      body: JSON.stringify({ address: account, challengeId: challenge.challengeId, signature }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) throw new Error("Operator signature was not verified");
    const session = (await response.json()) as { token: string };
    sessionStorage.setItem(`conditional-admin:${account.toLowerCase()}`, session.token);
    setToken(session.token);
    logger.info("wallet.authenticated", { chainId: adminConfig.chainId });
  }, [account]);
  const disconnect = useCallback(() => {
    if (account) sessionStorage.removeItem(`conditional-admin:${account.toLowerCase()}`);
    setAccount(null);
    setToken(null);
  }, [account]);
  const sendTransaction = useCallback(
    async (transaction: { data: string; to: string; value?: string }) => {
      if (!account) throw new Error("Connect first");
      await assertWalletContext(wallet(), account, adminConfig.chainId);
      const transactionHash = (await wallet().request({
        method: "eth_sendTransaction",
        params: [{ ...transaction, from: account, value: toRpcQuantity(transaction.value) }],
      })) as string;
      logger.info("wallet.transaction.submitted", {
        transactionHash,
        chainId: adminConfig.chainId,
      });
      return transactionHash;
    },
    [account],
  );
  const role =
    account && adminConfig.uiOperators.length > 0
      ? adminConfig.uiOperators.includes(account.toLowerCase())
        ? "operator"
        : "blocked"
      : "unverified";
  const value = useMemo<AdminSession>(
    () => ({ account, authenticate, chainId, connect, disconnect, role, sendTransaction, token }),
    [account, authenticate, chainId, connect, disconnect, role, sendTransaction, token],
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <Context.Provider value={value}>
          <TooltipProvider delayDuration={250}>
            {children}
            <Toaster richColors position="bottom-right" />
          </TooltipProvider>
        </Context.Provider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
export function useAdmin() {
  const value = useContext(Context);
  if (!value) throw new Error("useAdmin must be inside AdminProvider");
  return value;
}
