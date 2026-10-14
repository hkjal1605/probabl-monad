# Launchpad bonding curves and other self-bootstrapping liquidity mechanisms (state as of Oct 11, 2026)

Scope: how pump.fun-style bonding curves and their successors, along with non-curve launch mechanisms (LBPs, Uniswap CCA, MetaDAO, Echo/Sonar), get from nothing to a tradable market. Covers exact math and parameters, results and failures, and what transfers to Probabl's fully collateralized, externally anchored conditional stock claims. Dates are given wherever known; "historical" marks facts that have since been superseded.

---

## 1. pump.fun: exact curve math, parameters, migration, fees, 2025–2026 changes, why it works, and results

### Takeaway
pump.fun is a Uniswap-v2 constant-product curve run on virtual reserves: 30 virtual SOL and 1.073B virtual tokens, with 793.1M real tokens for sale out of a 1B supply. Selling all 793.1M raises about 85 SOL. The remaining 206.9M tokens plus that SOL then seed a PumpSwap pool whose LP tokens are burned, and the pool opens at the curve's final price. The scheme needs no LP capital because the token is minted free and the quote-side virtual reserve is never paid out. It works for memecoins because nothing anchors their price outside the curve. Fewer than 2% of launches graduate, often under 1%.

### Cited Findings
**Program parameters (current mainnet Global account)**
- `initial_virtual_token_reserves` = 1,073,000,000,000,000 raw (1.073B tokens, 6 decimals); `initial_virtual_sol_reserves` = 30,000,000,000 lamports (30 SOL); `initial_real_token_reserves` = 793,100,000,000,000 raw (793.1M tokens); `token_total_supply` = 1,000,000,000,000,000 raw (1B); `fee_basis_points` = 100; `creator_fee` = 0 ("not used"); `pool_migration_fee` = 15,000,001 lamports — [pump-fun/pump-public-docs PUMP_PROGRAM_README](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/PUMP_PROGRAM_README.md)
- On a buy, virtual and real SOL reserves rise by the same lamports and virtual and real token reserves fall by the same amount; a sell reverses this. The curve is "based on Uniswap V2" with synthetic x and y reserves. `complete` = true when `real_token_reserves` reaches 0, and the curve is then eligible for `migrate` — [PUMP_PROGRAM_README](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/PUMP_PROGRAM_README.md)
- Migration: anyone may call `migrate`, liquidity moves into a PumpSwap pool, and "the LP tokens received from the pool are burned." The old `withdraw` path (off-chain migration to Raydium) is disabled — [PUMP_PROGRAM_README](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/PUMP_PROGRAM_README.md)
- Note: the Global account's `fee_basis_points` = 100 (1%) does not match the live fee page (1.25% on the curve). A separate fee program (FEE_PROGRAM_README, FEE_RECIPIENTS) now appears to set fees — [pump-public-docs README](https://github.com/pump-fun/pump-public-docs); [pump.fun fees](https://pump.fun/docs/fees)
- Curve fields added in later upgrades: `creator`, `is_mayhem_mode`, `is_cashback_coin`, `quote_mint`, `creator_fee_bps`, `can_edit_creator_fee`, `is_holder_reward`. Cashback coins are deprecated — [PUMP_PROGRAM_README](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/PUMP_PROGRAM_README.md)

**2026 mechanics changes (from the public docs repo; mostly undated)**
- "Synthetic migration": "the buy that empties the curve has no max size". The curve part fills at the curve price, and the rest is priced on the reserves the migration will deposit, using PumpSwap's constant-product formula. `migrate_v2` then creates the pool "with exactly the reserves the buy left behind", so "the price is continuous". Pool base reserves = curve token balance minus tokens left on the curve. Pool quote reserves = real quote reserves plus the curve-part cost, minus the migration fee (SOL pairs only). Released with `@pump-fun/pump-sdk` 4.0.0 — [SYNTHETIC_MIGRATION.md](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/SYNTHETIC_MIGRATION.md)
- PumpSwap pools have a signed `virtual_quote_reserves` field: `effective_quote_reserves = pool_quote_token_account.amount + Pool::virtual_quote_reserves`. From "September 30" (year not stated) it can be negative, so that uncollected protocol and creator fees sitting in the vault are not priced as liquidity — [NEGATIVE_VIRTUAL_QUOTE_RESERVES.md](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/NEGATIVE_VIRTUAL_QUOTE_RESERVES.md)
- The repo README also announces v3 trades, PumpSwap v2 trades, multi-hop swaps, "pump coins as quote mints", holder-rewards coins, USDC quote support, and "virtual quote reserves for PumpSwap" — [pump-public-docs README](https://github.com/pump-fun/pump-public-docs)

**Fees (pump.fun fee page, "Last Updated: 08 October 2026")**
- Coin creation: no platform fee. Graduation/migration: 0.015 SOL per coin, deducted from the curve for SOL pairs. Bonding-curve trades (SOL and USDC coins): creator 0.30% + protocol 0.95% + LP 0% = 1.25% — [pump.fun fees](https://pump.fun/docs/fees)
- PumpSwap canonical pools use market-cap tiers. SOL pairs: 0–420 SOL mcap is 1.25% total (creator 0.30 / protocol 0.93 / LP 0.02); 420–1,470 SOL is 1.20% (creator 0.95 / protocol 0.05 / LP 0.20); ≥98,240 SOL is 0.30% (0.05 / 0.05 / 0.20). USDC pairs: 0–59k USDC is 1.25%, 59k–100k is 1.20%, ≥$20M is 0.30%. Non-canonical pools: 0.30% (creator 0 / protocol 0.05 / LP 0.25) — [pump.fun fees](https://pump.fun/docs/fees)
- "Custom Pair" coins quoted in assets other than SOL or USDC pay flat rates: curve 1.25%, PumpSwap 0.30%. With Holder Rewards enabled, the creator fee becomes a creator-set rate from 0.01% up to a 3% platform maximum. EVM transactions carry "up to 1%". The creator fee has applied since May 13, 2025 — [pump.fun fees](https://pump.fun/docs/fees)

**Fee history (historical)**
- PumpSwap launched March 20, 2025. Graduations moved from Raydium to PumpSwap, and the migration fee fell from 6 SOL to 0. Under the old system about 6 SOL was deducted from curve proceeds to create the Raydium pool. PumpSwap's launch fee was 0.25% (0.20% to LPs, 0.05% to the protocol) — [The Block](https://www.theblock.co/post/347360); [Decrypt](https://decrypt.co/310933/solana-pump-fun-pumpswap-exchange)
- Project Ascend / "Dynamic Fees V1" (early Sept 2025) replaced the flat 0.05% creator fee of May 2025 with market-cap tiers: 0.95% around $88k–$300k mcap, falling to 0.05% at $20M. Creators received about $2M in the first 24 hours versus about $198k the day before (Dune data) — [Decrypt](https://decrypt.co/337872/pump-funs-new-fee-model-hands-out-2m-to-creators-in-first-24-hours); [Blockworks](https://blockworks.com/news/pumpdotfun-fee-model)
- Jan 9, 2026: pump.fun introduced "Creator Fee Sharing". The co-founder said the tiered model had rewarded low-risk coin creation over trading. The 2026 fee page still shows market-cap tiers on PumpSwap — [MEXC news](https://www.mexc.com/news/449516); [pump.fun fees](https://pump.fun/docs/fees)

**Graduation statistics**
- Graduation rate peaked at 2.1% in June 2024, was 1.6% at peak volume, and fell to about 0.7% by Feb 2025. Fewer than 2% of 11.9M launches had ever graduated (Feb 2025) — [The Block](https://www.theblock.co/post/343742/pump-fun-rapid-decline-graduating-tokens-memecoin-frenzy-fizzles-out)
- A January 2026 report citing Dune: 269 graduations in one day, over 1% of that day's launches, the highest since summer 2025 (0.92%) — [MEXC news (secondary)](https://www.mexc.com/cs-CZ/news/586607)
- An estimate of about 0.4–0.6% of launches as of mid-2026 (single blog, low confidence) — [MadeOnSol](https://madeonsol.com/blog/pump-fun-first-3-minutes-graduation-math)
- Academic work models graduation probability from SOL locked in the curve plus launch-structure and behavioural variables. It argues pump.fun's standardized contract makes it a clean natural experiment — [Marino, Naviglio, Tarantelli & Lillo, arXiv 2602.14860](https://arxiv.org/abs/2602.14860). Graduation labels taken from off-chain collectors' feeds carry measurement error — [arXiv 2607.02823](https://arxiv.org/pdf/2607.02823)

**Revenue, volume, token**
- More than $1B lifetime protocol revenue (DefiLlama via reports). Apr 28, 2026: pump.fun burned bought-back PUMP worth about $370M (about 36% of circulating supply) and moved to 50% of net revenue for a 12-month buy-and-burn. PUMP fell about 67% from the mid-July 2025 start of buybacks to the day before that announcement — [The Block](https://www.theblock.co/post/399288/pump-fun-burns-370-million-pump); [CoinDesk](https://www.coindesk.com/markets/2026/04/29/pump-fun-burns-36-of-pump-supply-in-usd370-million-wipe-locks-50-revenue-into-ongoing-buybacks)
- Aug 25, 2026: $2.4M revenue in one day, the highest since Sept 2025. Weekly revenue was $13.68M, and trailing 30-day revenue was about $42–48M. Daily launches were "in the tens of thousands" — [Crypto Briefing](https://cryptobriefing.com/pumpfun-daily-revenue-highest-since-september/)
- PUMP ICO, July 2025: 15% of a 1T supply at $0.004, sold out in 12 minutes. Reported totals were $500M or $600M public, and about $1.32B including the private sale — [The Block](https://theblock.co/post/362320/pump-fun-raises-500-million-in-12-minutes-as-pump-tokens-fully-sell-out); [Unchained](https://unchainedcrypto.com/pump-fun-becomes-third-largest-ico-raises-600m-in-12-minutes/)

**Sniping, bundling, manipulation**
- Pine Analytics: deployer-funded sniper wallets bought in the launch block across 15,000+ launches in one month, with an 87% profitable-snipe rate (Substack analyst report; methodology unverified) — [Pine Analytics](https://pineanalytics.substack.com/p/exit-liquidity-machines)
- An arXiv study of about 6,000 pump.fun and GMGN projects classifies bundle, sniper, bump and comment bots. It finds that position-manipulation bots mostly redistribute returns, while attention bots inflate apparent performance — [arXiv 2601.08641](https://arxiv.org/pdf/2601.08641)
- The Defiant runs a headline on a report that "99% of PumpFun memecoin launches are pump-and-dumps or rug pulls" (report itself not opened) — [The Defiant](https://thedefiant.io/news/defi/pump-fun-lets-creators-launch-coins-priced-in-tokenized-stocks)

### Inferences
- **Computed from the program parameters** (constant product on virtual reserves, fees excluded):
  - k = 30 × 1.073e9 = 3.219e10.
  - Start price: 30/1.073e9 = 2.796e-8 SOL/token, a starting FDV of 27.96 SOL.
  - After 793.1M tokens are sold, virtual tokens = 279.9M and virtual SOL = 115.005, so **real SOL raised = 85.005 SOL**.
  - End price: 4.109e-7 SOL, an end FDV of **410.9 SOL**. This matches the 0–420 SOL first fee tier. The price ratio end/start is (1.073/0.2799)² = **14.70×**.
  - Pool at migration: 206.9M tokens and 84.99 SOL (after the 0.015 SOL fee), opening at 4.108e-7 SOL, 99.98% of the curve's end price, i.e. continuous.
  - Continuity holds because the virtual SOL (30) divided by the virtual token excess at the end (279.9M − 206.9M = 73M) equals the end price (4.11e-7). The virtual reserves behave like a phantom LP position sized so that real SOL ÷ pool tokens equals the final curve price.
  - Average price paid on the curve is 85.005 SOL ÷ 793.1M = 1.07e-7, **26% of the graduation price**.
  - Depth: 1 SOL buys 34.6M tokens (3.46% of supply) at genesis, and 10 SOL buys 26.8%. Moving the price +10% costs 1.46 SOL at the start and 5.61 SOL at the end. The first 10M tokens cost 0.28 SOL and the last 10M cost 3.97 SOL.
  - The curve is built for extreme slippage: about 14.7× of price "discovery" over roughly $10–20k of SOL.
- **Why it works for memecoins.** The curve is the only price: there is no external fair value to arbitrage against. The issuer mints the inventory free, the quote-side virtual reserve is never withdrawable, and only earlier buyers can sell back, so the curve never pays out more than it took in. That makes it permissionless with zero LP capital. Monotone price-in-supply hands early buyers lottery-like convexity, the 14.7× range rewards attention, and the standardized contract makes every launch legible to bots and terminals.
- **Why sniping is structural.** The first block is deterministically the cheapest point on a known curve, so any deterministic, unanchored curve rewards being first. The anti-snipe decaying fees covered in section 2 treat this symptom.

### Gaps
- The exact on-chain fee placement (fee deducted before or after the curve math) was not verified in code.
- The current graduation thresholds for USDC- and custom-pair curves were not found; the USDC fee-tier boundary of $59k hints at a similar graduation FDV, but that is unconfirmed.
- No primary Dune dashboard for 2026 graduation rates was opened; figures come from press citing Dune.
- The year of the "September 30" negative-virtual-reserve change is not stated in the docs.
- "Mayhem mode" (`is_mayhem_mode`) was not researched.

---

## 2. Successors and variants: Meteora DBC, Raydium LaunchLab, LetsBonk, Zora, Clanker, Flaunch, Doppler, Virtuals, friend.tech, Football.fun, Pons

### Takeaway
The successors share pump.fun's core. They mint the token free, sell a fixed tranche along a deterministic or demand-adaptive curve, and use the proceeds plus a reserved tranche to seed an AMM, usually with locked or burned LP. They differ mainly in three ways:
- **Curve shape.** Meteora uses up to 16 concentrated-liquidity segments; Doppler uses a time-decaying dynamic Dutch auction; Flaunch opens with a fixed-price window.
- **Anti-snipe fees.** Zora decays 99% to 1% over 10 s, Pons 99% to 0 over 3 s, Doppler 80% to 1%.
- **Fee routing.** Creator fees, bid walls, buybacks.

Doppler is the most relevant design for Probabl. It moves the whole curve down when sales lag a schedule and up when they run ahead, and it keeps a "lower slug" of proceeds as a buy-back floor.

### Cited Findings
**Meteora Dynamic Bonding Curve (Solana)**
- A piecewise concentrated-liquidity curve with up to 16 segments, each a (sqrt_price, liquidity) pair (`MAX_CURVE_POINT_CONFIG = 16`). Sqrt prices must be strictly ascending and each L > 0. Higher L makes price move more slowly through a segment.
- The migration quote threshold is the sum over segments of L_i × (√P_i − √P_{i−1}), the standard concentrated-liquidity quote amount. The migration price satisfies p_max² = threshold × (1 − migration fee %) / migration base amount.
- At the threshold the launch migrates to DAMM v2; DAMM v1 is a legacy path.
- Sources: [Meteora DBC formulas](https://docs.meteora.ag/overview/products/dbc/bonding-curve-formulas); [Meteora: what is DBC](https://docs.meteora.ag/core-products/dbc/what-is-dbc)
- Fee modes are fixed, time scheduler, or optional dynamic; "rate limiter" is deprecated. Trading, migration and pool-creation fees and "surplus" can be split between launchpad partner and creator. Configs include LP lock and vesting settings — [Meteora: what is DBC](https://docs.meteora.ag/core-products/dbc/what-is-dbc)
- Used by Believe, Bags and daos.fun — [MEXC news](https://www.mexc.com/news/92100). Believe graduates at a market-cap threshold "commonly around $100,000" (third-party guide) — [QuickNode builders guide](https://www.quicknode.com/builders-guide/tools/believe-app-by-believe)

**Raydium LaunchLab and LetsBonk**
- LaunchLab launched April 16, 2025. Its JustSendit mode graduates at 85 SOL by default, and Custom mode lets creators set the threshold. It migrates to Raydium CPMM (default) or legacy AMM v4 and burns the LP tokens. Fee details conflict: one source says 1% with 25% to RAY buybacks, while the docs say 50% of trading fees go to a community pool — [Raydium docs](https://docs.raydium.io/raydium/launchlab); [Cointelegraph](https://cointelegraph.com/news/raydium-unveils-memecoin-creator-launchlab-compete-pump-fun)
- LetsBonk overtook pump.fun on July 5–6, 2025 (Dune: 19,620 vs 9,249 launches on July 6) and peaked around 84% of launches in late July. pump.fun reclaimed the top spot by Aug 6, 2025. By graduated tokens, The Block says pump.fun held about 80% through 2025, with LetsBonk peaking near 70% in early July — [The Block](https://theblock.co/post/361189/letsbonk-dethrones-pump-fun-with-higher-daily-memecoin-volume-token-launches); [The Block](https://www.theblock.co/post/366395/pump-fun-fends-off-letsbonk-in-battle-for-top-solana-memecoin-launchpad)

**Doppler (Whetstone Research; Uniswap v4 hook)**
- A dynamic Dutch-auction bonding curve. It rebalances once per epoch in `beforeSwap`, retroactively covering any missed epochs.
  - Expected sold = (elapsed / duration) × `numTokensToSell`.
  - Max tick delta = (endingTick − startingTick) / ((endingTime − startingTime) / epochLength).
  - If net sold ≤ 0, the curve shifts down by the full max delta. If net sold is positive but behind schedule, it shifts down by (1 − sold/expected) × max delta. If ahead of schedule, it moves up to the expected tick.
  - `tickLower = startingTick + tickAccumulator` and `tickUpper = tickLower + gamma`.
- Slugs:
  - **Lower slug**: sized with `totalProceeds` so holders can sell back. If proceeds are insufficient it sits at the average clearing price, totalProceeds / totalTokensSold.
  - **Upper slug**: sized to the gap between expected and actual sales for the current epoch.
  - **Price-discovery slugs**: future-epoch supply, placed contiguously above.
- Sources: [Doppler.md (whetstoneresearch/doppler)](https://raw.githubusercontent.com/whetstoneresearch/doppler/main/docs/Doppler.md)
- Parameters: `minProceeds` and `maxProceeds` are soft and hard targets; an `insufficientProceeds` state exists; an early exit triggers at max proceeds. Example configs sell 500M of a 1B supply over 7 days with 12-hour epochs. Migration options are Uniswap v2, v3, or v4 with streamable fees and `lockDuration`. "Multicurve" uses several market-cap-defined curves, `numPositions` and `shares`, and is called "a strict improvement over static". Fee decay starts at 80% and falls linearly to 1%. Protocol take is 5% of trading fees on EVM and 7.5% on Solana. Integrators include Zora, Paragraph, Noice and Bankr, on Base, Ethereum, Monad and Solana devnet — [Doppler docs llms-full.txt](https://docs.doppler.lol/llms-full.txt)
- Whetstone presents the on-chain Dutch auction as MEV protection that makes it harder for bots to snipe cheaply, with v4 dynamic curves on Base, Ink and Unichain — [Whetstone](https://paragraph.xyz/@whetstone/doppler-core-is-now-available)

**Zora coins (Base, Uniswap v4)**
- A single hook (`ZoraV4CoinHook`, coins v2.3.0+). Initial liquidity uses Doppler multicurve positioning. A "Sniper Tax" of 99% decays linearly to the base fee over the first 10 seconds. The base fee is 1% for creator and content coins and 0.01% for trend coins. Of trading rewards, the creator gets 50% and Doppler 5%. Content coins have a 1B supply with 10M to the creator at launch; creator coins have a 1B supply with half vesting to the creator over 5 years — [Zora hook docs](https://docs.zora.co/coins/contracts/hook); [Zora coin docs](https://docs.zora.co/coins/contracts/coin)
- Users cannot LP into these pools because that would interfere with the hook logic — [Delphi Digital](https://members.delphidigital.io/reports/zora-cant-stop-coining)

**Clanker v4 (July 2025; Uniswap v4)**
- Up to 7 pools per token, static or dynamic fees, LP fees routed to a fee locker with up to 7 reward recipients, and an opt-in vault for up to 90% of supply. "MEV modules" either delay trading by 2 blocks or auction the first swaps — [Bankless](https://www.bankless.com/fr/read/clanker-v4-token-creator); [Clanker v4 announcement](https://paragraph.xyz/@dish/introducing-clanker-v4)
- Third-party skill listings (unverified) give a sniper fee of 66.7% decaying to 4.2% over 15 s, a maximum sniper fee of 80%, and a maximum decay of 2 minutes — [Bankless](https://www.bankless.com/fr/read/clanker-v4-token-creator)

**Flaunch (Base, Uniswap v4 hooks)**
- A 30-minute fixed-price "Fair Launch" ("Everyone gets the same price for the first 30 minutes"). Buys beyond the remaining fair-launch amount are not price-protected, and creators can pre-buy at the same price. The fetched page is ambiguous on whether fair-launch buys can be sold during the window — [Flaunch fair launch](https://docs.flaunch.gg/features/fixed-price-fair-launch.md)
- Progressive Bid Wall: "Whatever the dev doesn't take in fees goes to the PBW" (e.g., 80% if the dev takes 20%). "A new PBW is created for every 0.1 ETH of trading fees", and it "places a 0.1 ETH limit order immediately below spot". "If the price continues moving upwards, the PBW follows" — [Flaunch auto-buybacks](https://docs.flaunch.gg/features/auto-buybacks.md)
- Early 2025 figures: 2,135 tokens, $75.6M of v4 volume, 51 ETH paid back (stale) — [Nansen](https://research.nansen.ai/articles/1852)

**Virtuals Protocol (Base and others)**
- Agent tokens trade on a curve until it holds 42,000 VIRTUAL, then migrate to a Uniswap V2 pool paired with VIRTUAL, with liquidity reportedly locked for 10 years. Creation fee is 100 VIRTUAL — [Forkast glossary](https://forkast.news/glossary/virtuals-protocol/)

**friend.tech keys (Base, Aug 2023; historical)**
- Price = supply² / 16000 ETH, a quadratic curve with no cap: the first key is roughly free and the 200th costs about 2.5 ETH. Total fees are 10% (5% protocol, 5% subject) — [Spark glossary](https://www.spark.money/glossary/bonding-curve); [The Block](https://www.theblock.co/post/252072/friend-tech-users-have-earned-12-million-in-fees-but-is-it-sustainable)
- TVL fell 91% from $52M to $4.5M, and annualized fees dropped from about $180M (fall 2023) to about $60k. In Sept 2024 admin rights went to a null address as daily users fell to single digits (secondary, undated) — [MEXC news](https://www.mexc.com/news/85321)
- Contemporaneous critique: fees were too high for healthy speculation and should scale with key count — [Data Always](https://dataalways.substack.com/p/friendtech-speculation)

**Football.fun (Base, Aug 2025)**
- Fractional player shares, up to 25M per player, distributed "via packs or the open market". Volume was $25.7M and depositors 10,284 in under two weeks (Dune via Decrypt), with $2M+ of fees in the first month — [Decrypt](https://decrypt.co/336649/morning-minute-football-dot-fun-breaks-out); [Decrypt](https://decrypt.co/337097/buzzy-ethereum-game-football-fun-soccer-fans-crypto-gains)

**Pons (Robinhood Chain, 2026) — the Robinhood Chain analog of pump.fun**
- V1 had no curve and launched straight into locked Uniswap v3 pools (superseded).
- V2 mints a fixed 1B supply (18 decimals) to a per-token curve. 5/7 (about 714.3M) is sold on the curve. At graduation 2/7 is swept: 10/49 (about 204.1M) seeds a locked full-range Uniswap v4 position, and 4/49 (about 81.6M) goes to a locker.
- Graduation is 4.2 ETH for ETH-quoted launches, or a per-asset threshold otherwise.
- **Quote assets include ETH, USDG, cbBTC and tokenized stocks/ETFs (TSLA, NVDA, SPY)**.
- Fees: 1% curve fee; a creator tax capped by the factory; a 0.0005 ETH launch fee; a snipe tax of 9,900 bps decaying over 3 s (9,900, 618, 19 bps, then 0). The graduated v4 pool has fee 0, with "all fees taken by the hook", and tickSpacing 200.
- Sources: [Bitquery Pons API docs](https://docs.bitquery.io/docs/blockchain/robinhood/pons-api/)
- $5.95M daily fees on Sept 1, 2026. Reports of 30-day fees differ: $19.8M (Defiant) vs about $40.8M (Crypto Briefing) — [Crypto Briefing](https://cryptobriefing.com/pons-record-daily-fees-robinhood-chain/)
- Pons is reported to have arrived Aug 12, 2026. Curve launches on Robinhood Chain rose from 437 to 43,000+ in August, and Pons had about 646k tokens from 167k creators by early September (unverified secondary) — [bit.com](https://www.bit.com/square/robinhood-chain-vs-solana-base-memecoin)
- Two Robinhood Chain launchpads cut pump.fun's share of launchpad fees from 80% to 27% within two weeks in July. pump.fun was back above 50% four weeks later — [The Defiant](https://thedefiant.io/news/defi/pump-fun-launchpad-fee-share-falls-robinhood-chain-pons-noxa). Note the date conflict with the Aug 12 Pons arrival: perhaps V1 vs V2, unresolved.

### Inferences
- Every variant keeps the same economic core: inventory minted free, phantom or virtual liquidity shaping price, proceeds recycled into post-graduation liquidity. Doppler and Flaunch add the two ideas most portable to a capital-constrained venue:
  - **Price moves with demand over time, not only with supply.** Doppler shifts down when undersold, which keeps the curve from being stranded above fair value.
  - **Proceeds sit as a standing bid below spot.** Doppler's lower slug and Flaunch's bid wall both do this.
- Meteora's 16 segments and Doppler's few slugs show that a "curve" can be implemented as a small number of discrete liquidity ranges. That maps cleanly onto a handful of resting limit orders on an order book.
- Opening snipe taxes (99% decaying over 3–10 s) exist because each curve's first block is deterministically cheap. That problem is specific to unanchored launches.

### Gaps
- No primary source confirmed that LetsBonk runs on Raydium LaunchLab, or its exact parameters.
- No official Clanker docs were found for sniper-fee parameters.
- Football.fun's pricing engine (curve vs AMM vs order book) is not documented in the sources found.
- Virtuals "Genesis" launches were not found.
- Meteora DBC anti-sniper scheduler parameters were not retrieved.
- Doppler's `gamma` default formula is not given in the docs.

---

## 3. Non-curve launch and bootstrapping mechanisms: LBPs, Uniswap CCA, batch auctions, MetaDAO, Echo/Sonar, fair launches

### Takeaway
The non-curve mechanisms solve the same problem — reach a deep AMM at a fair price without sniping — by separating price discovery from liquidity provision:
- **Balancer LBPs** run a time-decaying weighted-pool Dutch auction.
- **Uniswap's CCA** (live Nov 13, 2025) spreads bids across blocks and clears at a uniform price per block, then seeds a v4 pool at the discovered price. Aztec raised about $59–61M from about 17k bidders, clearing about 60% above the floor.
- **MetaDAO** runs a fixed raise, then seeds a futarchy AMM with 2M tokens plus 20% of the USDC raised.

In every case the seeded liquidity is a share of the sale proceeds plus newly minted tokens, so the issuer still mints the asset side.

### Cited Findings
**Uniswap Continuous Clearing Auction (CCA)**
- Projects set tokens to sell, a starting price and a duration. Each bid (max price, total spend) "is automatically spread across the remaining blocks of the auction, using the same max price for every split".
- Each block clears at "the highest price where all tokens for that block can be sold". Higher bids fill first, and bids at the clearing price fill pro rata. Everyone filled in a block pays the same price. In-range bids cannot be withdrawn; out-of-range bids can. Prices "stay the same or trend upward".
- "When the auction ends, proceeds automatically create a Uniswap v4 pool at the discovered price." The design "incentivizes bidding early, reduces sniping, limits volatility". Built with Aztec.
- Sources: [Uniswap blog, Nov 13, 2025](https://blog.uniswap.org/continuous-clearing-auctions)
- Docs: `submitBid(maxPrice, amount)` requires maxPrice "strictly above the current clearing price". Each block's portion of supply goes to the highest max prices first. After `migrationBlock`, `migrate()` initializes the pool and positions. LP allocation, ranges, fund allocation and identity requirements are configurable — [Uniswap developer docs](https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/overview). Another docs page says the auction deploys a full-range LP position at the auction price — [Uniswap docs](https://docs.uniswap.org/contracts/liquidity-launchpad/Overview)
- Aztec: sale Dec 2–6, 2025 per The Block, though Uniswap's blog says Nov 2025. It raised 19,476 ETH (about $61.3M) from 16,700+ participants (The Block), or 19,388 ETH ($59M) from 16,741 (Unchained). It sold 14.95% of supply with a floor at $350M FDV and ended about 59–60% above the floor (final FDV $557M). Per-user caps were 240 ETH. 96% of bidders put in under $10k; the mean was about $4k. Uniswap reports "no clear sniping or automated price manipulation" — [The Block](https://www.theblock.co/post/381618/aztec-network-raises-over-60-million-in-eth-with-community-first-token-sale-testing-new-auction-model); [Unchained](https://unchainedcrypto.com/aztec-raises-59-million-in-token-sale-with-uniswaps-cca/); [Uniswap blog](https://blog.uniswap.org/aztec-cca)
- A later user: IGRA's "ZAP" auction on CCA (Mar 26, 2026; 3.5% of supply; $0.006 floor; issuer press release) — [Decrypt/Chainwire](https://decrypt.co/362180/igra-network-announces-igra-public-token-sale-via-continuous-clearing-auction-proven-at-59m-scale)

**Balancer Liquidity Bootstrapping Pools**
- Weights "change linearly over time". Current docs give examples of 90/10 to 20/80 (project/reserve), and an older page gives 1/99 to 99/1. Parameters are start and end weights per token, a swap window (`startTime`/`endTime`), and `blockProjectTokenSwapsIn`, which blocks sells back into the pool and is typically on for launches.
- Only the owner adds liquidity, before the start, and proceeds are withdrawable after the end. A "Fixed Price LBP" variant is "buy-only and seedless by default". After the sale, liquidity migrates to a weighted or reCLAMM pool via `LBPMigrationRouter`.
- Sources: [Balancer LBP docs](https://docs.balancer.fi/concepts/explore-available-balancer-pools/liquidity-bootstrapping-pool/liquidity-bootstrapping-pool.html); [Balancer LBP (older)](https://docs.balancer.fi/concepts/pools/liquidity-bootstrapping.html)
- Fjord Foundry is the main LBP front end, under an exclusive Balancer DAO collaboration — [Balancer LBP (older)](https://docs.balancer.fi/concepts/pools/liquidity-bootstrapping.html). Aggregate raise figures conflict ("over $1B" vs "over $750M" for Fjord and Copper; both secondary) — [Spark glossary](https://www.spark.money/glossary/liquidity-bootstrapping)

**MetaDAO launchpad ("unruggable ICOs", Solana)**
- After an ICO, "2M tokens will be paired with 20% of funds raised (USDC)" in the Futarchy AMM, with a 25 bps fee to MetaDAO — [0xResearch / Blockworks Research](https://blockworks-research.beehiiv.com/p/metadao-s-unruggable-icos)
- In Q4 2025 some ICO funds and tokens were migrated to both the Futarchy AMM and Meteora. Protocol revenue was $2.51M (54% Futarchy AMM, 46% Meteora LP) — [Pine Analytics Q4 2025](https://pineanalytics.substack.com/p/metadao-q4-2025-quarterly-report)
- Umbra (Oct 6–10, 2025) was the first launch on the Futarchy AMM. It was "1169% oversubscribed" over a $750k target per Blockworks; another outlet cites about $155M of commitments, which is not reconciled. Teams commit to futarchy-governed budgets (Umbra: $34k/month) — [Blockworks](https://blockworks.co/news/umbra-metadao-futarchy); [Crypto Briefing](https://cryptobriefing.com/futardio-44m-commitments-metadao-sourcing/)
- **Conditional-market structure.** MetaDAO's futarchy markets split spot META and USDC into pass and fail tokens via conditional vaults and trade them in two AMMs, one per branch. Proposers seed the initial liquidity, locked until the proposal ends. The decision is a TWAP of pass vs fail. Losing-branch trades revert — [Neodyme audit](https://www.neodyme.io/reports/MetaDAO.pdf). The newer Futarchy AMM "unifies spot liquidity with pass/fail conditional markets for each proposal and then self-arbitrages to keep prices synced" (podcast digest) — [Alea Research](https://alearesearch.io/podcast-digest/metadao-plasma-and-dats-crime-livestream)

**Echo / Sonar**
- Sonar is Echo's self-hosted public-sale product; it ran Plasma's XPL sale. Echo had processed more than $200M across about 300 deals. Coinbase acquired Echo for about $375M (Oct 2025) and plans to extend it to tokenized securities and RWAs — [Decrypt](https://decrypt.co/345168/coinbase-acquires-echo-375-million)

### Inferences
- Each mechanism gets to a deep AMM in two steps: (1) a discovery phase that sells a minted tranche for quote currency, then (2) depositing part of the proceeds plus a reserved minted tranche as LP at the discovered price. The depth at launch therefore equals the share of proceeds the issuer is willing to lock.
- LBPs exploit the fact that a weighted pool's spot price is (B_reserve / w_reserve) / (B_project / w_project). A high project-token weight lets a small reserve support a high starting price, much like pump.fun's virtual SOL. The weight shift then makes price fall over time without buying (a Dutch auction), which punishes bots that buy early.
- CCA, LBPs and Doppler all add a time dimension: price falls if nobody buys. Pure supply-indexed curves like pump.fun's lack that, which is why they need snipe taxes.
- MetaDAO's two-AMM conditional structure is the closest existing analog to Probabl's YES and NO books. Its Futarchy AMM shows that one spot liquidity position can be routed into both conditional branches, because splitting 1 token yields one pass and one fail token.

### Gaps
- Gnosis Auction / CoW batch auctions were not researched within the tool budget.
- Copper Launch specifics were not found.
- The CCA whitepaper (exact supply-schedule math, share of proceeds to LP) was not retrieved; the docs say this is configurable.
- MetaDAO's official Futarchy AMM docs and code (exactly how spot liquidity is split and merged) were not retrieved; current information comes from an audit and a podcast digest.
- The Plasma deposit-cap mechanics were not found.

---

## 4. Bonding curves applied to assets with an external reference price (tokenized stocks, RWAs, prediction-market shares)

### Takeaway
No case was found of a bonding curve issuing claims on an externally priced asset. Every stock-related launchpad case uses the tokenized stock as the **quote/numeraire** for a freely minted memecoin: pump.fun "Custom Pairs" with 93 quote assets including NVDA, TSLA and SPY, Pons on Robinhood Chain quoting in TSLA, NVDA, SPY and USDG, and Bankr and long.xyz. Where curves have been tried on prediction-market shares (PNP Exchange), mechanics are undocumented. The dominant venue, Polymarket, settled on a CLOB, and LPs were more profitable there than in its earlier AMM. The Robinhood Chain experience shows memecoin–stock pairs driving volume. In one case thin stock-token supply was cornered: tokenized HIMS traded at 4.6× its reference price until the issuer minted more.

### Cited Findings
- pump.fun now allows launches quoted in assets beyond SOL and USDC: "93 pairs including tokenized Nvidia, Tesla and the S&P 500". Half the revenue goes to PUMP buyback-and-burn, and the deepest new quote asset holds $3.07M of liquidity — [The Defiant](https://thedefiant.io/news/defi/pump-fun-lets-creators-launch-coins-priced-in-tokenized-stocks). The fee page confirms "Custom Pair coins" at flat 1.25% curve and 0.30% PumpSwap fees — [pump.fun fees](https://pump.fun/docs/fees)
- Pons V2 lists approved quote assets of native ETH, USDG (6 decimals), cbBTC, and tokenized stocks/ETFs such as TSLA, NVDA and SPY. Each launch has its own graduation threshold per quote asset — [Bitquery Pons docs](https://docs.bitquery.io/docs/blockchain/robinhood/pons-api/)
- Late July 2026: Robinhood Chain averaged $29.7M/day of tokenized-equity DEX volume over 7 days, above xStocks (about $11.1M) and Backpack/Sunrise (about $13.4M) combined. The driver was memecoin pairs: launchpads Bankr and long.xyz let users mint memecoins paired with tokenized shares across 90+ tickers. NVDA was the top stock at $13.9M/day. For scale, BNB Chain's bStocks did $676.8M/day — [Crypto Briefing](https://cryptobriefing.com/robinhood-chain-surpasses-solana-tokenized-stocks/); [The Defiant](https://thedefiant.io/news/blockchains/robinhood-chain-tops-solana-in-tokenized-stock-volume-via-memecoin-pairs)
- Sept 2, 2026 (unverified secondary): memecoin-vs-stock-token pairs did $217M, 71% more than the $127M traded directly against stock tokens. The memecoin BONER held 53% of circulating HIMS stock-token supply (31,198 of 58,714). Tokenized HIMS traded at $132.64 against a $28.84 underlying close (4.6×), and Robinhood minted about 4,000 tokens (about 6.8% of supply) to normalize it. Minting runs through a single authorized participant while trading is permissionless — [bit.com](https://www.bit.com/square/robinhood-chain-vs-solana-base-memecoin)
- PNP Exchange (Solana): "No orderbook, No illiquid markets. Trade your sentiments directly against the bonding curve". Market creation is permissionless and creators earn fees. Formula, fees and resolution are undocumented in the sources found; token mcap was about $105–191k in May 2026 — [MadeOnSol](https://madeonsol.com/compare/pnp-exchange-vs-polymarket); [FXEmpire](https://www.fxempire.com/crypto/pnp-exchange)
- Polymarket AMM vs CLOB: a TUM master's thesis (Sept 2025) found LP in the CLOB design "significantly more profitable" than in the AMM design, "where most potential profits are eroded by realised impermanent loss" — [TUM thesis](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf). Builder commentary says AMMs fail structurally for binary outcomes because one token always goes to zero (secondary) — [ChainUp](https://chainup.com/blog/polymarket-prediction-markets/). Polymarket's CLOB v2 cutover was Apr 28, 2026, alongside a $1M liquidity-rewards program for professional makers — [QuantVPS](https://www.quantvps.com/blog/polymarket-fixes-ghost-fills-clob-v2-upgrade)
- LMSR, the canonical "bonding curve" for outcome shares: cost C(q) = b·ln Σ exp(q_i/b), worst-case market-maker loss b·ln N, where b is the liquidity or subsidy parameter — [Gnosis LMSR primer](https://gnosis-pm-js.readthedocs.io/en/v1.3.0/lmsr-primer.html); [arXiv 1206.5252](https://arxiv.org/pdf/1206.5252)
- Oracle-anchored curve for assets with external prices (DODO PMM): the price is the oracle price i scaled by an inventory-imbalance factor, P = i·(1 − k + k(B₀/B)²) on one side, and the reciprocal form on the other. Here B₀ is the equilibrium balance and k ∈ [0,1] sets slippage. At B = B₀ the price equals the oracle. The secondary source's case conditions appear inverted (price should exceed i when base is depleted, B < B₀) — [BlockEden DeFi course](https://blockeden.xyz/course/defi/5.8/); [arXiv 2410.10162](https://arxiv.org/pdf/2410.10162)

### Inferences
- The market has chosen to pair curves *with* stock tokens, not to run curves *on* them. The curve asset is still something the issuer can mint for free, and the stock token is just the numeraire. That is the only configuration in which pump.fun's economics survive an external price anchor.
- The HIMS episode is a direct warning for Probabl. When collateral-token supply on chain is thin and minting is gated (a single authorized participant), the on-chain stock token can trade far from Chainlink's reference. Any oracle-anchored quoting would then be arbitraged through split and merge against the on-chain token price.
- With k = 0, PMM is a flat price at the oracle (a fixed-price sale). With k = 1 it reduces to P = i·(B₀/B)², the constant-product marginal-price shape. PMM therefore sits between a fixed-price sale and pump.fun, centered on an external price.

### Gaps
- No example was found of a bonding curve that issues or redeems tokenized-stock claims or other RWA claims, or LSTs, against an oracle; nor any "pump.fun for stocks" in that sense.
- No data was found on PNP Exchange volumes or curve design, or on other curve-based prediction markets (e.g., on Base).
- The exact date and reasons for Polymarket's original 2022 AMM-to-CLOB switch were not confirmed from a primary source.

---

## 5. The core economic reason a bonding curve "self-bootstraps", and which elements require minting

### Takeaway
pump.fun's "free liquidity" decomposes into four elements:
- **(a) Zero-cost minting** of the curve's inventory.
- **(b) Virtual reserves** that set price and depth with no capital.
- **(c) Recycling of buyers' payments** into post-graduation LP.
- **(d) Monotone price-in-supply** as the discovery rule.

The zero-capital property depends on (a), plus a closed-supply condition that makes (b) safe: the curve can only ever buy back tokens it sold. Without minting, (b), (c) and (d) survive only as a pricing function on top of real inventory that someone must post.

### Cited Findings
- (a) pump.fun mints the full 1B supply. 793.1M is "real token reserves" for sale on the curve, and the rest goes into the PumpSwap pool at migration — [PUMP_PROGRAM_README](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/PUMP_PROGRAM_README.md); [SYNTHETIC_MIGRATION.md](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/SYNTHETIC_MIGRATION.md). Pons and Zora likewise mint a fixed 1B supply to the curve or pool — [Bitquery Pons docs](https://docs.bitquery.io/docs/blockchain/robinhood/pons-api/); [Zora coin docs](https://docs.zora.co/coins/contracts/coin)
- (b) Virtual reserves: the 30 SOL and 1.073B-token starting reserves are synthetic, while real reserves move one-for-one with trades — [PUMP_PROGRAM_README](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/PUMP_PROGRAM_README.md). PumpSwap also prices on `vault + virtual_quote_reserves` — [NEGATIVE_VIRTUAL_QUOTE_RESERVES.md](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/NEGATIVE_VIRTUAL_QUOTE_RESERVES.md). LBPs achieve a similar effect with weights — [Balancer LBP docs](https://docs.balancer.fi/concepts/explore-available-balancer-pools/liquidity-bootstrapping-pool/liquidity-bootstrapping-pool.html)
- (c) Proceeds become LP: pump.fun pool quote = real quote raised minus migration fee, with LP burned. Pons seeds a locked full-range v4 position. CCA proceeds "automatically create a Uniswap v4 pool at the discovered price". MetaDAO seeds 20% of USDC raised. Doppler's lower slug is sized with `totalProceeds` so holders can sell back during the auction — [SYNTHETIC_MIGRATION.md](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/SYNTHETIC_MIGRATION.md); [Bitquery Pons docs](https://docs.bitquery.io/docs/blockchain/robinhood/pons-api/); [Uniswap blog](https://blog.uniswap.org/continuous-clearing-auctions); [0xResearch](https://blockworks-research.beehiiv.com/p/metadao-s-unruggable-icos); [Doppler.md](https://raw.githubusercontent.com/whetstoneresearch/doppler/main/docs/Doppler.md)
- (d) Discovery rule: deterministic and monotone in supply for pump.fun, Meteora and Pons. Supply plus time (Dutch auction) for Doppler and LBPs. Uniform-price batch for CCA — sources as above.

### Inferences
- **Why the virtual quote reserve is safe in pump.fun.** At launch, no tokens exist outside the curve except the migration tranche locked in the curve account. Every seller must therefore have bought from the curve first, so real SOL = ∫buys − ∫sells ≥ 0 at every point on the path, and the 30 virtual SOL can never be withdrawn. This **closed-supply condition** is what lets phantom liquidity quote a two-sided market with no capital. In the 2026 docs, PumpSwap's virtual quote reserves are a pricing offset (e.g., for uncollected fees), not withdrawable money.
- **Which elements require minting:**
  - (a) is minting by definition.
  - (b) needs the closed-supply condition. Under open supply — anyone can create the asset elsewhere and sell it into the curve — a virtual-reserve bid gets hit whenever it exceeds fair value and drains real reserves. Under open supply, (b) degrades to a shape parameter (depth, slippage) on top of real reserves.
  - (c) does not need minting, but in pump.fun the proceeds are "free" only because the inventory sold cost nothing. If the inventory was bought or posted, the proceeds belong to that capital provider. Recycling them into bids is ordinary market-making inventory management.
  - (d) does not need minting, but an unanchored monotone curve is only a valid discovery rule when no external price exists. Otherwise it is a free option for arbitrageurs.
- **Who pays for depth.** pump.fun's depth is paid for by later buyers, through the convex price path (average fill at 26% of the graduation price). Nobody can lose against "fair value" because no fair value exists. Where one exists, every quote away from it is a transfer from the liquidity provider to arbitrageurs. That is why LMSR needs a subsidy (b·ln N) and PMM needs real LP inventory.

### Gaps
- I found no academic paper that formally states the closed-supply condition for virtual-reserve curves; the argument above is derived from the documented reserve mechanics.

---

## 6. Known failure modes

### Takeaway
The documented failure modes:
- Deterministic first-block sniping and bundling.
- Creator, insider and "rug" dynamics, with roughly 99% of launches failing or being dumped.
- Fee-design gaming, e.g. Project Ascend rewarding coin creation over trading.
- Curve exhaustion and saturation (friend.tech's quadratic curve priced everyone out, then collapsed).
- Thin collateral pools that can be cornered (HIMS stock token at 4.6× its reference).
- Systematic LP losses in AMMs for binary outcomes.

The cure for each is either time-based price decay (Dutch auctions, CCA, LBP), uniform-price batching, or anchoring.

### Cited Findings
- Sniping and bundling: deployer-funded snipers bought in the same block across 15k+ launches in one month, with an 87% profitable-snipe rate — [Pine Analytics](https://pineanalytics.substack.com/p/exit-liquidity-machines). A bot taxonomy shows position-manipulation bots redistribute returns and attention bots distort them — [arXiv 2601.08641](https://arxiv.org/pdf/2601.08641)
- Mitigations in production:
  - Zora: 99% sniper tax decaying to 1% over 10 s — [Zora hook docs](https://docs.zora.co/coins/contracts/hook)
  - Pons: 99% snipe tax over 3 s — [Bitquery](https://docs.bitquery.io/docs/blockchain/robinhood/pons-api/)
  - Doppler: 80% to 1% fee decay — [Doppler docs](https://docs.doppler.lol/llms-full.txt)
  - Clanker: 2-block delay or first-swap auction — [Bankless](https://www.bankless.com/fr/read/clanker-v4-token-creator)
  - Flaunch: 30-min fixed-price window — [Flaunch](https://docs.flaunch.gg/features/fixed-price-fair-launch.md)
  - CCA: spreading bids and clearing at a uniform price, with Aztec showing "no clear sniping" — [Uniswap blog](https://blog.uniswap.org/aztec-cca)
- Rugs and pump-and-dumps: the Defiant headline on "99% of PumpFun memecoin launches are pump-and-dumps or rug pulls" — [The Defiant](https://thedefiant.io/news/defi/pump-fun-lets-creators-launch-coins-priced-in-tokenized-stocks). Graduation rates of 0.7–2.1% — [The Block](https://www.theblock.co/post/343742/pump-fun-rapid-decline-graduating-tokens-memecoin-frenzy-fizzles-out)
- Fee-design gaming: pump.fun's co-founder said the market-cap-tiered creator fees encouraged low-risk coin creation over trading, prompting the Jan 2026 change — [MEXC news](https://www.mexc.com/news/449516). After Project Ascend, creator payouts jumped from $198k to $2M a day — [Decrypt](https://decrypt.co/337872/pump-funs-new-fee-model-hands-out-2m-to-creators-in-first-24-hours)
- Curve saturation and collapse: friend.tech's quadratic curve put the 200th key at about 2.5 ETH. "The market is saturating quickly, pricing out almost everyone". TVL fell 91% and fees 99.9% — [Blockworks](https://blockworks.co/news/friend-tech-social-tokens-harmless); [MEXC news](https://www.mexc.com/news/85321)
- Token-value failure despite revenue: PUMP fell about 67% during $300M+ of buybacks — [CoinDesk](https://www.coindesk.com/markets/2026/04/29/pump-fun-burns-36-of-pump-supply-in-usd370-million-wipe-locks-50-revenue-into-ongoing-buybacks)
- Launchpad fee wars: LetsBonk took up to about 84% of launches in July 2025 — [The Block](https://www.theblock.co/post/366395/pump-fun-fends-off-letsbonk-in-battle-for-top-solana-memecoin-launchpad). Robinhood Chain launchpads cut pump.fun's fee share to 27% in July 2026, though "memecoin prices did not move" with that activity — [The Defiant](https://thedefiant.io/news/defi/pump-fun-launchpad-fee-share-falls-robinhood-chain-pons-noxa)
- Thin collateral pools cornered: HIMS stock token traded at 4.6× its reference until the issuer minted about 6.8% more supply (Sept 2, 2026; unverified secondary) — [bit.com](https://www.bit.com/square/robinhood-chain-vs-solana-base-memecoin)
- AMM LP losses for binary outcomes: realized impermanent loss erodes LP profits in Polymarket's AMM design — [TUM thesis](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf)
- Stuck migrations: on pump.fun, after the curve-emptying buy "no buys or sells are possible on the curve until the migration happens", which synthetic migration was introduced to smooth — [pump-public-docs README](https://github.com/pump-fun/pump-public-docs); [SYNTHETIC_MIGRATION.md](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/SYNTHETIC_MIGRATION.md)

### Inferences
- **External price anchor with a curve anchored to nothing.** If a static x·y=k curve were placed on an asset with a fair value, every price on it that differs from fair value would be arbitraged immediately. The curve's "discovery" would be nothing but arbitrageurs dragging it to fair value at the LP's expense. This is the same mechanism as AMM loss-versus-rebalancing, magnified by the curve's 14.7× designed price range.
- Anchoring moves the attack surface from first-block sniping to **oracle latency**. Trades against stale oracle or reference quotes, around news, at market open, or around Polymarket probability jumps, are the anchored-market equivalent of sniping. Fee decay should key off oracle staleness and volatility rather than time since launch.

### Gaps
- No quantitative study was found of losses for oracle-anchored AMMs (PMM-type) in conditional or prediction markets.
- The Solidus Labs rug-rate report was not opened directly.

---

## 7. Applicability to Probabl

### Takeaway
pump.fun's zero-capital trick does not transfer. Probabl cannot mint stock claims, and its claim supply is open: anyone can split real stock into YES and NO claims, or merge them back. That breaks the closed-supply condition that makes virtual reserves safe. Five elements do transfer:
1. **One deposit funds both branches.** Splitting 1 stock + 1 USDG yields inventory for the YES and NO books together, as MetaDAO's futarchy AMM does for pass/fail markets.
2. **A curve as a quoting function on real inventory**, centered on an external anchor (Chainlink stock price plus Polymarket probability) rather than free-floating.
3. **Doppler-style adaptive price movement** driven by net order flow.
4. **Recycling proceeds into a standing bid** (Doppler lower slug, Flaunch bid wall).
5. **An opening call auction** (CCA-style) to set the initial conditional spread.

The external anchor pins only a probability-weighted average of the two legs. What the curve must discover is one number per market, the conditional spread.

### Cited Findings
- Closed supply in pump.fun: all tokens are minted to the curve and its reserved migration tranche, and only curve buyers can sell back — [PUMP_PROGRAM_README](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/PUMP_PROGRAM_README.md)
- Conditional split-and-trade precedent: MetaDAO splits spot tokens into pass/fail tokens via conditional vaults and trades each branch in its own AMM, seeded by the proposer — [Neodyme audit](https://www.neodyme.io/reports/MetaDAO.pdf). Its newer AMM "unifies spot liquidity with pass/fail conditional markets ... and then self-arbitrages" — [Alea Research](https://alearesearch.io/podcast-digest/metadao-plasma-and-dats-crime-livestream)
- Demand-adaptive curves: Doppler shifts the curve down by (1 − sold/expected) × max tick delta when behind schedule, and up when ahead — [Doppler.md](https://raw.githubusercontent.com/whetstoneresearch/doppler/main/docs/Doppler.md)
- Proceeds as a standing bid: Doppler's lower slug is sized with `totalProceeds` (or sits at the average clearing price) — [Doppler.md](https://raw.githubusercontent.com/whetstoneresearch/doppler/main/docs/Doppler.md). Flaunch's PBW places a 0.1 ETH bid immediately below spot per 0.1 ETH of fees and follows price upward — [Flaunch auto-buybacks](https://docs.flaunch.gg/features/auto-buybacks.md)
- Oracle-anchored inventory curve: in PMM, price equals the oracle at equilibrium inventory, with k setting slippage away from it — [BlockEden DeFi course](https://blockeden.xyz/course/defi/5.8/)
- Bounded-loss subsidy: LMSR's worst-case loss is b·ln N (b·ln 2 for binary) — [Gnosis LMSR primer](https://gnosis-pm-js.readthedocs.io/en/v1.3.0/lmsr-primer.html)
- Uniform-price opening: CCA clears per block at a single price and seeds a pool at the discovered price — [Uniswap blog](https://blog.uniswap.org/continuous-clearing-auctions)
- Market evidence: binary-outcome AMMs lost LPs money to realized impermanent loss, and Polymarket's CLOB is more LP-profitable — [TUM thesis](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf)
- Collateral-token risk on Robinhood Chain: the HIMS stock token traded at 4.6× its reference because of thin supply and gated minting — [bit.com](https://www.bit.com/square/robinhood-chain-vs-solana-base-memecoin). Stock tokens there are used mainly as memecoin quote assets: Pons quotes in TSLA, NVDA, SPY and USDG — [Bitquery Pons docs](https://docs.bitquery.io/docs/blockchain/robinhood/pons-api/); [Crypto Briefing](https://cryptobriefing.com/robinhood-chain-surpasses-solana-tokenized-stocks/)

### Inferences
**No-arbitrage geometry (derived from Probabl's split/merge rules: 1 S → S_Y + S_N; 1 USDG → U_Y + U_N)**
- Let P_Y be the YES-book price (U_Y per S_Y), P_N the NO-book price, S the stock's USDG price, and p the YES probability.
- **Bound:**
  - If both P_Y and P_N exceed S: buy S, split, sell both legs, and merge min(P_Y, P_N) pairs of U_Y + U_N back into USDG. That is a riskless profit.
  - If both are below S: split max(P_Y, P_N) USDG, buy both legs, merge them into S, and sell S.
  - Therefore **min(P_Y, P_N) ≤ S ≤ max(P_Y, P_N)**, before fees.
- **Weighted average:** valuing U_Y at about p USDG gives **S ≈ p·P_Y + (1−p)·P_N**. Writing Δ = P_Y − P_N, this means P_Y = S + (1−p)·Δ and P_N = S − p·Δ.
- The Chainlink price and Polymarket p fix everything except Δ, so the books need to discover **one scalar per market**. A bonding-curve-style rule, Δ as a monotone function of net YES-leg demand minus net NO-leg demand, fits a one-dimensional discovery problem exactly.

**Transfers (with modification)**
1. **Pair-split capital efficiency (replaces "free minting").** A vault depositing x stock and y USDG splits them into x S_Y + x S_N and y U_Y + y U_N. That gives full two-sided inventory on *both* books from one deposit, and the same depth on YES and NO as a single spot pool of (x, y). This is the MetaDAO Futarchy-AMM pattern. It is the only "free" element Probabl has: half the capital of seeding two independent books. It is still real capital, though; nothing is minted from nothing.
2. **Virtual reserves as a depth parameter only.** Use a PMM-like k, LMSR-like b, or Meteora/Doppler-like segment liquidity to set how fast quotes move away from the anchor. Never quote beyond real inventory. Because anyone holding stock can split and hit the bid side, the bid side must be funded with real U_Y and U_N, and the curve must enforce a floor at real reserves. A pump.fun-style "phantom" bid would be drained.
3. **Anchor the center, discover the spread.** Mid prices come from S (Chainlink, cross-checked against the on-chain price of the stock token itself, given the HIMS episode) and p (Polymarket). The initial prior is Δ = 0: the conditional prices equal spot, which says the event has no information about the stock. Δ then moves with net flow, like Doppler's tickAccumulator, rather than with absolute supply sold. The curve is never "exhausted" because it re-centers on the oracle.
4. **Discretize the curve as resting orders.** Meteora's at most 16 segments and Doppler's slugs show a curve can be a few liquidity ranges. On Probabl's order books that means a ladder of protocol or vault limit orders around the anchored mid, re-posted when S, p or Δ moves. It sits behind third-party makers (maker of last resort), not instead of them. This preserves price discovery on both legs: the book, not the curve, sets the best price whenever real makers are tighter.
5. **Proceeds recycling.** When the vault sells S_Y for U_Y, that U_Y can be re-posted as YES-book bids, as in Doppler's lower slug or Flaunch's bid wall. This keeps two-sided depth without new capital, but it is the vault's own P&L, not a free subsidy.
6. **Bounded subsidy budget.** Borrow LMSR's framing: cap the vault's maximum inventory skew so that worst-case loss to informed flow is a known budget, analogous to b·ln 2 per market. Size it per market at creation, the way per-market fees already are.
7. **Opening call auction.** A CCA-style uniform-price auction per leg, or joint across legs, can set the initial Δ and seed the books at the clearing price. It avoids the first-taker-picks-off-the-seed problem. Sellers in the auction must be split-holders (vault or LPs), since nothing is minted.
8. **Dynamic fees, re-targeted.** The equivalent of a snipe tax should key off oracle staleness, Chainlink deviation, Polymarket probability jumps and market-hours transitions, not time since launch.

**Does not transfer**
- **(a) Free minting.** Fully collateralized claims cannot be created without real stock and USDG. pump.fun's zero-LP-capital property is therefore unavailable.
- **(b) Phantom quote reserves on the bid side.** Probabl has open supply (split and merge), which violates the closed-supply condition.
- **(d) Unanchored monotone price-in-supply.** With an external price, a pump.fun curve's 14.7× designed range is pure arbitrage leakage. Each quote away from p·P_Y + (1−p)·P_N is a free option, and the curve would be dragged to fair value at the LP's expense.
- **Graduation with burned or permanently locked LP.** Burning LP is costless in pump.fun only because the inventory was free. Here it would destroy real collateral. Probabl markets also expire at event resolution, so "permanent" liquidity has no meaning; at resolution, losing-branch claims are worthless and vault inventory converts to whichever branch won.
- **Memecoin demand mechanics.** Early-buyer convexity, attention lotteries and creator fees drive pump.fun volume. Probabl claims have bounded, anchored values, so there is no reflexive reason to buy early. Bootstrapping must come from the opening auction, vault depth and incentives, not from curve convexity.
- **Pure AMM replacement of the books.** Polymarket's experience (AMM LPs bled realized IL; CLOB more profitable) argues for a curve or vault *behind* the order book, not instead of it.

**Specific risks for a Probabl curve or vault**
- **Collateral-token dislocation.** If the on-chain NVDA token trades away from Chainlink (cf. HIMS at 4.6×), arbitrageurs can merge S_Y + S_N bought from an oracle-anchored vault into the token and sell it on-chain, or the reverse. Guard with a deviation check between the on-chain token price and the oracle, and pause or widen when it breaches.
- **Stale probability.** If p lags Polymarket, both legs are mispriced in opposite directions. Δ-based quoting needs p with low latency, and fees that widen on p moves.
- **Correlated toxic flow at news.** Event news moves both p and Δ at once, which is exactly when the vault should widen. This is the anchored analog of launch sniping.

### Gaps
- No live example was found of a bonding curve or oracle-anchored AMM on fully collateralized conditional claims of an externally priced asset. MetaDAO's pass/fail AMMs are the nearest analog, and no performance data was found for them.
- No empirical study was found of LP losses for oracle-anchored (PMM-type) market makers in conditional or prediction markets, so the vault subsidy budget cannot yet be calibrated from data.
- The relation S ≈ p·P_Y + (1−p)·P_N assumes U_Y trades at about p in USDG. Probabl has no U_Y/USDG market and takes p from Polymarket, so basis risk between Polymarket's p and Probabl's implied p is unquantified.
