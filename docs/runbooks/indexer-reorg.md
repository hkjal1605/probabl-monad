# Indexer reorg runbook

Ponder automatically detects canonical-chain changes, rolls back handler writes, and replays the
replacement branch. The operational task is to keep downstream state and trading safety aligned
with that canonical projection.

## Normal shallow reorg

1. Ponder rolls affected rows back. Do not restart it or edit its database during convergence.
2. A matcher request carrying an orphaned `afterBlockHash` receives HTTP `409` with
   `error=cursor-reorged`, the canonical hash (if known), and `rewindToBlock`.
3. Stop proposal creation, rewind the matcher's durable journal/checkpoint to that block, and replay
   the confirmed stream. Unconfirmed events were never exposed by this API.
4. Wait until `/indexer/health` advances on the canonical branch and head age is normal.
5. Run deep reconciliation. Resume matching only if no freeze signal exists and direct contract
   state agrees.

Do not submit a proposal created from orphaned order state, even if its signatures remain valid.
Onchain validation is the final backstop, not a substitute for canonical matcher input.

## Deep or finality-violating reorg

Treat any reorg at or below the configured finalized head, repeated cursor oscillation, or an RPC
provider disagreement as a critical incident:

- stop order intake and settlement submission globally;
- preserve cancellation, release, merge, and redemption access;
- compare block hashes across independently operated RPC providers;
- retain Ponder/reconciler logs and matcher journal checkpoints;
- identify the common canonical ancestor and perform a clean pinned rebuild;
- require operations/security approval before resuming.

Never lower confirmation/finality settings during an incident to make the service appear current.
Tune them only through a reviewed chain-risk change after Robinhood Chain behavior is measured.

## Recovery evidence

Record the orphaned range and hashes, replacement range and hashes, matcher rewind point, Ponder
head, clean reconciliation report/hash, affected transaction proposals, and operator approvals. If
an onchain fill landed on the canonical branch, it remains authoritative regardless of the old
offchain proposal status.

