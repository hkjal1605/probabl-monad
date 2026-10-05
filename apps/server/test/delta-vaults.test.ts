/** Δ-vault routes against the real contracts on anvil, mounted in-process. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as tx from "@conditional-stocks/evm-client";
import { ChainFollower, type IndexerService } from "@conditional-stocks/indexer";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { encodeFunctionData } from "viem";
import {
  type Anvil,
  accounts,
  deployDeltaVault,
  deployProtocol,
  openMarket,
  send,
  startAnvil,
  tokenAbi,
} from "../../../packages/evm-client/test/anvil.ts";
import type { Auth } from "../src/auth/routes.ts";
import { mountDeltaVaults } from "../src/delta-vaults/routes.ts";

const NOW = BigInt(Math.floor(Date.now() / 1000));
const NVDA = 10n ** 18n;
const USDC = 10n ** 6n;
let node: Anvil;
let follower: ChainFollower;
let vault: `0x${string}`;
let app: Hono;
const admin = accounts[0]!.address;

const get = async (path: string) => {
  const response = await app.request(path);
  return { status: response.status, body: (await response.json()) as Record<string, any> };
};

beforeAll(async () => {
  node = await startAnvil(Number(NOW));
  const protocol = await deployProtocol(node);
  await openMarket(node, protocol, NOW);
  ({ vault } = await deployDeltaVault(node, protocol, NOW));
  for (const role of ["curator", "keeper"] as const)
    await send(node, 0, tx.deltaVaultGrantRole(vault, role, admin));
  await send(node, 0, tx.deltaVaultSetCaps(vault, 10n ** 13n, 10n ** 24n));
  await send(
    node,
    0,
    tx.deltaVaultSetLimits(vault, { maxTtl: 600, maxOracleAge: 86_400, maxFeeBps: 100 }),
  );
  await send(
    node,
    0,
    tx.deltaVaultAddMarket(vault, 1, {
      bandBps: 1000,
      cutoffBuffer: 3600,
      maxOrder: 50_000n * USDC,
      maxResting: 200_000n * USDC,
      maxImbalance: 200n * NVDA,
    }),
  );
  for (const [token, amount] of [
    [protocol.usdc, 100_000n * USDC],
    [protocol.stock, 1000n * NVDA],
  ] as const) {
    await send(node, 0, {
      to: token,
      data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [admin, amount] }),
    });
    await send(node, 0, tx.approve(token, vault, amount));
  }
  await send(node, 0, tx.deltaVaultDeposit(vault, 100_000n * USDC, 1000n * NVDA, 0n, admin));

  follower = new ChainFollower({
    client: node.publicClient,
    exchange: protocol.exchange,
    quote: protocol.usdc,
    deploymentBlock: 1n,
    domain: "test",
    pollMs: 100,
  });
  await follower.start();
  const indexer = {
    trading: () => follower.confirmed,
    tokens: { identity: new Map([[protocol.usdc, { symbol: "USDC", name: "USD Coin" }]]) },
    view: (_: unknown, m: { id: number }) => ({ id: `venue-${m.id}` }),
  } as unknown as IndexerService;
  app = new Hono();
  app.onError(
    (error) =>
      new Response(JSON.stringify({ error: { message: error.message } }), {
        status: error instanceof HTTPException ? error.status : 400,
        headers: { "content-type": "application/json" },
      }),
  );
  mountDeltaVaults(app, {
    client: node.publicClient,
    indexer,
    vaults: [vault],
    probability: async () => 400_000n,
    // A member gate that admits the wallet asked for, recording each check.
    auth: {
      member: async (_: unknown, owner?: string | null) => {
        gated.push(owner ?? null);
        return { owner: owner ?? admin };
      },
    } as unknown as Auth,
  });
}, 90_000);

const gated: (string | null)[] = [];

afterAll(() => {
  follower?.stop();
  node?.stop();
});

test("lists vaults with holdings, limits and a display-only value estimate", async () => {
  const { status, body } = await get("/v1/delta-vaults");
  expect(status).toBe(200);
  const [v] = body.vaults;
  expect(v.address).toBe(vault);
  expect(v.symbol).toBe("dvNVDA");
  expect(v.quote).toEqual({ token: expect.any(String), symbol: "USDC", decimals: 6 });
  expect(v.totalSupply).toBe(String(10n ** 22n));
  expect(v.holdings.quote).toBe(String(100_000n * USDC));
  expect(v.holdings.base).toBe(String(1000n * NVDA));
  expect(v.oraclePrice).toBe("100000000");
  // 100,000 USDC + 1,000 NVDA at $100.
  expect(v.value).toBe(String(200_000n * USDC));
  expect(v.valuePerShare).toBe(String((200_000n * USDC * 10n ** 18n) / 10n ** 22n));
  expect(v.markets[0].venueId).toBe(1);
  expect(v.markets[0].market).toEqual({ id: "venue-1" });
  expect(v.markets[0].probability).toBe("400000");
  expect(v.markets[0].risk.bandBps).toBe(1000);
  expect(v.withdrawLimitBps).toBe(10_000);
  expect((await get(`/v1/delta-vaults/${vault}`)).body.address).toBe(vault);
});

test("an unknown vault is a 404, bad input a 400", async () => {
  expect((await get(`/v1/delta-vaults/${admin}`)).status).toBe(404);
  expect((await get("/v1/delta-vaults/not-an-address")).status).toBe(400);
  const empty = await get(`/v1/delta-vaults/${vault}/preview/withdraw?shares=0`);
  expect(empty.status).toBe(400);
  expect(empty.body.error.message).toBe("Enter a valid amount.");
});

test("previews match what the contract would do; accounts show shares and allowances", async () => {
  const deposit = await get(
    `/v1/delta-vaults/${vault}/preview/deposit?quote=10000000000&base=500000000000000000000`,
  );
  expect(deposit.status).toBe(200);
  const s0 = 10n ** 22n,
    shares = ((10_000n * USDC - 1n) * s0) / (100_000n * USDC);
  expect(deposit.body.shares).toBe(String(shares));
  expect(deposit.body.quoteIn).toBe(String((100_000n * USDC * shares + s0 - 1n) / s0));
  expect(deposit.body.returned).toEqual([
    { venueId: 1, yesQuote: "0", noQuote: "0", yesBase: "0", noBase: "0" },
  ]);
  const withdraw = await get(`/v1/delta-vaults/${vault}/preview/withdraw?shares=${10n ** 21n}`);
  expect(withdraw.body.quoteOut).toBe(String(10_000n * USDC));
  expect(withdraw.body.baseOut).toBe(String(100n * NVDA));
  const account = await get(`/v1/delta-vaults/${vault}/accounts/${admin}`);
  // A wallet's account is a member read of that very wallet; previews need a member too.
  expect(gated).toContain(admin);
  expect(gated).toContain(null);
  expect(account.body.shares).toBe(String(10n ** 22n - 1000n));
  expect(account.body.allowance).toEqual({ quote: "0", base: "0" });
  expect(account.body.redeems.quote).toBe(String(100_000n * USDC - 1n));
  const none = await get(`/v1/delta-vaults/${vault}/accounts/${accounts[5]!.address}`);
  expect(none.body.shares).toBe("0");
  expect(none.body.redeems).toBeNull();
});
