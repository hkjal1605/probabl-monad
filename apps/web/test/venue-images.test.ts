import { afterEach, expect, test } from "bun:test";
import { serveVenueImage } from "../src/lib/markets/venue-image-proxy";
import { venueImageSource, venueImageUrl } from "../src/lib/markets/venue-images";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const ctx = { waitUntil: () => {} };
const request = (path: string, method = "GET") =>
  new Request(`https://probabl.trade${path}`, { method });

test("the venues' images load through /media; any other URL is left as it is", () => {
  expect(venueImageUrl("https://assets.kalshi.com/series-images-webp/KXBTCD.webp")).toBe(
    "/media/kalshi/series-images-webp/KXBTCD.webp",
  );
  expect(
    venueImageUrl("https://polymarket-upload.s3.us-east-2.amazonaws.com/BTC+fullsize.png"),
  ).toBe("/media/polymarket/BTC+fullsize.png");
  for (const url of [
    "https://cdn.example.com/a.png",
    "https://assets.kalshi.com/a.webp?v=2",
    "https://assets.kalshi.com:8443/a.webp",
    "http://assets.kalshi.com/a.webp",
    "not a url",
  ])
    expect(venueImageUrl(url)).toBe(url);
  expect(venueImageUrl(null)).toBeNull();
});

test("a /media path names only a venue image host", () => {
  expect(venueImageSource("/media/kalshi/series-images-webp/KXBTCD.webp")?.href).toBe(
    "https://assets.kalshi.com/series-images-webp/KXBTCD.webp",
  );
  expect(venueImageSource("/media/polymarket/BTC+fullsize.png")?.href).toBe(
    "https://polymarket-upload.s3.us-east-2.amazonaws.com/BTC+fullsize.png",
  );
  for (const path of [
    "/media/example/a.png",
    "/media/constructor/a.png",
    "/media/__proto__/a.png",
    "/media/kalshi",
    "/media/kalshi/",
    "/media/kalshi//evil.example/a.png",
    "/other/kalshi/a.png",
  ])
    expect(venueImageSource(path)?.hostname ?? null).toBeOneOf([null, "assets.kalshi.com"]);
  expect(venueImageSource("/media/example/a.png")).toBeNull();
});

test("the worker passes a venue's raster image through with cache headers", async () => {
  const fetched: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    return new Response("img", {
      headers: { "content-type": "image/webp", "content-length": "3", "set-cookie": "a=b" },
    });
  }) as typeof fetch;
  const response = await serveVenueImage(
    request("/media/kalshi/series-images-webp/KXBTCD.webp"),
    ctx,
  );
  expect(fetched).toEqual(["https://assets.kalshi.com/series-images-webp/KXBTCD.webp"]);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("img");
  expect(response.headers.get("content-type")).toBe("image/webp");
  expect(response.headers.get("cache-control")).toContain("max-age=86400");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("set-cookie")).toBeNull();
});

test("the worker fetches nothing for other paths and refuses anything but a raster image", async () => {
  let calls = 0;
  const answer = (response: () => Response) => {
    globalThis.fetch = (async () => {
      calls++;
      return response();
    }) as unknown as typeof fetch;
  };
  answer(() => new Response("x", { headers: { "content-type": "image/png" } }));
  expect((await serveVenueImage(request("/media/example/a.png"), ctx)).status).toBe(404);
  expect((await serveVenueImage(request("/media/kalshi/a.png", "POST"), ctx)).status).toBe(405);
  expect(calls).toBe(0);
  for (const [response, status] of [
    [() => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }), 502],
    [() => new Response("<html>", { headers: { "content-type": "text/html" } }), 502],
    [
      () =>
        new Response("x", {
          headers: { "content-type": "image/png", "content-length": String(6 * 1024 * 1024) },
        }),
      502,
    ],
    [() => new Response(null, { status: 404 }), 404],
    [() => new Response(null, { status: 500 }), 502],
  ] as const) {
    answer(response);
    expect((await serveVenueImage(request("/media/kalshi/a.png"), ctx)).status).toBe(status);
  }
  globalThis.fetch = (async () => {
    throw new Error("unreachable");
  }) as unknown as typeof fetch;
  expect((await serveVenueImage(request("/media/kalshi/a.png"), ctx)).status).toBe(502);
});
