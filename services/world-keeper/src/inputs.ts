/** A book's model inputs, from the replica, its metadata, the live references and the fitted
 * data: its open legs (resolved ones that passed add no condition; a frozen or committed one
 * halts the book), each pair's correlation estimate (prior, stated relation, fit), the exact
 * logic stated relations imply, and for a priced book the stock part. Pure: no I/O. */
import type { LegRelationRecord, WorldBookRecord } from "@conditional-stocks/db";
import { EVENT_STATE, eventKey } from "@conditional-stocks/evm-client";
import {
  type BookState,
  eventOf,
  type WorldState,
} from "@conditional-stocks/evm-client/world-ledger";
import { type Address, type Hex, zeroAddress } from "viem";
import type { Settings } from "./config.ts";
import type { BookInputs, LegInput, StockInput } from "./model/book.ts";
import {
  type PairEstimate,
  posterior,
  relationCorrelation,
  themePrior,
} from "./model/correlation.ts";
import { type AssetKind, SKEW_PRIORS, VOL_FLOORS, varianceYears } from "./model/fixing.ts";
import type { LegLogic } from "./model/joint.ts";
import type { LegReferences, SpotReferences } from "./references.ts";
import type { BookRisk } from "./risk.ts";

/** The fitted data the keeper reads from the database (empty without one: priors only). */
export interface PricingData {
  /** By `${a}:${b}`, the two conditions in ascending order. */
  correlations: Map<string, { rho: number; se: number; samples: number }>;
  /** By `${a}:${b}` as stated (direction matters for `implies`). */
  relations: Map<string, LegRelationRecord>;
  vols: Map<string, { vol: number; error: number; method: string }>;
  /** By `${condition}:${underlying}`. */
  gaps: Map<string, { gap: number; error: number }>;
  probitVols: Map<string, number>;
}
export const emptyData = (): PricingData => ({
  correlations: new Map(),
  relations: new Map(),
  vols: new Map(),
  gaps: new Map(),
  probitVols: new Map(),
});
const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
/** Default probability volatility per √day in probit units, without a fit. */
const DEFAULT_PROBIT_VOL = 0.15;

/** One open leg of a book, with what the model and the gates need of it. */
export interface OpenLeg {
  index: number;
  key: Hex;
  condition: Hex;
  wantYes: boolean;
  themes: string[];
  resolvesAt: number;
  insider: boolean;
  politics: boolean;
  referenceAgeMs: number;
}
export type BuiltInputs =
  | { problem: string }
  | {
      inputs: BookInputs;
      legs: OpenLeg[];
      priorOnly: boolean;
      risk: BookRisk;
      /** The underlying's settings key and its spot source. */
      underlying: string | null;
    };

/** Whether a book's metadata names exactly the legs on chain. */
export function metadataMatches(b: BookState, meta: WorldBookRecord) {
  const legs = meta.metadata.legs;
  return (
    legs.length === b.def.legs.length &&
    b.def.legs.every((leg, i) => {
      const m = legs[i]!;
      return (
        m.eventKey.toLowerCase() === leg.eventKey &&
        m.wantYes === leg.wantYes &&
        eventKey(m.conditionId as Hex, m.yesIndex, m.noIndex) === leg.eventKey
      );
    })
  );
}

/** The exact logic and the correlation prior a stated relation gives two open legs. */
function relationOf(data: PricingData, a: OpenLeg, b: OpenLeg) {
  const forward = data.relations.get(`${a.condition}:${b.condition}`);
  const backward = data.relations.get(`${b.condition}:${a.condition}`);
  const r = forward ?? backward;
  if (!r) return null;
  // In terms of the stated direction: x = the relation's `a` leg, y = its `b` leg.
  const [x, y] = forward ? [a, b] : [b, a];
  let logic: LegLogic | null = null;
  if (r.kind === "exclusive") {
    if (x.wantYes && y.wantYes) logic = { kind: "exclusive", a: x.index, b: y.index };
    else if (x.wantYes && !y.wantYes) logic = { kind: "implies", a: x.index, b: y.index };
    else if (!x.wantYes && y.wantYes) logic = { kind: "implies", a: y.index, b: x.index };
  } else if (r.kind === "implies" || r.kind === "duplicate") {
    if (x.wantYes && y.wantYes) logic = { kind: "implies", a: x.index, b: y.index };
    else if (!x.wantYes && !y.wantYes) logic = { kind: "implies", a: y.index, b: x.index };
    else if (x.wantYes && !y.wantYes) logic = { kind: "exclusive", a: x.index, b: y.index };
    else if (r.kind === "duplicate") logic = { kind: "exclusive", a: x.index, b: y.index };
  }
  return { record: r, logic, x, y };
}

export function buildInputs(input: {
  s: WorldState;
  book: BookState;
  meta: WorldBookRecord;
  legsRef: LegReferences;
  spotRef: SpotReferences;
  data: PricingData;
  settings: Settings;
  nowMs: number;
}): BuiltInputs {
  const { s, book: b, meta, legsRef, data, settings, nowMs } = input;
  const now = nowMs / 1000;
  if (!metadataMatches(b, meta)) return { problem: "The book's metadata does not match its legs" };
  const legs: OpenLeg[] = [];
  const model: LegInput[] = [];
  let maxResolution = 0;
  for (let i = 0; i < b.def.legs.length; i++) {
    const leg = b.def.legs[i]!,
      m = meta.metadata.legs[i]!;
    const e = eventOf(s, leg.eventKey);
    if (e.state === EVENT_STATE.frozen || e.state === EVENT_STATE.committed)
      return { problem: "A leg is frozen" };
    const resolved = e.state >= EVENT_STATE.yes;
    if (resolved) {
      const passed =
        (e.state === EVENT_STATE.yes && leg.wantYes) ||
        (e.state === EVENT_STATE.no && !leg.wantYes);
      if (!passed) return { problem: "The world failed" };
      continue;
    }
    const tick = legsRef.latest(m.conditionId as Hex);
    if (!tick) return { problem: "A leg has no live probability" };
    const age = nowMs - tick.observedAtMs;
    if (age > settings.references.maxReferenceAgeMs)
      return { problem: "A leg's probability is stale" };
    if (tick.halfSpread * 2 > settings.references.maxSpread)
      return { problem: "A leg's venue spread is too wide" };
    const floor = settings.references.probabilityFloor;
    if (tick.yes < floor || tick.yes > 1 - floor)
      return { problem: "A leg is priced outside the quoted range" };
    const end = Date.parse(m.endTime) / 1000;
    const resolvesAt = Number.isFinite(end) ? Math.max(end, now + 3_600) : now + 30 * 86_400;
    maxResolution = Math.max(maxResolution, resolvesAt);
    const themes = m.themes ?? [];
    const open: OpenLeg = {
      index: legs.length,
      key: leg.eventKey,
      condition: (m.conditionId as Hex).toLowerCase() as Hex,
      wantYes: leg.wantYes,
      themes,
      resolvesAt,
      insider: themes.some((t) => settings.insiderThemes.includes(t)),
      politics: themes.some((t) => settings.politicsThemes.includes(t)),
      referenceAgeMs: age,
    };
    legs.push(open);
    model.push({
      yes: tick.yes,
      halfSpread: tick.halfSpread,
      venueGap: 0,
      wantYes: leg.wantYes,
      resolvesIn: resolvesAt - now,
      probitVol: data.probitVols.get(open.condition) ?? DEFAULT_PROBIT_VOL,
      politics: open.politics,
    });
  }
  // Pairs: a stated relation or the theme prior, combined with the fit.
  const logic: LegLogic[] = [];
  let priorOnly = true;
  const estimates = new Map<string, PairEstimate>();
  for (let i = 0; i < legs.length; i++)
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i]!,
        c = legs[j]!;
      const relation = relationOf(data, a, c);
      if (relation?.logic) logic.push(relation.logic);
      let prior = themePrior(a.themes, c.themes, settings.themes);
      let source: PairEstimate["source"] = "prior";
      const r = relation?.record;
      if (r && r.pBGivenA !== null && r.pBGivenNotA !== null) {
        const pa = model[relation!.x.index]!.yes,
          pb = model[relation!.y.index]!.yes;
        const rho = relationCorrelation(pa, pb, r.pBGivenA, r.pBGivenNotA);
        const confidence = Math.min(1, Math.max(0, r.confidence ?? 0.5));
        prior = { rho, se: 0.2 - 0.08 * confidence };
        source = r.source === "admin" ? "admin" : "relation";
      }
      const fit = data.correlations.get(pairKey(a.condition, c.condition));
      if (fit) priorOnly = false;
      const e = posterior(prior, fit ? { rho: fit.rho, se: fit.se } : null, fit ? "data" : source);
      estimates.set(`${i}:${j}`, e);
    }
  if (legs.length < 2) priorOnly = false;
  // The stock part.
  let stock: StockInput | null = null;
  const underlying = meta.metadata.underlying;
  const priced = b.def.feed !== zeroAddress;
  if (priced) {
    if (!underlying) return { problem: "A priced book names no underlying" };
    const u = settings.underlyings[underlying];
    const kind: AssetKind = u?.kind ?? "stock";
    const spot = input.spotRef.spot(
      b.def.feed,
      u?.token,
      {
        maxAgeMs: settings.references.maxSpotAgeMs,
        maxDeviationBps: settings.references.maxSpotDeviationBps,
        allowStale: settings.references.allowStaleSpot,
      },
      nowMs,
    );
    if ("problem" in spot) return { problem: spot.problem };
    const fitted = data.vols.get(underlying);
    const vol = Math.max(VOL_FLOORS[kind], u?.vol ?? fitted?.vol ?? VOL_FLOORS[kind] * 2);
    const volSe = u?.volSe ?? (fitted ? fitted.error / Math.max(fitted.vol, 1e-9) : 0.15);
    const implied = u?.implied ?? fitted?.method === "implied";
    const skew = SKEW_PRIORS[kind];
    const fixing = b.def.fixingTime;
    const earnings =
      u?.earnings &&
      u.earnings.dates.some((d) => {
        const t = Date.parse(d) / 1000;
        return t >= now && t <= fixing;
      });
    stock = {
      kind,
      spot: spot.price,
      strikes: b.def.strikes.map((k) => Number(k)),
      vol,
      volSe,
      implied,
      skew1m: u?.skew1m ?? skew.psi,
      skewSe: u?.skewSe ?? skew.se,
      earningsJump: earnings && !implied ? (u?.earnings?.jump ?? null) : null,
      gaps: legs.map((l) => {
        const reviewed = settings.gaps[`${l.condition}:${underlying}`];
        const fitted = data.gaps.get(`${l.condition}:${underlying}`);
        const gap = reviewed?.gap ?? fitted?.gap ?? 0;
        const se = reviewed?.se ?? fitted?.error ?? settings.defaultGapSe;
        return { gap: l.wantYes ? gap : -gap, se };
      }),
      fixingIn: Math.max(0, fixing - now),
      tau: varianceYears(now, fixing, kind),
    };
  }
  const decidesAt = priced
    ? Math.max(b.def.fixingTime, maxResolution)
    : Math.max(maxResolution, now);
  const inputs: BookInputs = {
    legs: model,
    pair: (i, j) => estimates.get(`${i}:${j}`)!,
    logic,
    stock,
    decidesIn: Math.max(60, decidesAt - now),
  };
  return {
    inputs,
    legs,
    priorOnly,
    underlying: underlying ?? null,
    risk: {
      book: b,
      model: null,
      legs: legs.map((l) => ({ key: l.key, wantYes: l.wantYes, themes: l.themes })),
    },
  };
}

/** The spot sources the keeper polls: each priced book's feed and its underlying's token. */
export function spotSources(
  s: WorldState,
  metas: ReadonlyMap<number, WorldBookRecord>,
  settings: Settings,
) {
  const out: { feed: Address; token?: Address }[] = [];
  for (const b of s.books.values()) {
    if (b.def.feed === zeroAddress || b.status !== 1) continue;
    const underlying = metas.get(b.id)?.metadata.underlying;
    const token = underlying ? settings.underlyings[underlying]?.token : undefined;
    out.push(token ? { feed: b.def.feed, token } : { feed: b.def.feed });
  }
  return out;
}
