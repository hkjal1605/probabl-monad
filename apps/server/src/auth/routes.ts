import { createHash, randomBytes } from "node:crypto";
import {
  type Database,
  InviteError,
  type MemberRecord,
  SignInCapacityError,
} from "@conditional-stocks/db";
import {
  address,
  type Deployment,
  signInInvite,
  signInMessage,
} from "@conditional-stocks/evm-client";
import { normalizeInviteCode } from "@conditional-stocks/shared/invites";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import {
  type Address,
  getAddress,
  type Hex,
  isAddress,
  type PublicClient,
  recoverMessageAddress,
} from "viem";
import { clientIp, RateLimiter } from "../common/rate-limit.ts";

/** Bearer-only check (scripts and the admin console): the signed-in wallet. */
export type Authenticate = (header: string | undefined) => Promise<string>;

export interface Session {
  owner: Address;
  expiresAtMs: number;
  /** When the wallet signed in: renewals never reach past SESSION_MAX_DAYS after it. */
  createdAtMs: number;
  /** A cookie (the trading app on the API's site) or a bearer token (the trading app on another
   * site, scripts, the admin console). */
  via: "cookie" | "bearer";
  tokenHash: string;
}
export interface MemberView {
  joinedAt: string;
  referrer: Address | null;
  codeQuota: number;
  suspended: boolean;
}
export interface Auth {
  /** The signed-in wallet (`owner`, when the request reads one wallet's data), or 401. */
  session(c: Context, owner?: string | null): Promise<Session>;
  /** A signed-in member (403 `invite-required` when not), and when `owner` is given, that very
   * wallet (403 `wrong-wallet`): portfolio reads. A suspended member still sees its own. */
  member(c: Context, owner?: string | null): Promise<Session & { member: MemberRecord }>;
  /** The same, and not suspended (403 `suspended`): anything that trades. Exits (withdrawals,
   * cancellations) only need `session`: a wallet's own funds are never held back. */
  trader(c: Context, owner?: string | null): Promise<Session & { member: MemberRecord }>;
  bearer: Authenticate;
  memberOf(wallet: Address): Promise<MemberRecord | null>;
  /** Drops cached membership after a change (joining, suspension, quota). */
  forgetMember(wallet: string): void;
}

/** A session lasts 30 days from its last use: the app's session read renews it (at most daily). */
export const SESSION_DAYS = 30;
/** Renewals stop this long after sign-in; then the wallet signs in again. */
export const SESSION_MAX_DAYS = 90;
const DAY_MS = 86_400_000;
/** Header the trading app sends with every request: a cross-site form cannot, so a
 * cookie-authenticated mutation without it is refused. */
export const CLIENT_HEADER = "x-probabl-client";
/** The wallet a request acts for. Each wallet keeps its own session cookie (switching accounts
 * needs no new signature), and the app names the wallet with its changes. */
export const WALLET_HEADER = "x-probabl-wallet";
/** Cookie of one wallet's session: this name plus the wallet's 40 lowercase hex digits. */
export const SESSION_COOKIE = "probabl_session_";
const ownerKey = (wallet: string) => getAddress(wallet);
export const memberView = (m: MemberRecord): MemberView => ({
  joinedAt: m.joinedAt.toISOString(),
  referrer: m.referrer === null ? null : getAddress(m.referrer),
  codeQuota: m.codeQuota,
  suspended: m.suspendedAt !== null,
});
/** A 403 with a machine-readable code the app branches on. */
export const forbidden = (message: string, code: string) =>
  new HTTPException(403, { message, cause: { code } });

/** Bounded map with least-recently-used eviction and per-entry expiry. */
class Expiring<V> {
  private readonly entries = new Map<string, { value: V; until: number }>();
  constructor(private readonly capacity: number) {}
  get(key: string, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.until <= now) return undefined;
    this.entries.set(key, entry);
    return entry;
  }
  set(key: string, value: V, ttlMs: number) {
    this.entries.delete(key);
    if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, until: Date.now() + ttlMs });
  }
  delete(key: string) {
    this.entries.delete(key);
  }
  deleteWhere(match: (value: V) => boolean) {
    for (const [key, entry] of this.entries) if (match(entry.value)) this.entries.delete(key);
  }
}

/** Wallet sign-in (Sign-In with Ethereum). The trading app on the API's site keeps each wallet's
 * session in its own HttpOnly cookie; an app on another site, scripts and the admin console use
 * bearer tokens. Sessions last SESSION_DAYS from their last use (renewed by the app's session
 * read, up to SESSION_MAX_DAYS after sign-in), are stored only as hashes, and lookups (session
 * and membership) are cached briefly in memory, so authenticated requests rarely read the
 * database. */
export function mountAuthentication(
  app: Hono,
  options: {
    db: Database;
    client: PublicClient;
    deployment: Deployment;
    domain: string;
    origins: readonly string[];
    /** Secure `__Host-` cookie; only local plain-HTTP development turns it off. */
    secureCookie: boolean;
    trustedHops: number;
    codeQuota: number;
  },
): Auth {
  const { db, client, deployment, domain, origins, secureCookie, trustedHops, codeQuota } = options;
  const prefix = secureCookie ? ("host" as const) : undefined;
  const cookieName = (wallet: string) => `${SESSION_COOKIE}${wallet.slice(2).toLowerCase()}`;
  const sessionCookie = new RegExp(
    `^${secureCookie ? "__Host-" : ""}${SESSION_COOKIE}[0-9a-f]{40}$`,
  );
  const writeCookie = (c: Context, wallet: string, token: string, expiresAtMs: number) =>
    setCookie(c, cookieName(wallet), token, {
      path: "/",
      httpOnly: true,
      secure: secureCookie,
      sameSite: "Strict",
      maxAge: Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)),
      ...(prefix ? { prefix } : {}),
    });
  const clearCookie = (c: Context, wallet: string) =>
    deleteCookie(c, cookieName(wallet), {
      path: "/",
      secure: secureCookie,
      ...(prefix ? { prefix } : {}),
    });
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const random = () => randomBytes(32).toString("hex");
  const sessions = new Expiring<{
    owner: Address;
    expiresAtMs: number;
    createdAtMs: number;
  } | null>(20_000);
  const members = new Expiring<MemberRecord | null>(20_000);
  const signIns = new RateLimiter(30, 60_000);
  const redemptions = new RateLimiter(10, 60_000);
  const walletRedemptions = new RateLimiter(10, 3_600_000);

  const resolve = async (token: string, via: Session["via"]): Promise<Session> => {
    const tokenHash = hash(token);
    let entry = sessions.get(tokenHash)?.value;
    if (entry === undefined) {
      const row = await db.session(domain, tokenHash);
      entry = row
        ? {
            owner: getAddress(row.owner),
            expiresAtMs: row.expiresAtMs,
            createdAtMs: row.createdAtMs,
          }
        : null;
      // Unknown tokens are remembered briefly too, so guessing never hammers the database.
      sessions.set(tokenHash, entry, entry ? 60_000 : 10_000);
    }
    if (!entry || entry.expiresAtMs <= Date.now())
      throw new HTTPException(401, { message: "Session expired. Sign in again." });
    return { ...entry, via, tokenHash };
  };
  const bearer = (header: string) => {
    if (!/^Bearer [a-f0-9]{64}$/.test(header))
      throw new HTTPException(401, { message: "Sign in to continue" });
    return resolve(header.slice(7), "bearer");
  };
  const allowedOrigin = (c: Context) => {
    const origin = c.req.header("origin");
    return origin !== undefined && origins.includes(origin);
  };
  /** The session cookie of the wallet a request names (its header on changes, the owner whose
   * data it reads, or `?wallet=`), or this browser's only one when it names none. */
  const cookieToken = (c: Context, owner?: string | null) => {
    const named = c.req.header(WALLET_HEADER) ?? owner ?? c.req.query("wallet") ?? null;
    if (named !== null)
      return isAddress(named)
        ? { token: getCookie(c, cookieName(named), prefix), named: getAddress(named) }
        : { token: undefined, named: null };
    const held = Object.entries(getCookie(c)).filter(([name]) => sessionCookie.test(name));
    return { token: held.length === 1 ? held[0]?.[1] : undefined, named: null };
  };
  const credential = async (c: Context, owner?: string | null) => {
    const header = c.req.header("authorization");
    if (header) return bearer(header);
    const { token, named } = cookieToken(c, owner);
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new HTTPException(401, { message: "Sign in to continue" });
    // A cookie travels with any request to this host, so a state change also needs the app's
    // origin and header, which other sites cannot forge.
    if (
      c.req.method !== "GET" &&
      c.req.method !== "HEAD" &&
      (!allowedOrigin(c) || c.req.header(CLIENT_HEADER) !== "web")
    )
      throw forbidden("This request did not come from the probabl app.", "origin");
    const s = await resolve(token, "cookie");
    // Cookies are named after the wallet that signed in; one holding another wallet's session
    // is not this wallet's.
    if (named && s.owner !== named)
      throw new HTTPException(401, { message: "Sign in to continue" });
    return s;
  };
  const session = async (c: Context, owner?: string | null) => {
    const s = await credential(c, owner);
    const expected = c.req.header(WALLET_HEADER);
    if (expected !== undefined && !(isAddress(expected) && getAddress(expected) === s.owner))
      throw forbidden("You are signed in with a different wallet.", "wrong-wallet");
    return s;
  };
  const memberOf = async (wallet: Address) => {
    const key = ownerKey(wallet);
    const cached = members.get(key);
    if (cached) return cached.value;
    const member = (await db.member(key)) ?? null;
    members.set(key, member, 60_000);
    return member;
  };
  const member = async (c: Context, owner?: string | null) => {
    const s = await session(c, owner);
    const m = await memberOf(s.owner);
    if (!m)
      throw forbidden(
        "An invite code is required to trade and view your portfolio.",
        "invite-required",
      );
    if (owner && getAddress(owner) !== s.owner)
      throw forbidden("You are signed in with a different wallet.", "wrong-wallet");
    return { ...s, member: m };
  };
  const trader = async (c: Context, owner?: string | null) => {
    const s = await member(c, owner);
    if (s.member.suspendedAt) throw forbidden("This account is suspended.", "suspended");
    return s;
  };
  /** The session as the app sees it. `expiresInMs` lets it time the session by its own clock,
   * whatever that clock says. */
  const view = async (s: { owner: Address; expiresAtMs: number }) => {
    const m = await memberOf(s.owner);
    return {
      wallet: s.owner,
      expiresAtMs: s.expiresAtMs,
      expiresInMs: Math.max(0, s.expiresAtMs - Date.now()),
      member: m ? memberView(m) : null,
    };
  };
  /** Extends a session in use to SESSION_DAYS from now (within SESSION_MAX_DAYS of sign-in),
   * writing only when that adds a day or more. Returns its expiry. */
  const renew = async (c: Context, s: Session) => {
    const target = Math.min(
      Date.now() + SESSION_DAYS * DAY_MS,
      s.createdAtMs + SESSION_MAX_DAYS * DAY_MS,
    );
    if (target < s.expiresAtMs + DAY_MS) return s.expiresAtMs;
    const renewed = await db.renewSession(domain, s.tokenHash, SESSION_DAYS, SESSION_MAX_DAYS);
    if (renewed === undefined) return s.expiresAtMs;
    sessions.set(
      s.tokenHash,
      { owner: s.owner, expiresAtMs: renewed, createdAtMs: s.createdAtMs },
      60_000,
    );
    if (s.via === "cookie") {
      const { token } = cookieToken(c, s.owner);
      if (token) writeCookie(c, s.owner, token, renewed);
    }
    return renewed;
  };

  app.post("/v1/auth/challenge", async (c) => {
    signIns.enforce(c, `challenge:${clientIp(c, trustedHops)}`);
    const body = await c.req.json();
    const owner = address(body.address);
    const origin = body.origin;
    if (typeof origin !== "string" || !origins.includes(origin))
      throw new HTTPException(403, { message: "Sign-in origin is not authorized" });
    // A page may only ask for its own origin; scripts (no Origin header) name an allowed one.
    const requestOrigin = c.req.header("origin");
    if (requestOrigin !== undefined && requestOrigin !== origin)
      throw new HTTPException(403, { message: "Sign-in origin differs from the requesting page" });
    let invite: string | null = null;
    if (body.invite !== undefined && body.invite !== null && body.invite !== "") {
      invite = normalizeInviteCode(body.invite);
      if (!invite) throw new HTTPException(400, { message: "That is not an invite code." });
      // Only a wallet that has not joined redeems; refuse a code that cannot work before the
      // wallet is asked to sign.
      if (await memberOf(owner)) invite = null;
      else {
        const refusal = await db.inviteRefusal(invite, owner);
        if (refusal) throw new HTTPException(400, { message: refusal });
      }
    }
    const id = random();
    const now = Date.now();
    const message = signInMessage(deployment, origin, owner, id, new Date(now + 120_000), {
      invite,
      issuedAt: new Date(now),
    });
    try {
      await db.createChallenge(domain, owner, id, message);
    } catch (error) {
      if (error instanceof SignInCapacityError)
        throw new HTTPException(429, { message: error.message });
      throw error;
    }
    // The invite this message carries (none for a wallet that already joined), so the app can
    // check the message names exactly what it asked for.
    return c.json({ challengeId: id, message, invite });
  });

  app.post("/v1/auth/verify", async (c) => {
    signIns.enforce(c, `verify:${clientIp(c, trustedHops)}`);
    const body = await c.req.json();
    const owner = address(body.address);
    // "cookie" sets this wallet's HttpOnly cookie; "token" returns a bearer token (an app on
    // another site); "both" does both, so the app can see which one reaches the API.
    const mode = body.session === "cookie" || body.session === "both" ? body.session : "token";
    if (
      typeof body.challengeId !== "string" ||
      typeof body.signature !== "string" ||
      !/^0x[0-9a-fA-F]{2,4096}$/.test(body.signature)
    )
      throw new HTTPException(400, { message: "Invalid authentication proof" });
    if (mode !== "token" && !allowedOrigin(c))
      throw forbidden("This request did not come from the probabl app.", "origin");
    const message = await db.challenge(domain, owner, body.challengeId);
    if (!message) throw new HTTPException(400, { message: "Challenge expired or consumed" });
    const signature = body.signature as Hex;
    // An ordinary wallet's signature recovers locally; only contract wallets (ERC-1271, and
    // ERC-6492 before deployment) need the chain.
    const recovered = await recoverMessageAddress({ message, signature }).catch(() => null);
    if (
      recovered !== owner &&
      !(await client.verifyMessage({ address: owner, message, signature }).catch(() => false))
    )
      throw new HTTPException(400, { message: "Invalid signature" });
    const token = random();
    const expiresAtMs = await db.consumeChallenge(
      domain,
      owner,
      body.challengeId,
      hash(token),
      SESSION_DAYS,
    );
    sessions.set(hash(token), { owner, expiresAtMs, createdAtMs: Date.now() }, 60_000);
    // A new wallet signed its invite code into the message: it joins now.
    let inviteError: string | undefined;
    const invite = signInInvite(message);
    if (invite && !(await memberOf(owner)))
      try {
        members.set(owner, await db.redeemInvite(owner, invite, codeQuota), 60_000);
      } catch (error) {
        if (!(error instanceof InviteError)) throw error;
        inviteError = error.message;
      }
    const session = await view({ owner, expiresAtMs });
    if (mode !== "token") writeCookie(c, owner, token, expiresAtMs);
    return c.json({ ...(mode === "cookie" ? {} : { token }), ...session, inviteError });
  });

  /** The app's session read (on load, and daily in a long-open tab): it also renews the session,
   * so a wallet in use stays signed in. Cookie requests name their wallet (`?wallet=`). */
  app.get("/v1/auth/session", async (c) => {
    c.header("Cache-Control", "no-store");
    const s = await session(c);
    return c.json(await view({ owner: s.owner, expiresAtMs: await renew(c, s) }));
  });

  /** Whether this page's cookies reach the API: they do not from a page on another site, or in a
   * browser blocking them. The app checks once, then keeps its sessions in cookies only if they
   * do (otherwise as bearer tokens in browser storage). A throwaway cookie, set then read. */
  const CHECK_COOKIE = "probabl_cookie_check";
  app.post("/v1/auth/cookie-check", (c) => {
    setCookie(c, CHECK_COOKIE, "1", {
      path: "/",
      httpOnly: true,
      secure: secureCookie,
      sameSite: "Strict",
      maxAge: 60,
      ...(prefix ? { prefix } : {}),
    });
    return c.json({ ok: true });
  });
  app.get("/v1/auth/cookie-check", (c) => {
    c.header("Cache-Control", "no-store");
    const reached = getCookie(c, CHECK_COOKIE, prefix) === "1";
    if (reached)
      deleteCookie(c, CHECK_COOKIE, {
        path: "/",
        secure: secureCookie,
        ...(prefix ? { prefix } : {}),
      });
    return c.json({ cookies: reached });
  });

  /** Moves a bearer session (one an earlier app release kept in browser storage) into its
   * wallet's cookie: upgrading the app never asks for a new signature. */
  app.post("/v1/auth/session/cookie", async (c) => {
    if (!allowedOrigin(c))
      throw forbidden("This request did not come from the probabl app.", "origin");
    const header = c.req.header("authorization");
    if (!header) throw new HTTPException(401, { message: "Sign in to continue" });
    const s = await bearer(header);
    writeCookie(c, s.owner, header.slice(7), s.expiresAtMs);
    return c.json(await view(s));
  });

  app.post("/v1/auth/logout", async (c) => {
    const s = await session(c);
    await db.deleteSession(domain, s.tokenHash);
    sessions.delete(s.tokenHash);
    if (s.via === "cookie") clearCookie(c, s.owner);
    return c.json({ ok: true });
  });
  app.post("/v1/auth/logout-all", async (c) => {
    const s = await session(c);
    const ended = await db.deleteSessions(domain, s.owner);
    sessions.deleteWhere((entry) => entry?.owner === s.owner);
    if (s.via === "cookie") clearCookie(c, s.owner);
    return c.json({ ok: true, ended });
  });

  app.post("/v1/invites/redeem", async (c) => {
    const s = await session(c);
    redemptions.enforce(c, `redeem:${clientIp(c, trustedHops)}`);
    walletRedemptions.enforce(c, `redeem:${s.owner}`);
    const code = normalizeInviteCode((await c.req.json()).code);
    if (!code) throw new HTTPException(400, { message: "That is not an invite code." });
    try {
      const joined = await db.redeemInvite(s.owner, code, codeQuota);
      members.set(s.owner, joined, 60_000);
      return c.json({ member: memberView(joined) });
    } catch (error) {
      if (error instanceof InviteError) throw new HTTPException(400, { message: error.message });
      throw error;
    }
  });

  return {
    session,
    member,
    trader,
    bearer: async (header) => {
      if (!header) throw new HTTPException(401, { message: "Sign in to continue" });
      return (await bearer(header)).owner;
    },
    memberOf,
    forgetMember: (wallet) => members.delete(ownerKey(wallet)),
  };
}
