# Short-term markets on Probabl: what the code allows, what blocks it, what must change

Date: 2026-10-20. Code: `/Volumes/T9/probabl` at `07fc63d` (`evm-solana-parity` and `main` point to the same commit, so `git diff main` is empty). Solana build: `/Volumes/T9/probabl-sol`, read only. Every code claim cites `file:line`. Paths are relative to the repo root unless they start with `probabl-sol/`. Live API and chain reads were made on 2026-10-20; raw responses are in `/Volumes/T9/tmp-probabl/market-research/constraints/`.

## Summary

- **The contracts already allow short markets.** A market needs only `cutoff > open` and `cutoff > now` (`contracts/src/ConditionalStocksAdmin.sol:150-151`). There is no minimum lifetime, no delay between cutoff and resolution, and no challenge window. Trading stops on chain at `cutoff` (`contracts/src/ConditionalStocks.sol:206-209`).
- **Gas is not a constraint.** A full market lifecycle costs about 0.35M gas, roughly 7×10⁻⁶ ETH at today's 0.02 gwei on Robinhood Chain.
- **The off-chain stack is what blocks short markets.**
  - The creation script refuses any event that ends within a day (`scripts/evm/create-markets.ts:203`).
  - The Polymarket normalizer accepts only binary markets labelled exactly YES/NO and not negative-risk (`packages/market-data/src/metadata.ts:93-110`). That rules out every Polymarket "Up or Down" market (crypto 5m/15m/1h/4h, daily stocks), the Fed decision, CPI, weather and most sports markets. Earnings "beat" markets and "closes above $X" strike ladders pass.
  - Every lifecycle step is manual.
  - Several services keep work for every market ever created: the ingestor polls all subscriptions forever, the indexer and UI list every market, the market maker has a static list of at most 50, and each Δ-vault holds at most 8 markets added by hand.
- **Resolution is two human keys behind a Polymarket evidence packet.** The fastest time from "event happened" to "redeemable" is Polymarket's own resolution time plus however long the humans take.
  - Polymarket's own resolution times (median, measured): 1.3 min for 5m/15m crypto; 11 min for hourly BTC; 25 min for NVDA daily; 2.5 h for SPX daily; days when disputed.
  - The Polygon outcome is readable on chain, but only on Polygon.
  - Automating resolution needs no contract change. But a bot holding both the market-admin and resolution-admin keys removes the protocol's only on-chain check against a wrong payout.
- **Polymarket's Terms of Use bar "exchanges" from using its data, even on-chain, without written agreement** (`constraints/pm-kalshi/dl/pm_tos.txt:82-83`). That applies to today's display probabilities and to any mirroring.
- **The exchange never reads a price.**
  - The only price on chain is the vault's Chainlink sanity band.
  - Robinhood Chain's Chainlink feeds are push feeds with a 0.5% deviation threshold and a 24 h heartbeat. Stock feeds pause about 54 h every weekend. They cannot fairly resolve "NVDA up today" or "BTC up this hour".
  - A price-resolved market needs a new resolver contract, given the roles or added as an extension, ideally verifying Chainlink Data Streams reports. Data Streams' VerifierProxy is deployed on 4663. Such a resolver breaks the oracle-free design the docs argue for (`docs/future-improvements.md:10`).
- **Crypto on Robinhood Chain mainnet:**
  - **ETH:** viable; the WETH/USDG pool holds about $19M.
  - **BTC:** cbBTC exists but its total supply is only 22 BTC, with about $1.15M of DEX liquidity.
  - **SOL:** none.
  - The EVM tooling cannot list any crypto base today (no catalog underlying).
  - The Solana build already seeds BTC, ETH and SOL markets.
- **Markets about the asset's own price are a poor fit.** "BTC if BTC-up-this-hour" is economically a short-dated gap call on BTC. Its two branch prices hold no information beyond spot and volatility. It locks about 400× more capital than the equivalent Polymarket binary, and the Δ-vault's fixed-δ̂ model misprices it near expiry.
- **Good short conditional events move the stock without being defined by its price.** Examples: earnings beats, CPI or payrolls against a threshold, FOMC decisions, deliveries, product events.

---

## 1. Market creation

### 1.1 On-chain inputs

`createMarket(MarketParams p, string metadataUri)` (`contracts/src/ConditionalStocksAdmin.sol:140-172`). The struct is defined at `contracts/src/ConditionalStocksBase.sol:162-180`.

| Field | Meaning | Check at creation |
|---|---|---|
| `base` | Stock token; its pool must already be listed | `ConditionalStocksAdmin.sol:145` |
| `condition`, `yesIndex`, `noIndex` | Event commitment (the Polymarket condition id and which index set is YES) | Non-zero; indices (1,2) or (2,1) (`:147-148`); hashed into the event key (`:170`) |
| `rulesHash` | keccak of the rules text | Non-zero (`:147`) |
| `metadataHash`, `metadataUri` | URI of 1–512 bytes; the hash must match | `:149-150` |
| `open`, `cutoff` (uint40 unix seconds) | Trading window | `cutoff > open` and `cutoff > block.timestamp` (`:150-151`). No minimum length |
| `tick`, `step`, `maxSteps` | Price tick (quote raw × 1e18 per base raw), quantity step, maximum steps per order | `_validateCaps` (`:187-201`) |
| `minNotional`, `maxOrder`, `maxWallet`, `maxMarket` | Notional caps in raw quote units | Ordered `min ≤ order ≤ wallet ≤ market`; one minimum order must fit and two must fit the market cap (`:188-200`) |
| `makerBps`, `takerBps` | Per-market fees, at most 1,000 bps each | `:153`, `MAX_FEE_BPS` (`ConditionalStocksBase.sol:15`) |

- The terms, fees and Polymarket mapping are immutable (`ConditionalStocksAdmin.sol:137-139`). A postponed event cannot have its cutoff moved: freeze the market and resolve it INVALID, or create a new market.
- The maker rebate is the only mutable economic parameter (`setMakerRebate`, `:177-183`).
- There is no expiry or resolution-time field beyond `cutoff`. The event time lives only in the off-chain rules.
- A market starts SCHEDULED (`:159`). It opens only through a separate market-admin transaction `lifecycle(id, 0)`, allowed when `open ≤ now < cutoff` (`:211-217`). So markets created in advance for later hours need one more transaction each at their open time. Nothing opens them automatically.

### 1.2 Off-chain creation flow

Admin console and API (`apps/server/src/admin/routes.ts`):
1. `POST /v1/admin/polymarket/metadata/fetch` with a Gamma market id (`:169-175`). This stores a raw snapshot in the ingestor (`services/polymarket-ingestor/src/service.ts:81-139`).
2. `POST /v1/admin/evidence/creation/prepare` with the snapshot id, source URLs and `config` (`:178-254`). The config fields are in `packages/market-data/src/evidence.ts:33-56`: base/quote, step, tick, caps, fees, `tradingOpen`, `tradingCutoff`, metadata URI and rules. The packet embeds the Polymarket question, rules, end time and resolution source (`evidence.ts:284-322`).
3. `POST /v1/admin/evidence/:hash/review`: approve with a six-item checklist (`admin/routes.ts:38-45,276-299`).
4. `POST /v1/admin/evidence/:hash/transaction` builds the transaction preview: `listPool` first if needed, then `createMarket` (`admin/routes.ts:300-366`; `packages/evm-client/src/admin.ts:85-119`).
5. The market admin signs.
6. `POST /reconcile` checks the receipt and starts ingestor tracking (`admin/routes.ts:378-424`, `:421-422`).
7. A separate open transaction.

Constraints in this flow that matter for short markets:
- **A Polymarket snapshot is mandatory** (`admin/routes.ts:181-183`). Probabl-native or Kalshi-only events cannot be created through it. The contract itself accepts any non-zero `condition`.
- **Accepted Polymarket shapes:**
  - Negative-risk markets are rejected (`metadata.ts:93-98`).
  - Outcomes must be exactly one "YES" and one "NO" (`metadata.ts:99-110`).
  - Live Gamma data on 2026-10-20 (`raw/*.json`):

| Polymarket short-term family (live example) | Outcomes / negRisk | Passes the normalizer? |
|---|---|---|
| `btc-up-or-down-hourly`, `-15m`, `-5m`, `-4h` (also ETH, SOL, XRP, DOGE, BNB, HYPE, ZEC) | `["Up","Down"]`, false | **No** (labels) |
| `nvda-daily-up-down`, `aapl-daily-up-down`, `tsla-…`, `nflx-daily-up-or-down`, … | `["Up","Down"]`, false | **No** (labels) |
| `aapl-multi-strikes-weekly` "AAPL closes above ___ on October 20?" (5 strikes) | `["Yes","No"]`, false | Yes |
| `bitcoin-above-on-october-20-2026` (11 strikes, Binance source, ends 16:00Z) | `["Yes","No"]`, false | Yes, but there is no BTC base on EVM (§6) |
| `nflx-earnings` "Will Netflix (NFLX) beat quarterly earnings?" (and ALLY, COF, UAL, …) | `["Yes","No"]`, false | Yes |
| `fomc` "Fed Decision in October?" | Yes/No, **true** | **No** (negRisk) |
| `us-annual-inflation`, `core-cpi`, `core-cpi-mom` | Yes/No, **true** | **No** (negRisk) |
| `*-daily-lowest-temperature` (weather) | Yes/No, **true** | **No** (negRisk) |
| Sports match winners | Team names | **No** (labels) |

- **Cutoff defaults to Polymarket's `endDate`.**
  - Sources: `CreateMarketForm.tsx:126-129` in `apps/admin/src/modules/CreateMarketPageModule/`, `create-markets.ts:216`, `metadata.ts:131`.
  - The normalizer ignores Polymarket's `eventStartTime`.
  - That is wrong for news-driven events. NFLX's earnings market has `endDate` = `eventStartTime` = 2026-10-20T21:00Z (17:00 ET). Netflix reports after the 16:00 close, so a default cutoff leaves the book open for about an hour after the result is public.
- **The batch script assumes long markets** (`scripts/evm/create-markets.ts`):
  - It throws "The event ends within a day" (`:203`).
  - It opens at `now − 60` (`:215`).
  - It hard-codes one limit set for every market: $1–$10,000 orders, $100k per wallet, $1M per market (`:69-80`).
- **The admin console's batch form** creates up to 20 assets of one event at a time (`apps/admin/src/lib/market-batch.ts:16`). It requires the cutoff to be in the future (`market-batch.ts:259-263`).

### 1.3 Who can create

- Only `_marketAdmin` (`ConditionalStocksAdmin.sol:144`). The same role also:
  - lists pools (`:125`);
  - sets rebates (`:178`);
  - opens markets (`:212`) and freezes them (`:219`);
  - writes the resolution commitment (`:230-234`);
  - archives markets (`:237`).
- The API's evidence routes require the market admin for prepare and review. The resolution admin may also preview and reconcile (`admin/routes.ts:87-93,179,277`).
- **The server does not enforce two different people.** The same wallet may prepare and approve its own packet, and `create-markets.ts` does exactly that (`:175-184,225-229`).
- The admin can reassign all three roles immediately, with no delay (`configure`, `ConditionalStocksAdmin.sol:81-91`). Only an admin transfer waits 2 days (`:94-110`, `ConditionalStocksBase.sol:23`).
- On the Robinhood testnet, `marketAdmin` and `resolutionAdmin` are the same address, `0x727A…aba0` (`deployments/46630.json:9,11`).

### 1.4 Gas and time

**Gas, measured on Robinhood testnet.** These are receipts of the 11 creations in `deployments/46630-markets.json`, read from `rpc.testnet.chain.robinhood.com`:

| Step | Gas |
|---|---|
| `createMarket` | 169,426–186,991 total (median ≈171k), including ≈25k of L1 data (`gasUsedForL1`) |
| Open (`lifecycle 0`) | 45,996, including ≈10.9k of L1 data |

**Gas, execution only, measured in a scratch Foundry copy** (`constraints/forge/proj/test/GasLifecycle.t.sol`, storage warm, so these are lower bounds):

| Function | Gas |
|---|---|
| `createMarket` | 144.5k |
| `setMakerRebate` | 3.3k |
| Open | 4.9k |
| Freeze at cutoff | 4.7k |
| Begin resolution | 26.9k |
| `resolve` | 54.9k |
| Archive | 4.7k |

**Totals and cost.**
- With 21k intrinsic gas, calldata, cold storage and L1 data per transaction, a full lifecycle (create, open, freeze, commit, resolve, optional archive) is about 0.35–0.40M gas.
- Mainnet gas price was 0.020036 gwei on 2026-10-20 (`cast gas-price --rpc-url https://rpc.mainnet.chain.robinhood.com`).
- That puts a market at about 7–8×10⁻⁶ ETH, about $0.03 at $4,000/ETH. Even 100 markets a day costs well under $5 of gas.
- Users pay their own trades, splits and redeems.

**End-to-end time.**
- The script created and opened 11 markets in 107 s of chain time: blocks 129,396,517 to 129,397,239, timestamps 1791223479 to 1791223586. That is about 10 s per market, mostly API round trips and receipt waits.
- Through the console, a human review sits in the middle (prepare, review, preview, sign, reconcile, open), so expect minutes per event.
- Chain inclusion is sub-second: about 0.15 s per testnet block over that run.

### 1.5 Limits and per-market state

- **Market ids.**
  - `uint32` (`ConditionalStocksBase.sol:369`), about 4.3 billion markets.
  - An order key is `market << 40 | branch << 32 | seq` (`:385`), so every branch also has 2³² sequences.
  - No contract loop runs over markets.
- **Per-market storage:**
  - `Terms` (3 slots), `Book` (1), `Backing` (1), `Fees` (2), `FeeRates` (1), event key (1), commitment and evidence (`ConditionalStocksBase.sol:183-231,376-401`);
  - plus one `Account` slot per (owner, branch) and one slot per resting order.
- **Nothing on chain grows with the market count.** On-chain scale is not a limit.
- **Per-vault limits:** a Δ-vault holds at most 8 markets and 48 orders (`contracts/src/vault/DeltaVaultBase.sol:37-38`). Each market is added by the curator (`DeltaVaultAdmin.sol:104-116`) and freed by `settle` after resolution (`:89-102`).
- **Off-chain state grows without bound (§3.4).** Nothing is ever evicted.

### 1.6 Could a service create markets on a schedule?

Yes, with no contract change. `create-markets.ts` is already a headless version of the console flow.

**What a scheduler needs:**
- `MARKET_ADMIN_PRIVATE_KEY`, used for SIWE sign-in (`create-markets.ts:166-174`) and to sign `listPool`, `createMarket`, `setMakerRebate` and open (`:274-316`);
- the API's evidence routes and a running ingestor;
- for Δ-vault liquidity, a `CURATOR_ROLE` key per vault (`DeltaVaultAdmin.sol:105`);
- an edit to the market maker's static market list, at most 50, read once at start (`services/market-maker/src/config.ts:60-61`).

**Security implications:**
- The market-admin key is not a "creator" key. A hot copy of it can:
  - create markets on any listed token with 10% fees and huge caps;
  - list arbitrary pools;
  - freeze any market at any time (`ConditionalStocksAdmin.sol:218-225`);
  - commit any resolution hash, replacing a pending one (`:229-235`).
- The resolution admin can only resolve exactly what was committed (`:278`). So the two-key split is the only on-chain protection against a wrong payout. Automating creation with the market admin alone keeps that protection. Automating resolution as well, with both keys in one process, removes it. On testnet the two are already the same address.
- **Limiting the blast radius without touching the exchange.** The admin may point `marketAdmin` at a contract (`configure`, `:81-91`). A small "market factory" contract holding the role could expose only templated creation to a bot key: whitelisted bases, fee and cap ranges, cutoff rules, no `lifecycle 3`. It would leave commitment, freezing and resolution to a multisig through pass-through functions. Because `configure` takes effect immediately, that role change is itself a governance action to monitor.

---

## 2. Resolution

### 2.1 On-chain path

Each step is a transaction:
1. **Freeze.**
   - At or after cutoff, anyone can call `lifecycle(id, 2)` (`ConditionalStocksAdmin.sol:226-228`).
   - At any time, the market admin or guardian can freeze with a reason hash (`:218-225`).
2. **Begin resolution.** `lifecycle(id, 3, commitment)`, market admin only, from FROZEN or AWAITING. It may replace a pending commitment (`:229-235`). The commitment is `keccak256("PROBABL_EVM_RESOLUTION_V1", chainId, exchange, id, yes, no, evidence, keccak(uri))` (`:248-265`).
3. **Resolve.** `resolve(id, yes, no, evidence, uri)`, resolution admin only. The market must be AWAITING and the arguments must match the commitment exactly (`:268-287`).
   - Payouts are YES (1,0), NO (0,1) or INVALID (1,1) (`ConditionalStocksBase.sol:450-454`).
   - The call sets `resolvedAt` and the market becomes REDEEMABLE.
4. **Redeem.** `redeem(id, collateral, yes, no)` per collateral (quote and stock separately), in REDEEMABLE or ARCHIVED (`ConditionalStocksAdmin.sol:50-67`).
   - INVALID pays ½ of each claim and rejects odd raw totals (`:56-58`).
   - Redeemed amounts go to internal credit, which can trade immediately in another market or be withdrawn (`ConditionalStocks.sol:118-126`).
   - `merge` works in any state (`ConditionalStocksAdmin.sol:37-46`).

There are **no timelocks, challenge windows, minimum durations or dispute paths**:
- A market can be resolved seconds after cutoff.
- It can even be resolved *before* cutoff by freezing it first (freeze `:218-225`, then `:229-235`).
- Once REDEEMABLE nothing can be undone. Mistakes are final.
- The Solana program behaves the same: no delay or time check between commit and resolve (`probabl-sol/programs/conditional-stocks/src/governance.rs:336-398,436-474`).

### 2.2 Off-chain evidence path

The resolution form and API (`apps/admin/src/modules/ResolutionPageModule/ResolutionForm.tsx:86-145`, `apps/server/src/admin/routes.ts:178-254`):
- **Market state.** The market must be frozen or awaiting (`routes.ts:186-187`).
- **Snapshot match.** A fresh Polymarket snapshot must match the market's condition and orientation (`routes.ts:188-193`) and must carry a non-empty `umaResolutionStatus` (`ResolutionForm.tsx:96-99`).
- **What the admin enters by hand:**
  - the outcome (`ResolutionForm.tsx:88-93`);
  - the Polygon Conditional Tokens address;
  - optionally the Polygon resolution transaction, block and block hash (`evidence.ts:107-113,389-398`; `chainId` must be "137", `:345-347`).
- **No automatic checks.** Nothing compares the payout with Polygon's `payoutNumerators`. The "final-status" and "polygon-reference" checklist items are human confirmations (`routes.ts:46-54`).
- **Conflicts.** A second active packet with a different payout is refused (`routes.ts:231-241`).
- **Review.** The market admin reviews and approves (`routes.ts:276-299`).
- **Execution.** The preview chooses begin-resolution or resolve depending on state (`routes.ts:324-329`). The market admin then signs the commitment and the resolution admin signs `resolve`.
- **The ingestor never resolves anything.** A Polymarket `market_resolved` WebSocket event becomes the alert `RESOLUTION_EVENT_REQUIRES_HUMAN_REVIEW` (`services/polymarket-ingestor/src/service.ts:194-197`). A closed or status change becomes `MANUAL_LIFECYCLE_REVIEW_REQUIRED` (`:124-137`). The API labels settlement `"manual-admin-only"` (`apps/server/src/market-data/routes.ts:162`).

### 2.3 Cutoff and minimum times

- **Cutoff.** The only on-chain time rule is `open ≤ now < cutoff` for every placement (`ConditionalStocks.sol:206-208`). There is no extra trading stop before the event; the admin must place `cutoff` before the news. The vault and market maker add their own buffers (§3.3).
- **No minimum creation-to-resolution time.**
- **Freeze is manual.** Nothing calls freeze at cutoff. The only caller is a button in the admin console (`apps/admin/src/modules/MarketControlsPageModule/MarketControls.tsx:187-195`, `MarketLifecycleAction.tsx:28-41`). Until someone presses it, the market stays state OPEN in the index and the UI (§3.4).

### 2.4 How fast can "event happened" become "redeemable"?

- **Chain.** Three transactions (freeze, commit, resolve), each sub-second on Robinhood Chain. So seconds if all are automated.
- **Today.** Total time = Polymarket's resolution time (a non-empty `umaResolutionStatus`; see §2.5 for UMA timings) + fetching the snapshot + preparing and reviewing the packet + two signatures. With people available, the Probabl part is minutes. Overnight or at weekends it is hours.
- **Hourly markets.** A market whose resolution takes longer than its life ties up the trader's capital, and the vault's, across several later markets.

### 2.5 Could resolution follow Polymarket, Kalshi or UMA automatically?

**How fast Polymarket itself resolves short markets.** Measured from Gamma `closedTime` minus `endDate`, n = 20 per series, 2026-10-20 (`constraints/pm-kalshi/pm_events_closed20_*.json`):

| Series | Resolver | Liveness | End → resolved (median) |
|---|---|---|---|
| BTC 5m / 15m Up or Down | Chainlink Data Streams BTC/USD 60 s TWAP, pushed by Polymarket. The tx calls `reportPayouts` through an ERC-4337 operation; no Chainlink report is verified on chain | none | ≈1.3 min |
| BTC hourly Up or Down | UMA adapter `0x65070BE9…`, source Binance BTC/USDT 1h candle | `customLiveness` 600 s | 11.1 min (range 11.0–14.2). Confirmed: the 06:00Z market closed at 06:11:08 (`raw/btc_hourly_closed.json`) |
| BTC daily | UMA | 600 s | 14.4 min |
| NVDA daily Up or Down | UMA, source Pyth `Equity.US.NVDA/USD` | 900 s | 24.8 min (max 189 min) |
| SPX daily | UMA, source WSJ | default 7,200 s | 152.6 min |
| NYC daily weather (negRisk) | UMA | 900 s | ≈05:13 UTC the next day |

- **Disputes.** A first dispute resets the question; a second goes to UMA's DVM, which votes over 24 h commit plus 24 h reveal. Example: `bitcoin-up-or-down-on-october-5-2026` was disputed 10 times over a $13.77 gap and resolved about 56.5 h after its end. In the scan, 4 of 500 BTC daily markets were disputed, and none of 500 hourly, 251 NVDA daily or 252 SPX daily.
- **Reading Polymarket's result.**
  - The outcome is readable on Polygon from the Conditional Tokens contract `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`.
  - Checked: for the 06:00Z hourly market `0x9783a9b7…9d1c`, `payoutDenominator` = 1 and `payoutNumerators` = [0, 1] ("Down"). The read was `cast call` against `https://polygon-bor-rpc.publicnode.com`.
  - The admin console's CTF address comes from `NEXT_PUBLIC_POLYGON_CONDITIONAL_TOKENS_ADDRESS` with an empty default (`apps/admin/src/config/protocol.ts:12`).
  - There is no native path from Polygon to Robinhood Chain. Polygon PoS checkpoints to Ethereum about every 30 minutes and an exit proof is needed after that (Polygon docs, state transfer). A trust-minimized read would take a 30 min+ proof plus an L1-to-L2 message, or a ZK storage proof. Anything faster is a relayer.

**Three ways to automate resolution.**

1. **Relay Polymarket's result** (the smallest change).
   - A bot watches the CTF `ConditionResolution` event for tracked conditions, or polls `payoutDenominator`.
   - It builds the resolution packet with the Polygon transaction, block and hash filled in. It checks the payout vector against `payoutNumerators`, which the current flow never does.
   - Then it signs begin-resolution and resolve.
   - Latency would be Polymarket's (1–25 min for crypto and stock dailies) plus seconds.
   - **Trust model:**
     - Probabl inherits Polymarket's resolver for each market: Polymarket's own push for 5m/15m, the UMA managed-proposer whitelist and the DVM for the rest, and Polymarket's `flag`/`resolveManually` admin path.
     - On top of that sits the bot's key. If the bot holds both Probabl roles, nothing on chain checks it.
   - Keep `resolutionAdmin` separate (a second signer, or a contract that requires a Polymarket-matching packet plus a short delay) to keep the two-key property.
2. **Use Kalshi's result.**
   - Kalshi is off-chain. Its REST API exposes `status` (`determined`, `finalized`, …), `result` (yes/no), `expiration_value` and `settlement_ts` without auth.
   - Measured settlement after close: KXBTC15M about 7 s, KXBTCD hourly 132 s, KXINXU 137 s, daily S&P range 3 h, NYC high temperature about 6 h, KXFED 26 min (`constraints/pm-kalshi/k_markets_settled_*.json`).
   - **Trust:** Kalshi's word, relayed by our key. Kalshi's contract terms allow settlement "no later than the day after the Expiration Date" (`dl/CRYPTO.pdf`).
3. **Use UMA directly.**
   - Optimistic Oracle V3 is not deployed on Robinhood Chain; UMA's network list has no 4663 entry.
   - On Arbitrum it is at `0xa6147867264374F324524E30C02C331cF28aa879`, with a 7,200 s default liveness, a 500 USDC minimum bond and disputes forwarded to the Ethereum DVM.
   - Using it would mean deploying markets on Arbitrum or bridging assertions.
   - With a 2 h default liveness, UMA alone cannot resolve hourly markets inside the hour.

**What any of these does to the trust model.**
- Today a wrong payout needs two Probabl keys to collude (`ConditionalStocksAdmin.sol:229-235,278`) after a human review.
- Automation replaces the review with an external resolver. That resolver is not on Robinhood Chain and cannot be verified there.
- A market that mirrors a disputed Polymarket question is stuck for 2–6 days or more. The exchange has no timeout and no fallback to INVALID.

**Terms of use.** Polymarket's Terms of Use bar a "Capital Market Client", explicitly including "exchanges" and "market data distributors", from accessing or using its data "directly or through an API … including on-chain … unless otherwise agreed to in writing" (`dl/pm_tos.txt:82-83`, linked from https://polymarket.com/tos, effective 2026-08-11). This affects the ingestor's display probabilities as well as any resolution relay.

---

## 3. Trading cutoffs and time handling

### 3.1 Cutoff and order expiry

- **Placements.** Every placement (`place`, `placeFor`, `placeWithQuotes`, `replace`) reverts unless the state is OPEN and `open ≤ now < cutoff` (`ConditionalStocks.sol:205-208`).
- **Expiry.** Every order's expiry must be after now and at or before cutoff (`:209`), so no resting order outlives the cutoff.
- **Order deadline.** The plan deadline must be ≤ expiry (`:213`).
- **Web orders.** The web ticket sets expiry = min(now + 30 days, cutoff − 1, grant expiry − 1) (`apps/web/src/lib/trading/order.ts:107-113`). Short markets need no UI change here.

### 3.2 What happens at cutoff and at resolution

- **Resting orders.**
  - They cannot fill after cutoff, because fills happen only inside placements.
  - They are not cancelled automatically. Their escrow stays locked until someone calls `cancel`.
  - Every expiry is at or before cutoff, so at cutoff every order is expired and "releasable": anyone may cancel it, and the escrow always returns to the owner. Leaving OPEN (a freeze) also makes orders releasable (`ConditionalStocks.sol:645-707`, `:676-678`).
  - No service releases other people's expired orders. The market maker cancels only its own (`services/market-maker/src/engine.ts:182,373`).
  - The indexer keeps open orders of resolved markets until they are cancelled (agent read of `services/indexer/src/projection.ts:348-349`).
  - For hourly markets, users' escrow would sit in dead orders until they clean up, and a claim-funded order's claims cannot be redeemed while escrowed.
- **RFQ quotes.**
  - Nothing rests. A quote is valid only inside a placement, which already fails after cutoff (`:206-208`).
  - Quote expiry and used nonces are checked per fill (`:542`).
  - The Δ-vault additionally rejects quotes whose expiry plus the cutoff buffer passes the cutoff (`DeltaVaultAdmin.sol:245-248`).
- **The vault's orders.**
  - They expire before `cutoff − cutoffBuffer` (`DeltaVaultAdmin.sol:328-331`).
  - The keeper stops quoting when the window left is under three polls (`services/vault-keeper/src/engine.ts:519-526`).
  - After resolution anyone may `settle`: it releases leftover orders, redeems the claims and drops the market (`DeltaVaultAdmin.sol:89-102`). The keeper does this every round (`engine.ts:345-357`).
- **Delegated trading permissions.**
  - Grants do not depend on market lifecycle.
  - The web grants `market: 0` (every market) for 90 days (`apps/web/src/lib/trading/permission.ts:62-64`; the cap is in `ConditionalStocksBase.sol:26`). New hourly markets are covered without re-approval.
  - The quote and share budgets never refill (`ConditionalStocksAdmin.sol:319-325`). Frequent short markets drain them faster, so users re-approve sooner.
  - A delegated order in a closed market is releasable like any other (`ConditionalStocks.sol:676-678`).

### 3.3 Vault cutoff buffer and order TTLs

**On chain** (`contracts/src/vault`):
- `Risk.cutoffBuffer` is set per market by the curator, up to 7 days (`DeltaVaultBase.sol:41,85-88`, `DeltaVaultAdmin.sol:445-450`). The comment reads "Quoting stops (and every order expires) this long before the market cutoff."
- `Limits.maxTtl` caps each order's lifetime at 1 day (`DeltaVaultBase.sol:42`, `DeltaVaultAdmin.sol:141-148`).
- Both are enforced for resting orders (`DeltaVaultAdmin.sol:326-331`) and for RFQ quotes (`:245-248`).
- `addMarket` requires a cutoff still in the future (`:104-116`).
- The vault's Chainlink price sets the price band (`:340-357`). Its maximum age is up to 3 days, because equity feeds stop when markets close (`DeltaVaultBase.sol:43`, `docs/delta-vault.md:313`).

**Keeper** (`services/vault-keeper`):
- Resting orders: expiry = min(now + `ttlSeconds` (300 s default), chain time + `maxTtl`, cutoff − `cutoffBuffer`) (`engine.ts:523-524`, `config.ts:242`).
- RFQ quotes live 10 s by default (`pricing.ts:94-100`, `config.ts:216`).
- Spreads widen up to 3× over the last `wideningSeconds` = 86,400 s before quoting stops (`config.ts:258-259`, `model.ts:98-106`, `docs/delta-vault.md:240`).
  - For any market shorter than a day, quotes start widened.
  - This is one global setting, not scaled to the market's length.
- The keeper requires Polymarket's market to be active and not closed, with p between 2% and 98%, a spread of at most 5% and depth above $100 (`packages/operator/src/reference.ts:105-146`, `services/polymarket-ingestor/src/environment.ts:47`). Short markets reach the 2%/98% bounds quickly, so quoting stops early.
- The model assumes Δ is fairly stable and learns δ̂ from fills (`model.ts:55-66`). §7 shows why that fails when the event is defined by the asset's own price.

**Market maker** (`services/market-maker`):
- `cutoffBufferSeconds` 300 and `ttlSeconds` 120 (`src/config.ts:70-72`). The buffer is 8% of an hourly market.

### 3.4 What assumes long-lived or few markets

From a subagent's read of the indexer, API, web app and database. The key citations were re-read for this note; those marked "agent read" were not.

- **Indexer memory.**
  - Every market stays in the replica forever (`packages/evm-client/src/ledger.ts:110-128,328-372`).
  - Each block rebuilds the public-market map over all markets (`services/indexer/src/projection.ts:93-104`).
  - Every SSE frame carries readiness for every public market.
  - Every 10 minutes a full reconcile makes 4 contract reads for every market ever created: `book`, `backing`, `fees` ×2 (`services/indexer/src/reconcile.ts:95-98,127-132`, `services/indexer/src/service.ts:70`).
  - The checkpoint serializes the whole replica (it calls markets "the few markets", `ledger.ts:803-805`).
- **Price history.** `PriceRecorder` writes a row every minute for every state-2 market, including ones past cutoff that nobody froze (`apps/server/src/market-data/history.ts:49-85`). Nothing is ever pruned.
- **API listing.** `GET /markets` returns every public market with no filter, sort or pagination (`services/indexer/src/service.ts:583-598`).
- **Public identity.** A market's public id is (Polymarket condition, underlying), so two markets on the same condition and stock collapse into one listing (`projection.ts:80-104`). Every hourly market needs its own condition. Polymarket's recurring series already give each interval a new condition.
- **Polymarket metadata cache.** A 30 s cache capped at 1,024 conditions; when full of pending reads it rejects (`apps/server/src/market-data/routes.ts:141-164`, `packages/shared/src/read-cache.ts:25-29`). The web fetches `/v1/markets/:id/polymarket` once per condition on every list load (`apps/web/src/services/markets-api-service.ts:195-231`). It reloads on any SSE change, and every page loads the catalogue through the header.
- **Evidence queue.** The list returns only the newest 200 packets (`packages/database/src/queries.ts:754-757`, called without a limit at `apps/server/src/admin/routes.ts:258`). At 100 markets a day, older pending packets fall off the queue.
- **Web list.**
  - "Active" means chain state 2, even after cutoff.
  - Sorting is only by creation date.
  - There is no pagination, no countdown and no "ending soon" view. A `timeUntil` helper exists in `apps/web/src/lib/format/display.ts:53-61` but nothing calls it.
  - Lists show "Closes" as a date only (`display.ts:43-52`); the market page shows date and time (`:36-41`).
  - Markets past cutoff but not frozen still show Buy buttons on the list. The ticket itself disables at cutoff using local time.
  - The featured banner is the newest event, so it would change with every creation.
  - (Agent read of `apps/web/src/modules/.../MarketsExplorer.tsx`, `MarketsColumns.tsx`, `presentation.ts`, `readiness.ts`.)
- **Redeem.** Only in the portfolio, one transaction per market and collateral, with no batch (agent read of `PositionActions.tsx:159-165`). Hourly markets would mean many small redeems per user per day.
- **Fees.**
  - `claimFees(market, branch, collateral)` is admin-only (`ConditionalStocksAdmin.sol:290-301`) and no app or script calls it.
  - Each market needs up to 4 fee claims and then redeems.
  - Fee rates are per market and fixed at creation, so a scheduler must pick them every time. `create-markets.ts:214` falls back from the market to the event to the plan to zero.
- **Referrals.** These accrue per fill automatically. A market's rewards unlock the first Monday 00:00 UTC after its resolution (`apps/server/src/referrals/service.ts:27-31,169-186`). They work for any market length, but the dashboard lists every market with rewards and reads a probability for each pending one (`service.ts:238-250,272-287`).
- **Database.** Only auth sessions and challenges are pruned. Trades, minute prices, closed orders, referral accruals and evidence are append-only (agent read of `packages/database/src/schema.ts:31-135`).
- **Caching.** Nothing assumes a fixed market set. The web layout is `force-dynamic` and OpenNext has no ISR (agent read of `apps/web/src/app/layout.tsx:36`, `apps/web/open-next.config.ts:3-10`).

---

## 4. Services

### 4.1 Polymarket ingestor

- **Mapping.** One subscription per Polymarket **condition id**, keyed by condition and holding the Gamma market id and the YES CLOB token id. It is created only by `track(snapshotId)`, which the API calls when a creation is reconciled (`services/polymarket-ingestor/src/service.ts:141-161`, `apps/server/src/admin/routes.ts:421-422`).
- **Orientation.** YES/NO comes from the outcome labels. Index set 1 is the first outcome (`packages/market-data/src/metadata.ts:111-117`).
- **No discovery.** Nothing finds new markets. The source can only fetch `/markets/{id}` and `/book` (`source.ts:27-39`). It cannot list events, follow a series or find "the next hour's market".
- **No removal.** Subscriptions are never removed; there is no delete query (`packages/database/src/polymarket/queries.ts:53-232`).
- **Load per tracked condition**, forever, including resolved ones:
  - one REST `/book` read every 30 s (`service.ts:286-293,321-336`, `environment.ts:48`);
  - one Gamma metadata read every 5 min (`service.ts:294-301`, `environment.ts:63`);
  - one WebSocket asset subscription.
  - Each new `track` reconnects the socket with every token ever tracked (`service.ts:155,383-397`).
- **At 24 new conditions a day:**
  - after 30 days: 720 subscriptions, 24 `/book` requests per second and 2.4 Gamma requests per second;
  - after a year: about 290 `/book` requests per second.
- **Polymarket's published per-IP limits**, per 10 s, enforced by Cloudflare throttling (https://docs.polymarket.com/quickstart/introduction/rate-limits):
  - CLOB `/book` 1,500, i.e. 150 requests per second;
  - Gamma `/markets` 300 and `/events` 500.
- **So `/book` throttling begins at about 4,500 tracked conditions.** That is about 190 days of 24 a day, or 45 days of 100 a day, because nothing is ever untracked.
- **Discovery is possible but not implemented.**
  - Polymarket groups recurring markets into `series` (`GET https://gamma-api.polymarket.com/series`, with `recurrence` 5m, 15m, hourly, 4h, daily …).
  - Each interval is a new event and market with a new `conditionId` and predictable slug. Examples: series 10114 `btc-up-or-down-hourly`; 10374 `nvda-daily-up-down`; slugs like `bitcoin-up-or-down-october-20-2026-2am-et`.
  - Markets are listed ahead: hourly about 48 h before, 5m/15m about 24 h, daily stocks at 12:00 UTC the prior trading day.
  - `GET /events?series_id=…&closed=false&end_date_min=<now>&order=endDate&ascending=true` returns the next ones. Without `end_date_min` it can return stale entries still flagged `closed=false`.
  - Polymarket's WebSocket can also push `new_market` and `market_resolved` with `custom_feature_enabled` (https://docs.polymarket.com/market-data/realtime-data.md).
- **The ingestor cannot follow hourly markets automatically.** It needs:
  - series discovery;
  - a normalizer that accepts `Up`/`Down` labels, and reads `eventStartTime` and `eventMetadata.priceToBeat`;
  - unsubscribe on close;
  - incremental socket subscriptions.

### 4.2 Kalshi

There is no Kalshi integration in either repo.
- In `probabl-sol`, "KALSHI" appears only as a pre-IPO base token (PreStocks `KALSHI`, Tessera `tKalshi`) (`probabl-sol/packages/shared/src/token-catalog.ts:215-247`).
- In the EVM repo, Kalshi appears only in research documents (`docs/future-improvements.md:14,23`).

**What adding Kalshi as a display-probability source would take.**

- **Source.** A `KalshiSource` beside `OfficialPolymarketSource` (`services/polymarket-ingestor/src/source.ts:18-152`).
  - Read `GET /markets?series_ticker=…&status=…`, `/markets/{ticker}` and `/markets/{ticker}/orderbook` from `https://api.elections.kalshi.com/trade-api/v2` (or `external-api.kalshi.com`).
  - These need no auth. The WebSocket (`wss://external-api-ws.kalshi.com`) requires API-key headers even for public channels (https://docs.kalshi.com/websockets/websocket-connection.md).
  - Prices now come only as `*_dollars` strings and `*_fp` fields.
- **Normalizer and book model** (`packages/market-data/src/metadata.ts`, `order-book.ts`).
  - Map ticker to YES/NO.
  - Use `close_time` as the cutoff source, and `floor_strike`/`expiration_value` for strike markets.
- **Identity.** The `condition` must be a deterministic hash such as `keccak("KALSHI", ticker)`, because `condition` must be non-zero (`ConditionalStocksAdmin.sol:147`).
- **Evidence.** New creation and resolution packet kinds. Today's are Polymarket- and Polygon-specific (`packages/market-data/src/evidence.ts:58-124,345-347`).
- **Downstream renames.** The API route, web fetch and keeper reference all assume `/polymarket` (`apps/server/src/market-data/routes.ts:144`, `apps/web/src/services/markets-api-service.ts:216-231`, `packages/operator/src/reference.ts:101-146`).
- **Effort.** About 1–2 weeks for display only, plus the same again for evidence and resolution.
- **Limits.**
  - Kalshi's Developer Agreement binds API users; its redistribution terms could not be read.
  - Its Member Agreement bars residents of the UK, Canada, Australia, France, Poland, Singapore, Taiwan, Thailand and others from access (`constraints/pm-kalshi/dl/kalshi-member-agreement.txt`).
  - Rate limits are token budgets (Basic tier about 200 reads per second at about 10 tokens a request; https://docs.kalshi.com/getting_started/rate_limits.md).
- **Why it is useful.**
  - Kalshi's short series are YES/NO strike or range contracts that would pass a YES/NO normalizer: KXBTC15M, KXBTCD hourly BTC, KXINXU hourly S&P, KXINX daily S&P ranges, KXHIGHNY weather, KXFED.
  - They settle within seconds to minutes of close (§2.5).
  - Kalshi's macro and S&P ladders are not negRisk-wrapped, unlike Polymarket's CPI and Fed events.

### 4.3 How markets are listed and displayed

See §3.4. Summary:
- one unpaginated list of every market ever created;
- newest-first sorting only;
- category guessed by regex on the question;
- "Most traded" is the top four by 24-hour volume;
- dates without times or countdowns on lists;
- no "resolving soon" view;
- a Resolution page that renders a card for every market.

### 4.4 Load each market adds

| Component | Per-market cost | Grows with |
|---|---|---|
| Exchange | ≈0.35–0.4M gas over its life; ~10 storage slots | Live markets only |
| Indexer/API | A `MarketState` in memory; per-block projection work; 4 reads every 10 min; a minute-price row while state 2; trades and closed orders in Postgres | **All markets ever** |
| Web | One `/polymarket` request per condition per list load; a card in every list | **All markets ever** |
| Ingestor | `/book` every 30 s; Gamma every 5 min; one WebSocket subscription (per condition) | **All conditions ever** |
| Market maker | ≤50 static markets; per cycle up to 4×levels steps of 2 RPC reads and 2 API reads, plus possible transactions; 0.01 ETH/day gas shared (`services/market-maker/src/config.ts:60-61,81`) | Configured markets |
| Δ-vault | One of 8 slots; keeper reads and transactions per cycle (10 s poll); a `settle` after resolution | Live markets |

---

## 5. Price-based quick markets

**What the docs say.**
- The exchange is fully collateralized and pays in kind: "resolution pays each branch's claims exactly (YES 1/0, NO 0/1, INVALID ½/½)" (`README.md:3-6`, `contracts/src/ConditionalStocks.sol:9-14`).
- The docs' case for in-kind delivery is about oracles: "settling on an oracle price has been manipulated at settlement time on Polymarket's Bitcoin markets, and delivering the actual shares avoids that" (`docs/future-improvements.md:10`).
- The Δ-vault's share accounting is "in kind, so no price is ever trusted" (`docs/delta-vault.md:175-194`, `README.md:118-125`).
- Probabilities and metadata are display-only. Settlement is `"manual-admin-only"` (`apps/server/src/market-data/routes.ts:157-162`).
- The Solana security notes say: "There is no Polygon proof, oracle bridge or automatic resolution" (`probabl-sol/SECURITY.md:44`).

**Price sources in the code today.**
- **Chainlink.** Only as the Δ-vault's band and sanity check (`DeltaVaultAdmin.sol:340-357`), via `PRICE_FEED` at deployment (`README.md:187-196`). On testnets, mock feeds are mirrored from Robinhood Chain mainnet or BNB Chain feeds (`scripts/evm/deploy-mock-feeds.ts:9-32`, `scripts/evm/feed-mirror.ts`). The vault also reads an L2 sequencer-uptime feed where one is configured (`DeltaVaultAdmin.sol:342-348`). Equity feeds update on 0.5% deviation or a 24 h heartbeat and not at all while markets are closed (`docs/delta-vault.md:313`).
- **Robinhood Stock Token API** `https://api.robinhood.com/rhj/prices/{symbol}`. Bid/ask midpoint, cached 15 s by Robinhood and 2 s by the API. For "display and quoting reference only". "Stocks and ETFs … USD stablecoins are their peg. **Other assets have no reference**" (`apps/server/src/market-data/robinhood.ts:1-7,35,51-59`). So there is no crypto reference price.
- **Pyth.** Removed in commit `e146c81` ("Robinhood reference prices"). Only mentioned in docs (`docs/future-improvements.md:22`, `docs/delta-vault.md:306`). A UI test asserts the word never renders (`apps/web/test/spot-prices.test.ts:194`).
- **Solana build.** Jupiter Price V3, off-chain and display-only (`probabl-sol/apps/api/src/integrations/jupiter/prices.ts:13`). No Pyth, Chainlink or Switchboard.

**What exists on Robinhood Chain mainnet** (on-chain reads 2026-10-20; feed list from Chainlink's directory, https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json, 58 feeds):
- **Feeds.** All are Data Feeds (push), 8 decimals, 86,400 s heartbeat, 0.5% deviation.
  - BTC/USD `0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251`: "BTC / USD", $81,901.09 at updatedAt 1792466003.
  - ETH/USD `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9`, CBBTC/USD, WBTC/USD and USDG/USD.
  - 35 "Robinhood <TICKER>/USD" stock feeds, e.g. RHNVDA/USD `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`.
  - **No SOL/USD feed, and no sequencer-uptime feed** is listed.
- **Update behaviour.** Crypto feeds update through weekends. The NVDA feed had no round from Friday 2026-10-16 18:21 UTC to Monday 00:00 UTC, a 53.6 h gap.
- **Data Streams.** VerifierProxy `0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7` answers `typeAndVersion()` = "VerifierProxy 2.0.0" (https://docs.robinhood.com/chain/data-streams/).

**What this means for price-resolved markets.**
- A 0.5%-deviation feed can be 0.5% stale at the observation instant. That is about one hour of BTC volatility (σ√1h ≈ 0.53%).
- So Data Feeds cannot fairly resolve "BTC up this hour". Polymarket itself uses Binance candles, Pyth, WSJ or Chainlink Data Streams for these (§2.5).
- A fair on-chain resolver on 4663 needs Data Streams reports (bid/ask/mid at a timestamp) verified through the VerifierProxy. For stocks the Data Streams 24/5 equity product would be needed. Weekend stock prices exist only on DEXs, not in the feeds.

**Where an oracle resolution path would fit.** The exchange does not need to change for either option.

1. **A resolver contract holding the roles.**
   - The admin points `marketAdmin` and `resolutionAdmin` at an `OracleResolver` contract (`configure`, `ConditionalStocksAdmin.sol:81-91`, effective immediately).
   - At creation the resolver records each market's spec: feed, observation time T, comparison and strike. It can derive `condition` = keccak(spec), so the event key commits to it (`:170`).
   - After T, anyone calls `resolver.settle(id)`. It selects the Chainlink round that brackets T (or verifies a Data Streams report for T), checks freshness, computes YES/NO, and in one transaction calls:
     - `lifecycle(id, 2)` (anyone may),
     - `lifecycle(id, 3, hash)` (as market admin),
     - `resolve` (as resolution admin).
   - The contract must pass through the market admin's other powers (creation, freezing, rebates) to a multisig, and keep a manual INVALID path for feed failures.
2. **An extension module** with a new selector, for example `resolveByOracle`. It activates after the 14-day exit window (`ConditionalStocksAdmin.sol:399-425`, `ConditionalStocksBase.sol:25`). It runs by delegatecall on the exchange's storage, so a bug can touch everything.

**What it would compromise.**
- **Trust moves to the feed's value at one instant.** That is exactly the manipulation the docs cite (`docs/future-improvements.md:10`).
- **No equity feed can give a close or "up today".**
  - Data Feeds update on deviation or heartbeat (`docs/delta-vault.md:313`).
  - Chainlink's 24/5 equity Data Streams are on Robinhood Chain (`reports/Conditional market liquidity bootstrapping.md:72`, citing Genfinity and the Chainlink docs). They are pull-based: a signed report has to be submitted and verified on chain, and this repo does not integrate them.
- **Feed outage or halt.** Needs an INVALID or fallback rule.
- **The informational product disappears.** A price-defined event makes the market an option on the asset (§7). The docs' central claim is that Probabl's spread Δ is the one number "options can't reveal … because they only pay on price levels, never on a non-price event" (`docs/future-improvements.md:24-25`).

---

## 6. Assets on chain

### Robinhood Chain mainnet (4663)

All reads went to `https://rpc.mainnet.chain.robinhood.com`, which returns `eth_chainId` 4663, on 2026-10-20 around 07:00 UTC, using `cast call <token> "totalSupply()(uint256)"` and `balanceOf(pool)`. Supplies for WETH, cbBTC and USDG and the BTC/USD feed were re-read for this note. Other rows are from the on-chain research pass; its raw output is in `constraints/chain/`. The explorer API (Blockscout) is behind a Cloudflare challenge, so holder counts are GeckoTerminal's.

| Asset | Address | Supply | Liquidity | Notes |
|---|---|---|---|---|
| ETH (gas) | native | – | – | https://docs.robinhood.com/chain/gas-and-fees/ |
| WETH (aeWETH, canonical bridge) | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | 38,974.28 | Uniswap v3 WETH/USDG 0.01% `0x52e65B17…71Ca`: 6,253.6 WETH + 4.07M USDG, about $19.1M, about $201M 24 h volume (DexScreener). Sushi v3 0.05% `0x9B050cb1…3c3c`: about $3.2M | `l1Address()` is L1 WETH. Listed on https://docs.robinhood.com/chain/contracts/ |
| USDG (Paxos) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 699,831,489.96 | Quote side of all major pools | Matches `scripts/evm/deploy.ts:45` |
| cbBTC (CCIP BurnMint token) | `0xcec185eb182c47d1ba1efc84e6959e18cd620be4` | **22.0677 BTC** (≈$1.8M) | Uniswap v3 cbBTC/WETH 0.3% about $1.15M; cbBTC/USDG 0.05% about $169k; cbBTC/WETH 0.05% about $147k (reserves read on chain). GeckoTerminal total about $1.15M | The only minter is a CCIP `BurnMintTokenPool 1.6.1`; the admin is a 3 h timelock. That Coinbase controls it is **unverified** |
| WBTC (canonical bridge) | `0x6bac06600D220Ac5Ac281AD1f504D2Cf0F90F6e6` | 0.0072 | none | No LayerZero WBTC OFT found |
| tBTC | none | – | – | – |
| SOL | **none** | – | – | Every "SOL" pool on GeckoTerminal is spam with zero volume |
| USDC | Only the canonical-bridge `0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8` (340.54 supply) | – | – | No native USDC or CCTP; matches `docs/cross-chain-order-support.md:53` |
| USDe (LayerZero OFT) | `0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34` | 365,981,598 | USDe/USDG v4 about $1.0M (aggregator) | – |

- **DeFi activity** (DefiLlama, aggregator, unverified): chain TVL about $1.14B; DEX TVL led by Uniswap v4 ($192M) and v3 ($102M); Morpho Blue $608M.
- **Spam.** There are many fake "WBTC", "USDC" and "SOL" tokens with fake reserves. Use only the addresses above.
- **Stock tokens trade around the clock.** The Robinhood docs say minting and burning run Monday 02:00 to Saturday 02:00 CET, but tokens "may still [be bought and sold] on-chain outside the tokenization window" (https://docs.robinhood.com/chain/stock-tokens/). NVDA/USDG on Uniswap v3 did $1.42M on Saturday and $13.5M on Sunday, 17–18 October. Chainlink stock feeds pause over the same weekend (§5), so short stock markets need a weekend rule. The keeper already stops when its Robinhood reference goes stale (`docs/delta-vault.md:313-315`).

**What this allows on EVM:**
- **"ETH if E" is feasible.** Deep WETH/USDG liquidity, a 24/7 ETH/USD feed for the vault's band, and physical delivery of WETH.
- **"BTC if E" is feasible only in tiny size.** cbBTC's whole supply is 22 BTC, and DEX depth is about $1.15M. A Δ-vault seeded with $100k of BTC (the depth the liquidity research recommends, `reports/Conditional market liquidity bootstrapping.md:121`) would hold about 6% of all cbBTC on the chain.
- **"SOL if E" is not possible.**
- **In every case the catalog needs crypto underlyings first** (below).

**Repo support for crypto bases.**
- The token catalog lists ETH, WETH, BTC and cbBTC as kind `crypto` with **no `underlying`** (`packages/shared/src/token-catalog.ts:58-83`). Stocks get `US:<TICKER>` (`:22-28`).
- Listing a pool requires a non-zero underlying (`ConditionalStocksAdmin.sol:127`). The tooling refuses tokens without one: "The base token is not in the asset catalog; its underlying is unknown" (`packages/evm-client/src/admin.ts:106-109`), and `create-markets.ts:139-141` refuses as well.
- **Crypto-based markets cannot be created on EVM today without a catalog change** (for example `CRYPTO:BTC`). That change is immutable once a pool is listed (`token-catalog.ts:4-6`).
- The quote token is pinned to USDG on Robinhood Chain mainnet, `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (`scripts/evm/deploy.ts:42-47`).
- The Robinhood price source gives crypto no reference (§5).
- The vault's Chainlink check would work for WETH and cbBTC (ETH/USD and CBBTC/USD feeds exist). With no sequencer feed listed, `sequencerFeed` would be zero (`contracts/src/vault/DeltaVaultBase.sol:69`).

### Solana

- **Supplies:** Solana RPC `getTokenSupply`.
- **Liquidity:** GeckoTerminal pool reserves (aggregator).
- **Mints:** CoinGecko's platform map.

| Asset | Mint | Supply | Pool reserves |
|---|---|---|---|
| SOL / wSOL | `So11111111111111111111111111111111111111112` | native | Deep |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 7.90B | about $335M |
| cbBTC | `cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij` | 2,908.56 | about $11.8M (24 h volume about $32M) |
| WBTC (Wormhole) | `3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh` | 2,467.87 | about $4.3M |
| zBTC (Zeus) | `zBTCug3er3tLyffELcvDNrKkCymbPWysGcWihESYfLg` | 48.42 | about $0.2M |
| WETH (Wormhole Portal) | `7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs` | 45,707.99 | about $6.4M |

**Solana build.**
- Devnet seeds mock BTC (8 decimals) and ETH (9 decimals) and native wrapped SOL as single-leg base assets, each with its own markets (`probabl-sol/scripts/solana/devnet-policy.ts:21-23,66-74`). The devnet seed run created 24 markets including BTC, ETH and SOL.
- Mainnet reference mints are cbBTC, Portal ETH and wSOL (`probabl-sol/packages/shared/src/spot-prices.ts:31-36`), with Jupiter display prices.
- **Crypto-linked conditional markets are already wired on Solana, and the assets there are about 100× deeper in BTC than on Robinhood Chain. On EVM they are not wired.**

---

## 7. A conditional market on a short event

**Notation.**
- A market on asset S and event E has two books. "S-if-YES" trades against "$-if-YES" at price Y, and the NO branch at price N.
- Buying with whole dollars returns the opposite branch's claim of what was paid (`README.md:36-39`). So a whole-funded buy of S-if-YES at Y pays: one S if E happens, and a refund of Y if it does not.
- Fair prices are Y = E[S_T | E] and N = E[S_T | not E]. The vault writes them as Y = s(1 + (1−p)δ) and N = s(1 − pδ), with δ = (Y − N)/s (`README.md:118-120`, `docs/future-improvements.md:29`).

### 7.1 Event about the asset itself: "BTC if BTC up this hour"

- **Inputs.** Spot s = $100,000 to keep the numbers round; Chainlink BTC/USD read $81,901 on 2026-10-20, and every dollar figure scales linearly. 50% annual volatility, so σ√t over one hour = 0.5/√8760 = 0.534%; zero drift.
- **Fair prices.**
  - Y = E[S_T | S_T > s] = s·N(d₁)/N(d₂) = **$100,427**.
  - N = E[S_T | S_T < s] = **$99,575**.
  - p = N(d₂) = 0.4989.
  - δ = 0.85%.
  - Check: p·Y + (1−p)·N = $100,000.
- **Payoff.** A whole-funded buyer of 1 BTC-if-up at $100,427 locks $100,427 and receives:
  - **Up:** 1 BTC, so P&L = S_T − 100,427. That is −$427 if BTC closes barely up, and positive above $100,427.
  - **Down:** $100,427 back, so P&L = 0.
- **What it is.** The payoff is 1{S_T > s}·(S_T − Y) = (S_T − s)⁺ − (Y − s)·1{S_T > s}. That is a one-hour call struck at the open, minus $427 of a digital. Both legs are worth about $213, so the fair value is zero.
- **Capital efficiency.**
  - The P&L's standard deviation is about $228, roughly 0.23% of the $100k locked.
  - The same risk on Polymarket's "Up" costs about $228: 456 shares at $0.50.
  - So Probabl's version ties up **about 440× more capital** for the same exposure, before fees.
- **Information.** Y and N are fixed by spot, volatility and time left. δ is just 2·σ√t·φ(0)/Φ(0) ≈ 1.6σ√t. The book reveals implied volatility, which options already price. This is exactly the price-level information the docs say Probabl is *not* about (`docs/future-improvements.md:24-25`).
- **Liquidity.** The Δ-vault's δ̂ is a slowly learned constant (`services/vault-keeper/src/model.ts:55-66`). Here the true δ moves mechanically:
  - After 30 minutes with BTC up 0.5%: p = 0.906, true δ = 0.74%. The vault's NO quote with δ̂ = 0.854% is about 10 bps off.
  - With 5 minutes left and BTC up 0.3%: p = 0.974. The NO quote is off by about **49 bps**, more than the 40 bps default half-spread (`services/vault-keeper/src/config.ts:238`).
  - The vault would be picked off near every expiry. Only the global 3× widening and the p ≤ 98% cutoff stop it (`packages/operator/src/reference.ts:140-141`).
- **Verdict.** Not broken, but degenerate:
  - a capital-heavy way to buy a short-dated gap option;
  - with nothing a trader can learn that they couldn't get elsewhere;
  - hard to make markets in safely;
  - and it needs a price oracle to resolve (§5).
  - The same holds for "NVDA if NVDA up today" and "SPY closes above $X".
- **Cross-asset price events are better.** For example "COIN if BTC up today": the event is not the base's own price, and Y − N reflects COIN's conditional beta. They still need an oracle and are niche.

### 7.2 An event that moves the asset but is not defined by its price

**Example: "NVDA if NVDA beats EPS consensus."** The release is after the close; the market resolves that evening or the next morning.

- **Inputs** (illustrative; the RHNVDA/USD feed read $217.07 on 2026-10-20). s = $180, p = 0.70. The market expects $189 on a beat and $159 on a miss.
- **Fair prices.** Y = $189, N = $159, δ = 30/180 = 16.7%. Check: 0.7·189 + 0.3·159 = 180. In the vault's form, 180·(1 + 0.3·0.167) = 189 and 180·(1 − 0.7·0.167) = 159.
- **Trader A thinks a beat would send NVDA above $189.**
  - Buys 100 NVDA-if-beat at $189, locking $18,900.
  - Beat, NVDA at $196: redeems 100 NVDA, +$700 (+3.7%).
  - Beat, NVDA at $185 (sold off on guidance): −$400.
  - Miss: the $18,900 is refunded, P&L 0.
  - Holding 100 NVDA instead: +$1,600 on the beat at $196, but −$2,100 on a miss at $159. The conditional trade removes the scenario A has no view on.
- **Trader B wants to buy the dip only if they miss.** Bids for NVDA-if-miss at $159. If NVDA beats, B is refunded.
- **The market's output.** Y − N = $30, the market's price of the earnings reaction conditional on the outcome. Options give a distribution of moves, not the move *given a beat*. This is the "one number only this market produces" (`docs/future-improvements.md:21-29`).

**Second example: SPY if CPI YoY ≤ 3.0%.** s = $600, p = 0.40, δ = 2%:
- Y = 600·(1 + 0.6·0.02) = **$607.20**;
- N = 600·(1 − 0.4·0.02) = **$595.20**.
- The release is at 08:30 ET. So the cutoff must be before 08:30, and redemption follows the print. For SPY, the pre-market move.

**Short events that make good conditional markets.** They are scheduled, resolve objectively within hours, and move a listed stock:
- **Earnings beat/miss on EPS or revenue against consensus.** Polymarket lists many daily, and they pass the normalizer (§1.2).
- **US macro prints against thresholds** (CPI, core CPI, payrolls, jobless claims, GDP) on SPY/QQQ, and FOMC decisions on SPY/QQQ/COIN/HOOD. These are negRisk ladders on Polymarket today, so they need negRisk support or a native market.
- **Company events:** Tesla deliveries above X, Apple event announcements, index inclusion, FDA decisions on a listed biotech, court rulings.
- **Avoid:**
  - events an insider or the counterparty controls ("TSLA if Elon tweets X");
  - events with no link to a tradable asset (weather, most sports);
  - events defined by the base's own price (§7.1).

---

## 8. What would need to change

Effort is in engineer-weeks for someone who knows the codebase. Audit time is extra.

### (a) Automated daily markets

Examples: earnings beats, daily strike ladders, and later macro prints.

**Contract.** No change is required.
- Recommended: a small `MarketFactory` contract holding `marketAdmin`. It exposes templated `createMarket` and open to a bot key (whitelisted bases, fee and cap ranges, cutoff bounds) and passes everything else to a multisig.
- Keep `resolutionAdmin` on a separate cold key or multisig.
- Effort: 1–2 weeks plus audit.

**Services.**
- **Scheduler:**
  - discover Gamma events by series or tag;
  - build creation evidence from a template;
  - auto-approve per policy;
  - sign create and open;
  - call the vault curator's `addMarket`;
  - call ingestor `track`.
- **Fix the creation path:**
  - remove the "ends within a day" guard (`create-markets.ts:203`);
  - set cutoff from the event time (`eventStartTime`, or an explicit release time) instead of `endDate`;
  - set per-template limits instead of the hard-coded `LIMITS`.
- **Lifecycle bot.** Freeze at cutoff (anyone may), release expired orders (anyone may), keeper `settle`, and a scripted `claimFees`.
- **Resolution assistant.**
  - Pre-fill the packet from the resolved Gamma snapshot and the Polygon CTF `payoutNumerators`, block and transaction.
  - Check that the payout equals Polygon's vector.
  - Leave one human approval on the resolution-admin side.
- **Ingestor:**
  - untrack closed or resolved conditions;
  - subscribe incrementally instead of reconnecting everything;
  - poll REST only for live subscriptions.
- **Indexer and API:**
  - default `/markets` to live plus recently resolved, with pagination and a "closing soon" sort;
  - keep archived markets out of per-block projections, SSE readiness and the 10-minute reconcile;
  - raise or remove the 200-packet evidence limit and the 1,024-condition cache cap;
  - batch Polymarket metadata.
- **Market maker.** Dynamic market selection from the API instead of the static list of 50 (`services/market-maker/src/config.ts:60-61`), and a buffer scaled to market length.
- Effort: 3–5 weeks.

**UI.**
- Countdown with `timeUntil`, plus times on list rows.
- "Closing soon" and "Resolving" views; hide past-cutoff markets from Active.
- Batch "redeem all" and "release expired orders".
- Paginated resolved history.
- Effort: about 1–2 weeks.

**Risks.**
- **Mis-mapped events:** wrong YES orientation, or a cutoff after the news. NFLX is the example (§1.2).
- **A hot market-admin key,** mitigated by the factory.
- **Polymarket API or format changes.**
- **Unbounded off-chain growth** if the pruning work is skipped.

### (b) Hourly markets

Everything in (a), plus the following.

**The supply problem.**
- On Polymarket, almost every hourly market is a price "Up or Down" on crypto. Daily stock "Up or Down" markets also exist.
- So hourly markets mean:
  - accepting `Up`/`Down` labels (map Up to YES in `metadata.ts:99-117` and in evidence orientation checks);
  - listing crypto bases: catalog underlyings such as `CRYPTO:BTC` (`token-catalog.ts`), and on-chain assets with liquidity (§6);
  - building the degenerate self-referential structure of §7.1.
- Non-price hourly events with a stock link barely exist. The realistic alternative is Probabl-native "intraday windows" around scheduled releases. One example: SPY-if-CPI ≤ x, created the evening before, cutting off at 08:29 ET and resolving by about 09:00. These are daily-cadence events with hour-scale lives.

**Resolution must be automatic.**
- A human cannot turn around 24 markets a day per stock.
- Polymarket's hourly BTC markets resolve a median 11 min after the hour (600 s UMA liveness), and Kalshi's in about 2 min (§2.5). A relay can therefore free capital before the next market ends, provided no dispute.
- A disputed question takes 2–6 days, so the relay needs a "freeze and wait" policy. The exchange has no timeout.
- Choose between:
  - a relayed Polymarket or Kalshi result: trust their resolver plus Probabl's relayer key, and get a written data licence (§2.5);
  - Probabl's own oracle resolver, which is (c).

**Vaults and keeper.**
- 8 market slots per vault means at most 8 concurrent hourly markets per stock (`DeltaVaultBase.sol:37`), with a `settle` every hour.
- `wideningSeconds` (86,400) and buffers must scale to market length.
- δ̂ needs an option-style model for price-defined events (§7.1).
- RFQ-only vault quoting may be safer.

**Ingestor, indexer and UI.**
- About 8,760 conditions per series per year makes pruning mandatory.
- The UI needs a "series" card that rolls to the current interval.

**Assets.** On Robinhood Chain only ETH has the liquidity for "crypto if E" in size. BTC is capped by cbBTC's 22-BTC supply, and SOL is absent (§6). The Solana build has all three.

**Effort.** About 4–6 weeks on top of (a).

**Risks.**
- Capital efficiency (§7.1) makes the product weak against Polymarket.
- Automated resolution keys become critical.
- Arbitrage against vault quotes near expiry.
- Polymarket rate limits: `/book` 1,500 per 10 s per IP.
- Data-licence terms.

### (c) Price-resolved markets

Probabl-native, for example "BTC above $X at 15:00" or "NVDA up today".

**Contract.**
- An `OracleResolver` that holds both roles through `configure`, or an extension (14-day delay).
- Commits each market's resolution spec at creation and settles permissionlessly after T, with Chainlink round bracketing and freshness checks. No sequencer-uptime feed is listed for 4663 (§5).
- An INVALID or manual fallback on stale or missing data.
- Chainlink Data Streams report verification through the VerifierProxy already on 4663 (`0xcE73c8ad…36E7`). For crypto too: the push feeds' 0.5% deviation threshold is about one hour of BTC volatility, and stock feeds also pause at weekends (§5). Alternatively an off-chain signer (Robinhood's close, Binance candles as Polymarket uses), which is a trusted relayer again.
- Effort: 3–5 weeks plus an audit.

**Services.**
- A "native market" path that does not assume Polymarket:
  - creation evidence without a Gamma snapshot (`admin/routes.ts:181`);
  - condition = spec hash;
  - a metadata and probability source: own book, options-implied, or Kalshi or Polymarket as display only;
  - indexer and web handling of markets with no `/polymarket` data (`markets-api-service.ts:216-231`).
- Crypto reference prices; Robinhood's API has none (`robinhood.ts:5-6`).
- Effort: 2–4 weeks.

**UI.** Show the resolution source, strike and observation time, and a live reference against the strike. About 1 week.

**Risks.**
- It breaks the in-kind, oracle-free principle (`docs/future-improvements.md:10`).
- Settlement-instant manipulation.
- Oracle outages.
- Immediate role reassignment through `configure` is a governance surface.
- It creates the degenerate payoff of §7.1 when the event is about the base's own price.
- Regulatory character moves toward short-dated options.

---

## Sources and raw data

**Code.** All `file:line` citations are at commit `07fc63d`. Facts quoted from subagent reads of the indexer, web and Solana repos were spot-checked: `projection.ts:80-104`, `routes.ts:141-164`, `queries.ts:754-757`, `display.ts:53-61`, `reconcile.ts:95-132`, `service.ts:68-71,184-193`, `ledger.ts:803-805`, `read-cache.ts:25-29`, `probabl-sol` `spot-prices.ts:31-36`, `devnet-policy.ts:21-23`, `crates/protocol-core/src/lib.rs:125-137`, `governance.rs:158-163,336-474`, `SECURITY.md:44`.

**Live reads (2026-10-20)**, raw responses under `/Volumes/T9/tmp-probabl/market-research/constraints/`:
- **Robinhood Chain.**
  - Mainnet `https://rpc.mainnet.chain.robinhood.com`: gas price; supplies of WETH, cbBTC and USDG; BTC/USD and RHNVDA/USD feeds; the pool balances in `chain/`.
  - Testnet `https://rpc.testnet.chain.robinhood.com`: creation and open receipts, MarketState logs.
- **Polygon.** `https://polygon-bor-rpc.publicnode.com`, CTF `payoutDenominator` and `payoutNumerators`.
- **Polymarket Gamma.** `/events`, `/series` and `/markets` (`raw/`, `pm-kalshi/pm_*.json`).
- **Kalshi.** `api.elections.kalshi.com/trade-api/v2` (`pm-kalshi/k_*.json`).
- **Gas measurement.** Scratch Foundry copy at `constraints/forge/proj/test/GasLifecycle.t.sol`. The repo was not modified.

**Web.**
- Robinhood Chain docs: https://docs.robinhood.com/chain/contracts/, /gas-and-fees/, /stock-tokens/, /oracles-and-price-feeds/, /data-streams/
- Chainlink feed directory for Robinhood mainnet: https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json
- DefiLlama (https://api.llama.fi/v2/chains, /protocols); GeckoTerminal and DexScreener (network `robinhood`); CoinGecko platform map.
- Polymarket:
  - resolution: https://docs.polymarket.com/concepts/resolution.md
  - rate limits: https://docs.polymarket.com/quickstart/introduction/rate-limits
  - real-time data: https://docs.polymarket.com/market-data/realtime-data.md
  - market discovery: https://docs.polymarket.com/market-data/discover-markets.md
  - contracts: https://docs.polymarket.com/resources/contracts
  - Terms of Use: https://polymarket.com/tos, which links the document https://docs.google.com/document/d/1N4aYlRcqaWCeKMID7vUSWJ1UPMvw_v6SP4cOFN8ZxR4/preview
  - UMA CTF adapter source: https://github.com/Polymarket/uma-ctf-adapter
- UMA:
  - oracle mechanics: https://docs.uma.xyz/protocol-overview/how-does-umas-oracle-work
  - network addresses: https://docs.uma.xyz/resources/network-addresses
  - managed proposers: https://docs.uma.xyz/using-uma/default-proposer-whitelist
  - news: https://www.theblock.co/post/366507/polymarket-uma-oracle-update
- Kalshi:
  - market data: https://docs.kalshi.com/getting_started/quick_start_market_data.md
  - rate limits: https://docs.kalshi.com/getting_started/rate_limits.md
  - websockets: https://docs.kalshi.com/websockets/websocket-connection.md
  - markets endpoint: https://docs.kalshi.com/api-reference/market/get-markets.md
  - crypto contract terms: https://assets.kalshi.com/contract_terms/CRYPTO.pdf
  - Member Agreement: https://kalshi-public-docs.s3.amazonaws.com/kalshi-member-agreement.pdf
- Polygon PoS state transfer: https://docs.polygon.technology/pos/how-to/bridging/l1-l2-communication/state-transfer.md

**Not verified:**
- that Coinbase controls the 4663 cbBTC admin;
- the CCIP remote chain of cbBTC;
- that the Uniswap v3 factory on 4663 is the official one;
- whether a SOL/USD Data Stream is available on 4663;
- the Kalshi Developer Agreement's redistribution terms;
- the verified name of Polymarket's 15m reporter contract `0x58e1745b…`.
