import type { MarketUnits } from "@conditional-stocks/domain";

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
export interface MarketView extends MarketUnits {
  baseStep: string;
  baseToken: string;
  cutoff: string;
  description: string;
  eventImpact: number | null;
  id: string;
  lifecycle: MarketLifecycle;
  mapping: { conditionId: string; noIndex: string; polymarketUrl: string; yesIndex: string };
  no: BranchBook;
  ordinaryReference: number | null;
  probability: ProbabilityView;
  question: string;
  quoteToken: string;
  residual: number | null;
  sourceMode: "live" | "preview" | "demo";
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
  marketId: string;
  quantity: string;
  remaining: string;
  reserved: string;
  side: number;
  status: string;
  tif: number;
  updatedBlock: string;
}
export interface WholeBalanceView {
  decimals: number;
  account: string;
  blockNumber: string;
  canonicalBalance: string;
  token: string;
}
export interface PositionView extends MarketUnits {
  conditionId: string;
  marketId: string;
  quoteNo: string;
  quoteYes: string;
  redeemable: boolean;
  stockNo: string;
  stockYes: string;
}
export interface TradeView {
  branch: number;
  blockTimestamp: string;
  executionPriceRawX18: string;
  fillQuantity: string;
  id: string;
  marketId: string;
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
