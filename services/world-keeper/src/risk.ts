/** The vault's risk, in memory (research spec §1.7; docs/version-2-plan.md §8).
 *
 * The vault's state is the chain replica plus every quote it signed that may still fill: an
 * outstanding quote counts as filled until it expires or is reported lost, so concurrent
 * requests never overcommit a cap. A candidate fill is simulated exactly as `WorldBooks` would
 * deliver it (`simulateFill`); its atom and cost changes add to the in-flight ones (a book's
 * risk, cost − lowest atom, does not change when full sets merge, so the sum is exact).
 *
 * Hard limits mirror the vault's `onWorldFill` (book and leg risk, the day's exposure, the loss
 * floor), on the state after every outstanding quote. Soft limits are the keeper's: capital per
 * fill, per book (at most quarter Kelly), per leg, per theme with its legs comonotone,
 * utilization, and per requester. The charges' inputs come from here too: the capital a fill
 * locks or frees, the utilization it starts from, and the variance and covariance its payout
 * adds to the vault's terminal value. */

import { payRange, type WorldQuote } from "@conditional-stocks/evm-client";
import {
  atomsOf,
  type BookState,
  positionRisk,
  type VaultState,
  type WorldState,
  worldCreditOf,
} from "@conditional-stocks/evm-client/world-ledger";
import { type FillEffect, simulateFill } from "@conditional-stocks/evm-client/world-risk";
import type { Address, Hex } from "viem";
import type { RiskPolicy } from "./config.ts";
import type { BookModel } from "./model/book.ts";

/** A quote the vault signed that may still fill. */
export interface Outstanding {
  id: string;
  book: number;
  requester: Address;
  /** The vault's atoms and cost after minus before. */
  atoms: bigint[];
  cost: bigint;
  /** What the fill spends of the day's exposure budget. */
  exposure: bigint;
  /** Its capital: the book's risk after minus before. */
  capital: bigint;
  expiresAtMs: number;
}
/** What the risk engine knows of a book beyond the replica. */
export interface BookRisk {
  book: BookState;
  model: BookModel | null;
  /** Each leg's event key and themes (from its metadata). */
  legs: { key: Hex; wantYes: boolean; themes: string[] }[];
}
export interface Assessment {
  effect: FillEffect;
  /** Effective (in-flight included) risk of the book before and after. */
  riskBefore: bigint;
  riskAfter: bigint;
  exposure: bigint;
  atoms: bigint[];
  cost: bigint;
  utilization: number;
  /** Var and Cov (raw², numbers) of the vault's terminal value change. */
  variance: number;
  covariance: number;
}

const num = (v: bigint) => Number(v);
const minOf = (values: readonly bigint[]) =>
  values.reduce((a, b) => (b < a ? b : a), values[0] ?? 0n);

export class RiskEngine {
  readonly outstanding = new Map<string, Outstanding>();
  /** P(W_a ∧ W_b) of pairs of books, keyed by their models (cleared when a model changes). */
  private readonly joint = new Map<string, number>();

  constructor(
    readonly vault: Address,
    readonly policy: RiskPolicy,
    /** P(every leg of both books goes their worlds' way): the engine's union model. */
    private readonly unionWorld: (a: BookRisk, b: BookRisk) => number,
  ) {}

  /** Drops expired quotes; returns how many remain. */
  expire(nowMs = Date.now()) {
    for (const [id, q] of this.outstanding) if (q.expiresAtMs <= nowMs) this.outstanding.delete(id);
    return this.outstanding.size;
  }
  hold(q: Outstanding) {
    this.outstanding.set(q.id, q);
  }
  release(id: string) {
    this.outstanding.delete(id);
  }
  /** A model changed: forget the pair probabilities that used it. */
  forget(book: number) {
    for (const key of this.joint.keys())
      if (key.split(":").includes(String(book))) this.joint.delete(key);
  }

  /** The vault's atoms and cost in a book, with every outstanding quote filled. */
  effective(s: WorldState, v: VaultState, book: BookState) {
    const atoms = [...atomsOf(s, book.id, v.address)];
    let cost = v.positions.get(book.id)?.cost ?? 0n;
    for (const q of this.outstanding.values())
      if (q.book === book.id) {
        for (let a = 0; a < atoms.length; a++) atoms[a]! += q.atoms[a] ?? 0n;
        cost += q.cost;
      }
    return { atoms, cost };
  }
  /** The effective risk of a book: what the vault can lose in it. */
  bookRisk(s: WorldState, v: VaultState, book: BookState) {
    const { atoms, cost } = this.effective(s, v, book);
    return positionRisk({ cost, lo: minOf(atoms) });
  }
  /** Capital locked over NAV, outstanding quotes included. */
  utilization(s: WorldState, v: VaultState, nav: bigint) {
    if (nav <= 0n) return 1;
    let locked = 0n;
    const books = new Set<number>([
      ...v.positions.keys(),
      ...[...this.outstanding.values()].map((q) => q.book),
    ]);
    for (const id of books) {
      const b = s.books.get(id);
      if (b && b.status === 1) locked += this.bookRisk(s, v, b);
    }
    return num(locked) / num(nav);
  }

  /** What a vault fill of `q` does, and the first limit it breaks (null when none). */
  assess(
    s: WorldState,
    v: VaultState,
    ctx: BookRisk,
    q: Pick<WorldQuote, "taker" | "mask" | "units" | "refund" | "sell" | "price">,
    nav: bigint,
    books: ReadonlyMap<number, BookRisk>,
    nowMs = Date.now(),
  ): { problem: string } | Assessment {
    const b = ctx.book;
    // The API checks the taker's side; the keeper prices its own.
    const effect = simulateFill(s, b, v.address, q, { taker: false });
    if ("problem" in effect) return { problem: effect.problem };
    const chainAtoms = atomsOf(s, b.id, v.address);
    const atoms = effect.makerAtoms.map((x, a) => x - (chainAtoms[a] ?? 0n));
    const cost = worldCreditOf(s, v.address) - effect.makerCredit;
    const before = this.effective(s, v, b);
    const afterAtoms = before.atoms.map((x, a) => x + atoms[a]!);
    const riskBefore = positionRisk({ cost: before.cost, lo: minOf(before.atoms) });
    const riskAfter = positionRisk({ cost: before.cost + cost, lo: minOf(afterAtoms) });
    const { minPay, maxPay } = payRange(q, b.atoms);
    const exposure = q.sell ? q.price - minPay : maxPay - q.price;
    const k = v.risk;
    if (!k) return { problem: "The vault has no risk limits" };
    // ---- the vault's own caps, on the state after every outstanding quote
    const grows = riskAfter > riskBefore;
    if (grows && riskAfter > k.maxBookRisk) return { problem: "Over the vault's book risk cap" };
    let pendingExposure = 0n;
    for (const o of this.outstanding.values()) pendingExposure += o.exposure;
    const today = BigInt(Math.floor(nowMs / 86_400_000));
    const used = (v.day.day === today ? v.day.used : 0n) + pendingExposure + exposure;
    if (used > (v.refNav * BigInt(k.maxDailyExposureBps)) / 10_000n)
      return { problem: "Over the day's exposure budget" };
    // Leg risk: the chain's, plus every outstanding quote's and this fill's change.
    const delta = riskAfter - riskBefore;
    for (const leg of ctx.legs) {
      let r = v.legRisk.get(leg.key) ?? 0n;
      for (const o of this.outstanding.values()) {
        const other = books.get(o.book);
        if (other?.legs.some((l) => l.key === leg.key)) r += o.capital;
      }
      if (grows && r + delta > k.maxLegRisk) return { problem: "Over the vault's leg risk cap" };
      if (grows && num(r + delta) > this.policy.perLeg * num(nav))
        return { problem: "Over the keeper's leg limit" };
    }
    // The loss floor, on the guaranteed value after every outstanding quote.
    let pendingCredit = 0n,
      pendingLo = 0n;
    for (const o of this.outstanding.values()) {
      pendingCredit -= o.cost;
      const other = books.get(o.book);
      if (other) {
        const e = this.effective(s, v, other.book);
        const without = e.atoms.map((x, a) => x - (o.atoms[a] ?? 0n));
        pendingLo += minOf(e.atoms) - minOf(without);
      }
    }
    const guaranteedBefore = worldCreditOf(s, v.address) + v.sumLo + pendingCredit + pendingLo;
    const guaranteedAfter = guaranteedBefore - cost + minOf(afterAtoms) - minOf(before.atoms);
    const floor = v.refNav - (v.refNav * BigInt(k.maxLossBps)) / 10_000n;
    if (guaranteedAfter < guaranteedBefore && guaranteedAfter < floor)
      return { problem: "Under the vault's loss floor" };
    // ---- the keeper's soft limits
    const navNumber = num(nav);
    const utilization = this.utilization(s, v, nav);
    if (grows) {
      if (num(delta) > this.policy.perFill * navNumber)
        return { problem: "Over the per-fill limit" };
      if (num(riskAfter) > this.policy.perBook * navNumber)
        return { problem: "Over the per-book limit" };
      if (utilization + num(delta) / navNumber > this.policy.maxUtilization)
        return { problem: "The vault's capital is fully used" };
      const theme = this.themeStress(s, v, books, { book: b.id, atoms, cost });
      if (theme.worst > this.policy.perTheme * navNumber)
        return { problem: `Over the theme limit (${theme.theme})` };
    }
    // ---- inventory: variance of the change and its covariance with the vault's position
    let variance = 0,
      covariance = 0;
    const model = ctx.model;
    if (model) {
      const p = model.center;
      let meanDelta = 0,
        meanHeld = 0,
        meanCross = 0,
        meanSquare = 0;
      for (let a = 0; a < model.atoms; a++) {
        const d = num(atoms[a]!),
          h = num(before.atoms[a]!);
        meanDelta += p[a]! * d;
        meanHeld += p[a]! * h;
        meanCross += p[a]! * h * d;
        meanSquare += p[a]! * d * d;
      }
      variance = meanSquare - meanDelta * meanDelta;
      covariance = meanCross - meanHeld * meanDelta;
      // Other books on shared legs or themes, through their worlds' indicators.
      const w0 = model.center.slice(1).reduce((a, x) => a + x, 0);
      const deltaW = w0 > 0 ? (meanDelta - p[0]! * num(atoms[0]!)) / w0 - num(atoms[0]!) : 0;
      for (const other of books.values()) {
        if (other.book.id === b.id || !other.model || other.book.status !== 1) continue;
        if (!related(ctx, other)) continue;
        const held = this.effective(s, v, other.book).atoms;
        if (held.every((x) => x === 0n)) continue;
        const po = other.model.center;
        const wo = po.slice(1).reduce((a, x) => a + x, 0);
        if (wo <= 0 || w0 <= 0) continue;
        let inWorld = 0;
        for (let a = 1; a < other.model.atoms; a++) inWorld += po[a]! * num(held[a]!);
        const heldW = inWorld / wo - num(held[0]!);
        const key = b.id < other.book.id ? `${b.id}:${other.book.id}` : `${other.book.id}:${b.id}`;
        let both = this.joint.get(key);
        if (both === undefined) {
          both = this.unionWorld(ctx, other);
          this.joint.set(key, both);
        }
        covariance += heldW * deltaW * (both - w0 * wo);
      }
    }
    return {
      effect,
      riskBefore,
      riskAfter,
      exposure,
      atoms,
      cost,
      utilization,
      variance,
      covariance,
    };
  }

  /** The worst loss over every theme when its legs move together (ρ = 1), with a candidate
   * change: for each theme, the scenarios of a single uniform driving all its legs, each book
   * losing its worst case given the theme legs' outcomes (other legs free). */
  themeStress(
    s: WorldState,
    v: VaultState,
    books: ReadonlyMap<number, BookRisk>,
    candidate?: { book: number; atoms: bigint[]; cost: bigint },
  ) {
    const themes = new Set<string>();
    for (const b of books.values()) for (const l of b.legs) for (const t of l.themes) themes.add(t);
    let worst = 0,
      worstTheme = "";
    for (const theme of themes) {
      const members = [...books.values()].filter(
        (b) => b.book.status === 1 && b.legs.some((l) => l.themes.includes(theme)),
      );
      // The theme's events and their YES chances (from any member's model).
      const events = new Map<Hex, number>();
      for (const b of members)
        b.legs.forEach((l, i) => {
          if (!l.themes.includes(theme)) return;
          const q = b.model?.legInfo[i]?.q;
          if (q !== undefined) events.set(l.key, l.wantYes ? q : 1 - q);
        });
      const thresholds = [0, ...[...events.values()].sort((a, b) => a - b), 1];
      for (let t = 0; t + 1 < thresholds.length; t++) {
        const u = (thresholds[t]! + thresholds[t + 1]!) / 2;
        let loss = 0;
        for (const b of members) {
          const e = this.effective(s, v, b.book);
          if (candidate?.book === b.book.id) {
            for (let a = 0; a < e.atoms.length; a++) e.atoms[a]! += candidate.atoms[a] ?? 0n;
            e.cost += candidate.cost;
          }
          // Each theme leg: YES iff u < its YES chance; the book's world needs each its way.
          let failed = false;
          let free = false;
          for (const l of b.legs) {
            if (!l.themes.includes(theme)) {
              free = true;
              continue;
            }
            const yes = events.get(l.key);
            if (yes === undefined) continue;
            if (u < yes !== l.wantYes) failed = true;
          }
          const atoms = failed ? [e.atoms[0]!] : free ? e.atoms : e.atoms.slice(1);
          loss += num(e.cost - minOf(atoms));
        }
        if (loss > worst) {
          worst = loss;
          worstTheme = theme;
        }
      }
    }
    return { worst, theme: worstTheme };
  }
}

/** Whether two books share a leg or a theme. */
export function related(a: BookRisk, b: BookRisk) {
  return a.legs.some((x) =>
    b.legs.some((y) => x.key === y.key || x.themes.some((t) => y.themes.includes(t))),
  );
}

/** One fill of a requester against the vault: its bundle, the capital it locked, and the
 * vault's fair value per unit then (and the markout once an hour old). */
export interface RequesterFill {
  at: number;
  book: number;
  mask: number;
  units: number;
  refund: number;
  capital: number;
  fair: number;
  buy: boolean;
  mark: number | null;
}

/** A requester's limits and markout record (research spec §1.6–1.7): outstanding and daily
 * capital, and the 1-hour markout of its fills in logit units against the vault's fair value,
 * credibility-weighted. */
export class Requesters {
  private readonly fills = new Map<Address, RequesterFill[]>();
  private markoutAll = 0;
  private markoutCount = 0;

  record(requester: Address, fill: Omit<RequesterFill, "mark">) {
    const list = this.fills.get(requester) ?? [];
    list.push({ ...fill, mark: null });
    // A week of history per requester at most.
    while (list.length && fill.at - list[0]!.at > 7 * 86_400_000) list.shift();
    this.fills.set(requester, list.slice(-500));
  }

  /** Marks fills an hour old at the current fair value per unit of their bundle. */
  markout(nowMs: number, fair: (f: RequesterFill) => number | null) {
    for (const list of this.fills.values())
      for (const f of list) {
        if (f.mark !== null || nowMs - f.at < 3_600_000) continue;
        const now = fair(f);
        if (now === null) continue;
        const logit = (p: number) =>
          Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
        f.mark = (logit(now) - logit(f.fair)) * (f.buy ? 1 : -1);
        this.markoutAll += f.mark;
        this.markoutCount++;
      }
  }

  /** The requester's excess markout over everyone's, credibility-weighted (n / (n + 20)). */
  excess(requester: Address) {
    const marked = (this.fills.get(requester) ?? []).filter((f) => f.mark !== null);
    if (!marked.length) return 0;
    const mean = marked.reduce((a, f) => a + f.mark!, 0) / marked.length;
    const all = this.markoutCount ? this.markoutAll / this.markoutCount : 0;
    return (marked.length / (marked.length + 20)) * (mean - all);
  }
  /** The share of the per-requester limits a requester gets, by its excess markout. */
  stakeFactor(requester: Address) {
    const e = this.excess(requester);
    return e <= 0.02 ? 1 : e <= 0.05 ? 0.5 : e <= 0.1 ? 0.2 : 0.05;
  }
  /** Capital a requester's fills locked in undecided books, and in the last day. */
  exposure(requester: Address, nowMs: number, undecided: (book: number) => boolean) {
    let outstanding = 0,
      daily = 0;
    for (const f of this.fills.get(requester) ?? []) {
      if (f.capital <= 0) continue;
      if (undecided(f.book)) outstanding += f.capital;
      if (nowMs - f.at < 86_400_000) daily += f.capital;
    }
    return { outstanding, daily };
  }
  /** For the state file. */
  snapshot() {
    return { fills: [...this.fills], all: this.markoutAll, count: this.markoutCount };
  }
  restore(value: ReturnType<Requesters["snapshot"]> | undefined) {
    if (!value) return;
    for (const [k, v] of value.fills) this.fills.set(k, v);
    this.markoutAll = value.all;
    this.markoutCount = value.count;
  }
}
