import { requestJson } from "./api";

export interface FaucetStatus {
  available: boolean;
  /** Whether this wallet already received its test tokens (read by its own session only). */
  claimed: boolean;
  /** Tokens a claim gives, the quote token first. */
  tokens: { token: string; symbol: string }[];
  /** Whole quote tokens per claim. */
  quoteUnits: number;
  /** Dollars of every other token per claim. */
  assetUsd: number;
}
export interface FaucetDelivery {
  symbol: string;
  /** null for native gas. */
  token: string | null;
  /** Base units. */
  amount: string;
  decimals: number;
}
export interface FaucetClaim {
  sent: FaucetDelivery[];
  unavailable: string[];
  transactions: string[];
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function parseFaucetStatus(value: unknown): FaucetStatus {
  if (!object(value) || typeof value.available !== "boolean")
    throw new Error("API returned an invalid faucet status");
  const tokens = Array.isArray(value.tokens)
    ? value.tokens.filter(
        (t): t is { token: string; symbol: string } =>
          object(t) && typeof t.token === "string" && typeof t.symbol === "string",
      )
    : [];
  return {
    available: value.available,
    claimed: value.claimed === true,
    tokens,
    quoteUnits: typeof value.quoteUnits === "number" ? value.quoteUnits : 0,
    assetUsd: typeof value.assetUsd === "number" ? value.assetUsd : 0,
  };
}

/** What a claim gives and, for a signed-in member (`owner`), whether it already claimed. */
export const faucetStatus = async (owner: string | null, signal?: AbortSignal) =>
  parseFaucetStatus(
    await requestJson<unknown>(
      `/v1/faucet/status${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`,
      { ...(owner ? { auth: true as const } : {}), ...(signal ? { signal } : {}) },
    ),
  );

/** Mints this wallet its test tokens (once), as the sign-in `auth`. */
export async function claimFaucet(auth: string | true): Promise<FaucetClaim> {
  const result = await requestJson<unknown>("/v1/faucet/claim", {
    body: {},
    timeoutMs: 120_000,
    auth,
  });
  if (!object(result) || !Array.isArray(result.sent))
    throw new Error("API returned an invalid faucet claim");
  return {
    sent: result.sent.filter(
      (s): s is FaucetDelivery =>
        object(s) &&
        typeof s.symbol === "string" &&
        typeof s.amount === "string" &&
        typeof s.decimals === "number",
    ),
    unavailable: Array.isArray(result.unavailable)
      ? result.unavailable.filter((s): s is string => typeof s === "string")
      : [],
    transactions: Array.isArray(result.transactions)
      ? result.transactions.filter((s): s is string => typeof s === "string")
      : [],
  };
}

/** Whether `wallet` has joined: a wallet that has not is guided through its first steps. */
export async function knownWallet(wallet: string, signal?: AbortSignal) {
  const result = await requestJson<unknown>(
    `/v1/auth/known?wallet=${encodeURIComponent(wallet)}`,
    signal ? { signal } : {},
  );
  return object(result) && result.known === true;
}
