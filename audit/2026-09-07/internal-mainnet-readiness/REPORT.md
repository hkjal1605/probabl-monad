# Internal RH mainnet readiness review

Date: 2026-09-07. Protocol: v2, `raw-unit-ratio-x18`.

## Decision and scope

The missing runtime integrations have been implemented and the full stack has passed a controlled local deployment rehearsal with PostgreSQL, real service processes, production-built frontends, and a browser wallet backed by local Anvil. This is a **supervised internal-testing release candidate**, not public production approval or independent formal-auditor certification.

No contracts were deployed to RH and no real assets were moved during this work. The owner explicitly deferred M-02 and the 11 dependency advisories for internal testing. They remain open. There is no historical funded deployment to migrate; use fresh manifests, schemas and durable stores.

The remaining external acceptance gates are the supplied archive RPC, hosted PostgreSQL/backup policy, deployment roles and handover, TLS/private ingress, real wallet/Safe setup, and a tiny funded RH lifecycle after deployment. Do not infer those have passed from a local rehearsal.

## The five readiness items

| Item | Implementation and verification | Status |
| --- | --- | --- |
| 1. Mainnet release gate | Explicit `internal-mainnet` mode and exact risk acknowledgement; manifest retains `productionApproved=false`. Other unsupported chains remain rejected. Runtime policy tests pass. Bytecode/wiring/role checks and the two-day governance handover remain required. | Internal mode implemented; M-02 deliberately deferred, not resolved |
| 2. Continuous matching and settlement | Executable matcher drains canonical history, checks its shadow, delivers durable proposals, polls worker state and restores journals. Worker now automatically plans bounded IOC intents from canonical price-time liquidity; empty IOC terminates without collateral movement. | Verified end-to-end on local PostgreSQL/Anvil |
| 3. Enforced reconciliation/freshness | API intake/replay, matcher proposal delivery, and worker broadcasts consult fresh, deployment-bound reconciliation and canonical indexer state. Missing services, stale/future timestamps, malformed responses/scopes, mismatches and reorged report anchors deny trading. Recovery actions stay available. | Unit, runtime outage and browser checks passed |
| 4. Polymarket sync | Bun WebSocket upgrade correctly registered, close cleanup and quiet-book quality updates added, upstream heartbeat timeout added, book updates validated before mutation. Browser no longer discards quality changes sharing a source hash; disconnected/stale data loses its midpoint. | Real downstream WebSocket test and live upstream smoke passed |
| 5. Finality, complete stack and deployment configuration | RH confirmation/finality derives from RPC tags; stale or unverifiable heads fail closed. Finality is not inferred from a small L2 depth. UI wallet context guards, exact raw signing, server proxy restrictions, production builds/start commands, service commands and environment/runbooks updated. | Local PostgreSQL/browser verification passed; actual infrastructure/RH acceptance pending |

## Additional issues found and fixed during the rehearsal

### Inconsistent reconciliation snapshots

An initial integration rerun produced nine false custody/open-interest issues while a trade was being indexed. Concurrent pooled reads combined older reservation/claim rows with a newer indexed-block marker. The new consistency barrier brackets the multi-query projection with committed head reads, retries if the block/hash changes, and returns unavailable instead of publishing a mixed snapshot. Only then is its anchor checked against RPC. Regression tests cover advancing commits and same-height reorgs.

The PostgreSQL/browser rehearsal subsequently recorded **859 successful reconciliation runs and zero mismatch runs**. The gate correctly stopped trading during deliberate reconciler outages; those outages did not create fake custody discrepancies.

### Durable nonce and receipt recovery

API order submissions are serialized around their dedicated relayer. Preparing a transaction no longer consumes a nonce before signing succeeds: nonce advancement, outbox attempt and operation state are persisted atomically. A background recovery loop checks pending operations and replays the same persisted bytes. Worker preparation similarly persists a complete prepared batch and nonce range atomically.

The worker examines every same-nonce attempt for a receipt, not just the newest replacement. It recognizes an original transaction that wins after replacement preparation, monitors orphaned pre-confirmation receipts again, and rechecks proposal anchors before replay/replacement. Regression tests cover these cases and fail-closed prepared-outbox retries.

Already-confirmed fills removed by a deep reorg still require coordinated incident recovery; the release does not claim unattended recovery of terminal worker records. Never discard nonce/outbox state to make a queue appear healthy.

### Browser and deployment correctness

- The browser signed EIP-712 domain version `2`, `quantity=1000000000000000000` and `limitPriceRawX18=200000000` for one stock at 200 USDG; the order screen displayed `$200.00` and `1.000` stock.
- The resulting local order was indexed, cancelled through the UI during a reconciler outage, and ended with `reserved=0` and canonical cancellation.
- A valid-price order action changed from enabled to disabled during the outage and re-enabled after recovery.
- Admin operator authentication and the six backend health panels worked against actual local services.
- Wallet signing/sending rejects an account or chain changed since the action was prepared. Sign-in uses hex-encoded personal-sign payloads.
- Browser-facing indexer proxies cannot tunnel `/internal/*` routes. Timeout and redirect policies were added at relevant service boundaries.
- The UI's informational probability warning no longer incorrectly claims stock trading is disabled by missing Polymarket data.
- Both frontend configurations now match their standard `next build` / `next start` deployment scripts. This topology deploys the release workspace, not a standalone-only bundle.
- API relayer startup rejects protocol roles; settlement startup requires the configured exchange authority, matcher permission, and no administrative role.

## Verification evidence

| Check | Result |
| --- | --- |
| Full TypeScript suite | 126 passed, 0 failed; 2,822 assertions |
| All workspace typechecks | Passed |
| Biome formatting/lint/import checks | Passed |
| Forge formatting/lint and contract size build | Passed; exchange runtime 23,050 bytes |
| Default Solidity suite | 106 passed, 0 failed |
| Extended Solidity campaign | 106 passed; two invariant suites, 128,000 calls each, zero handler reverts; 10,000-run arithmetic fuzz tests |
| Arithmetic specification | 9 Z3 lemmas proved; solver 5.1.0 |
| Standalone-service PostgreSQL rehearsal | Six end-to-end checks passed, including GTC, IOC, empty IOC, recovery access and restarts |
| Final clean PostgreSQL backend rerun | Six checks passed again at `2026-09-07T08:56:54.137Z`, including updated graceful reconciliation shutdown/restart |
| Deployment/verification rehearsal | 12 checks passed: runtime/wiring/roles, delayed handover, unexpected operator rejection, unsafe delay reduction rejection, CLI creation and exact committed resolution |
| Production frontends | Both built and started successfully; browser flows above passed |
| Polymarket downstream WebSocket | Real Bun upgrade and valid-to-stale transition passed |
| Polymarket live upstream | Gamma metadata, CLOB snapshot and four usable WebSocket events received over a 25-second observation; no orders submitted |

The live source smoke used Gamma market `2244513`, condition `0x5187c6fefe08cf4513e08dd31a514b698aaebc18c259b9a98c8170cca2b7d6e8`, checked at `2026-09-07T08:36:26.432Z`. Its book was one-sided, so the midpoint was correctly withheld. This verifies adapter connectivity/quality handling, not every future market or the deployment's public WSS reverse proxy. The upstream message format was checked against the [official market-channel documentation](https://docs.polymarket.com/api-reference/wss/market).

Raw test output, exit codes, timestamps, source identities and selected service logs are in [evidence](./evidence/). Browser artifacts are in [output/playwright](../../../output/playwright/), including the order display, admin readiness and final outage-gate screenshots. Test wallets were injected local Anvil providers, not a real browser extension or Safe transaction service.

The final fresh backend run is recorded separately as [final-stack-result.json](./evidence/final-stack-result.json); [stack-result.json](./evidence/stack-result.json) and the unprefixed reconciliation summary belong to the longer PostgreSQL/browser rehearsal. Local services were stopped after verification; their data was retained for diagnosis. No unrelated local processes were stopped.

The arithmetic proofs cover the specified integer formulas, not the EVM, all callbacks, dependency behavior, hash security or whole-program correctness. The earlier scoped contract review remains [raw-unit-ratio/REPORT.md](../../2026-09-06/raw-unit-ratio/REPORT.md); this readiness review does not replace an independent audit.

### Real USDG / NVDA / TSLA fork evidence

The previous pinned real-token campaign passed 77 checks and 815 local transactions: [successful evidence](../../2026-09-06/real-token-fork/evidence/2026-09-07T07-16-25.952Z/result.json). Solidity source identity is unchanged by this readiness work.

A fresh attempt during this task **did not complete**. The public RH RPC returned `metadata is not found, 56647014` while Anvil fetched historical account state for the pinned fork; [failure evidence](../../2026-09-06/real-token-fork/evidence/2026-09-07T08-30-38.047Z/result.json). The local upstream-write guard passed, and no transactions were sent upstream. Do not relabel this failed rerun as passing or treat the older campaign as verification of every newly added service runtime. Rerun the real-token lifecycle with a provider proven to serve the necessary archive state before funded RH acceptance.

## Source identity

- Production Solidity digest: `8ae0424ed34387453682c962eb9d5eb3c2c39df4fab27388cca7cf26c0ba2015`.
- Lockfile SHA-256: `b683d1fe1a2e8b660c086b658a771367b9259a841a886163efc3eff7f087d863`.
- Full authored runtime inventory/digest: [source-scope.json](./evidence/source-scope.json).

The lockfile changed for workspace dependency wiring, not to remediate the accepted dependency advisories. Solidity token math remains raw-unit math with offchain display conversion; no metadata decimal scaling was reintroduced onchain.

## What must happen before funded internal RH testing

1. Supply and validate archive-capable RH RPC, hosted PostgreSQL, persistent single-host SQLite/attachments storage, TLS/private ingress, independent service tokens and the dedicated relayer keys. Rehearse backup/restore on those actual resources.
2. Deploy the reviewed release with the explicit internal acknowledgement; verify generated manifest, exact runtime/source identities, wiring and roles. Complete the unchanged two-day default-admin handover.
3. Start indexer and reconciler first, obtain a clean deep report, then start ingestor, worker, matcher, API and both production UIs. Configure supported binary Polymarket mappings through reviewed admin evidence.
4. Verify safe/finalized RPC behavior and latency with the chosen provider. Never lower safety thresholds merely to bypass an incident or provider failure.
5. Verify real wallet/Safe flows and small developer-funded GTC/IOC, cancel/release, split/merge, manual resolution and redemption lifecycles. Use an explicit loss budget and issuer-compatible wallets/approvals.

The exchange itself remains permissionless. A private ingress and API tester allowlist do not create an onchain tester allowlist. Open-order caps are not lifetime/cumulative exposure caps. The current topology is one supervised instance of each SQLite-backed service; multi-host active/active signing and unattended deep-reorg recovery are not supported claims.

See [the deployment/environment runbook](../../../docs/runbooks/internal-mainnet-testing.md) for exact modes, variables, topology, startup order and recovery boundaries.
