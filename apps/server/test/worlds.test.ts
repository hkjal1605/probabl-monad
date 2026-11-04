/** The world books' `/v2` API end to end, on anvil and PostgreSQL: the world index serves books,
 * positions, vaults and fills from its replica; world orders go out over the RFQ stream (protocol
 * version 2) to the vault's keeper, whose quotes the desk checks and awards; the wallet fills one
 * itself, the trading delegate fills others (journaled, idempotent); finalized fills persist and
 * a restart resumes from the checkpoint. The API's own RPC and database calls are counted: a
 * quote costs none, a delegated fill exactly what a v1 delegated order costs. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDatabase, type Database } from "@conditional-stocks/db";
import { localDatabase } from "@conditional-stocks/db/local";
import {
  bookDefHash,
  outcomeMask,
  WORLD_QUOTE_TYPES,
  worldQuoteDomain,
} from "@conditional-stocks/evm-client";
import type {
  WorldEvent,
  WorldState,
  WorldTouched,
} from "@conditional-stocks/evm-client/world-ledger";
import { ChainFollower } from "@conditional-stocks/indexer";
import { WorldIndexer, worldLedger } from "@conditional-stocks/indexer/worlds";
import { hashCanonical, normalizeGammaMarket } from "@conditional-stocks/market-data";
import { initialJournal } from "@conditional-stocks/operator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Address, getAddress, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type Anvil, accounts, send, startAnvil } from "../../../packages/evm-client/test/anvil.ts";
import {
  CONDITIONS,
  deployWorlds,
  eventDef,
  pricedDef,
  URI,
  type Worlds,
} from "../../../packages/evm-client/test/worlds-anvil.ts";
import { settings } from "../../../services/world-keeper/src/config.ts";
import { WorldKeeper } from "../../../services/world-keeper/src/engine.ts";
import { emptyData } from "../../../services/world-keeper/src/inputs.ts";
import { LegReferences, SpotReferences } from "../../../services/world-keeper/src/references.ts";
import { WorldRfqMaker } from "../../../services/world-keeper/src/rfq.ts";
import type { Auth } from "../src/auth/routes.ts";
import { RfqHub, type RfqSession } from "../src/rfq/hub.ts";
import { mountWorldAdmin } from "../src/worlds/admin.ts";
import { WorldDesk } from "../src/worlds/desk.ts";
import { mountWorlds } from "../src/worlds/routes.ts";
import { WorldTrading } from "../src/worlds/trading.ts";

let node: Anvil;
let worlds: Worlds;
let pg: Awaited<ReturnType<typeof localDatabase>>;
let db: Database;
let indexer: WorldIndexer;
let keeperFollower: ChainFollower<WorldState, WorldTouched, WorldEvent>;
let maker: WorldRfqMaker;
let hub: RfqHub;
let domain: string;
const app = new Hono();
const toMaker: Record<string, unknown>[] = [];
const [, alice] = accounts.map((a) => a.address) as Address[];
const delegate = privateKeyToAccount(generatePrivateKey());
const WORLD = outcomeMask({ kind: "world" }, 7);
const admin = accounts[0]!.address;
/** The venue as the ingestor serves it: event 2 (the GPU order) open on Polymarket. */
const gamma = {
  active: true,
  closed: false,
  clobTokenIds: JSON.stringify(["111", "222"]),
  conditionId: CONDITIONS[2],
  description: "Resolves Yes if the order is announced.",
  endDate: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  id: "gamma-2",
  negRisk: false,
  outcomes: JSON.stringify(["Yes", "No"]),
  question: "GPU order?",
  resolutionSource: "Company release",
  slug: "gpu-order",
  umaResolutionStatus: "unresolved",
};
const tracked: string[] = [];
const venue = {
  track: async (snapshot: string) => void tracked.push(snapshot),
  fetchMetadata: async () => ({
    snapshotId: "snapshot-gpu",
    rawHash: hashCanonical(gamma),
    normalized: normalizeGammaMarket(gamma),
  }),
};
/** The API's calls (the world index has its own client, uncounted). */
const calls: Record<string, number> = {};
/** `target` with each method call counted under `prefix` (and a locked transaction's queries
 * under `db.q.`). */
function counted<T extends object>(target: T, prefix: string): T {
  return new Proxy(target, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        calls[`${prefix}${String(k)}`] = (calls[`${prefix}${String(k)}`] ?? 0) + 1;
        if (k === "locked") {
          const [key, run] = args as [string, (q: object) => unknown];
          return v.call(t, key, (q: object) => run(counted(q, "db.q.")));
        }
        return v.apply(t, args);
      };
    },
  });
}
const resetCalls = () => {
  for (const k of Object.keys(calls)) delete calls[k];
};

/** The signed-in wallet is whatever `x-test-owner` names (the auth routes have their own tests). */
const owner = (c: { req: { header(name: string): string | undefined } }) => {
  const value = c.req.header("x-test-owner");
  if (!value) throw new HTTPException(401, { message: "Sign in to continue" });
  return getAddress(value);
};
const auth = {
  session: async (c: never) => ({ owner: owner(c) }),
  member: async (c: never) => ({ owner: owner(c) }),
  trader: async (c: never) => ({ owner: owner(c) }),
  bearer: async () => alice!,
  memberOf: async () => null,
  forgetMember: () => {},
} as unknown as Auth;
const call = async (path: string, body?: unknown, as: Address = alice!) => {
  const response = await app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "x-test-owner": as,
      authorization: `Bearer ${as}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};
const until = async (check: () => boolean | Promise<boolean>, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Timed out");
    await Bun.sleep(50);
  }
};

beforeAll(async () => {
  node = await startAnvil(Math.floor(Date.now() / 1000));
  const now = Number((await node.client.getBlock()).timestamp);
  worlds = await deployWorlds(node, now);
  const priced = pricedDef(worlds, now),
    event = eventDef(now);
  await send(node, 0, worlds.w.createBook(priced, URI));
  await send(node, 0, worlds.w.createBook(event, URI));
  await node.client.setBalance({ address: delegate.address, value: 10n ** 20n });
  pg = await localDatabase(process.env.TEST_DATABASE_URL);
  db = createDatabase({ connectionString: pg.connectionString });
  await db.initialize();
  domain = `${node.chain.id}:${worlds.books}`;
  await db.registerDeployment(domain);
  const legs = (defLegs: typeof priced.legs, offset: number, themes: string[][]) =>
    defLegs.map((l, i) => ({
      eventKey: l.eventKey,
      wantYes: l.wantYes,
      source: "polymarket" as const,
      marketId: String(offset + i),
      conditionId: CONDITIONS[offset + i]!,
      yesIndex: 1,
      noIndex: 2,
      question: `Event ${offset + i}`,
      url: "https://polymarket.com/event",
      endTime: new Date((now + 27 * 86_400) * 1000).toISOString(),
      themes: themes[i]!,
    }));
  for (const [def, offset, themes, underlying] of [
    [priced, 0, [["us-china"], ["ai"], ["ai"]], "US:NVDA"],
    [event, 3, [["fed"]], null],
  ] as const)
    await db.registerWorldBook(domain, {
      defHash: bookDefHash(def),
      title: `World ${offset}`,
      kind: "curated",
      metadata: {
        legs: legs(def.legs, offset, themes as unknown as string[][]),
        underlying,
        feedDecimals: 8,
        fixing: null,
        metadataUri: URI,
        def: {},
      },
    });
  const deployment = {
    chainId: node.chain.id,
    books: worlds.books,
    oracle: worlds.oracle,
    quote: worlds.usdg,
    vaults: [worlds.vault],
  };
  const client = node.publicClient as PublicClient;
  indexer = new WorldIndexer({
    client,
    deployment,
    deploymentBlock: worlds.deploymentBlock,
    db,
    pollMs: 200,
    finalityMs: 200,
    finalityDepth: 0n,
    checkpointMs: 0,
  });
  await indexer.start();
  hub = new RfqHub({
    windowMs: 400,
    maxSessionsPerMaker: 2,
    welcome: (m) => ({
      chainId: node.chain.id,
      minQuoteSeconds: 3,
      ...(m.worlds
        ? {
            worlds: {
              books: worlds.books,
              vaults: [worlds.vault],
              signing: {
                domain: worldQuoteDomain(node.chain.id, worlds.books),
                types: WORLD_QUOTE_TYPES,
              },
            },
          }
        : {}),
    }),
  });
  const desk = new WorldDesk({ hub, indexer, chainId: node.chain.id, minQuoteSeconds: 3 });
  indexer.prices = (book) => hub.worldPrices().get(book);
  app.onError((error) =>
    Response.json(
      { error: { message: error.message } },
      { status: error instanceof HTTPException ? error.status : 400 },
    ),
  );
  indexer.mount(app);
  const api = { client: counted(client, ""), db: counted(db, "db.") };
  mountWorlds(app, {
    indexer,
    client: api.client,
    auth,
    db: api.db,
    hub,
    desk,
    trading: new WorldTrading({ indexer, desk, db: api.db, client: api.client, signer: delegate }),
    signer: delegate,
  });
  mountWorldAdmin(app, {
    db,
    indexer,
    client,
    authenticate: async (header) => getAddress(header!.replace("Bearer ", "")),
    events: () => venue as never,
    metadataBase: "http://127.0.0.1:4000",
  });
  // The vault's keeper, on its own replica, connected to the hub in process.
  keeperFollower = new ChainFollower<WorldState, WorldTouched, WorldEvent>({
    client,
    exchange: worlds.books,
    quote: worlds.usdg,
    ledger: worldLedger(deployment),
    deploymentBlock: worlds.deploymentBlock,
    domain: "keeper",
    pollMs: 200,
    finalityDepth: 0n,
    onCommit: (notice) => keeper?.onFills(notice.events),
  });
  await keeperFollower.start();
  const refs = new LegReferences({
    origin: "http://127.0.0.1:1",
    fetch: (async () => new Response("null")) as never,
    connect: () => ({ onmessage: null, onclose: null, close() {} }),
  });
  const observe = () =>
    CONDITIONS.forEach((c, i) => {
      refs.observe(c, {
        schemaVersion: 1,
        quality: "valid",
        isStale: false,
        conditionId: c,
        midpointX6: String([350_000, 150_000, 300_000, 600_000][i]),
        bestBidX6: String([345_000, 145_000, 295_000, 595_000][i]),
        bestAskX6: String([355_000, 155_000, 305_000, 605_000][i]),
        observedAtMs: String(Date.now()),
      });
    });
  observe();
  const ticker = setInterval(() => {
    observe();
    keeper.refresh();
  }, 500);
  ticker.unref();
  const spot = new SpotReferences({
    client,
    origin: "http://127.0.0.1:1",
    pollMs: 60_000,
    sources: () => [{ feed: worlds.feed }],
  });
  await spot.poll();
  const meta = new Map(
    (await db.worldBooks(domain)).map((r) => [
      Number(keeperFollower.confirmed.bookOf.get(r.defHash.toLowerCase() as Hex)),
      r,
    ]),
  );
  const data = emptyData();
  for (const [i, gap] of [0.08, 0.02, 0.05].entries())
    data.gaps.set(`${CONDITIONS[i]!.toLowerCase()}:US:NVDA`, { gap, error: 0.015 });
  const keeper = new WorldKeeper({
    follower: keeperFollower,
    settings: settings({
      vault: worlds.vault,
      underlyings: { "US:NVDA": { kind: "stock", vol: 0.47 } },
      references: { allowStaleSpot: true },
    }),
    chainId: node.chain.id,
    legs: refs,
    spot,
    metadata: () => meta,
    data: () => data,
    state: { version: 1, scope: "api-test", ...initialJournal(), counter: "1" },
    save: () => {},
    account: accounts[4]!,
  });
  keeper.refresh(true);
  let socket: { onmessage: ((e: { data: unknown }) => void) | null } | null = null;
  const session: RfqSession = {
    maker: {
      id: "11111111-1111-4111-8111-111111111111",
      label: "World vault",
      wallet: worlds.vault,
      worlds: true,
    },
    send(message) {
      toMaker.push(message as Record<string, unknown>);
      queueMicrotask(() => socket?.onmessage?.({ data: JSON.stringify(message) }));
      return true;
    },
    close() {},
  };
  maker = new WorldRfqMaker({
    keeper,
    url: "ws://in-process",
    apiKey: "k",
    chainId: node.chain.id,
    indicationMs: 60_000,
    live: true,
    log: () => {},
    connect: () => {
      const s = {
        onopen: null,
        onmessage: null as ((e: { data: unknown }) => void) | null,
        onclose: null,
        send: (data: string) => hub.receive(session, data),
        close() {},
      };
      socket = s;
      return s;
    },
  });
  maker.start();
  hub.attach(session);
  await until(() => toMaker.some((m) => m.type === "welcome"));
  await Bun.sleep(50);
}, 180_000);
afterAll(async () => {
  maker?.stop();
  keeperFollower?.stop();
  await indexer?.stop();
  await db?.close();
  await pg?.close();
  node?.stop();
});

describe("the world API", () => {
  test("books, vaults and indications read from the world index", async () => {
    const books = (await call("/v2/books")).body.books as Record<string, unknown>[];
    expect(books.map((b) => b.id)).toEqual([2, 1]);
    const one = books.find((b) => b.id === 1)!;
    expect(one.state).toBe("trading");
    expect((one.legs as { venue: { conditionId: string } }[])[0]!.venue.conditionId).toBe(
      CONDITIONS[0]!,
    );
    expect((one.products as unknown[]).length).toBe(21);
    maker.indicate();
    await until(() => hub.worldPrices().size === 2);
    const prices = (await call("/v2/worlds/prices")).body.books as {
      book: number;
      marks: number[];
    }[];
    expect(prices.find((p) => p.book === 2)!.marks.reduce((a, b) => a + b, 0)).toBe(1_000_000);
    const vaults = (await call("/v2/vaults")).body.vaults as Record<string, unknown>[];
    expect(vaults[0]!.address).toBe(worlds.vault);
    expect(vaults[0]!.refNav).toBe("1000000000000");
    expect((await call("/v2/worlds/status")).body.makers).toBe(1);
  });

  test("a firm quote the wallet fills itself; its maker hears it filled", async () => {
    resetCalls();
    const started = performance.now();
    const { status, body } = await call("/v2/worlds/quote", {
      order: { book: 1, mask: WORLD, side: "buy", stake: "50000000" },
    });
    expect(status).toBe(200);
    // No RPC call and no database read: the order and the quote are checked on the replica,
    // the signature locally, and the window closed as soon as the only maker answered.
    expect(calls).toEqual({});
    expect(performance.now() - started).toBeLessThan(200);
    const tx = body.transaction as { to: Address; data: Hex };
    expect(getAddress(tx.to)).toBe(worlds.books);
    const receipt = await send(node, 1, tx);
    expect(receipt.status).toBe("success");
    await until(() => toMaker.some((m) => m.type === "world.result" && m.outcome === "filled"));
  });

  test("a delegated fill is journaled, idempotent and inside the grant", async () => {
    const grant = await call("/v2/worlds/delegate/prepare", {
      expiresAt: String(Math.floor(Date.now() / 1000) + 30 * 86_400),
      maxBuy: "1000000000",
      totalBuy: "5000000000",
      maxSell: "5000000000",
      totalSell: "50000000000",
      maxFeeBps: 200,
      permissions: 3,
    });
    expect(grant.status).toBe(200);
    for (const t of grant.body.transactions as { to: Address; data: Hex }[]) await send(node, 1, t);
    await until(() => indexer.trading().grants.has(`${alice}:${delegate.address}`));
    const order = { book: 2, mask: 0b10, side: "buy", stake: "20000000" };
    resetCalls();
    const first = await call("/v2/worlds/submit", { order, clientId: "client-0001" });
    expect([first.status, first.body.error]).toEqual([200, undefined]);
    // What a v1 delegated order costs: the journal read, the locked read, count and record; one
    // simulation, preparation, broadcast and receipt.
    expect(calls).toEqual({
      "db.worldSubmission": 1,
      "db.locked": 1,
      "db.q.worldSubmission": 1,
      "db.q.worldSubmissionCount": 1,
      "db.q.recordWorldSubmission": 1,
      call: 1,
      prepareTransactionRequest: 1,
      sendRawTransaction: 1,
      getTransactionReceipt: 1,
    });
    resetCalls();
    const hash = first.body.transactionHash as Hex;
    expect((await db.worldSubmission(domain, alice!, "client-0001"))?.tx_hash).toBe(hash);
    const again = await call("/v2/worlds/submit", { order, clientId: "client-0001" });
    expect(again.body.transactionHash).toBe(hash);
    // A retry asks no maker and sends nothing: the journal, then the receipt.
    expect(calls).toEqual({
      "db.worldSubmission": 1,
      "db.locked": 1,
      "db.q.worldSubmission": 1,
      getTransactionReceipt: 1,
    });
    const receipt = await node.client.getTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");
  });

  test("positions and fills of the wallet", async () => {
    await until(() => indexer.trading().holdings.has(`2:${alice}`));
    const wallet = (await call(`/v2/positions/${alice}`)).body;
    const positions = wallet.positions as {
      book: number;
      value: string | null;
      maxPayout: string;
    }[];
    expect(positions.map((p) => p.book).sort()).toEqual([1, 2]);
    for (const p of positions) expect(BigInt(p.maxPayout)).toBeGreaterThan(0n);
    const fills = (await call(`/v2/fills?owner=${alice}`)).body.fills as { maker: Address }[];
    expect(fills.length).toBe(2);
    expect(fills.every((f) => f.maker === worlds.vault)).toBe(true);
  });

  test("a cash-out through the delegate sells part of a position back", async () => {
    const held = (indexer.trading().holdings.get(`2:${alice}`) ?? [])[1]!;
    const { status, body } = await call("/v2/worlds/cashout", {
      order: {
        book: 2,
        mask: 0b10,
        side: "sell",
        units: String(held / 2n),
        refund: "0",
        limit: "1",
      },
      clientId: "client-0002",
    });
    expect([status, body.error]).toEqual([200, undefined]);
    await until(() => (indexer.trading().holdings.get(`2:${alice}`) ?? [])[1] === held - held / 2n);
  });

  test("orders the books cannot fill are refused before any quote", async () => {
    expect(
      (await call("/v2/worlds/quote", { order: { book: 99, mask: 2, side: "buy", stake: "1" } }))
        .status,
    ).toBe(400);
    expect(
      (await call("/v2/worlds/quote", { order: { book: 1, mask: 1, side: "buy", stake: "1" } }))
        .status,
    ).toBe(400);
    const tooMuch = await call("/v2/worlds/quote", {
      order: { book: 2, mask: 0b10, side: "sell", units: "999999999999", refund: "0", limit: "1" },
    });
    expect(tooMuch.status).toBe(400);
  });

  test("finalized fills persist, reconciliation holds, and a restart resumes from the checkpoint", async () => {
    await until(async () => (await db.worldFills(domain, { limit: 10 })).length === 3, 20_000);
    await until(() => indexer.reconciliation?.healthy === true, 20_000);
    expect((await call("/v2/reconciliation")).status).toBe(200);
    await until(async () => Boolean(await db.checkpoint(domain)), 20_000);
    const next = new WorldIndexer({ ...indexer.options });
    await next.start();
    expect(next.follower.restored).toBeDefined();
    expect(next.trading().books.size).toBe(2);
    await next.stop();
  });
});

describe("world administration", () => {
  test("a curated book goes prepare → review → preview → execute → reconcile", async () => {
    const now = Math.floor(Date.now() / 1000);
    const prepared = await call(
      "/v2/admin/books/prepare",
      {
        title: "NVDA if the GPU order",
        legs: [{ source: "polymarket", marketId: "gamma-2", themes: ["ai"] }],
        feed: worlds.feed,
        book: {
          underlying: "US:NVDA",
          fixingTime: String(now + 21 * 86_400),
          maxStaleness: "3600",
          strikes: ["20000000000", "22000000000"],
          cutoff: String(now + 20 * 86_400),
          feeBps: "100",
          fixingRule: "NVDA's close",
        },
      },
      admin,
    );
    expect([prepared.status, prepared.body.status]).toEqual([200, "prepared"]);
    const hash = (prepared.body.envelope as { packetHash: Hex }).packetHash;
    expect(prepared.body.metadataUri).toBe(`http://127.0.0.1:4000/v2/books/packets/${hash}`);
    // Only governance roles prepare, and an approval confirms every check.
    expect((await call("/v2/admin/evidence", undefined, alice)).status).toBe(403);
    expect(
      (
        await call(
          `/v2/admin/evidence/${hash}/review`,
          { decision: "approve", checklist: {} },
          admin,
        )
      ).status,
    ).toBe(409);
    const checklist = Object.fromEntries(
      ["legs-and-orientation", "rules-and-dates", "feed-and-strikes", "fee", "sources"].map((k) => [
        k,
        true,
      ]),
    );
    const reviewed = await call(
      `/v2/admin/evidence/${hash}/review`,
      { decision: "approve", checklist },
      admin,
    );
    expect(reviewed.body.status).toBe("approved");
    const preview = (await call(`/v2/admin/evidence/${hash}/transaction`, {}, admin)).body as {
      to: Address;
      data: Hex;
      from: Address;
      action: string;
    };
    expect([preview.action, preview.from]).toEqual(["create-book", admin]);
    const receipt = await send(node, 0, { to: preview.to, data: preview.data });
    expect(receipt.status).toBe("success");
    const reconciled = await call(
      `/v2/admin/evidence/${hash}/reconcile`,
      { action: "create-book", transactionHash: receipt.transactionHash },
      admin,
    );
    expect(reconciled.status).toBe(200);
    // The leg's odds start streaming.
    expect(tracked).toEqual(["snapshot-gpu"]);
    await until(() => indexer.trading().books.size === 3);
    const book = (await call("/v2/books/3")).body as { title: string; legs: { venue: unknown }[] };
    expect(book.title).toBe("NVDA if the GPU order");
    expect(book.legs[0]!.venue).toMatchObject({ conditionId: CONDITIONS[2]!.toLowerCase() });
    // The metadata URI serves the packet itself.
    const packet = await app.request(`/v2/books/packets/${hash}`);
    expect(((await packet.json()) as { packetHash: Hex }).packetHash).toBe(hash);
    // A second preview is refused: the book exists.
    expect((await call(`/v2/admin/evidence/${hash}/transaction`, {}, admin)).status).toBe(409);
  });

  test("admins state relations and set pricing inputs the fits never replace", async () => {
    const [a, b] = [CONDITIONS[1]!.toLowerCase(), CONDITIONS[2]!.toLowerCase()];
    expect(
      (await call("/v2/admin/pricing/relations", { a, b, kind: "implies" }, alice)).status,
    ).toBe(403);
    const implies = await call(
      "/v2/admin/pricing/relations",
      { a, b, kind: "implies", pBGivenNotA: 0.2, reasoning: "The S-1 names the order" },
      admin,
    );
    expect(implies.status).toBe(200);
    expect((implies.body.relations as unknown[])[0]).toMatchObject({
      a,
      b,
      kind: "implies",
      pBGivenA: 1,
      pBGivenNotA: 0.2,
      source: "admin",
      reviewer: admin.toLowerCase(),
    });
    // A "positive" relation with P(B|A) below P(B|not A) contradicts itself.
    const contradiction = await call(
      "/v2/admin/pricing/relations",
      { a, b, kind: "positive", pBGivenA: 0.1, pBGivenNotA: 0.4 },
      admin,
    );
    expect(contradiction.status).toBe(400);
    expect(
      (await call("/v2/admin/pricing/correlations", { a, b, rho: 0.3, error: 0.1 }, admin)).status,
    ).toBe(200);
    await db.putWorldCorrelations([
      { a, b, rho: 0.05, error: 0.1, samples: 90, method: "lead-lag" },
    ]);
    expect(
      (
        await call(
          "/v2/admin/pricing/gaps",
          { condition: a, underlying: "US:NVDA", gap: 0.04 },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(
      (await call("/v2/admin/pricing/vols", { underlying: "nvda", vol: 0.5 }, admin)).status,
    ).toBe(400);
    const pricing = (await call(`/v2/admin/pricing?conditions=${a},${b}`, undefined, admin)).body;
    expect(pricing.correlations).toMatchObject([{ rho: 0.3, method: "admin" }]);
    expect(pricing.gaps).toMatchObject([{ condition: a, gap: 0.04, error: 0.03, method: "admin" }]);
  });
});
