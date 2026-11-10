# RFQ maker board and public trade history: UI patterns

Researched 2026-11-10, about 20 minutes of web research. Scope: (1) a public "Open orders" board where any signed-in user can quote someone else's world order, (2) a public table of every trade, (3) how to show long, multi-part bet names in table rows.

Companion notes already in this repo (taker side, not repeated here): `research_notes/RFQ taker UI patterns/notes.md`, `research_notes/Derive options RFQ filling/app_user_flow.md`.

## How to read the evidence labels

- **[direct]** I read the page text, viewed the screenshot, or read the API response myself in this session.
- **[fetch]** Read through a fetch tool that summarises the page. Quoted phrases are as the tool returned them and may differ slightly from the page.
- **[search]** Only a search-result summary was seen; the page itself was not read.
- **[3P]** Third-party source, not the platform's own documentation.
- **[prior notes]** Taken from earlier notes in this repo, with the source those notes give.
- **[recollection]** My memory of the product. Not verified in this session. Treat as a lead, not as evidence.
- **[inference]** My conclusion or recommendation.

Coverage is uneven. Paradigm (screenshots viewed), Derive (video frames in prior notes) and OKX (help text) are well evidenced. Betfair is evidenced through a Betfair-education page hosted by Sporting Life/Timeform, not Betfair's own help centre. Sportsbook "My Bets" screens, Polymarket's activity feed, Kalshi's and Limitless's trade feeds and the Jira/Linear/GitHub tables could not be sourced; see "What was not found".

---

## Synthesis

### Screen 1: open orders board for makers

**What the board row shows**

1. Every maker board found is a table with one row per request and the quote action in the row. Paradigm: columns T (RFQ or OB), Product, Description, a counterparty tag, Qty, Bid, Mark, Ask, Qty, then Last, My Bid, My Ask, Code, Instrument; an RFQ row the maker has not answered shows a "Quote" pill sitting in the My Bid / My Ask cells [direct, screenshots]. Derive: Created, Legs, Qty, Filled, Fill Price, Wallet, Subaccount, Status [prior notes, video frames]. OKX: named columns include "Time left", "Spread (bps)" and "Action" [fetch via mirror].
2. The maker's own live quote is shown in the same row as the request, not in a separate place. Paradigm has "My Bid" and "My Ask" columns [direct]; OKX shows the maker's bid and ask in the row with a pencil icon to edit and a cross to cancel [fetch]. [inference] Add a "Your quote" column to the board; it shows "Quote" when empty and the maker's payout offer plus edit and cancel when live.
3. Requester identity is shown in a short form, or hidden. Paradigm shows a desk code ("ARM") or an "ANON" tag with a struck-through-eye icon [direct]; Derive shows a truncated wallet and subaccount [prior notes]; Deribit shows anonymous takers' quality only as a bucketed rating [fetch].
4. Time left is a column on the row. OKX: a countdown in "Time left" for both the RFQ and the maker's quote, and a light grey bar receding behind each quote [fetch; prior notes]. Derive: "Expires: 29m 36s" on the selected request [prior notes]. HyperQuote (taker side) steps the colour: grey above 30 s, amber below about 30 s, red and pulsing below about 10 s, dimmed when expired [prior notes].
5. [inference] Suggested columns for worlds, left to right: Time left · Bet (two-line summary, see "Long titles") · Product (All-in / Money-back) · Taker pays · Best payout so far (or "No quotes yet") · Your quote (button, or your live offer with edit/cancel). Keep numbers right-aligned and in tabular figures so countdowns and amounts do not wobble.

**Opening the quote ticket**

6. The ticket opens from the row by a "Quote" button (Paradigm, OKX) or by clicking the row's price cells (Paradigm) [direct; fetch]. Paradigm and OKX use a modal or pop-up [direct; fetch]. Derive keeps a ticket panel for the selected request beside the list [prior notes].
7. The ticket restates the request before asking for a price. Paradigm's "Quote" modal shows a strategy chip ("Call 30 Jun 23 100000"), the mark, and a table titled "Strategy Details (Buyer)" with Leg, Product, Action, Instrument, Expiry, Strike, Leg Price, Ratio, Qty [direct]. The title states whose point of view the table is written from. [inference] Do the same: head the ticket "Their bet" in the taker's words, then "Your side" in the maker's.
8. The ticket shows a reference price next to the input. Paradigm: Mark per leg and "Screen Bid / Screen Ask" (the exchange's own book) under the table [direct]. Derive: index price, mark price and a "Use Mark" shortcut on the price field [prior notes]. SignalPlus's Paradigm client: Mark Price, its own model price and Screen Price [3P fetch]. [inference] Show the vault's current payout (or the model chance) as the reference, with a one-tap "match" or "beat by 1%".
9. Whether a maker sees competing quotes differs by venue. Deribit is blind: "makers can see their own quotes, but not the quotes of other makers" [fetch]. Paradigm's board has Bid and Ask columns on RFQ rows, which implies responders see the best quote, but the help page does not say so [direct for columns; inference for visibility]. [inference] For retail makers, show the best payout so far without the maker's name; a number to beat is the simplest prompt, and firm quotes with one winner make it fair.

**Entering the price**

10. Professional venues take a price per unit, single or two-sided ("Two-Way 0.255 / 0.299"), or per leg [direct, Paradigm; fetch, OKX]. Not suitable for retail as is.
11. Betfair's lay slip takes the other person's stake and shows the maker's risk. Three fields: "Backer's Odds", "Backer's Stake" ("how much of the backer's stake you are willing to lay", also "how much you want to win from your lay bet") and "Liability" ("how much you need in order to place the bet, because you are playing the part of the bookmaker") [fetch, Betfair Exchange education on Sporting Life]. One third-party summary says Matchbook lets the user type either the stake or the liability [search, 3P].
12. [inference] In worlds the taker's stake is fixed, so one number decides everything. Use one input, "They get $__ if they're right", with three linked read-outs that update as you type: "You risk $X" (payout minus their stake), "You win $Y" (their stake, less fee) and the chance that payout implies. Let the maker type into "You risk" instead if they prefer; both fields edit the same number.
13. One live quote per maker per request; a new quote replaces the old one. Kalshi docs: "A new quote on the same RFQ replaces the maker's previous quote" [search]. SignalPlus on Paradigm: one bid and one ask per RFQ, "a new quote overwrites the old one" [3P fetch]. HyperQuote the same [prior notes]. Gemini's combos RFQ is the exception: "The quote is immutable — there is no revise" [search].

**Making the liability obvious**

14. Betfair's wording for liability: "the amount that, in your worst-case scenario, you could lose"; worked example "a liability of £25 for the chance to win £10"; and the role, "you are playing the part of the bookmaker" [fetch]. Third-party guides add that the exchange reserves the full liability when the bet is placed and refuses the bet if the balance is short [search, 3P].
15. [inference] Wording for the ticket: "You're taking the other side of this bet." Then two outcome lines of equal weight: "If they're right: you pay $58.40 (you lose $38.40)" and "If they're wrong: you keep their $20". Then "We hold $38.40 from your balance until the bet settles." The button repeats the risk: "Offer quote · risk $38.40 to win $20". If Money-back returns the taker's stake when the "if" events do not happen, add a third line: "If the conditions don't happen: bet is off, your $38.40 comes back."
16. [inference] Validate before sending: balance covers the risk (Betfair blocks otherwise), payout is above the taker's stake, and warn when the offer is far from the reference in the maker's disfavour (a typed 584 for 58.4). Derive has a "Review" step before "Send Quote" [prior notes]; Paradigm and OKX submit in one click [direct; fetch]. A firm quote that locks money deserves the review step.

**Seeing and cancelling live quotes**

17. Cancel sits on the quote and in bulk. OKX: a cross icon by each bid or ask, "Kill quotes" at the top of the board, and "Kill selected" once rows are ticked [fetch]. Paradigm: "Kill" in the Actions column of Open Orders, plus "Kill All", "Kill Desk Bids", "Kill Desk Asks" [direct]. SignalPlus: an "x" in the My Bid / My Ask column, or Kill Bids / Kill Asks / Kill All [3P fetch].
18. [inference] Give the maker a "My quotes" filter or tab on the same board (live quotes first), with "Cancel" on each row and "Cancel all" at the top. Say plainly that a quote can be taken at any moment until it is cancelled or the order closes.

**Rows arriving and closing**

19. Closed requests stay visible with an end state. OKX: executed quotes show "Bought" or "Sold" with the price; expired, failed or cancelled requests stay on the board with the maker's last quote [fetch]. Derive: Open, Filled, Expired, Cancelled statuses in one list, with filters [prior notes]. Paradigm moves them to an "RFQ History" tab whose statuses are "Filled, Canceled, Expired, and Traded Away" [direct]. "Traded Away" is the maker-side word for "the taker chose someone else".
20. No source describes how these boards animate a new or closing row. General guidance (web.dev, layout shift): "Dynamically injected content closer to the top of the viewport usually causes greater layout shifts"; "Seamlessly load the content offscreen and overlay a notice to the user that it's available"; replace content "within a fixed size container"; animate with `transform` [fetch].
21. [inference] Rules for a board that does not jump: fixed row height (two-line bet cell); a stable sort that the user controls (default: least time left first); new orders slot in only when the user is at the top and has no ticket open, otherwise a "3 new orders" pill adds them on tap; a closed row turns grey in place, shows "Filled", "Expired" or "Cancelled" for a few seconds, then leaves on the next user action or goes to a "Closed" filter; the row with an open ticket never moves or disappears, and the ticket itself shows "This order was filled by another quote".
22. Empty states: the only maker-side one found is Derive's access screen, "You are not currently set up to respond to RFQs…" [prior notes]. PatternFly says an always-open detail pane with nothing selected should show an empty state that tells the user to pick an item [fetch]. [inference] Board empty: "No open orders right now. New orders appear here and stay open for 15 minutes." with the trade table still visible below.

### Screen 2: public trade history

23. Paradigm's Trade Tape columns: Time (HH:MM), Auction (RFQ or OB), Product, Description, Qty, Price, Side (BUY green, SELL red), Quote Currency, Date (as its own column, "18 Mar 23"). No counterparty names [direct, screenshot].
24. Hyperliquid's public trade feed carries, per trade: coin, side, price, size, time, transaction hash and both users' addresses [direct, live API response]. In the app the market trades panel shows Price, Size and Time with a link to the explorer [recollection].
25. Derive's maker board identifies users by truncated wallet and subaccount [prior notes]. Deribit publishes block RFQ trades on a public channel; its contents were not described [fetch].
26. Kalshi's public trade data has no trader identity ("Trade data shows aggregate activity but not individual trader identities") [search, 3P]. Betfair and Smarkets: no public per-user trade feed was found [not found].
27. Polymarket: a third-party API document says each trade in the global activity feed "includes a wallet address and side" [search, 3P]. The on-site feed shows avatar, username, "bought" or "sold", outcome, price in cents, dollar amount and a relative time [recollection; the page and the official API docs could not be fetched].
28. [inference] Columns for worlds: Time · Bet (same two-line cell as the board) · Product · Paid · Payout if right (with implied chance) · Taker · Maker ("Vault" badge when it is ours) · Result (Open, Won, Lost, Refunded) · transaction link icon. Time as relative under 24 hours ("4m ago") with the exact local time on hover or tap, then a date; do not tick a clock in every row. Identify users by avatar plus short address, linking to the profile. The row opens the same detail view as the board, read-only.

### Long, multi-part names in rows

29. Professional venues never print the full instrument sentence in a row. They print a strategy shorthand plus the key numbers: "CSpd 29 Jul 22 3500/4000", "RRPut 29 Sep 23 32000/40000", "CFly 5 Aug 22 27000/29000/31000" [direct, Paradigm]. Derive does the same in words: "BTC Call Spread Dec 26 $105000/110000" [prior notes].
30. Custom multi-leg rows use two lines, one leg per line, and then cut off: "Cstm +1 Call 24 Mar 23 35000 / +1 Put 24 Mar 23 22000…" [direct, Paradigm trade tape]. The full leg table lives in the detail modal [direct].
31. Kalshi's featured combos use a headline in money terms and "first leg + N more": "Combo NBA: $10 Pays $20,000" and "NOP Pelicans to win by over 10.5 against MIN Timberwolves + 5 more" [3P fetch, Action Network].
32. Design-system rules found: a 64 px row is "only recommended if your data is expected to have 2 lines of content in a single row"; expansion is for "supplementary information"; "When the content in the expanded area feels cramped, consider taking the user to a dedicated page" (Carbon) [fetch]. Truncated text "should always include a tooltip on hover"; never truncate column headings (PatternFly) [fetch]. Hover tooltips do not work on touch (Maersk design system) [search]. SAP Fiori allows wrap-then-truncate at a line limit [search].
33. NN/g on showing one record from a table: a modal "will cover adjacent records"; an accordion keeps context but "users don't tend to clean up after themselves"; a non-modal side panel "allows for the full display (and editing) of a single record" while the table stays visible. The first column should be a "human-readable record identifier" [fetch].
34. Phones: PatternFly's primary-detail pattern shows "1 component at a time"; the detail slides in over the full viewport with a clear way back [fetch]. NN/g: bottom sheets suit short tasks where the background still matters; give a visible Close button, support Back, do not stack sheets [fetch]. NN/g on mobile tables: group attributes into accordions or let users choose what to see; sideways scrolling is only "somewhat acceptable" [fetch].
35. [inference] Recommendation for the bet cell, two fixed lines:
    - Line 1, the thing being bet on, ticker first: "QQQ below $640 · Dec 11". With no stock, the first event's title and a YES/NO chip.
    - Line 2, muted, the conditions: "If Fed hikes rates in 2026 · YES" then a "+1 more" chip. One condition title, cut with an ellipsis at the end; the count is never cut.
    - Never rely on a tooltip to reveal the rest; the row click opens the detail, which works on touch.
36. [inference] Row versus detail. Row: time left, the two-line summary, product, taker pays, best payout, your quote. Detail: the full sentence, every event with its full title, side and link, the stock, target and date, all quotes so far, the reference payout, and the quote form.
37. [inference] Container for the ticket. Desktop: a non-modal right side panel, about a third of the width, with the selected row highlighted; the board stays live and readable beside it, and clicking another row swaps the panel's content. Not inline expansion (it changes row heights in a live table and pushes rows down, the exact jump to avoid) and not a centred modal (it hides the other orders and their timers). Phone: the board becomes a list of cards, and the ticket is a full-height bottom sheet or full-screen page with a visible close button and Back support, matching the bottom sheets worlds already uses.

---

## Platform notes

### Paradigm (Unified Markets)

Source: https://paradigm.co/help/getting-started/unified-markets. Page text read directly; six screenshots downloaded and viewed.

- **Markets board** [direct, screenshot https://cdn.prod.website-files.com/5c5b68f5debc6d830fca7888/6419648bc46f375028d88714_um-getting%20started-10.avif]. Columns: T, Product, Description, (counterparty tag), Qty, Bid, Mark, Ask, Qty. Sections "Pinned" and "All". The "T" column reads RFQ or OB. RFQ rows carry a tag: a desk code ("ARM") or "ANON" with a struck-through-eye icon. An unquoted RFQ shows "–" in Bid and Ask with the Mark between them. Order-book rows show bid in green and ask in red, a small difference figure under each, and "Sell" / "Buy" pills.
- Text: "For RFQ markets you are a counterparty to, you are able to see the desk name of the RFQ creator if disclosed, else you will see 'Anon'" [direct].
- **Responding** [direct]. "You can respond to an RFQ market sent to you by either click on the Price fields or the 'Quote' button on the Markets board." Scrolled right, the board shows Last, Qty, My Bid, My Ask, Qty, Code, Instrument; the RFQ row has a "Quote" pill in the My Bid / My Ask cells [screenshot https://cdn.prod.website-files.com/5c5b68f5debc6d830fca7888/641964e2c46f37c7f2d88c52_um-getting%20started-13.avif].
- **Quote modal** [direct, screenshot https://cdn.prod.website-files.com/5c5b68f5debc6d830fca7888/641964f3ea0646857787a3ac_um-getting%20started-14.avif]. Title "Quote". Top left: "DO - BTC Option - European / Deribit (DBT)". Centre: "Strategy" chip "Call 30 Jun 23 100000" and "Mark 0.2576". Table "Strategy Details (Buyer)": Leg, Product, Action (BUY), Instrument, Expiry, Strike, Leg Price, Ratio, Qty ("100" with "100 BTC" beneath), then Mark, then "Leg Prices" Bid and Ask. Under it "Screen Bid (Unhedged)" and "Screen Ask (Unhedged)" with price and size. Right rail: a "Leg Prices | Two-Way" switch, an Account selector with "Edit Default", a "Two-Way" field reading "0.255 / 0.299", and "Submit Quote". The board stays dimly visible behind the modal.
- Text: "You can input a Buy and/or Sell price in the 'Two-Way' field for single-legged markets." "You can input leg prices … in the 'Leg Prices' columns of the 'Strategy Details' table." "If you're responding to anonymous RFQ, you are also anonymous to the Taker." [direct]
- **Open Orders tab** [direct, screenshot https://cdn.prod.website-files.com/5c5b68f5debc6d830fca7888/6419643aea06464a7e87998f_um-getting%20started-4.avif]. Columns: Time, Auction, Product, Description, Actions ("Kill"), Qty, Price, Side, Completed, Remaining, Order ID. "Recap of all open Orders across both RFQ & OB."
- **Kill buttons** [fetch]: "Kill All", "Kill Desk Bids", "Kill Desk Asks".
- **RFQ History tab** [direct, screenshot https://cdn.prod.website-files.com/5c5b68f5debc6d830fca7888/6419641d8f2751916b5861da_um-getting%20started-3.avif]. Columns: Time, Status, Product, Description, Qty, Price, Code, Instrument, Base Currency. "Recap of all Filled, Canceled, Expired, and Traded Away RFQs that you created or were a counterparty too."
- **Trade Tape tab** [direct, screenshot https://cdn.prod.website-files.com/5c5b68f5debc6d830fca7888/64196412354581d3a78374d8_um-getting%20started-2.avif]. Columns: Time, Auction, Product, Description, Qty, Price, Side, Quote Currency, Date. Example row: "21:38 · RFQ · BTC Option - DBT · Cstm +1 Call 24 Mar 23 35000 / +1 Put 24 Mar 23 22000… · 50.0 · 0.0130 · SELL · BTC · 18 Mar 23". "Recap of all trades successfully settled via Unified Markets."
- Request lifetime: "Paradigm expires RFQs which do not trade after 5 minutes from creation" [prior notes, from Paradigm API docs via search]. No countdown is visible in the screenshots.
- SignalPlus's client for Paradigm [3P fetch, https://signalplus.gitbook.io/signalplus-tutorial/how-to-use-paradigm-with-signalplus]: the maker gets a push notification; the pop-up shows counterparty or anonymous, exchange, instruments, ratio, quantity, Mark Price, SP Model Price and Screen Price; "Submit Two-Way Price"; a bid cannot be above the ask; one bid and one ask per RFQ and a new quote overwrites the old; cancel by the "x" in My Bid / My Ask, by "Kill Bids", "Kill Asks", "Kill All", or from History. Helper tools "Quote by Leg" and "Quote by Spread" build a price from a baseline (Mark, model, Mid, best bid, best ask) plus an offset.
- Not found: whether responders see other responders' quotes; how the board shows a newly arrived RFQ; any phone layout.

### Derive (derive.xyz RFQ Maker page)

Sources: video "Anyone Can Be a Market Maker Now On Derive.XYZ", https://www.youtube.com/watch?v=4QyQ-gaCRl0 [prior notes, frames viewed in an earlier session]; blog https://insights.derive.xyz/anyone-can-be-a-market-maker-now-on-derive-xyz/ [fetch]; docs https://docs.derive.xyz/trading/rfq.md [prior notes].

- Board columns: Created, Legs, Qty, Filled, Fill Price, Wallet, Subaccount, Status. Statuses Open, Filled, Expired, Cancelled. Filters "All subaccounts" and "All currencies" [prior notes].
- Selected request panel: "Long Call · Dec 4 21:03 · Open · Expires: 29m 36s · +1 HYPE $50 Call, Jan 30"; Buy/Sell; Quantity; a Price field with "Use Mark"; "Review" and "Send Quote" buttons; index price and mark price shown [prior notes].
- Around it: "BBO, greeks, payoff charts, order book, and live trades" [fetch, blog].
- Access screen for users not yet approved: "You are not currently set up to respond to RFQs. Please contact Support (bottom left) in case you do not want to use Discord." [prior notes]
- Request window: 30 minutes by default [prior notes].
- Not found: how the maker sees and cancels live quotes on this page; whether makers see each other's quotes; a phone layout. The blog has no interface screenshots.

### OKX Liquid Marketplace (maker side of the RFQ Board)

Source: https://www.okx.com/help/quoting-rfqs-on-the-rfq-board-maker, read through the mirror https://okxapi.goquant.io/help/quoting-rfqs-on-the-rfq-board-maker because okx.com did not load [fetch via mirror].

- Received RFQs appear on the RFQ Board with status "Active" and a "Time left" countdown.
- "Quote" button opens a pop-up; enter a bid and an ask for each leg, or use the "Two-way" tab for one combined price (only for predefined strategies with two or more legs). An "Anonymous" box hides the maker's name.
- The maker sets a time limit on the quote; after "Submit quote" the "Time left" column counts it down.
- Edit: pencil icon under "Spread (bps)" reopens the same pop-up.
- Cancel: the cross icon next to a bid or ask; "Kill quotes" at the top of the board; or tick boxes in the "Action" column and press "Kill selected".
- End states: "Bought" or "Sold" label with the execution price; expired, failed or cancelled quotes stay on the board showing the last quoted prices.
- A maker's settings ("Maker's quote preferences") filter which pairs, instrument types and sizes they receive.
- From the taker-side help [prior notes]: RFQ and quote lifetimes of 2 minutes; "a light gray bar recedes behind each quote's value"; makers do not know which side the taker will take.

### Deribit Block RFQ

Sources: https://insights.deribit.com/education/new-deribit-block-rfq-feature-launches/ [fetch]; https://docs.deribit.com/articles/block-rfq-api-walkthrough [fetch]; SignalPlus client https://signalplus.gitbook.io/signalplus-tutorial/how-to-use-deribit-rfq-on-signalplus [3P fetch]. The main support article (https://support.deribit.com/hc/en-us/articles/25951371614621-Deribit-Block-RFQ) returned 403 again.

- Blind auction: "makers can see their own quotes, but not the quotes of other makers" [fetch].
- Makers answer "with either single or double-sided quotes for any amount above the minimum block amount", choosing the multi-maker pool or an All-Or-None quote [fetch].
- "If the taker has not chosen to trade after 5 minutes, the RFQ expires." [fetch]
- Makers see a bucketed taker rating ("1-2", "2-5", "5-20", "20+") when deciding whether to quote [fetch]. A `disclosed` flag decides whether names are shown.
- Makers can add, edit, cancel one, or cancel all quotes; quotes are cancelled automatically when the RFQ is filled, expires or is cancelled [fetch].
- States: open, filled, cancelled, expired [fetch].
- SignalPlus shows three tabs: "My RFQ", "Received RFQ" ("visible only to Deribit market makers; this page will be empty for regular users") and "Market Trade Tape" [3P fetch].
- Not found: Deribit's own maker screen, its columns, or its quote ticket.

### Bybit RFQ

Sources: https://www.bybit.com/en/help-center/article/Introduction-to-RFQ [fetch]; a search summary of Bybit's announcement [search].

- An RFQ is "Visible only to the requester and selected counterparties" [fetch].
- Makers connect "via API integration and UID registration with Bybit or your RM"; takers use the web front end [search].
- Not found: any web screen for makers. It appears to be API only.

### Kalshi, Polymarket and Gemini combos (maker side)

- Kalshi docs, https://docs.kalshi.com/getting_started/rfqs [search; the page would not load]: "RFQs allow a requester to solicit quotes from market makers on a specific market and size"; "A new quote on the same RFQ replaces the maker's previous quote"; the maker must confirm within 30 seconds of the requester accepting or the trade is voided (FIX docs, https://docs.kalshi.com/fix/rfq-messages) [search].
- Retail users cannot quote Kalshi combos: taking the opposite side "is restricted to approved institutional market makers" [3P fetch, https://www.actionnetwork.com/education/kalshi-combos]. One search summary of a research post says "anyone can become an RFQ market maker" (https://www.oddpool.com/research/kalshi-rfq-market-makers) [search]; the two were not reconciled.
- Polymarket combos: the maker "confirms or declines within the 1-second confirmation window" (https://docs.polymarket.com/api-reference/maker/confirm-or-decline-last-look.md) [search].
- Gemini combos RFQ: "The quote is immutable — there is no revise"; a maker can pull a quote but the slot for that RFQ is not freed (https://developer.gemini.com/prediction-markets/combos-rfq/quote-methods) [search].
- Not found: a maker screen for any of the three. All are API products.

### SX Bet parlays

Source: https://medium.com/sportx-bet/parlays-are-live-on-sx-895ba37f75c2 [search; the page returned 403].

- A parlay request opens a private order book for that bettor; programmatic makers have about a second to offer; the bettor has about a minute to take the offer; up to 10 legs; the bettor may bet that all legs win or that at least one loses.
- Not found: the slip's risk and payout wording, or any maker screen. Overtime and Limitless: nothing found on "take the other side" screens.

### Betfair, Smarkets, Matchbook (laying)

- Betfair Exchange education, https://www.sportinglife.com/free-bets/guides/betfair-exchange-education/laying (timeform.com redirects here) [fetch]:
  - Slip fields: "Backer's Odds" ("the odds of the selection that another bettor has backed at"), "Backer's Stake" ("how much of the backer's stake you are willing to lay"; also "how much you want to win from your lay bet"), "Liability" ("how much you need in order to place the bet, because you are playing the part of the bookmaker").
  - Liability is "the amount that, in your worst-case scenario, you could lose".
  - Examples: laying at 1.5 for a £10 backer's stake shows a liability of £5; laying at 3.5 for £10 is "a liability of £25 for the chance to win £10".
  - "select the pink box to place a lay bet".
- Third-party guides [search, 3P; several are low-quality sites]: liability = (odds − 1) × backer's stake; the exchange reserves the full liability when the lay is placed and refuses it if the balance is short; a common beginner mistake is to read the stake as the amount at risk ("£20 stake at 5.0 = £80 liability, not £20").
- Smarkets [search, 3P]: sides are worded "for" and "against" (buy and sell); unmatched liability is held from the balance until matched or cancelled.
- Matchbook [search, 3P]: the slip can be filled by stake or by liability.
- Not found: Betfair's, Smarkets' or Matchbook's own help pages, and the layout of their "my bets" lists (matched, unmatched, cancel).

### HyperQuote, AirSwap, Hashflow, Variational (maker tooling)

- No maker dashboard was found for HyperQuote, AirSwap or Hashflow; makers are servers that answer over an API [search]. The taker-side details for HyperQuote and AirSwap are in the taker notes.
- Variational's API tutorial describes the maker loop in words: list received RFQs in open status, pick one, submit a quote, replace it before acceptance, then a maker last look (https://docs.variational.io/technical-documentation/api/quickstart-and-tutorials/maker-rfq-responder-tutorial) [search]. No screen.

### Public trade feeds

- Paradigm Trade Tape: see above [direct].
- Hyperliquid `recentTrades` (POST https://api.hyperliquid.xyz/info) returns `coin`, `side`, `px`, `sz`, `time`, `hash`, `tid`, `users` (two addresses) [direct, live response]. The app's layout was not sourced.
- Deribit: public channel `block_rfq.trades.{currency}` for "Recent Block RFQ trade notifications" [fetch].
- Kalshi: "Trade data shows aggregate activity but not individual trader identities" (https://docs.codex.io/prediction-markets/kalshi) [search, 3P].
- Polymarket: the activity endpoint "returns the 50 most recent trades across all Polymarket markets", each with wallet address and side (https://www.predictionhunt.com/api/docs/v2/polymarket/activity) [search, 3P].
- Limitless: a dataset description mentions per-market feed events "with rich user profile and trade payload details" (https://baselight.app/u/limitless/dataset/markets) [search, 3P].
- Not found: the actual screens of Polymarket's activity feed, Kalshi's and Limitless's activity tabs, Hyperliquid's and Derive's trade panels, and any Betfair or Smarkets public feed.

### Design-system and usability guidance

- Carbon data table, https://carbondesignsystem.com/components/data-table/usage/ [fetch]: row sizes 24, 32, 40 (default), 48, 64 px; "Extra large row heights are only recommended if your data is expected to have 2 lines of content in a single row"; "Use the expanded section for supplementary information or data that needs additional query time"; "When the content in the expanded area feels cramped, consider taking the user to a dedicated page"; column titles wrap to two lines then truncate, with the full text in a tooltip.
- NN/g, Data Tables: Four Major User Tasks, https://www.nngroup.com/articles/data-tables/ [fetch]: quotes in item 33 above; also "Freeze header rows and header columns (if the table is larger than the screen)"; one or two inline row actions are fine, more become crowded or hidden.
- NN/g, Mobile Tables, https://www.nngroup.com/articles/mobile-tables/ [fetch]: lock the leftmost column if the table scrolls sideways; make hidden columns obvious with cut-off content, not dots; group attributes into accordions; do not force rotation.
- NN/g, Bottom Sheets, https://www.nngroup.com/articles/bottom-sheet/ [fetch]: "especially useful when users are likely to need to refer to the main, background information"; a sheet is "a transient UI element"; provide a visible Close button, support Back, avoid stacking.
- PatternFly truncate, https://www.patternfly.org/components/truncate/design-guidelines [fetch]: truncated items "should always include a tooltip on hover"; do not truncate table headings; cut at the end by default, in the middle when strings differ at both ends.
- PatternFly primary-detail, https://www.patternfly.org/patterns/primary-detail/design-guidelines [fetch]: "Use a primary-detail layout when viewing details from an item in a large list or group on the same page"; detail in a drawer of a half, third or quarter of the viewport; selected item needs a visible selected state; "Mobile views will only show 1 component at a time".
- Maersk design system, https://designsystem.maersk.com/content/truncation/index.html [search]: hover tooltips for truncated text are not available on touch devices.
- SAP Fiori wrapping and truncation [search; page returned 403]: wrapping and truncation can be combined, wrapping to a line limit and then truncating.
- web.dev, Optimize Cumulative Layout Shift, https://web.dev/articles/optimize-cls [fetch]: quotes in item 20 above; also "Have the user initiate the load of new content, so they are not surprised by the shift".
- Not read: Material (the page returned no content), Atlassian, Polaris (URL redirected to a different page).

---

## What was not found

- **Sportsbook parlay displays** (DraftKings, FanDuel, bet365 bet slips and "My Bets", collapsed legs, "+2 more"): four searches and three fetches returned only affiliate guides with no interface detail. The only "first leg + N more" evidence is Kalshi's featured combos.
- **Betfair, Smarkets and Matchbook official help pages** and their matched/unmatched bet lists. Betfair's slip wording comes from a Betfair-education page on Sporting Life.
- **Deribit's and Bybit's maker screens.** Deribit's support article is blocked; Bybit's maker side looks API-only.
- **Kalshi, Polymarket and Gemini combo maker screens.** API products; Kalshi's and Polymarket's docs would not load, so their lines rest on search summaries.
- **SX Bet, Overtime, Limitless** "take the other side" screens.
- **Public trade feed screens** for Polymarket, Kalshi, Limitless, Hyperliquid and Derive. Only Paradigm's tape was seen; Hyperliquid's feed was seen as data, not as a screen.
- **Jira, Linear and GitHub** long-title handling: not researched in the time available.
- **Material, Atlassian and Polaris** table guidance: pages did not load or redirected.
- **How any RFQ board animates new or closing rows**, and any **empty-board copy**. Items 20 to 22 rest on general layout-shift guidance and my inference.
- **A phone layout for any maker board.**
