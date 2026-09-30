import { describe, expect, test } from "bun:test";
import {
  capacityPercent,
  depositBounds,
  perShare,
  sharesFor,
  tokenText,
  withdrawBounds,
} from "../src/lib/delta-vault/amounts";
import { pinnedVaults } from "../src/lib/delta-vault/pinned";
import { baseHigh, quoteHigh, unpaired } from "../src/modules/VaultDetailPageModule/utils/holdings";
import type { DeltaVaultView } from "../src/services/delta-vaults-api-service";

const vault = {
  holdings: {
    quote: "1000000",
    base: "5000000000000000000",
    freeQuote: "1000000",
    freeBase: "5000000000000000000",
    markets: [
      {
        venueId: 1,
        claims: { yesQuote: "300", noQuote: "100", yesBase: "7", noBase: "9" },
        free: { yesQuote: "300", noQuote: "100", yesBase: "7", noBase: "9" },
      },
    ],
  },
} as unknown as DeltaVaultView;

describe("deposit and withdrawal bounds", () => {
  test("deposits budget exactly the previewed amounts and accept 0.5% fewer shares", () => {
    expect(depositBounds({ shares: 10_000n, quoteIn: 7n, baseIn: 9n })).toEqual({
      maxQuote: 7n,
      maxBase: 9n,
      minShares: 9950n,
    });
    expect(() => depositBounds({ shares: 0n, quoteIn: 1n, baseIn: 1n })).toThrow();
  });

  test("withdrawals accept at most the slippage below the preview", () => {
    expect(withdrawBounds({ quoteOut: 10_000n, baseOut: 200n }, 100n)).toEqual({
      minQuote: 9900n,
      minBase: 198n,
    });
  });
});

describe("share arithmetic", () => {
  test("per-share amounts, percentage shares and capacity", () => {
    expect(perShare(2_000_000n, 10n ** 18n)).toBe(2_000_000n);
    expect(perShare(5n, 0n)).toBe(0n);
    expect(sharesFor(1001n, 100)).toBe(1001n);
    expect(sharesFor(1000n, 25)).toBe(250n);
    expect(capacityPercent(50n, 200n)).toBe(25);
    expect(capacityPercent(300n, 200n)).toBe(100);
    expect(capacityPercent(1n, 0n)).toBeNull();
  });

  test("token text truncates, never rounds up", () => {
    expect(tokenText(1_239_999n, 6, 2)).toBe("1.23");
    expect(tokenText(1_000_000n, 6)).toBe("1");
    expect(tokenText(0n, 18)).toBe("0");
  });
});

describe("holdings", () => {
  test("richest branches and the unpaired rest of each market", () => {
    expect(quoteHigh(vault)).toBe(1_000_300n);
    expect(baseHigh(vault)).toBe(5_000_000_000_000_000_009n);
    expect(unpaired(vault.holdings.markets[0]!.claims)).toEqual({
      paired: { quote: 100n, base: 7n },
      yesQuote: 200n,
      noQuote: 0n,
      yesBase: 0n,
      noBase: 2n,
    });
  });

  test("only vaults pinned in the build configuration are used", () => {
    const listed = [{ address: "0xAbC" }, { address: "0xdef" }];
    expect(pinnedVaults(listed, ["0xabc"])).toEqual([{ address: "0xAbC" }]);
    expect(pinnedVaults(listed, [])).toEqual([]);
  });
});
