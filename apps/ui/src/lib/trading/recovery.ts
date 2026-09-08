import { conditionalExchangeAbi } from "@conditional-stocks/contract-bindings";
import { encodeFunctionData, getAddress, type Hex, isHex, zeroAddress } from "viem";
import { verifyPayoutResponse } from "./payouts";

export type RecoveryKind = "cancel" | "expired" | "invalidated" | "closed";

/** Cancellation and permissionless recovery never accept a server-selected target or refund recipient. */
export function orderRecovery(input: {
  orderHash: string;
  kind: RecoveryKind;
  account: string;
  config: { chainId: number; exchange: string };
}) {
  if (
    !isHex(input.orderHash, { strict: true }) ||
    input.orderHash.length !== 66 ||
    !Number.isSafeInteger(input.config.chainId) ||
    input.config.chainId <= 0
  )
    throw new Error("Invalid recovery identity");
  const to = getAddress(input.config.exchange);
  if (to === zeroAddress) throw new Error("Exchange is not configured");
  return {
    chainId: input.config.chainId,
    from: getAddress(input.account),
    to,
    value: "0",
    data: encodeFunctionData({
      abi: conditionalExchangeAbi,
      functionName: (
        {
          cancel: "cancelOrder",
          expired: "releaseExpiredOrder",
          invalidated: "releaseInvalidatedOrder",
          closed: "releaseClosedMarketOrder",
        } as const
      )[input.kind],
      args: [input.orderHash as Hex],
    }),
  };
}

export const verifyRecoveryResponse = verifyPayoutResponse;
