import { describe, expect, test } from "bun:test";
import {
  parsePriceRawX18,
  parseTokenAmount,
  quoteForExecution,
  quoteForReservation,
} from "@conditional-stocks/domain";
import {
  applyDemoAction,
  createDemoState,
  DEMO_ACCOUNT,
  type DemoState,
  demoApprovalKey,
  demoMarkets,
  restoreDemoState,
  reviewDemoOrder,
} from "@/lib/demo/engine";
import { parseMode } from "@/lib/demo/mode";
import { createOrder } from "@/lib/trading/order";

const now = Date.parse("2026-09-07T12:00:00Z");
const stock = (amount: string) => parseTokenAmount(amount, 18);
const quote = (amount: string) => parseTokenAmount(amount, 6);
let salt = 10;
function candidate(state: DemoState, overrides: Partial<ReturnType<typeof createOrder>> = {}) {
  const market = state.markets[0]?.view;
  if (!market) throw new Error("Missing fixture");
  return {
    ...createOrder(
      {
        ...market,
        account: DEMO_ACCOUNT,
        marketId: market.id,
        branch: "YES",
        side: "buy",
        funding: "whole",
        quantity: "1",
        price: "260",
        tif: "gtc",
      },
      { nowMs: state.now, salt: `0x${(++salt).toString(16).padStart(64, "0")}` },
    ),
    ...overrides,
  };
}
function submit(state: DemoState, order = candidate(state)) {
  const approved = applyDemoAction(state, { type: "approve", key: demoApprovalKey(order, state) });
  return applyDemoAction(approved, { type: "submit", order });
}
function fixture() {
  return createDemoState(now);
}
function first(state: DemoState) {
  const market = state.markets[0];
  const position = state.positions[0];
  if (!market || !position) throw new Error("Missing fixture");
  return {
    market,
    position,
    base: market.view.baseToken.toLowerCase(),
    quote: market.view.quoteToken.toLowerCase(),
  };
}

describe("demo boundaries and fixtures", () => {
  test("live is the default and only the exact demo value opts in", () => {
    for (const value of [undefined, "", "preview", "true", "DEMO", "live"])
      expect(parseMode(value)).toBe("live");
    expect(parseMode("demo")).toBe("demo");
  });
  test("deterministic seed contains open, review, redeemable markets and coherent order history", () => {
    const state = fixture();
    expect(createDemoState(now)).toEqual(state);
    expect(demoMarkets(state).every((market) => market.sourceMode === "demo")).toBe(true);
    expect(new Set(state.markets.map((market) => market.view.ticker))).toEqual(
      new Set(["NVDA", "SPY", "TSLA"]),
    );
    expect(state.orders.map((order) => order.status)).toEqual(["filled", "open", "cancelled"]);
    expect(state.markets.at(-1)?.view.lifecycle).toBe("redeemable");
    expect(state.markets.at(-1)?.resolution?.noPayout).toBe("1");
    expect(state.approvals).toEqual({});
  });
  test("review has no side effects and enforces approval and wallet identity", () => {
    const state = fixture();
    const before = JSON.stringify(state);
    const order = candidate(state);
    expect(reviewDemoOrder(state, order).approved).toBe(false);
    expect(() => applyDemoAction(state, { type: "submit", order })).toThrow("Approve");
    expect(() => reviewDemoOrder(state, { ...order, maker: "0x123" })).toThrow("wallet");
    expect(() => reviewDemoOrder(state, { ...order, recipient: "0x123" })).toThrow("wallet");
    expect(JSON.stringify(state)).toBe(before);
  });
  test("disconnect disables mutations without removing balances; reconnect restores access", () => {
    const state = fixture();
    const disconnected = applyDemoAction(state, { type: "disconnect" });
    expect(disconnected.authenticated).toBe(false);
    for (const type of ["faucet", "authenticate", "revoke"] as const)
      expect(() => applyDemoAction(disconnected, { type })).toThrow("wallet");
    const connected = applyDemoAction(disconnected, { type: "connect" });
    expect(connected.balances).toEqual(state.balances);
    expect(applyDemoAction(connected, { type: "authenticate" }).authenticated).toBe(true);
  });
});

describe("raw-unit trading accounting", () => {
  for (const branch of [0, 1])
    for (const side of [0, 1])
      for (const fundingKind of [0, 1]) {
        test(`${branch === 0 ? "YES" : "NO"} ${side === 0 ? "buy" : "sell"}, ${fundingKind === 0 ? "whole" : "claim"} funding settles exact complementary claims`, () => {
          const state = fixture();
          const initial = first(state);
          const price = parsePriceRawX18("250", initial.market.view);
          initial.market.liquidity = [
            { branch, side: 1 - side, price: String(price), quantity: String(stock("1")) },
          ];
          const order = candidate(state, {
            branch,
            side,
            fundingKind,
            limitPriceRawX18: String(price),
          });
          const result = submit(state, order);
          const after = first(result);
          const placed = result.orders.at(-1);
          expect(placed?.status).toBe("filled");
          expect(placed?.remaining).toBe("0");
          expect(placed?.reserved).toBe("0");
          const spent = side === 0 ? quote("250") : stock("1");
          const gained = side === 0 ? stock("1") : quote("250");
          const fundingKey =
            side === 0
              ? branch === 0
                ? "quoteYes"
                : "quoteNo"
              : branch === 0
                ? "stockYes"
                : "stockNo";
          const inactiveKey =
            side === 0
              ? branch === 0
                ? "quoteNo"
                : "quoteYes"
              : branch === 0
                ? "stockNo"
                : "stockYes";
          const receivedKey =
            side === 0
              ? branch === 0
                ? "stockYes"
                : "stockNo"
              : branch === 0
                ? "quoteYes"
                : "quoteNo";
          const token = side === 0 ? initial.quote : initial.base;
          expect(BigInt(result.balances[token] ?? "0") - BigInt(state.balances[token] ?? "0")).toBe(
            fundingKind === 0 ? -spent : 0n,
          );
          expect(BigInt(after.position[fundingKey]) - BigInt(initial.position[fundingKey])).toBe(
            fundingKind === 1 ? -spent : 0n,
          );
          expect(BigInt(after.position[inactiveKey]) - BigInt(initial.position[inactiveKey])).toBe(
            fundingKind === 0 ? spent : 0n,
          );
          expect(BigInt(after.position[receivedKey]) - BigInt(initial.position[receivedKey])).toBe(
            gained,
          );
        });
      }
  test("execution rounds down, reservations up, and the rounding remainder is refunded", () => {
    const state = fixture();
    const { market, quote: token } = first(state);
    market.liquidity = [{ branch: 0, side: 1, price: "1000001", quantity: String(stock("0.001")) }];
    const result = submit(
      state,
      candidate(state, { quantity: String(stock("0.001")), limitPriceRawX18: "1000001" }),
    );
    expect(quoteForReservation(stock("0.001"), 1000001n)).toBe(1001n);
    expect(quoteForExecution(stock("0.001"), 1000001n)).toBe(1000n);
    expect(BigInt(state.balances[token] ?? "0") - BigInt(result.balances[token] ?? "0")).toBe(
      1000n,
    );
  });
  test("price improvement returns unused quote to the same funding asset", () => {
    for (const fundingKind of [0, 1]) {
      const state = fixture();
      const { market, quote: token, position } = first(state);
      market.liquidity = [{ branch: 0, side: 1, price: "200000000", quantity: String(stock("1")) }];
      const result = submit(state, candidate(state, { fundingKind }));
      const before = fundingKind === 0 ? state.balances[token] : position.quoteYes;
      const after = fundingKind === 0 ? result.balances[token] : first(result).position.quoteYes;
      expect(BigInt(before ?? "0") - BigInt(after ?? "0")).toBe(quote("200"));
    }
  });
  test("GTC reserves only the remainder; cancellation returns it exactly", () => {
    const state = fixture();
    const { market, quote: token } = first(state);
    market.liquidity = [{ branch: 0, side: 1, price: "250000000", quantity: String(stock("1")) }];
    const result = submit(state, candidate(state, { quantity: String(stock("5")) }));
    const order = result.orders.at(-1);
    if (!order) throw new Error("Missing order");
    expect(order.status).toBe("open");
    expect(order.remaining).toBe(String(stock("4")));
    expect(order.reserved).toBe(String(quote("1040")));
    const canceled = applyDemoAction(result, { type: "cancel", id: order.id });
    expect(canceled.orders.at(-1)?.remaining).toBe(String(stock("4")));
    expect(BigInt(state.balances[token] ?? "0") - BigInt(canceled.balances[token] ?? "0")).toBe(
      quote("250"),
    );
    expect(() => applyDemoAction(canceled, { type: "cancel", id: order.id })).toThrow(
      "no longer open",
    );
  });
  test("IOC partially fills finite depth and releases all remaining funding", () => {
    const state = fixture();
    const { market, quote: token } = first(state);
    market.liquidity = [{ branch: 0, side: 1, price: "250000000", quantity: String(stock("1")) }];
    const result = submit(state, candidate(state, { quantity: String(stock("5")), tif: 1 }));
    expect(result.orders.at(-1)).toMatchObject({
      status: "cancelled",
      filled: String(stock("1")),
      remaining: String(stock("4")),
      reserved: "0",
    });
    expect(BigInt(state.balances[token] ?? "0") - BigInt(result.balances[token] ?? "0")).toBe(
      quote("250"),
    );
  });
  test("unmarketable IOC fills nothing and leaves funding unchanged", () => {
    const state = fixture();
    const result = submit(state, candidate(state, { limitPriceRawX18: "100000000", tif: 1 }));
    expect(result.balances).toEqual(state.balances);
    expect(result.positions).toEqual(state.positions);
    expect(result.orders.at(-1)?.filled).toBe("0");
  });
  test("multiple levels are consumed in price priority with no liquidity overfill", () => {
    const state = fixture();
    const { market, quote: token } = first(state);
    market.liquidity = [253, 251, 252].map((price) => ({
      branch: 0,
      side: 1,
      price: String(price * 1e6),
      quantity: String(stock("1")),
    }));
    const result = submit(state, candidate(state, { quantity: String(stock("2.5")) }));
    expect(
      result.trades
        .slice(0, 3)
        .reverse()
        .map((trade) => trade.executionPriceRawX18),
    ).toEqual(["251000000", "252000000", "253000000"]);
    expect(BigInt(state.balances[token] ?? "0") - BigInt(result.balances[token] ?? "0")).toBe(
      quote("629.5"),
    );
    expect(
      result.markets[0]?.liquidity.find((level) => level.price === "253000000")?.quantity,
    ).toBe(String(stock("0.5")));
  });
  test("resting orders appear in the book and later execute at their own maker price", () => {
    const state = fixture();
    const order = candidate(state, { limitPriceRawX18: "250000000" });
    const resting = submit(state, order);
    expect(demoMarkets(resting)[0]?.yes.bids.some((level) => level.priceExact === "250")).toBe(
      true,
    );
    first(resting).market.anchors[0] = 248;
    const filled = applyDemoAction(resting, { type: "tick" });
    expect(filled.orders.at(-1)?.status).toBe("filled");
    expect(
      filled.trades.some(
        (trade) =>
          trade.executionPriceRawX18 === "250000000" && trade.fillQuantity === String(stock("1")),
      ),
    ).toBe(true);
  });
  test("FIFO resting orders share finite depth", () => {
    let state = fixture();
    state = submit(
      state,
      candidate(state, { quantity: String(stock("20")), limitPriceRawX18: "250000000" }),
    );
    state = submit(
      state,
      candidate(state, { quantity: String(stock("20")), limitPriceRawX18: "250000000" }),
    );
    first(state).market.anchors[0] = 248;
    const result = applyDemoAction(state, { type: "tick" });
    expect(BigInt(result.orders.at(-2)?.filled ?? "0")).toBeGreaterThan(0n);
    expect(result.orders.at(-1)?.filled).toBe("0");
  });
  test("better-priced resting orders execute before older worse-priced orders", () => {
    let state = fixture();
    state = submit(
      state,
      candidate(state, { quantity: String(stock("20")), limitPriceRawX18: "249500000" }),
    );
    state = submit(
      state,
      candidate(state, { quantity: String(stock("20")), limitPriceRawX18: "249990000" }),
    );
    first(state).market.anchors[0] = 248;
    const result = applyDemoAction(state, { type: "tick" });
    expect(result.orders.at(-2)?.filled).toBe("0");
    expect(BigInt(result.orders.at(-1)?.filled ?? "0")).toBeGreaterThan(0n);
  });
  test("own crossing orders, duplicate submissions and invalid amount steps are rejected atomically", () => {
    const state = fixture();
    const snapshot = JSON.stringify(state);
    expect(() => submit(state, candidate(state, { limitPriceRawX18: "300000000" }))).toThrow(
      "own resting",
    );
    expect(() => submit(state, candidate(state, { quantity: "1" }))).toThrow("multiple");
    expect(() => submit(state, candidate(state, { limitPriceRawX18: "0" }))).toThrow("positive");
    expect(() => submit(state, candidate(state, { expiry: "1" }))).toThrow("expiry");
    expect(() => submit(state, candidate(state, { quantity: String(stock("1000000")) }))).toThrow(
      "Insufficient",
    );
    expect(JSON.stringify(state)).toBe(snapshot);
    const order = candidate(state);
    const result = submit(state, order);
    expect(() => submit(result, order)).toThrow("already been submitted");
  });
  test("expiry returns escrow even after demo claim permission is revoked", () => {
    const state = fixture();
    const order = candidate(state, {
      side: 1,
      fundingKind: 1,
      limitPriceRawX18: "270000000",
      expiry: String(Math.floor(now / 1000) + 3),
    });
    const result = applyDemoAction(applyDemoAction(submit(state, order), { type: "revoke" }), {
      type: "tick",
    });
    expect(result.orders.at(-1)?.status).toBe("expired");
    expect(first(result).position.stockYes).toBe(first(state).position.stockYes);
  });
});

describe("funds, claims and resolution", () => {
  test("split then merge conserves every raw unit", () => {
    for (const collateral of ["base", "quote"] as const) {
      const state = fixture();
      const marketId = first(state).market.view.id;
      const amount = "1234567";
      const split = applyDemoAction(state, { type: "split", marketId, collateral, amount });
      expect(() => applyDemoAction(split, { type: "merge", marketId, collateral, amount })).toThrow(
        "router",
      );
      const approved = applyDemoAction(split, { type: "approve", key: "claims-router" });
      const merged = applyDemoAction(approved, { type: "merge", marketId, collateral, amount });
      expect(merged.balances).toEqual(state.balances);
      expect(merged.positions).toEqual(state.positions);
    }
  });
  test("failed merge and overspending transfer roll back all debits", () => {
    const state = applyDemoAction(fixture(), { type: "approve", key: "claims-router" });
    first(state).position.stockNo = "0";
    const before = JSON.stringify(state);
    expect(() =>
      applyDemoAction(state, {
        type: "merge",
        marketId: first(state).market.view.id,
        collateral: "base",
        amount: "1",
      }),
    ).toThrow("claims");
    expect(() =>
      applyDemoAction(state, {
        type: "transfer",
        token: first(state).quote,
        recipient: DEMO_ACCOUNT,
        amount: String(quote("1000000")),
      }),
    ).toThrow("balance");
    expect(JSON.stringify(state)).toBe(before);
  });
  test("faucet and supported-token transfers update available balances only", () => {
    const state = fixture();
    const { quote: token } = first(state);
    const funded = applyDemoAction(state, { type: "faucet" });
    expect(BigInt(funded.balances[token] ?? "0") - BigInt(state.balances[token] ?? "0")).toBe(
      quote("10000"),
    );
    const self = applyDemoAction(funded, {
      type: "transfer",
      token,
      recipient: DEMO_ACCOUNT,
      amount: "1000000",
    });
    expect(self.balances).toEqual(funded.balances);
    const sent = applyDemoAction(funded, {
      type: "transfer",
      token,
      recipient: "0x1234567890123456789012345678901234567890",
      amount: "1000000",
    });
    expect(BigInt(funded.balances[token] ?? "0") - BigInt(sent.balances[token] ?? "0")).toBe(
      1000000n,
    );
    expect(sent.positions).toEqual(funded.positions);
    expect(() =>
      applyDemoAction(funded, {
        type: "transfer",
        token: DEMO_ACCOUNT,
        recipient: DEMO_ACCOUNT,
        amount: "1",
      }),
    ).toThrow("supported");
    expect(() =>
      applyDemoAction(funded, {
        type: "transfer",
        token,
        recipient: `0x${"0".repeat(40)}`,
        amount: "1",
      }),
    ).toThrow("nonzero");
  });
  for (const outcome of ["YES", "NO", "INVALID"] as const)
    for (const collateral of ["base", "quote"] as const) {
      test(`${outcome} resolution redeems both ${collateral} branches at the exact payout vector`, () => {
        let state = fixture();
        const { market, base, quote: token } = first(state);
        const marketId = market.view.id;
        state = applyDemoAction(state, { type: "approve", key: "claims-router" });
        expect(() =>
          applyDemoAction(state, {
            type: "redeem",
            marketId,
            collateral,
            branch: "yes",
            amount: "3",
          }),
        ).toThrow("not yet");
        for (let i = 0; i < 3; i++)
          state = applyDemoAction(state, { type: "advance", marketId, outcome });
        expect(first(state).market.view.lifecycle).toBe("resolved");
        expect(
          state.orders.filter((order) => order.marketId === marketId && order.status === "open"),
        ).toHaveLength(0);
        expect(() => submit(state, candidate(state))).toThrow("not open");
        state = applyDemoAction(state, { type: "advance", marketId, outcome });
        expect(first(state).position.redeemable).toBe(true);
        expect(() => applyDemoAction(state, { type: "advance", marketId, outcome: "NO" })).toThrow(
          "already redeemable",
        );
        for (const branch of ["yes", "no"] as const) {
          const before = state;
          state = applyDemoAction(state, {
            type: "redeem",
            marketId,
            collateral,
            branch,
            amount: "3",
          });
          const asset = collateral === "base" ? base : token;
          const returned = outcome === "INVALID" ? 1n : outcome.toLowerCase() === branch ? 3n : 0n;
          expect(BigInt(state.balances[asset] ?? "0") - BigInt(before.balances[asset] ?? "0")).toBe(
            returned,
          );
        }
      });
    }
  test("redemption cannot be repeated after a claim is exhausted", () => {
    let state = fixture();
    const market = state.markets.at(-1);
    const position = state.positions.at(-1);
    if (!market || !position) throw new Error("Missing fixture");
    state = applyDemoAction(state, { type: "approve", key: "claims-router" });
    const action = {
      type: "redeem" as const,
      marketId: market.view.id,
      collateral: "base" as const,
      branch: "no" as const,
      amount: position.stockNo,
    };
    state = applyDemoAction(state, action);
    expect(() => applyDemoAction(state, action)).toThrow("claims");
  });
});

describe("realtime clock and persisted restarts", () => {
  test("tick moves books, probability and trade tape; pause stops the clock and mutation", () => {
    const state = fixture();
    const next = applyDemoAction(state, { type: "tick" });
    expect(demoMarkets(next)[0]?.yes.bestAsk).not.toBe(demoMarkets(state)[0]?.yes.bestAsk);
    expect(next.markets[0]?.view.probability.observedAt).not.toBe(
      state.markets[0]?.view.probability.observedAt,
    );
    expect(next.trades.length).toBeGreaterThan(state.trades.length);
    const paused = applyDemoAction(next, { type: "pause", paused: true });
    expect(applyDemoAction(paused, { type: "tick" })).toBe(paused);
  });
  test("short scenario freezes automatically, releases orders and waits for explicit evidence review", () => {
    let state = fixture();
    for (let i = 0; i < 30; i++) state = applyDemoAction(state, { type: "tick" });
    expect(state.markets[1]?.view.lifecycle).toBe("frozen");
    for (let i = 0; i < 15; i++) state = applyDemoAction(state, { type: "tick" });
    expect(state.markets[1]?.view.lifecycle).toBe("awaiting-resolution");
  });
  test("persisted order state resumes without double fills or rescaling", () => {
    let state = fixture();
    state = submit(state, candidate(state, { limitPriceRawX18: "200000000" }));
    const restored = restoreDemoState(JSON.stringify(state));
    expect(restored).not.toBeNull();
    expect(restored?.balances).toEqual(state.balances);
    expect(restored?.orders).toEqual(state.orders);
    expect(restored?.positions).toEqual(state.positions);
    if (!restored) throw new Error("Missing restored state");
    const ticked = applyDemoAction(restored, { type: "tick" });
    expect(ticked.orders.at(-1)?.filled).toBe("0");
    expect(ticked.balances).toEqual(restored.balances);
  });
  test("malformed, incompatible and tampered snapshots fail closed", () => {
    for (const input of ["", "null", "{}", "{bad json", "x".repeat(2_000_001)])
      expect(restoreDemoState(input)).toBeNull();
    for (const mutate of [
      (s: DemoState) => {
        s.version = 2 as 1;
      },
      (s: DemoState) => {
        s.balances[first(s).base] = "-1";
      },
      (s: DemoState) => {
        first(s).position.stockYes = "not-an-integer";
      },
      (s: DemoState) => {
        first(s).market.view.baseTokenDecimals = 6;
      },
      (s: DemoState) => {
        const order = s.orders[0];
        if (order) order.remaining = "999";
      },
    ]) {
      const state = fixture();
      mutate(state);
      expect(restoreDemoState(JSON.stringify(state))).toBeNull();
    }
  });
  test("long sessions bound trade and activity history", () => {
    let state = fixture();
    for (let i = 0; i < 350; i++) state = applyDemoAction(state, { type: "tick" });
    expect(state.trades.length).toBeLessThanOrEqual(300);
    expect(state.activity.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(state).length).toBeLessThan(200_000);
    expect(restoreDemoState(JSON.stringify(state))).not.toBeNull();
  });
});
