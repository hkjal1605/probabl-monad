/** A server shaped like the API (Hono on Bun: a live stream, a WebSocket, a slow request, the
 * same in-flight count and the same shutdown), for `shutdown.test.ts` to stop with a signal
 * while clients are connected. It prints its port, then one JSON line per log event. */
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { streamSSE } from "hono/streaming";
import { createShutdown } from "../../src/common/shutdown.ts";

const env = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const app = new Hono();
let inflight = 0;
app.use("*", async (_c, next) => {
  inflight++;
  try {
    await next();
  } finally {
    inflight--;
  }
});
// As the API's streams are written: a loop that sleeps between frames.
app.get("/stream", (c) =>
  streamSSE(c, async (stream) => {
    while (!stream.aborted) {
      await stream.writeSSE({ event: "tick", data: "{}" });
      await stream.sleep(2_000);
    }
  }),
);
app.get("/slow", async (c) => {
  await Bun.sleep(Number(c.req.query("ms") ?? 600));
  return c.text("done");
});
const sockets = new Set<ServerWebSocket<unknown>>();
app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      sockets.add(ws.raw as ServerWebSocket<unknown>);
    },
  })),
);
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 60,
  fetch: app.fetch,
  websocket,
});
const say = (line: Record<string, unknown>) => console.log(JSON.stringify(line));
const shutdown = createShutdown({
  stopListening: () => server.stop(),
  quiesce: () => {
    for (const socket of sockets) socket.close(1001, "Server restarting");
  },
  inflight: () => inflight,
  flush: async () => {
    await Bun.sleep(env("FLUSH_MS", 20));
    say({ event: "flushed" });
  },
  drainMs: env("DRAIN_MS", 5_000),
  flushMs: env("FLUSH_LIMIT_MS", 2_000),
  log: (level, event, fields) => say({ level, event, ...fields }),
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void shutdown(signal));
say({ port: server.port });
