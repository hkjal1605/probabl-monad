import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET as gatewayGet, POST as gatewayPost } from "@/app/api/gateway/[...path]/route";
import { GET as indexerGet } from "@/app/api/indexer/[...path]/route";
import { POST as switchMode } from "@/app/api/mode/route";

const context = { params: Promise.resolve({ path: ["markets"] }) };
describe("demo server isolation", () => {
  test("both gateway methods and indexer reject demo cookies before upstream fetch", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      throw new Error("Live request escaped demo");
    }) as unknown as typeof fetch;
    try {
      for (const method of ["GET", "POST"] as const) {
        const request = new NextRequest("http://localhost:3001/api/gateway/markets", {
          method,
          headers: { cookie: "probabl-mode=demo" },
        });
        const response = await (method === "GET" ? gatewayGet : gatewayPost)(request, context);
        expect(response.status).toBe(409);
      }
      const response = await indexerGet(
        new NextRequest("http://localhost:3001/api/indexer/markets", {
          headers: { cookie: "probabl-mode=demo" },
        }),
        context,
      );
      expect(response.status).toBe(409);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
  test("live mode retains configured upstream routing, auth headers and response status", async () => {
    const original = globalThis.fetch;
    const calls: { url: string; auth: string | null }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return Response.json({ markets: [] }, { status: 200 });
    }) as typeof fetch;
    try {
      const gateway = await gatewayGet(
        new NextRequest("http://localhost:3001/api/gateway/markets", {
          headers: { cookie: "probabl-mode=live", authorization: "Bearer live-test-session" },
        }),
        context,
      );
      const indexer = await indexerGet(
        new NextRequest("http://localhost:3001/api/indexer/markets?limit=10"),
        context,
      );
      expect(gateway.status).toBe(200);
      expect(indexer.status).toBe(200);
      expect(new URL(calls[0]?.url ?? "").pathname).toBe("/v1/markets");
      expect(calls[0]?.auth).toBe("Bearer live-test-session");
      expect(new URL(calls[1]?.url ?? "").pathname).toBe("/markets");
      expect(new URL(calls[1]?.url ?? "").search).toBe("?limit=10");
    } finally {
      globalThis.fetch = original;
    }
  });
  test("mode switch uses a full navigation with a scoped cookie and no open redirect", async () => {
    const request = new NextRequest("https://example.test/api/mode", {
      method: "POST",
      headers: {
        host: "example.test",
        origin: "https://example.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "mode=demo&returnTo=https://attacker.test/",
    });
    const response = await switchMode(request);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/markets");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("probabl-mode=demo");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
  });
  test("mode switch rejects cross-origin posts and invalid modes", async () => {
    for (const [origin, mode, status] of [
      ["https://attacker.test", "demo", 403],
      ["null", "demo", 403],
      ["https://localhost:3001", "demo", 403],
      ["http://localhost:3001", "invalid", 400],
    ] as const) {
      const response = await switchMode(
        new NextRequest("http://localhost:3001/api/mode", {
          method: "POST",
          headers: {
            host: "localhost:3001",
            origin,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `mode=${mode}`,
        }),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});
