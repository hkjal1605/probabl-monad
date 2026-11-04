/** The world keeper against the real contracts on anvil: it prices from memory, signs, and the
 * vault's own hook accepts every fill it quotes (world bets, conditional payouts, cash-outs); its
 * limits count quotes in flight; a quote makes no RPC, fetch or database call; indications and
 * marks are coherent. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WorldBookRecord } from "@conditional-stocks/db";
import {
  bookDefHash,
  outcomeMask,
  standardProducts,
  worldBooksCalls,
  worldFee,
} from "@conditional-stocks/evm-client";
import {
  atomsOf,
  type WorldEvent,
  type WorldState,
  type WorldTouched,
  worldCreditOf,
} from "@conditional-stocks/evm-client/world-ledger";
import { ChainFollower } from "@conditional-stocks/indexer";
import { worldLedger } from "@conditional-stocks/indexer/worlds";
import { initialJournal } from "@conditional-stocks/operator";
import { createPublicClient, custom, type Hex, http, type PublicClient } from "viem";
import { type Anvil, accounts, send, startAnvil } from "../../../packages/evm-client/test/anvil.ts";
import {
  CONDITIONS,
  deployWorlds,
  eventDef,
  pricedDef,
  URI,
  type Worlds,
} from "../../../packages/evm-client/test/worlds-anvil.ts";
import { settings } from "../src/config.ts";
import { WorldKeeper, type WorldOrderRequest } from "../src/engine.ts";
import { emptyData } from "../src/inputs.ts";
import { WorldMarker } from "../src/marker.ts";
import { LegReferences, SpotReferences } from "../src/references.ts";

let node: Anvil;
let worlds: Worlds;
let follower: ChainFollower<WorldState, WorldTouched, WorldEvent>;
let keeper: WorldKeeper;
let legs: LegReferences;
let spot: SpotReferences;
let rpcCalls = 0;
const [, alice, bob] = accounts.map((a) => a.address);
const YES = [0.35, 0.15, 0.3, 0.6];
const metadata = new Map<number, WorldBookRecord>();
/** The research's gaps on NVDA: 8%, 2% and 5% (errors 2, 1 and 1.5%). */
const data = emptyData();
for (const [i, [gap, error]] of [
  [0.08, 0.02],
  [0.02, 0.01],
  [0.05, 0.015],
].entries())
  data.gaps.set(`${CONDITIONS[i]!.toLowerCase()}:US:NVDA`, { gap: gap!, error: error! });
// The research's fitted correlations: 0.146 on every pair (standard error 0.10 in Fisher z).
for (let i = 0; i < 3; i++)
  for (let j = i + 1; j < 3; j++) {
    const [a, b] = [CONDITIONS[i]!.toLowerCase(), CONDITIONS[j]!.toLowerCase()].sort();
    data.correlations.set(`${a}:${b}`, { rho: 0.146, se: 0.1, samples: 60 });
  }

const tick = (condition: Hex, yes: number) => ({
  schemaVersion: 1,
  quality: "valid",
  isStale: false,
  conditionId: condition,
  midpointX6: String(Math.round(yes * 1e6)),
  bestBidX6: String(Math.round(yes * 1e6) - 5_000),
  bestAskX6: String(Math.round(yes * 1e6) + 5_000),
  observedAtMs: String(Date.now()),
});
const observeAll = () => {
  for (const [i, c] of CONDITIONS.entries()) legs.observe(c, tick(c, YES[i]!));
};
const order = (o: Partial<WorldOrderRequest>): WorldOrderRequest => ({
  taker: alice!,
  book: 1,
  mask: outcomeMask({ kind: "above", strike: 3 }, 7),
  side: "buy",
  units: null,
  refund: 0n,
  stake: 50_000_000n,
  conditional: false,
  limit: 0n,
  ...o,
});
async function fill(
  index: number,
  q: { quote: Parameters<ReturnType<typeof worldBooksCalls>["fillQuote"]>[0]; signature: Hex },
) {
  const receipt = await send(
    node,
    index,
    worldBooksCalls(worlds.books).fillQuote(q.quote, q.signature),
  );
  follower.poke();
  await follower.reached(receipt.blockNumber, 10_000);
  return receipt;
}

beforeAll(async () => {
  node = await startAnvil(Math.floor(Date.now() / 1000));
  const now = Number((await node.client.getBlock()).timestamp);
  worlds = await deployWorlds(node, now);
  const priced = pricedDef(worlds, now),
    event = eventDef(now);
  await send(node, 0, worlds.w.createBook(priced, URI));
  await send(node, 0, worlds.w.createBook(event, URI));
  const counting = (client: PublicClient) =>
    createPublicClient({
      chain: node.chain,
      transport: custom({
        request: (args: { method: string; params?: unknown }) => {
          rpcCalls++;
          return client.request(args as never);
        },
      }),
    }) as PublicClient;
  const client = counting(
    createPublicClient({ chain: node.chain, transport: http(node.url) }) as PublicClient,
  );
  const deployment = {
    chainId: node.chain.id,
    books: worlds.books,
    oracle: worlds.oracle,
    quote: worlds.usdg,
    vaults: [worlds.vault],
  };
  follower = new ChainFollower<WorldState, WorldTouched, WorldEvent>({
    client,
    exchange: worlds.books,
    quote: worlds.usdg,
    ledger: worldLedger(deployment),
    deploymentBlock: worlds.deploymentBlock,
    domain: "test",
    pollMs: 200,
    finalityDepth: 0n,
    onCommit: (notice) => keeper?.onFills(notice.events),
  });
  await follower.start();
  const legMeta = (defLegs: typeof priced.legs, offset: number) =>
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
      themes: [["us-china"], ["ai", "filings"], ["ai"], ["fed"]][offset + i]!,
    }));
  const record = (id: number, def: typeof priced, offset: number): WorldBookRecord => ({
    defHash: bookDefHash(def),
    book: id,
    title: `Book ${id}`,
    kind: "curated",
    metadata: {
      legs: legMeta(def.legs, offset),
      underlying: def.feed === "0x0000000000000000000000000000000000000000" ? null : "US:NVDA",
      feedDecimals: 8,
      fixing: null,
      metadataUri: URI,
      def: {},
    },
    packetHash: null,
    createdAt: new Date(),
  });
  metadata.set(1, record(1, priced, 0));
  metadata.set(2, record(2, event, 3));
  legs = new LegReferences({
    origin: "http://127.0.0.1:1",
    fetch: (async () => new Response("null")) as never,
    connect: () => ({ onmessage: null, onclose: null, close() {} }),
  });
  observeAll();
  spot = new SpotReferences({
    client,
    origin: "http://127.0.0.1:1",
    pollMs: 60_000,
    sources: () => [{ feed: worlds.feed }],
  });
  await spot.poll();
  keeper = new WorldKeeper({
    follower,
    settings: settings({
      vault: worlds.vault,
      underlyings: { "US:NVDA": { kind: "stock", vol: 0.47 } },
      references: { allowStaleSpot: true },
    }),
    chainId: node.chain.id,
    legs,
    spot,
    metadata: () => metadata,
    data: () => data,
    state: { version: 1, scope: "test", ...initialJournal(), counter: "1" },
    save: () => {},
    account: accounts[4]!,
  });
  expect(keeper.refresh(true)).toBe(2);
}, 120_000);
afterAll(() => {
  follower?.stop();
  node?.stop();
});

describe("quoting the world vault", () => {
  test("a quote reads only memory: no RPC, no fetch", async () => {
    observeAll();
    keeper.refresh(true);
    const before = rpcCalls;
    const realFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetches++;
      return realFetch(...args);
    }) as typeof fetch;
    try {
      const started = performance.now();
      const priced = keeper.price(order({ mask: outcomeMask({ kind: "world" }, 7) }), 3);
      const ms = performance.now() - started;
      expect("quote" in priced).toBe(true);
      expect(ms).toBeLessThan(50);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(fetches).toBe(0);
    expect(rpcCalls - before).toBe(0);
  });

  test("a world bet by stake fills on chain, and the vault's position follows", async () => {
    observeAll();
    keeper.refresh(true);
    const priced = keeper.price(order({ mask: outcomeMask({ kind: "world" }, 7) }), 3);
    if (!("quote" in priced)) throw new Error(priced.decline);
    const { quote } = priced;
    expect(quote.price).toBe(50_000_000n);
    // The world near 2.3% (theme priors): about 50 / 0.028 units at the vault's ask.
    expect(quote.units).toBeGreaterThan(1_200_000_000n);
    expect(quote.units).toBeLessThan(2_300_000_000n);
    expect(priced.markup).toBeGreaterThan(0.01);
    const signed = await keeper.sign("rfq-1", priced);
    expect(keeper.risk.outstanding.size).toBe(1);
    const creditBefore = worldCreditOf(follower.confirmed, alice!);
    await fill(1, signed);
    const s = follower.confirmed;
    expect(worldCreditOf(s, alice!)).toBe(creditBefore - quote.price - worldFee(quote.price, 100));
    expect(atomsOf(s, 1, alice!)[4]).toBe(quote.units);
    expect(s.vaults.get(worlds.vault)!.positions.get(1)).toBeDefined();
    // The replica holds the fill now: the in-flight hold is released.
    expect(keeper.risk.outstanding.size).toBe(0);
  });

  test("a conditional payout refunds the stake if the world fails, and fills", async () => {
    observeAll();
    keeper.refresh(true);
    const priced = keeper.price(order({ taker: bob!, conditional: true, stake: 100_000_000n }), 3);
    if (!("quote" in priced)) throw new Error(priced.decline);
    expect(priced.quote.refund).toBe(100_000_000n);
    expect(priced.quote.price).toBe(100_000_000n);
    // In the world the units are worth about 2.5 per dollar of stake at a ~37% in-world chance.
    expect(Number(priced.quote.units) / 100e6).toBeGreaterThan(2);
    expect(Number(priced.quote.units) / 100e6).toBeLessThan(3);
    await fill(2, await keeper.sign("rfq-2", priced));
    expect(atomsOf(follower.confirmed, 1, bob!)[0]).toBe(100_000_000n);
  });

  test("a cash-out bid sits under the ask and fills", async () => {
    observeAll();
    keeper.refresh(true);
    const held = atomsOf(follower.confirmed, 1, alice!)[4]!;
    const units = held / 2n;
    const world = outcomeMask({ kind: "world" }, 7);
    const bid = keeper.price(
      order({ mask: world, side: "sell", units, refund: 0n, stake: null, limit: 1n }),
      3,
    );
    if (!("quote" in bid)) throw new Error(bid.decline);
    const ask = keeper.price(
      order({ mask: world, units, refund: 0n, stake: null, limit: 10n ** 18n }),
      3,
    );
    if (!("quote" in ask)) throw new Error(ask.decline);
    expect(bid.quote.price).toBeLessThan(ask.quote.price);
    expect(bid.quote.price).toBeLessThan(BigInt(Math.floor(bid.fair)));
    await fill(1, await keeper.sign("rfq-3", bid));
    expect(atomsOf(follower.confirmed, 1, alice!)[4]).toBe(held - units);
  });

  test("quotes in flight count against the limits", async () => {
    observeAll();
    keeper.refresh(true);
    const tight = new WorldKeeper({
      ...keeper.options,
      settings: settings({
        vault: worlds.vault,
        underlyings: { "US:NVDA": { kind: "stock", vol: 0.47 } },
        references: { allowStaleSpot: true },
        risk: { perBook: 0.012, kelly: 1, requesterOutstanding: 1, requesterDaily: 1 },
      }),
      state: { version: 1, scope: "tight", ...initialJournal(), counter: "100" },
    });
    tight.refresh(true);
    // The event-only book (one leg at 60%): each $1,000 bet locks about $650.
    const bet = order({ taker: accounts[7]!.address, book: 2, mask: 0b10, stake: 1_000_000_000n });
    const signed: unknown[] = [];
    let declined: string | null = null;
    for (let i = 0; i < 40 && !declined; i++) {
      const priced = tight.price(bet, 3);
      if ("decline" in priced) declined = priced.decline;
      else signed.push(await tight.sign(`tight-${i}`, priced));
    }
    expect(declined).toContain("per-book");
    expect(signed.length).toBeGreaterThan(5);
    // Lost quotes free their capacity at once.
    for (let i = 0; i < signed.length; i++) tight.outcome(`tight-${i}`, "lost");
    expect("quote" in tight.price(bet, 3)).toBe(true);
  });

  test("declines without fresh references, near resolution, or for its own order", () => {
    keeper.refresh(true);
    expect("decline" in keeper.price(order({ taker: worlds.vault }), 3)).toBe(true);
    expect("decline" in keeper.price(order({ book: 99 }), 3)).toBe(true);
    // A stale leg drops the book's model on the next refresh.
    const stale = new LegReferences({
      origin: "http://127.0.0.1:1",
      fetch: (async () => new Response("null")) as never,
      connect: () => ({ onmessage: null, onclose: null, close() {} }),
    });
    const blind = new WorldKeeper({
      ...keeper.options,
      legs: stale,
      state: { version: 1, scope: "blind", ...initialJournal(), counter: "1" },
    });
    expect(blind.refresh(true)).toBe(0);
    expect(blind.price(order({}), 3)).toEqual({ decline: "The book is not quoted" });
  });

  test("indications bracket each product and marks sum to a million", () => {
    observeAll();
    keeper.refresh(true);
    const books = keeper.indications(3);
    expect(books.map((b) => b.book).sort()).toEqual([1, 2]);
    for (const b of books) {
      expect(b.marks.reduce((x, y) => x + y, 0)).toBe(1_000_000);
      const def = follower.confirmed.books.get(b.book)!.def;
      expect(b.products.map((p) => p.key)).toEqual(standardProducts(def).map((p) => p.key));
      for (const p of b.products)
        if (p.bid !== null && p.ask !== null) expect(p.bid).toBeLessThanOrEqual(p.ask);
    }
    const world = books.find((b) => b.book === 2)!.products[0]!;
    expect(world.ask!).toBeGreaterThan(600_000);
    expect(world.ask!).toBeLessThan(650_000);
  });

  test("the marker values the vault inside a batch's bounds", async () => {
    await send(node, 2, worlds.v.requestDeposit(1_000_000n));
    await node.client.setNextBlockTimestamp({
      timestamp: (await node.client.getBlock()).timestamp + 86_401n,
    });
    await node.client.mine({ blocks: 1 });
    const marker = new WorldMarker({ keeper, vault: worlds.vault, domain: "test", log: () => {} });
    const receipt = await send(node, 1, worlds.v.closeBatch());
    follower.poke();
    await follower.reached(receipt.blockNumber, 10_000);
    const v = follower.confirmed.vaults.get(worlds.vault)!;
    const mark = marker.valuation(follower.confirmed, v)!;
    expect(mark.nav).toBeGreaterThanOrEqual(mark.guaranteed);
    expect(mark.nav).toBeLessThanOrEqual(mark.best);
    expect(mark.postable).toBe(true);
    // The mark posts on chain as the marker.
    await send(node, 5, worlds.v.mark(BigInt(mark.id), mark.nav));
  });
});
