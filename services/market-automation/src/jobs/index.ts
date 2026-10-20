import type { Logger } from "@conditional-stocks/shared";
import type { PublicClient } from "viem";
import type { Admin } from "../admin.ts";
import { resolveMarkets } from "./resolve-markets.ts";

export interface JobContext {
  admin: Admin;
  /** Reads Polygon, where Polymarket settles (Kalshi results come through the API). */
  polygon: PublicClient;
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
export const JOBS: Job[] = [resolveMarkets];
