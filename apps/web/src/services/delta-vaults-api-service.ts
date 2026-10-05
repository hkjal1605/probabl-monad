import { requestJson } from "./api";

/** Claims of one market per branch and collateral, raw units. */
export interface DeltaVaultClaimsView {
  yesQuote: string;
  noQuote: string;
  yesBase: string;
  noBase: string;
}
export interface DeltaVaultTokenView {
  token: string;
  symbol: string | null;
  decimals: number | null;
}
export interface DeltaVaultMarketView {
  venueId: number;
  /** The exchange's view of the market (`id` is the public market id). */
  market: { id: string; slug?: string } | null;
  /** YES probability x 1e6. */
  probability: string | null;
  cutoff: number;
  risk: {
    bandBps: number;
    cutoffBuffer: number;
    maxOrder: string;
    maxResting: string;
    maxImbalance: string;
  };
  /** YES-minus-NO stock held, and its extremes if every resting quote filled. */
  exposure: { imbalance: string; high: string; low: string; resting: string };
  orders: number;
}
export interface DeltaVaultView {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  exchange: string;
  quote: DeltaVaultTokenView;
  base: DeltaVaultTokenView & { underlying: string | null };
  paused: boolean;
  totalSupply: string;
  caps: { quote: string; base: string };
  withdrawLimitBps: number;
  withdrawable: string;
  /** Exchange price units (raw quote per raw base x 1e18). */
  oraclePrice: string | null;
  /** Display-only estimates in raw quote units. */
  value: string | null;
  valuePerShare: string | null;
  holdings: {
    quote: string;
    base: string;
    freeQuote: string;
    freeBase: string;
    markets: { venueId: number; claims: DeltaVaultClaimsView; free: DeltaVaultClaimsView }[];
  };
  markets: DeltaVaultMarketView[];
}
export interface DeltaVaultAccountView {
  vault: string;
  owner: string;
  shares: string;
  wallet: { quote: string; base: string };
  allowance: { quote: string; base: string };
  redeems: {
    quote: string;
    base: string;
    claims: (DeltaVaultClaimsView & { venueId: number | null })[];
  } | null;
}

export const getDeltaVaults = (signal: AbortSignal) =>
  requestJson<{ vaults: DeltaVaultView[] }>("/v1/delta-vaults", { signal });
export const getDeltaVaultAccount = (vault: string, owner: string, signal: AbortSignal) =>
  requestJson<DeltaVaultAccountView>(`/v1/delta-vaults/${vault}/accounts/${owner}`, {
    signal,
    auth: true,
  });
