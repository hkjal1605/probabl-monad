import type { Metadata } from "next";
import { WorldDetailPageModule } from "@/modules/WorldDetailPageModule";

export const metadata: Metadata = { title: "World" };

export default async function WorldPage({ params }: { params: Promise<{ book: string }> }) {
  const { book } = await params;
  return <WorldDetailPageModule book={book} />;
}
