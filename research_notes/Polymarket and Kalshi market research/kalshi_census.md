# Kalshi census — snapshot 2026-10-20 06:40 UTC

Factual, quantitative census of Kalshi built from the public trade API (`https://api.elections.kalshi.com/trade-api/v2`, no key). Raw data and scripts: `/Volumes/T9/tmp-probabl/market-research/kalshi/`. Prepared 2026-10-20 for Probabl (conditional stock markets on Robinhood Chain).

## Key numbers

- **Inventory at the snapshot (2026-10-20 06:40 UTC):** 15,225 series listed; 13,819 open events holding 131,777 active (non-combo) markets. Open interest 1,200,528,788 contracts (≈ $1.2B of $1 payouts). Lifetime volume of the open markets 2,007,524,982 contracts.
- **24h volume:** markets still open at the snapshot traded 56,687,210 contracts in the prior 24 hours, but markets that *closed* in those 24 hours traded 819,902,667. All in, about 876,589,877 contracts traded in the 24h window, and **93.5% of it was in markets that resolved inside the same 24 hours**.
- **Throughput (settled markets, non-combo):** last 7 complete UTC days 6,883,187,119 contracts (983,312,446/day); last 30 days 27,991,138,985 contracts (933,037,966/day). Converted with trade samples, that is roughly **$454.9M/day of taker-paid premium** over the last 7 days (Polymarket-style notional; see Units).
- **Where the volume is (settled, 30d, contracts):** sports 57.6%, crypto 36.8%, financials 4.5%, everything else 1.2%. Markets that lived under 24 hours carried 54.9% of 30-day settled volume (15-minute markets alone: 36.8%).
- **Where the open interest is (snapshot):** politics/elections 44.9% and sports 42.3% of 1,200,528,788 contracts; financials 2.0%, crypto 2.3%, economy/Fed 2.5%.
- **The single biggest recurring product is the 15-minute BTC up/down market** (`KXBTC15M`): one instance every 15 minutes (94.93 settled per day on average over 30 days), median 2,817,329 contracts per instance, 263,436,419 contracts/day (30-day average).
- **Asset-linked open markets:** 14,100 markets in 690 events reference a company, index, commodity, rate/FX or crypto asset. 78 of the 195 Robinhood Stock Tokens have at least one directly linked open market, 11 more only through an index/commodity/rates proxy. Kalshi lists **no single-stock price markets**; company markets are KPIs, earnings-call mentions and corporate events.

## Method and units

**Pulls (all UTC, 2026-10-20 unless noted)**

| Data | Endpoint | Time | Rows |
|:--|:--|:--|--:|
| All series (category, tags, frequency, fee type, settlement sources) | `/series` | 06:32:55 | 15,225 |
| Open events with nested markets (primary snapshot) | `/events?status=open&with_nested_markets=true` | 06:32 → 06:40:37 | 13,819 events, 131,777 active markets |
| Open markets, combos excluded (cross-check) | `/markets?status=open&mve_filter=exclude` | 06:47:22 → 06:53:33 | 131,791 (totals within 0.2% of the nested pull) |
| Settled markets by close day, combos excluded | `/markets?status=settled&min_close_ts&max_close_ts&mve_filter=exclude` | files written 06:50–07:06 | 2,615,298 markets closing 2026-09-20 → 2026-10-20 |
| Settled history for monthly/weekly release series (CPI, jobs, Fed, claims, TSA, Billboard, Netflix) | `/markets?series_ticker=…&status=settled` | 07:03 | back to mid-Aug 2026 (the API's historical cutoff is 2026-08-20; older data sits in `/historical`) |
| Trade samples to price contracts | `/markets/trades?ticker=…` | 07:05 → 07:53 | 379 series, up to 6 markets each |
| Live order books for short-term series | `/markets/{ticker}/orderbook` | 07:16 → 07:28 | 267 books |
| Combo (MVE) settled markets, two 1-hour probes | `/markets?status=settled&mve_filter=only` | finished 07:21 | see Caveats |

Requests were throttled to well under 8 per second in total, gzip-compressed, with exponential back-off on 429/5xx and dropped connections (a few dozen retries; one trade-sampling worker died on a truncated response and was restarted from its cache).

**Units.** Kalshi reports `volume_fp`, `volume_24h_fp` and `open_interest_fp` in **contracts** (fractional contracts allowed). Every contract pays $1.00 to the winning side (`notional_value_dollars` = 1.0), so *contracts = dollars of face value*. One traded contract moves $1.00 of collateral in total: the YES buyer pays the YES price p and the NO side pays 1 − p. Face value therefore overstates the cash that changes hands, badly so when prices sit near 0 or 1 (a 0.1¢ contract counts the same as a 50¢ contract). Three dollar measures are used:

1. **Contracts (= $ face value)**: Kalshi's own unit; used for every table unless labelled otherwise.
2. **YES-side $ at last price** (open snapshot only): Σ 24h contracts × last YES price. A rough indicator; the NO side paid the complement.
3. **Estimated taker $** (settled throughput): contracts × the series' *taker premium per contract*, measured from trade prints: Σ(count × price the taker paid) / Σ count, over markets drawn with probability proportional to volume (up to 6 per series; 379 series covering 97% of 7-day settled volume; unsampled series use their category×frequency average). This matches the usual "$ volume" convention of share-based venues such as Polymarket (shares × price paid). Volume-weighted average across the sample: taker 0.462 $/contract, YES side 0.422, cheaper side 0.173.

**Category mapping.** Each event carries its series' Kalshi category. Mapping: Elections + Politics → politics/elections, except titles naming wars, ceasefires, Ukraine/Russia, Israel/Gaza/Iran, Taiwan, sanctions, Hormuz, Greenland etc. → geopolitics/war (unless the title is about an election); World → geopolitics/war on the same keywords, weather/macro titles to those categories, the rest → other; Economics → economy/Fed/macro (Treasury, SOFR and FX titles → financials); Financials + Companies + Commodities + Business → financials; Crypto → crypto; Science and Technology → tech/AI/science; Sports (+ Exotics with sports tags) → sports, by the event's `product_metadata.competition`; Climate and Weather → weather/climate; Entertainment + Culture + Social → culture/entertainment; Mentions → mentions; Health, Transportation, Education → other. Combo markets (multivariate events, `KXMVE…`) are excluded from all tables and discussed separately.

**Horizon.** Time to resolution = min(`close_time`, `expected_expiration_time`) − snapshot time. Sports markets keep a `close_time` up to two weeks after the game (they close early when it ends), while economic markets close shortly before the release, so neither field alone works. A table on `close_time` alone is given too.

## 1. Snapshot inventory

Series by Kalshi's `frequency` label (labels are loose: e.g. `KXBTCD` is labelled hourly but also lists daily strikes; most sports game series are `custom`).

| Series frequency label | Series listed | Series with open events | Open events |
|:--|--:|--:|--:|
| one_off | 6,269 | 2,224 | 5,562 |
| custom | 6,153 | 1,485 | 6,661 |
| annual | 1,538 | 536 | 823 |
| monthly | 470 | 173 | 264 |
| weekly | 337 | 72 | 157 |
| daily | 331 | 82 | 241 |
| hourly | 78 | 26 | 72 |
| fifteen_min | 34 | 22 | 22 |
| quarterly | 15 | 13 | 17 |

## 2. Category breakdown

### 2a. Open snapshot (2026-10-20 06:40 UTC)

| Category | Events | Markets | 24h vol (contracts) | 24h share | Open interest (contracts) | OI share | Lifetime vol (contracts) | Vol share | 24h YES-side $ at last price |
|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| politics/elections | 4,310 | 28,390 | 12,757,753 | 22.5% | 539,254,443 | 44.9% | 895,443,483 | 44.6% | 3,294,428 |
| geopolitics/war | 74 | 323 | 478,448 | 0.8% | 11,435,530 | 0.9% | 39,778,493 | 2.0% | 43,499 |
| economy/Fed/macro | 550 | 4,578 | 1,254,964 | 2.2% | 29,594,647 | 2.5% | 95,050,368 | 4.7% | 453,785 |
| financials | 794 | 12,221 | 1,044,438 | 1.8% | 23,577,643 | 2.0% | 52,794,793 | 2.6% | 443,840 |
| crypto | 108 | 4,631 | 2,277,871 | 4.0% | 27,475,276 | 2.3% | 100,632,425 | 5.0% | 1,097,388 |
| tech/AI/science | 165 | 1,062 | 648,098 | 1.1% | 25,828,857 | 2.1% | 63,892,309 | 3.2% | 285,428 |
| sports | 6,730 | 68,094 | 35,008,362 | 61.8% | 508,090,377 | 42.3% | 692,333,875 | 34.5% | 12,253,689 |
| weather/climate | 213 | 1,209 | 1,197,952 | 2.1% | 2,248,522 | 0.2% | 4,746,893 | 0.2% | 247,827 |
| culture/entertainment | 739 | 9,100 | 1,348,977 | 2.4% | 31,230,200 | 2.6% | 59,606,169 | 3.0% | 584,387 |
| mentions | 121 | 2,141 | 665,917 | 1.2% | 1,301,511 | 0.1% | 1,635,979 | 0.1% | 174,785 |
| other | 15 | 28 | 4,431 | 0.0% | 491,782 | 0.0% | 1,610,194 | 0.1% | 438 |
| **Total** | 13,819 | 131,777 | 56,687,210 | 100% | 1,200,528,788 | 100% | 2,007,524,982 | 100% | 18,879,494 |

Kalshi's own categories, before mapping:

| Kalshi category (API) | Events | Markets | 24h vol | Open interest | Lifetime vol | Mapped to |
|:--|--:|--:|--:|--:|--:|:--|
| Sports | 6,730 | 68,094 | 35,008,362 | 508,090,377 | 692,333,875 | sports |
| Elections | 3,648 | 25,820 | 11,180,137 | 508,058,032 | 818,672,087 | politics/elections |
| Crypto | 108 | 4,631 | 2,277,871 | 27,475,276 | 100,632,425 | crypto |
| Politics | 736 | 2,893 | 2,056,063 | 42,631,941 | 116,549,890 | politics/elections |
| Entertainment | 732 | 9,066 | 1,348,838 | 31,192,488 | 59,503,849 | culture/entertainment |
| Economics | 560 | 4,654 | 1,261,896 | 29,824,502 | 95,740,058 | economy/Fed/macro |
| Climate and Weather | 213 | 1,209 | 1,197,952 | 2,248,522 | 4,746,893 | weather/climate |
| Mentions | 121 | 2,141 | 665,917 | 1,301,511 | 1,635,979 | mentions |
| Science and Technology | 165 | 1,062 | 648,098 | 25,828,857 | 63,892,309 | tech/AI/science |
| Financials | 648 | 10,154 | 617,518 | 20,429,631 | 44,739,754 | financials |
| Commodities | 58 | 1,452 | 349,139 | 1,420,382 | 2,798,001 | financials |
| Companies | 77 | 538 | 70,848 | 1,497,774 | 4,567,320 | financials |
| Health | 6 | 12 | 4,127 | 325,254 | 1,174,397 | other |
| AI | 5 | 8 | 225 | 32,740 | 77,126 | other |
| Social | 7 | 34 | 139 | 37,712 | 102,320 | culture/entertainment |
| World | 3 | 7 | 78 | 132,553 | 352,566 | other |
| Transportation | 1 | 1 | 0 | 1,235 | 6,106 | other |
| Business | 1 | 1 | 0 | 0 | 27 | financials |

Sports by league (open snapshot):

| League / sport | Events | Markets | 24h vol | Open interest | Lifetime vol |
|:--|--:|--:|--:|--:|--:|
| Tennis | 707 | 2,091 | 8,859,079 | 5,261,904 | 10,485,596 |
| NFL | 557 | 11,743 | 8,019,488 | 264,510,015 | 347,154,029 |
| Soccer: UEFA club comps | 468 | 2,598 | 5,350,190 | 10,732,152 | 12,681,514 |
| NCAA football | 1,100 | 15,490 | 2,898,019 | 92,358,828 | 120,682,563 |
| NBA | 552 | 9,125 | 2,663,374 | 50,214,048 | 68,618,094 |
| Cricket | 61 | 134 | 1,517,275 | 1,119,470 | 2,052,321 |
| MLB | 150 | 1,878 | 1,258,088 | 27,359,713 | 44,854,118 |
| Golf | 29 | 1,730 | 1,118,908 | 2,253,365 | 3,246,425 |
| Soccer: FIFA/World Cup & awards | 19 | 394 | 640,885 | 11,045,288 | 17,768,664 |
| Soccer: La Liga | 63 | 391 | 368,783 | 1,532,334 | 1,946,523 |
| Soccer: other | 742 | 3,104 | 297,861 | 725,970 | 1,014,065 |
| Soccer: Liga MX | 185 | 973 | 293,398 | 968,994 | 1,772,904 |
| Esports | 502 | 1,218 | 258,047 | 965,018 | 1,076,643 |
| NCAA basketball | 205 | 8,044 | 225,241 | 10,496,525 | 13,281,900 |
| Motorsport | 33 | 859 | 176,978 | 9,825,875 | 18,094,925 |
| Baseball: other | 6 | 33 | 169,360 | 182,368 | 214,355 |
| Soccer: Premier League | 92 | 756 | 165,978 | 4,997,991 | 6,721,688 |
| WNBA | 31 | 302 | 165,580 | 2,067,725 | 3,263,088 |
| UFC/MMA | 14 | 28 | 159,649 | 464,947 | 532,631 |
| NHL | 324 | 2,458 | 156,446 | 4,722,162 | 5,394,554 |
| Combat sports | 65 | 632 | 47,480 | 1,926,196 | 3,935,628 |
| Soccer: MLS | 104 | 443 | 43,919 | 1,823,167 | 2,913,964 |
| Soccer: Serie A | 67 | 386 | 39,961 | 273,626 | 341,595 |
| Basketball: other | 117 | 416 | 31,562 | 36,082 | 44,057 |
| Table tennis | 80 | 160 | 14,468 | 22,636 | 29,255 |

Financials by subtype (open snapshot):

| Financials subtype | Events | Markets | 24h vol | Open interest | Lifetime vol |
|:--|--:|--:|--:|--:|--:|
| commodities | 76 | 1,549 | 366,628 | 5,311,626 | 13,374,698 |
| companies/other | 280 | 3,094 | 295,987 | 4,357,158 | 12,198,361 |
| indices | 56 | 3,805 | 129,141 | 10,682,320 | 16,810,603 |
| earnings/KPIs | 304 | 2,671 | 115,715 | 1,610,827 | 5,073,640 |
| IPOs | 18 | 159 | 74,803 | 1,366,022 | 4,213,277 |
| rates | 40 | 640 | 42,606 | 216,374 | 533,310 |
| FX | 20 | 303 | 19,556 | 33,315 | 590,904 |

### 2b. All trading in the 24 hours before the snapshot

The open snapshot misses every market that already closed. Adding the 24h volume of the 85,507 markets that closed in the 24 hours before the snapshot changes the picture completely (`volume_24h_fp` of those markets as read when the settled files were pulled, 06:50–07:06 UTC, so their 24h window is shifted by under an hour):

| Category | Open markets, 24h vol | Closed in prior 24h, 24h vol | All markets, 24h vol | Share |
|:--|--:|--:|--:|--:|
| sports | 35,008,362 | 386,472,415 | 421,480,777 | 48.1% |
| crypto | 2,277,871 | 374,996,552 | 377,274,423 | 43.0% |
| financials | 1,044,438 | 55,512,927 | 56,557,365 | 6.5% |
| politics/elections | 12,757,753 | 430,938 | 13,188,691 | 1.5% |
| mentions | 665,917 | 1,477,123 | 2,143,040 | 0.2% |
| weather/climate | 1,197,952 | 935,436 | 2,133,388 | 0.2% |
| culture/entertainment | 1,348,977 | 55,879 | 1,404,856 | 0.2% |
| economy/Fed/macro | 1,254,964 | 1 | 1,254,965 | 0.1% |
| tech/AI/science | 648,098 | 21,395 | 669,493 | 0.1% |
| geopolitics/war | 478,448 | 0 | 478,448 | 0.1% |
| other | 4,431 | 0 | 4,431 | 0.0% |
| **Total** | 56,687,210 | 819,902,667 | 876,589,877 | 100% |

Largest events that closed in that window (Monday Night Football, WAS @ SF, and the 15-minute BTC markets dominate):

| # | Event (closed in the 24h before snapshot) | Category | 24h vol (contracts) |
|--:|:--|:--|--:|
| 1 | KXNFLGAME-26OCT19WASSF — San Francisco wins | sports | 76,867,619 |
| 2 | KXNFLSPREAD-26OCT19WASSF — San Francisco wins by over 14.5 points? | sports | 20,684,155 |
| 3 | KXMLBGAME-26OCT192008CLETB — Cleveland wins | sports | 14,753,079 |
| 4 | KXNFLTD-26OCT19WASSF — Jacory Croskey-Merritt: 1+ touchdowns | sports | 10,447,401 |
| 5 | KXWTAMATCH-26OCT18ANNJON — Ann Li wins | sports | 7,087,153 |
| 6 | KXNFLTOTAL-26OCT19WASSF — Full Game: over 29.5 points scored? | sports | 6,278,980 |
| 7 | KXEPLGAME-26OCT19TOTCOV — Coventry wins | sports | 6,263,165 |
| 8 | KXBTC15M-26OCT200030 — BTC price up in next 15 mins? | crypto | 4,915,887 |
| 9 | KXNFLFIRSTTD-26OCT19WASSF — Jacory Croskey-Merritt: 1st Touchdown | sports | 4,903,001 |
| 10 | KXWNBAGAME-26OCT19ATLGS — Atlanta wins | sports | 4,833,167 |
| 11 | KXBTC15M-26OCT192030 — BTC price up in next 15 mins? | crypto | 4,795,495 |
| 12 | KXATPCHALLENGERMATCH-26OCT19ANTPED — Michael Antonius wins | sports | 4,663,037 |
| 13 | KXBTC15M-26OCT191015 — BTC price up in next 15 mins? | crypto | 4,531,156 |
| 14 | KXBTC15M-26OCT191345 — BTC price up in next 15 mins? | crypto | 4,446,118 |
| 15 | KXBTC15M-26OCT200115 — BTC price up in next 15 mins? | crypto | 4,414,018 |

### 2c. Settled throughput by category (30 days)

| Category | Markets settled | Volume (contracts) | Share | Per day (contracts) | Est. taker $ | $ share | Est. taker $/day |
|:--|--:|--:|--:|--:|--:|--:|--:|
| sports | 443,146 | 16,117,047,793 | 57.6% | 537,234,926 | 7,373,744,674 | 56.9% | 245,791,489 |
| crypto | 1,804,746 | 10,287,540,996 | 36.8% | 342,918,033 | 4,836,083,335 | 37.3% | 161,202,778 |
| financials | 261,265 | 1,258,603,180 | 4.5% | 41,953,439 | 591,472,273 | 4.6% | 19,715,742 |
| weather/climate | 38,554 | 114,983,285 | 0.4% | 3,832,776 | 44,173,699 | 0.3% | 1,472,457 |
| economy/Fed/macro | 23,479 | 56,214,474 | 0.2% | 1,873,816 | 38,657,713 | 0.3% | 1,288,590 |
| politics/elections | 2,230 | 47,969,413 | 0.2% | 1,598,980 | 23,951,809 | 0.2% | 798,394 |
| culture/entertainment | 7,763 | 44,347,157 | 0.2% | 1,478,239 | 31,898,910 | 0.2% | 1,063,297 |
| mentions | 3,661 | 38,621,334 | 0.1% | 1,287,378 | 9,330,787 | 0.1% | 311,026 |
| tech/AI/science | 2,082 | 18,301,320 | 0.1% | 610,044 | 8,463,837 | 0.1% | 282,128 |
| geopolitics/war | 145 | 7,510,034 | 0.0% | 250,334 | 3,473,176 | 0.0% | 115,773 |

## 3. Top events

Events are aggregated over their active markets at the snapshot. Contracts throughout.

### 3a. Top 50 by 24h volume

| # | Event | Category / sub | Mkts | 24h vol | Open interest | Lifetime vol | First close (UTC) |
|--:|:--|:--|--:|--:|--:|--:|:--|
| 1 | 2027 Pro Football Champion `KXSB-27` | sports / NFL | 32 | 2,981,312 | 146,456,115 | 191,641,197 | 2027-02-14 |
| 2 | PSG vs Barcelona `KXUCLGAME-26OCT20PSGBAR` | sports / Soccer: UEFA club comps | 3 | 2,176,121 | 2,984,025 | 3,222,619 | 2026-10-20 |
| 3 | 2028 Democratic presidential nominee `KXPRESNOMD-28` | politics/elections | 52 | 1,880,007 | 161,546,185 | 244,207,065 | 2028-11-07 |
| 4 | 2026 Midterms: Congress Balance of Power? `KXBALANCEPOWERCOMBO-27FEB` | politics/elections | 4 | 1,644,412 | 33,439,606 | 43,897,198 | 2027-02-01 |
| 5 | Putintseva vs Shnaider `KXWTAMATCH-26OCT19PUTSHN` | sports / Tennis | 2 | 1,616,877 | 872,681 | 1,746,286 | 2026-10-20 |
| 6 | Bejlek vs Parks `KXWTAMATCH-26OCT20BEJPAR` | sports / Tennis | 2 | 1,478,379 | 643,988 | 1,679,706 | 2026-10-20 |
| 7 | Badosa vs Ruzic `KXWTAMATCH-26OCT18BADRUZ` | sports / Tennis | 2 | 1,314,645 | 563,822 | 1,531,503 | 2026-10-19 |
| 8 | Butterfield Bermuda Championship Winner `KXPGATOUR-BUBC26` | sports / Golf | 118 | 1,060,065 | 1,019,888 | 1,060,130 | 2026-10-25 |
| 9 | Texas Senate winner? `SENATETX-26` | politics/elections | 2 | 1,010,326 | 22,490,995 | 31,248,852 | 2027-01-04 |
| 10 | Pro Baseball Champion `KXMLB-26` | sports / MLB | 2 | 984,444 | 10,109,641 | 17,354,713 | 2026-11-01 |
| 11 | Which party will win the U.S. House? `CONTROLH-2026` | politics/elections | 2 | 971,827 | 44,267,901 | 61,395,698 | 2027-02-01 |
| 12 | Ribecai vs Vasami `KXATPCHALLENGERMATCH-26OCT19RIBVAS` | sports / Tennis | 2 | 964,833 | 337,390 | 964,996 | 2026-10-19 |
| 13 | Sydney Thunder Women vs Sydney Sixers Women `KXWT20MATCH-26OCT192330SS-WST-W` | sports / Cricket | 2 | 898,893 | 431,587 | 1,085,327 | 2026-10-20 |
| 14 | Samrej vs Noguchi `KXATPCHALLENGERMATCH-26OCT20SAMNOG` | sports / Tennis | 2 | 828,541 | 429,319 | 935,696 | 2026-10-20 |
| 15 | 2027 Pro Basketball Champion `KXNBA-27` | sports / NBA | 30 | 807,299 | 30,850,153 | 39,815,943 | 2027-07-31 |
| 16 | Uchijima vs Shibahara `KXWTAMATCH-26OCT18UCHSHI` | sports / Tennis | 2 | 723,329 | 328,368 | 791,855 | 2026-10-19 |
| 17 | College Football National Championship Winner `KXNCAAF-27` | sports / NCAA football | 52 | 720,878 | 45,954,306 | 62,263,254 | 2027-01-26 |
| 18 | NFC East Division Winner `KXNFLNFCEAST-27` | sports / NFL | 4 | 706,496 | 2,684,516 | 5,521,417 | 2027-01-11 |
| 19 | Who will win the Ballon d'Or in 2026? `KXBALLONDOR-26` | sports / Soccer: FIFA/World Cup & awards | 17 | 633,455 | 10,406,089 | 16,590,032 | 2026-12-31 |
| 20 | BTC price on Oct 20, 2026 at 3am EDT? `KXBTCD-26OCT2003` | crypto | 188 | 490,482 | 282,003 | 614,763 | 2026-10-20 |
| 21 | US gas prices this week `KXAAAGASW-26OCT26` | economy/Fed/macro | 21 | 487,298 | 95,226 | 487,310 | 2026-10-26 |
| 22 | Stuttgart vs Atletico `KXUCLGAME-26OCT20VFBATM` | sports / Soccer: UEFA club comps | 3 | 470,376 | 526,139 | 554,705 | 2026-10-20 |
| 23 | Who will be Trump's next Press Secretary? `KXNEXTPRESSECPERM-29JAN20` | politics/elections | 60 | 455,480 | 1,519,909 | 2,021,157 | 2029-01-27 |
| 24 | MVP Winner? `KXNFLMVP-27` | sports / NFL | 49 | 425,037 | 29,593,288 | 35,705,585 | 2027-03-14 |
| 25 | Paris Saint-Germain vs FC Barcelona: Correct Score `KXUCLSCORE-26OCT20PSGBAR` | sports / Soccer: UEFA club comps | 42 | 418,246 | 434,695 | 437,274 | 2026-10-20 |
| 26 | 2028 U.S. Presidential Election winner? `KXPRESPERSON-28` | politics/elections | 32 | 401,805 | 52,079,034 | 75,194,315 | 2029-01-21 |
| 27 | Pro Football Championship Game Matchup `KXNFLMATCHUP-27SB` | sports / NFL | 256 | 391,905 | 9,259,831 | 10,332,081 | 2027-02-14 |
| 28 | New York Governor winner? `GOVPARTYNY-26` | politics/elections | 2 | 353,075 | 3,166,409 | 3,900,983 | 2027-01-01 |
| 29 | California Governor winner? (Person) `KXGOVCA-26` | politics/elections | 2 | 340,904 | 9,679,124 | 19,298,164 | 2027-01-06 |
| 30 | Trump's RCP approval average on Oct 20, 2026? `KXTRUMPAPPROVE-26OCT20` | politics/elections | 9 | 332,921 | 155,174 | 333,386 | 2026-10-20 |
| 31 | Barcelona vs Real Madrid `KXLALIGAGAME-26OCT25BARRMA` | sports / Soccer: La Liga | 3 | 330,195 | 867,680 | 981,402 | 2026-10-25 |
| 32 | BTC price on Oct 23, 2026 at 5pm EDT? `KXBTCD-26OCT2317` | crypto | 50 | 326,481 | 482,733 | 1,063,231 | 2026-10-23 |
| 33 | BTC price on Oct 20, 2026 at 5pm EDT? `KXBTCD-26OCT2017` | crypto | 80 | 324,990 | 182,466 | 325,210 | 2026-10-20 |
| 34 | Kansas City vs Seattle `KXNFLGAME-26OCT25KCSEA` | sports / NFL | 2 | 323,078 | 512,065 | 550,240 | 2026-10-26 |
| 35 | New England vs Chicago `KXNFLGAME-26OCT22NECHI` | sports / NFL | 2 | 316,735 | 424,328 | 484,527 | 2026-10-23 |
| 36 | South Africa vs Australia `KXTESTMATCH-26OCT180400AUSSA` | sports / Cricket | 3 | 314,907 | 339,443 | 545,665 | 2026-10-23 |
| 37 | When will traffic at the Strait of Hormuz return to no… `KXHORMUZNORM-26MAR17` | geopolitics/war | 17 | 311,955 | 3,630,300 | 10,243,145 | 2026-11-03 |
| 38 | Yamasaki vs Tomida `KXITFMATCH-26OCT19YAMTOM` | sports / Tennis | 2 | 304,023 | 144,980 | 341,065 | 2026-10-20 |
| 39 | How many Senate seats will Democrats hold after the Mi… `KXDSENATESEATS-27` | politics/elections | 10 | 302,943 | 3,862,194 | 5,332,781 | 2027-02-01 |
| 40 | Manchester City vs AEK Athens `KXUCLGAME-26OCT20MCIAEK` | sports / Soccer: UEFA club comps | 3 | 301,535 | 711,937 | 854,541 | 2026-10-20 |
| 41 | Where will it rain on Oct 19, 2026? `KXRAIN-26OCT19` | weather/climate | 7 | 296,806 | 133,384 | 336,980 | 2026-10-20 |
| 42 | New England vs Chicago: Total Points `KXNFLTOTAL-26OCT22NECHI` | sports / NFL | 19 | 269,290 | 271,464 | 274,774 | 2026-10-23 |
| 43 | Will Bitcoin be above $200k by 2027? `KXBTC2026200-27JAN01` | crypto | 1 | 268,882 | 4,617,889 | 12,241,569 | 2027-01-01 |
| 44 | Liverpool vs Villarreal `KXUCLGAME-26OCT20LFCVIL` | sports / Soccer: UEFA club comps | 3 | 265,339 | 342,550 | 354,755 | 2026-10-20 |
| 45 | Maine Senate winner? `SENATEME-26` | politics/elections | 2 | 261,818 | 3,871,903 | 9,307,013 | 2027-01-04 |
| 46 | Philadelphia vs New York `KXNBAGAME-26OCT20PHINYK` | sports / NBA | 2 | 260,540 | 387,564 | 472,697 | 2026-10-21 |
| 47 | Bronny James' Next Team Before Oct 23, 2026 `KXNEXTTEAMNBA-26BJAMES9` | sports / NBA | 31 | 242,802 | 1,132,847 | 2,053,350 | 2026-10-23 |
| 48 | Heisman Trophy Winner `KXHEISMAN-27` | sports / NCAA football | 48 | 239,440 | 27,464,525 | 34,639,611 | 2027-01-01 |
| 49 | BTC 15 min · $81,662.40 target `KXBTC15M-26OCT200245` | crypto | 1 | 238,351 | 346,630 | 1,504,416 | 2026-10-20 |
| 50 | AFC North Division Winner `KXNFLAFCNORTH-27` | sports / NFL | 4 | 231,238 | 1,814,784 | 2,189,832 | 2027-01-11 |

### 3b. Top 50 by open interest

| # | Event | Category / sub | Mkts | 24h vol | Open interest | Lifetime vol | First close (UTC) |
|--:|:--|:--|--:|--:|--:|--:|:--|
| 1 | 2028 Democratic presidential nominee `KXPRESNOMD-28` | politics/elections | 52 | 1,880,007 | 161,546,185 | 244,207,065 | 2028-11-07 |
| 2 | 2027 Pro Football Champion `KXSB-27` | sports / NFL | 32 | 2,981,312 | 146,456,115 | 191,641,197 | 2027-02-14 |
| 3 | 2028 U.S. Presidential Election winner? `KXPRESPERSON-28` | politics/elections | 32 | 401,805 | 52,079,034 | 75,194,315 | 2029-01-21 |
| 4 | 2028 Republican presidential nominee `KXPRESNOMR-28` | politics/elections | 45 | 135,335 | 46,577,899 | 69,777,508 | 2028-11-07 |
| 5 | College Football National Championship Winner `KXNCAAF-27` | sports / NCAA football | 52 | 720,878 | 45,954,306 | 62,263,254 | 2027-01-26 |
| 6 | Which party will win the U.S. House? `CONTROLH-2026` | politics/elections | 2 | 971,827 | 44,267,901 | 61,395,698 | 2027-02-01 |
| 7 | 2026 Midterms: Congress Balance of Power? `KXBALANCEPOWERCOMBO-27FEB` | politics/elections | 4 | 1,644,412 | 33,439,606 | 43,897,198 | 2027-02-01 |
| 8 | 2027 Pro Basketball Champion `KXNBA-27` | sports / NBA | 30 | 807,299 | 30,850,153 | 39,815,943 | 2027-07-31 |
| 9 | MVP Winner? `KXNFLMVP-27` | sports / NFL | 49 | 425,037 | 29,593,288 | 35,705,585 | 2027-03-14 |
| 10 | Heisman Trophy Winner `KXHEISMAN-27` | sports / NCAA football | 48 | 239,440 | 27,464,525 | 34,639,611 | 2027-01-01 |
| 11 | Texas Senate winner? `SENATETX-26` | politics/elections | 2 | 1,010,326 | 22,490,995 | 31,248,852 | 2027-01-04 |
| 12 | Los Angeles Mayor winner? `KXMAYORLA-26` | politics/elections | 2 | 55,731 | 15,060,755 | 40,855,886 | 2027-06-02 |
| 13 | Will the U.S. confirm that aliens exist? `KXALIENS-27` | tech/AI/science | 5 | 15,855 | 12,027,757 | 33,437,502 | 2026-11-01 |
| 14 | Bitcoin price at the end of 2026 `KXBTCY-27JAN0100` | crypto | 28 | 99,266 | 10,690,027 | 42,312,270 | 2027-01-01 |
| 15 | Who will win the Ballon d'Or in 2026? `KXBALLONDOR-26` | sports / Soccer: FIFA/World Cup & awards | 17 | 633,455 | 10,406,089 | 16,590,032 | 2026-12-31 |
| 16 | AFC Championship Winner `KXNFLAFCCHAMP-27` | sports / NFL | 16 | 97,702 | 10,191,765 | 12,560,508 | 2027-02-08 |
| 17 | Pro Baseball Champion `KXMLB-26` | sports / MLB | 2 | 984,444 | 10,109,641 | 17,354,713 | 2026-11-01 |
| 18 | Men's 2027 College Basketball Champion `KXMARMAD-27` | sports / NCAA basketball | 73 | 218,371 | 9,846,914 | 12,040,420 | 2027-04-13 |
| 19 | NFC Championship Winner `KXNFLNFCCHAMP-27` | sports / NFL | 16 | 219,180 | 9,760,916 | 13,035,768 | 2027-02-08 |
| 20 | California Governor winner? (Person) `KXGOVCA-26` | politics/elections | 2 | 340,904 | 9,679,124 | 19,298,164 | 2027-01-06 |
| 21 | Which party will win the U.S. Senate? `CONTROLS-2026` | politics/elections | 2 | 231,013 | 9,339,035 | 15,702,634 | 2027-02-01 |
| 22 | Pro Football Championship Game Matchup `KXNFLMATCHUP-27SB` | sports / NFL | 256 | 391,905 | 9,259,831 | 10,332,081 | 2027-02-14 |
| 23 | Best AI at the end of 2026? `KXLLM1-26DEC31` | tech/AI/science | 8 | 101,219 | 7,867,655 | 14,931,506 | 2026-12-31 |
| 24 | Oscar Winner: Best Picture `KXOSCARPIC-27` | culture/entertainment | 41 | 109,117 | 6,702,495 | 9,430,801 | 2027-12-31 |
| 25 | Number of rate cuts in 2026? `KXRATECUTCOUNT-26DEC31` | economy/Fed/macro | 21 | 5,052 | 6,582,971 | 10,746,881 | 2026-12-31 |
| 26 | Fed decision in Oct 2026? `KXFEDDECISION-26OCT` | economy/Fed/macro | 5 | 171,627 | 5,838,304 | 12,622,745 | 2026-10-28 |
| 27 | Ohio Senate winner? `SENATEOHS-26` | politics/elections | 2 | 129,315 | 5,266,089 | 7,504,336 | 2026-12-16 |
| 28 | S&P close price end of 2026? `KXINXY-26DEC31H1600` | financials / indices | 27 | 48,365 | 5,264,868 | 7,897,572 | 2026-12-31 |
| 29 | Michigan Senate winner? `SENATEMI-26` | politics/elections | 2 | 198,419 | 5,017,009 | 7,962,358 | 2027-01-04 |
| 30 | Coach of the Year Winner? `KXNFLCOTY-27` | sports / NFL | 33 | 66,904 | 4,744,928 | 5,221,096 | 2027-03-30 |
| 31 | F1 Drivers Champion `KXF1-26` | sports / Motorsport | 22 | 15,223 | 4,707,054 | 9,601,703 | 2026-12-08 |
| 32 | Will the SAVE Act become law? `KXSAVEACT-27` | politics/elections | 1 | 63,258 | 4,700,246 | 14,660,328 | 2027-01-04 |
| 33 | Steph Curry's Next Team `KXNEXTTEAMNBA-26SCUR` | sports / NBA | 30 | 4,484 | 4,688,446 | 6,772,234 | 2026-10-21 |
| 34 | Will Bitcoin be above $200k by 2027? `KXBTC2026200-27JAN01` | crypto | 1 | 268,882 | 4,617,889 | 12,241,569 | 2027-01-01 |
| 35 | Offensive Rookie of the Year Winner? `KXNFLOROTY-27` | sports / NFL | 40 | 38,416 | 4,501,034 | 5,344,066 | 2027-03-30 |
| 36 | English Premier League Champion `KXPREMIERLEAGUE-27` | sports / Soccer: Premier League | 20 | 79,319 | 4,215,196 | 5,395,626 | 2027-05-30 |
| 37 | Offensive Player of the Year Winner? `KXNFLOPOTY-27` | sports / NFL | 69 | 35,528 | 4,089,211 | 4,460,615 | 2027-03-10 |
| 38 | Maine Senate winner? `SENATEME-26` | politics/elections | 2 | 261,818 | 3,871,903 | 9,307,013 | 2027-01-04 |
| 39 | How many Senate seats will Democrats hold after the Mi… `KXDSENATESEATS-27` | politics/elections | 10 | 302,943 | 3,862,194 | 5,332,781 | 2027-02-01 |
| 40 | 2026-27 Stanley Cup® Finals Winner `KXNHL-27` | sports / NHL | 32 | 44,270 | 3,670,044 | 4,122,358 | 2027-07-01 |
| 41 | AL MVP Winner `KXMLBALMVP-26` | sports / MLB | 49 | 18,245 | 3,660,548 | 5,358,188 | 2026-12-08 |
| 42 | When will traffic at the Strait of Hormuz return to no… `KXHORMUZNORM-26MAR17` | geopolitics/war | 17 | 311,955 | 3,630,300 | 10,243,145 | 2026-11-03 |
| 43 | Nasdaq-100 close price end of 2026? `KXNASDAQ100Y-26DEC31H1600` | financials / indices | 30 | 8,720 | 3,595,820 | 4,836,193 | 2026-12-31 |
| 44 | How high will oil (WTI) get by Dec 31, 2026? `KXWTIMAX-26DEC31` | financials / commodities | 10 | 13,668 | 3,439,673 | 9,226,686 | 2026-12-31 |
| 45 | Iowa Senate winner? `SENATEIA-26` | politics/elections | 2 | 51,634 | 3,422,625 | 5,635,297 | 2027-01-04 |
| 46 | Defensive Player of the Year Winner? `KXNFLDPOTY-27` | sports / NFL | 72 | 42,176 | 3,359,024 | 3,760,641 | 2027-03-10 |
| 47 | NASCAR Cup Series Champion `KXNASCARCUPSERIES-NCS26` | sports / Motorsport | 35 | 20,462 | 3,247,506 | 5,471,218 | 2026-11-15 |
| 48 | How many House seats will Republicans hold after the M… `KXRHOUSESEATS-27` | politics/elections | 11 | 121,455 | 3,244,201 | 4,502,606 | 2027-02-01 |
| 49 | Champions League Winner `KXUCL-27` | sports / Soccer: UEFA club comps | 36 | 61,756 | 3,234,267 | 4,451,849 | 2027-06-05 |
| 50 | College Football Big 12 Championship Winner `KXNCAAFB12-26` | sports / NCAA football | 16 | 110,559 | 3,197,883 | 3,656,219 | 2026-12-05 |

### 3c. Top 50 by lifetime volume

| # | Event | Category / sub | Mkts | 24h vol | Open interest | Lifetime vol | First close (UTC) |
|--:|:--|:--|--:|--:|--:|--:|:--|
| 1 | 2028 Democratic presidential nominee `KXPRESNOMD-28` | politics/elections | 52 | 1,880,007 | 161,546,185 | 244,207,065 | 2028-11-07 |
| 2 | 2027 Pro Football Champion `KXSB-27` | sports / NFL | 32 | 2,981,312 | 146,456,115 | 191,641,197 | 2027-02-14 |
| 3 | 2028 U.S. Presidential Election winner? `KXPRESPERSON-28` | politics/elections | 32 | 401,805 | 52,079,034 | 75,194,315 | 2029-01-21 |
| 4 | 2028 Republican presidential nominee `KXPRESNOMR-28` | politics/elections | 45 | 135,335 | 46,577,899 | 69,777,508 | 2028-11-07 |
| 5 | College Football National Championship Winner `KXNCAAF-27` | sports / NCAA football | 52 | 720,878 | 45,954,306 | 62,263,254 | 2027-01-26 |
| 6 | Which party will win the U.S. House? `CONTROLH-2026` | politics/elections | 2 | 971,827 | 44,267,901 | 61,395,698 | 2027-02-01 |
| 7 | 2026 Midterms: Congress Balance of Power? `KXBALANCEPOWERCOMBO-27FEB` | politics/elections | 4 | 1,644,412 | 33,439,606 | 43,897,198 | 2027-02-01 |
| 8 | Bitcoin price at the end of 2026 `KXBTCY-27JAN0100` | crypto | 28 | 99,266 | 10,690,027 | 42,312,270 | 2027-01-01 |
| 9 | Los Angeles Mayor winner? `KXMAYORLA-26` | politics/elections | 2 | 55,731 | 15,060,755 | 40,855,886 | 2027-06-02 |
| 10 | 2027 Pro Basketball Champion `KXNBA-27` | sports / NBA | 30 | 807,299 | 30,850,153 | 39,815,943 | 2027-07-31 |
| 11 | MVP Winner? `KXNFLMVP-27` | sports / NFL | 49 | 425,037 | 29,593,288 | 35,705,585 | 2027-03-14 |
| 12 | Heisman Trophy Winner `KXHEISMAN-27` | sports / NCAA football | 48 | 239,440 | 27,464,525 | 34,639,611 | 2027-01-01 |
| 13 | Will the U.S. confirm that aliens exist? `KXALIENS-27` | tech/AI/science | 5 | 15,855 | 12,027,757 | 33,437,502 | 2026-11-01 |
| 14 | More tech layoffs in 20​26 than in 2025? `KXLAYOFFSYINFO-26` | economy/Fed/macro | 1 | 485 | 168,642 | 31,499,078 | 2027-03-01 |
| 15 | Texas Senate winner? `SENATETX-26` | politics/elections | 2 | 1,010,326 | 22,490,995 | 31,248,852 | 2027-01-04 |
| 16 | Will the Citrini scenario happen? `KXCITRINI-28JUL01` | politics/elections | 1 | 365 | 163,989 | 25,942,155 | 2028-07-01 |
| 17 | California Governor winner? (Person) `KXGOVCA-26` | politics/elections | 2 | 340,904 | 9,679,124 | 19,298,164 | 2027-01-06 |
| 18 | Pro Baseball Champion `KXMLB-26` | sports / MLB | 2 | 984,444 | 10,109,641 | 17,354,713 | 2026-11-01 |
| 19 | Who will win the Ballon d'Or in 2026? `KXBALLONDOR-26` | sports / Soccer: FIFA/World Cup & awards | 17 | 633,455 | 10,406,089 | 16,590,032 | 2026-12-31 |
| 20 | Which party will win the U.S. Senate? `CONTROLS-2026` | politics/elections | 2 | 231,013 | 9,339,035 | 15,702,634 | 2027-02-01 |
| 21 | Best AI at the end of 2026? `KXLLM1-26DEC31` | tech/AI/science | 8 | 101,219 | 7,867,655 | 14,931,506 | 2026-12-31 |
| 22 | Will the SAVE Act become law? `KXSAVEACT-27` | politics/elections | 1 | 63,258 | 4,700,246 | 14,660,328 | 2027-01-04 |
| 23 | NFC Championship Winner `KXNFLNFCCHAMP-27` | sports / NFL | 16 | 219,180 | 9,760,916 | 13,035,768 | 2027-02-08 |
| 24 | Fed decision in Oct 2026? `KXFEDDECISION-26OCT` | economy/Fed/macro | 5 | 171,627 | 5,838,304 | 12,622,745 | 2026-10-28 |
| 25 | AFC Championship Winner `KXNFLAFCCHAMP-27` | sports / NFL | 16 | 97,702 | 10,191,765 | 12,560,508 | 2027-02-08 |
| 26 | Will Bitcoin be above $200k by 2027? `KXBTC2026200-27JAN01` | crypto | 1 | 268,882 | 4,617,889 | 12,241,569 | 2027-01-01 |
| 27 | Ethereum price at the end of 2026 `KXETHY-27JAN0100` | crypto | 18 | 5,446 | 729,694 | 12,241,364 | 2027-01-01 |
| 28 | Men's 2027 College Basketball Champion `KXMARMAD-27` | sports / NCAA basketball | 73 | 218,371 | 9,846,914 | 12,040,420 | 2027-04-13 |
| 29 | Number of rate cuts in 2026? `KXRATECUTCOUNT-26DEC31` | economy/Fed/macro | 21 | 5,052 | 6,582,971 | 10,746,881 | 2026-12-31 |
| 30 | Pro Football Championship Game Matchup `KXNFLMATCHUP-27SB` | sports / NFL | 256 | 391,905 | 9,259,831 | 10,332,081 | 2027-02-14 |
| 31 | When will traffic at the Strait of Hormuz return to no… `KXHORMUZNORM-26MAR17` | geopolitics/war | 17 | 311,955 | 3,630,300 | 10,243,145 | 2026-11-03 |
| 32 | F1 Drivers Champion `KXF1-26` | sports / Motorsport | 22 | 15,223 | 4,707,054 | 9,601,703 | 2026-12-08 |
| 33 | Oscar Winner: Best Picture `KXOSCARPIC-27` | culture/entertainment | 41 | 109,117 | 6,702,495 | 9,430,801 | 2027-12-31 |
| 34 | Maine Senate winner? `SENATEME-26` | politics/elections | 2 | 261,818 | 3,871,903 | 9,307,013 | 2027-01-04 |
| 35 | How high will oil (WTI) get by Dec 31, 2026? `KXWTIMAX-26DEC31` | financials / commodities | 10 | 13,668 | 3,439,673 | 9,226,686 | 2026-12-31 |
| 36 | Michigan Senate winner? `SENATEMI-26` | politics/elections | 2 | 198,419 | 5,017,009 | 7,962,358 | 2027-01-04 |
| 37 | S&P close price end of 2026? `KXINXY-26DEC31H1600` | financials / indices | 27 | 48,365 | 5,264,868 | 7,897,572 | 2026-12-31 |
| 38 | Donald Trump announces departure as President? (Exclud… `KXTRUMPOUT27-27` | politics/elections | 3 | 12,330 | 3,083,456 | 7,691,893 | 2027-01-01 |
| 39 | Ohio Senate winner? `SENATEOHS-26` | politics/elections | 2 | 129,315 | 5,266,089 | 7,504,336 | 2026-12-16 |
| 40 | Brazil Presidential election winner? `KXBRPRES-26` | politics/elections | 2 | 148,699 | 2,594,146 | 6,790,148 | 2026-10-25 |
| 41 | Steph Curry's Next Team `KXNEXTTEAMNBA-26SCUR` | sports / NBA | 30 | 4,484 | 4,688,446 | 6,772,234 | 2026-10-21 |
| 42 | How low will Bitcoin get in 2026? `KXBTCMINY-27JAN01` | crypto | 4 | 13,600 | 2,045,261 | 5,793,464 | 2027-01-01 |
| 43 | Who will officially lead Venezuela at the end of 2026? `KXVENEZUELALEADER-26DEC31` | geopolitics/war | 18 | 8,336 | 1,201,195 | 5,743,098 | 2026-12-31 |
| 44 | Iowa Senate winner? `SENATEIA-26` | politics/elections | 2 | 51,634 | 3,422,625 | 5,635,297 | 2027-01-04 |
| 45 | NFC East Division Winner `KXNFLNFCEAST-27` | sports / NFL | 4 | 706,496 | 2,684,516 | 5,521,417 | 2027-01-11 |
| 46 | NASCAR Cup Series Champion `KXNASCARCUPSERIES-NCS26` | sports / Motorsport | 35 | 20,462 | 3,247,506 | 5,471,218 | 2026-11-15 |
| 47 | English Premier League Champion `KXPREMIERLEAGUE-27` | sports / Soccer: Premier League | 20 | 79,319 | 4,215,196 | 5,395,626 | 2027-05-30 |
| 48 | AL MVP Winner `KXMLBALMVP-26` | sports / MLB | 49 | 18,245 | 3,660,548 | 5,358,188 | 2026-12-08 |
| 49 | Offensive Rookie of the Year Winner? `KXNFLOROTY-27` | sports / NFL | 40 | 38,416 | 4,501,034 | 5,344,066 | 2027-03-30 |
| 50 | How many Senate seats will Democrats hold after the Mi… `KXDSENATESEATS-27` | politics/elections | 10 | 302,943 | 3,862,194 | 5,332,781 | 2027-02-01 |

### 3d. Top 15 per category

Ranked by 24h volume. Rankings by open interest and by lifetime volume are in `kalshi_top15_events_per_category.csv`. Top 5 by open interest per category:

- **politics/elections**: 2028 Democratic presidential nominee (161.5M); 2028 U.S. Presidential Election winner? (52.1M); 2028 Republican presidential nominee (46.6M); Which party will win the U.S. House? (44.3M); 2026 Midterms: Congress Balance of Power? (33.4M)
- **geopolitics/war**: When will traffic at the Strait of Hormuz return … (3.6M); US-Iran nuclear deal? (1.6M); Who will officially lead Venezuela at the end of … (1.2M); Will Reza Pahlavi visit Iran in 2026? (740.9k); Will Trump buy at least part of Greenland? (715.6k)
- **economy/Fed/macro**: Number of rate cuts in 2026? (6.6M); Fed decision in Oct 2026? (5.8M); Will at least 50% of scheduled flights at JFK be … (3.0M); Recession this year? (947.9k); How high will US gas prices get in 2026? (927.8k)
- **financials**: S&P close price end of 2026? (5.3M); Nasdaq-100 close price end of 2026? (3.6M); How high will oil (WTI) get by Dec 31, 2026? (3.4M); Will GameStop acquire eBay in 2026? (1.2M); When will Anthropic officially announce an IPO? (585.8k)
- **crypto**: Bitcoin price at the end of 2026 (10.7M); Will Bitcoin be above $200k by 2027? (4.6M); How low will Bitcoin get in 2026? (2.0M); How high will Bitcoin get in 2026? (1.3M); Will BTC hit $50,000 before $100,000? (1.0M)
- **tech/AI/science**: Will the U.S. confirm that aliens exist? (12.0M); Best AI at the end of 2026? (7.9M); Which AI company will have the best coding model … (727.9k); Will WHO declare Hantavirus a Public Health Emerg… (414.2k); When will OpenAI achieve AGI? (395.1k)
- **sports**: 2027 Pro Football Champion (146.5M); College Football National Championship Winner (46.0M); 2027 Pro Basketball Champion (30.9M); MVP Winner? (29.6M); Heisman Trophy Winner (27.5M)
- **weather/climate**: Will there be an 8 magnitude earthquake in Califo… (241.4k); Where will it rain on Oct 19, 2026? (133.4k); Will 2026 be the hottest year ever? (113.7k); Where will it rain on Oct 20, 2026? (103.7k); Highest temperature in Denver on Oct 19, 2026? (81.1k)
- **culture/entertainment**: Oscar Winner: Best Picture (6.7M); Dancing with the Stars Season 35 · Winner (2.2M); The Game Awards: Game of the Year (1.6M); Grand Theft Auto VI: Release date (1.3M); Next James Bond film: Actor cast as James Bond (1.2M)
- **mentions**: What will Trump say during his rally in Kansas? (197.8k); What will Trump say during his rally in North Car… (139.6k); What will Bernie say during his rally in El Paso? (65.6k); What will Bernie say during his rally in Amarillo? (65.3k); What companies will Trump say in October? (62.0k)
- **other**: Pandemic in 2026? (265.6k); Will a new interstellar visitor be confirmed befo… (125.0k); What will the average number of measles cases be … (24.5k); Will OpenAI announce another Millennium Prize sol… (23.5k); Will there be a year without polio before 2030? (18.0k)

**politics/elections** (ranked by 24h volume)

| # | Event | Sub | 24h vol | Open interest | Lifetime vol | First close |
|--:|:--|:--|--:|--:|--:|:--|
| 1 | 2028 Democratic presidential nominee |  | 1,880,007 | 161,546,185 | 244,207,065 | 2028-11-07 |
| 2 | 2026 Midterms: Congress Balance of Power? |  | 1,644,412 | 33,439,606 | 43,897,198 | 2027-02-01 |
| 3 | Texas Senate winner? |  | 1,010,326 | 22,490,995 | 31,248,852 | 2027-01-04 |
| 4 | Which party will win the U.S. House? |  | 971,827 | 44,267,901 | 61,395,698 | 2027-02-01 |
| 5 | Who will be Trump's next Press Secretary? |  | 455,480 | 1,519,909 | 2,021,157 | 2029-01-27 |
| 6 | 2028 U.S. Presidential Election winner? |  | 401,805 | 52,079,034 | 75,194,315 | 2029-01-21 |
| 7 | New York Governor winner? |  | 353,075 | 3,166,409 | 3,900,983 | 2027-01-01 |
| 8 | California Governor winner? (Person) |  | 340,904 | 9,679,124 | 19,298,164 | 2027-01-06 |
| 9 | Trump's RCP approval average on Oct 20, 2026? |  | 332,921 | 155,174 | 333,386 | 2026-10-20 |
| 10 | How many Senate seats will Democrats hold after the Midterm… |  | 302,943 | 3,862,194 | 5,332,781 | 2027-02-01 |
| 11 | Maine Senate winner? |  | 261,818 | 3,871,903 | 9,307,013 | 2027-01-04 |
| 12 | Which party will win the U.S. Senate? |  | 231,013 | 9,339,035 | 15,702,634 | 2027-02-01 |
| 13 | Michigan Senate winner? |  | 198,419 | 5,017,009 | 7,962,358 | 2027-01-04 |
| 14 | South Carolina Senate winner? |  | 151,800 | 2,452,033 | 3,674,906 | 2027-01-04 |
| 15 | Brazil Presidential election winner? |  | 148,699 | 2,594,146 | 6,790,148 | 2026-10-25 |

**geopolitics/war** (ranked by 24h volume)

| # | Event | Sub | 24h vol | Open interest | Lifetime vol | First close |
|--:|:--|:--|--:|--:|--:|:--|
| 1 | When will traffic at the Strait of Hormuz return to normal? |  | 311,955 | 3,630,300 | 10,243,145 | 2026-11-03 |
| 2 | US-Iran nuclear deal? |  | 46,581 | 1,610,953 | 3,604,778 | 2026-11-01 |
| 3 | Traffic through the Strait of Hormuz? (10/12 - 10/18) |  | 31,490 | 147,462 | 417,573 | 2026-10-20 |
| 4 | Peak Strait of Hormuz traffic day? (10/12 - 10/18) |  | 15,368 | 32,014 | 79,861 | 2026-10-20 |
| 5 | Traffic through the Panama Canal? (10/19 - 10/25) |  | 9,270 | 9,155 | 45,420 | 2026-10-27 |
| 6 | Traffic through the Strait of Hormuz? (10/19 - 10/25) |  | 9,128 | 11,751 | 27,631 | 2026-10-27 |
| 7 | Who will officially lead Venezuela at the end of 2026? |  | 8,336 | 1,201,195 | 5,743,098 | 2026-12-31 |
| 8 | Peak traffic through the Strait of Hormuz? (10/12 - 10/18) |  | 7,191 | 45,962 | 129,595 | 2026-10-20 |
| 9 | Traffic through the Panama Canal? (10/12 - 10/18) |  | 6,658 | 25,507 | 122,578 | 2026-10-20 |
| 10 | When will Russian diesel be imported into the U.S.? |  | 6,225 | 5,635 | 6,225 | 2026-11-01 |
| 11 | Peak traffic through the Strait of Hormuz? (10/19 - 10/25) |  | 4,582 | 4,637 | 11,422 | 2026-10-27 |
| 12 | Will Kim Jong-Un visit the US during Trump's term? |  | 2,656 | 4,930 | 17,132 | 2029-01-20 |
| 13 | Will the US issue a Level 4 travel advisory for Taiwan? |  | 1,857 | 151,370 | 302,934 | 2027-01-01 |
| 14 | How much will the US acquire Greenland for? |  | 1,741 | 637,590 | 1,763,205 | 2029-01-22 |
| 15 | Will Donald Trump visit Iran? |  | 1,543 | 168,048 | 416,045 | 2027-01-01 |

**economy/Fed/macro** (ranked by 24h volume)

| # | Event | Sub | 24h vol | Open interest | Lifetime vol | First close |
|--:|:--|:--|--:|--:|--:|:--|
| 1 | US gas prices this week |  | 487,298 | 95,226 | 487,310 | 2026-10-26 |
| 2 | Fed decision in Oct 2026? |  | 171,627 | 5,838,304 | 12,622,745 | 2026-10-28 |
| 3 | Bank of Canada decision in Oct 2026? |  | 96,462 | 154,093 | 338,300 | 2026-10-28 |
| 4 | Gas prices in the US in Oct 2026? |  | 78,697 | 234,788 | 499,583 | 2026-10-31 |
| 5 | New Jersey gas price at year-end 2026 |  | 51,677 | 4,752 | 187,267 | 2026-12-31 |
| 6 | 30-year mortgage rate this week |  | 33,358 | 36,901 | 49,151 | 2026-10-22 |
| 7 | CPI in October |  | 18,986 | 425,979 | 722,637 | 2026-11-10 |
| 8 | Iowa ethanol production in 2026 |  | 15,702 | 31,618 | 119,476 | 2027-01-31 |
| 9 | US crude oil inventories for the week ending October 16, 20… |  | 12,311 | 9,949 | 15,178 | 2026-10-21 |
| 10 | Fed decision in Dec 2026? |  | 11,106 | 916,432 | 1,265,055 | 2026-12-09 |
| 11 | New Hampshire maple syrup production in 2027 |  | 9,324 | 21,817 | 136,387 | 2027-06-30 |
| 12 | CPI YoY in November |  | 9,095 | 257,852 | 553,883 | 2026-12-10 |
| 13 | Core CPI YoY in November |  | 9,040 | 88,858 | 219,432 | 2026-12-10 |
| 14 | Maine lobster landings in 2026 |  | 8,775 | 11,343 | 51,860 | 2027-03-31 |
| 15 | Core CPI in October |  | 7,226 | 332,825 | 691,315 | 2026-11-10 |

**financials** (ranked by 24h volume)

| # | Event | Sub | 24h vol | Open interest | Lifetime vol | First close |
|--:|:--|:--|--:|--:|--:|:--|
| 1 | When will Anthropic officially announce an IPO? | IPOs | 66,644 | 585,847 | 1,336,729 | 2026-10-24 |
| 2 | Oil Price (WTI) on Oct 20, 2026? | commodities | 65,437 | 53,707 | 71,399 | 2026-10-20 |
| 3 | Copper price on Oct 20, 2026 at 5:00 PM EDT? | commodities | 63,781 | 16,210 | 63,783 | 2026-10-20 |
| 4 | Gold price on Oct 20, 2026 at 5:00 PM EDT? | commodities | 51,009 | 32,016 | 51,012 | 2026-10-20 |
| 5 | S&P close price end of 2026? | indices | 48,365 | 5,264,868 | 7,897,572 | 2026-12-31 |
| 6 | Copper price on Oct 23, 2026 at 5:00 PM EDT? | commodities | 43,983 | 17,032 | 65,547 | 2026-10-23 |
| 7 | American Airlines passenger load factor in Q3 | earnings/KPIs | 41,576 | 54,226 | 147,161 | 2027-02-19 |
| 8 | Will the S&P finish positive this year? | indices | 32,768 | 585,099 | 1,399,508 | 2027-01-01 |
| 9 | Gold 15 min · $4,130.89 target | commodities | 31,480 | 27,943 | 163,178 | 2026-10-20 |
| 10 | When will Tesla and SpaceX merge? | companies/other | 24,219 | 355,767 | 710,822 | 2026-11-01 |
| 11 | C4 Energy Point of Sale Growth in October | companies/other | 20,428 | 36,626 | 60,050 | 2026-11-03 |
| 12 | Mountain Dew Point of Sale Growth in October | companies/other | 19,850 | 32,572 | 52,865 | 2026-11-03 |
| 13 | Coca-Cola Point of Sale Growth in October | companies/other | 18,847 | 29,367 | 51,953 | 2026-11-03 |
| 14 | 10Y US Treasury yield on Oct 20, 2026? | rates | 18,297 | 16,110 | 18,297 | 2026-10-20 |
| 15 | The Cheesecake Factory comparable restaurant sales in Q3 | earnings/KPIs | 16,825 | 77,144 | 224,432 | 2027-02-24 |

**crypto** (ranked by 24h volume)

| # | Event | Sub | 24h vol | Open interest | Lifetime vol | First close |
|--:|:--|:--|--:|--:|--:|:--|
| 1 | BTC price on Oct 20, 2026 at 3am EDT? |  | 490,482 | 282,003 | 614,763 | 2026-10-20 |
| 2 | BTC price on Oct 23, 2026 at 5pm EDT? |  | 326,481 | 482,733 | 1,063,231 | 2026-10-23 |
| 3 | BTC price on Oct 20, 2026 at 5pm EDT? |  | 324,990 | 182,466 | 325,210 | 2026-10-20 |
| 4 | Will Bitcoin be above $200k by 2027? |  | 268,882 | 4,617,889 | 12,241,569 | 2027-01-01 |
| 5 | BTC 15 min · $81,662.40 target |  | 238,351 | 346,630 | 1,504,416 | 2026-10-20 |
| 6 | Will BTC hit $50,000 before $100,000? |  | 110,056 | 1,038,882 | 3,936,282 | 2027-01-01 |
| 7 | Bitcoin price at the end of 2026 |  | 99,266 | 10,690,027 | 42,312,270 | 2027-01-01 |
| 8 | How high will ZEC get in October? |  | 47,603 | 11,969 | 93,084 | 2026-11-01 |
| 9 | BNB price on Oct 23, 2026 at 5pm EDT? |  | 46,371 | 1,663 | 66,263 | 2026-10-23 |
| 10 | How high will BTC get in October? |  | 41,330 | 802,029 | 1,395,801 | 2026-11-01 |
| 11 | How low will ZEC get in October? |  | 37,414 | 957 | 95,657 | 2026-11-01 |
| 12 | BNB price range on Oct 23, 2026 at 5pm EDT? |  | 20,032 | 1,046 | 20,677 | 2026-10-23 |
| 13 | Will Satoshi move any Bitcoin before 2027? |  | 19,334 | 174,020 | 597,377 | 2027-01-01 |
| 14 | When will Bitcoin hit $150k? |  | 16,611 | 777,422 | 1,654,417 | 2027-01-01 |
| 15 | ETH price on Oct 23, 2026 at 5pm EDT? |  | 16,221 | 56,236 | 73,402 | 2026-10-23 |

**tech/AI/science** (ranked by 24h volume)

| # | Event | Sub | 24h vol | Open interest | Lifetime vol | First close |
|--:|:--|:--|--:|--:|--:|:--|
| 1 | DeepSeek market share this week |  | 172,139 | 87,728 | 172,139 | 2026-10-26 |
| 2 | Best AI at the end of 2026? |  | 101,219 | 7,867,655 | 14,931,506 | 2026-12-31 |
| 3 | How many launches will SpaceX have in October? |  | 49,049 | 137,737 | 290,381 | 2026-11-01 |
| 4 | Best AI this week |  | 32,612 | 30,104 | 32,612 | 2026-10-26 |
| 5 | OpenAI market share this week |  | 31,171 | 25,274 | 31,171 | 2026-10-26 |
| 6 | Anthropic share of spend on Oct 20, 2026 (Vercel) |  | 26,952 | 9,844 | 27,050 | 2026-10-21 |
| 7 | Which AI company will have the best coding model at the end… |  | 22,377 | 727,930 | 1,183,719 | 2026-12-31 |
| 8 | Anthropic market share this week |  | 20,743 | 13,485 | 20,743 | 2026-10-26 |
| 9 | Google market share this week |  | 20,198 | 12,461 | 20,198 | 2026-10-26 |
| 10 | Will the U.S. confirm that aliens exist? |  | 15,855 | 12,027,757 | 33,437,502 | 2026-11-01 |
| 11 | Best AI in Oct 2026? |  | 14,212 | 353,032 | 535,275 | 2026-10-31 |
| 12 | When will OpenAI release Astra 6.1? |  | 13,545 | 54,317 | 257,099 | 2026-10-23 |
| 13 | Which country will be the next to send humans to the Moon? |  | 12,726 | 76,689 | 184,594 | 2031-01-01 |
| 14 | Which AI will be the first to hit 1550 on Text Arena? |  | 11,406 | 103,697 | 207,822 | 2027-01-01 |
| 15 | DeepSeek share of requests on Oct 20, 2026 (Vercel) |  | 9,465 | 9,354 | 11,153 | 2026-10-21 |

**sports** (ranked by 24h volume)

| # | Event | Sub | 24h vol | Open interest | Lifetime vol | First close |
|--:|:--|:--|--:|--:|--:|:--|
| 1 | 2027 Pro Football Champion | NFL | 2,981,312 | 146,456,115 | 191,641,197 | 2027-02-14 |
| 2 | PSG vs Barcelona | Soccer: UEFA club com… | 2,176,121 | 2,984,025 | 3,222,619 | 2026-10-20 |
| 3 | Putintseva vs Shnaider | Tennis | 1,616,877 | 872,681 | 1,746,286 | 2026-10-20 |
| 4 | Bejlek vs Parks | Tennis | 1,478,379 | 643,988 | 1,679,706 | 2026-10-20 |
| 5 | Badosa vs Ruzic | Tennis | 1,314,645 | 563,822 | 1,531,503 | 2026-10-19 |
| 6 | Butterfield Bermuda Championship Winner | Golf | 1,060,065 | 1,019,888 | 1,060,130 | 2026-10-25 |
| 7 | Pro Baseball Champion | MLB | 984,444 | 10,109,641 | 17,354,713 | 2026-11-01 |
| 8 | Ribecai vs Vasami | Tennis | 964,833 | 337,390 | 964,996 | 2026-10-19 |
| 9 | Sydney Thunder Women vs Sydney Sixers Women | Cricket | 898,893 | 431,587 | 1,085,327 | 2026-10-20 |
| 10 | Samrej vs Noguchi | Tennis | 828,541 | 429,319 | 935,696 | 2026-10-20 |
| 11 | 2027 Pro Basketball Champion | NBA | 807,299 | 30,850,153 | 39,815,943 | 2027-07-31 |
| 12 | Uchijima vs Shibahara | Tennis | 723,329 | 328,368 | 791,855 | 2026-10-19 |
| 13 | College Football National Championship Winner | NCAA football | 720,878 | 45,954,306 | 62,263,254 | 2027-01-26 |
| 14 | NFC East Division Winner | NFL | 706,496 | 2,684,516 | 5,521,417 | 2027-01-11 |
| 15 | Who will win the Ballon d'Or in 2026? | Soccer: FIFA/World Cu… | 633,455 | 10,406,089 | 16,590,032 | 2026-12-31 |

**weather/climate** (ranked by 24h volume)

| # | Event | Sub | 24h vol | Open interest | Lifetime vol | First close |
|--:|:--|:--|--:|--:|--:|:--|
| 1 | Where will it rain on Oct 19, 2026? |  | 296,806 | 133,384 | 336,980 | 2026-10-20 |
| 2 | Where will it rain on Oct 20, 2026? |  | 161,422 | 103,684 | 162,985 | 2026-10-21 |
| 3 | Highest temperature in Denver on Oct 19, 2026? |  | 149,890 | 81,096 | 155,417 | 2026-10-20 |
| 4 | Highest temperature in Phoenix on Oct 19, 2026? |  | 72,293 | 65,886 | 81,564 | 2026-10-20 |
| 5 | Highest temperature in San Francisco on Oct 19, 2026? |  | 67,531 | 47,532 | 72,411 | 2026-10-20 |
| 6 | Highest temperature in Los Angeles on Oct 19, 2026? |  | 56,088 | 55,454 | 72,761 | 2026-10-20 |
| 7 | Lowest temperature in Denver on Oct 19, 2026? |  | 45,498 | 29,792 | 46,655 | 2026-10-20 |
| 8 | Highest temperature in Seattle on Oct 19, 2026? |  | 28,949 | 24,997 | 35,868 | 2026-10-20 |
| 9 | Highest temperature in New York City on Oct 20, 2026? |  | 20,629 | 18,200 | 20,851 | 2026-10-21 |
| 10 | Highest temperature in Miami on Oct 20, 2026? |  | 14,219 | 11,196 | 14,342 | 2026-10-21 |
| 11 | Highest temperature in Austin on Oct 20, 2026? |  | 14,156 | 12,131 | 14,159 | 2026-10-21 |
| 12 | Highest temperature in Philadelphia on Oct 20, 2026? |  | 13,360 | 11,375 | 13,505 | 2026-10-21 |
| 13 | Highest temperature in Las Vegas on Oct 19, 2026? |  | 11,830 | 10,465 | 14,008 | 2026-10-20 |
| 14 | What will the biggest earthquake be on Oct 20, 2026? |  | 11,729 | 8,271 | 11,753 | 2026-10-20 |
| 15 | Lowest temperature in Boston on Oct 20, 2026? |  | 11,024 | 10,886 | 11,030 | 2026-10-21 |

**culture/entertainment** (ranked by 24h volume)

| # | Event | Sub | 24h vol | Open interest | Lifetime vol | First close |
|--:|:--|:--|--:|--:|--:|:--|
| 1 | Oscar Winner: Best Picture |  | 109,117 | 6,702,495 | 9,430,801 | 2027-12-31 |
| 2 | Dancing with the Stars · Episode 7 Elimination |  | 108,279 | 395,422 | 751,006 | 2026-10-21 |
| 3 | Clayface · Rotten Tomatoes score |  | 88,840 | 209,388 | 479,526 | 2026-10-26 |
| 4 | Klara and the Sun · Rotten Tomatoes score |  | 87,379 | 221,086 | 402,767 | 2026-10-26 |
| 5 | Wildwood · Rotten Tomatoes score |  | 64,611 | 279,106 | 707,030 | 2026-10-26 |
| 6 | Pro Football Championship Halftime Show: Headliner(s) |  | 61,766 | 711,501 | 1,264,442 | 2027-02-15 |
| 7 | Dancing with the Stars Season 35 · Winner |  | 59,928 | 2,217,200 | 3,484,809 | 2026-12-31 |
| 8 | Ebenezer · Rotten Tomatoes score |  | 43,479 | 113,373 | 313,834 | 2026-11-16 |
| 9 | Grand Theft Auto VI: The Album · Features |  | 42,809 | 333,281 | 768,431 | 2026-12-31 |
| 10 | Taylor Swift: Highest daily view count (October 12, 2026 - … |  | 41,639 | 105,756 | 176,672 | 2026-10-20 |
| 11 | Wicker · Rotten Tomatoes score |  | 41,536 | 25,612 | 41,536 | 2026-10-26 |
| 12 | Call of Duty: Modern Warfare 4: Metacritic score |  | 30,193 | 26,193 | 30,193 | 2026-10-30 |
| 13 | Wild Horse Nine · Rotten Tomatoes score |  | 26,727 | 201,974 | 410,160 | 2026-11-09 |
| 14 | Grand Theft Auto VI: Release date |  | 25,156 | 1,334,528 | 3,355,290 | 2026-11-01 |
| 15 | The Cat in the Hat · Rotten Tomatoes score |  | 21,564 | 44,620 | 76,512 | 2026-11-09 |

**mentions** (ranked by 24h volume)

| # | Event | Sub | 24h vol | Open interest | Lifetime vol | First close |
|--:|:--|:--|--:|--:|--:|:--|
| 1 | What will Trump say during his rally in Kansas? |  | 227,924 | 197,845 | 241,538 | 2026-11-02 |
| 2 | What will Trump say during his rally in North Carolina? |  | 112,751 | 139,578 | 155,554 | 2026-11-03 |
| 3 | What will Bernie say during his rally in Amarillo? |  | 90,537 | 65,330 | 103,071 | 2026-11-02 |
| 4 | What will Bernie say during his rally in El Paso? |  | 65,860 | 65,632 | 68,286 | 2026-11-02 |
| 5 | What will Trump say this week? |  | 35,604 | 31,094 | 35,604 | 2026-10-26 |
| 6 | What will Trump say during his rally in Michigan? |  | 18,917 | 31,023 | 38,267 | 2026-11-08 |
| 7 | What will Trump say during his rally in Iowa? |  | 17,536 | 30,962 | 33,403 | 2026-11-05 |
| 8 | What will Bernie say during his rally in Houston? |  | 16,456 | 15,429 | 21,982 | 2026-11-03 |
| 9 | What will Trump say during his rally in Florida? |  | 12,371 | 29,271 | 36,909 | 2026-11-06 |
| 10 | What will Trump say during his rally in South Carolina? |  | 7,377 | 17,324 | 18,177 | 2026-11-04 |
| 11 | What will SpaceX say during their next earnings call? |  | 6,678 | 13,926 | 16,709 | 2027-03-31 |
| 12 | What will General Motors say during their next earnings cal… |  | 4,958 | 11,936 | 14,684 | 2026-10-20 |
| 13 | What will Trump say during his rally in Georgia? |  | 4,546 | 8,486 | 9,938 | 2026-11-07 |
| 14 | What will Netflix say during their next earnings call? |  | 4,345 | 14,684 | 23,042 | 2026-11-03 |
| 15 | What will Ally Financial say during their next earnings cal… |  | 4,302 | 10,466 | 12,408 | 2026-10-20 |

**other** (ranked by 24h volume)

| # | Event | Sub | 24h vol | Open interest | Lifetime vol | First close |
|--:|:--|:--|--:|--:|--:|:--|
| 1 | Pandemic in 2026? |  | 3,796 | 265,570 | 988,215 | 2027-01-01 |
| 2 | What will the average number of measles cases be during Tru… |  | 327 | 24,453 | 82,466 | 2029-01-01 |
| 3 | Will OpenAI announce another Millennium Prize solution? |  | 200 | 23,537 | 58,792 | 2027-01-01 |
| 4 | Will a new interstellar visitor be confirmed before 2027? |  | 78 | 125,039 | 329,296 | 2026-12-31 |
| 5 | Will OpenAI or Anthropic announce recursive self-improvemen… |  | 17 | 1,159 | 1,779 | 2026-12-31 |
| 6 | Will Anthropic announce a Millennium Prize solution? |  | 8 | 7,455 | 15,923 | 2027-01-01 |
| 7 | Will Trump make IVF free? |  | 3 | 6,029 | 37,571 | 2029-01-20 |
| 8 | Will there be a year without polio before 2030? |  | 1 | 18,019 | 42,783 | 2030-01-01 |
| 9 | Will the FDA approve a cure for Type 1 diabetes before 2033? |  | 0 | 4,852 | 10,571 | 2033-01-01 |
| 10 | How bad will CO2 atmospheric concentration get before 2030? |  | 0 | 4,950 | 14,851 | 2030-01-01 |
| 11 | Will Karl Bushby Finish His World Walk to Hull Before 2030? |  | 0 | 1,235 | 6,106 | 2030-01-01 |
| 12 | EU has a new member before 2030? |  | 0 | 2,563 | 8,419 | 2030-01-01 |
| 13 | Will Sébastien Bubeck leave OpenAI? |  | 0 | 207 | 224 | 2027-01-01 |
| 14 | Will there be a case of polio in the USA this year? |  | 0 | 6,330 | 12,791 | 2027-01-01 |
| 15 | Will Tristan Buckmaster sue OpenAI or Bubeck? |  | 0 | 383 | 408 | 2027-01-01 |

## 4. Resolution horizon and throughput

### 4a. Open markets by time to resolution (snapshot)

| Time to resolution | Markets | % markets | Events (by first close) | % events | 24h vol | % 24h vol | Open interest | % OI | % lifetime vol |
|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| in-play/overdue | 511 | 0.4% | 179 | 1.3% | 5,922,323 | 10.4% | 3,396,146 | 0.3% | 0.3% |
| <1h | 2,923 | 2.2% | 58 | 0.4% | 4,659,541 | 8.2% | 2,642,368 | 0.2% | 0.3% |
| 1-6h | 867 | 0.7% | 245 | 1.8% | 730,488 | 1.3% | 764,285 | 0.1% | 0.1% |
| 6-24h | 12,006 | 9.1% | 1,596 | 11.6% | 8,886,036 | 15.7% | 18,082,471 | 1.5% | 1.2% |
| 1-7d | 21,451 | 16.3% | 2,975 | 21.5% | 8,956,537 | 15.8% | 19,870,946 | 1.7% | 1.5% |
| 1-6w | 15,925 | 12.1% | 1,626 | 11.8% | 3,805,141 | 6.7% | 52,672,458 | 4.4% | 5.2% |
| >6w | 78,094 | 59.3% | 7,140 | 51.7% | 23,727,145 | 41.9% | 1,103,100,113 | 91.9% | 91.4% |

"in-play/overdue" = past the expected expiration but not yet closed (mostly tennis matches in progress at the snapshot). Using `close_time` only:

| Time to close_time only | Markets | % 24h vol | % OI |
|:--|--:|--:|--:|
| in-play/overdue | 0 | 0.0% | 0.0% |
| <1h | 2,907 | 2.4% | 0.1% |
| 1-6h | 343 | 0.5% | 0.0% |
| 6-24h | 6,058 | 3.0% | 0.7% |
| 1-7d | 22,671 | 24.7% | 1.9% |
| 1-6w | 18,326 | 25.3% | 3.7% |
| >6w | 81,472 | 44.2% | 93.6% |

By category (share of the category's own 24h volume / open interest):

| Category | in-play/overdue (24h vol % / OI %) | <1h (24h vol % / OI %) | 1-6h (24h vol % / OI %) | 6-24h (24h vol % / OI %) | 1-7d (24h vol % / OI %) | 1-6w (24h vol % / OI %) | >6w (24h vol % / OI %) |
|:--|--:|--:|--:|--:|--:|--:|--:|
| tech/AI/science | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 7.9 / 0.1 | 44.5 / 0.9 | 14.3 / 9.0 | 33.2 / 90.0 |
| geopolitics/war | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 12.7 / 2.2 | 0.0 / 0.0 | 55.0 / 16.8 | 32.3 / 81.0 |
| politics/elections | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 2.9 / 0.0 | 2.9 / 0.6 | 2.4 / 2.1 | 91.8 / 97.3 |
| weather/climate | 0.0 / 0.0 | 43.4 / 12.4 | 21.0 / 9.4 | 24.3 / 10.7 | 7.9 / 2.8 | 2.1 / 9.7 | 1.3 / 55.0 |
| sports | 16.9 / 0.7 | 9.5 / 0.3 | 1.3 / 0.1 | 20.6 / 3.1 | 19.4 / 2.2 | 3.9 / 4.1 | 28.4 / 89.5 |
| financials | 0.0 / 0.0 | 4.8 / 0.2 | 0.6 / 0.0 | 25.4 / 0.7 | 6.6 / 0.4 | 35.8 / 11.0 | 26.9 / 87.7 |
| economy/Fed/macro | 0.0 / 0.0 | 0.0 / 0.0 | 0.2 / 0.2 | 0.1 / 0.0 | 44.5 / 11.0 | 33.5 / 28.7 | 21.7 / 60.1 |
| culture/entertainment | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 20.7 / 3.0 | 24.0 / 3.3 | 15.0 / 9.0 | 40.3 / 84.7 |
| other | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 100.0 / 100.0 |
| crypto | 0.0 / 0.0 | 34.0 / 2.6 | 0.0 / 0.0 | 15.2 / 0.7 | 18.4 / 2.2 | 6.9 / 5.2 | 25.5 / 89.3 |
| mentions | 0.0 / 0.0 | 0.0 / 0.0 | 0.7 / 0.9 | 0.8 / 1.4 | 5.8 / 4.3 | 90.6 / 73.5 | 2.1 / 19.9 |

Reading: the open book is long-dated (91.9% of open interest resolves in more than 6 weeks — elections, season futures), but the open book is not where the trading is; see 4b.

### 4b. Throughput: markets settled in the last 7 and 30 days

Every non-combo market that settled with a close time from 2026-09-20 00:00 to 2026-10-19 23:59 UTC (30 complete days; the 7-day window is 2026-10-13 → 2026-10-19). Full pull, not a sample. Volume is each market's lifetime volume, attributed to its close day.

**7 days, by series frequency label**

| Series frequency label | Markets settled | Volume (contracts) | Share | Per day (contracts) | Est. taker $ | $ share | Est. taker $/day |
|:--|--:|--:|--:|--:|--:|--:|--:|
| custom | 102,939 | 3,820,558,593 | 55.5% | 545,794,085 | 1,740,174,686 | 54.6% | 248,596,384 |
| fifteen_min | 14,942 | 2,654,298,313 | 38.6% | 379,185,473 | 1,248,325,934 | 39.2% | 178,332,276 |
| hourly | 482,673 | 267,526,860 | 3.9% | 38,218,123 | 125,705,320 | 4.0% | 17,957,903 |
| one_off | 10,633 | 71,552,458 | 1.0% | 10,221,780 | 35,578,319 | 1.1% | 5,082,617 |
| daily | 13,282 | 50,752,398 | 0.7% | 7,250,343 | 25,262,850 | 0.8% | 3,608,979 |
| annual | 169 | 7,194,866 | 0.1% | 1,027,838 | 3,401,157 | 0.1% | 485,880 |
| weekly | 1,994 | 6,062,800 | 0.1% | 866,114 | 3,065,110 | 0.1% | 437,873 |
| monthly | 574 | 5,240,832 | 0.1% | 748,690 | 2,718,828 | 0.1% | 388,404 |

**7 days, by market lifetime (open_time → close_time)**

| Market lifetime (open→close) | Markets settled | Volume (contracts) | Share | Per day (contracts) | Est. taker $ | $ share | Est. taker $/day |
|:--|--:|--:|--:|--:|--:|--:|--:|
| <1h | 26,261 | 2,658,284,643 | 38.6% | 379,754,949 | 1,250,600,441 | 39.3% | 178,657,206 |
| 1-6h | 474,210 | 289,015,269 | 4.2% | 41,287,896 | 138,961,192 | 4.4% | 19,851,599 |
| 6-24h | 42,261 | 890,268,142 | 12.9% | 127,181,163 | 443,355,568 | 13.9% | 63,336,510 |
| 1-7d | 75,991 | 1,374,012,112 | 20.0% | 196,287,445 | 636,416,727 | 20.0% | 90,916,675 |
| 1-6w | 7,251 | 1,645,759,261 | 23.9% | 235,108,466 | 702,984,375 | 22.1% | 100,426,339 |
| >6w | 1,232 | 25,847,691 | 0.4% | 3,692,527 | 11,913,901 | 0.4% | 1,701,986 |

**7 days, by category**

| Category | Markets settled | Volume (contracts) | Share | Per day (contracts) | Est. taker $ | $ share | Est. taker $/day |
|:--|--:|--:|--:|--:|--:|--:|--:|
| sports | 112,307 | 3,880,262,727 | 56.4% | 554,323,247 | 1,770,940,762 | 55.6% | 252,991,537 |
| crypto | 419,948 | 2,600,331,706 | 37.8% | 371,475,958 | 1,222,077,444 | 38.4% | 174,582,492 |
| financials | 75,239 | 321,191,754 | 4.7% | 45,884,536 | 151,153,414 | 4.8% | 21,593,345 |
| weather/climate | 8,977 | 28,320,634 | 0.4% | 4,045,805 | 10,994,413 | 0.3% | 1,570,630 |
| economy/Fed/macro | 7,341 | 19,754,617 | 0.3% | 2,822,088 | 13,379,276 | 0.4% | 1,911,325 |
| mentions | 1,050 | 11,004,219 | 0.2% | 1,572,031 | 2,645,981 | 0.1% | 377,997 |
| culture/entertainment | 1,347 | 9,332,277 | 0.1% | 1,333,182 | 6,712,707 | 0.2% | 958,958 |
| politics/elections | 438 | 7,993,872 | 0.1% | 1,141,982 | 4,018,017 | 0.1% | 574,002 |
| tech/AI/science | 521 | 4,112,745 | 0.1% | 587,535 | 1,902,027 | 0.1% | 271,718 |
| geopolitics/war | 38 | 882,567 | 0.0% | 126,081 | 408,162 | 0.0% | 58,309 |

**7 days, sports by league**

| Sports league | Markets settled | Volume (contracts) | Share | Per day (contracts) | Est. taker $ | $ share | Est. taker $/day |
|:--|--:|--:|--:|--:|--:|--:|--:|
| Tennis | 6,286 | 1,042,934,445 | 15.2% | 148,990,635 | 518,179,692 | 16.3% | 74,025,670 |
| NFL | 17,119 | 831,401,447 | 12.1% | 118,771,635 | 374,071,990 | 11.8% | 53,438,856 |
| NCAA football | 14,085 | 665,885,311 | 9.7% | 95,126,473 | 280,415,359 | 8.8% | 40,059,337 |
| MLB | 3,384 | 260,350,722 | 3.8% | 37,192,960 | 107,079,555 | 3.4% | 15,297,079 |
| Soccer: other | 11,800 | 196,965,829 | 2.9% | 28,137,976 | 92,875,638 | 2.9% | 13,267,948 |
| Soccer: UEFA club comps | 5,770 | 171,385,280 | 2.5% | 24,483,611 | 72,871,470 | 2.3% | 10,410,210 |
| NBA | 2,455 | 89,386,894 | 1.3% | 12,769,556 | 43,169,428 | 1.4% | 6,167,061 |
| NHL | 12,542 | 76,633,823 | 1.1% | 10,947,689 | 38,713,647 | 1.2% | 5,530,521 |
| Soccer: MLS | 3,475 | 64,617,786 | 0.9% | 9,231,112 | 29,823,518 | 0.9% | 4,260,503 |
| Esports | 3,907 | 63,650,021 | 0.9% | 9,092,860 | 31,293,757 | 1.0% | 4,470,537 |
| Soccer: La Liga | 1,688 | 62,380,757 | 0.9% | 8,911,537 | 25,596,603 | 0.8% | 3,656,658 |
| Cricket | 262 | 62,372,047 | 0.9% | 8,910,292 | 29,944,990 | 0.9% | 4,277,856 |
| Soccer: Premier League | 2,030 | 60,546,132 | 0.9% | 8,649,447 | 27,992,321 | 0.9% | 3,998,903 |
| UFC/MMA | 454 | 44,431,651 | 0.7% | 6,347,379 | 18,860,401 | 0.6% | 2,694,343 |
| Soccer: Liga MX | 1,096 | 33,751,999 | 0.5% | 4,821,714 | 14,516,724 | 0.5% | 2,073,818 |
| Soccer: Serie A | 1,359 | 32,784,571 | 0.5% | 4,683,510 | 16,074,967 | 0.5% | 2,296,424 |
| Soccer: Ligue 1 | 1,223 | 18,976,556 | 0.3% | 2,710,937 | 8,569,493 | 0.3% | 1,224,213 |
| Soccer: Bundesliga | 1,448 | 18,512,953 | 0.3% | 2,644,708 | 8,084,250 | 0.2% | 1,154,893 |
| Golf | 1,772 | 16,586,985 | 0.2% | 2,369,569 | 2,105,408 | 0.1% | 300,773 |
| Basketball: other | 3,785 | 14,775,633 | 0.2% | 2,110,805 | 7,340,908 | 0.2% | 1,048,701 |

**30 days, by series frequency label**

| Series frequency label | Markets settled | Volume (contracts) | Share | Per day (contracts) | Est. taker $ | $ share | Est. taker $/day |
|:--|--:|--:|--:|--:|--:|--:|--:|
| custom | 410,499 | 15,910,541,923 | 56.8% | 530,351,397 | 7,268,358,653 | 56.1% | 242,278,622 |
| fifteen_min | 60,313 | 10,285,477,717 | 36.8% | 342,849,257 | 4,839,205,098 | 37.3% | 161,306,837 |
| hourly | 2,015,305 | 1,231,757,824 | 4.4% | 41,058,594 | 577,365,931 | 4.5% | 19,245,531 |
| one_off | 37,917 | 272,349,725 | 1.0% | 9,078,324 | 136,085,609 | 1.1% | 4,536,187 |
| daily | 49,890 | 199,777,877 | 0.7% | 6,659,263 | 95,487,831 | 0.7% | 3,182,928 |
| annual | 1,889 | 48,374,384 | 0.2% | 1,612,479 | 22,923,810 | 0.2% | 764,127 |
| weekly | 9,078 | 24,676,487 | 0.1% | 822,550 | 12,701,788 | 0.1% | 423,393 |
| monthly | 2,164 | 18,156,226 | 0.1% | 605,208 | 9,104,002 | 0.1% | 303,467 |
| quarterly | 16 | 26,824 | 0.0% | 894 | 17,489 | 0.0% | 583 |

**30 days, by market lifetime**

| Market lifetime (open→close) | Markets settled | Volume (contracts) | Share | Per day (contracts) | Est. taker $ | $ share | Est. taker $/day |
|:--|--:|--:|--:|--:|--:|--:|--:|
| <1h | 81,301 | 10,299,841,750 | 36.8% | 343,328,058 | 4,846,616,089 | 37.4% | 161,553,870 |
| 1-6h | 1,981,068 | 1,237,571,805 | 4.4% | 41,252,394 | 584,168,047 | 4.5% | 19,472,268 |
| 6-24h | 165,643 | 3,833,010,517 | 13.7% | 127,767,017 | 1,899,097,073 | 14.7% | 63,303,236 |
| 1-7d | 324,548 | 6,706,526,983 | 24.0% | 223,550,899 | 3,106,719,719 | 24.0% | 103,557,324 |
| 1-6w | 28,142 | 5,639,028,115 | 20.1% | 187,967,604 | 2,401,810,598 | 18.5% | 80,060,353 |
| >6w | 6,369 | 275,159,815 | 1.0% | 9,171,994 | 122,838,686 | 0.9% | 4,094,623 |

**30 days, sports by league**

| Sports league | Markets settled | Volume (contracts) | Share | Per day (contracts) | Est. taker $ | $ share | Est. taker $/day |
|:--|--:|--:|--:|--:|--:|--:|--:|
| Tennis | 25,469 | 4,558,504,790 | 16.3% | 151,950,160 | 2,263,679,754 | 17.5% | 75,455,992 |
| NFL | 73,903 | 3,556,375,579 | 12.7% | 118,545,853 | 1,593,350,844 | 12.3% | 53,111,695 |
| NCAA football | 63,644 | 2,556,803,616 | 9.1% | 85,226,787 | 1,094,221,132 | 8.4% | 36,474,038 |
| MLB | 66,879 | 1,613,508,833 | 5.8% | 53,783,628 | 676,538,042 | 5.2% | 22,551,268 |
| Soccer: other | 50,425 | 1,207,247,437 | 4.3% | 40,241,581 | 558,207,862 | 4.3% | 18,606,929 |
| Esports | 14,301 | 255,353,900 | 0.9% | 8,511,797 | 125,309,313 | 1.0% | 4,176,977 |
| UFC/MMA | 1,958 | 252,895,773 | 0.9% | 8,429,859 | 111,234,220 | 0.9% | 3,707,807 |
| Cricket | 1,875 | 225,854,192 | 0.8% | 7,528,473 | 109,837,844 | 0.8% | 3,661,261 |
| WNBA | 8,302 | 215,280,765 | 0.8% | 7,176,025 | 103,628,681 | 0.8% | 3,454,289 |
| Soccer: UEFA club comps | 6,087 | 208,356,824 | 0.7% | 6,945,227 | 89,698,653 | 0.7% | 2,989,955 |
| NHL | 31,678 | 196,955,756 | 0.7% | 6,565,192 | 98,717,502 | 0.8% | 3,290,583 |
| NBA | 5,401 | 185,772,735 | 0.7% | 6,192,425 | 89,931,764 | 0.7% | 2,997,725 |
| Golf | 10,578 | 178,718,833 | 0.6% | 5,957,294 | 58,320,410 | 0.5% | 1,944,014 |
| Soccer: La Liga | 4,330 | 156,520,553 | 0.6% | 5,217,352 | 63,900,278 | 0.5% | 2,130,009 |
| Soccer: MLS | 7,846 | 143,964,330 | 0.5% | 4,798,811 | 66,301,161 | 0.5% | 2,210,039 |
| Soccer: Liga MX | 3,300 | 141,813,330 | 0.5% | 4,727,111 | 60,763,578 | 0.5% | 2,025,453 |
| Soccer: Premier League | 3,944 | 131,936,930 | 0.5% | 4,397,898 | 61,147,798 | 0.5% | 2,038,260 |
| Soccer: Serie A | 2,702 | 62,303,419 | 0.2% | 2,076,781 | 30,565,168 | 0.2% | 1,018,839 |
| Soccer: Bundesliga | 2,691 | 51,182,030 | 0.2% | 1,706,068 | 22,110,785 | 0.2% | 737,026 |
| Basketball: other | 12,298 | 47,048,458 | 0.2% | 1,568,282 | 23,462,036 | 0.2% | 782,068 |

**Daily settled volume**

| UTC close day | Markets settled | Volume (contracts) | Est. taker $ |
|:--|--:|--:|--:|
| 2026-09-20 | 105,546 | 1,219,361,702 | 545,469,393 |
| 2026-09-21 | 79,193 | 803,190,013 | 374,892,756 |
| 2026-09-22 | 81,194 | 845,525,336 | 397,602,393 |
| 2026-09-23 | 85,933 | 749,765,870 | 351,832,759 |
| 2026-09-24 | 76,514 | 752,477,303 | 351,851,291 |
| 2026-09-25 | 85,237 | 889,250,207 | 414,359,581 |
| 2026-09-26 | 87,637 | 937,046,203 | 426,318,443 |
| 2026-09-27 | 99,350 | 1,131,365,516 | 514,720,108 |
| 2026-09-28 | 82,658 | 824,481,491 | 381,864,104 |
| 2026-09-29 | 81,674 | 859,885,676 | 403,441,743 |
| 2026-09-30 | 81,368 | 825,175,833 | 387,828,771 |
| 2026-10-01 | 72,601 | 821,846,256 | 385,926,596 |
| 2026-10-02 | 85,038 | 959,119,108 | 449,025,474 |
| 2026-10-03 | 80,906 | 947,778,420 | 435,125,744 |
| 2026-10-04 | 89,801 | 1,210,836,195 | 549,166,903 |
| 2026-10-05 | 84,095 | 852,983,531 | 400,622,296 |
| 2026-10-06 | 84,649 | 851,955,825 | 400,338,828 |
| 2026-10-07 | 84,291 | 796,882,363 | 374,758,269 |
| 2026-10-08 | 75,153 | 795,040,716 | 373,370,384 |
| 2026-10-09 | 89,960 | 949,614,239 | 445,384,194 |
| 2026-10-10 | 86,638 | 982,695,110 | 448,309,348 |
| 2026-10-11 | 96,808 | 1,287,660,374 | 584,940,135 |
| 2026-10-12 | 83,621 | 814,014,580 | 379,868,495 |
| 2026-10-13 | 89,172 | 974,178,277 | 451,016,352 |
| 2026-10-14 | 92,611 | 884,786,145 | 414,944,074 |
| 2026-10-15 | 80,481 | 863,159,314 | 404,159,786 |
| 2026-10-16 | 89,629 | 983,023,611 | 458,950,031 |
| 2026-10-17 | 88,180 | 1,055,680,112 | 480,445,455 |
| 2026-10-18 | 100,620 | 1,319,195,529 | 594,741,016 |
| 2026-10-19 | 86,513 | 803,164,132 | 379,975,489 |
| 2026-10-20 | 28,227 | 415,317,278 | 191,918,302 |

Reading: 54.9% of 30-day settled contract volume (55.8% over 7 days, 57.6% in taker dollars) was in markets that existed for less than 24 hours. Sports game markets are listed one to two weeks ahead, so they land in the 1–7 day and 1–6 week lifetime buckets even though they resolve on game day; counting them, 98.9% of settled volume sits in the short-term families of section 5. Settled throughput by construction leaves out trading in long-dated markets that have not resolved; the 24-hour comparison in 2b, which covers both, gives the same answer: 93.5% of all contracts traded in the 24 hours before the snapshot were in markets that closed inside that window.

## 5. Short-term recurring series

Families are groups of series with the same structure. A series is included if Kalshi labels it `fifteen_min`, `hourly` or `daily`, or if its instances (events) resolve within about 48 hours, or it is a game-level sports series (one instance per game; median listing life ≤ 30 days, ≥ 3 instances in 30 days). *Instances/day* and *median life* come from the 30-day settled pull; *open now* from the snapshot; *vol/instance* is per event (all strikes summed), median and 90th percentile over settled instances; *spread* is the median YES ask − bid of the most active market per open instance (from live order books at 07:16–07:28 UTC where sampled, otherwise the snapshot, marked *); *top-of-book $* = resting dollars at the best bid and best ask of that market in the snapshot; *book depth ±5¢* = median resting dollars within 5¢ of the best price on both sides (order-book sample). Spreads and depth were measured between 06:40 and 07:28 UTC, i.e. overnight in the US, so index, rates and FX books are thinner than during US trading hours.

### 5a. Non-sports families

| Group | Family | Subjects | Instances/day (30d) | Median life (h) | Open now | Vol/instance median / p90 | Vol/day 30d | Vol/day 7d | Est. taker $/day (7d) | Spread | Top-of-book $ (snapshot) | Book depth ±5¢ | Settlement source | Fee type x multiplier |
|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|:--|:--|
| Crypto | Crypto 15-min up/down | BNB, BTC, DOGE, ETH, HYPE, NEAR, SOL, XRP, ZEC | 854.4 | 0.25 | 9 | 39,755 / 1,609,958 | 305,373,395 | 335,882,923 | 157,864,769 | 1.0¢ | $52 | $2,702 | CF Benchmarks | quadratic x1 |
| Crypto | Crypto above/below (hourly + daily strikes) | BNB, BTC, DOGE, ETH, HYPE, SHIB, SOL, XRP | 165.3 | 1.0 | 22 | 2,203 / 1,032,226 | 35,671,881 | 34,173,948 | 15,959,338 | 3.0¢ | $361 | $6,035 | CF Benchmarks | quadratic x1 |
| Crypto | Crypto price ranges (hourly + daily) | BNB, BTC, DOGE, ETH, HYPE, SHIB, SOL, XRP | 165.3 | 1.0 | 22 | 197 / 23,966 | 1,313,037 | 1,134,535 | 567,357 | 5.0¢ | $24 | $5,095 | CF Benchmarks | quadratic x1 |
| Crypto | Crypto 15-min coin race / comparison | 1 series | 94.9 | 0.25 | 1 | 2,089 / 5,465 | 254,228 | 272,902 | 185,600 | 5.5¢ | $55 | $779 | CF Benchmarks | quadratic x1 |
| Equity indices | Index hourly/close above/below | DJI, INXU, NASDAQ100U, NKY | 18.1 | 11.5 | 16 | 51,500 / 315,925 | 3,251,103 | 1,792,345 | 796,584 | 9.5¢ | $2,016 | $5,252 | Pyth; For example, Google Finance | quadratic x1 |
| Equity indices | Index daily range (S&P/Nasdaq) | INX, NASDAQ100 | 1.4 | 17.5 | 4 | 9,784 / 61,188 | 85,986 | 23,144 | 9,390 | 17.5¢ | $24 | $18 | For example, Google Finance | quadratic x1 |
| Equity indices | Index daily up/down | INXDUD, NASDAQDUD | 1.4 | 20.0 | 2 | 10,799 / 25,037 | 18,943 | 21,839 | 10,554 | 5.0¢ | $2,231 | $4,401 | For example, Google Finance | quadratic x1 |
| Commodities | Commodity 15-min up/down | COPPER, GOLD, NATGAS, PALLADIUM, PLATINUM, SILVER, WTI | 458.8 | 0.25 | 7 | 23,643 / 281,309 | 36,038,463 | 41,699,696 | 19,563,008 | 1.0¢ | $354 | $3,863 | Pyth - Copper; Pyth - Gold | quadratic x1 |
| Commodities | Commodity daily (gold/silver/oil/gas/copper) | BRENT, COPPER, GOLD, NATGAS, SILVER, WTI | 3.4 | 36.0 | 8 | 66,078 / 327,601 | 424,137 | 457,270 | 179,123 | 1.0¢ | $471 | $1,117 | Pyth - Brent; Pyth - Copper | quadratic x1 |
| Commodities | Commodity hourly | GOLD, PALLADIUM, PLATINUM, SILVER, WTI | 78.9 | 2.0 | 10 | 560 / 5,053 | 128,572 | 205,779 | 113,649 | 2.0¢ | $44 | $1,037 | Pyth - Gold; Pyth - Palladium | quadratic x1 |
| Treasury yields / rates | Treasury yield hourly | 10, 2, 30, 5, 7 | 12.4 | 0.98 | 0 | 321 / 3,237 | 13,481 | 56,854 | 55,679 | 89.0¢ | – | $209 | Pyth - 10Y UST; Pyth - 2Y UST | quadratic x1 |
| Treasury yields / rates | Treasury yield daily/weekly | UST10A, UST2A, UST30A, UST5A, UST7A | 0.7 | 168.0 | 5 | 13,808 / 20,036 | 8,714 | 6,547 | 6,415 | 13.5¢ | $30 | $374 | U.S. Department of the Treasury | quadratic x1 |
| Treasury yields / rates | SOFR / reverse repo daily | SOFRD | 0.7 | 22.52 | 1 | 7,541 / 12,019 | 5,738 | 4,232 | 4,179 | 9.0¢ | – | $3,729 | Federal Reserve Bank of New York | quadratic x1 |
| Treasury yields / rates | Treasury yield 15-min | 10, 2, 30, 5 | 2.1 | 0.25 | 0 | 0 / 16 | 44 | 190 | 186 | 87.0¢ | – | $39 | Pyth - 10Y UST; Pyth - 2Y UST | quadratic x1 |
| FX | FX 15-min | AUDUSD, EURUSD, GBPUSD, USDCAD, USDJPY | 220.4 | 0.25 | 5 | 3,088 / 11,118 | 1,183,127 | 1,329,763 | 718,810 | 3.0¢ | $552 | $1,416 | Pyth; Pyth - GBPUSD | quadratic x1 |
| FX | FX daily | AUDUSD, EURUSD, GBPUSD, NZDUSD, USDBRL, USDCAD, USDCHF… | 6.2 | 7.5 | 3 | 0 / 8,266 | 14,953 | 11,600 | 10,317 | 1.0¢ | – | $179 | ICE ; Pyth - NZDUSD | quadratic x1 |
| Gas / energy prices | Gas prices daily, by state (AAA) | 50 series | 35.4 | 15.98 | 0 | 23,430 / 50,749 | 943,226 | 1,333,488 | 1,170,776 | – | – | – | AAA | quadratic x1 |
| Gas / energy prices | Gas price daily, US (AAA) | 1 series | 1.0 | 15.98 | 0 | 289,650 / 449,447 | 317,962 | 421,835 | 203,577 | – | – | – | AAA | quadratic x1 |
| Gas / energy prices | Gas price weekly/monthly (AAA) | 18 series | 0.5 | 579.99 | 18 | 84,337 / 1,286,861 | 224,347 | 243,932 | 104,769 | 1.0¢ | $59 | $1,173 | AAA | quadratic x1; quadratic_with_maker_fe… |
| Gas / energy prices | Diesel price (AAA/EIA) | 8 series | 1.2 | 155.73 | 7 | 77,107 / 154,520 | 104,725 | 54,944 | 27,423 | 11.5¢ | $674 | $93 | AAA | quadratic x1 |
| Gas / energy prices | ERCOT peak demand daily | 2 series | 1.0 | 24.0 | 2 | 17,677 / 39,520 | 21,682 | 28,605 | 15,807 | 1.5¢ | $11,552 | $12,954 | Federal Reserve Bank of New York; Ele… | quadratic x1 |
| Weather | Daily high temperature, by city | 24 series | 24.0 | 40.0 | 31 | 35,466 / 154,018 | 1,703,197 | 1,570,930 | 504,199 | 1.0¢ | $43 | $636 | The Weather Company | quadratic x1 |
| Weather | Rain / snow daily | 8 series | 1.1 | 82.98 | 6 | 1,073,116 / 1,505,260 | 1,113,268 | 1,385,861 | 494,891 | 28.0¢* | $181 | $4,330 | The Weather Company; National Weather… | quadratic x1 |
| Weather | Hourly temperature (directional) | 4 series | 93.9 | 1.0 | 4 | 4,940 / 18,242 | 714,472 | 858,241 | 467,234 | 8.5¢ | $79 | $309 | Synoptic Data; Kalshi | quadratic x1 |
| Weather | Daily low temperature, by city | 24 series | 24.0 | 40.0 | 31 | 4,396 / 13,227 | 159,970 | 162,822 | 74,437 | 8.0¢ | $115 | $104 | The Weather Company | quadratic x1 |
| Weather | Rain / snow weekly / weekend | 2 series | 0.2 | 161.41 | 1 | 153,721 / 298,957 | 32,649 | 42,522 | 16,511 | 3.0¢ | $95 | $343 | The Weather Company | quadratic x1 |
| Weather | Rain / snow monthly totals | 16 series | 0.7 | 483.16 | 33 | 7,934 / 108,160 | 24,470 | 1,754 | 681 | 7.0¢ | $7 | $145 | The Weather Company; NWS Climatologic… | quadratic x1 |
| Weather | Earthquakes (USGS) | 3 series | 1.0 | 28.0 | 5 | 11,340 / 26,502 | 13,897 | 13,719 | 9,625 | 6.0¢ | $20 | $517 | USGS; the United States Geological Su… | quadratic x1 |
| Mentions | Mentions: politicians / speeches / media | 64 series | 5.1 | 48.64 | 43 | 66,224 / 794,019 | 1,212,109 | 1,474,515 | 354,549 | 6.0¢ | $16 | $59,281 | ABC; Federal Reserve | quadratic x1 |
| Mentions | Mentions: earnings calls | 80 series | 0.9 | 605.43 | 78 | 56,708 / 131,659 | 75,269 | 106,189 | 25,533 | 8.0¢ | $89 | $96 | Bloomberg; American Airlines Group In… | quadratic x1 |
| Culture / charts | Rotten Tomatoes scores | 3 series | 0.5 | 1052.0 | 22 | 1,070,591 / 1,772,469 | 531,706 | 732,439 | 526,843 | 18.0¢ | $22,274 | $3,972 | Rotten Tomatoes | quadratic x1 |
| Culture / charts | YouTube views / top video | 12 series | 9.2 | 130.99 | 55 | 9,276 / 43,345 | 147,836 | 161,671 | 116,290 | 1.5¢ | $429 | $3,349 | YouTube Charts; YouTube | quadratic x1 |
| Culture / charts | Netflix top-10 rankings | 10 series | 1.3 | 147.98 | 0 | 38,205 / 217,796 | 64,180 | 51,154 | 36,795 | – | – | – | Netflix | quadratic x1 |
| Culture / charts | Billboard charts | 20 series | 0.7 | 276.97 | 19 | 7,263 / 38,494 | 12,903 | 3,350 | 2,410 | 8.0¢ | $11 | $412 | Spotify; Billboard | quadratic x1 |
| Culture / charts | Steam top sellers | 1 series | 0.1 | 156.8 | 0 | 29,725 / 59,163 | 5,016 | 9,810 | 7,056 | – | – | – | Steam Weekly Top Sellers | quadratic x1 |
| Culture / charts | Spotify charts / streams | 2 series | 0.0 |  | 2 | – | 0 | 0 | 0 | 5.0¢ | $3 | $254 | Spotify; Amazon Prime | quadratic x1 |
| Other recurring | Approval / poll trackers | 2 series | 1.8 | 29.01 | 2 | 237,909 / 522,999 | 431,220 | 452,816 | 234,323 | 9.0¢ | $2,785 | $2,120 | RealClearPolitics; VoteHub | quadratic x1 |
| Other recurring | AI model leaderboards | 4 series | 0.2 | 166.0 | 8 | 247,940 / 499,838 | 62,169 | 40,068 | 21,261 | 2.5¢ | $50 | $3,995 | LM Arena Leaderboard (Remove Style Co… | quadratic x1; quadratic_with_maker_fe… |
| Other recurring | Post counts (Truth Social / X) | 2 series | 0.8 | 95.98 | 2 | 18,872 / 228,140 | 51,322 | 44,219 | 36,269 | 1.5¢ | – | $845 | Roll Call | quadratic x1 |
| Other recurring | Trump daily activity / press office | 7 series | 0.6 | 150.76 | 6 | 3,753 / 133,316 | 25,452 | 28,951 | 17,747 | 3.0¢ | $186 | $1,634 | the White House; Roll Call | quadratic x1 |
| Other recurring | TSA checkpoint numbers | 2 series | 0.5 | 89.98 | 2 | 7,333 / 18,263 | 2,398 | 2,171 | 1,152 | 4.0¢ | $6 | $277 | Transportation Security Administration | quadratic x1 |
| Other recurring | Airport flights / delays | 1 series | 0.0 |  | 1 | – | 0 | 0 | 0 | 6.3¢ | $478 | $1,322 | ABC | quadratic x1 |

### 5b. Per-series detail

**Crypto**

| Series | Title | Subject | Freq label | Instances/day | Median life (h) | Open now | Median vol/inst | p90 vol/inst | Vol/day 30d | Vol/day 7d | Taker $/contract | Spread | Depth ±5¢ |
|:--|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| KXBTC15M | Bitcoin price up down | BTC | fifteen_min | 94.93 | 0.25 | 1 | 2,817,329 | 3,830,265 | 263,436,419 | 285,516,472 | 0.4716 | 0.1¢ | $31,952 |
| KXBTCD | Bitcoin price Above/below | BTC | hourly | 23.47 | 1.0 | 3 | 1,323,299 | 2,280,233 | 34,013,320 | 32,448,412 | 0.4686 | 1.0¢ | $18,058 |
| KXETH15M | ETH 15M price up down | ETH | fifteen_min | 94.93 | 0.25 | 1 | 159,817 | 257,098 | 16,043,032 | 19,228,888 | 0.4271 | 0.1¢ | $2,702 |
| KXXRP15M | XRP 15 Minute | XRP | fifteen_min | 94.93 | 0.25 | 1 | 72,825 | 120,754 | 7,460,868 | 8,775,979 | 0.464 | 0.1¢ | $1,324 |
| KXSOL15M | Solana 15 minutes | SOL | fifteen_min | 94.93 | 0.25 | 1 | 58,544 | 107,072 | 6,236,358 | 8,313,642 | 0.4918 | 0.1¢ | – |
| KXDOGE15M | Dogecoin 15 Minute | DOGE | fifteen_min | 94.93 | 0.25 | 1 | 35,248 | 62,006 | 3,699,137 | 4,362,793 | 0.4963 | 0.3¢ | – |
| KXHYPE15M | Hype 15 min | HYPE | fifteen_min | 94.93 | 0.25 | 1 | 22,092 | 45,109 | 2,476,499 | 2,897,834 | 0.426 | 0.5¢ | – |
| KXZEC15M | Zcash 15min | ZEC | fifteen_min | 94.93 | 0.25 | 1 | 20,365 | 39,882 | 2,240,597 | 2,536,518 | 0.4909 | 0.2¢ | – |
| KXNEAR15M | NEAR 15m | NEAR | fifteen_min | 94.93 | 0.25 | 1 | 18,233 | 37,102 | 2,064,394 | 2,362,495 | 0.484 | 2.0¢ | – |
| KXBNB15M | BNB 15 Minute | BNB | fifteen_min | 94.93 | 0.25 | 1 | 15,190 | 30,629 | 1,716,092 | 1,888,301 | 0.5579 | 0.3¢ | – |
| KXETHD | Ethereum price Above/below | ETH | hourly | 23.47 | 1.0 | 3 | 31,453 | 113,211 | 1,341,840 | 1,448,228 | 0.4306 | 1.0¢ | $5,906 |
| KXBTC | Bitcoin range | BTC | hourly | 23.47 | 1.0 | 3 | 29,427 | 78,045 | 989,143 | 897,502 | 0.504 | 3.0¢ | $7,911 |
| KXCRYPTOLEAD15M | Coin Race 15 minutes |  | fifteen_min | 94.93 | 0.25 | 1 | 2,089 | 5,465 | 254,228 | 272,902 | 0.6801 | 9.0¢ | $779 |
| KXETH | Ethereum range | ETH | hourly | 23.47 | 1.0 | 3 | 1,307 | 15,515 | 248,350 | 205,079 | 0.4642 | 5.0¢ | $4,717 |
| KXSOLD | SOL Directional | SOL | hourly | 23.47 | 1.0 | 3 | 4,257 | 11,923 | 150,963 | 163,806 | 0.4807 | 9.0¢ | $4,784 |
| KXXRPD | XRP Price above/below | XRP | hourly | 23.47 | 1.0 | 3 | 1,647 | 5,148 | 78,414 | 55,811 | 0.2802 | 6.0¢ | – |
| KXHYPED | Hype Directional | HYPE | hourly | 23.47 | 1.0 | 3 | 1,236 | 3,133 | 37,101 | 23,663 | 0.6652 | 6.0¢ | – |
| KXDOGE | Dogecoin range | DOGE | hourly | 23.47 | 1.0 | 3 | 78 | 776 | 30,900 | 11,568 | 0.5946 | 26.0¢ | $2,781 |
| KXDOGED | Dogecoin price Above/below | DOGE | hourly | 23.47 | 1.0 | 3 | 187 | 1,725 | 26,669 | 16,140 | 0.5678 | 16.0¢ | – |
| KXSHIBA | Shiba range | SHIB | daily | 1.0 | 25.0 | 1 | 512 | 84,492 | 21,248 | 1,778 | – | – | – |
| KXSHIBAD | Shiba price Above/below | SHIB | daily | 1.0 | 25.0 | 1 | 263 | 27,424 | 12,705 | 1,801 | – | – | – |
| KXBNBD | BNB Directional | BNB | hourly | 23.47 | 1.0 | 3 | 202 | 864 | 10,870 | 16,085 | 0.639 | 33.5¢ | – |
| KXXRP | XRP Range | XRP | hourly | 23.47 | 1.0 | 3 | 177 | 929 | 10,032 | 5,868 | 0.5708 | 12.0¢ | – |
| KXHYPE | Hype | HYPE | hourly | 23.47 | 1.0 | 3 | 98 | 481 | 5,079 | 3,109 | 0.9594 | – | – |
| KXSOLE | SOL Range | SOL | hourly | 23.47 | 1.0 | 3 | 122 | 418 | 4,624 | 4,159 | 0.6305 | 7.0¢ | – |
| KXBNB | BNB | BNB | hourly | 23.47 | 1.0 | 3 | 84 | 279 | 3,662 | 5,472 | 0.566 | 27.0¢ | – |

**Equity indices (S&P 500, Nasdaq-100, Dow, Nikkei)**

| Series | Title | Subject | Freq label | Instances/day | Median life (h) | Open now | Median vol/inst | p90 vol/inst | Vol/day 30d | Vol/day 7d | Taker $/contract | Spread | Depth ±5¢ |
|:--|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| KXINXU | S&P 500 above/below | INXU | hourly | 4.9 | 22.0 | 7 | 175,369 | 727,223 | 1,634,075 | 984,276 | 0.3421 | 17.0¢ | $5,324 |
| KXNASDAQ100U | Nasdaq above/below | NASDAQ100U | hourly | 4.9 | 22.0 | 7 | 121,889 | 393,138 | 1,559,390 | 753,221 | 0.5532 | 13.0¢ | $5,305 |
| KXDJI | DJI Hourly | DJI | hourly | 4.9 | 1.0 | 2 | 4,844 | 19,343 | 57,630 | 54,815 | 0.7875 | 4.0¢ | $2,016 |
| KXINX | S&P 500 range | INX | daily | 0.7 | 17.5 | 2 | 19,499 | 51,978 | 43,060 | 18,636 | 0.4086 | 5.0¢ | $13 |
| KXNASDAQ100 | Nasdaq range | NASDAQ100 | daily | 0.7 | 17.5 | 2 | 5,273 | 62,211 | 42,926 | 4,508 | 0.3938 | 35.0¢ | $27 |
| KXINXDUD | INXDUD | INXDUD | daily | 0.7 | 20.0 | 1 | 20,693 | 28,038 | 15,187 | 18,034 | 0.4602 | 2.0¢ | $2,937 |
| KXNASDAQDUD | NASDAQDUD | NASDAQDUD | daily | 0.7 | 20.0 | 1 | 4,382 | 10,719 | 3,756 | 3,805 | 0.5926 | 7.0¢ | $5,865 |
| KXNKY | NKY Hourly | NKY | hourly | 3.4 | 0.98 | 0 | 0 | 0 | 8 | 34 | – | – | – |

**Commodities (gold, silver, oil, natural gas, copper, platinum, palladium)**

| Series | Title | Subject | Freq label | Instances/day | Median life (h) | Open now | Median vol/inst | p90 vol/inst | Vol/day 30d | Vol/day 7d | Taker $/contract | Spread | Depth ±5¢ |
|:--|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| KXGOLD15M | Gold 15-minute | GOLD | fifteen_min | 65.63 | 0.25 | 1 | 345,258 | 520,688 | 22,994,456 | 26,678,229 | 0.4522 | 1.0¢ | $8,753 |
| KXWTI15M | WTI 15-minute | WTI | fifteen_min | 69.57 | 0.25 | 1 | 81,193 | 145,008 | 6,133,007 | 7,914,271 | 0.4771 | 1.0¢ | $3,863 |
| KXSILVER15M | Silver 15-minute | SILVER | fifteen_min | 64.1 | 0.25 | 1 | 45,949 | 85,572 | 3,292,587 | 3,379,551 | 0.495 | 1.0¢ | $2,655 |
| KXNATGAS15M | Natural Gas 15-minute | NATGAS | fifteen_min | 69.57 | 0.25 | 1 | 16,847 | 35,801 | 1,399,319 | 1,645,495 | 0.5308 | 1.0¢ | – |
| KXCOPPER15M | Copper 15-minute | COPPER | fifteen_min | 64.1 | 0.25 | 1 | 17,270 | 34,717 | 1,288,933 | 1,252,715 | 0.5617 | 2.0¢ | – |
| KXPALLADIUM15M | Palladium 15-minute | PALLADIUM | fifteen_min | 62.93 | 0.25 | 1 | 6,055 | 14,446 | 481,724 | 419,290 | 0.5327 | 4.0¢ | – |
| KXPLATINUM15M | Platinum 15-minute | PLATINUM | fifteen_min | 62.93 | 0.25 | 1 | 6,063 | 12,088 | 448,436 | 410,146 | 0.6093 | 4.0¢ | – |
| KXWTI | WTI oil on day | WTI | daily | 0.67 | 43.0 | 3 | 333,656 | 566,378 | 245,926 | 249,504 | 0.3158 | 2.0¢ | $2,775 |
| KXGOLDH | Gold Hourly | GOLD | hourly | 16.07 | 2.0 | 2 | 4,123 | 10,105 | 82,857 | 127,073 | 0.4874 | 6.0¢ | $1,147 |
| KXGOLDD | Gold Daily | GOLD | daily | 0.57 | 36.0 | 1 | 100,011 | 160,765 | 62,561 | 79,800 | 0.5032 | 1.0¢ | $1,117 |
| KXNATGASD | Natural Gas Daily | NATGAS | daily | 0.53 | 36.0 | 1 | 61,513 | 148,429 | 39,288 | 33,216 | 0.5404 | 3.0¢ | – |
| KXBRENTD | Brent Oil Daily | BRENT | daily | 0.53 | 36.0 | 1 | 61,501 | 111,537 | 34,806 | 29,629 | 0.4407 | 1.0¢ | – |
| KXCOPPERD | Daily Copper | COPPER | daily | 0.57 | 36.0 | 1 | 31,557 | 110,380 | 24,449 | 45,265 | 0.4689 | 1.0¢ | $796 |
| KXSILVERH | Silver Hourly | SILVER | hourly | 15.33 | 2.0 | 2 | 836 | 3,612 | 24,187 | 53,863 | 0.7089 | 2.0¢ | $1,037 |
| KXSILVERD | Silver daily | SILVER | daily | 0.57 | 36.0 | 1 | 28,993 | 45,540 | 17,107 | 19,855 | 0.4 | 2.0¢ | – |
| KXWTIH | WTI Hourly | WTI | hourly | 15.83 | 2.0 | 2 | 884 | 1,794 | 16,072 | 19,333 | 0.478 | – | $68 |
| KXPALLADIUMH | Palladium Hourly | PALLADIUM | hourly | 15.83 | 2.0 | 2 | 126 | 724 | 4,538 | 2,971 | 0.9717 | 32.0¢ | – |
| KXPLATINUMH | Platinum Hourly | PLATINUM | hourly | 15.83 | 2.0 | 2 | 0 | 155 | 918 | 2,540 | – | – | – |

**Treasury yields and money-market rates**

| Series | Title | Subject | Freq label | Instances/day | Median life (h) | Open now | Median vol/inst | p90 vol/inst | Vol/day 30d | Vol/day 7d | Taker $/contract | Spread | Depth ±5¢ |
|:--|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| KXSOFRD | Daily SOFR | SOFRD | daily | 0.67 | 22.52 | 1 | 7,541 | 12,019 | 5,738 | 4,232 | 0.9874 | – | $3,729 |
| KX10YRRATEH | US 10Y Treasury yield hourly | 10 | hourly | 2.47 | 0.98 | 0 | 485 | 3,945 | 3,457 | 14,627 | 0.9547 | – | $153 |
| KX30YRRATEH | US 30Y Treasury yield hourly | 30 | hourly | 2.47 | 0.98 | 0 | 500 | 3,785 | 3,042 | 12,664 | 0.99 | – | $280 |
| KXUST10A | UST 10 Year Weekly | UST10A | daily | 0.13 | 168.0 | 1 | 21,070 | 24,551 | 2,758 | 2,157 | – | 11.0¢ | $413 |
| KX7YRRATEH | US 7Y Treasury yield hourly | 7 | hourly | 2.47 | 0.98 | 0 | 247 | 3,066 | 2,560 | 10,871 | 0.9817 | – | $209 |
| KX5YRRATEH | US 5Y Treasury yield hourly | 5 | hourly | 2.47 | 0.98 | 0 | 304 | 3,009 | 2,365 | 9,964 | 0.99 | – | – |
| KX2YRRATEH | US 2Y Treasury yield hourly | 2 | hourly | 2.47 | 0.98 | 0 | 154 | 2,186 | 2,057 | 8,728 | 0.99 | – | – |
| KXUST7A | UST 7 Year Daily | UST7A | daily | 0.13 | 168.0 | 1 | 10,947 | 17,314 | 1,550 | 811 | – | – | – |
| KXUST5A | UST 5 Year Daily | UST5A | daily | 0.13 | 168.0 | 1 | 12,159 | 14,699 | 1,536 | 1,455 | – | – | $374 |
| KXUST30A | UST 30 Year Daily | UST30A | daily | 0.13 | 168.0 | 1 | 12,590 | 14,188 | 1,516 | 866 | – | – | – |
| KXUST2A | UST 2 Year Daily | UST2A | daily | 0.13 | 168.0 | 1 | 9,537 | 13,273 | 1,354 | 1,257 | – | 13.0¢ | $320 |
| KX30YRRATE15M | 30-year Treasury yield 15-minute | 30 | fifteen_min | 0.53 | 0.25 | 0 | 0 | 152 | 20 | 87 | – | – | $22 |
| KX10YRRATE15M | 10-year Treasury yield 15-minute | 10 | fifteen_min | 0.53 | 0.25 | 0 | 0 | 5 | 13 | 57 | – | – | $42 |
| KX5YRRATE15M | 5-year Treasury yield 15-minute | 5 | fifteen_min | 0.53 | 0.25 | 0 | 0 | 22 | 9 | 38 | – | – | $39 |
| KX2YRRATE15M | 2-year Treasury yield 15-minute | 2 | fifteen_min | 0.53 | 0.25 | 0 | 0 | 15 | 2 | 8 | – | – | – |

**FX**

| Series | Title | Subject | Freq label | Instances/day | Median life (h) | Open now | Median vol/inst | p90 vol/inst | Vol/day 30d | Vol/day 7d | Taker $/contract | Spread | Depth ±5¢ |
|:--|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| KXEURUSD15M | 15-minute EURUSD | EURUSD | fifteen_min | 56.6 | 0.25 | 1 | 4,302 | 13,379 | 390,935 | 372,137 | 0.5083 | 3.0¢ | $1,416 |
| KXGBPUSD15M | 15-minute GBPUSD | GBPUSD | fifteen_min | 56.6 | 0.25 | 1 | 3,511 | 13,039 | 363,067 | 258,319 | 0.5061 | 2.0¢ | $1,368 |
| KXUSDJPY15M | Fifteen-min USDJPY | USDJPY | fifteen_min | 56.6 | 0.25 | 1 | 3,403 | 10,857 | 310,127 | 300,108 | 0.5302 | 3.0¢ | $2,301 |
| KXUSDCAD15M | 15-minute USDCAD | USDCAD | fifteen_min | 25.3 | 0.25 | 1 | 1,736 | 5,969 | 67,193 | 231,628 | 0.5709 | 3.0¢ | – |
| KXAUDUSD15M | 15-minute AUDUSD | AUDUSD | fifteen_min | 25.3 | 0.25 | 1 | 1,484 | 4,088 | 51,805 | 167,571 | 0.6419 | 3.0¢ | – |
| KXEURUSD | EUR/USD daily range | EURUSD | daily | 0.67 | 24.0 | 1 | 8,855 | 13,687 | 7,182 | 6,383 | 0.8897 | – | $742 |
| KXUSDJPY | USD/JPY daily range | USDJPY | daily | 0.67 | 24.0 | 1 | 6,746 | 13,207 | 5,356 | 5,041 | 0.8891 | – | $458 |
| KXUSDCADAD | USDCAD Daily | USDCAD | daily | 0.53 | 7.5 | 0 | 593 | 4,648 | 741 | 0 | – | – | – |
| KXGBPUSDAD | GBPUSD Daily | GBPUSD | daily | 0.53 | 7.5 | 0 | 252 | 2,790 | 626 | 34 | – | – | – |
| KXAUDUSDAD | AUDUSD Daily | AUDUSD | daily | 0.53 | 7.5 | 0 | 75 | 2,729 | 483 | 3 | – | – | – |
| KXNZDUSD | NZDUSD Weekly | NZDUSD | weekly | 0.13 | 103.5 | 1 | 2,330 | 5,510 | 404 | 138 | – | – | $96 |
| KXUSDJPYAD | USDJPY Daily | USDJPY | daily | 0.53 | 7.5 | 0 | 0 | 604 | 110 | 0 | – | – | – |
| KXNZDUSDAD | NZDUSD Daily | NZDUSD | daily | 0.53 | 7.5 | 0 | 0 | 188 | 34 | 0 | – | – | – |
| KXUSDCHFAD | USDCHF Weekly | USDCHF | daily | 0.53 | 7.5 | 0 | 0 | 122 | 18 | 0 | – | – | – |

**Gas and energy prices**

| Series | Title | Subject | Freq label | Instances/day | Median life (h) | Open now | Median vol/inst | p90 vol/inst | Vol/day 30d | Vol/day 7d | Taker $/contract | Spread | Depth ±5¢ |
|:--|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| KXAAAGASD | US gas price up |  | daily | 1.0 | 15.98 | 0 | 289,650 | 449,447 | 317,962 | 421,835 | 0.4826 | – | – |
| KXAAAGASW | US gas price up |  | weekly | 0.17 | 157.98 | 1 | 1,252,348 | 1,392,238 | 188,121 | 178,907 | 0.4295 | 1.0¢ | $1,173 |
| KXDIESELD | Daily Diesel Price |  | daily | 1.0 | 17.98 | 0 | 57,945 | 110,019 | 61,585 | 33,608 | 0.4991 | – | – |
| KXAAAGASDFL | Florida gas price |  | daily | 1.0 | 15.98 | 0 | 43,183 | 89,475 | 54,873 | 50,993 | 0.8475 | – | – |
| KXAAAGASDNC | North Carolina gas price |  | daily | 1.0 | 15.98 | 0 | 34,613 | 67,982 | 45,499 | 42,631 | 0.8934 | – | – |
| KXAAAGASDOH | Ohio gas price |  | daily | 1.0 | 15.98 | 0 | 35,332 | 87,101 | 45,426 | 38,680 | 0.9583 | – | – |
| KXAAAGASDGA | Georgia gas price |  | daily | 1.0 | 15.98 | 0 | 29,452 | 68,887 | 37,329 | 31,743 | 0.9887 | – | – |
| KXAAAGASDSC | South Carolina gas price |  | daily | 1.0 | 15.98 | 0 | 32,326 | 61,295 | 37,144 | 29,246 | 0.8154 | – | – |
| KXAAAGASDNJ | New Jersey gas prices |  | daily | 1.0 | 15.98 | 0 | 27,889 | 56,706 | 34,536 | 30,487 | 0.94 | – | – |
| KXAAAGASDCA | California gas price |  | daily | 1.0 | 15.98 | 0 | 28,196 | 49,136 | 33,923 | 29,668 | 0.857 | – | – |
| KXAAAGASDTX | TX gas price |  | daily | 1.0 | 15.98 | 0 | 30,241 | 47,772 | 33,658 | 36,466 | 0.843 | – | – |
| KXAAAGASDMI | Michigan gas price |  | daily | 1.0 | 15.98 | 0 | 28,655 | 48,784 | 33,004 | 24,864 | 0.8472 | – | – |
| KXAAAGASDMD | Maryland gas price |  | daily | 1.0 | 15.98 | 0 | 23,888 | 49,208 | 31,822 | 24,548 | 0.8912 | – | – |
| KXAAAGASDCO | Colorado gas price |  | daily | 1.0 | 15.98 | 0 | 27,315 | 54,549 | 30,964 | 22,154 | 0.7588 | – | – |
| KXAAAGASDPA | Pennsylvania gas price |  | daily | 1.0 | 15.98 | 0 | 25,658 | 52,060 | 30,695 | 30,546 | 0.9083 | – | – |

**Weather**

| Series | Title | Subject | Freq label | Instances/day | Median life (h) | Open now | Median vol/inst | p90 vol/inst | Vol/day 30d | Vol/day 7d | Taker $/contract | Spread | Depth ±5¢ |
|:--|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| KXRAIN | Where will it rain daily |  | daily | 1.0 | 46.83 | 2 | 1,102,439 | 1,519,739 | 1,110,958 | 1,385,861 | 0.3571 | 2.0¢ | $4,330 |
| KXHIGHLAX | Highest temperature in Los Angeles |  | daily | 1.0 | 42.0 | 2 | 510,319 | 964,497 | 548,903 | 383,307 | 0.3317 | 1.0¢ | $247,749 |
| KXTEMPMIAH | Hourly Directional Miami Temperature |  | hourly | 23.53 | 1.0 | 1 | 15,885 | 31,489 | 420,663 | 525,620 | 0.5788 | – | $303 |
| KXHIGHMIA | Highest temperature in Miami |  | daily | 1.0 | 39.0 | 1 | 152,648 | 275,135 | 174,667 | 144,751 | 0.1618 | 1.0¢ | $364 |
| KXHIGHNY | Highest temperature in NYC |  | daily | 1.0 | 39.0 | 1 | 160,932 | 229,637 | 167,885 | 222,659 | 0.2686 | 1.0¢ | $636 |
| KXTEMPNYCHS | Hourly Directional NYC Temperature |  | hourly | 23.17 | 1.0 | 1 | 4,306 | 8,501 | 110,547 | 142,207 | 0.4065 | 16.0¢ | $336 |
| KXHIGHCHI | Highest temperature in Chicago |  | daily | 1.0 | 40.0 | 1 | 94,441 | 183,552 | 104,763 | 112,472 | 0.2431 | 1.0¢ | – |
| KXTEMPLAXHS | Hourly Directional Coastal LA Temperatu… |  | hourly | 23.53 | 1.0 | 1 | 3,655 | 8,143 | 97,270 | 104,675 | 0.5481 | 4.0¢ | $360 |
| KXTEMPCHIHS | Hourly Directional Chicago Metro Temper… |  | hourly | 23.63 | 1.0 | 1 | 3,215 | 6,607 | 85,993 | 85,740 | 0.5578 | 3.0¢ | – |
| KXHIGHTPHX | Phoenix High Temperature Daily |  | daily | 1.0 | 41.0 | 2 | 59,845 | 103,654 | 71,842 | 58,260 | 0.4565 | 2.0¢ | – |
| KXHIGHTSFO | San Francisco High Temperature Daily |  | daily | 1.0 | 42.0 | 2 | 51,168 | 123,811 | 65,743 | 69,559 | 0.4187 | 1.0¢ | – |
| KXHIGHTATL | Atlanta Max Temperature |  | daily | 1.0 | 39.0 | 1 | 43,992 | 141,101 | 65,219 | 44,147 | 0.3697 | 2.0¢ | – |
| KXHIGHAUS | Highest temperature in Austin |  | daily | 1.0 | 40.0 | 1 | 56,635 | 81,780 | 63,331 | 76,379 | 0.1524 | 2.0¢ | – |
| KXHIGHTDAL | Dallas Maximum Temperature |  | daily | 1.0 | 40.0 | 1 | 50,150 | 77,610 | 53,726 | 41,435 | 0.2944 | 2.0¢ | – |
| KXHIGHDEN | Highest temperature in Denver |  | daily | 1.0 | 41.0 | 2 | 41,943 | 66,852 | 45,010 | 51,026 | 0.4427 | 1.0¢ | – |
| KXHIGHPHIL | Highest temperature in Philadelphia |  | daily | 1.0 | 39.0 | 1 | 46,706 | 59,111 | 48,571 | 64,104 | 0.3705 | 1.0¢ | – |
| KXHIGHTSEA | Seattle Maximum Temperature Daily |  | daily | 1.0 | 42.0 | 2 | 36,868 | 54,631 | 40,796 | 33,425 | 0.4337 | 1.0¢ | – |
| KXHIGHTBOS | Boston Maximum Daily Temperature |  | daily | 1.0 | 39.0 | 1 | 28,413 | 54,161 | 33,918 | 43,804 | 0.4408 | 1.0¢ | – |
| KXHIGHTOKC | Oklahoma City Maximum High Temperature |  | daily | 1.0 | 40.0 | 1 | 29,849 | 48,296 | 33,385 | 35,329 | 0.4462 | – | – |
| KXHIGHTHOU | Daily High Temperature Houston |  | daily | 1.0 | 40.0 | 1 | 28,888 | 48,704 | 33,368 | 43,693 | 0.1568 | 1.0¢ | – |
| KXRAINWKND | Where will it rain this weekend? |  | weekly | 0.17 | 166.83 | 1 | 188,647 | 299,218 | 32,589 | 42,522 | – | 2.0¢ | $343 |
| KXHIGHTMIN | Minneapolis Daily High Temperature |  | daily | 1.0 | 40.0 | 1 | 29,248 | 42,580 | 31,544 | 26,709 | 0.5819 | 3.0¢ | – |
| KXHIGHTDC | Washington DC Daily Max Temp |  | daily | 1.0 | 39.0 | 1 | 28,226 | 49,569 | 31,115 | 34,259 | 0.2889 | 1.0¢ | – |
| KXHIGHTLV | Las Vegas Max Daily Temperature |  | daily | 1.0 | 42.0 | 2 | 25,150 | 46,923 | 29,366 | 22,887 | 0.5182 | 2.0¢ | – |
| KXLOWTNYC | Lowest temperature in NYC |  | daily | 1.0 | 39.0 | 1 | 16,441 | 30,108 | 21,477 | 17,267 | 0.2752 | – | $23,344 |
| KXHIGHTNOLA | New Orleans Max temp Daily |  | daily | 1.0 | 40.0 | 1 | 15,598 | 26,809 | 19,754 | 18,134 | 0.5231 | 1.0¢ | – |
| KXHIGHTSATX | San Antonio Daily Maximum Temperature |  | daily | 1.0 | 40.0 | 1 | 13,368 | 22,193 | 17,080 | 21,302 | 0.427 | 1.0¢ | – |
| KXBIGGESTQUAKE | Biggest earthquake |  | daily | 1.0 | 28.0 | 1 | 11,340 | 26,502 | 13,897 | 13,719 | 0.7016 | 13.0¢ | $178 |
| KXLOWTDEN | Lowest temperature in Denver |  | daily | 1.0 | 41.0 | 2 | 9,177 | 16,938 | 11,305 | 20,019 | 0.6836 | 4.5¢ | $93 |
| KXLOWTLAX | Lowest Temperature in LA |  | daily | 1.0 | 42.0 | 2 | 8,196 | 19,138 | 11,364 | 11,434 | 0.4029 | 1.0¢ | – |

**Economic releases (per release; history back to mid-Aug)**

Monthly and weekly releases do not fit a 30-day window, so this table uses every settled instance since mid-August (per-series pull). Volume per release is the event total over all strikes. The Fed decision market is in a class of its own: the September 16 FOMC event (`KXFEDDECISION-26SEP`) traded 103.2M contracts, about 24 times the 4.31M contracts traded across the six main CPI series on the October 14 release.

| Series | Title | Freq | Releases settled since mid-Aug | Latest releases: close date, contracts | Mean contracts per release | Open events | Open 24h vol | Open OI | Settlement source | Fee |
|:--|:--|:--|--:|:--|--:|--:|--:|--:|:--|:--|
| KXFEDDECISION | Fed meeting | custom | 1 | 2026-09-16 103,205,253 | 103,205,253 | 11 | 183,796 | 7,220,760 | Federal Reserve | quadratic_with_maker_fees x1 |
| KXFED | Fed funds rate | custom | 1 | 2026-09-16 2,792,963 | 2,792,963 | 11 | 7,469 | 694,417 | Federal Reserve Board of Gove… | quadratic_with_maker_fees x1 |
| KXCPIYOY | Inflation | monthly | 2 | 2026-10-14 1,614,325; 2026-09-11 904,852 | 1,259,589 | 2 | 11,304 | 428,675 | Bureau of Labor Statistics | quadratic_with_maker_fees x1 |
| KXCPI | CPI | monthly | 2 | 2026-10-14 1,595,825; 2026-09-11 518,724 | 1,057,274 | 3 | 22,983 | 486,928 | Bureau of Labor Statistics | quadratic_with_maker_fees x1 |
| KXCPICORE | CPI core | monthly | 2 | 2026-10-14 521,047; 2026-09-11 73,570 | 297,308 | 3 | 12,792 | 389,298 | Bureau of Labor Statistics | quadratic x1 |
| KXCPICOREYOY | Core inflation | monthly | 2 | 2026-10-14 463,047; 2026-09-11 64,209 | 263,628 | 2 | 14,945 | 153,930 | Bureau of Labor Statistics | quadratic x1 |
| KXECONSTATCPI | month over month inflation | monthly | 2 | 2026-10-14 78,566; 2026-09-11 15,442 | 47,004 | 3 | 137 | 9,555 | Bureau of Labor Statistics- E… | quadratic x1 |
| KXU3 | Unemployment | monthly | 2 | 2026-10-02 539,422; 2026-09-04 605,921 | 572,672 | 2 | 5,487 | 123,531 | Bureau of Labor Statistics | quadratic_with_maker_fees x1 |
| KXPAYROLLS | Jobs numbers | monthly | 2 | 2026-10-02 437,152; 2026-09-04 359,121 | 398,137 | 2 | 2,440 | 113,064 | BLS | quadratic_with_maker_fees x1 |
| KXECONSTATU3 | UNEMPLOYMENT RATE MONTHLY | monthly | 2 | 2026-10-02 47,203; 2026-09-04 55,388 | 51,295 | 2 | 818 | 43,830 | Bureau of Labor Statistics- E… | quadratic x1 |
| KXJOBLESSCLAIMS | Weekly initial jobless claims | weekly | 10 | 2026-10-15 13,227; 2026-10-08 17,906; 2026-10-01 5,831 | 17,282 | 1 | 6,666 | 7,501 | Department of Labor | quadratic x1 |
| KXCONTCLAIMS | U.S. continuing jobless claims | weekly | 8 | 2026-10-15 1,024; 2026-10-08 1,763; 2026-10-01 3,280 | 1,296 | 1 | 2 | 30 | Federal Reserve Bank of New Y… | quadratic x1 |
| KXPCECORE | US Core PCE inflation | monthly | 2 | 2026-09-30 21,256; 2026-08-26 63,621 | 42,438 | 3 | 178 | 5,145 | Bureau of Economic Analysis | quadratic x1 |
| KXPCEHEAD | U.S. headline PCE inflation | monthly | 1 | 2026-09-30 3,691 | 3,691 | 1 | 2,125 | 8,233 | Federal Reserve Bank of New Y… | quadratic x1 |
| KXADP | ADP employment change | monthly | 2 | 2026-09-30 7,248; 2026-09-02 14,066 | 10,657 | 2 | 400 | 3,011 | ADP | quadratic x1 |
| KXCBDECISIONCANADA | Bank Of Canada policy interest ra… | custom | 1 | 2026-09-02 17,923 | 17,923 | 2 | 99,728 | 166,436 | Bank of Canada | quadratic x1 |
| KXUE | Monthly Unemployment | monthly | 17 | 2026-10-19 6,518; 2026-10-15 1,102; 2026-10-09 1,926 | 10,509 | 8 | 3,374 | 13,206 | Trading Economics | quadratic x1 |
| KXTSAW | TSA check-ins this week | weekly | 10 | 2026-10-19 12,679; 2026-10-12 11,811; 2026-10-05 7,324 | 12,906 | 1 | 1,728 | 1,562 | Transportation Security Admin… | quadratic x1 |
| KXTSAD | Daily TSA passenger screenings | daily | 10 | 2026-10-19 307; 2026-10-18 60; 2026-10-17 1,386 | 2,158 | 1 | 31 | 31 | Transportation Security Admin… | quadratic x1 |
| KXTOPSONG | Billboard Hot 100 #1 | weekly | 11 | 2026-10-19 19,622; 2026-10-12 38,494; 2026-10-05 188,020 | 42,525 | 1 | 9,281 | 14,090 | Billboard | quadratic x1 |
| KXTOPALBUM | Billboard Top 200 #1 | weekly | 9 | 2026-10-12 793; 2026-10-05 0; 2026-09-28 7,263 | 4,348 | 1 | 27 | 1,040 | Billboard | quadratic x1 |
| KXNETFLIXRANKSHOW | Netflix TV ranking | weekly | 9 | 2026-10-13 59,535; 2026-10-06 172,197; 2026-09-29 86,200 | 177,371 | 0 | 0 | 0 | Netflix | quadratic x1 |
| KXNETFLIXRANKMOVIE | Netflix movie ranking | weekly | 9 | 2026-10-13 90,081; 2026-10-06 125,421; 2026-09-29 109,270 | 204,210 | 0 | 0 | 0 | Netflix | quadratic x1 |

**Mentions**

| Series | Title | Subject | Freq label | Instances/day | Median life (h) | Open now | Median vol/inst | p90 vol/inst | Vol/day 30d | Vol/day 7d | Taker $/contract | Spread | Depth ±5¢ |
|:--|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| KXTRUMPMENTION | What will Trump say? |  | one_off | 0.63 | 48.98 | 8 | 1,003,163 | 1,492,969 | 593,243 | 837,538 | 0.2575 | 1.5¢ | $121,162 |
| KXTRUMPSAY | What will trump say |  | one_off | 0.2 | 169.25 | 1 | 925,249 | 1,308,568 | 174,817 | 110,982 | – | – | $77,693 |
| KXTRUMPMENTIONB | Trump Mention B |  | one_off | 0.27 | 24.57 | 2 | 431,370 | 848,680 | 129,429 | 213,909 | 0.1737 | 13.0¢ | $27,209 |
| KXWORLDNEWSMENTION | World News Mention |  | one_off | 0.67 | 6.21 | 0 | 130,694 | 160,962 | 87,101 | 90,653 | – | – | – |
| KXBERNIEMENTION | Bernie says |  | one_off | 0.23 | 129.25 | 3 | 109,991 | 210,058 | 32,990 | 74,811 | – | 7.5¢ | – |
| KXVANCEMENTION | Vance Says |  | one_off | 0.33 | 28.52 | 3 | 81,811 | 182,751 | 36,040 | 39,758 | – | 11.0¢ | – |
| KXTRUMPSAYCOMPANY | Will Trump mention company |  | one_off | 0.07 | 551.26 | 1 | 293,930 | 501,192 | 19,595 | 4,979 | – | – | – |
| KXTRUMPSAYNICKNAME | Trump Nickname |  | one_off | 0.07 | 1122.79 | 1 | 277,558 | 499,255 | 18,504 | 0 | – | 9.0¢ | – |
| KXCARNEYMENTION | Carney Mention |  | one_off | 0.07 | 324.84 | 1 | 244,996 | 422,603 | 16,333 | 0 | – | 19.0¢ | – |
| KXTRUMPSAYMONTH | Trump Monthly |  | one_off | 0.07 | 569.44 | 1 | 170,324 | 271,930 | 11,355 | 6,188 | – | – | – |
| KXEARNINGSMENTIONCOST | What will Costco say on their next earn… |  | one_off | 0.03 | 725.91 | 1 | 263,853 | 263,853 | 8,795 | 0 | – | 9.0¢ | – |
| KXLASTWORDMENTION | Last Word |  | one_off | 0.27 | 16.55 | 0 | 31,162 | 44,677 | 8,118 | 3,020 | – | – | – |
| KXDEBATEMENTION | Debate Mentions |  | one_off | 0.2 | 51.2 | 1 | 31,924 | 40,201 | 6,463 | 4,588 | – | 16.0¢ | – |
| KXEARNINGSMENTIONDPZ | Dominos |  | one_off | 0.03 | 1962.44 | 1 | 190,704 | 190,704 | 6,357 | 27,243 | – | 4.0¢ | $91 |
| KXEARNINGSMENTIONCCL | Carnival Cruise Earnings Call |  | one_off | 0.03 | 1629.4 | 1 | 180,828 | 180,828 | 6,028 | 0 | – | 6.0¢ | – |
| KXMELANIAMENTION | Melania Mention |  | one_off | 0.1 | 96.32 | 0 | 53,957 | 66,545 | 5,441 | 5,653 | – | – | – |
| KXNETANYAHUMENTION | Netanyahu Mention |  | one_off | 0.07 | 258.95 | 0 | 73,228 | 99,254 | 4,882 | 0 | – | – | – |
| KXTSLAMENTION | Tesla Mention |  | one_off | 0.03 | 41.77 | 0 | 145,532 | 145,532 | 4,851 | 20,790 | – | – | – |
| KXZELENSKYYMENTION | Zelenskyy Mention |  | one_off | 0.07 | 258.58 | 0 | 64,585 | 95,402 | 4,306 | 3,723 | – | – | – |
| KXEARNINGSMENTIONSTZ | Constellation Brands |  | one_off | 0.03 | 1726.92 | 1 | 126,196 | 126,196 | 4,207 | 0 | – | 10.0¢ | – |

**Culture / charts**

| Series | Title | Subject | Freq label | Instances/day | Median life (h) | Open now | Median vol/inst | p90 vol/inst | Vol/day 30d | Vol/day 7d | Taker $/contract | Spread | Depth ±5¢ |
|:--|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| KXRT | Rotten Tomatoes Scores |  | custom | 0.43 | 1101.58 | 19 | 1,164,769 | 1,774,271 | 522,030 | 693,721 | 0.7193 | 1.0¢ | $85,063 |
| KXYTVIEWSW | Highest daily view count this week |  | weekly | 2.13 | 184.83 | 32 | 27,726 | 62,724 | 70,741 | 97,724 | – | 9.5¢ | $1,731 |
| KXYTVIEWSHIGH | highest daily views in time period |  | monthly | 1.07 | 358.87 | 14 | 14,571 | 55,844 | 26,169 | 0 | – | 22.0¢ | – |
| KXYTTOPVIDEO2D | Runner up Daily Top Music Video |  | one_off | 0.83 | 33.98 | 1 | 22,971 | 43,879 | 20,152 | 22,483 | – | 20.0¢ | $5,027 |
| KXYTTOPVIDEOG2D | runner up top music video |  | one_off | 0.87 | 33.98 | 1 | 22,406 | 38,359 | 19,387 | 21,636 | – | 19.0¢ | – |
| KXNETFLIXRANKMOVIE | Netflix movie ranking |  | weekly | 0.13 | 147.98 | 0 | 125,421 | 341,096 | 19,428 | 12,869 | – | – | – |
| KXNETFLIXRANKSHOW | Netflix TV ranking |  | weekly | 0.13 | 147.98 | 0 | 172,197 | 257,657 | 15,659 | 8,505 | – | – | – |
| KXTOPSONG | Billboard Hot 100 #1 |  | weekly | 0.2 | 276.98 | 1 | 25,760 | 79,052 | 9,771 | 2,803 | – | 5.0¢ | $412 |
| KXRTTV | Rotten Tomatoes Score |  | one_off | 0.03 | 1052.0 | 2 | 271,026 | 271,026 | 9,034 | 38,718 | – | 21.5¢ | $44 |
| KXYTDAILYTOPVIDEOG | top music video global |  | one_off | 0.87 | 33.98 | 1 | 4,498 | 23,151 | 8,061 | 19,799 | – | 12.0¢ | $3,396 |
| KXNETFLIXRANKMOVIEGLOBAL | Netflix movie ranking |  | weekly | 0.13 | 147.98 | 0 | 33,427 | 122,566 | 7,459 | 8,101 | – | – | – |
| KXSTEAMTOPSELLER | STEAM Top Sellers |  | one_off | 0.13 | 156.8 | 0 | 29,725 | 59,163 | 5,016 | 9,810 | – | – | – |
| KXNETFLIXTOPVIEWSMOVIE | NETFLIX TOP MOVIE VIEW COUNT |  | one_off | 0.13 | 150.82 | 0 | 36,172 | 50,480 | 4,974 | 4,884 | – | – | – |
| KXNETFLIXTOPVIEWSTV | NETFLIX TOP SHOW VIEW COUNT |  | one_off | 0.13 | 150.82 | 0 | 40,419 | 45,777 | 4,817 | 6,711 | – | – | – |
| KXNETFLIXRANKMOVIERUNNERUP | RUNNER UP NETFLIX MOVIE |  | weekly | 0.13 | 147.98 | 0 | 27,694 | 50,274 | 4,472 | 2,810 | – | – | – |
| KXNETFLIXRANKSHOWRUNNERUP | RUNNER UP NETFLIX SHOW |  | weekly | 0.13 | 147.98 | 0 | 25,301 | 29,586 | 3,404 | 4,305 | – | – | – |
| KXYTTOPSONGW | youtube weekly top songs |  | one_off | 0.13 | 153.98 | 1 | 984 | 54,639 | 2,650 | 18 | – | – | – |
| KXNETFLIXRANKSHOWGLOBAL | Netflix TV ranking |  | weekly | 0.13 | 147.98 | 0 | 12,010 | 30,553 | 2,400 | 1,797 | – | – | – |
| KXTOPALBUMBYTAYLORSWIFT | TAYLOR SWIFT #1 Album |  | annual | 0.03 | 957.18 | 0 | 39,871 | 39,871 | 1,329 | 0 | – | – | – |
| KXBILLBOARDRUNNERUPSONG | Will Song be number 2 on Billboard 100? |  | weekly | 0.17 | 276.97 | 1 | 5,096 | 10,499 | 1,115 | 511 | – | 20.0¢ | $27 |

**Other recurring**

| Series | Title | Subject | Freq label | Instances/day | Median life (h) | Open now | Median vol/inst | p90 vol/inst | Vol/day 30d | Vol/day 7d | Taker $/contract | Spread | Depth ±5¢ |
|:--|:--|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| KXTRUMPAPPROVE | Trump approval rating |  | daily | 1.0 | 26.97 | 1 | 389,316 | 615,237 | 404,595 | 427,210 | 0.5025 | 1.0¢ | $4,979 |
| KXLLM1 | Year-end top LLM |  | custom | 0.2 | 166.0 | 3 | 247,940 | 499,838 | 62,169 | 40,068 | – | 0.5¢ | $12,796 |
| KXTRUTHSOCIAL | Number of Trump Truth Social posts this… |  | weekly | 0.17 | 167.98 | 1 | 233,537 | 296,478 | 40,157 | 26,769 | – | – | $9,001 |
| KXVHGCB | VoteHub GCB |  | daily | 0.83 | 31.05 | 1 | 27,399 | 62,291 | 26,625 | 25,605 | 0.7674 | 28.0¢ | $116 |
| KXTRUMPACT | Will Trump do anything today? |  | weekly | 0.17 | 166.0 | 1 | 131,643 | 140,594 | 20,875 | 17,081 | – | 3.0¢ | $3,639 |
| KXTRUTHSOCIALD | Number of Trump Truth Social posts toda… |  | daily | 0.6 | 23.98 | 1 | 12,905 | 38,862 | 11,166 | 17,451 | 0.8202 | – | $242 |
| KXTRUMPGOLFD | Will Trump golf? |  | daily | 0.07 | 78.52 | 1 | 38,475 | 68,563 | 2,565 | 10,869 | 0.613 | 4.0¢ | $1,634 |
| KXTSAW | TSA check-ins this week |  | weekly | 0.17 | 157.98 | 1 | 10,961 | 19,320 | 1,678 | 1,811 | – | 2.0¢ | $277 |
| KXWHPRESSBANEND | End of White House press ban |  | one_off | 0.03 | 225.48 | 1 | 35,111 | 35,111 | 1,170 | 0 | – | 1.0¢ | – |
| KXTSAD | Daily TSA passenger screenings |  | daily | 0.33 | 21.98 | 1 | 204 | 3,130 | 719 | 359 | – | 15.0¢ | $329 |
| KXWHPRESSBANCOURT | White House Press Ban Court Relief |  | one_off | 0.03 | 135.52 | 0 | 15,299 | 15,299 | 510 | 0 | – | – | – |
| KXTRUMPACTD | Will Trump do anything? |  | daily | 0.23 | 41.0 | 2 | 622 | 2,443 | 234 | 1,001 | – | 18.0¢ | $178 |
| KXWHPRESSBANEXPAND | Trump White House press-ban additions |  | one_off | 0.03 | 295.23 | 0 | 2,953 | 2,953 | 98 | 0 | – | – | – |
| KXLLMH2H | AI model head-to-head |  | custom | 0.0 |  | 3 | – | – | 0 | 0 | – | 49.0¢ | $218 |
| KXTOPAI | Top-ranked AI |  | custom | 0.0 |  | 1 | – | – | 0 | 0 | – | 1.0¢ | $4,929 |
| KXLLMCHESS | LLM chess |  | custom | 0.0 |  | 1 | – | – | 0 | 0 | – | 4.0¢ | – |
| KXFLIGHTSRUSSIA | Flights Russia |  | custom | 0.0 |  | 1 | – | – | 0 | 0 | – | 6.3¢ | $1,322 |
| KXWHPRESSBRIEFING | Who will attend a White House Press Bri… |  | one_off | 0.0 |  | 1 | – | – | 0 | 0 | – | 7.0¢ | – |

### 5c. Sports: game-level families

Rolled up by league:

| League / sport (game-level series) | Series | Open instances now | Vol/day 30d | Vol/day 7d | Est. taker $/day 7d |
|:--|--:|--:|--:|--:|--:|
| Tennis | 22 | 693 | 151,948,502 | 149,000,339 | 74,030,184 |
| NFL | 83 | 175 | 118,464,139 | 118,711,858 | 53,493,110 |
| NCAA football | 29 | 793 | 85,163,531 | 95,035,343 | 40,135,334 |
| MLB | 31 | 40 | 49,422,289 | 34,951,178 | 14,342,009 |
| Soccer: other | 416 | 637 | 39,847,853 | 27,066,187 | 12,824,888 |
| Esports | 29 | 490 | 8,491,914 | 9,053,542 | 4,454,714 |
| UFC/MMA | 8 | 14 | 8,429,062 | 6,347,379 | 2,681,280 |
| Cricket | 9 | 60 | 7,400,220 | 8,910,292 | 4,279,389 |
| Soccer: UEFA club comps | 48 | 454 | 6,945,228 | 24,483,612 | 10,439,822 |
| WNBA | 30 | 21 | 6,889,662 | 952,762 | 462,672 |
| NHL | 20 | 253 | 6,565,193 | 10,947,689 | 5,553,469 |
| NBA | 7 | 117 | 6,190,921 | 12,765,342 | 6,170,397 |
| Golf | 28 | 9 | 5,415,834 | 2,368,451 | 244,557 |
| Soccer: La Liga | 23 | 50 | 5,217,351 | 8,911,538 | 3,688,478 |
| Soccer: MLS | 18 | 100 | 4,798,811 | 9,231,112 | 4,280,637 |
| Soccer: Liga MX | 18 | 181 | 4,727,112 | 4,821,716 | 2,076,164 |
| Soccer: Premier League | 22 | 50 | 4,337,922 | 8,649,447 | 4,019,490 |
| Soccer: Serie A | 18 | 60 | 2,076,779 | 4,683,510 | 2,298,659 |
| Soccer: Bundesliga | 21 | 45 | 1,706,067 | 2,644,708 | 1,170,124 |
| Basketball | 69 | 109 | 1,555,323 | 2,085,761 | 1,169,827 |
| Soccer: Ligue 1 | 18 | 45 | 1,139,497 | 2,710,936 | 1,225,980 |
| Baseball | 9 | 4 | 1,036,245 | 493,878 | 224,724 |
| Motorsport | 14 | 18 | 840,086 | 641,009 | 71,985 |
| Combat sports | 3 | 23 | 672,044 | 1,984,919 | 846,124 |
| Soccer: EFL | 20 | 129 | 598,028 | 1,355,860 | 658,108 |

Top 45 sports families (league × market type):

| Family | Subjects | Instances/day (30d) | Median life (h) | Open now | Vol/instance median / p90 | Vol/day 30d | Vol/day 7d | Est. taker $/day (7d) | Spread | Top-of-book $ (snapshot) | Book depth ±5¢ | Settlement source | Fee type x multiplier |
|:--|:--|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|:--|:--|
| Tennis: game/match winner | Tennis | 311.8 | 20.75 | 529 | 81,162 / 1,398,535 | 147,532,469 | 144,494,002 | 71,832,470 | 1.5¢ | $53 | $13,970 | ATP; ITF | quadratic x1; quadratic_with_maker_fe… |
| NFL: game/match winner | NFL | 2.5 | 304.18 | 28 | 16,169,890 / 68,430,064 | 63,993,178 | 67,573,205 | 29,279,470 | 1.5¢ | $6,609 | $803,344 | the Governing League | quadratic_with_maker_fees x1 |
| NCAA football: game/match winner | NCAA football | 18.2 | 338.38 | 224 | 596,167 / 8,494,869 | 52,650,985 | 63,270,558 | 23,359,490 | 1.0¢ | $411 | $443,571 | Kalshi using information originating … | quadratic_with_maker_fees x1 |
| MLB: game/match winner | MLB | 5.3 | 112.84 | 5 | 2,907,492 / 15,916,024 | 29,500,713 | 23,096,833 | 9,185,611 | 1.0¢ | $776 | $309,151 | ESPN | quadratic_with_maker_fees x0.5; quadr… |
| Soccer: other: game/match winner | Soccer: other | 77.1 | 112.63 | 464 | 91,379 / 828,085 | 27,359,702 | 17,821,781 | 8,150,957 | 6.0¢* | $78 | – | ESPN; BBC Sport | quadratic x1 |
| NFL: player props | NFL | 53.6 | 75.43 | 22 | 16,274 / 847,915 | 20,445,348 | 20,957,389 | 9,204,938 | 1.0¢ | $389 | $62,566 | the Governing League; ESPN | quadratic x1; quadratic_with_maker_fe… |
| NFL: spreads | NFL | 2.5 | 165.98 | 14 | 4,376,448 / 15,021,103 | 16,291,630 | 14,420,304 | 6,996,732 | 1.0¢ | $20,762 | $213,992 | the Governing League | quadratic_with_maker_fees x1 |
| NCAA football: spreads | NCAA football | 17.3 | 112.69 | 56 | 329,132 / 2,653,286 | 16,003,302 | 15,563,527 | 8,033,893 | 1.0¢ | $3,125 | $90,076 | ESPN | quadratic_with_maker_fees x1 |
| NCAA football: totals | NCAA football | 26.5 | 126.54 | 112 | 139,280 / 965,238 | 9,754,162 | 9,525,648 | 4,991,969 | 1.0¢ | $1,003 | $45,681 | ESPN | quadratic x1; quadratic_with_maker_fe… |
| NFL: totals | NFL | 5.0 | 155.57 | 28 | 912,421 / 5,894,046 | 9,093,623 | 7,465,848 | 3,646,860 | 1.0¢ | $1,112 | $355,473 | the Governing League | quadratic x1; quadratic_with_maker_fe… |
| Cricket: game/match winner | Cricket | 16.1 | 110.66 | 60 | 83,509 / 1,081,789 | 7,375,865 | 8,910,292 | 4,279,389 | 1.0¢ | $25 | $16,676 | ESPNcricinfo; Cricbuzz | quadratic x1 |
| MLB: totals | MLB | 55.7 | 27.42 | 2 | 515 / 237,755 | 7,305,440 | 3,595,913 | 1,890,475 | 1.5¢ | $3,554 | $36,080 | the Governing League; ESPN | quadratic x0.5; quadratic x1 |
| Soccer: other: totals | Soccer: other | 79.1 | 25.85 | 51 | 32,939 / 238,892 | 7,291,554 | 6,469,976 | 3,408,399 | 2.0¢* | $288 | – | Fox Sports; FIFA | quadratic x1 |
| NFL: in-game segments (halves/quarters/innings/sets/maps) | NFL | 60.1 | 121.23 | 37 | 37,809 / 260,283 | 6,749,509 | 5,783,649 | 2,953,963 | 5.0¢* | $234 | – | the Governing League; ESPN | quadratic x1 |
| NCAA football: in-game segments (halves/quarters/innings/se… | NCAA football | 111.3 | 75.01 | 347 | 26,637 / 130,145 | 6,543,147 | 6,494,863 | 3,667,536 | 22.0¢* | $172 | – | ESPN; Kalshi using information origin… | quadratic x1 |
| Esports: game/match winner | Esports | 79.7 | 33.93 | 135 | 16,276 / 158,165 | 5,741,693 | 5,815,189 | 2,786,364 | 2.0¢ | $42 | $7,118 | B03; BO3 | quadratic x1 |
| UFC/MMA: game/match winner | UFC/MMA | 3.7 | 79.33 | 14 | 1,024,829 / 3,888,634 | 5,613,513 | 3,968,061 | 2,033,158 | 1.0¢ | $3,369 | $529,890 | ESPN; DAZN | quadratic x1 |
| Soccer: UEFA club comps: game/match winner | Soccer: UEFA club comps | 2.4 | 355.25 | 63 | 1,018,513 / 3,684,814 | 4,878,675 | 17,419,499 | 6,977,243 | 1.0¢ | $2,880 | $1,319,862 | ESPN | quadratic x1; quadratic_with_maker_fe… |
| Golf: other (races, tournaments, awards) | Golf | 8.9 | 142.56 | 9 | 1,592 / 88,743 | 4,818,240 | 2,029,293 | 234,789 | 5.0¢* | $48 | – | Fox Sports; DP World Tour | quadratic x1; quadratic_with_maker_fe… |
| WNBA: game/match winner | WNBA | 1.5 | 118.22 | 4 | 1,916,652 / 6,372,198 | 4,401,146 | 693,994 | 344,637 | 3.5¢* | $1,358 | – | ESPN | quadratic_with_maker_fees x1; quadrat… |
| NBA: game/match winner | NBA | 2.2 | 169.29 | 52 | 1,534,564 / 3,683,758 | 4,160,146 | 8,778,056 | 3,998,404 | 1.0¢ | $219 | $833,774 | the Governing League | quadratic_with_maker_fees x1 |
| MLB: player props | MLB | 25.0 | 20.55 | 5 | 51,780 / 358,669 | 4,073,961 | 3,718,124 | 1,227,397 | 3.0¢* | $820 | – | ESPN | quadratic x0.5 |
| MLB: spreads | MLB | 5.2 | 95.69 | 2 | 483,777 / 1,922,381 | 4,024,307 | 2,143,070 | 955,166 | 5.0¢* | $4,631 | – | ESPN; the Governing League | quadratic x1; quadratic x0.5 |
| MLB: in-game segments (halves/quarters/innings/sets/maps) | MLB | 24.9 | 26.67 | 8 | 70,693 / 469,370 | 4,006,200 | 1,939,729 | 874,671 | 3.5¢* | $612 | – | the Governing League; CBS Sports | quadratic x0.5 |
| NHL: game/match winner | NHL | 6.5 | 168.56 | 47 | 494,900 / 1,255,526 | 3,847,749 | 6,515,030 | 3,237,970 | 1.0¢ | $55 | $167,362 | NHL | quadratic_with_maker_fees x1 |
| Tennis: in-game segments (halves/quarters/innings/sets/maps) | Tennis | 45.8 | 26.02 | 84 | 50,647 / 197,199 | 3,698,809 | 3,694,704 | 1,805,104 | 4.0¢ | $18 | $4,374 | ATP; WTA | quadratic x1 |
| Soccer: Liga MX: game/match winner | Soccer: Liga MX | 1.1 | 340.53 | 28 | 2,674,589 / 5,011,074 | 3,609,276 | 3,517,188 | 1,436,419 | 1.0¢ | $111 | $177,323 | ESPN | quadratic x1 |
| Soccer: La Liga: game/match winner | Soccer: La Liga | 0.8 | 353.94 | 20 | 3,226,055 / 9,680,145 | 3,481,301 | 5,896,140 | 2,126,738 | 1.0¢ | $2,076 | $35,800 | ESPN | quadratic_with_maker_fees x1 |
| Soccer: MLS: game/match winner | Soccer: MLS | 2.6 | 340.07 | 44 | 869,833 / 2,187,934 | 3,105,785 | 5,817,754 | 2,497,562 | 1.0¢ | $42 | $17,269 | MLS | quadratic x1 |
| Soccer: Premier League: game/match winner | Soccer: Premier League | 0.8 | 351.48 | 20 | 2,860,710 / 6,444,627 | 2,977,656 | 6,070,741 | 2,679,625 | 1.0¢ | $5,237 | $116,428 | ESPN | quadratic_with_maker_fees x1 |
| Esports: in-game segments (halves/quarters/innings/sets/map… | Esports | 115.8 | 22.36 | 218 | 5,146 / 57,944 | 2,592,112 | 2,947,586 | 1,535,719 | 94.0¢* | $8 | – | B03; BO3 | quadratic x1 |
| UFC/MMA: other game props | UFC/MMA | 2.7 | 72.42 | 0 | 527,571 / 1,558,515 | 2,056,476 | 1,672,526 | 375,817 | – | – | – | ESPN | quadratic x1 |
| Soccer: other: in-game segments (halves/quarters/innings/se… | Soccer: other | 84.8 | 24.84 | 20 | 6,782 / 61,785 | 1,858,901 | 910,268 | 415,211 | 1.0¢* | $688 | – | Fox Sports; ESPN | quadratic x1 |
| Soccer: other: spreads | Soccer: other | 71.8 | 25.86 | 51 | 7,183 / 55,514 | 1,831,391 | 1,170,679 | 533,995 | 3.0¢* | $178 | – | Fox Sports; ESPN | quadratic x1 |
| Soccer: Serie A: game/match winner | Soccer: Serie A | 0.8 | 353.37 | 30 | 1,366,660 / 2,734,213 | 1,381,528 | 3,148,519 | 1,543,719 | 1.0¢ | $1,444 | $29,329 | ESPN | quadratic_with_maker_fees x1 |
| NFL: other (races, tournaments, awards) | NFL | 43.6 | 74.93 | 27 | 8,989 / 79,560 | 1,345,798 | 1,642,385 | 1,155,035 | 6.5¢* | $117 | – | the Governing League; Sleeper | quadratic x1 |
| Basketball: other: game/match winner | Basketball: other | 30.2 | 85.87 | 97 | 13,417 / 104,906 | 1,269,204 | 1,674,284 | 982,135 | 5.0¢* | $125 | – | Sofascore; EuroBasket | quadratic x1 |
| Soccer: other: other game props | Soccer: other | 78.9 | 25.77 | 51 | 3,465 / 36,461 | 1,255,291 | 692,691 | 315,965 | 3.0¢* | $351 | – | Fox Sports; FIFA | quadratic x1 |
| NBA: totals | NBA | 2.2 | 24.84 | 18 | 442,197 / 1,009,843 | 1,189,795 | 2,246,090 | 1,228,836 | 2.0¢* | $339 | – | the Governing League | quadratic_with_maker_fees x1 |
| NHL: totals | NHL | 11.0 | 61.41 | 38 | 25,169 / 277,206 | 1,139,650 | 1,723,431 | 882,741 | 2.0¢* | $202 | – | the National Hockey League; NHL | quadratic x1 |
| Soccer: Bundesliga: game/match winner | Soccer: Bundesliga | 0.7 | 351.0 | 18 | 909,573 / 2,636,055 | 1,069,756 | 1,534,932 | 603,996 | 2.0¢* | $2,088 | – | ESPN | quadratic_with_maker_fees x1 |
| Soccer: UEFA club comps: totals | Soccer: UEFA club comps | 4.2 | 49.78 | 72 | 79,858 / 667,840 | 1,025,581 | 3,142,137 | 1,623,677 | 2.0¢* | $1,257 | – | ESPN; Fox Sports | quadratic x1 |
| Soccer: MLS: totals | Soccer: MLS | 5.2 | 109.56 | 16 | 76,882 / 515,246 | 950,910 | 1,948,150 | 1,094,276 | 3.0¢* | $184 | – | ESPN; Fox Sports | quadratic x1 |
| WNBA: totals | WNBA | 2.5 | 27.64 | 1 | 183,011 / 1,025,986 | 886,905 | 75,035 | 34,227 | 3.0¢* | $1,132 | – | ESPN; the Governing League | quadratic x1 |
| Soccer: La Liga: totals | Soccer: La Liga | 3.3 | 49.77 | 10 | 101,817 / 663,411 | 863,608 | 1,354,773 | 781,569 | 2.0¢* | $1,352 | – | FIFA; ESPN | quadratic x1 |

### 5d. Fees

The API gives each series a `fee_type` and `fee_multiplier`. Of %s series, 15,062 are `quadratic`, 160 `quadratic_with_maker_fees` and 3 `quadratic_with_combo_maker_fees` (the combo/parlay collections). The multiplier is 1 for 15,192 series, 0.5 for 19 (all MLB game and prop series: `KXMLBGAME`, `KXMLBTOTAL`, `KXMLBSPREAD`, `KXMLBHR`, …) and 0 (fee-free) for 14 long-dated series (`KXBTCY`, `KXETHY`, `KXGDPYEAR`, `KXTRUMPOUT`, `KXGREENLAND`, several Iran series, …). The formula is not in the API. Kalshi's published schedule, as summarised by third parties (see Sources; Kalshi's own PDF returned HTTP 429 to our fetch), charges takers ceil(0.07 × C × P × (1 − P)) dollars for C contracts at price P, times the multiplier: at most 1.75¢ per contract at P = 50¢, 0.63¢ at 10¢/90¢. Maker fees, where they apply, are a quarter of that (0.0175 × C × P × (1 − P)).

- **No maker fee (plain `quadratic` × 1):** every crypto, index, commodity, FX, Treasury, weather, gas, mentions and most culture short-term series, and most sports props.
- **Maker fees (`quadratic_with_maker_fees`):** the headline sports game/spread/total series (NFL, NCAA football, NBA, NHL, WNBA, EPL, La Liga, Serie A, Bundesliga, Ligue 1, UCL, ATP and WTA matches; MLB game at × 0.5), season futures (Super Bowl, NBA, Ballon d'Or…), and the main macro releases (Fed decision `KXFEDDECISION`, Fed funds `KXFED`, CPI `KXCPI`/`KXCPIYOY`, payrolls `KXPAYROLLS`, unemployment `KXU3`), plus GPU rental-price series (H100/B200/A100).

### 5e. Requested families with little or no activity

- **Single stocks:** no price series exist; per-company series are KPI markets (`KXTSLA`, `KXMETA`, `KXAMZN`, … 'Tesla KPI', mostly deliveries/users/revenue) and earnings-call mention markets.
- **Box office:** no box-office series is listed (the only matches are Golden Globes 'box office achievement' awards). Rotten Tomatoes score markets fill this niche.
- **Spotify daily charts:** 187 Spotify series are listed, 18 of them `daily` (`KXSPOTIFYD`, `KXSPOTIFYGLOBALD`, …), but none of the daily ones had an open or settled instance in the window; the open Spotify markets are year-end 'top song/album' and price-increase markets. Billboard Hot 100 #1 (`KXTOPSONG`, weekly) is active: 467,771 contracts over 11 weekly instances since mid-Aug.
- **TSA:** weekly (`KXTSAW`, median ~8–13k contracts per week) and daily (`KXTSAD`, tens to ~1,400 contracts per day) — negligible.
- **15-minute S&P 500, Nasdaq-100 and Dow series** (`KXINX15M`, `KXNDQ15M`, `KXDJIA15M`) are listed but had no open or settled instance in the window; the 15-minute Treasury series traded 396 (10-year) and 56 (2-year) contracts in 30 days.

## 6. Asset-linked markets

Matching: event title, sub-title, series title and market titles were scanned for company names/aliases (e.g. Alphabet ← Google, YouTube, Waymo, Gemini; SpaceX ← Starship, Starlink, xAI, Grok; Take-Two ← GTA), for crypto names/tickers (only in crypto-themed markets), and for index/commodity/rates/FX underlyings (only in financials and economy categories). Sports and weather are excluded. Each market is typed by how it links to the asset. Full list: `kalshi_asset_linked_markets.csv`.

**By link type (open snapshot)**

| Link type | Markets | Events | 24h vol | Open interest |
|:--|--:|--:|--:|--:|
| price | 10,555 | 262 | 2,803,244 | 42,945,738 |
| macro (rate/price proxy) | 1,086 | 100 | 885,573 | 18,398,722 |
| fundamentals (earnings/KPIs) | 898 | 99 | 45,515 | 712,756 |
| mention (what a speaker says) | 570 | 69 | 49,925 | 308,434 |
| platform/content ranking | 483 | 45 | 108,054 | 2,973,519 |
| tech/product | 218 | 48 | 144,323 | 3,967,947 |
| corporate event | 166 | 33 | 39,605 | 2,347,619 |
| company other | 41 | 8 | 188 | 36,559 |
| political/policy reference | 37 | 19 | 8,333 | 127,625 |
| product price | 19 | 3 | 297 | 10,178 |
| crypto event | 15 | 3 | 20,731 | 378,896 |
| stock price / market cap | 12 | 1 | 0 | 213 |

**Crypto assets (open snapshot)**

| Crypto asset | Events | Markets | 24h vol | Open interest | Lifetime vol | Link types | Earliest close |
|:--|--:|--:|--:|--:|--:|:--|:--|
| BTC | 47 | 744 | 2,035,401 | 24,444,143 | 81,186,857 | price:712; mention (what a speaker says):17; political/poli… | 2026-10-20T06:45 |
| ZEC | 5 | 186 | 87,511 | 27,255 | 212,442 | price:186 | 2026-10-20T06:45 |
| BNB | 11 | 387 | 67,652 | 9,587 | 107,661 | price:387 | 2026-10-20T06:45 |
| ETH | 15 | 829 | 61,855 | 2,137,579 | 16,631,304 | price:827; political/policy reference:1; crypto event:1 | 2026-10-20T06:45 |
| SOL | 16 | 893 | 24,804 | 376,674 | 1,332,412 | price:891; political/policy reference:1; crypto event:1 | 2026-10-20T06:45 |
| XRP | 15 | 386 | 20,834 | 288,850 | 565,936 | price:384; political/policy reference:1; crypto event:1 | 2026-10-20T06:45 |
| DOGE | 15 | 299 | 3,409 | 277,347 | 703,856 | price:297; political/policy reference:1; crypto event:1 | 2026-10-20T06:45 |
| HYPE | 12 | 822 | 1,408 | 11,309 | 25,307 | price:821; political/policy reference:1 | 2026-10-20T06:45 |
| NEAR | 3 | 25 | 853 | 6,138 | 25,072 | price:25 | 2026-10-20T06:45 |
| SHIB | 3 | 59 | 571 | 6,597 | 32,423 | price:58; crypto event:1 | 2026-10-20T21:00 |
| LINK | 1 | 1 | 223 | 28,459 | 78,250 | crypto event:1 | 2027-01-01T15:00 |
| LTC | 1 | 1 | 56 | 4,637 | 21,865 | crypto event:1 | 2027-01-01T15:00 |
| DOT | 1 | 1 | 12 | 7,678 | 29,408 | crypto event:1 | 2027-01-01T15:00 |
| XLM | 1 | 1 | 8 | 12,784 | 56,247 | crypto event:1 | 2027-01-01T15:00 |
| ADA | 1 | 1 | 0 | 84 | 84 | political/policy reference:1 | 2029-01-21T04:59 |

**Index, commodity, rates and FX underlyings with their Robinhood proxies (open snapshot)**

| Underlying | Robinhood proxy tokens | Events | Markets | 24h vol | Open interest | Lifetime vol | Top event (24h vol) |
|:--|:--|--:|--:|--:|--:|--:|:--|
| US gasoline (AAA retail) | USO/XOM | 30 | 525 | 662,716 | 2,125,423 | 5,296,538 | US gas prices this week |
| Fed funds / policy rate | SGOV/SHY | 54 | 665 | 208,787 | 16,096,302 | 30,636,983 | Fed decision in Oct 2026? |
| Oil (WTI/Brent) | USO/XOM | 30 | 460 | 163,631 | 4,395,268 | 11,406,809 | Oil Price (WTI) on Oct 20, 2026? |
| Copper | none listed | 5 | 132 | 108,975 | 45,532 | 152,008 | Copper price on Oct 20, 2026 at 5:00 PM EDT? |
| Gold | GLD | 17 | 271 | 90,823 | 363,645 | 988,125 | Gold price on Oct 20, 2026 at 5:00 PM EDT? |
| S&P 500 | SPY/SPMO/VTI | 29 | 687 | 90,556 | 6,782,137 | 11,458,680 | S&P close price end of 2026? |
| US Treasury yields | SHY/SGOV/BND | 45 | 685 | 37,703 | 416,763 | 1,168,900 | 10Y US Treasury yield on Oct 20, 2026? |
| Nasdaq-100 | QQQ | 15 | 2,921 | 29,534 | 3,846,783 | 5,309,744 | Nasdaq-100 close price end of 2026? |
| FX | none listed | 18 | 253 | 19,555 | 33,314 | 590,902 | EUR/USD price range on Oct 20, 2026 at 10am EDT? |
| Natural gas | none listed | 8 | 210 | 15,845 | 86,247 | 229,309 | Natural Gas 15 min · $3.30338 target |
| Silver | SLV | 8 | 204 | 6,295 | 39,599 | 82,241 | Silver price on Oct 20, 2026 at 5:00 PM EDT? |
| Dow Jones | none listed | 4 | 109 | 6,195 | 19,349 | 27,287 | (Pyth Index.US30/USD) price on Oct 20, 2026 at 4p… |
| SOFR / repo | SGOV | 2 | 15 | 5,870 | 13,824 | 25,654 | SOFR for October 19, 2026 |
| Platinum/Palladium | none listed | 6 | 216 | 294 | 2,146 | 7,109 | Platinum 15 min · $1,648.300 target |
| Nikkei | none listed | 1 | 8 | 0 | 24,881 | 29,654 | How high will the Nikkei 225 get in 2026? |
| KOSPI | EWY | 1 | 2 | 0 | 1,652 | 3,547 | How high will the KOSPI Composite Index get in 20… |

**Settled throughput by asset (30 days; series-level match on series title)** — the open snapshot under-counts short-lived price markets, so this is the better measure of trading per asset:

| Asset (settled series, 30d) | Series | Instances settled | Volume 30d (contracts) | Vol/day (contracts) | Est. taker $/day (sampled series only) |
|:--|--:|--:|--:|--:|--:|
| crypto BTC | 7 | 4,262 | 8,960,159,991 | 298,672,000 | 140,673,785 |
| underlying Gold | 5 | 2,473 | 694,693,691 | 23,156,456 | 10,469,958 |
| crypto ETH | 5 | 4,259 | 529,523,489 | 17,650,783 | 7,545,059 |
| crypto XRP | 5 | 4,259 | 226,747,267 | 7,558,242 | 3,489,541 |
| underlying Oil (WTI/Brent) | 15 | 2,619 | 194,763,830 | 6,492,128 | 3,026,742 |
| crypto SOL | 5 | 4,260 | 191,994,296 | 6,399,810 | 3,142,525 |
| crypto DOGE | 6 | 4,260 | 112,725,960 | 3,757,532 | 1,869,397 |
| underlying Silver | 5 | 2,405 | 100,214,355 | 3,340,478 | 1,653,820 |
| crypto HYPE | 5 | 4,260 | 75,568,564 | 2,518,952 | 1,084,541 |
| crypto ZEC | 3 | 2,851 | 67,245,011 | 2,241,500 | 1,099,909 |
| crypto NEAR | 2 | 2,849 | 61,947,524 | 2,064,917 | 999,167 |
| crypto BNB | 5 | 4,260 | 52,983,220 | 1,766,107 | 966,426 |
| underlying S&P 500 | 4 | 314 | 50,780,286 | 1,692,676 | 583,601 |
| underlying Nasdaq-100 | 6 | 316 | 48,210,442 | 1,607,015 | 881,784 |
| underlying US gasoline (AAA retail) | 63 | 1,146 | 47,715,559 | 1,590,519 | 1,094,725 |
| underlying Natural gas | 4 | 2,108 | 43,914,764 | 1,463,825 | 763,990 |
| underlying Copper | 4 | 1,945 | 39,887,451 | 1,329,582 | 735,458 |
| underlying FX | 26 | 6,836 | 36,085,222 | 1,202,841 | 629,656 |
| underlying Platinum/Palladium | 4 | 4,726 | 28,068,480 | 935,616 | 534,256 |
| token AAPL | 1 | 1 | 3,534,404 | 117,813 | 0 |
| token GOOGL | 8 | 52 | 3,016,390 | 100,546 | 0 |
| underlying US Treasury yields | 29 | 548 | 2,302,290 | 76,743 | 13,203 |
| token NFLX | 11 | 41 | 1,984,457 | 66,149 | 0 |
| underlying Dow Jones | 1 | 147 | 1,728,914 | 57,630 | 45,384 |
| token SPCX | 8 | 11 | 1,307,803 | 43,593 | 0 |
| crypto SHIB | 2 | 60 | 1,018,565 | 33,952 | 0 |
| token TTWO | 2 | 2 | 515,541 | 17,185 | 0 |
| token COST | 3 | 3 | 381,940 | 12,731 | 0 |
| token BA | 2 | 2 | 355,919 | 11,864 | 0 |
| token CCL | 2 | 2 | 344,325 | 11,478 | 0 |
| token TSLA | 3 | 4 | 333,347 | 11,112 | 0 |
| token BABA | 1 | 2 | 234,079 | 7,803 | 0 |
| token AMZN | 1 | 1 | 182,374 | 6,079 | 0 |
| underlying SOFR / repo | 2 | 21 | 178,045 | 5,935 | 5,665 |
| token RIVN | 1 | 1 | 159,017 | 5,301 | 0 |
| token MU | 1 | 1 | 82,952 | 2,765 | 0 |
| underlying Fed funds / policy rate | 3 | 3 | 69,812 | 2,327 | 0 |
| token BB | 1 | 1 | 54,167 | 1,806 | 0 |
| token WDAY | 1 | 1 | 40,918 | 1,364 | 0 |
| token XOM | 1 | 1 | 34,482 | 1,149 | 0 |

**Robinhood Stock Tokens with at least one linked open market** (`robinhood_stock_tokens_2026-10-20.csv`, 195 tokens). *Direct* = the company or ETF is named; *via proxy* = S&P 500 → SPY/SPMO/VTI, Nasdaq-100 → QQQ, gold → GLD, silver → SLV, oil and US gasoline → USO/XOM, Treasury yields → SHY/SGOV/BND, Fed funds/SOFR → SGOV/SHY, KOSPI → EWY.

| Token | Name | Direct events | Direct markets | 24h vol | Open interest | Via proxy (markets) | Link types (direct) | Top event |
|:--|:--|--:|--:|--:|--:|--:|:--|:--|
| QQQ | Invesco QQQ | 0 | 0 | 0 | 0 | 2,921 |  |  |
| SGOV | iShares 0-3 Month Treasury … | 0 | 0 | 0 | 0 | 1,365 |  |  |
| SHY | iShares 1-3 Year Treasury B… | 0 | 0 | 0 | 0 | 1,350 |  |  |
| XOM | ExxonMobil Holdings Corpora… | 4 | 10 | 1,532 | 6,367 | 985 | fundamentals (earnings/KPIs):7; political/policy reference:2; mention… | ExxonMobil Credit Card Spend in October |
| USO | United States Oil Fund | 0 | 0 | 0 | 0 | 985 |  |  |
| SPMO | Invesco S&P 500 Momentum ETF | 0 | 0 | 0 | 0 | 687 |  |  |
| SPY | SPDR S&P 500 ETF Trust | 0 | 0 | 0 | 0 | 687 |  |  |
| VTI | Vanguard Morningstar Total … | 0 | 0 | 0 | 0 | 687 |  |  |
| BND | Vanguard Total Bond Market … | 0 | 0 | 0 | 0 | 685 |  |  |
| GOOGL | Alphabet Class A | 70 | 392 | 96,666 | 2,667,196 | 0 | platform/content ranking:186; tech/product:93; fundamentals (earnings… | Best AI at the end of 2026? |
| GLD | SPDR Gold Trust | 0 | 0 | 0 | 0 | 271 |  |  |
| TTWO | Take-Two Interactive Softwa… | 18 | 261 | 83,363 | 2,066,289 | 0 | platform/content ranking:260; price:1 | Grand Theft Auto VI: The Album · Features |
| SLV | iShares Silver Trust | 0 | 0 | 0 | 0 | 204 |  |  |
| SPCX | Space Exploration Technolog… | 49 | 154 | 103,916 | 2,542,580 | 0 | tech/product:65; mention (what a speaker says):35; fundamentals (earn… | How many launches will SpaceX have in October? |
| TSLA | Tesla | 26 | 153 | 32,030 | 850,744 | 0 | fundamentals (earnings/KPIs):92; mention (what a speaker says):31; co… | When will Tesla and SpaceX merge? |
| AMZN | Amazon | 24 | 95 | 15,612 | 191,978 | 0 | mention (what a speaker says):30; fundamentals (earnings/KPIs):28; pl… | Amazon Credit Card Spend in October |
| META | Meta Platforms | 23 | 92 | 3,903 | 108,611 | 0 | fundamentals (earnings/KPIs):53; mention (what a speaker says):18; te… | What will Meta say during their next earnings cal… |
| COST | Costco | 5 | 54 | 322 | 36,661 | 0 | fundamentals (earnings/KPIs):29; mention (what a speaker says):21; ma… | Costco Credit Card Spend in October |
| NFLX | Netflix | 18 | 52 | 8,168 | 55,174 | 0 | mention (what a speaker says):24; fundamentals (earnings/KPIs):17; pl… | What will Netflix say during their next earnings … |
| HIMS | Hims & Hers Health | 5 | 46 | 126 | 22,561 | 0 | fundamentals (earnings/KPIs):26; mention (what a speaker says):19; co… | What will Hims say during their next earnings cal… |
| AAPL | Apple | 14 | 44 | 4,932 | 480,179 | 0 | mention (what a speaker says):20; corporate event:8; product price:7;… | When will Apple release the iPhone 18? |
| PLTR | Palantir Technologies | 6 | 44 | 16 | 45,173 | 0 | fundamentals (earnings/KPIs):21; mention (what a speaker says):20; po… | What will Palantir say during their next earnings… |
| SNOW | Snowflake | 5 | 44 | 110 | 1,153 | 0 | fundamentals (earnings/KPIs):25; mention (what a speaker says):18; co… | What will Snowflake CEO say during his agentic en… |
| LMT | Lockheed | 5 | 43 | 963 | 22,953 | 0 | fundamentals (earnings/KPIs):27; mention (what a speaker says):15; co… | Lockheed Martin F-35 deliveries in Q3 |
| ORCL | Oracle | 5 | 43 | 423 | 6,227 | 0 | mention (what a speaker says):35; fundamentals (earnings/KPIs):8 | What companies will Trump say in October? |
| RBLX | Roblox | 5 | 43 | 3,212 | 40,487 | 0 | fundamentals (earnings/KPIs):42; corporate event:1 | Roblox hours engaged in Q3 |
| RIVN | Rivian Automotive | 3 | 42 | 781 | 27,383 | 0 | fundamentals (earnings/KPIs):30; mention (what a speaker says):12 | What will Rivian say during their next earnings c… |
| CCL | Carnival Corporation | 3 | 40 | 1,499 | 49,695 | 0 | fundamentals (earnings/KPIs):26; mention (what a speaker says):14 | Carnival Cruise available lower berth days in 2026 |
| MSFT | Microsoft | 11 | 40 | 1,086 | 17,431 | 0 | mention (what a speaker says):32; tech/product:3; corporate event:3; … | What will Jay Parikh say during GitHub Universe K… |
| BA | Boeing | 8 | 38 | 316 | 57,862 | 0 | fundamentals (earnings/KPIs):19; mention (what a speaker says):17; co… | Boeing commercial airplane deliveries in 2026 |
| NVDA | NVIDIA | 15 | 38 | 285 | 47,805 | 0 | mention (what a speaker says):26; fundamentals (earnings/KPIs):6; tec… | Which companies will the US take a stake in this … |
| RDDT | Reddit | 4 | 38 | 933 | 10,185 | 0 | fundamentals (earnings/KPIs):21; mention (what a speaker says):16; co… | Reddit daily active uniques in Q3 |
| CVNA | Carvana | 3 | 33 | 1,087 | 53,557 | 0 | fundamentals (earnings/KPIs):20; mention (what a speaker says):13 | What will Carvana say during their next earnings … |
| INTC | Intel | 6 | 33 | 69 | 14,543 | 0 | fundamentals (earnings/KPIs):16; mention (what a speaker says):16; po… | What will Intel say during their next earnings ca… |
| CRWV | CoreWeave | 5 | 32 | 204 | 8,689 | 0 | fundamentals (earnings/KPIs):31; corporate event:1 | CoreWeave contracted power capacity in fiscal 2026 |
| LLY | Eli Lilly | 4 | 32 | 1,151 | 13,426 | 0 | mention (what a speaker says):17; fundamentals (earnings/KPIs):13; pl… | What will Eli Lilly say during their next earning… |
| RKLB | Rocket Lab Corporation | 4 | 32 | 1 | 23,277 | 0 | corporate event:18; tech/product:14 | When will Rocket Lab Corporation launch Neutron |
| LULU | Lululemon | 2 | 30 | 13,065 | 22,431 | 0 | fundamentals (earnings/KPIs):30 | Lululemon Credit Card Spend in October |
| ADBE | Adobe | 2 | 29 | 151 | 692 | 0 | mention (what a speaker says):29 | What will Shantanu Narayen say during Adobe MAX O… |
| F | Ford Motor | 2 | 27 | 0 | 27,916 | 0 | fundamentals (earnings/KPIs):27 | Ford US vehicle sales volume in 2026 |
| ZETA | Zeta Global | 2 | 18 | 0 | 680 | 0 | fundamentals (earnings/KPIs):18 | Zeta super-scaled customers (>$1m) in 2026 |
| JNJ | Johnson & Johnson | 2 | 17 | 763 | 1,542 | 0 | mention (what a speaker says):16; corporate event:1 | What will Johnson & Johnson say during their next… |
| NU | Nu | 2 | 17 | 0 | 1,423 | 0 | fundamentals (earnings/KPIs):17 | Nu Holdings customers in 2026 |
| SNAP | Snap | 2 | 17 | 0 | 4,288 | 0 | fundamentals (earnings/KPIs):17 | Snap daily active users in Q3 |
| COIN | Coinbase | 4 | 16 | 5 | 2,391 | 0 | fundamentals (earnings/KPIs):14; company other:1; mention (what a spe… | Which brands will advertise during the Big Game? |
| BULL | Webull | 2 | 15 | 0 | 3,781 | 0 | fundamentals (earnings/KPIs):15 | Webull funded accounts in Q3 |
| DDOG | Datadog | 2 | 15 | 200 | 7,611 | 0 | fundamentals (earnings/KPIs):15 | Datadog customers over $100k ARR in Q3 |
| SOFI | SoFi Technologies | 4 | 15 | 18 | 5,352 | 0 | fundamentals (earnings/KPIs):13; platform/content ranking:1; corporat… | SoFi members in Q3 |
| AVAV | AeroVironment | 1 | 14 | 0 | 793 | 0 | mention (what a speaker says):14 | What will AeroVironment say during their next ear… |
| BB | Blackberry | 1 | 14 | 0 | 283 | 0 | mention (what a speaker says):14 | What will BlackBerry say during their next earnin… |
| CRCL | Circle Internet Group | 3 | 14 | 0 | 213 | 0 | stock price / market cap:12; corporate event:2 | USDC + USDT market cap at year end 2026? |
| FUTU | Futu Holdings | 2 | 14 | 0 | 382 | 0 | fundamentals (earnings/KPIs):14 | Futu total funded accounts in fiscal 2026 |
| NET | Cloudflare, Inc. Class A co… | 3 | 14 | 0 | 981 | 0 | fundamentals (earnings/KPIs):13; corporate event:1 | Which companies will be added to the S&P 500 in Q… |
| BABA | Alibaba | 12 | 13 | 127 | 64,708 | 0 | tech/product:13 | Top Chinese AI company this month |
| MSTR | Strategy Inc. | 3 | 13 | 4 | 10,304 | 0 | macro (rate/price proxy):11; platform/content ranking:1; corporate ev… | Michael Saylor net worth on Dec 31, 2026 |
| SHOP | Shopify | 3 | 13 | 0 | 5,384 | 0 | fundamentals (earnings/KPIs):12; mention (what a speaker says):1 | Shopify gross merchandise volume in fiscal 2026 |
| ASTS | AST SpaceMobile | 1 | 12 | 2 | 1,047 | 0 | mention (what a speaker says):12 | What will AST SpaceMobile say during their next e… |
| FIG | Figma | 3 | 12 | 0 | 1,055 | 0 | fundamentals (earnings/KPIs):11; corporate event:1 | Figma paid customers >$100k arr in fiscal 2026 |
| ZM | Zoom | 2 | 11 | 0 | 205 | 0 | fundamentals (earnings/KPIs):11 | Zoom customers with over $100k in TTM revenue in … |
| DJT | Trump Media & Technology Gr… | 2 | 8 | 8,254 | 16,598 | 0 | political/policy reference:8 | How many people will Trump endorse on Truth Socia… |
| PATH | UiPath | 1 | 6 | 0 | 401 | 0 | fundamentals (earnings/KPIs):6 | UiPath customers with arr of at least $1m in fisc… |
| NBIS | Nebius Group | 3 | 3 | 0 | 428 | 0 | mention (what a speaker says):2; corporate event:1 | Which companies will be acquired this year? |
| TSM | Taiwan Semiconductor Manufa… | 3 | 3 | 12 | 10,891 | 0 | mention (what a speaker says):2; corporate event:1 | Which companies will the US take a stake in this … |
| AMD | AMD | 2 | 2 | 0 | 3,986 | 0 | mention (what a speaker says):2 | What companies will Trump say in October? |
| DELL | Dell | 2 | 2 | 333 | 2,008 | 0 | macro (rate/price proxy):1; mention (what a speaker says):1 | What companies will Trump say in October? |
| EWY | iShares MSCI South Korea fu… | 0 | 0 | 0 | 0 | 2 |  |  |
| FICO | Fair Isaac | 2 | 2 | 319 | 877 | 0 | mention (what a speaker says):2 | What will Ally Financial say during their next ea… |
| IBM | IBM | 2 | 2 | 0 | 6,449 | 0 | tech/product:1; mention (what a speaker says):1 | Which AI companies will have a Pareto efficient m… |
| IONQ | IonQ | 2 | 2 | 0 | 10,350 | 0 | corporate event:2 | Which companies will the US take a stake in this … |
| MU | Micron Technology | 2 | 2 | 0 | 11,600 | 0 | corporate event:1; mention (what a speaker says):1 | Which companies will the US take a stake in this … |
| ALAB | Astera Labs, Inc. | 1 | 1 | 0 | 372 | 0 | corporate event:1 | Which companies will be added to the S&P 500 in Q… |
| AVGO | Broadcom | 1 | 1 | 0 | 925 | 0 | mention (what a speaker says):1 | What will Apple say during their next earnings ca… |
| CBRS | Cerebras Systems | 1 | 1 | 0 | 0 | 0 | corporate event:1 | Which companies will be added to the S&P 500 in Q… |
| CRDO | Credo Technology Group | 1 | 1 | 0 | 214 | 0 | corporate event:1 | Which companies will be added to the S&P 500 in Q… |
| CRM | Salesforce | 1 | 1 | 0 | 0 | 0 | corporate event:1 | Which companies will be removed from the Dow Jone… |
| CSCO | Cisco Systems | 1 | 1 | 0 | 16 | 0 | corporate event:1 | Which companies will be removed from the Dow Jone… |
| FISV | Fiserv | 1 | 1 | 0 | 21 | 0 | mention (what a speaker says):1 | What will Mastercard say during their next earnin… |
| FTNT | Fortinet | 1 | 1 | 0 | 120 | 0 | mention (what a speaker says):1 | What will Intel say during their next earnings ca… |
| GME | GameStop | 1 | 1 | 8,155 | 1,197,919 | 0 | corporate event:1 | Will GameStop acquire eBay in 2026? |
| MDB | MongoDB | 1 | 1 | 0 | 119 | 0 | corporate event:1 | Which companies will be added to the S&P 500 in Q… |
| MRNA | Moderna | 1 | 1 | 0 | 200 | 0 | corporate event:1 | Companies added to the MSCI USA Index in Q4? |
| NAVN | Navan | 1 | 1 | 0 | 0 | 0 | mention (what a speaker says):1 | What will Hilton say during their next earnings c… |
| OKLO | Oklo | 1 | 1 | 0 | 0 | 0 | corporate event:1 | Companies added to the MSCI USA Index in Q4? |
| PFE | Pfizer | 1 | 1 | 0 | 3,481 | 0 | corporate event:1 | Which companies will the US take a stake in this … |
| QCOM | Qualcomm | 1 | 1 | 0 | 82 | 0 | mention (what a speaker says):1 | What companies will Trump say in October? |
| RGTI | Rigetti Computing | 1 | 1 | 105 | 608 | 0 | mention (what a speaker says):1 | What companies will Trump say in October? |
| TEAM | Atlassian Corporation | 1 | 1 | 0 | 0 | 0 | corporate event:1 | Which companies will be added to the S&P 500 in Q… |
| UNH | UnitedHealth | 1 | 1 | 0 | 2 | 0 | corporate event:1 | Which companies will be removed from the Dow Jone… |
| WDAY | Workday | 1 | 1 | 0 | 2,629 | 0 | corporate event:1 | Will Silver Lake acquire Workday this year? |

Tokens with no linked open market (106): AAOI, ABCL, AEHR, AEIS, AMAT, AMBA, AMC, AMKR, ANET, APLD, APP, ASML, AUR, AXON, AXTI, BE, CEG, CELH, CIEN, CLOV, CLS, CLSK, COHR, CRWD, CTSH, DOCN, ELF, EWT, FIX, FLNC, FLY, GE, GEV, GLW, GLXY, HII, HPE, HWM, IBRX, INDA, INFQ, INOD, INTU, IREN, JBL, JOBY, KLAC, KSS, KTOS, LHX, LITE, LRCX, LUNR, MOD, MPWR, MRVL, MTSI, MXL, NNE, NOW, NVTS, ON, ONTO, OUST, P, PANW, PENG, PL, POET, POWL, PR, PWR, QBTS, QUBT, RCAT, RDW, RUN, SATS, SCHD, SIMO, SKHY, SLS, SMCI, SMH, SMR, SNDK, SOUN, SOXX, TE, TEM, TER, TSEM, TTD, UMC, UPS, USAR, VICR, VRT, VSAT, VST, WDC, WULF, WYFI, XLK, XNDU, ZS.

**Top asset-linked events by 24h volume**

| # | Event | Assets | Link type | 24h vol | Open interest | Market close (UTC) |
|--:|:--|:--|:--|--:|--:|:--|
| 1 | BTC price on Oct 20, 2026 at 3am EDT? `KXBTCD-26OCT2003` | BTC | price | 490,482 | 282,003 | 2026-10-20T07:00 |
| 2 | US gas prices this week `KXAAAGASW-26OCT26` | US gasoline (AAA retail) | macro (rate/price proxy) | 487,298 | 95,226 | 2026-10-26T03:59 |
| 3 | BTC price on Oct 23, 2026 at 5pm EDT? `KXBTCD-26OCT2317` | BTC | price | 326,481 | 482,733 | 2026-10-23T21:00 |
| 4 | BTC price on Oct 20, 2026 at 5pm EDT? `KXBTCD-26OCT2017` | BTC | price | 324,990 | 182,466 | 2026-10-20T21:00 |
| 5 | Will Bitcoin be above $200k by 2027? `KXBTC2026200-27JAN01` | BTC | price | 268,882 | 4,617,889 | 2027-01-01T05:00 |
| 6 | BTC 15 min · $81,662.40 target `KXBTC15M-26OCT200245` | BTC | price | 238,351 | 346,630 | 2026-10-20T06:45 |
| 7 | Fed decision in Oct 2026? `KXFEDDECISION-26OCT` | Fed funds / policy rate | macro (rate/price proxy) | 171,627 | 5,838,304 | 2026-10-28T17:59 |
| 8 | Will BTC hit $50,000 before $100,000? `KXBTC50VS100-BTC-26DEC31` | BTC | price | 110,056 | 1,038,882 | 2027-01-01T04:59 |
| 9 | Bitcoin price at the end of 2026 `KXBTCY-27JAN0100` | BTC | price | 99,266 | 10,690,027 | 2027-01-01T05:00 |
| 10 | Gas prices in the US in Oct 2026? `KXAAAGASM-26OCT31` | US gasoline (AAA retail) | macro (rate/price proxy) | 78,697 | 234,788 | 2026-10-31T03:59 |
| 11 | Oil Price (WTI) on Oct 20, 2026? `KXWTI-26OCT2014` | Oil (WTI/Brent) | price | 65,437 | 53,707 | 2026-10-20T18:30 |
| 12 | Copper price on Oct 20, 2026 at 5:00 PM EDT? `KXCOPPERD-26OCT2017` | Copper | price | 63,781 | 16,210 | 2026-10-20T21:00 |
| 13 | New Jersey gas price at year-end 2026 `KXAAAGASEOYNJ-26DEC31` | US gasoline (AAA retail) | macro (rate/price proxy) | 51,677 | 4,752 | 2026-12-31T04:59 |
| 14 | Gold price on Oct 20, 2026 at 5:00 PM EDT? `KXGOLDD-26OCT2017` | Gold | price | 51,009 | 32,016 | 2026-10-20T21:00 |
| 15 | How many launches will SpaceX have in October? `KXSPACEXCOUNT-26OCT` | SPCX | tech/product | 49,049 | 137,737 | 2026-11-01T14:00 |
| 16 | S&P close price end of 2026? `KXINXY-26DEC31H1600` | S&P 500 | price | 48,365 | 5,264,868 | 2026-12-31T21:00 |
| 17 | How high will ZEC get in October? `KXZECMAXMON-ZEC-26OCT31` | ZEC | price | 47,603 | 11,969 | 2026-11-01T03:59 |
| 18 | BNB price on Oct 23, 2026 at 5pm EDT? `KXBNBD-26OCT2317` | BNB | price | 46,371 | 1,663 | 2026-10-23T21:00 |
| 19 | Copper price on Oct 23, 2026 at 5:00 PM EDT? `KXCOPPERW-26OCT2317` | Copper | price | 43,983 | 17,032 | 2026-10-23T21:00 |
| 20 | Grand Theft Auto VI: The Album · Features `KXFEATURE-26GTA6` | TTWO | platform/content ranking | 42,809 | 333,281 | 2026-12-31T04:59 |
| 21 | Best AI at the end of 2026? `KXLLM1-26DEC31` | GOOGL, SPCX | tech/product | 42,196 | 2,409,099 | 2026-12-31T15:00 |
| 22 | How high will BTC get in October? `KXBTCMAXMON-BTC-26OCT31` | BTC | price | 41,330 | 802,029 | 2026-11-01T03:59 |
| 23 | How low will ZEC get in October? `KXZECMINMON-ZEC-26OCT31` | ZEC | price | 37,414 | 957 | 2026-11-01T03:59 |
| 24 | Will the S&P finish positive this year? `KXINXPOS-26DEC31H1900` | S&P 500 | price | 32,768 | 585,099 | 2027-01-01T00:00 |
| 25 | Gold 15 min · $4,130.89 target `KXGOLD15M-26OCT200245` | Gold | price | 31,480 | 27,943 | 2026-10-20T06:45 |

**Top asset-linked events by open interest**

| # | Event | Assets | Link type | 24h vol | Open interest | Market close (UTC) |
|--:|:--|:--|:--|--:|--:|:--|
| 1 | Bitcoin price at the end of 2026 `KXBTCY-27JAN0100` | BTC | price | 99,266 | 10,690,027 | 2027-01-01T05:00 |
| 2 | Number of rate cuts in 2026? `KXRATECUTCOUNT-26DEC31` | Fed funds / policy rate | macro (rate/price proxy) | 5,052 | 6,582,971 | 2027-01-01T04:59 |
| 3 | Fed decision in Oct 2026? `KXFEDDECISION-26OCT` | Fed funds / policy rate | macro (rate/price proxy) | 171,627 | 5,838,304 | 2026-10-28T17:59 |
| 4 | S&P close price end of 2026? `KXINXY-26DEC31H1600` | S&P 500 | price | 48,365 | 5,264,868 | 2026-12-31T21:00 |
| 5 | Will Bitcoin be above $200k by 2027? `KXBTC2026200-27JAN01` | BTC | price | 268,882 | 4,617,889 | 2027-01-01T05:00 |
| 6 | Nasdaq-100 close price end of 2026? `KXNASDAQ100Y-26DEC31H1600` | Nasdaq-100 | price | 8,720 | 3,595,820 | 2026-12-31T21:00 |
| 7 | How high will oil (WTI) get by Dec 31, 2026? `KXWTIMAX-26DEC31` | Oil (WTI/Brent) | price | 13,668 | 3,439,673 | 2026-12-31T19:30 |
| 8 | Best AI at the end of 2026? `KXLLM1-26DEC31` | GOOGL, SPCX | tech/product | 42,196 | 2,409,099 | 2026-12-31T15:00 |
| 9 | How low will Bitcoin get in 2026? `KXBTCMINY-27JAN01` | BTC | price | 13,600 | 2,045,261 | 2027-01-01T05:00 |
| 10 | Grand Theft Auto VI: Release date `GTA6` | TTWO | platform/content ranking | 25,156 | 1,334,528 | 2028-01-02T04:59 |
| 11 | How high will Bitcoin get in 2026? `KXBTCMAXY-26DEC31` | BTC | price | 13,465 | 1,324,046 | 2027-01-01T04:59 |
| 12 | Will GameStop acquire eBay in 2026? `KXACQANNOUNCEEBAY-27JAN01` | GME | corporate event | 8,155 | 1,197,919 | 2027-01-01T04:59 |
| 13 | Will BTC hit $50,000 before $100,000? `KXBTC50VS100-BTC-26DEC31` | BTC | price | 110,056 | 1,038,882 | 2027-01-01T04:59 |
| 14 | How high will US gas prices get in 2026? `KXAAAGASMAX-26DEC31` | US gasoline (AAA retail) | macro (rate/price proxy) | 1,729 | 927,798 | 2026-12-31T06:25 |
| 15 | Fed decision in Dec 2026? `KXFEDDECISION-26DEC` | Fed funds / policy rate | macro (rate/price proxy) | 11,106 | 916,432 | 2026-12-09T18:59 |
| 16 | How high will BTC get in October? `KXBTCMAXMON-BTC-26OCT31` | BTC | price | 41,330 | 802,029 | 2026-11-01T03:59 |
| 17 | When will Bitcoin hit $150k? `KXBTCMAX150-25` | BTC | price | 16,611 | 777,422 | 2027-01-01T04:59 |
| 18 | How high will Ethereum get in 2026? `KXETHMAXY-27JAN01` | ETH | price | 9,656 | 748,674 | 2027-01-01T05:00 |
| 19 | #1 searched person on Google in 2026 `KXRANKLISTGOOGLESEARCH-26DEC` | GOOGL | platform/content ranking | 2,670 | 746,406 | 2026-12-31T15:00 |
| 20 | Ethereum price at the end of 2026 `KXETHY-27JAN0100` | ETH | price | 5,446 | 729,694 | 2027-01-01T05:00 |
| 21 | When will Bitcoin cross $100k again? `KXBTCMAX100-26` | BTC | price | 9,800 | 633,389 | 2026-12-01T05:00 |
| 22 | Will the S&P finish positive this year? `KXINXPOS-26DEC31H1900` | S&P 500 | price | 32,768 | 585,099 | 2027-01-01T00:00 |
| 23 | Fed rate cut before 2027? `KXRATECUT-26DEC31` | Fed funds / policy rate | macro (rate/price proxy) | 17 | 549,739 | 2027-01-01T04:59 |
| 24 | Will Bitcoin be above $250k by 2027? `KXBTC2026250-27JAN01` | BTC | price | 2,425 | 513,972 | 2027-01-01T05:00 |
| 25 | BTC price on Oct 23, 2026 at 5pm EDT? `KXBTCD-26OCT2317` | BTC | price | 326,481 | 482,733 | 2026-10-23T21:00 |

## 7. Caveats

- **Combos (MVE / parlays) are excluded everywhere above.** They are large. In one peak hour (2026-10-18 03:00–04:00 UTC, end of US college-football Saturday) more than 400,000 combo markets settled (the probe stopped at 400 pages, so the true count is higher); 91,589 of them had trades, totalling at least 119,042,054 contracts, against 150,929,793 contracts for non-combo markets settling in the same hour. In a weekday mid-day hour (2026-10-14 15:00–16:00 UTC) 8,944 combo markets settled with 9,583,269 contracts, against 38,743,338 non-combo. So combos add very roughly 25%–80% on top of single-market contract volume, concentrated in sports parlays (`KXMVECROSSCATEGORY-R`). Open combo inventory is at least 30,000 markets (a probe stopped after 30 pages of 1,000) with no 24h volume in that sample, and the series volume endpoint reports 0 for combo series, so a full census was not attempted. A trade sample of 16 combo markets gives 0.229 taker $ per contract (cheaper side 0.079).
- **Volume counting.** Volume counts each matched contract once (not once per side). Lifetime volume of settled markets is attributed to the close day. Fractional contracts exist (`_fp` fields).
- **Dollar estimates.** Taker $ per contract comes from up to 6 volume-weighted markets per series; for the heaviest markets (e.g. 15-minute BTC, NFL and college-football games) only the latest 30,000 trades per market were read. 9 of 379 sampled series had at least one truncated market: `KXBTC15M`, `KXNFLGAME`, `KXNCAAFGAME`, `KXMLBGAME`, `KXNFLSPREAD`, `KXUCLGAME`, `KXEPLGAME`, `KXBOXING`, `KXMLB`; together they carry about half of the sampled 7-day volume. Their taker prices (0.37–0.49 $/contract) sit in the same range as comparable untruncated series (ATP/WTA/ITF matches 0.45–0.54, `KXBTCD` 0.47, `KXGOLD15M` 0.45). A check against full-life candlesticks shows the truncated reads understate the cheaper-side price (0.176 $/contract in the trade sample vs 0.309 from candles; candles themselves read 0.275 vs 0.215 from trades on 25 untruncated control markets, i.e. about +0.06 high), while the YES-side price is close (0.413 vs 0.435). The taker price cannot be checked with candles. Treat dollar figures as ±15%.
- **Snapshot timing.** 06:32–06:40 UTC Tuesday = 2:30 AM US Eastern. US equity, rates and FX markets were closed; the NFL Monday-night game had just finished; World Series and the 2026 midterms (Nov 3) were in progress. 24h figures for the open book reflect that. The 7- and 30-day settled tables are time-of-day neutral.
- **Event counting.** 'Events' are Kalshi events (one game, one CPI release, one 15-minute BTC window). An event can hold one market (binary) or hundreds (strike ladders: BTC above/below lists ~190 strikes per hour).
- **Frequency labels** are Kalshi's and are not always accurate (e.g. `KXINXU` 'hourly' resolves on the daily close; most sports are `custom`). Families use observed cadence.
- **Asset matching** is keyword-based; spot checks removed obvious false hits (e.g. 'Cisco Aguilar' in a Nevada race), but 'mention' and 'platform/content' links (a word said on a call, a Netflix chart) do not move the asset.
- **Settlement sources** are the first names in the series' `settlement_sources`; the market rules text is authoritative (e.g. NYC high temperature settles on 'CLINYC' as reported by The Weather Company; crypto on CF Benchmarks RTI 60-second averages; gold/oil/FX/yields on Pyth 1-minute candles).
- **Historical store.** Markets settled before 2026-08-20 have moved to `/historical/...`; nothing in this census needed them except longer release histories.

## Files

In this folder:

- `kalshi_category_breakdown.csv` — category shares (open snapshot)
- `kalshi_kalshi_category_breakdown.csv` — Kalshi's own categories
- `kalshi_subcategory_breakdown.csv` — sports leagues and financials subtypes
- `kalshi_top50_events_by_vol24.csv` — top 50 events by 24h volume
- `kalshi_top50_events_by_oi.csv` — top 50 by open interest
- `kalshi_top50_events_by_vol.csv` — top 50 by lifetime volume
- `kalshi_top15_events_per_category.csv` — top 15 per category, three rankings
- `kalshi_horizon_distribution.csv` — time-to-resolution buckets
- `kalshi_horizon_by_category.csv` — horizon by category
- `kalshi_settled_throughput.csv` — 7d/30d settled volume by frequency, category, league, lifetime
- `kalshi_settled_series_stats.csv` — per-series instance stats over 30 days (all series that settled)
- `kalshi_short_term_families.csv` — short-term families
- `kalshi_short_term_series.csv` — short-term series
- `kalshi_premium_ratios.csv` — taker/YES/cheaper-side $ per contract by series
- `kalshi_asset_linked_markets.csv` — every asset-linked open market
- `kalshi_asset_counts.csv` — counts per token, crypto asset and underlying
- `kalshi_robinhood_token_coverage.csv` — all 195 Robinhood tokens with direct and proxy counts
- `kalshi_open_events.csv` — all open events with totals
- `kalshi_series.csv` — all 15,225 series with frequency, tags, sources, fees, open totals

Raw data and scripts (`/Volumes/T9/tmp-probabl/market-research/kalshi/`): `raw/series.json`, `raw/events_open.json`, `raw/markets_open_nonmve.json`, `raw/settled/*.json` (31 daily files, 1.7 GB), `raw/series_settled/`, `raw/trades/`, `raw/orderbooks.json`, `raw/mve/`; `out/kalshi_open_markets.csv` (all 131,777 open markets, 49 MB) and `out/settled_instances_30d.csv`; scripts `kapi.py`, `snapshot.py`, `settled.py`, `series_settled.py`, `premium.py`, `orderbook.py`, `mve_probe.py`, `classify.py`, `families.py`, `analyze_open.py`, `analyze_settled.py`, `analyze_short.py`, `analyze_assets.py`, `blocks.py`, `make_report.py`.

## Sources

- Kalshi trade API v2 (public market data): https://api.elections.kalshi.com/trade-api/v2
- Fee formula summaries (third-party; Kalshi's PDF schedule returned HTTP 429 to our fetch): [chudi.dev — Kalshi fees](https://chudi.dev/blog/kalshi-fees), [pm.wiki — Kalshi fees explained](https://pm.wiki/uk/learn/kalshi-fees-explained), [River Markets — Kalshi fees](https://www.rivermarkets.com/insights/kalshi-fees.html)
