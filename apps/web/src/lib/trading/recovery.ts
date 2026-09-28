import { cancel, verifyEnvelope } from "@conditional-stocks/evm-client";
import { protocolConfig } from "@/config/protocol";

export type RecoveryKind = "cancel" | "expired" | "invalidated" | "closed";
/** Cancellation by the owner, or the public release of an order that can no longer fill. */
export const orderRecovery = (input: { orderHash: string }) =>
  cancel(protocolConfig.exchange, input.orderHash);
export const verifyRecoveryResponse = verifyEnvelope;
