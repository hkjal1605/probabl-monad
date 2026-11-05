/** A user's opinion as a world book (docs/version-2-plan.md §9, the builder): the events they
 * believe in (catalog legs with a side each) and, optionally, where a stock closes on a date in
 * that world. Every opinion has exactly one canonical book, so the same view opened twice, or
 * by two people, trades in one market:
 *
 * - legs in order of their venue deadline (then id), the stock's single strike at the user's
 *   price in feed units, the fixing at 16:00 New York on the user's date, the cutoff an hour
 *   before it (an event-only world: an hour before its last leg's deadline);
 * - the spec hash covers the deployment, the legs and their sides, the feed, the strike, the
 *   fixing, the cutoff and the fee, never the words used.
 *
 * Pure: the routes fetch catalog entries and spot, this shapes and checks them. */
import {
  type BookDef,
  eventKey,
  outcomeMask,
  productKey,
  type WorldOutcome,
} from "@conditional-stocks/evm-client";
import { type CatalogEntry, hashCanonical } from "@conditional-stocks/market-data";
import type { Address, Hex } from "viem";
import { zeroAddress } from "viem";
import type { WorldPreviewAnswer } from "../rfq/world-protocol.ts";

export interface OpinionSpec {
  /** Catalog ids (`${source}:${marketId}`) and the side each must go. */
  legs: { id: string; wantYes: boolean }[];
  /** Where a stock closes in the world, on `date` (YYYY-MM-DD, New York). */
  stock: {
    underlying: string;
    direction: "above" | "below";
    /** Dollars, as typed (e.g. "240" or "240.50"). */
    strike: string;
    date: string;
  } | null;
}
/** A stock a world can fix on: a feed the world vault quotes against. */
export interface WorldUnderlying {
  underlying: string;
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "crypto";
  logo: string | null;
  feed: Address;
  /** The token whose reference price is the spot (the API's spot service), if any. */
  token: Address | null;
  decimals: number;
}

export class OpinionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422 = 422,
  ) {
    super(message);
  }
}

const ID = /^(polymarket|kalshi):[A-Za-z0-9._-]{1,128}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STRIKE = /^\d{1,9}(\.\d{1,2})?$/;
/** Legs per world (the vault's `maxLegs` may be lower). */
export const MAX_OPINION_LEGS = 4;

/** An opinion from a request body, checked for shape. */
export function parseSpec(value: unknown): OpinionSpec {
  const v = (value ?? {}) as Record<string, unknown>;
  if (!Array.isArray(v.legs) || v.legs.length < 1)
    throw new OpinionError("A world needs at least one event", 400);
  if (v.legs.length > MAX_OPINION_LEGS)
    throw new OpinionError(`A world has at most ${MAX_OPINION_LEGS} events`, 400);
  const legs = v.legs.map((raw) => {
    const l = (raw ?? {}) as Record<string, unknown>;
    if (typeof l.id !== "string" || !ID.test(l.id)) throw new OpinionError("Unknown event", 400);
    return { id: l.id, wantYes: l.wantYes !== false };
  });
  if (new Set(legs.map((l) => l.id)).size !== legs.length)
    throw new OpinionError("An event appears twice", 400);
  let stock: OpinionSpec["stock"] = null;
  if (v.stock !== null && v.stock !== undefined) {
    const s = v.stock as Record<string, unknown>;
    if (typeof s.underlying !== "string" || !/^[A-Z]{2,8}:[A-Z0-9.-]{1,23}$/.test(s.underlying))
      throw new OpinionError("Unknown stock", 400);
    if (s.direction !== "above" && s.direction !== "below")
      throw new OpinionError("The stock closes above or below a price", 400);
    const strike = String(s.strike ?? "").trim();
    if (!STRIKE.test(strike) || !(Number(strike) > 0))
      throw new OpinionError("Give the stock's price in dollars", 400);
    const date = String(s.date ?? "");
    if (!DATE.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)))
      throw new OpinionError("Give the date as YYYY-MM-DD", 400);
    stock = { underlying: s.underlying, direction: s.direction, strike, date };
  }
  return { legs, stock };
}

/** Unix seconds of 16:00 in New York on a calendar date (the US close). */
export function closeOf(date: string): number {
  const noon = Date.parse(`${date}T16:00:00Z`) / 1000;
  // New York is UTC−4 or UTC−5: the hour whose clock reads 16:00 there.
  for (const offset of [4, 5]) {
    const t = noon + offset * 3600;
    const clock = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(t * 1000));
    if (clock === "16:00") return t;
  }
  throw new OpinionError("Unknown date");
}
/** The calendar date in New York of a unix time. */
export function newYorkDate(seconds: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(seconds * 1000),
  );
}
/** The first weekday close at or after `seconds` (New York). */
export function nextClose(seconds: number): { date: string; time: number } {
  let date = newYorkDate(seconds);
  for (let i = 0; i < 10; i++) {
    const time = closeOf(date);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (time >= seconds && weekday !== 0 && weekday !== 6) return { date, time };
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  throw new OpinionError("No close found");
}

/** The last weekday close at or before `seconds` (New York). */
export function lastCloseBy(seconds: number): { date: string; time: number } {
  let date = newYorkDate(seconds);
  for (let i = 0; i < 10; i++) {
    const time = closeOf(date);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (time <= seconds && weekday !== 0 && weekday !== 6) return { date, time };
    const previous = new Date(`${date}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    date = previous.toISOString().slice(0, 10);
  }
  throw new OpinionError("No close found");
}

/** A venue question as a short neutral label: "Will the Fed cut in December?" → "The Fed cut
 * in December". The world's public wording comes only from venue text, never a user's. */
export function legLabel(question: string) {
  const q = question
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^will\s+/i, "")
    .replace(/\?$/, "")
    // "Will CPI be above 3%?" reads "CPI is above 3%".
    .replace(/^(there|[^,]{1,60}?) be /i, "$1 is ");
  const label = q.charAt(0).toUpperCase() + q.slice(1);
  return label.length > 90 ? `${label.slice(0, 87).trimEnd()}…` : label;
}
const usd = (strike: string) =>
  `$${Number(strike).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export interface CanonicalLeg {
  entry: CatalogEntry;
  wantYes: boolean;
  eventKey: Hex;
  label: string;
}
export interface CanonicalWorld {
  legs: CanonicalLeg[];
  underlying: WorldUnderlying | null;
  direction: "above" | "below" | null;
  strike: string | null;
  strikeRaw: bigint | null;
  fixingDate: string | null;
  fixingTime: number;
  cutoff: number;
  maxStaleness: number;
  feeBps: number;
  /** The world as one sentence, and as a title. */
  sentence: string;
  title: string;
  specHash: Hex;
}

/** The canonical world of an opinion, from its legs' catalog entries and its stock's feed. */
export function canonicalWorld(
  spec: OpinionSpec,
  entries: ReadonlyMap<string, CatalogEntry>,
  underlying: WorldUnderlying | null,
  deployment: { chainId: number; books: Address },
  feeBps: number,
): CanonicalWorld {
  const legs = spec.legs.map((l) => {
    const entry = entries.get(l.id);
    if (!entry) throw new OpinionError("An event is no longer listed: pick another", 409);
    return {
      entry,
      wantYes: l.wantYes,
      eventKey: eventKey(entry.conditionId, entry.yesIndex, entry.noIndex).toLowerCase() as Hex,
      label: legLabel(entry.question),
    };
  });
  legs.sort(
    (a, b) =>
      Date.parse(a.entry.endTime) - Date.parse(b.entry.endTime) ||
      (a.entry.id < b.entry.id ? -1 : 1),
  );
  const lastEnd = Math.max(...legs.map((l) => Math.floor(Date.parse(l.entry.endTime) / 1000)));
  let fixingTime = 0,
    cutoff: number,
    strikeRaw: bigint | null = null;
  if (spec.stock) {
    if (!underlying || underlying.underlying !== spec.stock.underlying)
      throw new OpinionError("Worlds cannot fix on this stock yet", 409);
    fixingTime = closeOf(spec.stock.date);
    const weekday = new Date(`${spec.stock.date}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6)
      throw new OpinionError("Pick a weekday: the stock fixes at the 4 pm New York close");
    cutoff = fixingTime - 3_600;
    const [whole, cents = ""] = spec.stock.strike.split(".");
    const scaled = BigInt(whole!) * 10n ** 2n + BigInt(cents.padEnd(2, "0"));
    strikeRaw =
      underlying.decimals >= 2
        ? scaled * 10n ** BigInt(underlying.decimals - 2)
        : scaled / 10n ** BigInt(2 - underlying.decimals);
    if (strikeRaw <= 0n) throw new OpinionError("The price is too small");
  } else cutoff = lastEnd - 3_600;
  // Mid-sentence, "The Fed cut…" reads "the Fed cut…".
  const mid = (label: string) =>
    /^(The|A|An) /.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
  const parts = legs.map((l) => (l.wantYes ? mid(l.label) : `“${l.label}” doesn't happen`));
  const events =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  const stockPart = spec.stock
    ? `${underlying!.symbol} closes ${spec.stock.direction} ${usd(spec.stock.strike)} on ${shortDate(spec.stock.date)}`
    : null;
  const sentence = stockPart
    ? `If ${events}, ${stockPart}`
    : events.charAt(0).toUpperCase() + events.slice(1);
  const title = sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}…` : sentence;
  const specHash = hashCanonical({
    chainId: String(deployment.chainId),
    books: deployment.books.toLowerCase(),
    legs: legs.map((l) => ({ id: l.entry.id, wantYes: l.wantYes })),
    feed: (underlying && spec.stock ? underlying.feed : zeroAddress).toLowerCase(),
    strike: strikeRaw?.toString() ?? null,
    direction: spec.stock?.direction ?? null,
    fixingTime: String(fixingTime),
    cutoff: String(cutoff),
    feeBps: String(feeBps),
  }) as Hex;
  return {
    legs,
    underlying: spec.stock ? underlying : null,
    direction: spec.stock?.direction ?? null,
    strike: spec.stock?.strike ?? null,
    strikeRaw,
    fixingDate: spec.stock?.date ?? null,
    fixingTime,
    cutoff,
    maxStaleness: spec.stock ? 3_600 : 0,
    feeBps,
    sentence,
    title,
    specHash,
  };
}

/** What stops a world from trading, in words, before anything is priced: the vault's limits,
 * legs already decided or out of the quoted range, two outcomes of one event, dates. */
export function worldProblems(
  w: CanonicalWorld,
  limits: { maxLegs: number; maxTenor: number; eventOnly: boolean } | null,
  nowS: number,
): string[] {
  const out: string[] = [];
  if (limits && w.legs.length > limits.maxLegs)
    out.push(`Worlds have at most ${limits.maxLegs} events for now`);
  if (!w.underlying && limits && !limits.eventOnly)
    out.push("Add a stock: worlds of events alone are not quoted yet");
  const groups = new Map<string, CanonicalLeg[]>();
  for (const l of w.legs) {
    const end = Date.parse(l.entry.endTime) / 1000;
    if (end <= nowS + 3_600) out.push(`"${l.label}" closes within the hour`);
    if (l.entry.yes === null) out.push(`"${l.label}" has no two-sided price on its venue`);
    else if (l.entry.yes < 0.03 || l.entry.yes > 0.97)
      out.push(`"${l.label}" is already almost decided (${Math.round(l.entry.yes * 100)}%)`);
    if (l.entry.exclusive) {
      const list = groups.get(l.entry.group) ?? [];
      list.push(l);
      groups.set(l.entry.group, list);
    }
  }
  for (const list of groups.values())
    if (list.filter((l) => l.wantYes).length > 1)
      out.push(`"${list[0]!.label}" and "${list[1]!.label}" can't both happen`);
  const decision = w.underlying ? w.fixingTime : w.cutoff;
  if (w.underlying && w.fixingTime <= nowS + 2 * 3_600) out.push("Pick a later date");
  if (limits && decision > nowS + limits.maxTenor)
    out.push(
      `Worlds settle within ${Math.round(limits.maxTenor / 86_400)} days for now: pick events and a date sooner`,
    );
  if (w.cutoff <= nowS + 600) out.push("This world stops trading too soon");
  return [...new Set(out)];
}

/** Notes that do not block a world but change how it reads. */
export function worldNotes(w: CanonicalWorld): string[] {
  const notes: string[] = [];
  if (!w.underlying) return notes;
  for (const l of w.legs)
    if (Date.parse(l.entry.endTime) / 1000 > w.fixingTime)
      notes.push(
        `"${l.label}" can be decided after ${w.fixingDate}: the stock is read on your date, and the world settles once every event is decided`,
      );
  return notes;
}

/** The book definition's fields the keeper prices a preview from (`world.preview`). */
export function previewBook(w: CanonicalWorld, spot: number | null) {
  return {
    legs: w.legs.map((l) => ({
      eventKey: l.eventKey,
      wantYes: l.wantYes,
      source: l.entry.source,
      marketId: l.entry.marketId,
      conditionId: l.entry.conditionId.toLowerCase(),
      yesIndex: l.entry.yesIndex,
      noIndex: l.entry.noIndex,
      question: l.entry.question,
      url: l.entry.url,
      endTime: l.entry.endTime,
      themes: l.entry.themes,
      reference:
        l.entry.yes !== null && l.entry.bid !== null && l.entry.ask !== null
          ? {
              yes: l.entry.yes,
              halfSpread: (l.entry.ask - l.entry.bid) / 2,
              observedAtMs: l.entry.updatedAtMs,
            }
          : null,
    })),
    feed: w.underlying?.feed ?? zeroAddress,
    underlying: w.underlying?.underlying ?? null,
    feedDecimals: w.underlying?.decimals ?? null,
    fixingTime: w.fixingTime,
    cutoff: w.cutoff,
    maxStaleness: w.maxStaleness,
    strikes: w.strikeRaw === null ? [] : [w.strikeRaw.toString()],
    feeBps: w.feeBps,
    spot,
  };
}

/** The two things a world sells, as the app names them:
 * - All-in: the stake buys units that pay $1 each if every event happens (and the stock ends
 *   on the user's side);
 * - Money-back: if every event happens the units pay as All-in's do, else the stake comes back
 *   whole. An event-only world sells All-in only. */
export function offerProducts(w: CanonicalWorld) {
  if (!w.underlying) return { allIn: productKey("world-bet", { kind: "world" }), moneyBack: null };
  const outcome: WorldOutcome = { kind: w.direction!, strike: 1 };
  return {
    allIn: productKey("world-bet", outcome),
    moneyBack: productKey("conditional", outcome),
  };
}

/** One way to end, with its chance (x 1e6) and what a product pays in it. */
export interface Ending {
  key: "win" | "lose-in-world" | "world-fails";
  chance: number;
  pays: string;
}
export interface OfferProduct {
  key: string;
  name: "All-in" | "Money-back";
  stake: string;
  units: string | null;
  /** What it pays if right, raw quote units. */
  payout: string | null;
  ask: number | null;
  decline: string | null;
  endings: Ending[];
}

/** The offer of a priced preview: each product's payout at its stake and how each ending pays,
 * from the maker's marks (chances x 1e6, atom 0 being "the world fails"). */
export function offerOf(w: CanonicalWorld, answer: WorldPreviewAnswer): OfferProduct[] {
  const marks = answer.marks ?? [];
  const keys = offerProducts(w);
  const count = w.underlying ? 3 : 2;
  const chanceOf = (mask: number) =>
    marks.reduce((sum, m, atom) => sum + ((mask >> atom) & 1 ? m : 0), 0);
  const winMask = w.underlying
    ? outcomeMask({ kind: w.direction!, strike: 1 }, count)
    : outcomeMask({ kind: "world" }, count);
  const inWorld = outcomeMask({ kind: "world" }, count);
  const win = chanceOf(winMask),
    fails = marks[0] ?? 0,
    loseIn = Math.max(0, chanceOf(inWorld) - win);
  const out: OfferProduct[] = [];
  for (const [name, key] of [
    ["All-in", keys.allIn],
    ["Money-back", keys.moneyBack],
  ] as const) {
    if (!key) continue;
    const p = answer.products.find((x) => x.key === key);
    if (!p) continue;
    const moneyBack = name === "Money-back";
    const endings: Ending[] = [{ key: "win", chance: win, pays: p.units ?? "0" }];
    if (w.underlying) endings.push({ key: "lose-in-world", chance: loseIn, pays: "0" });
    endings.push({ key: "world-fails", chance: fails, pays: moneyBack ? p.stake : "0" });
    out.push({
      key,
      name,
      stake: p.stake,
      units: p.units,
      payout: p.units,
      ask: p.ask,
      decline: p.decline,
      endings,
    });
  }
  return out;
}

/** A book definition's JSON (bigints as strings), as the metadata records it. */
export const defJson = (def: BookDef) =>
  JSON.parse(JSON.stringify(def, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
