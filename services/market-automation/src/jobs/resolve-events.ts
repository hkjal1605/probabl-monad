import { kalshiPayout } from "@conditional-stocks/market-data";
import type { Hex } from "viem";
import { eventKey, type Settlement } from "../settlement.ts";
import { kalshiResolution } from "../venues/kalshi.ts";
import { polymarketResolution, polymarketSettlements } from "../venues/polymarket.ts";
import type { WorldBookView } from "../worlds.ts";
import type { Job } from "./index.ts";

type Leg = WorldBookView["legs"][number] & {
  venue: NonNullable<WorldBookView["legs"][number]["venue"]>;
};
const DECIDED = new Set(["failed", "passed", "fixed"]);

/** Resolves the events of every undecided world book in `EventOracle`, one step per event per
 * run, as resolve-markets does for the exchange: freeze once the venue has a final result (or
 * its market closed), then commit the result as the market admin from a fresh venue snapshot
 * that agrees, then resolve as the resolution admin. INVALID (a venue's ½/½) fails the leg. */
export const resolveEvents: Job = {
  name: "resolve-events",
  everyMs: 60_000,
  async run({ worlds, polygon, execute, logger }) {
    if (!worlds) return;
    const events = new Map<Hex, Leg>();
    for (const b of await worlds.books())
      if (!DECIDED.has(b.state))
        for (const l of b.legs)
          if (l.venue && ["open", "frozen", "resolving"].includes(l.state))
            events.set(l.eventKey, l as Leg);
    if (!events.size) return;
    const condition = (l: Leg) => ({
      eventConditionId: l.venue.conditionId,
      eventYesIndex: String(l.venue.yesIndex),
      eventNoIndex: String(l.venue.noIndex),
    });
    const legs = [...events.values()];
    const polymarket = await polymarketSettlements(
      polygon,
      legs.filter((l) => l.venue.source === "polymarket").map(condition),
    );
    const settlements = new Map<Hex, Settlement>();
    for (const l of legs) {
      if (l.venue.source === "polymarket") {
        const s = polymarket.settlements.get(eventKey(condition(l)));
        if (s) settlements.set(l.eventKey, s);
      } else {
        const snapshot = await worlds.snapshot(l.eventKey).catch(() => null);
        const payout =
          snapshot?.normalized.source === "kalshi" ? kalshiPayout(snapshot.normalized) : null;
        if (payout) settlements.set(l.eventKey, { source: "kalshi", payout });
      }
    }
    const nowMs = Date.now();
    const evidence = legs.some((l) => l.state !== "open") ? await worlds.evidence() : [];
    for (const l of legs) {
      const settlement = settlements.get(l.eventKey);
      const closed = Date.parse(l.venue.endTime) <= nowMs;
      const fields = { event: l.eventKey, state: l.state, payout: settlement?.payout ?? null };
      if (!execute) {
        if (settlement || (closed && l.state === "open")) logger.info("resolve-event.due", fields);
        continue;
      }
      try {
        if (l.state === "open") {
          if (!settlement && !closed) continue;
          await worlds.freeze(l.eventKey, settlement ? "venue settled" : "venue closed");
          logger.info("resolve-event.step", { ...fields, step: "freeze" });
          continue;
        }
        if (!settlement) continue;
        const { yes, no, denominator } = settlement.payout;
        let packet = evidence.find((e) => {
          const p = e.envelope.packet;
          return (
            e.status !== "rejected" &&
            p.kind === "event-resolution" &&
            p.event.eventKey === l.eventKey &&
            p.payout.yes === yes &&
            p.payout.no === no &&
            p.payout.denominator === denominator
          );
        });
        if (!packet) {
          const snapshot = await worlds.fetchMetadata(l.venue.source, l.venue.marketId);
          const resolution =
            settlement.source === "kalshi"
              ? kalshiResolution(snapshot, settlement)
              : polymarketResolution(snapshot, settlement);
          if (!resolution) {
            logger.info("resolve-event.step", { ...fields, step: "awaiting-venue-api" });
            continue;
          }
          packet = await worlds.prepareResolution(l.eventKey, {
            metadataSnapshotId: snapshot.snapshotId,
            ...resolution,
          });
        }
        if (packet.status === "prepared")
          packet = await worlds.approve(
            packet,
            settlement.source === "kalshi"
              ? "Kalshi's final result"
              : "Polymarket's payout, read on Polygon",
          );
        const { action } = await worlds.execute(packet);
        logger.info("resolve-event.step", { ...fields, step: action });
      } catch (error) {
        logger.error("resolve-event.failed", {
          ...fields,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },
};
