import type { Metadata } from "next";
import { Page, PageHeading } from "@/components/ui/page";
import { VaultControls } from "@/modules/VaultControlsPageModule/VaultControls";
export const metadata: Metadata = { title: "Vault controls" };
export default function VaultsPage() {
  return (
    <Page className="max-w-[1080px] py-8 sm:px-6">
      <PageHeading
        title="Vault controls"
        description="Deposit caps, withdrawal limits and roles (vault admin); markets and quoting limits (curator); pause (guardian). Each vault's own roles authorize every action."
      />
      <VaultControls />
    </Page>
  );
}
