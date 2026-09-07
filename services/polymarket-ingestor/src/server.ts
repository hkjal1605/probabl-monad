import { websocket } from "hono/bun";
import type { createPolymarketApp } from "./app.ts";
import type { PolymarketEnvironment } from "./environment.ts";

export const startPolymarketServer = (
  app: ReturnType<typeof createPolymarketApp>,
  environment: Pick<PolymarketEnvironment, "host" | "port">,
) => {
  const pending = new Set<Promise<Response>>();
  const server = Bun.serve({
    fetch(request, server) {
      const response = Promise.resolve(app.fetch(request, server)).finally(() =>
        pending.delete(response),
      );
      pending.add(response);
      return response;
    },
    websocket,
    hostname: environment.host,
    port: environment.port,
    maxRequestBodySize: 5 * 1024 * 1024,
  });
  return Object.assign(server, {
    // WebSockets require forced socket closure, but HTTP handlers may still be writing.
    drainRequests: async () => {
      await Promise.allSettled([...pending]);
    },
  });
};
