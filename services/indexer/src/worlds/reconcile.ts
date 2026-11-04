/** Fail-closed checks of the world replica: its own identities (`worldLedgerIssues`), then
 * equality with on-chain storage at the replica's block — the books' liability, fees and token
 * custody, `only` the given books (all when omitted) and every followed vault. */
import { deploylessMulticall, worldBooksAbi, worldVaultAbi } from "@conditional-stocks/evm-client";
import {
  type WorldState,
  worldCreditOf,
  worldLedgerIssues,
} from "@conditional-stocks/evm-client/world-ledger";
import { erc20Abi, type PublicClient } from "viem";

export interface WorldReconciliation {
  healthy: boolean;
  block: string;
  checkedAt: number;
  books: number;
  vaults: number;
  issues: string[];
}

export async function reconcileWorlds(
  client: PublicClient,
  s: WorldState,
  only?: Iterable<number>,
): Promise<WorldReconciliation & { bookIssues: Map<number, string> }> {
  // Captured synchronously: the live replica keeps advancing while reads are in flight.
  const blockNumber = s.block;
  const issues = worldLedgerIssues(s);
  const bookIssues = new Map<number, string>();
  const { books: address, quote } = s.deployment;
  const selected = only
    ? [...new Set(only)].flatMap((id) => {
        const b = s.books.get(id);
        return b ? [b] : [];
      })
    : [...s.books.values()];
  const vaults = [...s.vaults.values()];
  const books = (functionName: string, args: unknown[] = []) => ({
    address,
    abi: worldBooksAbi,
    functionName,
    args,
  });
  const vault = (v: (typeof vaults)[number], functionName: string, args: unknown[] = []) => ({
    address: v.address,
    abi: worldVaultAbi,
    functionName,
    args,
  });
  const calls = [
    books("liability"),
    books("fees"),
    { address: quote, abi: erc20Abi, functionName: "balanceOf", args: [address] },
    ...selected.flatMap((b) => [books("backing", [b.id]), books("book", [b.id])]),
    ...vaults.flatMap((v) => [
      vault(v, "totals"),
      vault(v, "quoteEpoch"),
      vault(v, "refNav"),
      vault(v, "batches"),
      vault(v, "totalSupply"),
      vault(v, "held"),
      ...[...v.positions.keys()].map((book) => vault(v, "position", [book])),
    ]),
  ];
  const results = (await deploylessMulticall(client, calls, { blockNumber })) as unknown[];
  let at = 0;
  const next = <T>() => results[at++] as T;
  const liability = next<bigint>(),
    fees = next<bigint>(),
    balance = next<bigint>();
  if (BigInt(liability) !== s.liability) issues.push("replica liability differs from chain");
  if (BigInt(fees) !== s.fees) issues.push("replica fees differ from chain");
  if (BigInt(balance) < s.liability) issues.push("custody shortfall on the world books");
  for (const b of selected) {
    const backing = BigInt(next<bigint>());
    const view = next<Record<string, unknown>>();
    if (
      backing !== b.backing ||
      Number(view.status) !== b.status ||
      Number(view.winner) !== b.winner ||
      Boolean(view.frozen) !== b.frozen ||
      Boolean(view.held) !== b.held ||
      Number(view.atomCount) !== b.atoms
    )
      bookIssues.set(b.id, `replica book ${b.id} differs from chain`);
  }
  for (const v of vaults) {
    const totals = next<readonly bigint[]>();
    const epoch = BigInt(next<bigint>()),
      refNav = BigInt(next<bigint>());
    const batches = next<readonly (number | bigint)[]>();
    const supply = BigInt(next<bigint>());
    const held = next<readonly bigint[]>();
    if (
      BigInt(totals[0]!) !== worldCreditOf(s, v.address) ||
      BigInt(totals[1]!) !== v.sumLo ||
      BigInt(totals[2]!) !== v.sumHi ||
      epoch !== v.quoteEpoch ||
      refNav !== v.refNav ||
      Number(batches[0]) !== v.batchId ||
      Number(batches[1]) !== v.closedBatch ||
      supply !== v.totalSupply ||
      BigInt(held[0]!) !== v.pendingAssets ||
      BigInt(held[1]!) !== v.owedAssets ||
      BigInt(held[2]!) !== v.escrowShares
    )
      issues.push(`replica vault ${v.address} differs from chain`);
    for (const [book, p] of v.positions) {
      const onchain = next<Record<string, bigint>>();
      if (
        BigInt(onchain.lo!) !== p.lo ||
        BigInt(onchain.hi!) !== p.hi ||
        BigInt(onchain.cost!) !== p.cost
      )
        issues.push(`replica vault ${v.address} position ${book} differs from chain`);
    }
  }
  issues.push(...bookIssues.values());
  return {
    healthy: issues.length === 0,
    block: blockNumber.toString(),
    checkedAt: Date.now(),
    books: selected.length,
    vaults: vaults.length,
    issues,
    bookIssues,
  };
}
