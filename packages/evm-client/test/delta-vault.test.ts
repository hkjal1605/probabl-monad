/** The vault client against the real contracts on anvil. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { encodeFunctionData, getAddress, zeroAddress } from "viem";
import {
  approve,
  DELTA_VAULT_ROLES,
  deltaVaultAbi,
  deltaVaultAddMarket,
  deltaVaultDeposit,
  deltaVaultError,
  deltaVaultErrorMessage,
  deltaVaultGrantRole,
  deltaVaultSetCaps,
  deltaVaultSetLimits,
  deltaVaultSetWithdrawLimit,
  deltaVaultUpdate,
  deltaVaultValue,
  deltaVaultWithdraw,
  deltaVaultWorlds,
  type OrderWire,
  readDeltaVault,
  validateDeltaVaultRisk,
} from "../src/index.ts";
import {
  type Anvil,
  accounts,
  deployDeltaVault,
  deployProtocol,
  openMarket,
  send,
  startAnvil,
  tokenAbi,
} from "./anvil.ts";

const NOW = BigInt(Math.floor(Date.now() / 1000));
const NVDA = 10n ** 18n;
let node: Anvil;
let protocol: Awaited<ReturnType<typeof deployProtocol>>;
let vault: `0x${string}`;
const admin = accounts[0]!.address;
const alice = accounts[1]!.address;

const risk = {
  bandBps: 1000,
  cutoffBuffer: 3600,
  maxOrder: 50_000n * 10n ** 6n,
  maxResting: 200_000n * 10n ** 6n,
  maxImbalance: 200n * NVDA,
};
async function mint(to: `0x${string}`, quote: bigint, base: bigint) {
  for (const [token, amount] of [
    [protocol.usdc, quote],
    [protocol.stock, base],
  ] as const) {
    await send(node, 0, {
      to: token,
      data: encodeFunctionData({ abi: tokenAbi, functionName: "mint", args: [to, amount] }),
    });
  }
}
const now = async () => (await node.publicClient.getBlock()).timestamp;

beforeAll(async () => {
  node = await startAnvil(Number(NOW));
  protocol = await deployProtocol(node);
  await openMarket(node, protocol, NOW);
  ({ vault } = await deployDeltaVault(node, protocol, NOW));
  for (const role of ["curator", "keeper", "guardian"] as const)
    await send(node, 0, deltaVaultGrantRole(vault, role, admin));
  await send(node, 0, deltaVaultSetCaps(vault, 10n ** 13n, 10n ** 24n));
  await send(
    node,
    0,
    deltaVaultSetLimits(vault, { maxTtl: 600, maxOracleAge: 86_400, maxFeeBps: 100 }),
  );
  await send(node, 0, deltaVaultAddMarket(vault, 1, risk));
  await mint(admin, 100_000n * 10n ** 6n, 1000n * NVDA);
  await send(node, 0, approve(protocol.usdc, vault, 100_000n * 10n ** 6n));
  await send(node, 0, approve(protocol.stock, vault, 1000n * NVDA));
  await send(node, 0, deltaVaultDeposit(vault, 100_000n * 10n ** 6n, 1000n * NVDA, 0n, admin));
}, 60_000);

afterAll(() => node?.stop());

test("reads the whole vault in two round trips", async () => {
  const state = await readDeltaVault(node.publicClient, vault);
  expect(state.exchange).toBe(protocol.exchange);
  expect(state.quote).toBe(protocol.usdc);
  expect(state.base).toBe(protocol.stock);
  expect(state.sequencerFeed).toBeNull();
  expect(state.totalSupply).toBe(10n ** 22n);
  expect(state.holdings.quote).toBe(100_000n * 10n ** 6n);
  expect(state.holdings.base).toBe(1000n * NVDA);
  expect(state.markets.map((m) => m.market)).toEqual([1]);
  expect(state.markets[0]!.risk).toEqual(risk);
  expect(state.markets[0]!.tick).toBe(10_000n);
  expect(state.limits).toEqual({ maxTtl: 600, maxOracleAge: 86_400, maxFeeBps: 100 });
  expect(state.caps).toEqual({ quote: 10n ** 13n, base: 10n ** 24n });
  expect(state.withdrawLimitBps).toBe(10_000);
  expect(state.oraclePrice).toBe(100_000_000n);
  expect(state.paused).toBe(false);
  expect(state.admin).toBe(admin);
});

test("deposits and withdrawals move exactly what the previews say", async () => {
  await mint(alice, 20_000n * 10n ** 6n, 500n * NVDA);
  await send(node, 1, approve(protocol.usdc, vault, 20_000n * 10n ** 6n));
  await send(node, 1, approve(protocol.stock, vault, 500n * NVDA));
  const [shares, quoteIn, baseIn] = await node.publicClient.readContract({
    address: vault,
    abi: deltaVaultAbi,
    functionName: "previewDeposit",
    args: [20_000n * 10n ** 6n, 500n * NVDA],
  });
  await send(node, 1, deltaVaultDeposit(vault, 20_000n * 10n ** 6n, 500n * NVDA, shares, alice));
  const balance = (token: `0x${string}`) =>
    node.publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [alice],
    });
  expect(await balance(protocol.usdc)).toBe(20_000n * 10n ** 6n - quoteIn);
  expect(await balance(protocol.stock)).toBe(500n * NVDA - baseIn);

  const [quoteOut, baseOut] = await node.publicClient.readContract({
    address: vault,
    abi: deltaVaultAbi,
    functionName: "previewWithdraw",
    args: [shares],
  });
  await send(node, 1, deltaVaultWithdraw(vault, shares, quoteOut, baseOut, alice, alice));
  // In kind and rounded for the vault: never more than paid, at most a unit less.
  expect(await balance(protocol.usdc)).toBe(20_000n * 10n ** 6n - quoteIn + quoteOut);
  expect(quoteIn - quoteOut <= 1n && baseIn - baseOut <= 1n).toBe(true);
});

test("the keeper posts vault-owned quotes; the band rejects the rest by name", async () => {
  const at = await now();
  const quoteFor = (price: bigint): OrderWire => ({
    maker: vault,
    marketId: "1",
    quantity: String(2n * NVDA),
    limitPriceRawX18: String(price),
    expiry: String(at + 300n),
    maxFeeBps: 50,
    branch: 0,
    side: 1,
    fundingKind: 0,
    tif: 0,
  });
  const book = { nextSequence: 0n, deadline: at + 60n };
  await send(
    node,
    0,
    deltaVaultUpdate(vault, 1, [], [{ order: quoteFor(103_000_000n), ...book }], 10_000n),
  );
  const state = await readDeltaVault(node.publicClient, vault);
  expect(state.markets[0]!.orders.length).toBe(1);
  expect(state.markets[0]!.exposure.low).toBe(-2n * NVDA);
  expect(state.markets[0]!.exposure.resting).toBe(206_000_000n);
  // Escrowed stock is still the vault's.
  expect(deltaVaultWorlds(state.holdings).yesBase).toBe(1000n * NVDA);

  const outside = deltaVaultUpdate(
    vault,
    1,
    [],
    [{ order: quoteFor(111_000_000n), nextSequence: 1n, deadline: at + 60n }],
    10_000n,
  );
  const failure = await node.publicClient
    .call({ account: admin, to: outside.to, data: outside.data })
    .then(() => null)
    .catch((error: unknown) => error);
  expect(deltaVaultError(failure)).toBe("OrderPrice");
  expect(deltaVaultErrorMessage(failure, "fallback")).toBe("fallback");
});

test("envelopes refuse quotes the vault would not own or keep resting", () => {
  const order: OrderWire = {
    maker: vault,
    marketId: "1",
    quantity: String(NVDA),
    limitPriceRawX18: "100000000",
    expiry: "1",
    maxFeeBps: 0,
    branch: 0,
    side: 0,
    fundingKind: 0,
    tif: 0,
  };
  const build = (o: OrderWire, market = 1) =>
    deltaVaultUpdate(vault, market, [], [{ order: o, nextSequence: 0n, deadline: 1n }], 10_000n);
  expect(() => build({ ...order, maker: alice })).toThrow();
  expect(() => build({ ...order, delegate: alice })).toThrow();
  expect(() => build({ ...order, tif: 1 })).toThrow();
  expect(() => build(order, 2)).toThrow();
  expect(() => deltaVaultUpdate(vault, 1, [], [], 10_000n)).toThrow();
  expect(() => deltaVaultSetWithdrawLimit(vault, 999)).toThrow();
  expect(() => validateDeltaVaultRisk({ ...risk, maxOrder: risk.maxResting + 1n })).toThrow();
  expect(() => deltaVaultDeposit(vault, 1n, 1n, 0n, zeroAddress)).toThrow();
  expect(getAddress(build(order).to)).toBe(vault);
  expect(DELTA_VAULT_ROLES.keeper).toMatch(/^0x[0-9a-f]{64}$/);
});

test("per-world holdings and a probability-weighted estimate", () => {
  const holdings = {
    quote: 1000n,
    base: 10n * NVDA,
    freeQuote: 1000n,
    freeBase: 10n * NVDA,
    markets: [
      {
        market: 1,
        claims: { yesQuote: 103n, noQuote: 0n, yesBase: 0n, noBase: NVDA },
        free: { yesQuote: 103n, noQuote: 0n, yesBase: 0n, noBase: NVDA },
      },
    ],
  };
  expect(deltaVaultWorlds(holdings)).toEqual({
    yesQuote: 1103n,
    noQuote: 1000n,
    yesBase: 10n * NVDA,
    noBase: 11n * NVDA,
  });
  // Spot 100 raw per whole token (1e2 x 1e18 / 1e18): 1,000 + 1,000 + 0.4 x 103 + 0.6 x 100.
  expect(deltaVaultValue(holdings, 100n, () => 400_000n)).toBe(2101n);
  expect(deltaVaultValue(holdings, 100n, () => null)).toBeNull();
});
