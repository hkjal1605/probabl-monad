# Security policy and production boundary

The v2 raw-unit-ratio contracts are written as non-upgradeable, fully collateralized protocol code. They are not production-approved merely because the repository tests pass. Production launch requires independent Solidity audits, remediation review, Robinhood testnet exercises with the exact Stock Token and USDG bytecode, multisig configuration review, deployment-bytecode verification, and incident/recovery rehearsals.

No developer or auditor can truthfully guarantee a literal zero probability of an exploitable bug. The engineering objective is to make the system small, explicit, testable, and fail-closed, then obtain independent review before value is placed at risk.

## Unresolved release blocker (2026-09-06 audit M-02)

The pinned Gnosis 1.0.3 Conditional Tokens implementation uses a legacy try-and-increment collection hash whose required cryptographic assurance is not established by this review. No practical exploit was demonstrated, but regression tests, runtime pinning, and arithmetic proofs do not discharge that assumption. Public production still requires independent specialist clearance or a separately reviewed replacement. On 2026-09-07 the project owner explicitly deferred M-02 for internal mainnet testing. Tooling now permits RH `4663` only with `DEPLOYMENT_MODE=internal-mainnet` and the exact risk acknowledgement described in the [internal testing runbook](docs/runbooks/internal-mainnet-testing.md). Manifests retain `productionApproved: false`, the experimental mode and deferred findings. Local `31337` and testnet `46630` remain supported. This is an operational release policy, not an onchain access restriction or a cryptographic fix.

See the [remediation and re-audit report](audit/2026-09-06/remediation/REPORT.md) for the exact verified scope and remaining launch gates.

## Raw-unit pricing migration (2026-09-06 follow-up R-03)

The original RH mainnet Anvil fork at block `55857421` confirmed that canonical USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`) has 6 decimals, while NVDA and TSLA have 18. The former v1 registry rejected USDG. That diagnostic and its evidence remain unchanged in the [historical fork report](audit/2026-09-06/real-token-fork/REPORT.md).

V2 removes the onchain decimal assumption and explicitly defines signed prices as raw quote units per raw base unit scaled by `1e18`. Balances, quantities, fees (if introduced), reservations and notional caps remain raw integers. Metadata conversion belongs to input/display boundaries, never settlement. The indexer, API, matcher, worker, UI, bindings and signed-order domain use the [v2 unit contract](docs/architecture/raw-unit-ratio-v2.md). There is no historical funded deployment in this project: deploy fresh manifests, signed orders and v2 databases. Never rescale or reinterpret any v1 test orders in place. Exact-token evidence and the remaining limitations must be reviewed before listing. M-02 remains separately open; tooling permits only the explicitly acknowledged internal-mainnet exception above, not public-production approval.

Point #2 is **verified and completed for pinned Anvil compatibility**, not production approval: the complete real-token baseline passed 77 checks and 815 local transactions, including both live settlement flows, 48 exchange cases, deep reconciliation and clean replay. See the [v2 remediation/re-audit report](audit/2026-09-06/raw-unit-ratio/REPORT.md) for exact block/source identities, final regression evidence and limitations.

## Additional dependency release gate (2026-09-07 R-04)

The locked-package scan reports 11 unresolved transitive advisories (6 high, 5 moderate), principally under Ponder's server, ORM and development tooling. The project owner deferred remediation for internal testing on 2026-09-07; no advisory is marked fixed and no new audit ignore was added. Public production/CI security approval still requires remediation or separately reviewed exceptions. See [R-04 in the v2 report](audit/2026-09-06/raw-unit-ratio/REPORT.md). Workspace-only dependency links added for shared runtime safety do not constitute advisory remediation.

## Core safety properties

- An order escrows its complete worst-case funding before becoming open.
- A fill cannot exceed either order's remaining quantity or violate either limit price.
- The earlier onchain sequence determines the resting order and execution price.
- State and risk-cap accounting update before settlement callbacks.
- Settlement is atomic: state, collateral splits, outputs, and price improvement all succeed or all revert.
- The matcher, guardian, market admin, and resolution admin have no generic asset-transfer function.
- Cancellation, stale-order release, claim merge, and redemption are never disabled by the exchange pause.
- Unsolicited ERC-1155 transfers to protocol receivers revert. Unsolicited ERC-20 dust cannot block settlement.
- Resolution accepts only YES `[1,0]/1`, NO `[0,1]/1`, or invalid `[1,1]/2`, once, while the market is awaiting resolution.
- The market administrator commits to the exact chain, controller, market, payout vector, evidence hash, and URI before the resolution administrator can finalize it.

## Explicit trust assumptions

- The market-admin and resolution-admin roles can jointly approve a factually wrong but structurally valid payout. Neither role alone can substitute the other's approval, but the default administrator can grant both roles. V1 deliberately has no Polygon proof, bridge, watcher, or automated cross-chain settlement. A prepared commitment is immutable: a mistaken approval leaves the market awaiting resolution and requires operational escalation; there is no unilateral override.
- The pinned legacy CTF requires collateral `transfer`/`transferFrom` calls to return a boolean; empty-return tokens are unsupported. Exact Stock Token and USDG behavior must be validated before listing, and failed fills remain atomic with maker cancellation available.
- The authorized matcher can omit a better order even though it cannot violate the submitted orders' collateral and price limits. A shadow matcher and event audit are required operational controls.
- Matcher proposals and pending quantities are offchain availability/fairness state, not custody state. The event journal, verified checkpoints, fencing tokens, and independent slow shadow reduce but do not eliminate operator and implementation risk.
- The included SQLite matcher store is a single-host durability adapter. A multi-host production topology requires the shared-store and finality work in milestone 10 plus failover testing; copying a SQLite file between live hosts is unsupported.
- The API and settlement SQLite stores are also single-host adapters. A relayer key must never be active against two independent nonce databases. Every signed attempt is persisted before broadcast; failover must preserve the outbox, leases, and nonce row together.
- The API order relayer must have no protocol role. The settlement key must have `MATCHER_ROLE` only and must not share a key with any admin, guardian, market, or resolution role. Internal settlement endpoints require a service token and network-layer isolation.
- The configured Gnosis Conditional Tokens deployment, USDG, and curated Stock Tokens must behave as tested. Fee-on-transfer collateral is rejected during order funding, but unusual rebasing, blacklist, pause, or callback mechanics require exact-token testing.
- `ProtocolAuthority`'s default administrator can change operational role membership. Production ownership must be a reviewed multisig; its initially two-day default-admin transfer delay does not delay ordinary role grants or revocations. The inherited delay can itself be changed through the delayed OpenZeppelin workflow; it is not a hardcoded minimum. Deployment verification rejects both active and scheduled delays shorter than two days.
- Wallet caps are per address and are not Sybil-resistant. Wallet and market caps cover live open orders only, not filled claims, total outstanding collateral, or loss exposure. Pilot exposure limits require offchain accounting and operational enforcement.
- Contract makers and recipients must declare ERC-165/ERC-1155 receiver support. This does not prove future callback behavior: malicious or changing receivers can still make their own fills revert. Simulate exact fills, quarantine repeatedly failing orders, and preserve maker cancellation. A smart-wallet maker that stops accepting claims must invoke `cancelOrderTo` itself with a working destination; the matcher cannot redirect its assets.
- Best-effort recovery batches cap each call at 300,000 gas and copied failure data at 256 bytes. Supply enough transaction gas for the whole requested batch. More expensive legitimate wallets must use direct exchange recovery/cancellation; bounded calls cannot guarantee every receiver's liveness.

## Out of scope in v1

KYC/KYB, jurisdiction controls, margin, borrowing, liquidation, protocol fees, upgrade proxies, automatic market creation, and automatic/cross-chain resolution are absent by design.

The one accepted transitive package advisory and its bytecode reachability analysis are recorded in [`docs/security/dependency-exceptions.md`](./docs/security/dependency-exceptions.md). CI ignores that advisory identifier only.

## Reporting

Do not disclose a suspected vulnerability publicly while funds may be at risk. Send a minimal reproduction, affected commit/deployment, and impact assessment to the private security contact configured by the project owner. A production deployment must publish that contact before launch.
