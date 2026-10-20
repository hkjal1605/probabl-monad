import { AWAITING, FROZEN, OPEN } from "../admin.ts";
import { settleMarket } from "../markets.ts";
import { payoutKey, reportedPayouts } from "../polygon.ts";
import type { Job } from "./index.ts";

/** Conditions already reported as unsettleable, so each is logged once per process. */
const unsupported = new Set<string>();

/** Settles every active market whose Polymarket market has paid out on Polygon, one step per
 * market per run: freeze, commit the resolution (market admin), resolve (resolution admin). */
export const resolveMarkets: Job = {
  name: "resolve-markets",
  everyMs: 60_000,
  async run({ admin, polygon, execute, logger }) {
    const active = (await admin.markets()).filter((m) =>
      [OPEN, FROZEN, AWAITING].includes(m.state),
    );
    const reported = await reportedPayouts(polygon, active);
    for (const condition of reported.unsupported) {
      const key = payoutKey(condition);
      if (unsupported.has(key)) continue;
      unsupported.add(key);
      logger.warn("resolve.unsupported-payout", { condition: condition.polymarketConditionId });
    }
    const due = active.flatMap((market) => {
      const payout = reported.payouts.get(payoutKey(market));
      return payout ? [{ market, payout }] : [];
    });
    if (!due.length) return;
    if (!execute) {
      for (const { market, payout } of due)
        logger.info("resolve.due", { market: market.venue.marketId, payout: payout.payout });
      return;
    }
    // A step acts on the API's indexed state, which trails the chain for a few seconds: a
    // market whose index has not caught up waits for the next run.
    const states = await admin.chainStates(due.map(({ market }) => market.venue.marketId));
    const current = due.filter(({ market }, i) => states[i] === market.state);
    const evidence = current.some(({ market }) => market.state !== OPEN)
      ? await admin.evidence()
      : [];
    for (const { market, payout } of current) {
      const fields = { market: market.venue.marketId, state: market.state, payout: payout.payout };
      try {
        logger.info("resolve.step", {
          ...fields,
          step: await settleMarket(admin, market, payout, evidence),
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
