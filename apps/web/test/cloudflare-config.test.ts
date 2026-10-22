import { expect, test } from "bun:test";
import config from "../open-next.config";

test("the worker never short-circuits through OpenNext's cache interception", () => {
  // With Next 16's default prefetchInlining, the interceptor answers a router segment prefetch
  // (`Next-Router-Segment-Prefetch: /_tree`) with the whole page payload, which the router
  // cannot use: it prefetches again, forever, from every visible link (Oct 2026 incident).
  expect(config.dangerous?.enableCacheInterception ?? false).toBe(false);
});

test("every Wrangler deploy empties OpenNext's copy of the .env files first", async () => {
  // OpenNext copies every monorepo .env value (backend secrets included) into the Worker's
  // environment module; a raw `opennextjs-cloudflare build` then deploy shipped them (Oct 2026).
  const wrangler = await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text();
  expect(wrangler).toMatch(
    /"build":\s*\{\s*"command":\s*"bun scripts\/cloudflare-sanitize\.ts"\s*\}/,
  );
  expect(wrangler).toMatch(/"main":\s*"worker\.ts"/);
});
