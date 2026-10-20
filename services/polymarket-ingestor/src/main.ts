import { createKalshiQueries, initializeKalshiStorage } from "@conditional-stocks/db/kalshi";
import {
  createPolymarketDatabase,
  createPolymarketQueries,
  initializePolymarketStorage,
} from "@conditional-stocks/db/polymarket";
import { createIngestorApp } from "./app.ts";
import { loadPolymarketEnvironment } from "./environment.ts";
import { EventMarkets } from "./event-markets.ts";
import { loadKalshiEnvironment } from "./kalshi/environment.ts";
import { KalshiIngestor } from "./kalshi/service.ts";
import { OfficialKalshiSource } from "./kalshi/source.ts";
import { logger } from "./logger.ts";
import { startPolymarketServer } from "./server.ts";
import { PolymarketIngestor } from "./service.ts";
import { OfficialPolymarketSource } from "./source.ts";

async function main() {
  const environment = loadPolymarketEnvironment(Bun.env);
  const kalshiEnvironment = loadKalshiEnvironment(Bun.env);
  const database = createPolymarketDatabase(Bun.env.DATABASE_URL ?? "");
  await initializePolymarketStorage(database);
  await initializeKalshiStorage(database);
  const store = createPolymarketQueries(database);
  const source = new OfficialPolymarketSource(
    environment.gammaUrl,
    environment.clobUrl,
    environment.websocketUrl,
  );
  const service = new PolymarketIngestor(environment, store, source);
  await service.start();
  // Kalshi books share Polymarket's probability policy and alert log.
  const kalshi = new KalshiIngestor(
    kalshiEnvironment,
    createKalshiQueries(database),
    new OfficialKalshiSource(kalshiEnvironment.apiUrl),
    { staleAfterMs: environment.staleAfterMs, standardNotionalX6: environment.standardNotionalX6 },
    store.appendAlert,
  );
  await kalshi.start();
  const app = createIngestorApp(new EventMarkets(service, kalshi), store, environment);

  const server = startPolymarketServer(app, environment);
  logger.info("service.started", {
    host: environment.host,
    port: environment.port,
    subscriptions: (await store.subscriptions()).length,
  });

  let stopped = false;
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    logger.info("service.stopping");
    await server.stop(true);
    await server.drainRequests();
    await Promise.all([service.stop(), kalshi.stop()]);
    await database.end();
    logger.info("service.stopped");
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch((error) => {
  logger.error("service.start.failed", { error });
  process.exit(1);
});
