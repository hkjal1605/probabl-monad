/** Read models of the world replica: books, positions, vaults and fixings, as the `/v2` routes
 * serve them. Amounts are decimal strings of raw quote units; probabilities and per-unit prices
 * are x 1e6. Nothing here reads the chain or the database. */
import type { WorldBookRecord } from "@conditional-stocks/db";
import {
  BOOK_STATE,
  BOOK_STATE_NAMES,
  EVENT_STATE,
  holdingLayers,
  NAV_SCALE,
  productKey,
  standardProducts,
  WORLD_VAULT_ROLES,
} from "@conditional-stocks/evm-client";
import {
  atomsOf,
  type BookState,
  bookStateAt,
  eventOf,
  fixingWindow,
  positionRisk,
  type VaultState,
  vaultTotals,
  type WorldState,
  winningAtom,
  worldCreditOf,
} from "@conditional-stocks/evm-client/world-ledger";
import { type Address, getAddress, type Hex, zeroAddress } from "viem";

/** Indicative bid and ask of one product per unit (x 1e6), from the makers online. */
export interface ProductPrice {
  bid: number | null;
  ask: number | null;
  at: number;
}
/** A book's indications: each standard product's prices by product key, and the chance of
 * each atom (x 1e6, summing to a million) a maker marks the book at. */
export interface BookQuotes {
  products: Map<string, ProductPrice>;
  marks: number[] | null;
  at: number;
}
export type BookPrices = (book: number) => BookQuotes | undefined;

const EVENT_NAMES: Record<number, string> = {
  [EVENT_STATE.unknown]: "open",
  [EVENT_STATE.frozen]: "frozen",
  [EVENT_STATE.committed]: "resolving",
  [EVENT_STATE.yes]: "yes",
  [EVENT_STATE.no]: "no",
  [EVENT_STATE.invalid]: "invalid",
};
const str = (v: bigint) => v.toString();
/** A raw feed answer as a decimal string with the feed's decimals. */
export function feedDecimal(raw: bigint, decimals: number | null) {
  if (decimals === null || decimals === 0) return raw.toString();
  const scale = 10n ** BigInt(decimals);
  const fraction = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${raw / scale}.${fraction}` : `${raw / scale}`;
}

/** One leg as a book view shows it: its oracle state and, from the book's metadata, the venue
 * event it follows. */
function legView(s: WorldState, b: BookState, i: number, meta: WorldBookRecord | undefined) {
  const leg = b.def.legs[i]!;
  const e = eventOf(s, leg.eventKey);
  const resolved = e.state >= EVENT_STATE.yes;
  const failed =
    e.state === EVENT_STATE.invalid ||
    (e.state === EVENT_STATE.yes && !leg.wantYes) ||
    (e.state === EVENT_STATE.no && leg.wantYes);
  const venue = meta?.metadata.legs.find((l) => l.eventKey.toLowerCase() === leg.eventKey);
  return {
    eventKey: leg.eventKey,
    wantYes: leg.wantYes,
    state: EVENT_NAMES[e.state] ?? "open",
    outcome: resolved ? (failed ? "failed" : "passed") : null,
    resolvedAt: e.resolvedAt ? str(e.resolvedAt) : null,
    evidence: e.evidence,
    evidenceUri: e.uri,
    venue: venue
      ? {
          source: venue.source,
          marketId: venue.marketId,
          conditionId: venue.conditionId,
          yesIndex: venue.yesIndex,
          noIndex: venue.noIndex,
          question: venue.question,
          url: venue.url,
          endTime: venue.endTime,
          themes: venue.themes ?? [],
        }
      : null,
  };
}

/** A book's standard products with their atom masks and indicative prices. */
export function productsOf(b: BookState, prices: BookPrices | undefined) {
  const quoted = prices?.(b.id)?.products;
  return standardProducts(b.def).map((p) => {
    const price = quoted?.get(p.key);
    return {
      key: p.key,
      kind: p.kind,
      outcome: p.outcome,
      mask: p.mask,
      bid: price?.bid ?? null,
      ask: price?.ask ?? null,
      pricedAt: price?.at ?? null,
    };
  });
}

/** Everything a book's page reads. */
export function bookView(
  s: WorldState,
  b: BookState,
  meta: WorldBookRecord | undefined,
  now: bigint,
  prices?: BookPrices,
) {
  const state = bookStateAt(s, b, now);
  const decimals = meta?.metadata.feedDecimals ?? null;
  const window = fixingWindow(s, b, now);
  const winner = winningAtom(s, b, now);
  return {
    id: b.id,
    defHash: b.defHash,
    title: meta?.title ?? null,
    kind: meta?.kind ?? null,
    state: BOOK_STATE_NAMES[state] ?? "unknown",
    stateCode: state,
    /** The pause stops every book's fills. */
    paused: s.config.paused,
    tradable: state === BOOK_STATE.trading && !s.config.paused,
    eventOnly: b.def.feed === zeroAddress,
    legs: b.def.legs.map((_, i) => legView(s, b, i, meta)),
    underlying: meta?.metadata.underlying ?? null,
    feed: b.def.feed === zeroAddress ? null : b.def.feed,
    feedDecimals: decimals,
    fixingRule: meta?.metadata.fixing ?? null,
    fixingTime: b.def.fixingTime ? String(b.def.fixingTime) : null,
    maxStaleness: b.def.maxStaleness,
    cutoff: String(b.def.cutoff),
    feeBps: b.def.feeBps,
    strikes: b.def.strikes.map((raw) => ({ raw: str(raw), price: feedDecimal(raw, decimals) })),
    atoms: b.atoms,
    metadataUri: b.metadataUri,
    backing: str(b.backing),
    winner,
    decidedAt: b.decidedAt === null ? null : str(b.decidedAt),
    fixing: {
      proposal: b.fix
        ? {
            price: str(b.fix.price),
            display: feedDecimal(b.fix.price, decimals),
            updatedAt: str(b.fix.updatedAt),
            proposedAt: str(b.fix.proposedAt),
            roundId: str(b.fix.roundId),
          }
        : null,
      held: b.held,
      commitment: b.fixCommitment,
      price: b.fixedPrice === null ? null : str(b.fixedPrice),
      display: b.fixedPrice === null ? null : feedDecimal(b.fixedPrice, decimals),
      evidence: b.fixEvidence,
      evidenceUri: b.fixUri,
      awaitingSince: window ? str(window.since) : null,
      fallbackAt: window ? str(window.fallbackAt) : null,
    },
    fills: b.fills,
    volume: str(b.volume),
    fees: str(b.fees),
    createdAt: str(b.createdAt),
    createdTx: b.createdTx,
    products: productsOf(b, prices),
    marks: prices?.(b.id)?.marks ?? null,
  };
}
export type BookView = ReturnType<typeof bookView>;

/** One holder's position in one book: its atoms, layered into products, what it pays at
 * worst and best, what it is worth at a maker's marks (or its payout once decided), and what it
 * redeems for. */
export function positionView(
  s: WorldState,
  b: BookState,
  balances: bigint[],
  now: bigint,
  prices?: BookPrices,
) {
  const { sets, refund, layers } = holdingLayers(balances);
  let lo = balances[0]!,
    hi = balances[0]!;
  for (const v of balances) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const winner = winningAtom(s, b, now);
  const marks = prices?.(b.id)?.marks;
  let marked: bigint | null = null;
  if (marks && marks.length === balances.length) {
    marked = 0n;
    for (let i = 0; i < balances.length; i++) marked += balances[i]! * BigInt(marks[i]!);
    marked /= 1_000_000n;
  }
  const parts = layers.map((layer) => ({
    mask: layer.mask,
    units: str(layer.units),
    outcome: layer.outcome,
    product: layer.outcome ? productKey(refund ? "conditional" : "world-bet", layer.outcome) : null,
  }));
  const state = bookStateAt(s, b, now);
  return {
    book: b.id,
    state: BOOK_STATE_NAMES[state] ?? "unknown",
    atoms: balances.map(str),
    sets: str(sets),
    refund: str(refund),
    layers: parts,
    minPayout: str(lo),
    maxPayout: str(hi),
    value: winner !== null ? str(balances[winner]!) : marked === null ? null : str(marked),
    redeemable: winner !== null && balances.some((v) => v > 0n),
    payout: winner === null ? null : str(balances[winner]!),
  };
}

/** Every book `owner` holds atoms of. */
export function positionsOf(s: WorldState, owner: Address, now: bigint, prices?: BookPrices) {
  const out: ReturnType<typeof positionView>[] = [];
  for (const b of s.books.values()) {
    const balances = atomsOf(s, b.id, owner);
    if (balances.some((v) => v > 0n)) out.push(positionView(s, b, balances, now, prices));
  }
  return out;
}

/** A vault's state: values, positions and their risk, caps and what they leave, batches. */
export function vaultView(s: WorldState, v: VaultState, now: bigint) {
  const totals = vaultTotals(s, v);
  const risk = v.risk;
  const budget = risk ? (v.refNav * BigInt(risk.maxDailyExposureBps)) / 10_000n : 0n;
  const today = now / 86_400n;
  const used = v.day.day === today ? v.day.used : 0n;
  const floor = risk ? v.refNav - (v.refNav * BigInt(risk.maxLossBps)) / 10_000n : 0n;
  let atRisk = 0n;
  const positions = [...v.positions].map(([book, p]) => {
    const r = positionRisk(p);
    atRisk += r;
    return { book, lo: str(p.lo), hi: str(p.hi), cost: str(p.cost), risk: str(r) };
  });
  positions.sort((a, b) => (BigInt(b.risk) > BigInt(a.risk) ? 1 : -1));
  const legRisk = [...v.legRisk]
    .map(([eventKey, r]) => ({ eventKey, risk: str(r) }))
    .sort((a, b) => (BigInt(b.risk) > BigInt(a.risk) ? 1 : -1));
  const batch = (id: number) => {
    const bt = v.batches.get(id);
    return bt
      ? {
          id: bt.id,
          status: ["", "open", "closed", "processed"][bt.status] ?? "unknown",
          depositAssets: str(bt.depositAssets),
          redeemShares: str(bt.redeemShares),
          guaranteed: str(bt.guaranteed),
          best: str(bt.best),
          supply: str(bt.supply),
          nav: str(bt.nav),
          minted: str(bt.minted),
          filled: str(bt.filled),
          paid: str(bt.paid),
          openedAt: str(bt.openedAt),
          closedAt: bt.closedAt ? str(bt.closedAt) : null,
          refunded: bt.refunded,
          floor: bt.floor,
          approvedMark: bt.approvedMark === null ? null : str(bt.approvedMark),
        }
      : null;
  };
  const supply = v.totalSupply;
  const holders = (role: keyof typeof WORLD_VAULT_ROLES) =>
    v.roles.get(WORLD_VAULT_ROLES[role]) ?? [];
  return {
    address: v.address,
    seeded: v.seeded,
    paused: v.paused,
    quoteEpoch: str(v.quoteEpoch),
    credit: str(totals.credit),
    guaranteed: str(totals.guaranteed),
    best: str(totals.best),
    /** Capital at risk: the most the vault can still lose in its books. */
    atRisk: str(atRisk),
    refNav: str(v.refNav),
    /** Raw quote per share unit x 1e36 at the last mark. */
    lastNavPerShare: str(v.lastNavPerShare),
    /** Per whole share (1e18 units), raw quote. */
    navPerShare: str((v.lastNavPerShare * 10n ** 18n) / NAV_SCALE),
    totalSupply: str(supply),
    limits: v.limits,
    risk: risk
      ? {
          ...risk,
          maxQuoteSize: str(risk.maxQuoteSize),
          maxQuotePrice: str(risk.maxQuotePrice),
          maxBookRisk: str(risk.maxBookRisk),
          maxLegRisk: str(risk.maxLegRisk),
        }
      : null,
    feeds: v.feeds,
    exposure: { day: str(today), used: str(used), budget: str(budget) },
    lossFloor: str(floor),
    depositCap: str(v.depositCap),
    openDeposits: v.openDeposits,
    withdrawLimitBps: v.withdrawLimitBps,
    maxMarkMoveBps: v.maxMarkMoveBps,
    positions,
    legRisk,
    batches: { open: batch(v.batchId), closed: v.closedBatch ? batch(v.closedBatch) : null },
    held: {
      pendingAssets: str(v.pendingAssets),
      owedAssets: str(v.owedAssets),
      escrowShares: str(v.escrowShares),
    },
    roles: {
      keepers: holders("keeper"),
      markers: holders("marker"),
      curators: holders("curator"),
      guardians: holders("guardian"),
      admins: holders("admin"),
    },
  };
}

/** An owner's side of a vault: shares, and requests by batch with what each will pay. */
export function vaultAccount(v: VaultState, owner: Address) {
  const requests: {
    batch: number;
    status: string;
    assets: string;
    shares: string;
    claimable: boolean;
  }[] = [];
  const prefix = `:${getAddress(owner)}`;
  for (const [key, r] of v.requests) {
    if (!key.endsWith(prefix) || (!r.assets && !r.shares)) continue;
    const batch = Number(key.split(":")[0]);
    const bt = v.batches.get(batch);
    const status = ["", "open", "closed", "processed"][bt?.status ?? 0] ?? "unknown";
    requests.push({
      batch,
      status,
      assets: str(r.assets),
      shares: str(r.shares),
      claimable: status === "processed",
    });
  }
  return {
    vault: v.address,
    shares: str(v.shares.get(getAddress(owner)) ?? 0n),
    requests: requests.sort((a, b) => b.batch - a.batch),
  };
}

/** Books whose fixing falls in [from, to] (unix seconds) and is not decided yet: what the feed
 * relays post a round for, and the fix job proposes. */
export function fixingsBetween(s: WorldState, from: bigint, to: bigint, now: bigint) {
  const out: {
    book: number;
    feed: Address;
    fixingTime: string;
    maxStaleness: number;
    state: string;
    proposal: string | null;
  }[] = [];
  for (const b of s.books.values()) {
    if (b.def.feed === zeroAddress || b.status !== 1) continue;
    const t = BigInt(b.def.fixingTime);
    if (t < from || t > to) continue;
    const state = bookStateAt(s, b, now);
    if (state === BOOK_STATE.failed) continue;
    out.push({
      book: b.id,
      feed: b.def.feed,
      fixingTime: String(b.def.fixingTime),
      maxStaleness: b.def.maxStaleness,
      state: BOOK_STATE_NAMES[state] ?? "unknown",
      proposal: b.fix ? str(b.fix.roundId) : null,
    });
  }
  return out.sort((a, b) => Number(a.fixingTime) - Number(b.fixingTime));
}

/** An owner's credit on the books and grants it gave. */
export function accountOf(s: WorldState, owner: Address) {
  const grants = [...s.grants.values()]
    .filter((g) => g.owner === owner)
    .map((g) => ({
      delegate: g.delegate,
      expiresAt: str(g.expiresAt),
      maxBuy: str(g.maxBuy),
      remainingBuy: str(g.remainingBuy),
      maxSell: str(g.maxSell),
      remainingSell: str(g.remainingSell),
      maxFeeBps: g.maxFeeBps,
      permissions: g.permissions,
      active: !g.revoked && g.epoch === (s.delegationEpochs.get(owner) ?? 0n),
    }));
  return { credit: str(worldCreditOf(s, owner)), grants };
}

/** One event's oracle state. */
export const eventView = (s: WorldState, key: Hex) => {
  const e = eventOf(s, key);
  return {
    key,
    state: EVENT_NAMES[e.state] ?? "open",
    stateCode: e.state,
    resolvedAt: e.resolvedAt ? str(e.resolvedAt) : null,
    commitment: e.commitment,
    evidence: e.evidence,
    uri: e.uri,
    transaction: e.resolvedTx,
    books: [...s.books.values()]
      .filter((b) => b.def.legs.some((l) => l.eventKey === key))
      .map((b) => b.id),
  };
};
