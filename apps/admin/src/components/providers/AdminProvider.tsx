"use client";
import { assertSignInChallenge } from "@conditional-stocks/evm-client";
import type { AdminTransaction } from "@conditional-stocks/evm-client/admin";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { type Address, getAddress, type Hex, isAddress, stringToHex, toHex } from "viem";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { adminConfig } from "@/config/protocol";
import { requestJson, SESSION_EXPIRED_EVENT } from "@/lib/admin-api";
import {
  assertRequestSession,
  browserStorage,
  createAdminSession,
  forget,
  persistAdminSession,
  rememberedWallet,
  rememberWallet,
  type SavedAdminSession,
  SESSION_STORAGE_KEY,
  savedAdminSession,
  sessionBinding,
  setRequestSession,
  WALLET_STORAGE_KEY,
} from "@/lib/admin-session";
import {
  connectWallet,
  discoverWallets,
  findWallet,
  type WalletHandle,
  walletSources,
} from "@/lib/admin-wallet";
import { preflightTransaction, readRoles, waitForAdminReceipt } from "@/lib/chain";
import { vaultOperators } from "@/lib/delta-vaults";
import { loadOperators, operatorRole } from "@/lib/operator-access";

export type { AdminTransaction };

interface AdminSession {
  account: string | null;
  token: string | null;
  chainId: number | null;
  signing: boolean;
  restoring: boolean;
  persistenceError: string | null;
  sessionExpiresAt: number | null;
  role: "operator" | "blocked" | "unverified";
  checkingNetwork: boolean;
  networkError: string | null;
  connect(): Promise<void>;
  disconnect(): void;
  ensureNetwork(interactive?: boolean): Promise<void>;
  authenticate(): Promise<void>;
  captureContext(): () => void;
  sendTransaction(transaction: AdminTransaction): Promise<string>;
}
const Context = createContext<AdminSession | null>(null);
export function AdminProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 5000 } },
      }),
  );
  const [account, setAccount] = useState<string | null>(null),
    [token, setToken] = useState<string | null>(null),
    [chainId, setChainId] = useState<number | null>(null),
    [signing, setSigning] = useState(false),
    [restoring, setRestoring] = useState(true),
    [persistenceError, setPersistenceError] = useState<string | null>(null),
    [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null),
    [operators, setOperators] = useState<string[] | null>(null),
    [checkingNetwork, setCheckingNetwork] = useState(false),
    [networkError, setNetworkError] = useState<string | null>(null);
  const generation = useRef(0),
    identity = useRef<string | null>(null),
    session = useRef<SavedAdminSession | null>(null),
    networkRequest = useRef(0),
    selected = useRef<WalletHandle | null>(null),
    operationId = useRef(0),
    pending = useRef<number | null>(null),
    connecting = useRef(false),
    /** The provider's current account, as its last `accountsChanged` or connection reported. */
    walletAccount = useRef<string | null>(null),
    providerCleanup = useRef<() => void>(() => {});
  const binding = () => sessionBinding(adminConfig, window.location.origin);
  const begin = () => {
    if (pending.current !== null) throw new Error("A wallet request is pending");
    const id = ++operationId.current;
    pending.current = id;
    return id;
  };
  const finish = (id: number) => {
    if (pending.current === id) {
      pending.current = null;
      connecting.current = false;
      setSigning(false);
    }
  };
  const currentWallet = () => {
    const handle = selected.current;
    if (!handle || findWallet(walletSources(), handle.kind)?.provider !== handle.provider)
      throw new Error("Operator wallet is unavailable. Connect again.");
    return handle.provider;
  };
  const currentAccount = () => {
    currentWallet();
    return walletAccount.current;
  };
  const activate = (value: SavedAdminSession | null) => {
    session.current = value;
    setRequestSession(value);
    setToken(value?.token ?? null);
    setSessionExpiresAt(value?.expiresAt ?? null);
  };
  const clear = (forgetSaved = true) => {
    activate(null);
    queryClient.clear();
    if (forgetSaved) forget(browserStorage(), SESSION_STORAGE_KEY);
  };
  const clearNetwork = () => {
    networkRequest.current++;
    setOperators(null);
    setChainId(null);
    setCheckingNetwork(false);
    setNetworkError(null);
  };
  const dropConnection = (forgetSaved = true) => {
    generation.current++;
    identity.current = null;
    walletAccount.current = null;
    setAccount(null);
    clearNetwork();
    clear(forgetSaved);
    if (forgetSaved) forget(browserStorage(), WALLET_STORAGE_KEY);
  };
  const persistWallet = (handle: WalletHandle, owner: string) => {
    if (!rememberWallet(browserStorage(), handle.kind, owner))
      setPersistenceError(
        "Browser storage is unavailable. This wallet and session may need reconnecting after refresh.",
      );
  };
  const expireIfNeeded = () => {
    const value = session.current;
    if (value && (Date.now() < value.issuedAt || Date.now() >= value.expiresAt)) {
      generation.current++;
      clear();
    }
  };
  const captureContext = () => {
    const revision = generation.current,
      owner = identity.current,
      prior = session.current?.token ?? null;
    const check = () => {
      if (
        revision !== generation.current ||
        identity.current !== owner ||
        currentAccount() !== owner ||
        (session.current?.token ?? null) !== prior
      )
        throw new Error("Operator wallet or session changed; review again.");
      if (prior) assertRequestSession(prior);
    };
    return check;
  };
  /** Reads on-chain roles and confirms the wallet's chain; an interactive check asks the
   * wallet to switch to the deployment's chain. A recheck (before a transaction) keeps the
   * roles and chain verified earlier until it completes, so the signed-in page stays mounted
   * with its state; a failed recheck clears them. */
  const verifyNetwork = async (interactive = false, recheck = false) => {
    const request = ++networkRequest.current,
      owner = identity.current;
    const current = () => request === networkRequest.current && owner === identity.current;
    if (!recheck) {
      setOperators(null);
      setChainId(null);
    }
    setNetworkError(null);
    setCheckingNetwork(true);
    try {
      const addresses = await loadOperators(readRoles, () => vaultOperators(owner));
      const provider = currentWallet();
      let chain = Number(await provider.request({ method: "eth_chainId" }));
      if (chain !== adminConfig.chainId && interactive) {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: toHex(adminConfig.chainId) }],
        });
        chain = Number(await provider.request({ method: "eth_chainId" }));
      }
      if (!current() || currentAccount() !== owner)
        throw new Error("Operator wallet changed during network verification. Connect again.");
      setOperators(addresses);
      setChainId(chain);
      if (chain !== adminConfig.chainId)
        throw new Error(`Switch the operator wallet to ${adminConfig.chainName}.`);
      return addresses;
    } catch (error) {
      if (current()) {
        if (recheck) {
          setOperators(null);
          setChainId(null);
        }
        setNetworkError(
          error instanceof Error
            ? error.message
            : "Unable to verify on-chain operator roles. Retry the connection.",
        );
      }
      throw error;
    } finally {
      if (current()) setCheckingNetwork(false);
    }
  };
  const restoreSaved = (addresses: string[]) => {
    const owner = identity.current;
    if (!owner || currentAccount() !== owner) return;
    if (!addresses.includes(owner)) {
      clear();
      return;
    }
    if (!session.current) {
      const saved = savedAdminSession(browserStorage(), binding(), owner);
      if (saved) activate(saved); // Never rewrite/extend the original expiry on a reload.
    }
  };
  const ensureNetwork = async (interactive = true) => {
    const addresses = await verifyNetwork(interactive);
    restoreSaved(addresses);
  };
  const attach = (handle: WalletHandle) => {
    if (selected.current?.provider === handle.provider) return;
    providerCleanup.current();
    selected.current = handle;
    const p = handle.provider;
    const changed = (accounts: unknown) => {
      const first = Array.isArray(accounts) ? accounts[0] : undefined;
      const owner =
        typeof first === "string" && isAddress(first, { strict: false }) ? getAddress(first) : null;
      walletAccount.current = owner;
      if ((!identity.current && connecting.current) || owner === identity.current) return;
      generation.current++;
      identity.current = owner;
      setAccount(owner);
      clearNetwork();
      clear();
      if (owner) {
        persistWallet(handle, owner);
        void verifyNetwork().catch(() => {});
      } else forget(browserStorage(), WALLET_STORAGE_KEY);
    };
    const disconnected = () => dropConnection();
    const chainChanged = (value: unknown) => {
      if (identity.current) setChainId(Number(value));
    };
    p.on?.("accountsChanged", changed);
    p.on?.("chainChanged", chainChanged);
    p.on?.("disconnect", disconnected);
    providerCleanup.current = () => {
      p.removeListener?.("accountsChanged", changed);
      p.removeListener?.("chainChanged", chainChanged);
      p.removeListener?.("disconnect", disconnected);
    };
  };
  const establish = async (handle: WalletHandle, silent: boolean) => {
    const id = begin(),
      revision = generation.current;
    connecting.current = true;
    attach(handle);
    try {
      const owner = await connectWallet(handle, silent);
      if (revision !== generation.current) throw new Error("Wallet changed during connection");
      walletAccount.current = owner;
      const previous = rememberedWallet(browserStorage());
      if (previous && (previous.owner !== owner || previous.kind !== handle.kind)) clear();
      else clear(false);
      identity.current = owner;
      generation.current++;
      setAccount(owner);
      persistWallet(handle, owner);
      await ensureNetwork(!silent);
    } finally {
      finish(id);
    }
  };
  const connect = async () => {
    const saved = rememberedWallet(browserStorage());
    const handle =
      (saved && findWallet(walletSources(), saved.kind)) || findWallet(walletSources());
    if (!handle)
      throw new Error("Open an Ethereum wallet such as MetaMask, Coinbase Wallet or Rabby.");
    await establish(handle, false);
  };
  const disconnect = () => {
    const p = selected.current?.provider;
    dropConnection();
    void p
      ?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] } as never)
      .catch(() => {});
  };
  const authenticate = async () => {
    expireIfNeeded();
    const owner = identity.current;
    if (!owner) throw new Error("Connect an operator wallet first.");
    const id = begin();
    setSigning(true);
    try {
      const check = captureContext();
      const addresses = await verifyNetwork(true);
      check();
      if (!(addresses as string[]).includes(owner))
        throw new Error("This wallet has no operator role.");
      const challenge = await requestJson<{ challengeId: string; message: string }>(
        "/api/gateway/auth/challenge",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: owner, origin: window.location.origin }),
        },
      );
      assertSignInChallenge(challenge, owner, adminConfig, window.location.origin);
      check();
      const signature = (await currentWallet().request({
        method: "personal_sign",
        params: [stringToHex(challenge.message), owner as Address],
      })) as Hex;
      check();
      const issuedAt = Date.now();
      const result = await requestJson<{ token: string; expiresAtMs?: unknown }>(
        "/api/gateway/auth/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: owner,
            challengeId: challenge.challengeId,
            signature,
          }),
        },
      );
      check();
      const value = createAdminSession(
        binding(),
        owner,
        result.token,
        issuedAt,
        result.expiresAtMs,
      );
      activate(value);
      if (!persistAdminSession(browserStorage(), value))
        setPersistenceError(
          "Browser storage is unavailable. This sign-in works now but cannot survive a refresh.",
        );
    } finally {
      finish(id);
    }
  };
  /** Simulates the reviewed call from its role account, then asks the wallet to send exactly
   * that call and waits for a successful receipt. */
  const sendTransaction = async (transaction: AdminTransaction) => {
    expireIfNeeded();
    if (!identity.current || !session.current) throw new Error("Sign in first.");
    if (getAddress(transaction.from) !== identity.current)
      throw new Error("Wallet is not the reviewed authority");
    if (transaction.chainId !== adminConfig.chainId || transaction.value !== "0")
      throw new Error("Invalid admin transaction");
    const id = begin();
    setSigning(true);
    try {
      const check = captureContext();
      await verifyNetwork(true, true);
      await preflightTransaction(transaction);
      check();
      const hash = (await currentWallet().request({
        method: "eth_sendTransaction",
        params: [
          { from: transaction.from, to: transaction.to, data: transaction.data, value: "0x0" },
        ],
      })) as Hex;
      await waitForAdminReceipt(hash);
      return hash;
    } finally {
      finish(id);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: One connection lifecycle; callbacks read refs and stable setters/queryClient, not render state.
  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const start = Date.now();
    const stopDiscovery = discoverWallets(window);
    const restore = async () => {
      if (disposed) return;
      const saved = rememberedWallet(browserStorage());
      if (!saved) {
        setRestoring(false);
        return;
      }
      const handle = findWallet(walletSources(), saved.kind);
      if (!handle && Date.now() - start < 10_000) {
        timer = setTimeout(() => void restore(), 250);
        return;
      }
      try {
        if (handle) await establish(handle, true);
      } catch {
        /* Locked/revoked wallets require a manual reconnect; never prompt on load. */
      } finally {
        if (!disposed) setRestoring(false);
      }
    };
    const expired = (e: Event) => {
      if ((e as CustomEvent).detail === session.current?.token) {
        generation.current++;
        clear();
      }
    };
    const storageChanged = (e: StorageEvent) => {
      if (e.key === null || e.key === WALLET_STORAGE_KEY) {
        const saved = rememberedWallet(browserStorage());
        if (
          !saved ||
          (identity.current &&
            (saved.owner !== identity.current || saved.kind !== selected.current?.kind))
        )
          dropConnection(false);
      }
      if (e.key === null || e.key === SESSION_STORAGE_KEY) {
        const value = session.current;
        if (
          value &&
          savedAdminSession(browserStorage(), binding(), value.owner)?.token !== value.token
        ) {
          generation.current++;
          clear(false);
        }
      }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", expireIfNeeded);
    document.addEventListener("visibilitychange", expireIfNeeded);
    // Defer past React StrictMode's setup/cleanup cycle; only one eager connection.
    timer = setTimeout(() => void restore(), 0);
    return () => {
      disposed = true;
      stopDiscovery();
      clearTimeout(timer);
      generation.current++;
      networkRequest.current++;
      pending.current = null;
      connecting.current = false;
      providerCleanup.current();
      selected.current = null;
      walletAccount.current = null;
      setRequestSession(null);
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("focus", expireIfNeeded);
      document.removeEventListener("visibilitychange", expireIfNeeded);
    };
  }, [queryClient]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only the deadline changes this timer; expiry reads the current session ref.
  useEffect(() => {
    if (sessionExpiresAt === null) return;
    const timer = setTimeout(expireIfNeeded, Math.max(0, sessionExpiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [sessionExpiresAt]);

  const role = operatorRole(account, operators);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <Context.Provider
          value={{
            account,
            token,
            chainId,
            signing,
            restoring,
            persistenceError,
            sessionExpiresAt,
            role,
            checkingNetwork,
            networkError,
            connect,
            disconnect,
            ensureNetwork,
            authenticate,
            captureContext,
            sendTransaction,
          }}
        >
          <TooltipProvider delay={250}>
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
  if (!value) throw new Error("AdminProvider required");
  return value;
}
