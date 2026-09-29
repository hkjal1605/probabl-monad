/** The maker against a real exchange on anvil: funding, quoting, atomic requotes, cancellation. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as tx from "@conditional-stocks/evm-client";
import { accountOf } from "@conditional-stocks/evm-client/ledger";
import { ChainFollower, TokenReader } from "@conditional-stocks/indexer";
import { encodeFunctionData, keccak256, stringToBytes, toHex, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  type Anvil,
  accounts,
  deployProtocol,
  startAnvil,
  tokenAbi,
} from "../../../packages/evm-client/test/anvil.ts";
import { settings } from "../src/config.ts";
import { Engine, owned } from "../src/engine.ts";
import { Executor } from "../src/execution.ts";
import { initialState } from "../src/state.ts";
import type { Reference } from "../src/strategy.ts";

const NOW = BigInt(Math.floor(Date.now() / 1000));
const maker = privateKeyToAccount(toHex(accounts[3]!.getHdKey().privateKey!));
let node: Anvil;
let follower: ChainFollower;
let engine: Engine;
let protocol: Awaited<ReturnType<typeof deployProtocol>>;
let spot = 100_000_000n;

async function send(index: number, envelope: { to: `0x${string}`; data: `0x${string}` }) {
  const wallet = node.wallet(index);
  const hash = await wallet.sendTransaction({
    to: envelope.to,
    data: envelope.data,
    account: accounts[index]!,
  } as never);
  if ((await wallet.waitForTransactionReceipt({ hash })).status !== "success")
    throw new Error("reverted");
}

beforeAll(async () => {
  node = await startAnvil(Number(NOW));
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
      },
      "ipfs://m",
    ),
  );
  await send(0, tx.lifecycle(exchange, 1, 0, zeroHash));
  for (const [token, amount] of [
    [usdc, 10n ** 12n],
    [stock, 1_000n * 10n ** 18n],
  ] as const)
    await send(0, {
      to: token,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "mint",
        args: [maker.address, amount],
      }),
    });

  follower = new ChainFollower({
    client: node.publicClient,
    exchange,
    quote: usdc,
    deploymentBlock: 1n,
    domain: "test",
    pollMs: 100,
  });
  await follower.start();
  const config = settings({
    markets: [
      {
        market: 1,
        base: stock,
        baseInventory: "10",
        quoteInventory: "10000",
        orderQuote: "2000",
        gapBps: 200,
        basePriceMultiplier: "1",
        quotePriceMultiplier: "1",
      },
    ],
    pollMs: 1000,
    ttlSeconds: 120,
  });
  const state = initialState("test");
  const save = () => {};
  engine = new Engine(
    follower,
    new TokenReader(node.publicClient),
    maker.address,
    31337,
    config,
    "http://127.0.0.1",
    state,
    save,
    new Executor(node.publicClient, maker, config, state, save),
    async (): Promise<Reference> => ({
      spot,
      probability: 600_000n,
      spread: 10_000n,
      observedAt: Date.now(),
    }),
  );
}, 60_000);

afterAll(() => {
  follower?.stop();
  node?.stop();
});

test("funds claims once, quotes both books, requotes atomically and cancels", async () => {
  await engine.fund();
  let s = await engine.view();
  for (const branch of [0, 1]) {
    expect(accountOf(s, 1, branch, maker.address).quote).toBe(10_000n * 10n ** 6n);
    expect(accountOf(s, 1, branch, maker.address).base).toBe(10n * 10n ** 18n);
  }
  await expect(engine.fund()).resolves.toBeUndefined(); // Already complete: nothing more is split.

  await engine.cycle();
  s = await engine.view();
  const first = owned(s, maker.address, 1);
  expect(first.map((o) => `${o.branch}:${o.side}`).sort()).toEqual(["0:0", "0:1", "1:0", "1:1"]);
  expect(first.every((o) => o.fundingKind === 1 && o.tif === 0)).toBe(true);

  // A 1% move reprices every level through `replace` (one transaction per level).
  spot = 101_000_000n;
  await engine.cycle();
  s = await engine.view();
  const second = owned(s, maker.address, 1);
  expect(second).toHaveLength(4);
  expect(second.some((o) => first.some((f) => f.key === o.key))).toBe(false);
  const bid = second.find((o) => o.branch === 0 && o.side === 0)!;
  expect(bid.ticks * 10_000n).toBeGreaterThan(
    first.find((o) => o.branch === 0 && o.side === 0)!.ticks * 10_000n,
  );

  // An unchanged reference is a no-op.
  await engine.cycle();
  expect(
    owned(await engine.view(), maker.address, 1)
      .map((o) => o.key)
      .sort(),
  ).toEqual(second.map((o) => o.key).sort());

  await engine.cancelMarket();
  expect(owned(await engine.view(), maker.address, 1)).toHaveLength(0);
  for (const branch of [0, 1])
    expect(accountOf(await engine.view(), 1, branch, maker.address).base).toBe(10n * 10n ** 18n);

  // Static seeding places one level per ladder from the last safe reference.
  await engine.staticCycle();
  expect(owned(await engine.view(), maker.address, 1)).toHaveLength(4);
}, 120_000);
