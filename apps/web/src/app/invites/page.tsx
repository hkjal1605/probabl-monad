import type { Metadata } from "next";
import { InvitesPageModule } from "@/modules/InvitesPageModule";
export const metadata: Metadata = { title: "Invites & rewards" };
export default function InvitesPage() {
  return <InvitesPageModule />;
}
