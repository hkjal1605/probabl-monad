import type { Address } from "viem";
import {
  DELEGATE_CANCEL,
  DELEGATE_TRADE,
  MAX_FEE_BPS,
  MAX_GRANT_LIFETIME_SECONDS,
  type OrderWire,
  parseOrder,
  quote,
  U128_MAX,
} from "./protocol.ts";

export interface DelegateLimits {
  /** 0 grants every market of the deployment. */
  market: number;
  expiresAt: bigint;
  /** Buys spend their notional at the limit price (raw quote units); zero disables buys. */
  maxOrderQuote: bigint;
  totalQuote: bigint;
  /** Sells spend their quantity (raw base units of the market's stock); zero disables sells. */
  maxOrderBase: bigint;
  totalBase: bigint;
  maxFeeBps: number;
  permissions: number;
}

/** A grant as indexed from `DelegateApproved` plus consumption and revocation. */
export interface GrantState extends DelegateLimits {
  owner: Address;
  delegate: Address;
  epoch: bigint;
  generation: number;
  remainingQuote: bigint;
  remainingBase: bigint;
  revoked: boolean;
}

export function validateDelegateLimits(
  limits: DelegateLimits,
  now = BigInt(Math.floor(Date.now() / 1000)),
) {
  if (
    !Number.isInteger(limits.market) ||
    limits.market < 0 ||
    typeof limits.expiresAt !== "bigint" ||
    limits.expiresAt <= now ||
    limits.expiresAt - now > BigInt(MAX_GRANT_LIFETIME_SECONDS) ||
    limits.maxOrderQuote < 0n ||
    limits.maxOrderBase < 0n ||
    (limits.maxOrderQuote === 0n && limits.maxOrderBase === 0n) ||
    limits.totalQuote < limits.maxOrderQuote ||
    limits.totalQuote > U128_MAX ||
    limits.totalBase < limits.maxOrderBase ||
    limits.totalBase > U128_MAX ||
    !Number.isInteger(limits.maxFeeBps) ||
    limits.maxFeeBps < 0 ||
    limits.maxFeeBps > MAX_FEE_BPS ||
    ![DELEGATE_TRADE, DELEGATE_TRADE | DELEGATE_CANCEL].includes(limits.permissions)
  )
    throw new Error("Invalid trading delegation limits");
}

/** Mirrors the contract's authorization; on-chain enforcement is authoritative. Zero remaining
 * budget blocks new orders, not fills of already charged ones. */
export function activeDelegation(
  grant: GrantState,
  delegationEpoch: bigint,
  market: number,
  now: bigint,
  permission = DELEGATE_TRADE,
) {
  return (
    !grant.revoked &&
    grant.epoch === delegationEpoch &&
    now < grant.expiresAt &&
    (grant.permissions & permission) === permission &&
    (grant.market === 0 || grant.market === market)
  );
}

export function assertDelegatedOrder(
  order: OrderWire,
  grant: GrantState | undefined,
  delegationEpoch: bigint,
  now: bigint,
) {
  const o = parseOrder(order);
  if (!o.delegate) return;
  if (
    !grant ||
    grant.owner !== o.maker ||
    grant.delegate !== o.delegate ||
    !activeDelegation(grant, delegationEpoch, Number(o.marketId), now) ||
    BigInt(o.expiry) > grant.expiresAt ||
    o.maxFeeBps > grant.maxFeeBps
  )
    throw new Error("Trading delegation is missing, inactive or outside its permissions");
  // A sell spends the base budget by quantity, a buy the quote budget by notional.
  const [cost, perOrder, remaining] =
    o.side === 1
      ? [BigInt(o.quantity), grant.maxOrderBase, grant.remainingBase]
      : [
          quote(BigInt(o.quantity), BigInt(o.limitPriceRawX18), true),
          grant.maxOrderQuote,
          grant.remainingQuote,
        ];
  if (cost > perOrder || cost > remaining)
    throw new Error("Delegated order exceeds its trading allowance");
}
