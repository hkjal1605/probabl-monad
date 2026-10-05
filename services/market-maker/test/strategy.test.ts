import { describe, expect, test } from "bun:test";
import { quote } from "@conditional-stocks/evm-client";
import type { MarketState, OrderState } from "@conditional-stocks/evm-client/ledger";
import { type Address, getAddress } from "viem";
import { decimal, PROB, settings } from "../src/config.ts";
import { quoteChange } from "../src/engine.ts";
import { reference } from "../src/feeds.ts";
import { equity, fairPrices, quotes } from "../src/strategy.ts";

const BASE = getAddress("0x00000000000000000000000000000000000000b1");
const QUOTE = getAddress("0x00000000000000000000000000000000000000a1");
const CONDITION = `0x${"ab".repeat(32)}` as const;
export const market = {
  id: 1,
  base: BASE,
  condition: CONDITION,
  yesIndex: 1,
  noIndex: 2,
  tick: 10_000n,
  step: 10n ** 15n,
  maxSteps: 1_000_000n,
  minNotional: 1_000_000n,
  maxOrder: 10n ** 11n,
  maxWallet: 10n ** 12n,
  maxMarket: 10n ** 13n,
  makerBps: 10,
  takerBps: 30,
  rebateBps: 0,
  state: 2,
  seq: [0n, 0n],
} as unknown as MarketState;
const policy = {
  market: 1,
  base: BASE,
  baseInventory: "10",
  quoteInventory: "10000",
  orderQuote: "2000",
  gapBps: 200,
  basePriceMultiplier: "1",
  quotePriceMultiplier: "1",
};
const s = settings({ markets: [policy], quoteLevels: 2 });
const SPOT = 100_000_000n; // $100 per token: 100e6 quote raw per 1e18 base raw, x1e18.

export function polymarket(now: number, midpoint = 600_000n) {
  return {
    metadata: {
      normalized: {
        conditionId: CONDITION,
        active: true,
        closed: false,
        outcomes: [
          { label: "YES", tokenId: "11", indexSet: "1" },
          { label: "NO", tokenId: "22", indexSet: "2" },
        ],
      },
    },
    probability: {
      conditionId: CONDITION,
      yesTokenId: "11",
      schemaVersion: 1,
      quality: "valid",
      isStale: false,
      midpointX6: String(midpoint),
      bestBidX6: String(midpoint - 5_000n),
      bestAskX6: String(midpoint + 5_000n),
      spreadX6: "10000",
      standardNotionalX6: "1000000",
      bidDepthQuoteX6: "5000000",
      askDepthQuoteX6: "5000000",
      observedAtMs: String(now),
    },
  };
}
export function spot(chainId: number, quoteToken: Address, base: Address, now: number, share = 50) {
  const price = (token: Address, priceUsd: number, kind: string) => ({
    token,
    symbol: null,
    source: null,
    kind,
    status: "available",
    priceUsd,
    priceTimestamp: Math.floor(now / 1000),
    fetchedAt: Math.floor(now / 1000),
    valuationCompatible: kind !== "stock",
  });
  return {
    source: "robinhood",
    displayOnly: true,
    chainId,
    asOf: Math.floor(now / 1000),
    prices: [price(quoteToken, 1, "stablecoin"), price(base, share, "stock")],
  };
}

describe("pricing", () => {
  test("conditional fair prices straddle spot by the gap", () => {
    const [yes, no] = fairPrices(SPOT, 600_000n, 200);
    expect(yes).toBe(SPOT + (400_000n * 2_000_000n) / PROB);
    expect(no).toBe(SPOT - (600_000n * 2_000_000n) / PROB);
    // The probability-weighted branch prices return spot.
    expect((yes * 600_000n + no * 400_000n) / PROB).toBe(SPOT);
  });

  test("reference applies the issuer multiplier and token units", () => {
    const now = Date.now();
    const units = {
      chainId: 31337,
      quote: QUOTE,
      quoteDecimals: 6,
      baseDecimals: 18,
      multiplier: 2n * 10n ** 18n,
    };
    // $50 per share, 2 shares per token: $100 per token.
    const r = reference(
      polymarket(now),
      spot(31337, QUOTE, BASE, now),
      market,
      policy,
      s,
      units,
      now,
    );
    expect(r.spot).toBe(SPOT);
    expect(r.probability).toBe(600_000n);
    expect(() =>
      reference(polymarket(now), spot(1, QUOTE, BASE, now), market, policy, s, units, now),
    ).toThrow("identity");
    const stale = polymarket(now - 60_000);
    expect(() =>
      reference(stale, spot(31337, QUOTE, BASE, now), market, policy, s, units, now),
    ).toThrow("Stale");
    const flipped = polymarket(now);
    flipped.metadata.normalized.outcomes[0]!.indexSet = "2";
    expect(() =>
      reference(flipped, spot(31337, QUOTE, BASE, now), market, policy, s, units, now),
    ).toThrow("mapping");
  });

  test("ladders are passive, fully funded and within market terms", () => {
    const inventory = {
      quote: [10_000n * 10n ** 6n, 10_000n * 10n ** 6n],
      base: [10n ** 19n, 10n ** 19n],
    } as {
      quote: [bigint, bigint];
      base: [bigint, bigint];
    };
    const now = Date.now();
    const r = {
      spot: SPOT,
      probability: 600_000n,
      spread: 10_000n,
      observedAt: now,
      spotAt: now,
      probabilityAt: now,
    };
    const out = quotes({
      market,
      reference: r,
      gapBps: 200,
      inventory,
      targetBase: 10n ** 19n,
      orderQuote: 2_000n * 10n ** 6n,
      movementBps: 0n,
      settings: s,
      best: [{}, { bid: 97_000_000n }],
    });
    const fair = fairPrices(SPOT, 600_000n, 200);
    expect(out).toHaveLength(8);
    for (const q of out) {
      expect(q.price % market.tick).toBe(0n);
      expect(q.quantity % market.step).toBe(0n);
      expect(q.side === 0 ? q.price < fair[q.branch] : q.price > fair[q.branch]).toBe(true);
      expect(quote(q.quantity, q.price, true)).toBeLessThanOrEqual(market.maxOrder);
      expect(quote(q.quantity, q.price)).toBeGreaterThanOrEqual(market.minNotional);
    }
    for (const branch of [0, 1])
      for (const side of [0, 1]) {
        const ladder = out.filter((q) => q.branch === branch && q.side === side);
        const reserved = ladder.reduce(
          (sum, q) => sum + (side === 0 ? quote(q.quantity, q.price, true) : q.quantity),
          0n,
        );
        expect(reserved).toBeLessThanOrEqual(
          side === 0 ? inventory.quote[branch]! : inventory.base[branch]!,
        );
      }
    // Held inventory marks at fair value.
    expect(equity({ quote: [0n, 0n], base: [10n ** 18n, 10n ** 18n] }, r, 200)).toBe(
      (quote(10n ** 18n, fair[0]) * 600_000n + quote(10n ** 18n, fair[1]) * 400_000n) / PROB,
    );
  });

  test("each market's own maker fee and rebate set the fee edge of its quotes", () => {
    const now = Date.now();
    const ladder = (makerBps: number, takerBps = 30, rebateBps = 0) =>
      quotes({
        market: { ...market, makerBps, takerBps, rebateBps } as MarketState,
        reference: {
          spot: SPOT,
          probability: 600_000n,
          spread: 10_000n,
          observedAt: now,
          spotAt: now,
          probabilityAt: now,
        },
        gapBps: 200,
        inventory: {
          quote: [10_000n * 10n ** 6n, 10_000n * 10n ** 6n],
          base: [10n ** 19n, 10n ** 19n],
        },
        targetBase: 10n ** 19n,
        orderQuote: 2_000n * 10n ** 6n,
        movementBps: 0n,
        settings: s,
        best: [{}, {}],
      });
    const best = (out: ReturnType<typeof ladder>, side: 0 | 1) =>
      out.filter((q) => q.branch === 0 && q.side === side && q.level === 0).map((q) => q.price)[0]!;
    const [cheap, dear] = [ladder(10), ladder(100)];
    // 10 bps stays under the 60 bps spread floor; 100 bps (a 102 bps edge) widens both sides.
    expect(best(dear, 0)).toBeLessThan(best(cheap, 0));
    expect(best(dear, 1)).toBeGreaterThan(best(cheap, 1));
    expect(() => ladder(1_001)).toThrow("Invalid quote inputs");
    // A rebate comes back on every fill: a quarter of a 1% taker fee narrows both sides...
    const [none, quarter] = [ladder(100, 100), ladder(100, 100, 2_500)];
    expect(best(quarter, 0)).toBeGreaterThan(best(none, 0));
    expect(best(quarter, 1)).toBeLessThan(best(none, 1));
    // ...and half of a 3% taker fee outweighs the 1% maker fee, but never passes the spread floor.
    const [generous, free] = [ladder(100, 300, 5_000), ladder(0, 0)];
    expect([best(generous, 0), best(generous, 1)]).toEqual([best(free, 0), best(free, 1)]);
    expect(() => ladder(10, 30, 5_001)).toThrow("Invalid quote inputs");
  });

  test("requotes replace stale levels and cancel foreign-shaped orders", () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const target = {
      branch: 0 as const,
      side: 0 as const,
      level: 0,
      price: 99_000_000n,
      quantity: 10n ** 18n,
    };
    const order = (o: Partial<OrderState>) =>
      ({
        key: "1",
        branch: 0,
        side: 0,
        fundingKind: 1,
        tif: 0,
        delegate: null,
        maxFeeBps: 10,
        epoch: 0n,
        ticks: 9_900n,
        remaining: 10n ** 18n,
        expiry: now + 3600n,
        ...o,
      }) as OrderState;
    const live = { makerBps: 10, epoch: 0n, tick: 10_000n };
    expect(quoteChange([order({})], [target], now, s, live)).toBeUndefined();
    expect(quoteChange([], [target], now, s, live)).toEqual({ quote: target });
    expect(quoteChange([order({ ticks: 9_800n })], [target], now, s, live)).toEqual({
      cancel: "1",
      quote: target,
    });
    expect(quoteChange([order({ fundingKind: 0 })], [target], now, s, live)).toEqual({
      cancel: "1",
    });
    expect(quoteChange([order({})], [], now, s, live)).toEqual({ cancel: "1" });
    expect(quoteChange([order({ maxFeeBps: 5 })], [target], now, s, live)).toEqual({
      cancel: "1",
      quote: target,
    });
  });

  test("configuration rejects unsafe allocations", () => {
    expect(() => settings({ markets: [{ ...policy, orderQuote: "5000" }] })).toThrow("25%");
    expect(() => settings({ markets: [{ ...policy, baseInventory: "0" }] })).toThrow("targetBase");
    expect(() => settings({ markets: [policy, policy] })).toThrow("Duplicate");
    expect(decimal("1.5e-3", 6)).toBe(1_500n);
  });
});
