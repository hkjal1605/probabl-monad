import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";
import { PortfolioClient } from "./components/PortfolioClient";
export async function PortfolioPageModule() {
  const markets = (await isDemoMode()) ? [] : await serverApi.markets();
  return <PortfolioClient markets={markets} />;
}
