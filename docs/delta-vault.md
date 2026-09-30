The Δ-Vault is one pool per stock that quotes the stock in both "worlds" of every event at once. It takes the stock price and the event's probability from outside, and learns only one number itself: how much higher or lower the stock will be if the event happens. Below is the whole design. I use NVDA with a Fed cut as the event E throughout.

## 1. The objects and the one identity everything rests on

Splitting is free and exact:
- 1 NVDA = 1 **NVDA⁺** (pays 1 NVDA if E happens) + 1 **NVDA⁻** (pays 1 NVDA if E doesn't).
- 1 USDC = 1 **USDC⁺** + 1 **USDC⁻**, the same way.

Each branch trades in its own currency:
- **Y** = price of NVDA⁺ in USDC⁺. This is "what NVDA is worth in the world where the Fed cuts".
- **N** = price of NVDA⁻ in USDC⁻. This is "what NVDA is worth in the world where it doesn't".

Quoting each branch in its own currency keeps probability out of the price. 1 USDC⁺ is only worth p dollars today, but inside the cut-world it is simply a dollar. So Y is a clean conditional price.

Three numbers describe the market:

| Symbol | Meaning | Where it comes from |
|---|---|---|
| s | NVDA spot price | Pyth |
| p | probability of the Fed cut | Polymarket |
| Δ = Y − N | how much higher NVDA is if the Fed cuts | **only our market** |

Holding 1 NVDA is the same as holding NVDA⁺ plus NVDA⁻. In dollars today, NVDA⁺ is worth p·Y and NVDA⁻ is worth (1−p)·N. If that sum differed from s, you could split or merge and pocket the difference. So:

**s = p·Y + (1−p)·N**, which rearranges to **Y = s + (1−p)·Δ** and **N = s − p·Δ**.

Example: s = $100, p = 0.4, Δ = $5 gives Y = 103 and N = 98. Check: 0.4·103 + 0.6·98 = 100.

The key consequence: once you know s and p, **the only thing left to discover is Δ.**

## 2. What the vault holds and quotes

LPs deposit plain NVDA and plain USDC. There's no need to hold branch tokens up front.

The vault quotes both branches continuously:

- **YES quote = s + (1−p)·Δ̂ ± half-spread**
- **NO quote = s − p·Δ̂ ± half-spread**

s and p are read fresh from the oracles on every quote. **Δ̂** is the vault's own running estimate of Δ, and it moves with order flow:

**Δ̂ = Δ₀ + (net NVDA⁺ bought − net NVDA⁻ bought) / κ**

- Δ₀ is the starting value.
- κ is the depth: how many shares it takes to move Δ̂ by $1.

The original design adds a small second term that skews both quotes when the vault's plain-stock inventory gets lopsided. I'm leaving it out here for clarity.

So each time someone buys NVDA⁺ (they think the cut-world price is too low), Δ̂ rises. The YES quote goes up by (1−p) of that change and the NO quote goes down by p of it. Buying equal amounts of both branches leaves Δ̂ unchanged, because that trader is just buying NVDA.

## 3. A trade, step by step

The vault starts with 1,000 NVDA and 100,000 USDC. Fees and price impact are ignored here.

**Trade 1: Alice buys 100 NVDA⁺ at 103.**
- Her router splits 10,300 USDC into USDC⁺ and USDC⁻. She pays the 10,300 USDC⁺ and keeps the USDC⁻.
- The vault splits 100 NVDA into 100 NVDA⁺ and 100 NVDA⁻. It sends Alice the NVDA⁺ and keeps the NVDA⁻.

**Trade 2: Bob buys 100 NVDA⁻ at 98.**
- The vault already holds 100 NVDA⁻, so it sends those; no split is needed. It receives 9,800 USDC⁻.
- The vault now holds matching USDC⁺ and USDC⁻, so it merges 9,800 of each back into plain USDC.

| Vault holds | Start | After trade 1 | After trade 2 (merged) |
|---|---|---|---|
| NVDA | 1,000 | 900 | 900 |
| NVDA⁻ | 0 | 100 | 0 |
| USDC | 100,000 | 100,000 | 109,800 |
| USDC⁺ | 0 | 10,300 | 500 |

Taken together, Alice and Bob bought one whole NVDA from the vault for 103 USDC⁺ + 98 USDC⁻. That equals 98 USDC plus 5 USDC⁺, worth 98 + 0.4·5 = **$100 = spot**. Opposite flows **net out automatically**. The vault only ever holds the *imbalance* of branch tokens, never gross amounts.

## 4. Why it's event-neutral

Look at the vault's wealth separately in each world:
- **W⁺** = what it owns if the Fed cuts (plain tokens + ⁺ tokens, with NVDA valued at Y).
- **W⁻** = what it owns if it doesn't (plain tokens + ⁻ tokens, with NVDA valued at N).

| | Start | After trade 1 | After trade 2 |
|---|---|---|---|
| W⁺ (cut world, NVDA at 103) | 1,000·103 + 100,000 = **203,000** | 900·103 + 110,300 = **203,000** | 900·103 + 110,300 = **203,000** |
| W⁻ (no-cut world, NVDA at 98) | 1,000·98 + 100,000 = **198,000** | 1,000·98 + 100,000 = **198,000** | 900·98 + 109,800 = **198,000** |

**A trade at the fair branch price changes neither world's wealth.** Alice's trade happens entirely inside the cut-world: the vault gave up 100 cut-world shares for 10,300 cut-world dollars, which is exactly what they're worth there. So the vault took **no bet on whether the Fed cuts**. Its value today, p·W⁺ + (1−p)·W⁻, is identical to never having traded, for every possible p. Its only profit is the spread it charged.

That is what "event-neutral" means. The "+200·dp − 40·(5·dp) = 0" in the report is the same fact written as a derivative. News that raises p makes the vault's USDC⁺ worth more (+200 per unit of dp), and the resulting rise in NVDA spot costs it on the 40-share delta it gave up (−200). The two cancel exactly.

**Compare a market maker who sells NVDA⁺ for plain dollars**, at p·Y = $41.20 each:
- If the Fed cuts, it loses 100·103 − 4,120 = **−$6,180**.
- If not, it keeps **+$4,120**.
- That's a $10,300 bet against the cut, riding on the market maker's balance sheet. It's why prediction-market liquidity is thin: market makers carry event risk.
- The vault never quotes this way.

**What the vault *does* take on.** After trade 1 it owns 900 shares in the cut-world but 1,000 in the no-cut world. The gap, **q = −100**, is its only new risk:
- If Δ turns out wrong (the real cut-world price is 110, not 103), it sold 100 shares too cheaply *in that world*.
- At resolution, its stock position jumps to whichever world happened. It holds 900 shares if the Fed cuts and 1,000 if not, so a perp hedge must be adjusted by 100 shares on resolution day.

The vault gets paid for bearing this Δ risk, and q is capped per event.

## 5. How it learns Δ, and what that costs

Price discovery happens through κ:
- With κ = 2,000 shares per $ and p = 0.4, a 100-share buy of NVDA⁺ raises Δ̂ by $0.05.
- That moves YES by 0.6 × 0.05 = 3¢ and NO by 0.4 × 0.05 = 2¢. The small extra term from §2 adds a fraction of a cent, which gives the 3.2¢ and 2.3¢ in the research.

Discovery isn't free. If informed traders push Δ̂ from 5 to 6 because the truth really is 6, the vault sold along the way below the true price. The cost is ½·p(1−p)·κ·(move)² = ½ × 0.24 × 2,000 × 1² = **$240** per $1 of discovered Δ.

That's the subsidy LPs pay for the market to find Δ, the same role the subsidy plays in Hanson's LMSR. κ sets the trade-off: a larger κ means deeper quotes but a costlier subsidy.

## 6. "Arbitrage losses", explained from scratch

Any market maker that doesn't instantly know the true price gets picked off:
- A Uniswap pool shows ETH at $2,000.
- Binance jumps to $2,010.
- Before anyone else trades, an arbitrageur buys ETH from the pool below $2,010 until the pool reprices. The LP sold ETH below market.

Repeated every time the price moves, this is **LVR (loss-versus-rebalancing)**. It's the main reason AMM LPs lose money. For a constant-product pool it averages σ²/8 of the pool's value per year, where σ is the asset's volatility. At 40% volatility that's about 2% of TVL a year, before fees.

Now compare two naive YES/NO constant-product pools with the Δ-Vault. Take NVDA +$1, with Δ and p unchanged:
- **Two pools:** both are now stale by $1. Arbitrageurs pick off both.
- **Δ-Vault:** it read s = 101 from Pyth, so its quotes were already 104 / 99. There's nothing to pick off.

Take Polymarket moving p from 0.40 to 0.60:
- **Two pools:** Y and N don't change, so nothing happens, but spot moved, which puts us back in the first case.
- **Δ-Vault:** it reads the new p and s. Nothing to pick off.

Take the true Δ moving from $5 to $6:
- **Both designs** get picked off. This is the vault's only real exposure.

Spot and odds are the two numbers that move constantly, and the vault never lags on them (apart from oracle delay). It only loses to arbitrage when **Δ** moves:

**Δ-LVR per year = ½ · σ_Δ² · p(1−p) · κ**

- σ_Δ is how much Δ itself wanders.
- Illustration: σ_Δ = $2 per year on a $100 stock with 40% volatility (±$40 a year).
- For the same depth, the vault's arbitrage loss is (2²·0.24) / (40²) ≈ **1/1,600** of a constant-product pool's.

**That number depends entirely on σ_Δ, which nobody has ever measured.** If a tariff headline can move Δ by $5 in a minute, the advantage shrinks a lot. That's why the backtest comes first.

## 7. Resolution

**The Fed cuts:**
- NVDA⁻ and USDC⁻ become worthless.
- NVDA⁺ and USDC⁺ redeem 1:1.
- The vault ends with plain NVDA and USDC.
- LP P&L = fees + ordinary NVDA exposure + the Δ result. If the real post-cut price is 110, the 100 shares sold at 103 cost 700 relative to holding.

**The Fed doesn't cut:**
- In trade 1's state, the vault holds exactly its starting 1,000 NVDA and 100,000 USDC. Alice's 10,300 USDC⁺ just expires.

In both cases LPs lost nothing to the outcome itself. They were exposed only to how well Δ was priced.

Near resolution, informed traders become dangerous: the final Polymarket rounds and people who know first. So κ shrinks and spreads widen as resolution approaches, and quoting stops during the resolution window.

## 8. One vault, many events

The same NVDA inventory quotes every event on NVDA: Fed cut, tariffs, earnings. Each event has its own Δ̂ and its own capped imbalance q. The stock exposure nets across all of them, and one perp hedge covers the total.

With **event universes** (idea 2), USDC-if-cut is the same token for the NVDA, AAPL and TSLA vaults. One USDC pool then backs every stock conditioned on the Fed cut.

## 9. How it's built

v1 is built. The vault posts quotes into our order books. Order-book traders still compete on top, and no AMM contract is needed.

| Piece | Where | Job |
|---|---|---|
| Vault contracts | `contracts/src/vault` | Shares, custody, on-chain limits on every quote |
| Keeper | `services/vault-keeper` | The Δ-model: prices, spreads, ladders, safety gates |
| Client | `packages/evm-client/src/delta-vault.ts` | Transactions, one-call state reads, error messages |
| API | `/v1/delta-vaults` in `apps/server` | Vault state, a wallet's position, previews |
| Web | `/vaults` in `apps/web` | Deposit, withdraw, holdings, events, your position |
| Admin | Vault controls in `apps/admin` | Caps, limits, markets, roles, pause |

**The contracts.** `DeltaVault` holds the shares, deposits and withdrawals. `DeltaVaultAdmin` holds quoting, settlement, curation, governance and views, and is reached through a delegatecall fallback, the same pattern as the exchange. They build on OpenZeppelin 5.6: ERC-20 shares, `AccessControlDefaultAdminRules`, `Pausable`, `ReentrancyGuardTransient`, `SafeERC20` and `Math`. Nothing is upgradeable, and no role can move holdings.

### Shares are in kind, so no price is ever trusted

A share is an exact slice of everything the vault holds on the exchange:
- plain USDC and NVDA credit,
- the escrow of its resting orders,
- its YES and NO claims in every event.

Deposits and withdrawals move the same fraction of every holding.

Take the vault after Alice's trade in §3: 100,000 USDC, 900 NVDA, 10,300 USDC⁺ and 100 NVDA⁻.
- **Withdrawing 10%** pays 10,000 USDC and 90 NVDA as tokens, plus 1,030 USDC⁺ and 10 NVDA⁻ as exchange claims. Claims that pair up across the two worlds are merged into plain tokens first, so only the unpaired remainder arrives as claims.
- **Buying 10% more** costs 11,030 USDC and 100 NVDA. The vault splits 1,030 USDC into 1,030 USDC⁺ and 1,030 USDC⁻ and keeps the USDC⁺. It splits 10 NVDA into NVDA⁺ and NVDA⁻ and keeps the NVDA⁻. The unneeded sides, 1,030 USDC⁻ and 10 NVDA⁺, go back to the depositor.

Check the deposit in the cut world. The depositor paid 11,030 USDC plus 100 NVDA worth Y each. They got a share of the vault worth 10,000 + 1,030 + 90·Y, plus 10 NVDA⁺ worth 10·Y. The totals are equal, and the same holds in the no-cut world.

This has four consequences:
- **Nothing is priced.** No oracle, no probability and no keeper input enters share accounting, so none of them can be manipulated to move value between depositors.
- **Timing can't extract value.** A depositor who knows the outcome early gains nothing by entering or leaving around resolution: they buy exactly what they pay for, in every world.
- **Rounding always favours the vault.** Deposits round up and withdrawals round down.
- **The inflation attack has nothing to work with.** The first deposit, the admin's, locks 1,000 shares forever, as Uniswap V2 does, and later deposits pay for whole shares.

On the web, the vault page shows what one share holds, and every deposit or withdrawal shows the claims it will return.

### Quoting is bounded on chain

The keeper can only call `update(market, cancels, places)`, which posts **passive** orders. They never take liquidity and are never immediate-or-cancel. The vault owns them. Every new order must:
- sit within the market's **band** around the Chainlink price of the stock token (for example 10%),
- accept at most the vault's **fee cap**,
- expire within the **order lifetime** (minutes) and before the market's **cutoff buffer**,
- stay under the **per-order** notional cap.

After each update, the whole market must pass three checks:
- the **resting notional** cap,
- no vault bid at or above a vault ask on the same branch,
- the **worst-case imbalance** cap: YES-minus-NO stock, counting every resting order as filled.

When a cap is cut, or a claim donation pushes the position past it, the vault accepts only orders that shrink the position.

Everything else is permissionless or held by a separate role:
- Anyone can **settle** a resolved market: its orders are released, its claims redeemed, and it is dropped from the vault.
- The **guardian** pauses deposits and quoting. The pause also invalidates every resting vault order at once.
- **Withdrawals are never paused.** The admin may rate-limit net outflow per day, but never below 10% of supply.
- A vault holds at most 8 markets and 48 orders, so every loop is bounded.

**What the keeper is trusted with.** Within those bounds the keeper chooses prices. A compromised keeper key could trade against an accomplice at the edges of the band, up to the caps, until the guardian pauses. The defenses:
- keep bands tight,
- keep the keeper key in its own wallet holding only `KEEPER_ROLE` (the service refuses to run a key that also holds admin or curator rights),
- monitor the vault, and pause on anomalies.

### Roles

| Role | Can | Cannot |
|---|---|---|
| Admin | Grant and revoke roles, set deposit caps and the withdrawal limit, unpause. Its transfer is two-step with a delay. | Touch holdings or block withdrawals |
| Curator | Add and remove markets (only markets holding no claims), set each market's band, caps and cutoff buffer, set order limits | Quote or move funds |
| Keeper | Post and cancel quotes, merge paired claims | Leave the on-chain bounds |
| Guardian | Pause (invalidating every quote), cancel every quote | Unpause |

### The keeper

The keeper implements §2 with one refinement. The depth κ scales with the vault: δ̂ moves by `impactBps` per 1% of the vault's stock inventory that it is long or short between the worlds. Deposits and withdrawals scale positions and inventory together, so they never move the price. Only fills do.

Each cycle, per market, it:
1. **Reads the inputs.** Spot comes from Pyth and p from Polymarket, through the API. The vault's holdings, exposure and limits come from the chain, and the book from its own replica of the exchange.
2. **Prices the two branches.** δ̂ = δ₀ − impact × (YES − NO stock) ⁄ inventory, bounded by `maxGapBps`. Then Y = s(1 + (1−p)δ̂) and N = s(1 − pδ̂).
3. **Sets the half-spread.** It is the largest of a floor and the sum of the maker fee edge, an adverse-selection margin, twice the recent price movement, and the probability uncertainty (Polymarket spread × |δ̂|). It widens up to 3× over the last day before quoting stops.
4. **Builds ladders on both branches.** Each quote stays a margin inside the vault's band, never crosses other traders' orders, and fits the per-order, resting and imbalance caps. Quotes are funded from the branch's claims first, which nets the vault's unpaired positions, and from plain credit after, keeping a withdrawal reserve free.
5. **Diffs and sends.** It compares the ladders with the resting quotes and sends a single atomic `update`.

The market's quotes are pulled when any of these holds:
- a reference is stale,
- the price and the probability were observed too far apart,
- Pyth and the vault's Chainlink price disagree,
- the price or probability jumped (a cooldown follows),
- the issuer paused the token,
- the market is near cutoff or closed,
- the vault is paused,
- the **consistency breaker** fires: other traders' books imply a probability far from Polymarket's, where p = (s − N) ⁄ (Y − N) from their branch mid-prices.

A vault-wide **drawdown latch** halts all quoting until an operator clears it. It compares the vault's holdings per share with a daily checkpoint, **both marked at the same current prices**, so stock moves, deposits and withdrawals never count; only trading losses do.

Resolved markets are settled promptly. Paired claims are merged back into credit.

**v2: fully on-chain.** Traders would swap directly against a contract that reads Pyth. The hard part is still a trustworthy on-chain probability feed, since no production one exists. In v1 the keeper supplies p off-chain, and the vault bounds what it can do with it.

**Safeguards**:
- **Time alignment.** Implemented as a maximum skew between the Pyth publish time and the Polymarket observation time.
- **Consistency breaker.** Implemented as above.
- **Staleness limits.**
  - The keeper quotes only from references a few seconds to minutes old.
  - On chain, the Chainlink check is a sanity bound, not a freshness source. Equity feeds update only on a 0.5% move or a 24-hour heartbeat, and not at all while markets are closed, so the vault's oracle age must exceed a day.
  - The keeper stops quoting outside market hours because its Pyth reference goes stale.
- **Hard limits.**
  - The imbalance cap per event, the δ̂ bound, and the cutoff buffer.
  - Widening spreads and faster δ̂ moves near resolution.

## 10. What the backtest must answer

Historically, conditional markets didn't exist, so Δ was never observed. It can be reconstructed from the identity in §1:
- **Between news:** when news hits, spot moves by Δ × (change in p). So ds/dp during news bursts gives Δ over time. This is the Snowberg-Wolfers-Zitzewitz method.
- **At resolution:** the stock jumps by (1−p)·Δ if E happens, or −p·Δ if not. That jump pins down the final Δ.

**Data:** 50–100 past events with Polymarket or Kalshi price history, plus minute-level equity data (including pre- and after-hours). A mix:
- Fed decisions
- tariff announcements
- the 2024 election
- FDA decisions
- merger court rulings
- mega-cap earnings

**The questions, in order of importance:**
1. **How volatile is Δ, and how jumpy?** This decides the 1/1,600 claim. We want the distribution of Δ moves by hour and day, and how often moves are large.
2. **Oracle lead-lag.** Who moves first on news, Polymarket or the stock? By how much and for how long? This sets the staleness limit and the loss to latency arbitrage.
3. **Out-of-hours exposure.** What share of event news lands while equity feeds are stale (weekends, overnight)?
4. **Probability bias.** Polymarket prices carry the favorite-longshot bias. A p that's off by δp misprices both branches by about Δ·δp. How much can a trader who knows better extract?
5. **Resolution damage.** With a given q cap, what's the worst per-event loss at the resolution jump?
6. **Does it pay?** This needs a flow model: an informed/uninformed mix, with uninformed volume scaled from the events' actual Polymarket volume. Output the LP return distribution per event and in aggregate, and sweep κ, spread and q caps.
7. **Baselines.** Run the same flow through two constant-product pools, and through our current fixed-gap market maker.

**Pass criteria (proposed):**
- LPs are net positive after hedging on most events.
- The worst single event loses less than a set fraction of vault TVL.
- Δ-LVR is at least ~10× lower than the constant-product baseline, not just the theoretical 1,600×.

## 11. Where it could fail
- **Events with huge, jumpy Δ.** A small-cap biotech facing an FDA decision can move ±50%. There, the vault needs a small κ or should sit out. Merger targets have a large but stable Δ (offer price vs fallback), which suits the vault well.
- **Polymarket as a single point of dependence.** If its market is thin or manipulated, p is wrong. The consistency breaker and a median across sources mitigate this.
- **Model simplifications.** No interest carry until resolution, and no dividends. Both are small corrections, but they belong in v1's pricing.
- **Originality.** The design comes from our research, not a peer-reviewed paper. The math needs an independent review before real money goes in.

## 12. Operating a vault

1. **Deploy.** Run `bun run deploy:vault` with the stock token, its Chainlink feed, and dedicated admin, curator, keeper and guardian addresses. On Base, the sequencer-uptime feed is pinned. The script prints the admin's calls: the three role grants and, optionally, the deposit caps.
2. **Configure.** The curator sets the order limits: lifetime, oracle age (above a day for equity feeds) and fee cap. Then, for each event, it adds the market with its band, per-order and resting caps, imbalance cap and cutoff buffer, in the admin console under Vault controls.
3. **Seed.** The admin makes the first deposit, which sets the vault's initial USDC/NVDA ratio and locks 1,000 shares.
4. **Run the keeper.** Use a wallet that holds only `KEEPER_ROLE`, with `VK_*` settings and one Δ-model per market (δ₀, impact, bound, size), `VK_MODE=live` and `--execute`.
5. **List it.** Add the vault to `DELTA_VAULT_ADDRESSES` (the API) and `NEXT_PUBLIC_DELTA_VAULTS` (the UIs, which never take vault addresses from the API).
6. **Incidents.**
   - The guardian pauses: deposits and quoting stop, and every resting quote is invalidated at once.
   - After review, the admin unpauses.
   - A drawdown latch in the keeper's state file stops quoting until an operator clears it.
7. **Resolution.** The keeper, or anyone, settles each resolved market. Its claims become plain credit, and the market leaves the vault.
