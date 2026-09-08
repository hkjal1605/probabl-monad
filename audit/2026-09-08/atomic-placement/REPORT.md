# Permissionless atomic placement — implementation and security verification

Date: 2026-09-08. Reviewer: repository implementation agent (not an independent auditor).

**Historical revision:** checked execution v2, deferred payouts, final-state caps and
stale recovery supersede relevant findings/limitations below. Use the [current hardening
report](../atomic-hardening/REPORT.md) for the final source identity and verification results.

## Conclusion and scope

The API now discovers candidate matches; the user's wallet broadcasts one
`AtomicOrderRouter.placeAndMatch` transaction that opens, fills, and, for IOC,
refunds the order atomically. The protocol-owned matcher and trading settlement
worker have been removed. The router has no privileged trading role or funds
custody. Existing raw-unit settlement, received-claim maker/taker fees, recovery,
manual resolution, and reconciliation remain in use.

This review covers the changed contracts, planner, API, database/indexer, UI
transaction construction, and their deployment/runtime wiring. Existing contract
tests and accounting invariants were rerun alongside new adversarial tests.
The checks found no unresolved new custody exploit in this change. That statement
is bounded by the review and tests below: it is **not** a zero-bug guarantee,
whole-program formal verification, independent audit, or public-production approval.
The existing M-02 external-audit requirement and previously deferred dependency
advisories remain deferred, not fixed by this work.

## Architecture and authorization

```text
canonical PostgreSQL/Ponder order book
  -> API price/FIFO candidates + validation + complete-call simulation
  -> UI reconstructs and checks the reviewed calldata
  -> owner's wallet broadcasts AtomicOrderRouter.placeAndMatch
     -> exchange opens and escrows the signed order
     -> existing settlement kernel fills each selected resting maker
     -> GTC rests, or IOC cancels/refunds the remainder
  -> Ponder indexes events -> UI/order book + reconciler
```

The router requires the caller to be the order maker, including an ERC-1271 smart
wallet executing its own transaction. Anyone may trade their own order; no
protocol key authorizes settlement. Possessing an EIP-712 order signature alone
does not authorize a third party to strip or change the reviewed execution plan.
The exchange's opening and matching entrypoints accept only its configured-once
router. Recovery remains available through its separately scoped existing paths.

Each plan is bounded to 32 distinct resting GTC makers, same market and branch,
opposite side, positive quantities, and an aggregate no greater than the incoming
order. Exact expected maker remainders are checked before funding and before each
leg. Execution uses existing signed-price crossing, earlier-order price, expiry,
nonce, fee-cap, reservation, and pause/cutoff checks. Failure of any leg reverts
the complete transaction, including earlier fills, fees, and cap changes.

The API binds chain/router/exchange identity, uses canonical snapshot anchors,
reads current fee configuration at one execution block, and simulates the exact
owner call. The browser independently binds order typed data, approval spender
and amount, router, sender, chain, ETH value, calldata, and order hash. No trading
transaction is queued or broadcast by the API. A required token approval is still
a separate wallet transaction unless already granted.

## Findings addressed during this implementation

| Area | Protection or correction | Verification |
| --- | --- | --- |
| Privileged matching / leaked order signatures | Owner-broadcast router; no matcher role; permanently bound exchange/router | Authorization, signature replay, foreign callers, ERC-1271, deployment identity tests |
| Stale and malformed match lists | Exact remainders, bounded and unique legs, array checks, safe aggregate type | Stale/cancelled/expired/nonce-invalid makers; 32/33 boundary; malformed plans; fuzzing |
| Callback interference and partial settlement | Reentrancy guard, per-leg rechecks, existing settlement protections, full rollback | Reentrant/rejecting recipients; callback nonce invalidation of a later maker; late-leg failure |
| Raw amounts and trading fees | Existing floor-execution/ceil-reservation kernel and signed received-claim fee caps retained | Both sides/branches/funding modes; fee changes; cap boundaries; real 6/18-decimal tokens |
| Candidate starvation and unbounded queries | Filter invalid makers before bounded price/FIFO index scan; explicit oversized-sweep rejection | Invalid candidates ahead of valid rows; 100,000 historical orders; query-plan index assertions |
| API or UI transaction substitution | Exact local reconstruction and full-call simulation, with no unsafe fallback | Modified chain/from/to/value/data/hash/version; failed simulations; no trading broadcast or outbox writes |
| Cancelled-order history overreported fills | Accumulate `protocol_order.filled` in existing order updates; UI uses executed units instead of quantity minus cleared remainder | Empty and partial IOC integration, cancelled GTC real-token integration, database history regression, real browser review |
| Obsolete durable work retired unsafely | Migration locks and pending-work guards before dropping retired tables; auth/recovery state preserved | All 13 pending-state cases reject atomically; existing auth sessions and cancellation outbox survive |

The order-history issue was discovered in the final real-browser test: a
quantity-2 IOC filled 1 and refunded 1, but the old UI displayed 2/2 because
cancellation sets `remaining` to zero. Receipts and collateral were correct.
The correction adds one necessary indexed scalar, not another history table or
per-request aggregate query. Ponder replay/reorg semantics cover this field too.

## Verification results

- Solidity: **165 passed, 0 failed, 23 suites** under the CI profile after a full
  artifact rebuild. The new atomic fuzz test ran 10,000 cases. Four stateful
  invariant campaigns each ran 1,000 sequences of depth 128: 512,000 total handler
  calls with no handler reverts. Some older tests explicitly pin their own lower
  fuzz counts; 10,000 is not claimed for every fuzz test.
- TypeScript/PostgreSQL: **215 passed, 0 failed**, plus one opt-in real-token fork
  test skipped in the ordinary suite and run separately. 216 tests across 51 files,
  3,664 expectations. Includes API HTTP/JSON-RPC checks, planner permutations,
  raw units, UI transaction binding and demo behavior, actual PostgreSQL query
  plans, privilege boundaries, concurrency, and migration rollback.
- Scoped arithmetic proofs: existing **9** accounting properties and **3** new
  atomic sum/remainder properties return UNSAT for counterexamples under their
  stated assumptions using Z3 5.1.0. These prove integer specifications, not the
  entire Solidity/EVM implementation. See [atomic proof](prove-atomic-bounds.py)
  and [existing accounting proof](../../2026-09-06/remediation/verification/prove-accounting.py).
- Contract runtime sizes: router **5,233 bytes**; exchange **23,216 bytes**, leaving
  **1,360 bytes** below the EIP-170 runtime limit. No contract exceeds that limit.
- Workspace TypeScript checks, Biome, Solidity formatting/lint, generated bindings,
  and production builds of both frontends were checked. No mainnet transaction,
  AWS change, or Cloudflare deployment was performed.

### Integration evidence

See [local stack result](stack-result.json), [storage/restart measurements](storage-evidence.json),
and [real-browser receipts](browser-result.json). Local tests use owned loopback
Anvil/PostgreSQL instances and disposable accounts, not an existing user database
or real wallet. Browser testing uses isolated Firefox with a loopback-only
injected provider; it does not certify every commercial wallet extension.

The stack exercises GTC, fully and partially filled IOC, empty IOC, indexed
history, API intake freezing during reconciliation failure with direct
cancellation still available, persisted reconciler/indexer restarts, SIGKILL,
1,280 idle blocks, a bounded 64-slot block ring, isolated bounded sync caches,
shallow reorgs, evicted anchors, clean replay, and both production frontends.
The storage evidence includes measured catch-up performance and the existing
10%-plus-1-second aggregate polling tolerance; passing that test is not a claim
of literally zero overhead or unbounded production throughput.

The real-token fork suite uses unchanged deployed USDG (6 decimals), NVDA and
TSLA (18 decimals) implementations, actual token-holder state, a pinned Robinhood
mainnet block (chain 4663), and a deny-write upstream proxy. It covers 48 exchange/redemption
lifecycle combinations, actual HTTP preparation and wallet execution with UI
helpers, indexing, deep reconciliation, and independent replay. It is not a
mainnet deployment or a guarantee about future issuer controls or RPC availability.
The latest completed evidence directory is linked in the final verification
record below. Earlier failed environmental runs are retained rather than
presented as successful: an unavailable historical RPC state pin and host disk
exhaustion were followed by successful fresh-pin/external-scratch reruns.

### Coverage limitation — not waived or hidden

The ordinary Bun LCOV run measures 100% line coverage for the new atomic planner
(112/112), UI atomic transaction binding (101/101), and gateway parser module
(373/373). The planner's error constructor is not counted as called, so its
function coverage is 4/5, not 100%. UI binding is 6/6 functions; gateway is 22/22.

The inventory-aware whole-service coverage gate **still fails**. Measured lines:
API 1,462/1,941; Polymarket ingestor 580/643; indexer 271/749; database 1,896/2,144.
There are also unmeasured entrypoints and Ponder virtual-runtime handlers.
Full-stack child-process execution is not merged into Bun's LCOV report. These
denominators therefore are not whole-service coverage percentages. The gate has
not been weakened or disabled; all-service 100% coverage is an outstanding
verification goal, not a completed claim.

## Intentional limits and residual risks

1. **No global best-price, FIFO, or completeness enforcement onchain.** The API
   selects by price/FIFO, but contracts verify validity only. A custom caller can
   choose a different valid counterparty; a compromised API can omit liquidity
   within the user's signed limits. The UI verifies its reviewed list, not the
   entire global book.
2. **Concurrent quotes can leave crossed resting orders.** There is no background
   resting-versus-resting sweep after the matcher is removed. Later incoming
   orders can consume those resting orders; owners can cancel and re-place.
   This design does not promise automatic complete book clearing.
3. **Quotes do not reserve liquidity.** API quotes last at most 60 seconds. A fill,
   cancellation, expiry, nonce invalidation, fee-cap breach, reorg, pause, or token
   restriction can invalidate a plan after simulation. Execution fails atomically,
   but reverted transactions still cost gas. The user must refresh; no silent
   rest-only fallback or automated fee-paying retry exists.
4. **Sweeps are bounded to 32 makers.** If the reviewed book requires a 33rd leg,
   preparation rejects explicitly; the user can reduce quantity and retry. It
   does not secretly truncate a crossing order into a resting remainder.
5. **Admin/issuer and operational risks remain.** Existing admins can pause or
   resolve markets and change fees subject to contract limits. Token issuers may
   freeze or restrict transfers. RPC/indexer/API liveness and accurate deployment
   configuration still matter. Simulation is not a future-inclusion guarantee;
   account-local risk caps are not Sybil resistance.
6. **Independent audit and full coverage remain outstanding.** Test and proof
   scope does not justify an assertion of zero exploitable bugs. Mainnet,
   infrastructure high availability, and provider/wallet interoperability require
   their own deployment verification and monitoring.
7. **Probability-feed shutdown needs a separate operational check.** One restored
   test ingestor remained alive after SIGTERM during final cleanup and was
   force-stopped by its exact task-owned PID. Its cause was not established in
   this atomic-trading change. Do not infer graceful-shutdown or unattended-HA
   certification from the functional trading tests; verify supervisor timeouts
   and feed shutdown under open connections before production deployment.

## Retired code and deployment changes

Removed runtime source includes `services/matcher`, `services/settlement-worker`,
the old in-memory matching engine/heaps and matching journals, the IOC-only router,
matcher role and signer configuration, trading settlement queues and nonce
allocator, and their obsolete scripts/endpoints. `packages/orderbook` remains as
the stateless quote planner and canonical serializer, not a running service.
Historical audits and applied migrations 0000–0003 remain intact. Removed tracked
source can be recovered from Git history; no existing user database was dropped.

Deploy a fresh compatible contract set using the updated scripts; configure its
router once, then verify all runtime identities. Set `ATOMIC_ORDER_ROUTER_ADDRESS`
for backend components and `NEXT_PUBLIC_ATOMIC_ORDER_ROUTER_ADDRESS` for the UI.
Order EIP-712 remains v3 with signed fee caps; market/raw-unit protocol remains v2;
atomic execution version is 1. There is no matcher wallet/key to provision.

Apply operational migrations 0004 and 0005 only after backing up and satisfying
their pending-work guards; do not bypass a failed guard or discard unfinished
work. Replay Ponder into a new projection schema to adopt the removed matcher
journal and added executed-quantity field, while preserving shared operational
schemas. Follow [deployment runbook](../../../docs/runbooks/internal-mainnet-testing.md)
and [shared PostgreSQL runbook](../../../docs/runbooks/shared-postgres.md).
The optional Cloudflare strict preflight now checks the router, but default UI
deployment still does not require the optional environment validation step.

## Final verification record

All integration results below include the executed-quantity history correction.

- [Final real-token result](real-token-evidence/2026-09-08T11-38-34.228Z/result.json):
  **77 checks, 766 local transactions, zero upstream transactions**. Pinned RH
  mainnet block **57,660,734**, hash
  `0xd0996b3c80a42431439162dd6c728e24aed1918d5bb20527f6cb3e91afb72f84`.
  The fork test completed successfully in approximately 68 seconds. Both stock
  full-stack records also verify that cancellation preserves the actual fill total.
- [Final stack result](stack-result.json): **16 checks passed**, including the
  added partial-IOC history regression and both production frontend builds.
  Completed at 11:45:27 UTC. Bounded versus baseline paced lag: mean 12.573 versus
  12.487 blocks, p95 21 versus 21, max 22 versus 22. Three 256-block catch-up
  bursts totalled 54.431 versus 51.180 seconds, inside the recorded tolerance.
- [Final browser result](browser-result.json): both owner-broadcast transactions
  succeeded. The IOC receipt contains opening, filling, and remainder cancellation
  together. Canonical and rendered history retain **1 filled / 2 ordered**;
  the empty IOC history check shows **0 / 1**. The initial browser run, including
  sub-step rejection, is retained in [initial evidence](browser-initial-result.json).
- Storage benchmarking intentionally pauses the API, reconciler, and ingestor.
  In the already-running rehearsal those services were restored separately after
  testing; API `/ready` returned 200 and deep reconciliation was clean before
  the final browser orders. The harness now restores those services and the
  mining clock itself before its frontend/hold phase. While paused, browser
  readiness correctly blocked trading and logged upstream-unavailable errors.
  After restoration/reload the IOC flow had no browser errors; untracked mock
  probability-stream warnings remained informational.
- Contract source digest matches the final workspace:
  `762f0de54a356e67450a4511a604018b1e3eeaf52c1e71721c7ca28e5d4c40f8`.
  The evidence's lock hash also matches:
  `fd7be154f1cd8dfd0b55be0a18dd4e99d2ca5750b42a8393bcebc45d6f4e650b`.
  Regenerating contract bindings produced identical output.

### Reproduction

Use disposable test infrastructure only. PostgreSQL binaries, Bun, Foundry, and
the repository's installed dependencies are required. `TMPDIR` can point to a
roomy existing scratch directory; do not supply a production `TEST_DATABASE_URL`.

```sh
forge build --root packages/contracts --no-cache
FOUNDRY_PROFILE=ci forge test --root packages/contracts
bun run typecheck
bun packages/db/scripts/test.ts --coverage --coverage-reporter=lcov --coverage-dir=coverage/atomic-placement
RUN_ATOMIC_FORK=1 bun packages/db/scripts/test.ts packages/contracts/scripts/atomic-fork.test.ts
bun packages/contracts/scripts/verify-internal-stack.ts --storage --production-ui
bun packages/db/scripts/coverage-report.ts coverage/atomic-placement/lcov.info
```

The last command deliberately remains nonzero until whole-service coverage is
complete. For scoped proofs, use Python with `z3-solver==5.1.0.0` to run the two
linked scripts. For formatting, use `bunx --no-install biome check .` and
`forge fmt --root packages/contracts --check`. If running Forge lint, regenerate
full artifacts afterwards before testing: lint can leave ABI/AST-only artifacts
that cause an incremental test invocation to omit suites. The CI workflow already
performs that full rebuild.
