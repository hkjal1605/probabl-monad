import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDatabase, type Database } from "@conditional-stocks/db";
import { localDatabase } from "@conditional-stocks/db/local";
import * as tx from "@conditional-stocks/evm-client";
import {
  conditionalStocksAbi,
  packMakers,
  packOrder,
  packPlan,
} from "@conditional-stocks/evm-client";
import { serializeState } from "@conditional-stocks/evm-client/ledger";
import { Hono } from "hono";
import { type Address, encodeFunctionData, keccak256, stringToBytes, zeroHash } from "viem";
import {
  type Anvil,
  accounts,
  deployProtocol,
  startAnvil,
  tokenAbi,
} from "../../../packages/evm-client/test/anvil.ts";
import { IndexerService } from "../src/service.ts";

const T0 = 1_800_000_000n;
const TICK = 10_000n;
const NVDA = 10n ** 18n;
let node: Anvil;
let protocol: Awaited<ReturnType<typeof deployProtocol>>;
let pg: Awaited<ReturnType<typeof localDatabase>>;
let db: Database;
let service: IndexerService;
const app = new Hono();
const [, alice, bob] = accounts.map((a) => a.address) as [Address, Address, Address];

async function send(index: number, envelope: tx.Envelope) {
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
const get = async (path: string) =>
  (await app.request(path)).json() as Promise<Record<string, unknown>>;
const settle = async (predicate: () => boolean | Promise<boolean>, timeout = 15_000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await predicate()) return;
    await Bun.sleep(100);
  }
  throw new Error("Condition not reached");
};

beforeAll(async () => {
  [node, pg] = await Promise.all([startAnvil(), localDatabase()]);
  db = createDatabase({ connectionString: pg.connectionString });
  await db.initialize();
  protocol = await deployProtocol(node);
  const { exchange, usdc, stock } = protocol;
  await send(0, tx.listPool(exchange, stock));
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
        open: T0 - 10n,
        cutoff: T0 + 30n * 86_400n,
        tick: TICK,
        step: 10n ** 15n,
        maxSteps: 1_000_000n,
        minNotional: 1_000_000n,
        maxOrder: 10n ** 11n,
        maxWallet: 10n ** 12n,
        maxMarket: 10n ** 13n,
      },
      "ipfs://m",
    ),
  );
  await send(0, tx.lifecycle(exchange, 1, 0, zeroHash));
  for (const [index, user] of [
    [1, alice],
    [2, bob],
  ] as const)
    for (const [token, amount] of [
      [usdc, 10n ** 12n],
      [stock, 1_000n * NVDA],
    ] as const) {
      await send(0, {
        to: token,
        data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [user, amount] }),
        value: "0",
      });
      await send(index, tx.approve(token, exchange, amount));
      await send(index, tx.deposit(exchange, token, amount));
    }
  service = new IndexerService({
    client: node.publicClient,
    exchange,
    quote: usdc,
    deploymentBlock: 1n,
    chainId: 31337,
    db,
    pollMs: 100,
    checkpointMs: 0,
  });
  await service.start();
  service.mount(app);
}, 90_000);

afterAll(async () => {
  await service?.stop();
  await db?.close();
  node?.stop();
  await pg?.close();
});

describe("indexer", () => {
  test("serves the confirmed book, positions and trades, then persists them when final", async () => {
    const { exchange, usdc } = protocol;
    await send(2, tx.position(exchange, "split", 1, 1, 10n * NVDA));
    const order = (maker: Address, side: number, funding: number, tif: number, qty: bigint) => ({
      maker,
      marketId: "1",
      quantity: qty.toString(),
      limitPriceRawX18: (20_000n * TICK).toString(),
      expiry: (T0 + 86_400n).toString(),
      maxFeeBps: 0,
      branch: 0,
      side,
      fundingKind: funding,
      tif,
    });
    const place = (
      index: number,
      o: ReturnType<typeof order>,
      seq: bigint,
      makers: bigint[] = [],
    ) =>
      send(index, {
        to: exchange,
        data: encodeFunctionData({
          abi: conditionalStocksAbi,
          functionName: "place",
          args: [packOrder(o, TICK), packPlan(seq, T0 + 3_600n, 0n), packMakers(makers)],
        }),
        value: "0",
      });
    await place(2, order(bob, 1, 1, 0, 3n * NVDA), 0n);
    await settle(
      async () =>
        ((await get("/orderbooks?view=levels")).books as Record<string, { orders: unknown[] }>)[
          "1"
        ]!.orders.length === 1,
    );
    await place(1, order(alice, 0, 0, 1, NVDA), 1n, [0n]);
    await settle(
      async () => ((await get(`/positions/${alice}`)).positions as unknown[]).length === 1,
    );
    const image = await get(`/positions/${alice}`);
    expect((image.positions as { baseYes: string; quoteNo: string }[])[0]).toMatchObject({
      baseYes: NVDA.toString(),
      quoteNo: (200n * 10n ** 6n).toString(),
    });
    expect(
      (image.balances as Record<string, { vaultAvailable: string }>)[usdc]!.vaultAvailable,
    ).toBe((10n ** 12n - 200n * 10n ** 6n).toString());
    const trades = (await get("/trades?marketId=1")).trades as {
      confirmation: string;
      executionPriceRawX18: string;
      taker: string;
    }[];
    expect(trades[0]).toMatchObject({
      confirmation: "confirmed",
      executionPriceRawX18: (20_000n * TICK).toString(),
      taker: alice,
    });
    expect(((await get("/markets")).markets as { state: number }[])[0]!.state).toBe(2);
    const book = (await get("/orderbook/1")).orders as { remaining: string }[];
    expect(book[0]!.remaining).toBe((2n * NVDA).toString());

    // Finality: persisted history replaces the confirmed tail; reconciliation holds.
    await node.client.mine({ blocks: 70 });
    await settle(
      async () => (await db.trades(service.domain, { markets: [1], limit: 10 })).length === 1,
    );
    const finalized = (await get("/trades?marketId=1")).trades as { confirmation: string }[];
    expect(finalized.map((t) => t.confirmation)).toEqual(["finalized"]);
    expect((await db.trades(service.domain, { owner: bob, limit: 10 })).length).toBe(1);
    await settle(async () => (await app.request("/reconciliation")).status === 200);

    // A restart resumes from the checkpoint and persisted events, identical to the live replica.
    const restarted = new IndexerService({
      client: node.publicClient,
      exchange,
      quote: usdc,
      deploymentBlock: 1n,
      chainId: 31337,
      db,
      pollMs: 100,
    });
    await restarted.start();
    await settle(() => restarted.follower.confirmed.block >= service.follower.confirmed.block);
    const strip = (s: typeof service.follower.confirmed) =>
      serializeState({ ...s, block: 0n, hash: "0x", timestamp: 0n });
    expect(strip(restarted.follower.base)).toBe(strip(service.follower.base));
    await restarted.stop();
  }, 60_000);
});
