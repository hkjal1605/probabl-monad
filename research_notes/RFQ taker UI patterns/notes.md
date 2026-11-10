# How trading platforms show an RFQ to the taker

Research date: 2026-11-10. Scope: the taker's screens only (the person who asked for quotes). Purpose: design a taker-side RFQ panel for a retail betting product where a request stays open 15 minutes, each quote has its own expiry (about 5 minutes), a maker can replace or withdraw a quote, and nothing fills until the user accepts one.

Product scope note received during the research: the request starts only when the user clicks "Place" (not on page load); the panel replaces the order ticket after that click; quotes are firm; each quote row has its own Accept and Decline; there is a Cancel order action.

## How to read the evidence labels

- **[direct]** I read the page text, source code or screenshot myself. Quotes are verbatim.
- **[fetch]** Read through the fetch tool, which returns a page summary. Quoted phrases came back in quotation marks but I did not see the raw page; re-check before reusing as verbatim copy.
- **[search]** Known only from a search-result summary. The page itself was blocked or unreachable from this machine.
- **[3P]** Third-party source (not the platform itself).
- **[inference]** My own reading or recommendation. Not sourced.

Reachability limits on this machine: okx.com, binance.com, help.kalshi.com, docs.polymarket.com and help.hashflow.com did not connect; support.deribit.com, support.uniswap.org, help.coinbase.com and support.bitso.com returned 403; matcha.xyz returned 429; the Sportico article is paywalled. OKX pages were read through a third-party mirror (okxapi.goquant.io) that serves the OKX article text.

## Synthesis

### Patterns that recur and are worth copying

1. **Acknowledge the request at once and say it costs nothing.** Derive shows a toast with a spinner, "Submitted RFQ: … Respond to quotes" [direct, screenshot]. HyperQuote: "submitting an RFQ is free and off-chain" [direct]. Derive's tutorial: "free to request, and there's no obligation to trade" [direct, earlier notes]. For this product: after "Place", the panel that replaces the ticket should open already in a "getting quotes" state, with one line that nothing is spent until a quote is accepted [inference].
2. **Give the wait an expected length, then change the message when it runs long.** Bybit: "You'll usually receive quotes within seconds, and no later than 10 minutes" [direct]. Deribit: quotes appear "A few seconds after the RFQ is submitted" [fetch]. AirSwap: "Fetching available prices..." [direct, source]. CoW Swap switches its step label to "Still searching" when its countdown reaches zero [direct, source]. For this product: "Usually a few seconds", then "Still looking" after a threshold you choose [inference].
3. **Keep a summary of what was asked above the quotes.** Paradigm's Details modal keeps the "Strategy Details (Buyer)" table above the quote ladder; Derive's row keeps Description and Amt next to the prices [direct, screenshots]. Since the panel replaces the ticket, pin the bet and stake at the top so each quote can be checked against it [inference].
4. **Two clocks, with different weight.** Request-level time is quiet text in a column: Derive "Expires 29m 52s", OKX "Time left" [direct, screenshot; fetch]. Quote-level time sits on the quote itself: OKX's receding bar behind each price, HyperQuote's per-card countdown, Bybit's 1 minute per quote [fetch; direct; direct]. For this product the quote clock drives action, so it belongs on the row; the 15-minute request clock can be small [inference].
5. **Countdown form by length.** Minutes: plain text ("29m 52s" on Derive; m:ss on AirSwap) [direct]. A bar that drains behind the price with the exact seconds on hover (OKX) [fetch]. A ring only for short fixed windows (CoW Swap's circular countdown, 10 s on mainnet and 7 s elsewhere) [direct, source]. For a 5-minute quote: mm:ss text plus a thin draining bar [inference].
6. **Escalate colour only near the end.** HyperQuote: grey above 30 s, amber below about 30 s, red with a pulsing border below about 10 s, then "Red text, dimmed card" when expired [direct]. A Matcha user complaint about a 30-second signing window says the pressure "encourages users to not actually read what they're signing" [fetch]. Keep the row calm for most of its life [inference].
7. **Best quote first, marked, with the rest one tap away.** HyperQuote sorts by best price and gives the top card a green "Best Price" badge [direct]. AirSwap has "Best quote" and "View all quotes" [direct, source]. Bybit shows best bid and ask, then "up to three of the most competitive quotes" behind an Expand icon [direct]. OKX shows the top quote and reveals "less competitive quotes" on demand [fetch]. Deribit shows only "one bid and one ask at any given moment" [fetch].
8. **Design for one quote first.** Most of the time there is one maker. Make the single quote the main object and add further quotes as compact rows under it. Do not show a "Best" badge when there is only one quote [inference].
9. **State the quote in the user's own terms.** Derive's interview finding: "Just show me the real price and let me act" [fetch]. HyperQuote cards show "You Pay", "You Receive" (in green) and the fee as its own line [direct]. For a bet: stake, payout if right, fee already inside the stake [inference from the product's fee-inclusive rule].
10. **Maker identity is secondary.** Paradigm shows short desk codes beside each level (MRIW, AKKUT, ROUT) [direct, screenshot]. HyperQuote shows a truncated address [direct]. Derive shows no maker at all on the taker row [direct, screenshot]. Deribit shows the maker only when the RFQ is disclosed [fetch]. A plain label is enough for retail [inference].
11. **A maker's new quote replaces its old one in the same row.** HyperQuote: "Quotes from the same maker replace any earlier quote for the same requestId, so you always see each maker's latest and best offer" [direct]. Paradigm's ladder has one row per desk [direct, screenshot]. Key rows by maker, update the numbers in place and mark the change briefly [inference for the marking].
12. **Expired quotes: dim, disable, label, and drop from the ranking.** HyperQuote: "Invalid or expired cards are dimmed and non-interactive" and "Expired or invalid quotes are excluded from the ranking" [direct]. OKX keeps the maker and price visible on old RFQs after expiry, cancel or failure [fetch].
13. **Confirm step where the quote lives for minutes; one step where it lives for seconds.** Bybit: a confirmation window with "the price, Maker and quantity", then Confirm or Cancel [direct]. OKX: pop-up, then "Confirm Execute" [fetch]. Derive: a dialog with Buy Price, Total Cost, Fees and one button "Buy to Open" [direct, screenshot]. Binance Convert (about 5 s) and Coinbase Prime (about 3 s) go straight from preview to convert/accept [search]. With 5-minute firm quotes a short confirm is affordable; an in-row confirm ("Accept" becomes "Confirm: $20 to win $X") avoids a modal [inference].
14. **Mirror the countdown in the confirm step and kill the button at expiry.** HyperQuote: the execute panel "includes a live countdown that mirrors the quote card timer"; at expiry the button "changes to 'Expired' with a destructive (red) style and becomes disabled" and a banner reads "Quote has expired — select a new quote to continue." [direct].
15. **Never re-price silently between click and fill.** Ledger's rule for partners: after the guarantee window "the quote becomes invalid and Ledger Wallet returns the user to the quote selection step"; the partner cannot re-rate at acceptance [fetch]. Uniswap shows "Price updated" with an "Accept" button [direct, strings]. Sportsbooks offer "Auto-Accept All", "Auto-Accept Favorable" or "Manually Accept" (theScore Bet) [fetch]. For this product: bind Accept to the quote id and price shown; if it was replaced, show old and new and ask again, or accept automatically only when the new price is better for the user [inference].
16. **When a fill fails, say that nothing was spent and what to do next.** HyperQuote: "Your tokens stay in your wallet. Select a different quote or request new ones." [direct]. CoW Swap: "The good news: Unlike on other exchanges, you won't be charged for this! Feel free to place a new order without worry." [direct, source]. AirSwap: "Price expired" / "Please try again" [direct, source].
17. **One clear cancel for the request, and handle the cancel-versus-fill race in words.** Derive: "Cancel" in the row's Actions [direct, screenshot]. Paradigm: a red "Cancel RFQ" button at the bottom of the Details modal [direct, screenshot]. Uniswap warns "Your swap could execute before cancellation is processed" [direct, strings]. CoW Swap has an explicit "cancellation_failed" state for an order that traded while being cancelled [direct, source].
18. **Per-quote Decline is not a pattern I found.** No platform studied documents a per-quote reject for the taker. The closest is Bybit's "click Cancel in the top right to reject a quote", which sits outside the quote rows, and the confirm window's "Cancel to discard" [direct]. Everywhere else the taker ignores a quote or cancels the whole request. If each row keeps Decline: make it visually lighter than Accept, define its effect (that row goes, the request stays open, the maker may quote again), and keep its wording and position clearly apart from "Cancel order" [inference].
19. **Declining the only quote must return to the waiting state, not look like the end.** [inference, follows from 18 and the one-maker case].
20. **End states carry a one-tap "ask again".** Derive: status pills "Filled" and "Cancelled", action "Resubmit" [direct, screenshot]. Bybit: "Resend" [direct]. OKX: "Reprice" and "Edit RFQ" [fetch]. HyperQuote: "New Trade" [direct]. OKX labels a done RFQ "Bought" or "Sold" with the execution price [fetch].
21. **Separate "nobody quoted" from "quotes came but none was accepted".** OKX: "Expired" means no maker quoted before expiry, with advice to simplify the request [fetch]. Kalshi: "Payout unavailable" means "a price for that specific combo is not available right now" [search]. AirSwap: "No quotes available" / "Try increasing size or another token" [direct, source]. Give a cause and a next step [inference].

### Pitfalls to avoid

22. **Layout jumping when quotes update.** Fixed-height rows, numbers updated in place, reserved space for the waiting, quoted and expired states, no re-sorting while a pointer or finger is on a row, and no new row inserted above the one being tapped [inference; the pro boards (Paradigm, OKX, Derive) all use fixed columns per RFQ row].
23. **Accepting a quote that changed under the finger.** Tie the tap to the quote id it was rendered with and reject a mismatch on the server with a clear "price changed" message; consider a brief non-interactive moment after a row updates [inference; Paradigm enforces "a three-second rule between trades" for a different reason, fetch].
24. **Trusting the client clock.** HyperQuote: the UI blocks fills at zero, "but network delays can cause on-chain expiry even if the UI shows time remaining" [direct]. AirSwap stops showing a quote 60 s before its real expiry so the user has time to take it and have it mined [direct, source]. Hashflow tells users to confirm in the wallet within 12–13 seconds [search]. Count down from server time and disable Accept once the time left is shorter than a signature and transaction normally take [inference].
25. **Treating "request expired" as an error.** CoW Swap frames it as bad news plus good news (nothing charged, place a new order) [direct, source]. Uniswap support: expired UniswapX swaps "incur no network costs" [search]. Use a neutral end state with "Ask again" [inference]. For accessibility, a quote timer falls under WCAG 2.2.1's real-time exception (the auction example), but do not announce every second to assistive technology [fetch for the exception; inference for the rest].

### Mobile

Public evidence is thin. Bybit: "Bybit RFQ is not available on the app at the moment" [direct]. Deribit: Block RFQ is available in the mobile app, no UI detail published [fetch]. Kalshi combos were mobile-first: one quoted payout, then "tap Continue, review your order, and submit the Combo" [3P, fetch]. AirSwap's widget shows one best quote with "View all quotes" behind a tap [direct, source]. For phones: one main quote card with Accept pinned at the bottom, other quotes collapsed, in a bottom sheet [inference].

## Platform notes

Numbering inside each platform follows the brief: (1) waiting for the first quote, (2) how quotes are listed, (3) how time is shown, (4) accept flow, (5) decline/cancel, (6) end states, (7) mobile.

### Paradigm (Unified Markets, RFQ)

Sources: help page https://paradigm.co/help/getting-started/unified-markets [direct, text and screenshots]; blog https://paradigm.co/blog/multi-dealer-rfq-launched [fetch]; https://paradigm.co/blog/paradigm-execution-best-practices [fetch]; API docs https://docs.paradigm.co/unified-markets/rfq-request-for-quotes [search]; SignalPlus guide https://signalplus.gitbook.io/signalplus-tutorial/how-to-use-paradigm-with-signalplus [3P, fetch].

1. Waiting state: not documented. The RFQ appears as a row on the Markets board; the "T" column says whether a market is an RFQ or an order book [direct].
2. Listing:
   - Board row columns: T, Product, Description, Qty, Bid (green), Mark, Ask (red), Qty, with a "Sell" pill on the left and a "Buy" pill on the right [direct, screenshot https://cdn.prod.website-files.com/5c5b68f5debc6d830fca7888/641965018ea2617088b07158_um-getting%20started-15.avif].
   - Expanded row: a ladder with one line per responding desk, best first, a short desk code beside each level (MRIW, AKKUT, ROUT), and a "Screen Bid / Screen Ask" line with the exchange's own book price for reference. Sell and Buy pills sit only on the top (best) line [direct, screenshot https://cdn.prod.website-files.com/5c5b68f5debc6d830fca7888/6419652372858f626901dcce_um-getting%20started-17.avif].
   - "For RFQ markets you have created, you are able to see the desk names of the counterparties who have responded with orders." [direct]
   - Anonymous RFQ: "received quotes will be anonymous. Only the desk you executed with will be revealed after the trade." At least 3 LPs must be selected [direct].
   - Multi-dealer launch post: takers "instantly execute on the Best Bid/Offer"; screenshot caption "See best pricing and aggregation from requested structures" [fetch].
3. Time: "Paradigm expires RFQs which do not trade after 5 minutes from creation" [search]. No countdown is visible in the help screenshots; the Details modal shows the creation time and date in its top-right corner [direct, screenshot]. Countdown form: not found.
4. Accept: "You can click 'Sell' or 'Buy' for an RFQ market you created on the Markets board." "Right-clicking on the RFQ market and clicking 'View Details' will pop up a more detailed & focused modal." [direct]. The Details modal shows Strategy, Mark, the "Strategy Details (Buyer)" leg table, the quote ladder with desk codes, and Sell/Buy pills on the best line [direct, screenshot https://cdn.prod.website-files.com/5c5b68f5debc6d830fca7888/64196535783c11463ea1549b_um-getting%20started-18.avif]. A separate confirmation step and the copy for a quote that changed at click: not found. Paradigm enforces "a three-second rule between trades on a firm level hardcoded into both our API & GUI" [fetch].
5. Cancel: a red "Cancel RFQ" button at the bottom of the Details modal [direct, screenshot]. No per-quote reject on the taker side.
6. End states: the RFQ History tab is a "Recap of all Filled, Canceled, Expired, and Traded Away RFQs that you created or were a counterparty too." [direct]. Re-send: not found.
7. Mobile: not found.

### Deribit Block RFQ

Sources: https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/ [fetch]; API walkthrough https://docs.deribit.com/articles/block-rfq-api-walkthrough [direct]; press release https://www.prnewswire.co.uk/news-releases/deribit-introduces-block-request-for-quote-rfq-interface-for-on-demand-liquidity-302394014.html [fetch]; SignalPlus front end https://signalplus.gitbook.io/signalplus-tutorial/how-to-use-deribit-rfq-on-signalplus [3P, fetch]. The main support article (https://support.deribit.com/hc/en-us/articles/25951371614621-Deribit-Block-RFQ) returned 403 and was not read.

1. Waiting: "After Block RFQ creation, there's a 5-second grace period during which the taker cannot see quotes or trade the Block RFQ." [direct]. Quotes appear "A few seconds after the RFQ is submitted" and then update in real time [fetch].
2. Listing: "The taker only sees one bid and one ask at any given moment" (the best of each). "A quote will only be shown to the taker if the full amount is available at that price." Several makers' smaller quotes can be combined into one displayed price. It is a blind auction: makers do not see each other. If the taker disclosed its identity, it sees the identity of the maker behind the best bid and ask [fetch].
3. Time: "If the taker has not chosen to trade after 5 minutes, the RFQ expires." [fetch]. Maker quotes can carry their own expiry; quotes are cancelled automatically when the RFQ is filled, expired or cancelled [direct]. Visual form of the countdown: not found.
4. Accept: "the most competitive bid and ask quotes are displayed to the taker, who has the option to accept and execute a trade"; "The taker is only permitted to trade the amount specified in the initial RFQ." [fetch]. Confirmation screen and changed-quote copy: not found. Through SignalPlus the taker clicks "Buy" or "Sell" in the "My RFQ" list or opens a details page [3P].
5. Cancel: the taker cancels its own RFQ; no per-quote reject [direct]. Deribit tracks a taker rating and says "Takers can improve their rating by cancelling RFQs promptly when they are no longer needed (before quotes arrive), rather than letting them expire." [direct]
6. End states: open, filled, cancelled ("The RFQ was canceled by the taker"), expired ("The RFQ expired without being filled") [direct].
7. Mobile: Block RFQ is available via "The website UI, The mobile app, The API"; no mobile UI detail [fetch].

### Derive (derive.xyz RFQ)

Sources: https://insights.derive.xyz/derives-new-rfq-experience/ [fetch for text; direct for screenshots https://storage.ghost.io/c/d4/b0/d4b0d8d6-38f7-4189-97b7-c417fe4c379b/content/images/2025/12/step_5.png and step_6.png]; docs https://docs.derive.xyz/trading/rfq.md [fetch]; earlier notes in this repo: research_notes/Derive options RFQ filling/app_user_flow.md.

1. Waiting: a toast at the bottom right with a spinner: "Submitted RFQ: Buy 0.1 BTC Call Spread Dec 26 $105000/110000" and under it "Respond to quotes" [direct, screenshot]. The request is a new top row in the RFQ table with status "Open". What the price cells show before the first quote: not shown in the screenshot (finished rows show dashes) [inference that open rows do too].
2. Listing: one table row per RFQ. Columns: Created, Status, Description, Amt, Sell, Mark, Buy, Expires, Delta, Actions. The open row shows a red "Sell $137.21" button, the mark "$156", and a green "$157.21 Buy" button: one price per side, no maker name, no list of individual quotes [direct, screenshot]. Blog: "Buy and sell quotes appear side-by-side. Choose the price you want." [fetch]. The docs expose a best-quote channel, which matches the one-price-per-side display [fetch].
3. Time: request-level only, as text in the Expires column: "29m 52s" [direct, screenshot]. Default validity is 30 minutes [fetch]. No per-quote timer is shown.
4. Accept: clicking Buy opens a dialog titled "Buy +0.05 BTC Call Spread Dec 26 $105000/110000" with Buy Price, Total Cost, Margin Required, Buying Power, Fees, Est. Rewards, Resulting Positions, a payoff chart (Max Loss, Break Even, Max Profit), mark price, book BBO and greeks, and a single button "Buy to Open" [direct, screenshot]. Docs: "private/execute_quote fills any valid quote. Check the quote's cost before you execute." Error names for a withdrawn quote are not documented [fetch].
5. Cancel: "Cancel" in the Actions column of the open row [direct, screenshot]. No per-quote reject.
6. End states: status pills "Filled" (green) and "Cancelled" (red); price cells become dashes; the action becomes "Resubmit" [direct, screenshot]. Statuses in the docs: open, filled, cancelled, expired [fetch].
7. Mobile: not found.

Design intent stated by Derive: after "dozens of user interviews" the theme was "Just show me the real price and let me act." [fetch]

### Bybit RFQ

Source: https://www.bybit.com/en/help-center/article/How-to-Get-Started-With-RFQ [direct].

1. Waiting: the RFQ sits in the "Active" tab of the RFQ Board ("Open RFQs that can receive quotes"). "You'll usually receive quotes within seconds, and no later than 10 minutes." Empty-state layout: not described.
2. Listing: "In the Active tab, you'll see the best bid and ask quotes for your RFQ. Click the Expand icon to view up to three of the most competitive quotes, then click Buy or Sell to accept a quote." "Details" shows more. The confirmation names the Maker.
3. Time: "After a quote is received, you have 1 minute to accept or cancel it before it expires." "Until you accept the quote, the liquidity provider may withdraw it at any time if they believe the market has changed significantly." Visual form: not described.
4. Accept: "A confirmation window will appear. Review the quote details, including the price, Maker and quantity, then click Confirm to execute the trade or click Cancel to discard." "Once you accept the quote, the trade will be executed immediately." Changed-quote copy: not found.
5. Decline/cancel: "You can also click Cancel in the top right to reject a quote". This is the only "reject a quote" wording found on any platform; it is in the top right, not on the quote row, and the article does not say whether it removes one quote or the whole RFQ.
6. End states: tabs Active, Filled, Canceled ("RFQs canceled by the initiator"), Expired ("RFQs that weren't matched in time and expired automatically"). "Once you accept a quote, the RFQ will move from Active to Filled." Under Filled: "RFQ Close" (opposite legs, same size) and "Resend to send the same RFQ again."
7. Mobile: "Bybit RFQ is not available on the app at the moment."

### OKX Liquid Marketplace (RFQ Builder and RFQ Board)

Sources (all read through the mirror okxapi.goquant.io, [fetch]): guide https://www.okx.com/learn/guide-to-block-trade-cryptocurrency-on-okx; help https://www.okx.com/help/managing-rfqs-on-the-rfq-board; help https://www.okx.com/help/managing-rfqs-on-the-rfq-board-creator. OKX Convert was not researched.

1. Waiting: after "Send RFQ" the user is redirected to the RFQ Board, which lists sent requests with creation date, time until expiry and status. If nobody quotes, the status becomes "Expired", with advice to split the request or submit hard legs separately.
2. Listing: once a maker quotes, the row shows the buy and sell prices and the spread between them in basis points. By default only the top quote is shown. With several quotes "a two-dotted line appears below the RFQ's spread"; selecting it (or the Maker name or Quantity) reveals the less competitive quotes, sorted "from most to least competitive for each direction", so the best ask maker can differ from the best bid maker. Makers do not know which side the taker will take.
3. Time: a "Time left" column counts down to the RFQ's automatic expiry (2 minutes; quote responses also 2 minutes). Per quote: "Under the Bid and Ask sections, a light gray bar recedes behind each quote's value. When the bar disappears, that quote expires." Hovering the bar shows a tooltip with the seconds remaining.
4. Accept: click "Buy" or "Sell" on the board; a confirmation dialog shows the leg price and execution side for each leg; click "Confirm Execute". Changed-quote copy: not found.
5. Cancel: "Kill RFQs" and "Kill selected" at the top right of the board; "View Details" has a "Kill" button for that RFQ. No per-quote reject for the taker.
6. End states: "Filled" on the board; old RFQs show "Bought" or "Sold" with the execution price, or Expired, Canceled, failed to execute. Old RFQs still show the market maker and the price quoted. "Reprice" resubmits an expired, cancelled or failed RFQ with the same components; "Edit RFQ" resends with a different quantity. Completed trades appear in History, in the reports centre and in an emailed recap.
7. Mobile: not found.

### Binance Convert

Sources: Binance FAQ https://www.binance.com/en-AE/support/faq/how-to-use-binance-convert-e8c7579382ea403aa4a4a6eec469659d and blog https://www.binance.com/en/blog/otc/binance-convert-making-crypto-transactions-quick-and-easy-for-all-421499824684901797 [search]; Binance Academy https://academy.binance.com/en/articles/what-is-binance-convert-and-how-to-use-it [search]; Binance.US https://support.binance.us/en/articles/9842901 [fetch].

- One quote from one counterparty. Flow: enter amount, "Preview Conversion", then "Convert" / "Confirm Conversion" [fetch for Binance.US labels].
- Timer: "You have 5 seconds to approve the quote shown to you and fulfill the deal. If the 5 seconds expire, click Refresh to get a new rate." [search]. The FAQ also says "the quote will automatically refresh after some time to reflect the latest market price"; the Academy article says the quote updates automatically every 8 seconds [search]. The sources disagree on the number and on manual versus automatic refresh.
- Visual form of the countdown, success screen and mobile layout: not found.

### Coinbase

Sources: Prime developer docs https://docs.cdp.coinbase.com/prime/concepts/trading/rfq [fetch]; Prime help https://help.coinbase.com/en/prime/trading-and-funding/rfq [search]; consumer Convert FAQ https://help.coinbase.com/en/coinbase/trading-and-funding/cryptocurrency-trading-pairs/convert-cryptocurrency-faq [search].

- Prime RFQ: one best price is returned (`best_price`, `order_total`, `quote_id`). Quotes are held for "a maximum of 2.5 seconds, starting when the market maker submits their quote" [fetch]. The help page reportedly says the hold for UI orders is 3 seconds and can be refreshed up to 20 times; if not accepted "a new quote would need to be requested" [search]. The two durations differ.
- Consumer Convert: a "Preview Convert" step exists and trades execute immediately and cannot be cancelled; no timer is documented [search].

### Kraken

No taker-side quote timer found for the consumer app. Only an error message: "We can't process quotes for this pair right now. Please try again later" (https://support.kraken.com/articles/360060101312) [search]. Kraken's embed API quotes last about 120 seconds [search].

### Hashflow

Source: https://help.hashflow.com/en/articles/5666288-tip-2-confirm-your-trade-as-soon-as-possible [search; the domain did not resolve here].

- Market makers "can only guarantee price quotes for a short time, which is why we regularly regenerate quotes on the terminal".
- Users are told to confirm in the wallet within 12–13 seconds; "if you wait too long to confirm, the quote will expire, and your transaction will fail".
- Countdown form and expired copy in the app: not found.

### 0x and Matcha

Sources: https://help.0x.org/articles/3310442497-understanding-0x-rfq-request-for-quote [fetch]; https://matcha.xyz/swap-tokens [search]; https://feedback.matcha.xyz/board/p/don-t-force-a-re-signing-every-30-seconds [fetch].

- 0x RFQ quotes are "only valid for a short window — roughly 60 seconds on mainnet"; integrators should "refresh quotes in-app about every 30 seconds so RFQ orders don't go stale"; "If a quote isn't signed and submitted before it expires, that RFQ order can revert."
- Matcha's swap page shows "Quote expires in 20s" next to a 0x RFQ route [search].
- User feedback (15 Sep 2023): users "have 30 seconds to confirm it in their wallet"; "this time window is extremely restrictive"; it "encourages users to not actually read what they're signing (bad!)". The proposed fix was to let users take longer and re-quote only if the price drifted past tolerance.
- Single aggregated quote; no maker list for the taker.

### CoW Swap (order waiting for solvers)

Sources (open-source frontend, develop branch) [direct]: https://github.com/cowprotocol/cowswap/blob/develop/apps/cowswap-frontend/src/modules/orderProgressBar/constants.ts; .../orderProgressBar/progressBarStateMachine.md; .../orderProgressBar/pure/steps/SolvingStep.tsx; .../orderProgressBar/pure/steps/ExpiredStep.tsx; release PR https://github.com/cowprotocol/cowswap/pull/8466 [fetch].

1. Waiting: a stepped progress view. Step titles: "Batching orders", "The competition has started", "Executing" ("The winner of the competition is now executing your order on-chain."), "Transaction completed". While solving: "CoW Swap solvers are scanning liquidity sources across DeFi. The one that finds you the best price wins!" Rotating tips fill the wait.
2. Listing: no quote list; the user sees stages, not bids. (A solver-competition result view exists after the auction.)
3. Time: a circular countdown (component `CircularCountdown`) of 10 s on mainnet and 7 s on other chains, "matching the solve deadlines per chain". Step styling: active is fully opaque with a spinner, the next step is at 0.6 opacity, done steps at 0.3; active is blue, cancelling is red. When the countdown reaches zero the state becomes "delayed" and the label changes to "Still searching": "There may be a network issue (such as a gas spike) that is delaying your order. You can wait for the issue to resolve or cancel the order". Release note: "Added an auction countdown to order progress, indicating when an order enters the auction."
4. Accept: none; the order was signed up front.
5. Cancel: an inline "cancel the order" link inside the delayed and price-change messages. Cancelling shows "Your order is being cancelled." The state machine has `cancellation_failed` for an order that traded while being cancelled.
6. End states: "Your order was successfully cancelled." Expired: "Your order expired", then "The bad news: Your order expired. This could be due to gas spikes, volatile prices, or problems with the network." and "The good news: Unlike on other exchanges, you won't be charged for this! Feel free to place a new order without worry." Price moved: label "Price change", "Uh oh! The market price has moved outside of your slippage tolerance. You can wait for prices to change or cancel the order". Retry: label "A new competition has started", "Something went wrong and your order couldn't be executed with this batch. But don't worry! CoW Swap is already holding another competition for your order."
7. Mobile: not checked.

### Uniswap and UniswapX

Sources: interface strings https://github.com/Uniswap/interface/blob/main/packages/uniswap/src/i18n/locales/source/en-US.json [direct]; support https://support.uniswap.org/hc/en-us/articles/17515426867213-Why-did-my-UniswapX-swap-expire [search].

- Price changed during review: "Price updated" with an "Accept" button. If a refresh fails: "Unable to refresh quote" / "Showing your previously accepted quote".
- Expiry: "Swap expired"; notification "{{input}} for {{output}} swap expired."; support text "Your swap expired before it could be filled. Try again or learn more". The UniswapX fill deadline is 1 minute and expired swaps "incur no network costs" [search].
- Cancel race: "Your swap could execute before cancellation is processed. Your network costs cannot be refunded. Do you wish to proceed?"
- Fallback: "Swap couldn't be completed with UniswapX. Try your swap again through the classic Uniswap API." Buttons "Try again", "Retry".
- Where the "Accept" button sits and whether it blocks the swap button until pressed: from my memory of the app, not sourced [inference].

### AirSwap (web app)

Sources (open-source frontend, develop branch) [direct]: strings https://github.com/airswap/airswap-web/blob/develop/public/locales/en/translation.json; timer https://github.com/airswap/airswap-web/blob/develop/src/components/Timer/Timer.tsx; refresh logic https://github.com/airswap/airswap-web/blob/develop/src/features/quotes/quotesHooks.ts; constants https://github.com/airswap/airswap-web/blob/develop/src/constants/configParams.ts. I read code and strings, not the running app, so layout is not confirmed.

1. Waiting: "Fetching available prices..." (also "Scanning peers on the network"). None: "No quotes available" with "Try increasing size or another token"; "No servers currently available"; on error "Something went wrong when requesting orders" / "Please refresh the page and try again".
2. Listing: one best quote in the swap widget ("Best quote"), with "Received quotes" and "View all quotes" for the rest; an "Available orders" list has sort buttons.
3. Time: "New quote in:" followed by an m:ss timer that ticks once a second. It counts to the quote's expiry minus a 60-second buffer, and at zero the app re-requests the best RFQ order by itself. The buffer comment: it "should be sufficient for a user to take an order and have a reasonable expectation that it will be mined within this buffer time." Two constants (marked unused) record the intended wait design: 5 s "to wait for quotes before presenting 'no peers' message" and 2 s "between receiving the first quote from a maker to let other quotes come in from other makers before displaying a price."
4. Accept: a "Take" button, then wallet prompts ("Waiting for wallet", "Accept on your wallet to proceed"). Failure copy: "Price expired" / "Please try again"; "Swap expired" / "Please try again"; "Error submitting swap" / "Please try again".
5. Cancel: applies to the user's own resting orders ("Are you sure you want to cancel?"); no per-quote reject.
6. End states: "Swap complete", "New swap".
7. Mobile: not checked.

### HyperQuote (not on the original list; included because its docs describe a taker quote panel in the most detail)

A small RFQ swap app on HyperEVM. Sources [direct], pages dated 20 March 2026: https://docs.hyperquote.xyz/trading/requesting-a-quote; https://docs.hyperquote.xyz/trading/quote-comparison; https://docs.hyperquote.xyz/trading/executing-a-fill; https://docs.hyperquote.xyz/getting-started/your-first-trade; https://docs.hyperquote.xyz/faq/taker-faq; https://docs.hyperquote.xyz/risk/quote-expiry-risk. These are docs, not screenshots.

1. Waiting: after "Request Quotes", "A countdown timer appears showing the remaining TTL." "Your wallet does not sign anything yet — submitting an RFQ is free and off-chain." "The UI shows a loading state while waiting for quotes and displays each quote as it arrives. You do not need to wait for all quotes before selecting one." "After submitting an RFQ, quotes typically arrive within a few seconds."
2. Listing: every quote is a card. Fields: maker address in truncated form; "You Pay"; "You Receive" (in green); Fee as a separate line; Rate; a "vs AMM Baseline" row with a green "+X.XX%" when the quote beats the alternative; expiry countdown; a validation badge. "Quotes are sorted by best price"; "The top quote receives a green Best Price badge in the upper-right corner of its card." "Quotes from the same maker replace any earlier quote for the same requestId, so you always see each maker's latest and best offer."
3. Time: request-level TTL countdown (default 30 s on one page and 60 s on another; range 10 s to 24 h) plus a live countdown per card. Colour steps: "Normal: Grey text, More than 30 seconds remaining"; "Expiring soon: Amber text, Less than ~30 seconds remaining"; "Urgent: Red text, pulsing border, Less than ~10 seconds remaining"; "Expired: Red text, dimmed card". Badges include "Validating…", "Valid", "Expiring Soon", "Expired". "Invalid or expired cards are dimmed and non-interactive." "Expired or invalid quotes are excluded from the ranking."
4. Accept: click a card; it "receives a blue highlight and a 'Selected' indicator" and an Execute Trade panel opens with You Pay, You Receive and the constraint, then Approve and "Fill Quote". "The execution panel includes a live countdown that mirrors the quote card timer." If the quote expires there: "The fill button changes to 'Expired' with a destructive (red) style and becomes disabled"; "A red banner reads 'Quote has expired — select a new quote to continue.'"; "The panel border turns red". Panel states: "Select a quote to execute", "Waiting for approval…", "Token approved", "Confirming transaction…", "Trade Executed Successfully". Late fill: "The transaction reverts. Your tokens stay in your wallet. Select a different quote or request new ones." Warning: "The UI also blocks fill attempts client-side when the countdown expires, but network delays can cause on-chain expiry even if the UI shows time remaining."
5. Decline/cancel: no per-quote reject. The docs conflict on cancelling the request: one page says "Use the cancel button in the UI to reclaim a slot without waiting for the TTL to elapse"; the FAQ says an RFQ "cannot be 'cancelled' in the traditional sense" and "you can simply ignore any quotes you receive". "You are never obligated to execute a quote you receive."
6. End states: success banner with You Paid / You Received, a price-improvement callout, "View Transaction" and a "New Trade" button. No quotes: a "no quotes received" message; "You are not charged anything for an RFQ that receives no quotes. You can retry, adjust the trade parameters … or use an alternative venue".
7. Mobile: not described.

### Kalshi combos (retail betting priced by RFQ)

Sources: Kalshi help https://help.kalshi.com/markets/combos [search]; Action Network guide https://www.actionnetwork.com/education/kalshi-combos [3P, fetch]; Sportico explainer https://www.sportico.com/business/sports-betting/2025/kalshi-parlay-combo-rfq-explainer-1234877038/ [search, paywalled]; earlier notes in this repo: research_notes/RFQ execution industry practice/derivatives_venues.md.

- The user never sees a quote list. The builder shows one payout for the chosen combo: Kalshi "will provide a live quoted price for the Combo"; in one example a $10 position was quoted a $39.45 return in "1-2 seconds" [3P].
- Then "tap Continue, review your order, and submit the Combo" [3P].
- No quote: the builder shows "Payout unavailable", which "means a price for that specific combo is not available right now"; the help page suggests logging out and in, trying a different combo, or checking back closer to the event [search].
- Price movement: "quotes are generated live, which can sometimes lead to brief delays. Quoted prices may change between viewing and execution." "If no market participant responds to the RFQ with a quote, the combo order will not fill." [search]. Sportico: if the user waits before confirming, the line can move either way [search].
- Combos launched on mobile first and are now on desktop [3P].
- Countdown, changed-price prompt and exact button copy: not found.

### Polymarket combos

Docs only, via search summaries (https://docs.polymarket.com/trading/combos/overview, https://docs.polymarket.com/trading/combos/requesters, https://docs.polymarket.com/trading/combos/builders) [search]. The gateway returns one winning quote; the user has a short acceptance window (5 seconds on one page, 10 on another); builders are told to read the deadline from `result.quote.expiresAt` and not hardcode it. No description of the user-facing screen was found.

### Retail patterns outside trading

- **Sportsbook bet slip** (theScore Bet, https://thescorebethelp.zendesk.com/hc/en-us/articles/13873581540109-Odds-and-Line-Changes) [fetch]: a setting with three choices, "Auto-Accept All", "Auto-Accept Favorable", "Manually Accept". When the odds change the user "will be asked to accept"; without accepting they "will not be able to proceed with placing a bet" and the bet stays in the slip. ESPN Bet words its option "Auto accept favorable odds and line changes" [search].
- **Wise guaranteed rate** (https://wise.com/help/articles/2448203/whats-a-guaranteed-rate) [fetch]: "This duration ranges from 2–48 hours depending on the currency you're sending." "When you set up your transfer, we'll show you exactly how long your rate is locked." "If you spend more than 30 minutes on any step during setup, the rate will refresh." If the money arrives late: "we'll use the live mid-market rate at the time we receive your funds."
- **Ledger swap rule for partners** (https://developers.ledger.com/docs/ledger-live/exchange/swap/flow/edge-cases) [fetch]: a fixed quote must hold at least 60 seconds; if the user confirms later "the quote becomes invalid and Ledger Wallet returns the user to the quote selection step"; no silent re-rating.
- **Ticketmaster checkout** (https://help.ticketmaster.com.au/hc/en-au/articles/360008668033-Why-is-there-a-time-limit-for-checking-out) [search]: "The timer at the top of every page in the checkout process shows you how long you have to complete your purchase before we release your tickets for others to buy." At zero: "Sorry… time's up" and the cart is emptied.
- **Bitso app** (https://support.bitso.com/hc/en-us/articles/20281044423188-How-can-I-buy-and-sell-crypto-through-my-Bitso-App) [search]: the quote refreshes after 20 seconds or when the amount changes.
- **Airline fare holds** [search]: only policy text was found (United FareLock 3 or 7 days; flynas Price Lock 48 hours, "Once the hold time expires without payment, the booking will be cancelled automatically", https://www.flynas.com/en-bh/booking-flynas/price-lock). No description of how the remaining time is displayed.
- **Revolut**: no evidence of a rate countdown or lock on the exchange screen was found.
- **Accessibility** (https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html) [fetch]: WCAG 2.2.1 exempts a time limit that "is a required part of a real-time event" and gives the auction as its example, so a quote expiry need not be extendable; the same page recommends warning users before time runs out where limits can be extended.

## What was not found

- A per-quote "reject" or "decline" control on any taker screen.
- The visual form of the countdown on Paradigm, Deribit, Bybit and Binance.
- Error copy for "the quote changed or was withdrawn between click and fill" on Paradigm, Deribit, Derive, Bybit and OKX.
- Any published mobile layout for a multi-quote RFQ screen.
- Taker screens for Kraken, Revolut and airline fare holds with a visible timer.
- Demo videos were not viewed in this pass. Derive's taker tutorial video could not be downloaded in the earlier research either (see app_user_flow.md).
