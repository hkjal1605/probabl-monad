import {
  assertShareUnits,
  formatShareAmount,
  formatTokenAmount,
  parsePriceRawX18,
  parseShareAmount,
  quoteForExecution,
  quoteForReservation,
  type ShareUnits,
} from "@conditional-stocks/domain";
import {
  type AtomicPlan,
  type FeeRates,
  formatBps,
  type OrderWire,
} from "@conditional-stocks/evm-client";
import { decimalInput } from "@/lib/format/amount-input";

export interface OrderFormValues extends ShareUnits {
  baseStep?: string;
  account: string;
  delegate?: string;
  delegateExpiresAt?: string;
  branch: "YES" | "NO";
  cutoff: string;
  funding: "whole" | "claim";
  marketId: string;
  maxFeeBps?: number;
  price: string;
  quantity: string;
  side: "buy" | "sell";
  tif: "gtc" | "ioc";
}

export const previewOrder = (
  quantity: string,
  price: string,
  units: ShareUnits & { baseStep?: string },
) => {
  try {
    assertShareUnits(units);
    // Typed text as people write numbers ("1,000", ".5"); anything else is not a number.
    const quantityRaw = parseShareAmount(decimalInput(quantity) ?? quantity, units);
    const priceRawX18 = parsePriceRawX18(decimalInput(price) ?? price, units);
    if (quantityRaw <= 0n || quantityRaw >= 1n << 96n) throw new Error("invalid quantity");
    if (
      units.baseStep !== undefined &&
      (BigInt(units.baseStep) <= 0n || quantityRaw % BigInt(units.baseStep) !== 0n)
    )
      throw new Error("invalid quantity step");
    if (quoteForExecution(quantityRaw, priceRawX18) === 0n)
      throw new Error("Order notional is below one raw quote unit.");
    const reservationRaw = quoteForReservation(quantityRaw, priceRawX18);
    if (reservationRaw >= 1n << 96n) throw new Error("Quote exceeds the supported range");
    return {
      cost: Number(formatTokenAmount(reservationRaw, units.quoteTokenDecimals)),
      costRaw: reservationRaw.toString(),
      priceRawX18: priceRawX18.toString(),
      qty: Number(formatShareAmount(quantityRaw, units)),
      quantityRaw: quantityRaw.toString(),
      valid: true as const,
    };
  } catch {
    return {
      cost: 0,
      costRaw: "0",
      priceRawX18: "0",
      qty: 0,
      quantityRaw: "0",
      valid: false as const,
    };
  }
};

/** The taker fee of a planned immediate fill, before the order's rounding carry: stock claims
 * of a buy, quote claims of a sell. */
export const takerFee = (
  plan: Pick<AtomicPlan, "filledQuantity" | "executionQuote">,
  side: "buy" | "sell",
  takerBps: number,
) =>
  ((side === "buy" ? BigInt(plan.filledQuantity) : BigInt(plan.executionQuote)) *
    BigInt(takerBps)) /
  10_000n;

/** A market's maker rebate as its rules show it: the share of the taker fee and what that is of
 * each fill ("25% of the taker fee · 0.075% of each fill"), or none. */
export function makerRebateText(market: { fees: FeeRates; makerRebateBps: number }) {
  const { fees, makerRebateBps } = market;
  if (makerRebateBps === 0 || fees.takerBps === 0) return "None";
  return `${formatBps(makerRebateBps)} of the taker fee · ${formatBps((fees.takerBps * makerRebateBps) / 10_000)} of each fill`;
}

export const createOrder = (
  values: OrderFormValues,
  options: { nowMs?: number } = {},
): OrderWire => {
  const nowMs = options.nowMs ?? Date.now();
  const cutoffSeconds = Math.floor(new Date(values.cutoff).getTime() / 1_000);
  const preview = previewOrder(values.quantity, values.price, values);
  if (!preview.valid) throw new Error("Quantity and price must be positive decimal values.");
  if (!Number.isSafeInteger(cutoffSeconds)) throw new Error("Trading cutoff is invalid.");
  const maxFeeBps = values.maxFeeBps ?? 0;
  if (!Number.isInteger(maxFeeBps) || maxFeeBps < 0 || maxFeeBps > 1_000) {
    throw new Error("Maximum fee must be an integer from 0 to 1000 bps.");
  }
  return {
    maxFeeBps,
    branch: values.branch === "YES" ? 0 : 1,
    expiry: String(
      Math.min(
        Math.floor(nowMs / 1_000) + 30 * 86_400,
        cutoffSeconds - 1,
        values.delegateExpiresAt ? Number(values.delegateExpiresAt) - 1 : Number.MAX_SAFE_INTEGER,
      ),
    ),
    fundingKind: values.funding === "whole" ? 0 : 1,
    limitPriceRawX18: preview.priceRawX18,
    maker: values.account as `0x${string}`,
    ...(values.delegate ? { delegate: values.delegate as `0x${string}` } : {}),
    marketId: values.marketId,
    quantity: preview.quantityRaw,
    side: values.side === "buy" ? 0 : 1,
    tif: values.tif === "gtc" ? 0 : 1,
  };
};
