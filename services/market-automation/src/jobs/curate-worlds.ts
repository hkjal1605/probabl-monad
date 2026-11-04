import { curatedBook } from "../worlds.ts";
import type { Job } from "./index.ts";

/** Creates each curated world's next book (AUTOMATION_WORLDS_PATH): its fixing by its rule and
 * its strikes around the feed's price now, through the book-creation evidence flow. A world has
 * one live book per fixing: a book (or an unexecuted packet) with the same legs and fixing is
 * carried through instead of a new one. */
export const curateWorlds: Job = {
  name: "curate-worlds",
  everyMs: 15 * 60_000,
  async run({ worlds, curated, execute, logger, client }) {
    if (!worlds || !client || !curated?.length) return;
    const nowS = Math.floor(Date.now() / 1000);
    const [books, evidence] = await Promise.all([worlds.books(), worlds.evidence()]);
    for (const world of curated) {
      try {
        const request = await curatedBook(world, client, nowS);
        const fixing = (request.book as { fixingTime?: string }).fixingTime ?? null;
        const cutoff = (request.book as { cutoff?: string }).cutoff;
        const legs = world.legs
          .map((l) => `${l.source}:${l.marketId}:${l.wantYes !== false}`)
          .join("|");
        const same = (marketLegs: string, time: string | null, end: string) =>
          marketLegs === legs && (fixing ? time === fixing : end === cutoff);
        const live = books.find((b) =>
          same(
            b.legs.map((l) => `${l.venue?.source}:${l.venue?.marketId}:${l.wantYes}`).join("|"),
            b.fixingTime,
            b.cutoff,
          ),
        );
        if (live) continue;
        let packet = evidence.find((e) => {
          const p = e.envelope.packet;
          return (
            e.status !== "rejected" &&
            p.kind === "book-creation" &&
            !e.observations.length &&
            same(
              p.legs.map((l) => `${l.source}:${l.marketId}:${l.wantYes}`).join("|"),
              p.book.fixingTime === "0" ? null : p.book.fixingTime,
              p.book.cutoff,
            )
          );
        });
        if (!execute) {
          logger.info("curate-worlds.due", {
            title: world.title,
            fixing,
            cutoff,
            pending: Boolean(packet),
          });
          continue;
        }
        packet ??= await worlds.prepareBook(request);
        if (packet.status === "prepared")
          packet = await worlds.approve(packet, `Curated: ${world.title}`);
        const { transactionHash } = await worlds.execute(packet);
        logger.info("curate-worlds.created", { title: world.title, fixing, transactionHash });
      } catch (error) {
        logger.error("curate-worlds.failed", {
          title: world.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },
};
