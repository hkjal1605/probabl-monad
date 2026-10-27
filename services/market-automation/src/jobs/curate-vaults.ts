import { getAddress } from "viem";
import { OPEN, SCHEDULED } from "../admin.ts";
import type { Job } from "./index.ts";

/** Waiting markets last logged per vault, so a full vault is reported once per change. */
const waiting = new Map<string, number>();

/** Registers each curated vault's new markets: open (or scheduled) markets on its stock with
 * enough quoting time left, nearest cutoff first, up to the vault's free slots. Its keeper then
 * quotes them over RFQ, and settles them (freeing the slot) once resolved. */
export const curateVaults: Job = {
  name: "curate-vaults",
  everyMs: 60_000,
  async run({ admin, vaults, execute, logger }) {
    if (!vaults.length) return;
    const markets = await admin.markets();
    const now = Math.floor(Date.now() / 1000);
    for (const vault of vaults) {
      try {
        const listed = new Set(await vault.markets());
        const candidates = markets
          .filter(
            (m) =>
              getAddress(m.baseToken) === vault.base &&
              (m.state === SCHEDULED || m.state === OPEN) &&
              !listed.has(Number(m.venue.marketId)),
          )
          .flatMap((m) => {
            const risk = vault.riskFor(Number(m.tradingCutoff), now);
            return risk
              ? [{ market: Number(m.venue.marketId), cutoff: Number(m.tradingCutoff), risk }]
              : [];
          })
          .sort((a, b) => a.cutoff - b.cutoff || a.market - b.market);
        const free = Math.max(0, vault.capacity - listed.size);
        for (const { market, risk } of candidates.slice(0, free)) {
          const fields = { vault: vault.address, market, cutoffBuffer: risk.cutoffBuffer };
          if (!execute) {
            logger.info("curate.due", fields);
            continue;
          }
          logger.info("curate.added", {
            ...fields,
            transaction: await vault.addMarket(market, risk),
          });
        }
        const left = Math.max(0, candidates.length - free);
        if (left !== (waiting.get(vault.address) ?? 0)) {
          waiting.set(vault.address, left);
          if (left) logger.warn("curate.vault-full", { vault: vault.address, waiting: left });
        }
      } catch (error) {
        logger.error("curate.failed", {
          vault: vault.address,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },
};
