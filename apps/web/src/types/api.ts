import type { ShareUnits } from "@conditional-stocks/domain";
import type { FeeRates } from "@conditional-stocks/evm-client";
import type { EventSource } from "@conditional-stocks/market-data";
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
  /** The RFQ makers' current prices for a $100 order, folded into the best bid and ask above. */
  quote?: { bid: string | null; ask: string | null };
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
/** The on-chain market a view or position lives on: deployment and on-chain market id. */
export interface VenueView {
  chainId: number;
  exchange: string;
  marketId: string;
}
export interface MarketView extends ShareUnits {
  /** Quantity step in raw base units. */
  baseStep: string;
  priceTickRawX18?: string;
  /** Fee rates in bps, fixed when the market was created: resting orders pay the maker rate
   * and incoming ones the taker rate, on what they receive. */
  fees: FeeRates;
  /** The filled maker's share of each fill's taker fee, in bps of that fee (the market admin
   * may change it), paid in the claims the fee is charged in. */
  makerRebateBps: number;
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
  /** Chain-independent public market id (16 hex digits). */
  id: string;
  /** URL segment: ticker prefix plus `id`. */
  slug: string;
  /** Underlying asset, e.g. "US:NVDA". */
  underlying: string | null;
  /** Where this market trades: transactions use `venue.marketId`, never `id`. */
  venue: VenueView;
  lifecycle: MarketLifecycle;
  /** The venue market (Polymarket or Kalshi) the market is conditioned on. */
  mapping: {
    conditionId: string;
    noIndex: string;
    source: EventSource;
    sourceUrl: string;
    yesIndex: string;
  };
  no: BranchBook;
  ordinaryReference: number | null;
  spotReference?: SpotPrice;
  quoteSpotReference?: SpotPrice;
  probability: ProbabilityView;
  question: string;
  /** The venue event's schedule and series (display only: categories and the calendar). */
  event?: {
    /** When the venue's event resolves or fixes, ISO; null when it doesn't say. */
    endTime: string | null;
    /** Kalshi's series and event tickers: a price ladder's strikes share an event. */
    series?: string;
    eventTicker?: string;
    /** The side the venue settled to, once known (Kalshi). */
    result: "yes" | "no" | null;
  };
  imageUrl?: string | null;
  quoteToken: string;
  residual: number | null;
  ticker: string;
  tradingOpen: string;
  /** Quote traded in the last 24 hours, approximate display units (one quote token counts as
   * $1); null until the indexer has counted it. */
  volume24h: number | null;
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
  /** Public market id. */
  marketId: string;
  venue?: VenueView;
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
  /** Public market id of market claims. */
  marketId: string | null;
  venue?: VenueView;
  confirmation: string;
}
/** Claims of one market, in raw units of the quote and base tokens. */
export interface PositionView {
  /** On-chain market id (as `venue.marketId`). */
  conditionId: string;
  /** Public market id. */
  marketId: string;
  venue: VenueView;
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
  /** Paid to the maker out of the taker's fee, in the same claims. */
  makerRebate?: string;
  takerSide?: number;
  maker?: string;
  taker?: string;
  id: string;
  makerOrderHash?: string;
  /** Public market id. */
  marketId: string;
  venue?: VenueView;
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
