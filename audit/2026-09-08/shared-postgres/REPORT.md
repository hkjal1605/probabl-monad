# Shared PostgreSQL migration — implementation and verification

Date: 2026-09-08 (Asia/Kolkata).

Status: persistence redesign implemented and regression-tested; the requested 100% service
coverage requirement is **not complete**. This is an engineering verification report, not an
independent formal security audit or public-production approval.

## Implemented architecture

All backend services now use one PostgreSQL database (compatible with the intended Aurora
PostgreSQL writer endpoint). Separate schemas express ownership, not separate databases.
Browser applications continue to use APIs and never receive PostgreSQL credentials.

| Owner | Durable data |
| --- | --- |
| `probabl` | Immutable deployment identity and shared chain/address nonce allocation |
| `gateway` | Authentication, idempotent requests and signed transaction outbox |
| `matching` | Canonical journal, checkpoints, decisions, leases and proposals |
| `settlement` | Batches, normalized book membership, attempts and IOC intents |
| `operations` | Evidence including attachment bytes, Polymarket metadata/ticks and reconciliation |
| Ponder projection and isolated sync schemas | Reorg-managed chain projections and bounded sync cache |

All authored schemas, migrations, connection/transaction operations and query functions live
in `packages/db`. Services import asynchronous named queries. Active SQLite/PGlite adapters,
local-store defaults, obsolete schema-maintenance helpers and direct embedded-driver dependencies
were removed; obsolete environment settings are rejected. Authored source and built API scans
found no embedded-store initialization. Upstream dependency packages may contain unused optional
driver support; they are not configured or used by Probabl.

Legacy user-owned database files and historical audit artifacts were preserved, not opened,
silently converted or deleted. There is no operational-state rescaling or mainnet migration.

## Correctness and safety changes

- Versioned Drizzle migrations cover 29 operational tables. Startup checks migration hashes,
  chain, exchange and order version; ordinary services do not apply migrations automatically.
- Gateway/settlement nonce reservations and signed attempts commit atomically. Failed signing
  or failed persistence does not consume a nonce. Recovery reuses the same signed bytes.
- Gateway ownership tokens and worker/matcher fencing use the database clock. Stale requests
  cannot overwrite a successor's state or release its lease. RPC work stays outside database
  transactions; duplicate network delivery remains possible and is handled idempotently.
- Matcher journal/model changes are serialized. Transaction callbacks are not automatically
  replayed: a rollback must recover the in-memory model before retrying. Reorg proposal lookups
  use indexed anchors instead of decoding all historical proposals.
- Gateway restart revalidation preserves canonical bigint order fields. Recovery rotates bounded
  keyset pages independently of intake; unprepared requests and slow RPCs cannot starve new
  submissions. An unprepared request is resumed using the original request/idempotency key.
- Evidence attachment bytes and packet/link/audit records are committed together. Reviewed
  records are append-only; draft/unreferenced attachments are not publicly downloadable.
- Ponder cannot select operational schema names. Separate tested privilege groups prevent its
  runtime role from dropping/modifying operational schemas while allowing projection rebuilds.
- Ponder's pinned patch retains persisted restart/reorg behavior and bounded cache maintenance,
  enables synchronous commits and reduces per-query read memory. Ordinary pools are bounded.
- Polymarket book queues preserve per-book ordering; socket generations reject stale events.
  A 1,000-event backlog ceiling triggers snapshot recovery instead of unbounded buffering.
- API errors no longer expose arbitrary database query text. Correlation headers survive error
  responses. HTTP/background work drains before database shutdown; local test-cluster shutdown
  was exercised both normally and with SIGTERM.

## Verification performed

| Check | Result |
| --- | --- |
| Complete TypeScript suite with actual PostgreSQL | **239 passed, 0 failed; 3,872 assertions, 50 test files** |
| Complete Foundry suite | **147 passed, 0 failed, 0 skipped**, including fuzz/invariant suites |
| All workspace TypeScript checks | Passed, including DB scripts/migration configuration |
| Repository Biome CI | Passed, 375 files at verification time |
| API build | Passed; database package remains external for correct migration-path resolution |
| Owned local PostgreSQL test lifecycle | Startup, normal shutdown and SIGTERM cleanup passed |
| Shared PostgreSQL + Anvil standalone rehearsal | **15 checks passed**, including both production frontend builds/HTTP smoke tests |
| 100% service-coverage gate | **Failed / incomplete**, intentionally not bypassed |

The cross-connection tests cover concurrent nonce allocation, one-shot authentication challenge
consumption, duplicate request intake, stale-owner takeover, outbox rollback, matcher rollback
recovery and actual denied operational-schema operations under the indexer role. Query-plan
tests use real PostgreSQL and 100,000-row fixtures. Transport tests use owned HTTP/WebSocket
servers rather than live upstream APIs.

The full-stack rehearsal verified GTC and IOC settlement, an empty IOC, reconciliation-outage
gating, matcher/reconciler restart, SIGKILL indexer restart, shallow reorg rollback, historical
anchor fallback, a simultaneous clean replay, persisted clean restart, and UI/admin-UI builds
and serving. The later gateway recovery-fairness adjustment additionally passed its targeted
slow-RPC/starvation regression and the final complete TypeScript suite.

The cache comparison used the same local deployment/workload with and without bounded
maintenance. Three 256-block catch-up bursts took 52,679 ms total with maintenance versus
50,186 ms for the baseline (approximately 5.0% more); the specified aggregate tolerance passed.
This is a local regression comparison, **not an Aurora capacity or latency guarantee**.
The 64-slot anchor ring stayed bounded during empty blocks. Cache rows include the persisted
recovery/finality window. PostgreSQL physical table/WAL allocation is not expected to remain
byte-for-byte constant merely because live row counts are bounded.

Evidence:

- [Standalone rehearsal result](./rehearsal.json)
- [Storage, restart, replay and timing evidence](./storage-evidence.json)
- [Coverage inventory and uncovered/unmeasured modules](./coverage-summary.json)
- Complete LCOV: `coverage/shared-postgres/lcov.info` (generated locally)

No upstream/mainnet transactions were sent. The rehearsal used mock tokens on owned Anvil
chain 31337. It did not repeat real-RH-token acceptance, hosted Aurora failover or browser
wallet-click testing. Rehearsal UIs used `.next-rehearsal`, leaving the existing `.next` build
separate. Temporary service credentials/environment files were not copied into this report.

## Remaining requirements

1. **Reach the requested 100% coverage.** The gate inventories unmeasured entrypoints and Ponder
   handlers too. Imported-module coverage is not presented as complete service coverage.
   Further tests are needed for indexer event/API handlers, reconciler/launcher paths, API/admin
   chain adapters, settlement HTTP/startup paths, and remaining fault branches. The current Bun
   report measures lines/functions, not exhaustive branch or state-space coverage. A passing
   test suite does not prove every possible edge case or absence of vulnerabilities.
2. Rehearse Aurora TLS/role provisioning, instance sizing, backup restoration and writer failover
   on the selected hosted infrastructure. Local PostgreSQL concurrency tests are not that rehearsal.
3. Keep one active Polymarket feed process until distributed feed ownership and multi-instance
   failover have been implemented/rehearsed. Do not interpret the shared database as blanket
   approval to horizontally replicate every process.

Deployment procedure: [shared PostgreSQL runbook](../../../docs/runbooks/shared-postgres.md).
Use one writer endpoint/database with separate service credentials, run `bun run db:migrate`,
apply the reviewed privilege-group SQL as the database administrator, then start services and
wait for readiness/deep reconciliation. Keep operational backups: chain replay cannot recreate
sessions, signed outboxes, nonce reservations or human evidence.
