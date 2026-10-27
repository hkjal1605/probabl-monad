# Probabl ("Conditional Stocks"): how trading and liquidity work in the codebase today, and the constraints on a new liquidity mechanism

Scope: a read-only study of `/Volumes/T9/probabl` (branch `evm-solana-parity`, HEAD `a9c5bfb`, 2026-10-11). Citations are `path:line` in that repo unless noted. Four non-repo sources are flagged where used: (a) one scratch-copy Foundry gas run I did (`forge test --match-contract 'GasTest|VaultGas' --isolate --gas-report` on a copy of `contracts/` in the session scratchpad; the repo was not touched); (b) bytecode sizes I computed from the existing build artifacts in `contracts/out` (built Oct 5 17:33); (c) the user's memory notes in `/Users/hkj/.claude/projects/-Volumes-T9-probabl/memory/`; (d) facts outside the repo, which are marked as such.

---

## Q1. What is a market, what trades on each branch book, and what does each claim pay? (worked buy and sell examples)

### Takeaway
A market is one Polymarket binary condition × one stock token × the chain's one quote token (USDC on Base, USDG on Robinhood Chain). It runs two separate order books. The YES book trades "stock-if-YES" claims for "quote-if-YES" claims, and the NO book does the same in the NO world. Resolution pays YES (1,0), NO (0,1) or INVALID (½,½) in the underlying tokens. Buying a branch with plain USDG is therefore a conditional swap: it executes in that branch's world and is fully refunded in the other.

### Cited Findings
- Product definition: "a fully collateralized, event-conditional stock-token exchange for EVM chains (Base and Robinhood Chain; one stock-token issuer per chain). Every market pairs one stock token with the deployment's quote token and one Polymarket condition: traders buy or sell the stock *if YES* or *if NO*, and resolution pays each branch's claims exactly (YES 1/0, NO 0/1, INVALID ½/½)." — `README.md:3-6`
- The contract's own description: "A market pairs the deployment quote token with one base (stock) token and runs one order book per branch: 'stock if YES' against 'quote if YES', and the same for NO." — `contracts/src/ConditionalStocks.sol:8-13`
- Each `(market, branch, owner)` account holds a quote claim, a base claim and the notional of its resting orders (`Account {uint96 quote; uint96 base; uint64 notional}`), keyed `market << 1 | branch` — `contracts/src/ConditionalStocksBase.sol:210-216`, `:341-344`. Plain token credit is a separate protocol-wide `_credit[owner][token]` — `ConditionalStocksBase.sol:337`.
- Six assets per market: underlying 3c, YES claim 3c+1, NO claim 3c+2 for collateral c (0 = quote, 1 = base) — `packages/evm-client/src/protocol.ts:74-84`.
- Market terms (`MarketParams`): base token, Polymarket `condition`, `yesIndex`/`noIndex` (must be {1,2} or {2,1}), rules and metadata hashes, `open`, `cutoff`, `tick`, `step`, `maxSteps`, `minNotional`, `maxOrder`, `maxWallet`, `maxMarket`, `makerBps`, `takerBps`. All are immutable once created — `ConditionalStocksBase.sol:136-157`, `contracts/src/ConditionalStocksAdmin.sol:77-112`.
- Prices are "raw quote units per raw base unit x 1e18 (a multiple of the market tick); quantities are raw base units (a multiple of the market step)" — `ConditionalStocks.sol:16-19`. Testnet terms: "0.001-share steps, $0.01 ticks, $1 to $10,000 orders, 1,000 shares per order, $100,000 open per wallet and $1,000,000 per market" — `scripts/evm/create-markets.ts:69-80`.
- Lifecycle: SCHEDULED(1) → OPEN(2) → FROZEN(3) → AWAITING(4) → REDEEMABLE(6) → ARCHIVED(7) — `ConditionalStocksBase.sol:29-34`. The market admin opens. Anyone may freeze at cutoff, and the market admin or guardian may freeze early with a reason. The market admin then commits a resolution hash, and the resolution admin resolves exactly as committed — `ConditionalStocksAdmin.sol:143-227`. Trading requires state OPEN and `open ≤ now < cutoff`, and every order's expiry must be ≤ cutoff — `ConditionalStocks.sol:223-227`.
- Payouts: `_payoutDenominator` accepts (1,0) and (0,1) with denominator 1, and (1,1) with denominator 2 — `ConditionalStocksBase.sol:410-414`. `redeem` burns claims for `(yes·payoutYes + no·payoutNo)/denominator` and reverts `FractionalRedemption` on an odd INVALID numerator — `ConditionalStocks.sol:152-171`.
- Fill mechanics for a taker **buy** funded by plain credit: the taker receives `q − buyerFee` base claims on the branch. Its quote debit is `t.paid`. "Underlying-funded" takers also get `t.inactive += quoteAmount`, credited as **opposite-branch quote claims** — `ConditionalStocks.sol:426-442`, `:346-355`. For a taker **sell**: it receives `quoteAmount − sellerFee` quote claims on the branch and, when whole-funded, the opposite-branch base claim of `q` — `ConditionalStocks.sol:443-463`, `:353-355`.
- User-facing wording: "Buy YES stock with whole USDC and a fill gives you YES stock claims plus complementary NO cash claims. Sell with whole stock and you receive cash claims plus complementary stock claims. Funding with an existing active claim does not mint an extra complementary claim." — `apps/web/src/app/learn/page.tsx:34-37`
- Fees are charged on what each side receives: the buyer pays in base claims and the seller in quote claims — `ConditionalStocks.sol:428-429`, `:445-446`, `README.md:55-61`.

Worked example (my arithmetic from the code above, at an illustrative 25 bps taker / 5 bps maker fee; testnet markets actually have 0/0, see Q12):
- **Buy NVDA-if-YES with 1,000 USDG.** Deposit 1,000 USDG (credit). Take a resting YES ask at 200.00 for 5.000 shares, so `quoteAmount = 5 × 200 = 1,000`. Taker fee = 5 × 0.0025 = 0.0125 NVDA-YES. Holdings after: **4.9875 NVDA-YES claims + 1,000 USDG-NO claims, 0 plain credit**.
  - YES: NVDA-YES redeems to 4.9875 NVDA, USDG-NO pays 0.
  - NO: NVDA-YES pays 0, USDG-NO redeems to 1,000 USDG (full refund; the fee, paid in YES claims, cost nothing in this world).
  - INVALID: 2.49375 NVDA + 500 USDG.
  - A buy limit above the ask fills at the ask, and the difference stays in credit (debit = `t.paid`, `ConditionalStocks.sol:344`, improvement `:430-431`).
- **Sell NVDA-if-YES with 5 NVDA.** Deposit 5 NVDA. Hit a YES bid at 200 for 5 shares. Taker fee = 1,000 × 0.0025 = 2.5 USDG-YES. Holdings after: **997.5 USDG-YES + 5 NVDA-NO**.
  - YES → 997.5 USDG.
  - NO → 5 NVDA back.
  - INVALID → 498.75 USDG + 2.5 NVDA.
- **The resting maker** in the buy example (a whole-funded ask that escrowed 5 NVDA) receives 1,000 − 0.5 = 999.5 USDG-YES, plus 5 NVDA-NO (`ConditionalStocks.sol:432-436`), plus any maker rebate. The rebate is paid in NVDA-YES, the claim the taker's fee was charged in (`ConditionalStocks.sol:470-482`).

### Inferences
- A fill at YES price Y is economically "swap USDG→stock at Y only in the YES world; nothing happens in the NO world". It carries no outcome bet for either party beyond the conditional price. Probability enters only through how users value USDG-YES today. This is the basis of the doc identity s = pY + (1−p)N (`docs/delta-vault.md:23-25`).
- Protocol fee revenue accrues in branch claims, so half or more of it becomes worthless at resolution. Expected fee value is ≈ p·(YES-branch fees) + (1−p)·(NO-branch fees). The same holds for maker rebates and referral accruals ("winning side's claims become tokens", `README.md:87-88`).
- Because INVALID pays ½/½ in kind, any mechanism holding unpaired claims at resolution receives half of each side, never a cash settlement.

### Gaps
- No interest or carry is modelled anywhere. The doc lists "No interest carry until resolution, and no dividends" as a known simplification (`docs/delta-vault.md:302`). How issuer dividends and multipliers pass through claims (ERC-8056 `uiMultiplier`, `docs/cross-chain-order-support.md:77`) at resolution is not specified beyond multiplying reference prices by the live multiplier (`packages/operator/src/reference.ts:186-187`).

---

## Q2. How split/merge and the "opposite-branch claim" work, and what this means for an LP's capital efficiency when quoting both branches

### Takeaway
Split turns 1 plain token into 1 YES claim + 1 NO claim of the same market, and merge reverses it, both free and exact in any state. Whole-funded orders perform the split implicitly at fill time. Claim-funded orders spend existing branch claims. An LP who pre-splits can quote bid and ask on **both** branches with the capital of one two-sided spot quote, a 2× saving over whole-funded orders. That capital is still locked **per market and per resting order**: there is no cross-market netting and no margin.

### Cited Findings
- `split(id, collateral, amount)` debits credit, adds backing and credits equal YES and NO claims. `merge` does the reverse "in any state" — `ConditionalStocks.sol:127-150`. Neither checks market state.
- Backing invariant: "For each market and collateral: `backing = Σ YES claims = Σ NO claims`" (sums include fees and escrow, before resolution) — `docs/cross-chain-order-support.md:220-223`. The ledger summary: "A buy funded with *whole* tokens receives the opposite branch's claim of what it paid, so every claim stays backed 1:1." — `README.md:36-39`.
- In `_fill`, a whole-funded maker ask adds `t.baseBacking += q` and credits the maker the opposite-branch base claim. A whole-funded taker adds `quoteBacking`/`baseBacking` and accrues `inactive` for the opposite-branch claim — `ConditionalStocks.sol:433-442`, `:449-461`. Backing is written once per placement in `_settleTaker` — `ConditionalStocks.sol:376-380`.
- Escrow: a resting order debits its full reservation at placement. A bid reserves its notional and an ask its quantity, from plain credit (whole-funded) or from the branch's claim (claim-funded) — `ConditionalStocks.sol:341-375`. Cancelling returns it — `ConditionalStocks.sol:575-589`.
- The market maker funds each market once by splitting its seed into claims (`seedClaims` → `position(... "split" ...)`) and quotes **only claim-funded** orders (`fundingKind: 1`) — `services/market-maker/src/engine.ts:492-518`, `:105-124`.
- The Δ-vault funds quotes "from the branch's claims first (which also nets the vault's unpaired claims) and plain credit after". Plain credit is split half per branch: "Claims belong to one branch; plain credit is shared, half per branch" — `services/vault-keeper/src/model.ts:159-164`, `:207-209`, `:243-246`.
- Netting example in the design doc: Alice buys 100 NVDA⁺ at 103 and Bob buys 100 NVDA⁻ at 98. The vault ends holding only the imbalance, merges matched USDC⁺/USDC⁻, and "Opposite flows **net out automatically**" — `docs/delta-vault.md:51-70`. The keeper merges paired claims worth ≥ `mergeQuote` (default 100 quote) each round — `services/vault-keeper/src/engine.ts:356-373`, `services/vault-keeper/src/config.ts:219`.
- Claims are scoped per market (`_accounts[market<<1|branch]`, `ConditionalStocksBase.sol:343-344`). The "event universes" idea would change this: "key quote claims and resolution by event instead of by market" so USDC-if-E is shared across stocks — `docs/future-improvements.md:54-61`.

### Inferences
- Capital per four-sided quote of size q at price ≈ P: claim-funded needs q·P quote + q stock (one split of each). Whole-funded needs 2·q·P quote + 2·q stock, because each branch's order escrows separately.
- A YES bid that fills plus a NO bid that fills, both funded by one split, leaves the LP holding q whole-stock-equivalent bought at Y in the YES world and N in the NO world, i.e. bought at s today if s = pY + (1−p)N.
- An LP quoting k events on the same stock must lock capital in k separate markets. Plain credit can be shared across markets only if it is not escrowed at the moment, and every resting order escrows. The vault shares one inventory pool across ≤ 8 markets (`contracts/src/vault/DeltaVaultBase.sol:38`), but each live quote still locks its slice.
- A mechanism wanting real cross-market capital reuse would need either event-keyed collateral (an extension per `future-improvements.md:61`) or quoting that does not pre-escrow (e.g., an extension that settles against a pool balance at fill time).

### Gaps
- No code measures LP capital utilisation (escrowed vs idle) on testnet. Nothing in the repo quantifies how much of the vault's plain inventory is typically escrowed.

---

## Q3. How matching works on chain (resting orders, plans with up to 8 makers, greedy fill, crossed-book rejection, replace), the gas costs, and whether any curve exists

### Takeaway
Every order is placed by one transaction that carries an off-chain-built plan (`nextSeq`, deadline, `minFill`, ≤ 8 maker sequences). The contract fills the named makers greedily in the given order and lets the remainder rest unless the order is IOC. It checks only the latest 16 resting placements since the plan for a race that would cross the book. Nothing matches automatically: a fill happens only when a taker names a maker. No curve, AMM or pool counterparty exists. "Market" orders are IOC limit orders with a 1% worst-price bound.

### Cited Findings
- Order word: `market(32) | flags(8)<<32 | maxFeeBps(16)<<40 | expiry(40)<<56 | ticks(64)<<96 | quantity(96)<<160`; flags 1 NO, 2 sell, 4 claim-funded, 8 IOC. Plan word: `nextSeq(32) | deadline(40)<<32 | minFill(96)<<72`. Makers word: up to eight `seq+1` 32-bit entries — `ConditionalStocks.sol:175-191`. TS packers — `packages/evm-client/src/protocol.ts:216-276`.
- Keys: `market << 40 | branch << 32 | seq`. Only resting orders are stored, in one slot (`StoredOrder`) — `ConditionalStocksBase.sol:231-246`, `:347-348`. The sequence increments on every placement, including IOC — `ConditionalStocks.sol:242-248`.
- Checks in `_place`: global pause, market OPEN within [open, cutoff), `expiry ≤ cutoff`, `now < deadline ≤ expiry`, step multiple, `quantity ≤ step·maxSteps`, `minNotional ≤ notional ≤ maxOrder`, `nextSeq ≤ current seq` — `ConditionalStocks.sol:206-248`.
- Greedy fill: "Makers fill greedily in order, each capped by what remains." A maker that is closed, expired, invalidated, delegation-revoked or fee-capped below the maker rate is **skipped**. A maker that no longer crosses the taker's limit, or is on the same side, makes the transaction **revert** `StalePlan`, and a taker fee cap below the taker rate reverts `FeeCap` — `ConditionalStocks.sol:185-189`, `:266-272`, `:389-411`. Fills execute at the **maker's** price — `ConditionalStocks.sol:414-415`. `minFill` reverts `StalePlan` if under-filled — `ConditionalStocks.sol:272`.
- Crossed-book race check: a resting remainder "must not cross an opposite order placed since its plan". Only the RECENT = 16 resting placements up to the branch's latest are read back: "spam can delay a plan but never make it fail" — `ConditionalStocks.sol:508-530`, `ConditionalStocksBase.sol:19-22`. This was made best-effort in audit fix M-02 (commit `bcd3341` message). Orders older than `nextSeq` are not checked on chain. The planner is trusted to have included every crossing maker.
- Caps: resting bids count toward `Book.openNotional ≤ maxMarket` (asks excluded since audit M-01). A wallet's resting notional on both branches must stay ≤ `maxWallet` — `ConditionalStocks.sol:299-302`, `:369-374`, `ConditionalStocksBase.sol:174-186`.
- `replace(key, o, p, m)` cancels and places atomically. `cancelMany` skips closed entries. Anyone may release an order that can no longer fill — `ConditionalStocks.sol:532-551`.
- Gas (Foundry, incl. harness): "resting bid 124k, resting claim-funded ask 119k, market buy filling one maker 85k (partial 93k), four makers 139k, eight makers 203k, cancel 34k" — `README.md:118-119`; benchmarks in `contracts/test/Gas.t.sol:38-103`. The maker rebate adds "about 190 gas per filled maker" (commit `dddded6` message). My scratch gas-report run gave `place` min 70,847 / median 90,192 / max 166,654 execution gas over 154 calls, and `cancel` 39–49k (non-repo measurement (a)).
- No AMM: "v1 is built. The vault posts quotes into our order books. Order-book traders still compete on top, and no AMM contract is needed." — `docs/delta-vault.md:162`. UI market mode: "A market order is IOC with a signed, bounded worst price, never an unbounded order" (default `slippageBps = 100`) — `apps/web/src/lib/trading/entry.ts:33-56`; "Market mode is a price-bounded IOC with a 1% worst-price limit" — `apps/web/src/app/learn/page.tsx:50-52`.
- `liveOrder` in the indexer mirrors the contract's maker checks (state, cutoff, expiry, fee cap, epoch, delegation) — `services/indexer/src/projection.ts:225-252`.

### Inferences
- The marginal gas per extra maker is ≈ (203k − 85k)/7 ≈ 17k, so an 8-maker sweep costs about 2.4× a 1-maker fill. A discretised curve posted as many small resting orders makes large takers pay that per level and hits the 8-maker ceiling.
- Crossed resting orders can coexist on chain if an off-chain view was stale or the cross is older than `nextSeq`. They persist until someone takes them, because the chain never matches by itself.
- A taker cannot discover makers on chain cheaply: orders are keyed by sequence and the contract holds no price index. Takers depend on an off-chain replica, which is the API planner today.

### Gaps
- No gas figures are measured for Robinhood Chain or Base in fiat, and none for L1 data fees, though the executor accounts for an OP-stack `l1Fee` (`packages/operator/src/execution.ts:47-50`).

---

## Q4. How the API builds placement plans, what the trading endpoints and delegated trading do, the indexer/replica, and the latency principles

### Takeaway
The API plans every order from an in-memory replica of the exchange (no RPC, no DB), best price then FIFO, with a 60 s deadline. It then simulates the order with `eth_call` and returns calldata for the wallet. Alternatively, a delegated "one-click" key places the order via `placeFor` within on-chain budgets. The replica is event-sourced and fails closed on unknown events. "No added latency, no wasted calls" is an explicit design rule.

### Cited Findings
- Planner: "Plans an order against the confirmed replica (no RPC, no database)". It collects live opposite-side orders of the branch, runs `planOrder`, and checks wallet and market resting caps — `apps/server/src/trading/plan.ts:17-110`.
- `planOrder`: best price first, FIFO within a price. Skips makers below the maker fee or expired. Deadline is `min(now+60, taker expiry, makers' expiries)`. A GTC order crossing more than 8 makers throws "reduce quantity", while IOC truncates at 8. `minFill` is one step for IOC takers with makers — `packages/evm-client/src/planner.ts:43-146`. `parseAtomicPlan` re-validates an untrusted plan — `planner.ts:148-199`.
- Endpoints: `POST /v1/orders/prepare` (member session), `POST /v1/orders/transaction` (simulate then return calldata), `GET /v1/trading/permission`, `POST /v1/trading/submit` (delegated), and cancel/recovery prepare — `apps/server/src/trading/routes.ts:31-95`.
- Delegated trading: one approval grants a trading key per-order and lifetime quote **and** base (share) budgets, a fee cap, an expiry ≤ 90 days, and one market or all — `ConditionalStocksAdmin.sol:259-313`. Each `placeFor` spends the budget (a buy its notional at the limit, a sell its quantity) — `ConditionalStocks.sol:308-330`. API side: journaled raw transaction before broadcast, idempotent `clientId`, up to 4 replans on `StalePlan`, 500 delegated orders per owner per day — `apps/server/src/trading/delegated.ts:26-27`, `:115-178`.
- Index: "follows the exchange's logs into an in-memory replica (no database read on the trading path)". It polls each block header with a `logsBloom` skip, detects reorgs, and uses Multicall3 for reads — `README.md:98-107`. The replica decodes logs with the exchange ABI only. "an extension's own events are unknown here and stop the index" — `packages/evm-client/src/ledger.ts:192-201`, `:307-311`. Trades are replayed exactly and throw on divergence — `ledger.ts:544-573`.
- Bots run their own `ChainFollower` replica (market maker `services/market-maker/src/main.ts:57-71`; keeper uses `follower.poke()/reached()` — `services/vault-keeper/src/engine.ts:230-242`). Commit `e146c81` states "A steady round costs each vault a single eth_call (asserted in tests)".
- User's standing rule (non-repo memory (c), `latency-and-calls-first.md`): trading services "must add no latency and make no wasted RPC/API/DB calls; prove it with call-count tests". It also notes that transactions are calls too: the testnet keeper once re-quoted on 1–6 bps moves until `repriceBps` keeping was added (commit `3af7d54`).

### Inferences
- A new mechanism that needs per-trade quotes from an off-chain service fits the existing pattern (planner + simulate + calldata). A mechanism that needs extra RPC reads per order, or DB reads on the hot path, cuts against an explicit user requirement.
- Any new on-chain event (from an extension or a new contract the API must index) requires upgrading the replica first, or the index halts.

### Gaps
- No load or latency measurements for the planner path are in the repo.

---

## Q5. The Δ-vault's pricing model: Y and N formulas, where s, p and δ̂ come from, and the on-chain bounds

### Takeaway
The vault is a separate contract per stock that quotes passive resting orders on both branches of up to 8 markets. Prices follow Y = s(1+(1−p)δ̂), N = s(1−pδ̂). s comes from Robinhood's Stock Token API (off-chain) and p from the Polymarket CLOB midpoint (off-chain), both read by the keeper through the API. δ̂ is a stateless function of the vault's YES-minus-NO stock imbalance. On chain, the vault enforces only a band around a **Chainlink spot** price, TTL, cutoff buffer, fee cap, per-order and resting-notional caps, a no-self-cross rule and a worst-case imbalance cap. It never checks p or δ̂.

### Cited Findings
- Model: "the stock price s and the event probability p come from outside; the vault learns only the conditional gap δ̂ from its own fills… `Y = s·(1 + (1−p)·δ̂)   N = s·(1 − p·δ̂)`. δ̂ is stateless: the anchor moved against the vault's YES-minus-NO stock imbalance, measured as a share of its stock inventory, so deposits and withdrawals (which scale both) never move it." — `services/vault-keeper/src/model.ts:1-9`, `:72-81`.
- δ̂ (ppm of spot) = `anchorBps·100 − impactBps·imbalance·widen/inventory`, clamped to ±`maxGapBps` — `model.ts:55-70`. Config semantics: `anchorBps` δ₀ in bps of spot, `impactBps` "δ̂ falls this many bps per 1% of stock inventory the vault is long YES", `maxGapBps` ≤ 5,000 — `services/vault-keeper/src/config.ts:4-16`, `:85-98`. Inventory = plain base + average of the market's YES/NO base claims — `services/vault-keeper/src/engine.ts:116-120`. Imbalance = YES base − NO base (+ claim-funded ask escrow) — `contracts/src/vault/DeltaVaultBase.sol:376-402`.
- The doc's earlier form: Δ̂ = Δ₀ + (net NVDA⁺ bought − net NVDA⁻ bought)/κ — `docs/delta-vault.md:40-49`. The keeper refinement: "δ̂ moves by `impactBps` per 1% of the vault's stock inventory that it is long or short between the worlds" — `docs/delta-vault.md:235`. The doc sources s from "Robinhood (Stock Token API)", p from "Polymarket", and Δ from "only our market" — `docs/delta-vault.md:15-21`.
- Half-spread = max(floor, feeEdge + adverse-selection + 2×movement + Polymarket spread×|δ̂|) × widen — `model.ts:108-131`. feeEdge = (makerBps − takerBps·rebateBps/1e4)/(1 − makerBps), possibly negative — `packages/evm-client/src/protocol.ts:57-66`. Widening ramps 1→3× over the last 86,400 s before quoting stops — `model.ts:98-106`, `config.ts:217-218`.
- Ladders (four per market: YES bid/ask, NO bid/ask):
  - default 2 levels, 25 bps spacing;
  - budget per ladder `min(orderQuote, maxResting/4)`;
  - each quote must sit inside (band − 50 bps margin) of the oracle and must not cross the best **foreign** bid/ask;
  - imbalance room `(maxImbalance ∓ imbalance)/2` per raising/lowering ladder;
  - a resting quote is kept while it is within `repriceBps` (15) and ≥ ¾ of its level size.
  — `model.ts:159-278`, `config.ts:195-201`.
- Keeper sources: references come from `GET /v1/markets/:id/polymarket` and `GET /v1/spot-prices` on the API — `packages/operator/src/reference.ts:220-235`, `services/vault-keeper/src/tick.ts:18-45`. The Polymarket probability is the YES-book midpoint ×1e6, valid only when quality is "valid", spread ≤ 5pp, p within [2%, 98%] and both sides have depth ≥ the standard notional — `reference.ts:81-146`, `services/vault-keeper/src/config.ts:207-209`. The ingestor's standard notional defaults to $100 (`POLYMARKET_STANDARD_NOTIONAL_X6 = 100000000`) — `services/polymarket-ingestor/src/environment.ts:47`.
- On-chain checks per new order (`_validate`): market id, no IOC, `maxFeeBps ≤ limits.maxFeeBps`, `expiry ≤ now + maxTtl`, `expiry + cutoffBuffer ≤ cutoff`, `|price − oracle| ≤ oracle·bandBps`, notional ≤ `risk.maxOrder` — `contracts/src/vault/DeltaVaultAdmin.sol:251-268`. Orders are placed with **no makers** (`EXCHANGE.place(order, plan, 0)`) — `DeltaVaultAdmin.sol:38-46`.
- On-chain checks after each update: ≤ 48 tracked orders, no vault bid ≥ vault ask on a branch, resting notional ≤ `maxResting`, and worst-case imbalance within ±`maxImbalance` (or not growing if already beyond) — `DeltaVaultAdmin.sol:47-65`.
- Constants: `MAX_MARKETS 8`, `MAX_ORDERS 48`, `MAX_BAND_BPS 5000`, `MAX_CUTOFF_BUFFER 7 days`, `MAX_TTL 1 day`, `MAX_ORACLE_AGE 3 days`, `MAX_FEE_BPS 1000`, `MIN_WITHDRAW_LIMIT_BPS 1000`, `SEQUENCER_GRACE 1 hour` — `DeltaVaultBase.sol:38-50`.
- Oracle: Chainlink `latestRoundData` of "one whole base token in USD; the quote token is taken to be worth one USD". It reverts on staleness beyond `maxOracleAge`, on a non-positive answer, or on a down sequencer (Base pins its sequencer-uptime feed) — `DeltaVaultBase.sol:66-80`, `DeltaVaultAdmin.sol:270-287`, `scripts/evm/deploy-vault.ts:35-41`, `:79-83`.
- Keeper-only safety gates (off chain):
  - stale reference (30 s);
  - spot/probability observation skew > 15 s;
  - reference vs Chainlink deviation > 150 bps;
  - maker fee above the vault cap;
  - jump cooldown (300 bps spot or 8pp probability → 60 s);
  - consistency breaker (foreign-book implied p = (s − N)/(Y − N) more than 15pp from Polymarket);
  - issuer pause;
  - near cutoff;
  - vault paused;
  - vault-wide drawdown latch at 300 bps over a 24 h window, marked at identical current prices.
  — `services/vault-keeper/src/engine.ts:476-541`, `:426-466`, `model.ts:83-96`, `config.ts:202-216`.
- Trust boundary: "Within those bounds the keeper chooses prices. A compromised keeper key could trade against an accomplice at the edges of the band, up to the caps, until the guardian pauses." The service refuses a key that also holds admin or curator roles — `docs/delta-vault.md:219-222`, `services/vault-keeper/src/main.ts:126-131`.

### Inferences
- The band (testnet 15%) is centred on **spot**, not on the branch fair price. With δ̂ up to ±maxGapBps, Y and N deviate from s by up to (1−p)·δ̂ and p·δ̂. The band therefore limits how far the keeper may let δ̂ run, and it is the only on-chain constraint tied to any price.
- Nothing on chain ties quotes to p. A keeper-supplied p error moves both branch quotes by ≈ s·δ̂·dp (`model.ts:108-109`). Only the imbalance cap bounds the resulting loss.
- Since δ̂ is a function of current imbalance (not cumulative flow), merges, settlements and claim donations that change the imbalance also move δ̂. A trader who pushes imbalance toward the cap faces a linearly worsening price: an inventory-based, LMSR-like impact on top of the order book.

### Gaps
- The live testnet keeper's Δ-model (anchor, impact, maxGap, orderQuote) lives on the EC2 host, not in the repo. Only the example (`anchorBps 0, impactBps 10, maxGapBps 800, orderQuote 2000`, `services/vault-keeper/config.example.json`) and the local seed (`impactBps 25, maxGapBps 1000`, `scripts/evm/seed-markets.ts:296-303`) are visible.

---

## Q6. Δ-vault deposits and withdrawals, depositor risk/return, quote depth and refresh cadence, and behaviour outside stock-market hours

### Takeaway
Shares are exact pro-rata in-kind claims on everything the vault holds: plain credit, escrow and YES/NO claims. No price enters share accounting. Deposits buy a slice in kind and hand back the unneeded side of each split as exchange claims, while withdrawals pay tokens plus unpaired claims. The testnet vaults are tiny: 60–300 USDG per order, 480–2,400 USDG resting per market, and an imbalance cap of 2 shares. Quotes are refreshed on a 10 s loop with a 5 min TTL, and an `update` transaction is sent only when something changed. Outside US hours the Chainlink price may be up to 3 days old, but on mainnet the keeper stops quoting when its Robinhood reference stops updating.

### Cited Findings
- Share design: "A share is an exact pro-rata claim on everything the vault owns on the exchange… Deposits and withdrawals are in kind, so share accounting never uses a price, a probability or keeper input" — `contracts/src/vault/DeltaVault.sol:11-33`, `docs/delta-vault.md:175-194`.
- Deposit:
  - mints the largest whole number of shares whose in-kind cost fits both budgets, rounding up;
  - splits what each market needs and returns the unneeded side to the receiver as claims;
  - the first deposit is admin-only and locks 1,000 dead shares (≥ 1e9 initial);
  - deposits are capped by richest-branch quote/base holdings;
  - the guardian can pause deposits.
  — `DeltaVault.sol:67-100`, `:184-230`, `:375-390`, `DeltaVaultBase.sol:48-50`.
- Withdraw:
  - never paused;
  - pays `floor(holding·shares/supply)` of each holding, merging the paired YES/NO part into tokens and transferring the unpaired claims;
  - cancels only the orders whose escrow it needs;
  - if the token refuses transfer (issuer pause), pays in YES+NO claims instead;
  - admin may rate-limit net outflow to no less than 10% of supply per day (default 100%).
  — `DeltaVault.sol:102-137`, `:232-260`, `:274-359`, `DeltaVault.sol:45`, `DeltaVaultAdmin.sol:160-165`.
- Roles: Admin (roles, caps, withdraw limit, unpause), Curator (markets, risk, limits), Keeper (`update`, `merge`, `cancelAll`), Guardian (pause, which also calls `EXCHANGE.invalidateOrders()`). `settle` is permissionless after resolution — `docs/delta-vault.md:224-231`, `DeltaVaultAdmin.sol:24-100`, `:167-171`.
- Depositor return, as the design doc states it: the vault is event-neutral to first order. "LP P&L = fees + ordinary NVDA exposure + the Δ result", and the vault only loses to arbitrage when Δ moves. Δ-LVR per year ≈ ½·σ_Δ²·p(1−p)·κ, and the discovery cost is ½·p(1−p)·κ·(move)², e.g. $240 per $1 of Δ at κ = 2,000, p = 0.4 — `docs/delta-vault.md:72-107`, `:109-137`, `:139-152`. The doc stresses that "That number depends entirely on σ_Δ, which nobody has ever measured" and that the math "needs an independent review before real money goes in" — `docs/delta-vault.md:137`, `:303`.
- Testnet vaults (`deployments/46630-vault-plan.json`): five vaults (TSLA, AMZN, PLTR, NFLX, AMD).
  - Limits: `maxTtl 3600`, `maxOracleAge 259200` (3 days), `maxFeeBps 100`.
  - Every market: `bandBps 1500`, `cutoffBuffer 3600`, `maxImbalance "2"` (shares).
  - Per-market `maxOrder`/`maxResting`: TSLA 150/1,200 USDG; AMZN and PLTR 100/800; NFLX 60/480; AMD 300/2,400.
  - Capital, e.g. TSLA: seed 179 USDG + 0.5 TSLA, deposit 1,639 USDG + 4.5 TSLA. Caps 100,000 USDG / 1,000 shares.
  - The plan's `exchange` is `0x1879…49B5`, while the current exchange (redeployed Oct 5) is `0x32df…c3db` — `deployments/46630.json`. Vault `EXCHANGE` is immutable — `DeltaVaultBase.sol:172`, `:265`. The user's memory notes record "the vault migration pending" (non-repo (c)).
- Local demo vault: 200,000 USDC + 2,000 NVDA seed; caps 10M USDC / 100k NVDA; `maxTtl 600`, oracle age 3 days, fee cap 1% — `scripts/evm/bootstrap.ts:149-179`. Per market: `maxOrder 5,000`, `maxResting 40,000`, `maxImbalance 200 NVDA`, model `impactBps 25`, `maxGapBps 1000`, `orderQuote 2000` — `scripts/evm/seed-markets.ts:283-303`.
- Cadence: `pollMs 10_000`, `ttlSeconds 300`, `repriceBps 15`, `quoteLevels 2`, `receiptPollMs 200`, `reserveBps 2000` (20% of plain holdings kept unreserved for withdrawals) — `services/vault-keeper/src/config.ts:193-221`. A quote within 2 polls of expiry is not kept — `engine.ts:150-165`. The loop is scheduled every `pollMs` — `services/vault-keeper/src/main.ts:230-238`. One `update(market, cancels, places)` transaction per changed market, with 25% gas headroom — `engine.ts:572-612`, `main.ts:171-173`.
- Vault gas (my scratch run, non-repo (a), test-harness totals for `contracts/test/vault/VaultGas.t.sol:31-55`): quote four orders ≈ 472.7k, requote four ≈ 386.6k, deposit ≈ 217k test gas (gas-report `deposit` 266k–326k), withdraw 191k–242k (locked case ≈ 464k).
- Out-of-hours behaviour:
  - Equity feeds update "only on a 0.5% move or a 24-hour heartbeat, and not at all while markets are closed, so the vault's oracle age must exceed a day" — `docs/delta-vault.md:265`.
  - Reference prices must carry a publish timestamp within `maxFeedAgeMs` (30 s) unless `allowStaleSpot` on a testnet — `packages/operator/src/reference.ts:164-180`. The market maker config comment says: "Testnets only: quote from stale reference prices (e.g. outside US market hours)" — `services/market-maker/src/config.ts:36`.
  - Display staleness for equities is 24 h — `packages/shared/src/spot-prices.ts:7-9`.
  - The research notes flag "Oracle timing. Polymarket trades around the clock; equity feeds don't." — `docs/future-improvements.md:49`. "Out-of-hours exposure" is an open backtest question — `docs/delta-vault.md:288`.
- Near resolution: "κ shrinks and spreads widen as resolution approaches, and quoting stops during the resolution window" — `docs/delta-vault.md:152`. Implementation: widening and `cutoffBuffer` — `model.ts:98-106`, `DeltaVaultAdmin.sol:259`.

### Inferences
- With `maxImbalance = 2` shares, each raising or lowering ladder has room ≈ 1 share (`(cap ∓ imb)/2`, `model.ts:199-200`). Testnet vault depth per branch-side is therefore ≈ 1 share (a few hundred USDG), far thinner than the resting caps.
- `MAX_ORDERS 48` across ≤ 8 markets at 2 levels × 4 ladders = 8 orders per market caps a full vault at 6 fully laddered markets.
- In steady state each quoted market costs about one `update` per ~5 min (TTL refresh) plus one per >15 bps move. That is ~290 transactions/day/market at ~0.4M gas each, before price moves.
- Depositors end up holding exchange claims, not just tokens, whenever the vault holds unpaired claims. Any new pooled mechanism that copies the in-kind design inherits this UX (`docs/delta-vault.md:185-196`).
- On mainnet the vault likely sits out nights and weekends, when the Robinhood reference stops updating, while Polymarket keeps moving. This is the window where a mechanism that does not depend on a live s would add the most.

### Gaps
- Whether Robinhood's Stock Token API publishes fresh quotes 24/5 (overnight sessions) cannot be determined from the repo. The code only shows that a stale or halted quote stops quoting.
- No realised testnet vault P&L, fill counts or utilisation are recorded in the repo.

---

## Q7. The market-maker service: inputs, spread and size logic, inventory management and gas limits

### Takeaway
The legacy inventory market maker quotes claim-funded ladders on both branches. Its fair prices use the same identity, but with a **fixed per-market gap** (`gapBps`) from config and nothing learned. Inputs are Robinhood spot and the Polymarket midpoint via the API. Size is skewed by branch inventory against a target. Risk controls are a per-market drawdown latch, jump cooldowns and daily gas budgets. It sends one transaction per cancel or replace, serially.

### Cited Findings
- Fair prices: `Sy = S + (1−p)D; Sn = S − pD` with D = spot·gapBps, |gapBps| ≤ 7,500 — `services/market-maker/src/strategy.ts:33-50`. `gapBps` is a per-market config field — `services/market-maker/src/config.ts:17-33`. The local seed uses `gapBps: 200` — `scripts/evm/seed-markets.ts:319-329`.
- Spread: `half = max(halfSpreadBps, feeEdge + adverseSelectionBps + 2·movementBps + PolySpread·|gap|)`, and no quotes at all if half > `maxHalfSpreadBps` — `strategy.ts:94-103`. Defaults: `halfSpreadBps 60`, `adverseSelectionBps 25`, `maxHalfSpreadBps 1500`, `quoteLevels 1`, `levelSpacingBps 25`, `repriceBps 20`, `ttlSeconds 120`, `pollMs 15000`, `cutoffBufferSeconds 300`, `maxFeedAgeMs 30000` — `config.ts:62-84`.
- Size and inventory:
  - budget per ladder `min(orderQuote, maxOrder·levels, maxWallet/4, maxMarket/4)`;
  - bids get room `2·target − held` with skew `room/target`;
  - asks are quoted only when it holds base claims, with skew `held/target`;
  - level weights grow outward;
  - quotes never cross the best foreign order;
  - `orderQuote` ≤ 25% of quote inventory.
  — `strategy.ts:104-191`, `config.ts:141-142`.
- Inventory is the maker's branch claims plus its claim-funded reservations — `services/market-maker/src/engine.ts:49-62`. Funding (`--fund`) splits a one-time seed of base and quote into each market's claims and is "Never automatically top up losses" — `engine.ts:520-552`.
- Risk:
  - a reference that is stale or moved backwards halts;
  - a spot jump ≥ 500 bps or probability jump ≥ 10pp starts a 60 s cooldown;
  - movement is an EWMA;
  - a per-market drawdown ≥ 10% from peak latches a persistent halt;
  - an issuer pause or a market near cutoff cancels its quotes.
  — `engine.ts:185-270`, `config.ts:73-79`.
- Execution: serial cancel/replace, each step re-reading book, issuer state and feeds, up to `4·quoteLevels` actions per market per cycle — `engine.ts:315-392`. `replace()` is used for atomic requotes — `engine.ts:272-313`. Gas policy: `minGasWei 0.001` kept for cancels, `dailyGasBudgetWei 0.01` — `config.ts:80-81`, enforced in `packages/operator/src/execution.ts:124-153`. It must use a non-governance wallet — `services/market-maker/src/main.ts:72-77`. At most 50 configured markets — `config.ts:60-61`.

### Inferences
- The fixed-gap maker carries pure Δ risk with no learning and no on-chain bounds. Its capital is siloed per market by the one-time split.
- Both bots require live Polymarket p and live spot. Neither quotes a market whose Polymarket book is illiquid (spread > 5pp, depth < $100) or whose p is outside [2%, 98%] (`reference.ts:133-146`). Long-shot and near-certain events therefore get no bot liquidity at all.

### Gaps
- There is no record in the repo of whether the market maker currently runs on testnet, or with which config. `ops/ec2` starts it only "when `.env.market-maker` … exists" (`README.md:191-192`).

---

## Q8. Is Polymarket's probability available on chain anywhere, and is there any on-chain oracle for p?

### Takeaway
No. p exists only off chain: ingestor → API → keeper and market maker. On chain, the exchange stores only a hash of the condition and YES orientation, and resolution is a two-step admin commitment, not an oracle read. The only on-chain price oracle in the system is a Chainlink **stock spot** feed per vault. The doc calls an on-chain probability feed the "hard part", since "no production one exists".

### Cited Findings
- `createMarket` stores `eventKey = keccak256(abi.encode(condition, yesIndex, noIndex))`, and the raw condition appears only in the `MarketCreated` params — `ConditionalStocksAdmin.sol:110-111`, `ConditionalStocksBase.sol:357-359`.
- Resolution: the market admin commits `resolutionHash(id, yes, no, evidence, uri)`, then the resolution admin `resolve`s exactly that — `ConditionalStocksAdmin.sol:169-175`, `:187-227`. The audit accepted that "the admin can replace every role instantly and resolve a market alone" (commit `bcd3341` message).
- Probability path: the Polymarket ingestor follows the CLOB YES book over `wss://ws-subscriptions-clob.polymarket.com/ws/market`, reconciles over REST every 30 s, and marks the book stale after 90 s — `services/polymarket-ingestor/src/environment.ts:47-71`. Quality is valid / stale / empty / one-sided / crossed / low-depth, and the midpoint is computed only when valid — `packages/market-data/src/order-book.ts:212-238`. The API proxies it at `GET /v1/markets/:id/polymarket` — `apps/server/src/market-data/routes.ts:144`. The ingestor README: "Display-only… It contains no chain client or admin transaction path." — `services/polymarket-ingestor/README.md:3-5`.
- UI framing: "Polymarket probability is an informational reference, not the stock's execution price or the local settlement authority." — `apps/web/src/app/learn/page.tsx:23-26`.
- v2 vision: "Traders would swap directly against a contract that reads Pyth. The hard part is still a trustworthy on-chain probability feed, since no production one exists. In v1 the keeper supplies p off-chain, and the vault bounds what it can do with it." — `docs/delta-vault.md:258`.
- On-chain spot: Chainlink publishes Robinhood Chain mainnet (4663) stock-token feeds, e.g. "RHTSLA / USD", "Robinhood AMZN / USD", "Robinhood PLTR / USD", "RHAMD / USD". The testnet mirrors them into owner-only mocks, and NFLX is mirrored from BNB Chain — `deployments/46630-mock-feeds.json`, `README.md:176-180`. Reference spot itself comes from Robinhood's public API ("the bid/ask midpoint of each underlying share", 2 s cache, halt ⇒ unavailable) — `apps/server/src/market-data/robinhood.ts:1-7`, `:35`, `:56`, `:84`, `README.md:145-148`. Commit `e146c81` replaced Pyth with Robinhood.

### Inferences
- An on-chain mechanism that prices from p (an AMM reading an oracle) would need a new trusted p source: a keeper-posted signed p, an optimistic oracle, or a cross-chain Polymarket read. The current trust model has the keeper as that source, bounded only by spot band and imbalance caps.
- An on-chain mechanism that discovers p and Δ itself (e.g., an LMSR or CPMM on each branch, or an auction) needs no p oracle. It does need Chainlink spot or its own price discovery for s, and it pays the full LVR on spot moves that the Δ-vault avoids (`docs/delta-vault.md:118-129`).

### Gaps
- Polymarket itself runs on Polygon (outside-repo knowledge). Nothing in the repo reads Polymarket state on chain or bridges it.

---

## Q9. Upgrade constraints: how extensions work, bytecode headroom, and whether a new mechanism can live in a separate contract

### Takeaway
The core contracts are immutable. New functions can only be added as **extensions**: modules reached by nested delegatecall in the exchange's storage context, activatable 14 days after the admin proposes them. They inherit the full ledger layout, so they **can** move balances and act as a counterparty (an accepted audit risk). Extensions cost no exchange bytecode, and the exchange has only 186 B of EIP-170 headroom anyway. Alternatively, a separate contract can trade permissionlessly as an ordinary exchange account, as the Δ-vault does. It needs no exchange role, but it lacks claim allowances and `depositFor`, and it has no fill-time hook.

### Cited Findings
- "No deployed function can change. New functions can only be added as extensions, activatable 14 days after the admin proposes them (the guardian can cancel), while withdrawals stay instant and unpausable" — `README.md:46-48`, `ConditionalStocks.sol:14-16`.
- Mechanics:
  - `proposeExtension(selectors, module)` (admin; zero module proposes removal);
  - `activateExtension(selector)` by anyone after `EXTENSION_DELAY = 14 days`;
  - `cancelExtension` by admin or guardian;
  - "Extensions can only add functions: selectors this module or the exchange implement never reach them."
  — `ConditionalStocksAdmin.sol:337-373`, `ConditionalStocksBase.sol:24-25`.
- Dispatch: the exchange fallback delegatecalls the admin module (`ConditionalStocks.sol:83-92`), whose fallback delegatecalls `_extensions[msg.sig]` or reverts `UnknownSelector` (`ConditionalStocksAdmin.sol:375-385`). Storage context and `msg.sender` are the exchange's and the user's.
- Storage access: "Extension modules… also inherit it and keep any state of their own in ERC-7201 namespaced slots" — `ConditionalStocksBase.sol:4-9`. The test module reads `_marketCount` and `_credit` "in the exchange's context" and writes a namespaced slot — `contracts/test/Extensions.t.sol:7-35`, `:102`. The test that "Extensions cannot replace deployed functions" is at `Extensions.t.sol:110`.
- Rules for every extension: inherit `ConditionalStocksBase`; use ERC-7201 state; "pause only their own non-exit functions. An extension's exit functions (release, withdraw) must never be pausable." The replica "throws on any other unknown event, so the indexer fails closed. Operators upgrade it during the 14 days before an activation." — `docs/cross-chain-order-support.md:521-530`.
- Accepted risk: "an extension can move funds after its 14-day window" (commit `bcd3341` message). The memory note (c) says the mitigation chosen was operational: "a multisig admin behind a timelock longer than 14 days, plus an independent guardian".
- Bytecode: "Measure with `forge build --sizes` before any exchange change." `ConditionalStocks` is 24,390 B with 186 B headroom, after `module()` was moved into the admin module to fit the rebate (commit `dddded6` message; memory (c)). My computation from `contracts/out` (non-repo (b)): ConditionalStocks 24,390 B (186 B headroom), ConditionalStocksAdmin 19,348 B (5,228 B), DeltaVault 17,842 B (6,734 B), DeltaVaultAdmin 22,581 B (1,995 B). Foundry settings: via-IR, `optimizer_runs 20_000` (vault 200), Cancun — `contracts/foundry.toml:1-25`.
- Separate-contract precedent (Δ-vault): the vault holds its own exchange account and calls `deposit`, `withdraw`, `split`, `merge`, `redeem`, `transferClaim`, `place`, `cancelMany` and `invalidateOrders` — `contracts/src/vault/interfaces/IConditionalStocks.sol:63-75`. It pays depositors claims via `split` + `transferClaim` — `DeltaVault.sol:375-406`, `:336-359`.
- The exchange enforces no on-chain allowlist: `_place` checks pause, market terms and caps only — `ConditionalStocks.sol:206-306`. Invite gating lives in the API: "Anyone can browse; trading and a wallet's own data… need an invite" — `README.md:71-83`, enforced via `auth.trader`/`auth.member` (`apps/server/src/trading/routes.ts:33`, `apps/server/src/delta-vaults/routes.ts:159`, `:213`, `:240`).
- Missing primitives for a separate contract:
  - `deposit` credits only `msg.sender` (`ConditionalStocks.sol:103-114`); `depositFor` is proposed only for the cross-chain extension (`docs/cross-chain-order-support.md:415-416`, `:566`).
  - `transferClaim` moves only the caller's claims, with no allowance or operator mechanism (`ConditionalStocksAdmin.sol:245-255`).
  - Delegation grants only authorise `placeFor` order placement, "Proceeds always stay with the owner" (`ConditionalStocksAdmin.sol:259-265`).
- The cross-chain design adds its own balances ("x-balances") and leg settlement as a "delegatecalled extension, behind a governance delay… nothing has to be migrated" — `docs/cross-chain-order-support.md:21-23`, `:135-145`. This is a worked template for adding a whole subsystem as an extension.

### Inferences
- **Extension path** (an AMM, auction or pool that is itself an exchange account): it can read and write `_credit`, `_accounts`, `_backing` and `_fees` directly. It could settle a curve trade in one call with no resting-order gas, and could even net capital across markets in its own namespaced state. Costs:
  - a 14-day activation window per selector;
  - an audit, because the module can move all funds;
  - two delegatecall hops per call;
  - a replica upgrade, so its events and any balance changes stay reconstructable.
  - It must not change existing selectors' behaviour. `place` keeps ignoring the extension unless the extension also posts orders.
- **Separate-contract path** (like the Δ-vault): ships without governance. It can act as maker (resting `place` with no makers) or taker (`place` with a plan). It can offer "buy branch with plain tokens" atomically: pull ERC-20, deposit, split, keep the paid branch's claim, then `transferClaim` the counter-claim and the purchased claims to the user (this mirrors `DeltaVault._addClaims`).
  - It cannot pull users' existing claims in one transaction, so claim-funded sells need the book or a prior `transferClaim`.
  - It cannot discover resting makers on chain cheaply.
  - Its swaps would not emit `Trade`, so they would bypass the indexer's trade history, per-market fees, rebates and referral accrual (accrual is from finalized trades, `README.md:85-92`) unless routed through `place`.
- **Hybrid:** a separate pool contract that posts a discretised curve as vault-style resting orders inherits the Δ-vault's limits: ≤ 8 makers per taker transaction, per-order caps (`maxOrder` $10k, `maxSteps`), per-wallet resting caps (testnet $100k across both branches), ~100–150k gas per posted level, TTL/requote churn, and no callback at fill.

### Gaps
- The gas overhead of the nested-delegatecall extension path is not benchmarked in the repo. No extension is deployed or proposed on testnet: `deployments/46630.json` lists none, and the only extension design in the repo is the cross-chain one.

---

## Q10. What docs/future-improvements.md and docs/cross-chain-order-support.md say about liquidity, AMMs, routing and market makers

### Takeaway
Both docs treat liquidity as the existential problem. The research note says prior conditional markets "died of the same thing: liquidity" and that "the edge has to come from making conditional liquidity **not depend on market makers at all**". The answers it proposes are the Δ-vault, event universes and event-locked orders, plus a list of things to avoid. The cross-chain plan keeps liquidity in one off-chain book fed by per-chain vaults and leaves "keep on-chain matching?" open.

### Cited Findings
- Prior failures: Shiller's macro markets ("starting a new market is like opening a nightclub"), Kalshi combo RFQs ("None of 96 macro, crypto and weather quote requests got a single quote"), and MetaDAO "had to borrow half of its spot liquidity to keep its conditional markets alive". "So the edge has to come from making conditional liquidity **not depend on market makers at all**." — `docs/future-improvements.md:12-17`. These are research claims; the doc says four research agents read about 100 sources (`:1`), but no sources are linked in the repo.
- Δ-Vault pitch (one vault per stock, LPs deposit plain stock and USDC once, event-neutral to first order, ~1/1,600 of constant-product arbitrage loss "with illustrative numbers", "MetaDAO's version is three constant-product pools plus a brute-force arbitrage loop"). Risks listed: oracle timing, Δ jumps, net branch inventory needing a hard cap, and "Who sets Δ's starting value. One option: auction that right, with rent paid to LPs." — `docs/future-improvements.md:31-52`.
- Event universes: "USDC-if-tariffs is the same token in every market conditioned on tariffs" → "One shared USDC pool per event" and same-universe lending (Morpho) — `docs/future-improvements.md:54-61`. Event-locked orders as the product users feel — `:63-76`. Δ as a data product — `:78-89`.
- "What I'd deliberately not do": add more markets ("Augur died of duplicate, illiquid markets"), build MM-quoted combos, move to cash settlement, grow through points ("Pendle's liquidity fell off a cliff when its points program ended") — `docs/future-improvements.md:95-99`.
- Hard constraints: likely security-based swaps in the US (keep geofencing); only objective-outcome events; issuer freeze and multiplier mechanics must pass through — `docs/future-improvements.md:101-104`. Build order — `:106-109`.
- Cross-chain: an off-chain matching engine with signed orders and price-time priority with eligibility filters. "Resting on-chain orders appear as depth. A signed taker order can hit them only on the same chain… through the existing delegation grants" — `docs/cross-chain-order-support.md:279-305`. "Market maker / Δ-Vault: One vault per chain quoting its own backing into the shared book" — `:503`. The Vertex Edge precedent ("operator taking the other side as principal. Shut down in August 2025") — `:96-97`. Open decision: "Whether to keep on-chain matching long-term, or route all takers through the engine" — `:622`. Status: "proposal, not implemented" except Phase 0 — `:3`, `:507-536`.
- The Δ-vault doc's own baselines and backtest: compare against "two constant-product pools" and "our current fixed-gap market maker"; proposed pass criteria include Δ-LVR "at least ~10× lower than the constant-product baseline" — `docs/delta-vault.md:271-297`. Failure modes: huge, jumpy Δ (small-cap FDA) and Polymarket as a single dependency — `:299-303`.

### Inferences
- The project's stated direction favours mechanisms that (1) avoid professional-MM dependence, (2) do not multiply markets, (3) keep physical settlement, and (4) avoid points-driven bootstrapping. A new bonding-curve, auction or pool design is likelier to fit if it reuses existing markets and the vault-as-maker pattern, or if it addresses "who sets Δ₀" (e.g., an auction of the initial Δ).

### Gaps
- No backtest results (σ_Δ, lead-lag, out-of-hours share) exist in the repo. The doc lists them as prerequisites (`docs/delta-vault.md:271-297`).

---

## Q11. What external liquidity exists for the underlying stock tokens, and does any code route to spot DEXs?

### Takeaway
No code path routes to any DEX, AMM or aggregator. The only external price inputs are Robinhood's Stock Token API and Chainlink feeds. Stock tokens enter only by user or bot deposits. Issuer mint and redeem runs through authorised participants with KYC. On testnet, DEX liquidity for the real testnet USDG was negligible (memory note, not repo).

### Cited Findings
- A repo-wide search for `uniswap|v4 pool|amm|bonding|swap router|aerodrome|morpho|pyth|lmsr` across `.ts/.tsx/.sol/.md/.json/.mdx` (excluding `node_modules` and build output) found only doc mentions and a Uniswap-V2 analogy comment (`contracts/src/vault/DeltaVaultBase.sol:48`). There is no routing code (my search).
- Token facts:
  - Coinbase stock tokens exist on Base only. "Authorised participants mint. Only KYC'd 'vested holders' can redeem".
  - Robinhood Stock Tokens are a "Debt security of Robinhood Assets (Jersey) Ltd". Authorised participants mint, with "KYC redemption only where no authorised participant is available".
  - Both have freeze, pause or blocklist powers and ERC-8056 multipliers.
  - "Neither token can exist on the other chain."
  — `docs/cross-chain-order-support.md:68-83`.
- Quote token pinned per chain: Circle USDC `0x8335…2913` on Base, Paxos USDG on Robinhood Chain; testnet uses an open-mint mock USDG — `scripts/evm/deploy.ts:26-34`, `README.md:152-157`, `deployments/46630-mock-usdg.json`.
- Asset catalog (listable underlyings): NVDA, TSLA, AAPL, MSFT, AMZN, GOOGL, META, AMD, MU, COIN, HOOD, PLTR, NFLX, SPY, QQQ — `packages/shared/src/token-catalog.ts:30-45`. Stock tokens use 18 decimals ("tokenized stocks share 18") — `apps/server/src/trading/delegated.ts:59-60`.
- Memory (non-repo (c), `contract-audit-2026-09.md`): the real testnet USDG could not be used because "every Uniswap v4 and Synthra pool holding it had ≤1.5 USDG". Stock tokens must be the issuer's official testnet tokens (TSLA, AMZN, NFLX, PLTR, AMD).
- Research claim (no repo source): "tokenized-stock perps trade about 50× spot volume" — `docs/future-improvements.md:22`.

### Inferences
- A liquidity mechanism cannot assume on-chain spot depth for hedging or rebalancing on Robinhood Chain. Inventory rebalancing (e.g., an AMM selling stock it accumulates) would have to happen off-protocol (issuer, CEX or perps) or through the exchange's own users.

### Gaps
- No mainnet DEX liquidity data for Robinhood Chain or Base stock tokens is in the repo.

---

## Q12. How long markets live, how many are listed per stock and event, how they cluster, and what fees are set

### Takeaway
Testnet (Robinhood Chain 46630) has 11 markets: 4 Polymarket events × 1–5 stocks across 5 stocks (TSLA 3, AMZN 3, PLTR 2, AMD 2, NFLX 1). Their cutoffs are the Polymarket end dates (all "by end of 2026"), about 3 months after creation in early October, and fees are 0/0. The local demo is 14 events × 3 stocks = 42 markets across 12 tickers. Markets cluster both ways: one event × several stocks, and each stock × 2–3 events. A Δ-vault covers one stock's markets (≤ 8).

### Cited Findings
- Testnet events (`deployments/46630-markets.json`):
  - "US recession by end of 2026?" → TSLA, AMZN, PLTR, NFLX, AMD (markets 1–5);
  - "AI bubble burst in 2026?" → AMD, PLTR, AMZN, TSLA (6–9);
  - "Tesla and SpaceX merger officially announced by December 31?" → TSLA (10);
  - "Will Anthropic IPO by December 31, 2026?" → AMZN (11).
- The exchange was redeployed 2026-10-05 (`deployments/46630.json`, commit `a9c5bfb`).
- Cutoff = Polymarket `endTime`, open = now − 60 s, and events ending within a day are refused — `scripts/evm/create-markets.ts:197-216`. Local seed: cutoff = event end, or now + 90 days if that is within an hour — `scripts/evm/seed-markets.ts:140`.
- Fees: per market, from the market's, event's or plan's `fees`, else `NO_FEES` (0/0); rebates likewise default "0" — `scripts/evm/create-markets.ts:6-8`, `:81`, `:214`, `:297`. The testnet plan contains no `fees` or `makerRebateBps` keys (`deployments/46630-markets.json`), so these markets are 0/0 with no rebate (my reading).
- Demo fees by category: Macro 0/10, Earnings 5/25 (rebate 20%), Policy 10/30 (rebate 50%), Other 0/0 bps — `scripts/evm/seed-policy.ts:23-40`. Demo catalogue: 14 events × 3 tickers over 12 tickers; each ticker is tied to ≥ 2 events — `scripts/evm/seed-policy.ts:7-20`, `:50-158`, `:168-196`. The Phase 0 verification ran "42 markets created through the admin evidence pipeline" — `docs/cross-chain-order-support.md:532-536`.
- Market creation goes through an admin evidence flow (metadata snapshot → evidence packet → review checklist including "maker-and-taker-fees" → createMarket → reconcile/subscribe ingestor → open) — `scripts/evm/create-markets.ts:1-8`, `:173-240`.
- Vault coverage: TSLA {1, 9, 10}, AMZN {2, 8, 11}, PLTR {3, 7}, NFLX {4}, AMD {5, 6}, matching every testnet market (against the pre-redeploy exchange) — `deployments/46630-vault-plan.json`.

### Inferences
- Event-level clustering, e.g. "recession" across 5 stocks, means one Polymarket p drives several markets. The keeper already shares one Polymarket read per event (`services/vault-keeper/src/tick.ts:18-21`). A mechanism pooling collateral per event (event universes) would cover 4–5 markets per event on testnet.
- Lifetimes of ~3 months, with resolution at the end of December, mean a bootstrapping mechanism must keep markets liquid for a quarter. The steepest informational risk falls in the last day (widening) and at early resolution: the market admin can freeze early, `ConditionalStocksAdmin.sol:158-165`.

### Gaps
- No live-traded volume or open-interest data is in the repo. The indexer computes a rolling 24 h volume at runtime (commit `f64f595`).

---

## Q13. What else a mechanism designer must know: fees, rebates, referrals, invite gating, delegated trading, governance, testnet state

### Takeaway
Per-market immutable maker and taker fees (≤ 10%), a mutable maker rebate (≤ 50% of the taker fee, paid in the fee's claims) and a 15%/6-month referral share all sit on `Trade` fills only. Access is invite-gated off chain, but the contracts are permissionless. Governance retains strong powers (instant role replacement, solo resolution, and extensions that can move funds after 14 days). The testnet vaults currently point at the pre-Oct-5 exchange.

### Cited Findings
- Fees:
  - "maker and a taker rate (whole bps, at most 1,000 = 10%) with each new market, part of its reviewed creation evidence and immutable once created";
  - charged on what each side receives;
  - "Every order signs a fee cap: a maker capped below its market's maker rate is skipped and a taker capped below the taker rate reverts";
  - "Only placements that fill read the rates";
  - fractional remainders are carried per order.
  — `README.md:55-61`, `ConditionalStocks.sol:259-265`, `:608-616`.
- Fees accrue per market and branch in claims. The admin's `claimFees` moves them to an owner's claim balance — `ConditionalStocksAdmin.sol:229-241`.
- Maker rebate: `setMakerRebate` (market admin, any time, ≤ `MAX_REBATE_BPS = 5000`). It is paid to the filled maker in the taker fee's claims and rounded down: "Capping it at half means matching one's own orders always costs more than it returns." — `README.md:63-69`, `ConditionalStocksAdmin.sol:114-123`, `ConditionalStocks.sol:470-482`, `ConditionalStocksBase.sol:16-18`.
- Referrals: 15% (`REFERRAL_SHARE_BPS`) of referees' net fees (taker fee less the rebate paid from it) for 6 months, one level deep. They accrue from finalized trades in fee claims and are paid weekly after resolution by a payout wallet — `README.md:85-92`, commit `59533e2` message.
- Access: SIWE sessions, invite codes, a member quota (5 by default); trading and owner-scoped reads need a member session; "withdrawals and cancellations need only a session, so a wallet's funds are never held back" — `README.md:71-83`, commit `59533e2`.
- Delegated one-click trading: grant budgets in quote and shares (audit H-01 fix), expiry ≤ 90 days, fee cap; re-approval invalidates prior delegated orders — `ConditionalStocksAdmin.sol:259-326`, commit `bcd3341`. The web default is "10 shares per sell, 100 in total" (commit `bcd3341` message).
- Governance and pause: the guardian pause halts only placements ("Cancellation, custody and positions keep working") — `ConditionalStocksAdmin.sol:52-59`. Admin transfer is 2-day delayed — `ConditionalStocksBase.sol:23`, `ConditionalStocksAdmin.sol:33-50`. Accepted risks: instant role replacement, solo resolution, extension fund movement (commit `bcd3341` message).
- Issuer controls: a stock-token pause halts planning ("trading is halted for this market") and all bot quoting — `apps/server/src/trading/plan.ts:46-49`, `services/vault-keeper/src/engine.ts:244-248`, `services/market-maker/src/engine.ts:201-205`.
- Testnet state: exchange `0x32dfD605918A4528047b61F63C8622b65EFcf3db`, deployed 2026-10-05, mock USDG quote — `deployments/46630.json`, `deployments/46630-mock-usdg.json`. The vault plan's exchange `0x1879c9161E56f274Fd107C6265bc5a80aA0B49B5` differs (`deployments/46630-vault-plan.json`). Vault-keeper defaults keep 20% of plain holdings free for withdrawals (`services/vault-keeper/src/config.ts:69-70`, `:216`).
- Mechanism-relevant exchange limits: `MAX_MAKERS 8`, `RECENT 16`, `MAX_GRANT_LIFETIME 90 days`, `MAX_URI 512` — `ConditionalStocksBase.sol:13-27`. Per-market caps from terms (testnet: min $1, max $10,000 per order, 1,000 shares per order, $100k wallet open, $1M market open bids) — `scripts/evm/create-markets.ts:69-80`.

### Inferences
- If a new mechanism settles outside `place` (a separate contract using `transferClaim`, or an extension writing balances), it must reimplement fees, rebates and referral attribution, or forgo them. It must also replicate the fee-cap safety that every order signs today.
- Maker rebates up to 50% of the taker fee are the only built-in, admin-tunable liquidity incentive. Because they are paid in branch claims, a maker's rebate is worth only its branch's probability-weighted value.
- Invite gating is not a security boundary for a contract-level mechanism. Any address can call `place`, `split` and `transferClaim`, so on-chain mechanisms are open to non-members unless they add their own gate.

### Gaps
- Mainnet (Base 8453 or Robinhood Chain 4663) deployment records do not exist in `deployments/`. Only testnet 46630 is recorded, so mainnet fee settings, sizes and roles are unknown.
- The Monad testnet copy mentioned in the user's memory (`/Volumes/T9/probabl-monad`) is outside this repo and was not studied.
