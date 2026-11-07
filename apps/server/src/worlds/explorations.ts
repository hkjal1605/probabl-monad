/** The worlds people explore: every world the makers quoted for someone, whether or not they
 * took a position, kept so the worlds page can show what others have opinions on ("What people
 * are exploring") and anyone can take a position in one.
 *
 * - A world is kept only when a person asked for its price (the app marks those previews; its
 *   rotating examples and the curated worlds it opens on are not anyone's opinion) and a maker
 *   quoted at least one of its products.
 * - What is kept is the canonical opinion and its venue wording, never the words someone typed,
 *   and no visitor: an explorer is counted at most once a day per world, in memory only.
 * - Writes leave the preview's path: notes merge in memory and are written together every few
 *   seconds, one statement for all of them. */
import type { WorldExplorationNote, WorldExplorationRecord } from "@conditional-stocks/db";
import type { OpinionSpec } from "./opinion.ts";

/** A visitor pricing the same world again within this counts once. */
export const EXPLORER_WINDOW_MS = 24 * 3_600_000;
/** A visitor's further quotes of one world count at most once in this (a stake edit reprices). */
export const QUOTE_WINDOW_MS = 10 * 60_000;
/** How often the merged notes are written. */
export const FLUSH_MS = 5_000;
/** Visitors remembered per world and visitor at most (the oldest are forgotten first). */
const MAX_SEEN = 100_000;
/** Notes held while the database is unreachable at most. */
const MAX_PENDING = 2_000;

/** A world as the exploring list shows it: the venue's words for each event, the stock's terms. */
export interface ExplorationWorld {
  sentence: string;
  legs: {
    id: string;
    source: string;
    marketId: string;
    question: string;
    label: string;
    url: string;
    image: string | null;
    endTime: string;
    wantYes: boolean;
    /** The venue's YES chance when it was quoted (the list reads it again). */
    yes: number | null;
  }[];
  stock: {
    underlying: string;
    symbol: string;
    name: string;
    logo: string | null;
    direction: "above" | "below";
    strike: string;
    date: string;
  } | null;
  fixingTime: number | null;
  cutoff: number;
}
/** The makers' last quote: each product priced, at its stake (raw quote units), and the chance
 * of the world's winning ending (x 1e6). */
export interface ExplorationQuote {
  at: number;
  products: { name: "All-in" | "Money-back"; stake: string; payout: string }[];
  win: number | null;
}
export interface Exploration {
  specHash: string;
  spec: OpinionSpec;
  world: ExplorationWorld;
  quote: ExplorationQuote;
  cutoff: number;
}

/** The preview body's parts read here (see `previewOf` in opinions.ts). */
interface PreviewBody {
  world: {
    sentence: string;
    specHash: string;
    legs: {
      id: string;
      source: string;
      marketId: string;
      question: string;
      label: string;
      url: string;
      image: string | null;
      endTime: string;
      yes: number | null;
      wantYes: boolean;
    }[];
    stock: {
      underlying: string;
      symbol: string;
      name: string;
      logo: string | null;
      direction: "above" | "below" | null;
      strike: string | null;
      date: string | null;
    } | null;
    fixingTime: number | null;
    cutoff: number;
  };
  problems: string[];
  offer:
    | {
        name: "All-in" | "Money-back";
        stake: string;
        payout: string | null;
        decline: string | null;
        endings: { key: string; chance: number }[];
      }[]
    | null;
}

/** The exploration a preview makes, or null when no maker quoted it: it has a problem, every
 * maker declined, or every product was declined. */
export function explorationOf(
  spec: OpinionSpec,
  preview: PreviewBody,
  nowMs = Date.now(),
): Exploration | null {
  if (preview.problems.length) return null;
  const products = (preview.offer ?? []).flatMap((p) =>
    !p.decline && p.payout !== null && BigInt(p.payout) > 0n
      ? [{ name: p.name, stake: p.stake, payout: p.payout }]
      : [],
  );
  if (!products.length) return null;
  const w = preview.world;
  const stock =
    w.stock?.direction && w.stock.strike && w.stock.date
      ? {
          underlying: w.stock.underlying,
          symbol: w.stock.symbol,
          name: w.stock.name,
          logo: w.stock.logo,
          direction: w.stock.direction,
          strike: w.stock.strike,
          date: w.stock.date,
        }
      : null;
  return {
    specHash: w.specHash.toLowerCase(),
    // The canonical opinion: its legs in the world's order, the stock as asked.
    spec: { legs: w.legs.map((l) => ({ id: l.id, wantYes: l.wantYes })), stock: spec.stock },
    world: {
      sentence: w.sentence,
      legs: w.legs.map((l) => ({
        id: l.id,
        source: l.source,
        marketId: l.marketId,
        question: l.question,
        label: l.label,
        url: l.url,
        image: l.image,
        endTime: l.endTime,
        wantYes: l.wantYes,
        yes: l.yes,
      })),
      stock,
      fixingTime: w.fixingTime,
      cutoff: w.cutoff,
    },
    quote: {
      at: nowMs,
      products,
      win: preview.offer?.[0]?.endings.find((e) => e.key === "win")?.chance ?? null,
    },
    cutoff: w.cutoff,
  };
}

/** Explorations as they arrive, merged per world and written in batches. */
export class ExplorationLog {
  private readonly seen = new Map<string, { explorer: number; quote: number }>();
  private pending = new Map<string, WorldExplorationNote>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly options: {
      write: (notes: WorldExplorationNote[]) => Promise<void>;
      log: (event: string, detail: Record<string, unknown>) => void;
      now?: () => number;
      flushMs?: number;
    },
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  /** One person (`visitor`, kept in memory only) was quoted `e`. */
  note(e: Exploration, visitor: string) {
    const now = this.now();
    const key = `${e.specHash}|${visitor}`;
    const last = this.seen.get(key);
    const explorer = !last || now - last.explorer >= EXPLORER_WINDOW_MS;
    const quote = explorer || !last || now - last.quote >= QUOTE_WINDOW_MS;
    // Re-inserted, so the map's order is the least recently noted first.
    this.seen.delete(key);
    this.seen.set(key, {
      explorer: explorer ? now : (last?.explorer ?? now),
      quote: quote ? now : (last?.quote ?? now),
    });
    if (this.seen.size > MAX_SEEN)
      for (const k of [...this.seen.keys()].slice(0, this.seen.size - MAX_SEEN))
        this.seen.delete(k);
    const held = this.pending.get(e.specHash);
    this.pending.set(e.specHash, {
      specHash: e.specHash,
      spec: e.spec,
      world: e.world,
      quote: e.quote,
      cutoff: e.cutoff,
      explorers: (held?.explorers ?? 0) + (explorer ? 1 : 0),
      quotes: (held?.quotes ?? 0) + (quote ? 1 : 0),
      at: new Date(now),
    });
    this.start();
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.options.flushMs ?? FLUSH_MS);
    this.timer.unref?.();
  }

  /** Writes what is pending (one statement); a failed write is kept for the next one. */
  flush(): Promise<void> {
    if (this.writing) return this.writing;
    if (!this.pending.size) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return Promise.resolve();
    }
    const batch = this.pending;
    this.pending = new Map();
    this.writing = this.options
      .write([...batch.values()])
      .catch((error) => {
        this.options.log("worlds.explorations.write.failed", {
          error: String(error),
          worlds: batch.size,
        });
        // Newer notes win; the failed batch's counts are added back under them.
        for (const [hash, old] of batch) {
          if (this.pending.size >= MAX_PENDING) break;
          const newer = this.pending.get(hash);
          this.pending.set(
            hash,
            newer
              ? {
                  ...newer,
                  explorers: newer.explorers + old.explorers,
                  quotes: newer.quotes + old.quotes,
                }
              : old,
          );
        }
      })
      .finally(() => {
        this.writing = null;
      });
    return this.writing;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** One explored world as the list shows it. */
export interface ExploringWorld {
  specHash: string;
  spec: unknown;
  world: ExplorationWorld;
  quote: ExplorationQuote;
  explorers: number;
  lastAt: string;
  firstAt: string;
}

/** The worlds to list, from the stored ones: none that already trade (they are in the live
 * feed), none whose event is no longer listed or already decided (its venue at the edges), each
 * event's chance as the venue has it now. */
export function exploringList(
  rows: readonly WorldExplorationRecord[],
  options: {
    traded: ReadonlySet<string>;
    entries: ReadonlyMap<string, { yes: number | null; endTime: string }>;
    nowMs: number;
    limit: number;
  },
): ExploringWorld[] {
  const out: ExploringWorld[] = [];
  for (const r of rows) {
    if (out.length >= options.limit) break;
    if (options.traded.has(r.specHash.toLowerCase())) continue;
    const world = r.world as ExplorationWorld;
    let open = true;
    const legs = world.legs.map((l) => {
      const now = options.entries.get(l.id);
      if (
        !now ||
        now.yes === null ||
        now.yes < 0.02 ||
        now.yes > 0.98 ||
        Date.parse(now.endTime) <= options.nowMs
      )
        open = false;
      return { ...l, yes: now?.yes ?? l.yes };
    });
    if (!open) continue;
    out.push({
      specHash: r.specHash,
      spec: r.spec,
      world: { ...world, legs },
      quote: r.quote as ExplorationQuote,
      explorers: r.explorers,
      lastAt: r.lastAt.toISOString(),
      firstAt: r.firstAt.toISOString(),
    });
  }
  return out;
}
