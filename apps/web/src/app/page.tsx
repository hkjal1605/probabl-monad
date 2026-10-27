import type { Metadata } from "next";
import { LINK_PREVIEW, SITE_TITLE } from "@/lib/link-preview";
import { MarketsPageModule } from "@/modules/MarketsPageModule";

// A link to the site itself previews as the brand, not as its markets page.
export const metadata: Metadata = {
  title: "Markets",
  openGraph: { ...LINK_PREVIEW, title: SITE_TITLE },
};

export default function HomePage() {
  return <MarketsPageModule />;
}
