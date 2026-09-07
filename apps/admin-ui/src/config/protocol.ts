export const adminConfig = {
  apiUrl: process.env.API_URL ?? "http://127.0.0.1:3000",
  chainId: Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID ?? "31337"),
  chainName: process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_NAME ?? "Robinhood Chain Local",
  conditionalTokens: process.env.NEXT_PUBLIC_CONDITIONAL_TOKENS_ADDRESS ?? "",
  exchange: process.env.NEXT_PUBLIC_EXCHANGE_ADDRESS ?? "",
  indexerUrl: process.env.INDEXER_URL ?? "http://127.0.0.1:42069",
  marketRegistry: process.env.NEXT_PUBLIC_MARKET_REGISTRY_ADDRESS ?? "",
  rpcUrl: process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ?? "http://127.0.0.1:8545",
  uiOperators: (process.env.NEXT_PUBLIC_ADMIN_OPERATORS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
} as const;
