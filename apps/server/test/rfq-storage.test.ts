/** Approved RFQ makers against a disposable PostgreSQL: keys are found by hash while active. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createDatabase, type Database } from "@conditional-stocks/db";
import { localDatabase } from "@conditional-stocks/db/local";
import { getAddress } from "viem";
import { apiKeyHash, newApiKey } from "../src/rfq/routes.ts";

const domain = "31337:0x00000000000000000000000000000000000000E1";
const wallet = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
let pg: Awaited<ReturnType<typeof localDatabase>>;
let db: Database;

beforeAll(async () => {
  pg = await localDatabase();
  db = createDatabase({ connectionString: pg.connectionString });
  await db.initialize();
}, 60_000);
afterAll(async () => {
  await db?.close();
  await pg?.close();
});

test("an approved maker is found by its key's hash until revoked", async () => {
  const key = newApiKey();
  expect(key).toMatch(/^pbl_rfq_[A-Za-z0-9_-]{43}$/);
  const created = await db.createRfqMaker(domain, {
    id: crypto.randomUUID(),
    label: "Desk A",
    wallet: wallet(0xaa),
    keyHash: apiKeyHash(key),
    keyPrefix: key.slice(0, 12),
    createdBy: wallet(0xad),
  });
  expect(created).toMatchObject({
    label: "Desk A",
    wallet: wallet(0xaa).toLowerCase(),
    keyPrefix: key.slice(0, 12),
    createdBy: wallet(0xad).toLowerCase(),
    revokedAt: null,
  });
  expect((await db.rfqMakerByKey(domain, apiKeyHash(key)))?.id).toBe(created.id);
  // Another deployment, or another key, finds nothing.
  expect(await db.rfqMakerByKey("1:0x0", apiKeyHash(key))).toBeUndefined();
  expect(await db.rfqMakerByKey(domain, apiKeyHash(newApiKey()))).toBeUndefined();

  const second = await db.createRfqMaker(domain, {
    id: crypto.randomUUID(),
    label: "Desk B",
    wallet: wallet(0xbb),
    keyHash: apiKeyHash(newApiKey()),
    keyPrefix: "pbl_rfq_abcd",
    createdBy: wallet(0xad),
  });
  expect((await db.rfqMakers(domain)).map((m) => m.id)).toEqual([second.id, created.id]);

  expect(await db.revokeRfqMaker(domain, created.id)).toBe(1);
  expect(await db.revokeRfqMaker(domain, created.id)).toBe(0);
  expect(await db.rfqMakerByKey(domain, apiKeyHash(key))).toBeUndefined();
  const [, revoked] = await db.rfqMakers(domain);
  expect(revoked?.revokedAt).toBeInstanceOf(Date);
}, 30_000);

test("a key hash belongs to one maker only", async () => {
  const keyHash = apiKeyHash(newApiKey());
  const maker = (label: string) => ({
    id: crypto.randomUUID(),
    label,
    wallet: wallet(0xcc),
    keyHash,
    keyPrefix: "pbl_rfq_dupe",
    createdBy: wallet(0xad),
  });
  await db.createRfqMaker(domain, maker("first"));
  await expect(db.createRfqMaker(domain, maker("second"))).rejects.toThrow();
});
