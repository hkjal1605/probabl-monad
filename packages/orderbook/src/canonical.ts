import { type Hex, keccak256, toBytes } from "viem";

import { CanonicalInputError } from "./errors.ts";
import type { ChainCursor } from "./types.ts";

const BIGINT_TAG = "$bigint";

const encodeCanonical = (value: unknown, seen: Set<object>): string => {
  if (value === null) return "null";
  if (typeof value === "bigint") {
    return `{"${BIGINT_TAG}":${JSON.stringify(value.toString())}}`;
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new CanonicalInputError("canonical numbers must be safe integers");
    }
    return String(value);
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    throw new CanonicalInputError(`unsupported canonical value: ${typeof value}`);
  }

  if (seen.has(value)) throw new CanonicalInputError("canonical value contains a cycle");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => encodeCanonical(item, seen)).join(",")}]`;
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encodeCanonical(record[key], seen)}`);
    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(value);
  }
};

export const canonicalStringify = (value: unknown): string => encodeCanonical(value, new Set());

export const canonicalParse = <T>(value: string): T =>
  JSON.parse(value, (_key, item: unknown) => {
    if (
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      Object.keys(item).length === 1 &&
      BIGINT_TAG in item
    ) {
      const encoded = (item as Record<string, unknown>)[BIGINT_TAG];
      if (typeof encoded !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(encoded)) {
        throw new CanonicalInputError("invalid encoded bigint");
      }
      return BigInt(encoded);
    }
    return item;
  }) as T;

export const hashCanonical = (value: unknown): Hex => keccak256(toBytes(canonicalStringify(value)));

export const compareCursors = (left: ChainCursor, right: ChainCursor): number => {
  if (left.chainId !== right.chainId) {
    throw new CanonicalInputError("cannot compare cursors from different chains");
  }
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex < right.transactionIndex ? -1 : 1;
  }
  if (left.logIndex !== right.logIndex) return left.logIndex < right.logIndex ? -1 : 1;
  return 0;
};

export const assertCursorContinuity = (previous: ChainCursor, next: ChainCursor): number => {
  const comparison = compareCursors(next, previous);
  if (comparison < 0) throw new CanonicalInputError("canonical cursor moved backwards");
  if (
    next.blockNumber === previous.blockNumber &&
    (next.blockHash !== previous.blockHash || next.blockTimestamp !== previous.blockTimestamp)
  ) {
    throw new CanonicalInputError("events in one block disagree on its hash or timestamp");
  }
  if (next.blockNumber > previous.blockNumber && next.blockTimestamp < previous.blockTimestamp) {
    throw new CanonicalInputError("canonical block timestamp moved backwards");
  }
  return comparison;
};

export const cursorKey = (cursor: ChainCursor): string =>
  `${cursor.chainId}:${cursor.blockNumber}:${cursor.transactionIndex}:${cursor.logIndex}`;
