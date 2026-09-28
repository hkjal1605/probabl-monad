# Polymarket ingestor

Display-only Gamma metadata and CLOB YES-book ingestion. The service stores append-only raw
payloads and normalized probability ticks, maintains reviewed subscriptions, and emits operational
alerts. It contains no chain client or admin transaction path.

Run with `bun run dev:polymarket`. It requires `DATABASE_URL` and `POLYMARKET_INTERNAL_TOKEN`
(16+ characters, shared with the API); `POLYMARKET_HOST`, `POLYMARKET_PORT` (42073),
`POLYMARKET_RECONCILE_MS` and `POLYMARKET_STALE_AFTER_MS` (at least two reconcile intervals) are
optional.
