import { Page, PageHeading } from "@/components/ui/page";
import { InvitesClient } from "./components/InvitesClient";
export function InvitesPageModule() {
  return (
    <Page>
      <PageHeading
        title="Invites & rewards"
        description="Invite friends with your codes and earn a share of their trading fees."
      />
      <InvitesClient />
    </Page>
  );
}
