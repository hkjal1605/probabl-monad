# Internal RH mainnet testing — deployment and operations

This is a fresh deployment: there are no historical funded contracts to migrate. On 2026-09-07 the owner explicitly accepted deferring audit M-02 and the 11 transitive dependency advisories for **internal testing only**. Neither is fixed, independently audited or approved for public production. No tool in this implementation task broadcasts to RH mainnet.

## Supported topology

Use one supervised Bun process per API, matcher, worker, reconciler and Polymarket ingestor. All services share one PostgreSQL writer database with separate operational and Ponder-managed schemas. Follow the [shared PostgreSQL runbook](shared-postgres.md) for migrations, privileges, backups and pool budgets. Run the public and admin Next.js applications as separately supervised production builds. Keep indexer, matcher, worker, reconciler and ingestor `/internal/*` endpoints on loopback/private networking. Only expose the intended frontend routes and the ingestor's public probability WebSocket through HTTPS/WSS. Restrict the entire testing deployment to authorized operators at ingress.

Use the indexer package launcher, not the bare Ponder CLI. Include the committed `patches/` directory
and run `bun install --frozen-lockfile`. The launcher pins Ponder 0.17.8, isolates its disposable sync
cache by deployment schema and runs bounded maintenance outside block handlers. Keep the same
`DATABASE_SCHEMA` and `INDEXER_BLOCK_RETENTION` on restart. See the [storage policy](../../services/rh-indexer/README.md#bounded-idle-storage-and-durable-restarts)
for retention settings, alerts and replay requirements. No existing schema or legacy shared cache
is automatically removed during rollout.

The onchain exchange remains permissionless. API tester restrictions and a private UI are not an onchain wallet allowlist. Use only disposable developer-funded accounts, small balances and approvals, active supervision and an explicit loss budget. Open-order caps are not cumulative exposure limits. Cheap gas does not cap loss.

## Environment and secrets

Use `LOG_LEVEL=info` for backend operational logs and `NEXT_PUBLIC_LOG_LEVEL=info` when building each UI. Switch to `debug` for internal polling/feed diagnostics. See [database and logging](../architecture/database-and-logging.md) for event names, redaction, request IDs and storage ownership; logging introduces no external credential requirement.

Use the root `.env.example` for service settings, `packages/contracts/.env.example` for the deployment signer, and each UI's `.env.example` for frontend builds. Use absolute storage and manifest paths. Inject only the credentials each process needs; never supply deployment/admin keys to long-running services or put secrets in `NEXT_PUBLIC_*`.

For RH mainnet set these in deployment/verification and API/matcher/worker environments:

```dotenv
EXPECTED_CHAIN_ID=4663
ROBINHOOD_CHAIN_ID=4663
DEPLOYMENT_MODE=internal-mainnet
INTERNAL_MAINNET_RISK_ACK=I_ACCEPT_M02_AND_DEPENDENCY_RISK_FOR_INTERNAL_TESTING
INTERNAL_TESTER_ADDRESSES=0x<tester-a>,0x<tester-b>
```

`EXPECTED_CHAIN_ID` is used by contract scripts; `INTERNAL_TESTER_ADDRESSES` is enforced by API trading admission and replay. Cancellation/merge/redemption remain available even if a tester is subsequently removed. Gather archive-capable `ROBINHOOD_RPC_URL`, optional RPC `ROBINHOOD_WS_URL`, `DATABASE_URL`, the distinct deployment/governance/operational role addresses, dedicated relayer keys, independent high-entropy internal tokens, TLS hostnames and persistent storage. Token metadata is read from chain; there are no decimal-scaling environment overrides.

Set `INDEXER_FINALITY_MODE=rpc-tags` on RH. `INDEXER_CONFIRMATION_MODE=safe` waits for the RPC safe tag (bounded by indexing and configured depth); `finalized` waits longer, and `sequencer-depth` explicitly accepts sequencer-stage confirmation while still reporting finality from the finalized tag. Missing/invalid tags fail closed. `local-depth` is for Anvil only, checked by indexer preflight. Depths of 2/30 are not Ethereum finality.

`INDEXER_MAX_HEAD_AGE_SECONDS=30` bounds chain-projection freshness. Every order admission/replay and worker broadcast checks the indexer and reconciler; safety-service failure is a retryable stop, not permission to trade. The defaults are `RECONCILIATION_MAX_AGE_MS=120000`, `RECONCILIATION_MAX_DEEP_AGE_MS=90000000`, and `SAFETY_REQUEST_TIMEOUT_MS=5000`. Monitor these against actual RPC/L1 latency. Reconciliation must complete an initial deep run before trading becomes ready.

Use `RECONCILIATION_URL=http://127.0.0.1:42070`, `SETTLEMENT_WORKER_URL=http://127.0.0.1:42071`, `MATCHER_CALLBACK_URL=http://127.0.0.1:42072`, and `POLYMARKET_INGESTOR_URL=http://127.0.0.1:42073`. Configure `MATCHER_OWNER_ID`, `MATCHER_PORT=42072`, `MATCHER_POLL_INTERVAL_MS=500`, and the shared `DATABASE_URL`. Matcher and worker share `SETTLEMENT_INTERNAL_TOKEN`; the ingestor uses a different `POLYMARKET_INTERNAL_TOKEN`.

Build UIs with chain ID `4663`, the actual contract addresses, browser-safe RPC, and `NEXT_PUBLIC_POLYMARKET_STREAM_URL=wss://<your-probability-host>`. That stream URL points to our ingestor, not the upstream Polymarket socket. The public UI defaults to live mode and never falls back to dummy markets. Its explicitly selected [demo mode](ui-demo-mode.md) is isolated from live services; the former `NEXT_PUBLIC_ENABLE_PREVIEW_DATA` flag is obsolete. Admin health requires `MATCHER_HEALTH_URL` and `RECONCILIATION_URL`. Ordinary stock reference pricing is deliberately unavailable without a separate verified feed; Polymarket probability is informational and is not required to execute a local stock order.

## Deployment/start order

1. Freeze the release source/lock/artifacts and run the complete verification campaign. Review all deferred risks, canonical token implementations/issuer policies, custody constraints, tester identities and loss limits.
2. Run `deploy:v2` with the explicit internal-mainnet policy. Record the generated manifest. Verify explorer sources, exact deployed runtimes, wiring and role separation.
3. Complete the two-day default-admin handover and run `verify:v2` with `DEPLOYMENT_MANIFEST`. The experimental mode does not remove this delay or weaken bytecode verification.
4. Set all service contract addresses, the earliest protocol `DEPLOYMENT_BLOCK`, and `INDEXER_DEPLOYMENT_MANIFEST` from that verified deployment. Provision the shared PostgreSQL database, run `bun run db:migrate` as migration owner, then apply the service-specific privilege groups. Use a fresh Ponder projection schema.
5. Start `bun run start:indexer`, then `bun run start:reconciler`. Wait for successful deep reconciliation.
6. Start `bun run start:polymarket`, `bun run start:settlement`, `bun run start:matcher`, and `bun run start:api` with their service-specific environments.
7. Build both UIs with their final public configuration; start `bun run start:ui` and `bun run start:admin-ui`. Complete reviewed market creation and ingestor subscription through the admin evidence workflow.
8. Verify API `/ready`, worker `/ready`, matcher `/health`, indexer `/indexer/health`, reconciler `/health`, actual source ticks and browser wallet actions. Health liveness alone is not a trading greenlight.
9. Run small GTC/IOC trades, cancellation, settlement confirmation, all payout/claim recovery workflows, stop/restart rehearsals and a clean indexer rebuild on the selected infrastructure before expanding the experiment.

Commands are individual supervised processes, not one shell that runs them sequentially to completion. Do not run development hot reload/codegen alongside an acceptance run. Back up the entire shared PostgreSQL database, including journals/outboxes, nonce state and evidence bytes; never run the same signing key against independent databases.

The UI build/start scripts use Next's standard self-hosted server (`next build`, then `next start`), not a standalone bundle. Deploy the release workspace with installed dependencies and each application's `.next` and `public` directories. Do not copy only `.next/standalone` from an earlier build. Public build-time variables require a rebuild when changed.

## Recovery and limitations

The matcher journals confirmed events, drains catch-up before proposing, checks its independent shadow, retries idempotent durable delivery, polls terminal worker status and rewinds on canonical cursor conflicts. A terminal worker rejection is not immediately retried with the identical proposal ID. Investigate repeated quarantine and canonical history changes; do not edit custody/projections/outboxes to force a green state. A shadow/checkpoint inconsistency is a hard stop requiring investigation.

Already-broadcast transactions may mine after a freeze. Safety gates block new submissions/replacements, not transactions already in the network or direct user calls. Cancellation/merge/redemption are deliberately not blocked by offchain safety checks. A stalled nonce or issuer-blocked token requires supervised recovery; never delete the nonce/outbox database.

The isolated verification script is `bun packages/contracts/scripts/verify-internal-stack.ts`; `--hold` retains owned local services for browser checks until interrupted. It always initializes an owned loopback PostgreSQL instance (PostgreSQL binaries are required on PATH). Add `--production-ui` to build/serve both production UIs. It uses Anvil chain 31337, public development keys and mock tokens. The separate real-token RH Anvil fork tests remain necessary. Neither test replaces validation of the supplied PostgreSQL, archive provider, reverse proxy, Safe signing setup, browser wallet extension or actual RH sequencer behavior.

Run `bun services/polymarket-ingestor/scripts/verify-live-source.ts` for a read-only Gamma/CLOB/upstream-WebSocket smoke. It submits no Polymarket orders. An ingestor liveness response does not imply every tracked condition has a valid two-sided book; inspect the per-condition quality and source timestamp.

A reorg that removes already-confirmed worker fills requires coordinated incident recovery of the indexer, matcher and settlement records. Automatic cursor rewind alone does not prove those terminal worker records are reusable. Stop trading, preserve all stores, compare receipts and canonical fills, and follow the reorg runbook before resuming. Do not blindly replay a formerly confirmed batch or reuse its nonce. Shared PostgreSQL removes single-host disk dependence, but unattended HA operation still requires failover and load verification on the chosen infrastructure.
