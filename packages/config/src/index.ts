import { z } from "zod";

export * from "./release.ts";
export * from "./safety.ts";

const apiConfigSchema = z.object({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
});

const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte EVM address");

const rpcUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "must use http or https");

const protocolConfigSchema = z.object({
  CONDITIONAL_TOKENS_ADDRESS: evmAddressSchema,
  DEPLOYMENT_BLOCK: z.coerce.bigint().nonnegative(),
  EXCHANGE_ADDRESS: evmAddressSchema,
  MARKET_REGISTRY_ADDRESS: evmAddressSchema,
  ROBINHOOD_CHAIN_ID: z.coerce.number().int().positive(),
  ROBINHOOD_RPC_URL: rpcUrlSchema,
});

const matcherConfigSchema = z.object({
  MATCHER_CHECKPOINT_EVERY_EVENTS: z.coerce.bigint().positive().default(100n),
  MATCHER_LEASE_TTL_MS: z.coerce.bigint().min(1_000n).default(15_000n),
  MATCHER_MAX_FILLS_PER_PROPOSAL: z.coerce.number().int().min(1).max(32).default(32),
  MATCHER_OWNER_ID: z.string().min(1),
});

export interface ApiConfig {
  host: string;
  port: number;
}

export interface ProtocolConfig {
  chainId: number;
  conditionalTokensAddress: `0x${string}`;
  deploymentBlock: bigint;
  exchangeAddress: `0x${string}`;
  marketRegistryAddress: `0x${string}`;
  rpcUrl: string;
}

export interface MatcherConfig {
  checkpointEveryEvents: bigint;
  leaseTtlMs: bigint;
  maxFillsPerProposal: number;
  ownerId: string;
}

export const loadApiConfig = (environment: Record<string, string | undefined>): ApiConfig => {
  const parsed = apiConfigSchema.parse(environment);

  return {
    host: parsed.API_HOST,
    port: parsed.API_PORT,
  };
};

export const loadProtocolConfig = (
  environment: Record<string, string | undefined>,
): ProtocolConfig => {
  const parsed = protocolConfigSchema.parse(environment);

  return {
    chainId: parsed.ROBINHOOD_CHAIN_ID,
    conditionalTokensAddress: parsed.CONDITIONAL_TOKENS_ADDRESS as `0x${string}`,
    deploymentBlock: parsed.DEPLOYMENT_BLOCK,
    exchangeAddress: parsed.EXCHANGE_ADDRESS as `0x${string}`,
    marketRegistryAddress: parsed.MARKET_REGISTRY_ADDRESS as `0x${string}`,
    rpcUrl: parsed.ROBINHOOD_RPC_URL,
  };
};

export const loadMatcherConfig = (
  environment: Record<string, string | undefined>,
): MatcherConfig => {
  const parsed = matcherConfigSchema.parse(environment);
  return {
    checkpointEveryEvents: parsed.MATCHER_CHECKPOINT_EVERY_EVENTS,
    leaseTtlMs: parsed.MATCHER_LEASE_TTL_MS,
    maxFillsPerProposal: parsed.MATCHER_MAX_FILLS_PER_PROPOSAL,
    ownerId: parsed.MATCHER_OWNER_ID,
  };
};
