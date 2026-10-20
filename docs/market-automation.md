# Market automation

`services/market-automation` creates and settles markets without the admin console. It uses the console's own path, the API's evidence flow:

1. Polymarket snapshot
2. Evidence packet
3. Approval
4. Transaction preview
5. Signature
6. Reconciliation

Every transaction the API previews is rebuilt locally from the approved evidence and the live chain, and is signed only when the two agree.

## What runs

`src/main.ts` runs every job in `src/jobs/index.ts` (`JOBS`), each on its own interval. Runs of one job never overlap, and a failed run is logged and retried on the next interval.

- **Dry run is the default.** In a dry run, jobs log what they would do and change nothing.
- **`--execute`** signs transactions.
- **`--once`** runs each job once and exits.

There are four jobs today: `resolve-markets`, below, `daily-ladders` and `weekly-ladders` (see "Daily and weekly ladders") and `curate-vaults` (see "Curating Δ-vaults").

**`resolve-markets`** runs every minute. For each open, frozen or awaiting market, it reads the final result of the market's event from its venue (`eventSource` in the indexer's market view):

- **Polymarket:** the payout reported to Gnosis Conditional Tokens on Polygon, read at the finalized block (`src/venues/polymarket.ts`).
- **Kalshi:** the result of a `finalized` market, from the ingestor's latest snapshot, which it refreshes every minute (`src/venues/kalshi.ts`).

Once the result is final, each run advances the market one step:

1. **Freeze.** At the cutoff, or early if the result arrives before it.
2. **Commit the payout.** The job first fetches a fresh snapshot from the venue's API, which must agree: Polymarket must report the market closed and resolved, Kalshi must show the same finalized result. It then prepares and approves a resolution packet, and commits the payout as the market admin. Polymarket packets cite Polygon as well; Kalshi packets have no Polygon record.
3. **Resolve.** Signed as the resolution admin.

A step only runs when the API's indexed state of the market matches its state on chain. The index trails the chain by a few seconds, so a lagging market simply waits for the next run.

What the job maps and what it leaves alone:
- **Payouts:** YES, NO and an even split map to local payouts. Any other split is logged once and left for a person.
- **Resolver key:** without a key for the resolution admin, markets stop at step 2 for a person to resolve. That is the two-key setup production should use.

## Creating markets from a job

`createMarkets(admin, specs)` creates and opens one market per spec. Each spec is a venue market and a stock token: `{ source: "polymarket", marketId: <Gamma id> }` or `{ source: "kalshi", marketId: <ticker> }`. Optional fields are the trading cutoff (the venue market's end time by default), fees, maker rebate and limits.

It is idempotent, so a job can pass the same specs on every run:
- A market already on chain for the same event and token is returned as is.
- A packet from an interrupted run is resumed, never executed twice.

`scripts/evm/create-markets.ts` uses the same function for planned markets (each planned event names a `gammaMarketId` or a `kalshiTicker`).

A job that creates markets looks like this (the ladder jobs in `src/jobs/ladders.ts` are the full version):

```ts
export const dailyLadders: Job = {
  name: "daily-ladders",
  everyMs: 15 * 60_000,
  async run({ admin, execute, logger }) {
    const specs: MarketSpec[] = []; // today's Polymarket strikes × stock tokens, cutoffs before the fixing
    if (!execute) return logger.info("ladders.planned", { markets: specs.length });
    for (const result of await createMarkets(admin, specs))
      if ("error" in result) logger.error("ladders.failed", { ...result });
  },
};
```

Add it to `JOBS`.

Kalshi lists a new event per day for recurring questions as well (e.g. `KXBTCD-26OCT2017`, Bitcoin's price on Oct 20 at 5 pm ET, with a market per strike); its markets come from `GET /events/{event_ticker}` on Kalshi's public API, and a spec takes each market's ticker.

The importer accepts any binary Kalshi market and any Polymarket YES/NO market. That includes the daily "above $K" crypto and stock strike ladders, and single outcomes of negative-risk events (one winner among many), such as FOMC or CPI brackets, election candidates and "largest company".

Two kinds of outcome change meaning after listing, so they are refused:
- **"Other" outcomes.** The normalizer rejects them.
- **Inactive markets,** such as unnamed placeholders like "Person X". Market creation refuses them.

A market inside a multi-market event links to its own page, `polymarket.com/event/<event>/<market>`.

## Daily and weekly ladders

**`daily-ladders`** (every 10 minutes) and **`weekly-ladders`** (every 30 minutes) create cross-asset markets on Kalshi's "above $K at a fixing" strikes, e.g. "MSTR if Bitcoin ≥ $81,750 at 5 pm ET today". The ladder config (`AUTOMATION_LADDERS_PATH`) lists, per cadence, a Kalshi series, its New York fixing time and the tokens, each with 1 to 3 rungs. `services/market-automation/ladders.example.json` is the Robinhood testnet slate:

| Cadence | Series (fixing, New York time) | Tokens × rungs |
|---|---|---|
| Daily, 16 markets | `KXBTCD` Bitcoin (5 pm) | MSTR × 3, COIN × 3, WETH × 3 |
| | `KXETHD` Ether (5 pm) | COIN × 1 |
| | `KXGOLDD` gold (5 pm) | SLV × 2 |
| | `KXNASDAQ100U` Nasdaq-100 close (4 pm) | NVDA × 2 |
| | `KXWTI` WTI settlement (2:30 pm) | XOM × 1, CCL × 1 |
| Weekly, 8 markets | `KXBTCD` Bitcoin (Friday 5 pm) | MSTR × 2, COIN × 2, WETH × 2 |
| | `KXGOLDW` gold (Friday 5 pm) | SLV × 2 |

Each pair is cross-asset: a token on its own asset's ladder (WETH on Ether, SLV on silver) is a disguised up/down bet, so none is listed.

**When markets are created:**
- **Daily:** for the next weekday fixing within 26 hours. Kalshi lists most daily events a few hours to a day ahead.
- **Weekly:** for a Friday fixing two to seven days ahead.
- Both need at least an hour of trading. Trading stops 30 minutes before the fixing, when the result is all but known.
- Bitcoin's Friday 5 pm event serves both cadences. Each owns the markets opened on its side of 48 hours before the fixing, so neither counts or reuses the other's strikes.

**Which strikes:** the "above" strikes nearest even odds, so both branches get traders:
- 1 rung aims at 50%, 2 rungs at 40% and 60%, 3 rungs at 50%, 30% and 70%.
- Only active strikes quoted on both sides within 10¢ and priced 20–80% qualify; ties go to the larger open interest.
- A token's existing markets on the fixing, including an unfinished packet, count toward its rungs. An interrupted run is resumed, never repeated.
- A token short of eligible strikes is logged (`ladders.short`) and retried on the next run.

Once a fixing has all its markets, the job doesn't read Kalshi or the API for that ladder again until the next fixing is due. `resolve-markets` freezes each market at its cutoff and settles it from Kalshi's final result. All tokens must have 18 decimals, which the default limits assume; the config is checked at startup.

## Curating Δ-vaults

**`curate-vaults`** runs every minute and registers new markets in the Δ-vaults listed in the vault config (`AUTOMATION_VAULTS_PATH`, see `services/market-automation/vaults.example.json`). The vault's keeper then quotes them over RFQ.

A market is registered in a vault when all of these hold:
- it is on the vault's stock (`BASE`),
- it is scheduled or open,
- it is not registered yet,
- it has at least five minutes of quoting left before its cutoff buffer.

Markets go in nearest cutoff first, up to the vault's 48-market cap. A full vault logs `curate.vault-full` once and takes the next markets as soon as settled ones free their slots. Once a market resolves, the keeper settles it within a round; anyone can settle it.

Each vault gets a risk template, in whole tokens:

| Field | |
|---|---|
| `bandBps` | Largest distance of a quote from the vault's oracle price. |
| `cutoffBufferSeconds` | Quoting stops this long before the cutoff. A market with less than ten times this left gets a tenth of its remaining life, at least a minute. |
| `maxOrderQuote`, `maxRestingQuote` | Largest notional of one quote, and of all resting quotes in the market, in the quote token. |
| `maxImbalanceBase` | Largest YES-minus-NO stock position, in the stock token. |

The curator can still change a market's risk with `updateRisk`, or remove it while the vault holds no position in it.

The job signs as the vault's curator: `CURATOR_PRIVATE_KEY`, or the market admin's key when that wallet is also the curator. At startup it reads each vault and refuses to run if the key lacks `CURATOR_ROLE`. The curator key must not be the keeper's (the keeper refuses to run a key holding curator rights).

## Configuration

| Variable | |
|---|---|
| `CHAIN_ID`, `RPC_URL`, `EXCHANGE_ADDRESS` | Shared with the API (`.env`). |
| `MARKET_ADMIN_PRIVATE_KEY` | The exchange's market admin. It signs creation, lifecycle and commitments, and the API session. |
| `RESOLUTION_ADMIN_PRIVATE_KEY` | Optional. Not needed when both roles are the same wallet. |
| `POLYGON_RPC_URL` | A Polygon RPC that serves the `finalized` block tag. |
| `AUTOMATION_API_URL` | Default `http://127.0.0.1:3000`. |
| `AUTOMATION_AUTH_ORIGIN` | A sign-in origin in the API's `API_AUTH_ORIGINS`. Default `http://localhost:3002`. |
| `AUTOMATION_LADDERS_PATH` | The ladder config. Default `.local/market-automation/ladders.json`; without the file, no ladders are created. |
| `KALSHI_API_URL` | Kalshi's public API, which lists the ladders' strikes. Default `https://api.elections.kalshi.com/trade-api/v2`. |
| `AUTOMATION_VAULTS_PATH` | The vault curation config. Default `.local/market-automation/vaults.json`; without the file, no vaults are curated. |
| `CURATOR_PRIVATE_KEY` | Optional. The vaults' curator, when it is not the market admin. |

On the backend host, put the keys in `.env.market-automation` (mode 600). PM2 then runs the service with `--execute` (`ops/ec2/ecosystem.config.cjs`).
