/** Invites, members, referral accrual and the payout journal against a disposable PostgreSQL. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  createDatabase,
  type Database,
  InviteError,
  type TradeRecord,
} from "@conditional-stocks/db";
import { localDatabase } from "@conditional-stocks/db/local";
import { Pool } from "@conditional-stocks/db/testing";
import { getAddress } from "viem";

const domain = "31337:0x00000000000000000000000000000000000000E1";
const wallet = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const [alice, bob, carol, dave, erin, frank] = [0xa1, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0].map(wallet) as [
  string,
  string,
  string,
  string,
  string,
  string,
];
let pg: Awaited<ReturnType<typeof localDatabase>>;
let db: Database;

beforeAll(async () => {
  pg = await localDatabase();
  db = createDatabase({ connectionString: pg.connectionString });
  await db.initialize();
  await db.registerDeployment(domain);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await pg?.close();
});

const refusal = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof InviteError) return error.message;
    throw error;
  }
  throw new Error("Expected an invite refusal");
};

test("an admin code admits one wallet, whose referrer is nobody; used, own and revoked codes are refused", async () => {
  await db.createAdminInvites(["GENESIS1", "GENESIS2", "GENESIS3"], {
    maxUses: 1,
    expiresAt: null,
    note: "launch",
  });
  const member = await db.redeemInvite(alice, "GENESIS1", 5);
  expect(member).toMatchObject({
    wallet: alice.toLowerCase(),
    code: "GENESIS1",
    referrer: null,
    codeQuota: 5,
    suspendedAt: null,
  });
  expect(await refusal(db.redeemInvite(bob, "GENESIS1", 5))).toContain("used up");
  expect(await refusal(db.redeemInvite(alice, "GENESIS2", 5))).toContain("already a member");
  expect(await db.revokeInviteCode("GENESIS3")).toBe(1);
  expect(await refusal(db.redeemInvite(bob, "GENESIS3", 5))).toContain("invalid");
  expect(await refusal(db.redeemInvite(bob, "NOSUCHCD", 5))).toContain("invalid");
  // Members create single-use codes within their quota; their codes make them referrers.
  const code = await db.createMemberInvite(alice, "ALICE001");
  expect(await refusal(db.redeemInvite(alice, code, 5))).toContain("already a member");
  const bobMember = await db.redeemInvite(bob, code, 5);
  expect(bobMember.referrer).toBe(alice.toLowerCase());
  const [listed] = await db.inviteCodes(alice);
  expect(listed).toMatchObject({ code: "ALICE001", uses: 1, maxUses: 1 });
  expect(listed!.members.map((m) => m.wallet)).toEqual([bob.toLowerCase()]);
  const [referee] = await db.referees(alice, 6);
  expect(referee!.wallet).toBe(bob.toLowerCase());
  const until = new Date(referee!.joinedAt);
  until.setUTCMonth(until.getUTCMonth() + 6);
  expect(referee!.earningUntil.getTime()).toBe(until.getTime());
});

test("a wallet cannot join with its own code, and quotas and suspensions bound code creation", async () => {
  await db.createAdminInvites(["GENESIS4"], { maxUses: 1, expiresAt: null, note: null });
  await db.redeemInvite(carol, "GENESIS4", 2);
  await db.createMemberInvite(carol, "CAROL001");
  await db.createMemberInvite(carol, "CAROL002");
  expect(await refusal(db.createMemberInvite(carol, "CAROL003"))).toContain("all the invite codes");
  expect(await refusal(db.createMemberInvite(dave, "DAVE0001"))).toContain("Join with an invite");
  expect(await db.inviteRefusal("CAROL001", carol)).toContain("your own");
  expect(await refusal(db.redeemInvite(carol, "CAROL001", 2))).toContain("already a member");
  // Suspension revokes unused codes and stops further ones.
  expect(await db.updateMember(carol, { suspended: true, codeQuota: 9 })).toBe(1);
  expect(await refusal(db.redeemInvite(dave, "CAROL001", 2))).toContain("invalid");
  expect(await refusal(db.createMemberInvite(carol, "CAROL004"))).toContain("suspended");
  expect((await db.member(carol))!.codeQuota).toBe(9);
  await db.updateMember(carol, { suspended: false });
  expect((await db.member(carol))!.suspendedAt).toBeNull();
});

test("concurrent redemptions of one code admit exactly one wallet; one wallet's race uses one code", async () => {
  await db.createAdminInvites(["RACE0001", "RACE0002", "RACE0003"], {
    maxUses: 1,
    expiresAt: null,
    note: null,
  });
  const contenders = [0x101, 0x102, 0x103, 0x104].map(wallet);
  const results = await Promise.allSettled(
    contenders.map((w) => db.redeemInvite(w, "RACE0001", 5)),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const racer = wallet(0x105);
  const own = await Promise.allSettled([
    db.redeemInvite(racer, "RACE0002", 5),
    db.redeemInvite(racer, "RACE0003", 5),
  ]);
  expect(own.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const codes = await db.inviteCodes(null, { limit: 1000 });
  const uses = Object.fromEntries(codes.map((c) => [c.code, c.uses]));
  expect(uses.RACE0002! + uses.RACE0003!).toBe(1);
  // A multi-use campaign code admits up to its limit.
  await db.createAdminInvites(["CAMPAIGN"], { maxUses: 2, expiresAt: null, note: "partner" });
  await db.redeemInvite(wallet(0x106), "CAMPAIGN", 5);
  await db.redeemInvite(wallet(0x107), "CAMPAIGN", 5);
  expect(await refusal(db.redeemInvite(wallet(0x108), "CAMPAIGN", 5))).toContain("used up");
  // An expired code is refused.
  await db.createAdminInvites(["EXPIRED1"], {
    maxUses: 1,
    expiresAt: new Date(Date.now() - 1000),
    note: null,
  });
  expect(await refusal(db.redeemInvite(wallet(0x109), "EXPIRED1", 5))).toContain("expired");
});

test("referral accrual: each side's net fee, within six months of joining, rounded down, once", async () => {
  // dave joins through erin's code; frank joins through dave's.
  await db.createAdminInvites(["GENESIS5"], { maxUses: 1, expiresAt: null, note: null });
  await db.redeemInvite(erin, "GENESIS5", 5);
  await db.createMemberInvite(erin, "ERIN0001");
  await db.redeemInvite(dave, "ERIN0001", 5);
  await db.createMemberInvite(dave, "DAVE0001");
  await db.redeemInvite(frank, "DAVE0001", 5);
  const joined = Math.floor(Date.now() / 1000);
  const day = 86_400;
  let block = 100n;
  const trade = (t: Partial<TradeRecord> & { maker: string; taker: string }): TradeRecord => ({
    block: block++,
    logIndex: 0,
    blockTime: BigInt(joined + day),
    tx: `0x${"ab".repeat(32)}`,
    market: 7,
    branch: 0,
    takerSide: 0,
    makerSeq: 1n,
    takerSeq: 2n,
    quantity: 10n ** 18n,
    price: 2n * 10n ** 8n,
    quote: 200_000_000n,
    buyerFee: 3_000_000_000_000_000n,
    sellerFee: 200_000n,
    makerRebate: 1_500_000_000_000_000n,
    ...t,
    maker: t.maker.toLowerCase(),
    taker: t.taker.toLowerCase(),
  });
  const trades = [
    // dave takes (buys) from frank: dave's taker fee in stock claims less the maker rebate,
    // frank's maker fee in quote claims.
    trade({ maker: frank, taker: dave }),
    // dave makes against a stranger (taker sells): dave's maker fee is the buyer fee in stock
    // claims; the stranger has no referrer.
    trade({
      maker: dave,
      taker: alice,
      takerSide: 1,
      buyerFee: 1_000_000_000_000_001n,
      sellerFee: 7n,
      makerRebate: 3n,
    }),
    // A self-trade earns nothing.
    trade({ maker: dave, taker: dave }),
    // Outside the window: before joining, and after six months.
    trade({ maker: frank, taker: dave, blockTime: BigInt(joined - day) }),
    trade({ maker: frank, taker: dave, blockTime: BigInt(joined + 200 * day) }),
    // A fee too small to share rounds to nothing.
    trade({ maker: alice, taker: dave, buyerFee: 6n, makerRebate: 0n, sellerFee: 0n }),
  ];
  await db.persistFinalized(domain, { trades, orders: [] });
  const first = await db.accrueReferrals(domain, { rateBps: 1_500, months: 6, limit: 4 });
  expect(first.trades).toBe(4);
  const second = await db.accrueReferrals(domain, { rateBps: 1_500, months: 6, limit: 4 });
  expect(second.trades).toBe(2);
  expect((await db.accrueReferrals(domain, { rateBps: 1_500, months: 6 })).trades).toBe(0);

  // erin earns from dave: 15% of (3e15 - 1.5e15) stock-if-YES as taker, 15% of 1e15+1 as maker.
  const erinTotals = await db.referralTotals(domain, erin);
  expect(erinTotals).toEqual([
    {
      market: 7,
      branch: 0,
      collateral: 1,
      amount:
        (1_500_000_000_000_000n * 1_500n) / 10_000n + (1_000_000_000_000_001n * 1_500n) / 10_000n,
      fee: 1_500_000_000_000_000n + 1_000_000_000_000_001n,
      fills: 2,
    },
  ]);
  // dave earns from frank's maker fee: 15% of 200,000 quote-if-YES.
  expect(await db.referralTotals(domain, dave)).toEqual([
    { market: 7, branch: 0, collateral: 0, amount: 30_000n, fee: 200_000n, fills: 1 },
  ]);
  expect((await db.refereeTotals(domain, erin)).map((t) => t.referee)).toEqual([
    dave.toLowerCase(),
  ]);
  // A suspended referrer stops accruing from then on.
  await db.updateMember(erin, { suspended: true });
  await db.persistFinalized(domain, { trades: [trade({ maker: frank, taker: dave })], orders: [] });
  await db.accrueReferrals(domain, { rateBps: 1_500, months: 6 });
  expect((await db.referralTotals(domain, erin))[0]!.fills).toBe(2);
  expect((await db.referralTotals(domain, dave))[0]!.fills).toBe(2);
  await db.updateMember(erin, { suspended: false });
});

test("the payout journal counts sent and paid amounts, settles once and frees failed ones", async () => {
  const token = `0x${"01".repeat(20)}`;
  const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
  const first = await db.recordReferralPayout(domain, {
    referrer: erin,
    token,
    amount: 100n,
    tx: tx(1),
    raw: "0x01",
  });
  await db.recordReferralPayout(domain, {
    referrer: erin,
    token,
    amount: 50n,
    tx: tx(2),
    raw: "0x02",
  });
  expect(await db.referralPaidTotals(domain, erin)).toEqual([{ token, amount: 150n }]);
  expect((await db.sentReferralPayouts(domain)).map((p) => p.id)).toContain(first);
  expect(await db.settleReferralPayout(first, 1)).toBe(1);
  expect(await db.settleReferralPayout(first, 2)).toBe(0);
  const second = (await db.sentReferralPayouts(domain))[0]!;
  expect(await db.settleReferralPayout(second.id, 2)).toBe(1);
  expect(await db.referralPaidTotals(domain, erin)).toEqual([{ token, amount: 100n }]);
  expect(await db.referralPaidTotals(domain)).toEqual([{ token, amount: 100n }]);
  const history = await db.referralPayouts(domain, erin);
  expect(history.map((p) => [p.amount, p.status])).toEqual([
    [50n, 2],
    [100n, 1],
  ]);
});

test("serialized work runs one at a time, and each statement commits at once", async () => {
  const token = `0x${"02".repeat(20)}`;
  let inside = 0,
    overlapped = false,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = db.serialized("serialized-test", async (q) => {
    inside++;
    const id = await q.recordReferralPayout(domain, {
      referrer: frank,
      token,
      amount: 7n,
      tx: `0x${"ee".repeat(32)}`,
      raw: "0x03",
    });
    // Durable before the work ends: another connection already sees it.
    expect((await db.sentReferralPayouts(domain)).some((p) => p.id === id)).toBe(true);
    await held;
    inside--;
  });
  const second = db.serialized("serialized-test", async () => {
    if (inside) overlapped = true;
  });
  await Bun.sleep(100);
  release();
  await Promise.all([first, second]);
  expect(overlapped).toBe(false);
  // A failed work still releases the lock.
  await expect(
    db.serialized("serialized-test", async () => {
      throw new Error("work failed");
    }),
  ).rejects.toThrow("work failed");
  expect(await db.serialized("serialized-test", async () => "free")).toBe("free");
});

test("sessions last 30 days and renew while used, at most daily and up to 90 days after sign-in", async () => {
  const pool = new Pool({ connectionString: pg.connectionString });
  try {
    const sign = async (n: number) => {
      const hash = n.toString(16).padStart(64, "0");
      await db.createChallenge(domain, alice, `c${n}`, "message");
      const expiresAtMs = await db.consumeChallenge(domain, alice, `c${n}`, hash, 30);
      return { hash, expiresAtMs };
    };
    const age = (hash: string, signedInDaysAgo: number, expiresInDays: number) =>
      pool.query(
        `UPDATE probabl.sessions SET created_at = now() - make_interval(days => $2::int),
          expires_at = now() + make_interval(days => $3::int) WHERE token_hash = $1`,
        [hash, signedInDaysAgo, expiresInDays],
      );
    const days = (ms: number | undefined) =>
      ms === undefined ? undefined : Math.round((ms - Date.now()) / 86_400_000);
    const fresh = await sign(1);
    expect(days(fresh.expiresAtMs)).toBe(30);
    expect((await db.session(domain, fresh.hash))?.createdAtMs).toBeGreaterThan(
      Date.now() - 60_000,
    );
    // Not renewed until that adds a day: one write a day at most.
    expect(await db.renewSession(domain, fresh.hash, 30, 90)).toBeUndefined();
    const used = await sign(2);
    await age(used.hash, 3, 27);
    expect(days(await db.renewSession(domain, used.hash, 30, 90))).toBe(30);
    expect(days((await db.session(domain, used.hash))?.expiresAtMs)).toBe(30);
    // Renewals never reach past 90 days after sign-in.
    const old = await sign(3);
    await age(old.hash, 85, 2);
    expect(days(await db.renewSession(domain, old.hash, 30, 90))).toBe(5);
    await age(old.hash, 89, 1);
    expect(await db.renewSession(domain, old.hash, 30, 90)).toBeUndefined();
    // An ended session stays ended.
    await age(old.hash, 10, -1);
    expect(await db.renewSession(domain, old.hash, 30, 90)).toBeUndefined();
    expect(await db.session(domain, old.hash)).toBeUndefined();
  } finally {
    await pool.end();
  }
});
