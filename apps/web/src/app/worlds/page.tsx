import type { Metadata } from "next";
import { WorldsPageModule } from "@/modules/WorldsPageModule";

export const metadata: Metadata = {
  title: "Worlds",
  description:
    "Say what you think will happen. probabl turns it into its own market, priced from Polymarket and Kalshi, and shows what you'd win, get back, and how likely it is.",
};

export default function WorldsPage() {
  return <WorldsPageModule />;
}
