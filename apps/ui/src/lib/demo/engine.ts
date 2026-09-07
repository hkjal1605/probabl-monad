import {
  formatPriceRawX18,
  formatTokenAmount,
  MAX_ORDER_UINT128,
  parsePriceRawX18,
  parseTokenAmount,
  quoteForExecution,
  quoteForReservation,
} from "@conditional-stocks/domain";
import type {
  BranchBook,
  IndexedOrder,
  MarketView,
  PositionView,
  ResolutionView,
  TradeView,
} from "../api/types";
import type { createOrder } from "../trading/order";
import { demoMarketTemplates } from "./fixtures";

// These addresses are fixtures, never chain configuration or spendable accounts.
export const DEMO_ACCOUNT = "0xDe00000000000000000000000000000000000001".toLowerCase();
export const DEMO_STORAGE_KEY = "probabl.demo.v1";
export const DEMO_VERSION = 1;
export const DEMO_TICK_MS = 3_000;
const MAX_OPEN_ORDERS = 100;
const MAX_HISTORY = 300;
type Claim = "stockYes" | "stockNo" | "quoteYes" | "quoteNo";
type Candidate = ReturnType<typeof createOrder>;
type Outcome = "YES" | "NO" | "INVALID";
type Level = { branch: number; side: number; price: string; quantity: string };
export type DemoOrder = IndexedOrder & { sequence: number; filled: string; salt: string };
export interface DemoMarket {
  view: MarketView;
  anchors: [number, number];
  liquidity: Level[];
  stageAt: number;
  outcome: Outcome | null;
  resolution: ResolutionView | null;
}
export interface DemoState {
  version: typeof DEMO_VERSION;
  now: number;
  tick: number;
  sequence: number;
  paused: boolean;
  connected: boolean;
  authenticated: boolean;
  balances: Record<string, string>;
  approvals: Record<string, boolean>;
  positions: PositionView[];
  markets: DemoMarket[];
  orders: DemoOrder[];
  trades: TradeView[];
  activity: { id: string; at: number; message: string }[];
}
export type DemoAction =
  | { type: "tick" }
  | { type: "pause"; paused: boolean }
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "authenticate" }
  | { type: "approve"; key: string }
  | { type: "revoke" }
  | { type: "faucet" }
  | { type: "submit"; order: Candidate }
  | { type: "cancel"; id: string }
  | { type: "transfer"; token: string; recipient: string; amount: string }
  | { type: "split"; marketId: string; collateral: "base" | "quote"; amount: string }
  | { type: "merge"; marketId: string; collateral: "base" | "quote"; amount: string }
  | {
      type: "redeem";
      marketId: string;
      collateral: "base" | "quote";
      branch: "yes" | "no";
      amount: string;
    }
  | { type: "advance"; marketId: string; outcome: Outcome };

const raw = (value: string) => {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new Error("Enter a valid raw-unit amount.");
  return BigInt(value);
};
const positive = (value: string) => {
  const amount = raw(value);
  if (amount === 0n || amount > MAX_ORDER_UINT128)
    throw new Error("Amount must be positive and fit uint128.");
  return amount;
};
const id = (state: DemoState) => `0xdemo-${++state.sequence}`;
const log = (state: DemoState, message: string) => {
  state.activity.unshift({ id: id(state), at: state.now, message });
  state.activity.length = Math.min(state.activity.length, 120);
};
const marketFor = (state: DemoState, marketId: string) => {
  const market = state.markets.find((item) => item.view.id === marketId);
  if (!market) throw new Error("Unknown demo market.");
  return market;
};
const positionFor = (state: DemoState, marketId: string) => {
  const position = state.positions.find((item) => item.marketId === marketId);
  if (!position) throw new Error("Unknown demo position.");
  return position;
};
const claimKey = (side: number, branch: number): Claim =>
  side === 0 ? (branch === 0 ? "quoteYes" : "quoteNo") : branch === 0 ? "stockYes" : "stockNo";

function changeBalance(state: DemoState, token: string, delta: bigint) {
  const key = token.toLowerCase();
  if (!(key in state.balances)) throw new Error("This token is not supported by the demo.");
  const balance = raw(state.balances[key] ?? "0") + delta;
  if (balance < 0n)
    throw new Error("Insufficient available demo balance. Use Add demo funds in Funds.");
  state.balances[key] = balance.toString();
}
function changeClaim(state: DemoState, marketId: string, key: Claim, delta: bigint) {
  const position = positionFor(state, marketId);
  const amount = raw(position[key]) + delta;
  if (amount < 0n)
    throw new Error("Insufficient available claims. Merge requires equal YES and NO amounts.");
  position[key] = amount.toString();
}
function changeFunding(state: DemoState, order: IndexedOrder, delta: bigint) {
  const market = marketFor(state, order.marketId).view;
  if (order.fundingKind === 0)
    changeBalance(state, order.side === 0 ? market.quoteToken : market.baseToken, delta);
  else changeClaim(state, order.marketId, claimKey(order.side, order.branch), delta);
}
export function demoApprovalKey(
  order: Pick<Candidate, "marketId" | "fundingKind" | "side">,
  state: DemoState,
) {
  const market = marketFor(state, order.marketId).view;
  return order.fundingKind === 1
    ? "claims-exchange"
    : (order.side === 0 ? market.quoteToken : market.baseToken).toLowerCase();
}

export function reviewDemoOrder(state: DemoState, order: Candidate) {
  const market = marketFor(state, order.marketId).view;
  if (
    !state.connected ||
    order.maker.toLowerCase() !== DEMO_ACCOUNT ||
    order.recipient.toLowerCase() !== DEMO_ACCOUNT
  )
    throw new Error("Connect the demo wallet first.");
  if (market.lifecycle !== "open" || state.now >= Date.parse(market.cutoff))
    throw new Error("This demo market is not open for trading.");
  if (
    ![0, 1].includes(order.branch) ||
    ![0, 1].includes(order.side) ||
    ![0, 1].includes(order.fundingKind) ||
    ![0, 1].includes(order.tif)
  )
    throw new Error("Invalid order terms.");
  const quantity = positive(order.quantity);
  const price = positive(order.limitPriceRawX18);
  if (quantity % raw(market.baseStep) !== 0n)
    throw new Error("Quantity must be a multiple of 0.001 stock tokens.");
  if (quoteForExecution(quantity, price) === 0n)
    throw new Error("Order notional is below one raw quote unit.");
  const expiry = positive(order.expiry);
  if (
    expiry <= BigInt(Math.floor(state.now / 1000)) ||
    expiry >= BigInt(Math.floor(Date.parse(market.cutoff) / 1000))
  )
    throw new Error("Order expiry must be in the future and before cutoff.");
  const amount = order.side === 0 ? quoteForReservation(quantity, price) : quantity;
  const key = demoApprovalKey(order, state);
  const balance =
    order.fundingKind === 0
      ? state.balances[key]
      : positionFor(state, order.marketId)[claimKey(order.side, order.branch)];
  return {
    amount: amount.toString(),
    approved: state.approvals[key] === true,
    balanceSufficient: raw(balance ?? "0") >= amount,
    key,
  };
}

function release(state: DemoState, order: DemoOrder, status: string) {
  changeFunding(state, order, raw(order.reserved));
  order.reserved = "0";
  // Keep unfilled quantity for the UI's historical filled/quantity display.
  order.status = status;
  order.updatedBlock = String(state.tick);
}

function fill(state: DemoState, order: DemoOrder, quantity: bigint, price: bigint) {
  const quote = quoteForExecution(quantity, price);
  if (quote === 0n) return false;
  const remaining = raw(order.remaining) - quantity;
  const newReserved =
    order.side === 0 ? quoteForReservation(remaining, raw(order.limitPriceRawX18)) : remaining;
  const spent = order.side === 0 ? quote : quantity;
  const refund = raw(order.reserved) - newReserved - spent;
  if (refund < 0n) throw new Error("Invalid demo settlement reservation.");
  changeFunding(state, order, refund);
  // Mirrors ConditionalSettlement: the active asset goes to the trader;
  // whole-token funders also keep the complementary claim on their funding.
  changeClaim(
    state,
    order.marketId,
    claimKey(order.side === 0 ? 1 : 0, order.branch),
    order.side === 0 ? quantity : quote,
  );
  if (order.fundingKind === 0)
    changeClaim(state, order.marketId, claimKey(order.side, 1 - order.branch), spent);
  order.remaining = remaining.toString();
  order.filled = (raw(order.filled) + quantity).toString();
  order.reserved = newReserved.toString();
  order.status = remaining === 0n ? "filled" : "open";
  order.updatedBlock = String(state.tick);
  recordTrade(state, order.marketId, order.branch, quantity, price);
  log(
    state,
    `${marketFor(state, order.marketId).view.ticker}: ${order.side === 0 ? "bought" : "sold"} ${formatTokenAmount(quantity, 18)} ${order.branch === 0 ? "YES" : "NO"} stock claims (${order.id}).`,
  );
  return true;
}
function recordTrade(
  state: DemoState,
  marketId: string,
  branch: number,
  quantity: bigint,
  price: bigint,
) {
  const tradeId = id(state);
  state.trades.unshift({
    id: tradeId,
    marketId,
    branch,
    fillQuantity: quantity.toString(),
    executionPriceRawX18: price.toString(),
    blockTimestamp: String(Math.floor(state.now / 1000)),
    transactionHash: tradeId,
  });
  state.trades.length = Math.min(state.trades.length, MAX_HISTORY);
}
function match(state: DemoState, order: DemoOrder, resting: boolean) {
  const market = marketFor(state, order.marketId);
  const levels = market.liquidity
    .filter((level) => level.branch === order.branch && level.side !== order.side)
    .sort((a, b) => (raw(a.price) < raw(b.price) ? -1 : 1) * (order.side === 0 ? 1 : -1));
  for (const level of levels) {
    if (raw(order.remaining) === 0n) break;
    if (
      order.side === 0
        ? raw(level.price) > raw(order.limitPriceRawX18)
        : raw(level.price) < raw(order.limitPriceRawX18)
    )
      break;
    const quantity =
      raw(order.remaining) < raw(level.quantity) ? raw(order.remaining) : raw(level.quantity);
    if (
      quantity > 0n &&
      fill(state, order, quantity, raw(resting ? order.limitPriceRawX18 : level.price))
    ) {
      level.quantity = (raw(level.quantity) - quantity).toString();
    }
  }
}

function replenish(state: DemoState, market: DemoMarket) {
  market.liquidity = [];
  if (market.view.lifecycle !== "open") return;
  // Bounded deterministic movement; only presentation/fixture generation uses floats.
  const movement = Math.sin(state.tick / 3) * 1.8;
  for (const branch of [0, 1])
    for (const side of [0, 1])
      for (let depth = 0; depth < 3; depth++) {
        const price =
          (market.anchors[branch] ?? 200) + movement + (side === 0 ? -1 : 1) * (0.45 + depth * 0.6);
        market.liquidity.push({
          branch,
          side,
          price: parsePriceRawX18(price.toFixed(2), market.view).toString(),
          quantity: parseTokenAmount(
            String(2 + depth + (state.tick % 3)),
            market.view.baseTokenDecimals,
          ).toString(),
        });
      }
}
function setStage(state: DemoState, market: DemoMarket, outcome?: Outcome) {
  const view = market.view;
  if (view.lifecycle === "scheduled") {
    view.lifecycle = "open";
    view.tradingOpen = new Date(state.now).toISOString();
  } else if (view.lifecycle === "open") {
    view.lifecycle = "frozen";
    view.cutoff = new Date(state.now).toISOString();
    for (const order of state.orders)
      if (order.marketId === view.id && order.status === "open") release(state, order, "cancelled");
    market.liquidity = [];
  } else if (view.lifecycle === "frozen") {
    view.lifecycle = "awaiting-resolution";
  } else if (view.lifecycle === "awaiting-resolution") {
    market.outcome = outcome ?? "YES";
    view.lifecycle = "resolved";
    market.resolution = {
      admin: DEMO_ACCOUNT,
      evidenceHash: `demo-evidence-${view.id}`,
      evidenceUri: `/resolution?market=${view.id}#evidence-${view.id}`,
      transactionHash: id(state),
      yesPayout: market.outcome === "NO" ? "0" : "1",
      noPayout: market.outcome === "YES" ? "0" : "1",
      payoutDenominator: market.outcome === "INVALID" ? "2" : "1",
    };
  } else if (view.lifecycle === "resolved") {
    view.lifecycle = "redeemable";
    positionFor(state, view.id).redeemable = true;
  } else throw new Error("This market is already redeemable. Reset the demo to replay it.");
  market.stageAt = state.now;
  replenish(state, market);
  log(
    state,
    `${view.ticker}: ${view.lifecycle}${market.outcome ? ` · ${market.outcome}` : ""}. Simulated evidence review and settlement only.`,
  );
}

export function createDemoState(now = Date.now()): DemoState {
  const state: DemoState = {
    version: DEMO_VERSION,
    now,
    tick: 0,
    sequence: 0,
    paused: false,
    connected: true,
    authenticated: false,
    balances: {},
    approvals: {},
    markets: [],
    positions: [],
    orders: [],
    trades: [],
    activity: [],
  };
  const seeds = [
    ...demoMarketTemplates,
    {
      ...demoMarketTemplates[0],
      ticker: "NVDA",
      question: "Demo completed earnings review: did NVIDIA exceed the target?",
    },
    {
      ...demoMarketTemplates[2],
      ticker: "TSLA",
      question: "Demo resolved deliveries: did Tesla exceed the target?",
    },
  ] as MarketView[];
  seeds.forEach((seed, index) => {
    const view = structuredClone(seed);
    view.id = `0x${(0xdead01 + index).toString(16).padStart(64, "0")}`;
    view.sourceMode = "demo";
    view.description =
      "SIMULATED EVENT. YES if the sample company report exceeds its stated target; NO otherwise; invalid reports pay 50/50. Prices, evidence, tokens, addresses and settlement are fictitious, not investment information.";
    view.mapping.conditionId = `0x${(0xbeef01 + index).toString(16).padStart(64, "0")}`;
    view.mapping.polymarketUrl = `/resolution?market=${view.id}#evidence-${view.id}`;
    view.tradingOpen = new Date(now - 60_000).toISOString();
    view.cutoff = new Date(now + (index === 1 ? 90_000 : 1_200_000)).toISOString();
    view.lifecycle = "open";
    view.probability = {
      ask: 0.58,
      bid: 0.56,
      value: 0.57,
      quality: "valid",
      observedAt: new Date(now).toISOString(),
    };
    const market: DemoMarket = {
      view,
      anchors: [seed.yes.bestAsk ?? 250, seed.no.bestAsk ?? 220],
      liquidity: [],
      stageAt: now,
      resolution: null,
      outcome: null,
    };
    state.markets.push(market);
    state.balances[view.baseToken.toLowerCase()] = parseTokenAmount(
      "100",
      view.baseTokenDecimals,
    ).toString();
    state.balances[view.quoteToken.toLowerCase()] = parseTokenAmount(
      "100000",
      view.quoteTokenDecimals,
    ).toString();
    state.positions.push({
      marketId: view.id,
      conditionId: view.mapping.conditionId,
      baseTokenDecimals: view.baseTokenDecimals,
      quoteTokenDecimals: view.quoteTokenDecimals,
      protocolVersion: 2,
      priceFormat: "raw-unit-ratio-x18",
      stockYes: parseTokenAmount("5", 18).toString(),
      stockNo: parseTokenAmount("5", 18).toString(),
      quoteYes: "1000000000",
      quoteNo: "1000000000",
      redeemable: false,
    });
    replenish(state, market);
    if (index >= 3) {
      setStage(state, market);
      setStage(state, market);
      if (index === 4) {
        setStage(state, market, "NO");
        setStage(state, market);
      }
    }
  });
  // Historical examples are executed by the same engine, not disconnected UI rows.
  const market = state.markets[0];
  if (market) {
    const candidate: Candidate = {
      maker: DEMO_ACCOUNT,
      recipient: DEMO_ACCOUNT,
      marketId: market.view.id,
      branch: 0,
      side: 0,
      fundingKind: 0,
      tif: 0,
      quantity: parseTokenAmount("1", 18).toString(),
      limitPriceRawX18: parsePriceRawX18("256", market.view).toString(),
      expiry: String(Math.floor(Date.parse(market.view.cutoff) / 1000) - 1),
      nonce: "1",
      salt: `0x${"1".repeat(64)}`,
      maxFeeBps: 0,
    };
    state.approvals[demoApprovalKey(candidate, state)] = true;
    submit(state, candidate);
    submit(
      state,
      {
        ...candidate,
        side: 1,
        fundingKind: 1,
        quantity: parseTokenAmount("1", 18).toString(),
        limitPriceRawX18: parsePriceRawX18("280", market.view).toString(),
        salt: `0x${"2".repeat(64)}`,
      },
      true,
    );
    submit(state, {
      ...candidate,
      limitPriceRawX18: parsePriceRawX18("200", market.view).toString(),
      salt: `0x${"3".repeat(64)}`,
    });
    const last = state.orders.at(-1);
    if (last) release(state, last, "cancelled");
    state.approvals = {};
  }
  log(
    state,
    "Demo ready: fictitious USDG, NVDA, TSLA and SPY; seeded claim pairs and order history. No real funds.",
  );
  return state;
}

function submit(state: DemoState, candidate: Candidate, seed = false) {
  const review = reviewDemoOrder(state, candidate);
  if (!seed && !review.approved)
    throw new Error("Approve demo funding, then review the order again.");
  if (!review.balanceSufficient) throw new Error("Insufficient demo funding.");
  if (state.orders.some((order) => order.salt === candidate.salt))
    throw new Error("This demo order has already been submitted.");
  if (state.orders.filter((order) => order.status === "open").length >= MAX_OPEN_ORDERS)
    throw new Error("Demo limit: 100 open orders. Cancel an order first.");
  if (
    state.orders.some(
      (order) =>
        order.status === "open" &&
        order.marketId === candidate.marketId &&
        order.branch === candidate.branch &&
        order.side !== candidate.side &&
        (candidate.side === 0
          ? raw(candidate.limitPriceRawX18) >= raw(order.limitPriceRawX18)
          : raw(candidate.limitPriceRawX18) <= raw(order.limitPriceRawX18)),
    )
  )
    throw new Error("This order would cross your own resting order. Cancel it first.");
  const order: DemoOrder = {
    ...candidate,
    id: id(state),
    sequence: state.sequence,
    filled: "0",
    remaining: candidate.quantity,
    reserved: review.amount,
    status: "open",
    confirmation: "simulated",
    updatedBlock: String(state.tick),
  };
  changeFunding(state, order, -raw(review.amount));
  state.orders.push(order);
  match(state, order, false);
  if (order.tif === 1 && order.status === "open") release(state, order, "cancelled");
  log(
    state,
    `Order ${order.id}: ${order.status}${order.tif === 1 ? " · IOC remainder released" : ""}.`,
  );
  const closed = state.orders.filter((item) => item.status !== "open");
  const keep = new Set(closed.slice(-MAX_HISTORY).map((item) => item.id));
  state.orders = state.orders.filter((item) => item.status === "open" || keep.has(item.id));
}

// Atomic transition: failures never partially debit a balance or consume liquidity.
export function applyDemoAction(previous: DemoState, action: DemoAction): DemoState {
  if (action.type === "tick" && previous.paused) return previous;
  const state = structuredClone(previous);
  if (
    !["tick", "pause", "connect", "disconnect", "advance"].includes(action.type) &&
    !state.connected
  )
    throw new Error("Connect the demo wallet first.");
  switch (action.type) {
    case "connect":
      state.connected = true;
      break;
    case "disconnect":
      state.connected = false;
      state.authenticated = false;
      break;
    case "authenticate":
      state.authenticated = true;
      break;
    case "pause":
      state.paused = action.paused;
      break;
    case "approve": {
      if (
        !(action.key in state.balances) &&
        !["claims-exchange", "claims-router"].includes(action.key)
      )
        throw new Error("Unknown demo approval.");
      state.approvals[action.key] = true;
      log(state, `Demo permission granted: ${action.key}.`);
      break;
    }
    case "revoke":
      state.approvals["claims-exchange"] = false;
      log(state, "Demo exchange claim permission revoked. Escrowed orders remain cancelable.");
      break;
    case "faucet": {
      for (const [token] of Object.entries(state.balances)) {
        const quote = state.markets.some(
          (market) => market.view.quoteToken.toLowerCase() === token,
        );
        changeBalance(state, token, parseTokenAmount(quote ? "10000" : "25", quote ? 6 : 18));
      }
      log(state, "Faucet added 10,000 demo USDG and 25 of each demo stock to the wallet.");
      break;
    }
    case "submit":
      submit(state, action.order);
      break;
    case "cancel": {
      const order = state.orders.find((item) => item.id === action.id);
      if (order?.status !== "open") throw new Error("Order is no longer open.");
      release(state, order, "cancelled");
      log(state, `Order ${order.id} cancelled; remaining funding returned.`);
      break;
    }
    case "transfer": {
      const amount = positive(action.amount);
      if (!/^0x[0-9a-fA-F]{40}$/.test(action.recipient) || /^0x0{40}$/i.test(action.recipient))
        throw new Error("Enter a nonzero recipient address.");
      changeBalance(state, action.token, -amount);
      if (action.recipient.toLowerCase() === DEMO_ACCOUNT)
        changeBalance(state, action.token, amount);
      log(
        state,
        `Simulated transfer: ${amount} raw units of ${action.token} to ${action.recipient}. No onchain transfer.`,
      );
      break;
    }
    case "split":
    case "merge":
    case "redeem": {
      const market = marketFor(state, action.marketId);
      const amount = positive(action.amount);
      const token = action.collateral === "base" ? market.view.baseToken : market.view.quoteToken;
      const yes: Claim = action.collateral === "base" ? "stockYes" : "quoteYes";
      const no: Claim = action.collateral === "base" ? "stockNo" : "quoteNo";
      if (action.type === "split") {
        if (market.view.lifecycle !== "open")
          throw new Error("Demo splitting is available on open markets.");
        changeBalance(state, token, -amount);
        changeClaim(state, action.marketId, yes, amount);
        changeClaim(state, action.marketId, no, amount);
      } else {
        if (!state.approvals["claims-router"])
          throw new Error("Approve the demo claim router first.");
        if (action.type === "merge") {
          changeClaim(state, action.marketId, yes, -amount);
          changeClaim(state, action.marketId, no, -amount);
          changeBalance(state, token, amount);
        } else {
          const resolution = market.resolution;
          if (market.view.lifecycle !== "redeemable" || !resolution)
            throw new Error("This market is not yet redeemable.");
          changeClaim(state, action.marketId, action.branch === "yes" ? yes : no, -amount);
          const payout = raw(
            (action.branch === "yes" ? resolution.yesPayout : resolution.noPayout) ?? "0",
          );
          const returned = (amount * payout) / positive(resolution.payoutDenominator ?? "0");
          changeBalance(state, token, returned);
          log(
            state,
            `Redemption returned ${returned} raw units; ${payout === 0n ? "losing claims burn for zero" : "payout rounded down"}.`,
          );
        }
      }
      log(
        state,
        `${market.view.ticker}: ${action.type} ${amount} raw ${action.collateral === "base" ? "stock" : "USDG"} claim units.`,
      );
      break;
    }
    case "advance":
      setStage(state, marketFor(state, action.marketId), action.outcome);
      break;
    case "tick": {
      state.now += DEMO_TICK_MS;
      state.tick++;
      for (const market of state.markets) {
        const lifecycle = market.view.lifecycle;
        if (
          (lifecycle === "open" && state.now >= Date.parse(market.view.cutoff)) ||
          (lifecycle === "scheduled" && state.now >= Date.parse(market.view.tradingOpen)) ||
          (["frozen", "resolved"].includes(lifecycle) && state.now - market.stageAt >= 12_000)
        )
          setStage(state, market);
        if (market.view.lifecycle !== "open") continue;
        replenish(state, market);
        const value =
          Math.round((0.55 + Math.sin(state.tick / 8 + market.anchors[0]) * 0.12) * 100) / 100;
        market.view.probability = {
          value,
          bid: value - 0.01,
          ask: value + 0.01,
          quality: "valid",
          observedAt: new Date(state.now).toISOString(),
        };
        for (const order of state.orders
          .filter((item) => item.marketId === market.view.id && item.status === "open")
          .sort((a, b) => {
            if (a.branch !== b.branch) return a.branch - b.branch;
            if (a.side !== b.side) return a.side - b.side;
            const aPrice = raw(a.limitPriceRawX18);
            const bPrice = raw(b.limitPriceRawX18);
            if (aPrice !== bPrice) return (aPrice < bPrice ? -1 : 1) * (a.side === 0 ? -1 : 1);
            return a.sequence - b.sequence;
          })) {
          if (raw(order.expiry) <= BigInt(Math.floor(state.now / 1000))) {
            release(state, order, "expired");
            log(state, `Order ${order.id} expired; remaining funding released.`);
          } else match(state, order, true);
        }
        // Independent bot-to-bot tape activity, backed by visible remaining liquidity.
        const level = market.liquidity.find(
          (item) =>
            item.branch === state.tick % 2 &&
            item.side === state.tick % 2 &&
            raw(item.quantity) >= 10n ** 17n,
        );
        if (level) {
          level.quantity = (raw(level.quantity) - 10n ** 17n).toString();
          recordTrade(state, market.view.id, level.branch, 10n ** 17n, raw(level.price));
        }
      }
      break;
    }
  }
  return state;
}

function bookFor(state: DemoState, market: DemoMarket, branch: number): BranchBook {
  const levels = [
    ...market.liquidity.filter((level) => level.branch === branch),
    ...state.orders
      .filter(
        (order) =>
          order.marketId === market.view.id && order.branch === branch && order.status === "open",
      )
      .map((order) => ({
        side: order.side,
        branch,
        price: order.limitPriceRawX18,
        quantity: order.remaining,
      })),
  ];
  const side = (value: number) => {
    const totals = new Map<bigint, bigint>();
    for (const level of levels.filter((item) => item.side === value && raw(item.quantity) > 0n))
      totals.set(raw(level.price), (totals.get(raw(level.price)) ?? 0n) + raw(level.quantity));
    return [...totals]
      .sort(([a], [b]) => (a < b ? -1 : 1) * (value === 0 ? -1 : 1))
      .slice(0, 12)
      .map(([price, quantity]) => ({
        priceExact: formatPriceRawX18(price, market.view),
        price: Number(formatPriceRawX18(price, market.view)),
        quantity: Number(formatTokenAmount(quantity, market.view.baseTokenDecimals)),
      }));
  };
  const bids = side(0);
  const asks = side(1);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  return {
    bids,
    asks,
    bestBid,
    bestAsk,
    bestBidExact: bids[0]?.priceExact ?? null,
    bestAskExact: asks[0]?.priceExact ?? null,
    spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
    depthUsd: [...bids, ...asks].reduce((total, level) => total + level.price * level.quantity, 0),
  };
}
export function demoMarkets(state: DemoState): MarketView[] {
  return state.markets.map((market) => {
    const yes = bookFor(state, market, 0);
    const no = bookFor(state, market, 1);
    const mid = (book: BranchBook) =>
      book.bestAsk !== null && book.bestBid !== null ? (book.bestAsk + book.bestBid) / 2 : null;
    const yesMid = mid(yes);
    const noMid = mid(no);
    return {
      ...market.view,
      yes,
      no,
      residual: null,
      eventImpact: yesMid !== null && noMid !== null ? yesMid - noMid : null,
    };
  });
}

// Session storage is untrusted. Reject corrupt/incompatible snapshots before UI math runs.
export function restoreDemoState(serialized: string): DemoState | null {
  try {
    if (serialized.length > 2_000_000) return null;
    const state = JSON.parse(serialized) as DemoState;
    if (
      state.version !== DEMO_VERSION ||
      !Number.isSafeInteger(state.now) ||
      state.now < 0 ||
      !Number.isFinite(Date.parse(new Date(state.now).toISOString())) ||
      !Number.isSafeInteger(state.tick) ||
      state.tick < 0 ||
      !Number.isSafeInteger(state.sequence) ||
      state.sequence < 0 ||
      typeof state.paused !== "boolean" ||
      typeof state.connected !== "boolean" ||
      typeof state.authenticated !== "boolean"
    )
      return null;
    const seed = createDemoState(state.now);
    if (
      state.markets.length !== seed.markets.length ||
      state.positions.length !== seed.positions.length ||
      state.orders.length > MAX_OPEN_ORDERS + MAX_HISTORY ||
      state.trades.length > MAX_HISTORY ||
      state.activity.length > 120
    )
      return null;
    for (const token of Object.keys(seed.balances)) raw(state.balances[token] ?? "");
    if (Object.keys(state.balances).length !== Object.keys(seed.balances).length) return null;
    for (const [key, value] of Object.entries(state.approvals))
      if (
        typeof value !== "boolean" ||
        (!(key in seed.balances) && !["claims-exchange", "claims-router"].includes(key))
      )
        return null;
    state.markets.forEach((market, index) => {
      const original = seed.markets[index]?.view;
      if (
        !original ||
        market.view.id !== original.id ||
        market.view.baseToken !== original.baseToken ||
        market.view.quoteToken !== original.quoteToken ||
        market.view.sourceMode !== "demo" ||
        market.view.baseTokenDecimals !== 18 ||
        market.view.quoteTokenDecimals !== 6 ||
        market.view.baseStep !== original.baseStep ||
        !["scheduled", "open", "frozen", "awaiting-resolution", "resolved", "redeemable"].includes(
          market.view.lifecycle,
        ) ||
        !Number.isFinite(Date.parse(market.view.cutoff)) ||
        !Number.isFinite(market.stageAt) ||
        market.liquidity.length > 12 ||
        market.anchors.length !== 2 ||
        market.anchors.some((anchor) => !Number.isFinite(anchor) || anchor <= 2)
      )
        throw new Error("Invalid market");
      // Immutable metadata/links are always restored from trusted fixtures.
      const { lifecycle, cutoff, tradingOpen, probability } = market.view;
      if (
        !Number.isFinite(Date.parse(tradingOpen)) ||
        !["valid", "low-depth", "stale", "one-sided", "empty", "crossed", "disconnected"].includes(
          probability.quality,
        ) ||
        (probability.observedAt !== null && !Number.isFinite(Date.parse(probability.observedAt))) ||
        [probability.value, probability.bid, probability.ask].some(
          (value) =>
            value !== null &&
            (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1),
        )
      )
        throw new Error("Invalid probability");
      market.view = {
        ...original,
        lifecycle,
        cutoff,
        tradingOpen,
        probability: {
          value: probability.value,
          bid: probability.bid,
          ask: probability.ask,
          quality: probability.quality,
          observedAt: probability.observedAt,
        },
      };
      market.anchors = seed.markets[index]?.anchors ?? market.anchors;
      if (["resolved", "redeemable"].includes(lifecycle) !== Boolean(market.resolution))
        throw new Error("Invalid resolution state");
      for (const level of market.liquidity) {
        if (![0, 1].includes(level.branch) || ![0, 1].includes(level.side))
          throw new Error("Invalid liquidity");
        positive(level.price);
        raw(level.quantity);
      }
      if (market.resolution) {
        const r = market.resolution;
        if (
          ![
            ["1", "0", "1"],
            ["0", "1", "1"],
            ["1", "1", "2"],
          ].some(([y, n, d]) => r.yesPayout === y && r.noPayout === n && r.payoutDenominator === d)
        )
          throw new Error("Invalid payout");
        r.evidenceUri = `/resolution?market=${original.id}#evidence-${original.id}`;
        market.outcome =
          r.payoutDenominator === "2" ? "INVALID" : r.yesPayout === "1" ? "YES" : "NO";
      }
    });
    for (const position of state.positions) {
      const market = marketFor(state, position.marketId);
      if (
        position.baseTokenDecimals !== 18 ||
        position.quoteTokenDecimals !== 6 ||
        position.redeemable !== (market.view.lifecycle === "redeemable")
      )
        return null;
      for (const key of ["stockYes", "stockNo", "quoteYes", "quoteNo"] as const) raw(position[key]);
    }
    if (
      new Set(state.positions.map((p) => p.marketId)).size !== state.markets.length ||
      new Set(state.orders.map((o) => o.id)).size !== state.orders.length
    )
      return null;
    for (const order of state.orders) {
      marketFor(state, order.marketId);
      if (
        order.maker !== DEMO_ACCOUNT ||
        ![0, 1].includes(order.side) ||
        ![0, 1].includes(order.branch) ||
        ![0, 1].includes(order.fundingKind) ||
        ![0, 1].includes(order.tif) ||
        !["open", "filled", "cancelled", "expired"].includes(order.status) ||
        !Number.isSafeInteger(order.sequence) ||
        typeof order.salt !== "string" ||
        !/^0xdemo-\d+$/.test(order.id)
      )
        return null;
      positive(order.quantity);
      positive(order.limitPriceRawX18);
      positive(order.expiry);
      raw(order.reserved);
      raw(order.remaining);
      raw(order.filled);
      if (
        raw(order.filled) + raw(order.remaining) !== raw(order.quantity) ||
        (order.status !== "open" && raw(order.reserved) !== 0n) ||
        (order.status === "open" &&
          raw(order.reserved) !==
            (order.side === 0
              ? quoteForReservation(raw(order.remaining), raw(order.limitPriceRawX18))
              : raw(order.remaining)))
      )
        return null;
    }
    for (const trade of state.trades) {
      marketFor(state, trade.marketId);
      positive(trade.fillQuantity);
      positive(trade.executionPriceRawX18);
      raw(trade.blockTimestamp);
      if (
        ![0, 1].includes(trade.branch) ||
        !/^0xdemo-\d+$/.test(trade.id) ||
        trade.transactionHash !== trade.id
      )
        return null;
    }
    for (const event of state.activity)
      if (
        typeof event.message !== "string" ||
        typeof event.id !== "string" ||
        !Number.isFinite(event.at)
      )
        return null;
    demoMarkets(state);
    return state;
  } catch {
    return null;
  }
}
