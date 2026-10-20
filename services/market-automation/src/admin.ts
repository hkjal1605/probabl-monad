/** The market admin's side of the API's evidence flow, the admin console's path, signed with
 * local keys. Every transaction the API previews is rebuilt locally from the approved evidence
 * and the live chain, and is signed only when both agree. */
import { conditionalStocksAbi, underlyingId } from "@conditional-stocks/evm-client";
import {
  type AdminAction,
  type AdminDeployment,
  type AdminPreview,
  type AdminTransaction,
  evidenceTransactions,
  lifecycleTransaction,
  makerRebateTransaction,
  type PacketEnvelope,
  preflightAdmin,
} from "@conditional-stocks/evm-client/admin";
import type { EventMarket, EventSource } from "@conditional-stocks/market-data";
import { catalogUnderlying } from "@conditional-stocks/shared/token-catalog";
import { type Address, erc20Abi, type Hex, type PublicClient, type WalletClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { EventCondition } from "./settlement.ts";

/** The API's review checklists (apps/server/src/admin/routes.ts): automation confirms each item
 * by construction. */
const CHECKLISTS = {
  "market-creation": [
    "stock-and-quote",
    "condition-id",
    "yes-no-orientation",
    "rules-and-dates",
    "maker-and-taker-fees",
    "source-and-raw-hash",
  ],
  "market-resolution": [
    "frozen-or-awaiting",
    "condition-id",
    "yes-no-orientation",
    "final-status",
    "polygon-reference",
    "attachments",
    "payout-vector",
  ],
} as const;

/** Market states (`ConditionalStocksBase`). */
export const SCHEDULED = 1,
  OPEN = 2,
  FROZEN = 3,
  AWAITING = 4;

/** An on-chain market as the API's indexer lists it. */
export interface Market extends EventCondition {
  venue: { marketId: string };
  state: number;
  /** Unix seconds, as decimal strings. */
  tradingOpen: string;
  tradingCutoff: string;
  /** The venue of the market's event. */
  eventSource: EventSource;
  baseToken: Address;
  makerRebateBps: number;
}
/** A stored venue snapshot (Polymarket or Kalshi), which evidence refers to by id. */
export interface Snapshot {
  snapshotId: string;
  rawHash: Hex;
  normalized: EventMarket;
}
export interface Evidence {
  envelope: PacketEnvelope;
  status: "prepared" | "approved" | "rejected";
  observations: { marketId?: string }[];
}

export class Admin {
  private readonly target: { chainId: number; exchange: Address };
  private token: Promise<string> | undefined;
  private quoteToken: Promise<Address> | undefined;

  constructor(
    private readonly options: {
      /** The API origin, e.g. http://127.0.0.1:3000. */
      api: string;
      /** A sign-in origin the API accepts (`API_AUTH_ORIGINS`). */
      origin: string;
      client: PublicClient;
      wallet: WalletClient;
      exchange: Address;
      /** Signs creation, lifecycle and resolution commitments, and the API session. */
      marketAdmin: PrivateKeyAccount;
      /** Signs resolutions; without it markets stop at their commitment. */
      resolutionAdmin?: PrivateKeyAccount;
    },
  ) {
    const chainId = options.client.chain?.id;
    if (!chainId) throw new Error("The client needs its chain");
    this.target = { chainId, exchange: options.exchange };
  }

  /** Every market on the exchange. */
  async markets() {
    return (await this.request<{ markets: Market[] }>("/markets?venues=all")).markets;
  }
  /** Markets' states read from the chain in one call; the API's indexed view trails it. */
  async chainStates(marketIds: string[]) {
    const { client, exchange } = this.options;
    const terms = (await client.multicall({
      allowFailure: false,
      deployless: true,
      contracts: marketIds.map((id) => ({
        address: exchange,
        abi: conditionalStocksAbi,
        functionName: "terms",
        args: [Number(id)],
      })) as never,
    })) as unknown as { state: number }[];
    return terms.map((t) => t.state);
  }
  /** The exchange's quote token. */
  quote() {
    const { client, exchange } = this.options;
    this.quoteToken ??= client.readContract({
      address: exchange,
      abi: conditionalStocksAbi,
      functionName: "quote",
    });
    return this.quoteToken;
  }
  /** The latest venue snapshot the API holds for a market's event. */
  async event(marketId: string) {
    return (await this.request<{ metadata: Snapshot }>(`/v1/markets/${marketId}/event`)).metadata;
  }
  /** Stores and returns a fresh snapshot of a Polymarket (Gamma id) or Kalshi (ticker) market,
   * which evidence refers to by id. */
  fetchMetadata(source: EventSource, marketId: string) {
    return source === "kalshi"
      ? this.request<Snapshot>("/v1/admin/kalshi/metadata/fetch", { ticker: marketId })
      : this.request<Snapshot>("/v1/admin/polymarket/metadata/fetch", { gammaMarketId: marketId });
  }
  /** The most recent evidence packets (the API returns 200). */
  async evidence() {
    return (await this.request<{ packets: Evidence[] }>("/v1/admin/evidence")).packets;
  }
  prepare(kind: "creation" | "resolution", body: Record<string, unknown>) {
    return this.request<Evidence>(`/v1/admin/evidence/${kind}/prepare`, body);
  }
  approve(evidence: Evidence, notes: string) {
    const checks = CHECKLISTS[evidence.envelope.packet.kind];
    return this.request<Evidence>(`/v1/admin/evidence/${evidence.envelope.packetHash}/review`, {
      decision: "approve",
      checklist: Object.fromEntries(checks.map((key) => [key, true])),
      notes,
    });
  }

  /** Executes the next action an approved packet authorizes (creation, a resolution commitment
   * or the resolution itself) and reconciles it with the API. */
  async execute(evidence: Evidence) {
    const hash = evidence.envelope.packetHash;
    const preview = await this.request<AdminPreview & { prerequisites: AdminTransaction[] }>(
      `/v1/admin/evidence/${hash}/transaction`,
      {},
    );
    const p = evidence.envelope.packet;
    const { transactions } = evidenceTransactions(
      evidence.envelope,
      preview.action,
      await this.deployment(p.kind === "market-creation" ? p.config.baseToken : undefined),
    );
    const remote = [...preview.prerequisites, preview];
    if (
      remote.length !== transactions.length ||
      transactions.some((t, i) => t.to !== remote[i]?.to || t.data !== remote[i]?.data)
    )
      throw new Error("The API preview differs from the locally built transaction");
    let transactionHash: Hex = "0x";
    for (const transaction of transactions) transactionHash = await this.send(transaction);
    const observation = await this.reconcile(hash, preview.action, transactionHash);
    return { action: preview.action, transactionHash, marketId: observation.marketId };
  }

  /** Lifecycle actions outside resolution: 0 open, 1 freeze (needs a reason), 2 freeze at
   * cutoff. */
  lifecycle(marketId: string, action: 0 | 1 | 2, reason = "") {
    return this.send(
      lifecycleTransaction(
        this.target,
        this.options.marketAdmin.address,
        Number(marketId),
        action,
        reason,
      ),
    );
  }
  setMakerRebate(marketId: string, rebateBps: number) {
    return this.send(
      makerRebateTransaction(
        this.target,
        this.options.marketAdmin.address,
        Number(marketId),
        rebateBps,
      ),
    );
  }

  /** What the local transaction build needs from the chain. */
  private async deployment(base?: Address): Promise<AdminDeployment> {
    const { client, exchange } = this.options;
    const read = (functionName: "roles" | "marketCount" | "pool", args?: readonly unknown[]) =>
      client.readContract({
        address: exchange,
        abi: conditionalStocksAbi,
        functionName,
        args,
      } as never);
    const [roles, count, pool, symbol] = await Promise.all([
      read("roles") as Promise<readonly [Address, Address, Address]>,
      read("marketCount") as Promise<number>,
      base ? (read("pool", [base]) as Promise<{ listed: boolean }>) : undefined,
      base
        ? client.readContract({ address: base, abi: erc20Abi, functionName: "symbol" })
        : undefined,
    ]);
    const underlying = catalogUnderlying(symbol);
    return {
      ...this.target,
      marketAdmin: roles[0],
      resolutionAdmin: roles[2],
      nextMarketId: Number(count) + 1,
      basePoolListed: () => pool?.listed ?? true,
      baseUnderlying: () => (underlying ? underlyingId(underlying) : null),
    };
  }

  private async send(transaction: AdminTransaction) {
    const { client, wallet, marketAdmin, resolutionAdmin } = this.options;
    const account = [marketAdmin, resolutionAdmin].find((a) => a?.address === transaction.from);
    if (!account) throw new Error(`No key is configured for ${transaction.from}`);
    await preflightAdmin(client, transaction);
    const hash = await wallet.sendTransaction({
      account,
      chain: client.chain,
      to: transaction.to,
      data: transaction.data,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
    return hash;
  }

  /** Records an executed action; creation also starts the ingestor's odds stream, so transient
   * failures are retried. */
  private async reconcile(hash: string, action: AdminAction, transactionHash: Hex) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.request<{ marketId: string }>(`/v1/admin/evidence/${hash}/reconcile`, {
          action,
          transactionHash,
        });
      } catch (error) {
        if (attempt === 3) throw error;
        await Bun.sleep(2_000 * attempt);
      }
    }
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    const authenticated = path.startsWith("/v1/admin/");
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`${this.options.api}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          ...(authenticated ? { authorization: `Bearer ${await this.session()}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      // A session the API no longer knows is renewed once.
      if (authenticated && response.status === 401 && attempt === 1) {
        this.token = undefined;
        continue;
      }
      const json = (await response.json().catch(() => ({}))) as T & {
        error?: { message?: string } | string;
      };
      if (!response.ok) {
        const message = typeof json.error === "string" ? json.error : json.error?.message;
        throw new Error(`${path}: ${message ?? response.status}`);
      }
      return json;
    }
  }

  private session() {
    this.token ??= (async () => {
      const { marketAdmin, origin } = this.options;
      const { challengeId, message } = await this.request<{ challengeId: string; message: string }>(
        "/v1/auth/challenge",
        { address: marketAdmin.address, origin },
      );
      const { token } = await this.request<{ token: string }>("/v1/auth/verify", {
        address: marketAdmin.address,
        challengeId,
        signature: await marketAdmin.signMessage({ message }),
      });
      return token;
    })().catch((error) => {
      this.token = undefined;
      throw error;
    });
    return this.token;
  }
}
