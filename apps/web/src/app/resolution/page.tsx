import type { Metadata } from "next";
import { ResolutionPageModule } from "@/modules/ResolutionPageModule";
export const metadata: Metadata = { title: "Resolution center" };
export default function ResolutionPage() {
  return <ResolutionPageModule />;
}
