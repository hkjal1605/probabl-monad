# Conditional Stocks V1 Smart Contract Security Audit

**Review date:** 2026-09-06  
**Review type:** Manual source-level security audit, invariant analysis, dependency review, and executable proof-of-concept testing  
**Code status:** Pre-deployment  
**Production Solidity scope digest:** `30826606edf2cbb6ea70f7a5909e2e92679b37ea02eb6d476b91b24bff344586`  
**Finding status:** Unremediated at the reviewed snapshot

## Executive assessment

The custom protocol contracts have a sound core collateral model under the documented token and
administrator assumptions. I did not find a demonstrated path by which an unprivileged account can
steal another user's escrow, create an underfunded exchange order, overfill an order, bypass a signed
price, replay an order across a chain or exchange, or invoke an arbitrary administrator withdrawal.
The whole-funded and claim-funded YES/NO settlement permutations conserve the intended assets, and
failed external transfers revert the fill and its preceding accounting atomically.

The reviewed snapshot is **not ready to receive production funds**. The market administrator's
resolution preparation does not constrain what the separate resolution administrator finally
submits. The pinned Gnosis Conditional Tokens dependency also retains a collection-ID construction
that its included specialist audit calls a major security concern because the cited multiset-hash
proof does not apply to that construction. That dependency report found no concrete attack, so this
is an assurance blocker rather than a claimed working exploit.

Four low-severity findings affect market-creation availability, executable-liquidity integrity,
configuration liveness, and deployment hardening. Two informational findings identify the exact
limits of the onchain cap system and gaps between the planned and current verification program.

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 4 |
| Informational | 2 |

The recommended release decision is:

1. Remediate M-01 and add regression tests.
2. Obtain and document a specialist cryptographic disposition for M-02 against the exact CTF
   bytecode, or replace it with an independently audited implementation before deployment.
3. Remediate L-01 through L-04 before the first production market.
4. Resolve I-01 at the product/specification level and complete the stateful testing in I-02.
5. Repeat the full audit against a clean, version-controlled release candidate and exact deployment
   bytecode.

## Scope and snapshot

The repository was not a usable Git checkout during review, so no commit identifier was available.
The digest above is the SHA-256 of a sorted list containing the path and SHA-256 of every production
Solidity source under `packages/contracts/src`. Individual hashes and the reviewed specification,
test, script, and configuration files are recorded in
[`evidence/scope-manifest.json`](./evidence/scope-manifest.json).

### Specifications reviewed in full

- [`CONDITIONAL_STOCKS_IMPLEMENTATION_PLAN.md`](../../../CONDITIONAL_STOCKS_IMPLEMENTATION_PLAN.md),
  all 1,763 lines.
- [`plans/README.md`](../../../plans/README.md) and every milestone file from
  [`plans/00-dependency-validation.md`](../../../plans/00-dependency-validation.md) through
  [`plans/15-capped-mainnet-pilot.md`](../../../plans/15-capped-mainnet-pilot.md).
- The contract-facing architecture, risk-cap, deployment, recovery, evidence, and security documents
  were used to resolve intended behavior where the top-level plans were ambiguous.

### First-party Solidity reviewed in full

| Area | Files | Lines |
| --- | --- | ---: |
| Executable contracts | `ConditionalExchange`, `ConditionalSettlement`, `IOCRouter`, `ManualResolutionController`, `MarketRegistry`, `OrderRecoveryRouter`, `OrderValidator`, `PositionRouter`, `ProtocolAuthority` | 1,773 |
| Interfaces | all files under `src/interfaces` | 197 |
| Libraries | `PriceMath`, `ProtocolConstants`, `ProtocolRoles` | 44 |
| Types and utilities | `ProtocolTypes`, `ExpectedCtfReceiver`, `ProtocolAccess` | 246 |
| **Total** | all `src/**/*.sol` | **2,260** |

Every original Solidity test, fixture, and mock was also read. The deployment, market-creation, and
manual-resolution scripts and their configuration were reviewed as supporting security-critical
code. The audit added
[`test/AuditFindings.t.sol`](../../../packages/contracts/test/AuditFindings.t.sol), containing only
reproduction tests; no production contract was modified.

### Dependency boundary reviewed

- `@gnosis.pm/conditional-tokens-contracts` **1.0.3**, including all lines of its local
  `ConditionalTokens.sol`, `CTHelpers.sol`, bundled ERC-1155 implementation/interfaces, and both
  bundled audit reports. The pinned artifact's runtime bytecode hash is
  `0xadf1ee4719c637975ba08765e3a1187f2fb865c9b17386005960a81ff29cfcc7`.
- `@openzeppelin/contracts` **5.6.1** call sites and imported security primitives: access control,
  default-admin rules, `SafeERC20`, `ReentrancyGuard`, `ECDSA`, ERC-1271/ERC-1155 interfaces,
  `Math.mulDiv`, `SafeCast`, and their relevant transitive paths.
- The legacy `openzeppelin-solidity` **2.3.0** paths reachable from Conditional Tokens. The repository's
  exception for `ERC165Checker` is consistent with the reviewed import graph: that component is not
  present in the pinned CTF runtime path.

This report does not independently re-audit every unrelated file in either third-party package. It
reviews the exact dependency code and behaviors reachable through this protocol.

### Exclusions and limits

- No production deployment, Robinhood Chain state, USDG implementation, or Stock Token implementation
  existed to inspect. Token pause, blacklist, proxy, rebase, multiplier, fee, and return-value behavior
  therefore remains an explicit deployment assumption.
- The matcher, API, indexer, UI, evidence service, and relayer were consulted where they mitigate a
  contract finding, but they were not fully audited here.
- This was not a machine-checked proof in Coq, K, Certora, Halmos, or an SMT model checker. “Formal” in
  this report means that state transitions, authorization predicates, arithmetic bounds, and asset
  conservation were stated and checked systematically against every first-party function.
- Slither, Aderyn, and Semgrep were not installed in the workspace. Their absence does not invalidate
  a manual finding, but it reduces tool diversity.

## Methodology

The review used the following passes:

1. Derived intended state machines, trust boundaries, asset flows, and invariants from the main plan
   and all milestone plans.
2. Read every first-party Solidity line and mapped every public, external, internal, and private
   function to authorization, state reads/writes, external calls, and failure behavior.
3. Proved the reservation and execution rounding relationship and checked all integer ranges,
   additions, subtractions, casts, loop bounds, and unchecked blocks.
4. Traced all eight branch/side/funding combinations through exchange and settlement, including
   partial fills, price improvement, cancellation, IOC rollback, merge, and redemption.
5. Reviewed EIP-712 domain separation, ECDSA/ERC-1271 validation, nonce invalidation, replay handling,
   and onchain sequence pricing.
6. Reviewed role compromise boundaries, one-time wiring, market lifecycle transitions, pause/freeze
   behavior, and resolution finality.
7. Traced every ERC-20 and ERC-1155 interaction through callback and reentrancy boundaries and into
   the pinned CTF implementation.
8. Read the complete existing test suite, ran high-fuzz tests, measured coverage and bytecode size,
   and wrote executable reproductions for reachable findings.

## Threat model used for severity

Untrusted actors include traders, relayers, arbitrary recipients, permissionless recovery callers,
and accounts interacting directly with CTF. The matcher, guardian, market administrator, resolution
administrator, and default administrator are privileged, but the review still tests whether one role
can exceed the separation promised by the plans. The resolution administrator is deliberately a
trusted manual oracle and can report a factually wrong structurally valid result; findings do not
pretend that v1 removes this disclosed trust.

The accounting conclusions assume collision resistance of Keccak-256, security of ECDSA, correct EVM
execution, the exact pinned dependency bytecode, and listed tokens with the tested 18-decimal,
non-fee, non-rebasing, boolean-return behavior. A finding requiring a privileged deployment mistake
or a recipient-controlled revert is rated below a permissionless theft of correctly configured funds.

## Findings summary

| ID | Severity | Finding | Demonstrated |
| --- | --- | --- | --- |
| M-01 | Medium | Resolution preparation does not bind the final evidence, URI, or payout | Yes |
| M-02 | Medium | Pinned CTF retains a collection-ID construction without the cited proof | Upstream audit; no concrete exploit claimed |
| L-01 | Low | Permissionless CTF preparation can block exact market creation | Yes |
| L-02 | Low | An order can name an ERC-1155 destination that makes every fill revert | Yes |
| L-03 | Low | Registry validation accepts markets with no openable order or no possible match | Yes |
| L-04 | Low | Deployment and one-time wiring checks do not prove exact dependency identity | Source review |
| I-01 | Informational | Onchain “market” caps cover live orders, not filled exposure or total CTF collateral | Yes; documented behavior |
| I-02 | Informational | Planned stateful invariants and adversarial branch coverage are incomplete | Test review |

## M-01 — Resolution preparation does not bind the final evidence, URI, or payout

**Affected code:**

- [`MarketRegistry.beginResolution`](../../../packages/contracts/src/MarketRegistry.sol#L243)
- [`MarketRegistry._setState`](../../../packages/contracts/src/MarketRegistry.sol#L391)
- [`ManualResolutionController.resolveMarket`](../../../packages/contracts/src/ManualResolutionController.sol#L56)
- [Reproduction](../../../packages/contracts/test/AuditFindings.t.sol#L34)

`beginResolution` receives `evidencePreparationHash`, but `_setState` only emits it in
`MarketStateChanged`. It is not retained in contract storage. `resolveMarket` later accepts any
nonzero `evidenceHash`, any nonempty URI up to 512 bytes, and any of the three valid payout vectors.
It never compares those values with what the market administrator prepared.

The reproduction commits `APPROVED_PACKET`, resolves with `SUBSTITUTED_PACKET`, and reaches
`REDEEMABLE`. The same weakness also permits reusing the approved evidence hash while changing the
payout or URI, because the controller cannot validate that those arguments are the contents committed
by the hash.

The offchain admin-evidence service mitigates this in its normal path: it generates both calls from
the same packet, checks Safe calldata byte-for-byte, and reconciles the final event. A resolution-admin
transaction sent directly to the controller bypasses those checks. Consequently, the onchain
four-eyes split reduces to “market admin allowed some resolution” rather than “market admin approved
this exact resolution.” A compromised or mistaken resolution-admin multisig can finalize a different
outcome after the market-admin multisig has approved the correct packet.

This does not give an unprivileged caller resolution power, and a factually wrong resolution is already
a disclosed manual-oracle risk. The severity is Medium because the defect defeats a specifically
designed independent approval boundary and the resulting payout is irreversible.

**Recommendation:** Store a domain-separated commitment to the complete final call when resolution
begins, for example:

```text
keccak256(abi.encode(
  "CONDITIONAL_STOCKS_RESOLUTION_V1",
  block.chainid,
  address(resolutionController),
  marketId,
  yesPayout,
  noPayout,
  payoutDenominator,
  evidenceHash,
  keccak256(bytes(evidenceUri))
))
```

Have `resolveMarket` recompute and consume exactly that commitment before calling CTF. Comparing only
`evidenceHash` is insufficient because the contract cannot infer the associated payout or URI from a
hash. Emit the commitment and keep a readable prepared-evidence hash if both are useful operationally.
Test different hash, vector, URI, market, controller, and chain domains, plus successful exact
consumption and replay rejection.

## M-02 — Pinned CTF retains a collection-ID construction without the cited proof

**Affected dependency:**

- [`CTHelpers.sol`, lines 388–424](../../../packages/contracts/node_modules/@gnosis.pm/conditional-tokens-contracts/contracts/CTHelpers.sol#L388)
- [Bundled specialist audit](../../../packages/contracts/node_modules/@gnosis.pm/conditional-tokens-contracts/docs/audit/2020-01-20_accumulator_audit.pdf)
- [Bundled earlier audit](../../../packages/contracts/node_modules/@gnosis.pm/conditional-tokens-contracts/docs/audit/AuditReport-ConditionalTokens.md)
- [Official Gnosis source](https://github.com/gnosis/conditional-tokens-contracts/blob/master/contracts/CTHelpers.sol)

Conditional Tokens relies on collection IDs to keep claims for different outcome collections
distinct. Its earlier audit found two critical collision/reentrancy constructions; the reviewed
version contains the documented burn-before-mint and elliptic-curve multiset-hash changes that address
those particular attacks.

The later specialist audit evaluates the replacement. It reports no critical Solidity issue and no
concrete attack, but categorizes the current `getCollectionId` mapping as a **major security concern**.
The implementation starts from `keccak256(conditionId,indexSet)` and increments the candidate field
element until it maps to a curve point. The report explains that the security proof cited for the
multiset hash does not apply to this modified map and recommends an increment-then-hash construction
with its own proof. The pinned 1.0.3 source still contains the questioned construction.

Conditional Stocks itself creates only shallow binary positions with a zero parent collection. That
does not isolate its collateral from this issue: CTF is permissionless, and any account can construct
deeper positions using the same CTF and collateral. A practical collection-ID collision could alias
positions and break the assumption that each claim corresponds to one unique collateral/collection
pair. The potential impact is systemic to all collateral held by that CTF instance.

No such collision or fund-loss exploit was found or claimed in this review. The Medium rating reflects
the custody blast radius and missing cryptographic assurance, not a claim that the construction is
currently breakable.

**Recommendation:** Before value is deposited, commission a cryptographic review of the exact
`0xadf1…fcc7` runtime or select an implementation for which the collection-ID construction has a
current, applicable proof and independent code audit. Do not apply a local algorithm change without
an audit: it changes position IDs and compatibility. A separate instance of the same permissionless
code does not remove the concern, because outsiders can still exercise its complex-position surface.
If v1 does not need compositional positions, a deliberately restricted, separately audited shallow
binary implementation is another design option.

## L-01 — Permissionless CTF preparation can block exact market creation

**Affected code:**

- [`MarketRegistry.createMarket`, lines 117–140](../../../packages/contracts/src/MarketRegistry.sol#L117)
- [Reproduction](../../../packages/contracts/test/AuditFindings.t.sol#L21)

The local question ID and CTF condition ID are deterministic from public market terms. CTF's
`prepareCondition` is permissionless and reverts when the exact condition is already prepared.
`createMarket` always calls `prepareCondition` and has no already-prepared path.

An attacker can calculate the pending market's `(controller, localQuestionId, 2)` tuple and prepare it
first. The market administrator's exact `createMarket` then reverts. The attacker does not become the
oracle and cannot alter payouts, but can repeatedly force terms to be reviewed and changed or require
private transaction delivery. This affects creation availability, not existing funds.

**Recommendation:** Compute `conditionId` first and query `getOutcomeSlotCount`. Prepare only when the
slot count is zero; accept an existing condition only when it is the exact derived binary condition
and remains unresolved. Because controller, question ID, and slot count are all inputs to the ID,
adopting that exact pre-prepared condition does not give its preparer any privilege. Retain the current
duplicate-market check and add front-run and pre-resolved-state tests.

## L-02 — An order can name an ERC-1155 destination that makes every fill revert

**Affected code:**

- [`ConditionalExchange._openOrder`, lines 318–381](../../../packages/contracts/src/ConditionalExchange.sol#L318)
- [`ConditionalSettlement._settleStock`, lines 82–118](../../../packages/contracts/src/ConditionalSettlement.sol#L82)
- [`ConditionalSettlement._settleQuote`, lines 120–156](../../../packages/contracts/src/ConditionalSettlement.sol#L120)
- [Reproduction](../../../packages/contracts/test/AuditFindings.t.sol#L97)

Order opening checks that `maker` and `recipient` are nonzero and are not the exchange. It does not
check whether addresses that will receive CTF claims accept ERC-1155 safe transfers. Every fill sends
an active claim to each signed recipient. Whole-funded settlement also returns an inactive claim to
the buyer maker or seller maker. Therefore:

- any maker can deliberately set a recipient contract that rejects ERC-1155;
- an ERC-1271 maker funding with whole collateral may itself lack ERC-1155 receiver support; and
- a receiver can change behavior after an order opens.

The order is fully funded and appears open, but every attempted fill reverts. Only its maker can cancel
it before nonce invalidation, expiry, or market closure. This can advertise non-executable top-of-book
liquidity and repeatedly revert naive matcher batches. The matcher can simulate and quarantine it, and
the attacker cannot steal funds, so severity is Low.

A contract maker that later rejects ERC-1155 can also prevent return of its own active-claim escrow on
cancellation. That is self-inflicted custody loss, but it should be made explicit to smart-wallet users.

**Recommendation:** Define a supported destination policy. At minimum, probe ERC-165
`IERC1155Receiver` support for every contract address that may receive a claim (`recipient`, and the
whole-funded maker) and reject obvious incompatibility at open. A probe cannot guarantee future
behavior, so the matcher must still simulate, quarantine failures, and exclude them from executable
depth. A stronger v1 policy can restrict claim destinations to a tested account set. Add toggling
receiver, gas-griefing receiver, smart-wallet maker, failed-fill, and cancellation-return tests.

## L-03 — Registry validation accepts markets with no openable order or no possible match

**Affected code:**

- [`MarketRegistry._validateConfig`, lines 333–367](../../../packages/contracts/src/MarketRegistry.sol#L333)
- [No-two-sided-cap reproduction](../../../packages/contracts/test/AuditFindings.t.sol#L129)
- [No-openable-order reproduction](../../../packages/contracts/test/AuditFindings.t.sol#L167)

The registry checks cap ordering and only requires
`quoteDown(baseStep, priceTickX18) > 0`. It does not prove that any tick/step-aligned order can fit
between `minNotional` and `maxOrderNotional`, or that two minimum valid orders can coexist under
`maxMarketOpenNotional`.

Two accepted configurations demonstrate the gap:

1. `baseStep = 1`, `priceTick = 101`, and `maxOrderNotional = 100` admits market creation, but the
   cheapest permitted order already exceeds the maximum. No order can open.
2. `minNotional = maxOrderNotional = maxWalletOpenNotional = maxMarketOpenNotional = 100` lets one
   side open, consumes the whole market cap, and makes every opposing valid order revert. No match can
   ever exist.

Only the market administrator can create this state, and no user funds need be accepted in the first
case. The second case can temporarily escrow one maker's assets until cancellation. This is an
administrative liveness/configuration defect.

**Recommendation:** Derive the smallest executable tick/step-aligned notional during validation and
require it to fit the per-order and wallet caps. Require the market cap to accommodate at least one
valid order on each side simultaneously. A conservative `2 * maxOrderNotional` market rule is simple;
a less restrictive implementation should safely calculate `2 * minimumExecutableNotional` with
`uint256`/`mulDiv` and prove an actual aligned quantity/price exists. Mirror the calculation in the
creation CLI and fuzz tick, step, min, max, and `uint128` boundaries.

## L-04 — Deployment and one-time wiring checks do not prove exact dependency identity

**Affected code:**

- [`scripts/deploy-v1.ts`, lines 86–98](../../../packages/contracts/scripts/deploy-v1.ts#L86)
- [`scripts/lib.ts`, lines 108–115](../../../packages/contracts/scripts/lib.ts#L108)
- [`MarketRegistry.setResolutionController`](../../../packages/contracts/src/MarketRegistry.sol#L101)
- [`ConditionalExchange` constructor/configuration](../../../packages/contracts/src/ConditionalExchange.sol#L121)

When an existing CTF address is supplied, deployment checks only that code exists, then records its
hash. It does not compare that hash with the pinned runtime before permanently constructing the
registry, controller, exchange, settlement, and routers around it. The runbook asks an operator to
compare hashes later, which can detect a bad deployment before funding but cannot repair its immutable
wiring.

Onchain compatibility checks likewise prove selected getters rather than implementation identity.
In particular, `setResolutionController` checks controller version, CTF, and registry but does not
check that the controller uses the registry's `ProtocolAuthority`. The exchange verifies its
registry's CTF but not that both use the same authority. A wrong but superficially compatible
component can split role control, validate unauthorized orders, resolve through the wrong multisig,
or receive permanent token approvals. Exploitation requires a trusted setup error or compromised
default administrator, so severity is Low despite the high potential impact.

**Recommendation:** Make the pre-funding verification executable and fail closed:

- compare an external CTF runtime hash with the exact reviewed hash before deploying dependants;
- read back and compare every immutable address and authority immediately after deployment;
- extend controller and registry interfaces/checks to compare `authority()` where a common authority
  is required;
- compare deployed custom runtime with reproducible expected runtime while accounting for immutable
  references;
- verify role membership and complete the delayed admin handover before market creation; and
- bind the published manifest to the audited source digest, compiler settings, constructor arguments,
  and transaction receipts.

## I-01 — Onchain “market” caps cover live orders, not filled exposure or total CTF collateral

**Affected code and specification:**

- [`ConditionalExchange._openOrder`, lines 342–379](../../../packages/contracts/src/ConditionalExchange.sol#L342)
- [`ConditionalExchange._reduceOpenNotional`, lines 500–510](../../../packages/contracts/src/ConditionalExchange.sol#L500)
- [`docs/architecture/risk-caps.md`](../../../docs/architecture/risk-caps.md)
- [Demonstration](../../../packages/contracts/test/AuditFindings.t.sol#L52)

Opening adds each order's limit notional to the wallet and market counters. Every fill removes the
filled portion from both counters, even though newly split collateral remains locked in CTF and users
continue to hold conditional exposure. Three sequential 200-USDG fills therefore leave
`marketOpenNotional == 0` after each fill while CTF holds 600 USDG for a market configured with a 400
USDG open-notional cap.

This is consistent with the field names and the dedicated risk-cap document, which explicitly says
the counters cover live orders only. It is not an escrow bypass or undercollateralization issue. It is
included because the main implementation plan and capped-pilot plan also describe “strict market-wide
collateral/notional caps” as the reliable Sybil-resistant pilot control. Those phrases can reasonably
be read as limiting filled exposure, which the contracts do not do.

Actual condition-wide issuance cannot be capped by this exchange while using permissionless standard
CTF: users can call `splitPosition` directly. Exchange-routed cumulative fill volume, gross
whole-collateral split volume, and daily venue volume are enforceable, but currently rely on the
matcher, monitoring, and guardian response.

**Recommendation:** Use one consistent name and promise everywhere. If the intended control is live
book utilization, retain the code and call it `maxMarketOpenOrderNotional`. If the pilot requires a
hard venue-exposure limit, add nondecreasing per-market and per-epoch fill/split counters checked
before settlement; do not decrement them merely because an order filled. If total CTF issuance itself
must be bounded, standard permissionless CTF cannot provide that property and the architecture must
change. Document which limits are contract-enforced, matcher-enforced, and monitored.

## I-02 — Planned stateful invariants and adversarial branch coverage are incomplete

The suite is strong for its size and all tests pass, but it contains no Foundry invariant handler or
`invariant_*` test even though the plans list stateful invariants as an audit gate. Coverage measured
with the required `--ir-minimum` workaround was 92.01% of lines, 89.28% of statements, 96.64% of
functions, and only 41.55% of branches. Foundry warns that this mode can make source mappings
inaccurate.

The audit reproductions cover six missing adversarial cases, but a finite set of examples does not
replace stateful sequences. Before deployment, add handlers that randomly interleave open, partial
fill, IOC, cancel, nonce invalidation, expiry, pause, freeze, release, split, merge, resolution, and
redeem while continuously checking:

- each order's `reserved` and `openNotional` formula;
- wallet/market counters equal the sum of live order states;
- exchange ERC-20/ERC-1155 balances equal attributable reservations;
- settlement has no residual claim or newly received whole-collateral balance;
- terminal orders never become open and no order overfills;
- every successful fill respects both limits and maker sequence;
- pause/freeze never removes maker or permissionless recovery paths;
- condition payout and market finalization occur once; and
- arbitrary callback reverts preserve all pre-call balances and state.

Run those invariants with the exact CTF artifact and fork/testnet versions of USDG and each Stock
Token. Add at least one independent analyzer and repeat manual review after remediation.

## Accounting and invariant results

### Range and overflow analysis

Order quantity and price are `uint128`. Their maximum product is
`(2^128 - 1)^2 = 2^256 - 2^129 + 1`, which is below `uint256` maximum. `PriceMath` nevertheless uses
OpenZeppelin's full-precision `Math.mulDiv`. Division by the nonzero constant `1e18` is safe.
Financial additions use Solidity 0.8 checked arithmetic; cap comparisons occur before funding.
Reservation and counter subtractions follow monotonic remaining quantities and revert on any broken
invariant. No exploitable overflow, underflow, truncating cast, signed-integer error, or division by
zero was found in first-party code.

The only first-party `unchecked` arithmetic increments `marketCount`. Reaching overflow requires
`2^256` successful market creations and is not feasible. Sequence increments reject the
`uint64.max` boundary before increment; bounded IOC and recovery loops use lengths of 32 and 64.

### Bid reservation proof

Let `W = 1e18`, old quantity `q`, fill `f`, bid limit `L`, and execution price `P <= L`.

```text
old reserve = ceil(qL/W)
execution   = floor(fP/W)
new reserve = ceil((q-f)L/W)
```

Because `floor(fP/W) <= floor(fL/W)` and
`floor(x) + ceil(y) <= ceil(x+y)`, execution plus the new reserve cannot exceed the old reserve.
`_consumeBuy` checks the inequality again before subtraction. Its remainder is precisely price and
rounding improvement returned to the maker. The sell reservation starts at `q` and decreases by
exactly `f`. Partial-fill fuzzing confirms these relationships at integer boundaries.

Execution rounds down by less than one raw quote unit per fill. A seller split across `n` fills can
receive up to `n` raw units less than the exact rational sum; at 18 decimals this is economically tiny
but deterministic. The configured `quoteDown(baseStep, priceTick) > 0` prevents a valid step/tick fill
from rounding to zero.

### Settlement conservation

| Funding path | Asset consumed | Active output | Inactive output | Result |
| --- | --- | --- | --- | --- |
| Whole-funded stock ask | `q` base | `q` branch stock to buyer recipient | `q` opposite stock to seller maker | Pass |
| Claim-funded stock ask | `q` active stock claim | same claim to buyer recipient | none created | Pass |
| Whole-funded quote bid | execution quote | branch quote to seller recipient | opposite quote to buyer maker | Pass |
| Claim-funded quote bid | active quote claim | same claim to seller recipient | none created | Pass |

YES and NO choose the corresponding active position symmetrically. Splitting is 1:1, and the
settlement contract checks that no expected claim remains and that its whole-token balance returns to
the pre-pull value. State is consumed before settlement; any pull, split, callback, recipient, or
improvement-transfer failure reverts the complete transaction.

### Resolution and redemption

The controller admits only `[1,0]/1`, `[0,1]/1`, and `[1,1]/2`, and CTF finalizes a condition once.
The registry transition is one-way. M-01 is the failure to bind the prepared resolution, not a payout
arithmetic error.

For invalid `[1,1]/2`, CTF floors each claim redemption. Redeeming unequal or odd claim quantities
separately can leave less than two raw collateral units in CTF; merging an equal complete set returns
the full raw collateral. This is expected integer behavior and should remain in UI previews.

### Recovery and pause

The exchange pause blocks new opens and fills only. Maker cancellation, permissionless expiry release,
nonce-invalidated release, closed-market release, direct CTF merge, and direct CTF redemption remain
available. Market freeze is one-way and turns every open escrow into a permissionlessly releasable
order. Token-level pauses or blacklists can still block the affected token's transfer or redemption;
that is an external asset assumption, not an exchange pause property.

## Function-by-function review

“Pass” means no independent finding after considering the assumptions and findings above. Compiler-
generated constant, immutable, and mapping getters are read-only and were checked for type/meaning.
Interface files contain no executable logic; every declared selector used by the protocol was matched
against its implementation or pinned dependency.

### ProtocolAuthority and access utilities

| Function/surface | Result |
| --- | --- |
| `ProtocolAuthority.constructor` | Pass; nonzero operational roles and two-day default-admin transfer delay. Duplicate role holders remain possible at contract level and are prevented by the deploy script. |
| Inherited `hasRole`, `getRoleAdmin`, `grantRole`, `revokeRole`, `renounceRole`, `supportsInterface` | Pass under trusted default-admin assumption. Ordinary grants/revocations are immediate, as disclosed in `SECURITY.md`. |
| Inherited `defaultAdmin`, `pendingDefaultAdmin`, `defaultAdminDelay`, `pendingDefaultAdminDelay`, `defaultAdminDelayIncreaseWait` | Read-only; pass. |
| Inherited `beginDefaultAdminTransfer`, `cancelDefaultAdminTransfer`, `acceptDefaultAdminTransfer`, `changeDefaultAdminDelay`, `rollbackDefaultAdminDelay` | Pass against OpenZeppelin 5.6.1 semantics; deployment handover still requires operational verification. |
| `ProtocolAccess.constructor`, `onlyProtocolRole` | Pass; rejects zero/non-contract authority and checks the exact role on every guarded call. See L-04 for cross-component authority identity. |

### MarketRegistry

| Function | Result |
| --- | --- |
| `constructor` | Pass for address/code/18-decimal quote checks; exact token identity remains deployment responsibility. |
| `setResolutionController` | One-time and dependency-gated; L-04 for missing common-authority/code identity. |
| `createMarket` | Correct deterministic identity, immutable storage, positions, and events; L-01 for pre-preparation DoS. |
| `openMarket` | Pass; market-admin only, exact scheduled state, and `[open, cutoff)` time gate. |
| `freezeMarket` | Pass; guardian/market-admin only, nonzero reason, scheduled/open only. |
| `freezeAtCutoff` | Pass; permissionless only after cutoff from open state. |
| `beginResolution` | M-01; role and state checks pass, commitment persistence fails. |
| `markResolved`, `markRedeemable` | Pass; exact configured controller and sequential states. |
| `archiveMarket` | Pass; admin, nonzero reason, redeemable only; direct redemption/recovery remains possible after archive. |
| `computeMarketId` | Pass; byte-for-byte matches the specified version/chain/token/Polymarket/time/rules schema and golden vectors. |
| `getMarket`, `marketState`, `isTradingOpen` | Pass; missing market handling is intentional (`isTradingOpen` returns false). |
| `_positionId` | Pass subject to M-02. |
| `_validateConfig`, `_require18Decimals` | Address, mapping, metadata, time, tick, step, and ordered-cap checks pass; L-03 for feasibility gaps. |
| `_marketStorage`, `_requireState`, `_setState`, `_requireResolutionController` | Pass, except `_setState` is only an event anchor for M-01. |

### ConditionalExchange

| Function | Result |
| --- | --- |
| `constructor` | CTF/registry consistency passes; L-04 for common-authority identity. |
| `configureOrderValidator`, `configureSettlement`, `configureIocRouter` | One-time, role-gated, and getter-compatible; L-04 for exact implementation verification. Settlement approvals are intentionally permanent. |
| `supportsInterface` | Pass. |
| `setTradingPaused` | Pass; guardian can pause/resume with nonzero reason and cannot block recovery. |
| `openOrder`, `openIOCOrder` | Correct GTC/IOC callers, pause, signature, market, expiry, tick/step, cap, state-before-transfer, and exact receipt checks; L-02 and I-01 apply. |
| `matchOrders`, `matchIOCOrders` | Pass for caller/TIF, crossing, same market/branch, remaining, step, open state, signed limits, and atomicity. Global best-price selection remains an explicitly trusted matcher property. |
| `cancelIOCRemainder` | Pass with the immutable router; a filled IOC is a no-op and a live remainder is fully returned. |
| `cancelOrder` | Pass; exact maker and open-state authorization, checks-effects-interactions. |
| `cancelUpTo` | Pass; strictly increasing per-maker floor. Open invalidated escrow remains permissionlessly releasable. |
| `releaseExpiredOrder`, `releaseInvalidatedOrder`, `releaseClosedMarketOrder` | Pass; permissionless only after the corresponding objective condition. |
| `hashOrder`, `getOrderState` | Pass; validator must be configured and state is read-only. |
| `_openOrder`, `_pullOrderFunding`, `_activePosition` | Correct asset/position derivation and exact funding; L-02, L-03, and I-01 apply. |
| `_executeMatch`, `_requireFillable` | Pass; calldata is bound through the full order hash, state is open and consistent, and maker price is the lower sequence. |
| `_consumeBuy`, `_consumeSell`, `_reduceOpenNotional`, `_releaseBuyerImprovement` | Arithmetic and state transitions pass; I-01 defines counter scope. |
| `_approveSettlementAssets`, `_ensureSettlementApproval` | Pass for the immutable trusted settlement; L-04 makes exact initial wiring essential. |
| `_cancelOrder` | Pass for attributable reservation return and counter removal; a maker-controlled rejecting ERC-1155 callback can block its own return as described in L-02. |
| `_requireIocRouter` | Pass. |

### ConditionalSettlement

| Function | Result |
| --- | --- |
| `constructor`, `onlyExchange` | Pass; immutable code-bearing exchange and matching CTF registry. |
| `settleFill` | Pass; exchange-only, nonzero parties/amounts, open window, atomic stock then quote settlement. |
| `_settleStock`, `_settleQuote` | Asset conservation and branch/funding mappings pass; L-02 applies to safe-transfer destinations. |
| `_pullWhole` | Pass for exact-receipt, non-fee tokens. |
| `_pullClaim` | Pass; precommitted callback proves the exact CTF transfer occurred. |
| `_splitCollateral` | Pass under pinned CTF/token assumptions; exact allowance, expected batch mint, allowance reset, and no new residual whole balance. M-02 applies. |
| `_assertNoClaimBalance` | Pass; prevents silent settlement residue. |

### IOCRouter and OrderRecoveryRouter

| Function | Result |
| --- | --- |
| `IOCRouter.constructor` | Pass; immutable code-bearing exchange and authority. |
| `executeIOC` | Pass; matcher-only, at most 32 makers, aligned arrays/TIF, atomic open/fills/remainder cancel. Zero makers safely opens and cancels in one transaction. |
| `OrderRecoveryRouter.constructor` | Pass. |
| `releaseExpired`, `releaseInvalidated`, `releaseClosedMarkets` | Pass; permissionless, maximum 64, best-effort isolation with failure hash. |
| `_validateLength` | Pass; rejects zero and over-bound batches. |

### OrderValidator

| Function | Result |
| --- | --- |
| `constructor` | Pass; immutable code-bearing exchange. |
| `hashOrder` | Pass; all signed fields are encoded with a fixed type hash and domain-separated by name, version, current chain ID, and exchange address. |
| `validate` | Pass; OpenZeppelin ECDSA rejects malformed/high-s signatures, EOA recovery must equal maker, and ERC-1271 uses `staticcall` and exact magic value. |

### PositionRouter

| Function | Result |
| --- | --- |
| `constructor` | Pass subject to exact CTF identity. |
| `mergeForUser` | Pass; exact equal binary claims, expected batch callback, exact collateral delta, direct recipient delivery, and no claim residue. |
| `redeemForUser` | Pass; one/two unique binary sets, positive amounts, expected receipt, redeem-all exact local balances, and payout delta only. Zero losing payout is valid. |
| `_binaryPositionIds`, `_positionId` | Correct shallow binary derivation; M-02 applies. |
| `_requireNoPositionBalance` | Pass; unsolicited CTF transfers are separately rejected. |

### ManualResolutionController

| Function | Result |
| --- | --- |
| `constructor` | Pass for code-bearing CTF/registry; L-04 for authority consistency at registry wiring. |
| `resolveMarket` | Correct role, one-time flag, evidence presence/length, allowed vector, state, CTF report, and sequential final states; M-01 for exact prepared commitment. |
| `_validPayout` | Pass; admits exactly YES, NO, and invalid 50/50. |

### PriceMath, ExpectedCtfReceiver, constants, and types

| Function/surface | Result |
| --- | --- |
| `PriceMath.quoteDown`, `quoteUp` | Pass; full-precision WAD math with explicit floor/ceiling. |
| `ExpectedCtfReceiver.constructor`, `supportsInterface` | Pass. |
| `onERC1155Received`, `onERC1155BatchReceived` | Pass; only the configured CTF and exact precommitted operator/from/id/value tuple is accepted. |
| `_expectSingle`, `_expectBatch`, `_assertExpectedTransferReceived` | Pass; prevents unsolicited claims and CTF implementations that omit the expected callback. |
| `ProtocolConstants`, `ProtocolRoles` | Values are internally consistent and match the documented v1 schema. |
| `ProtocolTypes` enums/structs | Field widths and enum use are safe; order hash binds all user-controlled order fields. |

### Pinned Conditional Tokens surface

| Function/surface | Result |
| --- | --- |
| `prepareCondition`, `getOutcomeSlotCount`, `getConditionId` | Correct interface and one-time preparation; permissionlessness causes L-01. |
| `reportPayouts`, payout getters | Correct one-time oracle and denominator behavior for the controller's three vectors. |
| `splitPosition`, `mergePositions`, `redeemPositions` | Reviewed burn/mint/transfer order and binary root-position behavior; first-party flows conserve collateral under token assumptions. M-02 governs collection identity. |
| `getCollectionId`, `getPositionId`, `CTHelpers.sqrt` | Arithmetic/source reviewed; M-02 is the outstanding assurance issue. |
| Legacy ERC-1155 balances, approvals, safe single/batch transfer, mint/burn, acceptance callbacks | Correct for the exercised paths. Boolean-return ERC-20 requirement and receiver callbacks are reflected in protocol tests and assumptions. |

## Verification results

The final release-candidate checks were run from `packages/contracts`:

| Command | Result |
| --- | --- |
| `FOUNDRY_PROFILE=ci forge test -vv` | All tests pass; 10,000-run arithmetic fuzz tests and 256-run integration fuzz tests |
| `forge test --match-contract AuditFindingsTest -vv` | Six reproductions pass |
| `forge coverage --ir-minimum --report summary` | 92.01% lines, 89.28% statements, 41.55% branches, 96.64% functions; source-map warning applies |
| `forge fmt --check` | Pass |
| `forge lint` | Pass |
| `bun run typecheck` | Pass |
| `forge build --sizes` | Pass; largest runtime is `ConditionalExchange` at 22,622 bytes, 1,954 bytes below EIP-170 limit |

The original 57 tests passed before audit additions. The six audit reproductions bring the final suite
to 63 tests. Build-size evidence from the unchanged production sources is in
[`evidence/build-sizes.txt`](./evidence/build-sizes.txt); the baseline output is in
[`evidence/baseline-tests.txt`](./evidence/baseline-tests.txt), and the final check record is in
[`evidence/final-verification.md`](./evidence/final-verification.md).

## Confirmed security properties

- No first-party proxy, upgrade hook, delegatecall, selfdestruct, arbitrary call, or administrator
  asset-withdrawal function exists.
- No fee accounting, debt, margin, borrowing, liquidation, or shared internal user balance exists.
- Every open order escrows its worst-case signed funding before returning successfully.
- Signatures are bound to all order fields, chain ID, and the immutable exchange.
- Duplicate hashes cannot reopen after fill/cancel, and nonce floors prevent lower-nonce opening/fill.
- A fill cannot cross markets or branches, exceed remaining quantity, violate base step, pay above a
  bid, or execute below an ask apart from the explicitly documented sub-unit floor rounding.
- The earlier onchain sequence sets the maker price for the submitted pair.
- Exchange accounting, settlement, CTF mint/burn, recipient delivery, and buyer improvement are one
  atomic EVM transaction.
- The matcher, guardian, market admin, and resolution admin have no generic transfer method in the
  reviewed first-party implementations.
- Pause and market closure preserve maker cancellation and permissionless stale-order release.
- Users can merge/redeem through the router or directly through CTF without an application or admin.
- Unsolicited ERC-1155 transfers to exchange, settlement, and position router revert; unsolicited
  ERC-20 dust is excluded from settlement deltas.

## Disclosed assumptions that are not new findings

- The resolution-admin multisig is a trusted manual oracle and can deliberately report a factually
  wrong allowed payout. M-01 concerns the missing second-role commitment, not this disclosed oracle
  model.
- The matcher can omit a better order or choose any crossing pair. It cannot exceed the two submitted
  orders' signed limits or reservations. Global price-time priority is an offchain, audited-event
  property.
- The default administrator can immediately grant or revoke operational roles. Its two-day rule
  delays default-admin transfer, not ordinary role changes.
- Wallet caps are address-based and Sybil-vulnerable.
- Standard CTF is permissionless; users can issue claims outside this exchange.
- Exact USDG and Stock Token semantics can block transfers, cancellation, splitting, or redemption.
  Fee-on-transfer and empty-return behavior is not generally supported by the legacy CTF.
- A block producer/sequencer controls permitted timestamp variation around open, cutoff, and expiry;
  no custody action can execute outside the resulting common time predicate.
- Keccak/ECDSA/elliptic-curve cryptographic assumptions and EVM correctness remain foundational.

## Remediation priority

1. Add and consume the exact resolution-call commitment (M-01).
2. Obtain an explicit written disposition or replace the CTF construction (M-02).
3. Make pre-prepared exact conditions idempotent in market creation (L-01).
4. Establish and enforce the supported ERC-1155 destination policy (L-02).
5. Reject untradeable market configurations onchain and in the creation CLI (L-03).
6. Turn dependency/runtime/authority verification into an aborting deployment check (L-04).
7. Align cap terminology and add hard cumulative venue limits if the pilot requires them (I-01).
8. Add stateful invariant handlers and adversarial callback/token suites (I-02).
9. Re-run every check, regenerate bindings/manifests, and commission the independent audits already
   required by the implementation plan.

## Final opinion

The first-party escrow, matching, settlement, cancellation, merge, and redemption design is compact
and materially safer than a pooled-ledger or upgradeable design. Its strongest properties are exact
per-order attribution, checked reservation math, state-before-callback updates, and the absence of any
privileged withdrawal surface. The audit found no demonstrated unprivileged theft or
undercollateralization in those paths.

Production deployment should wait. M-01 leaves the intended resolution approval split unenforced,
and M-02 prevents a clean cryptographic assurance statement for the contract that ultimately holds
all backing collateral. The low findings are inexpensive to address now and costly to work around
after immutable deployment. A remediated, version-controlled release candidate should be treated as a
new audit snapshot.
