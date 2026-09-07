import { hashCanonical } from "@conditional-stocks/orderbook";
import type { FairnessDecision } from "./types.ts";

/** Retain state/fencing/preview changes, not identical polling timestamps. */
export function decisionFingerprint(decision: FairnessDecision) {
  const { atMs: _atMs, ...state } = decision;
  return hashCanonical(state);
}
