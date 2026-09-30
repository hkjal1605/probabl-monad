import {
  integerString,
  type Journal,
  StateFile as OperatorStateFile,
  validateJournal,
} from "@conditional-stocks/operator";

export interface MarketState {
  peak?: string;
  halted?: boolean;
  fundStarted?: boolean;
  fundComplete?: boolean;
  spot?: string;
  probability?: string;
  observedAt?: number;
  movement?: string;
  movementAt?: number;
  cooldownUntil?: number;
}
export interface State extends Journal {
  version: 1;
  scope: string;
  markets: Record<string, MarketState>;
}
export function initialState(scope: string): State {
  return {
    version: 1,
    scope,
    day: new Date().toISOString().slice(0, 10),
    spent: "0",
    lastBlock: "0",
    markets: {},
  };
}
export function validateState(value: unknown, scope: string): State {
  const s = value as State;
  const integer = integerString;
  validateJournal(s);
  if (
    s.version !== 1 ||
    s.scope !== scope ||
    !s.markets ||
    typeof s.markets !== "object" ||
    Array.isArray(s.markets)
  )
    throw new Error("Invalid bot state; do not silently reset risk limits");
  for (const m of Object.values(s.markets)) {
    if (!m || typeof m !== "object") throw new Error("Invalid market state");
    for (const v of [m.peak, m.spot, m.probability, m.movement])
      if (v !== undefined && !integer(v)) throw new Error("Invalid risk checkpoint");
    for (const v of [m.halted, m.fundStarted, m.fundComplete])
      if (v !== undefined && typeof v !== "boolean") throw new Error("Invalid safety latch");
    for (const v of [m.observedAt, m.cooldownUntil, m.movementAt])
      if (v !== undefined && (!Number.isSafeInteger(v) || v < 0))
        throw new Error("Invalid risk time");
  }
  return s;
}
/** One host/one dedicated wallet (see the operator package's StateFile). */
export class StateFile extends OperatorStateFile<State> {
  constructor(path: string, scope: string) {
    super(
      path,
      (value) => validateState(value, scope),
      () => initialState(scope),
    );
  }
}
