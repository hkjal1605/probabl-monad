/** Polymarket settles every market by reporting payouts to Gnosis Conditional Tokens on Polygon.
 * The reported payout, read at a finalized block, is what automation copies to a local market. */
import type { PayoutVector } from "@conditional-stocks/market-data";
import { type Hex, type PublicClient, parseAbi } from "viem";

/** Polymarket's Conditional Tokens on Polygon (docs.polymarket.com, "Contracts"). */
export const POLYGON_CONDITIONAL_TOKENS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const abi = parseAbi([
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)",
]);

export interface ReportedPayout {
  payout: PayoutVector;
  blockNumber: bigint;
  blockHash: Hex;
}
/** A binary Polymarket condition and the index sets (1 or 2) of its YES and NO outcomes. */
export interface Condition {
  polymarketConditionId: Hex;
  polymarketYesIndex: string;
  polymarketNoIndex: string;
}

/** The local payout of a reported Polymarket payout: YES, NO or an even split; null for any
 * other split, which a local market cannot settle. */
export function payoutOf(yes: bigint, no: bigint, denominator: bigint): PayoutVector | null {
  if (denominator === 0n) return null;
  if (yes === denominator && no === 0n) return { denominator: "1", no: "0", yes: "1" };
  if (no === denominator && yes === 0n) return { denominator: "1", no: "1", yes: "0" };
  if (yes === no && yes * 2n === denominator) return { denominator: "2", no: "1", yes: "1" };
  return null;
}

const slot = (indexSet: string) => {
  if (indexSet !== "1" && indexSet !== "2") throw new Error(`Unexpected index set ${indexSet}`);
  return indexSet === "1" ? 0n : 1n;
};
/** Markets on the same Polymarket condition and orientation share one reported payout. */
export const payoutKey = (c: Condition) =>
  `${c.polymarketConditionId.toLowerCase()}:${c.polymarketYesIndex}:${c.polymarketNoIndex}`;

/** Final payouts of the conditions Polymarket has settled, keyed by `payoutKey`, read at
 * Polygon's finalized block: one multicall for every denominator, one for the settled ones'
 * numerators. Unsettled conditions are absent; so are settled ones whose split cannot settle a
 * local market (`unsupported` lists them). */
export async function reportedPayouts(client: PublicClient, conditions: Condition[]) {
  const unique = [...new Map(conditions.map((c) => [payoutKey(c), c])).values()];
  const payouts = new Map<string, ReportedPayout>();
  const unsupported: Condition[] = [];
  if (!unique.length) return { payouts, unsupported };
  const block = await client.getBlock({ blockTag: "finalized" });
  const read = (functionName: "payoutDenominator" | "payoutNumerators", args: unknown[]) =>
    ({ address: POLYGON_CONDITIONAL_TOKENS, abi, functionName, args }) as const;
  const denominators = (await client.multicall({
    allowFailure: false,
    blockNumber: block.number,
    contracts: unique.map((c) => read("payoutDenominator", [c.polymarketConditionId])),
  })) as bigint[];
  const settled = unique
    .map((condition, i) => ({ condition, denominator: denominators[i]! }))
    .filter((s) => s.denominator > 0n);
  if (!settled.length) return { payouts, unsupported };
  const numerators = (await client.multicall({
    allowFailure: false,
    blockNumber: block.number,
    contracts: settled.flatMap(({ condition: c }) => [
      read("payoutNumerators", [c.polymarketConditionId, slot(c.polymarketYesIndex)]),
      read("payoutNumerators", [c.polymarketConditionId, slot(c.polymarketNoIndex)]),
    ]),
  })) as bigint[];
  settled.forEach(({ condition, denominator }, i) => {
    const payout = payoutOf(numerators[2 * i]!, numerators[2 * i + 1]!, denominator);
    if (payout)
      payouts.set(payoutKey(condition), {
        payout,
        blockNumber: block.number,
        blockHash: block.hash,
      });
    else unsupported.push(condition);
  });
  return { payouts, unsupported };
}
