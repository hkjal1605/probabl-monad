import type { TradingSafety } from "@conditional-stocks/config";
import {
  type ChainCursor,
  canonicalParse,
  type MatcherEventEnvelope,
} from "@conditional-stocks/orderbook";
import type { Hex } from "viem";
import type { MatcherCoordinator } from "./coordinator.ts";
import { logger } from "./logger.ts";
import type { SettlementWorkerClient } from "./settlement.ts";

export interface EventPage {
  schemaVersion: 2;
  events: MatcherEventEnvelope[];
  hasMore: boolean;
  confirmedThrough: bigint;
}
export class CursorReorg extends Error {
  constructor(readonly rewindToBlock: bigint) {
    super("canonical matcher cursor reorganized");
  }
}
export class HttpMatcherSource {
  constructor(
    readonly url: string,
    readonly chainId: number,
  ) {}
  async page(cursor: ChainCursor | null): Promise<EventPage> {
    const query = new URLSearchParams({ limit: "1000" });
    if (cursor) {
      query.set("afterBlock", String(cursor.blockNumber));
      query.set("afterBlockHash", cursor.blockHash);
      query.set("afterTransactionIndex", String(cursor.transactionIndex));
      query.set("afterLogIndex", String(cursor.logIndex));
    }
    const response = await fetch(`${this.url}/internal/matcher-events?${query}`, {
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (response.status === 409) {
      const body = canonicalParse<{ rewindToBlock: bigint }>(await response.text());
      if (typeof body.rewindToBlock !== "bigint" || body.rewindToBlock < 0n)
        throw new Error("invalid rewind response");
      throw new CursorReorg(body.rewindToBlock);
    }
    if (!response.ok) throw new Error(`matcher event source unavailable (${response.status})`);
    const page = canonicalParse<EventPage>(await response.text());
    if (
      page.schemaVersion !== 2 ||
      !Array.isArray(page.events) ||
      typeof page.hasMore !== "boolean" ||
      typeof page.confirmedThrough !== "bigint"
    )
      throw new Error("invalid matcher stream schema");
    for (const event of page.events) {
      if (
        event.cursor.chainId !== BigInt(this.chainId) ||
        event.cursor.blockNumber > page.confirmedThrough
      )
        throw new Error("unsafe matcher stream event");
    }
    if (page.hasMore && page.events.length === 0) throw new Error("empty nonterminal matcher page");
    return page;
  }
}

/** One serialized pass: recover/drain canonical history, then deliver durable proposals. */
export class MatcherRuntime {
  healthy = false;
  lastSuccessAt: number | null = null;
  error: string | null = null;
  fatal = false;
  #running = false;
  #recovered = false;

  constructor(
    readonly coordinator: MatcherCoordinator,
    readonly source: Pick<HttpMatcherSource, "page">,
    readonly settlement: Pick<SettlementWorkerClient, "enqueue" | "status">,
    readonly safety: TradingSafety,
  ) {}

  async tick(): Promise<void> {
    if (this.#running || this.fatal) return;
    this.#running = true;
    const previousError = this.error;
    const previouslyHealthy = this.healthy;
    try {
      if (!this.#recovered) {
        await this.coordinator.recover();
        this.#recovered = true;
        logger.info("matcher.recovered", {
          blockNumber: this.coordinator.checkpoint.cursor?.blockNumber,
          activeProposals: (await this.coordinator.activeProposals()).length,
          books: this.coordinator.checkpoint.books.length,
        });
      }
      for (let pages = 0; ; pages += 1) {
        const page = await this.source.page(this.coordinator.checkpoint.cursor);
        if (page.events.length)
          logger.debug("matcher.events.received", {
            count: page.events.length,
            hasMore: page.hasMore,
            confirmedThrough: page.confirmedThrough,
          });
        for (const event of page.events) {
          try {
            await this.coordinator.ingest(event, { propose: false });
          } catch (error) {
            this.fatal = true;
            throw error;
          }
        }
        if (!page.hasMore) break;
        if (pages >= 99) {
          this.healthy = false;
          return;
        } // Yield during a large catch-up without trading old state.
      }
      for (const record of await this.coordinator.activeProposals())
        await this.#deliver(record.proposal.proposalId);
      const books = this.coordinator.checkpoint.books;
      for (const book of books) {
        await this.safety.assertCanTrade([book.marketId]);
        const proposal = await this.coordinator.processBook(`${book.marketId}:${book.branch}`, {
          retryTerminal: false,
        });
        if (proposal) await this.#deliver(proposal.proposalId);
      }
      // Includes the no-market case: readiness cannot turn green without the control plane.
      await this.safety.assertCanTrade([]);
      this.healthy = true;
      this.lastSuccessAt = Date.now();
      this.error = null;
      if (!previouslyHealthy)
        logger.info("matcher.ready", {
          blockNumber: this.coordinator.checkpoint.cursor?.blockNumber,
          books: books.length,
        });
    } catch (error) {
      this.healthy = false;
      this.error = error instanceof Error ? error.message : String(error);
      if (this.error !== previousError || previouslyHealthy)
        logger.error("matcher.unavailable", { fatal: this.fatal, error });
      if (error instanceof CursorReorg) {
        try {
          await this.coordinator.rewindToBlock(error.rewindToBlock);
          logger.warn("matcher.rewound", { rewindToBlock: error.rewindToBlock });
        } catch (cause) {
          this.fatal = true;
          this.error = String(cause);
          logger.error("matcher.recovery.failed", { error: cause });
        }
      }
    } finally {
      this.#running = false;
    }
  }

  async #deliver(id: Hex): Promise<void> {
    const record = await this.coordinator.proposal(id);
    if (!record) return;
    const status = await this.settlement.status(record.proposal.batchId);
    if (status === "failed" || status === "quarantined") {
      await this.coordinator.failProposal(id, `worker:${status}`);
      logger.warn("matcher.proposal.rejected", { proposalId: id, status });
      return;
    }
    if (status !== null) return; // Only canonical fill events release successful reservations.
    await this.safety.assertCanTrade([
      ...new Set(record.proposal.fills.map((fill) => fill.buyOrder.marketId)),
    ]);
    await this.settlement.enqueue(record.proposal);
    logger.info("matcher.proposal.delivered", {
      proposalId: id,
      batchId: record.proposal.batchId,
      fills: record.proposal.fills.length,
      anchorBlock: record.proposal.cursor.blockNumber,
    });
  }
}
