import type { Metadata } from "next";
import { LiveWorldsPageModule } from "@/modules/WorldsPageModule";

export const metadata: Metadata = {
  title: "Live worlds",
  description: "Every world people hold a position in, priced live from Polymarket and Kalshi.",
};

export default function LiveWorldsPage() {
  return <LiveWorldsPageModule />;
}
