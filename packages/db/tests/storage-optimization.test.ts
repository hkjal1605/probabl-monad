import { expect, test } from "bun:test";
import { normalizeGammaMarket, type ProbabilityTick } from "@conditional-stocks/market-data";
import { canonicalStringify } from "@conditional-stocks/orderbook";
import type { Hex } from "viem";
import type { ApplicationDatabase } from "../src/connection.ts";
import { createEvidenceQueries } from "../src/evidence/queries.ts";
import { createGatewayQueries } from "../src/gateway/queries.ts";
import { InMemoryMatcherStore } from "../src/matcher/memory.ts";
import { createMatcherQueries } from "../src/matcher/queries.ts";
import type { FairnessDecision } from "../src/matcher/types.ts";
import { createPolymarketQueries } from "../src/polymarket/queries.ts";
import { createSettlementQueries } from "../src/settlement/queries.ts";
import { postgresClient } from "./postgres-fixture.ts";

const hash = (value: number): Hex => `0x${value.toString(16).padStart(64, "0")}`;
const maker = "0x1000000000000000000000000000000000000001";
async function fixture<T>(create: (database: ApplicationDatabase) => T) {
  const f = await postgresClient();
  return { ...f, queries: create(f.database) };
}
type Client = Awaited<ReturnType<typeof postgresClient>>["client"];
async function plan(client: Client, query: string, params: unknown[] = []) {
  return JSON.stringify(
    (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, params)).rows,
  );
}
async function count(client: Client, table: string) {
  if (!/^[a-z_]+\.[a-z_]+$/.test(table)) throw new Error("invalid fixture table");
  return Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n);
}
const operation = (id = "operation") => ({
  address: maker as Hex,
  canonicalState: null,
  error: null,
  finalReceipt: null,
  idempotencyKey: id,
  kind: "order" as const,
  operationId: id,
  orderHash: null,
  payload: {},
  requestDigest: hash(1),
  state: "accepted" as const,
  transactionHash: null,
});

test("gateway updates indexed keys, skips no-op writes and seeks through historical rows", async () => {
  const { client, queries } = await fixture(createGatewayQueries);
  await queries.beginOperation(operation());
  expect(await queries.findOrderOperation(maker, hash(2))).toBeNull();
  const updated = await queries.updateOperation("operation", { orderHash: hash(2) });
  expect(await queries.findOrderOperation(maker, hash(2))).toEqual(updated);
  const tuple = (await client.query("SELECT ctid::text AS id FROM gateway.operations")).rows[0]?.id;
  expect(
    await queries.updateOperation("operation", { orderHash: hash(2), state: "accepted" }),
  ).toEqual(updated);
  expect((await client.query("SELECT ctid::text AS id FROM gateway.operations")).rows[0]?.id).toBe(
    tuple,
  );
  await client.exec(`INSERT INTO gateway.operations(operation_id, address, kind, idempotency_key, request_digest, state, payload)
    SELECT 'old-' || i, 'old', 'order', i::text, 'old', 'canonical', '{}' FROM generate_series(1,100000) i;
    ANALYZE gateway.operations;`);
  expect(
    await plan(
      client,
      "SELECT payload FROM gateway.operations WHERE address=$1 AND order_hash=$2 ORDER BY sequence DESC LIMIT 1",
      [maker, hash(2)],
    ),
  ).toContain("operation_order_hash_idx");
  expect(
    await plan(
      client,
      "SELECT payload FROM gateway.operations WHERE state NOT IN ('canonical','failed') ORDER BY sequence LIMIT 100",
    ),
  ).toContain("operation_pending_idx");
});

test("bounded auth cleanup removes only expired rows and handles invalid limits safely", async () => {
  const { queries } = await fixture(createGatewayQueries);
  for (let i = 0; i < 3; i++) {
    await queries.saveChallenge(`expired-${i}`, maker, "old", 9n);
    await queries.saveSession(hash(i), maker, 9n);
  }
  await queries.saveChallenge("active", maker, "current", 10n);
  await queries.saveSession(hash(10), maker, 10n);
  expect(await queries.pruneExpiredAuth(10n, 2)).toEqual({ challenges: 2, sessions: 2 });
  expect(await queries.pruneExpiredAuth(10n, 2)).toEqual({ challenges: 1, sessions: 1 });
  expect(await queries.consumeChallenge("active", maker, 10n)).toBe("current");
  expect((await queries.sessionAddress(hash(10), 10n))?.toLowerCase()).toBe(maker);
  await expect(queries.pruneExpiredAuth(10n, -1)).rejects.toThrow("invalid auth cleanup limit");
});

test("prepared attempts and operation state roll back together on a late PostgreSQL write failure", async () => {
  const { client, queries } = await fixture(createGatewayQueries);
  await queries.beginOperation(operation("cancel"));
  await client.exec(`CREATE FUNCTION gateway.reject_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected failure'; END; $$;
    CREATE TRIGGER reject_prepared BEFORE UPDATE ON gateway.operations FOR EACH ROW EXECUTE FUNCTION gateway.reject_test();`);
  const attempt = {
    operationId: "cancel",
    attempt: 0,
    createdAtMs: 1n,
    nonce: 123n,
    rawTransaction: "0x1234" as Hex,
    replaces: null,
    transactionHash: hash(3),
  };
  await expect(queries.persistPreparedAttempt(attempt)).rejects.toThrow();
  expect(await queries.listAttempts("cancel")).toEqual([]);
  expect((await queries.getOperation("cancel"))?.state).toBe("accepted");
  await client.exec("DROP TRIGGER reject_prepared ON gateway.operations");
  await queries.persistPreparedAttempt(attempt);
  expect(await queries.getOperation("cancel")).toMatchObject({
    state: "prepared",
    transactionHash: hash(3),
  });
  expect(await queries.listAttempts("cancel")).toEqual([attempt]);
});

test("matcher records changes rather than identical heartbeat timestamps", async () => {
  const { queries: postgres } = await fixture(createMatcherQueries);
  for (const queries of [postgres, new InMemoryMatcherStore()]) {
    const decision: FairnessDecision = {
      atMs: 1n,
      bookKey: "book",
      fencingToken: 1n,
      optimizedBookHash: hash(1),
      shadowBookHash: hash(1),
      preview: {
        proposal: null,
        skip: { bookKey: "book", cursor: null, reason: "active-proposal" },
      },
    };
    for (let i = 0; i < 1000; i++) await queries.appendDecision({ ...decision, atMs: BigInt(i) });
    expect(await queries.listDecisions()).toHaveLength(1);
    await queries.appendDecision({ ...decision, fencingToken: 2n });
    await queries.appendDecision(decision);
    expect(await queries.listDecisions()).toHaveLength(3);
  }
});

test("busy-book checks cover normalized GTC legs and IOC branches without payload scans", async () => {
  const { client, queries } = await fixture(createSettlementQueries);
  await client.query(
    "INSERT INTO settlement.batches(batch_id,status,payload_hash,payload) VALUES ($1,'submitted',$1,'{}'),($2,'queued',$2,'{}')",
    [hash(1), hash(2)],
  );
  await client.query(
    "INSERT INTO settlement.batch_books(batch_id,market_id,branch) VALUES ($1,$3,0),($1,$4,1),($2,$5,0)",
    [hash(1), hash(2), hash(10), hash(11), hash(12)],
  );
  expect(await queries.hasProcessableBook(hash(10), 0)).toBeTrue();
  expect(await queries.hasProcessableBook(hash(11), 1)).toBeTrue();
  expect(await queries.hasProcessableBook(hash(11), 0)).toBeFalse();
  expect(await queries.hasProcessableBook(hash(12), 0)).toBeTrue();
  await client.exec("UPDATE settlement.batches SET status='confirmed'");
  expect(await queries.hasProcessableBook(hash(10), 0)).toBeFalse();
  expect(await queries.hasProcessableBook(hash(12), 0)).toBeFalse();
});

test("IOC and pending lookups use partial indexes and never decode unrelated history", async () => {
  const { client, queries } = await fixture(createSettlementQueries);
  await client.exec(`INSERT INTO settlement.batches(batch_id,status,payload_hash,payload)
    SELECT 'old-' || i,'confirmed','old','not-decodable' FROM generate_series(1,100000) i;
    INSERT INTO settlement.ioc_intents(intent_id,status,payload)
    SELECT 'old-' || i,'planned','not-decodable' FROM generate_series(1,100000) i;`);
  for (let i = 10000; i < 10003; i++)
    await client.query(
      "INSERT INTO settlement.batches(batch_id,status,payload_hash,intent_id,payload) VALUES ($1,'queued',$1,$2,$3)",
      [
        hash(i),
        hash(20000),
        canonicalStringify({
          batchId: hash(i),
          payload: { kind: "ioc", schemaVersion: 2, intentId: hash(20000) },
        }),
      ],
    );
  expect((await queries.batchForIntent(hash(20000)))?.batchId).toBe(hash(10002));
  expect(await queries.batchForIntent(hash(20001))).toBeNull();
  await client.exec("ANALYZE settlement.batches; ANALYZE settlement.ioc_intents;");
  expect(
    await plan(
      client,
      "SELECT payload FROM settlement.batches WHERE intent_id=$1 ORDER BY sequence DESC LIMIT 1",
      [hash(20000)],
    ),
  ).toContain("settlement_intent_idx");
  expect(
    await plan(
      client,
      "SELECT payload FROM settlement.batches WHERE feedback_pending ORDER BY sequence LIMIT 100",
    ),
  ).toContain("settlement_feedback_idx");
  expect(
    await plan(
      client,
      "SELECT payload FROM settlement.ioc_intents WHERE status='waiting-match' ORDER BY sequence LIMIT 100",
    ),
  ).toContain("ioc_waiting_idx");
});

test("checkpoint selection ignores orphaned payloads and block seek retains uint256 precision", async () => {
  const { client, queries } = await fixture(createMatcherQueries);
  for (const [i, block] of [0n, 9n, 10n, 99n, 100n, (1n << 256n) - 1n].entries())
    await client.query(
      "INSERT INTO matching.events(canonical,block_number,cursor_key,event_hash,payload) VALUES (true,$1,$2,$3,'unused')",
      [String(block), String(i), hash(i)],
    );
  await client.query(
    "INSERT INTO matching.checkpoints(event_index,payload) VALUES (0,$1),(5,$2),(6,'orphaned-must-not-be-parsed')",
    [
      canonicalStringify({ eventIndex: 0n, checkpoint: {} }),
      canonicalStringify({ eventIndex: 5n, checkpoint: {} }),
    ],
  );
  expect((await queries.rewindToBlock(100n, 1n)).orphanedEventIndexes).toEqual([6n]);
  expect((await queries.getLatestCheckpoint())?.eventIndex).toBe(5n);
  expect((await queries.rewindToBlock(9n, 2n)).orphanedEventIndexes).toEqual([3n, 4n, 5n]);
  expect((await queries.getLatestCheckpoint())?.eventIndex).toBe(0n);
  expect((await queries.rewindToBlock(-1n, 3n)).orphanedEventIndexes).toEqual([1n, 2n]);
  await client.exec(`INSERT INTO matching.events(canonical,block_number,cursor_key,event_hash,payload)
    SELECT true,i,'new-' || i,'unused','unused' FROM generate_series(1,100000) i; ANALYZE matching.events;`);
  expect(
    await plan(
      client,
      "SELECT event_index FROM matching.events WHERE canonical AND block_number > 99999",
    ),
  ).toContain("matcher_canonical_block_idx");
});

const rawMetadata = {
  active: true,
  clobTokenIds: '["111","222"]',
  closed: false,
  conditionId: hash(42),
  description: "Rules",
  endDate: "2027-01-01T00:00:00Z",
  id: "42",
  negRisk: false,
  outcomes: '["Yes","No"]',
  question: "Will it happen?",
  resolutionSource: "Official source",
  slug: "will-it-happen",
};
const tick: ProbabilityTick = {
  askDepthQuoteX6: "100",
  bestAskX6: "510000",
  bestBidX6: "490000",
  bidDepthQuoteX6: "100",
  conditionId: hash(42),
  isStale: false,
  midpointX6: "500000",
  observedAtMs: "1",
  quality: "valid",
  schemaVersion: 1,
  sourceHash: "snapshot",
  spreadX6: "20000",
  standardNotionalX6: "100",
  yesTokenId: "111",
};

test("Polymarket retains one monotonic tick and immutable A-B-A metadata across reconnect", async () => {
  const { client, queries, database } = await fixture(createPolymarketQueries);
  const a = await queries.appendMetadata(rawMetadata, normalizeGammaMarket(rawMetadata));
  const changed = { ...rawMetadata, closed: true };
  const b = await queries.appendMetadata(changed, normalizeGammaMarket(changed));
  expect((await queries.latestMetadataByGammaId("42"))?.snapshotId).toBe(b.snapshotId);
  await queries.appendMetadata(rawMetadata, normalizeGammaMarket(rawMetadata));
  expect(await queries.latestMetadataByCondition(hash(42))).toEqual(a);
  expect(await queries.metadata(a.snapshotId)).toEqual(a);
  await database.transaction(async () => {
    for (let i = 0; i < 1000; i++)
      await queries.saveLatestTick({ ...tick, observedAtMs: String(i) });
  });
  await queries.saveLatestTick({ ...tick, observedAtMs: "0" });
  expect((await queries.latestTick(hash(42)))?.observedAtMs).toBe("999");
  await queries.saveLatestTick({
    ...tick,
    observedAtMs: "999",
    quality: "disconnected",
    isStale: true,
  });
  expect((await queries.latestTick(hash(42)))?.quality).toBe("disconnected");
  expect(await count(client, "operations.polymarket_ticks")).toBe(1);
  expect(await count(client, "operations.polymarket_snapshots")).toBe(2);
  expect(await count(client, "operations.polymarket_heads")).toBe(1);
  await expect(client.exec("DELETE FROM operations.polymarket_snapshots")).rejects.toThrow(
    "immutable",
  );
  expect((await createPolymarketQueries(database).latestTick(hash(42)))?.quality).toBe(
    "disconnected",
  );
});

test("batched evidence views preserve related records and reject update, delete and truncate", async () => {
  const { client, queries } = await fixture(createEvidenceQueries);
  const row = { envelope: { packetHash: hash(1) }, receivedAt: "now" };
  await client.query(
    "INSERT INTO operations.evidence_packets(packet_hash,packet_id,kind,preparer,prepared_at,payload) VALUES ($1,'packet-1','market-creation',$2,'now',$3)",
    [hash(1), maker, JSON.stringify(row)],
  );
  const review = { decision: "approve", packetHash: hash(1) };
  await client.query(
    "INSERT INTO operations.evidence_reviews(review_id,packet_hash,reviewer,decision,reviewed_at,payload) VALUES ('review-1',$1,$2,'approve','now',$3)",
    [hash(1), maker, JSON.stringify(review)],
  );
  expect((await queries.packetViews()) as unknown).toEqual([
    { ...row, reviews: [review], observations: [], previews: [], status: "approved" },
  ]);
  expect(await queries.latestApprovedPacketForMarket(hash(99))).toBeNull();
  const marketPacket = { envelope: { packetHash: hash(2) }, receivedAt: "later" };
  await client.query(
    "INSERT INTO operations.evidence_packets(packet_hash,packet_id,kind,market_id,preparer,prepared_at,payload) VALUES ($1,'packet-2','market-resolution',$2,$3,'later',$4)",
    [hash(2), hash(99), maker, JSON.stringify(marketPacket)],
  );
  expect(await queries.latestApprovedPacketForMarket(hash(99))).toBeNull();
  await client.query(
    "INSERT INTO operations.evidence_reviews(review_id,packet_hash,reviewer,decision,reviewed_at,payload) VALUES ('review-2',$1,$2,'approve','later',$3)",
    [hash(2), maker, JSON.stringify({ ...review, packetHash: hash(2) })],
  );
  expect((await queries.latestApprovedPacketForMarket(hash(99))) as unknown).toEqual(marketPacket);
  await expect(client.exec("UPDATE operations.evidence_packets SET payload='{}'")).rejects.toThrow(
    "immutable",
  );
  await expect(client.exec("DELETE FROM operations.evidence_reviews")).rejects.toThrow("immutable");
  await expect(client.exec("TRUNCATE operations.evidence_reviews")).rejects.toThrow("immutable");
});
