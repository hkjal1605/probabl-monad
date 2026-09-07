import type { TradingSafety } from "@conditional-stocks/config";
import type { SettlementQueries } from "@conditional-stocks/db/settlement";
import {
  type CanonicalSettlementSource,
  type IocBatchPayload,
  type IocIntent,
  type MatcherFeedback,
  SETTLEMENT_SCHEMA_VERSION,
  type SettlementAttempt,
  type SettlementBatch,
  type SettlementCall,
  type SettlementChain,
  type SettlementContext,
} from "@conditional-stocks/db/settlement/types";
import {
  hashOrder,
  quoteForExecution,
  quoteForReservation,
  Side,
  TimeInForce,
} from "@conditional-stocks/domain";
import {
  hashCanonical,
  MATCHER_ENGINE_VERSION,
  MATCHER_SCHEMA_VERSION,
  type MatchProposal,
} from "@conditional-stocks/orderbook";
import type { Hex } from "viem";
import { buildSettlementCalls, type SettlementEnvironment } from "./chain.ts";
import { logger } from "./logger.ts";

const now = (): bigint => BigInt(Date.now());

export class NoopMatcherFeedback implements MatcherFeedback {
  async confirmed(_batchId: Hex): Promise<void> {}
  async failed(_batchId: Hex, _classification: string, _message: string): Promise<void> {}
}

export class HttpMatcherFeedback implements MatcherFeedback {
  constructor(
    readonly baseUrl: string,
    readonly token: string,
  ) {}

  async confirmed(batchId: Hex): Promise<void> {
    await this.#post(batchId, { status: "confirmed" });
  }

  async failed(batchId: Hex, classification: string, message: string): Promise<void> {
    await this.#post(batchId, { classification, message, status: "failed" });
  }

  async #post(batchId: Hex, body: unknown): Promise<void> {
    const response = await fetch(`${this.baseUrl}/internal/proposals/${batchId}/settlement`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`matcher feedback returned ${response.status}`);
  }
}

export interface SettlementWorkerOptions {
  environment: SettlementEnvironment;
  feedback?: MatcherFeedback;
  now?: () => bigint;
  safety?: TradingSafety;
}

export class SettlementWorker {
  readonly #chain: SettlementChain;
  readonly #environment: SettlementEnvironment;
  readonly #feedback: MatcherFeedback;
  readonly #now: () => bigint;
  readonly #source: CanonicalSettlementSource;
  readonly #store: SettlementQueries;
  readonly safety: TradingSafety | undefined;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(
    store: SettlementQueries,
    chain: SettlementChain,
    source: CanonicalSettlementSource,
    options: SettlementWorkerOptions,
  ) {
    this.#store = store;
    this.#chain = chain;
    this.#source = source;
    this.#environment = options.environment;
    this.#feedback = options.feedback ?? new NoopMatcherFeedback();
    this.#now = options.now ?? now;
    this.safety = options.safety;
  }

  async enqueueProposal(proposal: MatchProposal): Promise<SettlementBatch> {
    this.#validateProposal(proposal);
    const existing = await this.#store.getBatch(proposal.batchId);
    const batch = await this.#store.enqueue(proposal.batchId, {
      kind: "gtc",
      proposal,
      schemaVersion: SETTLEMENT_SCHEMA_VERSION,
    });
    if (!existing)
      logger.info("settlement.batch.queued", {
        batchId: batch.batchId,
        kind: "gtc",
        fills: proposal.fills.length,
        anchorBlock: proposal.cursor.blockNumber,
      });
    return batch;
  }

  async enqueueIocIntent(
    input: Omit<IocIntent, "createdAtMs" | "intentId" | "status">,
  ): Promise<IocIntent> {
    if (
      input.order.tif !== TimeInForce.Ioc ||
      input.protection.maxQuantity !== input.order.quantity ||
      input.protection.worstPriceRawX18 !== input.order.limitPriceRawX18 ||
      input.protection.maxNotional <
        quoteForReservation(input.order.quantity, input.order.limitPriceRawX18)
    ) {
      throw new Error("IOC intent protection does not match its signed limits");
    }
    const expectedHash = hashOrder(input.order, {
      chainId: BigInt(this.#environment.chainId),
      verifyingContract: this.#environment.exchange,
    });
    if (input.orderHash !== expectedHash) throw new Error("IOC order hash is invalid");
    const existing = await this.#store.getIntent(input.orderHash);
    if (existing) {
      if (
        hashCanonical({
          order: existing.order,
          orderHash: existing.orderHash,
          protection: existing.protection,
          signature: existing.signature,
        }) !== hashCanonical(input)
      ) {
        throw new Error("IOC intent id collision");
      }
      return existing;
    }
    const intent: IocIntent = {
      ...input,
      createdAtMs: this.#now(),
      intentId: input.orderHash,
      status: "waiting-match",
    };
    const saved = await this.#store.enqueueIntent(intent);
    logger.info("settlement.ioc.accepted", {
      intentId: saved.intentId,
      marketId: saved.order.marketId,
      quantity: saved.order.quantity,
      limitPriceRawX18: saved.order.limitPriceRawX18,
    });
    return saved;
  }

  async enqueueIocPlan(
    input: Omit<IocBatchPayload, "schemaVersion" | "takerOrder" | "takerSignature">,
  ): Promise<SettlementBatch> {
    const intent = await this.#store.getIntent(input.intentId);
    if (!intent) throw new Error("IOC intent is missing");
    if (input.cursor.chainId !== BigInt(this.#environment.chainId)) {
      throw new Error("IOC cursor is for another chain");
    }
    if (input.makerOrders.length === 0 || input.makerOrders.length > 32) {
      throw new Error("IOC plan must have 1-32 maker orders");
    }
    if (input.makerOrders.length !== input.fillQuantities.length) {
      throw new Error("IOC maker and fill arrays differ");
    }
    let total = 0n;
    for (let index = 0; index < input.makerOrders.length; index += 1) {
      const maker = input.makerOrders[index];
      const quantity = input.fillQuantities[index];
      if (!maker || !quantity || quantity <= 0n || maker.tif !== TimeInForce.Gtc) {
        throw new Error("IOC plan contains an invalid maker leg");
      }
      if (
        maker.marketId !== intent.order.marketId ||
        maker.branch !== intent.order.branch ||
        maker.side === intent.order.side
      ) {
        throw new Error("IOC maker is for another book");
      }
      if (
        (intent.order.side === Side.Buy &&
          maker.limitPriceRawX18 > intent.order.limitPriceRawX18) ||
        (intent.order.side === Side.Sell && maker.limitPriceRawX18 < intent.order.limitPriceRawX18)
      ) {
        throw new Error("IOC maker exceeds the signed worst price");
      }
      total += quantity;
    }
    if (total > intent.protection.maxQuantity) throw new Error("IOC plan exceeds maximum quantity");
    const payload: IocBatchPayload = {
      ...input,
      kind: "ioc",
      schemaVersion: SETTLEMENT_SCHEMA_VERSION,
      takerOrder: intent.order,
      takerSignature: intent.signature,
    };
    const batchId = hashCanonical(payload);
    const batch = await this.#store.enqueuePlannedIntent(batchId, payload, intent.intentId);
    logger.info("settlement.ioc.planned", {
      batchId,
      intentId: intent.intentId,
      fills: input.fillQuantities.length,
      quantity: total,
    });
    return batch;
  }

  async processAll(limit = 100): Promise<void> {
    await this.deliverFeedback(limit);
    for (const batch of await this.#store.listProcessable(limit)) {
      await this.process(batch.batchId);
    }
    await this.planIocIntents(limit);
    await this.deliverFeedback(limit);
  }

  async deliverFeedback(limit = 100): Promise<void> {
    for (const batch of await this.#store.listFeedbackPending(limit)) {
      try {
        if (batch.status === "confirmed") await this.#feedback.confirmed(batch.batchId);
        else {
          await this.#feedback.failed(
            batch.batchId,
            batch.error?.classification ?? "settlement-failed",
            batch.error?.message ?? "unknown settlement failure",
          );
        }
        await this.#store.markFeedbackDelivered(batch.batchId, this.#now());
        logger.debug("settlement.feedback.delivered", {
          batchId: batch.batchId,
          status: batch.status,
        });
      } catch (error) {
        logger.warn("settlement.feedback.deferred", { batchId: batch.batchId, error });
        return;
      }
    }
  }

  process(batchId: Hex): Promise<SettlementBatch> {
    const pass = this.#tail.then(async () => await this.#process(batchId));
    this.#tail = pass.catch(() => undefined);
    return pass;
  }

  async #process(batchId: Hex): Promise<SettlementBatch> {
    return this.#store.withClaim(
      batchId,
      this.#environment.ownerId,
      this.#environment.leaseTtlMs,
      (claimed) => this.#processClaimed(claimed),
    );
  }

  async #processClaimed(claimed: SettlementBatch): Promise<SettlementBatch> {
    const batchId = claimed.batchId;

    const calls = buildSettlementCalls(
      claimed.payload,
      BigInt(this.#environment.chainId),
      this.#environment.exchange,
      this.#environment.iocRouter,
    );
    if (claimed.status === "mined") return await this.#confirm(claimed, calls);
    if (claimed.status === "submitted") return await this.#reconcileSubmitted(claimed, calls);
    if (claimed.status === "quarantined") return claimed;
    if (!(await this.#mayBroadcast(claimed))) return claimed;

    const cursor =
      claimed.payload.kind === "gtc" ? claimed.payload.proposal.cursor : claimed.payload.cursor;
    const required = this.#requiredOrders(claimed);
    let context: SettlementContext;
    try {
      context = await this.#source.context(cursor, [...required.keys()]);
    } catch (error) {
      logger.debug("settlement.context.unavailable", { batchId, error });
      return claimed; // Preserve the durable batch and retry after indexer/RPC recovery.
    }
    if (!context.anchorCanonical || cursor.blockNumber > context.confirmedThrough) {
      return await this.#quarantine(
        claimed,
        "reorg-or-unsafe-anchor",
        "proposal anchor is not canonical",
      );
    }
    const canonicalOrders = new Map(context.orders.map((order) => [order.id, order]));
    for (const [orderHash, quantity] of required) {
      const order = canonicalOrders.get(orderHash);
      if (order?.status !== "open" || order.remaining < quantity) {
        return await this.#quarantine(
          claimed,
          "canonical-order-changed",
          `${orderHash} is no longer fillable for ${quantity}`,
        );
      }
    }
    if (claimed.payload.kind === "gtc") {
      for (const fill of claimed.payload.proposal.fills) {
        const buy = canonicalOrders.get(fill.buyOrderHash);
        const sell = canonicalOrders.get(fill.sellOrderHash);
        if (!buy || !sell) {
          return await this.#quarantine(
            claimed,
            "canonical-order-changed",
            "fill order is missing",
          );
        }
        const makerHash = buy.sequence < sell.sequence ? fill.buyOrderHash : fill.sellOrderHash;
        const makerPrice =
          buy.sequence < sell.sequence
            ? fill.buyOrder.limitPriceRawX18
            : fill.sellOrder.limitPriceRawX18;
        if (fill.makerOrderHash !== makerHash || fill.executionPriceRawX18 !== makerPrice) {
          return await this.#quarantine(
            claimed,
            "matcher-price-disagreement",
            "proposal maker price differs from canonical sequence priority",
          );
        }
      }
    }
    if (context.tradingPaused || context.marketStates.some((market) => market.state !== 2)) {
      return await this.#quarantine(
        claimed,
        "market-not-open",
        "market is paused, frozen, or closed",
      );
    }

    try {
      for (const call of calls) await this.#chain.simulate(call, context.confirmedThrough);
      await this.#transition(claimed.batchId, "simulated", {
        error: null,
        simulationBlock: context.confirmedThrough,
      });
    } catch (error) {
      return await this.#quarantine(
        claimed,
        "simulation-disagreement",
        error instanceof Error ? error.message : String(error),
      );
    }

    const existing = await this.#store.attempts(claimed.batchId);
    if (existing.length === 0) {
      const pendingNonce = await this.#chain.pendingNonce();
      const firstNonce = await this.#store.peekNonce(this.#chain.relayerAddress, pendingNonce);
      const prepared: SettlementAttempt[] = [];
      for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
        const call = calls[callIndex];
        if (!call) throw new Error("settlement call is missing");
        const nonce = firstNonce + BigInt(callIndex);
        const transaction = await this.#chain.prepare(call, nonce);
        prepared.push({
          ...transaction,
          attempt: 0,
          batchId: claimed.batchId,
          callIndex,
          createdAtMs: this.#now(),
          replaces: null,
          status: "prepared",
          updatedAtMs: this.#now(),
        });
      }
      await this.#store.persistPreparedBatch(this.#chain.relayerAddress, pendingNonce, prepared);
      logger.info("settlement.outbox.prepared", { batchId, firstNonce, attempts: prepared.length });
    }
    await this.#transition(claimed.batchId, "submitted");
    for (const attempt of await this.#store.attempts(claimed.batchId)) {
      if (attempt.status !== "prepared") continue;
      if (!(await this.#mayBroadcast(claimed)))
        return (await this.#store.getBatch(claimed.batchId)) ?? claimed;
      const hash = await this.#chain.broadcast(attempt.rawTransaction);
      if (hash !== attempt.transactionHash) throw new Error("RPC returned a different tx hash");
      await this.#store.updateAttempt(
        claimed.batchId,
        attempt.callIndex,
        attempt.attempt,
        "broadcast",
      );
      logger.info("settlement.transaction.broadcast", {
        batchId,
        transactionHash: hash,
        nonce: attempt.nonce,
        attempt: attempt.attempt,
        callIndex: attempt.callIndex,
      });
    }
    return (await this.#store.getBatch(claimed.batchId)) ?? claimed;
  }

  async #reconcileSubmitted(
    batch: SettlementBatch,
    calls: SettlementCall[],
  ): Promise<SettlementBatch> {
    let allMined = true;
    let highestBlock = 0n;
    for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
      const attempts = await this.#store.attempts(batch.batchId, callIndex);
      const last = attempts.at(-1);
      if (!last)
        return await this.#quarantine(batch, "outbox-corrupt", "call has no persisted attempt");
      // Any same-nonce attempt can win, including the original after a replacement
      // was persisted but its broadcast response was lost.
      let mined: {
        attempt: SettlementAttempt;
        receipt: NonNullable<Awaited<ReturnType<SettlementChain["receipt"]>>>;
      } | null = null;
      for (const attempt of [...attempts].reverse()) {
        const receipt = await this.#chain.receipt(attempt.transactionHash);
        if (receipt) {
          mined = { attempt, receipt };
          break;
        }
      }
      if (mined?.receipt.status === "reverted") {
        await this.#store.updateAttempt(
          batch.batchId,
          callIndex,
          mined.attempt.attempt,
          "reverted",
        );
        return await this.#fail(batch, "chain-revert", `settlement call ${callIndex} reverted`);
      }
      if (mined?.receipt.status === "success") {
        await this.#store.updateAttempt(batch.batchId, callIndex, mined.attempt.attempt, "mined");
        if (mined.receipt.blockNumber > highestBlock) highestBlock = mined.receipt.blockNumber;
        continue;
      }
      if (last.status === "prepared") {
        if (!(await this.#mayBroadcast(batch, true))) {
          allMined = false;
          continue;
        }
        const hash = await this.#chain.broadcast(last.rawTransaction);
        if (hash !== last.transactionHash) throw new Error("RPC returned a different tx hash");
        await this.#store.updateAttempt(batch.batchId, callIndex, last.attempt, "broadcast");
        logger.info("settlement.transaction.replayed", {
          batchId: batch.batchId,
          transactionHash: hash,
          nonce: last.nonce,
          attempt: last.attempt,
          callIndex,
        });
        allMined = false;
        continue;
      }
      allMined = false;
      if (this.#now() - last.createdAtMs < this.#environment.stuckMs) continue;
      if (!(await this.#mayBroadcast(batch, true))) continue;
      const call = calls[callIndex];
      if (!call) throw new Error("settlement call is missing");
      const bump = 10_000n + this.#environment.replacementBumpBps;
      const replacement = await this.#chain.prepare(call, last.nonce, {
        maxFeePerGas: (last.maxFeePerGas * bump + 9_999n) / 10_000n,
        maxPriorityFeePerGas: (last.maxPriorityFeePerGas * bump + 9_999n) / 10_000n,
      });
      await this.#store.addAttempt({
        ...replacement,
        attempt: last.attempt + 1,
        batchId: batch.batchId,
        callIndex,
        createdAtMs: this.#now(),
        replaces: last.transactionHash,
        status: "prepared",
        updatedAtMs: this.#now(),
      });
      if (!(await this.#mayBroadcast(batch, true))) continue;
      const hash = await this.#chain.broadcast(replacement.rawTransaction);
      if (hash !== replacement.transactionHash) throw new Error("replacement hash mismatch");
      await this.#store.updateAttempt(batch.batchId, callIndex, last.attempt + 1, "broadcast");
      logger.warn("settlement.transaction.replaced", {
        batchId: batch.batchId,
        transactionHash: hash,
        nonce: last.nonce,
        attempt: last.attempt + 1,
        callIndex,
      });
    }
    if (!allMined) return (await this.#store.getBatch(batch.batchId)) ?? batch;
    return await this.#transition(batch.batchId, "mined", { minedBlockNumber: highestBlock });
  }

  async #mayBroadcast(batch: SettlementBatch, recheckAnchor = false): Promise<boolean> {
    await this.#store.renewClaim(batch.batchId);
    const marketIds =
      batch.payload.kind === "ioc"
        ? [batch.payload.takerOrder.marketId]
        : [...new Set(batch.payload.proposal.fills.map((fill) => fill.buyOrder.marketId))];
    try {
      await this.safety?.assertCanTrade(marketIds);
      if (recheckAnchor) {
        const cursor =
          batch.payload.kind === "ioc" ? batch.payload.cursor : batch.payload.proposal.cursor;
        const context = await this.#source.context(cursor, [...this.#requiredOrders(batch).keys()]);
        if (
          !context.anchorCanonical ||
          cursor.blockNumber > context.confirmedThrough ||
          context.tradingPaused ||
          context.marketStates.some((market) => market.state !== 2)
        )
          return false;
      }
      return true;
    } catch (error) {
      logger.debug("settlement.broadcast.blocked", { batchId: batch.batchId, error });
      return false;
    } // Preserve outbox/nonce and retry. Already-broadcast transactions can still mine.
  }

  async planIocIntents(limit = 100): Promise<void> {
    if (!this.#source.iocBook) return;
    for (const intent of await this.#store.waitingIntents(limit)) {
      if (intent.order.expiry * 1000n <= this.#now()) {
        await this.#store.finishIntent(intent.intentId, "expired");
        logger.info("settlement.ioc.expired", { intentId: intent.intentId });
        continue;
      }
      try {
        await this.safety?.assertCanTrade([intent.order.marketId]);
        const book = await this.#source.iocBook(intent.order);
        // Never plan against liquidity already committed to another worker batch.
        const busy = await this.#store.hasProcessableBook(
          intent.order.marketId,
          intent.order.branch,
        );
        if (busy) continue;
        let remaining = intent.order.quantity;
        const makerOrders: (typeof intent.order)[] = [];
        const fillQuantities: bigint[] = [];
        for (const maker of book.orders) {
          if (remaining === 0n || makerOrders.length === 32) break;
          if (
            maker.order.marketId !== intent.order.marketId ||
            maker.order.branch !== intent.order.branch ||
            maker.order.side === intent.order.side ||
            maker.order.tif !== TimeInForce.Gtc
          )
            throw new Error("invalid IOC book identity");
          if (maker.order.expiry <= book.cursor.blockTimestamp) continue;
          if (
            intent.order.side === Side.Buy
              ? maker.order.limitPriceRawX18 > intent.order.limitPriceRawX18
              : maker.order.limitPriceRawX18 < intent.order.limitPriceRawX18
          )
            break;
          const quantity = remaining < maker.remaining ? remaining : maker.remaining;
          if (quantity <= 0n || quoteForExecution(quantity, maker.order.limitPriceRawX18) === 0n)
            continue;
          makerOrders.push(maker.order);
          fillQuantities.push(quantity);
          remaining -= quantity;
        }
        if (makerOrders.length === 0) {
          await this.#store.finishIntent(intent.intentId, "unfilled");
          logger.info("settlement.ioc.unfilled", {
            intentId: intent.intentId,
            marketId: intent.order.marketId,
          });
          continue;
        }
        await this.enqueueIocPlan({
          kind: "ioc",
          intentId: intent.intentId,
          cursor: book.cursor,
          makerOrders,
          fillQuantities,
        });
      } catch (error) {
        logger.debug("settlement.ioc.planning.deferred", { intentId: intent.intentId, error });
        /* Preserve waiting intent during transient safety/indexer failures. */
      }
    }
  }

  async #confirm(batch: SettlementBatch, calls: SettlementCall[]): Promise<SettlementBatch> {
    const attempts = (await this.#store.attempts(batch.batchId)).filter(
      (attempt) => attempt.status === "mined",
    );
    const expected = calls.flatMap((call) => call.expectedFills);
    if (
      !(await this.#source.fillsConfirmed(
        expected,
        attempts.map((attempt) => attempt.transactionHash),
      ))
    ) {
      // A pre-confirmation reorg can remove a receipt. Return to monitoring the
      // same nonce/outbox; anchor checks must pass before any rebroadcast.
      for (const attempt of attempts) {
        if (!(await this.#chain.receipt(attempt.transactionHash))) {
          await this.#store.updateAttempt(
            batch.batchId,
            attempt.callIndex,
            attempt.attempt,
            "broadcast",
          );
          return await this.#transition(batch.batchId, "submitted", { minedBlockNumber: null });
        }
      }
      return batch;
    }
    const confirmed = await this.#transition(batch.batchId, "confirmed");
    await this.deliverFeedback();
    return confirmed;
  }

  #requiredOrders(batch: SettlementBatch): Map<Hex, bigint> {
    const required = new Map<Hex, bigint>();
    if (batch.payload.kind === "gtc") {
      for (const fill of batch.payload.proposal.fills) {
        required.set(
          fill.buyOrderHash,
          (required.get(fill.buyOrderHash) ?? 0n) + fill.fillQuantity,
        );
        required.set(
          fill.sellOrderHash,
          (required.get(fill.sellOrderHash) ?? 0n) + fill.fillQuantity,
        );
      }
      return required;
    }
    for (let index = 0; index < batch.payload.makerOrders.length; index += 1) {
      const order = batch.payload.makerOrders[index];
      const quantity = batch.payload.fillQuantities[index];
      if (!order || quantity === undefined) throw new Error("IOC plan arrays differ");
      const orderHash = hashOrder(order, {
        chainId: BigInt(this.#environment.chainId),
        verifyingContract: this.#environment.exchange,
      });
      required.set(orderHash, (required.get(orderHash) ?? 0n) + quantity);
    }
    return required;
  }

  #validateProposal(proposal: MatchProposal): void {
    if (
      proposal.schemaVersion !== MATCHER_SCHEMA_VERSION ||
      proposal.engineVersion !== MATCHER_ENGINE_VERSION ||
      proposal.fills.length === 0 ||
      proposal.fills.length > 32
    ) {
      throw new Error("unsupported matcher proposal");
    }
    if (proposal.cursor.chainId !== BigInt(this.#environment.chainId)) {
      throw new Error("matcher proposal is for another chain");
    }
    const { batchId: _batchId, proposalId: _proposalId, ...unsigned } = proposal;
    const proposalId = hashCanonical(unsigned);
    if (proposal.proposalId !== proposalId || proposal.batchId !== proposalId) {
      throw new Error("matcher proposal hash is invalid");
    }
    if (proposal.decisions.length !== proposal.fills.length) {
      throw new Error("matcher decisions and fills differ");
    }
    for (let index = 0; index < proposal.fills.length; index += 1) {
      const fill = proposal.fills[index];
      const decision = proposal.decisions[index];
      if (!fill || !decision) throw new Error("matcher fill is missing");
      const buyHash = hashOrder(fill.buyOrder, {
        chainId: BigInt(this.#environment.chainId),
        verifyingContract: this.#environment.exchange,
      });
      const sellHash = hashOrder(fill.sellOrder, {
        chainId: BigInt(this.#environment.chainId),
        verifyingContract: this.#environment.exchange,
      });
      if (
        buyHash !== fill.buyOrderHash ||
        sellHash !== fill.sellOrderHash ||
        fill.buyOrder.side !== Side.Buy ||
        fill.sellOrder.side !== Side.Sell ||
        fill.buyOrder.tif !== TimeInForce.Gtc ||
        fill.sellOrder.tif !== TimeInForce.Gtc ||
        fill.buyOrder.marketId !== fill.sellOrder.marketId ||
        fill.buyOrder.branch !== fill.sellOrder.branch ||
        fill.buyOrder.limitPriceRawX18 < fill.sellOrder.limitPriceRawX18 ||
        fill.fillQuantity <= 0n ||
        quoteForExecution(fill.fillQuantity, fill.executionPriceRawX18) === 0n ||
        decision.buyOrderHash !== fill.buyOrderHash ||
        decision.sellOrderHash !== fill.sellOrderHash ||
        decision.fillQuantity !== fill.fillQuantity ||
        decision.executionPriceRawX18 !== fill.executionPriceRawX18 ||
        decision.makerOrderHash !== fill.makerOrderHash
      ) {
        throw new Error("matcher proposal contains an invalid fill");
      }
    }
  }

  async #quarantine(
    batch: SettlementBatch,
    classification: string,
    message: string,
  ): Promise<SettlementBatch> {
    const result = await this.#transition(batch.batchId, "quarantined", {
      error: { classification, message },
    });
    return result;
  }

  async #fail(
    batch: SettlementBatch,
    classification: string,
    message: string,
  ): Promise<SettlementBatch> {
    const result = await this.#transition(batch.batchId, "failed", {
      error: { classification, message },
    });
    return result;
  }

  async #transition(
    ...args: Parameters<SettlementQueries["transition"]>
  ): Promise<SettlementBatch> {
    const previous = await this.#store.getBatch(args[0]);
    const batch = await this.#store.transition(...args);
    if (previous?.status !== batch.status) {
      const fields = {
        batchId: batch.batchId,
        previousStatus: previous?.status,
        status: batch.status,
        minedBlockNumber: batch.minedBlockNumber,
        simulationBlock: batch.simulationBlock,
        classification: batch.error?.classification,
      };
      if (batch.status === "failed" || batch.status === "quarantined")
        logger.error("settlement.batch.transition", fields);
      else logger.info("settlement.batch.transition", fields);
    }
    return batch;
  }
}
