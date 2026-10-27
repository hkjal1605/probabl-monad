import { hashCanonical, MarketDataError, object } from "../canonical.ts";
import { PROBABILITY_SCALE, type ProbabilityTick, parseX6, YesBook } from "../probability.ts";

const levels = (value: unknown, name: string): Array<[bigint, bigint]> => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new MarketDataError("INVALID_BOOK", `${name} must be an array`);
  return value.map((level, index) => {
    if (!Array.isArray(level) || level.length !== 2)
      throw new MarketDataError("INVALID_BOOK", `${name}[${index}] must be [price, size]`);
    const price = parseX6(level[0], `${name}[${index}] price`);
    const size = parseX6(level[1], `${name}[${index}] size`);
    if (price <= 0n || price >= PROBABILITY_SCALE)
      throw new MarketDataError("INVALID_BOOK", `${name}[${index}] is outside valid bounds`);
    return [price, size];
  });
};

/** A Kalshi market's YES book, from REST snapshots (`GET /markets/{ticker}/orderbook`). Kalshi
 * lists bids only: a NO bid at price p is a YES ask at 1 − p. */
export class KalshiYesBook extends YesBook {
  applyOrderbook(input: unknown, nowMs = BigInt(Date.now())): ProbabilityTick {
    const raw = object(input, "orderbook response");
    const book =
      raw.orderbook_fp === undefined || raw.orderbook_fp === null
        ? {}
        : object(raw.orderbook_fp, "orderbook_fp");
    const bids = levels(book.yes_dollars, "yes_dollars");
    const asks = levels(book.no_dollars, "no_dollars").map(([price, size]): [bigint, bigint] => [
      PROBABILITY_SCALE - price,
      size,
    ]);
    this.replace(this.bids, bids);
    this.replace(this.asks, asks);
    this.observedAtMs = nowMs;
    this.sourceHash = hashCanonical(raw);
    this.connected = true;
    return this.tick(nowMs);
  }
}
