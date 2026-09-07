import { DemoPage } from "@/components/demo/DemoPage";
import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { PortfolioClient } from "./components/PortfolioClient";
export async function PortfolioPageModule() {
  if (await isDemoMode()) return <DemoPage page="portfolio" />;
  const markets = await serverApi.markets();
  return (
    <main className="mx-auto w-full max-w-[1280px] px-5 py-14 sm:px-8">
      <p className="text-xs font-bold tracking-[0.12em] text-brand-strong uppercase">Portfolio</p>
      <h1 className="mt-4 font-display text-5xl font-medium tracking-[-0.06em] sm:text-6xl">
        Every outcome, in one place.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
        See whole tokens, conditional claims, reservations, and the exact actions available before
        and after resolution.
      </p>
      <PortfolioClient markets={markets} />
    </main>
  );
}
