# Liquidity-bootstrapping mechanisms for Probabl's event-conditional stock markets: a "does it actually work" analysis (October 2026)

Simulation scripts and raw outputs (Python 3, stdlib only, run with `python3 -I`) are in
`mechsim/`:
`s1_bonding_curve.py` → `s1_out.txt`, `s2_cpmm_pair.py` → `s2_out.txt`, `s3_static_curves.py` → `s3_out.txt`,
`s4_mc.py` → `s4_out.txt` + `s4_out_extra.txt` + `s4_out_decomp.txt`, `s5_events.py` → `s5_out.txt`.
They are cited below as [S1]…[S5]. Derivations that are mine (not from a source) are under Inferences.

Common calibration used throughout unless stated otherwise: stock price s = $100, half-spread or fee h = 30 bp, and
**equal depth**: a $10k single-leg trade costs ≤ 1% all-in (0.7% average impact plus 30 bp), i.e. a marginal log impact
of k = 1.4×10⁻⁴ per share, or depth D = 1/k ≈ 7,143 shares per unit of log price [S3](mechsim/s3_out.txt).

## 1. What is the state space, and what does a liquidity mechanism actually have to discover?

### Takeaway
With spot s and probability p supplied from outside, each market has exactly one undiscovered number: the conditional gap δ = (Y−N)/s. A mechanism "discovers both legs" if it discovers δ while respecting p·Y + (1−p)·N = s. A pool that learns Y and N separately carries risk on the stock's whole volatility. A curve anchored to s and p carries risk only on δ, plus oracle error. That one choice decides most of the ranking below.

### Cited Findings
- Splitting is exact: 1 stock = 1 YES-stock + 1 NO-stock and 1 USDG = 1 YES-USDG + 1 NO-USDG. Each branch's book quotes its stock claim in that branch's quote claim (Y in YES-USD, N in NO-USD). "Once you know s and p, the only thing left to discover is Δ" (Δ = Y−N), with Y = s + (1−p)Δ and N = s − pΔ — [docs/delta-vault.md §1](file:///Volumes/T9/probabl/docs/delta-vault.md)
- A buy funded with whole quote tokens receives the opposite branch's claim of what it paid, so every claim stays backed 1:1. Trading moves ledger entries only — [README.md](file:///Volumes/T9/probabl/README.md); `_settleTaker`/`_fill` in [ConditionalStocks.sol](file:///Volumes/T9/probabl/contracts/src/ConditionalStocks.sol)
- The keeper already prices exactly this model. δ̂ = anchor − impact × (YES−NO stock imbalance)/inventory, bounded by `maxGapBps`; Y = s(1+(1−p)δ̂) and N = s(1−pδ̂) — [services/vault-keeper/src/model.ts](file:///Volumes/T9/probabl/services/vault-keeper/src/model.ts). Default model: `impactBps` 10 (δ moves 10 bp per 1% of inventory), `maxGapBps` 800, `orderQuote` "2000" — [config.example.json](file:///Volumes/T9/probabl/services/vault-keeper/config.example.json)
- Oracles available: Chainlink 24/5 US-equity Data Streams cover regular, pre-market, post-market and overnight sessions, carry market-status flags, and note "no trading activity in traditional markets over the weekend on any venue" — [Chainlink docs](https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide); launched January 2026 — [The Block](https://www.theblock.co/post/386387/chainlink-24-5-onchain-data-streams-tokenized-us-stocks-etfs). Robinhood Chain mainnet (July 1, 2026) runs Chainlink Data Streams, Data Feeds and CCIP for its stock tokens — [Genfinity](https://genfinity.io/2026/07/01/robinhood-chain-mainnet-launch-chainlink-oracle-integration), [Robinhood docs](https://docs.robinhood.com/chain/oracles-and-price-feeds)
- Chainlink push feeds for equities update only on a 0.5% move or a 24 h heartbeat, and not at all while markets are closed. The vault therefore uses them only as a sanity band — [docs/delta-vault.md §9](file:///Volumes/T9/probabl/docs/delta-vault.md)
- No on-chain or cross-chain feed of Polymarket probabilities was found. Polymarket uses Chainlink, and UMA for disputes, to *resolve* price markets on Polygon — [The Block](https://www.theblock.co/post/370444/polymarket-turns-to-chainlink-oracles-for-resolution-of-price-focused-bets). The repo's v2 note agrees: "no production [on-chain probability feed] exists" — [docs/delta-vault.md §9](file:///Volumes/T9/probabl/docs/delta-vault.md)

### Inferences
- **Sensitivities** (derived from Y = s(1+(1−p)δ), N = s(1−pδ)):

  | | ∂/∂s | ∂/∂p (s, δ fixed) | ∂/∂δ |
  |---|---|---|---|
  | Y | Y/s | −sδ | s(1−p) |
  | N | N/s | −sδ | −sp |

  The decomposition that matters is ds = (Y−N)·dp + p·dY + (1−p)·dN. **Event news moves s, not Y and N:** if δ (in $ terms) is unchanged, a p move shifts spot by Δ·dp and leaves both branch prices unchanged. The −sδ in the table holds only if s is held fixed. It therefore applies to an oracle-anchored curve whose s and p readings are *out of sync*, not to a pool.
- **Static no-arbitrage band** without Polymarket: min(Y,N) ≤ s ≤ max(Y,N). If both legs are below s, buy both with max(Y,N) of whole USD, merge, and sell the stock. If both are above s, buy stock, split, and sell both legs. The equality p·Y + (1−p)·N = s needs a hedge of the leftover |Y−N| branch-USD claims with the matching Polymarket share (both pay $1 on the same outcome). Cross-chain hedging costs set its width. Numbers are in [S1](mechsim/s1_out.txt).
- **Stock-numeraire view.** Let p_s = p·Y/s, the stock-measure probability: the price in stock of a claim paying 1 stock if YES. Then δ = (p_s − p)/(p(1−p)). The product is two binary markets: one in USD, whose price p Polymarket already discovers, and one in stock (p_s). The branch books trade the ratio of the two. This is why LMSR-style makers fit badly (§5).
- **Three possible anchorings, giving the mechanism families compared below.** (A) No oracle: learn Y and N (pools). (B) Anchor on s, learn p and δ. (C) Anchor on s and p, learn only δ. Each extra oracle removes one source of arbitrage loss and adds one trust or latency dependency.
- **Risk per mechanism at equal depth D, per unit time, in today's dollars** (derived; the YES branch is weighted by p, NO by 1−p):
  - A: ½·D·s·σ² (LVR, the Milionis et al. formula)
  - B: ½·D·s·δ²·Var(dp), which totals ½·D·s·δ²·p₀(1−p₀) over the event, because a martingale ending in {0,1} has quadratic variation p₀(1−p₀)
  - A, B and C alike: ½·D·s·p(1−p)·σ_δ²
  - C only: oracle-error terms

### Gaps
- σ_δ (how much δ itself moves) has never been measured. The repo says so ([docs/delta-vault.md §6, §10](file:///Volumes/T9/probabl/docs/delta-vault.md)), and every LP-loss number below scales with it, so I sweep it (5%–50%/√yr plus jumps).
- I found no source on whether Chainlink Data Streams for equities, or Pyth equities, are live on **Base**. I confirmed only Robinhood Chain.

## 2. Candidate 1: pump.fun-style bonding curve per branch

### Takeaway
It does not fit. pump.fun works because its token is minted from nothing and has no outside price. A YES-stock claim has to be backed by a real share, and its price is pinned to s and p by split/merge and Polymarket arbitrage. A curve that starts low is drained to fair value at once: from 9% of its inventory value at half price to 47% at a tenth of fair value. It discovers nothing except δ, and it leaves the operator holding an unhedged NO-stock event bet.

### Cited Findings
- pump.fun's curve is a virtual-reserve constant product: about 30 virtual SOL against about 1.073B virtual tokens, real token reserve about 793M, real SOL starting at 0, opening price about 2.8×10⁻⁸ SOL. It graduates at about 85 SOL of real reserves (one source frames it as about $69k market cap) and migrates to PumpSwap or Raydium. These are third-party guides, not official documentation, and they disagree on the graduation trigger — [madeonsol](https://madeonsol.com/blog/solana-bonding-curves-explained), [skills.sh summary](https://skills.sh/sendaifun/skills/pumpfun)
- A virtual CPMM started at P₀ and arbitraged to fair Y* = 103 (s = 100, p = 0.4, δ = 5%) hands over X·(√Y* − √P₀)² YES-USD [S1](mechsim/s1_out.txt):

  | P₀ | claims sold | giveaway (YES-USD) | today's $ | % of the $100k backing |
  |---|---|---|---|---|
  | 1 | 90% | 83,702 | 33,481 | 33.5% |
  | 10 | 69% | 48,813 | 19,525 | 19.5% |
  | 50 | 30% | 9,473 | 3,789 | 3.8% |
  | 90 | 6.5% | 438 | 175 | 0.2% |
  | 103 | 0 | 0 | 0 | 0 |

- With P₀ = 50 and the NO book at N* = 98, the arbitrage is riskless: pay 98 whole USD, merge, sell the stock for +$2, and keep 48 YES-USD worth $19.20. Total +$21.20 per share [S1](mechsim/s1_out.txt)
- Backing: seeding the curve with 1,000 real YES-stock claims means splitting 1,000 shares. That leaves 1,000 NO-stock worth (1−p)·N = $58.8 each today, a $58,800 unhedged event bet unless a NO curve sells them. A NO curve turns the design into the split-seeded pair of §3 [S1](mechsim/s1_out.txt)

### Inferences
- **Who sells the first YES-stock claim?** Only someone who splits a real share: an LP, the vault, or a router that buys stock on spot. The curve cannot create supply, and supply is elastic at the arbitrage band. A curve with a fixed supply is therefore undefined here, and there is nothing to "graduate".
- What survives is the *curve* idea, applied to the one unknown. A bonding curve in δ-space, centred on a prior δ₀, is candidate 3. Its useful pump.fun-like property is that early trades move the price cheaply. This can be built in with a liquidity-sensitive slope that deepens as volume and fees accrue, as LS-LMSR does (§5).
- Manipulation: sniping at launch is the only "game" left, and it is pure value extraction from the seeder.

### Gaps
- None material. The verdict follows from the backing constraint and the arbitrage band, not from any parameter.

## 3. Candidate 2: split-seeded conditional CPMM pair (MetaDAO-style), full-range and concentrated

### Takeaway
It works and needs no oracle at all. It is the only fully trustless option, and it discovers both legs by arbitrage. But it is capital-hungry. For ≤ 1% all-in on $10k it needs $2.86M of capital at full range, or $250k–$350k concentrated in ±20–30% (a ±20% range is exited in 26% of 30-day events). It also loses about 50× more to arbitrage than the δ-curve at equal depth: −$2.3k vs −$45 per 30-day event in the Monte Carlo. Event news costs it nothing; overnight and weekend gaps cost it most.

### Cited Findings
- MetaDAO "takes half of its liquidity from the spot (e.g. META/USDC) market and moves it into a proposal's conditional markets". It settles on a *lagging-price TWAP*: an observation can move at most a fixed amount per update (example: $5/minute), and recording starts after a 24 h delay — [MetaDAO: Trading Proposals](https://docs.metadao.fi/governance/markets.md), [MetaDAO: Finalizing Proposals](https://docs.metadao.fi/governance/twaps.md). Secondary sources (search summaries, not verified against MetaDAO's code) say the futarchy AMM unifies spot liquidity with pass/fail markets and self-arbitrages, with 25 bp to MetaDAO and 25 bp to LPs. I could not date the switch from OpenBook books — [Lehran Brothers](https://lehranbrothers.substack.com/p/what-the-futarchy), [Gecgin](https://gecginserhat.substack.com/p/deep-dive-into-futarchy-and-meta)
- The repo's research found that "MetaDAO had to borrow half of its spot liquidity to keep its conditional markets alive" — [docs/future-improvements.md](file:///Volumes/T9/probabl/docs/future-improvements.md)
- LVR: instantaneous ℓ(σ,P) = ½σ²P²·|x*′(P)|. For a constant-product pool ℓ/V = σ²/8. A range position has the same ℓ for the same L but a lower V, so "the instantaneous LVR per dollar of pool reserves can be arbitrarily high … if the liquidity range is sufficiently narrow" — Milionis, Moallemi, Roughgarden, Zhang, [arXiv 2208.06046](https://arxiv.org/abs/2208.06046)
- With fees γ and Poisson blocks at rate λ: P_trade = 1/(1 + √(2λ)·γ/σ), ARB ≈ LVR × P_trade and FEE ≈ LVR × (1 − P_trade). The paper's own table (σ = 5% daily, 30 bp fee) gives 5.4% at 2 s blocks and 49.6% at 10 min — Milionis, Moallemi, Roughgarden, [arXiv 2305.14604](https://arxiv.org/abs/2305.14604)
- Average impact of one buy, full-range split-seeded pair, where capital C becomes quote reserve R = C/2 on **both** branches [S2](mechsim/s2_out.txt):

  | trade | C = $50k | $250k | $1M | $5M |
  |---|---|---|---|---|
  | $1k | 4.0% | 0.8% | 0.2% | 0.04% |
  | $10k | 40% | 8.0% | 2.0% | 0.4% |
  | $100k | 400% | 80% | 20% | 4.0% |

- Capital for ≤ 1% average impact on $10k (fees excluded), with LVR per $ of capital per year [S2](mechsim/s2_out.txt):

  | range | efficiency factor | capital | LVR/yr per $ (σ = 30% / 45% / 60%) | P(range exited in 30 days) |
  |---|---|---|---|---|
  | full | 1.0 | $2.00M | 1.1% / 2.5% / 4.5% | 0 |
  | ±30% | 8.1 | $246k | 9.2% / 20.6% / 36.6% | 6.7% |
  | ±20% | 11.5 | $174k | 12.9% / 29.1% / 51.6% | 25.9% |
  | ±10% | 21.5 | $93k | 24.2% / 54.4% / 96.7% | 76.3% |
  | ±5% | 41.5 | $48k | 46.7% / 105% / 187% | 99.1% |

  With fees included (≤ 1% all-in at 30 bp), the capital is $2.86M full-range, $351k at ±30% and $249k at ±20% [S3](mechsim/s3_out.txt)
- Before fees, LVR at the 1%-on-$10k depth: $22.5k/yr ($1.8k per 30 days) at σ = 30%, $50.6k/yr ($4.2k) at 45%, $90k/yr ($7.4k) at 60%. At 45% that takes $1.39M of volume per 30 days at 30 bp to cover [S2](mechsim/s2_out.txt). At the slightly deeper all-in calibration: $2.6k / $5.9k / $10.6k per 30 days [S3](mechsim/s3_out.txt)
- P_trade for equity volatility in open hours, from the formula above: σ = 45% gives 5.1% (2 s blocks, 30 bp), 11.6% (12 s) and 22.7% (60 s) [S2](mechsim/s2_out.txt)
- Monte Carlo at equal depth (30-day event, 1-minute arbitrage, 30 bp fee, perfectly informed arbitrageurs) [S4](mechsim/s4_out.txt), [S4 decomposition](mechsim/s4_out_decomp.txt):
  - Informed flow only: −$2,297 ± 30 (p5 −$3,201).
  - Removing every δ move: still −$2,291. Removing gaps (all variance intraday): −$1,361.
  - High-δ event (δ = 20%): unchanged ($4.4k with noise flow), confirming that p and event news do not hurt the pair.
- At resolution, LP payoff = the winning pool's reserves (real stock + USD at S_T); the losing pool pays 0 [S2](mechsim/s2_out.txt)

### Inferences
- **LP payoff:** LP = p·(CPMM LP on YES, seeded at Y₀) + (1−p)·(CPMM LP on NO, seeded at N₀). Ex post, trades in the losing pool do not matter at all. Split-seeding gives each branch R of depth from 2R of capital, half what two independent pools would need.
- **p jumps:** at fixed s, dY/dp = dN/dp = −sδ. But the pools do not use s. When news moves p, s moves by Δ·dp and Y*, N* stay where they were, so the pools are not stale and lose nothing. The Monte Carlo agrees: A's arbitrage loss is the same at δ = 5% and δ = 20%.
- **LVR source:** what the pair loses to is the stock's *non-event* volatility, with σ_Y ≈ σ_N ≈ σ_stock. The pair arbitrage behind it (buy both cheap legs, merge, sell spot) is close to riskless, so the full LVR applies. About 40% of the simulated loss comes from overnight and weekend gaps (25% of variance in the model). Faster blocks cannot shrink that part. Scaling the intraday part by the 2 s / 60 s P_trade ratio (≈ 0.22), A's informed-flow loss on Base would still be about −$1.5k per event (my estimate).
- **Resolution:** the pair is robust to surprise resolutions. The winning pool is already at Y* (if δ was right), and claims in the losing pool become worthless on both sides.
- **Manipulation:** large curve trades can be sandwiched, as with any CPMM; that needs tight slippage limits. If a pool price is ever used as an oracle (Δ data product, consistency breaker), it needs MetaDAO-style lagging TWAPs.
- **Fit with the exchange:** the pools can live in a separate contract that holds claims through the exchange ledger (no extension needed; settlement as in §8). But claims are market-specific, so capital is per market. The vault's stock inventory, by contrast, is shared across up to 8 events of one stock.

### Gaps
- Depth of spot stock-token liquidity on Base and Robinhood Chain DEXes, which the pair arbitrage needs, especially when the stock market is closed. Not found.
- Arbitrage on Robinhood Chain: block time and ordering were not checked.

## 4. Candidate 3: oracle-anchored δ-curve (a bonding curve in δ-space), and the variant without a p oracle

### Takeaway
This is the right mechanism, and Probabl already runs it off-chain as the Δ-vault keeper. At equal depth, informed flow costs it about −$45 per 30-day event against −$2.3k for the CPMM pair. A $10k fill needs only about $20k of deliverable inventory, and about $100k per stock covers caps. Its real risks are oracle freshness and synchronization. In simulation, a 5-minute-stale s costs about $5k per event, and trading through closed hours with live p and frozen s halves LP profit. It must halt when the equity feed is not live, and on high-δ events it needs fresh p. A variant that learns p from flow (no p oracle, family B) does almost as well on small-δ scheduled events but breaks on large-δ or surprise resolutions.

### Cited Findings
- Repo design: LPs hold only δ risk. Δ-LVR per year = ½·σ_Δ²·p(1−p)·κ, illustrated as about 1/1,600 of a constant-product pool's. The doc adds: "That number depends entirely on σ_Δ, which nobody has ever measured" — [docs/delta-vault.md §5–6](file:///Volumes/T9/probabl/docs/delta-vault.md)
- Keeper defaults: half-spread floor 40 bp, adverse selection 20 bp, 2 levels per ladder, 25 bp level spacing, reprice at 15 bp, TTL 300 s, poll 10 s, max feed age 30 s, max s/p skew 15 s. Pull quotes on a 3% price jump or an 8-point p jump (60 s cooldown); 300 bp drawdown latch — [config.ts](file:///Volumes/T9/probabl/services/vault-keeper/src/config.ts). The ladder budget is min(orderQuote, maxResting/4) per ladder, split across levels — [model.ts](file:///Volumes/T9/probabl/services/vault-keeper/src/model.ts)
- On-chain vault bounds: each order sits within `bandBps` of the Chainlink price (≤ 5,000), lives ≤ `MAX_TTL` (1 day), and the oracle age is ≤ `MAX_ORACLE_AGE` (3 days). Per-order, resting and worst-case-imbalance caps; at most `MAX_MARKETS` = 8 markets and `MAX_ORDERS` = 48 orders per vault — [DeltaVaultBase.sol](file:///Volumes/T9/probabl/contracts/src/vault/DeltaVaultBase.sol), [DeltaVaultAdmin.sol](file:///Volumes/T9/probabl/contracts/src/vault/DeltaVaultAdmin.sol). A taker fills at most `MAX_MAKERS` = 8 makers per placement — [ConditionalStocksBase.sol](file:///Volumes/T9/probabl/contracts/src/ConditionalStocksBase.sol)
- Prior art for oracle-anchored pricing:
  - DODO PMM: P = i(1 − k + k(B₀/B)²) when base is short; k = 1 is a standard AMM curve and k = 0 a fixed price at i — [DODO docs](https://docs.dodoex.io/en/product/pmm-algorithm/details-about-pmm)
  - GMX v2 price impact: impact = f(initial imbalance) − f(next imbalance) with f(d) = d^exponent·factor. Trades that reduce the imbalance can get a positive rebate. These are secondary sources, not verified against the contracts — [eth_defi docs](https://web3-ethereum-defi.readthedocs.io/api/gmx/_autosummary_gmx/eth_defi.gmx.market_depth.estimate_position_price_impact.html), [Cyfrin](https://updraft.cyfrin.io/courses/gmx-perpetuals-trading/trading/price-impact-formula)
  - Overtime: oracle odds via Chainlink plus a 2% protocol fee. Each market has a "risk limit" past which the AMM stops quoting that side until opposite flow arrives. After OIP-265 (June 2026) the treasury is the **sole LP** — [Overtime docs](https://docs.overtime.io/learn-about-overtime/overtime-amm-and-liquidity-mechanics.md)
  - Lifinity: oracle (Pyth) pricing with "delayed rebalancing". Marketing-level sources only — [Trust Wallet](https://trustwallet.com/blog/explore-solana-defi-with-lifinity)
- All-in cost of a YES buy on the δ-curve in keeper units (p = 0.5, h = 30 bp; C = vault capital, half in stock) [S3](mechsim/s3_out.txt):

  | impact (bp of δ per 1% inventory) | C | $1k | $10k | $100k |
  |---|---|---|---|---|
  | 10 | $100k | 0.35% | 0.80% | n/a (> inventory) |
  | 10 | $250k | 0.32% | 0.50% | 2.30% |
  | 10 | $1M | 0.30% | 0.35% | 0.80% |
  | 25 | $250k | 0.35% | 0.80% | 5.30% |
  | 50 | $1M | 0.33% | 0.55% | 2.80% |

- At the ≤ 1%-on-$10k target, κ = 3,571 shares per unit of δ for any vault size; only the impact parameter changes (≤ 7/14/35/140 bp per 1% for C = $50k/$100k/$250k/$1M). One-leg discovery cost 0.5·p(1−p)·s·κ·ε² is $4 / $18 / $112 / $446 for ε = 1/2/5/10% [S3](mechsim/s3_out.txt)
- Risk sources per 30-day event at equal depth (today's $) [S3](mechsim/s3_out.txt):
  - **δ-LVR (all mechanisms):** $3 (σ_δ = 2%/√yr), $18 (5%), $294 (20%), $1,835 (50%). One δ jump of 5% costs $223; of 10%, $893.
  - **p-learning LVR (family B only, to full resolution):** $36 (δ = 2%), $223 (5%), $893 (10%), $3,571 (20%), $14,286 (40%).
  - **CPMM stock LVR, for comparison:** $5,944 at σ = 45%.
- p-error sensitivity of C: both legs are mispriced by δ·dp. That exceeds the 30 bp spread only if δ·dp > 0.3% (δ = 5% needs dp > 0.06; δ = 20% needs dp > 0.015). One stale-p or manipulation episode yields 0.5·D·s·(δ·dp − h)² per leg: $1 (δ = 5%, dp = 0.10), $489 (20%, 0.20), $2,118 (40%, 0.20) [S3](mechsim/s3_out.txt)
- Monte Carlo, LP alpha per 30-day event at equal depth, mean ± standard error (p5 in brackets) [S4](mechsim/s4_out.txt), [S4 extra](mechsim/s4_out_extra.txt), [S4 decomposition](mechsim/s4_out_decomp.txt). World model: σ = 45%, σ_δ = 5%/√yr plus one 2% jump per event, start error 2%, p₀ = 0.5, Gaussian-score p, $150k/day of $3k noise trades, halt while the market is closed, 300 paths. A = CPMM pair (no oracle), B = s-anchored and learns p and δ, C = δ-curve (s and p oracles).

  | scenario | A: CPMM pair | B: s-anchored | C: δ-curve |
  |---|---|---|---|
  | base | 4,434 ± 36 (3,340) | 6,617 ± 17 (6,102) | 6,414 ± 18 (5,911) |
  | informed flow only | −2,297 ± 30 (−3,201) | −121 ± 7 (−334) | −45 ± 4 (−152) |
  | informed only, no δ moves | −2,291 | −70 | 0 |
  | noise $50k/day | −45 ± 36 | 2,160 ± 11 | 2,133 ± 9 |
  | high δ (20%, start error 5%) | 4,413 | 4,869 ± 97 (2,066) | 6,317 ± 23 (5,670) |
  | jumpy δ (σ_δ 50%, 3 jumps of 5%) | 2,570 (657) | 4,760 (159) | 5,105 (3,721) |
  | s-oracle lag 1 min | 4,487 | 6,513 | 6,207 (5,579) |
  | s-oracle lag 5 min | 4,515 | 2,360 (−225) | 1,068 ± 114 (−2,516) |
  | p-oracle lag 5 min | — | — | 6,307 |
  | p-oracle lag 5 min, high δ | 4,308 | 4,880 | 2,385 ± 197 (−4,038) |
  | p bias +3 pts | — | — | 6,424 |
  | trading while closed: live p, frozen s | 4,420 | 4,172 (1,850) | 2,831 ± 120 (−1,300) |
  | trading while closed: frozen s and p | 4,476 | 4,256 | 3,355 (−197) |
  | trading while closed, high δ | 4,321 | 2,443 (−1,349) | −1,475 ± 278 (−11,132) |
  | C with deep full-set side (μ = 0.1k) | — | — | 6,188; with 1-min lag 5,653 |
  | p₀ = 0.2 | 4,537 | 6,684 | 6,132 |

- Max claims inventory per leg over 300 paths (worst path): B 798, C 486 shares in the base case; C 2,083 with jumpy δ; C 1,930 with a deep full-set side [S4](mechsim/s4_out.txt)
- If the outcome is announced while the curve still trades, B (or C with stale p) loses 0.5·D·s·(mispricing − h)², capped at 1,000 shares. Expected loss: $18 (δ = 2%, p = 0.5), $173 (5%), $791 (10%), $3,393 (20%), $12,973 (40%). C with fresh p and A lose $0 [S5](mechsim/s5_out.txt)

### Inferences
- **Price discovery of both legs:** a YES buy raises δ̂, so Y rises by s(1−p)λq and N falls by s·p·λq. A NO buy does the reverse, and a balanced pair (buying stock) leaves δ̂ unchanged. p·Y + (1−p)·N = s holds at the mid by construction. C imposes Polymarket's p. If Probabl's traders disagree with Polymarket, only the CLOB layer (pros) can express it. That is acceptable given Polymarket's depth, and the keeper's consistency breaker already watches for it.
- **No LVR from s:** quotes move with the oracle, so an s move is never "picked off" — subject only to oracle staleness. With fresh oracles the Monte Carlo shows exactly $0 loss when δ never moves.
- **Full-set skew:** a curve with no impact for full-set (stock) trades has infinite depth at s ± h. Every bit of oracle staleness is then exploitable up to the inventory caps. Keep a full-set skew of the same order as the per-leg depth (DODO's k > 0). The cost: after an oracle catch-up the skew is itself mispriced and gets arbitraged back, so the effective penalty for staleness is roughly doubled. That is why the 5-minute-lag scenario hurts C more than B.
- **Oracle latency is the dominant risk.** It is negligible with pull oracles (≤ 10 s: < $1 per day at this depth in S3) or 1-minute freshness (−$200 per event in S4). It is severe at 5 minutes (−$5.3k). The existing keeper's quotes can live 300 s, repricing at 15 bp moves on a 10 s poll, which puts it between the 1-minute and 5-minute cases.
- **Closed hours:** halting is clearly better than trading on frozen references. Chainlink's 24/5 streams cover overnight sessions, so on equity names only weekends and exchange holidays need halts.
- **Slope choice:** discovery cost and slippage are the same trade-off at fixed depth. To make "cost to move δ by x" meaningful without more slippage, use the half-spread (each round trip pays 2h), per-block size caps, and a liquidity-sensitive slope: steep in the first hours, deeper as volume and fees accrue, in the spirit of LS-LMSR. Do not add a decay of δ̂ toward the prior: that repeatedly forgets real information, and informed traders can harvest the decay.
- **Manipulation:**
  - (i) *Pushing δ̂:* moving δ by 2.8% costs one $10k one-leg trade. Holding it costs ½·p(1−p)·s·κ·x² per arbitrage round, so the displayed δ is cheap to nudge and expensive to hold. Anything downstream that reads δ̂ (Δ data feed, breaker) should use a lagging TWAP as MetaDAO does.
  - (ii) *p-relay manipulation* is harmless unless δ is large (S3e). Lagging p (bounded change per minute), freshness limits and the δ-scaled spread term contain it.
  - (iii) *Claim donations* move a stateless δ̂, but cost the donor at least the value moved.
  - (iv) *Sandwiches:* on a $10k trade with 1.4% marginal impact and 2h = 60 bp, a sandwich is profitable. Mitigate with tight `maxCost` limits, private order flow and per-block impact caps.
- **Without a p oracle (family B):** viable for small-δ events with a trading cutoff before announcement (Fed, earnings): within ±3% of C in the base case, and it removes the p-signer trust. Not viable for large-δ or unscheduled resolutions: an expected $3.4k one-off loss at δ = 20% on a surprise announcement, and p5 of $2k vs C's $5.7k on high-δ events.

### Gaps
- σ_δ, the jump frequency of δ, and the lead-lag between Polymarket and stock prices are unmeasured. The repo's backtest plan is still open ([docs/delta-vault.md §10](file:///Volumes/T9/probabl/docs/delta-vault.md)).
- The Monte Carlo treats arbitrageurs as perfectly informed, trading every minute, and noise traders as paying the full spread. Real flow mixes these, so absolute profits are indicative and the ranking is more robust than the levels.
- Gas cost of verifying a Chainlink Data Streams report on-chain: not found.

## 5. Candidate 4: LMSR / LS-LMSR / pm-AMM-style subsidized market maker

### Takeaway
These do not fit as the primary maker. Applied in stock numeraire (selling YES-stock and NO-stock for whole stock) the LMSR is mathematically valid, since the payoff is binary in stock units. But it sells event exposure, and its subsidy is consumed at resolution: at equal depth the worst case is $248k per market and the expected loss about $200k. Applied to the continuous branch price Y it needs bucketed claims (a product change). The pm-AMM is built for prices in p-space, which Polymarket already supplies.

### Cited Findings
- LMSR: cost function C(q) = b·log Σ e^{q_i/b}, prices = gradient (between 0 and 1, summing to 1), worst-case market-maker loss b·log N — Chen & Vaughan, [SIGecom Exchanges 2010](https://www.jennwv.com/papers/sigecom.pdf); Hanson credited with the mechanism — [Gensyn](https://www.gensyn.ai/blog/lmsr-logarithmic-market-scoring-rule)
- LS-LMSR (Othman, Sandholm, Pennock, Reeves, EC 2010) adapts to liquidity, can run at a profit, and has bounded loss for any initial liquidity, with worst-case loss approaching zero as initial liquidity does — [CMU theory lunch abstract](https://www.cs.cmu.edu/~./theorylunch/pastSemesterIndices/20100922.html), [Wang 2020 survey](https://arxiv.org/pdf/2009.01676)
- pm-AMM (Moallemi and Robinson, Paradigm, November 2024) assumes "Gaussian score dynamics". The static pm-AMM's expected LVR is a constant fraction of pool value but rises toward expiry. The dynamic pm-AMM withdraws liquidity over time to keep expected LVR constant, and "half the initial wealth is lost by the end". CPMM and LMSR suffer large LVR near prices of 0 or 1. The page extraction did not carry the formulas — [Paradigm](https://www.paradigm.xyz/2024/11/pm-amm)
- Distribution Markets (Dave White, Paradigm, December 2024): traders take function-valued positions over a continuous outcome under a constant-L2-norm invariant, with separate backing b and holdings f(x) ≤ b — [Paradigm](https://www.paradigm.xyz/2024/12/distribution-markets)
- Zeitgeist's `neo-swaps` implements an LMSR — [pm.wiki](https://pm.wiki/uk/projects/zeitgeist)
- Stock-numeraire LMSR at equal depth: b = (1−π)/k = 3,571 stock. Worst case b·ln2 = 2,476 stock ($247,553). Expected loss to informed traders up to a cutoff one day before a 30-day Gaussian-score event = b·(H(π₀) − E[H(π_c)]) = 2,006 stock ($200,621) [S3](mechsim/s3_out.txt)

### Inferences
- **Why the LMSR loses here and the exchange's books do not:** the LMSR prices p_s, the stock-measure probability, against whole stock. Its state therefore has to travel to 0 or 1 by resolution, and it pays roughly b·H(π₀). Branch-native trading (YES-stock for YES-USD) never takes the event side. The δ-curve inherits that property; the LMSR throws it away.
- **Product change needed for an LMSR on Y:** discretize S_T|YES into price buckets ("NVDA in [100,105) if YES"). That means LMSR or distribution-market claims per bucket, cash- or delivery-settled. It would replace physical delivery of the stock, which the repo calls a key advantage ([future-improvements.md](file:///Volumes/T9/probabl/docs/future-improvements.md)). Not recommended.
- **What to keep:** the bounded-loss subsidy *concept* — budget a per-market discovery subsidy, which for the δ-curve is a few hundred $ (§4) — and LS-LMSR's liquidity sensitivity (depth growing with volume).

### Gaps
- I could not fetch the pm-AMM invariant formulas or the full LS-LMSR text; only their qualitative claims are cited.

## 6. Candidate 5: opening call or batch auction

### Takeaway
It is a good complement and does not solve the problem. A uniform-price opening auction on δ (s and p read at clearing) aggregates early information fairly and removes launch sniping. It sets the δ-curve's anchor δ₀ and cuts the downstream discovery cost: from $2,009 to $14 on a merger-type event with 10 informed bidders. It adds no continuous depth. After the auction someone must still quote, so it is worth building only as an addition to the curve.

### Cited Findings
- Uniswap's Continuous Clearing Auction (launched November 13, 2025) runs on Uniswap v4. It clears block by block, bidders set a maximum price and fill only when the market clears below it, and it seeds a pool at the final clearing price. Its aim is to reduce sniping and move discovery fully on-chain; projects choose supply, starting price and duration — [The Block](https://www.theblock.co/post/378864/uniswap-continuous-clearing-auctions), [Uniswap blog](https://blog.uniswap.org/continuous-clearing-auctions)
- Opening-auction model (signal noise 4%, precision-weighted clearing, κ = 3,571 shares per unit of δ; two-leg discovery cost afterwards) [S5](mechsim/s5_out.txt):

  | informed bidders n | small-δ event (prior sd 4%): error / cost | merger or FDA (prior sd 15%): error / cost |
  |---|---|---|
  | 0 (curator's prior) | 4.00% / $143 | 15.0% / $2,009 |
  | 3 | 2.00% / $36 | 2.28% / $47 |
  | 10 | 1.21% / $13 | 1.26% / $14 |
  | 30 | 0.72% / $5 | 0.73% / $5 |

### Inferences
- The CCA design does not transfer directly: it sells a *fixed supply*, while conditional claims are elastic, created by splitting. The transferable part is a *δ-space* batch. Bids are "buy YES / sell NO up to δ_max" and the reverse. Clearing is at a uniform δ_c, and fills are settled by the vault/curve as counterparty at Y(δ_c) and N(δ_c) using the s and p of the clearing block. This answers the repo's open question of "who sets Δ's starting value" ([future-improvements.md](file:///Volumes/T9/probabl/docs/future-improvements.md)) without an auction of rights.
- **Frequent batch auctions as the continuous mechanism** (e.g. one per minute) concentrate thin flow and blunt latency races. But they cost immediacy, add a new matching engine, and still need a counterparty for imbalances. Not worth it while a curve can give immediacy.
- **Manipulation:** with few participants, bid shading and collusion can push δ_c. Mitigate by blending with the curator's prior (as in the table), by minimum participation, and by counting the vault's own demand curve.

### Gaps
- No data on how many informed participants a new Probabl market would attract at launch.

## 7. Candidate 6: just-in-time routing via spot, and pairing YES and NO buyers

### Takeaway
Routing is a hedging tool, not a liquidity source. Polymarket's MINT match creates collateral from two buyers' cash. Here the collateral is a share of stock, so even perfectly paired YES and NO buyers require buying stock on spot, and they leave an event bet of Δ per pair. With balanced but random flow, the unmatched leg reaches thousands of shares, an unhedged event-P&L standard deviation of about $52k on $150k/day of flow, and the holder of that risk is a market maker by another name. It is useful as the vault's way to extend inventory and hedge.

### Cited Findings
- Polymarket's CTF exchange has three match types: COMPLEMENTARY (buy vs sell), MINT (two buys of opposite outcomes mint a full set from collateral) and MERGE (two sells merge into collateral). One outcome token plus its complement always merges into one unit of collateral — [Polymarket ctf-exchange docs mirror](https://www.mintlify.com/Polymarket/ctf-exchange/how-it-works), [ctf-exchange-v2](https://github.com/Polymarket/ctf-exchange-v2)
- Router simulation: $3k buyers, 50 per day, 21 days, s = 100, p = 0.4, δ = 5% [S5](mechsim/s5_out.txt):

  | YES share of buyers | mean unmatched | p95 max | unmatched at cutoff | unhedged event P&L sd | stock bought on spot |
  |---|---|---|---|---|---|
  | 50% | 639 sh | 2,719 sh | 1,076 sh | $51.6k | ≥ $108k |
  | 60% | 2,752 sh | 7,321 sh | 5,502 sh | $264k | ≥ $550k |
  | 75% | 7,436 sh | 16,276 sh | 14,877 sh | $714k | ≥ $1.49M |

- A perfectly paired share leaves Δ = $5 long YES-USD against $2 of USD: +$3 if YES, −$2 if NO. The hedge is to sell 5 YES shares on Polymarket (Polygon) per pair [S5](mechsim/s5_out.txt)
- The vault already nets opposite flows automatically and "only ever holds the imbalance of branch tokens, never gross amounts" — [docs/delta-vault.md §3](file:///Volumes/T9/probabl/docs/delta-vault.md)

### Inferences
- **Residual risks:**
  - (i) The unmatched leg: event risk plus stock risk, bounded only by a cap.
  - (ii) Spot execution: buying and selling the stock token, where on-chain depth is unknown.
  - (iii) The Polymarket hedge: cross-chain (Polygon, USDC.e), not atomic, with its own spread and capital.
  - (iv) Timing: who holds the risk between legs.

  Whoever carries (i)–(iv) is acting as a market maker. The δ-curve does the pairing *with prices*: imbalanced flow moves δ̂, which invites the opposite flow. JIT routing fills at a fixed price and never rebalances.
- **Best use:** let the vault (or a curve pool) buy stock on spot to split when its stock inventory is exhausted, and hedge net event exposure on Polymarket when its imbalance cap binds. That turns hard caps into soft, priced ones.

### Gaps
- On-chain spot depth and costs for Robinhood stock tokens (and Base stock tokens) when the US market is open versus closed: no reliable source found.

## 8. Candidate 7: hybrid — keep the CLOB, add an always-quoting curve as the backstop maker

### Takeaway
This is the architecture to build. The δ-curve (§4) is the always-on backstop, and the CLOB plus maker rebates lets professionals improve on it. A router fills the better CLOB levels first and the curve for the rest. Drift (an AMM backstop behind its order book), Zeitgeist's hybrid router (a draft spec) and Overtime's oracle AMM are the precedents. It can be built beside the immutable exchange without an extension, and the first step needs no new contract at all.

### Cited Findings
- Drift routes taker orders through a JIT auction for market makers, then its on-chain limit order book, then an AMM backstop priced against the Pyth oracle. Third-party sources disagree on the AMM's exact curve and the length of the auction window — [eco.com explainer](https://eco.com/support/en/articles/14801189-drift-protocol-perps-architecture-explained), [Solana Compass](https://solanacompass.com/projects/Drift)
- Zeitgeist ZIP-8 "Hybrid CDA" (draft, revision 6): a router pallet that splits trades between the LMSR pool and the order book for the best price, with an off-chain matcher supplying order ids. Its buy call takes a max price, candidate orders and a strategy for the remainder — [HackMD ZIP-8](https://hackmd.io/NBVKUY1QT--YnotR5KUx2w)
- The exchange cannot change deployed functions. New selectors are added as delegatecall extensions activatable 14 days after proposal, reached through the admin module's fallback, so extensions do not count against the exchange runtime's size — [README](file:///Volumes/T9/probabl/README.md), [ConditionalStocksAdmin.sol](file:///Volumes/T9/probabl/contracts/src/ConditionalStocksAdmin.sol), [ConditionalStocksBase.sol](file:///Volumes/T9/probabl/contracts/src/ConditionalStocksBase.sol)
- Existing primitives a separate contract can use without an extension:
  - `deposit`, `split`, `merge`, `withdraw`
  - `transferClaim(id, branch, collateral, to, amount)`; the DeltaVault already uses it
  - `place`, and `placeFor(owner, …)` under the owner's delegation grant
  - IOC orders, makers named in a plan, at most 8 makers per placement
  - per-market maker/taker fees and a maker rebate of up to half the taker fee

  — [ConditionalStocks.sol](file:///Volumes/T9/probabl/contracts/src/ConditionalStocks.sol), [ConditionalStocksAdmin.sol](file:///Volumes/T9/probabl/contracts/src/ConditionalStocksAdmin.sol), [DeltaVault.sol](file:///Volumes/T9/probabl/contracts/src/vault/DeltaVault.sol)
- Gas per the README's Foundry table: resting claim-funded ask 119k, resting bid 124k, market buy filling one maker 85k (93k partial), eight makers 203k, cancel 34k — [README](file:///Volumes/T9/probabl/README.md)

### Inferences
- **Why a backstop curve fixes the thin-book symptom when the current setup does not.** By default the keeper posts about $2k per ladder (`orderQuote` 2000, 2 levels, 25 bp apart, half-spread ≥ 40 bp), so a $10k order cannot be filled by the vault at all. A vault quoting 8 markets × 4 ladders hits `MAX_ORDERS` = 48 at 1.5 orders per ladder, and a taker can touch only 8 makers. A curve has continuous depth, needs no per-level escrow or requote gas, and prices at trade time.
- **The honest version of the verdict:** the *pricing* mechanism (δ-curve) is already Probabl's. What is missing is (a) capital, (b) parameters sized to that capital, and (c) atomic execution at fresh prices. No new pricing mechanism beats a well-capitalized Δ-vault. Executing the same curve atomically lets it quote deeper at the same risk.

### Gaps
- Whether professional makers will actually quote inside a 30 bp curve spread at these sizes. No data.

## 9. Ranking and verdict

### Takeaway
1. **Hybrid: CLOB plus an on-chain δ-curve backstop**, phased in from today's keeper. Recommended.
2. **δ-curve alone** — the same engine, without the pro layer.
3. **s-anchored curve learning p (B)** — a fallback where p cannot be relayed; only for small-δ, cutoff-before-announcement events.
4. **Opening δ-auction** — an add-on for δ₀.
5. **Split-seeded CPMM pair** — the only oracle-free design, at 2.5–30× the capital and about 50× the arbitrage loss.
6. **JIT spot routing** — a hedging tool for the vault.
7. **LMSR family** — wrong numeraire or a product change.
8. **pump.fun curve** — does not fit.

A recommendation is justified because the δ-curve reduces slippage per dollar of risk capital by more than an order of magnitude against any no-oracle pool, keeps both legs consistent, and plugs in without touching the immutable exchange. The caveat: it still needs capital (about $100k per stock for ≤ 1% on $10k, about $1M for $100k trades) and fresh oracles.

### Cited Findings
- Scorecard. Capital is for ≤ 1% all-in on a $10k trade on both branches; arbitrage loss is per 30-day event at that depth with perfectly informed flow [S2](mechsim/s2_out.txt), [S3](mechsim/s3_out.txt), [S4](mechsim/s4_out.txt), [S5](mechsim/s5_out.txt):

  | mechanism | capital | arbitrage loss | oracles | main manipulation or failure | effort |
  |---|---|---|---|---|---|
  | pump.fun curve | X·s backing + NO-stock bet | 9%–47% of inventory at launch | none | launch drain | n/a |
  | CPMM pair, full | $2.86M per market | −$2.3k (1-min arbs) | none | sandwich; gaps | separate contract, moderate |
  | CPMM pair, ±20–30% | $250k–$350k per market (26% / 7% range exit) | same $ as full | none | out-of-range → zero depth | moderate |
  | LMSR (stock numeraire) | $248k worst-case subsidy per market | ≈ $200k expected | none | consumed at resolution | high, and a product change for Y |
  | B: s-anchored, learns p | ≈ $20k per fill, ~$100k with caps per stock | −$121 (δ 5%); worse at δ 20% | s | surprise resolution ($3.4k at δ 20%) | separate contract |
  | **C: δ-curve** | ≈ $20k per fill, ~$100k per stock (shared by ≤ 8 events) | **−$45** | s (pull or signed), p (signed relay) | stale or async oracles; p signer | separate contract or keeper JIT |
  | Opening auction | none extra | cuts discovery cost to $5–$47 | s, p at clearing | thin participation | moderate |
  | JIT routing | spot stock + Polymarket hedge | event P&L sd $52k unhedged | spot, Polymarket | spot depth; cross-chain lag | high (off-chain) |

### Inferences
- The δ-curve's advantage is structural. It does not pay LVR on the stock's volatility (σ² ≈ 0.20/yr at 45%), only on δ's (σ_δ²·p(1−p)). Its capital is set by what it must *deliver* (inventory and caps), not by virtual reserves. It shares one inventory across all events of a stock.
- **Where the verdict could flip:**
  - If σ_δ turns out large and jumpy (the backtest's question 1), the δ-curve's edge shrinks: the jumpy-δ case still beat A by $2.5k per event in simulation.
  - If a trusted p relay is unacceptable, use B for small-δ scheduled events and the CPMM pair (with lagging TWAPs) for the rest.
  - If oracles cannot be kept fresh, an oracle-anchored curve loses its edge: at 5-minute staleness C fell below A.

### Gaps
- No empirical Probabl order-flow data (informed versus uninformed mix, sizes) was used. All profit levels are model-dependent.

## 10. Concrete design of the recommended mechanism: the Δ-curve backstop

### Takeaway
Ship in three steps. **Phase 0, no contract changes:** keeper "JIT quotes" plus retuned ladders. **Phase 1:** a `DeltaCurvePool` contract beside the exchange (a Δ-vault whose pricing function is on-chain) with a router, executing atomically from fresh s and signed p. **Phase 2, optional:** a native `swapCurve` exchange extension (14-day activation), opening δ-auctions, and liquidity-sensitive slope. The oracles are Chainlink Data Streams for s (live on Robinhood Chain; halt on weekends) and a Probabl-signed, rate-limited Polymarket p, bounded by the Chainlink band.

### Cited Findings
- Building blocks reused from the current system:
  - in-kind shares (no price enters share accounting)
  - the keeper's stateless δ̂ = anchor − impact·imbalance/inventory
  - band, cutoff-buffer, imbalance, resting and order caps
  - the keeper's spread terms (fee edge, adverse selection, movement, p-uncertainty × |δ̂|) and its 3× widening in the last day
  - pull-quote triggers on stale references, s/p skew, s/Chainlink deviation, jumps and the consistency breaker

  — [docs/delta-vault.md §9](file:///Volumes/T9/probabl/docs/delta-vault.md), [model.ts](file:///Volumes/T9/probabl/services/vault-keeper/src/model.ts), [config.ts](file:///Volumes/T9/probabl/services/vault-keeper/src/config.ts)
- Lagging observations (bounded change per update) as a manipulation defence — [MetaDAO TWAPs](https://docs.metadao.fi/governance/twaps.md). A per-market risk limit that stops one side until opposite flow arrives — [Overtime](https://docs.overtime.io/learn-about-overtime/overtime-amm-and-liquidity-mechanics.md)
- Oracle availability: Data Streams (real-time) and Data Feeds (reference) on Robinhood Chain — [Genfinity](https://genfinity.io/2026/07/01/robinhood-chain-mainnet-launch-chainlink-oracle-integration). 24/5 equity streams carry market-status flags; there is no weekend trading on any venue — [Chainlink docs](https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide)

### Inferences

**State (per stock pool; per market where noted)**

- **Holdings:** read from the exchange, as `DeltaVault` does. Plain stock and USDG credit; per market the YES/NO stock and quote claims. Nothing is duplicated in pool storage.
- **Per market, set by the curator:**
  - `anchorPpm` (δ₀)
  - `impactBps` (δ per 1% of inventory imbalance)
  - `skewBps` (full-set price skew per 1% of net stock deviation)
  - `halfSpreadBps` floor, `maxGapPpm`, `maxImbalance`, `maxTradeNotional`, `blockNotionalCap`, `cutoffBuffer`, widening window and factor
  - `bandBps` against the Chainlink Data Feed
  - `pMaxAge`, `pMaxStepPerMin`, `pJumpHalt` and `cooldown`
- **Per market, runtime:** last accepted p and its time; last trade block and the notional traded in it.

**Inputs per trade**

- **s:** a Chainlink Data Streams report verified on-chain, or a keeper-signed EIP-712 attestation `{market, s, p, tObs, expiry}`. Required: market status open, age ≤ ~10 s, and within `bandBps` of the Data Feed. The pool halts while the status is closed (weekends and holidays).
- **p:** Probabl's relay signs the Polymarket CLOB mid and spread, with age ≤ `pMaxAge` (~10 s). The pool clamps p to `p_last ± pMaxStepPerMin·Δt` (a lagging p). A move larger than `pJumpHalt` (8 points, as the keeper uses) halts the market for `cooldown`. Polymarket going to 0 or 1 halts it until resolution.

**Pricing**

- inventory I = plain stock + (yesBase + noBase)/2, imbalance m = yesBase − noBase, net-stock deviation j = (stock value share − target)/1%
- δ̂ = clamp(δ₀ − impactBps·10⁻⁴·(m/I)/1%, ±maxGap)
- skew = −skewBps·10⁻⁴·j
- Y_mid = s·(1 + (1−p)·δ̂)·(1 + skew), N_mid = s·(1 − p·δ̂)·(1 + skew)
- half-spread h = max(floor, makerFeeEdge + adverse + 2·movement + spread_p·|δ̂|) × widen(t_to_cutoff)
- Execution of q shares is closed-form: δ̂ is linear in m, so cost = q·Y_mid + ½·s·(1−p)·λ·q² (plus the skew term), times (1 + h).

**How each trade moves prices**

| trade | δ̂ | Y | N | skew |
|---|---|---|---|---|
| buy YES-stock (q) | +λq | +s(1−p)λq | −s·p·λq | up |
| buy NO-stock (q) | −λq | −s(1−p)λq | +s·p·λq | up |
| buy both legs equally (= stock) | unchanged | via skew only | via skew only | up |
| sells | mirror | mirror | mirror | mirror |

**Parameters (from S3 and S4)**

- Target ≤ 1% all-in on $10k at p ≈ 0.5: a $10k one-leg trade moves its leg about 1.4% (κ ≈ 3,571 shares per unit of δ at s = $100). In keeper units: `impactBps` ≈ 14 for a $100k pool, 35 for $250k, 140 for $1M.
- `skewBps` of the same order (the full-set depth equal to the leg depth). Deeper full-set liquidity raised the cost of staleness and needed 4× the inventory in S4.
- h = 30 bp (must cover the maker-fee edge), widening to 3× in the last day.
- `maxGap` 8% by default, wider only for merger or FDA events with an auction-set δ₀.
- `maxImbalance` ≈ 5× the typical trade.
- `blockNotionalCap` ≈ 2× the target trade, against sandwiches and oracle races.
- Slope: optionally LS-LMSR-style, starting 2× steeper and deepening linearly with cumulative volume to the target over the first days.

**Plugging in without an extension (Phase 1)**

- **Credit- or claim-funded trades (the 1-click flow):** the user once grants the pool a delegation (`approveDelegate` with per-order and lifetime budgets). In one transaction, `pool.trade(owner, …)`, callable only by the owner or the owner's existing trading delegate:
  - (1) computes the curve price;
  - (2) `place`s an exact-size pool maker order (expiry = now+1, funded from the branch's claims, splitting stock or USDG first if needed);
  - (3) calls `placeFor(owner, IOC)` naming that maker as plan entry seq+1, with nextSeq = the new seq.

  The fill emits the normal `Trade`, and fees, rebates and referrals work unchanged. The router first fills better-priced CLOB orders from the API's plan, in the same transaction. Gas is about 119–124k (rest) + 85–93k (fill) + pool logic and oracle verification, roughly 250–300k (my estimate). The pool order must be consumed in full, or cancelled in the same transaction, so a crossing remainder never rests.
- **Wallet-funded buys:** `transferFrom` USDG → `deposit` → `split` → `transferClaim` the stock claim and the opposite-branch USDG refund to the buyer. This path bypasses exchange fees and `Trade` events, so the pool charges and emits its own, and the indexer must ingest them. Sells need the delegation path, because `transferClaim` only moves the caller's own claims.
- **Market caps:** the exchange's per-market `maxOrder`, `maxWallet` and `maxMarket` (immutable) cap the placement path, so new markets should be created with caps that fit the curve's sizes.

**Phase 0 (days, no contracts)**

- Retune: the vault's `orderQuote` budget proportional to TVL, more levels within `MAX_ORDERS`, and the half-spread floor toward 30 bp when the fee edge allows.
- Add a keeper "JIT quote" endpoint: on a user's quote request, the keeper posts an exact-size vault order at the δ-curve price with a ~30 s expiry, and the user's or the delegate's IOC names it. Every existing on-chain vault bound still applies. This captures most of the slippage benefit and none of the audit risk.
- Cost: two transactions (one block of latency) and one keeper transaction per trade.

**Phase 2**

- An exchange extension `swapCurve` that moves ledger balances directly (one call, ~100k gas). It runs with the exchange's full storage authority, so it needs a dedicated audit and the 14-day window.
- An opening δ-auction per new market (§6).
- Spot-stock and Polymarket hedging of inventory when caps bind (§7).

**Capital and who provides it**

- About $100k per stock pool (half stock) for ≤ 1% on $10k at p near 0.5. In S4 the worst-path inventory per leg was about 500 shares ($50k) in the base case and up to 2,083 ($208k) with jumpy δ. Use $250k for high-δ events or p far from 0.5, and about $1M for ≤ 1% on $100k trades.
- One pool serves up to 8 events of its stock.
- Seed it from the protocol treasury (Overtime's treasury has been its sole LP since June 2026), then open in-kind LP deposits.

**Expected LP P&L per 30-day event at this depth (S4)**

- About +$6.4k on $150k/day of uninformed flow, and +$2.1k on $50k/day, essentially the 30 bp spread.
- About −$45 from perfectly informed flow when oracles are fresh.
- Lose about $5k at 5-minute oracle staleness, about $3.6k by trading through closed hours, and up to −$11k (p5) on a high-δ event traded with frozen s.
- Hence the hard rules: halt when either oracle is stale or closed, require fresh p on high-δ markets, and stop before announcement (cutoff buffer).

**What it does not solve**

- LP capital is still needed, though 2.5–30× less than any oracle-free pool at equal depth.
- The p relay is a trusted signer. Its damage is bounded by |δ̂|·Δp_max, the band and the caps, the same trust the keeper has today.
- σ_δ must be measured (the repo's backtest) before sizing caps for real money.

### Gaps
- Gas and latency of Data Streams verification on Base and Robinhood Chain, and whether Data Streams equities are offered on Base: not found.
- Legal review of a protocol-treasury-funded market maker on security-like claims is out of scope here. The repo flags conditional stock tokens as likely security-based swaps ([future-improvements.md](file:///Volumes/T9/probabl/docs/future-improvements.md)).
