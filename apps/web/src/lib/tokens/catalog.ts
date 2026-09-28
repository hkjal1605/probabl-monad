// Display identity of listed tokens, by their on-chain symbol. Never derive trading
// precision, prices, or balances from this map.
import { catalogAsset } from "@conditional-stocks/shared/token-catalog";

export interface TokenDisplayMetadata {
  readonly name: string;
  readonly symbol: string;
  /** Bundled logo, or null when the token is not catalogued. */
  readonly image: string | null;
  /** Underlying asset ticker of a stock token (e.g. NVDA). */
  readonly asset?: string;
  /** Testnet mock asset rather than the issuer's token. */
  readonly testnet: boolean;
}

const TESTNETS: readonly number[] = [31337, 46630, 84532];

/** Display identity of a token from its on-chain symbol and name. */
export function tokenDisplay(
  symbol: string | null,
  name: string | null,
  chainId: number,
): TokenDisplayMetadata | undefined {
  if (!symbol) return undefined;
  const known = catalogAsset(symbol);
  return Object.freeze({
    symbol,
    name: known?.name ?? name ?? symbol,
    image: known?.logo ?? null,
    testnet: TESTNETS.includes(chainId),
    ...(known && (known.kind === "stock" || known.kind === "etf") ? { asset: known.symbol } : {}),
  });
}

/** Market display identity. `assetKey` groups sibling markets of one event by asset. */
export function marketTokenDisplay(
  base: { token: string; symbol: string | null; name: string | null },
  quote: { symbol: string | null; name: string | null },
  chainId: number,
  fallbackTicker: string,
) {
  const assetMetadata = tokenDisplay(base.symbol, base.name, chainId);
  const quoteTokenMetadata = tokenDisplay(quote.symbol, quote.name, chainId);
  const ticker = assetMetadata?.asset ?? base.symbol ?? fallbackTicker;
  return {
    ticker,
    assetKey: `asset:${assetMetadata?.asset ?? base.token.toLowerCase()}`,
    ...(assetMetadata ? { assetMetadata } : {}),
    ...(quoteTokenMetadata ? { quoteTokenMetadata } : {}),
  };
}
