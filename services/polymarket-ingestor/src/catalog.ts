/** The event catalog (docs/version-2-plan.md §9, §10.3): every open Polymarket and Kalshi
 * market a world could use as a leg, searchable by the words people use for it. Users describe
 * a world in their own words; the API's assistant turns those words into legs with this search.
 *
 * - Crawled every `everyMs` from the venues' public listings: Kalshi's open events with their
 *   markets, Gamma's active events by 24-hour volume. Sports, entertainment and weather are left
 *   out, and so is anything closing within the hour or past the horizon. Every page of both
 *   listings is read (Kalshi by cursor, Gamma by keyset cursor: its offsets stop at about 2,000
 *   events), so a market is found whatever its volume.
 * - Kept in memory with an inverted index; a search reads no venue and no database.
 * - `fresh(ids)` refreshes the prices of a few entries (a tracked leg's live book, else one
 *   venue read each, at most once every 20 seconds per entry) for previews. */
import {
  type CatalogEntry,
  type CatalogSource,
  kalshiConditionId,
  RequestPacer,
} from "@conditional-stocks/market-data";

export type { CatalogEntry, CatalogSource };

export interface CatalogHit {
  entry: CatalogEntry;
  score: number;
  /** The share of the query's words (or their synonyms) the entry contains, 0 to 1: how much of
   * what was asked it is about, which the score's idf weighting does not say. */
  coverage: number;
}
/** A live book of a tracked condition (the ingestor's tick), when there is one. */
export type LiveBook = (
  conditionId: `0x${string}`,
) => Promise<{ bid: number; ask: number; observedAtMs: number } | null>;

const DAY_MS = 86_400_000;
const FRESH_MS = 20_000;
/** How far ahead markets are kept: about two and a half years, past the next US presidential
 * election and inauguration. A world with a stock fixes within the vault's tenor, but its events
 * may be decided much later ("impeached by June 2027", "before his term ends"), and an opinion
 * about a later date needs the market of that date, not a sooner one. */
export const CATALOG_HORIZON_DAYS = 900;
/** Upper bounds on a crawl's pages (Kalshi lists about 105 pages of 200 open events, Gamma about
 * 24 of 100 once the skipped tags are left out); a crawl that reaches one logs it. */
const KALSHI_PAGES = 250;
const KALSHI_PAGE = 200;
const GAMMA_PAGES = 100;
/** Gamma's events endpoints return at most 100 per page, whatever the limit asked. */
const GAMMA_PAGE = 100;
/** As much of a market's rules as the API shows with a leg. */
const RULES_CHARS = 1_200;
/** Kalshi categories with nothing a stock or a macro view depends on. */
const KALSHI_SKIP = new Set([
  "sports",
  "entertainment",
  "social",
  "mentions",
  "climate and weather",
  "weather",
  "transportation",
]);
/** Gamma tag slugs of the same. */
const GAMMA_SKIP = new Set([
  "sports",
  "nba",
  "nfl",
  "mlb",
  "nhl",
  "soccer",
  "football",
  "tennis",
  "golf",
  "ufc",
  "mma",
  "boxing",
  "f1",
  "formula-1",
  "esports",
  "cricket",
  "games",
  "pop-culture",
  "celebrities",
  "awards",
  "music",
  "movies",
  "tv",
  "weather",
  "mentions",
  "up-or-down",
]);
/** Gamma's ids of the skipped tags (`/tags/slug/<slug>`), left out by the listing itself so a
 * crawl downloads only what it keeps (sports alone is most of Polymarket's events); the slugs
 * above still filter anything that comes through. */
const GAMMA_SKIP_IDS = [
  1, 745, 450, 100381, 899, 100350, 10, 864, 100219, 279, 281, 683, 100389, 64, 517, 100639, 596,
  286, 18, 100, 53, 100338, 84, 102127,
];

/** Words of each theme the keeper's correlation priors know (`DEFAULT_THEMES`). */
const THEME_WORDS: Record<string, string[]> = {
  fed: [
    "fed",
    "fomc",
    "federal reserve",
    "powell",
    "rate cut",
    "rate hike",
    "interest rate",
    "bps",
  ],
  market: [
    "s&p",
    "nasdaq",
    "dow",
    "stock",
    "earnings",
    "recession",
    "gdp",
    "cpi",
    "inflation",
    "jobs",
    "payrolls",
    "unemployment",
    "treasury",
    "yield",
  ],
  ai: [
    "ai",
    "openai",
    "anthropic",
    "nvidia",
    "gpu",
    "chatgpt",
    "gemini",
    "artificial intelligence",
    "llm",
    "xai",
    "grok",
    "claude",
  ],
  crypto: [
    "bitcoin",
    "btc",
    "ethereum",
    "eth",
    "crypto",
    "solana",
    "xrp",
    "dogecoin",
    "stablecoin",
    "coinbase",
  ],
  "us-china": ["china", "chinese", "xi jinping", "beijing", "tariff", "trade deal", "taiwan"],
  energy: ["oil", "opec", "brent", "wti", "gasoline", "natural gas", "energy"],
  politics: [
    "political",
    "trump",
    "biden",
    "congress",
    "senate",
    "house",
    "president",
    "white house",
    "democrat",
    "republican",
    "governor",
  ],
  elections: ["election", "primary", "nominee", "ballot", "electoral"],
  government: ["shutdown", "government", "cabinet", "supreme court", "executive order", "federal"],
  military: [
    "war",
    "military",
    "invasion",
    "ukraine",
    "russia",
    "israel",
    "iran",
    "nato",
    "ceasefire",
    "missile",
  ],
  filings: ["ipo", "s-1", "filing", "files for", "go public"],
  regulation: ["sec", "regulation", "ban", "antitrust", "ftc", "approval", "approve", "fda"],
};

const STOP = new Set(
  "a an and are as at be by for from has have if in into is it its of on or that the then this to was will with would what when which who whether before after above below over under than more less any all do does did not no yes i we you they he she my our their there here can could should might must just also about up down out off very so too it's".split(
    " ",
  ),
);
/** Query words and the venue words they also mean. */
const SYNONYMS: Record<string, string[]> = {
  fed: ["fomc", "federal", "reserve", "powell"],
  fomc: ["fed"],
  cut: ["cuts", "lower", "decrease"],
  hike: ["raise", "increase"],
  rates: ["rate"],
  cpi: ["inflation"],
  inflation: ["cpi", "pce"],
  btc: ["bitcoin"],
  bitcoin: ["btc"],
  eth: ["ethereum", "ether"],
  ethereum: ["eth"],
  sol: ["solana"],
  nvda: ["nvidia"],
  nvidia: ["nvda"],
  tsla: ["tesla"],
  tesla: ["tsla"],
  aapl: ["apple"],
  msft: ["microsoft"],
  googl: ["google", "alphabet"],
  google: ["alphabet"],
  amzn: ["amazon"],
  meta: ["facebook"],
  china: ["chinese", "xi", "beijing"],
  tariff: ["tariffs", "duties"],
  tariffs: ["tariff"],
  deal: ["agreement"],
  recession: ["gdp", "contraction"],
  jobs: ["payrolls", "nonfarm", "unemployment"],
  shutdown: ["government"],
  ipo: ["public", "s-1", "listing"],
  war: ["conflict", "invasion"],
  ceasefire: ["truce"],
  oil: ["crude", "wti", "brent"],
};

/** Lowercase words of a text, minus stop words, lightly stemmed. */
export function words(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9&.-]+/)) {
    const word = raw.replace(/^[.-]+|[.-]+$/g, "");
    if (!word || STOP.has(word) || (word.length < 2 && !/\d/.test(word))) continue;
    out.push(stem(word));
  }
  return out;
}
function stem(word: string) {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("es") && /(ch|sh|x|ss)es$/.test(word))
    return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !/\d/.test(word))
    return word.slice(0, -1);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  return word;
}

export function themesOf(text: string, extra: string[] = []): string[] {
  const t = ` ${text.toLowerCase()} ${extra.join(" ").toLowerCase()} `;
  const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&");
  return Object.entries(THEME_WORDS)
    .filter(([theme, list]) =>
      [theme, ...list].some((w) => new RegExp(`[^a-z0-9]${escapeRe(w)}(?:s|es)?[^a-z0-9]`).test(t)),
    )
    .map(([theme]) => theme);
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** A two-sided YES book from a bid and an ask (0 to 1), or nulls. */
function book(bid: number | null, ask: number | null) {
  if (bid === null || ask === null || !(bid > 0) || !(ask < 1) || !(bid <= ask))
    return { yes: null, bid: null, ask: null };
  return { yes: (bid + ask) / 2, bid, ask };
}
/** A market nobody has traded and nobody quotes (most of Kalshi's far-off local races): no world
 * can be priced on it, so it is not kept. */
const dead = (yes: number | null, volume: number) => yes === null && !(volume > 0);
/** A listing's next cursor, or "" to stop: at the end, or at a cursor it already gave (a venue
 * answering the same page again would otherwise be read until the page bound). */
function next(cursors: { seen: Set<string>; looped: boolean }, cursor: string) {
  if (!cursor) return "";
  if (cursors.seen.has(cursor)) {
    cursors.looped = true;
    return "";
  }
  cursors.seen.add(cursor);
  return cursor;
}
const inWindow = (endMs: number, nowMs: number, horizonDays: number) =>
  Number.isFinite(endMs) && endMs > nowMs + 3_600_000 && endMs <= nowMs + horizonDays * DAY_MS;

/** The binary, active markets of one Kalshi event (`GET /events?with_nested_markets=true`). */
export function kalshiEntries(
  event: Record<string, unknown>,
  nowMs: number,
  horizonDays = CATALOG_HORIZON_DAYS,
): CatalogEntry[] {
  const category = str(event.category);
  if (KALSHI_SKIP.has(category.toLowerCase())) return [];
  const eventTicker = str(event.event_ticker);
  const series = str(event.series_ticker);
  const title = str(event.title);
  const markets = Array.isArray(event.markets) ? (event.markets as Record<string, unknown>[]) : [];
  // A title several markets share can't tell their outcomes apart: Kalshi templates sometimes
  // drop the outcome from it ("Will Trump make a new before Jan 1, 2027?" for every country).
  const titleCount = new Map<string, number>();
  for (const m of markets) {
    const t = str(m.title);
    if (t) titleCount.set(t, (titleCount.get(t) ?? 0) + 1);
  }
  const out: CatalogEntry[] = [];
  for (const m of markets) {
    const ticker = str(m.ticker);
    if (!ticker || !/^[A-Z0-9][A-Z0-9._-]*$/.test(ticker)) continue;
    if (m.market_type !== "binary" || m.status !== "active") continue;
    const endMs = Date.parse(str(m.close_time));
    if (!inWindow(endMs, nowMs, horizonDays)) continue;
    const strike = str(m.yes_sub_title);
    const shared = (titleCount.get(str(m.title)) ?? 0) > 1 && Boolean(strike) && Boolean(title);
    const marketTitle = shared ? title : str(m.title) || title;
    const question =
      (marketTitle.startsWith("Will ") && !shared) || !strike
        ? marketTitle
        : `${marketTitle.replace(/\?$/, "")}: ${strike}?`;
    const prices = book(num(m.yes_bid_dollars), num(m.yes_ask_dollars));
    const volume = num(m.volume_fp) ?? num(m.volume) ?? 0;
    if (dead(prices.yes, volume)) continue;
    const rules = [str(m.rules_primary), str(m.rules_secondary)].filter(Boolean).join("\n\n");
    out.push({
      id: `kalshi:${ticker}`,
      source: "kalshi",
      marketId: ticker,
      conditionId: kalshiConditionId(ticker),
      yesIndex: 1,
      noIndex: 2,
      question,
      event: title,
      group: `kalshi:${eventTicker}`,
      exclusive: event.mutually_exclusive === true,
      outcome: strike || null,
      rules: rules.slice(0, RULES_CHARS),
      endTime: new Date(endMs).toISOString(),
      url: `https://kalshi.com/markets/${encodeURIComponent(series.toLowerCase())}`,
      // Kalshi's artwork is per series, at a fixed address (its event metadata's `image_url`), so
      // it costs no request per event.
      image: /^[A-Z0-9]+$/.test(series)
        ? `https://assets.kalshi.com/series-images-webp/${series}.webp`
        : null,
      category,
      tags: series ? [series.toLowerCase()] : [],
      themes: themesOf(`${title} ${question}`, [category]),
      ...prices,
      volume,
      liquidity: num(m.liquidity_dollars) ?? 0,
      updatedAtMs: nowMs,
    });
  }
  return out;
}

const jsonList = (v: unknown): string[] => {
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

/** The YES/NO markets of one Gamma event (`GET /events`), as `normalizeGammaMarket` accepts
 * them: two outcomes, YES and NO, never an "Other" placeholder. */
export function gammaEntries(
  event: Record<string, unknown>,
  nowMs: number,
  horizonDays = CATALOG_HORIZON_DAYS,
): CatalogEntry[] {
  const tags = (Array.isArray(event.tags) ? (event.tags as Record<string, unknown>[]) : [])
    .map((t) => str(t.slug).toLowerCase())
    .filter(Boolean);
  if (tags.some((t) => GAMMA_SKIP.has(t))) return [];
  const title = str(event.title);
  const eventSlug = str(event.slug);
  const markets = Array.isArray(event.markets) ? (event.markets as Record<string, unknown>[]) : [];
  const out: CatalogEntry[] = [];
  for (const m of markets) {
    if (m.active !== true || m.closed === true || m.negRiskOther === true) continue;
    if (m.enableOrderBook === false) continue;
    const conditionId = str(m.conditionId).toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(conditionId)) continue;
    const labels = jsonList(m.outcomes).map((l) => l.trim().toUpperCase());
    if (labels.length !== 2 || !labels.includes("YES") || !labels.includes("NO")) continue;
    if (jsonList(m.clobTokenIds).length !== 2) continue;
    const endMs = Date.parse(str(m.endDate) || str(m.endDateIso));
    if (!inWindow(endMs, nowMs, horizonDays)) continue;
    const yesFirst = labels[0] === "YES";
    let bid = num(m.bestBid),
      ask = num(m.bestAsk);
    if (!yesFirst && bid !== null && ask !== null) [bid, ask] = [1 - ask, 1 - bid];
    const prices = book(bid, ask);
    const volume = num(m.volumeNum) ?? num(m.volume) ?? 0;
    if (dead(prices.yes, volume)) continue;
    const slug = str(m.slug);
    const question = str(m.question);
    if (!question || !str(m.id)) continue;
    const image = [m.image, m.icon, event.image].map(str).find((u) => u.startsWith("https://"));
    out.push({
      id: `polymarket:${str(m.id)}`,
      source: "polymarket",
      marketId: str(m.id),
      conditionId: conditionId as `0x${string}`,
      yesIndex: yesFirst ? 1 : 2,
      noIndex: yesFirst ? 2 : 1,
      question,
      event: title,
      group: `polymarket:${str(event.id) || eventSlug}`,
      exclusive: m.negRisk === true,
      outcome: str(m.groupItemTitle) || null,
      rules: str(m.description).slice(0, RULES_CHARS),
      endTime: new Date(endMs).toISOString(),
      url: `https://polymarket.com/event/${eventSlug && eventSlug !== slug ? `${encodeURIComponent(eventSlug)}/` : ""}${encodeURIComponent(slug)}`,
      image: image ?? null,
      category: str(event.category) || tags[0] || "",
      tags,
      themes: themesOf(`${title} ${question}`, tags),
      ...prices,
      volume,
      liquidity: num(m.liquidityNum) ?? num(m.liquidity) ?? 0,
      updatedAtMs: nowMs,
    });
  }
  return out;
}

/** One kept market: its entry with the rules taken out (they are most of its memory), and the
 * rules deflated beside it, inflated only for the few entries a request returns. */
interface Stored {
  entry: CatalogEntry;
  rules: Uint8Array<ArrayBuffer>;
  /** The rules' hash, so a crawl that finds them unchanged reuses the deflated bytes. */
  rulesHash: bigint | number;
}
/** A word's postings: the slots of the entries that contain it, and the weight (x10) of the best
 * field it appears in there. Typed arrays: a crawl keeps tens of thousands of markets, and a Map
 * and a Set per entry cost several times their contents. */
interface Postings {
  slots: Uint32Array;
  weights: Uint8Array;
}
/** Entries a rebuild indexes before it lets other work run (an index of 50,000 markets takes a
 * few hundred milliseconds in all, and the ingestor relays live books meanwhile). */
const INDEX_CHUNK = 2_000;
const encoder = new TextEncoder(),
  decoder = new TextDecoder();

/** Each word of an entry with the weight (x10) of the best field it appears in. */
function fieldWords(entry: CatalogEntry) {
  const weights = new Map<string, number>();
  const field = (text: string, weight: number) => {
    for (const w of words(text)) weights.set(w, Math.max(weights.get(w) ?? 0, weight));
  };
  field(entry.tags.join(" "), 10);
  field(entry.category, 8);
  field(entry.event, 20);
  field(entry.outcome ?? "", 20);
  field(entry.question, 30);
  return weights;
}

export class EventCatalog {
  private slots: Stored[] = [];
  private slotOf = new Map<string, number>();
  private index = new Map<string, Postings>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private crawling: Promise<unknown> | undefined;
  /** Replacements run one at a time: each builds on the entries the one before swapped in. */
  private replaced: Promise<void> = Promise.resolve();
  crawledAt = 0;
  lastError: string | null = null;
  private readonly kalshi = new RequestPacer(2);
  private readonly gamma = new RequestPacer(4);

  constructor(
    private readonly options: {
      kalshiUrl: string;
      gammaUrl: string;
      fetch?: typeof fetch;
      everyMs?: number;
      horizonDays?: number;
      live?: LiveBook;
      now?: () => number;
      log?: (event: string, detail?: Record<string, unknown>) => void;
    },
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }
  get size() {
    return this.slots.length;
  }

  start() {
    const loop = async () => {
      if (this.stopped) return;
      await this.crawl().catch(() => {});
      if (!this.stopped) this.timer = setTimeout(loop, this.options.everyMs ?? 15 * 60_000);
      this.timer?.unref?.();
    };
    void loop();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async json(pacer: RequestPacer, url: string) {
    for (let attempt = 1; ; attempt++) {
      const response = await pacer.run(() =>
        (this.options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(20_000) }),
      );
      if (response.status === 429 && attempt <= 3) {
        await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
        continue;
      }
      if (!response.ok) throw new Error(`${new URL(url).pathname}: ${response.status}`);
      return (await response.json()) as unknown;
    }
  }

  /** One pass over both venues; a venue that fails keeps its previous entries. */
  crawl() {
    this.crawling ??= this.pass().finally(() => {
      this.crawling = undefined;
    });
    return this.crawling as Promise<{ kalshi: number | null; polymarket: number | null }>;
  }
  private async pass() {
    const nowMs = this.now();
    const horizon = this.options.horizonDays ?? CATALOG_HORIZON_DAYS;
    const errors: string[] = [];
    const venue = async (name: CatalogSource, read: () => Promise<CatalogEntry[]>) => {
      try {
        const list = await read();
        this.replaced = this.replaced
          .catch(() => {})
          .then(async () => {
            for (const _ of this.replacing(name, list)) await new Promise((r) => setImmediate(r));
          });
        await this.replaced;
        return list.length;
      } catch (error) {
        errors.push(`${name}: ${(error as Error).message}`);
        this.options.log?.("catalog.crawl.failed", {
          venue: name,
          error: (error as Error).message,
        });
        return null;
      }
    };
    const [kalshi, polymarket] = await Promise.all([
      venue("kalshi", async () => {
        const out: CatalogEntry[] = [];
        const cursors = { seen: new Set<string>(), looped: false };
        let cursor = "";
        let pages = 0;
        do {
          const params = new URLSearchParams({
            status: "open",
            with_nested_markets: "true",
            limit: String(KALSHI_PAGE),
          });
          if (cursor) params.set("cursor", cursor);
          const body = (await this.json(
            this.kalshi,
            `${this.options.kalshiUrl}/events?${params}`,
          )) as Record<string, unknown>;
          const list = (body.events as Record<string, unknown>[] | undefined) ?? [];
          for (const e of list) out.push(...kalshiEntries(e, nowMs, horizon));
          cursor = next(cursors, typeof body.cursor === "string" && list.length ? body.cursor : "");
        } while (cursor && ++pages < KALSHI_PAGES);
        if (cursor || cursors.looped)
          this.options.log?.("catalog.crawl.truncated", { venue: "kalshi", pages });
        return out;
      }),
      venue("polymarket", async () => {
        const out: CatalogEntry[] = [];
        const cursors = { seen: new Set<string>(), looped: false };
        let cursor = "";
        let pages = 0;
        // No end_date_max: an event's end date is one of its markets' (often the first), so a
        // bound on it would drop the later markets of a date ladder; each market's own end is
        // checked against the horizon instead.
        do {
          const params = new URLSearchParams({
            active: "true",
            closed: "false",
            archived: "false",
            limit: String(GAMMA_PAGE),
            order: "volume24hr",
            ascending: "false",
            end_date_min: new Date(nowMs).toISOString(),
          });
          for (const id of GAMMA_SKIP_IDS) params.append("exclude_tag_id", String(id));
          if (cursor) params.set("after_cursor", cursor);
          const body = (await this.json(
            this.gamma,
            `${this.options.gammaUrl}/events/keyset?${params}`,
          )) as { events?: unknown; next_cursor?: unknown };
          const list = Array.isArray(body.events) ? (body.events as Record<string, unknown>[]) : [];
          for (const e of list) out.push(...gammaEntries(e, nowMs, horizon));
          cursor = next(
            cursors,
            typeof body.next_cursor === "string" && list.length ? body.next_cursor : "",
          );
        } while (cursor && ++pages < GAMMA_PAGES);
        if (cursor || cursors.looped)
          this.options.log?.("catalog.crawl.truncated", { venue: "polymarket", pages });
        return out;
      }),
    ]);
    this.crawledAt = nowMs;
    this.lastError = errors.join("; ") || null;
    this.options.log?.("catalog.crawled", { kalshi, polymarket, size: this.size });
    return { kalshi, polymarket };
  }

  /** Replaces one venue's entries (exposed for tests). */
  replace(source: CatalogSource, list: CatalogEntry[]) {
    for (const _ of this.replacing(source, list));
  }
  /** Builds the new entries and index aside, pausing every `INDEX_CHUNK` entries, and swaps
   * them in at once: a search meanwhile reads the previous ones, whole. */
  private *replacing(source: CatalogSource, list: CatalogEntry[]): Generator<void> {
    const slots: Stored[] = this.slots.filter((x) => x.entry.source !== source);
    const seen = new Set(slots.map((x) => x.entry.id));
    for (const entry of list) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const rulesHash = Bun.hash(entry.rules);
      const old = this.slots[this.slotOf.get(entry.id) ?? -1];
      slots.push({
        entry: { ...entry, rules: "" },
        rules:
          old && old.rulesHash === rulesHash
            ? old.rules
            : Bun.deflateSync(encoder.encode(entry.rules)),
        rulesHash,
      });
      if (slots.length % INDEX_CHUNK === 0) yield;
    }
    const lists = new Map<string, number[]>();
    for (let slot = 0; slot < slots.length; slot++) {
      for (const [w, weight] of fieldWords(slots[slot]!.entry)) {
        const l = lists.get(w);
        if (l) l.push(slot, weight);
        else lists.set(w, [slot, weight]);
      }
      if (slot % INDEX_CHUNK === INDEX_CHUNK - 1) yield;
    }
    const index = new Map<string, Postings>();
    for (const [w, l] of lists) {
      const n = l.length / 2;
      const p: Postings = { slots: new Uint32Array(n), weights: new Uint8Array(n) };
      for (let i = 0; i < n; i++) {
        p.slots[i] = l[2 * i]!;
        p.weights[i] = l[2 * i + 1]!;
      }
      index.set(w, p);
    }
    this.slots = slots;
    this.slotOf = new Map(slots.map((x, slot) => [x.entry.id, slot]));
    this.index = index;
  }
  /** A stored entry with its rules. */
  private full(x: Stored): CatalogEntry {
    return { ...x.entry, rules: decoder.decode(Bun.inflateSync(x.rules)) };
  }

  get(id: string) {
    const x = this.slots[this.slotOf.get(id) ?? -1];
    return x ? this.full(x) : undefined;
  }

  /** The entries best matching `query`: each query word (and its synonyms, at less weight) by
   * its rarity and the field it appears in, with a bonus for covering every word and a little
   * for volume. */
  search(
    query: string,
    options: { limit?: number; before?: number; after?: number; source?: CatalogSource } = {},
  ): CatalogHit[] {
    // At most 32 words, one bit each for what a hit covers.
    const terms = [...new Set(words(query))].slice(0, 32);
    if (!terms.length) return [];
    const slots = this.slots,
      index = this.index;
    const total = Math.max(1, slots.length);
    const expanded = new Map<string, { weight: number; bit: number }>();
    terms.forEach((t, i) => {
      const bit = 2 ** i;
      expanded.set(t, { weight: 1, bit });
      for (const s of SYNONYMS[t] ?? [])
        for (const w of words(s)) if (!expanded.has(w)) expanded.set(w, { weight: 0.7, bit });
    });
    const score = new Float64Array(slots.length);
    const mask = new Uint32Array(slots.length);
    const touched: number[] = [];
    for (const [w, { weight, bit }] of expanded) {
      const p = index.get(w);
      if (!p?.slots.length) continue;
      const idf = Math.log(1 + total / p.slots.length);
      for (let i = 0; i < p.slots.length; i++) {
        const slot = p.slots[i]!;
        if (!mask[slot]) touched.push(slot);
        score[slot]! += (idf * weight * p.weights[i]!) / 10;
        mask[slot]! |= bit;
      }
    }
    const ranked: { slot: number; score: number; coverage: number }[] = [];
    for (const slot of touched) {
      const entry = slots[slot]!.entry;
      if (options.source && entry.source !== options.source) continue;
      if (options.before !== undefined || options.after !== undefined) {
        const end = Date.parse(entry.endTime);
        if (options.before !== undefined && end > options.before) continue;
        if (options.after !== undefined && end < options.after) continue;
      }
      let covered = 0;
      for (let m = mask[slot]!; m; m >>>= 1) covered += m & 1;
      const coverage = covered / terms.length;
      const quoted = entry.yes === null ? 0.6 : 1;
      const popularity = 1 + 0.12 * Math.log10(1 + entry.volume);
      ranked.push({
        slot,
        score: score[slot]! * (0.4 + coverage * coverage) * quoted * popularity,
        coverage,
      });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, Math.min(options.limit ?? 20, 100)).map((r) => ({
      entry: this.full(slots[r.slot]!),
      score: r.score,
      coverage: r.coverage,
    }));
  }

  /** The entries named, each priced within the last 20 seconds: a tracked condition's live
   * book, else one venue read (Kalshi's market, Gamma's market). */
  async fresh(ids: string[]): Promise<CatalogEntry[]> {
    const nowMs = this.now();
    const out: CatalogEntry[] = [];
    await Promise.all(
      [...new Set(ids)].slice(0, 12).map(async (id) => {
        const x = this.slots[this.slotOf.get(id) ?? -1];
        if (!x) return;
        let entry = x.entry;
        if (nowMs - entry.updatedAtMs > FRESH_MS) {
          try {
            const live = await this.options.live?.(entry.conditionId);
            if (live)
              entry = { ...entry, ...book(live.bid, live.ask), updatedAtMs: live.observedAtMs };
            else if (entry.source === "kalshi") {
              const body = (await this.json(
                this.kalshi,
                `${this.options.kalshiUrl}/markets/${encodeURIComponent(entry.marketId)}`,
              )) as { market?: Record<string, unknown> };
              const m = body.market ?? {};
              entry = {
                ...entry,
                ...book(num(m.yes_bid_dollars), num(m.yes_ask_dollars)),
                updatedAtMs: nowMs,
              };
            } else {
              const m = (await this.json(
                this.gamma,
                `${this.options.gammaUrl}/markets/${encodeURIComponent(entry.marketId)}`,
              )) as Record<string, unknown>;
              let bid = num(m.bestBid),
                ask = num(m.bestAsk);
              if (entry.yesIndex === 2 && bid !== null && ask !== null)
                [bid, ask] = [1 - ask, 1 - bid];
              entry = { ...entry, ...book(bid, ask), updatedAtMs: nowMs };
            }
            x.entry = entry;
          } catch (error) {
            this.options.log?.("catalog.fresh.failed", { id, error: (error as Error).message });
          }
        }
        out.push(this.full({ ...x, entry }));
      }),
    );
    const order = new Map(ids.map((id, i) => [id, i]));
    return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
}
