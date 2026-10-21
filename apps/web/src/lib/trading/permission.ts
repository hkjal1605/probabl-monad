import { approveDelegate, DELEGATE_TRADE, MAX_FEE_BPS } from "@conditional-stocks/evm-client";
import { getAddress } from "viem";
import { protocolConfig } from "@/config/protocol";
import { parseAmountInput } from "@/lib/format/amount-input";
import type { TradingPermission } from "@/services/trading-permissions";

export const DEFAULT_MAX_ORDER_QUOTE = "1000";
export const DEFAULT_TOTAL_QUOTE = "10000";
export const DEFAULT_MAX_ORDER_SHARES = "10";
export const DEFAULT_TOTAL_SHARES = "100";
const MAX_QUOTE = (1n << 96n) - 1n;
const MAX_BASE = (1n << 128n) - 1n;

/** Approval of the service's trading key: every market for 90 days. Buys are bounded in USDC
 * (per order and in total) and sells in shares, so a leaked key can spend at most the USDC
 * limit and sell at most the share limit. Each market sets its own fee rates, so the fee cap is
 * the protocol maximum; every order still caps its fee at its market's displayed rates.
 * Re-approving replaces an earlier approval and invalidates its orders. */
export function tradingPermissionApproval(input: {
  owner: string;
  permission: TradingPermission;
  perOrder?: string;
  total?: string;
  perOrderShares?: string;
  totalShares?: string;
  nowSeconds?: bigint;
}) {
  const { owner, permission } = input;
  if (permission.owner !== owner) throw new Error("Trading permission belongs to another wallet");
  if (
    !permission.available ||
    !permission.delegate ||
    permission.quoteDecimals === null ||
    permission.baseDecimals === null
  )
    throw new Error("Trading approval is not available for this deployment");
  if (permission.active) throw new Error("Trading is already enabled");
  const maxOrderQuote = parseAmountInput(
    input.perOrder ?? DEFAULT_MAX_ORDER_QUOTE,
    permission.quoteDecimals,
    "The per-order limit",
  );
  const totalQuote = parseAmountInput(
    input.total ?? DEFAULT_TOTAL_QUOTE,
    permission.quoteDecimals,
    "The lifetime limit",
  );
  if (maxOrderQuote <= 0n || totalQuote < maxOrderQuote || totalQuote > MAX_QUOTE)
    throw new Error("Set a positive per-order limit and a larger lifetime limit");
  const maxOrderBase = parseAmountInput(
    input.perOrderShares ?? DEFAULT_MAX_ORDER_SHARES,
    permission.baseDecimals,
    "The per-order share limit",
  );
  const totalBase = parseAmountInput(
    input.totalShares ?? DEFAULT_TOTAL_SHARES,
    permission.baseDecimals,
    "The lifetime share limit",
  );
  if (maxOrderBase <= 0n || totalBase < maxOrderBase || totalBase > MAX_BASE)
    throw new Error("Set a positive per-order share limit and a larger lifetime share limit");
  const now = input.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  return approveDelegate(
    protocolConfig.exchange,
    getAddress(permission.delegate),
    {
      market: 0,
      expiresAt: now + 90n * 86_400n,
      maxOrderQuote,
      totalQuote,
      maxOrderBase,
      totalBase,
      maxFeeBps: MAX_FEE_BPS,
      permissions: DELEGATE_TRADE,
    },
    now,
  );
}
