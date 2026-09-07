import { HttpTradingSafety, loadMatcherConfig, releasePolicy } from "@conditional-stocks/config";
import { loadDatabaseOptions, openDatabase } from "@conditional-stocks/db/connection";
import { createMatcherQueries } from "@conditional-stocks/db/matcher";
import { canonicalStringify } from "@conditional-stocks/orderbook";
import { MatcherCoordinator } from "./coordinator.ts";
import { logger } from "./logger.ts";
import { HttpMatcherSource, MatcherRuntime } from "./runtime.ts";
import { createMatcherSettlementApp, SettlementWorkerClient } from "./settlement.ts";

async function main() {
  const config = loadMatcherConfig(Bun.env);
  const chainId = Number(Bun.env.ROBINHOOD_CHAIN_ID);
  releasePolicy(chainId, Bun.env);
  const token = Bun.env.SETTLEMENT_INTERNAL_TOKEN;
  if (!token || token.length < 32)
    throw new Error("SETTLEMENT_INTERNAL_TOKEN must have at least 32 characters");
  const database = await openDatabase(loadDatabaseOptions(Bun.env, "probabl-matcher"));
  const coordinator = new MatcherCoordinator(createMatcherQueries(database), config);
  const runtime = new MatcherRuntime(
    coordinator,
    new HttpMatcherSource(Bun.env.INDEXER_URL ?? "http://127.0.0.1:42069", chainId),
    new SettlementWorkerClient(Bun.env.SETTLEMENT_WORKER_URL ?? "http://127.0.0.1:42071", token),
    new HttpTradingSafety(Bun.env),
  );
  const app = createMatcherSettlementApp(coordinator, token);
  const interval = Number(Bun.env.MATCHER_POLL_INTERVAL_MS ?? "500");
  const port = Number(Bun.env.MATCHER_PORT ?? "42072");
  if (
    !Number.isSafeInteger(interval) ||
    interval < 100 ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error("invalid matcher polling interval or port");
  app.get("/health", (context) => {
    const healthy =
      runtime.healthy &&
      runtime.lastSuccessAt !== null &&
      Date.now() - runtime.lastSuccessAt < Math.max(30_000, interval * 3);
    return context.json(
      {
        healthy,
        fatal: runtime.fatal,
        error: runtime.error,
        lastSuccessAt: runtime.lastSuccessAt,
        chainId,
        service: "conditional-stocks-matcher",
        version: 2,
      },
      healthy ? 200 : 503,
    );
  });
  app.get(
    "/metrics",
    () =>
      new Response(canonicalStringify(coordinator.metrics.snapshot()), {
        headers: { "content-type": "application/vnd.conditional-stocks.canonical+json" },
      }),
  );
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch });
  logger.info("service.started", { chainId, port, intervalMs: interval, ownerId: config.ownerId });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pass: Promise<void> = Promise.resolve();
  const tick = () => {
    pass = runtime.tick().finally(() => {
      if (!stopped) timer = setTimeout(tick, interval);
    });
  };
  const shutdown = async () => {
    if (stopped) return;
    logger.info("service.stopping");
    stopped = true;
    clearTimeout(timer);
    await server.stop();
    await pass;
    await coordinator.close();
    logger.info("service.stopped");
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  tick();
}

void main().catch((error) => {
  logger.error("service.start.failed", { error });
  process.exit(1);
});
