import type { Envelope } from "@conditional-stocks/evm-client";
import { getAddress, type Hex, keccak256, type PublicClient, type TransactionReceipt } from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";

/** Gas limits of one signing service. */
export interface GasPolicy {
  /** Native gas balance kept for cancellations. */
  minGasWei: string;
  dailyGasBudgetWei: string;
}
/** EIP-1559 fees of the next transactions. */
export interface Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}
export interface ExecutorOptions {
  /** Interval between receipt reads while a transaction awaits inclusion (default 500 ms). */
  receiptPollMs?: number;
  /** Fees shared by a burst of transactions so each need not read them; when absent, or when
   * it yields none, every transaction estimates its own. */
  fees?: () => Promise<Fees | undefined>;
  /** Gas limit above the estimate, in bps: other makers' orders landing between estimation
   * and inclusion make the exchange's checks scan more (default 0). Unused gas is not paid. */
  gasHeadroomBps?: number;
}
/** The transaction journal every signing service persists. */
export interface Journal {
  day: string;
  /** Gas spent today, in wei. */
  spent: string;
  /** Block of the last included transaction; views must not be older. */
  lastBlock: string;
  /** Signed transaction journaled before broadcast; `charged` is its reserved maximum cost. */
  pending?: { hash: string; nonce: number; raw: string; charged: string };
}

/** The signing account of a service; `keyName`/`addressName` name its environment variables. */
export function signer(secret: string, expected: string, keyName: string, addressName: string) {
  try {
    const account = privateKeyToAccount(secret.trim() as Hex);
    if (account.address !== getAddress(expected)) throw new Error();
    return account;
  } catch {
    throw new Error(`${keyName} must be a hex key matching ${addressName} (value withheld)`);
  }
}
/** Actual fee of an included transaction, including an OP-stack L1 data fee. */
const cost = (receipt: TransactionReceipt) =>
  receipt.gasUsed * receipt.effectiveGasPrice +
  ((receipt as { l1Fee?: bigint | null }).l1Fee ?? 0n);
/** Node errors after which a broadcast transaction can certainly never be included. */
const REJECTED =
  /nonce too (low|high)|nonce has already been used|NONCE_EXPIRED|(max fee per gas|fee cap) less than block base fee|insufficient funds|intrinsic gas too low/i;

export class Executor {
  /** The wallet's next nonce once one of this executor's transactions settled: the wallet is
   * dedicated to one service, so it is read again only when in doubt. */
  private nonce: number | undefined;

  constructor(
    readonly client: PublicClient,
    readonly wallet: PrivateKeyAccount,
    readonly policy: GasPolicy,
    readonly state: Journal,
    readonly save: () => void | Promise<void>,
    readonly options: ExecutorOptions = {},
  ) {}

  private async settle(receipt: TransactionReceipt, pending: NonNullable<Journal["pending"]>) {
    this.state.spent = String(BigInt(this.state.spent) - BigInt(pending.charged) + cost(receipt));
    if (receipt.blockNumber > BigInt(this.state.lastBlock))
      this.state.lastBlock = String(receipt.blockNumber);
    this.nonce = pending.nonce + 1;
    delete this.state.pending;
    await this.save();
    if (receipt.status !== "success")
      throw new Error("Journaled transaction reverted on chain; state will be reread");
  }

  /** Drops a journaled transaction that can never be included, refunding its reserved cost. */
  private async abandon(pending: NonNullable<Journal["pending"]>) {
    this.state.spent = String(BigInt(this.state.spent) - BigInt(pending.charged));
    delete this.state.pending;
    this.nonce = undefined;
    await this.save();
  }

  /** The receipt of a broadcast transaction, read every `receiptPollMs` until it is included. */
  private async receipt(hash: Hex) {
    const every = this.options.receiptPollMs ?? 500;
    const until = Date.now() + 120_000;
    for (;;) {
      const receipt = await this.client.getTransactionReceipt({ hash }).catch(() => null);
      if (receipt) return receipt;
      if (Date.now() >= until)
        throw new Error("Transaction not included in time; it stays journaled");
      await new Promise((resolve) => setTimeout(resolve, every));
    }
  }

  async reconcilePending() {
    const pending = this.state.pending;
    if (!pending) return;
    const receipt = await this.client
      .getTransactionReceipt({ hash: pending.hash as Hex })
      .catch(() => null);
    if (receipt) return this.settle(receipt, pending);
    // Its nonce was consumed by another transaction: it can never land.
    if (
      (await this.client.getTransactionCount({
        address: this.wallet.address,
        blockTag: "latest",
      })) > pending.nonce
    )
      return this.abandon(pending);
    await this.client
      .sendRawTransaction({ serializedTransaction: pending.raw as Hex })
      .catch(() => undefined);
    throw new Error("Pending transaction unresolved; no new transaction will be signed");
  }

  /** Signs, journals, then broadcasts one transaction and waits for inclusion. Gas estimation
   * simulates it first; a reverting call is never signed. */
  async send(envelope: Pick<Envelope, "to" | "data">, cancel = false, guard = () => true) {
    if (!guard()) throw new Error("Execution reference expired or shutdown requested");
    if (this.state.pending) throw new Error("Resolve pending transaction before signing another");
    const today = new Date().toISOString().slice(0, 10);
    if (today < this.state.day) throw new Error("Clock rollback");
    if (today !== this.state.day) {
      this.state.day = today;
      this.state.spent = "0";
      await this.save();
    }
    const fees = await this.options.fees?.().catch(() => undefined);
    // A known nonce and shared fees leave gas estimation (the simulation) as the only read.
    const [request, balance] = await Promise.all([
      this.client.prepareTransactionRequest({
        account: this.wallet,
        chain: this.client.chain,
        to: envelope.to,
        data: envelope.data,
        ...(this.nonce === undefined ? {} : { nonce: this.nonce }),
        ...fees,
      }),
      this.client.getBalance({ address: this.wallet.address }),
    ]);
    request.gas += (request.gas * BigInt(this.options.gasHeadroomBps ?? 0)) / 10_000n;
    const charged = request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n);
    if (
      balance - charged < (cancel ? 0n : BigInt(this.policy.minGasWei)) ||
      (!cancel && BigInt(this.state.spent) + charged > BigInt(this.policy.dailyGasBudgetWei))
    )
      throw new Error("Gas budget or emergency reserve reached");
    if (!guard()) throw new Error("Execution reference expired during simulation");
    const raw = await this.wallet.signTransaction(request as never);
    const hash = keccak256(raw);
    // The hash is known before submission; an ambiguous send is never retried with new terms.
    const pending = { hash, nonce: request.nonce, raw, charged: String(charged) };
    this.state.pending = pending;
    this.state.spent = String(BigInt(this.state.spent) + charged);
    await this.save();
    const error = await this.client.sendRawTransaction({ serializedTransaction: raw }).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    // Only a certain rejection skips the wait; any other error may hide an accepted broadcast.
    if (
      error !== undefined &&
      REJECTED.test(error instanceof Error ? error.message : String(error))
    ) {
      await this.abandon(pending);
      throw new Error("The node rejected the transaction; it was dropped and will be re-planned");
    }
    await this.settle(await this.receipt(hash), pending);
    console.log(JSON.stringify({ event: cancel ? "cancelled" : "submitted", transaction: hash }));
  }
}
