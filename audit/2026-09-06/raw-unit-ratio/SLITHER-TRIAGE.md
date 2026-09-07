# V2 static-analysis disposition

Slither 0.11.6 analyzed 46 contracts with 102 detectors. The modern compilation does not include the precompiled legacy CTF. The [raw result](evidence/static-final/slither.json) contains 29 unsuppressed alerts: 3 High, 4 Medium, 17 Low, 5 Informational. These are tool severities, not confirmed vulnerabilities. `--fail-none` was used to collect all findings; a zero exit code is not security clearance.

All descriptions were reread and traced against the final 26 first-party Solidity sources. The arguments below depend on the reviewed CTF identity, supported collateral and immutable dependency graph. They do not close M-02. Numbers follow the detector array; full IDs and source locations are retained in JSON.

| # / ID prefix | Detector | Source-level disposition |
|---|---|---|
| 1 `35dd97cf` | arbitrary-send-erc20 | Funding pull is private and reached only after validating the maker's v2 signature. Maker, recipient, asset-selection fields, market, raw quantity and ratio are authenticated. Destination is the exchange. |
| 2 `ab796e7f` | arbitrary-send-erc20 | Settlement pulls only from immutable exchange. `settleFill` is `onlyExchange` and `nonReentrant`; external callers cannot select a funding source. |
| 3 `b6a8e1e1` | reentrancy-balance | Merge uses an exact collateral delta under `nonReentrant`. Both router entry points are guarded and the CTF receiver is expectation-bound. The equality is a fail-closed conservation check, not stale-balance authorization. |
| 4 `2a67ba0e` | reentrancy-no-eth | Expected callbacks are deliberately armed and consumed once. Sender, operator, owner, IDs and amounts must match; exchange/settlement entry points cannot reenter. Delivery happens after accounting. |
| 5 `b27d493d` | reentrancy-no-eth | Role-gated creation invokes the pinned CTF's non-callback `prepareCondition`; getter calls are static. Arbitrary getter-compatible malicious CTF implementations are not approved. |
| 6 `f9e32007` | uninitialized-local | Value-type local `seen` is initialized to zero by Solidity and used as the duplicate-index bit mask. There is no uninitialized storage pointer. |
| 7 `071a97e5` | unused-return | Only ECDSA diagnostic data is ignored. Recovered address and error status are checked before escrow. |
| 8 `1d2d4e2e` | calls-loop | IOC is bounded to 32 makers and intentionally atomic; any failed leg reverts all effects. |
| 9 `2e3d067f` | calls-loop | Merge balance checks cover exactly two positions. |
| 10 `2f91c729` | calls-loop | Redemption collection derivation is bounded to one or two validated index sets. Collection cryptography remains M-02. |
| 11 `86f026ee` | calls-loop | Redemption balance checks cover at most two positions. |
| 12 `b2353a9b` | calls-loop | Redemption position derivation covers at most two positions. |
| 13 `e9cf2d53` | reentrancy-benign | Market count updates follow the non-callback CTF preparation path in #5, once per atomic creation. |
| 14 `1d91faa1` | reentrancy-events | Creation events follow the same non-callback path. The new protocol-version field is emitted with the immutable terms. |
| 15 `66b97e1d` | reentrancy-events | Pinned CTF approval has no callback. Settlement is assigned before approval and cannot be reconfigured. |
| 16 `1fc5203d` | timestamp | Settlement enforces the explicit trading interval; timestamp variation is a boundary assumption, not a price/collateral bypass. |
| 17 `53be3191` | timestamp | `isTradingOpen` intentionally combines lifecycle and open/cutoff times. |
| 18 `69258c6f` | timestamp | Order admission rejects expired orders, closed windows and expiry beyond cutoff. |
| 19 `7808444b` | timestamp | Permissionless release intentionally becomes available at signed expiry. |
| 20 `ad7480b8` | timestamp | Opening requires the configured time interval. |
| 21 `c2be22cc` | timestamp | Fillability rechecks signed expiry and minimum nonce at execution. |
| 22 `c7592e34` | timestamp | Configuration rejects expired cutoffs and non-increasing windows. |
| 23 `e726bb0c` | timestamp | Public cutoff freeze is intentionally time-gated. |
| 24 `fad452dd` | timestamp | Matching checks cutoff independently of whether a freeze transaction was submitted. |
| 25 `f9c0ae1d` | assembly | Recovery target is immutable, value is zero, call gas is capped at 300,000 and failure copying at 256 bytes; free-memory alignment and truncation hashing were checked. Gas grief and large-revert regressions pass. Not covered by the arithmetic proof. |
| 26 `c674daf0` | low-level-calls | ERC-1271 static call checks success, return length and exact ABI-padded magic. A hostile wallet can prevent its own admission but cannot authorize another maker's assets. |
| 27 `7108ef81` | missing-inheritance | Exchange structurally implements recovery ABI; direct/batched recovery is exercised. Explicit inheritance is not required for ABI compatibility. |
| 28 `8620f6f7` | missing-inheritance | Exchange structurally implements IOC ABI; complete atomic IOC tests exercise it. |
| 29 `b6418969` | naming-convention | Uppercase controller getter intentionally matches a public Solidity constant. Controller commitment semantics remain v1 while orders/markets are v2. |

No additional exploitable first-party defect was established by these alerts under the stated assumptions. This conclusion is based on reachability and authorization analysis, not merely passing tests. Independent security review, issuer-control review and cryptographic clearance remain required.
