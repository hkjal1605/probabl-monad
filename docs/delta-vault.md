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

## 9. How we'd build it

**v1: mostly already exists.** `services/market-maker` already quotes both branches from Pyth + Polymarket, using a fixed `gapBps`, which is a hard-coded Δ.

Turning it into a Δ-Vault takes three changes:
1. Replace the fixed gap with the learning Δ̂ and the quote formula above.
2. Pool LP deposits in a vault contract whose only power is letting a keeper place orders through our existing delegation grants, within caps.
3. Post quotes into our order books with `replace`.

Order-book traders still compete on top. No new AMM contract is needed.

**v2: fully on-chain.** Traders swap directly against a contract that reads Pyth. The hard part is getting a trustworthy on-chain probability feed, since no production one exists. In v1 the keeper supplies p off-chain.

**Safeguards, needed in both:**
- **Time alignment.** Use p as it stood at the Pyth price's timestamp, so a price and a probability from different moments never mix.
- **Consistency breaker.** Our books imply their own probability, p = (s − N)/Δ̂. Halt if it drifts from Polymarket's.
- **Staleness limits.** Max oracle age of a few seconds. Widen spreads or pause when the equity market is closed.
- **Hard limits:** caps on q per event, bounds on Δ̂, and pausing near resolution.

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
