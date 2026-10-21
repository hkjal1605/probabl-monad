import { afterEach, expect, test } from "bun:test";
import { signInMessage } from "@conditional-stocks/evm-client";
import { type EIP1193Provider, getAddress, hexToString, toHex } from "viem";
import { createWalletController } from "../src/lib/wallet/controller";
import type { WalletHandle, WalletSources } from "../src/lib/wallet/injected";
import {
  assertRequestSession,
  knownTransport,
  LEGACY_SESSION_KEY,
  MEMBERSHIP_EVENT,
  rememberedWallet,
  rememberWallet,
  SESSION_EXPIRED_EVENT,
  SESSION_STORAGE_KEY,
  sessionBinding,
  storedToken,
  storeToken,
  TOKEN_STORAGE_KEY,
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
  apiOrigin = "https://api.example.com",
  binding = sessionBinding(deployment, origin),
  day = 24 * 60 * 60 * 1000,
  transaction = { to: deployment.exchange, data: "0x1234" };
type Controller = ReturnType<typeof createWalletController>;
type Dependencies = Parameters<typeof createWalletController>[0];
type Options = Parameters<Dependencies["request"]>[1];
type Environment = "cookie" | "token";
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
const refused = (status: number, message: string) => Object.assign(new Error(message), { status });
const member = () => ({
  joinedAt: new Date().toISOString(),
  referrer: null,
  codeQuota: 5,
  suspended: false,
});
let tokens = 0;
/** The API's clock: right, whatever the page's (Date.now, which tests move) says. */
const realNow = Date.now;
const serverNow = () => realNow.call(Date);
const newToken = () => (++tokens).toString(16).padStart(64, "0");

/** The API as this browser reaches it. "cookie": its cookies reach the API (the app on the API's
 * site), each wallet with its own; "token": they never do (another site), so sessions are bearer
 * tokens. Sessions last 30 days from their last read. */
function mockApi(environment: Environment = "cookie") {
  const server = {
    sessions: new Map<string, { owner: string; expiresAtMs: number }>(),
    /** The browser's cookie jar for the API: one session cookie per wallet. */
    cookies: new Map<string, string>(),
    check: false,
    members: new Map<string, ReturnType<typeof member>>(),
    codes: new Set(["BETA0001", "BETA0002"]),
    challenges: new Map<string, { owner: string; invite: string | null }>(),
    calls: [] as { path: string; options: Options }[],
    lifetimeMs: 30 * day,
  };
  const live = (token: string | undefined) => {
    const s = token ? server.sessions.get(token) : undefined;
    return s && s.expiresAtMs > serverNow() ? { token: token as string, ...s } : undefined;
  };
  const view = (wallet: string, expiresAtMs: number) => ({
    wallet,
    expiresAtMs,
    expiresInMs: expiresAtMs - serverNow(),
    member: server.members.get(wallet) ?? null,
  });
  /** The credential a request carries: an explicit or the active session's token, or the cookie
   * of the wallet it names (when cookies reach the API at all). */
  const credential = (path: string, options: Options) => {
    if (options.bearer) return live(options.bearer);
    if (options.auth !== undefined) {
      const active = assertRequestSession(options.auth === true ? undefined : options.auth);
      if (active.transport === "token") return live(active.token);
      return environment === "cookie" ? live(server.cookies.get(active.owner)) : undefined;
    }
    if (!options.cookies || environment !== "cookie") return undefined;
    const named = new URL(path, apiOrigin).searchParams.get("wallet") ?? options.wallet;
    return named ? live(server.cookies.get(getAddress(named))) : undefined;
  };
  const join = (wallet: string, code: string) => {
    if (!server.codes.has(code)) throw refused(400, "This invite code was already used.");
    server.codes.delete(code);
    server.members.set(wallet, member());
  };
  const request = async <T>(path: string, options: Options): Promise<T> => {
    server.calls.push({ path, options });
    const body = options.body as Record<string, string> | undefined;
    if (path === "/v1/auth/cookie-check") {
      if (body !== undefined) {
        server.check = environment === "cookie" && options.cookies === true;
        return { ok: true } as T;
      }
      const reached = server.check && options.cookies === true;
      server.check = false;
      return { cookies: reached } as T;
    }
    if (path.startsWith("/v1/auth/session?")) {
      const s = credential(path, options);
      if (!s) throw refused(401, "Sign in to continue");
      // Each read renews the session.
      const renewed = { owner: s.owner, expiresAtMs: serverNow() + server.lifetimeMs };
      server.sessions.set(s.token, renewed);
      return view(s.owner, renewed.expiresAtMs) as T;
    }
    if (path === "/v1/auth/challenge") {
      const wallet = getAddress(body!.address!);
      let invite: string | null = body!.invite ?? null;
      if (invite && server.members.has(wallet)) invite = null;
      if (invite && !server.codes.has(invite))
        throw refused(400, "This invite code was already used.");
      const nonce = `${server.challenges.size}`.padStart(64, "c");
      server.challenges.set(nonce, { owner: wallet, invite });
      return {
        challengeId: nonce,
        message: signInMessage(deployment, origin, wallet, nonce, new Date(serverNow() + 120_000), {
          invite,
          issuedAt: new Date(serverNow()),
        }),
        invite,
      } as T;
    }
    if (path === "/v1/auth/verify") {
      const challenge = server.challenges.get(body!.challengeId!);
      if (!challenge) throw refused(400, "Challenge expired or consumed");
      server.challenges.delete(body!.challengeId!);
      let inviteError: string | undefined;
      if (challenge.invite && !server.members.has(challenge.owner))
        try {
          join(challenge.owner, challenge.invite);
        } catch (error) {
          inviteError = (error as Error).message;
        }
      const token = newToken();
      const expiresAtMs = serverNow() + server.lifetimeMs;
      server.sessions.set(token, { owner: challenge.owner, expiresAtMs });
      const mode = body!.session;
      if (mode !== "token" && options.cookies && environment === "cookie")
        server.cookies.set(challenge.owner, token);
      return {
        ...view(challenge.owner, expiresAtMs),
        ...(mode === "cookie" ? {} : { token }),
        inviteError,
      } as T;
    }
    if (path === "/v1/auth/session/cookie") {
      const s = live(options.bearer);
      if (!s) throw refused(401, "Sign in to continue");
      if (environment === "cookie") server.cookies.set(s.owner, s.token);
      return view(s.owner, s.expiresAtMs) as T;
    }
    if (path === "/v1/auth/logout") {
      const s = credential(path, options);
      if (!s) throw refused(401, "Sign in to continue");
      server.sessions.delete(s.token);
      if (server.cookies.get(s.owner) === s.token) server.cookies.delete(s.owner);
      return { ok: true } as T;
    }
    if (path === "/v1/invites/redeem") {
      const session = assertRequestSession(options.auth === true ? undefined : options.auth);
      join(session.owner, body!.code!);
      return { member: server.members.get(session.owner) } as T;
    }
    throw new Error(`Unexpected ${path}`);
  };
  return { server, request };
}

/** An EIP-1193 wallet. `hooks` intercept one method (for races and failures). */
function mockWallet(calls: Record<string, number | string[]>) {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const state = {
    accounts: [owner.toLowerCase()],
    chainId: deployment.chainId,
    hooks: {} as Record<string, (params: unknown) => Promise<unknown>>,
    signed: [] as string[],
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
          state.signed.push(hexToString((params as [`0x${string}`])[0]));
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

/** `signedIn`: `owner` already holds a session (a cookie, or a kept token) from an earlier visit. */
function setup(
  options: {
    signedIn?: boolean;
    environment?: Environment;
    shared?: ReturnType<typeof storage>;
    api?: ReturnType<typeof mockApi>;
  } = {},
) {
  const environment = options.environment ?? "cookie";
  const shared = options.shared ?? storage();
  const api = options.api ?? mockApi(environment);
  const events = { window: new EventTarget(), document: new EventTarget() };
  const calls = { methods: [] as string[], clears: 0 } as Record<string, number | string[]> & {
    methods: string[];
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
    api: () => apiOrigin,
    waitForReceipt: async () => receipt,
    request: (path, requestOptions) => api.request(path, requestOptions),
    clearCache: () => {
      calls.clears++;
    },
  };
  if (options.signedIn) {
    rememberWallet(shared, "io.metamask", owner);
    const token = newToken();
    api.server.sessions.set(token, { owner, expiresAtMs: serverNow() + 30 * day });
    if (environment === "cookie") api.server.cookies.set(owner, token);
    else storeToken(shared, binding, owner, token, Date.now() + 30 * day);
  }
  const controller = createWalletController(deps);
  controllers.push(controller);
  const change = (key: string | null) => {
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: key });
    events.window.dispatchEvent(event);
  };
  const count = (method: string) => calls.methods.filter((m) => m === method).length;
  const requests = (prefix: string) =>
    api.server.calls.filter((c) => c.path.startsWith(prefix)).length;
  return {
    controller,
    events,
    wallet,
    handle,
    sources,
    shared,
    calls,
    deps,
    api,
    server: api.server,
    change,
    count,
    requests,
    receipt,
  };
}

for (const environment of ["cookie", "token"] as const)
  test(`sign once, then reload: the session comes back without a signature (${environment})`, async () => {
    const first = setup({ environment });
    first.controller.start(first.events);
    await tick();
    expect(first.count("eth_accounts") + first.count("eth_requestAccounts")).toBe(0);
    await first.controller.connect();
    const id = await first.controller.authenticate();
    expect(first.calls.signMessage).toBe(1);
    expect(first.controller.getSnapshot()).toMatchObject({
      sessionId: id,
      sessionTransport: environment,
      access: "invite-required",
    });
    // Whether cookies reach the API was checked once and kept.
    expect(knownTransport(first.shared, apiOrigin)).toBe(environment);
    // A bearer token is kept per wallet only when cookies cannot reach the API.
    expect(storedToken(first.shared, binding, owner) !== null).toBe(environment === "token");
    const expiry = first.controller.getSnapshot().sessionExpiresAt ?? 0;
    expect(Math.abs(expiry - Date.now() - 30 * day)).toBeLessThan(60_000);
    first.controller.stop();
    const next = setup({ environment, shared: first.shared, api: first.api });
    next.server.calls.length = 0;
    next.controller.start(next.events);
    await tick();
    expect(next.count("eth_requestAccounts")).toBe(0);
    expect(next.calls.signMessage).toBeUndefined();
    // One read restores (and renews) the session; nothing else is asked of the API.
    expect(next.server.calls.map((c) => c.path)).toEqual([`/v1/auth/session?wallet=${owner}`]);
    const restored = next.controller.getSnapshot();
    expect(restored).toMatchObject({
      account: owner,
      sessionTransport: environment,
      restoring: false,
    });
    expect(await next.controller.authenticate()).toBe(restored.sessionId ?? "");
    expect(next.calls.signMessage).toBeUndefined();
    expect(() => assertRequestSession(restored.sessionId ?? "")).not.toThrow();
  });

for (const environment of ["cookie", "token"] as const)
  test(`switching accounts and back, or locking and unlocking the wallet, asks for no new signature (${environment})`, async () => {
    const f = setup({ environment, signedIn: true });
    f.controller.start(f.events);
    await tick();
    expect(f.controller.getSnapshot()).toMatchObject({
      account: owner,
      sessionTransport: environment,
    });
    // Another account signs in once...
    f.wallet.state.accounts = [other.toLowerCase()];
    f.wallet.emit("accountsChanged", [other]);
    await tick();
    expect(f.controller.getSnapshot()).toMatchObject({ account: other, sessionId: null });
    await f.controller.authenticate();
    expect(f.calls.signMessage).toBe(1);
    // ...and switching back finds the first account's session still there.
    f.wallet.state.accounts = [owner.toLowerCase()];
    f.wallet.emit("accountsChanged", [owner]);
    await tick();
    expect(f.controller.getSnapshot().account).toBe(owner);
    expect(f.controller.getSnapshot().sessionId).not.toBeNull();
    f.wallet.state.accounts = [other.toLowerCase()];
    f.wallet.emit("accountsChanged", [other]);
    await tick();
    expect(f.controller.getSnapshot().sessionId).not.toBeNull();
    // The wallet locks (or stops answering): the tab shows no wallet, nothing is signed out.
    f.wallet.emit("accountsChanged", []);
    expect(f.controller.getSnapshot()).toMatchObject({ account: null, sessionId: null });
    f.wallet.emit("disconnect");
    expect(rememberedWallet(f.shared)?.owner).toBe(other);
    expect(f.requests("/v1/auth/logout")).toBe(0);
    f.wallet.emit("accountsChanged", [other]);
    await tick();
    expect(f.controller.getSnapshot()).toMatchObject({
      account: other,
      access: "invite-required",
    });
    expect(f.calls.signMessage).toBe(1);
  });

test("a session lasts 30 days from its last read, by the API's clock however far off this one is", async () => {
  const now = Date.now;
  try {
    // This machine's clock runs 10 days fast.
    Date.now = () => now() + 10 * day;
    const f = setup();
    f.controller.start(f.events);
    await tick();
    await f.controller.connect();
    const id = await f.controller.authenticate();
    const { sessionExpiresAt } = f.controller.getSnapshot();
    expect(Math.round(((sessionExpiresAt ?? 0) - Date.now()) / day)).toBe(30);
    expect(() => assertRequestSession(id)).not.toThrow();
    // Clocks also move back (time sync): that never ends a session.
    Date.now = () => now() - day;
    expect(() => assertRequestSession(id)).not.toThrow();
  } finally {
    Date.now = now;
  }
});

test("an open tab rereads its session daily and at its end, which renews it", async () => {
  const f = setup({ signedIn: true, environment: "token" });
  f.controller.start(f.events);
  await tick();
  const first = f.controller.getSnapshot();
  const reads = () => f.requests("/v1/auth/session");
  expect(reads()).toBe(1);
  // Coming back to the tab before a day passed reads nothing.
  f.events.window.dispatchEvent(new Event("focus"));
  f.events.document.dispatchEvent(new Event("visibilitychange"));
  await tick();
  expect(reads()).toBe(1);
  const now = Date.now;
  try {
    Date.now = () => now() + day + 60_000;
    f.events.window.dispatchEvent(new Event("focus"));
    await tick();
    expect(reads()).toBe(2);
    // The same sign-in, now lasting 30 days from this read; the kept token's expiry follows.
    const renewed = f.controller.getSnapshot();
    expect(renewed.sessionId).toBe(first.sessionId);
    expect(Math.round(((renewed.sessionExpiresAt ?? 0) - Date.now()) / day)).toBe(30);
    const kept = storedToken(f.shared, binding, owner);
    expect(Math.round(((kept?.expiresAt ?? 0) - Date.now()) / day)).toBe(30);
  } finally {
    Date.now = now;
  }
});

for (const environment of ["cookie", "token"] as const)
  test(`a bearer session kept by an earlier release carries over without a signature (${environment})`, async () => {
    const shared = storage();
    const api = mockApi(environment);
    const token = newToken();
    api.server.sessions.set(token, { owner, expiresAtMs: serverNow() + 20 * day });
    rememberWallet(shared, "io.metamask", owner);
    shared.setItem(
      LEGACY_SESSION_KEY,
      JSON.stringify({
        version: 1,
        binding,
        owner,
        token,
        issuedAt: Date.now() - 10 * day,
        expiresAt: Date.now() + 20 * day,
      }),
    );
    const f = setup({ environment, shared, api });
    f.controller.start(f.events);
    await tick();
    await tick();
    expect(f.controller.getSnapshot()).toMatchObject({
      account: owner,
      sessionTransport: environment,
    });
    expect(f.controller.getSnapshot().sessionId).not.toBeNull();
    expect(f.calls.signMessage).toBeUndefined();
    expect(shared.getItem(LEGACY_SESSION_KEY)).toBeNull();
    if (environment === "cookie") expect(f.server.cookies.get(owner)).toBe(token);
    else expect(storedToken(shared, binding, owner)?.token).toBe(token);
  });

test("only an explicit disconnect signs the wallet out, and forgets it", async () => {
  for (const environment of ["cookie", "token"] as const) {
    const f = setup({ environment, signedIn: true });
    f.controller.start(f.events);
    await tick();
    await f.controller.authenticate();
    f.wallet.state.hooks.wallet_revokePermissions = async () => {
      throw new Error("unsupported");
    };
    f.controller.disconnect();
    await tick();
    expect(f.controller.getSnapshot()).toMatchObject({
      account: null,
      sessionId: null,
      access: "disconnected",
    });
    expect(f.server.sessions.size).toBe(0);
    expect(f.server.cookies.size).toBe(0);
    expect(storedToken(f.shared, binding, owner)).toBeNull();
    expect(f.shared.getItem(WALLET_STORAGE_KEY)).toBeNull();
    f.wallet.emit("accountsChanged", [owner]);
    expect(f.controller.getSnapshot().account).toBeNull();
    f.controller.stop();
  }
});

test("a new wallet joins with its invite code in the same signature", async () => {
  const f = setup();
  f.controller.start(f.events);
  await tick();
  await f.controller.connect();
  await f.controller.authenticate("beta-0001");
  expect(f.calls.signMessage).toBe(1);
  // The wallet saw the code it signs for.
  expect(f.wallet.state.signed[0]).toContain("urn:probabl:invite:BETA0001");
  expect(f.controller.getSnapshot()).toMatchObject({
    access: "member",
    member: { referrer: null, suspended: false },
    inviteError: null,
  });
  // A member signing in again signs a plain sign-in (the API drops the code).
  f.controller.disconnect();
  await f.controller.connect();
  await f.controller.authenticate("BETA0002");
  expect(f.wallet.state.signed[1]).not.toContain("invite");
  expect(f.server.codes.has("BETA0002")).toBe(true);
});

test("an unusable code never blocks signing in; another code then joins without a signature", async () => {
  const f = setup();
  f.controller.start(f.events);
  await tick();
  await f.controller.connect();
  await f.controller.authenticate("ZZZZ-ZZZZ");
  expect(f.calls.signMessage).toBe(1);
  expect(f.wallet.state.signed[0]).not.toContain("invite");
  expect(f.controller.getSnapshot()).toMatchObject({
    access: "invite-required",
    inviteError: "This invite code was already used.",
  });
  await expect(f.controller.joinWithInvite("nope!")).rejects.toThrow("not an invite code");
  await f.controller.joinWithInvite("beta 0002");
  expect(f.calls.signMessage).toBe(1);
  expect(f.controller.getSnapshot()).toMatchObject({ access: "member", inviteError: null });
});

test("a challenge naming another code, or forged for another deployment, is never signed", async () => {
  for (const forge of ["invite", "deployment"] as const) {
    const f = setup();
    f.controller.start(f.events);
    await tick();
    await f.controller.connect();
    const request = f.deps.request;
    f.deps.request = async <T>(path: string, options: Options) => {
      const value = await request<T>(path, options);
      if (path !== "/v1/auth/challenge") return value;
      const challenge = value as { challengeId: string; message: string; invite: string | null };
      return (
        forge === "invite"
          ? { ...challenge, invite: "OTHER001" }
          : { ...challenge, message: challenge.message.replace("31337", "1") }
      ) as T;
    };
    await expect(f.controller.authenticate("BETA0001")).rejects.toThrow("deployment");
    expect(f.calls.signMessage).toBeUndefined();
    f.controller.stop();
  }
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
  // A wallet that adds the chain without switching to it is asked to switch once more.
  await g.controller.connect();
  expect(added).toBe(true);
  expect(g.count("wallet_addEthereumChain")).toBe(1);
  expect(g.count("wallet_switchEthereumChain")).toBe(2);
  expect(g.controller.getSnapshot().chainId).toBe(deployment.chainId);
  // A wallet that nests the 4902 code (MetaMask mobile) is recognized too.
  const h = setup();
  h.wallet.state.chainId = 1;
  h.wallet.state.hooks.wallet_switchEthereumChain = async (params) => {
    if (h.count("wallet_addEthereumChain") === 0)
      throw Object.assign(new Error("Internal error"), {
        code: -32603,
        data: { originalError: { code: 4902 } },
      });
    h.wallet.state.chainId = Number((params as [{ chainId: string }])[0].chainId);
    return null;
  };
  h.wallet.state.hooks.wallet_addEthereumChain = async (params) => {
    h.wallet.state.chainId = Number((params as [{ chainId: string }])[0].chainId);
    return null;
  };
  h.controller.start(h.events);
  await tick();
  await h.controller.connect();
  expect(h.count("wallet_switchEthereumChain")).toBe(1);
  expect(h.controller.getSnapshot().chainId).toBe(deployment.chainId);
});

test("the wallet's network shows at once, and a declined switch says what to do", async () => {
  const f = setup();
  f.wallet.state.chainId = 1;
  f.wallet.state.hooks.wallet_switchEthereumChain = async () => {
    // The app already knows where the wallet is while the prompt is open.
    expect(f.controller.getSnapshot().chainId).toBe(1);
    throw Object.assign(new Error("User rejected the request."), { code: 4001 });
  };
  f.controller.start(f.events);
  await tick();
  await expect(f.controller.connect()).rejects.toThrow("User rejected");
  expect(f.controller.getSnapshot()).toMatchObject({
    account: owner,
    chainId: 1,
    error: `Switch your wallet to ${deployment.chainName} to continue.`,
  });
});

test("an ended session still restores the wallet, and signing in again takes one signature", async () => {
  const f = setup({ signedIn: true });
  f.server.sessions.clear();
  f.controller.start(f.events);
  await tick();
  expect(f.controller.getSnapshot()).toMatchObject({
    account: owner,
    sessionId: null,
    access: "signed-out",
  });
  expect(f.calls.signMessage).toBeUndefined();
  expect(() => assertRequestSession()).toThrow();
  await f.controller.authenticate();
  expect(f.calls.signMessage).toBe(1);
});

test("a signed-out wallet's actions read its session once, not per action", async () => {
  for (const environment of ["cookie", "token"] as const) {
    const f = setup({ environment, signedIn: true });
    f.server.sessions.clear();
    f.controller.start(f.events);
    await tick();
    for (let i = 0; i < 5; i++) await f.controller.ensureNetwork();
    // One read finds the session gone (and drops a refused kept token); the cookie check ran once.
    expect(f.requests("/v1/auth/session")).toBe(1);
    expect(f.requests("/v1/auth/cookie-check")).toBe(2);
    await f.controller.authenticate();
    expect(f.requests("/v1/auth/session")).toBe(1);
    expect(f.requests("/v1/auth/cookie-check")).toBe(2);
    f.controller.stop();
  }
});

test("StrictMode setup/cleanup/setup issues only one silent reconnect and stopped providers cannot restore", async () => {
  const f = setup({ signedIn: true });
  f.controller.start(f.events);
  f.controller.stop();
  f.controller.start(f.events);
  await tick();
  expect(f.count("eth_accounts")).toBe(1);
  expect(f.requests("/v1/auth/session")).toBe(1);
  f.controller.stop();
  const old = setup({ signedIn: true }),
    wait = deferred<string[]>();
  old.wallet.state.hooks.eth_accounts = async () => wait.promise;
  old.controller.start(old.events);
  await tick();
  old.controller.stop();
  wait.resolve([owner]);
  await tick();
  expect(old.controller.getSnapshot().account).toBeNull();
  expect(() => assertRequestSession()).toThrow();
});

test("a locked wallet never prompts at load; unlocking it brings the session back", async () => {
  const f = setup({ signedIn: true });
  f.wallet.state.accounts = [];
  f.controller.start(f.events);
  await tick();
  expect(f.controller.getSnapshot()).toMatchObject({
    account: null,
    sessionId: null,
    restoring: false,
  });
  expect(f.count("eth_requestAccounts")).toBe(0);
  // Unlocking announces the account: the session returns with no prompt at all.
  f.wallet.state.accounts = [owner];
  f.wallet.emit("accountsChanged", [owner]);
  await tick();
  expect(f.controller.getSnapshot().sessionId).not.toBeNull();
  expect(f.calls.signMessage).toBeUndefined();
  expect(f.count("eth_requestAccounts")).toBe(0);
});

test("a wallet on the wrong chain still has its session; actions ask to switch", async () => {
  const f = setup({ signedIn: true });
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
    error: "Switch your wallet to Anvil to continue.",
  });
  expect(f.controller.getSnapshot().sessionId).not.toBeNull();
  await expect(f.controller.ensureNetwork()).rejects.toThrow("rejected");
  delete f.wallet.state.hooks.wallet_switchEthereumChain;
  await f.controller.ensureNetwork();
  expect(f.controller.getSnapshot().chainId).toBe(deployment.chainId);
  expect(f.calls.signMessage).toBeUndefined();
});

test("an account change cancels in-flight checks and never prompts a chain switch", async () => {
  const f = setup({ signedIn: true });
  f.controller.start(f.events);
  await tick();
  const wait = deferred<string>();
  f.wallet.state.hooks.eth_chainId = async () => wait.promise;
  const network = f.controller.ensureNetwork();
  f.wallet.emit("accountsChanged", [other]);
  expect(f.controller.getSnapshot()).toMatchObject({
    account: other,
    chainId: null,
    sessionId: null,
  });
  wait.resolve(toHex(deployment.chainId));
  await expect(network).rejects.toThrow("changed");
  expect(f.calls.clears).toBeGreaterThan(1);
  expect(f.count("wallet_switchEthereumChain")).toBe(0);
});

test("another tab's sign-in is picked up without signing; late 401s cannot clear a newer session", async () => {
  for (const environment of ["cookie", "token"] as const) {
    const shared = storage();
    const api = mockApi(environment);
    const tab = setup({ environment, shared, api });
    tab.controller.start(tab.events);
    await tick();
    await tab.controller.connect();
    expect(tab.controller.getSnapshot().sessionId).toBeNull();
    // Another tab of this browser signs the wallet in.
    const elsewhere = setup({ environment, shared, api });
    elsewhere.controller.start(elsewhere.events);
    await tick();
    await elsewhere.controller.connect();
    await elsewhere.controller.authenticate();
    tab.change(environment === "cookie" ? SESSION_STORAGE_KEY : TOKEN_STORAGE_KEY);
    await tick();
    const first = tab.controller.getSnapshot().sessionId;
    expect(first).not.toBeNull();
    expect(tab.calls.signMessage).toBeUndefined();
    tab.events.window.dispatchEvent(
      new CustomEvent(SESSION_EXPIRED_EVENT, { detail: "0".repeat(32) }),
    );
    expect(tab.controller.getSnapshot().sessionId).toBe(first);
    tab.events.window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: first }));
    expect(tab.controller.getSnapshot()).toMatchObject({ account: owner, sessionId: null });
    tab.shared.removeItem(WALLET_STORAGE_KEY);
    tab.change(WALLET_STORAGE_KEY);
    expect(tab.controller.getSnapshot().account).toBeNull();
    tab.controller.stop();
    elsewhere.controller.stop();
  }
});

test("a refused request for membership reasons rereads the session (e.g. a suspension)", async () => {
  const f = setup({ signedIn: true });
  f.server.members.set(owner, member());
  f.controller.start(f.events);
  await tick();
  expect(f.controller.getSnapshot().access).toBe("member");
  const id = f.controller.getSnapshot().sessionId;
  f.server.members.set(owner, { ...member(), suspended: true });
  f.events.window.dispatchEvent(new Event(MEMBERSHIP_EVENT));
  await tick();
  // The same sign-in, now suspended: reviewed actions keep their session id.
  expect(f.controller.getSnapshot()).toMatchObject({ access: "suspended", sessionId: id });
});

test("disconnect during sign-in prevents a late response from activating a session, and ends it", async () => {
  for (const environment of ["cookie", "token"] as const) {
    const f = setup({ environment });
    f.controller.start(f.events);
    await tick();
    await f.controller.connect();
    const verify = deferred<void>(),
      request = f.deps.request;
    f.deps.request = async <T>(path: string, options: Options) => {
      if (path === "/v1/auth/verify") await verify.promise;
      return request<T>(path, options);
    };
    const authentication = f.controller.authenticate();
    await tick();
    expect(f.calls.signMessage).toBe(1);
    await expect(f.controller.authenticate()).rejects.toThrow("already in progress");
    f.controller.disconnect();
    verify.resolve();
    await expect(authentication).rejects.toThrow("changed");
    expect(f.controller.getSnapshot().sessionId).toBeNull();
    await tick();
    // The session the late response opened was ended, and nothing was kept.
    expect(f.server.sessions.size).toBe(0);
    expect(f.server.cookies.size).toBe(0);
    expect(storedToken(f.shared, binding, owner)).toBeNull();
    f.controller.stop();
  }
});

test("a replaced wallet provider without an account event cannot send authenticated requests", async () => {
  const f = setup({ signedIn: true });
  f.controller.start(f.events);
  await tick();
  const id = f.controller.getSnapshot().sessionId ?? "";
  f.sources.announced[0] = { ...f.handle, provider: mockWallet(f.calls).provider };
  expect(() => assertRequestSession(id)).toThrow();
  await expect(f.controller.sendTransaction(transaction)).rejects.toThrow();
  expect(f.calls.broadcasts).toBeUndefined();
});

test("wallet or session changes before signing, and reverted receipts, never report success", async () => {
  for (const change of ["account", "session"] as const) {
    const f = setup({ signedIn: true });
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
  const f = setup({ signedIn: true });
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

for (const environment of ["cookie", "token"] as const)
  test(`requests carry the session; an ended one is stopped before fetch and a 401 ends only its own sign-in (${environment})`, async () => {
    const f = setup({ environment, signedIn: true }),
      originalFetch = globalThis.fetch;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: f.events.window });
    const sent: RequestInit[] = [];
    const now = Date.now;
    globalThis.fetch = (async (_: string, init: RequestInit) => {
      sent.push(init);
      return Response.json({ error: { message: "Expired on server" } }, { status: 401 });
    }) as unknown as typeof fetch;
    try {
      f.controller.start(f.events);
      await tick();
      const { sessionId, sessionExpiresAt } = f.controller.getSnapshot();
      if (sessionId === null || sessionExpiresAt === null) throw new Error("Expected a session");
      Date.now = () => sessionExpiresAt;
      await expect(
        requestJson("/v1/orders/prepare", { auth: sessionId, body: {} }),
      ).rejects.toThrow("expired");
      expect(sent.length).toBe(0);
      expect(f.controller.getSnapshot().sessionId).toBeNull();
      expect(f.controller.getSnapshot().account).toBe(owner);
      Date.now = now;
      const next = await f.controller.authenticate();
      await expect(requestJson("/v1/orders/prepare", { auth: next, body: {} })).rejects.toThrow(
        "Expired on server",
      );
      // A cookie session sends its cookie, the app's header and its wallet; a token one its token.
      if (environment === "cookie")
        expect(sent[0]).toMatchObject({
          credentials: "include",
          headers: { "x-probabl-client": "web", "x-probabl-wallet": owner },
        });
      else {
        expect(sent[0]?.credentials).toBe("omit");
        const headers = (sent[0]?.headers ?? {}) as Record<string, string>;
        expect(headers.authorization).toMatch(/^Bearer [a-f0-9]{64}$/);
      }
      // The refused session is over (a refused token is no longer kept).
      expect(f.controller.getSnapshot().sessionId).toBeNull();
      if (environment === "token") expect(storedToken(f.shared, binding, owner)).toBeNull();
      // Without a session, a member-only read fails before any request.
      await expect(requestJson(`/positions/${owner}`, { auth: true })).rejects.toThrow("Sign in");
      expect(sent.length).toBe(1);
    } finally {
      Date.now = now;
      globalThis.fetch = originalFetch;
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

test("restoration waits for a late wallet announcement and respects the remembered provider", async () => {
  const f = setup({ signedIn: true });
  f.sources.announced = [];
  f.controller.start(f.events);
  await tick();
  expect(f.count("eth_accounts")).toBe(0);
  expect(f.controller.getSnapshot().restoring).toBe(true);
  f.sources.announced = [f.handle];
  await new Promise<void>((resolve) => setTimeout(resolve, 275));
  expect(f.count("eth_accounts")).toBe(1);
  expect(f.controller.getSnapshot().restoring).toBe(false);
  expect(f.controller.getSnapshot().sessionId).not.toBeNull();
});

test("blocked browser storage still signs in; a token that cannot be kept is said so", async () => {
  for (const environment of ["cookie", "token"] as const) {
    const f = setup({ environment });
    f.deps.storage = () => null;
    f.controller.start(f.events);
    await tick();
    await f.controller.connect();
    const id = await f.controller.authenticate();
    expect(() => assertRequestSession(id)).not.toThrow();
    const warning = f.controller.getSnapshot().persistenceError ?? "";
    // The cookie survives a refresh by itself; a token needs storage.
    expect(warning.includes("cannot survive a refresh")).toBe(environment === "token");
    f.controller.stop();
  }
});
