import type { Logger } from "@conditional-stocks/shared";
import type { PublicClient } from "viem";
import type { Admin } from "../admin.ts";
import type { CuratedVault } from "../vaults.ts";
import { curateVaults } from "./curate-vaults.ts";
import { resolveMarkets } from "./resolve-markets.ts";

export interface JobContext {
  admin: Admin;
  /** Reads Polygon, where Polymarket settles (Kalshi results come through the API). */
  polygon: PublicClient;
  /** The Δ-vaults this service registers new markets in (none without a curation config). */
  vaults: CuratedVault[];
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

/** The jobs main.ts runs. Market creation jobs (e.g. daily price ladders) build `MarketSpec`s and
 * call `createMarkets`. */
export const JOBS: Job[] = [resolveMarkets, curateVaults];
