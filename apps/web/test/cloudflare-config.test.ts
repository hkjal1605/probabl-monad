import { expect, test } from "bun:test";
import config from "../open-next.config";

test("the worker never short-circuits through OpenNext's cache interception", () => {
  // With Next 16's default prefetchInlining, the interceptor answers a router segment prefetch
  // (`Next-Router-Segment-Prefetch: /_tree`) with the whole page payload, which the router
  // cannot use: it prefetches again, forever, from every visible link (Oct 2026 incident).
  expect(config.dangerous?.enableCacheInterception ?? false).toBe(false);
});
