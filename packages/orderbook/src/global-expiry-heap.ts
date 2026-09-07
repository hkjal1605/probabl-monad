import type { Hex } from "viem";

export interface RoutedExpiry {
  bookKey: string;
  expiry: bigint;
  orderHash: Hex;
  sequence: bigint;
}

const before = (left: RoutedExpiry, right: RoutedExpiry): boolean =>
  left.expiry < right.expiry ||
  (left.expiry === right.expiry &&
    (left.sequence < right.sequence ||
      (left.sequence === right.sequence && left.orderHash < right.orderHash)));

export class GlobalExpiryHeap {
  readonly #entries: RoutedExpiry[] = [];

  add(entry: RoutedExpiry): void {
    this.#entries.push(entry);
    let index = this.#entries.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const current = this.#entries[index];
      const parentEntry = this.#entries[parent];
      if (!current || !parentEntry || !before(current, parentEntry)) return;
      this.#entries[index] = parentEntry;
      this.#entries[parent] = current;
      index = parent;
    }
  }

  popExpired(timestamp: bigint): RoutedExpiry[] {
    const expired: RoutedExpiry[] = [];
    while (true) {
      const first = this.#entries[0];
      if (!first || first.expiry > timestamp) return expired;
      expired.push(first);
      const tail = this.#entries.pop();
      if (!tail || this.#entries.length === 0) continue;
      this.#entries[0] = tail;
      this.#sink();
    }
  }

  #sink(): void {
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      const leftEntry = this.#entries[left];
      const currentSmallest = this.#entries[smallest];
      if (leftEntry && currentSmallest && before(leftEntry, currentSmallest)) smallest = left;
      const rightEntry = this.#entries[right];
      const nextSmallest = this.#entries[smallest];
      if (rightEntry && nextSmallest && before(rightEntry, nextSmallest)) smallest = right;
      if (smallest === index) return;
      const current = this.#entries[index];
      const replacement = this.#entries[smallest];
      if (!current || !replacement) return;
      this.#entries[index] = replacement;
      this.#entries[smallest] = current;
      index = smallest;
    }
  }
}
