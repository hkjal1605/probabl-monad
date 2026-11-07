/** World books (docs/version-2-plan.md §4–6), as `WorldBooks`, `WorldVault` and `EventOracle`
 * define them: book definitions and their hash, atoms, bundles and the products they make up,
 * the `WorldQuote` signing domain, the commitments of the two-key paths, and every call. Each
 * helper matches its Solidity counterpart exactly; test/worlds.test.ts checks them against the
 * contracts on anvil. */
import {
  type Abi,
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  hashTypedData,
  keccak256,
  parseCompactSignature,
  parseSignature,
  signatureToCompactSignature,
  stringToBytes,
  stringToHex,
  zeroAddress,
  zeroHash,
} from "viem";
import { eventOracleAbi, worldBooksAbi, worldVaultAbi } from "./abi.ts";
import { U40_MAX, U64_MAX, U96_MAX, U128_MAX } from "./protocol.ts";
import type { Envelope } from "./transactions.ts";

// ------------------------------------------------------------------ constants

export const WORLD_MAX_LEGS = 6;
export const WORLD_MAX_STRIKES = 8;
export const WORLD_MAX_ATOMS = WORLD_MAX_STRIKES + 2;
export const WORLD_MAX_FEE_BPS = 1_000;
/** Seconds: the oldest a fixing round may be at the fixing time. */
export const WORLD_MAX_STALENESS = 86_400;
/** Seconds a fixing proposal stands before it finalizes (the guardian's window to hold it). */
export const FIX_WINDOW = 3_600;
/** Seconds after a book starts awaiting its fixing, with no proposal, the fallback opens. */
export const FIX_DEADLINE = 86_400;
export const WORLD_MAX_URI = 512;
export const WORLD_MAX_GRANT_SECONDS = 90 * 86_400;

/** `WorldBooks.state`: what a book's trading and redemption depend on now. */
export const BOOK_STATE = {
  unknown: 0,
  trading: 1,
  /** A leg frozen or committed, or the book frozen. */
  halted: 2,
  /** Past the cutoff, legs still open. */
  closed: 3,
  awaitingFix: 4,
  /** Atom 0 wins (some leg failed). */
  failed: 5,
  /** Atom 1 of an event-only book wins. */
  passed: 6,
  fixed: 7,
} as const;
export type BookStateName = keyof typeof BOOK_STATE;
export const BOOK_STATE_NAMES = Object.fromEntries(
  Object.entries(BOOK_STATE).map(([name, value]) => [value, name]),
) as Record<number, BookStateName>;
/** Stored `status` of a book. */
export const BOOK_STATUS = { undecided: 1, failed: 2, passed: 3, fixed: 4 } as const;
/** `EventOracle` states. */
export const EVENT_STATE = { unknown: 0, frozen: 1, committed: 2, yes: 3, no: 4, invalid: 5 };
export const WORLD_BUY = 1;
export const WORLD_SELL = 2;

/** `WorldVault` roles (`keccak256` of their names; the admin role is zero). */
export const WORLD_VAULT_ROLES = {
  admin: zeroHash,
  curator: keccak256(stringToBytes("CURATOR_ROLE")),
  keeper: keccak256(stringToBytes("KEEPER_ROLE")),
  marker: keccak256(stringToBytes("MARKER_ROLE")),
  guardian: keccak256(stringToBytes("GUARDIAN_ROLE")),
  depositor: keccak256(stringToBytes("DEPOSITOR_ROLE")),
} as const;
export type WorldVaultRole = keyof typeof WORLD_VAULT_ROLES;
/** `WorldVault` constants. */
export const VAULT_BATCH_PERIOD = 86_400;
export const VAULT_MARK_TIMEOUT = 3 * 86_400;
export const VAULT_DEAD_SHARES = 1_000n;
/** Scale of `lastNavPerShare`: raw quote per share unit x 1e36. */
export const NAV_SCALE = 10n ** 36n;
/** Batch status. */
export const BATCH_STATUS = { open: 1, closed: 2, processed: 3 } as const;

// ------------------------------------------------------------------ books

export interface WorldLeg {
  /** `EventOracle` key: keccak256(abi.encode(condition, yesIndex, noIndex)) (`eventKey`). */
  eventKey: Hex;
  /** The world needs the event's YES outcome (else its NO). */
  wantYes: boolean;
}
/** Everything that defines a book; `bookDefHash` identifies it. Strikes are raw feed answers. */
export interface BookDef {
  legs: WorldLeg[];
  /** Chainlink-style feed of the underlying; zero for an event-only book. */
  feed: Address;
  /** `underlyingId` of the asset the feed prices; zero for an event-only book. */
  underlying: Hex;
  /** Unix seconds; zero for an event-only book. */
  fixingTime: number;
  maxStaleness: number;
  strikes: bigint[];
  cutoff: number;
  feeBps: number;
  /** keccak256 of the metadata URI. */
  metadataHash: Hex;
}

const BOOK_DEF = {
  type: "tuple",
  components: [
    {
      name: "legs",
      type: "tuple[]",
      components: [
        { name: "eventKey", type: "bytes32" },
        { name: "wantYes", type: "bool" },
      ],
    },
    { name: "feed", type: "address" },
    { name: "underlying", type: "bytes32" },
    { name: "fixingTime", type: "uint40" },
    { name: "maxStaleness", type: "uint32" },
    { name: "strikes", type: "uint128[]" },
    { name: "cutoff", type: "uint40" },
    { name: "feeBps", type: "uint16" },
    { name: "metadataHash", type: "bytes32" },
  ],
} as const;

/** `abi.encode(def)`, as `createBook` hashes it. */
export const encodeBookDef = (def: BookDef) => encodeAbiParameters([BOOK_DEF], [def]);
/** The book's identity: `WorldBooks.bookOf(bookDefHash(def))` finds it. */
export const bookDefHash = (def: BookDef): Hex => keccak256(encodeBookDef(def));

/** Atoms of a book: ¬W, then one per price bucket (or just W without a feed). */
export const atomCount = (def: Pick<BookDef, "feed" | "strikes">) =>
  getAddress(def.feed) === zeroAddress ? 2 : def.strikes.length + 2;

/** Why `createBook` would refuse `def` (null when it would not), short of what only the chain
 * knows: that every leg is still unknown in the oracle and the feed answers `decimals` ≤ 18. */
export function bookDefProblem(def: BookDef, now: number, metadataUri: string): string | null {
  const keys = def.legs.map((l) => l.eventKey.toLowerCase());
  if (!keys.length || keys.length > WORLD_MAX_LEGS) return "A world has 1 to 6 legs";
  if (keys.some((k) => !/^0x[0-9a-f]{64}$/.test(k) || BigInt(k) === 0n))
    return "Every leg names an event key";
  if (new Set(keys).size !== keys.length) return "Legs must be distinct events";
  const eventOnly = getAddress(def.feed) === zeroAddress;
  if (eventOnly) {
    if (def.strikes.length || def.fixingTime || def.maxStaleness || BigInt(def.underlying) !== 0n)
      return "An event-only book has no strikes, fixing or underlying";
  } else {
    if (!def.strikes.length || def.strikes.length > WORLD_MAX_STRIKES)
      return "A priced book has 1 to 8 strikes";
    if (BigInt(def.underlying) === 0n) return "A priced book names its underlying";
    if (def.maxStaleness <= 0 || def.maxStaleness > WORLD_MAX_STALENESS)
      return "maxStaleness is 1 s to 1 day";
    if (def.fixingTime < def.cutoff) return "The fixing cannot precede the cutoff";
    for (let i = 0; i < def.strikes.length; i++)
      if (def.strikes[i]! <= (i ? def.strikes[i - 1]! : 0n) || def.strikes[i]! > U128_MAX)
        return "Strikes are positive, ascending and fit 128 bits";
  }
  if (!Number.isSafeInteger(def.cutoff) || BigInt(def.cutoff) > U40_MAX || def.cutoff <= now)
    return "The cutoff must be in the future";
  if (!Number.isInteger(def.feeBps) || def.feeBps < 0 || def.feeBps > WORLD_MAX_FEE_BPS)
    return "feeBps is 0 to 1,000";
  const bytes = stringToBytes(metadataUri);
  if (!bytes.length || bytes.length > WORLD_MAX_URI) return "The metadata URI is 1 to 512 bytes";
  if (keccak256(bytes) !== def.metadataHash.toLowerCase())
    return "metadataHash must be keccak256 of the metadata URI";
  return null;
}

/** The atom a fixing at `price` pays: one plus the number of strikes at or below it. */
export function bucketOf(strikes: readonly bigint[], price: bigint) {
  let atom = 1;
  for (const strike of strikes) {
    if (price >= strike) atom++;
    else break;
  }
  return atom;
}

// ------------------------------------------------------------------ bundles and products

/** What a fill moves: `units` of every atom in `mask` (bits 1 and up) plus `refund` of atom 0. */
export interface Bundle {
  mask: number;
  units: bigint;
  refund: bigint;
}
/** What one atom of `bundle` pays. */
export const bundlePays = (bundle: Bundle, atom: number) =>
  atom === 0 ? bundle.refund : (bundle.mask >> atom) & 1 ? bundle.units : 0n;
/** The least and most `bundle` pays over a book's `count` atoms (`_payRange`). */
export function payRange(bundle: Bundle, count: number) {
  let minPay = bundle.refund,
    maxPay = bundle.refund;
  for (let atom = 1; atom < count; atom++) {
    const pay = bundlePays(bundle, atom);
    if (pay < minPay) minPay = pay;
    if (pay > maxPay) maxPay = pay;
  }
  return { minPay, maxPay };
}
/** Why `WorldBooks` would refuse `bundle` at `price` in a book of `count` atoms, or null. */
export function bundleProblem(bundle: Bundle, count: number, price?: bigint): string | null {
  const { mask, units, refund } = bundle;
  if (!Number.isInteger(mask) || mask < 0 || mask > 0xffff) return "Invalid atom mask";
  if (mask & 1) return "Atom 0 is the refund, not part of the mask";
  if (mask >> count) return "The mask names atoms the book lacks";
  if ((mask === 0) !== (units === 0n)) return "Units go with a non-empty mask";
  if (mask === 0 && refund === 0n) return "An empty bundle";
  if (units < 0n || refund < 0n || units > U128_MAX || refund > U128_MAX)
    return "Units and refund fit 128 bits";
  if (price !== undefined) {
    const { minPay, maxPay } = payRange(bundle, count);
    if (price <= 0n || price > U128_MAX) return "Invalid price";
    if (price < minPay || price > maxPay) return "The price is outside what the bundle pays";
  }
  return null;
}
/** The taker fee `WorldBooks` charges on `price`: `feeBps`, rounded up. */
export const worldFee = (price: bigint, feeBps: number) =>
  (price * BigInt(feeBps) + 9_999n) / 10_000n;

/** What a product pays out on, inside the world (atoms 1 and up):
 * - `world`: the world happens (every bucket);
 * - `above`: the fixing at or above strike `strike` (1-based);
 * - `below`: below strike `strike`;
 * - `range`: at or above strike `from` and below strike `to`. */
export type WorldOutcome =
  | { kind: "world" }
  | { kind: "above"; strike: number }
  | { kind: "below"; strike: number }
  | { kind: "range"; from: number; to: number };

/** The atom mask of `outcome` in a book of `count` atoms (`count - 2` strikes). */
export function outcomeMask(outcome: WorldOutcome, count: number) {
  const strikes = count - 2;
  const span = (first: number, last: number) => {
    let mask = 0;
    for (let atom = first; atom <= last; atom++) mask |= 1 << atom;
    return mask;
  };
  const strike = (j: number) => {
    if (!Number.isInteger(j) || j < 1 || j > strikes) throw new Error("No such strike");
    return j;
  };
  switch (outcome.kind) {
    case "world":
      return span(1, count - 1);
    case "above":
      return span(strike(outcome.strike) + 1, count - 1);
    case "below":
      return span(1, strike(outcome.strike));
    case "range":
      if (strike(outcome.from) >= strike(outcome.to)) throw new Error("Empty range");
      return span(outcome.from + 1, outcome.to);
  }
}

/** The outcome a mask of contiguous atoms is, or null for any other mask. */
export function maskOutcome(mask: number, count: number): WorldOutcome | null {
  if (!mask || mask & 1 || mask >> count) return null;
  let first = 0,
    last = 0;
  for (let atom = 1; atom < count; atom++)
    if ((mask >> atom) & 1) {
      if (!first) first = atom;
      else if (atom !== last + 1) return null;
      last = atom;
    }
  if (first === 1 && last === count - 1) return { kind: "world" };
  if (last === count - 1) return { kind: "above", strike: first - 1 };
  if (first === 1) return { kind: "below", strike: last };
  return { kind: "range", from: first - 1, to: last };
}

/** The two products every world sells:
 * - `world-bet`: pays a unit if the world happens and the outcome holds;
 * - `conditional`: the same, plus the stake back if the world does not happen. */
export type WorldProductKind = "world-bet" | "conditional";
/** What a bundle is to its holder: its product, outcome and, for a conditional payout, the
 * refund. Bundles of no named shape are `custom`. */
export function productOf(bundle: Bundle, count: number) {
  const outcome = bundle.mask ? maskOutcome(bundle.mask, count) : null;
  const kind: WorldProductKind | "refund" | "custom" = !bundle.mask
    ? "refund"
    : !outcome
      ? "custom"
      : bundle.refund
        ? "conditional"
        : "world-bet";
  return { kind, outcome, units: bundle.units, refund: bundle.refund };
}

/** A product's name, as the API, the RFQ stream and price history key it: `bet:world`,
 * `bet:above:2`, `bet:below:2`, `bet:range:1:3`, `cond:above:2`, ... (strikes 1-based). */
export function productKey(kind: WorldProductKind, outcome: WorldOutcome) {
  const prefix = kind === "world-bet" ? "bet" : "cond";
  switch (outcome.kind) {
    case "world":
      return `${prefix}:world`;
    case "above":
    case "below":
      return `${prefix}:${outcome.kind}:${outcome.strike}`;
    case "range":
      return `${prefix}:range:${outcome.from}:${outcome.to}`;
  }
}
/** The product a key names, or null. */
export function parseProductKey(
  key: string,
): { kind: WorldProductKind; outcome: WorldOutcome } | null {
  const m = /^(bet|cond):(?:(world)|(above|below):([1-8])|range:([1-8]):([1-8]))$/.exec(key);
  if (!m) return null;
  const kind: WorldProductKind = m[1] === "bet" ? "world-bet" : "conditional";
  const outcome: WorldOutcome = m[2]
    ? { kind: "world" }
    : m[3]
      ? { kind: m[3] as "above" | "below", strike: Number(m[4]) }
      : { kind: "range", from: Number(m[5]), to: Number(m[6]) };
  if (outcome.kind === "range" && outcome.from >= outcome.to) return null;
  return { kind, outcome };
}
/** The products a book quotes as standard: the world itself, and above and below each strike
 * as world bets and conditional payouts. An event-only book has only the world bet. */
export function standardProducts(def: Pick<BookDef, "feed" | "strikes">) {
  const count = atomCount(def);
  const list: { key: string; kind: WorldProductKind; outcome: WorldOutcome; mask: number }[] = [];
  const add = (kind: WorldProductKind, outcome: WorldOutcome) =>
    list.push({ key: productKey(kind, outcome), kind, outcome, mask: outcomeMask(outcome, count) });
  add("world-bet", { kind: "world" });
  for (let strike = 1; strike <= count - 2; strike++)
    for (const kind of ["world-bet", "conditional"] as const) {
      add(kind, { kind: "above", strike });
      add(kind, { kind: "below", strike });
    }
  return list;
}

/** A holding, layered into bundles: the full sets it contains (worth exactly their count), the
 * refund units left on atom 0, and nested layers of bucket atoms from the widest down. Every
 * holding decomposes this way, and the parts add back to it exactly. */
export function holdingLayers(balances: readonly bigint[]) {
  const count = balances.length;
  let sets = balances[0] ?? 0n;
  for (const b of balances) if (b < sets) sets = b;
  const rest = balances.map((b) => b - sets);
  const levels = [...new Set(rest.slice(1).filter((b) => b > 0n))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const layers: { mask: number; units: bigint; outcome: WorldOutcome | null }[] = [];
  let below = 0n;
  for (const level of levels) {
    let mask = 0;
    for (let atom = 1; atom < count; atom++) if (rest[atom]! >= level) mask |= 1 << atom;
    layers.push({ mask, units: level - below, outcome: maskOutcome(mask, count) });
    below = level;
  }
  return { sets, refund: rest[0] ?? 0n, layers };
}

// ------------------------------------------------------------------ quotes

/** A maker's signed offer to one taker (`WorldQuote`). */
export interface WorldQuote {
  taker: Address;
  book: bigint;
  mask: number;
  units: bigint;
  refund: bigint;
  /** The taker sells the bundle (a cash-out); false when it buys. */
  sell: boolean;
  /** Raw quote units before the fee. */
  price: bigint;
  /** Unix seconds. */
  expiry: bigint;
  /** Free for a wallet maker; the world vault's quote epoch and signing time (`packMakerData`). */
  makerData: bigint;
  /** Below 2^96 a wallet maker; above, the maker contract in the top 160 bits. */
  nonce: bigint;
}
export const WORLD_QUOTE_TYPES = {
  WorldQuote: [
    { name: "taker", type: "address" },
    { name: "book", type: "uint64" },
    { name: "mask", type: "uint16" },
    { name: "units", type: "uint128" },
    { name: "refund", type: "uint128" },
    { name: "sell", type: "bool" },
    { name: "price", type: "uint128" },
    { name: "expiry", type: "uint40" },
    { name: "makerData", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;
export const worldQuoteDomain = (chainId: number, books: Address) =>
  ({
    name: "Probabl Worlds",
    version: "1",
    chainId,
    verifyingContract: getAddress(books),
  }) as const;
/** `q` as the typed-data message and call argument (viem types a uint40 as a number). */
export const worldQuoteMessage = (q: WorldQuote) => ({ ...q, expiry: Number(q.expiry) });
/** The EIP-712 digest a maker signs (`WorldBooks.quoteDigest`). */
export const worldQuoteDigest = (chainId: number, books: Address, q: WorldQuote) =>
  hashTypedData({
    domain: worldQuoteDomain(chainId, books),
    types: WORLD_QUOTE_TYPES,
    primaryType: "WorldQuote",
    message: worldQuoteMessage(q),
  });

/** The world vault's `makerData`: its quote epoch (low 24 bits) and the signing time (next 40). */
export function packMakerData(epoch: bigint, signedAt: bigint) {
  if (signedAt < 0n || signedAt > U40_MAX) throw new Error("Signing time out of range");
  return (epoch & 0xffffffn) | (signedAt << 24n);
}
export const unpackMakerData = (data: bigint) => ({
  epoch: data & 0xffffffn,
  signedAt: (data >> 24n) & U40_MAX,
});

/** (r, vs) of a 65-byte or 64-byte (EIP-2098) signature, its 65-byte form, and whether its `s`
 * is low (high-s twins are refused on chain). */
export function compactSignature(signature: Hex) {
  const c =
    signature.length === 130
      ? parseCompactSignature(signature)
      : signatureToCompactSignature(parseSignature(signature));
  const vs = BigInt(c.yParityAndS);
  const s = vs & ((1n << 255n) - 1n);
  return {
    r: c.r,
    vs: c.yParityAndS,
    full: `${c.r}${s.toString(16).padStart(64, "0")}${vs >> 255n ? "1c" : "1b"}` as Hex,
    lowS: s <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n,
  };
}

/** Whether `q`'s fields fit their Solidity types. */
export function worldQuoteProblem(q: WorldQuote): string | null {
  if (q.book <= 0n || q.book > U64_MAX) return "Invalid book";
  if (q.expiry <= 0n || q.expiry > U40_MAX) return "Invalid expiry";
  if (q.makerData < 0n || q.makerData > U64_MAX) return "Invalid maker data";
  if (q.nonce < 0n || q.nonce >= 1n << 256n) return "Invalid nonce";
  if (q.price <= 0n || q.price > U128_MAX) return "Invalid price";
  return null;
}
/** Quote nonces at or above this name a maker contract. */
export const CONTRACT_NONCE_FLOOR = U96_MAX + 1n;

// ------------------------------------------------------------------ commitments

/** What the market admin commits before `EventOracle.resolve` (`resolutionHash`). */
export function eventResolutionHash(
  chainId: number,
  oracle: Address,
  key: Hex,
  outcome: number,
  evidence: Hex,
  uri: string,
): Hex {
  if (![EVENT_STATE.yes, EVENT_STATE.no, EVENT_STATE.invalid].includes(outcome))
    throw new Error("An event resolves YES (3), NO (4) or INVALID (5)");
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        "PROBABL_EVM_EVENT_RESOLUTION_V1",
        BigInt(chainId),
        getAddress(oracle),
        key,
        outcome,
        evidence,
        keccak256(stringToBytes(uri)),
      ],
    ),
  );
}
/** What the book admin commits before `WorldBooks.resolveFix` (`fixHash`). */
export function fixHash(
  chainId: number,
  books: Address,
  book: bigint,
  price: bigint,
  evidence: Hex,
  uri: string,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint64" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        "PROBABL_EVM_FIX_V1",
        BigInt(chainId),
        getAddress(books),
        book,
        price,
        evidence,
        keccak256(stringToBytes(uri)),
      ],
    ),
  );
}
/** A bytes32 reason, as `pause`, `freeze` and `setFrozen` take: short text, zero padded. */
export const reasonOf = (text: string): Hex => {
  if (!text || stringToBytes(text).length > 32) throw new Error("A reason is 1 to 32 bytes");
  return stringToHex(text, { size: 32 });
};

// ------------------------------------------------------------------ calls

const call =
  (to: Address, abi: Abi) =>
  (functionName: string, args: readonly unknown[]): Envelope => ({
    to: getAddress(to),
    data: encodeFunctionData({ abi, functionName: functionName as never, args: args as never }),
    value: "0",
  });
const positive = (amount: bigint) => {
  if (amount <= 0n || amount > U128_MAX) throw new Error("Amount must be positive");
  return amount;
};
const signed = (q: WorldQuote, signature: Hex) => {
  const { r, vs } = compactSignature(signature);
  return [worldQuoteMessage(q), r, vs] as const;
};

/** `WorldBooks` calls. Credit is deposited after an ERC-20 `approve` of the books. */
export const worldBooksCalls = (books: Address) => {
  const c = call(books, worldBooksAbi);
  return {
    deposit: (amount: bigint) => c("deposit", [positive(amount)]),
    withdraw: (amount: bigint, to: Address) => c("withdraw", [positive(amount), getAddress(to)]),
    split: (book: bigint, amount: bigint) => c("split", [book, positive(amount)]),
    merge: (book: bigint, amount: bigint) => c("merge", [book, positive(amount)]),
    transferAtoms: (book: bigint, atom: number, to: Address, amount: bigint) =>
      c("transferAtoms", [book, atom, getAddress(to), positive(amount)]),
    fillQuote: (q: WorldQuote, signature: Hex) => c("fillQuote", signed(q, signature)),
    fillQuoteFor: (q: WorldQuote, signature: Hex) => c("fillQuoteFor", signed(q, signature)),
    invalidateNonces: (word: bigint, bits: bigint) => c("invalidateNonces", [word, bits]),
    settle: (book: bigint) => c("settle", [book]),
    redeem: (book: bigint) => c("redeem", [book]),
    redeemMany: (ids: readonly bigint[]) => c("redeemMany", [[...ids]]),
    approveDelegate: (delegate: Address, g: WorldGrantLimits) =>
      c("approveDelegate", [
        getAddress(delegate),
        Number(g.expiresAt),
        g.maxBuy,
        g.totalBuy,
        g.maxSell,
        g.totalSell,
        g.maxFeeBps,
        g.permissions,
      ]),
    revokeDelegate: (delegate: Address) => c("revokeDelegate", [getAddress(delegate)]),
    revokeAllDelegates: () => c("revokeAllDelegates", []),
    // Governance and operations.
    createBook: (def: BookDef, metadataUri: string) => c("createBook", [def, metadataUri]),
    setFrozen: (book: bigint, frozen: boolean, reason: Hex) =>
      c("setFrozen", [book, frozen, reason]),
    pause: (paused: boolean, reason: Hex) => c("pause", [paused, reason]),
    claimFees: (to: Address, amount: bigint) => c("claimFees", [getAddress(to), positive(amount)]),
    proposeFix: (book: bigint, roundId: bigint) => c("proposeFix", [book, roundId]),
    finalizeFix: (book: bigint) => c("finalizeFix", [book]),
    holdFix: (book: bigint) => c("holdFix", [book]),
    commitFix: (book: bigint, commitment: Hex) => c("commitFix", [book, commitment]),
    resolveFix: (book: bigint, price: bigint, evidence: Hex, uri: string) =>
      c("resolveFix", [book, price, evidence, uri]),
    configure: (bookAdmin: Address, guardian: Address, resolutionAdmin: Address) =>
      c("configure", [bookAdmin, guardian, resolutionAdmin]),
  };
};

/** `EventOracle` calls. */
export const eventOracleCalls = (oracle: Address) => {
  const c = call(oracle, eventOracleAbi);
  return {
    freeze: (key: Hex, reason: Hex) => c("freeze", [key, reason]),
    reopen: (key: Hex, reason: Hex) => c("reopen", [key, reason]),
    commit: (key: Hex, commitment: Hex) => c("commit", [key, commitment]),
    resolve: (key: Hex, outcome: number, evidence: Hex, uri: string) =>
      c("resolve", [key, outcome, evidence, uri]),
    configure: (marketAdmin: Address, guardian: Address, resolutionAdmin: Address) =>
      c("configure", [marketAdmin, guardian, resolutionAdmin]),
  };
};

/** `WorldVault` limits (`Limits`). */
export interface WorldVaultLimits {
  maxTtl: number;
  cutoffBuffer: number;
  maxTenor: number;
  maxLegs: number;
  maxFeeBps: number;
  marginBps: number;
  eventOnly: boolean;
}
/** `WorldVault` caps (`Risk`), raw quote units. */
export interface WorldVaultRisk {
  maxQuoteSize: bigint;
  maxQuotePrice: bigint;
  maxBookRisk: bigint;
  maxLegRisk: bigint;
  maxLossBps: number;
  maxDailyExposureBps: number;
}

/** `WorldVault` calls. Deposits pull the stablecoin after an ERC-20 `approve` of the vault. */
export const worldVaultCalls = (vault: Address) => {
  const c = call(vault, worldVaultAbi);
  return {
    seed: (assets: bigint) => c("seed", [positive(assets)]),
    requestDeposit: (assets: bigint) => c("requestDeposit", [positive(assets)]),
    cancelDeposit: (assets: bigint) => c("cancelDeposit", [positive(assets)]),
    requestRedeem: (shares: bigint) => c("requestRedeem", [positive(shares)]),
    cancelRedeem: (shares: bigint) => c("cancelRedeem", [positive(shares)]),
    closeBatch: () => c("closeBatch", []),
    mark: (batch: bigint, nav: bigint) => c("mark", [batch, nav]),
    processAtFloor: (batch: bigint) => c("processAtFloor", [batch]),
    claim: (batch: bigint, owner: Address) => c("claim", [batch, getAddress(owner)]),
    merge: (book: bigint, amount: bigint) => c("merge", [book, positive(amount)]),
    settle: (books: readonly bigint[]) => c("settle", [[...books]]),
    sync: (book: bigint) => c("sync", [book]),
    setLimits: (l: WorldVaultLimits) => c("setLimits", [l]),
    setRisk: (k: WorldVaultRisk) => c("setRisk", [k]),
    setFeed: (feed: Address, allowed: boolean) => c("setFeed", [getAddress(feed), allowed]),
    setDepositCap: (cap: bigint) => c("setDepositCap", [cap]),
    setOpenDeposits: (open: boolean) => c("setOpenDeposits", [open]),
    setWithdrawLimit: (bps: number) => c("setWithdrawLimit", [bps]),
    setMaxMarkMove: (bps: number) => c("setMaxMarkMove", [bps]),
    pause: () => c("pause", []),
    unpause: () => c("unpause", []),
    advanceQuoteEpoch: () => c("advanceQuoteEpoch", []),
    approveMark: (batch: bigint, nav: bigint) => c("approveMark", [batch, nav]),
    grantRole: (role: WorldVaultRole, account: Address) =>
      c("grantRole", [WORLD_VAULT_ROLES[role], getAddress(account)]),
    revokeRole: (role: WorldVaultRole, account: Address) =>
      c("revokeRole", [WORLD_VAULT_ROLES[role], getAddress(account)]),
  };
};

// ------------------------------------------------------------------ delegation

/** A grant to a key that fills quotes for its owner (`approveDelegate`). Buys spend their price
 * plus fee, sells the bundle's largest payout; zero budgets disable a side. */
export interface WorldGrantLimits {
  expiresAt: bigint;
  maxBuy: bigint;
  totalBuy: bigint;
  maxSell: bigint;
  totalSell: bigint;
  maxFeeBps: number;
  /** 1 buy, 2 sell, 3 both. */
  permissions: number;
}
/** Why `approveDelegate` would refuse `g` (null when it would not). */
export function worldGrantProblem(g: WorldGrantLimits, now: bigint): string | null {
  const buys = (g.permissions & WORLD_BUY) !== 0,
    sells = (g.permissions & WORLD_SELL) !== 0;
  if (g.expiresAt <= now || g.expiresAt - now > BigInt(WORLD_MAX_GRANT_SECONDS))
    return "A grant lasts up to 90 days";
  if (!Number.isInteger(g.permissions) || g.permissions < 1 || g.permissions > 3)
    return "Permissions are 1 (buy), 2 (sell) or 3";
  if (!Number.isInteger(g.maxFeeBps) || g.maxFeeBps < 0 || g.maxFeeBps > WORLD_MAX_FEE_BPS)
    return "maxFeeBps is 0 to 1,000";
  for (const v of [g.maxBuy, g.totalBuy, g.maxSell, g.totalSell])
    if (v < 0n || v > U128_MAX) return "Budgets fit 128 bits";
  if (buys && (g.maxBuy === 0n || g.totalBuy < g.maxBuy)) return "Invalid buy budget";
  if (sells && (g.maxSell === 0n || g.totalSell < g.maxSell)) return "Invalid sell budget";
  return null;
}

// ------------------------------------------------------------------ errors

const ERROR_MESSAGES: Record<string, string> = {
  NotTrading: "This world is not trading now.",
  Expired: "The quote expired. Ask for a new one.",
  InvalidBundle: "The bundle or its price is invalid for this book.",
  BadSignature: "The quote's signature is invalid.",
  NonceUsed: "The quote has already been used.",
  SelfTrade: "A maker cannot fill its own quote.",
  MakerRejected: "The market maker declined the fill on chain. Ask for a new quote.",
  FeeCap: "This book's fee exceeds your approved fee limit.",
  InsufficientFunds: "Your available balance is insufficient for this action.",
  DelegationInactive: "Trading permission was revoked, expired or replaced.",
  DelegateBudget: "The trade exceeds your trading permission allowance.",
  InvalidDelegation: "Trading permission is invalid.",
  NothingToRedeem: "There is nothing to redeem in this book.",
  NotDecided: "This world is not decided yet.",
  InvalidState: "The book is not in the required state.",
  UnknownBook: "Unknown book.",
  Unauthorized: "This wallet is not authorized for the action.",
  CapExceeded: "The deposit exceeds the vault's cap.",
  NotDepositor: "Deposits are open to approved depositors only.",
  BatchState: "The vault batch is not in the required state.",
  NothingToClaim: "There is nothing to claim in this batch.",
};
/** The error name of a revert from any world contract, if recognized. */
export function worldError(error: unknown): string | null {
  let data: Hex | undefined;
  if (typeof error === "string" && error.startsWith("0x")) data = error as Hex;
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName)
      return reverted.data.errorName;
    const raw = error.walk((e) => typeof (e as { data?: unknown }).data === "string") as {
      data?: Hex;
    } | null;
    data = raw?.data;
  }
  if (!data) return null;
  for (const abi of [worldBooksAbi, worldVaultAbi, eventOracleAbi])
    try {
      return decodeErrorResult({ abi, data }).errorName;
    } catch {
      // Not this contract's error.
    }
  return null;
}
export function worldErrorMessage(error: unknown, fallback = "The action failed on chain.") {
  const name = worldError(error);
  return (name && ERROR_MESSAGES[name]) ?? fallback;
}
