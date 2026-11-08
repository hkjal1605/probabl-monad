/** The worlds people explore: only a world a maker quoted is kept, once per topic (its events and
 * stock: another price, side or date is the same market), one visitor counts once a day per
 * topic (in memory, never stored), notes merge per topic and go out in one write, a failed write
 * is kept, and the list leaves out traded topics and worlds with a decided event. */
import { expect, test } from "bun:test";
import type { WorldExplorationNote, WorldExplorationRecord } from "@conditional-stocks/db";
import { type CatalogEntry, kalshiConditionId } from "@conditional-stocks/market-data";
import { Hono } from "hono";
import { getAddress } from "viem";
import type { WorldPreviewAnswer } from "../src/rfq/world-protocol.ts";
import {
  EXPLORER_WINDOW_MS,
  ExplorationLog,
  explorationOf,
  exploringList,
  QUOTE_WINDOW_MS,
  topicOf,
} from "../src/worlds/explorations.ts";
import { canonicalWorld, offerProducts } from "../src/worlds/opinion.ts";
import { mountOpinions, pageSize } from "../src/worlds/opinions.ts";

const leg = (id: string, yes = 0.4) => ({
  id,
  source: "polymarket",
  marketId: id.split(":")[1]!,
  question: `Will ${id} happen?`,
  label: `${id} happens`,
  url: `https://polymarket.com/event/${id}`,
  image: null,
  endTime: "2026-12-31T00:00:00Z",
  yes,
  wantYes: true,
  // Parts of the preview's leg the exploration does not keep.
  rules: "Long rules",
  volume: 1_000_000,
});
const product = (name: "All-in" | "Money-back", payout: string | null, decline: string | null) => ({
  key: name,
  name,
  stake: name === "All-in" ? "20000000" : "100000000",
  units: payout,
  payout,
  ask: null,
  decline,
  endings: [
    { key: "win", chance: 95_000, pays: payout ?? "0" },
    { key: "world-fails", chance: 700_000, pays: "0" },
  ],
});
const preview = (over: Record<string, unknown> = {}) => ({
  world: {
    sentence: "If a happens and b happens, NVDA closes above $210 on Jan 4",
    specHash: "0xABCDEF",
    // Canonical order: b's deadline is first.
    legs: [leg("polymarket:b"), leg("polymarket:a")],
    stock: {
      underlying: "US:NVDA",
      symbol: "NVDA",
      name: "NVIDIA",
      kind: "stock",
      logo: null,
      decimals: 8,
      direction: "above" as const,
      strike: "210",
      date: "2027-01-04",
      spot: 190,
    },
    fixingTime: 1_799_000_000,
    cutoff: 1_798_996_400,
    feeBps: 100,
  },
  notes: [],
  existing: null,
  problems: [] as string[],
  offer: [product("All-in", "185000000", null), product("Money-back", null, "Not offered")],
  chance: null,
  ...over,
});
const spec = {
  legs: [
    { id: "polymarket:a", wantYes: true },
    { id: "polymarket:b", wantYes: true },
  ],
  stock: { underlying: "US:NVDA", direction: "above" as const, strike: "210", date: "2027-01-04" },
};

test("a world is explored once a maker quotes a product of it, and kept in venue words only", () => {
  const e = explorationOf(spec, preview(), 1_000);
  expect(e).not.toBeNull();
  expect(e!.specHash).toBe("0xabcdef");
  expect(e!.topicHash).toBe(topicOf(spec.legs, "US:NVDA"));
  // The canonical opinion, legs in the world's order.
  expect(e!.spec.legs.map((l) => l.id)).toEqual(["polymarket:b", "polymarket:a"]);
  expect(e!.world.legs[0]).toEqual({
    id: "polymarket:b",
    source: "polymarket",
    marketId: "b",
    question: "Will polymarket:b happen?",
    label: "polymarket:b happens",
    url: "https://polymarket.com/event/polymarket:b",
    image: null,
    endTime: "2026-12-31T00:00:00Z",
    wantYes: true,
    yes: 0.4,
  });
  expect(e!.world.stock).toEqual({
    underlying: "US:NVDA",
    symbol: "NVDA",
    name: "NVIDIA",
    logo: null,
    direction: "above",
    strike: "210",
    date: "2027-01-04",
  });
  // Only the quoted product, with the world's winning chance.
  expect(e!.quote).toEqual({
    at: 1_000,
    products: [{ name: "All-in", stake: "20000000", payout: "185000000" }],
    win: 95_000,
  });
  expect(e!.cutoff).toBe(1_798_996_400);
});

test("a world nobody quoted is not explored: a problem, every maker declining, or no payout", () => {
  expect(explorationOf(spec, preview({ problems: ["Pricing is offline right now"] }))).toBeNull();
  expect(explorationOf(spec, preview({ offer: null }))).toBeNull();
  expect(
    explorationOf(
      spec,
      preview({
        offer: [product("All-in", null, "Too unlikely"), product("Money-back", "0", null)],
      }),
    ),
  ).toBeNull();
});

test("the same events and stock are one market, whatever the price, side, date or order", () => {
  const stock = (over: Record<string, unknown>) => ({
    ...preview().world.stock,
    ...over,
  });
  const base = explorationOf(spec, preview())!;
  // Another price, side and date of the same events and stock: the same topic.
  const repriced = explorationOf(
    {
      ...spec,
      stock: { underlying: "US:NVDA", direction: "below", strike: "180", date: "2027-02-01" },
    },
    preview({
      world: {
        ...preview().world,
        specHash: "0x1234",
        stock: stock({ direction: "below", strike: "180", date: "2027-02-01" }),
      },
    }),
  )!;
  expect(repriced.specHash).not.toBe(base.specHash);
  expect(repriced.topicHash).toBe(base.topicHash);
  // Order and letter case don't matter either.
  expect(topicOf([...spec.legs].reverse(), "us:nvda")).toBe(base.topicHash);
  // Another side of an event, another event, another stock, or no stock: another market.
  const yes = (id: string) => ({ id, wantYes: true });
  for (const other of [
    topicOf([yes("polymarket:a"), { id: "polymarket:b", wantYes: false }], "US:NVDA"),
    topicOf([yes("polymarket:a")], "US:NVDA"),
    topicOf([yes("polymarket:a"), yes("polymarket:b"), yes("polymarket:c")], "US:NVDA"),
    topicOf(spec.legs, "US:TSLA"),
    topicOf(spec.legs, null),
  ])
    expect(other).not.toBe(base.topicHash);
});

const note = (e = explorationOf(spec, preview())!) => e;
const logged = () => {
  let now = 0;
  const writes: WorldExplorationNote[][] = [];
  let fail = false;
  const events: string[] = [];
  const log = new ExplorationLog({
    write: async (notes) => {
      if (fail) throw new Error("database down");
      writes.push(notes);
    },
    log: (event) => events.push(event),
    now: () => now,
    flushMs: 60_000,
  });
  return {
    log,
    writes,
    events,
    at: (ms: number) => {
      now = ms;
    },
    failing: (v: boolean) => {
      fail = v;
    },
  };
};

test("a visitor counts once a day per world, and a reprice once in ten minutes", async () => {
  const t = logged();
  t.log.note(note(), "1.1.1.1");
  t.at(60_000);
  t.log.note(note(), "1.1.1.1"); // a stake edit: neither a new explorer nor a quote
  t.log.note(note(), "2.2.2.2");
  t.at(QUOTE_WINDOW_MS + 1);
  t.log.note(note(), "1.1.1.1"); // a quote again, the same explorer
  await t.log.flush();
  expect(t.writes).toHaveLength(1);
  expect(t.writes[0]).toHaveLength(1);
  expect(t.writes[0]![0]).toMatchObject({ specHash: "0xabcdef", explorers: 2, quotes: 3 });
  expect(t.writes[0]![0]!.at).toEqual(new Date(QUOTE_WINDOW_MS + 1));
  // A day later the same visitor explores it again.
  t.at(EXPLORER_WINDOW_MS + 1);
  t.log.note(note(), "1.1.1.1");
  await t.log.flush();
  expect(t.writes[1]![0]).toMatchObject({ explorers: 1, quotes: 1 });
  // Nothing pending: no write at all.
  await t.log.flush();
  expect(t.writes).toHaveLength(2);
  t.log.stop();
});

test("another price of the same events and stock is the same explorer, and the latest is kept", async () => {
  const t = logged();
  t.log.note(note(), "1.1.1.1");
  t.at(60_000);
  const repriced = {
    ...note(),
    specHash: "0x1234",
    spec: { ...spec, stock: { ...spec.stock, strike: "230" } },
  };
  t.log.note(repriced, "1.1.1.1");
  t.log.note(repriced, "2.2.2.2");
  await t.log.flush();
  // One row for both prices: two people, the price asked last.
  expect(t.writes[0]).toHaveLength(1);
  expect(t.writes[0]![0]).toMatchObject({
    topicHash: note().topicHash,
    specHash: "0x1234",
    explorers: 2,
    quotes: 2,
    spec: { stock: { strike: "230" } },
  });
  t.log.stop();
});

test("notes merge per topic into one write; a failed write is kept for the next", async () => {
  const t = logged();
  const other = { ...note(), topicHash: "0x0b", specHash: "0x0b" };
  t.log.note(note(), "1.1.1.1");
  t.log.note(other, "1.1.1.1");
  t.failing(true);
  await t.log.flush();
  expect(t.events).toEqual(["worlds.explorations.write.failed"]);
  t.failing(false);
  t.log.note(note(), "3.3.3.3");
  await t.log.flush();
  expect(t.writes).toHaveLength(1);
  const byHash = new Map(t.writes[0]!.map((n) => [n.specHash, n]));
  expect(t.writes[0]).toHaveLength(2);
  expect(byHash.get("0xabcdef")).toMatchObject({ explorers: 2, quotes: 2 });
  expect(byHash.get("0x0b")).toMatchObject({ explorers: 1, quotes: 1 });
  t.log.stop();
});

test("the list leaves out traded topics and decided or delisted events, with chances read now", () => {
  const row = (hash: string, legs = ["polymarket:a"], topic = hash) => {
    const e = note();
    return {
      topicHash: topic,
      specHash: hash,
      spec: e.spec,
      world: { ...e.world, legs: legs.map((id) => ({ ...e.world.legs[0]!, id })) },
      quote: e.quote,
      cutoff: e.cutoff,
      explorers: 3,
      quotes: 5,
      firstAt: new Date(0),
      lastAt: new Date(10_000),
    };
  };
  const entries = new Map([
    ["polymarket:a", { yes: 0.55, endTime: "2026-12-31T00:00:00Z" }],
    ["polymarket:decided", { yes: 0.995, endTime: "2026-12-31T00:00:00Z" }],
    ["polymarket:ended", { yes: 0.5, endTime: "2026-01-01T00:00:00Z" }],
  ]);
  const list = exploringList(
    [
      row("0x01"),
      row("0x02"),
      row("0x03", ["polymarket:a", "polymarket:decided"]),
      row("0x04", ["polymarket:gone"]),
      row("0x05", ["polymarket:ended"]),
      row("0x06"),
    ],
    {
      traded: new Set(["0x02"]),
      entries,
      nowMs: Date.parse("2026-11-07T00:00:00Z"),
      limit: 1,
    },
  );
  expect(list.map((w) => w.specHash)).toEqual(["0x01"]);
  expect(list[0]!.world.legs[0]!.yes).toBe(0.55);
  expect(list[0]).toMatchObject({ explorers: 3, lastAt: new Date(10_000).toISOString() });
  expect(
    exploringList([row("0x01"), row("0x06")], {
      traded: new Set(),
      entries,
      nowMs: Date.parse("2026-11-07T00:00:00Z"),
      limit: 10,
    }).map((w) => w.specHash),
  ).toEqual(["0x01", "0x06"]);
  // One card per topic, should two rows ever share one.
  expect(
    exploringList([row("0x01"), row("0x07", undefined, "0x01")], {
      traded: new Set(),
      entries,
      nowMs: Date.parse("2026-11-07T00:00:00Z"),
      limit: 10,
    }).map((w) => w.specHash),
  ).toEqual(["0x01"]);
});

// ------------------------------------------------------------------ the routes

const DAY_S = 86_400;
const entryOf = (id: string, question: string, yes = 0.6): CatalogEntry => ({
  id: `kalshi:${id}`,
  source: "kalshi",
  marketId: id,
  conditionId: kalshiConditionId(id),
  yesIndex: 1,
  noIndex: 2,
  question,
  event: question,
  group: `kalshi:${id}`,
  exclusive: false,
  outcome: null,
  rules: "Rules.",
  endTime: new Date(Date.now() + 20 * DAY_S * 1000).toISOString(),
  url: `https://kalshi.com/markets/${id}`,
  image: null,
  category: "Economics",
  tags: [],
  themes: ["fed"],
  yes,
  bid: yes - 0.01,
  ask: yes + 0.01,
  volume: 1_000,
  liquidity: 0,
  updatedAtMs: Date.now(),
});

/** The opinion routes over memory: an index with one event-only vault, a catalog, a maker that
 * answers (or declines) every preview, and a database that records what it is given. */
function routes(answer: () => WorldPreviewAnswer | null) {
  const catalog = new Map(
    [
      entryOf("FED", "Will the Fed cut rates in December?"),
      entryOf("DEAL", "Will the US and China sign a trade deal?", 0.35),
    ].map((e) => [e.id, e]),
  );
  const deployment = { chainId: 46630, books: getAddress(`0x${"b0".repeat(20)}`) };
  const state = {
    vaults: new Map([
      ["0xvault", { limits: { maxLegs: 4, maxTenor: 365 * DAY_S, eventOnly: true }, feeds: [] }],
    ]),
    bookOf: new Map<string, number>(),
    books: new Map<number, { fills: number }>(),
  };
  const records: {
    kind: string;
    defHash: string;
    metadata: {
      legs: { source: string; marketId: string; wantYes: boolean }[];
      underlying: string | null;
    };
  }[] = [];
  const writes: WorldExplorationNote[][] = [];
  let stored: WorldExplorationRecord[] = [];
  const reads: string[] = [];
  const app = new Hono();
  const handle = mountOpinions(app, {
    indexer: {
      domain: "46630:test",
      deployment,
      trading: () => state,
      metadataRecords: () => records,
      follower: { revision: 0 },
    } as never,
    db: {
      userWorldBook: async () => undefined,
      recordWorldExplorations: async (_: string, notes: WorldExplorationNote[]) => {
        writes.push(notes);
      },
      worldExplorations: async () => {
        reads.push("explorations");
        return stored;
      },
    } as never,
    auth: {} as never,
    client: {} as never,
    hub: { preview: async () => answer() } as never,
    catalog: () =>
      ({
        catalogEntries: async (ids: string[]) => {
          reads.push(`catalog:${ids.length}`);
          return { entries: ids.flatMap((id) => catalog.get(id) ?? []) };
        },
      }) as never,
    underlyings: [],
    spots: { usd: async () => null, all: async () => new Map() } as never,
    assistant: { dailyBudgetUsd: 0 } as never,
    feeBps: 100,
    quoteUnit: 1_000_000n,
    trustedHops: 1,
    prepareUserBook: async () => {
      throw new Error("not used");
    },
    log: () => {},
  });
  const world = (ids: string[]) =>
    canonicalWorld(
      { legs: ids.map((id) => ({ id, wantYes: true })), stock: null },
      catalog,
      null,
      deployment,
      100,
    );
  const preview = (ids: string[], visitor: string, explore: boolean) =>
    app.request("/v2/worlds/preview", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": visitor },
      body: JSON.stringify({
        spec: { legs: ids.map((id) => ({ id, wantYes: true })), stock: null },
        ...(explore ? { explore: true } : {}),
      }),
    });
  return {
    app,
    handle,
    writes,
    reads,
    records,
    state,
    world,
    preview,
    store: (rows: WorldExplorationRecord[]) => {
      stored = rows;
    },
  };
}
const quoted = (key: string): WorldPreviewAnswer => ({
  decline: null,
  marks: [700_000, 300_000],
  analytics: null,
  priorOnly: false,
  products: [{ key, stake: "20000000", units: "64000000", ask: 312_500, decline: null }],
});

test("a quoted world a person asked for is kept; an example, a declined world and none asked are not", async () => {
  let declining = false;
  const allIn = offerProducts(routes(() => null).world(["kalshi:FED"])).allIn;
  const r = routes(() =>
    declining ? { ...quoted(allIn), decline: "Spread is too wide" } : quoted(allIn),
  );
  // Asked for: kept (and the response is the preview as before).
  const res = await r.preview(["kalshi:FED"], "1.1.1.1", true);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { offer: { payout: string }[]; problems: string[] };
  expect(body.problems).toEqual([]);
  expect(body.offer[0]!.payout).toBe("64000000");
  // The page's own examples are priced without `explore`: not kept.
  await r.preview(["kalshi:DEAL"], "1.1.1.1", false);
  // Every maker declining: not kept.
  declining = true;
  await r.preview(["kalshi:DEAL", "kalshi:FED"], "1.1.1.1", true);
  await r.handle.stop();
  expect(r.writes).toHaveLength(1);
  expect(r.writes[0]!.map((n) => n.specHash)).toEqual([r.world(["kalshi:FED"]).specHash]);
  expect(r.writes[0]![0]!.topicHash).toBe(topicOf([{ id: "kalshi:FED", wantYes: true }], null));
  expect(r.writes[0]![0]).toMatchObject({
    explorers: 1,
    quotes: 1,
    spec: { legs: [{ id: "kalshi:FED", wantYes: true }], stock: null },
    quote: { products: [{ name: "All-in", stake: "20000000", payout: "64000000" }], win: 300_000 },
  });
  // Pricing offline (no maker at all): nothing kept, nothing written.
  const offline = routes(() => null);
  await offline.preview(["kalshi:FED"], "1.1.1.1", true);
  await offline.handle.stop();
  expect(offline.writes).toEqual([]);
});

test("the list reads the table and the catalog once per half minute, without traded worlds", async () => {
  const allIn = offerProducts(routes(() => null).world(["kalshi:FED"])).allIn;
  const r = routes(() => quoted(allIn));
  const fed = r.world(["kalshi:FED"]);
  const deal = r.world(["kalshi:DEAL"]);
  const row = (w: typeof fed, lastAt: number): WorldExplorationRecord => ({
    topicHash: topicOf(
      w.legs.map((l) => ({ id: l.entry.id, wantYes: true })),
      null,
    ),
    specHash: w.specHash,
    spec: { legs: w.legs.map((l) => ({ id: l.entry.id, wantYes: true })), stock: null },
    world: {
      sentence: w.sentence,
      legs: w.legs.map((l) => ({ id: l.entry.id, label: l.label, wantYes: true, yes: 0.5 })),
      stock: null,
      fixingTime: null,
      cutoff: w.cutoff,
    },
    quote: { at: lastAt, products: [], win: 300_000 },
    cutoff: w.cutoff,
    explorers: 2,
    quotes: 3,
    firstAt: new Date(lastAt - 1000),
    lastAt: new Date(lastAt),
  });
  r.store([row(fed, 2_000), row(deal, 1_000)]);
  // A world on DEAL's events is traded: it is in the live feed instead.
  r.records.push({
    kind: "user",
    defHash: "0xdef",
    metadata: { legs: [{ source: "kalshi", marketId: "DEAL", wantYes: true }], underlying: null },
  });
  r.state.bookOf.set("0xdef", 7);
  r.state.books.set(7, { fills: 1 });
  const read = async () =>
    (await (await r.app.request("/v2/worlds/exploring")).json()) as {
      worlds: { specHash: string; explorers: number; world: { legs: { yes: number }[] } }[];
    };
  const first = await read();
  expect(first.worlds.map((w) => w.specHash)).toEqual([fed.specHash]);
  // The chance as the catalog has it now.
  expect(first.worlds[0]!.world.legs[0]!.yes).toBe(0.6);
  expect(first.worlds[0]!.explorers).toBe(2);
  await Promise.all([read(), read()]);
  expect(r.reads).toEqual(["explorations", "catalog:2"]);
  // A page asks for as many as it shows, and learns how many there are, from the same read.
  r.records.length = 0;
  r.state.books.clear();
  r.store([row(fed, 2_000), row(deal, 1_000)]);
  const page = async (limit: string) =>
    (await (await r.app.request(`/v2/worlds/exploring?limit=${limit}`)).json()) as {
      worlds: unknown[];
      total: number;
    };
  // Still the half-minute's read: DEAL stays left out until the next one.
  expect(await page("1")).toMatchObject({ total: 1 });
  expect((await page("1")).worlds).toHaveLength(1);
  expect(r.reads).toEqual(["explorations", "catalog:2"]);
  await r.handle.stop();
});

test("a page size is a whole number from 1 to the list's largest, else the largest", () => {
  expect(pageSize("4", 48)).toBe(4);
  expect(pageSize("500", 48)).toBe(48);
  for (const bad of [undefined, "", "0", "-3", "2.5", "x"]) expect(pageSize(bad, 200)).toBe(200);
});
