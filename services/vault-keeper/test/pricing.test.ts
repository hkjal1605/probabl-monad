/** The vault's RFQ price and size: the Δ-model's price for exactly the size quoted, inside every
 * limit the vault enforces on chain. Pure arithmetic; no chain. */
import { describe, expect, test } from "bun:test";
import { quote as notional } from "@conditional-stocks/evm-client";
import { BPS, PROB } from "@conditional-stocks/operator";
import { settings } from "../src/config.ts";
import { fairPrices } from "../src/model.ts";
import { type PricingInput, priceRfq, type RfqOrder, raisesImbalance } from "../src/pricing.ts";

const NVDA = 10n ** 18n;
const USDC = 10n ** 6n;
const SPOT = 100n * USDC; // $100 per share, raw quote per raw base x 1e18.
const NOW = 1_800_000_000n;
const config = settings({
  vault: "0x0000000000000000000000000000000000000001",
  markets: [{ market: 1, anchorBps: 500, impactBps: 50, maxGapBps: 800, orderQuote: "20000" }],
  halfSpreadBps: 30,
  adverseSelectionBps: 10,
  rfq: { enabled: true },
});
const model = { anchorBps: 500, impactBps: 50, maxGapBps: 800, orderQuote: "20000" };

function input(order: Partial<RfqOrder> = {}, extra: Partial<PricingInput> = {}): PricingInput {
  const nowMs = Number(NOW) * 1000;
  return {
    order: { branch: 0, side: 0, quantity: NVDA, limit: 200n * USDC, ...order },
    market: {
      tick: 10_000n,
      step: 10n ** 15n,
      maxSteps: 1_000_000n,
      makerBps: 0,
      takerBps: 0,
      rebateBps: 0,
    },
    risk: { bandBps: 1000, cutoffBuffer: 3600, maxImbalance: 200n * NVDA },
    cutoff: Number(NOW) + 30 * 86_400,
    limits: { maxTtl: 600, maxFeeBps: 100 },
    oracle: SPOT,
    model,
    settings: config,
    reference: {
      spot: SPOT,
      probability: 400_000n,
      spread: 10_000n,
      observedAt: nowMs,
      spotAt: nowMs,
      probabilityAt: nowMs,
    },
    movementBps: 0n,
    position: {
      imbalance: 0n,
      high: 0n,
      low: 0n,
      expected: 0n,
      inventory: 1000n * NVDA,
      funds: {
        quote: 100_000n * USDC,
        base: 1000n * NVDA,
        quoteClaims: [0n, 0n],
        baseClaims: [0n, 0n],
      },
    },
    maxNotional: 20_000n * USDC,
    now: NOW,
    nowMs,
    chainTime: NOW,
    minQuoteSeconds: 3,
    allowStaleSpot: false,
    ...extra,
  };
}
const priced = (i: PricingInput) => {
  const p = priceRfq(i);
  if ("decline" in p) throw new Error(p.decline);
  return p;
};
const declined = (i: PricingInput) => {
  const p = priceRfq(i);
  return "decline" in p ? p.decline : null;
};
const position = (over: Partial<PricingInput["position"]>) => ({ ...input().position, ...over });

describe("the price", () => {
  test("a buyer pays the fair price of its fill's midpoint plus the half-spread, on the tick", () => {
    const p = priced(input());
    // δ₀ 5% (50,000 ppm), p 0.4: Y = 100 x (1 + 0.6 x 5%) = $103 at zero imbalance. Selling one
    // share walks the imbalance from 0 to -1 of 1000 shares; at the midpoint (-0.5) the gap is
    // 50 bps per 1% of inventory higher: 50,000 + 50 x 100 x 0.05 = 50,250 ppm.
    const [yes] = fairPrices(SPOT, 400_000n, 50_250n);
    expect(p.fair).toBe(yes);
    // At least 30 bps above fair (the floor), rounded up to the tick.
    expect(p.price).toBeGreaterThanOrEqual((p.fair * (BPS + 30n)) / BPS);
    expect(p.price % 10_000n).toBe(0n);
    expect(p.price - (p.fair * (BPS + 30n)) / BPS).toBeLessThan(10_000n);
    expect(p).toMatchObject({ quantity: NVDA, fundingKind: 0, expiry: NOW + 10n });
    // A seller gets the midpoint price less the half-spread, rounded down.
    const bid = priced(input({ side: 1, limit: 1n }));
    expect(bid.price).toBeLessThan(bid.fair);
    expect(bid.price % 10_000n).toBe(0n);
  });

  test("a larger order pays its own impact on both branches, and both legs move as one gap", () => {
    for (const branch of [0, 1] as const) {
      const small = priced(input({ branch, quantity: NVDA }));
      const large = priced(input({ branch, quantity: 50n * NVDA }));
      expect(large.price).toBeGreaterThan(small.price);
      const smallBid = priced(input({ branch, side: 1, quantity: NVDA, limit: 1n }));
      const largeBid = priced(input({ branch, side: 1, quantity: 50n * NVDA, limit: 1n }));
      expect(largeBid.price).toBeLessThan(smallBid.price);
    }
    // Buying YES and buying NO push the gap opposite ways: YES buyers raise it, NO buyers
    // lower it, so p x Y + (1 - p) x N stays at the stock price at every midpoint.
    const yes = priced(input({ branch: 0, quantity: 50n * NVDA }));
    const no = priced(input({ branch: 1, quantity: 50n * NVDA }));
    expect(yes.gapPpm).toBeGreaterThan(50_000n);
    expect(no.gapPpm).toBeLessThan(50_000n);
    for (const p of [yes, no]) {
      const [y, n] = fairPrices(SPOT, 400_000n, p.gapPpm);
      const spot = (y * 400_000n + n * (PROB - 400_000n)) / PROB;
      expect(spot - SPOT < 2n && SPOT - spot < 2n).toBe(true);
    }
  });

  test("the vault's inventory skews its prices toward flow that brings it back to flat", () => {
    const flat = priced(input());
    // Long YES stock: YES is offered cheaper and bid lower than when flat.
    const longYes = position({
      imbalance: 100n * NVDA,
      high: 100n * NVDA,
      low: 100n * NVDA,
      expected: 100n * NVDA,
    });
    expect(priced(input({}, { position: longYes })).price).toBeLessThan(flat.price);
    // Outstanding quotes count as filled: a quote already out selling YES prices the next higher.
    const out = position({ expected: -50n * NVDA, low: -50n * NVDA });
    expect(priced(input({}, { position: out })).price).toBeGreaterThan(flat.price);
  });

  test("fees, recent movement and the probability's uncertainty widen the spread", () => {
    const base = priced(input());
    const fees = priced(input({}, { market: { ...input().market, makerBps: 20, takerBps: 50 } }));
    const moving = priced(input({}, { movementBps: 40n }));
    const uncertain = priced(input({}, { reference: { ...input().reference, spread: 50_000n } }));
    for (const wider of [fees, moving, uncertain])
      expect(wider.halfSpreadBps).toBeGreaterThan(base.halfSpreadBps);
    const edged = priced(
      input({}, { settings: { ...config, rfq: { ...config.rfq, edgeBps: 25 } } }),
    );
    expect(edged.halfSpreadBps).toBe(base.halfSpreadBps + 25n);
  });
});

describe("the size", () => {
  test("stays within the imbalance cap, counting resting orders and outstanding quotes", () => {
    // Selling YES lowers the imbalance: from -150 with 30 more already committed, 20 remain.
    const near = position({
      imbalance: -150n * NVDA,
      low: -180n * NVDA,
      high: -150n * NVDA,
      expected: -150n * NVDA,
    });
    expect(priced(input({ quantity: 100n * NVDA }, { position: near })).quantity).toBe(20n * NVDA);
    // Buying YES raises it, and has the whole room up to +200.
    expect(raisesImbalance({ branch: 0, side: 1 })).toBe(true);
    expect(
      priced(input({ side: 1, quantity: 100n * NVDA, limit: 1n }, { position: near })).quantity,
    ).toBe(100n * NVDA);
    const full = position({
      imbalance: -200n * NVDA,
      low: -200n * NVDA,
      high: -200n * NVDA,
      expected: -200n * NVDA,
    });
    expect(declined(input({}, { position: full }))).toMatch(/No capacity/);
  });

  test("stays within the per-quote notional and what one funding source can deliver", () => {
    // $20k at about $103: 193 whole shares at most (and a step multiple).
    const capped = priced(input({ quantity: 300n * NVDA }));
    expect(notional(capped.quantity, capped.price, true)).toBeLessThanOrEqual(20_000n * USDC);
    expect(capped.quantity % 10n ** 15n).toBe(0n);
    expect(capped.quantity).toBeGreaterThan(190n * NVDA);
    // Only 3 shares of credit, but 5 YES claims: the claims fund it (and net the position).
    const claims = position({
      funds: { quote: 0n, base: 3n * NVDA, quoteClaims: [0n, 0n], baseClaims: [5n * NVDA, 0n] },
    });
    expect(priced(input({ quantity: 4n * NVDA }, { position: claims }))).toMatchObject({
      quantity: 4n * NVDA,
      fundingKind: 1,
    });
    expect(priced(input({ quantity: 9n * NVDA }, { position: claims })).quantity).toBe(5n * NVDA);
    // A bid is capped by the quote it can pay.
    const poor = position({
      funds: { quote: 50n * USDC, base: 0n, quoteClaims: [0n, 0n], baseClaims: [0n, 0n] },
    });
    const bid = priced(input({ side: 1, quantity: 10n * NVDA, limit: 1n }, { position: poor }));
    expect(notional(bid.quantity, bid.price, true)).toBeLessThanOrEqual(50n * USDC);
    expect(bid.fundingKind).toBe(0);
  });
});

describe("what it refuses", () => {
  test("prices beyond the order's limit or the vault's band", () => {
    expect(declined(input({ limit: 100n * USDC }))).toBe(
      "The vault's price is beyond the order's limit",
    );
    expect(declined(input({ side: 1, limit: 110n * USDC }))).toBe(
      "The vault's price is beyond the order's limit",
    );
    // The oracle 8% under the reference: within the 9.5% usable band? No: $103 x 1.003 is ~11.9%
    // over $92.
    expect(
      declined(
        input({}, { oracle: 92n * USDC, settings: { ...config, maxOracleDeviationBps: 2000 } }),
      ),
    ).toBe("The price would leave the vault's band");
  });

  test("stale or incoherent references, a closing window and a fee above the cap", () => {
    const r = input().reference;
    const late = Number(NOW) * 1000 - 6_000;
    expect(declined(input({}, { reference: { ...r, observedAt: late } }))).toBe(
      "Reference is stale",
    );
    expect(declined(input({}, { reference: { ...r, spotAt: r.probabilityAt - 20_000 } }))).toBe(
      "Stock price and probability were observed too far apart",
    );
    expect(declined(input({}, { oracle: 97n * USDC }))).toBe(
      "Reference price and the vault oracle disagree",
    );
    expect(declined(input({}, { cutoff: Number(NOW) + 3600 + 2 }))).toBe("Quoting window closed");
    expect(declined(input({}, { market: { ...input().market, makerBps: 150 } }))).toBe(
      "Market maker fee exceeds the vault cap",
    );
    // The quote outlives neither the vault's lifetime limit nor its cutoff buffer.
    expect(priced(input({}, { limits: { maxTtl: 6, maxFeeBps: 100 } })).expiry).toBe(NOW + 6n);
    expect(priced(input({}, { cutoff: Number(NOW) + 3600 + 8 })).expiry).toBe(NOW + 8n);
  });
});
