import { Side } from "@conditional-stocks/domain";
import type { Hex } from "viem";

import { MatcherInvariantError } from "./errors.ts";
import type { BookOrder, PriceLevelSnapshot } from "./types.ts";

interface PriceLevel {
  head: Hex;
  orderCount: number;
  priceRawX18: bigint;
  tail: Hex;
}

export interface PriceCandidate {
  available: bigint;
  order: BookOrder;
}

/**
 * Dense sorted price indexes plus intrusive FIFO queues. Price lookup is O(1),
 * insertion/removal within a level is O(1), and inserting a new level is O(log L)
 * lookup plus a dense-array move. The latter is deliberately optimized for the
 * relatively bounded tick ranges in v1 and avoids a JS object tree per level.
 */
export class PriceSide {
  readonly #levels = new Map<bigint, PriceLevel>();
  readonly #orders: Map<Hex, BookOrder>;
  readonly #prices: bigint[] = [];
  readonly #side: Side;

  constructor(side: Side, orders: Map<Hex, BookOrder>) {
    this.#side = side;
    this.#orders = orders;
  }

  get levelCount(): number {
    return this.#prices.length;
  }

  add(order: BookOrder): void {
    if (order.side !== this.#side || order.previous !== null || order.next !== null) {
      throw new MatcherInvariantError("order cannot be inserted into this price side");
    }

    const existing = this.#levels.get(order.limitPriceRawX18);
    if (existing) {
      const tail = this.#orders.get(existing.tail);
      if (!tail) throw new MatcherInvariantError("price level tail is missing");
      if (tail.sequence >= order.sequence) {
        throw new MatcherInvariantError("FIFO insertion is not in canonical sequence order");
      }
      tail.next = order.orderHash;
      order.previous = tail.orderHash;
      existing.tail = order.orderHash;
      existing.orderCount += 1;
      return;
    }

    const insertionIndex = this.#lowerBound(order.limitPriceRawX18);
    this.#prices.splice(insertionIndex, 0, order.limitPriceRawX18);
    this.#levels.set(order.limitPriceRawX18, {
      head: order.orderHash,
      orderCount: 1,
      priceRawX18: order.limitPriceRawX18,
      tail: order.orderHash,
    });
  }

  remove(order: BookOrder): void {
    const level = this.#levels.get(order.limitPriceRawX18);
    if (!level) throw new MatcherInvariantError("order price level is missing");

    if (order.previous === null) {
      if (level.head !== order.orderHash) throw new MatcherInvariantError("invalid level head");
      if (order.next !== null) level.head = order.next;
    } else {
      const previous = this.#orders.get(order.previous);
      if (!previous || previous.next !== order.orderHash) {
        throw new MatcherInvariantError("invalid previous order link");
      }
      previous.next = order.next;
    }

    if (order.next === null) {
      if (level.tail !== order.orderHash) throw new MatcherInvariantError("invalid level tail");
      if (order.previous !== null) level.tail = order.previous;
    } else {
      const next = this.#orders.get(order.next);
      if (!next || next.previous !== order.orderHash) {
        throw new MatcherInvariantError("invalid next order link");
      }
      next.previous = order.previous;
    }

    order.previous = null;
    order.next = null;
    level.orderCount -= 1;
    if (level.orderCount === 0) {
      this.#levels.delete(level.priceRawX18);
      const index = this.#lowerBound(level.priceRawX18);
      if (this.#prices[index] !== level.priceRawX18) {
        throw new MatcherInvariantError("price index and level map diverged");
      }
      this.#prices.splice(index, 1);
    }
  }

  bestCandidate(localUsed: ReadonlyMap<Hex, bigint>): PriceCandidate | null {
    if (this.#side === Side.Buy) {
      for (let index = this.#prices.length - 1; index >= 0; index -= 1) {
        const candidate = this.#candidateAt(this.#prices[index], localUsed);
        if (candidate) return candidate;
      }
      return null;
    }

    for (const price of this.#prices) {
      const candidate = this.#candidateAt(price, localUsed);
      if (candidate) return candidate;
    }
    return null;
  }

  queueAt(priceRawX18: bigint, localUsed: ReadonlyMap<Hex, bigint>): Hex[] {
    const hashes: Hex[] = [];
    const level = this.#levels.get(priceRawX18);
    if (!level) return hashes;

    let current: Hex | null = level.head;
    while (current !== null) {
      const order = this.#orders.get(current);
      if (!order) throw new MatcherInvariantError("queue contains a missing order");
      const available = order.remaining - order.pending - (localUsed.get(current) ?? 0n);
      if (order.matchable && available > 0n) hashes.push(current);
      current = order.next;
    }
    return hashes;
  }

  snapshot(): PriceLevelSnapshot[] {
    const prices = this.#side === Side.Buy ? this.#prices.toReversed() : this.#prices;
    return prices.map((priceRawX18) => {
      const orderHashes = this.queueAt(priceRawX18, new Map());
      let totalAvailable = 0n;
      for (const hash of orderHashes) {
        const order = this.#orders.get(hash);
        if (!order) throw new MatcherInvariantError("snapshot order is missing");
        totalAvailable += order.remaining - order.pending;
      }
      return { orderHashes, priceRawX18, totalAvailable };
    });
  }

  assertIntegrity(): void {
    if (this.#prices.length !== this.#levels.size) {
      throw new MatcherInvariantError("price index and level count diverged");
    }
    for (let index = 1; index < this.#prices.length; index += 1) {
      const previous = this.#prices[index - 1];
      const current = this.#prices[index];
      if (previous === undefined || current === undefined || previous >= current) {
        throw new MatcherInvariantError("price index is not strictly ascending");
      }
    }
    for (const price of this.#prices) {
      const level = this.#levels.get(price);
      if (!level) throw new MatcherInvariantError("indexed price has no level");
      let current: Hex | null = level.head;
      let previous: Hex | null = null;
      let count = 0;
      let lastSequence = -1n;
      while (current !== null) {
        const order = this.#orders.get(current);
        if (!order) throw new MatcherInvariantError("level references a missing order");
        if (!order.matchable || order.side !== this.#side || order.limitPriceRawX18 !== price) {
          throw new MatcherInvariantError("level contains an ineligible order");
        }
        if (order.previous !== previous || order.sequence <= lastSequence) {
          throw new MatcherInvariantError("invalid FIFO links or sequence ordering");
        }
        previous = current;
        lastSequence = order.sequence;
        current = order.next;
        count += 1;
      }
      if (previous !== level.tail || count !== level.orderCount) {
        throw new MatcherInvariantError("level tail or count is invalid");
      }
    }
  }

  #candidateAt(
    priceRawX18: bigint | undefined,
    localUsed: ReadonlyMap<Hex, bigint>,
  ): PriceCandidate | null {
    if (priceRawX18 === undefined) return null;
    const level = this.#levels.get(priceRawX18);
    if (!level) throw new MatcherInvariantError("price index references no level");
    let current: Hex | null = level.head;
    while (current !== null) {
      const order = this.#orders.get(current);
      if (!order) throw new MatcherInvariantError("price level references a missing order");
      const available = order.remaining - order.pending - (localUsed.get(current) ?? 0n);
      if (order.matchable && available > 0n) return { available, order };
      current = order.next;
    }
    return null;
  }

  #lowerBound(price: bigint): number {
    let low = 0;
    let high = this.#prices.length;
    while (low < high) {
      const middle = low + ((high - low) >> 1);
      const value = this.#prices[middle];
      if (value !== undefined && value < price) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
