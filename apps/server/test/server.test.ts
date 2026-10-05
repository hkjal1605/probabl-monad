/** End to end: the API process against anvil and a disposable PostgreSQL cluster. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createDatabase, type Database } from "@conditional-stocks/db";
import { localDatabase } from "@conditional-stocks/db/local";
import { Pool } from "@conditional-stocks/db/testing";
import * as tx from "@conditional-stocks/evm-client";
import { type Address, encodeFunctionData, keccak256, stringToBytes, toHex, zeroHash } from "viem";
import {
  type Anvil,
  accounts,
  deployProtocol,
  startAnvil,
  tokenAbi,
} from "../../../packages/evm-client/test/anvil.ts";

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
