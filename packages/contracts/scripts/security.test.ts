import { describe, expect, test } from "bun:test";
import { keccak256 } from "viem";
import { validateMarketCaps } from "../../domain/src/market-config.ts";
import { loadArtifact, loadConditionalTokensArtifact } from "./lib.ts";
import { assertDevelopmentChain, assertRuntime, CTF_RUNTIME_HASH } from "./security.ts";

describe("deployment and market security gates", () => {
  test("production and arbitrary networks are blocked without an environment override", () => {
    expect(() => assertDevelopmentChain(31337, {})).not.toThrow();
    expect(() => assertDevelopmentChain(46630, {})).not.toThrow();
    for (const id of [4663, 1, 137, 0, -1, 12345]) {
      expect(() => assertDevelopmentChain(id, {})).toThrow("M-02");
    }
  });
  test("pinned artifact identity is exact and unrelated runtimes are rejected", async () => {
    const artifact = await loadConditionalTokensArtifact();
    expect(assertRuntime(artifact.deployedBytecode, CTF_RUNTIME_HASH, "CTF")).toBe(
      CTF_RUNTIME_HASH,
    );
    for (const code of [
      undefined,
      "0x",
      "0x60006000",
      `0xff${artifact.deployedBytecode.slice(4)}`,
    ] as const) {
      expect(() => assertRuntime(code, CTF_RUNTIME_HASH, "CTF")).toThrow("reviewed bytecode");
    }
    const registry = await loadArtifact("MarketRegistry");
    expect(keccak256(registry.deployedBytecode.object)).not.toBe(CTF_RUNTIME_HASH);
  });
  test("CLI rejects both audited infeasible-cap configurations", () => {
    const config = {
      baseStep: 10n ** 18n,
      priceTickRawX18: 10n ** 18n,
      minNotional: 100n * 10n ** 18n,
      maxOrderQuantity: 10n ** 18n,
      maxOrderNotional: 100n * 10n ** 18n,
      maxWalletOpenNotional: 100n * 10n ** 18n,
      maxMarketOpenNotional: 100n * 10n ** 18n,
    };
    expect(() => validateMarketCaps(config)).toThrow("two aligned");
    expect(() =>
      validateMarketCaps({
        ...config,
        minNotional: 1n,
        priceTickRawX18: 101n * 10n ** 18n,
        maxMarketOpenNotional: 200n * 10n ** 18n,
      }),
    ).toThrow("two aligned");
    expect(validateMarketCaps({ ...config, maxMarketOpenNotional: 200n * 10n ** 18n })).toEqual({
      quantity: 10n ** 18n,
      priceRawX18: 100n * 10n ** 18n,
      notional: 100n * 10n ** 18n,
    });
  });
});
