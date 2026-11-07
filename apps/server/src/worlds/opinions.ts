/** Users' worlds (docs/version-2-plan.md §9, §11): a world starts as someone's opinion in their
 * own words, never as a market the protocol lists. These routes take it from words to a trade,
 * and make every traded world public:
 *
 * - `GET  /v2/worlds/stocks`          the stocks a world can fix on, with spot;
 * - `GET  /v2/worlds/events/search`   the event catalog (Polymarket and Kalshi);
 * - `GET  /v2/worlds/events/samples`  live Polymarket events the worlds page suggests, and the
 *                                       curated worlds it opens on, each priced;
 * - `POST /v2/worlds/parse`           an opinion read into a draft (the assistant);
 * - `POST /v2/worlds/preview`         a draft priced by the makers before it exists (one a
 *                                       person asked for, once quoted, is kept as explored);
 * - `GET  /v2/worlds/exploring`       the worlds people priced lately, nobody holds yet;
 * - `POST /v2/worlds/open`            a member opens the world (its book is created);
 * - `GET  /v2/worlds/open/:defHash`   whether the book exists yet;
 * - `GET  /v2/worlds/feed`            every world someone holds a position in (both lists take
 *                                       `?limit=`, the page's size, and say their `total`);
 * - `GET  /v2/books/:book/holders`    who holds what in a world (positions are public).
 *
 * Previews and fills are RFQ only: there is no order book. Searches, previews and the feed read
 * memory (the catalog, the replica, the makers' answers); the database is read for a world's
 * registration and, at most every few seconds, for activity totals and the explored worlds, and
 * explored worlds are written in batches off the preview's path. */
import { randomUUID } from "node:crypto";
import type { Database, WorldBookRecord } from "@conditional-stocks/db";
import { BOOK_STATE, productOf } from "@conditional-stocks/evm-client";
import { atomsOf, bookStateAt, type WorldState } from "@conditional-stocks/evm-client/world-ledger";
import type { WorldIndexer } from "@conditional-stocks/indexer/worlds";
import { positionView } from "@conditional-stocks/indexer/worlds";
import type { CatalogEntry } from "@conditional-stocks/market-data";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Address, getAddress, type Hex, type PublicClient } from "viem";
import type { Auth } from "../auth/routes.ts";
import { clientIp, RateLimiter } from "../common/rate-limit.ts";
import type { EventMarketsClient } from "../integrations/event-markets.ts";
import type { RfqHub } from "../rfq/hub.ts";
import { type AssistantOptions, readOpinion, type WorldDraft } from "./assistant.ts";
import { CURATED_WORLDS, curatedSpecs } from "./curated.ts";
import {
  ExplorationLog,
  type ExplorationWorld,
  explorationOf,
  exploringList,
} from "./explorations.ts";
import {
  type CanonicalWorld,
  canonicalWorld,
  legLabel,
  OpinionError,
  type OpinionSpec,
  offerOf,
  parseSpec,
  previewBook,
  type WorldUnderlying,
  worldNotes,
  worldProblems,
} from "./opinion.ts";
import type { WorldSpots } from "./underlyings.ts";

const seconds = () => Math.floor(Date.now() / 1000);
const json = (value: unknown) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
const PREVIEW_TIMEOUT_MS = 2_500;

/** A catalog entry as the app shows a leg. */
export const legEntry = (e: CatalogEntry) => ({
  id: e.id,
  source: e.source,
  marketId: e.marketId,
  question: e.question,
  label: legLabel(e.question),
  event: e.event,
  outcome: e.outcome,
  yes: e.yes,
  bid: e.bid,
  ask: e.ask,
  endTime: e.endTime,
  url: e.url,
  image: e.image,
  rules: e.rules.slice(0, 1_200),
  exclusive: e.exclusive,
  group: e.group,
  volume: Math.round(e.volume),
  themes: e.themes,
});

/** What the sample events are about: topics a stock's move is often argued from. Each gives
 * at most one event; the page alternates them between its two event slots. */
export const SAMPLE_TOPICS = [
  "US recession",
  "AI bubble",
  "Fed rate cut",
  "China invade Taiwan",
  "Ukraine ceasefire",
  "Bitcoin",
  "Iran",
  "OpenAI",
];
/** How long one set of sample events serves every visitor. */
const SAMPLES_TTL_MS = 10 * 60_000;
/** How soon a set without curated worlds is read again: pricing may just be starting (the
 * makers reconnect within a minute of a restart), and the page should not wait ten minutes. */
const SAMPLES_RETRY_MS = 30_000;
/** A sample is a market people follow: at least this much traded (USD). */
const SAMPLE_MIN_VOLUME = 100_000;
/** How long one read of the explored worlds serves every visitor. */
const EXPLORING_TTL_MS = 30_000;
/** The explored worlds listed: priced in the last this, trading at least ten minutes more. */
const EXPLORING_SINCE_MS = 14 * 86_400_000;
const EXPLORING_LIMIT = 48;
/** The feed's largest page. */
const FEED_LIMIT = 200;
/** A list's page size from `?limit=`: a whole number from 1 to `max`, else `max`. */
export function pageSize(value: string | undefined, max: number) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : max;
}

/** Live Polymarket events that show what a world can be made of: per topic, its most relevant
 * open market (the catalog's own order) that people trade ($100k+), that a maker prices (3–97%,
 * a two-sided book at most 5¢ wide), that is decided between two days from now and the vault's
 * tenor, and that reads as one plain event (no "between X and Y" or "exactly N" bucket); one
 * market per venue event. */
export function sampleEvents(
  hitsByTopic: readonly (readonly CatalogEntry[])[],
  nowMs: number,
  maxTenorSeconds: number,
) {
  const groups = new Set<string>();
  const out: CatalogEntry[] = [];
  for (const hits of hitsByTopic) {
    const pick = hits.find((e) => {
      const end = Date.parse(e.endTime);
      return (
        e.source === "polymarket" &&
        e.yes !== null &&
        e.yes >= 0.03 &&
        e.yes <= 0.97 &&
        e.bid !== null &&
        e.ask !== null &&
        e.ask - e.bid <= 0.05 &&
        e.volume >= SAMPLE_MIN_VOLUME &&
        Number.isFinite(end) &&
        end >= nowMs + 2 * 86_400_000 &&
        end <= nowMs + maxTenorSeconds * 1000 &&
        !/\bbetween\b.*\band\b|\bexactly\b/i.test(e.question) &&
        !groups.has(e.group)
      );
    });
    if (!pick) continue;
    groups.add(pick.group);
    out.push(pick);
  }
  return out;
}

/** A maker's reason for not pricing, as a person would say it; a thin market is named from the
 * world's legs (their venue prices, just read). */
export function friendlyDecline(
  reason: string,
  legs: readonly { label: string; entry: { bid: number | null; ask: number | null } }[] = [],
) {
  const r = reason.toLowerCase();
  if (/spread is too wide|no live probability/.test(r)) {
    const cents = (p: number) => `${Math.round(p * 100)}¢`;
    const unpriced = legs.find((l) => l.entry.bid === null || l.entry.ask === null);
    if (unpriced)
      return `"${unpriced.label}" has no live price on its venue: pick another market for it`;
    const widest = legs
      .filter((l) => l.entry.bid !== null && l.entry.ask !== null)
      .sort((a, b) => b.entry.ask! - b.entry.bid! - (a.entry.ask! - a.entry.bid!))[0];
    if (widest && /spread/.test(r))
      return `"${widest.label}" trades too thinly to price (bid ${cents(widest.entry.bid!)}, ask ${cents(widest.entry.ask!)}): pick a busier market for it`;
    return "One event's market is too thin to price right now";
  }
  if (/outside the quoted range|almost decided/.test(r))
    return "One event is already almost decided";
  if (/half a cent/.test(r))
    return "This world is too unlikely to quote: add a likelier event or drop one";
  if (/conditional markup/.test(r))
    return "Not offered for this world yet: the stock's move inside it is too uncertain to price fairly";
  if (/too uncertain/.test(r))
    return "We can't price this combination fairly yet: try fewer or different events";
  if (/resolves soon|cutoff|clock/.test(r)) return "An event is decided too soon to trade";
  if (/spot|feed/.test(r)) return "The stock's price feed is unavailable right now";
  if (/ineligible|tenor/.test(r)) return "The vault does not quote worlds like this yet";
  if (/limit|cap|budget|capital|kelly|floor|exposure/.test(r))
    return "That's more than the vault can take on right now: try a smaller stake";
  if (/paused|halt|drawdown|stopping|not followed|unavailable|not ready/.test(r))
    return "Pricing is paused right now. Try again in a minute";
  return "We can't quote this world right now";
}

export function mountOpinions(
  app: Hono,
  options: {
    indexer: WorldIndexer;
    db: Database;
    auth: Auth;
    client: PublicClient;
    hub: RfqHub | null;
    /** The event catalog's client. */
    catalog: () => EventMarketsClient;
    underlyings: WorldUnderlying[];
    spots: WorldSpots;
    assistant: AssistantOptions & { dailyBudgetUsd: number };
    feeBps: number;
    /** Raw units per whole quote token. */
    quoteUnit: bigint;
    trustedHops: number;
    prepareUserBook: (w: CanonicalWorld, creator: Address) => Promise<WorldBookRecord>;
    log: (event: string, detail: Record<string, unknown>) => void;
  },
) {
  const { indexer, db, auth, hub, catalog, spots, feeBps, quoteUnit } = options;
  const domain = indexer.domain;
  const parses = new RateLimiter(30, 3_600_000);
  const previews = new RateLimiter(900, 3_600_000);
  const searches = new RateLimiter(900, 3_600_000);
  const opens = new RateLimiter(20, 3_600_000);
  const ip = (c: Context) => clientIp(c, options.trustedHops);
  const explorations = new ExplorationLog({
    write: (notes) => db.recordWorldExplorations(domain, notes),
    log: options.log,
  });
  /** The curated worlds' spec hashes lately shown: the worlds page's own examples, not anyone's
   * opinion, so they are not kept as explored. */
  const curatedHashes = new Set<string>();
  const fail = (error: unknown): never => {
    if (error instanceof OpinionError)
      throw new HTTPException(error.status, { message: error.message });
    throw error;
  };

  /** The vault's limits and the feeds it quotes against (the first vault's, as the keeper's). */
  const vaultTerms = (s: WorldState) => {
    const v = [...s.vaults.values()][0];
    return {
      limits: v?.limits
        ? { maxLegs: v.limits.maxLegs, maxTenor: v.limits.maxTenor, eventOnly: v.limits.eventOnly }
        : null,
      feeds: new Set(v?.feeds ?? []),
    };
  };
  const eligible = (s: WorldState) => {
    const { feeds } = vaultTerms(s);
    return options.underlyings.filter((u) => feeds.has(u.feed));
  };
  const underlyingOf = (s: WorldState, spec: OpinionSpec) =>
    spec.stock ? (eligible(s).find((u) => u.underlying === spec.stock!.underlying) ?? null) : null;

  /** An opinion's canonical world, from fresh catalog prices. */
  const worldOf = async (spec: OpinionSpec) => {
    const s = indexer.trading();
    const { entries } = await catalog().catalogEntries(
      spec.legs.map((l) => l.id),
      true,
    );
    const byId = new Map(entries.map((e) => [e.id, e]));
    const d = indexer.deployment;
    const w = canonicalWorld(
      spec,
      byId,
      underlyingOf(s, spec),
      { chainId: d.chainId, books: d.books },
      feeBps,
    );
    return { s, w, problems: worldProblems(w, vaultTerms(s).limits, seconds()) };
  };
  const worldView = (w: CanonicalWorld, spot: number | null) => ({
    sentence: w.sentence,
    specHash: w.specHash,
    legs: w.legs.map((l) => ({ ...legEntry(l.entry), wantYes: l.wantYes, eventKey: l.eventKey })),
    stock: w.underlying
      ? {
          underlying: w.underlying.underlying,
          symbol: w.underlying.symbol,
          name: w.underlying.name,
          kind: w.underlying.kind,
          logo: w.underlying.logo,
          decimals: w.underlying.decimals,
          direction: w.direction,
          strike: w.strike,
          date: w.fixingDate,
          spot,
        }
      : null,
    fixingTime: w.fixingTime || null,
    cutoff: w.cutoff,
    feeBps: w.feeBps,
  });
  /** The registered world of a spec (cached briefly: a preview per edit reads it once). */
  const registered = new Map<string, { at: number; record: WorldBookRecord | null }>();
  const registration = async (specHash: string) => {
    const hit = registered.get(specHash);
    if (hit && Date.now() - hit.at < 10_000) return hit.record;
    const record = (await db.userWorldBook(domain, specHash)) ?? null;
    if (registered.size > 5_000) registered.clear();
    registered.set(specHash, { at: Date.now(), record });
    return record;
  };
  const stakeOf = (value: unknown, fallback: bigint) => {
    if (value === undefined || value === null) return fallback;
    const text = String(value);
    if (!/^\d{1,9}(\.\d{1,6})?$/.test(text))
      throw new HTTPException(400, { message: "Stakes are whole dollars, like 25" });
    const [whole, fraction = ""] = text.split(".");
    const raw =
      BigInt(whole!) * quoteUnit +
      (BigInt(fraction.padEnd(6, "0").slice(0, 6)) * quoteUnit) / 1_000_000n;
    if (raw <= 0n) throw new HTTPException(400, { message: "Give a stake above zero" });
    return raw;
  };

  // ---------------------------------------------------------------- reads

  let stocksMemo: { at: number; body: string } | null = null;
  app.get("/v2/worlds/stocks", async (c) => {
    if (!stocksMemo || Date.now() - stocksMemo.at > 15_000) {
      const state = indexer.trading();
      const list = eligible(state);
      const spot = await spots.all(list);
      stocksMemo = {
        at: Date.now(),
        body: json({
          // How far ahead a world's stock can be read (and an events-only world can trade), in
          // seconds: the vault's tenor, which the date picker follows.
          maxTenor: vaultTerms(state).limits?.maxTenor ?? null,
          stocks: list.map((u) => ({
            underlying: u.underlying,
            symbol: u.symbol,
            name: u.name,
            kind: u.kind,
            logo: u.logo,
            spot: spot.get(u.underlying) ?? null,
          })),
        }),
      };
    }
    c.header("Cache-Control", "public, max-age=10");
    return c.body(stocksMemo.body, 200, { "content-type": "application/json" });
  });

  app.get("/v2/worlds/events/search", async (c) => {
    searches.enforce(c, `search:${ip(c)}`);
    const q = (c.req.query("q") ?? "").trim().slice(0, 200);
    if (q.length < 2) return c.json({ events: [] });
    // Any market the catalog keeps: an event may be decided long after a world's stock fixes.
    const result = await catalog().searchCatalog(q, { limit: 12 });
    return c.json({ events: result.hits.map((h) => legEntry(h.entry)) });
  });

  // The worlds page's placeholder events and the curated worlds it opens on: one read of the
  // catalog (and one price of each curated world) serves every visitor for ten minutes
  // (concurrent misses share it); a failed read keeps the last set.
  let samples: { at: number; ttl: number; body: string } | null = null;
  let sampling: Promise<void> | null = null;
  /** The curated worlds that can be shown now, each with what it pays (the preview's body): a
   * world the makers decline, or price with a problem, is left out, and fewer than two show
   * none (the page then cycles single events). */
  const readCurated = async (state: WorldState, maxTenor: number) => {
    const list = eligible(state).filter((u) =>
      CURATED_WORLDS.some((w) => w.underlying === u.underlying),
    );
    const ids = [...new Set(CURATED_WORLDS.flatMap((w) => w.legs))];
    const [{ entries }, spot] = await Promise.all([
      catalog().catalogEntries(ids, true),
      spots.all(list),
    ]);
    const tradable = new Set(list.map((u) => u.underlying));
    const shown = curatedSpecs(
      CURATED_WORLDS.filter((w) => tradable.has(w.underlying)),
      new Map(entries.map((e) => [e.id, e])),
      spot,
      Date.now(),
      maxTenor,
    );
    const priced = await Promise.all(
      shown.map(({ spec }) => previewOf(spec, 20n * quoteUnit, 100n * quoteUnit).catch(() => null)),
    );
    // Each priced world with its story and its events' short names (the one-tap buttons).
    for (const p of priced) {
      if (!p) continue;
      curatedHashes.delete(p.world.specHash.toLowerCase());
      curatedHashes.add(p.world.specHash.toLowerCase());
    }
    while (curatedHashes.size > 200) curatedHashes.delete(curatedHashes.values().next().value!);
    const worlds = shown.flatMap(({ world }, i) => {
      const p = priced[i];
      const quoted =
        p &&
        p.problems.length === 0 &&
        (p.offer ?? []).some((o) => o.name === "All-in" && !o.decline);
      return quoted ? [{ ...p, curated: { story: world.story, short: world.short } }] : [];
    });
    return worlds.length >= 2 ? worlds : [];
  };
  const readSamples = async () => {
    const state = indexer.trading();
    const maxTenor = vaultTerms(state).limits?.maxTenor ?? 365 * 86_400;
    const [hits, worlds] = await Promise.all([
      Promise.all(
        SAMPLE_TOPICS.map((t) =>
          catalog()
            .searchCatalog(t, { limit: 12, source: "polymarket" })
            .then((r) => r.hits.map((h) => h.entry)),
        ),
      ),
      readCurated(state, maxTenor).catch(() => []),
    ]);
    samples = {
      at: Date.now(),
      ttl: worlds.length || !CURATED_WORLDS.length ? SAMPLES_TTL_MS : SAMPLES_RETRY_MS,
      body: json({ events: sampleEvents(hits, Date.now(), maxTenor).map(legEntry), worlds }),
    };
  };
  app.get("/v2/worlds/events/samples", async (c) => {
    if (!samples || Date.now() - samples.at > samples.ttl) {
      sampling ??= readSamples().finally(() => {
        sampling = null;
      });
      await sampling.catch(() => {});
    }
    // A first read that failed leaves none: the page shows its own placeholder.
    if (!samples) return c.json({ events: [], worlds: [] });
    c.header("Cache-Control", "public, max-age=60");
    return c.body(samples.body, 200, { "content-type": "application/json" });
  });

  /** The assistant's spend today against its budget. */
  let spent = { day: -1, micros: 0 };
  const budget = async () => {
    const day = Math.floor(Date.now() / 86_400_000);
    if (spent.day !== day) {
      spent = {
        day,
        micros: await db.worldDraftCost(domain, new Date(day * 86_400_000)).catch(() => 0),
      };
    }
    return spent.micros < options.assistant.dailyBudgetUsd * 1e6;
  };

  app.post("/v2/worlds/parse", async (c) => {
    parses.enforce(
      c,
      `parse:${ip(c)}`,
      "You've read a lot of opinions this hour. Try again later.",
    );
    const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
    const text = String(body.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 6)
      throw new HTTPException(400, { message: "Say a bit more about your view" });
    if (text.length > 600)
      throw new HTTPException(400, { message: "Keep it under 600 characters" });
    const owner = await auth
      .session(c)
      .then((s) => s.owner)
      .catch(() => null);
    const state = indexer.trading();
    const list = eligible(state);
    const id = randomUUID();
    const { draft, costMicros } = await readOpinion({
      id,
      text,
      underlyings: list,
      spot: (u) => spots.usd(u),
      search: (q, o) => catalog().searchCatalog(q, o ?? {}),
      assistant: options.assistant,
      budget,
      nowS: seconds(),
      maxTenorS: vaultTerms(state).limits?.maxTenor ?? null,
      log: options.log,
    });
    spent.micros += costMicros;
    void db
      .recordWorldDraft(domain, {
        id,
        owner,
        input: text,
        draft: { ...draft, legs: draft.legs.map((l) => ({ id: l.entry.id, wantYes: l.wantYes })) },
        model: draft.model,
        costMicros,
      })
      .catch((error) => options.log("worlds.draft.audit.failed", { error: String(error) }));
    return c.json(draftView(draft));
  });

  /** What a world pays at two stakes, as the makers price it now (the preview's body). */
  const previewOf = async (spec: OpinionSpec, allIn: bigint, moneyBack: bigint) => {
    const { s, w, problems } = await worldOf(spec);
    const spot = w.underlying ? await spots.usd(w.underlying) : null;
    const record = await registration(w.specHash);
    const book = record ? (s.bookOf.get(record.defHash.toLowerCase() as Hex) ?? null) : null;
    const base = {
      world: worldView(w, spot),
      notes: worldNotes(w),
      existing: record ? { defHash: record.defHash, book } : null,
    };
    if (problems.length) return { ...base, problems, offer: null, chance: null };
    const id = randomUUID();
    const answer = hub
      ? await hub.preview(
          id,
          {
            type: "world.preview",
            id,
            book: previewBook(
              w,
              spot === null || !w.underlying ? null : spot * 10 ** w.underlying.decimals,
            ),
            stakes: { allIn: allIn.toString(), moneyBack: moneyBack.toString() },
          },
          PREVIEW_TIMEOUT_MS,
        )
      : null;
    if (!answer)
      return {
        ...base,
        problems: ["Pricing is offline right now. Try again in a minute"],
        offer: null,
        chance: null,
      };
    if (answer.decline)
      return {
        ...base,
        problems: [friendlyDecline(answer.decline, w.legs)],
        offer: null,
        chance: null,
      };
    const offer = offerOf(w, answer).map((p) => ({
      ...p,
      decline: p.decline ? friendlyDecline(p.decline, w.legs) : null,
    }));
    return {
      ...base,
      problems: [],
      offer,
      chance: answer.analytics,
      priorOnly: answer.priorOnly,
      marks: answer.marks,
    };
  };

  app.post("/v2/worlds/preview", async (c) => {
    previews.enforce(c, `preview:${ip(c)}`);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const spec = (() => {
      try {
        return parseSpec(body.spec);
      } catch (error) {
        return fail(error);
      }
    })();
    const stakes = body.stakes as Record<string, unknown> | undefined;
    const allIn = stakeOf(stakes?.allIn, 20n * quoteUnit),
      moneyBack = stakeOf(stakes?.moneyBack, 100n * quoteUnit);
    const preview = await previewOf(spec, allIn, moneyBack).catch(fail);
    // A world a person asked to price (the app says so), once a maker quotes it, is explored.
    if (body.explore === true) {
      const explored = explorationOf(spec, preview);
      if (explored && !curatedHashes.has(explored.specHash)) explorations.note(explored, ip(c));
    }
    return c.json(preview);
  });

  // The worlds people priced lately, for everyone: one read of the table (and one of the
  // catalog's memory, for each event's chance now) serves every visitor for half a minute.
  let exploring: { at: number; worlds: unknown[]; bodies: Map<number, string> } | null = null;
  let exploringRead: Promise<void> | null = null;
  const readExploring = async () => {
    const nowMs = Date.now();
    const rows = await db.worldExplorations(domain, {
      since: new Date(nowMs - EXPLORING_SINCE_MS),
      tradingAfter: Math.floor(nowMs / 1000) + 600,
      limit: EXPLORING_LIMIT * 2,
    });
    // Worlds someone holds a position in are in the live feed instead.
    const s = indexer.trading();
    const traded = new Set<string>();
    for (const r of indexer.metadataRecords()) {
      if (r.kind !== "user" || !r.specHash) continue;
      const id = s.bookOf.get(r.defHash.toLowerCase() as Hex);
      if (id && (s.books.get(id)?.fills ?? 0) > 0) traded.add(r.specHash.toLowerCase());
    }
    const ids = [
      ...new Set(rows.flatMap((r) => (r.world as ExplorationWorld).legs.map((l) => l.id))),
    ];
    const { entries } = ids.length
      ? await catalog().catalogEntries(ids, false)
      : { entries: [] as CatalogEntry[] };
    exploring = {
      at: Date.now(),
      worlds: exploringList(rows, {
        traded,
        entries: new Map(entries.map((e) => [e.id, e])),
        nowMs,
        limit: EXPLORING_LIMIT,
      }),
      bodies: new Map(),
    };
  };
  app.get("/v2/worlds/exploring", async (c) => {
    // As many as the page shows (the worlds page four, its full list a page at a time).
    const limit = pageSize(c.req.query("limit"), EXPLORING_LIMIT);
    if (!exploring || Date.now() - exploring.at > EXPLORING_TTL_MS) {
      exploringRead ??= readExploring().finally(() => {
        exploringRead = null;
      });
      await exploringRead.catch((error) =>
        options.log("worlds.exploring.read.failed", { error: String(error) }),
      );
    }
    // A first read that failed leaves none: the page leaves the section out.
    if (!exploring) return c.json({ worlds: [], total: 0 });
    let body = exploring.bodies.get(limit);
    if (body === undefined) {
      body = json({ worlds: exploring.worlds.slice(0, limit), total: exploring.worlds.length });
      exploring.bodies.set(limit, body);
    }
    c.header("Cache-Control", "public, max-age=30");
    return c.body(body, 200, { "content-type": "application/json" });
  });

  // ---------------------------------------------------------------- opening a world

  app.post("/v2/worlds/open", async (c) => {
    const { owner } = await auth.trader(c);
    opens.enforce(c, `open:${owner}`, "You've opened a lot of worlds this hour. Try again later.");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    let spec: OpinionSpec;
    try {
      spec = parseSpec(body.spec);
    } catch (error) {
      return fail(error);
    }
    const { s, w, problems } = await worldOf(spec).catch(fail);
    if (problems.length) throw new HTTPException(422, { message: problems[0]! });
    const known = await registration(w.specHash);
    if (
      !known &&
      (await db.userWorldBooksSince(domain, owner, new Date(Date.now() - 86_400_000))) >= 40
    )
      throw new HTTPException(429, {
        message: "You've opened 40 worlds today. Trade one of them, or try tomorrow.",
      });
    const record = known ?? (await options.prepareUserBook(w, getAddress(owner)).catch(fail));
    registered.set(w.specHash, { at: Date.now(), record });
    const book = s.bookOf.get(record.defHash.toLowerCase() as Hex) ?? null;
    return c.json({
      defHash: record.defHash,
      specHash: w.specHash,
      book,
      status: book ? "live" : "creating",
    });
  });

  /** Whether an opened world's book exists yet (memory only: the app polls it). */
  app.get("/v2/worlds/open/:defHash", (c) => {
    const hash = c.req.param("defHash").toLowerCase() as Hex;
    if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new HTTPException(400, { message: "Invalid hash" });
    const s = indexer.trading();
    const book = s.bookOf.get(hash) ?? null;
    const b = book ? s.books.get(book) : undefined;
    c.header("Cache-Control", "no-store");
    return c.json({
      book,
      status: book ? "live" : indexer.meta(hash) ? "creating" : "unknown",
      tradable: Boolean(
        b && bookStateAt(s, b, BigInt(seconds())) === BOOK_STATE.trading && !s.config.paused,
      ),
    });
  });

  // ---------------------------------------------------------------- public worlds

  let activity: {
    at: number;
    books: Map<number, { traders: number; staked: bigint; fills: number; last: bigint }>;
    recent: Awaited<ReturnType<WorldIndexer["fills"]>>;
  } | null = null;
  const activityOf = async () => {
    if (activity && Date.now() - activity.at < 5_000) return activity;
    const [rows, recent] = await Promise.all([
      db.worldBookActivity(domain),
      indexer.fills({ limit: 200 }),
    ]);
    const books = new Map(rows.map((r) => [r.book, r]));
    // Fills the database has not stored yet count too.
    const seen = new Set<string>();
    for (const f of indexer.unpersistedFills()) {
      if (seen.has(`${f.transactionHash}:${f.logIndex}`)) continue;
      seen.add(`${f.transactionHash}:${f.logIndex}`);
      const b = books.get(f.book) ?? { book: f.book, traders: 0, staked: 0n, fills: 0, last: 0n };
      b.fills++;
      if (!f.sell) b.staked += BigInt(f.price);
      if (BigInt(f.time) > b.last) b.last = BigInt(f.time);
      b.traders = Math.max(b.traders, 1);
      books.set(f.book, b);
    }
    activity = { at: Date.now(), books, recent };
    return activity;
  };
  const vaultSet = (s: WorldState) => new Set([...s.vaults.keys()].map((v) => v.toLowerCase()));
  const productName = (refund: string) => (BigInt(refund) > 0n ? "Money-back" : "All-in");

  /** Recent feed answers by sort, stock, page size and replica revision (a few seconds each). */
  const feedMemo = new Map<string, { at: number; body: string }>();
  app.get("/v2/worlds/feed", async (c) => {
    const sort = c.req.query("sort") ?? "live";
    const underlying = c.req.query("underlying") ?? "";
    // As many as the page shows (the worlds page four, its full list a page at a time).
    const limit = pageSize(c.req.query("limit"), FEED_LIMIT);
    const key = `${sort}:${underlying}:${limit}:${indexer.follower.revision}`;
    const memo = feedMemo.get(key);
    if (memo && Date.now() - memo.at < 3_000)
      return c.body(memo.body, 200, { "content-type": "application/json" });
    const s = indexer.trading();
    const now = BigInt(seconds());
    const act = await activityOf();
    const vaults = vaultSet(s);
    // Who is in a world now: every holder of its atoms but the vaults (live, from the replica).
    const holders = new Map<number, number>();
    for (const [key, balances] of s.holdings) {
      const at = key.indexOf(":");
      if (vaults.has(key.slice(at + 1).toLowerCase()) || !balances.some((v) => v > 0n)) continue;
      const book = Number(key.slice(0, at));
      holders.set(book, (holders.get(book) ?? 0) + 1);
    }
    const latest = new Map<number, typeof act.recent>();
    for (const f of act.recent) {
      if (vaults.has(f.taker.toLowerCase())) continue;
      const list = latest.get(f.book) ?? [];
      if (list.length < 3) list.push(f);
      latest.set(f.book, list);
    }
    // Every traded world's stock, whatever is filtered or shown: the page's stock filter.
    const underlyings = new Map<string, string>();
    const worlds = indexer
      .metadataRecords()
      .filter((r) => r.kind === "user")
      .flatMap((r) => {
        const id = s.bookOf.get(r.defHash.toLowerCase() as Hex);
        const b = id ? s.books.get(id) : undefined;
        if (!id || !b || b.fills === 0) return [];
        if (r.metadata.underlying && r.metadata.opinion?.symbol)
          underlyings.set(r.metadata.underlying, r.metadata.opinion.symbol);
        if (underlying && r.metadata.underlying !== underlying) return [];
        const view = indexer.book(id)!;
        const stats = act.books.get(id);
        return [
          {
            book: id,
            defHash: r.defHash,
            sentence: r.metadata.opinion?.sentence ?? r.title,
            opinion: r.metadata.opinion ?? null,
            creator: r.creator ?? null,
            state: view.state,
            tradable: view.tradable,
            decided: bookStateAt(s, b, now) >= BOOK_STATE.failed,
            legs: view.legs.map((l) => ({
              eventKey: l.eventKey,
              wantYes: l.wantYes,
              state: l.state,
              outcome: l.outcome,
              label: l.venue ? legLabel(l.venue.question) : null,
              source: l.venue?.source ?? null,
              endTime: l.venue?.endTime ?? null,
              chance: view.analytics?.legs.find((x) => x.eventKey === l.eventKey)?.chance ?? null,
            })),
            underlying: view.underlying,
            fixingTime: view.fixingTime,
            cutoff: view.cutoff,
            marks: view.marks,
            analytics: view.analytics,
            products: view.products,
            traders: holders.get(id) ?? 0,
            staked: (stats?.staked ?? b.volume).toString(),
            fills: stats?.fills ?? b.fills,
            lastAt: (stats?.last ?? b.createdAt).toString(),
            createdAt: b.createdAt.toString(),
            latest: (latest.get(id) ?? []).map((f) => ({
              taker: f.taker,
              product: productName(f.refund),
              sell: f.sell,
              price: f.price,
              time: f.time,
            })),
          },
        ];
      });
    const order: Record<
      string,
      (a: (typeof worlds)[number], b: (typeof worlds)[number]) => number
    > = {
      live: (a, b) => Number(b.lastAt) - Number(a.lastAt),
      soon: (a, b) => Number(a.cutoff) - Number(b.cutoff),
      backed: (a, b) => (BigInt(b.staked) > BigInt(a.staked) ? 1 : -1),
      new: (a, b) => Number(b.createdAt) - Number(a.createdAt),
    };
    worlds.sort(
      (a, b) => Number(a.decided) - Number(b.decided) || (order[sort] ?? order.live!)(a, b),
    );
    const body = json({
      worlds: worlds.slice(0, limit),
      total: worlds.length,
      underlyings: [...underlyings].map(([u, symbol]) => ({ underlying: u, symbol })),
      block: s.block.toString(),
    });
    if (feedMemo.size >= 64) feedMemo.clear();
    feedMemo.set(key, { at: Date.now(), body });
    c.header("Cache-Control", "no-store");
    return c.body(body, 200, { "content-type": "application/json" });
  });

  /** Everyone's position in a world: positions are public, as fills are on chain. */
  const holdersMemo = new Map<string, string>();
  app.get("/v2/books/:book/holders", async (c) => {
    const id = Number(c.req.param("book"));
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new HTTPException(400, { message: "Invalid book" });
    const s = indexer.trading();
    const b = s.books.get(id);
    if (!b) throw new HTTPException(404, { message: "Unknown world" });
    const key = `${id}:${indexer.follower.revision}`;
    const cached = holdersMemo.get(key);
    if (cached) return c.body(cached, 200, { "content-type": "application/json" });
    const vaults = vaultSet(s);
    const fills = await indexer.fills({ books: [id], limit: 1_000 });
    const paid = new Map<
      string,
      { paid: bigint; received: bigint; since: bigint; refund: bigint }
    >();
    for (const f of fills) {
      const owner = f.taker.toLowerCase();
      if (vaults.has(owner)) continue;
      const p = paid.get(owner) ?? { paid: 0n, received: 0n, since: BigInt(f.time), refund: 0n };
      if (f.sell) p.received += BigInt(f.price);
      else {
        p.paid += BigInt(f.price) + BigInt(f.fee);
        p.refund += BigInt(f.refund);
      }
      if (BigInt(f.time) < p.since) p.since = BigInt(f.time);
      paid.set(owner, p);
    }
    const now = BigInt(seconds());
    const prices = indexer.prices;
    const holders = [];
    for (const [holding] of s.holdings) {
      if (!holding.startsWith(`${id}:`)) continue;
      const owner = getAddress(holding.slice(holding.indexOf(":") + 1));
      if (vaults.has(owner.toLowerCase())) continue;
      const balances = atomsOf(s, id, owner);
      if (!balances.some((v) => v > 0n)) continue;
      const view = positionView(s, b, balances, now, prices);
      const p = paid.get(owner.toLowerCase());
      const named = view.layers.map((l) => {
        const product = productOf(
          { mask: l.mask, units: BigInt(l.units), refund: BigInt(view.refund) },
          b.atoms,
        );
        return { outcome: product.outcome, units: l.units };
      });
      holders.push({
        owner,
        product: BigInt(view.refund) > 0n ? "Money-back" : "All-in",
        outcomes: named,
        refund: view.refund,
        maxPayout: view.maxPayout,
        value: view.value,
        paid: (p?.paid ?? 0n).toString(),
        received: (p?.received ?? 0n).toString(),
        since: (p?.since ?? b.createdAt).toString(),
      });
    }
    holders.sort((x, y) => (BigInt(y.paid) > BigInt(x.paid) ? 1 : -1));
    const body = json({ book: id, holders, traders: holders.length });
    if (holdersMemo.size > 500) holdersMemo.clear();
    holdersMemo.set(key, body);
    return c.body(body, 200, { "content-type": "application/json" });
  });

  return {
    /** Writes the explorations still held (before the database closes). */
    stop: async () => {
      explorations.stop();
      await explorations.flush();
    },
  };
}

/** A draft as the app shows it. */
export function draftView(d: WorldDraft) {
  return {
    id: d.id,
    text: d.text,
    source: d.source,
    legs: d.legs.map((l) => ({
      ...legEntry(l.entry),
      wantYes: l.wantYes,
      note: l.note,
      alternatives: l.alternatives.map(legEntry),
    })),
    stock: d.stock,
    suggestions: d.suggestions.map(legEntry),
    notes: d.notes,
  };
}
