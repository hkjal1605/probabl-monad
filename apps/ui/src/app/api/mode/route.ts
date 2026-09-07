import { type NextRequest, NextResponse } from "next/server";
import { MODE_COOKIE } from "@/lib/demo/mode";

export async function POST(request: NextRequest) {
  // Mode changes require a same-origin form, not a cross-site POST/link.
  const origin = request.headers.get("origin");
  if (!origin || !URL.canParse(origin) || new URL(origin).origin !== request.nextUrl.origin)
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
