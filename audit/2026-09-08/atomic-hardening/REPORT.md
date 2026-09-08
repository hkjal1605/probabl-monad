# Atomic execution v2 — hardening and security re-review

Date: 2026-09-08. Reviewer: repository implementation agent, not an independent auditor.
Status: the implementation findings below are fixed and verified within the stated scope.
This is not whole-program formal verification, a zero-bug guarantee, or public-production approval.

## Conclusion

The rejected-recipient, callback interference, final-state cap, bounded stale-recovery and
first-party quote concurrency issues are addressed across contracts, planner, API, shared
PostgreSQL projections, indexer, reconciler, UI, bindings and deployment tooling. No protocol
matcher, trading signer or local SQLite store is introduced. Users still authorize and pay
for their own atomic placement transaction. Approvals can require a separate transaction.

The final tests found no unresolved new custody exploit in these changes. Whole-service
100% coverage remains **incomplete**, and M-02/dependency exceptions remain deferred as
requested. Hosted infrastructure, actual wallet-extension acceptance and RH sequencer
execution were not deployed or verified by this task. No upstream transactions were sent.

This report supersedes the [initial atomic-placement report](../atomic-placement/REPORT.md)
for the changed execution/recovery behavior. Earlier reports and failed intermediate test
artifacts remain historical evidence; their counts do not describe this revision.

## Scope and source identity

Follow-up on 2026-09-08: at the owner's request, the API-only tester-wallet gate
and its environment/runbook requirements were removed. Administrative permissions,
wallet authentication, ownership and trading safety checks remain unchanged. The
API suite passed 26 tests (375 assertions, zero failures), including chain-4663
buy/sell GTC/IOC preparation by unrelated authenticated wallets and rejection of
unauthenticated or wrong-owner requests. This follow-up used isolated local
PostgreSQL and mocked chain responses, not live mainnet execution. API typechecking
and Biome checks passed. The inventory and broader campaign below describe the
preceding hardening snapshot, not these subsequent API/configuration edits.

Review focused on the settlement/escrow/fee kernel, new vault, checked router, final-state
exposure accounting, quote selection/revalidation, recovery authorization, database write
paths and rollback, reconciliation, UI transaction binding, lifecycle/configuration wiring
and stream shutdown. Existing contract and service regression suites were rerun. This is
not a claim of exhaustive re-auditing of every dependency or every unchanged UI component.

The [source inventory](source-snapshot.json) records 394 source/config/test files discovered
under apps/packages/services, including per-file SHA-256 hashes. It is a reproducibility
inventory, not a coverage percentage. Contracts match the final real-token fork evidence:

```text
contract source digest: 59cf66d386d2310dc5aae9844919017f56ee997cfd708be899bb5637227b3593
workspace inventory:   a90b6afe4083d74c580d72b49d7fc67721285a75fb3a5162dd1f6cc8ceece856
Solidity: 0.8.30, Paris, via-IR, optimizer 7500, metadata hash disabled
```

## Findings resolved

| ID | Issue / impact | Change and regression evidence |
| --- | --- | --- |
| AH-01 | A rejecting or gas-consuming recipient could block a valid maker and therefore first-party best-price execution. | `PayoutVault` stages assets, isolates each delivery in a bounded reverting frame and credits only the failed leg. Tests cover one/both parties rejecting, gas exhaustion, large revert data, ERC-20 false-after-transfer, short transfer, partial withdrawal, unauthorized/double withdrawal and reentrancy. |
| AH-02 | A callback from an earlier fill could invalidate a later maker before the rest of the plan executes. | Every fill/refund is accounted for and staged before recipient callbacks. The nonce-poisoning regression now settles the complete reviewed plan; the changed nonce only affects future orders. Invalid funding/leg/cap failures still roll back the entire transaction. |
| AH-03 | Gross admission caps rejected risk-reducing matches when the book was saturated. | Caps apply to final resting exposure, including maker reductions, self-maker wallet reductions, GTC remainder and zero IOC resting exposure. Full initial funding and per-order limits are retained. Saturated full/partial/GTC/IOC cases and rollback above final caps pass. |
| AH-04 | Expired or nonce-invalid reservations could consume cap space indefinitely. | Bounded indexed discovery and checked same-market release of up to 32 stale orders, prioritizing needed wallet space. Live unrelated orders cannot be cancelled. Duplicate/oversized input, wrong market, terminal idempotency and permissionless recovery tests pass. Explicit recovery stays available during trading freezes. |
| AH-05 | Concurrent first-party quotes or changed fee eligibility could invalidate best-price selection or silently leave a different remainder. | Checked calls bind admission sequence, exact current maker/taker rates, makers, quantities, remainders, releases and an exclusive deadline bounded by maker expiries. API transaction preparation recomputes and compares the complete canonical price/FIFO plan. A same-block race between two independently signed API transactions accepts one and reverts the stale loser. No automatic rest-only or worse-maker fallback. |
| AH-06 | Deferred assets need exact ownership projections without double-counting supply or surviving orphaned withdrawals. | Outstanding-only credit rows in `packages/db`; full withdrawal deletes the row. Ponder owns reversible writes and reorg rollback. Aggregate liabilities/backing and deep beneficiary checks use canonical snapshots. Missing events, wrong beneficiaries and backing shortages trigger critical findings. A real-token withdrawal reorg restores credit, and independent replay produces the same projection. |
| AH-07 | Unsolicited ERC-20 surplus could force global reconciliation freezes despite no shortage. | Exchange/settlement/position-router whole-token surplus and CTF collateral surplus/redemption dust are warnings. Shortages and unexpected conditional-claim custody remain critical. Donation-vs-shortage regressions pass; surplus is not assigned to users or made sweepable. |
| AH-08 | UI recovery/position actions accepted insufficiently bound server transaction fields; position inputs used confusing raw units. | Payout, cancellation/release, merge/redemption and operator approvals are reconstructed locally and matched exactly to chain/from/to/value/calldata. Position and withdrawal inputs use exact human-unit parsing; APIs/contracts still receive raw integers. Tampered transactions and uint256 boundary tests pass; browser merge converts 100 USDG to exactly 100000000 raw units. |
| AH-09 | A public Polymarket WebSocket could retain timers/reads through service shutdown. | Coalesced reads, explicit timer/subscription cleanup, draining of in-flight sends, and suppression of late source opens/messages. A subprocess test keeps a public client connected during SIGTERM and observes natural successful exit without forced termination. |
| AH-10 | Tiny fee-carry fills can produce zero net claims; child-vault identity needs reproducible deployment verification. | Zero payout slots are skipped without trying to fund zero assets. The exchange's vault pointer is constructor-only storage with no setter, allowing reproducible runtime verification; child creation is recorded under its parent deployment. Forbidden protocol recipients, fresh graph wiring, fee administration and tampered runtime/roles are tested. |

### Vault authorization and payout mechanics

The vault is non-upgradeable, created by the exchange and bound to the canonical CTF.
Only the fixed exchange/settlement can stage assets; only the fixed exchange can deliver
unallocated backing. Existing liabilities are excluded from available backing. There is
no admin withdrawal, sweep, arbitrary call, delegated beneficiary withdrawal or expiry.

For example, if a buyer accepts their stock claims but a seller rejects their USDG claims,
the buyer receives their claims in the same transaction and only the seller's failed
USDG-claim leg remains credited. If both reject, each has its own credit. Complementary
claims, price-improvement and escrow-refund legs are isolated independently. Fees retain
their existing received-claim accounting; vault withdrawal introduces no extra protocol fee.

Each automatic attempt uses 100,000 gas, copies no recipient-controlled returndata into
the outer call and checks sufficient outer gas before starting. A failed inner transfer
rolls back even when an ERC-20 moved funds before returning false. There are at most 193
payout slots (32 fills × 5, 32 stale releases, one IOC refund). Explicit beneficiary
withdrawal supports exact partial amounts and an alternate destination without that stipend;
failure restores the credit. Network gas is still payable.

The design follows the receiver rejection behavior in [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155),
accounts for [EIP-150 call-gas limits](https://eips.ethereum.org/EIPS/eip-150), and uses the
pinned [OpenZeppelin SafeERC20 implementation](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20#SafeERC20).
Those specifications are not a proof of this implementation.

## Verification

| Check | Final result |
| --- | --- |
| Foundry CI profile | **194 passed, 0 failed**, 26 suites; fuzz tests configured for 10,000 runs. |
| Stateful invariants | Five campaigns, each 1,000 runs × 128 depth: **640,000 handler actions**, no unexpected reverts. Includes independent beneficiary-credit/backing ghost accounting. |
| TypeScript/service/PostgreSQL tests | **228 passed, 0 failed, 1 opt-in fork test skipped**, 55 files, 4,127 assertions. The fork was then run separately and passed. |
| Static checks | Whole-workspace typecheck, Biome (373 files including final evidence), Forge format/lint, executable rebuild, bytecode sizes and `git diff --check` passed. Generated bindings synchronized. |
| Scoped formal arithmetic | **17 Z3 lemmas proved**: 9 escrow/rounding/cap lemmas, 3 atomic bounds, 5 payout/withdrawal/backing bounds. Negated properties UNSAT with Z3 5.1.0. CI includes all three scripts. |
| Deployment rehearsal | **16 checks passed**, including fresh graph, child vault/runtime verification, initial zero/admin-updated fees, settlement, fee claim/redemption, role handover and tampered bytecode/operator rejection. |
| Final isolated full stack | **8 checks passed**, standalone entrypoints, GTC/IOC/empty and partial IOC, freeze/recovery/restart and both production frontend builds. [Evidence](stack-result.json). |
| Storage/restart/reorg regression | **17 checks passed** in the storage-enabled stack; bounded idle state, SIGKILL durable restart, shallow reorg, independent replay and production frontend starts. [Results](storage-stack-result.json), [measurements](storage-evidence.json). |
| Final real-token RH Anvil fork | **78 checks passed, 772 local transactions, 0 upstream transactions** with USDG/NVDA/TSLA; 48 branch/funding/resolution lifecycles, same-block API race, smart-wallet deferred payout, authenticated partial withdrawal and withdrawal reorg/replay. [Exact source/block/token evidence](../atomic-placement/real-token-evidence/2026-09-08T14-13-59.035Z/result.json). |
| Browser | Production UI against the owned local stack: rejected withdrawal has no broadcast; ERC-1271 smart wallet claims 200 → 100 → 0 USDG claims to an alternate address; bound approval + 100 USDG merge; expired order releases escrow while retaining 1/2 fill history. Demo cancellation emits no chain transaction and excludes live vault UI. [Receipts](browser-evidence.json). |

Final deep real-token reconciliation at block `57753298` was `ok`, projection version 3,
zero issues and no freeze. Independent replay matched projection hash
`0x3b78fa80e751522ee3d3b522a27b4712362e77f979b89490ff806f84f4c6f862`.
See [reconciliation](../atomic-placement/real-token-evidence/2026-09-08T14-13-59.035Z/fullstack-reconciliation.json)
and [race/withdrawal receipts](../atomic-placement/real-token-evidence/2026-09-08T14-13-59.035Z/fullstack-payout-race.json).

The storage run preceded the last recipient-address/duplicate-input validation and UI
position-action refinements; its persistence algorithm is unchanged. It retained 64 anchors
and 65 cached blocks in its low-retention fixture. Paced bounded/baseline p95 lag was 20
blocks for both; three catch-up bursts passed the configured 10% plus 1-second aggregate
tolerance. Physical PostgreSQL relation bytes still fluctuate with MVCC/autovacuum; bounded
logical idle rows do not imply a byte-for-byte constant database size. These local figures
are not an Aurora or production RPC capacity guarantee. Final non-storage stack and final
real-token/replay tests include the final application/contract revision.

Final deployed runtime sizes: exchange **23,733 bytes** (843 bytes below EIP-170),
atomic router **10,650**, settlement **8,282**, payout vault **6,008**. The exchange has
limited remaining runtime margin; recheck sizes for every subsequent Solidity change.

### Formal-method and coverage limits

The Z3 checks prove bounded integer specifications under stated assumptions, not Solidity
bytecode, callback isolation, receiver availability, signature security, CTF cryptography
or whole-program correctness. Stateful testing explores many histories but is not exhaustive.

The strict whole-service coverage inventory exits **1**, intentionally. Its complete
[coverage report](coverage-summary.json) records unmeasured entrypoints/handlers and
uncovered branches. Numeric totals below apply only to measured modules, not the entire
service; subprocess integration coverage is separate and is not silently added to LCOV.

| Measured component | Executed/instrumented lines | Called/instrumented functions | Whole-service 100% |
| --- | --- | --- | --- |
| API | 1,683 / 2,253 | 158 / 204 | Not attained |
| Polymarket ingestor | 617 / 684 | 96 / 119 | Not attained |
| Indexer/reconciler | 648 / 819 | 52 / 72 | Not attained |
| Shared DB package | 2,012 / 2,259 | 274 / 320 | Not attained |

Important gaps include API admin-chain/entrypoint coverage, Ponder handlers/bootstrap
instrumentation, error branches in API/reconciliation and operational query modules.
The full-stack/replay tests execute several of these paths but do not establish 100%
line/branch coverage. The earlier whole-service 100% request is not marked complete.

## Accepted boundaries and remaining release work

- **No contract best-price proof:** explicitly accepted by the owner. External callers may
  choose counterparties within signed limits. The API selects confirmed best-price/FIFO and
  fails closed on pending new admissions. Sequence guards are not reservations or protection
  against every reorg restoring older liquidity. No background matcher clears crossed books.
- **Bounded work and races:** quotes can expire or lose a race and consume gas on revert.
  More than 32 makers or 32 needed releases requires smaller trades/explicit cleanup.
  Best-price preservation favors refresh/review over silently choosing a different trade.
- **Beneficiary and issuer capabilities:** a recipient contract must be able to authorize a
  withdrawal. ERC-165 cannot prove that; an uncontrollable contract can strand its own credit.
  Token-wide pause/blacklist/funding/splitting restrictions cannot be bypassed. Delivery may
  defer an expensive legitimate receiver; explicit withdrawal can supply more gas.
- **M-02 remains deferred:** the inherited legacy CTF collection-hash assurance requirement
  was not fixed by this work. Independent specialist/external review remains necessary for
  public production; owner-authorized internal experiments are not an onchain restriction.
- **Dependency advisories remain deferred:** the previously recorded 11 unresolved transitive
  advisories were not remediated or rescanned as a claim of safety in this task.
- **Hosted acceptance still required:** production PostgreSQL/Aurora failover/backup,
  actual archive-provider limits, secrets/multisig roles, DNS/TLS/private services, real wallet
  integration and a tightly limited RH canary. Anvil is not the RH sequencer or issuer backend.
- **Testing assurance:** close the measured/unmeasured coverage gaps if retaining a literal
  100%-coverage release requirement. Review fixed stipend/transaction-size behavior with
  supported production smart wallets. Independent review should prioritize callback isolation,
  liabilities under reorg, final-state caps and the pinned external CTF/token assumptions.

## Deployment and operation changes

Use a **fresh complete contract graph**; the exchange creates its vault. Runtime deployment
verification checks the fixed exchange/settlement/CTF/vault wiring and execution version.
Set `PAYOUT_VAULT_ADDRESS` in API/indexer/reconciler environments, and build the public UI
with `NEXT_PUBLIC_PAYOUT_VAULT_ADDRESS` and `NEXT_PUBLIC_POSITION_ROUTER_ADDRESS`.
Market/raw-unit version remains 2, signed-order EIP-712 domain remains 3, atomic execution
becomes 2 and reconciliation projection becomes 3.

Use a fresh Ponder projection namespace for the credit table and partial stale-order
indexes, within the **same shared production PostgreSQL database**. Preserve operational
auth/evidence schemas. Do not reinterpret previous test projections as this new format.
The optional Cloudflare readiness checks were synchronized using the Cloudflare skill;
normal UI deployment still does not force the previously disabled environment preflight.
Playwright was used for actual browser interaction with the production local UI, with
test-only injected providers; no live wallet was used.

Recovery remains available during trading freezes. See the [implementation/interfaces](../../../docs/architecture/atomic-hardening.md),
[direct recovery runbook](../../../docs/runbooks/direct-recovery.md) and
[internal deployment runbook](../../../docs/runbooks/internal-mainnet-testing.md).
No contracts, hosted services, DNS or production database were deployed or changed here.
