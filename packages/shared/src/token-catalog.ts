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
  /** Economic asset, `REGION:TICKER` for stocks and ETFs (e.g. "US:NVDA") and `CRYPTO:TICKER`
   * for crypto: shared by every issuer's token of it. */
  underlying?: string;
}

/** Robinhood's token list gives every Stock Token the same Robinhood logo (`logoUrl`), so each
 * asset's own is bundled under `/tokens/<symbol>.svg`: the company's, or the fund issuer's for
 * an ETF, from TradingView's symbol logos. */
const stock = (
  symbol: string,
  name: string,
  kind: AssetKind = "stock",
  logo = `/tokens/${symbol.toLowerCase()}.svg`,
): CatalogAsset => ({ symbol, name, kind, logo, underlying: `US:${symbol}` });

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
  // Assets with prediction markets that track them (reports/Polymarket and Kalshi market
  // research.md, tiers 1 and 2); names as Robinhood's Stock Token list gives them.
  stock("USO", "United States Oil Fund", "etf"),
  stock("XOM", "ExxonMobil Holdings Corporation"),
  stock("PR", "Permian Resources"),
  stock("CCL", "Carnival Corporation"),
  stock("BA", "Boeing"),
  stock("MSTR", "Strategy Inc."),
  stock("CRCL", "Circle Internet Group"),
  stock("GLXY", "Galaxy Digital Inc."),
  stock("CLSK", "CleanSpark"),
  stock("IREN", "IREN Limited"),
  stock("WULF", "TeraWulf"),
  stock("BULL", "Webull"),
  stock("SLV", "iShares Silver Trust", "etf"),
  stock("GLD", "SPDR Gold Trust", "etf"),
  stock("SHY", "iShares 1-3 Year Treasury Bond ETF", "etf"),
  stock("BND", "Vanguard Total Bond Market ETF", "etf"),
  stock("NU", "Nu"),
  stock("SOFI", "SoFi Technologies"),
  stock("CRWV", "CoreWeave"),
  stock("SMH", "VanEck Semiconductor ETF", "etf"),
  stock("EWT", "iShares MSCI Taiwan Capped ETF", "etf"),
  // TradingView still shows the merged SPAC's logo; this is Trump Media's own icon (tmtgcorp.com).
  stock("DJT", "Trump Media & Technology Group", "stock", "/tokens/djt.png"),
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
    logo: "/tokens/usdg.png",
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
    logo: "/tokens/weth.png",
    underlying: "CRYPTO:ETH",
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    kind: "crypto",
    logo: "/tokens/btc.svg",
    underlying: "CRYPTO:BTC",
  },
  {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    kind: "crypto",
    logo: "/tokens/cbbtc.png",
    underlying: "CRYPTO:BTC",
  },
  {
    symbol: "SOL",
    name: "Solana",
    kind: "crypto",
    logo: "/tokens/sol.png",
    underlying: "CRYPTO:SOL",
  },
  {
    symbol: "XRP",
    name: "XRP",
    kind: "crypto",
    logo: "/tokens/xrp.png",
    underlying: "CRYPTO:XRP",
  },
  {
    symbol: "DOGE",
    name: "Dogecoin",
    kind: "crypto",
    logo: "/tokens/doge.png",
    underlying: "CRYPTO:DOGE",
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
