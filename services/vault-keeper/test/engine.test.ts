/** The keeper against a real exchange and Δ-vault on anvil. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as tx from "@conditional-stocks/evm-client";
import { traderOf } from "@conditional-stocks/evm-client/ledger";
import { ChainFollower, TokenReader } from "@conditional-stocks/indexer";
import { Executor, type Reference } from "@conditional-stocks/operator";
import { encodeFunctionData, keccak256, stringToBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  type Anvil,
  accounts,
  deployDeltaVault,
  deployProtocol,
  feedAbi,
  openMarket,
  send,
  startAnvil,
  tokenAbi,
} from "../../../packages/evm-client/test/anvil.ts";
import { settings } from "../src/config.ts";
import { basket, Keeper, orderChanges, vaultOrders } from "../src/engine.ts";
import type { Quote } from "../src/model.ts";
import { initialState } from "../src/state.ts";

const NOW = BigInt(Math.floor(Date.now() / 1000));
const NVDA = 10n ** 18n;
const USDC = 10n ** 6n;
const keeperAccount = privateKeyToAccount(toHex(accounts[3]!.getHdKey().privateKey!));
let node: Anvil;
let protocol: Awaited<ReturnType<typeof deployProtocol>>;
let vault: `0x${string}`;
let feed: `0x${string}`;
let follower: ChainFollower;
let keeper: Keeper;
let reference: Reference;
const admin = accounts[0]!.address;

const setReference = (spot: bigint, probability: bigint) => {
  const now = Date.now();
  reference = {
    spot,
    probability,
    spread: 10_000n,
    observedAt: now,
    spotAt: now,
    probabilityAt: now,
  };
};
async function mint(to: `0x${string}`, quote: bigint, base: bigint) {
  for (const [token, amount] of [
    [protocol.usdc, quote],
    [protocol.stock, base],
  ] as const)
    await send(node, 0, {
      to: token,
      data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [to, amount] }),
    });
}
const state = () => tx.readDeltaVault(node.publicClient, vault);
const synced = async () => {
  // Uncached: viem caches getBlockNumber for seconds.
  const block = await node.publicClient.getBlockNumber({ cacheTime: 0 });
  while (follower.confirmed.block < block) await Bun.sleep(50);
  return follower.confirmed;
};

beforeAll(async () => {
  node = await startAnvil(Number(NOW));
  protocol = await deployProtocol(node);
  await openMarket(node, protocol, NOW);
  ({ vault, feed } = await deployDeltaVault(node, protocol, NOW));
  await send(node, 0, tx.deltaVaultGrantRole(vault, "curator", admin));
  await send(node, 0, tx.deltaVaultGrantRole(vault, "guardian", admin));
  await send(node, 0, tx.deltaVaultGrantRole(vault, "keeper", keeperAccount.address));
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
  await mint(admin, 100_000n * USDC, 1000n * NVDA);
  await send(node, 0, tx.approve(protocol.usdc, vault, 100_000n * USDC));
  await send(node, 0, tx.approve(protocol.stock, vault, 1000n * NVDA));
  await send(node, 0, tx.deltaVaultDeposit(vault, 100_000n * USDC, 1000n * NVDA, 0n, admin));
  // A taker with exchange credit.
  await mint(accounts[1]!.address, 1_000_000n * USDC, 10_000n * NVDA);
  for (const [token, amount] of [
    [protocol.usdc, 1_000_000n * USDC],
    [protocol.stock, 10_000n * NVDA],
  ] as const) {
    await send(node, 1, tx.approve(token, protocol.exchange, amount));
    await send(node, 1, tx.deposit(protocol.exchange, token, amount));
  }

  follower = new ChainFollower({
    client: node.publicClient,
    exchange: protocol.exchange,
    quote: protocol.usdc,
    deploymentBlock: 1n,
    domain: "test",
    pollMs: 100,
  });
  await follower.start();
  const config = settings({
    vault,
    markets: [{ market: 1, anchorBps: 300, impactBps: 50, maxGapBps: 800, orderQuote: "5000" }],
    quoteLevels: 2,
    pollMs: 1000,
    ttlSeconds: 300,
  });
  const journal = initialState("test");
  const save = () => {};
  setReference(100n * USDC, 400_000n);
  keeper = new Keeper(
    follower,
    new TokenReader(node.publicClient),
    node.publicClient,
    31337,
    config,
    "http://127.0.0.1",
    journal,
    save,
    new Executor(node.publicClient, keeperAccount, config, journal, save),
    async () => reference,
  );
}, 90_000);

afterAll(() => {
  follower?.stop();
  node?.stop();
});

describe("quoting", () => {
  test("posts both branches around the Δ-model's fair prices, within the vault's limits", async () => {
    await keeper.cycle();
    const s = await synced();
    const orders = vaultOrders(s, vault, 1);
    expect(orders.length).toBe(8);
    // δ₀ = 3%, p = 0.4: Y = $101.80, N = $98.80.
    const fair = [101_800_000n, 98_800_000n];
    for (const o of orders) {
      const price = o.ticks * 10_000n;
      if (o.side === 0) expect(price < fair[o.branch]!).toBe(true);
      else expect(price > fair[o.branch]!).toBe(true);
    }
    const v = await state();
    const e = v.markets[0]!.exposure;
    expect(e.high <= 200n * NVDA && -e.low <= 200n * NVDA).toBe(true);
    expect(e.resting <= 200_000n * USDC).toBe(true);
    expect(e.crossed).toBe(false);
  }, 60_000);

  test("an unchanged market keeps every quote", async () => {
    const before = vaultOrders(await synced(), vault, 1)
      .map((o) => o.key)
      .sort();
    await keeper.cycle();
    const after = vaultOrders(await synced(), vault, 1)
      .map((o) => o.key)
      .sort();
    expect(after).toEqual(before);
  }, 60_000);

  test("fills teach δ̂: after traders buy stock-if-YES, the YES quotes rise", async () => {
    const s = await synced();
    const asks = vaultOrders(s, vault, 1).filter((o) => o.branch === 0 && o.side === 1);
    const best = asks.reduce((a, b) => (a.ticks < b.ticks ? a : b));
    const before = best.ticks;
    // Alice lifts the best YES ask.
    const order = {
      maker: accounts[1]!.address,
      marketId: "1",
      quantity: String(best.remaining),
      limitPriceRawX18: String(best.ticks * 10_000n),
      expiry: String(NOW + 86_400n),
      maxFeeBps: 1000,
      branch: 0,
      side: 0,
      fundingKind: 0,
      tif: 1,
    };
    await send(
      node,
      1,
      tx.placement(
        protocol.exchange,
        order,
        {
          nextSequence: String(s.markets.get(1)!.seq[0]),
          deadline: String(NOW + 3600n),
          minFill: "0",
          sequences: [String(best.seq)],
        } as never,
        10_000n,
      ),
    );
    expect((await state()).markets[0]!.exposure.imbalance).toBe(-best.remaining);
    setReference(100n * USDC, 400_000n);
    await keeper.cycle();
    const next = vaultOrders(await synced(), vault, 1).filter(
      (o) => o.branch === 0 && o.side === 1,
    );
    expect(next.reduce((a, b) => (a.ticks < b.ticks ? a : b)).ticks > before).toBe(true);
  }, 60_000);
});

describe("safety", () => {
  test("oracle disagreement pulls the market's quotes", async () => {
    await send(node, 0, {
      to: feed,
      data: encodeFunctionData({
        abi: feedAbi,
        functionName: "set",
        args: [120n * 10n ** 8n, NOW, BigInt(Math.floor(Date.now() / 1000))],
      }),
    });
    setReference(100n * USDC, 400_000n);
    await keeper.cycle();
    expect(vaultOrders(await synced(), vault, 1).length).toBe(0);
    await send(node, 0, {
      to: feed,
      data: encodeFunctionData({
        abi: feedAbi,
        functionName: "set",
        args: [100n * 10n ** 8n, NOW, BigInt(Math.floor(Date.now() / 1000))],
      }),
    });
    await keeper.cycle();
    expect(vaultOrders(await synced(), vault, 1).length > 0).toBe(true);
  }, 60_000);

  test("a foreign book implying another probability pulls the quotes", async () => {
    const rest = async (branch: number, side: number, price: bigint) => {
      const s = await synced();
      await send(
        node,
        1,
        tx.placement(
          protocol.exchange,
          {
            maker: accounts[1]!.address,
            marketId: "1",
            quantity: String(NVDA),
            limitPriceRawX18: String(price),
            expiry: String(NOW + 86_400n),
            maxFeeBps: 1000,
            branch,
            side,
            fundingKind: 0,
            tif: 0,
          },
          {
            nextSequence: String(s.markets.get(1)!.seq[branch]),
            deadline: String(NOW + 3600n),
            minFill: "0",
            sequences: [],
          } as never,
          10_000n,
        ),
      );
    };
    // YES around $100.50 and NO around $95.50 imply p = 0.9 against the 0.4 reference.
    await rest(0, 0, 100_400_000n);
    await rest(0, 1, 100_600_000n);
    await rest(1, 0, 95_400_000n);
    await rest(1, 1, 95_600_000n);
    await synced();
    setReference(100n * USDC, 400_000n);
    await keeper.cycle();
    expect(vaultOrders(await synced(), vault, 1).length).toBe(0);
    const alice = [...(await synced()).orders.values()]
      .filter((o) => o.owner === accounts[1]!.address && o.status === "open")
      .map((o) => o.key);
    await send(node, 1, tx.cancelMany(protocol.exchange, alice));
    await synced();
    setReference(100n * USDC, 400_000n);
    await keeper.cycle();
    expect(vaultOrders(await synced(), vault, 1).length > 0).toBe(true);
  }, 60_000);

  test("a guardian pause invalidates quotes; the keeper cleans up and stops", async () => {
    await send(node, 0, tx.deltaVaultPause(vault));
    const s = await synced();
    expect(traderOf(s, vault).epoch).toBe(1n);
    await keeper.cycle();
    expect(vaultOrders(await synced(), vault, 1).length).toBe(0);
    await send(node, 0, tx.deltaVaultUnpause(vault));
    await keeper.cycle();
    const orders = vaultOrders(await synced(), vault, 1);
    expect(orders.length > 0 && orders.every((o) => o.epoch === 1n)).toBe(true);
  }, 60_000);

  test("a trading loss past the drawdown limit latches a vault-wide halt", async () => {
    const v = await state();
    const richer = basket({ ...v.holdings, quote: (v.holdings.quote * 11n) / 10n }, v.totalSupply);
    keeper.state.checkpoint = { at: Date.now(), basket: richer };
    expect(keeper.drawdown(v, new Map([[1, reference]]))).toBe(true);
    expect(keeper.state.halted).toBe(true);
    await keeper.cycle();
    expect(vaultOrders(await synced(), vault).length).toBe(0);
    keeper.state.halted = false;
    delete keeper.state.checkpoint;
  }, 60_000);

  test("resolved markets are settled into plain credit", async () => {
    await send(node, 0, tx.lifecycle(protocol.exchange, 1, 1, keccak256(stringToBytes("ended"))));
    const evidence = keccak256(stringToBytes("evidence"));
    const uri = "https://evidence.example/packet";
    const commitment = await node.publicClient.readContract({
      address: protocol.exchange,
      abi: tx.conditionalStocksAbi,
      functionName: "resolutionHash",
      args: [1, 1, 0, evidence, uri],
    });
    await send(node, 0, tx.lifecycle(protocol.exchange, 1, 3, commitment));
    await send(node, 0, tx.resolve(protocol.exchange, 1, 1, 0, evidence, uri));
    await synced();
    await keeper.cycle();
    const v = await state();
    expect(v.markets.length).toBe(0);
    expect(v.holdings.markets.length).toBe(0);
  }, 60_000);
});

describe("order changes", () => {
  const order = (over: Partial<tx.OrderWire> & Record<string, unknown>) =>
    ({
      key: "1",
      branch: 0,
      side: 0,
      fundingKind: 0,
      tif: 0,
      delegate: null,
      epoch: 0n,
      maxFeeBps: 0,
      expiry: 10_000n,
      remaining: NVDA,
      ticks: 9900n,
      ...over,
    }) as never;
  const target = (over: Partial<Quote> = {}): Quote => ({
    branch: 0,
    side: 0,
    level: 0,
    price: 99_000_000n,
    quantity: NVDA,
    funding: 0,
    ...over,
  });
  const live = { epoch: 0n, maxFeeBps: 0, tick: 10_000n };
  const s = { pollMs: 1000, repriceBps: 15 };

  test("keeps matching quotes and replaces stale, repriced, resized or foreign-fee ones", () => {
    expect(orderChanges([order({})], [target()], 100n, s, live)).toEqual({
      cancels: [],
      places: [],
    });
    const replace = (o: Record<string, unknown>, q = target()) =>
      orderChanges([order(o)], [q], 100n, s, live);
    expect(replace({ ticks: 9800n }).cancels).toEqual([1n]);
    expect(replace({ expiry: 101n }).cancels).toEqual([1n]);
    expect(replace({ epoch: 1n }).cancels).toEqual([1n]);
    expect(replace({ fundingKind: 1 }).cancels).toEqual([1n]);
    expect(replace({ remaining: 2n * NVDA }).cancels).toEqual([1n]);
    expect(replace({ remaining: NVDA / 2n }).cancels).toEqual([1n]);
    const extra = orderChanges(
      [order({}), order({ key: "2", ticks: 9800n })],
      [target()],
      100n,
      s,
      live,
    );
    expect(extra).toEqual({ cancels: [2n], places: [] });
    expect(orderChanges([], [target()], 100n, s, live).places.length).toBe(1);
  });
});
