/** The operations automation jobs build on: create markets from venue (Polymarket or Kalshi)
 * markets and stock tokens, and settle a market once its venue's result is final. Both are
 * idempotent, so a job may call them on every run. */
import { type EventSource, eventMarketId } from "@conditional-stocks/market-data";
import { type Address, getAddress } from "viem";
import {
  type Admin,
  AWAITING,
  type Evidence,
  FROZEN,
  type Market,
  OPEN,
  SCHEDULED,
} from "./admin.ts";
import type { Settlement } from "./settlement.ts";
import { kalshiResolution } from "./venues/kalshi.ts";
import { polymarketResolution } from "./venues/polymarket.ts";

/** Order and exposure limits in raw units of 18-decimal stocks and 6-decimal quote: 0.001-share
 * steps, $0.01 ticks, $0.10 to $10,000 orders, 1,000 shares per order, $100,000 open per wallet and
 * $1,000,000 per market. */
export const DEFAULT_LIMITS = {
  baseStep: "1000000000000000",
  priceTickRawX18: "10000",
  minNotional: "100000",
  maxOrderQuantity: "1000000000000000000000",
  maxOrderNotional: "10000000000",
  maxWalletOpenNotional: "100000000000",
  maxMarketOpenNotional: "1000000000000",
};
/** Fee rates in whole bps, as decimal strings (e.g. "25" = 0.25%), fixed at creation. */
export interface Fees {
  makerFeeBps: string;
  takerFeeBps: string;
}
export interface MarketSpec {
  /** The venue whose YES/NO market is the local market's event. */
  source: EventSource;
  /** The venue's id of that market: Polymarket's Gamma market id, or the Kalshi ticker. */
  marketId: string;
  /** The stock token traded conditionally on the event. */
  base: Address;
  /** Trading cutoff in unix seconds; the venue market's end time when omitted. */
  cutoff?: number;
  fees?: Fees;
  /** Maker rebate in bps of the taker fee (up to 5,000), set before the market opens. */
  makerRebateBps?: number;
  limits?: Partial<typeof DEFAULT_LIMITS>;
  /** Recorded with the approval. */
  note?: string;
}
export type Created = { spec: MarketSpec } & (
  | { marketId: string; created: boolean }
  | { error: string }
);

/** Creates and opens the market of each spec, unless it exists already. One spec failing does
 * not stop the others. `known` is a caller's fresh evidence and market lists, read otherwise. */
export async function createMarkets(
  admin: Admin,
  specs: MarketSpec[],
  known?: { evidence: Evidence[]; markets: Market[] },
): Promise<Created[]> {
  const unique = [
    ...new Map(specs.map((s) => [`${s.source}:${s.marketId}:${getAddress(s.base)}`, s])).values(),
  ];
  const [evidence, markets] = known
    ? [known.evidence, known.markets]
    : await Promise.all([admin.evidence(), admin.markets()]);
  const results: Created[] = [];
  for (const spec of unique) {
    try {
      results.push({ spec, ...(await createMarket(admin, spec, evidence, markets)) });
    } catch (error) {
      results.push({ spec, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

async function createMarket(
  admin: Admin,
  spec: MarketSpec,
  evidence: Evidence[],
  markets: Market[],
) {
  const base = getAddress(spec.base);
  const onChain = (list: Market[], condition: string) =>
    list.find(
      (m) =>
        m.eventConditionId.toLowerCase() === condition.toLowerCase() &&
        getAddress(m.baseToken) === base,
    );
  let packet = evidence.find((e) => {
    const p = e.envelope.packet;
    return (
      e.status !== "rejected" &&
      p.kind === "market-creation" &&
      p.event.source === spec.source &&
      p.event.marketId === spec.marketId &&
      getAddress(p.config.baseToken) === base
    );
  });
  let existing: Market | undefined;
  if (packet?.envelope.packet.kind === "market-creation") {
    const executed = packet.observations.some((o) => o.marketId);
    // A packet from an earlier run may also have been executed without being reconciled.
    existing = onChain(
      executed ? markets : await admin.markets(),
      packet.envelope.packet.event.conditionId,
    );
    if (executed && !existing) throw new Error("The created market is not indexed yet");
  } else {
    const snapshot = await admin.fetchMetadata(spec.source, spec.marketId);
    const { canonicalUrl, conditionId, endTime, rules } = snapshot.normalized;
    existing = onChain(markets, conditionId);
    if (!existing) {
      const now = Math.floor(Date.now() / 1000);
      const cutoff = spec.cutoff ?? Math.floor(Date.parse(endTime) / 1000);
      if (cutoff <= now + 60) throw new Error("The market closes within a minute");
      packet = await admin.prepare("creation", {
        metadataSnapshotId: snapshot.snapshotId,
        sourceUrls: [canonicalUrl],
        attachments: [],
        config: {
          baseToken: base,
          quoteToken: await admin.quote(),
          ...DEFAULT_LIMITS,
          ...spec.limits,
          ...(spec.fees ?? { makerFeeBps: "0", takerFeeBps: "0" }),
          tradingOpen: String(now - 60),
          tradingCutoff: String(cutoff),
          metadataUri: canonicalUrl,
          rules,
        },
      });
    }
  }
  let marketId = existing?.venue.marketId;
  if (!marketId) {
    if (!packet) throw new Error("No creation evidence");
    if (packet.status === "prepared") packet = await admin.approve(packet, spec.note ?? "");
    ({ marketId } = await admin.execute(packet));
  }
  const market = existing ?? { state: SCHEDULED, makerRebateBps: 0 };
  if (market.state === SCHEDULED) {
    const rebate = spec.makerRebateBps ?? 0;
    if (rebate !== market.makerRebateBps) await admin.setMakerRebate(marketId, rebate);
    await admin.lifecycle(marketId, 0);
  }
  return { marketId, created: !existing };
}

/** Advances an open, frozen or awaiting market one step toward its venue's final result:
 * freeze (at the cutoff, or early once the result is known), commit the resolution, resolve.
 * `evidence` is the recent packet list (`admin.evidence()`), needed past the freeze. Returns
 * the step taken, or why none was. */
export async function settleMarket(
  admin: Admin,
  market: Market,
  settlement: Settlement,
  evidence: Evidence[],
) {
  const id = market.venue.marketId;
  if (market.state === OPEN) {
    if (Date.now() / 1000 >= Number(market.tradingCutoff)) {
      await admin.lifecycle(id, 2);
      return "freeze-at-cutoff";
    }
    await admin.lifecycle(id, 1, "The event settled before the market's trading cutoff");
    return "freeze-early";
  }
  if (market.state !== FROZEN && market.state !== AWAITING) return "not-active";
  const { yes, no, denominator } = settlement.payout;
  // The newest packet for this payout; the API's stored packets do not keep key order.
  let packet = evidence.find((e) => {
    const p = e.envelope.packet;
    return (
      e.status !== "rejected" &&
      p.kind === "market-resolution" &&
      p.localMarket.marketId === id &&
      p.payout.yes === yes &&
      p.payout.no === no &&
      p.payout.denominator === denominator
    );
  });
  if (!packet) {
    const latest = (await admin.event(id)).normalized;
    if (latest.source !== settlement.source) throw new Error("The event's venue changed");
    const snapshot = await admin.fetchMetadata(latest.source, eventMarketId(latest));
    // The venue's own API must agree before evidence cites it.
    const resolution =
      settlement.source === "kalshi"
        ? kalshiResolution(snapshot, settlement)
        : polymarketResolution(snapshot, settlement);
    if (!resolution) return "awaiting-venue-api";
    packet = await admin.prepare("resolution", {
      marketId: id,
      metadataSnapshotId: snapshot.snapshotId,
      attachments: [],
      ...resolution,
    });
  }
  if (packet.status === "prepared")
    packet = await admin.approve(
      packet,
      settlement.source === "kalshi"
        ? "Kalshi's final result"
        : "Polymarket's payout, read on Polygon",
    );
  return (await admin.execute(packet)).action;
}
