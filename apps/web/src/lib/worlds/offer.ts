/** What a world offers at a stake, from a preview (a world not created yet) or a live world's
 * indications: the units a stake buys, what they pay in each ending and how likely each is, and
 * what the price costs over its fair value. Indicative: the RFQ answers firm at trade time.
 *
 * A unit pays $1 (one raw unit per raw unit) if its outcome happens. All-in: the stake buys
 * units. Money-back: the stake buys units and the stake back if the world fails (the refund),
 * so units = stake / (its price inside the world). */
import { dollars } from "./format";
import type { BookView, Ending, OfferProduct } from "./types";

export type ProductName = "All-in" | "Money-back";
export interface Offer {
  key: string;
  name: ProductName;
  stake: number;
  /** Dollars if right, and as a multiple of the stake. */
  payout: number | null;
  /** Chances x 1e6 of each ending, and what the product pays in it (dollars). */
  endings: { key: Ending["key"]; chance: number; pays: number }[];
  /** P(this pays out its units), x 1e6. */
  win: number;
  /** Fair value of the bundle at the marks, and the fee the books charge on the price. */
  fair: number | null;
  fee: number;
  decline: string | null;
}

/** The atoms of a product's outcome in a book of `count` atoms (`count - 2` strikes). */
export function outcomeAtoms(outcome: { kind: string; strike?: number }, count: number) {
  const strikes = count - 2;
  const atoms: number[] = [];
  for (let a = 1; a < count; a++) {
    if (outcome.kind === "world") atoms.push(a);
    else if (outcome.kind === "above" && a >= (outcome.strike ?? 1) + 1) atoms.push(a);
    else if (outcome.kind === "below" && a <= (outcome.strike ?? strikes)) atoms.push(a);
  }
  return atoms;
}

/** Endings and value of a product from marks (chances x 1e6, atom 0: the world fails). */
function endingsOf(
  marks: number[] | null,
  atoms: number[],
  priced: boolean,
  units: number | null,
  refund: number,
) {
  if (!marks) return { endings: [], win: 0, fair: null };
  const win = atoms.reduce((sum, a) => sum + (marks[a] ?? 0), 0);
  const fails = marks[0] ?? 0;
  const loseIn = Math.max(0, 1_000_000 - fails - win);
  const pays = units ?? 0;
  const endings: Offer["endings"] = [{ key: "win", chance: win, pays }];
  if (priced) endings.push({ key: "lose-in-world", chance: loseIn, pays: 0 });
  endings.push({ key: "world-fails", chance: fails, pays: refund });
  const fair = units === null ? null : (pays * win + refund * fails) / 1_000_000;
  return { endings, win, fair };
}

/** A preview's products as offers. */
export function previewOffers(
  products: OfferProduct[],
  marks: number[] | null,
  feeBps: number,
  priced: boolean,
): Offer[] {
  const count = priced ? 3 : 2;
  return products.map((p) => {
    const stake = dollars(p.stake);
    const units = p.units === null ? null : dollars(p.units);
    const moneyBack = p.name === "Money-back";
    const parsed = parseKey(p.key);
    const e = endingsOf(
      marks,
      outcomeAtoms(parsed?.outcome ?? { kind: "world" }, count),
      priced,
      units,
      moneyBack ? stake : 0,
    );
    return {
      key: p.key,
      name: p.name,
      stake,
      payout: units,
      endings: e.endings,
      win: e.win,
      fair: e.fair,
      fee: (stake * feeBps) / 10_000,
      decline: p.decline,
    };
  });
}

/** The books' taker fee on a price, in raw units: `feeBps` of it, rounded up, as `WorldBooks`
 * charges it on top of the price. */
export const feeOn = (price: bigint, feeBps: number) => (price * BigInt(feeBps) + 9_999n) / 10_000n;

/** What an order of `amount` dollars stakes when its fee comes out of it, in raw units: the most
 * whose stake plus fee is at most the amount, so the order costs what it says (at 1%, a $20
 * order is a $19.80 stake and its $0.20 fee). */
export function stakeRawWithin(amount: number, feeBps: number): bigint {
  const total = BigInt(Math.max(0, Math.round(amount * 1_000_000)));
  let stake = (total * 10_000n) / BigInt(10_000 + feeBps);
  while (stake > 0n && stake + feeOn(stake, feeBps) > total) stake -= 1n;
  return stake;
}
/** `stakeRawWithin`, in dollars. */
export const stakeWithin = (amount: number, feeBps: number) =>
  Number(stakeRawWithin(amount, feeBps)) / 1_000_000;
/** A stake in dollars as the API reads one: up to six decimals, no trailing zeros. */
export const stakeText = (stake: number) => stake.toFixed(6).replace(/\.?0+$/, "");

/** The same offers rescaled to another stake (prices per unit hold for small changes). */
export function atStake(o: Offer, stake: number): Offer {
  if (o.stake <= 0 || o.payout === null) return { ...o, stake };
  const k = stake / o.stake;
  return {
    ...o,
    stake,
    payout: o.payout * k,
    endings: o.endings.map((e) => ({ ...e, pays: e.pays * k })),
    fair: o.fair === null ? null : o.fair * k,
    fee: o.fee * k,
  };
}

export function parseKey(
  key: string,
): { kind: "world-bet" | "conditional"; outcome: { kind: string; strike?: number } } | null {
  const m = /^(bet|cond):(?:(world)|(above|below):([1-8]))$/.exec(key);
  if (!m) return null;
  return {
    kind: m[1] === "bet" ? "world-bet" : "conditional",
    outcome: m[2] ? { kind: "world" } : { kind: m[3]!, strike: Number(m[4]) },
  };
}

/** A live world's offers at the given stakes, from the makers' indications on its book. */
export function bookOffers(
  book: BookView,
  stakes: { allIn: number; moneyBack: number },
  direction: "above" | "below" | null,
): Offer[] {
  const priced = !book.eventOnly;
  const outcome = priced ? `${direction ?? "above"}:1` : "world";
  const keys: [ProductName, string][] = priced
    ? [
        ["All-in", `bet:${outcome}`],
        ["Money-back", `cond:${outcome}`],
      ]
    : [["All-in", "bet:world"]];
  return keys.map(([name, key]) => {
    const product = book.products.find((p) => p.key === key);
    const stake = name === "Money-back" ? stakes.moneyBack : stakes.allIn;
    const ask = product?.ask ?? null;
    const units = ask ? stake / (ask / 1_000_000) : null;
    const parsed = parseKey(key)!;
    const e = endingsOf(
      book.marks,
      outcomeAtoms(parsed.outcome, book.atoms),
      priced,
      units,
      name === "Money-back" ? stake : 0,
    );
    return {
      key,
      name,
      stake,
      payout: units,
      endings: e.endings,
      win: e.win,
      fair: e.fair,
      fee: (stake * book.feeBps) / 10_000,
      decline: !book.tradable
        ? "This world is not trading now"
        : ask
          ? null
          : book.marks
            ? "Not offered for this world right now"
            : "No live price yet",
    };
  });
}
