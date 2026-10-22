import { venueImageSource } from "./venue-images";

/** Raster images only: nothing served from this origin can carry script. */
const IMAGE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;
/** A venue that doesn't answer in time gets a failed image (the page shows its fallback), never a
 * request left hanging. */
const TIMEOUT_MS = 10_000;
/** Browsers and Cloudflare's cache keep an image a day, then serve it while refetching. */
const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

const failed = (status: number) =>
  new Response(null, { status, headers: { "cache-control": "public, max-age=60" } });

/** Answers `/media/<venue>/<path>` in the deployed worker (worker.ts), before Next: the venue's
 * image, fetched by Cloudflare (which reaches the venue wherever a visitor can't) and kept in its
 * cache, so each image leaves the venue once per location and costs Next nothing. */
export async function serveVenueImage(
  request: Request,
  ctx: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return failed(405);
  const source = venueImageSource(new URL(request.url).pathname);
  if (!source) return failed(404);
  // Cloudflare's per-location cache (absent outside workerd; the DOM's typing lacks it).
  const cache =
    typeof caches === "undefined" ? undefined : (caches as unknown as { default: Cache }).default;
  const hit = await cache?.match(request.url);
  if (hit) return hit;
  let upstream: Response;
  try {
    upstream = await fetch(source, {
      headers: { accept: "image/avif,image/webp,image/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return failed(502);
  }
  if (!upstream.ok) return failed(upstream.status === 404 ? 404 : 502);
  const type = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (!IMAGE_TYPES.has(type) || length > MAX_BYTES) return failed(502);
  const headers = new Headers({
    "cache-control": CACHE_CONTROL,
    "content-type": type,
    "x-content-type-options": "nosniff",
  });
  if (length) headers.set("content-length", String(length));
  const response = new Response(request.method === "HEAD" ? null : upstream.body, { headers });
  // Stored after the response is sent, so the first visitor waits for nothing more.
  if (cache && request.method === "GET") ctx.waitUntil(cache.put(request.url, response.clone()));
  return response;
}
