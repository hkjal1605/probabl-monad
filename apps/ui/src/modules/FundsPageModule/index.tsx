import { DemoPage } from "@/components/demo/DemoPage";
import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { FundsClient } from "./components/FundsClient";
export async function FundsPageModule() {
  if (await isDemoMode()) return <DemoPage page="funds" />;
  const markets = await serverApi.markets();
  return (
    <main className="mx-auto w-full max-w-[1080px] px-5 py-14 sm:px-8">
      <p className="text-xs font-bold tracking-[0.12em] text-brand-strong uppercase">
        Funds & permissions
      </p>
      <h1 className="mt-4 font-display text-5xl font-medium tracking-[-0.06em] sm:text-6xl">
        Your wallet stays in control.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
        Fund your connected wallet, move assets out, and review protocol spending permissions
        without a custodial balance.
      </p>
      <FundsClient markets={markets} />
    </main>
  );
}
