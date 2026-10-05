import {
  assertDelegatedOrder,
  type Candidate,
  type OrderWire,
  parseOrder,
  planOrder,
  quote,
} from "@conditional-stocks/evm-client";
import {
  accountOf,
  type ChainState,
  grantKey,
  traderOf,
} from "@conditional-stocks/evm-client/ledger";
import { type IndexerService, liveOrder } from "@conditional-stocks/indexer";

/** Plans an order against the confirmed replica (no RPC, no database). The contract enforces
 * every rule again; these checks give actionable errors before a wallet prompt. */
export function createOrderPlan(indexer: IndexerService) {
  return (input: OrderWire, snapshot?: ChainState) => {
    const order = parseOrder(input);
    const s = snapshot ?? indexer.trading();
    const m = s.markets.get(Number(order.marketId));
    if (!m) throw new Error("Unknown market");
    const now = BigInt(Math.floor(Date.now() / 1000));
    const q = BigInt(order.quantity),
      p = BigInt(order.limitPriceRawX18),
      notional = quote(q, p, true);
    if (
      s.config.paused ||
      m.state !== 2 ||
      now < m.open ||
      now >= m.cutoff ||
      BigInt(order.expiry) <= now ||
      BigInt(order.expiry) > m.cutoff
    )
      throw new Error("Market or order is not currently tradable");
    if (
      q % m.step !== 0n ||
      p % m.tick !== 0n ||
      q > m.step * m.maxSteps ||
      notional < m.minNotional ||
      notional > m.maxOrder
    )
      throw new Error("Order violates market terms");
    if (indexer.tokens.live.get(m.base)?.paused)
      throw new Error(
        "The stock token issuer has paused transfers; trading is halted for this market",
      );
    if (order.delegate)
      assertDelegatedOrder(
        order,
        s.grants.get(grantKey(order.maker, order.delegate)),
        traderOf(s, order.maker).delegationEpoch,
        now,
      );
    const candidates: Candidate[] = [];
    for (const o of s.orders.values())
      if (
        o.market === m.id &&
        o.branch === order.branch &&
        o.side !== order.side &&
        liveOrder(o, s, now)
      )
        candidates.push({
          key: o.key,
          sequence: o.seq,
          remaining: o.remaining,
          order: {
            maker: o.owner,
            marketId: String(o.market),
            quantity: o.quantity.toString(),
            limitPriceRawX18: (o.ticks * m.tick).toString(),
            expiry: o.expiry.toString(),
            maxFeeBps: o.maxFeeBps,
            branch: o.branch,
            side: o.side,
            fundingKind: o.fundingKind,
            tif: 0,
          },
        });
    const plan = planOrder({
      order,
      candidates,
      now,
      step: m.step,
      nextSequence: m.seq[order.branch]!,
      makerFeeBps: m.makerBps,
      takerFeeBps: m.takerBps,
    });
    // A resting remainder counts toward the wallet cap, and a resting bid toward the market cap.
    if (order.tif === 0 && BigInt(plan.remainingQuantity) > 0n) {
      const resting = quote(BigInt(plan.remainingQuantity), p, true);
      const wallet =
        accountOf(s, m.id, 0, order.maker).notional +
        accountOf(s, m.id, 1, order.maker).notional +
        resting;
      if (wallet > m.maxWallet || (order.side === 0 && m.openNotional + resting > m.maxMarket))
        throw new Error("The resting order would exceed a wallet or market open-order cap");
    }
    return {
      order,
      notional: notional.toString(),
      plan,
      block: s.block.toString(),
      exchange: indexer.options.exchange,
      executionVersion: 1,
    };
  };
}
export type OrderPlanner = ReturnType<typeof createOrderPlan>;
