import { expect, test } from "bun:test";
import { forgetEvents, marketsApi } from "../src/services/markets-api-service";
import { fixtureMarkets } from "./fixtures/protocol";

test("market reads include saved artwork, including legacy raw snapshots, without extra requests", async () => {
  const originalFetch = globalThis.fetch;
  const image = "https://polymarket-upload.s3.us-east-2.amazonaws.com/event.png";
  const kalshi = "https://assets.kalshi.com/series-images-webp/KXBTCD.webp";
  try {
    // The venues' images load through this site's /media route (venue-images.ts).
    const proxied = "/media/polymarket/event.png";
    const other = "https://cdn.example.com/event.png";
    for (const [metadata, expected] of [
      [{ normalized: { imageUrl: image } }, proxied],
      // Kalshi's artwork comes normalized; its raw payload has no image fields of its own.
      [
        { normalized: { source: "kalshi", imageUrl: kalshi }, rawPayload: { market: {} } },
        "/media/kalshi/series-images-webp/KXBTCD.webp",
      ],
      [{ normalized: { imageUrl: "http://assets.kalshi.com/x.webp" } }, null],
      [{ normalized: { imageUrl: other } }, other],
      [{ normalized: {}, rawPayload: { image } }, proxied],
      [{ normalized: {}, rawPayload: { icon: image } }, proxied],
      [{ normalized: {}, rawPayload: { image: "javascript:alert(1)" } }, null],
      [{ normalized: {} }, null],
    ] as const) {
      // Each case reads its own event data; the app keeps events between list reads.
      forgetEvents();
      const paths: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const path = url.pathname;
        paths.push(path);
        if (path === "/markets")
          return Response.json({
            markets: [
              {
                ...fixtureMarkets[0],
                state: 2,
                eventConditionId: fixtureMarkets[0]!.mapping.conditionId,
                makerFeeBps: fixtureMarkets[0]!.fees.makerBps,
                takerFeeBps: fixtureMarkets[0]!.fees.takerBps,
              },
            ],
          });
        if (path === "/v1/events")
          return Response.json({
            events: Object.fromEntries(
              (url.searchParams.get("markets") ?? "").split(",").map((id) => [id, { metadata }]),
            ),
          });
        if (path === "/orderbooks") return Response.json({ books: {} });
        if (path.startsWith("/orderbook/")) return Response.json({ orders: [] });
        throw new Error(`Unexpected request: ${path}`);
      }) as typeof fetch;
      const markets = await marketsApi.liveMarkets();
      expect(markets[0]?.imageUrl).toBe(expected);
      expect(paths).toHaveLength(3);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
