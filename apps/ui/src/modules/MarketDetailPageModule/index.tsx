import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { MarketWorkspace } from "./components/MarketWorkspace";
export async function MarketDetailPageModule({ marketId }: { marketId: string }) {
  const demo = await isDemoMode();
  const [markets, trades] = demo
    ? [[], []]
    : await Promise.all([serverApi.markets(), serverApi.trades(marketId)]);
  return <MarketWorkspace marketId={marketId} initialMarkets={markets} initialTrades={trades} />;
}
