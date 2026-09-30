import type { Metadata } from "next";
import { VaultsPageModule } from "@/modules/VaultsPageModule";
export const metadata: Metadata = { title: "Vaults" };
export default function VaultsPage() {
  return <VaultsPageModule />;
}
