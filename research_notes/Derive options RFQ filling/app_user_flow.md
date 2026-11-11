# How orders fill in the Derive app: instant orderbook fills vs RFQ (user/product side)

Research date: 2026-11-08. Scope: current Derive product (2025–2026). Video metadata (upload date, length, views, description) was read from the YouTube watch pages; transcripts are YouTube auto-captions pulled with yt-dlp; UI details were read off frames of the downloaded videos. Where a claim comes from my own viewing of a video frame, it says so.

## 1. Which Derive YouTube videos cover RFQ, and what do they show? (Is there a "30-minute wait" video?)

### Takeaway
No official Derive video shows an RFQ sitting for 30 minutes before a fill. The likely source of that memory is **"Anyone Can Be a Market Maker Now On Derive.XYZ"** (8 Dec 2025, 61 s). It shows a public RFQ board that any whitelisted maker can read, with a selected open RFQ counting down "Expires: 29m 36s" and a "Send Quote" box. The 30 minutes is the RFQ's **default validity window** (the docs give 30 minutes as the default), not a typical wait. Derive's taker tutorial video says the opposite: quotes arrive "in seconds."

### Cited Findings
**Video A, the maker-side video that most likely matches what the user remembers**
- Title "Anyone Can Be a Market Maker Now On Derive.XYZ", channel Derive (@derivexyz), published 2025-12-08 19:26 PT, 61 s, about 546 views. Description: "We've opened our RFQ quoting system to everyone. Whether you're retail or running a desk, you can now make markets on Derive.XYZ and compete with professionals. The new RFQ Maker UI gives you everything: BBO, greeks, payoff charts, order book, and live trades. If you can price options, you can quote… Start here: https://app.derive.xyz/rfq … DM us on Discord to get whitelisted." — [YouTube 4QyQ-gaCRl0](https://www.youtube.com/watch?v=4QyQ-gaCRl0)
- What the frames show (my viewing of the downloaded video):
  - An "RFQ" page lists RFQs from many wallets, with columns Created, Legs, Qty, Filled, Fill Price, Wallet, Subaccount and Status. The statuses shown are Open, Filled, Expired and Cancelled, with filters for "All subaccounts" and "All currencies" (BTC, ETH, HYPE).
  - The selected RFQ panel reads "Long Call · Dec 4 21:03 · Open · **Expires: 29m 36s** (then 29m 32s) · +1 HYPE $50 Call, Jan 30". It has Buy/Sell, Quantity 100, a Price field with a "Use Mark" option, and Review and **Send Quote** buttons, and shows the HYPE index price and mark price.
  - On-screen captions read "Be the first to quote new RFQs", "Quote calls, puts & spreads with full trader tooling", "Quote BTC, ETH and HYPE options with more to come", "HYPE options are seeing nonstop taker flow", "BBO / Payoff Chart / Live Order Book" and "Makers earn rewards for improving Derive's markets".
  - A "Request Access" screen reads: "You are not currently set up to respond to RFQs. Please contact Support (bottom left) in case you do not want to use Discord."
  — [YouTube 4QyQ-gaCRl0](https://www.youtube.com/watch?v=4QyQ-gaCRl0)
- The companion blog post (Dom Rom, CTO, 9 Dec 2025) repeats the text: "We've opened our RFQ quoting system to everyone… If you can price options, you can quote", with rebates and rewards for competitive makers, and "DM us on Discord to get whitelisted." — [Derive Insights: Anyone Can Be a Market Maker](https://insights.derive.xyz/anyone-can-be-a-market-maker-now-on-derive-xyz/)

**Video B, the taker tutorial (single-leg RFQ)**
- Title "How to use the RFQ on Derive.xyz", channel Derive, published 2026-07-22, 2 min 20 s, about 120 views. Description: "An empty order book doesn't mean there's no liquidity. On Derive, market makers quote on request, you just have to ask… submit a request, get competitive quotes from market makers **in seconds**, and execute at the price you see. It's free to request, and there's no obligation to trade. Works for single options, spreads, and multi-leg structures." — [YouTube 5Kkn5-ZXYSQ](https://www.youtube.com/watch?v=5Kkn5-ZXYSQ)
- From the transcript (auto-captions):
  - The presenter buys an ETH 7 August call. The Book tab "shows only the resting orders", with a limit price of 32.7 available. He then switches to RFQ for the same trade and gets a quote "like a 2% off of the limit price."
  - "Market makers do not sit on every strike of every expiry all day long. They quote when someone asks… It is free, it takes seconds."
  - The auto-captions render the intro as "welcome to Deribit Insights", which is almost certainly a mis-hearing of "Derive Insights".
  — [YouTube 5Kkn5-ZXYSQ](https://www.youtube.com/watch?v=5Kkn5-ZXYSQ)
  - The video file itself would not download (HTTP 403), so this video's UI was not viewed.

**Video C, RFQ from the order book**
- Title "How to use RFQ direcly from book on Derive.xyz", published 2026-05-26, 55 s. Description: "execute large trades instantly with deep liquidity." — [YouTube OsZDxd3FU-M](https://www.youtube.com/watch?v=OsZDxd3FU-M)
- Captions: "Click on RFQ. Create RFQ. Choose your expiry and strike price. Choose amount. Click submit RFQ. Or you can use the RFQ directly from the trading book. Execute larger trades through custom RFQs with competitive pricing." — [YouTube OsZDxd3FU-M](https://www.youtube.com/watch?v=OsZDxd3FU-M)
- Frames (my viewing):
  - The top navigation is Options / Perps / Spot / RFQ / Markets / Custom.
  - The RFQ page has Taker and Maker tabs, with "Strategy Builder" and "Create RFQ" buttons.
  - The RFQ ticket has presets (Call, Put, Call Spread, Put Spread, Risk Reversal, Butterfly, Straddle, Strangle, Custom, More), a "Counterparties" filter, a payoff chart, and the estimated cost, margin, fee and rewards.
  - The order-book ticket for an ETH $2350 Call has an **Execution** dropdown (see question 2).
  — [YouTube OsZDxd3FU-M](https://www.youtube.com/watch?v=OsZDxd3FU-M)
- The same 55 s video was posted in Portuguese ("Como usar o RFQ", 2026-08-21) and Korean ("RFQ 이용 방법", 2026-08-19). — [YouTube s-beFn8VCXo](https://www.youtube.com/watch?v=s-beFn8VCXo); [YouTube vyF5W150CCQ](https://www.youtube.com/watch?v=vyF5W150CCQ)

**Other related videos**
- "How to use strategy builder on Derive.xyz" (2026-05-26, 58 s). Captions: "Select strategy builder. Pick asset. Choose directions. Select strategy. **The RFQ panel will automatically open.** Choose expiry and price. Choose the amount… Click submit RFQ." — [YouTube HYvlqKly9bg](https://www.youtube.com/watch?v=HYvlqKly9bg)
- "Negociação institucional" (2026-08-21, 13 s). Captions: "Institutional trading. Become a maker and respond to RFQs." — [YouTube iAP8aZVnKVY](https://www.youtube.com/watch?v=iAP8aZVnKVY)

**Docs: where the 30 minutes comes from**
- "An RFQ is quotable only for a bounded window after creation (`valid_until`). The default window is 30 minutes" (the exact window "may differ per environment"). RFQ statuses are open, filled, cancelled and expired. — [Derive Docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)

### Inferences
- The "order waiting about 30 minutes, visible to everyone, anyone can quote" the user remembers matches Video A: a maker board listing other users' RFQs with a 30-minute countdown. A countdown starting at ~29m 36s does not mean the RFQ took 30 minutes to fill; it is the time left before it expires. On the board some RFQs show Filled and many show Expired or Cancelled, so some get no fill at all.
- If the user saw a full wait-then-fill sequence, it is not in any of the official videos listed above (I checked the channel's video list and an RFQ search on the channel). It may have come from a community video or a livestream.

### Gaps
- I could not find a Derive video that shows a taker's RFQ waiting about 30 minutes and then filling at the best quote. I also could not find any Derive video post on X showing that. The April 2026 X post about RFQ has a photo, not a video (see question 5).
- Video B's frames could not be viewed (download blocked), so its exact UI is known only from the transcript and description.
- Derive's YouTube Shorts and livestreams were not checked exhaustively.

## 2. How does a user place an options trade in the Derive app: orderbook vs RFQ / strategy builder? Which is the default for single-leg trades, and what sends a trade to RFQ?

### Takeaway
A single-leg option is normally traded from the options chain ticket against the **central limit order book**: limit or market orders, GTC/post-only/IOC/FOK, filling immediately against resting quotes. The ticket has an **Execution** setting: Auto ("Auto-switch between orderbook and RFQ based on **number of legs**"), Book ("Always use orderbook") or RFQ ("Always use RFQ"). Multi-leg structures and the Strategy Builder open the RFQ panel. Docs and marketing also steer **large** trades to RFQ, but I found no hard size threshold.

### Cited Findings
- **The Execution dropdown (my viewing of Video C, ~36–40 s).** The ETH $2350 Call Apr 23 ticket shows:
  - Order Type: Limit; Limit Price (with "Ask: $31.9"); Amount; Post; GTC.
  - A header menu labelled "Book", which opens "Execution" with three choices:
    - **Auto**: "Auto-switch between orderbook and RFQ based on number of legs"
    - **Book**: "Always use orderbook" (checked in the demo)
    - **RFQ**: "Always use RFQ"
  - After switching to RFQ, the ticket becomes Direction / Instrument / Ratio / Amount with a **Submit RFQ** button.
  — [YouTube OsZDxd3FU-M](https://www.youtube.com/watch?v=OsZDxd3FU-M)
- **Order types on the book.**
  - `limit` "Rests on the book at `limit_price`".
  - `market` "Crosses the book immediately; any unfilled portion is cancelled rather than left resting".
  - Time in force: `gtc` (default), `post_only`, `fok`, `ioc`.
  - "`market`, `ioc`, and `fok` orders never leave a resting order in the book."
  — [Derive Docs: Orderbook Trading](https://docs.derive.xyz/trading/order-types.md)
- **RFQ's purpose (official).** "the venue for large or multi-leg structures that would be hard to fill on the public orderbook"; a multi-leg RFQ "fills all-or-nothing at a single `total_cost`". — [Derive Docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- **Strategy Builder always goes through RFQ.** "Select strategy. The RFQ panel will automatically open… Click submit RFQ." — [YouTube HYvlqKly9bg](https://www.youtube.com/watch?v=HYvlqKly9bg)
- **Taker RFQ flow in the app (CEO post, 10 Dec 2025).** Open the RFQ page, click Create RFQ, choose calls, puts, spreads or custom legs, set expiry and strikes, then submit; "makers receive the request" and buy and sell quotes appear side by side for the trader to pick. — [Derive Insights: Derive's New RFQ Experience](https://insights.derive.xyz/derives-new-rfq-experience/)
- **Single-leg RFQ is supported.** "Works for single options, spreads, and multi-leg structures." — [YouTube 5Kkn5-ZXYSQ](https://www.youtube.com/watch?v=5Kkn5-ZXYSQ)
- **Size guidance only.**
  - X post (17 Apr 2026): "For larger trades, use RFQ to get direct quotes from MMs." — [X @DeriveXYZ](https://x.com/DeriveXYZ/status/2044980765663064543)
  - Video C: "Execute larger trades through custom RFQs." — [YouTube OsZDxd3FU-M](https://www.youtube.com/watch?v=OsZDxd3FU-M)
  - The RFQ docs give no minimum RFQ size. — [Derive Docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)

### Inferences
- In Auto mode a single-leg order should route to the book and a multi-leg order to RFQ, since the stated rule is "based on number of legs." Nothing describes a size-based auto-switch. So a user placing ordinary single-leg orders sees book fills unless they choose RFQ.

### Gaps
- Whether **Auto** or **Book** is the app's default is not stated anywhere I found. The demo shows Book checked, which may have been set by hand.
- No official size threshold for sending a trade to RFQ was found, and no app-enforced minimum RFQ size either.

## 3. Is there a public RFQ board where anyone can quote, vs private RFQs answered by market makers in seconds? Is there a block-trade product, Paradigm integration, or auction with a timer?

### Takeaway
Both modes exist in the same RFQ system. By default a taker's RFQ goes to **all whitelisted RFQ makers**. These makers see it on the RFQ Maker page, a board of open, filled, expired and cancelled RFQs with a countdown to expiry. A taker can instead direct an RFQ privately to named wallets (the "Counterparties" filter). Since December 2025 the maker role has been open to anyone who requests access, including retail. Automated market makers answer in seconds; manual makers on the board can take longer. The only formal "auction" in Derive's docs is the **liquidation auction**, a separate mechanism. I found no Paradigm integration or separately branded "Derive Block" product.

### Cited Findings
- **Who an RFQ reaches.**
  - "Leave `counterparties` empty to open the RFQ to all makers, or list wallet addresses to direct it privately." — [Derive Docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
  - Maker discovery: `private/poll_rfqs` lists "RFQs that are open to all makers or that name the maker's wallet as a counterparty". — [Derive Docs llms.txt index (poll_rfqs)](https://docs.derive.xyz/llms.txt)
  - `send_rfq` takes "a list of specific counterparties to restrict who can see it". — [Derive Docs: private/send_rfq](https://docs.derive.xyz/api-reference/rfq/privatesend_rfq.md)
  - A search-result snippet of the older `send_rfq` reference says that if no makers are specified, "all market makers who are approved as RFQ makers will be notified". I saw only the snippet, not the page. — [Derive Docs (older reference): Send Rfq](https://docs.derive.xyz/reference/post_private-send-rfq)
- **Maker approval is required.**
  - `private/get_account` returns "cancel-on-disconnect and RFQ-maker flags". — [Derive Docs llms.txt index (get_account)](https://docs.derive.xyz/llms.txt)
  - The app's "Request Access" screen reads "You are not currently set up to respond to RFQs" (my viewing). — [YouTube 4QyQ-gaCRl0](https://www.youtube.com/watch?v=4QyQ-gaCRl0)
  - The blog says "DM us on Discord to get whitelisted." — [Derive Insights: Anyone Can Be a Market Maker](https://insights.derive.xyz/anyone-can-be-a-market-maker-now-on-derive-xyz/)
- **Opened to everyone on 8–9 Dec 2025.** "Whether you're retail or running a desk, you can now make markets on Derive.XYZ and compete with professionals." — [YouTube 4QyQ-gaCRl0](https://www.youtube.com/watch?v=4QyQ-gaCRl0); [Derive Insights: Anyone Can Be a Market Maker](https://insights.derive.xyz/anyone-can-be-a-market-maker-now-on-derive-xyz/)
- **The maker board shows RFQs from many wallets** with Legs, Qty, Filled, Fill Price, Wallet (truncated), Subaccount and Status, plus an Expires countdown on the selected RFQ (my viewing). — [YouTube 4QyQ-gaCRl0](https://www.youtube.com/watch?v=4QyQ-gaCRl0)
- **What takers see of quotes.** `private/poll_quotes` returns "public quote views (including the maker's wallet)". — [Derive Docs llms.txt index (poll_quotes)](https://docs.derive.xyz/llms.txt)
- **Timer.** The default window is 30 minutes, set by `valid_until`. — [Derive Docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- **Partial fills and cost limits.**
  - `partial_fill_step` (default 1).
  - `max_total_cost` / `min_total_cost` filter only `rfq_get_best_quote` and the best-quotes channel, and "Makers do not see either limit."
  — [Derive Docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- **Fast automated makers.** "get competitive quotes from market makers in seconds" — [YouTube 5Kkn5-ZXYSQ](https://www.youtube.com/watch?v=5Kkn5-ZXYSQ)
- **Marketing names.** Derive calls the feature "RFQ" and, in one description, "Block RFQ" ("pro-level features like Portfolio Margining, Cross-Asset Collateral, and Block RFQ"). — [YouTube wM6tVju_6MQ](https://www.youtube.com/watch?v=wM6tVju_6MQ)
- **The only "auction" is liquidation.** `public/get_live_auctions` "Returns every liquidation auction open right now", and `private/liquidate` "Bids on an open liquidation auction". — [Derive Docs llms.txt index](https://docs.derive.xyz/llms.txt)
- **Do not confuse with Deribit.** Deribit (a different exchange) launched its own "Block RFQ" in March 2025. — [CoinDesk via search result](https://hotfix.coindesk.com/markets/2025/03/06/deribit-launches-block-rfq-system-to-improve-liquidity-for-large-over-the-counter-trades)

### Inferences
- The board is "public" only to approved makers. Takers do not see other takers' RFQs, and outsiders see nothing. However, since approval is open to anyone who asks, in practice it is close to public among participants.
- No auction close fills the best quote automatically. Per the docs, the taker picks a quote and signs `execute_quote`. Any "best quote filled" moment in a video was the taker executing, or an app helper calling `rfq_get_best_quote` and then executing.

### Gaps
- I found no Paradigm integration on current Derive. Paradigm was not searched in depth.
- How many RFQ makers there are and their typical response times are not published.
- Whether the taker's wallet on the maker board is anonymised beyond truncation is not documented.

## 4. Why do the user's own options orders fill instantly?

### Takeaway
Most likely the user trades single-leg options from the chain ticket in Book or Auto mode. A market or marketable limit order crosses resting market-maker quotes on the central limit order book and fills at once. Derive pays makers to keep that book quoted (Options OB pool 400k DRV per 28-day epoch plus a USDC rebate pool). Even through RFQ, automated makers answer in seconds and the taker executes right away. The 30-minute figure is only the latest point at which a quote can still be accepted.

### Cited Findings
- `market` orders "cross the book immediately"; `ioc` and `fok` fill immediately or cancel. — [Derive Docs: Orderbook Trading](https://docs.derive.xyz/trading/order-types.md)
- Orderbook fees: option taker `$0.5 + min(0.03% × notional, 12.5% × premium)`, maker `min(0.01% × notional, 12.5% × premium)`. RFQ: "the taker notional fee rate on both counterparties, plus a base fee on the taker side", with "up to 100% discounts" on the cheaper legs of multi-leg trades (for example, the second leg of a 2-leg spread is free). — [Derive Docs: Trading Fees](https://docs.derive.xyz/integrators/trading/trading-fees.md)
- Institutional Trading Rewards:
  - "increasing liquidity and volume in the central limit order book and RFQ platform".
  - "Up to $500,000 USDC exchange rebates per 28-day epoch".
  - 1M DRV per epoch split Options RFQ 200k / **Options OB 400k** / Perps 400k, across ETH/BTC 50%, HYPE 25% and alts 25%.
  — [Derive Docs: Institutional Trading Rewards Program](https://docs.derive.xyz/integrators/programs/institutional-trading-rewards.md)
- X post (17 Apr 2026): "Some options traders are actively looking to buy ETH gamma and are quoting aggressively on Derive… Order book depth has improved significantly as well. For larger trades, use RFQ to get direct quotes from MMs." — [X @DeriveXYZ](https://x.com/DeriveXYZ/status/2044980765663064543)
- Derive itself admits book gaps: "Market makers do not sit on every strike of every expiry all day long. They quote when someone asks." — [YouTube 5Kkn5-ZXYSQ](https://www.youtube.com/watch?v=5Kkn5-ZXYSQ)
- A third-party review (CryptoWinRate, updated 8 Oct 2026) says "Options liquidity is real but thin next to the big centralised options venues". — [CryptoWinRate Derive review](https://www.cryptowinrate.com/derive-exchange-review)

### Inferences
- **Instant fill:** a crossing order against standing MM quotes on liquid strikes, the main ETH/BTC expiries.
- **Waiting case:** an RFQ on a less-liquid structure, a large size, or an alt asset (the maker video's example is HYPE), answered by manual makers on the board. It either gets quotes within the 30-minute window or expires.
- I found no evidence that Derive's own vaults are the counterparty filling user orders. Vaults on current Derive are curator-run subaccounts (`private/create_vault`), not an AMM backstop.
- **Historical:** Lyra V1 (2021–2023, Optimism/Arbitrum) used an AMM pool, so every trade "filled instantly" against the pool. That is not how current Derive works. This is background knowledge; no fetched source confirms it (see Gaps).

### Gaps
- The user's exact order type and mode are unknown, so "Book/Auto" is an inference.
- No public data was found on Derive book depth or on RFQ response-time statistics.
- I did not fetch a source documenting the Lyra V1 AMM mechanics. Lyra's 2021 mainnet launch post exists ([Derive Insights: Lyra OΞ Mainnet Launch](https://insights.derive.xyz/lyra-mainnet-launch/)) but was not read.

## 5. What do official announcements say about RFQ launch dates, intended users, timers and quote display?

### Takeaway
The official material I found is from late 2025 through 2026:
- **8–10 Dec 2025:** a rebuilt taker RFQ UI and the RFQ maker side opened to everyone, with whitelisting.
- **May–Aug 2026:** tutorial videos on RFQ, RFQ from the book, and the Strategy Builder.
- **Apr 2026:** an X post steering "larger trades" to RFQ.
- **Docs:** a 30-minute default validity window, quotes shown side by side, and the taker picking and executing.

The original RFQ launch date (Lyra V2 era) was not found.

### Cited Findings
- **10 Dec 2025, Nick Forster (CEO), "Derive's New RFQ Experience".**
  - The redesign was based on "dozens of user interviews", summed up as "Just show me the real price and let me act."
  - It shows cost, margin, Greeks and payoff together; buy and sell quotes appear side by side; the trader selects one.
  - It aims for competitive quotes "instantly". No timer or minimum size is mentioned.
  — [Derive Insights](https://insights.derive.xyz/derives-new-rfq-experience/)
- **9 Dec 2025, Dom Rom (CTO), "Anyone Can Be a Market Maker Now".** RFQ quoting is open to retail and desks, with rebates and rewards and whitelisting via Discord. Video posted 8 Dec 2025. — [Derive Insights](https://insights.derive.xyz/anyone-can-be-a-market-maker-now-on-derive-xyz/); [YouTube 4QyQ-gaCRl0](https://www.youtube.com/watch?v=4QyQ-gaCRl0)
- **17 Apr 2026, X.** "For larger trades, use RFQ to get direct quotes from MMs" (photo attached, 3.1k views). — [X @DeriveXYZ](https://x.com/DeriveXYZ/status/2044980765663064543)
- **26 May 2026.** "How to use RFQ direcly from book" and "How to use strategy builder" videos. — [YouTube OsZDxd3FU-M](https://www.youtube.com/watch?v=OsZDxd3FU-M); [YouTube HYvlqKly9bg](https://www.youtube.com/watch?v=HYvlqKly9bg)
- **22 Jul 2026.** "How to use the RFQ on Derive.xyz": quotes "in seconds", free, no obligation, works for single options. — [YouTube 5Kkn5-ZXYSQ](https://www.youtube.com/watch?v=5Kkn5-ZXYSQ)
- **Docs (current, v3 API).**
  - Default 30-minute window.
  - Taker flow: send_rfq, then poll_quotes or the best-quotes channel, then rfq_get_best_quote, then execute_quote. "The engine re-reads the RFQ and quote and settles the block atomically."
  - Makers can opt quotes into market-maker protection.
  — [Derive Docs: RFQ Trading](https://docs.derive.xyz/trading/rfq.md)
- **Third-party summary:** "Size and structure trades — spreads, straddles, custom multi-leg combinations — go out for private quotes". — [CryptoWinRate Derive review](https://www.cryptowinrate.com/derive-exchange-review)

### Inferences
- Derive's messaging has shifted. RFQ was first framed as the large/multi-leg venue (docs, X). From mid-2026 it is also a retail tool for **single legs** where the book looks empty ("An empty order book doesn't mean there's no liquidity"). That matches the Execution dropdown that switches by number of legs.

### Gaps
- No primary source found for when RFQ first launched on Lyra V2/Derive (searches for a Lyra V2 RFQ launch found nothing; a Gate.com explainer mentions "OTC trades with simple RFQ" without a date).
- No Discord or FAQ text was retrieved; Discord needs a login.
- I found no coverage from The Block, Blockworks, CoinDesk or The Defiant specifically on Derive's RFQ.
