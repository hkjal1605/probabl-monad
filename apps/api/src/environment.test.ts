import { expect, test } from "bun:test";
import { loadAdminEvidenceEnvironment } from "./admin-environment.ts";
import { loadApiEnvironment } from "./environment.ts";

const maker = "0x1000000000000000000000000000000000000001";
const other = "0x2000000000000000000000000000000000000002";
const api = {
  ROBINHOOD_CHAIN_ID: "31337",
  CONDITIONAL_TOKENS_ADDRESS: maker,
  EXCHANGE_ADDRESS: maker,
  IOC_ROUTER_ADDRESS: maker,
  MARKET_REGISTRY_ADDRESS: maker,
  POSITION_ROUTER_ADDRESS: maker,
  ROBINHOOD_RPC_URL: "http://127.0.0.1:8545",
  SETTLEMENT_INTERNAL_TOKEN: "local-fixture-token",
};

test("API configuration validates chain identity, URLs, signer and internal mainnet allowlist", () => {
  const result = loadApiEnvironment(api);
  expect(result.chainId).toBe(31337);
  expect(result.relayerPrivateKey).toBeNull();
  expect(result.authOrigin).toBe("http://127.0.0.1:3000");
  for (const field of Object.keys(api))
    expect(() => loadApiEnvironment({ ...api, [field]: "" })).toThrow();
  for (const chain of ["-1", "1.5", "0", "Infinity", "9007199254740992"])
    expect(() => loadApiEnvironment({ ...api, ROBINHOOD_CHAIN_ID: chain })).toThrow();
  for (const field of ["API_AUTH_ORIGIN", "INDEXER_URL", "SETTLEMENT_WORKER_URL"])
    expect(() => loadApiEnvironment({ ...api, [field]: "file:///bad" })).toThrow("HTTP(S)");
  expect(() => loadApiEnvironment({ ...api, API_RELAYER_PRIVATE_KEY: "0x12" })).toThrow("32 bytes");
  expect(() => loadApiEnvironment({ ...api, ROBINHOOD_CHAIN_ID: "4663" })).toThrow(
    "INTERNAL_TESTER",
  );
  const production = loadApiEnvironment({
    ...api,
    ROBINHOOD_CHAIN_ID: "4663",
    INTERNAL_TESTER_ADDRESSES: `${maker}, ${other},`,
    API_RELAYER_PRIVATE_KEY: `0x${"01".repeat(32)}`,
    API_AUTH_ORIGIN: "https://probabl.test",
    API_AUTH_DOMAIN: "probabl.test",
    INDEXER_URL: "https://indexer.probabl.test",
    SETTLEMENT_WORKER_URL: "https://worker.probabl.test",
  });
  expect(production.internalTesters?.size).toBe(2);
  expect(production.authDomain).toBe("probabl.test");
});

test("admin evidence configuration is opt-in and requires distinct operators and public HTTPS downloads", () => {
  expect(loadAdminEvidenceEnvironment({})).toBeNull();
  const base = {
    ADMIN_OPERATOR_ADDRESSES: `${maker},${other}`,
    POLYMARKET_INTERNAL_TOKEN: "local-fixture-token",
    ADMIN_EVIDENCE_PUBLIC_BASE_URL: "https://api.probabl.test/v1/attachments/",
    MARKET_ADMIN_SAFE_ADDRESS: maker,
    RESOLUTION_ADMIN_SAFE_ADDRESS: other,
    RESOLUTION_CONTROLLER_ADDRESS: maker,
  };
  const result = loadAdminEvidenceEnvironment(base);
  expect(result?.operators.size).toBe(2);
  expect(result?.attachmentPublicBaseUrl).toBe("https://api.probabl.test/v1/attachments");
  for (const overrides of [
    { ADMIN_OPERATOR_ADDRESSES: maker },
    { ADMIN_OPERATOR_ADDRESSES: `${maker},${maker}` },
    { ADMIN_OPERATOR_ADDRESSES: `${maker},bad` },
    { POLYMARKET_INTERNAL_TOKEN: "short" },
    { POLYMARKET_INGESTOR_URL: "file:///bad" },
    { ADMIN_EVIDENCE_PUBLIC_BASE_URL: "http://api.probabl.test" },
    { ADMIN_EVIDENCE_PUBLIC_BASE_URL: "" },
    { MARKET_ADMIN_SAFE_ADDRESS: "bad" },
    { RESOLUTION_ADMIN_SAFE_ADDRESS: "" },
    { RESOLUTION_CONTROLLER_ADDRESS: "bad" },
  ])
    expect(() => loadAdminEvidenceEnvironment({ ...base, ...overrides })).toThrow();
  expect(
    loadAdminEvidenceEnvironment({ ...base, POLYMARKET_INGESTOR_URL: "https://feed.probabl.test/" })
      ?.polymarketIngestorUrl,
  ).toBe("https://feed.probabl.test");
});
