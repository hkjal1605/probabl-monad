import type { Metadata } from "next";
import { MyWorldsPageModule } from "@/modules/MyWorldsPageModule";

export const metadata: Metadata = { title: "My worlds" };

export default function MyWorldsPage() {
  return <MyWorldsPageModule />;
}
