import { describe, expect, test } from "bun:test";
import {
  formatPriceRawX18,
  formatShareAmount,
  MAX_ORDER_UINT128,
  parsePriceRawX18,
  parseShareAmount,
  parseTokenAmount,
  quoteForReservation,
} from "@conditional-stocks/domain";
import { conditionalStocksAbi, position } from "@conditional-stocks/evm-client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decodeFunctionData } from "viem";
import { OutcomePrice } from "../src/components/market/OutcomePrice";
import { resolvingSoon } from "../src/lib/markets/calendar";
import {
  CALENDAR_TAB,
  CATEGORY_TABS,
  eventTime,
  inMarketTab,
  isPriceLadder,
  ladderCadence,
  marketTabFromPathname,
  marketTabFromSlug,
  marketTabPath,
  marketTabSlug,
  marketTopic,
  visibleTabs,
} from "../src/lib/markets/categories";
import { impactLine } from "../src/lib/markets/history";
import { groupMarkets, impactPercent, midpoint } from "../src/lib/markets/presentation";
import { outcomeLabel, safeExternalUrl } from "../src/lib/markets/resolution";
import { conditionalPositionRows } from "../src/lib/portfolio/positions";
import {
  csvCell,
  orderHistoryCsv,
  tradeHistoryCsv,
  walletTradeRows,
  wholeReserved,
} from "../src/lib/portfolio/presentation";
import { createActionScope } from "../src/lib/trading/action-scope";
import { marketPriceBasis, marketPriceBound, quantityForSpend } from "../src/lib/trading/entry";
import { previewOrder } from "../src/lib/trading/order";
import { MarketDetailPageSkeleton } from "../src/modules/MarketDetailPageModule/components/MarketDetailPageSkeleton";
import { MarketsPageSkeleton } from "../src/modules/MarketsPageModule/components/MarketsPageSkeleton";
import { mergeOrderPages } from "../src/services/orders";
import { createUiStore } from "../src/stores/ui-store";
import type { MarketView } from "../src/types/api";
import { fixtureMarkets, fixtureState as state } from "./fixtures/protocol";

const market = required(fixtureMarkets[0]);
function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing test fixture.");
  return value;
}
const exchange = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
describe("market tab routes", () => {
  test("maps every tab to its canonical URL and back, and rejects unknown slugs", () => {
    expect(marketTabPath("All")).toBe("/");
    expect(marketTabPath(CALENDAR_TAB)).toBe("/calendar");
    expect(marketTabPath("Price Ladder")).toBe("/category/price-ladder");
    for (const tab of CATEGORY_TABS) {
      expect(marketTabFromSlug(marketTabSlug(tab))).toBe(tab);
      expect(marketTabFromPathname(`${marketTabPath(tab)}/`)).toBe(tab);
    }
    expect(marketTabFromSlug("all")).toBeNull();
    expect(marketTabFromSlug("unknown")).toBeNull();
    expect(marketTabFromPathname("/")).toBe("All");
    expect(marketTabFromPathname("/calendar")).toBe(CALENDAR_TAB);
    expect(marketTabFromPathname("/markets/example")).toBeNull();
  });
});
describe("markets loading state", () => {
  test("reserves the banner and responsive card grid without loading text", () => {
    const html = renderToStaticMarkup(createElement(MarketsPageSkeleton, { view: "Feed" }));
    expect(html).toContain('aria-busy="true"');
    // The banner's featured event and most traded cards, then six event cards.
    expect(html.match(/data-variant="market"/g)).toHaveLength(2 + 6);
    expect(html.match(/data-slot="skeleton"/g)?.length).toBeGreaterThan(30);
    expect(html).not.toContain("Loading...");
  });
  test("reserves the complete market workspace without fallback loading copy", () => {
    const html = renderToStaticMarkup(createElement(MarketDetailPageSkeleton));
    expect(html).toContain('aria-label="Loading market"');
    for (const region of ["stats", "chart", "book", "ticket", "information"])
      expect(html).toContain(`market-workspace-${region}`);
    expect(html.match(/data-slot="skeleton"/g)?.length).toBeGreaterThan(50);
    expect(html).not.toContain("Loading...");
  });
});
describe("category featured markets", () => {
  test("resolving soon: the next three calendar entries still trading, each its most traded market", () => {
    const now = Date.UTC(2026, 9, 22, 12);
    const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
    const listed = (
      id: string,
      hours: number,
      patch: Partial<MarketView> = {},
      event: Partial<NonNullable<MarketView["event"]>> = {},
    ) =>
      ({
        ...market,
        id,
        lifecycle: "open",
        cutoff: at(hours - 0.5),
        event: { endTime: at(hours), result: null, ...event },
        mapping: { ...market.mapping, conditionId: `0x${id.padStart(64, "0")}` },
        ...patch,
      }) as MarketView;
    // Two strikes of one Kalshi ladder fix together: one calendar entry, shown by its busier strike.
    const ladder = (id: string, level: string, volume24h: number) =>
      listed(
        id,
        2,
        {
          question: `Bitcoin price on Oct 22, 2026: $${level} or above?`,
          volume24h,
          mapping: {
            ...market.mapping,
            source: "kalshi",
            conditionId: `0x${id.padStart(64, "0")}`,
          },
        },
        { series: "KXBTCD", eventTicker: "KXBTCD-26OCT2217" },
      );
    const markets = [
      listed("a1", 30),
      ladder("b1", "84,500", 10),
      ladder("b2", "85,250", 90),
      listed("c1", 5),
      listed("d1", -1),
      listed("e1", 1, { lifecycle: "awaiting-resolution" }),
      listed("f1", 50),
    ];
    expect(resolvingSoon(markets, now).map((m) => m.id)).toEqual(["b2", "c1", "a1"]);
  });

  test("topics, price ladders and their cadence come from the venue series and the question", () => {
    const at = (hours: number) =>
      new Date(Date.UTC(2026, 9, 21, 12) + hours * 3_600_000).toISOString();
    const listed = (
      question: string,
      event: Partial<NonNullable<MarketView["event"]>> = {},
      hours = 400 * 24,
    ) => ({
      ...market,
      question,
      tradingOpen: at(0),
      cutoff: at(hours - 0.5),
      event: { endTime: at(hours), result: null, ...event },
    });
    const cases: [ReturnType<typeof listed>, string, boolean, "daily" | "weekly" | null][] = [
      [listed("Will the U.S. invade Iran before 2027?"), "Geopolitics", false, null],
      [
        listed("Will the Fed increase interest rates by 25 bps after the December 2026 meeting?"),
        "Economy",
        false,
        null,
      ],
      [
        listed("Will CPI rise more than 0.2% in October 2026?", { series: "KXCPI" }),
        "Economy",
        false,
        null,
      ],
      [
        listed("Will NVIDIA be the largest company in the world by market cap on December 31?"),
        "Tech",
        false,
        null,
      ],
      [
        listed("Will Flávio Bolsonaro win the 2026 Brazilian presidential election?", {}, 96),
        "Politics",
        false,
        null,
      ],
      [
        listed(
          "Will the 7-day moving average of transit calls through the Strait of Hormuz be above 60?",
          { series: "KXHORMUZNORM" },
        ),
        "Geopolitics",
        false,
        null,
      ],
      [listed("Will Nvidia beat quarterly earnings?"), "Earnings", false, null],
      [
        listed("Bitcoin price on Oct 22, 2026: $83,500 or above?", { series: "KXBTCD" }, 20),
        "Crypto",
        true,
        "daily",
      ],
      [
        listed(
          "Will the gold close price be above 4134.99 USD/t.oz on October 23, 2026 at 5:00 PM EDT?",
          { series: "KXGOLDW" },
          72,
        ),
        "Commodities",
        true,
        "weekly",
      ],
      [
        listed(
          "Will the Nasdaq-100 be above 29609.99 at the end of Oct 21, 2026 at 4pm EDT?",
          { series: "KXNASDAQ100U" },
          20,
        ),
        "Stocks",
        true,
        "daily",
      ],
      [listed("Will Bitcoin reach $90,000 by December 31, 2026?"), "Crypto", true, null],
      [
        listed("Will the maximum WTI front month settle price reach $120.01 by Dec 31, 2026?", {
          series: "KXWTIMAX",
        }),
        "Commodities",
        true,
        null,
      ],
    ];
    for (const [m, topic, ladder, cadence] of cases) {
      expect(marketTopic(m), m.question).toBe(topic as ReturnType<typeof marketTopic>);
      expect(isPriceLadder(m), m.question).toBe(ladder);
      expect(ladderCadence(m), m.question).toBe(cadence);
    }
    // A runoff's stale venue date (the first round's) yields to the later trading cutoff.
    expect(eventTime({ ...listed("x", {}, 96), event: { endTime: at(-400), result: null } })).toBe(
      Date.parse(at(95.5)),
    );
    // Daily, weekly and price-ladder tabs; the topics with markets; the calendar last.
    const tabs = visibleTabs(cases.map(([m]) => m) as never);
    expect(tabs.slice(0, 5)).toEqual(["All", "Daily", "Weekly", "Price Ladder", "Earnings"]);
    expect(tabs.at(-1)).toBe(CALENDAR_TAB);
    expect(inMarketTab(cases[7]![0], "Daily") && !inMarketTab(cases[7]![0], "Weekly")).toBe(true);
    expect(visibleTabs([market])).not.toContain("Geopolitics");
  });
});
describe("canonical order windows", () => {
  test("keeps older resting orders and prefers the newest update across reads", () => {
    const order = required(state.orders[0]);
    const newer = { ...order, id: "recent", status: "cancelled", updatedBlock: "12" };
    const stale = { ...newer, status: "open", updatedBlock: "11" };
    const oldOpen = { ...order, id: "older-open", updatedBlock: "1" };
    const result = mergeOrderPages(
      { orders: [newer], truncated: true },
      { orders: [stale, oldOpen] },
    );
    expect(result.orders).toEqual([newer, oldOpen]);
    expect(result.truncated).toBe(true);
    expect(result.openTruncated).toBe(false);
  });
  test("reports the open-order cap independently of history", () => {
    expect(mergeOrderPages({ orders: [] }, { orders: [], truncated: true })).toEqual({
      orders: [],
      truncated: false,
      openTruncated: true,
    });
  });
});
describe("token amount entry", () => {
  for (const [shareDecimals, quoteTokenDecimals] of [
    [18, 6],
    [8, 6],
    [6, 18],
    [6, 6],
    [0, 6],
  ] as const) {
    test(`spend rounds inward for ${shareDecimals}/${quoteTokenDecimals} base/quote decimals`, () => {
      const m = {
        ...market,
        shareDecimals,
        quoteTokenDecimals,
        baseStep: "1",
      };
      for (const spend of ["1", "10", "12345"]) {
        const expectedRaw =
          (parseTokenAmount(spend, quoteTokenDecimals) * 10n ** 18n) / parsePriceRawX18("0.37", m);
        if (expectedRaw >= 1n << 96n) {
          expect(() => quantityForSpend(spend, "0.37", m)).toThrow();
          continue;
        }
        const quantity = quantityForSpend(spend, "0.37", m),
          raw = parseShareAmount(quantity, m);
        const price = parsePriceRawX18("0.37", m),
          budget = parseTokenAmount(spend, m.quoteTokenDecimals);
        expect(raw > 0n).toBe(true);
        expect(quoteForReservation(raw, price) <= budget).toBe(true);
        expect(quoteForReservation(raw + 1n, price) > budget).toBe(true);
      }
    });
  }
  test("quantity step and dust fail before a signature", () => {
    const m = { ...market, baseStep: "1000000000000000" };
    expect(previewOrder("0.001", "100", m).valid).toBe(true);
    expect(previewOrder("0.0001", "100", m).valid).toBe(false);
    expect(previewOrder("1", "0.000001", { ...m, baseStep: "0" }).valid).toBe(false);
    expect(previewOrder("0.000001", "0.000001", { ...m, baseStep: "1" }).valid).toBe(false);
    expect(previewOrder("0.0000001", "1", { ...m, baseStep: "1" }).valid).toBe(false);
    expect(parseShareAmount(quantityForSpend("1", "3", m), m) % BigInt(m.baseStep)).toBe(0n);
  });
  test("invalid input, uint128 overflow, and insufficient budgets are rejected", () => {
    for (const spend of [
      "-1",
      "NaN",
      "Infinity",
      "1e3",
      "0",
      "0.0000001",
      "999999999999999999999999999999999999999999999",
    ])
      expect(() => quantityForSpend(spend, "100", market)).toThrow();
    expect(() => quantityForSpend("0.000001", "100", market)).toThrow();
    expect(
      previewOrder((MAX_ORDER_UINT128 + 1n).toString(), "1", { ...market, shareDecimals: 0 }).valid,
    ).toBe(false);
  });
  test("market IOC bounds align with the tick grid without widening the 1% bound", () => {
    const m = { ...market, priceTickRawX18: "10000" };
    for (const branch of ["YES", "NO"] as const)
      for (const side of ["buy", "sell"] as const) {
        const book = branch === "YES" ? m.yes : m.no;
        const reference = parsePriceRawX18(
          required(side === "buy" ? book.bestAskExact : book.bestBidExact),
          m,
        );
        const bound = parsePriceRawX18(marketPriceBound(m, branch, side), m);
        expect(bound % 10000n).toBe(0n);
        expect(
          side === "buy"
            ? bound * 10000n <= reference * 10100n
            : bound * 10000n >= reference * 9900n,
        ).toBe(true);
      }
    expect(() =>
      marketPriceBound({ ...market, yes: { ...market.yes, bestAskExact: null } }, "YES", "buy"),
    ).toThrow();
    for (const bps of [-1, 1.1, 10000, Number.NaN])
      expect(() => marketPriceBound(market, "YES", "buy", bps)).toThrow();
  });
  test("with no book on its side, a market order is bounded 5% off the token's reference price", () => {
    const now = Math.floor(Date.now() / 1000);
    const empty = { ...market.yes, bestAskExact: null, bestBidExact: null };
    const m = {
      ...market,
      priceTickRawX18: "10000",
      yes: empty,
      spotReference: {
        token: market.base.token,
        symbol: market.ticker,
        source: "robinhood:TEST",
        kind: "stock" as const,
        status: "available" as const,
        priceUsd: 100,
        priceTimestamp: now,
        fetchedAt: now,
        valuationCompatible: false,
      },
    };
    expect(marketPriceBasis(m, "YES", "buy")).toBe("reference");
    expect(marketPriceBasis(market, "YES", "buy")).toBe("book");
    const { spotReference: _, ...unpriced } = m;
    expect(marketPriceBasis(unpriced, "YES", "buy")).toBeNull();
    const reference = parsePriceRawX18("100", m);
    const buy = parsePriceRawX18(marketPriceBound(m, "YES", "buy"), m);
    const sell = parsePriceRawX18(marketPriceBound(m, "YES", "sell"), m);
    expect(buy % 10000n).toBe(0n);
    expect(buy * 10000n <= reference * 10500n && buy * 10000n > reference * 10400n).toBe(true);
    expect(sell * 10000n >= reference * 9500n && sell * 10000n < reference * 9600n).toBe(true);
  });
});
describe("wallet action scoping", () => {
  test("double clicks cannot start a second action", () => {
    const scope = createActionScope("walletA:order1"),
      action = required(scope.begin());
    expect(scope.begin()).toBeNull();
    action.assertCurrent();
    action.finish();
    expect(scope.begin()).not.toBeNull();
  });
  test("account changes, form edits, A-B-A transitions and unmount invalidate outstanding work", () => {
    for (const next of ["walletB:order1", "walletA:order2"]) {
      const scope = createActionScope("walletA:order1"),
        action = required(scope.begin());
      scope.update(next);
      scope.update("walletA:order1");
      expect(() => action.assertCurrent()).toThrow("changed");
    }
    const scope = createActionScope("wallet"),
      action = required(scope.begin());
    scope.dispose();
    scope.mount();
    expect(() => action.assertCurrent()).toThrow("changed");
  });
  test("provider-scoped stores share no wallet intent or filters between requests", () => {
    const a = createUiStore(),
      b = createUiStore();
    a.getState().setFilters({ category: "Economy", view: "Matrix" });
    a.getState().setPrefill({
      intent: "close",
      marketId: market.id,
      branch: "NO",
      quantity: "0.5",
      nonce: 1,
    });
    expect(b.getState().filters.category).toBe("All");
    expect(b.getState().prefill).toBeNull();
    expect(a.getState().filters.category).toBe("Economy");
    expect(Object.keys(a.getState()).some((key) => /token|session|secret/i.test(key))).toBe(false);
  });
});
describe("claim transaction construction", () => {
  test("split and merge bind the market, collateral and exact raw amount", () => {
    for (const action of ["split", "merge"] as const) {
      const { functionName, args } = decodeFunctionData({
        abi: conditionalStocksAbi,
        data: position(exchange, action, 7, 0, 1_000_001n).data,
      });
      expect(functionName).toBe(action);
      expect(args).toEqual([7, 0, 1_000_001n]);
    }
    expect(() => position(exchange, "split", 7, 2, 1n)).toThrow();
  });
});
describe("honest market, portfolio and evidence presentation", () => {
  test("one-sided, crossed and missing books never imply a midpoint or zero price", () => {
    expect(midpoint({ ...market.yes, bestBid: null })).toBeNull();
    expect(midpoint({ ...market.yes, bestBid: 101, bestAsk: 100 })).toBeNull();
    expect(impactPercent({ ...market, no: { ...market.no, bestAsk: null } })).toBeNull();
    expect(
      impactPercent({
        ...market,
        yes: { ...market.yes, bestBid: 199, bestAsk: 201 },
        no: { ...market.no, bestBid: 99, bestAsk: 101 },
      }),
    ).toBe(100);
  });
  test("market card labels one-sided executable quotes without inventing a midpoint", () => {
    const askOnly = renderToStaticMarkup(
      createElement(OutcomePrice, {
        market: { ...market, yes: { ...market.yes, bestBid: null } },
        branch: "YES",
      }),
    );
    expect(askOnly).toContain("Ask");
    expect(askOnly).not.toContain("spot impact unavailable</span>");
    const crossed = renderToStaticMarkup(
      createElement(OutcomePrice, {
        market: { ...market, yes: { ...market.yes, bestBid: 101, bestAsk: 100 } },
        branch: "YES",
      }),
    );
    expect(crossed).not.toContain("Ask</span>");
    expect(crossed).toContain("—");
  });
  test("event grouping follows immutable Polymarket identity across local windows and states", () => {
    const pair = { ...market, id: `0x${"12".repeat(32)}`, ticker: "TSLA" };
    expect(groupMarkets([market, pair])).toHaveLength(1);
    expect(groupMarkets([market, { ...pair, cutoff: "different" }])).toHaveLength(1);
    expect(groupMarkets([market, { ...pair, lifecycle: "resolved" as const }])).toHaveLength(1);
    expect(
      groupMarkets([market, { ...pair, mapping: { ...pair.mapping, noIndex: "4" } }]),
    ).toHaveLength(2);
    expect(
      groupMarkets([
        market,
        { ...pair, mapping: { ...pair.mapping, conditionId: `0x${"34".repeat(32)}` } },
      ]),
    ).toHaveLength(2);
  });
  test("event grouping deduplicates retried markets for the same asset", () => {
    const retry = {
      ...market,
      id: `0x${"99".repeat(32)}`,
      tradingOpen: "2099-02-01T00:00:00.000Z",
    };
    const [group] = groupMarkets([retry, market]);
    expect(group).toHaveLength(1);
    expect(group?.[0]?.id).toBe(market.id);
    const frozen = { ...market, lifecycle: "frozen" as const };
    expect(groupMarkets([frozen, retry])[0]?.[0]?.id).toBe(retry.id);
  });
  test("whole-asset reservations follow the funding token of each order", () => {
    const order = {
      ...required(state.orders[0]),
      marketId: market.id,
      status: "open",
      fundingKind: 0,
      side: 1,
      reserved: "9",
    };
    const orders = [
      order,
      { ...order, id: "b", reserved: "4" },
      { ...order, id: "c", side: 0, reserved: "1" },
    ];
    expect(wholeReserved(market.base.token, orders, [market])).toBe(13n);
    expect(wholeReserved(market.quoteToken, orders, [market])).toBe(1n);
  });
  test("whole-asset reservations exclude claim collateral and closed orders", () => {
    const order = {
      ...required(state.orders[0]),
      marketId: market.id,
      status: "open",
      fundingKind: 0,
      side: 0,
      reserved: "123",
    };
    expect(
      wholeReserved(
        market.quoteToken,
        [
          order,
          { ...order, fundingKind: 1 },
          { ...order, status: "cancelled" },
          { ...order, side: 1 },
        ],
        [market],
      ),
    ).toBe(123n);
  });
  test("sibling event markets keep their USDC claims and reservations separate", () => {
    const baseOrder = required(state.orders[0]);
    const basePosition = required(state.positions[0]);
    const secondMarket = {
      ...market,
      id: `0x${"31".repeat(32)}`,
      assetKey: "asset:SPY",
      ticker: "SPY",
    };
    const rows = conditionalPositionRows(
      [market, secondMarket],
      [basePosition, { ...basePosition, marketId: secondMarket.id }],
      [
        {
          ...baseOrder,
          status: "open",
          fundingKind: 1,
          side: 0,
          branch: 0,
          reserved: "123",
        },
        {
          ...baseOrder,
          id: `0x${"33".repeat(32)}`,
          marketId: secondMarket.id,
          status: "open",
          fundingKind: 1,
          side: 0,
          branch: 0,
          reserved: "77",
        },
        {
          ...baseOrder,
          id: `0x${"34".repeat(32)}`,
          status: "open",
          fundingKind: 1,
          side: 1,
          branch: 0,
          reserved: "55",
        },
      ],
    );
    const quoteRows = rows.filter((row) => row.kind === "quote");
    expect(quoteRows).toHaveLength(4);
    expect(quoteRows.map((row) => `${row.symbol}-${row.branch === 0 ? "YES" : "NO"}`)).toEqual([
      "USDC-YES",
      "USDC-NO",
      "USDC-YES",
      "USDC-NO",
    ]);
    expect(quoteRows[0]?.reserved).toBe(123n);
    expect(quoteRows[2]?.reserved).toBe(77n);
    // Claim reservations stay with the market's own stock claims.
    expect(rows.find((row) => row.key === `stock-${market.id}-0`)?.reserved).toBe(55n);
    expect(rows.find((row) => row.key === `stock-${market.id}-1`)?.reserved).toBe(0n);
    const stock = rows.filter((row) => row.kind === "stock" && row.market.id === market.id);
    expect(stock.map((row) => `${row.symbol}-${row.branch === 0 ? "YES" : "NO"}`)).toEqual([
      "NVDA-YES",
      "NVDA-NO",
    ]);
    expect(stock.map((row) => row.decimals)).toEqual([18, 18]);
  });
  test("invalid payout is not incorrectly reported YES merely because numerator is one", () => {
    const r = {
      admin: null,
      evidenceHash: null,
      evidenceUri: null,
      transactionHash: null,
      yesPayout: "1",
      noPayout: "1",
      payoutDenominator: "2",
    };
    expect(outcomeLabel(r)).toBe("Invalid · 50/50");
    expect(outcomeLabel({ ...r, noPayout: "0", payoutDenominator: "1" })).toBe("YES");
    expect(outcomeLabel({ ...r, yesPayout: "0", payoutDenominator: "1" })).toBe("NO");
    expect(outcomeLabel({ ...r, payoutDenominator: "0" })).toBe("Unverified payout");
    expect(outcomeLabel(null)).toBe("Pending");
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "http://evil.test",
      "https://user:pass@host.test",
      "/local",
    ])
      expect(safeExternalUrl(url)).toBeNull();
    expect(safeExternalUrl("https://example.com/evidence")).toBe("https://example.com/evidence");
  });
  test("CSV escapes labels and spreadsheet formula injection without losing exact raw-unit quantities", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
    expect(csvCell("\t@SUM(A1)")).toContain("'");
    const order = {
      ...required(state.orders[0]),
      marketId: market.id,
      quantity: "1000001",
      filled: "1",
      limitPriceRawX18: "123456789",
    };
    const csv = orderHistoryCsv([order], [market]);
    expect(csv.split("\r\n")[0]).toContain('"Limit (USDC)"');
    expect(csv).toContain(formatShareAmount(1000001n, market));
    expect(csv).toContain(formatPriceRawX18(123456789n, market));
    expect(csv).toContain("Updated block");
  });
  test("wallet trade history includes only fills belonging to the connected wallet orders", () => {
    const order = required(state.orders[0]);
    const trade = {
      ...required(state.trades[0]),
      takerOrderHash: order.id,
      makerOrderHash: `0x${"44".repeat(32)}`,
      executionQuote: "255250000",
    };
    const unrelated = {
      ...trade,
      id: `0x${"55".repeat(32)}`,
      takerOrderHash: `0x${"66".repeat(32)}`,
    };
    const rows = walletTradeRows([trade, unrelated], [order], [market]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.side).toBe("Buy");
    expect(tradeHistoryCsv(rows)).toContain('"255.25"');
  });
  test("wallet trade history identifies self-matches without double-counting the fill", () => {
    const buy = required(state.orders[0]);
    const sell = { ...buy, id: `0x${"77".repeat(32)}`, side: 1 };
    const trade = {
      ...required(state.trades[0]),
      takerOrderHash: buy.id,
      makerOrderHash: sell.id,
    };
    const rows = walletTradeRows([trade], [buy, sell], [market]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.side).toBe("Self-match");
  });
  test("wallet trade history matches canonical maker and taker order keys", () => {
    const buy = required(state.orders[0]);
    const sell = { ...buy, id: "1099511627777", side: 1 };
    const makerFill = {
      ...required(state.trades[0]),
      makerOrderHash: sell.id,
      takerOrderHash: "unrelated-taker",
    };
    const takerFill = {
      ...required(state.trades[0]),
      id: "second-fill",
      makerOrderHash: "unrelated-maker",
      takerOrderHash: buy.id,
    };
    const rows = walletTradeRows([makerFill, takerFill], [buy, sell], [market]);
    expect(rows.map((row) => row.side)).toEqual(["Sell", "Buy"]);
  });
  test("impact is YES's premium over NO at each recorded time with both prices, no trade needed", () => {
    const impact = impactLine({
      yes: [
        { time: 60, value: 110 },
        { time: 120, value: 104 },
        { time: 180, value: 99 },
      ],
      no: [
        { time: 60, value: 100 },
        { time: 180, value: 110 },
      ],
    });
    expect(impact.map((p) => p.time)).toEqual([60, 180]);
    expect(impact[0]?.value).toBeCloseTo(10);
    expect(impact[1]?.value).toBeCloseTo(-10);
    expect(impactLine({ yes: [{ time: 60, value: 1 }], no: [] })).toEqual([]);
  });
});
