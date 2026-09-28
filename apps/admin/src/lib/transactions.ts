import {
  type AdminDeployment,
  type AdminTransaction,
  evidenceTransactions,
  type PacketEnvelope,
} from "@conditional-stocks/evm-client/admin";
import type { AdminPreview, EvidenceView } from "./admin-api";

/** Base tokens whose custody pools the packet's transactions depend on. */
export const packetTokens = (packet: EvidenceView) =>
  packet.envelope.packet.kind === "market-creation"
    ? [packet.envelope.packet.config.baseToken]
    : [];

/** The transactions an approved packet authorizes for `action`, built locally. */
export function evidenceTransaction(
  view: EvidenceView,
  action: AdminPreview["action"],
  deployment: AdminDeployment,
) {
  if (view.status !== "approved" || view.reviews.at(-1)?.decision !== "approve")
    throw new Error("Explicit market-admin approval is required");
  return evidenceTransactions(view.envelope as PacketEnvelope, action, deployment);
}

const same = (a: AdminTransaction, b: AdminTransaction) =>
  a.chainId === b.chainId &&
  a.from.toLowerCase() === b.from.toLowerCase() &&
  a.to.toLowerCase() === b.to.toLowerCase() &&
  a.data.toLowerCase() === b.data.toLowerCase() &&
  a.value === "0" &&
  b.value === "0";

/** The API's preview must equal what this console builds from the approved evidence and the
 * live deployment: every prerequisite, then the action itself. Returns them in signing order. */
export function verifyAdminPreview(
  view: EvidenceView,
  preview: AdminPreview,
  deployment: AdminDeployment,
) {
  const { transactions } = evidenceTransaction(view, preview.action, deployment);
  const remote = [...(preview.prerequisites ?? []), preview];
  if (
    preview.packetHash !== view.envelope.packetHash ||
    remote.length !== transactions.length ||
    transactions.some((transaction, i) => !same(transaction, remote[i]!))
  )
    throw new Error("API transaction differs from the approved evidence and the live deployment");
  return transactions;
}
