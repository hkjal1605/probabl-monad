# Event market ingestor (Polymarket and Kalshi)

Display-only metadata and YES-book ingestion for the venue markets local markets are conditioned on.
The service stores append-only raw snapshots, which evidence refers to, maintains reviewed
subscriptions, serves probabilities from live books in memory, and emits operational alerts. It
contains no chain client or admin transaction path. The name predates Kalshi.

- **Polymarket** (`src/service.ts`, `src/source.ts`): Gamma metadata, and CLOB books over REST and
  the market WebSocket. A market is keyed by its Polymarket condition id.
- **Kalshi** (`src/kalshi/`): Kalshi's public trade API, polled over REST (its WebSocket needs an
  API key). A market is keyed by `keccak256("kalshi:" + ticker)`, the condition id local markets
  carry on chain.
- **Routing** (`src/event-markets.ts`): condition-keyed reads (`/v1/conditions/:id/metadata`,
  `/probability`, `/stream`; `/v1/polymarket/conditions/...` is an alias) go to whichever venue
  follows the condition.

Run with `bun run dev:polymarket`. It requires `DATABASE_URL` and `POLYMARKET_INTERNAL_TOKEN`
(16+ characters, shared with the API); `POLYMARKET_HOST`, `POLYMARKET_PORT` (42073),
`POLYMARKET_RECONCILE_MS` and `POLYMARKET_STALE_AFTER_MS` (at least two reconcile intervals) are
optional, as are `KALSHI_API_URL`, `KALSHI_BOOK_POLL_MS` (5000) and `KALSHI_METADATA_POLL_MS`
(60000).
