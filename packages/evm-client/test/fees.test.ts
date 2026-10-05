import { describe, expect, test } from "bun:test";
import type { CreationEvidencePacket } from "@conditional-stocks/market-data";
import { type Address, decodeFunctionData, type Hex } from "viem";
import { conditionalStocksAbi } from "../src/abi.ts";
import { creationParams } from "../src/admin.ts";
import { type Candidate, planOrder } from "../src/planner.ts";
import {
  formatBps,
  isFeeRate,
  isRebateRate,
  MAX_REBATE_BPS,
  makerFeeEdge,
  makerRebate,
  type OrderWire,
  orderFeeCap,
} from "../src/protocol.ts";
import { setMakerRebate } from "../src/transactions.ts";

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

describe("maker rebates", () => {
  test("are whole bps of the taker fee, up to half of it", () => {
    expect(MAX_REBATE_BPS).toBe(5_000);
    for (const rate of [0, 1, 2_500, 5_000]) expect(isRebateRate(rate)).toBe(true);
    for (const rate of [-1, 5_001, 10_000, 0.5, Number.NaN, "100", null])
      expect(isRebateRate(rate)).toBe(false);
  });

  test("pay the maker its share of the taker fee, rounded down as the exchange rounds", () => {
    expect(makerRebate(3_000_000_000_000_000n, 5_000)).toBe(1_500_000_000_000_000n);
    expect(makerRebate(105_007n, 3_333)).toBe(34_998n); // 34,998.83: the rest stays with the protocol
    expect(makerRebate(105_007n, 5_000)).toBe(52_503n);
    expect(makerRebate(1n, 5_000)).toBe(0n);
    expect(makerRebate(105_007n, 0)).toBe(0n);
  });

  test("narrow a maker's break-even edge by what comes back on each fill", () => {
    // Without a rebate: the maker fee grossed up, rounded up (10 bps needs 11).
    for (const makerBps of [0, 1, 10, 25, 999, 1_000])
      expect(makerFeeEdge({ makerBps, takerBps: 30, rebateBps: 0 })).toBe(
        (BigInt(makerBps) * 10_000n + 9_999n - BigInt(makerBps)) / (10_000n - BigInt(makerBps)),
      );
    expect(makerFeeEdge({ makerBps: 10, takerBps: 30, rebateBps: 2_500 })).toBe(3n); // 2.5
    expect(makerFeeEdge({ makerBps: 10, takerBps: 30, rebateBps: 5_000 })).toBe(-5n); // -5.005
    // Half of a 10% taker fee returns 5% of each fill.
    expect(makerFeeEdge({ makerBps: 0, takerBps: 1_000, rebateBps: 5_000 })).toBe(-500n);
    // At that edge both sides break even: an ask at F(1 + e) nets at least F after its maker fee
    // and rebate, and a bid at F(1 - e) pays at most F (exact rationals, scaled by 1e8).
    const F = 10n ** 8n;
    for (const makerBps of [0, 3, 10, 150, 1_000])
      for (const takerBps of [0, 7, 30, 1_000])
        for (const rebateBps of [0, 1, 2_500, 3_333, 5_000]) {
          const e = makerFeeEdge({ makerBps, takerBps, rebateBps });
          const m = BigInt(makerBps) * 10_000n,
            r = BigInt(takerBps) * BigInt(rebateBps);
          const ask = F * (10_000n + e),
            bid = F * (10_000n - e);
          // ask (1 - m) / (1 - r) >= F and bid (1 - r) / (1 - m) <= F, in units of 1e8.
          expect(ask * (100_000_000n - m) >= F * 10_000n * (100_000_000n - r)).toBe(true);
          expect(bid * (100_000_000n - r) <= F * 10_000n * (100_000_000n - m)).toBe(true);
        }
  });

  test("are set by a validated setMakerRebate call", () => {
    const exchange = "0x00000000000000000000000000000000000000e1" as Address;
    const envelope = setMakerRebate(exchange, 7, 2_500);
    expect(envelope.to).toBe(exchange);
    const call = decodeFunctionData({ abi: conditionalStocksAbi, data: envelope.data as Hex });
    expect(call.functionName).toBe("setMakerRebate");
    expect(call.args).toEqual([7, 2_500]);
    for (const rate of [5_001, -1, 1.5]) expect(() => setMakerRebate(exchange, 7, rate)).toThrow();
  });
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
