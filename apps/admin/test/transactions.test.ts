import { expect, test } from "bun:test";
import { conditionalStocksAbi, resolutionHash, underlyingId } from "@conditional-stocks/evm-client";
import { type AdminDeployment, makerRebateTransaction } from "@conditional-stocks/evm-client/admin";
import {
  buildCreationEvidence,
  buildResolutionEvidence,
  hashCanonical,
  normalizeGammaMarket,
  type PayoutVector,
} from "@conditional-stocks/market-data";
import { decodeFunctionData, type Hex } from "viem";
import { gammaMarket } from "../../../packages/market-data/tests/helpers";
import type { AdminPreview, EvidenceView } from "../src/lib/admin-api";
import { evidenceTransaction, verifyAdminPreview } from "../src/lib/transactions";

const exchange = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  marketAdmin = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  resolutionAdmin = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  base = "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  quote = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const listed = new Set<string>();
const deployment: AdminDeployment = {
  chainId: 31337,
  exchange,
  marketAdmin,
  resolutionAdmin,
  nextMarketId: 7,
  basePoolListed: (token) => listed.has(token),
  baseUnderlying: () => underlyingId("US:NVDA"),
};
const source = normalizeGammaMarket(gammaMarket());
const creation = () =>
  buildCreationEvidence({
    deployment: { chainId: "31337", exchange },
    preparer: marketAdmin,
    preparedAt: "2026-09-12T00:00:00Z",
    attachments: [],
    metadata: source,
    metadataRawHash: hashCanonical(gammaMarket()),
    metadataSnapshotId: "fixture",
    sourceUrls: [source.canonicalUrl],
    config: {
      baseToken: base,
      quoteToken: quote,
      baseStep: "1000000000000000",
      priceTickRawX18: "10000",
      minNotional: "1000000",
      maxOrderQuantity: "1000000000000000000000",
      maxOrderNotional: "9007199254740993123",
      maxWalletOpenNotional: "9007199254740993123",
      maxMarketOpenNotional: "18014398509481986246",
      makerFeeBps: "12",
      takerFeeBps: "34",
      metadataUri: "ipfs://test",
      rules: "Example",
      tradingOpen: "1800000000",
      tradingCutoff: "1900000000",
    },
  });
const resolution = (payout: PayoutVector = { yes: "1", no: "0", denominator: "1" }) =>
  buildResolutionEvidence({
    deployment: { chainId: "31337", exchange },
    preparer: marketAdmin,
    preparedAt: "2026-09-12T00:00:00Z",
    attachments: [],
    conditionId: "7",
    marketId: "7",
    source: "polymarket",
    eventMarketId: source.gammaMarketId,
    metadataRawHash: hashCanonical(gammaMarket()),
    metadataSnapshotId: "fixture",
    officialStatus: "resolved",
    officialUrl: source.canonicalUrl,
    payout,
    polygon: {
      chainId: "137",
      conditionalTokensAddress: "0x1000000000000000000000000000000000000001",
    },
    eventConditionId: source.conditionId,
    eventYesIndex: "1",
    eventNoIndex: "2",
    sourceObservations: [
      { observedAt: "2026-09-12T00:00:00Z", payout, status: "resolved", url: source.canonicalUrl },
    ],
    sourceReference: "ipfs://resolution",
  });
const approved = (envelope: EvidenceView["envelope"]): EvidenceView => ({
  envelope,
  status: "approved",
  reviews: [{ decision: "approve", reviewedAt: "2026-09-12T00:00:00Z", reviewer: marketAdmin }],
  previews: [],
  observations: [],
});
const preview = (view: EvidenceView, action: AdminPreview["action"]): AdminPreview => {
  const { transactions, expectedMarketId } = evidenceTransaction(view, action, deployment);
  return {
    ...transactions.at(-1)!,
    action,
    packetHash: view.envelope.packetHash,
    previewId: "test",
    expectedMarketId,
    prerequisites: transactions.slice(0, -1),
  };
};
const decode = (data: Hex) => decodeFunctionData({ abi: conditionalStocksAbi, data });

test("a maker rebate is a market-admin setMakerRebate call of whole bps up to half the taker fee", () => {
  const transaction = makerRebateTransaction(deployment, marketAdmin, 7, 2_500);
  expect(transaction).toMatchObject({ to: exchange, from: marketAdmin, chainId: 31337 });
  const call = decodeFunctionData({ abi: conditionalStocksAbi, data: transaction.data as Hex });
  expect(call.functionName).toBe("setMakerRebate");
  expect(call.args).toEqual([7, 2_500]);
  expect(makerRebateTransaction(deployment, marketAdmin, 7, 0).data).not.toBe(transaction.data);
  for (const rate of [5_001, -1, 12.5, Number.NaN])
    expect(() => makerRebateTransaction(deployment, marketAdmin, 7, rate)).toThrow(
      "Invalid maker rebate",
    );
});

test("creation lists an unlisted stock token first and keeps raw uint64 caps exact", () => {
  listed.clear();
  const view = approved(creation());
  const [list, create] = verifyAdminPreview(view, preview(view, "create-market"), deployment);
  expect(decode(list!.data)).toMatchObject({
    functionName: "listPool",
    args: [base, underlyingId("US:NVDA")],
  });
  const decoded = decode(create!.data);
  expect(decoded.functionName).toBe("createMarket");
  expect((decoded.args![0] as { maxWallet: bigint }).maxWallet).toBe(9007199254740993123n);
  // The reviewed fee rates become the market's on-chain rates.
  expect(decoded.args![0]).toMatchObject({ makerBps: 12, takerBps: 34 });
  expect(create!.from).toBe(marketAdmin);
  listed.add(base);
  expect(verifyAdminPreview(view, preview(view, "create-market"), deployment)).toHaveLength(1);
  // A preview built before the pool was listed no longer matches the live deployment.
  listed.clear();
  const stale = preview(view, "create-market");
  listed.add(base);
  expect(() => verifyAdminPreview(view, stale, deployment)).toThrow("differs");
});

for (const payout of [
  { yes: "1", no: "0", denominator: "1" },
  { yes: "0", no: "1", denominator: "1" },
  { yes: "1", no: "1", denominator: "2" },
] as const)
  test(`resolution commits exact payout ${payout.yes}/${payout.no}`, () => {
    const value = resolution(payout),
      view = approved(value);
    const [begin] = verifyAdminPreview(view, preview(view, "begin-resolution"), deployment);
    const [resolve] = verifyAdminPreview(view, preview(view, "resolve-market"), deployment);
    expect(decode(begin!.data).args).toEqual([
      7,
      3,
      resolutionHash(
        31337,
        exchange,
        7,
        Number(payout.yes),
        Number(payout.no),
        value.packetHash,
        value.packet.sourceReference,
      ),
    ]);
    expect(begin!.from).toBe(marketAdmin);
    expect(resolve!.from).toBe(resolutionAdmin);
    expect(decode(resolve!.data).args?.slice(0, 3)).toEqual([
      7,
      Number(payout.yes),
      Number(payout.no),
    ]);
  });

test("an unlisted base token without a catalogued underlying is never listed", () => {
  listed.clear();
  const view = approved(creation());
  expect(() =>
    evidenceTransaction(view, "create-market", { ...deployment, baseUnderlying: () => null }),
  ).toThrow("asset catalog");
  listed.add(base);
  expect(
    evidenceTransaction(view, "create-market", { ...deployment, baseUnderlying: () => null })
      .transactions,
  ).toHaveLength(1);
  listed.clear();
});

test("unsigned review, packet tampering and cross-deployment execution fail closed", () => {
  const view = approved(creation());
  for (const status of ["prepared", "rejected"] as const)
    expect(() => evidenceTransaction({ ...view, status }, "create-market", deployment)).toThrow(
      "approval",
    );
  expect(() => evidenceTransaction({ ...view, reviews: [] }, "create-market", deployment)).toThrow(
    "approval",
  );
  const good = approved(creation());
  for (const change of [{ chainId: 8453 }, { exchange: base as `0x${string}` }])
    expect(() => evidenceTransaction(good, "create-market", { ...deployment, ...change })).toThrow(
      "deployment",
    );
  expect(() => evidenceTransaction(good, "resolve-market", deployment)).toThrow("Action");
  view.envelope.packet.preparer = base;
  expect(() => evidenceTransaction(view, "create-market", deployment)).toThrow();
});

test("a preview cannot change authority, target, payload, payment, prerequisites or evidence", () => {
  const view = approved(resolution()),
    expected = preview(view, "resolve-market");
  for (const changes of [
    { from: base },
    { to: base },
    { data: "0x12" },
    { packetHash: "bad" },
    { value: "1" },
    { chainId: 1 },
    { prerequisites: [expected] },
  ])
    expect(() =>
      verifyAdminPreview(view, { ...expected, ...changes } as AdminPreview, deployment),
    ).toThrow("differs");
});
