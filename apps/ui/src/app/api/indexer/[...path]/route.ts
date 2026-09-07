import type { NextRequest } from "next/server";
import { protocolConfig } from "@/config/protocol";
import { MODE_COOKIE } from "@/lib/demo/mode";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (request.cookies.get(MODE_COOKIE)?.value === "demo")
    return Response.json({ error: "Live indexer is disabled in demo mode." }, { status: 409 });
  const { path } = await params;
  // Public UI must never tunnel the indexer's service-only endpoints.
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
  const target = new URL(`/${path.join("/")}`, protocolConfig.indexerUrl);
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
