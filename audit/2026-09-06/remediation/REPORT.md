# Conditional Stocks — remediation review and smart-contract re-audit

Subsequent v2 review: [raw-unit-ratio migration and real-token verification](../raw-unit-ratio/REPORT.md) supersedes this report's 18-decimal integration assumption and closes R-03 for the pinned Anvil scope. This report's original source identity and results remain historical; M-02 remains open.

Date: 2026-09-06  
Reviewer: Codex, automated engineering/security review  
Review type: full first-party source re-review, audit remediation, adversarial execution, stateful invariants, independent static analysis, and scoped machine-checked arithmetic proofs  
Release decision: **NOT APPROVED FOR PRODUCTION OR REAL-VALUE CUSTODY**

Follow-up on 2026-09-06: the [real-token Anvil fork](../real-token-fork/REPORT.md) established a concrete additional integration blocker, **R-03**: canonical RH mainnet USDG has 6 decimals, but this source requires 18. Registry construction reverts, so exact-token exchange lifecycle verification remains **blocked, not complete**. The original evidence below is preserved; the fork findings supplement its token assumptions and release decision.

## Executive conclusion

The actionable application-level findings have been remediated or mitigated as detailed below. Resolution now requires a prior commitment to the exact final call; permissionless condition preparation cannot block otherwise valid market creation; unusable cap configurations are rejected; detectable incompatible claim destinations are rejected; maker-controlled alternate recovery is available; and deployment verification checks exact runtimes, immutable wiring, role history, and completed administration handover. A further recovery-batch gas-exhaustion issue found during this work was reproduced and fixed.

The final complete CI campaign passed **88 Solidity tests in 15 suites**, including **256,000 stateful handler calls with zero unexpected reverts**. All **83 TypeScript tests** passed. Nine arithmetic lemmas were proved by Z3. The local deployment/administration/resolution rehearsal passed 12 checks. Slither completed 102 detectors and produced 29 alerts, all individually triaged; none was confirmed as an additional exploitable first-party defect under the stated dependency and token assumptions.

This is **not** a whole-program formal proof, an independent human audit, or a guarantee of safety. **M-02 remains unresolved**: the pinned Conditional Tokens collection-ID construction still lacks the cryptographic assurance required by the earlier audit. Exact deployed USDG/Stock Token behavior, multisig ownership, target-chain behavior, and independent specialist review remain launch gates. Receiver callback liveness cannot be guaranteed for arbitrary mutable wallets. It would be inaccurate to state that every risk is gone or that the contracts are production-safe.

No live network was deployed to or modified. Only the isolated local Anvil chain was used. The contracts are non-upgradeable: these source changes do not repair existing deployed addresses. Historical audit files and the existing `deployments/31337/v1.json` were preserved.

## 1. Scope and reproducible identity

The original [audit report](../contracts-review/REPORT.md), its evidence, and the accompanying reproduction were read end to end before remediation. All original authored files under `packages/contracts` were read in full, including source, tests, fixtures, mocks, scripts, configuration, documentation, and the historical deployment manifest. After remediation, all 26 production Solidity files were reviewed again, with the changed tests and operational integrations checked against them.

The original contracts-package files are also retained in [a pre-remediation archive](evidence/pre-remediation-contracts.tar.gz), excluding dependency/build/cache directories. Archive SHA-256: `89cf898242a47c4b0a8075f4556ed4f420161856af58d3e9798463aec3e25b47`. This is historical vulnerable source for comparison, not code approved for deployment.

The reviewed production scope comprises nine deployable components, ten interfaces, four libraries, two utilities, and the shared types file: **2,424 physical Solidity lines**. The current contracts-package inventory contains **60 authored/supporting files**. Exact file paths, line counts, SHA-256 hashes, compiler-input dependency hashes, and build fingerprints are in [scope.json](evidence/scope.json).

Production-source digest:

```text
38c22573022e14c631d5d7d7b1eb7ed9bf25b458c40b80485ca7d3891a393c5e
```

This is SHA-256 of the sorted concatenation of `path + space + file_sha256 + newline` for all `packages/contracts/src/**/*.sol`. It is not a Git commit. The workspace supplied for review did not have usable Git metadata.

Dependency-lock SHA-256:

```text
163c0d348fd858ae006b71aa8b82545f7949bba654689c03a1f3102f16a01108
```

Toolchain and dependencies:

| Item | Reviewed/tested value |
|---|---|
| First-party Solidity | `0.8.30+commit.73712a01` |
| Compilation | `paris`, via IR, optimizer enabled with 7,500 runs, metadata hash `none`, CBOR disabled |
| Foundry | `1.7.1-Homebrew`, commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8` |
| Bun | `1.3.14` |
| Modern OpenZeppelin | `5.6.1` |
| Conditional Tokens package | `@gnosis.pm/conditional-tokens-contracts@1.0.3` |
| Pinned CTF artifact compiler | `0.5.10+commit.5a6ea5b1.Emscripten.clang` |
| Independent analyzer | Slither `0.11.6`, 102 detectors |
| Arithmetic solver | Z3 `5.1.0`, installed from `z3-solver==5.1.0.0` |

Exact pinned CTF identities, checked before use:

```text
runtime keccak256:
0xadf1ee4719c637975ba08765e3a1187f2fb865c9b17386005960a81ff29cfcc7
creation bytecode keccak256:
0xc0604e74979d0d1d6d76fd328edad4ff4f45dd18e3c7ca5c8eb7d84dccd3eaf0
```

The upstream Conditional Tokens implementation, collection helpers, reachable legacy ERC-1155 behavior, the bundled earlier audit, and all pages of the specialist accumulator audit were examined. Relevant modern OpenZeppelin access-control, reentrancy, signature, interface-checking, SafeERC20, and arithmetic implementations were also inspected. This is not a claim to have manually audited every unrelated file in `node_modules`, every generated artifact, or the complete compiler/toolchain implementation.

Supporting changes include the shared TypeScript resolution commitment/cap validator, generated bindings, API evidence preparation and reconciliation, manual CLI workflows, two local integration scripts, deployment manifests/verifier, CI verification ordering, and risk/recovery documentation. The broader API, matcher, indexer, UI, database, and infrastructure are not independently re-audited in full by this report.

## 2. Finding disposition

“Resolved” means the specified application defect is no longer reproducible in this source snapshot under the documented assumptions. It does not mean an entire vulnerability class has been formally excluded.

| Finding | Original severity | Final disposition |
|---|---|---|
| M-01 — preparation does not bind final evidence/payout | Medium | **Resolved.** Exact domain-separated commitment enforced by the controller; Solidity, TypeScript, and local CLI integration verified. |
| M-02 — legacy collection-ID cryptographic assurance | Medium | **OPEN; release blocker.** Dependency preserved, exact bytecode pinned, local/testnet-only tooling gate enforced. No cryptographic fix or clearance claimed. |
| L-01 — permissionless preparation blocks creation | Low | **Resolved.** Compatible unresolved pre-prepared conditions are reused; malformed/resolved conditions fail closed. |
| L-02 — incompatible claim destinations make fills revert | Low | **Mitigated.** Detectable incompatible destinations rejected; dynamic callback failure remains an explicit liveness risk. Atomic rollback and maker-directed recovery verified. |
| L-03 — no openable order/no possible two-sided match | Low | **Resolved conservatively.** Constructive tick/step/minimum/cap feasibility check plus matching CLI validation. |
| L-04 — dependency identity and one-time wiring assurance | Low | **Remediated in constructors and tooling.** Runtime/constructor/source/receipt/wiring/role/handover checks enforced in the supported workflow. Trusted build/RPC and independent target-token approval still required. |
| I-01 — cap semantics overstate exposure protection | Informational | **Clarified.** Source comments, UI labels, plans, and runbooks consistently describe live-open-order limits. No global exposure cap was added or claimed. |
| I-02 — insufficient stateful/adversarial/analyzer verification | Informational | **Substantially remediated locally; external portion open.** Stateful handlers, adversarial tests, nine model proofs, Slither, and deployment rehearsal added. Exact-token fork/testnet validation and independent audit remain outstanding. |
| R-01 — repeated callback gas exhaustion poisons recovery batch | Low; new | **Resolved.** Per-entry call gas and returndata copying bounded; reproduced failure now passes regression. |
| R-02 — lint-generated ABI-only artifacts omit tests | Informational; new verification issue | **Resolved in repository verification ordering.** Uncached build after lint; final evidence contains all 88 tests, including the previously omitted suite. |

### M-01: exact two-role resolution approval

Affected code: [MarketRegistry](../../../packages/contracts/src/MarketRegistry.sol), [ManualResolutionController](../../../packages/contracts/src/ManualResolutionController.sol), [shared commitment helper](../../../packages/domain/src/resolution.ts).

The market administrator now stores a nonzero commitment when moving a frozen market to `AWAITING_RESOLUTION`. The resolution administrator must supply a call whose commitment is exactly:

```text
keccak256(abi.encode(
  "CONDITIONAL_STOCKS_RESOLUTION_V1",
  chainId, controllerAddress, marketId,
  yesPayout, noPayout, payoutDenominator,
  evidenceHash, keccak256(bytes(evidenceUri))
))
```

The controller checks this value before marking its once-only flag or reporting payouts. It still admits only `[1,0]/1`, `[0,1]/1`, and `[1,1]/2`. The registry consumes the commitment as resolution completes. Any failed CTF report reverts the full transaction and preserves approval for a legitimate retry.

Verification: [ResolutionCommitment.t.sol](../../../packages/contracts/test/ResolutionCommitment.t.sol) rejects changed payout vectors, denominator/domain fields, evidence hash, URI, chain, replay, and cross-role substitution. Fuzzing covers all three approved vectors. The local CLI rehearsal compares Solidity and TypeScript hashes, rejects a changed URI, then finalizes the exact approved packet. API evidence reconciliation now expects the commitment rather than the bare packet hash.

Residual trust: the two operational roles can jointly approve a factually false answer, and the default administrator can grant both roles. There is no cross-chain truth proof. A prepared commitment cannot be unilaterally replaced; mistaken preparation can leave a market awaiting resolution. Operators must validate the exact packet before preparing it.

Compatibility: `beginResolution(bytes32,bytes32)` has unchanged argument types but changed semantics. Old callers passing only a packet hash are not compatible with the new controller. Deploy the updated contract graph and clients together.

### M-02: unresolved dependency cryptography

The specialist report questions whether the security proof cited for the multiset hash applies to the implemented field-element increment mapping. The pinned source retains that construction. No practical collision or theft exploit was demonstrated in this review; the Medium rating represents an unresolved custody-level assurance requirement, not a claim that the function is currently breakable. See the [upstream audit collection](https://github.com/gnosis/conditional-tokens-contracts/tree/master/docs/audit) and [collection helper source](https://github.com/gnosis/conditional-tokens-contracts/blob/master/contracts/CTHelpers.sol).

A shallow binary application does not restrict the underlying permissionless CTF. Outsiders can still exercise its compositional-position surface with the same collateral. Exact runtime pinning, a fresh CTF instance, passing split/merge tests, and arithmetic proofs do not resolve the cryptographic question.

The supported deployment/market-creation workflow now permits only chain IDs `31337` and `46630` and emits `productionApproved: false`. There is no environment-variable override. This is a release-process restriction, not an onchain prevention of arbitrary deployments or direct CTF deposits. Chain ID alone does not authenticate a network or its RPC.

Closure requires an independent specialist's written disposition for the exact construction/artifact, or a separately reviewed replacement and migration. Replacing the hash or restricting CTF changes position identifiers and compatibility; that architectural change was not silently introduced here. **Do not put value at risk while this finding is open.**

### L-01: idempotent compatible condition preparation

Creation computes the deterministic condition ID first. If it is unprepared, the registry prepares it and rereads the slot count. If already prepared, it is reused only if it has exactly two slots, zero denominator, and both payout numerators zero. Market uniqueness checks remain in place.

Verification: the original front-running reproduction is now a successful-creation regression; duplicate creation still fails. Additional tests reject a pre-resolved condition and a mocked malformed slot count without storing a market. The payout-zero checks are defensive against a wrong dependency or incompatible preparation, not an assertion that an outsider can impersonate the configured oracle on a real chain.

### L-02: destination admission, atomic failure, and recovery

[OrderValidator](../../../packages/contracts/src/OrderValidator.sol) probes contract makers and recipients with the modern ERC-165 checker before accepting funding. This includes makers because whole-funded fills deliver inactive claims to them, and claim-funded orders may require claim refunds. EOAs remain supported. The checker uses bounded interface queries and rejects invalid ERC-165 implementations, consistent with [ERC-165](https://eips.ethereum.org/EIPS/eip-165).

Interface declaration is not behavioral proof. A contract can lie, upgrade, change policy, reject a particular transfer, or consume excessive callback gas. A code-free address can also later acquire code. Such failures still revert the entire fill; they do not partially consume escrow. Existing worker simulation/quarantine is an operational aid, not a guarantee that pending state will remain unchanged.

The new maker-only `cancelOrderTo(orderHash, recipient)` lets a smart wallet recover its own escrow to a working destination if it no longer accepts claims. Third parties cannot redirect it. Permissionless stale-order releases still pay the original maker. Recovery remains subject to the collateral token's transfer restrictions and the maker's ability to execute an authorized wallet call.

Verification: deterministic rejecting recipients, gas-consuming/lying ERC-165 implementations, toggled receiver rejection, gas-exhausting delivery, authorized-maker reentrancy, malformed ERC-1271 return data, callback authentication/replay, unauthorized redirect, and successful alternate claim/ERC-20 recovery are tested. [AdversarialReceivers.t.sol](../../../packages/contracts/test/AdversarialReceivers.t.sol), [ReceiverBoundaries.t.sol](../../../packages/contracts/test/ReceiverBoundaries.t.sol), and [SecurityBoundaries.t.sol](../../../packages/contracts/test/SecurityBoundaries.t.sol) contain the cases.

Disposition is mitigation, not unconditional receiver liveness. Arbitrary wallets cannot be made to accept ERC-1155 transfers by this protocol.

### L-03: constructive cap feasibility

Let `s` be `baseStep`, `t` be `priceTickX18`, `m` be `minNotional`, and `W = 10^18`. The smallest candidate tick count at one base step is:

```text
k = floor(((m - 1) * W) / (s * t)) + 1
price = k * t
notional = ceil(s * price / W)
```

Creation requires a positive floor-executable tick/step product, a uint128-representable price, notional no greater than the per-order maximum, and room for two such orders in the market cap. Existing wallet/order cap ordering ensures separate wallets can each place one leg. All checks run before condition preparation. The shared TypeScript validator applies the same arithmetic before CLI submission.

This intentionally conservative policy requires a witness at one base step. Some configurations executable only at larger quantities are rejected. The rule does not guarantee counterparties, liquidity, token transfer availability, or delivery success.

Verification: both audited impossible configurations now revert. A fuzz test constructs accepted configurations, opens an actual bid and ask at exactly the admissible market cap, and fills them through the real pinned CTF. Uint128 extreme inputs and the arithmetic witness are checked separately. [RegistryHardening.t.sol](../../../packages/contracts/test/RegistryHardening.t.sol).

### L-04: executable deployment verification

The registry/controller/exchange/IOC wiring now checks a common authority in addition to matching CTF and registry/exchange dependencies. One-time components remain non-reconfigurable. The supported scripts additionally:

1. Reject unexpected CTF creation/runtime bytecode and unsupported chain IDs.
2. Check compiler version/settings and each artifact's source hashes against current files.
3. Simulate each constructor with the exact arguments to derive its immutable-bearing runtime; compare installed bytecode before configuring dependencies.
4. Record source/lock digests, constructor arguments, initcode hashes, deployment/configuration transaction hashes, block numbers/hashes, and role/handover intent.
5. Reconstruct and compare all nine custom runtimes, deployment transactions, and receipts during read-only verification.
6. Read the dependency graph and reconcile current role membership for every account found in historical `RoleGranted` logs, not just named manifest accounts.
7. Require completed delayed admin acceptance, no pending admin transfer, no residual deployer administration, and neither active nor scheduled admin delays below two days.
8. Require this manifest verification before the market-creation CLI proceeds.

Verification: the local rehearsal rejects an unrelated external CTF **before any deployment broadcast**, wrong installed runtime, incomplete handover, an unexpected matcher outside the manifest, and a scheduled unsafe admin-delay reduction. It then verifies valid recovery of each local test condition and successfully creates/resolves a market.

Limits: this assumes a clean trusted build and an honest, complete RPC, including role logs. Metadata/source matching does not authenticate a malicious compiler or a forged artifact. The verifier is not a multisig-owner audit, live-chain finality proof, or exact-token approval system. Custom scripts can bypass it. The onchain contracts do not universally enforce a hardcoded CTF code hash. These boundaries are explicit in [the deployment runbook](../../../docs/runbooks/deployment.md).

### I-01: caps are live-order limits

`maxWalletOpenNotional` and `maxMarketOpenNotional` count live order reservations at each order's limit price. They decrease after fills and cancellations. Filled claims and collateral split directly through CTF do not count. Wallet caps are per address and are not Sybil-resistant.

The original demonstration that filled exposure can grow beyond a live-order cap remains a passing characterization test. It has not been hidden or inverted into a false exposure guarantee. Source comments, UI labels, the implementation plan, pilot plans, and runbooks now describe the actual protection. A hard bound on all condition collateral would require different custody architecture and cannot be added honestly as a counter on this exchange alone. Offchain rollout/exposure controls still need operational validation.

### I-02: verification completed and still outstanding

The new stateful handlers interleave trading, partial fills, IOC, cancellation, nonce invalidation, expiry, pauses, lifecycle changes, recovery, splits, merges, and redemption using the real CTF artifact. Independent ghost accounting is reconciled after each call. A separate deterministic reachability test proves that actual opens, partial fills, IOC remainder recovery, cancellation, invalidated release, merge, finalization, and a positive redemption are reachable—not merely skipped handler calls.

Independent Slither analysis and the arithmetic proof harness were added. Missing adversarial boundaries were exercised. CI now runs stateful invariants and the arithmetic lemmas; it builds executable tests after lint. Exact production-token fork/testnet integration was not performed because reviewed token addresses, implementations, and target-state evidence were not supplied/established. That part of I-02 remains open.

### R-01: best-effort batch isolation failure found during re-audit

The former recovery router used high-level `try/catch`, forwarding nearly all available gas. A maker wallet consuming all callback gas could leave too little for later releases. A batch containing the same gas-griefing stale order twice followed by an ordinary maker's order reverted under a one-million-gas batch-call budget, rolling back otherwise recoverable entries. The direct maker route remained available, so the impact was denial of best-effort recovery, not theft.

The new implementation forwards at most 300,000 gas to each release, supplies no automatic output buffer, and copies at most 256 failure bytes. Untruncated failures hash the full data; truncated failures hash `abi.encode(fullLength, prefix)`. Success emits a zero failure hash. The free-memory pointer is aligned after copying. The attacker cannot demand unbounded memory allocation in the router through revert data.

The identical repeated-gas-grief regression now leaves the bad order open and releases the later good order. A 64-KiB revert-data case also passes. Every release mode uses the same bounded helper. Callers must still supply enough gas for the whole requested batch. Legitimate wallets needing more than the per-entry cap must use direct exchange cancellation/release. This is not unlimited-gas liveness.

### R-02: verification completeness pitfall

While expanding tests, `forge lint` compiled a changed test into an ABI-only artifact. The following cached test run reported success but omitted the five-test `RegistryHardeningTest` suite. The artifact contained only `abi` and `id`, without executable bytecode. This was a tooling/evidence failure, not a contract vulnerability.

An uncached full build regenerated executable artifacts; the final campaign contains all **88** tests, including that suite. CI and the root `check` command now explicitly rebuild without cache after lint. Documentation warns against concurrent build/lint/coverage/test operations sharing output/cache directories. An intermediate 83-test Solidity result is not the final result used in this report.

## 3. Formal specification and proof scope

### Authorization and state transitions

An admitted order binds maker, recipient, market, branch, side, funding kind, quantity, price, TIF, expiry, nonce, salt, chain ID, and exchange address. Funding is pulled only after EOA or ERC-1271 validation. Filling uses the hash of the complete signed order to find an already-open escrow record; a changed market/recipient/domain cannot select another order's funds.

Market lifecycle is monotonic through scheduled/open/frozen/awaiting/resolved/redeemable/archived states. Public cutoff freeze is available for open markets at cutoff. A market administrator or guardian can freeze earlier. The resolution role cannot bypass prepared approval. Archiving does not prevent direct CTF redemption.

`cancelOrder` and `cancelOrderTo` require the stored maker. Stale-order release is permissionless but cannot redirect assets. `cancelUpTo` is monotonically increasing. Exchange pause blocks admission/matching but does not block cancellation, stale release, merge, or redemption. These are source and execution findings, not solver-proved whole-program properties.

### Reservation and partial-fill arithmetic

For remaining quantity `q`, bid limit `P`, fill `f`, and execution price `X`, assume:

```text
0 <= f <= q <= 2^128 - 1
0 < X <= P <= 2^128 - 1
W = 10^18
R_old = ceil(q * P / W)
R_new = ceil((q - f) * P / W)
E = floor(f * X / W)
refund = R_old - E - R_new
```

Because `X <= P` and floor/ceiling are monotone, `E + R_new <= R_old`. Therefore the checked refund is nonnegative and `E + R_new + refund = R_old`. Ask collateral decreases by exactly `f`. Open notional is recomputed from remaining quantity, and its reduction telescopes across fills and cancellation. All admitted quantity/price products fit uint256; full-precision `Math.mulDiv` implements the specified rounding.

### Settlement conservation

| Funding | Active position delivery | Inactive position / refund |
|---|---|---|
| Whole stock ask | Split exactly the filled stock amount; active stock claim to signed buyer recipient | Complementary stock claim to original seller maker |
| Active-stock-claim ask | Existing active stock claim to signed buyer recipient | No new complement is minted |
| Whole quote bid | Split exactly floor-rounded execution quote; active quote claim to signed seller recipient | Complementary quote claim and any whole-token price improvement to original buyer maker |
| Active-quote-claim bid | Existing active quote claim to signed seller recipient | Remaining price improvement in active quote claims to original buyer maker |

Both YES and NO books use these rules. The exchange updates escrow/counters before settlement, and reentrancy guards protect asset-mutating entry points. Settlement consumes precisely expected CTF transfers/mints and rejects residual position balances. ERC-20 balances are compared against pre-call baselines so unsolicited dust does not become a settlement denial of service. Any failed callback/transfer reverts the complete EVM transaction.

These conservation arguments assume correct token balance reporting, exact supported transfer semantics, distinct CTF position identities, and the reviewed immutable component graph. They do not prove those assumptions for arbitrary external tokens or the legacy collection hash.

### Machine-checked lemmas

[prove-accounting.py](verification/prove-accounting.py) asks Z3 whether the negation of each property is satisfiable. All nine answers were `unsat`; unknown, timeout, or a counterexample fails the run. [Raw proof output](evidence/arithmetic.stdout.log).

| Lemma | Result |
|---|---|
| uint128 quantity × price fits uint256 | Proved under range assumptions |
| Ceiling reservation is floor execution or one unit above | Proved for nonnegative scaled notional |
| Bid price bounds the scaled execution debit | Proved for ordered nonnegative prices |
| Old reservation covers execution plus new reservation | Proved for scaled fill/remainder decomposition |
| Open-notional reduction is nonnegative and telescopes | Proved for decreasing remaining scaled notional |
| Refund exactly reconciles original escrow | Proved subject to the contract's reserve sufficiency check |
| Feasibility witness reaches minimum; previous tick does not | Proved under Euclidean-division assumptions |
| Two witness orders fit separate-wallet/market caps | Proved under cap-ordering assumptions |
| Invalid-outcome floors cannot overdraw a complete set | Proved for equal nonnegative YES/NO balances |

These are **integer-model proofs of specified formulas**. They do not symbolically execute the compiled bytecode, prove model/source correspondence automatically, quantify over all call sequences, prove receiver behavior, prove governance truth, or prove CTF hash security. No SMTChecker whole-program result, Certora certificate, symbolic EVM proof, or independent formal-verification signoff is claimed. Solidity's own verification documentation explains why external calls, hashes, and assembly require careful modeling; merely running a solver does not remove those trust boundaries. [Solidity formal-verification documentation](https://docs.soliditylang.org/en/latest/smtchecker.html).

## 4. Complete first-party function review

The table groups closely coupled helpers but accounts for every production component and its external surface. “Pass” is conditional on this report's assumptions; it does not override M-02 or the release decision.

| Component / functions | Review result |
|---|---|
| `ProtocolAuthority` constructor; inherited role grants/revokes/renunciation | Correct role initialization and standard access checks. Admin can reassign operational roles immediately; multisig independence must be reviewed externally. |
| Inherited admin transfer/cancel/accept and delay changes | Two-step scheduled transfer; correct old/new role replacement. Initial delay is two days, not an immutable minimum. Verifier checks active/pending unsafe reductions. |
| `ProtocolAccess` constructor and `onlyProtocolRole` | Rejects missing authority code; checks the exact requested role. Authenticity comes from deployment verification. |
| `MarketRegistry` constructor / `setResolutionController` | Quote decimals, one-time wiring, version, CTF, registry, and shared authority checked. |
| `createMarket`, `_validateConfig`, `_require18Decimals` | Immutable terms, quote identity, indexes, metadata, time, caps and executable witness validated; pre-preparation handled safely. |
| `computeMarketId`, `_positionId` | Deterministic protocol/chain/event/token/time/rules identity; CTF positions depend on M-02. Cap/metadata policy remains immutable within a created market, though not all such fields enter the market ID. |
| `openMarket`, `freezeMarket`, `freezeAtCutoff` | Correct caller/state/time gates; no reopening after freeze. |
| `beginResolution`, `markResolved`, `markRedeemable`, `archiveMarket` | Exact prepared approval and controller-only final transitions; once-only commitment consumption. |
| Registry getters / `_marketStorage`, `_requireState`, `_setState`, `_requireResolutionController` | Nonexistent markets rejected where required; trading view enforces state and time; events describe stored transitions. |
| `ManualResolutionController` constructor / `resolveMarket` / `hashResolution` / `_validPayout` | Correct graph checks, exact commitment/domain, three vectors, evidence bounds, once-only finalization, and atomic failure. Human factual correctness unverified. |
| `ConditionalExchange` constructor and three `configure*` methods | Dependency/authority compatibility and one-time assignment. Settlement approval is only to the configured immutable-code component. |
| `setTradingPaused`, `supportsInterface`, `cancelUpTo` | Role/argument checks; expected receiver declaration; monotone nonce invalidation. Nonce changes do not themselves return existing escrow. |
| `openOrder`, `openIOCOrder`, `_openOrder`, `_pullOrderFunding` | TIF/caller/market/signature/range/tick/step/cap checks before exact maker funding; replay blocked; expected claim receipt authenticated. |
| `matchOrders`, `matchIOCOrders`, `_executeMatch`, `_requireFillable` | Authorized matching; same market/book; crossing prices; remaining quantities; step alignment; expiry/nonces; resting sequence price. Cross-market and changed signed fields rejected. |
| `_consumeBuy`, `_consumeSell`, `_reduceOpenNotional` | Exact reserve formulas and telescoping counter reductions. Independent ghost accounting and arithmetic proofs support review. |
| `_approveSettlementAssets`, `_ensureSettlementApproval`, `_releaseBuyerImprovement` | Settlement-only allowance; exact improvement returned to maker in the original funding asset. Callback failure rolls back. |
| `cancelOrder`, `cancelOrderTo`, `_cancelOrder` | Maker authorization, checks-effects-interactions, exact remaining refund, alternate recipient validation, no replay. |
| Three direct stale releases; `cancelIOCRemainder`; `_requireIocRouter` | Correct stale-condition/router authorization; pause-independent recovery; fully filled IOC is not cancelled twice. |
| Exchange `hashOrder`, `getOrderState`, `_activePosition` | Configured validator hashing, read-only stored state, correct branch/side position selection. |
| `ConditionalSettlement` constructor / `settleFill` | Only immutable exchange may invoke; independent reentrancy guard; positive fill/destinations and trading window checked. |
| Settlement `_settleStock`, `_settleQuote` | Correct active/complement destinations in all funding/branch combinations; no admin withdrawal. |
| Settlement `_pullWhole`, `_pullClaim`, `_splitCollateral`, `_assertNoClaimBalance` | Exact balance deltas, authenticated receipt, bounded binary partition, exact temporary allowance/reset, no new whole-token residue or position residue. |
| `OrderValidator` constructor / `hashOrder` / `validate` / destination check | Exchange-domain EIP-712; ECDSA error/address checks; ERC-1271 success/length/magic checks; bounded ERC-165 admission. Dynamic wallet liveness remains an assumption. |
| `IOCRouter` constructor / `executeIOC` | Common authority, matcher-only, maximum 32 maker legs, matching array lengths/TIFs, atomic remainder return. One bad leg intentionally rolls back all legs. |
| `OrderRecoveryRouter` constructor, three batches, `_validateLength`, `_attemptRelease` | Maximum 64 entries; permissionless, no redirect; per-entry gas and returndata bounds; honest failures logged and isolated with sufficient batch gas. |
| `PositionRouter` constructor / `mergeForUser` / `redeemForUser` | Pulls only caller claims; exact amount/recipient/index checks; at most two indexes; nonreentrant; delta-based payouts; no residual position balance. |
| Position `_binaryPositionIds`, `_positionId`, `_requireNoPositionBalance` | Shallow binary IDs and bounded checks. General external CTF behavior still depends on M-02 and the selected collateral. |
| `ExpectedCtfReceiver` constructor, interface support, both callbacks, expectation helpers | Exact CTF sender/operator/from/ID(s)/amount(s), one-shot consumption, overlapping and missing callback rejection. Negative tests exercise authentication boundaries. |
| `PriceMath`, `MarketConfigMath`, constants, types, all ten interfaces | Rounding and range checks reviewed; ABI/enum mapping agrees with bindings; constructive arithmetic tested/proved within stated scope. |

Upstream CTF preparation, reporting, split, merge, redemption, ERC-1155 movement, and collection/position derivation were checked against the first-party assumptions. The exact artifact is used by all Solidity economic tests. The upstream collection cryptography is not certified by this table.

## 5. Verification evidence

### Execution and static analysis

These commands were run locally, including the `ci` Foundry profile. A hosted GitHub Actions run was not triggered or certified here.

| Check | Final result / evidence |
|---|---|
| Uncached Solidity build | Passed; all executable test artifacts regenerated. [Build log](evidence/clean-build.stdout.log) |
| CI Solidity tests | 88 passed, 0 failed, 0 skipped, 15 suites. [Full log](evidence/forge-ci.stdout.log) |
| Stateful CI campaigns | Trading: 1,000 × 128 calls; lifecycle: 1,000 × 128 calls; both zero unexpected reverts. Seed `0x20260906`. |
| Second-seed campaign / gas snapshot | All 88 tests passed in the default profile, including 32,768 additional stateful handler calls. Seed `0x5afe20260906`. [Log](evidence/snapshot.stdout.log) |
| Standalone arithmetic fuzz tests | 10,000 cases for each of two uint128 arithmetic properties; selected economic fuzz tests use explicit 256-case CI overrides. |
| TypeScript tests | 83 passed, 0 failed; 2,514 assertions. [Full test output](evidence/typescript-tests.stderr.log) |
| Workspace typechecking | Passed. [Log](evidence/typecheck.stdout.log) |
| Solidity lint | Passed without diagnostics after test cast checks were made explicit. [Log](evidence/forge-lint.stdout.log) |
| TypeScript formatting/lint | Passed. [Result](evidence/biome.result.json) |
| Z3 | Nine property negations unsatisfiable. [Output](evidence/arithmetic.stdout.log) |
| Slither | Analysis completed; 29 alerts individually reviewed. [Disposition of every alert](SLITHER-TRIAGE.md) |
| Local deployment rehearsal | 12 checks passed, only chain 31337/loopback Anvil. [Output](evidence/deployment.stdout.log) |
| Runtime deployability | All nine custom components below EIP-170. [Size output](evidence/forge-sizes.stdout.log) |
| Coverage execution | All 88 tests passed under the coverage build. [Summary](evidence/coverage.stdout.log), [LCOV](evidence/coverage.lcov) |

The handlers use three independently signed actors, both books and funding kinds, a bounded order population, and separate trading/lifecycle modes. Ghost fills and cancellations are recorded from successful requested actions, not copied from exchange accounting. Every invariant evaluation reconciles per-order reserves/notional/status, wallet/market totals, exact exchange whole-token/claim escrow, router/settlement residue, collateral conservation, and resolution finality. Aggregate YES/NO balances across all modeled holders must match the CTF backing before resolution; afterward the remaining aggregate payout obligation cannot exceed it. Eligible fills verify actual recipient deltas and maker-price bounds. At the end of every sequence, an `afterInvariant` sweep cancels every remaining maker order and checks that exchange escrow/open notional is fully recoverable, including paused/finalized states reached by the sequence.

The 256,000 count is **handler calls**, not 256,000 successful economic transitions. Some calls return early when preconditions do not hold. The deterministic reachability test and seeded real trades address trivial vacuity, but do not make finite fuzzing exhaustive. The campaign restricts prices/quantities/actors and is not a proof over all markets, arbitrary callback code, or all uint128 states. This use of handlers/ghost state follows the [Foundry invariant-testing model](https://getfoundry.sh/forge/invariant-testing?highlight=invariant).

### Coverage and its limits

Production `src/` only, excluding fixture/harness rows:

| Metric | Observed |
|---|---|
| Lines | 659 / 704 — 93.61% |
| Statements | 888 / 966 — 91.93% |
| Branches | 78 / 141 — 55.32% |
| Functions | 95 / 96 — 98.96% |

The tool's overall table, which also includes harnesses, reports 95.38% lines and 59.20% branches. Those totals must not be mislabeled production-only coverage. `--ir-minimum` emits a source-mapping accuracy warning. The raw recovery assembly is not reliably represented by line/branch counters; its adversarial regressions passed, but that does not justify claiming unmeasured branches were covered. Branch coverage is not complete, and remaining defensive/malicious-dependency paths need further independent review. No coverage percentage is treated as a security certificate.

### Runtime sizes

| Contract | Runtime bytes |
|---|---:|
| ConditionalExchange | 23,050 |
| MarketRegistry | 13,145 |
| ConditionalSettlement | 7,089 |
| PositionRouter | 5,344 |
| ProtocolAuthority | 4,261 |
| ManualResolutionController | 3,708 |
| OrderValidator | 2,794 |
| IOCRouter | 2,658 |
| OrderRecoveryRouter | 2,272 |

The exchange has 1,526 bytes of EIP-170 headroom. Test harnesses are intentionally much larger and are excluded from deployability checks. Runtime template hashes in `scope.json` contain unpatched immutables and are **not** deployed-runtime allowlist values. Rehearsal manifests contain actual installed runtime hashes and the exact constructor arguments used to reconstruct them.

## 6. Reproduction instructions

Run from the workspace root with the locked Bun dependencies installed. Keep separate compiler/cache directories for independent analysis; do not run artifact-mutating Forge commands concurrently.

```bash
bun audit/2026-09-06/remediation/verification/run-checks.ts forge-lint
bun audit/2026-09-06/remediation/verification/run-checks.ts clean-build
bun audit/2026-09-06/remediation/verification/run-checks.ts forge-format
bun audit/2026-09-06/remediation/verification/run-checks.ts forge-sizes
bun run generate:bindings
bun audit/2026-09-06/remediation/verification/run-checks.ts forge-ci
bun audit/2026-09-06/remediation/verification/run-checks.ts typescript-tests
bun audit/2026-09-06/remediation/verification/run-checks.ts typecheck
bun audit/2026-09-06/remediation/verification/run-checks.ts biome
bun audit/2026-09-06/remediation/verification/run-checks.ts coverage
```

Install `z3-solver==5.1.0.0` and `slither-analyzer==0.11.6` in an isolated Python environment. Set `AUDIT_PYTHON` and `AUDIT_SLITHER` to its executables, and `VIRTUAL_ENV` to that environment when running Slither. For static analysis, set `AUDIT_BUILD_DIRECTORY` to a fresh scratch directory and run `slither-build` followed by `slither` through the evidence runner. The arithmetic check is named `arithmetic`. The `snapshot` check regenerates `.gas-snapshot` with a separate deterministic default-profile seed. `capture-scope.ts` records final source identities.

For deployment rehearsal, start a **fresh isolated Anvil** at `127.0.0.1:18546`, chain 31337, with its public development mnemonic; then run the `deployment` check. This test deploys only mocks/local components, advances local time, deliberately changes local code temporarily, tests role/delay tampering, and restores the tampered local state. It must never be pointed at a network holding value. Read the [deployment runbook](../../../docs/runbooks/deployment.md) before using any administrative script elsewhere.

The runner writes command, timestamps, explicit environment overrides, exit status, stdout and stderr into `evidence/`. For independent reruns, set `AUDIT_EVIDENCE_DIRECTORY` to a fresh output directory to preserve this report's snapshots. Slither refuses to reuse an existing raw-result path. The runner does not emit private environment values. The formatter excludes generated remediation evidence and the historical reproduction snapshot so verification does not rewrite audit evidence; production/test/tooling source remains checked.

## 7. Migration and release gates

Before any release:

1. Close **M-02** with independent specialist evidence for the exact custody dependency or a separately audited replacement. Keep the production tooling gate in place until a reviewed decision changes it.
2. Obtain an independent Solidity/remediation audit against the source digest above. This report was produced by the same assistant that made the changes and is not organizationally independent.
3. Verify exact USDG/Stock Token code, proxies/implementations if any, decimals, boolean returns, raw-unit/rebase behavior, pause/blacklist authority, callback behavior, approvals, funding, settlement, cancellation, merge and all redemption vectors on the target chain at pinned state. Standard mocks cannot establish these facts.
4. Review real multisig owners, thresholds, role separation, deployment signer isolation, current/pending governance delays, RPC trust, finality, and incident procedures. EOA Anvil actors test role logic, not multisig security.
5. Reconcile the complete new deployment graph and role history from trusted chain evidence after final admin acceptance. Verify all bytecode and constructor arguments from a clean build; archive the acceptance receipt and final checks.
6. Treat old deployments as old deployments. They are not upgradeable. Use a deliberate wind-down/recovery and fresh deployment migration; do not relabel the historical manifest as remediated or automatically move user funds. New exchange-domain signatures are required.
7. Roll out exact-fill simulation, repeat-failure quarantine, direct recovery instructions, and monitored live-order versus outstanding-exposure accounting. Never describe open-order caps as loss/TVL caps.
8. Continue adversarial coverage and independent symbolic/full-program verification if a whole-contract formal assurance claim is required. The nine formula proofs do not satisfy that stronger claim.

## Final opinion

The remediated application code has materially stronger approval binding, configuration safety, recovery isolation, dependency verification, and executable security tests. The original application-level reproductions are addressed as described, and the additional recovery-batch denial of service is fixed. No additional confirmed first-party theft or insolvency exploit was identified under the stated assumptions.

**A clean production-security opinion cannot be issued. M-02 remains open, arbitrary receiver/token liveness is not guaranteed, exact target-token integration is unverified, and whole-program formal correctness has not been established.** The appropriate handoff is this source-identified remediation with reproducible evidence and an explicit release block—not a claim that smart-contract risk has been eliminated.
