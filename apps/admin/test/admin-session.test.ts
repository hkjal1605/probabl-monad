import { afterEach, expect, test } from "bun:test";
import type { EIP1193Provider } from "viem";
import {
  ADMIN_SESSION_MS,
  assertRequestSession,
  browserStorage,
  createAdminSession,
  forget,
  persistAdminSession,
  rememberedWallet,
  rememberWallet,
  SESSION_STORAGE_KEY,
  type SessionStorage,
  savedAdminSession,
  sessionBinding,
  setRequestSession,
  WALLET_STORAGE_KEY,
} from "../src/lib/admin-session";
import { connectWallet, findWallet, type WalletHandle } from "../src/lib/admin-wallet";

const owner = { toBase58: () => "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  secondOwner = { toBase58: () => "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
  token = "a".repeat(64);
const deployment = { chainId: 31337, exchange: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" };
const binding = sessionBinding(deployment, "http://localhost:3002"),
  now = 1_800_000_000_000;
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
const saved = () => createAdminSession(binding, owner.toBase58(), token, now);
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
});

test("refresh reuses the issued token without re-signing or extending the absolute four-hour expiry", () => {
  const s = storage(),
    value = saved();
  expect(value.expiresAt - value.issuedAt).toBe(4 * 60 * 60 * 1000);
  expect(persistAdminSession(s, value)).toBe(true);
  for (const elapsed of [0, 1, 60_000, ADMIN_SESSION_MS - 1]) {
    expect(savedAdminSession(s, binding, owner.toBase58(), now + elapsed)).toEqual(value);
    expect(JSON.parse(s.getItem(SESSION_STORAGE_KEY)!).issuedAt).toBe(now);
  }
  expect(savedAdminSession(s, binding, owner.toBase58(), value.expiresAt)).toBeNull();
  expect(savedAdminSession(s, binding, owner.toBase58(), value.expiresAt + 1)).toBeNull();
  expect(s.getItem(SESSION_STORAGE_KEY)).not.toContain("signature");
  expect(s.getItem(SESSION_STORAGE_KEY)).not.toContain("privateKey");
});

test("saved sessions never cross wallet, site, network, program, or config boundaries", () => {
  const s = storage();
  persistAdminSession(s, saved());
  expect(savedAdminSession(s, binding, secondOwner.toBase58(), now)).toBeNull();
  for (const scope of [
    sessionBinding(deployment, "http://other.test:3002"),
    sessionBinding({ ...deployment, chainId: 8453 }, "http://localhost:3002"),
    sessionBinding({ ...deployment, exchange: secondOwner.toBase58() }, "http://localhost:3002"),
  ])
    expect(savedAdminSession(s, scope, owner.toBase58(), now)).toBeNull();
});

test("invalid, malformed, future-issued, overlong and tampered lifetimes fail closed", () => {
  const s = storage(),
    good = saved();
  for (const changes of [
    { version: 2 },
    { owner: "bad" },
    { token: "not-a-token" },
    { token: "A".repeat(64) },
    { issuedAt: now + 1 },
    { issuedAt: -1 },
    { issuedAt: String(now) },
    { issuedAt: 1.5 },
    { expiresAt: good.expiresAt + 1 },
    { expiresAt: now },
    { expiresAt: -1 },
    { expiresAt: String(good.expiresAt) },
    { expiresAt: 1.5 },
  ]) {
    s.setItem(SESSION_STORAGE_KEY, JSON.stringify({ ...good, ...changes }));
    expect(savedAdminSession(s, binding, owner.toBase58(), now)).toBeNull();
  }
  for (const input of ["null", "[]", "{}", "not json", "false"]) {
    s.setItem(SESSION_STORAGE_KEY, input);
    s.setItem(WALLET_STORAGE_KEY, input);
    expect(savedAdminSession(s, binding, owner.toBase58(), now)).toBeNull();
    expect(rememberedWallet(s)).toBeNull();
  }
  persistAdminSession(s, good);
  for (const at of [NaN, Infinity, -1, now - 1])
    expect(savedAdminSession(s, binding, owner.toBase58(), at)).toBeNull();
});

test("a shorter upstream expiry is respected; an upstream eight-hour session cannot extend UI reuse", () => {
  expect(createAdminSession(binding, owner.toBase58(), token, now, now + 1000).expiresAt).toBe(
    now + 1000,
  );
  expect(
    createAdminSession(binding, owner.toBase58(), token, now, String(now + 1000)).expiresAt,
  ).toBe(now + 1000);
  expect(
    createAdminSession(binding, owner.toBase58(), token, now, now + 2 * ADMIN_SESSION_MS).expiresAt,
  ).toBe(now + ADMIN_SESSION_MS);
  for (const expiry of [null, now, now - 1, "nonsense", "1.5", "1e30", Infinity, NaN])
    expect(() => createAdminSession(binding, owner.toBase58(), token, now, expiry)).toThrow();
  for (const bad of ["", "a".repeat(63), "g".repeat(64), null])
    expect(() => createAdminSession(binding, owner.toBase58(), bad, now)).toThrow();
  for (const at of [NaN, -1, Infinity, Number.MAX_SAFE_INTEGER])
    expect(() => createAdminSession(binding, owner.toBase58(), token, at)).toThrow();
});

test("blocked storage degrades to a memory session without throwing or pretending it persisted", () => {
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
    expect(savedAdminSession(s, binding, owner.toBase58(), now)).toBeNull();
    expect(rememberWallet(s, "io.metamask", owner.toBase58())).toBe(false);
    expect(persistAdminSession(s, saved())).toBe(false);
    expect(() => forget(s, SESSION_STORAGE_KEY)).not.toThrow();
  }
  expect(browserStorage()).toBeNull(); // SSR/test environment has no browser.
});

test("request-time gate rejects expired, replaced and logged-out sessions even without an expiry timer", () => {
  expect(() => assertRequestSession(token, now)).toThrow();
  setRequestSession(saved());
  expect(() => assertRequestSession(token, now + ADMIN_SESSION_MS - 1)).not.toThrow();
  for (const at of [now - 1, now + ADMIN_SESSION_MS, now + ADMIN_SESSION_MS + 1, NaN])
    expect(() => assertRequestSession(token, at)).toThrow();
  expect(() => assertRequestSession("b".repeat(64), now)).toThrow();
  setRequestSession(createAdminSession(binding, owner.toBase58(), "b".repeat(64), now));
  expect(() => assertRequestSession(token, now)).toThrow();
  setRequestSession(null);
  expect(() => assertRequestSession("b".repeat(64), now)).toThrow();
});

const wallet = (accounts: string[] = [owner.toBase58()]) => {
  const calls: string[] = [];
  const provider = {
    request: async ({ method }: { method: string }) => {
      calls.push(method);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return accounts;
      throw new Error("must not sign during restoration");
    },
  } as unknown as EIP1193Provider;
  return { provider, calls };
};
const handle = (kind: string, provider: EIP1193Provider): WalletHandle => ({
  kind,
  name: kind,
  icon: null,
  provider,
});

test("remembered wallet selection never silently switches to a newly announced provider", () => {
  const metamask = handle("io.metamask", wallet().provider),
    coinbase = handle("com.coinbase.wallet", wallet().provider);
  expect(findWallet({ announced: [metamask, coinbase] }, "com.coinbase.wallet")).toBe(coinbase);
  expect(findWallet({ announced: [metamask] }, "com.coinbase.wallet")).toBeNull();
  expect(findWallet({})).toBeNull();
});

test("restoration reads authorized accounts only; manual connection is explicit", async () => {
  const { provider, calls } = wallet();
  expect(String(await connectWallet(handle("io.metamask", provider), true))).toBe(owner.toBase58());
  expect(calls).toEqual(["eth_accounts"]);
  await connectWallet(handle("io.metamask", provider), false);
  expect(calls).toEqual(["eth_accounts", "eth_requestAccounts"]);
  await expect(connectWallet(handle("io.metamask", wallet([]).provider), true)).rejects.toThrow(
    "manually",
  );
});
