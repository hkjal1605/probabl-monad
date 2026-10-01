import type { MinuteVolume } from "@conditional-stocks/db";

/** Minutes in the volume window: 24 hours. */
export const WINDOW_MINUTES = 24 * 60;
/** The first minute (unix time / 60) of the window ending at `nowMs`: the 24 hours before the
 * current minute, and that minute. */
export const windowStart = (nowMs: number) => Math.floor(nowMs / 60_000) - WINDOW_MINUTES;

/** Quote traded per market over the last 24 hours, kept in (minute, market) buckets so that
 * reading it never queries the database. Finalized trades are added once, in chain order, as
 * they finalize; those finalized by earlier runs are seeded once, from one grouped read. Buckets
 * leave the window as it moves. */
export class DailyVolume {
  /** Buckets in time order; the first `head` have left the window. */
  private buckets: MinuteVolume[] = [];
  private head = 0;
  /** The latest minute's buckets, by market. */
  private open = new Map<number, MinuteVolume>();
  private openMinute = -1;
  /** The window's first minute as of the latest read (it never moves back). */
  private from = 0;
  private totals = new Map<number, bigint>();
  /** Whether the trades finalized before this run are counted. */
  ready = false;

  /** A trade finalized in this run, in chain order (block times never decrease). One already
   * outside the window, as when a restart replays old blocks, is not kept. */
  add(market: number, blockTime: bigint, quote: bigint, nowMs = Date.now()) {
    const minute = Number(blockTime / 60n);
    if (minute < Math.max(this.from, windowStart(nowMs)) || quote <= 0n) return;
    if (minute !== this.openMinute) {
      this.openMinute = minute;
      this.open = new Map();
    }
    let bucket = this.open.get(market);
    if (!bucket) {
      bucket = { market, minute, quote: 0n };
      this.open.set(market, bucket);
      this.buckets.push(bucket);
    }
    bucket.quote += quote;
    this.totals.set(market, (this.totals.get(market) ?? 0n) + quote);
  }

  /** Buckets of the trades finalized before this run: older than any added in it. */
  seed(rows: readonly MinuteVolume[], nowMs = Date.now()) {
    const from = windowStart(nowMs);
    const older = rows
      .filter((r) => r.minute >= from && r.quote > 0n)
      .map((r) => ({ ...r }))
      .sort((a, b) => a.minute - b.minute);
    for (const r of older) this.totals.set(r.market, (this.totals.get(r.market) ?? 0n) + r.quote);
    this.buckets = [...older, ...this.buckets.slice(this.head)];
    this.head = 0;
    this.ready = true;
  }

  /** Each market's quote traded from `windowStart(nowMs)` on (markets without trades are
   * absent). Callers must not modify the map. */
  window(nowMs: number): ReadonlyMap<number, bigint> {
    this.from = Math.max(this.from, windowStart(nowMs));
    while (this.head < this.buckets.length) {
      const bucket = this.buckets[this.head] as MinuteVolume;
      if (bucket.minute >= this.from) break;
      this.head++;
      const total = (this.totals.get(bucket.market) ?? 0n) - bucket.quote;
      if (total > 0n) this.totals.set(bucket.market, total);
      else this.totals.delete(bucket.market);
    }
    if (this.head >= 1_024 && this.head * 2 >= this.buckets.length) {
      this.buckets = this.buckets.slice(this.head);
      this.head = 0;
    }
    return this.totals;
  }
}
