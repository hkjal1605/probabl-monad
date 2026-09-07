import { expect, test } from "bun:test";
import { Branch, FundingKind, type Order, Side, TimeInForce } from "@conditional-stocks/domain";
import { canonicalParse } from "@conditional-stocks/orderbook";
import type { Hex } from "viem";
import { IndexerClient } from "./chain.ts";
import { PolymarketIngestorClient } from "./polymarket-client.ts";
import { HttpSettlementIntentSink } from "./service.ts";

const hash: Hex = `0x${"11".repeat(32)}`;
const maker = "0x1000000000000000000000000000000000000001";
test("indexer HTTP reads distinguish missing, unhealthy, unavailable and successful responses", async () => {
  let status = 200;
  const calls: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      calls.push(new URL(request.url).pathname);
      return Response.json({ healthy: true, id: hash }, { status });
    },
  });
  const client = new IndexerClient(server.url.href.replace(/\/$/, ""));
  try {
    const readers = [
      () => client.order(hash),
      () => client.market(hash),
      () => client.resolution(hash),
      () => client.transaction(hash),
    ];
    for (const read of readers) {
      status = 200;
      expect(await read()).toMatchObject({ id: hash });
      status = 404;
      expect(await read()).toBeNull();
      status = 503;
      await expect(read()).rejects.toThrow("request failed");
    }
    await expect(client.health()).rejects.toMatchObject({ status: 503 });
    status = 200;
    expect((await client.health()).healthy).toBe(true);
    expect(calls).toContain(`/orders/${hash}`);
  } finally {
    await server.stop(true);
  }
  await expect(client.health()).rejects.toMatchObject({ status: 503 });
});

test("ingestor HTTP client sends credentials only on internal routes and preserves error classifications", async () => {
  let status = 200;
  let response: unknown = { snapshotId: "snapshot" };
  const calls: { path: string; auth: string | null; body: unknown }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      calls.push({
        path: new URL(request.url).pathname,
        auth: request.headers.get("authorization"),
        body: request.method === "POST" ? await request.json() : null,
      });
      return Response.json(response, { status });
    },
  });
  const client = new PolymarketIngestorClient(server.url.href.replace(/\/$/, ""), "test-token");
  try {
    expect((await client.fetchMetadata("42")).snapshotId).toBe("snapshot");
    await client.track("snapshot");
    await client.snapshot("snapshot/id");
    await client.probability(hash);
    await client.metadata(hash);
    expect(calls.slice(0, 3).every((call) => call.auth === "Bearer test-token")).toBe(true);
    expect(calls.slice(3).every((call) => call.auth === null)).toBe(true);
    expect(calls[0]?.body).toEqual({ gammaMarketId: "42" });
    expect(calls[2]?.path).toContain("snapshot%2Fid");
    status = 409;
    response = { error: { message: "mapping changed" } };
    await expect(client.track("snapshot")).rejects.toMatchObject({
      status: 409,
      message: "mapping changed",
    });
    status = 502;
    response = {};
    await expect(client.metadata(hash)).rejects.toMatchObject({
      status: 503,
      message: "ingestor returned 502",
    });
  } finally {
    await server.stop(true);
  }
  await expect(client.fetchMetadata("42")).rejects.toMatchObject({
    status: 503,
    code: "POLYMARKET_INGESTOR_UNAVAILABLE",
  });
  await expect(client.probability(hash)).rejects.toMatchObject({ status: 503 });
});

test("IOC HTTP sink preserves exact raw bigint quantities and rejects incomplete acknowledgements", async () => {
  let status = 200;
  let response: unknown = { state: "queued", batchId: hash, error: null };
  let received: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(request.headers.get("authorization")).toBe("Bearer test-token");
      if (request.method === "POST") received = canonicalParse(await request.text());
      return Response.json(response, { status });
    },
  });
  const client = new HttpSettlementIntentSink(server.url.href.replace(/\/$/, ""), "test-token");
  const order: Order = {
    branch: Branch.Yes,
    expiry: 1900n,
    fundingKind: FundingKind.WholeCollateral,
    limitPriceRawX18: 200_000_000n,
    maker,
    marketId: hash,
    nonce: 7n,
    quantity: 10n ** 18n,
    recipient: maker,
    salt: hash,
    side: Side.Buy,
    tif: TimeInForce.Ioc,
    maxFeeBps: 0,
  };
  const input = {
    order,
    orderHash: hash,
    signature: "0x12" as const,
    protection: {
      maxQuantity: order.quantity,
      maxNotional: 200_000_000n,
      worstPriceRawX18: order.limitPriceRawX18,
    },
  };
  try {
    expect(await client.enqueueIoc(input)).toEqual({ batchId: hash, state: "queued" });
    expect(received).toEqual(input);
    expect((await client.status(hash)).state).toBe("queued");
    for (const body of [{}, { batchId: hash }, { state: "queued" }]) {
      response = body;
      await expect(client.enqueueIoc(input)).rejects.toMatchObject({ status: 503 });
    }
    status = 500;
    response = { error: "worker unavailable" };
    await expect(client.enqueueIoc(input)).rejects.toMatchObject({
      message: "worker unavailable",
      status: 503,
    });
    await expect(client.status(hash)).rejects.toMatchObject({ status: 503 });
  } finally {
    await server.stop(true);
  }
});
