import { Page } from "@/components/ui/page";
import { VaultDetailClient } from "./components/VaultDetailClient";
export function VaultDetailPageModule({ address }: { address: string }) {
  return (
    <Page>
      <VaultDetailClient address={address} />
    </Page>
  );
}
