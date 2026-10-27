import { PREVIEW_VIDEO } from "./link-preview";

// The link preview's two jobs in the deployed worker (worker.ts), outside Next.

/** Kept a day, then served while refetched (like the other public media). */
const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

/**
 * The one byte range a `Range` header asks for within `size` bytes: [first, last], "unsatisfiable"
 * (answered 416), or null for the whole file (no header, or one this doesn't parse, such as
 * several ranges, which a server may ignore).
 */
export function byteRange(
  header: string | null,
  size: number,
): [number, number] | "unsatisfiable" | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const n = Number(m[2]);
    return n > 0 && size > 0 ? [Math.max(0, size - n), size - 1] : "unsatisfiable";
  }
  const first = Number(m[1]);
  const last = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  return first < size && first <= last ? [first, last] : "unsatisfiable";
}

/**
 * Answers `/og-video.mp4` (routed here first by wrangler.jsonc `assets.run_worker_first`): the
 * static asset, with byte ranges, which Cloudflare's asset server doesn't honour. iOS plays video
 * (the iMessage preview included) only from a server that answers ranges with 206.
 */
export async function servePreviewVideo(request: Request, assets: Fetcher): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const asset = await assets.fetch(new URL(PREVIEW_VIDEO.path, request.url));
  if (!asset.ok) return asset;
  const headers = new Headers({
    "accept-ranges": "bytes",
    "access-control-allow-origin": "*",
    "cache-control": CACHE_CONTROL,
    "content-type": PREVIEW_VIDEO.type,
    "x-content-type-options": "nosniff",
  });
  const etag = asset.headers.get("etag");
  if (etag) {
    headers.set("etag", etag);
    if (request.headers.get("if-none-match") === etag) {
      await asset.body?.cancel();
      return new Response(null, { status: 304, headers });
    }
  }
  const body = new Uint8Array(await asset.arrayBuffer());
  const range = byteRange(request.headers.get("range"), body.byteLength);
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${body.byteLength}`);
    return new Response(null, { status: 416, headers });
  }
  const [first, last] = range ?? [0, body.byteLength - 1];
  if (range) headers.set("content-range", `bytes ${first}-${last}/${body.byteLength}`);
  headers.set("content-length", String(last - first + 1));
  return new Response(request.method === "HEAD" ? null : body.subarray(first, last + 1), {
    status: range ? 206 : 200,
    headers,
  });
}

/**
 * Discord and Telegram build a playable embed from X's player-card tags with a direct stream, and
 * only show og:video as a still under a summary card. X needs the summary card: a player card
 * there wants an approved iframe player, and Telegram drops the whole preview over an iframe tag.
 * So only these two crawlers get `twitter:card` "player" plus the stream tags (no `twitter:player`).
 */
const PLAYER_CARD_CRAWLERS = /Discordbot|TelegramBot/i;

const attr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function withPlayerCard(request: Request, response: Response): Response {
  if (!PLAYER_CARD_CRAWLERS.test(request.headers.get("user-agent") ?? "")) return response;
  if (!response.headers.get("content-type")?.includes("text/html")) return response;
  const video: { url?: string; type?: string; width?: string; height?: string } = {};
  const read = (key: keyof typeof video): HTMLRewriterElementContentHandlers => ({
    element(el) {
      const content = el.getAttribute("content");
      if (content !== null) video[key] ??= content;
    },
  });
  return (
    new HTMLRewriter()
      .on('meta[property="og:video"]', read("url"))
      .on('meta[property="og:video:type"]', read("type"))
      .on('meta[property="og:video:width"]', read("width"))
      .on('meta[property="og:video:height"]', read("height"))
      // Next writes the Open Graph tags before X's, so the video is known by here.
      .on('meta[name="twitter:card"]', {
        element(el) {
          if (video.url) el.setAttribute("content", "player");
        },
      })
      .on("head", {
        element(el) {
          el.onEndTag((end) => {
            const url = video.url;
            if (!url) return;
            const tags: [string, string][] = [
              ["twitter:player:stream", url],
              ["twitter:player:stream:content_type", video.type ?? PREVIEW_VIDEO.type],
              ["twitter:player:width", video.width ?? String(PREVIEW_VIDEO.width)],
              ["twitter:player:height", video.height ?? String(PREVIEW_VIDEO.height)],
            ];
            end.before(
              tags
                .map(([name, content]) => `<meta name="${name}" content="${attr(content)}"/>`)
                .join(""),
              { html: true },
            );
          });
        },
      })
      .transform(response)
  );
}
