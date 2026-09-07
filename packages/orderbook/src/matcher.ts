import {
  Branch,
  quoteForExecution,
  quoteForReservation,
  Side,
  TimeInForce,
} from "@conditional-stocks/domain";
import { type Hex, keccak256, toBytes } from "viem";

import { assertCursorContinuity, compareCursors, hashCanonical } from "./canonical.ts";
import { CanonicalInputError, MatcherInvariantError, StaleProposalError } from "./errors.ts";
import { GlobalExpiryHeap } from "./global-expiry-heap.ts";
import { makeBookKey, OrderBook } from "./order-book.ts";
import {
  type ChainCursor,
  type EngineApplyResult,
  MATCHER_ENGINE_VERSION,
  MATCHER_SCHEMA_VERSION,
  MarketState,
  type MatcherChainEvent,
  type MatcherCheckpoint,
  type MatcherCheckpointData,
  type MatcherEventEnvelope,
  type MatchPreview,
  type MatchProposal,
  MatchSkipReason,
} from "./types.ts";
import { normalizeMatcherEnvelope } from "./validation.ts";

export interface MatcherOptions {
  maxFillsPerProposal?: number;
}

const IOC_REMAINDER_REASON = keccak256(toBytes("IOC_REMAINDER"));

export class DeterministicMatcher {
  readonly #books = new Map<string, OrderBook>();
  readonly #expiryHeap = new GlobalExpiryHeap();
  readonly #makerMinimumNonces = new Map<string, bigint>();
  readonly #markets = new Map<Hex, MatcherCheckpointData["markets"][number]["terms"]>();
  readonly #maxFillsPerProposal: number;
  readonly #orderBooks = new Map<Hex, string>();
  #cursor: ChainCursor | null = null;
  #emergencyPaused = false;
  #lastEventHash: Hex | null = null;

  constructor(options: MatcherOptions = {}) {
    const maxFills = options.maxFillsPerProposal ?? 32;
    if (!Number.isSafeInteger(maxFills) || maxFills <= 0) {
      throw new RangeError("maxFillsPerProposal must be a positive safe integer");
    }
    this.#maxFillsPerProposal = maxFills;
  }

  get cursor(): ChainCursor | null {
    return this.#cursor;
  }

  get emergencyPaused(): boolean {
    return this.#emergencyPaused;
  }

  get lastEventHash(): Hex | null {
    return this.#lastEventHash;
  }

  get maxFillsPerProposal(): number {
    return this.#maxFillsPerProposal;
  }

  validate(input: MatcherEventEnvelope): void {
    const envelope = normalizeMatcherEnvelope(input);
    const eventHash = hashCanonical(envelope);
    if (this.#cursor) {
      const comparison = assertCursorContinuity(this.#cursor, envelope.cursor);
      if (comparison === 0) {
        if (eventHash !== this.#lastEventHash) {
          throw new CanonicalInputError("conflicting events share a canonical cursor");
        }
        return;
      }
    }
    this.#validateEvent(envelope.event, envelope.cursor.blockTimestamp);
  }

  apply(input: MatcherEventEnvelope): EngineApplyResult {
    const envelope = normalizeMatcherEnvelope(input);
    const eventHash = hashCanonical(envelope);
    if (this.#cursor) {
      const comparison = assertCursorContinuity(this.#cursor, envelope.cursor);
      if (comparison === 0) {
        if (eventHash !== this.#lastEventHash) {
          throw new CanonicalInputError("conflicting events share a canonical cursor");
        }
        return {
          affectedBookKeys: [],
          duplicate: true,
          eventHash,
          invalidatedProposalIds: [],
        };
      }
    }

    this.#validateEvent(envelope.event, envelope.cursor.blockTimestamp);

    const invalidated = new Set<Hex>();
    const affected = new Set<string>();
    for (const expiry of this.#expiryHeap.popExpired(envelope.cursor.blockTimestamp)) {
      const book = this.#books.get(expiry.bookKey);
      const wasMatchable = book?.getOrder(expiry.orderHash)?.matchable ?? false;
      const proposalId = book?.expireOrder(expiry.orderHash, envelope.cursor.blockTimestamp);
      if (wasMatchable) affected.add(expiry.bookKey);
      if (proposalId) invalidated.add(proposalId);
    }

    const event = envelope.event;
    switch (event.type) {
      case "market-terms-configured": {
        if (event.tradingOpen >= event.tradingCutoff) {
          throw new CanonicalInputError("market trading window is invalid");
        }
        const current = this.#markets.get(event.marketId);
        this.#markets.set(event.marketId, {
          baseStep: event.baseStep,
          priceTickRawX18: event.priceTickRawX18,
          state: current?.state ?? MarketState.None,
          tradingCutoff: event.tradingCutoff,
          tradingOpen: event.tradingOpen,
        });
        this.#markMarketBooks(event.marketId, affected);
        break;
      }
      case "market-state-changed": {
        const current = this.#markets.get(event.marketId);
        if (current && current.state !== event.previousState) {
          throw new CanonicalInputError("market state transition does not follow the projection");
        }
        this.#markets.set(event.marketId, {
          baseStep: current?.baseStep ?? 0n,
          priceTickRawX18: current?.priceTickRawX18 ?? 0n,
          state: event.newState,
          tradingCutoff: current?.tradingCutoff ?? 0n,
          tradingOpen: current?.tradingOpen ?? 0n,
        });
        this.#markMarketBooks(event.marketId, affected);
        if (event.newState !== MarketState.Open) {
          this.#invalidateMarket(event.marketId, invalidated);
        }
        break;
      }
      case "emergency-pause-changed": {
        if (event.paused === this.#emergencyPaused) {
          throw new CanonicalInputError("emergency pause event does not change state");
        }
        this.#emergencyPaused = event.paused;
        for (const book of this.#books.values()) {
          affected.add(book.key);
          if (event.paused) {
            const proposalId = book.invalidatePendingProposal();
            if (proposalId) invalidated.add(proposalId);
          }
        }
        break;
      }
      case "nonce-invalidated": {
        const makerKey = event.maker.toLowerCase();
        const current = this.#makerMinimumNonces.get(makerKey) ?? 0n;
        if (current !== event.oldMinimumNonce || event.newMinimumNonce <= current) {
          throw new CanonicalInputError("nonce invalidation does not follow the projection");
        }
        this.#makerMinimumNonces.set(makerKey, event.newMinimumNonce);
        for (const book of this.#books.values()) {
          const proposalId = book.invalidateMakerNonce(makerKey, event.newMinimumNonce);
          if (proposalId) invalidated.add(proposalId);
          affected.add(book.key);
        }
        break;
      }
      case "order-opened": {
        const book = this.#book(event.order.marketId, event.order.branch);
        book.open(
          event,
          this.#makerMinimumNonces.get(event.order.maker.toLowerCase()) ?? 0n,
          envelope.cursor.blockTimestamp,
        );
        if (event.order.tif === TimeInForce.Gtc) {
          this.#orderBooks.set(event.orderHash, book.key);
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
        const bookKey = this.#orderBooks.get(event.orderHash);
        if (!bookKey) break; // IOC remainder or an intentionally absent terminal order.
        const book = this.#books.get(bookKey);
        if (!book) throw new MatcherInvariantError("order index references a missing book");
        const order = book.getOrder(event.orderHash);
        if (!order || order.maker !== event.maker) {
          throw new MatcherInvariantError("cancel event maker does not match the indexed order");
        }
        if (order.reserved !== event.releasedAmount) {
          throw new MatcherInvariantError(
            "cancel release does not match the projected reservation",
          );
        }
        const proposalId = book.cancel(event.orderHash, event.unfilledQuantity);
        if (proposalId) invalidated.add(proposalId);
        this.#orderBooks.delete(event.orderHash);
        affected.add(book.key);
        break;
      }
      case "order-filled": {
        const book = this.#books.get(makeBookKey(event.marketId, event.branch));
        if (!book) throw new MatcherInvariantError("fill references a book with no known orders");
        const buy = book.getOrder(event.buyOrderHash);
        const sell = book.getOrder(event.sellOrderHash);
        const maker = book.getOrder(event.makerOrderHash);
        if (buy && buy.side !== Side.Buy) throw new MatcherInvariantError("buy hash is not a bid");
        if (sell && sell.side !== Side.Sell)
          throw new MatcherInvariantError("sell hash is not an ask");
        if (!maker || maker.limitPriceRawX18 !== event.executionPriceRawX18) {
          throw new MatcherInvariantError("fill maker price does not match the canonical order");
        }
        if (buy && sell) {
          const expectedMaker = buy.sequence < sell.sequence ? buy : sell;
          if (expectedMaker.orderHash !== event.makerOrderHash) {
            throw new MatcherInvariantError("fill maker violates canonical sequence priority");
          }
          if (buy.limitPriceRawX18 < sell.limitPriceRawX18) {
            throw new MatcherInvariantError("fill limits do not cross");
          }
        }
        if (
          quoteForExecution(event.fillQuantity, event.executionPriceRawX18) !== event.executionQuote
        ) {
          throw new MatcherInvariantError("fill quote does not match protocol rounding");
        }
        const proposalId = book.fill(
          event.buyOrderHash,
          event.sellOrderHash,
          event.fillQuantity,
          event.executionQuote,
        );
        if (proposalId) invalidated.add(proposalId);
        if (buy && !book.getOrder(event.buyOrderHash)) this.#orderBooks.delete(event.buyOrderHash);
        if (sell && !book.getOrder(event.sellOrderHash))
          this.#orderBooks.delete(event.sellOrderHash);
        affected.add(book.key);
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
    if (book?.pendingProposalId) return this.#skip(bookKey, MatchSkipReason.ActiveProposal);
    if (!book?.hasCross()) return this.#skip(bookKey, MatchSkipReason.NoCross);
    if (!this.#cursor) return this.#skip(bookKey, MatchSkipReason.MarketTermsMissing);
    if (this.#emergencyPaused) return this.#skip(bookKey, MatchSkipReason.Paused);
    const terms = this.#markets.get(book.marketId);
    if (!terms || terms.baseStep <= 0n) {
      return this.#skip(bookKey, MatchSkipReason.MarketTermsMissing);
    }
    if (terms.state !== MarketState.Open || this.#cursor.blockTimestamp < terms.tradingOpen) {
      return this.#skip(bookKey, MatchSkipReason.MarketClosed);
    }
    if (this.#cursor.blockTimestamp >= terms.tradingCutoff) {
      return this.#skip(bookKey, MatchSkipReason.MarketCutoff);
    }

    const result = book.buildProposal(this.#cursor, this.#maxFillsPerProposal);
    if (!result.proposal) {
      return this.#skip(
        bookKey,
        result.blockedByZeroQuote ? MatchSkipReason.InvalidZeroQuote : MatchSkipReason.NoCross,
      );
    }
    for (const fill of result.proposal.fills) {
      if (fill.fillQuantity % terms.baseStep !== 0n) {
        throw new MatcherInvariantError("proposed fill does not respect the market base step");
      }
    }
    return { proposal: result.proposal, skip: null };
  }

  commitProposal(proposal: MatchProposal): void {
    const book = this.#books.get(proposal.bookKey);
    if (!book) throw new StaleProposalError("proposal references an unknown book");
    if (!this.#cursor || compareCursors(proposal.cursor, this.#cursor) !== 0) {
      throw new StaleProposalError("proposal is not anchored to the matcher cursor");
    }
    if (proposal.fills.length > this.#maxFillsPerProposal) {
      throw new StaleProposalError("proposal exceeds the deterministic batch limit");
    }
    book.commitProposal(proposal);
  }

  releaseProposal(proposalId: Hex): boolean {
    for (const book of this.#books.values()) {
      if (book.pendingProposalId !== proposalId) continue;
      book.releaseProposal();
      return true;
    }
    return false;
  }

  bookKeys(): string[] {
    return [...this.#books.keys()].sort();
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
        .map(([maker, minimumNonce]) => ({ maker: maker as `0x${string}`, minimumNonce })),
      markets: [...this.#markets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([marketId, terms]) => ({ marketId, terms: { ...terms } })),
      schemaVersion: MATCHER_SCHEMA_VERSION,
    };
    return { ...data, checkpointHash: hashCanonical(data) };
  }

  assertIntegrity(): void {
    for (const book of this.#books.values()) book.assertIntegrity();
    for (const [orderHash, bookKey] of this.#orderBooks) {
      if (!this.#books.get(bookKey)?.getOrder(orderHash)) {
        throw new MatcherInvariantError("global order index references a missing order");
      }
    }
  }

  static fromCheckpoint(
    checkpoint: MatcherCheckpoint,
    options: MatcherOptions = {},
  ): DeterministicMatcher {
    const { checkpointHash, ...data } = checkpoint;
    if (
      checkpoint.schemaVersion !== MATCHER_SCHEMA_VERSION ||
      checkpoint.engineVersion !== MATCHER_ENGINE_VERSION ||
      checkpointHash !== hashCanonical(data)
    ) {
      throw new CanonicalInputError("matcher checkpoint version or hash is invalid");
    }
    const matcher = new DeterministicMatcher(options);
    matcher.#cursor = checkpoint.cursor;
    matcher.#emergencyPaused = checkpoint.emergencyPaused;
    matcher.#lastEventHash = checkpoint.lastEventHash;
    for (const item of checkpoint.makerMinimumNonces) {
      matcher.#makerMinimumNonces.set(item.maker.toLowerCase(), item.minimumNonce);
    }
    for (const item of checkpoint.markets) matcher.#markets.set(item.marketId, { ...item.terms });
    for (const snapshot of checkpoint.books) {
      const book = OrderBook.fromSnapshot(snapshot);
      matcher.#books.set(book.key, book);
      for (const order of snapshot.orders) {
        matcher.#orderBooks.set(order.orderHash, book.key);
        matcher.#expiryHeap.add({
          bookKey: book.key,
          expiry: order.expiry,
          orderHash: order.orderHash,
          sequence: order.sequence,
        });
      }
    }
    matcher.assertIntegrity();
    if (matcher.checkpoint().checkpointHash !== checkpoint.checkpointHash) {
      throw new CanonicalInputError("restored matcher state differs from its checkpoint");
    }
    return matcher;
  }

  #book(marketId: Hex, branch: Branch): OrderBook {
    const key = makeBookKey(marketId, branch);
    const existing = this.#books.get(key);
    if (existing) return existing;
    const book = new OrderBook(marketId, branch);
    this.#books.set(key, book);
    return book;
  }

  #validateEvent(event: MatcherChainEvent, timestamp: bigint): void {
    switch (event.type) {
      case "market-terms-configured":
        if (this.#markets.has(event.marketId) || event.tradingOpen >= event.tradingCutoff) {
          throw new CanonicalInputError("market terms are duplicate or invalid");
        }
        return;
      case "market-state-changed": {
        const current = this.#markets.get(event.marketId);
        if (!current || current.state !== event.previousState) {
          throw new CanonicalInputError("market state transition does not follow the projection");
        }
        return;
      }
      case "emergency-pause-changed":
        if (event.paused === this.#emergencyPaused) {
          throw new CanonicalInputError("emergency pause event does not change state");
        }
        return;
      case "nonce-invalidated": {
        const current = this.#makerMinimumNonces.get(event.maker) ?? 0n;
        if (current !== event.oldMinimumNonce || event.newMinimumNonce <= current) {
          throw new CanonicalInputError("nonce invalidation does not follow the projection");
        }
        return;
      }
      case "order-opened": {
        const terms = this.#markets.get(event.order.marketId);
        if (
          this.#emergencyPaused ||
          !terms ||
          terms.state !== MarketState.Open ||
          timestamp < terms.tradingOpen ||
          timestamp >= terms.tradingCutoff ||
          event.order.expiry <= timestamp ||
          event.order.nonce < (this.#makerMinimumNonces.get(event.order.maker) ?? 0n) ||
          event.order.quantity % terms.baseStep !== 0n ||
          event.order.limitPriceRawX18 % terms.priceTickRawX18 !== 0n
        ) {
          throw new CanonicalInputError("OrderOpened is not valid in the projected market state");
        }
        const expectedReserved =
          event.order.side === Side.Buy
            ? quoteForReservation(event.order.quantity, event.order.limitPriceRawX18)
            : event.order.quantity;
        const book = this.#books.get(makeBookKey(event.order.marketId, event.order.branch));
        if (
          event.reserved !== expectedReserved ||
          event.sequence !== (book?.highestSequence ?? -1n) + 1n ||
          this.#orderBooks.has(event.orderHash)
        ) {
          throw new CanonicalInputError("OrderOpened accounting, sequence, or hash is invalid");
        }
        return;
      }
      case "order-cancelled": {
        const key = this.#orderBooks.get(event.orderHash);
        if (!key) {
          if (event.reasonHash !== IOC_REMAINDER_REASON) {
            throw new CanonicalInputError("unknown non-IOC cancellation indicates a missing open");
          }
          return;
        }
        const order = this.#books.get(key)?.getOrder(event.orderHash);
        if (
          !order ||
          order.maker !== event.maker ||
          order.remaining !== event.unfilledQuantity ||
          order.reserved !== event.releasedAmount
        ) {
          throw new CanonicalInputError("OrderCancelled does not match projected order state");
        }
        return;
      }
      case "order-filled": {
        const terms = this.#markets.get(event.marketId);
        if (
          this.#emergencyPaused ||
          !terms ||
          terms.state !== MarketState.Open ||
          timestamp < terms.tradingOpen ||
          timestamp >= terms.tradingCutoff ||
          event.fillQuantity % terms.baseStep !== 0n
        ) {
          throw new CanonicalInputError("OrderFilled is not valid in the projected market state");
        }
        const book = this.#books.get(makeBookKey(event.marketId, event.branch));
        if (!book) throw new MatcherInvariantError("fill references a book with no known orders");
        const buy = book.getOrder(event.buyOrderHash);
        const sell = book.getOrder(event.sellOrderHash);
        const maker = book.getOrder(event.makerOrderHash);
        if (
          (buy &&
            (!buy.matchable ||
              buy.expiry <= timestamp ||
              buy.side !== Side.Buy ||
              event.fillQuantity > buy.remaining)) ||
          (sell &&
            (!sell.matchable ||
              sell.expiry <= timestamp ||
              sell.side !== Side.Sell ||
              event.fillQuantity > sell.remaining)) ||
          !maker ||
          !maker.matchable ||
          maker.expiry <= timestamp ||
          maker.limitPriceRawX18 !== event.executionPriceRawX18
        ) {
          throw new MatcherInvariantError("fill does not match active projected orders");
        }
        if (buy && sell) {
          const expectedMaker = buy.sequence < sell.sequence ? buy : sell;
          if (
            expectedMaker.orderHash !== event.makerOrderHash ||
            buy.limitPriceRawX18 < sell.limitPriceRawX18
          ) {
            throw new MatcherInvariantError("fill violates price or canonical maker priority");
          }
        }
        if (
          quoteForExecution(event.fillQuantity, event.executionPriceRawX18) !== event.executionQuote
        ) {
          throw new MatcherInvariantError("fill quote does not match protocol rounding");
        }
        return;
      }
    }
  }

  #invalidateMarket(marketId: Hex, invalidated: Set<Hex>): void {
    for (const branch of [Branch.Yes, Branch.No]) {
      const proposalId = this.#books
        .get(makeBookKey(marketId, branch))
        ?.invalidatePendingProposal();
      if (proposalId) invalidated.add(proposalId);
    }
  }

  #markMarketBooks(marketId: Hex, affected: Set<string>): void {
    for (const branch of [Branch.Yes, Branch.No]) {
      const key = makeBookKey(marketId, branch);
      if (this.#books.has(key)) affected.add(key);
    }
  }

  #skip(bookKey: string, reason: MatchSkipReason): MatchPreview {
    return { proposal: null, skip: { bookKey, cursor: this.#cursor, reason } };
  }
}
