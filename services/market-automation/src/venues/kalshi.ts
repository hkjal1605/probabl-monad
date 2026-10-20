/** Kalshi settles markets off chain: its API's final result (a finalized market's yes/no) is what
 * local markets settle to. The ingestor polls every followed market, so its latest snapshot
 * shows the result within a minute; evidence then cites a fresh snapshot that must agree. */
import { kalshiPayout, type PayoutVector } from "@conditional-stocks/market-data";
import type { Admin, Market, Snapshot } from "../admin.ts";
import { eventKey } from "../settlement.ts";

export interface KalshiSettlement {
  source: "kalshi";
  payout: PayoutVector;
}

/** Kalshi's public API page of one market, cited next to its web page. */
const apiUrl = (ticker: string) =>
  `https://api.elections.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}`;

/** Final results of the Kalshi events of `markets`, keyed by `eventKey`: one read of the
 * ingestor's latest snapshot per event. Events without a final result, or unreadable now, are
 * absent. */
export async function kalshiSettlements(admin: Admin, markets: Market[]) {
  const events = [...new Map(markets.map((m) => [eventKey(m), m])).entries()];
  const settlements = new Map<string, KalshiSettlement>();
  await Promise.allSettled(
    events.map(async ([key, market]) => {
      const { normalized } = await admin.event(market.venue.marketId);
      const payout = normalized.source === "kalshi" ? kalshiPayout(normalized) : null;
      if (payout) settlements.set(key, { source: "kalshi", payout });
    }),
  );
  return settlements;
}

/** Resolution evidence citing Kalshi, or null unless the fresh snapshot shows the same final
 * result. Kalshi has no Polygon record. */
export function kalshiResolution(snapshot: Snapshot, settlement: KalshiSettlement) {
  const market = snapshot.normalized;
  if (market.source !== "kalshi") return null;
  const payout = kalshiPayout(market);
  if (
    !payout ||
    payout.yes !== settlement.payout.yes ||
    payout.no !== settlement.payout.no ||
    payout.denominator !== settlement.payout.denominator
  )
    return null;
  const observedAt = new Date().toISOString();
  const status = `${market.status}: ${market.result}`;
  return {
    officialStatus: market.status,
    officialUrl: market.canonicalUrl,
    payout,
    polygon: null,
    sourceObservations: [
      { observedAt, payout, status, url: market.canonicalUrl },
      { observedAt, payout, status, url: apiUrl(market.ticker) },
    ],
    sourceReference: market.canonicalUrl,
  };
}
