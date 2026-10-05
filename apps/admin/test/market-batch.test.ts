import { expect, test } from "bun:test";
import { underlyingId } from "@conditional-stocks/evm-client";
import type { AdminDeployment } from "@conditional-stocks/evm-client/admin";
import { hashCanonical, normalizeGammaMarket } from "@conditional-stocks/market-data";
import { gammaMarket } from "../../../packages/market-data/tests/helpers";
import type { EvidenceView } from "../src/lib/admin-api";
import type { TokenInfo } from "../src/lib/chain";
import {
  assertBatchPacket,
  type BatchPlan,
  type BatchResult,
  buildBatchPlans,
  defaultMarketCaps,
  defaultMarketFees,
  MAX_BATCH_MARKETS,
  parseAssetRows,
  prepareMarketBatch,
  recoverBatchResults,
  resolveRows,
  tokenIdentity,
  type VerifiedTokens,
  validateMarketCaps,
  validateMarketFees,
} from "../src/lib/market-batch";

const marketAdmin = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const token = (address: string, symbol: string, decimals = 18, paused = false): TokenInfo => ({
  address: address as `0x${string}`,
  decimals,
  symbol,
  name: symbol,
  multiplierValue: 1,
  paused,
});
const quote = token("0x5FbDB2315678afecb367f032d93F642f64180aa3", "USDC", 6);
const nvda = token("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", "NVDA");
const tsla = token("0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", "TSLA");
const deployment: AdminDeployment = {
  chainId: 31337,
  exchange: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  marketAdmin,
  resolutionAdmin: marketAdmin,
  nextMarketId: 1,
  basePoolListed: () => false,
  baseUnderlying: () => underlyingId("US:NVDA"),
};
const verified = (checks: VerifiedTokens["checks"]): VerifiedTokens => ({
  quote,
  checks,
  listed: {},
  deployment,
});
const source = {
  normalized: normalizeGammaMarket(gammaMarket()),
  rawHash: hashCanonical(gammaMarket()),
  snapshotId: "snapshot",
};
const shared = {
  tradingOpen: "1800000000",
  tradingCutoff: "4000000000",
  metadataUri: "https://polymarket.com/event/test",
  sourceUrls: "https://polymarket.com/event/test",
};
const plans = () =>
  buildBatchPlans({
    rows: [
      { base: nvda, caps: defaultMarketCaps(18, 6), fees: { makerFeeBps: "5", takerFeeBps: "20" } },
      { base: tsla, caps: defaultMarketCaps(18, 6), fees: { makerFeeBps: "0", takerFeeBps: "50" } },
    ],
    quote,
    source,
    shared,
    deployment,
    owner: marketAdmin,
  });
const view = (plan: BatchPlan, status: EvidenceView["status"] = "prepared"): EvidenceView => ({
  envelope: plan.envelope,
  status,
  reviews: [],
  previews: [],
  observations: [],
});

test("each market names one distinct stock token contract", () => {
  expect(parseAssetRows([` ${nvda.address.toLowerCase()} `, tsla.address])).toEqual([
    nvda.address,
    tsla.address,
  ]);
  expect(() => parseAssetRows([])).toThrow();
  expect(() => parseAssetRows(Array(MAX_BATCH_MARKETS + 1).fill(nvda.address))).toThrow();
  expect(() => parseAssetRows(["NVDA"])).toThrow("contract address");
  expect(() => parseAssetRows([nvda.address, nvda.address.toLowerCase()])).toThrow(
    "more than one market",
  );
});

test("default caps match the exchange's own rules for common token precisions", () => {
  // The values the protocol tests trade with: 0.001-token steps, $0.01 ticks.
  expect(defaultMarketCaps(18, 6)).toEqual({
    baseStep: "1000000000000000",
    priceTickRawX18: "10000",
    maxOrderQuantity: "1000000000000000000000",
    minNotional: "1000000",
    maxOrderNotional: "10000000000",
    maxWalletOpenNotional: "100000000000",
    maxMarketOpenNotional: "1000000000000",
  });
  for (const [base, quoteDecimals] of [
    [18, 6],
    [18, 18],
    [8, 6],
    [6, 6],
    [0, 6],
  ] as const)
    expect(() => validateMarketCaps(defaultMarketCaps(base, quoteDecimals))).not.toThrow();
});

test("caps outside the contract's integer domains or ordering are rejected", () => {
  const caps = defaultMarketCaps(18, 6);
  for (const change of [
    { baseStep: "0" },
    { baseStep: "1.5" },
    { priceTickRawX18: String(1n << 128n) },
    { maxOrderNotional: String(1n << 64n) },
    { maxOrderQuantity: "1000000000000000001" },
    { maxOrderQuantity: String(10n ** 15n * (1n << 32n)) },
    { minNotional: "20000000000" },
    { maxWalletOpenNotional: "1" },
    { baseStep: "1", priceTickRawX18: "1" },
  ])
    expect(() => validateMarketCaps({ ...caps, ...change })).toThrow();
});

test("fee rates are whole bps from 0 to the exchange's 1,000 bps cap", () => {
  expect(defaultMarketFees()).toEqual({ makerFeeBps: "0", takerFeeBps: "0" });
  for (const value of ["0", "7", "1000"])
    expect(() => validateMarketFees({ makerFeeBps: value, takerFeeBps: value })).not.toThrow();
  for (const value of ["", "-1", "1001", "1.5", "01", "1e3", "abc", "10000"]) {
    expect(() => validateMarketFees({ makerFeeBps: value, takerFeeBps: "0" })).toThrow(
      "makerFeeBps",
    );
    expect(() => validateMarketFees({ makerFeeBps: "0", takerFeeBps: value })).toThrow(
      "takerFeeBps",
    );
  }
  const result = resolveRows(verified({ [nvda.address]: { ok: true, token: nvda } }), [
    {
      token: nvda.address,
      caps: defaultMarketCaps(18, 6),
      fees: { makerFeeBps: "1001", takerFeeBps: "0" },
    },
  ]);
  expect(result.rows).toEqual([]);
  expect(result.problems[0]![0]).toContain("makerFeeBps");
});

test("paused, unverified and quote tokens are reported per market before any API write", () => {
  const paused = token(tsla.address, "TSLA", 18, true);
  const result = resolveRows(
    verified({
      [nvda.address]: { ok: true, token: nvda },
      [tsla.address]: { ok: true, token: paused },
      [quote.address]: { ok: true, token: quote },
    }),
    [
      { token: nvda.address, caps: defaultMarketCaps(18, 6), fees: defaultMarketFees() },
      { token: tsla.address, caps: defaultMarketCaps(18, 6), fees: defaultMarketFees() },
      { token: quote.address, caps: defaultMarketCaps(6, 6), fees: defaultMarketFees() },
      {
        token: "0x0000000000000000000000000000000000000001",
        caps: defaultMarketCaps(18, 6),
        fees: defaultMarketFees(),
      },
    ],
  );
  expect(result.rows).toEqual([]);
  expect(result.problems[0]).toEqual([]);
  expect(result.problems[1]![0]).toContain("paused");
  expect(result.problems[2]![0]).toContain("quote");
  expect(result.problems[3]![0]).toContain("not verified");
  // Token identity ignores pause state (re-validated live) but not precision.
  const a = verified({ [nvda.address]: { ok: true, token: nvda } });
  expect(tokenIdentity(a)).toBe(
    tokenIdentity(verified({ [nvda.address]: { ok: true, token: { ...nvda, paused: true } } })),
  );
  expect(tokenIdentity(a)).not.toBe(
    tokenIdentity(verified({ [nvda.address]: { ok: true, token: { ...nvda, decimals: 6 } } })),
  );
});

test("an unlisted token needs a catalogued underlying; an already listed one keeps its own", () => {
  const unknown = token("0x0000000000000000000000000000000000000abc", "ZZZZ");
  const rows = [
    { token: unknown.address, caps: defaultMarketCaps(18, 6), fees: defaultMarketFees() },
  ];
  const checks = { [unknown.address]: { ok: true as const, token: unknown } };
  expect(resolveRows(verified(checks), rows).problems[0]![0]).toContain("asset catalog");
  const listed = { ...verified(checks), listed: { [unknown.address]: true } };
  expect(resolveRows(listed, rows).problems[0]).toEqual([]);
});

test("plans bind one Polymarket condition to each stock token and require the market admin", () => {
  const [first, second] = plans();
  expect(first!.envelope.packet.config).toMatchObject({
    baseToken: nvda.address,
    quoteToken: quote.address,
    baseStep: "1000000000000000",
  });
  expect(second!.envelope.packet.config.baseToken).toBe(tsla.address);
  // Every market of the batch carries its own fee rates into its hash-bound evidence.
  expect(first!.envelope.packet.config).toMatchObject({ makerFeeBps: "5", takerFeeBps: "20" });
  expect(second!.envelope.packet.config).toMatchObject({ makerFeeBps: "0", takerFeeBps: "50" });
  expect(first!.body.config).toMatchObject({ makerFeeBps: "5", takerFeeBps: "20" });
  expect(first!.envelope.packet.polymarket.conditionId).toBe(
    second!.envelope.packet.polymarket.conditionId,
  );
  expect(first!.body.metadataSnapshotId).toBe("snapshot");
  expect(() =>
    buildBatchPlans({
      rows: [{ base: nvda, caps: defaultMarketCaps(18, 6), fees: defaultMarketFees() }],
      quote,
      source,
      shared,
      deployment,
      owner: tsla.address,
    }),
  ).toThrow("market-admin");
  expect(() =>
    buildBatchPlans({
      rows: [{ base: nvda, caps: defaultMarketCaps(18, 6), fees: defaultMarketFees() }],
      quote,
      source,
      shared: { ...shared, tradingCutoff: "1" },
      deployment,
      owner: marketAdmin,
    }),
  ).toThrow("future");
  expect(() =>
    buildBatchPlans({
      rows: [
        { base: nvda, caps: defaultMarketCaps(18, 6), fees: defaultMarketFees() },
        { base: nvda, caps: defaultMarketCaps(18, 6), fees: defaultMarketFees() },
      ],
      quote,
      source,
      shared,
      deployment,
      owner: marketAdmin,
    }),
  ).toThrow("more than one market");
});

test("returned packets must equal the reviewed rows; recovery never guesses between duplicates", () => {
  const batch = plans();
  expect(() => assertBatchPacket(batch[0]!, view(batch[0]!))).not.toThrow();
  expect(() => assertBatchPacket(batch[0]!, view(batch[1]!))).toThrow();
  const recovered = recoverBatchResults(
    batch,
    [{ phase: "pending" }, { phase: "pending" }],
    [view(batch[0]!), view(batch[0]!), view(batch[1]!, "rejected")],
  );
  expect(recovered[0]!.phase).toBe("uncertain");
  expect(recovered[1]!.phase).toBe("pending");
  expect(
    recoverBatchResults(batch, [{ phase: "pending" }, { phase: "pending" }], [view(batch[1]!)])[1]!
      .phase,
  ).toBe("prepared");
});

test("batch preparation stops at the first failure and never retries it automatically", async () => {
  const batch = plans();
  const results: BatchResult[] = [{ phase: "pending" }, { phase: "pending" }];
  let calls = 0;
  await prepareMarketBatch(batch, results, {
    check: () => {},
    prepare: async () => {
      calls++;
      throw new Error("network timeout");
    },
    update: (index, result) => {
      results[index] = result;
    },
  });
  expect(calls).toBe(1);
  expect(results).toEqual([
    { phase: "uncertain", message: "network timeout" },
    { phase: "pending" },
  ]);
  results[0] = { phase: "prepared", packet: view(batch[0]!) };
  await prepareMarketBatch(batch, results, {
    check: () => {},
    prepare: async (plan) => view(plan),
    update: (index, result) => {
      results[index] = result;
    },
  });
  expect(results.map((result) => result.phase)).toEqual(["prepared", "prepared"]);
});
