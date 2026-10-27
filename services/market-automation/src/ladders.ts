/** Daily and weekly cross-asset ladders: Probabl markets on stock tokens conditional on a Kalshi
 * "above $K at a fixing" strike of another asset ("MSTR if BTC ≥ $81,750 at 5 pm ET today"), at
 * the strikes nearest even odds so both branches trade. Kalshi lists the strikes; the fixing's
 * result resolves the market through the resolve-markets job. */
import { kalshiConditionId } from "@conditional-stocks/market-data";
import { type Address, erc20Abi, getAddress, type PublicClient } from "viem";
import type { Evidence, Market } from "./admin.ts";
import type { MarketSpec } from "./markets.ts";
import type { KalshiEvent, KalshiStrike } from "./venues/kalshi-api.ts";

export type Cadence = "daily" | "weekly";
export interface LadderToken {
  /** For logs. */
  symbol: string;
  base: Address;
  /** Strikes listed for the token at each fixing: 1 to 3. */
  rungs: number;
}
export interface Ladder {
  /** A Kalshi series of "above" strikes, e.g. KXBTCD (Bitcoin at 5 pm ET). */
  series: string;
  /** The fixing's New York time, "HH:MM": one series can fix at several times a day. */
  fixing: string;
  tokens: LadderToken[];
}
export interface LadderConfig {
  daily: Ladder[];
  weekly: Ladder[];
}

const MINUTE = 60_000,
  HOUR = 60 * MINUTE;
/** Trading stops this long before the fixing, when the result is all but known. */
export const CUTOFF_LEAD_MS = 30 * MINUTE;
/** A market is created only with at least this much trading time. */
const MIN_TRADING_MS = HOUR;
/** Daily markets open within about a day of their fixing, weekly ones at least two days ahead
 * (on a Friday fixing). Both can use one Kalshi event (Bitcoin's Friday 5 pm), so each cadence
 * owns the markets opened on its side of `WEEKLY_MIN_MS` before the fixing. */
const DAILY_HORIZON_MS = 26 * HOUR;
const WEEKLY_MIN_MS = 48 * HOUR;
const WEEKLY_HORIZON_MS = 7 * 24 * HOUR;

/** Even odds first, then either side: strikes priced there give both branches traders. */
const TARGETS: Record<number, number[]> = { 1: [0.5], 2: [0.4, 0.6], 3: [0.5, 0.3, 0.7] };
const MIN_ODDS = 0.2,
  MAX_ODDS = 0.8,
  MAX_SPREAD = 0.1;
const ABOVE = new Set(["greater", "greater_or_equal"]);

const newYork = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** New York's weekday ("Mon") and time ("17:00") at `ms`. */
export function newYorkClock(ms: number) {
  const part = (type: string) => newYork.formatToParts(ms).find((p) => p.type === type)?.value;
  return { weekday: part("weekday") ?? "", time: `${part("hour")}:${part("minute")}` };
}

/** Whether a cadence creates markets now for an event fixing at `fixing`: on a weekday at the
 * ladder's time, inside the cadence's window. */
export function inWindow(cadence: Cadence, ladder: Ladder, fixing: number, now: number) {
  const { weekday, time } = newYorkClock(fixing);
  const ahead = fixing - now;
  if (time !== ladder.fixing) return false;
  if (cadence === "weekly")
    return weekday === "Fri" && ahead > WEEKLY_MIN_MS && ahead <= WEEKLY_HORIZON_MS;
  return (
    weekday !== "Sat" &&
    weekday !== "Sun" &&
    ahead >= CUTOFF_LEAD_MS + MIN_TRADING_MS &&
    ahead <= DAILY_HORIZON_MS
  );
}

/** The event a cadence creates markets on now: the earliest in its window. */
export function targetEvent(cadence: Cadence, ladder: Ladder, events: KalshiEvent[], now: number) {
  return events
    .filter((e) => inWindow(cadence, ladder, e.fixing, now))
    .sort((a, b) => a.fixing - b.fixing)[0];
}

/** The "above" strikes nearest the odds a token's `rungs` aim at, skipping `exclude`: active,
 * quoted on both sides within 10¢ and priced 20–80%. Each rung the token holds (`held`) covers
 * the target nearest its odds. Ties go to the larger open interest. */
export function chooseRungs(
  strikes: KalshiStrike[],
  rungs: number,
  exclude: Set<string>,
  held: string[] = [],
) {
  const mid = (s: KalshiStrike) => (s.bid + s.ask) / 2;
  const targets = [...(TARGETS[rungs] ?? [])];
  for (const ticker of held) {
    const strike = strikes.find((s) => s.ticker === ticker);
    if (!strike) continue;
    const nearest = targets.reduce(
      (best, t, i) =>
        Math.abs(t - mid(strike)) < Math.abs((targets[best] ?? 0) - mid(strike)) ? i : best,
      0,
    );
    targets.splice(nearest, 1);
  }
  const eligible = strikes.filter(
    (s) =>
      !exclude.has(s.ticker) &&
      s.status === "active" &&
      ABOVE.has(s.strikeType) &&
      s.bid > 0 &&
      s.ask > s.bid &&
      s.ask - s.bid <= MAX_SPREAD &&
      mid(s) >= MIN_ODDS &&
      mid(s) <= MAX_ODDS,
  );
  const chosen: KalshiStrike[] = [];
  for (const target of targets) {
    const best = eligible
      .filter((s) => !chosen.includes(s))
      .sort(
        (a, b) =>
          Math.abs(mid(a) - target) - Math.abs(mid(b) - target) || b.openInterest - a.openInterest,
      )[0];
    if (best) chosen.push(best);
  }
  return chosen;
}

/** What one token needs at one fixing. */
export interface TokenPlan {
  token: LadderToken;
  /** Specs to create, including resumed packets of an interrupted run. */
  specs: MarketSpec[];
  /** Rungs still missing after `specs`: no eligible strike is left for them. */
  short: number;
}

/** The markets a cadence still needs on `event` for each token of `ladder`. A token's markets
 * on the event, created or in flight (an unexecuted packet), count when the cadence owns them;
 * the other cadence's strikes are left to it. */
export function planLadder(
  cadence: Cadence,
  ladder: Ladder,
  event: KalshiEvent,
  strikes: KalshiStrike[],
  markets: Market[],
  evidence: Evidence[],
): TokenPlan[] {
  const tickers = new Map(strikes.map((s) => [kalshiConditionId(s.ticker), s.ticker]));
  const owner = (open: string): Cadence =>
    event.fixing - Number(open) * 1000 >= WEEKLY_MIN_MS ? "weekly" : "daily";
  const cutoff = Math.floor((event.fixing - CUTOFF_LEAD_MS) / 1000);
  const spec = (token: LadderToken, ticker: string): MarketSpec => ({
    source: "kalshi",
    marketId: ticker,
    base: token.base,
    cutoff,
    note: `${cadence} ${ladder.series} ladder`,
  });
  return ladder.tokens.map((token) => {
    const base = getAddress(token.base);
    const used = new Set<string>(),
      owned = new Set<string>(),
      resumed: string[] = [];
    for (const m of markets) {
      const ticker = tickers.get(m.eventConditionId.toLowerCase() as `0x${string}`);
      if (!ticker || getAddress(m.baseToken) !== base) continue;
      used.add(ticker);
      if (owner(m.tradingOpen) === cadence) owned.add(ticker);
    }
    for (const e of evidence) {
      const p = e.envelope.packet;
      if (e.status === "rejected" || p.kind !== "market-creation") continue;
      if (p.event.source !== "kalshi" || getAddress(p.config.baseToken) !== base) continue;
      const ticker = p.event.marketId;
      if (!strikes.some((s) => s.ticker === ticker) || used.has(ticker)) continue;
      used.add(ticker);
      if (owner(p.config.tradingOpen) !== cadence) continue;
      owned.add(ticker);
      resumed.push(ticker);
    }
    const need = Math.max(0, token.rungs - owned.size);
    const picked = need ? chooseRungs(strikes, token.rungs, used, [...owned]).slice(0, need) : [];
    return {
      token,
      specs: [...resumed, ...picked.map((s) => s.ticker)].map((t) => spec(token, t)),
      short: need - picked.length,
    };
  });
}

/** Reads and checks a ladder config: Kalshi series, "HH:MM" fixings, 1–3 rungs, and 18-decimal
 * tokens (the markets' default limits are in 18-decimal units). */
export async function loadLadders(client: PublicClient, raw: unknown): Promise<LadderConfig> {
  const config = raw as Partial<LadderConfig>;
  const ladders = { daily: config.daily ?? [], weekly: config.weekly ?? [] };
  const tokens = new Map<Address, string>();
  for (const ladder of [...ladders.daily, ...ladders.weekly]) {
    if (!/^[A-Z0-9]+$/.test(ladder.series)) throw new Error(`Invalid series ${ladder.series}`);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(ladder.fixing))
      throw new Error(`Invalid fixing ${ladder.fixing} for ${ladder.series}`);
    for (const token of ladder.tokens) {
      if (![1, 2, 3].includes(token.rungs))
        throw new Error(`${token.symbol} on ${ladder.series} needs 1 to 3 rungs`);
      token.base = getAddress(token.base);
      tokens.set(token.base, token.symbol);
    }
  }
  await Promise.all(
    [...tokens].map(async ([address, symbol]) => {
      const decimals = await client.readContract({
        address,
        abi: erc20Abi,
        functionName: "decimals",
      });
      if (decimals !== 18) throw new Error(`${symbol} has ${decimals} decimals, not 18`);
    }),
  );
  return ladders;
}
