/** Fail-closed checks of the replica: its own conservation laws, then equality with on-chain
 * storage (pool liabilities, token custody, and every market's book, backing and fees). */
import { conditionalStocksAbi } from "@conditional-stocks/evm-client";
import type { ChainState } from "@conditional-stocks/evm-client/ledger";
import { type Address, erc20Abi, type PublicClient } from "viem";

export interface Reconciliation {
  healthy: boolean;
  block: string;
  checkedAt: number;
  pools: number;
  markets: number;
  issues: string[];
}

const up = (quantity: bigint, price: bigint) => (quantity * price + 10n ** 18n - 1n) / 10n ** 18n;

/** Ledger identities that hold for every state the contract can reach. */
export function ledgerIssues(s: ChainState): string[] {
  const issues: string[] = [];
  const liability = new Map<Address, bigint>();
  const add = (token: Address, amount: bigint) =>
    liability.set(token, (liability.get(token) ?? 0n) + amount);
  for (const [key, amount] of s.credits) {
    if (amount < 0n) issues.push(`negative credit ${key}`);
    add(key.split(":")[1] as Address, amount);
  }
  const claims = new Map<number, bigint[]>(); // [quoteYes, quoteNo, baseYes, baseNo]
  const notional = new Map<number, bigint>();
  const walletNotional = new Map<number, bigint>();
  const orderNotional = new Map<number, bigint>();
  for (const m of s.markets.values()) {
    add(s.quote, m.backing.quote);
    add(m.base, m.backing.base);
    claims.set(m.id, [m.fees[0].quote, m.fees[1].quote, m.fees[0].base, m.fees[1].base]);
    notional.set(m.id, 0n);
    orderNotional.set(m.id, 0n);
    walletNotional.set(m.id, 0n);
  }
  for (const [key, a] of s.accounts) {
    const [market, branch] = key.split(":").map(Number) as [number, number];
    const c = claims.get(market);
    if (!c || a.quote < 0n || a.base < 0n || a.notional < 0n) {
      issues.push(`invalid account ${key}`);
      continue;
    }
    c[branch]! += a.quote;
    c[2 + branch]! += a.base;
    walletNotional.set(market, walletNotional.get(market)! + a.notional);
  }
  for (const o of s.orders.values()) {
    if (o.status !== "open") continue;
    const m = s.markets.get(o.market)!;
    const price = o.ticks * m.tick;
    const reserved = o.side === 0 ? up(o.remaining, price) : o.remaining;
    if (o.fundingKind === 0) add(o.side === 0 ? s.quote : m.base, reserved);
    else claims.get(o.market)![(o.side === 0 ? 0 : 2) + o.branch]! += reserved;
    orderNotional.set(o.market, orderNotional.get(o.market)! + up(o.remaining, price));
    // The market's open notional (its cap) counts resting bids only.
    if (o.side === 0) notional.set(o.market, notional.get(o.market)! + up(o.remaining, price));
  }
  for (const [token, pool] of s.pools)
    if ((liability.get(token) ?? 0n) !== pool.liability)
      issues.push(`pool liability mismatch ${token}`);
  for (const m of s.markets.values()) {
    const [quoteYes, quoteNo, baseYes, baseNo] = claims.get(m.id)!;
    if (!m.payouts && (quoteYes !== m.backing.quote || quoteNo !== m.backing.quote))
      issues.push(`quote claims differ from backing in market ${m.id}`);
    if (!m.payouts && (baseYes !== m.backing.base || baseNo !== m.backing.base))
      issues.push(`base claims differ from backing in market ${m.id}`);
    if (
      notional.get(m.id) !== m.openNotional ||
      walletNotional.get(m.id) !== orderNotional.get(m.id)
    )
      issues.push(`open notional mismatch in market ${m.id}`);
  }
  return issues;
}

/** Compares the replica with on-chain storage at its block: every pool, and `only` the given
 * markets (all when omitted). `marketIssues` lists the markets that differ. */
export async function reconcile(
  client: PublicClient,
  exchange: Address,
  s: ChainState,
  only?: Iterable<number>,
): Promise<Reconciliation & { marketIssues: Map<number, string> }> {
  // Capture the replica synchronously: the live view keeps advancing while reads are in flight.
  const blockNumber = s.block;
  const issues = ledgerIssues(s);
  const marketIssues = new Map<number, string>();
  const pools = [...s.pools].map(([token, pool]) => ({ token, liability: pool.liability }));
  const selected = only
    ? [...new Set(only)].flatMap((id) => {
        const m = s.markets.get(id);
        return m ? [m] : [];
      })
    : [...s.markets.values()];
  const markets = selected.map((m) => ({
    id: m.id,
    expected: [
      m.openNotional,
      m.seq[0],
      m.seq[1],
      m.backing.quote,
      m.backing.base,
      m.fees[0].quote,
      m.fees[0].base,
      m.fees[1].quote,
      m.fees[1].base,
    ],
  }));
  const read = (functionName: string, args: unknown[]) =>
    client.readContract({
      address: exchange,
      abi: conditionalStocksAbi,
      functionName,
      args,
      blockNumber,
    } as never) as Promise<Record<string, bigint | number>>;
  await Promise.all([
    ...pools.map(async ({ token, liability }) => {
      const [onchain, balance] = await Promise.all([
        read("pool", [token]),
        client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [exchange],
          blockNumber,
        }),
      ]);
      if (BigInt(onchain.liability!) !== liability)
        issues.push(`replica pool liability differs ${token}`);
      if (balance < liability) issues.push(`custody shortfall ${token}`);
    }),
    ...markets.map(async ({ id, expected }) => {
      const [book, backing, yes, no] = await Promise.all([
        read("book", [id]),
        read("backing", [id]),
        read("fees", [id, 0]),
        read("fees", [id, 1]),
      ]);
      const actual = [
        book.openNotional,
        book.seqYes,
        book.seqNo,
        backing.quote,
        backing.base,
        yes.quote,
        yes.base,
        no.quote,
        no.base,
      ].map((v) => BigInt(v!));
      if (actual.some((value, i) => value !== expected[i]))
        marketIssues.set(id, `replica market ${id} differs from chain`);
    }),
  ]);
  issues.push(...marketIssues.values());
  return {
    healthy: issues.length === 0,
    block: blockNumber.toString(),
    checkedAt: Date.now(),
    pools: pools.length,
    markets: markets.length,
    issues,
    marketIssues,
  };
}
