import type { Metadata } from "next";
import { WorldBuilderPageModule } from "@/modules/WorldBuilderPageModule";

export const metadata: Metadata = { title: "Your world" };

export default function WorldBuilderPage() {
  return <WorldBuilderPageModule />;
}
