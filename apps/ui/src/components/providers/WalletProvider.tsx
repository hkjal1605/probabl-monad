"use client";

import { assertWalletContext, toRpcQuantity } from "@conditional-stocks/ui-kit/transaction";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { type Hex, toHex } from "viem";
import { protocolConfig } from "@/config/protocol";
import { requestJson } from "@/lib/api/client";
import { DEMO_ACCOUNT } from "@/lib/demo/engine";
import { assertNoModeSwitch } from "@/lib/demo/navigation";
import { logger } from "@/lib/logger";
import { useDemo } from "./DemoProvider";

interface EthereumProvider {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

interface WalletContextValue {
  account: string | null;
  authenticate: () => Promise<string>;
  chainId: number | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  ensureNetwork: () => Promise<void>;
  error: string | null;
  sendTransaction: (transaction: { data: string; to: string; value?: string }) => Promise<string>;
  sessionToken: string | null;
  invalidateSession: () => void;
  signTypedData: (typedData: unknown) => Promise<Hex>;
  status: "idle" | "connecting" | "connected" | "signing" | "error";
}

const WalletContext = createContext<WalletContextValue | null>(null);
const chainHex = `0x${protocolConfig.chainId.toString(16)}`;

const provider = () => {
  assertNoModeSwitch();
  if (!window.ethereum)
    throw new Error("No EIP-1193 wallet was found. Install or open a supported wallet.");
  return window.ethereum;
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const demo = useDemo();
  if (demo) {
    const blocked = async (): Promise<never> => {
      throw new Error("Real signatures and transactions are disabled in demo mode.");
    };
    return (
      <WalletContext.Provider
        value={{
          account: demo.state.connected ? DEMO_ACCOUNT : null,
          chainId: protocolConfig.chainId,
          sessionToken: demo.state.authenticated ? "local-demo-only" : null,
          invalidateSession: () => {},
          status: demo.state.connected ? "connected" : "idle",
          error: null,
          connect: async () => {
            demo.dispatch({ type: "connect" });
          },
          disconnect: () => {
            demo.dispatch({ type: "disconnect" });
          },
          authenticate: async () => {
            demo.dispatch({ type: "authenticate" });
            return "local-demo-only";
          },
          ensureNetwork: async () => {},
          sendTransaction: blocked,
          signTypedData: blocked,
        }}
      >
        {children}
      </WalletContext.Provider>
    );
  }
  return <LiveWalletProvider>{children}</LiveWalletProvider>;
}

function LiveWalletProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const identity = useRef<string | null>(null);
  const generation = useRef(0);
  const refreshSequence = useRef(0);
  const authPending = useRef(false);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletContextValue["status"]>("idle");

  const refresh = useCallback(async () => {
    if (!window.ethereum) return;
    const sequence = ++refreshSequence.current;
    const [accounts, chain] = await Promise.all([
      window.ethereum.request({ method: "eth_accounts" }) as Promise<string[]>,
      window.ethereum.request({ method: "eth_chainId" }) as Promise<string>,
    ]);
    const nextAccount = accounts[0] ?? null;
    if (sequence !== refreshSequence.current) return;
    if (identity.current?.toLowerCase() !== nextAccount?.toLowerCase()) {
      generation.current++;
      cache.removeQueries({
        predicate: (query) =>
          ["positions", "wallet-orders", "whole-balances", "payout-credits"].includes(
            String(query.queryKey[0]),
          ),
      });
    }
    identity.current = nextAccount;
    setAccount(nextAccount);
    setChainId(Number.parseInt(chain, 16));
    setStatus(nextAccount ? "connected" : "idle");
    setSessionToken(nextAccount ? storedSession(nextAccount) : null);
  }, [cache]);

  useEffect(() => {
    const changed = () => {
      generation.current++;
      setSessionToken(null);
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
    setStatus("connecting");
    setError(null);
    try {
      const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts[0]) throw new Error("The wallet did not return an account.");
      await refresh();
      logger.info("wallet.connected");
    } catch (cause) {
      logger.warn("wallet.connect.failed", { error: cause });
      const message = cause instanceof Error ? cause.message : "Wallet connection was rejected.";
      setError(message);
      setStatus("error");
      toast.error(message);
      throw cause;
    }
  }, [refresh]);

  const ensureNetwork = useCallback(async () => {
    try {
      await provider().request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainHex }],
      });
    } catch (cause) {
      const code = recordErrorCode(cause);
      if (code !== 4902) throw cause;
      await provider().request({
        method: "wallet_addEthereumChain",
        params: [
          {
            blockExplorerUrls: protocolConfig.explorerUrl
              ? [protocolConfig.explorerUrl]
              : undefined,
            chainId: chainHex,
            chainName: protocolConfig.chainName,
            nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
            rpcUrls: [protocolConfig.rpcUrl],
          },
        ],
      });
    }
    const actual = await provider().request({ method: "eth_chainId" });
    if (Number.parseInt(String(actual), 16) !== protocolConfig.chainId)
      throw new Error("The wallet has not switched to the configured network.");
    await refresh();
  }, [refresh]);

  const authenticate = useCallback(async () => {
    if (!account) throw new Error("Connect a wallet first.");
    if (authPending.current) throw new Error("A wallet sign-in is already in progress.");
    authPending.current = true;
    const started = generation.current;
    const checkIdentity = async () => {
      if (
        generation.current !== started ||
        identity.current?.toLowerCase() !== account.toLowerCase()
      )
        throw new Error("Wallet changed during sign-in. Please try again.");
      await assertWalletContext(provider(), account, protocolConfig.chainId);
      if (generation.current !== started) throw new Error("Wallet changed during sign-in.");
    };
    setStatus("signing");
    try {
      await checkIdentity();
      const challenge = await requestJson<{ challengeId: string; message: string }>(
        "/api/gateway/auth/challenge",
        { body: { address: account } },
      );
      await checkIdentity();
      const signature = await provider().request({
        method: "personal_sign",
        params: [toHex(challenge.message), account],
      });
      await checkIdentity();
      const session = await requestJson<{ token: string }>("/api/gateway/auth/verify", {
        body: { address: account, challengeId: challenge.challengeId, signature },
      });
      await checkIdentity();
      if (typeof session.token !== "string" || !session.token)
        throw new Error("Invalid sign-in response.");
      try {
        sessionStorage.setItem(sessionKey(account), session.token);
      } catch {
        /* In-memory auth works when storage is unavailable. */
      }
      setSessionToken(session.token);
      logger.info("wallet.authenticated", { chainId: protocolConfig.chainId });
      return session.token;
    } finally {
      authPending.current = false;
      if (generation.current === started) setStatus(identity.current ? "connected" : "idle");
    }
  }, [account]);

  const signTypedData = useCallback(
    async (typedData: unknown) => {
      if (!account) throw new Error("Connect a wallet first.");
      const revision = generation.current;
      if (identity.current?.toLowerCase() !== account.toLowerCase())
        throw new Error("Wallet changed. Review again.");
      await assertWalletContext(provider(), account, protocolConfig.chainId);
      if (revision !== generation.current) throw new Error("Wallet changed. Review again.");
      return provider().request({
        method: "eth_signTypedData_v4",
        params: [account, JSON.stringify(typedData)],
      }) as Promise<Hex>;
    },
    [account],
  );

  const sendTransaction = useCallback(
    async ({ data, to, value }: { data: string; to: string; value?: string }) => {
      if (!account) throw new Error("Connect a wallet first.");
      const revision = generation.current;
      if (identity.current?.toLowerCase() !== account.toLowerCase())
        throw new Error("Wallet changed. Review again.");
      await assertWalletContext(provider(), account, protocolConfig.chainId);
      if (revision !== generation.current) throw new Error("Wallet changed. Review again.");
      const transactionHash = (await provider().request({
        method: "eth_sendTransaction",
        params: [{ data, from: account, to, value: toRpcQuantity(value) }],
      })) as string;
      logger.info("wallet.transaction.submitted", {
        transactionHash,
        chainId: protocolConfig.chainId,
      });
      return transactionHash;
    },
    [account],
  );

  const disconnect = useCallback(() => {
    generation.current++;
    refreshSequence.current++;
    identity.current = null;
    try {
      if (account) sessionStorage.removeItem(sessionKey(account));
    } catch {
      /* Storage can be unavailable. */
    }
    cache.removeQueries({
      predicate: (query) =>
        ["positions", "wallet-orders", "whole-balances", "payout-credits"].includes(
          String(query.queryKey[0]),
        ),
    });
    setAccount(null);
    setSessionToken(null);
    setStatus("idle");
  }, [account, cache]);

  const invalidateSession = useCallback(() => {
    if (!account || identity.current?.toLowerCase() !== account.toLowerCase()) return;
    try {
      if (storedSession(account) === sessionToken) sessionStorage.removeItem(sessionKey(account));
    } catch {
      /* In-memory recovery still works. */
    }
    setSessionToken((current) => (current === sessionToken ? null : current));
  }, [account, sessionToken]);

  const value = useMemo<WalletContextValue>(
    () => ({
      account,
      authenticate,
      chainId,
      connect,
      disconnect,
      ensureNetwork,
      error,
      sendTransaction,
      sessionToken,
      invalidateSession,
      signTypedData,
      status,
    }),
    [
      account,
      authenticate,
      chainId,
      connect,
      disconnect,
      ensureNetwork,
      error,
      sendTransaction,
      sessionToken,
      invalidateSession,
      signTypedData,
      status,
    ],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

const sessionKey = (account: string) =>
  `probabl-session:${protocolConfig.chainId}:${account.toLowerCase()}`;
function storedSession(account: string) {
  try {
    return sessionStorage.getItem(sessionKey(account));
  } catch {
    return null;
  }
}

function recordErrorCode(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("code" in value)) return null;
  return typeof value.code === "number" ? value.code : null;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}
