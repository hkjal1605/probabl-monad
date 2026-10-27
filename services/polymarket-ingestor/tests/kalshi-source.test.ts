import { afterEach, expect, test } from "bun:test";
import { OfficialKalshiSource } from "../src/kalshi/source.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("markets of one event share its metadata read; a failed read blocks nothing and is retried", async () => {
  const paths: string[] = [];
  let metadataFails = true;
  globalThis.fetch = (async (input: string) => {
    const path = new URL(input).pathname.replace("/v2", "");
    paths.push(path);
    if (path.endsWith("/metadata")) {
      if (metadataFails) return new Response("", { status: 503 });
      return Response.json({
        image_url: "https://assets.kalshi.com/series-images-webp/KXBTCD.webp",
      });
    }
    if (path.startsWith("/events/"))
      return Response.json({ event: { event_ticker: "KXBTCD-26OCT2317" } });
    return Response.json({
      market: { ticker: path.split("/")[2], event_ticker: "KXBTCD-26OCT2317" },
    });
  }) as unknown as typeof fetch;
  const source = new OfficialKalshiSource("https://kalshi.test/v2");
  const first = (await source.getMarket("KXBTCD-26OCT2317-T81999.99")) as Record<string, unknown>;
  expect(first.event).toEqual({ event_ticker: "KXBTCD-26OCT2317" });
  expect(first.eventMetadata).toBeUndefined();
  metadataFails = false;
  const read = await Promise.all(
    ["T82499.99", "T82999.99", "T83499.99"].map(
      (strike) =>
        source.getMarket(`KXBTCD-26OCT2317-${strike}`) as Promise<Record<string, unknown>>,
    ),
  );
  expect(read.map((r) => r.eventMetadata)).toEqual(
    Array(3).fill({ image_url: "https://assets.kalshi.com/series-images-webp/KXBTCD.webp" }),
  );
  expect(paths.filter((p) => p.endsWith("/metadata"))).toHaveLength(2);
});
