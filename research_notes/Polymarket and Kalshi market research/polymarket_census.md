# Polymarket census, 20 October 2026

Snapshot of every active, open Polymarket event, taken from the public Gamma API between **2026-10-20T06:34:14Z and 2026-10-20T07:00:37Z (UTC)**, plus every event that resolved in the 30 days before the snapshot (2026-09-20T06:34Z to 2026-10-20T06:34Z). Written for Probabl (conditional stock markets on Robinhood Chain) as the factual base for later analysis of which prediction markets move tradable assets and which short-term markets keep traders coming back.

Scripts and raw data: `/Volumes/T9/tmp-probabl/market-research/polymarket/` (`scripts/`, `raw/`, `out/`). CSV tables sit next to this file (`polymarket_*.csv`, listed at the end).

## Key numbers

- **Size of the open book.** 22,324 active open events holding 396,246 markets, 258,140 of them still open. Reported volume on these open events: $35.36M in the last 24 hours, $183.51M in the last 7 days, $6.06B lifetime. Liquidity $805.27M; open interest $331.23M.
- **The open snapshot misses most short-term trading.** Short-lived markets close within hours, so their volume is gone from the open set by the time we look. Adding back recently closed instances gives about **$116.42M traded in the last 24 hours** and about **$1.06B in the last 7 days** (upper bound $1.11B). That is 3.3x the open-event 24h figure and 5.8x the open-event 7-day figure. A further ~$3.35M a day of 5-minute crypto trading is not recorded in Gamma's volume fields at all (sampled from fills; see Caveats).
- **Where the money trades (all trading, last 7 days, approx.):** sports 52.4%, esports 17.1%, crypto 13.5%, politics/elections 4.8%, geopolitics 2.9%, culture 2.1%, economy/Fed 1.9%, weather 1.9%, finance/stocks 0.8%.
- **Where the money sits (open events only, lifetime volume):** politics/elections 56.3%, geopolitics 19.0%, sports 10.9%, crypto 4.7%. Long-dated political markets hold the stock of volume and liquidity; short-dated sports, esports and crypto produce the flow.
- **Short-term families, daily volume (7-day average of resolved instances):** sports games $75.83M/day, esports $25.62M/day, crypto up/down $15.72M/day recorded (about $19.22M/day with the unrecorded 5-minute fills), daily highest temperature $1.98M/day, crypto above-strike ladders $1.60M/day, Elon/Trump post counts $1.55M/day. All recurring stock, index, commodity and FX price markets (daily and weekly) together: about $356.3k/day.
- **Stocks are thin on Polymarket.** 62 of the 195 Robinhood Stock Tokens are named by at least one open market; the daily stock up/down family (16 stocks) trades $16.2k/day in total, and SPX daily up/down alone ($49.7k/day) is the largest equity product. Crypto is the opposite: BTC 5-minute up/down alone trades about $12.42M/day.
- **Volume is counted in shares.** Gamma's `volume` equals the sum of filled shares (each pays $1 if it wins), counted once per fill. USDC actually paid is lower: 51-98% of `volume` in the markets we checked. All '$' volume figures below are this share count.

## Method

1. **Open events.** `GET /events/keyset?closed=false&limit=100` paged with `after_cursor` until the cursor ran out (the plain `/events` endpoint caps `limit` at 100 and rejects offsets past ~2,000, so keyset paging was required). Every event comes with its nested markets. Result: 22,324 events, 396,246 markets, 1.76 GB raw JSON.
2. **Series, tags, fees.** `/series/keyset` (2,504 open series, with a platform-computed `volume24hr` that includes closed instances), `/tags` (7,441 tags), `/fee-types` (13 fee schedules), `/crypto-market-configs` (63 crypto variants).
3. **Resolved events.** `GET /events/keyset?closed=true&market_projection=status&limit=500` in 6-hour `end_date` windows from 2026-09-20 to the snapshot, plus one window for closed events whose end date is still in the future (sports games often carry a placeholder end date a week after kick-off, and some markets resolve early). 160,508 closed events fetched; 154,990 have a `closedTime` inside the 30-day window and form the throughput set. Per-instance volume is the event's lifetime `volume`.
4. **Categories.** Each event gets exactly one category from its Polymarket tags, checked in this order: esports, sports, mentions/tweets, crypto, finance/stocks (strong tags such as `stocks`, `earnings`, `ipos`, `commodities`, `finance-updown`, or titles about market cap/IPO/stock), AI, weather/climate/science, geopolitics (strong war/ceasefire tags, unless the event is an election), economy/Fed/macro, tech, elections, weak finance tags (`oil`, `gold`, `business`), other geopolitics tags, politics, culture. Only 12 open events fall through to 'other'. Sports are split by league tag, esports by game title. Polymarket's own fee type per market is shown as a cross-check.
5. **Short-term families.** Recurring products are identified by series slug (for example `btc-up-or-down-5m`, `btc-multi-strikes-weekly`, `seoul-daily-weather`, `spx-daily-up-or-down`, `elon-tweets-48h`) and, for sports, esports, mentions, earnings and economic data, by category, tags and title. Cadence is measured, not taken from the series label: it is the median gap between consecutive end times of resolved instances (the 'weekly' BTC strike series actually resolves one event per day). Sports sub-events of one game (main line, 'More Markets', 'Exact Score', 'Player Props', halves) are merged by `gameId` so an instance is one game.
6. **Liquidity and spread.** Taken from the open snapshot. For each recurring series we use the next three upcoming instances (for sports and esports, every upcoming game). Liquidity is the event's Gamma `liquidity` field. Spread is Gamma's `spread` (best ask minus best bid, in probability points) on the event's main market, meaning the open market with the most liquidity.
7. **Asset-linked markets.** Every open market outside sports, esports and weather is scanned with regexes for 195 Robinhood Stock Tokens (company names, safe tickers, `$TICKER` and `(TICKER)` forms, a few products such as GTA VI for TTWO, Waymo for GOOGL, Starship/Starlink for SPCX), other companies, indices, commodities, FX pairs and 28 crypto assets. Index and commodity markets are also mapped to the Robinhood ETF that tracks them (S&P 500 to SPY, Nasdaq to QQQ, gold to GLD, silver to SLV, crude to USO, KOSPI to EWY). Each match is tagged price/valuation, earnings/KPI, corporate event, or mention/ranking (incidental).
8. **Volume checks against fills.** Fills from `data-api.polymarket.com/trades` were summed for sample markets and compared with Gamma `volume` (definition check), and for 15 random zero-volume events per 5-minute and 15-minute crypto series and per sports group (missing-volume check).

Requests were paced at no more than about 4 per second, with retries and backoff on connection errors. No request failed permanently.

## How to read the volume numbers

- **Unit.** Gamma `volume` = sum of filled shares, one side per fill (taker side). We confirmed this to the cent on four markets: an ETH hourly up/down market (3,278.82 shares; USDC notional $1,707), a BTC 5-minute market (17,448.91 shares; notional $11,685), an NPB baseball moneyline (16,264.90 shares; notional $8,355) and a London temperature bucket (1,224.93 shares; notional $1,199). Maker and taker are not double-counted, but USDC spent is only 51-98% of 'volume'. The ratio depends on the prices paid.
- **Windows.** `volume24hr`, `volume1wk` and `volume1mo` on open events cover trading in those windows on events that are still open. Volume on events that closed inside the window is not in them. For category shares we therefore give two views: the open snapshot as requested, and an all-trading estimate that adds recently closed volume back.
- **Neg-risk and multi-market events.** Event volume is the sum of its markets' volumes. In multi-outcome (neg-risk) events, one economic trade can produce fills in several markets (for example a NO conversion), so event volume can count a position more than once. Ladders and buckets (temperatures, 'Bitcoin above ___') are affected the most.
- **Unrecorded 5-minute crypto volume.** Many closed 5-minute crypto events report `volume = 0` even though they traded. In all 15 sampled zero-volume instances of each of BTC, ETH, SOL, XRP, DOGE, BNB and HYPE 5-minute markets, fills existed. Extrapolated, Gamma misses about $23.47M over 7 days ($3.35M/day): about +23% for BTC 5m, +120% for ETH 5m, and +170-250% for SOL, XRP, DOGE and BNB 5m. 15-minute and longer crypto series and sports zero-volume events are fine: the sampled sports zero-volume events had no fills at all. Platform series `volume24hr` has the same gap. Corrected numbers are in `polymarket_zero_volume_check.csv`.

## 1. Category breakdown

### 1a. Open events (snapshot fields)

| Category | Events | Markets | Open mkts | 24h vol | 24h % | 7d vol | 7d % | Lifetime vol | Lifetime % | Liquidity | Open interest |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| politics/elections | 2,066 | 27,336 | 11,167 | $8.77M | 24.8% | $49.36M | 26.9% | $3.41B | 56.3% | $376.45M | $139.25M |
| geopolitics/war | 458 | 2,270 | 1,230 | $5.42M | 15.3% | $30.23M | 16.5% | $1.15B | 19.0% | $28.18M | $71.57M |
| economy/Fed/macro | 179 | 966 | 906 | $3.28M | 9.3% | $19.76M | 10.8% | $139.26M | 2.3% | $12.40M | $13.37M |
| finance/stocks/earnings | 465 | 3,366 | 2,627 | $838.8k | 2.4% | $5.27M | 2.9% | $63.07M | 1.0% | $10.13M | $8.79M |
| crypto | 3,998 | 6,715 | 6,025 | $2.37M | 6.7% | $13.91M | 7.6% | $284.13M | 4.7% | $35.28M | $44.66M |
| tech | 100 | 1,141 | 671 | $86.1k | 0.2% | $593.9k | 0.3% | $13.74M | 0.2% | $6.47M | $1.45M |
| AI | 281 | 3,297 | 2,112 | $746.5k | 2.1% | $5.95M | 3.2% | $61.18M | 1.0% | $8.32M | $6.98M |
| sports | 13,486 | 336,277 | 224,123 | $8.88M | 25.1% | $26.95M | 14.7% | $662.74M | 10.9% | $304.90M | $25.83M |
| esports | 563 | 6,014 | 2,924 | $935.0k | 2.6% | $2.27M | 1.2% | $11.46M | 0.2% | $7.49M | $1.37M |
| weather/climate/science | 430 | 3,939 | 3,836 | $2.48M | 7.0% | $5.14M | 2.8% | $124.20M | 2.0% | $7.03M | $13.12M |
| culture/entertainment/awards | 233 | 4,058 | 1,862 | $521.1k | 1.5% | $21.56M | 11.8% | $135.45M | 2.2% | $7.26M | $4.12M |
| mentions/tweets | 53 | 765 | 618 | $1.03M | 2.9% | $2.50M | 1.4% | $3.77M | 0.1% | $1.17M | $622.4k |
| other | 12 | 102 | 39 | $2.9k | 0.0% | $17.3k | 0.0% | $1.19M | 0.0% | $203.9k | $98.4k |
| TOTAL | 22,324 | 396,246 | 258,140 | $35.36M | 100.0% | $183.51M | 100.0% | $6.06B | 100.0% | $805.27M | $331.23M |

Source: `polymarket_categories.csv` (also has 1-month volume). Volumes are shares (≈ USDC face value). Open interest is Gamma's event `openInterest` field.

### 1b. All trading, including events that closed inside the window (estimate)

24h: Gamma series `volume24hr` (platform-computed, includes closed instances) + 24h volume of open events outside any series + lifetime volume of non-series events that closed in the last 24h after being listed ≤48h. 7d: open-event `volume1wk` + lifetime volume of events that closed in the last 7 days and were either listed ≤7 days or belong to a short-term family. The 'upper' column also adds the lifetime volume of long-lived events that resolved this week, which overstates the week.

| Category | 24h vol (est.) | 24h % | 7d vol (est.) | 7d % | 7d upper | 7d upper % |
|---|---:|---:|---:|---:|---:|---:|
| politics/elections | $9.39M | 8.1% | $50.92M | 4.8% | $53.14M | 4.8% |
| geopolitics/war | $5.42M | 4.7% | $30.42M | 2.9% | $30.98M | 2.8% |
| economy/Fed/macro | $3.37M | 2.9% | $20.50M | 1.9% | $20.54M | 1.9% |
| finance/stocks/earnings | $1.23M | 1.1% | $7.94M | 0.8% | $7.94M | 0.7% |
| crypto | $20.99M | 18.0% | $143.63M | 13.5% | $143.64M | 13.0% |
| tech | $6.93M | 6.0% | $8.31M | 0.8% | $8.31M | 0.8% |
| AI | $752.7k | 0.7% | $6.18M | 0.6% | $8.42M | 0.8% |
| sports | $56.27M | 48.3% | $557.85M | 52.4% | $594.20M | 53.7% |
| esports | $7.10M | 6.1% | $181.61M | 17.1% | $181.61M | 16.4% |
| weather/climate/science | $2.82M | 2.4% | $19.89M | 1.9% | $20.03M | 1.8% |
| culture/entertainment/awards | $561.3k | 0.5% | $22.11M | 2.1% | $22.74M | 2.1% |
| mentions/tweets | $1.30M | 1.1% | $14.54M | 1.4% | $14.54M | 1.3% |
| other | $280.6k | 0.2% | $17.3k | 0.0% | $17.3k | 0.0% |
| TOTAL | $116.42M | 100% | $1.06B | 100% | $1.11B | 100% |

Not included: about $3.35M/day of 5-minute crypto fills that Gamma does not record (would lift crypto's 7-day share by about 2 points). The tech line includes one large short-lived event that resolved in the last 24h ('Will the Tesla Roadster fly for 1s+?', $7.70M lifetime). Files: `polymarket_all_trading_24h_estimate.csv`, `polymarket_all_trading_window_estimates.csv`.

### 1c. Sports by league and esports by title

Open events (snapshot) and resolved games (30 days). Open-event volume undercounts leagues whose games already finished; the resolved columns show the real flow. 'Daily vol' is the 30-day total divided by 30.

| League / title | Type | Open games | Open mkts | Games resolved 30d | Vol 30d | Daily vol | Median/game | p90/game | Median liq (upcoming) | Median main spread |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Soccer | Sports | 3,547 | 156,190 | 4,008 | $811.56M | $27.05M | $19.3k | $422.6k | $881 | 0.485 |
| NFL | Sports | 92 | 8,383 | 152 | $453.67M | $15.12M | $202.7k | $8.16M | $378 | 0.331 |
| Tennis | Sports | 497 | 3,649 | 9,928 | $448.67M | $14.96M | $1.7k | $121.8k | $2.8k | 0.03 |
| Counter-Strike | Esports | 411 | 1,350 | 1,457 | $270.45M | $9.01M | $26.5k | $301.2k | $2.3k | 0.06 |
| League of Legends | Esports | 59 | 751 | 302 | $228.10M | $7.60M | $202.6k | $2.09M | $4.7k | 0.02 |
| Dota 2 | Esports | 28 | 349 | 306 | $209.57M | $6.99M | $177.8k | $2.38M | $19.2k | 0.03 |
| College football | Sports | 278 | 25,087 | 466 | $143.10M | $4.77M | $41.6k | $957.0k | $635 | 0.22 |
| MLB | Sports | 1 | 1 | 321 | $139.97M | $4.67M | $15.7k | $1.15M | $90.8k | 0.001 |
| Valorant | Esports | 32 | 175 | 88 | $48.91M | $1.63M | $36.3k | $1.59M | $821 | 0.125 |
| NHL | Sports | 191 | 968 | 195 | $38.29M | $1.28M | $159.9k | $457.4k | $184 | 0.16 |
| NBA | Sports | 52 | 703 | 66 | $27.39M | $913.0k | $362.4k | $674.3k | $32.5k | 0.045 |
| WNBA | Sports | 6 | 74 | 43 | $20.79M | $692.9k | $403.1k | $967.5k | $5.2k | 0.115 |
| UFC/MMA/boxing | Sports | 43 | 578 | 113 | $19.68M | $656.1k | $73.7k | $497.2k | $982 | 0.33 |
| Cricket | Sports | 235 | 639 | 781 | $12.79M | $426.4k | $0 | $33.4k | $0 | 0.99 |
| Basketball (other) | Sports | 169 | 275 | 666 | $10.79M | $359.7k | $4.9k | $42.6k | $926 | 0.645 |
| F1/motorsport | Sports | 17 | 660 | 28 | $3.95M | $131.7k | $419 | $775.3k | $153 | 0.79 |
| Baseball (other) | Sports | 10 | 10 | 170 | $2.25M | $74.9k | $6.7k | $22.0k | $84 | 0.94 |
| Esports (other) | Esports | 33 | 299 | 596 | $1.38M | $45.9k | $527 | $4.7k | $2.6k | 0.29 |
| Hockey (other) | Sports | 132 | 132 | 565 | $1.18M | $39.4k | $931 | $5.4k | $40 | 0.94 |
| Rugby | Sports | 42 | 122 | 89 | $218.3k | $7.3k | $171 | $6.1k | $281 | 0.6 |
| Golf | Sports | 37 | 2,185 | 109 | $182.1k | $6.1k | $0 | $1.2k | $5 | 0.99 |
| Sports (other) | Sports | 33 | 47 | 347 | $128.7k | $4.3k | $0 | $137 | $194 | 0.11 |

Source: `polymarket_short_term_sports_leagues.csv` (resolved) and `polymarket_sports_leagues.csv` (open snapshot by league). Soccer covers more than 100 competitions; the largest by 24h series volume are the Premier League ($4.63M), Serie A ($3.45M), Saudi Pro League ($2.26M), La Liga ($2.03M) and the Champions League ($1.66M). Esports volume is concentrated in tournament matches. In the last 7 days, League of Legends Worlds and Demacia Cup best-of-5s traded a median of $5.0M per match, each spread over 56-77 prop markets.

### 1d. Polymarket fee type by our category (open markets)

| Category | Fee types on open markets (count) |
|---|---|
| politics/elections | politics_fees (26,783), (none) (91), culture_fees (60), general_fees (7) |
| geopolitics/war | (none) (1,113), politics_fees (295), culture_fees (18), general_fees (8) |
| economy/Fed/macro | economics_fees (699), general_fees (71), politics_fees (59), finance_prices_fees (39) |
| finance/stocks/earnings | finance_prices_fees (2,490), economics_fees (300), tech_fees (40), culture_fees (19) |
| crypto | crypto_fees_v2 (6,031), finance_prices_fees (39), politics_fees (32), mentions_fees (21) |
| tech | culture_fees (901), finance_prices_fees (127), tech_fees (60), politics_fees (9) |
| AI | tech_fees (2,748), finance_prices_fees (262), politics_fees (46), (none) (16) |
| sports | sports_fees_v3 (198,334), sports_fees_nfl_cfb_oct26 (33,145), sports_fees_v2 (2,681), culture_fees (100) |
| esports | sports_fees_v3 (2,327), sports_fees_v2 (735), culture_fees (14) |
| weather/climate/science | weather_fees (3,724), tech_fees (44), (none) (30), general_fees (19) |
| culture/entertainment/awards | culture_fees (3,958), zero_fees (16), general_fees (3), tech_fees (3) |
| mentions/tweets | culture_fees (384), mentions_fees (231), crypto_fees_v2 (3) |
| other | politics_fees (58), sports_fees_v2 (14), sports_fees_v3 (14), culture_fees (4) |

Fee schedules from `/fee-types` (taker only, makers pay 0 and get a rebate share): crypto 7%, sports v3 5% (15% rebate), sports v2 3%, NFL and college football 3% for October 2026, economics, culture, weather and general 5%, politics, finance prices, tech and mentions 4%, zero_fees 0%. Geopolitics markets are fee-free, which is why 1,113 of them show no fee type. Per Polymarket's docs (fetched 2026-10-20) the taker fee is `shares × rate × p × (1 − p)`: at p = 0.50 it is 1.75¢ per share on crypto (3.5% of notional) and 1.25¢ on sports (2.5%). In USDC per share the fee peaks at p = 0.5; as a percentage of notional it is `rate × (1 − p)`, so it rises toward the full rate on cheap shares.

## 2. Top lists (open events)

Full top-50 lists are in `polymarket_top_lists.csv`, and the top 15 per category in `polymarket_top15_per_category.csv`.

### By 24h volume (top 15 of 50)

| # | Event | Category | 24h vol | 7d vol | Lifetime vol | Liquidity | Ends |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | Fed Decision in October? | economy/Fed/macro | $2.73M | $16.21M | $49.93M | $4.78M | 2026-10-29 |
| 2 | US-Iran ceasefire continues through...? | geopolitics/war | $1.79M | $4.42M | $18.85M | $779.8k | 2026-10-31 |
| 3 | Ballon d'Or Winner 2026 | sports | $1.41M | $5.84M | $54.67M | $11.33M | 2027-01-01 |
| 4 | Brazil Presidential Election | politics/elections | $956.7k | $8.31M | $188.76M | $1.05M | 2026-10-26 |
| 5 | UEFA Champions League: 2027 Champion | sports | $948.3k | $4.98M | $55.88M | $10.93M | 2027-06-20 |
| 6 | Next French Presidential Election | politics/elections | $716.4k | $3.68M | $154.07M | $19.14M | 2027-04-19 |
| 7 | Democratic Presidential Nominee 2028 | politics/elections | $595.7k | $2.08M | $1.30B | $74.11M | 2028-11-08 |
| 8 | Elon Musk # tweets October 13 - October 20, 2026? | mentions/tweets | $544.3k | $1.34M | $2.03M | $165.6k | 2026-10-20 |
| 9 | Prime Minister of Israel after the next election? | politics/elections | $525.4k | $3.18M | $49.12M | $3.09M | 2026-10-28 |
| 10 | Balance of Power: 2026 Midterms | politics/elections | $493.6k | $2.94M | $25.50M | $11.69M | 2026-11-04 |
| 11 | Who wins the Senate pending Hormuz Agreement by Oct 23? | politics/elections | $431.3k | $1.23M | $2.28M | $120.0k | 2026-11-04 |
| 12 | Bitcoin above ___ on October 20? | crypto | $376.2k | $538.9k | $544.5k | $672.9k | 2026-10-20 |
| 13 | Brazil Presidential Election Second Round: Margin of Victory | politics/elections | $362.3k | $2.30M | $3.06M | $426.9k | 2026-10-26 |
| 14 | Which party will win the House in 2026? | politics/elections | $335.5k | $2.17M | $18.75M | $6.75M | 2026-11-04 |
| 15 | US announces end of Iranian blockade by...? | geopolitics/war | $325.6k | $1.58M | $41.57M | $352.5k | 2027-01-01 |

Individually short-lived instances rarely reach this list. A BTC 5-minute market trades $36k at the median and $59k at the 90th percentile (30-day maximum $481k). The series view below shows them in aggregate.

### By 7-day volume (top 15 of 50)

| # | Event | Category | 24h vol | 7d vol | Lifetime vol | Liquidity | Ends |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | New "Stranger Things" episode released by...? | culture/entertainment/awards | $0 | $19.31M | $30.91M | $107.3k | 2027-04-01 |
| 2 | Fed Decision in October? | economy/Fed/macro | $2.73M | $16.21M | $49.93M | $4.78M | 2026-10-29 |
| 3 | Brazil Presidential Election | politics/elections | $956.7k | $8.31M | $188.76M | $1.05M | 2026-10-26 |
| 4 | Ballon d'Or Winner 2026 | sports | $1.41M | $5.84M | $54.67M | $11.33M | 2027-01-01 |
| 5 | UEFA Champions League: 2027 Champion | sports | $948.3k | $4.98M | $55.88M | $10.93M | 2027-06-20 |
| 6 | US-Iran ceasefire continues through...? | geopolitics/war | $1.79M | $4.42M | $18.85M | $779.8k | 2026-10-31 |
| 7 | Next French Presidential Election | politics/elections | $716.4k | $3.68M | $154.07M | $19.14M | 2027-04-19 |
| 8 | Prime Minister of Israel after the next election? | politics/elections | $525.4k | $3.18M | $49.12M | $3.09M | 2026-10-28 |
| 9 | Pro Football: 2027 Champion | sports | $181.1k | $3.04M | $68.55M | $6.71M | 2027-04-01 |
| 10 | Balance of Power: 2026 Midterms | politics/elections | $493.6k | $2.94M | $25.50M | $11.69M | 2026-11-04 |
| 11 | Indiana enacts data center moratorium by...? | AI | $28.5k | $2.68M | $6.07M | $789.9k | 2029-01-01 |
| 12 | What price will Bitcoin hit in October? | crypto | $292.2k | $2.58M | $8.90M | $1.86M | 2026-11-01 |
| 13 | What price will Bitcoin hit in 2026? | crypto | $289.3k | $2.52M | $76.60M | $3.52M | 2027-01-01 |
| 14 | Brazil Presidential Election Second Round: Margin of Victory | politics/elections | $362.3k | $2.30M | $3.06M | $426.9k | 2026-10-26 |
| 15 | Which party will win the House in 2026? | politics/elections | $335.5k | $2.17M | $18.75M | $6.75M | 2026-11-04 |

### By lifetime volume (top 15 of 50)

| # | Event | Category | 24h vol | 7d vol | Lifetime vol | Liquidity | Ends |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | Democratic Presidential Nominee 2028 | politics/elections | $595.7k | $2.08M | $1.30B | $74.11M | 2028-11-08 |
| 2 | Presidential Election Winner 2028 | politics/elections | $210.7k | $1.79M | $717.45M | $58.82M | 2028-11-08 |
| 3 | Republican Presidential Nominee 2028 | politics/elections | $323.5k | $1.94M | $713.79M | $50.12M | 2028-11-08 |
| 4 | F1 Drivers' Champion | sports | $69.2k | $206.6k | $204.51M | $1.81M | 2027-04-01 |
| 5 | Brazil Presidential Election | politics/elections | $956.7k | $8.31M | $188.76M | $1.05M | 2026-10-26 |
| 6 | Next French Presidential Election | politics/elections | $716.4k | $3.68M | $154.07M | $19.14M | 2027-04-19 |
| 7 | Netanyahu out by...? | geopolitics/war | $9.9k | $85.8k | $124.62M | $72.8k | 2027-01-01 |
| 8 | Venezuela leader end of 2026? | geopolitics/war | $34.5k | $300.7k | $98.53M | $2.21M | 2027-01-01 |
| 9 | What price will Bitcoin hit in 2026? | crypto | $289.3k | $2.52M | $76.60M | $3.52M | 2027-01-01 |
| 10 | Kharg Island no longer under Iranian control by...? | geopolitics/war | $77.0k | $445.1k | $76.33M | $265.1k | 2027-01-01 |
| 11 | Will the U.S. invade Iran before 2027? | geopolitics/war | $29.8k | $759.2k | $74.66M | $458.6k | 2027-01-01 |
| 12 | Will the US confirm that aliens exist by...? | weather/climate/science | $141.7k | $1.15M | $74.30M | $783.8k | 2027-01-01 |
| 13 | Pro Football: 2027 Champion | sports | $181.1k | $3.04M | $68.55M | $6.71M | 2027-04-01 |
| 14 | Will Jesus Christ return before 2027? | culture/entertainment/awards | $6.9k | $103.4k | $66.58M | $407.7k | 2027-01-01 |
| 15 | UEFA Champions League: 2027 Champion | sports | $948.3k | $4.98M | $55.88M | $10.93M | 2027-06-20 |

### By liquidity (top 15 of 50)

| # | Event | Category | 24h vol | 7d vol | Lifetime vol | Liquidity | Ends |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | Democratic Presidential Nominee 2028 | politics/elections | $595.7k | $2.08M | $1.30B | $74.11M | 2028-11-08 |
| 2 | Presidential Election Winner 2028 | politics/elections | $210.7k | $1.79M | $717.45M | $58.82M | 2028-11-08 |
| 3 | Republican Presidential Nominee 2028 | politics/elections | $323.5k | $1.94M | $713.79M | $50.12M | 2028-11-08 |
| 4 | Next French Presidential Election | politics/elections | $716.4k | $3.68M | $154.07M | $19.14M | 2027-04-19 |
| 5 | Balance of Power: 2026 Midterms | politics/elections | $493.6k | $2.94M | $25.50M | $11.69M | 2026-11-04 |
| 6 | Ballon d'Or Winner 2026 | sports | $1.41M | $5.84M | $54.67M | $11.33M | 2027-01-01 |
| 7 | UEFA Champions League: 2027 Champion | sports | $948.3k | $4.98M | $55.88M | $10.93M | 2027-06-20 |
| 8 | EPL: 2027 Champion | sports | $151.9k | $857.4k | $22.78M | $9.96M | 2027-06-15 |
| 9 | NBA: 2027 Champion | sports | $124.5k | $1.36M | $26.59M | $8.56M | 2027-07-01 |
| 10 | California Governor Election Winner | politics/elections | $54.9k | $277.3k | $42.09M | $7.00M | 2026-11-04 |
| 11 | Which party will win the House in 2026? | politics/elections | $335.5k | $2.17M | $18.75M | $6.75M | 2026-11-04 |
| 12 | Pro Football: 2027 Champion | sports | $181.1k | $3.04M | $68.55M | $6.71M | 2027-04-01 |
| 13 | Which party will win the Senate in 2026? | politics/elections | $89.5k | $846.3k | $7.22M | $6.35M | 2026-11-04 |
| 14 | LALIGA: 2027 Champion | sports | $150.2k | $877.6k | $8.94M | $5.37M | 2027-06-15 |
| 15 | Fed Decision in October? | economy/Fed/macro | $2.73M | $16.21M | $49.93M | $4.78M | 2026-10-29 |

### Series by 24h volume, including instances that already closed (platform `series.volume24hr`)

| # | Series slug | Title | Label | Category | 24h vol |
|---:|---|---|---|---|---|
| 1 | btc-up-or-down-5m | BTC Up or Down 5m | 5m | crypto | $11.58M |
| 2 | atp | ATP | daily | sports | $11.23M |
| 3 | nfl-2026 | NFL 2026 | daily | sports | $9.89M |
| 4 | counter-strike | Counter Strike | daily | esports | $5.11M |
| 5 | wta | WTA | daily | sports | $4.77M |
| 6 | premier-league-2025 | Premier League 2025 | daily | sports | $4.63M |
| 7 | serie-a-2025 | Serie A 2025 | daily | sports | $3.45M |
| 8 | fomc | FOMC | monthly | economy/Fed/macro | $2.91M |
| 9 | btc-up-or-down-15m | BTC Up or Down 15m | 15m | crypto | $2.77M |
| 10 | saudi-professional-league | Saudi Professional League | daily | sports | $2.26M |
| 11 | la-liga-2025 | La Liga 2025 | daily | sports | $2.03M |
| 12 | us-iran-ceasefire-continues | US-Iran ceasefire continues | monthly | geopolitics/war | $1.96M |
| 13 | ucl-2025 | UEFA Champions League 2025 | daily | sports | $1.66M |
| 14 | dota-2 | Dota 2 | daily | esports | $1.31M |
| 15 | btc-multi-strikes-weekly | BTC Multi Strikes Weekly | weekly | crypto | $1.28M |
| 16 | primeira-liga | Primeira Liga | daily | sports | $1.15M |
| 17 | tur-2025 | Süper Lig 2025 | daily | sports | $1.01M |
| 18 | primera-divisin-argentina | Primera División Argentina | daily | sports | $979.5k |
| 19 | brazil-serie-a | Brazil Serie A | daily | sports | $962.5k |
| 20 | mlb | MLB | daily | sports | $904.5k |
| 21 | wnba | WNBA | daily | sports | $900.1k |
| 22 | elon-tweets | Elon Tweets | weekly | mentions/tweets | $852.7k |
| 23 | nhl-2026 | NHL 2026 | daily | sports | $845.6k |
| 24 | btc-up-or-down-hourly | BTC Up or Down Hourly | hourly | crypto | $677.8k |
| 25 | bitcoin-hit-price-monthly | Bitcoin Hit Price Monthly | monthly | crypto | $584.1k |

Full list: `polymarket_series_24h.csv` (2,504 series).

### Top 5 per category by 7-day volume (all 15 in the CSV)

**politics/elections:** Brazil Presidential Election ($8.31M); Next French Presidential Election ($3.68M); Prime Minister of Israel after the next election? ($3.18M); Balance of Power: 2026 Midterms ($2.94M); Brazil Presidential Election Second Round: Margin of Victory ($2.30M)

**geopolitics/war:** US-Iran ceasefire continues through...? ($4.42M); Israel x Iran ceasefire continues through...? ($1.91M); US announces end of Iranian blockade by...? ($1.58M); Israel x Hamas ceasefire cancelled by...? ($1.56M); Nicolás Maduro released from custody by...? ($1.50M)

**economy/Fed/macro:** Fed Decision in October? ($16.21M); Fed Decision in December? ($1.07M); How many Fed rate cuts in 2026? ($435.5k); Fed Decision in January? ($267.1k); Another Fed rate hike in 2026? ($230.0k)

**finance/stocks/earnings:** What will WTI Crude Oil (WTI) hit in October 2026? ($1.06M); Anthropic IPO by __? ($500.7k); Largest Company end of December 2026? ($490.0k); Anthropic IPO Closing Market Cap ($446.3k); Largest Company end of October 2026? ($283.1k)

**crypto:** What price will Bitcoin hit in October? ($2.58M); What price will Bitcoin hit in 2026? ($2.52M); Will MetaMask launch a token by ___ ? ($914.2k); What price will Ethereum hit in 2026? ($752.3k); What price will Ethereum hit in October? ($699.9k)

**tech:** Tesla and SpaceX merger officially announced by...? ($140.7k); AI bubble burst by...? ($89.1k); SCOTUS accepts sports event contract case by...? ($66.5k); CoreWeave announces bankruptcy by...? ($54.7k); Will Apple release a foldable iPhone by...? ($44.2k)

**AI:** Indiana enacts data center moratorium by...? ($2.68M); Which company has the best AI model end of October? ($486.1k); Will Anthropic’s valuation hit __ by December 31? ($448.5k); Anthropic announces bankruptcy by...? ($346.5k); Next Fable Model (5.2+) released by...? ($215.8k)

**sports:** Ballon d'Or Winner 2026 ($5.84M); UEFA Champions League: 2027 Champion ($4.98M); Pro Football: 2027 Champion ($3.04M); NBA: 2027 Champion ($1.36M); LALIGA: 2027 Champion ($877.6k)

**esports:** Worlds 2026: Winner ($1.18M); LoL: G2 Esports vs Dplus KIA (BO1) - Worlds Group Stage ($158.5k); Worlds 2026 Winning Region ($126.7k); LoL: Anyone's Legend vs Karmine Corp (BO1) - Worlds Group S… ($84.3k); Counter-Strike: TheMongolz vs BIG (BO3) - 1win Private Club… ($82.3k)

**weather/climate/science:** Will the US confirm that aliens exist by...? ($1.15M); Highest temperature in Cape Town on October 18? ($318.5k); Measles cases in U.S. in 2026? ($161.0k); Highest temperature in Paris on October 19? ($126.8k); Plague pandemic in 2026? ($91.9k)

**culture/entertainment/awards:** New "Stranger Things" episode released by...? ($19.31M); # of views of Grand Theft Auto VI Launch Trailer on week 1? ($626.3k); Which movie has biggest opening weekend in 2026? ($159.0k); "Resident Evil" total domestic gross by October 31? ($111.3k); Will Jesus Christ return before 2027? ($103.4k)

**mentions/tweets:** Elon Musk # tweets October 13 - October 20, 2026? ($1.34M); Elon Musk # tweets October 16 - October 23, 2026? ($732.9k); Elon Musk # tweets October 19 - October 21, 2026? ($105.5k); Elon Musk # tweets October 20 - October 27, 2026? ($100.1k); Donald Trump # Truth Social posts October 13 - October 20, … ($51.5k)

**other:** UK election called by...? ($8.3k); How many UK Prime Ministers by end of 2027? ($6.2k); Leopold Aschenbrenner charged by...? ($1.8k); Will TownSquare launch a token by ___? ($495); Who will be the next Secretary-General of the UN? ($382)

### By comment count (top 30)

Comments are mostly stored on the series, not the event: 21,080 of 22,324 open events show 0 comments, including every recurring crypto, weather and sports instance. Both views follow.

| # | Event | Category | Comments | 7d vol |
|---:|---|---|---:|---:|
| 1 | Brazil Presidential Election | politics/elections | 25,690 | $8.31M |
| 2 | Will the US confirm that aliens exist by...? | weather/climate/science | 1,734 | $1.15M |
| 3 | Ballon d'Or Winner 2026 | sports | 1,217 | $5.84M |
| 4 | Will the U.S. invade Venezuela by...? | geopolitics/war | 1,176 | $713.5k |
| 5 | Iran leadership change by...? | geopolitics/war | 1,090 | $351.2k |
| 6 | Presidential Election Winner 2028 | politics/elections | 1,056 | $1.79M |
| 7 | Epstein client list released by...? | politics/elections | 1,049 | $1.22M |
| 8 | Iran full airspace closure by...? | geopolitics/war | 1,024 | $101.8k |
| 9 | Next French Presidential Election | politics/elections | 997 | $3.68M |
| 10 | Israel x Hamas ceasefire cancelled by...? | geopolitics/war | 979 | $1.56M |
| 11 | Prime Minister of Israel after the next election? | politics/elections | 886 | $3.18M |
| 12 | Democratic Presidential Nominee 2028 | politics/elections | 844 | $2.08M |
| 13 | US announces end of Iranian blockade by...? | geopolitics/war | 837 | $1.58M |
| 14 | New "Stranger Things" episode released by...? | culture/entertainment/awards | 732 | $19.31M |
| 15 | Xi Jinping out before 2027? | geopolitics/war | 709 | $365.4k |
| 16 | Next Prime Minister of Romania? | politics/elections | 673 | $455.4k |
| 17 | Hantavirus pandemic in 2026? | weather/climate/science | 571 | $16.0k |
| 18 | Kharg Island no longer under Iranian control by...? | geopolitics/war | 522 | $445.1k |
| 19 | Will Ukraine recapture Crimean territory by...? | geopolitics/war | 500 | $66.3k |
| 20 | Venezuela leader end of 2026? | geopolitics/war | 485 | $300.7k |
| 21 | Lima Mayoral Election Winner | politics/elections | 471 | $4.9k |
| 22 | María Corina Machado enters Venezuela by...? | geopolitics/war | 461 | $496.6k |
| 23 | Republican Presidential Nominee 2028 | politics/elections | 447 | $1.94M |
| 24 | Will Reza Pahlavi enter Iran by...? | geopolitics/war | 432 | $243.4k |
| 25 | Kanye West performs in Russia by October 31? | culture/entertainment/awards | 414 | $93.9k |
| 26 | Mojtaba Khamenei public appearance by...? | geopolitics/war | 413 | $130.9k |
| 27 | Balance of Power: 2026 Midterms | politics/elections | 407 | $2.94M |
| 28 | Clarity Act (H.R.3633) signed into law in 2026? | crypto | 386 | $103.2k |
| 29 | Will Hamas agree to disarm by...? | geopolitics/war | 371 | $45.6k |
| 30 | Israel x Iran ceasefire continues through...? | geopolitics/war | 371 | $1.91M |

| # | Series | Recurrence | Comments | 24h vol |
|---:|---|---|---:|---:|
| 1 | nhl-2026 | daily | 224,575 | $845.6k |
| 2 | btc-up-or-down-5m | 5m | 97,149 | $11.58M |
| 3 | elon-tweets | weekly | 71,569 | $852.7k |
| 4 | btc-up-or-down-15m | 15m | 25,694 | $2.77M |
| 5 | soccer-fifwc | daily | 25,393 | $0 |
| 6 | us-strikes-iran | - | 23,237 | $0 |
| 7 | btc-up-or-down-hourly | hourly | 14,618 | $677.8k |
| 8 | russia-x-ukraine-ceasefire | - | 13,580 | $0 |
| 9 | khamenei-out | - | 13,169 | $0 |
| 10 | elon-tweets-48h | daily | 12,708 | $312.3k |
| 11 | counter-strike | daily | 11,532 | $5.11M |
| 12 | league-of-legends | daily | 10,448 | $397.2k |
| 13 | fomc | monthly | 9,655 | $2.91M |
| 14 | strait-of-hormuz | weekly | 9,321 | $0 |
| 15 | nba-2026 | daily | 9,214 | $188.4k |

## 3. Resolution horizon

### 3a. Open events by time from the snapshot to `endDate`

| Time to end | Events | Events % | Open mkts | 24h vol | 24h % | 7d vol | 7d % |
|---|---:|---:|---:|---:|---:|---:|---:|
| past end date, not yet closed | 3,225 | 14.4% | 25,076 | $1.18M | 3.3% | $2.53M | 1.4% |
| <1 hour | 97 | 0.4% | 131 | $29.0k | 0.1% | $29.0k | 0.0% |
| 1-6 hours | 809 | 3.6% | 2,049 | $1.25M | 3.5% | $1.62M | 0.9% |
| 6-24 hours | 3,041 | 13.6% | 10,979 | $3.81M | 10.8% | $5.72M | 3.1% |
| 1-7 days | 5,222 | 23.4% | 99,362 | $5.60M | 15.8% | $18.79M | 10.2% |
| 1-6 weeks | 6,554 | 29.4% | 89,583 | $11.61M | 32.8% | $54.96M | 29.9% |
| >6 weeks | 3,365 | 15.1% | 30,771 | $11.88M | 33.6% | $99.84M | 54.4% |
| no end date | 11 | 0.1% | 189 | $2.1k | 0.0% | $12.9k | 0.0% |

'Past end date, not yet closed' is mostly stale or in-play sports (2,677) and esports (323) listings plus events waiting for resolution. Only 28 events were flagged live at the snapshot. Polymarket pre-lists recurring instances. At any moment about 300 BTC 5-minute markets are open, covering the next 24 hours, so the short buckets look small by count even though they carry most of the flow (see 3b and section 4).

By category (events / 7-day volume):

| Category | Past end | <1h | 1-6h | 6-24h | 1-7d | 1-6w | >6w |
|---|---|---|---|---|---|---|---|
| politics/elections | 64 / $865.7k | - | - | 1 / $242 | 135 / $12.22M | 1,452 / $20.82M | 411 / $15.45M |
| geopolitics/war | 18 / $77.6k | - | - | - | 4 / $19.7k | 62 / $6.98M | 374 / $23.16M |
| economy/Fed/macro | - | - | - | 1 / $49.9k | 7 / $75.5k | 45 / $16.76M | 126 / $2.87M |
| finance/stocks/earnings | 9 / $1.1k | - | - | 74 / $116.5k | 100 / $286.0k | 184 / $2.24M | 98 / $2.62M |
| crypto | 77 / $3.8k | 97 / $29.0k | 693 / $8.8k | 2,483 / $1.17M | 314 / $864.8k | 19 / $3.60M | 315 / $8.23M |
| tech | 2 / $679 | - | - | - | 8 / $12.9k | 22 / $51.8k | 68 / $528.5k |
| AI | 2 / $2.2k | - | - | 1 / $8.3k | 4 / $29.6k | 105 / $1.03M | 169 / $4.89M |
| sports | 2,677 / $191.8k | - | 20 / $18.2k | 397 / $2.51M | 4,381 / $2.89M | 4,567 / $1.68M | 1,437 / $19.65M |
| esports | 323 / $1.8k | - | 2 / $80.8k | 61 / $339.5k | 60 / $427.8k | 21 / $1.22M | 95 / $195.3k |
| weather/climate/science | 51 / $1.39M | - | 94 / $1.52M | 2 / $8.1k | 180 / $352.7k | 16 / $75.0k | 87 / $1.80M |
| culture/entertainment/awards | 2 / $0 | - | - | 11 / $88.1k | 9 / $694.9k | 39 / $354.3k | 172 / $20.43M |
| mentions/tweets | - | - | - | 10 / $1.43M | 20 / $920.8k | 22 / $153.4k | 1 / $10 |
| other | - | - | - | - | - | - | 12 / $17.3k |

### 3b. Throughput: events resolved in the last 30 days, by listing duration

Listing duration = (earlier of `closedTime` and `endDate`) − `startDate`, i.e. how long the event was listed. Crypto up/down instances are listed about 24 hours before their window opens, so a 5-minute market shows a 24-hour listing. The family table in section 4 gives the actual resolution windows.

| Listing duration | Events | Events % | Lifetime vol | Vol % | Median/event | p90/event |
|---|---:|---:|---:|---:|---:|---:|
| <1 hour | 586 | 0.4% | $191.2k | 0.0% | $0 | $363 |
| 1-6 hours | 2,095 | 1.4% | $27.00M | 0.7% | $240 | $2.2k |
| 6-24 hours | 85,811 | 55.4% | $865.31M | 22.0% | $0 | $24.8k |
| 1-7 days | 52,892 | 34.1% | $1.29B | 32.9% | $545 | $29.3k |
| 1-6 weeks | 13,086 | 8.4% | $1.51B | 38.4% | $1.4k | $169.6k |
| >6 weeks | 520 | 0.3% | $238.20M | 6.0% | $42.4k | $519.0k |
| TOTAL | 154,990 | 100% | $3.93B | 100% |  |  |

By category:

| Category | Events | Vol | Vol % | Median | <1h | 1-6h | 6-24h | 1-7d | 1-6w | >6w |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| politics/elections | 391 | $49.81M | 1.3% | $25.3k | $0 | $0 | $91.2k | $2.13M | $12.65M | $34.94M |
| geopolitics/war | 81 | $116.37M | 3.0% | $91.2k | $0 | $0 | $14.5k | $478.2k | $6.02M | $109.85M |
| economy/Fed/macro | 40 | $2.54M | 0.1% | $49.3k | $0 | $0 | $0 | $20.5k | $1.18M | $1.33M |
| finance/stocks/earnings | 1,429 | $24.66M | 0.6% | $1.4k | $0 | $0 | $6.4k | $9.46M | $12.33M | $2.86M |
| crypto | 100,703 | $635.46M | 16.1% | $12 | $0 | $822.8k | $372.95M | $229.93M | $31.33M | $432.6k |
| tech | 30 | $9.57M | 0.2% | $6.7k | $0 | $0 | $0 | $7.98M | $15.8k | $1.57M |
| AI | 128 | $16.04M | 0.4% | $36.1k | $0 | $0 | $91.5k | $1.38M | $3.76M | $10.81M |
| sports | 46,032 | $2.20B | 55.9% | $59 | $191.2k | $2.07M | $179.70M | $568.78M | $1.38B | $73.11M |
| esports | 2,749 | $758.41M | 19.3% | $21.5k | $0 | $24.05M | $311.90M | $389.24M | $32.57M | $635.5k |
| weather/climate/science | 2,995 | $70.90M | 1.8% | $15.9k | $0 | $0 | $157.5k | $68.85M | $834.2k | $1.06M |
| culture/entertainment/awards | 227 | $11.43M | 0.3% | $14.4k | $0 | $5.3k | $181.9k | $3.97M | $5.68M | $1.59M |
| mentions/tweets | 179 | $40.12M | 1.0% | $11.7k | $0 | $53.8k | $212.8k | $10.86M | $28.99M | $0 |
| other | 6 | $14.2k | 0.0% | $1.5k | $0 | $0 | $7.0k | $0 | $0 | $7.2k |

Over 30 days, 154,990 events resolved, carrying $3.93B of lifetime volume. Events listed for less than a week account for 55.5% of that volume and 91.2% of the events. Sports (55.9%), esports (19.3%) and crypto (16.1%) make up 91.3% of resolved volume. Files: `polymarket_resolved30d_by_duration.csv`, `polymarket_resolved30d_by_category.csv`.

## 4. Short-term recurring families

Per-instance volume is the lifetime volume of each resolved instance (a sports instance is a whole game). 'Daily vol' is the volume of instances resolved in the last 7 days, divided by 7. Liquidity and spread come from upcoming open instances. Fee rates are taker rates. Full tables: `polymarket_short_term_families.csv`, `polymarket_short_term_series.csv` (every series), `polymarket_short_term_sports_leagues.csv`.

### 4a. Family summary

| Family | Subjects | Cadence (measured) | Open now | Resolved 7d | Median/inst 7d | p90 7d | Median 30d | p90 30d | Daily vol (7d) | 24h vol on open inst. | Median liq | Main spread | Fee |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Sports games | 21 | per game | 6,312 | 7,873 | $56 | $85.6k | $48 | $94.3k | $75.83M | $4.89M | $742 | 0.45 | sports_fees_v3 5% |
| Esports matches | 5 | per match | 563 | 620 | $19.9k | $403.5k | $21.5k | $574.4k | $25.62M | $935.0k | $2.5k | 0.07 | sports_fees_v3 5% |
| Crypto up/down | 8 | 5 min(8), 15 min(8), 4 hours(8), hourly(7), daily(7) | 3,579 | 23,072 | $0 | $18.6k | $0 | $20.7k | $15.72M | $116.1k | $1.4k | 0.02 | crypto_fees_v2 7% |
| Daily highest temperature | 51 | daily(51) | 162 | 331 | $35.8k | $70.0k | $37.5k | $71.5k | $1.98M | $2.03M | $17.3k | 0.02 | weather_fees 5% |
| Crypto above-strike ladder | 4 | daily(4), hourly(2) | 32 | 366 | $283 | $2.2k | $280 | $2.1k | $1.60M | $794.2k | $120.0k | 0.0125 | crypto_fees_v2 7% |
| Tweet/post counts | 10 | 2-3 days(9), weekly(1) | 36 | 21 | $17.5k | $868.1k | $16.6k | $1.27M | $1.55M | $1.01M | $9.4k | 0.006 | culture_fees 5% |
| Crypto hit-price (touch) | 11 | weekly(5), daily(4) | 28 | 34 | $52.8k | $488.6k | $28.8k | $502.2k | $1.00M | $1.03M | $107.8k | 0.0095 | crypto_fees_v2 7% |
| Crypto price range (neg-risk buckets) | 4 | daily(4) | 28 | 28 | $26.8k | $134.7k | $24.6k | $162.8k | $202.3k | $105.7k | $36.7k | 0.0215 | crypto_fees_v2 7% |
| Mention markets (what will X say) | 21 | weekly(7), monthly+(4), 2-3 days(2), daily(1) | 21 | 24 | $6.8k | $57.3k | $7.6k | $46.2k | $171.2k | $11.6k | $652 | 0.09 | mentions_fees 4% |
| Daily lowest temperature | 51 | daily(51) | 141 | 302 | $1.3k | $5.2k | $1.1k | $7.6k | $115.9k | $110.3k | $2.8k | 0.515 | weather_fees 5% |
| Economic data releases (CPI, jobs, GDP...) | 47 | per event | 50 | 8 | $76.2k | $150.7k | $37.9k | $95.7k | $105.2k | $57.4k | $4.4k | 0.012 | economics_fees 5% |
| Index/ETF daily up/down | 12 | daily(12) | 13 | 59 | $341 | $33.0k | $215 | $28.2k | $79.5k | $27.7k | $711 | 0.035 | finance_prices_fees 4% |
| Stock hit-price (touch) | 18 | weekly(18) | 34 | 18 | $26.6k | $41.8k | $25.0k | $52.8k | $64.9k | $134.3k | $42.9k | 0.04 | finance_prices_fees 4% |
| Stock above-strike ladder | 18 | weekly(12), daily(7) | 20 | 47 | $6.8k | $20.7k | $3.2k | $18.1k | $58.3k | $9.8k | $6.5k | 0.07 | finance_prices_fees 4% |
| Commodity hit-price (touch) | 4 | weekly(4) | 4 | 4 | $87.6k | $117.2k | $54.2k | $88.4k | $48.6k | $36.2k | $22.8k | 0.006 | finance_prices_fees 4% |
| Daily close over/under (commodity/ETF) | 3 | daily(3) | 3 | 14 | $20.6k | $36.1k | $26.4k | $53.6k | $40.2k | $9.2k | $7.5k | 0.02 | finance_prices_fees 4% |
| Earnings markets | 208 | per event | 185 | 25 | $4.2k | $12.9k | $4.1k | $8.4k | $20.2k | $25.1k | $490 | 0.06 | finance_prices_fees 4% |
| Index/ETF hit-price (touch) | 3 | weekly(3) | 4 | 3 | $54.3k | $55.3k | $54.3k | $67.8k | $16.6k | $23.6k | $17.2k | 0.0135 | finance_prices_fees 4% |
| Stock price range (neg-risk buckets) | 12 | weekly(12) | 12 | 12 | $6.2k | $10.4k | $1.9k | $9.3k | $16.5k | $2.3k | $7.1k | 0.135 | finance_prices_fees 4% |
| Stock daily up/down | 16 | daily(16) | 16 | 80 | $849 | $3.6k | $1.0k | $4.3k | $16.2k | $6.2k | $764 | 0.03 | finance_prices_fees 4% |
| Commodity daily up/down | 4 | daily(4) | 6 | 20 | $4.2k | $9.3k | $6.9k | $13.9k | $15.2k | $4.9k | $1.1k | 0.05 | finance_prices_fees 4% |
| Daily weather (other) | 3 | daily(3) | 6 | 20 | $4.7k | $7.9k | $5.3k | $10.4k | $13.2k | $10.7k | $1.0k | 0.009 | weather_fees 5% |
| FX daily up/down | 11 | daily(11) | 14 | 55 | $10 | $20 | $10 | $20 | $205 | $3 | $0 | 0.98 | finance_prices_fees 4% |
| Central-bank rate decisions | 30 | per event | 48 | 0 | $0 | $0 | $79.1k | $156.0k | $0 | $3.19M | $8.4k | 0.01 | economics_fees 5% |

Crypto up/down medians are low because most 5-minute instances on minor coins really are tiny, and because many 5-minute instances report 0 volume when they did trade (see Caveats). With sampled corrections the family is about $19.22M/day. For central-bank decisions and economic data, the '24h vol on open instances' column matters more than resolved-instance volume: the open October Fed decision alone traded $2.73M in the last 24h and $16.2M in the last 7 days.

### 4b. Crypto up/down by asset and cadence (daily volume, 7-day average)

| Asset | 5 min (corrected) | 15 min | Hourly | 4 hours | Daily | Total/day (corrected) |
|---|---:|---:|---:|---:|---:|---:|
| BTC | $9.92M ($12.42M) | $3.27M | $681.0k | $88.5k | $154.4k | $16.61M |
| ETH | $454.6k ($1.01M) | $384.6k | $98.0k | $18.8k | $77.9k | $1.58M |
| SOL | $120.0k ($328.7k) | $128.9k | $15.9k | $3.8k | $7.9k | $485.2k |
| XRP | $50.3k ($141.4k) | $81.2k | $10.4k | $3.2k | $4.7k | $241.0k |
| DOGE | $18.9k ($57.2k) | $39.1k | $2.7k | $887 | $269 | $100.2k |
| BNB | $14.2k ($49.1k) | $43.0k | $4.4k | $1.3k | $976 | $98.7k |
| HYPE | $2.2k ($72.0k) | $23.2k | $781 | $267 | $34 | $96.3k |
| ZEC | $8 ($2.5k) | $431 | - | $20 | - | $2.9k |

| Market | Series | Resolved 7d | Median/inst | p90/inst | Zero-vol share | Open now | Median liq (next 3) | Spread (next 3) | Resolution source |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| BTC 5m | btc-up-or-down-5m | 2,016 | $35.6k | $58.5k | 13% | 303 | $13.3k | 0.01 | data.chain.link |
| BTC 15m | btc-up-or-down-15m | 672 | $25.7k | $55.5k | 0% | 97 | $6.7k | 0.01 | data.chain.link |
| BTC 1h | btc-up-or-down-hourly | 169 | $25.9k | $42.8k | 0% | 50 | $8.1k | 0.01 | www.binance.com |
| BTC 4h | btc-up-or-down-4h | 42 | $13.4k | $23.2k | 0% | 7 | $1.5k | 0.02 | data.chain.link |
| BTC 1d | btc-up-or-down-daily | 7 | $177.7k | $209.1k | 0% | 2 | $24.4k | 0.02 | www.binance.com |
| ETH 5m | eth-up-or-down-5m | 2,016 | $0 | $4.1k | 50% | 304 | $5.8k | 0.01 | data.chain.link |
| ETH 15m | eth-up-or-down-15m | 672 | $3.4k | $6.5k | 0% | 97 | $2.9k | 0.01 | data.chain.link |
| ETH 1h | eth-up-or-down-hourly | 169 | $3.7k | $6.1k | 0% | 50 | $4.5k | 0.01 | www.binance.com |
| ETH 4h | eth-up-or-down-4h | 42 | $2.4k | $5.2k | 0% | 7 | $1.4k | 0.02 | data.chain.link |
| ETH 1d | eth-up-or-down-daily | 7 | $68.8k | $114.9k | 0% | 2 | $20.9k | 0.02 | www.binance.com |
| SOL 5m | sol-up-or-down-5m | 2,016 | $0 | $1.4k | 61% | 303 | $3.1k | 0.01 | data.chain.link |
| SOL 15m | sol-up-or-down-15m | 672 | $1.2k | $2.4k | 0% | 98 | $2.2k | 0.02 | data.chain.link |
| SOL 1h | solana-up-or-down-hourly | 169 | $523 | $1.3k | 0% | 50 | $1.9k | 0.03 | www.binance.com |
| SOL 4h | sol-up-or-down-4h | 42 | $404 | $1.2k | 0% | 7 | $711 | 0.02 | data.chain.link |
| SOL 1d | solana-up-or-down-daily | 7 | $8.7k | $10.4k | 0% | 2 | $13.1k | 0.02 | www.binance.com |
| XRP 5m | xrp-up-or-down-5m | 2,016 | $0 | $652 | 67% | 305 | $2.4k | 0.01 | data.chain.link |
| XRP 15m | xrp-up-or-down-15m | 672 | $654 | $1.6k | 0% | 97 | $1.8k | 0.01 | data.chain.link |
| XRP 1h | xrp-up-or-down-hourly | 169 | $250 | $814 | 0% | 50 | $1.1k | 0.05 | www.binance.com |
| XRP 4h | xrp-up-or-down-4h | 42 | $431 | $941 | 0% | 7 | $724 | 0.02 | data.chain.link |
| XRP 1d | xrp-up-or-down-daily | 7 | $4.2k | $9.0k | 0% | 2 | $3.6k | 0.02 | www.binance.com |

Resolution sources, from the market rules: 5-minute markets use the Chainlink BTC/USD data stream (data.chain.link/streams/btc-usd). Some 5-minute instances and all 15-minute and 4-hour instances use the Chainlink 60-second TWAP stream. Hourly and daily up/down use the open and close of the Binance BTC/USDT 1h or 1m candle. `/crypto-market-configs` lists spot and TWAP-30s/60s variants per asset and duration. Fee: crypto_fees_v2, 7% taker rate, 20% maker rebate. Assets offered: BTC, ETH, SOL, XRP, DOGE, BNB, HYPE, ZEC (ZEC 5m and 15m barely trade). Over the last 7 days BTC is 86% of corrected crypto up/down volume.

### 4c. Crypto price ladders, ranges and touch markets

| Type | Asset | Series | Gap | Resolved 7d | Median/inst | p90/inst | Daily vol | Median liq | Spread |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| above-strike ladder | BTC | btc-multi-strikes-weekly | 24h | 7 | $1.28M | $1.59M | $1.23M | $455.5k | 0.01 |
| hit-price (touch) | BTC | bitcoin-hit-price-daily | 24h | 8 | $407.2k | $526.2k | $481.0k | $367.4k | 0.003 |
| above-strike ladder | ETH | ethereum-multi-strikes-weekly | 24h | 7 | $320.7k | $421.1k | $308.0k | $324.1k | 0.001 |
| hit-price (touch) | BTC | bitcoin-hit-price-weekly | 168h | 1 | $1.54M | $1.54M | $219.6k | $685.2k | 0.005 |
| hit-price (touch) | ETH | ethereum-hit-price-weekly | 168h | 1 | $1.07M | $1.07M | $152.2k | $453.7k | 0.02 |
| price range (neg-risk buckets) | BTC | bitcoin-neg-risk-weekly | 24h | 7 | $130.9k | $147.2k | $133.7k | $184.8k | 0.006 |
| hit-price (touch) | ETH | ethereum-hit-price-daily | 24h | 7 | $118.8k | $199.0k | $132.8k | $99.0k | 0.022 |
| price range (neg-risk buckets) | ETH | ethereum-neg-risk-weekly | 24h | 7 | $54.1k | $81.6k | $61.3k | $106.0k | 0.04 |
| above-strike ladder | SOL | solana-multi-strikes-weekly | 24h | 7 | $19.2k | $50.5k | $27.7k | $129.6k | 0.015 |
| above-strike ladder | BTC | bitcoin-multi-strikes-hourly | 1h | 169 | $327 | $1.4k | $18.3k | $7.0k | 0.035 |
| above-strike ladder | ETH | ethereum-multi-strikes-hourly | 1h | 169 | $223 | $709 | $9.1k | $5.4k | 0.0225 |
| above-strike ladder | XRP | xrp-multi-strikes-weekly | 24h | 7 | $2.2k | $13.9k | $6.2k | $95.6k | 0.027 |
| hit-price (touch) | SOL | solana-hit-price-weekly | 168h | 1 | $40.4k | $40.4k | $5.8k | $101.1k | 0.045 |
| price range (neg-risk buckets) | SOL | solana-neg-risk-weekly | 24h | 7 | $4.5k | $8.2k | $5.3k | $11.2k | 0.028 |
| hit-price (touch) | XRP | xrp-hit-price-weekly | 168h | 1 | $30.2k | $30.2k | $4.3k | $53.9k | 0.019 |
| hit-price (touch) | SOL | solana-hit-price-daily | 24h | 7 | $2.1k | $5.8k | $2.9k | $9.2k | 0.008 |
| hit-price (touch) | XRP | xrp-hit-price-daily | 24h | 7 | $1.2k | $4.8k | $2.1k | $6.1k | 0.018 |

The 'BTC above ___ on <date>?' ladder (series `btc-multi-strikes-weekly`, one event per day, a ladder of about 10-20 strikes, resolved on the Binance BTC/USDT 1m close at noon ET) is the biggest daily crypto product after up/down: about $1.23M per day. The 'What price will Bitcoin hit on <date>?' touch ladder adds about $0.48M per day. There are hourly ladders (`bitcoin-multi-strikes-hourly`, Binance 1h close), but they trade only about $18k per day.

### 4d. Stock, index, commodity and FX daily and weekly markets

| Family | Subject | Gap | Resolved 30d | Median/inst 30d | p90 30d | Daily vol (7d) | Median liq | Spread | Resolution source |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Commodity daily up/down | OIL | 24h | 21 | $9.0k | $16.2k | $7.0k | $788 | 0.05 | app.pyth.com |
| Commodity daily up/down | GOLD | 24h | 21 | $8.5k | $13.2k | $5.4k | $9.0k | 0.05 | pythdata.app |
| Commodity daily up/down | SILVER | 24h | 21 | $5.0k | $10.4k | $2.4k | $1.4k | 0.04 | pythdata.app |
| Commodity hit-price (touch) | WTI-CRUDE-OIL | 168h | 4 | $47.6k | $103.9k | $17.8k | $15.6k | 0.009 | app.pyth.com |
| Commodity hit-price (touch) | SILVER | 168h | 4 | $74.4k | $92.9k | $14.2k | $23.6k | 0.003 | pythdata.app |
| Commodity hit-price (touch) | GOLD | 168h | 4 | $72.8k | $74.9k | $10.8k | $21.9k | 0.02 | pythdata.app |
| Commodity hit-price (touch) | NATURAL-GAS | 168h | 4 | $28.6k | $37.6k | $5.7k | $38.9k | 0.001 | app.pyth.com |
| Daily close over/under (commodity/ETF) | SPY | 24h | 21 | $24.6k | $45.3k | $20.5k | $24.4k | 0.01 | pythdata.app |
| Daily close over/under (commodity/ETF) | WTI | 24h | 21 | $38.1k | $59.3k | $18.9k | $7.5k | 0.02 | app.pyth.com |
| Index/ETF daily up/down | SPX | 24h | 21 | $43.8k | $76.2k | $49.7k | $27.1k | 0.01 | www.wsj.com |
| Index/ETF daily up/down | SPY | 24h | 21 | $17.6k | $41.0k | $17.8k | $20.0k | 0.01 | pythdata.app |
| Index/ETF daily up/down | SPX (open) | 24h | 21 | $9.0k | $17.5k | $6.9k | $552 | 0.05 | www.wsj.com |
| Index/ETF daily up/down | DOW-JONES | 24h | 21 | $1.6k | $8.0k | $2.6k | $6.3k | 0.03 | www.wsj.com |
| Index/ETF daily up/down | RUSSELL-2000 | 24h | 21 | $2.3k | $12.8k | $1.7k | $56 | 0.53 | www.wsj.com |
| Index/ETF hit-price (touch) | EWY | 168h | 4 | $57.2k | $66.2k | $7.9k | $22.3k | 0.05 | pythdata.app |
| Index/ETF hit-price (touch) | SPY | 168h | 4 | $52.7k | $58.2k | $7.8k | $80.7k | 0.02 | pythdata.app |
| Stock above-strike ladder | GOOGL | 24h | 21 | $7.5k | $25.8k | $9.7k | $12.8k | 0.02 | pythdata.app |
| Stock above-strike ladder | AMZN | 24h | 21 | $1.5k | $18.4k | $8.3k | $15.5k | 0.11 | pythdata.app |
| Stock above-strike ladder | NVDA | 24h | 21 | $3.0k | $17.6k | $8.0k | $5.3k | 0.214 | pythdata.app |
| Stock above-strike ladder | MSFT | 24h | 21 | $6.2k | $18.4k | $7.2k | $3.1k | 0.04 | pythdata.app |
| Stock above-strike ladder | TSLA | 24h | 21 | $2.1k | $8.6k | $4.4k | $3.1k | 0.18 | pythdata.app |
| Stock above-strike ladder | GOOGLE | 168h | 4 | $23.9k | $27.6k | $4.0k | $6.7k | 0.07 | pythdata.app |
| Stock above-strike ladder | META | 24h | 21 | $2.1k | $11.8k | $3.2k | $1.7k | 0.02 | pythdata.app |
| Stock above-strike ladder | AAPL | 24h | 21 | $2.1k | $7.0k | $3.0k | $4.7k | 0.03 | pythdata.app |
| Stock above-strike ladder | NETFLIX | 168h | 4 | $5.1k | $13.1k | $2.3k | $6.2k | 0.08 | pythdata.app |
| Stock above-strike ladder | PALANTIR | 168h | 4 | $636 | $8.9k | $1.8k | $13.0k | 0.07 | pythdata.app |
| Stock above-strike ladder | SPACEX | 168h | 4 | $2.5k | $8.2k | $1.5k | $10.4k | 0.09 | pythdata.app |
| Stock above-strike ladder | MICRON | 168h | 4 | $5.5k | $19.1k | $1.1k | $12.4k | 0.07 | pythdata.app |
| Stock daily up/down | TSLA | 24h | 21 | $2.2k | $7.6k | $2.5k | $763 | 0.03 | pythdata.app |
| Stock daily up/down | NVDA | 24h | 21 | $2.2k | $4.4k | $2.4k | $734 | 0.04 | pythdata.app |
| Stock daily up/down | AAPL | 24h | 21 | $1.7k | $4.7k | $1.7k | $1.2k | 0.01 | pythdata.app |
| Stock daily up/down | GOOGL | 24h | 21 | $1.8k | $4.6k | $1.5k | $1.2k | 0.03 | pythdata.app |
| Stock daily up/down | MSFT | 24h | 21 | $2.0k | $4.7k | $1.3k | $1.1k | 0.01 | pythdata.app |
| Stock daily up/down | META | 24h | 21 | $1.8k | $8.7k | $1.0k | $813 | 0.03 | pythdata.app |
| Stock daily up/down | SPCX | 24h | 21 | $513 | $1.6k | $981 | $210 | 0.06 | pythdata.app |
| Stock daily up/down | MU | 24h | 21 | $831 | $2.4k | $864 | $194 | 0.72 | pythdata.app |
| Stock daily up/down | AMZN | 24h | 21 | $969 | $3.4k | $856 | $1.2k | 0.01 | pythdata.app |
| Stock daily up/down | PLTR | 24h | 21 | $714 | $3.3k | $608 | $496 | 0.03 | pythdata.app |
| Stock daily up/down | NFLX | 24h | 21 | $891 | $2.1k | $600 | $829 | 0.02 | pythdata.app |
| Stock daily up/down | OPEN | 24h | 21 | $716 | $1.4k | $438 | $399 | 0.02 | pythdata.app |
| Stock daily up/down | HOOD | 24h | 21 | $771 | $1.6k | $410 | $765 | 0.06 | pythdata.app |
| Stock daily up/down | ABNB | 24h | 21 | $759 | $1.6k | $394 | $362 | 0.04 | pythdata.app |
| Stock daily up/down | RKLB | 24h | 21 | $679 | $4.0k | $358 | $8.1k | 0.07 | pythdata.app |
| Stock daily up/down | COIN | 24h | 21 | $187 | $1.1k | $255 | $673 | 0.04 | pythdata.app |
| Stock hit-price (touch) | NVIDIA | 168h | 4 | $23.6k | $44.7k | $7.2k | $51.5k | 0.02 | pythdata.app |
| Stock hit-price (touch) | TESLA | 168h | 4 | $29.5k | $40.5k | $6.2k | $79.1k | 0.01 | pythdata.app |
| Stock hit-price (touch) | PALANTIR | 168h | 4 | $28.2k | $37.3k | $5.9k | $17.4k | 0.02 | pythdata.app |
| Stock hit-price (touch) | COINBASE | 168h | 4 | $33.2k | $39.1k | $5.8k | $48.9k | 0.03 | pythdata.app |
| Stock hit-price (touch) | META | 168h | 4 | $29.4k | $62.3k | $5.1k | $103.9k | 0.03 | pythdata.app |
| Stock hit-price (touch) | ROCKET-LAB | 168h | 4 | $32.3k | $34.9k | $4.1k | $12.4k | 0.03 | pythdata.app |
| Stock hit-price (touch) | MICRON | 168h | 4 | $26.8k | $33.2k | $4.1k | $24.5k | 0.03 | pythdata.app |
| Stock hit-price (touch) | GOOGLE | 168h | 4 | $33.3k | $44.6k | $4.1k | $10.2k | 0.03 | pythdata.app |
| Stock hit-price (touch) | ROBINHOOD | 168h | 4 | $33.2k | $45.4k | $3.8k | $42.2k | 0.03 | pythdata.app |
| Stock hit-price (touch) | MICROSOFT | 168h | 4 | $30.2k | $68.2k | $3.8k | $22.5k | 0.041 | pythdata.app |
| Stock hit-price (touch) | APPLE | 168h | 4 | $22.6k | $24.1k | $3.3k | $43.6k | 0.02 | pythdata.app |
| Stock hit-price (touch) | AMAZON | 168h | 4 | $18.4k | $24.4k | $2.6k | $9.9k | 0.02 | pythdata.app |
| Stock hit-price (touch) | AIRBNB | 168h | 4 | $22.3k | $42.5k | $2.3k | $14.4k | 0.06 | pythdata.app |
| Stock hit-price (touch) | OPENDOOR | 168h | 4 | $15.7k | $17.0k | $2.2k | $24.2k | 0.04 | pythdata.app |
| Stock hit-price (touch) | SPACEX | 168h | 4 | $3.8k | $12.2k | $2.1k | $9.8k | 0.08 | pythdata.app |
| Stock hit-price (touch) | NETFLIX | 168h | 4 | $10.1k | $15.3k | $1.4k | $77.5k | 0.04 | pythdata.app |
| Stock price range (neg-risk buckets) | SPCX | 168h | 4 | $2.1k | $36.1k | $7.2k | $6.5k | 0.08 |  |
| Stock price range (neg-risk buckets) | MU | 168h | 4 | $1.5k | $7.8k | $1.5k | $7.9k | 0.17 |  |
| Stock price range (neg-risk buckets) | GOOGL | 168h | 4 | $9.7k | $10.4k | $1.5k | $5.4k | 0.1 |  |
| Stock price range (neg-risk buckets) | NVDA | 168h | 4 | $7.1k | $9.4k | $1.4k | $12.8k | 0.347 |  |
| Stock price range (neg-risk buckets) | AMZN | 168h | 4 | $775 | $6.2k | $1.2k | $6.7k | 0.07 |  |
| Stock price range (neg-risk buckets) | META | 168h | 4 | $3.7k | $7.1k | $1.1k | $6.7k | 0.09 |  |

Daily up/down markets exist for 16 single stocks (AAPL, MSFT, AMZN, GOOGL, META, TSLA, NVDA, NFLX, PLTR, OPEN, RKLB, ABNB, COIN, HOOD, MU, SPCX). Each resolves on the Pyth 1-minute close at the US close versus the prior close, and each trades about $0.3k-2.5k per day. Index markets cover SPX, SPY, SPX/SPY open, Dow, Russell 2000, NDX, Nikkei, FTSE 100, DAX, Hang Seng, NYA and EWY; SPX resolves on WSJ historical closes. Commodity markets cover WTI/oil, gold, silver, natural gas and US gas prices (AAA). Daily close over/under exists for SPY, WTI and US gas. There are 11 daily FX pairs, which barely trade (under $250 per day in total). All carry finance_prices_fees (4% taker). These markets trade on weekdays only, about 21 instances per 30 days.

### 4e. Daily temperature

51 cities have a daily 'Highest temperature in <city> on <date>?' event: about 11 one-degree buckets, listed about 55 hours ahead, resolved from NOAA/weather.gov station time series (a few use Wunderground or the Hong Kong Observatory). The family trades $1.98M/day. The median instance is $35.8k (p90 $70.0k), median liquidity on upcoming instances is $17.3k, and the main-bucket spread is 0.02. 51 cities also have 'Lowest temperature' events, which trade only $115.9k/day. Fee: weather_fees, 5%. The top cities by daily volume:

seoul $79.2k, hong-kong $75.9k, beijing $73.5k, tokyo $61.8k, shanghai $60.7k, los-angeles $60.0k, nyc $59.2k, wellington $56.9k, wuhan $55.4k, chicago $52.5k, paris $50.9k, london $50.3k, sao-paulo $49.3k, san-francisco $46.2k, miami $46.1k.

### 4f. Sports and esports

Sports games: 6,312 open games (12,085 events, 202,787 open markets), 7,873 games resolved in the last 7 days, $75.83M/day. The median game is tiny ($56, because of a long tail of table tennis, lower-league soccer and ITF tennis), and the p90 game is $85.6k. Per league, see 1c. NFL (median $203k and p90 $8.16M per game over 30 days) and soccer ($27.1M/day across all competitions) dominate. Resolution source: league or federation sites (nfl.com, uefa.com, atptour.com, ncaa.com, espncricinfo.com, efl.com). Fees: sports_fees_v3 (5%), with NFL and college football temporarily at 3%. In-play: 27 games were flagged live at the snapshot (Tuesday 06:34 UTC, a quiet hour). Games keep trading until closure, after the event's `endDate`.

Esports: 563 open matches; 620 resolved in 7 days; $25.62M/day. Counter-Strike has the most matches; League of Legends had the largest per-match volume this month (the Worlds play-in and Demacia Cup); Dota 2 and Valorant follow. Resolution: official streams (Kick, Twitch) and HLTV, lolesports.com and Liquipedia.

### 4g. Post counts and mention markets

| Family | Subject | Series | Gap | Resolved 30d | Median/inst | p90/inst | Daily vol (30d) | Median liq | Spread |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| Tweet/post counts | Elon Musk | elon-tweets | 72h | 8 | $2.79M | $4.82M | $880.1k | $213.8k | 0.001 |
| Tweet/post counts | Elon Musk | elon-tweets-48h | 48h | 13 | $648.5k | $1.02M | $312.1k | $42.1k | 0.002 |
| Mention markets | trump-weekly-mentions | trump-weekly-mentions | 168h | 5 | $18.5k | $321.9k | $20.0k | $2.4k | 0.7 |
| Tweet/post counts | Donald Trump | trump-truth-social | 72h | 8 | $57.0k | $96.8k | $17.9k | $18.5k | 0.001 |
| Tweet/post counts | Elon Musk | elon-tweet-daily | - | 1 | $466.8k | $466.8k | $15.6k | $19.4k | 0.001 |
| Tweet/post counts | Khamenei | khamenei-daily-tweets | 72h | 8 | $19.3k | $25.3k | $5.1k | $11.0k | 0.009 |
| Tweet/post counts | White House | whitehouse-daily-tweets | 84h | 9 | $13.6k | $21.3k | $4.4k | $7.8k | 0.005 |
| Mention markets | earnings-call-mentions | earnings-call-mentions | 24h | 17 | $6.4k | $13.2k | $4.3k | $3.0k | 0.02 |
| Tweet/post counts | Zelenskyy | zelenskyy-tweets | 72h | 8 | $14.7k | $22.9k | $4.1k | $7.3k | 0.015 |
| Mention markets | nfl-mentions | nfl-mentions | 64.5h | 12 | $7.8k | $9.8k | $3.0k | $86 | 0.48 |
| Tweet/post counts | NYC Mayor | nycmayor-tweets | 72h | 8 | $8.8k | $11.5k | $2.5k | $3.8k | 0.002 |
| Tweet/post counts | CZ | cz-tweets | 72h | 8 | $7.8k | $10.2k | $2.0k | $4.4k | 0.01 |
| Mention markets | big-brother-mentions | big-brother-mentions | 48h | 5 | $5.2k | $25.2k | $1.9k | $0 |  |
| Mention markets | trump-monthly-mentions | trump-monthly-mentions | - | 1 | $58.2k | $58.2k | $1.9k | $511 | 0.51 |

Elon Musk post counts dominate. A new 7-day window opens every 3-4 days, and the 7-day windows trade $2.8-4.2M each. A 48-hour window trades about $0.65M. The count comes from the 'Post Counter' at xtracker.polymarket.com, with X as fallback. Fees: culture_fees (5%) on post counts, mentions_fees (4%) on mention markets. Mention markets ('What will Trump say…', earnings-call mentions, NFL announcers) are many small events: median $7.6k per instance over 30 days.

### 4h. Economic data, central banks and earnings

- **Economic data releases** (47 series: US CPI/core CPI/PCE/PPI, payrolls and unemployment, GDP for the US, China and Canada, inflation for China, the UK and Argentina, Michigan sentiment, and others): 50 open, 16 resolved in 30 days, median $37.9k and p90 $95.7k per release. Listed about a month ahead. Resolution: BLS, BEA and national statistics offices. Fee: economics 5%. The biggest recent release was the US annual CPI print ($275k).
- **Central-bank decisions** (30 banks: Fed, ECB, BoE, BoJ, BoC, RBA, Banxico, and others): 48 open; open instances traded $3.19M in the last 24h and $19.36M in the last 7 days. The October FOMC event alone is $16.2M over 7 days and $49.9M lifetime (no change 85%, +25 bp 14% at the snapshot). Monthly cadence, so they are not a daily habit product.
- **Earnings** ('Will <company> beat quarterly earnings?' and KPI ladders such as 'Eli Lilly Q3 Mounjaro sales above $X?'): 185 open events in the middle of Q3 reporting season, 44 resolved in 30 days, median $4.1k and p90 $8.4k per event. Resolution: the company's earnings release, with Seeking Alpha EPS consensus as the benchmark. Fee: finance_prices or economics (4-5%). Liquidity is thin (median $490) and the main spread is 0.06.

### 4i. Anything else that resolved within 48 hours

Outside the families above, only 66 events listed for 48 hours or less resolved in 30 days ($9.45M in total). The largest: Will the Tesla Roadster fly for 1s+? ($7.70M); Russia Election: United Russia (ER) Vote Share? ($691.3k); # of views of MrBeast video on day 2? ($387.8k); # of views of MrBeast Gaming video on day 2? ($338.8k); Next GPT Sol Model (5.7+) released on...? ($96.8k); Will Messi's sons join him on the pitch? ($80.7k). MrBeast day-1 and day-2 view-count markets recur (about $32k per instance).

## 5. Stock- and crypto-linked open markets

10,035 open markets in 4,402 events name at least one company, stock, index, ETF, commodity, FX pair or crypto asset (sports, esports and weather excluded). The full list, with volume, end date and match type, is in `polymarket_asset_linked_markets.csv`.

### 5a. Robinhood Stock Tokens named by open markets

62 of 195 tokens have at least one open market that names them directly. 'Proxy' rows count markets on the underlying index or commodity that a Robinhood ETF tracks. Match-type columns: price = price, close, hit, up/down, market cap, IPO or valuation; earn = earnings or KPI; corp = corporate event (acquisition, bankruptcy, launch, downgrade); mention = mention or ranking markets where the company is incidental (Google search rankings, Spotify charts, 'will Trump say X', best-AI-model rankings).

| Token | Name | Match | Open mkts | Events | Price | Earn | Corp | Mention | 24h vol | 7d vol | Lifetime vol |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GOOGL | Alphabet Class A | direct | 975 | 122 | 102 | 21 | 44 | 756 | $117.7k | $648.0k | $5.80M |
| NFLX | Netflix | direct | 216 | 18 | 65 | 6 | 0 | 144 | $19.6k | $108.9k | $151.3k |
| META | Meta Platforms | direct | 212 | 89 | 88 | 20 | 16 | 48 | $42.9k | $197.3k | $1.03M |
| AAPL | Apple | direct | 177 | 34 | 84 | 30 | 8 | 51 | $27.5k | $382.7k | $2.88M |
| MSFT | Microsoft | direct | 158 | 74 | 88 | 16 | 4 | 22 | $10.1k | $81.7k | $1.43M |
| AMZN | Amazon | direct | 143 | 66 | 92 | 1 | 4 | 22 | $16.2k | $51.3k | $1.35M |
| NVDA | NVIDIA | direct | 143 | 63 | 86 | 10 | 2 | 21 | $32.1k | $226.2k | $1.83M |
| TSLA | Tesla | direct | 112 | 25 | 78 | 1 | 8 | 18 | $57.3k | $212.6k | $1.71M |
| SPCX | Space Exploration Technolog… | direct | 105 | 24 | 92 | 0 | 7 | 1 | $70.1k | $418.7k | $2.70M |
| MU | Micron Technology | direct | 85 | 10 | 69 | 15 | 1 | 0 | $5.3k | $8.9k | $22.3k |
| BABA | Alibaba | direct | 78 | 77 | 6 | 0 | 5 | 30 | $11.6k | $61.3k | $632.4k |
| PLTR | Palantir Technologies | direct | 71 | 7 | 70 | 0 | 1 | 0 | $5.5k | $10.6k | $51.2k |
| USO | United States Oil Fund | proxy | 71 | 18 | 55 | 1 | 0 | 0 | $215.7k | $1.27M | $5.09M |
| TTWO | Take-Two Interactive Softwa… | direct | 67 | 19 | 5 | 9 | 20 | 10 | $234.4k | $732.3k | $2.46M |
| COIN | Coinbase | direct | 49 | 13 | 30 | 5 | 9 | 0 | $12.6k | $22.4k | $525.5k |
| GLD | SPDR Gold Trust | proxy | 49 | 8 | 41 | 5 | 0 | 1 | $32.3k | $167.9k | $3.12M |
| EWY | iShares MSCI South Korea fu… | direct | 44 | 3 | 44 | 0 | 0 | 0 | $15.2k | $44.8k | $77.7k |
| MSTR | Strategy Inc. | direct | 41 | 13 | 30 | 1 | 9 | 0 | $5.3k | $5.7k | $776.4k |
| SPY | SPDR S&P 500 ETF Trust | direct | 39 | 4 | 39 | 0 | 0 | 0 | $37.9k | $109.0k | $188.1k |
| SPY | SPDR S&P 500 ETF Trust | proxy | 38 | 12 | 23 | 6 | 7 | 0 | $29.4k | $40.9k | $826.0k |
| SKHY | SK hynix Inc. American Depo… | direct | 36 | 2 | 36 | 0 | 0 | 0 | $649 | $769 | $1.2k |
| RKLB | Rocket Lab Corporation | direct | 32 | 3 | 32 | 0 | 0 | 0 | $5.6k | $12.2k | $30.9k |
| SLV | iShares Silver Trust | proxy | 32 | 4 | 31 | 0 | 0 | 0 | $10.1k | $49.3k | $149.9k |
| LLY | Eli Lilly | direct | 12 | 4 | 0 | 11 | 1 | 0 | $341 | $2.1k | $12.8k |
| AVGO | Broadcom | direct | 10 | 6 | 5 | 5 | 0 | 0 | $40 | $450 | $23.3k |
| INTC | Intel | direct | 10 | 2 | 0 | 10 | 0 | 0 | $40 | $738 | $2.7k |
| LRCX | Lam Research Corp | direct | 10 | 2 | 0 | 10 | 0 | 0 | $0 | $0 | $11.9k |
| LMT | Lockheed | direct | 8 | 4 | 1 | 6 | 1 | 0 | $46 | $934 | $22.6k |
| DELL | Dell | direct | 7 | 4 | 0 | 4 | 0 | 0 | $163 | $693 | $2.8k |
| CRM | Salesforce | direct | 6 | 1 | 0 | 6 | 0 | 0 | $358 | $2.2k | $4.0k |
| CRWV | CoreWeave | direct | 6 | 2 | 0 | 0 | 6 | 0 | $7.0k | $58.2k | $276.9k |
| IBM | IBM | direct | 6 | 2 | 0 | 6 | 0 | 0 | $91 | $1.4k | $6.9k |
| NET | Cloudflare, Inc. Class A co… | direct | 6 | 3 | 0 | 1 | 0 | 0 | $2.1k | $8.2k | $71.2k |
| QCOM | Qualcomm | direct | 6 | 2 | 0 | 5 | 0 | 1 | $0 | $0 | $1.3k |
| XOM | ExxonMobil Holdings Corpora… | direct | 6 | 2 | 0 | 6 | 0 | 0 | $20 | $252 | $1.9k |
| AMD | AMD | direct | 5 | 1 | 0 | 5 | 0 | 0 | $40 | $186 | $1.4k |
| GE | General Electric | direct | 5 | 1 | 0 | 5 | 0 | 0 | $123 | $2.0k | $8.2k |
| GEV | GE Vernova | direct | 5 | 1 | 0 | 5 | 0 | 0 | $80 | $772 | $1.7k |
| GLW | Corning | direct | 5 | 1 | 0 | 5 | 0 | 0 | $110 | $1.3k | $3.6k |
| KLAC | KLA | direct | 5 | 1 | 0 | 5 | 0 | 0 | $25 | $1.0k | $3.5k |
| SNOW | Snowflake | direct | 5 | 1 | 0 | 5 | 0 | 0 | $5 | $212 | $889 |
| VRT | Vertiv | direct | 5 | 1 | 0 | 5 | 0 | 0 | $264 | $2.8k | $4.7k |
| WDC | Western Digital | direct | 5 | 1 | 0 | 5 | 0 | 0 | $20 | $507 | $2.5k |
| CRWD | CrowdStrike Holdings | direct | 4 | 1 | 0 | 4 | 0 | 0 | $106 | $798 | $1.8k |
| ORCL | Oracle | direct | 3 | 2 | 0 | 0 | 2 | 1 | $2.6k | $2.6k | $2.8k |
| PANW | Palo Alto Networks | direct | 3 | 1 | 0 | 3 | 0 | 0 | $50 | $350 | $666 |
| SMR | NuScale Power | direct | 3 | 1 | 0 | 0 | 3 | 0 | $9.2k | $28.2k | $288.1k |
| BA | Boeing | direct | 2 | 2 | 0 | 1 | 1 | 0 | $10 | $45 | $12.5k |
| CVNA | Carvana | direct | 2 | 2 | 0 | 1 | 1 | 0 | $50 | $1.3k | $8.7k |
| NBIS | Nebius Group | direct | 2 | 2 | 0 | 0 | 1 | 1 | $12 | $334 | $7.96M |
| PFE | Pfizer | direct | 2 | 2 | 0 | 0 | 1 | 0 | $0 | $0 | $11.4k |
| QQQ | Invesco QQQ | proxy | 2 | 2 | 0 | 0 | 0 | 0 | $0 | $0 | $4.4k |
| RBLX | Roblox | direct | 2 | 2 | 1 | 1 | 0 | 0 | $0 | $0 | $2.9k |
| RIVN | Rivian Automotive | direct | 2 | 2 | 0 | 1 | 1 | 0 | $0 | $0 | $984 |
| COST | Costco | direct | 1 | 1 | 1 | 0 | 0 | 0 | $0 | $0 | $10.9k |
| CSCO | Cisco Systems | direct | 1 | 1 | 0 | 0 | 0 | 0 | $0 | $0 | $1.5k |
| DJT | Trump Media & Technology Gr… | direct | 1 | 1 | 1 | 0 | 0 | 0 | $0 | $0 | $29 |
| EWY | iShares MSCI South Korea fu… | proxy | 1 | 1 | 1 | 0 | 0 | 0 | $0 | $0 | $40.5k |
| GME | GameStop | direct | 1 | 1 | 0 | 0 | 1 | 0 | $13.3k | $40.9k | $3.16M |
| IONQ | IonQ | direct | 1 | 1 | 0 | 0 | 1 | 0 | $0 | $0 | $5.3k |
| RDDT | Reddit | direct | 1 | 1 | 0 | 1 | 0 | 0 | $40 | $1.7k | $1.7k |
| SNAP | Snap | direct | 1 | 1 | 0 | 0 | 1 | 0 | $34 | $287 | $151.4k |
| SNDK | Sandisk Corporation | direct | 1 | 1 | 0 | 1 | 0 | 0 | $86 | $949 | $949 |
| SOFI | SoFi Technologies | direct | 1 | 1 | 0 | 1 | 0 | 0 | $0 | $0 | $375 |
| SOUN | SoundHound AI | direct | 1 | 1 | 0 | 0 | 1 | 0 | $0 | $0 | $9.0k |
| TSM | Taiwan Semiconductor Manufa… | direct | 1 | 1 | 0 | 0 | 1 | 0 | $0 | $0 | $18.2k |
| UPS | UPS | direct | 1 | 1 | 0 | 1 | 0 | 0 | $14 | $17 | $17 |
| ZM | Zoom | direct | 1 | 1 | 0 | 0 | 1 | 0 | $0 | $0 | $431.7k |

No open market names the other 133 tokens directly: AAOI, ABCL, ADBE, AEHR, AEIS, ALAB, AMAT, AMBA, AMC, AMKR, ANET, APLD, APP, ASML, ASTS, AUR, AVAV, AXON, AXTI, BB, BE, BND, BULL, CBRS, CCL, CEG, CELH, CIEN, CLOV, CLS, CLSK, COHR, CRCL, CRDO, CTSH, DDOG, DOCN, ELF, EWT, F, FICO, FIG, FISV, FIX, FLNC, FLY, FTNT, FUTU, GLD, GLXY, HII, HIMS, HPE, HWM, IBRX, INDA, INFQ, INOD, INTU, IREN, JBL, JNJ, JOBY, KSS, KTOS, LHX, LITE, LULU, LUNR, MDB, MOD, MPWR, MRNA, MRVL, MTSI, MXL, NAVN, NNE, NOW, NU, NVTS, OKLO, ON, ONTO, OUST, P, PATH, PENG, PL, POET, POWL, PR, PWR, QBTS, QQQ, QUBT, RCAT, RDW, RGTI, RUN, SATS, SCHD, SGOV, SHOP, SHY, SIMO, SLS, SLV, SMCI, SMH, SOXX, SPMO, TE, TEAM, TEM, TER, TSEM, TTD, UMC, UNH, USAR, USO, VICR, VSAT, VST, VTI, WDAY, WULF, WYFI, XLK, XNDU, ZETA, ZS. That includes 15 of the 17 ETFs/funds, some of which have proxy markets on their underlying (see the proxy rows). Robinhood itself (HOOD, not on the token list) has 41 open markets.

### 5b. Crypto, indices, commodities, FX and other companies

**Crypto assets**

| Asset | Open mkts | Events | Price-linked | 24h vol | 7d vol | Lifetime vol |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 853 | 529 | 763 | $1.49M | $5.55M | $93.26M |
| ETH | 774 | 501 | 762 | $451.9k | $1.86M | $20.11M |
| SOL | 694 | 487 | 689 | $50.1k | $224.2k | $2.86M |
| XRP | 683 | 485 | 680 | $57.6k | $125.7k | $1.16M |
| HYPE | 508 | 461 | 491 | $6.5k | $41.4k | $2.66M |
| BNB | 477 | 454 | 474 | $1.6k | $3.5k | $173.8k |
| DOGE | 466 | 452 | 463 | $2.4k | $5.3k | $154.2k |
| ZEC | 408 | 400 | 404 | $176 | $848 | $207.6k |
| LINK | 21 | 2 | 21 | $289 | $788 | $47.7k |
| USDC/stablecoins | 18 | 8 | 6 | $157 | $5.0k | $1.15M |
| PUMP | 15 | 5 | 10 | $2.6k | $5.2k | $407.8k |
| SUI | 9 | 1 | 9 | $143 | $340 | $23.7k |
| LIGHTER | 8 | 1 | 8 | $934 | $14.2k | $353.2k |
| AVAX | 8 | 1 | 8 | $343 | $1.3k | $15.5k |
| ASTER | 7 | 1 | 7 | $8 | $437 | $55.3k |
| MegaETH | 6 | 2 | 5 | $54 | $1.0k | $19.1k |
| XMR | 1 | 1 | 1 | $0 | $0 | $126.0k |

**Indices**

| Asset | Open mkts | Events | Price-linked | 24h vol | 7d vol | Lifetime vol |
|---|---:|---:|---:|---:|---:|---:|
| S&P 500 | 63 | 10 | 61 | $54.2k | $134.3k | $987.2k |
| DXY (dollar index) | 29 | 3 | 29 | $824 | $5.0k | $30.3k |
| Nikkei | 9 | 2 | 9 | $3.9k | $3.9k | $22.0k |
| Hang Seng | 2 | 2 | 2 | $20 | $20 | $20 |
| Dow Jones | 2 | 2 | 1 | $60 | $422 | $422 |
| Nasdaq | 1 | 1 | 0 | $0 | $0 | $3.7k |
| KOSPI | 1 | 1 | 1 | $0 | $0 | $40.5k |
| FTSE | 1 | 1 | 1 | $0 | $0 | $0 |
| DAX | 1 | 1 | 1 | $42 | $42 | $37 |
| Russell 2000 | 1 | 1 | 1 | $185 | $185 | $185 |
| NYSE Composite | 1 | 1 | 1 | $0 | $0 | $0 |

**Commodities**

| Asset | Open mkts | Events | Price-linked | 24h vol | 7d vol | Lifetime vol |
|---|---:|---:|---:|---:|---:|---:|
| Crude oil | 103 | 26 | 73 | $394.9k | $2.76M | $7.05M |
| Gold | 49 | 8 | 41 | $32.3k | $167.9k | $3.12M |
| Silver | 32 | 4 | 31 | $10.1k | $49.3k | $149.9k |
| Natural gas | 18 | 5 | 17 | $13.9k | $17.7k | $21.0k |
| Gasoline (US gas price) | 14 | 4 | 12 | $331 | $382 | $19.8k |
| Copper | 2 | 1 | 2 | $0 | $0 | $16.6k |

**FX**

| Asset | Open mkts | Events | Price-linked | 24h vol | 7d vol | Lifetime vol |
|---|---:|---:|---:|---:|---:|---:|
| FX pairs | 73 | 20 | 73 | $258 | $848 | $250.3k |

**Other companies (not Robinhood tokens; top 20)**

| Asset | Open mkts | Events | Price-linked | 24h vol | 7d vol | Lifetime vol |
|---|---:|---:|---:|---:|---:|---:|
| Spotify | 508 | 14 | 0 | $37.1k | $135.1k | $2.62M |
| OpenAI (private) | 275 | 129 | 119 | $63.9k | $527.5k | $13.77M |
| Anthropic (private) | 259 | 107 | 135 | $452.8k | $2.10M | $19.79M |
| ByteDance/TikTok | 99 | 82 | 25 | $3.0k | $7.1k | $634.9k |
| DeepSeek | 75 | 70 | 6 | $14.4k | $45.7k | $495.2k |
| Tencent | 69 | 69 | 0 | $1.5k | $2.6k | $107.2k |
| Mistral | 62 | 59 | 2 | $427 | $3.8k | $446.8k |
| Xiaomi | 62 | 62 | 0 | $6.1k | $14.2k | $165.6k |
| Opendoor (OPEN) | 59 | 6 | 59 | $6.8k | $11.6k | $23.2k |
| Robinhood (HOOD) | 41 | 7 | 32 | $7.8k | $18.3k | $92.2k |
| Stripe (private) | 38 | 13 | 36 | $704 | $1.3k | $741.4k |
| Kraken (private) | 34 | 11 | 28 | $797 | $5.4k | $1.57M |
| Airbnb (ABNB) | 34 | 3 | 34 | $5.6k | $19.3k | $38.9k |
| Databricks (private) | 32 | 10 | 32 | $1.1k | $3.4k | $1.23M |
| Perplexity | 32 | 11 | 29 | $249 | $2.8k | $2.83M |
| xAI (private) | 25 | 13 | 2 | $5.4k | $18.4k | $395.4k |
| JPMorgan | 19 | 5 | 4 | $13 | $13 | $27.2k |
| Neuralink | 17 | 5 | 17 | $86 | $447 | $98.2k |
| Discord | 16 | 6 | 13 | $1.8k | $4.5k | $866.4k |
| Polymarket | 11 | 2 | 6 | $1.2k | $3.6k | $71.1k |

Crypto counts include the pre-listed up/down instances: each of the 8 up/down assets has about 450 open markets at any moment, mostly 5-minute and 15-minute instances for the next 24 hours. Lifetime volume for BTC is dominated by the yearly and monthly 'What price will Bitcoin hit' ladders. Crude oil markets include Hormuz-linked combos ('Will oil be below $85 on November 2 and the Democrats win the Senate?'), which are effectively conditional markets of the kind Probabl lists.

## 6. Caveats

- **Snapshot timing.** Tuesday 06:34-07:00 UTC (late Monday evening in the US), after a weekend with NFL, college football, European soccer and the League of Legends Worlds play-in, and a Monday Night Football game. Sports and esports 24h figures reflect that weekend; the 7-day and 30-day figures are steadier.
- **Shares, not dollars.** See 'How to read the volume numbers'. Liquidity and open interest are Gamma fields whose exact definitions are not documented. Treat them as relative measures.
- **Unrecorded 5-minute volume.** Gamma's event and market volume fields are missing for many closed 5-minute crypto instances (13% of BTC 5m, 50-93% for the other assets). The corrections come from 15 sampled instances per series, so they are rough (about ±30%).
- **Resolved-event coverage.** Resolved events were selected by `endDate` from 2026-09-20 onward, plus closed events with future end dates, and then filtered on `closedTime`. A few events that ended before 2026-09-20 but closed after it are missed (mostly weather instances that close 1-2 days after their end date). The first day of the 30-day window is therefore slightly under-filled.
- **Lifetime vs window.** Per-instance volume is lifetime volume. For instances listed 1-2 days ahead (crypto, weather) that is close to window volume. For sports games listed up to several weeks ahead, it includes pre-game trading.
- **Categories are ours.** They are derived from tags and differ from Polymarket's navigation. Mixed events (for example 'Who wins the Senate pending oil below $85') go to the first matching rule, here politics. Polymarket's fee type per market is an independent check (table 1d).
- **Entity matching is regex-based.** We kept false positives low: no ambiguous short tickers such as F, ON, NET, NOW or RUN without context, no sports team names, and uranium only in a price context. Some misses remain, for example markets that name only a CEO or product. Mention and ranking matches are labelled so they can be excluded.
- **Comment counts** live mostly on series, so the event-level top-30 under-represents recurring products.

## Files

- `polymarket_active_events.csv`: every open event: category, tags, dates, horizon, markets, volumes, liquidity, OI, comments, series, fee types
- `polymarket_categories.csv`: category table, open snapshot (24h, 7d, 30d, lifetime)
- `polymarket_all_trading_24h_estimate.csv`: 24h all-trading estimate by category (series-based)
- `polymarket_all_trading_window_estimates.csv`: 24h and 7d all-trading estimates by category, with upper bound
- `polymarket_sports_leagues.csv`: open snapshot by league or esports title
- `polymarket_top_lists.csv`: top 50 by 24h, 7d, lifetime volume and liquidity; top 30 by comments
- `polymarket_top15_per_category.csv`: top 15 per category by 7-day volume
- `polymarket_series_24h.csv`: all 2,504 open series with platform 24h volume
- `polymarket_horizon.csv`: open events by time to end date
- `polymarket_resolved30d_by_duration.csv`: resolved events (30d) by listing duration
- `polymarket_resolved30d_by_category.csv`: resolved events (30d) by category x duration
- `polymarket_short_term_families.csv`: family summary: cadence, open count, per-instance median/p90, daily volume, liquidity, spread, fee, resolution
- `polymarket_short_term_series.csv`: the same per series (1,092 series)
- `polymarket_short_term_sports_leagues.csv`: sports and esports by league: games, per-game volume, liquidity, spread
- `polymarket_zero_volume_check.csv`: fills behind zero-volume closed events; corrected 5m and 15m crypto volumes
- `polymarket_asset_linked_markets.csv`: every open market naming a company, stock, index, ETF, commodity, FX pair or crypto asset
- `polymarket_rh_token_counts.csv`: open markets per Robinhood Stock Token (direct and proxy), by match type
- `polymarket_asset_group_counts.csv`: open markets per crypto asset, index, commodity, FX pair and other company

Raw data (not in git): `/Volumes/T9/tmp-probabl/market-research/polymarket/raw/` (`active_events.json` 1.76 GB, `closed/*.jsonl` 160,508 events, `series_closed_false.json`, `tags.json`, `fee_types.json`, `crypto_market_configs.json`, `openapi.json`, `dataapi/` fill samples). Scripts: `scripts/fetch_active.py`, `fetch_closed.py`, `fetch_series_tags.py`, `build_tables.py`, `analyze_active.py`, `analyze_closed.py`, `families_merge.py`, `zero_vol_check.py`, `render_report.py`, `common.py`, `families.py`, `pmhttp.py`.
