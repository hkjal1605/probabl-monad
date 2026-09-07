import { randomBytes } from "node:crypto";
import type { TradingSafety } from "@conditional-stocks/config";
import {
  type GatewayQueries,
  type OperationKind,
  OperationLeaseUnavailable,
  type OperationRecord,
} from "@conditional-stocks/db/gateway";
import { hashOrder, type Order, TimeInForce } from "@conditional-stocks/domain";
import {
  GatewayError,
  GatewayErrorCode,
  parseOrder,
  preparedOrder,
  validateOrder,
} from "@conditional-stocks/gateway";
import { canonicalStringify } from "@conditional-stocks/orderbook";
import { type Address, getAddress, type Hex, isAddress, isHex, keccak256, toBytes } from "viem";
import type { CanonicalOrder, IndexerClient, ViemGatewayChain } from "./chain.ts";
import type { ApiEnvironment } from "./environment.ts";
import { logger } from "./logger.ts";

const CHALLENGE_TTL_MS = 5n * 60n * 1_000n;
const SESSION_TTL_MS = 24n * 60n * 60n * 1_000n;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

const now = (): bigint => BigInt(Date.now());
const randomToken = (): string => randomBytes(32).toString("base64url");
const digest = (value: unknown): Hex => keccak256(toBytes(canonicalStringify(value)));

const object = (value: unknown, name = "body"): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayError(GatewayErrorCode.InvalidRequest, `${name} must be an object`);
  }
  return value as Record<string, unknown>;
};

// PostgreSQL restores canonical bigint values; the public wire parser deliberately
// accepts decimal strings only. Revalidate persisted orders without rounding them.
const storedOrder = (value: unknown): Order =>
  parseOrder(
    Object.fromEntries(
      Object.entries(object(value, "persisted order")).map(([key, item]) => [
        key,
        typeof item === "bigint" ? item.toString() : item,
      ]),
    ),
  );

const hex = (value: unknown, name: string, bytes?: number): Hex => {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    (bytes !== undefined && value.length !== bytes * 2 + 2)
  ) {
    throw new GatewayError(GatewayErrorCode.InvalidRequest, `${name} is invalid hex`);
  }
  return value.toLowerCase() as Hex;
};

export interface SettlementIntentSink {
  status?(intentId: Hex): Promise<{ state: string; batchId: Hex | null; error: unknown }>;
  enqueueIoc(input: {
    order: Order;
    orderHash: Hex;
    protection: { maxNotional: bigint; maxQuantity: bigint; worstPriceRawX18: bigint };
    signature: Hex;
  }): Promise<{ batchId: Hex; state: string }>;
}

export class HttpSettlementIntentSink implements SettlementIntentSink {
  constructor(
    readonly baseUrl: string,
    readonly token: string,
  ) {}

  async status(intentId: Hex) {
    const response = await fetch(`${this.baseUrl}/internal/ioc-intents/${intentId}`, {
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok)
      throw new GatewayError(GatewayErrorCode.RpcUnavailable, "IOC status unavailable", 503);
    return response.json() as Promise<{ state: string; batchId: Hex | null; error: unknown }>;
  }

  async enqueueIoc(input: Parameters<SettlementIntentSink["enqueueIoc"]>[0]) {
    const response = await fetch(`${this.baseUrl}/internal/ioc-intents`, {
      body: canonicalStringify(input),
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/vnd.conditional-stocks.canonical+json",
      },
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json()) as { batchId?: Hex; error?: string; state?: string };
    if (!response.ok || !body.batchId || !body.state) {
      throw new GatewayError(
        GatewayErrorCode.RpcUnavailable,
        body.error ?? `settlement worker returned ${response.status}`,
        503,
      );
    }
    return { batchId: body.batchId, state: body.state };
  }
}

export class GatewayService {
  #submissionTail: Promise<unknown> = Promise.resolve();
  #recoveryTail: Promise<void> = Promise.resolve();
  #recoveryCursor = 0n;
  constructor(
    readonly environment: ApiEnvironment,
    readonly store: GatewayQueries,
    readonly chain: ViemGatewayChain,
    readonly indexer: IndexerClient,
    readonly settlement: SettlementIntentSink,
    readonly safety?: TradingSafety,
  ) {}

  async createChallenge(input: unknown) {
    const body = object(input);
    if (typeof body.address !== "string" || !isAddress(body.address)) {
      throw new GatewayError(GatewayErrorCode.InvalidRequest, "address is invalid");
    }
    const address = getAddress(body.address);
    const issuedAt = new Date().toISOString();
    const expiresAtMs = now() + CHALLENGE_TTL_MS;
    const expirationTime = new Date(Number(expiresAtMs)).toISOString();
    const nonce = randomToken().slice(0, 16);
    const message =
      `${this.environment.authDomain} wants you to sign in with your Ethereum account:\n` +
      `${address}\n\nSign in to Conditional Stocks. This does not authorize a transaction.\n\n` +
      `URI: ${this.environment.authOrigin}\nVersion: 1\nChain ID: ${this.environment.chainId}\n` +
      `Nonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
    const challengeId = crypto.randomUUID();
    await this.store.saveChallenge(challengeId, address, message, expiresAtMs);
    return { address, challengeId, expiresAtMs, message };
  }

  async verifyChallenge(input: unknown) {
    const body = object(input);
    if (typeof body.address !== "string" || !isAddress(body.address)) {
      throw new GatewayError(GatewayErrorCode.InvalidRequest, "address is invalid");
    }
    if (typeof body.challengeId !== "string") {
      throw new GatewayError(GatewayErrorCode.InvalidRequest, "challengeId is required");
    }
    const signature = hex(body.signature, "signature");
    const address = getAddress(body.address);
    const message = await this.store.consumeChallenge(body.challengeId, address);
    if (!message || !(await this.chain.verifyAuthMessage(address, message, signature))) {
      throw new GatewayError(
        GatewayErrorCode.SignatureInvalid,
        "challenge signature is invalid",
        401,
      );
    }
    const token = randomToken();
    const expiresAtMs = now() + SESSION_TTL_MS;
    await this.store.saveSession(digest(token), address, expiresAtMs);
    return { address, expiresAtMs, token, tokenType: "Bearer" };
  }

  async authenticate(authorization: string | undefined): Promise<Address> {
    const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
    const address = token ? await this.store.sessionAddress(digest(token)) : null;
    if (!address) {
      throw new GatewayError(
        GatewayErrorCode.NotAuthenticated,
        "valid bearer session required",
        401,
      );
    }
    return getAddress(address);
  }

  async prepareOrder(input: unknown, session: Address) {
    const body = object(input);
    const order = parseOrder(body.order);
    this.#requireAccount(session, order.maker);
    this.#requireTester(session);
    await this.safety?.assertCanTrade([order.marketId]);
    const snapshot = await this.chain.snapshot(order, this.indexer);
    const funding = await this.chain.funding(order, snapshot.market, snapshot.safeBlockNumber);
    const preparation = preparedOrder(order, snapshot, this.environment.exchange, funding);
    return {
      ...preparation,
      fundingReady: preparation.funding.approved && preparation.funding.balanceSufficient,
      userPaidTransactionTemplate: {
        args: [order, "<order-signature>"],
        functionName: "openOrder",
        to: this.environment.exchange,
        value: 0n,
      },
    };
  }

  submitOrder(input: unknown, session: Address, idempotencyKey: string | undefined) {
    // Local ordering reduces nonce contention; PostgreSQL leases fence cross-process work.
    const result = this.#submissionTail.then(
      async () => await this.#submitOrder(input, session, idempotencyKey),
    );
    this.#submissionTail = result.catch(() => undefined);
    return result;
  }

  async #submitOrder(
    input: unknown,
    session: Address,
    idempotencyKey: string | undefined,
  ): Promise<{
    attempts: Awaited<ReturnType<GatewayQueries["listAttempts"]>>;
    operation: OperationRecord;
  }> {
    const key = this.#idempotencyKey(idempotencyKey);
    const body = object(input);
    const order = parseOrder(body.order);
    this.#requireAccount(session, order.maker);
    this.#requireTester(session);
    await this.safety?.assertCanTrade([order.marketId]);
    const signature = hex(body.signature, "signature");
    const orderHash = hashOrder(order, {
      chainId: BigInt(this.environment.chainId),
      verifyingContract: this.environment.exchange,
    });
    const requestDigest = digest({
      order,
      protection: body.protection ?? null,
      signature,
      signedTransaction: body.signedTransaction ?? null,
    });
    const begun = await this.store.beginOperation({
      address: session,
      canonicalState: null,
      error: null,
      finalReceipt: null,
      idempotencyKey: key,
      kind: "order",
      operationId: crypto.randomUUID(),
      orderHash,
      payload: { order, protection: body.protection ?? null, signature },
      requestDigest,
      state: "accepted",
      transactionHash: null,
    });
    if (begun.created)
      logger.info("api.order.accepted", {
        operationId: begun.operation.operationId,
        orderHash,
        marketId: order.marketId,
        quantity: order.quantity,
        limitPriceRawX18: order.limitPriceRawX18,
        timeInForce: order.tif,
      });
    if (!begun.created) {
      if (begun.operation.requestDigest !== requestDigest) {
        throw new GatewayError(
          GatewayErrorCode.Conflict,
          "idempotency key was used for another request",
          409,
        );
      }
    }
    return this.#runOperation(begun.operation.operationId, async () => {
      const current = await this.store.getOperation(begun.operation.operationId);
      if (!current) throw new Error("operation disappeared");
      if (!["accepted", "retryable"].includes(current.state) || current.transactionHash) {
        return this.#refreshOrderOperation(current);
      }
      if (current.state === "retryable")
        await this.#updateOperation(current.operationId, {
          error: null,
          state: "accepted",
        });

      try {
        const snapshot = await this.chain.snapshot(order, this.indexer);
        const notional = validateOrder(order, snapshot);
        const funding = await this.chain.funding(order, snapshot.market, snapshot.safeBlockNumber);
        const preparation = preparedOrder(order, snapshot, this.environment.exchange, funding);
        if (preparation.orderHash !== orderHash) {
          throw new GatewayError(GatewayErrorCode.OrderInvalid, "order digest mismatch");
        }
        if (!preparation.funding.balanceSufficient) {
          throw new GatewayError(
            GatewayErrorCode.BalanceInsufficient,
            "funding balance is insufficient",
          );
        }
        if (!preparation.funding.approved) {
          throw new GatewayError(
            GatewayErrorCode.ApprovalMissing,
            "exchange funding approval is missing",
          );
        }
        if (!(await this.chain.verifyOrderSignature(order, signature, snapshot.safeBlockNumber))) {
          throw new GatewayError(GatewayErrorCode.SignatureInvalid, "order signature is invalid");
        }
        if (order.tif === TimeInForce.Ioc) {
          const protection = this.#parseProtection(body.protection, order, notional);
          await this.store.renewOperation(begun.operation.operationId);
          const queued = await this.settlement.enqueueIoc({
            order,
            orderHash,
            protection,
            signature,
          });
          const operation = await this.#updateOperation(begun.operation.operationId, {
            canonicalState: { batchId: queued.batchId },
            state: "submitted",
          });
          return { attempts: [], operation };
        }
        try {
          await this.chain.simulateOpen(order, signature, snapshot.safeBlockNumber);
          await this.chain.simulateOpen(order, signature);
        } catch (error) {
          throw new GatewayError(
            GatewayErrorCode.SimulationFailed,
            error instanceof Error ? error.message : String(error),
            409,
          );
        }
        const existingAttempt = await (
          await this.store.listAttempts(begun.operation.operationId)
        ).at(-1);
        if (existingAttempt?.rawTransaction) {
          await this.safety?.assertCanTrade([order.marketId]);
          await this.store.renewOperation(begun.operation.operationId);
          const hash = await this.chain.broadcast(existingAttempt.rawTransaction).catch((error) => {
            throw new GatewayError(
              GatewayErrorCode.RpcUnavailable,
              error instanceof Error ? error.message : String(error),
              503,
            );
          });
          if (hash !== existingAttempt.transactionHash)
            throw new Error("RPC returned wrong tx hash");
          const operation = await this.#updateOperation(begun.operation.operationId, {
            state: "broadcast",
          });
          return { attempts: await this.store.listAttempts(operation.operationId), operation };
        }
        if (body.signedTransaction !== undefined) {
          const rawTransaction = hex(body.signedTransaction, "signedTransaction");
          const validated = await this.chain.validateRawTransaction(rawTransaction, {
            data: this.chain.openOrderCalldata(order, signature),
            from: session,
            to: this.environment.exchange,
          });
          await this.store.persistPreparedAttempt({
            attempt: 0,
            createdAtMs: now(),
            nonce: validated.nonce,
            operationId: begun.operation.operationId,
            rawTransaction,
            replaces: null,
            transactionHash: validated.transactionHash,
          });
          await this.safety?.assertCanTrade([order.marketId]);
          await this.store.renewOperation(begun.operation.operationId);
          const hash = await this.chain.broadcast(rawTransaction).catch((error) => {
            throw new GatewayError(
              GatewayErrorCode.RpcUnavailable,
              error instanceof Error ? error.message : String(error),
              503,
            );
          });
          if (hash !== validated.transactionHash) throw new Error("RPC returned wrong tx hash");
          const operation = await this.#updateOperation(begun.operation.operationId, {
            state: "broadcast",
          });
          return { attempts: await this.store.listAttempts(operation.operationId), operation };
        }
        const relayer = this.chain.relayerAddress;
        if (!relayer) {
          throw new GatewayError(
            GatewayErrorCode.RpcUnavailable,
            "relayer unavailable; submit a user-signed openOrder transaction",
            503,
            { data: this.chain.openOrderCalldata(order, signature), to: this.environment.exchange },
          );
        }
        const pendingNonce = await this.chain.pendingNonce(relayer);
        const nonce = await this.store.peekNonce(relayer, pendingNonce);
        const transaction = await this.chain.prepareRelayedOpen(order, signature, nonce);
        await this.store.persistPreparedAttempt(
          {
            attempt: 0,
            createdAtMs: now(),
            nonce,
            operationId: begun.operation.operationId,
            rawTransaction: transaction.rawTransaction,
            replaces: null,
            transactionHash: transaction.transactionHash,
          },
          { address: relayer, pendingNonce },
        );
        await this.safety?.assertCanTrade([order.marketId]);
        await this.store.renewOperation(begun.operation.operationId);
        const broadcastHash = await this.chain
          .broadcast(transaction.rawTransaction)
          .catch((error) => {
            throw new GatewayError(
              GatewayErrorCode.RpcUnavailable,
              error instanceof Error ? error.message : String(error),
              503,
            );
          });
        if (broadcastHash !== transaction.transactionHash)
          throw new Error("RPC returned wrong tx hash");
        const operation = await this.#updateOperation(begun.operation.operationId, {
          state: "broadcast",
        });
        return { attempts: await this.store.listAttempts(operation.operationId), operation };
      } catch (error) {
        const gatewayError =
          error instanceof GatewayError
            ? error
            : new GatewayError(
                GatewayErrorCode.RpcUnavailable,
                "Transaction processing temporarily unavailable; retry the same idempotency key",
                503,
              );
        await this.#updateOperation(begun.operation.operationId, {
          error: { code: gatewayError.code, message: gatewayError.message },
          state: gatewayError.status >= 500 ? "retryable" : "failed",
        });
        throw gatewayError;
      }
    });
  }

  async prepareCancellation(input: unknown, session: Address) {
    const body = object(input);
    const orderHash = hex(body.orderHash, "orderHash", 32);
    const canonical = await this.#openOrderForMaker(orderHash, session);
    return {
      canonical,
      transaction: {
        chainId: this.environment.chainId,
        data: this.chain.cancelOrderCalldata(orderHash),
        from: session,
        to: this.environment.exchange,
        value: 0n,
      },
    };
  }

  async submitCancellation(input: unknown, session: Address, idempotencyKey: string | undefined) {
    const key = this.#idempotencyKey(idempotencyKey);
    const body = object(input);
    const orderHash = hex(body.orderHash, "orderHash", 32);
    const rawTransaction = hex(body.signedTransaction, "signedTransaction");
    await this.#openOrderForMaker(orderHash, session);
    return await this.#submitUserTransaction({
      data: this.chain.cancelOrderCalldata(orderHash),
      idempotencyKey: key,
      kind: "cancel",
      orderHash,
      rawTransaction,
      session,
      to: this.environment.exchange,
    });
  }

  async canonicalOrder(orderHashInput: string, session: Address) {
    const orderHash = hex(orderHashInput, "orderHash", 32);
    const order = await this.indexer.order(orderHash);
    if (!order) throw new GatewayError(GatewayErrorCode.NotFound, "order not found", 404);
    this.#requireAccount(session, getAddress(order.maker));
    const stored = await this.#findOrderOperation(session, orderHash);
    const application = stored ? await this.#refreshOperation(stored) : null;
    return { application, canonical: order };
  }

  async operation(operationId: string, session: Address) {
    const operation = await this.store.getOperation(operationId);
    if (!operation) throw new GatewayError(GatewayErrorCode.NotFound, "operation not found", 404);
    this.#requireAccount(session, operation.address);
    return {
      attempts: await this.store.listAttempts(operationId),
      operation: await this.#refreshOperation(operation),
    };
  }

  async preparePositionAction(kind: "merge" | "redeem", input: unknown, session: Address) {
    const action = await this.#positionAction(kind, input);
    const approved = await this.chain.positionRouterApproved(session);
    return {
      approval: approved
        ? null
        : {
            data: this.chain.positionApprovalCalldata(),
            operator: this.environment.positionRouter,
            to: this.environment.conditionalTokens,
            value: 0n,
          },
      approved,
      preview: action.preview,
      transaction: {
        chainId: this.environment.chainId,
        data: action.data,
        from: session,
        to: this.environment.positionRouter,
        value: 0n,
      },
    };
  }

  async submitPositionAction(
    kind: "merge" | "redeem",
    input: unknown,
    session: Address,
    idempotencyKey: string | undefined,
  ) {
    const key = this.#idempotencyKey(idempotencyKey);
    const body = object(input);
    const action = await this.#positionAction(kind, body);
    if (!(await this.chain.positionRouterApproved(session))) {
      throw new GatewayError(
        GatewayErrorCode.ApprovalMissing,
        "position router approval is missing",
      );
    }
    await this.chain.simulateUserCall(session, this.environment.positionRouter, action.data);
    return await this.#submitUserTransaction({
      data: action.data,
      idempotencyKey: key,
      kind,
      orderHash: null,
      rawTransaction: hex(body.signedTransaction, "signedTransaction"),
      session,
      to: this.environment.positionRouter,
    });
  }

  async #submitUserTransaction(input: {
    data: Hex;
    idempotencyKey: string;
    kind: OperationKind;
    orderHash: Hex | null;
    rawTransaction: Hex;
    session: Address;
    to: Address;
  }) {
    const requestDigest = digest({
      data: input.data,
      rawTransaction: input.rawTransaction,
      to: input.to,
    });
    const begun = await this.store.beginOperation({
      address: input.session,
      canonicalState: null,
      error: null,
      finalReceipt: null,
      idempotencyKey: input.idempotencyKey,
      kind: input.kind,
      operationId: crypto.randomUUID(),
      orderHash: input.orderHash,
      payload: { data: input.data, to: input.to },
      requestDigest,
      state: "accepted",
      transactionHash: null,
    });
    if (!begun.created) {
      if (begun.operation.requestDigest !== requestDigest) {
        throw new GatewayError(
          GatewayErrorCode.Conflict,
          "idempotency key was used for another request",
          409,
        );
      }
    }
    return this.#runOperation(begun.operation.operationId, async () => {
      const current = await this.store.getOperation(begun.operation.operationId);
      if (!current) throw new Error("operation disappeared");
      if (!["accepted", "retryable"].includes(current.state) || current.transactionHash)
        return {
          attempts: await this.store.listAttempts(current.operationId),
          operation: await this.#refreshOperation(current),
        };
      try {
        const validated = await this.chain.validateRawTransaction(input.rawTransaction, {
          data: input.data,
          from: input.session,
          to: input.to,
        });
        await this.store.persistPreparedAttempt({
          attempt: 0,
          createdAtMs: now(),
          nonce: validated.nonce,
          operationId: begun.operation.operationId,
          rawTransaction: input.rawTransaction,
          replaces: null,
          transactionHash: validated.transactionHash,
        });
        logger.info("api.outbox.prepared", {
          operationId: begun.operation.operationId,
          kind: input.kind,
          transactionHash: validated.transactionHash,
        });
        await this.store.renewOperation(begun.operation.operationId);
        const transactionHash = await this.chain.broadcast(input.rawTransaction);
        if (transactionHash !== validated.transactionHash)
          throw new Error("RPC returned wrong tx hash");
        const operation = await this.#updateOperation(begun.operation.operationId, {
          state: "broadcast",
        });
        return { attempts: await this.store.listAttempts(operation.operationId), operation };
      } catch (error) {
        const gatewayError =
          error instanceof GatewayError
            ? error
            : new GatewayError(
                GatewayErrorCode.RpcUnavailable,
                "Transaction processing temporarily unavailable; retry the same idempotency key",
                503,
              );
        await this.#updateOperation(begun.operation.operationId, {
          error: { code: gatewayError.code, message: gatewayError.message },
          state: gatewayError.status >= 500 ? "retryable" : "failed",
        });
        throw gatewayError;
      }
    });
  }

  async #positionAction(kind: "merge" | "redeem", input: unknown) {
    const body = object(input);
    const marketId = hex(body.marketId, "marketId", 32);
    const market = await this.indexer.market(marketId);
    if (!market) throw new GatewayError(GatewayErrorCode.NotFound, "market not found", 404);
    const collateral = body.collateral;
    if (collateral !== "base" && collateral !== "quote") {
      throw new GatewayError(GatewayErrorCode.InvalidRequest, "collateral must be base or quote");
    }
    const collateralToken = getAddress(
      collateral === "base" ? market.baseToken : market.quoteToken,
    );
    if (typeof body.recipient !== "string" || !isAddress(body.recipient)) {
      throw new GatewayError(GatewayErrorCode.InvalidRequest, "recipient is invalid");
    }
    const recipient = getAddress(body.recipient);
    const decimal = (value: unknown, name: string): bigint => {
      if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
        throw new GatewayError(GatewayErrorCode.InvalidRequest, `${name} must be positive`);
      }
      return BigInt(value);
    };
    if (kind === "merge") {
      const amount = decimal(body.amount, "amount");
      return {
        data: this.chain.mergeCalldata(collateralToken, market.conditionId, amount, recipient),
        preview: { collateralReturned: amount, collateralToken, recipient },
      };
    }
    if (market.state < 6) {
      throw new GatewayError(GatewayErrorCode.OrderInvalid, "market is not redeemable", 409);
    }
    if (!Array.isArray(body.indexSets) || !Array.isArray(body.amounts)) {
      throw new GatewayError(GatewayErrorCode.InvalidRequest, "indexSets and amounts are required");
    }
    const indexSets = body.indexSets.map((value, index) => decimal(value, `indexSets[${index}]`));
    const amounts = body.amounts.map((value, index) => decimal(value, `amounts[${index}]`));
    if (
      indexSets.length === 0 ||
      indexSets.length > 2 ||
      indexSets.length !== amounts.length ||
      new Set(indexSets).size !== indexSets.length ||
      indexSets.some((value) => value !== 1n && value !== 2n)
    ) {
      throw new GatewayError(GatewayErrorCode.InvalidRequest, "invalid redemption position set");
    }
    const resolution = await this.indexer.resolution(marketId);
    if (!resolution) {
      throw new GatewayError(
        GatewayErrorCode.CanonicalStateUnavailable,
        "resolution not indexed",
        503,
      );
    }
    const denominator = BigInt(resolution.payoutDenominator);
    const payout = indexSets.reduce(
      (total, indexSet, index) =>
        total +
        ((amounts[index] ?? 0n) *
          (indexSet === 1n ? BigInt(resolution.yesPayout) : BigInt(resolution.noPayout))) /
          denominator,
      0n,
    );
    return {
      data: this.chain.redeemCalldata(
        collateralToken,
        market.conditionId,
        indexSets,
        amounts,
        recipient,
      ),
      preview: { collateralToken, payout, recipient },
    };
  }

  async #refreshOrderOperation(operation: OperationRecord) {
    if (!operation.orderHash)
      return { attempts: await this.store.listAttempts(operation.operationId), operation };
    const orderHash = operation.orderHash;
    operation = await this.#refreshOperation(operation);
    const canonical = await this.indexer.order(orderHash);
    if (canonical) {
      operation = await this.#updateOperation(operation.operationId, {
        canonicalState: canonical,
        state: canonical.confirmation === "observed" ? "broadcast" : "canonical",
      });
    } else if (operation.state === "prepared") {
      const [attempt] = await this.store.listAttempts(operation.operationId);
      if (attempt?.rawTransaction) {
        await this.#guardOrderReplay(operation);
        await this.store.renewOperation(operation.operationId);
        await this.chain.broadcast(attempt.rawTransaction).catch(() => undefined);
        operation = await this.#updateOperation(operation.operationId, { state: "broadcast" });
      }
    }
    return { attempts: await this.store.listAttempts(operation.operationId), operation };
  }

  async #refreshOperation(operation: OperationRecord): Promise<OperationRecord> {
    const result = await this.#runOperation(operation.operationId, async () => {
      const current = await this.store.getOperation(operation.operationId);
      if (!current) throw new Error("operation disappeared");
      return { operation: await this.#refreshOwnedOperation(current), attempts: [] };
    });
    return result.operation;
  }

  async #refreshOwnedOperation(operation: OperationRecord): Promise<OperationRecord> {
    if (operation.kind === "order" && operation.orderHash && this.settlement.status) {
      const order = storedOrder(object(operation.payload).order);
      if (
        order.tif === TimeInForce.Ioc &&
        operation.state !== "accepted" &&
        operation.state !== "retryable"
      ) {
        const status = await this.settlement.status(operation.orderHash);
        return await this.#updateOperation(operation.operationId, {
          canonicalState: status,
          state:
            status.state === "confirmed"
              ? "canonical"
              : ["failed", "quarantined", "expired", "unfilled"].includes(status.state)
                ? "failed"
                : "submitted",
          error: ["expired", "unfilled"].includes(status.state)
            ? { code: "ioc-unfilled", message: `IOC ${status.state}; no collateral was taken` }
            : operation.error,
        });
      }
    }
    if (!operation.transactionHash) return operation;
    const receipt = await this.indexer.transaction(operation.transactionHash);
    if (receipt) {
      return await this.#updateOperation(operation.operationId, {
        finalReceipt: receipt,
        state:
          receipt.confirmation === "observed"
            ? "broadcast"
            : receipt.status === "success"
              ? "canonical"
              : "failed",
      });
    }
    const rpcReceipt = await this.chain.receipt(operation.transactionHash);
    if (rpcReceipt?.status === "reverted") {
      return await this.#updateOperation(operation.operationId, {
        error: {
          code: GatewayErrorCode.TransactionReverted,
          message: "RPC transaction receipt reports revert",
        },
        finalReceipt: rpcReceipt,
        state: "failed",
      });
    }
    if (rpcReceipt) {
      operation = await this.#updateOperation(operation.operationId, { finalReceipt: rpcReceipt });
    }
    if (!rpcReceipt && ["prepared", "retryable", "broadcast"].includes(operation.state)) {
      const attempt = await (await this.store.listAttempts(operation.operationId)).at(-1);
      if (attempt?.rawTransaction) {
        await this.#guardOrderReplay(operation);
        await this.store.renewOperation(operation.operationId);
        await this.chain.broadcast(attempt.rawTransaction).catch(() => undefined);
        return await this.#updateOperation(operation.operationId, { state: "broadcast" });
      }
    }
    return operation;
  }

  async reconcilePending(): Promise<void> {
    // Rotate bounded keyset pages so old unprepared requests cannot starve later outboxes.
    // Persisted per-operation ownership allows recovery independently of live intake;
    // recovery only rebroadcasts existing signed bytes and never allocates a new nonce.
    const pass = this.#recoveryTail.then(async () => {
      const page = await this.store.pendingOperationsPage(this.#recoveryCursor, 25);
      this.#recoveryCursor = page.nextSequence;
      for (const operation of page.operations) {
        if (!operation.transactionHash && operation.state !== "submitted") continue;
        try {
          await this.#refreshOperation(operation);
        } catch (error) {
          logger.debug("api.outbox.recovery.deferred", {
            operationId: operation.operationId,
            orderHash: operation.orderHash,
            error,
          });
          /* Keep the durable operation for the next pass during an outage. */
        }
      }
    });
    this.#recoveryTail = pass.catch(() => undefined);
    await pass;
  }

  async #runOperation(
    id: string,
    work: () => Promise<{
      operation: OperationRecord;
      attempts: Awaited<ReturnType<GatewayQueries["listAttempts"]>>;
    }>,
  ) {
    try {
      return await this.store.withOperation(id, work);
    } catch (error) {
      if (!(error instanceof OperationLeaseUnavailable)) throw error;
      const operation = await this.store.getOperation(id);
      if (!operation) throw new Error("operation disappeared");
      return { operation, attempts: await this.store.listAttempts(id) };
    }
  }

  async #openOrderForMaker(orderHash: Hex, maker: Address): Promise<CanonicalOrder> {
    const canonical = await this.indexer.order(orderHash);
    if (!canonical) throw new GatewayError(GatewayErrorCode.NotFound, "order not found", 404);
    this.#requireAccount(maker, getAddress(canonical.maker));
    if (canonical.status !== "open") {
      throw new GatewayError(GatewayErrorCode.OrderInvalid, `order is ${canonical.status}`, 409);
    }
    return canonical;
  }

  async #updateOperation(
    ...args: Parameters<GatewayQueries["updateOperation"]>
  ): Promise<OperationRecord> {
    const previous = await this.store.getOperation(args[0]);
    const operation = await this.store.updateOperation(...args);
    if (
      previous?.state !== operation.state ||
      previous?.transactionHash !== operation.transactionHash
    ) {
      const fields = {
        operationId: operation.operationId,
        kind: operation.kind,
        previousState: previous?.state,
        state: operation.state,
        orderHash: operation.orderHash,
        transactionHash: operation.transactionHash,
        errorCode: operation.error?.code,
      };
      if (operation.state === "failed" || operation.state === "retryable")
        logger.warn("api.operation.transition", fields);
      else logger.info("api.operation.transition", fields);
    }
    return operation;
  }

  async #guardOrderReplay(operation: OperationRecord): Promise<void> {
    if (operation.kind !== "order") return; // Never gate cancellation, merge or redemption.
    const payload = object(operation.payload);
    const order = storedOrder(payload.order);
    this.#requireTester(order.maker);
    await this.safety?.assertCanTrade([order.marketId]);
  }

  #requireTester(account: Address): void {
    if (
      this.environment.internalTesters &&
      !this.environment.internalTesters.has(account.toLowerCase())
    )
      throw new GatewayError(
        GatewayErrorCode.NotAuthenticated,
        "Trading is limited to configured internal tester wallets",
        403,
      );
  }

  async #findOrderOperation(session: Address, orderHash: Hex): Promise<OperationRecord | null> {
    return await this.store.findOrderOperation(session, orderHash);
  }

  #parseProtection(input: unknown, order: Order, notional: bigint) {
    const protection = object(input, "protection");
    const parse = (value: unknown, name: string): bigint => {
      if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new GatewayError(GatewayErrorCode.InvalidRequest, `${name} must be a decimal string`);
      }
      return BigInt(value);
    };
    const maxNotional = parse(protection.maxNotional, "protection.maxNotional");
    const maxQuantity = parse(protection.maxQuantity, "protection.maxQuantity");
    const worstPriceRawX18 = parse(protection.worstPriceRawX18, "protection.worstPriceRawX18");
    if (
      maxQuantity !== order.quantity ||
      worstPriceRawX18 !== order.limitPriceRawX18 ||
      maxNotional < notional
    ) {
      throw new GatewayError(
        GatewayErrorCode.OrderInvalid,
        "IOC protection must cover the signed quantity, limit price, and reservation",
      );
    }
    return { maxNotional, maxQuantity, worstPriceRawX18 };
  }

  #idempotencyKey(value: string | undefined): string {
    if (!value || !IDEMPOTENCY_PATTERN.test(value)) {
      throw new GatewayError(
        GatewayErrorCode.InvalidRequest,
        "Idempotency-Key must be 8-128 safe ASCII characters",
      );
    }
    return value;
  }

  #requireAccount(actual: Address, expected: Address): void {
    if (getAddress(actual) !== getAddress(expected)) {
      throw new GatewayError(
        GatewayErrorCode.NotAuthenticated,
        "session does not own this action",
        403,
      );
    }
  }
}
