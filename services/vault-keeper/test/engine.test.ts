/** The keeper against a real exchange and Δ-vault on anvil. */
import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import * as tx from "@conditional-stocks/evm-client";
import { traderOf } from "@conditional-stocks/evm-client/ledger";
import { ChainFollower, TokenReader } from "@conditional-stocks/indexer";
import { Executor, type Reference } from "@conditional-stocks/operator";
import {
  createPublicClient,
  custom,
  encodeFunctionData,
  keccak256,
  type PublicClient,
  stringToBytes,
  toHex,
  zeroHash,
} from "viem";
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
import { type Settings, settings } from "../src/config.ts";
import { basket, Keeper, keepable, orderChanges, vaultOrders } from "../src/engine.ts";
import type { Quote } from "../src/model.ts";
import { initialState } from "../src/state.ts";
import { Tick } from "../src/tick.ts";

const NOW = BigInt(Math.floor(Date.now() / 1000));
const NVDA = 10n ** 18n;
const USDC = 10n ** 6n;
const keeperAccount = privateKeyToAccount(toHex(accounts[3]!.getHdKey().privateKey!));
let node: Anvil;
let protocol: Awaited<ReturnType<typeof deployProtocol>>;
let vault: `0x${string}`;
let feed: `0x${string}`;
let follower: ChainFollower;
let tokens: TokenReader;
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
/** A round whose references come from `reference` (keepers here read it directly). */
const round = () =>
  new Tick({
    origin: "http://127.0.0.1",
    client: node.publicClient,
    tokens,
    quote: protocol.usdc,
    bases: [protocol.stock],
    spotPrices: async () =>
      ({ source: "robinhood", displayOnly: true, chainId: 31337, asOf: 0, prices: [] }) as never,
    polymarket: async () => ({}),
  });
/** A keeper of `address` signing with `account`, its journal fresh. */
const keeperOf = (
  address: `0x${string}`,
  account: typeof keeperAccount,
  config: Settings,
  client: PublicClient = node.publicClient,
) => {
  const journal = initialState(`test:${address}`);
  const save = () => {};
  return new Keeper(
    follower,
    tokens,
    client,
    31337,
    config,
    config.vaults.find((v) => v.vault === address)!,
    { address, exchange: protocol.exchange, quote: protocol.usdc, base: protocol.stock },
    journal,
    save,
    new Executor(client, account, config, journal, save, {
      receiptPollMs: 50,
      gasHeadroomBps: 2500,
    }),
    async () => reference,
  );
};
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
  tokens = new TokenReader(node.publicClient);
  // The legacy single-vault form: only the listed market is quoted.
  const config = settings({
    vault,
    markets: [{ market: 1, anchorBps: 300, impactBps: 50, maxGapBps: 800, orderQuote: "5000" }],
    quoteLevels: 2,
    pollMs: 1000,
    ttlSeconds: 300,
  });
  setReference(100n * USDC, 400_000n);
  keeper = keeperOf(vault, keeperAccount, config);
}, 90_000);

afterAll(() => {
  follower?.stop();
  node?.stop();
});

describe("quoting", () => {
  test("posts both branches around the Δ-model's fair prices, within the vault's limits", async () => {
    await keeper.cycle(round());
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
    await keeper.cycle(round());
    const after = vaultOrders(await synced(), vault, 1)
      .map((o) => o.key)
      .sort();
    expect(after).toEqual(before);
  }, 60_000);

  test("a move within repriceBps keeps every quote, though it takes steps off the sizes", async () => {
    const before = vaultOrders(await synced(), vault, 1)
      .map((o) => o.key)
      .sort();
    try {
      // Spot up 5 bps: each level's budget buys ~12 steps less stock.
      setReference(100_050_000n, 400_000n);
      await keeper.cycle(round());
    } finally {
      setReference(100n * USDC, 400_000n);
    }
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
    await keeper.cycle(round());
    const next = vaultOrders(await synced(), vault, 1).filter(
      (o) => o.branch === 0 && o.side === 1,
    );
    expect(next.reduce((a, b) => (a.ticks < b.ticks ? a : b)).ticks > before).toBe(true);
  }, 60_000);
});

describe("safety", () => {
  test("oracle disagreement pulls the market's quotes", async () => {
    // Answers are dated a few seconds back: anvil's block time can trail the wall clock, and the
    // vault rejects an answer from the future.
    await send(node, 0, {
      to: feed,
      data: encodeFunctionData({
        abi: feedAbi,
        functionName: "set",
        args: [120n * 10n ** 8n, NOW, BigInt(Math.floor(Date.now() / 1000)) - 5n],
      }),
    });
    setReference(100n * USDC, 400_000n);
    await keeper.cycle(round());
    expect(vaultOrders(await synced(), vault, 1).length).toBe(0);
    await send(node, 0, {
      to: feed,
      data: encodeFunctionData({
        abi: feedAbi,
        functionName: "set",
        args: [100n * 10n ** 8n, NOW, BigInt(Math.floor(Date.now() / 1000)) - 5n],
      }),
    });
    await keeper.cycle(round());
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
    await keeper.cycle(round());
    expect(vaultOrders(await synced(), vault, 1).length).toBe(0);
    const alice = [...(await synced()).orders.values()]
      .filter((o) => o.owner === accounts[1]!.address && o.status === "open")
      .map((o) => o.key);
    await send(node, 1, tx.cancelMany(protocol.exchange, alice));
    await synced();
    setReference(100n * USDC, 400_000n);
    await keeper.cycle(round());
    expect(vaultOrders(await synced(), vault, 1).length > 0).toBe(true);
  }, 60_000);

  test("a guardian pause invalidates quotes; the keeper cleans up and stops", async () => {
    await send(node, 0, tx.deltaVaultPause(vault));
    const s = await synced();
    expect(traderOf(s, vault).epoch).toBe(1n);
    await keeper.cycle(round());
    expect(vaultOrders(await synced(), vault, 1).length).toBe(0);
    await send(node, 0, tx.deltaVaultUnpause(vault));
    await keeper.cycle(round());
    const orders = vaultOrders(await synced(), vault, 1);
    expect(orders.length > 0 && orders.every((o) => o.epoch === 1n)).toBe(true);
  }, 60_000);

  test("a trading loss past the drawdown limit latches a vault-wide halt", async () => {
    const v = await state();
    const richer = basket({ ...v.holdings, quote: (v.holdings.quote * 11n) / 10n }, v.totalSupply);
    keeper.state.checkpoint = { at: Date.now(), basket: richer };
    expect(keeper.drawdown(v, new Map([[1, reference]]))).toBe(true);
    expect(keeper.state.halted).toBe(true);
    await keeper.cycle(round());
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
    await keeper.cycle(round());
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
  const live = { epoch: 0n, maxFeeBps: 0 };

  test("keep the quotes the ladders kept, cancel the rest and place the new ones", () => {
    expect(orderChanges([order({})], [target({ key: 1n })])).toEqual({ cancels: [], places: [] });
    const fresh = target({ level: 1, price: 98_000_000n });
    expect(orderChanges([order({}), order({ key: "2" })], [target({ key: 1n }), fresh])).toEqual({
      cancels: [2n],
      places: [fresh],
    });
    expect(orderChanges([order({})], [target()])).toEqual({ cancels: [1n], places: [target()] });
  });

  test("only the vault's current good-till-expiry quotes may stay", () => {
    const may = (o: Record<string, unknown>) => keepable(order(o), 100n, 1000, live);
    expect(may({})).toBe(true);
    expect(may({ expiry: 101n })).toBe(false);
    expect(may({ epoch: 1n })).toBe(false);
    expect(may({ maxFeeBps: 5 })).toBe(false);
    expect(may({ tif: 1 })).toBe(false);
    expect(may({ delegate: "0x00000000000000000000000000000000000000d1" })).toBe(false);
  });
});

describe("several vaults in one process", () => {
  test("one round quotes every vault at once, each with its own keeper wallet, and quotes a market the curator just added", async () => {
    // A second market on the stock (the first one resolved above).
    await send(
      node,
      0,
      tx.createMarket(
        protocol.exchange,
        {
          base: protocol.stock,
          condition: keccak256(stringToBytes("condition-2")),
          yesIndex: 1,
          noIndex: 2,
          rulesHash: keccak256(stringToBytes("rules")),
          metadataHash: keccak256(stringToBytes("ipfs://m2")),
          open: NOW - 10n,
          cutoff: NOW + 30n * 86_400n,
          tick: 10_000n,
          step: 10n ** 15n,
          maxSteps: 1_000_000n,
          minNotional: 1_000_000n,
          maxOrder: 10n ** 11n,
          maxWallet: 10n ** 12n,
          maxMarket: 10n ** 13n,
          makerBps: 25,
          takerBps: 60,
        },
        "ipfs://m2",
      ),
    );
    await send(node, 0, tx.lifecycle(protocol.exchange, 2, 0, zeroHash));
    const risk = {
      bandBps: 1000,
      cutoffBuffer: 3600,
      maxOrder: 50_000n * USDC,
      maxResting: 200_000n * USDC,
      maxImbalance: 200n * NVDA,
    };
    // The first vault registers it on chain; no configuration names it.
    await send(node, 0, tx.deltaVaultAddMarket(vault, 2, risk));
    // A second vault on the stock with its own keeper wallet, seeded by its admin.
    const second = (await deployDeltaVault(node, protocol, NOW)).vault;
    const secondKeeper = privateKeyToAccount(toHex(accounts[4]!.getHdKey().privateKey!));
    for (const envelope of [
      tx.deltaVaultGrantRole(second, "curator", admin),
      tx.deltaVaultGrantRole(second, "guardian", admin),
      tx.deltaVaultGrantRole(second, "keeper", secondKeeper.address),
      tx.deltaVaultSetCaps(second, 10n ** 13n, 10n ** 24n),
      tx.deltaVaultSetLimits(second, { maxTtl: 600, maxOracleAge: 86_400, maxFeeBps: 100 }),
      tx.deltaVaultAddMarket(second, 2, risk),
    ])
      await send(node, 0, envelope);
    await mint(admin, 100_000n * USDC, 1000n * NVDA);
    await send(node, 0, tx.approve(protocol.usdc, second, 100_000n * USDC));
    await send(node, 0, tx.approve(protocol.stock, second, 1000n * NVDA));
    await send(node, 0, tx.deltaVaultDeposit(second, 100_000n * USDC, 1000n * NVDA, 0n, admin));
    const shared = {
      model: { anchorBps: 300, impactBps: 50, maxGapBps: 800, orderQuote: "5000" },
      quoteLevels: 2,
      pollMs: 1000,
      ttlSeconds: 300,
    };
    const config = settings({
      vaults: [
        { vault, keeper: keeperAccount.address },
        { vault: second, keeper: secondKeeper.address },
      ],
      ...shared,
    });
    await synced();
    setReference(100n * USDC, 400_000n);
    const tick = round();
    await Promise.all([
      keeperOf(vault, keeperAccount, config).cycle(tick),
      keeperOf(second, secondKeeper, config).cycle(tick),
    ]);
    const s = await synced();
    expect(vaultOrders(s, vault, 2).length > 0).toBe(true);
    expect(vaultOrders(s, second, 2).length > 0).toBe(true);
    // Each quote consents to exactly the market's own 25 bps maker fee.
    const quoted = [...vaultOrders(s, vault, 2), ...vaultOrders(s, second, 2)];
    expect(quoted.every((o) => o.maxFeeBps === 25)).toBe(true);
    // Steady state: once warm, an unchanged market costs each vault one eth_call per round (its
    // snapshot) and nothing else: no nonce, fee or block reads, no second snapshot. With the
    // keeper's multicall batching the snapshots stay apart: merged, many vaults' reads would pass
    // the 24 KB a deployless call can return.
    const calls: string[] = [];
    const counting = createPublicClient({
      chain: node.publicClient.chain,
      batch: { multicall: { deployless: true, batchSize: tx.DEPLOYLESS_BATCH_SIZE, wait: 5 } },
      transport: custom({
        request: ({ method, params }) => {
          calls.push(method);
          return node.publicClient.request({ method, params } as never);
        },
      }),
    }) as PublicClient;
    const warm = [
      keeperOf(vault, keeperAccount, config, counting),
      keeperOf(second, secondKeeper, config, counting),
    ];
    await Promise.all(warm.map((k) => k.cycle(round())));
    calls.length = 0;
    const steady = round();
    await Promise.all(warm.map((k) => k.cycle(steady)));
    expect(calls).toEqual(["eth_call", "eth_call"]);
    expect(vaultOrders(await synced(), vault, 2).length > 0).toBe(true);
    // Disabled for the first vault, the market's quotes are pulled on its next round.
    const off = settings({
      vaults: [{ vault, keeper: keeperAccount.address, markets: [{ market: 2, disabled: true }] }],
      ...shared,
    });
    await keeperOf(vault, keeperAccount, off).cycle(round());
    const after = await synced();
    expect(vaultOrders(after, vault, 2).length).toBe(0);
    expect(vaultOrders(after, second, 2).length > 0).toBe(true);
  }, 120_000);

  test("orders stay within the vault's lifetime limit while this host's clock runs ahead of the chain", async () => {
    // The order lifetime equals the vault's maxTtl (600 s): only chain time keeps it valid.
    const config = settings({
      vaults: [{ vault, keeper: keeperAccount.address }],
      model: { anchorBps: 300, impactBps: 50, maxGapBps: 800, orderQuote: "5000" },
      quoteLevels: 2,
      pollMs: 1000,
      ttlSeconds: 600,
    });
    const chainNow = (await synced()).timestamp;
    setSystemTime(new Date(Date.now() + 10_000));
    try {
      setReference(100n * USDC, 400_000n);
      await keeperOf(vault, keeperAccount, config).cycle(round());
    } finally {
      setSystemTime();
    }
    const orders = vaultOrders(await synced(), vault, 2);
    expect(orders.length > 0).toBe(true);
    expect(orders.every((o) => o.expiry <= chainNow + 600n + 5n)).toBe(true);
  }, 60_000);

  test("a market whose maker fee is above the vault's fee cap is never quoted", async () => {
    // 150 bps against the curator's 100 bps cap: every fill would cost more than allowed.
    await send(
      node,
      0,
      tx.createMarket(
        protocol.exchange,
        {
          base: protocol.stock,
          condition: keccak256(stringToBytes("condition-3")),
          yesIndex: 1,
          noIndex: 2,
          rulesHash: keccak256(stringToBytes("rules")),
          metadataHash: keccak256(stringToBytes("ipfs://m3")),
          open: NOW - 10n,
          cutoff: NOW + 30n * 86_400n,
          tick: 10_000n,
          step: 10n ** 15n,
          maxSteps: 1_000_000n,
          minNotional: 1_000_000n,
          maxOrder: 10n ** 11n,
          maxWallet: 10n ** 12n,
          maxMarket: 10n ** 13n,
          makerBps: 150,
          takerBps: 150,
        },
        "ipfs://m3",
      ),
    );
    await send(node, 0, tx.lifecycle(protocol.exchange, 3, 0, zeroHash));
    await send(
      node,
      0,
      tx.deltaVaultAddMarket(vault, 3, {
        bandBps: 1000,
        cutoffBuffer: 3600,
        maxOrder: 50_000n * USDC,
        maxResting: 200_000n * USDC,
        maxImbalance: 200n * NVDA,
      }),
    );
    const config = settings({
      vaults: [{ vault, keeper: keeperAccount.address }],
      model: { anchorBps: 300, impactBps: 50, maxGapBps: 800, orderQuote: "5000" },
      quoteLevels: 2,
      pollMs: 1000,
      ttlSeconds: 300,
    });
    await synced();
    setReference(100n * USDC, 400_000n);
    await keeperOf(vault, keeperAccount, config).cycle(round());
    const s = await synced();
    expect(vaultOrders(s, vault, 3)).toHaveLength(0);
    // The vault's other market keeps its quotes.
    expect(vaultOrders(s, vault, 2).length > 0).toBe(true);
  }, 60_000);
});
