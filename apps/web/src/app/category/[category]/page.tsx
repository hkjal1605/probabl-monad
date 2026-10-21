import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CATEGORY_TABS, marketTabFromSlug, marketTabSlug } from "@/lib/markets/categories";
import { MarketsPageModule } from "@/modules/MarketsPageModule";

export const metadata: Metadata = { title: "Markets" };
// The tabs are fixed, so every tab's page is prerendered and any other slug is a 404.
export const dynamicParams = false;
export const generateStaticParams = () =>
  CATEGORY_TABS.map((tab) => ({ category: marketTabSlug(tab) }));

export default async function MarketCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: slug } = await params;
  const category = marketTabFromSlug(slug);
  if (!category) notFound();
  return <MarketsPageModule category={category} />;
}
