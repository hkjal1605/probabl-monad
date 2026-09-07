# RH mainnet real-token Anvil verification — 2026-09-06

Follow-up: the v2 raw-unit migration now has a completed pinned Anvil verification in the [new re-audit report](../raw-unit-ratio/REPORT.md). The original failed v1 diagnostic below is historical evidence and is intentionally unchanged. M-02 and production approval remain separate gates.

**Point #2 status: TESTED — BLOCKED / NOT VERIFIED.**

The requested local fork test was run against the canonical USDG, NVDA, and TSLA deployments, not token mocks. It established **23 passing prerequisite/token checks and one concrete protocol incompatibility**. Canonical USDG has **6 decimals**, whereas `MarketRegistry` requires **18**. Constructing the registry with USDG reverts with `InvalidDecimals(USDG, 6)`. Neither an NVDA/USDG nor a TSLA/USDG market can be created by the current release.

This finding prevents marking the requested exact-token integration point complete. It is a fail-closed compatibility problem, not a demonstrated loss-of-funds exploit. The production restriction remains in place; M-02 is separately unresolved.

## Exact tested identity

| Item | Value |
|---|---|
| Upstream chain | RH mainnet, chain ID `4663` |
| Local execution | Isolated Anvil, `127.0.0.1:18547`, chain ID retained as `4663` |
| Fork block | `55857421` |
| Fork block hash | `0x4a93d48cdadbe25070d41ae28f7fdd152e586ce8d21385c12ef1a30198fbee34` |
| Execution interval | `2026-09-06T09:15:07.092Z` to `2026-09-06T09:15:48.442Z` |
| Production-source SHA-256 digest | `38c22573022e14c631d5d7d7b1eb7ed9bf25b458c40b80485ca7d3891a393c5e` |
| Dependency-lock SHA-256 | `163c0d348fd858ae006b71aa8b82545f7949bba654689c03a1f3102f16a01108` |
| Runner SHA-256 | `7e72ce169938e90228a1c11c259b1aa65e807494ce7f0cde05483e86f25f8157` |
| Recorded local transactions | 64; successful deployments, funding, and token/CTF/router operations |
| Upstream transaction submissions | 0 |
| Process exit | `2`: diagnostic completed with a reproduced integration blocker |

| Asset | Canonical address | Observed decimals |
|---|---|---:|
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | 18 |
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | 18 |

USDG identity was checked against the [official token directory](https://docs.robinhood.com/chain/contracts/), whose response is archived. NVDA and TSLA identities were checked against the [official Robinhood asset API](https://api.robinhood.com/rhj/assets), using chain ID and contract address rather than ticker alone. The API response was retrieved during the run; historical state and runtime checks were pinned to the fork block. [API documentation](https://docs.robinhood.com/chain/stock-token-apis/).

The source digest is unchanged from the remediation audit: no production Solidity, decimal validation, price math, or token implementation was altered for this test. New test tooling and documentation do not change that digest.

## What actually ran

1. Confirmed upstream chain ID, pinned block/hash, and canonical token identities.
2. Started a fresh Anvil instance using a **read-only loopback gateway**. Tested that `eth_sendRawTransaction` is rejected by the gateway before forwarding. Wallet and impersonation calls use a separate local Anvil endpoint only.
3. Compared each token's proxy runtime, relevant EIP-1967 slots, reachable implementation/beacon runtimes, and fixture-holder balances between upstream pinned state and the fork.
4. Impersonated existing token holders **only locally**, transferred tokens through their actual `transfer` implementation, and checked exact sender debits, recipient credits, and boolean return values. No token code, token balances, compliance storage, or allowances were directly overwritten.
5. Deployed the pinned Gnosis CTF artifact, the reviewed `PositionRouter`, and a local `ProtocolAuthority` onto Anvil.
6. Executed the real `MarketRegistry` constructor as an Anvil `eth_call` with canonical USDG. Recorded and decoded the exact revert.
7. For **each** of USDG, NVDA, and TSLA: checked approval/allowance, split real collateral through CTF, merged a complete set through `PositionRouter`, and exercised YES, NO, and invalid payouts with separate branch redemptions. Checked exact raw-unit payout, burning of both winning/losing claims, full CTF collateral return, and no router collateral/claim residue.
8. Checked current NVDA and TSLA `uiMultiplier`/`balanceOfUI` values against raw-unit balances. Both multipliers were `1e18`; this does not exercise a future multiplier change.
9. Shut down the owned Anvil process and gateway; persisted identities, transactions, checks, and the rejection evidence.

The standalone CTF conditions in step 7 use a local test oracle. They **do not** bypass the failed registry to claim that the exchange, manual-resolution controller, matching, or IOC works with USDG. Those protocol lifecycle paths did not run with these actual tokens.

### Check breakdown

| Check family | Outcome |
|---|---|
| Canonical identities, upstream write guard, fork identity | 3 passed |
| Real-holder exact transfers and implementation consistency | 3 passed |
| Token approvals and boolean return | 3 passed |
| Split/merge, YES, NO, invalid redemption per token | 12 passed |
| Current stock multiplier/raw-unit views | 2 passed |
| Canonical-USDG protocol deployment | **Blocked: `InvalidDecimals(USDG, 6)`** |
| NVDA/USDG and TSLA/USDG market creation, matching, IOC, cancellations/refunds | **Not executed: prerequisite deployment fails** |

The underlying token `transferFrom` path is exercised by successful CTF splits and checked exact backing changes. There is no assertion that all token methods, malicious-caller cases, or future issuer policy states were covered.

Supporting repository verification also passed: [83 TypeScript tests](evidence/verification-checks/typescript-tests.result.json), [workspace typechecking](evidence/verification-checks/typecheck.result.json), and [formatting/lint](evidence/verification-checks/biome.result.json). No production Solidity changes were made, so the prior 88-test Solidity campaign remains historical evidence for the unchanged source rather than a claimed new real-token exchange campaign.

## R-03 — canonical USDG decimal mismatch

Affected code: [registry constructor](../../../packages/contracts/src/MarketRegistry.sol:89), [decimal validation](../../../packages/contracts/src/MarketRegistry.sol:395), [Solidity quote math](../../../packages/contracts/src/libraries/PriceMath.sol), [shared quote math](../../../packages/domain/src/math.ts).

The observed constructor rejection is:

```text
InvalidDecimals(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 6)
selector: 0xf2353bd3
```

The rejection currently protects the protocol from silently mixing incompatible units. This is not safely fixed by accepting `decimals() == 6` alone. With an 18-decimal stock quantity and an X18 price expressed in whole USDG per whole stock token, conversion to raw 6-decimal USDG requires:

```text
quoteRaw = floor(quantityRaw * priceX18 / 10^30)
reservationRaw = ceil(quantityRaw * priceX18 / 10^30)
```

For example, one raw-scaled stock token (`1e18`) at a price of 200 USDG (`200e18`) must debit `200e6` raw USDG, not `200e18`. The existing same-decimal formula divides by `1e18`. This illustrates the required dimensional correction; it is not a proposed unaudited patch or a claim that every downstream conversion has been enumerated.

Closure requires a reviewed unit convention and consistent changes to quote arithmetic, reservation/refund rounding, cap feasibility and cap units, configuration validation, shared TypeScript calculations, client amount parsing/display, fixtures and golden vectors. Then execute the complete NVDA/USDG and TSLA/USDG exchange/IOC/recovery/resolution lifecycle on the real fork, rerun all regressions and arithmetic proofs, and review the changed code. A wrapper-token approach would be a distinct custody/compatibility design requiring explicit selection and its own review.

## Evidence

- [Machine-readable result, all checks and source hashes](evidence/2026-09-06T09-15-07.092Z/result.json)
- [Exact registry constructor rejection](evidence/2026-09-06T09-15-07.092Z/registry-deployment-rejection.json)
- [Token/proxy/beacon/implementation identities and runtime bytes](evidence/2026-09-06T09-15-07.092Z/token-identities.json)
- [Local transaction inventory](evidence/2026-09-06T09-15-07.092Z/transactions.json)
- [Pinned block](evidence/2026-09-06T09-15-07.092Z/block.json), [Anvil node identity](evidence/2026-09-06T09-15-07.092Z/anvil-node-info.json)
- [Official NVDA/TSLA identity response](evidence/2026-09-06T09-15-07.092Z/official-assets.json), [USDG directory identity](evidence/2026-09-06T09-15-07.092Z/official-usdg.json)
- [Executable runner](../../../packages/contracts/scripts/test-rh-token-fork.ts)

The local transaction hashes identify this isolated run, not transactions on a public explorer. The evidence does not contain funding-holder private keys; impersonation does not require them. Test signers are ephemeral local-only accounts and are not persisted.

## Reproduction

With the locked dependencies and reviewed production artifacts available, run from the workspace root:

```bash
bun packages/contracts/scripts/test-rh-token-fork.ts
```

The script requires network access for read-only public RPC/API requests and an unused local port `18547`. It pins block number, block hash, token addresses and proxy runtime hashes, verifies the current official address registry, and writes a new timestamped evidence directory. The public RPC must still serve the pinned historical state. It intentionally returns exit `2` on the reproduced integration blocker, so this result cannot be silently interpreted as successful production compatibility. A changed protocol that accepts USDG requires extending the diagnostic into the complete exchange test suite; it does not automatically turn this partial suite into a release approval.

## Remaining limitations and final disposition

- The full exchange lifecycle is blocked by R-03. Exact-token point #2 is **not complete**.
- Proxy/implementation bytecode identity is recorded; the complete third-party verified source and issuer governance were not independently audited. The public explorer API returned an access challenge during source lookup, and the NVDA proxy was absent from the queried Sourcify record. No source-verification claim is inferred from token names or runtime identity alone.
- Issuer pause/blacklist/upgrade authority and scheduled corporate-action multiplier changes were not exercised. Current successful transfers do not guarantee future transfer availability.
- Anvil does not establish RH/Nitro-specific precompile behavior, sequencer screening, fees, or finality. Those remain target-chain validation tasks. [RH execution differences](https://docs.robinhood.com/chain/differences-from-ethereum/).
- All arithmetic uses raw token units in the standalone CTF tests. Passing these tests is not a full-program formal proof or a resolution of M-02.
- No real funds moved; no live deployments or roles were changed; no production guard was removed.

**Decision: preserve the release block, remediate the confirmed quote-unit incompatibility through a separately reviewed implementation change, then repeat full real-token integration verification.**
