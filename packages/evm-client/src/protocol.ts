import {
  type Address,
  encodeAbiParameters,
  getAddress,
  type Hex,
  isAddress,
  keccak256,
  stringToBytes,
  zeroAddress,
} from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";

export const WAD = 10n ** 18n;
export const BPS = 10_000n;
export const MAX_FEE_BPS = 1_000;
/** The largest maker rebate, in bps of each fill's taker fee: half, so matching one's own
 * orders always costs more than it returns. */
export const MAX_REBATE_BPS = 5_000;
/** Resting makers one placement can fill (all fit one packed calldata word). */
export const MAX_MAKERS = 8;
/** Resting placements per branch retained on chain for the crossed-book race check. */
export const RECENT = 16;
export const U32_MAX = (1n << 32n) - 1n;
export const U40_MAX = (1n << 40n) - 1n;
export const U64_MAX = (1n << 64n) - 1n;
export const U96_MAX = (1n << 96n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;
export const MAX_GRANT_LIFETIME_SECONDS = 90 * 24 * 60 * 60;

/** Market lifecycle (numbering shared with the Solana deployment; 5 is unused). */
export const SCHEDULED = 1;
export const OPEN = 2;
export const FROZEN = 3;
export const AWAITING = 4;
export const REDEEMABLE = 6;
export const ARCHIVED = 7;

export const DELEGATE_TRADE = 1;
export const DELEGATE_CANCEL = 2;

/** A market's fee rates in bps, fixed when it is created. A fill charges its resting side the
 * maker rate and its incoming side the taker rate, on what each receives. */
export interface FeeRates {
  makerBps: number;
  takerBps: number;
}
export const isFeeRate = (rate: unknown): rate is number =>
  Number.isInteger(rate) && (rate as number) >= 0 && (rate as number) <= MAX_FEE_BPS;
/** A market's maker rebate: the share of each fill's taker fee, in bps of that fee, paid to the
 * filled maker. The market admin may change it at any time. */
export const isRebateRate = (rate: unknown): rate is number =>
  Number.isInteger(rate) && (rate as number) >= 0 && (rate as number) <= MAX_REBATE_BPS;
/** What a maker rebate pays the filled maker on one fill: its share of the taker's fee, rounded
 * down as the exchange rounds it, in the claims the fee was charged in. */
export const makerRebate = (takerFee: bigint, rebateBps: number) =>
  (takerFee * BigInt(rebateBps)) / BPS;
/** The edge, in bps of the price, a maker's quote needs to break even on a market's fees: its
 * maker fee less its rebate, rounded up; negative when the rebate outweighs the fee. An ask at P
 * nets P(1 - m)/(1 - r) and a bid at P pays P(1 - r)/(1 - m) (maker rate m, rebate r of the
 * fill: rebate share x taker rate); (m - r)/(1 - m) covers both. */
export function makerFeeEdge(market: { makerBps: number; takerBps: number; rebateBps: number }) {
  const net = BigInt(market.makerBps) * BPS - BigInt(market.takerBps) * BigInt(market.rebateBps);
  const denominator = BPS - BigInt(market.makerBps);
  // BigInt division truncates toward zero: up for a negative edge, so round a positive one up.
  return net > 0n ? (net + denominator - 1n) / denominator : net / denominator;
}
/** The fee cap an order signs to trade a market at its rates: an immediate-or-cancel order only
 * takes, a resting one may take and then make. */
export const orderFeeCap = (rates: FeeRates, tif: number) =>
  tif === 1 ? rates.takerBps : Math.max(rates.makerBps, rates.takerBps);
/** A bps rate as a percentage: 25 → "0.25%". */
export const formatBps = (bps: number) => `${bps / 100}%`;

/** Collateral 0 is the deployment quote token, 1 the market's base (stock) token. */
export const QUOTE = 0;
export const BASE = 1;
/** Six asset indexes per market. Per collateral c: underlying 3c, YES claim 3c + 1, NO 3c + 2. */
export const ASSETS = 6;
export const underlyingAsset = (collateral: number) => 3 * collateral;
export const claimAsset = (collateral: number, branch: number) => 3 * collateral + 1 + branch;
export const collateralOf = (asset: number) => Math.floor(asset / 3);
export const branchOf = (asset: number) => (asset % 3) - 1;
export const isClaimAsset = (asset: number) =>
  Number.isInteger(asset) && asset >= 0 && asset < ASSETS && asset % 3 !== 0;

/** An order as reviewed by the user and the API. Prices are raw quote units per raw base unit
 * x 1e18 (a multiple of the market tick); quantities are raw base units. */
export interface OrderWire {
  /** Beneficial owner of funds, positions and proceeds. */
  maker: Address;
  /** Signing key of a delegated placement (`placeFor`); omitted for owner-signed orders. */
  delegate?: Address;
  marketId: string;
  quantity: string;
  limitPriceRawX18: string;
  expiry: string;
  maxFeeBps: number;
  /** 0 YES, 1 NO. */
  branch: number;
  /** 0 buy, 1 sell. */
  side: number;
  /** 0 underlying credit ("whole"), 1 active-branch claim. */
  fundingKind: number;
  /** 0 good-till-cancelled (rests), 1 immediate-or-cancel. */
  tif: number;
}

export function address(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false }))
    throw new Error("Expected an EVM address");
  const checksummed = getAddress(value);
  if (checksummed === zeroAddress) throw new Error("Zero address is not allowed");
  return checksummed;
}

export function unsigned(value: unknown, maximum = U128_MAX): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value))
    throw new Error("Invalid integer amount");
  const result = BigInt(value);
  if (result > maximum) throw new Error("Amount exceeds the supported integer range");
  return result;
}

export function marketNumber(value: unknown): number {
  const id = typeof value === "number" ? value : Number(unsigned(value, U32_MAX));
  if (!Number.isSafeInteger(id) || id <= 0 || BigInt(id) > U32_MAX)
    throw new Error("Invalid market id");
  return id;
}

export function parseOrder(value: unknown): OrderWire {
  if (!value || typeof value !== "object") throw new Error("Invalid order");
  const o = value as OrderWire;
  const maker = address(o.maker);
  const marketId = String(marketNumber(o.marketId));
  if (unsigned(o.quantity, U96_MAX) === 0n || unsigned(o.limitPriceRawX18, U128_MAX) === 0n)
    throw new Error("Zero order size or price");
  unsigned(o.expiry, U40_MAX);
  for (const field of [o.branch, o.side, o.fundingKind, o.tif])
    if (field !== 0 && field !== 1) throw new Error("Invalid order enum");
  if (!Number.isInteger(o.maxFeeBps) || o.maxFeeBps < 0 || o.maxFeeBps > MAX_FEE_BPS)
    throw new Error("Invalid fee cap");
  let delegate: Address | undefined;
  if (o.delegate !== undefined) {
    delegate = address(o.delegate);
    if (delegate === maker) throw new Error("A delegate cannot be the owner");
  }
  return {
    maker,
    ...(delegate ? { delegate } : {}),
    marketId,
    quantity: o.quantity,
    limitPriceRawX18: o.limitPriceRawX18,
    expiry: o.expiry,
    maxFeeBps: o.maxFeeBps,
    branch: o.branch,
    side: o.side,
    fundingKind: o.fundingKind,
    tif: o.tif,
  };
}

/** Order key used on chain and as the indexed order id: market << 40 | branch << 32 | seq. */
export const orderKey = (market: number | string | bigint, branch: number, seq: bigint | number) =>
  (BigInt(market) << 40n) | (BigInt(branch) << 32n) | BigInt(seq);
export function parseOrderKey(key: bigint | string) {
  const value = BigInt(key);
  return {
    market: Number(value >> 40n),
    branch: Number((value >> 32n) & 1n),
    seq: value & U32_MAX,
  };
}

/** Funding asset of an order: the quote for buys, the base for sells; underlying or active claim. */
export const orderCollateral = (o: Pick<OrderWire, "side">) => (o.side === 0 ? QUOTE : BASE);
export const fundingAsset = (o: Pick<OrderWire, "side" | "fundingKind" | "branch">) =>
  o.fundingKind === 0
    ? underlyingAsset(orderCollateral(o))
    : claimAsset(orderCollateral(o), o.branch);

// ------------------------------------------------------------------ math (mirrors the contract)

export function quote(quantity: bigint, price: bigint, up = false): bigint {
  if (quantity < 0n || price < 0n) throw new Error("Invalid price/quantity");
  const product = quantity * price;
  return product / WAD + (up && product % WAD !== 0n ? 1n : 0n);
}

/** Fee on a gross received amount with the order's fractional carry (< 10_000). */
export function fee(gross: bigint, rate: number, carry: number): [bigint, number] {
  if (rate === 0) return [0n, carry];
  const numerator = gross * BigInt(rate) + BigInt(carry);
  return [numerator / BPS, Number(numerator % BPS)];
}

/** Reservation of an order's remaining quantity: its notional for buys, the base for sells. */
export const reservation = (side: number, remaining: bigint, price: bigint) =>
  side === 0 ? quote(remaining, price, true) : remaining;

// ------------------------------------------------------------------ calldata packing

export interface MarketTerms {
  tick: bigint;
  step: bigint;
  maxSteps: bigint;
  minNotional: bigint;
  maxOrder: bigint;
  maxWallet: bigint;
  maxMarket: bigint;
  open: bigint;
  cutoff: bigint;
}

/** Packed order word: market | flags << 32 | maxFeeBps << 40 | expiry << 56 | ticks << 96 | quantity << 160. */
export function packOrder(order: OrderWire, tick: bigint): bigint {
  const o = parseOrder(order);
  const price = BigInt(o.limitPriceRawX18);
  if (tick <= 0n || price % tick !== 0n)
    throw new Error("Price is not a multiple of the market tick");
  const ticks = price / tick;
  if (ticks > U64_MAX) throw new Error("Price is outside the supported range");
  const flags =
    BigInt(o.branch) |
    (BigInt(o.side) << 1n) |
    (BigInt(o.fundingKind) << 2n) |
    (BigInt(o.tif) << 3n);
  return (
    BigInt(o.marketId) |
    (flags << 32n) |
    (BigInt(o.maxFeeBps) << 40n) |
    (BigInt(o.expiry) << 56n) |
    (ticks << 96n) |
    (BigInt(o.quantity) << 160n)
  );
}

export function unpackOrder(word: bigint) {
  const flags = Number((word >> 32n) & 0xffn);
  return {
    market: Number(word & U32_MAX),
    branch: flags & 1,
    side: (flags >> 1) & 1,
    fundingKind: (flags >> 2) & 1,
    tif: (flags >> 3) & 1,
    maxFeeBps: Number((word >> 40n) & 0xffffn),
    expiry: (word >> 56n) & U40_MAX,
    ticks: (word >> 96n) & U64_MAX,
    quantity: word >> 160n,
  };
}

/** Packed plan: nextSeq | deadline << 32 | minFill << 72. */
export function packPlan(nextSequence: bigint, deadline: bigint, minFill: bigint): bigint {
  if (
    nextSequence < 0n ||
    nextSequence > U32_MAX ||
    deadline <= 0n ||
    deadline > U40_MAX ||
    minFill < 0n ||
    minFill > U96_MAX
  )
    throw new Error("Invalid execution plan");
  return nextSequence | (deadline << 32n) | (minFill << 72n);
}

/** Up to MAX_MAKERS maker sequences (+1 each), 32 bits apiece. */
export function packMakers(sequences: readonly bigint[]): bigint {
  if (sequences.length > MAX_MAKERS) throw new Error(`At most ${MAX_MAKERS} makers per placement`);
  let word = 0n;
  for (const [i, seq] of sequences.entries()) {
    if (seq < 0n || seq >= U32_MAX) throw new Error("Invalid maker sequence");
    word |= (seq + 1n) << BigInt(32 * i);
  }
  return word;
}

// ------------------------------------------------------------------ identities

/** keccak256 of the exact metadata URI bytes (the on-chain `metadataHash`). */
export const metadataHash = (uri: string) => keccak256(stringToBytes(uri));

export function resolutionHash(
  chainId: number,
  exchange: Address,
  market: number,
  yes: number,
  no: number,
  evidence: Hex,
  uri: string,
): Hex {
  if (
    ![
      [1, 0],
      [0, 1],
      [1, 1],
    ].some(([y, n]) => y === yes && n === no)
  )
    throw new Error("Invalid payout");
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint32" },
        { type: "uint8" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        "PROBABL_EVM_RESOLUTION_V1",
        BigInt(chainId),
        exchange,
        market,
        yes,
        no,
        evidence,
        keccak256(stringToBytes(uri)),
      ],
    ),
  );
}

export interface Deployment {
  chainId: number;
  exchange: Address;
}

/** The statement every sign-in message carries. */
export const SIGN_IN_STATEMENT = "Sign in to probabl.";
const exchangeResource = (exchange: Address) => `urn:probabl:exchange:${getAddress(exchange)}`;
const inviteResource = (code: string) => `urn:probabl:invite:${code}`;

/** A Sign-In with Ethereum (EIP-4361) message for this deployment, bound to the page's origin:
 * wallets show it as a sign-in and warn when the page is on another domain. The exchange is a
 * resource; a new member's invite code is another, so one signature both signs in and joins. */
export function signInMessage(
  deployment: Deployment,
  origin: string,
  owner: Address,
  nonce: string,
  expiresAt: Date,
  options: { issuedAt?: Date; invite?: string | null } = {},
) {
  const page = new URL(origin);
  return createSiweMessage({
    domain: page.host,
    address: getAddress(owner),
    statement: SIGN_IN_STATEMENT,
    uri: page.origin,
    version: "1",
    chainId: deployment.chainId,
    nonce,
    issuedAt: options.issuedAt ?? new Date(),
    expirationTime: expiresAt,
    resources: [
      exchangeResource(deployment.exchange),
      ...(options.invite ? [inviteResource(options.invite)] : []),
    ],
  });
}

/** The invite code a sign-in message carries, if any. */
export function signInInvite(message: string): string | null {
  const resources = parseSiweMessage(message).resources ?? [];
  const resource = resources.find((r) => r.startsWith("urn:probabl:invite:"));
  return resource ? resource.slice("urn:probabl:invite:".length) : null;
}

/** The browser checks the API's challenge before asking the wallet to sign it: every field must
 * be exactly what this page asked for, and it must expire within a few minutes of being issued.
 * Both times are the API's, so this page's clock (which may be off by any amount) is not used;
 * the API refuses a stale or reused challenge itself. */
export function assertSignInChallenge(
  challenge: { challengeId: string; message: string },
  owner: string,
  deployment: Deployment,
  origin: string,
  invite: string | null = null,
) {
  const page = new URL(origin);
  const m = parseSiweMessage(challenge.message);
  const resources = [
    exchangeResource(deployment.exchange),
    ...(invite ? [inviteResource(invite)] : []),
  ];
  if (
    !/^[a-f0-9]{64}$/.test(challenge.challengeId) ||
    m.domain !== page.host ||
    m.uri !== page.origin ||
    m.scheme !== undefined ||
    m.address !== address(owner) ||
    m.chainId !== deployment.chainId ||
    m.version !== "1" ||
    m.statement !== SIGN_IN_STATEMENT ||
    m.nonce !== challenge.challengeId ||
    m.notBefore !== undefined ||
    m.requestId !== undefined ||
    JSON.stringify(m.resources) !== JSON.stringify(resources) ||
    !(m.issuedAt instanceof Date) ||
    !(m.expirationTime instanceof Date) ||
    // Nothing else may hide in the text: it is exactly the message these fields make.
    createSiweMessage(m as Parameters<typeof createSiweMessage>[0]) !== challenge.message
  )
    throw new Error("Sign-in challenge differs from this deployment.");
  const lifetime = m.expirationTime.getTime() - m.issuedAt.getTime();
  if (lifetime <= 0 || lifetime > 150_000)
    throw new Error("Sign-in challenge is expired or has an invalid lifetime.");
}
