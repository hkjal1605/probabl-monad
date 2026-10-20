export const gammaMarket = (overrides: Record<string, unknown> = {}) => ({
  active: true,
  clobTokenIds: JSON.stringify(["111", "222"]),
  closed: false,
  conditionId: `0x${"12".repeat(32)}`,
  description: "This market resolves Yes if the stated event occurs.",
  endDate: "2027-01-01T00:00:00Z",
  id: "gamma-42",
  negRisk: false,
  outcomes: JSON.stringify(["Yes", "No"]),
  question: "Will the event occur?",
  resolutionSource: "Official publication",
  slug: "will-the-event-occur",
  umaResolutionStatus: "unresolved",
  ...overrides,
});

export const bookSnapshot = (overrides: Record<string, unknown> = {}) => ({
  asks: [
    { price: "0.52", size: "400" },
    { price: "0.53", size: "100" },
  ],
  asset_id: "111",
  bids: [
    { price: "0.48", size: "400" },
    { price: "0.47", size: "100" },
  ],
  hash: "snapshot-1",
  market: `0x${"12".repeat(32)}`,
  timestamp: "1767225600000",
  ...overrides,
});

/** A Kalshi snapshot as the ingestor stores it: `GET /markets/{ticker}` and its event. */
export const kalshiSnapshot = (
  market: Record<string, unknown> = {},
  event: Record<string, unknown> = {},
) => ({
  market: {
    close_time: "2026-12-09T18:59:00Z",
    event_ticker: "KXFEDDECISION-26DEC",
    market_type: "binary",
    result: "",
    rules_primary:
      "If the Federal Reserve hikes rates by 25bps at its December 2026 meeting, then the market resolves to Yes.",
    rules_secondary: " ",
    status: "active",
    ticker: "KXFEDDECISION-26DEC-H25",
    title: "Will the Federal Reserve Hike rates by 25bps at their December 2026 meeting?",
    yes_bid_dollars: "0.7700",
    yes_sub_title: "Hike 25bps",
    ...market,
  },
  event: {
    event_ticker: "KXFEDDECISION-26DEC",
    series_ticker: "KXFEDDECISION",
    settlement_sources: [{ name: "Federal Reserve", url: "https://www.federalreserve.gov" }],
    title: "Fed decision in Dec 2026?",
    ...event,
  },
});
