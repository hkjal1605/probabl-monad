import type { DeltaVaultClaimsView, DeltaVaultView } from "@/services/delta-vaults-api-service";

const big = (c: DeltaVaultClaimsView) => ({
  yesQuote: BigInt(c.yesQuote),
  noQuote: BigInt(c.noQuote),
  yesBase: BigInt(c.yesBase),
  noBase: BigInt(c.noBase),
});

/** Quote held in the richest branch of every market: what deposits are measured against. */
export function quoteHigh(v: DeltaVaultView) {
  return v.holdings.markets.reduce((sum, m) => {
    const c = big(m.claims);
    return sum + (c.yesQuote > c.noQuote ? c.yesQuote : c.noQuote);
  }, BigInt(v.holdings.quote));
}
export function baseHigh(v: DeltaVaultView) {
  return v.holdings.markets.reduce((sum, m) => {
    const c = big(m.claims);
    return sum + (c.yesBase > c.noBase ? c.yesBase : c.noBase);
  }, BigInt(v.holdings.base));
}

/** A market's claims split into pairs (as good as plain tokens) and the unpaired rest. */
export function unpaired(c: DeltaVaultClaimsView) {
  const v = big(c);
  const quote = v.yesQuote < v.noQuote ? v.yesQuote : v.noQuote,
    base = v.yesBase < v.noBase ? v.yesBase : v.noBase;
  return {
    paired: { quote, base },
    yesQuote: v.yesQuote - quote,
    noQuote: v.noQuote - quote,
    yesBase: v.yesBase - base,
    noBase: v.noBase - base,
  };
}
