/** Demo catalogue for local and testnet deployments: live binary Polymarket events, each
 * listing three stock tokens it plausibly moves. One issuer per chain, so an asset is one
 * token and one market per event. */
import { catalogAsset } from "../../packages/shared/src/token-catalog.ts";

export type SeedCategory = "Macro" | "Earnings" | "Policy" | "Other";
export const MARKET_TICKERS = [
  "NVDA",
  "TSLA",
  "SPY",
  "QQQ",
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOGL",
  "MU",
  "COIN",
  "HOOD",
  "PLTR",
] as const;
export type SeedTicker = (typeof MARKET_TICKERS)[number];

/** Demo fee rates in whole bps, by category, so the local catalogue shows markets with
 * different maker and taker fees. Every maker rate stays within the demo Δ-vault's 1% fee cap. */
export const DEMO_FEES: Record<SeedCategory, { makerFeeBps: string; takerFeeBps: string }> = {
  Macro: { makerFeeBps: "0", takerFeeBps: "10" },
  Earnings: { makerFeeBps: "5", takerFeeBps: "25" },
  Policy: { makerFeeBps: "10", takerFeeBps: "30" },
  Other: { makerFeeBps: "0", takerFeeBps: "0" },
};

export interface SeedMarket {
  category: SeedCategory;
  gammaMarketId: string;
  slug: string;
  question: string;
  tickers: readonly [SeedTicker, SeedTicker, SeedTicker];
}

export const DEMO_MARKET_SEED: readonly SeedMarket[] = [
  {
    category: "Macro",
    gammaMarketId: "690215",
    slug: "will-the-feds-lower-bound-reach-2pt75-or-lower-before-2027-448-727-854",
    question: "Will the Fed’s lower bound reach 2.75% or lower before 2027?",
    // Rate cuts: long-duration mega-caps and the broad indices.
    tickers: ["AAPL", "SPY", "QQQ"],
  },
  {
    category: "Macro",
    gammaMarketId: "609655",
    slug: "us-recession-by-end-of-2026",
    question: "US recession by end of 2026?",
    tickers: ["NVDA", "TSLA", "SPY"],
  },
  {
    category: "Other",
    gammaMarketId: "691340",
    slug: "ai-industry-downturn-by-december-31-2026-857",
    question: "AI bubble burst in 2026?",
    // The AI trade: the GPU supplier, HBM memory and the largest AI platform.
    tickers: ["NVDA", "MU", "MSFT"],
  },
  {
    category: "Other",
    gammaMarketId: "2413330",
    slug: "will-anthropic-ipo-by-december-31-2026-546-128-719",
    question: "Will Anthropic IPO by December 31, 2026?",
    // Anthropic's two largest strategic investors and the leading lab's partner.
    tickers: ["AMZN", "GOOGL", "MSFT"],
  },
  {
    category: "Other",
    gammaMarketId: "656312",
    slug: "will-openai-ipo-by-december-31-2026",
    question: "Will OpenAI IPO by December 31 2026?",
    // OpenAI's partner, its rival's backer, and the retail IPO venue.
    tickers: ["MSFT", "AMZN", "HOOD"],
  },
  {
    category: "Other",
    gammaMarketId: "2252540",
    slug: "tesla-and-spacex-merger-officially-announced-by-december-31",
    question: "Tesla and SpaceX merger officially announced by December 31?",
    // The merger party, its GPU supplier, and SpaceX's large early investor.
    tickers: ["TSLA", "NVDA", "GOOGL"],
  },
  {
    category: "Policy",
    gammaMarketId: "1163699",
    slug: "clarity-act-signed-into-law-in-2026",
    question: "Clarity Act (H.R.3633) signed into law in 2026?",
    // US crypto market structure: the listed crypto brokers and the growth index.
    tickers: ["COIN", "HOOD", "QQQ"],
  },
  {
    category: "Other",
    gammaMarketId: "1343533",
    slug: "major-cex-insolvent-in-2026",
    question: "Major CEX insolvent in 2026?",
    tickers: ["COIN", "HOOD", "PLTR"],
  },
  {
    category: "Macro",
    gammaMarketId: "680951",
    slug: "will-inflation-reach-more-than-5-in-2026-282-763",
    question: "Will inflation reach more than 5% in 2026?",
    tickers: ["COIN", "SPY", "HOOD"],
  },
  {
    category: "Policy",
    gammaMarketId: "2382827",
    slug: "us-x-china-tariff-agreement-by-december-31",
    question: "US x China tariff agreement by December 31?",
    // Nvidia's China chip sales, Tesla's China factory, Apple's supply chain.
    tickers: ["NVDA", "TSLA", "AAPL"],
  },
  {
    category: "Policy",
    gammaMarketId: "1720308",
    slug: "law-banning-sports-prediction-markets-enacted-in-2026",
    question: "Law banning sports prediction markets enacted in 2026?",
    // Robinhood's prediction-market business and on-chain alternatives.
    tickers: ["HOOD", "COIN", "PLTR"],
  },
  {
    category: "Earnings",
    gammaMarketId: "1632674",
    slug: "sec-removes-quarterly-reporting-requirement",
    question: "SEC removes quarterly reporting requirement?",
    tickers: ["TSLA", "MSFT", "AMZN"],
  },
  {
    category: "Earnings",
    gammaMarketId: "4622920",
    slug: "mu-quarterly-earnings-nongaap-eps-09-30-2026-32pt22",
    question: "Will Micron (MU) beat quarterly earnings?",
    // Micron's HBM feeds Nvidia GPUs: an AI-compute and S&P read-through.
    tickers: ["MU", "NVDA", "SPY"],
  },
  {
    category: "Earnings",
    gammaMarketId: "4572598",
    slug: "tesla-roadster-delivered-by-december-31-2026",
    question: "Tesla Roadster delivered by December 31, 2026?",
    tickers: ["TSLA", "GOOGL", "SPY"],
  },
] as const;

const categoryFor = (question: string): SeedCategory => {
  const value = question.toLowerCase();
  if (/fed|rate|inflation|cpi|gdp|recession/.test(value)) return "Macro";
  if (/export|tariff|election|policy|ban|regulat|\bact\b|\blaw\b/.test(value)) return "Policy";
  if (/revenue|earnings|deliver|quarter|profit/.test(value)) return "Earnings";
  return "Other";
};

export function validateMarketSeed(markets: readonly SeedMarket[] = DEMO_MARKET_SEED) {
  if (new Set(markets.map((market) => market.gammaMarketId)).size !== markets.length)
    throw new Error("Duplicate Gamma market id");
  if (new Set(markets.map((market) => market.slug)).size !== markets.length)
    throw new Error("Duplicate Polymarket slug");
  for (const market of markets) {
    if (
      !/^[1-9][0-9]*$/.test(market.gammaMarketId) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(market.slug)
    )
      throw new Error("Invalid Polymarket identity");
    if (categoryFor(market.question) !== market.category)
      throw new Error(`Question does not render under ${market.category}: ${market.slug}`);
    if (
      market.tickers.length !== 3 ||
      new Set(market.tickers).size !== 3 ||
      market.tickers.some((ticker) => !MARKET_TICKERS.includes(ticker))
    )
      throw new Error(`Every event lists three distinct assets: ${market.slug}`);
  }
  for (const ticker of MARKET_TICKERS) {
    if (!catalogAsset(ticker)) throw new Error(`${ticker} has no catalogued reference price`);
    if (markets.filter((market) => market.tickers.includes(ticker)).length < 2)
      throw new Error(`${ticker} is tied to fewer than two events`);
  }
  for (const category of ["Macro", "Earnings", "Policy", "Other"] as const)
    if (markets.filter((market) => market.category === category).length < 3)
      throw new Error(`Missing ${category} events`);
  return markets;
}
