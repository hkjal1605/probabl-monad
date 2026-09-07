# Conditional Stocks v2 — raw-unit-ratio remediation and security re-audit

Review dates: 2026-09-06–2026-09-07. Reviewer: Codex, automated engineering/security review.

**Result: raw-unit-ratio migration implemented; point #2 verified for pinned real-token Anvil compatibility. Production remains NOT APPROVED.**

Outstanding gates include M-02 and **11 unresolved transitive dependency advisories** detected by the final package audit. The package audit fails; this report does not claim that every repository security check passes.

This report supplements the [original audit](../contracts-review/REPORT.md), [remediation review](../remediation/REPORT.md) and [original USDG incompatibility diagnostic](../real-token-fork/REPORT.md). Those historical reports and unsuccessful test runs are preserved. This is a source review, adversarial/integration test campaign and scoped formal arithmetic verification—not an independent human audit, whole-program proof or guarantee against loss.

## 1. Scope and identity

All 26 production Solidity files were reread end to end after the change: nine deployable components, ten interfaces, four libraries, two utilities and shared types, totaling **2,418 physical lines**. The original audit and original authored contracts-package files had been read before remediation. The prior remediation's CTF/dependency review remains applicable; legacy CTF cryptographic assurance is not established here.

The cross-component unit review traced contract events and bindings through domain math/signing, indexer handlers and reconciliation, matcher/slow reference/checkpoints, settlement worker and outbox, HTTP gateway and admin evidence, UI inputs, price-level aggregation, balances and portfolio display. Supporting deployment/bootstrap/configuration/docs and golden vectors were updated. [scope.json](evidence/scope.json) records supporting-file hashes and final compiler/artifact identities; inventory inclusion is not a claim that every unrelated UI/dependency file received a full manual audit.

Final production-source SHA-256 digest:

```text
8ae0424ed34387453682c962eb9d5eb3c2c39df4fab27388cca7cf26c0ba2015
```

The digest is SHA-256 of sorted `path + space + file_sha256 + newline` records, not a Git commit. The supplied workspace has no usable Git metadata. Lock SHA-256 is `163c0d348fd858ae006b71aa8b82545f7949bba654689c03a1f3102f16a01108`.

Build: Solidity `0.8.30`, Paris EVM, via IR, optimizer 7,500, metadata hash `none`, no appended CBOR. Foundry `1.7.1`, Bun `1.3.14`, viem `2.56.3`, OpenZeppelin `5.6.1`, Gnosis Conditional Tokens `1.0.3`. The pinned CTF runtime remains `0xadf1ee4719c637975ba08765e3a1187f2fb865c9b17386005960a81ff29cfcc7`.

## 2. Economic and signed-unit contract

Contracts operate exclusively on raw token integers. No production contract calls `decimals()` or normalizes balances. The `1e18` denominator is fixed ratio precision, not a claim that collateral has 18 decimals.

```text
priceRawX18 = raw quote units per raw base unit × 10^18
executionQuoteRaw = floor(quantityRaw × priceRawX18 / 10^18)
bidReservationRaw = ceil(remainingQuantityRaw × limitPriceRawX18 / 10^18)
askReservationRaw = remainingQuantityRaw
```

Notional minima, order/wallet/market caps and quote claims use raw quote units. Stock quantities, steps and stock claims use raw base units. Caps continue to measure live open orders, not filled exposure, total CTF collateral or per-person exposure.

For stock18/USDG6, `quantity = 1000000000000000000` and `limitPriceRawX18 = 200000000` represent one raw Stock Token at 200 USDG and debit `200000000` raw USDG. Bid reservation rounds up; execution rounds down; improvement/refunds conserve escrow. Rounding is per fill: splitting a trade can change its total quote by raw-unit dust. It is not a cumulative VWAP or fractional-USDG ledger.

Whole-token conversion is offchain at input/display boundaries: `humanPrice × 10^(18 + quoteDecimals - baseDecimals)`. Shared BigInt/string helpers reject precision loss, exponent notation, negative/malformed input, zero prices and uint128 order overflow. Exact raw price keys determine matching and ordering; approximate JS numbers are used only for visual output, never signatures or settlement. Stock18/USDG6 supports six human-price decimal places, subject to a market's coarser tick.

## 3. Findings and migration safeguards

| Finding / risk | Disposition | Verification |
|---|---|---|
| R-03: six-decimal USDG rejected by v1 registry | **Fixed in v2; pinned Anvil integration verified.** Removed metadata-dependent admission and consistently defined raw ratios across components. | Registry deploys with canonical USDG; NVDA/USDG and TSLA/USDG complete exchange lifecycles. |
| Legacy whole-token prices/signatures could be reinterpreted by a partial migration | **Prevented by breaking version boundary.** Registry/market/question version 2, EIP-712 domain 2, renamed signed fields, v2 payload/checkpoint/projection versions. | Legacy signatures rejected on fork; legacy wire fields and checkpoints rejected by regression tests. |
| Offchain 18-decimal defaults or float-derived signed prices/price keys | **Removed from trading conversion paths.** Verified base/quote metadata; exact BigInt conversion and price keys; balances/claims carry the correct asset decimals. | Mixed-decimal gateway matrix, unit round trips, matcher/reference agreement and live indexed claims/reserves. |
| Legacy durable state replay after migration | **Fail closed.** Matcher/API/worker/evidence/reconciliation stores reject nonempty unversioned or unsupported databases before migrations; reconciliation rejects v1 reports before changing signals. | Store/version regression tests preserve legacy content and reject unsupported reports. |
| Token decimal metadata changes after listing | **Detected offchain, not normalized onchain.** API compares confirmed metadata with creation metadata; reconciliation raises a critical market freeze signal on mismatch. | Source trace and metadata-validation tests; current exact-token metadata verified on fork. No issuer upgrade was forced. |
| Original M-01, L-01, L-02, L-03, L-04, R-01, R-02 | Prior remediations preserved, with their documented limits. | Complete regression campaign, bounded recovery/receiver adversarial tests, exact resolution commitment and deployment rehearsal. |
| **M-02: legacy CTF collection-hash assurance** | **OPEN; production release blocker.** No practical exploit is claimed; required independent cryptographic assurance is still missing. | Neither arithmetic proofs nor token/fork tests discharge this assumption. |
| R-04: vulnerable transitive indexer/tooling packages | **OPEN; release/CI gate.** The final locked-package scan reports 11 advisories (6 high, 5 moderate). They are not newly demonstrated Solidity exploits. | Package audit exits 1; see the dependency follow-up below. No additional advisory exceptions were added. |

Creation-evidence packets are v2. The unchanged resolution-commitment construction and controller version remain v1, bound to the new market/controller/chain. HTTP `/v1` routes remain for routing continuity but their order payload/signing schemas are breaking v2; old field names are not aliases.

The registry no longer enforces metadata limits onchain. The display/API layer supports verified decimals 0–36 and fails closed outside that range. Curated listing and exact transfer semantics remain necessary. A registered token is not automatically a safe collateral token.

## 4. Verification results

| Check | Result / evidence |
|---|---|
| Solidity CI profile | **106 passed, 0 failed, 0 skipped**, 16 suites; two stateful invariants, **256,000 calls, 0 unexpected reverts**. [Log](evidence/verification-2/forge-ci.stdout.log) |
| Default-profile gas snapshot | **106 passed**, separate seed, regenerated snapshot. [Log](evidence/verification-2/snapshot.stdout.log) |
| Mixed-decimal Solidity suite | Inherits the entire 17-test exchange suite with quote6/base18, plus an explicit raw-ratio/rounding assertion. Real-token matrix independently covers both branches/funding modes/payouts. |
| TypeScript | **92 passed, 0 failed**, 2,740 expectations across 26 files. Includes randomized optimized/reference matching, FIFO/partial fills, checkpoint recovery, gateway funding/claims, durable worker and metadata boundaries. [Log](evidence/final-ts/typescript-tests.stderr.log) |
| Type checks / lint / formatting | All workspaces, Biome, Forge lint and Forge formatting pass. Uncached executable build follows Forge lint to avoid ABI-only artifact omission. [Evidence](evidence/verification-2/forge-lint.result.json) |
| Production UI builds | User and admin Next.js builds pass. [User](evidence/final-ts/ui-build.result.json), [admin](evidence/final-ts/admin-build.result.json). This is not browser/wallet-extension interaction certification. |
| Generated ABIs | Regeneration is byte-identical to the checked-in generated binding file. [Evidence](evidence/final-ts/bindings.json) |
| Locked-package security audit | **FAIL: 11 advisories**, outside the one pre-existing documented exception. [Full output](evidence/final-ts/dependencies.stdout.log), [exit status](evidence/final-ts/dependencies.result.json). |
| Local deployment verification | **12 checks passed**: exact reconstructed runtimes/wiring/roles, wrong CTF rejected before broadcast, delayed handover, unexpected role and unsafe delay rejection, runtime tampering rejection, CLI creation/resolution and substituted commitment rejection. [Log](evidence/verification-2/deployment.stdout.log) |
| Arithmetic formal model | **9 lemmas proved** by Z3 5.1.0; each negated property is unsatisfiable. [Proof output](evidence/verification-2/arithmetic.stdout.log) |
| Static analysis | 102 detectors, 46 compiled contracts, **29 alerts individually triaged**. None established an additional exploitable first-party defect under the stated assumptions. [Disposition](SLITHER-TRIAGE.md) |
| Coverage | Production-source LCOV: **655/700 lines (93.57%)**, **94/95 functions (98.95%)**, **77/140 branches (55%)**. [LCOV](evidence/verification-2/coverage.lcov) |
| Deployability | Largest runtime, ConditionalExchange: **23,050 bytes**, 1,526 bytes below EIP-170's 24,576-byte limit. Registry: 12,925 bytes. [Sizes](evidence/verification-2/forge-sizes.stdout.log) |

Coverage uses `--ir-minimum`, whose source mapping can be inaccurate, particularly for compound conditions/assembly. Branch coverage is incomplete and is explicitly not a claim that every EVM path was exercised. The instrumented coverage build is not the deployed artifact; an uncached production-settings build was restored afterward. The stateful invariant handlers use the 18/18 fixture; the separate inherited exchange suite and real-token matrix provide 18/6 coverage.

The nine proofs cover uint128 product bounds, floor/ceiling relation, execution under the signed bid, every partial reservation covering execution plus remaining escrow, telescoping cap reduction, exact refunds, feasible aligned configuration witnesses, simultaneous two-wallet admission and invalid-payout non-overdraw. They model integer arithmetic only: **no EVM bytecode proof, callback proof, signature/hash collision proof, issuer proof or CTF cryptographic proof is claimed**.

## 5. Real USDG / NVDA / TSLA integration (point #2)

The **final-source run** is [2026-09-07T07-16-25.952Z](../real-token-fork/evidence/2026-09-07T07-16-25.952Z/result.json): **77 checks, 815 local transactions, exit 0**, completed at `2026-09-07T07:17:48.130Z`, RH chain ID 4663, pinned block **`56647011`**, hash **`0x3e74877c2488a6b48cde767a4b00d119b122a8f7f87fa57d5784fe3edc9b44c8`**. Its production-source digest exactly equals section 1. Runner SHA-256: `ca7caee0d456cb1a1942389719fa85471a6f9009dd0161189194d35db5cdf2f1`; helper identities are in the final scope inventory.

The [clean rebuild](../real-token-fork/evidence/2026-09-07T07-16-25.952Z/fullstack-rebuild.json) matches the live projection at local block `56647133`, with both hashes equal to `0x36f9ca38d958f987fcb4057cc6dd8c5c5d68b073f5989725abe307258502212c`. [Deep reconciliation](../real-token-fork/evidence/2026-09-07T07-16-25.952Z/fullstack-reconciliation.json) reports `ok`, no issues, no freeze required. The earlier independently passing [2026-09-06 baseline](../real-token-fork/evidence/2026-09-06T11-43-17.425Z/result.json) is retained.

Canonical identities were checked against the [official USDG directory](https://docs.robinhood.com/chain/contracts/) and [Robinhood asset API](https://api.robinhood.com/rhj/assets); responses, pinned proxy/implementation/beacon bytecode, hashes and source-holder balances are archived in each run.

| Asset | RH address | Decimals |
|---|---|---:|
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | 18 |
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | 18 |

The harness starts an owned private Anvil with no default accounts and a strict upstream read-only RPC gateway. Ephemeral signers are generated in memory. Existing token holders are impersonated only locally, and real token transfers fund tests. Token code, token balances, compliance slots and allowances are not overwritten. Only local ETH funding, time/mining and snapshots are manipulated. **Zero upstream transactions are submitted.** The denied-method counter includes the intentional send rejection and Anvil's unsupported read optimization, `eth_getAccountInfo`; it is not a count of real broadcasts.

Exchange coverage is **2 stocks × 2 branches × 2 buyer-funding modes × 2 seller-funding modes × 3 payouts = 48 isolated cases**. Each exercises API preparation, v2 signing/legacy rejection, two partial fills (0.333 + 0.667 stock), exact remaining reservations, cap release, committed resolution and full redemption. Additional checks cover IOC partial execution, price improvement, paused cancellation, expiry refunds and standalone split/merge/YES/NO/invalid exits for all three tokens. Case isolation deliberately rewinds local snapshots; the transaction log includes successful executions later orphaned by those rewinds, not 815 transactions on one final canonical branch.

The 48-case matrix uses actual RPC-backed gateway logic with a narrowly stubbed indexer health/market metadata response. Separately, **both stocks traverse actual Ponder handlers, a local HTTP API, UI input-conversion functions, optimized and reference matchers, real settlement-worker transaction submission/confirmation, indexed partial reservations and claim balances, and cancellation**. Fresh independent Ponder databases rebuild the same projection hash; deep reconciliation reports no issues. This is not a browser-wallet UI test, a multi-host failover test or a live RH settlement.

Historical-state replay runs before snapshot rewinds: the preceding run hit an Anvil missing-bytecode error when replaying reused local block heights. Other preserved unsuccessful runs expose public RPC historical-state pruning, changed fixture-holder balances, test-fixture pause arguments and receipt/simulation handling. None is silently reclassified as a passing full lifecycle. The gateway caches only successful immutable reads within each explicitly pinned run; it does not substitute a different block or mock token behavior.

The September 7 reruns additionally exposed an HTTP health-check timeout and a Ponder development hot-reload race: regenerating identical binding files during startup closed a PGlite connection still used by another indexing task. The final pass ran without concurrent codegen/build writes; health/API requests now have explicit timeouts. Do not regenerate bindings, run codegen or edit imported source while this harness is running. This documents a local development-tooling limitation, not production Postgres/hot-upgrade assurance.

To reproduce: clean-build contracts, generate bindings and run `bun --filter @conditional-stocks/contracts test:rh-fork`. The runner asserts its explicit block/hash. The public RPC may prune that historical state; reproducing an old run then requires a suitable archive endpoint, or an explicitly reviewed new block/hash and a new evidence directory. The stored partial RPC-read cache alone is not a complete offline archive, especially for newly generated accounts.

## 6. Required rollout and remaining release gates

1. **Do not upgrade or rescale existing state in place.** These contracts are non-upgradeable. Archive old databases/manifests and preserve access to old-contract cancellation/recovery. Old signatures, market IDs, calldata, intents and checkpoints must not be relabeled v2.
2. Deploy a fresh verified v2 graph, complete delayed admin handover, configure raw-unit risk caps and start fresh v2 indexer/matcher/API/worker/evidence/reconciliation state. Rebuild only from that deployment's v2 logs. Follow the [unit/migration specification](../../../docs/architecture/raw-unit-ratio-v2.md) and [deployment runbook](../../../docs/runbooks/deployment.md).
3. Obtain independent specialist clearance of the exact CTF collection construction/artifact, or select a separately reviewed replacement and migrate position IDs. **M-02 is still open.** The supported deploy/create tooling remains limited to chain IDs 31337 and 46630, with `productionApproved: false`; the local fork harness is not a mainnet deployment path.
4. Complete independent Solidity/remediation review, exact issuer-control/upgrade/blocklist/pause/corporate-action review, RH/Nitro/sequencer/finality exercises, multisig ownership/key separation, operational freeze/recovery and single-host-to-production durability/failover validation. Anvil does not certify these.
5. Resolve R-04 through a reviewed indexer/toolchain dependency upgrade or maintained backport, then regenerate bindings and rerun type checks, all tests, Postgres indexer/rebuild/reconciliation, settlement and the exact-token fork. Do not treat the existing package-audit failure as waived.

### R-04 dependency follow-up

The locked `ponder@0.17.8` pins older ORM/server/build tooling. The final `bun run audit:deps` output reports:

| Package family | Advisory count | Required review |
|---|---:|---|
| `@hono/node-server` | 3 | Protected static path normalization/bypass and Windows traversal. Affected pinned server is 1.19.5; the encoded-slash fix is 1.19.10. [Maintainer advisory](https://github.com/honojs/node-server/security/advisories/GHSA-wc8c-qw6v-h7f6). |
| `drizzle-orm` | 1 | Identifier escaping; pinned 0.41.0, patched stable release 0.45.2. Exploitation requires attacker-controlled identifier/alias construction; static schema/allowlisted identifiers are not affected by this specific issue. [Advisory](https://github.com/advisories/GHSA-gpj5-g38j-94v9). |
| `kysely` | 3 | JSON-path traversal/injection and MySQL literal escaping. The JSON-path family requires at least the 0.28.17 fix. [Advisory](https://github.com/advisories/GHSA-pv5w-4p9q-p3v2). |
| `vite` | 3 | Development-server/path handling, including Windows-specific paths. Exact advisory IDs are in the package-audit output. |
| `esbuild` | 1 | Development-server cross-origin access. Exact advisory ID is in the package-audit output. |

First-party indexer/API searches did not find `serveStatic`, attacker-controlled `sql.identifier`/`sql.raw`, or Kysely JSON-path builders. This is limited negative evidence, **not** an exhaustive reachability proof through Ponder, GraphQL, tooling or every deployment configuration. The current integration uses loopback PGlite; it does not certify externally exposed developer servers or production database authorization. No lockfile changes, global transitive overrides or new security suppressions were made during this unit migration. Several fixes cross Ponder's explicitly pinned dependency versions and require their own compatibility and security validation. The existing CI package-audit step remains failing until this is resolved.

Current stock `uiMultiplier` checks do not simulate future corporate actions. No multiplier is applied to raw ERC-20 balances, CTF collateral or fills; UI prices are per whole raw Stock Token, not a permanent guarantee about underlying share count. Fee-on-transfer, rebasing, empty-return collateral and arbitrary callback mechanics are not generically supported. Administrative roles can jointly finalize factually wrong outcomes, matcher fairness still requires operational monitoring, and per-address live-order caps are not total exposure limits.

**Final assurance boundary:** the raw-unit design is implemented and the recorded local checks support the stated arithmetic and integration behavior. Point #2's pinned Anvil compatibility requirement is completed; issuer behavior, production readiness and M-02 are not certified by that completion.
