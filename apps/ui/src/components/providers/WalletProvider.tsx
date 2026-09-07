"use client";

import { assertWalletContext, toRpcQuantity } from "@conditional-stocks/ui-kit/transaction";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type Hex, toHex } from "viem";
import { protocolConfig } from "@/config/protocol";
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
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletContextValue["status"]>("idle");

  const refresh = useCallback(async () => {
    if (!window.ethereum) return;
    const [accounts, chain] = await Promise.all([
      window.ethereum.request({ method: "eth_accounts" }) as Promise<string[]>,
      window.ethereum.request({ method: "eth_chainId" }) as Promise<string>,
    ]);
    const nextAccount = accounts[0] ?? null;
    setAccount(nextAccount);
    setChainId(Number.parseInt(chain, 16));
    if (nextAccount) {
      setStatus("connected");
      setSessionToken(sessionStorage.getItem(`conditional-session:${nextAccount.toLowerCase()}`));
    }
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
    setStatus("connecting");
    setError(null);
    try {
      const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts[0]) throw new Error("The wallet did not return an account.");
      setAccount(accounts[0]);
      const chain = (await provider().request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(chain, 16));
      setSessionToken(sessionStorage.getItem(`conditional-session:${accounts[0].toLowerCase()}`));
      setStatus("connected");
      logger.info("wallet.connected", { chainId: Number.parseInt(chain, 16) });
    } catch (cause) {
      logger.warn("wallet.connect.failed", { error: cause });
      const message = cause instanceof Error ? cause.message : "Wallet connection was rejected.";
      setError(message);
      setStatus("error");
      throw cause;
    }
  }, []);

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
    setChainId(protocolConfig.chainId);
  }, []);

  const authenticate = useCallback(async () => {
    if (!account) throw new Error("Connect a wallet first.");
    setStatus("signing");
    const challengeResponse = await fetch("/api/gateway/auth/challenge", {
      body: JSON.stringify({ address: account }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!challengeResponse.ok) throw new Error("Could not start wallet sign-in.");
    const challenge = (await challengeResponse.json()) as { challengeId: string; message: string };
    const signature = await provider().request({
      method: "personal_sign",
      params: [toHex(challenge.message), account],
    });
    const verifyResponse = await fetch("/api/gateway/auth/verify", {
      body: JSON.stringify({ address: account, challengeId: challenge.challengeId, signature }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!verifyResponse.ok) throw new Error("Wallet sign-in could not be verified.");
    const session = (await verifyResponse.json()) as { token: string };
    sessionStorage.setItem(`conditional-session:${account.toLowerCase()}`, session.token);
    setSessionToken(session.token);
    setStatus("connected");
    logger.info("wallet.authenticated", { chainId: protocolConfig.chainId });
    return session.token;
  }, [account]);

  const signTypedData = useCallback(
    async (typedData: unknown) => {
      if (!account) throw new Error("Connect a wallet first.");
      await assertWalletContext(provider(), account, protocolConfig.chainId);
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
      await assertWalletContext(provider(), account, protocolConfig.chainId);
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
    if (account) sessionStorage.removeItem(`conditional-session:${account.toLowerCase()}`);
    setAccount(null);
    setSessionToken(null);
    setStatus("idle");
  }, [account]);

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
      signTypedData,
      status,
    ],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
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
