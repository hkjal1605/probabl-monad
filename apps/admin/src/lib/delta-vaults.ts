/** Δ-vault administration: reads of each configured vault, the connected wallet's vault roles,
 * and form values turned into validated contract arguments. */
import { parseTokenAmount } from "@conditional-stocks/domain";
import {
  DELTA_VAULT_ROLES,
  type DeltaVaultLimits,
  type DeltaVaultRisk,
  type DeltaVaultRole,
  deltaVaultAbi,
  type Envelope,
  readDeltaVault,
  validateDeltaVaultLimits,
  validateDeltaVaultRisk,
} from "@conditional-stocks/evm-client";
import type { AdminTransaction } from "@conditional-stocks/evm-client/admin";
import { type Address, erc20Abi, getAddress, type PublicClient } from "viem";
import { adminConfig } from "@/config/protocol";
import { publicClient } from "./chain";

export type VaultRoles = Record<DeltaVaultRole, boolean>;

/** A vault call signed by the connected operator. */
export const vaultTransaction = (envelope: Envelope, from: string): AdminTransaction => ({
  ...envelope,
  from: getAddress(from),
  chainId: adminConfig.chainId,
});

/** Which of a vault's roles `account` holds. */
export async function vaultRoles(
  vault: Address,
  account: string,
  c: PublicClient = publicClient(),
): Promise<VaultRoles> {
  const roles = Object.keys(DELTA_VAULT_ROLES) as DeltaVaultRole[];
  const held = await Promise.all(
    roles.map((role) =>
      c.readContract({
        address: vault,
        abi: deltaVaultAbi,
        functionName: "hasRole",
        args: [DELTA_VAULT_ROLES[role], getAddress(account)],
      }),
    ),
  );
  return Object.fromEntries(roles.map((role, i) => [role, held[i]])) as VaultRoles;
}

/** Wallets that may use the console for vaults: each vault's admin, plus `account` when it is a
 * curator or guardian of any configured vault (vault roles are not enumerable on chain). */
export async function vaultOperators(
  account: string | null,
  vaults: readonly Address[] = adminConfig.deltaVaults,
  read: typeof vaultRoles = vaultRoles,
  admins: (vault: Address) => Promise<string> = (vault) =>
    publicClient().readContract({
      address: vault,
      abi: deltaVaultAbi,
      functionName: "defaultAdmin",
    }),
) {
  const operators = await Promise.all(vaults.map(admins));
  if (account)
    for (const vault of vaults) {
      const roles = await read(vault, account);
      if (roles.curator || roles.guardian) {
        operators.push(getAddress(account));
        break;
      }
    }
  return operators.map((address) => getAddress(address));
}

/** Vault state with its tokens' symbols and decimals. */
export async function readVaultConsole(vault: Address, c: PublicClient = publicClient()) {
  const state = await readDeltaVault(c, vault);
  const token = async (address: Address) => {
    const [symbol, decimals] = await Promise.all([
      c.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
      c.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return { address, symbol, decimals };
  };
  const [quote, base] = await Promise.all([token(state.quote), token(state.base)]);
  return { state, quote, base };
}
export type VaultConsole = Awaited<ReturnType<typeof readVaultConsole>>;

/** Risk limits of one market from whole-token form values: a band in percent, a cutoff buffer
 * in minutes, notional caps in quote tokens and the imbalance cap in stock tokens. */
export function riskFromForm(
  form: {
    bandPercent: string;
    cutoffBufferMinutes: string;
    maxOrder: string;
    maxResting: string;
    maxImbalance: string;
  },
  decimals: { quote: number; base: number },
): DeltaVaultRisk {
  const integer = (value: string, what: string) => {
    if (!/^[0-9]{1,9}(\.[0-9]{1,2})?$/.test(value.trim())) throw new Error(`Invalid ${what}`);
    return Number(value.trim());
  };
  return validateDeltaVaultRisk({
    bandBps: Math.round(integer(form.bandPercent, "band") * 100),
    cutoffBuffer: Math.round(integer(form.cutoffBufferMinutes, "cutoff buffer") * 60),
    maxOrder: parseTokenAmount(form.maxOrder.trim(), decimals.quote),
    maxResting: parseTokenAmount(form.maxResting.trim(), decimals.quote),
    maxImbalance: parseTokenAmount(form.maxImbalance.trim(), decimals.base),
  });
}

export function limitsFromForm(form: {
  ttlMinutes: string;
  oracleAgeHours: string;
  maxFeeBps: string;
}): DeltaVaultLimits {
  const number = (value: string, what: string) => {
    const parsed = Number(value.trim());
    if (!value.trim() || !Number.isFinite(parsed)) throw new Error(`Invalid ${what}`);
    return parsed;
  };
  return validateDeltaVaultLimits({
    maxTtl: Math.round(number(form.ttlMinutes, "order lifetime") * 60),
    maxOracleAge: Math.round(number(form.oracleAgeHours, "oracle age") * 3600),
    maxFeeBps: Math.round(number(form.maxFeeBps, "fee cap")),
  });
}
