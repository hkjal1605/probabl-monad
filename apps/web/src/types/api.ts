import type { ShareUnits } from "@conditional-stocks/domain";
import type { SpotPrice } from "@conditional-stocks/shared/spot-prices";
import type { TokenDisplayMetadata } from "../lib/tokens/catalog";

export type MarketLifecycle =
  | "scheduled"
  | "open"
  | "frozen"
  | "awaiting-resolution"
  | "resolved"
  | "redeemable"
  | "archived";
export type DataQuality =
  | "valid"
  | "low-depth"
  | "stale"
  | "one-sided"
  | "empty"
  | "crossed"
  | "disconnected";
export interface BookLevel {
  priceExact: string;
  price: number;
  /** Level total in base tokens (display only). */
  quantity: number;
}
export interface BranchBook {
  bestAskExact: string | null;
  bestBidExact: string | null;
  bestAsk: number | null;
  bestBid: number | null;
  asks: BookLevel[];
  bids: BookLevel[];
  depthUsd: number;
  spread: number | null;
}
export interface ProbabilityView {
  ask: number | null;
  bid: number | null;
  observedAt: string | null;
  quality: DataQuality;
  value: number | null;
}
/** Live issuer state of the base token, read by the indexer from the token contract. */
export interface BaseLiveView {
  /** Issuer UI multiplier x 1e18 (economic shares per whole token), decimal string. */
  multiplier: string;
  multiplierValue: number;
  paused: boolean;
  tradable: boolean;
  halt: "issuer-paused" | null;
}
/** The market's stock token. Each deployment has one issuer, so a market has one base token. */
export interface BaseTokenView {
  token: string;
  decimals: number;
  /** Display symbol (falls back to the market ticker). */
  symbol: string;
  name: string | null;
  live: BaseLiveView;
  metadata?: TokenDisplayMetadata;
}
export interface MarketView extends ShareUnits {
  /** Quantity step in raw base units. */
  baseStep: string;
  priceTickRawX18?: string;
  bookQuality?: "available" | "unavailable" | "truncated";
  base: BaseTokenView;
  /** Stable identity of the traded asset (e.g. `asset:NVDA`) used to group sibling markets. */
  assetKey: string;
  assetMetadata?: TokenDisplayMetadata;
  quoteTokenMetadata?: TokenDisplayMetadata;
  cutoff: string;
  createdAt?: string | null;
  description: string;
  eventImpact: number | null;
  id: string;
  lifecycle: MarketLifecycle;
  mapping: { conditionId: string; noIndex: string; polymarketUrl: string; yesIndex: string };
  no: BranchBook;
  ordinaryReference: number | null;
  spotReference?: SpotPrice;
  quoteSpotReference?: SpotPrice;
  probability: ProbabilityView;
  question: string;
  imageUrl?: string | null;
  quoteToken: string;
  residual: number | null;
  ticker: string;
  tradingOpen: string;
  yes: BranchBook;
}
export interface IndexedOrder {
  maxFeeBps?: number;
  feesPaid?: string;
  branch: number;
  confirmation?: string;
  expiry: string;
  fundingKind: number;
  id: string;
  limitPriceRawX18: string;
  maker: string;
  /** Service key that placed the order under the owner's trading approval. */
  delegate?: string;
  marketId: string;
  /** Raw base units. */
  quantity: string;
  filled: string;
  remaining: string;
  /** Raw units of the funding asset (quote for buys, the base token for sells). */
  reserved: string;
  side: number;
  status: string;
  tif: number;
  createdAt?: string;
  transactionHash?: string;
  updatedBlock: string;
}
export interface WholeBalanceView {
  /** Unreserved vault credit. */
  vaultAvailable: string;
  /** Credit reserved by open whole-funded orders. */
  reserved: string;
  decimals: number;
  account: string;
  blockNumber: string;
  /** ERC-20 balance of the wallet itself. */
  canonicalBalance: string;
  token: string;
}
export interface PayoutCreditView {
  scope: "global" | "market";
  id: string;
  beneficiary: string;
  asset: string;
  tokenId: string;
  amount: string;
  collateralToken: string;
  decimals: number;
  branch: "YES" | "NO" | null;
  kind: "stock" | "quote";
  /** 0 quote, 1 base token (market claims only). */
  collateral: number | null;
  marketId: string | null;
  confirmation: string;
}
/** Claims of one market, in raw units of the quote and base tokens. */
export interface PositionView {
  conditionId: string;
  marketId: string;
  shareDecimals: number;
  quoteTokenDecimals: number;
  protocolVersion: number;
  baseToken: string;
  baseTokenDecimals: number;
  quoteYes: string;
  quoteNo: string;
  baseYes: string;
  baseNo: string;
  redeemable: boolean;
}
export interface TradeView {
  branch: number;
  blockTimestamp: string;
  confirmation?: string;
  executionPriceRawX18: string;
  executionQuote?: string;
  /** Raw base units. */
  fillQuantity: string;
  buyerFee?: string;
  sellerFee?: string;
  takerSide?: number;
  maker?: string;
  taker?: string;
  id: string;
  makerOrderHash?: string;
  marketId: string;
  takerOrderHash?: string;
  transactionHash: string;
}
export interface ResolutionView {
  admin: string | null;
  evidenceHash: string | null;
  evidenceUri: string | null;
  noPayout: string | null;
  payoutDenominator: string | null;
  transactionHash: string | null;
  yesPayout: string | null;
}
