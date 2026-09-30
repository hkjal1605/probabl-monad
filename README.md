# probabl

Conditional Stocks is a fully collateralized, event-conditional stock-token exchange for EVM chains
(Base and Robinhood Chain; one stock-token issuer per chain). Every market pairs one stock token with
the deployment's quote token and one Polymarket condition: traders buy or sell the stock *if YES* or
*if NO*, and resolution pays each branch's claims exactly (YES 1/0, NO 0/1, INVALID ½/½).

It is the EVM port of the Solana implementation, with the same product surface: the trading UI,
admin evidence workflow, delegated one-click trading, testnet faucet, Pyth/Polymarket references and
an inventory-managing market maker.

## Architecture

```text
contracts/                 Solidity exchange: ConditionalStocks (trading hot path) + ConditionalStocksAdmin
                           (governance module behind a delegatecall fallback), one address and ABI;
                           contracts/src/vault: the Δ-vault (DeltaVault + DeltaVaultAdmin, same pattern)
packages/evm-client        ABI, order packing, atomic planner, transaction builders, delegation,
                           admin/evidence transactions, and an event-sourced ledger replica
packages/database          PostgreSQL schema and queries (@conditional-stocks/db)
packages/market-data       Polymarket normalization, evidence packets and hashing
packages/shared            Logging, HTTP middleware, read caches, token catalog, spot-price types
packages/domain            Exact decimal/raw-unit conversions shared by the UIs
services/indexer           Chain follower (confirmed + finalized replicas, reorgs), projections, SSE
services/polymarket-ingestor  Display-only Polymarket metadata and probability ingestion
packages/operator          Signing runtime of the bots: journaled executor, locked state file, references
services/market-maker      Two-branch quoting from Pyth + Polymarket with risk and gas limits
services/vault-keeper      Δ-vault quoting: the Δ-model's branch prices within the vault's on-chain limits
apps/server                API process: embeds the chain index and serves /v1 (auth, trading,
                           custody, admin evidence, faucet, reference prices)
apps/web                   Next.js trading UI (EIP-6963 wallets)
apps/admin                 Next.js operator console (evidence review, market lifecycle, incidents)
scripts/evm                Local anvil bootstrap, dev runner, demo seeding and exchange deployment
```

**Ledger.** Deposits credit an internal balance; trading, splits, merges and redemptions move only
ledger balances, so orders never transfer tokens. Each `(market, branch, owner)` account holds quote
and base claims. A buy funded with *whole* tokens receives the opposite branch's claim of what it paid,
so every claim stays backed 1:1.

**Markets** are addressed by a chain-independent id: the first 8 bytes of the contract's
`marketKey` (the Polymarket condition with its YES side, and the stock's underlying, e.g.
"US:NVDA", recorded when its pool is listed). Every on-chain market is a venue of one; the API
accepts the id, a slug (`nvda-<id>`) or a numeric on-chain id, and web URLs use the slug.

**Extensions.** No deployed function can change. New functions can only be added as extensions,
activatable 14 days after the admin proposes them (the guardian can cancel), while withdrawals stay
instant and unpausable, so anyone can leave during the window.

**Orders** rest on chain keyed `market << 40 | branch << 32 | seq`. A placement carries a plan built by
the API from the replica (next sequence, deadline, minimum fill and up to eight makers), is filled
greedily, and rejects a plan that is stale or would leave a crossed book. `replace` cancels and places
in one transaction for market makers. Fees carry fractional remainders per order.

**Delegated trading.** A wallet approves the service's trading key once (per-order and lifetime
quote limits, fee cap, expiry); the API then submits orders for it without a wallet prompt. Retries
with the same client id never place a second order.

**Index.** The API process follows the exchange's logs into an in-memory replica (no database read on
the trading path), persists finalized trades and closed orders in coalesced transactions plus a
compressed checkpoint when the replica changed (every other event lives in the checkpoint and on
chain), reconciles against chain state, and pushes invalidations and wallet images over SSE. Polls
follow the chain's block interval and each is one header request: `logsBloom` skips blocks without
exchange logs, logs are read by block hash, and parent-hash links detect reorgs; with several RPC
endpoints, one whose head stalls is left for one that is ahead. Backfills use parallel ranged
`eth_getLogs` sized to the provider's limits, finalized ranges are re-read so persisted history is
exact, and finality reads back off while it stands still. Contract reads share one Multicall3 call,
history reads are cached until a write changes them, and the database never holds up the live index.

**Δ-vaults** (`docs/delta-vault.md`) pool liquidity per stock and quote both branches of every
event at `Y = s(1 + (1−p)δ̂)`, `N = s(1 − pδ̂)`, learning the conditional gap `δ̂` from their own
fills. A share is an exact pro-rata claim on everything the vault holds (credit, order escrow and
YES/NO claims): deposits and withdrawals are in kind, so no price, probability or keeper input ever
moves value between depositors. The keeper posts only passive quotes, each inside a band around a
Chainlink price with a short lifetime, a cutoff buffer and size caps, never leaving crossed quotes or
a worst-case YES-minus-NO stock position above the market cap. The guardian pauses deposits and
quoting; withdrawals are never paused (the admin may rate-limit them to no less than 10% a day).

Gas (Foundry, including test harness): resting bid 124k, resting claim-funded ask 119k, market buy
filling one maker 85k (partial 93k), four makers 139k, eight makers 203k, cancel 34k.

## Commands

```bash
bun install
bun run build:contracts          # forge build, enforces the 24 KB runtime limit
bun run test                     # Foundry suite + every TypeScript suite (owned local PostgreSQL)
bun run typecheck
bun run check                    # Biome, forge fmt/lint, typecheck and all tests
```

Local stack on anvil:

```bash
anvil --block-time 1                         # in another terminal
bun run anvil:bootstrap                      # mock tokens, exchange, funded demo wallets → .local/anvil.env
POLYMARKET_INTERNAL_TOKEN=<16+ chars> bun run dev   # PostgreSQL, API :3000, UI :3001, admin :3002, ingestor
bun run seed:markets                         # demo catalogue through the admin evidence flow; funds the maker
```

The bootstrap also deploys a seeded NVDA Δ-vault over a mock Chainlink feed (kept at the reference
price by `scripts/evm/feed-relay.ts`); seeding registers its NVDA markets, and `dev` then runs its
keeper. Vaults: http://localhost:3001/vaults; controls: http://localhost:3002/vaults.

Reference prices come from Pyth Hermes, whose price endpoints require an entitled key: set
`PYTH_HERMES_API_KEY` (and optionally `PYTH_HERMES_URL`) for the API. Without it prices show as
unavailable and the market maker does not quote.

## Deployment

1. `bun run build:contracts`, then `bun run deploy:exchange` with `CHAIN_ID` (8453, 84532, 4663 or 46630),
   `RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `QUOTE_TOKEN` and dedicated `ADMIN`, `MARKET_ADMIN`, `GUARDIAN`,
   `RESOLUTION_ADMIN` addresses (`--mainnet` for Base or Robinhood Chain). The quote token is
   immutable and pinned per chain: USDC on Base, USDG on Robinhood Chain (on a testnet without
   usable USDG, `bun run deploy:mock-usdg` deploys an open-mint stand-in). The record is written to
   `deployments/<chainId>.json`. Stock tokens are listed with their catalogued underlying
   (`packages/shared/src/token-catalog.ts`), so add a token's symbol there before listing it.
2. API (`apps/server`): `CHAIN_ID`, `RPC_URL` (comma-separated endpoints fail over),
   `EXCHANGE_ADDRESS`, `DEPLOYMENT_BLOCK`, `DATABASE_URL` (run `bun run db:migrate` first),
   `API_AUTH_ORIGINS`, optional `POLL_MS` (fixes polling; by default it follows the block time) and
   `FINALITY_DEPTH` (RPCs without the `finalized` tag),
   `TRADING_DELEGATE_ADDRESS`/`TRADING_DELEGATE_PRIVATE_KEY`, `POLYMARKET_INGESTOR_URL`/
   `POLYMARKET_INTERNAL_TOKEN`, `EVIDENCE_PUBLIC_BASE_URL`, `PYTH_HERMES_API_KEY`, `REDIS_URL`, and
   `FAUCET_PRIVATE_KEY` (testnets only).
3. UIs: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_CHAIN_NAME`, `NEXT_PUBLIC_RPC_URL`,
   `NEXT_PUBLIC_EXCHANGE_ADDRESS` (and `API_URL` for the admin's server routes).
4. Market maker: `MM_*` settings (see `scripts/evm/bootstrap.ts`) with a dedicated wallet; run `--fund`
   once, then `MM_MODE=live … --execute`.
5. Δ-vaults: `bun run deploy:vault` with `CHAIN_ID`, `RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `BASE_TOKEN`,
   `PRICE_FEED` (the token's own Chainlink feed) and dedicated `VAULT_ADMIN`, `CURATOR`, `KEEPER`,
   `GUARDIAN` (Base pins its sequencer-uptime feed). Testnets have no Chainlink stock feeds:
   `bun run deploy:mock-feeds` (`FEEDS`, `FEED_SOURCE_RPC_URL`) deploys mocks seeded from the
   stocks' Robinhood Chain mainnet feeds, and `bun run start:feed-mirror` keeps them current. The
   vault admin signs the printed role and cap calls; the curator sets limits and adds markets
   (admin console → Vault controls); the admin makes the first deposit. Then set `DELTA_VAULT_ADDRESSES` (API) and `NEXT_PUBLIC_DELTA_VAULTS` (UIs), and
   run the keeper with `VK_*` settings (see `services/vault-keeper/src/main.ts` and
   `scripts/evm/bootstrap.ts`) from a wallet holding only `KEEPER_ROLE`.

`ops/ec2` runs the ingestor, the API and (when `.env.market-maker` or `.env.vault-keeper` exists) the
market maker and the vault keeper under PM2 behind nginx. A testnet host (x86_64 or Graviton) runs the
same bootstrap with a local PostgreSQL instead of Aurora, the mock-feed mirror when
`.env.feed-mirror` (`FEED_MIRROR_PRIVATE_KEY`, `FEED_SOURCE_RPC_URL`) exists, and either plain-HTTP
ingress (`PROBABL_NGINX=http bash ops/ec2/setup-supervision.sh`) or HTTPS on its own domain: point a
DNS-only record at it, issue the certificate with `sudo certbot certonly --standalone -d <domain>
--pre-hook "systemctl stop nginx" --post-hook "systemctl start nginx"` (no Cloudflare token on the
host), then run `PROBABL_DOMAIN=<domain> bash ops/ec2/setup-supervision.sh`.
