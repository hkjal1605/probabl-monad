/** Invites (members create codes within their quota; the market admin issues launch codes and
 * manages members) and the referral program's member and admin routes. */
import { type Database, InviteError } from "@conditional-stocks/db";
import {
  formatInviteCode,
  generateInviteCode,
  normalizeInviteCode,
} from "@conditional-stocks/shared/invites";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type Address, getAddress } from "viem";
import { type Auth, forbidden, memberView } from "../auth/routes.ts";
import { RateLimiter } from "../common/rate-limit.ts";
import type { Referrals } from "../referrals/service.ts";

const UNIQUE_VIOLATION = "23505";
const isUniqueViolation = (error: unknown) =>
  (error as { code?: string } | null)?.code === UNIQUE_VIOLATION;

const codeView = (c: Awaited<ReturnType<Database["inviteCodes"]>>[number], now = Date.now()) => ({
  code: formatInviteCode(c.code),
  createdAt: c.createdAt.toISOString(),
  expiresAt: c.expiresAt?.toISOString() ?? null,
  maxUses: c.maxUses,
  uses: c.uses,
  note: c.note,
  status: c.revokedAt
    ? "revoked"
    : c.uses >= c.maxUses
      ? "used"
      : c.expiresAt && c.expiresAt.getTime() <= now
        ? "expired"
        : "available",
  members: c.members.map((m) => ({
    wallet: getAddress(m.wallet),
    joinedAt: m.joinedAt.toISOString(),
  })),
});

export function mountInvites(
  app: Hono,
  options: {
    db: Database;
    auth: Auth;
    referrals: Referrals;
    /** The market admin, who runs the program (null until indexed). */
    marketAdmin(): Address | null;
  },
) {
  const { db, auth, referrals } = options;
  const creations = new RateLimiter(20, 3_600_000);
  const claims = new RateLimiter(5, 600_000);
  const admin = async (c: Context) => {
    const { owner } = await auth.session(c);
    const marketAdmin = options.marketAdmin();
    if (!marketAdmin)
      throw new HTTPException(503, { message: "Governance roles are not indexed yet" });
    if (owner !== marketAdmin)
      throw forbidden("Only the market admin manages invites and referrals.", "operator");
    return owner;
  };

  // ---------------------------------------------------------------- members

  app.get("/v1/me/invites", async (c) => {
    c.header("Cache-Control", "no-store");
    const { owner, member } = await auth.member(c, c.req.query("owner") ?? null);
    const codes = await db.inviteCodes(owner, { limit: 1000 });
    return c.json({
      member: memberView(member),
      quota: member.codeQuota,
      created: codes.length,
      remaining: Math.max(0, member.codeQuota - codes.length),
      codes: codes.map((code) => codeView(code)),
    });
  });
  app.post("/v1/me/invites", async (c) => {
    const { owner } = await auth.trader(c);
    creations.enforce(c, `invite:${owner}`);
    for (let attempt = 0; attempt < 5; attempt++)
      try {
        const code = await db.createMemberInvite(owner, generateInviteCode());
        return c.json({ code: formatInviteCode(code) });
      } catch (error) {
        if (error instanceof InviteError) throw new HTTPException(400, { message: error.message });
        if (!isUniqueViolation(error)) throw error;
      }
    throw new HTTPException(503, { message: "Could not create a code. Try again." });
  });

  app.get("/v1/me/referrals", async (c) => {
    c.header("Cache-Control", "no-store");
    const { owner } = await auth.member(c, c.req.query("owner") ?? null);
    return c.json(await referrals.dashboard(owner));
  });
  app.post("/v1/me/referrals/claim", async (c) => {
    const { owner } = await auth.trader(c);
    claims.enforce(c, `claim:${owner}`, "Claims are limited to a few per ten minutes.");
    return c.json(await referrals.claim(owner));
  });

  // ---------------------------------------------------------------- market admin

  app.get("/v1/admin/invites", async (c) => {
    await admin(c);
    c.header("Cache-Control", "no-store");
    const raw = c.req.query("owner");
    const codes = await db.inviteCodes(raw ? getAddress(raw) : null, {
      limit: Number(c.req.query("limit") ?? 200),
    });
    return c.json({ codes: codes.map((code) => codeView(code)) });
  });
  app.post("/v1/admin/invites", async (c) => {
    await admin(c);
    const body = await c.req.json();
    const count = Number(body.count ?? 1),
      maxUses = Number(body.maxUses ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 500)
      throw new HTTPException(400, { message: "Create 1 to 500 codes at a time." });
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100_000)
      throw new HTTPException(400, { message: "Each code admits 1 to 100,000 wallets." });
    const expiresAt =
      body.expiresAt === undefined || body.expiresAt === null ? null : new Date(body.expiresAt);
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()))
      throw new HTTPException(400, { message: "The expiry must be a future time." });
    const note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null;
    const codes = new Set<string>();
    while (codes.size < count) codes.add(generateInviteCode());
    for (let attempt = 0; ; attempt++)
      try {
        await db.createAdminInvites([...codes], { maxUses, expiresAt, note });
        break;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 4) throw error;
        codes.clear();
        while (codes.size < count) codes.add(generateInviteCode());
      }
    return c.json({ codes: [...codes].map(formatInviteCode) });
  });
  app.post("/v1/admin/invites/:code/revoke", async (c) => {
    await admin(c);
    const code = normalizeInviteCode(c.req.param("code"));
    if (!code) throw new HTTPException(400, { message: "That is not an invite code." });
    return c.json({ revoked: (await db.revokeInviteCode(code)) === 1 });
  });
  app.get("/v1/admin/members", async (c) => {
    await admin(c);
    c.header("Cache-Control", "no-store");
    const before = c.req.query("before");
    const members = await db.members({
      limit: Number(c.req.query("limit") ?? 200),
      ...(before ? { before: new Date(before) } : {}),
    });
    return c.json({
      members: members.map((m) => ({
        wallet: getAddress(m.wallet),
        code: formatInviteCode(m.code),
        codesCreated: m.codesCreated,
        ...memberView(m),
      })),
    });
  });
  app.post("/v1/admin/members/:wallet", async (c) => {
    await admin(c);
    const wallet = getAddress(c.req.param("wallet"));
    const body = await c.req.json();
    const codeQuota = body.codeQuota === undefined ? undefined : Number(body.codeQuota);
    if (
      codeQuota !== undefined &&
      (!Number.isInteger(codeQuota) || codeQuota < 0 || codeQuota > 10_000)
    )
      throw new HTTPException(400, { message: "The code quota is a whole number up to 10,000." });
    const suspended = typeof body.suspended === "boolean" ? body.suspended : undefined;
    const updated = await db.updateMember(wallet, {
      ...(codeQuota !== undefined ? { codeQuota } : {}),
      ...(suspended !== undefined ? { suspended } : {}),
    });
    auth.forgetMember(wallet);
    const member = updated ? await db.member(wallet) : null;
    if (!member) throw new HTTPException(404, { message: "Not a member." });
    return c.json({ member: memberView(member) });
  });
  app.get("/v1/admin/referrals", async (c) => {
    await admin(c);
    c.header("Cache-Control", "no-store");
    return c.json(await referrals.overview());
  });
}
