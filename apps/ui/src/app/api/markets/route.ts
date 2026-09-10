import { serverApi } from "@/lib/api/server";
import { isDemoMode } from "@/lib/demo/server";

export async function GET() {
  if (await isDemoMode())
    return Response.json(
      { error: { message: "Live reads are disabled in demo mode" } },
      { status: 409 },
    );
  try {
    return Response.json(
      { markets: await serverApi.liveMarkets() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: { message: "Market data is temporarily unavailable. Please retry." } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
