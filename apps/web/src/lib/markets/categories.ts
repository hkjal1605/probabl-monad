import type { MarketView } from "@/types/api";

/** What an event is about. One per market: the first rule that matches its venue series (Kalshi)
 * or its question wins, so an earnings market on a chipmaker is Earnings, not Tech. */
export const TOPICS = [
  "Economy",
  "Geopolitics",
  "Politics",
  "Tech",
  "Crypto",
  "Commodities",
  "Stocks",
] as const;
export type Topic = (typeof TOPICS)[number] | "Earnings" | "Other";

const TOPIC_RULES: [Exclude<Topic, "Other">, RegExp, RegExp?][] = [
  [
    "Earnings",
    /\b(earnings|eps|quarterly (results|revenue)|revenue|guidance|deliveries|beat (its )?estimates)\b/i,
  ],
  [
    "Economy",
    /\b(fed|fomc|federal reserve|interest rates?|rate (cut|hike)s?|cpi|inflation|payrolls?|jobs report|unemployment|gdp|recession)\b/i,
    /^KX(FED|CPI|PAYROLLS|RECSS|GDP|U3|PCE)/,
  ],
  [
    "Geopolitics",
    /\b(iran|israel|hormuz|ceasefire|invade|invasion|blockade|nuclear deal|war|ukraine|russia|taiwan|sanctions?|military)\b/i,
    /^KX(HORMUZ|USAIRAN)/,
  ],
  [
    "Politics",
    /\b(election|elected|president(ial)?|senate|house of representatives|congress|governor|nominee|prime minister|impeach\w*|win the house)\b/i,
    /^(CONTROL|KXPRES|KXSENATE|KXHOUSE)/,
  ],
  [
    "Tech",
    /\b(largest company|artificial intelligence|openai|anthropic|nvidia|apple|microsoft|alphabet|google|semiconductors?|chips?)\b/i,
  ],
  [
    "Crypto",
    /\b(bitcoin|btc|ethereum|ether|solana|xrp|dogecoin|crypto(currency)?)\b/i,
    /^KX(BTC|ETH|SOL|XRP|DOGE)/,
  ],
  [
    "Commodities",
    /\b(gold|silver|oil|wti|crude|brent|natural gas|copper)\b/i,
    /^KX(GOLD|SILVER|WTI|BRENT|NATGAS|COPPER)/,
  ],
  ["Stocks", /\b(nasdaq|s&p|dow jones|russell|stock market)\b/i, /^KX(NASDAQ|INX|DOW|RUT)/],
];

export function marketTopic(market: Pick<MarketView, "question" | "event">): Topic {
  const series = market.event?.series ?? "";
  for (const [topic, words, seriesRule] of TOPIC_RULES)
    if ((seriesRule && series && seriesRule.test(series)) || words.test(market.question))
      return topic;
  return "Other";
}

// A level of a price: "$83,500 or above", "above 4134.99", "reach $90,000", "dip to $70,000".
const PRICE_LEVEL =
  /\$[\d,.]+\d\s*or\s*(above|below)|\b(above|below|reach|dip to|hit|exceed)\s+\$?\d[\d,.]*/i;

/** An event on whether a crypto, commodity or index price reaches a level: one rung of a ladder. */
export function isPriceLadder(market: Pick<MarketView, "question" | "event">) {
  const topic = marketTopic(market);
  return (
    (topic === "Crypto" || topic === "Commodities" || topic === "Stocks") &&
    PRICE_LEVEL.test(market.question)
  );
}

/** When the event resolves: the venue's end time, or the trading cutoff when that is later (a
 * venue end date can trail the real event, as Polymarket's first-round date does a runoff). */
export function eventTime(market: Pick<MarketView, "cutoff" | "event">): number {
  const end = Date.parse(market.event?.endTime ?? ""),
    cutoff = Date.parse(market.cutoff);
  return Number.isFinite(end) ? Math.max(end, cutoff) : cutoff;
}

/** A ladder's cadence, from how long its market trades: daily ladders open within a day of their
 * fixing, weekly ones two to seven days before. */
export function ladderCadence(
  market: Pick<MarketView, "question" | "event" | "cutoff" | "tradingOpen">,
): "daily" | "weekly" | null {
  if (!isPriceLadder(market)) return null;
  const hours = (eventTime(market) - Date.parse(market.tradingOpen)) / 3_600_000;
  return hours <= 30 ? "daily" : hours <= 8 * 24 ? "weekly" : null;
}

export const CALENDAR_TAB = "Event Calendar";
const FIXED_TABS = ["All", "Daily", "Weekly", "Price Ladder", "Earnings"] as const;
export type MarketTab = (typeof FIXED_TABS)[number] | (typeof TOPICS)[number] | typeof CALENDAR_TAB;
/** Every tab, in order: the fixed ones, the topics, then the calendar. */
export const MARKET_TABS: readonly MarketTab[] = [...FIXED_TABS, ...TOPICS, CALENDAR_TAB];

const slugOf = (tab: MarketTab) => tab.toLowerCase().replace(/\s+/g, "-");
/** Tabs with a `/category/<slug>` page (All is `/`, the calendar `/calendar`). */
export const CATEGORY_TABS = MARKET_TABS.filter((tab) => tab !== "All" && tab !== CALENDAR_TAB);

export const marketTabPath = (tab: MarketTab) =>
  tab === "All" ? "/" : tab === CALENDAR_TAB ? "/calendar" : `/category/${slugOf(tab)}`;
export const marketTabSlug = slugOf;

export function marketTabFromSlug(slug: string): MarketTab | null {
  return CATEGORY_TABS.find((tab) => slugOf(tab) === slug.toLowerCase()) ?? null;
}

export function marketTabFromPathname(pathname: string): MarketTab | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return "All";
  if (path === "/calendar") return CALENDAR_TAB;
  const match = /^\/category\/([^/]+)$/.exec(path);
  return match?.[1] ? marketTabFromSlug(match[1]) : null;
}

/** Whether a market belongs under `tab` (the calendar shows every market). */
export function inMarketTab(
  market: Pick<MarketView, "question" | "event" | "cutoff" | "tradingOpen">,
  tab: MarketTab,
): boolean {
  switch (tab) {
    case "All":
    case CALENDAR_TAB:
      return true;
    case "Daily":
      return ladderCadence(market) === "daily";
    case "Weekly":
      return ladderCadence(market) === "weekly";
    case "Price Ladder":
      return isPriceLadder(market);
    default:
      return marketTopic(market) === tab;
  }
}

/** The tabs to show: All, each other tab with an open market in it, and the calendar. A tab
 * whose markets have all closed or resolved would list nothing to trade. */
export function visibleTabs(markets: readonly MarketView[]): MarketTab[] {
  const open = markets.filter((market) => market.lifecycle === "open");
  return MARKET_TABS.filter(
    (tab) =>
      tab === "All" || tab === CALENDAR_TAB || open.some((market) => inMarketTab(market, tab)),
  );
}
