import { createHash, randomBytes } from "node:crypto";
import { type Database, SignInCapacityError } from "@conditional-stocks/db";
import { address, type Deployment, signInMessage } from "@conditional-stocks/evm-client";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Hex, PublicClient } from "viem";

export type Authenticate = (header: string | undefined) => Promise<string>;

/** Wallet sign-in. Sessions are bearer tokens stored only as hashes; lookups are cached briefly
 * in memory so authenticated requests do not each read the database. */
export function mountAuthentication(
  app: Hono,
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  domain: string,
  origins: readonly string[],
): Authenticate {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const random = () => randomBytes(32).toString("hex");
  const sessions = new Map<string, { owner: string; until: number }>();
  const authenticate: Authenticate = async (header) => {
    if (!header || !/^Bearer [a-f0-9]{64}$/.test(header))
      throw new HTTPException(401, { message: "Sign in to continue" });
    const tokenHash = hash(header.slice(7));
    const cached = sessions.get(tokenHash);
    if (cached && cached.until > Date.now()) return cached.owner;
    const owner = await db.sessionOwner(domain, tokenHash);
    if (!owner) throw new HTTPException(401, { message: "Session expired" });
    if (sessions.size >= 10_000) sessions.clear();
    sessions.set(tokenHash, { owner, until: Date.now() + 60_000 });
    return owner;
  };

  app.post("/v1/auth/challenge", async (c) => {
    const body = await c.req.json();
    const owner = address(body.address);
    const origin = body.origin;
    if (typeof origin !== "string" || !origins.includes(origin))
      throw new HTTPException(403, { message: "Sign-in origin is not authorized" });
    const id = random();
    const message = signInMessage(deployment, origin, owner, id, new Date(Date.now() + 120_000));
    try {
      await db.createChallenge(domain, owner, id, message);
    } catch (error) {
      if (error instanceof SignInCapacityError)
        throw new HTTPException(429, { message: error.message });
      throw error;
    }
    return c.json({ challengeId: id, message });
  });

  app.post("/v1/auth/verify", async (c) => {
    const body = await c.req.json();
    const owner = address(body.address);
    if (
      typeof body.challengeId !== "string" ||
      typeof body.signature !== "string" ||
      !/^0x[0-9a-fA-F]{2,4096}$/.test(body.signature)
    )
      throw new HTTPException(400, { message: "Invalid authentication proof" });
    const message = await db.challenge(domain, owner, body.challengeId);
    if (!message) throw new HTTPException(400, { message: "Challenge expired or consumed" });
    // Supports EOAs and smart-contract wallets (ERC-1271, and ERC-6492 before deployment).
    if (
      !(await client.verifyMessage({ address: owner, message, signature: body.signature as Hex }))
    )
      throw new HTTPException(400, { message: "Invalid signature" });
    const token = random();
    const expiresAtMs = await db.consumeChallenge(domain, owner, body.challengeId, hash(token));
    return c.json({ token, expiresAtMs });
  });

  return authenticate;
}
