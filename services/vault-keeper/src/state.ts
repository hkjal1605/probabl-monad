import {
  initialJournal,
  integerString,
  type Journal,
  StateFile as OperatorStateFile,
  validateJournal,
} from "@conditional-stocks/operator";

/** Last reference and volatility of one market. */
export interface MarketRecord {
  spot?: string;
  probability?: string;
  observedAt?: number;
  /** Exponential average of reference moves between cycles, bps. */
  movement?: string;
  movementAt?: number;
  cooldownUntil?: number;
}
/** Holdings per 1e18 shares (raw units), the basket the drawdown check re-marks. */
export interface Basket {
  quote: string;
  base: string;
  markets: { market: number; yesQuote: string; noQuote: string; yesBase: string; noBase: string }[];
}
export interface KeeperState extends Journal {
  version: 1;
  scope: string;
  markets: Record<string, MarketRecord>;
  checkpoint?: { at: number; basket: Basket };
  /** Latched by a drawdown breach; only an operator clears it. */
  halted?: boolean;
}

export function initialState(scope: string): KeeperState {
  return { version: 1, scope, ...initialJournal(), markets: {} };
}
export function validateState(value: unknown, scope: string): KeeperState {
  const s = value as KeeperState;
  validateJournal(s);
  if (
    s.version !== 1 ||
    s.scope !== scope ||
    !s.markets ||
    typeof s.markets !== "object" ||
    Array.isArray(s.markets) ||
    (s.halted !== undefined && typeof s.halted !== "boolean")
  )
    throw new Error("Invalid keeper state; do not silently reset risk limits");
  for (const m of Object.values(s.markets)) {
    if (!m || typeof m !== "object") throw new Error("Invalid market state");
    for (const v of [m.spot, m.probability, m.movement])
      if (v !== undefined && !integerString(v)) throw new Error("Invalid risk checkpoint");
    for (const v of [m.observedAt, m.cooldownUntil, m.movementAt])
      if (v !== undefined && (!Number.isSafeInteger(v) || v < 0))
        throw new Error("Invalid risk time");
  }
  const c = s.checkpoint;
  if (
    c &&
    (!Number.isSafeInteger(c.at) ||
      !integerString(c.basket?.quote) ||
      !integerString(c.basket?.base) ||
      !Array.isArray(c.basket.markets) ||
      c.basket.markets.some(
        (m) =>
          !Number.isSafeInteger(m.market) ||
          ![m.yesQuote, m.noQuote, m.yesBase, m.noBase].every(integerString),
      ))
  )
    throw new Error("Invalid drawdown checkpoint");
  return s;
}
/** One host/one dedicated keeper wallet (see the operator package's StateFile). */
export class StateFile extends OperatorStateFile<KeeperState> {
  constructor(path: string, scope: string) {
    super(
      path,
      (value) => validateState(value, scope),
      () => initialState(scope),
    );
  }
}
