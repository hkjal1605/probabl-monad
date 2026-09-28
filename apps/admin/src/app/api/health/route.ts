import { API_ORIGIN } from "@conditional-stocks/shared/endpoints";
import { serviceOrigin } from "@/lib/upstream";

export async function GET() {
  // Read overrides per request, like the gateway/indexer proxies. One API process serves the
  // chain index (/health, /reconciliation) and the product API (/ready).
  const apiOrigin = process.env.API_URL ?? API_ORIGIN;
  const services = [
    { name: "API", url: apiOrigin, path: "/ready" },
    { name: "Chain indexer", url: process.env.INDEXER_URL ?? apiOrigin, path: "/health" },
    {
      name: "Polymarket ingestor",
      url: process.env.POLYMARKET_INGESTOR_URL ?? "",
      path: "/health",
    },
    { name: "Reconciliation", url: process.env.INDEXER_URL ?? apiOrigin, path: "/reconciliation" },
  ];
  const results = await Promise.all(
    services.map(async (service) => {
      if (!service.url)
        return {
          detail: "Health URL not configured",
          name: service.name,
          status: "unknown",
        };
      const started = Date.now();
      try {
        const response = await fetch(
          new URL(service.path, serviceOrigin(service.url, service.name)),
          {
            cache: "no-store",
            redirect: "manual",
            signal: AbortSignal.timeout(2_500),
          },
        );
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new Error("Health endpoint redirects are not permitted");
        }
        const body = await response.json().catch(() => null);
        return {
          detail: body,
          latencyMs: Date.now() - started,
          name: service.name,
          status:
            response.ok && body && (body.healthy === true || body.status === "ok")
              ? "healthy"
              : "degraded",
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
  return Response.json(
    { checkedAt: new Date().toISOString(), services: results },
    { headers: { "cache-control": "private, no-store" } },
  );
}
