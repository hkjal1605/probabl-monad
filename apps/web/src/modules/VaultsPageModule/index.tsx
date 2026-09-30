import { Page, PageHeading } from "@/components/ui/page";
import { VaultsClient } from "./components/VaultsClient";
export function VaultsPageModule() {
  return (
    <Page>
      <PageHeading
        title="Δ-Vaults"
        description="Provide liquidity to conditional stock markets. A vault quotes both outcomes of every event it covers, so it takes no side on the event itself: it earns the spread and holds its stock."
      />
      <VaultsClient />
    </Page>
  );
}
