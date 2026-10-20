/** End to end: the API process against anvil and a disposable PostgreSQL cluster. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createDatabase, type Database } from "@conditional-stocks/db";
import { localDatabase } from "@conditional-stocks/db/local";
import { Pool } from "@conditional-stocks/db/testing";
import * as tx from "@conditional-stocks/evm-client";
import { ChainFollower, TokenReader } from "@conditional-stocks/indexer";
import {
  type Address,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  stringToBytes,
  toHex,
  zeroHash,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  type Anvil,
  accounts,
  deployDeltaVault,
  deployProtocol,
  startAnvil,
  tokenAbi,
} from "../../../packages/evm-client/test/anvil.ts";
import { settings as keeperSettings } from "../../../services/vault-keeper/src/config.ts";
import { Keeper } from "../../../services/vault-keeper/src/engine.ts";
import type { LiveReferences } from "../../../services/vault-keeper/src/live.ts";
import { RfqMaker } from "../../../services/vault-keeper/src/rfq.ts";
import { initialState } from "../../../services/vault-keeper/src/state.ts";
import { Tick } from "../../../services/vault-keeper/src/tick.ts";

const NOW = BigInt(Math.floor(Date.now() / 1000));
const NVDA = 10n ** 18n;
const PRICE = 100_000_000n; // $100 per share: 100e6 quote units per 1e18 base units, x1e18.
const ORIGIN = "http://localhost:3001";
const [admin, alice, bob, carol, faucet, delegate, payout] = accounts.map(
  (a) => a.address,
) as Address[] as [Address, Address, Address, Address, Address, Address, Address];
const key = (index: number) => toHex(accounts[index]!.getHdKey().privateKey!);
let node: Anvil;
let pg: Awaited<ReturnType<typeof localDatabase>>;
let server: ReturnType<typeof Bun.spawn>;
let api: string;
let protocol: Awaited<ReturnType<typeof deployProtocol>>;
let db: Database;
/** Bearer sessions, filled in as each wallet signs in. */
const tokens: Record<string, string> = {};

async function send(index: number, envelope: { to: Address; data: `0x${string}`; value?: string }) {
  const wallet = node.wallet(index);
  const hash = await wallet.sendTransaction({
    to: envelope.to,
    data: envelope.data,
    account: accounts[index]!,
  } as never);
  const receipt = await wallet.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("reverted");
  return receipt;
}
async function call(path: string, body?: unknown, token?: string) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as Record<string, any>;
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(json)}`);
  return json;
}
/** The status and error code of a refused call. */
async function refused(path: string, body?: unknown, token?: string) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as { error?: { code?: string; message?: string } };
  return { status: response.status, code: json.error?.code, message: json.error?.message };
}
const settle = async (predicate: () => Promise<boolean>, timeout = 15_000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await predicate().catch(() => false)) return;
    await Bun.sleep(100);
  }
  throw new Error("Condition not reached");
};
/** Signs in (SIWE) with a bearer session, joining with `invite` when given: one signature. */
async function signIn(index: number, invite?: string) {
  const owner = accounts[index]!.address;
  const { challengeId, message } = await call("/v1/auth/challenge", {
    address: owner,
    origin: ORIGIN,
    ...(invite ? { invite } : {}),
  });
  const signature = await accounts[index]!.signMessage({ message });
  const session = await call("/v1/auth/verify", { address: owner, challengeId, signature });
  tokens[owner] = session.token;
  return session;
}
/** Mines `blocks` so the API's two-block finality covers everything so far. */
const finalize = (blocks = 3) => node.client.mine({ blocks });
const order = (
  maker: Address,
  side: number,
  quantity: bigint,
  extra: Partial<tx.OrderWire> = {},
): tx.OrderWire => ({
  maker,
  marketId: "1",
  quantity: quantity.toString(),
  limitPriceRawX18: PRICE.toString(),
  expiry: (NOW + 86_400n).toString(),
  maxFeeBps: 1000,
  branch: 0,
  side,
  fundingKind: 0,
  tif: 0,
  ...extra,
});

beforeAll(async () => {
  // The chain's clock starts a little ahead so block times never trail the server's clock,
  // which stamps when members join (as on a live chain).
  [node, pg] = await Promise.all([startAnvil(Number(NOW) + 2), localDatabase()]);
  db = createDatabase({ connectionString: pg.connectionString });
  await db.initialize();
  // Launch codes from the admin: no referrer.
  await db.createAdminInvites(["BETA0001", "BETA0002"], {
    maxUses: 1,
    expiresAt: null,
    note: "launch",
  });
  protocol = await deployProtocol(node);
  const { exchange, usdc, stock } = protocol;
  await send(0, tx.listPool(exchange, stock, tx.underlyingId("US:NVDA")));
  await send(
    0,
    tx.createMarket(
      exchange,
      {
        base: stock,
        condition: keccak256(stringToBytes("condition")),
        yesIndex: 1,
        noIndex: 2,
        rulesHash: keccak256(stringToBytes("rules")),
        metadataHash: keccak256(stringToBytes("ipfs://m")),
        open: NOW - 10n,
        cutoff: NOW + 30n * 86_400n,
        tick: 10_000n,
        step: 10n ** 15n,
        maxSteps: 1_000_000n,
        minNotional: 1_000_000n,
        maxOrder: 10n ** 11n,
        maxWallet: 10n ** 12n,
        maxMarket: 10n ** 13n,
        makerBps: 20,
        takerBps: 50,
      },
      "ipfs://m",
    ),
  );
  await send(0, tx.lifecycle(exchange, 1, 0, zeroHash));
  for (const user of [alice, bob, faucet])
    for (const [token, amount] of [
      [usdc, 10n ** 12n],
      [stock, 1_000n * NVDA],
    ] as const)
      await send(0, {
        to: token,
        data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [user, amount] }),
      });

  const port = 40_000 + Math.floor(Math.random() * 10_000);
  api = `http://127.0.0.1:${port}`;
  server = Bun.spawn(["bun", "src/main.ts"], {
    cwd: resolve(import.meta.dir, ".."),
    env: {
      ...process.env,
      CHAIN_ID: "31337",
      RPC_URL: node.url,
      EXCHANGE_ADDRESS: exchange,
      DEPLOYMENT_BLOCK: "1",
      DATABASE_URL: pg.connectionString,
      API_AUTH_ORIGINS: ORIGIN,
      API_PORT: String(port),
      POLL_MS: "100",
      TRADING_DELEGATE_PRIVATE_KEY: key(5),
      TRADING_DELEGATE_ADDRESS: delegate,
      FAUCET_PRIVATE_KEY: key(4),
      REFERRAL_PAYOUT_PRIVATE_KEY: key(6),
      INVITE_CODES_PER_MEMBER: "2",
      FINALITY_DEPTH: "2",
      FINALITY_MS: "200",
      // The test talks plain HTTP: the cookie drops `Secure`/`__Host-` here only.
      SESSION_COOKIE_INSECURE: "1",
      LOG_LEVEL: "error",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  await settle(async () => (await fetch(`${api}/health`)).ok, 30_000);
}, 120_000);

afterAll(async () => {
  server?.kill();
  await server?.exited;
  node?.stop();
  await db?.close();
  await pg?.close();
});

test("serves indexed markets and readiness", async () => {
  const { markets } = await call("/markets");
  expect(markets).toHaveLength(1);
  expect(markets[0].base.token).toBe(protocol.stock);
  expect(markets[0]).toMatchObject({ makerFeeBps: 20, takerFeeBps: 50 });
  expect((await call("/v1/system/readiness?marketId=1")).reason).toBe("ready");
});

test("signing in with an invite joins in one signature; private data needs that member session", async () => {
  // A code that cannot work is refused before the wallet is asked to sign.
  expect(
    (await refused("/v1/auth/challenge", { address: alice, origin: ORIGIN, invite: "beta-0009" }))
      .status,
  ).toBe(400);
  const joined = await signIn(1, "beta-0001");
  expect(joined.member).toMatchObject({ referrer: null, codeQuota: 2, suspended: false });
  expect(joined.wallet).toBe(alice);
  // The wallet's own portfolio needs its session; another wallet's is refused.
  expect((await refused(`/positions/${alice}`)).status).toBe(401);
  expect((await call(`/positions/${alice}`, undefined, tokens[alice])).owner).toBe(alice);
  expect(await refused(`/positions/${bob}`, undefined, tokens[alice])).toMatchObject({
    status: 403,
    code: "wrong-wallet",
  });
  // Signed in without a code: browsing works, private data and trading ask for an invite.
  const carolSession = await signIn(3);
  expect(carolSession.member).toBeNull();
  expect(await refused(`/positions/${carol}`, undefined, tokens[carol])).toMatchObject({
    status: 403,
    code: "invite-required",
  });
  expect(
    await refused("/v1/orders/prepare", { order: order(carol, 0, NVDA) }, tokens[carol]),
  ).toMatchObject({ status: 403, code: "invite-required" });
  expect((await call("/v1/auth/session", undefined, tokens[carol])).member).toBeNull();
  // Redeeming a code after signing in admits the same session.
  const redeemed = await call("/v1/invites/redeem", { code: "BETA 0002" }, tokens[carol]);
  expect(redeemed.member.referrer).toBeNull();
  expect((await call(`/positions/${carol}`, undefined, tokens[carol])).owner).toBe(carol);
  expect((await refused("/v1/invites/redeem", { code: "BETA0002" }, tokens[carol])).status).toBe(
    400,
  );
}, 60_000);

test("members invite others within their quota, and a code makes its owner the referrer", async () => {
  const first = (await call("/v1/me/invites", {}, tokens[alice])).code as string;
  expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  await call("/v1/me/invites", {}, tokens[alice]);
  expect((await refused("/v1/me/invites", {}, tokens[alice])).status).toBe(400);
  const joined = await signIn(2, first.toLowerCase());
  expect(joined.member.referrer).toBe(alice);
  const mine = await call("/v1/me/invites", undefined, tokens[alice]);
  expect(mine).toMatchObject({ quota: 2, created: 2, remaining: 0 });
  const used = mine.codes.find((c: { code: string }) => c.code === first);
  expect(used).toMatchObject({ status: "used", uses: 1 });
  expect(used.members.map((m: { wallet: string }) => m.wallet)).toEqual([bob]);
}, 60_000);

/** A cookie jar: what the browser sends to the API. */
function jar() {
  const cookies = new Map<string, string>();
  const keep = (response: Response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";");
      const [name, value] = pair!.split("=") as [string, string];
      if (attributes.some((a) => a.trim() === "Max-Age=0")) cookies.delete(name);
      else cookies.set(name, value);
    }
    return response;
  };
  const send = async (path: string, init: RequestInit = {}) =>
    keep(
      await fetch(`${api}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(cookies.size
            ? { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") }
            : {}),
          ...(init.headers ?? {}),
        },
      }),
    );
  return { cookies, keep, send };
}
const cookieOf = (wallet: string) => `probabl_session_${wallet.slice(2).toLowerCase()}`;
const app = (wallet: string) => ({
  origin: ORIGIN,
  "x-probabl-client": "web",
  "x-probabl-wallet": wallet,
});
async function signInCookie(browser: ReturnType<typeof jar>, index: number, session: string) {
  const owner = accounts[index]!.address;
  const { challengeId, message } = await call("/v1/auth/challenge", {
    address: owner,
    origin: ORIGIN,
  });
  const signature = await accounts[index]!.signMessage({ message });
  return browser.send("/v1/auth/verify", {
    method: "POST",
    headers: { origin: ORIGIN },
    body: JSON.stringify({ address: owner, challengeId, signature, session }),
  });
}

test("browser sessions are HttpOnly cookies, one per wallet, lasting 30 days", async () => {
  const browser = jar();
  const verified = await signInCookie(browser, 3, "cookie");
  expect(verified.status).toBe(200);
  const body = (await verified.json()) as Record<string, any>;
  expect(body.token).toBeUndefined();
  expect(body.wallet).toBe(carol);
  // The app times the session by the API's clock, whatever its own says.
  expect(Math.abs(body.expiresInMs - 30 * 86_400_000)).toBeLessThan(60_000);
  const [set] = verified.headers.getSetCookie();
  expect(set).toStartWith(`${cookieOf(carol)}=`);
  expect(set).toContain("HttpOnly");
  expect(set).toContain("SameSite=Strict");
  expect(set).toContain(`Max-Age=${30 * 86_400}`);
  expect(await (await browser.send(`/v1/auth/session?wallet=${carol}`)).json()).toMatchObject({
    wallet: carol,
  });
  // A fresh session is not rewritten on every read.
  expect(
    (await browser.send(`/v1/auth/session?wallet=${carol}`)).headers.get("set-cookie"),
  ).toBeNull();
  // A cookie-authenticated change without the app's origin and header is refused.
  const forged = await browser.send("/v1/me/invites", { method: "POST", body: "{}" });
  expect(forged.status).toBe(403);
  expect(((await forged.json()) as { error: { code: string } }).error.code).toBe("origin");
  // Signing in a second wallet keeps the first: switching accounts needs no new signature.
  const both = await signInCookie(browser, 1, "both");
  const second = (await both.json()) as Record<string, any>;
  expect(second.token).toMatch(/^[a-f0-9]{64}$/);
  expect(both.headers.getSetCookie()[0]).toStartWith(`${cookieOf(alice)}=`);
  expect([...browser.cookies.keys()].sort()).toEqual([cookieOf(alice), cookieOf(carol)].sort());
  for (const wallet of [carol, alice])
    expect((await (await browser.send(`/v1/auth/session?wallet=${wallet}`)).json()).wallet).toBe(
      wallet,
    );
  expect((await browser.send(`/positions/${alice}`)).status).toBe(200);
  // A change names its wallet and acts with that wallet's session.
  const created = await browser.send("/v1/me/invites", {
    method: "POST",
    body: "{}",
    headers: app(carol),
  });
  expect(created.status).toBe(200);
  // No session for a wallet the browser never signed in with; none chosen when ambiguous.
  expect((await browser.send(`/v1/me/invites?owner=${bob}`)).status).toBe(401);
  expect((await browser.send("/v1/auth/session")).status).toBe(401);
  // Signing out ends that wallet's session only.
  const out = await browser.send("/v1/auth/logout", {
    method: "POST",
    body: "{}",
    headers: app(carol),
  });
  expect(out.headers.getSetCookie()[0]).toStartWith(`${cookieOf(carol)}=;`);
  expect(out.headers.getSetCookie()[0]).toContain("Max-Age=0");
  expect((await browser.send(`/v1/auth/session?wallet=${carol}`)).status).toBe(401);
  expect((await browser.send(`/v1/auth/session?wallet=${alice}`)).status).toBe(200);
  // With one session left, a request naming no wallet uses it.
  expect((await (await browser.send("/v1/auth/session")).json()).wallet).toBe(alice);
}, 60_000);

test("the app learns whether its cookies reach the API before choosing how to keep sessions", async () => {
  const browser = jar();
  expect((await browser.send("/v1/auth/cookie-check", { method: "POST", body: "{}" })).status).toBe(
    200,
  );
  expect(await (await browser.send("/v1/auth/cookie-check")).json()).toEqual({ cookies: true });
  // The check cleans up after itself; a page whose cookies never arrive learns they do not.
  expect(browser.cookies.size).toBe(0);
  expect(await (await fetch(`${api}/v1/auth/cookie-check`)).json()).toEqual({ cookies: false });
});

test("a bearer session kept by an earlier app release moves into its wallet's cookie", async () => {
  const browser = jar();
  const moved = await browser.send("/v1/auth/session/cookie", {
    method: "POST",
    headers: { origin: ORIGIN, authorization: `Bearer ${tokens[bob]}` },
  });
  expect(moved.status).toBe(200);
  expect(browser.cookies.get(cookieOf(bob))).toBe(tokens[bob]);
  expect((await (await browser.send(`/v1/auth/session?wallet=${bob}`)).json()).wallet).toBe(bob);
  // Only from the app's pages, and only with a live token.
  const elsewhere = await fetch(`${api}/v1/auth/session/cookie`, {
    method: "POST",
    headers: { origin: "https://evil.example", authorization: `Bearer ${tokens[bob]}` },
  });
  expect(elsewhere.status).toBe(403);
  const unknown = await fetch(`${api}/v1/auth/session/cookie`, {
    method: "POST",
    headers: { origin: ORIGIN, authorization: `Bearer ${"cd".repeat(32)}` },
  });
  expect(unknown.status).toBe(401);
}, 60_000);

test("a session in use is renewed for 30 days, up to 90 days after sign-in", async () => {
  const pool = new Pool({ connectionString: pg.connectionString });
  try {
    const { rows } = await pool.query<{ domain: string }>("SELECT domain FROM probabl.deployments");
    const domain = rows[0]!.domain;
    // Sessions made straight in the database, aged as if signed in long ago (never cached).
    const aged = async (token: string, signedInDaysAgo: number, expiresInDays: number) => {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const id = createHash("sha256").update(`challenge:${token}`).digest("hex");
      await db.createChallenge(domain, carol, id, "message");
      await db.consumeChallenge(domain, carol, id, tokenHash, 30);
      await pool.query(
        `UPDATE probabl.sessions SET created_at = now() - make_interval(days => $2::int),
          expires_at = now() + make_interval(days => $3::int) WHERE token_hash = $1`,
        [tokenHash, signedInDaysAgo, expiresInDays],
      );
    };
    const read = (token: string) =>
      fetch(`${api}/v1/auth/session`, { headers: { authorization: `Bearer ${token}` } }).then(
        (r) => r.json() as Promise<{ expiresAtMs: number; expiresInMs: number }>,
      );
    const days = (ms: number) => Math.round(ms / 86_400_000);
    await aged("a1".repeat(32), 25, 5);
    expect(days((await read("a1".repeat(32))).expiresInMs)).toBe(30);
    await aged("a2".repeat(32), 80, 2);
    expect(days((await read("a2".repeat(32))).expiresInMs)).toBe(10);
    // Past the cap a session runs out, and then the wallet signs in again.
    await aged("a3".repeat(32), 89, 1);
    expect(days((await read("a3".repeat(32))).expiresInMs)).toBe(1);
    // A cookie session gets its renewed cookie.
    await aged("a4".repeat(32), 25, 5);
    const renewed = await fetch(`${api}/v1/auth/session?wallet=${carol}`, {
      headers: { cookie: `${cookieOf(carol)}=${"a4".repeat(32)}` },
    });
    expect(renewed.headers.get("set-cookie")).toContain(`${cookieOf(carol)}=${"a4".repeat(32)}`);
    expect(renewed.headers.get("set-cookie")).toMatch(/Max-Age=259[0-9]{4}/);
  } finally {
    await pool.end();
  }
}, 60_000);

test("custody, owner-signed and delegated trading", async () => {
  const { exchange, usdc, stock } = protocol;
  const [aliceToken, bobToken] = [tokens[alice]!, tokens[bob]!];
  // Deposits: approve + deposit envelopes for the authenticated wallet.
  for (const [index, token, asset, amount] of [
    [1, aliceToken, usdc, 10_000n * 10n ** 6n],
    [2, bobToken, stock, 10n * NVDA],
  ] as const) {
    const { transactions } = await call(
      "/v1/vault/deposit/prepare",
      { asset, amount: amount.toString() },
      token,
    );
    expect(transactions).toHaveLength(2);
    for (const envelope of transactions) await send(index, envelope);
  }
  await settle(
    async () =>
      (await call(`/balances/${bob}?token=${stock}`, undefined, bobToken)).vaultAvailable ===
      (10n * NVDA).toString(),
  );

  // Bob rests a sell (stock-if-YES for quote-if-YES) through an owner-signed transaction.
  // A resting order capped below the market's 20 bps maker fee could never fill.
  await expect(
    call("/v1/orders/prepare", { order: order(bob, 1, 2n * NVDA, { maxFeeBps: 19 }) }, bobToken),
  ).rejects.toThrow("maker rate");
  const ask = order(bob, 1, 2n * NVDA);
  const planned = await call("/v1/orders/prepare", { order: ask }, bobToken);
  expect(planned.plan.makers).toHaveLength(0);
  expect(planned.plan).toMatchObject({ makerFeeBps: 20, takerFeeBps: 50 });
  const { transaction } = await call(
    "/v1/orders/transaction",
    { order: ask, plan: planned.plan },
    bobToken,
  );
  await send(2, transaction);
  await settle(async () => (await call("/orderbook/1")).orders.length === 1);

  // Alice grants the service delegate, then buys through it.
  const permission = await call(`/v1/trading/permission?owner=${alice}`, undefined, aliceToken);
  expect(permission).toMatchObject({ available: true, active: false, delegate });
  await send(
    1,
    tx.approveDelegate(exchange, delegate, {
      market: 0,
      expiresAt: NOW + 7n * 86_400n,
      maxOrderQuote: 10n ** 9n,
      totalQuote: 10n ** 10n,
      maxOrderBase: 10n ** 20n,
      totalBase: 10n ** 21n,
      maxFeeBps: 1000,
      permissions: tx.DELEGATE_TRADE | tx.DELEGATE_CANCEL,
    }),
  );
  await settle(
    async () =>
      (await call(`/v1/trading/permission?owner=${alice}`, undefined, aliceToken)).active === true,
  );
  // A taker capped below the market's 50 bps taker fee is refused before any transaction.
  await expect(
    call(
      "/v1/orders/prepare",
      { order: order(alice, 0, NVDA, { tif: 1, maxFeeBps: 49 }) },
      aliceToken,
    ),
  ).rejects.toThrow("taker rate");
  const bid = order(alice, 0, NVDA, { delegate, tif: 1, maxFeeBps: 50 });
  const submitted = await call(
    "/v1/trading/submit",
    { order: bid, clientId: "client-request-1" },
    aliceToken,
  );
  expect(submitted.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
  // Retrying the same client id returns the journaled transaction, never a second one.
  expect(
    (await call("/v1/trading/submit", { order: bid, clientId: "client-request-1" }, aliceToken))
      .transactionHash,
  ).toBe(submitted.transactionHash);
  await settle(async () => (await call(`/trades?marketId=1`)).trades.length === 1);
  const [trade] = (await call(`/trades?owner=${alice}`, undefined, aliceToken)).trades;
  // The market's own rates: alice (taker, buyer) pays 50 bps of the stock she receives, bob
  // (maker, seller) 20 bps of the $100 he receives.
  expect(trade).toMatchObject({
    fillQuantity: NVDA.toString(),
    executionPriceRawX18: PRICE.toString(),
    maker: bob,
    taker: alice,
    buyerFee: ((NVDA * 50n) / 10_000n).toString(),
    sellerFee: ((100n * 10n ** 6n * 20n) / 10_000n).toString(),
  });
  const { positions } = await call(`/positions/${alice}`, undefined, aliceToken);
  expect(positions.length).toBeGreaterThan(0);

  // Bob cancels the remainder.
  const [resting] = (await call("/orderbook/1")).orders;
  const cancelled = await call("/v1/orders/cancel/prepare", { orderHash: resting.id }, bobToken);
  await send(2, cancelled.transaction);
  await settle(async () => (await call("/orderbook/1")).orders.length === 0);
  await expect(
    call("/v1/orders/cancel/prepare", { orderHash: resting.id }, aliceToken),
  ).rejects.toThrow();

  // Withdrawal of available credit only.
  const { transactions } = await call(
    "/v1/vault/withdraw/prepare",
    { asset: usdc, amount: "1000000" },
    aliceToken,
  );
  await send(1, transactions[0]);
}, 90_000);

/** An RFQ maker: a fresh wallet with gas and exchange credit (quotes need no grant: the
 * maker's signature authorizes each fill). */
async function rfqMaker(shares: bigint) {
  const account = privateKeyToAccount(generatePrivateKey());
  await node.client.setBalance({ address: account.address, value: 10n ** 20n });
  const wallet = createWalletClient({
    account,
    chain: { ...foundry, rpcUrls: { default: { http: [node.url] } } },
    transport: http(node.url),
  });
  const { exchange, stock } = protocol;
  await send(0, {
    to: stock,
    data: encodeFunctionData({
      abi: tokenAbi,
      functionName: "mint",
      args: [account.address, shares * NVDA],
    }),
  });
  for (const envelope of [
    tx.approve(stock, exchange, shares * NVDA),
    tx.deposit(exchange, stock, shares * NVDA),
  ])
    await submit(envelope);
  async function submit(envelope: { to: Address; data: `0x${string}` }) {
    const hash = await wallet.sendTransaction({ to: envelope.to, data: envelope.data } as never);
    const receipt = await node.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("maker transaction reverted");
  }
  /** A quote frame for `request`, signed by this maker: `shares` at `price` (raw), credit-funded. */
  async function quote(request: Record<string, any>, price: bigint, shares: bigint, nonce: bigint) {
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 30);
    const terms = tx.packQuoteTerms(
      {
        marketId: request.market.id,
        branch: request.order.branch,
        side: request.quoteSide,
        fundingKind: 0,
        expiry,
        priceRawX18: price,
        quantity: shares * NVDA,
      },
      BigInt(request.market.tick),
    );
    const signature = await account.signTypedData({
      domain: request.signing.domain,
      types: tx.QUOTE_TYPES,
      primaryType: "Quote",
      message: { taker: request.signing.taker, terms, nonce },
    });
    return {
      type: "quote",
      rfqId: request.id,
      price: price.toString(),
      quantity: (shares * NVDA).toString(),
      expiry: expiry.toString(),
      nonce: nonce.toString(),
      signature,
    };
  }
  return { address: account.address, submit, quote };
}
/** A maker bot on the RFQ stream: it answers every request with `answer`'s frames. */
function rfqStream(
  key: string | null,
  answer: (request: Record<string, any>) => Promise<object[]> | object[] = () => [],
) {
  const messages: Record<string, any>[] = [];
  const socket = new WebSocket(`${api.replace("http", "ws")}/v1/rfq/stream`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  } as never);
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    messages.push(message);
    if (message.type === "rfq")
      void Promise.resolve(answer(message)).then((replies) => {
        for (const reply of replies) socket.send(JSON.stringify(reply));
      });
  };
  const closed = new Promise<{ code: number; opened: boolean }>((resolve) => {
    let opened = false;
    socket.onopen = () => {
      opened = true;
    };
    socket.onclose = (event) => resolve({ code: event.code, opened });
  });
  return {
    socket,
    messages,
    closed,
    of: (type: string) => messages.filter((m) => m.type === type),
  };
}

test("RFQ: approved makers quote market orders over the stream; the best of book and quotes fills", async () => {
  const { exchange, usdc } = protocol;
  await signIn(0);
  const adminToken = tokens[admin]!;
  // The taker: a member of its own (no referrer, so referral accounting stays as it was), with
  // USDC credit and a 1-click grant to the delegate.
  const taker = accounts[7]!.address;
  await db.createAdminInvites(["RFQTAKER"], { maxUses: 1, expiresAt: null, note: "rfq" });
  await signIn(7, "RFQTAKER");
  const takerToken = tokens[taker]!;
  await send(0, {
    to: usdc,
    data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [taker, 10n ** 10n] }),
  });
  for (const envelope of [
    tx.approve(usdc, exchange, 10n ** 10n),
    tx.deposit(exchange, usdc, 10n ** 10n),
    tx.approveDelegate(exchange, delegate, {
      market: 0,
      expiresAt: NOW + 7n * 86_400n,
      maxOrderQuote: 10n ** 9n,
      totalQuote: 10n ** 10n,
      maxOrderBase: 10n * NVDA,
      totalBase: 100n * NVDA,
      maxFeeBps: 1000,
      permissions: tx.DELEGATE_TRADE | tx.DELEGATE_CANCEL,
    }),
  ])
    await send(7, envelope);
  await settle(
    async () =>
      (await call(`/v1/trading/permission?owner=${taker}`, undefined, takerToken)).active === true,
  );

  // Only the market admin approves makers; each key is shown once.
  const [maker1, maker2] = [await rfqMaker(20n), await rfqMaker(20n)];
  const [m1, m2] = [maker1.address, maker2.address];
  expect(
    (await refused("/v1/admin/rfq/makers", { label: "Desk", wallet: m1 }, takerToken)).code,
  ).toBe("operator");
  const one = await call("/v1/admin/rfq/makers", { label: "Desk one", wallet: m1 }, adminToken);
  const two = await call("/v1/admin/rfq/makers", { label: "Desk two", wallet: m2 }, adminToken);
  expect(one.apiKey).toMatch(/^pbl_rfq_[A-Za-z0-9_-]{43}$/);
  expect(one.maker).toMatchObject({
    label: "Desk one",
    wallet: m1,
    status: "active",
    connections: 0,
  });
  const listed = await call("/v1/admin/rfq/makers", undefined, adminToken);
  expect(listed.makers.map((m: any) => m.label)).toEqual(["Desk two", "Desk one"]);
  expect(JSON.stringify(listed)).not.toContain(one.apiKey);

  // The stream takes approved keys only.
  for (const key of [null, "pbl_rfq_not-a-key", `pbl_rfq_${"A".repeat(43)}`]) {
    const attempt = rfqStream(key);
    expect((await attempt.closed).opened).toBe(false);
  }
  expect((await call("/v1/rfq/status")).makers).toBe(0);

  // A plain book maker rests 2 NVDA-YES at $101 (its own transaction, matching nothing).
  const book = await rfqMaker(20n);
  const ask = order(book.address, 1, 2n * NVDA, { limitPriceRawX18: "101000000" });
  const restPlan = {
    nextSequence: "0",
    deadline: String(NOW + 3_600n),
    minFill: "0",
    sequences: [],
  };
  await book.submit(tx.placement(exchange, ask, restPlan as never, 10_000n));
  await settle(async () => (await call("/orderbook/1")).orders.length === 1);

  // Desk one first quotes off the tick, then signs 1 share at $100.50; desk two signs 3 shares
  // at $101.50.
  const desk1 = rfqStream(one.apiKey, async (r) => [
    { ...(await maker1.quote(r, 100_500_000n, 1n, 1n)), price: "100505000" },
    await maker1.quote(r, 100_500_000n, 1n, 1n),
  ]);
  const desk2 = rfqStream(two.apiKey, async (r) => [await maker2.quote(r, 101_500_000n, 3n, 1n)]);
  await settle(async () => desk1.of("welcome").length === 1 && desk2.of("welcome").length === 1);
  expect(desk1.of("welcome")[0]).toMatchObject({
    version: 1,
    maker: { label: "Desk one", wallet: m1 },
    quoteWindowMs: 500,
    chainId: 31337,
    exchange,
    signing: {
      domain: { name: "Probabl", version: "1", chainId: 31337, verifyingContract: exchange },
    },
    minQuoteSeconds: 3,
  });
  expect((await call("/v1/rfq/status")).makers).toBe(2);

  // The taker buys 4 at up to $102. The review covers the book (2 shares) and counts the makers.
  const buy = order(taker, 0, 4n * NVDA, {
    delegate,
    tif: 1,
    maxFeeBps: 50,
    limitPriceRawX18: (102n * 1_000_000n).toString(),
  });
  const review = await call("/v1/orders/prepare", { order: buy }, takerToken);
  expect(review.plan.filledQuantity).toBe((2n * NVDA).toString());
  expect(review.rfq).toEqual({ makers: 2 });
  const started = Date.now();
  const submitted = await call(
    "/v1/trading/submit",
    { order: buy, clientId: "rfq-request-1" },
    takerToken,
  );
  const elapsed = Date.now() - started;
  expect(submitted.rfq).toMatchObject({
    quotes: 2,
    awards: [
      { price: "100500000", quantity: NVDA.toString() },
      { price: "101500000", quantity: NVDA.toString() },
    ],
  });

  // Each desk saw the whole order and heard about its quotes.
  const request = desk1.of("rfq")[0]!;
  expect(request).toMatchObject({
    chainId: 31337,
    exchange,
    market: {
      id: "1",
      tick: "10000",
      step: (10n ** 15n).toString(),
      makerFeeBps: 20,
      takerFeeBps: 50,
    },
    order: {
      taker,
      branch: 0,
      side: 0,
      quantity: (4n * NVDA).toString(),
      limitPriceRawX18: "102000000",
      tif: 1,
    },
    quoteSide: 1,
    book: { bestBid: null, bestAsk: "101000000" },
    signing: { primaryType: "Quote", taker },
  });
  expect(request.quoteDeadline - request.sentAt).toBe(500);
  expect(desk1.of("quote.rejected")[0]).toMatchObject({
    reason: "Price must be a positive multiple of the market tick",
  });
  expect(desk1.of("quote.accepted")).toHaveLength(1);
  expect(desk2.of("quote.accepted")).toHaveLength(1);

  // One transaction filled best price first: desk one's $100.50, the book's $101 (2), then desk
  // two's $101.50.
  await settle(
    async () =>
      (await call(`/trades?owner=${taker}`, undefined, takerToken)).trades.filter(
        (t: any) => t.transactionHash === submitted.transactionHash,
      ).length === 3,
  );
  const fills = (await call(`/trades?owner=${taker}`, undefined, takerToken)).trades
    .filter((t: any) => t.transactionHash === submitted.transactionHash)
    .map((t: any) => [t.maker, t.fillQuantity, t.executionPriceRawX18])
    .sort((a: string[], b: string[]) => Number(BigInt(a[2]!) - BigInt(b[2]!)));
  expect(fills).toEqual([
    [m1, NVDA.toString(), "100500000"],
    [book.address, (2n * NVDA).toString(), "101000000"],
    [m2, NVDA.toString(), "101500000"],
  ]);
  for (const desk of [desk1, desk2]) await settle(async () => desk.of("rfq.result").length === 1);
  expect(desk1.of("rfq.result")[0]).toMatchObject({
    outcome: "filled",
    awarded: NVDA.toString(),
    filled: NVDA.toString(),
    transaction: submitted.transactionHash,
  });
  expect(desk2.of("rfq.result")[0]).toMatchObject({ outcome: "filled", filled: NVDA.toString() });
  // Both desks answered, so the request closed before its window, and one transaction settled
  // everything: no order of the makers ever rested, and the book's ask is gone.
  expect(elapsed).toBeLessThan(5_000);
  await settle(async () => (await call("/orderbook/1")).orders.length === 0);
  const quoteFills = (await call(`/trades?owner=${taker}`, undefined, takerToken)).trades.filter(
    (t: any) => t.transactionHash === submitted.transactionHash && t.maker !== book.address,
  );
  expect(quoteFills.map((t: any) => t.makerOrderHash)).toEqual([undefined, undefined]);

  // Revoking a key closes its stream at once and the key no longer connects.
  const revoked = await call(`/v1/admin/rfq/makers/${two.maker.id}/revoke`, {}, adminToken);
  expect(revoked).toEqual({ revoked: true });
  expect((await desk2.closed).code).toBe(4001);
  expect((await rfqStream(two.apiKey).closed).opened).toBe(false);
  const after = await call("/v1/admin/rfq/makers", undefined, adminToken);
  expect(after.makers.find((m: any) => m.id === two.maker.id)).toMatchObject({
    status: "revoked",
    connections: 0,
  });
  expect(after.makers.find((m: any) => m.id === one.maker.id)).toMatchObject({
    status: "active",
    connections: 1,
    quotes: 1,
    rejections: 1,
    awards: 1,
  });
  desk1.socket.close();
  await desk1.closed;
}, 120_000);

test("RFQ: the Δ-vault quotes a member's market order over the stream and fills it from its holdings", async () => {
  const { exchange, usdc, stock } = protocol;
  const adminToken = tokens[admin]!;
  const taker = accounts[7]!.address;
  const takerToken = tokens[taker]!;
  const USDC = 10n ** 6n;
  // A vault of stock and USDC, its keeper a fresh key that never sends a transaction.
  const keeperKey = privateKeyToAccount(generatePrivateKey());
  const { vault } = await deployDeltaVault(node, protocol, BigInt(Math.floor(Date.now() / 1000)));
  for (const envelope of [
    tx.deltaVaultGrantRole(vault, "curator", admin),
    tx.deltaVaultGrantRole(vault, "keeper", keeperKey.address),
    tx.deltaVaultSetCaps(vault, 10n ** 13n, 10n ** 24n),
    tx.deltaVaultSetLimits(vault, { maxTtl: 600, maxOracleAge: 86_400, maxFeeBps: 100 }),
    tx.deltaVaultAddMarket(vault, 1, {
      bandBps: 1000,
      cutoffBuffer: 3600,
      maxOrder: 50_000n * USDC,
      maxResting: 200_000n * USDC,
      maxImbalance: 200n * NVDA,
    }),
  ])
    await send(0, envelope);
  for (const [token, amount] of [
    [usdc, 100_000n * USDC],
    [stock, 1000n * NVDA],
  ] as const) {
    await send(0, {
      to: token,
      data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [admin, amount] }),
    });
    await send(0, tx.approve(token, vault, amount));
  }
  await send(0, tx.deltaVaultDeposit(vault, 100_000n * USDC, 1000n * NVDA, 0n, admin));

  // The market admin approves the vault as an RFQ maker.
  const approved = await call(
    "/v1/admin/rfq/makers",
    { label: "Δ-vault NVDA", wallet: vault },
    adminToken,
  );

  // The keeper: its own replica, one round for the vault view, then the stream with its key.
  const follower = new ChainFollower({
    client: node.client as never,
    exchange,
    quote: usdc,
    deploymentBlock: 1n,
    domain: "keeper",
    pollMs: 100,
  });
  await follower.start();
  const tokenReader = new TokenReader(node.client as never);
  const config = keeperSettings({
    vault,
    markets: [{ market: 1, anchorBps: 300, impactBps: 50, maxGapBps: 800, orderQuote: "20000" }],
    rfq: { enabled: true },
  });
  const now = Date.now();
  const reference = {
    spot: 100n * USDC,
    probability: 400_000n,
    spread: 10_000n,
    observedAt: now,
    spotAt: now,
    probabilityAt: now,
  };
  const journal = initialState(`e2e:${vault}`);
  const keeper = new Keeper(
    follower,
    tokenReader,
    node.client as never,
    31337,
    config,
    config.vaults[0]!,
    { address: vault, exchange, quote: usdc, base: stock },
    journal,
    () => {},
    undefined,
    async () => ({ ...reference, observedAt: Date.now() }),
  );
  keeper.live = {
    reference: () => ({
      ...reference,
      observedAt: Date.now(),
      spotAt: Date.now(),
      probabilityAt: Date.now(),
    }),
    track: () => {},
  } as unknown as LiveReferences;
  await keeper.cycle(
    new Tick({
      origin: api,
      client: node.client as never,
      tokens: tokenReader,
      quote: usdc,
      bases: [stock],
      spotPrices: async () => ({ prices: [] }) as never,
      event: async () => ({}),
    }),
  );
  const maker = new RfqMaker({
    keeper,
    url: `${api.replace("http", "ws")}/v1/rfq/stream`,
    apiKey: approved.apiKey,
    account: keeperKey,
  });
  maker.start();
  await settle(async () => (await call("/v1/rfq/status")).makers === 1);

  // The member buys 3 NVDA-YES at up to $105: only the vault quotes, and its quote fills.
  const buy = order(taker, 0, 3n * NVDA, {
    delegate,
    tif: 1,
    maxFeeBps: 50,
    limitPriceRawX18: (105n * USDC).toString(),
  });
  const before = (await node.client.readContract({
    address: exchange,
    abi: tx.conditionalStocksAbi,
    functionName: "account",
    args: [1, 1, vault],
  })) as { base: bigint };
  const started = Date.now();
  const submitted = await call(
    "/v1/trading/submit",
    { order: buy, clientId: "rfq-vault-1" },
    takerToken,
  );
  const elapsed = Date.now() - started;
  expect(submitted.rfq.quotes).toBe(1);
  expect(submitted.rfq.awards).toHaveLength(1);
  const [award] = submitted.rfq.awards;
  expect(BigInt(award.quantity)).toBe(3n * NVDA);
  // δ₀ 3% at p 0.4: fair YES about $101.80, quoted with the spread inside the $105 limit.
  expect(BigInt(award.price)).toBeGreaterThan(101n * USDC);
  expect(BigInt(award.price)).toBeLessThan(103n * USDC);
  await settle(async () =>
    (await call(`/trades?owner=${taker}`, undefined, takerToken)).trades.some(
      (t: any) => t.transactionHash === submitted.transactionHash && t.maker === vault,
    ),
  );
  const fill = (await call(`/trades?owner=${taker}`, undefined, takerToken)).trades.find(
    (t: any) => t.transactionHash === submitted.transactionHash,
  );
  expect(fill).toMatchObject({
    maker: vault,
    fillQuantity: (3n * NVDA).toString(),
    executionPriceRawX18: award.price,
  });
  // The vault sold YES from its stock credit, so it now holds the NO side of those shares.
  const after = (await node.client.readContract({
    address: exchange,
    abi: tx.conditionalStocksAbi,
    functionName: "account",
    args: [1, 1, vault],
  })) as { base: bigint };
  expect(after.base - before.base).toBe(3n * NVDA);
  // The window closed as soon as the vault answered.
  expect(elapsed).toBeLessThan(5_000);
  maker.stop();
  follower.stop();
  await settle(async () => (await call("/v1/rfq/status")).makers === 0);
}, 120_000);

test("testnet faucet delivers once per wallet", async () => {
  const token = tokens[carol]!;
  // Whether the faucet is open is public; a wallet's claim is its own to read.
  expect((await call("/v1/faucet/status")).available).toBe(true);
  expect((await refused(`/v1/faucet/status?owner=${carol}`)).status).toBe(401);
  expect((await call(`/v1/faucet/status?owner=${carol}`, undefined, token)).claimed).toBe(false);
  const claim = await call("/v1/faucet/claim", {}, token);
  expect(claim.sent.map((s: { symbol: string }) => s.symbol).sort()).toEqual([
    "ETH",
    "NVDA",
    "USDC",
  ]);
  expect((await call(`/v1/faucet/status?owner=${carol}`, undefined, token)).claimed).toBe(true);
  await expect(call("/v1/faucet/claim", {}, token)).rejects.toThrow("409");
}, 60_000);

test("referral rewards accrue from a referee's fees, unlock the Monday after resolution, and are claimed once", async () => {
  const { exchange, usdc } = protocol;
  // bob (alice's referee) made the market's only fill: 20 bps of the $100 he received is his
  // maker fee, and alice earns 15% of it in quote-if-YES claims.
  const reward = (((100n * 10n ** 6n * 20n) / 10_000n) * 1_500n) / 10_000n;
  await finalize();
  let dashboard: Record<string, any> = {};
  await settle(async () => {
    dashboard = await call("/v1/me/referrals", undefined, tokens[alice]);
    return dashboard.markets.length === 1;
  }, 30_000);
  expect(dashboard.program).toEqual({ shareBps: 1_500, months: 6 });
  expect(dashboard.referees).toMatchObject([{ wallet: bob, fills: 1 }]);
  expect(dashboard.markets[0]).toMatchObject({
    venueId: "1",
    status: "pending",
    unlockAt: null,
    accrued: [
      {
        branch: 0,
        collateral: 0,
        token: usdc,
        symbol: "USDC",
        decimals: 6,
        amount: reward.toString(),
      },
    ],
  });
  // The market resolves YES: the claims become USDC, claimable from the next Monday.
  const evidence = keccak256(stringToBytes("evidence"));
  const uri = "https://evidence.example/packet";
  await send(0, tx.lifecycle(exchange, 1, 1, keccak256(stringToBytes("ended"))));
  await send(
    0,
    tx.lifecycle(exchange, 1, 3, tx.resolutionHash(31337, exchange, 1, 1, 0, evidence, uri)),
  );
  await send(0, tx.resolve(exchange, 1, 1, 0, evidence, uri));
  await finalize();
  await settle(async () => {
    dashboard = await call("/v1/me/referrals", undefined, tokens[alice]);
    return dashboard.markets[0].status === "unlocking";
  });
  const { unlockAt } = dashboard.markets[0];
  expect(new Date(unlockAt * 1000).getUTCDay()).toBe(1);
  expect(new Date(unlockAt * 1000).toISOString()).toMatch(/T00:00:00.000Z$/);
  expect(dashboard.markets[0].realized).toMatchObject([{ token: usdc, amount: reward.toString() }]);
  expect(dashboard.totals).toMatchObject({
    claimable: [],
    unlocking: [{ token: usdc, amount: reward.toString(), unlockAt }],
  });
  expect(dashboard.nextUnlockAt).toBe(unlockAt);
  expect((await refused("/v1/me/referrals/claim", {}, tokens[alice])).message).toContain(
    "Nothing is claimable",
  );
  // A week later the reward is claimable; the payout wallet pays it in USDC.
  const chainNow = Number((await node.client.getBlock()).timestamp);
  await node.client.increaseTime({ seconds: unlockAt - chainNow + 60 });
  await finalize();
  await settle(async () => {
    dashboard = await call("/v1/me/referrals", undefined, tokens[alice]);
    return dashboard.markets[0].status === "claimable";
  });
  expect(dashboard.totals.claimable).toMatchObject([{ token: usdc, amount: reward.toString() }]);
  await send(0, {
    to: usdc,
    data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [payout, 10n ** 6n] }),
  });
  const balance = () =>
    node.client.readContract({
      address: usdc,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [alice],
    });
  const before = await balance();
  const claimed = await call("/v1/me/referrals/claim", {}, tokens[alice]);
  expect(claimed.payouts).toMatchObject([
    { token: usdc, amount: reward.toString(), status: "paid" },
  ]);
  expect((await balance()) - before).toBe(reward);
  // Paid once: nothing more to claim, and the history shows the payout.
  expect((await refused("/v1/me/referrals/claim", {}, tokens[alice])).message).toContain(
    "Nothing is claimable",
  );
  dashboard = await call("/v1/me/referrals", undefined, tokens[alice]);
  expect(dashboard.totals).toMatchObject({
    claimable: [],
    paid: [{ token: usdc, amount: reward.toString() }],
  });
  expect(dashboard.payouts).toMatchObject([
    {
      token: usdc,
      amount: reward.toString(),
      status: "paid",
      transactionHash: claimed.payouts[0].transactionHash,
    },
  ]);
  // The market admin sees the program's books balance.
  await signIn(0);
  const overview = await call("/v1/admin/referrals", undefined, tokens[admin]);
  expect(overview.payoutWallet).toBe(payout);
  expect(overview.tokens).toMatchObject([
    {
      token: usdc,
      unlocked: reward.toString(),
      paid: reward.toString(),
      owed: "0",
      shortfall: "0",
    },
  ]);
  expect((await refused("/v1/admin/referrals", undefined, tokens[alice])).code).toBe("operator");
}, 120_000);
