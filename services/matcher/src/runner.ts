import type { MatcherEventEnvelope, MatchProposal } from "@conditional-stocks/orderbook";

import type { MatcherCoordinator } from "./coordinator.ts";

export interface MatcherEventSource extends AsyncIterable<MatcherEventEnvelope> {}

export interface MatcherRunnerOptions {
  onProposal: (proposal: MatchProposal) => Promise<void> | void;
  signal?: AbortSignal;
}

/** Connects the milestone-10 canonical event source to the deterministic core. */
export class MatcherRunner {
  readonly #coordinator: MatcherCoordinator;

  constructor(coordinator: MatcherCoordinator) {
    this.#coordinator = coordinator;
  }

  async run(source: MatcherEventSource, options: MatcherRunnerOptions): Promise<void> {
    await this.#coordinator.recover();
    for await (const event of source) {
      if (options.signal?.aborted) return;
      const result = await this.#coordinator.ingest(event);
      for (const proposal of result.proposals) await options.onProposal(proposal);
    }
  }
}
