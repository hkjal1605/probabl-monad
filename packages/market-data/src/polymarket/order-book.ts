import type { Hex } from "../canonical.ts";
import { hashCanonical, MarketDataError, object, requiredString } from "../canonical.ts";
import { PROBABILITY_SCALE, type ProbabilityTick, parseX6, YesBook } from "../probability.ts";

export interface ApplyResult {
  applied: boolean;
  duplicate: boolean;
  requiresSnapshot: boolean;
  tick: ProbabilityTick | null;
}

const timestamp = (value: unknown, name: string): bigint => {
  const parsed = parseX6(requiredString(value, name, 32), name);
  // A timestamp is an integer; parseX6() is reused only for strict decimal parsing.
  if (parsed % PROBABILITY_SCALE !== 0n) {
    throw new MarketDataError("INVALID_BOOK", `${name} must be an integer`);
  }
  const raw = parsed / PROBABILITY_SCALE;
  return raw < 10_000_000_000n ? raw * 1_000n : raw;
};

const sequence = (value: unknown): bigint | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new MarketDataError("INVALID_BOOK", "sequence must be an integer string");
  }
  return BigInt(value);
};

const levels = (value: unknown, name: string): Array<[bigint, bigint]> => {
  if (!Array.isArray(value)) throw new MarketDataError("INVALID_BOOK", `${name} must be an array`);
  return value.map((item, index) => {
    const level = object(item, `${name}[${index}]`);
    const price = parseX6(level.price, `${name}[${index}].price`);
    const size = parseX6(level.size, `${name}[${index}].size`);
    if (price <= 0n || price >= PROBABILITY_SCALE || size < 0n) {
      throw new MarketDataError("INVALID_BOOK", `${name}[${index}] is outside valid bounds`);
    }
    return [price, size];
  });
};

/** Polymarket's YES token book, from REST snapshots and the market WebSocket. */
export class PolymarketYesBook extends YesBook {
  readonly #seen = new Set<Hex>();
  #lastSequence: bigint | null = null;
  #sourceAtMs = 0n;

  applySnapshot(input: unknown, nowMs = BigInt(Date.now())): ApplyResult {
    const raw = object(input, "snapshot");
    this.#assertIdentity(raw);
    const eventDigest = hashCanonical(raw);
    const duplicate = this.#seen.has(eventDigest);
    const sourceAtMs = timestamp(raw.timestamp, "timestamp");
    if (sourceAtMs > nowMs + 5_000n)
      throw new MarketDataError("INVALID_BOOK", "snapshot timestamp is in the future");
    if (sourceAtMs < this.#sourceAtMs) return this.#result(false, false, true, nowMs);
    // REST is the authoritative recovery source and must replace local state even when a
    // repeated payload hash was seen before a WebSocket delta.
    const bids = levels(raw.bids, "bids");
    const asks = levels(raw.asks, "asks");
    const sourceHash = requiredString(raw.hash, "hash", 512);
    const nextSequence = sequence(raw.sequence);
    this.replace(this.bids, bids);
    this.replace(this.asks, asks);
    this.#sourceAtMs = sourceAtMs;
    // A successful REST read proves that this unchanged book is still the
    // authoritative current snapshot. Keep the source-change timestamp only
    // for ordering; freshness is based on when we actually observed it.
    this.observedAtMs = nowMs;
    this.sourceHash = sourceHash;
    this.#lastSequence = nextSequence;
    this.connected = true;
    if (!duplicate) this.#remember(eventDigest);
    return { applied: !duplicate, duplicate, requiresSnapshot: false, tick: this.tick(nowMs) };
  }

  applyWebSocket(input: unknown, nowMs = BigInt(Date.now())): ApplyResult {
    const raw = object(input, "WebSocket event");
    const eventType = requiredString(raw.event_type, "event_type", 64);
    if (eventType === "book") return this.applySnapshot(raw, nowMs);
    if (eventType !== "price_change") return this.#result(false, false, false, nowMs);
    if (requiredString(raw.market, "market", 66).toLowerCase() !== this.conditionId.toLowerCase()) {
      throw new MarketDataError(
        "MAPPING_MISMATCH",
        "WebSocket condition does not match subscription",
      );
    }
    const eventDigest = hashCanonical(raw);
    if (this.#seen.has(eventDigest)) return this.#result(false, true, false, nowMs);
    const nextSequence = sequence(raw.sequence);
    if (
      nextSequence !== null &&
      this.#lastSequence !== null &&
      nextSequence !== this.#lastSequence + 1n
    ) {
      return this.#result(false, false, true, nowMs);
    }
    const observedAtMs = timestamp(raw.timestamp, "timestamp");
    if (observedAtMs < this.#sourceAtMs) return this.#result(false, false, true, nowMs);
    if (!Array.isArray(raw.price_changes)) {
      throw new MarketDataError("INVALID_BOOK", "price_changes must be an array");
    }
    const changes: Array<{ target: Map<bigint, bigint>; price: bigint; size: bigint }> = [];
    for (const [index, inputChange] of raw.price_changes.entries()) {
      const change = object(inputChange, `price_changes[${index}]`);
      if (requiredString(change.asset_id, "asset_id", 128) !== this.yesTokenId) continue;
      const price = parseX6(change.price, "price");
      const size = parseX6(change.size, "size");
      if (price <= 0n || price >= PROBABILITY_SCALE || size < 0n) {
        throw new MarketDataError("INVALID_BOOK", "price change is outside valid bounds");
      }
      const side = requiredString(change.side, "side", 8);
      const target = side === "BUY" ? this.bids : side === "SELL" ? this.asks : null;
      if (!target) throw new MarketDataError("INVALID_BOOK", "side must be BUY or SELL");
      changes.push({ target, price, size });
    }
    // Validate the entire event before changing any book level.
    for (const { target, price, size } of changes) {
      if (size === 0n) target.delete(price);
      else target.set(price, size);
    }
    this.observedAtMs = observedAtMs;
    this.#sourceAtMs = observedAtMs;
    this.sourceHash = eventDigest;
    this.#lastSequence = nextSequence ?? this.#lastSequence;
    this.connected = true;
    this.#remember(eventDigest);
    return this.#result(true, false, false, nowMs);
  }

  #assertIdentity(raw: Record<string, unknown>): void {
    if (requiredString(raw.market, "market", 66).toLowerCase() !== this.conditionId.toLowerCase()) {
      throw new MarketDataError(
        "MAPPING_MISMATCH",
        "snapshot condition does not match subscription",
      );
    }
    if (requiredString(raw.asset_id, "asset_id", 128) !== this.yesTokenId) {
      throw new MarketDataError("MAPPING_MISMATCH", "snapshot asset does not match YES token");
    }
  }

  #remember(digest: Hex): void {
    this.#seen.add(digest);
    if (this.#seen.size > 1_024) {
      const oldest = this.#seen.values().next().value;
      if (oldest) this.#seen.delete(oldest);
    }
  }

  #result(
    applied: boolean,
    duplicate: boolean,
    requiresSnapshot: boolean,
    nowMs: bigint,
  ): ApplyResult {
    return { applied, duplicate, requiresSnapshot, tick: applied ? this.tick(nowMs) : null };
  }
}
