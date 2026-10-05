import { describe, expect, test } from "bun:test";
import type { CreationEvidencePacket } from "@conditional-stocks/market-data";
import type { Address } from "viem";
import { creationParams } from "../src/admin.ts";
import { type Candidate, planOrder } from "../src/planner.ts";
import { formatBps, isFeeRate, type OrderWire, orderFeeCap } from "../src/protocol.ts";

const TICK = 10_000n;
const STEP = 10n ** 15n;
const NVDA = 10n ** 18n;
const NOW = 1_800_000_000n;
const taker = "0x00000000000000000000000000000000000000a1" as Address;
const maker = "0x00000000000000000000000000000000000000b1" as Address;

const order = (o: Partial<OrderWire> = {}): OrderWire => ({
  maker: taker,
  marketId: "1",
  quantity: (2n * NVDA).toString(),
  limitPriceRawX18: (20_000n * TICK).toString(),
  expiry: (NOW + 3_600n).toString(),
  maxFeeBps: 1_000,
  branch: 0,
  side: 0,
  fundingKind: 0,
  tif: 0,
  ...o,
});
/** A resting ask of one share at the taker's limit. */
const ask = (maxFeeBps: number, sequence = 0n): Candidate => ({
  key: ((1n << 40n) | sequence).toString(),
  sequence,
  remaining: NVDA,
  order: order({ maker, side: 1, quantity: NVDA.toString(), maxFeeBps }),
});
const plan = (o: OrderWire, candidates: Candidate[], makerFeeBps: number, takerFeeBps: number) =>
  planOrder({
    order: o,
    candidates,
    now: NOW,
    step: STEP,
    nextSequence: 2n,
    makerFeeBps,
    takerFeeBps,
  });

describe("market fee rates", () => {
  test("are whole bps up to the exchange's 1,000 bps cap", () => {
    for (const rate of [0, 1, 999, 1_000]) expect(isFeeRate(rate)).toBe(true);
    for (const rate of [-1, 1_001, 2.5, Number.NaN, "10", null, undefined])
      expect(isFeeRate(rate)).toBe(false);
    expect([0, 1, 25, 100, 1_000].map(formatBps)).toEqual(["0%", "0.01%", "0.25%", "1%", "10%"]);
  });

  test("an order consents to exactly the rates that can apply to it", () => {
    const rates = { makerBps: 30, takerBps: 10 };
    expect(orderFeeCap(rates, 1)).toBe(10); // Immediate-or-cancel only takes.
    expect(orderFeeCap(rates, 0)).toBe(30); // A resting remainder may pay the maker rate.
    expect(orderFeeCap({ makerBps: 5, takerBps: 20 }, 0)).toBe(20);
  });

  test("creation evidence becomes the market's createMarket fee rates", () => {
    const config = {
      baseStep: STEP.toString(),
      baseToken: maker,
      makerFeeBps: "12",
      maxMarketOpenNotional: "1000000000000",
      maxOrderNotional: "10000000000",
      maxOrderQuantity: (1_000n * NVDA).toString(),
      maxWalletOpenNotional: "100000000000",
      metadataHash: `0x${"11".repeat(32)}`,
      metadataUri: "ipfs://m",
      minNotional: "1000000",
      polymarketConditionId: `0x${"22".repeat(32)}`,
      polymarketNoIndex: "2",
      polymarketYesIndex: "1",
      priceTickRawX18: TICK.toString(),
      quoteToken: taker,
      rulesHash: `0x${"33".repeat(32)}`,
      takerFeeBps: "34",
      tradingCutoff: "1900000000",
      tradingOpen: "1800000000",
    } as CreationEvidencePacket["config"];
    expect(creationParams(config)).toMatchObject({ makerBps: 12, takerBps: 34 });
    expect(() => creationParams({ ...config, takerFeeBps: "1001" })).toThrow("Fee rates");
  });
});

describe("planning at a market's fee rates", () => {
  test("carries the rates and skips makers capped below the maker rate", () => {
    const p = plan(order({ tif: 1 }), [ask(9, 0n), ask(10, 1n)], 10, 20);
    expect(p).toMatchObject({ makerFeeBps: 10, takerFeeBps: 20 });
    expect(p.sequences).toEqual(["1"]);
  });

  test("refuses a taker capped below the taker rate", () => {
    expect(() => plan(order({ tif: 1, maxFeeBps: 19 }), [ask(1_000)], 10, 20)).toThrow(
      "taker rate",
    );
    // Without a maker to fill, no taker fee can apply.
    expect(plan(order({ tif: 1, maxFeeBps: 19 }), [], 10, 20).makers).toEqual([]);
  });

  test("refuses a resting remainder that the maker rate would leave unfillable", () => {
    expect(() => plan(order({ maxFeeBps: 25 }), [], 30, 20)).toThrow("maker rate");
    expect(() => plan(order({ maxFeeBps: 25 }), [ask(1_000)], 30, 20)).toThrow("maker rate");
    // Nothing rests when the order fills completely, or when it is immediate-or-cancel.
    expect(
      plan(order({ maxFeeBps: 25, quantity: NVDA.toString() }), [ask(1_000)], 30, 20)
        .remainingQuantity,
    ).toBe("0");
    expect(plan(order({ maxFeeBps: 25, tif: 1 }), [ask(1_000)], 30, 20).remainingQuantity).toBe(
      NVDA.toString(),
    );
  });
});
