/** Display identity of the assets markets list, keyed by the token's on-chain symbol.
 *
 * Each deployment has one issuer, so a base token is identified by its symbol and the exact
 * token address comes from the market itself. Display and reference-price identity only:
 * never custody, listing or valuation authority. */

export type AssetKind = "stock" | "etf" | "stablecoin" | "crypto";

export interface CatalogAsset {
  /** On-chain token symbol (e.g. "NVDA"). */
  symbol: string;
  name: string;
  kind: AssetKind;
  /** Bundled logo served by the UI. */
  logo: string;
  /** Pyth price feed symbol of the reference price (per share for stocks). */
  pyth: string;
}

const stock = (symbol: string, name: string, kind: AssetKind = "stock"): CatalogAsset => ({
  symbol,
  name,
  kind,
  logo: `/tokens/${symbol.toLowerCase()}.svg`,
  pyth: `Equity.US.${symbol}/USD`,
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
  stock("SPY", "SPDR S&P 500 ETF Trust", "etf"),
  stock("QQQ", "Invesco QQQ Trust", "etf"),
  {
    symbol: "USDC",
    name: "USD Coin",
    kind: "stablecoin",
    logo: "/tokens/usdc.svg",
    pyth: "Crypto.USDC/USD",
  },
  {
    symbol: "USDG",
    name: "Global Dollar",
    kind: "stablecoin",
    logo: "/tokens/usdg.svg",
    pyth: "Crypto.USDG/USD",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    kind: "crypto",
    logo: "/tokens/eth.svg",
    pyth: "Crypto.ETH/USD",
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    kind: "crypto",
    logo: "/tokens/eth.svg",
    pyth: "Crypto.ETH/USD",
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    kind: "crypto",
    logo: "/tokens/btc.svg",
    pyth: "Crypto.BTC/USD",
  },
  {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    kind: "crypto",
    logo: "/tokens/btc.svg",
    pyth: "Crypto.BTC/USD",
  },
]);

const bySymbol = new Map(ASSET_CATALOG.map((asset) => [asset.symbol.toUpperCase(), asset]));

/** Catalog identity of a token symbol; a trailing issuer tag (e.g. "NVDAx") is not stripped. */
export const catalogAsset = (symbol: string | null | undefined): CatalogAsset | undefined =>
  symbol ? bySymbol.get(symbol.toUpperCase()) : undefined;

/** Display name of an asset symbol, when catalogued. */
export const assetDisplayName = (symbol: string) => catalogAsset(symbol)?.name;
