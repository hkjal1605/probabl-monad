import { afterEach, expect, test } from "bun:test";
import { type EIP1193Provider, toHex } from "viem";
import { createWalletController } from "../src/lib/wallet/controller";
import type { WalletHandle, WalletSources } from "../src/lib/wallet/injected";
import {
  assertRequestSession,
  createWalletSession,
  persistWalletSession,
  rememberedWallet,
  rememberWallet,
  SESSION_EXPIRED_EVENT,
  SESSION_STORAGE_KEY,
  sessionBinding,
  WALLET_SESSION_MS,
  WALLET_STORAGE_KEY,
} from "../src/lib/wallet/session";
import { requestJson } from "../src/services/protocol-api-service";

const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  other = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const deployment = {
  chainId: 31337,
  chainName: "Anvil",
  exchange: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as `0x${string}`,
  rpcUrl: "http://127.0.0.1:8545",
  explorerUrl: "",
};
const origin = "http://localhost:3001",
  token = "a".repeat(64),
  transaction = { to: deployment.exchange, data: "0x1234" };
type Controller = ReturnType<typeof createWalletController>;
type Dependencies = Parameters<typeof createWalletController>[0];
const controllers: Controller[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.stop();
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};

/** An EIP-1193 wallet. `hooks` intercept one method (for races and failures). */
function mockWallet(calls: Record<string, number | string[]>) {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const state = {
    accounts: [owner.toLowerCase()],
    chainId: deployment.chainId,
    hooks: {} as Record<string, (params: unknown) => Promise<unknown>>,
  };
  const count = (name: string) => {
    calls[name] = ((calls[name] as number) ?? 0) + 1;
  };
  const provider = {
    request: async ({ method, params }: { method: string; params?: unknown }) => {
      (calls.methods as string[]).push(method);
      const hook = state.hooks[method];
      if (hook) return hook(params);
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return state.accounts;
        case "eth_chainId":
          count("network");
          return toHex(state.chainId);
        case "wallet_switchEthereumChain":
          state.chainId = Number((params as [{ chainId: string }])[0].chainId);
          return null;
        case "personal_sign":
          count("signMessage");
          return `0x${"11".repeat(65)}`;
        case "eth_sendTransaction":
          count("broadcasts");
          return `0x${"ab".repeat(32)}`;
        case "wallet_revokePermissions":
          return null;
      }
      throw new Error(`Unexpected ${method}`);
    },
    on: (event: string, handler: (value: unknown) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
    },
    removeListener: (event: string, handler: (value: unknown) => void) =>
      listeners.get(event)?.delete(handler),
  } as unknown as EIP1193Provider;
  const emit = (event: string, value?: unknown) => {
    for (const handler of listeners.get(event) ?? []) handler(value);
  };
  return { provider, state, emit };
}

function setup(saved = false, shared = storage()) {
  const events = { window: new EventTarget(), document: new EventTarget() };
  const calls = { methods: [] as string[], api: [] as string[], clears: 0 } as Record<
    string,
    number | string[]
  > & {
    methods: string[];
    api: string[];
    clears: number;
  };
  const wallet = mockWallet(calls);
  const handle: WalletHandle = {
    kind: "io.metamask",
    name: "MetaMask",
    icon: null,
    provider: wallet.provider,
  };
  const sources: { announced: WalletHandle[] } & WalletSources = { announced: [handle] };
  const receipt = { status: "success" as "success" | "reverted" };
  const deps: Dependencies = {
    deployment,
    sources: () => sources,
    storage: () => shared,
    origin: () => origin,
    client: () =>
      ({ waitForTransactionReceipt: async () => receipt }) as unknown as ReturnType<
        Dependencies["client"]
      >,
    request: async <T>(path: string) => {
      calls.api.push(path);
      const nonce = "c".repeat(64);
      return (
        path.endsWith("challenge")
          ? {
              challengeId: nonce,
              message: [
                "Sign in to probabl",
                `Origin: ${origin}`,
                `Chain: ${deployment.chainId}`,
                `Exchange: ${deployment.exchange}`,
                `Wallet: ${owner}`,
                `Nonce: ${nonce}`,
                `Expires: ${new Date(Date.now() + 120_000).toISOString()}`,
              ].join("\n"),
            }
          : { token }
      ) as T;
    },
    clearCache: () => {
      calls.clears++;
    },
  };
  if (saved) {
    rememberWallet(shared, "io.metamask", owner);
    persistWalletSession(
      shared,
      createWalletSession(sessionBinding(deployment, origin), owner, token),
    );
  }
  const controller = createWalletController(deps);
  controllers.push(controller);
  const change = (key: string | null) => {
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: key });
    events.window.dispatchEvent(event);
  };
  const count = (method: string) => calls.methods.filter((m) => m === method).length;
  return {
    controller,
    events,
    wallet,
    handle,
    sources,
    shared,
    calls,
    deps,
    change,
    count,
    receipt,
  };
}

test("connect and sign once, then refresh: a silent reconnect restores the same token without signing or extending expiry", async () => {
  const first = setup();
  first.controller.start(first.events);
  await tick();
  expect(first.count("eth_accounts") + first.count("eth_requestAccounts")).toBe(0);
  await first.controller.connect();
  expect(await first.controller.authenticate()).toBe(token);
  expect(first.calls.signMessage).toBe(1);
  const expiry = first.controller.getSnapshot().sessionExpiresAt;
  first.controller.stop();
  const next = setup(false, first.shared);
  next.controller.start(next.events);
  await tick();
  expect(next.count("eth_accounts")).toBe(1);
  expect(next.count("eth_requestAccounts")).toBe(0);
  expect(next.calls.network).toBe(1);
  expect(next.calls.api).toEqual([]);
  expect(next.calls.signMessage).toBeUndefined();
  expect(next.controller.getSnapshot()).toMatchObject({
    account: owner,
    chainId: deployment.chainId,
    sessionToken: token,
    sessionExpiresAt: expiry,
    restoring: false,
  });
  expect(await next.controller.authenticate()).toBe(token);
  expect(next.calls.signMessage).toBeUndefined();
  expect(() => assertRequestSession(token)).not.toThrow();
});

test("explicit wallet selection overrides a previously saved provider", async () => {
  const f = setup();
  rememberWallet(f.shared, "io.metamask", owner);
  const coinbase = mockWallet(f.calls);
  coinbase.state.accounts = [other];
  f.sources.announced.push({
    kind: "com.coinbase.wallet",
    name: "Coinbase",
    icon: null,
    provider: coinbase.provider,
  });
  f.controller.start(f.events);
  await tick();
  await f.controller.connect("com.coinbase.wallet");
  expect(f.controller.getSnapshot().account).toBe(other);
  expect(rememberedWallet(f.shared)?.kind).toBe("com.coinbase.wallet");
});

test("a wallet on another chain is asked to switch only on an explicit action, and unknown chains are added", async () => {
  const f = setup();
  f.wallet.state.chainId = 1;
  f.controller.start(f.events);
  await tick();
  await f.controller.connect();
  expect(f.count("wallet_switchEthereumChain")).toBe(1);
  expect(f.controller.getSnapshot().chainId).toBe(deployment.chainId);
  const g = setup();
  g.wallet.state.chainId = 1;
  let added = false;
  g.wallet.state.hooks.wallet_switchEthereumChain = async (params) => {
    if (!added) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
    g.wallet.state.chainId = Number((params as [{ chainId: string }])[0].chainId);
    return null;
  };
  g.wallet.state.hooks.wallet_addEthereumChain = async (params) => {
    added = true;
    expect((params as [{ chainId: string; rpcUrls: string[] }])[0]).toMatchObject({
      chainId: toHex(deployment.chainId),
      rpcUrls: [deployment.rpcUrl],
    });
    return null;
  };
  g.controller.start(g.events);
  await tick();
  // Adding the chain does not switch to it; the explicit action retries once.
  await expect(g.controller.connect()).rejects.toThrow("Switch your wallet");
  expect(added).toBe(true);
  await g.controller.ensureNetwork();
  expect(g.controller.getSnapshot().chainId).toBe(deployment.chainId);
});

test("expired authentication still restores the wallet, but cannot authenticate requests until a new signature", async () => {
  const f = setup(true);
  persistWalletSession(
    f.shared,
    createWalletSession(
      sessionBinding(deployment, origin),
      owner,
      token,
      Date.now() - WALLET_SESSION_MS,
    ),
  );
  f.controller.start(f.events);
  await tick();
  expect(f.controller.getSnapshot()).toMatchObject({ account: owner, sessionToken: null });
  expect(f.calls.signMessage).toBeUndefined();
  expect(() => assertRequestSession(token)).toThrow();
  await f.controller.authenticate();
  expect(f.calls.signMessage).toBe(1);
});

test("StrictMode setup/cleanup/setup issues only one silent reconnect and stopped providers cannot restore", async () => {
  const f = setup(true);
  f.controller.start(f.events);
  f.controller.stop();
  f.controller.start(f.events);
  await tick();
  expect(f.count("eth_accounts")).toBe(1);
  f.controller.stop();
  const old = setup(true),
    wait = deferred<string[]>();
  old.wallet.state.hooks.eth_accounts = async () => wait.promise;
  old.controller.start(old.events);
  await tick();
  old.controller.stop();
  wait.resolve([owner]);
  await tick();
  expect(old.controller.getSnapshot().account).toBeNull();
  expect(() => assertRequestSession(token)).toThrow();
});

test("locked or revoked wallets never prompt; a later manual connect can reuse the valid session", async () => {
  const f = setup(true);
  f.wallet.state.accounts = [];
  f.controller.start(f.events);
  await tick();
  expect(f.controller.getSnapshot()).toMatchObject({
    account: null,
    sessionToken: null,
    restoring: false,
  });
  expect(f.count("eth_requestAccounts")).toBe(0);
  expect(f.calls.signMessage).toBeUndefined();
  f.wallet.state.accounts = [owner];
  await f.controller.connect();
  expect(f.controller.getSnapshot().sessionToken).toBe(token);
});

test("a wrong chain fails closed on restore without a prompt; an explicit retry switches and restores the session", async () => {
  const f = setup(true);
  f.wallet.state.chainId = 1;
  f.wallet.state.hooks.wallet_switchEthereumChain = async () => {
    throw new Error("User rejected the request.");
  };
  f.controller.start(f.events);
  await tick();
  expect(f.count("wallet_switchEthereumChain")).toBe(0);
  expect(f.controller.getSnapshot()).toMatchObject({
    account: owner,
    chainId: 1,
    sessionToken: null,
    error: "Switch your wallet to Anvil to continue.",
  });
  expect(() => assertRequestSession(token)).toThrow();
  await expect(f.controller.ensureNetwork()).rejects.toThrow("rejected");
  delete f.wallet.state.hooks.wallet_switchEthereumChain;
  await f.controller.ensureNetwork();
  expect(f.controller.getSnapshot()).toMatchObject({
    chainId: deployment.chainId,
    sessionToken: token,
  });
});

test("account changes invalidate sessions and in-flight network checks; switching back does not resurrect old authentication", async () => {
  const f = setup(true);
  f.controller.start(f.events);
  await tick();
  const wait = deferred<string>();
  f.wallet.state.hooks.eth_chainId = async () => wait.promise;
  const network = f.controller.ensureNetwork();
  f.wallet.emit("accountsChanged", [other]);
  expect(f.controller.getSnapshot()).toMatchObject({
    account: other,
    chainId: null,
    sessionToken: null,
  });
  expect(f.shared.getItem(SESSION_STORAGE_KEY)).toBeNull();
  wait.resolve(toHex(deployment.chainId));
  await expect(network).rejects.toThrow("changed");
  f.wallet.emit("accountsChanged", [owner]);
  await tick();
  expect(f.controller.getSnapshot().sessionToken).toBeNull();
  expect(f.calls.clears).toBeGreaterThan(1);
  // An account change never prompts a chain switch.
  expect(f.count("wallet_switchEthereumChain")).toBe(0);
});

test("a different account returned by a silent reconnect cannot use the previously saved token", async () => {
  const f = setup(true);
  f.wallet.state.accounts = [other];
  f.controller.start(f.events);
  await tick();
  expect(f.controller.getSnapshot()).toMatchObject({ account: other, sessionToken: null });
  expect(f.shared.getItem(SESSION_STORAGE_KEY)).toBeNull();
  expect(rememberedWallet(f.shared)?.owner).toBe(other);
});

test("disconnect clears persistence even if the wallet rejects permission revocation", async () => {
  const f = setup(true);
  f.controller.start(f.events);
  await tick();
  f.wallet.state.hooks.wallet_revokePermissions = async () => {
    throw new Error("unsupported");
  };
  f.controller.disconnect();
  expect(f.controller.getSnapshot()).toMatchObject({
    account: null,
    chainId: null,
    sessionToken: null,
  });
  expect(f.shared.getItem(WALLET_STORAGE_KEY)).toBeNull();
  expect(f.shared.getItem(SESSION_STORAGE_KEY)).toBeNull();
  f.wallet.emit("accountsChanged", [owner]);
  expect(f.controller.getSnapshot().account).toBeNull();
  await tick();
});

test("cross-tab logout, session replacement, and late 401s cannot keep or overwrite an old session", async () => {
  const f = setup(true);
  f.controller.start(f.events);
  await tick();
  const newer = "b".repeat(64);
  persistWalletSession(
    f.shared,
    createWalletSession(sessionBinding(deployment, origin), owner, newer),
  );
  f.change(SESSION_STORAGE_KEY);
  expect(f.controller.getSnapshot().sessionToken).toBeNull();
  await f.controller.ensureNetwork();
  expect(f.controller.getSnapshot().sessionToken).toBe(newer);
  f.events.window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: token }));
  expect(f.controller.getSnapshot().sessionToken).toBe(newer);
  f.events.window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: newer }));
  expect(f.controller.getSnapshot()).toMatchObject({ account: owner, sessionToken: null });
  expect(f.shared.getItem(SESSION_STORAGE_KEY)).toBeNull();
  f.shared.removeItem(WALLET_STORAGE_KEY);
  f.change(WALLET_STORAGE_KEY);
  expect(f.controller.getSnapshot().account).toBeNull();
});

test("disconnect during sign-in prevents a late API response from reactivating or persisting a session", async () => {
  const f = setup();
  f.controller.start(f.events);
  await tick();
  await f.controller.connect();
  const verify = deferred<{ token: string }>(),
    request = f.deps.request;
  f.deps.request = async <T>(path: string, options: { body: unknown }) =>
    path.endsWith("verify") ? ((await verify.promise) as T) : request<T>(path, options);
  const authentication = f.controller.authenticate();
  await tick();
  expect(f.calls.signMessage).toBe(1);
  await expect(f.controller.authenticate()).rejects.toThrow("already in progress");
  f.controller.disconnect();
  verify.resolve({ token });
  await expect(authentication).rejects.toThrow("changed");
  expect(f.controller.getSnapshot().sessionToken).toBeNull();
  expect(f.shared.getItem(SESSION_STORAGE_KEY)).toBeNull();
});

test("a replaced wallet provider without an account event cannot send authenticated requests", async () => {
  const f = setup(true);
  f.controller.start(f.events);
  await tick();
  f.sources.announced[0] = { ...f.handle, provider: mockWallet(f.calls).provider };
  expect(() => assertRequestSession(token)).toThrow();
  await expect(f.controller.sendTransaction(transaction)).rejects.toThrow();
  expect(f.calls.broadcasts).toBeUndefined();
});

test("wallet or session changes before signing, and reverted receipts, never report success", async () => {
  for (const change of ["account", "session"] as const) {
    const f = setup(true);
    f.controller.start(f.events);
    await tick();
    f.wallet.state.hooks.eth_chainId = async () => {
      if (change === "account") f.wallet.emit("accountsChanged", [other]);
      else f.controller.invalidateSession();
      return toHex(deployment.chainId);
    };
    await expect(f.controller.sendTransaction(transaction)).rejects.toThrow();
    expect(f.calls.broadcasts).toBeUndefined();
    f.controller.stop();
  }
  const f = setup(true);
  f.controller.start(f.events);
  await tick();
  await expect(f.controller.sendTransaction({ ...transaction, value: "1" })).rejects.toThrow(
    "value",
  );
  expect(await f.controller.sendTransaction(transaction)).toBe(`0x${"ab".repeat(32)}`);
  expect(f.calls.broadcasts).toBe(1);
  f.receipt.status = "reverted";
  await expect(f.controller.sendTransaction(transaction)).rejects.toThrow("rolled back");
});

test("request-time expiry blocks background tabs before fetch; API 401 invalidates only its request token", async () => {
  const f = setup(true),
    originalFetch = globalThis.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: f.events.window });
  let calls = 0;
  const now = Date.now;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ error: { message: "Expired on server" } }, { status: 401 });
  }) as unknown as typeof fetch;
  try {
    f.controller.start(f.events);
    await tick();
    const expiry = f.controller.getSnapshot().sessionExpiresAt;
    if (expiry === null) throw new Error("Expected a restored session");
    Date.now = () => expiry;
    await expect(requestJson("/v1/orders/prepare", { token, body: {} })).rejects.toThrow("expired");
    expect(calls).toBe(0);
    expect(f.controller.getSnapshot().sessionToken).toBeNull();
    expect(f.controller.getSnapshot().account).toBe(owner);
    Date.now = now;
    await f.controller.authenticate();
    await expect(requestJson("/v1/orders/prepare", { token, body: {} })).rejects.toThrow(
      "Expired on server",
    );
    expect(calls).toBe(1);
    expect(f.controller.getSnapshot().sessionToken).toBeNull();
  } finally {
    Date.now = now;
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("focus and visibility checks expire sessions without disconnecting the wallet, including clock rollback", async () => {
  const now = Date.now;
  try {
    for (const mode of ["focus", "visibility", "rollback"] as const) {
      const f = setup(true);
      f.controller.start(f.events);
      await tick();
      const saved = JSON.parse(f.shared.getItem(SESSION_STORAGE_KEY) ?? "{}");
      Date.now = () => (mode === "rollback" ? saved.issuedAt - 1 : saved.expiresAt);
      if (mode === "visibility") f.events.document.dispatchEvent(new Event("visibilitychange"));
      else f.events.window.dispatchEvent(new Event("focus"));
      expect(f.controller.getSnapshot()).toMatchObject({ account: owner, sessionToken: null });
      expect(f.shared.getItem(SESSION_STORAGE_KEY)).toBeNull();
      expect(rememberedWallet(f.shared)?.owner).toBe(owner);
      f.controller.stop();
      Date.now = now;
    }
  } finally {
    Date.now = now;
  }
});

test("the expiry timer invalidates a short-lived upstream session", async () => {
  const f = setup(true);
  persistWalletSession(
    f.shared,
    createWalletSession(
      sessionBinding(deployment, origin),
      owner,
      token,
      Date.now(),
      Date.now() + 40,
    ),
  );
  f.controller.start(f.events);
  await tick();
  expect(f.controller.getSnapshot().sessionToken).toBe(token);
  await new Promise<void>((resolve) => setTimeout(resolve, 55));
  expect(f.controller.getSnapshot()).toMatchObject({ account: owner, sessionToken: null });
});

test("restoration waits for a late wallet announcement and respects the remembered provider", async () => {
  const f = setup(true);
  f.sources.announced = [];
  f.controller.start(f.events);
  await tick();
  expect(f.count("eth_accounts")).toBe(0);
  expect(f.controller.getSnapshot().restoring).toBe(true);
  f.sources.announced = [f.handle];
  await new Promise<void>((resolve) => setTimeout(resolve, 275));
  expect(f.count("eth_accounts")).toBe(1);
  expect(f.controller.getSnapshot()).toMatchObject({ sessionToken: token, restoring: false });
});

test("blocked browser storage retains a usable memory session and exposes a persistence warning", async () => {
  const f = setup();
  f.deps.storage = () => null;
  f.controller.start(f.events);
  await tick();
  await f.controller.connect();
  expect(await f.controller.authenticate()).toBe(token);
  expect(f.controller.getSnapshot().persistenceError).toContain("cannot survive");
  expect(() => assertRequestSession(token)).not.toThrow();
  expect(f.shared.getItem(SESSION_STORAGE_KEY)).toBeNull();
});

test("a foreign deployment session cannot restore, and a forged challenge cannot trigger signing", async () => {
  const f = setup(true);
  persistWalletSession(f.shared, createWalletSession("another network", owner, token));
  f.controller.start(f.events);
  await tick();
  expect(f.controller.getSnapshot().sessionToken).toBeNull();
  f.deps.request = async <T>() =>
    ({ challengeId: "c".repeat(64), message: "Sign something else" }) as T;
  await expect(f.controller.authenticate()).rejects.toThrow("deployment");
  expect(f.calls.signMessage).toBeUndefined();
});

test("provider disconnect events clear the session", async () => {
  const f = setup(true);
  f.controller.start(f.events);
  await tick();
  f.wallet.emit("disconnect");
  expect(f.controller.getSnapshot()).toMatchObject({ account: null, sessionToken: null });
  expect(f.shared.getItem(WALLET_STORAGE_KEY)).toBeNull();
  expect(f.shared.getItem(SESSION_STORAGE_KEY)).toBeNull();
});
