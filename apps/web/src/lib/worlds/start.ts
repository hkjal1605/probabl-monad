/** A world started from its parts on the worlds page, handed to the builder: the spec rides in
 * the URL (`/worlds/new?w=…`, so the link can be shared or reloaded), and the events as the page
 * showed them are kept in memory for the client-side navigation, so the builder draws them at
 * once instead of waiting for its first price. */
import type { LegState, Spec, StockState } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STRIKE = /^\d{1,12}(\.\d{1,8})?$/;

/** The spec as its `w` parameter. */
export const startParam = (spec: Spec) => JSON.stringify(spec);

/** A `w` parameter's spec, or null when it is not one. */
export function parseStart(value: string | null): Spec | null {
  if (!value) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  const r = raw as { legs?: unknown; stock?: unknown };
  if (!Array.isArray(r.legs) || r.legs.length < 1 || r.legs.length > 4) return null;
  const legs: Spec["legs"] = [];
  for (const l of r.legs as { id?: unknown; wantYes?: unknown }[]) {
    if (typeof l?.id !== "string" || !l.id || l.id.length > 200 || typeof l.wantYes !== "boolean")
      return null;
    legs.push({ id: l.id, wantYes: l.wantYes });
  }
  if (new Set(legs.map((l) => l.id)).size !== legs.length) return null;
  if (r.stock === null || r.stock === undefined) return { legs, stock: null };
  const s = r.stock as Record<string, unknown>;
  if (
    typeof s.underlying !== "string" ||
    !/^[A-Z]{2,8}:[A-Z0-9][A-Z0-9.-]{0,22}$/.test(s.underlying) ||
    (s.direction !== "above" && s.direction !== "below") ||
    typeof s.strike !== "string" ||
    !STRIKE.test(s.strike) ||
    typeof s.date !== "string" ||
    !DATE.test(s.date)
  )
    return null;
  return {
    legs,
    stock: { underlying: s.underlying, direction: s.direction, strike: s.strike, date: s.date },
  };
}

/** The spec of a world's parts, in one field order (the builder keys its prices on it). */
export function specOf(legs: readonly LegState[], stock: StockState | null): Spec {
  return {
    legs: legs.map((l) => ({ id: l.entry.id, wantYes: l.wantYes })),
    stock: stock
      ? {
          underlying: stock.underlying,
          direction: stock.direction,
          strike: stock.strike,
          date: stock.date,
        }
      : null,
  };
}

let pending: { param: string; legs: LegState[]; stock: StockState | null } | null = null;

/** Keeps the parts the worlds page showed for the builder it navigates to. */
export function stashStart(legs: LegState[], stock: StockState | null) {
  const param = startParam(specOf(legs, stock));
  pending = { param, legs, stock };
  return param;
}

/** The parts stashed for this `w` parameter (kept until the next stash: React's development
 * double mount reads it twice). */
export const takeStart = (param: string) => (pending?.param === param ? pending : null);
