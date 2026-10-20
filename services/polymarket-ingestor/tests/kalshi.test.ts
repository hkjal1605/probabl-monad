import { afterEach, describe, expect, test } from "bun:test";
import { createKalshiQueries } from "@conditional-stocks/db/kalshi";
import { createPolymarketQueries, type PolymarketQueries } from "@conditional-stocks/db/polymarket";
import { testDatabase } from "@conditional-stocks/db/polymarket/testing";
import { kalshiConditionId } from "@conditional-stocks/market-data";
import { createIngestorApp } from "../src/app.ts";
import { EventMarkets } from "../src/event-markets.ts";
import { KalshiIngestor } from "../src/kalshi/service.ts";
import type { KalshiSource } from "../src/kalshi/source.ts";
import { PolymarketIngestor } from "../src/service.ts";
import { environment, FakeSource } from "./helpers.ts";

const ticker = "KXFEDDECISION-26DEC-H25";
const conditionId = kalshiConditionId(ticker);

class FakeKalshiSource implements KalshiSource {
  market: Record<string, unknown> = {
    close_time: "2026-12-09T18:59:00Z",
    event_ticker: "KXFEDDECISION-26DEC",
    market_type: "binary",
    result: "",
    rules_primary: "Resolves Yes if the Fed hikes by 25bps in December 2026.",
    status: "active",
    ticker,
    title: "Will the Federal Reserve Hike rates by 25bps at their December 2026 meeting?",
  };
  book: unknown = {
    orderbook_fp: { yes_dollars: [["0.7700", "400.00"]], no_dollars: [["0.2100", "400.00"]] },
  };
  failBook = false;
  async getMarket() {
    return {
      market: this.market,
      event: { event_ticker: "KXFEDDECISION-26DEC", series_ticker: "KXFEDDECISION" },
    };
  }
  async getOrderbook() {
    if (this.failBook) throw new Error("Kalshi unreachable");
    return this.book;
  }
}

const stores: PolymarketQueries[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
});

async function setup() {
  const { database } = await testDatabase();
  const store = createPolymarketQueries(database);
  stores.push(store);
  const source = new FakeKalshiSource();
  const kalshi = new KalshiIngestor(
    { apiUrl: "https://kalshi.test", bookPollMs: 60_000, metadataPollMs: 60_000 },
    createKalshiQueries(database),
    source,
    { staleAfterMs: environment.staleAfterMs, standardNotionalX6: environment.standardNotionalX6 },
    store.appendAlert,
  );
  const markets = new EventMarkets(
    new PolymarketIngestor(environment, store, new FakeSource()),
    kalshi,
  );
  const app = createIngestorApp(markets, store, environment);
  const internal = (path: string, body: unknown) =>
    app.request(path, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${environment.internalToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
  return { app, internal, kalshi, source, store };
}

describe("Kalshi ingestion", () => {
  test("fetches, tracks and serves a Kalshi market by its derived condition id", async () => {
    const { app, internal } = await setup();
    const fetched = await internal("/internal/kalshi/metadata/fetch", { ticker });
    expect(fetched.status).toBe(200);
    const snapshot = (await fetched.json()) as { snapshotId: string; normalized: unknown };
    expect(snapshot.normalized).toMatchObject({ source: "kalshi", ticker, conditionId });
    // The router tracks the snapshot's own venue.
    const tracked = await internal("/internal/subscriptions", {
      metadataSnapshotId: snapshot.snapshotId,
    });
    expect(tracked.status).toBe(201);
    expect(await tracked.json()).toMatchObject({ conditionId, ticker });
    for (const prefix of ["/v1/conditions", "/v1/polymarket/conditions"]) {
      const probability = await app.request(`${prefix}/${conditionId}/probability`);
      expect(await probability.json()).toMatchObject({
        conditionId,
        midpointX6: "780000",
        quality: "valid",
        yesTokenId: `${ticker}:yes`,
      });
      const metadata = await app.request(`${prefix}/${conditionId}/metadata`);
      expect(await metadata.json()).toMatchObject({ snapshotId: snapshot.snapshotId });
    }
    expect(
      (
        await app.request(`/internal/metadata/snapshots/${snapshot.snapshotId}`, {
          headers: { authorization: `Bearer ${environment.internalToken}` },
        })
      ).status,
    ).toBe(200);
  });

  test("disconnects a book Kalshi cannot serve and alerts on status changes", async () => {
    const { internal, kalshi, source, store } = await setup();
    const snapshot = (await (
      await internal("/internal/kalshi/metadata/fetch", { ticker })
    ).json()) as {
      snapshotId: string;
    };
    await kalshi.track(snapshot.snapshotId);
    source.failBook = true;
    await expect(kalshi.refresh(conditionId)).rejects.toThrow("unreachable");
    expect(kalshi.probability(conditionId).quality).toBe("disconnected");
    source.market = { ...source.market, status: "finalized", result: "yes" };
    const settled = await kalshi.fetchMetadata(ticker, "changes");
    expect(settled.normalized).toMatchObject({ closed: true, result: "yes" });
    expect((await store.alerts()).map((alert) => alert.code)).toEqual(
      expect.arrayContaining(["REST_RECONCILIATION_FAILED", "MANUAL_LIFECYCLE_REVIEW_REQUIRED"]),
    );
  });
});
