import { afterEach, expect, test } from "bun:test";
import {
  indexHealthSnapshot,
  indexStreamHealthy,
  parseIndexUpdate,
  parsePosition,
  parseStreamWallet,
  STREAMED_RESOURCES,
  setIndexStreamHealthy,
  subscribeIndexHealth,
} from "../src/services/index-stream";
import { FIXTURE_TOKENS, fixtureVenue } from "./fixtures/protocol";

afterEach(() => setIndexStreamHealthy(0));
const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
test("the stream covers the index's resources, and its health notifies only when it flips", async () => {
  for (const name of ["markets", "wallet-orders", "trades", "positions", "trading-readiness"])
    expect(STREAMED_RESOURCES.has(name)).toBe(true);
  for (const name of ["spot-prices", "quote-prices", "price-history", "delta-vaults"])
    expect(STREAMED_RESOURCES.has(name)).toBe(false);
  let changes = 0;
  const stop = subscribeIndexHealth(() => changes++);
  try {
    setIndexStreamHealthy(Date.now() + 10_000);
    // Each further frame extends the health without a notification.
    setIndexStreamHealthy(Date.now() + 10_000);
    expect([indexHealthSnapshot(), indexStreamHealthy(), changes]).toEqual([true, true, 1]);
    // Without frames it lapses on its own.
    setIndexStreamHealthy(Date.now() + 20);
    await Bun.sleep(40);
    expect([indexHealthSnapshot(), indexStreamHealthy(), changes]).toEqual([false, false, 2]);
  } finally {
    stop();
  }
});
test("stream validation rejects stale state, malformed topics and forged readiness", () => {
  const market = "00000000000000a1";
  const valid = { block: "1", observedAt: Date.now(), markets: [market], owners: [owner] };
  expect(parseIndexUpdate(JSON.stringify(valid)).block).toBe("1");
  for (const change of [
    { block: "-1" },
    { observedAt: Date.now() - 16_000 },
    { markets: ["bad"] },
    // Markets are addressed by public id, never by an on-chain id.
    { markets: ["1"] },
    { owners: ["bad"] },
    { readiness: { [market]: { reason: "closed", healthy: true, checkedAt: Date.now() } } },
  ])
    expect(() => parseIndexUpdate(JSON.stringify({ ...valid, ...change }))).toThrow();
});
test("wallet stream cannot substitute identity, malformed amounts or expired data", () => {
  const valid = { owner, observedAt: Date.now(), blockNumber: "12", positions: [], balances: {} };
  expect(parseStreamWallet(valid, owner)).toEqual(valid);
  for (const change of [
    { owner: "other" },
    { observedAt: Date.now() - 31_000 },
    {
      balances: {
        [owner]: {
          account: owner,
          token: owner,
          decimals: 6,
          canonicalBalance: "-1",
          vaultAvailable: "0",
          reserved: "0",
          blockNumber: "12",
        },
      },
    },
    { positions: [{ marketId: "1", conditionId: "1", protocolVersion: 3 }] },
  ])
    expect(() => parseStreamWallet({ ...valid, ...change }, owner)).toThrow();
});

test("streamed positions name their public market and the venue holding their claims", () => {
  const position = {
    marketId: "00000000000000a1",
    venue: { ...fixtureVenue, marketId: "7" },
    conditionId: "7",
    redeemable: false,
    protocolVersion: 4,
    baseToken: FIXTURE_TOKENS.base,
    shareDecimals: 18,
    baseTokenDecimals: 18,
    quoteTokenDecimals: 6,
    quoteYes: "1",
    quoteNo: "0",
    baseYes: "0",
    baseNo: "0",
  };
  expect(parsePosition(position)).toEqual(position);
  for (const change of [
    { marketId: "7" },
    { venue: undefined },
    { venue: { ...position.venue, exchange: "bad" } },
    { conditionId: "8" },
  ])
    expect(() => parsePosition({ ...position, ...change })).toThrow();
});

test("wallet stream keeps exact custody balances and fails closed without them", () => {
  const token = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const balance = {
    account: owner,
    token,
    decimals: 6,
    canonicalBalance: "798602493340",
    vaultAvailable: "1",
    reserved: "2",
    blockNumber: "12",
  };
  const value = {
    owner,
    observedAt: Date.now(),
    blockNumber: "12",
    positions: [],
    balances: { [token]: balance },
  };
  expect(parseStreamWallet(value, owner).balances[token]).toEqual(balance);
  const { vaultAvailable: _omitted, ...partial } = balance;
  expect(() => parseStreamWallet({ ...value, balances: { [token]: partial } }, owner)).toThrow(
    "Invalid streamed balance",
  );
});
