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
import { creditOf, serializeState } from "@conditional-stocks/evm-client/ledger";
import { Hono } from "hono";
import {
  type Address,
  createPublicClient,
  custom,
  encodeFunctionData,
  http,
  keccak256,
  stringToBytes,
  zeroHash,
} from "viem";
import {
  type Anvil,
  accounts,
  deployProtocol,
  startAnvil,
  tokenAbi,
} from "../../../packages/evm-client/test/anvil.ts";
import { ChainFollower } from "../src/follower.ts";
import { mayContain } from "../src/rpc.ts";
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
    finalityMs: 200,
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
    // Lists are keyed by the chain-independent public market id.
    const publicId = ((await get("/markets")).markets as { id: string }[])[0]!.id;
    await settle(
      async () =>
        ((await get("/orderbooks?view=levels")).books as Record<string, { orders: unknown[] }>)[
          publicId
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
    // Alice's immediate-or-cancel buy filled completely: closed, not yet final.
    const confirmedOrders = (await get(`/orders?maker=${alice}`)).orders as {
      status: string;
      confirmation: string;
    }[];
    expect(confirmedOrders).toHaveLength(1);
    expect(confirmedOrders[0]).toMatchObject({ status: "filled", confirmation: "confirmed" });

    // Finality: persisted history replaces the confirmed tail; reconciliation holds.
    await node.client.mine({ blocks: 70 });
    await settle(
      async () => (await db.trades(service.domain, { markets: [1], limit: 10 })).length === 1,
    );
    const finalized = (await get("/trades?marketId=1")).trades as { confirmation: string }[];
    expect(finalized.map((t) => t.confirmation)).toEqual(["finalized"]);
    // The stored forms serve exactly what the replica served.
    expect(finalized[0]).toEqual({ ...trades[0]!, confirmation: "finalized" });
    await settle(async () => (await db.closedOrders(service.domain, alice)).length === 1);
    expect((await get(`/orders?maker=${alice}`)).orders).toEqual([
      { ...confirmedOrders[0]!, confirmation: "finalized" },
    ]);
    expect((await db.trades(service.domain, { owner: bob, limit: 10 })).length).toBe(1);
    // History reads are served from memory until a write adds rows to what they cover.
    const reads = db.trades;
    let queries = 0;
    db.trades = (...args) => {
      queries++;
      return reads(...args);
    };
    try {
      for (let i = 0; i < 3; i++) await get("/trades?marketId=1");
      expect(queries).toBe(0);
      await get(`/trades?owner=${bob}`);
      await get(`/trades?owner=${bob}`);
      expect(queries).toBe(1);
    } finally {
      db.trades = reads;
    }
    // The checkpoint is compressed (zstd frame).
    const checkpoint = (await db.checkpoint(service.domain))!;
    expect([...checkpoint.state.subarray(0, 4)]).toEqual([0x28, 0xb5, 0x2f, 0xfd]);
    await settle(async () => (await app.request("/reconciliation")).status === 200);

    // A restart resumes from the checkpoint and the chain, identical to the live replica.
    const restarted = new IndexerService({
      client: node.publicClient,
      exchange,
      quote: usdc,
      deploymentBlock: 1n,
      chainId: 31337,
      db,
      pollMs: 100,
      finalityMs: 200,
    });
    await restarted.start();
    await settle(() => restarted.follower.confirmed.block >= service.follower.confirmed.block);
    const strip = (s: typeof service.follower.confirmed) =>
      serializeState({ ...s, block: 0n, hash: "0x", timestamp: 0n });
    expect(strip(restarted.follower.base)).toBe(strip(service.follower.base));
    await restarted.stop();
  }, 60_000);

  test("addresses markets by a chain-independent id that matches the contract", async () => {
    const { exchange, stock } = protocol;
    const event = tx.eventKey(keccak256(stringToBytes("condition")), 1, 2);
    const key = tx.marketKey(event, tx.underlyingId("US:NVDA"));
    expect(
      await node.publicClient.readContract({
        address: exchange,
        abi: conditionalStocksAbi,
        functionName: "marketKey",
        args: [1],
      }),
    ).toBe(key);
    const id = tx.publicMarketId(key);
    const view = await get(`/markets/nvda-${id}`);
    expect(view).toMatchObject({
      id,
      marketKey: key,
      eventKey: event,
      underlying: "US:NVDA",
      slug: `nvda-${id}`,
      venue: { chainId: 31337, exchange, marketId: "1" },
    });
    for (const ref of [id, key, "1"]) expect((await get(`/markets/${ref}`)).id).toBe(id);
    expect((await app.request("/markets/nvda-0000000000000000")).status).toBe(404);

    // A second venue of the same event and asset shares the id; the open one represents it.
    const { base, ...rest } = await node.publicClient.readContract({
      address: exchange,
      abi: conditionalStocksAbi,
      functionName: "terms",
      args: [1],
    });
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
          open: BigInt(rest.open),
          cutoff: BigInt(rest.cutoff),
          tick: rest.tick,
          step: rest.step,
          maxSteps: BigInt(rest.maxSteps),
          minNotional: rest.minNotional,
          maxOrder: rest.maxOrder,
          maxWallet: rest.maxWallet,
          maxMarket: rest.maxMarket,
        },
        "ipfs://m",
      ),
    );
    expect(base).toBe(stock);
    await settle(
      async () => ((await get("/markets?venues=all")).markets as unknown[]).length === 2,
    );
    const listed = (await get("/markets")).markets as { id: string; venue: { marketId: string } }[];
    expect(listed.map((m) => [m.id, m.venue.marketId])).toEqual([[id, "1"]]);
    expect(((await get(`/markets/${id}`)).venue as { marketId: string }).marketId).toBe("1");
    expect((await get("/markets/2")).id).toBe(id);
  }, 30_000);

  test("polls with one header request and reads logs only for blocks that can contain them", async () => {
    const { exchange, usdc } = protocol;
    const calls: string[] = [];
    const inner = http(node.url)({});
    const follower = new ChainFollower({
      client: createPublicClient({
        transport: custom({
          request: (args) => {
            calls.push(args.method);
            return inner.request(args);
          },
        }),
      }),
      exchange,
      quote: usdc,
      deploymentBlock: 1n,
      domain: "calls",
      pollMs: 60_000,
    });
    await follower.start();
    follower.stop();
    const tick = async () => {
      calls.length = 0;
      await follower.tick();
      return [...calls];
    };
    expect(await tick()).toEqual(["eth_getBlockByNumber"]);
    // A block whose only log comes from another contract (init code `LOG0`): its bloom rules
    // the exchange out.
    const wallet = node.wallet(0);
    const receipt = await wallet.waitForTransactionReceipt({
      hash: await wallet.sendTransaction({
        data: "0x60006000a000",
        account: accounts[0]!,
      } as never),
    });
    const block = await node.publicClient.getBlock({ blockHash: receipt.blockHash });
    expect(mayContain(block.logsBloom, receipt.contractAddress!)).toBe(true);
    expect(mayContain(block.logsBloom, exchange)).toBe(false);
    expect(await tick()).toEqual(["eth_getBlockByNumber"]);
    const before = creditOf(follower.confirmed, alice, usdc);
    await send(1, tx.withdraw(exchange, usdc, 7n, alice));
    expect(await tick()).toEqual(["eth_getBlockByNumber", "eth_getLogs"]);
    expect(creditOf(follower.confirmed, alice, usdc)).toBe(before - 7n);
  }, 30_000);

  test("rebuilds the tip when a reorg removes an applied block", async () => {
    const { exchange, usdc } = protocol;
    const follower = new ChainFollower({
      client: node.publicClient,
      exchange,
      quote: usdc,
      deploymentBlock: 1n,
      domain: "reorg",
      pollMs: 60_000,
    });
    await follower.start();
    follower.stop();
    const before = creditOf(follower.confirmed, alice, usdc);
    const snapshot = await node.client.snapshot();
    await send(1, tx.withdraw(exchange, usdc, 5n, alice));
    await follower.tick();
    expect(creditOf(follower.confirmed, alice, usdc)).toBe(before - 5n);
    await node.client.revert({ id: snapshot });
    await node.client.mine({ blocks: 3 });
    await follower.tick();
    expect(creditOf(follower.confirmed, alice, usdc)).toBe(before);
    expect(follower.confirmed.block).toBe(await node.publicClient.getBlockNumber());
  }, 30_000);

  test("repairs the tip from the finalized range when an endpoint dropped its logs", async () => {
    const { exchange, usdc } = protocol;
    const inner = http(node.url)({});
    const follower = new ChainFollower({
      // Block-hash log queries answer [] (a lagging endpoint); ranged queries are served.
      client: createPublicClient({
        transport: custom({
          request: (args) =>
            args.method === "eth_getLogs" &&
            (args.params as [{ blockHash?: string }])[0].blockHash !== undefined
              ? Promise.resolve([])
              : inner.request(args),
        }),
      }),
      exchange,
      quote: usdc,
      deploymentBlock: 1n,
      domain: "repair",
      pollMs: 60_000,
      finalityMs: 1,
    });
    // Everything before this test is final, so the dropping endpoint only affects what follows.
    await node.client.mine({ blocks: 70 });
    await follower.start();
    follower.stop();
    const before = creditOf(follower.confirmed, alice, usdc);
    await send(1, tx.withdraw(exchange, usdc, 3n, alice));
    await follower.tick();
    expect(creditOf(follower.confirmed, alice, usdc)).toBe(before);
    // The tip moves past the block; once it is final, the ranged re-read restores the event.
    await node.client.mine({ blocks: 10 });
    await follower.tick();
    expect(creditOf(follower.confirmed, alice, usdc)).toBe(before);
    await node.client.mine({ blocks: 63 });
    await follower.tick();
    // The tip was past the finalized block: the re-read differed from what it had applied.
    expect(follower.base.block).toBeLessThan(follower.confirmed.block);
    expect(creditOf(follower.base, alice, usdc)).toBe(before - 3n);
    expect(creditOf(follower.confirmed, alice, usdc)).toBe(before - 3n);
  }, 30_000);
});
