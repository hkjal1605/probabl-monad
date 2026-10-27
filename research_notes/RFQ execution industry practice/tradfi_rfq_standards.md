# TradFi RFQ standards: FIX, venues, regulators, research

Research notes, compiled 2026-10-14. Every claim has a source URL.

**Verification tags**
- **[V]** I read the primary text myself (rule text, spec, paper PDF, regulator document).
- **[S]** Secondary source: trade press, law-firm summary, vendor marketing, or a search-engine summary of a page I could not open.
- **[U]** Unverified: from memory, a paywalled snippet, or a source I could not open. Check it before relying on it.

---

## 0. Key takeaways

1. **FIX flow.** The FIX flow is: QuoteRequest (R) → Quote (S) or QuoteRequestReject (AG) → QuoteResponse (AJ) to hit, lift, counter or pass, or a NewOrderSingle with OrdType=D (Previously Quoted) → ExecutionReport (8). Dealers who did not trade get a QuoteResponse with Cover / DoneAway / Tied / TiedCover / Expired / TimedOut / EndTrade. QuoteStatusReport (AI) acknowledges quotes and reports quote state. If Side is omitted, the request is two-sided. If QuoteType is omitted, the quote is indicative.
2. **Number of dealers in dealer-to-client (D2C) RFQs.**
   - On index-CDS SEFs (swap execution facilities), customers RFQ about 4 dealers on average. About 45% of RFQs go to exactly 3 dealers and about 30% go to 5. Response rates are about 90% for 3–5 dealers and about 80% for 6 or more.
   - US rules set a minimum: RFQs for mandated swaps must go to at least 3 dealers. The EU forbids venues from capping the number of recipients.
   - Some venues set their own caps of 5–6 dealers.
   - Corporate-bond RFQs on MarketAxess (2010–11) went far wider, to about 24–28 dealers with response rates of 17–30%.
3. **Why requesters limit dealers.** The reasons are information leakage and front-running by losing dealers, plus the winner's curse, which lowers response rates and quality as the number of dealers grows. The research recommends asking for **two-sided quotes** (no direction revealed).
4. **Who sets the price.** Dealers set the price, and only the requester can execute it. Best execution for wholesale RFQ is weaker:
   - EU: the "legitimate reliance" test presumes that wholesale clients shop around. MiFID II Art. 64(4) still requires a price-fairness check against market data.
   - US: FINRA 5310 lists the "number of markets checked" as a diligence factor.
   - Benchmarks used: MarketAxess CP+, Tradeweb Ai-Price, Bloomberg CBBT/BVAL.
5. **Last look.** FX Global Code Principle 17 allows last look only as a validity/price check:
   - It must be disclosed.
   - The provider may not trade on the request during the window (cover-and-deal is the only exception).
   - Any extra hold time is "contrary to Principle 17".
   - Providers should disclose whether the check is symmetric and the window's min/max length.
   - A firm quote has no such option.
6. **What goes to RFQ instead of the order book.** RFQ is used for large or block trades, illiquid instruments and multi-leg packages. Order books handle liquid, standard sizes. EU and UK regulators removed pre-trade transparency for RFQ in bonds and derivatives in 2024–25.
7. **Hybrids, where RFQ must interact with the book.**
   - CFTC SEF rule: the venue must show resting firm orders to the RFQ requester and let them execute against those orders.
   - CME R-Cross/C-Cross: the cross first trades against better or equal resting orders.
   - Eurex: public RfQ, then responses go into the order book.
   - Cboe AIM / BOX PIP: Priority Customer orders resting on the book are allocated first. The initiator is capped at 40% (50% if only one competitor).

---

## 1. The FIX message flow for RFQ

### 1.1 Messages

| MsgType | Name | Role in RFQ | Source |
|---|---|---|---|
| R | QuoteRequest | Requester asks one or more counterparties, or a market, for quotes. FIX: "This message is commonly referred to as an Request For Quote (RFQ)". If OrderQty and Side are absent, the response is a two-sided market quote. | [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/msgType_R_82.html |
| AG | QuoteRequestReject | Rejects a QuoteRequest "for all quoting models". Carries QuoteRequestRejectReason (658), which is required. | [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/msgType_AG_6571.html |
| AH | RFQRequest | Exchange model: "used by liquidity providers to indicate to the market for which instruments they are interested in receiving Quote Requests". Uses SubscriptionRequestType (263). | [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/msgType_AH_6572.html |
| S | Quote | Response to a QuoteRequest or a QuoteResponse. Fixed-income quotes "usually go directly to an interested counterparty". In tradeable markets, quotes go into the market. A quote without QuoteReqID is unsolicited. Cancel with QuoteCancel (Z) or zero prices/sizes. Orders can reference a quote with OrdType=Previously Quoted. | [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/msgType_S_83.html |
| AJ | QuoteResponse | Responds to a Quote or IOI: hit/lift, counter, or end the dialog. | [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/msgType_AJ_6574.html |
| AI | QuoteStatusReport | Response to a QuoteStatusRequest, a QuoteCancel, or a QuoteResponse during negotiation. Carries QuoteStatus (297). | [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/msgType_AI_6573.html |
| D + OrdType(40)=D | NewOrderSingle "Previously Quoted" | Alternative to AJ for acceptance. A forum answer warns that this path allows no negotiation. | [V] https://www.onixs.biz/fix-dictionary/latest/tagNum_40.html ; [S] https://forum.fixtrading.org/t/how-do-dealers-and-buyside-typically-initiate-rfq-inquiries/16274 |
| 8 | ExecutionReport | Sent to the dealer(s) who traded. Carries LastQty(32), Price(44) and optionally CoverPrice(1917). | [S] https://forum.fixtrading.org/t/facilitating-multiple-trades-in-a-multi-dealer-quote-negotiation/11595 ; CoverPrice [V] https://www.onixs.biz/fix-dictionary/latest/tagNum_1917.html |

### 1.2 Canonical multi-dealer D2C flow (fixed income / swaps)

```
Client                     Venue                         Dealers 1..k
  |--QuoteRequest(R)------->|---QuoteRequest(R)----------->|  QuoteReqID, Side?(absent=two-way), OrderQty,
  |                         |                              |  QuoteType=1, ExpireTime, ValidUntilTime,
  |                         |                              |  ResponseTime, ExposureDuration, PrivateQuote,
  |                         |                              |  RespondentType=2 + Parties (named dealers)
  |                         |<--Quote(S) / QuoteRequestReject(AG)--|  BidPx/OfferPx, sizes, ValidUntilTime
  |<--Quote(S)..............|---QuoteStatusReport(AI)----->|  QuoteStatus=Accepted/Active/Expired/...
  |--QuoteResponse(AJ) 1=Hit/Lift (or 2=Counter, 6=Pass)-->|   (or NewOrderSingle OrdType=D)
  |                         |  [Counter loop: Quote QuoteType=3 Counter <-> QuoteResponse 2=Counter]
  |<--ExecutionReport(8)----|---ExecutionReport(8)-------->|  winner(s): LastQty, Price, CoverPrice(1917)
  |                         |---QuoteResponse(AJ)--------->|  losers: 4=Cover, 5=DoneAway, 9=Tied,
  |                         |                              |  10=TiedCover, 3=Expired, 8=TimedOut, 7=EndTrade
```

- **Dealers who traded vs. dealers who didn't.** A FIX Trading Community answer explains the end of a multi-dealer dialog:
  - Dealers that traded receive an ExecutionReport.
  - Dealers that did not trade receive a QuoteResponse "when the negotiation dialog ends", with the appropriate QuoteRespType.
  - Worked example: 5 dealers quote 101–105 and the first two trade. The cover price is 103, so the dealer at 103 gets Cover(4) and the dealers at 104 and 105 get DoneAway(5).
  - "Most venues do not support trading with more than one dealer in the same multi-dealer dialog."
  - Some products have no obligation to trade the best price, so the cover can be better than the traded price.
  - [S] https://forum.fixtrading.org/t/facilitating-multiple-trades-in-a-multi-dealer-quote-negotiation/11595
- **Dealers who reject the request.** A dealer that rejects is generally treated as out of the negotiation. Whether it then gets EndTrade or DoneAway depends on the venue. [S] https://forum.fixtrading.org/t/fixed-income-multi-dealer-workflows-dealer-1-rejects-client-trades-with-dealer-2/11652
- **Hit/lift paths.** Hit/lift via QuoteResponse allows counters. Hit/lift via NewOrderSingle allows no negotiation. [S] https://forum.fixtrading.org/t/how-do-dealers-and-buyside-typically-initiate-rfq-inquiries/16274

### 1.3 Exchange ("tradeable / restricted tradeable") model

- **RFQ subscriptions and distribution.** Liquidity providers subscribe with RFQRequest (AH). The market then distributes QuoteRequests to them. In tradeable markets a Quote "is submitted to a market and will result directly in a trade against other orders and quotes". FIX also says quotes should not be broadcast in tradeable markets, where market data messages are preferred.
  - [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/msgType_AH_6572.html
  - [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/tagNum_537.html
  - [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/msgType_S_83.html
- **CME iLink.** An accepted quote request is acknowledged and then disseminated to the market as a Request for Quote (35=R). Creating a user-defined spread also generates an RFQ. Responders populate the book with MassQuote or NewOrder messages. [S: search summary of CME client docs, page not opened] https://cmegroupclientsite.atlassian.net/wiki/x/VwLHAg

### 1.4 Key fields (FIX 5.0SP2 / FIX Latest)

| Tag | Field | Semantics | Source |
|---|---|---|---|
| 131 | QuoteReqID | ID of the RFQ. Required on R. On S, required when responding to a QuoteRequest. | [V] onixs R, S pages above |
| 117 | QuoteID | ID of the quote. Required on S. On AJ, required when responding to a Quote. | [V] |
| 693 | QuoteRespID | ID of the QuoteResponse, "assigned by the Initiator". | [V] AJ page |
| 644 | RFQReqID | Links a QuoteRequest to the RFQRequest(AH) subscription it answers. | [V] |
| 303 | QuoteRequestType | 1=Manual, 2=Automatic, 3=Confirm quote. | [V] https://www.onixs.biz/fix-dictionary/latest/tagNum_303.html |
| 537 | QuoteType | 0=Indicative ("inform a counterparty of a market"), 1=Tradeable, 2=Restricted Tradeable, 3=Counter (tradeable). Absence implies indicative. | [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/tagNum_537.html |
| 54 | Side | In QuotReqGrp: "Absence means a two-sided quote". FX side is from the initiator's view. | [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/compBlock_QuotReqGrp.html |
| 38 (OrderQtyData) | OrderQty | Required for single-instrument quoting, and for fixed income when QuoteType=Tradeable. | [V] QuotReqGrp page |
| 126 | ExpireTime | "The time when the request for quote or negotiation dialog will expire." | [V] https://www.b2bits.com/fixopaedia/fixdiclatest/block_QuotReqGrp.html |
| 62 | ValidUntilTime | On R: "the period of time the resulting Quote must be valid until". On S: when the quote expires. | [V] same |
| 1914 | ResponseTime | "The time by which a meaningful response should arrive back". | [V] same |
| 1629 / 1916 | ExposureDuration / Unit | "(minimum or suggested) period of time a quote price is tradable before it becomes indicative (i.e. off-the-wire)". | [V] same |
| 1915 | QuoteDisplayTime | "Time by which the quote will be displayed." | [V] same |
| 1171 | PrivateQuote | Private negotiation vs. public response. Only relevant where both exist; otherwise bilaterally agreed. | [V] R page |
| 1172 | RespondentType | 1=All market participants, 2=Specified market participants, 3=All market makers, 4=Primary market maker(s). | [V] https://www.onixs.biz/fix-dictionary/latest/tagNum_1172.html |
| 1091 | PreTradeAnonymity | Present on R; no description given. | [V] R page |
| 132/133/134/135, 647/648 | BidPx/OfferPx/BidSize/OfferSize, MinBidSize/MinOfferSize | The quote. A size with a min is a maximum. | [V] S page |
| 110 | MinQty | Used in private/directed negotiations. | [V] S page |
| 301 | QuoteResponseLevel | Requests an AI acknowledgement of the quote. | [V] S page |
| 694 | QuoteRespType | 1 Hit/Lift, 2 Counter, 3 Expired, 4 Cover ("best price not traded"), 5 DoneAway ("Trade was done with another quote provider"), 6 Pass, 7 EndTrade, 8 TimedOut, 9 Tied, 10 TiedCover, 11 Accept, 12 TerminateContract. | [V] https://orchimate.org/fixtrading/fix-latest/codeSets/QuoteRespTypeCodeSet?ref=fiximate |
| 297 | QuoteStatus | 0 Accepted, 5 Rejected, 6 Removed from market, 7 Expired, 9 Not found, 10 Pending, 11 Pass, 12/13 Locked/Cross market warning, 16 Active, 17 Canceled, 18 Unsolicited quote replenishment, 19 Pending end trade, 20 Too late to end (1–4 deprecated). | [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/tagNum_297.html |
| 658 | QuoteRequestRejectReason | 1 Unknown symbol, 2 Exchange closed, 3 Exceeds limit, 4 Too late, 5 Invalid price, 6 Not authorized, 7 No match for inquiry, 8 No market, 9 No inventory, 10 Pass, 11 Insufficient credit, 99 Other. | [V] https://www.onixs.biz/fix-dictionary/5.0.sp2/tagNum_658.html |
| 1917 | CoverPrice | "The best quoted price received among those not traded." Sent on 8 and AJ. | [V] https://www.onixs.biz/fix-dictionary/latest/tagNum_1917.html |
| 2115 | NegotiationMethod | 0 Auto spot, 1 Negotiated spot, 2 Voice. Concerns the benchmark spot price for spread-quoted bonds, not RFQ routing. | [V] https://www.onixs.biz/fix-dictionary/latest/tagNum_2115.html |

### 1.5 FIX extension packs for multi-dealer RFQ

- **EP159, "GFIC Multi-Dealer Quote Contribution and Negotiation Extensions".** Came out of Global Fixed Income Committee best practice for electronic CDS/IRS trading. Lets venues and dealers identify the time periods in negotiation (timers). File date June 20, 2017. [S] https://www.fixtrading.org/tag/ep159/
- **The original 2012 proposal.** Aimed to "support inquiry timers and multi-dealer quote requests flows", which are "commonly used in the cash bond markets". [V] https://forum.fixtrading.org/t/public-comment-period-gfic-multi-dealer-quote-negotiation/5474
- **QuoteAck.** Added because QuoteStatusReport could be bidirectional in SEF-to-bank flows. [S] https://forum.fixtrading.org/t/public-comment-period-gfic-quoteack-message-proposal/5446
- **EP168 and EP226.** EP168 covers negotiation method and workup auctions. EP226 covers negotiation phases. [S] https://www.fixtrading.org/tag/ep168/

### 1.6 A concrete venue spec: OTC Link "FIXIE RFQ" v1.6 (Aug 31, 2021)

- **Directed only.** RFQs are "preferenced", "they cannot be broadcast; only sent to specific firms". One or more respondents, who must be market makers.
- **Side, size and timer.** Side is optional (Bid, Ask, or Both; the default is Both). Size is required. TIF defaults to 30 seconds.
- **Messages.** Uses R / AJ / AG plus venue-specific message types. Every action is confirmed by an ExecutionReport. First come, first served.
- [V] https://www.otcmarkets.com/files/OTC%20Link%20RFQ%20FIX%20Specification.pdf

---

## 2. Who receives the request

### 2.1 Dealer-to-client RFQ to a limited panel: data

**Index CDS on Bloomberg SEF and Tradeweb SEF, May 2016** (Riggs, Onur, Reiffen, Zhu, *JFE* 137 (2020) 857–886). [V] https://www.mit.edu/~zhuh/RiggsOnurReiffenZhu_SEF_JFE.pdf
- Panel size and fill:
  - Conditional on RFQ, customers query **4.12 dealers on average** (s.d. 1.35) and get **3.64 responses**, an 89% response rate. **92% of RFQ sessions trade.**
  - "Customers most frequently request quotes from three dealers, which happens in about 45% of the RFQ sessions, followed by five dealers … slightly less than 30%." "Customers rarely select more than five dealers."
- Response rates: about **90% for 3–5 dealers**, falling to about **80% for 6 or more**.
- Effect of size: a $22m larger notional cuts the probability of choosing RFQ (over bilateral request-for-stream) by about 3.9%. It also cuts the dealer count by about half a dealer.
- Venue caps (as of 2017): Bloomberg SEF capped an RFQ at **5 dealers**; Tradeweb SEF set **no limit**. Bloomberg FIT (European corporates) capped at **6** (per Fermanian et al. 2016, cited in footnote 7).
- What gets revealed:
  - The customer reveals identity, size and direction.
  - Each dealer sees how many dealers are in competition, but not who they are.
  - Dealers generally send firm quotes "with a clock that counts down (generally 30 seconds)".

**US corporate bonds on MarketAxess, Jan 2010–Apr 2011** (Hendershott & Madhavan; *JF* 70(1) 2015, 419–447; working-paper PDF). [V] https://pages.stern.nyu.edu/~jh4/SternMicroMtg/Old/SternMicroMtg2012/Accepted/ClickOrCall13.pdf ; journal: https://ideas.repec.org/a/bla/jfinan/v70y2015i1p419-447.html
- Panel size by trade size:

  | Trade size | Dealers queried | Response rate |
  |---|---|---|
  | Micro ($1–100k) | 27.70 | 16.8% |
  | Odd ($100k–1m) | 26.60 | 22.3% |
  | Round ($1–5m) | 25.66 | 26.6% |
  | Max ($5m+) | 23.98 | 29.7% |

- Zero responses in 5.9%–15.1% of auctions, rising with size. The modal number of responses is 3.
- Fewer queries for larger size is "consistent with a concern by traders about leakage of their intentions increasing in trade size".
- Dealers usually know how many others were queried and who the client is. The client sets a time window for quotes. The auction works as a sealed-bid auction.
- So "3–5" is typical for derivatives and large tickets. Small cash-credit tickets have been sent much wider.

### 2.2 Regulatory and venue limits on the number of dealers

**US: CFTC SEF rule, 17 CFR 37.9(a)(3)**
- **The minimum.** For Required Transactions (made-available-to-trade, "MAT", swaps), an RFQ system must send the request "to no less than three market participants", which "shall not be affiliates of or controlled by the requester" or each other.
- **Equal treatment.** Trading protocols must give all participants equal priority in receiving requests and in sending and displaying responses.
- **Blocks.** Block trades are excepted from the Required Transaction execution methods, 37.9(a)(2)(i).
- [V] https://www.law.cornell.edu/cfr/text/17/37.9 ; block exception [V] in CFTC NPRM text https://www.cftc.gov/media/14501/RFC_SEFOrderBookRequirement082026/download
- **Phase-in.** RFQ-to-2 was allowed until **Oct 2, 2014**, then RFQ-to-3. [S] https://www.cftc.gov/node/230161 ; https://derivsource.com/?p=4906
- **Dissent.** Commissioner O'Malia called the 3-party requirement not data-based. [S] https://www.cftc.gov/PressRoom/SpeechesTestimony/omaliastatement051613c

**2013 buy-side survey (SIFMA AMG / ISDA / MFA), on the then-proposed RFQ-to-5**
- 38 buy-side respondents with about $12.1tn AUM.
- Reasons they limit recipients: trade size (87%), exposing strategy to others "who could use this to the disadvantage of clients" (84%), liquidity (79%), legal documentation with few counterparties (58%).
- 82% expected spreads to widen under RFQ-to-5, and about 70% would migrate to other markets.
- [V] https://www.isda.org/a/SaiDE/rfq-asset-mgmt-survey-results.pdf

**Current US developments (2026)**
- **CFTC NPRM, RIN 3038-AF79** (91 FR 55,030, Aug 26, 2026). Proposes removing the SEF **order book requirement for permitted (non-MAT) transactions**.
  - Order-book trading is "less than [one percent] to less than [three percent]" of SEF CDS and "less than [one percent] to approximately [twenty percent]" of IRS.
  - Bloomberg SEF reported that since 2015 over 96% of its order-book trading was in Required Transactions.
  - [V] https://www.cftc.gov/media/14501/RFC_SEFOrderBookRequirement082026/download
- **ISDA/SIFMA letter, Sept 25, 2026.** Supports the NPRM and asks the CFTC also to **drop RFQ-to-3**, because "requiring a market participant to show three dealers what it intends to trade, in which direction, and in what size … invites the information leakage that moves the market against the participant". [S: SIFMA page summary] https://www.sifma.org/advocacy/letters/sef-order-book-requirement-for-permitted-transactions-npr ; PDF https://www.sifma.org/wp-content/uploads/2026/10/ISDA-SIFMA-Comment-Letter-CFTC-NPR-on-SEF-Order-Book.pdf

**EU: ESMA Q&A 1635** (market structures Q&A 5.3, 07-07-2017)
- "Trading venues should not impose restrictions on the number of participants that a participant can interact with".
- In RFQ protocols "a trading venue should not impose limits on the number of participants that a firm can request a quote from".
- A firm may limit its own requests to protect its price.
- [V] https://www.esma.europa.eu/publications-data/questions-answers/1635
- Risk.net (2018) reported that the number of banks per RFQ jumped after this, with some RFQs going to more than 20 dealers. [U: paywalled, search snippet only] https://risk.net/derivatives/5585806/number-of-banks-per-rfq-jumps-in-eu-posing-risk-to-prices

**Venue features (panel size)**
- **Tradeweb FlexRFQ (European credit).** Up to 6 dealers at any time. A non-responding dealer can be swapped out while the RFQ is live. [S] https://www.thetradenews.com/tradeweb-upgrades-rfq-for-european-bonds-amid-liquidity-challenges/ ; https://articles.marketsmedia.com/tradeweb-flexes-rfq-muscles-bid-transform-european-credit-bond-markets
- **Bloomberg Portfolio Trading Basket Builder.** Up to six dealers in competition. [S] https://www.fi-desk.com/bloomberg-launches-portfolio-trading-basket-builder-to-boost-workflow-efficiency/
- **Eurex EnLight SMART RfQ.** Proposes **6 respondents**, ranked on volume, average response time, average response rate and trade-to-quote ratio. The list binds no one.
  - Anonymous RfQs need an exchange-set minimum number of respondents from different business units.
  - Respondents cannot be added after an anonymous RfQ is sent.
  - Each anonymous RfQ carries the requester's **Trade-to-Request Ratio** (e.g. 250/800 = 31.25%) so responders can judge how serious the requester is.
  - [V] T7 Release 15.0 Functional Reference Part 1 v2 (Oct 2, 2026), §10.6–10.7: https://www.cashmarket.deutsche-boerse.com/resource/blob/5409264/023659e230f0c441883c6ad093434a91/data/T7_Release_15.0_-_Functional_Reference-Part_1_Version_2.pdf

### 2.3 All-to-all / anonymous RFQ

**MarketAxess Open Trading**
- **How it works.** An anonymous all-to-all protocol where MarketAxess is the matched-principal counterparty ("riskless matching principal"). It is described as an extension of the disclosed RFQ, and responses can come from all participants, including other investors.
  - [S] SEC 10-K XBRL: https://www.sec.gov/Archives/edgar/data/1278021/000095017025025606/R13.htm
  - [S] https://www.nri.com/en/news/info/20240729_1.html
- **Who provides liquidity (2014–2018).** Open Trading won 12% of platform trades. Of that, only 2% was investor-to-investor, 3% was dealers trading with new clients, and 7% was new liquidity providers acting like dealers.
  - Prices improved by about 6 bps by end-2018: 2 bps direct and 4 bps from more competition.
  - The authors find "a significant winner's curse in corporate bond trading", which explains the scarcity of investor-to-investor trades.
  - Hendershott, Livdan, Schürhoff, SFI WP 21-43. [S: abstract] https://www.sfi.ch/en/publications/n-21-43-do-we-need-dealers-in-otc-markets
- **Recent volume.** Open Trading ADV was $4.6bn in Feb 2025, 36% of MKTX credit volume. [S] https://www.streetinsider.com/Press+Releases/MarketAxess+Announces+Trading+Volume+Statistics+for+February+2025/24461619.html
- **Market share.** Coalition Greenwich: all-to-all was 11% of surveyed-venue credit volume in Apr 2025, up from 6% two years earlier. [S] https://www.thetradenews.com/?p=100205

**Tradeweb AllTrade**
- A network of 700+ buy-side and sell-side accounts. [U: search snippet from a Tradeweb US-credit page; exact page not identified] Related: https://www.fi-desk.com/tradeweb-launches-enhanced-rfq-functionality-for-credit-markets/
- Tradeweb published research on leakage in all-to-all RFQs, but the page returned 403. [U] https://www.tradeweb.com/newsroom/media-center/insights/blog/information-leakage-in-us-credit-evidence-from-all-to-all-rfqs/

### 2.4 Exchange RFQ for futures and options (broadcast, then answered in the central limit order book)

**Eurex / Deutsche Börse T7** [V] T7 R15.0 Functional Reference §5.7 (URL above)
- **Who receives it.** An RfQ is "directed either to the entire market or to specific market makers". It "can be single-sided or double-sided, and it can optionally carry a quantity".
  - "For derivatives markets, only public distribution is supported": RfQs go "to all market participants via the public market data interface".
  - Cash markets can use private distribution to Designated Sponsors or Market Makers, or a user-defined distribution.
- **Acceptance throttles, which protect the book.** A user RfQ is accepted only if:
  - the instrument is in continuous or auction state;
  - there has been no recent RfQ on the instrument;
  - the user is under a rate limit;
  - **"The spread between the best buy price and the best sell price is not narrow enough, or alternatively, the quantity of the best price is not high enough."**
- **Automatic RfQs.** In derivatives, a market order that doesn't match and rests in the book, or a stop/OCO order that is triggered but doesn't fill, generates a double-sided RfQ with no quantity.
- **Market-maker obligations.**
  - Eurex Permanent Market-Making (e.g. EURO STOXX 50 dividend options) includes "responses to quote requests for all strikes and expirations".
  - Some 2015 circulars dropped the requirement to answer RFQs for products with continuous quotes.
  - [S: search summaries of 2015 Eurex circulars; which circular says what is not pinned down] https://www.eurex.com/resource/blob/195440/244c61c6cdd58e7259ee08acd63e5a2f/data/er15009e.pdf ; https://www.eurex.com/resource/blob/189556/4980ea89012337590665d409c1b18100/data/er15028e.pdf ; https://www.eurex.com/resource/blob/222792/501bfbdc424c84d9cb2401456f430de7/data/er15206e.pdf
  - Other exchanges: Nasdaq Stockholm reportedly requires an answer within 20 s, held for 20 s; BOX reportedly 3 s, held for 30 s. [U: search snippets only] https://nasdaq.com/docs/2024/02/29/Appendix-B-Market-Maker-Obligations-Weekly-Sweden.pdf

**CME Globex**
- **The RFQ.** "An electronic notification sent to all CME Globex participants." It is anonymous like all Globex activity. The sender "can request a specific size … but is not obligated to show any preference as a buyer or seller."
- **Responses.** Responders post live bids and offers in the order book, which the requester or anyone else can trade against.
- **Spreads.** Options spreads are user-defined spreads: the RfQ creates a tradeable strategy instrument.
- **Example.** A copper call spread quoted 0.0125/0.0235 from the legs. After an RFQ it tightened to a 0.0170 bid (228 lots) and a 0.0190 offer (163 lots).
- [S: search summaries; direct fetches timed out and cmegroup.com blocked scripted access]
  - https://www.cmegroup.com/education/request-for-quote.html
  - https://www.cmegroup.com/education/courses/tools-for-option-analysis/what-is-an-rfq
  - https://www.cmegroup.com/education/files/ofm-spread-overview.pdf
  - https://www.cmegroup.com/education/articles-and-reports/uncovering-copper-option-liquidity-via-rfq.html

### 2.5 Why requesters limit the panel: research

- **Hendershott & Madhavan (JF 2015).** "Traders select between dealer and auction markets based on a tradeoff between leakage about trading intentions and search costs." Costs fall with dealer competition. [V] working paper above
- **Riggs et al. (JFE 2020).** A winner's curse: the winning dealer infers that the other dealers' inventories lean the same way, which lowers its expected interdealer exit price. So "dealers' response rate will be decreasing in k" (the number of dealers queried), and this is confirmed empirically. Customer-dealer relationships matter too: customers prefer their clearing members and recent counterparties. [V] PDF above
- **Baldauf & Mollner, "Competition and Information Leakage" (JPE 132(5) 2024, 1603–1641).**
  - Each extra contact "intensifies competition and aids in finding a natural counterparty". It also intensifies leakage, which is costly if a losing dealer front-runs.
  - "the client optimally provides no information about her trading direction when requesting quotes" (two-sided requests).
  - [V: abstract] https://ideas.repec.org/a/ucp/jpolec/doi10.1086-727709.html
- **Yueshen & Zou, "When can less be more? Inducing dealer responses in RFQ platforms" (JET 236, 2026).**
  - Customers can maximize liquidity by admitting only a few dealers.
  - The optimal number depends on a "competition elasticity" set by dealers' response costs. Higher search costs raise the number; higher operating costs lower it.
  - A social planner would admit even fewer dealers, because customers induce "excessive dealer competition".
  - [S: INSEAD abstract] https://www.insead.edu/faculty-research/publications/journal-articles/when-can-less-be-more-inducing-dealer-responses-rfq ; discussion by T. Foucault: https://www.amf-france.org/sites/institutionnel/files/private/2023-09/less_is_more_-_discussion_thierry_foucault_hec_paris.pdf
- **Hendershott, Livdan, Schürhoff (2021 WP).** A winner's curse limits investor-to-investor trading in all-to-all. [S] above
- **Pre-hedging is a leakage channel.**
  - FX Global Code Principle 11: pre-hedge only as principal, "fairly and with transparency", and "not meant to disadvantage the Client". [V] https://www.globalfxc.org/uploads/fx_global.pdf
  - IOSCO final report (Nov 3, 2025): recommends prior client consent and ex-ante disclosure. It notes concern that several dealers pre-hedging the same competitive RFQ can worsen the client's price. [S] https://www.mvalaw.com/investigations-and-regulatory-advice/summary-of-ioscos-pre-hedging-final-report ; https://www.fi-desk.com/iosco-sets-pre-hedging-guard-rails-amid-calls-for-ban/
- **Earlier theory.** Zhu (RFS 2012), "Finding a good price in opaque OTC markets": repeated contacts. [U: from memory, not opened]

---

## 3. Who sets the price, and how it is constrained or benchmarked

### 3.1 Dealers quote; only the requester can execute

- **EU definition.** MiFID RTS Annex I defines an RFQ system as one where "a quote or quotes are provided in response to a request for quote submitted by one or more members or participants. The quote is executable exclusively by the requesting member or participant."
- **No private second step.** ESMA says an RFQ cannot be a two-step process ending in private bilateral negotiation with one respondent; that would be a separate trading process.
- **Equity transparency.** In equity RFQ systems, actionable quotes must be made pre-trade transparent no later than when they become executable, even if not acted on.
- [V: ESMA summary] ESMA Q&A 1552 (published 14/11/2018, updated 16/10/2024) https://www.esma.europa.eu/publications-data/questions-answers/1552

### 3.2 Best execution: EU and UK

- **MiFID II Art. 27(1).** Firms must "take all sufficient steps to obtain, when executing orders, the best possible result" considering price, costs, speed, likelihood of execution and settlement, size, nature and any other relevant consideration. "Sufficient" replaced MiFID I's "reasonable".
  - [S: secondary quotes] https://hlc.com/en/publications/achieving-best-execution-under-mifid-ii_2
  - UK copy: FCA COBS 11.2A https://handbook.fca.org.uk/handbook/COBS/11/2A.html
- **Does a dealer quoting on RFQ owe best execution?** The European Commission's working document ESC-07-2007 (letter to CESR, 19 March 2007) answers this with a "legitimate reliance" test. Proprietary quoting on a "request for quote" basis attracts best execution only if the client legitimately relies on the firm. The considerations, "taken together":
  1. who initiates the trade;
  2. market practice: "in the wholesale OTC derivatives and bond markets buyers conventionally 'shop around' by approaching several dealers for a quote, and in these circumstances there is no expectation … that the dealer chosen by the client will owe best execution";
  3. relative price transparency;
  4. the information provided and the terms of the agreement.
  - It presumes retail clients do rely on the firm and wholesale clients do not.
  - [V] https://jollycontrarian.com/images/7/75/Letter-cesr-best-execution_en.pdf
  - Many dealer policies still apply this "four-fold test" and presume RFQ business fails it, e.g. [S] https://www.tdsecurities.com/tds/document/MiFID-II-Best-Execution-Policy
- **Price fairness check.** Delegated Reg. 2017/565 Art. 64(4): for OTC products, firms must check "the fairness of the price proposed to the client" by gathering the market data used to estimate the price and, where possible, comparing with similar products. ESMA Q&A 1017 (10 Oct 2016) says this must be systematic and documented, using external data and reference prices.
  - [S] https://www.esma.europa.eu/publications-data/questions-answers/1017
  - [S] https://service.betterregulation.com/document/2017/03/31/274029
- **Execution-quality reports removed.**
  - RTS 28 ("top 5 venues") publication was deleted by the MiFID review directive (Art. 27(6) removed). ESMA asked national regulators to deprioritise enforcement (13 Feb 2024).
  - RTS 27 has been deprioritised since 28 Feb 2023.
  - [S] https://www.dlapiper.com/insights/publications/2024/02/esma-publishes-statement-on-reporting-requirements-under-rts-28-of-mifid-ii
  - The UK removed both. [S] https://www.efama.org/newsroom/news/efama-s-response-esma-s-review-mifid-ii-framework-best-execution-reports

### 3.3 Pre-trade transparency of RFQ quotes (bonds and derivatives)

- **EU.** The MiFIR review (Reg. 2024/791) limits non-equity pre-trade transparency to "a central limit order book or a periodic auction trading system", from **28 March 2024**.
  - The RTS 2 Annex I descriptions of RFQ and voice systems, and the size-specific (SSTI) provisions, stop applying to bonds, structured finance products and emission allowances.
  - [V] https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mifir/article-8-pre-trade-transparency-0
  - The waiver for RFQ/voice actionable indications of interest above SSTI is removed. [S] https://data.consilium.europa.eu/doc/document/ST-10635-2025-INIT/en/pdf
- **UK.** FCA PS24/14 (5 Nov 2024): "trading venues do not need to apply pre-trade transparency to voice and request-for-quote trading from 31 March 2025". Bond and derivative SIs need not publish quotes. The new regime starts 1 Dec 2025. [V] https://www.fca.org.uk/publications/policy-statements/ps24-14-improving-transparency-bond-and-derivatives-markets

### 3.4 Best execution: US

- **FINRA Rule 5310.**
  - (a)(1) diligence factors: character of the market, size and type of transaction, **"the number of markets checked"**, accessibility of the quotation, and order terms.
  - SM .03 (debt): accessibility of quotations is one factor.
  - SM .06 (limited quotations): written procedures for finding the best inter-dealer market, with documented compliance.
  - SM .09: "regular and rigorous" execution-quality reviews, at least quarterly.
  - [V] https://www.finra.org/rules-guidance/rulebooks/finra-rules/5310
- **FINRA Regulatory Notice 26-15** (July 24, 2026; comments closed Sept 25, 2026). Asks how best execution should apply to institutional use of "request-for-quote (RFQ) platforms or single dealer platforms (SDPs)", both for the platform operator and for an accessing broker. It also asks about pre-negotiated blocks. [V] https://www.finra.org/sites/default/files/2026-07/Regulatory-Notice-26-15.pdf
  - Tradeweb's comment letter backs keeping the fixed-income guidance (RN 15-46, SM .03). [S] https://www.finra.org/sites/default/files/NoticeComment/Tradeweb%20Comment%20Letter%20to%20RN%2026-15.pdf
- **SEC.** In June 2025 the SEC withdrew proposed Regulation Best Execution and the Reg ATS "communication protocol systems" proposal, among 14 proposals. [S] https://clsbluesky.law.columbia.edu/2025/06/23/sullivan-cromwell-discusses-sec-withdrawal-of-14-proposed-rules/

### 3.5 Composite and evaluated benchmarks used to judge RFQ quotes

- **MarketAxess Composite+ (CP+).**
  - Machine-learning two-way reference prices from TRACE plus MarketAxess platform and Trax data.
  - Launched in 2017 covering more than 24,000 bonds. Refreshes every 15–60 s depending on liquidity.
  - Positioned for pre-trade price discovery, TCA, auto-execution and best execution.
  - Vendor accuracy claim (Dec 2017): more than half of levels within 1.1 bp of the executed level.
  - [S] https://www.risk.net/technology/6151096/electronic-trading-support-product-of-the-year-marketaxess ; https://www.marketsmedia.com/second-revolution-in-electronic-bond-trading
- **Tradeweb Ai-Price.**
  - Bid and offer estimates for US investment-grade and high-yield corporates from TRACE plus Tradeweb data.
  - Provides pre-trade cost estimates and evaluates dealer responses and post-trade execution quality.
  - Upgraded Sept 22, 2026.
  - [S] https://www.tradeweb.com/newsroom/media-center/news-releases/tradeweb-enhances-ai-price-advancing-corporate-bond-pricing/ ; https://www.tradeweb.com/newsroom/media-center/insights/blog/tradeweb-ai-price-evolving-credit-pricing-for-todays-market/
- **Bloomberg CBBT and BVAL.**
  - CBBT is a rules-based composite of executable dealer quotes; it excludes trades. 92% of US/EU credit trades print inside the CBBT bid/ask.
  - BVAL and IBVAL are evaluated and trade-reference prices.
  - [S] https://www.bloomberg.com/professional/insights/data/pricing-insights-analyzing-quote-data-across-global-credit-markets

### 3.6 Disclosing the side: one-way vs. two-way requests

- **FIX.** Omitting Side in QuoteRequest means two-sided. [V] QuotReqGrp page
- **SEF RFQ.** Reveals identity, size and side. [V] Riggs et al.
- **CME.** Side is optional. [S] CME pages above
- **Eurex.**
  - T7 RfQs can be single- or double-sided; automatic RfQs are always double-sided with no quantity. [V]
  - EnLight: a Negotiation Event can start without side or quantity. Side can be given until the first HitQuote and is fixed once disclosed. The disclosed total quantity can be reduced but never increased. The requester chooses whether to disclose the number of respondents. [V] T7 §10.3.1.1
- **OTC Link.** Side defaults to Both. [V]
- **Tradeweb Request-for-Market (RFM).** Requests "a two-way price from multiple dealers … without disclosing the direction". The first fully electronic RFM swaption package traded on TW SEF (Citadel/Barclays), announced Oct 27, 2025, and 20 dealers now price it.
  - [S] https://www.tradeweb.com/zh/our-markets/institutional/emerging-markets/em-interest-rate-swaps/
  - [S] https://www.tradeweb.com/newsroom/media-center/news-releases/tradeweb-advances-electronification-of-swaptions-market-via-new-protocol/
  - [S] https://www.fi-desk.com/tradeweb-completes-electronic-swaption-trade/
- **Theory.** Baldauf & Mollner (2024): revealing no direction is optimal for the client.

---

## 4. Last look

- **Definition** (FX Global Code, Principle 17, Dec 2024 edition): "a practice utilised in Electronic Trading Activities whereby a Market Participant receiving a trade request has a final opportunity to accept or reject the request against its quoted price." [V] https://www.globalfxc.org/uploads/fx_global.pdf
- **Principle 17 headline:** "Market Participants employing last look should be transparent regarding its use and provide appropriate disclosures to Clients." [V]
- **Minimum disclosures:** "whether, and if so how, changes to price in either direction may impact the decision to accept or reject the trade, the expected or typical period of time for making that decision, and more broadly the purpose for using last look." [V]
- **Allowed purpose:** "last look should be a risk control mechanism used in order to verify validity and/or price".
  - The validity check covers operational details and available credit.
  - The price check confirms that the requested price "remains consistent with the current price that would be available to the Client." [V]
- **Prohibitions** [V]:
  - Last look "should not be used for purposes of information gathering with no intention to accept".
  - Confidential information arises when the request arrives.
  - Providers "should not conduct trading activity that utilises the information from the Client's trade request during the last look window", including pricing on e-trading platforms and hedging.
- **Cover-and-deal exception** [V: text is partly garbled in the PDF but readable]. Applies only if all three hold:
  1. There is an explicit understanding that the provider fills without taking market risk, by first offsetting in the market.
  2. All volume traded in the window is passed on to the client.
  3. This is documented and disclosed.
  - Annex example: Bank A covers 50m but fills the client for only 45m and keeps the gain on 5m, which breaches the principle. [V]
- **History.** Principle 17 was tightened in Dec 2017; a cover-and-deal report followed in Feb 2019. [V] GFXC report below
- **GFXC Execution Principles Working Group Report on Last Look (Aug 2021).** [V] https://www.globalfxc.org/docs/gfxc_report_last_look.pdf
  - "Incorporating any delay that is additional to what is required to complete the price and validity check is considered contrary to Principle 17."
  - It applies to all counterparties, named or anonymous. Rejected-trade information must not feed real-time trading.
  - Disclosures (via the Disclosure Cover Sheet): whether the price check is **symmetric or asymmetric**; last-look window **maximum and minimum** length; whether cover-and-deal is used.
  - Asymmetric checks accept when the market has moved in the provider's favour and reject when it has moved against. Some providers instead fill at an improved price.
  - On request, give trade-by-trade reject reasons (failed validity vs. failed price check).
  - Red flags: long or uneven hold times, accept/reject time asymmetry, high reject rates combined with asymmetry.
- **Enforcement precedent.** NYDFS fined Barclays **$150m (Nov 2015)** for using last look with a "hold time" to reject orders that would be unprofitable, and for hiding the reasons from clients. [S] https://www.dfs.ny.gov/reports_and_publications/press_releases/pr1511181 ; https://www.steptoe.com/en/news-publications/nydfs-cracks-down-on-last-look.html
- **Firm quotes for contrast.**
  - In a CLOB, "submitted prices represent 'firm liquidity' as once interest is matched, participants are obligated to commit to the transaction". [V] GFXC 2021
  - SEF RFQ quotes are generally firm with a ~30 s countdown. [V] Riggs et al.
  - Eurex EnLight lets the requester run the negotiation as Indicative, where the respondent does a "Final Check" (Pending → Final), or Firm, where a HitQuote creates the deal immediately. [V] T7 §10.3.1.1
  - FIX expresses this with QuoteType (0 indicative / 1 tradeable) and ExposureDuration. [V]
  - Bilateral "respond to a single dealer's stream", where the dealer may accept or reject, is "quite similar to the 'last look' option in FX". [V] Riggs et al.
- **Research.**
  - Cartea, Jaimungal & Walton, "Foreign exchange markets with last look" (Math. Fin. Econ. 2019; arXiv 1806.04460). On a single venue, last look lowers spreads by limiting latency-arbitrage losses. With two venues, the last-look venue can end up with wider spreads. [S: abstract] https://www.arxiv.org/pdf/1806.04460
  - Oomen, "Last look", *Quantitative Finance* 2017. [U: citation only]

---

## 5. Which orders go to RFQ vs. the order book

### 5.1 Size and blocks

- **Swaps (SEFs).** Block trades are carved out of the Required Transaction methods. [V] CFTC NPRM text
  - 2016 minimum block sizes: $110m CDX.NA.IG, $28m CDX.NA.HY, €99m iTraxx Europe, €26m iTraxx Crossover. [V] Riggs et al. fn. 9
  - The Part 43 block-size methodology uses a 67% notional calculation (2013 rule), updated in Nov 2020 and later.
    - [S] https://www.cftc.gov/LawRegulation/FederalRegister/FinalRules/2013-12133.html
    - [S] https://docs.regulations.justia.com/entries/2020-11-25/2020-21568.pdf
    - [S] https://www.cftc.gov/PressRoom/PressReleases/8913-24
- **CME Rule 526 block trades.**
  - Privately negotiated, off the central book, above exchange-set minimum quantity thresholds.
  - Price must be "fair and reasonable" given size, other trades and related markets.
  - No aggregation to reach the minimum. Each spread leg must meet the threshold (FX-options exception).
  - Reporting deadlines are 5 or 15 minutes depending on product: FX options moved from 5 to 15 minutes in 2019.
  - [S] https://www.cmegroup.com/rulebook/files/cme-group-Rule-526.pdf ; https://cftc.gov/filings/orgrules/rule052019cmedcm001.pdf
- **Eurex EnLight.** Off-book negotiation for "large scale execution requirements, not suited for the central limit order book". [S] https://www.thetradenews.com/thought-leadership/eurex-strengthens-its-rfq-platform-eurex-enlight-with-two-new-functionalities
  - Deals become TES (off-book on-exchange) trades, published per the configured non-disclosure limits. [V] T7 §10.1, §10.3
- **EU large-in-scale (LIS) waivers.** Equity LIS thresholds are set by average-daily-turnover band (RTS 1 Annex II Table 4; ETFs Table 5). [S] https://www.esma.europa.eu/publications-data/questions-answers/1068
  - Specific numbers (e.g. €15k at the lowest band, ETF pre-trade LIS €1m) are [U].
  - Non-equity LIS waivers still exist under the reviewed Art. 9. LIS treatment applies to non-equity pre-arranged trades except OTC derivatives under the trading obligation. [S] https://www.esma.europa.eu/print/pdf/node/203843
- **Evidence on size and protocol choice.**
  - Riggs et al.: bigger trades move away from multi-dealer RFQ toward bilateral, and use fewer dealers.
  - Hendershott & Madhavan: queries fall with size, the response share rises, and zero-response risk rises (5.9% → 15.1%).
  - FINRA RN 26-15 notes "challenges experienced when printing pre-negotiated block trades with institutional customers". [V]

### 5.2 Instrument liquidity

- **Why RFQ was permitted for swaps.** When adopting the SEF rules, the CFTC "anticipated that RFQ systems would help facilitate trading" for less liquid Required Transactions. Order books still carry little SEF volume (<1–3% of CDS, <1–~20% of IRS). [V] CFTC NPRM 2026
- **Eurex T7 RfQ condition.** An RfQ is accepted only when the book is wide or thin. [V]
- **BIS (2016).** Automation is concentrated in "the most liquid market segments"; take-up lags in high yield. [S] https://www.bis.org/publ/mktc07.htm ; https://www.bis.org/publ/qtrpdf/r_qt1603h.htm
- **O'Hara & Zhou, "The electronic evolution of corporate bond dealers" (JFE 140(2) 2021).** Electronic RFQ is still relatively small and segmented but lowers costs. [S: abstract] https://ideas.repec.org/a/eee/jfinec/v140y2021i2p368-390.html
- **Survey.** Bessembinder, Spatt & Venkataraman, JFQA 55(1) 2020. [S] https://ideas.repec.org/a/cup/jfinqa/v55y2020i1p1-45_1.html

### 5.3 Multi-leg strategies and packages

- **CME.** An RFQ on a user-defined spread creates a single tradeable strategy instrument, which removes leg risk. [S] CME spread overview above
- **Eurex EnLight.** Workflows: Regular, Working Delta (options plus delta hedge), Basis Trade, Delta Exchange, VolaRefOnly. EnLight trades can serve as the options leg of Vola trades. [V] T7 §10.3–10.5
- **FIX.** QuotReqLegsGrp inside QuoteRequest. [V] QuotReqGrp page
- **Tradeweb.** RFM swaption-plus-swap package in one electronic quote. [S] above
- **Cboe.** C-AIM and C-SAM handle complex (multi-leg) orders. [V] https://cdn.cboe.com/resources/regulation/rule_filings/approved/2025/SR-CBOE-2025-095.pdf

---

## 6. Hybrid models: RFQ that must interact with the order book

### 6.1 CFTC SEF: RFQ "in conjunction with" the order book

For Required Transactions, an RFQ system must operate "in conjunction with an Order Book". The SEF must:
1. "communicate to the requester any firm bid or offer pertaining to the same instrument resting on any of the swap execution facility's Order Books at the same time the requester receives the first responsive bid or offer";
2. let the requester "execute against such firm resting bids or offers along with any responsive orders";
3. give equal priority in receiving requests and in sending and displaying responses.

[V] https://www.law.cornell.edu/cfr/text/17/37.9

- **Pre-arranged crosses.** Brokers' pre-arranged crosses on the order book must expose one side to the book for 15 seconds, §37.9(b). [V] CFTC NPRM fn. 8

### 6.2 CME crossing protocols (Rule 539.C; Market Regulation Advisory RA1718-5, Dec 5 2017, effective Jan 8 2018)

[V] https://www.cftc.gov/filings/orgrules/rule120517cmedcm004.pdf. This is dated: check the current Rule 539.C table at https://www.cmegroup.com/rulebook/files/rule-539-c-crossing-protocols.xlsx.

- **R-Cross (RFQ + RFC).**
  - First an RFQ for the option or spread goes to Globex. The Request for Cross (RFC) must follow **15–30 s** later (agricultural products: 5–30 s), in the same session.
  - "A participant-entered RFQ in connection with an R-Cross is indistinguishable from a generic RFQ."
  - RFC price and quantity are not displayed.
  - Matching: if the RFC price improves both the best bid and best offer, 100% crosses. Otherwise, **"the applicable side of the RFC order will immediately match against the orders in the book at a price better than or equal to the RFC price"**, and only the remainder crosses.
- **C-Cross (committed cross).**
  - The RFC is shown as a committed cross that executes in 5 s.
  - Same book-first matching. A "better price match" (BPM) percentage applies in eligible products when the RFC sets a new best price on both sides and nothing better arrives within the 5 s.
  - Used for CME FX options and CME/CBOT interest-rate and equity-index options.
- **G-Cross.** The second order may follow only after 5 s; no RFQ. Not available for options.
- **A-Cross.** A broker cross sequence 5–30 s after the RFQ (NYMEX/COMEX) or 15–30 s after (CME FX).

### 6.3 Eurex T7

- **Public RfQ answered on the book.** RfQs are broadcast to all participants via market data; market-maker responses are quotes in the central order book. Automatic RfQs fire when market orders rest unmatched. [V] §5.7
- **Quote Request Solution (QRS), cash markets.**
  - The participant asks the market maker or specialist for a private indicative quote: ISIN, quantity, side optional.
  - It then sends a QRS order that triggers an **auction call phase**.
  - Fill-or-nothing: no partial fills, no modifications, deleted at the end of the period. Daily caps per business unit.
  - [V] §5.7.3
- **EnLight.** Off-book deals become TES trades, published per non-disclosure limits. [V] §10

### 6.4 US options price-improvement auctions

**Cboe AIM (Rule 5.37)** [V] rule text in SR-CBOE-2021-025 Exhibit 5: https://www.sec.gov/files/rules/sro/cboe/2021/34-91689-ex5.pdf
- **Setup.** The initiator pairs a customer (agency) order against its own principal interest or a solicited order. Executions must be "at or better than both sides of the BBO existing at the conclusion of the AIM Auction and at or better than both sides of the Initial NBBO".
- **Allocation with no price improvement:**
  1. **(A) Priority Customer orders on the Book (in time priority);**
  2. (B) Priority Orders, if the class is designated;
  3. (C) the Initiating Order: the greater of 1 contract or up to **50%** if one other user is at the price, or **40%** if two or more (computed after Priority Customers). The initiator never gets more than 50%/40% of the initial agency order;
  4. (D) Priority Orders, where designated;
  5. (E) all other interest, including AIM responses and book orders and quotes, pro rata;
  6. (F) the initiator for any remainder.
- **Last priority.** The initiator may elect last priority.
- **Who goes first.** Book interest at the same price, especially customers, goes ahead of the initiator.
- **Auction length.**
  - AIM auction ≥100 ms. The maximum was cut from 3 s to **1 s** in SR-CBOE-2025-095 (approved Dec 10, 2025).
  - Response-processing grace period: up to 100 ms (SPX: 900 ms, with a combined cap of 1,000 ms extended to June 30, 2026).
  - [V] https://cdn.cboe.com/resources/regulation/rule_filings/approved/2025/SR-CBOE-2025-095.pdf
  - The 2012 approval of the last-priority election: [S] https://www.sec.gov/rules/sro/cboe/2012/34-66375.pdf

**BOX Price Improvement Period (PIP, Rule 7150)**
- At the end of the PIP, the order matches competing orders and quotes in price priority.
- At the final price, the Initiating Participant gets **up to 40% of the remainder after Public Customer orders are satisfied**. A 50% variant applies when only one competing order matches. Then market makers, then others; a Quality Market Maker step was added in 2016.
- [S] https://www.sec.gov/files/rules/sro/box/2014/34-72477.pdf ; https://www.sec.gov/files/rules/sro/box/2016/34-78171-ex5.pdf

### 6.5 Common pattern across hybrids

These are my synthesis of the sources above.

- **(i) The book trades first.** Resting book liquidity at better (and often equal) prices trades first, or must be shown to the requester: SEF, CME R/C-Cross, Cboe AIM, BOX PIP.
- **(ii) A minimum exposure time.** 100 ms to 30 s: AIM ≥100 ms, C-Cross 5 s, R-Cross 15–30 s, SEF crosses 15 s.
- **(iii) A capped guarantee for the initiator.** Typically 40%, or 50% with a single competitor.
- **(iv) Anti-gaming.**
  - Throttles: Eurex RfQ rate limits and the wide-or-thin-book condition.
  - Requester-quality signals: Eurex TRR and TQR.
  - Indistinguishability: an R-Cross RFQ looks like any other RFQ.

---

## 7. Notes on method and gaps

- **CME.** Primary pages timed out, and cmegroup.com returned an "IP blocked due to suspected web scraping" message to one scripted request. CME facts are therefore from the CFTC-hosted 2017 advisory [V] or from search summaries [S]. Verify the current Rule 539.C and 526 tables manually.
- **Not opened:**
  - Tradeweb all-to-all leakage blog (403).
  - Risk.net 2018 RFQ article (paywalled).
  - FIX EP159 design PDF.
  - Full text of Baldauf–Mollner and Yueshen–Zou (abstracts only).
  - MiFIR Art. 9 consolidated text (amended waiver list from secondary sources).
- **Not found:** a rule mandating a *maximum* number of RFQ recipients anywhere. The US mandates a minimum of 3 for MAT swaps, the EU forbids venue-imposed caps, and caps of 5–6 are venue design choices.
