import { describe, expect, test } from "bun:test";
import { quote } from "@conditional-stocks/evm-client";
import { BPS, PROB } from "@conditional-stocks/operator";
import {
  conditionalGap,
  fairPrices,
  halfSpread,
  impliedProbability,
  ladders,
  markedValue,
  type Quote,
  widening,
} from "../src/model.ts";

const NVDA = 10n ** 18n;
const SPOT = 100_000_000n; // $100 per 18-decimal token in USDC raw units x1e18.
const terms = {
  tick: 10_000n,
  step: 10n ** 15n,
  maxSteps: 1_000_000n,
  minNotional: 1_000_000n,
  maxOrder: 10n ** 11n,
};
const base = {
  terms,
  levels: 3,
  levelSpacingBps: 25,
  maxHalfSpreadBps: 1500,
  oracle: SPOT,
  bandBps: 1000,
  bandMarginBps: 50,
  budget: 5_000n * 10n ** 6n,
  maxOrder: 50_000n * 10n ** 6n,
  maxResting: 200_000n * 10n ** 6n,
  imbalance: 0n,
  maxImbalance: 200n * NVDA,
  funds: {
    quote: 100_000n * 10n ** 6n,
    base: 1000n * NVDA,
    quoteClaims: [0n, 0n] as [bigint, bigint],
    baseClaims: [0n, 0n] as [bigint, bigint],
  },
  best: [{}, {}] as [{ bid?: bigint; ask?: bigint }, { bid?: bigint; ask?: bigint }],
};

/** Worst-case YES-minus-NO stock if every quote filled, from `imbalance`. */
function extremes(quotes: Quote[], imbalance: bigint) {
  let high = imbalance,
    low = imbalance;
  for (const q of quotes)
    if ((q.side === 0) === (q.branch === 0)) high += q.quantity;
    else low -= q.quantity;
  return { high, low };
}

describe("the conditional gap", () => {
  test("moves against the vault's imbalance and ignores the vault's size", () => {
    const gap = (imbalance: bigint, inventory: bigint) =>
      conditionalGap({
        anchorBps: 300,
        impactBps: 10,
        maxGapBps: 800,
        imbalance,
        inventory,
        widen: BPS,
      });
    expect(gap(0n, 1000n * NVDA)).toBe(30_000n);
    // Traders bought 1% of inventory as stock-if-YES: δ̂ rises 10 bps (1,000 ppm).
    expect(gap(-10n * NVDA, 1000n * NVDA)).toBe(31_000n);
    expect(gap(10n * NVDA, 1000n * NVDA)).toBe(29_000n);
    // A deposit scaling both leaves δ̂ unchanged.
    expect(gap(-20n * NVDA, 2000n * NVDA)).toBe(31_000n);
    expect(gap(1000n * NVDA, 1000n * NVDA)).toBe(-70_000n);
    // Bounded by maxGapBps.
    expect(gap(-1000n * NVDA, 1000n * NVDA)).toBe(80_000n);
    expect(gap(2000n * NVDA, 1000n * NVDA)).toBe(-80_000n);
  });

  test("near cutoff the same flow moves δ̂ further", () => {
    expect(widening(86_400n, 86_400, 3)).toBe(BPS);
    expect(widening(43_200n, 86_400, 3)).toBe(20_000n);
    expect(widening(0n, 86_400, 3)).toBe(30_000n);
    expect(widening(-5n, 86_400, 3)).toBe(30_000n);
    expect(
      conditionalGap({
        anchorBps: 0,
        impactBps: 10,
        maxGapBps: 800,
        imbalance: -10n * NVDA,
        inventory: 1000n * NVDA,
        widen: 30_000n,
      }),
    ).toBe(3000n);
  });
});

describe("fair prices", () => {
  test("branch prices average back to spot at the probability (the doc's example)", () => {
    // s = $100, p = 0.4, Δ = $5 (500 bps): Y = $103, N = $98.
    const [yes, no] = fairPrices(SPOT, 400_000n, 50_000n);
    expect(yes).toBe(103_000_000n);
    expect(no).toBe(98_000_000n);
    expect((yes * 400_000n + no * 600_000n) / PROB).toBe(SPOT);
    expect(() => fairPrices(SPOT, 0n, 0n)).toThrow();
    expect(() => fairPrices(SPOT, PROB, 0n)).toThrow();
  });

  test("a trade at fair branch prices changes no marked value: the vault is event neutral", () => {
    const vault = { quote: 100_000n * 10n ** 6n, base: 1000n * NVDA, markets: [] };
    const marks = () => ({ probability: 400_000n, gapPpm: 50_000n });
    const before = markedValue(
      {
        ...vault,
        markets: [{ market: 1, claims: { yesQuote: 0n, noQuote: 0n, yesBase: 0n, noBase: 0n } }],
      },
      SPOT,
      marks,
    );
    // Alice buys 100 NVDA-if-YES at $103 from plain stock: the vault keeps 100 NVDA-if-NO and
    // receives 10,300 USDC-if-YES.
    const after = markedValue(
      {
        quote: vault.quote,
        base: vault.base - 100n * NVDA,
        markets: [
          {
            market: 1,
            claims: {
              yesQuote: 10_300n * 10n ** 6n,
              noQuote: 0n,
              yesBase: 0n,
              noBase: 100n * NVDA,
            },
          },
        ],
      },
      SPOT,
      marks,
    );
    expect(after).toBe(before);
  });
});

describe("book-implied probability", () => {
  test("other traders' branch mids imply p through s = p·Y + (1−p)·N", () => {
    const book = (yes: [bigint, bigint], no: [bigint, bigint]) =>
      [
        { bid: yes[0], ask: yes[1] },
        { bid: no[0], ask: no[1] },
      ] as [{ bid?: bigint; ask?: bigint }, { bid?: bigint; ask?: bigint }];
    // Y = $103, N = $98 around $100: p = 2 / 5.
    expect(
      impliedProbability(book([102_900_000n, 103_100_000n], [97_900_000n, 98_100_000n]), SPOT),
    ).toBe(400_000n);
    // One-sided, inverted or too-close books say nothing.
    expect(impliedProbability([{ bid: 1n }, { bid: 1n, ask: 2n }], SPOT)).toBeNull();
    expect(impliedProbability(book([2n, 1n], [1n, 2n]), SPOT)).toBeNull();
    expect(
      impliedProbability(book([100_100_000n, 100_200_000n], [99_900_000n, 100_000_000n]), SPOT),
    ).toBeNull();
    // A book inconsistent with spot clamps to certainty.
    expect(
      impliedProbability(book([110_000_000n, 110_200_000n], [104_000_000n, 104_200_000n]), SPOT),
    ).toBe(0n);
  });
});

describe("spreads", () => {
  test("cover fees, adverse selection, movement and probability uncertainty", () => {
    const h = (over: Partial<Parameters<typeof halfSpread>[0]> = {}) =>
      halfSpread({
        minBps: 40,
        makerBps: 0,
        adverseSelectionBps: 20,
        movementBps: 0n,
        probabilitySpread: 10_000n,
        gapPpm: 0n,
        widen: BPS,
        ...over,
      });
    expect(h()).toBe(40n);
    // A seller receives quote net of the fee: 10 bps needs an 11 bps edge.
    expect(h({ makerBps: 10, movementBps: 15n })).toBe(11n + 20n + 30n);
    // A 1% probability spread with δ̂ = 5% adds 5 bps.
    expect(h({ minBps: 1, gapPpm: 50_000n })).toBe(25n);
    expect(h({ widen: 25_000n })).toBe(100n);
  });
});

describe("ladders", () => {
  const fair = fairPrices(SPOT, 400_000n, 30_000n);

  test("are passive, inside the band, funded and within every limit", () => {
    const quotes = ladders({ ...base, fair, halfSpread: 40n });
    expect(quotes.length).toBe(12);
    for (const q of quotes) {
      expect(q.price % terms.tick).toBe(0n);
      expect(q.quantity % terms.step).toBe(0n);
      expect(quote(q.quantity, q.price, true) <= base.budget).toBe(true);
      expect(quote(q.quantity, q.price) >= terms.minNotional).toBe(true);
      const distance = q.price > SPOT ? q.price - SPOT : SPOT - q.price;
      expect(distance * BPS <= SPOT * 950n).toBe(true);
      if (q.side === 0) expect(q.price < fair[q.branch]).toBe(true);
      else expect(q.price > fair[q.branch]).toBe(true);
      expect(q.funding).toBe(0);
    }
    const { high, low } = extremes(quotes, 0n);
    expect(high <= base.maxImbalance && -low <= base.maxImbalance).toBe(true);
    const resting = quotes.reduce((sum, q) => sum + quote(q.quantity, q.price, true), 0n);
    expect(resting <= base.maxResting).toBe(true);
  });

  test("never cross foreign orders and skip levels outside the band", () => {
    const [yes] = fair;
    const quotes = ladders({
      ...base,
      fair,
      halfSpread: 40n,
      // A foreign ask below every YES bid and a foreign bid above every YES ask.
      best: [{ ask: (yes * 95n) / 100n, bid: (yes * 105n) / 100n }, {}],
    });
    expect(quotes.filter((q) => q.branch === 0).length).toBe(0);
    const tight = ladders({ ...base, fair, halfSpread: 40n, bandBps: 250 });
    for (const q of tight) {
      const distance = q.price > SPOT ? q.price - SPOT : SPOT - q.price;
      expect(distance * BPS <= SPOT * 200n).toBe(true);
    }
  });

  test("spend claims first, which nets the vault's unpaired positions", () => {
    const quotes = ladders({
      ...base,
      fair,
      halfSpread: 40n,
      levels: 1,
      funds: { ...base.funds, baseClaims: [0n, 100n * NVDA] },
    });
    const noAsk = quotes.find((q) => q.branch === 1 && q.side === 1)!;
    expect(noAsk.funding).toBe(1);
    expect(
      quotes.filter((q) => !(q.branch === 1 && q.side === 1)).every((q) => q.funding === 0),
    ).toBe(true);
  });

  test("beyond the imbalance cap only reducing quotes remain", () => {
    const quotes = ladders({ ...base, fair, halfSpread: 40n, imbalance: 250n * NVDA });
    expect(quotes.some((q) => (q.side === 0) === (q.branch === 0))).toBe(false);
    expect(quotes.length > 0).toBe(true);
    const { low } = extremes(quotes, 250n * NVDA);
    expect(low >= -base.maxImbalance).toBe(true);
  });

  test("random inputs never break a limit", () => {
    let seed = 42n;
    const next = (bound: bigint) => {
      seed = (seed * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) % 2n ** 64n;
      return seed % bound;
    };
    for (let i = 0; i < 300; i++) {
      const spot = 20_000_000n + next(300_000_000n);
      const p = 20_000n + next(960_000n);
      const gap = next(160_000n) - 80_000n;
      const imbalance = next(600n * NVDA) - 300n * NVDA;
      const maxImbalance = 1n + next(400n * NVDA);
      const maxResting = 1_000_000n + next(300_000n * 10n ** 6n);
      const f = fairPrices(spot, p, gap);
      const quotes = ladders({
        ...base,
        fair: f,
        oracle: spot,
        halfSpread: 1n + next(300n),
        imbalance,
        maxImbalance,
        maxResting,
        maxOrder: maxResting,
        budget: next(50_000n * 10n ** 6n),
        funds: {
          quote: next(100_000n * 10n ** 6n),
          base: next(1000n * NVDA),
          quoteClaims: [next(10_000n * 10n ** 6n), next(10_000n * 10n ** 6n)],
          baseClaims: [next(100n * NVDA), next(100n * NVDA)],
        },
      });
      const { high, low } = extremes(quotes, imbalance);
      expect(high <= (imbalance > maxImbalance ? imbalance : maxImbalance)).toBe(true);
      expect(low >= (imbalance < -maxImbalance ? imbalance : -maxImbalance)).toBe(true);
      const resting = quotes.reduce((sum, q) => sum + quote(q.quantity, q.price, true), 0n);
      expect(resting <= maxResting).toBe(true);
      for (const branch of [0, 1]) {
        const bids = quotes.filter((q) => q.branch === branch && q.side === 0).map((q) => q.price);
        const asks = quotes.filter((q) => q.branch === branch && q.side === 1).map((q) => q.price);
        if (bids.length && asks.length)
          expect(
            bids.reduce((a, b) => (a > b ? a : b)) < asks.reduce((a, b) => (a < b ? a : b)),
          ).toBe(true);
      }
      for (const q of quotes) {
        const distance = q.price > spot ? q.price - spot : spot - q.price;
        expect(distance * BPS <= spot * 950n).toBe(true);
      }
    }
  });
});
