import type { PolymarketQueries } from "@conditional-stocks/db/polymarket";
import { MarketDataError } from "@conditional-stocks/market-data";
import { requestLogging } from "@conditional-stocks/shared/http";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import type { PolymarketEnvironment } from "./environment.ts";
import { logger } from "./logger.ts";
import {
  type PolymarketIngestor,
  parseMetadataFetchRequest,
  parseTrackRequest,
} from "./service.ts";

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });

export const createPolymarketApp = (
  service: PolymarketIngestor,
  store: PolymarketQueries,
  environment: PolymarketEnvironment,
) => {
  const app = new Hono();
  app.use(
    "*",
    requestLogging(logger, {
      quietPaths: ["/health"],
      websocketRoutes: ["/v1/polymarket/conditions/:conditionId/stream"],
    }),
  );
  app.onError((error) =>
    error instanceof MarketDataError
      ? json({ error: { code: error.code, message: error.message } }, error.status)
      : json({ error: { code: "INVALID_REQUEST", message: error.message } }, 400),
  );
  app.use("/internal/*", async (context, next) => {
    if (context.req.header("authorization") !== `Bearer ${environment.internalToken}`) {
      return json({ error: { code: "UNAUTHORIZED", message: "invalid internal token" } }, 401);
    }
    return next();
  });
  app.get("/health", () =>
    json({
      automatedMarketCreation: false,
      automatedResolution: false,
      service: "conditional-stocks-polymarket-ingestor",
      status: "ok",
      version: 1,
    }),
  );
  app.post("/internal/metadata/fetch", async (context) =>
    json(await service.fetchMetadata(parseMetadataFetchRequest(await context.req.json()))),
  );
  app.post("/internal/subscriptions", async (context) =>
    json(await service.track(parseTrackRequest(await context.req.json())), 201),
  );
  app.post("/internal/events", async (context) => {
    await service.ingestSourceEvent(await context.req.json());
    return json({ accepted: true }, 202);
  });
  app.post("/internal/reconcile/:conditionId", async (context) =>
    json(await service.reconcile(context.req.param("conditionId"))),
  );
  app.get("/internal/metadata/snapshots/:snapshotId", async (context) => {
    const snapshot = await service.metadata(context.req.param("snapshotId"));
    return snapshot ? json(snapshot) : json({ error: { code: "NOT_FOUND" } }, 404);
  });
  app.get("/internal/alerts", async () => json({ alerts: await store.alerts() }));
  app.get("/v1/polymarket/conditions/:conditionId/metadata", async (context) => {
    const snapshot = await service.latestMetadata(context.req.param("conditionId"));
    return snapshot ? json(snapshot) : json({ error: { code: "NOT_FOUND" } }, 404);
  });
  app.get("/v1/polymarket/conditions/:conditionId/probability", async (context) =>
    json(await service.probability(context.req.param("conditionId"))),
  );
  app.get(
    "/v1/polymarket/conditions/:conditionId/stream",
    upgradeWebSocket((context) => {
      let unsubscribe: (() => void) | null = null;
      let timer: ReturnType<typeof setInterval> | null = null;
      const cleanup = () => {
        unsubscribe?.();
        if (timer) clearInterval(timer);
      };
      return {
        onClose: cleanup,
        onError: cleanup,
        onOpen: (_event, socket) => {
          const conditionId = context.req.param("conditionId");
          let previous = "";
          const send = async () => {
            try {
              const payload = JSON.stringify({
                topic: `probability.${conditionId}`,
                value: await service.probability(conditionId),
              });
              if (payload !== previous) {
                socket.send(payload);
                previous = payload;
              }
            } catch {
              cleanup();
              socket.close(1008, "probability unavailable");
            }
          };
          try {
            unsubscribe = service.subscribe(conditionId, send);
            timer = setInterval(send, 1000); // Quality changes even when the source hash does not.
            send();
          } catch {
            cleanup();
            socket.close(1008, "invalid subscription");
          }
        },
      };
    }),
  );
  return app;
};
