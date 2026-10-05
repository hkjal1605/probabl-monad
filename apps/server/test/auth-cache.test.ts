/** Authenticated requests read the database once per session and wallet, not per request. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Database } from "@conditional-stocks/db";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { PublicClient } from "viem";
import { mountAuthentication } from "../src/auth/routes.ts";

const token = "ab".repeat(32);
const wallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const calls = { session: 0, member: 0 };
const db = {
  session: async (_domain: string, tokenHash: string) => {
    calls.session++;
    return tokenHash === createHash("sha256").update(token).digest("hex")
      ? { owner: wallet.toLowerCase(), expiresAtMs: Date.now() + 3_600_000 }
      : undefined;
  },
  member: async () => {
    calls.member++;
    return {
      wallet: wallet.toLowerCase(),
      code: "BETA0001",
      referrer: null,
      joinedAt: new Date(),
      codeQuota: 5,
      suspendedAt: null,
    };
  },
} as unknown as Database;

const app = new Hono();
app.onError(
  (error) =>
    new Response(JSON.stringify({ error: { message: error.message } }), {
      status: error instanceof HTTPException ? error.status : 500,
    }),
);
const auth = mountAuthentication(app, {
  db,
  client: {} as PublicClient,
  deployment: { chainId: 31337, exchange: "0x00000000000000000000000000000000000000E1" },
  domain: "test",
  origins: ["https://probabl.trade"],
  secureCookie: true,
  trustedHops: 0,
  codeQuota: 5,
});
app.on(["GET", "POST"], "/private", async (c) => c.json({ owner: (await auth.trader(c)).owner }));
const request = (headers: Record<string, string>, method = "GET") =>
  app.request("/private", { method, headers });

test("a hot trading path costs one session and one membership read in total", async () => {
  for (let i = 0; i < 100; i++)
    expect((await request({ authorization: `Bearer ${token}` })).status).toBe(200);
  // The browser's cookie carries the same session: still cached.
  const cookie = { cookie: `__Host-probabl_session_${wallet.slice(2).toLowerCase()}=${token}` };
  for (let i = 0; i < 100; i++) expect((await request(cookie)).status).toBe(200);
  expect(calls).toEqual({ session: 1, member: 1 });
  // A forged cookie-authenticated change is refused before any read.
  expect((await request(cookie, "POST")).status).toBe(403);
  const app = { ...cookie, origin: "https://probabl.trade", "x-probabl-client": "web" };
  expect((await request(app, "POST")).status).toBe(200);
  expect(calls).toEqual({ session: 1, member: 1 });
  // Membership changes are reread once.
  auth.forgetMember(wallet);
  expect((await request(cookie)).status).toBe(200);
  expect(calls).toEqual({ session: 1, member: 2 });
});

test("guessed tokens are remembered too, so they cannot hammer the database", async () => {
  const before = calls.session;
  for (let i = 0; i < 100; i++)
    expect((await request({ authorization: `Bearer ${"cd".repeat(32)}` })).status).toBe(401);
  expect(calls.session - before).toBe(1);
  // Malformed credentials never reach it.
  for (const authorization of ["Bearer nope", `Basic ${token}`])
    expect((await request({ authorization })).status).toBe(401);
  expect(
    (await request({ cookie: `__Host-probabl_session_${wallet.slice(2).toLowerCase()}=short` }))
      .status,
  ).toBe(401);
  expect(calls.session - before).toBe(1);
});
