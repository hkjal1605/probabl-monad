# World vault pricing: live inputs, research and plan

2026-11-06. This covers the world keeper's quoting formula (`services/world-keeper`) and every input it reads. Three research passes back it: stock-side estimation methods, prediction-market data and methods, and market-data vendors. Sources are listed at the end.

- **[V]** means the claim was checked in a fetched source.
- **[I]** means it is our inference or a derivation, not yet tested on our data.

---

## 1. Summary

- **Most inputs are not live today.** The quote formula is
  `V ± z·SD ± A_flb ± A_hor ± I ± O ± C ± R`. On the live box today, most of its inputs are constants or defaults:
  - The database holds 1 correlation, 2 event volatilities, 1 stock volatility, 0 event→stock gaps and 0 relations.
  - Every builder preview of a new world prices on defaults only.
- **The only fitted stock volatility is wrong.** XOM shows 140% against a real 20–25%. It comes from one bad weekend price, and three things let it through:
  - our reference-price code accepts a quote without checking its spread;
  - the feed mirror posts that price;
  - the fit computes volatility from deviation-triggered feed rounds with no outlier filter.
- **The same bad price reached the keeper's spot check.** For that weekend, both of its two sources were wrong in the same way, so they agreed.
- **The goal: no hardcoded fallbacks.** Every input gets:
  - a live source and a freshness limit;
  - an uncertainty (SE) that comes from its estimator;
  - a fallback that is itself estimated and widens the price.
  If no estimate exists, the book declines with a named reason. The model never silently drops to a constant.
- **What can't come from data.** A short list of risk-appetite parameters can never be measured: how much uncertainty to charge for, risk aversion, limits. These move into one reviewed, versioned policy file with no defaults in code. Where data can inform them, backtests calibrate them.
- **Blocking issues outside engineering: data licences.** Our use is pricing a financial product from the data. Most sources restrict exactly that:
  1. Kalshi's API and data terms bar using its data to value or price financial products without Kalshi's written consent. We already do this with Kalshi midpoints.
  2. Massive's business terms forbid using its data to create "event contracts".
  3. ORATS licenses internal, "informational" use.
  4. Deribit's market data is "personal use only".
  5. Real-time options data read by an automated system adds an exchange (OPRA) "non-display" fee of about $2,000 a month.
- **Recommended vendor stack, about $600 a month:**
  - ORATS Delayed ($199): fixed-tenor implied vol, skew and earnings implied moves.
  - EODHD Internal use ($399): bars and the earnings calendar.
  - Deribit for crypto, free with approval.
  - The Treasury bill-rate feed, free.
  Every one needs a written licence for production pricing (§6, §9). Live options data later costs about $2.7–3.0k a month with OPRA fees.

---

## 2. The volatility bug

**Evidence.** These come from the box, the XOM mock feed and the price history.

1. **The bad price.** At 2026-10-31 00:00:43 UTC (Friday 8:00 PM ET, the moment Robinhood's 24-hour session closes), round 61 of the XOM mock feed was **$146.07**. The round before it, at 19:50 UTC, was $187.25.
   - The feed's heartbeat re-posted it on 2026-11-02 at 00:01 UTC.
   - Round 64, on 2026-11-02 at 01:00 UTC (the Sunday 8 PM ET reopen), was back to $187.31.
2. **Why the code accepted it.** `apps/server/src/market-data/robinhood.ts` takes the midpoint of Robinhood's `/prices/{symbol}` bid and ask and checks only `bid ≤ ask` and the halt flag.
   - There is no spread check and no trading-session check.
   - A degenerate quote at the session close gives a midpoint far from the market.
   - This is inferred from the timing: the quote fields at that minute are not stored.
3. **Why the feed posted it.** `scripts/evm/feed-mirror.ts` writes a reference round on any 0.5% move or after 24 hours. So it posted the bad price, and then re-posted it on the heartbeat.
4. **Why the fit turned it into 140%.** `services/world-keeper/src/fit.ts` builds "daily bars" from feed rounds. Those rounds are not real OHLC data.
   - The fit runs Yang–Zhang on 21 and 63 days and an EWMA. With only 11 bars, every estimator falls back to the same 11.
   - A −22% move and a +22% move one session apart add about 2·0.22²/10 ≈ 0.0097 per day of overnight variance. That alone is about 156% a year.
   - **Dropping the bad bar doesn't give a usable number either.** The 9 remaining returns give 38% close-to-close, because XOM fell from $187 to $166 that week. Nine returns carry about ±24% relative error. Today's code would also fall to its 20% class floor, because 10 bars is under its minimum.
   - **The real problem is the data, not only the outlier:** 11 deviation-triggered rounds a day can't measure volatility.
5. **What it did to the price.** The keeper reloads fitted data every 10 minutes, and it picked this value up at 03:32 UTC today. In that same minute, world #1's All-in price jumped:
   - from bid 12.9¢ / ask 17.8¢ to bid 22.5¢ / ask 25.2¢;
   - Money-back's ask went from 23.9¢ to 33.7¢.
   Part of the narrower spread is a separate effect. A fitted correlation makes the pair no longer "prior only", so z drops from 0.75 to 0.5.

**Why a jump-robust estimator doesn't save it.** A bad print that reverts creates two adjacent jumps of opposite sign. MedRV and MinRV assume jumps never come in adjacent pairs, so they still count it [V: ADS 2012]. The print has to be removed before any estimator runs.

**Other places that use the same unchecked midpoint:**
- the keeper's spot reference;
- the API's `/v1/spot-prices`;
- the Δ-vault keepers on testnet.

World fixings are taken at the 4 PM close, so they avoid the overnight session. On early-close days, though, 4 PM falls outside the regular session.

---

## 3. The rule for every input

> **User decision, 2026-11-06:** when live data for an input is unavailable, fall back to today's hardcoded value and keep quoting. Do not decline the quote.
>
> The "When it is missing or stale" column below described a stricter design and is superseded by this rule. The fallback should still show in the quote's provenance, so we can see how often each default is used.
>
> **Data sources, 2026-11-06:** the user chose Yahoo Finance for stock volatility, skew, earnings and price history while on testnet. It is blocked: its price endpoint answers 429 to automated requests, and its options and earnings endpoints require a browser cookie and "crumb" that exist to keep bots out. The choice of source is open again.
>
> Whatever free source testnet uses, it must be replaced by a licensed vendor (§6.6) before mainnet. The code should refuse to run it on a mainnet chain.

Each number the pricer reads falls in exactly one class.

| Class | Examples | Where it comes from | When it is missing or stale |
|---|---|---|---|
| **A. Market data** | event mids and spreads, spot, implied vol, skew, earnings dates, fees, book depth, risk-free rate | A named live source with a freshness limit, cross-checked against a second source where one exists | The book declines with a named reason ("No live volatility for US:XOM") |
| **B. Statistical estimates** | correlations, event volatility, gaps, calibration slopes, informed-trading tilts, realized vol, weekend weights | Fitted on a schedule from data, each with its own SE | An estimated prior with a measured SE: a hierarchical or panel model fitted on the population. Its larger SE widens the quote |
| **C. Policy** | z, γ, Kelly fraction, limits, markup bounds, capital-curve shape above the base rate, outlier and fail-closed thresholds | One versioned policy file, reviewed, with no defaults in code. Calibrated by backtest where data informs it | The keeper refuses to start |

**Mathematical constants are not parameters.** Examples: the 1.4826 that turns a MAD into a standard deviation, 252 trading days a year, and quadrature nodes.

The stale-quote factor 0.4 belongs here too. It is the at-the-money option value per σ√T, which is 1/√(2π) = 0.399 [I]. It should be written as that, not as a tunable number.

**Each quote records where its inputs came from:** source, age, value and SE for each input. This goes in the keeper's quote log, so any price can be audited and replayed.

---

## 4. Every input: today → target

### 4.1 The stock inside a world

| Input | Today | Target source and estimator | Uncertainty | Without data |
|---|---|---|---|---|
| Spot S₀ | Robinhood midpoint, unchecked, cross-checked only against the feed | Robinhood midpoint, accepted only when the spread is under the session's limit and the quote is fresh, and labelled by session (regular, extended, overnight, closed). The feed round is the live second source; vendor bars check prices afterwards. A real-time vendor quote would add the ~$9,500/mo stock non-display fee | — | Decline |
| Volatility σ to the fixing | Fit from feed rounds; else 2× a class floor (stock 40%) | **Primary:** implied vol from an arbitrage-free surface fitted to option quotes (SSVI, Gatheral–Jacquier [V]), read at the fixing date on our variance clock. Event variance is stripped and added back per world. **Cross-check:** a HARQ forecast [V: BPQ 2016] from MedRV on 5-minute bars [V: ADS 2012], times the measured variance risk premium | IV: from the bid–ask width of each quote through the fit's parameter covariance. Realized: the estimator's asymptotic SE (MedRV 2.96·IQ/N [V]) | Panel prior: regression on sector ETF IV, beta and size, with its residual SD. Shrink toward it in log variance by precision [V: Vasicek 1973] |
| Vol SE | Fixed 15% | From the estimator, as above | — | — |
| `implied` flag | Always false | True when σ comes from the surface. The model then subtracts the events' own variance from it, which the fixing code already supports | — | — |
| Skew ψ | Class prior: stock −0.15, ETF −0.30, crypto 0 | ∂σ/∂k at the strike, read from the fitted surface. For SSVI, ψ(τ) = ρ√θ·φ(θ)/(2√τ) [V] | From the fit's covariance | A class prior fitted on the panel, with its SE. Below one month, ψ ∝ (τ+ε)^−α with α estimated per asset; the fixed −0.4 power overstates short-dated skew [V: Guyon–El Amrani] |
| Earnings date | One date, typed by hand (NVDA) | Vendor calendar: confirmed or estimated date, before or after market. The option term structure confirms which expiry contains it | — | An estimated date carries its own date uncertainty. A world whose fixing falls inside that window declines |
| Earnings move | 7%, typed by hand | Implied from two expiries straddling the announcement: σ_E² = (σ₁² − σ₂²)/(1/T₁ − 1/T₂) [V: Dubinsky et al. 2019]. Combined with the history of the last 8 or more earnings-day moves, shrunk toward the sector. Not needed when σ is implied (it is already inside the surface) | Two-expiry SE [I]; history SE ≈ v̂·√((κ̂−1)/n) | Sector prior |
| Weekend/holiday weight | 0.1 day, fixed | Per-asset ratio of weekend to weekday variance from overnight returns, pooled by class [I]; French–Roll found about 0.1 on average [V] | About 0.08 day from overnight data | Class mean |
| Trading calendar | NYSE holidays typed in up to 2028; no early closes | The vendor's market calendar, early closes included. Early-close sessions weighted by their share of daily variance (intraday profile) | — | Decline beyond the published calendar |
| Event → stock gap gᵢ | 0 ± 0.03 for every pair (no fits, no reviewed values) | See §5.6: high-frequency regressions of the stock's sector-adjusted return on the event's probability change, plus observations at resolution | SE(β) = σ_ε/√ΣΔq² | Hierarchical prior by event type × sector, starting from an LLM-elicited sign and size with SD ≥ max(0.5·\|m\|, 0.02), recalibrated as events resolve. For scheduled catalysts, capped by the option-implied event move |
| Jump dispersion at resolution | 0.5·\|g\| (so 0 today) | The residual variance of the resolution observations | — | Pooled by event type |

### 4.2 The events

| Input | Today | Target source and estimator | Uncertainty | Without data |
|---|---|---|---|---|
| Chance q, half-spread | Live venue midpoint and spread | Keep | — | Decline (as today) |
| Venue gap | Always 0 | **Listed on both venues:** d = logit q_PM − logit q_K, tracked as an EWMA of its mean and variance; the two midpoints combined by precision. **One venue only:** a noise model fitted on the events listed on both, using spread, depth within 2¢, 1-hour midpoint variance, volume, horizon and category. Plus a Roll noise term [I] | Fitted | The single-venue noise model |
| Event volatility (probit per √day) | Fitted only for legs in open worlds; else 0.15 | EWMA of jump-robust realized probit variance, from hourly changes with a noise correction | σ/√(2n) | Hierarchical: log σ = a_category + b·log τ + c·log spread + d·log volume. The structural benchmark is σ ≈ 1/√(days to resolution) [I], and the fixed 0.15 matches only about 44 days |
| Pair correlation ρ | Theme priors 0.15 / 0.08 / 0.03; fitted only for pairs in open worlds with 30 or more co-moving days | Keep the Dimson-corrected Fisher-z estimate with bootstrap SE. Fit it for every catalog event with history, so there is a population to learn priors from | Bootstrap SE | **A random-effects meta-regression across every fitted pair**: z ~ N(x'γ, τ² + se²). Features: category pair, same entity, same series, same deadline, venue, LLM relation label, embedding similarity of titles and rules, horizon ratio. Fitted pairs are shrunk toward it, so the hard 30-day cutoff goes away |
| Exact logic (implies, exclusive) | None: `leg_relations` is empty | **From venue structure, deterministic:** Polymarket `negRisk` groups and Kalshi `mutually_exclusive` events (at most one YES) give exclusive relations. Kalshi `strike_type`/`floor_strike`/`cap_strike` ladders and date ladders give implications. **LLM labels** for the rest, with Paleka et al.'s consistency checks and a price cross-check; disagreements go to review | — | No relation (correlations only) |
| Calibration slope b (A_flb) | 1 / 1.03 / 1.05 / 1.1 by horizon, +0.05 politics | Refit monthly on resolved Polymarket and Kalshi markets: a hierarchical logistic regression of outcome on logit(mid) by category × horizon (a spline in log τ) × venue, with event-clustered errors | SE(b) ≈ 2/√N_events [I] | Pooled effects. Published fits put politics at 1.3–1.8 and short-horizon weather below 1 [V: Le 2026], so today's table is too low for politics and too high for weather |
| Informed-trading tilt κ | 0.02 + 0.02 insider + 0.10 ramp in the last 24 h + 0.05 after a jump | The permanent move in logit midpoint after taker trades of our size: a Kyle λ in log-odds [V: Bartlett–O'Hara 2026], shrunk by class (single-name vs broad-based, then theme), as a fitted function of horizon and recent \|Δlogit\|. Our own fill markouts update it. κ = 2·artanh(μ) [V] | From the fit | Class prior. Takers' bias toward buying YES is miscalibration, already priced in b; counting it again in κ would charge for it twice [V: Bartlett–O'Hara] |
| Cost to hedge on the leg's own venue | 2¢ flat | The exact fee (Kalshi 0.07·C·P(1−P) × the series multiplier, rounded up to the cent; Polymarket's per-market `feeSchedule` × p(1−p)) [V] + half-spread + a walk through the book at the hedge size + slippage measured on our own hedges | — | Decline single-leg event worlds |
| Resolution time | Venue end time, else now + 30 days | Kalshi `expected_expiration_time`, then `close_time`. Polymarket `endDate` plus a lag fitted per category on closed markets. A date read from the rules when the venue gives none | The lag distribution | Decline |
| Themes | Keyword lists | Venue categories and tags, plus the existing words. Themes remain for risk grouping; they no longer set any number directly | — | — |

### 4.3 Capital and risk

| Input | Today | Target |
|---|---|---|
| Capital rate at zero utilization | 1% | The live risk-free rate (T-bill from Treasury or FRED, or the collateral's own yield, whichever the vault forgoes) plus a policy spread curve by utilization |
| γ, z, Kelly fraction, limits, markup bounds | Code defaults merged under a config file | Policy file only: no code defaults, start-up fails without them. z and γ calibrated by backtest (§7.4) |
| CVaR doubling of γ | Never: `gammaScale` is always 1 and `risk.cvar` is unused | Implement CVaR₉₉ under a t-copula (ν fitted [V: Demarta–McNeil]) off the request path in `refresh`, or delete the setting. Recommended: implement it |
| Wallet markout | Credibility-weighted, starting at 0 | Keep. Zero is the population mean by construction, not a default |
| Volatility floors | Floors that silently clamp | Removed. Each asset is checked against its own historical band of implied-over-realized vol; outside it, that asset declines |

---

## 5. Methods, briefly

### 5.1 Cleaning prices before any estimator
Run these in order on log prices [V: Brownlees–Gallo 2006; Hampel]:
1. **Cross-source check:** drop a print if |ln(p/p_ref)| > max(0.5%, 4·σ₁ₘ·√Δt) against the second source.
2. **Brownlees–Gallo filter:** trimmed mean ± 3·SD of the neighbours plus a granularity term.
3. **Hampel filter:** median ± t·1.4826·MAD.
4. **Bounce-back rule:** two opposite returns that nearly cancel, each over c·σ_local, flag the print between them for deletion [I]. This catches the XOM print.
5. **Session rules:** realized vol uses regular-session data plus the official open and close. Overnight and weekend returns enter only through the weekend-weight estimate.

### 5.2 Realized volatility
- **Daily measure:** MedRV on 5-minute returns. Plain RV when no jumps survive cleaning. The overnight return is added with Hansen–Lunde weights [V].
- **Forecast to the fixing:** direct h-step HARQ regressions, estimated as a panel across assets [V: BPQ 2016; Bollerslev et al. 2018]. Beyond about 3 months the forecast is mostly the long-run mean.
- **Feed rounds only:** they can still give a usable estimate, but not as OHLC.
  - Treat them as crossings of a ±0.5% band during open-session time. The count estimator is σ̂² = N·δ²/T, with relative SE √(2/(3N)) [I].
  - A bad print adds only 2 to N, however large it is.
  - At 25% vol, a month gives about 200 crossings, so about 6% SE.
  - This is the interim estimator until vendor bars arrive. It needs no outside data.

### 5.3 The implied-vol surface
- **Data:** out-of-the-money option quotes only. The forward and borrow come from put–call parity [V: Dubinsky et al.].
- **Fit:** SSVI per underlying by weighted least squares. Each quote's weight comes from its bid–ask IV width. Static-arbitrage conditions are enforced [V: Gatheral–Jacquier 2014].
- **Between expiries:** Lemma 5.1, on our trading-day variance clock.
- **Past the last listed expiry:** extend with the HARQ long-run variance times the variance-risk-premium ratio.
- **Variance risk premium:** measured per class as the mean log(RV/IV²) [V: Carr–Wu 2009]. Whether to remove it is a policy choice: Q or P, see §8.
- **Event variance:** removed before interpolating, then added back per world. In a world where event e has resolved to outcome j:
  - drop v_e;
  - add the variance within outcome j;
  - shift the forward.
  For a binary event, v_e = p(1−p)(μ_yes − μ_no)² + p·s_yes² + (1−p)·s_no² [I]. The fixing code already subtracts the events' variance when `implied` is true. It needs nonzero gaps to mean anything.

### 5.4 Crypto
- **Options:** Deribit lists BTC and ETH to 2027-09-24, and SOL and XRP (USDC-settled) to 2027-03-26 [V, API on 2026-11-06]. DOGE has no Deribit options.
- **Vol:** implied where listed. For DOGE, and past the last expiry, σ_coin = σ_BTC,implied × HAR_coin/HAR_BTC [I].
- **Clock:** calendar time, weighted by an hour-of-week variance profile [V: Hansen–Kim–Kimbrough].

### 5.5 Calibration and informed trading
- **Calibration refit.** Data: one midpoint snapshot per resolved market at fixed horizons (1 h, 6 h, 1 d, 3 d, 1 w, 1 mo, 3 mo).
  - Fit on midpoints, not trades.
  - Treat an exclusive set as one cluster.
  - Refit monthly on a rolling 24 months; monitor out-of-sample log loss weekly.
  - About 400 events give ±0.10 on b [I].
- **κ.** Kalshi trades carry the exact taker side; Polymarket's v2 trades carry `side` [V].
  - Polymarket publishes no quote history, so we record its book ourselves (the ingestor already streams it).
  - Standard VPIN gives a median of 1.0 on Kalshi, so it can't discriminate [V: Bartlett–O'Hara]. Use their $500-bucket variant, or the λ estimate.

### 5.6 The event → stock gap
- **Regression:** Δlog S − β_mkt·Δlog M = β·Δq + ε over every regular-hours window (30 minutes, and 1 day) [V: Snowberg–Wolfers–Zitzewitz 2007 used 10- and 30-minute windows].
  - Errors in Δq bias β toward zero. Correct by using the other venue's Δq as an instrument, or by dividing by the reliability ratio from the Roll noise variance [I].
- **Resolution:** each resolution adds one observation, β̂ = r_res/(y − q). A YES resolution moves log S by β(1−q); a NO moves it by −βq [I].
- **New events:** the prior is a hierarchical model by event type × sector. Its first guess is an LLM-elicited sign and magnitude with a wide SD, recalibrated against realized resolution jumps. It never comes from the user's own opinion: that is their view, not the market's.
- **Not a regression:** events defined by the stock's own price (a ladder on the same stock) are digital options, priced from the surface.

---

## 6. Data sources

Checked against vendor pages and live APIs on 2026-11-06.

**Coverage.** Robinhood now lists 203 Stock Tokens, up from 195 on 2026-10-20. Cboe's free delayed feed shows listed options for 201 of them; GDX and SATS could not be checked because Cboe throttled the requests. Of those:
- 198 have expiries a year or more out, most to 2029-01-19.
- NAVN (161 days), BND and HII (223 days each) need extrapolation past the last expiry, or realized vol.
- The thinnest open interest is BND 2.5k, HII 4.5k, AEIS 13k, MTSI 15k, ONTO 16k and SGOV 18k, so their implied vol will be noisy. That noise must show up in the SE.

### 6.1 Options (implied vol, skew, earnings move)
| Vendor | What it returns | Price | Licence for our use |
|---|---|---|---|
| **ORATS** (recommended) | **Ready-made:** IV at fixed tenors 10 days to 1 year (`iv10d`…`iv1y`); skew by delta; ex-earnings IV; `impliedEarningsMove` and 12 quarters of past moves; earnings time of day; per-expiry smoothed vols | Delayed (15 min) $199, 20k requests/mo. Live (<10 s) $299, 100k. Live Intraday $599, 1M. Multi-ticker calls take 10 tickers | Internal business use, "informational purposes only", no redistribution. **Needs written approval for production pricing** |
| Massive (formerly Polygon) | Per-contract IV and greeks in chain snapshots; no fitted surface | Options Business $1,999 (real-time, "no exchange fees") | **Business terms §6.1(f) forbid creating any "financial contract (including… event contracts…)" from the data** without an Order Form and each provider's approval |
| MarketData.app (fallback) | Per-contract IV and greeks | Commercial $333 (months 1–6), $666 (7–12), $999 (13+), "no exchange fees" | Commercial plan includes display rights; whether derived pricing is allowed was not verified |
| Cboe DataShop | Surface files: fixed-maturity by delta and by % of spot, snapshots at 9:40, 15:45 and 16:00 ET | All Access API $2,499 / $4,599 | Subscribing to OPRA makes you a professional subscriber |
| Theta Data, IVolatility, Alpaca, Tradier, Databento, Intrinio | Raw quotes, or per-contract IV | $40–$4,000 | Self-serve plans are personal-use, or raw data only (Databento: we would fit IV ourselves) |

**OPRA fees:**
- An automated system reading real-time options data counts as non-display use: $2,000 a month per category.
- Data delayed more than 15 minutes carries no OPRA fees.
- Cboe estimates the matching non-display fee for real-time stock data (CTA/UTP) at $9,500 a month.

**With delayed options data:**
- **Why 15-minute-old data is usable.** Vol and skew move far less than spot. The surface is read with today's live spot, and ATM vol is moved by the measured skew-stickiness between refits [V: Bergomi].
- **Its cost shows up in the SE.** The measured variance of the surface's own 15-minute changes is added to it.
- **Refresh rate.** Re-reading all 203 names takes about 21 calls, assuming a 10-ticker call counts as one request (ORATS doesn't confirm this). The Delayed plan then allows a full sweep about every 9 trading minutes.

### 6.2 Crypto implied vol
- **Deribit:**
  - BTC and ETH to 2027-09-24; SOL and XRP (USDC-settled) to 2027-03-26.
  - No DOGE. A DVOL index for BTC and ETH only.
  - SOL and XRP options are thin: about $0.4M and $1.1M a day.
  - Its 2021 terms say market data and derived data are "for personal use only"; the current page returned 403. Needs written approval.
- **Bybit:** lists DOGE options, but only to 2026-12-25, and reportedly excludes US persons.
- **Block Scholes:** SVI-fitted crypto surfaces from £499/mo, the commercial fallback.
- **DOGE, and SOL/XRP past March 2027:** use the HAR ratio to BTC (§5.4).

### 6.3 Earnings calendars
- **ORATS:** earnings time of day and the implied move, but no confirmed/estimated flag.
- **Benzinga or Wall Street Horizon (through Massive):** give that flag. They fall under Massive's terms above.
- **EODHD:** its $399 "Internal use" plan includes an earnings calendar. Check whether it carries the flag.
- **Alpha Vantage:** has no confirmed flag (checked in a live response).

### 6.4 Stock bars
- **EODHD Internal use ($399):** 1-minute US bars since 2004, plus splits and dividends. Licensed for internal commercial use; the venue source is not stated, so verify its quality against a second source.
- **Tiingo ($50 commercial):** end-of-day fallback. Its intraday data is IEX only.
- **Massive Stocks Business ($2,499):** consolidated tape, but under the event-contract clause.
- **Our own recording:** we already poll Robinhood every few seconds. Recording its accepted quotes as 1-minute regular-session bars gives a free second source and a cross-check. Robinhood's API terms for this use are unverified.

### 6.5 Risk-free rate
- **Treasury daily bill rates:** an XML feed with no key.
- **FRED:** DTB3 was 4.03% on 2026-11-04. It is public domain, and the API terms ask for an attribution line.
- **USDG:** Paxos publishes no rate; partners receive the reserve yield. The T-bill rate is the proxy [I].

### 6.6 Recommended stack
| Need | Primary | Fallback | Cost/mo |
|---|---|---|---|
| Equity IV, skew, earnings move | ORATS Delayed | MarketData.app Commercial | $199 (Live: $299–599, + ~$2,000 OPRA non-display) |
| Bars, splits, earnings calendar | EODHD Internal use | Tiingo (end of day) + our Robinhood recording | $399 |
| Crypto IV | Deribit (with approval) | Block Scholes | 0 (£499+) |
| Risk-free rate | Treasury bill rates | FRED | 0 |
| **Total** | | | **~$600 to launch, ~$2.7–3.0k with live options** |

**Coinbase.** The keeper already uses Coinbase for crypto spot, and its market-data terms page returned 403. Check those terms too.

### 6.7 Venue data
Polymarket and Kalshi give us history, trades, settled markets, fee schedules and market structure for free, subject to the terms in §9.

**Changes needed to use them:**
- **Polymarket:** the old Data API v1 was retired on 2026-11-02, and price history now lives at `data-api…/v2/prices-history` [V]. Our backfill still calls CLOB `/prices-history`. That still returned 237 rows on last night's fit. Under the new API, fine buckets cover only recent data; 3-hour and 12-hour buckets cover full history [V]. Migrate, and use 12-hour buckets for older days.
- **Kalshi:** markets settled before the rolling cutoff are only on `/historical/...` [V].
- **Rate limits:** Kalshi reads cost 10 tokens from a 200 tokens/s bucket (about 20 reads/s). Polymarket `/v2/prices-history` allows 200 requests per 10 s, and over-limit requests are throttled rather than rejected [V].

---

## 7. Architecture

### 7.1 Where the work runs
- **The quote path doesn't change.** Quotes read only memory: the cached model, the replica, the live references. No new input adds a network call or a database read to a quote.
- **New process: `probabl-inputs`** (or a long-running form of the `fit` command). It:
  - polls vendors on their own schedules;
  - fits surfaces, realized-vol forecasts, calibration and κ;
  - runs the event-side on-demand queue;
  - writes everything to the database with `as_of`, `source`, `se` and `method`.
- **The keeper** keeps loading fitted data, but sooner than today's 10 minutes:
  - surfaces and spot checks every minute, or pushed through Postgres `LISTEN/NOTIFY`;
  - nightly fits on load.
- **Coverage.** When the reader picks a leg for a draft, the API puts its event, and its pairs with the draft's other legs, on the on-demand queue.
  - The queue backfills history and fits within seconds or minutes, off the request path.
  - Until that finishes, the preview prices on the estimated priors, with their wider SE.
  - The nightly run covers every live leg plus the most liquid catalog events, which gives the meta-regressions their population.

### 7.2 New and changed tables (DB v7)
- **`world_surfaces`:** underlying, as_of, forward and borrow, per-expiry θ, SSVI ρ and φ parameters, parameter covariance, VRP ratio, source.
- **`world_realized`:** underlying, session date, MedRV, RQ, overnight return, clean flag.
- **`world_vol_forecasts`:** underlying, horizon, value, SE, method.
- **`world_earnings`:** underlying, date, timing (before or after market), confirmed, implied move, SE, historical move, SE.
- **`world_calendar`:** sessions, early closes.
- **`world_rates`:** rate, source, as_of.
- **`event_trades`:** for κ.
- **`event_books`:** sampled depth, for hedge cost and noise.
- **`event_matches`:** cross-venue matches.
- **`pricing_priors`:** meta-regression coefficients and hyperparameters per input family.
- **`event_calibration`:** b by category × horizon × venue, with SE.
- **Extended:**
  - `world_vols` and `world_gaps` gain `method`, `se` and `validated`;
  - `leg_relations` gains `source = venue | llm | admin`.

### 7.3 Gates the keeper applies
Each gate declines with a named reason.
- An input past its freshness limit.
- Two price sources disagreeing beyond tolerance.
- A surface failing its arbitrage checks, or with fewer than 5 two-sided out-of-the-money strikes per expiry.
- ln(IV²/RV²) outside the asset's own 1–99% band.
- A fitted value more than k SE from its prior. This one is quarantined for review rather than used.

### 7.4 Validation
- **Unit tests:**
  - each estimator on synthetic data with known parameters;
  - the cleaning steps on injected bad prints;
  - the XOM weekend must not move vol.
- **Replay:** recorded venue and stock history run through the pricer. Report calibration of V against outcomes (log loss, Brier), markouts of quotes, and how often each input was missing.
- **Before vs after:** the same worlds priced on both versions, explained term by term from the quote components.
- **Call-count tests:** prove the quote path makes no new calls.

---

## 8. Plan, by phase

**Phase 0: stop bad data (days; no vendor needed)**
1. **Reference quotes.** In `robinhood.ts`:
   - reject quotes whose spread exceeds the session's limit;
   - label the session;
   - mark quotes outside sessions as stale.
   The feed mirror posts only accepted quotes and never during a closed session. The keeper's spot check requires an accepted quote.
2. **Fit.** Stop building OHLC bars from feed rounds:
   - apply the cleaning in §5.1;
   - use the band-crossing estimator with its SE;
   - require enough crossings;
   - shrink toward the prior;
   - quarantine anything more than k SE away.
3. **Clean up XOM.** Remove the bad XOM row and rerun the fit.
4. **Polymarket history.** Move the backfill to Data API v2.
5. **Provenance.** Log every quote's input sources and ages.
- **Done when:** replaying the Oct 30 weekend leaves XOM vol in the normal range; quotes during a closed session decline; tests pass.

**Phase 1: live stock inputs**
1. Integrate the chosen vendors (§6) in `probabl-inputs`: options quotes, earnings calendar, 5-minute bars, market calendar, risk-free rate. Use Deribit for crypto.
2. Build the SSVI surface fit, variance-risk-premium measurement, HARQ panel, earnings implied and historical moves, and weekend weights.
3. Model changes:
   - `implied` true with the event variance stripped;
   - skew read from the surface at the strike;
   - the calendar from data;
   - floors removed in favour of the validation bands.
- **Done when:** every world underlying has a validated surface or forecast with SE; no stock input in `inputs.ts` has a code fallback.

**Phase 2: live event inputs**
1. Run the on-demand backfill and fit for every drafted leg, plus a catalog-wide nightly fit.
2. Fit the correlation meta-regression and the event-volatility hierarchy; remove the theme priors.
3. Derive exact logic from venue structure into `leg_relations`. Add LLM relation labels with consistency checks and a review queue.
4. Refit calibration monthly and replace `calibrationSlope`.
5. Fit κ from trade flow and markouts, replacing the κ constants.
6. Add cross-venue matching, the venue gap and the single-venue noise model.
7. Compute hedge cost from fees and book depth. The ingestor tick needs a depth ladder: today it reports depth capped at the standard notional only.
8. Take resolution times from venue fields and fitted lags; remove the 30-day fallback.
- **Done when:** a preview of any new world prices on fitted or estimated values, each with SE and provenance; no constant is left in `inputs.ts`, `book.ts` or `engine.ts`'s κ.

**Phase 3: event → stock gaps**
1. Run the high-frequency regressions with the errors-in-variables correction, and add resolution observations.
2. Fit the hierarchical prior with LLM elicitation and recalibration; cap it by the option-implied event move; add an admin review queue.
- **Done when:** every priced world carries gaps with honest SE; replay shows the world's forward moving with its events.

**Phase 4: policy and risk**
1. The policy file becomes the only source of class C parameters. Remove `DEFAULT_PRICING`, `DEFAULT_RISK`, `DEFAULT_QUOTES`, `DEFAULT_REFERENCES` and `DEFAULT_THEMES` from code.
2. Base the capital curve on the live risk-free rate.
3. Implement CVaR doubling of γ under a t-copula.
4. Calibrate z and γ by backtest.
5. Add dashboards and alerts on input freshness, quarantines and declines by reason.

---

## 9. Decisions needed

1. **Kalshi data terms.** The Developer Agreement v1.1 limits API use to "facilitating a members own trading on the Exchange". The Data ToS bars using Kalshi data to "create, calculate, issue, settle, maintain" financial products or valuation services without express written consent [V]. Choose one:
   - ask Kalshi for consent;
   - get a legal opinion;
   - stop pricing on Kalshi legs before mainnet.
   **Polymarket:** its ToS (effective 2026-08-11) restricts some professional use of data "in raw, derived, aggregated, or anonymized form". The full clause has not been read; it needs review.
2. **Vendors, budget and licences.** Recommended: ORATS Delayed + EODHD Internal use + Deribit + Treasury, about $600 a month (§6.6).
   - **Every source needs a written licence for production pricing:**
     - ORATS ("informational purposes only");
     - Deribit ("personal use only");
     - EODHD (internal use);
     - Coinbase (terms not read).
   - **Avoid Massive** unless it signs an Order Form: its terms forbid deriving event contracts.
   - **Moving to live options data** adds the OPRA non-display fee, about $2,000 a month.
3. **Missing inputs.** Recommended:
   - events price on estimated priors with their measured SE;
   - a stock with neither a validated surface nor a clean realized forecast declines.
4. **Q or P for volatility.** Price off risk-neutral implied vol, which includes the variance risk premium, or remove the measured premium. Recommended: Q. It is what a hedger pays, and it errs toward caution.
5. **Capital base rate.** Moving from 1% to the live risk-free rate raises every capital charge.
6. **Phase 0 now.** It includes removing the XOM row on the live box.

---

## References
**Stock side**
- Andersen, Dobrev & Schaumburg 2012, J. Econometrics 169(1); NBER w15533. MedRV and MinRV.
- Barndorff-Nielsen & Shephard 2004, JFEC 2(1). Bipower variation.
- Brownlees & Gallo 2006, CSDA 51(4), doi:10.1016/j.csda.2006.09.030.
- Pearson et al. 2016, EURASIP JASP, doi:10.1186/s13634-016-0383-6. Hampel filters.
- Hansen & Lunde 2005, JFEC 3(4). Overnight weighting.
- Yang & Zhang 2000, J. Business 73(3), doi:10.1086/209650.
- Corsi 2009, JFEC 7(2), doi:10.1093/jjfinec/nbp001. HAR.
- Bollerslev, Patton & Quaedvlieg 2016, J. Econometrics 192(1). HARQ.
- Bollerslev, Hood, Huss & Pedersen 2018, RFS 31(7). Panel volatility.
- Vasicek 1973, JF 28(5). Shrinkage.
- Fukasawa & Rosenbaum 2012, SPA 122(12). Tse & Yang 2012, JBES 30(4). Hitting-time sampling.
- Gatheral & Jacquier 2014, arXiv:1204.0646. SSVI.
- Hentschel 2003, JFQA 38(4). IV estimation error.
- Carr & Wu 2009, RFS 22(3), doi:10.1093/rfs/hhn038. Variance risk premium.
- Driessen, Maenhout & Vilkov 2009, JF 64(3).
- Dubinsky, Johannes, Kaeck & Seeger 2019, RFS 32(2), doi:10.1093/rfs/hhy060. Earnings jumps.
- Gao, Xing & Zhang 2018, JFQA 53(6).
- French & Roll 1986, JFE 17(1). Jones & Shemesh 2018, JF 73(2).
- Gatheral, Jaisson & Rosenbaum, arXiv:1410.3394. Bergomi, "Smile Dynamics IV", Risk 2009. Guyon & El Amrani (risk.net). Bakshi, Kapadia & Madan 2003, RFS 16(1).
- Hansen, Kim & Kimbrough, arXiv:2109.12142. Crypto intraday patterns.
- Chainlink developer responsibilities; Pyth best practices; SEC Rule 15c3-5 (Knight Capital, 2013).

**Event side**
- Le, arXiv:2602.19520 (v2 2026-08-04). Calibration by domain and horizon.
- Bürgi, Deng & Whelan, CEPR DP 20631 / MPRA 126350. Kalshi.
- Page & Clemen 2013, EJ 123(568). Snowberg & Wolfers 2010, JPE 118(4).
- Bartlett & O'Hara 2026 (NBER conference paper). Informed trading on Kalshi.
- Easley, Kiefer, O'Hara & Paperman 1996, JF 51(4). Easley, López de Prado & O'Hara 2012, RFS 25(5).
- Snowberg, Wolfers & Zitzewitz 2007, QJE 122(2). Wolfers & Zitzewitz 2009, Economica 76(302). Leigh, Wolfers & Zitzewitz 2003, NBER w9587.
- Paleka et al., arXiv:2412.18544. LLM consistency checks.
- Stoikov 2018, Quantitative Finance. Microprice.
- Demarta & McNeil 2005, ISR. The t copula.
- Kalshi Developer Agreement v1.1 and Data Terms of Service (kalshi-public-docs S3).
- kalshi-typescript 3.35.0; Polymarket ts-sdk.
- Polymarket docs: rate limits, fees, Data API v2 migration.

**Vendors (pages and live APIs read 2026-11-06)**
- ORATS: orats.com/data-api, /docs/delayed-data-api, /docs/live-data-api, /terms-conditions.
- Massive: massive.com/options, /business-options, /business, /legal/businesses-terms-of-service, /pricing.
- MarketData.app: marketdata.app/pricing, data-redistribution policy.
- Cboe DataShop: volatility surfaces, All Access API, SIP fees.
- Theta Data: OPRA fee guide (2026-05-29).
- Databento OPRA and US equities catalogs. Alpaca market-data docs. IVolatility. Intrinio.
- EODHD: commercial pricing. Tiingo: pricing. Twelve Data: business pricing.
- Deribit API: get_instruments, get_volatility_index_data; rate limits; 2021 ToS update. Bybit v5 options instruments. Block Scholes. Laevitas.
- Alpha Vantage: EARNINGS_CALENDAR.
- Treasury daily bill rates XML. FRED: DTB3, DGS3MO, SOFR, and the API terms. Global Dollar (USDG).
- Robinhood: api.robinhood.com/rhj/assets. Cboe delayed quotes (coverage check only).

**Not verified in full text:** Bipower (citation only); the Yang–Zhang k formula (secondary source); the published Carr–Wu version; the original French–Roll pages; the Kalshi fee PDF (the formula comes from the SDK and BDW); Polymarket's history retention windows (two doc pages disagree); the full Polymarket ToS data clause. Also unread: IBKR's pages, Deribit's current terms, Finnhub's pricing and Coinbase's market-data terms (each returned 403 or rendered only in JavaScript); how ORATS counts a multi-ticker call; and which exchanges EODHD's intraday bars come from.
