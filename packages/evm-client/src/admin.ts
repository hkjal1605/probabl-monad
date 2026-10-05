import {
  assertEvidenceIntegrity,
  type CreationEvidencePacket,
  type EvidenceEnvelope,
  type ResolutionEvidencePacket,
} from "@conditional-stocks/market-data";
import {
  type Address,
  getAddress,
  type Hex,
  keccak256,
  type PublicClient,
  stringToBytes,
  zeroHash,
} from "viem";
import { isFeeRate, MAX_FEE_BPS, resolutionHash } from "./protocol.ts";
import { createMarket, type Envelope, lifecycle, listPool, resolve } from "./transactions.ts";

export type AdminAction = "list-pool" | "create-market" | "begin-resolution" | "resolve-market";
export interface AdminTransaction extends Envelope {
  from: Address;
  chainId: number;
}
export interface AdminPreview extends AdminTransaction {
  action: AdminAction;
  expectedMarketId: string;
  packetHash: string;
  previewId: string;
}
export type PacketEnvelope = EvidenceEnvelope<CreationEvidencePacket | ResolutionEvidencePacket>;
export interface AdminDeployment {
  chainId: number;
  exchange: Address;
  marketAdmin: Address;
  resolutionAdmin: Address;
  /** The id the next created market receives (`marketCount() + 1`). */
  nextMarketId: number;
  /** Whether the evidence's base token already has a custody pool. */
  basePoolListed: (token: Address) => boolean;
  /** The underlying asset id an unlisted base token is listed with (`underlyingId`), or null
   * when it is unknown, which blocks listing. */
  baseUnderlying: (token: Address) => Hex | null;
}

/** On-chain parameters of an approved creation packet. */
export function creationParams(c: CreationEvidencePacket["config"]) {
  const step = BigInt(c.baseStep),
    maxQuantity = BigInt(c.maxOrderQuantity);
  if (maxQuantity % step !== 0n || maxQuantity / step > 4_294_967_295n)
    throw new Error("Maximum order quantity must be at most 2^32-1 steps");
  const makerBps = Number(c.makerFeeBps),
    takerBps = Number(c.takerFeeBps);
  if (!isFeeRate(makerBps) || !isFeeRate(takerBps))
    throw new Error(`Fee rates must be whole bps from 0 to ${MAX_FEE_BPS}`);
  return {
    base: getAddress(c.baseToken),
    condition: c.polymarketConditionId as Hex,
    yesIndex: Number(c.polymarketYesIndex),
    noIndex: Number(c.polymarketNoIndex),
    rulesHash: c.rulesHash as Hex,
    metadataHash: c.metadataHash as Hex,
    open: BigInt(c.tradingOpen),
    cutoff: BigInt(c.tradingCutoff),
    tick: BigInt(c.priceTickRawX18),
    step,
    maxSteps: maxQuantity / step,
    minNotional: BigInt(c.minNotional),
    maxOrder: BigInt(c.maxOrderNotional),
    maxWallet: BigInt(c.maxWalletOpenNotional),
    maxMarket: BigInt(c.maxMarketOpenNotional),
    makerBps,
    takerBps,
  };
}

/** The ordered transactions an approved packet authorizes for `action`. A creation packet
 * whose base token has no custody pool yet first lists it. */
export function evidenceTransactions(
  value: PacketEnvelope,
  action: AdminAction,
  deployment: AdminDeployment,
): { transactions: AdminTransaction[]; expectedMarketId: string } {
  assertEvidenceIntegrity(value);
  const p = value.packet;
  if (
    BigInt(p.deployment.chainId) !== BigInt(deployment.chainId) ||
    getAddress(p.deployment.exchange) !== getAddress(deployment.exchange)
  )
    throw new Error("Evidence belongs to another deployment");
  const tx = (envelope: Envelope, from: Address): AdminTransaction => ({
    ...envelope,
    from,
    chainId: deployment.chainId,
  });
  if (p.kind === "market-creation") {
    if (action !== "create-market") throw new Error("Action does not match the evidence packet");
    const params = creationParams(p.config);
    const listing: AdminTransaction[] = [];
    if (!deployment.basePoolListed(params.base)) {
      const underlying = deployment.baseUnderlying(params.base);
      if (!underlying)
        throw new Error("The base token is not in the asset catalog; its underlying is unknown");
      listing.push(
        tx(listPool(deployment.exchange, params.base, underlying), deployment.marketAdmin),
      );
    }
    const transactions = [
      ...listing,
      tx(createMarket(deployment.exchange, params, p.config.metadataUri), deployment.marketAdmin),
    ];
    return { transactions, expectedMarketId: String(deployment.nextMarketId) };
  }
  const market = Number(p.localMarket.marketId),
    yes = Number(p.payout.yes),
    no = Number(p.payout.no),
    evidence = value.packetHash as Hex;
  if (action === "begin-resolution") {
    const commitment = resolutionHash(
      deployment.chainId,
      deployment.exchange,
      market,
      yes,
      no,
      evidence,
      p.sourceReference,
    );
    return {
      transactions: [
        tx(lifecycle(deployment.exchange, market, 3, commitment), deployment.marketAdmin),
      ],
      expectedMarketId: String(market),
    };
  }
  if (action === "resolve-market")
    return {
      transactions: [
        tx(
          resolve(deployment.exchange, market, yes, no, evidence, p.sourceReference),
          deployment.resolutionAdmin,
        ),
      ],
      expectedMarketId: String(market),
    };
  throw new Error("Action does not match the evidence packet");
}

/** Lifecycle actions outside resolution: 0 open, 1 freeze, 2 freeze at cutoff, 4 archive. */
export function lifecycleTransaction(
  deployment: Pick<AdminDeployment, "chainId" | "exchange">,
  actor: Address,
  marketId: number,
  action: 0 | 1 | 2 | 4,
  reason = "",
): AdminTransaction {
  if ((action === 1 || action === 4) && !reason.trim())
    throw new Error("A non-empty reason is required");
  return {
    ...lifecycle(
      deployment.exchange,
      marketId,
      action,
      reason ? keccak256(stringToBytes(reason)) : zeroHash,
    ),
    from: getAddress(actor),
    chainId: deployment.chainId,
  };
}

/** Simulates an administrative call from its role account before it is shown for signing. */
export async function preflightAdmin(client: PublicClient, transaction: AdminTransaction) {
  if ((await client.getChainId()) !== transaction.chainId || transaction.value !== "0")
    throw new Error("Invalid admin deployment");
  const code = await client.getCode({ address: transaction.to });
  if (!code || code === "0x") throw new Error("The exchange is not deployed");
  await client.call({ account: transaction.from, to: transaction.to, data: transaction.data });
}
