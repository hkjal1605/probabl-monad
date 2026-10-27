import { MarketDataError } from "@conditional-stocks/market-data";

export interface KalshiEnvironment {
  apiUrl: string;
  /** Interval between order book reads of every followed market. */
  bookPollMs: number;
  /** Interval between metadata reads of every followed market. */
  metadataPollMs: number;
}

const interval = (environment: NodeJS.ProcessEnv, name: string, fallback: string) => {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1_000)
    throw new MarketDataError("INVALID_CONFIG", `${name} must be at least 1000 ms`);
  return value;
};

export const loadKalshiEnvironment = (environment: NodeJS.ProcessEnv): KalshiEnvironment => {
  const apiUrl = new URL(
    environment.KALSHI_API_URL ?? "https://api.elections.kalshi.com/trade-api/v2",
  );
  if (apiUrl.protocol !== "https:" && apiUrl.protocol !== "http:")
    throw new MarketDataError("INVALID_CONFIG", "KALSHI_API_URL has an invalid protocol");
  return {
    apiUrl: apiUrl.toString().replace(/\/$/, ""),
    bookPollMs: interval(environment, "KALSHI_BOOK_POLL_MS", "5000"),
    metadataPollMs: interval(environment, "KALSHI_METADATA_POLL_MS", "60000"),
  };
};
