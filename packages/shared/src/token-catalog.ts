/** Identity of the assets markets list, keyed by the token's on-chain symbol.
 *
 * A token is identified by its symbol and the exact address comes from the market itself.
 * Display, reference-price and underlying identity only: never custody or valuation authority.
 * The underlying is recorded on chain when a pool is listed and is part of every market's
 * chain-independent key, so an existing symbol's underlying must never change. */

export type AssetKind = "stock" | "etf" | "stablecoin" | "crypto";

export interface CatalogAsset {
  /** On-chain token symbol (e.g. "NVDA"). */
  symbol: string;
  name: string;
  kind: AssetKind;
  /** Bundled logo served by the UI. */
  logo: string;
  /** Economic asset, shared by every issuer's token of it: `REGION:TICKER` for listed stocks
   * and ETFs (e.g. "US:NVDA"), `PRIVATE:NAME` for private companies, `CRYPTO:TICKER` for
   * crypto assets listed as market collateral. */
  underlying?: string;
}

const stock = (symbol: string, name: string, kind: AssetKind = "stock"): CatalogAsset => ({
  symbol,
  name,
  kind,
  logo: `/tokens/${symbol.toLowerCase()}.svg`,
  underlying: `US:${symbol}`,
});
const privateCompany = (symbol: string, name: string): CatalogAsset => ({
  symbol,
  name,
  kind: "stock",
  logo: `/tokens/${symbol.toLowerCase()}.png`,
  underlying: `PRIVATE:${symbol}`,
});

export const ASSET_CATALOG: readonly CatalogAsset[] = Object.freeze([
  stock("NVDA", "NVIDIA"),
  stock("TSLA", "Tesla"),
  stock("AAPL", "Apple"),
  stock("MSFT", "Microsoft"),
  stock("AMZN", "Amazon"),
  stock("GOOGL", "Alphabet"),
  stock("META", "Meta Platforms"),
  stock("AMD", "Advanced Micro Devices"),
  stock("MU", "Micron Technology"),
  stock("COIN", "Coinbase"),
  stock("HOOD", "Robinhood Markets"),
  stock("PLTR", "Palantir"),
  stock("NFLX", "Netflix"),
  stock("SPY", "SPDR S&P 500 ETF Trust", "etf"),
  stock("QQQ", "Invesco QQQ Trust", "etf"),
  // Private companies (pre-IPO tokens): Monad testnet markets list one dummy token for each.
  privateCompany("OPENAI", "OpenAI"),
  privateCompany("SPACEX", "SpaceX"),
  privateCompany("KALSHI", "Kalshi"),
  privateCompany("ANTHROPIC", "Anthropic"),
  {
    symbol: "USDC",
    name: "USD Coin",
    kind: "stablecoin",
    logo: "/tokens/usdc.svg",
  },
  {
    symbol: "USDG",
    name: "Global Dollar",
    kind: "stablecoin",
    logo: "/tokens/usdg.svg",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    kind: "crypto",
    logo: "/tokens/eth.svg",
    underlying: "CRYPTO:ETH",
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    kind: "crypto",
    logo: "/tokens/eth.svg",
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    kind: "crypto",
    logo: "/tokens/btc.svg",
    underlying: "CRYPTO:BTC",
  },
  {
    symbol: "SOL",
    name: "Solana",
    kind: "crypto",
    logo: "/tokens/sol.svg",
    underlying: "CRYPTO:SOL",
  },
  {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    kind: "crypto",
    logo: "/tokens/btc.svg",
  },
]);

const bySymbol = new Map(ASSET_CATALOG.map((asset) => [asset.symbol.toUpperCase(), asset]));

/** Catalog identity of a token symbol; a trailing issuer tag (e.g. "NVDAx") is not stripped. */
export const catalogAsset = (symbol: string | null | undefined): CatalogAsset | undefined =>
  symbol ? bySymbol.get(symbol.toUpperCase()) : undefined;

/** The underlying a token with this on-chain symbol is listed with, when catalogued. */
export const catalogUnderlying = (symbol: string | null | undefined) =>
  catalogAsset(symbol)?.underlying ?? null;

/** Display name of an asset symbol, when catalogued. */
export const assetDisplayName = (symbol: string) => catalogAsset(symbol)?.name;
