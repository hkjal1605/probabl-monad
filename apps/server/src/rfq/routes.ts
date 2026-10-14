/** The RFQ stream (one WebSocket per approved maker connection) and the market admin's maker
 * approvals. A maker connects with the API key the market admin issued for its wallet; the key is
 * shown once and only its SHA-256 is stored. Revoking a key closes its live connections. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database, RfqMakerRecord } from "@conditional-stocks/db";
import { address } from "@conditional-stocks/evm-client";
import type { ServerWebSocket } from "bun";
import type { Context, Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import { type Address, getAddress } from "viem";
import { type Auth, forbidden } from "../auth/routes.ts";
import { clientIp, RateLimiter } from "../common/rate-limit.ts";
import type { RfqHub, RfqSession } from "./hub.ts";

export const API_KEY_PREFIX = "pbl_rfq_";
const API_KEY = /^pbl_rfq_[A-Za-z0-9_-]{43}$/;
const MAKER_ID = /^[0-9a-f-]{36}$/;

/** A new API key: 32 random bytes. */
export const newApiKey = () => API_KEY_PREFIX + randomBytes(32).toString("base64url");
export const apiKeyHash = (key: string) => createHash("sha256").update(key).digest("hex");

export function mountRfq(
  app: Hono,
  options: {
    db: Database;
    domain: string;
    auth: Auth;
    /** Null without delegated trading: quotes could not settle. */
    hub: RfqHub | null;
    /** The market admin, who approves makers (null until indexed). */
    marketAdmin(): Address | null;
    trustedHops: number;
  },
) {
  const { db, domain, auth, hub } = options;
  // Keys are unguessable; this only keeps reconnect storms and bad keys off the database.
  const connects = new RateLimiter(30, 60_000);

  app.get(
    "/v1/rfq/stream",
    upgradeWebSocket(async (c) => {
      if (!hub)
        throw new HTTPException(503, { message: "RFQ is unavailable: delegated trading is off" });
      if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
        throw new HTTPException(426, { message: "Connect with a WebSocket" });
      connects.enforce(c, clientIp(c, options.trustedHops));
      const header = c.req.header("authorization") ?? "";
      const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!API_KEY.test(key))
        throw new HTTPException(401, { message: "Send an approved RFQ API key as a Bearer token" });
      const record = await db.rfqMakerByKey(domain, apiKeyHash(key));
      if (!record) throw new HTTPException(401, { message: "Unknown or revoked RFQ API key" });
      const maker = { id: record.id, label: record.label, wallet: getAddress(record.wallet) };
      let session: RfqSession | null = null;
      return {
        onOpen(_event, ws) {
          const socket = ws.raw as ServerWebSocket<unknown>;
          session = {
            maker,
            // 0: dropped (the connection is closing or over its backpressure limit).
            send: (message) => socket.send(JSON.stringify(message)) !== 0,
            close: (code, reason) => socket.close(code, reason),
          };
          hub.attach(session);
        },
        onMessage(event) {
          if (!session) return;
          if (typeof event.data !== "string") {
            session.send({ type: "error", message: "Send JSON text frames" });
            return;
          }
          hub.receive(session, event.data);
        },
        onClose() {
          if (session) hub.detach(session);
        },
      };
    }),
  );

  /** Whether makers are online, so the app can say a market order goes out for quotes. */
  app.get("/v1/rfq/status", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({
      available: Boolean(hub),
      makers: hub?.makers() ?? 0,
      quoteWindowMs: hub?.options.windowMs ?? null,
    });
  });

  // ---------------------------------------------------------------- market admin

  const admin = async (c: Context) => {
    const { owner } = await auth.session(c);
    const marketAdmin = options.marketAdmin();
    if (!marketAdmin)
      throw new HTTPException(503, { message: "Governance roles are not indexed yet" });
    if (owner !== marketAdmin)
      throw forbidden("Only the market admin approves RFQ makers.", "operator");
    return owner;
  };
  const view = (r: RfqMakerRecord) => ({
    id: r.id,
    label: r.label,
    wallet: getAddress(r.wallet),
    keyPrefix: r.keyPrefix,
    createdBy: getAddress(r.createdBy),
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
    status: r.revokedAt ? "revoked" : "active",
    ...(hub?.status(r.id) ?? { connections: 0 }),
  });

  app.get("/v1/admin/rfq/makers", async (c) => {
    await admin(c);
    c.header("Cache-Control", "no-store");
    return c.json({
      available: Boolean(hub),
      quoteWindowMs: hub?.options.windowMs ?? null,
      makers: (await db.rfqMakers(domain)).map(view),
    });
  });

  /** Approves a maker wallet: the response carries its API key, which is never shown again. */
  app.post("/v1/admin/rfq/makers", async (c) => {
    const createdBy = await admin(c);
    const body = (await c.req.json().catch(() => null)) as {
      label?: unknown;
      wallet?: unknown;
    } | null;
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    if (!label || label.length > 64)
      throw new HTTPException(400, { message: "Name the maker in 1 to 64 characters" });
    let wallet: Address;
    try {
      wallet = address(body?.wallet);
    } catch {
      throw new HTTPException(400, { message: "Give the maker's wallet address" });
    }
    const key = newApiKey();
    const record = await db.createRfqMaker(domain, {
      id: randomUUID(),
      label,
      wallet,
      keyHash: apiKeyHash(key),
      keyPrefix: key.slice(0, API_KEY_PREFIX.length + 4),
      createdBy,
    });
    return c.json({ maker: view(record), apiKey: key }, 201);
  });

  app.post("/v1/admin/rfq/makers/:id/revoke", async (c) => {
    await admin(c);
    const id = c.req.param("id");
    if (!MAKER_ID.test(id)) throw new HTTPException(400, { message: "Invalid maker id" });
    if (!(await db.revokeRfqMaker(domain, id)))
      throw new HTTPException(404, { message: "No active maker with this id" });
    hub?.disconnect(id);
    return c.json({ revoked: true });
  });
}
