import type { Metadata } from "next";
import { Page, PageHeading } from "@/components/ui/page";
import { InvitesAdmin } from "@/modules/InvitesPageModule/InvitesAdmin";
export const metadata: Metadata = { title: "Invites & referrals" };
export default function InvitesPage() {
  return (
    <Page className="max-w-[1180px] py-8 sm:px-6">
      <PageHeading
        title="Invites & referrals"
        description="Launch codes, members, and the referral program's obligations against the payout wallet."
      />
      <InvitesAdmin />
    </Page>
  );
}
