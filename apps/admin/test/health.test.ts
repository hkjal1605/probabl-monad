import { afterEach, expect, test } from "bun:test";
import { GET } from "../src/app/api/health/route";

const keys = ["API_URL", "INDEXER_URL", "POLYMARKET_INGESTOR_URL"];
const previousEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const savedFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const statuses = (body: { services: { status: string }[] }) =>
  body.services.map((service) => service.status);

test("defaults probe the public API's readiness, index health and reconciliation", async () => {
  for (const key of keys) delete process.env[key];
  const calls: string[] = [];
  globalThis.fetch = (async (url, init) => {
    calls.push(String(url));
    expect(init?.redirect).toBe("manual");
    return Response.json({ healthy: true });
  }) as typeof fetch;
  const body = await (await GET()).json();
  expect(calls).toEqual([
    "https://api.probabl.trade/ready",
    "https://api.probabl.trade/health",
    "https://api.probabl.trade/reconciliation",
  ]);
  expect(statuses(body)).toEqual(["healthy", "healthy", "unknown", "healthy"]);
});

test("explicit private origins are respected", async () => {
  Object.assign(process.env, {
    API_URL: "http://127.0.0.1:3000",
    INDEXER_URL: "http://127.0.0.1:42069",
    POLYMARKET_INGESTOR_URL: "https://reference.test",
  });
  const calls: string[] = [];
  globalThis.fetch = (async (url) => {
    calls.push(String(url));
    return Response.json({ status: "ok" });
  }) as typeof fetch;
  await GET();
  expect(calls).toEqual([
    "http://127.0.0.1:3000/ready",
    "http://127.0.0.1:42069/health",
    "https://reference.test/health",
    "http://127.0.0.1:42069/reconciliation",
  ]);
});

test("malformed health responses are degraded and network errors are offline", async () => {
  for (const key of keys) delete process.env[key];
  process.env.POLYMARKET_INGESTOR_URL = "https://reference.test";
  globalThis.fetch = (async (url) => {
    if (String(url).endsWith("/ready")) return Response.json({});
    if (String(url).endsWith("/health") && String(url).includes("api.probabl"))
      throw new Error("offline");
    if (String(url).endsWith("/reconciliation"))
      return Response.json({ healthy: false }, { status: 503 });
    return new Response("invalid JSON");
  }) as typeof fetch;
  const response = await GET();
  expect(statuses(await response.json())).toEqual(["degraded", "offline", "degraded", "degraded"]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
