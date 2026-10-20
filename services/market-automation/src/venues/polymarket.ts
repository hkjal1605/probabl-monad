/** Polymarket settles every market by reporting payouts to Gnosis Conditional Tokens on Polygon.
 * The reported payout, read at a finalized block, is what local markets settle to, once
 * Polymarket's own API also reports the market resolved. */
import type { PayoutVector } from "@conditional-stocks/market-data";
import { type Hex, type PublicClient, parseAbi } from "viem";
import type { Snapshot } from "../admin.ts";
import { type EventCondition, eventKey } from "../settlement.ts";

/** Polymarket's Conditional Tokens on Polygon (docs.polymarket.com, "Contracts"). */
export const POLYGON_CONDITIONAL_TOKENS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const abi = parseAbi([
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)",
]);

export interface PolymarketSettlement {
  source: "polymarket";
  payout: PayoutVector;
  blockNumber: bigint;
  blockHash: Hex;
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

/** Final payouts of the events Polymarket has settled, keyed by `eventKey`, read at Polygon's
 * finalized block: one multicall for every denominator, one for the settled ones' numerators.
 * Unsettled events are absent; so are settled ones whose split cannot settle a local market
 * (`unsupported` lists them). */
export async function polymarketSettlements(client: PublicClient, conditions: EventCondition[]) {
  const unique = [...new Map(conditions.map((c) => [eventKey(c), c])).values()];
  const settlements = new Map<string, PolymarketSettlement>();
  const unsupported: EventCondition[] = [];
  if (!unique.length) return { settlements, unsupported };
  const block = await client.getBlock({ blockTag: "finalized" });
  const read = (functionName: "payoutDenominator" | "payoutNumerators", args: unknown[]) =>
    ({ address: POLYGON_CONDITIONAL_TOKENS, abi, functionName, args }) as const;
  const denominators = (await client.multicall({
    allowFailure: false,
    blockNumber: block.number,
    contracts: unique.map((c) => read("payoutDenominator", [c.eventConditionId])),
  })) as bigint[];
  const settled = unique
    .map((condition, i) => ({ condition, denominator: denominators[i] ?? 0n }))
    .filter((s) => s.denominator > 0n);
  if (!settled.length) return { settlements, unsupported };
  const numerators = (await client.multicall({
    allowFailure: false,
    blockNumber: block.number,
    contracts: settled.flatMap(({ condition: c }) => [
      read("payoutNumerators", [c.eventConditionId, slot(c.eventYesIndex)]),
      read("payoutNumerators", [c.eventConditionId, slot(c.eventNoIndex)]),
    ]),
  })) as bigint[];
  settled.forEach(({ condition, denominator }, i) => {
    const payout = payoutOf(numerators[2 * i] ?? 0n, numerators[2 * i + 1] ?? 0n, denominator);
    if (payout)
      settlements.set(eventKey(condition), {
        source: "polymarket",
        payout,
        blockNumber: block.number,
        blockHash: block.hash,
      });
    else unsupported.push(condition);
  });
  return { settlements, unsupported };
}

/** Resolution evidence citing Polygon and Polymarket's API, or null until the API reports the
 * market resolved too. */
export function polymarketResolution(snapshot: Snapshot, settlement: PolymarketSettlement) {
  const { canonicalUrl, closed, resolutionStatus } = snapshot.normalized;
  if (!closed || resolutionStatus?.toLowerCase() !== "resolved") return null;
  const observedAt = new Date().toISOString();
  return {
    officialStatus: resolutionStatus,
    officialUrl: canonicalUrl,
    payout: settlement.payout,
    polygon: {
      chainId: "137",
      conditionalTokensAddress: POLYGON_CONDITIONAL_TOKENS,
      blockNumber: String(settlement.blockNumber),
      blockHash: settlement.blockHash,
      transactionHash: null,
    },
    sourceObservations: [
      { observedAt, payout: settlement.payout, status: resolutionStatus, url: canonicalUrl },
      {
        observedAt,
        payout: settlement.payout,
        status: `payout reported on Polygon at finalized block ${settlement.blockNumber}`,
        url: `https://polygonscan.com/address/${POLYGON_CONDITIONAL_TOKENS}`,
      },
    ],
    sourceReference: canonicalUrl,
  };
}
