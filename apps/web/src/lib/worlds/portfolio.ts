import { dollars } from "./format";
import type { WorldWallet } from "./types";

/** Display-only dollars of a world account: its world balance plus each position at what it is
 * worth now (its maker's marks, or its payout once decided), as My worlds shows them. A position
 * no maker prices at the moment (between trading and its decision, or while makers reconnect)
 * counts at the least it is sure to pay, so the total never claims more than the account holds. */
export function worldPortfolioValue(wallet: Pick<WorldWallet, "credit" | "positions">): number {
  let total = BigInt(wallet.credit);
  for (const p of wallet.positions) total += BigInt(p.value ?? p.minPayout);
  return dollars(total);
}
