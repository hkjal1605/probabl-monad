/** The world keeper's state file: the transaction journal every signing service keeps, the
 * drawdown checkpoint and latch (only an operator clears it), the quote nonce counter, and the
 * requesters' fill record behind their markouts and limits. Written before any signed
 * transaction leaves (`Executor`), never silently reset. */
import {
  initialJournal,
  type Journal,
  StateFile as OperatorStateFile,
  validateJournal,
} from "@conditional-stocks/operator";
import type { Requesters } from "./risk.ts";

export interface KeeperState extends Journal {
  version: 1;
  scope: string;
  /** The marked NAV at the start of the drawdown window. */
  checkpoint?: { at: number; nav: number };
  halted?: boolean;
  /** The last quote nonce counter handed out (nonces never repeat across restarts). */
  counter: string;
  requesters?: ReturnType<Requesters["snapshot"]>;
}

export const initialState = (scope: string): KeeperState => ({
  version: 1,
  scope,
  ...initialJournal(),
  counter: (BigInt(Date.now()) * 1000n).toString(),
});

export function validateState(value: unknown, scope: string): KeeperState {
  const s = value as KeeperState;
  validateJournal(s);
  if (
    s.version !== 1 ||
    s.scope !== scope ||
    typeof s.counter !== "string" ||
    !/^[0-9]{1,28}$/.test(s.counter) ||
    (s.halted !== undefined && typeof s.halted !== "boolean") ||
    (s.checkpoint !== undefined &&
      (!Number.isSafeInteger(s.checkpoint.at) || !Number.isFinite(s.checkpoint.nav)))
  )
    throw new Error("Invalid world keeper state; do not silently reset risk limits");
  return s;
}

export class StateFile extends OperatorStateFile<KeeperState> {
  constructor(path: string, scope: string) {
    super(
      path,
      (value) => validateState(value, scope),
      () => initialState(scope),
    );
  }
}
