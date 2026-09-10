import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { MarketsExplorer } from "./components/MarketsExplorer";
export async function MarketsPageModule() {
  return <MarketsExplorer markets={(await isDemoMode()) ? [] : await serverApi.markets()} />;
}
