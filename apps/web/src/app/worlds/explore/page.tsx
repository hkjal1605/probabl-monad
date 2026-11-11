import type { Metadata } from "next";
import { WorldsExplorePageModule } from "@/modules/WorldsExplorePageModule";

export const metadata: Metadata = {
  title: "Explore worlds",
  description:
    "Open world orders waiting for a quote, which anyone can take the other side of, and every world trade.",
};

export default function WorldsExplorePage() {
  return <WorldsExplorePageModule />;
}
