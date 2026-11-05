/** The event catalog's HTTP routes (internal, behind the ingestor's token): searches read memory
 * only; `entries` refreshes a few entries' prices. */
import { MarketDataError } from "@conditional-stocks/market-data";
import type { Logger } from "@conditional-stocks/shared";
import { requestLogging } from "@conditional-stocks/shared/http";
import { Hono } from "hono";
import type { CatalogSource, EventCatalog } from "./catalog.ts";

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });

export const createCatalogApp = (catalog: EventCatalog, internalToken: string, logger?: Logger) => {
  const app = new Hono();
  if (logger) app.use("*", requestLogging(logger, { quietPaths: ["/health"] }));
  app.onError((error) =>
    error instanceof MarketDataError
      ? json({ error: { code: error.code, message: error.message } }, error.status)
      : json({ error: { code: "INVALID_REQUEST", message: error.message } }, 400),
  );
  app.use("/internal/*", async (context, next) => {
    if (context.req.header("authorization") !== `Bearer ${internalToken}`)
      return json({ error: { code: "UNAUTHORIZED", message: "invalid internal token" } }, 401);
    return next();
  });
  app.get("/health", () =>
    json({
      service: "conditional-stocks-event-catalog",
      status: "ok",
      size: catalog.size,
      crawledAt: catalog.crawledAt,
    }),
  );
  app.get("/internal/catalog/search", (context) => {
    const q = (context.req.query("q") ?? "").slice(0, 300);
    const time = (name: string) => {
      const v = context.req.query(name);
      const t = v ? Date.parse(v) : Number.NaN;
      return Number.isFinite(t) ? t : undefined;
    };
    const source = context.req.query("source");
    const limit = Number(context.req.query("limit") ?? 20);
    const before = time("before"),
      after = time("after");
    const hits = catalog.search(q, {
      limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20,
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {}),
      ...(source === "polymarket" || source === "kalshi"
        ? { source: source as CatalogSource }
        : {}),
    });
    return json({
      crawledAt: catalog.crawledAt,
      size: catalog.size,
      hits: hits.map((h) => ({
        score: Math.round(h.score * 1000) / 1000,
        coverage: Math.round(h.coverage * 1000) / 1000,
        entry: h.entry,
      })),
    });
  });
  app.post("/internal/catalog/entries", async (context) => {
    const body = (await context.req.json()) as { ids?: unknown; fresh?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 12) : [];
    const entries =
      body.fresh === true
        ? await catalog.fresh(ids)
        : ids.flatMap((id) => {
            const e = catalog.get(id);
            return e ? [e] : [];
          });
    return json({ entries });
  });
  app.get("/internal/catalog/status", () =>
    json({
      enabled: true,
      size: catalog.size,
      crawledAt: catalog.crawledAt,
      error: catalog.lastError,
    }),
  );
  return app;
};
