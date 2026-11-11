/** The world books' `/v2` API end to end, on anvil and PostgreSQL: the world index serves books,
 * positions, vaults and fills from its replica; world orders go out over the RFQ stream (protocol
 * version 2) to the vault's keeper, whose quotes the desk checks and awards; the wallet fills one
 * itself, the trading delegate fills others (journaled, idempotent); finalized fills persist and
 * a restart resumes from the checkpoint. The API's own RPC and database calls are counted: a
 * quote costs none, a delegated fill exactly what a v1 delegated order costs.
 *
 * Requests for quotes: an order stays open 15 minutes, every maker's quote is listed with its
 * own expiry, nothing fills until the wallet chooses one, makers that connect later quote too,
 * the vault gives a request two quotes of its own accord (renewing one that ran out, replacing
 * one the price moved against), and a restart takes open requests up. */
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
  walletQuote,
} from "../../../packages/evm-client/test/worlds-anvil.ts";
import { settings } from "../../../services/world-keeper/src/config.ts";
import { WorldKeeper } from "../../../services/world-keeper/src/engine.ts";
import { emptyData } from "../../../services/world-keeper/src/inputs.ts";
import { LegReferences, SpotReferences } from "../../../services/world-keeper/src/references.ts";
import { WorldRfqMaker } from "../../../services/world-keeper/src/rfq.ts";
import type { Auth } from "../src/auth/routes.ts";
import { RfqHub, type RfqSession } from "../src/rfq/hub.ts";
import { mountWorldAdmin } from "../src/worlds/admin.ts";
import { mountWorldBoard } from "../src/worlds/board.ts";
import { WorldDesk } from "../src/worlds/desk.ts";
import { WorldRfqs } from "../src/worlds/rfqs.ts";
import { mountWorlds } from "../src/worlds/routes.ts";
import { WorldTrading } from "../src/worlds/trading.ts";

let node: Anvil;
let worlds: Worlds;
let pg: Awaited<ReturnType<typeof localDatabase>>;
let db: Database;
let indexer: WorldIndexer;
let keeperFollower: ChainFollower<WorldState, WorldTouched, WorldEvent>;
let maker: WorldRfqMaker;
let keeper: WorldKeeper;
let hub: RfqHub;
let desk: WorldDesk;
let rfqs: WorldRfqs;
let api: { client: PublicClient; db: Database };
let domain: string;
const app = new Hono();
const toMaker: Record<string, unknown>[] = [];
const [, alice, bob] = accounts.map((a) => a.address) as Address[];
/** Each event's YES midpoint as the venue streams it (x 1e6): a test moves one to move prices. */
const YES = [350_000, 150_000, 300_000, 600_000];
/** The keeper's stream session: detaching it is the vault going offline. */
let vaultSession: RfqSession;
/** How far the keeper's clock (and the venue ticks it reads) runs ahead of this one: a test
 * that moves the chain's time forward moves the keeper's with it. */
let keeperSkew = 0;
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
    // A block is final once another follows it, so the tip always applies a block (and tells
    // who listens for its fills) before the finality pass reads it: tests that wait on
    // finalized history mine one more block.
    finalityDepth: 1n,
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
  desk = new WorldDesk({ hub, indexer, chainId: node.chain.id, minQuoteSeconds: 3 });
  indexer.prices = (book) => hub.worldPrices().get(book);
  app.onError((error) =>
    Response.json(
      { error: { message: error.message } },
      { status: error instanceof HTTPException ? error.status : 400 },
    ),
  );
  indexer.mount(app);
  api = { client: counted(client, ""), db: counted(db, "db.") };
  rfqs = new WorldRfqs({
    hub,
    indexer,
    desk,
    db: api.db,
    chainId: node.chain.id,
    delegate: delegate.address,
    minQuoteSeconds: 3,
    rfqSeconds: 900,
    maxOpenPerTaker: 3,
    maxOpen: 100,
  });
  mountWorlds(app, {
    indexer,
    client: api.client,
    auth,
    db: api.db,
    hub,
    desk,
    rfqs,
    trading: new WorldTrading({
      indexer,
      desk,
      db: api.db,
      client: api.client,
      signer: delegate,
      rfqs,
    }),
    signer: delegate,
  });
  mountWorldBoard(app, { indexer, auth, rfqs });
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
        midpointX6: String(YES[i]!),
        bestBidX6: String(YES[i]! - 5_000),
        bestAskX6: String(YES[i]! + 5_000),
        observedAtMs: String(Date.now() + keeperSkew),
      });
    });
  observe();
  // As the keeper's process does every second: refresh the models, then review what stands.
  const ticker = setInterval(() => {
    observe();
    keeper.refresh();
    maker.review();
  }, 250);
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
  keeper = new WorldKeeper({
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
    now: () => Date.now() + keeperSkew,
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
  vaultSession = session;
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
    // The deployment, roles included (their bigints as strings), for the app to check against.
    const deployment = await call("/v2/deployment");
    expect(deployment.status).toBe(200);
    expect(deployment.body.books).toBe(worlds.books);
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
    // An auction fills at once: its request says so, and the vault's quote lives seconds.
    expect(toMaker.findLast((m) => m.type === "world.rfq")).toMatchObject({
      open: false,
      replay: false,
    });
    const life = Number((body.quote as { expiry: string }).expiry) - Date.now() / 1000;
    expect(life).toBeGreaterThan(5);
    expect(life).toBeLessThan(11);
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
    await node.client.mine({ blocks: 1 });
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

// ---------------------------------------------------------------- requests for quotes

type QuoteView = {
  id: string;
  maker: string;
  vault: boolean;
  units: string;
  refund: string;
  price: string;
  fee: string;
  total: string;
  expiry: string;
  problem: string | null;
};
type RfqBody = {
  id: string;
  status: string;
  reason: string | null;
  book: number;
  createdAt: number;
  expiresAt: number;
  closedAt: number | null;
  makers: number;
  received: number;
  quotes: QuoteView[];
  fill: { quote: string; maker: string; units: string; transactionHash: Hex | null } | null;
};
const BET = { book: 2, mask: 0b10, side: "buy", stake: "20000000" };
const ask = async (order: Record<string, unknown> = BET, extra: Record<string, unknown> = {}) => {
  const r = await call("/v2/worlds/rfqs", { order, ...extra });
  if (r.status !== 201) throw new Error(`${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.rfq as RfqBody;
};
const read = async (id: string, as: Address = alice!) =>
  (await call(`/v2/worlds/rfqs/${id}?owner=${as}`, undefined, as)).body.rfq as RfqBody;
const heard = (type: string, rfq: string) =>
  toMaker.filter((m) => m.type === type && (m.rfqId ?? m.id) === rfq);
const position = () => (indexer.trading().holdings.get(`2:${alice}`) ?? [])[1] ?? 0n;

/** A second maker on the stream: account 6's wallet, quoting with its own signature. */
const second = {
  id: "22222222-2222-4222-8222-222222222222",
  label: "Second maker",
  wallet: accounts[6]!.address as Address,
  worlds: true,
};
function secondMaker(on: RfqHub = hub) {
  const got: Record<string, unknown>[] = [];
  const session: RfqSession = {
    maker: second,
    send(message) {
      got.push(message as Record<string, unknown>);
      return true;
    },
    close() {},
  };
  /** Quotes `units` for the stake of the open request it was sent, living `seconds`. */
  const quote = async (frame: Record<string, unknown>, units: bigint, seconds = 120) => {
    const o = frame.order as { taker: Address; mask: number; stake: string };
    const signed = await walletQuote(node, worlds, 6, {
      taker: o.taker,
      book: BigInt((frame.book as { id: string }).id),
      mask: o.mask,
      units,
      refund: 0n,
      sell: false,
      price: BigInt(o.stake),
      expiry: BigInt(Math.floor(Date.now() / 1000) + seconds),
    });
    on.receive(
      session,
      JSON.stringify({
        type: "world.quote",
        rfqId: frame.id,
        units: units.toString(),
        refund: "0",
        price: o.stake,
        expiry: signed.quote.expiry.toString(),
        makerData: "0",
        nonce: signed.quote.nonce.toString(),
        signature: signed.signature,
      }),
    );
  };
  return { session, got, quote, requests: () => got.filter((m) => m.type === "world.rfq") };
}

/** Reads a server-sent event stream until closed. */
async function follow(path: string, as: Address = alice!) {
  const response = await app.request(path, {
    headers: { "x-test-owner": as, authorization: `Bearer ${as}` },
  });
  const events: { event: string; data: Record<string, unknown> }[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
    }
  })().catch(() => {});
  return { status: response.status, events, close: () => reader.cancel().catch(() => {}) };
}

describe("requests for quotes", () => {
  test("an order goes out and stays open: the vault's quote arrives at once, and nothing fills", async () => {
    const before = position();
    const makerFrames = toMaker.length;
    resetCalls();
    const started = performance.now();
    const r = await call("/v2/worlds/rfqs", { order: BET });
    const ms = performance.now() - started;
    expect([r.status, r.body.error]).toEqual([201, undefined]);
    const rfq = r.body.rfq as RfqBody;
    // As fast as an auction: no RPC call and no database read. The request's row is written
    // behind the answer.
    expect(ms).toBeLessThan(200);
    await rfqs.flushed();
    expect(calls).toEqual({ "db.recordWorldRfq": 1 });
    // Open for 15 minutes, with the vault's quote and its own expiry: five minutes.
    expect(rfq.status).toBe("open");
    expect(rfq.expiresAt - rfq.createdAt).toBe(900_000);
    expect([rfq.makers, rfq.received, rfq.fill]).toEqual([1, 1, null]);
    expect(rfq.quotes).toHaveLength(1);
    const q = rfq.quotes[0]!;
    expect([q.maker, q.vault, q.problem]).toEqual(["World vault", true, null]);
    // What the app needs to count down by this API's clock, and to tell a maker's later quote
    // from another maker's.
    expect(Math.abs((rfq as RfqBody & { now: number }).now - Date.now())).toBeLessThan(5_000);
    expect((q as QuoteView & { makerId: string }).makerId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    const life = Number(q.expiry) - Date.now() / 1000;
    expect(life).toBeGreaterThan(290);
    expect(life).toBeLessThanOrEqual(300);
    // A stake is quoted at the stake: the fee on top, and the units the maker gives for it.
    expect([q.price, q.fee, q.total]).toEqual(["20000000", "100000", "20100000"]);
    expect(BigInt(q.units)).toBeGreaterThan(20_000_000n);
    // The maker was told the request is open and until when.
    const frame = toMaker.slice(makerFrames).find((m) => m.type === "world.rfq")!;
    expect(frame).toMatchObject({
      id: rfq.id,
      open: true,
      replay: false,
      quoteDeadline: rfq.expiresAt,
    });
    // Nothing filled, and no maker was told an outcome: the wallet has not chosen.
    await Bun.sleep(300);
    expect(position()).toBe(before);
    expect(heard("world.result", rfq.id)).toEqual([]);
    expect((await call(`/v2/fills?owner=${alice}`)).body.fills).toHaveLength(3);
    // The wallet reads it again from memory; nobody else can.
    resetCalls();
    expect(await read(rfq.id)).toMatchObject({
      id: rfq.id,
      status: "open",
      quotes: [{ id: q.id }],
    });
    const list = (await call(`/v2/worlds/rfqs?owner=${alice}`)).body.rfqs as RfqBody[];
    expect(list.map((x) => x.id)).toEqual([rfq.id]);
    expect(calls).toEqual({});
    expect((await call(`/v2/worlds/rfqs/${rfq.id}?owner=${bob}`, undefined, bob)).status).toBe(404);
    expect((await call(`/v2/worlds/rfqs?owner=${bob}`, undefined, bob)).body.rfqs).toEqual([]);
    expect((await call("/v2/worlds/status")).body).toMatchObject({ rfqSeconds: 900, makers: 1 });
    expect((await db.worldRfq(domain, rfq.id))?.status).toBe("open");
    expect((await call(`/v2/worlds/rfqs/${rfq.id}/cancel`, {})).status).toBe(200);
  });

  test("the wallet fills the quote it chose; the request closes, its maker hears, a retry sends nothing", async () => {
    const before = position();
    const rfq = await ask();
    const q = rfq.quotes[0]!;
    await rfqs.flushed();
    resetCalls();
    const filled = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: q.id,
      clientId: "client-rfq-1",
    });
    expect([filled.status, filled.body.error]).toEqual([200, undefined]);
    await rfqs.flushed();
    // What a delegated fill costs, plus the request's own two writes: the chosen quote in the
    // journal's transaction, and the close behind the answer.
    expect(calls).toEqual({
      "db.worldSubmission": 1,
      "db.locked": 1,
      "db.q.worldSubmission": 1,
      "db.q.worldSubmissionCount": 1,
      "db.q.recordWorldSubmission": 1,
      "db.q.journalWorldRfqFill": 1,
      "db.closeWorldRfq": 1,
      call: 1,
      prepareTransactionRequest: 1,
      sendRawTransaction: 1,
      getTransactionReceipt: 1,
    });
    const hash = filled.body.transactionHash as Hex;
    expect((await node.client.getTransactionReceipt({ hash })).status).toBe("success");
    expect(filled.body.rfq).toMatchObject({
      id: rfq.id,
      status: "filled",
      quotes: [],
      fill: { quote: q.id, maker: "World vault", units: q.units, transactionHash: hash },
    });
    // The wallet holds exactly the units the quote gave.
    expect(position() - before).toBe(BigInt(q.units));
    // Its maker hears it filled, and every maker that the request closed.
    await until(() => heard("world.result", rfq.id).length === 1);
    expect(heard("world.result", rfq.id)[0]).toMatchObject({
      outcome: "filled",
      transaction: hash,
      units: q.units,
    });
    expect(heard("world.closed", rfq.id)).toEqual([
      { type: "world.closed", rfqId: rfq.id, reason: "filled" },
    ]);
    // A retry of the same request sends nothing: the journal, then the receipt.
    resetCalls();
    const again = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: q.id,
      clientId: "client-rfq-1",
    });
    expect(again.body.transactionHash).toBe(hash);
    expect(calls).toEqual({
      "db.worldSubmission": 1,
      "db.locked": 1,
      "db.q.worldSubmission": 1,
      getTransactionReceipt: 1,
    });
    // A filled request takes no other choice, and cannot be cancelled.
    const other = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: q.id,
      clientId: "client-rfq-2",
    });
    expect([other.status, (other.body.error as { message: string }).message]).toEqual([
      409,
      "This request is filled",
    ]);
    expect((await call(`/v2/worlds/rfqs/${rfq.id}/cancel`, {})).status).toBe(409);
    expect(await db.worldRfq(domain, rfq.id)).toMatchObject({
      status: "filled",
      quotes: 1,
      fill: { makerLabel: "World vault", units: BigInt(q.units), tx: hash },
    });
    expect((await read(rfq.id)).status).toBe("filled");
  });

  test("a cash-out is asked the same way: the vault bids, and the chosen bid fills", async () => {
    const held = position();
    const rfq = await ask({
      book: 2,
      mask: 0b10,
      side: "sell",
      units: String(held / 4n),
      refund: "0",
      limit: "1",
    });
    const q = rfq.quotes[0]!;
    // A bid: the wallet receives the price less the fee.
    expect(BigInt(q.total)).toBe(BigInt(q.price) - BigInt(q.fee));
    expect(q.units).toBe(String(held / 4n));
    const credit = BigInt(
      (await call(`/v2/worlds/permission?owner=${alice}`)).body.credit as string,
    );
    const filled = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: q.id,
      clientId: "client-rfq-sell",
    });
    expect([filled.status, filled.body.error]).toEqual([200, undefined]);
    expect(position()).toBe(held - held / 4n);
    const after = BigInt(
      (await call(`/v2/worlds/permission?owner=${alice}`)).body.credit as string,
    );
    expect(after - credit).toBe(BigInt(q.total));
  });

  test("a cancelled request tells its maker; a new request can replace an old one", async () => {
    const rfq = await ask();
    const cancelled = await call(`/v2/worlds/rfqs/${rfq.id}/cancel`, {});
    expect(cancelled.body.rfq).toMatchObject({
      status: "cancelled",
      reason: "Cancelled by its owner",
      quotes: [],
    });
    await until(() => heard("world.result", rfq.id).length === 1);
    expect(heard("world.result", rfq.id)[0]).toMatchObject({
      outcome: "unfilled",
      transaction: null,
      reason: "Cancelled by its owner",
    });
    expect(heard("world.closed", rfq.id)[0]).toMatchObject({ reason: "cancelled" });
    // Its quote can no longer be filled, and only its owner could cancel it.
    const late = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: rfq.quotes[0]!.id,
      clientId: "client-rfq-3",
    });
    expect([late.status, (late.body.error as { message: string }).message]).toEqual([
      409,
      "This request is cancelled",
    ]);
    const first = await ask();
    expect((await call(`/v2/worlds/rfqs/${first.id}/cancel`, {}, bob)).status).toBe(404);
    const next = await ask(BET, { replaces: first.id });
    expect(await read(first.id)).toMatchObject({
      status: "cancelled",
      reason: "Replaced by a new request",
    });
    expect((await call(`/v2/worlds/rfqs?owner=${alice}`)).body.rfqs).toMatchObject([
      { id: next.id, status: "open" },
    ]);
    await rfqs.flushed();
    expect((await db.worldRfq(domain, rfq.id))?.status).toBe("cancelled");
    // The wallet's history, newest first: open and closed requests together.
    const history = (await call(`/v2/worlds/rfqs?owner=${alice}&history=1`)).body.rfqs as RfqBody[];
    expect(history.slice(0, 3).map((x) => [x.id, x.status])).toEqual([
      [next.id, "open"],
      [first.id, "cancelled"],
      [rfq.id, "cancelled"],
    ]);
    expect(history.filter((x) => x.status === "filled")).toHaveLength(2);
    await call(`/v2/worlds/rfqs/${next.id}/cancel`, {});
  });

  test("a declined quote leaves the request and frees its maker; asked again, the maker quotes", async () => {
    const held = keeper.risk.outstanding.size;
    const rfq = await ask();
    const q = rfq.quotes[0]!;
    expect(keeper.risk.outstanding.size).toBe(held + 1);
    const declined = await call(`/v2/worlds/rfqs/${rfq.id}/decline`, { quote: q.id });
    expect([declined.status, declined.body.error]).toEqual([200, undefined]);
    expect(declined.body.rfq).toMatchObject({ status: "open", quotes: [], received: 1 });
    // Its maker hears at once and holds nothing for the quote any more; the request goes on.
    await until(() => heard("world.declined", rfq.id).length === 1);
    await until(() => keeper.risk.outstanding.size === held);
    expect(heard("world.result", rfq.id)).toEqual([]);
    expect(heard("world.closed", rfq.id)).toEqual([]);
    // The declined quote cannot be filled, and declining it again changes nothing.
    const gone = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: q.id,
      clientId: "client-rfq-d1",
    });
    expect(gone.status).toBe(409);
    expect((await call(`/v2/worlds/rfqs/${rfq.id}/decline`, { quote: q.id })).status).toBe(200);
    expect(heard("world.declined", rfq.id)).toHaveLength(1);
    // The vault does not quote again of its own accord, only when the wallet asks again.
    await Bun.sleep(700);
    expect((await read(rfq.id)).quotes).toEqual([]);
    const asked = (await call(`/v2/worlds/rfqs/${rfq.id}/requote`, {})).body.rfq as RfqBody;
    expect(asked.quotes).toHaveLength(1);
    expect(asked.quotes[0]!.id).not.toBe(q.id);
    // Only the request's owner declines, and only with a quote's id.
    expect(
      (await call(`/v2/worlds/rfqs/${rfq.id}/decline`, { quote: asked.quotes[0]!.id }, bob)).status,
    ).toBe(404);
    expect((await call(`/v2/worlds/rfqs/${rfq.id}/decline`, { quote: "x" })).status).toBe(400);
    expect((await read(rfq.id)).quotes).toHaveLength(1);
    await call(`/v2/worlds/rfqs/${rfq.id}/cancel`, {});
  });

  test("orders that cannot fill are refused before any maker hears; a wallet's open requests are capped", async () => {
    const frames = toMaker.length;
    const refuse = async (order: Record<string, unknown>, as: Address = alice!) => {
      const r = await call("/v2/worlds/rfqs", { order }, as);
      return [r.status, (r.body.error as { message: string }).message];
    };
    expect(await refuse({ ...BET, book: 99 })).toEqual([400, "Unknown book"]);
    expect(await refuse({ ...BET, mask: 1 })).toEqual([
      400,
      "Atom 0 is the refund, not part of the mask",
    ]);
    expect(await refuse({ ...BET, stake: "999999999999999" })).toEqual([
      400,
      "Deposit enough to cover the stake and its fee",
    ]);
    // A chosen quote is filled through the wallet's grant: without one nothing is asked.
    expect(await refuse(BET, bob)).toEqual([400, "Approve trading for this wallet first"]);
    expect(toMaker.slice(frames).filter((m) => m.type === "world.rfq")).toEqual([]);
    expect((await call("/v2/worlds/rfqs/not-an-id/cancel", {})).status).toBe(400);
    expect((await call("/v2/worlds/rfqs", { order: BET, replaces: "nope" })).status).toBe(400);
    const open = [await ask(), await ask(), await ask()];
    expect(await refuse(BET)).toEqual([
      429,
      "You have 3 requests open. Cancel one before asking again.",
    ]);
    // Replacing one of them makes room.
    const fourth = await ask(BET, { replaces: open[0]!.id });
    for (const r of [open[1]!, open[2]!, fourth]) await call(`/v2/worlds/rfqs/${r.id}/cancel`, {});
    expect((await call(`/v2/worlds/rfqs?owner=${alice}`)).body.rfqs).toEqual([]);
  });

  test("a maker that connects later is sent the open request; the wallet chooses among the makers' quotes", async () => {
    const rfq = await ask();
    const vaultQuoteView = rfq.quotes[0]!;
    const stream = await follow(`/v2/worlds/rfqs/stream?owner=${alice}`);
    expect(stream.status).toBe(200);
    await until(() => stream.events.length === 1);
    expect(stream.events[0]).toMatchObject({ event: "rfqs", data: { rfqs: [{ id: rfq.id }] } });
    // A second maker comes online ten seconds... or twenty minutes later: it is sent the
    // request, marked as sent again, and the vault (which already quotes it) is not asked twice.
    const vaultFrames = heard("world.rfq", rfq.id).length;
    const m = secondMaker();
    hub.attach(m.session);
    await until(() => m.requests().length === 1);
    expect(m.requests()[0]).toMatchObject({ id: rfq.id, open: true, replay: true });
    expect(heard("world.rfq", rfq.id)).toHaveLength(vaultFrames);
    // It quotes fewer units than the vault first: both stand, the better one first.
    const fewer = BigInt(vaultQuoteView.units) - 1_000_000n;
    await m.quote(m.requests()[0]!, fewer, 90);
    await until(async () => (await read(rfq.id)).quotes.length === 2);
    let now = await read(rfq.id);
    expect(now.quotes.map((x) => [x.maker, x.vault, x.units])).toEqual([
      ["World vault", true, vaultQuoteView.units],
      ["Second maker", false, fewer.toString()],
    ]);
    // Each quote carries its own maker's expiry.
    const life = (x: QuoteView) => Number(x.expiry) - Date.now() / 1000;
    expect(life(now.quotes[0]!)).toBeGreaterThan(280);
    expect(life(now.quotes[1]!)).toBeLessThan(91);
    expect(now.received).toBe(2);
    // It improves its quote: the later one replaces the earlier, and now leads.
    const more = BigInt(vaultQuoteView.units) + 2_000_000n;
    await m.quote(m.requests()[0]!, more, 90);
    await until(async () => (await read(rfq.id)).quotes[0]!.maker === "Second maker");
    now = await read(rfq.id);
    expect(now.quotes.map((x) => [x.maker, x.units])).toEqual([
      ["Second maker", more.toString()],
      ["World vault", vaultQuoteView.units],
    ]);
    // The wallet followed all of it on its stream, with nothing filled.
    await until(() => stream.events.filter((e) => e.event === "rfq").length >= 2);
    const seen = stream.events.filter((e) => e.event === "rfq").map((e) => e.data.rfq as RfqBody);
    expect(seen.at(-1)!.quotes.map((x) => x.maker)).toEqual(["Second maker", "World vault"]);
    expect(seen.every((x) => x.status === "open")).toBe(true);
    // Offline, the second maker's quote goes with it; back online it is asked again.
    hub.detach(m.session);
    expect((await read(rfq.id)).quotes.map((x) => x.maker)).toEqual(["World vault"]);
    hub.attach(m.session);
    await until(() => m.requests().length === 2);
    await m.quote(m.requests()[1]!, more, 90);
    await until(async () => (await read(rfq.id)).quotes.length === 2);
    // The wallet takes the second maker's quote, not the vault's.
    const before = position();
    const mine = (await read(rfq.id)).quotes.find((x) => x.maker === "Second maker")!;
    const filled = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: mine.id,
      clientId: "client-rfq-4",
    });
    expect([filled.status, filled.body.error]).toEqual([200, undefined]);
    expect(position() - before).toBe(more);
    // The fill is the second maker's (the fills list can trail the replica by a moment).
    const newest = async () =>
      (
        (await call(`/v2/fills?owner=${alice}&limit=1`)).body.fills as {
          maker: Address;
          transactionHash: Hex;
        }[]
      )[0]!;
    await until(async () => (await newest()).transactionHash === filled.body.transactionHash);
    expect((await newest()).maker).toBe(second.wallet);
    // The chosen maker hears it filled; the vault that its quote lost.
    expect(m.got.filter((x) => x.type === "world.result")).toMatchObject([
      { rfqId: rfq.id, outcome: "filled", transaction: filled.body.transactionHash },
    ]);
    await until(() => heard("world.result", rfq.id).length === 1);
    expect(heard("world.result", rfq.id)[0]).toMatchObject({
      outcome: "lost",
      reason: "The taker chose another quote",
    });
    await until(() => stream.events.some((e) => (e.data.rfq as RfqBody)?.status === "filled"));
    await stream.close();
    hub.detach(m.session);
    expect(hub.status(second.id)).toMatchObject({ awards: 1, quotes: 3 });
  });

  test("the board is public: any wallet quotes an open order, and the taker fills the quote it chooses", async () => {
    // Someone watches the board, without a session, before the order exists.
    const stream = await follow("/v2/worlds/board/stream", bob!);
    await until(() => stream.events.length === 1);
    expect(stream.events[0]!.event).toBe("board");
    const sentBooks = (stream.events[0]!.data.books as { id: number }[]).map((b) => b.id);
    const heard: number[] = [];
    const unwatch = rfqs.watch((r) => heard.push(r.quotes.size));
    const rfq = await ask();
    unwatch();
    // The board hears of an order as it opens, before any quote on it.
    expect(heard[0]).toBe(0);
    const vaultUnits = BigInt(rfq.quotes[0]!.units);
    type PublicQuote = {
      id?: string;
      maker: string;
      wallet: Address | null;
      vault: boolean;
      units: string;
      fills: boolean;
    };
    type PublicRfq = {
      id: string;
      status: string;
      taker: Address;
      book: number;
      order: { stake: string; side: string };
      quotes: PublicQuote[];
      fill: { wallet: Address | null; units: string; transactionHash: Hex } | null;
    };
    // Without a session: the order, who asks, its world and the vault's quote. A quote's id is
    // its taker's to choose with, and stays out.
    const open = await app.request("/v2/worlds/board");
    expect(open.status).toBe(200);
    const board = (await open.json()) as { rfqs: PublicRfq[]; books: { id: number }[] };
    const listed = board.rfqs.find((r) => r.id === rfq.id)!;
    expect(listed).toMatchObject({
      status: "open",
      taker: alice,
      book: 2,
      order: { side: "buy", stake: "20000000" },
      quotes: [{ maker: "World vault", vault: true, wallet: null, fills: true }],
    });
    expect(listed.quotes[0]!.id).toBeUndefined();
    expect(board.books.map((b) => b.id)).toContain(2);
    // The watcher was sent the order, and its world unless it had been sent that already.
    const frames = () =>
      stream.events.filter((e) => e.event === "rfq" && (e.data.rfq as PublicRfq).id === rfq.id);
    await until(() => frames().length > 0);
    expect(Boolean(frames()[0]!.data.book)).toBe(!sentBooks.includes(2));
    expect(frames().filter((e) => e.data.book)).toHaveLength(sentBooks.includes(2) ? 0 : 1);

    /** Account `index` signs `units` for the order's stake; `as` posts it. */
    const why = (r: { body: Record<string, unknown> }) =>
      (r.body.error as { message: string } | undefined)?.message;
    const offer = async (
      units: bigint,
      options: { index?: number; as?: Address; seconds?: number } = {},
    ) => {
      const index = options.index ?? 2;
      const signed = await walletQuote(node, worlds, index, {
        taker: alice!,
        book: 2n,
        mask: 0b10,
        units,
        refund: 0n,
        sell: false,
        price: 20_000_000n,
        expiry: BigInt(Math.floor(Date.now() / 1000) + (options.seconds ?? 120)),
      });
      return call(
        `/v2/worlds/board/${rfq.id}/quote`,
        {
          units: units.toString(),
          refund: "0",
          price: "20000000",
          expiry: signed.quote.expiry.toString(),
          nonce: signed.quote.nonce.toString(),
          signature: signed.signature,
        },
        options.as ?? (accounts[index]!.address as Address),
      );
    };
    // Refused, each for its own reason: the taker's own order, a signature of another wallet,
    // a payout the wallet's credit cannot back, and a quote that outlives the order.
    const rpc = calls["rpc.call"] ?? 0;
    expect(why(await offer(vaultUnits, { index: 1 }))).toBe("This is your own order");
    expect(why(await offer(vaultUnits, { index: 6, as: bob! }))).toBe(
      "The signature is not this wallet's. Sign with the wallet you are signed in with.",
    );
    expect(why(await offer(10n ** 18n))).toBe(
      "Your world balance does not cover this quote. Deposit more, or offer less.",
    );
    expect(why(await offer(vaultUnits, { seconds: 3_600 }))).toBe(
      "A quote lasts no longer than its order",
    );
    expect((await read(rfq.id)).quotes).toHaveLength(1);

    // Bob offers more than the vault: his quote stands beside it and leads.
    const more = vaultUnits + 3_000_000n;
    const placed = await offer(more);
    expect([placed.status, why(placed)]).toEqual([201, undefined]);
    expect((placed.body.rfq as PublicRfq).quotes).toMatchObject([
      { wallet: bob, vault: false, units: more.toString(), fills: true },
      { maker: "World vault", vault: true },
    ]);
    // Checking and standing a quote reads no chain.
    expect(calls["rpc.call"] ?? 0).toBe(rpc);
    const taker = await read(rfq.id);
    expect(taker.quotes.map((x) => [x.vault, x.units])).toEqual([
      [false, more.toString()],
      [true, vaultUnits.toString()],
    ]);
    expect(taker.quotes[0]!.maker).toBe(`${bob!.slice(0, 6)}…${bob!.slice(-4)}`);
    await until(() => (frames().at(-1)!.data.rfq as PublicRfq).quotes.length === 2);
    // A later quote of his replaces the earlier; taking it back leaves the vault's alone.
    await offer(more + 1_000_000n);
    expect((await read(rfq.id)).quotes).toHaveLength(2);
    const back = await call(`/v2/worlds/board/${rfq.id}/withdraw`, {}, bob!);
    expect((back.body.rfq as PublicRfq).quotes.map((x) => x.vault)).toEqual([true]);
    // Only a wallet's own quote is its to take back.
    expect(
      (
        (await call(`/v2/worlds/board/${rfq.id}/withdraw`, {}, accounts[6]!.address as Address))
          .body.rfq as PublicRfq
      ).quotes,
    ).toHaveLength(1);
    await offer(more);

    // The taker accepts Bob's quote: it fills from Bob's credit, and Bob holds the other side.
    const before = position();
    const held = () => (indexer.trading().holdings.get(`2:${bob}`) ?? [])[0] ?? 0n;
    const bobBefore = held();
    const mine = (await read(rfq.id)).quotes.find((x) => !x.vault)!;
    const filled = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: mine.id,
      clientId: "client-board-1",
    });
    expect([filled.status, filled.body.error]).toEqual([200, undefined]);
    expect(position() - before).toBe(more);
    expect(held() - bobBefore).toBe(more);
    // Everyone watching the board sees the order filled and by whom, and the trade.
    const last = () =>
      stream.events
        .filter((e) => e.event === "rfq" && (e.data.rfq as PublicRfq).id === rfq.id)
        .at(-1)?.data.rfq as PublicRfq | undefined;
    await until(() => last()?.status === "filled");
    expect(last()!.fill).toMatchObject({
      wallet: bob,
      units: more.toString(),
      transactionHash: filled.body.transactionHash,
    });
    await until(() => stream.events.some((e) => e.event === "trade"));
    const traded = stream.events.find((e) => e.event === "trade")!.data;
    expect(traded).toMatchObject({
      trade: {
        transactionHash: filled.body.transactionHash,
        maker: bob,
        taker: alice,
        vault: false,
      },
    });
    // Its world was sent to this watcher once already.
    expect(traded.book).toBeUndefined();
    await stream.close();
    // A closed order takes no quote.
    expect(why(await offer(more))).toBe("This order is no longer open");
    expect(
      ((await (await app.request("/v2/worlds/board")).json()) as { rfqs: PublicRfq[] }).rfqs.some(
        (r) => r.id === rfq.id,
      ),
    ).toBe(false);

    // Every trade, newest first, a page at a time, with its world.
    type Trade = {
      transactionHash: Hex;
      block: string;
      logIndex: number;
      maker: Address;
      vault: boolean;
    };
    const page = async (query: string) =>
      (await (await app.request(`/v2/worlds/trades?${query}`)).json()) as {
        trades: Trade[];
        books: { id: number }[];
        next: string | null;
      };
    await until(
      async () =>
        (await page("limit=1")).trades[0]?.transactionHash === filled.body.transactionHash,
    );
    const first = await page("limit=2");
    expect(first.trades).toHaveLength(2);
    expect(first.trades[0]).toMatchObject({ maker: bob, vault: false });
    expect(first.trades[1]!.vault || first.trades[1]!.maker === second.wallet).toBe(true);
    expect(first.books.length).toBeGreaterThan(0);
    expect(first.next).toBe(`${first.trades[1]!.block}:${first.trades[1]!.logIndex}`);
    const all = await page("limit=100");
    const rest = await page(`limit=100&before=${first.next}`);
    expect(rest.trades.map((t) => t.transactionHash)).toEqual(
      all.trades.slice(2).map((t) => t.transactionHash),
    );
    expect(rest.next).toBeNull();
    const keys = all.trades.map((t) => BigInt(t.block) * 100_000n + BigInt(t.logIndex));
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    expect((await app.request("/v2/worlds/trades?before=x")).status).toBe(400);
  });

  test("the vault replaces a quote the price moved against once; after that it waits to be asked", async () => {
    const rfq = await ask();
    const old = rfq.quotes[0]!;
    // The event gets much likelier on its venue: the bet is worth more than the vault quoted.
    YES[3] = 800_000;
    try {
      await until(async () => {
        const q = (await read(rfq.id)).quotes;
        return q.length === 1 && q[0]!.id !== old.id;
      });
      const now = await read(rfq.id);
      expect(now.status).toBe("open");
      // The vault quoted again by itself, and the same stake buys fewer units at the new price.
      expect(heard("world.rfq", rfq.id)).toHaveLength(1);
      expect(now.received).toBe(2);
      expect(BigInt(now.quotes[0]!.units)).toBeLessThan((BigInt(old.units) * 9n) / 10n);
      expect(now.quotes[0]!.problem).toBeNull();
      // The replaced quote cannot be filled any more.
      const gone = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
        quote: old.id,
        clientId: "client-rfq-5",
      });
      expect([gone.status, (gone.body.error as { message: string }).message]).toEqual([
        409,
        "This quote is no longer available. Choose another, or ask again.",
      ]);
      // It moves against the vault again. That was the vault's second quote on this request:
      // it withdraws it and gives no third of its own accord.
      YES[3] = 930_000;
      await until(async () => (await read(rfq.id)).quotes.length === 0);
      await Bun.sleep(800);
      expect(await read(rfq.id)).toMatchObject({ status: "open", quotes: [], received: 2 });
      expect(heard("world.rfq", rfq.id)).toHaveLength(1);
    } finally {
      YES[3] = 600_000;
    }
    // The wallet asks again: the vault answers, at today's price.
    await Bun.sleep(600);
    const asked = (await call(`/v2/worlds/rfqs/${rfq.id}/requote`, {})).body.rfq as RfqBody;
    expect(asked.quotes).toMatchObject([{ maker: "World vault", problem: null }]);
    expect(asked.received).toBe(3);
    expect(heard("world.rfq", rfq.id).map((m) => m.replay)).toEqual([false, true]);
    // A move the wallet's way leaves a quote as it is, and asking again changes nothing while
    // it fills.
    const same = (await call(`/v2/worlds/rfqs/${rfq.id}/requote`, {})).body.rfq as RfqBody;
    expect(same.quotes.map((q) => q.id)).toEqual([asked.quotes[0]!.id]);
    expect(heard("world.rfq", rfq.id)).toHaveLength(2);
    // The vault offline takes its quote with it; the request stays open for when it returns.
    hub.detach(vaultSession);
    expect(await read(rfq.id)).toMatchObject({ status: "open", makers: 0, quotes: [] });
    hub.attach(vaultSession);
    await until(async () => (await read(rfq.id)).quotes.length === 1);
    expect(heard("world.rfq", rfq.id)).toHaveLength(3);
    await call(`/v2/worlds/rfqs/${rfq.id}/cancel`, {});
  });

  test("a quote that stops filling says why and is refused; asked again, the request fills", async () => {
    const rfq = await ask();
    const q = rfq.quotes[0]!;
    // The vault voids its outstanding quotes on chain (a keeper rotation).
    await send(node, 4, worlds.v.advanceQuoteEpoch());
    await until(async () => (await read(rfq.id)).quotes[0]?.problem != null);
    expect((await read(rfq.id)).quotes[0]).toMatchObject({
      id: q.id,
      problem: "QuoteEpoch: a stale quote epoch",
    });
    await rfqs.flushed();
    resetCalls();
    const refused = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: q.id,
      clientId: "client-rfq-7",
    });
    expect([refused.status, (refused.body.error as { message: string }).message]).toEqual([
      409,
      "QuoteEpoch: a stale quote epoch",
    ]);
    // Refused on the replica: the journal was read, nothing was simulated or sent.
    expect(calls).toEqual({ "db.worldSubmission": 1 });
    expect(await read(rfq.id)).toMatchObject({ status: "open", fill: null });
    // Asked again, the dead quote gives way to a fresh one, which fills. The same client id
    // may be used again: nothing was journaled under it.
    await until(() => keeperFollower.confirmed.vaults.get(worlds.vault)?.quoteEpoch === 1n);
    const again = (await call(`/v2/worlds/rfqs/${rfq.id}/requote`, {})).body.rfq as RfqBody;
    expect(again.quotes).toMatchObject([{ maker: "World vault", problem: null }]);
    expect(again.quotes[0]!.id).not.toBe(q.id);
    const filled = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: again.quotes[0]!.id,
      clientId: "client-rfq-7",
    });
    expect([filled.status, filled.body.error]).toEqual([200, undefined]);
    expect((filled.body.rfq as RfqBody).status).toBe("filled");
  });

  test("a request the vault cannot price yet is quoted as soon as it can, without being asked again", async () => {
    // The event's venue price leaves the range the vault quotes: its model of the book goes
    // (as it has none just after the keeper starts, when the API sends it every open request).
    YES[3] = 15_000;
    try {
      await until(() => !keeper.model(2));
      const rfq = await ask();
      expect(rfq.quotes).toEqual([]);
      expect(maker.waitingRequests).toBe(1);
      YES[3] = 600_000;
      await until(async () => (await read(rfq.id)).quotes.length === 1);
      // The vault answered by itself: the request went out once.
      expect(heard("world.rfq", rfq.id)).toHaveLength(1);
      expect(maker.waitingRequests).toBe(0);
      // A quote withdrawn because the vault lost sight of the book comes back the same way.
      YES[3] = 15_000;
      await until(async () => (await read(rfq.id)).quotes.length === 0);
      expect(maker.waitingRequests).toBe(1);
      YES[3] = 600_000;
      await until(async () => (await read(rfq.id)).quotes.length === 1);
      expect((await read(rfq.id)).received).toBe(2);
      // A request that ended is no longer waited on.
      YES[3] = 15_000;
      await until(async () => (await read(rfq.id)).quotes.length === 0);
      await call(`/v2/worlds/rfqs/${rfq.id}/cancel`, {});
      await until(() => maker.waitingRequests === 0);
    } finally {
      YES[3] = 600_000;
      await until(() => Boolean(keeper.model(2)));
    }
  });

  test("a request with no maker online stays open, and one nobody chooses runs out", async () => {
    hub.detach(vaultSession);
    try {
      let clock = Date.now();
      const short = new WorldRfqs({
        ...rfqs.options,
        db,
        rfqSeconds: 120,
        now: () => clock,
      });
      const started = performance.now();
      const order = {
        taker: alice!,
        book: 2,
        mask: 0b10,
        side: "buy" as const,
        units: null,
        refund: 0n,
        stake: 20_000_000n,
        conditional: false,
        limit: 0n,
      };
      const rfq = await short.open(order);
      // Nobody to wait for: it opens at once, with no quote yet.
      expect(performance.now() - started).toBeLessThan(50);
      expect(short.view(rfq)).toMatchObject({ status: "open", makers: 0, quotes: [] });
      // The vault comes online a minute later and quotes it.
      clock += 60_000;
      const frames = toMaker.length;
      hub.attach(vaultSession);
      await until(() => rfq.quotes.size === 1);
      expect(toMaker.slice(frames).find((m) => m.type === "world.rfq")).toMatchObject({
        id: rfq.id,
        replay: true,
      });
      short.tick();
      expect(rfq.status).toBe("open");
      // Two minutes after it was asked, nobody chose: it runs out, and the maker hears.
      clock += 61_000;
      short.tick();
      expect(short.view(rfq)).toMatchObject({
        status: "expired",
        reason: "The request ran out before a quote was chosen",
        quotes: [],
      });
      await until(() => heard("world.result", rfq.id).length === 1);
      expect(heard("world.result", rfq.id)[0]).toMatchObject({ outcome: "unfilled" });
      expect(heard("world.closed", rfq.id)[0]).toMatchObject({ reason: "expired" });
      await short.stop();
      expect(await db.worldRfq(domain, rfq.id)).toMatchObject({ status: "expired", quotes: 1 });
    } finally {
      if (!hub.makers(undefined, "world")) hub.attach(vaultSession);
    }
  });

  test("a restart takes up the open requests: makers quote them again, and a fill in flight is settled", async () => {
    const open = await ask();
    const filled = await ask();
    const done = await call(`/v2/worlds/rfqs/${filled.id}/execute`, {
      quote: filled.quotes[0]!.id,
      clientId: "client-rfq-6",
    });
    const hash = done.body.transactionHash as Hex;
    await rfqs.flushed();
    // As a crash between the fill and its close would leave it: open, its fill journaled.
    const pool = (await import("@conditional-stocks/db/testing")).Pool;
    const raw = new pool({ connectionString: pg.connectionString, max: 1 });
    await raw.query(
      "UPDATE probabl.world_rfqs SET status = 'open', closed_at = NULL WHERE id = $1",
      [filled.id],
    );
    // One that ran out while the API was down, and one whose fill never reached the chain.
    const order = {
      taker: alice!,
      book: 2,
      mask: 0b10,
      sell: false,
      conditional: false,
      units: null,
      refund: 0n,
      stake: 20_000_000n,
      worst: 0n,
    };
    const [late, lost] = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ];
    await db.recordWorldRfq(domain, {
      ...order,
      id: late,
      createdAt: new Date(Date.now() - 3_600_000),
      expiresAt: new Date(Date.now() - 1_800_000),
    });
    await db.recordWorldRfq(domain, {
      ...order,
      id: lost,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000),
    });
    await db.journalWorldRfqFill(domain, lost, {
      maker: second.id,
      makerLabel: "Second maker",
      units: 1n,
      refund: 0n,
      price: 20_000_000n,
      tx: `0x${"ab".repeat(32)}`,
    });
    await raw.end();
    // The next process: its own stream hub, desk and requests, on the same database.
    const hub2 = new RfqHub({ ...hub.options });
    const desk2 = new WorldDesk({ hub: hub2, indexer, chainId: node.chain.id, minQuoteSeconds: 3 });
    const next = new WorldRfqs({ ...rfqs.options, hub: hub2, desk: desk2, db });
    resetCalls();
    expect(await next.restore(api.client)).toBe(2);
    // One read of the open requests, and one receipt for each fill that was in flight.
    expect(calls).toEqual({ getTransactionReceipt: 2 });
    await next.flushed();
    expect(next.get(alice!, open.id)).toMatchObject({ status: "open" });
    expect(next.view(next.get(alice!, open.id)!)).toMatchObject({ quotes: [], makers: 0 });
    expect(await db.worldRfq(domain, filled.id)).toMatchObject({
      status: "filled",
      fill: { tx: hash },
    });
    expect((await db.worldRfq(domain, late))?.status).toBe("expired");
    // A fill that may still land holds its request: it takes no other choice meanwhile.
    expect(next.view(next.get(alice!, lost)!)).toMatchObject({
      status: "open",
      fill: { maker: "Second maker" },
    });
    expect(() => next.cancel(alice!, lost)).toThrow("A fill of this request is in flight");
    // A maker reconnecting to the new process is sent the open requests and quotes one.
    const m = secondMaker(hub2);
    hub2.attach(m.session);
    await until(() => m.requests().length === 2);
    expect(
      m
        .requests()
        .map((r) => r.id)
        .sort(),
    ).toEqual([open.id, lost].sort());
    const frame = m.requests().find((r) => r.id === open.id)!;
    expect(frame).toMatchObject({ open: true, replay: true });
    await m.quote(frame, 30_000_000n);
    await until(() => next.get(alice!, open.id)!.quotes.size === 1);
    expect(next.view(next.get(alice!, open.id)!).quotes[0]).toMatchObject({
      maker: "Second maker",
      problem: null,
    });
    next.cancel(alice!, open.id);
    await next.stop();
    await db.closeWorldRfq(domain, lost, {
      status: "cancelled",
      reason: "test",
      quotes: 0,
      at: new Date(),
    });
    // The first process still held it open: it cancels its own copy.
    await call(`/v2/worlds/rfqs/${open.id}/cancel`, {});
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

describe("time passing", () => {
  /** Five minutes pass: on chain first (the API and the keeper both see the new block), then
   * by the keeper's own clock, which never runs ahead of the chain's. */
  const fiveMinutes = async (between: () => Promise<void> = async () => {}) => {
    await node.client.increaseTime({ seconds: 301 });
    await node.client.mine({ blocks: 1 });
    const head = (await node.client.getBlock()).timestamp;
    await until(
      () => indexer.trading().timestamp >= head && keeperFollower.confirmed.timestamp >= head,
    );
    rfqs.tick();
    await between();
    keeperSkew = Number(head) * 1000 - Date.now();
    return head;
  };

  test("the vault renews a quote that ran out unaccepted once, then waits to be asked", async () => {
    const rfq = await ask();
    const old = rfq.quotes[0]!;
    const stream = await follow(`/v2/worlds/rfqs/stream?owner=${alice}`);
    // A second maker quotes for a minute, and does not quote again.
    const m = secondMaker();
    hub.attach(m.session);
    await until(() => m.requests().length === 1);
    await m.quote(m.requests()[0]!, BigInt(old.units) - 1_000_000n, 60);
    await until(async () => (await read(rfq.id)).quotes.length === 2);
    // Five minutes pass and the wallet accepts nothing: both quotes ran out and left.
    const head = await fiveMinutes(async () => {
      expect(await read(rfq.id)).toMatchObject({ status: "open", quotes: [], received: 2 });
    });
    // The vault sends a new quote by itself: the API did not ask again, and no maker was told
    // an outcome. The second maker's is simply gone.
    await until(async () => {
      const q = (await read(rfq.id)).quotes;
      return q.length === 1 && q[0]!.maker === "World vault" && q[0]!.id !== old.id;
    });
    const renewed = await read(rfq.id);
    expect(renewed).toMatchObject({ status: "open", received: 3 });
    expect(renewed.quotes[0]!.problem).toBeNull();
    // The new quote has five minutes of its own, from now.
    const life = Number(renewed.quotes[0]!.expiry) - Number(head);
    expect(life).toBeGreaterThan(290);
    expect(life).toBeLessThanOrEqual(300);
    expect(heard("world.rfq", rfq.id)).toHaveLength(1);
    expect(heard("world.result", rfq.id)).toEqual([]);
    expect(m.got.filter((x) => x.type === "world.result")).toEqual([]);
    // The wallet's stream showed the request without the old quotes, then with the new one.
    await until(() =>
      stream.events.some((e) => (e.data.rfq as RfqBody)?.quotes[0]?.id === renewed.quotes[0]!.id),
    );
    // The old quote can no longer be chosen.
    const late = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: old.id,
      clientId: "client-rfq-8",
    });
    expect(late.status).toBe(409);
    // Five more minutes, still nothing accepted. The vault has given this request its two
    // quotes: it sends no third, and holds nothing for a request nobody means to fill.
    await fiveMinutes();
    await Bun.sleep(1_000);
    expect(await read(rfq.id)).toMatchObject({ status: "open", quotes: [], received: 3 });
    expect(heard("world.rfq", rfq.id)).toHaveLength(1);
    expect([keeper.standingQuotes, keeper.risk.outstanding.size]).toEqual([0, 0]);
    // The request is still open (ten of its fifteen minutes have passed): the wallet asks
    // again, the vault answers, and that quote fills.
    const asked = (await call(`/v2/worlds/rfqs/${rfq.id}/requote`, {})).body.rfq as RfqBody;
    expect(asked.quotes).toMatchObject([{ maker: "World vault", problem: null }]);
    expect(asked.received).toBe(4);
    expect(heard("world.rfq", rfq.id).map((x) => x.replay)).toEqual([false, true]);
    const filled = await call(`/v2/worlds/rfqs/${rfq.id}/execute`, {
      quote: asked.quotes[0]!.id,
      clientId: "client-rfq-9",
    });
    expect([filled.status, filled.body.error]).toEqual([200, undefined]);
    expect((filled.body.rfq as RfqBody).status).toBe("filled");
    await stream.close();
    hub.detach(m.session);
  }, 30_000);
});
