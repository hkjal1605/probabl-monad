/** Exact replica of the world contracts (`WorldBooks`, `EventOracle` and each `WorldVault`),
 * rebuilt from their event logs, as `ledger.ts` is of the exchange.
 *
 * Every state change the product reads is announced by an event or follows from one: credits,
 * book backing and fees, every owner's atoms (fills replay the contract's split-and-merge
 * delivery), book lifecycle and fixings, event outcomes, delegations and their budgets, and each
 * vault's positions, leg risk, daily exposure, batches, requests, shares and roles. Replaying
 * the logs of the deployment in order reproduces their storage; reconciliation compares a sample
 * of on-chain storage with the replica and fails closed on any difference. */
import { type Address, decodeEventLog, getAddress, type Hex, type Log, zeroAddress } from "viem";
import { eventOracleAbi, worldBooksAbi, worldVaultAbi } from "./abi.ts";
import {
  atomCount,
  BOOK_STATE,
  BOOK_STATUS,
  type BookDef,
  type Bundle,
  bucketOf,
  bundlePays,
  EVENT_STATE,
  FIX_DEADLINE,
  NAV_SCALE,
  payRange,
  WORLD_VAULT_ROLES,
  type WorldVaultLimits,
  type WorldVaultRisk,
} from "./worlds.ts";

/** The contracts of one world deployment. */
export interface WorldDeployment {
  chainId: number;
  books: Address;
  oracle: Address;
  quote: Address;
  /** World vaults followed (each a maker on the books). */
  vaults: Address[];
}
export interface WorldConfig {
  admin: Address | null;
  pendingAdmin: Address | null;
  adminAfter: bigint;
  bookAdmin: Address | null;
  guardian: Address | null;
  resolutionAdmin: Address | null;
  paused: boolean;
}
export interface OracleConfig {
  admin: Address | null;
  pendingAdmin: Address | null;
  adminAfter: bigint;
  marketAdmin: Address | null;
  guardian: Address | null;
  resolutionAdmin: Address | null;
}
/** One event's outcome in `EventOracle`. */
export interface EventState {
  key: Hex;
  state: number;
  /** Unix seconds; zero until resolved. */
  resolvedAt: bigint;
  commitment: Hex | null;
  evidence: Hex | null;
  uri: string | null;
  resolvedTx: Hex | null;
}
export interface FixState {
  price: bigint;
  updatedAt: bigint;
  proposedAt: bigint;
  roundId: bigint;
}
export interface BookState {
  id: number;
  defHash: Hex;
  def: BookDef;
  metadataUri: string;
  atoms: number;
  /** `BOOK_STATUS`: undecided until latched. */
  status: number;
  winner: number;
  frozen: boolean;
  held: boolean;
  /** Full sets outstanding: every atom's supply before a decision, the winner's after. */
  backing: bigint;
  /** The standing fixing proposal. */
  fix: FixState | null;
  fixCommitment: Hex | null;
  /** The fallback price's evidence, once resolved by the two keys. */
  fixEvidence: Hex | null;
  fixUri: string | null;
  /** The fixing price that decided the book (proposal or fallback). */
  fixedPrice: bigint | null;
  /** Fills, their total premium and fees. */
  fills: number;
  volume: bigint;
  fees: bigint;
  createdBlock: bigint;
  createdAt: bigint;
  createdTx: Hex;
  decidedAt: bigint | null;
}
/** A delegation (`approveDelegate`) with what its budgets have left. */
export interface WorldGrant {
  owner: Address;
  delegate: Address;
  epoch: bigint;
  expiresAt: bigint;
  maxBuy: bigint;
  remainingBuy: bigint;
  maxSell: bigint;
  remainingSell: bigint;
  maxFeeBps: number;
  permissions: number;
  revoked: boolean;
}
/** A vault's book position as last synced (`Position`). */
export interface VaultPosition {
  lo: bigint;
  hi: bigint;
  cost: bigint;
}
export interface VaultBatch {
  id: number;
  depositAssets: bigint;
  redeemShares: bigint;
  guaranteed: bigint;
  best: bigint;
  supply: bigint;
  nav: bigint;
  minted: bigint;
  filled: bigint;
  paid: bigint;
  openedAt: bigint;
  closedAt: bigint;
  status: number;
  refunded: boolean;
  floor: boolean;
  /** A guardian-approved mark beyond the move limit. */
  approvedMark: bigint | null;
  processedTx: Hex | null;
}
export interface VaultState {
  address: Address;
  seeded: boolean;
  paused: boolean;
  quoteEpoch: bigint;
  limits: WorldVaultLimits | null;
  risk: WorldVaultRisk | null;
  /** Feeds eligible for new risk. */
  feeds: Address[];
  depositCap: bigint;
  openDeposits: boolean;
  withdrawLimitBps: number;
  maxMarkMoveBps: number;
  positions: Map<number, VaultPosition>;
  /** Σ risk of the books on each leg. */
  legRisk: Map<Hex, bigint>;
  sumLo: bigint;
  sumHi: bigint;
  /** The day (unix days) and the exposure its fills used. */
  day: { day: bigint; used: bigint };
  refNav: bigint;
  lastNavPerShare: bigint;
  batchId: number;
  closedBatch: number;
  batches: Map<number, VaultBatch>;
  /** Key `${batch}:${owner}`: deposit assets and redemption shares requested. */
  requests: Map<string, { assets: bigint; shares: bigint }>;
  pendingAssets: bigint;
  owedAssets: bigint;
  escrowShares: bigint;
  totalSupply: bigint;
  shares: Map<Address, bigint>;
  /** Holders of each role (`WORLD_VAULT_ROLES`), by role id. */
  roles: Map<Hex, Address[]>;
}
export interface WorldState {
  block: bigint;
  hash: Hex;
  timestamp: bigint;
  deployment: WorldDeployment;
  config: WorldConfig;
  oracle: OracleConfig;
  /** Everything `WorldBooks` owes: credit, backing and fees. */
  liability: bigint;
  fees: bigint;
  credits: Map<Address, bigint>;
  books: Map<number, BookState>;
  /** Book id by definition hash. */
  bookOf: Map<Hex, number>;
  /** Atoms by `${book}:${owner}`, one balance per atom. */
  holdings: Map<string, bigint[]>;
  events: Map<Hex, EventState>;
  /** Key `${owner}:${delegate}`. */
  grants: Map<string, WorldGrant>;
  delegationEpochs: Map<Address, bigint>;
  vaults: Map<Address, VaultState>;
}

export function emptyWorldState(deployment: WorldDeployment): WorldState {
  const vaults = deployment.vaults.map(getAddress);
  return {
    block: 0n,
    hash: "0x",
    timestamp: 0n,
    deployment: {
      chainId: deployment.chainId,
      books: getAddress(deployment.books),
      oracle: getAddress(deployment.oracle),
      quote: getAddress(deployment.quote),
      vaults,
    },
    config: {
      admin: null,
      pendingAdmin: null,
      adminAfter: 0n,
      bookAdmin: null,
      guardian: null,
      resolutionAdmin: null,
      paused: false,
    },
    oracle: {
      admin: null,
      pendingAdmin: null,
      adminAfter: 0n,
      marketAdmin: null,
      guardian: null,
      resolutionAdmin: null,
    },
    liability: 0n,
    fees: 0n,
    credits: new Map(),
    books: new Map(),
    bookOf: new Map(),
    holdings: new Map(),
    events: new Map(),
    grants: new Map(),
    delegationEpochs: new Map(),
    vaults: new Map(vaults.map((v) => [v, emptyVault(v)])),
  };
}
function emptyVault(address: Address): VaultState {
  return {
    address,
    seeded: false,
    paused: false,
    quoteEpoch: 0n,
    limits: null,
    risk: null,
    feeds: [],
    depositCap: 0n,
    openDeposits: false,
    // The constructor's defaults (it emits no event for them).
    withdrawLimitBps: 10_000,
    maxMarkMoveBps: 1_000,
    positions: new Map(),
    legRisk: new Map(),
    sumLo: 0n,
    sumHi: 0n,
    day: { day: 0n, used: 0n },
    refNav: 0n,
    lastNavPerShare: 0n,
    batchId: 0,
    closedBatch: 0,
    batches: new Map(),
    requests: new Map(),
    pendingAssets: 0n,
    owedAssets: 0n,
    escrowShares: 0n,
    totalSupply: 0n,
    shares: new Map(),
    roles: new Map(),
  };
}

export const holdingKey = (book: number, owner: Address) => `${book}:${owner}`;
export const worldGrantKey = (owner: Address, delegate: Address) => `${owner}:${delegate}`;
export const requestKey = (batch: number, owner: Address) => `${batch}:${owner}`;
export const worldCreditOf = (s: WorldState, owner: Address) => s.credits.get(owner) ?? 0n;
/** An owner's atoms of a book (zeros when it holds none). */
export const atomsOf = (s: WorldState, book: number, owner: Address): bigint[] => {
  const held = s.holdings.get(holdingKey(book, owner));
  if (held) return held;
  const b = s.books.get(book);
  return b ? new Array<bigint>(b.atoms).fill(0n) : [];
};
export const eventOf = (s: WorldState, key: Hex): EventState =>
  s.events.get(key) ?? {
    key,
    state: EVENT_STATE.unknown,
    resolvedAt: 0n,
    commitment: null,
    evidence: null,
    uri: null,
    resolvedTx: null,
  };
export const hasVaultRole = (
  v: VaultState,
  role: keyof typeof WORLD_VAULT_ROLES,
  account: Address,
) => (v.roles.get(WORLD_VAULT_ROLES[role]) ?? []).includes(getAddress(account));

/** What a replayed event changed, for stream invalidation and persistence. */
export interface WorldTouched {
  books: Set<number>;
  owners: Set<Address>;
  events: Set<Hex>;
  vaults: Set<Address>;
}
export const worldTouched = (): WorldTouched => ({
  books: new Set(),
  owners: new Set(),
  events: new Set(),
  vaults: new Set(),
});
export function mergeWorldTouched(into: WorldTouched, from: WorldTouched) {
  for (const key of ["books", "owners", "events", "vaults"] as const)
    for (const value of from[key]) (into[key] as Set<unknown>).add(value);
}

/** A decoded log of one of the world contracts. */
export interface WorldEvent {
  contract: "books" | "oracle" | "vault";
  address: Address;
  name: string;
  args: Record<string, unknown>;
  block: bigint;
  timestamp: bigint;
  logIndex: number;
  transactionHash: Hex;
}

/** Decodes a log of `deployment`'s contracts (any other address is an error: the follower only
 * reads theirs). */
export function decodeWorldLog(
  deployment: WorldDeployment,
  log: Log,
  timestamp: bigint,
): WorldEvent {
  const address = getAddress(log.address);
  const contract =
    address === deployment.books
      ? "books"
      : address === deployment.oracle
        ? "oracle"
        : deployment.vaults.includes(address)
          ? "vault"
          : null;
  if (!contract) throw new Error(`Log of an unknown contract ${address}`);
  const abi =
    contract === "books" ? worldBooksAbi : contract === "oracle" ? eventOracleAbi : worldVaultAbi;
  const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null)
    throw new Error("Pending log cannot be applied");
  return {
    contract,
    address,
    name: decoded.eventName as string,
    args: decoded.args as Record<string, unknown>,
    block: log.blockNumber,
    timestamp,
    logIndex: log.logIndex,
    transactionHash: log.transactionHash,
  };
}

const bi = (value: unknown) => BigInt(value as bigint | number);
const num = (value: unknown) => Number(value as number | bigint);
const addr = (value: unknown) => getAddress(value as string);
const hex = (value: unknown) => (value as string).toLowerCase() as Hex;
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** `WorldVault._riskOf`: the most the vault can lose in a book. */
export const positionRisk = (p: Pick<VaultPosition, "cost" | "lo">) =>
  p.cost > p.lo ? p.cost - p.lo : 0n;

class WorldReplica {
  constructor(
    readonly s: WorldState,
    readonly changes: WorldTouched,
  ) {}

  credit(owner: Address, delta: bigint) {
    const value = (this.s.credits.get(owner) ?? 0n) + delta;
    if (value < 0n) throw new Error(`Negative credit replayed for ${owner}`);
    if (value === 0n) this.s.credits.delete(owner);
    else this.s.credits.set(owner, value);
    this.changes.owners.add(owner);
  }
  book(id: number) {
    const b = this.s.books.get(id);
    if (!b) throw new Error(`Event references unknown book ${id}`);
    this.changes.books.add(id);
    return b;
  }
  atoms(id: number, owner: Address) {
    return [...atomsOf(this.s, id, owner)];
  }
  store(id: number, owner: Address, balances: bigint[]) {
    if (balances.some((b) => b < 0n)) throw new Error(`Negative atoms replayed in book ${id}`);
    const key = holdingKey(id, owner);
    if (balances.every((b) => b === 0n)) this.s.holdings.delete(key);
    else this.s.holdings.set(key, balances);
    this.changes.owners.add(owner);
    this.changes.books.add(id);
  }
  event(key: Hex) {
    let e = this.s.events.get(key);
    if (!e) {
      e = eventOf(this.s, key);
      this.s.events.set(key, e);
    }
    this.changes.events.add(key);
    // Every book with this leg changes state with it.
    for (const b of this.s.books.values())
      if (b.def.legs.some((l) => l.eventKey === key)) this.changes.books.add(b.id);
    return e;
  }
  vault(address: Address) {
    const v = this.s.vaults.get(address);
    if (!v) throw new Error(`Event of an unfollowed vault ${address}`);
    this.changes.vaults.add(address);
    return v;
  }
  batch(v: VaultState, id: number) {
    let b = v.batches.get(id);
    if (!b) {
      b = {
        id,
        depositAssets: 0n,
        redeemShares: 0n,
        guaranteed: 0n,
        best: 0n,
        supply: 0n,
        nav: 0n,
        minted: 0n,
        filled: 0n,
        paid: 0n,
        openedAt: 0n,
        closedAt: 0n,
        status: 0,
        refunded: false,
        floor: false,
        approvedMark: null,
        processedTx: null,
      };
      v.batches.set(id, b);
    }
    return b;
  }
  request(v: VaultState, batch: number, owner: Address) {
    const key = requestKey(batch, owner);
    let r = v.requests.get(key);
    if (!r) {
      r = { assets: 0n, shares: 0n };
      v.requests.set(key, r);
    }
    this.changes.owners.add(owner);
    return r;
  }
  shares(v: VaultState, owner: Address, delta: bigint) {
    const value = (v.shares.get(owner) ?? 0n) + delta;
    if (value < 0n) throw new Error("Negative vault shares replayed");
    if (value === 0n) v.shares.delete(owner);
    else v.shares.set(owner, value);
    this.changes.owners.add(owner);
  }
}

/** Applies one `WorldFill`: the contract's `_takerBuys` or `_takerSells`, then the fee, the
 * delegate's budget and, for a vault maker, its daily exposure. */
function applyFill(r: WorldReplica, e: WorldEvent) {
  const s = r.s,
    a = e.args;
  const id = num(a.book),
    b = r.book(id);
  const maker = addr(a.maker),
    taker = addr(a.taker),
    delegate = addr(a.delegate);
  const word = bi(a.bundle);
  const bundle: Bundle = { mask: Number(word & 0xffffn), units: bi(a.units), refund: bi(a.refund) };
  const sell = ((word >> 16n) & 1n) === 1n;
  const price = bi(a.price),
    fee = bi(a.fee);
  const count = b.atoms;
  const need = (atom: number) => bundlePays(bundle, atom);
  const m = r.atoms(id, maker),
    t = r.atoms(id, taker);
  if (!sell) {
    r.credit(taker, -(price + fee));
    let makerCredit = (s.credits.get(maker) ?? 0n) + price;
    let shortfall = 0n;
    for (let i = 0; i < count; i++) if (need(i) - m[i]! > shortfall) shortfall = need(i) - m[i]!;
    makerCredit -= shortfall;
    b.backing += shortfall;
    let sets: bigint | null = null;
    for (let i = 0; i < count; i++) {
      const left = m[i]! + shortfall - need(i);
      m[i] = left;
      if (sets === null || left < sets) sets = left;
      t[i]! += need(i);
    }
    if (sets) {
      for (let i = 0; i < count; i++) m[i]! -= sets;
      b.backing -= sets;
      makerCredit += sets;
    }
    r.credit(maker, makerCredit - (s.credits.get(maker) ?? 0n));
  } else {
    let sets: bigint | null = null;
    for (let i = 0; i < count; i++) {
      t[i]! -= need(i);
      m[i]! += need(i);
      if (sets === null || m[i]! < sets) sets = m[i]!;
    }
    if (sets) {
      for (let i = 0; i < count; i++) m[i]! -= sets;
      b.backing -= sets;
    }
    r.credit(maker, (sets ?? 0n) - price);
    r.credit(taker, price - fee);
  }
  r.store(id, maker, m);
  r.store(id, taker, t);
  s.fees += fee;
  b.fills++;
  b.volume += price;
  b.fees += fee;
  if (delegate !== zeroAddress) {
    const g = s.grants.get(worldGrantKey(taker, delegate));
    if (!g) throw new Error("A delegated fill without a grant");
    if (sell) g.remainingSell -= payRange(bundle, count).maxPay;
    else g.remainingBuy -= price + fee;
    r.changes.owners.add(delegate);
  }
  const v = s.vaults.get(maker);
  if (v) {
    // `_spendExposure`: what the fill could move away from the vault whatever the odds.
    const { minPay, maxPay } = payRange(bundle, count);
    const exposure = sell ? price - minPay : maxPay - price;
    const today = e.timestamp / 86_400n;
    v.day = { day: today, used: (v.day.day === today ? v.day.used : 0n) + exposure };
    r.changes.vaults.add(maker);
  }
}

/** Applies the logs of ONE transaction, in log order. Returns what changed. */
export function applyWorldTransaction(
  s: WorldState,
  events: WorldEvent[],
  changes = worldTouched(),
): WorldTouched {
  const r = new WorldReplica(s, changes);
  for (const e of events) {
    if (e.contract === "books") applyBooks(r, e);
    else if (e.contract === "oracle") applyOracle(r, e);
    else applyVault(r, e);
  }
  return changes;
}

function applyBooks(r: WorldReplica, e: WorldEvent) {
  const s = r.s,
    a = e.args;
  switch (e.name) {
    case "AdminAccepted":
      s.config.admin = addr(a.admin);
      s.config.pendingAdmin = null;
      s.config.adminAfter = 0n;
      break;
    case "AdminProposed":
      s.config.pendingAdmin = bi(a.successor) === 0n ? null : addr(a.successor);
      s.config.adminAfter = bi(a.acceptableAfter);
      break;
    case "Configured":
      s.config.bookAdmin = addr(a.bookAdmin);
      s.config.guardian = addr(a.guardian);
      s.config.resolutionAdmin = addr(a.resolutionAdmin);
      break;
    case "PauseSet":
      s.config.paused = a.paused as boolean;
      for (const id of s.books.keys()) r.changes.books.add(id);
      break;
    case "Deposited":
      s.liability += bi(a.amount);
      r.credit(addr(a.owner), bi(a.amount));
      break;
    case "Withdrawn":
      s.liability -= bi(a.amount);
      r.credit(addr(a.owner), -bi(a.amount));
      break;
    case "BookCreated": {
      const d = a.def as Record<string, unknown>;
      const id = num(a.book);
      const def: BookDef = {
        legs: (d.legs as { eventKey: Hex; wantYes: boolean }[]).map((l) => ({
          eventKey: hex(l.eventKey),
          wantYes: l.wantYes,
        })),
        feed: addr(d.feed),
        underlying: hex(d.underlying),
        fixingTime: num(d.fixingTime),
        maxStaleness: num(d.maxStaleness),
        strikes: (d.strikes as bigint[]).map(bi),
        cutoff: num(d.cutoff),
        feeBps: num(d.feeBps),
        metadataHash: hex(d.metadataHash),
      };
      s.books.set(id, {
        id,
        defHash: hex(a.defHash),
        def,
        metadataUri: a.metadataUri as string,
        atoms: atomCount(def),
        status: BOOK_STATUS.undecided,
        winner: 0,
        frozen: false,
        held: false,
        backing: 0n,
        fix: null,
        fixCommitment: null,
        fixEvidence: null,
        fixUri: null,
        fixedPrice: null,
        fills: 0,
        volume: 0n,
        fees: 0n,
        createdBlock: e.block,
        createdAt: e.timestamp,
        createdTx: e.transactionHash,
        decidedAt: null,
      });
      s.bookOf.set(hex(a.defHash), id);
      r.changes.books.add(id);
      break;
    }
    case "BookFrozen":
      r.book(num(a.book)).frozen = a.frozen as boolean;
      break;
    case "PositionChanged": {
      const id = num(a.book),
        b = r.book(id),
        owner = addr(a.owner),
        amount = bi(a.amount);
      const split = num(a.kind) === 0;
      r.credit(owner, split ? -amount : amount);
      b.backing += split ? amount : -amount;
      r.store(
        id,
        owner,
        r.atoms(id, owner).map((v) => (split ? v + amount : v - amount)),
      );
      break;
    }
    case "AtomsTransferred": {
      const id = num(a.book),
        atom = num(a.atom),
        amount = bi(a.amount);
      r.book(id);
      const from = r.atoms(id, addr(a.from)),
        to = r.atoms(id, addr(a.to));
      from[atom]! -= amount;
      to[atom]! += amount;
      r.store(id, addr(a.from), from);
      r.store(id, addr(a.to), to);
      break;
    }
    case "WorldFill":
      applyFill(r, e);
      break;
    case "BookDecided": {
      const b = r.book(num(a.book));
      b.status = num(a.status);
      b.winner = num(a.winner);
      b.decidedAt = e.timestamp;
      if (b.status === BOOK_STATUS.fixed) {
        b.fixedPrice = b.fix?.price ?? b.fixedPrice;
        b.fix = null;
      }
      break;
    }
    case "Redeemed": {
      const id = num(a.book),
        b = r.book(id),
        owner = addr(a.owner),
        amount = bi(a.amount);
      if (r.atoms(id, owner)[num(a.winner)] !== amount)
        throw new Error("Redemption differs from the replayed balance");
      r.store(id, owner, new Array<bigint>(b.atoms).fill(0n));
      b.backing -= amount;
      r.credit(owner, amount);
      break;
    }
    case "FixProposed":
      r.book(num(a.book)).fix = {
        price: bi(a.price),
        updatedAt: bi(a.updatedAt),
        proposedAt: e.timestamp,
        roundId: bi(a.roundId),
      };
      break;
    case "FixHeldSet":
      r.book(num(a.book)).held = true;
      break;
    case "FixCommitted":
      r.book(num(a.book)).fixCommitment = hex(a.commitment);
      break;
    case "FixResolved": {
      // Emitted after the BookDecided of the same call.
      const b = r.book(num(a.book));
      b.fixCommitment = null;
      b.fixEvidence = hex(a.evidence);
      b.fixUri = a.uri as string;
      b.fixedPrice = bi(a.price);
      break;
    }
    case "FeesClaimed":
      s.fees -= bi(a.amount);
      r.credit(addr(a.to), bi(a.amount));
      break;
    case "NoncesInvalidated":
      break;
    case "DelegateApproved": {
      const owner = addr(a.owner),
        delegate = addr(a.delegate);
      const permissions = num(a.permissions);
      s.grants.set(worldGrantKey(owner, delegate), {
        owner,
        delegate,
        epoch: bi(a.epoch),
        expiresAt: bi(a.expiresAt),
        maxBuy: permissions & 1 ? bi(a.maxBuy) : 0n,
        remainingBuy: permissions & 1 ? bi(a.totalBuy) : 0n,
        maxSell: permissions & 2 ? bi(a.maxSell) : 0n,
        remainingSell: permissions & 2 ? bi(a.totalSell) : 0n,
        maxFeeBps: num(a.maxFeeBps),
        permissions,
        revoked: false,
      });
      r.changes.owners.add(owner);
      break;
    }
    case "DelegateRevoked": {
      const g = s.grants.get(worldGrantKey(addr(a.owner), addr(a.delegate)));
      if (g) g.revoked = true;
      r.changes.owners.add(addr(a.owner));
      break;
    }
    case "DelegatesRevoked":
      s.delegationEpochs.set(addr(a.owner), bi(a.epoch));
      r.changes.owners.add(addr(a.owner));
      break;
    default:
      throw new Error(`Unknown WorldBooks event ${e.name}`);
  }
}

function applyOracle(r: WorldReplica, e: WorldEvent) {
  const o = r.s.oracle,
    a = e.args;
  switch (e.name) {
    case "AdminAccepted":
      o.admin = addr(a.admin);
      o.pendingAdmin = null;
      o.adminAfter = 0n;
      break;
    case "AdminProposed":
      o.pendingAdmin = bi(a.successor) === 0n ? null : addr(a.successor);
      o.adminAfter = bi(a.acceptableAfter);
      break;
    case "Configured":
      o.marketAdmin = addr(a.marketAdmin);
      o.guardian = addr(a.guardian);
      o.resolutionAdmin = addr(a.resolutionAdmin);
      break;
    case "EventFrozen":
      r.event(hex(a.key)).state = EVENT_STATE.frozen;
      break;
    case "EventReopened": {
      const ev = r.event(hex(a.key));
      ev.state = EVENT_STATE.unknown;
      ev.commitment = null;
      break;
    }
    case "EventCommitted": {
      const ev = r.event(hex(a.key));
      ev.state = EVENT_STATE.committed;
      ev.commitment = hex(a.commitment);
      break;
    }
    case "EventResolved": {
      const ev = r.event(hex(a.key));
      ev.state = num(a.outcome);
      ev.resolvedAt = e.timestamp;
      ev.commitment = null;
      ev.evidence = hex(a.evidence);
      ev.uri = a.uri as string;
      ev.resolvedTx = e.transactionHash;
      break;
    }
    default:
      throw new Error(`Unknown EventOracle event ${e.name}`);
  }
}

function applyVault(r: WorldReplica, e: WorldEvent) {
  const a = e.args,
    v = r.vault(e.address);
  switch (e.name) {
    case "Seeded":
      v.seeded = true;
      v.refNav = bi(a.assets);
      v.lastNavPerShare = (bi(a.assets) * NAV_SCALE) / bi(a.shares);
      v.batchId = 1;
      Object.assign(r.batch(v, 1), { openedAt: e.timestamp, status: 1 });
      break;
    case "DepositRequested": {
      const amount = bi(a.assets);
      r.batch(v, num(a.batch)).depositAssets += amount;
      r.request(v, num(a.batch), addr(a.owner)).assets += amount;
      v.pendingAssets += amount;
      break;
    }
    case "DepositCancelled": {
      const amount = bi(a.assets);
      r.batch(v, num(a.batch)).depositAssets -= amount;
      r.request(v, num(a.batch), addr(a.owner)).assets -= amount;
      v.pendingAssets -= amount;
      break;
    }
    case "RedeemRequested": {
      const amount = bi(a.shares);
      v.escrowShares += amount;
      r.batch(v, num(a.batch)).redeemShares += amount;
      r.request(v, num(a.batch), addr(a.owner)).shares += amount;
      break;
    }
    case "RedeemCancelled": {
      const amount = bi(a.shares);
      v.escrowShares -= amount;
      r.batch(v, num(a.batch)).redeemShares -= amount;
      r.request(v, num(a.batch), addr(a.owner)).shares -= amount;
      break;
    }
    case "BatchClosed": {
      const id = num(a.batch);
      Object.assign(r.batch(v, id), {
        guaranteed: bi(a.guaranteed),
        best: bi(a.best),
        supply: bi(a.supply),
        closedAt: e.timestamp,
        status: 2,
      });
      v.closedBatch = id;
      v.batchId = id + 1;
      Object.assign(r.batch(v, id + 1), { openedAt: e.timestamp, status: 1 });
      break;
    }
    case "MarkApproved":
      r.batch(v, num(a.batch)).approvedMark = bi(a.nav);
      break;
    case "BatchProcessed": {
      const id = num(a.batch),
        b = r.batch(v, id);
      const nav = bi(a.nav),
        minted = bi(a.minted),
        filled = bi(a.filled),
        paid = bi(a.paid);
      const refunded = a.refunded as boolean,
        floor = a.floor as boolean;
      v.pendingAssets -= b.depositAssets;
      if (b.depositAssets) {
        if (refunded) v.owedAssets += b.depositAssets;
        else v.escrowShares += minted;
      }
      v.escrowShares -= filled;
      v.owedAssets += paid;
      if (floor) v.refNav = v.refNav > paid ? v.refNav - paid : 0n;
      else {
        v.refNav = nav + (refunded ? 0n : b.depositAssets) - paid;
        v.lastNavPerShare = (nav * NAV_SCALE) / b.supply;
      }
      Object.assign(b, {
        nav,
        minted,
        filled,
        paid,
        refunded,
        floor,
        status: 3,
        processedTx: e.transactionHash,
      });
      v.closedBatch = 0;
      break;
    }
    case "Claimed": {
      const owner = addr(a.owner);
      v.requests.delete(requestKey(num(a.batch), owner));
      v.escrowShares -= bi(a.shares);
      v.owedAssets -= bi(a.assets);
      r.changes.owners.add(owner);
      break;
    }
    case "PositionSynced": {
      const id = num(a.book),
        b = r.book(id);
      const before = v.positions.get(id) ?? { lo: 0n, hi: 0n, cost: 0n };
      const after = { lo: bi(a.lo), hi: bi(a.hi), cost: bi(a.cost) };
      v.sumLo += after.lo - before.lo;
      v.sumHi += after.hi - before.hi;
      const delta = positionRisk(after) - positionRisk(before);
      if (delta)
        for (const leg of b.def.legs) {
          const risk = (v.legRisk.get(leg.eventKey) ?? 0n) + delta;
          if (risk) v.legRisk.set(leg.eventKey, risk);
          else v.legRisk.delete(leg.eventKey);
        }
      if (!after.lo && !after.hi && !after.cost) v.positions.delete(id);
      else v.positions.set(id, after);
      break;
    }
    case "QuoteEpochAdvanced":
      v.quoteEpoch = bi(a.epoch);
      break;
    case "LimitsSet": {
      const l = a.limits as Record<string, unknown>;
      v.limits = {
        maxTtl: num(l.maxTtl),
        cutoffBuffer: num(l.cutoffBuffer),
        maxTenor: num(l.maxTenor),
        maxLegs: num(l.maxLegs),
        maxFeeBps: num(l.maxFeeBps),
        marginBps: num(l.marginBps),
        eventOnly: l.eventOnly as boolean,
      };
      break;
    }
    case "RiskSet": {
      const k = a.risk as Record<string, unknown>;
      v.risk = {
        maxQuoteSize: bi(k.maxQuoteSize),
        maxQuotePrice: bi(k.maxQuotePrice),
        maxBookRisk: bi(k.maxBookRisk),
        maxLegRisk: bi(k.maxLegRisk),
        maxLossBps: num(k.maxLossBps),
        maxDailyExposureBps: num(k.maxDailyExposureBps),
      };
      break;
    }
    case "FeedSet": {
      const feed = addr(a.feed);
      v.feeds = v.feeds.filter((f) => f !== feed);
      if (a.allowed) v.feeds.push(feed);
      break;
    }
    case "DepositCapSet":
      v.depositCap = bi(a.cap);
      break;
    case "OpenDepositsSet":
      v.openDeposits = a.open as boolean;
      break;
    case "WithdrawLimitSet":
      v.withdrawLimitBps = num(a.bps);
      break;
    case "MaxMarkMoveSet":
      v.maxMarkMoveBps = num(a.bps);
      break;
    case "Paused":
      v.paused = true;
      break;
    case "Unpaused":
      v.paused = false;
      break;
    case "RoleGranted": {
      const role = hex(a.role),
        account = addr(a.account);
      const holders = v.roles.get(role) ?? [];
      if (!holders.includes(account)) v.roles.set(role, [...holders, account]);
      break;
    }
    case "RoleRevoked": {
      const role = hex(a.role),
        account = addr(a.account);
      const holders = (v.roles.get(role) ?? []).filter((h) => h !== account);
      if (holders.length) v.roles.set(role, holders);
      else v.roles.delete(role);
      break;
    }
    case "Transfer": {
      const from = addr(a.from),
        to = addr(a.to),
        value = bi(a.value);
      if (from === zeroAddress) v.totalSupply += value;
      else r.shares(v, from, -value);
      if (to === zeroAddress) v.totalSupply -= value;
      else r.shares(v, to, value);
      break;
    }
    // Allowances and the admin's delayed transfer schedule move nothing the replica serves
    // (the transfer itself is a pair of RoleGranted/RoleRevoked).
    case "Approval":
    case "RoleAdminChanged":
    case "DefaultAdminTransferScheduled":
    case "DefaultAdminTransferCanceled":
    case "DefaultAdminDelayChangeScheduled":
    case "DefaultAdminDelayChangeCanceled":
      break;
    default:
      throw new Error(`Unknown WorldVault event ${e.name}`);
  }
}

/** Groups decoded logs by transaction (logs arrive in block and log order). */
export function* worldTransactions(events: WorldEvent[]) {
  let batch: WorldEvent[] = [];
  for (const e of events) {
    if (
      batch.length &&
      (batch[0]!.transactionHash !== e.transactionHash || batch[0]!.block !== e.block)
    ) {
      yield batch;
      batch = [];
    }
    batch.push(e);
  }
  if (batch.length) yield batch;
}

// ------------------------------------------------------------------ derived views

/** `WorldBooks._legStatus` from the replica's event outcomes. */
export function legStatus(s: WorldState, b: BookState) {
  let failed = 0,
    passed = 0,
    halted = false,
    lastResolved = 0n;
  for (const leg of b.def.legs) {
    const e = eventOf(s, leg.eventKey);
    if (
      e.state === EVENT_STATE.invalid ||
      (e.state === EVENT_STATE.yes && !leg.wantYes) ||
      (e.state === EVENT_STATE.no && leg.wantYes)
    )
      failed++;
    else if (e.state === EVENT_STATE.yes || e.state === EVENT_STATE.no) {
      passed++;
      if (e.resolvedAt > lastResolved) lastResolved = e.resolvedAt;
    } else if (e.state === EVENT_STATE.frozen || e.state === EVENT_STATE.committed) halted = true;
  }
  return { failed, passed, halted, lastResolved };
}

/** `WorldBooks.state` at `now` (unix seconds): `BOOK_STATE`. The global pause is separate. */
export function bookStateAt(s: WorldState, b: BookState, now: bigint): number {
  if (b.status === BOOK_STATUS.failed) return BOOK_STATE.failed;
  if (b.status === BOOK_STATUS.passed) return BOOK_STATE.passed;
  if (b.status === BOOK_STATUS.fixed) return BOOK_STATE.fixed;
  const { failed, passed, halted } = legStatus(s, b);
  if (failed) return BOOK_STATE.failed;
  const allPassed = passed === b.def.legs.length;
  const eventOnly = b.def.feed === zeroAddress;
  if (allPassed && eventOnly) return BOOK_STATE.passed;
  if (allPassed && now >= BigInt(b.def.fixingTime)) return BOOK_STATE.awaitingFix;
  if (now >= BigInt(b.def.cutoff)) return BOOK_STATE.closed;
  if (halted || b.frozen) return BOOK_STATE.halted;
  return BOOK_STATE.trading;
}

/** The atom that pays, once known (latched or not): atom 0 when a leg failed, atom 1 of an
 * event-only book when every leg passed, the fixing's bucket when fixed; null before. */
export function winningAtom(s: WorldState, b: BookState, now: bigint): number | null {
  const state = bookStateAt(s, b, now);
  if (state === BOOK_STATE.failed) return 0;
  if (state === BOOK_STATE.passed) return 1;
  if (state === BOOK_STATE.fixed) return b.winner;
  return null;
}

/** When the book started awaiting its fixing (null unless it does), and when its two-key
 * fallback opens without a proposal. */
export function fixingWindow(s: WorldState, b: BookState, now: bigint) {
  if (b.def.feed === zeroAddress || b.status !== BOOK_STATUS.undecided) return null;
  const { failed, passed, lastResolved } = legStatus(s, b);
  if (failed || passed !== b.def.legs.length || now < BigInt(b.def.fixingTime)) return null;
  const since = max(lastResolved, BigInt(b.def.fixingTime));
  return { since, fallbackAt: since + BigInt(FIX_DEADLINE) };
}

/** Every owner's atoms of `book` (the vault's included). */
export function holdersOf(s: WorldState, book: number) {
  const prefix = `${book}:`;
  const out: { owner: Address; balances: bigint[] }[] = [];
  for (const [key, balances] of s.holdings)
    if (key.startsWith(prefix)) out.push({ owner: key.slice(prefix.length) as Address, balances });
  return out;
}

/** A vault's credit, guaranteed and best values (`totals`). */
export function vaultTotals(s: WorldState, v: VaultState) {
  const credit = worldCreditOf(s, v.address);
  return {
    credit,
    sumLo: v.sumLo,
    sumHi: v.sumHi,
    guaranteed: credit + v.sumLo,
    best: credit + v.sumHi,
  };
}

/** Ledger identities that hold for every state the contracts can reach. */
export function worldLedgerIssues(s: WorldState): string[] {
  const issues: string[] = [];
  let owed = s.fees;
  for (const [owner, amount] of s.credits) {
    if (amount < 0n) issues.push(`negative credit ${owner}`);
    owed += amount;
  }
  const supply = new Map<number, bigint[]>();
  for (const b of s.books.values()) {
    owed += b.backing;
    supply.set(b.id, new Array<bigint>(b.atoms).fill(0n));
  }
  if (owed !== s.liability) issues.push("liability differs from credit, backing and fees");
  for (const [key, balances] of s.holdings) {
    const book = Number(key.split(":")[0]),
      totals = supply.get(book);
    if (!totals || balances.length !== totals.length || balances.some((v) => v < 0n)) {
      issues.push(`invalid holding ${key}`);
      continue;
    }
    for (let i = 0; i < balances.length; i++) totals[i]! += balances[i]!;
  }
  for (const b of s.books.values()) {
    const totals = supply.get(b.id)!;
    if (b.status === BOOK_STATUS.undecided) {
      if (totals.some((t) => t !== b.backing)) issues.push(`atom supply differs in book ${b.id}`);
    } else if (totals[b.winner] !== b.backing)
      issues.push(`winning supply differs in decided book ${b.id}`);
  }
  for (const v of s.vaults.values()) {
    let lo = 0n,
      hi = 0n;
    const legRisk = new Map<Hex, bigint>();
    for (const [book, p] of v.positions) {
      lo += p.lo;
      hi += p.hi;
      const b = s.books.get(book);
      if (!b) {
        issues.push(`vault ${v.address} position in unknown book ${book}`);
        continue;
      }
      for (const leg of b.def.legs)
        legRisk.set(leg.eventKey, (legRisk.get(leg.eventKey) ?? 0n) + positionRisk(p));
    }
    if (lo !== v.sumLo || hi !== v.sumHi) issues.push(`vault ${v.address} sums differ`);
    for (const [key, risk] of v.legRisk)
      if ((legRisk.get(key) ?? 0n) !== risk) issues.push(`vault ${v.address} leg risk differs`);
    for (const [key, risk] of legRisk)
      if (risk && v.legRisk.get(key) !== risk) issues.push(`vault ${v.address} leg risk differs`);
    let shares = 0n;
    for (const balance of v.shares.values()) shares += balance;
    if (shares !== v.totalSupply) issues.push(`vault ${v.address} shares differ from supply`);
    // Shares sent to the vault outside a request only add to its own balance.
    if ((v.shares.get(v.address) ?? 0n) < v.escrowShares)
      issues.push(`vault ${v.address} holds fewer shares than it escrows`);
  }
  return issues;
}

/** What one fill moved and paid, as persisted history keeps it. */
export function fillRecord(e: WorldEvent) {
  const a = e.args,
    word = bi(a.bundle);
  return {
    block: e.block,
    logIndex: e.logIndex,
    blockTime: e.timestamp,
    tx: e.transactionHash,
    book: num(a.book),
    maker: addr(a.maker),
    taker: addr(a.taker),
    delegate: addr(a.delegate) === zeroAddress ? null : addr(a.delegate),
    mask: Number(word & 0xffffn),
    sell: ((word >> 16n) & 1n) === 1n,
    units: bi(a.units),
    refund: bi(a.refund),
    price: bi(a.price),
    fee: bi(a.fee),
    nonce: bi(a.nonce),
  };
}
export type WorldFillRecord = ReturnType<typeof fillRecord>;

// ------------------------------------------------------------------ copies and checkpoints

/** Deep copy (the confirmed view is rebuilt from the finalized base after a reorg). */
export function cloneWorldState(s: WorldState): WorldState {
  return restoreWorldState(encodeWorldCheckpoint(s));
}

const replacer = (_key: string, value: unknown) =>
  typeof value === "bigint"
    ? { $n: value.toString() }
    : value instanceof Map
      ? { $m: [...value] }
      : value;
const reviver = (_key: string, value: unknown) => {
  if (value && typeof value === "object") {
    if ("$n" in value) return BigInt((value as { $n: string }).$n);
    if ("$m" in value) return new Map((value as { $m: [unknown, unknown][] }).$m);
  }
  return value;
};

/** 1: the first world replica. */
export const WORLD_CHECKPOINT_VERSION = 1;
/** A checkpoint from an older replica: the world index is rebuilt from the deployment block. */
export class StaleWorldCheckpointError extends Error {}

/** Compact JSON of a replica: holdings as positional rows, the rest tagged. */
export function encodeWorldCheckpoint(s: WorldState): string {
  const { holdings, ...rest } = s;
  return JSON.stringify(
    {
      v: WORLD_CHECKPOINT_VERSION,
      state: rest,
      holdings: [...holdings].map(([key, balances]) => [key, ...balances.map(String)]),
    },
    replacer,
  );
}
export function restoreWorldState(text: string): WorldState {
  const c = JSON.parse(text, reviver) as {
    v: number;
    state: Omit<WorldState, "holdings">;
    holdings: string[][];
  };
  if (c.v < WORLD_CHECKPOINT_VERSION) throw new StaleWorldCheckpointError(`Version ${c.v}`);
  if (c.v !== WORLD_CHECKPOINT_VERSION) throw new Error(`Unsupported checkpoint version ${c.v}`);
  return {
    ...c.state,
    holdings: new Map(c.holdings.map(([key, ...balances]) => [key!, balances.map(BigInt)])),
  };
}

/** Raw fixing answer → its bucket atom in book `b` (`_bucket`). */
export const fixingAtom = (b: BookState, price: bigint) => bucketOf(b.def.strikes, price);
