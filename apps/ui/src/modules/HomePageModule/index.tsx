import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { Landing } from "./components/Landing";
export async function HomePageModule() {
  return <Landing initialMarkets={(await isDemoMode()) ? [] : await serverApi.markets()} />;
}
