import { DemoPage } from "@/components/demo/DemoPage";
import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { MarketsExplorer } from "./components/MarketsExplorer";
export async function MarketsPageModule() {
  if (await isDemoMode()) return <DemoPage page="markets" />;
  const markets = await serverApi.markets();
  return (
    <main className="mx-auto w-full max-w-[1280px] px-5 py-14 sm:px-8">
      <p className="text-xs font-bold tracking-[0.12em] text-brand-strong uppercase">
        Market discovery
      </p>
      <h1 className="mt-4 font-display text-5xl font-medium tracking-[-0.06em] sm:text-6xl">
        Find the event. Compare the branches.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
        Probability is context. The YES and NO books show the prices you can actually trade, along
        with liquidity and data quality.
      </p>
      <MarketsExplorer markets={markets} />
    </main>
  );
}
