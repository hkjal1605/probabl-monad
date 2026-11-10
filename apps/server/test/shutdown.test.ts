/** The API's shutdown against a real server with clients connected (`fixtures/shutdown-server`):
 * a signal stops it promptly whatever is held open, a request in flight still finishes, every
 * wait is bounded, and a second signal exits at once. The bug this guards: with a browser
 * holding a live stream open, the old shutdown waited on Bun's stop until the process manager
 * killed it 90 seconds later. */
import { expect, test } from "bun:test";
import { join } from "node:path";

interface Stopped {
  code: number | null;
  /** From the signal to the process's exit. */
  ms: number;
  logs: Record<string, unknown>[];
}
async function serve(env: Record<string, string> = {}) {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "fixtures/shutdown-server.ts")],
    {
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const logs: Record<string, unknown>[] = [];
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ready!: (port: number) => void;
  const port = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const read = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
        const line = JSON.parse(buffer.slice(0, end)) as Record<string, unknown>;
        buffer = buffer.slice(end + 1);
        if (typeof line.port === "number") ready(line.port);
        else logs.push(line);
      }
    }
  })();
  const origin = `http://127.0.0.1:${await port}`;
  return {
    origin,
    logs,
    signal: (name: "SIGTERM" | "SIGINT" = "SIGTERM") => child.kill(name),
    /** Signals the server and waits for it to exit. */
    async stop(): Promise<Stopped> {
      const started = performance.now();
      child.kill("SIGTERM");
      const code = await child.exited;
      await read;
      return { code, ms: performance.now() - started, logs };
    },
    async exited(): Promise<Stopped> {
      const started = performance.now();
      const code = await child.exited;
      await read;
      return { code, ms: performance.now() - started, logs };
    },
  };
}
/** A client holding the live stream open, as a browser tab does. */
async function holdStream(origin: string) {
  const response = await fetch(`${origin}/stream`);
  const reader = response.body!.getReader();
  await reader.read();
  const ended = (async () => {
    try {
      while (!(await reader.read()).done);
      return "ended";
    } catch {
      return "broken";
    }
  })();
  return { ended };
}
/** A maker's socket. */
function holdSocket(origin: string) {
  const socket = new WebSocket(`${origin.replace("http", "ws")}/ws`);
  return new Promise<{ closed: Promise<number> }>((resolve) => {
    const closed = new Promise<number>((done) => {
      socket.onclose = (event) => done(event.code);
    });
    socket.onopen = () => resolve({ closed });
  });
}
const event = (logs: Record<string, unknown>[], name: string) =>
  logs.find((line) => line.event === name);

test("a signal stops the server at once though a stream and a socket are held open", async () => {
  const server = await serve();
  const stream = await holdStream(server.origin);
  const socket = await holdSocket(server.origin);
  const stopped = await server.stop();
  // Under a second: nothing waits for the stream's client to let go.
  expect(stopped.code).toBe(0);
  expect(stopped.ms).toBeLessThan(1_500);
  expect(event(stopped.logs, "api.stopping")).toMatchObject({ signal: "SIGTERM", inflight: 0 });
  expect(event(stopped.logs, "flushed")).toBeDefined();
  expect(event(stopped.logs, "api.stopped")).toMatchObject({ outcome: "flushed" });
  // Both clients were let go, so they reconnect to the next process.
  expect(["ended", "broken"]).toContain(await stream.ended);
  expect(await socket.closed).toBeGreaterThanOrEqual(1000);
}, 20_000);

test("a request in flight finishes before the server goes; new connections are refused meanwhile", async () => {
  const server = await serve();
  await holdStream(server.origin);
  const slow = fetch(`${server.origin}/slow?ms=700`).then(async (r) => [r.status, await r.text()]);
  await Bun.sleep(100);
  const exited = server.exited();
  server.signal();
  await Bun.sleep(150);
  // The listener is closed while the request is still being served.
  const late = await fetch(`${server.origin}/slow?ms=1`).then(
    () => "accepted",
    () => "refused",
  );
  expect(late).toBe("refused");
  expect(await slow).toEqual([200, "done"]);
  const stopped = await exited;
  expect(stopped.code).toBe(0);
  // It waited for the request (about 0.6 s more), not for any allowance.
  expect(stopped.ms).toBeGreaterThan(400);
  expect(stopped.ms).toBeLessThan(2_500);
  expect(event(stopped.logs, "api.stopping")).toMatchObject({ inflight: 1 });
  expect(event(stopped.logs, "api.stop.requests-cut")).toBeUndefined();
}, 20_000);

test("a request slower than the allowance is cut, and a flush that hangs is given up on", async () => {
  const slowRequest = await serve({ DRAIN_MS: "300" });
  const cut = fetch(`${slowRequest.origin}/slow?ms=5000`).then(
    (r) => r.status,
    () => "cut",
  );
  await Bun.sleep(100);
  const first = await slowRequest.stop();
  expect(first.code).toBe(0);
  expect(first.ms).toBeLessThan(1_500);
  expect(event(first.logs, "api.stop.requests-cut")).toMatchObject({ inflight: 1, drainMs: 300 });
  expect(await cut).toBe("cut");
  // State that cannot be flushed in time: the process still ends, and says it did not flush.
  const stuck = await serve({ FLUSH_MS: "30000", FLUSH_LIMIT_MS: "300" });
  const second = await stuck.stop();
  expect(second.code).toBe(1);
  expect(second.ms).toBeLessThan(1_500);
  expect(event(second.logs, "api.stopped")).toMatchObject({ outcome: "timed-out" });
  expect(event(second.logs, "flushed")).toBeUndefined();
}, 30_000);

test("a second signal while stopping exits at once", async () => {
  const server = await serve({ DRAIN_MS: "20000" });
  void fetch(`${server.origin}/slow?ms=15000`).catch(() => {});
  await Bun.sleep(100);
  const exited = server.exited();
  server.signal("SIGTERM");
  await Bun.sleep(200);
  server.signal("SIGINT");
  const stopped = await exited;
  expect(stopped.code).toBe(1);
  expect(stopped.ms).toBeLessThan(1_500);
  expect(event(stopped.logs, "api.stop.forced")).toMatchObject({ signal: "SIGINT" });
}, 20_000);
