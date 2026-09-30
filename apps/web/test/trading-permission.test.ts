import { expect, test } from "bun:test";
import { conditionalStocksAbi } from "@conditional-stocks/evm-client";
import { decodeFunctionData } from "viem";
import {
  DEFAULT_MAX_ORDER_QUOTE,
  DEFAULT_MAX_ORDER_SHARES,
  DEFAULT_TOTAL_QUOTE,
  DEFAULT_TOTAL_SHARES,
  tradingPermissionApproval,
} from "../src/lib/trading/permission";
import type { TradingPermission } from "../src/services/trading-permissions";

const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const delegate = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const permission = (overrides: Partial<TradingPermission> = {}): TradingPermission => ({
  owner,
  available: true,
  delegate,
  active: false,
  block: "1",
  quoteToken: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  quoteDecimals: 6,
  baseDecimals: 18,
  grant: null,
  ...overrides,
});

test("trade ticket defaults build one deployment-wide, bounded 90-day approval", () => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const transaction = tradingPermissionApproval({
    owner,
    permission: permission(),
    nowSeconds: now,
  });
  const { functionName, args } = decodeFunctionData({
    abi: conditionalStocksAbi,
    data: transaction.data,
  });
  expect(functionName).toBe("approveDelegate");
  expect(args).toEqual([
    delegate,
    0,
    Number(now + 90n * 86_400n),
    1_000_000_000n,
    10_000_000_000n,
    10n * 10n ** 18n,
    100n * 10n ** 18n,
    100,
    1,
  ]);
  expect(DEFAULT_MAX_ORDER_QUOTE).toBe("1000");
  expect(DEFAULT_TOTAL_QUOTE).toBe("10000");
  expect(DEFAULT_MAX_ORDER_SHARES).toBe("10");
  expect(DEFAULT_TOTAL_SHARES).toBe("100");
});

test("approval rejects foreign, unavailable and already-active permissions; an exhausted one is replaced", () => {
  for (const value of [
    permission({ owner: delegate }),
    permission({ available: false }),
    permission({ active: true }),
    permission({ baseDecimals: null }),
  ])
    expect(() => tradingPermissionApproval({ owner, permission: value })).toThrow();
  const exhausted = permission({
    grant: {
      market: "0",
      expiresAt: "1",
      maxOrderQuote: "1",
      remainingQuote: "0",
      maxOrderBase: "1",
      remainingBase: "0",
      maxFeeBps: 0,
      permissions: 1,
      revoked: true,
      generation: 1,
    },
  });
  expect(tradingPermissionApproval({ owner, permission: exhausted }).data).toMatch(/^0x/);
});

test("market ticket enables permission in place and reserves portfolio navigation for deposits", async () => {
  const source = await Bun.file(
    new URL("../src/modules/MarketDetailPageModule/components/OrderTicket.tsx", import.meta.url),
  ).text();
  expect(source).toContain("? t.enableTrading()");
  expect(source).toContain("prepared && !prepared.funding.balanceSufficient");
  expect(source.match(/router\.push\("\/portfolio"\)/g)).toHaveLength(1);
});
