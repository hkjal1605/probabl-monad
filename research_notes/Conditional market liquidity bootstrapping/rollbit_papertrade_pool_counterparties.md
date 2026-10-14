# Rollbit, Papertrade and Pooled or House Counterparties at Oracle Prices: How They Provide Liquidity on Day One

Research date: 2026-10-11. Facts are marked with dates. "(historical)" marks facts older than about 12 months. Where a source is secondary, an aggregator, or AI-written, the note says so.

---

## 1. Rollbit: how its 1000x futures work, who takes the other side, prices, fees, limits, RLB tokenomics, launches in 2025–2026, documented problems

### Takeaway
Rollbit is a custodial casino whose "futures" are synthetic bets against the house. Users enter at an internal index price, with no order book. The house earns either a flat fee of about 4 bps plus a size-dependent slippage fee, or a "PnL cut": a haircut on winning trades that shrinks as the price move grows and is the direct template for Papertrade's fee. The house protects itself with per-user aggregate position limits (default $1M), leverage cuts during volatility, and an effective edge of roughly 10–30% on high-leverage flow. It publishes no bankroll, hedging policy or index method. As of Oct 2026 I found no Rollbit launch of stocks, FX or prediction markets in 2025–2026. The product is still crypto only.

### Cited Findings
**Counterparty and pricing**
- Each Rollbit futures position is "a synthetic wager against the house rather than an order matched through a book". The platform lists 60+ crypto markets, majors plus "a long tail of meme coins". It mentions no stocks, FX or commodities. Leverage runs from 1x to 1000x and is cut on volatile assets during turbulent sessions. Trades fill at the displayed price. (Review last updated Aug 25, 2026.) — [Datawallet Rollbit review](https://www.datawallet.com/crypto/rollbit-review)
- Rollbit says it uses a "unique price-formulation strategy" to make its index resistant to manipulation, and points to a separate on-site page. The blog post does not name the source exchanges. (Jul 21, 2023, historical.) — [Rollbit blog, 1,000x Leverage Crypto Futures](https://blog.rollbit.com/1000x-leverage-crypto-futures/)
- Delphi (Jul 14, 2023) wrote that Rollbit "appears to take the opposite side of each trade". It speculated, without confirmation, that Rollbit may hedge on CEXs or build an insurance fund. — [Delphi Digital, How Has Rollbit Done Over $72B In Futures Volume](https://members.delphidigital.io/feed/how-has-rollbit-done-over-72b-in-futures-volume-last-month)
- The original 2021 product framed leverage as "payout multipliers" from x1 to x1000. The bust price is "the price at which the entire wager is lost". The maximum wager was $1M. (May 11, 2021, historical.) — [Rollbit blog, Trading Cryptocurrencies on Rollbit](https://blog.rollbit.com/trade-cryptocurrency-on-rollbit/)

**Fees, bust and funding**
- Two fee modes (2023). (a) Flat Fee: the user prepays 4 bps for entry and exit, plus a slippage fee that depends on position size and is shown up front. (b) PnL Cut: no fee to open or close, but a percentage of profit that "depends on position size, holding time and leverage". RLB holdings give up to 60% off either mode. — [Rollbit blog (2023)](https://blog.rollbit.com/1000x-leverage-crypto-futures/)
- The 2021 blog describes the profit fee as a sliding scale that "takes a smaller percentage after larger price moves". — [Rollbit blog (2021)](https://blog.rollbit.com/trade-cryptocurrency-on-rollbit/)
- Funding is charged or paid hourly, but only on positions held longer than 8 hours. Longs pay when the market is bullish and shorts pay when it is bearish. Funding comes out of the user's balance, and a position can be auto-closed if the balance runs short. No formula is published. — [Rollbit blog (2023)](https://blog.rollbit.com/1000x-leverage-crypto-futures/)
- **The market-impact (PnL-cut) formula, reconstructed.** Papertrade's docs say its haircut "is adapted from Rollbit's market-impact model". They also say that "in Rollbit's original formulation, term2 scales with the actual position notional, so the haircut percentage grows with trade size." Papertrade's version is scale = (1 − baseRate)/(1 + 1/(move·rateMultiplier) + notional/(10⁶·move·positionMultiplier)), where Rollbit's original uses the position's actual notional. — [Papertrade docs, Asymmetric impact PnL](https://docs.papertrade.xyz/). Sumcap's simulation used "Rollbit's published x1000 values for baseRate, rateMultiplier and positionMultiplier", which implies Rollbit publishes those parameters on its site. — [Sumcap, The House Always Wins (Aug 3, 2026)](https://www.sumcap.xyz/blog/the-house-always-wins)
- Delphi's author estimated an effective house edge of about 10–30% under the PnL model, depending on leverage. On Rollbit, a 1000x long effectively gets "~700x–900x on the upside and 1000x on the downside". (Jul 2023, historical; author holds RLB.) — [Delphi Digital](https://members.delphidigital.io/feed/how-has-rollbit-done-over-72b-in-futures-volume-last-month)
- Delphi (Dec 1, 2023) reported fees in the "mid-single-digit basis points for trades in the mid-7-figure range, inclusive of slippage", with smaller positions paying less. — [Delphi Digital, Rolling the Dice on Rollbit Fundamentals](https://members.delphidigital.io/reports/rolling-the-dice-on-rollbit-fundamentals)

**Size limits and house protection**
- The default aggregate open-position limit is $1,000,000 for most users. BTC and ETH match the $1M aggregate limit, and APE and PEPE are capped at $300,000. Users can request increases, which the "trading team" reviews, usually within 24h. Max leverage "may be temporarily reduced during high volatility". (Jul 2023.) — [Rollbit blog (2023)](https://blog.rollbit.com/1000x-leverage-crypto-futures/)

**Scale (historical)**
- Co-founder "Lucky" said futures did over $72B in volume in the prior 30 days, of which over $70B used the house-edge (PnL) fee model. (Jul 2023.) — [Delphi Digital](https://members.delphidigital.io/feed/how-has-rollbit-done-over-72b-in-futures-volume-last-month)
- About $680M annualized 30-day revenue run rate and about $104M annualized buyback (trailing 30 days). The buyback was "typically ~15% of revenue". (Dec 2023.) — [Delphi Digital](https://members.delphidigital.io/reports/rolling-the-dice-on-rollbit-fundamentals)
- A 2023 report put the revenue mix at about 69% casino, 18% futures and 13% sportsbook. — [Alea Research thesis (via search excerpt)](https://alearesearch.io/theses/rollbit-rlb)

**RLB tokenomics (how house revenue flows back)**
- Each hour Rollbit buys RLB with 10% of casino, 20% of sportsbook and 30% of futures earnings. It burns 90% of each purchase and sends 10% to staked Rollbot NFT holders. About 24.3M RLB ($1.54M) was removed in March 2026. Supply fell below 1.6B in Aug 2026 against an original 5B. The review's phrase "about 68% of the original" contradicts that arithmetic: 1.6B is about 32% remaining, so the 68% probably means the share burned. RLB trades around $0.06, more than 75% below its late-2023 peak, and gives no claim on the company. — [Datawallet (Aug 2026)](https://www.datawallet.com/crypto/rollbit-review)
- Buybacks are on-chain on Uniswap V2 and have run hourly since Oct 3, 2023. — [Alea Research (via search excerpt)](https://alearesearch.io/theses/rollbit-rlb)
- A CoinMarketCap AI-generated update (low quality) says Rollbit reconfirmed a supply hard cap on Mar 24, 2026, with about 3.275B RLB burned. — [CMC latest updates](https://coinmarketcap.com/cmc-ai/rollbit-coin/latest-updates/)
- The buyback does not fund trading liquidity. The bankroll is the company's own balance sheet. No source documents its size.

**Launches in 2025–2026**
- I found no announcement of Rollbit stocks, FX or prediction markets in 2025–2026. The 2026 items I found are a burn update, a Mar 24, 2026 supply-cap reconfirmation and an Apr 1, 2026 "space gambling" promotion. CMC's mention of "leveraged trading on gold-backed assets" is speculation. — [CMC latest updates](https://coinmarketcap.com/cmc-ai/rollbit-coin/latest-updates/); [Datawallet](https://www.datawallet.com/crypto/rollbit-review)

**Regulation and documented problems**
- Bull Gaming N.V. holds Curaçao license OGL/2024/1260/0494, which covers games of chance. The leveraged futures product has no securities or derivatives oversight anywhere. Rollbit blocks 29 jurisdictions, including the US, and requires ID for withdrawals. — [Datawallet (Aug 2026)](https://www.datawallet.com/crypto/rollbit-review)
- Aug 2026: Protos reported a 128-page pseudonymous dossier tying co-founder Lucky to CSGO skin-gambling controversies and refused withdrawals. Co-founder Razer denied the identification. The claims are untested. — [Datawallet](https://www.datawallet.com/crypto/rollbit-review)
- Analysts have questioned Rollbit's reported revenue figures and dashboards. One noted that a dashboard counted betting volume as revenue. — [Blockcrunch (via search excerpt)](https://blockcrunch.substack.com/p/rollbit-rlb-a-house-of-cards-or-hitting)
- Papertrade's own docs say "Rollbit-style platforms still face the same solvency anxiety from users". This refers to a custodial house that does not prove its bankroll. — [Papertrade docs, Martingaler LP](https://docs.papertrade.xyz/)

### Inferences
- Rollbit's day-one liquidity is simply the house balance sheet plus per-user caps. That works only because it is custodial, opaque and backed by casino cash flow. The transferable idea is its fee design: charge winners on realized PnL, steeply on small moves. That design targets the flow the house fears most, which is many small, high-frequency winning trades such as latency scalps. It also lets the venue advertise "zero spread".
- The high effective edge (10–30%) comes from the extreme leverage and the liquidations it causes. A fully collateralized spot venue cannot rely on that.

### Gaps
- Rollbit's price-formulation page, current PnL-cut parameter values, bankroll size, hedging policy and any proof of reserves. rollbit.com timed out and help.rollbit.com returned HTTP 403 from this (US) location.
- No recent (2025–2026) futures volume or revenue data from a primary source.
- No documented Rollbit toxic-flow or oracle-manipulation incident found. That is not evidence that none occurred.

---

## 2. "PaperTrade": which product it is, how it bootstraps liquidity, and what traction it has

### Takeaway
"PaperTrade" is almost certainly **Papertrade (papertrade.xyz)**. It is a 1000x BTC/ETH perps venue on HyperEVM (Hyperliquid's EVM layer) that opened deposits Oct 8 and trading Oct 10, 2026, one day before these notes. Its "Martingaler LP" starts at **$0**, accepts no outside deposits, and grows only from trader losses. Winners the pool cannot pay join a **FIFO payout queue**, which is on-chain debt paid from later losses. Losers are minted **PAPER**, a claim on the house's fees, at up to 100 PAPER per $1 lost. Prices come straight from Hyperliquid's BBO mid via a precompile, with no deviation breaker. The house edge comes from a Rollbit-derived haircut on winning PnL and from hard-bust liquidations at 1000x. Launch-day numbers are large but inconsistent across sources, and an unconfirmed oracle-manipulation allegation surfaced on day one.

### Cited Findings
**Identification**
- Papertrade's docs describe it as "a fair-launched, fully on-chain perpetuals exchange built on Hyperliquid", with "1000× leverage, one-click Buy/Sell, no orderbook, zero slippage, no funding costs, **self-bootstrapping LP**, no spread". — [Papertrade docs](https://docs.papertrade.xyz/). The docs are rendered by JavaScript. I read the text from the site's bundled docs content.
- Deposits opened Oct 8, 2026 and Phase 1 trading started Oct 10, 2026. Co-founders are "Jez and Blurr". — [Bankless](https://www.bankless.com/read/what-to-know-about-papertrade-s-launch); [TechFlow](https://www.techflowpost.com/en-US/article/34469). TechFlow names Jez as Colin Hong (MIT, Morgan Stanley, Venture Partner at Standard Crypto, per a WPT profile). It says the team is "two or three people" with undisclosed funding. Guardian Audits was engaged, but no report was public as of Oct 2. — [TechFlow](https://www.techflowpost.com/en-US/article/34481)
- A Bitget Wallet dApp listing describes a "Papertrade" with virtual tokens and a Q4 2026 TGE. It links to papertrade.xyz, contradicts itself, and is flagged as AI-assisted. It is best read as a bad listing of the same project, not a separate product. — [Bitget dApp page](https://web3.bitget.com/dapp/papertrade-33118)
- Papertrade's docs explicitly cite Rollbit as the inspiration for the haircut. That explains why the user named Rollbit and PaperTrade together. — [Papertrade docs](https://docs.papertrade.xyz/)

**Counterparty and price**
- "All trades on Papertrade are synthetic swaps between the user and the LP: no orderbook, no matching engine, no other counterparty." The contract reads Hyperliquid's **BBO mid** through the precompile at 0x…080e at open and again at close. No perpetual is traded on Hyperliquid, so there is no funding and no hedging. — [Papertrade docs, How it runs / Pricing](https://docs.papertrade.xyz/)
- PriceOracle reverts only on a zero or crossed book. It "has no maximum-deviation, time-weighted-price, or lookback breaker", so "a non-zero, uncrossed but manipulated BBO can therefore be accepted". An attacker can shift the mid "by a tick or two" by resting a small inside order that never fills. — [Papertrade docs, Risk](https://docs.papertrade.xyz/)
- Only markets that already exist on Hyperliquid's book can be listed, "including HIP-3 markets" (for example trade.xyz stock perps). BTC and ETH are live today. — [Papertrade docs, FAQ](https://docs.papertrade.xyz/)

**Self-bootstrapping LP (Martingaler) and payout queue**
- "The LP… starts at $0. There is no seed capital, no founders' deposit, no upfront LP raise." Nobody can deposit to the LP. The only exposure is through holding or staking PAPER. — [Papertrade docs, The LP and the payout queue](https://docs.papertrade.xyz/)
- If the LP cannot pay a winning close, "the unpaid portion of the win goes into a FIFO queue… paid out from the front as future losses refill the LP". "Your USDC margin is never queued." Only profit can be queued. While a queue exists, loss proceeds are earmarked in a `sideBucket` for queued payouts, and loss and liquidation fees are waived. Treasury and sideBucket are unsigned values, which gives "temporary insolvency by design". — [Papertrade docs, Solvency & queue](https://docs.papertrade.xyz/)
- The mechanism summarizes a "Martin Galer whitepaper", a pseudonymous author. It was "designed to launch an asynchronous speculation game with no upfront LP capital and no constraints on bet size". Token emissions "let a positive-house-edge game present as +EV for the player by remunerating realised losses with a claim on future protocol value". — [Papertrade docs, Martingaler LP](https://docs.papertrade.xyz/)

**How the house earns (size and price handling)**
- No spread, no notional fee and no funding. On a winning close there are three deductions: (1) a 0.2 bps "jitter-protection deadband"; (2) an asymmetric-impact haircut, scale = (1 − baseRate)/(1 + term1 + term2), with term1 = 1/(move·rateMultiplier), term2 = referenceNotional/(10⁶·move·positionMultiplier) and move = |exit − entry|/entry; (3) a 2% win fee. BTC and ETH both use baseRate 10%, rateMultiplier 15,000 and referenceNotional $100,000. positionMultiplier is 814.598 for BTC and 483.979 for ETH. A BTC win keeps about 88% of raw gain on a 1% move and about 74% on a 0.1% move. A win never keeps more than 90% before the fee. — [Papertrade docs, Asymmetric impact PnL](https://docs.papertrade.xyz/)
- Losing closes and liquidations carry a 2% fee "carved from the LP's gain, not added to your loss", charged only when the queue is empty. — [Papertrade docs, FAQ](https://docs.papertrade.xyz/)
- The bust trigger sits about 5 bps before zero equity. Crossing it "forfeits the full isolated margin". Papertrade runs the liquidation keeper at the highest priority fee. — [Papertrade docs, Liquidations](https://docs.papertrade.xyz/)
- Limits: each position's notional (margin × leverage) can be up to $10M. Positions are isolated and cannot be modified. Directional OI caps are set per side: the keeper targets "current OI plus $1 billion of BBO-valued headroom" with a 10% hysteresis band. The docs say this is "not a… loss ceiling". — [Papertrade docs, FAQ / Risk](https://docs.papertrade.xyz/)
- Operations and access: every open and close goes through Papertrade's relayer, signed by a session key that lasts 30 days, with each intent valid for 1h. A pause guardian can "retire" a market, which freezes the BBO permanently for closes. Contracts are upgradeable proxies. — [Papertrade docs, Risk / Architecture](https://docs.papertrade.xyz/)
- Deposits are accepted in USDC from Hyperliquid, HyperEVM, Ethereum, Arbitrum and Solana, **and USDG from Robinhood Chain** (via Across). — [Papertrade docs, Deposits](https://docs.papertrade.xyz/)

**PAPER token**
- Supply starts at zero, with no premine, team allocation, VC allocation or airdrop. PAPER is minted only on realized losses. The rate is 100 PAPER per $1 while tracked LP is below $2M (including when it is underwater). Above that, the rate is 100·(S/(S+H))² with S = $120M, where H is a one-way high-water mark of cumulative LP gain past the threshold. Stakers earn half of every 2% fee (that is, 1% of realized PnL) while no queue exists, plus all LP gains above a **$5M staker reward cap**. PAPER cannot be transferred at launch. — [Papertrade docs, PAPER mint curve / Staking](https://docs.papertrade.xyz/)

**Simulations before launch (model outputs, not live data)**
- Sumcap (Aug 3, 2026) replayed 3.6M Hyperliquid trades across 608 scenarios. All runs stayed solvent, and 81.2% never queued a winner. The largest unpaid balance was $61,974. Reaching $5M took about 5 days at full flow and about 14 days at 25% flow. Liquidations are the real edge: 88.1% of BTC and 93.1% of ETH trades paid the LP. Traders lost 73¢ per $1 of margin at full flow. — [Sumcap](https://www.sumcap.xyz/blog/the-house-always-wins). TechFlow notes the simulation repo had one commit and no independent reproduction. — [TechFlow](https://www.techflowpost.com/en-US/article/34481)
- Blockworks Research (May 15, 2026) assumed 1% of Hyperliquid's BTC and ETH flow. Winners netted about $80.6M and losers lost about $79.9M, yet the LP grew because of the winner haircut. "10/10"-type liquidation days were especially lucrative for the LP. — [Blockworks Research](https://blockworks-research.beehiiv.com/p/lose-money-earn-tokens)

**Traction, Oct 8–11, 2026 (preliminary and inconsistent)**
- Pre-deposits were about $85.3M by DefiLlama. — [cryptonews.net](https://cryptonews.net/news/market/33571495/). Crypto Briefing reported more than $137M from 11,473 addresses. — [Crypto Briefing](https://cryptobriefing.com/papertrade-3b-open-interest-launch/)
- Launch was at 10:00 ET on Oct 10. Notional volume was $14.4B in under 10 minutes. BTC OI reached $3B and ETH OI $2.66B shortly after launch. Relayers were whitelisted for launch congestion. — [Crypto Briefing](https://cryptobriefing.com/papertrade-3b-open-interest-launch/)
- BlockBeats (via KuCoin) reported over $80B of notional in the first hour; the headline says $800B, contradicting the body. It also reported $4.73M of accumulated user losses and LP above $2M, so emissions had entered the decay phase. — [KuCoin flash](https://www.kucoin.com/news/flash/papertrade-notional-volume-surpasses-800-billion-users-lose-4-73m-to-earn-paper-tokens)
- Crypto Briefing (Oct 10) reported the LP at about $3.15M "shortly after launch" and TVL at about $102M across about 11,000 addresses. Stakers received over $10M USDC in the opening hours ($10M–$12.6M+). PaperDash estimated net realized trader losses at $18M–$28M. The Defiant reported an **oracle-manipulation allegation**, which is unconfirmed and had no reported team response. — [Crypto Briefing](https://cryptobriefing.com/papertrade-oracle-manipulation-allegation-pool/)

### Inferences
- The volume and OI figures are notional at up to 1000x leverage. $3B of BTC OI on roughly $100M of TVL implies a very high average leverage. These figures say nothing about real depth. They do show that "zero slippage at an external mid" plus a token reward for losing attracts flow at once, without any market maker.
- The model works only when (a) the traded asset has a deep external book to use as the price, (b) the house has a positive edge, mostly from liquidations, and (c) winners accept delayed payment. The LP holds no hedge. Its "depth" is just the OI caps.
- The staker numbers suggest the LP passed its $5M cap almost at once, with overflow going to stakers. Within hours, the house was paying out loss cash rather than holding it as a buffer.
- The design has known attack routes. The docs admit BBO manipulation is open, the curve only partly mitigates it, and pairs of long and short positions can be used to farm PAPER cheaply ([Bankless](https://www.bankless.com/read/what-to-know-about-papertrade-s-launch)).

### Gaps
- No verified queue size, LP balance history, total PAPER minted or on-chain contract addresses. The docs still listed contract addresses as "TBA" when I read them.
- No public audit report as of Oct 2. No detail on the substance of the oracle allegation.
- Two days of history are too short for any solvency conclusion.

---

## 3. Perps and synthetics where a pool takes the other side at an oracle price (GMX, gTrade, Ostium, Avantis/Veranta, Jupiter, Synthetix, Hyperliquid HLP and HIP-3, Drift): price impact, hours, oracle latency, LP outcomes, incidents

### Takeaway
The lesson from 2022–2026: "zero price impact at the oracle price" (GMX v1 2022) gets exploited by anyone who can move the reference price elsewhere. Pools that survive add four things: (1) price impact from **OI skew** or **external depth**, (2) **per-side OI caps** sized to the vault, (3) a **fresh price pulled at execution** plus delays or close-fee decay against latency arbitrage, and (4) **closed-hours handling** (pause, off-hours risk settings, or bounded internal pricing). The newest RWA venues (Ostium after its 2026 upgrade, Veranta) have moved toward **hedging the vault off-chain with market makers**. Their pool mainly settles trades. The biggest 2025–2026 losses came from **operational and oracle-signer compromises**, not from trading flow: GMX v1 lost about $42M (Jul 2025), Ostium about $23.75M (Jul 2026), and Drift about $285M (Apr 2026).

### Cited Findings
**GMX (Arbitrum and Avalanche)**
- v1 GLP had minimal spread and zero price impact. In Sept 2022, a trader opened large AVAX positions at zero slippage, moved AVAX on CEXs and repeated about 5 times. The take was an early estimate of about $565k, later put at $500k–$700k gross. GMX capped AVAX OI at $2M long and $1M short. Genesis's Joshua Lim said "GMX was functioning as intended" because it offers unlimited liquidity at the oracle average. (Historical.) — [crypto.news](https://crypto.news/gmx-dex-suffers-565000-exploit-on-avalanche-avax/); [Forklog](https://forklog.com/en/trader-used-gmx-to-manipulate-avax-price/)
- Jul 9, 2025: GMX v1 lost about $42M on Arbitrum. A reentrancy in executeDecreaseOrder let the attacker open a short that skipped ShortsTracker, which inflated AUM and the GLP price. Funds were largely returned, with a white-hat bounty of about $5M. — [CertiK](https://www.certik.com/blog/gmx-incident-analysis); [Sherlock](https://sherlock.xyz/post/gmx-exchange-hack-explained). GLP and v1 trading were phased out from July 2025. — [GMX docs, Liquidity on V1](https://docs.gmx.io/docs/archived/liquidity-v1.md)
- v2 (current) price impact = (initialImbalance^exponent × factor) − (finalImbalance^exponent × factor), where imbalance is long OI minus short OI. Trades that reduce imbalance get **positive** impact, that is, a better price. The impact is charged only on decrease ("net price impact"), and entry is at the oracle price. Negative-impact caps are 50 bps for majors and 75–1000 bps for thinner markets. SPY and QQQ are capped at 150 bps. Positive impact is capped at 40 bps. A virtual inventory across correlated markets stops traders from offsetting impact in other markets. — [GMX docs, Fees](https://docs.gmx.io/docs/trading/fees)
- GMX v2 TradFi markets (SPY, QQQ, SPCX, metals, energy) trade **24/7**, switching between on-hours and off-hours risk settings. Equities are "on-hours" Mon–Fri 09:45–15:45 New York time. SPY and QQQ max leverage drops from 50x to 25x off-hours, with higher position and borrow fees. Commodity liquidation factors rise from 0.5% to 0.8% off-hours. Off-hours oracle freshness thresholds persist for 10 min after reopen. — [GMX docs, TradFi markets](https://docs.gmx.io/docs/trading/tradfi-markets)

**Gains Network gTrade (Arbitrum, Base, Solana, and others)**
- gToken vaults (gUSDC, gDAI, gETH, gGNS, gBTCUSD; ERC-4626) are "a counterparty to all trades". The gToken price is 1 + accRewardsPerToken − max(0, accPnlPerTokenUsed). Net trader losses build an over-collateralization buffer. When the vault is over-collateralized, part of trader losses buys and burns GNS OTC. When under-collateralized, GNS is minted and sold OTC, capped at 0.05% of supply per 24h (18.25% per year), to refill the vault. Open PnL is snapshotted by oracles per epoch. Withdrawals wait 1–3 epochs depending on collateralization, to stop LPs front-running PnL. The vault has "proven positive for 2+ years" (the docs' own claim). — [gTrade docs, gToken Vaults](https://docs.gains.trade/liquidity-farming-pools/gtoken-vaults)
- Price impact = fixed spread + liquidity impact + skew impact. Liquidity impact ≈ (recent OI on that side + size/2) ÷ "1% depth" taken from **Binance order-book depth bands**. Skew impact is unpublished: trades that reduce imbalance can get better than the oracle price. **Stocks, indices and commodities are fixed-spread only.** Stock fees are 3–5 bps per side. The vault gets 15% of fees. — [gTrade docs, Fees and spread](https://docs.gains.trade/gtrade-leveraged-trading/fees-and-spread)
- **Protection against oracle latency:** a closing-fee multiplier = 1 + (S − 1)·((D − e)/D)^(k+1), with S = 30x, D = 40 blocks (about 10s on Arbitrum) and k = 3. Closing after about 2s costs about 19.20 USDC instead of 1.491 USDC. — [gTrade docs, Fees and spread](https://docs.gains.trade/gtrade-leveraged-trading/fees-and-spread). The v9.2.1 changelog applies closing impact only when net PnL is positive and splits spread and impact 50/50 between open and close. — [gTrade v9.2.1 changelog](https://docs.gains.trade/developer/technical-reference/contracts/changelogs/v9.2.1-update)
- Stocks: 1.1x–50x. Trading runs only Mon–Fri 9:35–16:00 ET. Positions stay open while closed but cannot be opened, closed or edited. "Stop losses are not guaranteed" across gaps. Max leverage is cut and spread widened **3h before to 10 min after major USD news**, **from 1h30m before the close**, and **1–2 days before earnings and dividends**. US users are geo-blocked. — [gTrade docs, Stocks](https://docs.gains.trade/gtrade-leveraged-trading/asset-classes/stocks)

**Ostium (Arbitrum; RWA perps)**
- Current design (docs last updated Jul 22, 2026): directional flow is **hedged off-chain via institutional partners ("market makers like Jump", prime brokers)**. A daily settlement run moves USDC between the on-chain vault and the off-chain hedge book. OLP is the **senior tranche**. A **junior buffer posted by Ostium affiliates and strategic partners absorbs trader PnL first, in full**. OLP earns only 30% of opening fees. Before the upgrade, OLP APR ranged from about −4% to +50% when OLP was the junior counterparty. If the buffer is depleted, the vault enters an "under-collateralized state" and blocks deposits. — [Ostium docs, How Ostium Works](https://docs.ostium.com/protocol/how-ostium-works); [Ostium docs, Vault Overview](https://docs.ostium.com/vault/overview)
- Prices come from an in-house "consensus oracle". Multiple publishers sign prices that are reconciled on-chain and pulled on demand at open. — [Ostium docs, How Ostium Works](https://docs.ostium.com/protocol/how-ostium-works)
- Stocks (33 names) allow up to 100x leverage during the day. Positions above the overnight cap (typically 5x–20x) are **auto-closed at 3:45 PM ET** "to eliminate overnight gap risk". — [Ostium docs, Stocks: Day Trading](https://docs.ostium.com/traders/trading/stocks-day-trading)
- **Jul 15, 2026 exploit:** 23,752,746 USDC was drained from OLP between 14:18 and 14:24 UTC. The attacker compromised the off-chain price-signing infrastructure and pushed fake BTC-USD reports through a registered forwarder. It opened at an artificially low price and closed high within the same transactions. Trader collateral was untouched. Trading resumed in phases on Jul 23. The recovery plan (Sept 30) funds about 649,968 USDC, roughly 2.7% of the loss. Remaining vault assets are about 30% of pre-incident value. A $15M loan-default lawsuit was filed Sept 4. — [The Crypto Times](https://www.cryptotimes.io/2026/10/01/ostium-23-75m-hack-recovery-3321-wallets-repaid-345-lps-face-1000-choice/); [The Block, post-mortem](https://theblock.co/post/410122/ostium-post-mortem-exploit)
- Ostium marketing pages put total OI at about $95M–$134M in May 2026, around 91–98% non-crypto. These are Ostium's own figures, from search excerpts. — [Ostium blog](https://www.ostium.com/blog/perps-on-rwas-best-dex-for-rwa-perpetuals-2026-guide). a16z puts total RWA-perp OI across all venues at $161M in Jul 2025 and $4.8B in Aug 2026 (from a search excerpt). — [a16z crypto](https://a16zcrypto.com/posts/article/rwa-perps-charts/)

**Avantis, now "Veranta" (Base)**
- docs.avantisfi.com now serves Veranta docs. The sources I read give no rebrand date. — [Veranta docs index](https://docs.avantisfi.com/llms.txt)
- avUSDC (ERC-4626, launched Oct 2025) "acts as the counterparty to every trade". LPs get 70% of opening, closing and win fees and 100% of margin fees. Before Mar 11, 2026 they got 100% of all fees. Return from inception to date is 35%. The docs say "LPs do not earn from trader losses… **market makers keep the vault delta neutral**". — [Veranta docs, avUSDC](https://docs.veranta.xyz/liquidity-providers/veranta-lp-vault-avusdc.md)
- RWA orders "route through a request-for-quote engine. A network of market makers prices your order against… IBKR and LMAX". Pyth supplies the price. A "$10M NVDA order fills at around 10 bps". The home page says about 5 bps, an internal inconsistency. Spread "scales with size" against polled order-book depth and is capped per market. — [Veranta docs, Slippage & Execution](https://docs.veranta.xyz/trading/execution-and-pricing/slippage-and-execution.md); [Veranta docs, Home](https://docs.veranta.xyz/home.md)
- Oracle checks before every fill: prices more than "a few seconds old" are rejected, confidence intervals are checked, and the price must sit within 5% of Chainlink, or of off-chain venue feeds where no Chainlink feed exists. Unfilled market orders expire after about 30s. — [Veranta docs, Accurate Oracle Execution](https://docs.veranta.xyz/trading/execution-and-pricing/accurate-oracle-execution.md); [Veranta docs, Limitations & Safeguards](https://docs.veranta.xyz/trading/limitations-and-safeguards.md)
- Risk limits: per-market, per-side OI caps whose "total capacity scales with the size of the vault". Profit per position is capped at 2500% of collateral. Liquidation happens at 85% loss. A vault-buffer ratio, (TVL + buffer − open PnL)/TVL, sets a withdrawal fee from 0% at ≥1.10 up to 2.5% below 0.90. An AVNT security module can be slashed up to 20% if the buffer falls below 0.925 and a loss of 5% or more is realized. The largest single-day LP share-price drawdown so far is 30 bps. — [Veranta docs, Limitations](https://docs.veranta.xyz/trading/limitations-and-safeguards.md); [Risk Management](https://docs.veranta.xyz/liquidity-providers/risk-management.md); [Security Module](https://docs.veranta.xyz/avnt-token/staking-security-module.md)
- Hours: Mag-7 US equities and indices trade 23/5 (Sun 8pm to Fri 8pm ET); other equities trade 9:30–16:00. While closed, nothing executes. TP, SL and liquidations trigger at the reopen if crossed. — [Veranta docs, Market Hours](https://docs.veranta.xyz/trading/execution-and-pricing/market-hours.md)
- "Upside Perps", a Rollbit-style PnL cut: there is no fee on losing trades, and winners keep 75–95% depending on ROI, up to 250x. Traders have earned more than $25M gross profit so far. — [Veranta docs, Upside Perps](https://docs.veranta.xyz/trading/upside-perps/mechanics.md); [Profit sharing](https://docs.veranta.xyz/trading/upside-perps/profit-sharing.md)

**Jupiter Perps (JLP, Solana; crypto only)**
- JLP is the counterparty. LP return = fees + trader losses + exposure to the basket assets. — [DeFi Jangle](https://defijangle.substack.com/p/jlp-on-jupiter)
- In Feb 2025, P99-size trades paid 8.27 bps (SOL), 7.01 bps (BTC) and 6.57 bps (ETH) in price impact. Trades at P95 and below paid less than 1 bp above the 6 bps base. — [Jupiter Weekly Risk Report, Feb 10, 2025](https://discuss.jup.ag/t/weekly-risk-report-february-10-2025/35030)
- In the week of the Nov 5, 2025 report, JLP fell 9.60% against a flat basket, a 9.60% "impermanent loss". — [Jupiter Weekly Report, Nov 5, 2025](https://discuss.jup.ag/t/jupiter-weekly-report-nov-5th-2025/39710)

**Synthetix perps v2 (historical design)**
- premium = skew/skewScale. Fill price = oraclePrice × (1 + 0.5·(premium_before + premium_after)), the average along a linear curve. Funding moves from r = c·skew to **dr/dt = c·skew**, with maxFundingVelocity at skew = skewScale. Off-chain delayed orders use a minimum delay of about 12s (about 6s on average) and a keeper-pushed fresh Pyth price, chosen because of "the intrinsic latency of any external price source". The premium creates "soft limits on maximum exposure held by the debt pool". — [SIP-279](https://sips.synthetix.io/sips/sip-279)

**Hyperliquid HLP and HIP-3**
- HLP lost an unrealized $12M–$13.5M at the peak of the JELLY squeeze on Mar 26, 2025, after inheriting a manipulated short through liquidation. Validators delisted JELLY and settled at $0.0095. — [Yahoo/Decrypt](https://sg.finance.yahoo.com/news/hyperliquid-delists-jelly-vault-squeezed-160020190.html); [CoinGecko](https://www.coingecko.com/learn/hyperliquid-hlp-vault-analysis)
- On Aug 27, 2025, XPL whales netted about $47.5M amid manipulation claims. HLP's own result is unclear. — [Cointelegraph](https://cointelegraph.com/news/plasma-xpl-whale-manipulation-hyperliquid-justin-sun)
- The Oct 10, 2025 crash added about $41.5M to HLP PnL, about +10%. Cumulative PnL is about $136.9M since May 2023, a third-party figure. — [CoinGecko](https://www.coingecko.com/learn/hyperliquid-hlp-vault-analysis)
- HIP-3 deployers stake **500k HYPE**, held for at least 183 days and slashable, and **define and set the oracle**. The markets use HyperCore order books, so they are not pool-backed. Deployers can add a fee share of 0–300%. — [Hyperliquid docs, HIP-3](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals)
- trade.xyz (the dominant HIP-3 deployer) runs stock perps 24/7. When external prices are unavailable, the oracle advances by an **EMA of the order book's impact-price difference**: IPD = max(P_impactBid − S, 0) − max(S − P_impactAsk, 0), with τ = 30 min and each step capped at about 9.5% of the gap. **Discovery bounds** hold the mark within ±1/maxLeverage of a reference price, which re-anchors a limited number of times; for example, WTI can move at most +15.76% or −14.26% over a weekend. — [trade.xyz docs, Oracle Price](https://docs.trade.xyz/perpetuals/mechanics/oracle-price.md); [Discovery Bounds](https://docs.trade.xyz/perpetuals/mechanics/discovery-bounds.md)
- trade.xyz held about 90–99% of HIP-3 OI. Total HIP-3 OI was above $4B on Aug 8, 2026. Methodologies differ, and other dashboards show about $1.8B in late Sept and early Oct 2026. — [Cryptopolitan](https://www.cryptopolitan.com/hyperliquid-hip3-open-interest-record/); [Loris HIP-3](https://loris.tools/hip3)

**Drift (Solana)**
- Layered liquidity: a taker order first goes to a JIT auction, where makers fill at or inside the oracle price. Remainders go to the on-chain limit book, then to a protocol AMM backstop with dynamic spread and peg. This is a secondary source, and reported auction durations conflict. — [eco.com explainer](https://eco.com/support/en/articles/14801189-drift-protocol-perps-architecture-explained)
- On Apr 1, 2026, about $285M was drained. Two of five multisig signers were social-engineered into pre-signing durable-nonce transactions. This was an operational failure, not a market-design failure. — [QuillAudits](https://www.quillaudits.com/blog/hack-analysis/drift-protocol-multisig-exploit); [Nexus Mutual](https://nexusmutual.io/blog/drift-protocol-incident-report)

### Inferences
- **Two families.** (A) **Unhedged risk pools** (GMX, gTrade, JLP, HLP, Papertrade) carry trader PnL and survive on fee and liquidation edge, OI caps and skew impact. (B) **Hedge-backed settlement pools** (Ostium after the upgrade, Veranta) quote oracle ± depth spread and lay off net delta with market makers, so LPs mostly earn fees. For assets with a deep external market, B gives deep day-one liquidity ($10M NVDA at about 5–10 bps) without on-chain books. The cost is reliance on an off-chain market maker and signer.
- **Toxic-flow defenses have converged.** The common set: a fresh pull oracle at execution, a staleness limit of a few seconds, a cross-check against a second feed, a short delay or close-fee decay, size- or skew-based impact, per-side OI caps tied to vault size, a profit cap, and extra caution around news and closes.
- **Weekend and after-hours handling falls into three types:** pause (gTrade, Veranta for most stocks), keep trading with off-hours risk settings (GMX), or bounded internal price discovery from the book (trade.xyz).
- The largest recent losses were signer and key compromises (Ostium, Drift) and contract bugs (GMX v1), not informed trading. Any design that adds an off-chain-signed price, such as a Polymarket probability feed, inherits the Ostium risk.

### Gaps
- No gTrade loss incident was found in my searches. That does not prove none happened.
- No audited 2025–2026 APR series for GLV/GM, gToken, JLP or HLP.
- No date for the Avantis-to-Veranta rebrand.
- The exact gTrade skew-impact formula and Ostium's post-upgrade date are unpublished.
- Synthetix has since changed products. I did not verify whether v2-style skew pricing is still live.

---

## 4. Sports and prediction betting pools (Overtime/Thales, Azuro): skew math and pricing when the oracle gives only part of the information

### Takeaway
Both use an **external probability as the anchor**: bookmaker odds via Chainlink for Overtime, Data-Provider-pushed odds for Azuro. Both then **move the price with the pool's own inventory** and **cap per-market risk**. Thales/Overtime adds a skew premium that grows linearly with the pool's net exposure up to max_spread. Azuro seeds each market with a fixed "reinforcement" budget split by the prior odds and lets bets move "virtual funds" (a vAMM). That bounds the worst-case loss per market at the reinforcement. This is the closest existing template for "oracle gives part of the price; flow discovers the rest."

### Cited Findings
**Thales / Overtime**
- Positions are priced from the Chainlink odds feed (Pinnacle via TheRundown, plus OpticOdds and JsonOdds), with a protocol fee of currently 2% on top. — [Overtime docs, AMM & liquidity](https://docs.overtime.io/learn-about-overtime/overtime-amm-and-liquidity-mechanics.md); [Odds providers](https://docs.overtime.io/learn-about-overtime/about-odds-providers.md)
- "Skew Impact makes 'overbought' Positional Tokens… more expensive". The docs' example is "max +5% premium". Underbought sides get a bonus of "up to 10%": a 0.50 quote pays out like 0.45. The AMM quotes only when the position's odds are between **5% and 95%**, and only while the AMM's risk is below a per-market USD threshold. It stops at game start. — [Thales docs, Singles Market Making](https://docs.thales.io/thales-sports-markets/singles-market-making.md)
- Risk tools are DefaultCapPerGame, CapPerSport and CapPerMarket (USD risk caps), skew impact or discount, and min/max supported odds. — [Thales docs, SportsAMM contract](https://docs.thales.io/thales-sports-markets/thales-sports-markets-architecture/sportsamm-smart-contract.md)
- **Skew math (legacy SportsAMMUtils.sol):** maxPossibleSkew = balanceOtherSide + availableToBuyFromAMM − balancePosition. skew = balanceOtherSideAfter − balancePositionAfter. Impact = max_spread × skew/maxPossibleSkew, averaged between the pre-trade and post-trade impact. Tokens the AMM already holds are sold with no impact, and only newly minted ones are charged. Buying the side the AMM is long earns a negative impact (a discount). — [thales-markets/contracts-og SportsAMMUtils.sol](https://github.com/thales-markets/contracts-og/blob/HEAD/contracts/SportMarkets/SportsAMMUtils.sol)
- Thales digital options (crypto UP/DOWN): Black-Scholes from Chainlink spot, distance to strike, time to expiry and an implied vol that is **manually updated daily** (Deribit for BTC and ETH; others derived), plus min_spread and max_spread skew. Quotes are limited to the 0.08–0.95 price range. The AMM stops 24h before maturity because of "front-running opportunities and edge-case exploits". The AMM "market-makes in units of risk", so capital efficiency is bounded only by the risk cap. — [Thales docs, How Thales AMM works](https://docs.thales.io/thales-digital-options/how-thales-amm-works.md)
- LP rounds lasted 7 days. Deposits work from the next round. Withdrawals unlock at the next round and stay exposed during the current one. — [Thales docs, Sports Markets LP](https://docs.thales.io/thales-sports-markets/sports-markets-liquidity-providing.md)
- **Outcome:** OIP-265 (June 2026) **ended public liquidity provision**. "The Overtime treasury is the sole liquidity provider". The pool profit previously shared with external LPs, "roughly half", now funds OVER buybacks. The same treasury liquidity market-makes **Polymarket "Combos" via Polymarket's RFQ system**, booking the matching exposure on Overtime's own book. — [Overtime docs, AMM & liquidity](https://docs.overtime.io/learn-about-overtime/overtime-amm-and-liquidity-mechanics.md)

**Azuro**
- A Data Provider "books" a reinforcement R from the singleton LP and splits it across outcomes. The split sets the initial odds; for example, $30k/$50k/$20k means 30%/50%/20%. "Azuro vAMMs… immediately inherit liquidity from the singleton LP on market creation". — [Azuro docs, Pricing Mechanism: vAMMs](https://github.com/Azuro-protocol/gem-docs/blob/HEAD/src/app/knowledge-hub/introduction/pricing-mechanism-azuro-vamms/page.mdx)
- Odds are o_i = ΣF / F_i over the virtual funds F. The total virtual funds are F = R − (Σbets − max payout). A bet increases its outcome's fund. After acceptance, the other funds adjust: F_j −= (payout − a)·F_j/ΣF. The page's formula shows "F_i = F_i − a" while the text says the fund increases, which looks like a typo in the docs. Margin is applied as a per-outcome spread inversely proportional to probability. — [Azuro docs, Virtual Funds](https://github.com/Azuro-protocol/gem-docs/blob/HEAD/src/app/knowledge-hub/how-azuro-works/components/virtual-funds/page.mdx); [Odds](https://github.com/Azuro-protocol/gem-docs/blob/HEAD/src/app/knowledge-hub/how-azuro-works/components/odds/page.mdx)
- "Even with vAMMs, the overall loss for the Condition in the worst-case scenario cannot exceed the size of the Reinforcement". Only the current maximum payout is locked, so the sum of all reinforcements "may exceed the liquidity amount on the LP balance". — [Azuro docs, vAMM](https://github.com/Azuro-protocol/gem-docs/blob/HEAD/src/app/knowledge-hub/how-azuro-works/components/vAMM/page.mdx); [Reinforcement](https://github.com/Azuro-protocol/gem-docs/blob/HEAD/src/app/knowledge-hub/how-azuro-works/components/reinforcement/page.mdx)
- LP accounting uses a "LiquidityTree", a segment tree with lazy updates, so many concurrent markets can share one pool with live deposits and withdrawals. — [Azuro docs, LiquidityTree](https://github.com/Azuro-protocol/gem-docs/blob/HEAD/src/app/knowledge-hub/how-azuro-works/liquidity-tree/page.mdx)

### Inferences
- **Pricing when the oracle gives only part of the picture.** Thales digital options use oracle spot plus a **manually set volatility**, the unobservable input, plus inventory skew. That is the same structure as Probabl's s and p plus an unobservable δ. Azuro goes further: the Data Provider's prior sets the starting point, and flow moves the price inside a bounded-loss budget. Both cap risk in **USD per market**, not by depth.
- Overtime moving to treasury-only LP in 2026 suggests that oracle-priced pools with skew impact can make money, but outside LPs were costly to keep, or the protocol preferred to keep the edge. Treat that as a data point that the model's economics favor an operator or treasury LP.

### Gaps
- The current Overtime V2 risk-manager formula is not in the public docs I read; the formula above is from the legacy contract.
- No public LP PnL history for Overtime V2 or Azuro pools.

---

## 5. Tokenized stock venues in 2025–2026: where their liquidity comes from, and whether a protocol can source stock just in time

### Takeaway
On Robinhood Chain (mainnet since Jul 1, 2026), stock tokens trade 24/7, and **about 99% of their DEX liquidity is in Uniswap v4/v3 pools**, about $130M a day by late August 2026. Primary mint and redeem at every issuer is gated: Ondo requires KYC'd primary purchasers, xStocks requires authorized participants, and Dinari mints only after an Alpaca brokerage fill. **A permissionless protocol can source stock just in time only through DEX pools.** A KYC'd operator or market maker could add issuer mint and redeem (Ondo 24/5, extending to 24/7 for some names) to restock inventory near underlying prices.

### Cited Findings
- Robinhood Chain (an Arbitrum-stack L2) launched mainnet on Jul 1, 2026. Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Ltd. They trade 24/7 on DEXs including Uniswap, Rialto, Lighter, 1inch and Arcus. Uniswap is deploying "a dedicated AMM to serve as a primary public liquidity protocol". Chainlink was a day-one integration. Stock Tokens are not available to US persons and are restricted in Canada, the UK, Switzerland and the UAE. The source does not describe mint and redeem mechanics. — [The Block](https://www.theblock.co/news/business/2026-07-01-robinhood-chain-goes-live-mainnet-alongside-24-7-tokenized-stocks-lighter-perps-planned-crypto-agentic-trading-406918)
- Uniswap holds about 99% of Robinhood Chain stock-token DEX liquidity (v4 about 73%, v3 about 26%). Single-day stock-token volume passed $130M. Cumulative volume passed $1B by mid-August 2026. The source gives no depth or TVL figures and no LP identities. — [Crypto Briefing (Aug 29, 2026)](https://cryptobriefing.com/uniswap-robinhood-chain-stock-token-volume-2/)
- Ondo: "Ondo tokenized stocks do not require dedicated onchain liquidity pools". Ondo says it "can generally provide the same liquidity… onchain as is available for the corresponding underlying asset in traditional trading venues". Mint and redeem run 24/5 and are expanding to 24/7, initially for SPYon, QQQon, CRCLon, NVDAon, TSLAon and GOOGLon. Primary purchasers must pass KYC, and the product is non-US only. — [Ondo Stocks](https://ondo.finance/ondo-stocks); [TheStreet](https://www.thestreet.com/crypto/innovation/ondo-launches-true-24-7-minting-and-redemption-for-tokenized-stocks)
- xStocks (Backed Assets (JE) Ltd; Kraken acquired Backed in Dec 2025): minting and redemption are limited to KYC'd, whitelisted authorized participants. Kraken's xChange engine has run 24/5 on Ethereum and Solana since Mar 2026. As of Mar 2026, more than $225M of tokenized assets were on-chain across about 80k holders. — [Falcon Finance explainer](https://falcon.finance/news/xstocks-101-how-this-platform-unlocked-tokenized-stocks-for-more-portfolio-flexibility); [Kraken blog, xChange](https://blog.kraken.com/product/xstocks/introducing-xchange). Talos-connected market makers "may opt to provide liquidity". — [Talos](https://www.talos.com/insights/xstocks-tokenized-equities-now-supported-through-talos)
- Dinari dShares: "a mint or burn only occurs when a corresponding order is complete on a brokerage account", with Alpaca executing. — [Dinari docs, What is a dShare](https://docs.dinari.com/docs/what-is-dshare.md)

### Inferences
- For Probabl on Robinhood Chain, Uniswap stock-token pools are the only permissionless, atomic source of stock just in time. A router could buy stock on Uniswap, split it, and sell the unwanted leg, all in one transaction. Slippage is then the Uniswap pool's slippage, which I could not measure.
- Issuer mint and redeem is good for restocking inventory, not for atomic fills. It needs KYC or AP status, settles with a delay, and depends on market hours.

### Gaps
- Robinhood Stock Token mint and redeem eligibility, and the depth of the Uniswap stock pools (TVL, ±1% depth), on Robinhood Chain.
- Whether Ondo, xStocks or Dinari tokens exist on Robinhood Chain or Base with usable depth.

---

## 6. For each model: the smallest capital that gives users low slippage, and what limits the pool's risk

### Takeaway
None of these models needs capital equal to book depth. They need capital equal to the **risk budget**: caps on OI, per-market risk or reinforcement, sized against the worst plausible adverse move. A fully collateralized spot design like Probabl is different. It also ties up **inventory equal to the net one-sided notional** it writes.

### Cited Findings
- Papertrade: $0 upfront. Solvency comes from loss flow, a payout queue and OI caps of "current OI + $1B" per side. Sumcap modeled about 5 days to reach $5M at full flow. — [Papertrade docs](https://docs.papertrade.xyz/); [Sumcap](https://www.sumcap.xyz/blog/the-house-always-wins)
- Rollbit: the house balance sheet, with a default $1M aggregate per-user limit and lower limits for memecoins. — [Rollbit blog (2023)](https://blog.rollbit.com/1000x-leverage-crypto-futures/)
- Veranta: per-side OI caps that "scale with the size of the vault", a 2500% profit cap and a vault-buffer ratio, with market makers hedging delta. The protocol claims up to $500M OI capacity across 100+ assets. — [Veranta docs](https://docs.veranta.xyz/trading/limitations-and-safeguards.md); [Home](https://docs.veranta.xyz/home.md)
- Ostium: OLP plus a junior buffer, with off-chain hedging via Jump and daily settlement. — [Ostium docs](https://docs.ostium.com/vault/overview)
- gTrade: an over-collateralization buffer plus GNS mint as a backstop (at most 0.05% of supply per day) and epoch withdrawal locks. — [gTrade docs](https://docs.gains.trade/liquidity-farming-pools/gtoken-vaults)
- GMX v2: per-market OI caps and price-impact caps (50–1000 bps), with tighter off-hours settings for TradFi. — [GMX docs](https://docs.gmx.io/docs/trading/fees)
- Thales/Overtime: USD risk caps per market, sport and game. The pool "market-makes in units of risk". — [Thales docs](https://docs.thales.io/thales-digital-options/how-thales-amm-works.md)
- Azuro: a reinforcement R per condition sets the maximum loss. Only the maximum payout is locked, so reinforcements can be oversubscribed against the LP. — [Azuro docs](https://github.com/Azuro-protocol/gem-docs/blob/HEAD/src/app/knowledge-hub/how-azuro-works/components/virtual-funds/page.mdx)

### Inferences
- Rule of thumb for an unhedged pool: capital ≥ Σ over markets of (per-side OI cap × plausible adverse gap), for example a weekend or earnings gap. Skew impact and closing fees lower the expected loss. Caps bound the tail.
- For a hedged pool: capital ≈ settlement float plus the junior buffer, and depth comes from the hedge venue.

### Gaps
- No protocol publishes a formal "capital needed for X bps at size Y" calibration. This section combines the published caps and buffers.

---

## 7. Applicability to Probabl

### Takeaway
The best fit for Probabl is an **oracle-anchored pool that quotes both legs from (s, p, δ̂), where δ̂ is an on-chain state variable moved by the pool's net YES-versus-NO inventory**. That is Synthetix- or Thales-style skew pricing in δ-space, bounded per market like Azuro's reinforcement, with a bounded internal re-centering like trade.xyz's EMA, and fed by fresh pulled s and p. It gives quotes on YES and NO from day one, and its fills reveal δ. The pool's exposure that cannot be hedged is only **p(1−p)·s·(δ − δ̂) per unit of net differential inventory**. The s and p parts can be hedged in spot stock (Uniswap on Robinhood Chain) and on Polymarket. Papertrade's Martingaler model and Rollbit's house model transfer poorly to a fully collateralized spot venue. The fee ideas and launch-incentive ideas can be borrowed.

### Cited Findings
- Price inputs other venues rely on: an external deep-book mid read at execution (Papertrade reads Hyperliquid's BBO; Veranta and Ostium pull signed prices on demand). A fresh price with a staleness limit and a 5% cross-check (Veranta). A close-fee decay against round trips (gTrade: 30x decaying over about 10s). Delayed settlement at a fresh price (Synthetix: about 12s). — [Papertrade docs](https://docs.papertrade.xyz/); [Veranta docs](https://docs.veranta.xyz/trading/execution-and-pricing/accurate-oracle-execution.md); [gTrade docs](https://docs.gains.trade/gtrade-leveraged-trading/fees-and-spread); [SIP-279](https://sips.synthetix.io/sips/sip-279)
- Off-chain-signed price feeds have been the costliest failure point: Ostium lost 23.75M USDC through a compromised signer. — [The Block](https://theblock.co/post/410122/ostium-post-mortem-exploit)
- Discovery without an external price: trade.xyz's EMA of book impact-price difference (τ = 30 min) with discovery bounds that can re-anchor. — [trade.xyz docs](https://docs.trade.xyz/perpetuals/mechanics/oracle-price.md)
- Pricing when the oracle gives only part of the information: Thales uses oracle spot plus a manually updated vol plus skew. Azuro seeds a prior with a bounded reinforcement and lets the vAMM reprice. Both stop quoting near resolution: Overtime at game start, Thales 24h before maturity. — [Thales docs](https://docs.thales.io/thales-digital-options/how-thales-amm-works.md); [Azuro docs](https://github.com/Azuro-protocol/gem-docs/blob/HEAD/src/app/knowledge-hub/how-azuro-works/components/vAMM/page.mdx)
- An oracle-priced AMM can act as market maker on Polymarket itself: Overtime quotes Polymarket Combos via RFQ. — [Overtime docs](https://docs.overtime.io/learn-about-overtime/overtime-amm-and-liquidity-mechanics.md)
- On Robinhood Chain, stock-token liquidity is about 99% on Uniswap and trades 24/7. Papertrade already accepts USDG from Robinhood Chain. — [Crypto Briefing](https://cryptobriefing.com/uniswap-robinhood-chain-stock-token-volume-2/); [Papertrade docs](https://docs.papertrade.xyz/)

### Inferences
**Why the δ risk is small and the model fits.** Take Y = s(1+(1−p)δ) and N = s(1−pδ). In USDG terms, a YES-stock claim is worth p·Y and a NO-stock claim (1−p)·N. If the pool sells a YES-stock claim at δ̂ while the true value is δ, it loses p(1−p)·s·(δ − δ̂). Selling a NO-stock claim loses −p(1−p)·s·(δ − δ̂). Selling equal amounts of both legs nets to zero δ risk, because it is just selling the stock. So:
- The **common-mode** flow (buying both legs) is a stock trade. Price it against spot stock depth (gTrade-style depth impact) and hedge or source it on Uniswap.
- Only the **differential** flow (YES-stock against NO-stock) carries δ risk. Move δ̂ against it: δ̂ = δ̂₀ + net differential inventory / skewScale, the Synthetix premium form, or the Thales linear max_spread × skew/maxSkew form. That is a deterministic, on-chain way to discover δ that rewards whoever trades against an imbalance.
- The risk is largest at p = 0.5, where p(1−p) = 0.25. Illustrative arithmetic: at s = $180 with a 5% error in δ̂ and p = 0.5, the loss is about $2.25 per unit, about 1.25% of notional. At 10k units ($1.8M notional), that is about $22.5k.
- Near p = 0 or 1 the risk goes to zero, but δ becomes hard to identify. Copy Thales and quote only for p within roughly [5%, 95%].

**Model by model.**

| Model | Day-one quotes on both YES and NO? | Discovers δ? | Oracle inputs | Main risks for Probabl |
|---|---|---|---|---|
| **A. Skew-priced Δ-vault** (Synthetix/Thales skew + Azuro budget + trade.xyz re-centering) — an extension of the existing Δ-vault | Yes: quotes Y and N inside bands around Chainlink | Yes: δ̂ moves with differential inventory and re-centers on book impact prices as depth arrives | s (Chainlink, 24/5), p (Polymarket, signed or relayed), δ̂ internal | Latency on p (Polymarket moves first), weekend staleness of s, compromise of the p signer, informed δ traders, sniping near resolution, full-collateral inventory lockup |
| **B. Decomposition router + JIT spot + hedging market maker** (Ostium/Veranta-style hedging, Overtime's Polymarket link) | Yes: any single-leg order = spot stock on Uniswap + split/merge + the pool warehousing the opposite conditional leg | Yes, through the residual inventory pricing in A | s, p, Uniswap pool state | Cross-chain, non-atomic hedge (Polymarket is on Polygon), Polymarket and Probabl resolving differently, market-maker and counterparty dependence, Uniswap slippage |
| **C. Azuro-style reinforcement vAMM per market** | Yes: market opens with R split by the prior δ̂₀ | Yes: flow moves virtual funds; worst-case loss ≤ R | p and s for re-centering; δ̂₀ prior | Choosing R and δ̂₀; vAMM path dependence; re-centering when s or p jump |
| **D. Martingaler / Papertrade loss-funded LP** | Not as is: Probabl's claims must be fully backed, so winners cannot be queued | No | s, p | Spot conditional claims have no liquidation edge to fill the LP; loss-mining invites wash farming and raises regulatory concerns |
| **E. Rollbit-style house or PnL cut** | Only as a custodial or leveraged layer built on top of Probabl | No | Internal index | Custody and opacity; not a fit for the spot books |

**Inputs and controls these models imply for Probabl.**
- **s** from Chainlink, 24/5. On weekends, either pause δ-quoting or move a bounded internal s_ref, using trade.xyz-style discovery bounds or the Robinhood Chain Uniswap TWAP with tight bounds.
- **p** pulled at execution from Polymarket's book (a mid weighted by impact size) through a relayer signature, cross-checked against a second source (a TWAP or a second signer), with a staleness limit of a few seconds. The Ostium hack argues for multi-signer feeds and per-block PnL caps.
- Latency defenses: gTrade-style close-fee decay or a short delayed settlement, per-market differential risk caps (Thales/Azuro style), wider spreads and lower caps as the event approaches, and **stop quoting before resolution**.
- Capital: (i) the risk budget, Σ per market of cap × p(1−p) × s × |plausible δ error|, plus s and p hedge slippage; (ii) stock and USDG inventory for net one-sided flow. Inventory, not risk, is the binding constraint for a fully collateralized venue. Balanced flow recycles inventory through merges.
- Features worth borrowing: Papertrade's "price = external mid, no spread, charge only winners" makes for very simple UX. For a spot venue, the equivalent is a small, size- and skew-dependent spread. A token reward for early liquidity-takers or LPs that decays with pool size, like PAPER's flat-then-decay curve, can speed bootstrapping, but it invites farming.

### Gaps
- No existing venue prices a stock price conditional on an event against both a stock oracle and a prediction-market oracle. The mapping above is my inference.
- Polymarket has no native on-chain price on Base or Robinhood Chain. The cost and latency of a trustworthy p feed there are unknown.
- Uniswap depth for Robinhood Chain stock tokens, needed to size just-in-time sourcing, is unmeasured.
- Papertrade has only two days of live data, so how its model holds up is unknown.
