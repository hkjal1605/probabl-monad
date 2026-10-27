/** Price history for the market charts: every open market's YES and NO midpoints and its stock's
 * reference price, recorded once a minute. A branch's midpoint takes the best bid and ask of its
 * book and of the RFQ makers' current prices together, so markets the Δ-vaults quote only over
 * RFQ chart too. */
import type { Database, MinutePrices } from "@conditional-stocks/db";
import { bookTops, type IndexerService, midpointOf } from "@conditional-stocks/indexer";
import { SPOT_BATCH_SIZE, tokenPriceUsd } from "@conditional-stocks/shared/spot-prices";
import type { QuotePrice } from "../rfq/hub.ts";
import type { SpotPriceSource } from "./robinhood.ts";

/** How far into each minute the recorder reads: blocks of the minute's first seconds land. */
const RECORD_DELAY_MS = 2_000;

/** Records every open market's prices once a minute: midpoints from the in-memory books and RFQ
 * prices and one batched read of the stocks' reference prices (USD per whole token, as the
 * markets show them), then one insert. Every API process may record; a minute's first write is
 * kept. */
export class PriceRecorder {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly deps: {
      indexer: Pick<IndexerService, "domain" | "trading" | "tokens">;
      prices: SpotPriceSource;
      db: Pick<Database, "recordPrices">;
      /** The RFQ makers' current prices (`RfqHub.prices`). */
      quotes?: () => QuotePrice[];
      onError?: (error: unknown) => void;
    },
  ) {}

  start() {
    this.stopped = false;
    this.schedule();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(
      () =>
        void this.record()
          .catch((error) => this.deps.onError?.(error))
          .finally(() => this.schedule()),
      60_000 - (Date.now() % 60_000) + RECORD_DELAY_MS,
    );
  }

  /** Records the minute containing `nowMs`. */
  async record(nowMs = Date.now()) {
    const { indexer, prices, db } = this.deps;
    const s = indexer.trading();
    const markets = [...s.markets.values()].filter((m) => m.state === 2);
    if (!markets.length) return;
    const tops = bookTops(s, BigInt(Math.floor(nowMs / 1000)));
    const quotes = new Map((this.deps.quotes?.() ?? []).map((q) => [`${q.market}:${q.branch}`, q]));
    /** A branch's midpoint between the better of the book's and the makers' bid and ask. */
    const midpoint = (market: number, branch: 0 | 1) => {
      const book = tops.get(market)?.[branch] ?? {},
        quote = quotes.get(`${market}:${branch}`);
      const better = (
        a: bigint | null | undefined,
        b: bigint | null | undefined,
        high: boolean,
      ): bigint | null => (a == null ? (b ?? null) : b == null || (high ? a > b : a < b) ? a : b);
      return midpointOf({
        bid: better(book.bid, quote?.bid, true),
        ask: better(book.ask, quote?.ask, false),
      });
    };
    const bases = [...new Set(markets.map((m) => m.base))];
    const spot = new Map<string, number | null>();
    for (let i = 0; i < bases.length; i += SPOT_BATCH_SIZE) {
      const response = await prices.getPrices(
        bases.slice(i, i + SPOT_BATCH_SIZE).map((token) => ({
          token,
          symbol: indexer.tokens.identity.get(token)?.symbol ?? null,
        })),
      );
      for (const price of response.prices) {
        const live = indexer.tokens.live.get(price.token as `0x${string}`);
        const multiplier = Number(live?.multiplier ?? 10n ** 18n) / 1e18;
        spot.set(price.token.toLowerCase(), tokenPriceUsd(price, multiplier, nowMs));
      }
    }
    const minute = Math.floor(nowMs / 60_000);
    await db.recordPrices(
      indexer.domain,
      markets.map((m): MinutePrices => {
        const usd = spot.get(m.base.toLowerCase());
        return {
          market: m.id,
          minute,
          yes: midpoint(m.id, 0),
          no: midpoint(m.id, 1),
          spot: usd === null || usd === undefined ? null : String(usd),
        };
      }),
    );
  }
}

/** Ranges a history can cover, in minutes back from now (`all`: since the first record). */
export const HISTORY_RANGES = { "1d": 1_440, "1w": 10_080, "1m": 43_200, all: null } as const;
export type HistoryRange = keyof typeof HISTORY_RANGES;
/** Points a history holds at most: each is the last record of its interval. */
export const HISTORY_POINTS = 360;

/** One market's recorded prices over `range`, downsampled to at most `HISTORY_POINTS`. */
export async function priceHistory(
  db: Pick<Database, "priceHistory" | "firstPriceMinute">,
  domain: string,
  market: number,
  range: HistoryRange,
  nowMs = Date.now(),
) {
  const now = Math.floor(nowMs / 60_000),
    span = HISTORY_RANGES[range];
  const first = span === null ? await db.firstPriceMinute(domain, market) : now - span;
  if (first === null) return { interval: 60, points: [] };
  const bucket = Math.max(1, Math.ceil((now - first + 1) / HISTORY_POINTS));
  return {
    interval: bucket * 60,
    points: (await db.priceHistory(domain, market, first, bucket)).map((r) => ({
      time: r.minute * 60,
      yes: r.yes === null ? null : r.yes.toString(),
      no: r.no === null ? null : r.no.toString(),
      spot: r.spot === null ? null : Number(r.spot),
    })),
  };
}
