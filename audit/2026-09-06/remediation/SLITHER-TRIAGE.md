# Independent static-analysis disposition

Tool: Slither 0.11.6, 102 detectors, 47 analyzed contracts in the Solidity 0.8.30 compilation. Raw results: [slither.json](evidence/slither.json), [command and exit status](evidence/slither.result.json), [full diagnostic output](evidence/slither.stdout.log).

There are 29 unsuppressed first-party alerts: 3 High, 4 Medium, 17 Low, and 5 Informational. These are **tool classifications**, not 29 confirmed vulnerabilities. `--fail-none` permits evidence collection despite alerts; exit code zero does not mean a clean security result. Every returned alert is accounted for below. Dependency findings are filtered from this output; the legacy precompiled CTF was reviewed separately and is not covered by this Solidity 0.8.30 analysis.

The source snapshot is the one identified in [scope.json](evidence/scope.json). F-numbering follows the `results.detectors` array, not console ordering. Full stable IDs are in the raw JSON; the first eight characters below disambiguate them.

| # / ID prefix | Detector / tool severity | Disposition and checked reasoning |
|---|---|---|
| F1 `3eccd183` | arbitrary-send-erc20 / High | Not an unauthorized pull. `_pullOrderFunding` is private, reached after `validator.validate`; the EIP-712 maker, market, funding kind, price, and quantity are authenticated. The destination is the exchange. Invalid, changed-recipient, cross-chain, cross-exchange, and malformed ERC-1271 signatures fail before funding. |
| F2 `ab796e7f` | arbitrary-send-erc20 / High | Not an arbitrary funding source. `_pullWhole` always pulls from immutable `exchange`; the sole public caller is `settleFill`, guarded by `onlyExchange` and `nonReentrant`. Direct external settlement calls are rejected by tests. |
| F3 `b6a8e1e1` | reentrancy-balance / High | The balance delta in `mergeForUser` is intentional, and both router mutation entry points are `nonReentrant`. The CTF callback receiver accepts only a committed transfer. The balance equality is a fail-closed check, not authorization based on an attacker's manipulable cached balance. Arbitrary malicious collateral remains outside the supported-token assumption. |
| F4 `2a67ba0e` | reentrancy-no-eth / Medium | `_expectedTransferHash` is deliberately armed and consumed once for each transfer. It is cleared before subsequent delivery callbacks; only the pinned CTF with the exact operator/from/IDs/amounts may consume it. Exchange and settlement mutation entry points are guarded. Receiver authentication, replay, overlapping expectations, and authorized-maker cancellation reentrancy are tested. |
| F5 `495d6a75` | reentrancy-no-eth / Medium | `createMarket` calls pinned CTF `prepareCondition` before storing the market. That exact implementation performs no external callback. The other token/CTF reads are static calls and creation is role-gated. This disposition depends on verified dependency identity; getter-compatible malicious replacement code is not approved. |
| F6 `f9e32007` | uninitialized-local / Medium | Solidity initializes the value-type local `uint256 seen` to zero. It is the intended duplicate-index bit mask, updated before the next iteration. Duplicate and malformed index sets are rejected. No uninitialized storage pointer exists. |
| F7 `071a97e5` | unused-return / Medium | The ignored third ECDSA value is diagnostic error data. Both recovered address and `RecoverError` are checked. No success flag is ignored. |
| F8 `1d2d4e2e` | calls-loop / Low | IOC calls are explicitly capped at 32 makers; failure of any leg reverts the complete transaction. This is intentional atomic semantics, unlike best-effort recovery. |
| F9 `2e3d067f` | calls-loop / Low | Merge balance checks cover exactly two binary position IDs; no unbounded array. |
| F10 `2f91c729` | calls-loop / Low | Redemption collection-ID derivation is restricted to one or two validated index sets. The cryptographic dependency assumption remains M-02, not a loop-size issue. |
| F11 `86f026ee` | calls-loop / Low | Redemption balance checks cover at most two validated IDs. |
| F12 `b2353a9b` | calls-loop / Low | Redemption position-ID derivation is bounded to at most two calls. |
| F13 `7a284fdb` | reentrancy-benign / Low | Same non-callback CTF preparation path as F5; `marketCount` is incremented once in the atomic creation transaction. |
| F14 `66b97e1d` | reentrancy-events / Low | Pinned CTF `setApprovalForAll` writes approval and emits an event without callbacks. Exchange settlement is stored first and cannot be configured again. |
| F15 `7dfc5070` | reentrancy-events / Low | Same no-callback preparation path as F5; creation event ordering is intentional. |
| F16 `1fc5203d` | timestamp / Low | Settlement checks the specified trading interval. Small permitted timestamp variation is a timing/trading assumption, not permission to exceed signed prices or quantities. |
| F17 `2f1c5e19` | timestamp / Low | Opening a market checks its explicit open/cutoff timestamps. |
| F18 `46d8fea5` | timestamp / Low | Order admission rejects expired orders and orders outside the market window. |
| F19 `5b301877` | timestamp / Low | Matching rejects a closed trading window even before a freeze transaction occurs. |
| F20 `6eb84c98` | timestamp / Low | `isTradingOpen` intentionally combines lifecycle state with the timestamp window. |
| F21 `7808444b` | timestamp / Low | Permissionless expiry release uses the signed expiry. Before-expiry and at-expiry behaviors are covered. |
| F22 `832c3b74` | timestamp / Low | Public cutoff freeze is intentionally gated by cutoff. |
| F23 `84698fb8` | timestamp / Low | Creation rejects past cutoffs and non-increasing trading windows. |
| F24 `aea62ef0` | timestamp / Low | Fillability rechecks expiry and nonce, rather than trusting the admission-time check. |
| F25 `f9c0ae1d` | assembly / Informational | Recovery assembly was reviewed for call target/value, 300,000-gas cap, zero output buffer, bounded `returndatacopy`, correctly padded free-memory pointer, and failure hashing. Repeated gas-exhaustion and 64-KiB revert tests pass. Assembly is not covered by the arithmetic model proof. |
| F26 `c674daf0` | low-level-calls / Informational | ERC-1271 requires a call to maker-defined signature validation. It is a static call, and success, return length, and exact ABI-padded magic value are checked. A gas-heavy wallet can make its own admission fail; this does not authorize pulling another maker's assets. |
| F27 `7108ef81` | missing-inheritance / Informational | Exchange structurally implements the recovery interface. Explicit inheritance is not needed for ABI compatibility; direct and batched recovery tests exercise it. |
| F28 `8620f6f7` | missing-inheritance / Informational | Exchange structurally implements the IOC interface, exercised by all IOC tests. |
| F29 `b6418969` | naming-convention / Informational | `CONTROLLER_VERSION()` intentionally matches the getter for a public Solidity constant. |

No alert was discarded solely because tests passed. Each disposition is a source-level reachability/authorization argument, supplemented by tests. These dispositions do not establish hash collision resistance, token implementation safety, RPC honesty, or absence of all possible EVM exploits. M-02 remains open.
