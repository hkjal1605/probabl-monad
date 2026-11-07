import type { Metadata } from "next";
import { ExploringWorldsPageModule } from "@/modules/WorldsPageModule";

export const metadata: Metadata = {
  title: "What people are exploring",
  description: "Worlds people priced lately: their events, their stock and what they pay.",
};

export default function ExploringWorldsPage() {
  return <ExploringWorldsPageModule />;
}
