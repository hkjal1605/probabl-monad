/** The event catalog's own process (docs/version-2-plan.md §9): it crawls every open Polymarket
 * and Kalshi market a world could use and serves searches from memory. It runs apart from the
 * ingestor, whose live books the keepers price from, so a crawl's parsing, memory and restarts
 * never touch them; the live book of a tracked leg is read from the ingestor. */
import { MarketDataError } from "@conditional-stocks/market-data";
import { Logger, logLevel } from "@conditional-stocks/shared";
import { EventCatalog } from "./catalog.ts";
import { createCatalogApp } from "./catalog-app.ts";
import { loadPolymarketEnvironment } from "./environment.ts";
import { loadKalshiEnvironment } from "./kalshi/environment.ts";

const logger = new Logger({ service: "event-catalog", level: logLevel(process.env.LOG_LEVEL) });

const port = (value: string | undefined, fallback: number, name: string) => {
  const n = Number(value?.trim() || fallback);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 65_535)
    throw new MarketDataError("INVALID_CONFIG", `${name} must be a port`);
  return n;
};

function main() {
  const environment = loadPolymarketEnvironment(Bun.env);
  const kalshi = loadKalshiEnvironment(Bun.env);
  const ingestorUrl = (
    Bun.env.POLYMARKET_INGESTOR_URL?.trim() || `http://${environment.host}:${environment.port}`
  ).replace(/\/$/, "");
  const catalog = new EventCatalog({
    kalshiUrl: kalshi.apiUrl,
    gammaUrl: environment.gammaUrl,
    everyMs: Number(Bun.env.CATALOG_CRAWL_MS ?? 15 * 60_000),
    // A tracked leg's live book, from the ingestor's memory (a condition it does not follow is
    // a 404, and the entry is read from its venue instead).
    live: async (conditionId) => {
      try {
        const response = await fetch(`${ingestorUrl}/v1/conditions/${conditionId}/probability`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) return null;
        const tick = (await response.json()) as {
          quality?: string;
          isStale?: boolean;
          bestBidX6?: string | null;
          bestAskX6?: string | null;
          observedAtMs?: string;
        };
        if (tick.quality !== "valid" || tick.isStale || !tick.bestBidX6 || !tick.bestAskX6)
          return null;
        return {
          bid: Number(tick.bestBidX6) / 1e6,
          ask: Number(tick.bestAskX6) / 1e6,
          observedAtMs: Number(tick.observedAtMs),
        };
      } catch {
        return null;
      }
    },
    log: (event, detail) => logger.info(event, detail ?? {}),
  });
  const app = createCatalogApp(catalog, environment.internalToken, logger);
  const server = Bun.serve({
    fetch: app.fetch,
    hostname: Bun.env.CATALOG_HOST?.trim() || "127.0.0.1",
    port: port(Bun.env.CATALOG_PORT, 42_074, "CATALOG_PORT"),
    maxRequestBodySize: 64 * 1024,
  });
  catalog.start();
  logger.info("service.started", { host: server.hostname, port: server.port, ingestorUrl });

  let stopped = false;
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    logger.info("service.stopping");
    catalog.stop();
    await server.stop(true);
    logger.info("service.stopped");
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

try {
  main();
} catch (error) {
  logger.error("service.start.failed", { error });
  process.exit(1);
}
