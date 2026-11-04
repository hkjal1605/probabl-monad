import type { Logger } from "@conditional-stocks/shared";
import type { PublicClient } from "viem";
import type { Admin } from "../admin.ts";
import type { LadderConfig } from "../ladders.ts";
import type { CuratedVault } from "../vaults.ts";
import type { KalshiApi } from "../venues/kalshi-api.ts";
import type { CuratedWorld, WorldAdmin } from "../worlds.ts";
import { curateVaults } from "./curate-vaults.ts";
import { curateWorlds } from "./curate-worlds.ts";
import { fixBooks } from "./fix-books.ts";
import { dailyLadders, weeklyLadders } from "./ladders.ts";
import { resolveEvents } from "./resolve-events.ts";
import { resolveMarkets } from "./resolve-markets.ts";

export interface JobContext {
  admin: Admin;
  /** Reads Polygon, where Polymarket settles (Kalshi results come through the API). */
  polygon: PublicClient;
  /** The Δ-vaults this service registers new markets in (none without a curation config). */
  vaults: CuratedVault[];
  /** The daily and weekly ladders to create (none without a ladder config). */
  ladders: LadderConfig;
  /** Kalshi's public API, which lists the ladders' strikes. */
  kalshi: KalshiApi;
  /** The chain the exchange and the world books are on. */
  client?: PublicClient;
  /** The world books (absent without WORLD_BOOKS_ADDRESS) and the curated worlds to create. */
  worlds?: WorldAdmin;
  curated?: CuratedWorld[];
  /** False in a dry run: jobs log what they would do and change nothing. */
  execute: boolean;
  logger: Logger;
}
/** A recurring task. Runs of one job never overlap; a failed run is logged and retried on the
 * next interval. */
export interface Job {
  name: string;
  everyMs: number;
  run(context: JobContext): Promise<void>;
}

/** The jobs main.ts runs. Market creation jobs build `MarketSpec`s and call `createMarkets`. */
export const JOBS: Job[] = [
  resolveMarkets,
  dailyLadders,
  weeklyLadders,
  curateVaults,
  resolveEvents,
  fixBooks,
  curateWorlds,
];
