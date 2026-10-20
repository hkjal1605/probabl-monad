import type { Address } from "viem";

const queues = new Map<Address, Promise<unknown>>();

/** Runs `send` once the account's earlier sends in this process have settled. Jobs run
 * concurrently and share wallets (the market admin, often also the curator), and a send reads
 * its nonce from the chain, so two in flight would take the same one. */
export function inTurn<T>(account: Address, send: () => Promise<T>): Promise<T> {
  const run = (queues.get(account) ?? Promise.resolve()).then(send);
  queues.set(
    account,
    run.catch(() => undefined),
  );
  return run;
}
