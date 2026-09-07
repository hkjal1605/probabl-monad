"use client";

import { MarketTriptych } from "@/components/market/MarketTriptych";
import { useProbabilityStream } from "@/hooks/useProbabilityStream";
import type { MarketView } from "@/lib/api/types";

export function LiveMarketTriptych({ market }: { market: MarketView }) {
  const { probability } = useProbabilityStream(market.mapping.conditionId, market.probability);
  return <MarketTriptych market={{ ...market, probability }} />;
}
