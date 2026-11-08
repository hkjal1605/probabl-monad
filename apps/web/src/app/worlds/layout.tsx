import type { Metadata } from "next";
import type { ReactNode } from "react";
import { WORLDS_LINK_PREVIEW } from "@/lib/link-preview";

/** Every /worlds link (the worlds page, the builder, each world, my worlds) previews as Worlds:
 * its own image, loop, title and words. */
export const metadata: Metadata = { openGraph: WORLDS_LINK_PREVIEW };

export default function WorldsLayout({ children }: { children: ReactNode }) {
  return children;
}
