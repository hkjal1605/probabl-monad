# Public UI demo mode

Choose **Try demo mode** in the mode bar below the header. No wallet, RPC, API, indexer, Polymarket ingestor or database is needed; only the Next.js UI server must run (`bun run dev:ui`, port 3001). Demo is available in both development and production UI builds. **Switch to live** asks for confirmation, then reloads the document into the existing real-service integration. Live is the default. Demo is not available in the admin UI; its resolution controls simulate that workflow inside the public demo.

The old `NEXT_PUBLIC_ENABLE_PREVIEW_DATA` setting is obsolete. Live mode never silently substitutes fictitious markets for unavailable or empty upstream data. Existing live environment variables, auth, signed orders, relayer fallback and transaction preparation remain in use in live mode.

## Functionality map

| UI area | Demo behavior |
| --- | --- |
| Home and markets | NVDA, TSLA and SPY fixtures, search, lifecycle filters, changing branch prices/depth and informational probability. Includes open, awaiting-review and redeemable examples. |
| Market details | Both branch books, user resting orders, recent fills, exact terms, local evidence and resolution links. Dummy transaction IDs never link to a real explorer. |
| Order ticket | YES/NO, buy/sell, whole/active-claim funding, approval/review/submit, GTC and IOC, insufficient funding and invalid-order checks. No signature is requested. |
| Matching and orders | Finite price-priority liquidity, FIFO resting orders, maker-price execution, partial fills, IOC remainder release, cancellation, expiry, duplicate prevention and self-cross rejection. |
| Portfolio | Whole available balances, reserved collateral, all four claims per market, approval, complementary-pair merge, winning/losing/invalid redemption. Changes appear together after each action. |
| Funds | Faucet, supported-token transfers to dummy recipients, self-transfers, exchange claim permission revocation, address copy, complementary-pair splitting and activity history. Never send real funds to the displayed address. |
| Resolution | Explicit cutoff, evidence review, irrevocable YES/NO/50–50 choice, resolution and redemption. Cutoff releases resting orders. The short SPY scenario reaches cutoff after 90 simulated seconds. Review waits for a user-selected outcome. |
| Wallet | Local demo connection, sign-in, disconnect and reconnect; no injected wallet interaction. |
| Shared navigation | Header/footer, learn page, mobile menu, light/dark/system theme, and unknown-market recovery links remain usable. |

## Accounting and clock

The engine (`apps/ui/src/lib/demo/engine.ts`) uses the domain package’s raw-unit ratio helpers and `bigint` arithmetic: stocks have 18 decimals, USDG has 6. Floating-point values are only for generating fictitious quotes/probabilities and displaying them. Reservations round up; execution and redemption round down. Whole-token-funded fills deliver the active acquired claim and retain the complementary claim on the funding asset, mirroring `ConditionalSettlement`. Claim-funded fills do not mint an extra complementary claim. Cancellation, expiry and IOC return remaining funds to their original asset.

Each action executes atomically on a cloned ledger; errors cannot partially debit balances. Dummy counterparties supply bounded liquidity each tick. No simulated trader is allowed to spend beyond available funds or claims.

The clock advances every 3 seconds while the tab is visible. **Pause simulation** freezes the market clock; manual trading and resolution controls still work. Hidden/closed tabs do not catch up or execute a burst of unseen fills on return. Frozen and resolved stages advance after 12 simulated seconds; evidence review requires an explicit decision. Reset starts a fresh scenario.

## Storage and isolation

- The mode is an HTTP-only, SameSite=Lax cookie (`probabl-mode`), selected by a same-origin POST. Full-document navigation clears React Query, forms and wallet context. A mode-change notification reloads other open tabs; back/forward-cache restoration also reloads. Browsers with local storage disabled should reload other tabs manually after switching mode.
- The ledger is versioned **per-tab session storage** (`probabl.demo.v1`): page changes, reloads, and switching to live and back retain it in that tab. It is not a durable account backup; closing the tab/browser may discard it. Separate tabs cannot concurrently mutate one ledger. Reset only replaces this demo snapshot.
- The engine validates restored snapshots and resets incompatible/corrupt data. If storage is unavailable, the demo runs in memory with a warning that reload loses progress.
- Retention is bounded: 100 open orders, approximately the latest 300 closed orders, 300 fills and 120 activity entries. No protocol database writes, background indexer jobs, real RPC calls or Polymarket subscriptions are created.
- Server-rendered demo pages skip live API reads, including during Next.js prefetch. Gateway/indexer proxy routes reject demo-cookie requests before upstream forwarding. The demo wallet explicitly throws if any code tries to sign or send a real transaction.
- The cookie is a UI preference, **not authentication or authorization**. No backend, contract, indexer or admin access rule is relaxed for demo mode.

## Verification

Run `bun test apps/ui/test packages/ui/test`, `bun --filter @conditional-stocks/web typecheck`, `bunx biome check apps/ui/src apps/ui/test`, and `bun run build:ui`.

Regression tests cover every branch/funding combination, integer rounding, reservation conservation, partial GTC/IOC fills, FIFO and price priority, cancellation, expiry, self-cross/duplicate/invalid input rejection, atomic rollback, split/merge, transfers, all resolution payout vectors, no double redemption, bounded history, persisted restarts, and gateway/mode isolation. Browser verification artifacts are kept locally under `output/playwright/probabl-demo/`.

On 2026-09-07, the complete TypeScript suite passed **205 tests**, all workspace typechecks passed, Biome passed, and the optimized UI build passed. Playwright checks exercised the trading and claim/resolution flows, 24 responsive route/viewport combinations, themes, navigation, mode switching, and per-tab isolation. A production-build trading smoke test also passed without real-wallet calls or live API requests.

This is an interactive product simulator, not a chain emulator or a deployment-readiness/security audit. It does not reproduce gas, RPC outages, reorgs, multisig delays, production liquidity, wallet rejection UX or all contract risk limits. Real token/contract integration testing remains separate.
