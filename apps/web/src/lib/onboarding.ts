import type { SessionStorage, WalletAccess } from "./wallet/session";

/** The first-run guide's steps, in order, then "done". */
export type OnboardingStep = "network" | "sign-in" | "tokens" | "done";
export const ONBOARDING_STEPS = ["network", "sign-in", "tokens"] as const;

/** Where a wallet is in the guide: on the deployment's network, then signed in as a member, then
 * holding its test tokens (or the faucet is off). Each step needs the ones before it. */
export function onboardingStep(state: {
  onNetwork: boolean;
  access: WalletAccess;
  /** The faucet sent this wallet its tokens, or gives none. */
  funded: boolean;
}): OnboardingStep {
  if (!state.onNetwork) return "network";
  if (state.access !== "member" && state.access !== "suspended") return "sign-in";
  if (!state.funded) return "tokens";
  return "done";
}

/** A wallet's guide in this browser: started (shown until finished), dismissed, or finished. */
export type OnboardingProgress = "active" | "dismissed" | "done";
const KEY = "probabl:onboarding:v1";

/** Progress is kept per deployment and wallet (`scope` names the deployment). */
export function readOnboarding(
  storage: SessionStorage | null,
  scope: string,
  owner: string,
): OnboardingProgress | null {
  try {
    const all = JSON.parse(storage?.getItem(KEY) ?? "{}") as Record<string, unknown>;
    const value = all[`${scope}:${owner.toLowerCase()}`];
    return value === "active" || value === "dismissed" || value === "done" ? value : null;
  } catch {
    return null;
  }
}

export function writeOnboarding(
  storage: SessionStorage | null,
  scope: string,
  owner: string,
  progress: OnboardingProgress,
) {
  let all = {};
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? "{}") as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) all = raw;
  } catch {
    // Unreadable progress is replaced.
  }
  try {
    storage?.setItem(
      KEY,
      JSON.stringify({ ...all, [`${scope}:${owner.toLowerCase()}`]: progress }),
    );
  } catch {
    // Storage is a convenience: without it the guide shows again next visit.
  }
}

/** Common wallet networks by chain id, to name the one a wallet is on. */
const NETWORKS: Record<number, string> = {
  1: "Ethereum",
  10: "OP Mainnet",
  56: "BNB Chain",
  137: "Polygon",
  324: "zkSync Era",
  4663: "Robinhood Chain",
  8453: "Base",
  42161: "Arbitrum One",
  43114: "Avalanche",
  59144: "Linea",
  84532: "Base Sepolia",
  421614: "Arbitrum Sepolia",
  11155111: "Sepolia",
};
export const networkName = (chainId: number) => NETWORKS[chainId] ?? `Chain ${chainId}`;

/** Testnets with the guide and a test-token faucet: Anvil, Robinhood Chain testnet, Base Sepolia. */
export const TESTNETS: readonly number[] = [31337, 46630, 84532];
/** Where a wallet gets free testnet ETH for gas, by chain id. */
export const GAS_FAUCETS: Readonly<Record<number, string>> = {
  46630: "https://faucet.testnet.chain.robinhood.com",
  84532: "https://www.alchemy.com/faucets/base-sepolia",
};
