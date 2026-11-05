/** The event catalog: venue listings become searchable legs (Kalshi's nested events, Gamma's
 * events), searches read memory only, and a preview's prices cost at most one venue read per
 * entry every 20 seconds (none for a tracked leg). */
import { describe, expect, test } from "bun:test";
import { kalshiConditionId } from "@conditional-stocks/market-data";
import {
  type CatalogEntry,
  EventCatalog,
  gammaEntries,
  kalshiEntries,
  themesOf,
  words,
} from "../src/catalog.ts";

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
      close_time: at(90),
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
