import { Button } from "@conditional-stocks/ui-kit/button";
import { ArrowRight, DatabaseZap } from "lucide-react";
import Link from "next/link";
import { DemoPage } from "@/components/demo/DemoPage";
import { MarketCard } from "@/components/market/MarketCard";
import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { Hero } from "./components/Hero";
import { HowItWorks } from "./components/HowItWorks";

export async function HomePageModule() {
  if (await isDemoMode()) return <DemoPage page="home" />;
  const markets = await serverApi.markets();
  return (
    <main>
      <Hero market={markets[0] ?? null} />
      <section className="mx-auto w-full max-w-[1280px] px-5 py-24 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-brand-strong uppercase">
              Active opportunities
            </p>
            <h2 className="mt-4 font-display text-4xl font-medium tracking-[-0.055em] sm:text-5xl">
              Compare both outcomes at a glance.
            </h2>
          </div>
          <Button asChild variant="outline">
            <Link href="/markets">
              All markets <ArrowRight />
            </Link>
          </Button>
        </div>
        {markets.length === 0 ? (
          <div className="mt-10 flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed text-center">
            <DatabaseZap className="text-muted-foreground" />
            <p className="mt-4 font-semibold">No indexed markets yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Start the protocol services or choose Try demo mode to explore the app locally.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {markets.slice(0, 3).map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        )}
      </section>
      <HowItWorks />
    </main>
  );
}
