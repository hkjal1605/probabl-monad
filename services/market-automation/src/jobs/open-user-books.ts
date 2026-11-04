import type { Job } from "./index.ts";

/** Creates the books of worlds members opened (docs/version-2-plan.md §9): the API approves a
 * member's world by its rules and lists it at `/v2/admin/user-books` (from memory, so polling
 * it is cheap); each is created once, oldest first, through the evidence flow's execute step
 * (the transaction rebuilt locally from the packet and signed only when it matches the API's
 * preview). A member waits on this job, so it runs every two seconds. */
export const openUserBooks: Job = {
  name: "open-user-books",
  everyMs: 2_000,
  async run({ worlds, execute, logger }) {
    if (!worlds) return;
    const pending = await worlds.userBooks();
    for (const packet of pending) {
      const title = (packet.envelope.packet as { title?: string }).title ?? null;
      if (!execute) {
        logger.info("open-user-books.due", { packet: packet.envelope.packetHash, title });
        continue;
      }
      try {
        const { transactionHash } = await worlds.execute(packet);
        logger.info("open-user-books.created", {
          packet: packet.envelope.packetHash,
          transactionHash,
        });
      } catch (error) {
        logger.error("open-user-books.failed", {
          packet: packet.envelope.packetHash,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },
};
