import { AWAITING, FROZEN, OPEN } from "../admin.ts";
import { settleMarket } from "../markets.ts";
import { eventKey, type Settlement } from "../settlement.ts";
import { kalshiSettlements } from "../venues/kalshi.ts";
import { polymarketSettlements } from "../venues/polymarket.ts";
import type { Job } from "./index.ts";

/** Events already reported as unsettleable, so each is logged once per process. */
const unsupported = new Set<string>();

/** Settles every active market whose event has a final result on its venue (Polymarket's payout
 * on Polygon, Kalshi's finalized result), one step per market per run: freeze, commit the
 * resolution (market admin), resolve (resolution admin). */
export const resolveMarkets: Job = {
  name: "resolve-markets",
  everyMs: 60_000,
  async run({ admin, polygon, execute, logger }) {
    const active = (await admin.markets()).filter((m) =>
      [OPEN, FROZEN, AWAITING].includes(m.state),
    );
    const [polymarket, kalshi] = await Promise.all([
      polymarketSettlements(
        polygon,
        active.filter((m) => m.eventSource === "polymarket"),
      ),
      kalshiSettlements(
        admin,
        active.filter((m) => m.eventSource === "kalshi"),
      ),
    ]);
    for (const condition of polymarket.unsupported) {
      const key = eventKey(condition);
      if (unsupported.has(key)) continue;
      unsupported.add(key);
      logger.warn("resolve.unsupported-payout", { condition: condition.eventConditionId });
    }
    const settlements = new Map<string, Settlement>([...polymarket.settlements, ...kalshi]);
    const due = active.flatMap((market) => {
      const settlement = settlements.get(eventKey(market));
      return settlement ? [{ market, settlement }] : [];
    });
    if (!due.length) return;
    if (!execute) {
      for (const { market, settlement } of due)
        logger.info("resolve.due", {
          market: market.venue.marketId,
          source: settlement.source,
          payout: settlement.payout,
        });
      return;
    }
    // A step acts on the API's indexed state, which trails the chain for a few seconds: a
    // market whose index has not caught up waits for the next run.
    const states = await admin.chainStates(due.map(({ market }) => market.venue.marketId));
    const current = due.filter(({ market }, i) => states[i] === market.state);
    const evidence = current.some(({ market }) => market.state !== OPEN)
      ? await admin.evidence()
      : [];
    for (const { market, settlement } of current) {
      const fields = {
        market: market.venue.marketId,
        state: market.state,
        source: settlement.source,
        payout: settlement.payout,
      };
      try {
        logger.info("resolve.step", {
          ...fields,
          step: await settleMarket(admin, market, settlement, evidence),
        });
      } catch (error) {
        logger.error("resolve.failed", {
          ...fields,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },
};
