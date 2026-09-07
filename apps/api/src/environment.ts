import { type Address, getAddress, type Hex } from "viem";

const required = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const address = (environment: NodeJS.ProcessEnv, name: string): Address =>
  getAddress(required(environment, name));

export interface ApiEnvironment {
  internalTesters?: ReadonlySet<string>;
  authDomain: string;
  authOrigin: string;
  chainId: number;
  conditionalTokens: Address;
  exchange: Address;
  indexerUrl: string;
  iocRouter: Address;
  marketRegistry: Address;
  positionRouter: Address;
  relayerPrivateKey: Hex | null;
  rpcUrl: string;
  settlementWorkerUrl: string;
  settlementWorkerToken: string;
}

export const loadApiEnvironment = (environment: NodeJS.ProcessEnv): ApiEnvironment => {
  const chainId = Number(required(environment, "ROBINHOOD_CHAIN_ID"));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("ROBINHOOD_CHAIN_ID must be a positive safe integer");
  }
  const relayerPrivateKey = environment.API_RELAYER_PRIVATE_KEY;
  const internalTesters = new Set(
    (environment.INTERNAL_TESTER_ADDRESSES ?? "")
      .split(",")
      .filter(Boolean)
      .map((value) => getAddress(value.trim()).toLowerCase()),
  );
  if (chainId === 4663 && internalTesters.size === 0)
    throw new Error("INTERNAL_TESTER_ADDRESSES is required for internal mainnet trading");
  if (relayerPrivateKey && !/^0x[0-9a-fA-F]{64}$/.test(relayerPrivateKey)) {
    throw new Error("API_RELAYER_PRIVATE_KEY must be 32 bytes");
  }
  const authOrigin = environment.API_AUTH_ORIGIN ?? "http://127.0.0.1:3000";
  const indexerUrl = environment.INDEXER_URL ?? "http://127.0.0.1:42069";
  const settlementWorkerUrl = environment.SETTLEMENT_WORKER_URL ?? "http://127.0.0.1:42071";
  for (const [name, value] of [
    ["API_AUTH_ORIGIN", authOrigin],
    ["INDEXER_URL", indexerUrl],
    ["SETTLEMENT_WORKER_URL", settlementWorkerUrl],
  ] as const) {
    const protocol = new URL(value).protocol;
    if (protocol !== "http:" && protocol !== "https:") throw new Error(`${name} must be HTTP(S)`);
  }
  return {
    ...(internalTesters.size ? { internalTesters } : {}),
    authDomain: environment.API_AUTH_DOMAIN ?? new URL(authOrigin).host,
    authOrigin,
    chainId,
    conditionalTokens: address(environment, "CONDITIONAL_TOKENS_ADDRESS"),
    exchange: address(environment, "EXCHANGE_ADDRESS"),
    indexerUrl,
    iocRouter: address(environment, "IOC_ROUTER_ADDRESS"),
    marketRegistry: address(environment, "MARKET_REGISTRY_ADDRESS"),
    positionRouter: address(environment, "POSITION_ROUTER_ADDRESS"),
    relayerPrivateKey: (relayerPrivateKey as Hex | undefined) ?? null,
    rpcUrl: required(environment, "ROBINHOOD_RPC_URL"),
    settlementWorkerUrl,
    settlementWorkerToken: required(environment, "SETTLEMENT_INTERNAL_TOKEN"),
  };
};
