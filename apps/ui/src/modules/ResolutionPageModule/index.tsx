import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { ResolutionClient } from "./components/ResolutionClient";
export async function ResolutionPageModule({ selected }: { selected?: string }) {
  const markets = (await isDemoMode()) ? [] : await serverApi.markets();
  return <ResolutionClient markets={markets} selected={selected} />;
}
