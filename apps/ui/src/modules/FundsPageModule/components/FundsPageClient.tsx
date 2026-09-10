"use client";
import { DemoControls } from "@/components/demo/DemoTools";
import { useMarkets } from "@/hooks/useProtocolData";
import type { MarketView } from "@/lib/api/types";
import { FundsClient } from "./FundsClient";
export function FundsPageClient({ markets }: { markets: MarketView[] }) {
  const query = useMarkets(markets);
  return (
    <>
      <FundsClient markets={query.markets} />
      <DemoControls />
    </>
  );
}
