# Polymarket and Kalshi market research for Probabl

*Snapshot: 2026-10-20, about 06:30–07:00 UTC. Detailed notes, CSVs and sources are in `research_notes/Polymarket and Kalshi market research/`.*

## Short answer

**Probabl's best assets are oil, crypto-linked stocks, metals and the big indexes.** Those are the tokens whose prices measurably move with liquid prediction markets today:
- **Oil:** USO, XOM, PR, and CCL (which moves the opposite way). They track the Iran and Hormuz markets.
- **Crypto-linked stocks:** MSTR, COIN, CRCL, GLXY and the miners. They track the BTC price markets.
- **Metals and short bonds:** SLV, GLD, SHY. They track the Fed markets.
- **Indexes:** SPY and QQQ. They track Iran, oil, recession and US–China trade.

For most single stocks only one event matters: **earnings**. 125 of the 178 single stocks have no live market with a measurable link.

**Volume sits in sports, esports and very short crypto, none of which links usefully to a stock.**
- Kalshi: 93.5% of the contracts traded in the last 24h were in markets that also resolved within those 24h.
- Polymarket: sports, esports and crypto make up 91.3% of the volume resolved in the last 30 days.

**What people talk about is different from what they trade.** Conversation centres on politics and geopolitics: the US–Iran war and ceasefires, the Fed, Brazil's election. Iran/Hormuz is both the most-discussed theme of 2026 and the one with the strongest link to tradable tokens. That makes it Probabl's best launch theme.

**Hourly up/down markets on stocks are the wrong way to make Probabl a daily habit.**
- Short binaries on stocks and indexes failed on every venue. All 16 of Polymarket's daily stock up/down markets together trade about $16k a day.
- Short crypto binaries are a winner-take-all race that Kalshi has already won: about 83% of BTC up/down turnover.

**What works for Probabl instead:**
1. A **catalyst calendar**, so that something resolves almost every trading day: earnings nights, CPI, jobs and FOMC mornings, election nights, and dated ceasefire deadlines.
2. **Daily rolling cross-asset ladders** such as "COIN if BTC ≥ $K at 4 pm today". They resolve by copying Kalshi's or Polymarket's own settlement, so Probabl's trust model doesn't change.
3. **Making long markets feel live:**
   - the "if YES vs if NO" branch spread as daily content no one else publishes;
   - push alerts on spread moves, the one engagement mechanic with causal evidence;
   - distribution through Robinhood Chain's trading terminals.

**Prerequisites:**
- A data agreement with Polymarket. Its Terms of Use appear to bar exchanges from using its data, which already covers today's displayed odds.
- Support for negative-risk (multi-outcome) markets and Up/Down outcome labels when importing markets. Without them, even the Fed decision and CPI markets can't be imported.
- Automated market creation and resolution: about 5–9 engineer-weeks, with no contract change needed.

## 1. What was covered

- **Polymarket:**
  - all 22,324 open events (258,140 open markets) from the live Gamma API;
  - all 154,990 events resolved in the 30 days before the snapshot;
  - fills checked against the data API.
- **Kalshi:**
  - all 15,225 series, 13,819 open events and 131,777 active non-combo markets;
  - every non-combo market settled from 20 Sep to 20 Oct 2026 (2.6M markets);
  - 267 order books and trade samples from 379 series.
- **Correlation:**
  - 1,635 measured market-to-token pairs (110 ranked) between Polymarket/Kalshi probability histories and Nasdaq/Binance prices;
  - event studies on resolved markets, including 211 resolved earnings markets.
- **Attention and short-term products:**
  - press, filings, platform docs, DefiLlama and Wikimedia data;
  - short-term products on 15+ venues.
  - X post-level engagement could not be retrieved: X needs a login, and Reddit and Social Blade blocked fetches. Press reports stand in for it.
- **Probabl constraints:** what the contracts and services allow for short-lived markets, with file:line citations, and which crypto assets exist on Robinhood Chain.

**Units.** The two venues count volume differently, so don't add their numbers together.
- **Polymarket** reports volume in shares; each pays $1 if it wins. The USDC actually paid was 51–98% of it on markets checked against fills.
- **Kalshi** reports volume in contracts; each pays $1. Takers paid about $0.46 cash per contract on average, and about $0.23 on combos.

## 2. Where the volume and the attention are

### 2.1 Volume

| | Polymarket | Kalshi |
|---|---|---|
| Monthly volume | International $4.7B in Sep (peak $11.3B in Jun); Polymarket US $8.8B in Sep | $60.7B face in Sep (record); about 76% share |
| Category share | All trading, last 7 days: sports 52.4%, esports 17.1%, crypto 13.5%, politics 4.8%, geopolitics 2.9% | Settled, last 30 days: sports 57.6%, crypto 36.8%, financials 4.5%, everything else 1.2% |
| Short-lived share | Events listed under a week: 91.2% of resolved events and 55.5% of the $3.93B resolved in 30 days | Markets that lived under 24h: 54.9% of settled volume; including sports games, 98.9% is in short-term families |
| Largest long-dated markets | Fed October ($2.7M/24h), US–Iran ceasefire ($1.8M), Ballon d'Or ($1.4M), Brazil election ($1.0M) | 2028 Democratic nominee (161.5M contracts open interest), Super Bowl 2027 (146.5M) |

The open-market snapshot hides most of the trading, because short-lived instances close and drop out of it. On Polymarket, open events show $35.4M of 24h volume, but about $116M traded in total.

### 2.2 Short-term families by daily volume

| Family | Polymarket | Kalshi |
|---|---|---|
| Sports games | $75.8M/day (≈6,300 open games; NFL median $203k per game) | Tennis 152M, NFL 118M, college football 85M, MLB 49M contracts/day |
| Esports | $25.6M/day | – |
| Crypto up/down | ≈$19.2M/day corrected (BTC is 86%; 5-min BTC $12.4M/day) | 15-min: 305M contracts/day (≈$158M taker cash); BTC 263M |
| Crypto above/below | $1.6M/day (daily BTC ladder $1.23M) | Hourly: 35.7M contracts/day |
| Commodities, short | Small | 15-min: 36M/day (gold 23M, WTI 6.1M, silver 3.3M) |
| Weather | Daily high temperature: $2.0M/day, 51 cities | Daily highs 1.7M, rain 1.1M, hourly temperature 0.7M |
| Tweet counts and mentions | $1.55M + $0.17M/day | Mentions 1.2M/day (regulatory-fragile after CFTC action) |
| Economic releases | $105k/day | Sep 16 FOMC: 103M contracts; Oct 14 CPI: 4.3M; Oct jobs ≈1M |
| Stocks and indexes | About $356k/day for all price markets together; 16 daily stock up/down markets $16k/day | No single-stock price markets; S&P and Nasdaq above/below 3.25M/day |

### 2.3 What people talk about (2026)

- **The World Cup** set the year's peak: Google Trends for "prediction market" hit a five-year high in June, then fell 83% by mid-August. Polymarket's winner market did $4.33B.
- **The US–Iran war and ceasefires:**
  - The peace-deal market did $479M with 12,887 comments.
  - Insider-trading stories ran in Bloomberg, CBS and CNN.
  - It is also the theme with the strongest asset link (section 3).
- **The Fed:** the Fed-chair market did $617M; each monthly decision market $144–208M. The FOMC hiked on Sep 16, and the next meeting is Oct 28.
- **Elections:** Brazil has 25,690 comments, the most of any open Polymarket event. The US midterm markets exceed $750M.
- **Culture and mentions:** "Will Ronaldo cry?" did $89M; each Elon tweet-count week does $2–6M.
- **Conversation is not volume.** Sports is 77–89% of Kalshi volume but gets about zero comments. Politics and geopolitics carry the comments, search peaks and press.

## 3. Assets with the best-correlated prediction markets

**Measures used in the tables:**
- **r:** the correlation between daily changes in the event's probability and the token's daily return.
- **β:** the token's % move per +10 percentage points (pp) of probability.
- **Δ:** the expected gap between the YES branch and the NO branch at resolution. It is β scaled to a 100pp swing, shrunk when the evidence is weak (|t| < 3) and capped at 50%. For price-level markets, Δ was computed analytically from the token's beta to the driver.
- **Tier:** 1 means a strong, stable link with a liquid feed; 2 a real but weaker or thinner link; 3 a weak link or none.
- **Sign:** + means the token rises when the event becomes likelier.

All 110 ranked pairs, plus 1,525 other measured pairs, are in `correlation_pairs.csv`.

**Caveats:**
- β is co-movement, not proven cause: Fed odds and SPY both react to CPI and oil. Treat Fed βs as upper bounds.
- Results come from one regime (an oil shock with a hiking Fed).
- Many 2026 samples are short (n = 22–60).

### 3.1 Oil and energy (the strongest cluster in 2026)

| Token | Best events | Sign | Est. Δ | Evidence | Tier |
|---|---|---|---|---|---|
| **USO** | "Will the U.S. invade Iran before 2027?" (Polymarket, $74.7M, Dec 31) | + | ~47% | r +0.43, t 7.4, n=238 | 1 |
| USO | "Strait of Hormuz traffic returns to normal by Dec 31?" (Polymarket, $15.3M) | − | ~44% | r −0.53, n=111 | 1 |
| USO | Kalshi `KXHORMUZNORM` (3.4M contracts, Jan 1) | − | ~45% | r −0.53, t −7.5, n=149 | 1 |
| USO | "US announces end of Iranian blockade by Dec 31?" (Polymarket, $41.6M) | − | ~41% | r −0.59, n=59 | 1 |
| USO | Kalshi "How high will WTI get?" above $120 (`KXWTIMAX`, 9.2M contracts) | + | ~45% | r +0.73, t 13.1 | 1 |
| USO | "US–Iran final nuclear deal by Dec 31?" (Polymarket, $20.1M) | − | ≥50% (capped) | r −0.52, n=78 | 1 |
| USO | "US–Iran ceasefire continues through Oct 31?" (Polymarket, $18.9M, **11 days**) | − | ~19% | r −0.50, n=22 | 2 |
| USO | "Crude oil all-time high by Dec 31?" (Polymarket, $5.0M) | + | ~32% | r +0.44 | 2 |
| **XOM** | Invade Iran / Hormuz normal / Iranian regime falls ($27.6M) | +/−/+ | 19–21% | r +0.36 / −0.42 / +0.30 | 1 |
| XOM | "What will WTI hit in October?" ladder (Polymarket, $3.2M, **Oct 31**) | + | ~5% | analytic | 1 |
| **PR** (Permian Resources) | Hormuz normal | − | ~24% | r −0.40, n=111 | 1 |
| **CCL** (inverse) | Invade Iran / Kalshi Hormuz / WTI > $120 | −/+/− | 28–36% | r −0.34 / +0.42 / −0.53 | 1 |
| CCL | WTI October ladder (**Oct 31**) | − | ~9% | analytic | 2 |
| **BA** | Kalshi Hormuz normal | + | ~18% | r +0.33 | 2 |
| SPY / QQQ | Invade Iran; WTI > $120; Hormuz normal | −/−/+ | 7–12% | r −0.33 / −0.50 / +0.36 | 1–2 |

One listing can carry many markets: "U.S. invade Iran" moves 15 tokens with |t| ≥ 3, and the Kalshi Hormuz and WTI > $120 markets move 9 each. Defense names (LMT, LHX, KTOS, AVAV) did **not** track Iran escalation in 2026, so they are not good pairs.

### 3.2 Crypto and crypto-linked stocks

| Token | Best events | Sign | Est. Δ | Evidence | Tier |
|---|---|---|---|---|---|
| **MSTR** | BTC 2026 price ladder (Polymarket "What price will Bitcoin hit in 2026?", $76.6M; Kalshi `KXBTCY`, 42M) | + | ~49% | r +0.53 (vs the $100k rung), n=225 | 1 |
| MSTR | "What price will Bitcoin hit in October?" (Polymarket, $8.9M, **Oct 31**) | + | ~21% | analytic | 1 |
| **COIN** | BTC 2026 ladder; ETH 2026 ladder ($18.1M); Clarity Act ($24.1M) | + | 40% / 38% / 10% | r 0.46 / 0.57 / 0.17 | 1–2 |
| **CRCL** | BTC ladder; ETH ladder; **Clarity Act signed in 2026** ($24.1M) | + | 43% / 42% / 24% | r 0.40 / 0.51 / 0.23 | 1–2 |
| **GLXY**, **CLSK** | BTC ladder | + | 41–44% | r ≈0.41 | 1 |
| **IREN**, **WULF**, **BULL** | BTC ladder | + | 26–32% | r 0.28–0.37 | 2 |
| FUTU | Kalshi Clarity Act | + | ~8% | r 0.17 | 3 |
| **ETH, SOL, XRP, DOGE** | BTC ladder | + | 41–46% | r 0.52–0.56, n=329 | 1–2 |
| **BTC** | Kalshi BTC year-end ladder; Kalshi Hormuz (+) | + | 32% / 13% | r 0.60 / 0.24 | 1–2 |
| MSTR | "MicroStrategy sells any Bitcoin" (template, $407M) / "MSTR delisted from MSCI" ($1.2M) | − | ≈0–10% | r ≈0 | 2–3 |

The BTC price ladder moves 16 tokens, the most of any single event, and it also has a daily version. Price-ladder pairs are mechanical: the token simply follows BTC. They still produce clean conditional markets because the ladder is about a *different* asset.

**Where crypto can trade:**
- **Robinhood Chain:** only ETH (WETH, about $19M of DEX liquidity) is viable. BTC exists only as cbBTC (22 BTC supply, about $1.15M liquidity). There is no SOL and no native USDC, and the EVM token catalog would need crypto entries. So on Robinhood Chain, crypto exposure means MSTR, COIN, CRCL, GLXY and the miners, plus WETH.
- **The Solana build** already seeds BTC, ETH and SOL markets; cbBTC there has about $11.8M of liquidity.

### 3.3 Fed, rates and metals

| Token | Best events | Sign | Est. Δ | Evidence | Tier |
|---|---|---|---|---|---|
| **SLV** | Fed-chair / hawkish markets (template: on the Warsh nomination day, SLV fell 28.5%) | − | ~40% | r −0.69, n=123 | 1 |
| SLV | "Fed Decision in December?", 25 bps hike (Polymarket, $4.1M, **Dec 9**) | − | ~34% | r −0.46, n=56 | 1 |
| SLV | Gold year-end ladders (Kalshi / Polymarket) | + | ~40% | analytic | 1 |
| **GLD** | Warsh template (−10.3% on the day); December hike; "Gold hits $6,000 by Dec 31" | −/−/+ | 15–21% | r −0.56 / −0.44 / +0.33 | 1–2 |
| GLD | Kalshi October CPI above/below expectations (release **Nov 10**) | − | ~2% | surprise regression | 1 |
| **SHY** | December hike; October CPI | − | 1.5% / 0.2% | r −0.47 | 1–2 |
| **BND** | "How many Fed rate cuts in 2026?" ($54.5M); October jobs (**Nov 6**) | − | 2.4% / 0.4% | r −0.22 | 2 |
| **NU** | "Fed Decision in October?", hike (Polymarket, $50M, **Oct 28**) | − | ~10% | r −0.23, n=84 | 1 |
| **SOFI** | December hike | − | ~25% | r −0.33 | 2 |
| SPY | Fed October (**Oct 28**); zero 2026 cuts; Kalshi October CPI | − | 1–8% | r −0.13 to −0.23 | 1–2 |

FOMC decisions are now almost fully priced (mean surprise 1.4 bp), so the decision itself moves little. The tradable content is the *path*: the next hike, December, and the Fed chair. CPI and payroll surprises move SHY, BND, GLD and SLV, not the direction of SPY.

### 3.4 Indexes, megacaps, trade and politics

| Token | Best events | Sign | Est. Δ | Evidence | Tier |
|---|---|---|---|---|---|
| **NVDA** | "Largest company end of December 2026?" (Polymarket, $8.6M) | + | ~25% | r +0.43, t 7.1, n=232 | 1 |
| NVDA, CRWV | Kalshi Nasdaq-100 year-end ladder | + | 18% / 36% | analytic | 2 |
| AAPL | "Largest company" (Apple) | + | ~15% | r +0.26 | 2 |
| **QQQ**, SPY | Kalshi S&P year-end ladder; Kalshi "Recession in 2026?" | +/− | 13% / 10–15% | r −0.21 to −0.22 | 2 |
| **SMH**, **EWT**, AAPL | "US x China tariff agreement by Dec 31?" (Polymarket; only $0.4M now; the 2025 version had r 0.62–0.67 with QQQ, SPY, EWT and SMH) | + | 14–17% / 6% | r 0.62–0.63, n=54 | 2 |
| **NU** | Brazil runoff, **Oct 25** (Polymarket, $189M) | + Flávio | ~15% | r ≈0 day to day, but NU moved +13% on the first-round result (z 4.3): a **resolution-day** pair | 2 |
| **DJT** | House 2026 (Kalshi, 61M contracts, **Nov 3**) | − Dem | ~15% | r 0.15 | 2 |
| RUN, COIN, CLOV, UNH | Midterm control markets | mixed | 5–50% | weak | 2–3 |
| **RGTI**, **QBTS**, QUBT, IONQ | Kalshi "Which companies will the US take a stake in?" | + | 7–46% | r 0.25–0.36; +31–33% on the jump day; thin markets | 2–3 |
| **OKLO**, SMR | Kalshi "US grants license for a new nuclear reactor before 2027?" | + | 28–33% | r 0.17–0.19 | 2–3 |
| TSLA | Q4 deliveries (report Jan 2); Optimus release; Tesla–SpaceX merger (SPCX) | + / ? / − | 2–7% | weak | 2–3 |

### 3.5 Earnings: the short-term event for single stocks

Polymarket's earnings markets are tiny ($0.4k–$3.5k each), so Probabl would supply its own probability: from its own book, or an options-implied or historical beat rate (79% in the sample).

- Across 211 resolved earnings markets on tokens, the mean 2-day move was 8.3%, against a normal 4.7%. Beats averaged +1.6% and misses −4.2%.
- Mean reaction-day move over the last 12 reports:

| Ticker | Mean move | Next report (Polymarket market date) |
|---|---|---|
| CRWV | 16.4% | about Nov 12 |
| PLTR | 16.3% | about Nov 3 |
| ORCL | 11.5% | – |
| WULF | 10.9% | – |
| CLSK | 10.4% | – |
| AVGO | 9.3% | – |
| TSLA | 9.0% | Oct 20 (today) |
| META | 8.2% | Oct 21 |
| AMD | 8.0% | – |
| COIN | 8.0% | about Nov 5 |
| NFLX | 7.8% | – |
| AMZN | 6.3% | Oct 29 |
| NVDA | 5.6% (options imply 9.3% today) | Nov 18 |
| MSFT | 5.4% | – |
| GOOGL | 5.4% | Oct 27 |
| AAPL | 2.3% | – |

MSTR also reports Oct 29. With a 79% beat rate the "miss" branch is thin. A threshold set nearer 50% gives balanced books, e.g. NVDA data-center revenue above $X (Polymarket lists one) or guidance above consensus.

### 3.6 Big markets that do not move their obvious token (don't list on volume alone)

| Market | Token | Finding |
|---|---|---|
| China invades Taiwan ($44M) | TSM, EWT, SMH | r ≈ 0; the probability sits near 2% and barely moves |
| "Best AI model" | GOOGL | r ≈ 0 over n=382 |
| Anthropic IPO / OpenAI IPO | AMZN / MSFT | r ≈ 0 |
| GameStop–eBay | GME | r ≈ 0 |
| Hantavirus / new pandemic | MRNA | r ≈ 0 |
| House control | Sector names | Odds sit near 90% and drift |
| Iran escalation | Defense stocks | Defense fell through the war |

### 3.7 Events that move the most tokens at once

Each of these can carry a whole slate of Probabl markets on one probability feed (counts are tokens with |t| ≥ 3):

| Event | Tokens moved |
|---|---|
| BTC price ladder | 16 |
| "U.S. invade Iran before 2027?" | 15 |
| US–China trade deal (2025 version) | 14 |
| "Fed rate hike in 2026?" (resolved) | 13 |
| Recession 2025 | 12 |
| Kalshi Hormuz normal | 9 |
| Kalshi WTI > $120 | 9 |
| ETH ladder | 9 |

**Tokens with the most strong links:** USO 13, SPY 12, CCL 11, QQQ 10, ETH 10, XOM 9, PR 9, GLD 7, SHY 6, BTC 6, NVDA 5; MSTR, COIN and CRCL have 4 each.

## 4. Short-term markets: what worked and what failed

- **Kalshi 15-minute crypto (launched Dec 2025) is the winner.**
  - BTC turns over about $130M a day at a 0.53¢ spread, about 83% of all BTC up/down turnover across venues.
  - It settles on a 60-second average of CF Benchmarks' index.
  - Kalshi's crypto volume grew from $343M in January to $8.89B in September, about 86% of it 15-minute.
  - It is distributed through Robinhood and Coinbase.
- **Polymarket 5- and 15-minute crypto is sticky for bots only.**
  - BTC 15-minute volume is down about 87% since January.
  - Bots are about 80% of crypto volume, and crypto has Polymarket's worst one-month retention (about 37%).
  - A Stanford study found 821 accounts took $8.2M from likely manipulated 5-minute windows, until settlement moved to a Chainlink average on Aug 7.
- **Short stock and index binaries failed everywhere.**
  - Polymarket NVDA daily up/down: about $2.3k per market.
  - Kalshi's 15-minute S&P/Nasdaq series have no live instances, and its S&P daily range does about 130k contracts a week.
  - A Limitless NVDA hourly did $1,428.
  - Stock perps (Trade.xyz, $59.4B in September) out-traded stock binaries by roughly 1,000×.
- **Incentive-driven venues fell off a cliff when rewards ended:** Probable went from about $1.4B a month to about $0; Limitless fell 96% and Myriad 95%. Hyperliquid's HIP-4 paid rewards about 5.6× its fees, and a $10k buy there slips 2–3%.
- **PancakeSwap's 5-minute pari-mutuel rounds have survived 5+ years** at about $150M a year with no market maker. Bots exploit the lag between its oracle and faster exchange prices.
- **Distribution decided the winners.** Robinhood drove over 50% of Kalshi's volume and earned $156M of event revenue in Q2. Coinbase's crypto binaries tripled its daily prediction traders.

What made the short products stick:
- a near-50/50 binary on a liquid 24/7 underlying;
- settlement on an average price, which resists manipulation;
- a deep book;
- broker distribution.

What killed them: thin books, single-snapshot settlement, and paid volume that left when the rewards ended.

## 5. Recommendations for keeping traders on Probabl daily

### 5.1 The principle

Daily trading needs prices that move every day, plus frequent resolutions. It does not need hourly binaries.
- Probabl's conditional markets reprice whenever the event odds *or* the stock move. Iran/Hormuz odds and USO both move daily.
- What the slate lacks is frequent resolution and a reason to open the app today.

### 5.2 A catalyst calendar: something resolves almost every trading day

These are scheduled, objective events that move a listed token, without being defined by its own price. Upcoming dates:

| Date | Event | Probabl markets | Odds feed |
|---|---|---|---|
| Oct 21 | META earnings | META if beat | Probabl book / options |
| Oct 23 | Polymarket "Senate pending Hormuz Agreement by Oct 23?" | USO, XOM, CCL | Polymarket ($431k/24h) |
| **Oct 25** | **Brazil runoff** | NU if Flávio | Polymarket ($189M) |
| Oct 27 | GOOGL earnings | GOOGL if beat | Probabl book |
| Oct 27–28 | Israel election | TSEM (weak) | Polymarket |
| **Oct 28** | **FOMC** | NU, SOFI, SLV, GLD, SHY if hike | Polymarket ($50M) / Kalshi |
| Oct 29 | AMZN, MSTR earnings | AMZN, MSTR if beat | Probabl book |
| **Oct 31** | US–Iran ceasefire holds; WTI October ladder; BTC October ladder | USO, CCL, XOM; MSTR, COIN, CRCL if BTC ≥ K | Polymarket |
| ~Nov 3 | PLTR earnings (16% average move) | PLTR if beat | Probabl book |
| **Nov 3** | **US midterms** | DJT, COIN, RUN if House/Senate | Kalshi / Polymarket |
| ~Nov 5 | COIN earnings | COIN if beat | Probabl book |
| Nov 6 | October jobs | BND, SHY, GLD vs consensus | Kalshi |
| **Nov 10** | **October CPI** | GLD, SLV, SHY, QQQ if CPI above expectations | Kalshi |
| ~Nov 12 | CRWV earnings (16% average move) | CRWV if beat | Probabl book |
| Nov (APEC) | Trump–Xi trade deal | SMH, EWT, AAPL, NVDA | Polymarket |
| **Nov 18** | **NVDA earnings** | NVDA if beat, or if data-center revenue ≥ $X | Polymarket / Probabl book |
| Dec 9 | FOMC | SLV, GLD, SHY, SOFI, SPY if hike | Polymarket ($4.1M) |

Earnings season alone (late October to late November) gives several resolutions a week. Every month adds CPI and jobs; every 6–7 weeks an FOMC.

**Event nights.** Run each catalyst as an event night: open markets in the morning, show a live chart of the branch spread, resolve within hours, and post the result. "The market priced NVDA at $189 if it beats and $159 if it misses" is content no other venue produces.

### 5.3 Daily rolling cross-asset ladders (needs automation)

The conditioning event is a liquid daily or weekly price market on *another* asset, so the market is not a disguised binary on the token itself:
- "COIN / MSTR / CRCL / GLXY if BTC ≥ $K at 4 pm ET today (or this Friday)". Polymarket's daily BTC ladder trades $1.23M a day; Kalshi's hourly and daily BTC above/below trades 35.7M contracts a day.
- "USO / XOM / CCL if WTI ≥ $K Friday" (Kalshi WTI). "SLV if gold ≥ $K" (Kalshi gold 15-minute and daily).
- "NVDA / CRWV / QQQ if Nasdaq-100 closes ≥ K" (Kalshi daily index above/below).
- On the Solana build: ETH or SOL conditional on the BTC daily ladder.

Δ comes through the token's beta. For example, COIN with a beta of about 1.7 to BTC and BTC's daily standard deviation of about 2.5% gives a δ of roughly 6–7% per day. Resolution copies Kalshi's settlement (about 2 minutes after close) or Polymarket's (11 minutes to 2.5 hours). That is the same trust model as today: the resolution admin relays an outside outcome, and Probabl itself still never reads a price.

### 5.4 Make long markets feel live

- **Δ board:** a daily public board of the largest branch spreads, e.g. "USO if Hormuz reopens vs stays shut". Post it to X and Telegram on a fixed schedule, and offer it as an embed or data feed. Keep it accurate. Polymarket's "JUST IN" posts get reach (one false post reached 19.6M views) but cost credibility and draw regulators.
- **Date-ladder rungs:** list the near-dated rungs of a long story ("ceasefire holds through Oct 31", "Hormuz normal by Nov 30"), so a long theme resolves in weekly steps.
- **Prefer conditions priced at 30–70%**, or subsidise the thin branch. Conditional markets need both branches traded.

### 5.5 Retention and virality mechanics, ranked by evidence

1. **Push alerts on branch-price and spread moves.** Alerts raised trades 11% in a UK FCA randomized experiment, and Robinhood's ±5% move alerts raised trading 25%. Neither Kalshi nor Polymarket has native odds-move alerts. Keep them informative, not celebratory.
2. **Distribution through Robinhood Chain terminals and wallets** (Axiom, GMGN, pump.fun, Fomo, BasedBot). They routed about 16% of the chain's DEX volume in August. Use builder-fee or referral deals.
3. **Fee-share referrals.** Axiom returns about 52% of fees and went from 2% to 72% of Solana bot volume; Photon, which didn't match, collapsed. Probabl pays 15% for 6 months today.
4. **Points tied to fee-paying trades and to holding through resolution,** with self-trades excluded. Points raised trading 12–39% in regulator studies. Points paid on raw activity attract farmers, and volume falls off when the rewards end.
5. **Frequent new outcomes.** Sports traders were active 12 of 42 days, politics traders 7. The calendar in 5.2 does this job.
6. **Odds as news.** The Δ board, embeds, and a Telegram alert bot that can also trade.
7. **Combos ("branch parlays")**, later. They are about 60–70% of Kalshi's notional, but retail takers have lost more than $870M on them.
8. **Yield on locked collateral** answers the "dead money" objection to long markets. Kalshi pays about 3.5% and Polymarket 3.25%; neither has published any effect on trading.

Leaderboards showed no effect on trade count in the FCA study. PnL share cards and streaks have no published evidence, but they are cheap to build, so add them for X sharing without counting on them.

### 5.6 What not to build

- **5- or 15-minute up/down markets on stock tokens.** They failed on every venue.
- **A rival to Kalshi's 15-minute crypto markets.** Kalshi holds 83% of that market and has broker distribution.
- **Self-referential conditional markets** ("BTC if BTC up this hour"). They collapse into a gap binary, tie up about 440× more capital than Polymarket's binary for the same risk, and reveal only implied volatility.
- **Probabl-native price-resolved markets.** They need an oracle such as Chainlink Data Streams, which gives up the oracle-free design and invites manipulation at the settlement instant.
- **Mention and tweet markets.** They are fragile after CFTC action, and an insider can control the outcome.

## 6. What it takes to build

The contracts already allow short markets.
- `createMarket` only requires the cutoff to be after the market opens and in the future: no minimum lifetime, no challenge window.
- Trading stops at the cutoff. Resolution is three transactions.
- A full market lifecycle costs about 0.35–0.4M gas, about $0.03 at 0.02 gwei. There is no on-chain limit on the number of markets.

The blockers are off chain:
- **The creation script and the market importer.**
  - The creation script refuses events ending within a day.
  - The cutoff defaults to Polymarket's end date, which is wrong for news events: NFLX's endDate was about an hour after its results came out.
  - The importer rejects multi-outcome (negative-risk) markets and anything not labelled exactly YES/NO. That excludes every crypto and stock Up/Down market, the Fed decision, CPI, weather and sports. Earnings-beat markets and "closes above $X" ladders pass.
- **Nothing is automated:** opening, freezing, resolving, fee claims and order release all need a person.
- **Off-chain work grows with every market ever created:**
  - the ingestor never stops tracking a market;
  - the indexer and the `/markets` list keep every market;
  - the metadata cache caps at 1,024 entries, and the evidence queue shows only 200 packets;
  - the UI has no countdowns, "closing soon" view or batch redeem;
  - the market maker's market list is static and limited to 50;
  - the vault keeper widens spreads over a fixed 86,400 s, so markets shorter than a day start widened.

| Package | Work | Effort |
|---|---|---|
| (a) Automated daily markets: the calendar plus daily ladders | Optional `MarketFactory` contract, so the creation bot can't also commit resolutions; scheduler; cutoffs from event times; negative-risk and Up/Down import; lifecycle bot; resolution assistant that checks the payout against Polygon; pruning in the ingestor, indexer and API; UI countdowns and batch redeem | About 5–9 engineer-weeks, no exchange change |
| (b) Hourly markets | (a) plus automated resolution, vault slot and spread-widening changes, option-style pricing in the keeper | About 4–6 more weeks; mostly the weak self-referential product |
| (c) Price-resolved native markets | Data Streams resolver contract and audit, native market path, UI | About 6–10 weeks; gives up oracle-free settlement |

Recommendation: build (a). Skip (b) and (c) for now.

## 7. Risks and legal flags

- **Polymarket data rights.** Polymarket's Terms of Use appear to bar "exchanges" from using its data, including on chain, without a written agreement. That already covers the odds Probabl displays. Get an agreement or legal advice before launch, and check Kalshi's API terms too. No code in the repos uses Kalshi today; adding it as a probability source is new work.
- **Wording and resolution sources decide outcomes.** UMA disputes (Ronaldo's tears, ceasefire definitions, Strategy's bitcoin sale), markets that list two conflicting sources, and insider-trading cases (Maduro raid, Google search data) all show it. Copy wording exactly, and prefer official sources: FOMC statements, BLS releases, company filings, closing prices.
- **Mis-mapped imports.** A wrong YES orientation, or a cutoff after the news (the NFLX case), would let late traders exploit a known result.
- **Key security.** If one bot holds both the market-admin and resolution-admin keys, the protocol's only on-chain check against a wrong payout is gone. Keep resolution on a separate key or multisig with a human approval.
- **Honest metrics.** Publish one-sided cash volume and unique funded traders. Both venues' headline volumes overstate cash turnover by roughly 2×.

## 8. A launch slate to start from

**Long-running themes that move every day:**
- USO, XOM, CCL and PR on "U.S. invade Iran", "Hormuz normal by Dec 31" (Polymarket and Kalshi) and "Iranian blockade ends".
- MSTR, COIN, CRCL and GLXY on BTC 2026 rungs ($100k / $55k).
- SLV, GLD, SOFI and SHY on "Fed hikes in December".
- NVDA and AAPL on "largest company end-2026".
- CRCL and COIN on the Clarity Act.
- QQQ and SPY on Kalshi "Recession 2026".

**Near-dated, through November:**
- NU on the Brazil runoff (Oct 25).
- NU, SOFI, SLV and SHY on the October FOMC (Oct 28).
- USO, CCL and XOM on "ceasefire holds through Oct 31", plus the WTI October ladder.
- MSTR and COIN on the BTC October ladder (Oct 31).
- DJT and COIN on the midterms (Nov 3).
- GLD, SLV and SHY on October CPI (Nov 10).
- SMH, EWT, AAPL and NVDA on the APEC trade deal.

**Earnings nights:** META, GOOGL, AMZN, MSTR, PLTR, COIN, CRWV and NVDA, through Nov 18.

**After automation (package a):** daily "COIN, MSTR or CRCL if BTC ≥ $K at 4 pm" and weekly "USO if WTI ≥ $K Friday" ladders.

## 9. Files

All in `research_notes/Polymarket and Kalshi market research/`:
- **Correlation:** `correlation_analysis.md` and `correlation_pairs.csv` (110 ranked pairs plus 1,525 other measured pairs).
- **Polymarket census:** `polymarket_census.md` and `polymarket_*.csv` (categories, top lists, horizons, short-term families, asset-linked markets, token counts).
- **Kalshi census:** `kalshi_census.md` and `kalshi_*.csv` (same coverage, plus settled throughput and token coverage).
- **Attention and short-term products:** `attention_and_short_term_products.md` (attention, platform numbers, short-term products on 15+ venues, retention evidence).
- **Probabl constraints:** `probabl_short_term_constraints.md` (contract, service and UI constraints with file:line, on-chain assets, payoff math, change list).
- **Token list:** `robinhood_stock_tokens_2026-10-20.csv` (all 195 Robinhood Stock Tokens).

Raw API pulls and scripts (about 7 GB) are in `/Volumes/T9/tmp-probabl/market-research/`.
