/** The world vault's marker (docs/version-2-plan.md §6, §10.5): it closes the open batch once it
 * is due and holds requests, and marks each closed batch at the vault's value then.
 *
 * The value is the vault's credit at the close plus every book's atoms at the close, valued at
 * the models' centers (a decided book at its winning atom). It is posted only inside the batch's
 * on-chain bounds [guaranteed, best] and within the per-share move limit; a larger move waits
 * for the guardian's `approveMark` of that exact value, and a batch left unmarked processes at
 * its floor after MARK_TIMEOUT whatever the marker does. Every mark's inputs are stored
 * (`vault_marks`) with their hash, so anyone can recompute it. */
import type { Database } from "@conditional-stocks/db";
import { NAV_SCALE, VAULT_BATCH_PERIOD, worldVaultCalls } from "@conditional-stocks/evm-client";
import {
  atomsOf,
  type VaultState,
  type WorldEvent,
  type WorldState,
  worldCreditOf,
} from "@conditional-stocks/evm-client/world-ledger";
import { canonicalStringify } from "@conditional-stocks/market-data";
import type { Executor } from "@conditional-stocks/operator";
import { type Address, keccak256, stringToBytes } from "viem";
import type { WorldKeeper } from "./engine.ts";

/** The vault at a batch's close: its credit and atoms per book. */
export interface Snapshot {
  batch: number;
  block: bigint;
  credit: bigint;
  holdings: Map<number, bigint[]>;
}

export class WorldMarker {
  /** The latest close seen, captured from the commit that applied it. */
  private snapshot: Snapshot | null = null;

  constructor(
    private readonly options: {
      keeper: WorldKeeper;
      vault: Address;
      db?: Pick<Database, "recordVaultMark" | "vaultMarks">;
      domain: string;
      executor?: Executor;
      log: (event: string, detail?: Record<string, unknown>) => void;
      now?: () => number;
    },
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  /** Captures the vault's holdings when a commit closed a batch of it. */
  observe(s: WorldState, events: WorldEvent[]) {
    for (const e of events)
      if (e.contract === "vault" && e.address === this.options.vault && e.name === "BatchClosed") {
        const v = s.vaults.get(this.options.vault)!;
        this.snapshot = {
          batch: Number(e.args.batch),
          block: e.block,
          credit: worldCreditOf(s, v.address),
          holdings: new Map(
            [...v.positions.keys()].map((id) => [id, [...atomsOf(s, id, v.address)]]),
          ),
        };
      }
  }

  /** The value to mark the closed batch at, its inputs, and whether it can be posted. */
  valuation(s: WorldState, v: VaultState) {
    const id = v.closedBatch;
    const bt = v.batches.get(id);
    if (!id || !bt) return null;
    // A close this process did not see is valued on the current holdings (logged).
    const snap = this.snapshot?.batch === id ? this.snapshot : null;
    const holdings =
      snap?.holdings ??
      new Map([...v.positions.keys()].map((b) => [b, [...atomsOf(s, b, v.address)]]));
    const credit = snap?.credit ?? worldCreditOf(s, v.address);
    const books = this.options.keeper.valuations(s, v, holdings);
    const value = books.reduce((sum, b) => sum + b.value, Number(credit));
    const raw = BigInt(Math.floor(value));
    const nav = raw < bt.guaranteed ? bt.guaranteed : raw > bt.best ? bt.best : raw;
    const next = (nav * NAV_SCALE) / bt.supply;
    const last = v.lastNavPerShare;
    const move = next > last ? next - last : last - next;
    const withinMove = move * 10_000n <= last * BigInt(v.maxMarkMoveBps);
    const approved = bt.approvedMark !== null && bt.approvedMark === nav;
    const inputs = {
      vault: v.address,
      batch: id,
      snapshotBlock: snap ? snap.block.toString() : null,
      credit: credit.toString(),
      books: books.map((b) => ({
        book: b.book,
        atoms: b.atoms.map(String),
        chances: b.chances?.map((x) => Math.round(x * 1e12) / 1e12) ?? null,
        value: Math.floor(b.value).toString(),
        basis: b.basis,
      })),
      value: raw.toString(),
      nav: nav.toString(),
      bounds: { guaranteed: bt.guaranteed.toString(), best: bt.best.toString() },
      supply: bt.supply.toString(),
      computedAt: new Date(this.now()).toISOString(),
    };
    return {
      id,
      nav,
      guaranteed: bt.guaranteed,
      best: bt.best,
      inputs,
      inputsHash: keccak256(stringToBytes(canonicalStringify(inputs))),
      postable: withinMove || approved,
      clamped: raw !== nav,
    };
  }

  /** One round: close a due batch, or mark the closed one. Returns what it did. */
  async round(s: WorldState) {
    const v = s.vaults.get(this.options.vault);
    if (!v) return "unfollowed";
    const nowS = BigInt(Math.floor(this.now() / 1000));
    const calls = worldVaultCalls(this.options.vault);
    const executor = this.options.executor;
    if (v.closedBatch) {
      const mark = this.valuation(s, v);
      if (!mark) return "idle";
      if (!mark.postable) {
        await this.record(mark, null);
        this.options.log("mark-needs-approval", {
          batch: mark.id,
          nav: mark.nav,
          inputsHash: mark.inputsHash,
        });
        return "needs-approval";
      }
      if (!executor) {
        this.options.log("mark-dry-run", { batch: mark.id, nav: mark.nav, clamped: mark.clamped });
        return "dry-run";
      }
      await executor.reconcilePending();
      const hash = await executor.send(calls.mark(BigInt(mark.id), mark.nav));
      await this.record(mark, hash);
      this.options.log("marked", {
        batch: mark.id,
        nav: mark.nav,
        clamped: mark.clamped,
        inputsHash: mark.inputsHash,
      });
      return "marked";
    }
    const open = v.batches.get(v.batchId);
    if (
      open &&
      open.status === 1 &&
      (open.depositAssets > 0n || open.redeemShares > 0n) &&
      nowS >= open.openedAt + BigInt(VAULT_BATCH_PERIOD)
    ) {
      if (!executor) return "dry-run";
      await executor.reconcilePending();
      await executor.send(calls.closeBatch());
      this.options.log("batch-closed", { batch: v.batchId });
      return "closed";
    }
    return "idle";
  }

  private async record(mark: NonNullable<ReturnType<WorldMarker["valuation"]>>, tx: string | null) {
    await this.options.db
      ?.recordVaultMark(this.options.domain, {
        vault: this.options.vault,
        batch: mark.id,
        nav: mark.nav,
        guaranteed: mark.guaranteed,
        best: mark.best,
        inputsHash: mark.inputsHash,
        inputs: mark.inputs,
        tx,
      })
      .catch((error) =>
        this.options.log("mark-record-failed", { reason: (error as Error).message }),
      );
  }
}
