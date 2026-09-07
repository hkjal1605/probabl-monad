import { canonicalStringify, type MatchProposal } from "@conditional-stocks/orderbook";
import { requestLogging } from "@conditional-stocks/shared/http";
import { Hono } from "hono";
import type { Hex } from "viem";
import type { MatcherCoordinator } from "./coordinator.ts";
import { logger } from "./logger.ts";

export class SettlementWorkerClient {
  constructor(
    readonly baseUrl: string,
    readonly token: string,
  ) {}

  async enqueue(proposal: MatchProposal): Promise<void> {
    const response = await fetch(`${this.baseUrl}/internal/proposals`, {
      body: canonicalStringify(proposal),
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/vnd.conditional-stocks.canonical+json",
      },
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`settlement worker returned ${response.status}`);
  }

  async status(batchId: Hex): Promise<string | null> {
    const response = await fetch(`${this.baseUrl}/internal/batches/${batchId}`, {
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`settlement worker returned ${response.status}`);
    const body = (await response.json()) as { batch: { status: string } };
    return body.batch.status;
  }
}

/**
 * Accepts failure notifications from the worker so pending matcher reservations are released.
 * Success is deliberately ignored here: only canonical OrderFilled events may confirm a proposal.
 */
export const createMatcherSettlementApp = (
  coordinator: MatcherCoordinator,
  internalToken: string,
) => {
  const app = new Hono();
  app.use("*", requestLogging(logger, { quietPaths: ["/health", "/metrics"] }));
  app.post("/internal/proposals/:batchId/settlement", async (context) => {
    if (context.req.header("authorization") !== `Bearer ${internalToken}`) {
      return context.json({ error: "unauthorized" }, 401);
    }
    const batchId = context.req.param("batchId") as Hex;
    const body = (await context.req.json()) as {
      classification?: string;
      message?: string;
      status?: string;
    };
    if (body.status === "failed" && (await coordinator.proposal(batchId))) {
      await coordinator.failProposal(
        batchId,
        `${body.classification ?? "settlement-failed"}: ${body.message ?? "unknown"}`,
      );
    }
    return context.json({ accepted: true, canonicalConfirmationRequired: true });
  });
  return app;
};
