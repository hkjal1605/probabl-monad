import type { DeltaVaultAccountView, DeltaVaultView } from "@/services/delta-vaults-api-service";
import { createResourceStore } from "./createResourceStore";

export const deltaVaultsStore = createResourceStore<{ vaults: DeltaVaultView[] }>("delta-vaults");
export const deltaVaultAccountStore =
  createResourceStore<DeltaVaultAccountView>("delta-vault-account");
