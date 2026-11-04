/** The risk engine on a synthetic replica: the plan's netting example (§18), theme stress with
 * legs moving together, utilization, and requesters' markouts and limits. */
import { describe, expect, test } from "bun:test";
import { outcomeMask } from "@conditional-stocks/evm-client";
import {
  type BookState,
  emptyWorldState,
  positionRisk,
  type VaultState,
  type WorldState,
} from "@conditional-stocks/evm-client/world-ledger";
import { simulateFill } from "@conditional-stocks/evm-client/world-risk";
import { type Address, getAddress, type Hex } from "viem";
import { DEFAULT_RISK } from "../src/config.ts";
import { type BookRisk, Requesters, RiskEngine } from "../src/risk.ts";

const VAULT = getAddress("0x00000000000000000000000000000000000000fa");
const MAYA = getAddress("0x0000000000000000000000000000000000000001");
const BEN = getAddress("0x0000000000000000000000000000000000000002");
const key = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const USDG = 1_000_000n;

function state(): { s: WorldState; v: VaultState } {
  const s = emptyWorldState({
    chainId: 1,
    books: "0x0000000000000000000000000000000000000B00",
    oracle: "0x0000000000000000000000000000000000000C00",
    quote: "0x0000000000000000000000000000000000000D00",
    vaults: [VAULT],
  });
  const v = s.vaults.get(VAULT)!;
  v.refNav = 1_000_000n * USDG;
  v.limits = {
    maxTtl: 300,
    cutoffBuffer: 3_600,
    maxTenor: 60 * 86_400,
    maxLegs: 6,
    maxFeeBps: 200,
    marginBps: 10,
    eventOnly: true,
  };
  v.risk = {
    maxQuoteSize: 100_000n * USDG,
    maxQuotePrice: 100_000n * USDG,
    maxBookRisk: 200_000n * USDG,
    maxLegRisk: 300_000n * USDG,
    maxLossBps: 5_000,
    maxDailyExposureBps: 1_000,
  };
  s.credits.set(VAULT, 1_000_000n * USDG);
  s.credits.set(MAYA, 10_000n * USDG);
  s.credits.set(BEN, 10_000n * USDG);
  return { s, v };
}
function book(s: WorldState, id: number, legs: number[], strikes = 5): BookState {
  const b: BookState = {
    id,
    defHash: key(1000 + id),
    def: {
      legs: legs.map((l) => ({ eventKey: key(l), wantYes: true })),
      feed: strikes
        ? "0x0000000000000000000000000000000000000E00"
        : "0x0000000000000000000000000000000000000000",
      underlying: key(0),
      fixingTime: 2_000_000_000,
      maxStaleness: 3_600,
      strikes: Array.from({ length: strikes }, (_, i) => BigInt(220 + 10 * i)),
      cutoff: 1_999_990_000,
      feeBps: 100,
      metadataHash: key(0),
    },
    metadataUri: "x",
    atoms: strikes ? strikes + 2 : 2,
    status: 1,
    winner: 0,
    frozen: false,
    held: false,
    backing: 0n,
    fix: null,
    fixCommitment: null,
    fixEvidence: null,
    fixUri: null,
    fixedPrice: null,
    fills: 0,
    volume: 0n,
    fees: 0n,
    createdBlock: 0n,
    createdAt: 0n,
    createdTx: "0x",
    decidedAt: null,
  };
  s.books.set(id, b);
  return b;
}
/** Applies a vault fill to the synthetic state (the books' delivery, the vault's sync). */
function apply(
  s: WorldState,
  v: VaultState,
  b: BookState,
  taker: Address,
  mask: number,
  units: bigint,
  price: bigint,
) {
  const e = simulateFill(s, b, VAULT, { taker, mask, units, refund: 0n, sell: false, price });
  if ("problem" in e) throw new Error(e.problem);
  const before = v.positions.get(b.id) ?? { lo: 0n, hi: 0n, cost: 0n };
  const cost = before.cost + (s.credits.get(VAULT)! - e.makerCredit);
  s.credits.set(VAULT, e.makerCredit);
  s.credits.set(taker, e.takerCredit);
  s.holdings.set(`${b.id}:${VAULT}`, e.makerAtoms);
  s.holdings.set(`${b.id}:${taker}`, e.takerAtoms);
  const lo = e.makerAtoms.reduce((a, x) => (x < a ? x : a));
  const hi = e.makerAtoms.reduce((a, x) => (x > a ? x : a));
  v.positions.set(b.id, { lo, hi, cost });
  v.sumLo += lo - before.lo;
  v.sumHi += hi - before.hi;
  return positionRisk({ cost, lo });
}
const risk = (b: BookState, themes: string[][] = [["ai"], ["ai"], ["us-china"]]): BookRisk => ({
  book: b,
  model: null,
  legs: b.def.legs.map((l, i) => ({
    key: l.eventKey,
    wantYes: l.wantYes,
    themes: themes[i] ?? [],
  })),
});

describe("netting", () => {
  test("Maya and Ben lock $2,920 together, against $4,458 order by order", () => {
    const { s, v } = state();
    const b = book(s, 1, [1, 2, 3]);
    // Maya: 1,538 units above $240 (atoms 4-6) for $20; Ben: 3,000 units below (atoms 1-3) for $60.
    const maya = apply(
      s,
      v,
      b,
      MAYA,
      outcomeMask({ kind: "above", strike: 3 }, 7),
      1_538n * USDG,
      20n * USDG,
    );
    expect(maya).toBe(1_518n * USDG);
    const both = apply(
      s,
      v,
      b,
      BEN,
      outcomeMask({ kind: "below", strike: 3 }, 7),
      3_000n * USDG,
      60n * USDG,
    );
    expect(both).toBe(2_920n * USDG);
    // Alone, Ben's order would lock $2,940: $4,458 for the two.
    const alone = state();
    const ben = apply(
      alone.s,
      alone.v,
      book(alone.s, 1, [1, 2, 3]),
      BEN,
      outcomeMask({ kind: "below", strike: 3 }, 7),
      3_000n * USDG,
      60n * USDG,
    );
    expect(maya + ben).toBe(4_458n * USDG);
  });
});

describe("the risk engine", () => {
  test("quotes in flight count as filled until they expire or are lost", () => {
    const { s, v } = state();
    const b = book(s, 1, [1, 2, 3]);
    const engine = new RiskEngine(VAULT, { ...DEFAULT_RISK, perBook: 0.003 }, () => 0);
    const books = new Map([[1, risk(b)]]);
    const q = {
      taker: MAYA,
      mask: outcomeMask({ kind: "above", strike: 3 }, 7),
      units: 2_000n * USDG,
      refund: 0n,
      sell: false,
      price: 30n * USDG,
    };
    const first = engine.assess(s, v, risk(b), q, v.refNav, books);
    if ("problem" in first) throw new Error(first.problem);
    expect(first.riskAfter - first.riskBefore).toBe(1_970n * USDG);
    engine.hold({
      id: "a",
      book: 1,
      requester: MAYA,
      atoms: first.atoms,
      cost: first.cost,
      exposure: first.exposure,
      capital: first.riskAfter - first.riskBefore,
      expiresAtMs: Date.now() + 10_000,
    });
    // $3,000 per book: a second $1,970 does not fit while the first is outstanding.
    const second = engine.assess(s, v, risk(b), q, v.refNav, books);
    expect(second).toEqual({ problem: "Over the per-book limit" });
    expect(engine.utilization(s, v, v.refNav)).toBeCloseTo(0.00197, 6);
    engine.release("a");
    expect("problem" in engine.assess(s, v, risk(b), q, v.refNav, books)).toBe(false);
    engine.hold({
      id: "b",
      book: 1,
      requester: MAYA,
      atoms: first.atoms,
      cost: first.cost,
      exposure: first.exposure,
      capital: 1n,
      expiresAtMs: Date.now() - 1,
    });
    expect(engine.expire()).toBe(0);
  });

  test("the day's exposure budget counts quotes in flight", () => {
    const { s, v } = state();
    v.risk!.maxDailyExposureBps = 1; // $100 a day
    const b = book(s, 1, [1, 2, 3]);
    const engine = new RiskEngine(VAULT, DEFAULT_RISK, () => 0);
    const books = new Map([[1, risk(b)]]);
    const q = {
      taker: MAYA,
      mask: outcomeMask({ kind: "above", strike: 3 }, 7),
      units: 70n * USDG,
      refund: 0n,
      sell: false,
      price: 10n * USDG,
    };
    const a = engine.assess(s, v, risk(b), q, v.refNav, books);
    if ("problem" in a) throw new Error(a.problem);
    expect(a.exposure).toBe(60n * USDG);
    engine.hold({
      id: "a",
      book: 1,
      requester: MAYA,
      atoms: a.atoms,
      cost: a.cost,
      exposure: a.exposure,
      capital: 0n,
      expiresAtMs: Date.now() + 10_000,
    });
    expect(engine.assess(s, v, risk(b), q, v.refNav, books)).toEqual({
      problem: "Over the day's exposure budget",
    });
  });

  test("theme stress moves a theme's legs together, other legs at their worst", () => {
    const { s, v } = state();
    // Two event-only books on the AI theme, the vault short each world: comonotone, both lose.
    const b1 = book(s, 1, [1], 0),
      b2 = book(s, 2, [2], 0);
    apply(s, v, b1, MAYA, 0b10, 1_000n * USDG, 300n * USDG);
    apply(s, v, b2, BEN, 0b10, 1_000n * USDG, 400n * USDG);
    const books = new Map<number, BookRisk>([
      [1, { ...risk(b1, [["ai"]]), model: { legInfo: [{ q: 0.3 }] } as never }],
      [2, { ...risk(b2, [["ai"]]), model: { legInfo: [{ q: 0.4 }] } as never }],
    ]);
    const engine = new RiskEngine(VAULT, DEFAULT_RISK, () => 0);
    // Both happen in the worst scenario: $700 + $600.
    expect(engine.themeStress(s, v, books).worst).toBe(1_300 * 1e6);
    // A book needing the other side of one event offsets it: comonotone, they cannot both pay.
    const b3 = book(s, 3, [1], 0);
    b3.def.legs[0]!.wantYes = false;
    apply(s, v, b3, BEN, 0b10, 1_000n * USDG, 700n * USDG);
    books.set(3, { ...risk(b3, [["ai"]]), model: { legInfo: [{ q: 0.7 }] } as never });
    expect(engine.themeStress(s, v, books).worst).toBeLessThan(1_300 * 1e6 + 300 * 1e6);
  });
});

describe("requesters", () => {
  test("markouts against the vault's fair value set a requester's stake factor", () => {
    const r = new Requesters();
    const t0 = Date.now() - 7_200_000;
    // A sharp requester: every fill is worth more an hour later.
    for (let i = 0; i < 40; i++)
      r.record(MAYA, {
        at: t0 + i,
        book: 1,
        mask: 2,
        units: 100,
        refund: 0,
        capital: 50,
        fair: 0.3,
        buy: true,
      });
    for (let i = 0; i < 40; i++)
      r.record(BEN, {
        at: t0 + i,
        book: 2,
        mask: 2,
        units: 100,
        refund: 0,
        capital: 50,
        fair: 0.3,
        buy: true,
      });
    r.markout(Date.now(), (f) => (f.book === 1 ? 0.45 : 0.3));
    expect(r.excess(MAYA)).toBeGreaterThan(0.2);
    expect(r.excess(BEN)).toBeLessThan(0);
    expect(r.stakeFactor(MAYA)).toBe(0.05);
    expect(r.stakeFactor(BEN)).toBe(1);
    expect(r.exposure(MAYA, Date.now(), () => true)).toEqual({ outstanding: 2_000, daily: 2_000 });
    const copy = new Requesters();
    copy.restore(r.snapshot());
    expect(copy.excess(MAYA)).toBe(r.excess(MAYA));
  });
});
