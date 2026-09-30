import type { Metadata } from "next";
import { VaultDetailPageModule } from "@/modules/VaultDetailPageModule";
export const metadata: Metadata = { title: "Vault" };
export default async function VaultPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <VaultDetailPageModule address={address} />;
}
