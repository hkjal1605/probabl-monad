# Attention, platform structure and short-term products: Polymarket, Kalshi and other venues

Research notes for Probabl, compiled 2026-10-20. Probabl is an on-chain exchange for conditional stock markets on Robinhood Chain ("NVDA if YES" vs "NVDA if NO" for an event; the winning branch redeems for the stock token and the losing branch's buyers are refunded). Most Probabl markets today resolve in more than 5–6 weeks. These notes cover the qualitative and market-structure side; raw market lists and volumes from the Polymarket and Kalshi APIs are a separate workstream.

## How to read these notes

- Every claim carries a source URL inline. **[unverified]** marks a figure from a weak, secondary, aggregator, sponsored or AI-generated source, a paywalled article read only through a summary, or a number that could not be matched to a second source. **[secondary]** marks reporting that relays someone else's data.
- Every number carries its unit and date. Today is 2026-10-20; "October 2026" figures are partial months.
- **Volume measures differ.** Kalshi and most trackers count *face* or *notional* volume: each contract at its $1 payout. *Dollars paid* is contracts times price. Kalshi buyers paid about 23–29 cents per $1 of face in autumn 2026, and cheap parlays inflate face volume most. Polymarket's own gamma API "volume" runs about 2x one-sided cash turnover. Do not add figures across these measures.
- "Polymarket" can mean Polymarket International (on-chain, offshore), Polymarket US (the CFTC-regulated app from the QCEX acquisition), or both. Each section says which.
- The research used one shared web-search budget, which ran out partway through. Later work relied on direct page fetches, public APIs (Polymarket gamma, Kalshi trade API, DefiLlama, Wikimedia) and filings. Each section lists its gaps; Appendix B lists the overall limits.

## Contents

1. What people talk about most (attention), July–October 2026
2. Platform-level numbers for 2026: volumes, users, categories, retention, fees, market makers, controversies
3. Short-term products on Polymarket and Kalshi, in depth
4. Short-term and prediction products on other venues
5. Retention and virality mechanics, ranked by evidence
6. Stocks, crypto and prediction markets together; hedging
7. What this means for Probabl (consolidated)
- Appendix A: data pulled directly; Appendix B: limits

## Executive summary

**Attention (section 1).**
- The biggest 2026 attention events were the World Cup (June 11–July 19), the US–Iran war and ceasefires (from the Feb 28 strikes), the Fed chair succession and the first rate hike since 2023 (Sept 16), the Maduro removal (January), Brazil's election (runoff Oct 25) and the US midterms (Nov 3).
- Google Trends for "prediction market" hit its five-year high in the week of June 7–13 and was down 83% by mid-August [secondary].
- Conversation and volume diverge sharply:
  - Sports was 77–82% of Kalshi and Polymarket volume in May–July 2026 (Pew), but Polymarket game markets carry almost no comments.
  - Politics and geopolitics were only 0.4–16% of volume, but they dominate Polymarket comments (Brazil 25,690; the closed US–Iran peace-deal market 12,887), search peaks (Peru's runoff, Hungary's election, US primaries) and news coverage (insider trading, election integrity).
  - Culture and mention markets produce the viral stories (Ronaldo crying, $89M; Love Island; the State of the Union mentions, 79% of volume on speech day) on small volume.
- Polymarket leads US branded search (57.8% vs Kalshi 35.8% in August 2026) while Kalshi leads volume about 4.5 to 1.
- Both venues manufacture attention:
  - Polymarket uses "JUST IN" X posts (1.7M followers; one false post drew 19.6M views), affiliate "news" accounts with 3x its impressions, and paid creators (800+ by October).
  - Kalshi bought TV distribution through CNN and CNBC tickers and runs a news site that turns odds moves into headlines.

**Platform numbers (section 2).**
- **Kalshi volume:** grew from $9.5B face in January 2026 to a record $60.7B in September; Oct 1–19 was already $55.8B. Its record week was $19–21.5B in mid-October. It has about 76% of tracked volume.
- **Polymarket volume:** International peaked at $11.3B in June and fell to $4.7B in September. Polymarket US grew to $8.8B in September and passed International.
- **Industry:** Q3 2026 was about $188B face (CryptoRank).
- **Kalshi categories:** sports 77–89% of volume. Combos (parlays) are about 60–70% of Kalshi face volume but 28% of dollars paid and under 13% of trades.
- **Retail outcomes:** 69.2% of 2.9M retail Polymarket accounts are below break-even. Losers quit within 30 days 2.5x as often as winners. About 6% of wallets make about 80% of taker volume.
- **Fees:** Polymarket went from zero to taker fees of C × rate × p(1−p) (crypto 0.07, sports 0.05, politics and finance 0.04, geopolitics free). Kalshi charges 0.07 × C × P(1−P) to takers, plus maker fees on 126 series.
- **Incentives:** Kalshi is ending its volume-rewards program after wash-trading claims and a CFTC staff warning.
- **Controversies:** the first insider-trading charges came on April 23 (Maduro raid) and May 27 (Google search data). A WSJ investigation found UMA voters with stakes in disputed markets. A circuit split on state sports-betting law is heading to the Supreme Court.

**Short-term products (sections 3 and 4).**
- **Kalshi 15-minute crypto** (Dec 2025) is the clear winner. BTC 15m turns over about $130M a day at a 0.53¢ spread, about 83% of all BTC up/down turnover across venues. It settles on a 60-second average of CF Benchmarks' index. Kalshi crypto grew from $343M (January) to $8.89B (September), about 86% of it from 15m markets. All of Kalshi's 15-minute markets earn about $1B a year in fees (13% of volume, 20% of fees). Robinhood and Coinbase distribute it.
- **Polymarket's 5m and 15m** markets peaked in January–April 2026 and are down sharply: BTC 15m is down about 87% from its peak, and BTC 5m is about $6M a day in cash turnover. Bots are about 80% of crypto volume, and crypto has Polymarket's worst one-month retention, about 37%. A Stanford/SMU study found last-second manipulation of single-snapshot settlement ($8.2M to 821 accounts), and Polymarket switched to a Chainlink TWAP on Aug 7.
- **Short-dated stock and index binaries failed to scale everywhere:**
  - Polymarket NVDA daily: about $2.3K per market in October 2026.
  - Kalshi S&P daily range: 130K contracts a week; its S&P and Nasdaq 15m are listed but not trading.
  - Limitless NVDA hourly: $1,428.
- **Other Kalshi short products:**
  - New 15m gold and FX contracts grew fast; gold beat ETH in September.
  - Weather is steady and niche (about $100M a month).
  - Mentions peaked at $183M in February 2026, then collapsed after CFTC enforcement.
  - Combos have produced more than $870M of taker losses.
- **Other venues:**
  - Incentive cliffs dominate: Probable ($1.46B in January, about $0 by April), Limitless (−96%), Myriad (−95%), Opinion and HIP-4.
  - PancakeSwap's 5-minute pari-mutuel rounds have survived 5+ years at about $150M a year.
  - Distribution wins: Robinhood (13.6B contracts and $156M event revenue in Q2 2026), Coinbase (crypto binaries tripled daily traders), DraftKings (acquisition cost down over 80%).
  - Stock perps (Trade.xyz, $59.4B in September 2026) beat stock binaries by roughly 1,000x.

**Retention and virality (section 5).** Ranked by strength of evidence:
1. Push alerts on price moves (FCA experiment +11% trades; Robinhood ±5% alerts +25%).
2. Points per trade (+12% FCA, +39% OSC; Hyperliquid and Axiom), though points paid on raw activity attract farmers.
3. Distribution inside brokers, wallets and terminals.
4. Fee-share referrals plus cashback (Axiom returns about 52% of fees).
5. Combos.
6. High-frequency event cadence.
7. Media distribution and odds-as-news.
8. Yield on positions.
9. Social feeds, leaderboards and copy trading (the FCA found no leaderboard effect on trade count).
10. pump.fun-style creator fees and livestreams.

PnL cards, streaks and live in-play have little or no published evidence.

**Stocks plus events (section 6).**
- No venue sells "stock if event" with a refund of the losing branch.
- The nearest mechanism is futarchy (MetaDAO, Seer, Futarchy.fi, Butter), which uses pass/fail conditional vaults and has thin markets. Paradigm's "Quantum Markets" design (one deposit, credit in every branch, only the winner settles) is the closest blueprint.
- Robinhood is converging on Probabl's idea from the broker side: a Predict tab, earnings and KPI contracts on 20+ symbols, an earnings-call player at the top of stock pages, and Cboe KPI binaries approved by the SEC on Oct 15, 2026.
- Hedging with prediction markets is mostly a signal use. The Fed's staff paper finds Kalshi a better FOMC forecaster than futures but retail-dominated, and fed funds futures carry about 140x Kalshi's order-book depth. Business hedges are anecdotes (a $60K Dodgers hedge).
- Plain stock exposure is commoditised (Kalshi US500 perp, HIP-3, xStocks, Robinhood tokens). Probabl's edge is the conditional spread itself.

---

## 1. What people talk about most (attention), July–October 2026

### 1.1 Method and caveats

- Attention here means search interest, news coverage, social posts, and on-platform comments. Volume means notional contracts traded ($1 face value per contract unless noted). Pew, The Block and most trackers count notional taker volume, so a 5-cent longshot trade counts as $1 per contract. DeFi Rate estimates Kalshi buyers actually paid about 29 cents per $1 of notional in Q3 2026 ([Yahoo Finance / BeInCrypto, Oct 6, 2026](https://finance.yahoo.com/markets/options/articles/prediction-markets-just-hit-188-163233890.html)) [secondary].
- I pulled two primary datasets myself on Oct 20, 2026 (raw files in `/Volumes/T9/tmp-probabl/market-research/attention/data/`):
  - Polymarket Gamma API event rankings by 24-hour volume, total volume and comment count (`https://gamma-api.polymarket.com/events?...&order=volume24hr|commentCount|volume`). This covers Polymarket International only, not the separate Polymarket US app. Gamma's rolling `volume1wk`/`volume1mo` fields are stale on events whose sub-markets have closed (for example, a January 2026 Stranger Things market still showed up as "last week" volume), so I only use 24-hour and lifetime figures.
  - English Wikipedia pageviews for "Polymarket", "Kalshi" and "Prediction market" from the Wikimedia REST API (`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/<article>/monthly/...`).
- X/Twitter post-level engagement is not available without an X login, and Reddit blocked automated fetches. For those, I rely on press reports.

### 1.2 The single biggest attention events of 2026 so far

| Event (2026) | Attention evidence | Volume evidence |
|---|---|---|
| FIFA World Cup (June 11–July 19) | Google Trends for "prediction market" hit its five-year high (100) in the week of June 7–13 and fell to 17 by Aug 9–15, down 83% ([The Defiant](https://thedefiant.io/news/defi/prediction-market-search-interest-falls-83-from-world-cup-peak-as-kalshi-pulls-away); [Crypto Briefing, Aug 17, 2026](https://cryptobriefing.com/kalshi-prediction-market-volume-dominance/)) [secondary]. Kalshi's Wikipedia page had its 2026 high-water mark for July (98,680 views) and a daily spike of 7,070 on July 19, the final (Wikimedia API). | Polymarket's World Cup Winner market closed at $4.33 billion lifetime volume, with 4,139 comments (Gamma API, Oct 20, 2026). Kalshi's winner market did nearly $1.9 billion, more than triple its previous record (the 2024 presidential market, $535 million); 97 of Kalshi's 200 largest markets ever were World Cup markets ([TIME sponsored content, July 20, 2026](https://time.com/partner-content/prediction-markets/how-the-world-cup-broke-prediction-market-records/)) [secondary, sponsored page]. Single knockout games did $40–86 million each on Polymarket (Spain vs Argentina "More Markets" $85.9M) (Gamma API). |
| US–Iran war (US strikes from Feb 28, 2026; blockade; ceasefires; Hormuz) | Polymarket's highest-comment closed event since July is "US x Iran permanent peace deal by...?" with 12,887 comments (Gamma API). Insider-trading coverage ran in Bloomberg, CNN, CBS 60 Minutes and Quartz ([Bloomberg graphics](https://www.bloomberg.com/graphics/2026-polymarket-bets-iran-war-insider-trading/); [CBS News](https://www.cbsnews.com/news/betting-on-iran-war-insider-trading-concerns-prediction-markets-60-minutes/); [CNN, Mar 24, 2026](https://www.cnn.com/2026/03/24/politics/iran-war-bets-prediction-markets)). | "Will the US strike Iran?" (23 sub-markets) did $252.7 million in February 2026 ([TRM Labs](https://www.trmlabs.com/resources/blog/how-prediction-markets-scaled-to-usd-21b-in-monthly-volume-in-2026)). "US x Iran permanent peace deal" closed at $478.9 million lifetime (Gamma API). Bloomberg reported geopolitics monthly volume above $1.5 billion in April, a category record, and about $45 million of flagged anomalous trades tied to strikes and ceasefire bets ([Bloomberg via search summary](https://www.bloomberg.com/graphics/2026-polymarket-bets-iran-war-insider-trading/)) [unverified, page paywalled]. CBS put money staked on military outcomes in 2026 above $1 billion ([CBS News](https://www.cbsnews.com/news/betting-on-iran-war-insider-trading-concerns-prediction-markets-60-minutes/)). On Oct 20, 2026, "US-Iran ceasefire continues through...?" was Polymarket's #2 event by 24-hour volume ($1.79 million) (Gamma API). |
| Fed chair succession and the 2026 rate hikes | The FOMC raised the federal funds target range 25 bp to 3.75–4.00% on Sept 16, 2026, by a 12–0 vote, citing high inflation ([Federal Reserve press release, Sept 16, 2026](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm)). Secondary coverage calls it the first hike since 2023, under Chair Kevin Warsh ([Crypto Briefing](https://cryptobriefing.com/fed-prepares-for-potential-interest-rate-hike-under-kevin-warshs-leadership/)) [secondary]. A hike cycle after years of cut debates made each FOMC a live two-sided market. | "Who will Trump nominate as Fed Chair?" closed at $617.3 million on Polymarket with 1,999 comments (Gamma API). Polymarket's September Fed decision market closed at $208.0 million and July at $144.0 million; the October 28 decision market had $49.9 million lifetime and led all Polymarket events with $2.72 million in 24-hour volume on Oct 20 (Gamma API). |
| Brazil's presidential election (first round Oct 4, runoff Oct 25) | Right-wing Brazilian accounts are sharing Polymarket charts ("Flavio Bolsonaro has skyrocketed on Polymarket") as proof of momentum; Brazil banned Polymarket in April 2026, but VPN use continues ([France 24/AFP, Oct 17, 2026](https://www.france24.com/en/live-news/20261017-brazil-s-right-embraces-election-betting-odds-amid-polls-skepticism)). The Brazil event has 25,690 comments, by far the most of any open Polymarket event and roughly 15 times the next one (Gamma API). | $188.8 million lifetime; $0.96 million in 24-hour volume on Oct 20 (Gamma API). AFP put it at about $185 million ([France 24](https://www.france24.com/en/live-news/20261017-brazil-s-right-embraces-election-betting-odds-amid-polls-skepticism)). |
| US midterms (Nov 3, 2026) | Called "the first prediction-market election" by CNN ([CNN, Sept 24, 2026](https://www.cnn.com/2026/09/24/politics/midterm-elections-prediction-markets-kalshi-polymarket)). Election officials worry odds will erode trust; after early LA mayoral primary returns diverged from market odds, the county registrar said it fed suspicion of ballot processing ([Votebeat, Aug 10, 2026](https://www.votebeat.org/national/2026/08/10/election-officials-worried-prediction-betting-markets-kalshi-polymarket/)). Branded search for prediction markets peaked on March 2, before midterm primaries, at more than 4 times the mid-May baseline (Blask via [SCCG, Sept 30, 2026](https://sccgmanagement.com/sccg-articles/2026/09/30/polymarket-retains-lead-in-branded-search-demand-for-us-prediction-markets-while-kalshi-commands-trading-volume/)) [secondary]. Kalshi says its election hub "attracts mostly non-traders" ([DeFi Rate news feed, Oct 16, 2026](https://defirate.com/daily/kalshis-love-island-bombshell-the-steamy-summer-show-brings-in-new-demographics/)) [secondary]. A Reuters/Ipsos poll (Sept 30–Oct 5, 2026) found 60% of US adults oppose election betting and 13% support it ([RG.org summary](https://rg.org/news/gambling-industry/midterm-prediction-market-trading-tops-750m-watchdog-sees-1-6b)) [secondary]. | Combined 2026 election trading on Kalshi and Polymarket exceeded $750 million by Sept 24 (CNN). Congressional races alone drew $221 million through Sept 30 versus $92.4 million for the whole 2024 congressional cycle, across 21,811 markets; 58% of that volume is on margin-of-victory markets and 16% on winners; 76% of markets hold under $1,000; 10 wallets hold 17% of Polymarket congressional volume (Anti-Corruption Data Collective via [RG.org](https://rg.org/news/gambling-industry/midterm-prediction-market-trading-tops-750m-watchdog-sees-1-6b)) [secondary]. Polymarket's "Balance of Power: 2026 Midterms" had $25.5 million lifetime on Oct 20 (Gamma API). |
| Maduro removal (early January 2026) | A roughly $32,000 bet placed just before the announcement returned more than $400,000 ([Yahoo Finance](https://finance.yahoo.com/news/prediction-market-user-made-436-230654302.html)). Polymarket's Wikipedia pageviews spiked on Jan 6–7 (7,598 and 6,890 views) (Wikimedia API). The figures match the first CFTC/DOJ insider-trading charge involving event contracts, unsealed April 23, 2026: an active-duty Army servicemember allegedly used classified information about the operation, bought about $33,000 of Polymarket contracts and made about $410,000 ([Debevoise, Apr 2026](https://www.debevoise.com/insights/publications/2026/04/polymarket-insider-trading-charges-illustrate-doj); [Dentons, Apr 27, 2026](https://www.dentons.com/en/insights/alerts/2026/april/27/doj-and-cftc-bring-first-of-its-kind-prediction-market-insider-trading-case)). Polymarket's Wikipedia pageviews hit their 2026 daily high of 15,327 the next day, April 24 (Wikimedia API). | "Maduro out by...?" closed at $56.6 million with 2,246 comments; "Venezuela leader end of 2026?" has $98.5 million (Gamma API). |

### 1.3 Recurring attention drivers, by category

**Elections.** The biggest search spikes outside sports are contested elections. A CasinoReviews study of a year of Google Trends data across 51 countries found Polymarket's highest worldwide search peak on June 7, 2026 (Peru's presidential runoff), and the second-largest sustained peak on April 12, 2026 (Hungary's parliamentary election and Peru's first round) ([G3 Newswire, Sept 18, 2026](https://g3newswire.com/casinoreviews-research-shows-banning-prediction-markets-drives-interest-rather-than-deters-it/)) [secondary; commercial reviewer]. The same study found 8 of the top 15 countries by Polymarket search share restrict or ban prediction markets, so bans do not suppress curiosity. On Oct 20, 2026, the open Polymarket events with the most comments were nearly all elections or geopolitics: Brazil (25,690), "US confirms aliens exist" (1,734), Ballon d'Or (1,217), "US invades Venezuela" (1,176), "Iran leadership change" (1,090), 2028 presidential winner (1,056), "Epstein client list released" (1,049) (Gamma API). Long-dated US elections keep large standing books: 2028 Democratic nominee $1.30 billion lifetime, 2028 Republican nominee $714 million, 2028 winner $717 million (Gamma API).

**Wars and ceasefires.** See the Iran row above. On Oct 20, 2026, four of Polymarket's top 25 events by 24-hour volume were Iran-related ("US-Iran ceasefire continues", "Israel x Iran ceasefire continues", "US announces end of Iranian blockade", and two "Who wins the Senate pending Hormuz Agreement" markets), plus Putin, Kim Jong Un and Strait of Hormuz markets (Gamma API). War markets also drive the worst press: Polymarket pulled a market on whether a downed US airman would be rescued (April 2026) after Rep. Seth Moulton called it "DISGUSTING", and a nuclear-detonation market after about $650,000 was wagered (March 2026) ([Morocco World News](https://www.moroccoworldnews.com/2026/03/281593/polymarket-removes-nuclear-detonation-betting-market-after-backlash/)) [secondary].

**The Fed and macro.** Fed markets are both conversation and volume, and they recur every six to seven weeks. Polymarket monthly Fed decision markets did $144 million (July) and $208 million (September) (Gamma API). Odds moves are newsworthy: the October hike probability fell from about 65% in late September to 16% by Oct 7 ([RG.org daily odds, Oct 7, 2026](https://rg.org/news/prediction-markets/polymarket-daily-odds-october-7-2026)) [secondary]. A tracker that reviewed 33,716 settled questions reported that Fed-decision markets were right 28 of 28 times the day before ([Blockonomi, Oct 15, 2026, citing PredictionScout](https://blockonomi.com/prediction-market-statistics-2026-kalshi-polymarket-and-the-numbers-behind-the-boom)) [unverified]. Other live macro books on Oct 20: "What will WTI crude hit in October" $3.2 million, "US recession by end of 2026" (No at 94% on Oct 7) (Gamma API; RG.org).

**Tariffs.** Tariffs were a 2025 driver. They do not appear in Polymarket's top 40 events by 24-hour volume or comments on Oct 20, 2026 (Gamma API). I found no 2026 coverage naming a tariff market as a top market.

**AI model releases and AI companies.** Polymarket runs a monthly "Which company has the best AI model end of <month>?" series that resolves on the arena.ai text leaderboard: about $21.1 million for end-April, $11.9 million for end-May, $8.2 million for end-July, about $3.5 million for end-September (as of Sept 18), and about $1.8 million for end-October so far (Polymarket event pages: [Sept](https://polymarket.com/event/which-company-has-the-best-ai-model-end-of-september-20260717143435868), [July](https://polymarket.com/event/which-company-has-best-ai-model-end-of-july-299), [May](https://polymarket.com/event/which-company-has-the-best-ai-model-end-of-may), [April](https://polymarket.com/event/which-company-has-the-best-ai-model-end-of-april)). Release-date markets ("Gemini 4.0 released by Oct 15?") and AI-company corporate markets ("Largest IPO by market cap in 2026": Anthropic 55%, SpaceX 46%, $6.5 million) also trade ([RG.org, Oct 7, 2026](https://rg.org/news/prediction-markets/polymarket-daily-odds-october-7-2026)) [secondary]. "Indiana enacts data center moratorium" had $6.1 million lifetime (Gamma API). These are mid-sized books with a dedicated audience, not mass attention.

**Celebrity, culture and "will they say it".**
- "Will Cristiano Ronaldo cry at the World Cup?" was Polymarket's second-largest World Cup market at $89 million ([TIME sponsored content](https://time.com/partner-content/prediction-markets/how-the-world-cup-broke-prediction-market-records/); [PolyInsider](https://polyinsider.io/en/markets/will-ronaldo-cry-at-the-world-cup-20260604013616610)) [secondary]. It produced a resolution fight over whether moisture on his face counted as tears; reports conflict on how it was first ruled ([Yellow.com](https://yellow.com/news/did-ronaldo-cry-polymarket); [KuCoin flash](https://www.kucoin.com/news/flash/polymarket-rules-c-ronaldo-s-tear-as-valid-after-controversy)) [secondary].
- Kalshi's Love Island USA markets brought in a new, younger and more female audience; Rolling Stone cited Love Island trading rising to $77.3 million after the July finale ([Rolling Stone, Sept 11, 2026](https://www.rollingstone.com/culture/culture-features/kalshi-polymarket-viral-moments-1235625058/), paywalled, figure via search summary) [unverified]. Earlier in the season the USA and UK markets together had $13.4 million ([DeFi Rate](https://defirate.com/daily/kalshis-love-island-bombshell-the-steamy-summer-show-brings-in-new-demographics/)) [secondary].
- A January 2026 rumor that Netflix would drop a surprise Stranger Things episode produced a 3-day market ("released by Wednesday?") that did $15.2 million, plus $10.6 million on "by January 31" (Gamma API, market closed Jan 8, 2026).
- Eurovision 2026 markets did $195.8 million ([Blockonomi](https://blockonomi.com/prediction-market-statistics-2026-kalshi-polymarket-and-the-numbers-behind-the-boom); [MetaMask](https://metamask.io/news/top-prediction-market-categories-2026)) [secondary].
- Smaller live culture books on Oct 20: "# of views of GTA VI launch trailer in week 1" ($637,000, resolves on Rockstar's YouTube counter), "Kanye West performs in Russia by Oct 31" (414 comments), "Will the US confirm aliens exist" ($74.3 million lifetime) (Gamma API). Kalshi's news site runs stories on Rotten Tomatoes score markets, Oscars odds and White House staff exits ([Kalshi News](https://news.kalshi.com/)).

**Elon and Trump.** Elon Musk tweet-count markets run in overlapping 2-day, 3-day, weekly and monthly windows. Weekly windows did about $5.87 million (May 29–June 5) and $4.7 million (July 3–10) ([Polymarket](https://polymarket.com/event/elon-musk-of-tweets-may-29-june-5); [Polymarket](https://polymarket.com/event/elon-musk-of-tweets-july-3-july-10)), and the Oct 13–20 window had $2.03 million with $0.54 million in its last 24 hours, making it Polymarket's #8 event by 24-hour volume on Oct 20 (Gamma API). Polymarket's own page calls tweet counts its "most active" market ([Polymarket](https://polymarket.com/predictions/polymarket)). Trump "mention" markets are small in volume but big in conversation. Kalshi's 2026 State of the Union mention markets did $11.97 million over 391,165 trades, 79% of it on speech day and $6.36 million in the three hours around the 107-minute speech, at an average trade size of about $29–33 ([DeFi Rate, Feb 25, 2026](https://defirate.com/news/trump-sotu-speech-generated-11-97m-in-volume-kalshi-hourly-breakdown/)). Kalshi's mentions category peaked at $183 million face in February 2026, ran $124–162 million a month through July, then fell to $46.6 million in August and $30.9 million in September 2026 ([ticker-tracker](https://ticker-tracker.com/kalshi/volume/mentions)) [aggregator]. A CNBC piece cited Dune for a much lower figure of about $3.3 million in one month in mid-2026 ([CNBC, Aug 14, 2026](https://www.cnbc.com/2026/08/14/prediction-markets-scrutiny-mounts-from-regulators-and-banks.html)) [unverified; via search summary, and it conflicts with ticker-tracker, possibly a different measure or subset]. The fall followed enforcement. On Aug 28, 2026 the CFTC ordered a former White House teleprompter operator to disgorge $107,539 and pay a $65,000 penalty for trading mention contracts with advance access to Trump's speeches. Kalshi pulled sports-announcer mention markets in August, and on Sept 22, 2026 CFTC staff said contracts on a person's words may be presumed "readily susceptible to manipulation" ([DeFi Rate](https://defirate.com/news/cftc-mention-markets-manipulation-advisory/)). Saturday Night Live mocked mention markets in an April 4, 2026 cold open ([Casino.org](https://www.casino.org/news/snl-pokes-fun-at-prediction-markets/)). See 3.B6 for the full product notes.

**Weather and hurricanes.** These are low-attention and low-volume as long-dated markets. Polymarket's hurricane hub showed about $869,000 total and Kalshi's Hawaii-landfall market about $164,000 (undated snapshots: [Polymarket](https://polymarket.com/predictions/hurricane); [Kalshi](https://kalshi.com/category/climate/hurricanes)). Daily temperature markets are a different, short-term product; see 3.A4 and 3.B5.

**Crypto prices.** Crypto is a steady volume category: 11–15% of Kalshi volume and 9–15% of Polymarket volume in May–July 2026 ([Pew, Sept 23, 2026](https://www.pewresearch.org/short-reads/2026/09/23/prediction-markets-trading-volume-doubled-between-may-and-july-largely-driven-by-sports/)). It produces little conversation: the long-dated "What price will Bitcoin hit in 2026?" ($76.6 million) and the October monthly ($8.9 million) both showed zero comments (Gamma API). TRM Labs notes crypto price markets were a key driver in October 2025 but "remain a consistently small share" across user tiers once geopolitics took over ([TRM Labs](https://www.trmlabs.com/resources/blog/how-prediction-markets-scaled-to-usd-21b-in-monthly-volume-in-2026)). The exception is crypto-company and token-launch markets, which are chatty: "MicroStrategy sells any Bitcoin by...?" closed at $407.2 million with 9,492 comments, and pump.fun airdrop, MetaMask token and Predict.fun FDV markets each have several hundred comments (Gamma API).

**Sports.** Sports is the volume engine and a weak conversation engine on-platform. Polymarket's single World Cup knockout games did $40–86 million each with 0 comments, and October football and tennis match events also had 0 comments (Gamma API; comments may be switched off for game markets). Big recurring sports moments still move search: Super Bowl Sunday ran more than 3 times the branded-search baseline, and median daily search during the World Cup was 38% above the prior four weeks (Blask via [SCCG](https://sccgmanagement.com/sccg-articles/2026/09/30/polymarket-retains-lead-in-branded-search-demand-for-us-prediction-markets-while-kalshi-commands-trading-volume/)) [secondary]. On Kalshi, the largest single game in Sept 14–20 was LSU vs Ole Miss at $38.62 million, behind a 10-leg cross-category combo at $44.11 million (search summary of [DeFi Rate](https://defirate.com/prediction-markets/volume/kalshi/)) [unverified].

### 1.4 Conversation versus volume

The two rank very differently.

| Category | Share of volume (Pew, notional) | Conversation signals |
|---|---|---|
| Sports | Kalshi 77–81% and Polymarket 57–82% in May–July 2026 ([Pew, Sept 23, 2026](https://www.pewresearch.org/short-reads/2026/09/23/prediction-markets-trading-volume-doubled-between-may-and-july-largely-driven-by-sports/)) | Near-zero on-platform comments on game markets (Gamma API). Search spikes only on mega-events (World Cup, Super Bowl). |
| Politics and geopolitics | Polymarket 16.2% (May), 8.6% (June), 5.6% (July); Kalshi 0.4–1.3%. Politics on Polymarket has averaged about $2 billion a month in 2026; on Kalshi it stayed under $300 million a month (Pew) | Dominates Polymarket comments (Brazil 25,690; Iran peace deal 12,887), news coverage (insider trading, election-integrity stories) and search peaks (Peru, Hungary, US primaries). |
| Crypto | Kalshi 11–15%, Polymarket 9–15% (Pew) | Low comments on price markets, high comments on company and token markets (Gamma API). |
| Culture, mentions, AI, weather ("Other" in Pew) | Kalshi 6–10%, Polymarket 3–12% (Pew). Over Sept 20–Oct 19, 2026, Kalshi single-leg weather was $118M, culture $54M, mentions $39M and tech $24M against $80B total ([DeFi Rate](https://defirate.com/prediction-markets/volume/kalshi/)) [unverified] | Produces the viral stories: Ronaldo crying, Love Island, SOTU mentions, SNL parody, Rolling Stone and Slate features. |

Other evidence that attention and volume diverge:
- **Search.** Polymarket leads US branded search while Kalshi leads volume. Blask's share-of-search metric had Polymarket at 74.3% in January and 57.8% in August 2026, and Kalshi rising from 23.1% to 35.8%, while August volume was Kalshi $37.17 billion versus Polymarket $8.16 billion (Blask via [SCCG](https://sccgmanagement.com/sccg-articles/2026/09/30/polymarket-retains-lead-in-branded-search-demand-for-us-prediction-markets-while-kalshi-commands-trading-volume/)) [secondary]. A different study puts the US Google Trends share at Kalshi 21% versus Polymarket 19% (Sept 2025–Sept 2026), with Polymarket ahead almost everywhere else ([G3 Newswire](https://g3newswire.com/casinoreviews-research-shows-banning-prediction-markets-drives-interest-rather-than-deters-it/)) [secondary]. Blask itself says "trading volume functions as a liquidity metric while BAP functions as an attention metric."
- **Wikipedia pageviews** (English, Wikimedia API, user agents only). Polymarket peaked in April 2026 at 150,451 views a month (Iran war coverage plus the first insider-trading charges, Apr 23) and fell to 41,185 in August and 51,207 in September. Kalshi peaked in December 2025 at 248,494, ran 98,680 in July 2026 (World Cup) and 73,052 in September. Through Oct 19, October had 30,929 (Polymarket) and 46,375 (Kalshi). Median daily views from July 1 to Oct 19, 2026 were 1,598 for Polymarket and 2,304 for Kalshi. "Prediction market" peaked at 68,376 in August 2026 and dropped to 16,043 in September.
- **Longshots.** Bloomberg found that longshot bets, which lose about 98% of the time, made up about half of Kalshi activity since early 2025 and 52% of Polymarket activity over 21 months; Polymarket disputes this and says longshots are about 1% of its volume ([Gambling.com summary of Bloomberg, Oct 2026](https://www.gambling.com/us/news/longshot-bets-dominate-kalshi-polymarket-despite-losses); [Bloomberg, Oct 7, 2026](https://www.bloomberg.com/news/features/2026-10-07/longshots-losing-98-of-time-dominate-kalshi-polymarket-trading)) [secondary]. Cheap, lottery-like tickets on attention events are much of what retail buys.
- **Retail outcomes.** Galaxy Research counted 2.9 million retail (non-bot) Polymarket accounts; 69.2% were below break-even, down $338.9 million in total since 2020 ([Yahoo Finance / BeInCrypto](https://finance.yahoo.com/markets/options/articles/prediction-markets-just-hit-188-163233890.html)) [secondary].

### 1.5 How the platforms manufacture and distribute attention

- **Official X accounts.** Polymarket's main X account had about 1.7 million followers in July 2026 and posts current events several times a day; Kalshi had 431,400 ([CoinDesk/AP, July 8, 2026](https://www.coindesk.com/markets/2026/07/08/polymarket-bets-on-u-s-marketing-blitz-to-win-back-trust-after-4-year-ban-report)). Polymarket uses "JUST IN:" breaking-news framing tied to a market. One false post (NYC grocery-store ID rumor, Aug 3, 2026) drew 19.6 million views and was used to promote a related market ([Popular Information, Aug 12, 2026](https://popular.info/p/the-truth-machine-is-lying-to-you)). A New York Times review in March 2026 found hundreds of false or misleading posts on Polymarket's social accounts ([CJR Tow Center, Mar 25, 2026](https://www.cjr.org/tow_center/polymarket-affiliates-are-spreading-misinformation-on-x.php)) [secondary for the NYT finding].
- **Affiliate "news" accounts.** At least 11 X accounts with "news" in their bios (@NewsWire_US, @unusual_whales, @Breaking911, @PopBase, @zerohedge and others) are Polymarket affiliates or work with it. Together they draw more than 3 times the official account's impressions; @NewsWire_US alone averages over 200 million impressions a month. Kalshi pursues similar deals with @BNONews and @WhaleInsider ([CJR](https://www.cjr.org/tow_center/polymarket-affiliates-are-spreading-misinformation-on-x.php)). Kalshi's version backfired repeatedly: it cut ties with partner accounts that posted antisemitic content (2025), a partner-badged "college basketball reporter" turned out to be fake and X relabeled it a parody, Kalshi dropped its X partner badges in February 2026 after X tightened paid-partnership rules for gambling, and a June 2026 sports clip with a digitally inserted Kalshi ad drew complaints (one repost had 878,000 views) ([Awful Announcing](https://awfulannouncing.com/gambling/kalshi-cuts-ties-x-affiliates-antisemitic-content-hitler-prediction.html); [Awful Announcing](https://awfulannouncing.com/gambling/kalshi-polymarket-partnering-fake-sports-insiders-promote-prediction-betting.html); [Awful Announcing](https://awfulannouncing.com/gambling/x-removes-kalshi-badges-paid-partnerships-policy.html); [SBC News, June 30, 2026](https://sbcnews.co.uk/marketing/2026/06/30/kalshi-x-marketing/)) [secondary, via search summary].
- **Paid creator programs.** Polymarket pays creators $10 to about $400 per quote-retweet of a branded market post, via a Discord and a "PolyTrack" dashboard; participation grew from 300+ creators in early August to 800+ by October 2026; recruiters get 3% of recruits' earnings; staff told creators posts "need to look organic" ([Aftermath, Oct 15, 2026](https://aftermath.site/polymarket-esports-paid-twitter/)). A June 2026 WSJ investigation alleged paid influencers posted simulated winning trades without adequate disclosure ([CoinDesk](https://www.coindesk.com/markets/2026/07/08/polymarket-bets-on-u-s-marketing-blitz-to-win-back-trust-after-4-year-ban-report)).
- **Staged "organic" moments.** Two viral Knicks-fan street videos during the June 2026 title run had ties to Kalshi and Polymarket ([Front Office Sports on X](https://x.com/FOS/status/2064860412420423940); [Slate, June 2026](https://slate.com/technology/2026/06/polymarket-kalshi-ads-sponsored-content-t-pain.html)). The BBB's National Advertising Division referred Kalshi to state attorneys general over its marketing (Slate). Rolling Stone argues both firms deliberately "manufacture viral cultural moments" ([Rolling Stone, Sept 11, 2026](https://www.rollingstone.com/culture/culture-features/kalshi-polymarket-viral-moments-1235625058/)).
- **Odds as news.** Kalshi runs a news site that turns odds moves into headlines ("Susie Wiles exit odds hit 43%", "Texas Senate odds: Talarico drops to 62% following CNN town hall") ([Kalshi News](https://news.kalshi.com/)). Media partners embed odds: Polymarket has deals with MLB, CNBC and CNN ([CoinDesk/AP](https://www.coindesk.com/markets/2026/07/08/polymarket-bets-on-u-s-marketing-blitz-to-win-back-trust-after-4-year-ban-report)), and TRM notes that Google Finance embedding live Polymarket and Kalshi odds sent users back to the platforms ([TRM Labs](https://www.trmlabs.com/resources/blog/how-prediction-markets-scaled-to-usd-21b-in-monthly-volume-in-2026)).
- **Ads.** Before the World Cup semifinals, Kalshi ran 36 TV spots and Polymarket 45, against 22 for all other US betting brands combined ([Blask](https://blask.com/blog/prediction-markets-us-igaming-2026/)) [secondary].

### 1.6 What this means for picking Probabl markets

- Pair stocks with events people already argue about, on a calendar: FOMC decisions (every 6–7 weeks; Polymarket's monthly Fed books did $144–208 million in July and September), CPI and jobs prints, earnings calls, AI model launches and leaderboard flips, and live geopolitical deadlines (ceasefires, Hormuz). These have both conversation and real books.
- Sports brings volume but little conversation, and its conditional link to stocks is weak, except for sponsor or media stocks.
- Elections drive the biggest search spikes and comment threads. They are also the most legally exposed category in the US (60% of US adults oppose election betting; states are suing). Brazil shows that an election market can go viral abroad even where the platform is banned.
- Attention decays fast after mega-events: World Cup search fell 83% in about two months. Daily or weekly recurring markets (Elon tweets, daily crypto, Fed every few weeks) keep a base of return visits that one-off events do not.
- Copy the format of mention and live-event markets: SOTU trading concentrated 79% of volume on the day and 53% in three hours. Short windows around a scheduled live event pull in small, frequent trades ($29–33 average).

---

## 2. Platform-level numbers for 2026 (Polymarket and Kalshi)

Research slice for Probabl (conditional stock markets on Robinhood Chain). Compiled 2026-10-20.

### How to read these numbers

- **Notional vs. dollars paid.** Kalshi's headline volume counts every contract at its $1 face value. A 5-cent parlay leg adds $1 of "volume" and 5 cents of money at risk. Polymarket has historically reported dollars paid, but most trackers now show both. Pew's 2026 analysis uses notional taker volume for both venues ([Pew, Sep 23 2026](https://www.pewresearch.org/short-reads/2026/09/23/prediction-markets-trading-volume-doubled-between-may-and-july-largely-driven-by-sports/)). DeFi Rate shows both measures ([DeFi Rate Kalshi page](https://defirate.com/prediction-markets/volume/kalshi/)). Unless a figure says otherwise, "volume" below means notional (contracts at $1).
- **The gap between the two measures is the story of 2026.** In Q3 2026 Kalshi did about $142 billion notional but buyers paid only about $41 billion, roughly 29 cents per $1 of face value ([Yahoo Finance / DeFi Rate / CryptoRank, Oct 2026](https://finance.yahoo.com/markets/options/articles/prediction-markets-just-hit-188-163233890.html)). In the week of Oct 5-11, 2026 the ratio was $4.42B paid to $19.03B notional, about 23 cents ([DeFi Rate, Oct 12 2026](https://defirate.com/news/kalshi-hits-record-19-billion-week-as-polymarket-us-triples-fall-trade-volume/)). Cheap parlays ("combos") and longshots push notional far above the money traded.
- **"Polymarket" can mean three things:** the offshore international exchange (crypto, on-chain), Polymarket US (the CFTC-regulated exchange that came from the QCEX acquisition), or both together. DeFi Rate tracks them separately. Pew combines them.
- **Sourcing.** Most monthly figures come from third-party trackers (DeFi Rate, The Block, Artemis, Dune). The venues do not publish audited monthly volume. Tracker figures are marked [unverified] where I could not match them to a second independent source. Where two trackers agree to within a few percent (for example Pew/The Block and DeFi Rate on Kalshi's Jan-Jul 2026 volume), I give both and drop the tag.
- **Limits of this pass.** The shared web-search budget ran out partway through. Gaps are listed at the end of this section.

---

### 2.1 Volumes, open interest, users, downloads, valuations

#### 2.1.1 Monthly notional volume, 2026

Kalshi from DeFi Rate ([source](https://defirate.com/prediction-markets/volume/kalshi/), observed Oct 19, 2026), cross-checked against Pew/The Block for January-July ([source](https://www.pewresearch.org/short-reads/2026/09/23/prediction-markets-trading-volume-doubled-between-may-and-july-largely-driven-by-sports/)). Polymarket international from DeFi Rate ([source](https://defirate.com/prediction-markets/volume/polymarket/)). Polymarket US from DeFi Rate ([source](https://defirate.com/prediction-markets/volume/polymarket-us/)), whose history starts May 27, 2026. "Share" is DeFi Rate's share of volume across all venues it tracks.

| Month (2026) | Kalshi notional (DeFi Rate) | Kalshi dollars paid | Kalshi share | Kalshi notional (Pew/The Block) | Polymarket intl notional | Polymarket intl dollars paid | Polymarket US notional | Polymarket total incl. US (Pew/The Block) |
|---|---|---|---|---|---|---|---|---|
| Jan | $9.5B | $3.8B | 55.3% | $9.55B | $7.7B | $3.5B | n/a | $7.94B |
| Feb | $10.4B | $4.3B | 56.7% | $10.44B | $7.9B | $3.7B | n/a | $8.21B |
| Mar | $13.1B | $5.3B | 55.3% | $13.00B | $10.6B | $5.0B | n/a | $11.27B |
| Apr | $14.8B | $5.5B | 62.0% | $14.81B | $9.0B | $4.2B | ~$1.3B [unverified, Sacra] | $10.27B |
| May | $18.0B | $6.5B | 70.2% | $16.81B | $7.3B | $3.3B | ~$1.8B [unverified, Sacra]; $325M from May 27 (DeFi Rate) | $8.85B |
| Jun | $32.7B | $10.4B | 64.9% | $33.00B | $11.3B | $4.4B | $4.1B | $14.74B |
| Jul | $41.1B | $13.3B | 72.7% | $40.10B | $8.6B | $3.9B | $5.0B | $12.89B |
| Aug | $40.0B | $12.1B | 79.0% | n/a | $5.0B | $2.6B | $3.8B | n/a |
| Sep | **$60.7B** (record) | $14.7B | 76.3% | n/a | $4.7B | $2.3B | **$8.8B** | n/a |
| Oct 1-19 | $55.8B | $12.9B | 76.3% | n/a | $2.9B | $1.5B | $8.3B | n/a |

Polymarket US monthly estimates for April and May come from [Sacra](https://sacra.com/c/polymarket/).

What the table shows:

- **Kalshi grew about 6x in notional terms from January to September 2026** ($9.5B to $60.7B). Its dollars paid grew about 3.9x ($3.8B to $14.7B). Most of the gap is parlays. Kalshi was up 2,020% year on year in September 2026, by DeFi Rate's count.
- **Polymarket international peaked in June 2026** at $11.3B notional during the World Cup and fell to $4.7B in September. Its share of all venues fell from 44.5% in January to 4.0% in October.
- **Polymarket US is where Polymarket is growing.** It rose from $4.1B in June to $8.8B in September. It passed the international exchange in September 2026 ([Crypto Briefing, Oct 12 2026](https://cryptobriefing.com/polymarket-us-weekly-volume-surge/)). Weekly US volume rose from $60.8M in early January to $2.72B in early October. Pew says Polymarket US was 4% of Polymarket volume in January and 39% in July.
- **Other September 2026 Kalshi totals:** Ticker Tracker shows $60.85B ([source](https://ticker-tracker.com/kalshi/volume)) [unverified] and Prediction News reports about $60B ([source](https://predictionnews.com/story/kalshi-volume-surges-but-rivals-gain-market-share)). The Block's dashboard showed $52.98B with September incomplete as of Sep 29, and $38.67B for August ([The Block, Sep 30 2026](https://www.theblock.co/news/business/2026-09-30-kalshi-ends-trader-incentive-program-417247)). DeFi Rate has $40.0B for August, so the trackers disagree by about 3%.
- **Industry totals.** Pew/The Block put combined Kalshi plus Polymarket at $17.5B in January, $47.7B in June and $53.0B in July 2026, and about $47B in August. DeFi Rate counts $79.6B across eight venues in September 2026 ([DeFi Rate aggregate](https://defirate.com/prediction-markets/volume/)) [unverified]. Artemis puts Q2 2026 at $111B, up 1,764% year on year ([Sporting Crypto, Aug 10 2026](https://newsletter.sportingcrypto.com/p/state-of-prediction-markets-q2-2026-report)) [unverified]. CryptoRank puts Q3 2026 at $188B, about 70% above Q2 ([Yahoo Finance, Oct 2026](https://finance.yahoo.com/markets/options/articles/prediction-markets-just-hit-188-163233890.html)).
- **Kalshi perps are in some totals and not others.** Kalshi launched crypto perpetual futures on June 3, 2026. Sacra says about $7B of Kalshi's roughly $30B June volume came from zero-fee perps ([Sacra](https://sacra.com/c/kalshi/)) [unverified]. I could not tell whether DeFi Rate's event-contract figures include perps. KalshiData's estimates reportedly do.

#### 2.1.2 Weekly and daily records (autumn 2026)

| Record | Value | Date | Source |
|---|---|---|---|
| Kalshi biggest week | $21.52B notional (75.6% share) | Oct 12-18, 2026 | [DeFi Rate](https://defirate.com/prediction-markets/volume/kalshi/) [unverified] |
| Kalshi prior record week | $19.03B notional, $4.42B paid, 97.9M trades | Oct 5-11, 2026 | [DeFi Rate, Oct 12 2026](https://defirate.com/news/kalshi-hits-record-19-billion-week-as-polymarket-us-triples-fall-trade-volume/) |
| Kalshi weeks before that | $18.37B (Sep 28-Oct 4); $15.66B (Sep 21-27); $15.27B (Sep 14-20) | Sep-Oct 2026 | [DeFi Rate](https://defirate.com/prediction-markets/volume/kalshi/) |
| Kalshi biggest day | $4.47B notional | Oct 18, 2026 | [DeFi Rate](https://defirate.com/prediction-markets/volume/kalshi/) [unverified] |
| Kalshi back-to-back record days | $3.91B (Oct 10) and $3.96B (Oct 11); combos 71.6% and 69.4% | Oct 10-11, 2026 | [Bitcoin.com](https://news.bitcoin.com/igaming/parlays-push-kalshi-past-3-9-billion-in-a-day-twice-in-a-weekend/) [unverified]; DeFi Rate's later table puts Oct 11 at $4.20B |
| Kalshi early-September record day | $2.3B notional, about 60% parlays | Sat. Sep 5, 2026 | [Sam McQuillan on X](https://x.com/sam_mcquill/status/2097365089431015752) [unverified] |
| Kalshi plus Polymarket combined week | $22.2B; $8.56B in two days | week to about Oct 11, 2026 | [KuCoin, citing Bloomberg](https://www.kucoin.com/news/flash/kalshi-and-polymarket-record-8-56-billion-in-two-day-trading-volume) [unverified] |
| All tracked venues, one week | $28.5B, up 14% week on week | week of Oct 12, 2026 | [DeFi Rate aggregate](https://defirate.com/prediction-markets/volume/) [unverified] |
| Polymarket US biggest week and day | $3.3B (Oct 13-19); $707M (Oct 17) | Oct 2026 | [DeFi Rate](https://defirate.com/prediction-markets/volume/polymarket-us/) [unverified] |
| Polymarket intl biggest day | $582M notional ($208M paid) | Jun 17, 2026 | [DeFi Rate](https://defirate.com/prediction-markets/volume/polymarket/) |
| Polymarket single-day record (on-chain) | $425M, above Election Day 2024 | Feb 28, 2026 (Iran strikes, "Khamenei out" markets) | [TRM Labs, Mar 27 2026](https://www.trmlabs.com/resources/blog/how-prediction-markets-scaled-to-usd-21b-in-monthly-volume-in-2026) |

Trade counts. DeFi Rate reports about 417M Kalshi trades over the 30 days to mid-October 2026, roughly 13.9M a day, with an average of $44.67 paid per trade [unverified, from a search summary of the DeFi Rate page]. The week of Oct 5-11, 2026 had 97.9M executions, up from 67.4M in the week ending Sep 6 ([DeFi Rate](https://defirate.com/news/kalshi-hits-record-19-billion-week-as-polymarket-us-triples-fall-trade-volume/)).

#### 2.1.3 Open interest

- **Kalshi** passed $1B of open interest for the first time at $1.16B on about June 18, 2026. That was up 350% year to date ([The Block, Jun 24 2026](https://www.theblock.co/post/405854/world-cup-boom-sends-polymarket-volume-up-300-while-kalshi-sets-open-interest-records)). DeFi Rate's dashboard showed about $1.5B in October 2026 [unverified].
- **Polymarket** open interest stayed roughly flat through the World Cup. Polymarket US had not regained its April 2026 high as of June 24 (same Block article). Allium put Kalshi at about $1.02B, Polymarket international at $488.5M and Polymarket US at $91.6M on June 18, 2026 [unverified, quoted in a search summary; primary not retrieved].
- **Ratio.** Kalshi turned over about $60B notional in September against roughly $1-1.5B of open interest. Most positions are short-dated sports and crypto contracts that settle the same day.

#### 2.1.4 Users, traders and downloads

| Metric | Figure | Date | Source |
|---|---|---|---|
| Kalshi monthly users (company) | "2 million to 4 million" active monthly users; Forbes cites about 2M MAU | May-Jun 2026 | search summaries of [Forbes, Jun 1 2026](https://www.forbes.com/sites/digital-assets/2026/06/01/kalshis-ceo-wants-to-turn-every-question-into-a-market/) and [nextpredict](https://nextpredict.io/operators/kalshi/) [unverified; Forbes page returned 403] |
| Kalshi monthly users (Sensor Tower via FT) | 5.1M, up from 600K at the start of 2025 | Feb 2026 | [Covers via Yahoo, Feb 16 2026](https://finance.yahoo.com/news/kalshi-prediction-markets-stealing-market-160600765.html) |
| Kalshi new users during the World Cup | 3M added (Jun 11-Jul 19, 2026); World Cup winner contract above $1.2B | Jul 2026 | [Yahoo Finance](https://finance.yahoo.com/markets/crypto/articles/kalshi-gains-3-million-users-163812357.html), [Quartz](https://qz.com/kalshi-3-million-users-world-cup-072026) [unverified, company-reported] |
| Kalshi active traders, 2025 | grew from 240K to 1.2M | 2025 | [Sacra](https://sacra.com/c/kalshi/) [unverified] |
| Kalshi app downloads | 6.3M (Sep 2025-Feb 2026); more than 3M US downloads in January 2026 (Apptopia) | Mar 2026 | [Citizens JMP, Mar 23 2026](https://citizens.bluematrix.com/docs/pdf/3beb4505-5a8b-49da-89df-ebdb104ebea9.pdf); [DeFi Rate](https://defirate.com/news/kalshi-polymarket-three-quarters-betting-app-downloads-during-world-cup-surge/) |
| Kalshi user age | 24% of Kalshi users under 25 (Sensor Tower), vs 7% for DraftKings and FanDuel; company-reported median age 31 | Mar 2026 | [Citizens JMP](https://citizens.bluematrix.com/docs/pdf/3beb4505-5a8b-49da-89df-ebdb104ebea9.pdf) |
| New betting-app installs, Jun 1-15, 2026 | Kalshi 42.3%, Polymarket 31.2% (iOS), DraftKings 13.7%, FanDuel 8.9% | Jun 2026 | [DeFi Rate / Apptopia, Jun 17 2026](https://defirate.com/news/kalshi-polymarket-three-quarters-betting-app-downloads-during-world-cup-surge/) |
| Kalshi plus Polymarket share of mobile DAU (sportsbooks plus prediction apps) | under 6% (Jun 2025) to about 45% (Jun 2026) | Jun 2026 | same |
| NFL Week 1 downloads | Polymarket 762K, Kalshi 592K, DraftKings 415K, FanDuel 265K | Sep 2026 | [Dimers citing Citizens, Sep 16 2026](https://www.dimers.com/industry/news/nfl-week-1-app-downloads-polymarket-kalshi) |
| Polymarket intl monthly active wallets | 580K (Jan 2026) to 594K (Jun 2026); 1.73M wallets traded in H1; about 1.13M new | H1 2026 | [TechFlow / Surf AI](https://www.techflowpost.com/en-US/article/33803) [unverified, secondary] |
| Polymarket monthly active traders (The Block chart) | 261,910 in one reading; 185,025 in the page's embedded data | chart updated Sep 28 / Oct 1, 2026 | [The Block data](https://www.theblock.co/data/decentralized-finance/prediction-markets-and-betting/polymarket-active-traders-monthly) [unverified; the two readings conflict and the covered month is unclear] |
| On-chain prediction-market wallets (Polymarket, Limitless, Opinion, predict.fun) | 840K monthly unique wallets, nearly 3x in six months | Feb 2026 | [TRM Labs](https://www.trmlabs.com/resources/blog/how-prediction-markets-scaled-to-usd-21b-in-monthly-volume-in-2026) |

Kalshi does not publish an audited user count ([Wikipedia](https://en.wikipedia.org/wiki/Kalshi)). The company figures and the app-tracker figures differ by about 2x.

#### 2.1.5 Revenue, valuation and funding (context only)

**Kalshi.**
- Series E: $1B at $11B, December 2025, led by Paradigm.
- Series F: $1B at $22B, led by Coatue, announced May 8, 2026 ([Yahoo Finance](https://finance.yahoo.com/markets/options/articles/kalshi-raises-1-billion-series-113439811.html)). Bloomberg's headline on the round is dated March 19, 2026 ([Bloomberg](https://www.bloomberg.com/news/articles/2026-03-19/kalshi-gets-1-billion-in-new-funding-at-22-billion-valuation)). Kalshi then said annualized revenue was above $1.5B, annualized volume had gone from $52B to $178B in six months, and it had more than 90% of US prediction-market activity.
- New round at about $40B: talks with Sequoia and Wellington for at least $750M were reported in August ([CoinDesk, Aug 13 2026](https://www.coindesk.com/business/2026/08/13/kalshi-in-talks-with-sequoia-wellington-for-usd750-million-fund-raise-at-usd40-billion-valuation)). Bloomberg reported the round being finalized on Sep 30, 2026 as the last before an IPO ([Bloomberg](https://www.bloomberg.com/news/articles/2026-09-30/kalshi-finalizing-new-funding-at-40-billion-value-ahead-of-ipo)). Reuters reported talks for about $1B ([The Block](https://www.theblock.co/news/business/2026-09-30-kalshi-ends-trader-incentive-program-417247)).
- Revenue run rate about $4B annualized in July 2026, versus about $1.1B for Polymarket (CoinDesk citing The Information). Sacra gives the same $4B, up from about $735M in December 2025 ([Sacra](https://sacra.com/c/kalshi/)) [unverified].
- ARK holds Kalshi in ARKK, ARKW and ARKF.

**Polymarket.**
- ICE: $1B primary plus up to $1B secondary in October 2025, then $600M in March 2026 ([Sacra](https://sacra.com/c/polymarket/)).
- About $15B valuation in April 2026 ([Yogonet](https://www.yogonet.com/international/news/2026/04/21/118679-polymarket-reportedly-in-talks-for-400m-funding-round-eyes-15b-valuation-after-recent-growth)).
- Sought more than $20B in August 2026 ([Bloomberg](https://www.bloomberg.com/news/articles/2026-08-04/polymarket-seeks-more-than-20-billion-valuation-in-funding-round), [CoinDesk](https://www.coindesk.com/markets/2026/08/04/polymarket-targets-usd20-billion-valuation-as-competition-heats-up-in-prediction-markets)).
- About $1B round at $21B led by 1789 Capital around Sep 1, 2026 ([Cryptonomist](https://en.cryptonomist.ch/2026/09/01/polymarket-funding-round/)) [unverified]. Proactive puts that at about 17.5x annualized run-rate revenue ([Yahoo Finance, Sep 25 2026](https://finance.yahoo.com/markets/crypto/articles/polymarket-gains-ground-us-weekly-150600351.html)), which implies roughly $1.2B. Sacra estimates about $1B annualized revenue in June 2026, up from $0 in 2025 [unverified].

**Rough take rate (my arithmetic).** Kalshi's $4B annualized revenue in July 2026 against about $41B × 12 ≈ $490B annualized notional is about 0.8% of notional. Against about $13.3B × 12 ≈ $160B of dollars paid it is about 2.5%. The revenue figure may include interest on customer cash.

---

### 2.2 Category shares

#### 2.2.1 Pew / The Block, January-July 2026 (notional taker volume, Kalshi combos mapped to their legs)

From [Pew, Sep 23 2026](https://www.pewresearch.org/short-reads/2026/09/23/prediction-markets-trading-volume-doubled-between-may-and-july-largely-driven-by-sports/). Sports shares are calculated from Pew's category table.

| Month 2026 | Kalshi sports | Kalshi crypto | Kalshi politics | Polymarket sports | Polymarket politics | Polymarket crypto |
|---|---|---|---|---|---|---|
| Jan | 89.2% ($8.52B) | $340M | $260M | 42.6% ($3.38B) | $2.10B | $1.82B |
| Feb | 81.7% | $793M | $298M | 39.2% | $1.96B | $2.40B |
| Mar | 76.7% | $1.21B | $195M | 44.4% | $2.55B | $2.92B |
| Apr | 77.8% | $1.36B | $205M | 46.0% | $2.49B | $1.87B |
| May | 77.2% | $1.88B | $213M | 56.9% | $1.44B | $1.33B |
| Jun | 80.6% ($26.6B) | $4.01B | $261M | 77.2% ($11.4B) | $1.26B | $1.65B |
| Jul | 78.3% ($31.4B) | $6.10B | $169M | 82.4% ($10.6B) | $727M | $1.15B |

- Kalshi politics stayed under $300M a month all year, under 1% of its volume.
- Polymarket politics averaged about $2B a month in early 2026, then fell to $727M in July.
- Crypto became Kalshi's second category ($6.1B in July). That came from 15-minute and hourly price markets, plus perps after June.
- Combined Q1 2026 sports volume (about $38.6B) roughly matched the ~$40B wagered at US legal sportsbooks in the same quarter (Pew).

#### 2.2.2 Combos (parlays) and the "sports share" debate

- Kalshi launched combos in December 2025. They were about 30% of Kalshi notional in Q2 2026 (about $20B notional on about $1.67B of handle, roughly 12:1), with an implied average probability of about 8.4% ([Sporting Crypto](https://newsletter.sportingcrypto.com/p/state-of-prediction-markets-q2-2026-report)) [unverified].
- Combos were 58% of Kalshi's September 2026 volume but under 13% of its transactions, per Dune data cited by CNBC ([CNBC, Oct 6 2026](https://www.cnbc.com/2026/10/06/prediction-market-combo-contract-volume.html)) [unverified; page returned 403, figure from search summary]. In the 30 days to Oct 6, sports made up 84% of Kalshi notional, of which combos were 61 points.
- Prediction News says combos drove 85% of Kalshi's notional growth but only 46% of taker gains in September 2026 ([Prediction News](https://predictionnews.com/story/kalshi-volume-surges-but-rivals-gain-market-share)) [unverified; page returned 403].
- DeFi Rate puts Kalshi combos at $5.3B paid over Sep 20-Oct 19, 2026, which is 28% of dollars paid. Ranking only single-leg markets by notional: sports $16.2B, crypto $10.4B, finance $1.1B (+238% on the prior 30 days), politics $261M, weather $118M, economics $77M, culture $54M, mentions $39M, tech $24M ([DeFi Rate](https://defirate.com/prediction-markets/volume/kalshi/)) [unverified]. Those singles add up to only about $28B of Kalshi's $80B 30-day notional, so roughly $50B of notional, about two-thirds, is combos. The figure is so large because combos trade at a few cents.
- In May 2026, Kalshi's general counsel said sports was "something like 70%". Dustin Gouker showed single-game sports at 61% plus combos at 26%, so 87% sports-related in the 30 days to May 12, 2026 ([The Event Horizon, May 13 2026](https://nexteventhorizon.substack.com/p/is-sports-now-only-70-percent-of-kalshi-volume)).
- Measured in dollars paid on single markets across all venues (Sep 20-Oct 19, 2026), sports is 68% ($13.8B), crypto 26% and finance 3% ([DeFi Rate aggregate](https://defirate.com/prediction-markets/volume/)) [unverified].
- Polymarket international, 30 days to Oct 19, 2026: sports 49.3%, "other" 17.8% (+188%), crypto 16.4%, politics 6.2%, world 3.6%, weather 1.7%, economics 1.4%, tech 1.1%, mentions 0.9%, finance 0.6%, culture 0.4% ([DeFi Rate](https://defirate.com/prediction-markets/volume/polymarket/)) [unverified].
- Polymarket US, same window: **sports 98.2%** ($12.3B), crypto 1.4%, everything else under 1% ([DeFi Rate](https://defirate.com/prediction-markets/volume/polymarket-us/)) [unverified]. Polymarket US added combos in August 2026 ([Crypto Briefing](https://cryptobriefing.com/polymarket-us-weekly-volume-surge/)). Combos were 51.5% of Polymarket US volume in the week of Oct 5-11, 2026, and 60.2% on Sunday, Oct 11 ([DeFi Rate](https://defirate.com/news/kalshi-hits-record-19-billion-week-as-polymarket-us-triples-fall-trade-volume/)).

#### 2.2.3 Stocks, finance and commodities (the categories closest to Probabl)

- **Polymarket international single-stock markets are small.** Allium, in an analysis prepared for Reuters, counted a bit over $220M of volume across about 31,000 equity-linked markets from October 2025 to early September 2026. About 60% of it was on single-stock moves, led by Nvidia, Alphabet, Apple and Tesla. The rest was on ETFs and indexes. Polymarket US does not list single-stock markets, because US law generally treats them as security-based swaps under the SEC. The SEC and CFTC jointly asked for comment on that boundary in June 2026 ([Finance Magnates, Sep 28 2026](https://www.financemagnates.com/fintech/220-million-across-31000-markets-polymarket-turns-stock-moves-into-yes-or-no-trades/)). That works out to about $7K per market over 11 months.
- **Kalshi finance** (index ranges, mostly S&P and Nasdaq) was $1.1B notional over Sep 20-Oct 19, 2026, up 238% on the prior 30 days ([DeFi Rate](https://defirate.com/prediction-markets/volume/kalshi/)) [unverified]. Kalshi's commodities volume passed $400M a month by September 2026. Kalshi has filed for perpetual futures on equity indexes, metals and WTI crude ([Reuters via 740 The FAN, Sep 8 2026](https://740thefan.com/2026/09/08/kalshis-400-million-plus-monthly-commodity-trade-volume-outpaces-early-crypto-growth/)). Kalshi's API changelog lists gold and silver perps priced off Pyth. It also announces, for Oct 22, 2026, handling of stock-split corporate actions on margin markets, which suggests equity-linked margin products are live or about to launch ([Kalshi API changelog](https://docs.kalshi.com/changelog)). This last point is my inference from the changelog.
- **Kalshi economics** (Fed, CPI, jobs) was only $77M in the same 30-day window (−45%). Economic markets are a thin share of volume on both venues.

#### 2.2.4 Retention by category (qualitative)

At the March 2026 Kalshi Research Conference, Kalshi's co-founders said entertainment, crypto, politics and culture show better volume-retention cohorts and faster user growth than sports. Sports was about 80% of volume then and at an all-time low share, even though its absolute volume was a record ([a16z crypto, May 29 2026](https://a16zcrypto.com/posts/article/prediction-markets-beyond-sports-betting)). No cohort tables were published, and a16z is a Kalshi investor.

---

### 2.3 Retention, cohorts, trade size, PnL and concentration

#### 2.3.1 Retention and churn

- **Polymarket international, H1 2026:** about 51-57% of monthly active wallets traded again the next month. Category-level one-month retention was about 44-49% and three-month retention about 25-32%. Wallets that started on crypto markets had about 37% one-month retention. A third of wallets traded five times or fewer in six months ([TechFlow / Surf AI](https://www.techflowpost.com/en-US/article/33803)) [unverified, secondary; computed from 787M trades].
- **Losses drive churn.** Of Polymarket accounts that lost money, 15.2% stopped trading within 30 days, against 6.1% after a win, about 2.5x ([Galaxy Research via Crypto Briefing, Oct 1 2026](https://cryptobriefing.com/galaxy-research-polymarket-retail-losses/)).
- **Older baseline:** a May 2024 Polymarket wallet cohort fell from 62.4% to 17.0% retention within three months ([Mind Virus Substack](https://mindvirusinc.substack.com/p/predicting-a-post-election-polymarket)) [unverified, 2024].
- **Kalshi:** no published retention or cohort data found. The only statement is the qualitative one in 2.4.

#### 2.3.2 Activity, trade size and trades per user

- **Pew panel** of 11,989 active Polymarket international wallets, May 7-Jun 19, 2026 ([Pew, Jul 22 2026](https://www.pewresearch.org/short-reads/2026/07/22/what-we-know-about-the-typical-polymarket-user/)):
  - Median user: 46 trades on 10 of 42 days.
  - Trade count spread: 24% made under 10 trades, 39% made 10-99, 27% made 100-999, and 11% made 1,000 or more. The 1,000+ group traded on 39 of 42 days.
  - Average trade about $6.50: sports about $9, politics about $6, crypto under $4.
  - Average spend a bit over $600 over six weeks.
  - The median user puts about three-quarters of trades in one topic, and 24% trade only one topic.
- **TRM Labs (Polymarket, Jan 1-Mar 22, 2026):** first-time traders have a median trade of $30, the most active wallets $12. Market-maker-tier wallets (10,000+ fills) made 35.2% of trades. Six wallets traded every day of an 80-day window ([TRM Labs](https://www.trmlabs.com/resources/blog/how-prediction-markets-scaled-to-usd-21b-in-monthly-volume-in-2026)).
- **Citizens JMP / Juice Reel** (cross-platform retail tracking app, July 2025-March 2026) ([Citizens JMP, Mar 23 2026](https://citizens.bluematrix.com/docs/pdf/3beb4505-5a8b-49da-89df-ebdb104ebea9.pdf)):
  - Prediction-market bets: mean $185, median $50, against a mean of $55 and median of $15 at regulated sportsbooks.
  - Median volume per person since July: $1.7K, with 77% of people under $10K.
  - Prediction-market users link an average of 6.5 betting apps, against 2.5 for others.
- **Kalshi:** about $44.67 paid per trade in fall 2026 [unverified, DeFi Rate via search summary]. One September 2026 week had 85.26M trades on $3.53B paid, about $41 per trade ([DeFi Rate](https://defirate.com/news/kalshi-2026-volume-record-15b-week/)) [unverified].

#### 2.3.3 PnL distribution

| Study | Sample | Share profitable / losing | Notes |
|---|---|---|---|
| Galaxy Research, "The Behavior of Polymarket Traders" ([Crypto Briefing, Oct 1 2026](https://cryptobriefing.com/galaxy-research-polymarket-retail-losses/); [BeInCrypto](https://beincrypto.com/polymarket-retail-traders-losses-galaxy-study/)) | about 2.9M retail accounts on Polymarket international, 2020 to Sep 2026 | **69.2% below break-even**; retail lost $338.9M in total; median retail account −$3; middle 50% from −$36.64 to +$0.40 | 125,429 accounts with more than 50 orders per active day were treated as bots. They placed 80.8% of orders and made +$246.8M. Sports specialists won 25.1% of the time, tech/science traders 41.2%. |
| Surf AI / TechFlow, H1 2026 ([source](https://www.techflowpost.com/en-US/article/33803)) [unverified] | about 1.97M wallets with settled positions | 34% positive before fees: bots 27%, pros about 42%, retail about 35% | Bots net about +$108M, pros about −$26M, retail about −$74M |
| Pew ([Jul 22 2026](https://www.pewresearch.org/short-reads/2026/07/22/what-we-know-about-the-typical-polymarket-user/)) | 11,989 wallets over six weeks | about 44% up and 56% down; 58% within ±$100; 7% made more than $1K, 9% lost more than $1K | The most active users lost more than $1K 33% of the time and made more than $1K 27% of the time |
| Citizens JMP / Juice Reel ([Mar 23 2026](https://citizens.bluematrix.com/docs/pdf/3beb4505-5a8b-49da-89df-ebdb104ebea9.pdf)) | retail users with 10+ trades, cross-platform | median ROI −8% on prediction markets vs −5% on sportsbooks | Only users with more than $500K volume were positive (+2.6% median). Users under $100 volume: −26.8% |
| Bloomberg analysis, May 2026 ([MEXC summary](https://www.mexc.com/news/1061296)) [unverified] | about 2M Polymarket addresses | more than 100K accounts lost over $1K; about $131M of retail losses | Profits concentrated in early-entry bots |

**Longshots.** Bloomberg (Oct 7, 2026) found that bets losing about 98% of the time make up roughly half of Kalshi's volume and 52% of Polymarket activity over 21 months. Yes-side buyers lost 15% on average on Kalshi and 27% on Polymarket. Polymarket disputed the definition and said longshots are about 1% of its volume ([Prediction News summary](https://predictionnews.com/story/longshot-bets-losing-98-of-time-dominate-trading-on-kalshi-and-polymarket); [Gambling.com](https://www.gambling.com/us/news/longshot-bets-dominate-kalshi-polymarket-despite-losses)) [unverified; Bloomberg original not retrieved]. Bürgi, Deng and Whelan studied 46,282 Kalshi contracts from 2021 to April 2025. Buyers of contracts under 10 cents lost over 60% of their money, average returns were about −20%, and makers earned more than takers ([UCD working paper](https://www.ucd.ie/economics/t4media/WP2025_19.pdf); [GWU version](https://www2.gwu.edu/~forcpgm/2026-001.pdf)).

#### 2.3.4 Whale and bot concentration

- **Polymarket international, H1 2026:**
  - About 6% of high-activity wallets made about 80% of taker volume.
  - The top 0.3% of takers made about 63% of volume.
  - Bot-like wallets were about 5.9% of users (about 102K) and drove about $11.9B of volume, against about $4.1B from about 1.54M retail wallets ([TechFlow / Surf AI](https://www.techflowpost.com/en-US/article/33803)) [unverified].
- **Polymarket politics, Dec 2025-Feb 2026:** 0.55% of profitable maker wallets took 50% of maker gains, and 0.26% of winning taker wallets took about the same share. Each cohort got about $8M of about $16M total profit (Solidus Labs) ([CoinDesk, Apr 29 2026](https://www.coindesk.com/markets/2026/04/29/a-tiny-group-is-winning-on-polymarket-as-under-1-of-wallets-take-half-the-profits)).
- **Galaxy:** about 4% of accounts (bots) placed 80.8% of orders ([BeInCrypto](https://beincrypto.com/polymarket-retail-traders-losses-galaxy-study/)).

---

### 2.4 Fees

#### 2.4.1 Polymarket (international) in 2026

Polymarket charged no trading fees from 2020 through 2025 ([Sacra](https://sacra.com/c/polymarket/)). In 2026 it moved step by step to taker fees on almost everything. Timeline from the [Polymarket changelog](https://docs.polymarket.com/changelog):

| Date (2026) | Change |
|---|---|
| Jan 5 | Taker fees on 15-minute crypto markets, rate varying with price; daily USDC maker rebates paid from those fees |
| Feb 12 | 5-minute crypto markets launched with the same fee curve, peaking at 1.56% at a 50% price |
| Feb 18 | Taker fees on NCAAB and Serie A markets; rebates now computed per market |
| Mar 6 | Fees and rebates extended to all new crypto markets (1-hour, 4-hour, daily, weekly) |
| Mar 30 | **Fee Structure V2**: per-category rates across crypto, sports, finance, politics, economics, culture, weather, tech, mentions and other. Geopolitics and world events stay fee-free |
| Apr 28 | CLOB V2: fees set at match time; orders no longer carry `feeRateBps` |
| Jul 10 | Sports taker rate raised from 0.03 to 0.05; sports maker rebate cut from 25% to 15% of fees |
| Aug 17 / Sep 4 | Crypto taker delay cut from 250ms to 50ms, then raised to 150ms (a latency rule, not a fee) |

Current schedule ([Polymarket fees docs](https://docs.polymarket.com/trading/fees.md)): fee = C × feeRate × p × (1 − p), paid by takers only. Makers pay nothing.

| Category | Taker feeRate | Fee per 100 shares at p = 0.50 | Maker rebate (share of taker fees) |
|---|---|---|---|
| Crypto | 0.07 | $1.75 | 20% |
| Sports | 0.05 | $1.25 | 15% |
| Economics, Culture, Weather, Other | 0.05 | $1.25 | 25% |
| Finance, Politics, Mentions, Tech | 0.04 | $1.00 | 25% |
| Combos | 0.05 | $1.25 | 0% |
| Geopolitics | 0 | $0 | n/a |

Third-party trackers say NFL and college football game markets moved to a lower 0.03 rate in October 2026 and that older sports markets keep the legacy 0.03 rate with a 25% rebate ([startpolymarket](https://startpolymarket.com/tools/fee-calculator/), [polymarkettrader](https://polymarkettrader.com/tools/polymarket-fees/)) [unverified; not in the official docs I read]. Fees apply per market from that market's `feeSchedule`, so markets created before a change can keep older terms.

Polymarket Perps (beta) has a separate tiered schedule: taker 0.040% to 0.020% and maker 0.0125% to −0.005% by 30-day volume ([Polymarket perps fees](https://docs.polymarket.com/perps/learn-about-trading/fees.md)).

#### 2.4.2 Polymarket US

Sources conflict. [Sacra](https://sacra.com/c/polymarket/) gives a 0.05 taker coefficient with a −0.0125 maker rebate, capped at $1.25 per 100 contracts at 50 cents, effective April 3, 2026. A secondary review says the coefficient rose to 0.06 on July 1, 2026 after increases in January and March ([altstreet, search summary](https://altstreet.investments/platforms/reviews/polymarket)) [unverified]. An earlier notice described a 0.01% taker fee on total contract premium ([KuCoin flash](https://www.kucoin.com/news/flash/polymarket-us-announces-0-01-taker-fee-on-total-contract-premium)) [unverified, probably the launch-period schedule]. I could not reach an official Polymarket US fee page; polymarket.us/fees is a sign-up page.

#### 2.4.3 Kalshi

- **Taker:** round up(0.07 × C × P × (1 − P)), with a peak of $1.75 per 100 contracts at 50 cents. S&P and Nasdaq index markets are charged at half rate ([Navnoor Bawa, citing the fee-schedule filing](https://www.navnoorbawaresearch.com/p/kalshi-publishes-one-liquidity-subsidy)) [secondary].
- **Maker:** round up(0.0175 × C × P × (1 − P)), applied only to series Kalshi lists as maker-fee series.
- **Schedule:** the current fee-schedule PDF is effective July 7, 2026. As of Oct 10, 2026, 126 series charged maker fees, including Fed rate, CPI, jobs, GDP and NFL and NBA games, and 13 series charged no fees ([QuantVPS, Oct 19 2026](https://www.quantvps.com/blog/kalshi-fees-explained)) [unverified; the Kalshi PDF returned HTTP 429].
- **2026 changes to combos fees** ([Kalshi API changelog](https://docs.kalshi.com/changelog)):
  - Aug 20: combos built only from independent NFL games carry no maker fee.
  - Aug 20-21: maker fees switched on for combo RFQs. A quoter who hits an order that has rested for under five seconds pays a maker fee at a 0.5 multiplier (normally 0.25), and the resting side pays the taker fee.
  - Sep 3: finer combo ticks ($0.0001 below 1 cent and above 99 cents).
- **Perps:** launched June 3, 2026. Sacra describes them as zero-fee at launch [unverified]. By September there were margin fee tiers (`/margin/fee_tier_rates`) and margin maker/taker volume incentives.
- Kalshi pays interest on idle cash, up to 4.05% a year, and its Klear clearinghouse pays 3.25% APY on eligible holdings, launched March 2026 ([Sacra](https://sacra.com/c/kalshi/)) [unverified].

---

### 2.5 Market makers and liquidity incentives

#### 2.5.1 Polymarket

- **Liquidity Rewards** ([docs](https://docs.polymarket.com/programs/liquidity-rewards.md)):
  - Resting orders are scored quadratically by distance from the midpoint, within a per-market max spread and minimum size.
  - Two-sided quotes earn the most. One-sided quotes earn a reduced rate when the midpoint is between 0.10 and 0.90.
  - The book is sampled every minute and paid daily at midnight UTC, with a $1 minimum.
  - Example pools: March Madness 2026 paid over $2M. A full-game moneyline got $60K a day while live, orders had to rest at least 3.5 seconds, and pre-game pools were $7.5K a day ([changelog](https://docs.polymarket.com/changelog)). An August 2026 crypto TWAP program paid $1M ($550K on 5-minute, $350K on 15-minute and $100K on 4-hour markets) and has ended.
- **Maker Rebates** ([docs](https://docs.polymarket.com/programs/maker-rebates.md)): paid from taker fees, daily in pUSD. Crypto gets 20%, sports 15% and other fee categories 25%. Rebates are weighted along the same fee curve and computed per market.
- **Holding Rewards:** 3.25% simple annual rate on position value, sampled hourly and paid daily. It covers 18 long-dated events (2028 presidential, 2026 midterms, "out before 2027" leaders, Russia-Ukraine ceasefire, 2026 crypto price targets). It is funded by the treasury and the rate is variable ([Polymarket help, Jun 1 2026](https://help.polymarket.com/en/articles/13364459-holding-rewards)). It was 4% in 2025, which I did not re-verify. Polymarket says a new reward and oracle-resolution system is coming "later this year".
- **Polymarket US Market Incentive Program:** filed Mar 5, 2026. Rebate rates and caps are confidential "in perpetuity" and can change on seven days' notice ([Navnoor Bawa](https://www.navnoorbawaresearch.com/p/kalshi-publishes-one-liquidity-subsidy)) [secondary, citing the filing].
- **Combos use RFQ:** market makers have 400ms to quote, the user has 10 seconds to accept, and there is an optional 1-second last look ([combos docs](https://docs.polymarket.com/trading/combos/overview.md)).

#### 2.5.2 Kalshi

| Program | Terms | Status in 2026 |
|---|---|---|
| **Liquidity Incentive Program** (Aug 2025) | Applies to all markets. The book is snapshotted each second. Bids are scored as Discount Factor^(ticks from reference price) × size, with target sizes from 100 to 20,000 contracts. Rewards are $1 to $1,000 per market per day | Amended Jul 15, 2026, effective Jul 30, and extended to Jan 1, 2027. The amendment **dropped the exclusion of Market Maker Agreement holders and Kalshi affiliates**, scaled pay by the share of snapshots with two-sided depth, and cut the minimum reward from $10 to $1 ([CFTC filing, Jul 15 2026](https://www.cftc.gov/filings/orgrules/rules07152610358.pdf)) |
| **Volume Incentive Program** (since Mar 2023) | Pays from pools in proportion to eligible CLOB volume at 3 to 97 cents. Caps reported at $0.005 per contract and $1,000 per market per day. MM-agreement holders excluded | Sep 28, 2026 filing ends it **no earlier than Oct 13, 2026**, amid wash-trading allegations ([The Block, Sep 30 2026](https://www.theblock.co/news/business/2026-09-30-kalshi-ends-trader-incentive-program-417247); [CFTC filing Sep 28 2026](https://www.cftc.gov/filings/orgrules/rules09282630083.pdf)) |
| **Liquidity Provider Program** (May 4, 2026, to Dec 2027) | Only for members with a Market Maker Agreement. Pay is set by bids of the minimum reward each provider will accept (a "reverse auction"). Capped at $50K per series per week. Designated Liquidity Provider selection is in a confidential appendix | [Navnoor Bawa](https://www.navnoorbawaresearch.com/p/kalshi-publishes-one-liquidity-subsidy) [unverified, secondary reading of the filing] |
| **Market Maker Program / MM Agreement** | Lower fees and adjusted position limits in exchange for two-sided quotes and 98% uptime per hour (one guide's description). Payment terms confidential | ongoing ([Turbine guide](https://www.turbinefi.com/blog/how-to-market-make-prediction-markets-2026)) [unverified] |
| **Maker rebates** | "Up to 1%, capped at $7,000 per week" | [Sacra](https://sacra.com/c/kalshi/) [unverified] |
| Margin (perps) incentives | API supports `margin_maker_volume` and `margin_taker_volume` programs with per-account caps (Aug 27 and Sep 10, 2026) | [Kalshi changelog](https://docs.kalshi.com/changelog) |

**Kalshi's response to the wash-trading claims.** Kalshi said the repeated ether-perp prints, many identical trades of about $5,500, came from its liquidity incentive program and from market makers posting fixed quotes that faster traders hit. It said it is not under CFTC investigation ([CoinDesk, Sep 23 2026](https://www.coindesk.com/markets/2026/09/23/kalshi-says-it-is-not-being-investigated-by-the-cftc-over-trading-activity)). On Aug 12, 2026, CFTC staff (DMO Letter 26-23) warned exchanges that steep-tier volume rewards can encourage wash trading and asked them to review incentive filings by Sep 14, 2026 ([Navnoor Bawa](https://www.navnoorbawaresearch.com/p/kalshi-publishes-one-liquidity-subsidy)) [secondary].

#### 2.5.3 Who makes markets

- **Susquehanna (SIG):** Kalshi's first institutional market maker (April 2024) and still described as its flagship maker ([Tradermath](https://www.tradermath.org/articles/prediction-markets-trading-at-quant-firms)) [unverified].
- **Jump Trading:** takes equity in exchange for liquidity. The Kalshi stake is fixed. The Polymarket stake grows with the capacity Jump supplies to Polymarket US. Jump has about 20 staff on the business ([CoinDesk citing Bloomberg, Feb 10 2026](https://www.coindesk.com/business/2026/02/10/jump-trading-to-take-small-stakes-in-polymarket-kalshi-bloomberg)).
- **Wintermute:** began two-sided quoting on Polymarket and Kalshi in late May 2026 ([Bitcoin Foundation news](https://bitcoinfoundation.org/news/prediction-markets/wintermure-enters-prediction-markets/)) [unverified].
- **DRW, Jane Street, IMC:** reported to be building prediction-market desks ([Tradermath](https://www.tradermath.org/articles/prediction-markets-trading-at-quant-firms); [KuCoin](https://www.kucoin.com/news/flash/major-trading-firms-expand-into-prediction-markets)) [unverified].
- **Kalshi Trading LLC**, a Kalshi affiliate, has participated in incentive programs since 2023 ([Navnoor Bawa](https://www.navnoorbawaresearch.com/p/kalshi-publishes-one-liquidity-subsidy)) [secondary].
- **Galaxy** launched an institutional OTC desk for prediction markets on Jun 2, 2026 [unverified, search summary only].
- **Robinhood:** said to account for more than half of Kalshi's volume ([Sacra](https://sacra.com/c/kalshi/), undated) [unverified]. Robinhood launched its own exchange, Rothera, in June 2026, and 98% of Rothera's Q2 volume was World Cup ([Sporting Crypto](https://newsletter.sportingcrypto.com/p/state-of-prediction-markets-q2-2026-report)) [unverified]. Rothera had about 1% of tracked volume over Sep 20-Oct 19, 2026 ([DeFi Rate](https://defirate.com/prediction-markets/volume/)).

---

### 2.6 Controversies that matter when copying markets

#### 2.6.1 Wash trading

- **Columbia (Sirolly, Ma et al., Nov 6 2025):** about 25% of Polymarket's volume over three years looked like wash trading. The share peaked near 60% of weekly volume in December 2024, fell below 5% in mid-2025 and was back to about 20% by early October 2025. By category: sports 45%, elections 17%, politics 12%, crypto 3% ([Fortune](https://fortune.com/2025/11/07/polymarket-wash-trading-inflated-prediction-markets-columbia-research); [paper PDF](https://gamblingharm.org/wp-content/uploads/2025/11/Polymarket-Wash-Trading-Study.pdf)). It was not peer-reviewed.
- **2026 follow-ups:**
  - Dubach (arXiv 2604.24366, Apr-May 2026) studied 600 Polymarket markets over 52 days of tick data. The median self-counterparty wash share was about 1%, with an upper tail of 22% ([arXiv](https://arxiv.org/abs/2604.24366)).
  - Solidus Labs (April 2026) found about 15% of volume in some Polymarket markets matched self-trading or economically neutral patterns ([CoinDesk](https://www.coindesk.com/markets/2026/04/29/a-tiny-group-is-winning-on-polymarket-as-under-1-of-wallets-take-half-the-profits)).
- **Kalshi, September 2026:** identical trade sizes dominated its BTC and ETH perps. Trades of exactly $5,500 were 48-58% of ETH-perp notional on four days, and one day had $539M of volume against $3.1M of open interest ([CoinDesk, Sep 23 2026](https://www.coindesk.com/markets/2026/09/23/kalshi-says-it-is-not-being-investigated-by-the-cftc-over-trading-activity)). The WSJ reported that the CFTC was examining the data, and Kalshi denies wash trading. Kalshi then moved to end its Volume Incentive Program (2.5.2).
- **Takeaway:** headline volume on both venues includes incentive-driven and self-matched flow. Copying "the most traded markets" by notional overweights markets with subsidies, bots or parlays.

#### 2.6.2 Insider trading

| Case | Facts | Source |
|---|---|---|
| **Van Dyke (Maduro operation)**, SDNY plus CFTC, unsealed Apr 23, 2026 | Active-duty Army servicemember allegedly used classified information about the operation that captured Maduro. He bought about $33K of Polymarket contracts and made about $410K. **First CFTC insider-trading charge involving event contracts.** Pending as of July 2026 | [Debevoise, Apr 2026](https://www.debevoise.com/insights/publications/2026/04/polymarket-insider-trading-charges-illustrate-doj); [Dentons](https://www.dentons.com/en/insights/alerts/2026/april/27/doj-and-cftc-bring-first-of-its-kind-prediction-market-insider-trading-case) |
| **Spagnuolo (Google "Year in Search")**, SDNY plus CFTC, May 27, 2026 | Google engineer charged with commodities fraud, wire fraud and money laundering for trading at least 23 Polymarket contracts on internal search-ranking data. About $1.2M profit. First case built on corporate rather than government information | [Debevoise, Jun 2026](https://www.debevoise.com/insights/publications/2026/06/doj-and-cftc-bring-first-ever-prediction-markets); [Sidley](https://whitecollarwatch.sidley.com/2026/06/12/prediction-market-insider-trading-revisited-technology-employee-charged-with-using-confidential-corporate-information-to-profit-from-event-contracts/) |
| **George Santos**, CFTC settlement Jul 31, 2026 | $17,500 civil penalty, $17,569.98 disgorgement and a 3-year trading ban. Kalshi then gave him its first lifetime ban, Aug 31, 2026. One outlet reports a separate Kalshi fine of $71,356, which I could not reconcile | [Axios, Jul 31 2026](https://www.axios.com/2026/07/31/george-santos-kalshi-prediction-market-cftc); [CNN, Aug 31 2026](https://www.cnn.com/2026/08/31/politics/george-santos-kalshi-ban) |
| **Kalshi in-house enforcement, Feb 2026** | A California governor candidate who traded about $200 on himself got a 5-year ban. A MrBeast employee got a 2-year suspension and a $20,397.58 penalty | [Axios, Feb 25 2026](https://www.axios.com/2026/02/25/kalshi-insider-trading-suspension); [Fortune](https://dc.fortune.com/2026/02/25/kalshi-fines-mrbeast-employee-20000-for-insider-trading-related-to-youtube-stream) |
| **Kalshi in-house enforcement, Apr 22, 2026** | Three candidates traded on their own primaries (MN-2, TX-21, VA Senate). Fines of $539.85, $784.20 and $6,229.30, each with a 5-year suspension. Kalshi now pre-emptively blocks candidates from trading their own races | [Kalshi, Apr 22 2026](https://news.kalshi.com/p/kalshi-political-insider-trading-enforcement-update) |
| **Iran-strike wallets, Feb 2026** | Four Polymarket wallets turned about $40K into $872K on "US strike Iran" markets. TRM says this "does not prove insider trading" | [TRM Labs](https://www.trmlabs.com/resources/blog/how-prediction-markets-scaled-to-usd-21b-in-monthly-volume-in-2026) |

The CFTC's enforcement director named prediction-market insider trading a top priority in March 2026 ([Blank Rome](https://www.blankrome.com/news-and-events/insider-trading-meets-prediction-markets-federal-enforcers-put-the-industry-on-notice/)). Rep. Ritchie Torres introduced a bill after the Maduro trade ([Torres press release](https://ritchietorres.house.gov/posts/in-response-to-suspicious-polymarket-trade-preceding-maduro-operation-rep-ritchie-torres-introduces-legislation-to-crack-down-on-insider-trading-on-prediction-markets)). For Probabl, conditional markets keyed on corporate or Fed events carry the same insider risk as the Google case.

#### 2.6.3 Resolution disputes (Polymarket / UMA)

- **WSJ investigation (May 17, 2026):**
  - At least 60% of active UMA voters over the past year were linked to Polymarket trading accounts.
  - Voters held positions in more than 300 disputed markets.
  - Nearly 20% of disputed outcomes involved voters with stakes in the market.
  - In most votes the top ten wallets controlled over half the voting power.
  - Polymarket says 0.2% of markets go to a UMA vote.
  - Sources: [KuCoin summary](https://www.kucoin.com/news/flash/polymarket-dispute-resolution-system-under-scrutiny-as-uma-voting-raises-fraud-concerns); [Crypto Briefing](https://cryptobriefing.com/polymarket-dispute-resolution-scrutiny/) [secondary; WSJ original not retrieved].
- **Dispute volume:** Betmoar counts more than 1,150 disputes in 2026 by mid-May, already more than all of 2025 [unverified].
- **2026 cases:**
  - *Israel-Hezbollah ceasefire* (April 2026): 87% of voters ruled that an Israel-Lebanon ceasefire counted. The Iran ceasefire dispute involved over $280M of volume.
  - *Strategy bitcoin sale by May 31, 2026*: resolved No with 98.6% of the vote, even though a filing showed 32 BTC sold May 26-31 [unverified, secondary].
  - *Clavicular pregnancy announcement*.
  - UMA.rocks dropped a voter ("Scout") in late April after he admitted betting on a dispute he voted on.
  - Sources: [KuCoin](https://www.kucoin.com/news/flash/polymarket-dispute-resolution-system-under-scrutiny-as-uma-voting-raises-fraud-concerns); [crypto.news](https://crypto.news/how-prediction-markets-resolve-uma-optimistic-oracle/).
- **Polymarket's response:** Shayne Coplan acknowledged the mechanism's weaknesses in March 2026 and said "optimizations are imminent". The June 2026 holding-rewards page promises a new oracle-resolution system "later this year" ([Polymarket help](https://help.polymarket.com/en/articles/13364459-holding-rewards)).
- **Earlier reference cases:** the 2025 Zelensky-suit market (about $200M) is described at [Vibe Trading](https://vibetrading.substack.com/p/zelensky-suit) [unverified]. The March 2025 Ukraine minerals-deal resolution and other 2025 cases (government shutdown, "Jesus returns") were not re-checked in this pass [unverified, no source retrieved].
- **Lawsuits:** several individual and class suits against Polymarket were filed in 2026 (*Diego* lead consolidated case; *Wood* in N.Y. Sup. Ct., Jul 6; *NACA* in D.C., Jun 26; *Barrionuevo* in N.D. Ill., Jul 31). Their grounds are not stated on the tracker ([DeFi Rate legal tracker](https://defirate.com/prediction-markets/legal/)).
- **Takeaway for copying markets:** contract wording, data source and edge cases (death, "formal statement", partial ceasefires) decide outcomes. Contracts with an objective oracle source, such as a stock closing price, avoid most of these fights.

#### 2.6.4 State fights over sports contracts and the CFTC's 2026 stance

Status from the [DeFi Rate legal tracker](https://defirate.com/prediction-markets/legal/) (captured Oct 18, 2026), [CNBC](https://www.cnbc.com/2026/09/25/appeals-court-rules-states-can-regulate-sports-prediction-markets.html), [SBC Americas](https://sbcamericas.com/2026/09/25/kalshi-sixth-circuit-sides-oh-tn/) and [Sportico](https://www.sportico.com/law/analysis/2026/kalshi-circuit-split-scotus-1234945840/):

| Forum | Outcome | Date |
|---|---|---|
| 3rd Cir. (New Jersey) | **For Kalshi**, 2-1, preliminary injunction: federal law likely preempts | Apr 6, 2026 |
| 9th Cir. (Nevada) | **Against Kalshi**, 3-0: sports contracts are not swaps. En banc petition filed Sep 9 | Aug 28, 2026 |
| 6th Cir. (Ohio, Tennessee) | **Against Kalshi**, 3-0: no swap shown, and even if they were swaps the CEA does not preempt state gambling law. Tennessee injunction vacated. Rehearing petition filed Oct 9 | Sep 25, 2026 |
| 4th Cir. (Maryland) | Argued May 7, 2026. No decision yet | pending |
| Massachusetts (Appeals Court and SJC) | Pending. A related federal Novig case is stayed until the SJC rules | pending |
| 2nd Cir. (New York) | Kalshi appeal pending. The CFTC filed an amicus brief for Kalshi. CFTC v. New York PI motion pending | pending |
| **Supreme Court** | New Jersey's petition, *KalshiEX v. Flaherty* No. 26-299, filed Sep 2. 39 states filed amicus briefs (Oct 6-8). Kalshi's response is due Nov 9, 2026. Robinhood and Crypto.com (NADEX) petitions on the Nevada ruling. None granted yet ([SCOTUS docket PDF](https://www.supremecourt.gov/DocketPDF/26/26-299/428759/20261007134816267_Kalshi%20Cert%20Amicus.pdf); [CryptoTimes, Oct 8 2026](https://www.cryptotimes.io/2026/10/08/39-states-urge-supreme-court-to-review-kalshi-sports-betting-dispute/)) | pending |
| Arizona criminal charges | 20 misdemeanor counts against KalshiEX and Kalshi Trading, filed Mar 16, 2026. Prosecution enjoined Jun 4 | enjoined |
| Minnesota | First state to outlaw prediction markets: a felony for operators, signed May 19, 2026. The CFTC, Kalshi and Polymarket sued, and a federal judge granted a preliminary injunction on Jul 27, 2026 ([MPR News](https://www.mprnews.org/story/2026/07/27/minnesota-ban-on-kalshi-polymarket-prediction-markets-put-on-hold-by-federal-judge); [Minnesota Reformer](https://minnesotareformer.com/2026/05/19/minnesota-becomes-first-state-to-outlaw-prediction-markets-immediately-sued-by-federal-regulators/)) | enjoined |

**CFTC stance in 2026.** The CFTC sides firmly with the exchanges against the states.
- Chair Michael Selig announced a prediction-markets rulemaking in January 2026.
- In February 2026 the CFTC withdrew the 2024 proposal that would have banned these contracts, and the 2025 staff advisory.
- It published an advance notice of proposed rulemaking in March 2026 and a proposed rule focused on sports contracts in June 2026 ([Sidley](https://www.sidley.com/en/insights/newsupdates/2026/02/us-cftc-signals-imminent-rulemaking-on-prediction-markets); [Norton Rose](https://www.nortonrosefulbright.com/en-us/knowledge/publications/fed865b0/cftc-advances-regulatory-framework-for-prediction-markets)).
- It sued Arizona, Connecticut and Illinois in April 2026, then New York and others. CNBC counts nine states sued ([CFTC release 9206-26](https://www.cftc.gov/PressRoom/PressReleases/9206-26); [CFTC release 9218-26](https://www.cftc.gov/PressRoom/PressReleases/9218-26)).
- 44 attorneys general told the CFTC on Jul 28, 2026 that it lacks authority over sports contracts ([CNBC](https://www.cnbc.com/2026/07/28/44-states-say-cftc-has-no-authority-over-sports-prediction-markets.html)).
- The CFTC stayed a Kalshi emergency rule on Jul 14, 2026 and ordered it to honor open trades involving Michigan residents ([DeFi Rate legal tracker](https://defirate.com/prediction-markets/legal/)).

**Outside the US.** Brazil's National Monetary Council barred event derivatives on sports, politics and entertainment, and the government blocked 27 sites including Polymarket and Kalshi. The block was announced Apr 24, 2026 and took effect around May 4 ([Bloomberg](https://www.bloomberg.com/news/articles/2026-04-24/brazil-moves-to-ban-prediction-markets-on-elections-sports); [The Paypers](https://thepaypers.com/fraud-and-fincrime/news/brazil-bans-prediction-markets-and-blocks-27-platforms-including-polymarket-and-kalshi)). Argentina, Colombia, France, Hungary and Portugal also restrict these platforms.

#### 2.6.5 Polymarket US re-entry status

1. Polymarket bought QCEX (CFTC-designated) for $112M in July 2025. It received a CFTC no-action letter in September 2025 and an Amended Order of Designation in November 2025 ([Sacra](https://sacra.com/c/polymarket/)).
2. The US exchange began trading in December 2025 by invite. The iOS waitlist was removed on May 12, 2026 ([Covers](https://www.covers.com/industry/polymarket-removes-waitlist-launches-for-american-ios-users-may-12-2026)). Android availability is disputed between sources.
3. Combos were added in August 2026. US volume passed international volume in September 2026 ([Crypto Briefing](https://cryptobriefing.com/polymarket-us-weekly-volume-surge/)).
4. Polymarket US has about 12% of tracked US volume (BofA, regulatory filings) and led US app downloads in September 2026 ([Yahoo Finance, Sep 25 2026](https://finance.yahoo.com/markets/crypto/articles/polymarket-gains-ground-us-weekly-150600351.html)).
5. QCX is in state litigation in Michigan (6th Cir. appeal), New Mexico, Massachusetts, Minnesota and Wisconsin. Nevada is pursuing enforcement against the offshore entity ([DeFi Rate legal tracker](https://defirate.com/prediction-markets/legal/)).

---

### 2.7 What this means for Probabl (short)

1. **Daily habit is driven by sports and short-dated crypto, not by long-dated event markets.**
   - Polymarket US is 98% sports.
   - On Kalshi, single sports plus combos are about 80-90% of notional, and crypto (15-minute and hourly markets, plus perps) is the second engine.
   - Kalshi says politics, culture and crypto retain better than sports, but they are a small share of volume.
   - Stock-linked event markets so far are small: about $220M across 31K Polymarket equity markets in 11 months; Kalshi finance at about $1.1B per 30 days.
2. **Headline volume is a poor guide to demand.**
   - Kalshi buyers pay 23-29 cents per $1 of notional.
   - Combos make up about 60-70% of Kalshi notional but under 13% of trades.
   - Longshots are about half of activity, and Polymarket's history includes 1-25% wash trading.
   - Any "copy the top markets" plan should rank by dollars paid, trades and unique traders, not notional.
3. **Retail mostly loses, and losers churn.**
   - About 69% of Polymarket retail accounts are below break-even.
   - After a loss, 15.2% quit within 30 days, against 6.1% after a win.
   - About 5-6% of wallets (bots and pros) make about 80% of taker volume.
   - Holding retail daily means keeping loss rates tolerable (tight spreads, low fees on retail-sized trades) and paying makers to stay in the book.
4. **Incentive design is under the regulator's eye.** The CFTC's August 2026 staff letter and Kalshi's exit from volume rewards point toward depth-based rewards (Kalshi's LIP, Polymarket's quadratic rewards) and rebates paid from fees, and away from pure volume rewards.
5. **Fees moved up across the board in 2026.** Polymarket went from zero to 0.04-0.07 × p(1−p) on takers, and Kalshi stayed at 0.07 with maker fees on 126 series. Probabl's per-market fees have room to sit below these.

---

### Gaps and unverified leads

The shared web-search budget ran out mid-task. These items were not checked against primary sources:

- **Leads not confirmed against a primary source:**
  - CNN, Aug 28, 2026: young adults aged 18–21 traded an estimated $5.4B on Kalshi so far in 2026 ([CNN](https://www.cnn.com/2026/08/28/business/young-adults-trading-kalshi); the page returned HTTP 451, so the figure comes from a search summary) [unverified]. A related headline on Finance Magnates mentions a "$5.4 billion" Kalshi trader-volume story ([source](https://www.financemagnates.com/fintech/220-million-across-31000-markets-polymarket-turns-stock-moves-into-yes-or-no-trades/)).
  - SCCG, citing Blask: August 2026 Kalshi $37.17B vs Polymarket (international plus US) $8.16B ([SCCG, Sep 30 2026](https://sccgmanagement.com/sccg-articles/2026/09/30/polymarket-retains-lead-in-branded-search-demand-for-us-prediction-markets-while-kalshi-commands-trading-volume/)) [secondary]. This sits close to DeFi Rate's $40.0B for Kalshi and $8.8B for Polymarket International plus US in August.
- **Official sources I could not reach:** Kalshi's fee-schedule PDF (HTTP 429), Polymarket US's official fee page, and the full Bloomberg longshot article, WSJ UMA investigation and CNBC combos article (paywalled or 403).
- **Not checked:**
  - Kalshi's own 2026 settlement disputes (for example how it handled "Khamenei out" or "Maduro out" markets after the February and January 2026 events).
  - Fourth Circuit and Massachusetts SJC rulings after Oct 18, 2026.
  - Whether Kalshi's Volume Incentive Program actually ended on or after Oct 13, 2026.
  - Kalshi monthly active users from a primary source.
  - The current Polymarket monthly active trader count. The Block's chart readings conflict.

---

## 3. Short-term products on Polymarket and Kalshi, in depth

Scope: 5-minute to daily crypto up/down markets, short-term stock and index markets, live sports, weather, mentions, and combos (parlays) on Polymarket (international and Polymarket US) and Kalshi. These are working notes for Probabl, written in plain prose with a source on every claim.

How to read the numbers:
- "Face volume" means contracts counted at $1 each. Kalshi reports volume this way, and so do DeFi Rate and ticker-tracker.
- "Dollars paid" or "turnover" means contracts times the price traded.
- Face volume overstates cash heavily for cheap contracts. The worst case is combos priced at fractions of a cent.
- Polymarket's own "volume" field in its gamma API comes out at roughly 2x the one-sided turnover that CryptoStruct measures for the same markets. On Oct 19, 2026, BTC 5m showed gamma $11.5M against CryptoStruct's estimated $5.6M, and BTC 15m showed $2.75M against $1.5M. I treat gamma figures as Polymarket-reported volume, not cash.
- [unverified] marks weak, secondary or aggregator sources, and figures I could not confirm.
- Gap: the shared web-search budget ran out partway through. Some items rely on fetched primary pages and public APIs rather than a fresh search. Remaining gaps are marked.

---

### 3.A Polymarket

#### 3.A1 Crypto "Up or Down" family: 5-minute, 15-minute, hourly, 4-hour, daily

**What it is.** Each market asks whether an asset's price at the end of a fixed window is at or above its price at the start. "Up" wins ties. Winning shares pay $1. A new market opens as soon as the last one closes: 288 per day for 5-minute markets and 96 per day for 15-minute markets (https://www.bitget.com/news/detail/12560605256967 [secondary, BlockBeats]; https://defirate.com/prediction-markets/crypto/).

The assets live on polymarket.com on 2026-10-20 were BTC, ETH, SOL, XRP, DOGE, BNB and HYPE for 5-minute and 15-minute markets. The crypto navigation showed 7 markets each in 5 Min, 15 Min and 4 Hours, 9 in 1 Hour and 11 in Daily (https://polymarket.com/crypto/5M; https://polymarket.com/crypto/hourly; https://polymarket.com/crypto/daily). HYPE 5-minute and 15-minute series exist in the gamma API (https://gamma-api.polymarket.com/series?slug=hype-up-or-down-5m).

**Launch timeline.** Dates marked "gamma API" are the first event or series dates I found in Polymarket's public gamma API. They show when markets first existed, not necessarily the public announcement.
- Daily BTC up/down: the series object was created 2023-03-14 (gamma API, https://gamma-api.polymarket.com/series?slug=btc-up-or-down-daily). It resolves on the Binance BTC/USDT 1-minute candle close at noon ET against the previous day's noon close (https://gamma-api.polymarket.com/events?slug=bitcoin-up-or-down-on-october-19-2026).
- Hourly BTC up/down: the first events were for the 1 AM ET candle on 2025-05-28, created 2025-05-27 (gamma API, series id 10114). ETH, SOL and XRP hourly series were created 2025-06-09. They resolve on the Binance BTC/USDT 1-hour candle, close at or above open (https://gamma-api.polymarket.com/events?slug=bitcoin-up-or-down-october-19-2026-2pm-et; https://polymarket.com/event/bitcoin-up-or-down-october-20-2026-2am-et).
- 15-minute: Polymarket announced on 2025-09-12 that it would use Chainlink Data Streams for fast price data and Chainlink Automation for onchain settlement at preset times, live on Polygon (The Block, https://www.theblock.co/post/370444/polymarket-turns-to-chainlink-oracles-for-resolution-of-price-focused-bets). Chainlink's own post said the partnership was "to launch new 15-minute markets" (https://x.com/chainlink/status/1966502945173717409 [search snippet only, X page not fetched]). The first BTC 15m events in the gamma API are dated 2025-09-12 (series id 10192). SOL and XRP 15m followed on 2025-10-20 and 2025-10-27 (gamma API). One press report dates the public launch to Oct 2025 (https://www.mexc.com/news/137426 [unverified]).
- 4-hour: the first BTC 4h events are dated 2025-10-14/15 (gamma API, series id 10331).
- 5-minute: the changelog shows launch on 2026-02-12, "with taker fees on the same curve as 15-minute markets" (https://docs.polymarket.com/changelog/changelog; also https://www.kucoin.com/news/flash/polymarket-integrates-twap-for-5-minute-crypto-markets-after-months-of-criticism [secondary]). The gamma series object dates from 2025-11-21, with test events on 2025-12-17. BTC came first. DOGE, BNB and HYPE 5m, 15m and 4h series were added 2026-03-11 (gamma API).
- Polymarket US, the CFTC-regulated US app: "BTC Up or Down: 15 min" launched 2026-09-22 (https://finance.yahoo.com/markets/crypto/articles/polymarket-rolls-bitcoin-bets-every-135006140.html; https://defirate.com/news/polymarket-us-15-minute-bitcoin-volume-hits-92m-in-first-full-week/). ETH, SOL and XRP were added on 2026-10-17 in 15-minute, hourly and daily windows (https://defirate.com/prediction-markets/crypto/). Covers says 5-minute BTC markets reached the US app in February (https://www.covers.com/industry/polymarket-publishes-15-minute-bitcoin-prediction-markets). That conflicts with other coverage and is probably a mix-up with the international launch [unverified].

**Resolution.**
- 5m, 15m and 4h markets resolve on Chainlink BTC/USD TWAP data streams, for example https://data.chain.link/streams/btc-usd-twap-60s-streams. The rule text says Up wins "if the time-weighted average price (TWAP) of Bitcoin, generated by Chainlink, of the time range specified in the title is greater than or equal to the price at the beginning of that range" (https://gamma-api.polymarket.com/events?slug=btc-updown-5m-1792475700 and the 15m and 4h equivalents, fetched 2026-10-20).
- Until 2026-08-07 these markets resolved on a single Chainlink snapshot. From 2026-08-07 they used a 30-second TWAP for 5m and a 60-second TWAP for 15m and 4h. On 2026-08-14 the 5m window moved to 60 seconds (changelog, https://docs.polymarket.com/changelog/changelog).
- Polymarket US 15m uses "an average of 60 index readings per minute before each endpoint" (https://finance.yahoo.com/markets/crypto/articles/polymarket-rolls-bitcoin-bets-every-135006140.html).
- Hourly and daily markets still resolve on Binance candles, as above.
- Polymarket streams the same reference prices to traders. RTDS launched Binance and Chainlink feeds on 2025-09-24. A "PolyBolt" socket on 2026-09-15 began streaming crypto, equity and Chainlink TWAP reference prices. Since 2026-10-02 `price.crypto` defaults to Chainlink (changelog). Direct Chainlink Data Streams API access for algorithmic traders opened in May 2026 (https://outposts.io/article/polymarket-opens-direct-api-access-to-chainlink-data-streams-267ddd9b-1b7c-43b4-8817-a784c99d612f [unverified]).

**Fees: the curve and its history.**
- 2026-01-05: taker fees started on 15-minute crypto markets only. "Fees vary by price and peak at 1.56% at 50% probability". Daily USDC maker rebates were funded by those fees (changelog). Cointelegraph's worked example was 100 shares at $0.50 costing about $1.56 in fees, "just over 3% of the trade's value" (https://www.tradingview.com/news/cointelegraph:e59c32089094b:0-polymarket-quietly-introduces-taker-fees-on-15-minute-crypto-markets/). Polymarket rolled this out quietly through its docs without an announcement. Unchained reported on 2026-01-07 that all fees then went back to makers as rebates (https://unchainedcrypto.com/polymarket-introduces-taker-fees-in-15-minute-markets/ [secondary; the 100% figure is unconfirmed by Polymarket]). Pine Analytics describes the January crypto curve as having a steeper exponent before the March change (https://pineanalytics.substack.com/p/polymarket-fee-rollout [secondary]). I could not get the January coefficient from an official page.
- 2026-02-12: 5m markets launched on the same curve (changelog).
- 2026-03-06: fees and rebates extended to all new crypto markets, including 1H, 4H, daily and weekly (changelog, entry dated 2026-03-01).
- 2026-03-30: "Fee Structure V2" introduced fee categories. Pine says the crypto peak rose from 1.56% to 1.80% (rate 0.072, exponent 1), with a blended effective fee of about 0.76% of taker volume (Pine, above).
- July 2026: the crypto rate eased to 0.07 (https://startpolymarket.com/learn/polymarket-fees/ [secondary]).
- Current official formula: `fee = C × feeRate × p × (1 − p)`, where C is shares and p is price. The crypto feeRate is 0.07, with makers never charged and a maker rebate of 20% of taker fees. That gives $1.75 per 100 shares at 50¢: 1.75% of $1 face, or 3.5% of the $50 cash paid (https://docs.polymarket.com/trading/fees). Live 5m, 15m, 1h, 4h and daily crypto markets carry `feeSchedule {rate: 0.07, exponent: 1, takerOnly: true, rebateRate: 0.2}` (gamma API, fetched 2026-10-20).
- Rebates are paid daily in pUSD, pro rata to each maker's "fee-equivalent" within the same market, with a $1 minimum payout (https://docs.polymarket.com/market-makers/maker-rebates).
- Polymarket US uses a single taker Θ of 0.0695, giving $1.74 per 100 contracts at 50¢. Maker rebates are tiered at about 5%, 10% and 15% of the taker fee for $10M+, $50M+ and $200M+ of monthly maker volume. Taker rebates run 3% to 30% by volume tier. This took effect 2026-10-19 (https://docs.polymarket.us/fees).

**Taker delay, an anti-latency-arbitrage tool.**
- Polymarket first gave makers a 500 ms edge, then replaced it with a 250 ms taker delay on 5m, 15m and hourly crypto (https://finance.yahoo.com/news/polymarkets-5-minute-bitcoin-bets-123329673.html [syndicated]).
- From 2026-06-05, API taker orders are locked as pending during the delay and cannot be cancelled (https://x.com/PolymarketDevs/status/2061930696323830158 [search snippet]).
- The delay was cut to 50 ms on 2026-08-17 (https://x.com/PolymarketDevs/status/2089295325660172578 [search snippet]) and raised to 150 ms on 2026-09-04 (changelog).

**Volume over time.** These are Polymarket-reported gamma "volume" figures, summed over every market in a UTC day, from my own pulls of https://gamma-api.polymarket.com/events by slug on 2026-10-20. Remember they run about 2x cash turnover.

| UTC day | BTC 15m | BTC 5m | ETH 5m |
|---|---|---|---|
| 2025-10-15 | $2.05M | — | — |
| 2025-11-13 | $4.78M | — | — |
| 2025-12-16 | $12.6M | — | — |
| 2026-01-15 | $22.5M | — | — |
| 2026-02-17 | $17.3M | $31.2M | n/a |
| 2026-03 | gamma data missing (null volumes) | | |
| 2026-04-15 | $6.4M | $32.8M | $3.1M |
| 2026-05-13 | $3.9M | $22.6M | $2.1M |
| 2026-06-16 | $3.6M | $18.7M | $1.2M |
| 2026-07-15 | $3.5M | $25.7M | $2.6M |
| 2026-08-13 | $2.4M | $11.8M | $0.44M |
| 2026-09-15 | $3.1M | $12.7M | $0.54M |
| 2026-10-14 | $2.9M | $9.4M | $0.43M |
| 2026-10-19 | $2.9M | $11.3M | $0.40M |

What the table shows:
- BTC 15m peaked around January 2026 and is down about 87% since.
- BTC 5m arrived in February and pulled flow away from 15m.
- BTC 5m itself roughly halved after August 2026, when the TWAP fix, the taker-delay changes and the end of the manipulation edge all landed.

On the 24 hours to about 06:00 UTC on 2026-10-20, the gamma `volume24hr` by series was:

| Asset | 5m | 15m | Hourly | 4h | Daily |
|---|---|---|---|---|---|
| BTC | $11.55M | $2.75M | $0.68M | $65K | $195K |
| ETH | $549K | $439K | $145K | — | — |
| SOL | $134K | $130K | — | — | — |

Every other cell, including all of XRP, DOGE, BNB and HYPE, was under $100K. HYPE was $6K in 5m and $28K in 15m. All up/down series together came to about $17.2M, and the 5m series were about 72% of that (https://gamma-api.polymarket.com/series?slug=btc-up-or-down-5m and sibling slugs). A single off-peak BTC 15m window (2:15 to 2:30 AM ET on Oct 7) traded $14.8K (https://polymarket.com/event/btc-updown-15m-1791353700).

Independent tick data [aggregator] for the 30 days to 2026-10-18 (CryptoStruct):

| Polymarket market | Turnover per day | Trades per day | Average trade | Quoted spread | Top-of-book depth |
|---|---|---|---|---|---|
| BTC 5m | about $6.0M | 409K | about $14.8 | 1.21¢ | $3.7K |
| BTC 15m | $1.6M | 93K | about $17 | 1.25¢ | $3.0K |
| BTC 1h | $13.8M over 30 days | | | | |
| BTC 4h | $1.5M over 30 days | | | | |

Sources: https://cryptostruct.com/prediction-markets/polymarket-btc-5m; https://cryptostruct.com/prediction-markets/polymarket-btc-15m; https://cryptostruct.com/prediction-markets/topic/bitcoin-up-or-down. BTC 5m turnover was down 10% on the prior 30 days.

Peak-era press figures, which are not comparable with the measures above:
- BTC 5m reached "up to $60M" per day around March 2026, from user-built Dune dashboards (https://fortune.com/2026/03/16/betting-on-5-minute-swings-on-bitcoin-price-are-the-hot-new-thing-on-prediction-markets/; https://finance.yahoo.com/news/polymarkets-5-minute-bitcoin-bets-123329673.html). BlockBeats said 5m was 67% of Polymarket's crypto binary volume as of 2026-03-11 (https://www.bitget.com/news/detail/12560605256967 [secondary]).
- $4B cumulative 5m volume and $153M per day were reported on 2026-04-09 (https://finance.yahoo.com/markets/crypto/articles/polymarket-just-hit-4-billion-103508725.html [unverified, sponsored-content site]).
- Chainlink said 5m and 15m markets had generated "$7B+ in trading value" (https://x.com/chainlink/status/2065497540129104213 [search snippet; date not confirmed]).
- Polymarket and Kalshi short-duration crypto together ran about $70M per day in March 2026 and were "more than half of all crypto trading" on both (https://crypto.news/on-polymarket-and-kalshi-five-minute-crypto-bets-now-dominate-prediction-flows/, citing the FT).

**Share of platform.**
- Polymarket International, H1 2026 (Surf's analysis of 787M deduplicated trades across 1.73M wallets): crypto was about 30% of volume, "predominantly" 5m up/down. 5m markets were about 90% of crypto volume but locked only about $2,800 of collateral per market. Crypto earned $96.3M of gross fees in H1, ahead of sports at $83.5M. Crypto and sports together made up 98% of about $184M in gross fees (https://www.techflowpost.com/en-US/article/33803 [secondary analysis]).
- 30 days to 2026-10-19, international: crypto was $748M face, or 16.4% of volume, down 11.9% (https://defirate.com/prediction-markets/volume/polymarket/).
- International volume overall fell from $11.3B face in June 2026 to $4.7B in September (same source). The crypto shrink is partly a platform-wide slide as US flow moves to Polymarket US and Kalshi.
- Polymarket US 15m BTC, first full week (Sept 23 to 29, 2026): $91.8M of the $101.2M BTC total, about 91%. Daily volume rose from $2.40M to $27.71M, and transactions rose from 63,650 to 739,034 against the prior week (https://defirate.com/news/polymarket-us-15-minute-bitcoin-volume-hits-92m-in-first-full-week/).
- The same publisher puts all Polymarket US crypto at only $170M face (1.4% of volume) for Sept 20 to Oct 19 (https://defirate.com/prediction-markets/volume/polymarket-us/). Read together, these imply volume faded sharply after the launch week, unless the two pages use different methods [unverified inference].

**Who trades it: bots, market makers, latency arbitrage.**
- Surf (H1 2026): bots took about 80% of crypto volume. Crypto had the lowest one-month retention of any entry category, about 37%. New crypto wallets peaked at about 99K in March. Across the platform, bots were the only cohort with net profit (about +$108M), yet only 27% of bot wallets were profitable. Retail (about 1.54M wallets) lost about $74M net. Only 146 of about 1.75M wallets had positive cash flow for six straight months (https://www.techflowpost.com/en-US/article/33803 [secondary]).
- Latency arbitrage: "0x8dxd" reportedly turned $313 into about $437.6K in roughly a month from December 2025. It showed a 98% win rate over 6,615 predictions by buying the near-certain side when Binance and Coinbase spot had moved but Polymarket had not repriced (https://finbold.com/trading-bot-turns-313-into-438000-on-polymarket-in-a-month/, 2026-01-06 [secondary]). BeInCrypto cites a $313 to $414K bot on 15m BTC, ETH and SOL with $4K to $5K per trade, an AI-ensemble bot making $2.2M in two months, and "dozens" of bots on 15m BTC (https://finance.yahoo.com/news/arbitrage-bots-dominate-polymarket-millions-100000888.html, 2026-01-06 [secondary, from social posts]). Early on, latency arbitrage against Binance "went largely unchecked" (https://crypto.news/on-polymarket-and-kalshi-five-minute-crypto-bets-now-dominate-prediction-flows/).
- Other bot strategies reported: buying YES and NO together when they sum to less than $1, and front-running thin books (BeInCrypto, above).
- Settlement manipulation: a Stanford and Singapore Management University working paper (Dai, Jia, Yu, July 2026) studied about two months, roughly 16,000 five-minute BTC contracts. It found one-sided Binance orders in the final seconds before snapshot settlement. 821 accounts made $8.2M in windows classed as likely manipulated, 93% of losses (excluding makers) fell on retail, and a near-certain bet was overturned "one time in three". The effect was much weaker in 15m and 60m markets (https://www.coindesk.com/business/2026/08/07/how-a-five-second-trick-let-traders-drain-millions-from-polymarket; https://news.bloomberglaw.com/business-and-practice/stanford-study-says-polymarket-crypto-bets-are-being-manipulated; https://www.casino.org/news/polymarket-altering-resolution-of-timed-crypto-markets/). Users had flagged it from May 2026.
- Polymarket's response was the TWAP switch on 2026-08-07 plus $1M of liquidity rewards through August (CoinDesk, above).
- Market makers are not named publicly. They are API makers paid with the 20% rebate and helped by the taker delay. The Surf data suggests professional and informed traders' share of crypto volume "dropped sharply after fees activated" (Surf, above).
- Retail behaviour: traders feed indicators into AI chatbots. One engineer said he doubled his capital in two months (https://crypto.news/on-polymarket-and-kalshi-five-minute-crypto-bets-now-dominate-prediction-flows/).

**Criticism.**
- "Prediction market platforms have managed to take a speculative asset and inject even more mania" (Amanda Fischer, Better Markets). Keyrock's Amir Hajian called it "pure speculation" (https://finance.yahoo.com/news/crypto-5-minute-gambling-frenzy-152831587.html).
- The manipulation study, above.
- New York's Attorney General sued QCX LLC (Polymarket US) on 2026-09-24, two days after the 15m launch, as an unlicensed gambling business. The petition's examples are sports, politics and entertainment, not BTC (https://finance.yahoo.com/markets/crypto/articles/polymarket-rolls-bitcoin-bets-every-135006140.html).

**Sticky or not.** The format is sticky for bots and for a hard core of traders: constant rounds, near-50/50 prices, and capital recycled 96 to 288 times a day. It is not sticky for the median retail user. Crypto has the worst one-month retention on Polymarket. Volume has drifted down since the Jan-to-Apr 2026 peak. Liquidity is thin, about $3K to $4K at the top of the book. And the flow is moving to Kalshi, where the same product is roughly 20x larger (section 3.B1).

#### 3.A2 Short-term stock and index markets

- **What exists.** Daily "Up or Down" markets for single stocks (NVDA, TSLA, AAPL, AMZN, GOOGL, PLTR, RKLB, OPEN, SPCX, MU and others), SPX and SPY close up/down, SPX "Opens Up or Down", and "Closes above $X" strikes for SPY, NVDA, AMZN, GOOGL and WTI. Gold, silver and WTI also have up/down markets. The Daily finance page showed 54 daily markets on 2026-10-20. I saw no intraday or 15-minute stock markets on Polymarket (https://polymarket.com/finance/daily).
- **Launch.** NVDA, TSLA, AAPL and SPX daily up/down series were created 2025-10-14/15, with the first NVDA market for 2025-10-15. The SPX "open" series was created 2026-01-20 (gamma API, series ids 10374 and 10383).
- **Resolution.** Single stocks compare the official close with the prior trading day's close, using Pyth (for example https://pythdata.app/explore/Equity.US.NVDA%2FUSD). SPX uses the WSJ market data page (gamma API event descriptions, 2026-10-19 markets). Some FAQ text still mentions Binance NVDA/USDT 1-minute candles and conflicts with the rules (https://polymarket.com/event/tsla-up-or-down-on-october-9-2026). Chainlink equity feeds were added to Polymarket's price channels on 2026-09-29, adding SPCX, INTC, MSTR, CRCL and MU (changelog).
- **Fees.** Finance category, rate 0.04 with a 25% rebate: $1.00 per 100 shares at 50¢ (gamma `feeSchedule`; https://docs.polymarket.com/trading/fees).
- **Volume.** This is a failure-to-scale case. The first NVDA market (2025-10-15) traded $291K. Monthly averages per daily NVDA market (gamma) were $29.4K in Oct 2025, $13 to 17K in Nov-Jan, $29.4K in Feb 2026, then $4.3K in June, $4.1K in September and $2.3K in October 2026. SPX daily close markets averaged $383K per day in Feb 2026 and $47K in Oct 2026. On 2026-10-19 the SPX close market did $164K, NVDA $7.0K, TSLA $5.1K, AAPL $4.5K and SPX open $7.7K (gamma API, my pulls). Polymarket's whole finance category is tiny. For Polymarket US it was $597K face in 30 days (https://defirate.com/prediction-markets/volume/polymarket-us/).
- **Why it is not sticky.** One round a day, trading only during US hours, an underlying that moves less than crypto, and heavy competition from 0DTE options and broker apps. This is my inference; I found no published post-mortem.

#### 3.A3 Live sports and in-game

- **Size.** Sports were 49.3% of international volume ($2.3B face) for Sept 20 to Oct 19, 2026 (https://defirate.com/prediction-markets/volume/polymarket/). On Polymarket US they were 98.2% ($12.3B face) (https://defirate.com/prediction-markets/volume/polymarket-us/). About 88% of Polymarket US open interest is in sports (https://www.techflowpost.com/en-US/article/33803).
- **Behaviour.** In Surf's H1 data, the median entry into a sports market comes at 92 to 95% of the market's life, which means right before or during the game. Bots took about 72% of sports volume, and 46% of sports wallets made a single trade (Surf, above).
- **Fees.**
  - 2026-02-18: taker fees on NCAAB and Serie A (changelog).
  - 2026-03-30: all sports. The fee peak was 0.44% before and 0.75% after, per share of $1 face (Pine, above [secondary]).
  - 2026-07-10: rate up from 0.03 to 0.05, and the maker rebate down from 25% to 15% (changelog).
  - October 2026: a 0.03 rate for NFL and college football game markets [secondary] (https://startpolymarket.com/learn/polymarket-fees/).
- **Liquidity rewards.** Over $2M for live and pregame March Madness markets (changelog, 2026-03-17).
- **Parlays on Polymarket US.** Launched 2026-08-11. Takers lost $69.6M, 15.4% of stakes after fees, through 2026-10-19. Takers were profitable on a lifetime basis until 2026-09-12 (https://www.ingame.com/parlay-takers-lose-dkex-polymarket-us/).
  - The combo family ("CAOC") was 51.5% of Polymarket US trade volume in the week of Oct 5 to 11, 2026 (https://defirate.com/news/kalshi-hits-record-19-billion-week-as-polymarket-us-triples-fall-trade-volume/).
  - The combo fee on the US app is `C × p × [0.0695 × (1−p) + 0.06 × (1−p)^4]` with no maker rebate (https://docs.polymarket.us/fees).
  - International combos use 0.05 with a 0% rebate (https://docs.polymarket.com/trading/fees).
- **Data quality.** DeFi Rate cites a Columbia study estimating about 25% of Polymarket's historical volume was wash trading, higher in sports (https://defirate.com/prediction-markets/volume/polymarket/ [secondary]).

#### 3.A4 Other short-cycle Polymarket markets

- Daily weather (London, NYC high temperature): gamma 24h volume was $80.9K for the london-daily-weather series and $59.7K for nyc-daily-weather on 2026-10-20. The weather fee is 0.05 with a 25% rebate (gamma series API; https://docs.polymarket.com/trading/fees).
- Polymarket US weather: $29M face over 30 days (https://defirate.com/prediction-markets/volume/polymarket-us/).
- Weekly "Elon tweets" markets drew $853K of 24h volume (gamma series `elon-tweets`, 2026-10-20).
- Mentions are covered in B5.

---

### 3.B Kalshi

#### 3.B1 15-minute crypto (KXBTC15M and siblings)

- **Launch.** December 2025 (https://www.ingame.com/kalshi-non-sports-15-minute-crypto/; https://crypto.news/on-polymarket-and-kalshi-five-minute-crypto-bets-now-dominate-prediction-flows/). I did not find an exact day.
- **Coins as of mid-October 2026.** BTC, ETH, SOL, XRP, DOGE, BNB, HYPE, NEAR and ZEC, plus a five-coin "Crypto Leader" race (KXCRYPTOLEAD15M) (https://defirate.com/prediction-markets/crypto/). The earliest Crypto Leader market in Kalshi's live API opened 2026-08-21 (https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXCRYPTOLEAD15M).
- **No 5-minute markets.** A 2026-09-04 sweep of 274 Kalshi crypto series found nothing shorter than 15 minutes (https://blog.predictefy.com/how-to-track-5-minute-bitcoin-markets [secondary]).
- **Resolution.** CF Benchmarks Real-Time Index (BRTI for BTC). "At the last minute before expiration, 60 RTI prices are collected. The official and final value is the average of these prices" (Kalshi series API, https://api.elections.kalshi.com/trade-api/v2/series/KXBTC15M). The close-minute average is compared with the minute before open (https://help.kalshi.com/en/articles/13823838-crypto-markets), and ties resolve YES (https://predictionmarketspicks.com/articles/how-kalshi-15-minute-markets-settle [secondary]).
- **Contract terms.** Tick size is $0.001. The position accountability level is $25,000 per strike per member. If no data is available, strikes resolve No (https://assets.kalshi.com/contract_terms/CRYPTO.pdf).
- **Fees.** Kalshi's standard taker fee is `round up(0.07 × C × P × (1−P))`, which is 1.75¢ per contract at 50¢. Maker fees, where a series charges them, are a quarter of that (https://blog.predictefy.com/kalshi-fees [secondary]; fee schedule PDF at https://kalshi.com/docs/kalshi-fee-schedule.pdf was rate-limited and not read). KXBTC15M shows `fee_type: quadratic, fee_multiplier: 1`, meaning no discount (series API). So the peak fee is about the same as Polymarket's $1.75 per 100 contracts at 50¢.
- **Liquidity incentives.** Kalshi's Liquidity Incentive Program pays $1 to $1,000 per market per day for resting depth, scored by one-second order-book snapshots. It runs to 2027-01-01 (https://help.kalshi.com/en/articles/13823851-liquidity-incentive-program). Separately, the Market Maker Program gives reduced fees and adjusted position limits in exchange for quoting obligations of 98% of each hour on listed products such as KXBTC and KXINX (https://help.kalshi.com/en/articles/13823819-how-to-become-a-market-maker-on-kalshi). The Volume Incentive Program, live since March 2023, ends no earlier than 2026-10-13 amid CFTC scrutiny of volume rewards and wash-trading claims about Kalshi's ETH perpetuals (https://www.theblock.co/news/business/2026-09-30-kalshi-ends-trader-incentive-program-417247).
- **Who the makers are.** Kalshi says market makers are "primarily individuals and small institutions" (https://help.kalshi.com/en/articles/13823808-who-are-you-trading-with). No firms are named for 15m crypto. Gap: I could not confirm specific firms in this pass.

**Volume.**
- Kalshi's own API, markets closing 2026-10-13 to 2026-10-20 (7 days, contracts at face): KXBTC15M 2.00B contracts, KXETH15M 134M, KXSOL15M 58M (https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXBTC15M; my pulls on 2026-10-20). BTC averages about 3M contracts per 15-minute window. On 2026-08-12/13, single windows were 1.6 to 1.7M contracts.
- CryptoStruct tick data, 30 days to 2026-10-18 [aggregator]: KXBTC15M averaged 3.45M trades per day and $130.2M per day of turnover, with an average trade of about $37.7, a quoted spread of 0.53¢ and $75.9K of top-of-book depth. Turnover was up 36.7% on the prior 30 days (https://cryptostruct.com/prediction-markets/kalshi-btc-15m). That made it the most traded prediction-market series in CryptoStruct's archive: about 83% of all BTC up/down turnover across Kalshi, Polymarket and predict.fun (https://cryptostruct.com/prediction-markets/topic/bitcoin-up-or-down).
- Comparison: Kalshi BTC 15m does about 22x the turnover and 8x the trades of Polymarket BTC 5m, with less than half the spread and 20x the depth.
- Kalshi crypto category, face volume by month: $343M in Jan 2026, $799M Feb, $1.22B Mar, $1.36B Apr, $2.02B May, $4.02B Jun, $6.33B Jul, $7.58B Aug, $8.89B Sep, and $6.32B for Oct 1 to 18. The record day was $409.5M on 2026-10-14 (https://ticker-tracker.com/kalshi/volume/crypto [aggregator]). For Sept 1 to 28, DeFi Rate puts crypto at $8.17B, about $7B (86%) of it from 15m markets. Crypto's share of Kalshi volume rose from about 2.6% before the 15m launch to 14.5% in September (https://defirate.com/news/polymarket-us-15-minute-bitcoin-volume-hits-92m-in-first-full-week/). For Sept 20 to Oct 19, crypto was $10.4B face, 13.0% of Kalshi's $80.0B (https://defirate.com/prediction-markets/volume/kalshi/).
- The 15m launch was slow. BTC 15m did about $226K in its first seven days (DeFi Rate, above).
- Fees: under $10K per day in January 2026, over $2M per day in September, and $2.9M on 2026-10-02 (https://www.ingame.com/kalshi-non-sports-15-minute-crypto/). In the seven days to 2026-10-05, all 15-minute markets (crypto, commodities and FX/indices) earned $20.4M of fees, about $1B annualized and 80% of Kalshi's non-sports fees. They were 13% of volume but 20% of fees, because they trade near 50/50, where the quadratic fee peaks (InGame, above). Bitcoin markets earned an estimated $60.4M of fees in September 2026 (https://cointelegraph.com/news/kalshis-15-min-gold-markets-overtake-ether-just-weeks-after-launch, citing Predict Charts [aggregator]).
- **Distribution.** Robinhood routes orders to Kalshi's markets, adding a 1¢-per-contract commission that Gold halves (https://defirate.com/prediction-markets/crypto/). Coinbase added Kalshi-listed 15-minute and hourly contracts on 10 coins on 2026-10-06 (DeFi Rate, above; https://thedefiant.io/news/defi/coinbase-launches-15-minute-and-hourly-crypto-price-markets).
- **Behaviour.** Kalshi crypto turns over about 6x its open interest daily (about $17M OI, about $96M per day of volume in H1), and 98% of its crypto markets expire within an hour. Polymarket's ratio is about 0.31x (https://www.techflowpost.com/en-US/article/33803 [secondary]). An August 2026 Synth study found Kalshi prices increasingly led Binance BTC moves (https://www.ingame.com/kalshi-non-sports-15-minute-crypto/). The 60-second average of a multi-exchange index blunts last-second manipulation. Kalshi says it runs 150 to 250 material investigations per quarter (https://www.coindesk.com/business/2026/08/07/how-a-five-second-trick-let-traders-drain-millions-from-polymarket).
- **Criticism.** An Ohio problem-gambling counselor, quoted by NPR, compared the markets to slot machines (https://www.ingame.com/kalshi-non-sports-15-minute-crypto/).
- **Sticky or not.** Yes, by every measure: monthly volume grew about 26x from January to September 2026, records kept coming after the Volume Incentive Program ended, retail broker distribution adds reach, and spreads are tight enough for $30 to $40 retail trades. This is the template the rest of the industry is copying: Polymarket US, Coinbase, Gemini, Crypto.com strike options and DATA.BET (https://defirate.com/prediction-markets/crypto/; https://finance.yahoo.com/markets/crypto/articles/polymarket-rolls-bitcoin-bets-every-135006140.html).

#### 3.B2 Hourly and daily crypto (above/below and ranges)

- KXBTCD (BTC above/below, hourly) and KXBTC (BTC range) settle on the BRTI 60-second average (https://api.elections.kalshi.com/trade-api/v2/series/KXBTCD).
- 7 days to 2026-10-20 (face): KXBTCD 224.7M contracts across about 30K strike markets, KXBTC 6.4M (Kalshi API, my pulls).
- 30 days (CryptoStruct): KXBTCD had 14.3M trades and $509M turnover. KXBTC had $8.9M (https://cryptostruct.com/prediction-markets/topic/bitcoin-up-or-down [aggregator]).
- Kalshi's 1-hour markets grew from about $3.2M per day before the 15m launch to $15.8M per day by days 61 to 90 after it (https://defirate.com/news/polymarket-us-15-minute-bitcoin-volume-hits-92m-in-first-full-week/). The 15m product pulled traffic into the hourly ladder.
- In the week to 2026-10-05, hourly and daily crypto, commodity and index markets earned $3.8M of fees (https://www.ingame.com/kalshi-non-sports-15-minute-crypto/).
- Range markets are not sticky. KXBTC is about 1/30th of KXBTCD.

#### 3.B3 15-minute commodities and FX (2026 launches)

- **Commodities.** Gold, silver and WTI 15-minute markets launched 2026-08-03 and settle on Pyth 1-minute candles (https://predictionmarketspicks.com/articles/how-kalshi-15-minute-markets-settle [secondary]). KXGOLD15M lists "Pyth - Gold" as its source (https://api.elections.kalshi.com/trade-api/v2/series/KXGOLD15M). Natural gas 15m appears from 2026-08-28 in the API. Copper, palladium and platinum 15m also trade (https://ticker-tracker.com/kalshi/volume/commodities).
- **Gold traction.** Gold 15m traded 542M contracts in September 2026, against 318M for ETH 15m, and earned about $5M of fees against ETH's $2.6M (https://cointelegraph.com/news/kalshis-15-min-gold-markets-overtake-ether-just-weeks-after-launch). Commodities face volume went from $52M in July 2026 to $410M in August and $891M in September, with a record day of $61.7M on 2026-09-29. Gold 15m did $188M in the week to Oct 18 (ticker-tracker, above [aggregator]). In Kalshi's API, KXGOLD15M did 186M contracts in the 7 days to Oct 20.
- **FX.** EURUSD, USDJPY, GBPUSD, USDCAD and AUDUSD 15m first appear in the API on 2026-09-23/24. They did $1.1M to $2.5M each in the week to Oct 18 (https://ticker-tracker.com/kalshi/volume/financials).
- **Listed but not trading.** S&P 500 15m (KXINX15M), Nasdaq-100 15m (KXNDQ15M) and 2, 5, 10 and 30-year Treasury yield 15m series were listed but not trading as of 2026-09-26 (https://predictionmarketspicks.com/articles/how-kalshi-15-minute-markets-settle). KXINX15M's settlement source still reads "For example, Google Finance" (https://api.elections.kalshi.com/trade-api/v2/series/KXINX15M).

#### 3.B4 S&P 500 and Nasdaq-100 daily and hourly ranges

- Series include KXINX (S&P 500 range, daily), KXINXU (S&P 500 above/below, hourly) and KXNASDAQ100U (Nasdaq above/below, hourly). The API's settlement source is "For example, Google Finance" (https://api.elections.kalshi.com/trade-api/v2/series/KXINX; /KXINXU; /KXNASDAQ100U). The fee multiplier is 1 on all three (same).
- 7 days to 2026-10-20 (face): KXINX 130K contracts (very small), KXINXU 6.9M, KXNASDAQ100U 5.3M (Kalshi API, my pulls). Ticker-tracker agrees, with "S&P 500 above/below" at $7.0M and "Nasdaq above/below" at $5.4M in the week to Oct 18, and Dow hourly at $0.46M (https://ticker-tracker.com/kalshi/volume/financials).
- Kalshi Financials, face volume: $28.8M in Jan 2026 and $86.3M in Sept 2026, with the growth coming from new 15m FX. The record day was $30.8M on 2026-10-01 (same).
- Index markets are about 1% of Kalshi volume and are not sticky next to crypto. My inference is that they trade only during market hours, move slowly intraday, and face cheaper hedges in 0DTE options. Kalshi launched a stock-index perpetual on 2026-10-06 (DeFi Rate headline, https://defirate.com/news/kalshi-launches-stock-index-perpetuals/ [not read]). Nasdaq has filed for short-window Nasdaq-100 binaries (https://crypto.news/on-polymarket-and-kalshi-five-minute-crypto-bets-now-dominate-prediction-flows/).

#### 3.B5 Weather (daily high temperature, hourly temperature, rain)

- **Resolution changed in 2026.** The KXHIGHNY rulebook (GLOBALTEMPERATURE) now ranks source agencies "in hierarchical order, The Weather Company (TWC), National Weather Service, the national weather service for <area>". It uses "the first official non-preliminary report", with resolution at "full precision". Position accountability is $25,000 per strike (https://assets.kalshi.com/contract_terms/GLOBALTEMPERATURE.pdf). KXHIGHNY's settlement source is weather.com/kalshi, under a bulk notice tagged 2026-09-02 (https://api.elections.kalshi.com/trade-api/v2/series/KXHIGHNY).
- **Source mix.** Of 445 weather series, 141 list TWC alone, 38 list NWS and 6 list "NWS Climatological Report". Legacy tickers such as HIGHNY, HIGHCHI and HIGHMIA still name NWS. Houston and Denver name the NWS Climatological Report (https://api.elections.kalshi.com/trade-api/v2/series?category=Climate%20and%20Weather). So the old "NWS Daily Climate Report" assumption now holds only for some series.
- **2026 launches.**
  - "Hourly Directional" temperature markets for NYC, Miami, LA, Chicago, DC and Boston, settling on TWC or Synoptic Data. The first KXTEMPNYCH market opened 2026-04-30 in the API.
  - International daily highs for Paris, London, Shanghai, Mumbai, Seoul, Toronto and others. The first Paris market opened 2026-08-19 (Kalshi API).
  - A daily "where will it rain" market.
- **Volume (face).** Weather was $112.7M in Jan 2026, about $70 to 102M a month since, and $99.9M in Sept 2026. The record day was $7.39M on 2026-01-04. Top markets for the week to Oct 18: "Where will it rain daily" $9.7M, Miami hourly temperature $3.6M, LA high $2.7M, NYC high $1.6M, Chicago high $0.8M (https://ticker-tracker.com/kalshi/volume/climate-and-weather [aggregator]). In Kalshi's API, KXHIGHNY did 1.6M and KXHIGHLAX 2.7M contracts in the 7 days to Oct 20. Weather was about 0.1% of Kalshi's 30-day volume, $118M (https://defirate.com/prediction-markets/volume/kalshi/).
- **Sticky or not.** Steady but niche. Volume has been flat for nine months. The new hourly format is the only part growing (my inference from the tables above).

#### 3.B6 Mentions (what X will say in a speech or earnings call)

- **Breadth.** 462 mention series in Kalshi's API on 2026-10-20. Examples: KXTRUMPSAY, KXJPOWMENTION, KXEARNINGSMENTION<ticker> for AMZN, GOOGL, PLTR, BA and others, "How long will Trump speak", and late-night and 60 Minutes mentions (https://api.elections.kalshi.com/trade-api/v2/series?category=Mentions).
- **Resolution.** Earnings-call markets name "<Company> Investor Events" (the IR webcast or transcript) or Bloomberg. Political mention markets name a list of outlets (AP, Reuters, WSJ, NYT, CNN, Fox and others) (same API). Kalshi usually uses official transcripts or named media. FOMC markets use the official transcript only. Earnings markets use the IR transcript published within 24 hours. Polymarket uses its UMA oracle and usually counts anyone on the broadcast (https://defirate.com/odds/mention-markets/). The fee is standard quadratic on Kalshi (multiplier 1). On Polymarket, Mentions is 0.04 with a 25% rebate (https://docs.polymarket.com/trading/fees).
- **Volume (face).**
  - The category grew from $3.6M in Jul 2025 to $78M in Dec 2025, $155M in Jan 2026 and $183M in Feb 2026. The record day was $36.3M on 2026-02-24, likely the State of the Union [inference].
  - It held at $124 to 162M a month through July 2026, then fell to $46.6M in August and $30.9M in September (https://ticker-tracker.com/kalshi/volume/mentions [aggregator]).
  - Top markets for the week to Oct 18: "What will Trump say?" $6.1M. Combined Kalshi and Polymarket mention volume was $1.2M on 2026-10-20, with mentions about 0.1% of $26.4B traded across venues over 30 days (https://defirate.com/odds/mention-markets/).
  - NFL announcer mentions passed $47M across 64 games in 2025-26. Mention parlays debuted November 2025 (same).
- **Why it collapsed after July.**
  - Kalshi removed sports-announcer mention contracts in August 2026 amid a reported CFTC examination (https://defirate.com/news/cftc-mention-markets-manipulation-advisory/).
  - On 2026-08-28 the CFTC ordered White House teleprompter operator Gabriel Perez to disgorge $107,539 and pay a $65,000 penalty. He had used advance access to Trump speeches to trade mention contracts from December 2025 to February 2026 (same).
  - George Santos settled on 2026-07-31 over attendance contracts (same).
  - On 2026-09-22, CFTC staff said contracts on a person's words, attendance or interactions may be presumed "readily susceptible to manipulation". Exchanges must now justify safeguards contract by contract (same).
  - NPR reported on 2026-08-28 that federal regulators had opened an inquiry into mention markets, in a story about a fake poll and a White House controversy involving Kalshi ([NPR](https://www.npr.org/2026/08/28/nx-s1-5945290/fake-poll-meridian-stratgies-kalshi-polymarket); the page timed out, so this comes from a search summary) [unverified]. The date matches the CFTC's Perez order.
- **Other controversies.** Coinbase's Brian Armstrong read the tracked words on an earnings call (about $84K at stake). A Sanders rally on 2026-02-12 drew $3.6M and resolved No even though attendee video showed the words said, because approved outlets did not cover it (https://defirate.com/odds/mention-markets/).
- **Sticky or not.** Very sticky while the president and the NFL supplied a near-daily calendar of events. It is now regulatory-fragile, because the person being bet on can change the outcome.

#### 3.B7 Live and in-game sports, and combos (parlays) via RFQ

- **Sports size.** Sports were $16.2B face, 20.3% of Kalshi's volume, for Sept 20 to Oct 19, 2026 (https://defirate.com/prediction-markets/volume/kalshi/). The busiest single contracts are NFL and college football game markets, at $6 to 9M of turnover each on 2026-10-18. The NFL game series did $828M of turnover over 30 days (https://cryptostruct.com/prediction-markets [aggregator]).
- **In-game products.**
  - The Live tab feeds the combo builder (https://help.kalshi.com/en/articles/13823820-combos).
  - NFL "ladder" and "escalator" (in-app "slingshot") player-stat markets pay between $0 and $1 by the stat and can be sold in-game (https://help.kalshi.com/en/articles/17516391-ladder-and-escalator-markets).
  - A sports-prop combo incentive gives prop makers 25% of combo fees. For live events, only maker volume placed after the scheduled start counts (https://help.kalshi.com/en/articles/17184676-sports-prop-combo-market-component-legs-liquidity-incentive-program).
- **How combos work.** Each combo is its own order book. A combo request goes out as an RFQ, other participants respond with quotes, and a combo with no quote does not fill. A combo settles at $0 as soon as any leg loses, otherwise once all legs resolve (https://help.kalshi.com/en/articles/13823820-combos). Market making is API-only. Web and app users can generally only take the Yes side (https://www.ingame.com/parlay-takers-lose-dkex-polymarket-us/). Series use `fee_type: quadratic_with_combo_maker_fees` (https://api.elections.kalshi.com/trade-api/v2/series/KXMVESPORTSMULTIGAMEEXTENDED). The combo maker fee started in August 2026 (https://www.ingame.com/kalshi-longest-parlay-odds/).
- **Launch and growth.** Combos launched September 2025 (InGame). Monthly face volume went from $0.53M in Sep 2025 to $1.34B in Jan 2026, $11.9B in Jun 2026, $35.5B in Sep 2026 and $35.0B for Oct 1 to 18. The record day was $3.19B on 2026-10-17 (https://ticker-tracker.com/kalshi/volume/combos [aggregator]). Kalshi set a weekend record on Oct 10-11: more than $8B, over $6B of it parlays (https://www.ingame.com/parlay-takers-lose-dkex-polymarket-us/).
- **Cash vs face.** Over 30 days, combos were $52B face, about 65% of Kalshi's volume (https://ticker-tracker.com/kalshi/volume), but only $5.3B in dollars paid, 28% (https://defirate.com/prediction-markets/volume/kalshi/). Since June 2026, $112.5M of taker stakes on parlays priced at or below 1¢ generated $37.2B of face volume, 60% of Kalshi's volume, yet only $11.7M of fees, about 1% (https://www.ingame.com/kalshi-longest-parlay-odds/).
- **Who wins and who loses.**
  - Yes-side takers have lost more than $870M since the September 2025 launch, including $340M (about 14.4% of stakes) since early September 2026. Kalshi has earned $336M in parlay fees (https://www.ingame.com/parlay-takers-lose-dkex-polymarket-us/).
  - Takers on the longest parlays show "virtually zero price sensitivity". Parlays of 20 or more legs sit at a 0.1¢ floor even when their true odds are below one in a billion (https://www.ingame.com/kalshi-longest-parlay-odds/).
  - Citizens estimated Kalshi's combo vig at 26.4%, against 23.9% at DraftKings (same).
  - Makers range from "garage-band" API traders to sportsbooks and funds. DraftKings said it made markets on three exchanges in August (same; https://www.ingame.com/parlay-takers-lose-dkex-polymarket-us/).
- **Sticky or not.** Extremely sticky, with weekend volume rhythms and lottery-ticket pricing. But the headline volume is mostly a face-value artifact, and the economics favour professional makers over retail takers.

#### 3.B8 Other 2026 Kalshi changes relevant to short-term products

- Perpetual futures launched in 2026. Wash-trading allegations surfaced in September over ETH perps: about $539M of 24h volume against $3.1M of open interest (https://www.theblock.co/news/business/2026-09-30-kalshi-ends-trader-incentive-program-417247). Kalshi denies wash trading (https://news.kalshi.com/p/the-facts-behind-kalshi-s-perpetuals-volume).
- Kalshi's total volume was $60.7B face and $14.7B in dollars paid in Sept 2026, 76% of tracked venues (https://defirate.com/prediction-markets/volume/kalshi/). 2026 fees passed $2.04B as of 2026-10-06, with non-sports at 19.2% of the year's fees and over 25% in September (https://www.ingame.com/kalshi-non-sports-15-minute-crypto/).

---

### 3.C Cross-cutting findings

1. **The winning short-term product is a continuous, near-50/50 binary on a liquid 24/7 underlying.** It settles on a manipulation-resistant average of a multi-venue index, and it is distributed through retail brokers. Kalshi BTC 15m runs about $130M per day of turnover. Polymarket's 5m and 15m together are under $10M (3.B1, 3.A1).
2. **The fee curve is shaped to the product.** Both venues charge about 1.75¢ per contract at 50¢ and taper to zero at the extremes. Fees started on Polymarket's 15m in January 2026 partly to tax latency-arbitrage takers, and they fund maker rebates of 20% for crypto (3.A1). These markets earn far more fees than their volume share suggests: 13% of Kalshi's volume but 20% of its fees (3.B1).
3. **Latency and settlement design decide who wins.** Polymarket's single-snapshot settlement on a feed that tracked Binance invited last-seconds manipulation ($8.2M to 821 accounts). Its taker delays (500 → 250 → 50 → 150 ms) show it is still tuning against bots. Bots are about 80% of Polymarket crypto volume, and crypto has the platform's worst one-month retention, about 37% (3.A1).
4. **Shorter is not always better.** Polymarket 5m cannibalized 15m. 4h, daily, range and single-stock up/down markets stayed small. Stock and index short-term markets failed to scale on both venues: Polymarket NVDA daily is down to about $2K to 5K per market, Kalshi's S&P daily range did 130K contracts in a week, and its S&P and Nasdaq 15m were listed but not trading (3.A2, 3.B3, 3.B4).
5. **Novelty spikes fade without distribution and liquidity.** Polymarket international BTC 15m is down about 87% from its January peak. Polymarket US 15m spiked to $27.7M per day in its first week and appears to have faded [unverified]. Kalshi's version kept compounding month after month (3.A1, 3.B1).
6. **Products built on a person's words are regulatory-fragile.** Kalshi mentions fell about 81% from July to September 2026 after delistings, CFTC enforcement and a staff advisory (3.B6).

### 3.D Gaps

- The exact Kalshi 15m launch day in December 2025 is unconfirmed.
- No named market-making firms for Polymarket or Kalshi crypto short-term markets. Kalshi's help center names none.
- Not read: Kalshi's official fee-schedule PDF (rate-limited), the NPR piece of 2026-08-28, Polymarket's March 2026 gamma volumes (missing in the API), and Polymarket US 15m daily data after 2026-09-29.
- Polymarket gamma volumes and ticker-tracker and DeFi Rate face volumes use different measures, so do not add them across venues.

---

## 4. Short-term and prediction products on other venues

Research slice for Probabl, compiled 2026-10-20.

Scope: Limitless, Myriad, Trueo (formerly Truemarkets), Drift BET, Hyperliquid HIP-4 (plus HIP-3 stock perps), PancakeSwap Prediction and Probable (plus other BNB Chain venues and Overtime/Thales Speed Markets), Robinhood's prediction markets hub and Rothera, and the brokers, sportsbooks and wallets that entered in 2025-26. A synthesis at the end covers what makes short-dated products sticky and what made venues fail.

### How to read this section

- Every claim has a URL. Anything from an aggregator, an affiliate review, a sponsored post, an AI-generated summary or a single weak source is marked **[unverified]**.
- **DefiLlama numbers.** I downloaded the daily series from DefiLlama's public API on 2026-10-20 and added up the calendar months myself. The endpoint URLs are given inline. October 2026 figures cover 1-20 October only. DefiLlama uses two measures and they differ a lot:
  - "Volume" is the dollars that actually changed hands.
  - "Notional volume" counts shares or contracts at $1 face value. It is always larger.
  I say which one each figure is.
- **Robinhood and Kalshi "contracts".** Each contract pays at most $1, so a contract count is a face-value count, not dollars spent.
- **Gaps.** The shared web-search budget for this session ran out partway through. For some venues I could only read pages I already had links to, or official pages whose address I could predict. These venues have thin coverage: Underdog, PrizePicks, Fanatics Markets, Gemini, Webull, IBKR ForecastEx, CME, Novig, Sporttrade, Jupiter, MetaMask, Phantom, OKX, Bitget, Truth Predict (current status), Zeitgeist, Polkamarkets, Hedgehog and Azuro (history before July 2026). The "Gaps" section at the end lists them.

### Key numbers at a glance

| Venue | Short-dated product | Latest scale (unit, date) | Trend |
|---|---|---|---|
| Limitless (Base) | Hourly and daily crypto and stock up/down, 15-min crypto | $10.75M USDC volume in Sep 2026, down from $250.9M in May 2026 (DefiLlama) | Collapsed about 96% from the May 2026 peak |
| Myriad (BNB/Abstract/Linea) | 5-minute BTC "Candles", "5-Minute Markets" | $2.71M volume in Sep 2026, down from $68.3M in Feb 2026 (DefiLlama) | Collapsed about 95% after March 2026 |
| Trueo (ex-Truemarkets) | None found; permissionless long-tail markets | $797k all-time volume; $16.8k in the 30 days to 2026-10-18 (DefiLlama) | Never got traction |
| Drift BET (Solana) | None; election-led event markets | Peak about $20M/day, Aug 2024 (CryptoSlate) | Faded; the Drift protocol was hacked on 2026-04-01 and relaunched as perps only [unverified] |
| Hyperliquid HIP-4 | Daily BTC/ETH/SOL/HYPE binaries, price buckets, "touch" markets | $62.7M volume and 6,323 traders in the 30 days to 2026-10-20; $354.8M all-time (Liquidiction [unverified]) | Recurring BTC daily down 93% from its May 2026 peak; sports drives the spikes |
| PancakeSwap Prediction (BNB) | 5-minute up/down rounds on BNB, BTC, ETH | $7.31M volume in Sep 2026, down from about $15-25M/month in 2024-25 (DefiLlama) | Live for 5+ years, slowly shrinking |
| Probable (BNB, PancakeSwap/YZi) | Crypto price markets among others | $1.46B volume in Jan 2026, then about $0 from April 2026 (DefiLlama) | Cliff on 2026-03-02 |
| Overtime Speed Markets (multi-chain) | Up/down markets as short as 1 minute | Overtime overall about $7-8M/month in 2026 (DefiLlama; sportsbook and Speed Markets combined) | Flat and small |
| Robinhood | 15-minute crypto contracts on 9 coins, daily crypto, Fed/econ | 13.6B contracts and $156M event-contract revenue in Q2 2026 (SEC 8-K) | Up more than 10x year over year |
| Coinbase (Kalshi-powered) | "Crypto binaries" / "fast markets" | $100M+ annualized prediction-market revenue in Q2 2026; crypto binaries tripled daily traders (SEC 8-K deck) | Doubled quarter over quarter |

---

### 4.1 Limitless Exchange (Base)

**What it is.** Limitless is an on-chain prediction exchange on Base, settled in USDC. It describes itself as running "nonstop hourly and daily markets" on crypto and stock prices ([docs.limitless.exchange](https://docs.limitless.exchange/)). PredictionTalk lists daily, hourly and 15-minute crypto markets and says about 19,000 such markets resolve per week as of mid-2026 ([predictiontalk.org](https://predictiontalk.org/platforms/limitless/)) [unverified]. Most markets use an order book; long-tail markets use AMM pools ([theblackswans.substack.com](https://theblackswans.substack.com/p/limitless-the-prediction-market-that), sponsored post) [unverified]. One research guide says the order book is forked from Polymarket's CTF Exchange and NegRisk contracts ([blog.web3wagmi.com](https://blog.web3wagmi.com/best-prediction-markets)) [unverified]. Limitless also has user-generated markets, "Packs" of 2-3 picks with multipliers up to 15x, "Challenge a Fan" peer-to-peer markets, copy trading, leaderboards and in-chat trading ([Black Swans](https://theblackswans.substack.com/p/limitless-the-prediction-market-that)) [unverified].

**Launch and funding.**
- Launched on Base after a $3M pre-seed led by 1confirmation, announced 2024-09-17 ([PredictionTalk](https://predictiontalk.org/platforms/limitless/)) [unverified].
- Raised a further seed of about $10M in Oct 2025 ([bitcoinfoundation.org](https://bitcoinfoundation.org/news/prediction-markets/prediction-market-limitless-volume-base/)) [unverified].
- About $17M raised in total from investors including Coinbase Ventures, F-Prime and DCG ([Black Swans](https://theblackswans.substack.com/p/limitless-the-prediction-market-that)) [unverified].

**Stock products.** Limitless lists hourly and daily up/down markets on single stocks such as NVDA, TSLA, OXY and ITA.
- *How they resolve.* An hourly NVDA market compares the Pyth NVDA/USD 1-minute candle "Open" at the end of the hour with the Open at the start. The rules say "Other exchanges, spot markets, and oracles will not be used." If Pyth has a prolonged outage, the team resolves the market manually.
- *How much they trade.* The NVDA hourly market for 2026-06-24 15:00-16:00 UTC traded **$1,428** in total ([limitless.exchange NVDA hourly](https://limitless.exchange/markets/nvidia-nvda-up-or-down-hourly-1782313208124)).
- *Daily markets.* These compare the Pyth price at the end of regular trading hours with the prior trading day's price ([limitless.exchange NVDA daily](https://limitless.exchange/markets/nvidia-nvda-up-or-down-daily-1785355200)).
- *Oracles.* Pyth is the main oracle. Chainlink Data Streams was added in June 2026 for short-duration crypto markets ([PredictionTalk](https://predictiontalk.org/platforms/limitless/)) [unverified].

**Fees and market makers.**
- Takers pay a dynamic 0.40-3.00% on buys, highest at low prices: 3.00% from $0.01 to $0.50 and 0.42% at $0.99. Sells cost 0.42-1.50%. Makers pay 0%. AMM markets charge a flat 0.40% ([web3wagmi](https://blog.web3wagmi.com/best-prediction-markets) [unverified]; DefiLlama methodology at [api.llama.fi](https://api.llama.fi/summary/dexs/limitless-exchange?dataType=dailyNotionalVolume)).
- Since April 2026, makers on daily, hourly and 15-minute crypto markets get 100% of taker fees back as a daily USDC rebate ([PredictionTalk](https://predictiontalk.org/platforms/limitless/)) [unverified].
- CEO CJ Hetherington told Bernstein that Limitless is "rebating 100% of its revenue to market makers" as it prioritises growth ([The Block, 2026-06-17](https://www.theblock.co/news/markets/2026-06-17-limitless-ceo-no-prediction-market-platform-will-dominate-perpetual-futures-precedent-405086)).
- DefiLlama says no trading fees reach LMTS holders on-chain today ([DefiLlama methodology](https://api.llama.fi/summary/dexs/limitless-exchange?dataType=dailyNotionalVolume)).

**Volume: headline claims.**
- Bernstein estimated Limitless "clears close to $2 billion in monthly volume" ([The Block, 2026-06-17](https://www.theblock.co/news/markets/2026-06-17-limitless-ceo-no-prediction-market-platform-will-dominate-perpetual-futures-precedent-405086)).
- A sponsored newsletter gives notional volume of about $345.2M in Q4 2025, about $1.03B in Q1 2026 and about $1.53B in Q2 2026. It gives revenue of $0.95M, $2.95M and $8.11M for the same quarters ([Black Swans, 2026-08-26](https://theblackswans.substack.com/p/limitless-the-prediction-market-that)) [unverified].

**Volume: on-chain data.** My monthly sums of DefiLlama's daily series ([notional](https://api.llama.fi/summary/dexs/limitless-exchange?dataType=dailyNotionalVolume), [USDC volume](https://api.llama.fi/summary/dexs/limitless-exchange?dataType=dailyVolume), pulled 2026-10-20):

- *USDC volume (dollars that changed hands):*
  - 2024-25 cycle: $37.7M (Jan 2025), falling to $4.46M (Aug 2025).
  - Pre-token jump: $85.95M (Sep 2025) and $102.8M (Oct 2025, the month of the token launch).
  - 2026 ramp: $47.2M (Jan), $72.5M (Feb), $91.0M (Mar), $102.8M (Apr), **$250.9M (May)**.
  - Decline: $173.0M (Jun), $85.9M (Jul), $27.5M (Aug), **$10.75M (Sep)**, $0.69M (Oct 1-20).
- *Notional volume (shares at $1):* $1,040M in Q1 2026 and $1,537M in Q2 2026. These match the newsletter's "notional" figures, so the headline numbers count shares at $1, not dollars spent. The peak month was May 2026 at $698.9M notional, falling to $38.0M in Sep 2026.
- *Daily notional:* $50-59M/day from 2026-05-25 to 2026-06-03, which annualises to about $1.6-1.8B/month. That is probably the run-rate Bernstein saw. It halved to $29.6M on 2026-06-04 and was about $0.06-0.40M/day in October 2026.
- Activity grows or shrinks gradually rather than stopping overnight, which suggests real activity changes rather than a tracking break. I could not confirm whether any volume moved to contracts DefiLlama does not track.

**Token and incentives.**
- LMTS launched on 2025-10-22 with a 1B supply and about 13.16% circulating. 24.37% of supply is for ecosystem incentives and airdrops ([Bitget news](https://www.bitget.com/news/detail/12560605029290), [CoinEx](https://www.coinex.com/en/feed/news/68f7ae6fa23bd701bb85b3c2)) [unverified].
- The token lost more than half its value on day one. A team-linked wallet moved about 15M tokens to a selling address. The team called this market-maker stabilisation ([Mitrade](https://www.mitrade.com/insights/news/live-news/article-3-1215023-20251023), [Cryptopolitan](https://www.cryptopolitan.com/limitless-project-token-lmts-crashes-after-team-sells-soon-after-launch/)) [unverified].
- The airdrop went to Season 1 points traders and to Wallchain "Quackers" participants ([PANews](https://www.panewslab.com/en/articles/66462071-5b7d-4789-ba48-3344b2e43cff)) [unverified].
- A cliff unlock of about 85.37M LMTS ("nearly 65% of released supply") was due on 2026-04-22. Points Season 4 reportedly started 2026-05-25 and ends 2026-10-26 ([CoinMarketCap AI updates](https://coinmarketcap.com/cmc-ai/limitless-lmts/latest-updates/), auto-generated) [unverified].
- LMTS was about $0.035 on 2026-10-01 (same source) [unverified]. Another guide put it at $0.0322, about a $4M market cap ([web3wagmi](https://blog.web3wagmi.com/best-prediction-markets)) [unverified].
- A sponsored post says Limitless "has replaced points with a referral model that pays in USDC". Referrers earn 10-40% of referred users' fees ([Black Swans](https://theblackswans.substack.com/p/limitless-the-prediction-market-that)) [unverified]. That conflicts with the Season 4 report above.

**Users and behaviour.**
- Users are about 60% Asia-Pacific and 30% Europe. Hetherington said "the top 5% to 10% of users generate most platform volume", and that one account can be a trading desk.
- He called the industry's 80-90% retention claims "stupid numbers" inflated by automated trading.
- He said "some of the largest traders on other platforms are also the largest traders on our platform" (all from [The Block, 2026-06-17](https://www.theblock.co/news/markets/2026-06-17-limitless-ceo-no-prediction-market-platform-will-dominate-perpetual-futures-precedent-405086)).
- Limitless Markets US, LLC applied to be a CFTC Designated Contract Market (DCM). The application was deemed materially complete on 2026-05-01 ([Black Swans](https://theblackswans.substack.com/p/limitless-the-prediction-market-that)) [unverified].

**Criticism.**
- *Wash trading.* I found no published wash-trading investigation. The structure invites it, though: makers pay nothing and get 100% of taker fees back, so recycling volume costs almost nothing. Volume also tracks incentive seasons closely. The 2025 trough of $4.46M in Aug 2025 jumped 19x to $86M in Sep 2025, just before the token launch, and the May 2026 peak was followed by a 96% fall.
- *Gambling framing.* The sponsored deep-dive itself flags that short-duration markets "may feel closer to gambling than forecasting" and that growth may not hold "once incentives cool" ([Black Swans](https://theblackswans.substack.com/p/limitless-the-prediction-market-that)) [unverified].
- *Arbitrum grant.* An auto-generated summary says that in September 2026 an Arbitrum DAO watchdog labelled the team's conversion of a 75,000 ARB grant "suspected theft" ([CoinMarketCap AI](https://coinmarketcap.com/cmc-ai/limitless-lmts/latest-updates/)) [unverified].

**Takeaway.** Limitless proves crypto traders will churn hourly and 15-minute markets at scale while points and rebates pay for it. Short-dated *stock* binaries trade only four-figure dollar amounts per market. Volume is concentrated in a few professional accounts and fell about 96% within four months of the May 2026 peak.

### 4.2 Myriad Markets (Abstract, Linea, BNB Chain)

**What it is.**
- Myriad is a prediction market run by DASTAN, the parent of Decrypt and Rug Radio. It launched in March 2025 ([Decrypt, 2025-09-01](https://decrypt.co/337489/myriad-hits-10m-usdc-trading-volume-as-prediction-markets-become-new-segment-of-defi); [Trust Wallet](https://trustwallet.com/blog/academy/how-to-trade-on-myriad-markets-in-trust-wallet)).
- Markets render inside Decrypt articles. The president described a media cycle: "coverage drives attention, attention drives volume" ([Yahoo/Decrypt, 2025-11-24](https://finance.yahoo.com/news/prediction-market-myriad-hits-100m-135933557.html)).
- It started on Abstract and expanded to Linea (July 2025) and BNB Chain (October 2025).
- Season 3 moved event contracts to BNB Chain, with World Liberty Financial's USD1 as the sole settlement asset. Myriad announced a move from AMM to an order book with a seed round on 2026-03-19. Investors include MoonPay Ventures and Tom Lee ([Yahoo/Decrypt, 2026-03-19](https://finance.yahoo.com/markets/crypto/articles/prediction-market-myriad-closes-milestone-162400075.html)).

**Short-term products.**
- "Automated Markets" launched on BNB Chain in October 2025. They are built for "auto-resolution, short timeframes, and continuous trading flow" ([Yahoo/Decrypt](https://finance.yahoo.com/news/prediction-market-myriad-hits-100m-135933557.html)).
- "Candles" launched on 2026-01-14 as the first USD1 product, for non-US users only ([Chainwire, 2026-01-14](https://chainwire.org/2026/01/14/myriad-launches-first-prediction-market-using-world-liberty-financial-stablecoin-usd1/)).
- The BTC Candles page asks users to "Predict candle colors every 5 minutes". It notes "Points and USD₮ markets available, depending on your country", so free-to-play points markets exist alongside money markets ([myriad.markets/candles/btc](https://myriad.markets/candles/btc)).
- Decrypt's guide describes a "5-Minute Markets" section as "the home of quick-fire and instant payout markets" ([Decrypt guide, updated 2026-05-15](https://decrypt.co/resources/getting-started-with-myriad)).
- Chainlink resolves BTC/ETH/BNB/SOL price markets from May 2026 ([web3wagmi](https://blog.web3wagmi.com/best-prediction-markets)) [unverified].

**Fees.**
- AMM buys cost 0-2%, plus about $0.0085 per transaction for gas ([Decrypt guide](https://decrypt.co/resources/getting-started-with-myriad)).
- DefiLlama's methodology says AMM fees are "usually 3%". The order-book taker fee peaks near 1% at $0.50, and makers pay 0% ([api.llama.fi](https://api.llama.fi/summary/dexs/myriad-markets?dataType=dailyVolume)).

**Users: headline claims.**
- Over 500,000 users, more than 5.4M predictions and $10M USDC volume by 2025-09-01 ([Decrypt](https://decrypt.co/337489/myriad-hits-10m-usdc-trading-volume-as-prediction-markets-become-new-segment-of-defi)).
- $100M volume, 6.3M trades and 400,000+ "active traders" by 2025-11-24 ([Yahoo/Decrypt](https://finance.yahoo.com/news/prediction-market-myriad-hits-100m-135933557.html)).
- More than $150M cumulative volume and 511,000 users (Trust Wallet article, updated 2026-07-17) ([Trust Wallet](https://trustwallet.com/blog/academy/how-to-trade-on-myriad-markets-in-trust-wallet)).
- $100M across 400,000 traders is only about $250 of volume per "trader" over the period. Points players are probably counted.

**Volume: on-chain data.** My monthly sums of DefiLlama's daily series ([volume](https://api.llama.fi/summary/dexs/myriad-markets?dataType=dailyVolume), [notional](https://api.llama.fi/summary/dexs/myriad-markets?dataType=dailyNotionalVolume), pulled 2026-10-20). DefiLlama's data starts 2025-07-07.
- *2025:* $1.46M (Jul), $3.59M (Sep), **$36.4M (Oct, BNB Chain and Automated Markets launch)**, $22.9M (Nov), $14.4M (Dec).
- *2026 peak:* $10.9M (Jan), **$68.3M (Feb)**, **$60.2M (Mar)**.
- *Collapse:* $4.04M (Apr), $3.37M (May), $1.27M (Jun), $0.87M (Jul), $1.72M (Aug), $2.71M (Sep), $0.23M (Oct 1-20).
- *Spiky days:* in March 2026, daily volume swung from $7.0M on 2026-03-16 to $87k on 2026-03-17. That pattern looks like campaign or whale flow, not organic retail.
- TVL was about $229k ([web3wagmi](https://blog.web3wagmi.com/best-prediction-markets)) [unverified].

**Points and incentives.**
- Weekly "MYR Points" reward resting limit orders near the midpoint and maker volume, with a token launch as the stated goal ([web3wagmi](https://blog.web3wagmi.com/best-prediction-markets)) [unverified].
- Contests include a $30k AceTrader contest with 200,000 Myriad Points (Feb 2026) ([Yahoo](https://finance.yahoo.com/news/acetrader-teams-myriad-30k-prediction-175332668.html)). There was also a $100k World Cup competition with weekly maker-volume rewards, "double MYR points and zero trading fees" ([Decrypt, 2026-05-28](https://decrypt.co/369291/prediction-market-myriad-launches-100k-world-cup-competition)).
- No token had launched as of the sources read.

**Takeaway.** Myriad has distribution most crypto startups lack: a newsroom and a Trust Wallet integration. It still lost about 95% of volume after Q1 2026. Its 5-minute candles look like PancakeSwap's game, but the volume followed seasons, chain migrations and contests rather than the product.

### 4.3 Trueo (formerly Truemarkets) (Base, moving to Ethereum)

- **Launch and rename.** It launched on Base in March 2025 as a permissionless prediction market ([Incrypted](https://incrypted.com/en/trueo-will-move-from-base-to-ethereum-buterin-backed-the-projects-decision/)). It rebranded from Truemarkets to Trueo ([Basescan token page](https://basescan.org/token/0x21cfcfc3d8f98fc728f48341d10ad8283f6eb7ab?a=0x77e7c5cbeaad915cf5462064b02984e16a902e67)), reportedly after a trademark conflict ([web3wagmi](https://blog.web3wagmi.com/best-prediction-markets)) [unverified].
- **Products.** Anyone can create a yes/no market, and creators earn fees. Collateral is TYD, a yield-bearing dollar minted from USDC ([AirdropAlert](https://airdropalert.com/blogs/what-is-true-token/)) [unverified]. TYD is reportedly an ERC-4626 vault built with Yearn ([web3wagmi](https://blog.web3wagmi.com/best-prediction-markets)) [unverified]. I found **no short-dated product**.
- **Oracle.** TRUE stakers resolve markets and vote on disputes, with bonds that are lost for dishonest resolution ([AirdropAlert](https://airdropalert.com/blogs/what-is-true-token/)) [unverified]. One guide gives a 250 TYD resolver bond, a 12-hour dispute window, an Oracle Council, and escalation to staked TRUE holders ([web3wagmi](https://blog.web3wagmi.com/best-prediction-markets)) [unverified].
- **Volume.** All-time volume is **$797k**; the best month was Apr 2025 at $0.33M; volume in the 30 days to 2026-10-18 was **$16.8k** ([DefiLlama API](https://api.llama.fi/summary/dexs/trueo?dataType=dailyVolume), my sums).
- **Move to Ethereum.** On 2026-09-22 Trueo said Ethereum mainnet would be its primary deployment and home of its next oracle. It advised against new Base markets expiring after 2027-01-31 ([Incrypted](https://incrypted.com/en/trueo-will-move-from-base-to-ethereum-buterin-backed-the-projects-decision/)). Vitalik Buterin endorsed the move ("ethical and not corposlop") and TRUE rose 900% in 24 hours ([The Defiant](https://thedefiant.io/news/defi/vitalik-buterin-backs-trueo-ethereum-move-true-jumps-900)).
- **Takeaway.** Open market creation plus a staked oracle produced almost no trading: under $1M lifetime. The token reacts to endorsements, not usage.

### 4.4 Drift BET (Solana)

- **Launch.** BET launched in mid-August 2024, the week of 2024-08-19 ([Unchained, 2024-08-22](https://unchainedcrypto.com/drifts-new-predictions-market-not-trying-to-vampire-attack-polymarket-says-co-founder/); [The Block](https://www.theblock.co/post/311888/solana-based-drift-protocol-launches-prediction-market)). It ran on Drift's perps infrastructure.
- **Design.**
  - 30+ collateral types (SOL, USDC, mSOL and others) that kept earning lending yield.
  - Hedging against perps in the same account.
  - Drift's existing deposits of over $500M available for liquidity ([Crypto.com Research, Aug 2024](https://crypto.com/us/research/prediction-market-aug-2024)).
  - Users could not create markets; an in-house security council listed and arbitrated them ([DL News, 2024-08-02](https://www.dlnews.com/articles/defi/polymarket-rival-drift-to-launch-solana-predication-market/)).
  - Traders earned FUEL rewards ([Crypto.com Research](https://crypto.com/us/research/prediction-market-aug-2024)).
- **Peak.**
  - Order-book liquidity passed $3.5M in the first 24 hours ([Decrypt](https://decrypt.co/245565/new-solana-based-polymarket-rival-from-drift-draws-over-3-million-in-liquidity)).
  - BET hit $20M in 24-hour volume in late August 2024. Over $20M of the political bets sat on one market, Harris winning the popular vote. Trade count fell over the same three days, "raising questions about how the $20 million volume was achieved" ([CryptoSlate, 2024-08-29](https://cryptoslate.com/prediction-market-newcomer-bet-on-solana-hits-20-million-milestone-in-24-hour-trading-volume/)).
  - BET beat Polymarket's daily volume on 2024-08-29. Over 2024-08-18 to 08-31 it had about $24M in bets against Polymarket's $212M ([Crypto.com Research](https://crypto.com/us/research/prediction-market-aug-2024)).
- **Why it faded.**
  - *Election dependence.* At launch it was almost all US-election markets ([DL News](https://www.dlnews.com/articles/defi/polymarket-rival-drift-to-launch-solana-predication-market/)). Crypto.com Research warned that election-centred volume has to be replaced after the vote, and that "evergreen" sports recur ([Crypto.com Research](https://crypto.com/us/research/prediction-market-aug-2024)).
  - *No post-election data.* I found no BET volume data after November 2024, and DefiLlama has no BET series.
  - *The hack.* On 2026-04-01 Drift Protocol lost about $285-295M in 12 minutes. The attacker used fake collateral (a token called CVT) plus pre-signed multisig transactions, with a timelock removed on 2026-03-27 ([Bitcoin.com News](https://news.bitcoin.com/drift-protocol-hack-2026-what-happened-who-lost-money-and-whats-next/); [TRM Labs](https://www.trmlabs.com/resources/blog/north-korean-hackers-attack-drift-protocol-in-285-million-heist)).
  - *Relaunch.* The venue returned in July 2026 as "Velocity", described only as a perpetuals venue. Debt-token (DFX) claims on a recovery pool of about 3.1M USDT opened on 2026-10-01 ([The Industry Spread, 2026-10-03](https://theindustryspread.com/drift-protocol-opens-dfx-claims-thin-recovery-pool/)) [unverified]. None of the relaunch coverage I read mentions BET, so I treat it as not active [unverified].
- **Takeaway.** BET had liquidity and collateral advantages on day one. It still lived and died on one event cycle with incentive-flavoured volume, and the parent protocol's security failure ended it.

### 4.5 Hyperliquid HIP-4 outcome markets (and HIP-3 stock perps)

**Timeline.**
- 2026-02-02: HIP-4 announced and launched on testnet.
- 2026-05-02: mainnet launch with validator-curated markets only. The first market was a recurring daily BTC binary settling at 06:00 UTC against the HyperCore mark price ([Bitcoin.com News, 2026-05-02](https://news.bitcoin.com/hyperliquid-launches-hip-4-and-targets-polymarket-with-zero-fee-outcome-markets/); [Hyperliquid docs](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-4-outcome-markets)).
- The proposal was co-authored by Bedlam Research and John Wang, Kalshi's head of crypto ([Chainstack](https://chainstack.com/hyperliquid-hip4-vs-polymarket-2026/)) [unverified].
- Rollout after launch ([Datawallet](https://www.datawallet.com/crypto/hip-4-explained-hyperliquid-upgrade)) [unverified]:
  - 3-way BTC price buckets within a week.
  - CPI and Fed questions in late May.
  - Sports in June.
  - ETH/SOL/HYPE daily binaries on 2026-06-12.
- 2026-08-29: permissionless deployment.

**Design.**
- *Fully collateralised.* "Outcomes are fully collateralized contracts that settle within a fixed range." The docs give prediction markets and "bounded options-like instruments" as example uses ([Hyperliquid docs](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-4-outcome-markets)). Prices run from 0.001 to 0.999, with no leverage, funding or liquidation. Positions sit in the same account as spot and perps ([Bitcoin.com](https://news.bitcoin.com/hyperliquid-launches-hip-4-and-targets-polymarket-with-zero-fee-outcome-markets/)).
- *Collateral.* Launch coverage said USDH. A later explainer says USDC after USDH pairs were wound down ([Datawallet](https://www.datawallet.com/crypto/hip-4-explained-hyperliquid-upgrade)) [unverified].
- *Opening auction.* Each market opens with an auction of about 15 minutes ([Bitcoin.com](https://news.bitcoin.com/hyperliquid-launches-hip-4-and-targets-polymarket-with-zero-fee-outcome-markets/)). Datawallet disputes this ([Datawallet](https://www.datawallet.com/crypto/hip-4-explained-hyperliquid-upgrade)) [unverified].
- *Fees.* Opening is free. Fees apply on close, burn or settlement, and makers get no rebates ([Bitcoin.com](https://news.bitcoin.com/hyperliquid-launches-hip-4-and-targets-polymarket-with-zero-fee-outcome-markets/)). The docs said fees were "currently zero for initial testing" ([docs](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-4-outcome-markets)). Hyperliquid reportedly said on 2026-08-14 that the next upgrade would bring fees averaging half the spot rate ([Datawallet](https://www.datawallet.com/crypto/hip-4-explained-hyperliquid-upgrade)) [unverified].
- *Deployer stake.* Each deployer posts a 500,000 HYPE bond, locked at least six months, and uses validator-approved templates ([crypto.news, 2026-09-03](https://crypto.news/hyperliquid-hip-4-volume-triples-after-open-rollout/)). Pre-launch coverage said 1M HYPE ([Bitcoin.com](https://news.bitcoin.com/hyperliquid-launches-hip-4-and-targets-polymarket-with-zero-fee-outcome-markets/)).

**Market types.** Daily binaries, price buckets, "touch" markets (e.g. "HYPE touches $100 by October 1"), macro prints, sports and multi-outcome "Questions" ([Datawallet](https://www.datawallet.com/crypto/hip-4-explained-hyperliquid-upgrade)) [unverified]. Deployers are Outcome.xyz, Skew Markets and Events by TradeXYZ ([loris.tools](https://loris.tools/hip4)).

**Volume and users.**
- *Launch day.* First hours of the launch BTC market: $54,026 volume and $79,938 open interest ([Chainstack, 2026-05-04](https://chainstack.com/hyperliquid-hip4-vs-polymarket-2026/)) [unverified].
- *Cumulative to 2026-10-05:* about $317M.
  - Monthly: $51M in Sep 2026, and about $1.25M/day in early October.
  - Mix: soccer World Cup was $89.5M (28%) of the total. Over the prior 30 days, sports were 45% and crypto price markets 42%.
  - Recurring BTC: volume in the recurring BTC market was **down 93% from its May peak** ([TokenPost, 2026-10-13](https://www.tokenpost.com/news/investing/31004); [TokenPost, 2026-10-07](https://www.tokenpost.com/news/investing/27723)).
- *Dashboard to 2026-10-20 06:56 UTC:*
  - 30-day: $62.7M volume, 2.24M trades, **6,323 unique traders**.
  - All-time: $354.8M volume, 22,099 unique traders, 13,168 markets deployed.
  - 98% of the 276 open markets are settled by third-party deployers ([Liquidiction](https://liquidiction.xyz/hip4/stats)) [unverified].
  - A third-party post claims $520M cumulative with a daily peak of $12.96M on 2026-06-27 ([KuCoin repost](https://www.kucoin.com/news/insight/HIP/6acb0a3944c213000789203c)) [unverified].
- *After permissionless deployment:* August daily average about $545k, versus $1.97M on 2026-08-31. Outcome had about 85% of volume, helped by a $1M rebate campaign paying about 1 cent per dollar traded ([crypto.news](https://crypto.news/hyperliquid-hip-4-volume-triples-after-open-rollout/)).

**Criticism and why it lags.**
- *Thin books.* A $10k market buy typically fills 2-3% above the best ask, and four or five of the top 25 books could not absorb it.
- *Fragmentation.* A Fed market had $354k of 7-day volume on Outcome but $90 on Trade.xyz.
- *Incentives cost more than fees.* Annualised fees were about $480k against rewards of about $2.7M annualised ([TokenPost, 2026-10-07](https://www.tokenpost.com/news/investing/27723)).
- *Settlement control.* 223 of 228 active markets use deployer-controlled settlement with no formal dispute period ([TokenPost, 2026-10-13](https://www.tokenpost.com/news/investing/31004)).
- *Options framing.* Mario Chow said HIP-4 resembles an "options ticket" more than Polymarket ([TokenPost](https://www.tokenpost.com/news/investing/27723)).

**HIP-3 (builder-deployed perps), the stock exposure that did stick.**
- *Trade.xyz scale.* Trade.xyz's first market, XYZ100 (Nasdaq-100), began trading on 2025-10-13. By 2026-10-03 it listed 110 perps: 76 stocks, 17 ETFs, 9 commodities, 4 indices, 3 FX and 1 pre-IPO.
  - September 2026 volume was **$59.38B**, 97.5% of HIP-3 volume and 23.9% of all Hyperliquid perp volume.
  - The median share of Hyperliquid volume was 25.5% on weekdays and 11.6% on weekends. Weekend volume averaged about $541M/day.
  - Off-hours, the oracle freezes the external price and tracks Trade.xyz's own order book, smoothed over 30 minutes and bounded.
  - Leverage is mostly 10x on single stocks. "Growth mode" fees are 0.009% taker and 0.003% maker ([0xArchive, 2026-10-04](https://0xarchive.io/resources/market-data-guides/what-is-tradexyz)) [unverified].
- *Share of Hyperliquid.* HIP-3's share of Hyperliquid perp volume rose from about 2% at the start of 2026 to about 50% by 2026-07-13 ([The Block](https://www.theblock.co/news/defi/2026-07-13-hyperliquid-hip-3-markets-surge-50-perp-volume-onchain-stock-trading-grows-408064)).
- *Pre-IPO perps.* SpaceX and Cerebras pre-IPO perps converted to normal stock perps ([0xArchive](https://0xarchive.io/resources/market-data-guides/what-is-tradexyz)) [unverified]. Ventures, a large pre-IPO perp deployer (OpenAI, Anthropic), is shutting down after about $650M of volume. The market blamed Trade.xyz pulling liquidity plus "liquidity and pricing problems in pre-IPO assets" ([PANews](https://panews.io/articles/019ecf58-5c89-7115-b50c-3ba9359c11cd)) [unverified].
- *Winner-take-most.* Felix also shut its HIP-3 DEX on 2026-06-19 after about $3B of volume. An analyst estimated most non-Trade.xyz deployers earn about 1% or less on staked HYPE, against Trade.xyz's estimated 74% ([PANews](https://panews.io/articles/019ecf58-5c89-7115-b50c-3ba9359c11cd)) [unverified].

**Takeaway.** On Hyperliquid, stock perps with 24/7 trading and no expiry reached tens of billions a month. Fully collateralised outcome markets on the same engine, with zero fees at first, reached tens of millions a month. Their daily crypto binaries fell 93% from the launch peak, and World Cup sports made the biggest days.

### 4.6 PancakeSwap Prediction, Probable, other BNB venues, and round-based games

#### 4.6a PancakeSwap Prediction (BNB Chain, live since 2021)

- **Mechanics.**
  - Rolling 5-minute rounds on BNBUSD, BTCUSD and ETHUSD. All stakes are in BNB; CAKEUSD is paused, and zkSync Era and Arbitrum are paused.
  - The pool is pari-mutuel: winners share the pot minus a 3% fee, in proportion to their stakes. On a tie, "the house wins all bets". With no opposing bets, a winner gets back 97%.
  - Chainlink sets the lock and close prices, updating about every 20 seconds. Binance prices on the chart are "for reference only" ([PancakeSwap docs](https://docs.pancakeswap.finance/play/prediction)).
  - Fees fund CAKE buyback-and-burn ([DefiLlama methodology](https://api.llama.fi/summary/dexs/pancakeswap-prediction?dataType=dailyVolume)).
- **History.** The beta opened on April 28 with BNB/USDT only ([BeInCrypto ES](https://es.beincrypto.com/pancakeswap-libera-version-beta-prediccion-mercado/)), in 2021 Q2 per a wiki timeline (pm.wiki, now redirects) [unverified]. BTC and ETH markets came later. A Telegram mini-app bot launched for PancakeSwap's 4th birthday, around September 2024 ([Decrypt](https://decrypt.co/248935/pancakeswap-launches-telegram-prediction-bot-for-forecasting-bnb-prices); [PancakeSwap blog](https://blog.pancakeswap.finance/articles/pancake-swap-celebrates-4th-birthday-with-first-ever-prediction-telegram-bot-and-4-444-in-rewards)).
- **Volume.** From the DefiLlama daily series ([volume](https://api.llama.fi/summary/dexs/pancakeswap-prediction?dataType=dailyVolume) from 2024-09-24, [fees](https://api.llama.fi/summary/fees/pancakeswap-prediction?dataType=dailyFees) from 2024-01-01), summed by me:
  - Fees per month: about $0.46-0.79M in 2024 and $0.46-0.77M in 2025, falling through 2026 to $0.22M in Sep 2026.
  - Volume per month: $15-26M from Oct 2024 to Jan 2026, then $13.6M (Feb 2026), $10.1M (Jun), $7.3M (Sep). Volume in the 30 days to 2026-10-20 was **$8.13M**, and the last 12 months totalled $152.2M.
  - Back-of-envelope: three markets running 288 rounds/day each means about 864 rounds/day. At about $244k/day in Sep 2026, the average pot is roughly $280 per round (my estimate).
  - The volume is steady but trending down: fees fell about 55-65% from 2024 to Sep 2026.
- **Bots.**
  - Many open-source bots exist. One bets the side with more money in the last N seconds before lock ([kallydev](https://github.com/kallydev/pancakeswap-prediction-bot)).
  - Another exploits the gap between Binance prices and slower Chainlink updates. Its author found "the higher the extra return, the lower the possibility of winning", and concluded simple payout arbitrage "cannot produce extra return" after adjusting ([xcnecon](https://github.com/xcnecon/PancakeSwap-Arbitrage-Bot)).
  - One cleaned-up fork notes the original bot carried malicious code that sent transactions to the author's wallet ([lmusarella](https://github.com/lmusarella/Pancakeswap-Prediction-Bot-2023)).
  - I found no rigorous on-chain study of how much of the volume is bots [gap]. Bots betting in the last seconds before lock against a slower oracle are the known edge in this format.
- **Takeaway.** This is the clearest long-lived short-dated on-chain product: 5+ years and about $150M a year. It needs no market maker because the pool is pari-mutuel, it is simple to understand, and the next round always starts in under 5 minutes. It is small and shrinking, and it is a game, not a market. Bettors pay 3% to a house that keeps everything.

#### 4.6b Probable (BNB Chain, incubated by PancakeSwap with YZi Labs)

- **Launch.** Announced 2025-12-16 with "zero prediction fees at launch". Any deposit converts to USDT, and UMA's Optimistic Oracle settles markets ([The Block](https://www.theblock.co/post/382685/pancakeswap-prediction-market-probable-bnb); [PancakeSwap blog](https://blog.pancakeswap.finance/articles/probable-prediction-market)). PancakeSwap added it to its interface on 2025-12-19 ([Yahoo/CCN](https://finance.yahoo.com/news/yzi-labs-chases-prediction-market-123715767.html)).
- **Early volume.** CoinDesk said Probable passed $1B cumulative volume by late January 2026. Dune showed BNB Chain prediction-market volume past $20B cumulative, and Opinion Labs logged over $700M in 7 days ([CoinDesk, 2026-01-27](https://www.coindesk.com/markets/2026/01/27/bnb-rises-2-5-nears-usd900-mark-as-prediction-market-growth-signals-utility-expansion)).
- **DefiLlama ([api.llama.fi](https://api.llama.fi/summary/dexs/probable?dataType=dailyVolume), my sums):**
  - $154M (Dec 2025), **$1.46B (Jan 2026)**, $1.28B (Feb 2026), $79M (Mar 2026). Almost all of March came on 1-4 March.
  - Then $0.01-0.03M a month from April 2026; the 30 days to 2026-10-20 total **$2,074**.
  - Daily volume was $53-71M through 2026-03-01, then $10.2M on 03-02, $3.5M on 03-04, $0.24M on 03-05, and four figures after that.
- **Cause.** I could not confirm why (search budget ran out). A drop of more than 99.9% within four days, on a zero-fee venue, looks like an incentive or airdrop programme ending rather than users drifting away [unverified inference].

#### 4.6c Other BNB Chain venues (for context)

- **Opinion** (notional, [DefiLlama](https://api.llama.fi/summary/dexs/opinion?dataType=dailyNotionalVolume)): $3.85B (Nov 2025), $5.49B (Dec), **$6.98B (Jan 2026)**, $3.09B (Feb), then $0.50-0.88B a month from March; $0.61B in Sep 2026.
- **Predict.fun** (notional, [DefiLlama](https://api.llama.fi/summary/dexs/predict-fun?dataType=dailyNotionalVolume)): $0.57B (Jan 2026), **$1.55B (Apr 2026)**, $0.59B (Sep 2026).
  - Binance added a "Prediction" tab on 2026-04-10 with Predict.fun as launch partner. It uses gasless keyless (MPC) wallets, and Binance is "not a market counterparty" ([Trending Topics](https://www.trendingtopics.eu/binance-enters-prediction-markets-with-predict-fun-integration-on-bnb-chain/)). That fits Predict.fun's April peak.
  - Predict.fun reported over $1.8B cumulative volume and 130,000 registered users by April 2026, and airdropped initial points to memecoin traders and Aster users ([LBank explainer](https://www.lbank.com/explore/predict-fun-bnb-chain-prediction-market-explained)) [unverified].

#### 4.6d Overtime (formerly Thales) Speed Markets

- **Product.** Speed Markets are on-chain up/down markets on crypto prices "as short as 1 minute", run by Overtime, the rebranded Thales DAO. The protocol dates to 2021 on Ethereum and Optimism with Chainlink feeds ([Overtime docs](https://docs.overtime.io/learn-about-overtime/history-of-overtime)).
- **Governance.** In June 2026, OIP-263 dissolved the elected council, and OIP-265 ended public liquidity provision. The treasury is now the sole house, and revenue goes to buying and burning OVER (same source).
- **Token.** THALES migrated 1:1 to OVER. The OVER launch claimed "over $200 million in volumes and 50,000 active users" ([Crypto Briefing](https://cryptobriefing.com/overtime-launches-over-token-and-full-account-abstraction-ux/)) [unverified].
- **Volume.** DefiLlama ([volume](https://api.llama.fi/summary/dexs/thales?dataType=dailyVolume), [fees](https://api.llama.fi/summary/fees/thales)) combines sportsbook and Speed Markets stakes:
  - About $5-15M a month in 2025, about $7-8M a month in 2026, and $108.3M over the last 12 months.
  - "Fees" here means bettors' net losses to the house: $2.84M over the last 12 months.
  - Speed Markets are not broken out.
- **Takeaway.** One-minute crypto binaries against a house pool have survived for years, but as a small product.

#### 4.6e Other round-based or short products (GMX, BullX and similar)

I could not research these before the search budget ran out [gap].

### 4.7 Robinhood's prediction markets hub and Rothera

- **Launch.** The Prediction Markets Hub was added in March 2025 ([next.io, updated 2026-10-14](https://next.io/prediction-markets/robinhood/)) [unverified].
- **Contracts and revenue (SEC filings).**
  - Q1 2026: 8.8B event contracts traded. "Other transaction revenue", "primarily" event contracts, was $147M, up 320% year over year ([Q1 2026 8-K](https://www.sec.gov/Archives/edgar/data/0001783879/000178387926000061/q12026robinhoodexhibit991.htm)). The Q1 10-Q reportedly shows $104M of event-contract revenue ([10-Q](https://www.sec.gov/Archives/edgar/data/0001783879/000178387926000062/hood-20260331.htm)) [unverified, not read directly].
  - Q2 2026: a record **13.6B contracts** ("over 10x" year over year) and **$156M** event-contract revenue, versus $10M in Q2 2025. Transaction revenue rose 44% to $776M. Funded customers were 28.4M ([Q2 2026 8-K, 2026-07-29](https://www.sec.gov/Archives/edgar/data/0001783879/000178387926000113/q22026robinhoodexhibit991.htm)).
  - Over 30B contracts were traded in the first eight months of 2026, over 45B since launch about two years ago, and over 5B during the World Cup ([Robinhood newsroom, 2026-09-08](https://robinhood.com/newsroom/robinhood-cryptocom/)).
  - Robinhood users were "nearly a quarter" of Kalshi's volume in March 2026, per Bloomberg ([DeFi Rate](https://defirate.com/news/robinhood-launches-world-cup-prediction-markets-through-rothera/)).
- **Rothera (own exchange, joint venture with Susquehanna).**
  - The joint venture bought 90% of MIAXdx (formerly LedgerX) in January 2026 ([Robinhood newsroom](https://robinhood.com/newsroom/robinhood-prediction-markets-joint-venture/); FY2025 10-K via search results).
  - Its first contracts were self-certified on 2026-05-13 and went live in late May: MLB, Core PCE, and weekly jobless claims. Soccer followed on 2026-05-27 ([DeFi Rate](https://defirate.com/news/robinhood-launches-world-cup-prediction-markets-through-rothera/)).
  - Robinhood says Rothera "launched in June 2026" and had traded over 3.5B contracts by 2026-07-29 ([Q2 8-K](https://www.sec.gov/Archives/edgar/data/0001783879/000178387926000113/q22026robinhoodexhibit991.htm)).
- **Order routing.** Robinhood routes to Kalshi, ForecastEx and Rothera. From 2026-09-08 it also routes some football contracts to Crypto.com's CDNA and OG.com, taking equity stakes in both: Crypto.com at the $20B Citadel-led valuation, OG.com at $5B ([Robinhood newsroom](https://robinhood.com/newsroom/robinhood-cryptocom/); [Yogonet](https://www.yogonet.com/international/news/2026/09/09/126307-robinhood-expands-prediction-markets-through-cryptocom-ogcom-tieup)).
- **Short-dated products.** The crypto page lists:
  - **15-minute** price contracts on BTC, ETH, SOL, XRP, DOGE, BNB, ZEC, NEAR and HYPE.
  - Daily snapshots at 3 AM / 5 PM ET, monthly high/low contracts, and year-end contracts.
  - Activity is very concentrated in BTC. Robinhood shows unlabeled counts beside each market (probably contracts): 435,853 for the BTC 15-minute contract, 42,477 for ETH and 22,575 for SOL, against 14.8M for "When will Bitcoin hit $150k" ([robinhood.com crypto](https://robinhood.com/us/en/prediction-markets/crypto/)).
  - Other categories: sports, politics, economics (Fed, CPI, PCE, jobless claims) and culture.
- **New stock-linked products.** Cboe and Robinhood announced SEC-regulated "KPI binary options" on 2026-09-30, covering company metrics for 23 US stocks. They are expected in October 2026, with no fees through end-2026 ([Cboe IR](https://ir.cboe.com/news/news-details/2026/Cboe-and-Robinhood-Announce-Planned-Launch-of-New-KPI-Contracts-Further-Expanding-Prediction-Market-Offerings/default.aspx)).
- **Fees.** Commission varies with price. It is lower near $0.01/$0.99 and capped at $0.01 per contract. Gold members pay up to 50% less, and exchange fees for Kalshi or ForecastEx are added on top ([DeFi Rate](https://defirate.com/news/robinhood-launches-world-cup-prediction-markets-through-rothera/)). A review gives the formula as 10% × price × (1 − price), with Gold at 5% ([next.io](https://next.io/prediction-markets/robinhood/)) [unverified].
- **Regulation.** Connecticut ordered Robinhood to stop offering sports event contracts on 2026-09-10 ([search summary of defirate.com/prediction-markets/robinhood](https://defirate.com/prediction-markets/robinhood/)) [unverified]. Robinhood warns that litigation could "prevent us from offering, or continuing to offer, event contracts" ([Q2 8-K](https://www.sec.gov/Archives/edgar/data/0001783879/000178387926000113/q22026robinhoodexhibit991.htm)).
- **Takeaway.** Robinhood grew because it put prediction markets in front of 28M funded accounts, priced them close to cost, and covered recurring sports, macro prints and 15-minute crypto. Its own exchange plus Susquehanna as partner let it control listings and economics. It is not a story about a better market design.

### 4.8 Other brokers, sportsbooks and wallets (2025-26)

- **Coinbase (Kalshi-powered).**
  - Rolled out to all 50 states on 2026-01-28, with USD/USDC funding and all Kalshi markets ([Decrypt](https://decrypt.co/356236/coinbase-rolls-out-kalshi-powered-prediction-markets-across-united-states)). One early market, on what Coinbase would say on its earnings call, did only about $13k (same source).
  - The Q2 2026 earnings deck (2026-07-30) says: "$100M+ Annualized prediction markets revenue in Q2"; contracts and revenue up more than 2x quarter over quarter (106%); "Sports continue to lead, followed by crypto"; "Driving innovation in 'fast markets' which are scaling rapidly".
  - Most important for Probabl: "New crypto binaries experience drove **3x daily traders and 4x daily revenue** by quarter-end vs. May's daily average". Coming next are "Combos" (parlays) and "prosumer tools" ([SEC 8-K EX-99.1](https://www.sec.gov/Archives/edgar/data/1679788/000167978826000087/q226earningsdeck_sec.htm)).
  - Fees are Kalshi's formula, about 0.07 × p × (1−p), plus an undisclosed Coinbase markup. Coinbase agreed to buy The Clearing Company in December 2025 ([JustGamers](https://www.justgamers.net/prediction-markets/coinbases/)) [unverified].
- **Crypto.com / CDNA, OG, Truth Predict.**
  - CDNA listed Super Bowl contracts in December 2024 ([DeFi Rate](https://defirate.com/prediction-markets/crypto-com/)) [unverified].
  - Truth Predict, run through CDNA, was announced 2025-10-28 ([Wikipedia: Crypto.com](https://en.wikipedia.org/wiki/Crypto.com)). I could not confirm its 2026 status or volume [gap].
  - Crypto.com powers Fanatics Markets (Dec 2025). It launched the standalone OG app on 2026-02-03, partnered with FanDuel Predicts in June 2026, and raised a Citadel Securities-led round at $20B on 2026-07-16 ([Wikipedia](https://en.wikipedia.org/wiki/Crypto.com)).
  - Fees: $0.10 exchange plus $0.10 technology per contract on CDNA ([DeFi Rate](https://defirate.com/prediction-markets/crypto-com/)) [unverified]. OG charges up to 1.75% on most markets and $0.02 per contract on crypto, FX, commodity and index markets, and has a built-in parlay builder ([DeFi Rate index, 2026-10-10](https://defirate.com/prediction-markets/)) [unverified].
  - Regulators: cease-and-desist orders from Connecticut (2026-09-10) and Missouri (2026-09-16/17) ([DeFi Rate](https://defirate.com/prediction-markets/crypto-com/)) [unverified].
- **DraftKings Predictions.**
  - Launched 2025-12-19 in 38 states, including CA, FL, GA and TX, which have no legal sportsbooks ([DeFi Rate](https://defirate.com/news/draftkings-launches-prediction-markets-apps/)).
  - April 2026: annualised consumer volume above $1B and total volume above $2.3B. Customer acquisition cost fell more than 80% once Predictions moved into the flagship app, and "Predictions volume per customer is now above sportsbook handle per customer".
  - Per Eilers & Krejcik, about 70% of sports prediction-market consumer volume comes from states without legal sportsbooks.
  - Its own exchange, Railbird (trading as DKeX), had a market-maker programme from 2026-06-01. Its in-house market making "is already profitable". Planned 2026 spend is $200-300M ([DeFi Rate, 2026-05-08](https://defirate.com/news/draftkings-predictions-tops-2-3b-annualized-volume-railbird-launch-parlays-soon/)).
  - The Q2 2026 release gives no separate Predictions figures. Sportsbook plus prediction-market volume was $13.1B and monthly unique payers 3.6M. "Predictions is already growing faster than we anticipated" ([SEC 8-K, 2026-08-07](https://www.sec.gov/Archives/edgar/data/1883685/000188368526000027/q226-prx8kexx991.htm)).
- **FanDuel Predicts (with CME).**
  - Launched 2025-12-22 in AL, AK, SC, ND and SD ([DeFi Rate](https://defirate.com/news/fanduel-predicts-launches-in-five-states-in-partnership-with-cme-group/)).
  - Offers event contracts on the S&P 500, Nasdaq-100, oil, gas, gold, crypto and economic indicators. Sports are only offered where FanDuel has no online sportsbook. CME takes 50% of gross revenue and FanDuel bears app costs, an expected $40-50M EBITDA hit in Q4 2025 ([iGaming Business](https://igamingbusiness.com/sports-betting/fanduel-plans-gradual-rollout-prediction-market-launch/)).
  - Added Crypto.com/OG clearing in June 2026 ([Wikipedia](https://en.wikipedia.org/wiki/Crypto.com)). By October 2026 it was in all 50 states, charging 2% of potential payout and 0% for makers ([DeFi Rate index](https://defirate.com/prediction-markets/)) [unverified].
  - Flutter set aside about $300M for H2 2026 ([DeFi Rate](https://defirate.com/news/draftkings-predictions-tops-2-3b-annualized-volume-railbird-launch-parlays-soon/)).
- **Fanatics Markets.** Launched early December 2025 ([DeFi Rate](https://defirate.com/news/fanduel-predicts-launches-in-five-states-in-partnership-with-cme-group/)) with Crypto.com support ([Wikipedia](https://en.wikipedia.org/wiki/Crypto.com)). The DeFi Rate index lists CME as its exchange, which conflicts [unverified]. No volume found.
- **Underdog Predict.** Announced 2025-09-02. It routes through CDNA alongside Underdog's own Aristotle exchange ([DeFi Rate index](https://defirate.com/prediction-markets/)) [unverified].
- **PrizePicks.** Allwyn completed buying 62.3% for about $1.5B on 2026-01-16 ([Wikipedia](https://en.wikipedia.org/wiki/PrizePicks)). I could not verify details of its prediction-market product [gap].
- **Gemini Predictions.** Runs on its own Gemini Titan DCM and Gemini Olympus DCO. Takers pay 0-1.75% and makers 0-0.44%. Available in all states except eight ([DeFi Rate index](https://defirate.com/prediction-markets/)) [unverified]. Its public feed shows listings from 2025-12-23 on sports and 2026 House/Senate control ([gemini.com](https://www.gemini.com/prediction-markets)). The NY Attorney General sued Coinbase and Gemini in April 2026 ([JustGamers](https://www.justgamers.net/prediction-markets/coinbases/)) [unverified].
- **Webull.** Event contracts through Webull Futures LLC (an FCM) in sports, crypto, financials, economics, culture, climate, and science and tech, with API access ([webull.com](https://www.webull.com/prediction-markets)). Durations and fees are not stated.
- **Interactive Brokers / ForecastEx.** ForecastEx has run regulated event contracts since August 2024. In May 2026 IBKR launched a platform for contracts listed on Kalshi, CME and ForecastEx ([Wikipedia: Interactive Brokers](https://en.wikipedia.org/wiki/Interactive_Brokers)). It also receives Robinhood order flow ([Robinhood newsroom](https://robinhood.com/newsroom/robinhood-cryptocom/)).
- **CME Group.** Supplies contracts to FanDuel (until the CDNA move for sports) and to DraftKings ([DeFi Rate](https://defirate.com/news/draftkings-predictions-tops-2-3b-annualized-volume-railbird-launch-parlays-soon/)). I could not fetch CME's own event-contract page (timeout).
- **Novig.** DCM cleared in June 2026, not yet trading. Sued Missouri with Crypto.com on Oct 19 ([DeFi Rate index](https://defirate.com/prediction-markets/)) [unverified].
- **ProphetX.** Tracked for sports volume ([DeFi Rate index](https://defirate.com/prediction-markets/)) [unverified].
- **Sporttrade.** Not covered [gap].
- **Binance.** Prediction tab via Predict.fun, launched 2026-04-10 ([Trending Topics](https://www.trendingtopics.eu/binance-enters-prediction-markets-with-predict-fun-integration-on-bnb-chain/)).
- **Jupiter (Solana).** "Predict" sits under Trade, next to Spot, Stocks and Perps, with sections called "Degen", "Arcade", "Clans" and "Leaderboard" ([jup.ag/prediction](https://jup.ag/prediction)). Its liquidity source (Kalshi or Polymarket) is unconfirmed [gap].
- **Phantom.** Has a blog post titled "Phantom Secures CFTC No-Action Relief for Access to Regulated Derivatives and Event Contracts", undated ([phantom.com blog](https://phantom.com/learn/blog)). Details unverified.
- **MetaMask, OKX, Bitget.** Not verified [gap].
- **Sector scale for context.** As of 2026-10-10, Kalshi had about 76% of the $105.7B traded on US-regulated apps in the prior 30 days ([DeFi Rate index](https://defirate.com/prediction-markets/)) [unverified].

### 4.9 Failures and survivors beyond this list

- **Augur.** Launched July 2018 after a 2015 crowdfunding. Daily users fell from 265 in early July 2018 to 37 by 2018-08-08. Version 1 took 7 days to resolve; v2 (July 2020) cut that to 24 hours, switched to DAI and added an "Invalid" outcome ([Wikipedia](https://en.wikipedia.org/wiki/Augur_(software))). Crypto.com Research blamed "high gas fees and slow transactions" ([Crypto.com Research](https://crypto.com/us/research/prediction-market-aug-2024)). A 2026 reboot with a REP migration from June to August 2026 is reported ([web3wagmi](https://blog.web3wagmi.com/best-prediction-markets)) [unverified].
- **SX Bet (sports exchange, SX Rollup).** Not a failure in the data. Volume grew from $8.3M (Nov 2024) to **$141.5M (Jun 2026, World Cup)**; Jul $99.4M, Aug $54.9M, Oct 1-20 $49.9M. September is missing from the data ([DefiLlama](https://api.llama.fi/summary/dexs/sx-bet?dataType=dailyVolume), my sums). Sports recurrence keeps it alive.
- **Azuro.** DefiLlama only tracks from 2026-07-27: $4.61M in Aug 2026 and $3.81M in Sep 2026 ([DefiLlama](https://api.llama.fi/summary/dexs/azuro?dataType=dailyVolume)). Its peer-to-pool model pays LPs a yield ([Crypto.com Research](https://crypto.com/us/research/prediction-market-aug-2024)). No longer history found [gap].
- **Zeitgeist, Polkamarkets, Hedgehog.** Not on DefiLlama under the slugs I tried. No 2026 sources found before the search budget ran out [gap].

---

### 4.10 Synthesis: what makes short-term products sticky, and what kills them

#### What the evidence says is sticky

1. **Distribution to people who already have money in the app beats market design.**
   - Robinhood went from about $10M to $156M event-contract revenue (Q2 2025 to Q2 2026). It put contracts in front of 28.4M funded customers and routed to whichever exchange had liquidity ([Q2 8-K](https://www.sec.gov/Archives/edgar/data/0001783879/000178387926000113/q22026robinhoodexhibit991.htm)).
   - DraftKings cut customer acquisition cost by more than 80% when Predictions moved into the flagship app ([DeFi Rate](https://defirate.com/news/draftkings-predictions-tops-2-3b-annualized-volume-railbird-launch-parlays-soon/)).
   - Binance's tab drove Predict.fun to its best month ([Trending Topics](https://www.trendingtopics.eu/binance-enters-prediction-markets-with-predict-fun-integration-on-bnb-chain/); [DefiLlama](https://api.llama.fi/summary/dexs/predict-fun?dataType=dailyNotionalVolume)).
   - Myriad's media distribution was not enough without real-money incentives (section 4.2).
2. **Fast crypto binaries add daily users when they sit next to an existing trading habit.**
   - Coinbase's crypto binaries tripled daily traders and quadrupled daily revenue within weeks ([Coinbase Q2 deck](https://www.sec.gov/Archives/edgar/data/1679788/000167978826000087/q226earningsdeck_sec.htm)).
   - Robinhood lists 15-minute contracts on nine coins, though BTC dominates ([robinhood.com](https://robinhood.com/us/en/prediction-markets/crypto/)).
   - In each case the fast market is a feature inside a broker, not a standalone venue.
3. **Something always happening matters more than any single big event.**
   - PancakeSwap's 5-minute rounds have run for 5+ years at about $150M a year. It needs no market makers because the pool is pari-mutuel, and the next round is never more than 5 minutes away ([docs](https://docs.pancakeswap.finance/play/prediction); [DefiLlama](https://api.llama.fi/summary/dexs/pancakeswap-prediction?dataType=dailyVolume)).
   - Recurring sports are the biggest driver everywhere: 28% of HIP-4's lifetime volume was World Cup soccer ([TokenPost](https://www.tokenpost.com/news/investing/31004)), and SX Bet peaked in the World Cup month. Sports also lead at Coinbase ([deck](https://www.sec.gov/Archives/edgar/data/1679788/000167978826000087/q226earningsdeck_sec.htm)).
   - Crypto.com Research made the point in 2024: sports recur, while election volume has to be replaced ([Crypto.com Research](https://crypto.com/us/research/prediction-market-aug-2024)).
4. **Combos and parlays are the next engagement lever.** Coinbase ("Combos"), DraftKings (combos), OG (parlay builder) and Robinhood (World Cup combos) are all building them ([deck](https://www.sec.gov/Archives/edgar/data/1679788/000167978826000087/q226earningsdeck_sec.htm); [DeFi Rate](https://defirate.com/news/draftkings-predictions-tops-2-3b-annualized-volume-railbird-launch-parlays-soon/); [DeFi Rate index](https://defirate.com/prediction-markets/); [DeFi Rate Rothera](https://defirate.com/news/robinhood-launches-world-cup-prediction-markets-through-rothera/)). Limitless's "Packs" are the same idea on-chain.
5. **Owning the exchange and the market making.** Robinhood (Rothera with Susquehanna) and DraftKings (Railbird and in-house market making, "already profitable") moved to own the listing and spread economics once they had volume ([Q2 8-K](https://www.sec.gov/Archives/edgar/data/0001783879/000178387926000113/q22026robinhoodexhibit991.htm); [DeFi Rate](https://defirate.com/news/draftkings-predictions-tops-2-3b-annualized-volume-railbird-launch-parlays-soon/)).
6. **For stock exposure, perps beat short-dated binaries.**
   - Trade.xyz stock perps did $59.38B in Sep 2026 ([0xArchive](https://0xarchive.io/resources/market-data-guides/what-is-tradexyz)) [unverified]. HIP-4 outcomes did about $51M that month ([TokenPost](https://www.tokenpost.com/news/investing/31004)).
   - A Limitless hourly NVDA binary did $1,428 ([limitless.exchange](https://limitless.exchange/markets/nvidia-nvda-up-or-down-hourly-1782313208124)).
   - Even perps lose over half their share at weekends: 11.6% versus 25.5% on weekdays ([0xArchive](https://0xarchive.io/resources/market-data-guides/what-is-tradexyz)) [unverified].

#### What made venues fail or fade

1. **Incentive cliffs.** The strongest pattern in the data:
   - Probable: about $1.3-1.5B a month, then about $0 within four days of 2026-03-01.
   - Limitless: down 96% from May to September 2026, with a 19x jump just before its 2025 token launch.
   - Myriad: down 95% after March 2026.
   - Opinion: down 90%+ from January 2026.
   - HIP-4: rewards about 5.6x fees.
   - Drift BET: FUEL-subsidised, with falling trade count during its $20M day.
   - (All DefiLlama series above, plus [TokenPost](https://www.tokenpost.com/news/investing/27723) and [CryptoSlate](https://cryptoslate.com/prediction-market-newcomer-bet-on-solana-hits-20-million-milestone-in-24-hour-trading-volume/).)
   - Where volume is paid for, it leaves when payment stops. Limitless's CEO himself calls industry retention numbers inflated by automated trading ([The Block](https://www.theblock.co/news/markets/2026-06-17-limitless-ceo-no-prediction-market-platform-will-dominate-perpetual-futures-precedent-405086)).
2. **Volume concentrated in a few accounts.** Limitless says the top 5-10% of users drive most volume ([The Block](https://www.theblock.co/news/markets/2026-06-17-limitless-ceo-no-prediction-market-platform-will-dominate-perpetual-futures-precedent-405086)). HIP-4 has about 6,300 30-day traders ([Liquidiction](https://liquidiction.xyz/hip4/stats)) [unverified]. On Polymarket, TRM found wallets with more than 10,000 fills made 35.2% of trades, and median bets were $12-30 ([TRM Labs](https://www.trmlabs.com/resources/blog/how-prediction-markets-scaled-to-usd-21b-in-monthly-volume-in-2026)). Short-dated markets attract bots and desks first; retail is the long tail.
3. **Thin books and fragmentation.** On HIP-4, a $10k buy slips 2-3%, and identical Fed questions split across deployers ($354k versus $90 of 7-day volume) ([TokenPost](https://www.tokenpost.com/news/investing/27723)). On HIP-3, one deployer took about 97% and others shut down: Ventures' pre-IPO perps and Felix's commodities ([PANews](https://panews.io/articles/019ecf58-5c89-7115-b50c-3ba9359c11cd)) [unverified]. Liquidity piles into one venue per underlying.
4. **One-event dependence.** Drift BET launched as an election product ([DL News](https://www.dlnews.com/articles/defi/polymarket-rival-drift-to-launch-solana-predication-market/)). Recurring BTC binaries on HIP-4 fell 93% from the launch month ([TokenPost](https://www.tokenpost.com/news/investing/31004)). Novelty decays unless the calendar refills itself.
5. **Open market creation without liquidity.** Trueo has $797k lifetime volume ([DefiLlama](https://api.llama.fi/summary/dexs/trueo?dataType=dailyVolume)), and Myriad, Limitless and HIP-4 all carry long tails of near-empty markets. Augur's early years combined gas costs, 7-day resolution and assassination markets ([Wikipedia](https://en.wikipedia.org/wiki/Augur_(software)); [Crypto.com Research](https://crypto.com/us/research/prediction-market-aug-2024)).
6. **Security and settlement trust.** The Drift hack ended BET's host ([Bitcoin.com](https://news.bitcoin.com/drift-protocol-hack-2026-what-happened-who-lost-money-and-whats-next/)). HIP-4 markets mostly lack a dispute window ([TokenPost](https://www.tokenpost.com/news/investing/31004)). Limitless resolves stock markets manually if Pyth fails ([limitless.exchange](https://limitless.exchange/markets/nvidia-nvda-up-or-down-hourly-1782313208124)). In 5-minute games, the gap between Chainlink and Binance prices is an edge bots exploit ([GitHub](https://github.com/xcnecon/PancakeSwap-Arbitrage-Bot)).
7. **Regulation.** Every US entrant faces state cease-and-desist orders on sports. The Robinhood 8-K warns this could stop event contracts ([Q2 8-K](https://www.sec.gov/Archives/edgar/data/0001783879/000178387926000113/q22026robinhoodexhibit991.htm)). Offshore crypto venues geoblock the US, which caps their audience ([Datawallet](https://www.datawallet.com/crypto/hip-4-explained-hyperliquid-upgrade)) [unverified].

#### Implications for Probabl (my reading of the evidence)

- **Don't expect short-dated stock binaries on their own to cure boredom.** The best-documented on-chain attempt (Limitless NVDA hourly) trades four figures per market. Fast crypto binaries work mostly inside brokers that already have traders.
- **A pari-mutuel or pooled round format (PancakeSwap-style) is the low-liquidity way to give users something to do every few minutes.** It needs no market maker, but it needs a carefully chosen oracle snapshot and a betting cutoff before lock to blunt last-second bots.
- **Any points or rebate programme will inflate volume and then fall off a cliff.** The data says to budget for that and to measure retention by unique funded traders, not volume.
- **Recurring calendars keep a venue alive between big events.** That means earnings dates, CPI and Fed prints, and weekly or daily rolling series on the same underlying. Bundling several short legs (combos) is where the regulated brokers are heading.
- **Liquidity concentrates in one venue per underlying.** Pick a few underlyings and make them deep rather than many thin ones.

### Gaps

These were not covered, or only partly covered, because the shared search budget ran out. Each is a candidate for follow-up:
- Truth Predict's 2026 status and volume.
- Fanatics Markets' exchange and volume.
- Underdog and PrizePicks prediction products in detail.
- Gemini Titan's approval date.
- IBKR ForecastEx volume and its incentive coupon.
- CME's own event-contract page.
- Sporttrade, MetaMask, Phantom (details), OKX and Bitget prediction products.
- Jupiter's liquidity source.
- GMX and BullX short products.
- Zeitgeist, Polkamarkets and Hedgehog histories.
- Azuro before July 2026.
- The cause of the Probable cliff.
- Any independent wash-trading study of Limitless or Myriad.
- A rigorous bot-share study of PancakeSwap Prediction.

---

## 5. Retention and virality mechanics

Research notes for Probabl, written 2026-10-20.

### How to read this section

Every claim has a source URL inline. "[unverified]" marks a figure I could not confirm from a primary or strong secondary source. That covers affiliate or promo pages, X posts I could not load, reprints of paywalled articles, and AI-written blogs. Every number has a unit and a date. "Notional" volume counts each contract at its $1 payout. It is not the cash at risk, so it inflates long-shot products such as parlays.

Two caveats. First, the session's shared web-search budget ran out partway through this work. Later checks used direct fetches of known pages: DefiLlama's API, official docs, the FCA PDF and news articles. Some leads stayed unchecked. These include eToro's copy-trading share, Polymarket's current follower count, Kalshi's live in-game share, and pump.fun's 2026 returning-user series. Second, almost no company publishes cohort retention. Most "impact" evidence here is volume, revenue or market-share movement after a mechanic launched. That is weaker than a controlled test. The only randomized evidence I found is regulator research: the UK FCA experiment and the Ontario OSC study, both cited below.

---

### 5.1 Ranking by strength of evidence

"Strength" means how well the evidence shows the mechanic changes user behaviour or growth. It does not mean how good the mechanic is.

| Rank | Mechanic | Best evidence | Type of evidence | Strength |
|---|---|---|---|---|
| 1 | Push notifications on price moves | FCA experiment (more than 9,000 people): +11% trades. Robinhood ±5% move alerts: +25% trading right after receipt | Randomized experiment plus broker data | Strong (causal) |
| 2 | Points or rewards per trade | FCA: points and prize draw gave +12% trades. OSC: near-worthless points gave +39% trading. Hyperliquid and Axiom growth | Randomized experiment plus large natural cases | Strong for activity; mixed for retention |
| 3 | Distribution inside high-traffic surfaces (broker, wallet, terminal, builder codes) | Robinhood drove more than 50% of Kalshi volume. Phantom earned $20.6M in builder-code revenue from 137k users. Terminals routed 16% of Robinhood Chain DEX volume | Observed volume share | Strong |
| 4 | Fee-share referrals plus cashback | Axiom pays about 52% of fees back as cashback and referrals, and went from 2% to 72% of Solana bot volume in 5 months. Photon, its fee-only rival, collapsed | Observed revenue and market share | Strong-moderate |
| 5 | Parlays / combos | Kalshi combos were about 70% of notional on 2026-10-10/11 and 30% of Q2 2026 notional, but under 13% of transactions. Retail lost $294M net | Observed volume | Strong for volume; harm documented |
| 6 | High-frequency event cadence (sports, daily markets) | Polymarket retention beats 85% of 275 crypto projects. Sports traders were active on 12 of 42 days, against 7 for politics | Observational cohorts | Strong-moderate |
| 7 | Media distribution (own X accounts, paid posters, news and data partnerships, embeds) | Polymarket had 1.7M X followers, affiliates drew 3× its impressions, and Substack reported 1 in 5 of its top 250 newsletters using Polymarket data | Reach data; little conversion data | Moderate for reach; weak for conversion; documented reputational harm |
| 8 | Yield on open positions ("holding rewards" or APY) | Kalshi pays 3.5–4.05% APY and Polymarket 4% on 13 markets | Program terms only, no published effect | Weak-moderate |
| 9 | Social feeds, leaderboards, copy trading | FCA leaderboard: no significant effect on trade count, +6% shares bought. Kalshi Social launched with no published metrics. Hyperliquid vaults hold $276M | Experiment (null on frequency) plus TVL | Weak-moderate |
| 10 | Livestreams and creator fees (pump.fun) | $20M a week in creator payouts in Sept 2025, but daily active addresses fell 70% in two weeks in Feb 2026 [unverified] | Observed payouts | Mixed |
| 11 | Welcome and deposit bonuses | FanDuel raised promotions to about 6% of handle in H2 2026. Kalshi offers $25–$60 credits | Company guidance | Moderate for acquisition; no retention data |
| 12 | PnL and share cards | Shipped by Axiom and others; no measured data found | Anecdotal | Weak |
| 13 | Streaks, daily quests and login rewards | No trading-app data found. Duolingo analog: 7-day streak users are 2.4× more likely to return the next day | Out-of-domain analog | Weak (for trading) |
| — | Live in-play trading | No share-of-volume data found | Gap | Unknown |

Two mechanics backfire in the evidence. First, rewarding raw activity attracts farmers. Optimism's "frequent user" bonus lowered 30-day retention by 7.1 percentage points. Blur's points season brought heavy wash trading. Second, "BREAKING"-style posts in X news feeds have created documented credibility damage for Polymarket.

---

### 5.2 Push notifications and odds-move alerts (rank 1)

**Causal evidence (strongest in this whole file).** The UK FCA ran an online trading-app experiment with more than 9,000 participants. It tested four "digital engagement practices": flashing prices, push notifications, a trader leaderboard, and points with a prize draw. The research note was first published 2024-06-20. Push notifications raised trades by 1.5 per person (+11%). Points with a prize draw raised trades by 1.6 (+12%). Flashing prices and the leaderboard did not significantly change the number of trades. Push notifications also raised the share of trades in the riskiest assets, by 3.5 percentage points (+10%), and women responded more than men. Source: [FCA research note PDF](https://www.fca.org.uk/publication/research-notes/research-note-digital-engagement-practices-trading-apps-experiment.pdf) and [FCA summary page](https://www.fca.org.uk/publications/fca-research/research-note-digital-engagement-practices-trading-apps-experiment).

The same FCA note reviews earlier field studies:
- Moss (2022, University of Iowa dissertation) found that Robinhood push notifications about ±5% price moves raised retail trading by 25% in the period right after receipt.
- Arnold, Pelster and Subrahmanyam (2022) studied a large broker's alerts about big price moves and earnings dates. Those alerts led people to trade with more leverage, and the effect was largest for young, male and inexperienced investors.

Both come from the [FCA PDF](https://www.fca.org.uk/publication/research-notes/research-note-digital-engagement-practices-trading-apps-experiment.pdf), section on prior literature.

**Prediction-market state of play (Oct 2026).** I found no native "alert me when odds move X%" feature announced by Polymarket or Kalshi. A crowd of third-party tools fills the gap: the Google Play app "Alerts for Polymarket" (updated Sept 2026), Nevua Markets watchlists that alert through Telegram, Discord or webhooks, and alerts.chat, which covers both venues. Sources: [Google Play listing](https://play.google.com/store/apps/details?id=io.crapps.polymarketalerts&hl=en_US), [Nevua on X](https://x.com/NevuaMarkets), [Polycatalog alert roundup](https://www.polycatalog.io/best-polymarket-alerts) [unverified vendor claims]. Kalshi's April 2026 social launch included "alerts from top traders" ([PredictionNews on X](https://x.com/PredictionNews_/status/2047754663647408224)). Third parties building these tools shows unmet demand.

**Regulatory constraint.** The Massachusetts securities regulator's $7.5M settlement with Robinhood listed push notifications, confetti, scratch-off "free stock" reveals and "most popular" lists as engagement tools. For Massachusetts accounts, it bars push notifications that highlight specific lists and any celebratory imagery tied to trading frequency. The case was brought in December 2020. Sources: [Cointelegraph](https://cointelegraph.com/news/robinhood-settles-massachusetts-regulator), [InvestmentNews](https://www.investmentnews.com/regulation-legal-compliance/robinhood-to-pay-75m-to-settle-massachusetts-charges/248214). The settlement date was not re-checked; I recall January 2024 [unverified].

---

### 5.3 Points, seasons and airdrops (rank 2)

#### Controlled evidence
- **FCA, 2024:** points with a prize draw gave +12% trades, and the risky-trade share rose 2 percentage points (+6%) ([FCA PDF](https://www.fca.org.uk/publication/research-notes/research-note-digital-engagement-practices-trading-apps-experiment.pdf)).
- **Ontario Securities Commission, 2022:** points of negligible value (at most $0.08) raised trading activity by 39%. Showing a "top traded stocks" list did not raise trade frequency, but made people 14% more likely to trade the listed stocks (cited in the FCA PDF; [OSC report](https://www.osc.ca/sites/default/files/2022-11/sn_20221117_11-796_gamification-report.pdf)).
- **Chapkovski, Khapko and Zoican, 2021:** celebratory messages and badges raised trading volume by 5.2%, and by 12.5% for people who said they prefer hedonic design (cited in the FCA PDF).

#### Hyperliquid: the best real-world case of points leading to lasting retention
- **Program:** points ran from 2023-11-01 to 2024-05-01 at 1,000,000 points a week. An "L1 phase" followed from 2024-05-29 to November 2024 at 700,000 points a week. Referrers earned 1 point for every 4 points their referees earned ([Hyperliquid docs: points](https://hyperliquid.gitbook.io/hyperliquid-docs/points)).
- **Airdrop:** genesis was 2024-11-29. Reported shares were 27.5% of supply to just over 94,000 users ([Cointelegraph Magazine, 2025-01-08](https://cointelegraph.com/magazine/how-hyperliquid-airdrop-changed-game)) and 31% / 310M HYPE ([CoinDesk, 2024-11-28](https://www.coindesk.com/business/2024/11/28/crypto-exchange-hyper-liquid-to-airdrop-310-m-tokens-to-early-adopters)). The drop was worth about $1.6B at launch ([DL News, 2025-05-29](https://www.dlnews.com/articles/defi/hyperliquid-airdrop-farming-among-factors-driving-hype-token/)) and over $7.5B by 2025-01-08 (Cointelegraph).
- **After the drop:** activity did not collapse.
  - Daily active users roughly tripled, from about 20k to about 70k, in the year to April 2026 ([Allium on X](https://x.com/AlliumLabs/status/2046287855203573761) [unverified, could not load]).
  - Monthly active perp traders hit a record of about 292k in September 2026 ([Crypto Briefing](https://cryptobriefing.com/hyperliquid-monthly-active-addresses-all-time-high/)).
  - Protocol revenue was $68.4M over the 30 days to 2026-10-19 and $690.4M over the past year ([DefiLlama API](https://api.llama.fi/summary/fees/hyperliquid?dataType=dailyRevenue)).
- **Why it held up:** analysts credit the large share to real users (no VC-heavy float) and the Assistance Fund buy-and-burn, which had removed about $795M of HYPE by May 2025 ([DL News](https://www.dlnews.com/articles/defi/hyperliquid-airdrop-farming-among-factors-driving-hype-token/)). Hope of a second airdrop also kept farmers trading. DL News quoted Doug Colkitt saying farming is "definitely juicing volumes."
- **Caution:** Hyperliquid was also the best product in its category. The points cannot be separated from execution quality.

#### Axiom: points plus cashback plus referrals as the whole growth engine
- Axiom launched in February 2025. By 2025-07-07 it had more than $150M in fees, was the fastest company in Y Combinator history to $100M in revenue, and held 72% of Solana bot volume, up from 2% in early February. About 650k wallets had used it. DL News attributes the growth mainly to points ("eligible for... future airdrops"), SOL fee rebates and referral payouts, with little marketing ([DL News, 2025-07-07](https://www.dlnews.com/articles/defi/solana-bot-axiom-takes-over-cursor-with-150m-revenue/)).
- As of September 2026, Axiom still has no token and no announced airdrop. The points promise has kept users for about 19 months ([Boxmining](https://boxmining.com/axiom-token-airdrop-guide/) [secondary]).

#### Limitless (Base prediction market)
- Season 2 points pool was about 2% of supply (about $6M) ([Airdrops_one on X](https://x.com/Airdrops_one/status/1986260145790124292) [unverified]).
- Season 4 reportedly runs 2026-05-25 to 2026-10-26, with a $200 minimum volume and a weekly leaderboard ([AirdropAlert](https://airdropalert.com/airdrops/limitless-exchange/) [unverified]).
- Monthly volume was reportedly near $2B in June 2026 ([CoinMarketCap AI summary](https://coinmarketcap.com/cmc-ai/limitless-lmts/latest-updates/) [unverified]).
- No retention data found.

#### Polymarket token speculation as a de facto points program
- CMO Matthew Modabber said in October 2025: "there will be a token, there will be an airdrop" ([Cryptonews](https://cryptonews.com/news/polymarket-token-airdrop-speculation/)).
- POLY and $POLY trademarks were filed in February 2026, and CEO Shayne Coplan revived the hints at TOKEN2049 in October 2026 ([FinanceFeeds](https://financefeeds.com/polymarket-ceo-renews-token-hints-fuels-airdrop-speculation/)).
- As of mid-October 2026 there is no token, snapshot or criteria ([Tangem](https://tangem.com/en/learning-hub/post/polymarket-token-launch/)). Guides on "how to farm it" still circulate ([airdrops.io](https://airdrops.io/polymarket/)), so the expectation itself is a retention lever Polymarket gets almost for free.

#### Evidence that points and airdrops fail to retain users
- **Optimism Airdrop 5** (regression discontinuity at the 50 OP cutoff, posted 2025-01-31). Receiving the airdrop raised 30-day retention by 4.2 percentage points and 60-day retention by 2.8 points, so the effect decays. The "Frequent User" bonus, which rewarded at least 10 transactions a week, cut 30-day retention by 7.1 points, most likely because it paid farmers ([Optimism governance forum](https://gov.optimism.io/t/did-op-airdrop-5-increase-user-retention-rates-a-regression-discontinuity-analysis/9610)).
- **Nine Ethereum and L2 airdrops** (MPI-SWS): in some cases up to 66% of tokens were sold quickly, often in the first transaction after claiming ([arXiv 2312.02752](https://arxiv.org/abs/2312.02752)).
- **Delphi Digital / Tiger Research** (2024-08-21) ([report](https://reports.tiger-research.com/p/do-airdrops-hurt-more-than-they-help-eng)):
  - Parcl's daily unique users fell from more than 10k to about 500 after its airdrop, and its TVL fell 74%.
  - LayerZero's top apps lost at least 70% of activity in the week after the snapshot.
  - Jito was the outlier: a simple, early points program run during a bear market.
- **Blur (2023):** loyalty points rewarded listing only on Blur, and Season 2 paid about 300M BLUR. Estimates put Blur at 27% of all NFT wash trading in February 2023 ([Forkast](https://forkast.news/blur-nft-wash-trading-market-coinbase-hong-kong/)) and wash trades at 34% of Blur volume ([AMBCrypto](https://ambcrypto.com/blurs-blur-future-turns-uncertain-as-concerns-around-wash-trading-surface/)). One 30-day window had about 42% of transactions linked to wash trading ([Tokenist](https://tokenist.com/blur-tops-opensea-in-volume-but-42-of-transactions-linked-to-wash-trading/)). This is the main warning: points paid on volume with no fee cost get wash traded.
- **Jupiter** ended Jupuary. In February 2026 the DAO voted to return 700M JUP to a community multisig and replaced the drop with quarterly Active Staking Rewards of 50M JUP ([BlockEden](https://blockeden.xyz/blog/2026/01/26/jupiter-jupuary-final-airdrop-jupusd-stablecoin-solana-defi/), [99airdrops](https://99airdrops.com/airdrops/jupiter/) [secondary]).
- **Drift:** I found no 2026 data.

**Takeaway:** points reliably raise activity, which both experiments and the Hyperliquid and Axiom cases show. They retain users only when the underlying product wins on its own merits. Retention is better when points are tied to fee-paying behaviour rather than raw transaction counts.

---

### 5.4 Distribution inside high-traffic surfaces (rank 3)

The fastest user growth in this sector came from being embedded where traders already are, not from in-app mechanics.

- **Robinhood to Kalshi:** Robinhood has driven more than 50% of Kalshi's volume since March 2025. Robinhood users traded about $1B of Kalshi's $1.87B in Q2 2025, and the estimate fell to about one third of daily volume by September 2025 ([Finance Magnates, 2026-01-21](https://www.financemagnates.com/forex/why-robinhood-cant-ditch-kalshi-yet-despite-owning-its-own-exchange/); sources unnamed in the article). Kalshi's monthly active users rose from about 600k at the start of 2025 to 5.1M by February 2026 (Sensor Tower via FT, [Yahoo Finance, 2026-02-16](https://finance.yahoo.com/news/kalshi-prediction-markets-stealing-market-160600765.html)).
- **Robinhood's own prediction-market business:**
  - 12B contracts traded in 2025 ([Yahoo Finance](https://finance.yahoo.com/news/robinhood-ceo-says-prediction-markets-093215671.html)).
  - A record 13.6B event contracts and $156M of event-contract revenue in Q2 2026 ([Robinhood Q2 2026 release](https://investors.robinhood.com/news-releases/news-release-details/robinhood-reports-second-quarter-2026-results); the page returned 403, so figures come via [Memeburn](https://memeburn.com/robinhood-prediction-markets-revenue-beats-crypto-in-2026/) [secondary]).
  - Other distribution partners: Coinbase routes order flow to Kalshi, and Kalshi also works with Webull, Interactive Brokers, PrizePicks and Alpaca (Alpaca deal reported 2026-08-31) ([gambling.com tracker](https://www.gambling.com/us/news/prediction-market-partnerships-every-major-deal-tracked), [DL News](https://www.dlnews.com/articles/markets/how-coinbase-betting-sites-will-give-polymarket-kalshi-run-for-their-money/)).
- **Hyperliquid builder codes (wallets and apps earn a fee on volume they route).** CoinGecko's cumulative snapshot at 2026-05-25 ([CoinGecko Research](https://www.coingecko.com/research/publications/top-hyperliquid-builders)):

  | Builder | Revenue | Volume | Users | Fee |
  |---|---|---|---|---|
  | Phantom | $20.6M | $39.4B | 137,496 | 0.05% |
  | Based | $15.1M | $44.0B | 42,579 | 0.025% |
  | MetaMask | $6.5M | $7.46B | 43,761 | — |
  | Axiom | $2.27M | $22.1B | 33,361 | — |

  Hyperliquid said 100+ teams had integrated via builder codes ([Hyperliquid on X](https://x.com/HyperliquidX/status/2053970679846834202) [could not load]). This is a referral program for apps, not people, and it puts the exchange inside wallets that already hold the users.
- **Robinhood Chain specifically** ([Spartan Group, 2026-09-15](https://www.spartangroup.io/insights/robinhood-chain-earn-launchpads-and-stock-tokens)):
  - GMGN, Axiom, Pump.fun, Fomo and BasedBot added Robinhood Chain within days of its 2026-07-01 mainnet. They routed $2.8B of swaps in August 2026, about 16% of the chain's DEX volume.
  - Memecoin swaps were 23% of August transactions; Stock Token swaps were 6.5%.
  - 231k wallets hold Stock Tokens, at about $300 each on average.
  - Robinhood Earn grew from $9.5M to $456M (2026-07-01 to 2026-08-31) on a subsidized 7% APY.
  - Robinhood paid gas on swaps inside its wallet until 2026-09-29.
  - Axiom's Robinhood Chain fees started 2026-07-11 and totaled $10.9M by 2026-10-19, now about $7–13k a day ([DefiLlama API](https://api.llama.fi/summary/fees/axiom?dataType=dailyFees)).
  - For Probabl, this means the terminals already route volume on this chain, and an integration or builder-fee deal with them is a distribution channel that already exists.

---

### 5.5 Referral loops and cashback (rank 4)

#### Terms, as of October 2026

| Platform | Referrer gets | Referee gets | Limits | Source |
|---|---|---|---|---|
| Axiom | 30% of Axiom's net fee (direct), 3% (level 2), 2% (level 3), uncapped | 10% fee discount | Solana, BSC and Ethereum trades | [Axiom docs](https://docs.axiom.trade/getting-started/referral-program) |
| Hyperliquid | 10% of referee fees (net of their discount) | 4% fee discount | Referrer needs $10k volume. Rewards end after referee's first $1B; discount ends after first $25M | [Hyperliquid docs](https://hyperliquid.gitbook.io/hyperliquid-docs/referrals) |
| Polymarket (from 2026-05-28) | 10% of net fees (direct), 5% (indirect), paid daily in pUSD | — | Referrer needs $10k lifetime volume. Ends 30 days after sign-up or when the referee reaches Platinum. No pay on fee-free markets | [Polymarket docs](https://docs.polymarket.com/programs/referral-program) |
| Polymarket (March 2026 launch) | 30% direct / 10% indirect | — | Cut on 2026-05-28 | [pm.wiki](https://pm.wiki/learn/polymarket-referral-program) [secondary] |
| Kalshi | $25 credit | $25 credit | Up to $1,000 (about 40 referrals). Referee must trade $25 within 7 days. Credit expires in 7 days and can't be withdrawn | [Covers, 2026-10-18](https://www.covers.com/betting/bonuses/kalshi-referral-code) [affiliate page] |
| pump.fun (from 2026-10-17) | — | Platform fee 0.40% instead of 0.45% | Web and app trades | [pump.fun fee docs](https://pump.fun/docs/fees) |
| BullX / Photon | 35% / 30% lifetime share | — | — | [madeonsol](https://madeonsol.com/blog/solana-referral-affiliate-programs) [unverified] |

Other details:
- Axiom cashback runs from 0.05% to 0.25% of volume in SOL by tier ([axiompro.app](https://axiompro.app/fees/) [secondary]).
- BullX suspended trading on 2026-06-01 ([Solana Compass](https://solanacompass.com/projects/bullx)).

#### Evidence of impact
- **Axiom gives back about half of gross fees.** DefiLlama, 30 days to 2026-10-19: $34.1M in fees, of which Axiom kept $16.3M; the gap is about 52%. Over the past year: $298.5M in fees and $158.0M in revenue. All time: $776.8M in fees and $468.4M in revenue ([fees API](https://api.llama.fi/summary/fees/axiom?dataType=dailyFees), [revenue API](https://api.llama.fi/summary/fees/axiom?dataType=dailyRevenue)). A third-party read of the same window puts $18.8M of the payout as cashback plus referrals ([uwuu.ai](https://uwuu.ai/blog/axiom-trade-review) [secondary]).
- **The rival that did not match collapsed.** Photon made $442.1M in revenue all time but only $359.8k in the 30 days to 2026-10-20, and $12.4M over the past year ([DefiLlama API](https://api.llama.fi/summary/fees/photon?dataType=dailyRevenue)). Axiom's 2025 rise matches Photon's fall ([DL News](https://www.dlnews.com/articles/defi/solana-bot-axiom-takes-over-cursor-with-150m-revenue/)). Photon's decline cannot be blamed on referrals alone, but the pattern is clear: once switching is easy, the terminal that pays users more wins.
- **GMGN** (1% flat fee; wallet leaderboards and copy trading): $161.7M revenue over the past year and $15.95M over the 30 days to 2026-10-19 ([DefiLlama API](https://api.llama.fi/summary/fees/gmgn?dataType=dailyRevenue)).
- **Polymarket cut referral rates** from 30% to 10% two months after launch. That suggests the higher rate cost more than it brought in, though Polymarket did not publish data.
- **Robinhood's pre-launch waitlist** let referrals move people up the line and reportedly reached about 1M sign-ups before the March 2015 launch ([Viral Loops](https://viral-loops.com/blog/how-robinhood-got-1-million-users/), [Prefinery](https://www.prefinery.com/blog/referral-programs/robinhood/) [secondary marketing blogs]). Robinhood's later "free stock" referral appears in the Massachusetts complaint as a scratch-ticket mechanic ([Cointelegraph](https://cointelegraph.com/news/robinhood-settles-massachusetts-regulator)).

---

### 5.6 Parlays and combos (rank 5)

- **Launch timing:** Kalshi self-certified parlays in September 2025 ([InGame](https://www.ingame.com/polymarket-us-test-launches-parlays/)). One report says Kalshi "launched combos in December 2025" ([Sporting Crypto](https://newsletter.sportingcrypto.com/p/state-of-prediction-markets-q2-2026-report)), so the public app launch date is unclear.
- **Share of Kalshi volume over time:**
  - 10.6% in one April 2026 week ([Next Event Horizon via search summary](https://nexteventhorizon.substack.com/p/parlays-propel-kalshi-to-back-to-back-records) [unverified]).
  - 26% over the 30 days to 2026-05-12 ([Next Event Horizon](https://nexteventhorizon.substack.com/p/is-sports-now-only-70-percent-of-kalshi-volume)).
  - About 30% of Q2 2026 notional (about $20B) on $1.67B of actual handle ([Sporting Crypto](https://newsletter.sportingcrypto.com/p/state-of-prediction-markets-q2-2026-report)).
  - 36% of contract trading in July 2026 (Bloomberg, via [PredictionNews](https://predictionnews.com/story/reddit-user-asks-kalshi-traders-about-their-biggest-losses)).
  - 58% of September volume but under 13% of transactions (CNBC analysis, per search summary [unverified]).
  - 71.6% ($2.80B) on 2026-10-10 and 69.4% ($2.75B) on 2026-10-11. Those were record days of $3.91B and $3.96B in notional volume ([Crypto Briefing, 2026-10-13](https://cryptobriefing.com/kalshi-daily-volume-records-parlays/)).
- **Polymarket followed later:**
  - The offshore site added parlays on 2026-06-10 for the World Cup.
  - Polymarket US opened them to all customers on 2026-08-20, with up to 10 legs ([InGame, 2026-08-22](https://www.ingame.com/polymarket-us-launches-parlays/)).
  - In one 7-day window, combos were 4.6% of Polymarket US volume (about $40M) against 43.5% at Kalshi (about $340M) (same source). Polymarket's late start shows in that gap.
- **Harm and economics:**
  - Bloomberg found Kalshi app and web takers lost a net $294M on combos in 2026 through late July, excluding fees. Combos averaged a 9% implied "yes" chance, against 43% for single markets.
  - Fewer than 3% of World Cup final same-game combos resolved "yes."
  - Kalshi does not take the other side; market makers do, and Kalshi earns fees ([PredictionNews](https://predictionnews.com/story/reddit-user-asks-kalshi-traders-about-their-biggest-losses), [Detroit News reprint](https://www.detroitnews.com/story/business/personal-finance/2026/07/30/retail-bettors-lose-big-on-complex-combo-bets/91105579007/)).
  - Kalshi added maker fees on parlays on 2026-08-20, set at half the taker rate ([InGame](https://www.ingame.com/polymarket-us-launches-parlays/)).
- **Reading:** combos are the single biggest volume driver in prediction markets in 2026. But notional hugely overstates the cash involved, and combos make the "this is sports betting" argument stronger.
- **For Probabl:** a "combo" across conditional branches (for example, "NVDA if Fed cuts AND AAPL if Fed cuts") is a natural fit, but brings the same long-shot dynamics.

---

### 5.7 Event cadence as the retention engine, plus the retention data that exists (rank 6)

#### Polymarket
- **Dune and Keyrock** (published 2025-12-16): Polymarket's monthly-cohort retention beats more than 85% of a 275+ project crypto sample (networks, DeFi, wallets, trading apps). Prediction-market monthly active users grew from about 4k to more than 612k since early 2024. No cohort percentages were published ([Keyrock](https://keyrock.com/prediction-markets-the-next-frontier-of-financial-markets/), [Dune blog](https://dune.com/blog/prediction-markets-the-next-frontier-of-financial-markets), [Cointelegraph](https://cointelegraph.com/news/polymarket-retention-prediction-markets-crypto-platforms)).
- **H1 2026 on-chain study** of the international exchange (TechFlow columnist "Surf"; data computed by Surf AI; 787M trades; published 2026-09-07) ([TechFlow](https://www.techflowpost.com/en-US/article/33803)) [secondary, methodology not public]:
  - 1,733,011 wallets traded in H1 2026.
  - Monthly active wallets were roughly flat: about 580k in January and 594k in June.
  - 43–49% of the prior month's actives stopped trading each month, so platform monthly retention was 51–57%.
  - One-month cohort retention by entry category was 44–49%, but about 37% for users who entered through crypto markets. Three-month retention was about 25–32%.
  - Bot-like wallets were 5.9% of wallets but 89% of trade events.
  - 34% of wallets with settled positions ended positive.
- **Pew Research** sampled 11,989 active wallets from 2026-05-07 to 2026-06-19, a 42-day window ([Pew, 2026-07-22](https://www.pewresearch.org/short-reads/2026/07/22/what-we-know-about-the-typical-polymarket-user/)):
  - The median user made 46 trades on 10 of the 42 days, at an average of $6.50 a trade.
  - Accounts with 1,000+ trades were active on 39 of 42 days.
  - By topic, the median sports trader made 69 trades on 12 days, crypto 59 trades on 5 days, and politics 13 trades on 7 days.
- **Bitget Wallet and Dune, Q1 2026,** across 1.29M wallets ([Bitget Web3 blog, 2026-04-29](https://web3.bitget.com/en/blog/articles/prediction-markets-retail-report)):
  - Average active days run from 2.5 for the smallest wallets (under $100) to 37.0 for whales (over $100k), and categories traded from 1.45 to 3.16.
  - More engaged users trade more kinds of markets; they do not bet bigger.
  - Crypto markets are the main onboarding category (39.6% of the smallest traders' activity), while sports retain.
  - Weather markets grew 263% in March 2026 on daily forecast loops.
- **TRM Labs** (2026-03-27; on-chain data for 2026-01-01 to 03-22, covering Polymarket, Limitless, Opinion and predict.fun together) ([TRM Labs](https://www.trmlabs.com/resources/blog/how-prediction-markets-scaled-to-usd-21b-in-monthly-volume-in-2026)):
  - Monthly unique wallets nearly tripled in the six months to February 2026, reaching 840,000.
  - First-time bettors' median bet was $30; the most active wallets' median trade was $12.
  - Six of the ten most profitable Polymarket wallets traded every day of the 80-day window.
  - TRM describes Google Finance embedding Polymarket and Kalshi odds as a "distribution flywheel" that drove users back, but gives no data, so this is qualitative.
- **a16z crypto on category retention** (via [Casino.org, 2026-06-01](https://www.casino.org/news/kalshi-investor-andreesen-horowitz-sees-non-sports-prediction-markets-growth/) and [MetaMask, 2026-06-05](https://metamask.io/news/top-prediction-market-categories-2026)):
  - a16z said "every other category was growing faster" than sports.
  - Entertainment, crypto, politics and culture reportedly show better volume-retention cohorts than sports. Casino.org attributes this framing to Kalshi's co-founders.
  - Neither article links the a16z original or gives numbers, so this is [unverified]. It does not fit neatly with Pew's finding that sports traders are active on more days, because volume retention and day-activity measure different things.
- **Monthly active user counts conflict:**
  - CNBC: above 780k in March 2026, below 650k in May 2026 ([CNBC, 2026-06-10](https://www.cnbc.com/2026/06/10/polymarkets-volume-falls-again-in-may.html); summary only, fetch failed).
  - The Block's monthly active traders chart shows 185,025 at its latest point (page modified 2026-10-01) ([The Block](https://www.theblock.co/data/decentralized-finance/prediction-markets/polymarket-active-traders-monthly)). The definitions differ.

#### Kalshi
- Apptopia, 2026-06-01 to 06-15 ([DeFi Rate, 2026-06-17](https://defirate.com/news/kalshi-polymarket-three-quarters-betting-app-downloads-during-world-cup-surge/)):
  - Kalshi took 42.3% of new installs in the betting and prediction category and Polymarket 31.2% (iOS only), against 13.7% for DraftKings and 8.9% for FanDuel.
  - Both prediction apps hit all-time mobile DAU highs on June 13–15.
  - More than half of Kalshi's users in the first 72 hours of the World Cup were new to the app.
- No day-30 retention figure has been published for Kalshi.

#### Hyperliquid
- Weekly active perp traders were about 230k in late March 2026, up from about 150k in January ([CoinPerps](https://www.coinperps.com/learn/hyperliquid-statistics) [secondary]).
- There were 263,666 active perp traders on 2026-08-06, a record set while volume fell ([Crypto Times](https://www.cryptotimes.io/2026/08/07/hyperliquid-active-traders-hit-ath-while-volume-declines/), page returned 403; figure via search summary [unverified]).

#### pump.fun
- Daily active addresses fell about 70% in two weeks, to about 91.9k on 2026-02-24 ([X trending summary](https://x.com/i/trending/2026681851138682966?lang=en) [unverified]).
- Recurring users reportedly fell from about 258k in late January 2025 to about 66k a year later (BestBrokers via the same summary [unverified]).
- Revenue held up anyway: $326.3M over the past year and $44.95M over the 30 days to 2026-10-19 ([DefiLlama API](https://api.llama.fi/summary/fees/pump.fun?dataType=dailyRevenue)). Revenue is concentrated in fewer, heavier users.

#### Reading
Retention follows how often new outcomes arrive. Sports (daily games), crypto (always on) and weather (daily) beat politics (slow cycles). The ingredient that drives everything else is a reason to check in today. For Probabl, conditional stock markets resolve slowly, often over weeks to the event, but the stock branches move every trading day. The daily hooks are price moves on each branch, earnings and macro calendars (FOMC, CPI, jobs), and short-dated markets.

---

### 5.8 Media distribution: X accounts, paid posters, data partnerships, embeds (rank 7)

#### Reach
- **Followers:** Polymarket's X account had 1.7M followers in July 2026 and posts several times a day. Kalshi had 431,400 ([CoinDesk citing AP, 2026-07-08](https://www.coindesk.com/markets/2026/07/08/polymarket-bets-on-u-s-marketing-blitz-to-win-back-trust-after-4-year-ban-report)).
- **Affiliate "news" accounts:** at least 11 X accounts tied to Polymarket use "news" or "updates" in their bios. Together they draw more than 3× the official account's impressions. @NewsWire_US averages more than 200M impressions a month (Junkipedia data). Article dated 2026-03-25 ([Columbia Journalism Review](https://www.cjr.org/tow_center/polymarket-affiliates-are-spreading-misinformation-on-x.php)).
- **Paid posters (POLITICO, republished 2026-06-05):** PayPal records show Polymarket CMO Matthew Modabber sent more than $2.5M to more than 800 people between January 2025 and February 2026. More than 490 promotional X posts were found; about a third were framed "BREAKING" or "NEW," and none carried a paid-partnership disclosure ([Yahoo/POLITICO](https://www.yahoo.com/news/politics/articles/polymarket-paying-social-media-biggest-090000448.html)).
- **Esports quote-retweet program:** grew from 300+ creators in early August 2026 to 800+ about two months later. Pay runs from $10 to about $400 a post, in crypto, set by the poster's typical views. Members who recruit others earn "3% of what they make, every month," for as long as the recruit stays, which makes it a referral loop for promoters. Article dated 2026-10-15 ([Aftermath](https://aftermath.site/polymarket-esports-paid-twitter/)).
- **Conversion:** I found no data on how much of this reach turns into traders.

#### Data and media partnerships (distribution of the odds themselves)

**Polymarket**
- X/xAI "official prediction market partner" since 2025-06-06, with Grok annotations of market moves ([Bloomberg](https://www.bloomberg.com/news/articles/2025-06-06/musk-s-x-selects-polymarket-as-prediction-market-partner), [xAI on X](https://x.com/SpaceXAI/status/1932481207180406923)). No usage data published.
- Yahoo Finance: exclusive data partner from November 2025 ([The Block](https://www.theblock.co/post/378600/polymarket-yahoo-finance-exclusive-prediction-partner-eyes-record-month)). Yahoo shut the prediction hub on 2026-09-18 but kept Polymarket as an advertiser ([Crypto Briefing](https://cryptobriefing.com/yahoo-finance-ends-polymarket-partnership/), [WiseVoter](https://wisevoter.com/world/us/2026/10/09/yahoo-finance-ends-polymarket-prediction-hub)).
- Google Finance and Search show both Polymarket and Kalshi odds, non-exclusively ([Yahoo Finance](https://finance.yahoo.com/news/google-brings-prediction-markets-polymarket-214344928.html)). Current status was not re-checked.
- Dow Jones (WSJ, Barron's, MarketWatch), exclusive, 2026-01-07 ([Covers](https://www.covers.com/industry/polymarket-increases-media-exposure-with-new-dow-jones-partnership-jan-7-2026)).
- Substack, exclusive, 2026-02-18. Substack says one in five of its top 250 highest-revenue publications already use Polymarket data, and Polymarket sponsors a cohort of creators ([CoinLaw](https://coinlaw.io/substack-polymarket-live-prediction-markets/)). The original embeds launched in July 2024 ([Substack](https://on.substack.com/p/dynamic-prediction-market-tables), [Polymarket on X](https://x.com/Polymarket/status/1817980394400026822)).
- Sports: NHL (October 2025, alongside Kalshi), UFC/TKO (November 2025), New York Rangers (January 2026), MLS (2026-01-26), MLB exclusive (March 2026; $150–300M over 3 years is a press estimate [unverified]), LaLiga (April 2026) ([NEXT.io](https://next.io/news/marketing/polymarket-partnerships-dow-jones-ny-rangers/), [Front Office Sports](https://frontofficesports.com/article/mls-jumps-into-prediction-markets-with-polymarket-deal/), [SGI Europe](https://www.sgieurope.com/strategies/mlb-nhl-sign-prediction-market-deals-amid-legal-fight/122458.article), [PlayUSA roundup](https://www.playusa.com/news/roundup-prediction-market-partnerships-2026/)).
- Farcaster: Polymarket built an in-feed betting Frame in July 2024 ([Polygon blog](https://polygon.technology/blog/polygon-got-framed-farcaster-frames-now-supports-polygon-pos-transactions-with-a-500k-matic-grants-program-to-follow), [Farcaster docs](https://docs.farcaster.xyz/developers/frames)). No usage data found.

**Kalshi**
- CNN, announced 2025-12-02: exclusive, CNN does not pay, Kalshi data runs as an on-air ticker ([Axios](https://www.axios.com/2025/12/02/cnn-kalshi-prediction-market-data)).
- CNBC, announced 2025-12-04: multi-year, Kalshi-branded ticker on "Squawk Box" and "Fast Money" from 2026, plus a CNBC page on Kalshi ([Yahoo Finance](https://finance.yahoo.com/news/kalshi-cnbc-announce-real-time-201200292.html), [Cointelegraph](https://cointelegraph.com/news/kalshi-prediction-markets-partnership-cnbc)).

#### Documented downside
- The NYT reviewed Polymarket's X accounts in March 2026 and found hundreds of false or misleading posts ([Popular Information](https://popular.info/p/the-truth-machine-is-lying-to-you), [CJR](https://www.cjr.org/tow_center/polymarket-affiliates-are-spreading-misinformation-on-x.php)).
- On 2026-08-03, Polymarket's main account falsely claimed NYC's city-owned grocery stores would require ID. The post was not corrected, drew 19.6M views on X, and was used to promote a related market ([Popular Information, 2026-08-12](https://popular.info/p/the-truth-machine-is-lying-to-you)). This one post shows both how much reach the format gets and what it costs in credibility.
- Jeff Bezos publicly denied a quote Polymarket posted ([Bitget News](https://www.bitget.com/news/detail/12560605164767) [secondary]).
- Kalshi dropped its official affiliate badges in February 2026 (CJR).
- Sportico reported Kalshi paying a social account that posted anti-Muslim and anti-Black content ([Sportico](https://www.sportico.com/business/sports-betting/2026/kalshi-anti-muslim-anti-black-posts-social-media-affiliate-1234940266/)).
- The WSJ alleged undisclosed paid influencers posted simulated wins ([CoinDesk](https://www.coindesk.com/markets/2026/07/08/polymarket-bets-on-u-s-marketing-blitz-to-win-back-trust-after-4-year-ban-report)).
- In May 2026 Senators Britt and Blumenthal proposed barring sports-betting ads from reaching minors on social media, naming prediction markets ([Anchorage Daily News/AP](https://www.adn.com/business-economy/2026/05/28/gamification-and-memes-lure-young-people-to-sports-wagering-apps-prediction-markets/)).

**Reading:** "odds as news" works as distribution. Polymarket's reach is far larger than Kalshi's on X, and Kalshi bought TV reach through CNN and CNBC. The "BREAKING" format brings real legal and reputational costs. For Probabl, the lower-risk version is a bot that posts accurate conditional price spreads ("NVDA if cut: $X vs if no cut: $Y") tied to scheduled macro events, plus embeddable widgets for finance writers.

---

### 5.9 Yield on positions (rank 8)

- **Kalshi:**
  - 4.05% APY on cash and open positions from 2024-10-10, accrued daily and paid monthly ([Kalshi News](https://news.kalshi.com/p/interest-cash-open-positions)).
  - 3.75% variable by 2025-10-27, with a $250 minimum balance ([Blondie Predicts](https://blondiepredicts.substack.com/p/unpacking-kalshis-incentive-programs)).
  - About 3.5% in September–October 2026 reviews ([Finder](https://www.finder.com/stock-trading/kalshi-review)).
- **Kalshi volume and liquidity incentives** (Blondie Predicts):
  - Volume incentives pay from pools of $300–$10K per market, capped at $0.005 per contract, on trades priced $0.03–$0.97.
  - Liquidity incentives pay $10–$1K a day for resting orders near the touch.
- **Polymarket:** 4% annualized on open positions in 13 long-dated markets from 2025-09-24, sampled hourly and paid daily. Polymarket says the goal is stable long-term prices ([Polymarket on X](https://x.com/Polymarket/status/1970886833153184127), [Cryptopolitan](https://www.cryptopolitan.com/polymarket-starts-paying-out-4-rewards/)). One commentator argues the treasury must earn more than 4% on collateral to sustain it ([Revenue Memo](https://www.revenuememo.com/p/how-does-polymarket-make-money)).
- **Evidence of impact:** none published by either venue. The logic is retention of capital rather than daily activity, because it removes the opportunity cost of holding a long-dated position.
- **For Probabl:** conditional stock positions can last weeks, and the losing branch is refunded, so yield on locked collateral is a direct answer to the "dead money" objection. On Robinhood Chain, Earn's subsidized 7% is the benchmark users will compare against ([Spartan](https://www.spartangroup.io/insights/robinhood-chain-earn-launchpads-and-stock-tokens)).

---

### 5.10 Social feeds, leaderboards and copy trading (rank 9)

#### Leaderboards
- **FCA experiment:** the trader leaderboard did not significantly change the number of trades. It raised shares bought by 8.6 (+6%) and raised risk on one measure. People with low financial literacy responded more ([FCA PDF](https://www.fca.org.uk/publication/research-notes/research-note-digital-engagement-practices-trading-apps-experiment.pdf)).
- **Polymarket** runs a public leaderboard (weekly, monthly and all-time profit) with no prizes attached ([Polymarket leaderboard](https://polymarket.com/leaderboard/overall/weekly/profit)). Third parties run prize leaderboards, such as $2,500 a month to the top 15 by volume ([Traderline](https://traderline.com/leaderboard) [unverified affiliation]).
- **Limitless** runs a weekly points leaderboard (see section 5.3).
- **Hyperliquid's public on-chain positions** feed a spectator economy. Whale James Wynn's trades and liquidations, including about $98.5M of losses since May 2025, are amplified by Lookonchain and Arkham and covered by media ([The Defiant](https://thedefiant.io/news/defi/hyperliquid-whale-james-wynn-loses-usd47-million-in-a-week)). That is free attention, but I found no measure of what it does to user numbers.

#### Social feeds
- **Kalshi Social** (formerly Kalshi Ideas), launched 2026-04-24:
  - Personalized feed, a Following view, a Leaderboard tab and "inner circle" groups.
  - Posts can attach a position showing the market and direction, up to 800 characters plus a GIF.
  - Members may post in a market only where they hold a position, and must show its direction ([PredictionNews on X](https://x.com/PredictionNews_/status/2047754663647408224), [Kalshi help](https://help.kalshi.com/en/articles/15891130-how-do-i-post-comment-and-react-on-kalshi-social), [Ideas community guidelines PDF](https://kalshi-public-docs.s3.amazonaws.com/Kalshi+Ideas+Community+Guidelines.pdf)).
  - No engagement metrics published.
- **Polymarket** has per-market comment sections showing holder positions. A WebProNews piece (2026-03-20) says Polymarket added per-market social feeds in stages from late 2025, with text and image posts, replies, up and down votes, a false-content reporting tool and tests of ranking that favours users with strong track records. It cites a New York Times review finding misleading or false content in most high-traffic feeds ([WebProNews](https://www.webpronews.com/polymarkets-social-feed-experiment-is-turning-a-prediction-market-into-a-misinformation-machine/)) [secondary]. I found no engagement data.

#### Copy trading
- **Polymarket:** there is no native copy trading, so a Telegram bot ecosystem fills the gap: PolyGun, PolyCop, Kreo, Polyfox and TradePolyBot.
  - Bots typically charge 0.5–1% of executed volume ([CoinCodeCap](https://coincodecap.com/10-best-polymarket-telegram-bots) [vendor and affiliate]).
  - TradePolyBot claims more than $20M of volume from more than 11,000 traders ([Polymart](https://polymart.app/tradepolybot) [unverified]).
  - Polycule went offline after a January 2026 hack that drained about $230K (same CoinCodeCap source).
  - Custodial bots hold users' keys ([Hysen Labs review](https://hysenlabs.com/projects/dunefalcon1qrj-telegram-bot)).
- **Hyperliquid vaults:** 103 listed vaults held $276.3M of TVL, with a 16.8% TVL-weighted 30-day average APY, as of 2026-10-03 ([Trading Strategy](https://tradingstrategy.ai/vaults/protocols/hyperliquid?tvl=50k)). The protocol vault HLP held about $183M on 2026-10-02 ([VaultVision](https://vaultvision.tech/vaults/tvl)). Leaders typically take a 10% profit share.
- **GMGN** ranks wallets by 30-day PnL and win rate with Smart Money, KOL and Sniper filters, and offers one-click copy ([CoinCodeCap GMGN review](https://coincodecap.com/gmgn-review)). Its revenue is in section 5.5.
- **Bitget** said copy-trading followers rose from 1M to 1.1M in July 2025 ([Bitget press release via AAP](https://www.aap.com.au/aapreleases/globenewswire1001122845/)).
- **Lab evidence:** an AMF-commissioned experiment (Broihanne 2023) found a copy-the-leader feature shifted more money into the risky asset (cited in the [FCA PDF](https://www.fca.org.uk/publication/research-notes/research-note-digital-engagement-practices-trading-apps-experiment.pdf)).

**Reading:** leaderboards alone show no causal effect on trade frequency. Copy trading and whale-watching produce real flows: third-party bots, vault TVL and media. For Probabl, public conditional-market positions plus a "follow this wallet" alert are cheap to build and match what traders already do through third-party tools.

---

### 5.11 Livestreams, creator fees and launchpad loops: pump.fun (rank 10)

- **Fees:** the creator fee is 0.30% on the bonding curve, then a sliding scale after graduation from 0.95% down to 0.05% as market cap rises. Coins can turn on "Holder Rewards" instead of a creator fee. Cashback mode is closed to new launches. A new platform fee of 0.45% (0.40% with a referral code) started 2026-10-17 ([pump.fun fee docs](https://pump.fun/docs/fees)).
- **Livestreams:** suspended in November 2024 after abusive streams and relaunched in April 2025 ([DL News](https://www.dlnews.com/articles/markets/pump-fun-token-3bn-market-cofounder-nibble-lunch-rumble-kick/)).
  - In September 2025, creator payouts hit a record $20M in a week, and the top 25 creators earned $24.1k–$123k in a single day (Dune via [CryptoSlate, 2025-09-15](https://cryptoslate.com/pumpfun-memecoin-streams-explode-as-creators-pocket-record-earnings-in-last-week/)).
  - The co-founder claimed about 1% of Twitch's and 10% of Kick's concurrent-stream share. Pump.fun is not tracked by Streams Charts, so this is unverifiable (same source).
  - Pump.fun reportedly paid creators more than $350M in the year to June 2026 ([CCN](https://www.ccn.com/news/crypto/pump-fun-paid-creators-350m-bear-market-youtube/) [unverified, page returned 403]).
- **Token buybacks:** from late April 2026, 50% of net revenue goes to PUMP buyback and burn, alongside a burn of 36% of circulating supply ([FXStreet](https://www.fxstreet.com/cryptocurrencies/news/pumpfun-burns-36-of-circulating-pump-supply-unveils-50-revenue-buyback-program-202604290053); page returned 403, via search summary). Cumulative buybacks passed $300M by February 2026 ([KuCoin](https://www.kucoin.com/news/articles/pump-fun-surpasses-300-million-in-pump-token-buybacks-a-deep-dive-into-the-platform-s-deflationary-strategy) [secondary]).
- **Users versus revenue:** see section 5.7. Users fell sharply while revenue stayed high.
- **Reading:** creator fees turn token launchers into promoters who stream and shill. That works as acquisition, but the users churn fast. For Probabl, the transferable idea is paying market creators or curators a fee share, which gives outsiders a reason to promote specific markets.

---

### 5.12 Welcome and deposit bonuses (rank 11)

- **FanDuel:** Flutter raised US promotional generosity to about 6% of handle in H2 2026. That was part of a $395M cut to 2026 revenue guidance ([Gaming America, 2026-08-10](https://gamingamerica.com/news/1094563/draftkings-is-all-in-on-prediction-markets-fanduel-is-playing-a-different-game)).
- **DraftKings:** sports net revenue margin fell to 6.8% in Q2 2026 from 8.7% a year earlier, partly on "higher promotions associated with new customers" on its sportsbook and prediction-market products ([DraftKings 10-Q, Q2 2026](https://www.sec.gov/Archives/edgar/data/0001883685/000188368526000029/dkng-20260630.htm)).
- **DraftKings and FanDuel prediction-market marketing:** reportedly about $300M each in 2026 ([DeucesCracked](https://www.deucescracked.com/blog/draftkings-fanduel-prediction-markets-600m-marketing-2026) [unverified]).
- **Kalshi:** welcome credits of $25–$60 through affiliate codes, typically requiring $25 of trades within 7 days, with credit expiring in 7 days ([Covers](https://www.covers.com/betting/bonuses/kalshi-referral-code), [CBS Sports](https://www.cbssports.com/betting/news/kalshi-promo-code/)).
- **Polymarket:** about $25 welcome codes ([SI](https://www.si.com/prediction-markets/promos/polymarket-referral-code) [affiliate page]).
- **Reading:** bonuses are a paid acquisition cost. I found no published retention gain from them. The 7-day expiry with a trade requirement is the standard tool for turning sign-ups into first trades.

---

### 5.13 PnL and share cards (rank 12)

- Axiom has a "Share PnL" button above the chart that makes a shareable card of any trade ([Market Watcher on X](https://x.com/watchingmarkets/status/1907407815053840837) [secondary]).
- Paper-trading extensions for Axiom, GMGN and Padre (DryFlip, Simora) also ship custom PnL cards. Simora shows a self-reported counter of 500+ cards shared ([DryFlip](https://dryflip.com/), [Simora](https://www.simoralabs.com/)).
- I found no data that PnL cards drive sign-ups, whether through embedded referral codes, QR codes or anything else.
- **Reading:** cheap to build and universal in memecoin terminals, but the evidence is anecdotal. For Probabl, a card that shows the conditional spread ("I bought NVDA-if-YES at $X; Fed cut; redeemed for real NVDA") is a distinctive, explainable artifact. Including the referral link in it costs nothing.

---

### 5.14 Streaks, daily quests and login rewards (rank 13)

- I found no trading or prediction-market app publishing streak data. A small Solana app called Streak markets "swipe-to-predict" daily rewards ([streak.app](https://streak.app/)).
- **Duolingo, as an out-of-domain analog:**
  - Learners who reach a 7-day streak are 2.4× more likely to use the app the next day.
  - Separating the daily goal from the streak raised Day-14 retention by 3.3% and grew the number of learners on a 7+ day streak by more than 40% (2020-11-19) ([Duolingo blog](https://blog.duolingo.com/improving-the-streak)).
  - 7-day-streak learners are 3.6× more likely to complete their course, and allowing two Streak Freezes raised daily active learners by 0.38% (2022-01-31) ([Duolingo blog](https://blog.duolingo.com/how-duolingo-streak-builds-habit)).
  - These are correlations from Duolingo's own data, except the A/B results.
- **Reading:** worth testing, but the evidence comes from a different domain. A streak that rewards placing a trade every day is exactly the "activity farming" pattern that lowered retention in Optimism's data. It also matches the gamification the Massachusetts and FCA work targets. A streak for checking positions or making a daily forecast (no trade needed) is the safer variant.

---

### 5.15 Live in-play trading (unknown)

- I found no figure for Kalshi's or Polymarket's in-game share of volume. The evidence nearby is sports' overall share: about 80% of Kalshi volume and 39% of Polymarket's since July 2024 ([Pew, 2026-05-27](https://www.pewresearch.org/short-reads/2026/05/27/trading-volume-on-prediction-markets-has-soared-in-recent-months/)), and 86% of Kalshi's Q2 2026 volume ([Sporting Crypto](https://newsletter.sportingcrypto.com/p/state-of-prediction-markets-q2-2026-report)).
- For Probabl, the equivalent of in-play is trading the stock branches during market hours around scheduled events, such as the 2pm ET FOMC release.

---

### 5.16 Summary: what the evidence says for a daily-return product

1. **Push alerts on meaningful moves** are the only mechanic with clean causal evidence of more trading (+11% FCA; +25% Robinhood field data). Alerts on each conditional branch's price and on the spread between branches fit Probabl naturally. The risk is regulatory (the Massachusetts terms), so keep alerts informative rather than celebratory.
2. **Points work for activity and fail for retention when they reward raw volume.** Tie points to fee-paying trades and to holding through resolution. Exclude self-trades. Blur shows what happens otherwise, and Optimism's frequent-user bonus lowered retention.
3. **Distribution beats in-app tricks.** Robinhood's share of Kalshi volume, Hyperliquid's builder codes and the terminals' 16% of Robinhood Chain DEX volume all point the same way. Fee-sharing deals with the terminals and wallets already on Robinhood Chain (Axiom, GMGN, pump.fun Terminal, Fomo, BasedBot, Robinhood Wallet) are probably the highest-leverage channel.
4. **Fee-share referrals plus cashback** are table stakes in crypto trading. Axiom returns about half its fees. Polymarket's cut from 30% to 10% shows a 30% share can be too expensive for a venue with thin fees.
5. **Cadence is retention.** Prediction-market users return for frequent resolutions (sports, daily markets). Probabl should add short-dated conditional markets (earnings, CPI, FOMC) so there is something new every week, and use the daily stock price moves as content.
6. **Odds-as-news distribution works but is a reputational liability** when done as "BREAKING" posts. Accurate scheduled posts and embeds are the safer form.
7. **Yield on locked collateral** removes the opportunity-cost objection to long-dated conditional positions. Kalshi pays about 3.5% and Polymarket 4%, while Robinhood Earn pays a subsidized 7%. No impact data has been published.

---

## 6. Stocks, crypto and prediction markets together; hedging

Research slice for Probabl (conditional stock markets on Robinhood Chain). Compiled 2026-10-20.

How to read this section:

- Every claim has a URL inline. If a source is secondary or weak, or a figure could not be confirmed against a primary source, it is marked [unverified].
- Every number carries its unit and the date it refers to.
- The web search budget for this session ran out partway through. Later sections therefore rely on direct page fetches and two public APIs:
  - Kalshi trade API, read 2026-10-20 at https://api.elections.kalshi.com/trade-api/v2/
  - Polymarket gamma API, read 2026-10-20 at https://gamma-api.polymarket.com/events
- Gaps are listed at the end.
- About volume units:
  - Kalshi "contracts" are $1-payout contracts. Contract counts are notional, not cash.
  - Polymarket's gamma `volume` field is Polymarket's own USD figure. Its method is not documented on the endpoint [unverified]. Paradigm has shown that naive on-chain sums double-count Polymarket volume (see section 6.5).

---

### 6.0 Bottom line for Probabl

1. **No one offers "stock if event" markets that redeem into the real stock.** The closest live mechanisms are futarchy decision markets, which use the same conditional-vault mechanics on a DAO's own token:
   - MetaDAO on Solana.
   - Seer and Futarchy.fi on Gnosis.
   - Butter's conditional funding markets.

   These markets are thin. Their documented failure modes are thin-branch prices, insider influence and manipulation of the time-weighted average price (TWAP).
2. **Event demand concentrates on macro events, not single-stock events.**
   - Polymarket: Fed decision markets drew $144M–$659M per 2026 FOMC meeting.
   - Kalshi: the September 2026 FOMC market traded about 103M contracts.
   - Single-stock event binaries are tiny. Polymarket's roughly 500 earnings-beat markets held about $22K in total on 2026-10-20. A single-stock price-level market draws $46K–$171K per month.
   - The best fit for conditional stock markets is "big macro condition × liquid megacap or index underlying".
3. **Brokers are moving events next to stock positions.**
   - Robinhood announced a Predict tab and earnings contracts on revenue and EPS for 20+ symbols (Sept 2026).
   - Cboe's SEC-approved company KPI binaries debut on Robinhood (approved 2026-10-15).
   - Robinhood plans an earnings-call player at the top of stock detail pages.
   - The product direction is converging on what Probabl does, but as separate, side-by-side instruments, not as a conditional stock position.
4. **Hedging with prediction markets is real but small, and mostly retail.**
   - The Fed's own staff paper (Feb 2026) says Kalshi is retail-dominated, while institutions hedge rates in SOFR and fed funds futures.
   - BMLL measured fed funds futures order-book depth at about 140× Kalshi's (Sept 2026).
   - Business hedges in the press are anecdotes in the tens of thousands of dollars.
   - Institutional plumbing arrived in 2026: Cantor block trades priced by Susquehanna, and Clear Street as an FCM. Its size is undisclosed.
5. **Price and leverage exposure is now commoditised**, so Probabl's differentiator has to be the conditional pairing, not stock exposure itself. Venues already offering stock perps or tokens:
   - Kalshi US500 perp (2026-10-06).
   - Polymarket perps (announced 2026-04-21).
   - Hyperliquid HIP-3 stock perps (about 50% of Hyperliquid perp volume by July 2026).
   - Robinhood EU perps.
   - Coinbase's upcoming single-stock perps.
   - Robinhood and xStocks stock tokens.

Detailed design lessons are in section 6.7.

---

### 6.1 Conditional and "if-then" markets

#### 6.1.1 Gnosis Conditional Tokens Framework (CTF)

**Mechanics.**

- The CTF is the base layer most on-chain conditional markets use.
- Positions can be split on one condition, and then split again on a second condition. These "deep positions" are how you build an "A and B" or "Y given X" claim.
- Deeper positions can only be created by burning shallower ones, so no new collateral enters. A deep position is valuable only when all its parts are valuable.
- The oracle reports a payout vector that sums to one.
- Source: Gnosis CTF developer guide, https://conditional-tokens.readthedocs.io/en/latest/developer-guide.html

**Who uses it.**

- Polymarket's older position system is built on the CTF: pUSD splits into a YES/NO pair, merges back, and redeems after resolution.
- Polymarket's newer "Protocol V2" uses a PositionManager. Its CombinatorialModule creates "Combos": AND-combinations of legs that still trade as a binary YES/NO pair on Exchange v3.
- Sources: https://docs.polymarket.com/developers/CTF/overview and https://docs.polymarket.com/trading/positions/combinatorial
- The Combos page describes only AND legs and their complement. It does not describe "if X then Y" implication markets or what happens when a leg is voided.

#### 6.1.2 Polymarket conditional markets

**What exists.** I found no evidence that Polymarket had launched true conditional markets ("Y given X", with refund if X fails) by 2026-10-20. What it has instead:

- Combos (parlays) via Protocol V2, described above.
- Private-company markets with Nasdaq Private Market (2026-05-20, international only):
  - The questions cover valuation milestones, IPO timing and secondary activity for OpenAI, Anthropic, SpaceX, Stripe, Kraken and Databricks.
  - Nasdaq Private Market data resolves them.
  - Source: https://www.yogonet.com/international/news/2026/05/20/121166-polymarket-launches-prediction-markets-on-private-companies-like-openai-and-spacex
- Perpetual futures on crypto, equities and commodities:
  - Announced 2026-04-21, with 7–10× leverage shown in the promo (https://news.bitcoin.com/polymarket-unveils-perpetual-futures-trading-for-us-markets-in-2026/).
  - One outlet says they launched on 2026-09-03 at up to 20× across 10 markets [unverified; https://predictionnews.com/story/polymarket-launches-perpetual-contracts-for-crypto-and-stocks returned 403].

#### 6.1.3 Kalshi combos as a form of conditional

**Kalshi.**

- Kalshi launched custom same-game parlays on 2025-09-29 using RFQ, with market makers pricing each combo [secondary: https://nexteventhorizon.substack.com/p/parlays-propel-kalshi-to-back-to-back-records].
- Combo volume share in 2026:
  - About 70% of daily notional volume on 2026-10-10 ($2.80B of $3.91B) and 2026-10-11 ($2.75B of $3.96B). Source: https://cryptobriefing.com/kalshi-daily-volume-records-parlays/
  - The same coverage says notional overstates money at risk because of sub-1-cent long-shot combos.
  - DeFi Rate's "dollars paid" tracker puts multi-leg parlays at $5.3B, or 28% of dollars paid, over a 30-day window ending mid-Oct 2026 [secondary: https://defirate.com/prediction-markets/volume/kalshi/, via search summary].
- Sportico reports retail lost more than $100M on Kalshi parlays (KXMVE tickers) from Jan to Apr 2026 [unverified; https://www.sportico.com/business/sports-betting/2026/kalshi-parlays-retail-bettor-losses-rfq-1234894471/ is paywalled].

**Robinhood.**

- Robinhood announced "Custom Combos" of up to ten outcomes on 2025-12-16, to arrive in early 2026 (https://robinhood.com/us/en/newsroom/robinhood-presents-yes-no-event).

**What a combo is not.** A combo is a conjunction (A and B). It is not a conditional (B given A, with refund if not A). No major venue sells the conditional form.

#### 6.1.4 Manifold and Metaculus

**Metaculus.**

- Added "conditional pairs" in February 2023: a parent question plus a child question, forecast as P(child | parent yes) and P(child | parent no). Source: https://forum.effectivealtruism.org/posts/qELZknyx8eBg7HskH/metaculus-introduces-new-conditional-pair-forecast-questions
- Ran a Conditional Cup tournament from October 2023 to December 2024, with about 50 questions [secondary: https://metaculus.com/tournament/2503].

**Manifold.**

- Has no native conditional type. Users title markets "If X, will Y?"
- Convention: the market resolves N/A (everyone refunded) if X fails, and a human resolves it if X happens.
- Users have debated alternatives: resolve NO, resolve to market price, or resolve to a poll. Source: https://manifold.markets/Stralor/what-forms-of-conditional-markets-d
- Commenters argue conditional markets are useful mainly when the condition has more than a 25% chance of happening (same page).

**Relevance to Probabl.** "N/A refund on the unmet branch" is exactly the rule Probabl uses.

#### 6.1.5 MetaDAO (Solana futarchy)

**Mechanism**, from a technical reference dated 2026-05-27 (https://devrels.xyz/articles/metadao-futarchy-technical-reference):

- Three programs: autocrat, conditional_vault and amm.
- Each proposal gets two vaults, one for META and one for USDC. Depositing mints equal pass-tokens and fail-tokens.
- There are two constant-product AMM pools: pass-META/pass-USDC and fail-META/fail-USDC.
- The higher TWAP wins. The winning vault is "Finalised" and the losing vault "Reverted", so losing-side tokens become worthless and trades on that side are effectively undone.
- The article says thin markets make the TWAP meaningless and that per-proposal liquidity bootstrapping is "a non-trivial UX problem".

**Track record and scale.**

- 96 proposals decided this way since November 2023 [unverified, secondary].
- Umbra decisions shown on MetaDAO had tiny volumes [unverified; from a search summary of https://metadao.fi/companies/umbra, page returned 429]:
  - A buyback setup passed with $22.9K volume and 6 traders.
  - A liquidity proposal passed with $50 and one trader.
- In early August 2026, an attacker staked enough to submit a proposal draining about $1.5M–$1.57M USDC from Umbra's treasury. The market priced it at about 28% pass and rejected it. Crypto Briefing calls the margin thin. Source: https://cryptobriefing.com/umbra-privacy-treasury-governance-attack-metadao/ (2026-08-04)
- Umbra's October 2025 community sale drew more than $154M in commitments against a $3M cap (same source).

**Launchpad.**

- The permissionless launchpad "Futardio" launched on 2026-03-03.
- By mid-March 2026: about $43M committed across 54 projects, only 2 hitting their goals. Backers are fully refunded when a project misses its target.
- Source: https://cryptobriefing.com/futardio-44m-commitments-metadao-sourcing/ (published 2026-09-14)
- Reportedly renamed "Backable" on 2026-10-05, showing $44.2M committed by 2,407 backers and 12 of 95 raises funded [unverified; https://solanacompass.com/news/metadao-renames-futardio-as-backable-its-permissionless-fundraising-platform-on-solana returned 403].

**Volume.**

- DeFiLlama-cited figures: about $18M in 30-day DEX volume and about $426K monthly revenue (date unclear). CoinGecko showed about $353K in 24-hour volume [both unverified; https://www.coingecko.com/en/exchanges/metadao-futarchy-amm].

#### 6.1.6 Seer and Futarchy.fi (Gnosis)

**Seer.**

- Builds futarchy markets on the CTF and Reality.eth.
- Picking token GNO and currency wstETH creates four tokens: YES_GNO, NO_GNO, YES_wstETH and NO_wstETH. These trade in a yes-pool and a no-pool. A proposal passes if YES_GNO/YES_wstETH is priced above NO_GNO/NO_wstETH.
- An invalid resolution counts as fail.
- Futarchy markets are "only available on Gnosis Chain".
- Source: https://seer-3.gitbook.io/seer-documentation/getting-started/navigate-our-site/futarchy-markets

**Futarchy.fi.**

- Pitched as "market-based evaluation of governance decisions and milestones".
- Can run advisory-first, then self-enforcing.
- Robin Hanson is its Chief Scientific Officer.
- Source: https://futarchy.fi

**Data.** I found no 2026 volume data for either.

#### 6.1.7 Butter: conditional funding markets (CFMs)

**Optimism futarchy v1** (Butter play-money markets; closed 2025-06-12). Source: https://gov.optimism.io/t/futarchy-v1-preliminary-findings/10062

- Participation: 430 forecasters after filtering out 4,122 suspected bots, making 5,898 trades. 88.6% were first-time governance participants.
- Each cohort, futarchy and Grants Council, funded 5 projects at 100K OP each.
- Futarchy's picks showed about $32.5M more Superchain TVL growth over 84 days (2025-03-20 to 2025-06-12). Most of the gap came from one outlier, Balancer & Beets.
- Futarchy picked both the best and the worst performers.
- Predictions were about $200M too high. A commenter cited about $239M predicted against about $31M realized.
- Caveats: play money, no downside, possible anchoring on the 50M initial liquidity, and a sample of only 3 unique picks per side.

**Uniswap Foundation CFM** (real money, 2025-07-07 to 07-11):

- A $100K grant was contested by four lending protocols. 29 forecasters traded more than $70K.
- Morpho won. Its 30-day trailing TVL was $207M, 11.8% above projection.
- Lessons: insiders had more influence than expected, TVL forecasting was too complex for most traders, and the UX needs simplification.
- Source: https://www.uniswapfoundation.org/blog/unichain-cfm-pilot-case-study?1=
- Butter's own report notes that an ETH rally inflated USD TVL, so the effect cannot be cleanly attributed. Source: https://github.com/buttermarkets/ggresearch/blob/main/topic/experiments/uniswap-foundation-growth-cfm-1-report.md

#### 6.1.8 Robin Hanson, Paradigm, Vitalik

**Hanson.**

- Paid adviser to MetaDAO since February 2025 [secondary: https://finance.yahoo.com/news/metadao-hires-futarchys-creator-robin-181650844.html].
- Chief Scientific Officer at Futarchy.fi (https://futarchy.fi).
- I found no 2026 Hanson commentary specifically on MetaDAO.

**Paradigm, "Quantum Markets"** (Alpin Yukseloglu and Sofiane Larbi, 2025-06-12; https://www.paradigm.xyz/writing/quantum-markets). This is the most relevant design essay for Probabl:

- One deposit gives tradable credits in every proposal's market.
- Only the winning proposal settles; the losers are "fully aborted/reverted".
- A trader who did not trade the winning branch keeps their principal.
- This removes the per-proposal liquidity cost that MetaDAO faces.

**Other Paradigm work:**

- pm-AMM, an AMM designed for prediction markets (2024-11-05; https://www.paradigm.xyz/writing/pm-amm).
- "Opportunity Markets": private sponsor-funded markets (2025-08-18; https://www.paradigm.xyz/writing/opportunity-markets).
- The Polymarket double-counting piece (2025-12-08).
- Paradigm Predictions, a data map (2026-02-04). Paradigm discloses it is a Kalshi investor.
- Source for the list: https://www.paradigm.xyz/writing

**Vitalik Buterin** framed prediction markets as one case of "info finance" and revisited futarchy (2024-11-09; https://vitalik.eth.limo/general/2024/11/09/infofinance.html).

**a16z.** I found nothing usable on conditional markets before the search budget ran out (gap).

#### 6.1.9 "If X then stock Y" markets anywhere

None found, as of 2026-10-20, that pay in the stock conditional on an outside event. The nearest analogues:

- Futarchy, where the conditional asset is the DAO token itself.
- Hyperliquid pre-IPO perps that convert into a standard perp at IPO (section 6.4).
- Kalshi and Polymarket markets on events about stocks, which pay cash, not stock.

---

### 6.2 Robinhood

#### 6.2.1 Event contracts inside the brokerage app

**How it works.**

- Venues: Robinhood Derivatives offers event contracts through KalshiEX, ForecastEX, Rothera Exchange and Clearing, and North American Derivatives Exchange (Nadex).
- Contracts are binary: YES or NO pays $1, with prices from $0.01 to $0.99.
- Fees from 2026-06-01: commission = k × p × (1 − p) × contracts, where k = 10% (or 5% with Gold). This is capped at $0.01 per contract, plus exchange fees of up to $0.01.
- Settled cash only; instant-deposit funds cannot be used.
- Mobile only for trading; the web is view-only.
- State limits: Maryland and Nevada residents cannot trade sports contracts, and Michigan residents cannot open new sports contracts from 2026-09-09.
- Source: https://robinhood.com/us/en/support/articles/event-contracts-overview/

**Categories and features.**

- Robinhood listed "thousands of live events across economics, politics, sports, culture and more" (2025-12-16; https://robinhood.com/us/en/newsroom/robinhood-presents-yes-no-event).
- Features at that point: limit orders, dollar-based trading, 24/7 access, preset combos, player props, and Custom Combos (up to 10 legs) coming in early 2026.
- Cortex would let Gold subscribers "explore event contracts" in plain English (Q1 2026 rollout).

**Volumes and revenue** (company releases):

| Period | Contracts traded | Revenue | Notes | Source |
|---|---|---|---|---|
| Cumulative to 2025-12-16 | 11B | — | More than 1M customers | https://robinhood.com/us/en/newsroom/robinhood-presents-yes-no-event |
| Q1 2026 | 8.8B (record) | $147M "other transaction revenue", up 320% YoY, "primarily" event contracts | A secondary summary of the 10-Q puts event-contract revenue at $104M [unverified] | https://www.sec.gov/Archives/edgar/data/0001783879/000178387926000061/q12026robinhoodexhibit991.htm |
| Q2 2026 | 13.6B (record, more than 10× YoY) | $156M event-contract revenue, more than 10× YoY | Total net revenue $1.308B, up 32% YoY | https://www.sec.gov/Archives/edgar/data/0001783879/000178387926000113/q22026robinhoodexhibit991.htm |
| June 2026 | 6.4B | — | — | https://nexteventhorizon.substack.com/p/robinhood-prediction-markets-q2-earnings |
| July 2026 | 6.1B | — | Down 5% MoM, about 20× YoY; average daily volume 197M contracts | https://investors.robinhood.com/news-releases/news-release-details/robinhood-markets-inc-reports-july-2026-operating-data (2026-08-12) |
| Aug 2026 | 4.7B | — | Down 23% MoM, 15× YoY | [unverified; GlobeNewswire page returned 403 — https://www.globenewswire.com/news-release/2026/09/10/3359962/0/en/robinhood-markets-inc-reports-august-2026-operating-data.html] |
| Sept 1–24, 2026 | About 4.4B | — | Month to date | [unverified; IR PDF returned 403 — https://investors.robinhood.com/static-files/7ba5e924-5515-4ca9-bf69-638f89e56caf] |

**Other figures.**

- In Q2 2026, event-contract revenue passed crypto revenue for the first time, and the CFO said 2M customers use prediction markets (https://nexteventhorizon.substack.com/p/robinhood-prediction-markets-q2-earnings).
- Q3 2026 results are due 2026-10-27, so no Q3 total yet (https://www.marketbeat.com/earnings/reports/2026-10-27-robinhood-markets-inc-stock/).
- Category mix: Robinhood gives no split. Tenev says crypto-linked contracts take a "disproportionate share" and expects sports to become a minority eventually. Source: https://finance.yahoo.com/markets/options/articles/robinhoods-prediction-markets-move-beyond-141700660.html (2026-09-23)

#### 6.2.2 Robinhood's own exchange: Rothera, formerly LedgerX/MIAXdx

**Ownership.**

- A Robinhood–Susquehanna joint venture bought 90% of MIAXdx (formerly FTX's LedgerX). Robinhood controls the JV, and Susquehanna is partner and day-one liquidity provider. Source: https://www.covers.com/industry/robinhood-acquires-ledgerx-to-expand-prediction-markets-amid-overwhelming-growth-nov-26-2025 (2025-11-26)
- MIAX completed the sale on 2026-01-21 (SEC 8-K: https://www.sec.gov/Archives/edgar/data/1438472/000143847226000008/miaxpr-finalxclosingonsa.htm).

**Launch and scale.**

- Launched in June 2026 as "Rothera", a CFTC-licensed exchange and clearinghouse.
- More than 3.5B contracts traded to the date of the Q2 release (2026-07-29).
- Q2 2026: $17M of the $156M event revenue and 2.1B contracts, including trading by non-Robinhood participants.
- Tenev called it "a top-3 DCM" and said Robinhood will "push more flow there" while keeping several counterparties. Robinhood does not wholly own or operationally control Rothera.
- Sources: Q2 8-K above; https://nexteventhorizon.substack.com/p/robinhood-prediction-markets-q2-earnings

#### 6.2.3 Stock tokens and Robinhood Chain

**EU product.** The first-generation "Classic Stock Tokens" are derivative contracts with Robinhood Europe, held in-app.

**On-chain product.**

- Robinhood Chain public mainnet, an Arbitrum-based L2, launched on 2026-07-01.
- New Stock Tokens:
  - Are tokenized debt securities issued by Robinhood Assets (Jersey) Ltd. They give economic exposure only, with no legal or beneficial rights in the shares.
  - Are offered in more than 120 countries via Robinhood Wallet, and are not available to US persons. They are restricted in Canada, the UK, Switzerland, the UAE and sanctioned jurisdictions.
  - Trade 24/7 on Uniswap, Rialto, Lighter, Arcus and 1inch.
  - Can go into DeFi lending.
- Robinhood Earn lends USDG via Morpho at an estimated 7% APY.
- Lighter perps are offered inside the wallet.
- Source: https://robinhood.com/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/

**Counts and on-chain stats.**

- 190+ on-chain Stock Tokens and 2,000+ Classic tokens as of 2026-10-08 [secondary: https://eco.com/support/en/articles/15083160-robinhood-tokenized-stocks-what-s-live-and-how-it-works].
- Chain TVL about $1.05B on 2026-10-08 [unverified, secondary: https://www.datawallet.com/crypto/robinhood-chain-statistics].

#### 6.2.4 Prediction markets next to stock positions

**HOOD Summit '26** (2026-09-29; https://ng.investing.com/news/stock-market-news/robinhood-at-hood-summit-26-pushes-trading-into-living-hours-93CH-2715061):

- More than 50B prediction contracts traded to date.
- A new "Predict" tab will surface earnings trading.
- Binary contracts on revenue, EPS and other company metrics for 20+ symbols and hundreds of events, "in time for Q3 earnings".
- An earnings-call player "right at the top of the stock detail page", with transcripts, live comments and one-tap trading.

**Cboe KPI contracts.**

- Announced 2026-09-30 at the HOOD Summit (https://ir.cboe.com/news/news-details/2026/Cboe-and-Robinhood-Announce-Planned-Launch-of-New-KPI-Contracts-Further-Expanding-Prediction-Market-Offerings/default.aspx).
- Design:
  - SEC-regulated binary options on company KPIs for 23 heavily traded US stocks.
  - Cleared by Cboe Clear U.S., pending its registration.
  - Robinhood is the first broker.
  - Cboe and Robinhood both waive fees through the end of 2026.
- SEC approval was reported on 2026-10-15. The filing covers up to 100 contracts across 23 companies, including Apple, Alphabet, Amazon, Coinbase, Nvidia, Palantir, Robinhood, SpaceX and Tesla. Example KPIs: Nvidia edge-computing revenue, Coinbase transaction volume, Tesla deliveries. Trading waits on final clearinghouse approval. Source: https://www.yogonet.com/international/news/2026/10/15/126852-sec-approves-cboe-event-contracts-tied-to-corporate-kpis-ahead-of-robinhood-debut
- SEC Chairman Atkins said standard securities rules apply. The order does not rule out CFTC jurisdiction over KPI contracts structured differently.

**Cortex.** The release says Cortex is an AI layer (Digests, Assistant) that lets Gold users explore event contracts in plain English. I found no evidence that event contracts are embedded on stock pages beyond the earnings-call player and the Predict tab.

---

### 6.3 Polymarket and Kalshi markets on stocks, earnings and macro

#### 6.3.1 Polymarket stock markets

**Daily "Up or Down" markets** on SPX, SPY, single names (META, OPEN) and EWY.

- Example: "S&P 500 (SPX) Up or Down on October 8?" traded $30.1K.
- Its page states two different resolution sources: Binance SPX/USDT 1-minute candles in the FAQ, and WSJ market data in the rules.
- Source: https://polymarket.com/event/spx-up-or-down-on-october-8-2026

**Price-level ("what will X hit") markets.** Cumulative volume on open October 2026 markets, read via the gamma API on 2026-10-20 (https://gamma-api.polymarket.com/events?tag_slug=stocks&closed=false&order=volume):

| Underlying | Volume (USD) |
|---|---|
| SPY | $171K |
| EWY | $113K |
| NVDA | $95K |
| META | $91K |
| COIN | $73K |
| TSLA | $65K |
| PLTR | $64K |
| HOOD | $59K |
| AMZN | $51K |
| GOOGL | $46K |
| AAPL | $46K |
| MSFT | $34K |

**Earnings-beat markets.**

- Launched 2025-09-15 with Stocktwits; the first markets included FedEx and Bullish (https://www.theblock.co/post/370819/polymarket-adds-company-earnings-forecasts).
- The hub says it "currently hosts 500 active markets", with "over $22K in trading volume" across the 20 shown on 2026-10-20 (https://polymarket.com/predictions/earnings).
- The largest open earnings market in the gamma API was FedEx at $5.8K (gamma API, tag `earnings`, 2026-10-20).
- Earnings-call "mention" markets also exist: Netflix, Tesla ("Optimus"), GM ("Tariff").

**Stock-specific event markets with no substitute instrument draw far more.** Cumulative USD volume, gamma API on 2026-10-20 (tags `finance` and `ipos`):

| Market | Volume (USD) | Notes |
|---|---|---|
| Which companies will be acquired before 2027 | $18.4M | — |
| Largest company end of December 2026 | $8.62M | NVIDIA YES at 73.5%, Apple 25.2% |
| IPOs before 2027 | $7.55M | — |
| Largest IPO by market cap in 2026 | $6.64M | — |
| Anthropic valuation by Dec 31 | $5.87M | — |
| Anthropic IPO by … | $5.14M | — |
| OpenAI IPO by … | $3.06M | — |
| Will GameStop acquire eBay | $3.16M | — |

**Macro markets dwarf all of these.** Polymarket Fed decision markets, USD volume, closed events, gamma API on 2026-10-20 (tag `fed`):

| Meeting | Volume (USD) |
|---|---|
| Jan 2026 | $659.5M |
| Mar 2026 | $260.1M |
| Apr 2026 | $284.2M |
| Jun 2026 | $164.6M |
| Jul 2026 | $144.0M |
| Sep 2026 | $208.0M |
| Oct 2026 (still open) | $49.9M |

Related markets:

- "Who will Trump nominate as Fed chair": $617.3M.
- "How many Fed rate cuts in 2026": $54.5M.
- For comparison, the Sept 2025 Fed market was Polymarket's most active market at $139M when The Block covered the earnings launch (https://www.theblock.co/post/370819/polymarket-adds-company-earnings-forecasts).

**Data distribution.**

- Yahoo Finance used Polymarket data for an on-site hub, announced Nov 2025. The hub came down around April 2026, and the data deal ended. Bloomberg reported this on 2026-09-18; Polymarket stays an advertiser. Sources: https://www.bloomberg.com/news/articles/2026-09-18/yahoo-finance-and-polymarket-end-prediction-market-partnership and https://finance.yahoo.com/media-advertising/articles/yahoo-finance-polymarket-end-prediction-142338309.html
- Polymarket feeds Dow Jones (deal from January 2026, per the same Yahoo piece).
- Google Finance and Search added Kalshi and Polymarket odds; announced 2025-11-06, first to Labs users (https://www.coindesk.com/markets/2025/11/06/google-brings-prediction-markets-polymarket-and-kalshi-to-its-search-and-finance-platforms).

#### 6.3.2 Kalshi financial and company markets

**Catalogue** (Kalshi public API, 2026-10-20):

| Category | Series count | Examples |
|---|---|---|
| Financials | 1,018 | Daily, hourly, weekly, monthly and yearly S&P 500 and Nasdaq-100 ranges, above/below and up/down; "S&P vs Nasdaq"; "S&P 500 vs gold"; 10Y Treasury; IPO timing (SpaceX, Anthropic, OpenAI, Databricks, Ramp, Plaid, Discord, Fannie/Freddie); acquisitions (Warner Bros, EA, NextEra); index additions/removals |
| Companies | 216 | Many "Annual KPI" series (Tesla, Nvidia, Apple, Uber, Robinhood, Costco, Walmart, Meta, etc.); CEO-change markets; Tesla deliveries/production |
| Mentions | 462 | 191 "earnings mention" series |

Source endpoint: https://api.elections.kalshi.com/trade-api/v2/series?category=Financials (likewise `Companies` and `Mentions`).

**Volumes**, contracts traded as of 2026-10-20 (API `volume_fp`, summed over each event's markets; each contract pays $1). Source pattern: https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=SERIES&with_nested_markets=true

| Market | Contracts traded |
|---|---|
| Fed decision, Sep 16 2026 meeting | 103.2M |
| Fed decision, Oct 28 2026 meeting (8 days out) | 12.6M |
| Fed decision, Dec 2026 meeting | 1.27M |
| CPI, Sept 2026 print (released 2026-10-14) | 1.60M |
| CPI, Oct 2026 print | 0.72M |
| CPI, Aug 2026 print | 0.52M |
| "Recession this year?" (2026) | 3.69M |
| "When will the next US recession start" | 0.52M |
| S&P 500 close, end of 2026 | 7.90M |
| S&P 500 daily 4pm range, Oct 14–19 2026 | 14K–47K per day |
| Robinhood funded customers 2026 (KPI) | 219K |
| Robinhood fiscal-2026 event-contract volume (KPI) | 138K |
| Tesla 2026 deliveries (KPI) | 65K |
| Nvidia FY2027 headcount (KPI) | 31K |
| Earnings mentions: JPMorgan (2026-10-13) | 44K |
| Earnings mentions: Netflix (2026-10-20) | 23K |
| Earnings mentions: Tesla (2026-10-28) | 20K |

Settled events older than a few weeks return zero in the API, so I could not read final totals for earlier meetings.

**Kalshi's own and third-party figures.**

- Kalshi's preview said more than $80M had traded on the September 2026 FOMC by 2026-09-15 (https://kalshi.com/research/insights/september-fomc-preview, via search; the page returned 429 to direct fetch).
- The FOMC raised rates by 25bp in September 2026 (https://www.bmlltech.com/news/market-insight/when-kalshi-and-fed-funds-futures-disagree).
- Total Kalshi volume over 2026-09-20 to 2026-10-19:
  - About $80.0B in contracts, a 76% share of prediction-market volume.
  - $18.6B "dollars paid".
  - About $295B year to date.
  - [Secondary: https://defirate.com/prediction-markets/volume/kalshi/]

**Pew Research** (notional taker volume, USD millions; https://www.pewresearch.org/short-reads/2026/09/23/prediction-markets-trading-volume-doubled-between-may-and-july-largely-driven-by-sports/). Pew has no separate economics/finance category, so these markets sit mostly in "Other".

| Venue and category | Jul 2025 | Jan 2026 | Jun 2026 | Jul 2026 |
|---|---|---|---|---|
| Kalshi sports | 541.7 | 8,519.7 | 26,610.4 | 31,395.7 |
| Kalshi crypto | 61.2 | 340.2 | 4,012.8 | 6,101.1 |
| Kalshi other | 103.6 | 434.5 | 2,118.2 | 2,437.1 |
| Kalshi politics | 33.9 | 259.9 | 261.2 | 169.2 |
| Polymarket sports | 326.0 | 3,382.8 | 11,381.0 | 10,618.5 |
| Polymarket politics | 221.4 | 2,098.5 | 1,263.9 | 726.8 |
| Polymarket crypto | 290.6 | 1,819.5 | 1,649.3 | 1,154.1 |
| Polymarket other | 437.5 | 639.7 | 448.8 | 391.0 |

#### 6.3.3 Kalshi US500 perpetual

- Launched 2026-10-06. Kalshi called it "the first stock index perpetual future in America"; CEO Tarek Mansour called it a step toward a "full-service financial exchange". The CFTC filing was made in August 2026. Source: https://cryptobriefing.com/kalshi-expands-into-stock-market-derivatives-with-us-500-perpetual/
- Contract: ticker US500PERP, cash-settled, $1 per point on the MerQube US Large Cap Index rather than the S&P 500. Funding settles daily at the 4pm ET equity close. Trading runs nearly 24 hours Sunday to Friday. [Secondary: https://financefeeds.com/kalshi-goes-live-with-a-product/ (403 on fetch; via search summary)]
- Maximum leverage was 15.3× on launch day, with collateral in a futures account (https://thedefiant.io/converge/tradfi-and-fintech/kalshi-launches-us-500-perpetual-future-with-no-expiration). Kalshi's learn page reportedly shows 13.7× and a funding cap of 2% per cycle [unverified; https://kalshi.com/perpetuals/learn returned 429].
- Early volume: about $556K in 24-hour volume and $219.6K open interest shortly after launch [unverified, secondary].
- Kalshi is also preparing a WTI crude perp (same Crypto Briefing source).

#### 6.3.4 Coinbase clearing

- The CFTC approved Coinbase Clearing LLC as a DCO on 2026-09-28. A DeFi Rate sidebar dates it 2026-10-02, but The Block's dated article says 2026-09-28.
- Scope: fully collateralized futures, options on futures and swaps only, with no leveraged products. Coinbase calls the clearinghouse "USDC-native".
- Coinbase now has listing (DCM), brokerage (FCM) and clearing (DCO) in-house. Third parties will keep clearing its margined products and "our upcoming launch of single stock perps".
- Source: https://www.theblock.co/news/business/2026-09-28-coinbase-dco-approval-417105
- Coinbase's prediction-market contracts and revenue rose 106% QoQ in Q2 2026 (https://finance.yahoo.com/markets/options/articles/robinhoods-prediction-markets-move-beyond-141700660.html).

---

### 6.4 Other venues mixing stock or crypto exposure with events

#### 6.4.1 Hyperliquid HIP-3 and pre-IPO perps

**Stock perps.**

- HIP-3's share of Hyperliquid perp volume rose from about 2% in early 2026 to about 50% by 2026-07-13, driven by equity perps such as XYZ100 (Nasdaq-100), NVDA and TSLA. All settle in stablecoin. Trade.xyz dominates. Source: https://www.theblock.co/news/defi/2026-07-13-hyperliquid-hip-3-markets-surge-50-perp-volume-onchain-stock-trading-grows-408064
- The Block headline: HIP-3 topped $62B in monthly volume (May 2026) (https://www.theblock.co/post/403384/hyperliquid-record-share-global-perps-market-hip-3-tops-62-billion-monthly-volume).

**Pre-IPO perps.**

- Trade.xyz listed Cerebras in early May 2026 and SpaceX on 2026-05-17.
- Cerebras convergence: the perp traded near $340 an hour before Nasdaq opened at $350, against a $185 IPO price and about $225 on Hiive.
- Cerebras perp volume: about $207M notional in two weeks.
- Venues cap open interest per market.
- Source: https://www.theblock.co/newsletters/the-funding/2026-05-17-spacex-ipo-pre-ipo-perps-crypto-401570
- Talos, 2026-06-09: open interest about $106M and $1.46B cumulative volume across Hyperliquid pre-IPO markets, 95% on trade.xyz. Trade.xyz prices from its own order book and, post-IPO, "automatically converts to a standard externally-priced equity perpetual". Ventuals lists SPACEX, OPENAI and ANTHROPIC priced in implied valuation via a hybrid oracle. Source: https://www.talos.com/insights/state-of-the-network-367
- A claim that Ventuals shut down in June 2026 is [unverified]; the HTX article returned empty.

#### 6.4.2 xStocks (Backed/Kraken)

- More than $25B total transaction volume since launch, including about $3.5B on-chain across Solana, Ethereum and TON. More than 80,000 on-chain holders and about $225M AUM, each token backed 1:1 by a custodied share. Source: https://www.theblock.co/post/390537/tokenized-xstocks-surpass-25-billion-total-transaction-volume-kraken (2026-02-19)
- Solana xStocks passed $6B cumulative DEX volume by 2026-09-18 [secondary: https://solanacompass.com/news/xstocks-crosses-6-billion-in-solana-tokenized-stock-volume-as-raydium-q3-tops-23b].
- Kamino held $20.7M of xStocks collateral on 2026-09-13 [secondary, via search summary].
- Kraken's FAQ lists Kamino and Morpho as places to borrow against xStocks. Holders own tracker certificates, not shares (https://support.kraken.com/articles/xstocks-faq).

#### 6.4.3 Interactive Brokers ForecastEx

- IBKR's Q3 2026 call (2026-10-15) covered prediction markets and new event contracts: https://www.fool.com/earnings/call-transcripts/2026/10/16/interactive-brokers-ibkr-q3-2026-earnings-call-transcript/
  - IBKR added hourly and 15-minute event contracts on crypto, metals and energy.
  - Its prediction-market interface carries ForecastEx, Kalshi and CME, and IBKR is "working on integrating with Polymarket".
  - It plans to list Cboe single-stock KPI contracts in both the prediction-market screen and the regular options screen, pairing the call and put so prices sum to at most $1.
  - No volumes were given.
- Earlier: ForecastEx traded 286M pairs in a quarter, up from 15M, with 4 quoting members and more than 10,000 instruments; temperature contracts were the most traded [secondary, quarter unclear: https://www.artemis.bm/news/weather-the-most-frequently-traded-forecast-contracts-at-interactive-brokers-founder/].

#### 6.4.4 CME event contracts and FanDuel Predicts

- CME and FanDuel launched Yes/No contracts on S&P 500, Nasdaq-100, oil, gas, gold, crypto, GDP and CPI (https://flutter.com/news-media/press-releases/fanduel-and-cme-group-launch-fanduel-predicts/).
- CME said event-contract volume had topped $220M since its December launch, as of an earlier 2026 call [secondary: https://www.casino.org/news/cme-group-seeing-strong-prediction-market-volume-account-growth/].
- FanDuel's sports and novelty contracts moved to Crypto.com's exchange, while CME keeps the financial ones. CME's share was put at about 0.02% of US regulated prediction volume in early July 2026 [secondary: https://www.sportico.com/business/sports-betting/2026/fanduel-cme-prediction-market-crypto-nadex-1234941188/, paywalled; https://news.bitcoin.com/igaming/cme-keeps-51-of-fanduel-predicts-but-loses-its-sports-business/].

#### 6.4.5 Nadex (historical binaries)

- Started as HedgeStreet (exchange launched October 2004; founder coined "hedgelets").
- Shut down in late 2007 and was bought by IG Group for $6.0M; renamed Nadex in 2009.
- CFTC-regulated binaries and spreads on forex, commodities and stock indices.
- Crypto.com bought it in March 2022.
- Source: https://en.wikipedia.org/wiki/Nadex
- It is one of the exchanges behind Robinhood event contracts today (https://robinhood.com/us/en/support/articles/event-contracts-overview/).
- Lesson: retail binaries on index levels have existed for 20 years without becoming large. The 2025–26 growth came from sports, macro and distribution through brokers.

#### 6.4.6 Webull, Deribit/OKX, Opinion Labs

- **Webull** distributes Kalshi contracts on Fed and hourly crypto events [secondary: https://defirate.com/news/kalshi-1-8-billion-weekly-volume-as-prediction-markets-top-2-3-billion/]. I found no 2026 Webull volumes.
- **Deribit/OKX event options and Opinion Labs (BNB macro markets):** not researched; the search budget was exhausted (gap).

---

### 6.5 Hedging: evidence that traders use prediction markets to hedge stock, crypto or macro risk

#### 6.5.1 Fed and CPI accuracy versus futures

**Federal Reserve staff paper:** Diercks (Fed Board), Katz (Northwestern) and Wright (Johns Hopkins/NBER), "Kalshi and the Rise of Macro Markets", FEDS 2026-010, 2026-02-12 (https://www.federalreserve.gov/econres/feds/files/2026010pap.pdf). Findings, read from the PDF:

- The Kalshi median and mode had a "perfect forecast record on the day before the FOMC meeting", a statistically significant improvement over fed funds futures. The mode matched the realized rate by the day of each meeting since 2022.
- For headline CPI, Kalshi was significantly better than the Bloomberg consensus. Core CPI and unemployment were about the same.
- Kalshi is "retail" with "relatively low entry cost". SOFR options are institutional, and institutions' hedging demand may bias SOFR-implied probabilities toward "no change". In other words, the staff argue Kalshi is a cleaner expectations signal because it is not a hedging market.
- Kalshi's maximum exposure per market was $7M at the time.
- Fed funds market volume was "frequently above a million" contracts, peaking near 100M for the September FOMC.
- Coverage notes that much of Kalshi's edge comes from the September 2024 meeting (https://fortune.com/2026/01/28/kalshi-prediction-market-federal-reserve-betting-forecast-nber-working-paper/).

**BMLL** (2026-10-01; https://www.bmlltech.com/news/market-insight/when-kalshi-and-fed-funds-futures-disagree), comparing 12 FOMC meetings from May 2025 to Sept 2026:

- Kalshi and CME fed funds futures disagreed by up to 2.8bp.
- Futures reacted about 0.6 seconds faster to the 2026-09-11 CPI print.
- Accuracy: Kalshi was closer in July 2026 (hold) and futures were closer in September 2026 (25bp hike).
- Volume in the 30 days before each meeting:

  | Meeting | Kalshi contracts | Futures lots |
  |---|---|---|
  | June 2026 | 25.7M | 2.0M |
  | July 2026 | 61.5M | 4.5M |
  | Sept 2026 | 93.4M | 5.2M |

- Displayed depth in September 2026: futures about $2.5M per bp against Kalshi about $17.5K per bp, roughly 140:1.
- The author's conclusion: Kalshi maps directly to single meetings, which suits hedging, but thin depth limits size.

#### 6.5.2 Institutional push

- **Susquehanna** has been Kalshi's flagship market maker since April 2024 [secondary: https://www.tradermath.org/articles/prediction-markets-trading-at-quant-firms].
- **Jump** reportedly took equity stakes in Kalshi and Polymarket for supplying liquidity (Bloomberg, Feb 2026) [unverified secondary].
- **DRW** desk hiring [unverified].
- **Cantor Fitzgerald** opened Kalshi block trading to about 3,000 institutional clients, priced by Susquehanna (announced 2026-08-19). Kalshi's first block trade was in April 2026. [Secondary: https://predictionnews.com/story/cantor-lets-hedge-funds-place-big-bets-on-kalshis-prediction-markets, 403 on fetch]
- **Clear Street** became the first institutional FCM on Kalshi (May 2026) [secondary, via search summary].
- **Institutional growth:** Kalshi said institutional volume rose 800% over six months, with no dollar figure. Bernstein attributes institutional demand to bespoke contracts that hedge macro and geopolitical risk. [Secondary: https://www.coindesk.com/business/2026/05/07/kalshi-confirms-usd1-billion-raise-at-usd22-billion-valuation-amid-prediction-market-boom]
- **Kalshi valuation:** $22B (May 2026; same CoinDesk source).
- **Hedge fund uses** listed by CNBC (2026-08-19): https://www.cnbc.com/2026/08/19/hedge-funds-are-about-to-jump-in-big-to-prediction-markets.html (403 on fetch; details [unverified]).

#### 6.5.3 Terminals and data

- **Bloomberg Terminal:** added Polymarket 2024 US election odds in late August 2024 (https://thedefiant.io/news/defi/bloomberg-terminal-integrates-polymarket-election-data). It now carries Polymarket and Kalshi data under WSL PREDICT <GO> (https://x.com/TheTerminal/status/2011095102798635194, post date not shown).
- **Fox** integrates Kalshi data across its news platforms (April 2026), and Kalshi has CNN and CNBC deals (late 2025) (https://en.wikipedia.org/wiki/Kalshi).
- **Google Finance:** see 3.1.

#### 6.5.4 Business and "bespoke insurance" hedges

Fortune, 2026-10-19 (https://fortune.com/2026/10/19/prediction-markets-insurance-risk-management-kalshi-dodgers-world-series/):

- An LA bar group with 25 venues put $60,000 on "Dodgers do not reach the World Series" to replace lost playoff revenue. The position returned nearly 2×.
- The NYC bar The Jeffrey bet $5,000 to cover a Knicks tab promotion and received $13,500.
- An unnamed insurer placed five trades worth up to $3M if LSU wins the title, matching coach bonuses.
- An LA ice-cream shop hedged cold fronts for up to $1,500.
- The Blanket app (Aug 2026) suggests hedging markets to businesses.
- Caveats from Columbia's Joshua Mitts: hedges work best on clean yes/no outcomes, the market is "a bit of a free-for-all", and an information-disadvantaged hedger becomes a "systematic loser".

#### 6.5.5 Elections, tariffs, recession

**Elections (Nov 2024).** Volume spiked, from Pew (USD millions, notional taker volume; https://www.pewresearch.org/short-reads/2026/09/23/prediction-markets-trading-volume-doubled-between-may-and-july-largely-driven-by-sports/):

- Kalshi politics: $1,127.7M in Nov 2024, against $1.0M in Sept 2024.
- Polymarket politics: $2,960.3M in Oct 2024.

Kalshi had resumed election contracts after a court win on 2024-10-02 (https://en.wikipedia.org/wiki/Kalshi). The CFTC had earlier questioned whether election contracts were valid hedging tools (same page). I found no direct, sourced evidence of institutions using these contracts to hedge equity books (gap).

**Tariffs.** Polymarket, USD cumulative, gamma API 2026-10-20:

- "Will Trump lower tariffs on China in April [2025]": $11.0M.
- "Will the Supreme Court rule in favor of Trump's tariffs": $4.76M.
- "US–China trade deal before June [2025]": $3.45M.

These are tradable proxies for tariff risk, but I found no data on who used them as hedges.

**Recession.** Kalshi "Recession this year?" (2026): 3.69M contracts as of 2026-10-20 (API).

**Summary.** Evidence of retail and small-business hedging is anecdotal. The institutional plumbing (block trades, FCMs) is real but undisclosed in size. The academic and industry evidence (Fed paper, BMLL) treats prediction markets as a signal source first and a hedge second, because depth is two orders of magnitude below futures.

#### 6.5.6 Volume-measurement cautions

- Paradigm (Storm Slivkoff, 2025-12-08) showed that summing Polymarket `OrderFilled` events double-counts volume by about 2×. It recommends one-sided metrics, and reporting notional and cash-flow volume separately. Source: https://www.paradigm.xyz/writing/polymarket-volume-is-being-double-counted
- Kalshi's notional headline (about 70% combos) against dollars paid (28% combos) shows the same issue (section 6.1.3).

---

### 6.6 Competitive map, as of 2026-10-20

| Product | Event exposure | Stock/crypto exposure | Combined (conditional)? | Pays in |
|---|---|---|---|---|
| Kalshi / Polymarket / Rothera / ForecastEx event contracts | Yes | Via price-level and range binaries | No; combos are AND-parlays | Cash (USD/pUSD) |
| Cboe KPI binaries (via Robinhood, IBKR) | Company KPIs | Indirect | No | Cash, SEC-cleared |
| Kalshi US500 perp, Polymarket perps, HIP-3, Robinhood EU perps, Coinbase stock perps (upcoming) | No | Leveraged | No | Cash/stablecoin |
| Robinhood Stock Tokens, xStocks | No | 1:1 economic exposure | No | Token |
| Trade.xyz pre-IPO perps | IPO event drives the conversion | Yes | Partly (converts at IPO) | Stablecoin |
| MetaDAO / Seer / Futarchy.fi / Butter | Governance decision | DAO token | Yes (pass/fail branches, losing branch reverted) | Token |
| **Probabl** | Outside event (Fed, CPI, elections) | Real Robinhood stock token | **Yes** | **Stock token, or refund** |

---

### 6.7 Design lessons for Probabl's conditional stock markets

1. **Probabl's semantics already match the conditional-vault model; market them that way.**
   - Probabl redeems the winning branch into the stock token and refunds the losing branch. That is the MetaDAO and Seer conditional vault ("Finalised" against "Reverted"), Manifold's N/A-on-unmet-condition convention, and Paradigm's "quantum market" reversion.
   - Sources: https://devrels.xyz/articles/metadao-futarchy-technical-reference ; https://manifold.markets/Stralor/what-forms-of-conditional-markets-d ; https://www.paradigm.xyz/writing/quantum-markets
   - Users already familiar with futarchy will get it. Retail Robinhood users will not, so the UI should say "if NO happens, your USDG comes back".

2. **Cross-branch collateral is the biggest capital-efficiency lever.**
   - Only one branch settles, so the same USDG (or the same stock token) can back a buy in "NVDA if YES" and a buy in "NVDA if NO" at once.
   - This is the CTF split (1 USDG → 1 USDG-if-YES + 1 USDG-if-NO) and Paradigm's "credits on every branch from one deposit".
   - Requiring collateral for max(branch) instead of the sum of branches halves capital per two-sided trader, and lets market makers quote both branches from one inventory. This directly addresses the "liquidity bootstrapping per proposal is non-trivial" problem MetaDAO reports.

3. **Pick conditions where both branches will be traded.**
   - Conditional prices on a low-probability branch are thin and easy to push. MetaDAO decisions with one trader and $50 of volume, and the 28% Umbra attack margin, show this.
   - Manifold users say conditionals help mainly when P(condition) is above about 25%.
   - Prefer near-coin-flip macro events: FOMC meetings when priced at 30–70%, CPI above/below consensus, close elections.
   - Avoid 95/5 conditions, or subsidise the unlikely branch.

4. **Put demand where it already is: macro conditions and megacap or index underlyings.**
   - Macro conditions with proven demand:
     - Polymarket Fed decision markets: $144M–$659M per 2026 meeting.
     - Kalshi FOMC Sept 2026: 103M contracts.
     - Kalshi CPI: 0.5–1.6M contracts per monthly print.
   - Weak single-stock event demand:
     - Polymarket earnings-beat markets: about $22K over 500 markets.
     - Kalshi earnings mentions: 20K–44K contracts each.
     - Kalshi company KPI series: 31K–219K contracts.
   - Stock-specific events with no other hedge instrument do better (M&A $18.4M, largest company $8.6M, IPOs $7.5M).
   - Suggested first wave: "NVDA / SPY / TSLA / HOOD / AAPL token if the Fed cuts at the next meeting vs if not", and "… if CPI comes in above consensus vs not". Later: "SPY if Republicans hold the House (Nov 2026)".

5. **Don't compete on plain exposure; it is commoditised.**
   - US500 perps (Kalshi), HIP-3 equity perps (about 50% of Hyperliquid volume), Robinhood EU perps and Lighter-in-wallet, Coinbase stock perps, and Robinhood and xStocks tokens all give leverage or 24/7 exposure.
   - Probabl's unique output is the conditional price spread: "NVDA if cut − NVDA if no cut" is the market's estimate of the event's impact on that stock. No other venue publishes it.
   - Futarchy.fi uses the same framing ("price difference … shows the proposal's expected impact").

6. **The spread is a data product: syndicate it.**
   - Kalshi and Polymarket odds now sit in Bloomberg (WSL PREDICT), Google Finance, Dow Jones, Fox and CNBC. Yahoo dropped its Polymarket hub in 2026.
   - A "Fed-impact on NVDA" number is exactly the kind of figure a terminal or broker might want, and the data channel is a cheap distribution route.
   - Sources: section 6.5.3; https://www.bloomberg.com/news/articles/2026-09-18/yahoo-finance-and-polymarket-end-prediction-market-partnership

7. **Sit next to the stock page and the earnings calendar.**
   - Robinhood is putting the earnings-call player at the top of the stock detail page and launching a Predict tab with earnings contracts. Cboe KPI contracts debut there.
   - Probabl's UI should show each conditional market on the underlying's page, timed to the event (FOMC days, CPI days, earnings), not only in a separate "markets" list.
   - Source: https://ng.investing.com/news/stock-market-news/robinhood-at-hood-summit-26-pushes-trading-into-living-hours-93CH-2715061

8. **Use RFQ and market makers for the long tail.**
   - Kalshi's combos and Polymarket's Combos are RFQ-quoted by market makers, and combos became about 70% of Kalshi's notional volume.
   - Probabl already has RFQ for market orders. Conditional pairs (two branches × N stocks × M events) are a natural RFQ product, because order books will be thin across the grid.
   - Cautions: the parlay economics show that retail losses can be large (more than $100M Jan–Apr 2026 [unverified]) and that notional volume flatters.

9. **Resolution must be unambiguous and match the event, not a proxy.**
   - Polymarket's SPX daily market lists two different sources (Binance SPX/USDT candles against WSJ).
   - Kalshi's CPI settles on the first non-preliminary BLS print (https://cryptobriefing.com/kalshi-traders-september-cpi-odds/).
   - For Fed conditions, use the FOMC statement target range. For CPI, use the BLS release. Publish the exact rule and the fallback (e.g. meeting postponed → refund both branches).

10. **Avoid TWAP-decided outcomes.** Futarchy's manipulation surface is the TWAP that decides the outcome. Probabl's outcome comes from an external oracle (the Fed), so the market cannot decide it. That is a real safety advantage over MetaDAO and Butter, and worth stating in docs and audits. Optimism's play-money run showed forecasts about $200M too optimistic, but in Probabl that error costs traders, not a treasury.

11. **Fee design with precedent.**
    - Robinhood's p × (1 − p) commission (k = 10% or 5% with Gold, capped at $0.01 per contract) and Kalshi's "quadratic" fee type (API `fee_type: quadratic`) charge most near 50/50 and little near certainty.
    - For conditional stock markets, the analogous risk is the branch probability. A fee scaled by the condition's uncertainty, or a flat bps on notional with a p(1 − p) component on the event leg, would be easy to explain.
    - Sources: https://robinhood.com/us/en/support/articles/event-contracts-overview/ ; Kalshi series API.

12. **Report volume honestly.** Use one-sided cash volume and show notional separately, as Paradigm and Kalshi's dollars-paid data argue (section 6.5.6). It costs little and avoids the credibility problems Polymarket and Kalshi now have.

13. **Size expectations for "hedging".**
    - Even Kalshi's Fed markets show about $17.5K of depth per bp, against $2.5M per bp in futures.
    - Hedge demand will come from retail stock-token holders protecting a position through one event: "keep my NVDA exposure only if the Fed cuts; otherwise get USDG back". It will not come from institutions.
    - Frame the product as event-scoped protection for a holding, sized for retail, and keep the institutional pitch for the data (lesson 6).

14. **Respect the stock token's own distribution limits.** Robinhood Stock Tokens are tokenized debt securities that give no shareholder rights, and they are not available to US persons. They are also restricted in Canada, the UK, Switzerland and the UAE. Any branch that redeems into the token inherits those limits; geofencing and terms must match.

15. **Regulatory signal.**
    - The SEC approved Cboe's single-company KPI binaries as securities, with standard securities rules applying.
    - Kalshi, Polymarket US and Rothera run CFTC event contracts and perps.
    - A stock-linked conditional sits on that SEC/CFTC boundary. Treat it as a security-linked product outside the US, as Robinhood does with its tokens.
    - Sources: https://www.yogonet.com/international/news/2026/10/15/126852-sec-approves-cboe-event-contracts-tied-to-corporate-kpis-ahead-of-robinhood-debut ; https://robinhood.com/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/

---

### 6.8 Gaps and unverified items

- The search budget ran out mid-research. Not covered:
  - a16z writing on conditional markets.
  - Deribit and OKX event options.
  - Opinion Labs (BNB).
  - Webull 2026 volumes.
  - Tesla-deliveries market volumes for 2026 quarters (settled events return zero in Kalshi's API).
  - Polymarket–Kalshi linked structured products.
  - Startups building event-linked stock exposure other than those named here.
- Pages that returned 403, 429 or a paywall, so figures from them are marked [unverified]:
  - Robinhood August and September 2026 operating data.
  - CNBC hedge-fund pieces.
  - The Cantor/Kalshi story.
  - Sportico parlay-loss analysis.
  - FinanceFeeds US500 perp spec.
  - The Kalshi learn page.
  - MetaDAO's Umbra page.
  - SolanaCompass's Backable stats.
- Robinhood's Q3 2026 event-contract totals arrive 2026-10-27. Check them then, along with whether the Predict tab and earnings and KPI contracts actually launched in October.
- Polymarket gamma `volume` is Polymarket's own number, and its counting method was not checked against Paradigm's one-sided definition.

---

## 7. What this means for Probabl (consolidated)

These are my readings of the evidence above, not findings from any source. Each points back to the section with the data.

1. **Give people a reason to open the app today.** Retention follows how often new outcomes arrive (5.7, 4.10). Sports, short-dated crypto and daily weather retain; slow politics markets do not. Probabl's long-dated markets need short-dated companions on the same underlyings: FOMC (every 6–7 weeks), CPI and jobs (monthly), earnings dates, and weekly or daily rolling series.
2. **Use the macro calendar people already argue about.** Fed decision markets did $144M–$659M per 2026 meeting on Polymarket, and Kalshi's September FOMC market traded 103M contracts (6.3). Single-stock event binaries are tiny: about $22K across 500 Polymarket earnings markets, NVDA daily up/down down to about $2.3K per market in October 2026, $1,428 for a Limitless NVDA hourly (6.3, 3.A2, 4.1). The strongest first wave is "megacap or index token if <macro event> vs if not".
3. **Short-term crypto is where daily habit already lives, and it consolidates to one winner.** Kalshi's BTC 15-minute market turns over about $130M a day at a 0.53¢ spread and $76K top-of-book depth, about 83% of all BTC up/down turnover across venues; Polymarket's 5-minute and 15-minute markets together are under $10M a day and bot-dominated (3.B1, 3.A1). The winning recipe is a continuous near-50/50 binary on a liquid 24/7 underlying, settled on a manipulation-resistant average, and distributed through brokers (3.C). Short-dated stock and index binaries failed to scale on every venue (3.A2, 3.B4, 4.1).
4. **The branch spread is the product and the content.** "NVDA if hike vs NVDA if hold" is a number nobody else publishes (6.7). Post it on a schedule, accurately, and offer it as an embed or data feed. Polymarket's "JUST IN" posting gets reach (19.6M views for one false post) but costs credibility and draws regulators (1.5, 5.8).
5. **Alerts are the one mechanic with causal evidence.** Push alerts raised trades 11% in the FCA experiment, and Robinhood ±5% move alerts raised trading 25% right after receipt (5.2). Neither Kalshi nor Polymarket has native odds-move alerts. Alerts on branch prices and on the spread fit Probabl directly. Keep them informative, not celebratory (Massachusetts v. Robinhood).
6. **Distribution beats in-app tricks.** Robinhood put event contracts in front of 28.4M funded accounts and grew event revenue from about $10M to $156M a quarter (4.7). DraftKings cut acquisition cost over 80% by moving Predictions into its main app, and Coinbase's crypto binaries tripled its daily prediction traders (4.8). On Robinhood Chain, terminals (Axiom, GMGN, pump.fun, Fomo, BasedBot) routed about 16% of August 2026 DEX volume (5.4). Builder-fee or referral deals with them are a ready channel.
7. **Expect incentive cliffs.** Probable went from about $1.3–1.5B a month to almost nothing within four days. Limitless fell 96% from May to September 2026 and Myriad 95% after March. Kalshi is ending volume rewards under CFTC pressure (2.5, 4.10). If Probabl pays points, tie them to fee-paying trades and to holding through resolution, exclude self-trades, and measure unique funded traders, not volume (5.3).
8. **Settlement design decides who wins short markets.** Polymarket's single-snapshot settlement let 821 accounts take $8.2M from likely manipulated 5-minute windows, with 93% of losses on retail, until it switched to a Chainlink TWAP on Aug 7, 2026; it has retuned its taker delay four times (3.A1). Kalshi averages 60 seconds of a multi-exchange index (3.B1). Any short-dated Probabl product needs an averaged, multi-source settlement price and a cutoff before lock.
9. **A pooled round is the low-liquidity way to offer something every few minutes.** PancakeSwap's 5-minute pari-mutuel rounds have run for 5+ years at about $150M a year with no market maker (4.6). Bots exploit the gap between the oracle and faster exchange prices, so the same cutoff and averaging rules apply.
10. **Pick a few underlyings and make them deep.** Liquidity concentrates in one venue per underlying (HIP-3: one deployer took about 97%), and thin books push traders away (HIP-4: a $10k buy slips 2–3%) (4.5). Conditional markets need both branches traded, so prefer conditions priced 30–70% or subsidise the thin branch (6.7).
11. **Report honest volume.** Kalshi buyers pay 23–29 cents per $1 of notional, and combos are about 60–70% of Kalshi notional but under 13% of trades (2.2, 3.B7). Polymarket's gamma volume runs about 2x one-sided turnover (3.A1, 6.5.6). Publish one-sided cash volume and unique traders.
12. **Yield on locked collateral answers the "dead money" objection.** Kalshi pays about 3.5% APY and Polymarket 3.25% on 18 long-dated events; Robinhood Earn pays a subsidised 7% on Robinhood Chain (2.5.1, 5.9). No venue has published an impact figure.
13. **Copy market wording carefully.** UMA disputes (Ronaldo's tears, ceasefire definitions, Strategy's bitcoin sale), insider-trading cases (Maduro, Google search, Kalshi's candidate bans), and markets that list two conflicting resolution sources (Polymarket SPX and TSLA daily) all show that wording and data sources decide outcomes (2.6, 3.A2, 6.7). Products built on a person's words, like mention markets, are now regulatory-fragile (3.B6). Stock-closing-price and FOMC-statement oracles avoid most of this.
14. **Combos are where volume is going, and where retail losses concentrate.** Kalshi yes-side combo takers have lost more than $870M since September 2025, while Kalshi earned $336M in parlay fees (3.B7). A "branch combo" (for example NVDA-if-cut AND AAPL-if-cut) fits Probabl's RFQ but brings the same longshot dynamics.

---

## Appendix A. Data pulled directly for this report (2026-10-20)

- **Polymarket Gamma API** (Polymarket International only): `https://gamma-api.polymarket.com/events?active=true&closed=false&order=<volume24hr|volume1wk|volume1mo|commentCount>&ascending=false&limit=50`, and `...&closed=true&order=volume&end_date_min=2026-07-01T00:00:00Z`. The short-term and stocks research also pulled series and events by slug and tag. Raw JSON for the attention section is in `/Volumes/T9/tmp-probabl/market-research/attention/data/`. The rolling 1-week and 1-month fields are stale on events whose sub-markets have closed, and gamma volume runs about 2x one-sided cash turnover (3.A1).
- **Wikimedia pageviews API** for English Wikipedia "Polymarket", "Kalshi" and "Prediction_market", monthly and daily, Jan 2025 to Oct 19, 2026 (`wiki_*.json`, `wikid_*.json` in the same folder).
- **Kalshi public trade API** (`https://api.elections.kalshi.com/trade-api/v2/`): series metadata (settlement sources, fee types) and market volumes, used in sections 3.B and 6.3. Settled events older than a few weeks return zero volume.
- **DefiLlama API** daily series: Limitless, Myriad, Trueo, PancakeSwap Prediction, Probable, Opinion, Predict.fun, Thales/Overtime, SX Bet, Azuro, Axiom, Photon, GMGN, pump.fun, Hyperliquid. URLs are inline in sections 4 and 5.
- **Primary filings and releases:** Federal Reserve FOMC statement (Sept 16, 2026); Robinhood, Coinbase and DraftKings 8-Ks; CFTC rule filings for Kalshi's incentive programs; Polymarket and Kalshi docs and changelogs.
- The intermediate notes for each section are in `/Volumes/T9/tmp-probabl/market-research/attention/`: `sec1_attention.md`, `platform_numbers.md`, `short_term_poly_kalshi.md`, `short_term_other_venues.md`, `retention_virality.md`, `stocks_and_prediction.md`.

## Appendix B. Limits of this research

- Six research threads shared one 200-call web-search budget, and it ran out partway through. After that, research relied on direct fetches of known URLs, public APIs, SEC and CFTC filings and official docs. Each section ends with its own gaps list.
- X/Twitter post-level engagement (the most-engaged posts of @Polymarket and @Kalshi) could not be retrieved: X requires login, Social Blade returned 403, and Reddit blocks automated fetches. Engagement figures come from press reports (CJR, Popular Information, AP via CoinDesk, Aftermath, Awful Announcing). Subreddit sizes come from a third-party tracker [unverified]: r/Kalshi had about 36,000 members in June 2026, up about 30,000 in a year ([GummySearch](https://gummysearch.com/r/Kalshi/)).
- Many 2026 volume figures come from trackers (DeFi Rate, The Block, ticker-tracker, CryptoStruct, Dune, Artemis, CryptoRank) rather than the venues. Where two trackers agree within a few percent the tag is dropped; otherwise figures are marked [unverified]. Face (notional), dollars-paid and gamma volumes are different measures and should not be added together.
- Several key articles were paywalled or blocked: the Bloomberg longshot and Iran insider-trading pieces, the WSJ UMA and paid-influencer investigations, Rolling Stone's viral-moments feature, and CNBC's combos analysis. Their figures come from syndicated copies or search summaries and are marked accordingly.
- Two figures conflict and are left unresolved:
  - **Kalshi mentions volume:** ticker-tracker shows $124–162M a month through July 2026, while a CNBC summary cites Dune at about $3.3M for one month (1.3).
  - **Kalshi combos launch date:** September 2025 per InGame and The Event Horizon, December 2025 per Sporting Crypto (2.2, 5.6).
