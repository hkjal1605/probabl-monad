import { type Cadence, inWindow, type Ladder, planLadder, targetEvent } from "../ladders.ts";
import { createMarkets } from "../markets.ts";
import type { KalshiEvent } from "../venues/kalshi-api.ts";
import type { Job } from "./index.ts";

/** Creates each ladder's markets for its next fixing: the configured tokens on the Kalshi strikes
 * nearest even odds. A ladder whose fixing has all its markets is not read again until the next
 * fixing is due, so a quiet run calls neither Kalshi nor the API. */
function ladderJob(cadence: Cadence, everyMs: number): Job {
  /** Each ladder's fixing whose markets all exist. */
  const complete = new Map<Ladder, KalshiEvent>();
  return {
    name: `${cadence}-ladders`,
    everyMs,
    async run({ admin, kalshi, ladders, execute, logger }) {
      const now = Date.now();
      const due: { ladder: Ladder; event: KalshiEvent }[] = [];
      for (const ladder of ladders[cadence]) {
        const done = complete.get(ladder);
        if (done && inWindow(cadence, ladder, done.fixing, now)) continue;
        complete.delete(ladder);
        const event = targetEvent(cadence, ladder, await kalshi.openEvents(ladder.series), now);
        if (event) due.push({ ladder, event });
      }
      if (!due.length) return;
      const [markets, evidence] = await Promise.all([admin.markets(), admin.evidence()]);
      for (const { ladder, event } of due) {
        const plans = planLadder(
          cadence,
          ladder,
          event,
          await kalshi.strikes(event.eventTicker),
          markets,
          evidence,
        );
        const specs = plans.flatMap((p) => p.specs);
        const short = plans.filter((p) => p.short).map((p) => `${p.token.symbol} ${p.short}`);
        const fields = { series: ladder.series, event: event.eventTicker };
        if (short.length) logger.warn("ladders.short", { ...fields, missing: short });
        if (!specs.length) {
          if (!short.length) complete.set(ladder, event);
          continue;
        }
        if (!execute) {
          logger.info("ladders.due", { ...fields, markets: specs.map((s) => s.marketId) });
          continue;
        }
        const results = await createMarkets(admin, specs, { evidence, markets });
        for (const result of results) {
          const symbol = ladder.tokens.find((t) => t.base === result.spec.base)?.symbol;
          if ("error" in result)
            logger.error("ladders.failed", {
              ...fields,
              ticker: result.spec.marketId,
              symbol,
              error: result.error,
            });
          else
            logger.info("ladders.created", {
              ...fields,
              ticker: result.spec.marketId,
              symbol,
              marketId: result.marketId,
            });
        }
        if (!short.length && results.every((r) => !("error" in r))) complete.set(ladder, event);
      }
    },
  };
}

/** Weekday fixings within a day: e.g. MSTR if BTC ≥ $K at 5 pm ET today. */
export const dailyLadders = ladderJob("daily", 10 * 60_000);
/** Friday fixings, from two to seven days ahead. */
export const weeklyLadders = ladderJob("weekly", 30 * 60_000);
