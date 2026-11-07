import { FIX_WINDOW } from "../worlds.ts";
import type { Job } from "./index.ts";

/** Fixes every world book awaiting its fixing: proposes the provably last feed round at or
 * before its fixing time (anyone may; the market admin's key pays), finalizes it once it has
 * stood FIX_WINDOW, and reports a book whose fixing must go to the two-key fallback (no
 * provable round by its deadline, or a held proposal). */
export const fixBooks: Job = {
  name: "fix-books",
  everyMs: 60_000,
  async run({ worlds, execute, logger }) {
    if (!worlds) return;
    const now = Math.floor(Date.now() / 1000);
    for (const b of await worlds.books()) {
      if (b.state !== "awaitingFix" || !b.feed || !b.fixingTime) continue;
      const fields = { book: b.id, fixingTime: b.fixingTime };
      try {
        if (b.fixing.held) {
          logger.warn("fix-books.held", fields);
          continue;
        }
        const proposal = b.fixing.proposal;
        if (proposal) {
          if (now < Number(proposal.proposedAt) + FIX_WINDOW) continue;
          if (!execute) logger.info("fix-books.finalize-due", fields);
          else
            logger.info("fix-books.finalized", { ...fields, tx: await worlds.finalizeFix(b.id) });
          continue;
        }
        const round = await worlds.fixingRound(b.feed, Number(b.fixingTime), b.maxStaleness);
        if (!round) {
          if (b.fixing.fallbackAt && now >= Number(b.fixing.fallbackAt))
            logger.warn("fix-books.fallback-needed", {
              ...fields,
              reason: "No provable round in time",
            });
          continue;
        }
        if (!execute) logger.info("fix-books.propose-due", { ...fields, round: round.id });
        else
          logger.info("fix-books.proposed", {
            ...fields,
            round: round.id,
            price: round.answer,
            tx: await worlds.proposeFix(b.id, round.id),
          });
      } catch (error) {
        logger.error("fix-books.failed", {
          ...fields,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },
};
