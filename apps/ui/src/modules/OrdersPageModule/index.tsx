import { DemoPage } from "@/components/demo/DemoPage";
import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { OrdersClient } from "./components/OrdersClient";
export async function OrdersPageModule() {
  if (await isDemoMode()) return <DemoPage page="orders" />;
  const markets = await serverApi.markets();
  return (
    <main className="mx-auto w-full max-w-[1280px] px-5 py-14 sm:px-8">
      <p className="text-xs font-bold tracking-[0.12em] text-brand-strong uppercase">
        Orders & fills
      </p>
      <h1 className="mt-4 font-display text-5xl font-medium tracking-[-0.06em] sm:text-6xl">
        Canonical, not optimistic.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
        Submitted orders remain pending until OrderOpened is indexed. Cancellations remain pending
        until the chain confirms them.
      </p>
      <OrdersClient markets={markets} />
    </main>
  );
}
