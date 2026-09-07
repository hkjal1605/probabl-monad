import {
  conditionalExchangeAbi,
  iOCRouterAbi,
  marketRegistryAbi,
  protocolAuthorityAbi,
} from "@conditional-stocks/contract-bindings";
import type {
  CanonicalSettlementSource,
  PreparedSettlementTransaction,
  SettlementBatchPayload,
  SettlementCall,
  SettlementChain,
  SettlementContext,
  SettlementReceipt,
} from "@conditional-stocks/db/settlement/types";
import { SETTLEMENT_SCHEMA_VERSION } from "@conditional-stocks/db/settlement/types";
import { hashOrder, type Order } from "@conditional-stocks/domain";
import { type ChainCursor, canonicalParse } from "@conditional-stocks/orderbook";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  type Hex,
  http,
  keccak256,
  toBytes,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface SettlementEnvironment {
  chainId: number;
  exchange: Address;
  indexerUrl: string;
  internalToken: string;
  iocRouter: Address;
  leaseTtlMs: bigint;
  matcherCallbackUrl: string | null;
  ownerId: string;
  port: number;
  privateKey: Hex;
  protocolAuthority: Address;
  replacementBumpBps: bigint;
  rpcUrl: string;
  stuckMs: bigint;
}

const required = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const loadSettlementEnvironment = (
  environment: NodeJS.ProcessEnv,
): SettlementEnvironment => {
  const chainId = Number(required(environment, "ROBINHOOD_CHAIN_ID"));
  const privateKey = required(environment, "SETTLEMENT_RELAYER_PRIVATE_KEY") as Hex;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("invalid chain id");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("invalid settlement private key");
  const address = (name: string): Address => getAddress(required(environment, name));
  return {
    chainId,
    exchange: address("EXCHANGE_ADDRESS"),
    indexerUrl: environment.INDEXER_URL ?? "http://127.0.0.1:42069",
    internalToken: required(environment, "SETTLEMENT_INTERNAL_TOKEN"),
    iocRouter: address("IOC_ROUTER_ADDRESS"),
    leaseTtlMs: BigInt(environment.SETTLEMENT_LEASE_TTL_MS ?? "15000"),
    matcherCallbackUrl: environment.MATCHER_CALLBACK_URL ?? null,
    ownerId: environment.SETTLEMENT_OWNER_ID ?? crypto.randomUUID(),
    port: Number(environment.SETTLEMENT_PORT ?? "42071"),
    privateKey,
    protocolAuthority: address("PROTOCOL_AUTHORITY_ADDRESS"),
    replacementBumpBps: BigInt(environment.SETTLEMENT_REPLACEMENT_BUMP_BPS ?? "1250"),
    rpcUrl: required(environment, "ROBINHOOD_RPC_URL"),
    stuckMs: BigInt(environment.SETTLEMENT_STUCK_MS ?? "30000"),
  };
};

export const buildSettlementCalls = (
  payload: SettlementBatchPayload,
  chainId: bigint,
  exchange: Address,
  iocRouter: Address,
): SettlementCall[] => {
  if (payload.schemaVersion !== SETTLEMENT_SCHEMA_VERSION)
    throw new Error("Legacy settlement payload requires a fresh v2 queue");
  if (payload.kind === "ioc") {
    return [
      {
        data: encodeFunctionData({
          abi: iOCRouterAbi,
          args: [
            payload.takerOrder,
            payload.takerSignature,
            payload.makerOrders,
            payload.fillQuantities,
          ],
          functionName: "executeIOC",
        }),
        expectedFills: payload.makerOrders.map((makerOrder, index) => ({
          buyOrderHash:
            payload.takerOrder.side === 0
              ? payload.intentId
              : hashOrder(makerOrder, { chainId, verifyingContract: exchange }),
          executionPriceRawX18: makerOrder.limitPriceRawX18,
          fillQuantity: payload.fillQuantities[index] ?? 0n,
          sellOrderHash:
            payload.takerOrder.side === 1
              ? payload.intentId
              : hashOrder(makerOrder, { chainId, verifyingContract: exchange }),
        })),
        to: iocRouter,
      },
    ];
  }
  return payload.proposal.fills.map((fill) => ({
    data: encodeFunctionData({
      abi: conditionalExchangeAbi,
      args: [fill.buyOrder, fill.sellOrder, fill.fillQuantity],
      functionName: "matchOrders",
    }),
    expectedFills: [
      {
        buyOrderHash: fill.buyOrderHash,
        executionPriceRawX18: fill.executionPriceRawX18,
        fillQuantity: fill.fillQuantity,
        sellOrderHash: fill.sellOrderHash,
      },
    ],
    to: exchange,
  }));
};

export class ViemSettlementChain implements SettlementChain {
  readonly #account;
  readonly #public;
  readonly #wallet;

  constructor(readonly environment: SettlementEnvironment) {
    this.#account = privateKeyToAccount(environment.privateKey);
    const transport = http(environment.rpcUrl, { batch: true });
    this.#public = createPublicClient({ transport });
    this.#wallet = createWalletClient({ account: this.#account, transport });
  }

  get relayerAddress(): Address {
    return this.#account.address;
  }

  async preflight(): Promise<void> {
    const authority = await this.#public.readContract({
      abi: conditionalExchangeAbi,
      address: this.environment.exchange,
      functionName: "authority",
    });
    if (authority.toLowerCase() !== this.environment.protocolAuthority.toLowerCase())
      throw new Error("settlement authority does not match exchange");
    const registry = await this.#public.readContract({
      abi: conditionalExchangeAbi,
      address: this.environment.exchange,
      functionName: "registry",
    });
    const version = await this.#public.readContract({
      abi: marketRegistryAbi,
      address: registry,
      functionName: "PROTOCOL_VERSION",
    });
    if (version !== 2) throw new Error("Settlement requires v2 raw-unit ratio contracts");
    const [chainId, matcherRole] = await Promise.all([
      this.#public.getChainId(),
      this.#public.readContract({
        abi: conditionalExchangeAbi,
        address: this.environment.exchange,
        functionName: "MATCHER_ROLE",
      }),
    ]);
    if (chainId !== this.environment.chainId) {
      throw new Error(`wrong chain: ${chainId} != ${this.environment.chainId}`);
    }
    const authorized = await this.#public.readContract({
      abi: protocolAuthorityAbi,
      address: this.environment.protocolAuthority,
      args: [matcherRole, this.relayerAddress],
      functionName: "hasRole",
    });
    if (!authorized) throw new Error("settlement relayer does not have MATCHER_ROLE");
    for (const role of [
      zeroHash,
      ...["MARKET_ADMIN_ROLE", "GUARDIAN_ROLE", "RESOLUTION_ADMIN_ROLE"].map((name) =>
        keccak256(toBytes(name)),
      ),
    ]) {
      if (
        await this.#public.readContract({
          abi: protocolAuthorityAbi,
          address: authority,
          functionName: "hasRole",
          args: [role, this.relayerAddress],
        })
      )
        throw new Error("settlement key must be matcher-only, with no administrative role");
    }
  }

  async pendingNonce(): Promise<bigint> {
    return BigInt(
      await this.#public.getTransactionCount({ address: this.relayerAddress, blockTag: "pending" }),
    );
  }

  async simulate(call: SettlementCall, blockNumber: bigint): Promise<{ gas: bigint }> {
    const gas = await this.#public.estimateGas({
      account: this.relayerAddress,
      blockNumber,
      data: call.data,
      to: call.to,
      value: 0n,
    });
    return { gas };
  }

  async prepare(
    call: SettlementCall,
    nonce: bigint,
    fees?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  ): Promise<PreparedSettlementTransaction> {
    if (nonce < 0n || nonce > BigInt(Number.MAX_SAFE_INTEGER))
      throw new RangeError("relayer nonce cannot be represented exactly by the transaction signer");
    const estimated = fees ?? (await this.#public.estimateFeesPerGas());
    const gas = await this.#public.estimateGas({
      account: this.relayerAddress,
      data: call.data,
      to: call.to,
      value: 0n,
    });
    const request = await this.#wallet.prepareTransactionRequest({
      account: this.#account,
      chain: null,
      data: call.data,
      gas: (gas * 120n) / 100n,
      maxFeePerGas: estimated.maxFeePerGas,
      maxPriorityFeePerGas: estimated.maxPriorityFeePerGas,
      nonce: Number(nonce),
      to: call.to,
      type: "eip1559",
      value: 0n,
    });
    const rawTransaction = await this.#wallet.signTransaction({ ...request, chain: null });
    return {
      gas: request.gas,
      maxFeePerGas: request.maxFeePerGas,
      maxPriorityFeePerGas: request.maxPriorityFeePerGas,
      nonce,
      rawTransaction,
      transactionHash: keccak256(rawTransaction),
    };
  }

  async broadcast(rawTransaction: Hex): Promise<Hex> {
    return this.#public.sendRawTransaction({ serializedTransaction: rawTransaction });
  }

  async receipt(transactionHash: Hex): Promise<SettlementReceipt | null> {
    try {
      const receipt = await this.#public.getTransactionReceipt({ hash: transactionHash });
      return {
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        transactionHash,
      };
    } catch {
      return null;
    }
  }
}

interface ContextWire {
  anchorCanonical: boolean;
  confirmedThrough: string;
  finalizedThrough: string;
  marketStates: Array<{ marketId: Hex; state: number }>;
  orders: Array<{ id: Hex; remaining: string; sequence: string; status: string }>;
  tradingPaused: boolean;
}

export class PonderSettlementSource implements CanonicalSettlementSource {
  constructor(readonly baseUrl: string) {}

  async iocBook(order: Order) {
    const query = new URLSearchParams({
      marketId: order.marketId,
      branch: String(order.branch),
      side: String(order.side === 0 ? 1 : 0),
    });
    const response = await fetch(`${this.baseUrl}/internal/ioc-book?${query}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`IOC book unavailable (${response.status})`);
    return canonicalParse<{
      cursor: ChainCursor;
      orders: Array<{ order: Order; remaining: bigint; sequence: bigint }>;
    }>(await response.text());
  }

  async context(cursor: ChainCursor, orderHashes: Hex[]): Promise<SettlementContext> {
    const query = new URLSearchParams({
      anchorBlock: cursor.blockNumber.toString(),
      anchorHash: cursor.blockHash,
    });
    for (const orderHash of orderHashes) query.append("orderHash", orderHash);
    const wire = await this.#json<ContextWire>(`/internal/settlement-context?${query}`);
    return {
      ...wire,
      confirmedThrough: BigInt(wire.confirmedThrough),
      finalizedThrough: BigInt(wire.finalizedThrough),
      orders: wire.orders.map((order) => ({
        ...order,
        remaining: BigInt(order.remaining),
        sequence: BigInt(order.sequence),
      })),
    };
  }

  async fillsConfirmed(
    expectedFills: SettlementCall["expectedFills"],
    transactionHashes: Hex[],
  ): Promise<boolean> {
    const query = new URLSearchParams();
    for (const hash of transactionHashes) query.append("transactionHash", hash);
    const result = await this.#json<{
      confirmed: boolean;
      fills: Array<{
        buyOrderHash: Hex;
        executionPriceRawX18: string;
        fillQuantity: string;
        sellOrderHash: Hex;
      }>;
    }>(`/internal/settlement-confirmation?${query}`);
    if (!result.confirmed || result.fills.length !== expectedFills.length) return false;
    const actual = result.fills
      .map(
        (fill) =>
          `${fill.buyOrderHash}:${fill.sellOrderHash}:${fill.fillQuantity}:${fill.executionPriceRawX18}`,
      )
      .sort();
    const expected = expectedFills
      .map(
        (fill) =>
          `${fill.buyOrderHash}:${fill.sellOrderHash}:${fill.fillQuantity}:${fill.executionPriceRawX18}`,
      )
      .sort();
    return actual.every((value, index) => value === expected[index]);
  }

  async #json<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`indexer returned ${response.status}`);
    const text = await response.text();
    return response.headers.get("content-type")?.includes("conditional-stocks-canonical")
      ? canonicalParse<T>(text)
      : (JSON.parse(text) as T);
  }
}
