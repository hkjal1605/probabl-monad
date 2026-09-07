# Maker/taker fee implementation review

Date: 2026-09-08 (Asia/Kolkata).

This is an engineering security review and test record, not an independent audit, formal verification proof, or production approval. It covers the new maker/taker fee implementation and its compatibility changes. No redemption fee was implemented. Earlier audit findings are not automatically closed by this report.

## Implementation reviewed

- `ProtocolFeeVault`: zero-default rates, immediate default-admin updates, 1,000 bps hard maximum, canonical claim custody, bounded admin withdrawals, and redemption of the vault's own earned claims.
- `ConditionalSettlement` and `FeeMath`: fees deducted from received active claims, full-precision raw arithmetic, per-order fractional carry, pre-callback rate snapshots, signed cap enforcement, and atomic delivery.
- `ConditionalExchange`, `OrderValidator`, and shared order types: onchain sequence determines maker/taker; EIP-712 v3 binds `maxFeeBps`; gross reservation and execution accounting remains unchanged.
- Supporting changes: generated ABIs, deployment/wiring verification, shared golden vectors, gateway preparation, orderbook checkpoints/proposals, IOC serialization, indexer projections, and public UI signing/history.

The 28 Solidity source files under `packages/contracts/src` have combined SHA-256 `86422491dc1fe896ae48be9766e68412b159787e52b8148f1d2b4c329f9a9e21`. Construction: lexicographically sorted relative paths; hash each path, NUL, its exact bytes, NUL. This identifies first-party contract sources, not vendored dependencies or tests.

Design rationale, primary research references, examples, and admin instructions are in [trading-fees.md](../../docs/architecture/trading-fees.md).

## Security properties checked

1. Buyers receive gross stock claims minus their role's fee; sellers receive gross USDG claims minus theirs. Net proceeds plus vault fee equal gross proceeds.
2. No extra funding is pulled for fees. Inactive claims, price improvement, unfilled reservations, cancellation, recovery, merging, and user redemption are not charged.
3. Either party's fee cap violation reverts the entire match, including reservations and fee carry. Changing the signed cap invalidates the signature. A cap of zero remains protective after admin rate increases.
4. Full-precision fee math handles `uint256.max` for every permitted rate. Fee subtraction cannot underflow. The fractional carry remains below 10,000 and does not overflow its `uint16` representation.
5. Splitting one order's execution into multiple fills does not discard fee fractions. Rate changes and changing liquidity roles do not reprice earlier fills.
6. Both rates are snapshotted before recipient callbacks. Even an authorized admin recipient cannot change the other side's fee during the same fill.
7. Rejected transfers and callback failures roll back all fee and reservation state. Vault withdrawals are authorized, bounded, and reentrancy-guarded; vault admin cannot withdraw exchange escrow or user-owned claims.
8. Earned claims can be withdrawn before resolution or redeemed after YES/NO/invalid resolution. Paused collateral and unresolved conditions preserve balances on failure.
9. Event amounts/assets/roles agree with actual fees. Zero fees produce no fee-charge event or aggregate database write. The indexer uses exact bigint arithmetic and updates the keyed order row without a separate balance ledger.

## Verification

Commands were run locally; chain transactions used isolated Anvil chain 31337 and local mock collateral, with the pinned canonical Conditional Tokens implementation. No mainnet transaction was sent.

| Check | Result |
| --- | --- |
| Full contract suite and coverage run | 147 passing tests across 22 suites; no failures/skips |
| Optimized uncached CI-profile contract run | All 147 passed; each new fee fuzz test ran 10,000 cases |
| CI stateful conservation | Four suites, each 1,000 runs / 128,000 calls / 0 handler reverts; the two fee-enabled suites total 256,000 calls |
| TypeScript suite (`bun test`) | 210 passed, 0 failed; 3,584 assertions across 44 files |
| Workspace type checks | All packages, services, and both applications passed |
| Biome, Solidity formatting, Forge lint | Passed; intentional exact-reference arithmetic/cast suppressions are explained inline |
| Public UI and admin UI optimized builds | Passed |
| Local deployment rehearsal | Passed actual v3 TypeScript signatures, nonzero maker/taker deductions, pre-resolution claim withdrawal, post-resolution treasury redemption, zero defaults, and disabling rates |
| Runtime size | Exchange 23,560 bytes; settlement 8,696 bytes; vault 4,295 bytes; all below EIP-170 |

Coverage was measured with `forge coverage --root packages/contracts --ir-minimum --report summary`. The tool warns that minimum-IR source mappings can be imperfect. The new `FeeMath` and `ProtocolFeeVault` each reported 100% line, statement, branch, and function coverage. This is **not** 100% coverage of the whole protocol: settlement reported 93.27% lines / 63.16% branches, exchange 93.73% lines / 53.03% branches, and validator 100% lines / 87.50% branches. Coverage is evidence of exercised paths, not a proof of their correctness.

For an optimized, uncached verification run, use:

```sh
FOUNDRY_PROFILE=ci forge test --root packages/contracts --no-cache --summary
bun test
bun run typecheck
bunx biome ci .
forge fmt --root packages/contracts --check
```

The CI profile requests 10,000 fuzz cases and 1,000 invariant runs of depth 128. Some pre-existing fuzz tests retain their explicit lower per-test overrides; the new fee fuzz tests have no such override. Use the uncached contract run after AST-only lint or coverage builds so a cached partial artifact set cannot silently omit test suites.

## Operational limitations and remaining assurance work

- A rate increase above a resting order's signed cap makes it unfillable. Automatic fee-aware book filtering/requotation is not implemented; the worker's contract simulation rejects unsafe fills. Cancel/re-sign affected orders or restore compatible rates before expecting them to match. This can affect matching liveness under dynamic rates.
- The UI exposes the signed maximum and before-fee payoff previews, not a live guaranteed fee quote. Demo mode remains zero-fee. Fee administration is by vault transactions, not a new admin-UI settings page.
- Order signing changes from v2 to v3. Use fresh contracts and fresh/reindexed development state; do not reuse old signed orders or pre-fee orderbook snapshots. Market identities and raw-unit ratios remain v2.
- Treasury revenue is conditional claims, not immediately realized USDG/stock. Losing claims redeem for zero. A terminal order may leave less than one raw unit of uncollected fractional fee; no minimum fee is imposed. Tiny separate orders can avoid sub-unit fees.
- Vault custody deliberately has no arbitrary-call or general ERC-20 rescue function. Direct accidental ERC-20 donations are outside its withdrawal interface; send earned claims through the supported flow.
- The fee-specific database helper has exact-arithmetic/unit coverage and schema/query tests pass. A full running Ponder-to-API/browser lifecycle with nonzero fees, reorgs, and real Robinhood token contracts was not exercised in this turn.
- This run did not repeat a Robinhood real-token fork test, deployment to mainnet, external dependency advisory remediation, independent audit, or machine-checked formal proof. Those are not implied by the passing checks above.
