import { afterAll, beforeAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createIndexerQueries } from "../src/indexer/reads.ts";
import * as schema from "../src/indexer/schema.ts";
import { reconciliationQuery } from "../src/indexer/snapshot.ts";
import { fixtureRow, postgresFixture } from "./postgres-fixture.ts";

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
beforeAll(async () => {
  fixture = await postgresFixture();
}, 30_000);
afterAll(async () => {
  await fixture?.client.close();
});

const id = "0x11";
const exact = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

test("reconciliation is one SQL statement and retains full v2 rows, nulls and uint256 precision", async () => {
  const { db } = fixture;
  const queries = createIndexerQueries(db);
  await expect(queries.reconciliationSnapshot(true)).rejects.toThrow("not ready");
  const huge = (1n << 256n) - 1n;
  await db
    .insert(schema.indexerState)
    .values(fixtureRow(schema.indexerState, { id: "canonical", indexedBlock: huge }));
  const market = fixtureRow(schema.market, {
    id,
    stockYesPositionId: huge,
    stockNoPositionId: null,
  });
  const order = fixtureRow(schema.order, { id, marketId: id, status: "open", quantity: huge });
  const reservation = fixtureRow(schema.reservation, {
    orderHash: id,
    amount: huge,
    tokenId: null,
  });
  await db.insert(schema.market).values(market);
  await db.insert(schema.order).values(order);
  await db.insert(schema.reservation).values([reservation, { ...reservation, orderHash: "0x22" }]);
  await db
    .insert(schema.claimBalance)
    .values(fixtureRow(schema.claimBalance, { positionId: huge, amount: huge }));
  const query = reconciliationQuery(db, true).toSQL();
  expect(query.sql).not.toContain(";");
  expect(query.sql.match(/jsonb_agg/g)).toHaveLength(8);
  const snapshot = await queries.reconciliationSnapshot(true);
  expect(snapshot.head.indexedBlock).toBe(huge);
  expect(snapshot.rows.markets as unknown).toEqual([exact(market)]);
  expect(snapshot.rows.openOrders as unknown).toEqual([exact(order)]);
  expect(snapshot.rows.reservations[0] as unknown).toEqual(exact(reservation));
  expect(snapshot.rows.reservationTotals).toEqual([
    { amount: (huge * 2n).toString(), assetAddress: id, tokenId: null },
  ]);
  expect(snapshot.rows.claimTotals).toEqual([
    { amount: huge.toString(), positionId: huge.toString() },
  ]);
  expect(snapshot.rows.resolutions).toEqual([]);
  const shallow = await queries.reconciliationSnapshot(false);
  expect(shallow.rows.openOrders).toEqual([]);
  expect(shallow.rows.reservations).toEqual([]);
  expect(shallow.rows.claimTotals).toEqual(snapshot.rows.claimTotals);
});

test("cursor seeks and bid/ask FIFO use real schema indexes through 100k historical rows", async () => {
  const { db, client } = fixture;
  // Populate historical terminal orders without committing 100k individual round trips.
  const seed = db
    .insert(schema.order)
    .values(fixtureRow(schema.order, { id: "0x99", status: "closed" }))
    .toSQL();
  await client.query(seed.sql, seed.params);
  const columns = getTableConfig(schema.order).columns.map((column) => column.name);
  await client.exec(
    `INSERT INTO protocol_order SELECT ${columns.map((name) => (name === "id" ? "'order-' || n" : `o."${name}"`)).join(",")} FROM protocol_order o CROSS JOIN generate_series(1, 100000) n WHERE o.id = '0x99'`,
  );
  for (const side of [0, 1])
    for (let sequence = 1; sequence <= 10; sequence++) {
      await db.insert(schema.order).values(
        fixtureRow(schema.order, {
          id: `0xab${side}${sequence}`,
          marketId: "0xaa",
          status: "open",
          branch: 0,
          side,
          limitPriceRawX18: BigInt(100 + Math.floor(sequence / 3)),
          sequence: BigInt(sequence),
          expiry: 1000n,
        }),
      );
    }
  await client.exec(
    `INSERT INTO matcher_event SELECT 'event-' || n, 1, n, '0x11', n, '0x11', 0, 0, '{}' FROM generate_series(1, 100000) n; ANALYZE;`,
  );
  const queries = createIndexerQueries(db);
  const cases = [
    [
      "bids",
      queries.iocBook({
        marketId: "0xaa",
        branch: 0,
        side: 0,
        confirmedThrough: 100n,
        timestamp: 1n,
      }),
      "order_book_idx",
    ],
    [
      "asks",
      queries.iocBook({
        marketId: "0xaa",
        branch: 0,
        side: 1,
        confirmedThrough: 100n,
        timestamp: 1n,
      }),
      "order_ask_idx",
    ],
    [
      "cursor",
      queries.matcherEvents({
        afterBlock: 99_990n,
        afterTransactionIndex: 0,
        afterLogIndex: 0,
        confirmedThrough: 100_000n,
        limit: 100,
      }),
      "matcher_event_cursor_idx",
    ],
  ] as const;
  for (const [name, builder, expectedIndex] of cases) {
    const query = builder.toSQL();
    const result = await client.query<{ "QUERY PLAN": unknown }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
      query.params,
    );
    const plan = JSON.stringify(result.rows);
    expect(plan).toContain(expectedIndex);
    expect(plan).not.toContain('"Node Type":"Sort"');
    expect(plan).not.toContain('"Node Type":"Seq Scan"');
    if (process.env.DB_AUDIT_PLANS === "1") console.info(name, plan);
  }
  const bids = await cases[0][1];
  const asks = await cases[1][1];
  expect(bids.map((order) => order.sequence)).toEqual([9n, 10n, 6n, 7n, 8n, 3n, 4n, 5n, 1n, 2n]);
  expect(asks.map((order) => order.sequence)).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n]);
  expect((await cases[2][1]).map((event) => event.blockNumber)).toEqual(
    Array.from({ length: 10 }, (_, n) => BigInt(99_991 + n)),
  );
  await db.delete(schema.order).where(sql`${schema.order.id} <> ${id}`);
}, 30_000);
