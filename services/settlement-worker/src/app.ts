import { TradingUnavailableError } from "@conditional-stocks/config";
import type { SettlementQueries } from "@conditional-stocks/db/settlement";
import type { IocBatchPayload, IocIntent } from "@conditional-stocks/db/settlement/types";
import { canonicalParse } from "@conditional-stocks/orderbook";
import { requestLogging } from "@conditional-stocks/shared/http";
import { Hono } from "hono";
import type { SettlementEnvironment } from "./chain.ts";
import { logger } from "./logger.ts";
import type { SettlementWorker } from "./worker.ts";

const json = (value: unknown, status = 200): Response =>
  new Response(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
    { headers: { "content-type": "application/json; charset=utf-8" }, status },
  );

export const createSettlementApp = (
  worker: SettlementWorker,
  store: SettlementQueries,
  environment: SettlementEnvironment,
) => {
  const app = new Hono();
  app.use(
    "*",
    requestLogging(logger, {
      quietPaths: [
        "/health",
        "/ready",
        "/internal/batches/:batchId",
        "/internal/ioc-intents/:intentId",
      ],
    }),
  );
  app.onError((error) =>
    json({ error: error.message }, error instanceof TradingUnavailableError ? 503 : 400),
  );
  app.use("/internal/*", async (context, next) => {
    if (context.req.header("authorization") !== `Bearer ${environment.internalToken}`) {
      return json({ error: "unauthorized" }, 401);
    }
    return next();
  });
  app.get("/health", () =>
    json({
      chainId: environment.chainId,
      ownerId: environment.ownerId,
      service: "conditional-stocks-settlement-worker",
      status: "ok",
      version: 2,
    }),
  );
  app.post("/internal/proposals", async (context) => {
    const proposal = canonicalParse<Parameters<SettlementWorker["enqueueProposal"]>[0]>(
      await context.req.text(),
    );
    await worker.safety?.assertCanTrade([
      ...new Set(proposal.fills.map((fill) => fill.buyOrder.marketId)),
    ]);
    return json(await worker.enqueueProposal(proposal), 202);
  });
  app.post("/internal/ioc-intents", async (context) => {
    const body = canonicalParse<Omit<IocIntent, "createdAtMs" | "intentId" | "status">>(
      await context.req.text(),
    );
    await worker.safety?.assertCanTrade([body.order.marketId]);
    const intent = await worker.enqueueIocIntent(body);
    return json({ batchId: intent.intentId, state: intent.status }, 202);
  });
  app.post("/internal/ioc-plans", async (context) => {
    const body = canonicalParse<
      Omit<IocBatchPayload, "schemaVersion" | "takerOrder" | "takerSignature">
    >(await context.req.text());
    return json(await worker.enqueueIocPlan(body), 202);
  });
  app.get("/internal/batches/:batchId", async (context) => {
    const batchId = context.req.param("batchId") as `0x${string}`;
    const batch = await store.getBatch(batchId);
    return batch
      ? json({ attempts: await store.attempts(batchId), batch })
      : json({ error: "not-found" }, 404);
  });
  app.get("/internal/ioc-intents/:intentId", async (context) => {
    const id = context.req.param("intentId") as `0x${string}`;
    const intent = await store.getIntent(id);
    if (!intent) return json({ error: "not-found" }, 404);
    const batch = await store.batchForIntent(id);
    return json({
      state: batch?.status ?? intent.status,
      batchId: batch?.batchId ?? null,
      error: batch?.error ?? null,
    });
  });
  app.get("/ready", async () => {
    await worker.safety?.assertCanTrade([]);
    return json({ healthy: true, chainId: environment.chainId, protocolVersion: 2 });
  });
  app.post("/internal/process/:batchId", async (context) =>
    json(await worker.process(context.req.param("batchId") as `0x${string}`)),
  );
  return app;
};
