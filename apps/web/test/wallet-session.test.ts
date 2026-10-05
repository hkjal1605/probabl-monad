import { afterEach, expect, test } from "bun:test";
import type { EIP1193Provider } from "viem";
import {
  availableWallets,
  connectWallet,
  findWallet,
  type WalletHandle,
} from "../src/lib/wallet/injected";
import {
  announcedSession,
  announceSession,
  assertRequestSession,
  browserStorage,
  createWalletSession,
  forget,
  forgetToken,
  knownTransport,
  LEGACY_SESSION_KEY,
  legacySession,
  parseMember,
  rememberedWallet,
  rememberTransport,
  rememberWallet,
  SESSION_STORAGE_KEY,
  type SessionStorage,
  sessionBinding,
  setRequestSession,
  storedToken,
  storeToken,
  TOKEN_STORAGE_KEY,
  WALLET_SESSION_MS,
  WALLET_STORAGE_KEY,
  walletAccess,
} from "../src/lib/wallet/session";

const owner = { toBase58: () => "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  secondOwner = { toBase58: () => "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" };
const deployment = { chainId: 31337, exchange: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" };
const binding = sessionBinding(deployment, "http://localhost:3001"),
  now = 1_800_000_000_000,
  week = 7 * 24 * 60 * 60 * 1000,
  day = 24 * 60 * 60 * 1000,
  token = "ab".repeat(32);
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      values.set(name, value);
    },
    removeItem: (name: string) => {
      values.delete(name);
    },
  } satisfies SessionStorage;
};
const member = {
  joinedAt: "2026-10-05T10:00:00.000Z",
  referrer: secondOwner.toBase58().toLowerCase(),
  codeQuota: 5,
  suspended: false,
};
/** The API's session view: `GET /v1/auth/session` and a cookie sign-in both return it. */
const response = (changes: Record<string, unknown> = {}) => ({
  wallet: owner.toBase58(),
  expiresAtMs: now + week,
  member: null,
  ...changes,
});
const saved = () => createWalletSession(binding, owner.toBase58(), response(), now);
afterEach(() => setRequestSession(null));

test("wallet preference has no expiry and remembers the selected wallet; explicit disconnect removes it", () => {
  const s = storage();
  expect(rememberedWallet(s)).toBeNull();
  for (const kind of ["io.metamask", "com.coinbase.wallet", "injected"] as const) {
    expect(rememberWallet(s, kind, owner.toBase58())).toBe(true);
    expect(rememberedWallet(s)).toEqual({ version: 1, kind, owner: owner.toBase58() });
  }
  expect(s.getItem(WALLET_STORAGE_KEY)).not.toContain("expires");
  forget(s, WALLET_STORAGE_KEY);
  expect(rememberedWallet(s)).toBeNull();
  expect(() => rememberWallet(s, "io.metamask", "bad-address")).toThrow();
  // Only the checksummed form the controller stores is accepted.
  expect(() => rememberWallet(s, "io.metamask", owner.toBase58().toLowerCase())).toThrow();
});

test("a session is the API's view of this very wallet, with the API's lifetime and membership", () => {
  const value = saved();
  expect(value).toMatchObject({
    version: 2,
    binding,
    owner: owner.toBase58(),
    issuedAt: now,
    expiresAt: now + week,
    member: null,
  });
  // A local, secret-free handle: each sign-in gets its own.
  expect(value.id).toMatch(/^[a-f0-9]{32}$/);
  expect(saved().id).not.toBe(value.id);
  expect(createWalletSession(binding, owner.toBase58(), response({ member }), now).member).toEqual({
    ...member,
    referrer: secondOwner.toBase58(),
  });
  // The wallet's address in any case is the same wallet.
  expect(
    createWalletSession(
      binding,
      owner.toBase58(),
      response({ wallet: owner.toBase58().toLowerCase() }),
      now,
    ).owner,
  ).toBe(owner.toBase58());
});

test("sessions for another wallet, with odd lifetimes or malformed memberships fail closed", () => {
  for (const changes of [
    { wallet: secondOwner.toBase58() },
    { wallet: "bad" },
    { wallet: undefined },
    { expiresAtMs: now },
    { expiresAtMs: now - 1 },
    { expiresAtMs: now + WALLET_SESSION_MS + 1 },
    { expiresAtMs: String(now + week) },
    { expiresAtMs: now + 1.5 },
    { member: { ...member, codeQuota: -1 } },
    { member: { ...member, referrer: "bad" } },
    { member: { ...member, joinedAt: "yesterday" } },
    { member: { ...member, suspended: "no" } },
    { member: [] },
  ])
    expect(() => createWalletSession(binding, owner.toBase58(), response(changes), now)).toThrow();
  for (const bad of [null, "token", 1, []])
    expect(() => createWalletSession(binding, owner.toBase58(), bad, now)).toThrow();
  for (const at of [NaN, -1, Infinity])
    expect(() => createWalletSession(binding, owner.toBase58(), response(), at)).toThrow();
  expect(parseMember(null)).toBeNull();
  expect(parseMember(undefined)).toBeNull();
});

test("sign-in announcements carry no credential and never cross deployments or lifetimes", () => {
  const s = storage(),
    value = saved();
  expect(announceSession(s, value)).toBe(true);
  const raw = s.getItem(SESSION_STORAGE_KEY) ?? "";
  expect(JSON.parse(raw)).toEqual({
    version: 2,
    binding,
    owner: owner.toBase58(),
    id: value.id,
    expiresAt: value.expiresAt,
  });
  expect(raw).not.toContain("token");
  expect(announcedSession(s, binding, now)).toEqual({
    owner: owner.toBase58(),
    id: value.id,
    expiresAt: value.expiresAt,
  });
  for (const scope of [
    sessionBinding(deployment, "http://other.test:3001"),
    sessionBinding({ ...deployment, chainId: 8453 }, "http://localhost:3001"),
    sessionBinding({ ...deployment, exchange: secondOwner.toBase58() }, "http://localhost:3001"),
  ])
    expect(announcedSession(s, scope, now)).toBeNull();
  expect(announcedSession(s, binding, value.expiresAt)).toBeNull();
  for (const input of [
    "null",
    "[]",
    "{}",
    "not json",
    "false",
    JSON.stringify({ ...JSON.parse(raw), id: "x" }),
  ]) {
    s.setItem(SESSION_STORAGE_KEY, input);
    expect(announcedSession(s, binding, now)).toBeNull();
  }
});

test("a session lasts as long as the API says, timed by this clock however far off it is", () => {
  // The API's remaining lifetime wins over its absolute expiry (another clock).
  const skewed = createWalletSession(
    binding,
    owner.toBase58(),
    response({ expiresAtMs: now - 10 * day, expiresInMs: 30 * day }),
    now,
  );
  expect(skewed.expiresAt).toBe(now + 30 * day);
  for (const expiresInMs of [0, -1, 31 * day + 1, 1.5, "1000"])
    expect(() =>
      createWalletSession(binding, owner.toBase58(), response({ expiresInMs }), now),
    ).toThrow();
  // A bearer session (an API on another site) carries its token; a cookie session none.
  const bearer = createWalletSession(binding, owner.toBase58(), response(), now, "token", token);
  expect(bearer).toMatchObject({ transport: "token", token });
  expect(saved()).toMatchObject({ transport: "cookie" });
  expect(saved().token).toBeUndefined();
  for (const bad of [undefined, "short", "AB".repeat(32)])
    expect(() =>
      createWalletSession(binding, owner.toBase58(), response(), now, "token", bad),
    ).toThrow();
});

test("bearer sessions are kept per wallet and deployment, renewed in place, and forgotten one by one", () => {
  const s = storage();
  const other = sessionBinding({ ...deployment, chainId: 8453 }, "http://localhost:3001");
  expect(storeToken(s, binding, owner.toBase58(), token, now + 30 * day, now)).toBe(true);
  expect(storeToken(s, binding, secondOwner.toBase58(), "cd".repeat(32), now + day, now)).toBe(
    true,
  );
  expect(storeToken(s, other, owner.toBase58(), "ef".repeat(32), now + 30 * day, now)).toBe(true);
  expect(storedToken(s, binding, owner.toBase58(), now)).toEqual({
    token,
    expiresAt: now + 30 * day,
  });
  expect(storedToken(s, binding, secondOwner.toBase58(), now)?.token).toBe("cd".repeat(32));
  expect(storedToken(s, other, owner.toBase58(), now)?.token).toBe("ef".repeat(32));
  // Renewal replaces the wallet's entry; expired ones are dropped as they are read.
  storeToken(s, binding, owner.toBase58(), token, now + 40 * day, now + 10 * day);
  expect(storedToken(s, binding, owner.toBase58(), now + 10 * day)?.expiresAt).toBe(now + 40 * day);
  expect(storedToken(s, binding, secondOwner.toBase58(), now + day)).toBeNull();
  forgetToken(s, binding, owner.toBase58(), now);
  expect(storedToken(s, binding, owner.toBase58(), now)).toBeNull();
  expect(storedToken(s, other, owner.toBase58(), now)?.token).toBe("ef".repeat(32));
  expect(() => storeToken(s, binding, "bad", token, now + day, now)).toThrow();
  expect(() => storeToken(s, binding, owner.toBase58(), "bad", now + day, now)).toThrow();
  // Tampered entries are ignored.
  for (const input of [
    "null",
    "[]",
    "{}",
    "not json",
    JSON.stringify({ version: 3, sessions: [{ token }] }),
  ]) {
    s.setItem(TOKEN_STORAGE_KEY, input);
    expect(storedToken(s, other, owner.toBase58(), now)).toBeNull();
  }
  // At most 20 sessions are kept, newest first.
  for (let i = 0; i < 25; i++)
    storeToken(
      s,
      sessionBinding({ ...deployment, chainId: i }, "x"),
      owner.toBase58(),
      token,
      now + day,
      now,
    );
  expect(
    storedToken(s, sessionBinding({ ...deployment, chainId: 24 }, "x"), owner.toBase58(), now),
  ).not.toBeNull();
  expect(
    storedToken(s, sessionBinding({ ...deployment, chainId: 0 }, "x"), owner.toBase58(), now),
  ).toBeNull();
});

test("the one session an earlier release kept is read for this deployment while it lasts", () => {
  const s = storage();
  const legacy = {
    version: 1,
    binding,
    owner: owner.toBase58(),
    token,
    issuedAt: now - day,
    expiresAt: now + 29 * day,
  };
  s.setItem(LEGACY_SESSION_KEY, JSON.stringify(legacy));
  expect(legacySession(s, binding, now)).toEqual({
    owner: owner.toBase58(),
    token,
    expiresAt: now + 29 * day,
  });
  expect(legacySession(s, sessionBinding({ ...deployment, chainId: 1 }, "x"), now)).toBeNull();
  expect(legacySession(s, binding, now + 29 * day)).toBeNull();
  for (const changes of [
    { version: 2 },
    { token: "bad" },
    { owner: "bad" },
    { expiresAt: "soon" },
  ]) {
    s.setItem(LEGACY_SESSION_KEY, JSON.stringify({ ...legacy, ...changes }));
    expect(legacySession(s, binding, now)).toBeNull();
  }
});

test("whether cookies reach an API is kept per API, and can be forgotten", () => {
  const s = storage();
  expect(knownTransport(s, "https://api.example.com")).toBeNull();
  rememberTransport(s, "https://api.example.com", "cookie");
  rememberTransport(s, "https://api-other.example.net", "token");
  expect(knownTransport(s, "https://api.example.com")).toBe("cookie");
  expect(knownTransport(s, "https://api-other.example.net")).toBe("token");
  rememberTransport(s, "https://api.example.com", null);
  expect(knownTransport(s, "https://api.example.com")).toBeNull();
  expect(knownTransport(s, "https://api-other.example.net")).toBe("token");
});

test("blocked storage degrades without throwing or pretending it persisted", () => {
  const denied = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  for (const s of [null, denied]) {
    expect(rememberedWallet(s)).toBeNull();
    expect(announcedSession(s, binding, now)).toBeNull();
    expect(rememberWallet(s, "io.metamask", owner.toBase58())).toBe(false);
    expect(announceSession(s, saved())).toBe(false);
    expect(() => forget(s, SESSION_STORAGE_KEY)).not.toThrow();
    expect(storeToken(s, binding, owner.toBase58(), token, now + day, now)).toBe(false);
    expect(storedToken(s, binding, owner.toBase58(), now)).toBeNull();
    expect(() => forgetToken(s, binding, owner.toBase58(), now)).not.toThrow();
    expect(knownTransport(s, "https://api.example.com")).toBeNull();
  }
  expect(browserStorage()).toBeNull(); // SSR/test environment has no browser.
});

test("request-time gate rejects ended, replaced and logged-out sessions even without a timer", () => {
  const value = saved();
  expect(() => assertRequestSession(value.id, now)).toThrow();
  expect(() => assertRequestSession(undefined, now)).toThrow();
  setRequestSession(value);
  expect(assertRequestSession(value.id, now + week - 1)).toBe(value);
  // Without an id, whichever sign-in is current.
  expect(assertRequestSession(undefined, now)).toBe(value);
  for (const at of [now + week, now + week + 1, NaN])
    expect(() => assertRequestSession(value.id, at)).toThrow();
  // A clock set back (time sync) never ends a session.
  expect(assertRequestSession(value.id, now - day)).toBe(value);
  const next = saved();
  setRequestSession(next);
  // A request reviewed under the earlier sign-in is never sent under the next one.
  expect(() => assertRequestSession(value.id, now)).toThrow();
  setRequestSession(null);
  expect(() => assertRequestSession(next.id, now)).toThrow();
});

test("access follows the wallet, its session and its membership", () => {
  const value = saved();
  expect(walletAccess(null, null)).toBe("disconnected");
  expect(walletAccess(owner.toBase58(), null)).toBe("signed-out");
  expect(walletAccess(owner.toBase58(), value)).toBe("invite-required");
  const joined = { ...value, member: { ...member, referrer: null } };
  expect(walletAccess(owner.toBase58(), joined)).toBe("member");
  expect(
    walletAccess(owner.toBase58(), { ...joined, member: { ...joined.member, suspended: true } }),
  ).toBe("suspended");
});

/** A minimal EIP-1193 provider: account queries only; any signing request fails the test. */
const wallet = (accounts: string[] = [owner.toBase58().toLowerCase()]) => {
  const calls: string[] = [];
  const provider = {
    request: async ({ method }: { method: string }) => {
      calls.push(method);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return accounts;
      throw new Error("must not sign during restoration");
    },
    on() {},
    removeListener() {},
  } as unknown as EIP1193Provider;
  return { provider, calls };
};
const handle = (kind: string, provider: EIP1193Provider): WalletHandle => ({
  kind,
  name: kind,
  icon: null,
  provider,
});

test("remembered wallet selection never silently switches to a newly announced default provider", () => {
  const metamask = handle("io.metamask", wallet().provider),
    coinbase = handle("com.coinbase.wallet", wallet().provider);
  expect(findWallet({ announced: [metamask, coinbase] }, "com.coinbase.wallet")).toBe(coinbase);
  expect(findWallet({ announced: [metamask] }, "com.coinbase.wallet")).toBeNull();
  expect(findWallet({})).toBeNull();
  const legacy = wallet().provider;
  expect(findWallet({ ethereum: legacy })).toEqual({
    kind: "injected",
    name: "Browser wallet",
    icon: null,
    provider: legacy,
  });
});

test("wallet choices include each distinct provider once", () => {
  const metamask = handle("io.metamask", wallet().provider);
  expect(
    availableWallets({ announced: [metamask], ethereum: metamask.provider }).map((w) => w.kind),
  ).toEqual(["io.metamask"]);
  expect(availableWallets({ ethereum: wallet().provider }).map((w) => w.kind)).toEqual([
    "injected",
  ]);
});

test("restoration never prompts: it reads already-authorized accounts only", async () => {
  const { provider, calls } = wallet();
  expect(String(await connectWallet(handle("io.metamask", provider), true))).toBe(owner.toBase58());
  expect(calls).toEqual(["eth_accounts"]);
  await connectWallet(handle("io.metamask", provider), false);
  expect(calls).toEqual(["eth_accounts", "eth_requestAccounts"]);
});

test("locked or revoked wallets and malformed accounts cannot restore a connection", async () => {
  await expect(connectWallet(handle("io.metamask", wallet([]).provider), true)).rejects.toThrow(
    "manually",
  );
  await expect(
    connectWallet(handle("io.metamask", wallet(["bad"]).provider), true),
  ).rejects.toThrow();
  await expect(connectWallet(handle("io.metamask", wallet([]).provider), false)).rejects.toThrow(
    "no account",
  );
});
