/** After a deploy: the worker must answer each prerendered page's router tree prefetch
 * (`Next-Router-Segment-Prefetch: /_tree`) with exactly the segment Next built. Any other answer
 * makes the router prefetch that link again, endlessly (the Oct 2026 request loop).
 *
 *   bun scripts/prefetch-smoke.ts [baseUrl]   (run from apps/web after the build that was deployed) */
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const base = (process.argv[2] ?? "https://probabl.trade").replace(/\/$/, "");
const app = resolve(import.meta.dir, "../.next/server/app");
const headers = {
  rsc: "1",
  "next-router-segment-prefetch": "/_tree",
  "next-router-prefetch": "1",
  "next-url": "/",
};
const routes = (await readdir(app, { recursive: true }))
  .filter((entry) => entry.endsWith(".segments"))
  .map((entry) => entry.slice(0, -".segments".length))
  .filter((route) => !route.startsWith("_"))
  .map((route) => ({
    path: route === "index" ? "/" : `/${route}`,
    tree: join(app, `${route}.segments`, "_tree.segment.rsc"),
  }));
let failed = 0;
for (const { path, tree } of routes) {
  if (!(await Bun.file(tree).exists())) continue;
  // The `_rsc` cache key must match the headers: the server redirects to the right one.
  let response = await fetch(`${base}${path}?_rsc=0`, { headers, redirect: "manual" });
  if (response.status === 307 || response.status === 308) {
    await response.body?.cancel();
    response = await fetch(new URL(response.headers.get("location") ?? path, base), {
      headers,
      redirect: "manual",
    });
  }
  const body = await response.text();
  const ok = response.status === 200 && body === (await Bun.file(tree).text());
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${path} ${response.status} ${body.length} bytes`);
}
if (!routes.length) throw new Error("No prerendered segments: build first");
if (failed) {
  console.error(`${failed} route(s) answer tree prefetches wrongly: the router would loop.`);
  process.exit(1);
}
