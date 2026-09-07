const integer = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const protocolConfig = {
  apiUrl: process.env.API_URL ?? "http://127.0.0.1:3000",
  chainId: integer(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID, 31337),
  chainName: process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_NAME ?? "Robinhood Chain Local",
  conditionalTokens: process.env.NEXT_PUBLIC_CONDITIONAL_TOKENS_ADDRESS ?? "",
  explorerUrl: process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL ?? "",
  exchange: process.env.NEXT_PUBLIC_EXCHANGE_ADDRESS ?? "",
  indexerUrl: process.env.INDEXER_URL ?? "http://127.0.0.1:42069",
  rpcUrl: process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ?? "http://127.0.0.1:8545",
} as const;
