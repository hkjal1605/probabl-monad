/** The event catalog: venue listings become searchable legs (Kalshi's nested events, Gamma's
 * events), searches read memory only, and a preview's prices cost at most one venue read per
 * entry every 20 seconds (none for a tracked leg). */
import { describe, expect, test } from "bun:test";
import { kalshiConditionId } from "@conditional-stocks/market-data";
import {
  CATALOG_HORIZON_DAYS,
  type CatalogEntry,
  EventCatalog,
  gammaEntries,
  kalshiEntries,
  themesOf,
  words,
} from "../src/catalog.ts";
import { createCatalogApp } from "../src/catalog-app.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString();

const fedEvent = {
  event_ticker: "KXFEDDECISION-26DEC",
  series_ticker: "KXFEDDECISION",
  title: "Fed decision in December 2026",
  category: "Economics",
  mutually_exclusive: true,
  markets: [
    {
      ticker: "KXFEDDECISION-26DEC-C25",
      market_type: "binary",
      status: "active",
      title: "Will the Fed cut rates by 25bps in December 2026?",
      yes_sub_title: "Cut 25bps",
      rules_primary: "Resolves YES if the FOMC lowers the target range by 25 bps.",
      close_time: at(36),
      yes_bid_dollars: "0.61",
      yes_ask_dollars: "0.63",
      volume_fp: "125000",
      liquidity_dollars: "40000",
    },
    {
      ticker: "KXFEDDECISION-26DEC-H0",
      market_type: "binary",
      status: "active",
      title: "Fed decision in December 2026",
      yes_sub_title: "Hold",
      rules_primary: "Resolves YES if the FOMC holds.",
      close_time: at(36),
      yes_bid_dollars: "0.30",
      yes_ask_dollars: "0.33",
    },
    // Not binary, closed, or past the horizon: left out.
    { ticker: "KXFEDDECISION-26DEC-X", market_type: "scalar", status: "active", close_time: at(5) },
    { ticker: "KXFEDDECISION-26DEC-Y", market_type: "binary", status: "closed", close_time: at(5) },
    {
      ticker: "KXFEDDECISION-27-Z",
      market_type: "binary",
      status: "active",
      title: "Later",
      close_time: at(1_000),
      yes_bid_dollars: "0.30",
      yes_ask_dollars: "0.33",
    },
    // Never traded and unquoted: no world can be priced on it.
    {
      ticker: "KXFEDDECISION-26DEC-DEAD",
      market_type: "binary",
      status: "active",
      title: "Will nobody trade this?",
      close_time: at(36),
      volume_fp: "0",
    },
  ],
};

describe("venue listings", () => {
  test("Kalshi: binary active markets in the horizon, with ticker condition ids", () => {
    const list = kalshiEntries(fedEvent, NOW);
    expect(list.map((e) => e.marketId)).toEqual([
      "KXFEDDECISION-26DEC-C25",
      "KXFEDDECISION-26DEC-H0",
    ]);
    const cut = list[0]!;
    expect(cut.conditionId).toBe(kalshiConditionId("KXFEDDECISION-26DEC-C25"));
    expect(cut.yes).toBeCloseTo(0.62, 9);
    expect(cut.exclusive).toBe(true);
    expect(cut.group).toBe("kalshi:KXFEDDECISION-26DEC");
    expect(cut.themes).toContain("fed");
    expect(cut.image).toBe("https://assets.kalshi.com/series-images-webp/KXFEDDECISION.webp");
    // A ladder's subtitle names the strike when the title is not a question.
    expect(list[1]!.question).toBe("Fed decision in December 2026: Hold?");
    expect(kalshiEntries({ ...fedEvent, category: "Sports" }, NOW)).toEqual([]);
  });

  test("Kalshi: a title every outcome shares is rebuilt from the event and the outcome", () => {
    // Kalshi's own titles for this event omit the country: only the subtitle names it.
    const deals = {
      event_ticker: "KXFTACOUNTRIES-27",
      series_ticker: "KXFTACOUNTRIES",
      title: "Which countries will Trump make formal trade deals with in 2026?",
      category: "Politics",
      markets: ["China", "India"].map((country) => ({
        ticker: `KXFTACOUNTRIES-27-${country.slice(0, 3).toUpperCase()}`,
        market_type: "binary",
        status: "active",
        title: "Will Trump make a new before Jan 1, 2027?",
        yes_sub_title: country,
        close_time: at(57),
        yes_bid_dollars: "0.10",
        yes_ask_dollars: "0.12",
      })),
    };
    const [china, india] = kalshiEntries(deals, NOW);
    expect(china!.question).toBe(
      "Which countries will Trump make formal trade deals with in 2026: China?",
    );
    expect(india!.question).toBe(
      "Which countries will Trump make formal trade deals with in 2026: India?",
    );
    // Within the catalog's horizon (events decided by the end of the year are kept).
    expect(kalshiEntries({ ...deals, markets: [] }, NOW)).toEqual([]);
  });

  test("Gamma: YES/NO markets only, oriented to YES, sports left out", () => {
    const event = {
      id: "900",
      slug: "us-china-trade-deal",
      title: "US–China trade deal in 2026?",
      tags: [{ slug: "politics" }, { slug: "trade" }],
      markets: [
        {
          id: "555",
          question: "Will the US and China sign a trade deal by Nov 30?",
          conditionId: `0x${"ab".repeat(32)}`,
          slug: "us-china-trade-deal-nov-30",
          outcomes: '["No","Yes"]',
          clobTokenIds: '["1","2"]',
          endDate: at(26),
          description: "Resolves YES if…",
          bestBid: 0.64,
          bestAsk: 0.66,
          active: true,
          closed: false,
          volumeNum: 2_000_000,
        },
        {
          id: "556",
          question: "Other",
          conditionId: `0x${"cd".repeat(32)}`,
          slug: "other",
          outcomes: '["Yes","No"]',
          clobTokenIds: '["3","4"]',
          endDate: at(26),
          active: true,
          closed: false,
          negRiskOther: true,
        },
      ],
    };
    const [deal, ...rest] = gammaEntries(event, NOW);
    expect(rest).toEqual([]);
    // YES is the second outcome: its book is the first outcome's, flipped.
    expect(deal!.yesIndex).toBe(2);
    expect(deal!.bid).toBeCloseTo(0.34, 9);
    expect(deal!.ask).toBeCloseTo(0.36, 9);
    expect(deal!.url).toBe(
      "https://polymarket.com/event/us-china-trade-deal/us-china-trade-deal-nov-30",
    );
    expect(deal!.themes).toEqual(expect.arrayContaining(["us-china", "politics"]));
    expect(gammaEntries({ ...event, tags: [{ slug: "nba" }] }, NOW)).toEqual([]);
  });

  test("words and themes", () => {
    expect(words("Will the Fed cut rates in December?")).toEqual([
      "fed",
      "cut",
      "rate",
      "december",
    ]);
    expect(themesOf("Will Anthropic file an S-1?")).toEqual(
      expect.arrayContaining(["ai", "filings"]),
    );
  });
});

const entry = (over: Partial<CatalogEntry> & { id: string; question: string }): CatalogEntry => ({
  source: "kalshi",
  marketId: over.id.split(":")[1]!,
  conditionId: kalshiConditionId(over.id),
  yesIndex: 1,
  noIndex: 2,
  event: "",
  group: over.id,
  exclusive: false,
  outcome: null,
  rules: "",
  endTime: at(20),
  url: "https://kalshi.com/markets/x",
  image: null,
  category: "Economics",
  tags: [],
  themes: [],
  yes: 0.5,
  bid: 0.49,
  ask: 0.51,
  volume: 1000,
  liquidity: 0,
  updatedAtMs: NOW,
  ...over,
});

describe("search", () => {
  const catalog = () => {
    const c = new EventCatalog({
      kalshiUrl: "https://kalshi.test",
      gammaUrl: "https://gamma.test",
      now: () => NOW,
    });
    c.replace("kalshi", [
      entry({ id: "kalshi:FED-C25", question: "Will the Fed cut rates in December?", volume: 1e5 }),
      entry({ id: "kalshi:FED-HOLD", question: "Will the Fed hold rates in December?" }),
      entry({ id: "kalshi:CPI", question: "Will CPI inflation be above 3% in November?" }),
      entry({
        id: "kalshi:BTC",
        question: "Will Bitcoin be above $120,000 on Dec 31?",
        endTime: at(57),
      }),
    ]);
    return c;
  };

  test("ranks the market covering the words first, with synonyms", () => {
    const c = catalog();
    expect(c.search("If the Fed cuts in December")[0]!.entry.id).toBe("kalshi:FED-C25");
    // Coverage: the share of the query's words the hit is about.
    expect(c.search("Fed cut rates December")[0]!.coverage).toBe(1);
    const weak = c.search("Fed sign trade deal").find((h) => h.entry.id === "kalshi:FED-C25");
    expect(weak!.coverage).toBeCloseTo(1 / 4, 9);
    expect(c.search("btc over 120k")[0]!.entry.id).toBe("kalshi:BTC");
    expect(c.search("hot inflation print")[0]!.entry.id).toBe("kalshi:CPI");
    expect(c.search("the and of")).toEqual([]);
  });

  test("filters by close time", () => {
    const c = catalog();
    const before = NOW + 30 * DAY;
    expect(c.search("bitcoin", { before }).map((h) => h.entry.id)).toEqual([]);
  });

  test("a replaced venue drops its old entries from the index", () => {
    const c = catalog();
    c.replace("kalshi", [entry({ id: "kalshi:NEW", question: "Will the Fed pause?" })]);
    expect(c.search("cut rates december")).toEqual([]);
    expect(c.size).toBe(1);
  });
});

describe("fresh prices", () => {
  test("a tracked leg's live book costs no venue read; others one read per 20 seconds", async () => {
    let now = NOW;
    const urls: string[] = [];
    const fetcher = (async (input: string) => {
      urls.push(input);
      return Response.json({ market: { yes_bid_dollars: "0.40", yes_ask_dollars: "0.44" } });
    }) as unknown as typeof fetch;
    const c = new EventCatalog({
      kalshiUrl: "https://kalshi.test",
      gammaUrl: "https://gamma.test",
      fetch: fetcher,
      now: () => now,
      live: async (condition) =>
        condition === kalshiConditionId("kalshi:LIVE")
          ? { bid: 0.7, ask: 0.72, observedAtMs: now }
          : null,
    });
    c.replace("kalshi", [
      entry({
        id: "kalshi:LIVE",
        question: "Tracked",
        conditionId: kalshiConditionId("kalshi:LIVE"),
      }),
      entry({ id: "kalshi:COLD", question: "Not tracked" }),
    ]);
    now += 30_000;
    const [live, cold] = await c.fresh(["kalshi:LIVE", "kalshi:COLD"]);
    expect(live!.yes).toBeCloseTo(0.71, 9);
    expect(cold!.yes).toBeCloseTo(0.42, 9);
    expect(urls).toEqual(["https://kalshi.test/markets/COLD"]);
    // Within 20 seconds: no read at all.
    now += 10_000;
    await c.fresh(["kalshi:COLD"]);
    expect(urls.length).toBe(1);
  });
});

describe("crawl", () => {
  /** One Gamma event of YES/NO markets at the given days. */
  const gammaEvent = (id: string, title: string, days: number[], tags = ["politics"]) => ({
    id,
    slug: id,
    title,
    tags: tags.map((slug) => ({ slug })),
    markets: days.map((d, i) => ({
      id: `${id}${i}`,
      question: `${title} (${d} days)`,
      conditionId: `0x${(Number(id) * 10 + i).toString(16).padStart(64, "0")}`,
      slug: `${id}-${i}`,
      outcomes: '["Yes","No"]',
      clobTokenIds: '["1","2"]',
      endDate: at(d),
      bestBid: 0.4,
      bestAsk: 0.42,
      active: true,
      closed: false,
      volumeNum: 1_000,
    })),
  });

  test("reads every page of both venues, by cursor, and keeps markets years ahead", async () => {
    const urls: URL[] = [];
    const fetcher = (async (input: string) => {
      const url = new URL(input);
      urls.push(url);
      if (url.host === "kalshi.test") {
        const page = url.searchParams.get("cursor") ?? "";
        return Response.json(
          page === ""
            ? { events: [fedEvent], cursor: "k2" }
            : {
                events: [
                  {
                    ...fedEvent,
                    event_ticker: "KXIMPEACH-27",
                    title: "Will Trump be impeached by June 30, 2027?",
                    category: "Politics",
                    markets: [
                      {
                        ticker: "KXIMPEACH-27JUN",
                        market_type: "binary",
                        status: "active",
                        title: "Will Trump be impeached by June 30, 2027?",
                        close_time: at(238),
                        yes_bid_dollars: "0.08",
                        yes_ask_dollars: "0.10",
                      },
                    ],
                  },
                ],
                cursor: "",
              },
        );
      }
      const after = url.searchParams.get("after_cursor");
      return Response.json(
        after === null
          ? { events: [gammaEvent("901", "Trump impeached", [57, 238, 422])], next_cursor: "g2" }
          : { events: [gammaEvent("902", "Hegseth out", [26, 800])] },
      );
    }) as unknown as typeof fetch;
    const c = new EventCatalog({
      kalshiUrl: "https://kalshi.test",
      gammaUrl: "https://gamma.test",
      fetch: fetcher,
      now: () => NOW,
    });
    expect(await c.crawl()).toEqual({ kalshi: 3, polymarket: 5 });
    // Two pages each, nothing more.
    const kalshi = urls.filter((u) => u.host === "kalshi.test");
    const gamma = urls.filter((u) => u.host === "gamma.test");
    expect(kalshi.map((u) => u.searchParams.get("cursor"))).toEqual([null, "k2"]);
    expect(gamma.map((u) => [u.pathname, u.searchParams.get("after_cursor")])).toEqual([
      ["/events/keyset", null],
      ["/events/keyset", "g2"],
    ]);
    // Gamma leaves the skipped tags out itself (sports is most of its events), at its page size,
    // with no bound on the event's own end date (a date ladder's later markets would go).
    expect(gamma[0]!.searchParams.getAll("exclude_tag_id")).toContain("1");
    expect(gamma[0]!.searchParams.get("limit")).toBe("100");
    expect(gamma[0]!.searchParams.has("end_date_max")).toBe(false);
    expect(kalshi[0]!.searchParams.get("limit")).toBe("200");
    // Markets years ahead are kept, past the horizon not, nor one nobody trades or quotes.
    expect(CATALOG_HORIZON_DAYS).toBeGreaterThan(800);
    expect(c.get("kalshi:KXIMPEACH-27JUN")?.question).toBe(
      "Will Trump be impeached by June 30, 2027?",
    );
    expect(c.get("polymarket:9022")).toBeUndefined();
    expect(c.get("polymarket:9021")).toBeDefined();
    expect(c.get("kalshi:KXFEDDECISION-27-Z")).toBeUndefined();
    expect(c.get("kalshi:KXFEDDECISION-26DEC-DEAD")).toBeUndefined();
    // The rules come back whole from where they are kept.
    expect(c.get("kalshi:KXFEDDECISION-26DEC-C25")?.rules).toBe(
      "Resolves YES if the FOMC lowers the target range by 25 bps.",
    );
    const hits = c.search("trump impeached june 2027", { limit: 3 });
    expect(hits[0]!.entry.id).toBe("kalshi:KXIMPEACH-27JUN");
    expect(hits[0]!.coverage).toBe(1);
  });

  test("a venue that fails keeps its previous entries; a listing that repeats a cursor ends", async () => {
    let fail = false;
    const logs: string[] = [];
    const fetcher = (async (input: string) => {
      const url = new URL(input);
      if (url.host === "kalshi.test")
        return fail
          ? new Response("down", { status: 503 })
          : Response.json({ events: [fedEvent], cursor: "" });
      // Gamma answers the same page and cursor again and again.
      return Response.json({ events: [gammaEvent("903", "Loop", [30])], next_cursor: "again" });
    }) as unknown as typeof fetch;
    const c = new EventCatalog({
      kalshiUrl: "https://kalshi.test",
      gammaUrl: "https://gamma.test",
      fetch: fetcher,
      now: () => NOW,
      log: (event) => logs.push(event),
    });
    await c.crawl();
    expect(c.get("kalshi:KXFEDDECISION-26DEC-C25")).toBeDefined();
    expect(logs).toContain("catalog.crawl.truncated");
    fail = true;
    const second = await c.crawl();
    expect(second.kalshi).toBeNull();
    expect(c.get("kalshi:KXFEDDECISION-26DEC-C25")).toBeDefined();
    expect(c.lastError).toContain("kalshi");
  });
});

describe("catalog app", () => {
  test("searches and entries behind the internal token, each hit with its coverage", async () => {
    const c = new EventCatalog({
      kalshiUrl: "https://kalshi.test",
      gammaUrl: "https://gamma.test",
    });
    c.replace("kalshi", kalshiEntries(fedEvent, Date.now() - 30 * DAY));
    const app = createCatalogApp(c, "t".repeat(16));
    const auth = { authorization: `Bearer ${"t".repeat(16)}` };
    expect((await app.request("/internal/catalog/search?q=fed")).status).toBe(401);
    const search = (await (
      await app.request("/internal/catalog/search?q=fed%20cut%20mars&limit=2", { headers: auth })
    ).json()) as { size: number; hits: { coverage: number; entry: CatalogEntry }[] };
    expect(search.size).toBe(2);
    expect(search.hits[0]!.entry.rules).toContain("FOMC");
    expect(search.hits[0]!.coverage).toBeCloseTo(2 / 3, 3);
    const entries = (await (
      await app.request("/internal/catalog/entries", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ ids: ["kalshi:KXFEDDECISION-26DEC-H0", "kalshi:NONE"] }),
      })
    ).json()) as { entries: CatalogEntry[] };
    expect(entries.entries.map((e) => e.id)).toEqual(["kalshi:KXFEDDECISION-26DEC-H0"]);
  });
});
