# RFQ and block-trade auctions on crypto options venues comparable to Derive: when RFQs fill at once and when they run as timed multi-dealer auctions

Research date: 2026-11-08. Sources dated where they give a date. "Search summary" means the fact came from a search-result excerpt rather than a page I fetched in full; treat those as lower confidence.

## Deribit Block RFQ: who requests and quotes, timer, anonymity, minimum sizes, multi-leg, best-quote selection, partial fills

### Takeaway
Deribit's Block RFQ (announced 6 March 2025) is a taker-driven, multi-maker RFQ. Makers stream firm quotes back within seconds. The taker sees one aggregated best bid and best ask and can cross either at any time. The RFQ expires if the taker has not traded within 5 minutes. Nothing fills automatically when a timer ends, and the minimums are block-sized (25 BTC or 250 ETH of options).

### Cited Findings
- The Deribit Insights launch article is dated 6 March 2025. It says the feature is open to all traders: the taker is the requester and makers respond with quotes. — [Deribit Insights, "New Deribit Block RFQ Feature Launches"](https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/)
- Timer: "If the taker has not chosen to trade after 5 minutes, the RFQ expires." The taker sees the best bid and ask "a few seconds after the RFQ is submitted," and both update in real time. — [Deribit Insights](https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/)
- The API walkthrough adds a 5-second grace period after creation, during which the taker cannot see quotes or trade. — [Deribit Block RFQ API walkthrough](https://docs.deribit.com/articles/block-rfq-api-walkthrough)
- The `create_block_rfq` example response shows creation and expiration timestamps 300,000 ms (5 min) apart. The page gives no lifetime in its text, so this is consistent with the 5-minute rule but not a separate confirmation. — [Deribit API: private/create_block_rfq](https://docs.deribit.com/api-reference/block-rfq/private-create_block_rfq)
- Execution: the taker sees one best bid and one best ask and chooses which to cross. The taker can trade only the amount requested. — [Deribit Insights](https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/). In the API, the taker accepts with `private/accept_block_rfq`. — [API walkthrough](https://docs.deribit.com/articles/block-rfq-api-walkthrough)
- Multi-maker aggregation: smaller quotes from several makers are combined into one quote for the full amount, and the whole block executes at the last matched price. Multi-maker quotes can be partially filled by individual makers, but a quote is shown to the taker only if the full amount is available at that price. — [Deribit Insights](https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/)
- All-or-None (AON) quotes must equal the RFQ amount. Priority is best price, then earlier time. At the same price, an AON quote beats a multi-maker quote. — [Deribit Insights](https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/)
- Legs: a structure can be one instrument or a combination of options, perpetuals, futures and spot. One hedge leg (perpetual or dated future) is allowed per structure. — [Deribit Insights](https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/); "There is only one hedge leg allowed per Block RFQ." — [create_block_rfq](https://docs.deribit.com/api-reference/block-rfq/private-create_block_rfq)
- Targeting and anonymity: `makers` is optional, and an empty list targets all available makers. `disclosed` defaults to `true`. "It can be set to `false` (anonymous mode) only when at least 5 makers are targeted." — [create_block_rfq](https://docs.deribit.com/api-reference/block-rfq/private-create_block_rfq)
- Disclosed takers see the identity of the maker behind the best bid or ask and of any resulting trades. — [Deribit Insights](https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/)
- Anti-fishing measures: an OTV (order-to-volume) ratio is shown to makers in buckets. — [Deribit Insights](https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/)
- The API's `taker_rating` is a weighted fill ratio over a rolling 3-month window, shown in buckets "1-2", "2-5", "5-20" and "20+", or null with fewer than 6 qualifying RFQs. — [API walkthrough](https://docs.deribit.com/articles/block-rfq-api-walkthrough)
- Public reporting: block RFQ trades are published on the public `block_rfq.trades.{currency}` channel and `public/get_block_rfq_trades`. — [API walkthrough](https://docs.deribit.com/articles/block-rfq-api-walkthrough)
- Minimum sizes (Deribit venue page on Paradigm, © 2026): BTC options 25 contracts, ETH options 250, SOL-USDC options 150, XRP-USDC 75, AVAX-USDC 250, TRX-USDC 2,500; BTC futures 20,000, ETH futures 100,000. In multi-product structures, either the options or the futures part must meet the minimum. — [Paradigm help: Deribit venue](https://www.paradigm.co/help/products/derivatives/venues/deribit)
- Each maker's quote must meet the minimum block size. — [Deribit Insights](https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/)
- Search summary of Deribit's support pages: 25 BTC options minimum; perpetual and futures block minimum of 50,000 USDC; a separate Telegram quote-request group at 25 BTC or 250 ETH; anonymous takers must target at least five makers. The page returned HTTP 403 when fetched. — [Deribit support: Deribit Block RFQ](https://support.deribit.com/hc/en-us/articles/25951371614621-Deribit-Block-RFQ); [Deribit support: Block Trading](https://support.deribit.com/hc/en-us/articles/25944688627229-Block-Trading)
- Deribit's Block RFQ API is also published under Coinbase's developer docs as the "Coinbase Deribit app API", which is consistent with Coinbase owning Deribit. — [Coinbase CDP docs: block_rfq.taker](https://docs.cdp.coinbase.com/api-reference/coinbase-deribit-app-api/websocket/block-rfq/block_rfqtakercurrency.md). A secondary source refers to "Coinbase acquired Deribit". — [TechFlow / Foresight News, 13 Oct 2026](https://www.techflowpost.com/en-US/article/34541)

### Inferences
- Deribit's 5 minutes is a maximum lifetime, not an auction length. Quotes arrive in seconds, and the taker can trade from 5 seconds after creation. It is not a design where the RFQ runs a fixed time and the best quote then fills automatically.
- The 5-maker floor for anonymity and the taker rating exist because quoting firm block prices is costly for makers. Venues police "fishing" RFQs that never trade.

### Gaps
- I could not fetch Deribit's support pages (HTTP 403) or the Block RFQ Detailed Product Description, which redirects to the same support page. So I could not confirm from the primary page the exact perp/futures minimum or the current Telegram group rules.
- I found no published per-quote validity separate from the 5-minute RFQ lifetime, and no maximum leg count.

## Paradigm (multi-dealer RFQ / DRFQ): RFQ duration, dealer response times, how takers execute, size thresholds, links to on-chain venues

### Takeaway
On Paradigm the taker picks counterparties, dealers return firm prices, and the taker crosses one with a limit order. Unfilled RFQs expire after 5 minutes. Since 2022 Paradigm has also run separate timed, blind, all-or-nothing auctions for DeFi option vaults (Ribbon). The two are distinct products. I found no evidence that Paradigm is integrated with Derive. Its recent on-chain integration is Paradex (mid-September 2026), a sister company.

### Cited Findings
- DRFQv2 lifecycle: the taker creates the RFQ and selects counterparties; makers submit orders with leg pricing; the taker submits a crossing LIMIT order to trade against one maker order; the trade goes to the underlying settlement venue for clearing. — [Paradigm docs: RFQ](https://docs.paradigm.co/unified-markets/rfq-request-for-quotes)
- "Paradigm expires RFQs which do not trade after 5 minutes from creation." — [Paradigm docs: RFQ](https://docs.paradigm.co/unified-markets/rfq-request-for-quotes)
- Only the RFQ creator sees returned orders, with no public auction. Priority is price, then time. Takers can be disclosed or anonymous; makers cannot quote anonymously. No partial fills: maker order sizes must equal the RFQ quantity. — [Paradigm docs: RFQ](https://docs.paradigm.co/unified-markets/rfq-request-for-quotes)
- Multi-Dealer RFQ (MDRFQ), announced 19 Nov 2020: clients request two-way quotes from several dealers at once without revealing direction, prices aggregate onto one screen, and clients "execute instantly at the best bid/offer". Paradigm reported that in launch week 68.9% of RFQs executed via MDRFQ, 74.5% of those anonymously. It also reported an average 2.4 ticks (12 bps) of savings versus screen prices on large and multi-leg orders in October 2020, 270+ counterparties, and 20–30% of global crypto option flows (all self-reported). — [Paradigm blog: Multi-Dealer RFQ launched](https://paradigm.co/blog/multi-dealer-rfq-launched)
- Rationale given at launch: hiding identity and direction prevents information leakage and adverse pre-trade price moves. — [Paradigm blog](https://paradigm.co/blog/multi-dealer-rfq-launched); The Block covered the anonymity tool. — [The Block, Nov 2020](https://www.theblock.co/news/ecosystems/2020-11-19-crypto-traders-paradigm-anonymity-85181)
- Paradigm's separate orderbook ("OB") product states that all trades are anonymous and that takers do not select counterparties (search summary). — [Paradigm docs: OB - Orderbooks](https://docs.paradigm.co/unified-markets/ob-orderbooks)
- Size thresholds depend on the venue. Deribit via Paradigm requires 25 BTC or 250 ETH options and so on (see the Deribit section). — [Paradigm help: Deribit venue](https://www.paradigm.co/help/products/derivatives/venues/deribit). A Paradigm interview (search summary) says Bybit and Bit.com have no minimum block size. — [Paradigm Insights: Interview with Anand Gomes by Variant Research](https://paradigm.co/blog/an-interview-with-anand-gomes-by-variant-research)
- Paradigm states that it does not settle, clear or custody. — [Paradigm home](https://www.paradigm.co/) (search summary)
- Search summary of release notes: the G-RFQ expiry was shortened from 24 hours to 6 hours. A separate note mentions "improved RFQ response times" with no figures. I did not fetch either page. — [Release Notes v0.64](https://www.paradigm.co/blog/release-notes-v-0-64); [Release Notes v0.40](https://paradigm.co/blog/release-notes-v-0-40)
- DeFi and vault auctions: from 22 July 2022 Ribbon vaults underwrote options through Paradigm's blind auction system; before that they used Gnosis auctions. — [digopp Substack](https://digopp.substack.com/p/is-ribbon-finances-new-auction-system)
- Ribbon's docs describe the Paradigm auctions as blind and all-or-nothing, linked to a first-price sealed-bid definition. Paradigm receives 4 bps of notional. — [Ribbon docs: Auctions](https://docs.ribbon.finance/theta-vault/theta-vault/auctions)
- Paradigm's DeFi integration spec, as summarized in search results: "The DeFi protocol spawns an auction via relay when it requires liquidity." — [Paradigm DeFi Integration Specification (Siren repo)](https://github.com/sirenmarkets/core/files/8806317/Paradigm_DeFi_Integration_Specification.2.pdf)
- On-chain integration: Paradex integrated Paradigm's RFQ engine in mid-September 2026, adding multi-leg options and private blocks bundled into one atomic transaction. Options OI rose 2.6x to $202M, daily notional reached $17.6M in the first days, and there were 46 blocks and $30M in a 30-day window. — [Crypto Briefing, 19 Sep 2026](https://cryptobriefing.com/paradex-options-oi-surge-rfq-launch/); OI later passed $250M. — [Crypto Briefing](https://cryptobriefing.com/paradex-options-open-interest-250m/)
- A secondary source says Paradigm's RFQ network handles about a quarter of Deribit's large-order flow. — [TechFlow / Foresight News, 13 Oct 2026](https://www.techflowpost.com/en-US/article/34541)
- One search summary claimed a Derive "integration with Paradigm's counterparties". The full TechFlow article attributes that to Paradex, not Derive. — [TechFlow, 13 Oct 2026](https://www.techflowpost.com/en-US/article/34541)

### Inferences
- Paradigm has two distinct models. (1) Taker-driven multi-dealer RFQ: firm quotes in seconds, the taker crosses whenever it likes, 5-minute lifetime. (2) Issuer-scheduled blind auctions for DeFi vaults: fixed window, sealed bids, best bid wins all or nothing. The "timed, best quote fills" pattern belongs to (2).
- Because Paradigm does not clear, any on-chain venue has to build settlement for Paradigm prints, as Paradex did. No such integration is documented for Derive.

### Gaps
- I found no published dealer response-time statistics or median time-to-fill for Paradigm RFQs.
- I found no current (2025–2026) Paradigm venue list naming Aevo, Derive or OKX. Bybit appears only in older and secondary listings.
- I could not read the Paradigm DeFi spec PDF itself (signed redirect), so the vault auction duration on Paradigm is unconfirmed.

## Aevo, Bybit and OKX block trading / RFQ: timers, minimum sizes, who quotes

### Takeaway
Bybit and OKX run private, taker-targeted RFQs with short lives: Bybit up to 10 minutes for a quote plus 1 minute to accept, OKX 10 minutes for all-option RFQs and 2 minutes for others. Makers are approved liquidity providers, and minimums run from about $10k to $50k notional. Aevo's RFQ/OTC (2023) auto-picks the best of several market-maker quotes almost at once. Its weekly vault auctions were a separate, scheduled bidding process.

### Cited Findings
- Bybit RFQ timing: quotes usually arrive "within seconds", at most 10 minutes. If no maker quotes within 10 minutes, the RFQ expires. After a quote arrives the taker has 1 minute to accept or cancel. Before acceptance the maker may withdraw it if the market moves significantly. — [Bybit Help: FAQ — Bybit RFQ](https://www.bybit.com/en/help-center/article/FAQ-Bybit-RFQ)
- Bybit access: requests are "Private — visible only to the requester and selected counterparties". The taker can select up to 30 liquidity providers, and the system shows up to the 3 most competitive quotes. Makers are institutions approved via a relationship manager. — [Bybit FAQ](https://www.bybit.com/en/help-center/article/FAQ-Bybit-RFQ)
- Bybit sizes and structure: minimum 10,000 USD notional per RFQ, including multi-leg; options minimum 100x the order-book minimum size; maximum 20x the order-book maximum or the OI limit. Up to 25 legs. No partial fills (all or nothing). Preset combos get a 50% fee discount, and makers may get zero fees under the RFQ access agreement. — [Bybit FAQ](https://www.bybit.com/en/help-center/article/FAQ-Bybit-RFQ)
- OKX RFQ expiry (search summary of the API docs): "if all legs are options, the RFQ will expire after 10 minutes; otherwise, the RFQ will expire after 2 minutes". Quotes take an optional `expiresIn` in seconds, with one active quote per RFQ per maker. — [OKX API v5 docs](https://www.okx.com/docs-v5/en/)
- OKX minimums conflict. The help centre lists a US$1,000 minimum absolute notional. — [OKX Help: Block trading basics](https://www.okx.com/en-us/help/block-trading-basics). The RFQ Builder article says US$10,000 for single-leg spot and US$50,000 for all other strategies. — [OKX Help: Creating and sending RFQs in RFQ Builder](https://www.okx.com/en-us/help/creating-and-sending-rfqs-in-rfq-builder). Both are search summaries; the full fetch failed.
- Aevo OTC (May 2023): a request goes to several market makers, who return a price and signature, and "Aevo OTC picks out the most competitive price and executes the trade on behalf of the user". Instant quotes named from Galaxy, GSR and OrBit Markets (search summary). — [The Crypto Times, 16 May 2023](https://www.cryptotimes.io/2023/05/16/ribbon-finances-aevo-dex-launches-otc-marketplace/)
- Aevo vault auctions: weekly Ribbon Auctions moved to Aevo's RFQ platform. Participants submit bids and pre-fund USDC, and premiums are bridged back to the vault on mainnet (search summary; the original Aevo post at paragraph.com returned 404). — [IQ.wiki: Aevo](https://iq.wiki/wiki/aevo); [Paragraph: Ribbon Vaults on Aevo (404 at fetch)](https://paragraph.com/@aevo/ribbon-vaults-on-aevo)

### Inferences
- On every centralized block RFQ checked (Deribit, Paradigm, Bybit, OKX), the lifetime is 2–10 minutes. Quotes are expected in seconds, and the taker or the platform executes as soon as a price is acceptable. A 30-minute fixed wait before filling is not CEX block-RFQ practice.
- Bybit's 1-minute acceptance window and the maker's right to withdraw show the core constraint: firm option quotes go stale as the underlying moves, so makers will not stand behind a price for long.

### Gaps
- I found no current Aevo developer documentation on RFQ quote expiry or block-trade minimums, and I could not confirm whether Aevo still runs the Ribbon vault auctions or how long their windows are.
- OKX's options-specific minimum notional is unconfirmed because the sources conflict.

## On-chain options RFQ designs: which use timed public auctions and which use instant private RFQ

### Takeaway
Timed, publicly visible auctions where the best bid wins at the end are the norm for on-chain vault and strategy auctions: Ribbon/Gnosis about 1 hour weekly, Paradigm blind DOV auctions, Opyn Crab auctions on a fixed schedule. Thetanuts V4's RFQ is the closest match to a "30-minute public RFQ, best quote fills". It is on-chain and sealed-bid with a user-set offer deadline (examples of 6, 30 and 60 minutes), a reveal phase, and permissionless settlement to the best offer, and the requester can accept early. Trader-facing on-chain RFQs (Rysk, Premia RFQ, Derive) fill as soon as a signed quote is accepted.

### Cited Findings
- **Thetanuts V4 (Base):** "RFQs are sealed-bid: you broadcast a request, market makers submit encrypted offers, and you reveal/settle the best one." The SDK examples set `offerDeadlineMinutes` to 60, 6 and 30. — [Thetanuts SDK README](https://github.com/Thetanuts-Finance/thetanuts-sdk)
- Thetanuts lifecycle: an OFFER PERIOD in which MMs see the RFQ event on-chain and submit EIP-712-signed offers encrypted to the requester (amount not revealed); then a REVEAL PERIOD (`offerEndTimestamp + REVEAL_WINDOW`) in which MMs reveal; the best offer wins (lowest for buys, highest for sells) and losers are refunded. After the reveal, "Anyone calls settleQuotation()" and settlement is permissionless. — [Thetanuts SDK docs/rfq (lifecycle.md)](https://github.com/Thetanuts-Finance/thetanuts-sdk/tree/main/docs/rfq)
- Thetanuts early settlement: the requester can decrypt an offer and call `settleQuotationEarly` during the offer period, which skips the reveal auction. Real example: RFQ 784 settled at 04:07:09 UTC, 3 minutes before its 04:10:34 deadline. Fees are 0.06% of notional, capped at 12.5% of premium. — [Thetanuts SDK docs/rfq (early-settlement.md, lifecycle.md)](https://github.com/Thetanuts-Finance/thetanuts-sdk/tree/main/docs/rfq)
- Thetanuts V4 docs describe an RFQ engine with direct quotes from liquidity providers. — [Thetanuts V4 docs](https://docs.thetanuts.finance/)
- **Ribbon (2021–2022):** auctions opened at 11:30 UTC each Friday and lasted one hour (Ribbon post, undated in results; search summary). — [Ribbon Medium: Open Auctions](https://ribbonfinance.medium.com/open-auctions-a981ff10db2b)
- The contract enforces a minimum auction duration of 5 minutes. — [OpenZeppelin Ribbon audit, 9 Sep 2021](https://www.openzeppelin.com/news/ribbon-finance-audit) (search summary)
- Gnosis auctions clear at the lowest price where demand meets supply. Ribbon later moved to Paradigm's blind, all-or-nothing auctions. — [Ribbon docs: Auctions](https://docs.ribbon.finance/theta-vault/theta-vault/auctions)
- An OrBit Markets essay discusses the timing problem of the weekly Friday DOV auctions (title only seen). — [OrBit Markets: DOV Auctions and the Friday Problem](https://medium.com/@orbitmarkets/dov-auctions-and-the-friday-problem-b979c30c8bc7)
- **Opyn Squeeth Crab auction (2022-era):** oSQTH↔WETH auctions on Mon/Tue/Wed/Fri at 16:30 UTC, bids due before 16:40 UTC, and winning bids settle around 16:50 UTC. Bids are ranked by price and can be placed, edited or cancelled gaslessly (search summary). — [Opyn: Participating in the squeeth crab auction](https://medium.com/opyn/participating-in-the-squeeth-crab-auction-b75a1defd8d6); [Opyn: Crab Strategy Auction Tutorial](https://medium.com/opyn/crab-strategy-auction-tutorial-how-to-trade-squeeth-with-better-pricing-and-less-slippage-689d6d6047b)
- An earlier Opyn hedging auction started 5% below TWAP and improved for 7 minutes, with the first to click "HEDGE" winning (search summary). — [Opyn: 8 questions about the crab auction](https://medium.com/opyn/8-questions-about-the-crab-auction-1996eae6be5a)
- **Rysk V12:** a "live Request for Quote (RFQ) model" described as "an on-chain auction between users selling volatility and counterparties buying it". Confirmed trades execute immediately, and positions are fully collateralized and physically settled. — [Rysk docs: Solution — Rysk V12](https://docs.rysk.finance/getting-started/solution-rysk-v12). Rysk aggregates signed quotes from integrated market makers (search summary). — [Rysk](https://ryskfi.com/premium/)
- **Premia v3:** quotes are maker-signed orders, which can be streamed via IOrderbookStream on Arbitrum Nova. RFQ quotes populate `takerAddress`, whereas open orderbook quotes can be filled by anyone. The SDK returns the best quote across RFQ, Pool and Vault sources. — [Premia v3 SDK docs (OptionAPI)](https://cdn.jsdelivr.net/npm/@premia/v3-sdk@2.9.0/docs/classes/OptionAPI.html); RFQ framed as "just in time liquidity". — [Alea Research](https://alearesearch.io/?p=463)
- **Aevo OTC** picks the most competitive of several signed MM quotes and executes. — [The Crypto Times, May 2023](https://www.cryptotimes.io/2023/05/16/ribbon-finances-aevo-dex-launches-otc-marketplace/)
- **Derive** RFQs are open to all makers by default and quotable for up to 30 minutes, and the taker executes any quote when it chooses (detail in the next section). — [Derive docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)

### Inferences
- There are two families:
  - **Seller- or issuer-scheduled auctions** (vault rolls, strategy rebalances, Thetanuts sealed-bid RFQs). These have a fixed bidding window, often public or broadcast, and the best bid wins automatically at the close. They suit sellers who are price-insensitive on timing, such as a vault that must roll weekly, and who value maximum competition.
  - **Taker-driven RFQs** (Deribit, Paradigm, Bybit, OKX, Derive, Rysk, Aevo OTC, Premia RFQ). Quotes come in seconds and fill on acceptance.
- Thetanuts' early-settle option shows that even timed on-chain designs let the requester exit the timer as soon as a good quote arrives.
- Hegic: I found no RFQ or auction design in this research and did not investigate further.

### Gaps
- I found no source giving Thetanuts' `REVEAL_WINDOW` length, whether Thetanuts makers must be whitelisted, or typical real-world offer-deadline choices.
- Opyn Crab auction details are 2022-era. Whether Opyn still runs them in 2026 is unverified.
- Hegic's and Premia's current (2025–2026) mechanics were not confirmed from primary docs. The Premia docs mirror found was a third-party proxy and was not cited.

## Who provides liquidity on Derive, and does Derive integrate with Paradigm or other block-trade networks?

### Takeaway
Derive runs a CLOB plus an RFQ venue. Its RFQs are open to all approved makers by default, quotable for a default 30-minute window, and executed by the taker against any quote. The incentive scoring rewards makers who quote within 2 seconds, so the design expects near-instant quotes. The only publicly named market maker is FalconX, live since October 2025. Liquidity is subsidized by an Institutional Trading Rewards Program of up to $500k USDC plus 1M DRV per 28 days, 200k DRV of which goes to options RFQ. I found no Paradigm or other block-network integration.

### Cited Findings
- Purpose: RFQ "is the venue for large or multi-leg structures that would be hard to fill on the public orderbook". The taker requests a price on a package and executes "as a single atomic block trade against a maker's quote." — [Derive docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- Broadcast: "Leave `counterparties` empty to open the RFQ to all makers, or list wallet addresses to direct it privately." Makers poll RFQs that are open to all or that name their wallet. — [Derive docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md); `counterparties` defaults to null, described as "a list of specific counterparties to restrict who can see it". — [Derive API: send_rfq](https://docs.derive.xyz/api-reference/rfq/privatesend_rfq.md)
- Timer: "An RFQ is quotable only for a bounded window after creation (`valid_until`). The default window is 30 minutes." The docs add that "The exact window is deployment-specific and may differ per environment." — [Derive docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- Execution: the taker collects quotes (poll or the `best.quotes` channel), calls `private/rfq_get_best_quote`, then signs `private/execute_quote` with the chosen `quote_id`. "`private/execute_quote` fills any valid quote." `max_total_cost` and `min_total_cost` filter only the best-quote helper and do not bind execution. — [Derive docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- Makers can replace or cancel quotes at any time (`replace_quote`, `cancel_quote`) and can opt quotes into market-maker protection (`mmp`). — [Derive docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- Partial fills: `partial_fill_step` (default 1) sets the minimum fill increment, and a quote for part of the RFQ is scaled to full size for cost comparison. — [Derive docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- Multi-leg packages fill atomically. — [Derive docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- Maker access: the legacy docs say "market maker wallets must be approved by the support team". — [Derive legacy docs: RFQ quoting and execution](https://legacy.docs.derive.xyz/reference/rfq-quoting-and-execution). The current docs list only `trade:rfq:<asset>` session scopes. — [Derive docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- A Derive marketing page says "anyone is available to make markets... and respond to the RFQ" (search summary). — [Derive: Market Maker and Liquidity Provider Supplement](https://www.derive.xyz/market-maker-and-liquidity-provider-supplement)
- RFQ maker scoring, Time Score (time from RFQ creation to the maker's first quote): ≤2 s → 2; ≤30 s → 1; ≥5 min → 0.5. Fill boost is ×1.2 for the maker that filled and ×0.5 for every other quoter. Price score is distance from the taker's max cost (<0% → 0, 0–1% → 1, 1–3% → 2, 3%+ → 4). The worked example concludes "XYZ ranks above ABC: it filled... and offered more price improvement, even though ABC responded faster." — [Derive docs: Institutional Trading Rewards Program](https://docs.derive.xyz/integrators/programs/institutional-trading-rewards.md)
- Program size: up to $500,000 USDC in rebates per 28-day epoch ($250k options) plus 1M DRV per epoch, split Options RFQ 200k, Options OB 400k, Perps 400k. Eligibility is by application and approval. CLOB obligations are a minimum quote size of 500, delta 1–98, more than $50M in 28-day volume and more than 2% volume share. The top option tiers carry negative maker fees (−0.005%) and RFQ maker discounts of up to 100%. — [Derive docs: Institutional Trading Rewards Program](https://docs.derive.xyz/integrators/programs/institutional-trading-rewards.md)
- RFQ fees: "Trades conducted via RFQs are charged the taker notional fee rate on both counterparties, plus a base fee on the taker side. Multi-leg trades receive up to 100% discounts on the cheaper legs." — [Derive docs: Trading Fees](https://docs.derive.xyz/integrators/trading/trading-fees.md)
- RFQ and block rules (updated 9 May 2026): a quote is firm only for the stated instrument, size, price, expiry, quote duration and counterparty. Quotes "materially disconnected" from the market can be treated as Mistrades or Erroneous Transactions. Derive reviews "quote-to-fill or RFQ-to-trade anomalies" and offers MM controls (quote limits, max delta, kill switches). — [Derive: RFQ and Block Trading Rules](https://www.derive.xyz/rfq-and-block-trading-rules)
- FalconX (9 Oct 2025, post by Derive's CTO): "FalconX is now quoting across Derive's options markets; both the central limit orderbook and RFQ", with a focus on short-dated options. Its collateral is held off-chain at FalconX and represented on-chain as fxUSDC, with settlement in USDC. — [Derive Insights: FalconX brings institutional liquidity onchain](https://insights.derive.xyz/falconx-brings-institutional-liquidity-onchain/)
- Derive's own blog (13 Apr 2026) names FalconX as its only partner MM and self-reports holding "approximately 90 to 95 percent" of on-chain options. — [Derive blog: How do market makers participate in crypto options?](https://www.derive.xyz/blog/how-do-market-makers-participate-in-crypto-options/)
- Oak Research (14 Oct 2026): FalconX is the only publicly identified MM; DRV trading rewards were paused at the end of September 2026; and as of 25 Sep 2026 Derive had 74.9% of on-chain options notional and 88.1% of on-chain premiums, with $14.22B cumulative notional since January. It argues "the market makers are here, but they're being paid to show up." — [Oak Research: Is Derive the Next Hyperliquid?](https://oakresearch.io/en/reports/protocols/derive-next-hyperliquid-liquidity-real-moat)
- TechFlow / Foresight News (13 Oct 2026): "FalconX is the only market maker visible on Derive", flagged as a concentration risk. It cites Alea Research finding equivalent risk on Derive about 40% more expensive than on Deribit. The 30-day on-chain options notional of $5.49B is about 6.9% of Deribit's $79.8B. — [TechFlow, 13 Oct 2026](https://www.techflowpost.com/en-US/article/34541)
- Paradigm: not mentioned in Derive's FalconX post, its MM blog, the RFQ rules or the Oak report, and Paradigm's Lyra/Derive-related searches returned nothing. — [Derive FalconX post](https://insights.derive.xyz/falconx-brings-institutional-liquidity-onchain/); [Oak Research](https://oakresearch.io/en/reports/protocols/derive-next-hyperliquid-liquidity-real-moat)

### Inferences
- The "~30 minutes, anyone can see it and quote, best quote fills" description matches Derive's own RFQ defaults: open to all makers and a 30-minute `valid_until`. But on Derive the 30 minutes is the longest a request stays quotable, not a fixed auction. Nothing in the docs fills the best quote automatically at expiry; the taker can execute the first good quote within seconds. The time-score table, which pays most for quotes within 2 s and penalizes 5 minutes or more, shows Derive expects makers to answer almost at once.
- Derive's maker base appears thin and subsidized (one named MM, paid rebates and DRV). For small or odd-sized RFQs a taker may therefore get few or no quotes quickly, which could make an RFQ feel like a long timed wait in practice. This is inference, not a documented statistic.

### Gaps
- I found no count of active Derive RFQ makers, no RFQ versus CLOB volume split, and no median RFQ response or fill times.
- There is no current statement on whether maker approval is still required in V3. The legacy and current docs differ.
- I found no Derive–Paradigm integration and no evidence either way on Derive taker anonymity toward makers.

## Industry rationale: why large or multi-leg option trades use multi-dealer RFQs while small single-leg orders fill instantly on an order book

### Takeaway
Venues say block RFQs exist for size and complexity the order book cannot absorb. Multi-dealer competition improves price, and anonymity limits information leakage. Lifetimes stay short, 2–10 minutes with quotes in seconds, because firm option quotes go stale. Long fixed-window auctions appear mainly where the seller's timing is fixed and maximal competition matters more than speed, as in vault rolls. Small single-leg orders use the CLOB, which posts continuous streaming quotes.

### Cited Findings
- Derive RFQ is "the venue for large or multi-leg structures that would be hard to fill on the public orderbook". — [Derive docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- Derive's marketing describes market makers responding "with firm prices for the whole package". — [Derive blog](https://www.derive.xyz/blog/how-do-market-makers-participate-in-crypto-options/)
- Information leakage: MDRFQ's anonymous, direction-hiding requests are said to prevent information leakage and adverse pre-trade price moves. — [Paradigm blog, Nov 2020](https://paradigm.co/blog/multi-dealer-rfq-launched). Anonymity lets a fund open a position without signalling intent to the underlying order books. — [The Block, Nov 2020](https://www.theblock.co/news/ecosystems/2020-11-19-crypto-traders-paradigm-anonymity-85181)
- Price improvement: Paradigm self-reports 2.4 ticks (12 bps) average savings versus screen on large and multi-leg orders. — [Paradigm blog](https://paradigm.co/blog/multi-dealer-rfq-launched)
- Package pricing and fees: Bybit gives a 50% fee discount on preset combo RFQs, and the taker gets no slippage at the accepted price. — [Bybit FAQ](https://www.bybit.com/en/help-center/article/FAQ-Bybit-RFQ). Derive discounts up to 100% of fees on the cheaper legs of multi-leg RFQs. — [Derive Trading Fees](https://docs.derive.xyz/integrators/trading/trading-fees.md)
- Hedging: Deribit allows one futures or perp hedge leg in the block. — [Deribit Insights](https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/). Derive packages can include delta-hedged structures. — [Derive docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- Staleness and maker risk: Bybit makers may withdraw quotes before acceptance if the market moves significantly, and takers get 1 minute to accept. — [Bybit FAQ](https://www.bybit.com/en/help-center/article/FAQ-Bybit-RFQ). Derive provides MMP and kill switches and reviews "RFQ-to-trade anomalies". — [Derive RFQ rules](https://www.derive.xyz/rfq-and-block-trading-rules)
- Fishing control: the Deribit taker rating and OTV. — [Deribit API walkthrough](https://docs.deribit.com/articles/block-rfq-api-walkthrough)
- Timed vault auctions: Ribbon's move from Gnosis uniform-price auctions to Paradigm blind first-price, all-or-nothing auctions was meant to increase price competition among bidders. — [Ribbon docs: Auctions](https://docs.ribbon.finance/theta-vault/theta-vault/auctions)

### Comparison of mechanisms (each cell cited in the sections above)
| Venue / design | Who sees request | Who quotes | Window | Fill rule | Min size |
|---|---|---|---|---|---|
| Deribit Block RFQ (2025) | All makers or targeted list; anonymous needs ≥5 makers | Deribit makers | 5 min max; 5 s grace | Taker crosses best bid/ask; multi-maker aggregation | 25 BTC / 250 ETH options |
| Paradigm DRFQv2 | Taker-selected counterparties | Dealers (non-anonymous) | 5 min max | Taker crosses a maker order with a LIMIT; no partials | Venue's block min |
| Bybit RFQ | Up to 30 selected LPs | Approved institutions | ≤10 min for quotes; 1 min to accept | Taker accepts; all-or-none | $10k notional; options 100x book min |
| OKX RFQ | Selected counterparties | Approved makers | 10 min (all-options) / 2 min | Taker executes a quote | $1k–$50k (conflicting) |
| Derive RFQ | All makers by default, or private list | Approved/RFQ-scoped makers; FalconX named | 30 min default validity | Taker executes any quote at any time; partial step | None stated |
| Thetanuts V4 RFQ (on-chain) | Public on-chain event | Market makers (sealed, encrypted) | User-set offer deadline (examples 6/30/60 min) + reveal | Best revealed offer wins automatically; early accept allowed | None stated |
| Ribbon DOV (Gnosis → Paradigm) | Public / Paradigm network | Bidders | ~1 h weekly (Gnosis era) | Uniform clearing (Gnosis) → blind all-or-nothing (Paradigm) | n/a |
| Opyn Crab auction (2022-era) | Public | Anyone | ~10 min bid window, fixed schedule | Bids above clearing price settle | n/a |

### Inferences
- A timed RFQ that anyone can see, open for about 30 minutes with the best quote winning, is standard for scheduled on-chain auctions (DOVs, Thetanuts sealed-bid RFQs, strategy rebalances). It is not standard for trader-facing block RFQs. On Deribit, Paradigm, Bybit, OKX and in practice Derive, the window is a maximum lifetime of 2–30 minutes. Firm quotes arrive in seconds and the taker fills at once.
- The main reason for short windows is that option quotes are firm, carry delta and vega risk, and go stale as spot and vol move. Makers either widen prices to cover the time option given to the taker or demand the right to withdraw (Bybit) or use MMP (Derive). Longer windows make sense when the requester has no urgency and wants the widest participation, and some designs (Thetanuts) make that safe for makers with sealed bids that reveal only after the deadline.
- Instant fills against a CLOB or streaming maker quotes suit small single-leg orders. The displayed size covers them, there is no package-legging risk, and showing the order reveals little.

### Gaps
- I found no independent, recent (2023–2026) empirical study of crypto options RFQ response times, fill rates or information leakage. The evidence is venue documentation and self-reported Paradigm stats from 2020.
- I found no academic source in this pass quantifying the trade-off between auction length and price, such as work on multi-dealer RFQ in bonds or FX. That rationale is inference.
