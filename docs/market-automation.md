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

There is one job today, **`resolve-markets`**, which runs every minute. For each open, frozen or awaiting market, it reads Polymarket's payout from Gnosis Conditional Tokens on Polygon, at the finalized block. Once that payout is reported, each run advances the market one step:

1. **Freeze.** At the cutoff, or early if the payout arrives before it.
2. **Commit the payout.** The job first waits until Polymarket's API also reports the market closed and resolved. It then prepares and approves a resolution packet citing both sources, and commits the payout as the market admin.
3. **Resolve.** Signed as the resolution admin.

A step only runs when the API's indexed state of the market matches its state on chain. The index trails the chain by a few seconds, so a lagging market simply waits for the next run.

What the job maps and what it leaves alone:
- **Payouts:** YES, NO and an even split map to local payouts. Any other split is logged once and left for a person.
- **Resolver key:** without a key for the resolution admin, markets stop at step 2 for a person to resolve. That is the two-key setup production should use.

## Creating markets from a job

`createMarkets(admin, specs)` creates and opens one market per spec. Each spec is a Polymarket market (its Gamma id) and a stock token. Optional fields are the trading cutoff (Polymarket's end time by default), fees, maker rebate and limits.

It is idempotent, so a job can pass the same specs on every run:
- A market already on chain for the same Polymarket condition and token is returned as is.
- A packet from an interrupted run is resumed, never executed twice.

`scripts/evm/create-markets.ts` uses the same function for planned markets.

A daily ladder job looks like this:

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

The importer accepts any Polymarket YES/NO market. That includes the daily "above $K" crypto and stock strike ladders, and single outcomes of negative-risk events (one winner among many), such as FOMC or CPI brackets, election candidates and "largest company".

Two kinds of outcome change meaning after listing, so they are refused:
- **"Other" outcomes.** The normalizer rejects them.
- **Inactive markets,** such as unnamed placeholders like "Person X". Market creation refuses them.

A market inside a multi-market event links to its own page, `polymarket.com/event/<event>/<market>`.

## Configuration

| Variable | |
|---|---|
| `CHAIN_ID`, `RPC_URL`, `EXCHANGE_ADDRESS` | Shared with the API (`.env`). |
| `MARKET_ADMIN_PRIVATE_KEY` | The exchange's market admin. It signs creation, lifecycle and commitments, and the API session. |
| `RESOLUTION_ADMIN_PRIVATE_KEY` | Optional. Not needed when both roles are the same wallet. |
| `POLYGON_RPC_URL` | A Polygon RPC that serves the `finalized` block tag. |
| `AUTOMATION_API_URL` | Default `http://127.0.0.1:3000`. |
| `AUTOMATION_AUTH_ORIGIN` | A sign-in origin in the API's `API_AUTH_ORIGINS`. Default `http://localhost:3002`. |

On the backend host, put the keys in `.env.market-automation` (mode 600). PM2 then runs the service with `--execute` (`ops/ec2/ecosystem.config.cjs`).
