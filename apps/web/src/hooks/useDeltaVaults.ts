"use client";
import { getAddress } from "viem";
import { useMemberAccount } from "@/components/providers/WalletProvider";
import { deltaVaults } from "@/config/protocol";
import { pinnedVaults } from "@/lib/delta-vault/pinned";
import { getDeltaVaultAccount, getDeltaVaults } from "@/services/delta-vaults-api-service";
import { deltaVaultAccountStore, deltaVaultsStore } from "@/stores/useDeltaVaultsStore";
import { fetchResource } from "@/utils/fetchResource";
import { useReadFreshness } from "./useReadFreshness";
import { useResource } from "./useResource";

/** The Δ-vaults this build is configured for, as the API describes them. */
export function useDeltaVaults() {
  const query = useResource(deltaVaultsStore, "all", (force) =>
    fetchResource(deltaVaultsStore, "all", (signal) => getDeltaVaults(signal), force),
  );
  const vaults = pinnedVaults(query.data?.vaults ?? [], deltaVaults);
  return { ...query, ...useReadFreshness(query), vaults };
}

/** The connected wallet's shares in `vault`, what they redeem for, and its token allowances. */
export function useDeltaVaultAccount(vault: string | undefined) {
  const account = useMemberAccount();
  const key = vault && account ? `${getAddress(vault)}:${account}` : "";
  const query = useResource(
    deltaVaultAccountStore,
    key,
    (force) =>
      fetchResource(
        deltaVaultAccountStore,
        key,
        (signal) => getDeltaVaultAccount(vault!, account!, signal),
        force,
      ),
    !!key,
  );
  return { ...query, ...useReadFreshness(query), account: query.data };
}
