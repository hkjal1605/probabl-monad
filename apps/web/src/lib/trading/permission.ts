import { parseTokenAmount } from "@conditional-stocks/domain";
import { approveDelegate, DELEGATE_TRADE } from "@conditional-stocks/evm-client";
import { getAddress } from "viem";
import { protocolConfig } from "@/config/protocol";
import type { TradingPermission } from "@/services/trading-permissions";

export const DEFAULT_MAX_ORDER_QUOTE = "1000";
export const DEFAULT_TOTAL_QUOTE = "10000";
const MAX_QUOTE = (1n << 96n) - 1n;

/** Approval of the service's trading key: every market, bounded per order and in total,
 * for 90 days. Re-approving replaces an earlier approval and invalidates its orders. */
export function tradingPermissionApproval(input: {
  owner: string;
  permission: TradingPermission;
  perOrder?: string;
  total?: string;
  nowSeconds?: bigint;
}) {
  const { owner, permission } = input;
  if (permission.owner !== owner) throw new Error("Trading permission belongs to another wallet");
  if (!permission.available || !permission.delegate || permission.quoteDecimals === null)
    throw new Error("Trading approval is not available for this deployment");
  if (permission.active) throw new Error("Trading is already enabled");
  const maxOrderQuote = parseTokenAmount(
    (input.perOrder ?? DEFAULT_MAX_ORDER_QUOTE).trim(),
    permission.quoteDecimals,
  );
  const totalQuote = parseTokenAmount(
    (input.total ?? DEFAULT_TOTAL_QUOTE).trim(),
    permission.quoteDecimals,
  );
  if (maxOrderQuote <= 0n || totalQuote < maxOrderQuote || totalQuote > MAX_QUOTE)
    throw new Error("Set a positive per-order limit and a larger lifetime limit");
  const now = input.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  return approveDelegate(
    protocolConfig.exchange,
    getAddress(permission.delegate),
    {
      market: 0,
      expiresAt: now + 90n * 86_400n,
      maxOrderQuote,
      totalQuote,
      maxFeeBps: 100,
      permissions: DELEGATE_TRADE,
    },
    now,
  );
}
