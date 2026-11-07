/** World history, recorded once a minute: each book product's best indicative prices (the
 * charts) and the venue probability of every leg of a live book (what the world keeper's factor
 * fit reads). Every API process may record; a minute's first write is kept. */
import type { Database, EventProbabilityRow, WorldPriceRow } from "@conditional-stocks/db";
import { BOOK_STATUS } from "@conditional-stocks/evm-client";
import type { WorldIndexer } from "@conditional-stocks/indexer/worlds";
import type { Hex } from "viem";
import type { WorldBookPrices } from "../rfq/hub.ts";

const RECORD_DELAY_MS = 2_000;

export class WorldRecorder {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly deps: {
      indexer: Pick<WorldIndexer, "domain" | "trading" | "meta">;
      db: Pick<Database, "recordWorldPrices" | "recordEventProbabilities">;
      /** The world makers' current prices (`RfqHub.worldPrices`). */
      quotes: () => Map<number, WorldBookPrices>;
      /** A condition's latest probability tick (the API's cached ingestor read). */
      probability: (condition: Hex) => Promise<unknown>;
      onError?: (error: unknown) => void;
    },
  ) {}

  start() {
    this.stopped = false;
    this.schedule();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(
      () =>
        void this.record()
          .catch((error) => this.deps.onError?.(error))
          .finally(() => this.schedule()),
      60_000 - (Date.now() % 60_000) + RECORD_DELAY_MS,
    );
  }

  /** Records the minute containing `nowMs`. */
  async record(nowMs = Date.now()) {
    const { indexer, db } = this.deps;
    const minute = Math.floor(nowMs / 60_000);
    const s = indexer.trading();
    const prices: WorldPriceRow[] = [];
    for (const [book, p] of this.deps.quotes())
      for (const [product, q] of p.products)
        if (q.bid !== null || q.ask !== null)
          prices.push({ book, product, minute, bid: q.bid, ask: q.ask });
    // Every leg of an undecided book, once each.
    const conditions = new Set<Hex>();
    for (const b of s.books.values()) {
      if (b.status !== BOOK_STATUS.undecided) continue;
      for (const leg of indexer.meta(b.defHash)?.metadata.legs ?? [])
        conditions.add(leg.conditionId.toLowerCase() as Hex);
    }
    const ticks = await Promise.allSettled(
      [...conditions].map(async (condition) => {
        const tick = (await this.deps.probability(condition)) as Record<string, unknown>;
        const mid = Number(tick?.midpointX6),
          spread = Number(tick?.spreadX6);
        if (tick?.quality !== "valid" || !Number.isInteger(mid) || mid < 0 || mid > 1_000_000)
          return null;
        return {
          condition,
          minute,
          mid,
          spread: Number.isInteger(spread) ? spread : null,
        } satisfies EventProbabilityRow;
      }),
    );
    const probabilities = ticks.flatMap((t) =>
      t.status === "fulfilled" && t.value ? [t.value] : [],
    );
    await Promise.all([
      db.recordWorldPrices(indexer.domain, prices),
      db.recordEventProbabilities(probabilities),
    ]);
    return { prices: prices.length, probabilities: probabilities.length };
  }
}
