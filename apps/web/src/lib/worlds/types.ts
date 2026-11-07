/** The `/v2` worlds API as the app reads it (apps/server/src/worlds/opinions.ts and the world
 * index). Amounts are decimal strings of raw quote units; chances and per-unit prices are x 1e6. */

export type Venue = "polymarket" | "kalshi";

/** One venue event as the catalog lists it. */
export interface LegEntry {
  id: string;
  source: Venue;
  marketId: string;
  question: string;
  label: string;
  event: string;
  outcome: string | null;
  yes: number | null;
  bid: number | null;
  ask: number | null;
  endTime: string;
  url: string;
  image: string | null;
  rules: string;
  exclusive: boolean;
  group: string;
  volume: number;
  themes: string[];
}
export interface DraftLeg extends LegEntry {
  wantYes: boolean;
  note: string | null;
  alternatives: LegEntry[];
}
export interface DraftStock {
  underlying: string;
  symbol: string;
  name: string;
  direction: "above" | "below";
  strike: string | null;
  date: string | null;
  spot: number | null;
}
export interface Draft {
  id: string;
  text: string;
  source: "assistant" | "search";
  legs: DraftLeg[];
  stock: DraftStock | null;
  suggestions: LegEntry[];
  notes: string[];
}

/** An opinion as the API prices and opens it. */
/** An event of a world being built: the venue event, the side the world needs, the reader's
 * note on it and other events it could have meant. */
export interface LegState {
  entry: LegEntry;
  wantYes: boolean;
  note: string | null;
  alternatives: LegEntry[];
}
/** The stock of a world being built (`strike` in dollars, `date` a New York calendar date). */
export interface StockState {
  underlying: string;
  symbol: string;
  name: string;
  direction: "above" | "below";
  strike: string;
  date: string;
  spot: number | null;
}

export interface Spec {
  legs: { id: string; wantYes: boolean }[];
  stock: { underlying: string; direction: "above" | "below"; strike: string; date: string } | null;
}

export interface Stock {
  underlying: string;
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "crypto";
  logo: string | null;
  spot: number | null;
}

/** How a maker explains a world's price. */
export interface Analytics {
  legs: { eventKey: string; chance: number }[];
  chain: number[];
  naive: number[];
  world: number;
  spot: number | null;
  forward: number | null;
  move: number | null;
}
export interface Ending {
  key: "win" | "lose-in-world" | "world-fails";
  chance: number;
  pays: string;
}
export interface OfferProduct {
  key: string;
  name: "All-in" | "Money-back";
  stake: string;
  units: string | null;
  payout: string | null;
  ask: number | null;
  decline: string | null;
  endings: Ending[];
}
export interface WorldLegView extends LegEntry {
  wantYes: boolean;
  eventKey: string;
}
export interface WorldView {
  sentence: string;
  specHash: string;
  legs: WorldLegView[];
  stock: {
    underlying: string;
    symbol: string;
    name: string;
    kind: string;
    logo: string | null;
    decimals: number;
    direction: "above" | "below";
    strike: string;
    date: string;
    spot: number | null;
  } | null;
  fixingTime: number | null;
  cutoff: number;
  feeBps: number;
}
export interface Preview {
  world: WorldView;
  notes: string[];
  existing: { defHash: string; book: number | null } | null;
  problems: string[];
  offer: OfferProduct[] | null;
  chance: Analytics | null;
  priorOnly?: boolean;
  /** A curated world's story and its events' short names (the worlds page's one-tap buttons). */
  curated?: { story: string; short: string[] };
  marks?: number[] | null;
}

/** A world's book as the index serves it (`/v2/books/:book`). */
export interface BookLeg {
  eventKey: string;
  wantYes: boolean;
  state: "open" | "frozen" | "resolving" | "yes" | "no" | "invalid";
  outcome: "passed" | "failed" | null;
  resolvedAt: string | null;
  venue: {
    source: Venue;
    marketId: string;
    conditionId: string;
    question: string;
    url: string;
    endTime: string;
    themes: string[];
  } | null;
}
export interface BookProduct {
  key: string;
  kind: "world-bet" | "conditional";
  outcome: { kind: string; strike?: number };
  mask: number;
  bid: number | null;
  ask: number | null;
}
export interface Opinion {
  sentence: string;
  direction: "above" | "below" | null;
  strike: string | null;
  symbol: string | null;
  fixingDate: string | null;
}
export interface BookView {
  id: number;
  defHash: string;
  title: string | null;
  kind: "curated" | "user" | null;
  opinion: Opinion | null;
  creator: string | null;
  state: string;
  tradable: boolean;
  eventOnly: boolean;
  legs: BookLeg[];
  underlying: string | null;
  feedDecimals: number | null;
  fixingRule: string | null;
  fixingTime: string | null;
  cutoff: string;
  feeBps: number;
  strikes: { raw: string; price: string }[];
  atoms: number;
  metadataUri: string;
  winner: number | null;
  decidedAt: string | null;
  fixing: { price: string | null; display: string | null };
  fills: number;
  volume: string;
  createdAt: string;
  products: BookProduct[];
  marks: number[] | null;
  analytics: Analytics | null;
}
export interface FeedWorld {
  book: number;
  defHash: string;
  sentence: string;
  opinion: Opinion | null;
  creator: string | null;
  state: string;
  tradable: boolean;
  decided: boolean;
  legs: {
    eventKey: string;
    wantYes: boolean;
    state: string;
    outcome: string | null;
    label: string | null;
    source: Venue | null;
    endTime: string | null;
    chance: number | null;
  }[];
  underlying: string | null;
  fixingTime: string | null;
  cutoff: string;
  marks: number[] | null;
  analytics: Analytics | null;
  products: BookProduct[];
  traders: number;
  staked: string;
  fills: number;
  lastAt: string;
  createdAt: string;
  latest: {
    taker: string;
    product: "All-in" | "Money-back";
    sell: boolean;
    price: string;
    time: string;
  }[];
}
export interface Holder {
  owner: string;
  product: "All-in" | "Money-back";
  outcomes: { outcome: { kind: string; strike?: number } | null; units: string }[];
  refund: string;
  maxPayout: string;
  value: string | null;
  paid: string;
  received: string;
  since: string;
}
export interface WorldFill {
  book: number;
  time: string;
  transactionHash: string;
  taker: string;
  mask: number;
  sell: boolean;
  units: string;
  refund: string;
  price: string;
  fee: string;
}
export interface PositionView {
  book: number;
  state: string;
  atoms: string[];
  sets: string;
  refund: string;
  layers: {
    mask: number;
    units: string;
    outcome: { kind: string; strike?: number } | null;
    product: string | null;
  }[];
  minPayout: string;
  maxPayout: string;
  value: string | null;
  redeemable: boolean;
  payout: string | null;
}
export interface WorldWallet {
  owner: string;
  credit: string;
  grants: {
    delegate: string;
    expiresAt: string;
    remainingBuy: string;
    remainingSell: string;
    active: boolean;
  }[];
  positions: PositionView[];
}
export interface WorldPermission {
  available: boolean;
  delegate: string | null;
  owner: string;
  active: boolean;
  credit: string;
}
