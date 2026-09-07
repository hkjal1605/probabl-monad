import {
  Branch,
  type Order,
  quoteForExecution,
  quoteForReservation,
  Side,
  TimeInForce,
} from "@conditional-stocks/domain";
import type { Address, Hex } from "viem";

import { compareCursors, hashCanonical } from "./canonical.ts";
import { CanonicalInputError, MatcherInvariantError, StaleProposalError } from "./errors.ts";
import { GlobalExpiryHeap } from "./global-expiry-heap.ts";
import { makeBookKey } from "./order-book.ts";
import {
  type BookOrderSnapshot,
  type ChainCursor,
  type EngineApplyResult,
  MATCHER_ENGINE_VERSION,
  MATCHER_SCHEMA_VERSION,
  MarketState,
  type MatchDecision,
  type MatcherCheckpoint,
  type MatcherCheckpointData,
  type MatcherEventEnvelope,
  type MatchFill,
  type MatchPreview,
  type MatchProposal,
  MatchSkipReason,
  type OrderBookSnapshot,
  type OrderOpenedEvent,
  type PendingFillSnapshot,
  type PendingProposalSnapshot,
} from "./types.ts";
import { normalizeMatcherEnvelope } from "./validation.ts";

interface ReferenceCandidate {
  available: bigint;
  order: BookOrderSnapshot;
}

const orderPayload = (order: BookOrderSnapshot): Order => ({
  maxFeeBps: order.maxFeeBps,
  branch: order.branch,
  expiry: order.expiry,
  fundingKind: order.fundingKind,
  limitPriceRawX18: order.limitPriceRawX18,
  maker: order.maker,
  marketId: order.marketId,
  nonce: order.nonce,
  quantity: order.quantity,
  recipient: order.recipient,
  salt: order.salt,
  side: order.side,
  tif: order.tif,
});

const unsignedProposal = (
  proposal: MatchProposal,
): Omit<MatchProposal, "batchId" | "proposalId"> => {
  const { batchId: _batchId, proposalId: _proposalId, ...unsigned } = proposal;
  return unsigned;
};

/**
 * Deliberately slow and structurally independent implementation used by tests
 * and the production shadow path. It sorts flat arrays for every decision and
 * shares no price-index or intrusive-queue code with the optimized book.
 */
class ReferenceBook {
  readonly branch: Branch;
  readonly marketId: Hex;
  readonly orders = new Map<Hex, BookOrderSnapshot>();
  highestSequence = -1n;
  pendingProposal: PendingProposalSnapshot | null = null;

  constructor(marketId: Hex, branch: Branch) {
    this.marketId = marketId;
    this.branch = branch;
  }

  get key(): string {
    return makeBookKey(this.marketId, this.branch);
  }

  open(event: OrderOpenedEvent, minimumNonce: bigint, timestamp: bigint): void {
    if (event.sequence !== this.highestSequence + 1n) {
      throw new MatcherInvariantError("reference matcher received a sequence gap");
    }
    this.highestSequence = event.sequence;
    if (event.order.tif === TimeInForce.Ioc) return;
    this.orders.set(event.orderHash, {
      ...event.order,
      matchable: event.order.expiry > timestamp && event.order.nonce >= minimumNonce,
      orderHash: event.orderHash,
      pending: 0n,
      remaining: event.order.quantity,
      reserved: event.reserved,
      sequence: event.sequence,
    });
  }

  cancel(orderHash: Hex, expectedUnfilled: bigint): Hex | null {
    const order = this.orders.get(orderHash);
    if (!order) return null;
    if (order.remaining !== expectedUnfilled) {
      throw new MatcherInvariantError("reference cancel quantity mismatch");
    }
    const invalidated = this.pendingContains(orderHash) ? this.releaseProposal() : null;
    this.orders.delete(orderHash);
    return invalidated;
  }

  fill(buyHash: Hex, sellHash: Hex, quantity: bigint): Hex | null {
    let invalidated: Hex | null = null;
    const pendingPair = this.pendingProposal?.fills.find(
      (fill) =>
        fill.remainingQuantity > 0n &&
        fill.buyOrderHash === buyHash &&
        fill.sellOrderHash === sellHash,
    );
    if (
      this.pendingProposal &&
      !pendingPair &&
      (this.pendingContains(buyHash) || this.pendingContains(sellHash))
    ) {
      invalidated = this.releaseProposal();
    } else if (pendingPair) {
      if (quantity > pendingPair.remainingQuantity) {
        throw new MatcherInvariantError("reference pending fill overflow");
      }
      this.decreasePending(buyHash, quantity);
      this.decreasePending(sellHash, quantity);
      pendingPair.remainingQuantity -= quantity;
      if (this.pendingProposal?.fills.every((fill) => fill.remainingQuantity === 0n)) {
        this.pendingProposal = null;
      }
    }
    this.consume(buyHash, Side.Buy, quantity);
    this.consume(sellHash, Side.Sell, quantity);
    return invalidated;
  }

  expireOrder(orderHash: Hex, timestamp: bigint): Hex | null {
    const order = this.orders.get(orderHash);
    if (!order?.matchable || order.expiry > timestamp) return null;
    const invalidated = this.pendingContains(orderHash) ? this.releaseProposal() : null;
    order.matchable = false;
    return invalidated;
  }

  invalidateMakerNonce(maker: Address, minimumNonce: bigint): Hex | null {
    let invalidated: Hex | null = null;
    for (const order of this.orders.values()) {
      if (!order.matchable || order.maker !== maker || order.nonce >= minimumNonce) {
        continue;
      }
      if (this.pendingContains(order.orderHash)) invalidated = this.releaseProposal();
      order.matchable = false;
    }
    return invalidated;
  }

  hasCross(): boolean {
    const usage = new Map<Hex, bigint>();
    const bid = this.best(Side.Buy, usage);
    const ask = this.best(Side.Sell, usage);
    return Boolean(bid && ask && bid.order.limitPriceRawX18 >= ask.order.limitPriceRawX18);
  }

  buildProposal(
    cursor: ChainCursor,
    maxFills: number,
  ): { blocked: boolean; proposal: MatchProposal | null } {
    if (this.pendingProposal) return { blocked: false, proposal: null };
    const localUsed = new Map<Hex, bigint>();
    const decisions: MatchDecision[] = [];
    const fills: MatchFill[] = [];
    let blocked = false;
    while (fills.length < maxFills) {
      const bid = this.best(Side.Buy, localUsed);
      const ask = this.best(Side.Sell, localUsed);
      if (!bid || !ask || bid.order.limitPriceRawX18 < ask.order.limitPriceRawX18) break;
      const maker = bid.order.sequence < ask.order.sequence ? bid.order : ask.order;
      const taker = maker === bid.order ? ask.order : bid.order;
      const fillQuantity = bid.available < ask.available ? bid.available : ask.available;
      if (quoteForExecution(fillQuantity, maker.limitPriceRawX18) === 0n) {
        blocked = true;
        break;
      }
      decisions.push({
        askQueue: {
          orderHashes: this.queue(Side.Sell, ask.order.limitPriceRawX18, localUsed),
          priceRawX18: ask.order.limitPriceRawX18,
        },
        bidQueue: {
          orderHashes: this.queue(Side.Buy, bid.order.limitPriceRawX18, localUsed),
          priceRawX18: bid.order.limitPriceRawX18,
        },
        buyOrderHash: bid.order.orderHash,
        executionPriceRawX18: maker.limitPriceRawX18,
        fillQuantity,
        makerOrderHash: maker.orderHash,
        makerSequence: maker.sequence,
        sellOrderHash: ask.order.orderHash,
        step: fills.length,
        takerOrderHash: taker.orderHash,
        takerSequence: taker.sequence,
      });
      fills.push({
        buyOrder: orderPayload(bid.order),
        buyOrderHash: bid.order.orderHash,
        executionPriceRawX18: maker.limitPriceRawX18,
        fillQuantity,
        makerOrderHash: maker.orderHash,
        sellOrder: orderPayload(ask.order),
        sellOrderHash: ask.order.orderHash,
      });
      localUsed.set(bid.order.orderHash, (localUsed.get(bid.order.orderHash) ?? 0n) + fillQuantity);
      localUsed.set(ask.order.orderHash, (localUsed.get(ask.order.orderHash) ?? 0n) + fillQuantity);
    }
    if (fills.length === 0) return { blocked, proposal: null };
    const unsigned = {
      bookKey: this.key,
      cursor,
      decisions,
      engineVersion: MATCHER_ENGINE_VERSION,
      fills,
      preBookHash: this.hash(),
      schemaVersion: MATCHER_SCHEMA_VERSION,
    };
    const proposalId = hashCanonical(unsigned);
    return { blocked, proposal: { ...unsigned, batchId: proposalId, proposalId } };
  }

  commitProposal(proposal: MatchProposal): void {
    if (this.pendingProposal?.proposal.proposalId === proposal.proposalId) return;
    if (
      this.pendingProposal ||
      proposal.bookKey !== this.key ||
      proposal.preBookHash !== this.hash() ||
      hashCanonical(unsignedProposal(proposal)) !== proposal.proposalId ||
      proposal.batchId !== proposal.proposalId
    ) {
      throw new StaleProposalError("reference proposal is stale or malformed");
    }
    const fills: PendingFillSnapshot[] = proposal.fills.map((fill) => ({
      buyOrderHash: fill.buyOrderHash,
      fillQuantity: fill.fillQuantity,
      remainingQuantity: fill.fillQuantity,
      sellOrderHash: fill.sellOrderHash,
    }));
    this.reserve(fills);
    this.pendingProposal = { fills, proposal };
  }

  releaseProposal(): Hex | null {
    const active = this.pendingProposal;
    if (!active) return null;
    for (const fill of active.fills) {
      if (fill.remainingQuantity === 0n) continue;
      this.decreasePending(fill.buyOrderHash, fill.remainingQuantity);
      this.decreasePending(fill.sellOrderHash, fill.remainingQuantity);
    }
    this.pendingProposal = null;
    return active.proposal.proposalId;
  }

  snapshot(): OrderBookSnapshot {
    const priceLevels = (side: Side) => {
      const grouped = new Map<bigint, BookOrderSnapshot[]>();
      for (const order of this.orders.values()) {
        if (!order.matchable || order.side !== side) continue;
        const orders = grouped.get(order.limitPriceRawX18) ?? [];
        orders.push(order);
        grouped.set(order.limitPriceRawX18, orders);
      }
      const prices = [...grouped.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (side === Side.Buy) prices.reverse();
      return prices.map((priceRawX18) => {
        const orders = grouped.get(priceRawX18) ?? [];
        orders.sort((a, b) => (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0));
        const availableOrders = orders.filter((order) => order.remaining - order.pending > 0n);
        return {
          orderHashes: availableOrders.map((order) => order.orderHash),
          priceRawX18,
          totalAvailable: availableOrders.reduce(
            (total, order) => total + order.remaining - order.pending,
            0n,
          ),
        };
      });
    };
    return {
      asks: priceLevels(Side.Sell),
      bids: priceLevels(Side.Buy),
      branch: this.branch,
      highestSequence: this.highestSequence,
      marketId: this.marketId,
      orders: [...this.orders.values()]
        .sort((a, b) =>
          a.sequence === b.sequence
            ? a.orderHash.localeCompare(b.orderHash)
            : a.sequence < b.sequence
              ? -1
              : 1,
        )
        .map((order) => ({ ...order })),
      pendingProposal: this.pendingProposal
        ? {
            fills: this.pendingProposal.fills.map((fill) => ({ ...fill })),
            proposal: this.pendingProposal.proposal,
          }
        : null,
    };
  }

  hash(): Hex {
    return hashCanonical(this.snapshot());
  }

  private best(side: Side, localUsed: ReadonlyMap<Hex, bigint>): ReferenceCandidate | null {
    const candidates: ReferenceCandidate[] = [];
    for (const order of this.orders.values()) {
      const available = order.remaining - order.pending - (localUsed.get(order.orderHash) ?? 0n);
      if (order.matchable && order.side === side && available > 0n) {
        candidates.push({ available, order });
      }
    }
    candidates.sort((left, right) => {
      if (left.order.limitPriceRawX18 !== right.order.limitPriceRawX18) {
        if (side === Side.Buy) {
          return left.order.limitPriceRawX18 > right.order.limitPriceRawX18 ? -1 : 1;
        }
        return left.order.limitPriceRawX18 < right.order.limitPriceRawX18 ? -1 : 1;
      }
      return left.order.sequence < right.order.sequence ? -1 : 1;
    });
    return candidates[0] ?? null;
  }

  private queue(side: Side, price: bigint, localUsed: ReadonlyMap<Hex, bigint>): Hex[] {
    return [...this.orders.values()]
      .filter(
        (order) =>
          order.matchable &&
          order.side === side &&
          order.limitPriceRawX18 === price &&
          order.remaining - order.pending - (localUsed.get(order.orderHash) ?? 0n) > 0n,
      )
      .sort((left, right) => (left.sequence < right.sequence ? -1 : 1))
      .map((order) => order.orderHash);
  }

  private pendingContains(orderHash: Hex): boolean {
    return (
      this.pendingProposal?.fills.some(
        (fill) =>
          fill.remainingQuantity > 0n &&
          (fill.buyOrderHash === orderHash || fill.sellOrderHash === orderHash),
      ) ?? false
    );
  }

  private decreasePending(orderHash: Hex, quantity: bigint): void {
    const order = this.orders.get(orderHash);
    if (!order || quantity > order.pending)
      throw new MatcherInvariantError("reference pending underflow");
    order.pending -= quantity;
  }

  private consume(orderHash: Hex, expectedSide: Side, quantity: bigint): void {
    const order = this.orders.get(orderHash);
    if (!order) return;
    if (order.side !== expectedSide || quantity > order.remaining) {
      throw new MatcherInvariantError("invalid fill in reference matcher");
    }
    order.remaining -= quantity;
    order.reserved =
      expectedSide === Side.Buy
        ? quoteForReservation(order.remaining, order.limitPriceRawX18)
        : order.remaining;
    if (order.remaining === 0n) this.orders.delete(orderHash);
  }

  private reserve(fills: PendingFillSnapshot[]): void {
    const aggregate = new Map<Hex, bigint>();
    for (const fill of fills) {
      if (fill.remainingQuantity < 0n || fill.remainingQuantity > fill.fillQuantity) {
        throw new StaleProposalError("invalid reference fill reservation");
      }
      aggregate.set(
        fill.buyOrderHash,
        (aggregate.get(fill.buyOrderHash) ?? 0n) + fill.remainingQuantity,
      );
      aggregate.set(
        fill.sellOrderHash,
        (aggregate.get(fill.sellOrderHash) ?? 0n) + fill.remainingQuantity,
      );
    }
    for (const [hash, quantity] of aggregate) {
      const order = this.orders.get(hash);
      if (!order?.matchable || order.remaining - order.pending < quantity) {
        throw new StaleProposalError("reference reservation is no longer available");
      }
    }
    for (const [hash, quantity] of aggregate) {
      const order = this.orders.get(hash);
      if (!order) throw new MatcherInvariantError("reference reservation order disappeared");
      order.pending += quantity;
    }
  }
}

export class SlowReferenceMatcher {
  readonly #books = new Map<string, ReferenceBook>();
  readonly #expiryHeap = new GlobalExpiryHeap();
  readonly #makerMinimumNonces = new Map<string, bigint>();
  readonly #markets = new Map<Hex, MatcherCheckpointData["markets"][number]["terms"]>();
  readonly #maxFills: number;
  readonly #orderBooks = new Map<Hex, string>();
  #cursor: ChainCursor | null = null;
  #emergencyPaused = false;
  #lastEventHash: Hex | null = null;

  constructor(maxFillsPerProposal = 32) {
    this.#maxFills = maxFillsPerProposal;
  }

  apply(input: MatcherEventEnvelope): EngineApplyResult {
    const envelope = normalizeMatcherEnvelope(input);
    const eventHash = hashCanonical(envelope);
    if (this.#cursor) {
      const comparison = compareCursors(envelope.cursor, this.#cursor);
      if (comparison < 0) throw new CanonicalInputError("reference cursor moved backwards");
      if (
        envelope.cursor.blockNumber === this.#cursor.blockNumber &&
        (envelope.cursor.blockHash !== this.#cursor.blockHash ||
          envelope.cursor.blockTimestamp !== this.#cursor.blockTimestamp)
      ) {
        throw new CanonicalInputError("reference block metadata conflict");
      }
      if (
        envelope.cursor.blockNumber > this.#cursor.blockNumber &&
        envelope.cursor.blockTimestamp < this.#cursor.blockTimestamp
      ) {
        throw new CanonicalInputError("reference block timestamp moved backwards");
      }
      if (comparison === 0) {
        if (eventHash !== this.#lastEventHash)
          throw new CanonicalInputError("reference cursor conflict");
        return { affectedBookKeys: [], duplicate: true, eventHash, invalidatedProposalIds: [] };
      }
    }
    const affected = new Set<string>();
    const invalidated = new Set<Hex>();
    for (const expiry of this.#expiryHeap.popExpired(envelope.cursor.blockTimestamp)) {
      const book = this.#books.get(expiry.bookKey);
      const wasMatchable = book?.orders.get(expiry.orderHash)?.matchable ?? false;
      const id = book?.expireOrder(expiry.orderHash, envelope.cursor.blockTimestamp);
      if (wasMatchable) affected.add(expiry.bookKey);
      if (id) invalidated.add(id);
    }
    const event = envelope.event;
    switch (event.type) {
      case "market-terms-configured": {
        const current = this.#markets.get(event.marketId);
        this.#markets.set(event.marketId, {
          baseStep: event.baseStep,
          priceTickRawX18: event.priceTickRawX18,
          state: current?.state ?? MarketState.None,
          tradingCutoff: event.tradingCutoff,
          tradingOpen: event.tradingOpen,
        });
        this.markMarket(event.marketId, affected);
        break;
      }
      case "market-state-changed": {
        const current = this.#markets.get(event.marketId);
        if (current && current.state !== event.previousState) {
          throw new CanonicalInputError("reference market transition mismatch");
        }
        this.#markets.set(event.marketId, {
          baseStep: current?.baseStep ?? 0n,
          priceTickRawX18: current?.priceTickRawX18 ?? 0n,
          state: event.newState,
          tradingCutoff: current?.tradingCutoff ?? 0n,
          tradingOpen: current?.tradingOpen ?? 0n,
        });
        this.markMarket(event.marketId, affected);
        if (event.newState !== MarketState.Open) {
          for (const branch of [Branch.Yes, Branch.No]) {
            const id = this.#books.get(makeBookKey(event.marketId, branch))?.releaseProposal();
            if (id) invalidated.add(id);
          }
        }
        break;
      }
      case "emergency-pause-changed":
        if (event.paused === this.#emergencyPaused)
          throw new CanonicalInputError("reference pause mismatch");
        this.#emergencyPaused = event.paused;
        for (const book of this.#books.values()) {
          affected.add(book.key);
          if (event.paused) {
            const id = book.releaseProposal();
            if (id) invalidated.add(id);
          }
        }
        break;
      case "nonce-invalidated": {
        const current = this.#makerMinimumNonces.get(event.maker) ?? 0n;
        if (current !== event.oldMinimumNonce || event.newMinimumNonce <= current) {
          throw new CanonicalInputError("reference nonce mismatch");
        }
        this.#makerMinimumNonces.set(event.maker, event.newMinimumNonce);
        for (const book of this.#books.values()) {
          const id = book.invalidateMakerNonce(event.maker, event.newMinimumNonce);
          if (id) invalidated.add(id);
          affected.add(book.key);
        }
        break;
      }
      case "order-opened": {
        const book = this.book(event.order.marketId, event.order.branch);
        book.open(
          event,
          this.#makerMinimumNonces.get(event.order.maker) ?? 0n,
          envelope.cursor.blockTimestamp,
        );
        if (event.order.tif === TimeInForce.Gtc) this.#orderBooks.set(event.orderHash, book.key);
        if (event.order.tif === TimeInForce.Gtc) {
          this.#expiryHeap.add({
            bookKey: book.key,
            expiry: event.order.expiry,
            orderHash: event.orderHash,
            sequence: event.sequence,
          });
        }
        affected.add(book.key);
        break;
      }
      case "order-cancelled": {
        const key = this.#orderBooks.get(event.orderHash);
        if (!key) break;
        const book = this.#books.get(key);
        if (!book) throw new MatcherInvariantError("reference order book missing");
        const id = book.cancel(event.orderHash, event.unfilledQuantity);
        if (id) invalidated.add(id);
        this.#orderBooks.delete(event.orderHash);
        affected.add(key);
        break;
      }
      case "order-filled": {
        const key = makeBookKey(event.marketId, event.branch);
        const book = this.#books.get(key);
        if (!book) throw new MatcherInvariantError("reference fill book missing");
        const id = book.fill(event.buyOrderHash, event.sellOrderHash, event.fillQuantity);
        if (id) invalidated.add(id);
        if (!book.orders.has(event.buyOrderHash)) this.#orderBooks.delete(event.buyOrderHash);
        if (!book.orders.has(event.sellOrderHash)) this.#orderBooks.delete(event.sellOrderHash);
        affected.add(key);
        break;
      }
    }
    this.#cursor = envelope.cursor;
    this.#lastEventHash = eventHash;
    return {
      affectedBookKeys: [...affected].sort(),
      duplicate: false,
      eventHash,
      invalidatedProposalIds: [...invalidated].sort(),
    };
  }

  preview(bookKey: string): MatchPreview {
    const book = this.#books.get(bookKey);
    const skip = (reason: MatchSkipReason): MatchPreview => ({
      proposal: null,
      skip: { bookKey, cursor: this.#cursor, reason },
    });
    if (book?.pendingProposal) return skip(MatchSkipReason.ActiveProposal);
    if (!book?.hasCross()) return skip(MatchSkipReason.NoCross);
    if (!this.#cursor) return skip(MatchSkipReason.MarketTermsMissing);
    if (this.#emergencyPaused) return skip(MatchSkipReason.Paused);
    const terms = this.#markets.get(book.marketId);
    if (!terms || terms.baseStep <= 0n) return skip(MatchSkipReason.MarketTermsMissing);
    if (terms.state !== MarketState.Open || this.#cursor.blockTimestamp < terms.tradingOpen) {
      return skip(MatchSkipReason.MarketClosed);
    }
    if (this.#cursor.blockTimestamp >= terms.tradingCutoff)
      return skip(MatchSkipReason.MarketCutoff);
    const result = book.buildProposal(this.#cursor, this.#maxFills);
    if (!result.proposal) {
      return skip(result.blocked ? MatchSkipReason.InvalidZeroQuote : MatchSkipReason.NoCross);
    }
    return { proposal: result.proposal, skip: null };
  }

  commitProposal(proposal: MatchProposal): void {
    const book = this.#books.get(proposal.bookKey);
    if (!book) throw new StaleProposalError("reference proposal book missing");
    if (!this.#cursor || compareCursors(proposal.cursor, this.#cursor) !== 0) {
      throw new StaleProposalError("reference proposal cursor is stale");
    }
    book.commitProposal(proposal);
  }

  releaseProposal(proposalId: Hex): boolean {
    for (const book of this.#books.values()) {
      if (book.pendingProposal?.proposal.proposalId !== proposalId) continue;
      book.releaseProposal();
      return true;
    }
    return false;
  }

  bookHash(bookKey: string): Hex | null {
    return this.#books.get(bookKey)?.hash() ?? null;
  }

  checkpoint(): MatcherCheckpoint {
    const data: MatcherCheckpointData = {
      books: [...this.#books.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((book) => book.snapshot()),
      cursor: this.#cursor,
      emergencyPaused: this.#emergencyPaused,
      engineVersion: MATCHER_ENGINE_VERSION,
      lastEventHash: this.#lastEventHash,
      makerMinimumNonces: [...this.#makerMinimumNonces.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([maker, minimumNonce]) => ({ maker: maker as Address, minimumNonce })),
      markets: [...this.#markets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([marketId, terms]) => ({ marketId, terms: { ...terms } })),
      schemaVersion: MATCHER_SCHEMA_VERSION,
    };
    return { ...data, checkpointHash: hashCanonical(data) };
  }

  static fromCheckpoint(
    checkpoint: MatcherCheckpoint,
    maxFillsPerProposal = 32,
  ): SlowReferenceMatcher {
    const { checkpointHash, ...data } = checkpoint;
    if (checkpointHash !== hashCanonical(data))
      throw new CanonicalInputError("reference checkpoint hash invalid");
    const matcher = new SlowReferenceMatcher(maxFillsPerProposal);
    matcher.#cursor = checkpoint.cursor;
    matcher.#emergencyPaused = checkpoint.emergencyPaused;
    matcher.#lastEventHash = checkpoint.lastEventHash;
    for (const item of checkpoint.markets) matcher.#markets.set(item.marketId, { ...item.terms });
    for (const item of checkpoint.makerMinimumNonces) {
      matcher.#makerMinimumNonces.set(item.maker, item.minimumNonce);
    }
    for (const snapshot of checkpoint.books) {
      const book = new ReferenceBook(snapshot.marketId, snapshot.branch);
      book.highestSequence = snapshot.highestSequence;
      for (const order of snapshot.orders) {
        book.orders.set(order.orderHash, { ...order });
        matcher.#orderBooks.set(order.orderHash, book.key);
        matcher.#expiryHeap.add({
          bookKey: book.key,
          expiry: order.expiry,
          orderHash: order.orderHash,
          sequence: order.sequence,
        });
      }
      book.pendingProposal = snapshot.pendingProposal
        ? {
            fills: snapshot.pendingProposal.fills.map((fill) => ({ ...fill })),
            proposal: snapshot.pendingProposal.proposal,
          }
        : null;
      matcher.#books.set(book.key, book);
    }
    if (matcher.checkpoint().checkpointHash !== checkpoint.checkpointHash) {
      throw new CanonicalInputError("restored reference state differs from checkpoint");
    }
    return matcher;
  }

  private book(marketId: Hex, branch: Branch): ReferenceBook {
    const key = makeBookKey(marketId, branch);
    const existing = this.#books.get(key);
    if (existing) return existing;
    const book = new ReferenceBook(marketId, branch);
    this.#books.set(key, book);
    return book;
  }

  private markMarket(marketId: Hex, affected: Set<string>): void {
    for (const branch of [Branch.Yes, Branch.No]) {
      const key = makeBookKey(marketId, branch);
      if (this.#books.has(key)) affected.add(key);
    }
  }
}
