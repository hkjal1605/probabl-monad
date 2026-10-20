# Prediction markets vs Robinhood tokens: correlation analysis

Prepared 2026-10-20 for Probabl. Scope: which Polymarket and Kalshi markets move the 195 Robinhood Stock Tokens (178 stocks, 17 ETFs) and major crypto, by how much, and how reliably. All raw data and scripts are in `/Volumes/T9/tmp-probabl/market-research/correlation/`. Every pair and its metrics are in `correlation_pairs.csv` next to this file.

## 1. Summary

- **Oil is the 2026 event factor.** The strongest, most stable and most liquid links in the whole study run from Iran/Hormuz markets to oil-linked tokens.
  - Polymarket "Strait of Hormuz traffic returns to normal by December 31?" ($15.3M volume) vs USO: r = −0.53 (daily, Jun–Oct 2026, n = 111), β = −4.4% per +10 percentage points (pp).
  - Kalshi `KXHORMUZNORM` vs USO: r = −0.53, t = −7.5 (n = 149).
  - "Will the U.S. invade Iran before 2027?" ($74.7M) vs USO: r = +0.43, t = +7.4 (n = 238, Oct 2025–Oct 2026).
  - The same markets move XOM, PR (Permian Resources), CCL (opposite sign), BA, SPY and QQQ.
  - Implied conditional spread (Δ, YES branch vs NO branch at resolution): about 40–45% for USO and 30–35% for CCL.
- **Price-level markets give the biggest Δ for correlated tokens.** Strike markets on BTC, ETH, WTI, gold, the S&P 500 and the Nasdaq-100 transmit almost one-for-one through each token's beta to the driver.
  - Example: the BTC 2026 ladder (Polymarket $76.6M; Kalshi `KXBTCY` 42M contracts) vs MSTR: r = +0.53 against the "BTC hits $100k" rung and r = −0.63 against the "dips to $55k" rung (n = 225 sessions).
  - Analytic Δ for an at-the-money year-end strike: about 49% for MSTR, 40% for COIN and 40% for SLV (on a gold strike).
- **Hawkish Fed odds hit metals, short bonds and fintech.**
  - Polymarket "Fed Decision in December? (25 bps hike)" vs SLV: r = −0.46; vs GLD r = −0.44; vs SHY r = −0.47 (n = 56, Jul–Oct 2026).
  - The cleanest one-market event in the sample is the Warsh nomination (Jan 30, 2026). Polymarket P(Warsh) went from about 30% to 99% overnight. GLD fell 10.3% and SLV fell 28.5% that day.
  - Over the 123 sessions before the nomination, SLV vs P(Warsh): r = −0.69.
- **Recession odds are the best equity-index link.** "US recession in 2025?" vs SPY: r = −0.48, β = −2.3% per +10pp (n = 245, 2025). The live 2026 version is weaker (Kalshi `KXRECSSNBER-26`: r = −0.22).
- **US–China trade odds moved the whole tech complex in 2025.** "US x China tariff agreement by November 10?" vs QQQ r = +0.67, SPY r = +0.66, EWT r = +0.63 (n = 54).
- **Big markets that do NOT move their obvious token** (do not list on volume alone):
  - Brazil runoff ($189M) vs NU: r ≈ 0 day to day. The first-round result did move it, though: P(Flávio) +25pp on Oct 4 and NU +13% (z 4.3) the next session. So treat the Oct 25 runoff as a resolution-day event, not a correlation pair.
  - China invades Taiwan ($44M) vs TSM, EWT and SMH: r ≈ 0. The probability sits near 2% and barely moves.
  - "Best AI model" markets vs GOOGL: r ≈ 0 (n = 382, chained monthly).
  - GameStop–eBay vs GME, Anthropic IPO vs AMZN, and Hantavirus vs MRNA: all r ≈ 0.
  - 2026 House control vs sector names: the odds sit near 90% and drift.
- **Earnings are the largest single-stock events, but they have no liquid prediction market.**
  - Polymarket "beat quarterly earnings" markets trade $0.4k–$3.5k each.
  - Across 211 resolved earnings markets on tokens (Oct 2025–Oct 2026), the mean absolute 2-day move was 8.3%, against a normal 2-day sd of 4.7%.
  - Beats averaged +1.6% and misses −4.2%, so the beat-vs-miss Δ is about 5.8pp.
  - Probabl could host these as its own events instead of borrowing a probability.
- **Events that move the most tokens at once:**
  - Iran/Hormuz/oil: 9–15 tokens with |t| ≥ 3 each.
  - The BTC price ladder: 16 tokens.
  - The Fed path: up to 13 tokens ("Fed rate hike in 2026?", Dec 2025–Sep 2026).
  - US–China trade, and the 2024 presidential election as a template.
  - Each of these can carry many Probabl markets on one probability feed.

## 2. Market context on 2026-10-20 (relevant to signs and sizes)

- **Fed:**
  - Kevin Warsh is Fed chair. He was nominated Jan 30, 2026 and confirmed May 13.
  - The Fed cut three times in late 2025, held through July 2026, and hiked 25bp on Sep 16, 2026 to 3.75–4.00%.
  - Next FOMC: Oct 28. Polymarket prices a hold at 85.5% and a hike at 14.5%; December is priced 77.5% for a hike.
- **Oil and war:**
  - US–Israeli strikes on Iran began Feb 28, 2026 and the Strait of Hormuz closed in early March.
  - A ceasefire came Apr 8. A June peace-deal market resolved YES, but a US blockade and Hormuz disruption persist.
  - WTI is about $98 and Brent about $110. Oil-up/stocks-down has been the regime: daily corr(SPY, USO) = −0.39 over the last 250 sessions.
  - Defense stocks fell through the war, the opposite of the usual pattern.
- **Crypto:** BTC is about $81.7k (−6.6% YTD). Polymarket gives the Clarity Act 5.4% to become law in 2026; MSTR is 93.5% likely to be removed from MSCI.
- **Politics:**
  - Midterms on Nov 3. Democrats are about 91% for the House and 64% for the Senate on Polymarket.
  - Brazil's runoff is Oct 25 (Flávio Bolsonaro about 77%). The Israel election is Oct 27–28.
- **Tariffs:** IEEPA tariffs were struck down by the Supreme Court on Feb 20, 2026 and replaced by a Section 122 tariff of up to 15%. A US–China tariff deal market is open to Dec 31.
- **Sources:** prices and odds from the APIs listed in section 8; context from the literature pass (Fed releases, Wikipedia event pages; see sources).

## 3. Method

**Universe:**
- All 195 tokens: daily OHLC from the Nasdaq public historical API, split-adjusted, Oct 2023–Oct 19, 2026.
- BTC, ETH, SOL, XRP and DOGE: hourly Binance klines.
- Comparators that are not tokens, used for context only: CVX, XLE, UAL, DAL, IWM, KRE, TLT, UUP, ITA, NOC, RTX, GD, XLF, EWZ, HOOD.
- Yahoo `query1` returned HTTP 429 all day. Hourly stock bars (730 days) came from Yahoo `query2` for 58 tokens.

**Prediction markets:**
- Polymarket Gamma:
  - 7,136 active events, collected by volume order and 70 tag queries, because Gamma caps offsets at 2,100.
  - 15,285 closed events since mid-2024.
  - 110 targeted resolved events: every 2025–26 FOMC, the Fed-chair race, the 2024 election, tariffs, the Iran war, Russia–Ukraine, ETF approvals and AI rankings.
- Polymarket CLOB hourly price history, fetched in 14-day chunks.
- Kalshi: 13,826 open events, plus hourly candlesticks for 20 markets and settled macro ladders (CPI, core CPI, payrolls, unemployment, FOMC) through the `/historical` endpoints.

**Alignment:**
- Each probability series is sampled at the US equity close (16:00 New York, DST-aware) on each trading day. The same clock is used for crypto, so stocks and crypto are comparable.
- Polymarket fix: a point stamped t carries the price from about one hour earlier. A lead-lag test against Binance BTC showed the peak correlation at a one-hour offset (−0.24 vs +0.01 at zero lag), so every point was re-stamped to t − 1h before sampling.
- Daily changes are taken only within one market (no splicing across roll dates). Chained series (monthly AI rankings, monthly "largest company", next FOMC meeting) restart at each roll.

**Statistics per pair:**
- n.
- Pearson r of Δp against the log-return.
- OLS β, reported as % per +10pp, with standard error and t.
- β in each half of the sample (sign stability).
- r on "active" days (|Δp| ≥ 3pp).
- β controlling for SPY's same-day return (market-adjusted) for stocks.
- The share of the ten largest-|Δp| days on which the token moved in the expected direction.

**Δ estimate:**
- If the token's price is a probability-weighted mix of its YES-branch and NO-branch values, then dPrice/Price = Δ·dp, so β per 100pp estimates Δ. The tables show it as |β per 10pp| × 10. This is the Snowberg–Wolfers–Zitzewitz approach (QJE 2007; NBER w16949).
- Where a market resolved, Δ was cross-checked with the move on the jump day divided by the probability jump.
- For price-level markets, Δ = β_token,driver × [E(r | above K) − E(r | below K)]. The bracket uses a normal driver return with the driver's realized sd to expiry, which gives 1.60 × sd for an at-the-money strike.

**Event studies:**
1. For every resolved or live single market, the 24-hour window with the largest probability jump. The token's close-to-close return on the US session that priced it is compared with the prior-60-session daily sd (z-score).
2. Fixed-date events: the 2024 election, DeepSeek, Liberation Day and the Apr 9 pause, the Geneva deal, the Oct 2025 100% tariff threat, the Supreme Court tariff ruling, the 2025 and 2026 Iran strikes and ceasefires, the Maduro capture, the Warsh nomination, the Sep 2026 hike, the SpaceX IPO, ETF approvals, the GENIUS Act, Gemini 3 and GPT-5, Korea, and India.
3. Tesla delivery-report days (12 sessions, 2024–26).
4. Kalshi macro ladders: market-implied expected print just before release (mean of the "above X" ladder, mid-quotes) vs the actual print; release-day SPY/QQQ/SHY/TLT/GLD/BTC returns regressed on the surprise.
5. Earnings: 211 resolved Polymarket "beat quarterly earnings" markets on tokens. The report date comes from the slug; the window is close(d−1) to close(d+1), which covers both before-open and after-close reporters.

**Ranking.** Score out of 100:
- 30 × min(|Δ| / 25%, 1)
- 25 × evidence: |t| (cap 6), |r| (cap 0.5) and sign stability; analytic ladders get 0.85
- 20 × liquidity: log-scaled, $10k → 0, $100M → 1
- 15 × time to resolution: ≤ 14 days best; recurring templates get a fixed middle value
- 10 × retail understandability (1–5, judgment)

Tier 1 = list now; tier 2 = good but weaker evidence, thinner market or longer dated; tier 3 = tail or speculative, or a cautionary negative result.

## 4. Ranked pairs

Columns:
- **Est. abs Δ:** the expected YES-vs-NO spread at resolution, in % of the token price.
- **Basis:** `beta` = measured β per 100pp; `analytic` = price-ladder formula; `event` = jump-day move; `lit` = historical average move; `earn` = earnings cross-section.
- **Measured r / β / n:** daily, US close.
- **Volume:** USD for Polymarket. Kalshi is shown in contracts, each with $1 notional, so dollar volume is lower.

#### Tier 1 (36 pairs)

| # | Asset | Event (venue: slug or ticker) | Volume | Ends | Sign | Est. abs Δ | Measured r / β per 10pp / n | Horizon | Score | Why |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **MSTR** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 49% (analytic) | r 0.53 / 7.69% / 225 | 10 weeks | 94.9 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 2 | **ETH** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 41% (analytic) | r 0.55 / 5.99% / 329 | 10 weeks | 94.9 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 3 | **SOL** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 44% (analytic) | r 0.52 / 6.52% / 329 | 10 weeks | 94.9 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 4 | **XRP** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 46% (analytic) | r 0.56 / 7.13% / 329 | 10 weeks | 94.9 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 5 | **COIN** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 40% (analytic) | r 0.46 / 5.88% / 225 | 10 weeks | 94.4 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 6 | **USO** | Will the U.S. invade Iran before 2027? (Polymarket: `will-the-us-invade-iran-before-2027`) | $74.7M | 2026-12-31 | + | 47% (beta) | r 0.43 / 4.73% / 238 | 10 weeks | 94.0 | Largest-volume live geopolitical market; t 6.6 over 238 sessions, top-10 move days agree 90%. |
| 7 | **BTC** | Bitcoin price at the end of 2026 (ladder) (Kalshi: `KXBTCY-27JAN0100`) | 42.3M contracts | 2026-12-31 | + | 32% (analytic) | r 0.60 / 4.82% / 329 | 10 weeks | 93.6 | Kalshi's largest crypto market; the asset itself, so correlation is mechanical. Measured r is vs Polymarket's 'BTC hits $100k' rung. |
| 8 | **CLSK** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 41% (analytic) | r 0.41 / 6.61% / 225 | 10 weeks | 91.8 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 9 | **GLXY** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 44% (analytic) | r 0.41 / 6.87% / 225 | 10 weeks | 91.8 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 10 | **CRCL** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 43% (analytic) | r 0.40 / 6.90% / 225 | 10 weeks | 91.7 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 11 | **USO** | Strait of Hormuz traffic returns to normal by Dec 31? (Polymarket: `strait-of-hormuz-traffic-returns-to-normal-by-december-31`) | $15.3M | 2026-12-31 | - | 44% (beta) | r -0.53 / -4.35% / 111 | 10 weeks | 91.4 | Reopening is the single biggest oil-supply swing; tightest daily link in the study (r about -0.5, stable in both halves). |
| 12 | **USO** | US announces end of Iranian blockade by Dec 31? (Polymarket: `us-announces-end-of-iranian-blockade-byptptpt-20260713152715080`) | $41.6M | 2026-12-31 | - | 41% (beta) | r -0.59 / -4.07% / 59 | 10 weeks | 90.4 | r -0.52, n=59; blockade end is a direct supply event. |
| 13 | **USO** | How high will WTI get by Dec 31? (above $120) (Kalshi: `KXWTIMAX-26DEC31-T120`) | 9.2M contracts | 2026-12-31 | + | 45% (beta) | r 0.73 / 4.54% / 157 | 10 weeks | 90.3 | Price-level market, near-mechanical (r 0.73, t 13). |
| 14 | **CCL** | Will the U.S. invade Iran before 2027? (Polymarket: `will-the-us-invade-iran-before-2027`) | $74.7M | 2026-12-31 | - | 36% (beta) | r -0.34 / -3.57% / 238 | 10 weeks | 89.5 | Escalation hurts fuel-heavy cruise line; t -5.5. |
| 15 | **NVDA** | Largest Company end of December 2026? (NVIDIA) (Polymarket: `largest-company-end-of-december-2026`) | $8.6M | 2026-12-31 | + | 25% (beta) | r 0.43 / 2.46% / 232 | 10 weeks | 88.8 | Near-mechanical (r 0.43, t 7.1, n=232); retail-friendly framing. |
| 16 | **XOM** | Will the U.S. invade Iran before 2027? (Polymarket: `will-the-us-invade-iran-before-2027`) | $74.7M | 2026-12-31 | + | 21% (beta) | r 0.36 / 2.10% / 238 | 10 weeks | 88.3 | Same driver through oil, t 5.7. |
| 17 | **USO** | US-Iran Final Nuclear Deal by Dec 31? (Polymarket: `us-iran-final-nuclear-deal-by-20260621201254412`) | $20.1M | 2026-12-31 | - | 50% (beta, capped at 50) | r -0.52 / -6.63% / 78 | 10 weeks | 88.3 | Steepest oil beta (-6.1% per 10pp) but shorter sample (n=78) and low current probability (13.5%). |
| 18 | **CCL** | How high will WTI get by Dec 31? (above $120) (Kalshi: `KXWTIMAX-26DEC31-T120`) | 9.2M contracts | 2026-12-31 | - | 28% (beta) | r -0.53 / -2.80% / 157 | 10 weeks | 88.3 | r -0.53, t -7.7: oil-level markets carry the airline/cruise trade into the universe. |
| 19 | **USO** | When will Hormuz traffic return to normal? (before Jan 1, 2027) (Kalshi: `KXHORMUZNORM-26MAR17-B270101`) | 3.4M contracts | 2027-01-01 | - | 45% (beta) | r -0.53 / -4.47% / 149 | 10 weeks | 88.2 | Same event on Kalshi, r -0.53, t -7.5, n=149; cross-venue confirmation. |
| 20 | **SLV** | Fed chair / hawkish-policy markets (template: Warsh nomination) (Polymarket: `who-will-trump-nominate-as-fed-chair`) | $617.3M | 2026-01-30 | - | 40% (event) | r -0.69 / -3.83% / 123 | template | 88.2 | Largest single-day token move tied to one prediction market in the sample. |
| 21 | **MSTR** | What price will Bitcoin hit in October? (monthly ladder) (Polymarket: `what-price-will-bitcoin-hit-in-october-2026`) | $8.9M | 2026-10-31 | + | 21% (analytic) | – | 11 days | 86.2 | Monthly ladders refresh every month: a permanent listing template. |
| 22 | **CCL** | When will Hormuz traffic return to normal? (before Jan 1, 2027) (Kalshi: `KXHORMUZNORM-26MAR17-B270101`) | 3.4M contracts | 2027-01-01 | + | 31% (beta) | r 0.42 / 3.10% / 149 | 10 weeks | 84.0 | Fuel-cost loser of the war; the cleanest long-the-reopening equity in the universe (airlines are not tokens). |
| 23 | **SLV** | Gold price at year end / What will Gold hit by end of December? (Kalshi + Polymarket: `KXGOLDDIRY-26DEC31H1700 ; what-will-gold-gc-hit-by-end-of-december`) | $2.1M | 2026-12-31 | + | 40% (analytic) | r 0.14 / 1.42% / 180 | 10 weeks | 83.3 | Silver = 1.9x gold beta, so a gold strike gives a large silver Δ. |
| 24 | **PR** | Strait of Hormuz traffic returns to normal by Dec 31? (Polymarket: `strait-of-hormuz-traffic-returns-to-normal-by-december-31`) | $15.3M | 2026-12-31 | - | 24% (beta) | r -0.40 / -2.38% / 111 | 10 weeks | 83.0 | Permian E&P has higher oil beta than XOM. |
| 25 | **SLV** | Fed Decision in December? (25 bps hike) (Polymarket: `fed-decision-in-december-20260729232808632`) | $4.1M | 2026-12-09 | - | 34% (beta) | r -0.46 / -3.39% / 56 | 7 weeks | 80.6 | Silver is the most hike-sensitive token (r -0.46); confirmed by the Warsh-nomination crash (SLV -28.5% on Jan 30). |
| 26 | **XOM** | Strait of Hormuz traffic returns to normal by Dec 31? (Polymarket: `strait-of-hormuz-traffic-returns-to-normal-by-december-31`) | $15.3M | 2026-12-31 | - | 19% (beta) | r -0.42 / -1.87% / 111 | 10 weeks | 80.0 | Integrated major: about 0.4x the oil move, still t > 4. |
| 27 | **GLD** | Fed chair / hawkish-policy markets (template: Warsh nomination) (Polymarket: `who-will-trump-nominate-as-fed-chair`) | $617.3M | 2026-01-30 | - | 15% (event) | r -0.56 / -1.27% / 123 | template | 76.2 | Warsh odds +70pp in a night: GLD -10.3%, SLV -28.5%; daily r -0.56 (GLD) and -0.65 (SLV) over 123 sessions. |
| 28 | **GLD** | Fed Decision in December? (25 bps hike) (Polymarket: `fed-decision-in-december-20260729232808632`) | $4.1M | 2026-12-09 | - | 20% (beta) | r -0.44 / -1.98% / 56 | 7 weeks | 75.4 | r -0.43; hawkish odds lift real yields and the dollar. |
| 29 | **SPY** | Will the U.S. invade Iran before 2027? (Polymarket: `will-the-us-invade-iran-before-2027`) | $74.7M | 2026-12-31 | - | 9% (beta) | r -0.33 / -0.91% / 238 | 10 weeks | 71.9 | Oil shock is the dominant 2026 macro factor (SPY-USO daily corr -0.39 over the last year). |
| 30 | **XOM** | What will WTI hit in October 2026? (ladder) (Polymarket: `what-price-will-wti-hit-in-october-2026`) | $3.2M | 2026-10-31 | + | 5% (analytic) | – | 11 days | 64.7 | Short-dated oil ladder; PR about 6%, CCL about -9% on the same strikes. |
| 31 | **NU** | Fed Decision in October? (25 bps hike) (Polymarket: `fed-decision-in-october-20260617190323537`) | $50.0M | 2026-10-28 | - | 10% (beta x t/3 (weak evidence)) | r -0.23 / -1.38% / 84 | 8 days | 63.6 | Most liquid live Fed market; NU and SOFI (rate-sensitive fintech) show the largest betas. |
| 32 | **SPY** | Fed decision in Oct 2026 (Oct 28 FOMC) (Polymarket + Kalshi: `fed-decision-in-october-20260617190323537 ; KXFEDDECISION-26OCT`) | $50.0M | 2026-10-28 | - | 3% (event) | r -0.13 / -0.18% / 84 | 8 days (recurs 8x/yr) | 59.6 | Decision itself is ~85% priced; SPY moves ~1.0% on FOMC days vs 0.74% otherwise. Hike outcome = equities down. |
| 33 | **SHY** | Fed Decision in December? (25 bps hike) (Polymarket: `fed-decision-in-december-20260729232808632`) | $4.1M | 2026-12-09 | - | 1.5% (beta) | r -0.47 / -0.15% / 56 | 7 weeks | 52.9 | Cleanest sign (r -0.44, stable halves) but tiny Δ: needs leverage to be interesting. |
| 34 | **TSLA** | Will Tesla (TSLA) beat quarterly earnings? (Oct 20) + Q4 deliveries (Jan 2) (Polymarket: `tsla-quarterly-earnings-...-10-20-2026 ; how-many-tesla-deliveries-in-q4`) | $1k | 2026-10-21 | + | 9% (lit) | – | 1 day / quarterly | 47.1 | Mean earnings-day move 9.0%, delivery-day move 5.4%; prediction-market leg is thin (<$5k). |
| 35 | **GLD** | CPI in October (release Nov 10): above/below the Kalshi-implied mean (Kalshi: `KXCPI-26OCT`) | 720k contracts | 2026-11-10 | - | 2.0% (event) | – | 3 weeks (monthly) | 44.9 | Measured: GLD -0.62% per +0.1pp CPI surprise (t -2.8, r -0.43, n=35); SLV -0.87%. Typical surprise is 0.07pp, so Δ (hot vs cool print) is about 1-2%. |
| 36 | **NVDA** | NVIDIA Q3 earnings (Nov 18): beat / data-center revenue above $X (Polymarket: `will-nvidia-nvda-q3-data-center-revenue-be-above-...`) | $3k | 2026-11-18 | + | 6% (earn) | – | 4 weeks | 42.4 | Mean /move/ 5.6%; cross-section beat-vs-miss Δ 5.8% (2-day, n=211). |


#### Tier 2 (50 pairs)

| # | Asset | Event (venue: slug or ticker) | Volume | Ends | Sign | Est. abs Δ | Measured r / β per 10pp / n | Horizon | Score | Why |
|---|---|---|---|---|---|---|---|---|---|---|
| 37 | **DOGE** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 41% (analytic) | r 0.52 / 6.50% / 329 | 10 weeks | 94.9 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 38 | **COIN** | What price will Ethereum hit in 2026? (Polymarket: `what-price-will-ethereum-hit-before-2027`) | $18.1M | 2026-12-31 | + | 38% (analytic) | r -0.57 / -5.62% / 225 | 10 weeks | 89.8 | ETH beta 0.86; measured r is vs the 'ETH dips to $1,500' rung, hence negative. |
| 39 | **IREN** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 32% (analytic) | r 0.28 / 5.33% / 225 | 10 weeks | 89.2 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 40 | **BULL** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 26% (analytic) | r 0.37 / 4.22% / 225 | 10 weeks | 88.9 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 41 | **WULF** | What price will Bitcoin hit in 2026? / Bitcoin price at end of 2026 (Polymarket + Kalshi: `what-price-will-bitcoin-hit-before-2027 ; KXBTCY-27JAN0100`) | $76.6M | 2026-12-31 | + | 28% (analytic) | r 0.36 / 5.92% / 225 | 10 weeks | 88.8 | Strike-based BTC markets move these through their BTC beta (MSTR 1.54, COIN 1.27, ETH 1.30); Δ = beta x 1.6 x BTC sd to expiry for an at-the-money strike. Measured r is vs the 'BTC hits $100k in 2026' rung. |
| 42 | **CRCL** | What price will Ethereum hit in 2026? (Polymarket: `what-price-will-ethereum-hit-before-2027`) | $18.1M | 2026-12-31 | + | 42% (analytic) | r -0.51 / -6.66% / 225 | 10 weeks | 87.8 | Measured vs the 'ETH dips to $1,500' rung, hence negative r. |
| 43 | **USO** | Crude Oil all time high by Dec 31? (Polymarket: `crude-oil-all-time-high-by`) | $5.0M | 2026-12-31 | + | 32% (beta) | r 0.44 / 3.19% / 118 | 10 weeks | 86.4 | r 0.45; ATH (~$147) is a tail level, so moves are lumpy. |
| 44 | **CRWV** | Nasdaq-100 close price end of 2026 (ladder) (Kalshi: `KXNASDAQ100Y-26DEC31H1600`) | 4.8M contracts | 2026-12-31 | + | 36% (analytic) | – | 10 weeks | 81.2 | Highest QQQ beta in the universe sample (2.5). |
| 45 | **USO** | US-Iran ceasefire continues through Oct 31? (Polymarket: `us-iran-ceasefire-continues-throughptptpt`) | $18.9M | 2026-10-31 | - | 19% (beta x t/3 (weak evidence)) | r -0.50 / -2.25% / 22 | 11 days | 81.0 | Short, liquid, near-term; n=22 so evidence is thin but r -0.48. |
| 46 | **CRCL** | Clarity Act (H.R.3633) signed into law in 2026? (Polymarket: `clarity-act-signed-into-law-in-2026`) | $24.1M | 2026-12-31 | + | 24% (beta) | r 0.23 / 2.42% / 193 | 10 weeks | 79.4 | r 0.23, t 3.3, stable halves; GENIUS Act Senate vote moved CRCL +33.8% in a day (2025). |
| 47 | **GLD** | What will Gold hit by end of December? ($6,000) (Polymarket: `what-will-gold-gc-hit-by-end-of-december`) | $2.1M | 2026-12-31 | + | 21% (analytic) | r 0.33 / 1.62% / 180 | 10 weeks | 78.5 | Mechanical; the measured r is only 0.32 because the $6,000 rung is far out of the money. |
| 48 | **XOM** | Will the Iranian regime fall before 2027? (Polymarket: `will-the-iranian-regime-fall-by-the-end-of-2026`) | $27.6M | 2026-12-31 | + | 21% (beta) | r 0.30 / 2.06% / 239 | 10 weeks | 78.0 | Regime-fall odds trade as an escalation proxy (r 0.30, t 4.9); sign could flip if a fall reopened supply. |
| 49 | **SOFI** | Fed Decision in December? (25 bps hike) (Polymarket: `fed-decision-in-december-20260729232808632`) | $4.1M | 2026-12-09 | - | 25% (beta x t/3 (weak evidence)) | r -0.33 / -2.99% / 56 | 7 weeks | 75.8 | High-beta rate-sensitive lender, r -0.36. |
| 50 | **DJT** | Which party will win the House in 2026? (Democrats) (Kalshi + Polymarket: `CONTROLH-2026-D ; which-party-will-win-the-house-in-2026`) | 61.4M contracts | 2026-11-03 | - | 15% (lit) | r 0.15 / 6.97% / 446 | 2 weeks | 75.5 | 2024: DJT +15.5% per 10pp of Trump odds. 2026 House odds sit at 90%, and the daily DJT link has the wrong sign (r +0.15), so treat as event bet. |
| 51 | **NVDA** | Nasdaq-100 close price end of 2026 (ladder) (Kalshi: `KXNASDAQ100Y-26DEC31H1600`) | 4.8M contracts | 2026-12-31 | + | 18% (analytic) | – | 10 weeks | 74.8 | QQQ beta 1.29; CRWV 2.5 and AVGO 1.6 give bigger Δ. |
| 52 | **QQQ** | S&P 500 close price end of 2026 (ladder) (Kalshi: `KXINXY-26DEC31H1600`) | 7.9M contracts | 2026-12-31 | + | 13% (analytic) | – | 10 weeks | 71.8 | Index ladder; QQQ beta to SPY 1.44, XLK 1.76, SPMO 1.52. |
| 53 | **NU** | Brazil Presidential Election (Oct 25 runoff): Flávio Bolsonaro vs Lula (Polymarket: `brazil-presidential-election`) | $188.8M | 2026-10-25 | + | 15% (event) | r -0.03 / -0.38% / 217 | 5 days | 71.5 | Daily poll drift does not move NU (r -0.03, n=217), but the first-round result did: P(Flávio) +25pp on Oct 4 and NU +13% / EWZ +12.5% on Oct 5 (z 4.3 / 8.1). Treat as a resolution-day bet: Lula upset = NU down. |
| 54 | **AAPL** | Largest Company end of December 2026? (Apple) (Polymarket: `largest-company-end-of-december-2026`) | $8.6M | 2026-12-31 | + | 15% (beta) | r 0.26 / 1.53% / 232 | 10 weeks | 71.0 | Mirror of the NVDA leg; NVDA falls 2.6% per +10pp on Apple. |
| 55 | **SMH** | US x China tariff agreement by Dec 31? (Polymarket: `us-x-china-tariff-agreement-by-december-31`) | $400k | 2026-12-31 | + | 17% (beta) | r 0.62 / 1.67% / 54 | 10 weeks | 70.8 | Semis carry the China-trade beta (SOXX +18.6% on the Apr 9, 2025 pause). |
| 56 | **BA** | When will Hormuz traffic return to normal? (before Jan 1, 2027) (Kalshi: `KXHORMUZNORM-26MAR17-B270101`) | 3.4M contracts | 2027-01-01 | + | 18% (beta) | r 0.33 / 1.77% / 149 | 10 weeks | 68.8 | Jet-fuel and airline-demand channel, r 0.33. |
| 57 | **EWT** | US x China tariff agreement by Dec 31? (Polymarket: `us-x-china-tariff-agreement-by-december-31`) | $400k | 2026-12-31 | + | 14% (beta) | r 0.63 / 1.37% / 54 | 10 weeks | 67.8 | r 0.64 in the 2025 analog. |
| 58 | **CCL** | What will WTI hit in October 2026? (ladder) (Polymarket: `what-price-will-wti-hit-in-october-2026`) | $3.2M | 2026-10-31 | - | 9% (analytic) | – | 11 days | 67.5 | Negative oil beta -0.57. |
| 59 | **RGTI** | Which companies will the US take a stake in? (Rigetti; resolved YES) (Kalshi: `KXUSACOMPANYSTAKE-27JAN01-RGTI`) | 60k contracts | 2026-09-09 | + | 30% (beta) | r 0.34 / 2.98% / 172 | template | 67.1 | Quantum names co-move with stake odds (r 0.34-0.37); live IonQ leg still open (5%). |
| 60 | **OKLO** | US grants license for new nuclear reactor before 2027? (Kalshi: `KXREACTOR-26DEC31`) | 830k contracts | 2026-12-31 | + | 33% (beta x t/3 (weak evidence)) | r 0.19 / 3.68% / 203 | 10 weeks | 67.1 | r 0.19, t 2.8; SMR and NNE same sign. |
| 61 | **SPY** | How high will WTI get by Dec 31? (above $120) (Kalshi: `KXWTIMAX-26DEC31-T120`) | 9.2M contracts | 2026-12-31 | - | 7% (beta) | r -0.50 / -0.72% / 157 | 10 weeks | 67.0 | Index-level oil sensitivity in 2026: -0.72% per 10pp, r -0.50. |
| 62 | **QQQ** | When will Hormuz traffic return to normal? (before Jan 1, 2027) (Kalshi: `KXHORMUZNORM-26MAR17-B270101`) | 3.4M contracts | 2027-01-01 | + | 12% (beta) | r 0.36 / 1.19% / 149 | 10 weeks | 65.2 | Risk-on when Hormuz odds rise, r 0.36. |
| 63 | **COIN** | Which party will win the House in 2026? (Kalshi: `CONTROLH-2026-D`) | 61.4M contracts | 2026-11-03 | - | 10% (lit) | r 0.08 / 4.19% / 446 | 2 weeks | 65.2 | 2024: COIN +31% the day after the election (+5.9% per 10pp); midterm effect should be smaller. |
| 64 | **SPY** | How many Fed rate cuts in 2026? (zero) (Polymarket: `how-many-fed-rate-cuts-in-2026`) | $54.5M | 2026-12-31 | - | 8% (beta) | r -0.23 / -0.81% / 264 | 10 weeks | 65.1 | Highest-volume Fed market; r -0.19 over 264 sessions, stable sign. Now 97% priced, so little left to move. |
| 65 | **QUBT** | Which companies will the US take a stake in? (IonQ) (Kalshi: `KXUSACOMPANYSTAKE-27JAN01-IONQ`) | 30k contracts | 2026-12-31 | + | 46% (beta) | r 0.25 / 4.60% / 199 | 10 weeks | 64.7 | Spillover to the whole quantum basket (r 0.25 for QUBT). |
| 66 | **QBTS** | Which companies will the US take a stake in? (D-Wave; resolved YES) (Kalshi: `KXUSACOMPANYSTAKE-27JAN01-QBTS`) | 50k contracts | 2026-09-09 | + | 31% (beta) | r 0.36 / 3.07% / 157 | template | 63.1 | r 0.36. |
| 67 | **RUN** | Which party will win the Senate in 2026? (Democrats) (Kalshi + Polymarket: `CONTROLS-2026-D ; which-party-will-win-the-senate-in-2026`) | $22.9M | 2026-11-03 | + | 10% (lit) | r 0.06 / 3.87% / 419 | 2 weeks | 63.0 | Clean-energy policy: 2024 TAN -10.9% / ICLN -7.3% on Trump win; Senate is the live 64/36 race. |
| 68 | **QQQ** | Recession in 2026? (NBER) (Kalshi: `KXRECSSNBER-26`) | 3.7M contracts | 2027-01-31 | - | 15% (beta) | r -0.21 / -1.49% / 319 | 3 months | 62.6 | Higher beta than SPY. |
| 69 | **BTC** | When will Hormuz traffic return to normal? (before Jan 1, 2027) (Kalshi: `KXHORMUZNORM-26MAR17-B270101`) | 3.4M contracts | 2027-01-01 | + | 13% (beta) | r 0.24 / 1.27% / 216 | 10 weeks | 60.2 | Crypto trades with risk appetite, r 0.24, n=216. |
| 70 | **MSTR** | MicroStrategy sells any Bitcoin by...? (template; resolved YES Jun 1, 2026) (Polymarket: `microstrategy-sell-any-bitcoin-in-2025`) | $407.2M | 2026-06-01 | - | 10% (event) | r 0.03 / 0.26% / 129 | template | 59.8 | Company-specific crypto events with huge volume; see event study. |
| 71 | **COIN** | Clarity Act (H.R.3633) signed into law in 2026? (Polymarket: `clarity-act-signed-into-law-in-2026`) | $24.1M | 2026-12-31 | + | 10% (beta x t/3 (weak evidence)) | r 0.17 / 1.32% / 193 | 10 weeks | 59.4 | r 0.19, t 2.6; Kalshi KXCRYPTOSTRUCTURE confirms sign. |
| 72 | **SPY** | Recession in 2026? (NBER) (Kalshi: `KXRECSSNBER-26`) | 3.7M contracts | 2027-01-31 | - | 10% (beta) | r -0.22 / -1.04% / 319 | 3 months | 57.9 | r -0.22, t -4; 2025 recession market showed -2.1% per 10pp (r -0.45) during the tariff shock. |
| 73 | **BND** | How many Fed rate cuts in 2026? (zero) (Polymarket: `how-many-fed-rate-cuts-in-2026`) | $54.5M | 2026-12-31 | - | 2.4% (beta) | r -0.22 / -0.24% / 264 | 10 weeks | 55.5 | r -0.20, t -3.3. |
| 74 | **PLTR** | Palantir earnings beat (early Nov) (Polymarket: `pltr-quarterly-earnings-...`) | $2k | 2026-11-03 | + | 16% (lit) | – | 2 weeks | 53.4 | Largest average earnings move among megacaps (16.3%). |
| 75 | **CRWV** | CoreWeave earnings (Nov) (Polymarket: `crwv-quarterly-earnings-...`) | $1k | 2026-11-12 | + | 16% (lit) | – | 3 weeks | 49.2 | Mean move 16.4% (4 reports). |
| 76 | **AMZN** | Will Amazon (AMZN) beat quarterly earnings? (Oct 29) (Polymarket: `amzn-quarterly-earnings-...-10-29-2026`) | $1k | 2026-10-29 | + | 9% (earn) | – | 9 days | 48.3 | Beat +8.7% vs miss -10.2% (2-day mean, n=4). |
| 77 | **LMT** | US-Iran ceasefire continues through Oct 31? (Polymarket: `us-iran-ceasefire-continues-throughptptpt`) | $18.9M | 2026-10-31 | - | 1.0% (beta x t/3 (weak evidence)) | r -0.15 / -0.44% / 22 | 11 days | 47.9 | Defense sells on ceasefire odds here, but defense did NOT rise with escalation in 2026 (see caveats). |
| 78 | **META** | Will Meta (META) beat quarterly earnings? (Polymarket: `meta-quarterly-earnings-gaap-eps-10-21-2026-6pt31`) | $4k | 2026-10-21 | + | 8% (lit) | – | 1 day | 45.9 | Mean move 8.2%; misses averaged -10.8% (2-day). |
| 79 | **TSLA** | Tesla deliveries in Q4 2026 (report Jan 2, 2027) (Polymarket + Kalshi: `how-many-tesla-deliveries-in-q4 ; KXTSLAA`) | $400k | 2027-01-02 | + | 5% (lit) | – | 10 weeks | 45.8 | Delivery-day mean /move/ 5.4% (18 reports). |
| 80 | **AAPL** | US x China tariff agreement by Dec 31? (+ Trump-Xi APEC, Nov) (Polymarket: `us-x-china-tariff-agreement-by-december-31`) | $400k | 2026-12-31 | + | 6% (beta x t/3 (weak evidence)) | r 0.31 / 0.74% / 54 | 10 weeks | 45.2 | Template: the 2025 deal market had r 0.66 with SPY and 0.64 with EWT (n=54); Liberation-Day week AAPL -23%. |
| 81 | **SPY** | CPI in October (release Nov 10) (Kalshi: `KXCPI-26OCT`) | 720k contracts | 2026-11-10 | ? | 1.0% (lit) | – | 3 weeks (monthly) | 44.5 | SPY moves more on CPI days (abs 0.84% vs 0.68%) but direction vs surprise is not significant (t -0.3, n=35): a volatility event, weak as a directional pair. |
| 82 | **GOOGL** | Will Alphabet (GOOGL) beat quarterly earnings? (Oct 27) (Polymarket: `googl-quarterly-earnings-...-10-27-2026`) | $2k | 2026-10-27 | + | 5% (lit) | – | 7 days | 42.2 | Mean move 5.4%. |
| 83 | **COIN** | Coinbase earnings beat (early Nov) (Polymarket: `coin-quarterly-earnings-...`) | $1k | 2026-11-05 | + | 8% (lit) | – | 2 weeks | 41.6 | Mean move 8.0%. |
| 84 | **SHY** | CPI in October (release Nov 10) (Kalshi: `KXCPI-26OCT`) | 720k contracts | 2026-11-10 | - | 0.2% (event) | – | 3 weeks (monthly) | 40.8 | Cleanest CPI link: -0.09% per +0.1pp surprise (t -3.5, r -0.52, n=35); tiny Δ. |
| 85 | **BND** | Jobs numbers in October 2026 (release Nov 6) (Kalshi: `KXPAYROLLS-26OCT`) | 130k contracts | 2026-11-06 | - | 0.4% (event) | – | 17 days (monthly) | 37.3 | BND -0.36% per +100k payroll surprise (t -2.9, r -0.54, n=22); SPY direction not significant. |
| 86 | **MSTR** | Will Strategy (MSTR) beat quarterly earnings? (Oct 29) (Polymarket: `mstr-quarterly-earnings-gaap-eps-10-29-2026-8pt67`) | $2k | 2026-10-29 | + | 3% (earn) | – | 9 days | 37.1 | GAAP EPS is a BTC mark-to-market, so 'beat' is mostly BTC; small own effect. |


#### Tier 3 (24 pairs)

| # | Asset | Event (venue: slug or ticker) | Volume | Ends | Sign | Est. abs Δ | Measured r / β per 10pp / n | Horizon | Score | Why |
|---|---|---|---|---|---|---|---|---|---|---|
| 87 | **CLOV** | Balance of Power: 2026 Midterms (Democrats sweep) (Polymarket: `balance-of-power-2026-midterms`) | $25.5M | 2026-11-03 | - | 50% (beta, capped at 50) | r -0.16 / -6.16% / 315 | 2 weeks | 81.1 | Medicare Advantage insurer: r -0.16, t -2.9, stable halves; best-measured midterm pair, but the beta-implied Δ is an extrapolation for a volatile small cap. |
| 88 | **TSM** | Will China invade Taiwan by end of 2026? (Polymarket: `will-china-invade-taiwan-before-2027`) | $44.4M | 2026-12-31 | - | 40% (lit) | r 0.03 / 1.05% / 310 | 10 weeks | 80.0 | Conditional Δ would be enormous, but odds sit at about 2% and never move: zero measurable correlation. |
| 89 | **EWT** | Will China invade Taiwan by end of 2026? (Polymarket: `will-china-invade-taiwan-before-2027`) | $44.4M | 2026-12-31 | - | 35% (lit) | r 0.06 / 1.51% / 310 | 10 weeks | 80.0 | Same; better as a long-dated tail market. |
| 90 | **NBIS** | Which companies will be acquired before 2027? (Nebius) (Polymarket: `which-companies-will-be-acquired-before-2027`) | $8.0M | 2026-12-31 | + | 20% (lit) | r -0.07 / -0.91% / 225 | 10 weeks | 68.3 | Target premium logic (20-40%), but probability is 2.4% and the series is flat. |
| 91 | **SMR** | US grants license for new nuclear reactor before 2027? (Kalshi: `KXREACTOR-26DEC31`) | 830k contracts | 2026-12-31 | + | 28% (beta x t/3 (weak evidence)) | r 0.17 / 3.49% / 203 | 10 weeks | 66.3 | r 0.17. |
| 92 | **SMH** | What will NVIDIA (NVDA) hit in October 2026? (ladder) (Polymarket: `what-price-will-nvda-hit-in-october-2026`) | $95k | 2026-10-31 | + | 9% (analytic) | – | 11 days | 59.9 | Single-stock ladders exist for NVDA, TSLA, META, AAPL, GOOGL, MSFT, AMZN, PLTR, COIN, RKLB, EWY, SPY but each is < $0.2M. |
| 93 | **MRNA** | Hantavirus pandemic in 2026? / New pandemic in 2026? (Polymarket: `hantavirus-pandemic-in-2026`) | $18.6M | 2026-12-31 | + | 10% (lit) | r -0.01 / -1.67% / 116 | 10 weeks | 58.1 | No measured link (r -0.03); vaccine makers would be the obvious winners if odds ever rose. |
| 94 | **UNH** | Balance of Power: 2026 Midterms (Democrats sweep) (Polymarket: `balance-of-power-2026-midterms`) | $25.5M | 2026-11-03 | - | 5% (lit) | r 0.05 / 1.00% / 315 | 2 weeks | 57.3 | Health-policy exposure; measured link weak. |
| 95 | **USO** | Russia x Ukraine ceasefire agreement by Dec 31? (Polymarket: `russia-x-ukraine-ceasefire-agreement-by`) | $8.9M | 2026-12-31 | - | 12% (beta x t/3 (weak evidence)) | r -0.25 / -2.24% / 43 | 10 weeks | 55.6 | 2025-26 analogs: USO -2.2% per 10pp (Jan-26 market, n=43). |
| 96 | **TEAM** | Best AI at the end of 2026? (Claude) / best AI model end of 2026 (Anthropic) (Kalshi + Polymarket: `KXLLM1-26DEC31-A ; which-company-has-best-ai-model-end-of-2026`) | 3.0M contracts | 2026-12-31 | - | 13% (beta x t/3 (weak evidence)) | r -0.13 / -2.09% / 199 | 10 weeks | 53.9 | Software names fall when Anthropic odds rise (TEAM r -0.13 to -0.15, ZM -0.20); consistent sign, weak. |
| 97 | **TSEM** | Netanyahu out by Dec 31? / Israel election (Oct 27) (Polymarket: `netanyahu-out-before-2027`) | $124.6M | 2026-12-31 | + | 7% (beta x t/3 (weak evidence)) | r 0.09 / 1.29% / 310 | 10 weeks | 51.1 | Only Israeli token; r 0.09. |
| 98 | **LMT** | Russia x Ukraine ceasefire agreement by Dec 31? (Polymarket: `russia-x-ukraine-ceasefire-agreement-by`) | $8.9M | 2026-12-31 | - | 7% (beta x t/3 (weak evidence)) | r -0.14 / -1.51% / 109 | 10 weeks | 50.8 | r -0.14; a ceasefire already happened May 9, 2026, so the residual market is about a final agreement. |
| 99 | **FUTU** | Will the Clarity Act become law? (before 2027) (Kalshi: `KXCRYPTOSTRUCTURE-26JAN-27`) | 2.5M contracts | 2026-12-31 | + | 8% (beta x t/3 (weak evidence)) | r 0.17 / 0.93% / 216 | 10 weeks | 48.4 | Broker with crypto trading; weak but consistent. |
| 100 | **MSFT** | OpenAI IPO by Dec 31, 2026? (Polymarket: `openai-ipo-by`) | $3.1M | 2026-12-31 | + | 3% (beta x t/3 (weak evidence)) | r -0.12 / -0.53% / 242 | 10 weeks | 45.1 | r -0.10 (wrong sign); weak. |
| 101 | **INDA** | India strike on Pakistan by Dec 31? (Polymarket: `india-strike-on-pakistan-by`) | $1.0M | 2026-12-31 | - | 3% (event) | – | 10 weeks | 44.6 | May 2025 strikes moved INDA little; low Δ. |
| 102 | **SPCX** | Tesla and SpaceX merger announced by Dec 31, 2026? (Polymarket + Kalshi: `tesla-and-spacex-merger-officially-announced-by-june-30 ; KXCOMPANYACTIONMERGER-27`) | $1.5M | 2026-12-31 | - | 7% (beta x t/3 (weak evidence)) | r -0.12 / -2.00% / 88 | 10 weeks | 44.3 | SPCX falls when merger odds rise (r -0.12, n=88); TSLA no link. Very understandable, weak evidence. |
| 103 | **GME** | Will GameStop acquire eBay? (Polymarket + Kalshi: `will-gamestop-acquire-ebay ; KXACQANNOUNCEEBAY-27JAN01`) | $6.7M | 2026-12-31 | ? | 0.9% (beta x t/3 (weak evidence)) | r 0.04 / 0.74% / 116 | 10 weeks | 40.9 | No measurable link (r 0.03) despite $6.7M across venues; sign of an acquirer move is ambiguous. |
| 104 | **GOOGL** | Which company has the best AI model end of October/2026? (Google) (Polymarket + Kalshi: `which-company-has-best-ai-model-end-of-2026 ; KXLLM1-26DEC31-GOOG`) | $3.0M | 2026-10-31 | ? | 0.0% (beta x t/3 (weak evidence)) | r 0.01 / 0.02% / 382 | 11 days (monthly) | 39.7 | No daily link (r about 0, n=382 chained); rankings shift on benchmarks that equity investors ignore. |
| 105 | **DDOG** | Will the Citrini scenario happen? (AI displacement) (Kalshi: `KXCITRINI-28JUL01`) | 25.9M contracts | 2028-07-01 | - | 10% (beta x t/3 (weak evidence)) | r -0.10 / -2.36% / 162 | 21 months | 39.1 | Big Kalshi volume, weak link (r -0.10); horizon too long. |
| 106 | **TSLA** | Tesla Optimus released this year? (Kalshi: `TESLAOPTIMUS-26DEC31`) | 430k contracts | 2026-12-31 | ? | 1.6% (beta x t/3 (weak evidence)) | r -0.05 / -0.53% / 345 | 10 weeks | 37.3 | No link (r -0.05). |
| 107 | **IONQ** | Which companies will the US take a stake in? (IonQ) (Kalshi: `KXUSACOMPANYSTAKE-27JAN01-IONQ`) | 30k contracts | 2026-12-31 | + | 7% (beta x t/3 (weak evidence)) | r 0.09 / 1.69% / 199 | 10 weeks | 37.0 | Direct target but weaker own-stock link (r 0.09); thin market. |
| 108 | **EWY** | Bank of Korea decision (Oct 22 / Nov 26) and KOSPI-level markets (Polymarket: `bank-of-korea-decision-in-november`) | $40k | 2026-11-26 | - | 2.0% (lit) | – | 5 weeks | 35.4 | Only thin Korea markets exist; EWY price ladder ($0.11M) is mechanical. |
| 109 | **AMZN** | Anthropic IPO by Dec 31, 2026? (Polymarket + Kalshi: `anthropic-ipo-by ; KXIPOANTHROPIC-DATE`) | $5.1M | 2026-12-31 | + | 0.3% (beta x t/3 (weak evidence)) | r -0.04 / -0.27% / 96 | 10 weeks | 33.9 | Amazon/Google mark-to-market on their stakes; no measurable daily link yet. |
| 110 | **MSTR** | Microstrategy delisted from MSCI index by Dec 31? (Polymarket: `will-microstrategy-be-delisted-from-the-msci-index-by-march-31`) | $1.2M | 2026-12-31 | - | 0.2% (beta x t/3 (weak evidence)) | r -0.03 / -0.21% / 79 | 10 weeks | 30.3 | 93.5% priced; no measurable link. |


## 5. Grouped results

### 5.1 Tokens with the richest event coverage

- **USO, XOM, PR and CCL:** six or more live markets each with |t| ≥ 3 (Hormuz on both venues, US invasion, blockade, nuclear deal, WTI ladder, ATH, regime fall). CCL is the universe's cleanest "reopening" long; airlines are not tokens.
- **SPY, QQQ and VTI:** oil/Iran markets, recession, the Fed path, and index ladders.
- **MSTR, COIN, CRCL, GLXY, CLSK, IREN, WULF, BULL, FUTU and the five crypto majors:** BTC/ETH price ladders (up to 16 tokens per market), Clarity Act, and the 2024 election template.
- **SLV, GLD, SHY, BND and SGOV:** Fed hike odds, the Fed-chair template, recession and shutdown odds.
- **NVDA and AAPL:** "Largest company" markets (near-mechanical) and earnings. Single-stock ladders are thin.
- **RGTI, QBTS, QUBT and IONQ:** US-stake markets. Strong co-movement, very thin markets.
- **OKLO and SMR:** reactor-licensing market.
- **NU, SOFI and CVNA:** the most rate-sensitive single names to Fed odds.
- **Thin or no coverage:** 125 of the 178 stocks (and SGOV among the ETFs) have no live market with a measurable link (|t| ≥ 3) and no ranked pair. These include most semis and AI-infrastructure names (AMD, MU, AMAT, LRCX, KLAC, ASML, ANET, VRT, CEG, VST, GEV, ORCL), most software, defense small caps and biotech. Their realistic events are:
  - their own earnings (Polymarket beat markets exist for about 30 tokens but are tiny);
  - an index price ladder through their beta (Kalshi Nasdaq-100 year-end ladder). No semis (SMH) ladder exists on either venue; a hypothetical one would give MU, LRCX, AMD and SKHY a Δ of 39–55% at year end (section 6.9);
  - one-off shocks like DeepSeek (VRT −30%, VST −28%, CLS −28%, ANET −22% in a day) or the Apr 9, 2025 tariff pause (SOXX +18.6%).
  - None of these has a liquid prediction market today.

#### Coverage by token

| Token | Kind | Ranked pairs (best tier) | Markets with abs t ≥ 3 (daily, n ≥ 30) | Strongest measured links |
|---|---|---|---|---|
| USO | etf_or_fund | 9 (tier 1) | 13 | WTI_120_K (r +0.73), IRAN26_END_OPS_APR30 (r -0.65), IRAN26_PEACE_MAY31 (r -0.61), US_IRAN_BLOCKADE_END_DEC31 (r -0.59) |
| SPY | etf_or_fund | 6 (tier 1) | 12 | US_CHINA_DEAL_NOV25 (r +0.66), IRAN26_CONFLICT_END_MAY15 (r +0.54), WTI_120_K (r -0.50), RECESSION_2025 (r -0.48) |
| CCL | stock | 4 (tier 1) | 11 | IRAN26_END_OPS_APR30 (r +0.56), IRAN26_PEACE_MAY31 (r +0.55), WTI_120_K (r -0.53), IRAN26_CONFLICT_END_MAY15 (r +0.48) |
| XOM | stock | 4 (tier 1) | 9 | IRAN26_PEACE_MAY31 (r -0.57), US_IRAN_BLOCKADE_END_DEC31 (r -0.48), HORMUZ_NORMAL_K (r -0.48), WTI_120_K (r +0.43) |
| QQQ | etf_or_fund | 3 (tier 2) | 10 | US_CHINA_DEAL_NOV25 (r +0.67), IRAN26_CONFLICT_END_MAY15 (r +0.53), IRAN26_PEACE_MAY31 (r +0.50), RECESSION_2025 (r -0.43) |
| GLD | etf_or_fund | 4 (tier 1) | 7 | FEDCHAIR_WARSH (r -0.56), FED_DEC26_HIKE (r -0.44), KHARG_JUN30 (r -0.37), GOLD_6000_DEC (r +0.33) |
| COIN | stock | 5 (tier 1) | 4 | ETH_1500_DOWN_2026 (r -0.57), BTC_55K_DOWN_2026 (r -0.55), BTC_100K_2026 (r +0.46), HOUSE24 (r -0.38) |
| MSTR | stock | 5 (tier 1) | 4 | BTC_55K_DOWN_2026 (r -0.63), ETH_1500_DOWN_2026 (r -0.61), BTC_100K_2026 (r +0.53), FED_HIKE_2026 (r -0.22) |
| ETH | crypto | 1 (tier 1) | 10 | ETH_1500_DOWN_2026 (r -0.68), BTC_55K_DOWN_2026 (r -0.65), BTC_100K_2026 (r +0.55), IRAN26_PEACE_JUN15 (r +0.54) |
| BND | etf_or_fund | 2 (tier 2) | 7 | IRAN26_PEACE_MAY31 (r +0.49), FED_DEC26_HIKE (r -0.43), FED_HIKE_2026 (r -0.34), HORMUZ_NORMAL_DEC31 (r +0.30) |
| NVDA | stock | 3 (tier 1) | 5 | US_CHINA_DEAL_NOV25 (r +0.43), LARGEST_CO_DEC26_NVDA (r +0.43), LARGEST_NVDA_CHAIN (r +0.34), LARGEST_CO_DEC26_AAPL (r -0.33) |
| PR | stock | 1 (tier 1) | 9 | IRAN26_PEACE_MAY31 (r -0.62), IRAN26_END_OPS_APR30 (r -0.46), US_IRAN_BLOCKADE_END_DEC31 (r -0.46), HORMUZ_NORMAL_K (r -0.43) |
| BTC | crypto | 2 (tier 1) | 6 | BTC_55K_DOWN_2026 (r -0.71), ETH_1500_DOWN_2026 (r -0.65), BTC_100K_2026 (r +0.60), HORMUZ_NORMAL_K (r +0.24) |
| CRCL | stock | 3 (tier 1) | 4 | ETH_1500_DOWN_2026 (r -0.51), BTC_55K_DOWN_2026 (r -0.45), BTC_100K_2026 (r +0.40), CLARITY_ACT_2026 (r +0.23) |
| SHY | etf_or_fund | 2 (tier 1) | 6 | FED_DEC26_HIKE (r -0.47), FED_HIKE_2026 (r -0.38), FED_NEXT_MEETING_BP_25_26 (r -0.30), FED_0CUTS_2026 (r -0.23) |
| SLV | etf_or_fund | 3 (tier 1) | 3 | FEDCHAIR_WARSH (r -0.69), FED_DEC26_HIKE (r -0.46), US_INVADE_IRAN_2026 (r -0.22) |
| AAPL | stock | 2 (tier 2) | 4 | LARGEST_AAPL_CHAIN (r +0.39), LARGEST_CO_DEC26_AAPL (r +0.26), LARGEST_NVDA_CHAIN (r -0.24), LARGEST_CO_DEC26_NVDA (r -0.20) |
| SMH | etf_or_fund | 2 (tier 2) | 3 | US_CHINA_DEAL_NOV25 (r +0.62), LARGEST_CO_DEC26_NVDA (r +0.23), LARGEST_NVDA_CHAIN (r +0.23) |
| TSLA | stock | 3 (tier 1) | 1 | HOUSE24 (r -0.24) |
| AMZN | stock | 2 (tier 2) | 2 | US_CHINA_DEAL_NOV25 (r +0.42), RECESSION_2025 (r -0.36) |
| BA | stock | 1 (tier 2) | 4 | HORMUZ_NORMAL_K (r +0.33), WTI_120_K (r -0.32), US_INVADE_IRAN_2026 (r -0.23), US_IRAN_DEAL_K (r +0.21) |
| F | stock | 0 (tier –) | 6 | IRAN26_END_OPS_APR30 (r +0.58), IRAN26_CONFLICT_END_MAY15 (r +0.50), WTI_120_K (r -0.26), HORMUZ_NORMAL_K (r +0.24) |
| SOL | crypto | 1 (tier 1) | 4 | BTC_55K_DOWN_2026 (r -0.60), ETH_1500_DOWN_2026 (r -0.59), BTC_100K_2026 (r +0.52), BTC_RESERVE_100D (r +0.26) |
| DOGE | crypto | 1 (tier 2) | 3 | BTC_55K_DOWN_2026 (r -0.55), BTC_100K_2026 (r +0.52), ETH_1500_DOWN_2026 (r -0.48) |
| EWT | etf_or_fund | 2 (tier 2) | 1 | US_CHINA_DEAL_NOV25 (r +0.63) |
| FUTU | stock | 1 (tier 3) | 3 | US_CHINA_DEAL_NOV25 (r +0.50), BTC_55K_DOWN_2026 (r -0.27), BTC_100K_2026 (r +0.20) |
| GLXY | stock | 1 (tier 1) | 3 | BTC_55K_DOWN_2026 (r -0.49), ETH_1500_DOWN_2026 (r -0.48), BTC_100K_2026 (r +0.41) |
| QUBT | stock | 1 (tier 2) | 3 | US_STAKE_QBTS_K (r +0.27), US_STAKE_RGTI_K (r +0.26), US_STAKE_IONQ_K (r +0.25) |
| SOFI | stock | 1 (tier 2) | 3 | BTC_55K_DOWN_2026 (r -0.33), BTC_100K_2026 (r +0.28), FED_0CUTS_2026 (r -0.19) |
| VTI | etf_or_fund | 0 (tier –) | 5 | IRAN26_CONFLICT_END_MAY15 (r +0.54), RECESSION_2025 (r -0.48), US_INVADE_IRAN_2026 (r -0.32), FED_HIKE_2026 (r -0.31) |
| XRP | crypto | 1 (tier 1) | 3 | BTC_55K_DOWN_2026 (r -0.61), ETH_1500_DOWN_2026 (r -0.58), BTC_100K_2026 (r +0.56) |
| BULL | stock | 1 (tier 2) | 2 | BTC_55K_DOWN_2026 (r -0.46), BTC_100K_2026 (r +0.37) |
| CLSK | stock | 1 (tier 1) | 2 | BTC_55K_DOWN_2026 (r -0.50), BTC_100K_2026 (r +0.41) |
| CRWV | stock | 2 (tier 2) | 0 |  |
| DJT | stock | 1 (tier 2) | 2 | ELECTION24_TRUMP (r +0.27), HOUSE_DEM_2026_K (r +0.15) |
| GOOGL | stock | 2 (tier 2) | 0 |  |
| IREN | stock | 1 (tier 2) | 2 | BTC_100K_2026 (r +0.28), BTC_55K_DOWN_2026 (r -0.26) |
| LMT | stock | 2 (tier 2) | 0 |  |
| NU | stock | 2 (tier 1) | 0 |  |
| QBTS | stock | 1 (tier 2) | 2 | US_STAKE_RGTI_K (r +0.37), US_STAKE_QBTS_K (r +0.36) |
| RGTI | stock | 1 (tier 2) | 2 | US_STAKE_QBTS_K (r +0.36), US_STAKE_RGTI_K (r +0.34) |
| WULF | stock | 1 (tier 2) | 2 | BTC_100K_2026 (r +0.36), BTC_55K_DOWN_2026 (r -0.25) |
| XLK | etf_or_fund | 0 (tier –) | 4 | IRAN26_CONFLICT_END_MAY15 (r +0.50), RECESSION_2025 (r -0.41), US_INVADE_IRAN_2026 (r -0.25), FED_HIKE_2026 (r -0.23) |
| RUN | stock | 1 (tier 2) | 1 | FED_HIKE_2026 (r -0.23) |
| SPMO | etf_or_fund | 0 (tier –) | 3 | IRAN26_CONFLICT_END_MAY15 (r +0.56), RECESSION_2025 (r -0.44), US_INVADE_IRAN_2026 (r -0.26) |
| TEAM | stock | 1 (tier 3) | 1 | BEST_AI_ANTHROPIC_CHAIN (r -0.16) |
| TSM | stock | 1 (tier 3) | 1 | US_CHINA_DEAL_NOV25 (r +0.55) |
| UPS | stock | 0 (tier –) | 3 | RECESSION_2025 (r -0.28), WTI_120_K (r -0.27), FED_HIKE_2026 (r -0.23) |
| APLD | stock | 0 (tier –) | 2 | BTC_100K_2026 (r +0.31), BTC_55K_DOWN_2026 (r -0.26) |
| CLOV | stock | 1 (tier 3) | 0 |  |
| DDOG | stock | 1 (tier 3) | 0 |  |
| EWY | etf_or_fund | 1 (tier 3) | 0 |  |
| GME | stock | 1 (tier 3) | 0 |  |
| INDA | etf_or_fund | 1 (tier 3) | 0 |  |
| IONQ | stock | 1 (tier 3) | 0 |  |
| META | stock | 1 (tier 2) | 0 |  |
| MRNA | stock | 1 (tier 3) | 0 |  |
| MSFT | stock | 1 (tier 3) | 0 |  |
| NBIS | stock | 1 (tier 3) | 0 |  |
| OKLO | stock | 1 (tier 2) | 0 |  |
| PLTR | stock | 1 (tier 2) | 0 |  |
| SMR | stock | 1 (tier 3) | 0 |  |
| SPCX | stock | 1 (tier 3) | 0 |  |
| TSEM | stock | 1 (tier 3) | 0 |  |
| UNH | stock | 1 (tier 3) | 0 |  |
| AVGO | stock | 0 (tier –) | 1 | US_CHINA_DEAL_NOV25 (r +0.46) |
| COST | stock | 0 (tier –) | 1 | RECESSION_2025 (r -0.25) |
| CVNA | stock | 0 (tier –) | 1 | FED_HIKE_2026 (r -0.27) |
| ELF | stock | 0 (tier –) | 1 | US_CHINA_DEAL_NOV25 (r +0.53) |
| GE | stock | 0 (tier –) | 1 | US_CHINA_DEAL_NOV25 (r +0.39) |
| HPE | stock | 0 (tier –) | 1 | US_CHINA_DEAL_NOV25 (r +0.56) |
| QCOM | stock | 0 (tier –) | 1 | US_CHINA_DEAL_NOV25 (r +0.61) |
| SCHD | etf_or_fund | 0 (tier –) | 1 | RECESSION_2025 (r -0.44) |
| SOXX | etf_or_fund | 0 (tier –) | 1 | US_CHINA_DEAL_NOV25 (r +0.61) |


### 5.2 Single events that move the most tokens (list many Probabl markets on one feed)

#### Breadth by market: tokens with abs t ≥ 3 (daily, n ≥ 20)

| Market (study id) | Volume | # tokens | Tokens |
|---|---|---|---|
| What price will Bitcoin hit in 2026? :: ↑ 100,000 (`BTC_100K_2026`) | $3.9M | 16 | APLD, BTC, BULL, CLSK, COIN, CRCL, DOGE, ETH, FUTU, GLXY, IREN, MSTR, SOFI, SOL, WULF, XRP |
| What price will Bitcoin hit in 2026? :: ↓ 55,000 (`BTC_55K_DOWN_2026`) | $6.9M | 16 | APLD, BTC, BULL, CLSK, COIN, CRCL, DOGE, ETH, FUTU, GLXY, IREN, MSTR, SOFI, SOL, WULF, XRP |
| Will the U.S. invade Iran before 2027? :: Will the U.S. invade Iran before 2027? (`US_INVADE_IRAN_2026`) | $74.7M | 15 | BA, BND, CCL, F, GLD, PR, QQQ, SHY, SLV, SPMO, SPY, USO, VTI, XLK, XOM |
| US x China tariff agreement by November 10? :: US x China tariff agreement by No (`US_CHINA_DEAL_NOV25`) | $669k | 14 | AMZN, AVGO, ELF, EWT, FUTU, GE, HPE, NVDA, QCOM, QQQ, SMH, SOXX, SPY, TSM |
| Fed rate hike in 2026? :: Fed rate hike in 2026? (`FED_HIKE_2026`) | $10.1M | 13 | BND, BTC, CVNA, ETH, GLD, MSTR, QQQ, RUN, SHY, SPY, UPS, VTI, XLK |
| US recession in 2025? :: US recession in 2025? (`RECESSION_2025`) | $11.7M | 12 | AMZN, CCL, COST, ETH, F, QQQ, SCHD, SPMO, SPY, UPS, VTI, XLK |
| Kalshi: Hormuz traffic normal before 2027 (`HORMUZ_NORMAL_K`) | 3.4M contracts | 9 | BA, BTC, CCL, F, PR, QQQ, SPY, USO, XOM |
| Kalshi: WTI > $120 by Dec 31 (`WTI_120_K`) | 999k contracts | 9 | BA, CCL, F, PR, QQQ, SPY, UPS, USO, XOM |
| What price will Ethereum hit in 2026? :: ↓ 1,500 (`ETH_1500_DOWN_2026`) | $3.2M | 9 | BTC, COIN, CRCL, DOGE, ETH, GLXY, MSTR, SOL, XRP |
| Iran x Israel/US conflict ends by...? :: May 15 (`IRAN26_CONFLICT_END_MAY15`) | $13.7M | 8 | CCL, F, QQQ, SPMO, SPY, USO, VTI, XLK |
| US x Iran permanent peace deal by...? :: May 31 (`IRAN26_PEACE_MAY31`) | $87.9M | 7 | BND, CCL, PR, QQQ, SPY, USO, XOM |
| How many Fed rate cuts in 2026? :: 0 (0 bps) (`FED_0CUTS_2026`) | $8.9M | 6 | BND, ETH, SHY, SOFI, SPY, VTI |
| House control after 2024 election? :: House control after 2024 election? (`HOUSE24`) | $8.0M | 6 | BTC, COIN, ETH, GLD, SPY, TSLA |
| Strait of Hormuz traffic returns to normal by December 31? :: Strait of Hormuz t (`HORMUZ_NORMAL_DEC31`) | $15.3M | 5 | BND, CCL, PR, USO, XOM |
| Fed Decision in December? :: 25 bps increase (`FED_DEC26_HIKE`) | $942k | 4 | BND, GLD, SHY, SLV |
| US announces end of Iranian blockade by...? :: December 31 (`US_IRAN_BLOCKADE_END_DEC31`) | $3.7M | 4 | CCL, PR, USO, XOM |
| Trump announces end of military operations against Iran by ...? :: April 30 (`IRAN26_END_OPS_APR30`) | $13.1M | 4 | CCL, F, PR, USO |
| Will the Iranian regime fall before 2027? :: Will the Iranian regime fall before (`IRAN_REGIME_FALL_2026`) | $27.6M | 3 | PR, USO, XOM |
| US-Iran Final Nuclear Deal by…? :: December 31 (`US_IRAN_DEAL_DEC31`) | $3.5M | 3 | PR, USO, XOM |
| Crude Oil all time high by...? :: December 31 (`CRUDE_ATH_DEC31`) | $2.0M | 3 | CCL, USO, XOM |
| Kharg Island no longer under Iranian control by...? :: June 30 (`KHARG_JUN30`) | $13.5M | 3 | GLD, SPY, USO |
| Kalshi: US takes stake in Rigetti 2026 (`US_STAKE_RGTI_K`) | 60k contracts | 3 | QBTS, QUBT, RGTI |
| Kalshi: US takes stake in D-Wave 2026 (`US_STAKE_QBTS_K`) | 47k contracts | 3 | QBTS, QUBT, RGTI |
| Kalshi: US-Iran nuclear deal before 2027 (`US_IRAN_DEAL_K`) | 1.8M contracts | 3 | BA, CCL, USO |
| Largest Company end of December 2026? :: NVIDIA (`LARGEST_CO_DEC26_NVDA`) | $1.4M | 3 | AAPL, NVDA, SMH |
| Largest Company end of December 2026? :: Apple (`LARGEST_CO_DEC26_AAPL`) | $1.2M | 3 | AAPL, NVDA, QQQ |
| US/Israel strikes Iran by...? :: February 28 (`IRAN26_STRIKE_BY_FEB28`) | $5.9M | 3 | PR, SGOV, USO |
| US x Iran ceasefire by...? :: April 30 (`IRAN26_CEASEFIRE_APR30`) | $17.7M | 3 | F, SLV, USO |
| Largest company end of month: NVIDIA (chained) (`LARGEST_NVDA_CHAIN`) | $373k | 3 | AAPL, NVDA, SMH |
| Kalshi: recession in 2026 (`RECESSION_2026_K`) | 3.7M contracts | 2 | QQQ, SPY |
| Fed expected bp change at next meeting (fed-interest-rates-january-2025) (`FED_NEXT_MEETING_BP_25_26`) | $190.9M | 2 | BND, SHY |
| Who will Trump nominate as Fed Chair? :: Kevin Warsh (`FEDCHAIR_WARSH`) | $59.9M | 2 | GLD, SLV |
| US x Iran permanent peace deal by...? :: June 15 (`IRAN26_PEACE_JUN15`) | $177.4M | 2 | ETH, XOM |
| Largest company end of month: Apple (chained) (`LARGEST_AAPL_CHAIN`) | $460k | 2 | AAPL, NVDA |
| Kalshi: exactly 0 cuts in 2026 (`FED_HIKES_2026_K`) | 2.8M contracts | 1 | SHY |
| Clarity Act (H.R.3633) signed into law in 2026? :: Clarity Act (H.R.3633) signed (`CLARITY_ACT_2026`) | $24.1M | 1 | CRCL |
| Kalshi: US takes stake in IonQ 2026 (`US_STAKE_IONQ_K`) | 32k contracts | 1 | QUBT |
| Kalshi: Democrats win House 2026 (`HOUSE_DEM_2026_K`) | 20.3M contracts | 1 | DJT |
| What will Gold (GC) hit__ by end of December? :: ↑ $6,000 (`GOLD_6000_DEC`) | $1.3M | 1 | GLD |
| Best AI model end of month: Anthropic (chained) (`BEST_AI_ANTHROPIC_CHAIN`) | $714k | 1 | TEAM |
| Bitcoin ETF approved by Jan 15? :: Bitcoin ETF approved by Jan 15? (`BTC_ETF_JAN24`) | $12.6M | 1 | ETH |
| Solana ETF approved by July 31? :: Solana ETF approved by July 31? (`SOL_ETF_JUL25`) | $1.9M | 1 | ETH |
| Will Trump create Bitcoin reserve in first 100 days? :: Will Trump create Bitcoi (`BTC_RESERVE_100D`) | $23.3M | 1 | SOL |
| Presidential Election Winner 2024 :: Donald Trump (`ELECTION24_TRUMP`) | $1531.5M | 1 | DJT |

- **Iran/Hormuz cluster** (Polymarket Hormuz Dec 31, US invasion, blockade end, nuclear deal; Kalshi `KXHORMUZNORM`, `KXWTIMAX`). One probability drives:
  - oil longs: USO, XOM, PR;
  - oil-cost shorts: CCL, BA, UPS, F;
  - index beta: SPY, QQQ, VTI;
  - risk assets: BTC, ETH.
  Signs are stable across halves. List USO, XOM, CCL and SPY on the Hormuz market first.
- **BTC year-end ladder:** BTC, ETH, SOL, XRP, DOGE, MSTR, COIN, CRCL, GLXY, CLSK, IREN, WULF, BULL, APLD and FUTU.
- **Fed path:**
  - Polymarket "Fed rate hike in 2026?" ($10.1M; Dec 2025 to its YES resolution on Sep 16, 2026) linked to 13 tokens with |t| ≥ 3: SHY, BND, SPY, VTI, QQQ, XLK, GLD, BTC, ETH, MSTR, CVNA, RUN and UPS, all negative on higher hike odds.
  - The live December-decision market carries the same set: SLV, GLD, SHY, BND, SOFI and NU.
  - The Oct 28 meeting is too well priced to produce a big Δ (85% hold).
- **Midterms (Nov 3):** the odds are already extreme, so the expected moves are small and mostly on surprise: DJT, CLOV and UNH (Medicare Advantage), RUN/FLNC/BE (clean energy), COIN, and KRE (comparator). The 2024 election is the best template:
  - P(Trump) vs DJT: r = +0.27, β = +16% per 10pp (n = 210).
  - "House control after 2024 election?" (Democratic): KRE r = −0.50, COIN r = −0.38.
- **US–China trade** (template; live market only $0.4M): SPY, QQQ, EWT, AAPL, NVDA, TSM, SMH, SOXX and BABA.

## 6. Evidence by theme

### 6.1 Iran, Hormuz and oil (the strongest cluster)

**Daily correlations, live markets.** β is % per +10pp.

| Market | Token | r | β | n | Window |
|---|---|---|---|---|---|
| Polymarket Hormuz-normal-by-Dec-31 | USO | −0.53 | −4.4% | 111 | Jun–Oct 2026 |
| Kalshi `KXHORMUZNORM` | USO | −0.53 | −4.5% | 149 | Mar–Oct 2026 |
| Kalshi `KXHORMUZNORM` | CCL | +0.42 | +3.1% | 149 | Mar–Oct 2026 |
| Kalshi `KXHORMUZNORM` | BA | +0.33 | +1.8% | 149 | Mar–Oct 2026 |
| Kalshi `KXHORMUZNORM` | QQQ | +0.36 | +1.2% | 149 | Mar–Oct 2026 |
| "U.S. invade Iran before 2027" | USO | +0.43 | +4.7% | 238 | Oct 2025–Oct 2026 |
| "U.S. invade Iran before 2027" | XOM | +0.36 | +2.1% | 238 | Oct 2025–Oct 2026 |
| "U.S. invade Iran before 2027" | CCL | −0.34 | −3.6% | 238 | Oct 2025–Oct 2026 |
| "U.S. invade Iran before 2027" | SPY | −0.33 | −0.9% | 238 | Oct 2025–Oct 2026 |
| Blockade end by Dec 31 | USO | −0.59 | −4.1% | 59 | Jul–Oct 2026 |
| Final nuclear deal by Dec 31 | USO | −0.52 | −6.6% | 78 | Jun–Oct 2026 |

- **Stability and market adjustment:** half-sample βs share sign in every case. After controlling for SPY, the oil βs keep about 80% of their size: USO vs Hormuz is −3.9% per 10pp after the control.

**Resolved 2026 analogs.** Each had r between −0.52 and −0.66 with USO, PR, XOM and CVX (n = 21–38):
- "US x Iran ceasefire by Apr 30"
- "Iran x Israel/US conflict ends by May 15"
- "Permanent peace deal by May 31 / Jun 15"
- "Trump announces end of military operations by Apr 30"

**Jump days:**
- Apr 8, 2026 ceasefire, as P(ceasefire by Apr 30) went from 24% to 99%: USO −9.8%, CVX −4.3%, XOM −4.7%, CCL +11.2%, SPY +2.5%.
- Mar 2, 2026 (first session after the Feb 28 strikes): USO +6.4%, NOC +6.0%, CCL −7.6%, SHY −0.4% (z −4.5).
- Kalshi WTI > $120 jumped 20% → 88% on Mar 6, 2026; USO +13%.

**Defense is not a clean war hedge.** In 2026, LMT, LHX, HII, KTOS, AVAV and RCAT show no stable link to escalation odds (|r| < 0.15 vs the invasion market). Defense names fell 16–60% from Feb 27 to Oct 16 while Brent rose 52% (literature pass, Yahoo data). Defense only reacts on day one of strikes (Jun 13, 2025: LMT +3.7%; Mar 2, 2026: NOC +6.0%), and sells off on ceasefires (KTOS −6.6% on Jun 24, 2025).

**Probabl listing:**
- USO, XOM, PR, CCL and SPY conditional on the Hormuz market (Polymarket $15.3M, plus Kalshi), resolving Dec 31.
- The same set on "U.S. invade Iran" ($74.7M).
- USO and CCL on the blockade-end market ($41.6M).
- For short horizons: the "ceasefire continues through Oct 31" ($18.8M) and WTI monthly ladders.

### 6.2 Fed, rates and the Fed chair

**Live markets:**
- **December hike** (Polymarket, $4.1M, 77.5% hike):

  | Token | r | β per 10pp | n |
  |---|---|---|---|
  | SLV | −0.46 | −3.4% | 56 |
  | GLD | −0.44 | −2.0% | 56 |
  | SHY | −0.47 | −0.15% | 56 |
  | BND | −0.43 | −0.37% | 56 |
  | SOFI | −0.33 | −3.0% | 56 |
  | NU | −0.34 | −3.4% | 56 |

- **"Zero cuts in 2026"** ($54.5M) over 264 sessions: SPY r −0.23 (β −0.8%), BND r −0.22, SHY r −0.23, SOFI r −0.19. It is now 97% priced, so it has little left to move.
- **October hike** ($50M): NU r −0.23 and SHY r −0.28. The decision is 85% priced for a hold, so Δ at resolution is small.

**Chained next-meeting expectation** (expected bp change at the next FOMC from all outcome buckets, Jan 2025–Sep 2026, n = 449):
- SHY r −0.30, BND r −0.23, UUP (comparator) r +0.25.
- SPY's link is weak. Most meetings were fully priced by decision day; the literature pass found the realized outcome priced at ≥ 87.5% at 14 of 15 meetings, Dec 2024–Sep 2026.

**Fed chair (template):**
- Polymarket "Who will Trump nominate as Fed Chair?" ($617M), P(Warsh) Aug 2025–Jan 2026: SLV r −0.69 (β −3.8%), GLD r −0.56 (β −1.3%), n = 123.
- On the nomination session (Jan 30, 2026; P(Warsh) 28% → 99%): SLV −28.5% (z −10.1), GLD −10.3% (z −8.3). That implies Δ ≈ −47% (SLV) and −15% (GLD) per 100pp.
- P(Hassett) had the opposite sign (SLV r +0.20).
- This is the largest single-market-driven token move in the sample. Successor and chair-fight markets ("Trump tries to fire Warsh", "Warsh out by") are thin today but are the template.

**Recession:**
- "US recession in 2025?" ($11.7M, Jan–Dec 2025, n = 245): SPY r −0.48 (β −2.3%), VTI −0.48, SCHD −0.44. Half-sample signs were stable through the tariff crash.
- Live 2026 versions: Kalshi `KXRECSSNBER-26` vs SPY r −0.22 (β −1.0%, n = 319), QQQ r −0.21 (β −1.5%). Polymarket "recession by end of 2026" vs SPY r −0.13. Both are priced at 3–6%.

**Macro releases (Kalshi ladders).** Measured here, Oct 2023–Oct 2026. The surprise is the actual print minus the Kalshi-implied mean just before release.
- **CPI (n = 35):** a +0.1pp m/m surprise moved
  - SHY −0.09% (t −3.5, r −0.52);
  - BND −0.22% (t −2.4);
  - GLD −0.62% (t −2.8, r −0.43);
  - SLV −0.87%, IWM (comparator) −0.87%, KRE (comparator) −1.03%;
  - SPY and QQQ: about zero (t −0.3).
  - Core CPI (n = 32) gives the same pattern.
- **Payrolls (n = 22):** +100k vs expectations moved SHY −0.15% (t −2.7), BND −0.36% (t −2.9) and TLT (comparator) −0.69%. SPY: about zero.
- **SPY's mean absolute move:**
  - CPI days: 0.84%; payroll days: 1.06%; all days in the last 500 sessions: 0.68%.
  - So index direction on release days is not predictable from the surprise sign in this regime, but bonds, gold and small caps are.
- **FOMC decisions (Kalshi `KXFEDDECISION`, n = 24, Nov 2023–Sep 2026):** the mean absolute surprise is only 1.4bp, so decision-day βs are noise. Only two meetings carried a real surprise:
  - Sep 18, 2024: −15bp (a 50bp cut vs about 35bp priced); SPY −0.3%.
  - Jul 29, 2026: −6.7bp (a hold vs 27% hike odds); SPY −1.55%.
  - The information is in the path markets (December hike, "rate hike in 2026"), not in the next decision.
- For Probabl, CPI and jobs markets pair best with SHY, BND, GLD and SLV (and KRE/IWM-like small caps), not with SPY.
- Detailed table below.
- The literature pass found SPY's mean absolute move is 1.00% on CPI days and 1.00% on jobs days, vs 0.74% on quiet days (2022–Oct 2026).
- CPI days in 2026 move less than an average day (0.47% vs 0.62%).
- The FEDS 2026-010 paper finds Kalshi's CPI forecast beats Bloomberg consensus (MAE 0.063pp vs 0.081pp).

### 6.3 Tariffs and US–China

**Live:** "US x China tariff agreement by December 31" is thin ($0.4M).

**The 2025 analog ("…by November 10", n = 54):**

| Token | r | β per 10pp |
|---|---|---|
| QQQ | +0.67 | +0.94% |
| SPY | +0.66 | +0.69% |
| EWT | +0.63 | +1.37% |

Semis and AAPL had the same sign. These are the highest r values in the study for an equity index.

**Event days (simple % returns):**

| Date | Event | Moves |
|---|---|---|
| Apr 3, 2025 | Liberation Day | SPY −4.9%, AAPL −9.2%, AMZN −9.0%, NKE −14.4%, DELL −19.0%, RH −40% (RH also reported earnings) |
| Apr 9, 2025 | Pause | SPY +10.5%, QQQ +12.0%, SOXX +18.6%, AAPL +15.3%, TSLA +22.7%, EWT +9.4%, EWY +8.9% |
| May 12, 2025 | Geneva | AMZN +8.1%, AAPL +6.2%, SMH +6.3% |
| Oct 10, 2025 | 100% China tariff threat | BTC −7.7%, SOL −17.5%, SMH −5.8%, FUTU −11.1%, BABA −8.4% |
| Feb 20, 2026 | Supreme Court IEEPA ruling | SPY +0.7%; a daily link of tariff-case odds with retailers had R² ≤ 0.02 (literature pass) |

**Probabl:** list AAPL, NVDA, TSM, EWT, SMH and FUTU on any live US–China deal or tariff-rate market. The Trump–Xi APEC meeting in November is the next catalyst. Liquidity is the constraint.

### 6.4 Crypto: policy, price ladders, corporate

**Price ladders:**
- "What price will Bitcoin hit in 2026?" ($76.6M), "BTC hits $100k" rung, n = 329 (crypto) and n = 225 (stocks, Dec 2025–Oct 2026):

  | Token | r | β per 10pp |
  |---|---|---|
  | BTC | +0.60 | +4.8% |
  | ETH | +0.55 | +6.0% |
  | MSTR | +0.53 | +7.7% |
  | COIN | +0.46 | +5.9% |
  | GLXY | +0.41 | +6.9% |
  | CLSK | +0.41 | +6.6% |
  | CRCL | +0.40 | +6.9% |
  | WULF | +0.36 | +5.9% |

- The "$55k dip" rung is tighter: BTC r −0.71, MSTR −0.63, COIN −0.55.
- Hourly (crypto, n ≈ 7,700): r about ±0.2, t ≈ 20. These are the only markets with a strong hourly link.
- Year-end betas to BTC (last 250 sessions): MSTR 1.54, GLXY 1.39, CRCL 1.34, CLSK 1.30, COIN 1.27, HOOD 1.02 (not a token), IREN 1.00, WULF 0.89, BULL 0.83, SOFI 0.62.

**Policy:**
- Clarity Act ($24.1M, 5.4%): CRCL r +0.23 (β +2.4%, n = 193), COIN r +0.17, FUTU r +0.14. Kalshi `KXCRYPTOSTRUCTURE` gives the same signs.
- Event days:
  - GENIUS Act Senate passage (Jun 18, 2025): COIN +16.3%; CRCL +33.8% according to the literature pass.
  - ETH ETF odds jump (May 20, 2024): ETH +21.8%, COIN +8.5%.
  - Spot-BTC ETF approval (Jan 11, 2024): "sell the news", COIN −6.7% and BTC −3.3%.
  - Strategic Bitcoin Reserve executive order signed (Mar 7, 2025): BTC −3.2%.
  - Daily link for "Bitcoin reserve in first 100 days" (Nov 2024–Apr 2025): BTC r +0.22, SOL +0.26.

**Corporate:**
- "MicroStrategy sells any Bitcoin by…" ($407M) resolved YES on Jun 1, 2026: MSTR −5.9%, BTC −4.0%.
- MSCI-delisting odds: no measurable link.

### 6.5 Megacap, AI and tech

**"Largest company end of December 2026"** ($8.6M):
- NVIDIA leg vs NVDA r +0.43 (β +2.5%, t 7.1, n = 232).
- Apple leg vs AAPL r +0.26.
- The NVIDIA leg also moves AAPL and GOOGL negatively (relative-value).

**AI-ranking markets do not move stocks:**
- Chained monthly "best AI model": Google leg vs GOOGL r ≈ 0 (n = 382); OpenAI leg vs MSFT/ORCL r < 0.08.
- Kalshi `KXLLM1` (Gemini) vs GOOGL r ≈ 0.
- There is one weak, consistent sign: the Anthropic leg vs software names, TEAM r −0.16, CTSH −0.11, ZM −0.22 (n = 94–383), plus the Kalshi Claude leg vs TEAM −0.13.

**Release events:**
- DeepSeek R1 (Jan 27, 2025) was the largest AI shock: NVDA −17.0%, VRT −29.9%, VST −28.3%, CLS −28.2%, ANET −22.4%, GEV −21.5%, PWR −18.3%.
- Gemini 3 (Nov 18, 2025) and GPT-5 (Aug 7, 2025) moved little on the day.

**IPO markets:**
- The SpaceX IPO (Jun 12, 2026) pulled money out of listed space names: FLY −19.1%, ASTS −15.5%, LUNR −13.1%, RKLB −10.8%, RDW −11.5%.
- The pre-IPO "SpaceX IPO by Jun 30" market had r +0.12–0.17 with LUNR, ASTS and FLY.
- Anthropic IPO odds (77.5% by Dec 31) vs AMZN and GOOGL: no measurable daily link.
- The OpenAI IPO odds jump (May 20, 2026; +45pp) came with AMD +8%.

**Tesla:**
- Delivery-report days (12, 2024–26): mean absolute TSLA move 5.0% vs 3.5% normal sd.
- Earnings: 9.0% mean move (literature pass).
- Optimus, robotaxi and Tesla–SpaceX merger markets show no stable link. SPCX r −0.12 vs merger odds.

### 6.6 Elections

**2024 presidential (template):**
- P(Trump) daily vs DJT: r +0.27, β +16% per 10pp (n = 210, Jan–Nov 2024). The literature pass found +15.5% over Jul–Nov.
- Other links: COIN r +0.17 (β +5.1%), RUN r −0.14 (β −4.4%), KRE (comparator) β +1.8%, LMT β −1.2%. BTC's daily link was nil (r +0.03).
- Election day (Nov 6, 2024; odds 62% → 100%): COIN +31.1%, HOOD +19.6%, KRE +13.4%, TSLA +14.8%, BTC +9.1%, SPY +2.5%, IWM +5.8%; RUN −29.6%, FLNC −13.2%, GLD −3.0%.
- "House control after 2024 election?" (Democratic leg) vs KRE r −0.50 (t −8.0) and COIN r −0.38 (β −5.4%) (n = 190).

**2026 midterms:**
- The House is about 90% Democratic and drifting, so day-to-day links are weak or odd. DJT vs Kalshi House-D is r +0.15, the wrong sign for a policy story.
- The best measured midterm pair is CLOV (Medicare Advantage) vs "Democrats sweep": r −0.16, β −6% per 10pp, stable halves.
- Expected resolution-day moves are concentrated in a Republican-hold surprise (8.5–10%): DJT, COIN, clean energy (RUN, FLNC, BE) and managed care. Size them with the 2024 template scaled down.

**Brazil:**
- Daily poll drift does not move NU (r ≈ 0).
- The first-round result did: Oct 4, 2026, P(Flávio) +25pp; Oct 5, NU +13% (z 4.3) and EWZ +12.5% (z 8.1).
- The Oct 25 runoff is a resolution-day event for NU.

**Korea and India:** thin. Korea's June 2025 election day: EWY +3.4%. Dec 3, 2024 martial law: EWY −1.6%. India–Pakistan strikes (May 2025): INDA −0.9%.

### 6.7 Industrial policy, nuclear, health

**US-stake markets (Kalshi `KXUSACOMPANYSTAKE`):**
- The Rigetti and D-Wave legs move the whole quantum basket: RGTI/QBTS r +0.34 to +0.37, QUBT r +0.26, IONQ r +0.19 (n = 157–172).
- Stake-odds jump on May 21, 2026: RGTI +31%, QBTS +33%, QUBT +19%, IONQ +12%.
- The live IonQ leg (5%) and Micron leg (12%) are tiny markets (30k contracts).
- Template: US stake in Intel (Aug 22, 2025): INTC +5.5%.

**Nuclear:** Kalshi "US grants license for new nuclear reactor before 2027" (834k contracts) vs OKLO r +0.19 (β +3.7%), SMR r +0.17.

**Health:** Hantavirus pandemic ($18.6M) and "new pandemic" markets show no stable link to MRNA, PFE or JNJ. The probabilities are low (1.5–3.6%).

### 6.8 Earnings (template; no liquid prediction market)

- **Sample:** 211 resolved Polymarket "Will X beat quarterly earnings?" markets on tokens, Oct 2025–Oct 2026. The beat rate was 79%.
- **Size:** mean absolute 2-day move 8.3%, vs a normal 2-day sd of 4.7% (ratio 1.78).
- **Δ:** mean 2-day return +1.6% after beats and −4.2% after misses, so the cross-sectional Δ(beat − miss) is about 5.8pp.
- **Per-ticker averages** (literature pass, last 12 reports, reaction day):

  | Ticker | Mean move |
  |---|---|
  | PLTR | 16.3% |
  | CRWV | 16.4% |
  | ORCL | 11.5% |
  | WULF | 10.9% |
  | CLSK | 10.4% |
  | AVGO | 9.3% |
  | TSLA | 9.0% |
  | META | 8.2% |
  | AMD | 8.0% |
  | COIN | 8.0% |
  | NFLX | 7.8% |
  | AMZN | 6.3% |
  | NVDA | 5.6% |
  | MSFT | 5.4% |
  | GOOGL | 5.4% |
  | AAPL | 2.3% |

  Options implied moves on Oct 20, 2026: NVDA 9.3% raw / about 4.4% event-only; TSLA 6.4%; META 6.9%.
- **Liquidity:** Polymarket earnings markets trade $0.4k–$3.5k, the largest ever about $1M (NVDA, Nov 2025). The probability input would come from Probabl's own order book or an options-implied beat rate.

### 6.9 Measured tables

#### Measured daily correlations, by market

Daily data at the US close (16:00 New York). β is the asset's log-return in % per +10 percentage points of probability; r is the Pearson correlation of daily Δprobability with daily log-returns; t is the OLS t-statistic; halves = β in the first and second half of the sample; β|SPY = β after controlling for SPY's same-day return.

| Market (study id) | Venue, volume | Window | Top linked tokens: asset r, β (t) [halves] |
|---|---|---|---|
| How many Fed rate cuts in 2026? :: 0 (0 bps) (`FED_0CUTS_2026`) | Polymarket, $8.9M | 2025-10-01 to 2026-10-19, n=264 | SPY -0.23, -0.81% (t -3.8) [-0.9/-0.7]; SHY -0.23, -0.11% (t -3.8) [-0.1/-0.1]; VTI -0.23, -0.81% (t -3.8) [-0.9/-0.7]; BND -0.22, -0.24% (t -3.6) [-0.3/-0.2]; ETH -0.16, -2.79% (t -3.2) [-2.5/-3.2]; SOFI -0.19, -2.95% (t -3.1) [-0.9/-5.2] |
| Another Fed rate hike in 2026? :: Another Fed rate hike in 2026? (`FED_ANOTHER_HIKE_2026`) | Polymarket, $877k | 2026-09-17 to 2026-10-19, n=23 | RIVN +0.29, +1.67% (t +1.4) [+0.1/+2.8]; COIN +0.25, +2.82% (t +1.2) [+3.2/+2.9]; GLW -0.21, -2.22% (t -1.0) [-2.3/-1.8]; CVNA -0.20, -1.75% (t -0.9) [-3.1/-1.0]; GLD -0.17, -0.65% (t -0.8) [-0.9/-0.5]; SLV -0.17, -1.22% (t -0.8) [-0.8/-1.5] |
| Fed Decision in December? :: 25 bps increase (`FED_DEC26_HIKE`) | Polymarket, $942k | 2026-07-31 to 2026-10-19, n=56 | SHY -0.47, -0.15% (t -3.9) [-0.1/-0.2]; SLV -0.46, -3.39% (t -3.8) [-2.5/-3.8]; GLD -0.44, -1.98% (t -3.6) [-1.9/-1.9]; BND -0.43, -0.37% (t -3.5) [-0.3/-0.4]; NU -0.34, -3.44% (t -2.7) [-2.6/-4.1]; SPMO -0.34, -1.25% (t -2.6) [-1.5/-0.9] |
| Kalshi: exactly 0 cuts in 2026 (`FED_HIKES_2026_K`) | Kalshi, 2.8M contracts | 2025-10-07 to 2026-10-19, n=255 | SHY -0.20, -0.10% (t -3.2) [-0.2/-0.1]; BTC -0.13, -1.67% (t -2.6) [-2.6/-1.1]; SPY -0.10, -0.37% (t -1.6) [-1.0/+0.1]; GLD -0.05, -0.38% (t -0.8) [-0.1/-0.6]; QQQ -0.03, -0.16% (t -0.4) [-1.1/+0.5] |
| Fed rate hike in 2026? :: Fed rate hike in 2026? (`FED_HIKE_2026`) | Polymarket, $10.1M | 2025-12-12 to 2026-09-16, n=190 | SHY -0.38, -0.10% (t -5.6) [-0.1/-0.1]; BND -0.34, -0.20% (t -4.9) [-0.3/-0.2]; VTI -0.31, -0.62% (t -4.5) [-2.4/-0.5]; SPY -0.31, -0.59% (t -4.4) [-2.4/-0.5]; QQQ -0.29, -0.88% (t -4.2) [-2.8/-0.7]; CVNA -0.27, -2.47% (t -3.9) [-5.4/-2.2] |
| Fed expected bp change at next meeting (fed-interest-rates-january-2025) (`FED_NEXT_MEETING_BP_25_26`) | Polymarket, $190.9M | 2024-11-11 to 2026-09-16, n=449 | SHY -0.30, -0.68% per +25bp (t -6.7); BND -0.23, -1.26% per +25bp (t -5.0); SPY +0.14, +2.82% per +25bp (t +2.9); VTI +0.12, +2.57% per +25bp (t +2.6); GLD -0.12, -3.78% per +25bp (t -2.6); XLK +0.11, +3.69% per +25bp (t +2.4) |
| Fed Decision in October? :: 25 bps increase (`FED_OCT26_HIKE`) | Polymarket, $11.1M | 2026-06-22 to 2026-10-19, n=84 | SHY -0.28, -0.06% (t -2.7) [-0.0/-0.1]; BND -0.24, -0.12% (t -2.2) [-0.1/-0.1]; NU -0.23, -1.38% (t -2.2) [-0.2/-1.9]; CVNA -0.22, -1.49% (t -2.1) [-0.5/-1.9]; RIVN -0.19, -1.44% (t -1.7) [-4.2/-0.4]; SOFI -0.19, -1.15% (t -1.7) [-1.5/-1.0] |
| Who will Trump nominate as Fed Chair? :: Kevin Hassett (`FEDCHAIR_HASSETT`) | Polymarket, $36.1M | 2025-08-06 to 2026-01-30, n=123 | SLV +0.20, +1.76% (t +2.2) [+0.5/+2.0]; SGOV -0.18, -0.03% (t -2.0) [+0.0/-0.0]; XLK +0.16, +0.40% (t +1.8) [+0.1/+0.4]; QQQ +0.14, +0.29% (t +1.6) [+0.1/+0.3]; GLD +0.14, +0.51% (t +1.6) [+0.7/+0.5]; SPMO +0.14, +0.26% (t +1.5) [+0.3/+0.2] |
| Who will Trump nominate as Fed Chair? :: Kevin Warsh (`FEDCHAIR_WARSH`) | Polymarket, $59.9M | 2025-08-06 to 2026-01-30, n=123 | SLV -0.69, -3.83% (t -10.5) [-0.1/-4.1]; GLD -0.56, -1.27% (t -7.4) [-0.5/-1.3]; SCHD +0.18, +0.16% (t +2.0) [-0.4/+0.2]; ETH -0.14, -0.81% (t -1.8) [-4.4/-0.6]; XLK -0.16, -0.26% (t -1.8) [-0.1/-0.2]; QQQ -0.13, -0.16% (t -1.4) [-0.4/-0.1] |
| Will Trump try to fire Powell by August 31? :: Will Trump try to fire Powell by August 31? (`FIRE_POWELL_AUG25`) | Polymarket, $2.1M | 2025-07-16 to 2025-08-31, n=47 | ETH +0.40, +6.37% (t +3.0) [+6.2/+20.8]; BTC +0.25, +1.55% (t +1.8) [+1.6/-6.7]; SLV +0.26, +1.12% (t +1.5) [+1.0/+6.9]; SHY +0.21, +0.05% (t +1.2) [+0.1/+0.3]; GLD +0.19, +0.52% (t +1.1) [+0.5/+4.7]; SGOV +0.11, +0.02% (t +0.6) [+0.0/-0.1] |
| Lisa Cook out as Fed Governor by...? :: September 30 (`LISA_COOK_OUT_SEP25`) | Polymarket, $7.6M | 2025-08-27 to 2025-09-30, n=24 | SGOV +0.43, +0.12% (t +2.2) [+0.2/+0.0]; SHY +0.30, +0.11% (t +1.5) [+0.2/-0.0]; GLD -0.29, -0.85% (t -1.4) [-1.0/-0.9]; ETH +0.22, +2.58% (t +1.3) [+2.7/+1.8]; XLK -0.22, -0.66% (t -1.0) [-0.8/-0.1]; QQQ +0.11, +0.23% (t +0.5) [+0.4/-0.5] |
| US recession in 2025? :: US recession in 2025? (`RECESSION_2025`) | Polymarket, $11.7M | 2025-01-10 to 2025-12-31, n=245 | SPY -0.48, -2.31% (t -8.6) [-2.4/-1.6]; VTI -0.48, -2.28% (t -8.5) [-2.3/-1.6]; SCHD -0.44, -1.74% (t -7.6) [-1.8/-0.3]; CCL -0.44, -5.17% (t -7.6) [-5.4/-2.3]; SPMO -0.44, -2.45% (t -7.5) [-2.5/-2.4]; QQQ -0.43, -2.47% (t -7.4) [-2.5/-2.0] |
| US recession by end of 2026? :: US recession by end of 2026? (`RECESSION_2026`) | Polymarket, $2.3M | 2025-10-01 to 2026-10-19, n=264 | SGOV +0.18, +0.06% (t +3.0) [+0.1/+0.0]; F -0.15, -1.91% (t -2.5) [-1.5/-3.1]; AMZN -0.15, -1.66% (t -2.5) [-1.4/-2.4]; UPS -0.14, -1.39% (t -2.3) [-0.8/-3.0]; SPY -0.13, -0.56% (t -2.2) [-0.4/-1.1]; VTI -0.13, -0.55% (t -2.1) [-0.3/-1.1] |
| Kalshi: recession in 2026 (`RECESSION_2026_K`) | Kalshi, 3.7M contracts | 2025-07-15 to 2026-10-19, n=319 | SPY -0.22, -1.04% (t -4.0) [-1.0/-1.0]; QQQ -0.21, -1.49% (t -3.8) [-1.2/-1.6]; BTC -0.09, -1.47% (t -2.0) [+0.1/-1.9]; GLD -0.11, -1.16% (t -2.0) [+0.3/-1.6]; SHY -0.05, -0.03% (t -0.9) [-0.0/-0.0] |
| Will there be a US Government shutdown?  :: Will there be a US Government shutdown?  (`SHUTDOWN_DEC24`) | Polymarket, $53.5M | 2024-09-04 to 2024-12-24, n=79 | GLD -0.12, -0.18% (t -1.0) [-0.9/-0.0]; SHY -0.10, -0.02% (t -0.9) [-0.0/-0.0]; BTC -0.07, -0.30% (t -0.7) [-0.6/-0.3]; SPY +0.01, +0.01% (t +0.1) [+0.0/+0.0]; QQQ -0.00, -0.00% (t -0.0) [+0.1/-0.0] |
| US government shutdown Saturday? :: US government shutdown Saturday? (`SHUTDOWN_JAN26`) | Polymarket, $157.3M | 2025-11-14 to 2026-02-03, n=54 | GLD -0.33, -0.62% (t -2.5) [-1.5/-0.6]; LMT -0.13, -0.20% (t -1.0) [+1.3/-0.3]; SPY +0.11, +0.06% (t +0.8) [-0.1/+0.1]; BTC -0.04, -0.10% (t -0.3) [-0.6/-0.1]; QQQ +0.03, +0.02% (t +0.2) [-0.1/+0.0]; PLTR -0.02, -0.05% (t -0.2) [+0.4/-0.0] |
| Israel x Hezbollah ceasefire by...? :: April 30 (`HEZBOLLAH_CEASEFIRE_APR30`) | Polymarket, $4.4M | 2026-03-26 to 2026-04-16, n=15 | USO -0.43, -1.00% (t -1.7) [-1.0/-0.7]; SPY +0.27, +0.16% (t +1.0) [+1.5/+0.0]; LMT -0.20, -0.15% (t -0.7) [+0.4/-0.1]; XOM -0.20, -0.23% (t -0.7) [-0.4/-0.1]; TSEM +0.14, +0.35% (t +0.5) [+6.1/-0.1]; PR -0.10, -0.10% (t -0.4) [-1.3/+0.0] |
| Strait of Hormuz traffic returns to normal by December 31? :: Strait of Hormuz traffic ret (`HORMUZ_NORMAL_DEC31`) | Polymarket, $15.3M | 2026-05-12 to 2026-10-19, n=111 | USO -0.53, -4.35% (t -6.5) [-3.7/-5.3]; XOM -0.42, -1.87% (t -4.9) [-1.9/-1.9]; PR -0.40, -2.38% (t -4.5) [-2.0/-2.9]; CCL +0.39, +2.97% (t +4.5) [+2.7/+3.3]; BND +0.30, +0.22% (t +3.3) [+0.1/+0.3]; VTI +0.21, +0.45% (t +2.3) [+0.2/+0.8] |
| Kalshi: Hormuz traffic normal before 2027 (`HORMUZ_NORMAL_K`) | Kalshi, 3.4M contracts | 2026-03-18 to 2026-10-19, n=149 | USO -0.53, -4.47% (t -7.5) [-3.8/-6.0]; XOM -0.48, -2.05% (t -6.7) [-1.9/-2.2]; PR -0.43, -2.36% (t -5.8) [-1.8/-3.5]; CCL +0.42, +3.10% (t +5.6) [+3.5/+2.1]; SPY +0.38, +0.77% (t +4.9) [+0.8/+0.7]; QQQ +0.36, +1.19% (t +4.6) [+1.2/+1.2] |
| US x Iran ceasefire by...? :: April 30 (`IRAN26_CEASEFIRE_APR30`) | Polymarket, $17.7M | 2026-03-03 to 2026-04-07, n=25 | USO -0.64, -4.07% (t -4.0) [-1.6/-4.5]; F +0.54, +1.30% (t +3.1) [+2.6/+0.9]; SLV +0.54, +2.71% (t +3.0) [+5.2/+2.1]; ETH +0.44, +2.54% (t +3.0) [+3.1/+2.5]; CCL +0.52, +2.41% (t +2.9) [+2.2/+2.3]; PLTR +0.51, +2.01% (t +2.9) [+0.3/+2.5] |
| Iran x Israel/US conflict ends by...? :: May 15 (`IRAN26_CONFLICT_END_MAY15`) | Polymarket, $13.7M | 2026-03-03 to 2026-04-24, n=38 | SPMO +0.56, +1.07% (t +4.0) [+0.5/+1.1]; USO -0.55, -3.46% (t -3.9) [-3.0/-3.8]; VTI +0.54, +0.78% (t +3.9) [+0.7/+0.6]; SPY +0.54, +0.76% (t +3.8) [+0.6/+0.6]; QQQ +0.53, +0.92% (t +3.8) [+0.7/+0.7]; XLK +0.50, +1.07% (t +3.5) [+0.9/+0.8] |
| Trump announces end of military operations against Iran by ...? :: April 30 (`IRAN26_END_OPS_APR30`) | Polymarket, $13.1M | 2026-03-10 to 2026-04-30, n=37 | USO -0.65, -3.42% (t -5.1) [-3.3/-3.5]; F +0.58, +1.21% (t +4.3) [+1.2/+1.3]; CCL +0.56, +2.43% (t +4.0) [+2.4/+2.5]; PR -0.46, -1.08% (t -3.1) [-0.7/-1.4]; SPY +0.45, +0.54% (t +3.0) [+0.6/+0.5]; XOM -0.41, -0.90% (t -2.7) [-0.6/-1.2] |
| US x Iran permanent peace deal by...? :: June 15 (`IRAN26_PEACE_JUN15`) | Polymarket, $177.4M | 2026-05-17 to 2026-06-17, n=32 | ETH +0.54, +1.18% (t +3.5) [+0.5/+1.4]; XOM -0.62, -0.65% (t -3.4) [-1.8/-0.6]; BTC +0.48, +0.66% (t +3.0) [+0.5/+0.7]; BA +0.48, +0.69% (t +2.4) [+0.5/+0.7]; SPY +0.48, +0.27% (t +2.4) [+0.2/+0.3]; GLD +0.48, +0.48% (t +2.4) [+0.5/+0.6] |
| US x Iran permanent peace deal by...? :: May 31 (`IRAN26_PEACE_MAY31`) | Polymarket, $87.9M | 2026-04-09 to 2026-05-29, n=36 | PR -0.62, -1.84% (t -4.6) [-1.5/-2.2]; USO -0.61, -2.84% (t -4.5) [-2.8/-2.7]; XOM -0.57, -1.37% (t -4.0) [-0.8/-2.1]; CCL +0.55, +2.29% (t +3.8) [+1.9/+2.8]; QQQ +0.50, +0.62% (t +3.4) [+0.6/+0.7]; BND +0.49, +0.16% (t +3.3) [+0.1/+0.2] |
| US/Israel strikes Iran by...? :: February 28 (`IRAN26_STRIKE_BY_FEB28`) | Polymarket, $5.9M | 2026-01-21 to 2026-02-27, n=27 | USO +0.69, +1.85% (t +4.8) [+2.1/+1.5]; SGOV +0.60, +0.05% (t +3.7) [+0.1/+0.0]; PR +0.55, +1.25% (t +3.3) [+1.4/+1.0]; XOM +0.48, +1.09% (t +2.7) [+1.1/+1.0]; SHY +0.38, +0.04% (t +2.1) [+0.1/-0.0]; GLD +0.34, +1.36% (t +1.8) [+1.9/+0.6] |
| Israel strikes Iran by January 31, 2026? :: January 31 (`IRAN26_STRIKE_BY_JAN31`) | Polymarket, $16.9M | 2025-12-23 to 2026-01-30, n=26 | HII +0.39, +1.20% (t +2.1) [+2.4/+0.7]; USO +0.37, +0.97% (t +2.0) [+0.4/+1.4]; RCAT +0.34, +3.89% (t +1.8) [+8.0/+2.4]; RDW +0.32, +4.48% (t +1.6) [+8.0/+3.2]; F +0.32, +0.81% (t +1.6) [+2.3/+0.2]; AVAV +0.31, +2.59% (t +1.6) [+6.2/+0.3] |
| Will the Iranian regime fall before 2027? :: Will the Iranian regime fall before 2027? (`IRAN_REGIME_FALL_2026`) | Polymarket, $27.6M | 2025-11-05 to 2026-10-19, n=239 | XOM +0.30, +2.06% (t +4.8) [+1.8/+5.8]; USO +0.30, +3.85% (t +4.8) [+3.5/+9.4]; PR +0.19, +1.69% (t +3.0) [+1.3/+7.3]; KTOS +0.12, +2.19% (t +1.8) [+2.4/-1.2]; LHX +0.11, +0.81% (t +1.7) [+0.8/+0.9]; SPY -0.10, -0.35% (t -1.6) [-0.2/-1.9] |
| Israel x Iran ceasefire continues through...? :: October 31 (`ISR_IRAN_CEASEFIRE_OCT31`) | Polymarket, $2.6M | 2026-08-10 to 2026-10-19, n=50 | XOM -0.24, -1.04% (t -1.7) [-1.3/+0.1]; LHX -0.20, -0.77% (t -1.4) [-0.6/-1.3]; USO -0.18, -1.28% (t -1.3) [-1.4/-1.5]; SPY +0.17, +0.27% (t +1.2) [+0.1/+1.0]; PLTR +0.15, +1.18% (t +1.0) [+0.8/+3.2]; AXON +0.13, +1.34% (t +0.9) [+2.1/-2.0] |
| Kharg Island no longer under Iranian control by...? :: June 30 (`KHARG_JUN30`) | Polymarket, $13.5M | 2026-03-26 to 2026-06-30, n=66 | SPY -0.41, -1.12% (t -3.6) [-1.0/-3.0]; GLD -0.37, -1.78% (t -3.2) [-1.6/-4.8]; USO +0.36, +3.83% (t +3.1) [+4.2/+4.2]; XOM +0.32, +1.74% (t +2.7) [+1.6/+6.9]; RCAT -0.28, -5.82% (t -2.3) [-4.9/-34.8]; PR +0.23, +1.43% (t +1.9) [+1.4/+3.9] |
| Will the U.S. invade Iran before 2027? :: Will the U.S. invade Iran before 2027? (`US_INVADE_IRAN_2026`) | Polymarket, $74.7M | 2025-11-06 to 2026-10-19, n=238 | USO +0.43, +4.73% (t +7.4) [+3.9/+6.9]; XOM +0.36, +2.10% (t +6.0) [+1.6/+3.7]; CCL -0.34, -3.57% (t -5.5) [-3.4/-4.1]; SPY -0.33, -0.91% (t -5.3) [-0.8/-1.2]; VTI -0.32, -0.91% (t -5.2) [-0.8/-1.2]; PR +0.28, +2.09% (t +4.5) [+1.4/+4.0] |
| US announces end of Iranian blockade by...? :: December 31 (`US_IRAN_BLOCKADE_END_DEC31`) | Polymarket, $3.7M | 2026-07-28 to 2026-10-19, n=59 | USO -0.59, -4.07% (t -5.5) [-4.1/-3.9]; XOM -0.48, -1.80% (t -4.2) [-2.0/-1.2]; PR -0.46, -2.57% (t -3.9) [-2.8/-2.1]; CCL +0.44, +2.87% (t +3.7) [+3.2/+2.0]; BA +0.33, +1.78% (t +2.6) [+1.8/+1.6]; SPY +0.32, +0.55% (t +2.6) [+0.4/+1.0] |
| US-Iran ceasefire continues through...? :: October 31 (`US_IRAN_CEASEFIRE_OCT31`) | Polymarket, $4.7M | 2026-09-18 to 2026-10-19, n=22 | SPY +0.54, +0.65% (t +2.9) [+0.7/+0.5]; QQQ +0.52, +1.12% (t +2.7) [+1.3/+0.8]; USO -0.50, -2.25% (t -2.6) [-2.8/-1.3]; XOM -0.39, -0.98% (t -1.9) [-1.6/+0.3]; BTC +0.31, +1.29% (t +1.8) [+2.0/-0.1]; AXON +0.35, +1.43% (t +1.7) [+1.4/+1.5] |
| US-Iran Final Nuclear Deal by…? :: December 31 (`US_IRAN_DEAL_DEC31`) | Polymarket, $3.5M | 2026-06-30 to 2026-10-19, n=78 | USO -0.52, -6.63% (t -5.3) [-7.1/-6.3]; PR -0.42, -3.97% (t -4.0) [-3.7/-4.4]; XOM -0.38, -2.42% (t -3.6) [-2.5/-2.0]; CCL +0.31, +3.29% (t +2.8) [+3.3/+3.3]; QQQ +0.25, +1.28% (t +2.3) [+1.2/+1.7]; RDW +0.24, +4.92% (t +2.2) [+5.9/+3.9] |
| Kalshi: US-Iran nuclear deal before 2027 (`US_IRAN_DEAL_K`) | Kalshi, 1.8M contracts | 2026-01-09 to 2026-10-19, n=195 | USO -0.27, -1.74% (t -3.9) [-1.5/-3.5]; CCL +0.24, +1.42% (t +3.4) [+1.4/+1.8]; BA +0.21, +0.86% (t +3.0) [+0.6/+2.1]; PR -0.21, -0.85% (t -3.0) [-0.7/-1.6]; SPY +0.21, +0.32% (t +2.9) [+0.3/+0.2]; LMT +0.19, +0.67% (t +2.7) [+0.6/+1.0] |
| Crude Oil all time high by...? :: December 31 (`CRUDE_ATH_DEC31`) | Polymarket, $2.0M | 2026-05-01 to 2026-10-19, n=118 | USO +0.44, +3.19% (t +5.3) [+2.7/+14.4]; XOM +0.34, +1.35% (t +3.9) [+1.1/+5.7]; CCL -0.33, -2.17% (t -3.7) [-2.0/-6.4]; GLD -0.22, -0.77% (t -2.4) [-0.8/-0.3]; SPY -0.21, -0.38% (t -2.3) [-0.3/-2.4]; BA -0.20, -1.02% (t -2.2) [-1.0/-2.3] |
| Kalshi: WTI > $120 by Dec 31 (`WTI_120_K`) | Kalshi, 999k contracts | 2026-03-06 to 2026-10-19, n=157 | USO +0.73, +4.54% (t +13.1) [+4.3/+6.1]; CCL -0.53, -2.80% (t -7.7) [-2.9/-2.1]; SPY -0.50, -0.72% (t -7.2) [-0.7/-1.0]; XOM +0.43, +1.28% (t +6.0) [+1.2/+1.9]; QQQ -0.41, -0.96% (t -5.6) [-0.9/-1.4]; PR +0.41, +1.55% (t +5.5) [+1.2/+3.6] |
| Russia x Ukraine ceasefire in 2025? :: Russia x Ukraine ceasefire in 2025? (`RU_UA_CEASEFIRE_2025`) | Polymarket, $73.8M | 2024-12-31 to 2025-12-31, n=251 | LHX -0.12, -0.63% (t -2.0) [-0.5/-0.8]; RCAT -0.12, -3.15% (t -1.9) [-2.2/-4.6]; USO -0.11, -0.79% (t -1.8) [+0.2/-2.2]; LMT -0.07, -0.44% (t -1.1) [-0.4/-0.5]; GLD -0.05, -0.24% (t -0.8) [-0.1/-0.4]; AXON +0.05, +0.63% (t +0.8) [+0.5/+0.8] |
| Russia x Ukraine ceasefire agreement by...? :: December 31 (`RU_UA_CEASEFIRE_DEC31`) | Polymarket, $2.9M | 2026-05-14 to 2026-10-19, n=109 | LMT -0.14, -1.51% (t -1.4) [-0.3/-2.6]; HII -0.13, -1.72% (t -1.4) [-1.0/-2.4]; AXON +0.12, +2.99% (t +1.3) [+7.2/-0.7]; SPY +0.09, +0.41% (t +1.0) [+0.6/+0.3]; AVAV -0.08, -2.24% (t -0.9) [-2.5/-2.1]; LHX -0.06, -0.64% (t -0.6) [+0.8/-1.8] |
| Russia x Ukraine ceasefire by January 31, 2026? :: Russia x Ukraine ceasefire by January 3 (`RU_UA_CEASEFIRE_JAN26`) | Polymarket, $27.0M | 2025-11-28 to 2026-01-30, n=43 | USO -0.25, -2.24% (t -1.7) [-3.7/+8.0]; XOM -0.21, -1.57% (t -1.4) [-2.5/+4.5]; PR -0.17, -1.77% (t -1.1) [-3.3/+8.1]; KTOS -0.14, -3.35% (t -0.9) [-3.8/-3.2]; GLD +0.14, +1.53% (t +0.9) [+1.3/+2.4]; RDW -0.13, -5.39% (t -0.8) [-6.2/-2.7] |
| Russia x Ukraine ceasefire by June 30, 2026? :: Russia x Ukraine ceasefire by June 30, 202 (`RU_UA_CEASEFIRE_JUN26`) | Polymarket, $60.7M | 2026-01-14 to 2026-05-08, n=80 | RDW +0.24, +5.18% (t +2.2) [+10.3/+4.2]; AXON -0.17, -2.05% (t -1.5) [-2.5/-2.0]; AVAV -0.14, -1.92% (t -1.2) [-10.1/-0.5]; XOM -0.10, -0.54% (t -0.9) [-0.3/-0.5]; PR -0.08, -0.47% (t -0.7) [+1.3/-0.7]; BTC +0.06, +0.25% (t +0.6) [+2.9/+0.1] |
| US x Venezuela military engagement by...? :: December 31 (`VENEZUELA_ENGAGE_DEC25`) | Polymarket, $51.1M | 2025-09-08 to 2026-01-02, n=82 | LHX -0.19, -0.36% (t -1.7) [-0.4/-0.3]; USO +0.17, +0.34% (t +1.6) [-0.0/+0.7]; KTOS +0.12, +0.61% (t +1.1) [+0.5/+0.5]; GLD -0.11, -0.20% (t -1.0) [-0.1/-0.3]; PR -0.07, -0.17% (t -0.6) [-0.4/+0.1]; LMT -0.05, -0.07% (t -0.4) [-0.1/-0.0] |
| Will China invade Taiwan by end of 2026? :: Will China invade Taiwan by end of 2026? (`CHINA_INVADE_TW_2026`) | Polymarket, $44.4M | 2025-07-28 to 2026-10-19, n=310 | SPY +0.08, +0.85% (t +1.3) [+0.8/+1.2]; QQQ +0.07, +1.11% (t +1.1) [+1.0/+2.5]; AMD +0.06, +3.50% (t +1.0) [+2.6/+11.6]; ASML +0.06, +2.23% (t +1.0) [+1.8/+7.1]; EWT +0.06, +1.51% (t +1.0) [+1.2/+4.4]; NVDA +0.05, +1.70% (t +0.9) [+1.8/+0.5] |
| 100% tariff on China in effect by November 1? :: 100% tariff on China in effect by Novembe (`CHINA_100PCT_TARIFF_NOV25`) | Polymarket, $1.5M | 2025-10-12 to 2025-11-01, n=21 | BTC -0.20, -0.75% (t -0.9) [-0.7/-1.4] |
| Will Trump impose 25% tariff on Mexico or Canada before February? :: Will Trump impose 25% (`MEXCAN_25PCT_TARIFF_JAN25`) | Polymarket, $2.8M | 2024-11-27 to 2025-02-03, n=44 | TSLA +0.33, +2.63% (t +2.2) [+1.9/+2.8]; F +0.16, +0.54% (t +1.0) [+0.4/+0.7]; COST -0.15, -0.33% (t -1.0) [-0.2/-0.2]; XOM -0.06, -0.15% (t -0.4) [-0.4/+0.1]; SPY -0.04, -0.07% (t -0.3) [+0.1/-0.1]; UPS -0.03, -0.15% (t -0.2) [+0.3/-0.4] |
| US x China tariff agreement by November 10? :: US x China tariff agreement by November 10? (`US_CHINA_DEAL_NOV25`) | Polymarket, $669k | 2025-08-14 to 2025-10-29, n=54 | QQQ +0.67, +0.94% (t +6.5) [+0.8/+0.9]; SPY +0.66, +0.69% (t +6.3) [+0.3/+0.7]; EWT +0.63, +1.37% (t +5.9) [+0.9/+1.4]; SMH +0.62, +1.67% (t +5.7) [+2.0/+1.6]; SOXX +0.61, +1.78% (t +5.5) [+1.7/+1.8]; QCOM +0.61, +2.19% (t +5.5) [+0.1/+2.3] |
| Bitcoin ETF approved by Jan 15? :: Bitcoin ETF approved by Jan 15? (`BTC_ETF_JAN24`) | Polymarket, $12.6M | 2023-12-02 to 2024-01-10, n=40 | ETH +0.48, +2.94% (t +3.4) [+0.8/+7.6]; BTC +0.19, +0.95% (t +1.2) [+0.3/+2.5]; COIN -0.15, -1.34% (t -0.7) [-3.8/+2.4]; MSTR -0.05, -0.45% (t -0.2) [-4.5/+5.3] |
| Will Trump create Bitcoin reserve in first 100 days? :: Will Trump create Bitcoin reserve  (`BTC_RESERVE_100D`) | Polymarket, $23.3M | 2024-11-08 to 2025-04-29, n=173 | SOL +0.26, +3.64% (t +3.5) [+3.5/+3.7]; BTC +0.22, +1.69% (t +2.9) [+2.5/+1.2]; XRP +0.12, +2.10% (t +1.6) [+0.8/+3.0]; ETH +0.11, +1.26% (t +1.5) [+2.3/+0.6]; COIN +0.12, +1.41% (t +1.3) [-0.7/+2.9]; MSTR +0.06, +0.98% (t +0.6) [+0.3/+1.5] |
| US national Bitcoin reserve in 2025? :: US national Bitcoin reserve in 2025? (`BTC_RESERVE_2025`) | Polymarket, $5.5M | 2025-01-01 to 2025-12-31, n=365 | BTC +0.10, +0.89% (t +1.9) [+1.2/-1.0]; ETH +0.09, +1.50% (t +1.8) [+2.3/-2.9]; MSTR +0.04, +0.56% (t +0.6) [+1.0/-2.1]; COIN +0.03, +0.43% (t +0.5) [+0.7/-1.1] |
| Clarity Act (H.R.3633) signed into law in 2026? :: Clarity Act (H.R.3633) signed into law  (`CLARITY_ACT_2026`) | Polymarket, $24.1M | 2026-01-13 to 2026-10-19, n=193 | CRCL +0.23, +2.42% (t +3.3) [+2.1/+3.4]; COIN +0.17, +1.32% (t +2.3) [+0.6/+3.2]; FUTU +0.14, +0.95% (t +1.9) [+1.0/+1.0]; SOFI +0.12, +0.67% (t +1.7) [+0.5/+1.1]; XRP +0.10, +0.69% (t +1.6) [-0.1/+2.8]; BULL +0.11, +0.78% (t +1.5) [+0.5/+1.6] |
| Kalshi: Clarity Act law before 2027 (`CLARITY_ACT_K`) | Kalshi, 2.4M contracts | 2025-12-09 to 2026-10-19, n=216 | FUTU +0.17, +0.93% (t +2.6) [+0.5/+3.0]; COIN +0.15, +0.94% (t +2.3) [+0.6/+2.7]; XRP +0.13, +0.57% (t +2.3) [+0.3/+2.7]; CRCL +0.13, +1.06% (t +1.9) [+0.7/+2.8]; DOGE +0.11, +0.47% (t +1.9) [+0.3/+1.8]; SOL +0.10, +0.43% (t +1.8) [+0.3/+1.6] |
| Ethereum ETF approved by May 31? :: Ethereum ETF approved by May 31? (`ETH_ETF_MAY24`) | Polymarket, $13.2M | 2024-01-11 to 2024-05-23, n=134 | ETH +0.25, +1.59% (t +3.0) [-0.1/+2.3]; BTC +0.09, +0.51% (t +1.0) [+0.5/+0.6]; SOL +0.05, +0.46% (t +0.6) [-0.4/+1.0]; COIN +0.06, +0.56% (t +0.6) [+0.7/+0.7]; MSTR +0.03, +0.40% (t +0.3) [-0.2/+0.9] |
| Solana ETF approved by July 31? :: Solana ETF approved by July 31? (`SOL_ETF_JUL25`) | Polymarket, $1.9M | 2024-11-23 to 2025-07-04, n=224 | ETH +0.21, +1.52% (t +3.1) [+2.4/+1.2]; SOL +0.17, +1.47% (t +2.6) [+2.7/+1.0]; BTC +0.08, +0.34% (t +1.1) [+0.5/+0.2]; COIN +0.01, +0.07% (t +0.1) [-0.5/+0.2] |
| What price will Bitcoin hit in 2026? :: ↑ 100,000 (`BTC_100K_2026`) | Polymarket, $3.9M | 2025-11-25 to 2026-10-19, n=329 | BTC +0.60, +4.82% (t +13.5) [+4.7/+5.0]; XRP +0.56, +7.13% (t +12.2) [+6.2/+8.4]; ETH +0.55, +5.99% (t +11.8) [+6.4/+5.4]; SOL +0.52, +6.52% (t +11.0) [+6.2/+6.9]; DOGE +0.52, +6.50% (t +10.9) [+6.1/+7.0]; MSTR +0.53, +7.69% (t +9.2) [+5.8/+10.3] |
| What price will Bitcoin hit in 2026? :: ↓ 55,000 (`BTC_55K_DOWN_2026`) | Polymarket, $6.9M | 2025-11-25 to 2026-10-19, n=329 | BTC -0.71, -4.93% (t -18.4) [-5.4/-4.4]; ETH -0.65, -6.15% (t -15.5) [-6.4/-6.0]; XRP -0.61, -6.72% (t -14.1) [-7.1/-6.3]; SOL -0.60, -6.47% (t -13.6) [-6.5/-6.4]; MSTR -0.63, -8.07% (t -12.1) [-7.8/-8.3]; DOGE -0.55, -5.97% (t -11.9) [-6.7/-5.3] |
| What price will Ethereum hit in 2026? :: ↓ 1,500 (`ETH_1500_DOWN_2026`) | Polymarket, $3.2M | 2025-11-25 to 2026-10-19, n=329 | ETH -0.68, -5.67% (t -17.0) [-6.6/-4.8]; BTC -0.65, -3.93% (t -15.4) [-4.9/-3.1]; SOL -0.59, -5.54% (t -13.1) [-6.5/-4.7]; XRP -0.58, -5.56% (t -12.9) [-6.6/-4.6]; MSTR -0.61, -6.84% (t -11.4) [-7.7/-6.1]; COIN -0.57, -5.62% (t -10.3) [-6.1/-5.2] |
| Microstrategy delisted from MSCI index by...? :: March 31 (`MSTR_MSCI_DELIST`) | Polymarket, $1.0M | 2025-12-05 to 2026-03-31, n=117 | BTC +0.06, +0.25% (t +0.7) [+0.2/+10.7]; COIN +0.05, +0.30% (t +0.5) [+0.2/+14.2]; MSTR -0.03, -0.21% (t -0.3) [-0.3/+23.8] |
| MicroStrategy sells any Bitcoin by ___ ? :: June 30, 2026 (`MSTR_SELLS_BTC_JUN26`) | Polymarket, $8.4M | 2025-11-21 to 2026-05-31, n=192 | BTC -0.07, -0.40% (t -0.9) [-1.0/-0.3]; ETH -0.06, -0.51% (t -0.9) [-1.5/-0.3]; MSTR +0.03, +0.26% (t +0.3) [-0.6/+0.5]; COIN -0.01, -0.06% (t -0.1) [-1.4/+0.4] |
| Largest company end of month: Apple (chained) (`LARGEST_AAPL_CHAIN`) | Polymarket, $460k | 2024-11-25 to 2026-10-19, n=232 | AAPL +0.39, +0.95% (t +6.4) [+1.5/+0.8]; NVDA -0.21, -0.69% (t -3.2) [-0.6/-0.7]; GOOGL -0.09, -0.22% (t -1.3) [+0.5/-0.5]; QQQ -0.04, -0.08% (t -0.7) [+0.4/-0.2]; MSFT +0.00, +0.00% (t +0.0) [+0.3/-0.1] |
| Largest Company end of December 2026? :: Apple (`LARGEST_CO_DEC26_AAPL`) | Polymarket, $1.2M | 2025-11-14 to 2026-10-19, n=232 | NVDA -0.33, -2.79% (t -5.3) [-1.7/-3.6]; AAPL +0.26, +1.53% (t +4.2) [+0.6/+2.2]; QQQ -0.25, -1.17% (t -4.0) [-1.0/-1.3]; GOOGL -0.14, -1.01% (t -2.1) [-1.6/-0.5]; MSFT -0.04, -0.32% (t -0.6) [-0.2/-0.5] |
| Largest Company end of December 2026? :: NVIDIA (`LARGEST_CO_DEC26_NVDA`) | Polymarket, $1.4M | 2025-11-14 to 2026-10-19, n=232 | NVDA +0.43, +2.46% (t +7.1) [+1.6/+3.2]; SMH +0.23, +1.49% (t +3.7) [+0.5/+2.4]; AAPL -0.20, -0.80% (t -3.1) [-0.3/-1.3]; GOOGL -0.16, -0.80% (t -2.5) [-1.0/-0.6]; QQQ +0.16, +0.49% (t +2.4) [+0.2/+0.8]; MSFT +0.07, +0.37% (t +1.1) [+0.9/-0.2] |
| Largest company end of month: NVIDIA (chained) (`LARGEST_NVDA_CHAIN`) | Polymarket, $373k | 2024-11-25 to 2026-10-19, n=232 | NVDA +0.34, +1.12% (t +5.4) [+2.7/+0.8]; AAPL -0.24, -0.59% (t -3.7) [+0.2/-0.8]; SMH +0.23, +0.77% (t +3.6) [+1.6/+0.6]; QQQ +0.19, +0.37% (t +3.0) [+0.9/+0.3]; GOOGL +0.15, +0.37% (t +2.3) [+0.4/+0.4]; MSFT +0.08, +0.20% (t +1.2) [+0.8/+0.1] |
| AI bubble burst by...? :: December 31, 2026 (`AI_BUBBLE_BURST_2026`) | Polymarket, $2.5M | 2025-11-21 to 2026-10-19, n=227 | AVGO -0.07, -0.76% (t -1.1) [-0.6/-1.7]; GOOGL -0.07, -0.49% (t -1.0) [-0.4/-0.8]; SMH -0.06, -0.59% (t -1.0) [+0.1/-3.6]; QQQ -0.05, -0.24% (t -0.8) [+0.1/-1.7]; CEG -0.05, -0.53% (t -0.7) [-0.5/-0.8]; VRT -0.04, -0.67% (t -0.7) [+0.4/-5.8] |
| Best AI model end of month: Anthropic (chained) (`BEST_AI_ANTHROPIC_CHAIN`) | Polymarket, $714k | 2025-01-28 to 2026-10-19, n=383 | TEAM -0.16, -1.01% (t -3.1) [-0.0/-1.2]; AMZN -0.11, -0.39% (t -2.1) [-0.4/-0.4]; CTSH -0.11, -0.44% (t -2.1) [-0.3/-0.4]; NOW -0.10, -0.57% (t -1.9) [-0.1/-0.7]; ADBE -0.10, -0.39% (t -1.9) [-0.1/-0.4]; INTU -0.07, -0.35% (t -1.4) [-0.7/-0.2] |
| Which company has best AI model end of 2026? :: Anthropic (`BEST_AI_DEC26_ANTHROPIC`) | Polymarket, $368k | 2026-06-05 to 2026-10-19, n=94 | ZM -0.22, -1.61% (t -2.1) [-1.7/-1.6]; XLK -0.19, -1.03% (t -1.9) [-2.8/-0.5]; NET -0.18, -1.82% (t -1.8) [-4.2/-1.3]; NVDA -0.18, -1.19% (t -1.7) [-2.7/-0.8]; TEAM -0.16, -2.27% (t -1.6) [-2.9/-2.2]; ORCL -0.16, -1.64% (t -1.6) [-2.9/-1.2] |
| Which company has best AI model end of 2026? :: Google (`BEST_AI_DEC26_GOOGLE`) | Polymarket, $307k | 2026-06-05 to 2026-10-19, n=94 | XLK +0.14, +0.75% (t +1.3) [+2.8/+0.3]; NVDA +0.08, +0.58% (t +0.8) [+2.4/+0.2]; PLTR +0.08, +0.91% (t +0.7) [+2.0/+0.7]; GOOGL -0.07, -0.39% (t -0.6) [+0.4/-0.6]; AMD +0.06, +0.75% (t +0.6) [+4.4/-0.2]; ORCL +0.05, +0.54% (t +0.5) [+2.8/-0.2] |
| Best AI model end of month: Google (chained) (`BEST_AI_GOOGLE_CHAIN`) | Polymarket, $696k | 2025-01-28 to 2026-10-19, n=382 | AMZN +0.08, +0.19% (t +1.6) [+0.1/+0.4]; AVGO -0.05, -0.20% (t -1.1) [+0.0/-0.7]; ORCL -0.05, -0.22% (t -0.9) [-0.1/-0.4]; META +0.05, +0.14% (t +0.9) [+0.2/+0.0]; AMD -0.03, -0.18% (t -0.7) [+0.1/-0.7]; XLK -0.03, -0.05% (t -0.5) [+0.0/-0.2] |
| Which company has the best AI model end of October? :: Google (`BEST_AI_OCT26_GOOGLE`) | Polymarket, $658k | 2026-08-14 to 2026-10-19, n=46 | GOOGL -0.19, -0.31% (t -1.3) [-0.6/-0.3]; NVDA +0.12, +0.32% (t +0.8) [+2.7/+0.2]; CRWV +0.08, +0.52% (t +0.6) [-0.4/+0.6]; AVGO -0.07, -0.20% (t -0.5) [+2.9/-0.4]; ORCL +0.07, +0.26% (t +0.4) [+2.0/+0.2]; PLTR +0.06, +0.20% (t +0.4) [-5.5/+0.3] |
| Best AI model end of month: OpenAI (chained) (`BEST_AI_OPENAI_CHAIN`) | Polymarket, $677k | 2025-01-28 to 2026-10-19, n=382 | ORCL +0.07, +0.48% (t +1.3) [+0.3/+1.3]; CRWV -0.04, -0.59% (t -0.8) [-1.3/+1.1]; NVDA -0.04, -0.19% (t -0.8) [-0.4/+0.5]; AMD -0.02, -0.16% (t -0.4) [-0.5/+1.0]; MSFT +0.01, +0.05% (t +0.3) [-0.1/+0.7]; GOOGL -0.00, -0.02% (t -0.1) [-0.0/+0.1] |
| Best AI model end of month: xAI (chained) (`BEST_AI_XAI_CHAIN`) | Polymarket, $1.3M | 2025-01-28 to 2026-07-30, n=336 | GOOGL -0.06, -0.22% (t -1.1) [-0.2/+0.7]; NVDA -0.03, -0.13% (t -0.5) [-0.2/+5.4]; TSLA +0.02, +0.10% (t +0.3) [+0.1/+4.0] |
| Kalshi: Citrini scenario happens (`CITRINI_K`) | Kalshi, 25.9M contracts | 2026-02-27 to 2026-10-19, n=162 | DDOG -0.10, -2.36% (t -1.2) [+1.0/-3.7]; CRM +0.07, +1.23% (t +0.9) [+1.7/+1.3]; NOW +0.07, +1.57% (t +0.9) [+5.9/+0.3]; XLK -0.05, -0.52% (t -0.6) [-0.9/-0.5]; MDB -0.05, -1.28% (t -0.6) [-6.8/+0.7]; TEAM +0.04, +1.09% (t +0.5) [+4.0/+0.4] |
| Kalshi: Anthropic best coding model end 2026 (`CODING_MODEL_ANTH_K`) | Kalshi, 273k contracts | 2026-01-06 to 2026-10-19, n=198 | FIG -0.08, -1.18% (t -1.1) [-0.3/-1.5]; CTSH -0.08, -0.66% (t -1.1) [+0.8/-1.2]; GOOGL +0.06, +0.35% (t +0.9) [-0.3/+0.6]; NET -0.05, -0.69% (t -0.8) [-1.5/-0.4]; SHOP -0.05, -0.55% (t -0.7) [-0.6/-0.5]; INTU -0.05, -0.47% (t -0.6) [-0.2/-0.6] |
| Gemini 3.0 released by...? :: November 30 (`GEMINI3_BY_NOV30`) | Polymarket, $4.6M | 2025-10-08 to 2025-11-17, n=29 | AVGO +0.24, +1.01% (t +1.3) [+1.5/+1.1]; MSFT -0.18, -0.29% (t -0.9) [-0.6/-0.2]; GOOGL +0.17, +0.47% (t +0.9) [-0.7/+0.7]; META +0.14, +0.53% (t +0.8) [-0.7/+1.0]; NVDA +0.04, +0.14% (t +0.2) [-0.3/+0.3] |
| Kalshi: Claude best AI end of 2026 (`LLM1_CLAUDE_K`) | Kalshi, 3.0M contracts | 2026-01-05 to 2026-10-19, n=199 | TEAM -0.13, -2.09% (t -1.8) [-3.5/-0.6]; XLK -0.12, -0.68% (t -1.7) [-0.7/-0.7]; AMZN -0.10, -0.65% (t -1.3) [-1.4/-0.1]; ZM -0.09, -0.83% (t -1.2) [-1.1/-0.7]; INTU -0.09, -0.99% (t -1.2) [-1.0/-0.8]; SNOW -0.08, -1.10% (t -1.2) [-1.2/-0.8] |
| Kalshi: Gemini best AI end of 2026 (`LLM1_GEMINI_K`) | Kalshi, 2.7M contracts | 2026-01-05 to 2026-10-19, n=199 | META +0.07, +0.69% (t +1.0) [+1.5/+0.1]; AMZN +0.04, +0.30% (t +0.5) [+1.2/-0.2]; MSFT -0.03, -0.25% (t -0.4) [-0.4/-0.3]; NVDA -0.03, -0.27% (t -0.4) [-0.1/-0.3]; GOOGL +0.01, +0.06% (t +0.1) [+1.8/-1.0] |
| Anthropic IPO by __? :: December 31, 2026 (`ANTHROPIC_IPO_DEC31`) | Polymarket, $1.3M | 2026-06-03 to 2026-10-19, n=96 | WDAY +0.17, +1.71% (t +1.7) [+1.0/+3.2]; DDOG -0.14, -1.59% (t -1.4) [-1.4/-2.0]; TEAM +0.14, +1.90% (t +1.3) [+2.4/+0.8]; NVDA -0.12, -0.81% (t -1.2) [-1.4/+0.3]; CRWV -0.12, -2.01% (t -1.2) [-1.4/-3.3]; CTSH +0.09, +0.74% (t +0.8) [+0.7/+0.8] |
| OpenAI IPO by...? :: December 31, 2026 (`OPENAI_IPO_DEC31`) | Polymarket, $1.1M | 2025-10-31 to 2026-10-19, n=242 | MSFT -0.12, -0.53% (t -1.9) [-1.2/-0.4]; AVGO +0.12, +0.72% (t +1.8) [-0.8/+1.1]; AMD +0.10, +0.87% (t +1.5) [-1.5/+1.4]; ORCL +0.04, +0.33% (t +0.7) [-1.3/+0.7]; NVDA +0.03, +0.13% (t +0.4) [-1.6/+0.5]; CRWV -0.00, -0.02% (t -0.0) [-1.6/+0.3] |
| SpaceX IPO by ___ ? :: June 30 (`SPACEX_IPO_JUN30`) | Polymarket, $785k | 2026-01-27 to 2026-06-11, n=95 | LUNR +0.17, +2.12% (t +1.7) [+3.4/-0.1]; ASTS +0.16, +1.68% (t +1.6) [+2.4/+0.4]; FLY +0.12, +1.29% (t +1.1) [+1.1/+1.6]; RKLB +0.09, +0.90% (t +0.9) [+1.2/+0.4]; GOOGL -0.09, -0.26% (t -0.8) [-0.0/-0.6]; TSLA -0.06, -0.21% (t -0.5) [+0.2/-0.9] |
| Kalshi: Tesla Optimus released 2026 (`OPTIMUS_2026_K`) | Kalshi, 435k contracts | 2025-06-03 to 2026-10-19, n=345 | TSLA -0.05, -0.53% (t -0.9) [-0.2/-1.8] |
| Will Tesla launch a driverless Robotaxi service before July? :: Will Tesla launch a driver (`ROBOTAXI_JUL25`) | Polymarket, $11.9M | 2025-06-02 to 2025-07-03, n=23 | TSLA -0.17, -1.43% (t -0.8) [-1.4/-1.6]; GOOGL +0.03, +0.08% (t +0.1) [+0.5/-0.4] |
| Will Tesla launch a driverless Robotaxi service by October 31? :: Will Tesla launch a driv (`ROBOTAXI_OCT25`) | Polymarket, $6.6M | 2025-08-13 to 2025-09-10, n=20 | TSLA -0.05, -0.08% (t -0.2) [-0.6/-0.0] |
| Tesla and SpaceX merger officially announced by...? :: December 31, 2026 (`TSLA_SPACEX_MERGER_DEC26`) | Polymarket, $292k | 2026-05-15 to 2026-10-19, n=108 | RKLB -0.15, -1.24% (t -1.6) [-1.2/-3.1]; SPCX -0.04, -0.91% (t -0.3) [+1.6/-3.3]; ASTS -0.01, -0.11% (t -0.1) [-0.2/+2.2]; TSLA -0.01, -0.04% (t -0.1) [+0.0/-2.4] |
| Kalshi: Tesla-SpaceX merge before 2027 (`TSLA_SPACEX_MERGER_K`) | Kalshi, 101k contracts | 2026-06-15 to 2026-10-19, n=88 | SPCX -0.12, -2.00% (t -1.1) [-5.2/+1.0]; TSLA +0.03, +0.26% (t +0.3) [+0.4/-0.0] |
| Will GameStop acquire eBay? :: Will GameStop acquire eBay? (`GME_EBAY`) | Polymarket, $3.2M | 2026-05-05 to 2026-10-19, n=116 | GME +0.04, +0.74% (t +0.4) [+0.3/+4.0]; SPY +0.02, +0.13% (t +0.2) [+0.3/-0.9] |
| Kalshi: GameStop acquires eBay in 2026 (`GME_EBAY_K`) | Kalshi, 3.6M contracts | 2026-05-05 to 2026-10-19, n=116 | GME +0.00, +0.01% (t +0.0) [-0.1/+1.2] |
| Which companies will be acquired before 2027? :: Nebius Group (`NBIS_ACQUIRED`) | Polymarket, $8.0M | 2025-11-25 to 2026-10-19, n=225 | NBIS -0.07, -0.91% (t -1.1) [-0.6/-13.9]; NVDA +0.06, +0.25% (t +0.9) [+0.3/-2.1]; CRWV -0.04, -0.47% (t -0.6) [-0.1/-15.1] |
| Which companies will be acquired before 2027? :: Snapchat (`SNAP_ACQUIRED`) | Polymarket, $151k | 2025-11-25 to 2026-10-19, n=225 | SNAP +0.03, +0.37% (t +0.5) [+0.6/-1.4] |
| Which companies will be acquired before 2027? :: Zoom Video Communications (`ZM_ACQUIRED`) | Polymarket, $432k | 2025-11-25 to 2026-10-19, n=225 | ZM -0.12, -0.73% (t -1.8) [-0.7/-1.0] |
| Kalshi: US takes stake in IonQ 2026 (`US_STAKE_IONQ_K`) | Kalshi, 32k contracts | 2025-12-11 to 2026-10-19, n=199 | QUBT +0.25, +4.60% (t +3.6) [+4.4/+5.0]; QBTS +0.18, +3.90% (t +2.6) [+1.0/+9.7]; RGTI +0.17, +3.32% (t +2.4) [+0.8/+8.4]; IONQ +0.09, +1.69% (t +1.2) [+0.4/+4.2] |
| Kalshi: US takes stake in Micron 2026 (`US_STAKE_MU_K`) | Kalshi, 29k contracts | 2025-12-11 to 2026-10-19, n=190 | SNDK -0.07, -1.20% (t -0.9) [-4.0/-0.9]; WDC -0.05, -0.65% (t -0.7) [-0.8/-0.7]; MU -0.05, -0.62% (t -0.6) [-2.2/-0.4] |
| Kalshi: US takes stake in D-Wave 2026 (`US_STAKE_QBTS_K`) | Kalshi, 47k contracts | 2025-12-11 to 2026-09-09, n=157 | RGTI +0.36, +2.89% (t +4.8) [-5.3/+3.0]; QBTS +0.36, +3.07% (t +4.8) [-11.1/+3.2]; QUBT +0.27, +1.99% (t +3.5) [-6.5/+2.0]; IONQ +0.17, +1.27% (t +2.1) [-3.1/+1.3] |
| Kalshi: US takes stake in Rigetti 2026 (`US_STAKE_RGTI_K`) | Kalshi, 60k contracts | 2025-12-11 to 2026-09-09, n=172 | QBTS +0.37, +3.36% (t +5.1) [+5.5/+3.3]; RGTI +0.34, +2.98% (t +4.8) [+5.6/+2.9]; QUBT +0.26, +2.05% (t +3.5) [+7.7/+1.9]; IONQ +0.19, +1.54% (t +2.5) [+5.5/+1.4] |
| Kalshi: US licenses new reactor before 2027 (`REACTOR_LICENSE_K`) | Kalshi, 834k contracts | 2025-12-29 to 2026-10-19, n=203 | OKLO +0.19, +3.68% (t +2.7) [+4.4/-0.8]; SMR +0.17, +3.49% (t +2.4) [+4.1/-0.4]; NNE +0.10, +2.03% (t +1.5) [+2.4/-0.6]; CEG +0.03, +0.37% (t +0.5) [+0.2/+1.4]; VST -0.01, -0.11% (t -0.1) [-0.4/+1.8] |
| Hantavirus pandemic in 2026? :: Hantavirus pandemic in 2026? (`HANTAVIRUS_2026`) | Polymarket, $18.6M | 2026-05-05 to 2026-10-19, n=116 | JNJ -0.14, -4.88% (t -1.5) [-5.1/-2.2]; TEM -0.14, -17.15% (t -1.5) [-14.1/-53.2]; IBRX +0.13, +12.91% (t +1.4) [+13.5/+6.6]; CCL +0.08, +5.16% (t +0.9) [+4.5/+13.5]; LLY -0.04, -1.98% (t -0.5) [-1.5/-7.7]; HIMS -0.04, -5.04% (t -0.4) [-1.0/-55.0] |
| New pandemic in 2026? :: New pandemic in 2026? (`PANDEMIC_2026`) | Polymarket, $1.3M | 2025-12-03 to 2026-10-19, n=220 | IBRX +0.14, +11.05% (t +2.0) [+17.0/+3.2]; CCL +0.13, +5.14% (t +2.0) [+1.9/+9.0]; TEM -0.08, -4.86% (t -1.2) [-4.2/-5.2]; UNH -0.06, -1.85% (t -1.0) [-2.5/-1.2]; MRNA +0.06, +6.17% (t +0.9) [+8.8/+3.5]; JNJ +0.04, +0.61% (t +0.6) [+2.0/-1.0] |
| What will Gold (GC) hit__ by end of December? :: ↑ $6,000 (`GOLD_6000_DEC`) | Polymarket, $1.3M | 2026-02-02 to 2026-10-19, n=180 | GLD +0.33, +1.62% (t +4.7) [+1.4/+3.1]; SLV +0.14, +1.42% (t +1.9) [+1.1/+3.7]; BTC +0.07, +0.53% (t +1.1) [+0.1/+3.1]; SPY -0.03, -0.06% (t -0.4) [-0.2/+0.9] |
| Balance of Power: 2026 Midterms :: Democrats Sweep (`DEM_SWEEP_2026`) | Polymarket, $5.9M | 2025-07-21 to 2026-10-19, n=315 | CLOV -0.16, -6.16% (t -2.9) [-4.8/-8.1]; TEM +0.11, +4.26% (t +1.9) [+1.8/+7.7]; TSLA +0.09, +2.40% (t +1.7) [+2.7/+1.9]; BTC +0.08, +1.74% (t +1.6) [+3.0/+0.2]; JNJ -0.08, -0.84% (t -1.4) [-0.4/-1.5]; IBRX +0.06, +3.33% (t +1.1) [+1.8/+5.6] |
| Kalshi: Democrats win House 2026 (`HOUSE_DEM_2026_K`) | Kalshi, 20.3M contracts | 2024-11-07 to 2026-10-19, n=446 | DJT +0.15, +6.97% (t +3.2) [+8.9/+2.9]; CCL +0.09, +2.97% (t +2.0) [+3.1/+2.9]; COIN +0.08, +4.19% (t +1.8) [+4.7/+3.4]; BTC +0.07, +2.01% (t +1.8) [+2.0/+2.0]; LLY +0.08, +2.02% (t +1.7) [+2.2/+1.7]; SPY +0.07, +0.83% (t +1.6) [+1.1/+0.3] |
| Kalshi: Democrats win Senate 2026 (`SENATE_DEM_2026_K`) | Kalshi, 7.0M contracts | 2024-11-07 to 2026-10-19, n=419 | LLY -0.08, -2.16% (t -1.7) [-3.8/-1.2]; GLD -0.07, -1.13% (t -1.3) [-1.0/-1.1]; XOM -0.06, -1.06% (t -1.3) [-3.8/+0.3]; RUN +0.06, +3.87% (t +1.1) [+12.9/-0.5]; SPY -0.05, -0.59% (t -1.1) [-1.8/+0.1]; BTC +0.04, +1.16% (t +1.0) [+3.7/-0.1] |
| Presidential Election Winner 2024 :: Donald Trump (`ELECTION24_TRUMP`) | Polymarket, $1531.5M | 2024-01-08 to 2024-11-05, n=210 | DJT +0.27, +16.28% (t +4.1) [+19.8/+14.9]; LMT -0.18, -1.15% (t -2.6) [-0.8/-1.3]; COIN +0.17, +5.05% (t +2.5) [+4.2/+5.3]; FLNC -0.15, -3.94% (t -2.2) [+5.0/-7.1]; RUN -0.14, -4.41% (t -2.1) [+6.1/-8.2]; MRNA +0.14, +3.14% (t +2.0) [+4.5/+2.5] |
| House control after 2024 election? :: House control after 2024 election? (`HOUSE24`) | Polymarket, $8.0M | 2024-02-23 to 2024-11-21, n=190 | COIN -0.38, -5.42% (t -5.6) [-10.9/-5.3]; BTC -0.20, -1.83% (t -3.4) [-5.8/-1.7]; TSLA -0.24, -2.60% (t -3.4) [+2.7/-2.7]; ETH -0.20, -2.06% (t -3.4) [-5.7/-2.0]; GLD +0.23, +0.61% (t +3.3) [-1.3/+0.7]; SPY -0.22, -0.45% (t -3.0) [+0.5/-0.5] |
| Brazil Presidential Election :: Flávio Bolsonaro (`BRAZIL_FLAVIO`) | Polymarket, $23.3M | 2025-11-20 to 2026-10-02, n=217 | SPY +0.04, +0.16% (t +0.6) [+0.4/-0.0]; NU -0.03, -0.38% (t -0.5) [-1.3/+0.3] |
| Brazil Presidential Election :: Luiz Inácio Lula da Silva (`BRAZIL_LULA`) | Polymarket, $27.0M | 2025-09-22 to 2026-10-02, n=260 | SPY +0.04, +0.20% (t +0.7) [+0.3/+0.1]; NU +0.04, +0.52% (t +0.6) [+0.9/+0.1] |
| Which party wins South Korea presidential election? :: Democratic Party (`KOREA25_DEM`) | Polymarket, $1.7M | 2025-04-10 to 2025-06-03, n=37 | EWY +0.13, +0.99% (t +0.8) [+4.9/-0.3]; SPY +0.11, +0.89% (t +0.7) [+4.6/-0.5] |
| Netanyahu out by...? :: December 31 (`NETANYAHU_OUT_DEC31`) | Polymarket, $2.8M | 2025-07-28 to 2026-10-19, n=310 | SPY +0.10, +0.24% (t +1.7) [+0.3/+0.2]; TSEM +0.09, +1.29% (t +1.5) [+1.5/+1.2]; USO -0.02, -0.19% (t -0.4) [-0.5/+0.0]; LMT -0.02, -0.10% (t -0.3) [-0.7/+0.3] |
| TikTok banned in the US before May 2025? :: TikTok banned in the US before May 2025? (`TIKTOK_BAN_MAY25`) | Polymarket, $119.7M | 2024-09-19 to 2025-01-21, n=84 | META +0.13, +0.32% (t +1.1) [-0.8/+0.6]; RDDT +0.05, +0.43% (t +0.5) [-1.0/+1.0]; ORCL +0.03, +0.08% (t +0.2) [-1.2/+0.5]; SNAP +0.01, +0.07% (t +0.1) [-1.9/+0.7]; GOOGL +0.00, +0.01% (t +0.0) [-0.3/+0.1] |
| TikTok sale announced by...? :: December 31 (`TIKTOK_SALE_2025`) | Polymarket, $9.7M | 2025-04-22 to 2025-12-24, n=172 | ORCL +0.17, +0.81% (t +2.3) [+0.4/+1.0]; META +0.12, +0.30% (t +1.5) [+0.2/+0.4]; SNAP -0.01, -0.05% (t -0.2) [-1.4/+0.3] |
| Will Trump acquire Greenland in 2025? :: Will Trump acquire Greenland in 2025? (`GREENLAND_2025`) | Polymarket, $5.5M | 2025-01-08 to 2025-12-31, n=246 | SPY -0.08, -1.65% (t -1.2) [-1.9/-0.3]; GLD +0.05, +1.00% (t +0.7) [-0.2/+8.5]; USAR +0.00, +0.38% (t +0.0) [+6.8/-39.5] |


#### Intraday hourly check (stocks, regular session only)

| Market | Asset | n (hours) | r | β per 10pp | t | daily r for comparison |
|---|---|---|---|---|---|---|
| RECESSION_2025 | SPY | 1467 | -0.24 | -1.23% | -9.5 | -0.48 |
| RECESSION_2025 | QQQ | 1467 | -0.24 | -1.43% | -9.3 | -0.43 |
| RECESSION_2025 | IWM | 1467 | -0.22 | -1.46% | -8.8 | -0.40 |
| RECESSION_2025 | KRE | 1467 | -0.20 | -1.52% | -7.9 | -0.41 |
| FED_DEC26_HIKE | SHY | 343 | -0.36 | -0.11% | -7.2 | -0.47 |
| FED_HIKE_2026 | SHY | 1102 | -0.21 | -0.04% | -7.0 | -0.38 |
| FED_OCT26_HIKE | SHY | 511 | -0.29 | -0.04% | -6.9 | -0.28 |
| BTC_100K_2026 | MSTR | 1287 | +0.19 | +3.56% | +6.8 | +0.53 |
| RECESSION_2025 | TSLA | 1467 | -0.17 | -2.54% | -6.7 | – |
| BTC_55K_DOWN_2026 | MSTR | 1318 | -0.18 | -2.54% | -6.6 | -0.63 |
| US_CHINA_DEAL_NOV25 | EWT | 332 | +0.33 | +0.56% | +6.3 | +0.63 |
| BTC_100K_2026 | COIN | 1282 | +0.17 | +2.76% | +6.1 | +0.46 |
| FED_0CUTS_2026 | SHY | 1542 | -0.15 | -0.06% | -6.1 | -0.23 |
| US_INVADE_IRAN_2026 | SPY | 1426 | -0.16 | -0.47% | -6.0 | -0.33 |
| BTC_100K_2026 | GLXY | 1285 | +0.15 | +3.27% | +5.4 | +0.41 |
| GME_EBAY | GME | 699 | +0.20 | +3.48% | +5.4 | +0.04 |
| BTC_100K_2026 | CLSK | 1282 | +0.14 | +3.45% | +5.1 | +0.41 |
| US_INVADE_IRAN_2026 | USO | 1426 | +0.13 | +1.38% | +5.1 | +0.43 |
| IRAN_REGIME_FALL_2026 | USO | 1391 | +0.13 | +1.83% | +5.0 | +0.30 |
| BTC_55K_DOWN_2026 | COIN | 1313 | -0.14 | -1.63% | -4.9 | -0.55 |
| BTC_55K_DOWN_2026 | GLXY | 1316 | -0.13 | -2.13% | -4.9 | -0.49 |
| BTC_55K_DOWN_2026 | IREN | 1317 | -0.13 | -2.43% | -4.8 | -0.26 |
| CRUDE_ATH_DEC31 | UAL | 710 | -0.18 | -1.14% | -4.8 | -0.32 |
| HORMUZ_NORMAL_DEC31 | USO | 673 | -0.17 | -1.57% | -4.6 | -0.53 |
| US_INVADE_IRAN_2026 | CCL | 1426 | -0.12 | -1.09% | -4.5 | -0.34 |
| FED_HIKE_2026 | BND | 1102 | -0.13 | -0.08% | -4.5 | -0.34 |
| HOUSE_DEM_2026_K | KRE | 2367 | +0.09 | +1.66% | +4.4 | +0.11 |
| BTC_55K_DOWN_2026 | CRCL | 1312 | -0.12 | -1.85% | -4.3 | -0.45 |
| BTC_55K_DOWN_2026 | HOOD | 1319 | -0.12 | -1.35% | -4.3 | -0.46 |
| FED_DEC26_HIKE | BND | 343 | -0.22 | -0.20% | -4.1 | -0.43 |


#### Hourly check (crypto, 24/7)

| Market | Asset | n (hours) | r | β per 10pp | t |
|---|---|---|---|---|---|
| BTC_55K_DOWN_2026 | BTC | 7858 | -0.24 | -1.15% | -22.2 |
| ETH_1500_DOWN_2026 | ETH | 7702 | -0.23 | -1.52% | -20.9 |
| BTC_100K_2026 | BTC | 7638 | +0.22 | +1.46% | +20.0 |
| BTC_55K_DOWN_2026 | ETH | 7858 | -0.22 | -1.38% | -19.8 |
| BTC_100K_2026 | ETH | 7638 | +0.22 | +1.89% | +19.3 |
| BTC_100K_2026 | XRP | 7638 | +0.21 | +1.99% | +18.4 |
| BTC_55K_DOWN_2026 | SOL | 7858 | -0.20 | -1.40% | -18.2 |
| ETH_1500_DOWN_2026 | BTC | 7702 | -0.20 | -0.96% | -17.5 |
| BTC_100K_2026 | DOGE | 7638 | +0.20 | +1.99% | +17.4 |
| BTC_100K_2026 | SOL | 7638 | +0.19 | +1.89% | +17.4 |
| ETH_1500_DOWN_2026 | SOL | 7702 | -0.19 | -1.39% | -17.1 |
| BTC_55K_DOWN_2026 | DOGE | 7858 | -0.18 | -1.33% | -16.5 |
| BTC_55K_DOWN_2026 | XRP | 7858 | -0.18 | -1.23% | -16.0 |
| ETH_1500_DOWN_2026 | XRP | 7702 | -0.17 | -1.26% | -15.6 |
| ETH_1500_DOWN_2026 | DOGE | 7702 | -0.17 | -1.32% | -15.4 |
| IRAN26_PEACE_MAY31 | ETH | 1206 | +0.27 | +0.59% | +9.9 |
| IRAN26_PEACE_MAY31 | BTC | 1206 | +0.24 | +0.39% | +8.5 |
| ETH_ETF_MAY24 | ETH | 3241 | +0.14 | +0.64% | +8.2 |
| US_INVADE_IRAN_2026 | ETH | 8365 | -0.08 | -0.66% | -7.4 |
| IRAN26_CONFLICT_END_MAY15 | ETH | 1277 | +0.19 | +0.67% | +7.1 |


#### Event studies: the largest 24-hour probability jump in each resolved or live market

Return (simple %) is close-to-close on the US session that priced the jump (crypto: 24h window); z = log-return / normal daily sd (prior 60 sessions); implied full Δ = log-return / Δp. Only markets where some token moved with |z| ≥ 1.5 are shown. Some jumps are deadline expiries rather than news.

| Market | Date | p before → after | Biggest token moves: return % (z) [implied Δ per 100pp] |
|---|---|---|---|
| RU_UA_CEASEFIRE_JUN26 | 2026-05-09 | 6% → 100% | XOM +3.5% (z +1.8) [+4%]; RDW +9.8% (z +1.4) [+10%]; RCAT +8.5% (z +1.2) [+9%]; PR +2.2% (z +1.0) [+2%]; USO +3.8% (z +0.9) [+4%]; LMT +1.1% (z +0.7) [+1%] |
| IRAN26_STRIKE_BY_FEB28 | 2026-02-28 | 8% → 100% | SHY -0.4% (z -4.5) [-0%]; SGOV -0.3% (z -3.9) [-0%]; BND -0.7% (z -3.5) [-1%]; AVAV -17.4% (z -3.5) [-21%]; USO +6.4% (z +3.3) [+7%]; F -5.0% (z -3.2) [-6%] |
| TIKTOK_SALE_2025 | 2025-12-18 | 2% → 92% | ORCL +6.6% (z +2.0) [+7%]; META -0.9% (z -0.4) [-1%]; SNAP -0.8% (z -0.3) [-1%] |
| HEZBOLLAH_CEASEFIRE_APR30 | 2026-04-08 | 7% → 93% | USO -9.8% (z -2.9) [-12%]; SPY +2.5% (z +2.8) [+3%]; XOM -4.7% (z -2.7) [-6%]; PR -3.9% (z -2.1) [-5%]; TSEM +6.7% (z +1.3) [+8%]; GLD +0.6% (z +0.2) [+1%] |
| IRAN26_PEACE_JUN15 | 2026-06-14 | 10% → 95% | ETH +9.4% (z +3.4) [+11%]; BTC +4.4% (z +2.2) [+5%]; QQQ +3.1% (z +2.2) [+4%]; XOM -4.1% (z -2.2) [-5%]; XLK +3.8% (z +1.9) [+4%]; SPMO +3.5% (z +1.9) [+4%] |
| US_STAKE_QBTS_K | 2026-05-21 | 10% → 94% | RGTI +30.6% (z +5.2) [+32%]; QBTS +33.4% (z +4.9) [+34%]; QUBT +19.4% (z +3.2) [+21%]; IONQ +12.2% (z +1.8) [+14%] |
| CLARITY_ACT_K | 2026-02-08 | 84% → 7% | WULF +16.5% (z +2.3) [-20%]; IREN +10.3% (z +1.4) [-13%]; APLD +9.5% (z +1.1) [-12%]; FUTU +3.1% (z +1.1) [-4%]; GLXY +7.0% (z +1.0) [-9%]; CRCL +5.4% (z +1.0) [-7%] |
| US_STAKE_RGTI_K | 2026-05-21 | 18% → 94% | RGTI +30.6% (z +5.2) [+35%]; QBTS +33.4% (z +4.9) [+37%]; QUBT +19.4% (z +3.2) [+23%]; IONQ +12.2% (z +1.8) [+15%] |
| IRAN26_CEASEFIRE_APR30 | 2026-04-08 | 24% → 99% | SPMO +4.0% (z +3.2) [+5%]; CCL +11.2% (z +3.1) [+14%]; USO -9.8% (z -2.9) [-14%]; F +5.7% (z +2.9) [+7%]; SPY +2.5% (z +2.8) [+3%]; XOM -4.7% (z -2.7) [-6%] |
| FEDCHAIR_WARSH | 2026-01-30 | 28% → 99% | SLV -28.5% (z -10.1) [-47%]; GLD -10.3% (z -8.3) [-15%]; SCHD +1.5% (z +2.2) [+2%]; XLK -2.0% (z -1.6) [-3%]; ETH -3.9% (z -1.2) [-6%]; QQQ -1.2% (z -1.2) [-2%] |
| WTI_120_K | 2026-03-06 | 20% → 88% | USO +12.9% (z +5.7) [+18%]; BA +4.1% (z +2.6) [+6%]; SPY -1.3% (z -1.9) [-2%]; CCL -5.0% (z -1.6) [-8%]; QQQ -1.5% (z -1.6) [-2%]; UPS -1.6% (z -1.0) [-2%] |
| NBIS_ACQUIRED | 2025-12-13 | 30% → 94% | CRWV -7.9% (z -1.6) [-13%]; NBIS -7.5% (z -1.5) [-12%]; NVDA +0.7% (z +0.3) [+1%] |
| ETH_ETF_MAY24 | 2024-05-20 | 12% → 73% | ETH +19.3% (z +5.9) [+29%]; COIN +8.5% (z +1.5) [+13%]; MSTR +9.0% (z +1.0) [+14%]; BTC +2.2% (z +0.8) [+4%]; SOL -2.1% (z -0.5) [-3%] |
| IRAN26_PEACE_MAY31 | 2026-05-23 | 12% → 70% | RDW +26.0% (z +3.3) [+41%]; SPMO +3.4% (z +2.2) [+6%]; PR -4.0% (z -1.9) [-7%]; XOM -3.3% (z -1.8) [-6%]; XLK +2.6% (z +1.7) [+5%]; QQQ +1.8% (z +1.5) [+3%] |
| LLM1_GEMINI_K | 2026-01-01 | 2% → 58% | MSFT -2.2% (z -1.8) [-4%]; AMZN -1.9% (z -0.9) [-3%]; META -1.5% (z -0.7) [-3%]; NVDA +1.3% (z +0.5) [+2%]; GOOGL +0.7% (z +0.4) [+1%] |
| HOUSE24 | 2024-11-06 | 54% → 1% | COIN +31.1% (z +5.8) [-52%]; ETH +13.3% (z +5.0) [-24%]; GLD -3.0% (z -3.9) [+6%]; TSLA +14.8% (z +3.4) [-26%]; SPY +2.5% (z +3.2) [-5%]; BTC +6.0% (z +2.9) [-11%] |
| IRAN26_CONFLICT_END_MAY15 | 2026-04-07 | 32% → 84% | SPMO +4.0% (z +3.2) [+8%]; CCL +11.2% (z +3.1) [+21%]; USO -9.8% (z -2.9) [-20%]; F +5.7% (z +2.9) [+11%]; SPY +2.5% (z +2.8) [+5%]; XOM -4.7% (z -2.7) [-9%] |
| BTC_RESERVE_100D | 2025-03-07 | 20% → 67% | BTC -4.0% (z -1.5) [-8%]; XRP -7.6% (z -1.3) [-17%]; MSTR -5.6% (z -1.0) [-12%]; ETH -3.0% (z -0.7) [-6%]; COIN +1.5% (z +0.4) [+3%]; SOL -1.8% (z -0.3) [-4%] |
| SOL_ETF_JUL25 | 2025-06-10 | 16% → 62% | SOL +6.0% (z +1.8) [+12%]; ETH +5.0% (z +1.4) [+10%]; BTC +0.7% (z +0.4) [+1%]; COIN -0.7% (z -0.1) [-1%] |
| ROBOTAXI_JUL25 | 2025-06-19 | 60% → 14% | GOOGL -3.9% (z -1.6) [+9%]; TSLA +0.0% (z +0.0) [-0%] |
| OPENAI_IPO_DEC31 | 2026-05-20 | 28% → 73% | AMD +8.1% (z +1.7) [+17%]; ORCL +3.7% (z +1.1) [+8%]; AVGO +1.6% (z +0.6) [+4%]; NVDA +1.3% (z +0.5) [+3%]; MSFT +0.9% (z +0.5) [+2%]; CRWV +1.5% (z +0.2) [+3%] |
| IRAN26_STRIKE_BY_JAN31 | 2026-01-14 | 64% → 19% | XOM +2.9% (z +2.2) [-6%]; PR +3.2% (z +1.6) [-7%]; LMT +2.6% (z +1.5) [-6%]; RDW +8.7% (z +1.3) [-19%]; AVAV +4.9% (z +1.1) [-11%]; CCL -2.6% (z -0.9) [+6%] |
| SPACEX_IPO_JUN30 | 2026-01-28 | 24% → 67% | LUNR +12.4% (z +1.6) [+28%]; ASTS +8.9% (z +1.2) [+20%]; RDW -6.4% (z -0.8) [-16%]; RKLB +1.8% (z +0.3) [+4%]; GOOGL +0.4% (z +0.2) [+1%]; FLY -1.7% (z -0.2) [-4%] |
| MEXCAN_25PCT_TARIFF_JAN25 | 2025-01-22 | 51% → 10% | F -3.8% (z -1.9) [+10%]; XOM -1.7% (z -1.6) [+4%]; QQQ +1.3% (z +1.1) [-3%]; SPY +0.6% (z +0.7) [-1%]; TSLA -2.1% (z -0.4) [+5%]; COST -0.3% (z -0.3) [+1%] |
| ELECTION24_TRUMP | 2024-11-06 | 58% → 99% | TE +66.7% (z +11.4) [+127%]; RUN -29.6% (z -8.5) [-87%]; COIN +31.1% (z +5.8) [+67%]; GLD -3.0% (z -3.9) [-8%]; FLNC -13.2% (z -3.9) [-35%]; ETH +9.7% (z +3.7) [+23%] |
| US_CHINA_DEAL_NOV25 | 2025-10-10 | 92% → 54% | EWT -5.0% (z -5.4) [+13%]; QQQ -3.5% (z -5.1) [+9%]; SPY -2.7% (z -5.1) [+7%]; BTC -7.1% (z -5.0) [+19%]; SOXX -6.3% (z -4.7) [+17%]; QCOM -7.3% (z -4.6) [+20%] |
| CLARITY_ACT_2026 | 2026-01-13 | 76% → 38% | ETH +5.1% (z +1.7) [-14%]; MSTR +6.6% (z +1.6) [-17%]; BTC +3.2% (z +1.4) [-9%]; DOGE +5.1% (z +1.3) [-14%]; COIN +4.0% (z +1.0) [-11%]; GLXY +5.2% (z +0.9) [-14%] |
| US_INVADE_IRAN_2026 | 2026-04-07 | 60% → 24% | SPMO +4.0% (z +3.2) [-11%]; CCL +11.2% (z +3.1) [-30%]; USO -9.8% (z -2.9) [+29%]; F +5.7% (z +2.9) [-15%]; SPY +2.5% (z +2.8) [-7%]; XOM -4.7% (z -2.7) [+13%] |
| HORMUZ_NORMAL_K | 2026-04-09 | 93% → 59% | KTOS -8.2% (z -1.6) [+25%]; UPS +1.2% (z +0.7) [-3%]; SPY +0.6% (z +0.6) [-2%]; QQQ +0.7% (z +0.6) [-2%]; BA +1.0% (z +0.5) [-3%]; USO +1.9% (z +0.5) [-5%] |
| TIKTOK_BAN_MAY25 | 2024-12-06 | 20% → 52% | ORCL +2.9% (z +1.7) [+9%]; META +2.4% (z +1.5) [+7%]; RDDT +6.3% (z +1.0) [+19%]; GOOGL +1.2% (z +0.8) [+4%]; SNAP +2.2% (z +0.7) [+7%] |
| CODING_MODEL_ANTH_K | 2026-01-04 | 4% → 36% | SHOP +5.7% (z +1.9) [+17%]; ZM +3.9% (z +1.8) [+12%]; MDB +5.3% (z +1.5) [+16%]; AMZN +2.9% (z +1.4) [+9%]; SNOW +3.5% (z +1.3) [+11%]; PANW +1.5% (z +0.8) [+5%] |
| VENEZUELA_ENGAGE_DEC25 | 2025-10-23 | 31% → 62% | USO +3.8% (z +2.3) [+12%]; KTOS +6.0% (z +1.7) [+18%]; HII +2.3% (z +1.4) [+7%]; LHX +1.5% (z +1.2) [+5%]; PR +2.5% (z +1.1) [+8%]; XOM +1.1% (z +1.0) [+3%] |
| BTC_ETF_JAN24 | 2023-12-02 | 42% → 72% | MSTR +6.7% (z +1.8) [+21%]; COIN +5.5% (z +1.5) [+17%]; ETH +2.5% (z +1.2) [+8%]; BTC +2.0% (z +0.9) [+6%] |
| FED_HIKES_2026_K | 2026-06-10 | 45% → 75% | GLD -4.1% (z -2.4) [-14%]; SPY -1.6% (z -1.7) [-5%]; QQQ -2.0% (z -1.5) [-7%]; BTC +2.9% (z +1.4) [+10%]; SHY +0.0% (z +0.0) [+0%] |
| NETANYAHU_OUT_DEC31 | 2025-12-22 | 81% → 52% | LMT +2.0% (z +1.5) [-7%]; USO +2.5% (z +1.5) [-9%]; SPY +0.6% (z +0.8) [-2%]; TSEM -0.7% (z -0.2) [+2%] |
| LARGEST_CO_DEC26_NVDA | 2026-04-30 | 72% → 43% | GOOGL +10.0% (z +5.2) [-33%]; MSFT -3.9% (z -2.2) [+14%]; NVDA -4.6% (z -2.0) [+17%]; QQQ +0.9% (z +0.7) [-3%]; SMH +1.4% (z +0.6) [-5%]; AAPL +0.4% (z +0.3) [-2%] |
| GPT5_BY_AUG15 | 2025-08-04 | 62% → 90% | MSFT +2.2% (z +2.3) [+8%]; NVDA +3.6% (z +1.9) [+13%]; GOOGL +3.1% (z +1.7) [+11%]; ORCL +3.3% (z +1.3) [+12%] |
| BEST_AI_DEC26_ANTHROPIC | 2026-09-30 | 78% → 50% | CTSH +6.0% (z +2.0) [-21%]; ZM +3.3% (z +1.3) [-12%]; TEAM +5.9% (z +1.0) [-21%]; AVGO -2.1% (z -0.9) [+8%]; INTU +2.6% (z +0.9) [-9%]; CRM +3.1% (z +0.8) [-11%] |
| FED_HIKE_2026 | 2026-06-17 | 28% → 56% | CVNA -10.3% (z -3.1) [-39%]; SCHD -1.8% (z -2.9) [-7%]; BTC -4.8% (z -2.5) [-18%]; SHY -0.3% (z -2.5) [-1%]; UPS -4.4% (z -2.0) [-17%]; ETH -4.8% (z -1.8) [-18%] |
| BTC_55K_DOWN_2026 | 2025-11-25 | 30% → 57% | WULF +10.4% (z +1.8) [+36%]; MSTR -3.8% (z -1.0) [-14%]; SOFI +3.4% (z +0.8) [+12%]; CRCL -3.6% (z -0.6) [-13%]; GLXY +2.8% (z +0.5) [+10%]; FUTU -1.9% (z -0.5) [-7%] |
| HANTAVIRUS_2026 | 2026-05-06 | 5% → 33% | CCL +6.8% (z +1.8) [+24%]; SPY +1.4% (z +1.4) [+5%]; IBRX +10.6% (z +1.2) [+37%]; MRNA +4.5% (z +1.2) [+16%]; CLOV +2.7% (z +0.9) [+10%]; UNH +0.9% (z +0.4) [+3%] |
| BRAZIL_LULA | 2026-10-04 | 40% → 14% | NU +13.0% (z +4.3) [-46%]; SPY +0.7% (z +1.0) [-3%] |
| BRAZIL_FLAVIO | 2026-10-04 | 60% → 85% | NU +13.0% (z +4.3) [+49%]; SPY +0.7% (z +1.0) [+3%] |
| BTC_RESERVE_2025 | 2025-03-02 | 42% → 66% | BTC +4.9% (z +1.9) [+20%]; COIN -4.6% (z -1.1) [-19%]; ETH +3.6% (z +0.8) [+14%]; MSTR -1.8% (z -0.3) [-7%] |
| US_IRAN_BLOCKADE_END_DEC31 | 2026-07-27 | 64% → 88% | USO -8.7% (z -2.8) [-37%]; PR -5.2% (z -2.4) [-22%]; CCL +3.0% (z +1.0) [+12%]; BTC -2.1% (z -0.9) [-8%]; XOM -1.4% (z -0.8) [-6%]; UPS -1.6% (z -0.7) [-7%] |
| DC_MORATORIUM_IN | 2026-09-30 | 54% → 30% | CEG -4.0% (z -1.8) [+17%]; APLD -4.1% (z -0.7) [+17%]; BE -4.9% (z -0.7) [+21%]; VST -1.8% (z -0.7) [+7%]; VRT -2.8% (z -0.7) [+12%]; POWL -2.1% (z -0.6) [+9%] |
| RU_UA_CEASEFIRE_2025 | 2025-04-19 | 48% → 72% | GLD +3.1% (z +2.7) [+13%]; RCAT -9.2% (z -1.3) [-41%]; SPY -2.4% (z -1.2) [-10%]; LHX -1.9% (z -1.1) [-8%]; RDW -7.7% (z -1.0) [-34%]; KTOS -3.5% (z -1.0) [-15%] |
| FEDCHAIR_HASSETT | 2025-12-12 | 72% → 50% | SPMO -2.2% (z -2.3) [+10%]; XLK -2.9% (z -2.2) [+13%]; QQQ -1.9% (z -1.8) [+8%]; BND -0.3% (z -1.5) [+1%]; VTI -1.1% (z -1.4) [+5%]; SPY -1.1% (z -1.4) [+5%] |
| IRAN_REGIME_FALL_2026 | 2026-02-28 | 40% → 64% | AVAV -17.4% (z -3.5) [-83%]; USO +6.4% (z +3.3) [+27%]; RCAT +17.3% (z +2.2) [+70%]; LHX +3.8% (z +2.0) [+16%]; BTC +5.2% (z +1.8) [+22%]; PLTR +5.8% (z +1.7) [+25%] |
| LLM1_CLAUDE_K | 2026-09-30 | 74% → 51% | CTSH +6.0% (z +2.0) [-26%]; ZM +3.3% (z +1.3) [-14%]; TEAM +5.9% (z +1.0) [-25%]; INTU +2.6% (z +0.9) [-11%]; CRM +3.1% (z +0.8) [-13%]; PATH +3.7% (z +0.8) [-16%] |
| ETH_1500_DOWN_2026 | 2026-02-05 | 64% → 86% | MSTR -17.1% (z -4.5) [-85%]; COIN -13.3% (z -4.1) [-65%]; SOL -9.6% (z -3.4) [-46%]; GLXY -16.5% (z -3.1) [-82%]; BTC -5.2% (z -2.7) [-24%]; ETH -7.1% (z -2.5) [-33%] |
| BTC_100K_2026 | 2025-11-24 | 62% → 82% | WULF +10.4% (z +1.8) [+47%]; MSTR -3.8% (z -1.0) [-19%]; BTC -1.9% (z -0.8) [-9%]; SOFI +3.4% (z +0.8) [+16%]; CRCL -3.6% (z -0.6) [-18%]; GLXY +2.8% (z +0.5) [+13%] |
| CHINA_100PCT_TARIFF_NOV25 | 2025-10-12 | 32% → 12% | EWT +4.8% (z +4.1) [-23%]; AVGO +9.9% (z +3.7) [-47%]; TSM +7.9% (z +3.6) [-38%]; SMH +4.4% (z +2.9) [-22%]; SOXX +4.7% (z +2.8) [-23%]; QCOM +5.3% (z +2.7) [-26%] |
| KHARG_JUN30 | 2026-04-08 | 36% → 18% | USO -9.8% (z -2.9) [+54%]; SPY +2.5% (z +2.8) [-13%]; XOM -4.7% (z -2.7) [+25%]; PR -3.9% (z -2.1) [+21%]; PLTR -6.2% (z -1.9) [+34%]; AXON +5.0% (z +1.2) [-26%] |
| LARGEST_CO_DEC26_AAPL | 2026-10-14 | 15% → 34% | QQQ -2.0% (z -1.8) [-11%]; NVDA -3.2% (z -1.4) [-17%]; GOOGL -1.7% (z -0.9) [-9%]; MSFT -1.8% (z -0.8) [-10%]; AAPL +0.5% (z +0.3) [+3%] |
| ANTHROPIC_IPO_DEC31 | 2026-06-13 | 90% → 71% | AMZN +3.1% (z +1.6) [-17%]; NVDA +3.5% (z +1.4) [-19%]; GOOGL +2.7% (z +1.2) [-14%]; MSFT +2.3% (z +1.1) [-12%]; CTSH -2.6% (z -1.1) [+14%]; CRWV +6.1% (z +1.1) [-32%] |
| PANDEMIC_2026 | 2025-12-10 | 10% → 28% | JNJ +3.3% (z +3.7) [+18%]; CCL +3.0% (z +1.2) [+16%]; HIMS -4.9% (z -1.0) [-27%]; PFE +1.8% (z +1.0) [+10%]; IBRX +3.6% (z +0.9) [+19%]; UNH +1.5% (z +0.9) [+8%] |
| RECESSION_2025 | 2025-04-12 | 62% → 46% | SHY +0.2% (z +1.8) [-1%]; BND +0.6% (z +1.6) [-3%]; F +4.1% (z +1.5) [-23%]; COST +1.7% (z +0.8) [-10%]; SCHD +1.2% (z +0.8) [-7%]; UPS +1.6% (z +0.6) [-10%] |
| FED_DEC26_HIKE | 2026-09-10 | 44% → 60% | BND -0.6% (z -2.6) [-4%]; SHY -0.3% (z -2.2) [-1%]; SLV -5.3% (z -2.1) [-32%]; ETH +4.8% (z +1.9) [+28%]; F +3.2% (z +1.6) [+19%]; GLD -1.7% (z -1.1) [-10%] |
| RECESSION_2026 | 2026-09-15 | 10% → 26% | UPS -3.5% (z -2.0) [-22%]; SCHD -1.4% (z -2.0) [-9%]; SHY -0.1% (z -0.8) [-1%]; COST -0.8% (z -0.7) [-5%]; SPY -0.4% (z -0.6) [-3%]; VTI -0.4% (z -0.6) [-3%] |
| FED_0CUTS_2026 | 2026-04-29 | 43% → 58% | SOFI -15.4% (z -5.4) [-108%]; BND -0.4% (z -1.6) [-3%]; UPS +2.6% (z +1.4) [+16%]; COIN -6.4% (z -1.2) [-42%]; NU -3.2% (z -1.2) [-21%]; RUN -8.0% (z -1.2) [-54%] |
| ISR_IRAN_CEASEFIRE_OCT31 | 2026-08-30 | 84% → 68% | XOM +2.7% (z +1.7) [-17%]; AXON -5.7% (z -1.3) [+38%]; PR +2.6% (z +1.1) [-17%]; USO +3.1% (z +0.9) [-20%]; LHX +1.3% (z +0.6) [-8%]; KTOS -2.0% (z -0.5) [+13%] |
| HORMUZ_NORMAL_DEC31 | 2026-07-06 | 74% → 58% | BA +3.6% (z +1.5) [-23%]; AVAV -7.4% (z -1.4) [+51%]; F +3.5% (z +1.1) [-23%]; SPY +0.9% (z +1.0) [-6%]; AXON +4.2% (z +1.0) [-28%]; QQQ +1.4% (z +0.9) [-9%] |


#### Fixed-date event studies

Simple % return on the session; z = log-return / prior-60-session daily sd.

| Event | Date (session) | Token moves: return % (z) |
|---|---|---|
| ELECTION_2024 | 2024-11-06 | RUN -29.6% (z -8.5); KRE +13.4% (z +8.0); XLF +6.1% (z +7.4); COIN +31.1% (z +5.8); HOOD +19.6% (z +5.0); IWM +5.8% (z +4.8); UUP +1.6% (z +4.5); GLD -3.0% (z -3.9); FLNC -13.2% (z -3.9) |
| DEEPSEEK_R1 | 2025-01-27 | CLS -28.2% (z -11.3); PWR -18.3% (z -10.8); ANET -22.4% (z -10.4); VRT -29.9% (z -10.1); VST -28.3% (z -9.0); GEV -21.5% (z -8.4); LITE -22.5% (z -7.6); NVDA -17.0% (z -7.4); ORCL -13.8% (z -6.4) |
| LIBERATION_DAY | 2025-04-03 | RH -40.1% (z -13.9); NKE -14.4% (z -7.5); DELL -19.0% (z -6.8); HPE -15.1% (z -5.7); KSS -22.8% (z -5.5); AAPL -9.2% (z -5.4); AMZN -9.0% (z -5.2); JBL -11.0% (z -5.0); SPY -4.9% (z -4.9) |
| CHINA_RETALIATION | 2025-04-04 | SPY -5.9% (z -5.0); XOM -7.2% (z -4.7); QQQ -6.2% (z -4.1); FUTU -14.3% (z -3.5); AAPL -7.3% (z -3.5); USO -6.0% (z -3.5); BABA -9.9% (z -3.0); SMH -7.6% (z -2.9); TSLA -10.4% (z -2.5) |
| TARIFF_PAUSE | 2025-04-09 | SPY +10.5% (z +7.1); QQQ +12.0% (z +6.5); SOXX +18.6% (z +6.1); AAPL +15.3% (z +5.8); SMH +17.2% (z +5.5); EWY +8.9% (z +5.3); AMZN +12.0% (z +5.1); EWT +9.4% (z +5.0); TSLA +22.7% (z +4.4) |
| GENEVA_DEAL | 2025-05-12 | AMZN +8.1% (z +2.7); LULU +8.7% (z +2.4); NKE +7.3% (z +2.1); GLD -2.8% (z -2.0); AAPL +6.2% (z +1.9); SMH +6.3% (z +1.7); QQQ +4.1% (z +1.7); FUTU +8.2% (z +1.6); SPY +3.3% (z +1.6) |
| CHINA_100PCT_THREAT | 2025-10-10 | BTC -7.7% (z -5.6); QQQ -3.5% (z -5.1); SPY -2.7% (z -5.1); SOL -17.5% (z -5.0); SOXX -6.3% (z -4.7); SMH -5.8% (z -4.6); ETH -12.0% (z -4.5); FUTU -11.1% (z -3.7); BABA -8.4% (z -3.0) |
| SCOTUS_IEEPA | 2026-02-20 | AMZN +2.6% (z +1.4); AAPL +1.5% (z +1.1); F +1.7% (z +1.1); SPY +0.7% (z +1.0); ELF +3.2% (z +0.9); QQQ +0.9% (z +0.9); LULU +2.4% (z +0.9); GLD +2.0% (z +0.8); KSS -2.5% (z -0.4) |
| ISRAEL_STRIKES_IRAN_25 | 2025-06-13 | USO +6.9% (z +2.8); LMT +3.7% (z +2.0); LHX +2.6% (z +1.7); NOC +3.9% (z +1.7); CCL -4.9% (z -1.3); XOM +2.2% (z +1.1); UAL -4.4% (z -0.9); DAL -3.8% (z -0.9); GLD +1.3% (z +0.8) |
| IRAN_CEASEFIRE_25 | 2025-06-24 | KTOS -6.6% (z -2.3); CCL +6.9% (z +1.6); USO -4.5% (z -1.6); XOM -3.0% (z -1.5); LMT -2.6% (z -1.5); NOC -3.1% (z -1.3); LHX -1.8% (z -1.1); GLD -1.6% (z -1.0); CVX -2.3% (z -1.0) |
| IRAN_WAR_26_START | 2026-03-02 | SHY -0.4% (z -4.5); AVAV -17.4% (z -3.5); USO +6.4% (z +3.3); NOC +6.0% (z +3.0); CCL -7.6% (z -2.7); TLT -1.3% (z -2.4); RCAT +17.3% (z +2.2); LHX +3.8% (z +2.0); LMT +2.8% (z +1.5) |
| IRAN_CEASEFIRE_26 | 2026-04-08 | CVX -4.3% (z -3.2); CCL +11.2% (z +3.1); USO -9.8% (z -2.9); SPY +2.5% (z +2.8); XOM -4.7% (z -2.7); XLE -3.5% (z -2.7); QQQ +3.0% (z +2.5); UAL +7.9% (z +2.2); PR -3.9% (z -2.1) |
| RU_UA_CEASEFIRE_26 | 2026-05-11 | XOM +3.5% (z +1.8); RCAT +8.5% (z +1.2); USO +3.8% (z +0.9); LMT +1.1% (z +0.7); EWZ -1.2% (z -0.6); LHX +0.9% (z +0.5); KTOS -1.6% (z -0.3); BTC -0.7% (z -0.3); SPY +0.2% (z +0.2) |
| MADURO_CAPTURE | 2026-01-05 | CVX +5.1% (z +4.4); LMT +2.9% (z +2.2); PR -4.0% (z -2.1); XOM +2.2% (z +2.0); GLD +2.6% (z +1.6); USO +1.8% (z +1.1); SPY +0.7% (z +0.8) |
| WARSH_NOMINATION | 2026-01-30 | SLV -28.5% (z -10.1); GLD -10.3% (z -8.3); UUP +1.0% (z +1.7); ETH -3.7% (z -1.3); QQQ -1.2% (z -1.2); MSTR +4.6% (z +1.1); TLT -0.6% (z -1.1); SHY +0.1% (z +0.9); SPY -0.3% (z -0.4) |
| FED_HIKE_SEP26 | 2026-09-16 | KRE -1.8% (z -1.7); SHY -0.1% (z -0.8); BTC +1.4% (z +0.7); SPY -0.4% (z -0.6); RIVN -2.0% (z -0.4); SOFI -1.3% (z -0.4); GLD -0.6% (z -0.4); TLT +0.2% (z +0.3); SLV -0.8% (z -0.3) |
| SPACEX_IPO | 2026-06-12 | FLY -19.1% (z -2.7); ASTS -15.5% (z -2.3); LUNR -13.1% (z -1.7); RKLB -10.8% (z -1.6); RDW -11.5% (z -1.4); PL -8.8% (z -1.2); TSLA +1.8% (z +0.6); GOOGL +0.5% (z +0.2) |
| MSTR_SELLS_BTC | 2026-06-01 | BTC -4.0% (z -2.2); MSTR -5.9% (z -1.4); COIN -3.4% (z -0.8); ETH +0.2% (z +0.1) |
| BTC_ETF_APPROVAL | 2024-01-11 | COIN -6.7% (z -1.7); BTC -3.3% (z -1.5); MSTR -5.2% (z -1.3); HOOD -3.5% (z -1.0); ETH +1.4% (z +0.5) |
| ETH_ETF_ODDS_JUMP | 2024-05-20 | ETH +21.8% (z +6.6); BTC +5.2% (z +1.9); COIN +8.5% (z +1.5); MSTR +9.0% (z +1.0); SOL +1.0% (z +0.2) |
| SBR_EO_SIGNED | 2025-03-07 | XRP -6.6% (z -1.1); MSTR -5.6% (z -1.0); BTC -3.2% (z -1.0); SOL -4.5% (z -0.7); COIN +1.5% (z +0.4); ETH +0.1% (z +0.0) |
| GENIUS_SENATE | 2025-06-18 | COIN +16.3% (z +3.0); SOFI +6.4% (z +1.4); HOOD +4.5% (z +0.9); GLXY +3.0% (z +0.5); BTC -0.1% (z -0.1); ETH +0.3% (z +0.1) |
| GEMINI3 | 2025-11-18 | MSFT -2.7% (z -2.6); AMZN -4.4% (z -2.1); NVDA -2.8% (z -1.2); META -0.7% (z -0.4); AVGO -0.6% (z -0.2); GOOGL -0.3% (z -0.1) |
| GPT5 | 2025-08-07 | ORCL -2.7% (z -1.1); MSFT -0.8% (z -0.8); META -1.3% (z -0.6); NVDA +0.8% (z +0.4); GOOGL +0.2% (z +0.1) |
| KOREA_MARTIAL_LAW | 2024-12-03 | EWY -1.6% (z -1.0); SPY +0.0% (z +0.1) |
| KOREA_ELECTION_25 | 2025-06-04 | EWY +3.4% (z +1.7); SPY -0.0% (z -0.0) |
| INDIA_PAK_STRIKES | 2025-05-07 | GLD -1.5% (z -1.1); INDA -0.9% (z -0.7); SPY +0.4% (z +0.2) |
| INDIA_50PCT_TARIFF | 2025-08-27 | SPY +0.2% (z +0.4); INDA +0.2% (z +0.4) |
| US_STAKE_INTEL | 2025-08-22 | GFS +5.8% (z +2.3); INTC +5.5% (z +1.6); SMH +2.1% (z +1.6); AMD +2.5% (z +0.8) |

Tesla delivery-report sessions (12): mean |TSLA move| 5.03%, mean normal daily sd 3.49%; individual: 2024-01-02 -0.0%, 2024-04-02 -5.0%, 2024-07-02 +9.7%, 2024-10-02 -3.6%, 2025-01-02 -6.3%, 2025-04-02 +5.2%, 2025-07-02 +4.8%, 2025-10-02 -5.2%, 2026-01-02 -2.6%, 2026-04-02 -5.6%, 2026-07-02 -7.8%, 2026-10-02 +4.5%



#### Scheduled macro releases: Kalshi-implied surprise vs release-day move

| Release (Kalshi series) | Asset | n | β | t | r | mean abs move on release days | mean abs move all days (last 500) |
|---|---|---|---|---|---|---|---|
| KXCPI | SPY | 35 | -0.06% per +0.1pp CPI m/m surprise | -0.3 | -0.05 | 0.84% | 0.68% |
| KXCPI | QQQ | 35 | -0.10% per +0.1pp CPI m/m surprise | -0.4 | -0.06 | 1.14% | 0.96% |
| KXCPI | IWM | 35 | -0.87% per +0.1pp CPI m/m surprise | -2.4 | -0.38 | 1.45% | 0.98% |
| KXCPI | SHY | 35 | -0.09% per +0.1pp CPI m/m surprise | -3.5 | -0.52 | 0.11% | 0.08% |
| KXCPI | TLT | 35 | -0.36% per +0.1pp CPI m/m surprise | -1.7 | -0.28 | 0.89% | 0.57% |
| KXCPI | BND | 35 | -0.22% per +0.1pp CPI m/m surprise | -2.4 | -0.39 | 0.36% | 0.22% |
| KXCPI | GLD | 35 | -0.62% per +0.1pp CPI m/m surprise | -2.8 | -0.43 | 0.90% | 1.11% |
| KXCPI | SLV | 35 | -0.87% per +0.1pp CPI m/m surprise | -2.3 | -0.37 | 1.67% | 2.05% |
| KXCPI | KRE | 35 | -1.03% per +0.1pp CPI m/m surprise | -2.2 | -0.36 | 1.73% | 1.12% |
| KXCPI | SOFI | 35 | -0.94% per +0.1pp CPI m/m surprise | -1.2 | -0.20 | 3.14% | 2.87% |
| KXCPI | COIN | 35 | -0.94% per +0.1pp CPI m/m surprise | -0.8 | -0.14 | 3.92% | 3.55% |
| KXCPI | NVDA | 35 | -0.09% per +0.1pp CPI m/m surprise | -0.1 | -0.02 | 2.73% | 2.01% |
| KXCPI | BTC | 35 | +0.29% per +0.1pp CPI m/m surprise | +0.8 | +0.14 | 1.48% | 1.58% |
| KXCPICORE | SPY | 32 | +0.10% per +0.1pp core CPI m/m surprise | +0.3 | +0.05 | 0.84% | 0.68% |
| KXCPICORE | QQQ | 32 | +0.12% per +0.1pp core CPI m/m surprise | +0.3 | +0.05 | 1.13% | 0.96% |
| KXCPICORE | IWM | 32 | -1.10% per +0.1pp core CPI m/m surprise | -2.1 | -0.36 | 1.50% | 0.98% |
| KXCPICORE | SHY | 32 | -0.11% per +0.1pp core CPI m/m surprise | -3.0 | -0.48 | 0.12% | 0.08% |
| KXCPICORE | TLT | 32 | -0.46% per +0.1pp core CPI m/m surprise | -1.5 | -0.27 | 0.94% | 0.57% |
| KXCPICORE | BND | 32 | -0.26% per +0.1pp core CPI m/m surprise | -2.1 | -0.35 | 0.38% | 0.22% |
| KXCPICORE | GLD | 32 | -0.73% per +0.1pp core CPI m/m surprise | -2.4 | -0.40 | 0.87% | 1.11% |
| KXCPICORE | SLV | 32 | -1.00% per +0.1pp core CPI m/m surprise | -2.2 | -0.38 | 1.54% | 2.05% |
| KXCPICORE | KRE | 32 | -1.43% per +0.1pp core CPI m/m surprise | -2.2 | -0.37 | 1.86% | 1.12% |
| KXCPICORE | SOFI | 32 | -1.61% per +0.1pp core CPI m/m surprise | -1.5 | -0.26 | 3.12% | 2.87% |
| KXCPICORE | COIN | 32 | -1.36% per +0.1pp core CPI m/m surprise | -0.8 | -0.15 | 4.00% | 3.55% |
| KXCPICORE | NVDA | 32 | +0.95% per +0.1pp core CPI m/m surprise | +1.1 | +0.20 | 2.76% | 2.01% |
| KXCPICORE | BTC | 32 | +0.61% per +0.1pp core CPI m/m surprise | +1.3 | +0.23 | 1.55% | 1.58% |
| KXFEDDECISION | SPY | 24 | +1.48% per +25bp policy surprise | +0.9 | +0.19 | 0.81% | 0.68% |
| KXFEDDECISION | QQQ | 24 | +2.53% per +25bp policy surprise | +1.2 | +0.25 | 1.05% | 0.96% |
| KXFEDDECISION | IWM | 24 | +1.28% per +25bp policy surprise | +0.5 | +0.11 | 1.12% | 0.98% |
| KXFEDDECISION | SHY | 24 | +0.05% per +25bp policy surprise | +0.2 | +0.04 | 0.15% | 0.08% |
| KXFEDDECISION | TLT | 24 | +3.22% per +25bp policy surprise | +2.4 | +0.45 | 0.77% | 0.57% |
| KXFEDDECISION | BND | 24 | +0.84% per +25bp policy surprise | +1.2 | +0.25 | 0.37% | 0.22% |
| KXFEDDECISION | GLD | 24 | +0.46% per +25bp policy surprise | +0.2 | +0.04 | 1.20% | 1.11% |
| KXFEDDECISION | SLV | 24 | +2.56% per +25bp policy surprise | +0.7 | +0.14 | 2.09% | 2.05% |
| KXFEDDECISION | KRE | 24 | -0.39% per +25bp policy surprise | -0.1 | -0.02 | 2.04% | 1.12% |
| KXFEDDECISION | SOFI | 24 | +5.70% per +25bp policy surprise | +0.6 | +0.14 | 4.00% | 2.87% |
| KXFEDDECISION | COIN | 24 | +4.52% per +25bp policy surprise | +0.5 | +0.11 | 3.87% | 3.55% |
| KXFEDDECISION | NVDA | 24 | +6.79% per +25bp policy surprise | +1.3 | +0.28 | 2.54% | 2.01% |
| KXFEDDECISION | BTC | 24 | +0.58% per +25bp policy surprise | +0.2 | +0.04 | 1.32% | 1.58% |
| KXPAYROLLS | SPY | 22 | -0.07% per +100k payrolls surprise | -0.1 | -0.03 | 1.06% | 0.68% |
| KXPAYROLLS | QQQ | 22 | -0.02% per +100k payrolls surprise | -0.0 | -0.01 | 1.39% | 0.96% |
| KXPAYROLLS | IWM | 22 | -0.33% per +100k payrolls surprise | -0.7 | -0.15 | 1.26% | 0.98% |
| KXPAYROLLS | SHY | 22 | -0.15% per +100k payrolls surprise | -2.7 | -0.51 | 0.18% | 0.08% |
| KXPAYROLLS | TLT | 22 | -0.69% per +100k payrolls surprise | -2.2 | -0.44 | 0.98% | 0.57% |
| KXPAYROLLS | BND | 22 | -0.36% per +100k payrolls surprise | -2.9 | -0.54 | 0.43% | 0.22% |
| KXPAYROLLS | GLD | 22 | -0.46% per +100k payrolls surprise | -1.3 | -0.28 | 0.86% | 1.11% |
| KXPAYROLLS | SLV | 22 | -0.70% per +100k payrolls surprise | -1.0 | -0.21 | 1.85% | 2.05% |
| KXPAYROLLS | KRE | 22 | -0.08% per +100k payrolls surprise | -0.1 | -0.03 | 1.32% | 1.12% |
| KXPAYROLLS | SOFI | 22 | +1.06% per +100k payrolls surprise | +1.0 | +0.22 | 2.86% | 2.87% |
| KXPAYROLLS | COIN | 22 | -0.77% per +100k payrolls surprise | -0.6 | -0.14 | 3.57% | 3.55% |
| KXPAYROLLS | NVDA | 22 | -0.01% per +100k payrolls surprise | -0.0 | -0.00 | 2.67% | 2.01% |
| KXPAYROLLS | BTC | 22 | +0.75% per +100k payrolls surprise | +1.6 | +0.33 | 1.34% | 1.58% |


#### Price-level markets: analytic Δ for correlated tokens (at-the-money strike, k = 0)

| Market type | Driver sd to expiry | Δ on driver | Largest token Δ (%) |
|---|---|---|---|
| BTC above K on Oct 31 (9 US sessions; sd per session incl. weekends) | 8.4% | 13.5% | MSTR +21, XRP +19, GLXY +19, SOL +19, CRCL +18, CLSK +18, ETH +17, DOGE +17, COIN +17 |
| BTC above K on Dec 31 (50 US sessions) | 19.9% | 31.7% | MSTR +49, XRP +45, GLXY +44, SOL +44, CRCL +43, CLSK +41, ETH +41, DOGE +41, COIN +40 |
| WTI above K end of Oct (9 sessions) | 9.3% | 14.9% | CCL -9, PR +6, XOM +5, BA -3, UPS -2, SPY -2 |
| WTI above K on Dec 31 (50 sessions) | 22.0% | 35.1% | CCL -20, PR +14, XOM +12, BA -8, UPS -5, SPY -4 |
| Gold above K on Dec 31 (50 sessions) | 13.1% | 21.0% | SLV +40, BTC +9, SPY +3, SHY +0 |
| S&P 500 above K on Dec 31 (50 sessions) | 5.7% | 9.0% | DJT +20, XLK +16, BTC +16, SPMO +14, QQQ +13, VTI +9, GLD +7, XOM -6 |
| Semis (SMH) above K on Dec 31 (hypothetical: no such market listed) | 17.7% | 28.3% | SKHY +55, SNDK +54, MU +46, LRCX +41, MRVL +41, INTC +40, WDC +39, AMD +39, KLAC +37, AMAT +36 |
| Nasdaq-100 above K on Dec 31 | 8.8% | 14.1% | CRWV +36, AVGO +22, ORCL +21, TSLA +21, NVDA +18, PLTR +18, AMZN +12, META +12, GOOGL +11, MSFT +8 |
| ETH above K on Dec 31 (50 sessions) | 27.9% | 44.5% | MSTR +45, SOL +44, GLXY +43, CRCL +42, COIN +38 |



## 7. Caveats

- **Correlation is not the causal Δ.**
  - The β per 100pp equals the YES-vs-NO spread only if the probability is the sole shared driver.
  - Fed odds and SPY both react to CPI and oil prints.
  - Iran odds and oil both react to the same headlines. That is the event itself, but oil also has non-Iran supply news.
  - Treat the Fed-path βs as upper bounds. The Iran/oil βs are closer to causal, because the 2026 oil shock is overwhelmingly Iran-driven.
- **Linear extrapolation.** Most markets traded in a narrow range (for example Hormuz 5–35%). Scaling β to a 0→100pp swing assumes linearity outside the observed range. Jump-day checks (section 6) agree on sign and rough size where available.
- **Prediction-market noise and lag.**
  - Polymarket prints carry bid-ask bounce, which biases β towards zero (errors-in-variables).
  - Prediction markets also react to news with a lag of up to about two hours. Hourly correlations are therefore much weaker than daily ones.
  - Daily US-close sampling is the main measure.
- **Short samples.** Many 2026 markets have n = 20–60 sessions (Fed December, ceasefire through Oct 31, Iran peace deadlines). Their t-statistics are reported but should be read as indicative.
- **Regime dependence.** 2026 is an oil-shock, hiking-Fed regime: stocks and bonds correlated positively, gold fell with hawkish odds, and defense fell during a war. Signs measured now may flip in a different regime. An example is the recession-vs-GLD sign.
- **Mechanical pairs.** Price ladders and "largest company" correlate with their own underlying by construction. They are reported because they give large, well-defined Δ, not as evidence of information content.
- **Volume units.** Polymarket volume is lifetime USD notional. Kalshi `volume_fp` is lifetime contracts ($1 notional each). Both overstate open interest.
- **Data gaps:**
  - The Yahoo `query1` endpoint was rate-limited, so daily stock data is Nasdaq closes, which are not dividend-adjusted (negligible for daily returns).
  - SATS (EchoStar) had no Nasdaq history.
  - Some Kalshi historical candles returned HTTP 429 and were retried.
  - The October 2025 CPI and jobs reports were never published (shutdown).
- **Literature numbers** were gathered without a web-search engine (budget exhausted). They come from primary sources and the literature agent's own calculations from Yahoo, Treasury, SEC and Polymarket data. They are labelled where unverified.

## 8. Sources

**Data APIs** (all accessed 2026-10-20):
- Polymarket Gamma events: https://gamma-api.polymarket.com/events (active, closed, by tag and by slug) and https://gamma-api.polymarket.com/public-search
- Polymarket CLOB price history: https://clob.polymarket.com/prices-history (fidelity=60, 14-day `startTs`/`endTs` windows)
- Kalshi Trade API v2: https://api.elections.kalshi.com/trade-api/v2
  - events, markets, `/series/{s}/markets/{t}/candlesticks`
  - `/historical/markets` and `/historical/markets/{t}/candlesticks` for settled markets
- Nasdaq historical quotes (daily, split-adjusted): https://api.nasdaq.com/api/quote/{SYM}/historical
- Yahoo Finance 60-minute bars: https://query2.finance.yahoo.com/v8/finance/chart/{SYM}?range=730d&interval=60m
- Binance klines (1h, 1d): https://api.binance.com/api/v3/klines
- Token list: `robinhood_stock_tokens_2026-10-20.csv` (this folder)

**Literature and reference:**
- Snowberg, E., Wolfers, J., Zitzewitz, E. "Partisan Impacts on the Economy: Evidence from Prediction Markets and Close Elections." QJE 2007. https://www.nber.org/papers/w12073. 2004 election night: S&P futures +1.5–2.1% for a Kerry→Bush 0→100% swing.
- Snowberg, Wolfers, Zitzewitz. "How Prediction Markets Can Save Event Studies." NBER w16949, 2011. https://www.nber.org/papers/w16949. The method used here to scale moves by Δprobability.
- Wolfers, J., Zitzewitz, E. "Prediction Markets." JEP 2004. https://www.aeaweb.org/articles?id=10.1257/0895330041371321
- Wolfers, Zitzewitz. "Interpreting Prediction Market Prices as Probabilities." NBER w12200, 2006. https://www.nber.org/papers/w12200
- Diercks, A., Katz, J., Wright, J. "Kalshi and the Rise of Macro Markets." FEDS 2026-010, Feb 2026. https://www.federalreserve.gov/econres/feds/kalshi-and-the-rise-of-macro-markets.htm. Kalshi FOMC-day mode has matched the realized rate since 2022; CPI MAE 0.063pp vs Bloomberg 0.081pp.
- Bernanke, B., Kuttner, K. "What Explains the Stock Market's Reaction to Federal Reserve Policy?" NBER w10402. https://www.nber.org/papers/w10402. About +1% equities per unanticipated 25bp cut.
- Lucca, D., Moench, E. "The Pre-FOMC Announcement Drift." NY Fed Staff Report 512. https://www.newyorkfed.org/research/staff_reports/sr512.html
- Sethi, R. et al. "Models, Markets, and the Forecasting of Elections." https://arxiv.org/abs/2102.04936
- Polymarket accuracy page: https://polymarket.com/accuracy

**Event context:**
- FOMC statements: https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm (Sep 16, 2026 hike); calendar: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
- Kevin Warsh: https://en.wikipedia.org/wiki/Kevin_Warsh
- Economic impact of the 2026 Iran war: https://en.wikipedia.org/wiki/Economic_impact_of_the_2026_Iran_war. Chronology after April is partly unverified.
- Learning Resources v. Trump (IEEPA tariffs): https://en.wikipedia.org/wiki/Learning_Resources_v._Trump
- 2025 stock market crash: https://en.wikipedia.org/wiki/2025_stock_market_crash
- GENIUS Act: https://en.wikipedia.org/wiki/GENIUS_Act
- 2026 shutdowns: https://en.wikipedia.org/wiki/2026_United_States_federal_government_shutdowns
- Trump's 2026 visit to China: https://en.wikipedia.org/wiki/2026_state_visit_by_Donald_Trump_to_China
- BLS release schedules: https://www.bls.gov/bls/news-release/cpi.htm and https://www.bls.gov/bls/news-release/empsit.htm
- Treasury par yield curve: https://home.treasury.gov/resource-center/data-chart-center/interest-rates
- SEC EDGAR submissions (earnings dates, 8-K item 2.02): https://data.sec.gov/submissions/

**Literature-pass numbers computed from raw data** (scripts in `…/correlation/lit/tools/`):
- FOMC, CPI and jobs-day mean absolute moves, 2022–2026
- 2024 election betas
- Tariff and geopolitical event-day moves
- Earnings-day moves and options implied moves on 2026-10-20

Web search was unavailable to that pass. Bloomberg, Reuters and sell-side analyses could not be retrieved, so press-reported figures are not used.


## 9. Files

- `correlation_pairs.csv` (this folder): ranked pairs (tiers 1–3) followed by every other measured study × token pair with n ≥ 15, with all metrics.
- Scripts in `/Volumes/T9/tmp-probabl/market-research/correlation/scripts/`:
  - `engine.py` and `stats.py`: correlation engine.
  - `studies.py`: market definitions.
  - `event_study.py` and `run_jumps.py`: event studies.
  - `kalshi_macro.py` and `macro_analysis.py`: macro releases.
  - `earnings.py`: earnings study.
  - `betas.py` and `ladder_delta.py`: driver betas and price-ladder Δ.
  - `hourly_stocks.py`: intraday hourly check.
  - `assemble.py` and `report_tables.py`: CSV and tables.
- Outputs in `/Volumes/T9/tmp-probabl/market-research/correlation/out/`:
  - `results_active.json` and `results_closed.json`: all study rows.
  - `event_studies.json`, `kalshi_macro_*.json`, `macro_regressions.json`, `earnings_events.json`, `betas.json`, `ladder_delta.json`, `tables.md`.
- Raw data in `/Volumes/T9/tmp-probabl/market-research/correlation/raw/`: `poly/`, `kalshi/`, `hist/` (Nasdaq daily), `binance/`, `yahoo/` and `cache/` (API responses).
- The literature pass's scratch data is in `/Volumes/T9/tmp-probabl/market-research/correlation/lit/`.
