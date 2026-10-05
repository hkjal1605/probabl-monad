import { expect, test } from "bun:test";
import {
  amountUsd,
  expectedUsd,
  formatAmount,
  sumByToken,
  tokenPrices,
  totalUsd,
  unlockDate,
  unlockIn,
} from "../src/lib/referrals/presentation";
import { captureInvite, forgetInvite, pendingInvite } from "../src/lib/wallet/invite";
import type { RewardMarketView } from "../src/services/referrals-api-service";
import type { MarketView } from "../src/types/api";

const usdc = "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  nvda = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const quote = (amount: string) => ({ token: usdc, symbol: "USDC", decimals: 6, amount });
const stock = (amount: string) => ({ token: nvda, symbol: "NVDA", decimals: 18, amount });

test("rewards are valued at spot; the quote stablecoin counts as $1 without a reference", () => {
  const now = Date.now();
  const market = {
    quoteToken: usdc,
    base: { token: nvda },
    spotReference: {
      token: nvda,
      priceUsd: 200,
      status: "available",
      valuationCompatible: true,
      observedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    },
  } as unknown as MarketView;
  const prices = tokenPrices([market], now);
  expect(prices.get(usdc.toLowerCase())).toBe(1);
  expect(amountUsd(quote("30000"), prices)).toBeCloseTo(0.03);
  // Without a stock price the total is unknown, never understated.
  expect(totalUsd([quote("1000000"), stock("1")], new Map([[usdc.toLowerCase(), 1]]))).toBeNull();
  expect(totalUsd([], prices)).toBe(0);
});

test("an open market's claims are weighted by each side's probability", () => {
  const prices = new Map([
    [usdc.toLowerCase(), 1],
    [nvda.toLowerCase(), 200],
  ]);
  const market = {
    probabilityYesX6: "250000",
    accrued: [
      { ...quote("4000000"), branch: 0, collateral: 0 },
      { ...stock("10000000000000000"), branch: 1, collateral: 1 },
    ],
  } as RewardMarketView;
  // $4 × 25% (YES) + 0.01 NVDA × $200 × 75% (NO).
  expect(expectedUsd(market, prices)).toBeCloseTo(1 + 1.5);
  expect(expectedUsd({ ...market, probabilityYesX6: null }, prices)).toBeNull();
});

test("amounts keep their significant digits and add up per token", () => {
  expect(formatAmount(quote("30000"))).toBe("0.03 USDC");
  expect(formatAmount(stock("6000000000000"))).toBe("0.000006 NVDA");
  expect(formatAmount(quote("1234567890"))).toBe("1,234.57 USDC");
  expect(formatAmount({ ...stock("5"), decimals: null })).toBe("5 NVDA (raw)");
  expect(sumByToken([quote("1"), stock("2"), quote("3")])).toEqual([quote("4"), stock("2")]);
});

test("unlocks read as a UTC Monday and a countdown", () => {
  const monday = Date.parse("2026-10-12T00:00:00Z") / 1000;
  expect(unlockDate(monday)).toBe("Mon, Oct 12 · 00:00 UTC");
  const now = Date.parse("2026-10-05T12:00:00Z");
  expect(unlockIn(monday, now)).toBe("in 6 days");
  expect(unlockIn(monday, Date.parse("2026-10-11T21:00:00Z"))).toBe("in 3 hours");
  expect(unlockIn(monday, Date.parse("2026-10-11T23:59:30Z"))).toBe("in 1 minute");
  expect(unlockIn(monday, Date.parse("2026-10-12T00:00:01Z"))).toBe("now");
});

test("an invite link's code is kept for a week and leaves the address bar", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  };
  const replaced: string[] = [];
  const history = {
    state: null,
    replaceState: (_: unknown, __: string, url: string) => void replaced.push(url),
  };
  expect(
    captureInvite(
      { href: "https://probabl.trade/markets/x?invite=abcd-efgo&tab=1#top" },
      history,
      storage,
    ),
  ).toBe("ABCDEFG0");
  expect(replaced).toEqual(["/markets/x?tab=1#top"]);
  expect(pendingInvite(storage)).toBe("ABCDEFG0");
  expect(pendingInvite(storage, Date.now() + 8 * 86_400_000)).toBeNull();
  // A malformed code is dropped (and still removed from the address bar).
  expect(
    captureInvite({ href: "https://probabl.trade/?invite=nope" }, history, storage),
  ).toBeNull();
  expect(replaced.at(-1)).toBe("/");
  expect(pendingInvite(storage)).toBe("ABCDEFG0");
  forgetInvite(storage);
  expect(pendingInvite(storage)).toBeNull();
  // Links without a code change nothing.
  expect(captureInvite({ href: "https://probabl.trade/portfolio" }, history, storage)).toBeNull();
  expect(replaced.length).toBe(2);
});
