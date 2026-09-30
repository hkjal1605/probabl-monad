import type { Envelope } from "@conditional-stocks/evm-client";
import { getAddress, type Hex, keccak256, type PublicClient, type TransactionReceipt } from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";

/** Gas limits of one signing service. */
export interface GasPolicy {
  /** Native gas balance kept for cancellations. */
  minGasWei: string;
  dailyGasBudgetWei: string;
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

export class Executor {
  constructor(
    readonly client: PublicClient,
    readonly wallet: PrivateKeyAccount,
    readonly policy: GasPolicy,
    readonly state: Journal,
    readonly save: () => void,
  ) {}

  private settle(receipt: TransactionReceipt) {
    const pending = this.state.pending!;
    this.state.spent = String(BigInt(this.state.spent) - BigInt(pending.charged) + cost(receipt));
    if (receipt.blockNumber > BigInt(this.state.lastBlock))
      this.state.lastBlock = String(receipt.blockNumber);
    delete this.state.pending;
    this.save();
    if (receipt.status !== "success")
      throw new Error("Journaled transaction reverted on chain; state will be reread");
  }

  async reconcilePending() {
    const pending = this.state.pending;
    if (!pending) return;
    const receipt = await this.client
      .getTransactionReceipt({ hash: pending.hash as Hex })
      .catch(() => null);
    if (receipt) return this.settle(receipt);
    // Its nonce was consumed by another transaction: it can never land.
    if (
      (await this.client.getTransactionCount({
        address: this.wallet.address,
        blockTag: "latest",
      })) > pending.nonce
    ) {
      this.state.spent = String(BigInt(this.state.spent) - BigInt(pending.charged));
      delete this.state.pending;
      this.save();
      return;
    }
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
      this.save();
    }
    const [request, balance] = await Promise.all([
      this.client.prepareTransactionRequest({
        account: this.wallet,
        chain: this.client.chain,
        to: envelope.to,
        data: envelope.data,
      }),
      this.client.getBalance({ address: this.wallet.address }),
    ]);
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
    this.state.pending = { hash, nonce: request.nonce, raw, charged: String(charged) };
    this.state.spent = String(BigInt(this.state.spent) + charged);
    this.save();
    await this.client.sendRawTransaction({ serializedTransaction: raw }).catch(() => undefined);
    this.settle(
      await this.client.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 500 }),
    );
    console.log(JSON.stringify({ event: cancel ? "cancelled" : "submitted", transaction: hash }));
  }
}
