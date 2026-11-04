/** A fill's effect, simulated on the world replica exactly as `WorldBooks` and the world vault's
 * `onWorldFill` hook compute it: what the maker delivers and receives, whether both sides can
 * pay, and every condition the vault's hook checks on the balances after it. The API refuses a
 * quote that would revert before awarding it, and the keeper never signs one; on-chain checks
 * stay authoritative. */
import { type Address, zeroAddress } from "viem";
import {
  atomsOf,
  type BookState,
  bookStateAt,
  eventOf,
  positionRisk,
  type VaultPosition,
  type VaultState,
  type WorldState,
  worldCreditOf,
} from "./world-ledger.ts";
import {
  BOOK_STATE,
  type Bundle,
  bundlePays,
  payRange,
  unpackMakerData,
  WORLD_VAULT_ROLES,
  type WorldQuote,
  worldFee,
} from "./worlds.ts";

/** What one fill moves: the maker's atoms and credit after it (auto-merge included), the
 * taker's atoms, the full sets the maker splits and merges, and the fee. */
export interface FillEffect {
  makerAtoms: bigint[];
  makerCredit: bigint;
  takerAtoms: bigint[];
  takerCredit: bigint;
  split: bigint;
  merged: bigint;
  fee: bigint;
  minPay: bigint;
  maxPay: bigint;
}

/** `_takerBuys` / `_takerSells` on the replica, or why the books would revert. */
export function simulateFill(
  s: WorldState,
  b: BookState,
  maker: Address,
  q: Pick<WorldQuote, "taker" | "mask" | "units" | "refund" | "sell" | "price">,
  /** Whether to check the taker's side too (a maker pricing its own side need not). */
  options: { taker?: boolean } = {},
): FillEffect | { problem: string } {
  const checkTaker = options.taker !== false;
  const bundle: Bundle = { mask: q.mask, units: q.units, refund: q.refund };
  const count = b.atoms;
  const { minPay, maxPay } = payRange(bundle, count);
  const fee = worldFee(q.price, b.def.feeBps);
  const m = [...atomsOf(s, b.id, maker)],
    t = [...atomsOf(s, b.id, q.taker)];
  let makerCredit = worldCreditOf(s, maker),
    takerCredit = worldCreditOf(s, q.taker);
  let split = 0n,
    merged = 0n;
  if (!q.sell) {
    if (checkTaker && takerCredit < q.price + fee)
      return { problem: "The taker's credit does not cover the price and fee" };
    takerCredit -= q.price + fee;
    makerCredit += q.price;
    for (let i = 0; i < count; i++) {
      const need = bundlePays(bundle, i);
      if (need - m[i]! > split) split = need - m[i]!;
    }
    if (makerCredit < split) return { problem: "The maker cannot fund the sets it must split" };
    makerCredit -= split;
    let sets: bigint | null = null;
    for (let i = 0; i < count; i++) {
      const need = bundlePays(bundle, i);
      m[i] = m[i]! + split - need;
      if (sets === null || m[i]! < sets) sets = m[i]!;
      t[i]! += need;
    }
    merged = sets ?? 0n;
  } else {
    let sets: bigint | null = null;
    for (let i = 0; i < count; i++) {
      const need = bundlePays(bundle, i);
      if (checkTaker && t[i]! < need) return { problem: "The taker does not hold the bundle" };
      t[i]! -= need;
      m[i]! += need;
      if (sets === null || m[i]! < sets) sets = m[i]!;
    }
    merged = sets ?? 0n;
    if (makerCredit + merged < q.price) return { problem: "The maker cannot pay the price" };
    takerCredit += q.price - fee;
  }
  if (merged) for (let i = 0; i < count; i++) m[i]! -= merged;
  if (q.sell) makerCredit = makerCredit + merged - q.price;
  else makerCredit += merged;
  return {
    makerAtoms: m,
    makerCredit,
    takerAtoms: t,
    takerCredit,
    split,
    merged,
    fee,
    minPay,
    maxPay,
  };
}

/** Why `WorldBooks._fill` would refuse `q` from `maker` now (null when it would not), short of
 * the signature and nonce: pause, expiry, the bundle and its price, the book's state, a
 * self-trade, the fee cap and budget of a delegate, and both sides' funds. */
export function fillProblem(
  s: WorldState,
  q: WorldQuote,
  maker: Address,
  now: bigint,
  delegate?: Address,
): string | null {
  if (s.config.paused) return "The world books are paused";
  if (q.expiry <= now) return "The quote expired";
  const b = s.books.get(Number(q.book));
  if (!b) return "Unknown book";
  const { minPay, maxPay } = payRange(q, b.atoms);
  if (
    q.mask & 1 ||
    q.mask >> b.atoms ||
    (q.mask === 0) !== (q.units === 0n) ||
    (q.mask === 0 && q.refund === 0n) ||
    q.price <= 0n ||
    q.price < minPay ||
    q.price > maxPay
  )
    return "Invalid bundle or price";
  if (bookStateAt(s, b, now) !== BOOK_STATE.trading) return "The book is not trading";
  if (maker === q.taker || (delegate && maker === delegate)) return "Self trade";
  if (delegate) {
    const g = s.grants.get(`${q.taker}:${delegate}`);
    const permission = q.sell ? 2 : 1;
    if (
      !g ||
      !(g.permissions & permission) ||
      g.revoked ||
      g.epoch !== (s.delegationEpochs.get(q.taker) ?? 0n) ||
      now >= g.expiresAt
    )
      return "The taker's trading permission is inactive";
    if (b.def.feeBps > g.maxFeeBps) return "The book's fee exceeds the permission's fee cap";
    const cost = q.sell ? maxPay : q.price + worldFee(q.price, b.def.feeBps);
    const [cap, remaining] = q.sell ? [g.maxSell, g.remainingSell] : [g.maxBuy, g.remainingBuy];
    if (cost > cap || cost > remaining) return "The trade exceeds the trading permission's budget";
  }
  const effect = simulateFill(s, b, maker, q);
  return "problem" in effect ? effect.problem : null;
}

/** The vault's position in a book after a fill with `effect`: its new lowest and highest atom
 * and cost (the credit it put in). */
export function positionAfter(
  v: VaultState,
  book: number,
  creditBefore: bigint,
  effect: Pick<FillEffect, "makerAtoms" | "makerCredit">,
): VaultPosition {
  const before = v.positions.get(book) ?? { lo: 0n, hi: 0n, cost: 0n };
  let lo = effect.makerAtoms[0]!,
    hi = effect.makerAtoms[0]!;
  for (const a of effect.makerAtoms) {
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  return { lo, hi, cost: before.cost + (creditBefore - effect.makerCredit) };
}

/** What a vault fill does to its caps: the book's risk before and after, each leg's risk after,
 * the exposure the fill spends, and the guaranteed value before and after. */
export function vaultFillImpact(
  s: WorldState,
  v: VaultState,
  b: BookState,
  effect: FillEffect,
  sell: boolean,
  price: bigint,
) {
  const creditBefore = worldCreditOf(s, v.address);
  const before = v.positions.get(b.id) ?? { lo: 0n, hi: 0n, cost: 0n };
  const after = positionAfter(v, b.id, creditBefore, effect);
  const oldRisk = positionRisk(before),
    newRisk = positionRisk(after);
  const legRisk = b.def.legs.map((l) => (v.legRisk.get(l.eventKey) ?? 0n) - oldRisk + newRisk);
  return {
    before,
    after,
    oldRisk,
    newRisk,
    legRisk,
    exposure: sell ? price - effect.minPay : effect.maxPay - price,
    guaranteedBefore: creditBefore + v.sumLo,
    guaranteedAfter: effect.makerCredit + v.sumLo - before.lo + after.lo,
  };
}

/** Why the world vault's `onWorldFill` would refuse `q` (null when it would accept), from the
 * replica: the signer's role and epoch, the signing time and lifetime, size and price caps, the
 * margin, a leg resolved since signing, the day's exposure, eligibility and the risk caps when
 * risk grows, and the loss floor when the guaranteed value falls. `signer` is the recovered
 * signer of the quote. */
export function vaultHookProblem(
  s: WorldState,
  v: VaultState,
  q: WorldQuote,
  signer: Address,
  now: bigint,
  /** Whether to check the taker's funds too (the keeper leaves that to the API). */
  options: { taker?: boolean } = {},
): string | null {
  if (v.paused) return "The vault is paused";
  const keepers = v.roles.get(WORLD_VAULT_ROLES.keeper) ?? [];
  if (!keepers.includes(signer)) return "QuoteSigner: not signed by a keeper";
  const { epoch, signedAt } = unpackMakerData(q.makerData);
  if (epoch !== (v.quoteEpoch & 0xffffffn)) return "QuoteEpoch: a stale quote epoch";
  const l = v.limits,
    k = v.risk;
  if (!l || !k) return "The vault has no limits";
  const b = s.books.get(Number(q.book));
  if (!b) return "Unknown book";
  if (
    signedAt > now ||
    q.expiry > signedAt + BigInt(l.maxTtl) ||
    q.expiry + BigInt(l.cutoffBuffer) > BigInt(b.def.cutoff)
  )
    return "QuoteExpiry: outside the quote's lifetime";
  const { minPay, maxPay } = payRange(q, b.atoms);
  if (maxPay > k.maxQuoteSize || q.price > k.maxQuotePrice) return "QuoteSize: over the size caps";
  const margin = ((maxPay - minPay) * BigInt(l.marginBps)) / 10_000n;
  if (q.sell ? q.price > maxPay - margin : q.price < minPay + margin)
    return "QuotePrice: inside the margin";
  for (const leg of b.def.legs) {
    const e = eventOf(s, leg.eventKey);
    if (e.resolvedAt !== 0n && e.resolvedAt >= signedAt)
      return "LegJustResolved: a leg resolved after signing";
  }
  const effect = simulateFill(s, b, v.address, q, options);
  if ("problem" in effect) return effect.problem;
  const impact = vaultFillImpact(s, v, b, effect, q.sell, q.price);
  const today = now / 86_400n;
  const used = (v.day.day === today ? v.day.used : 0n) + impact.exposure;
  if (used > (v.refNav * BigInt(k.maxDailyExposureBps)) / 10_000n)
    return "DailyExposure: over the day's exposure budget";
  if (impact.newRisk > impact.oldRisk) {
    const decision = b.def.feed === zeroAddress ? b.def.cutoff : b.def.fixingTime;
    if (
      b.def.legs.length > l.maxLegs ||
      b.def.feeBps > l.maxFeeBps ||
      (b.def.feed === zeroAddress ? !l.eventOnly : !v.feeds.includes(b.def.feed)) ||
      BigInt(decision) > now + BigInt(l.maxTenor)
    )
      return "IneligibleBook: the book is not eligible for new risk";
    if (impact.newRisk > k.maxBookRisk) return "BookRisk: over the book's risk cap";
    if (impact.legRisk.some((r) => r > k.maxLegRisk)) return "LegRisk: over a leg's risk cap";
  }
  const floor = v.refNav - (v.refNav * BigInt(k.maxLossBps)) / 10_000n;
  if (impact.guaranteedAfter < impact.guaranteedBefore && impact.guaranteedAfter < floor)
    return "LossCap: under the loss floor";
  return null;
}
