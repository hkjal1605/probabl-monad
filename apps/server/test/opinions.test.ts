/** Users' worlds: an opinion read into legs and a stock (the model reads it into events and
 * their headline searches, then picks among what those found; rules when there is no model),
 * its one canonical world however it is worded, the problems that stop it before pricing, the
 * offer a preview answers with, and the hub's preview round. */
import { expect, test } from "bun:test";
import { eventKey, outcomeMask } from "@conditional-stocks/evm-client";
import { type CatalogEntry, kalshiConditionId } from "@conditional-stocks/market-data";
import { getAddress } from "viem";
import { RfqHub, type RfqSession } from "../src/rfq/hub.ts";
import type { MakerIdentity } from "../src/rfq/protocol.ts";
import { extract, OPENROUTER_URL, readOpinion, roundStrike } from "../src/worlds/assistant.ts";
import {
  canonicalWorld,
  closeOf,
  nextClose,
  OpinionError,
  offerOf,
  offerProducts,
  parseSpec,
  type WorldUnderlying,
  worldProblems,
} from "../src/worlds/opinion.ts";
import { friendlyDecline } from "../src/worlds/opinions.ts";

const NOW = Date.parse("2026-11-04T15:00:00Z") / 1000;
const DAY = 86_400;
const NVDA: WorldUnderlying = {
  underlying: "US:NVDA",
  symbol: "NVDA",
  name: "NVIDIA",
  kind: "stock",
  logo: null,
  feed: getAddress(`0x${"fe".repeat(20)}`),
  token: null,
  decimals: 8,
};
const BTC: WorldUnderlying = {
  ...NVDA,
  underlying: "CRYPTO:BTC",
  symbol: "BTC",
  name: "Bitcoin",
  kind: "crypto",
};
const entry = (id: string, question: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
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
  endTime: new Date((NOW + 20 * DAY) * 1000).toISOString(),
  url: "https://kalshi.com/markets/x",
  image: null,
  category: "Economics",
  tags: [],
  themes: ["fed"],
  yes: 0.6,
  bid: 0.59,
  ask: 0.61,
  volume: 1_000,
  liquidity: 0,
  updatedAtMs: NOW * 1000,
  ...over,
});
const FED = entry("FED-C25", "Will the Fed cut rates in December?");
const DEAL = entry("DEAL", "Will the US and China sign a trade deal by Nov 30?", {
  endTime: new Date((NOW + 10 * DAY) * 1000).toISOString(),
  themes: ["us-china"],
  yes: 0.35,
  bid: 0.34,
  ask: 0.36,
});
const entries = new Map([FED, DEAL].map((e) => [e.id, e]));
const deployment = { chainId: 46630, books: getAddress(`0x${"b0".repeat(20)}`) };

test("opinions in people's words: the stock, its side, price, date and the events", () => {
  const ex = extract("If the Fed cuts in December, NVDA closes above $200 by Dec 19", [NVDA], NOW);
  expect(ex.stock?.u.symbol).toBe("NVDA");
  expect(ex.direction).toBe("above");
  expect(ex.price).toEqual({ usd: 200 });
  expect(ex.date).toBe("2026-12-19");
  expect(ex.clauses).toEqual(["the Fed cuts in December"]);
  // A move in percent, a direction word after the stock only, a crypto price in thousands.
  const spy = extract(
    "If CPI comes in under 3% and the Fed cuts, NVDA rallies 5% by Friday",
    [NVDA],
    NOW,
  );
  expect([spy.direction, spy.price, spy.date]).toEqual(["above", { percent: 5 }, "2026-11-06"]);
  expect(spy.clauses).toEqual(["CPI comes in under 3%", "the Fed cuts"]);
  const btc = extract("Bitcoin above 120k by end of November if the ETF flows keep up", [BTC], NOW);
  expect([btc.price, btc.date]).toEqual([{ usd: 120_000 }, "2026-11-30"]);
  // No stock: every clause is an event.
  expect(extract("Fed cuts in December and no government shutdown", [NVDA], NOW).clauses).toEqual([
    "Fed cuts in December",
    "no government shutdown",
  ]);
  expect(roundStrike(209.37 * 1.05)).toBe("220");
  expect(roundStrike(97_431)).toBe("97450");
});

test("without a model, each clause's best match is the draft, negations pick NO", async () => {
  const searched: string[] = [];
  const { draft, costMicros } = await readOpinion({
    id: "d1",
    text: "If the Fed doesn't cut in December and the trade deal happens, NVDA above $240",
    underlyings: [NVDA],
    spot: async () => 209.06,
    search: async (q) => {
      searched.push(q);
      return { hits: [/fed|cut/i.test(q) ? FED : DEAL].map((e) => ({ score: 1, entry: e })) };
    },
    assistant: { apiKey: null, model: "m", inputPrice: 1.6, outputPrice: 3.2, timeoutMs: 1_000 },
    budget: async () => true,
    nowS: NOW,
  });
  expect(costMicros).toBe(0);
  expect(draft.source).toBe("search");
  expect(draft.legs.map((l) => [l.entry.id, l.wantYes])).toEqual([
    [FED.id, false],
    [DEAL.id, true],
  ]);
  // The date: the first close after the last event, as none was given.
  expect(draft.stock).toMatchObject({ symbol: "NVDA", direction: "above", strike: "240" });
  expect(draft.stock!.date).toBe(nextClose(NOW + 20 * DAY).date);
});

/** A fake OpenRouter: answers each forced tool by name (in turn when given a list), records
 * every request, and reports `usage`. */
function openRouter(
  answers: Record<string, unknown>,
  usage: Record<string, number> = { cost: 0.001 },
) {
  const requests: {
    tool: string;
    body: { messages: { role: string; content: string }[] } & Record<string, unknown>;
    headers: Record<string, string>;
  }[] = [];
  const counts = new Map<string, number>();
  const fetcher = (async (url: string, init: RequestInit) => {
    expect(url).toBe(OPENROUTER_URL);
    const body = JSON.parse(String(init.body));
    const tool = body.tool_choice.function.name as string;
    requests.push({ tool, body, headers: init.headers as Record<string, string> });
    const n = (counts.get(tool) ?? 0) + 1;
    counts.set(tool, n);
    const answer = answers[tool];
    const args = Array.isArray(answer) ? answer[Math.min(n, answer.length) - 1] : answer;
    return Response.json({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: tool,
                  arguments: typeof args === "string" ? args : JSON.stringify(args),
                },
              },
            ],
          },
        },
      ],
      usage,
    });
  }) as unknown as typeof fetch;
  return { fetcher, requests };
}
const model = (fetcher: typeof fetch) => ({
  apiKey: "k",
  model: "deepseek/deepseek-v4-pro",
  inputPrice: 1.6,
  outputPrice: 3.2,
  timeoutMs: 1_000,
  fetch: fetcher,
});
const SENTENCE =
  "Trump and Xi sign a trade deal by the end of 2026 and there are no fed rate cuts by the end of this year, then NVDA will be up 10%";
const DJT: WorldUnderlying = {
  ...NVDA,
  underlying: "US:DJT",
  symbol: "DJT",
  name: "Trump Media & Technology Group",
};
const NOCUT = entry("NOCUT", "Will no Fed rate cuts happen in 2026?", {
  endTime: new Date((NOW + 57 * DAY) * 1000).toISOString(),
  yes: 0.97,
  bid: 0.96,
  ask: 0.98,
});

test("the model reads the opinion into events, searches their headlines, then picks among what they found", async () => {
  const CUT = { ...FED, group: "kalshi:FED", exclusive: true };
  const HOLD = entry("FED-H", "Will the Fed hold rates in December?", {
    group: "kalshi:FED",
    exclusive: true,
  });
  const HIKE = entry("FED-UP", "Will the Fed raise rates in December?", {
    group: "kalshi:FED",
    exclusive: true,
  });
  const or = openRouter({
    submit_reading: {
      events: [
        {
          says: "Trump and Xi sign a trade deal by the end of 2026",
          happens: true,
          queries: ["US China trade deal 2026", "Trump China trade deal"],
        },
        { says: "No Fed rate cuts this year", happens: false, queries: ["Fed rate cut 2026"] },
      ],
      stock: { symbol: "NVDA", direction: "above", price: null, percent: 10, date: null },
    },
    submit_world: {
      legs: [
        { id: DEAL.id, wantYes: true, fits: true, event: 1 },
        { id: CUT.id, wantYes: false, fits: true, event: 2, note: "Kalshi counts any cut" },
        // A second market for item 2, a second YES in one exclusive event, an id it was not
        // shown, and one it says is not about the words: all left out.
        { id: NOCUT.id, wantYes: true, fits: true, event: 2 },
        { id: HOLD.id, wantYes: true, fits: true, event: null },
        { id: HIKE.id, wantYes: true, fits: true, event: null },
        { id: "kalshi:INVENTED", wantYes: true, fits: true, event: 1 },
        { id: NOCUT.id, wantYes: true, fits: false, event: null },
      ],
      stock: { symbol: "NVDA", direction: "above", price: null, date: null },
    },
  });
  const searched: string[] = [];
  const { draft, costMicros } = await readOpinion({
    id: "d2",
    text: SENTENCE,
    underlyings: [NVDA, DJT],
    spot: async () => 200,
    search: async (q) => {
      searched.push(q);
      return {
        hits: (/china|trade/i.test(q) ? [DEAL] : [CUT, HOLD, HIKE, NOCUT]).map((e) => ({
          score: 10,
          coverage: 1,
          entry: e,
        })),
      };
    },
    assistant: model(or.fetcher),
    budget: async () => true,
    nowS: NOW,
    maxTenorS: 35 * DAY,
  });
  // Two calls: the reading, then the pick. The searches are the reading's headlines.
  expect(or.requests.map((r) => r.tool)).toEqual(["submit_reading", "submit_world"]);
  expect(searched.sort()).toEqual([
    "Fed rate cut 2026",
    "Trump China trade deal",
    "US China trade deal 2026",
  ]);
  for (const r of or.requests) {
    expect(r.headers.authorization).toBe("Bearer k");
    expect(r.body).toMatchObject({
      model: "deepseek/deepseek-v4-pro",
      temperature: 0,
      reasoning: { enabled: false },
      provider: { require_parameters: true },
    });
  }
  // The pick knows what each event is, and which way the trader sees it.
  expect(or.requests[1]!.body.messages[1]!.content).toContain(
    "2. No Fed rate cuts this year (does NOT happen)",
  );
  // Each call paid what OpenRouter reports.
  expect(costMicros).toBe(2_000);
  expect(draft.source).toBe("assistant");
  expect(draft.legs.map((l) => [l.entry.id, l.wantYes])).toEqual([
    [DEAL.id, true],
    [CUT.id, false],
    [HOLD.id, true],
  ]);
  expect(draft.legs[1]!.note).toBe("Kalshi counts any cut");
  // NVDA up 10% from $200; no date said: the first close after the events, within the tenor.
  expect(draft.stock).toMatchObject({
    symbol: "NVDA",
    direction: "above",
    strike: "220",
    date: nextClose(NOW + 20 * DAY).date,
  });
  expect(draft.notes).toEqual([]);
});

test("one market for each thing the opinion depends on", async () => {
  const HOT = entry("CPI-42", "How high will CPI get this year: Above 4.2%?");
  const HOTTER = entry("CPI-43", "How high will CPI get this year: Above 4.3%?");
  const or = openRouter({
    submit_reading: {
      events: [{ says: "Inflation doesn't run hot", happens: false, queries: ["CPI above"] }],
      stock: null,
    },
    submit_world: {
      legs: [
        { id: HOT.id, wantYes: false, fits: true, event: 1 },
        { id: HOTTER.id, wantYes: false, fits: true, event: 1 },
      ],
    },
  });
  const { draft } = await readOpinion({
    id: "d9",
    text: "If inflation doesn't come in hot, QQQ up",
    underlyings: [NVDA],
    spot: async () => 200,
    search: async () => ({ hits: [HOT, HOTTER].map((e) => ({ score: 9, coverage: 1, entry: e })) }),
    assistant: model(or.fetcher),
    budget: async () => true,
    nowS: NOW,
  });
  expect(draft.legs.map((l) => [l.entry.id, l.wantYes])).toEqual([[HOT.id, false]]);
});

test("what the model read but found no market for is named in the notes", async () => {
  const or = openRouter({
    submit_reading: {
      events: [
        { says: "The Fed cuts in December", happens: true, queries: ["Fed cut December"] },
        { says: "Trump and Xi sign a deal", happens: true, queries: ["US China trade deal"] },
      ],
      stock: null,
    },
    submit_world: { legs: [{ id: FED.id, wantYes: true, fits: true, event: 1 }] },
  });
  const { draft } = await readOpinion({
    id: "d5",
    text: "The Fed cuts in December and Trump and Xi sign a deal",
    underlyings: [NVDA],
    spot: async () => 200,
    search: async () => ({ hits: [{ score: 10, coverage: 1, entry: FED }] }),
    assistant: model(or.fetcher),
    budget: async () => true,
    nowS: NOW,
  });
  expect(draft.legs.map((l) => l.entry.id)).toEqual([FED.id]);
  expect(draft.notes).toEqual(["No market found for “Trump and Xi sign a deal”"]);
});

test("answers without a usable call fall back to the rules, and are still paid for", async () => {
  const or = openRouter(
    { submit_reading: "{not json", submit_world: "{not json" },
    { prompt_tokens: 1_000, completion_tokens: 200 },
  );
  const failures: string[] = [];
  const { draft, costMicros } = await readOpinion({
    id: "d3",
    text: "If the Fed cuts in December, NVDA above $240",
    underlyings: [NVDA],
    spot: async () => 209,
    search: async () => ({ hits: [{ score: 1, coverage: 1, entry: FED }] }),
    assistant: model(or.fetcher),
    budget: async () => true,
    nowS: NOW,
    log: (event, detail) => failures.push(`${event}:${detail.step}`),
  });
  // No reported cost: tokens at the configured prices, for both calls.
  expect(costMicros).toBe(2 * (1_000 * 1.6 + 200 * 3.2));
  expect(failures).toEqual(["worlds.assistant.failed:read", "worlds.assistant.failed:pick"]);
  expect(draft.source).toBe("search");
  expect(draft.legs.map((l) => [l.entry.id, l.wantYes])).toEqual([[FED.id, true]]);
});

test("when the model finds no fitting event, the draft has none and suggests instead", async () => {
  const or = openRouter({
    submit_reading: {
      events: [{ says: "A US–China trade deal", happens: true, queries: ["US China trade deal"] }],
      stock: { symbol: "NVDA", direction: "above", price: 240, percent: null, date: null },
    },
    submit_world: { legs: [], search: ["US China trade deal"] },
  });
  const { draft, costMicros } = await readOpinion({
    id: "d4",
    text: "If the US and China sign a trade deal, NVDA above $240",
    underlyings: [NVDA],
    spot: async () => 209,
    // The catalog's best match for the words is an unrelated event.
    search: async () => ({ hits: [{ score: 1, coverage: 0.25, entry: FED }] }),
    assistant: model(or.fetcher),
    budget: async () => true,
    nowS: NOW,
  });
  // The reading, a pick, one more search, a second pick: still nothing fits.
  expect(or.requests.map((r) => r.tool)).toEqual([
    "submit_reading",
    "submit_world",
    "submit_world",
  ]);
  expect(costMicros).toBe(3_000);
  expect(draft.source).toBe("assistant");
  expect(draft.legs).toEqual([]);
  expect(draft.suggestions.map((e) => e.id)).toEqual([FED.id]);
  expect(draft.stock).toMatchObject({ symbol: "NVDA", strike: "240" });
});

test("without a model, a clause's best match counts only when it is about the clause's words", async () => {
  const { draft } = await readOpinion({
    id: "d6",
    text: "If Xi signs a trade deal and the Fed cuts in December, NVDA above $240",
    underlyings: [NVDA],
    spot: async () => 209,
    search: async (q) =>
      /fed/i.test(q)
        ? { hits: [{ score: 9, coverage: 1, entry: FED }] }
        : // "Xi signs a trade deal": the best hit shares one word of four.
          { hits: [{ score: 9, coverage: 0.25, entry: DEAL }] },
    assistant: { apiKey: null, model: "m", inputPrice: 1.6, outputPrice: 3.2, timeoutMs: 1_000 },
    budget: async () => true,
    nowS: NOW,
  });
  expect(draft.legs.map((l) => l.entry.id)).toEqual([FED.id]);
});

test("rules: a common word is never a stock, and a date belongs to its own clause", async () => {
  const ex = extract(SENTENCE, [DJT, NVDA], NOW);
  // "Trump" is not Trump Media: the stock is the one the move follows.
  expect(ex.stock?.u.symbol).toBe("NVDA");
  expect([ex.direction, ex.price, ex.date]).toEqual(["above", { percent: 10 }, null]);
  expect(ex.clauses).toEqual([
    "Trump Xi sign a trade deal by the end of 2026",
    "there are no fed rate cuts by the end of this year",
  ]);
  expect(extract("Trump Media rallies 20%", [DJT, NVDA], NOW).stock?.u.symbol).toBe("DJT");
  expect(extract("NVDA above $250 by the end of the year", [NVDA], NOW).date).toBe("2026-12-31");
  // No date said: the first close after the events, but never past the vault's tenor.
  const { draft } = await readOpinion({
    id: "d7",
    text: SENTENCE,
    underlyings: [DJT, NVDA],
    spot: async () => 200,
    search: async () => ({ hits: [{ score: 9, coverage: 1, entry: NOCUT }] }),
    assistant: { apiKey: null, model: "m", inputPrice: 1.6, outputPrice: 3.2, timeoutMs: 1_000 },
    budget: async () => true,
    nowS: NOW,
    maxTenorS: 35 * DAY,
  });
  expect(draft.stock).toMatchObject({ symbol: "NVDA", strike: "220" });
  expect(draft.stock!.date).toBe(nextClose(NOW + 34 * DAY).date);
});

test("a stated price far from spot is not taken as the stock's", async () => {
  const GLD: WorldUnderlying = { ...NVDA, underlying: "US:GLD", symbol: "GLD", name: "SPDR Gold" };
  const or = openRouter({
    submit_reading: {
      events: [{ says: "The Fed holds", happens: true, queries: ["Fed hold December"] }],
      stock: { symbol: "GLD", direction: "above", price: 4500, percent: null, date: null },
    },
    submit_world: { legs: [{ id: FED.id, wantYes: false, fits: true, event: 1 }] },
  });
  const { draft } = await readOpinion({
    id: "d8",
    text: "gold above 4500 if the Fed doesn't cut",
    underlyings: [GLD],
    spot: async () => 372,
    search: async () => ({ hits: [{ score: 9, coverage: 1, entry: FED }] }),
    assistant: model(or.fetcher),
    budget: async () => true,
    nowS: NOW,
  });
  expect(draft.stock).toMatchObject({ symbol: "GLD", strike: roundStrike(372 * 1.05) });
  expect(draft.notes).toEqual(["GLD trades near $372: set the price you mean"]);
});

test("one opinion, one world: leg order and wording never change it", () => {
  const spec = parseSpec({
    legs: [
      { id: FED.id, wantYes: true },
      { id: DEAL.id, wantYes: true },
    ],
    stock: { underlying: "US:NVDA", direction: "above", strike: "240", date: "2026-12-18" },
  });
  const a = canonicalWorld(spec, entries, NVDA, deployment, 100);
  const b = canonicalWorld(
    { ...spec, legs: [...spec.legs].reverse() },
    entries,
    NVDA,
    deployment,
    100,
  );
  expect(a.specHash).toBe(b.specHash);
  // Legs by deadline: the deal (Nov 14) first.
  expect(a.legs.map((l) => l.entry.id)).toEqual([DEAL.id, FED.id]);
  expect(a.legs[0]!.eventKey).toBe(eventKey(DEAL.conditionId, 1, 2).toLowerCase() as `0x${string}`);
  expect(a.strikeRaw).toBe(24_000_000_000n);
  expect(a.fixingTime).toBe(closeOf("2026-12-18"));
  expect(a.cutoff).toBe(a.fixingTime - 3_600);
  expect(a.sentence).toBe(
    "If the US and China sign a trade deal by Nov 30 and the Fed cut rates in December, NVDA closes above $240 on Dec 18",
  );
  // Another side, strike or date is another world.
  const c = canonicalWorld(
    { ...spec, stock: { ...spec.stock!, strike: "250" } },
    entries,
    NVDA,
    deployment,
    100,
  );
  expect(c.specHash).not.toBe(a.specHash);
  expect(offerProducts(a)).toEqual({ allIn: "bet:above:1", moneyBack: "cond:above:1" });
});

test("4 pm New York, in and out of daylight time", () => {
  expect(new Date(closeOf("2026-11-02") * 1000).toISOString()).toBe("2026-11-02T21:00:00.000Z");
  expect(new Date(closeOf("2026-10-30") * 1000).toISOString()).toBe("2026-10-30T20:00:00.000Z");
  // Saturday 7 Nov: the next close is Monday's.
  expect(nextClose(Date.parse("2026-11-07T12:00:00Z") / 1000).date).toBe("2026-11-09");
});

test("problems stop a world before pricing: limits, decided legs, exclusive outcomes, tenor", () => {
  const limits = { maxLegs: 4, maxTenor: 35 * DAY, eventOnly: true };
  const spec = (legs: { id: string; wantYes: boolean }[], date = "2026-12-04") =>
    parseSpec({ legs, stock: { underlying: "US:NVDA", direction: "above", strike: "240", date } });
  const ok = canonicalWorld(spec([{ id: FED.id, wantYes: true }]), entries, NVDA, deployment, 100);
  expect(worldProblems(ok, limits, NOW)).toEqual([]);
  const decided = new Map(entries).set(FED.id, { ...FED, yes: 0.99, bid: 0.985, ask: 0.995 });
  expect(
    worldProblems(
      canonicalWorld(spec([{ id: FED.id, wantYes: true }]), decided, NVDA, deployment, 100),
      limits,
      NOW,
    ),
  ).toEqual(['"The Fed cut rates in December" is already almost decided (99%)']);
  const HOLD = entry("FED-H", "Will the Fed hold rates in December?", {
    group: "kalshi:FED",
    exclusive: true,
  });
  const both = new Map(entries)
    .set(FED.id, { ...FED, group: "kalshi:FED", exclusive: true })
    .set(HOLD.id, HOLD);
  const clash = canonicalWorld(
    spec([
      { id: FED.id, wantYes: true },
      { id: HOLD.id, wantYes: true },
    ]),
    both,
    NVDA,
    deployment,
    100,
  );
  expect(worldProblems(clash, limits, NOW)[0]).toContain("can't both happen");
  const far = canonicalWorld(
    spec([{ id: FED.id, wantYes: true }], "2027-01-29"),
    entries,
    NVDA,
    deployment,
    100,
  );
  expect(worldProblems(far, limits, NOW)[0]).toContain("within 35 days");
  expect(() =>
    canonicalWorld(
      spec([{ id: FED.id, wantYes: true }], "2026-12-19"),
      entries,
      NVDA,
      deployment,
      100,
    ),
  ).toThrow(OpinionError);
  expect(() => parseSpec({ legs: [] })).toThrow("at least one event");
  expect(() => parseSpec({ legs: [{ id: "nope" }] })).toThrow("Unknown event");
});

test("the offer: All-in pays its units if right, Money-back gives the stake back if the world fails", () => {
  const w = canonicalWorld(
    parseSpec({
      legs: [{ id: FED.id, wantYes: true }],
      stock: { underlying: "US:NVDA", direction: "above", strike: "240", date: "2026-12-18" },
    }),
    entries,
    NVDA,
    deployment,
    100,
  );
  // Atoms: the world fails (972), happens below $240 (18), happens above (10), per thousand.
  const offer = offerOf(w, {
    decline: null,
    marks: [972_000, 18_000, 10_000],
    analytics: null,
    priorOnly: false,
    products: [
      { key: "bet:above:1", stake: "20000000", units: "1538000000", ask: 13_000, decline: null },
      { key: "cond:above:1", stake: "100000000", units: "250000000", ask: 400_000, decline: null },
    ],
  });
  expect(offer.map((p) => p.name)).toEqual(["All-in", "Money-back"]);
  expect(offer[0]!.endings).toEqual([
    { key: "win", chance: 10_000, pays: "1538000000" },
    { key: "lose-in-world", chance: 18_000, pays: "0" },
    { key: "world-fails", chance: 972_000, pays: "0" },
  ]);
  expect(offer[1]!.endings.at(-1)).toEqual({
    key: "world-fails",
    chance: 972_000,
    pays: "100000000",
  });
  expect(outcomeMask({ kind: "above", strike: 1 }, 3)).toBe(0b100);
});

test("makers' reasons in plain words", () => {
  expect(friendlyDecline("A leg's venue spread is too wide")).toContain("too thin");
  expect(friendlyDecline("World bets under half a cent are not quoted")).toContain("too unlikely");
  expect(friendlyDecline("Over the per-fill limit")).toContain("smaller stake");
});

// ------------------------------------------------------------------ the hub

const maker = (n: number, worlds: boolean): MakerIdentity => ({
  id: `${String(n).repeat(8)}-0000-4000-8000-000000000000`,
  label: `maker ${n}`,
  wallet: getAddress(`0x${String(n).repeat(40)}`),
  worlds,
});
function session(
  hub: () => RfqHub,
  identity: MakerIdentity,
  answer: (m: Record<string, unknown>) => object | null,
) {
  const sent: Record<string, unknown>[] = [];
  const s: RfqSession & { sent: typeof sent } = {
    maker: identity,
    sent,
    send(message) {
      const m = message as Record<string, unknown>;
      sent.push(m);
      if (m.type === "world.preview") {
        const reply = answer(m);
        if (reply) queueMicrotask(() => hub().receive(s, JSON.stringify(reply)));
      }
      return true;
    },
    close() {},
  };
  return s;
}

test("a preview goes to world makers only; the first priced answer wins, all declining ends it", async () => {
  const hub = new RfqHub({ windowMs: 500, maxSessionsPerMaker: 2, welcome: () => ({}) });
  const id = "aaaaaaaa-1111-4111-8111-111111111111";
  const priced = {
    type: "world.previewed",
    id,
    marks: [600_000, 400_000],
    priorOnly: true,
    analytics: {
      legs: [],
      chain: [400_000],
      naive: [400_000],
      world: 400_000,
      spot: null,
      forward: null,
      move: null,
    },
    products: [
      { key: "bet:world", stake: "20000000", units: "48000000", ask: 416_000, decline: null },
    ],
  };
  const exchangeOnly = session(
    () => hub,
    maker(1, false),
    () => null,
  );
  const world = session(
    () => hub,
    maker(2, true),
    (m) => ({ ...priced, id: m.id }),
  );
  hub.attach(exchangeOnly);
  hub.attach(world);
  const answer = await hub.preview(id, { type: "world.preview", id }, 1_000);
  expect(answer?.products[0]?.units).toBe("48000000");
  expect(exchangeOnly.sent.some((m) => m.type === "world.preview")).toBe(false);
  // Every world maker declines: the decline comes back at once.
  const declining = new RfqHub({ windowMs: 500, maxSessionsPerMaker: 2, welcome: () => ({}) });
  const no = session(
    () => declining,
    maker(3, true),
    (m) => ({ type: "world.previewed", id: m.id, decline: "Spot is stale" }),
  );
  declining.attach(no);
  const started = performance.now();
  const declined = await declining.preview(id, { type: "world.preview", id }, 5_000);
  expect(declined?.decline).toBe("Spot is stale");
  expect(performance.now() - started).toBeLessThan(500);
  // No world maker online: null at once.
  expect(
    await new RfqHub({ windowMs: 500, maxSessionsPerMaker: 2, welcome: () => ({}) }).preview(
      id,
      {},
      5_000,
    ),
  ).toBeNull();
});
