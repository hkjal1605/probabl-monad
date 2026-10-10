import { loadEnvConfig } from "@next/env";
import { getAddress, isAddress } from "viem";

type Environment = Record<string, string | undefined>;

/** Base, Base Sepolia, Robinhood Chain, Robinhood Chain testnet and Monad testnet. */
const CHAINS = [8453, 84532, 4663, 46630, 10143];

// Offline checks only. Never print URLs; RPC query parameters may contain credentials.
export function validateCloudflareEnvironment(env: Environment): string[] {
  const errors: string[] = [];
  for (const key of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_RPC_URL"]) {
    try {
      const url = new URL(env[key] ?? "");
      const hostname = url.hostname;
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        !hostname.includes(".") ||
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        /(^|\.)(example\.(com|org|net)|example|invalid|test)$/.test(hostname) ||
        /^[\d.]+$/.test(hostname) ||
        hostname.startsWith("[") ||
        (key !== "NEXT_PUBLIC_RPC_URL" && (url.pathname !== "/" || url.search))
      )
        throw new Error("invalid");
    } catch {
      errors.push(`${key} must be a public HTTPS URL`);
    }
  }
  if (!CHAINS.includes(Number(env.NEXT_PUBLIC_CHAIN_ID)))
    errors.push(
      "NEXT_PUBLIC_CHAIN_ID must be Base, Base Sepolia, Robinhood Chain, its testnet or Monad testnet",
    );
  if (!env.NEXT_PUBLIC_CHAIN_NAME?.trim()) errors.push("NEXT_PUBLIC_CHAIN_NAME is required");
  const exchange = env.NEXT_PUBLIC_EXCHANGE_ADDRESS ?? "";
  if (
    !isAddress(exchange, { strict: false }) ||
    /^0x0{40}$/i.test(exchange) ||
    getAddress(exchange) !== exchange
  )
    errors.push("NEXT_PUBLIC_EXCHANGE_ADDRESS must be the checksummed exchange address");
  if (
    env.NEXT_PUBLIC_LOG_LEVEL &&
    !["debug", "info", "warn", "error", "silent"].includes(env.NEXT_PUBLIC_LOG_LEVEL)
  )
    errors.push("NEXT_PUBLIC_LOG_LEVEL is invalid");
  return errors;
}

if (import.meta.main) {
  loadEnvConfig(new URL("..", import.meta.url).pathname, false);
  const errors = validateCloudflareEnvironment(process.env);
  if (errors.length) {
    console.error(`Cloudflare deployment configuration is incomplete:\n${errors.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.info(
      "Public deployment configuration passed. Configure runtime API_URL separately in Cloudflare.",
    );
  }
}
