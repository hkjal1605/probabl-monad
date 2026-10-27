import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Pages fetch their data in the browser, so most are prerendered at build and served from static
// assets; only market and vault detail pages render on demand. No revalidation, R2, KV, D1 or
// Durable Objects are needed.
//
// Never enable `enableCacheInterception`: with Next 16's default `prefetchInlining`, OpenNext's
// interceptor answers a router segment prefetch (`Next-Router-Segment-Prefetch: /_tree`) with the
// whole page's RSC payload; the router cannot use it and prefetches again, forever, from every
// visible link (an endless request loop on every page, Oct 2026). Next's own handler serves the
// segments correctly from the same cache.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  tagCache: "dummy",
  queue: "dummy",
});
