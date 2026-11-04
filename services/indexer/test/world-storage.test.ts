/** World books' storage (schema version 6): version 5 storage migrates in place, finalized fills
 * persist once with their checkpoint, and each query of the world tables reads back what it
 * wrote: book metadata, delegated fills, referral accruals, probability and price history, the
 * keeper's pricing inputs (an admin's estimate survives a fit) and the vault's marks. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createDatabase,
  type Database,
  SCHEMA_VERSION,
  type WorldBookMetadata,
  type WorldFillRow,
} from "@conditional-stocks/db";
import { localDatabase } from "@conditional-stocks/db/local";
import { Pool } from "@conditional-stocks/db/testing";
import { keccak256, stringToBytes } from "viem";

const domain = "31337:0x00000000000000000000000000000000000000b1";
const h = (s: string) => keccak256(stringToBytes(s));
const hex = (value: string) => value.slice(2).toLowerCase();
const alice = "0x00000000000000000000000000000000000000a1";
const bob = "0x00000000000000000000000000000000000000b2";
const vault = "0x00000000000000000000000000000000000000fa";
const metadata: WorldBookMetadata = {
  legs: [
    {
      eventKey: h("leg"),
      wantYes: true,
      source: "polymarket",
      marketId: "1",
      conditionId: h("condition"),
      yesIndex: 1,
      noIndex: 2,
      question: "Will it happen?",
      url: "https://polymarket.com/event/x",
      endTime: "2026-12-01T00:00:00.000Z",
      themes: ["ai"],
    },
  ],
  underlying: "US:NVDA",
  feedDecimals: 8,
  fixing: "NVDA's Dec 1 close",
  metadataUri: "https://probabl.trade/worlds/x.json",
  def: { feeBps: 100 },
};
const fill = (block: bigint, logIndex: number, over: Partial<WorldFillRow> = {}): WorldFillRow => ({
  block,
  logIndex,
  blockTime: 1_790_000_000n + block,
  tx: h(`tx${block}`),
  book: 1,
  maker: vault,
  taker: alice,
  delegate: null,
  mask: 0b110,
  sell: false,
  units: 100_000_000n,
  refund: 0n,
  price: 30_000_000n,
  fee: 300_000n,
  nonce: 1n,
  ...over,
});

let pg: Awaited<ReturnType<typeof localDatabase>>;
let db: Database;
let pool: Pool;

beforeAll(async () => {
  pg = await localDatabase();
  pool = new Pool({ connectionString: pg.connectionString, max: 1 });
  db = createDatabase({ connectionString: pg.connectionString });
  await db.initialize();
  await db.registerDeployment(domain);
}, 60_000);
afterAll(async () => {
  await pool?.end();
  await db?.close();
  await pg?.close();
});

test("version 5 storage migrates in place to version 6", async () => {
  expect(SCHEMA_VERSION).toBe(6);
  // Version 5 as the previous release left it: no world tables, makers without `worlds`.
  for (const table of [
    "world_fills",
    "world_books",
    "world_submissions",
    "event_probabilities",
    "world_correlations",
    "event_volatility",
    "world_gaps",
    "world_vols",
    "leg_relations",
    "vault_marks",
    "world_prices",
  ])
    await pool.query(`DROP TABLE probabl.${table}`);
  await pool.query("ALTER TABLE probabl.rfq_makers DROP COLUMN worlds");
  await pool.query("UPDATE probabl.schema_version SET version = 5");
  const reopened = createDatabase({ connectionString: pg.connectionString });
  await reopened.initialize();
  await reopened.close();
  expect((await pool.query("SELECT version FROM probabl.schema_version")).rows[0].version).toBe(6);
  const columns = await pool.query(
    `SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'probabl' AND table_name = 'rfq_makers' AND column_name = 'worlds'`,
  );
  expect(columns.rowCount).toBe(1);
  expect(await db.worldFills(domain, { limit: 10 })).toEqual([]);
});

describe("world tables", () => {
  test("finalized fills persist once, with the checkpoint, and read by book and by owner", async () => {
    const batch = [
      fill(10n, 0),
      fill(11n, 1, { taker: bob, delegate: alice, sell: true, book: 2, fee: 0n }),
      fill(12n, 0, { refund: 5_000_000n }),
    ];
    const checkpoint = { block: "12", hash: h("block12"), state: new Uint8Array([1, 2, 3]) };
    await db.persistWorldFinalized(domain, { fills: batch, checkpoint });
    // A replayed batch writes nothing, and an older checkpoint never replaces a newer one.
    await db.persistWorldFinalized(domain, {
      fills: batch,
      checkpoint: { ...checkpoint, block: "11" },
    });
    const all = await db.worldFills(domain, { limit: 10 });
    expect(all.map((f) => [f.block, f.logIndex])).toEqual([
      [12n, 0],
      [11n, 1],
      [10n, 0],
    ]);
    expect(all[0]).toEqual({ ...batch[2]!, tx: batch[2]!.tx.toLowerCase() });
    expect(all[1]!.delegate).toBe(alice);
    expect((await db.worldFills(domain, { books: [2], limit: 10 })).length).toBe(1);
    // An owner's fills as taker and as maker.
    expect((await db.worldFills(domain, { owner: bob, limit: 10 })).map((f) => f.book)).toEqual([
      2,
    ]);
    expect((await db.worldFills(domain, { owner: vault, limit: 2 })).length).toBe(2);
    expect((await db.worldFills(domain, { owner: alice, books: [1], limit: 10 })).length).toBe(2);
    expect((await db.checkpoint(domain))?.block).toBe("12");
    const volumes = await db.worldVolumes(domain, 0n, 11n);
    expect(volumes.sort((a, b) => a.book - b.book)).toEqual([
      { book: 1, premium: 30_000_000n, fees: 300_000n, fills: 1 },
      { book: 2, premium: 30_000_000n, fees: 0n, fills: 1 },
    ]);
  });

  test("a book's metadata registers once and takes its on-chain id once", async () => {
    const defHash = h("def");
    const registered = await db.registerWorldBook(domain, {
      defHash,
      title: "NVDA if AI",
      kind: "curated",
      metadata,
      packetHash: h("packet"),
    });
    expect(registered).toMatchObject({ defHash, book: null, title: "NVDA if AI", metadata });
    // The first metadata stands.
    await db.registerWorldBook(domain, { defHash, title: "Other", kind: "user", metadata });
    await db.setWorldBookId(domain, defHash, 7);
    await db.setWorldBookId(domain, defHash, 8);
    expect(await db.worldBook(domain, defHash)).toMatchObject({ title: "NVDA if AI", book: 7 });
    expect((await db.worldBooks(domain)).length).toBe(1);
  });

  test("delegated fills journal once per client id and count per day", async () => {
    await db.recordWorldSubmission(domain, alice, "client-1", "t", bob, h("s1"), "0x01");
    await expect(
      db.recordWorldSubmission(domain, alice, "client-1", "t", bob, h("s2"), "0x02"),
    ).rejects.toThrow();
    expect(await db.worldSubmission(domain, alice, "client-1")).toEqual({
      terms_hash: "t",
      delegate: bob,
      tx_hash: h("s1"),
      raw: "0x01",
    });
    expect(await db.worldSubmissionCount(domain, alice)).toBe(1);
    expect(await db.worldSubmissionCount(domain, bob)).toBe(0);
  });

  test("referrers accrue their share of world fees and unlock on the Monday after", async () => {
    const referrer = "0x00000000000000000000000000000000000000cc";
    await pool.query(
      `INSERT INTO probabl.members (wallet, code, referrer, joined_at, code_quota)
      VALUES (decode($1, 'hex'), 'r', NULL, now() - interval '400 days', 5),
        (decode($2, 'hex'), 'a', decode($1, 'hex'), to_timestamp(1789999000), 5)`,
      [hex(referrer), hex(alice)],
    );
    const first = await db.accrueWorldReferrals(domain, { rateBps: 1_500, months: 6 });
    // Alice's two fills with a fee (as taker); Bob's fill has no referrer.
    expect(first).toEqual({ fills: 3, accruals: 2 });
    expect(await db.accrueWorldReferrals(domain, { rateBps: 1_500, months: 6 })).toEqual({
      fills: 0,
      accruals: 0,
    });
    const weeks = await db.worldReferralWeeks(domain, referrer);
    expect(weeks).toEqual([
      { unlockAt: expect.any(Number), amount: 90_000n, fee: 600_000n, fills: 2 },
    ]);
    const unlock = new Date(weeks[0]!.unlockAt * 1000);
    expect([unlock.getUTCDay(), unlock.getUTCHours()]).toEqual([1, 0]);
    expect(weeks[0]!.unlockAt).toBeGreaterThan(1_790_000_012);
    expect(weeks[0]!.unlockAt - 1_790_000_012).toBeLessThanOrEqual(7 * 86_400);
  });

  test("probability and price history keep the first row of a minute and bucket by the last", async () => {
    const c = h("condition");
    await db.recordEventProbabilities([
      { condition: c, minute: 100, mid: 300_000, spread: 10_000 },
      { condition: c, minute: 101, mid: 310_000, spread: null },
      { condition: c, minute: 105, mid: 320_000, spread: 8_000 },
    ]);
    await db.recordEventProbabilities([{ condition: c, minute: 100, mid: 999_999, spread: 1 }]);
    expect(await db.eventProbabilityHistory([c], 0)).toEqual([
      { condition: c, minute: 100, mid: 300_000, spread: 10_000 },
      { condition: c, minute: 101, mid: 310_000, spread: null },
      { condition: c, minute: 105, mid: 320_000, spread: 8_000 },
    ]);
    // Five-minute buckets: the last of 100-104, then 105.
    expect((await db.eventProbabilityHistory([c], 0, 5)).map((r) => r.minute)).toEqual([101, 105]);
    expect(await db.eventProbabilityHistory([c], 102)).toHaveLength(1);
    // The daily read: each day's last row at or before 20:00 UTC, within the day before.
    const d = h("daily"),
      day = (n: number, hh: number, mm = 0) => n * 1_440 + hh * 60 + mm;
    await db.recordEventProbabilities(
      [day(10, 19, 59), day(10, 20), day(10, 20, 1), day(12, 8), day(14, 19)].map((minute, i) => ({
        condition: d,
        minute,
        mid: 400_000 + i,
        spread: null,
      })),
    );
    expect(
      (await db.dailyEventProbabilities([d, c], day(10, 0), day(14, 0))).map((r) => [
        r.condition,
        r.minute,
      ]),
    ).toEqual([
      [d, day(10, 20)],
      [d, day(10, 20, 1)],
      [d, day(12, 8)],
    ]);
    expect(await db.dailyEventProbabilities([d], day(15, 0), day(14, 0))).toEqual([]);
    await db.recordWorldPrices(domain, [
      { book: 1, product: "world", minute: 100, bid: 20_000, ask: 30_000 },
      { book: 1, product: "world", minute: 104, bid: 21_000, ask: null },
      { book: 1, product: "above:3", minute: 104, bid: 1, ask: 2 },
    ]);
    expect(await db.worldPriceHistory(domain, 1, "world", 0, 60)).toEqual([
      { book: 1, product: "world", minute: 104, bid: 21_000, ask: null },
    ]);
  });

  test("pricing inputs: fits replace fits, never an admin's estimate", async () => {
    const [a, b] = [h("a"), h("b")].sort((x, y) => (hex(x) < hex(y) ? 1 : -1));
    // Given out of order, stored as (a < b).
    await db.putWorldCorrelations([
      { a: a!, b: b!, rho: 0.2, error: 0.1, samples: 40, method: "lead-lag" },
    ]);
    let [row] = await db.worldCorrelations([a!, b!]);
    expect(row).toMatchObject({ a: b, b: a, rho: 0.2, samples: 40 });
    await db.putWorldCorrelations([
      { a: b!, b: a!, rho: 0.5, error: 0.05, samples: 0, method: "admin" },
    ]);
    await db.putWorldCorrelations([
      { a: b!, b: a!, rho: 0.1, error: 0.1, samples: 60, method: "lead-lag" },
    ]);
    [row] = await db.worldCorrelations();
    expect(row).toMatchObject({ rho: 0.5, method: "admin" });
    await db.putWorldCorrelations(
      [{ a: b!, b: a!, rho: 0.1, error: 0.1, samples: 60, method: "lead-lag" }],
      { overrideAdmin: true },
    );
    expect(await db.worldCorrelations([a!])).toEqual([]);
    expect((await db.worldCorrelations([a!, b!]))[0]!.rho).toBe(0.1);

    await db.putEventVolatilities([{ condition: a!, vol: 0.12, samples: 30 }]);
    await db.putEventVolatilities([{ condition: a!, vol: 0.15, samples: 31 }]);
    expect(await db.eventVolatilities([a!])).toMatchObject([
      { condition: a, vol: 0.15, samples: 31 },
    ]);

    await db.putWorldGaps([
      { condition: a!, underlying: "US:NVDA", gap: 0.05, error: 0.02, samples: 3, method: "admin" },
    ]);
    await db.putWorldGaps([
      {
        condition: a!,
        underlying: "US:NVDA",
        gap: 0.01,
        error: 0.01,
        samples: 9,
        method: "event-study",
      },
    ]);
    expect(await db.worldGaps("US:NVDA")).toMatchObject([{ gap: 0.05, method: "admin" }]);
    expect(await db.worldGaps("US:AAPL")).toEqual([]);

    await db.putWorldVols([
      { underlying: "US:NVDA", vol: 0.45, error: 0.05, samples: 63, method: "blend" },
    ]);
    await db.putWorldVols([
      { underlying: "US:NVDA", vol: 0.5, error: 0.05, samples: 64, method: "blend" },
    ]);
    expect(await db.worldVols()).toMatchObject([{ underlying: "US:NVDA", vol: 0.5, samples: 64 }]);

    await db.putLegRelation({
      a: a!,
      b: b!,
      kind: "positive",
      pBGivenA: 0.6,
      pBGivenNotA: 0.3,
      confidence: 0.7,
      source: "model",
      model: "claude-opus-5-5",
      reasoning: "Same driver",
      reviewer: null,
    });
    await db.putLegRelation({
      a: a!,
      b: b!,
      kind: "implies",
      pBGivenA: 1,
      pBGivenNotA: 0.3,
      confidence: 1,
      source: "admin",
      model: null,
      reasoning: null,
      reviewer: alice,
    });
    const relations = await db.legRelations([b!]);
    expect(relations).toMatchObject([{ a, b, kind: "implies", reviewer: alice, source: "admin" }]);
    expect(await db.legRelations([h("other")])).toEqual([]);
  });

  test("a vault's mark records once per batch and gains its transaction", async () => {
    const mark = {
      vault,
      batch: 3,
      nav: 1_000_000_000n,
      guaranteed: 990_000_000n,
      best: 1_010_000_000n,
      inputsHash: h("inputs"),
      inputs: { books: [1] },
      tx: null,
    };
    await db.recordVaultMark(domain, mark);
    await db.recordVaultMark(domain, { ...mark, nav: 1n, tx: h("mark") });
    await db.recordVaultMark(domain, { ...mark, tx: h("other") });
    await db.recordVaultMark(domain, { ...mark, batch: 4 });
    const marks = await db.vaultMarks(domain, vault);
    expect(marks.map((m) => m.batch)).toEqual([4, 3]);
    expect(marks[1]).toMatchObject({ nav: 1_000_000_000n, tx: h("mark"), inputs: { books: [1] } });
  });
});
