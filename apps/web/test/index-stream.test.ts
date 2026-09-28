import { afterEach, expect, test } from "bun:test";
import {
  parseIndexUpdate,
  parseStreamWallet,
  setIndexStreamHealthy,
} from "../src/services/index-stream";
import { readPollInterval } from "../src/services/read-policy";

afterEach(() => setIndexStreamHealthy(0));
const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
test("healthy SSE disables only covered queries; failure restores polling", () => {
  const query = (kind: string) => ({
    queryKey: [kind],
    state: { status: "success", fetchFailureCount: 0 },
  });
  setIndexStreamHealthy(Date.now() + 10_000);
  for (const kind of [
    "markets",
    "wallet-orders",
    "trades",
    "positions",
    "whole-balances",
    "trading-readiness",
  ])
    expect(readPollInterval(query(kind))).toBe(false);
  expect(readPollInterval(query("unrelated"))).toBe(10_000);
  setIndexStreamHealthy(0);
  expect(readPollInterval(query("markets"))).toBe(10_000);
});
test("stream validation rejects stale state, malformed topics and forged readiness", () => {
  const valid = { block: "1", observedAt: Date.now(), markets: ["1"], owners: [owner] };
  expect(parseIndexUpdate(JSON.stringify(valid)).block).toBe("1");
  for (const change of [
    { block: "-1" },
    { observedAt: Date.now() - 16_000 },
    { markets: ["bad"] },
    { owners: ["bad"] },
    { readiness: { "1": { reason: "closed", healthy: true, checkedAt: Date.now() } } },
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
