import { describe, expect, test } from "bun:test";

import { loadApiConfig, loadMatcherConfig, loadProtocolConfig } from "./index.ts";

describe("configuration", () => {
  test("loads API defaults", () => {
    expect(loadApiConfig({})).toEqual({ host: "127.0.0.1", port: 3000 });
  });

  test("requires complete verified-chain deployment configuration", () => {
    const config = loadProtocolConfig({
      CONDITIONAL_TOKENS_ADDRESS: "0x1111111111111111111111111111111111111111",
      DEPLOYMENT_BLOCK: "123",
      EXCHANGE_ADDRESS: "0x2222222222222222222222222222222222222222",
      MARKET_REGISTRY_ADDRESS: "0x3333333333333333333333333333333333333333",
      ROBINHOOD_CHAIN_ID: "46630",
      ROBINHOOD_RPC_URL: "https://rpc.example.test",
    });
    expect(config.chainId).toBe(46_630);
    expect(config.deploymentBlock).toBe(123n);
  });

  test("rejects malformed addresses and RPC protocols", () => {
    expect(() =>
      loadProtocolConfig({
        CONDITIONAL_TOKENS_ADDRESS: "not-an-address",
        DEPLOYMENT_BLOCK: "0",
        EXCHANGE_ADDRESS: "0x2222222222222222222222222222222222222222",
        MARKET_REGISTRY_ADDRESS: "0x3333333333333333333333333333333333333333",
        ROBINHOOD_CHAIN_ID: "46630",
        ROBINHOOD_RPC_URL: "file:///tmp/rpc",
      }),
    ).toThrow();
  });

  test("loads bounded matcher durability and lease settings", () => {
    expect(loadMatcherConfig({ MATCHER_OWNER_ID: "matcher-a" })).toEqual({
      checkpointEveryEvents: 100n,
      leaseTtlMs: 15_000n,
      maxFillsPerProposal: 32,
      ownerId: "matcher-a",
    });
    expect(() =>
      loadMatcherConfig({
        MATCHER_MAX_FILLS_PER_PROPOSAL: "33",
        MATCHER_OWNER_ID: "matcher-a",
      }),
    ).toThrow();
  });
});
