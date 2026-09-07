# Database and indexer engineering audit

Date: 2026-09-07. Scope: repository-owned persistence in `packages/db`, Ponder configuration and handlers, API/gateway/evidence writes, matcher, settlement worker, Polymarket ingestor, reconciliation, and their UI/API consumers.

## Conclusion

The identified write-amplification, historical-scan, redundant-storage and transactional issues below have been addressed. The implementation retains raw-unit v2 accounting, signed outboxes, nonce ownership, canonical replay, fencing, fail-closed reconciliation and immutable operator evidence.

This is an engineering review with executable regression and query-plan tests, **not an independent formal audit or a guarantee of unlimited throughput**. Local verification supports internal testing. Sustained capacity and latency on the chosen deployment database, disks, network and RPC provider still require measurement.

No existing user database, signed intent, nonce ledger, attachment or historical audit artifact was deleted. Tests use owned temporary stores and local Anvil mock tokens, with zero upstream transactions.

## Findings and changes

| ID | Finding | Resolution |
| --- | --- | --- |
| DB-01 | Indexing all USDG/stock ERC-20 transfers scales with unrelated chain activity, not protocol activity. Transfer deltas had no custody/UI consumer and were not authoritative balances. | Removed both token-factory event sources and the delta projection. Canonical `balanceOf`/decimals reads remain pinned to a verified block. CTF transfers remain indexed. |
| DB-02 | Duplicate log bodies and five unconsumed application projections amplified Ponder writes, indexes and rollback records. | `chain_event` now contains only the delivery-guard ID. Removed `market_state_transition`, `whole_token_balance_delta`, `collateral_split`, `position_action`, and `order_release_attempt`. Matcher payloads and protocol transaction confirmations remain. Fresh application schema: 20 tables → 15. |
| DB-03 | Reconciliation's before/after-head retry loop required multiple pooled queries and could repeatedly reject snapshots on a rapidly advancing chain. | Replaced with one SELECT containing the head and grouped projections. All subqueries see one PostgreSQL MVCC snapshot; RPC still independently verifies its anchor. EVM numerics are cast to text before JSON aggregation. No retry-until-the-chain-pauses requirement. |
| DB-04 | Book, history, trade and matcher-cursor queries lacked exact filter/order indexes. Reversing a price index does not preserve ascending FIFO. Drizzle's default index null ordering also caused an incremental sort for descending bids. | Added matching bid/ask partial indexes, maker/market history and trade/transaction indexes. Explicit descending null ordering matches SQL queries. Cursor predicates use a composite range comparison. Removed unused secondary indexes where identified; no global order-history index because the API requires maker or market. |
| DB-05 | Settlement IOC lookup decoded every historical batch per lookup. Pending feedback/intents lacked selective indexes. IOC planning decoded all active batch payloads for each intent. | IOC expression-index lookup returns only the newest matching batch. Added pending feedback/intent indexes. Busy-book lookup is a database EXISTS-style query over processable batches, checking every GTC fill, not just the first. It does not transfer all signed payloads into JavaScript. |
| DB-06 | Matcher recovery decoded all checkpoints, performed canonical checks per checkpoint, and decoded all journal events during rewind. | Latest valid checkpoint is selected in SQL with EXISTS/LIMIT. Rewind reads only orphaned event indexes and changes canonical flags in one UPDATE. Decimal block-number ordering supports uint256 and the pre-genesis `-1` rewind boundary without int64 casts. |
| DB-07 | Gateway order-hash updates changed JSON but left the indexed `order_hash` stale. Startup repeatedly attempted a broad backfill. | Update both atomically. A separately recorded, one-time storage migration repairs existing v2 order rows, including non-null mismatches. Reopening a migrated store does not repeat the repair. Pending-operation index added. |
| DB-08 | User-paid cancellation/position submission inserted its signed attempt and prepared operation state in separate transactions. A crash between them could strand recovery state. | Reuse `persistPreparedAttempt` for an atomic attempt + prepared operation write. Injected failure after attempt insertion proves both changes roll back together. Relayer nonce allocation remains atomic where applicable. |
| DB-09 | Identical operation/attempt statuses and repeated matcher polling decisions produced needless writes. | Skip unchanged gateway updates and settlement attempt statuses. Matcher decision history retains changes to preview/book/fencing state, not duplicate polling timestamps. A-B-A transitions remain recorded. SQLite and in-memory matcher implementations agree. |
| DB-10 | Evidence packet lists performed approximately `1 + 4N` queries, and five mirror tables duplicated canonical records/attachment references. Public approved-packet lookup also used per-packet review reads. | Lists use four batched queries within a read transaction; single-packet views use three related-record queries without a duplicate status read. Approved-packet lookup uses a join. Stop creating/writing redundant mirrors. Canonical immutable packets, reviews, previews, observations, actions and attachment bytes remain. |
| DB-11 | Raw REST/WS payload archives and append-only probability ticks grew with every market-data update without a history/replay consumer. | In-memory books recover from REST. Persist one latest tick per condition; retain immutable metadata, subscriptions and operational/human-review alerts. 10,000 tick updates leave one row. Restart fallback is explicitly disconnected/stale, never presented as a live quote. |
| DB-12 | Content-hash metadata deduplication broke latest-state selection when the source changed A → B → A: the original A timestamp stayed older than B. | Atomic mutable latest-metadata pointers reference immutable snapshots. A becomes current again without rewriting the original evidence timestamp or bytes. |
| DB-13 | Expired authentication rows accumulated forever; index statistics had no maintenance path. | Delete only expired challenges/sessions, at most 500 of each per minute in the API. Add expiry indexes. SQLite query collections perform startup/approximately daily `PRAGMA optimize`, with `analysis_limit=1000` for older macOS SQLite. Custody/replay/evidence history is not pruned. |

The removed raw log bodies remain recoverable through canonical chain replay/Ponder's synchronization cache; that cache has its own retention behavior and must not be confused with a permanent independent evidence archive. Signed human evidence is retained separately.

## Retained data and its purpose

| Store | Retained records | Core/UI use |
| --- | --- | --- |
| Ponder | Block headers and canonical head | Confirmed IOC anchors, matcher cursor validation, reorg detection, finality/readiness |
| Ponder | Protocol transaction headers, processed event IDs | Operation/admin confirmation and duplicate-delivery protection |
| Ponder | Markets, orders, fills, resolutions | Books, order/trade history, immutable terms, settlement and payout display |
| Ponder | Reservations, market/wallet open interest, claim balances | Custody reconciliation, caps, positions and liabilities; zero-interest histories can still detect onchain leaks |
| Ponder | Nonce floors and pause state | Canonical order validity and trading safety |
| Ponder | Ordered matcher-event payloads | Deterministic matcher replay and recovery |
| Gateway | Live auth, operations/idempotency, signed attempts, relayer nonces | Authentication, retry/recovery and exactly-owned signing state |
| Matcher | Journal, checkpoints, leases, proposals and decision changes | Replay, reorgs, shadow comparison, fencing and reserved-liquidity recovery |
| Settlement | Batches, IOC intents, signed attempts, nonces, feedback state | Settlement outbox, replacement/restart safety, canonical confirmation and matcher notification |
| Evidence | Packets, reviews, previews, observations, admin actions and attachment files | Human approvals, exact transaction verification, public resolution evidence and operator accountability |
| Polymarket | Immutable metadata/subscriptions/alerts, latest metadata pointer and latest tick | Reviewed evidence/mapping, current UI probability and explicit disconnected fallback |
| Reconciler | Reports and freeze signals | Current/deep freshness gates, persistent alarms and incident reconstruction |
| SQLite internal | Schema migration identifiers and sampled planner statistics | Safe one-time upgrades and efficient query selection |

Do not prune nonce/outbox/idempotency records merely because they are terminal. Likewise, deleting replay checkpoints or zero-balance histories requires a separately designed recovery/retention policy, not a generic age-based cleanup.

## Verification and measured evidence

Executable checks:

```sh
LOG_LEVEL=silent bun test
bun run typecheck
bunx --no-install biome ci .
(cd packages/contracts && forge test --summary)
DB_AUDIT_PLANS=1 bun test packages/db/tests/indexer-queries.test.ts
bun packages/contracts/scripts/verify-internal-stack.ts --postgres --production-ui
```

- TypeScript regression suite: 147 tests passed, 0 failed, 3,013 assertions; final query/view additions are included.
- Solidity regression/invariant suite: 106 tests passed, 0 failed; no contract implementation changed in this database review.
- All workspace typechecks and Biome checks pass.
- PostgreSQL-compatible PGlite tests create DDL/indexes directly from the application schema, populate 100,000 historical terminal orders and 100,000 matcher events, and inspect EXPLAIN ANALYZE plans. Bids, asks and tail-cursor reads use their intended indexes without full-table scans or sorting. Exact bid/ask FIFO output is asserted.
- One illustrative warm local PGlite sample: bid 0.191 ms, ask 0.062 ms, cursor 0.043 ms execution time, touching 2/2/3 shared buffers respectively. These are single embedded-engine samples, **not hosted PostgreSQL p95 measurements or a throughput promise**.
- Snapshot tests cover not-ready state, empty arrays, nullable position IDs, complete v2 row shapes, maximum uint256 values, and an aggregate exceeding uint256. Big integers never round through JSON numbers.
- SQLite tests cover 10,000-row history lookups, expression/partial indexes, migration idempotence, transaction rollback, negative/pre-genesis and large-block rewinds, evidence immutability, A-B-A metadata, latest-tick cardinality and decision deduplication.
- The isolated native PostgreSQL/Anvil rehearsal passed all seven integration checks: service readiness with reconciliation; GTC matching/settlement; IOC planning/settlement; empty IOC behavior; fail-closed reconciliation outage with cancellation available; matcher/reconciler durable restarts; and both production frontends building, starting and serving. Successful rehearsal completed at `2026-09-07T13:09:02.035Z` with zero upstream transactions.
- Frontend verification is build/HTTP smoke testing, not browser-wallet automation. Polymarket unit/loopback fixtures verify ingestion behavior; this is not a sustained live-upstream market-data load test.
- An initial rehearsal was stopped after an unbounded readiness fetch stalled despite a healthy local indexer. The harness now uses five-second readiness request deadlines and consumes responses; subsequent rehearsals passed. No service was treated as verified merely because it started.

Test versions include Bun 1.3.14, Ponder 0.17.8, Drizzle 0.41.0 and PGlite 0.2.13. Local Bun reports SQLite 3.43.2, which is why analysis sampling is explicitly bounded instead of assuming SQLite 3.46+ behavior. Existing dependency advisories were not upgraded as part of this work.

## Rollout and compatibility

1. Deploy the changed Ponder code into a **new empty schema**, from the deployment block. Do not mutate, truncate or reuse an old projection schema. Follow the [rebuild runbook](../../../docs/runbooks/indexer-rebuild.md) and deep-reconcile before routing consumers to it. For a fresh undeployed system there is no old onchain state to migrate.
2. Raw-unit v2 signed order/batch formats, custody values and projection-hash meaning are unchanged. Never rescale stored signatures, raw amounts or nonce ownership.
3. Existing v2 SQLite stores receive additive indexes and the one-time order-hash repair. Existing unused evidence mirrors and old Polymarket archives are left intact but are no longer written. Historical tick lookup remains a read-only fallback when the new cache has no row. New stores contain only the current tables.
4. `/balances/:account` no longer returns derived ERC-20 transfer history. The deprecated `wholeTokenDeltas`/`wholeTokenDelta` fields return `null`; use `?token=...` for canonical balances. Current product consumers do not depend on the removed fields. SQL/schema-tooling consumers must adopt the new Ponder schema. The generated schema artifact was refreshed with pinned Ponder's builder; no GraphQL endpoint was enabled.
5. Back up durable SQLite stores and evidence attachment files together using a WAL-aware backup method. Do not copy only an actively written `.sqlite` main file. Do not auto-VACUUM or delete old user archives at startup.
6. The integration harness builds both `.next` directories with local fixture values. Rebuild both frontends with actual deployment environment variables before deployment.

## Capacity limits still requiring deployment evidence

- **Database and RPC latency:** validate p95/p99 on the selected infrastructure under simultaneous indexing, UI polling, reconciliation and settlement. No hosted database or workload target was supplied; a zero-bottleneck claim would be unsupported.
- **Necessary history grows:** every-block anchors, canonical matcher history, order/trade history, outboxes, decision changes, alerts and reports have real recovery/UI purposes. Monitor storage, WAL growth, checkpoints, autovacuum/ANALYZE and backup/restore duration. At roughly 10 blocks/sec, retained block headers alone grow by roughly 864,000 rows/day; this is arithmetic, not a storage-size benchmark. Pruning requires an explicit supported anchor/recovery horizon.
- **Full-state operations are intentionally not constant-time:** reconciliation aggregates active claims/reservations and checks known wallet/market histories. Large snapshots consume memory proportional to output. Deep reorg recovery may inspect proposal history. Market catalogue/position endpoints currently enumerate markets; catalogue pagination and staged reconciliation require coherent API/recovery designs before a very large market count is supported.
- **Single-host ownership remains:** synchronous FULL/WAL SQLite, one signing owner per relayer, and serial nonce-sensitive workflows favor safety over unrestricted parallelism. Queue readers return bounded batches; a prolonged backlog can delay newer work. Busy-book EXISTS still inspects relevant active batches/fills, though it no longer decodes complete histories in application code. Multi-host writes or an arbitrarily large backlog need a separate coordination/capacity design.
- **Ingress controls are operationally necessary:** expired-auth cleanup is bounded; untrusted request floods can outpace it. Internal-testing access controls/rate limits and disk alerts remain necessary. Logs are rotated separately and are not a database archive.

Before broad access, run a sustained representative workload plus a restart/reorg/restore rehearsal against the actual deployment environment. Record indexer lag, DB/RPC latency, pending-queue age, reconciliation duration, process memory and disk growth. Set admission limits from those measurements rather than assuming local microbenchmarks guarantee production behavior.

## Database-engine references

The one-statement snapshot follows [PostgreSQL read-committed snapshot semantics](https://www.postgresql.org/docs/current/transaction-iso.html). Mixed-direction/FIFO index design and null ordering follow [PostgreSQL indexes and ORDER BY](https://www.postgresql.org/docs/current/indexes-ordering.html). Selective and expression indexes follow [SQLite partial indexes](https://www.sqlite.org/partialindex.html) and [SQLite expression-index matching](https://sqlite.org/expridx.html). Planner maintenance follows [SQLite ANALYZE/optimize guidance](https://www.sqlite.org/lang_analyze.html), including the explicit analysis limit required by older engines.
