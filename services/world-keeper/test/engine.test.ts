/** The world keeper against the real contracts on anvil: it prices from memory, signs, and the
 * vault's own hook accepts every fill it quotes (world bets, conditional payouts, cash-outs); its
 * limits count quotes in flight; a quote makes no RPC, fetch or database call; indications and
 * marks are coherent. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { WorldBookRecord } from "@conditional-stocks/db";
import {
  bookDefHash,
  eventKey,
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
import {
  createPublicClient,
  custom,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  stringToBytes,
} from "viem";
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
import { type PreviewBook, WorldKeeper, type WorldOrderRequest } from "../src/engine.ts";
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

/** A tick's time: the clock's, but always later than the last one (a tick no newer than the
 * one before it is ignored, and two in the same millisecond would be). */
let stamped = 0;
const stamp = () => {
  stamped = Math.max(stamped + 1, Date.now());
  return stamped;
};
const tick = (condition: Hex, yes: number) => ({
  schemaVersion: 1,
  quality: "valid",
  isStale: false,
  conditionId: condition,
  midpointX6: String(Math.round(yes * 1e6)),
  bestBidX6: String(Math.round(yes * 1e6) - 5_000),
  bestAskX6: String(Math.round(yes * 1e6) + 5_000),
  observedAtMs: String(stamp()),
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

describe("previews of worlds not created yet", () => {
  const fresh = keccak256(stringToBytes("condition opened by a user"));
  const leg = (condition: Hex, i: number, reference: PreviewBook["legs"][number]["reference"]) => ({
    eventKey: eventKey(condition, 1, 2),
    wantYes: true,
    source: "kalshi" as const,
    marketId: `M${i}`,
    conditionId: condition,
    yesIndex: 1,
    noIndex: 2,
    question: `Leg ${i}`,
    url: "https://kalshi.com/markets/x",
    endTime: new Date(Date.now() + 15 * 86_400_000).toISOString(),
    themes: ["ai"],
    reference,
  });
  const book = (legs: PreviewBook["legs"]): PreviewBook => {
    const now = Math.floor(Date.now() / 1000);
    return {
      legs,
      feed: worlds.feed,
      underlying: "US:NVDA",
      feedDecimals: 8,
      fixingTime: now + 20 * 86_400,
      cutoff: now + 20 * 86_400 - 3_600,
      maxStaleness: 3_600,
      strikes: [24_000_000_000n],
      feeBps: 100,
      spot: null,
    };
  };
  const stakes = { allIn: 20_000_000n, moneyBack: 100_000_000n };

  test("a user's world prices from memory through the real quote path", () => {
    observeAll();
    const before = rpcCalls;
    const reference = { yes: 0.4, halfSpread: 0.01, observedAtMs: Date.now() };
    const result = keeper.preview(
      book([leg(CONDITIONS[0]!, 0, null), leg(fresh, 9, reference)]),
      stakes,
      3,
    );
    if ("decline" in result) throw new Error(result.decline);
    expect(rpcCalls - before).toBe(0);
    // Five products, each bought for its stake: All-in for $20, Money-back for $100.
    expect(result.products.map((p) => p.key).sort()).toEqual(
      ["bet:above:1", "bet:below:1", "bet:world", "cond:above:1", "cond:below:1"].sort(),
    );
    for (const p of result.products) {
      expect(p.decline).toBeNull();
      expect(BigInt(p.units!)).toBeGreaterThan(0n);
    }
    const allIn = result.products.find((p) => p.key === "bet:above:1")!;
    expect(allIn.stake).toBe("20000000");
    // The marks are a distribution; the chain shrinks to P(W), above the unrelated chain.
    expect(result.marks.reduce((a, b) => a + b, 0)).toBe(1_000_000);
    const { chain, naive, world, legs } = result.analytics;
    expect(chain.length).toBe(2);
    expect(chain[1]).toBeLessThan(chain[0]!);
    expect(chain[1]).toBe(world);
    expect(Math.abs(world - (1_000_000 - result.marks[0]!))).toBeLessThan(5);
    expect(naive[1]).toBeLessThanOrEqual(chain[1]! + 2_000);
    // The followed leg from its live tick, the new one from its reference.
    expect(legs[0]!.chance).toBe(350_000);
    expect(legs[1]!.chance).toBe(400_000);
    expect(result.analytics.forward).toBeGreaterThan(0);
  });

  test("a leg nobody follows and no reference: declined; nothing is held", () => {
    const result = keeper.preview(book([leg(fresh, 9, null)]), stakes, 3);
    expect(result).toEqual({ decline: "A leg has no live probability" });
    expect(keeper.risk.outstanding.size).toBe(0);
  });

  test("an old reference is not used", () => {
    const stale = { yes: 0.4, halfSpread: 0.01, observedAtMs: Date.now() - 30 * 60_000 };
    expect(keeper.preview(book([leg(fresh, 9, stale)]), stakes, 3)).toEqual({
      decline: "A leg has no live probability",
    });
  });
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

  test("a quote on an open request lives minutes, costs a little more, and the vault fills it", async () => {
    observeAll();
    keeper.refresh(true);
    const bet = order({ taker: bob!, mask: outcomeMask({ kind: "world" }, 7) });
    const now = BigInt(Math.floor(Date.now() / 1000));
    const auction = keeper.price(bet, 3);
    const open = keeper.price(bet, 3, undefined, true);
    if ("decline" in auction || "decline" in open) throw new Error("declined");
    // An auction's quote fills at once: ten seconds. An open request's taker reads the quotes
    // and chooses: five minutes (the vault's `maxTtl` here, counted from the signing time).
    expect(Number(auction.quote.expiry - now)).toBeGreaterThanOrEqual(8);
    expect(Number(auction.quote.expiry - now)).toBeLessThanOrEqual(11);
    expect(Number(open.quote.expiry - now)).toBeGreaterThanOrEqual(295);
    expect(Number(open.quote.expiry - now)).toBeLessThanOrEqual(300);
    // The same formula charges the longer life (its stale-quote term), and nothing else moves.
    expect(open.components.stale).toBeGreaterThan(auction.components.stale * 4);
    expect(open.components.stale).toBeLessThan(auction.components.stale * 7);
    const perUnit = (p: typeof open) => p.components.ambiguity / Number(p.quote.units);
    expect(perUnit(open)).toBeCloseTo(perUnit(auction), 6);
    expect(open.quote.units).toBeLessThanOrEqual(auction.quote.units);
    expect(Number(auction.quote.units - open.quote.units)).toBeLessThan(
      Number(auction.quote.units) * 0.02,
    );
    // The vault's own hook accepts the long quote.
    const signed = await keeper.sign("open-fill", open, true);
    expect(keeper.standingQuotes).toBe(1);
    expect((await fill(2, signed)).status).toBe("success");
    // Its fill, seen on the replica, ends the review and the hold.
    expect(keeper.standingQuotes).toBe(0);
    expect(keeper.risk.outstanding.has("open-fill")).toBe(false);
  });

  test("near a scheduled resolution an open quote lives a minute", () => {
    observeAll();
    const resolvingIn = (seconds: number, open: boolean) => {
      const near = new Map(
        [...metadata].map(([id, m]) => [
          id,
          {
            ...m,
            metadata: {
              ...m.metadata,
              legs: m.metadata.legs.map((l) => ({
                ...l,
                endTime: new Date(Date.now() + seconds * 1000).toISOString(),
              })),
            },
          },
        ]),
      );
      const k = new WorldKeeper({
        ...keeper.options,
        metadata: () => near,
        state: { version: 1, scope: `near-${seconds}`, ...initialJournal(), counter: "1" },
      });
      k.refresh(true);
      const priced = k.price(order({ book: 2, mask: 0b10 }), 3, undefined, open);
      if ("decline" in priced) throw new Error(priced.decline);
      return Number(priced.quote.expiry) - Math.floor(Date.now() / 1000);
    };
    const about = (ttl: number, seconds: number) => {
      expect(ttl).toBeGreaterThanOrEqual(seconds - 3);
      expect(ttl).toBeLessThanOrEqual(seconds);
    };
    // Days ahead of it: five minutes. Within two hours, or past the venue's end time: a
    // minute, where an auction's quote lives five seconds.
    about(resolvingIn(3 * 86_400, true), 300);
    about(resolvingIn(5_400, true), 60);
    about(resolvingIn(-600, true), 60);
    about(resolvingIn(5_400, false), 5);
  });

  test("a standing quote is withdrawn once the price has moved against it, never for a move its way", async () => {
    const lone = CONDITIONS[3]!;
    const fresh = (scope: string, now?: () => number) => {
      const k = new WorldKeeper({
        ...keeper.options,
        state: { version: 1, scope, ...initialJournal(), counter: "500" },
        ...(now ? { now } : {}),
      });
      k.refresh(true);
      return k;
    };
    const quoteOpen = async (k: WorldKeeper, id: string) => {
      // Asked again, the vault's earlier quote on the request goes first (as its maker does).
      k.withdraw(id);
      // The event-only book: one leg, at 60%.
      const priced = k.price(
        order({ taker: accounts[7]!.address, book: 2, mask: 0b10 }),
        3,
        undefined,
        true,
      );
      if ("decline" in priced) throw new Error(priced.decline);
      await k.sign(id, priced, true);
      return priced;
    };
    try {
      observeAll();
      const k = fresh("review");
      await quoteOpen(k, "rfq-a");
      expect(k.standingQuotes).toBe(1);
      expect(k.risk.outstanding.has("rfq-a")).toBe(true);
      // Nothing moved: nothing to look at, nothing withdrawn.
      expect(k.review()).toEqual([]);
      k.refresh(true);
      expect(k.review()).toEqual([]);
      // The world got less likely: the quote only got better for the vault.
      legs.observe(lone, tick(lone, 0.5));
      k.refresh(true);
      expect(k.review()).toEqual([]);
      // A small move against it leaves most of its margin.
      legs.observe(lone, tick(lone, 0.603));
      k.refresh(true);
      expect(k.review()).toEqual([]);
      // The world got much more likely: the bet is now worth more than the vault sold it for.
      legs.observe(lone, tick(lone, 0.75));
      k.refresh(true);
      expect(k.review()).toEqual([{ id: "rfq-a", reason: "The price moved" }]);
      k.withdraw("rfq-a");
      expect(k.standingQuotes).toBe(0);
      expect(k.risk.outstanding.has("rfq-a")).toBe(false);
      expect(k.review()).toEqual([]);

      // A quote asked again replaces the earlier one: one hold, one quote under review.
      legs.observe(lone, tick(lone, 0.6));
      k.refresh(true);
      const first = await quoteOpen(k, "rfq-b");
      const second = await quoteOpen(k, "rfq-b");
      expect(second.quote.units).toBe(first.quote.units);
      expect(k.standingQuotes).toBe(1);
      expect(k.risk.outstanding.size).toBe(1);
      // A request that ended frees the quote; the stream closing frees them all.
      k.outcome("rfq-b", "unfilled");
      expect([k.standingQuotes, k.risk.outstanding.size]).toEqual([0, 0]);
      await quoteOpen(k, "rfq-c");
      await quoteOpen(k, "rfq-d");
      k.dropStanding();
      expect([k.standingQuotes, k.risk.outstanding.size]).toEqual([0, 0]);

      // A vault that could not quote withdraws what stands.
      await quoteOpen(k, "rfq-e");
      k.stopped = true;
      expect(k.review()).toEqual([{ id: "rfq-e", reason: "Stopping" }]);
      k.stopped = false;
      // A quote that ran out unaccepted is named once, so the vault can quote the request
      // again, and nothing of it is held any more.
      let clock = Date.now();
      const timed = fresh("review-clock", () => clock);
      await quoteOpen(timed, "rfq-f");
      clock += 200_000;
      expect(timed.review()).toEqual([]);
      expect(timed.standingQuotes).toBe(1);
      clock += 110_000;
      expect(timed.review()).toEqual([{ id: "rfq-f", reason: "Expired" }]);
      expect([timed.standingQuotes, timed.risk.outstanding.size]).toEqual([0, 0]);
      expect(timed.review()).toEqual([]);
    } finally {
      observeAll();
      keeper.refresh(true);
    }
  });

  test("a book whose references went stale takes its standing quotes with it", async () => {
    observeAll();
    const own = new LegReferences({
      origin: "http://127.0.0.1:1",
      fetch: (async () => new Response("null")) as never,
      connect: () => ({ onmessage: null, onclose: null, close() {} }),
    });
    for (const [i, c] of CONDITIONS.entries()) own.observe(c, tick(c, YES[i]!));
    let clock = Date.now();
    const k = new WorldKeeper({
      ...keeper.options,
      legs: own,
      state: { version: 1, scope: "stale", ...initialJournal(), counter: "900" },
      now: () => clock,
    });
    k.refresh(true);
    const priced = k.price(
      order({ taker: accounts[7]!.address, book: 2, mask: 0b10 }),
      3,
      undefined,
      true,
    );
    if ("decline" in priced) throw new Error(priced.decline);
    await k.sign("rfq-stale", priced, true);
    // A minute without a tick: the leg is too old to price from, and the model goes.
    clock += 60_000;
    k.refresh(true);
    expect(k.review()).toEqual([{ id: "rfq-stale", reason: "The book is not quoted" }]);
  });

  test("indications carry each book's chance chain", () => {
    observeAll();
    keeper.refresh(true);
    const [priced] = keeper.indications(3).filter((b) => b.book === 1);
    expect(priced!.analytics.chain.length).toBe(3);
    expect(priced!.analytics.legs.map((l) => l.chance)).toEqual([350_000, 150_000, 300_000]);
    expect(priced!.analytics.move).toBeGreaterThan(0);
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
