import { createHash } from "node:crypto";
import type { Database } from "@conditional-stocks/db";
import {
  activeDelegation,
  conditionalStocksAbi,
  DELEGATE_TRADE,
  type OrderWire,
  parseOrder,
  placement,
  protocolError,
  protocolErrorMessage,
} from "@conditional-stocks/evm-client";
import { grantKey, traderOf } from "@conditional-stocks/evm-client/ledger";
import type { IndexerService } from "@conditional-stocks/indexer";
import {
  type Address,
  decodeEventLog,
  getAddress,
  type Hex,
  keccak256,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { OrderPlanner } from "./plan.ts";

const MAX_STALE_REPLANS = 4;
const DAILY_LIMIT = 500;

/** A dedicated, gas-funded trading key: never an admin, deployment or custody key. */
export function tradingSigner(secret: string | undefined, expected: string | undefined) {
  if (!secret) return null;
  try {
    const account = privateKeyToAccount(secret.trim() as Hex);
    if (expected && account.address !== getAddress(expected)) throw new Error();
    return account;
  } catch {
    throw new Error(
      "TRADING_DELEGATE_PRIVATE_KEY must be a hex key matching TRADING_DELEGATE_ADDRESS (value withheld)",
    );
  }
}
export type TradingSigner = NonNullable<ReturnType<typeof tradingSigner>>;

export function tradingPermission(
  indexer: IndexerService,
  signer: TradingSigner | null,
  owner: Address,
) {
  const s = indexer.trading();
  const delegate = signer?.address ?? null;
  const grant = delegate ? s.grants.get(grantKey(owner, delegate)) : undefined;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const active = Boolean(
    grant &&
      grant.market === 0 &&
      (grant.remainingQuote > 0n || grant.remainingBase > 0n) &&
      activeDelegation(grant, traderOf(s, owner).delegationEpoch, 0, now, DELEGATE_TRADE),
  );
  // Sell limits are raw base units of any market's stock: size them for the stock with the
  // most decimals (tokenized stocks share 18), so no share limit is looser than it reads.
  let baseDecimals: number | null = null;
  for (const [token, pool] of s.pools)
    if (token !== s.quote && (baseDecimals === null || pool.decimals > baseDecimals))
      baseDecimals = pool.decimals;
  return {
    available: Boolean(signer),
    delegate,
    owner,
    active,
    block: s.block.toString(),
    quoteToken: s.quote,
    quoteDecimals: s.pools.get(s.quote)?.decimals ?? null,
    baseDecimals,
    grant: grant
      ? {
          market: String(grant.market),
          expiresAt: grant.expiresAt.toString(),
          maxOrderQuote: grant.maxOrderQuote.toString(),
          remainingQuote: grant.remainingQuote.toString(),
          maxOrderBase: grant.maxOrderBase.toString(),
          remainingBase: grant.remainingBase.toString(),
          maxFeeBps: grant.maxFeeBps,
          permissions: grant.permissions,
          revoked: grant.revoked,
          generation: grant.generation,
        }
      : null,
  };
}

/** Serializes the delegate's nonce use within this process. */
class Mutex {
  private last: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.last.then(work, work);
    this.last = next.catch(() => {});
    return next;
  }
}

export class DelegatedTrading {
  private readonly nonce = new Mutex();

  constructor(
    private readonly options: {
      indexer: IndexerService;
      db: Database;
      domain: string;
      client: PublicClient;
      signer: TradingSigner;
      prepare: OrderPlanner;
    },
  ) {}

  /** Places `order` for `owner` through its grant. The signed bytes are journaled before
   * broadcast; retrying the same `clientId` never creates a second transaction. */
  async submit(owner: Address, input: OrderWire, clientId: string) {
    const { indexer, db, domain, client, signer, prepare } = this.options;
    if (!/^[A-Za-z0-9-]{8,64}$/.test(clientId)) throw new Error("Invalid client request id");
    const order = parseOrder(input);
    if (order.maker !== owner || order.delegate !== signer.address)
      throw new Error("Delegated order owner or signer differs from the authenticated wallet");
    const termsHash = createHash("sha256").update(JSON.stringify(order)).digest("hex");
    const submission = await db.locked(`delegated:${domain}:${owner}`, async (queries) => {
      const existing = await queries.delegatedSubmission(domain, owner, clientId);
      if (existing) {
        if (
          existing.order_terms_hash !== termsHash ||
          getAddress(existing.delegate) !== signer.address
        )
          throw new Error("Delegated submission identity mismatch");
        return existing;
      }
      if ((await queries.delegatedSubmissionCount(domain, owner)) >= DAILY_LIMIT)
        throw new Error("Daily delegated order limit reached");
      const market = () => indexer.trading().markets.get(Number(order.marketId));
      for (let attempt = 0; ; attempt++) {
        const m = market();
        if (!m) throw new Error("Unknown market");
        const { plan } = prepare(order);
        const envelope = placement(indexer.options.exchange, order, plan, m.tick);
        try {
          await client.call({ account: signer.address, to: envelope.to, data: envelope.data });
        } catch (error) {
          if (protocolError(error) !== "StalePlan" || attempt === MAX_STALE_REPLANS)
            throw new Error(
              protocolErrorMessage(error, "The order could not execute against the current state."),
            );
          // Wait for the replica to reach a newer block, then replan.
          const seen = indexer.trading().block;
          const until = Date.now() + 10_000;
          while (indexer.trading().block <= seen && Date.now() < until) await Bun.sleep(100);
          continue;
        }
        return this.nonce.run(async () => {
          const request = await client.prepareTransactionRequest({
            account: signer,
            chain: client.chain,
            to: envelope.to,
            data: envelope.data,
          });
          const raw = await signer.signTransaction(request as never);
          const hash = keccak256(raw);
          await queries.recordDelegatedSubmission(
            domain,
            owner,
            clientId,
            termsHash,
            signer.address,
            hash,
            raw,
          );
          await client.sendRawTransaction({ serializedTransaction: raw }).catch(() => {
            // Journaled: an ambiguous send is resolved by the receipt below or a retry.
          });
          return { order_terms_hash: termsHash, delegate: signer.address, tx_hash: hash, raw };
        });
      }
    });
    const hash = submission.tx_hash as Hex;
    let receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
    if (!receipt) {
      await client
        .sendRawTransaction({ serializedTransaction: submission.raw as Hex })
        .catch(() => {});
      receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
    }
    if (receipt.status !== "success")
      throw new Error(
        "The order was not executed: the book changed before inclusion. Review the latest quote.",
      );
    let orderHash: string | null = null;
    for (const log of receipt.logs) {
      try {
        const event = decodeEventLog({
          abi: conditionalStocksAbi,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "OrderPlaced") {
          const args = event.args as { market: number; order: bigint; seq: bigint };
          orderHash = (
            (BigInt(args.market) << 40n) |
            (((args.order >> 32n) & 1n) << 32n) |
            args.seq
          ).toString();
        }
      } catch {
        // Other contracts' logs (e.g. tokens) are not protocol events.
      }
    }
    return { transactionHash: hash, orderHash };
  }
}
