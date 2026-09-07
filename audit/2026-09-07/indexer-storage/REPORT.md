# Indexer idle-storage remediation and verification

Date: 2026-09-07. Scope: this repository's Ponder 0.17.8 indexer, database access, canonical-block consumers, and local service integration. This is an engineering verification report, not an independent formal smart-contract audit or a hosted-mainnet load certification.

## Changes

The indexer still processes every block and every configured protocol event. Recent caching remains enabled; persistence and Ponder's normal crash/reorg recovery remain enabled.

1. `chain_block` is a fixed-size ring (default 8,192 slots), updated through Ponder's ordinary rollback-aware database interface. The single canonical head row records the ring size. A different size requires a fresh schema/replay, not in-place reinterpretation.
2. Rebuildable sync data lives in `cs_sync_<DATABASE_SCHEMA>`. Each deployment/rebuild has a private cache; cleanup cannot evict a different deployment's shared cache.
3. Background maintenance evicts only cache blocks, logs, transactions, receipts, traces, and block-specific RPC results older than the **minimum persisted safe/finalized/latest checkpoint minus the retention window**. Coverage intervals and data are evicted in one atomic transaction. Application projections, checkpoint rows, rollback journals, factory discovery, and block-independent RPC results are excluded.
4. The version-pinned Bun patch also starts historical fetching at the recovery/extraction cursor. Otherwise, removing old cache coverage could cause a persisted restart to refetch the entire deployment-to-checkpoint prefix even though extraction no longer needs it.
5. Old canonical-block consumers use exact historical RPC block reads, followed by validation against the saved indexed-head hash. This preserves matcher cursors, IOC confirmation anchors, and settlement anchors beyond the local ring. Unavailable or inconsistent RPC history fails closed with 503; a validated stale matcher cursor retains its 409 rewind response. Recent reads stay database-only unless the endpoint already requires explicit RPC verification. Concurrent misses are coalesced and limited to 64.

The cache-maintenance queries and verification database reads live in `packages/db`; the indexer launcher only orchestrates them.

## Indexing-speed safeguards

- No extra RPC polling loop, omitted events, coarser block subscription, or historical rescan in a block handler.
- No full-history application-table deletion scan: one indexed ring-slot overwrite per block.
- Default cleanup cadence is 15 seconds, with at most 2,000 victims per cache table per sweep. Existing chain/block range indexes select victims; deletion uses tuple identifiers.
- Maintenance reuses the existing sync pool, is non-overlapping, and has transaction-local 100 ms lock / 500 ms statement timeouts. A failed sweep rolls back and waits for the next tick instead of entering Ponder's indexing retry loop.
- Coverage trim and all six bounded deletes use one mutation statement, avoiding serial network round trips while holding coverage-row locks.
- Rollback safety takes priority over reclamation when finality/recovery stops advancing. Startup prefetch can temporarily exceed the steady-state cache window.

These safeguards bound maintenance work; they do not eliminate its CPU, I/O, WAL, or connection usage. Hosted database and RPC latency must still be monitored.

## Reproduction

Run against the committed lockfile and patch:

```sh
bun install --frozen-lockfile
bun audit/2026-09-07/indexer-storage/verify.ts
bun packages/contracts/scripts/verify-internal-stack.ts --postgres --storage
bun packages/contracts/scripts/verify-internal-stack.ts --indexer-dev --production-ui
bun audit/2026-09-07/indexer-storage/throughput.ts
```

The integration harness refuses occupied ports and creates owned loopback Anvil/PostgreSQL/PGlite services and fresh schemas. It never sends a transaction upstream. Private generated environment files are not included in the evidence directory.

## Deployment and operations

Install the committed `patches/ponder@0.17.8.patch` through `bun install --frozen-lockfile`. The launcher rejects an unreviewed Ponder version or missing patch. Upgrading Ponder requires reviewing the adapter and rerunning these checks.

Use a **fresh application schema** for this schema change, replay, and compare projections before switching consumers. No existing user database, application schema, or shared `ponder_sync` cache was deleted by this work. Normal subsequent restarts must keep the same schema, build, and persistent database. A genuinely fresh deployment/schema intentionally performs a full RPC-backed replay rather than sharing another deployment's cache.

Use the package `start`/`dev` scripts (or `bun scripts/ponder.ts start|dev`). Direct unmanaged Ponder indexing is rejected. `serve` remains an API-only process, not a cache-maintenance owner.

Defaults:

```dotenv
INDEXER_BLOCK_RETENTION=8192
INDEXER_CACHE_RETENTION=8192
INDEXER_CACHE_MAINTENANCE_INTERVAL_MS=15000
INDEXER_CACHE_MAINTENANCE_BATCH_SIZE=2000
PONDER_DISABLE_CACHE=false
```

The RPC must serve historical **block headers** for old cursors/anchors. This fallback does not require archive `eth_call` state. PostgreSQL is the production database; PGlite is for development. [Ponder database documentation](https://ponder.sh/docs/database).

Monitor `indexer.storage.ready`, `indexer.cache.pruned`, `indexer.cache.backlog`, `indexer.cache.maintenance_failed`, head/finality lag, pool wait time, and autovacuum/WAL. Repeated full batches or timeouts require investigation and measured tuning; do not disable recovery to force reclamation.

Bounded live rows are **not a strict database-byte cap**. Empty-block header history no longer grows without limit, but updates/deletes produce row versions and WAL, retained pages need not shrink immediately, and real protocol/UI/recovery history grows with actual usage. PostgreSQL vacuum normally makes deleted space reusable rather than immediately returning all allocation to the filesystem. [PostgreSQL routine vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html).

Do not run `ponder db prune` as cache cleanup: it removes inactive application deployments and can remove one that is merely stopped. Old schemas/cache require a separate, explicit backup-and-retirement decision. [Ponder CLI documentation](https://ponder.sh/docs/api-reference/ponder/cli).

## Verification results

The recorded regression run passed:

- [154 TypeScript tests; 3,066 assertions](evidence/typescript.json).
- [Workspace typechecking](evidence/typecheck.json), plus [strict verification-script typechecking](evidence/audit-scripts.json).
- [Biome formatting](evidence/format.json).
- [106 Solidity tests](evidence/contracts.json); no Solidity implementation changed in this storage remediation.
- Frozen Bun installation with the committed patch: no dependency changes required.

The unit tests include private-cache isolation, recovery-boundary selection, atomic failure rollback,
bounded victims, a 101,000-height cache query-plan check using an indexed range seek and TID deletion,
historical-anchor failure handling, in-flight coalescing, and the 64-request concurrency limit.

The local environment was Bun 1.3.14, PostgreSQL 18.3, Anvil 1.7.1, Ponder 0.17.8, and Drizzle 0.41.0.
Selected [source SHA-256 hashes](evidence/source.json) bind the recorded checks to the implementation.

### Performance methodology correction

An exploratory comparison correctly failed its strict catch-up tolerance, but compared unequal RPC
budgets: Ponder's adaptive scheduler starts at 20 RPC/s; debug logs in the repeat showed the freshly
replayed baseline increasing to 34 RPC/s while the checkpoint-resumed primary had no increase. No
cache-code change was made to hide this result. The final harness restarts **both** processes before
timing, samples every block instead of aliasing one-second polling with half-second samples, and
records three simultaneous identical 256-block bursts. Its tolerance is 10% plus one second across
all three burst completion times, not a claim of mathematically zero overhead.

The full-stack paced loop's API sampling could delay its mining loop (300 blocks plus catch-up took
39.8 seconds), so its original “10-block-per-second” check label is **not** used as evidence of a
sustained chain rate. That label is corrected in the harness. The independent `throughput.ts` test
uses separate mining and observation loops, identical fresh deployments, and synthetic idle-only
contract addresses; protocol-event correctness is covered separately by the full-stack tests.

### Native PostgreSQL and complete service integration

[14 checks passed](evidence/postgres/result.json). [Measurements and projection digests](evidence/postgres/storage-evidence.json)
and [structured storage events](evidence/postgres/storage-events.json) are retained.

| Check | Observed result |
| --- | --- |
| Idle growth | After warming with 256 empty blocks, another 1,024 kept the application ring at exactly 64 rows; cached blocks were 65 before / 95 after, within the 64-block window plus finality/maintenance staging. |
| Crash restart | SIGKILL plus 8 offline blocks preserved protocol projections; saved recovery block was 1,346, and observed backfill log ranges began at 1,347 or 1,372, never the deployment prefix. |
| Reorg | A real cancellation event changed protocol state; replacing its branch rolled back the event and overwritten ring slots to the expected canonical state. |
| Old anchors | Evicted canonical-block, matcher-cursor, settlement, and IOC paths passed; an incorrect matcher cursor hash produced 409. |
| Isolated rebuild | A second schema/cache reproduced every protocol table's count and digest after eviction and reorg. |
| Clean restart | Same-schema/same-build persisted restart preserved exact protocol state after eviction. |
| Trading and recovery | GTC and IOC settlement, no-liquidity IOC termination, reconciliation-outage gating, onchain cancellation, matcher and reconciler restarts passed. |
| Burst comparison | Three identical 256-block bursts: bounded 19.212 / 16.752 / 15.998 s; baseline 18.969 / 16.756 / 13.994 s. Aggregate difference +4.5%, within the stated local tolerance. Both use the same ring/schema; this isolates cache policy, not every change against an unmodified historical version. |

The application/cache table allocation increased from 2,703,360 to 4,481,024 bytes in the idle
samples despite bounded live rows, and later reused/reclaimed space. This is why the fix is not
presented as a promise that a provider's disk-size graph becomes perfectly flat.
The captured native run logged 58 successful eviction sweeps, with p95 duration 15.09 ms,
maximum 16.64 ms, and **zero maintenance failures**. The test used a more aggressive 1-second
maintenance cadence and 64-block retention than the 15-second / 8,192-block deployment defaults.

### PGlite development and frontend smoke

[7 checks passed](evidence/pglite-ui/result.json), including GTC/IOC flows, safety gating and durable
service restarts. The actual `dev` launcher emitted [storage-ready and successful pruning events](evidence/pglite-ui/storage-events.json).
Both Next.js production frontends built, started, and served HTTP pages against the local stack.
This was a build/server smoke test, not a new comprehensive interactive-browser audit. Those build
outputs contain local rehearsal configuration; rebuild with real deployment variables before release.

### Independent fixed-rate idle throughput

[The independently timed comparison passed](evidence/throughput.json). It mined **600 blocks in
60.002 seconds** while API sampling ran separately. Both fresh deployments used the same pinned
runtime, block ring, database host, chain, and one-second RPC polling; only the cache window differed.

| Measurement | Bounded cache | Non-evicting baseline |
| --- | ---: | ---: |
| Mean sampled lag | 5.270 blocks | 5.261 blocks |
| p95 sampled lag | 10 blocks | 10 blocks |
| Maximum sampled lag | 12 blocks | 12 blocks |
| Three 256-block bursts, aggregate catch-up | 51.868 s | 51.670 s |
| Retained application block rows | 64 | 64 |
| Cached blocks at final sample | 95 | 1,449 |

Aggregate catch-up differed by **+0.38%**, with equal p95/maximum lag: no material speed regression
was observed in this local idle workload. The two indexers reached the same final height. This is
not a high-event-volume/mainnet/provider quota guarantee; repeat a representative load/soak test on
the actual hosted PostgreSQL and RH RPC configuration before broader access.

## Conclusion

The idle-header/cache growth fix is implemented and locally verified without disabling caching,
event processing, persisted recovery, or supported reorg rollback. No existing user database or
mainnet contract was changed. Deployment still requires the committed patched install, a fresh
indexer schema for this schema revision, reliable historical block-header RPC access, and normal
PostgreSQL monitoring/autovacuum. A fixed-size local cache does not replace chain/RPC availability
or prove historical ancestry against a malicious/internally inconsistent RPC provider.
