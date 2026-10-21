import type { MarketTab } from "@/lib/markets/categories";
import { MarketsExplorer } from "./components/MarketsExplorer";

export function MarketsPageModule({ category = "All" }: { category?: MarketTab }) {
  return <MarketsExplorer markets={[]} category={category} />;
}
