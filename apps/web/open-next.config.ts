import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Pages fetch their data in the browser, so most are prerendered at build and served from static
// assets; only market and vault detail pages render on demand. No revalidation, R2, KV, D1 or
// Durable Objects are needed.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  tagCache: "dummy",
  queue: "dummy",
  enableCacheInterception: true,
});
