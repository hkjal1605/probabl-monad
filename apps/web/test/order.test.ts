import { describe, expect, test } from "bun:test";
import { createOrder, previewOrder } from "@/lib/trading/order";

const form = {
  shareDecimals: 18,
  quoteTokenDecimals: 6,
  protocolVersion: 4,
  priceFormat: "raw-unit-ratio-x18" as const,
  account: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  branch: "NO" as const,
  cutoff: "2027-01-01T00:00:00.000Z",
  funding: "claim" as const,
  marketId: "7",
  price: "123.456",
  quantity: "2.5",
  side: "sell" as const,
  tif: "ioc" as const,
};

describe("order form math", () => {
  test("fee cap defaults to zero and explicit consent is kept in raw bps", () => {
    expect(createOrder(form).maxFeeBps).toBe(0);
    expect(createOrder({ ...form, maxFeeBps: 25 }).maxFeeBps).toBe(25);
    for (const value of [-1, 1.5, 1001, Number.NaN, Infinity]) {
      expect(() => createOrder({ ...form, maxFeeBps: value })).toThrow("Maximum fee");
    }
  });
  test("uses exact raw-unit ratio math for an 18-decimal stock token and 6-decimal USDC", () => {
    expect(previewOrder("2.5", "123.456", form)).toEqual({
      cost: 308.64,
      costRaw: "308640000",
      priceRawX18: "123456000",
      qty: 2.5,
      quantityRaw: "2500000000000000000",
      valid: true,
    });
  });
  test("quantities follow the stock token's decimals and the market step", () => {
    for (const shareDecimals of [6, 18]) {
      const preview = previewOrder("1.5", "200", { ...form, shareDecimals });
      expect(preview.quantityRaw).toBe(String(15n * 10n ** BigInt(shareDecimals - 1)));
      expect(preview.costRaw).toBe("300000000");
    }
    expect(previewOrder("1.5", "200", { ...form, baseStep: "1000000000000000000" }).valid).toBe(
      false,
    );
    expect(previewOrder("1.5", "200", { ...form, protocolVersion: 3 }).valid).toBe(false);
  });

  test("builds the exact wire order reviewed by the signer", () => {
    const order = createOrder(
      { ...form, delegate: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" },
      { nowMs: 1_700_000_000_000 },
    );
    expect(order as unknown).toEqual({
      maxFeeBps: 0,
      branch: 1,
      expiry: String(1_700_000_000 + 30 * 86_400),
      fundingKind: 1,
      limitPriceRawX18: "123456000",
      maker: form.account,
      delegate: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
      marketId: "7",
      quantity: "2500000000000000000",
      side: 1,
      tif: 1,
    });
    // The approval's expiry bounds the order's.
    expect(
      createOrder({ ...form, delegateExpiresAt: "1700000100" }, { nowMs: 1_700_000_000_000 })
        .expiry,
    ).toBe("1700000099");
  });

  test("rejects empty, negative, and over-precision inputs", () => {
    expect(previewOrder("", "100", form).valid).toBe(false);
    expect(previewOrder("-1", "100", form).valid).toBe(false);
    expect(previewOrder("1.0000000000000000001", "100", form).valid).toBe(false);
    expect(previewOrder("1", "100.0000001", form).valid).toBe(false);
  });
});
