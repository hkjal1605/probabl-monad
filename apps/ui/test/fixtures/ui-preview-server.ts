/** Local-only upstream fixtures for browser QA. No external network calls, keys or chain writes. */
import { conditionalTokensAbi } from "@conditional-stocks/contract-bindings";
import {
  hashOrder,
  parsePriceRawX18,
  parseTokenAmount,
  quoteForReservation,
} from "@conditional-stocks/domain";
import { parseOrder } from "@conditional-stocks/gateway";
import { decodeFunctionData, encodeFunctionData, erc20Abi, type Hex } from "viem";
import { createDemoState, DEMO_ACCOUNT, demoMarkets } from "../../src/lib/demo/engine";
import { atomicTransaction } from "../../src/lib/trading/atomic";
import { positionAction } from "../../src/lib/trading/positions";
import { orderRecovery, type RecoveryKind } from "../../src/lib/trading/recovery";
import { previewRpc } from "./ui-preview-rpc";

if (process.env.PROBABL_UI_FIXTURE !== "1")
  throw new Error(
    "Set PROBABL_UI_FIXTURE=1 explicitly. This server is for isolated local UI checks only.",
  );
const config = {
  chainId: 31337,
  exchange: "0x2000000000000000000000000000000000000002",
  atomicRouter: "0x3000000000000000000000000000000000000003",
  conditionalTokens: "0x5000000000000000000000000000000000000005",
  positionRouter: "0x6000000000000000000000000000000000000006",
  payoutVault: "0x7000000000000000000000000000000000000007",
};
const state = createDemoState();
const marketViews = demoMarkets(state).map((m) => ({
  ...m,
  cutoff: new Date(Date.now() + 86400000).toISOString(),
  sourceMode: "live" as const,
  description: "Browser QA fixture. Not a deployed market.",
  question: m.question.replace(/^Demo /, ""),
}));
const states = [
  "",
  "scheduled",
  "open",
  "frozen",
  "awaiting-resolution",
  "resolved",
  "redeemable",
  "archived",
];
const headers = {
  "access-control-allow-origin": "http://localhost:3005",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "cache-control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(
    JSON.stringify(body, (_, v) => (typeof v === "bigint" ? String(v) : v)),
    { status, headers: { ...headers, "content-type": "application/json" } },
  );
const approved = new Set<string>();
const requests: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4305,
  async fetch(request) {
    const url = new URL(request.url),
      path = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { headers });
    requests.push(`${request.method} ${path}`);
    if (requests.length > 500) requests.shift();
    if (path === "/qa/requests") return json(requests);
    if (path === "/markets")
      return json({
        markets: marketViews.map((m) => ({
          ...m,
          state: states.indexOf(m.lifecycle),
          tradingCutoff: String(Date.parse(m.cutoff) / 1000),
          tradingOpen: String(Math.floor(Date.parse(m.tradingOpen) / 1000)),
          polymarketConditionId: m.mapping.conditionId,
          polymarketYesIndex: "1",
          polymarketNoIndex: "2",
          priceTickRawX18: "1000",
        })),
      });
    const matchedMarket = marketViews.find((m) => path.includes(m.id));
    if (path.endsWith("/polymarket") && matchedMarket)
      return json({
        metadata: {
          normalized: {
            question: matchedMarket.question,
            rules: matchedMarket.description,
            asset: { symbol: matchedMarket.ticker },
            canonicalUrl: "https://polymarket.com",
          },
        },
        probability: {
          conditionId: matchedMarket.mapping.conditionId,
          quality: "valid",
          midpointX6: "570000",
          bestBidX6: "560000",
          bestAskX6: "580000",
          observedAtMs: String(Date.now()),
        },
      });
    if (path.startsWith("/orderbook/") && matchedMarket)
      return json({
        truncated: false,
        orders: ([0, 1] as const).flatMap((branch) =>
          ([0, 1] as const).flatMap((side) => {
            const book = branch === 0 ? matchedMarket.yes : matchedMarket.no;
            return (side === 0 ? book.bids : book.asks).map((level) => ({
              branch,
              side,
              limitPriceRawX18: String(parsePriceRawX18(level.priceExact, matchedMarket)),
              remaining: String(
                parseTokenAmount(String(level.quantity), matchedMarket.baseTokenDecimals),
              ),
            }));
          }),
        ),
      });
    if (path === "/orders")
      return json({
        orders: state.orders.map((o, i) => ({
          ...o,
          id: `0x${String(i + 1).padStart(64, "0")}`,
          maker: DEMO_ACCOUNT,
          expiry: String(Math.floor(Date.now() / 1000) + 3600),
        })),
        truncated: false,
      });
    if (path.startsWith("/positions/")) return json({ positions: state.positions });
    if (path.startsWith("/balances/")) {
      const token = url.searchParams.get("token") ?? "";
      const m = marketViews.find(
        (m) =>
          m.baseToken.toLowerCase() === token.toLowerCase() ||
          m.quoteToken.toLowerCase() === token.toLowerCase(),
      );
      return json({
        token,
        account: DEMO_ACCOUNT,
        canonicalBalance: state.balances[token.toLowerCase()] ?? "0",
        decimals:
          m?.quoteToken.toLowerCase() === token.toLowerCase()
            ? m.quoteTokenDecimals
            : (m?.baseTokenDecimals ?? 18),
        blockNumber: "100",
      });
    }
    if (path === "/trades")
      return json({
        trades: state.trades
          .filter((t) => t.marketId === url.searchParams.get("marketId"))
          .map((t, i) => ({
            ...t,
            id: `0x${String(i + 1).padStart(64, "0")}`,
            transactionHash: `0x${"ab".repeat(32)}`,
            blockTimestamp: String(Math.floor(Date.now() / 1000) - i * 60),
          })),
      });
    if (path.startsWith("/resolutions/")) {
      const m = state.markets.find((m) => m.view.id === matchedMarket?.id);
      return m?.resolution ? json(m.resolution) : json({ error: "not-found" }, 404);
    }
    if (path.startsWith("/payouts/"))
      return json({ vault: config.payoutVault, payouts: [], nextCursor: null });
    if (path === "/v1/system/readiness") return json({ healthy: true });
    if (path === "/v1/auth/challenge")
      return json({
        challengeId: "qa-only",
        message: "Sign in to the isolated local UI test. No real transaction or permission.",
      });
    if (path === "/v1/auth/verify") return json({ token: "qa-session-no-authority" });
    if (path === "/v1/orders/prepare") {
      const { order: wire } = (await request.json()) as { order: unknown };
      const order = parseOrder(wire),
        m = marketViews.find((m) => m.id === order.marketId);
      if (!m) return json({ error: { message: "Unknown fixture market" } }, 404);
      const amount =
        order.side === 0
          ? quoteForReservation(order.quantity, order.limitPriceRawX18)
          : order.quantity;
      const token = order.side === 0 ? m.quoteToken : m.baseToken;
      const key =
        order.fundingKind === 0 ? token.toLowerCase() : config.conditionalTokens.toLowerCase();
      const approvalCall = approved.has(key)
        ? null
        : order.fundingKind === 0
          ? {
              to: token,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [config.exchange as Hex, amount],
              }),
            }
          : {
              to: config.conditionalTokens,
              data: encodeFunctionData({
                abi: conditionalTokensAbi,
                functionName: "setApprovalForAll",
                args: [config.exchange as Hex, true],
              }),
            };
      return json({
        atomicRouter: config.atomicRouter,
        orderHash: hashOrder(order, { chainId: 31337n, verifyingContract: config.exchange as Hex }),
        funding: {
          approvalCall,
          approved: !approvalCall,
          balanceSufficient: true,
          amount: String(amount),
          assetKind: order.fundingKind === 0 ? (order.side === 0 ? "USDG" : m.ticker) : "claims",
        },
        notional: String(quoteForReservation(order.quantity, order.limitPriceRawX18)),
        plan: {
          makers: [],
          quantities: [],
          expectedRemaining: [],
          releaseOrders: [],
          guard: { nextSequence: "0", makerFeeBps: 0, takerFeeBps: 0 },
          deadline: String(Math.floor(Date.now() / 1000) + 60),
          filledQuantity: "0",
          remainingQuantity: String(order.quantity),
          executionQuote: "0",
        },
        typedData: null,
        payoff: null,
      });
    }
    if (path === "/v1/orders/transaction") {
      const body = (await request.json()) as { order: unknown; plan: unknown; signature: Hex };
      return json({
        ...atomicTransaction({ ...body, account: DEMO_ACCOUNT, config }),
        executionVersion: 2,
      });
    }
    if (/^\/v1\/orders\/(cancel|recovery)\/prepare$/.test(path)) {
      const body = (await request.json()) as { orderHash: string; kind: RecoveryKind };
      return json({ transaction: orderRecovery({ ...body, account: DEMO_ACCOUNT, config }) });
    }
    if (/^\/v1\/positions\/(merge|redeem)\/prepare$/.test(path)) {
      const body = (await request.json()) as {
          marketId: string;
          amount?: string;
          amounts?: string[];
          collateral: string;
          indexSets?: string[];
        },
        m = marketViews.find((m) => m.id === body.marketId),
        position = state.positions.find((p) => p.marketId === body.marketId);
      if (!m || !position) return json({ error: { message: "Missing market" } }, 404);
      const action = positionAction({
        kind: path.includes("/merge/") ? "merge" : "redeem",
        account: DEMO_ACCOUNT,
        conditionId: position.conditionId,
        amount: BigInt(body.amount ?? body.amounts?.[0] ?? "0"),
        collateralToken: body.collateral === "base" ? m.baseToken : m.quoteToken,
        branch: body.indexSets?.[0] === "2" ? "no" : "yes",
        config,
      });
      const isApproved = approved.has(config.conditionalTokens.toLowerCase());
      return json({
        ...action,
        approval: isApproved ? null : action.approval,
        approved: isApproved,
      });
    }
    if (path === "/qa/wallet-send") {
      const body = (await request.json()) as { to: string; data: Hex };
      try {
        const decoded = decodeFunctionData({ abi: erc20Abi, data: body.data });
        if (decoded.functionName === "approve") approved.add(String(body.to).toLowerCase());
      } catch {
        try {
          const decoded = decodeFunctionData({ abi: conditionalTokensAbi, data: body.data });
          if (decoded.functionName === "setApprovalForAll")
            approved.add(String(body.to).toLowerCase());
        } catch {
          /* Another reviewed transaction. */
        }
      }
      return json({ hash: `0x${"ab".repeat(32)}` });
    }
    if (path === "/rpc") {
      const body = (await request.json()) as { method: string; id: number; params?: unknown[] };
      try {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          result: previewRpc(body, marketViews, state.positions, approved),
        });
      } catch {
        return json({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: "RPC method not mocked in this UI fixture" },
        });
      }
    }
    return json({ error: { message: `No local fixture for ${path}` } }, 404);
  },
});
console.info(`Local UI fixtures listening at ${server.url}. No external writes are possible.`);
