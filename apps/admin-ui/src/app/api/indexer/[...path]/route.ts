import type { NextRequest } from "next/server";
import { adminConfig } from "@/config/protocol";
import { logger } from "@/lib/logger";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (
    path.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)) ||
    ![
      "markets",
      "orders",
      "orderbook",
      "trades",
      "balances",
      "positions",
      "resolutions",
      "transactions",
    ].includes(path[0] ?? "")
  )
    return Response.json({ error: "route-not-public" }, { status: 404 });
  const target = new URL(`/${path.join("/")}`, adminConfig.indexerUrl);
  target.search = request.nextUrl.search;
  try {
    const response = await fetch(target, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    return new Response(response.body, {
      headers: { "content-type": "application/json" },
      status: response.status,
    });
  } catch (error) {
    logger.error("indexer.upstream.unavailable", { method: request.method, error });
    return Response.json({ error: "indexer-unavailable" }, { status: 503 });
  }
}
