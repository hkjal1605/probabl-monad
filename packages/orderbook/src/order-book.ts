import {
  type Branch,
  type Order,
  quoteForExecution,
  quoteForReservation,
  Side,
  TimeInForce,
} from "@conditional-stocks/domain";
import type { Hex } from "viem";

import { canonicalStringify, hashCanonical } from "./canonical.ts";
import { MatcherInvariantError, StaleProposalError } from "./errors.ts";
import { PriceSide } from "./price-side.ts";
import {
  type BookOrder,
  type BookOrderSnapshot,
  type ChainCursor,
  MATCHER_ENGINE_VERSION,
  MATCHER_SCHEMA_VERSION,
  type MatchDecision,
  type MatchFill,
  type MatchProposal,
  type OrderBookSnapshot,
  type OrderOpenedEvent,
  type PendingFillSnapshot,
  type PendingProposalSnapshot,
} from "./types.ts";

export const makeBookKey = (marketId: Hex, branch: Branch): string =>
  `${marketId.toLowerCase()}:${branch}`;

const minBigInt = (left: bigint, right: bigint): bigint => (left < right ? left : right);

const unsignedProposal = (
  proposal: MatchProposal,
): Omit<MatchProposal, "batchId" | "proposalId"> => {
  const { batchId: _batchId, proposalId: _proposalId, ...unsigned } = proposal;
  return unsigned;
};

const orderPayload = (order: BookOrder): Order => ({
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

const snapshotOrder = (order: BookOrder): BookOrderSnapshot => ({
  ...orderPayload(order),
  matchable: order.matchable,
  orderHash: order.orderHash,
  pending: order.pending,
  remaining: order.remaining,
  reserved: order.reserved,
  sequence: order.sequence,
});

interface ProposalBuildResult {
  blockedByZeroQuote: boolean;
  proposal: MatchProposal | null;
}

export class OrderBook {
  readonly #asks: PriceSide;
  readonly #bids: PriceSide;
  readonly #branch: Branch;
  readonly #makerOrders = new Map<string, Set<Hex>>();
  readonly #marketId: Hex;
  readonly #orders = new Map<Hex, BookOrder>();
  #highestSequence = -1n;
  #pendingProposal: PendingProposalSnapshot | null = null;

  constructor(marketId: Hex, branch: Branch) {
    this.#marketId = marketId;
    this.#branch = branch;
    this.#bids = new PriceSide(Side.Buy, this.#orders);
    this.#asks = new PriceSide(Side.Sell, this.#orders);
  }

  get branch(): Branch {
    return this.#branch;
  }

  get highestSequence(): bigint {
    return this.#highestSequence;
  }

  get key(): string {
    return makeBookKey(this.#marketId, this.#branch);
  }

  get marketId(): Hex {
    return this.#marketId;
  }

  get pendingProposalId(): Hex | null {
    return this.#pendingProposal?.proposal.proposalId ?? null;
  }

  get orderCount(): number {
    return this.#orders.size;
  }

  noteSequence(sequence: bigint): void {
    if (sequence !== this.#highestSequence + 1n) {
      throw new MatcherInvariantError(
        `sequence gap for ${this.key}: expected ${this.#highestSequence + 1n}, received ${sequence}`,
      );
    }
    this.#highestSequence = sequence;
  }

  open(event: OrderOpenedEvent, minimumNonce: bigint, timestamp: bigint): void {
    const { order } = event;
    if (order.marketId !== this.#marketId || order.branch !== this.#branch) {
      throw new MatcherInvariantError("order was routed to the wrong book");
    }
    if (this.#orders.has(event.orderHash)) {
      throw new MatcherInvariantError(`duplicate active order ${event.orderHash}`);
    }
    if (order.quantity <= 0n || order.limitPriceRawX18 <= 0n || event.reserved <= 0n) {
      throw new MatcherInvariantError("canonical open order has invalid positive fields");
    }
    const expectedReserved =
      order.side === Side.Buy
        ? quoteForReservation(order.quantity, order.limitPriceRawX18)
        : order.quantity;
    if (event.reserved !== expectedReserved) {
      throw new MatcherInvariantError("canonical order reservation does not match protocol math");
    }
    this.noteSequence(event.sequence);
    if (order.tif === TimeInForce.Ioc) return;

    const matchable = order.expiry > timestamp && order.nonce >= minimumNonce;
    const bookOrder: BookOrder = {
      ...order,
      matchable,
      next: null,
      orderHash: event.orderHash,
      pending: 0n,
      previous: null,
      remaining: order.quantity,
      reserved: event.reserved,
      sequence: event.sequence,
    };
    this.#orders.set(event.orderHash, bookOrder);
    const makerKey = order.maker.toLowerCase();
    const makerSet = this.#makerOrders.get(makerKey) ?? new Set<Hex>();
    makerSet.add(event.orderHash);
    this.#makerOrders.set(makerKey, makerSet);
    if (matchable) this.#side(order.side).add(bookOrder);
  }

  cancel(orderHash: Hex, expectedUnfilled: bigint): Hex | null {
    const order = this.#orders.get(orderHash);
    if (!order) return null;
    if (order.remaining !== expectedUnfilled) {
      throw new MatcherInvariantError(
        `cancel quantity mismatch for ${orderHash}: ${expectedUnfilled} != ${order.remaining}`,
      );
    }
    const invalidated = this.#pendingContains(orderHash) ? this.releaseProposal() : null;
    this.#removeOrder(order);
    return invalidated;
  }

  fill(
    buyOrderHash: Hex,
    sellOrderHash: Hex,
    fillQuantity: bigint,
    executionQuote: bigint,
  ): Hex | null {
    if (fillQuantity <= 0n || executionQuote <= 0n) {
      throw new MatcherInvariantError("canonical fill quantities must be positive");
    }
    let invalidated: Hex | null = null;
    const pendingPair = this.#pendingProposal?.fills.find(
      (fill) =>
        fill.remainingQuantity > 0n &&
        fill.buyOrderHash === buyOrderHash &&
        fill.sellOrderHash === sellOrderHash,
    );
    if (
      this.#pendingProposal &&
      ((!pendingPair &&
        (this.#pendingContains(buyOrderHash) || this.#pendingContains(sellOrderHash))) ||
        (pendingPair !== undefined && fillQuantity > pendingPair.remainingQuantity))
    ) {
      invalidated = this.releaseProposal();
    } else {
      this.#reconcilePendingFill(buyOrderHash, sellOrderHash, fillQuantity);
    }
    this.#consumeOrder(buyOrderHash, Side.Buy, fillQuantity);
    this.#consumeOrder(sellOrderHash, Side.Sell, fillQuantity);
    return invalidated;
  }

  invalidateMakerNonce(maker: string, minimumNonce: bigint): Hex | null {
    const hashes = this.#makerOrders.get(maker.toLowerCase());
    if (!hashes) return null;
    let invalidated: Hex | null = null;
    for (const hash of hashes) {
      const order = this.#orders.get(hash);
      if (!order?.matchable || order.nonce >= minimumNonce) continue;
      if (this.#pendingContains(hash)) invalidated = this.releaseProposal();
      this.#deactivate(order);
    }
    return invalidated;
  }

  expireOrder(orderHash: Hex, timestamp: bigint): Hex | null {
    const order = this.#orders.get(orderHash);
    if (!order?.matchable || order.expiry > timestamp) return null;
    const invalidated = this.#pendingContains(orderHash) ? this.releaseProposal() : null;
    this.#deactivate(order);
    return invalidated;
  }

  invalidatePendingProposal(): Hex | null {
    return this.releaseProposal();
  }

  hasCross(): boolean {
    const emptyUsage = new Map<Hex, bigint>();
    const bid = this.#bids.bestCandidate(emptyUsage);
    const ask = this.#asks.bestCandidate(emptyUsage);
    return bid !== null && ask !== null && bid.order.limitPriceRawX18 >= ask.order.limitPriceRawX18;
  }

  buildProposal(cursor: ChainCursor, maxFills: number): ProposalBuildResult {
    if (!Number.isSafeInteger(maxFills) || maxFills <= 0) {
      throw new RangeError("maxFills must be a positive safe integer");
    }
    if (this.#pendingProposal) {
      return { blockedByZeroQuote: false, proposal: null };
    }

    const localUsed = new Map<Hex, bigint>();
    const decisions: MatchDecision[] = [];
    const fills: MatchFill[] = [];
    let blockedByZeroQuote = false;

    while (fills.length < maxFills) {
      const bid = this.#bids.bestCandidate(localUsed);
      const ask = this.#asks.bestCandidate(localUsed);
      if (!bid || !ask || bid.order.limitPriceRawX18 < ask.order.limitPriceRawX18) break;
      if (bid.order.sequence === ask.order.sequence) {
        throw new MatcherInvariantError("crossing orders cannot have equal canonical sequence");
      }

      const maker = bid.order.sequence < ask.order.sequence ? bid.order : ask.order;
      const taker = maker === bid.order ? ask.order : bid.order;
      const fillQuantity = minBigInt(bid.available, ask.available);
      const executionPriceRawX18 = maker.limitPriceRawX18;
      if (quoteForExecution(fillQuantity, executionPriceRawX18) === 0n) {
        blockedByZeroQuote = true;
        break;
      }

      decisions.push({
        askQueue: {
          orderHashes: this.#asks.queueAt(ask.order.limitPriceRawX18, localUsed),
          priceRawX18: ask.order.limitPriceRawX18,
        },
        bidQueue: {
          orderHashes: this.#bids.queueAt(bid.order.limitPriceRawX18, localUsed),
          priceRawX18: bid.order.limitPriceRawX18,
        },
        buyOrderHash: bid.order.orderHash,
        executionPriceRawX18,
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
        executionPriceRawX18,
        fillQuantity,
        makerOrderHash: maker.orderHash,
        sellOrder: orderPayload(ask.order),
        sellOrderHash: ask.order.orderHash,
      });
      localUsed.set(bid.order.orderHash, (localUsed.get(bid.order.orderHash) ?? 0n) + fillQuantity);
      localUsed.set(ask.order.orderHash, (localUsed.get(ask.order.orderHash) ?? 0n) + fillQuantity);
    }

    if (fills.length === 0) return { blockedByZeroQuote, proposal: null };
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
    return {
      blockedByZeroQuote,
      proposal: { ...unsigned, batchId: proposalId, proposalId },
    };
  }

  commitProposal(proposal: MatchProposal): void {
    if (this.#pendingProposal?.proposal.proposalId === proposal.proposalId) return;
    if (this.#pendingProposal)
      throw new StaleProposalError(`book ${this.key} already has a proposal`);
    if (proposal.bookKey !== this.key || proposal.preBookHash !== this.hash()) {
      throw new StaleProposalError("proposal was built from a different book state");
    }
    const expected = this.buildProposal(proposal.cursor, proposal.fills.length).proposal;
    if (!expected || expected.proposalId !== proposal.proposalId) {
      throw new StaleProposalError("proposal does not follow canonical price-time priority");
    }
    const expectedId = hashCanonical(unsignedProposal(proposal));
    if (proposal.proposalId !== expectedId || proposal.batchId !== expectedId) {
      throw new StaleProposalError("proposal hash is invalid");
    }
    const fills: PendingFillSnapshot[] = proposal.fills.map((fill) => ({
      buyOrderHash: fill.buyOrderHash,
      fillQuantity: fill.fillQuantity,
      remainingQuantity: fill.fillQuantity,
      sellOrderHash: fill.sellOrderHash,
    }));
    this.#reserveFills(fills);
    this.#pendingProposal = { fills, proposal };
  }

  releaseProposal(): Hex | null {
    const active = this.#pendingProposal;
    if (!active) return null;
    for (const fill of active.fills) {
      if (fill.remainingQuantity === 0n) continue;
      this.#decreasePending(fill.buyOrderHash, fill.remainingQuantity);
      this.#decreasePending(fill.sellOrderHash, fill.remainingQuantity);
    }
    this.#pendingProposal = null;
    return active.proposal.proposalId;
  }

  getOrder(orderHash: Hex): BookOrderSnapshot | null {
    const order = this.#orders.get(orderHash);
    return order ? snapshotOrder(order) : null;
  }

  snapshot(): OrderBookSnapshot {
    return {
      asks: this.#asks.snapshot(),
      bids: this.#bids.snapshot(),
      branch: this.#branch,
      highestSequence: this.#highestSequence,
      marketId: this.#marketId,
      orders: [...this.#orders.values()]
        .sort((a, b) =>
          a.sequence === b.sequence
            ? a.orderHash.localeCompare(b.orderHash)
            : a.sequence < b.sequence
              ? -1
              : 1,
        )
        .map(snapshotOrder),
      pendingProposal: this.#pendingProposal
        ? {
            fills: this.#pendingProposal.fills.map((fill) => ({ ...fill })),
            proposal: this.#pendingProposal.proposal,
          }
        : null,
    };
  }

  hash(): Hex {
    return hashCanonical(this.snapshot());
  }

  assertIntegrity(): void {
    this.#bids.assertIntegrity();
    this.#asks.assertIntegrity();
    for (const order of this.#orders.values()) {
      if (
        order.remaining <= 0n ||
        order.pending < 0n ||
        order.pending > order.remaining ||
        order.marketId !== this.#marketId ||
        order.branch !== this.#branch
      ) {
        throw new MatcherInvariantError(`invalid active order state for ${order.orderHash}`);
      }
      if (!order.matchable && (order.next !== null || order.previous !== null)) {
        throw new MatcherInvariantError("inactive order retains queue links");
      }
    }
    if (this.#pendingProposal) {
      const active = this.#pendingProposal;
      const expectedId = hashCanonical(unsignedProposal(active.proposal));
      if (
        active.proposal.bookKey !== this.key ||
        active.proposal.proposalId !== expectedId ||
        active.proposal.batchId !== expectedId ||
        active.fills.length !== active.proposal.fills.length
      ) {
        throw new MatcherInvariantError("active proposal metadata is invalid");
      }
      const pendingByOrder = new Map<Hex, bigint>();
      for (const fill of active.fills) {
        const buy = this.#orders.get(fill.buyOrderHash);
        const sell = this.#orders.get(fill.sellOrderHash);
        if (
          !buy ||
          !sell ||
          buy.side !== Side.Buy ||
          sell.side !== Side.Sell ||
          fill.remainingQuantity < 0n ||
          fill.remainingQuantity > fill.fillQuantity
        ) {
          throw new MatcherInvariantError("active proposal reservation is invalid");
        }
        pendingByOrder.set(
          fill.buyOrderHash,
          (pendingByOrder.get(fill.buyOrderHash) ?? 0n) + fill.remainingQuantity,
        );
        pendingByOrder.set(
          fill.sellOrderHash,
          (pendingByOrder.get(fill.sellOrderHash) ?? 0n) + fill.remainingQuantity,
        );
      }
      for (const order of this.#orders.values()) {
        if (order.pending !== (pendingByOrder.get(order.orderHash) ?? 0n)) {
          throw new MatcherInvariantError("proposal and order pending quantities diverged");
        }
      }
    } else {
      for (const order of this.#orders.values()) {
        if (order.pending !== 0n) throw new MatcherInvariantError("orphan pending quantity");
      }
    }
  }

  static fromSnapshot(snapshot: OrderBookSnapshot): OrderBook {
    const book = new OrderBook(snapshot.marketId, snapshot.branch);
    book.#highestSequence = snapshot.highestSequence;
    for (const item of snapshot.orders) {
      const order: BookOrder = { ...item, next: null, previous: null };
      if (order.remaining <= 0n || order.pending < 0n || order.pending > order.remaining) {
        throw new MatcherInvariantError("invalid order in checkpoint");
      }
      book.#orders.set(order.orderHash, order);
      const makerKey = order.maker.toLowerCase();
      const makerSet = book.#makerOrders.get(makerKey) ?? new Set<Hex>();
      makerSet.add(order.orderHash);
      book.#makerOrders.set(makerKey, makerSet);
      if (order.matchable) book.#side(order.side).add(order);
    }
    if (snapshot.pendingProposal) {
      book.#pendingProposal = {
        fills: snapshot.pendingProposal.fills.map((fill) => ({ ...fill })),
        proposal: snapshot.pendingProposal.proposal,
      };
    }
    book.assertIntegrity();
    if (canonicalStringify(book.snapshot()) !== canonicalStringify(snapshot)) {
      throw new MatcherInvariantError("checkpoint price levels do not match its orders");
    }
    return book;
  }

  #consumeOrder(orderHash: Hex, expectedSide: Side, quantity: bigint): void {
    const order = this.#orders.get(orderHash);
    // IOC legs are intentionally absent from the resting GTC book.
    if (!order) return;
    if (order.side !== expectedSide || quantity > order.remaining) {
      throw new MatcherInvariantError(`invalid canonical fill for ${orderHash}`);
    }
    order.remaining -= quantity;
    order.reserved =
      order.side === Side.Buy
        ? quoteForReservation(order.remaining, order.limitPriceRawX18)
        : order.remaining;
    if (order.remaining === 0n) this.#removeOrder(order);
  }

  #deactivate(order: BookOrder): void {
    if (!order.matchable) return;
    this.#side(order.side).remove(order);
    order.matchable = false;
  }

  #decreasePending(orderHash: Hex, quantity: bigint): void {
    const order = this.#orders.get(orderHash);
    if (!order || quantity > order.pending) {
      throw new MatcherInvariantError(`pending quantity underflow for ${orderHash}`);
    }
    order.pending -= quantity;
  }

  #pendingContains(orderHash: Hex): boolean {
    return (
      this.#pendingProposal?.fills.some(
        (fill) =>
          fill.remainingQuantity > 0n &&
          (fill.buyOrderHash === orderHash || fill.sellOrderHash === orderHash),
      ) ?? false
    );
  }

  #reconcilePendingFill(buyOrderHash: Hex, sellOrderHash: Hex, quantity: bigint): void {
    const active = this.#pendingProposal;
    if (!active) return;
    const fill = active.fills.find(
      (item) =>
        item.remainingQuantity > 0n &&
        item.buyOrderHash === buyOrderHash &&
        item.sellOrderHash === sellOrderHash,
    );
    if (!fill) return;
    if (quantity > fill.remainingQuantity) {
      throw new MatcherInvariantError("canonical fill exceeds its pending proposal quantity");
    }
    this.#decreasePending(buyOrderHash, quantity);
    this.#decreasePending(sellOrderHash, quantity);
    fill.remainingQuantity -= quantity;
    if (active.fills.every((item) => item.remainingQuantity === 0n)) {
      this.#pendingProposal = null;
    }
  }

  #removeOrder(order: BookOrder): void {
    if (order.matchable) this.#side(order.side).remove(order);
    const makerSet = this.#makerOrders.get(order.maker.toLowerCase());
    makerSet?.delete(order.orderHash);
    if (makerSet?.size === 0) this.#makerOrders.delete(order.maker.toLowerCase());
    this.#orders.delete(order.orderHash);
  }

  #reserveFills(fills: PendingFillSnapshot[]): void {
    const aggregate = new Map<Hex, bigint>();
    for (const fill of fills) {
      if (
        fill.remainingQuantity < 0n ||
        fill.remainingQuantity > fill.fillQuantity ||
        fill.fillQuantity <= 0n
      ) {
        throw new StaleProposalError("invalid persisted fill reservation");
      }
      if (fill.remainingQuantity === 0n) continue;
      const buy = this.#orders.get(fill.buyOrderHash);
      const sell = this.#orders.get(fill.sellOrderHash);
      if (!buy || !sell || buy.side !== Side.Buy || sell.side !== Side.Sell) {
        throw new StaleProposalError("proposal sides do not match active orders");
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
    for (const [orderHash, quantity] of aggregate) {
      const order = this.#orders.get(orderHash);
      if (!order?.matchable || order.remaining - order.pending < quantity) {
        throw new StaleProposalError("persisted proposal is no longer reservable");
      }
    }
    for (const [orderHash, quantity] of aggregate) {
      const order = this.#orders.get(orderHash);
      if (!order) throw new MatcherInvariantError("validated reservation order disappeared");
      order.pending += quantity;
    }
  }

  #side(side: Side): PriceSide {
    return side === Side.Buy ? this.#bids : this.#asks;
  }
}
