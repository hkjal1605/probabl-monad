import { expect, test } from "bun:test";
import { getAddress } from "viem";
import { marketModel, settings } from "../src/config.ts";

const A = "0x00000000000000000000000000000000000000a1",
  B = "0x00000000000000000000000000000000000000b1",
  K1 = "0x00000000000000000000000000000000000000c1",
  K2 = "0x00000000000000000000000000000000000000c2";
const model = { anchorBps: 0, impactBps: 25, maxGapBps: 1000, orderQuote: "100" };
const overrides = (s: ReturnType<typeof settings>, i = 0) =>
  new Map((s.vaults[i]?.markets ?? []).map((m) => [m.market, m]));

test("the legacy single-vault form quotes only the markets it lists", () => {
  const s = settings({
    vault: A,
    markets: [{ market: 1, anchorBps: 300, impactBps: 50, maxGapBps: 800, orderQuote: "5000" }],
  });
  expect(s.vaults.map((v) => v.vault)).toEqual([getAddress(A)]);
  expect(marketModel(s.model, overrides(s).get(1))?.anchorBps).toBe(300);
  expect(marketModel(s.model, overrides(s).get(2))).toBeUndefined();
});

test("with a default model every registered market is quoted; overrides merge or disable", () => {
  const s = settings({
    vaults: [
      {
        vault: A,
        keeper: K1,
        markets: [
          { market: 2, anchorBps: -500 },
          { market: 3, disabled: true },
        ],
      },
      { vault: B, keeper: K2 },
    ],
    model,
  });
  expect(marketModel(s.model, overrides(s).get(7))).toEqual(model);
  expect(marketModel(s.model, overrides(s).get(2))).toEqual({ ...model, anchorBps: -500 });
  expect(marketModel(s.model, overrides(s).get(3))).toBeUndefined();
  expect(marketModel(s.model, overrides(s, 1).get(2))).toEqual(model);
});

test("rejects shared keeper wallets, repeated vaults, incomplete overrides and unsafe models", () => {
  expect(() =>
    settings({
      vaults: [
        { vault: A, keeper: K1 },
        { vault: B, keeper: K1 },
      ],
      model,
    }),
  ).toThrow("own keeper wallet");
  expect(() => settings({ vaults: [{ vault: A }, { vault: A }], model })).toThrow("twice");
  expect(() =>
    settings({ vaults: [{ vault: A, markets: [{ market: 1, anchorBps: 5 }] }] }),
  ).toThrow("complete model");
  expect(() => settings({ vaults: [{ vault: A }], model: { ...model, anchorBps: 2000 } })).toThrow(
    "default model",
  );
  expect(() => settings({ vaults: [] })).toThrow("vaults");
});
