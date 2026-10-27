import { expect, test } from "bun:test";
import { LINK_PREVIEW, PREVIEW_IMAGE, PREVIEW_VIDEO } from "../src/lib/link-preview";
import { byteRange, servePreviewVideo, withPlayerCard } from "../src/lib/link-preview-worker";

const publicFile = (path: string) => Bun.file(new URL(`../public${path}`, import.meta.url));

test("the preview's video is an absolute https URL to the MP4, at the image's 1.91:1", () => {
  expect(LINK_PREVIEW.videos).toHaveLength(1);
  for (const video of LINK_PREVIEW.videos) {
    // Next writes og:video as given (it resolves only image URLs against metadataBase)
    expect(video.url).toMatch(/^https:\/\/[^/]+\/og-video\.mp4$/);
    expect(video.secureUrl).toBe(video.url);
    expect(video.type).toBe("video/mp4");
    const ratio = PREVIEW_IMAGE.width / PREVIEW_IMAGE.height;
    expect(Math.abs(video.width / video.height - ratio)).toBeLessThan(0.01);
  }
});

test("the preview files are small enough for every app that fetches them", async () => {
  const image = publicFile(PREVIEW_IMAGE.url);
  const video = publicFile(PREVIEW_VIDEO.path);
  // WhatsApp drops images over ~300 KB; iMessage takes 10 MB for image and video together,
  // Discord about 8 MB per file
  expect(image.size).toBeLessThan(300_000);
  expect(image.size + video.size).toBeLessThan(8_000_000);
  const head = new Uint8Array(await image.slice(0, 3).arrayBuffer());
  expect([...head]).toEqual([0xff, 0xd8, 0xff]);
  // an MP4 with its index first, so a preview can start before the whole file has arrived
  const mp4 = Buffer.from(await video.slice(0, 64 * 1024).arrayBuffer()).toString("latin1");
  expect(mp4.slice(4, 8)).toBe("ftyp");
  expect(mp4.indexOf("moov")).toBeGreaterThan(0);
  expect(mp4.indexOf("moov")).toBeLessThan(
    mp4.indexOf("mdat") === -1 ? Infinity : mp4.indexOf("mdat"),
  );
});

test("the worker gets the video before the asset server (which ignores byte ranges)", async () => {
  const wrangler = await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text();
  expect(wrangler).toMatch(/"run_worker_first":\s*\[\s*"\/og-video\.mp4"\s*\]/);
});

test("byte ranges: first-last, open-ended, suffix, out of bounds, and ones to ignore", () => {
  expect(byteRange("bytes=0-1", 10)).toEqual([0, 1]);
  expect(byteRange("bytes=4-", 10)).toEqual([4, 9]);
  expect(byteRange("bytes=5-99", 10)).toEqual([5, 9]);
  expect(byteRange("bytes=-3", 10)).toEqual([7, 9]);
  expect(byteRange("bytes=-30", 10)).toEqual([0, 9]);
  expect(byteRange("bytes=10-", 10)).toBe("unsatisfiable");
  expect(byteRange("bytes=5-4", 10)).toBe("unsatisfiable");
  expect(byteRange("bytes=-0", 10)).toBe("unsatisfiable");
  expect(byteRange(null, 10)).toBeNull();
  expect(byteRange("bytes=0-1,4-5", 10)).toBeNull();
  expect(byteRange("items=0-1", 10)).toBeNull();
});

const FILE = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
const assets = {
  fetch: async () => new Response(FILE, { headers: { etag: '"v1"', "content-type": "video/mp4" } }),
} as unknown as Fetcher;
const get = (headers: Record<string, string> = {}, method = "GET") =>
  servePreviewVideo(new Request("https://probabl.trade/og-video.mp4", { method, headers }), assets);

test("the video answers ranges with 206, the whole file with 200, and conditional reads with 304", async () => {
  const whole = await get();
  expect(whole.status).toBe(200);
  expect(whole.headers.get("accept-ranges")).toBe("bytes");
  expect(whole.headers.get("content-type")).toBe("video/mp4");
  expect((await whole.arrayBuffer()).byteLength).toBe(100);

  const part = await get({ range: "bytes=0-1" });
  expect(part.status).toBe(206);
  expect(part.headers.get("content-range")).toBe("bytes 0-1/100");
  expect(part.headers.get("content-length")).toBe("2");
  expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([0, 1]);

  const tail = await get({ range: "bytes=-10" });
  expect(tail.headers.get("content-range")).toBe("bytes 90-99/100");

  const beyond = await get({ range: "bytes=100-" });
  expect(beyond.status).toBe(416);
  expect(beyond.headers.get("content-range")).toBe("bytes */100");

  expect((await get({ "if-none-match": '"v1"' })).status).toBe(304);
  const head = await get({}, "HEAD");
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe("100");
  expect((await get({}, "POST")).status).toBe(405);
});

// The head as Next renders it: Open Graph first, then X's tags.
const PAGE = `<!DOCTYPE html><html><head><title>probabl</title>
<meta property="og:image" content="https://probabl.trade/og.jpg"/>
<meta property="og:video" content="https://probabl.trade/og-video.mp4"/>
<meta property="og:video:secure_url" content="https://probabl.trade/og-video.mp4"/>
<meta property="og:video:type" content="video/mp4"/>
<meta property="og:video:width" content="1280"/>
<meta property="og:video:height" content="672"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:image" content="https://probabl.trade/og.jpg"/>
</head><body>markets</body></html>`;

const crawl = async (userAgent: string, html = PAGE, type = "text/html; charset=utf-8") =>
  withPlayerCard(
    new Request("https://probabl.trade/", { headers: { "user-agent": userAgent } }),
    new Response(html, { headers: { "content-type": type } }),
  ).text();

test("Discord and Telegram get a player card with the direct stream; X and everyone else the large image card", async () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "TelegramBot (like TwitterBot)",
  ]) {
    const html = await crawl(ua);
    expect(html).toMatch(/<meta name="twitter:card" content="player"\s*\/>/);
    expect(html).toContain(
      '<meta name="twitter:player:stream" content="https://probabl.trade/og-video.mp4"/>',
    );
    expect(html).toContain('<meta name="twitter:player:stream:content_type" content="video/mp4"/>');
    expect(html).toContain('<meta name="twitter:player:width" content="1280"/>');
    expect(html).toContain('<meta name="twitter:player:height" content="672"/>');
    // never an iframe player: X would want it approved, and Telegram drops the preview over it
    expect(html).not.toContain('name="twitter:player"');
    expect(html.indexOf("twitter:player:stream")).toBeLessThan(html.indexOf("</head>"));
  }
  for (const ua of [
    "Twitterbot/1.0",
    "facebookexternalhit/1.1 Facebot Twitterbot/1.0", // iMessage
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "WhatsApp/2.23.20.0",
    "LinkedInBot/1.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141 Safari/537.36",
  ])
    expect(await crawl(ua)).toBe(PAGE);
});

test("the player card is only added to HTML pages that carry a video", async () => {
  const noVideo = PAGE.replace(/<meta property="og:video[^>]*>\n/g, "");
  expect(await crawl("Discordbot/2.0", noVideo)).toBe(noVideo);
  expect(await crawl("Discordbot/2.0", PAGE, "application/json")).toBe(PAGE);
});
