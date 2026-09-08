import { type NextRequest, NextResponse } from "next/server";
import { MODE_COOKIE } from "@/lib/demo/mode";

export async function POST(request: NextRequest) {
  // Mode changes require a same-origin form, not a cross-site POST/link.
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url);
  // NextURL normalizes loopback IPs to localhost. Recover the actual loopback
  // Host (same port only), without trusting arbitrary forwarded-host headers.
  if (requestOrigin.hostname === "localhost") {
    const port = requestOrigin.port ? `:${requestOrigin.port}` : "";
    const host = request.headers.get("host");
    if (host === `127.0.0.1${port}` || host === `[::1]${port}`) requestOrigin.host = host;
  }
  if (!origin || !URL.canParse(origin) || new URL(origin).origin !== requestOrigin.origin)
    return new Response("Invalid origin", { status: 403 });
  let body: FormData;
  try {
    body = await request.formData();
  } catch {
    return new Response("Invalid form", { status: 400 });
  }
  const mode = body.get("mode");
  if (mode !== "demo" && mode !== "live") return new Response("Invalid mode", { status: 400 });
  const returnTo = body.get("returnTo");
  const path =
    typeof returnTo === "string" &&
    ["/", "/markets", "/orders", "/portfolio", "/funds", "/resolution", "/learn"].includes(returnTo)
      ? returnTo
      : "/markets";
  const response = new NextResponse(null, {
    status: 303,
    headers: { location: path, "cache-control": "no-store" },
  });
  response.cookies.set(MODE_COOKIE, mode, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
