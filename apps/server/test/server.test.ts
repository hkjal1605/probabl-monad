/** End to end: the API process against anvil and a disposable PostgreSQL cluster. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createDatabase } from "@conditional-stocks/db";
import { localDatabase } from "@conditional-stocks/db/local";
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
const [, alice, bob, carol, faucet, delegate] = accounts.map((a) => a.address) as Address[] as [
  Address,
  Address,
  Address,
  Address,
  Address,
  Address,
];
const key = (index: number) => toHex(accounts[index]!.getHdKey().privateKey!);
let node: Anvil;
let pg: Awaited<ReturnType<typeof localDatabase>>;
let server: ReturnType<typeof Bun.spawn>;
let api: string;
let protocol: Awaited<ReturnType<typeof deployProtocol>>;

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
const settle = async (predicate: () => Promise<boolean>, timeout = 15_000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await predicate().catch(() => false)) return;
    await Bun.sleep(100);
  }
  throw new Error("Condition not reached");
};
async function signIn(index: number) {
  const owner = accounts[index]!.address;
  const { challengeId, message } = await call("/v1/auth/challenge", {
    address: owner,
    origin: ORIGIN,
  });
  const signature = await accounts[index]!.signMessage({ message });
  return (await call("/v1/auth/verify", { address: owner, challengeId, signature }))
    .token as string;
}
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
  [node, pg] = await Promise.all([startAnvil(Number(NOW)), localDatabase()]);
  const db = createDatabase({ connectionString: pg.connectionString });
  await db.initialize();
  await db.close();
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
  await pg?.close();
});

test("serves indexed markets and readiness", async () => {
  const { markets } = await call("/markets");
  expect(markets).toHaveLength(1);
  expect(markets[0].base.token).toBe(protocol.stock);
  expect(markets[0]).toMatchObject({ makerFeeBps: 20, takerFeeBps: 50 });
  expect((await call("/v1/system/readiness?marketId=1")).reason).toBe("ready");
});

test("custody, owner-signed and delegated trading", async () => {
  const { exchange, usdc, stock } = protocol;
  const [aliceToken, bobToken] = [await signIn(1), await signIn(2)];
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
      (await call(`/balances/${bob}?token=${stock}`)).vaultAvailable === (10n * NVDA).toString(),
  );

  // Bob rests a sell (stock-if-YES for quote-if-YES) through an owner-signed transaction.
  // A resting order capped below the market's 20 bps maker fee could never fill.
  await expect(
    call("/v1/orders/prepare", { order: order(bob, 1, 2n * NVDA, { maxFeeBps: 19 }) }),
  ).rejects.toThrow("maker rate");
  const ask = order(bob, 1, 2n * NVDA);
  const planned = await call("/v1/orders/prepare", { order: ask });
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
  const permission = await call(`/v1/trading/permission?owner=${alice}`);
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
  await settle(async () => (await call(`/v1/trading/permission?owner=${alice}`)).active === true);
  // A taker capped below the market's 50 bps taker fee is refused before any transaction.
  await expect(
    call("/v1/orders/prepare", { order: order(alice, 0, NVDA, { tif: 1, maxFeeBps: 49 }) }),
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
  const [trade] = (await call(`/trades?owner=${alice}`)).trades;
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
  const { positions } = await call(`/positions/${alice}`);
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
  const token = await signIn(3);
  expect((await call(`/v1/faucet/status?owner=${carol}`)).claimed).toBe(false);
  const claim = await call("/v1/faucet/claim", {}, token);
  expect(claim.sent.map((s: { symbol: string }) => s.symbol).sort()).toEqual([
    "ETH",
    "NVDA",
    "USDC",
  ]);
  expect((await call(`/v1/faucet/status?owner=${carol}`)).claimed).toBe(true);
  await expect(call("/v1/faucet/claim", {}, token)).rejects.toThrow("409");
}, 60_000);
