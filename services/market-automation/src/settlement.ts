import type { Hex } from "viem";
import type { KalshiSettlement } from "./venues/kalshi.ts";
import type { PolymarketSettlement } from "./venues/polymarket.ts";

/** A venue's final payout of one event, which local markets on it settle to. */
export type Settlement = PolymarketSettlement | KalshiSettlement;

/** An event market as local markets reference it: its on-chain id and the index sets (1 or 2)
 * of the outcomes their YES and NO branches follow. */
export interface EventCondition {
  eventConditionId: Hex;
  eventYesIndex: string;
  eventNoIndex: string;
}

/** Markets on the same event and orientation share one settlement. */
export const eventKey = (c: EventCondition) =>
  `${c.eventConditionId.toLowerCase()}:${c.eventYesIndex}:${c.eventNoIndex}`;
