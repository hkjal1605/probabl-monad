# Settlement worker runbook

## Required isolation

Use two different service keys:

- `API_RELAYER_PRIVATE_KEY`: no protocol roles; pays gas for signed `openOrder` only.
- `SETTLEMENT_RELAYER_PRIVATE_KEY`: `MATCHER_ROLE` only. Verify it has no default-admin, guardian,
  market-admin, or resolution-admin membership.

Store keys in the production secret manager, never in an environment file or database. The checked-in
Anvil bootstrap writes deterministic local-only keys into the ignored `.env.anvil` file.

`SETTLEMENT_INTERNAL_TOKEN` authenticates API/matcher-to-worker calls. Restrict all `/internal/*`
ports at the network layer as well. Use separate database files per service.

## Start and verify locally

```bash
bun run anvil:indexer
bun run anvil:indexer:bootstrap
bun run dev:indexer:anvil
bun run dev:settlement:anvil
bun run dev:api:anvil
bun run e2e:milestone11:anvil
```

If port 3000 is occupied, run the API with another `API_PORT` and pass the matching `API_URL` to the
E2E harness.

The worker refuses to start if the RPC chain differs or its key lacks `MATCHER_ROLE`. Health is
available at `/health`; batch inspection and manual processing are authenticated internal endpoints.

## Nonce policy

The worker reads the pending chain nonce, then allocates from the shared PostgreSQL chain/address
nonce row. Allocation and signed outbox insertion commit atomically before broadcast. Gateway and
worker use this same allocator. Leases use PostgreSQL time and fencing tokens; stale owners cannot
change batches. Never run one signing key against independent databases. See [shared PostgreSQL](shared-postgres.md).

`SETTLEMENT_STUCK_MS` defaults to 30 seconds. A stuck attempt is replaced at the same nonce.
`SETTLEMENT_REPLACEMENT_BUMP_BPS` defaults to 1250 (12.5%). Production values must be validated
against the Robinhood Chain fee policy.

## Incident actions

- RPC/indexer outage: do not delete or edit the database. Stop new broadcast if provider state is
  ambiguous; nonterminal batches retry from their persisted state.
- `quarantined`: inspect `error.classification`. Confirm Ponder health/reorg completion and matcher
  replay. The batch must not be manually forced; the matcher should release/rematch from canonical
  state.
- Reverted transaction: confirm the canonical receipt and relevant cancel/expiry/freeze event. The
  matcher callback outbox retries until pending quantities are released.
- Stuck nonce: inspect every attempt and replacement link for that call index. Never skip the nonce
  with a different payload. Resolve or cancel it with an approved same-nonce policy.
- Suspected relayer compromise: guardian pauses new fills, revoke `MATCHER_ROLE`, preserve the
  database/logs, and rotate. Maker cancellation, stale release, merge, and redemption remain usable.
- Database loss: stop the relayer key immediately. Restore the last consistent snapshot, reconcile
  every stored hash against Ponder/RPC, and only then resume. Never initialize a fresh nonce database
  against a still-active old worker.

## Metrics/alerts to add at deployment

Alert on oldest queued/submitted age, prepared attempts older than one poll, nonce gaps, replacement
count, reverts by classification, quarantined batches, undelivered matcher feedback, Ponder lag, and
RPC disagreement. Milestone 14 owns external metrics shipping and paging configuration.
