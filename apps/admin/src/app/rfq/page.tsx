import type { Metadata } from "next";
import { Page, PageHeading } from "@/components/ui/page";
import { RfqMakersAdmin } from "@/modules/RfqMakersPageModule/RfqMakersAdmin";
export const metadata: Metadata = { title: "RFQ makers" };
export default function RfqMakersPage() {
  return (
    <Page className="max-w-[1180px] py-8 sm:px-6">
      <PageHeading
        title="RFQ makers"
        description="Market makers approved to quote market orders over the RFQ stream, their API keys and activity."
      />
      <RfqMakersAdmin />
    </Page>
  );
}
