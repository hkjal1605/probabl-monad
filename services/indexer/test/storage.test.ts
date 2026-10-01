import { afterAll, beforeAll, expect, test } from "bun:test";
import { createDatabase, type Database } from "@conditional-stocks/db";
import { localDatabase } from "@conditional-stocks/db/local";
import { Pool } from "@conditional-stocks/db/testing";
import {
  emptyState,
  encodeCheckpoint,
  orderKeyString,
  serializeState,
} from "@conditional-stocks/evm-client/ledger";
import { type Address, getAddress, keccak256, stringToBytes } from "viem";
import { readCheckpoint } from "../src/follower.ts";
import { closedOrderView, tradeView } from "../src/projection.ts";

/** The version 1 tables the migration reads (as the previous release created them). */
const V1 = [
  "CREATE SCHEMA probabl",
  `CREATE TABLE probabl.schema_version (
    id boolean PRIMARY KEY DEFAULT true CHECK (id), version integer NOT NULL)`,
  `CREATE TABLE probabl.checkpoints (
    domain text PRIMARY KEY, block bigint NOT NULL, hash text NOT NULL, state text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE probabl.events (
    domain text NOT NULL, block bigint NOT NULL, log_index integer NOT NULL, tx text NOT NULL,
    block_time bigint NOT NULL, name text NOT NULL, market integer, owner text, counterparty text,
    data jsonb NOT NULL, PRIMARY KEY (domain, block, log_index))`,
  `CREATE TABLE probabl.orders (
    domain text NOT NULL, key text NOT NULL, owner text NOT NULL, market integer NOT NULL,
    updated_block bigint NOT NULL, data jsonb NOT NULL, PRIMARY KEY (domain, key))`,
  "INSERT INTO probabl.schema_version VALUES (true, 1)",
];

const domain = "31337:0x00000000000000000000000000000000000000E1";
const deployment = { chainId: 31337, exchange: getAddress(domain.split(":")[1]!) };
const maker = getAddress("0x00000000000000000000000000000000000000aa");
const taker = getAddress("0x00000000000000000000000000000000000000bb");
const delegate = getAddress("0x00000000000000000000000000000000000000cc");
const tx = keccak256(stringToBytes("trade"));
const placedTx = keccak256(stringToBytes("placement"));

let pg: Awaited<ReturnType<typeof localDatabase>>;
let db: Database;
let pool: Pool;

beforeAll(async () => {
  pg = await localDatabase();
  pool = new Pool({ connectionString: pg.connectionString, max: 1 });
  db = createDatabase({ connectionString: pg.connectionString });
}, 60_000);
afterAll(async () => {
  await pool?.end();
  await db?.close();
  await pg?.close();
});

test("migrates version 1 storage: trades and closed orders keep their views, other events go", async () => {
  // Rows exactly as the previous indexer wrote them.
  const quantity = 3n * 10n ** 18n,
    makerSeq = 7n,
    takerSeq = 9n,
    branch = 1n;
  const fill = quantity | (makerSeq << 96n) | (takerSeq << 128n) | (branch << 160n);
  const amounts = 600_000_000n | (5n << 128n);
  const fees = 11n | (22n << 128n);
  const trade = {
    makerKey: orderKeyString(1, 1, makerSeq),
    takerKey: orderKeyString(1, 1, takerSeq),
    maker,
    taker,
    takerSide: 0,
    price: "200000000",
  };
  const closed = {
    id: orderKeyString(1, 0, 4n),
    marketId: "1",
    venue: { chainId: 31337, exchange: deployment.exchange, marketId: "1" },
    maker,
    delegate,
    branch: 0,
    side: 1,
    fundingKind: 1,
    tif: 0,
    sequence: "4",
    quantity: quantity.toString(),
    limitPriceRawX18: "200000000",
    expiry: "1800086400",
    maxFeeBps: 30,
    remaining: "0",
    filled: (10n ** 18n).toString(),
    reserved: "0",
    openNotional: "0",
    feesPaid: "3",
    status: "cancelled",
    createdAt: "2027-01-15T08:00:00.000Z",
    transactionHash: placedTx,
    updatedBlock: "42",
    confirmation: "finalized",
  };
  const legacy = emptyState(getAddress("0x00000000000000000000000000000000000000a1"));
  legacy.block = 40n;
  legacy.credits.set(`${maker}:${legacy.quote}`, 123n);
  for (const statement of V1) await pool.query(statement);
  await pool.query(
    `INSERT INTO probabl.events VALUES
      ($1, 41, 0, $2, 1800000000, 'Deposited', NULL, $3, NULL, '{"amount": "5"}'),
      ($1, 42, 3, $2, 1800000002, 'Trade', 1, $4, $3, $5)`,
    [
      domain,
      tx,
      maker,
      taker,
      JSON.stringify({ market: 1, fill: `${fill}`, amounts: `${amounts}`, fees: `${fees}`, trade }),
    ],
  );
  await pool.query("INSERT INTO probabl.orders VALUES ($1, $2, $3, 1, 42, $4)", [
    domain,
    closed.id,
    maker,
    JSON.stringify(closed),
  ]);
  await pool.query("INSERT INTO probabl.checkpoints VALUES ($1, 40, '0x', $2)", [
    domain,
    serializeState(legacy),
  ]);

  await db.initialize();
  await db.initialize(); // Idempotent once migrated.
  await db.verify();

  const s = emptyState(legacy.quote);
  const [byMarket] = await db.trades(domain, { markets: [1], limit: 10 });
  expect(tradeView(byMarket!, s, deployment, "finalized")).toEqual({
    id: `${tx}:3`,
    marketId: "1",
    venue: { chainId: 31337, exchange: deployment.exchange, marketId: "1" },
    branch: 1,
    blockTimestamp: "1800000002",
    executionPriceRawX18: "200000000",
    fillQuantity: quantity.toString(),
    executionQuote: "600000000",
    buyerFee: "11",
    sellerFee: "22",
    takerSide: 0,
    makerOrderHash: trade.makerKey,
    takerOrderHash: trade.takerKey,
    maker,
    taker,
    transactionHash: tx,
    confirmation: "finalized",
  });
  for (const owner of [maker, taker])
    expect(await db.trades(domain, { owner, limit: 10 })).toEqual([byMarket!]);
  expect(await db.trades(domain, { limit: 10 })).toEqual([byMarket!]);
  const [order] = await db.closedOrders(domain, maker);
  expect(closedOrderView(order!, s, deployment)).toEqual(closed as never);
  expect(serializeState(readCheckpoint((await db.checkpoint(domain))!.state))).toBe(
    serializeState(legacy),
  );
  const tables = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'probabl' ORDER BY tablename",
  );
  expect(tables.rows.map((r) => r.tablename)).not.toContain("events");
  expect(tables.rows.map((r) => r.tablename)).not.toContain("orders");
}, 30_000);

test("history is idempotent, reads use one index each, and checkpoints advance only", async () => {
  const other = "31337:0x00000000000000000000000000000000000000E2";
  await db.registerDeployment(other);
  await db.registerDeployment(other); // Never consumes another identity value.
  await db.registerDeployment("31337:0x00000000000000000000000000000000000000E3");
  const ids = await pool.query("SELECT id FROM probabl.deployments ORDER BY id");
  expect(ids.rows.map((r) => r.id)).toEqual([1, 2, 3]);
  const record = (block: bigint, owner: Address) => ({
    block,
    logIndex: 0,
    blockTime: 1_800_000_000n + block,
    tx: keccak256(stringToBytes(`t${block}`)),
    market: Number(block % 3n) + 1,
    branch: 0,
    takerSide: 1,
    makerSeq: block,
    takerSeq: block + 1n,
    quantity: 10n ** 18n,
    price: 2n * 10n ** 8n,
    quote: 2n * 10n ** 8n,
    buyerFee: 0n,
    sellerFee: 1n,
    maker: owner.toLowerCase(),
    taker: taker.toLowerCase(),
  });
  const trades = Array.from({ length: 60 }, (_, i) =>
    record(BigInt(100 + i), i % 2 ? maker : delegate),
  );
  const state = new Uint8Array(await Bun.zstdCompress(encodeCheckpoint(emptyState(maker))));
  const batch = { trades, orders: [], checkpoint: { block: "159", hash: "0xab", state } };
  await db.persistFinalized(other, batch);
  await db.persistFinalized(other, batch); // A replayed batch writes nothing.
  expect(await db.trades(other, { limit: 1000 })).toHaveLength(60);
  const newest = await db.trades(other, { markets: [1, 2], limit: 5 });
  expect(newest.map((t) => t.block)).toEqual([159n, 157n, 156n, 154n, 153n]);
  const mine = await db.trades(other, { owner: maker, markets: [2], limit: 100 });
  expect(mine.every((t) => t.maker === maker.toLowerCase() && t.market === 2)).toBe(true);
  expect(mine).toHaveLength(10);
  // An older checkpoint never replaces a newer one.
  await db.persistFinalized(other, {
    trades: [],
    orders: [],
    checkpoint: { ...batch.checkpoint, block: "100" },
  });
  expect((await db.checkpoint(other))!.block).toBe("159");

  // 24-hour volume reads group quote by market and minute, within a time and block range:
  // blocks 120..150 here, all in one minute.
  const minute = Number((1_800_000_000n + 120n) / 60n);
  expect(
    (await db.minuteVolumes(other, 1_800_000_120n, 150n)).sort((a, b) => a.market - b.market),
  ).toEqual([
    { market: 1, minute, quote: 11n * 2n * 10n ** 8n },
    { market: 2, minute, quote: 10n * 2n * 10n ** 8n },
    { market: 3, minute, quote: 10n * 2n * 10n ** 8n },
  ]);
  // Another deployment's trades are not this one's.
  expect(
    await db.minuteVolumes("31337:0x00000000000000000000000000000000000000E3", 0n, 1_000n),
  ).toEqual([]);

  // Each history read is an index scan (no sort, no sequential scan), even when tiny tables
  // would tempt the planner otherwise.
  const client = await pool.connect();
  try {
    await client.query("SET enable_seqscan = off");
    for (const [sql, params] of [
      [
        "SELECT * FROM probabl.trades WHERE deployment = 2 AND market = $1 ORDER BY block DESC, log_index DESC LIMIT 5",
        [1],
      ],
      [
        "SELECT * FROM probabl.trades WHERE deployment = 2 AND taker = decode($1, 'hex') ORDER BY block DESC, log_index DESC LIMIT 5",
        [taker.slice(2).toLowerCase()],
      ],
      [
        "SELECT * FROM probabl.closed_orders WHERE deployment = 2 AND owner = decode($1, 'hex') ORDER BY updated_block DESC LIMIT 5",
        [maker.slice(2).toLowerCase()],
      ],
    ] as const) {
      const plan = (await client.query(`EXPLAIN ${sql}`, [...params])).rows
        .map((r) => r["QUERY PLAN"])
        .join("\n");
      expect(plan).toContain("Index Scan Backward");
      expect(plan).not.toContain("Sort");
    }
    // The volume read, as in production (every block so far, the latest trades by time), covers
    // its columns from the time index alone once statistics exist, as autovacuum keeps them for
    // this append-only table.
    await client.query("VACUUM (ANALYZE) probabl.trades");
    const plan = (
      await client.query(
        `EXPLAIN SELECT market, block_time / 60, sum(quote) FROM probabl.trades
        WHERE deployment = 2 AND block_time >= $1 AND block <= $2 GROUP BY market, block_time / 60`,
        [1_800_000_150, 159],
      )
    ).rows
      .map((r) => r["QUERY PLAN"])
      .join("\n");
    expect(plan).toContain("Index Only Scan using trades_time");
  } finally {
    client.release();
  }
}, 30_000);
