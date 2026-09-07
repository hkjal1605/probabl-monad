const services = [
  { name: "API gateway", url: process.env.API_URL ?? "http://127.0.0.1:3000", path: "/ready" },
  {
    name: "Chain indexer",
    url: process.env.INDEXER_URL ?? "http://127.0.0.1:42069",
    path: "/indexer/health",
  },
  {
    name: "Settlement worker",
    url: process.env.SETTLEMENT_WORKER_URL ?? "http://127.0.0.1:42071",
    path: "/ready",
  },
  {
    name: "Polymarket ingestor",
    url: process.env.POLYMARKET_INGESTOR_URL ?? "http://127.0.0.1:42073",
    path: "/health",
  },
  { name: "Matcher", url: process.env.MATCHER_HEALTH_URL ?? "", path: "/health" },
  {
    name: "Reconciler",
    url: process.env.RECONCILIATION_URL ?? "http://127.0.0.1:42070",
    path: "/health",
  },
];
export async function GET() {
  const results = await Promise.all(
    services.map(async (service) => {
      if (!service.url)
        return { detail: "Health URL not configured", name: service.name, status: "unknown" };
      const started = Date.now();
      try {
        const response = await fetch(new URL(service.path, service.url), {
          cache: "no-store",
          signal: AbortSignal.timeout(2_500),
        });
        const body = await response.json().catch(() => null);
        return {
          detail: body,
          latencyMs: Date.now() - started,
          name: service.name,
          status: response.ok && body?.healthy !== false ? "healthy" : "degraded",
        };
      } catch {
        return {
          detail: "No response",
          latencyMs: Date.now() - started,
          name: service.name,
          status: "offline",
        };
      }
    }),
  );
  return Response.json({ checkedAt: new Date().toISOString(), services: results });
}
