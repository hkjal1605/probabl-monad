import { assertSignInChallenge } from "@conditional-stocks/evm-client";
import { nativeCurrency } from "@conditional-stocks/shared/chains";
import { normalizeInviteCode } from "@conditional-stocks/shared/invites";
import {
  type Address,
  getAddress,
  type Hex,
  isAddress,
  type PublicClient,
  stringToHex,
  toHex,
} from "viem";
import { connectWallet, findWallet, type WalletHandle, type WalletSources } from "./injected";
import {
  announcedSession,
  announceSession,
  assertRequestSession,
  createWalletSession,
  forget,
  forgetToken,
  knownTransport,
  LEGACY_SESSION_KEY,
  legacySession,
  MEMBERSHIP_EVENT,
  type MemberView,
  parseMember,
  rememberedWallet,
  rememberTransport,
  rememberWallet,
  SESSION_EXPIRED_EVENT,
  SESSION_REREAD_MS,
  SESSION_STORAGE_KEY,
  type SessionStorage,
  sessionBinding,
  setRequestSession,
  storedToken,
  storeToken,
  TOKEN_STORAGE_KEY,
  type Transport,
  WALLET_STORAGE_KEY,
  type WalletAccess,
  type WalletKind,
  type WalletSession,
  walletAccess,
} from "./session";

export interface WalletState {
  account: string | null;
  chainId: number | null;
  /** This tab's sign-in (secret-free; the credential is a cookie or a kept token). */
  sessionId: string | null;
  sessionExpiresAt: number | null;
  /** How the session reaches the API: its cookie, or a bearer token (an API on another site). */
  sessionTransport: Transport | null;
  member: MemberView | null;
  access: WalletAccess;
  /** Why the invite code given at the last sign-in did not admit the wallet. */
  inviteError: string | null;
  error: string | null;
  persistenceError: string | null;
  restoring: boolean;
  status: "idle" | "connecting" | "connected" | "signing" | "error";
}
type Request = <T>(
  path: string,
  options: {
    body?: unknown;
    cookies?: boolean;
    auth?: string | true;
    wallet?: string;
    bearer?: string;
  },
) => Promise<T>;
interface Dependencies {
  deployment: {
    chainId: number;
    exchange: Address;
    chainName: string;
    rpcUrl: string;
    explorerUrl: string;
  };
  sources(): WalletSources;
  storage(): SessionStorage | null;
  origin(): string;
  /** The API's origin as requests reach it: whether cookies get there is checked per API. */
  api(): string;
  /** Reads receipts from the deployment's RPC, not the wallet's. */
  client(): Pick<PublicClient, "waitForTransactionReceipt">;
  request: Request;
  clearCache(): void;
}
const initialState: WalletState = {
  account: null,
  chainId: null,
  sessionId: null,
  sessionExpiresAt: null,
  sessionTransport: null,
  member: null,
  access: "disconnected",
  inviteError: null,
  error: null,
  persistenceError: null,
  restoring: true,
  status: "idle",
};
const statusOf = (error: unknown) => (error as { status?: unknown } | null)?.status;

/** One controller per mounted provider. No wallet/session state is created during SSR.
 *
 * A wallet signs a message once; its session then lasts 30 days from its last use (each read
 * renews it), one per wallet, so switching accounts, locking the wallet or reloading never asks
 * for another signature. Only an explicit disconnect signs a wallet out. */
export function createWalletController(deps: Dependencies) {
  let state = initialState;
  let session: WalletSession | null = null;
  let selected: WalletHandle | null = null;
  /** The provider's current account, as its last `accountsChanged` or connection reported. */
  let walletAccount: string | null = null;
  let generation = 0,
    networkRequest = 0,
    operationId = 0;
  let pending: number | null = null;
  let connecting = false,
    mounted = false;
  /** The session was read for this generation and account: actions do not reread it. */
  let probed: string | null = null;
  let probe: Promise<void> | null = null;
  let checking: Promise<Transport> | null = null;
  /** When the active session was last read from the API (each read renews it). */
  let lastRead = 0;
  let cleanupProvider = () => {};
  let cleanupLifecycle = () => {};
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<WalletState>) => {
    state = { ...state, ...patch };
    state.access = walletAccess(state.account, session);
    for (const listener of listeners) listener();
  };
  const binding = () => sessionBinding(deps.deployment, deps.origin());
  const currentWallet = () => {
    if (!selected || findWallet(deps.sources(), selected.kind)?.provider !== selected.provider)
      throw new Error("Wallet is unavailable. Connect again.");
    return selected.provider;
  };
  const currentAccount = () => {
    currentWallet();
    return walletAccount;
  };
  const activate = (value: WalletSession | null, read = false) => {
    session = value;
    if (read) lastRead = Date.now();
    setRequestSession(
      value,
      value
        ? () => {
            if (!mounted || state.account !== value.owner || currentAccount() !== value.owner)
              throw new Error("Wallet changed. Review the action again.");
          }
        : undefined,
    );
    scheduleReread();
    publish({
      sessionId: value?.id ?? null,
      sessionExpiresAt: value?.expiresAt ?? null,
      sessionTransport: value?.transport ?? null,
      member: value?.member ?? null,
    });
  };
  /** This tab stops using its session; the session itself stays for the wallet's return. */
  const clearSession = () => {
    activate(null);
    deps.clearCache();
  };
  /** Ends `ended` everywhere: at the API, in this browser's storage, and in other tabs. */
  const endSession = (ended: {
    owner: string;
    transport: Transport;
    token?: string;
    id?: string;
  }) => {
    void deps
      .request(
        "/v1/auth/logout",
        ended.transport === "token"
          ? { body: {}, bearer: ended.token ?? "" }
          : { body: {}, cookies: true, wallet: ended.owner },
      )
      .catch(() => undefined);
    if (ended.transport === "token") forgetToken(deps.storage(), binding(), ended.owner);
    else if (ended.id && announcedSession(deps.storage(), binding())?.id === ended.id)
      forget(deps.storage(), SESSION_STORAGE_KEY);
  };
  /** The API refused the session (expired or signed out elsewhere): this wallet signs in again. */
  const invalidateSession = (expectedId?: string) => {
    if (expectedId !== undefined && session?.id !== expectedId) return;
    const ended = session;
    generation++;
    clearSession();
    if (ended?.transport === "token") forgetToken(deps.storage(), binding(), ended.owner);
    // A cookie refused right after signing in never reached the API: check again next time.
    if (ended?.transport === "cookie" && Date.now() - ended.issuedAt < 60_000)
      rememberTransport(deps.storage(), deps.api(), null);
  };
  /** Rereads the session when it is due (daily in a long-open tab, and at its end): the read
   * renews it, so a tab in use stays signed in. */
  function rereadIfDue() {
    if (session && Date.now() >= Math.min(session.expiresAt, lastRead + SESSION_REREAD_MS))
      void restoreSession(true);
  }
  function scheduleReread(retryMs?: number) {
    clearTimeout(expiryTimer);
    if (!session) return;
    const due = Math.min(session.expiresAt, lastRead + SESSION_REREAD_MS) - Date.now();
    // Browser timers overflow beyond ~24.8 days.
    expiryTimer = setTimeout(rereadIfDue, Math.min(2_147_483_647, retryMs ?? Math.max(1_000, due)));
  }
  const dropConnection = (forgetSaved = true) => {
    generation++;
    networkRequest++;
    cleanupProvider();
    cleanupProvider = () => {};
    selected = null;
    walletAccount = null;
    publish({ account: null, chainId: null, status: "idle", error: null, inviteError: null });
    clearSession();
    if (forgetSaved) forget(deps.storage(), WALLET_STORAGE_KEY);
  };
  /** The wallet locked or stopped answering: this tab shows no wallet, but nothing is signed out
   * and the wallet stays remembered, so unlocking it brings the session back without a signature. */
  const walletAway = () => {
    generation++;
    networkRequest++;
    walletAccount = null;
    publish({ account: null, chainId: null, status: "idle", error: null, inviteError: null });
    clearSession();
  };
  const remember = (handle: WalletHandle, owner: string) => {
    if (!rememberWallet(deps.storage(), handle.kind, owner))
      publish({
        persistenceError:
          "Browser storage is unavailable. You may need to reconnect after refresh.",
      });
  };
  const capture = () => {
    const revision = generation,
      owner = state.account,
      id = session?.id ?? null;
    if (!owner) throw new Error("Connect a wallet first.");
    const check = () => {
      if (
        !mounted ||
        revision !== generation ||
        state.account !== owner ||
        currentAccount() !== owner ||
        (session?.id ?? null) !== id
      )
        throw new Error("Wallet or session changed. Review the action again.");
      if (id) assertRequestSession(id);
    };
    check();
    return check;
  };
  const begin = () => {
    if (!mounted) throw new Error("Wallet connection is not ready.");
    if (pending !== null) throw new Error("A wallet request is already in progress.");
    pending = ++operationId;
    return pending;
  };
  const finish = (id: number) => {
    if (pending !== id) return;
    pending = null;
    connecting = false;
    publish({ status: state.account ? "connected" : "idle" });
  };
  const walletChain = async () => Number(await currentWallet().request({ method: "eth_chainId" }));
  /** Confirms the wallet is on the deployment's chain; an interactive check asks it to switch
   * (adding the chain when unknown). A silent check never opens a wallet prompt. */
  const verifyNetwork = async (interactive = true) => {
    const owner = state.account,
      revision = generation,
      request = ++networkRequest;
    if (!owner) throw new Error("Connect a wallet first.");
    const current = () => mounted && request === networkRequest && revision === generation;
    const { chainId, chainName, rpcUrl, explorerUrl } = deps.deployment;
    publish({ error: null });
    try {
      let actual = await walletChain();
      if (actual !== chainId && interactive) {
        const provider = currentWallet();
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: toHex(chainId) }],
          });
        } catch (cause) {
          if ((cause as { code?: number }).code !== 4902) throw cause;
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: toHex(chainId),
                chainName,
                nativeCurrency: nativeCurrency(chainId),
                rpcUrls: [rpcUrl],
                ...(explorerUrl ? { blockExplorerUrls: [explorerUrl] } : {}),
              },
            ],
          });
        }
        actual = await walletChain();
      }
      if (!current() || currentAccount() !== owner)
        throw new Error("Wallet changed during network verification. Connect again.");
      publish({ chainId: actual });
      if (actual !== chainId) throw new Error(`Switch your wallet to ${chainName} to continue.`);
    } catch (error) {
      if (current())
        publish({ error: error instanceof Error ? error.message : "Network verification failed." });
      throw error;
    }
  };
  /** How sessions reach this API, checked once per browser and then kept: a throwaway cookie is
   * set, then read. Cookies when they come back; bearer tokens kept in this browser when not (an
   * API on another site). */
  const transport = (): Promise<Transport> => {
    const known = knownTransport(deps.storage(), deps.api());
    if (known) return Promise.resolve(known);
    checking ??= (async () => {
      try {
        await deps.request("/v1/auth/cookie-check", { body: {}, cookies: true });
        const { cookies } = await deps.request<{ cookies?: unknown }>("/v1/auth/cookie-check", {
          cookies: true,
        });
        const found: Transport = cookies === true ? "cookie" : "token";
        rememberTransport(deps.storage(), deps.api(), found);
        return found;
      } finally {
        checking = null;
      }
    })();
    return checking;
  };
  /** Reads this wallet's session from the API (a sign-in that survived a reload, a lock or an
   * account switch), renewing it. Never prompts; once per account unless `force` (another tab's
   * sign-in, a refused request, or a renewal) asks to reread it. */
  const restoreSession = (force = false): Promise<void> => {
    const owner = state.account;
    // A session past its end by this clock is reread: another tab may have renewed it.
    const ended = session !== null && Date.now() >= session.expiresAt;
    if (!owner || (!force && !ended && (session || probed === `${generation}:${owner}`)))
      return Promise.resolve();
    if (probe) return probe;
    const revision = generation;
    const stale = () => !mounted || revision !== generation || state.account !== owner;
    probe = (async () => {
      try {
        const via = await transport();
        if (stale()) return;
        const kept = via === "token" ? storedToken(deps.storage(), binding(), owner) : null;
        if (via === "token" && !kept) {
          // Nothing kept for this wallet: it signs in when it acts (no request needed).
          probed = `${generation}:${owner}`;
          if (session) clearSession();
          return;
        }
        const issuedAt = Date.now();
        const result = await deps.request<Record<string, unknown>>(
          `/v1/auth/session?wallet=${owner}`,
          kept ? { bearer: kept.token } : { cookies: true },
        );
        if (stale()) return;
        probed = `${generation}:${owner}`;
        const value = createWalletSession(binding(), owner, result, issuedAt, via, kept?.token);
        if (kept) storeToken(deps.storage(), binding(), owner, kept.token, value.expiresAt);
        // A reread keeps the sign-in it refreshes, so actions reviewed under it stay valid.
        activate(
          session?.owner === owner && session.transport === via
            ? { ...value, id: session.id, issuedAt: session.issuedAt }
            : value,
          true,
        );
      } catch (error) {
        if (stale()) return;
        if (statusOf(error) === 401) {
          probed = `${generation}:${owner}`;
          forgetToken(deps.storage(), binding(), owner);
          if (session) clearSession();
        } else if (session) scheduleReread(60_000);
        // Other failures keep what this tab knew and retry; the next action reads again.
      } finally {
        probe = null;
      }
    })();
    return probe;
  };
  /** Verifies the wallet's network; the session is read either way (it does not depend on it). */
  const ensureNetwork = async (interactive = true) => {
    try {
      await verifyNetwork(interactive);
    } finally {
      await restoreSession();
    }
  };
  const attach = (handle: WalletHandle) => {
    if (selected?.provider === handle.provider) return;
    cleanupProvider();
    selected = handle;
    const p = handle.provider;
    const changed = (accounts: unknown) => {
      const first = Array.isArray(accounts) ? accounts[0] : undefined;
      const owner =
        typeof first === "string" && isAddress(first, { strict: false }) ? getAddress(first) : null;
      walletAccount = owner;
      if ((!state.account && connecting) || owner === state.account) return;
      if (!owner) {
        walletAway();
        return;
      }
      // Another account (or the same one, unlocked): its own session, if it has one, applies.
      generation++;
      networkRequest++;
      clearSession();
      publish({ account: owner, chainId: null, status: "connected", inviteError: null });
      remember(handle, owner);
      const settle = async () => {
        try {
          await verifyNetwork(false);
        } catch {
          /* The network error is already visible. */
        }
        await restoreSession();
      };
      void settle();
    };
    const chainChanged = (value: unknown) => {
      if (state.account) publish({ chainId: Number(value) });
    };
    p.on?.("accountsChanged", changed);
    p.on?.("chainChanged", chainChanged);
    p.on?.("disconnect", walletAway);
    cleanupProvider = () => {
      p.removeListener?.("accountsChanged", changed);
      p.removeListener?.("chainChanged", chainChanged);
      p.removeListener?.("disconnect", walletAway);
    };
  };
  const establish = async (handle: WalletHandle, silent: boolean) => {
    const id = begin(),
      revision = generation;
    connecting = true;
    publish({ status: "connecting", error: null, persistenceError: null });
    attach(handle);
    try {
      const owner = await connectWallet(handle, silent);
      if (!mounted || revision !== generation) throw new Error("Wallet changed during connection.");
      walletAccount = owner;
      clearSession();
      generation++;
      publish({ account: owner, inviteError: null });
      remember(handle, owner);
      await ensureNetwork(!silent);
    } catch (error) {
      if (mounted && !silent && pending === id)
        publish({ error: error instanceof Error ? error.message : "Wallet connection failed." });
      throw error;
    } finally {
      finish(id);
    }
  };
  const connect = async (kind?: WalletKind) => {
    const saved = rememberedWallet(deps.storage());
    const handle = kind
      ? findWallet(deps.sources(), kind)
      : (saved && findWallet(deps.sources(), saved.kind)) || findWallet(deps.sources());
    if (!handle)
      throw new Error("Open an Ethereum wallet such as MetaMask, Coinbase Wallet or Rabby.");
    await establish(handle, false);
  };
  /** The one way to sign out: ends this wallet's session and forgets the wallet. */
  const disconnect = () => {
    const p = selected?.provider;
    if (session) endSession(session);
    dropConnection();
    // Best effort: EIP-2255 wallets forget this site's account permission.
    void p
      ?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] } as never)
      .catch(() => undefined);
  };
  /** Joins with `code` as the signed-in wallet. */
  const redeem = async (code: string, check: () => void) => {
    const current = session;
    if (!current) throw new Error("Sign in first.");
    try {
      const result = await deps.request<{ member: unknown }>("/v1/invites/redeem", {
        body: { code },
        auth: current.id,
      });
      check();
      activate({ ...current, member: parseMember(result.member) });
    } catch (error) {
      if (session === current)
        publish({
          inviteError: error instanceof Error ? error.message : "That code did not work.",
        });
      throw error;
    }
  };
  /** Signs in with the wallet (Sign-In with Ethereum), or reuses the wallet's session. With an
   * invite code, a wallet that has not joined joins in the same signature. Returns the sign-in's
   * id for requests. */
  const authenticate = async (invite?: string | null) => {
    const code = invite ? normalizeInviteCode(invite) : null;
    if (invite && !code) throw new Error("That is not an invite code.");
    if (!state.account) throw new Error("Connect a wallet first.");
    // A session this wallet already holds needs no signature.
    await restoreSession();
    const check = capture();
    const owner = state.account;
    if (!owner) throw new Error("Connect a wallet first.");
    const id = begin();
    publish({ status: "signing", inviteError: null });
    try {
      await verifyNetwork();
      check();
      if (session) {
        if (code && !session.member) await redeem(code, check);
        return session.id;
      }
      const via = await transport();
      check();
      const ask = (invite: string | null) =>
        deps.request<{ challengeId: string; message: string; invite?: string | null }>(
          "/v1/auth/challenge",
          { body: { address: owner, origin: deps.origin(), ...(invite ? { invite } : {}) } },
        );
      let inviteError: string | null = null;
      let challenge: Awaited<ReturnType<typeof ask>>;
      try {
        challenge = await ask(code);
      } catch (error) {
        // A code that cannot admit this wallet never blocks signing in: it says why instead.
        if (!code || statusOf(error) !== 400) throw error;
        inviteError = error instanceof Error ? error.message : "That invite code did not work.";
        check();
        challenge = await ask(null);
      }
      // A wallet that already joined signs without the code; never with a different one.
      const included = challenge.invite ?? null;
      if (included !== null && (inviteError !== null || included !== code))
        throw new Error("Sign-in challenge differs from this deployment.");
      assertSignInChallenge(challenge, owner, deps.deployment, deps.origin(), included);
      check();
      const signature = (await currentWallet().request({
        method: "personal_sign",
        params: [stringToHex(challenge.message), owner as Address],
      })) as Hex;
      check();
      const issuedAt = Date.now();
      const result = await deps.request<Record<string, unknown>>("/v1/auth/verify", {
        body: { address: owner, challengeId: challenge.challengeId, signature, session: via },
        cookies: via === "cookie",
      });
      const token = via === "token" && typeof result.token === "string" ? result.token : undefined;
      try {
        check();
      } catch (error) {
        // The wallet changed while the API signed it in: that session must not linger.
        endSession({ owner, transport: via, ...(token ? { token } : {}) });
        throw error;
      }
      const value = createWalletSession(binding(), owner, result, issuedAt, via, token);
      if (!token) announceSession(deps.storage(), value);
      else if (!storeToken(deps.storage(), binding(), owner, token, value.expiresAt))
        publish({
          persistenceError:
            "Browser storage is unavailable. This sign-in works now but cannot survive a refresh.",
        });
      activate(value, true);
      if (typeof result.inviteError === "string") inviteError = result.inviteError;
      if (inviteError) publish({ inviteError });
      return value.id;
    } finally {
      finish(id);
    }
  };
  const sendTransaction = async (value: { to: string; data: string; value?: string }) => {
    if (value.value !== undefined && value.value !== "0")
      throw new Error("Invalid transaction value.");
    const check = capture();
    const owner = state.account;
    if (!owner) throw new Error("Connect a wallet first.");
    const id = begin();
    publish({ status: "signing" });
    try {
      await verifyNetwork();
      check();
      const hash = (await currentWallet().request({
        method: "eth_sendTransaction",
        params: [
          {
            from: owner as Address,
            to: getAddress(value.to),
            data: value.data as Hex,
            value: "0x0",
          },
        ],
      })) as Hex;
      const receipt = await deps.client().waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success")
        throw new Error("Transaction failed. Its state changes were rolled back.");
      return hash;
    } finally {
      finish(id);
    }
  };
  /** An earlier release kept one bearer session in storage: it carries over (into its wallet's
   * cookie, or the token store), so upgrading never asks for a signature. */
  const carryOver = async () => {
    const legacy = legacySession(deps.storage(), binding());
    if (!legacy) {
      forget(deps.storage(), LEGACY_SESSION_KEY);
      return;
    }
    try {
      if ((await transport()) === "token")
        storeToken(deps.storage(), binding(), legacy.owner, legacy.token, legacy.expiresAt);
      else
        await deps.request("/v1/auth/session/cookie", {
          body: {},
          cookies: true,
          bearer: legacy.token,
        });
      forget(deps.storage(), LEGACY_SESSION_KEY);
    } catch (error) {
      // Kept for the next load unless the API refused it.
      const status = statusOf(error);
      if (status === 401 || status === 403) forget(deps.storage(), LEGACY_SESSION_KEY);
    }
  };
  const start = (events: { window: EventTarget; document: EventTarget }) => {
    mounted = true;
    publish({ restoring: true });
    const started = Date.now();
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const restore = async () => {
      if (disposed) return;
      const saved = rememberedWallet(deps.storage());
      if (!saved) {
        publish({ restoring: false });
        return;
      }
      const handle = findWallet(deps.sources(), saved.kind);
      if (!handle && Date.now() - started < 10_000) {
        timer = setTimeout(() => void restore(), 250);
        return;
      }
      try {
        if (handle) await establish(handle, true);
      } catch {
        /* Locked/revoked wallets need a manual connection, never an automatic popup. */
      } finally {
        if (!disposed) publish({ restoring: false });
      }
    };
    const expired = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id === "string") invalidateSession(id);
    };
    const membership = () => void restoreSession(true);
    const storageChanged = (event: Event) => {
      const e = event as StorageEvent;
      if (e.storageArea && e.storageArea !== deps.storage()) return;
      if (e.key === null || e.key === WALLET_STORAGE_KEY) {
        const saved = rememberedWallet(deps.storage());
        if (!saved || (selected && (saved.owner !== state.account || saved.kind !== selected.kind)))
          dropConnection(false);
      }
      // Another tab signed in or out: reread this wallet's session.
      if (
        (e.key === null || e.key === SESSION_STORAGE_KEY || e.key === TOKEN_STORAGE_KEY) &&
        state.account
      )
        void restoreSession(true);
    };
    events.window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    events.window.addEventListener(MEMBERSHIP_EVENT, membership);
    events.window.addEventListener("storage", storageChanged);
    events.window.addEventListener("focus", rereadIfDue);
    events.document.addEventListener("visibilitychange", rereadIfDue);
    // Defer until after React StrictMode's immediate effect setup/cleanup.
    timer = setTimeout(() => {
      if (!disposed) void carryOver().finally(() => void restore());
    }, 0);
    cleanupLifecycle = () => {
      disposed = true;
      clearTimeout(timer);
      events.window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
      events.window.removeEventListener(MEMBERSHIP_EVENT, membership);
      events.window.removeEventListener("storage", storageChanged);
      events.window.removeEventListener("focus", rereadIfDue);
      events.document.removeEventListener("visibilitychange", rereadIfDue);
    };
  };
  const stop = () => {
    mounted = false;
    generation++;
    networkRequest++;
    pending = null;
    connecting = false;
    probed = null;
    cleanupLifecycle();
    cleanupProvider();
    cleanupProvider = () => {};
    selected = null;
    walletAccount = null;
    clearTimeout(expiryTimer);
    session = null;
    setRequestSession(null);
    state = initialState;
  };
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => initialState,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    stop,
    connect,
    disconnect,
    ensureNetwork,
    authenticate,
    /** Joins with an invite code, signing in first when needed (one signature). */
    joinWithInvite: (code: string) => authenticate(code),
    /** Rereads the session and membership from the API. */
    refreshSession: () => restoreSession(true),
    invalidateSession,
    sendTransaction,
  };
}
