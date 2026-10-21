/** Read-only visual QA fixtures. Trading must be exercised against the actual local anvil node. */
import { parsePriceRawX18, parseShareAmount } from "@conditional-stocks/domain";
import { fixtureMarkets, fixtureState } from "./protocol";

if (process.env.PROBABL_UI_FIXTURE !== "1")
  throw new Error("Set PROBABL_UI_FIXTURE=1 for local visual QA.");
const markets = fixtureMarkets.map((m) => ({
  ...m,
  cutoff: new Date(Date.now() + 86_400_000).toISOString(),
}));
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
Bun.serve({
  hostname: "127.0.0.1",
  port: 4305,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method !== "GET")
      return json(
        {
          error: {
            message:
              "Visual fixtures cannot sign or settle transactions. Use the local anvil stack.",
          },
        },
        405,
      );
    if (path === "/health") return json({ healthy: true, fixture: true });
    if (path === "/markets")
      return json({
        markets: markets.map((m) => ({
          ...m,
          state: 2,
          tradingCutoff: String(Date.parse(m.cutoff) / 1000),
          tradingOpen: String(Date.parse(m.tradingOpen) / 1000),
          eventConditionId: m.mapping.conditionId,
          eventYesIndex: "1",
          eventNoIndex: "2",
          quoteSymbol: "USDC",
          quoteName: "USD Coin",
        })),
      });
    const market = markets.find((m) => path.includes(m.id));
    if (path.startsWith("/orderbook/") && market)
      return json({
        orders: [0, 1].flatMap((branch) =>
          [0, 1].flatMap((side) => {
            const book = branch === 0 ? market.yes : market.no;
            return (side === 0 ? book.bids : book.asks).map((level) => ({
              branch,
              side,
              limitPriceRawX18: String(parsePriceRawX18(level.priceExact, market)),
              remaining: String(parseShareAmount(String(level.quantity), market)),
            }));
          }),
        ),
        truncated: false,
      });
    const eventOf = (m: (typeof markets)[number]) => ({
      metadata: {
        normalized: {
          question: m.question,
          rules: m.description,
          asset: { symbol: m.ticker },
          canonicalUrl: "https://polymarket.com",
        },
      },
      probability: null,
    });
    if (path === "/v1/events") {
      const ids = (new URL(request.url).searchParams.get("markets") ?? "").split(",");
      return json({
        events: Object.fromEntries(
          ids.flatMap((id) => {
            const m = markets.find((candidate) => candidate.id === id);
            return m ? [[id, eventOf(m)]] : [];
          }),
        ),
      });
    }
    if (path.endsWith("/event") && market) return json(eventOf(market));
    if (path === "/trades") return json({ trades: fixtureState.trades });
    if (path === "/orders") return json({ orders: fixtureState.orders });
    if (path.startsWith("/positions/")) return json({ positions: fixtureState.positions });
    if (path.startsWith("/payouts/")) return json({ payouts: [], nextCursor: null });
    return json({ error: { message: "Fixture endpoint unavailable" } }, 404);
  },
});
