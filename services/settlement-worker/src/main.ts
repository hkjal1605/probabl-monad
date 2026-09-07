import { HttpTradingSafety, releasePolicy } from "@conditional-stocks/config";
import { loadDatabaseOptions, openDatabase } from "@conditional-stocks/db/connection";
import { createSettlementQueries } from "@conditional-stocks/db/settlement";
import { createSettlementApp } from "./app.ts";
import { loadSettlementEnvironment, PonderSettlementSource, ViemSettlementChain } from "./chain.ts";
import { logger } from "./logger.ts";
import { HttpMatcherFeedback, NoopMatcherFeedback, SettlementWorker } from "./worker.ts";

async function main() {
  const environment = loadSettlementEnvironment(Bun.env);
  releasePolicy(environment.chainId, Bun.env);
  const database = await openDatabase(loadDatabaseOptions(Bun.env, "probabl-settlement"));
  const store = createSettlementQueries(database);
  const chain = new ViemSettlementChain(environment);
  await chain.preflight();
  logger.info("chain.preflight.passed", {
    chainId: environment.chainId,
    exchange: environment.exchange,
  });
  const worker = new SettlementWorker(
    store,
    chain,
    new PonderSettlementSource(environment.indexerUrl),
    {
      environment,
      safety: new HttpTradingSafety(Bun.env),
      feedback: environment.matcherCallbackUrl
        ? new HttpMatcherFeedback(environment.matcherCallbackUrl, environment.internalToken)
        : new NoopMatcherFeedback(),
    },
  );
  const app = createSettlementApp(worker, store, environment);
  const server = Bun.serve({ fetch: app.fetch, hostname: "127.0.0.1", port: environment.port });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pass: Promise<void> = Promise.resolve();
  const tick = () => {
    pass = worker
      .processAll()
      .catch((error) => logger.error("settlement.pass.failed", { error }))
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, 500);
      });
  };
  tick();

  const shutdown = async (): Promise<void> => {
    if (stopped) return;
    logger.info("service.stopping");
    stopped = true;
    clearTimeout(timer);
    await server.stop();
    await pass;
    await database.close();
    logger.info("service.stopped");
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  logger.info("service.started", {
    port: environment.port,
    chainId: environment.chainId,
    ownerId: environment.ownerId,
    pendingBatches: (await store.listProcessable()).length,
    waitingIntents: (await store.waitingIntents()).length,
  });
}

void main().catch((error) => {
  logger.error("service.start.failed", { error });
  process.exit(1);
});
