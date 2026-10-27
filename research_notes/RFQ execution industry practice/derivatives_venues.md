# RFQ execution at derivatives and prediction-market venues

Research notes, compiled 2026-10-14 from official API/developer docs (raw `.md` pages pulled the same day) plus a few announcements and press pieces.

**Evidence tags**
- **[V]**: read directly on the cited primary page today.
- **[S]**: secondary source (press or third-party analysis), or a search-engine snippet of a primary page I could not open.
- **[U]**: could not verify.
- **[I]**: my inference from verified facts.

**Access problems**
- The local DNS blocks docs.kalshi.com, help.kalshi.com and docs.polymarket.com. I fetched them through their public Vercel/Cloudflare IPs instead, so the content is the real site.
- support.deribit.com sits behind a Cloudflare challenge (403). Facts from it are snippet-only and tagged [S].
- Deribit's fee page (deribit.com/kb/fees) is a JS app and returned no content.

---

## 0. Cross-venue summary

| Venue | Who quotes | Taker reveals side? | Quote form / TTL | Last look | Venue price guard | Settlement | UI routing to RFQ |
|---|---|---|---|---|---|---|---|
| Derive v3 | Approved RFQ makers only (`is_rfq_maker`). Broadcast to all makers, or to taker-named wallets | Legs carry directions. The taker executes either buy or sell of the package (two-way) | Maker EIP-712 signed quote, valid at least until RFQ expiry + 60 s (RFQ lives 30 min), at most 1 day | No. Taker's signed `execute_quote` fills atomically | Maker quotes are price-banded vs spot/perp mark. Optional taker protection: reject if the book is cheaper | Off-chain engine, then ZK-proven batches verified on Ethereum L1. Signatures re-verified by protocol | RFQ page in UI (manual). No auto-routing found |
| Paradex | Paradigm desks (LPs). Paradex picks counterparties; client list ignored | Optional `side` commit. Default two-way. Makers always quote both sides | Paradigm orders (makers quote per side) | Not in Paradex docs. Trades can be REJECTED at clearing | Acceptable band (`min_price`/`max_price`) per RFQ. Deribit book cost streamed as reference | Paradigm matches, then submits an atomic block trade to Paradex (Starknet appchain) | No auto-routing found |
| Deribit Block RFQ | Block RFQ makers (list from `get_block_rfq_makers`). All makers or a targeted subset | Legs carry directions. Taker picks direction at accept; makers quote bids/asks | Maker quote with optional `expires_at`, AON or any-part-of. RFQ lives 5 min | No. Taker crosses with FOK or GTC limit | Block tick sizes and min block sizes. Leg-price bandwidth rules ([S]) | Deribit matching engine (centralised). Block trade fees | Separate Block RFQ UI. No auto-routing |
| Kalshi | Anyone subscribed to `communications`. "Broadcast to all makers" | No: quote has `yes_bid` and `no_bid`; requester accepts a side | Implicit full size. New quote replaces old | **Yes**: maker must confirm (30 s standard, 3 s HVM/combos), then 15 s / 1 s execution timer | `yes_bid + no_bid ≤ $1`, price grid | Orders entered into the public CLOB after the timer | **Yes**: UI combo builder prices every combo by RFQ |
| Polymarket Combos | Any account with CLOB creds that opens an RFQ WS session | **Yes**: BUY/SELL of combo YES | Maker signs an Exchange v3 EIP-712 order within 400 ms | **Optional**: 1 s, gated (~$2.5k combo volume, reject ≤15%) | BUY quote ≤ 0.90909 safety cap | On-chain, Polygon, CTF Exchange v3 | **Yes**: Polymarket users are the requesters |
| OKX | Approved makers (form), ≥ $100k equity. Taker selects counterparties | Legs carry sides. Maker sets `quoteSide` | `expiresIn` 10–120 s. RFQ 2 min (10 min all-options) | No | `makerPxBand` (ticks vs mark), maker-set | OKX clearing (CEX) | Liquid Marketplace UI. No auto-routing found |
| Bybit | Taker-selected quoters (LPs). Can also accept non-LP OTC quotes | Legs carry sides. Makers quote buy and/or sell | `expireIn` 10–120 s | No | Derivatives limit-price logic on hedge leg | Bybit matching engine | No |
| Aevo | Counterparty list on the RFQ block | `is_buy` on the RFQ (reveals side) | Signed quote (salt, timestamp, signature) | [U] | [U] | Aevo L2 | [U] |
| Hyperliquid | No RFQ product in official docs index | n/a | n/a | n/a | n/a | n/a | n/a |

---

## 1. Derive (formerly Lyra v2), now "Derive v3"

**Status and deprecation**
- The current API is v3: `https://api.derive.xyz/v3`, `wss://api.derive.xyz/v3/ws`. [V] https://docs.derive.xyz/getting-started/introduction
- v2 hosts `api.lyra.finance` / `api-demo.lyra.finance` and the `X-Lyra*` headers map to v3 equivalents. [V] https://docs.derive.xyz/migrating/breaking-changes
- v3 merges "Derive Exchange and the Derive Chain … into a single Zero Knowledge application that settles directly to the Ethereum L1". The v2 to v3 migration "(more information coming soon)" moves subaccounts from SCWs to EOAs. [V] https://docs.derive.xyz/migrating/v3-improvements
- `private/poll_rfqs` in v2 returned closed RFQs. In v3 it returns only open RFQs; closed ones come from the new `private/get_maker_rfq_history`, added Oct 7, 2026. [V] https://docs.derive.xyz/changelog
- `private/transfer_position` is deprecated in favour of `transfer_positions`. [V] breaking-changes page.
- Older search hits point to `v3.docs.derive.xyz`. That host no longer resolves (ENOTFOUND, 2026-10-14). The old v2 URL `docs.derive.xyz/docs/rfq-quoting-and-execution` returns 404. [V]

### 1.1 Message flow

Source for this subsection: https://docs.derive.xyz/trading/rfq [V] unless noted otherwise.

**Transport and scopes**
- All RFQ calls are `private/*` JSON-RPC over WebSocket or HTTP POST.
- Each needs the `trade:rfq:<asset>` session-key scope for every asset type in the legs (`option`, `perp`, `spot` or `all`).
- Cancel calls need any one `trade:rfq:*` scope.

**Taker: `private/send_rfq`**
- This is an *unsigned intent*: "does not move funds".
- Required: `subaccount_id` and `legs[]`. Each leg has `instrument_name`, `amount` (decimal string) and `direction` (buy/sell, "the taker's side of this leg").
- Optional: `counterparties` (wallet list; null means open to all makers), `max_total_cost`, `min_total_cost`, `partial_fill_step` (default `1`), `label`, `client`, `extra_fee` (builder fee) and `referral_code`. [V] https://docs.derive.xyz/api-reference/rfq/privatesend_rfq
- The response carries `rfq_id` (uuid), `status` (`open|filled|cancelled|expired`) and `valid_until` (ms).
- "The default window is 30 minutes… deployment-specific."
- Multi-leg packages fill "all-or-nothing at a single `total_cost`". `partial_fill_step` allows partial fills of the whole package.
- The RFQ object carries `bid_total_cost`, `ask_total_cost`, `mark_total_cost` and `filled_direction`. [V] send_rfq schema
- Error 11109 `rfq_filled_direction_cannot_be_changed`: once partly filled in one direction, later fills cannot flip it. [V] https://docs.derive.xyz/error-codes
- **So the RFQ is two-way.** Makers quote, and the taker later executes as buyer or seller of the package. [I] from bid/ask fields, filled_direction and the cost-limit semantics.

**Taker's cost limits**
- `max_total_cost` applies when executing as buyer and `min_total_cost` when executing as seller. Both are in USD for the full size.
- They only *filter* `rfq_get_best_quote` and the `{subaccount_id}.best.quotes` channel.
- "`private/execute_quote` fills any valid quote." "Makers do not see either limit."

**Maker discovery**
- `private/poll_rfqs` returns open RFQs visible to the maker: "open-to-all, or those naming your wallet in `counterparties`".
- Alternatively, subscribe to `{wallet}.rfqs`.
- So the RFQ is broadcast to every *approved* maker unless the taker names counterparties.

**Maker quote: `private/send_quote` (signed)**
- Fields: `rfq_id`, `legs[]` with `price` per leg, `direction`, `max_fee`, `signer`, `signature`, `nonce`, `signature_expiry_sec`, `subaccount_id`, and optional `mmp`, `label`, `extra_fee`, `referral_code`.
- "The quote's signature is verified and validated against the referenced RFQ before it is stored." [V] https://docs.derive.xyz/api-reference/rfq/privatesend_quote
- `private/replace_quote` does an atomic cancel plus re-submit (by `quote_id_to_cancel` or `nonce_to_cancel`).
- Withdrawal: `cancel_quote` and `cancel_batch_quotes`.
- The maker's own quotes stream on `{subaccount_id}.quotes`.
- Each quote has one `direction`. The docs do not say outright that quoting both sides needs two quotes. [I]

**Taker execution**
- `private/rfq_get_best_quote` is a dry run. It returns the best quote, expected fee, liquidation-price and PnL estimates. [V] https://docs.derive.xyz/api-reference/rfq/privaterfq_get_best_quote
- `private/execute_quote` is signed by the taker. It takes `rfq_id`, `quote_id`, priced legs, `direction`, `max_fee`, the signature fields and optional `enable_taker_protection`.
- "The signature is verified and the taker fill, maker quote, and RFQ are updated together in one atomic step." [V] https://docs.derive.xyz/api-reference/rfq/privateexecute_quote

**Last look: none.** [I] Execution is atomic on the maker's already-signed quote.

**Maker-side protections**
- MMP: quotes sent with `mmp: true` count toward amount/delta limits over a rolling window; a breach freezes the currency and cancels MMP quotes.
- Cancel-on-disconnect cancels the quotes sent on that connection.
- Sources: [V] https://docs.derive.xyz/trading/market-maker-protection, https://docs.derive.xyz/trading/cancel-on-disconnect

**UI**
- The Dec 10, 2025 blog post describes an RFQ page with a "Create RFQ" button.
- "Buy and sell quotes appear side-by-side. Choose the price you want." [S] https://insights.derive.xyz/derives-new-rfq-experience/
- I found no evidence that ordinary UI market orders auto-route to RFQ. [U]

### 1.2 Who sets the price
- Makers set the price, inside venue bands. "Maker RFQ bands work similarly to orderbook ones, except all assets in a multi-leg RFQ share the same spot shock value, and options don't consider volatility shocks."
- Max package cost is the sum of per-leg max costs.
- Example RFQ spot shocks: 1.5% for ETH/BTC, 2.5% for SOL, 3% for HYPE, 10% for VVV/LIT/PUMP.
- Rejection code: 11107 `quote_maker_cost_too_high` ("exceeded the price bandwidth").
- Sources: [V] https://docs.derive.xyz/trading/price-banding, https://docs.derive.xyz/error-codes
- **Taker protection**
  - The banding page says "Takers cannot accept a quote if the quote is worse than an equivalent orderbook quote (unless they choose to explicitly opt out of the taker protections)."
  - But the API reference gives `enable_taker_protection` **default false**. When true it rejects with `QuoteTakerCostTooHigh` "when the orderbook fills the same legs at a lower total cost"; the check is skipped if the book cannot fill every leg.
  - **The docs conflict on the default.** [V] both pages.
- **Anonymity**
  - `poll_quotes` returns "public quote views (including the maker's wallet)", so the taker sees maker wallets. [V] llms.txt description of `private/poll_quotes`, https://docs.derive.xyz/api-reference/rfq/privatepoll_quotes
  - RFQs show `wallet` in the response, so makers likely see the taker wallet. [I]
  - No anonymity flag is documented. [U]

### 1.3 Which orders go to RFQ
- Taker-initiated only, for "large or multi-leg structures that would be hard to fill on the public orderbook". [V] rfq page
- No minimum RFQ size is documented. [U]
- Limits:
  - errors `rfq_too_many_legs` and `rfq_too_many_counterparties` (numbers not stated)
  - `cross_currency_rfq_not_supported`
  - `leg_instruments_not_unique`
  - `unauthorized_as_rfq_maker` (14027) and `rfq_disabled_for_account`
  - Source: [V] https://docs.derive.xyz/error-codes
- Interaction with the book: only through the optional taker-protection check above.

### 1.4 Settlement and fees

**Settlement**
- Off-chain sub-ms matching. "Margining, settlement and permissioning are defined in the protocol… proven off-chain with the SP1 Hypercube zkVM"; batches go to Ethereum L1 with PLONK proofs. [V] introduction page
- Executed quotes carry `batch_status`. [V] changelog, July 31, 2026

**Signing**
- EIP-712 `Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)`.
- Domain: `chainId` 1 (mainnet) or 11155111 (testnet).
- RFQ module: `RFQ_MODULE 0x9371352CCef6f5b36EfDFE90942fFE622Ab77F1D`. Position transfers also book as RFQ trades.
- Source: [V] https://docs.derive.xyz/authentication/action-signing

**Nonces and expiry**
- RFQ nonce window is ±1 h vs server clock and need not increase.
- Quote/execute `signature_expiry_sec` minimum is "60 seconds past the RFQ's expiry (an RFQ is valid for 30 minutes from creation)"; maximum is 1 day.
- Equivalently: `rfq_creation + 31 min ≤ signature_expiry_sec ≤ now + 1 day`. [V] action-signing and breaking-changes pages
- **So maker quotes are long-lived, not short-TTL.** Makers manage staleness with cancel/replace, MMP and cancel-on-disconnect. [I]
- Debug helpers `public/send_quote_debug` and `public/execute_quote_debug` return the EIP-712 payloads. [V]

**Fees**
- "Trades conducted via RFQs are charged the taker notional fee rate on both counterparties, plus a base fee on the taker side."
- Multi-leg discount: legs are grouped (long calls, long puts, short calls, short puts, perps). The most expensive group pays in full, the cheapest gets 100% off, the 2nd and 3rd cheapest get 50% off.
- Box spreads pay `notional × 0.5% × years_to_expiry` on both sides, plus a $0.5 taker base fee.
- Orderbook reference: options taker `$0.5 + min(0.03% × notional, 12.5% × premium)`.
- Sources: [V] https://docs.derive.xyz/integrators/trading/trading-fees
- Institutional tiers give "RFQ Maker Discount" up to 100% and "RFQ Taker Discount" up to 75%. [V] https://docs.derive.xyz/integrators/programs/institutional-trading-rewards

### 1.5 Maker requirements
- Account flag `is_rfq_maker` in `private/get_account`. Error 14027 `unauthorized_as_rfq_maker`. [V] https://docs.derive.xyz/api-reference/account/privateget_account, error codes
- Older search snippet: "Market maker wallets must be approved by the support team in order to get access to the maker API." [S] Not on the current page text I read.
- MM rate-limit tier: 500+ TPS vs 5 TPS for traders. Apply via support or the rewards form. [V] https://docs.derive.xyz/integrators/trading/rate-limits
- **RFQ scoring** ([V] institutional-trading-rewards page):
  - Only filled RFQs score, but every maker that quoted a filled RFQ scores.
  - Score = `F × (DistanceScore + TimeScore)`.
  - Distance from the taker's Max Cost: ≤0% scores 0, 0–1% scores 1, 1–3% scores 2, >3% scores 4.
  - Time to first quote: ≤5 min scores 2, ≤15 min scores 1, >15 min scores 0.5.
  - The filling maker gets ×1.2, others ×0.5.
  - The RFQ pool per 28-day epoch is 100k DRV for ETH/BTC/SOL, 50k for HYPE and 50k for alts.
  - The time buckets in *minutes* show these are slow, desk-style RFQs.

---

## 2. Paradex (RFQ = Paradigm integration, plus a separate signed block-trade API)

### 2.1 RFQ API (taker side on Paradex, makers on Paradigm)

**Context**
- RFQ ids are "Paradigm-issued". The account opt-in is `POST /v1/account/paradigm/enable`, so the "RFQ venue" is Paradigm. [V] https://docs.paradex.trade/api/prod/rfqs/rfq-execute, https://docs.paradex.trade/api/prod/rfqs/rfq-enable
- Paradigm lists "Paradex and Bullish … on RFQ only". [V] https://docs.paradigm.co/unified-markets/summary
- Press: Crypto Briefing (July 15, 2026) on Paradex integrating an RFQ engine, and later coverage of OI growth "after Paradigm's RFQ integration". [S] https://cryptobriefing.com/paradex-integrates-rfq-engine-executes-23m-xrp-options-block/, https://cryptobriefing.com/paradex-options-open-interest-250m/

**Enable**
- `POST /v1/account/paradigm/enable` must be called once, with a main-key token.
- It issues a delegated RFQ trading subkey, which counts toward the subkey limit.
- "If the RFQ venue refuses to enable the account, the operation returns `400` … `REQUEST_NOT_ALLOWED`." [V] rfq-enable

**Create: `POST /v1/rfqs`**
- Asynchronous: returns `202` with `request_id`. The result arrives on private WS channel `rfq` as a `RESULT` event carrying `rfq_id`.
- Up to 25 legs, each `{market, ratio, side, price?}`.
- A leg with any positive `price` is a *hedge leg* fixed at mark at creation.
- At least one strategy leg must be BUY and one must have ratio 1.
- Other fields: `quantity`, optional `side` (`BUY`/`SELL`; omit for two-way), `is_anonymous` ("hide the taker desk name"), `label`, `max_slippage`.
- `counterparties` is "Reserved for future use; currently ignored". "**The platform selects eligible counterparties.**"
- "Makers always quote both directions either way". Committing a `side` only restricts the taker's execution and lowers the collateral reserved.
- "An account may hold only one two-way RFQ open at a time, and any number of committed ones up to a total limit."
- "The strategy quantity must be at least the largest minimum block size among its strategy legs."
- `max_slippage` sets collateral held while open and "does **not** limit the price this RFQ may execute at… The market's price band is what bounds the execution."
- `result.allowed_side` may downgrade a two-way request to one side if the account "cannot sustain the other".
- Source: [V] https://docs.paradex.trade/api/prod/rfqs/rfq-create

**Execute: `POST /v1/rfqs/{rfq_id}/execute`**
- "Queues a taker limit Fill-or-Kill order against an RFQ."
- Body: `price` (signed net strategy price; zero and negatives allowed), `quantity`, `side`.
- Async; the result comes on the WS `RESULT` event with `order_id`. [V] rfq-execute

**Market data and state**
- `GET /v1/rfqs/{rfq_id}/bbo` returns best bid/ask and quantities, `mark_price`, `min_price`/`max_price` ("acceptable price band") and per-leg data. [V] https://docs.paradex.trade/api/prod/rfqs/rfq-bbo
- `GET /v1/rfqs/markets` lists RFQ-eligible markets with the venue's `venue_size_increment`. The old `markets` field is **deprecated**. [V] https://docs.paradex.trade/api/prod/rfqs/rfq-markets
- `GET /v1/rfqs/platform-state` reports `AVAILABLE`, `AVAILABLE_CANCEL_ONLY`, `UNAVAILABLE` or `UNKNOWN`. Create/execute are refused with `RFQ_VENUE_UNAVAILABLE`. [V] https://docs.paradex.trade/api/prod/rfqs/rfq-platform-state

**WS channel `rfq[.{rfq_id}]` event types**
- `RFQ` (OPENED/CLOSED with reason, e.g. NO_MATCH, EXPIRED)
- `QUOTE` (role TAKER or MAKER, side)
- `TRADE` (STARTED, EXECUTED, REJECTED, PROGRESS; rejection reason e.g. "risk check")
- `RESULT`
- `DERIBIT_COST`: "What the same structure would cost crossing Deribit's public book… A reference only: nothing here is executable"
- Source: [V] https://docs.paradex.trade/ws/web-socket-channels/rfq-rfq-id/rfq-rfq-id

### 2.2 Paradigm DRFQv2 mechanics (the maker side)

Sources: [V] https://docs.paradigm.co/unified-markets/rfq-request-for-quotes, /taker-s-perspective, /maker-s-protection

- In native Paradigm the taker selects counterparties. Via Paradex the platform selects them (see above).
- Makers submit Orders with per-leg pricing via `POST /orders` and replace with `PUT /orders/{id}` (loses time priority).
- `side_layering_limit` = 1 open order per side per RFQ.
- "There are NO partial fills"; maker size must equal the RFQ quantity.
- Price-then-time priority.
- "Only the RFQ creator is able to see all of the Makers' returned orders"; makers cannot see each other.
- Paradigm RFQs expire after **5 minutes**.
- Takers can be disclosed or anonymous. "Makers can NOT choose to submit Orders on an anonymous basis."
- Settlement: a crossing order creates a Trade `PENDING_SETTLEMENT`, submitted as an atomic "Block Trade" to the settlement venue, then `FILLED` or `REJECTED`. "It is possible for a Trade to be rejected at clearing." [V] https://docs.paradigm.co/unified-markets/summary
- Maker protection: MMP triggers on 2 executions within 1 s and auto-resets within 10 s. It "cannot be disabled" but is configurable per desk. [V] https://docs.paradigm.co/high-level-notes/maker-protection
- Taker limits: 1 execution per 2 s; 1 RFQ creation per 3 s per product. [V] https://docs.paradigm.co/high-level-notes/taker-limits
- Onboarding:
  - Paradigm desk plus a Paradex trading key added to the Paradigm dashboard.
  - Paradex minimum block sizes: 0.001 BTC, 0.1 ETH and 1 HYPE options.
  - "Paradigm fees for Paradex products are free."
  - Source: [V] https://paradigm.co/help/products/derivatives/venues/paradex

### 2.3 Paradex native block trades (bilateral or offer-based, signed)

- `POST /v1/block-trades` creates a parent block with `block_expiration`, `nonce`, `required_signers[]`, `signatures{}` and `trades{market: {maker_order, taker_order, price, size, trade_constraints{min_price,max_price,max_size}}}`.
- Block types: `DIRECT` and `OFFER_BASED`.
- Required signers submit offers via `POST /v1/block-trades/{id}/offers`, with per-market signed orders plus a block signature.
- The initiator calls `POST /v1/block-trades/{id}/execute` with `selected_offers` ("offers are atomic, not partial") and acceptance signatures. Alternatively, `POST …/offers/{offer_id}/execute`.
- Statuses: `CREATED`, `OFFER_COLLECTION`, `READY_TO_EXECUTE`, `EXECUTING`, `PENDING_SETTLEMENT`, `COMPLETED`, `FAILED`, `CANCELLED`.
- Signatures:
  - `signature_type: STARKNET`, carrying `nonce`, `signature_expiration` (ms), `signature_timestamp`, `signer_account`, optional subkey pubkey.
  - Errors include `BLOCK_TRADE_REPLAYED_SIGNATURE` and `BLOCK_TRADE_SELF_TRADE`.
  - Leg orders get the `MMP` flag "from the owner's protect_block_trades config".
- Sources: [V] https://docs.paradex.trade/api/prod/block-trades/block-trades-create, /block-offers-create, /block-trades-execute, /block-offers-execute

### 2.4 Price, routing, fees, makers

**Price**
- Paradigm makers set the price.
- Paradex enforces the market price band on the resulting trade (rfq-create) and exposes `min_price`/`max_price` (rfq-bbo). [V]
- Anonymity: optional `is_anonymous` for the taker desk name. [V]

**Routing**
- Taker-initiated only.
- Paradex does have retail-flow segmentation on the *order book*, not RFQ:
  - RPI: post-only maker orders that match only "Retail Taker orders" (UI JWT with `token_usage=interactive`). Retail orders have a 300 ms speed bump and much lower rate limits. [V] https://docs.paradex.trade/trading/rpi
  - FastFills: UI orders get queue priority, and API takers get 30% off when hitting retail. [V] https://docs.paradex.trade/trading/fastfills

**Fees**
- Retail fees are 0%. Pro options fees are 0.01%/0.01%, capped at 12.5% of premium.
- Multi-leg *block trades* get the same risk-group discount ladder as Derive (100%/50%/50%/0%).
- Box spreads: maker fee `box notional × 0.5% × years`.
- Source: [V] https://docs.paradex.trade/trading/trading-fees
- An RFQ-specific fee line is not stated. [U]

**Maker requirements**
- Paradigm desk onboarding. Performance obligations are not documented on Paradex. [U]

---

## 3. Deribit Block RFQ

### 3.1 Message flow

Source: [V] https://docs.deribit.com/articles/block-rfq-api-walkthrough

**Scopes and channels**
- Scopes: `block_rfq:read` and `block_rfq:read_write`. The "account must be configured for Block RFQ trading".
- Maker channels: `block_rfq.maker.{currency}` (new RFQs) and `block_rfq.maker.quotes.{currency}`.
- Taker channel: `block_rfq.taker.{currency}`.
- Public channel: `block_rfq.trades.{currency}`.

**Create: `private/create_block_rfq` (taker)**
- `legs[]` of `{instrument_name, amount, direction}`.
- Optional:
  - `hedge` (one perp/future leg with price)
  - `makers[]` aliases ("If the list is empty, all available makers will be targeted")
  - `label`
  - `trade_allocations[]` (pre-allocation to subaccounts or broker clients)
  - `disclosed`: "It can be set to `false` (anonymous mode) only when at least 5 makers are targeted. Default value is `true`."
- Source: [V] https://docs.deribit.com/api-reference/block-rfq/private-create_block_rfq
- The help-center snippet says "Takers are anonymous by default". [S] That likely describes the UI and conflicts with the API default.
- The RFQ object carries `quote_bids`, `quote_asks`, `min_trade_amount` and `taker_rating`. [V]

**Quote: `private/add_block_rfq_quote` (maker)**
- Fields: `block_rfq_id`, `amount`, `direction` ("from the maker perspective"), `legs[]` with per-leg `price` (direction must match the RFQ leg), optional `hedge`, `price` (aggregate, for future spreads only), `label`.
- `execution_instruction`:
  - `all_or_none` "has priority over 'any_part_of' quotes at the same price level"
  - `any_part_of` (default)
- `expires_at` (ms).
- `private/get_leg_prices` converts a strategy price to leg prices.
- Edit/cancel: `edit_block_rfq_quote`, `cancel_block_rfq_quote`, `cancel_all_block_rfq_quotes`.
- Source: [V] https://docs.deribit.com/api-reference/block-rfq/private-add_block_rfq_quote
- Makers may quote single- or double-sided. [S] https://insights.deribit.com/?p=96496

**Accept: `private/accept_block_rfq` (taker)**
- Fields: `block_rfq_id`, `price` ("Maximum acceptable price for execution"), `amount`, `direction` ("from the taker perspective"), `legs[]` with ratio, optional `hedge`, `time_in_force` `fill_or_kill` | `good_til_cancelled`.
- "After Block RFQ creation, a grace period of 5 seconds begins, during which the taker cannot see quotes or trade."
- Source: [V] https://docs.deribit.com/api-reference/block-rfq/private-accept_block_rfq
- The July 1, 2025 notice describes the limit price with FOK default and an optional "Trigger" execution that keeps the order open. [S] https://support.deribit.com/hc/en-us/articles/28387265822621-1-July-2025 (403; snippet only)

**Lifecycle, aggregation, last look**
- RFQ expires 5 min after creation if not traded. [S] support article (snippet), https://insights.deribit.com/?p=96496
- Multi-maker aggregation:
  - Smaller quotes from several makers are combined to fill the full size at "the last price reached before achieving the requested amount".
  - Each maker must still meet the minimum block size.
  - The taker sees one bid and one ask.
  - Blind auction.
  - Source: [S] insights post (March/April 2025)
- **No last look**: the taker crosses resting maker quotes. [I]

**Other**
- Taker rating:
  - Weighted fill ratio over 3 months: `"1-2"`, `"2-5"`, `"5-20"`, `"20+"`, or null if fewer than 6 RFQs.
  - Shown to makers.
  - An unfilled RFQ only counts if it got quotes on both sides and the first quote arrived within 2 min.
  - Source: [V] walkthrough
- Errors: `too_many_quotes_per_block_rfq`, `too_many_quotes_per_block_rfq_side`, `too_many_open_block_rfqs` and `account_quote_limit_crossed`. Block RFQ MMP is configured separately (`block_rfq` flag on MMP methods). [V] walkthrough, https://docs.deribit.com/articles/market-maker-protection

### 3.2 Price, routing, sizes
- Makers set prices. Quotes must use block tick sizes and meet minimum block amounts; "at least one of the legs needs to be above the minimum block amount". [S] support article snippet
- Nov 25, 2025 change: makers could previously reprice legs "within set bandwidths", which pushed some legs to fee caps. Fees now depend "solely on the pricing algorithm's distribution". [S] https://support.deribit.com/hc/en-us/articles/31600682719645-25-November-2025 (403; snippet)
- Minimum block sizes per Paradigm's Deribit venue page:
  - BTC options 25, ETH options 250
  - SOL-USDC 150, XRP-USDC 75
  - BTC futures 20,000, ETH futures 100,000
  - All are per-transaction sums across legs.
  - Source: [V] https://paradigm.co/help/products/derivatives/venues/deribit
- Taker-initiated only. I found no evidence of UI order auto-routing. [U]
- No "must beat the book" rule documented. [U]

### 3.3 Settlement, fees, makers
- Settlement: centralised Deribit engine. Each leg produces a trade on `user.trades.{instrument}.{interval}` with shared `block_rfq_id` and `block_trade_id`. [V] walkthrough
- Fees: "Each trade is recorded as a block trade, so Deribit's block trade fees apply". [S] snippet. Rates [U] (fee page not retrievable).
- Bilateral block-trade API (separate product):
  - `private/verify_block_trade` (first party gets a signature over `timestamp`, `nonce`, `role`, `trades[]`; direction "always from the maker's perspective").
  - `private/execute_block_trade` (second party).
  - 5-minute approval window for broker flows; `private/invalidate_block_trade_signature`.
  - Source: [V] https://docs.deribit.com/articles/block-trading-api
- Maker requirements: `private/get_block_rfq_makers` lists the "available Block RFQ makers"; maker identity and rating come from `get_block_rfq_user_info`. Approval criteria [U]. [V] https://docs.deribit.com/api-reference/block-rfq/private-get_block_rfq_makers

---

## 4. Kalshi RFQ (communications API) and combos

### 4.1 Message flow

Source: [V] https://docs.kalshi.com/getting_started/rfqs

- Kalshi calls RFQ a system "for pre-execution communication between members".
- Execution is a "two-step lock: accept, then confirm".
- Available on any market, including combo (multivariate, MVE) markets.
- Interfaces: REST, FIX (`KalshiRFQ` endpoint and `RfqMode` sessions for makers; creators use `KalshiRT`) and WebSocket channel `communications`. [V] https://docs.kalshi.com/fix/rfq-messages

**Create: `POST /trade-api/v2/communications/rfqs`**
- Required: `market_ticker` and `rest_remainder` ("Whether to rest the remainder of the RFQ after execution").
- Size is given in exactly one of `contracts` / `contracts_fp` (0.01 increments) or `target_cost_dollars`.
- `target_cost_excludes_fees` (added per changelog): default false means the target caps principal plus fees.
- Optional: `obscure_creator_id` (added Oct 1, 2026), `replace_existing`, `subaccount` (0–63) and `subtrader_id` (FCM).
- `target_cost_centi_cents` is **deprecated**.
- "Maximum of 100 open RFQs at a time." `409` if an open RFQ already exists on that ticker.
- Source: [V] https://docs.kalshi.com/api-reference/communications/create-rfq

**Discovery**
- "The RFQ is broadcast to all makers."
- `rfq_created`/`rfq_deleted` "go to all subscribers"; quote events only go to the two parties.
- The changelog says `communications` "still broadcasts every RFQ (public by design, so makers can quote them)".
- Since Oct 8, 2026, `rfq_deleted` is sent to all subscribers after execution.
- Sources: [V] rfqs guide, https://docs.kalshi.com/changelog

**Quote: `POST /communications/quotes`**
- Fields: `rfq_id`, `yes_bid`, `no_bid`, `rest_remainder`, optional `post_only` and `subaccount`.
- "Either can be "0" to decline that side, but not both. If `yes_bid + no_bid > $1` the quote is rejected."
- "Quoters do not specify a size." Prices must sit on the market's `price_ranges` step.
- "A new quote on the same RFQ replaces the maker's previous quote."
- Each quote "is private between the requester and the individual maker".
- Sources: [V] https://docs.kalshi.com/api-reference/communications/create-quote, rfqs guide
- So quotes are two-way and the requester does *not* reveal direction pre-trade. [I]

**Accept**
- Current endpoint: `PUT /communications/rfqs/{rfq_id}/quotes/{quote_id}/accept` with `accepted_side` (`yes`|`no`). "This will require the quoter to confirm." [V] https://docs.kalshi.com/api-reference/communications/accept-rfq-quote
- The older `PUT /communications/quotes/{quote_id}/accept` and `/confirm`, plus `GET`/`DELETE /communications/quotes/{quote_id}`, are **DEPRECATED** in favour of the RFQ-scoped paths. [V] https://docs.kalshi.com/api-reference/communications/accept-quote, llms.txt index

**Confirm (maker last look)**
- `PUT /communications/rfqs/{rfq_id}/quotes/{quote_id}/confirm` "will start a timer for order execution". [V] https://docs.kalshi.com/api-reference/communications/confirm-rfq-quote
- FIX: "Quote must be confirmed within 30 seconds of acceptance or it will be voided." [V] fix/rfq-messages

**Timing**

| Market type | Confirmation window | Execution timer |
|---|---|---|
| Standard | 30 s | 15 s |
| HVM (all combos) | 3 s | 1 s |

- "Once confirmed, neither party can withdraw." "At the end of the timer, orders are entered into the book."
- Fills appear in `GET /portfolio/fills` (`creator_order_id` / `rfq_creator_order_id`).
- Source: [V] rfqs guide

**Identity**
- Public communications IDs are pseudonymous (salted hash).
- `obscure_creator_id` hides the requester until successful execution; the ID is then revealed. [V] rfqs guide, changelog (Oct 1, 2026)

**Bilateral block trades (separate)**
- `POST /communications/block-trade-proposals` takes `buyer_user_id`, `seller_user_id`, `market_ticker`, `price_centi_cents`, `centicount` and `maker_side`.
- Accepted with `PUT …/{id}/accept`. [V] https://docs.kalshi.com/api-reference/communications/propose-block-trade

### 4.2 Price, routing, interaction with the book
- Makers set prices. The venue checks the price grid and `yes_bid + no_bid ≤ $1`. [V]
- **UI routing**: the Kalshi help article (updated 2026-10-10) says "Combo prices are determined through a Request For Quote (RFQ) system. When you request a combo, the platform sends out a quote request to the market and other participants can respond with a price."
  - "Fills are not guaranteed. If no market participant responds… the combo order will not fill."
  - "Each combo is a unique market with its own dedicated order book."
  - "payout unavailable" means no live quote.
  - So **retail UI combo orders are auto-routed to RFQ.** [V] https://help.kalshi.com/en/articles/13823820-combos
- An older search snippet of the same article said "Anyone can listen for and respond to RFQs through the API, meaning there is no exclusivity for quoting". [S] Not in the current text.
- **Book interaction**: execution places orders on the public CLOB after the timer (`rest_remainder`, `post_only`).
  - The Aug 22, 2026 changelog: for combo trades, "if a quoter executes against an order that has rested on the book for less than five seconds… the quoter will pay the maker fee, and the resting counterparty will pay the taker fee". Maker fee multiplier is 0.5 vs standard 0.25; maker fees were enabled Aug 20, 2026.
  - Post-only quoters that repeatedly cross "may be temporarily rate limited".
  - Source: [V] https://docs.kalshi.com/changelog
  - So RFQ orders can trade against other resting orders, not only each other. [I]
- Third-party study (May 28, 2026): 13 quoter IDs on peak-hour sports RFQs, non-sports drew zero quotes, almost every quote under 200 ms, and combos and singles quoted by entirely separate makers. [S] https://www.oddpool.com/research/kalshi-rfq-market-makers

### 4.3 Settlement, fees, maker requirements
- Settlement: centralised Kalshi exchange (CFTC DCM) with normal fills. No signed quotes; requests are authenticated with RSA/Ed25519 API-key signatures. [V] create-rfq security schema
- Fees: normal taker/maker fees on the resulting orders. The target-cost sizing reserves "your taker fee". Combo maker/taker swap as above. [V] rfqs guide, changelog
- Fee schedule: https://kalshi.com/fee-schedule. [U] not fetched.
- Maker requirements:
  - None documented for REST quoting.
  - FIX `RfqMode` session access [U].
  - API keys with user-provided public keys need "Premier or Market Maker API usage levels". [V] llms.txt description of Create API Key
  - No response-time SLA beyond the confirm window. [V]

---

## 5. Polymarket Combos RFQ (live; EVM, on-chain)

### 5.1 Flow

Source: [V] https://docs.polymarket.com/trading/combos/overview

- A Polymarket user (the "requester") creates an *unsigned* Request. The RFQ system sends it to *connected* makers.
- Makers submit *signed* Quotes within a **400 ms** window. The best quote goes back to the user.
- The user accepts by signing within the acceptance window.
- Optional Last Look: the maker confirms within **1 s**. Then execution, and connected makers receive confirmed-trade broadcasts.
- The acceptance window is stated as "10 seconds max" on the overview and "five seconds from quote readiness" on the requester page. **The docs conflict.** [V] both.

**Requester API**
- Gateway: `https://combos-rfq-gateway-requester-api.polymarket.com/v1/requester/rfq`.
- `POST …/requests` with `signer_address`, `maker_address`, `signature_type` (Deposit 3, Proxy 1, Safe 2; EOA rejected), `leg_position_ids` (2–50 compatible outcomes), `direction` BUY|SELL, `side` (currently only `"YES"`) and `requested_size`.
- `requested_size`: BUY uses `notional` (max collateral including fees); SELL uses `shares`.
- The gateway "holds the request until the quote competition finishes". It returns `AWAITING_REQUESTER_ACCEPTANCE` with `expires_at`, the winning quote (`blended_price_e6`, `maker_amount_e6`, `taker_amount_e6`, `total_required_e6`, `net_receive_e6`), or `FAILED` with `NO_QUOTES`.
- Rate limit: 15 creates per minute per `maker_address`.
- Accept: submit a signed Exchange v3 order with `quote_id`.
- Status: `AWAITING_MAKER_CONFIRMATION`, `EXECUTING`, `MINED`, `RETRYING`, then `CONFIRMED`/`FILLED` or `FAILED`/`EXPIRED`/`CANCELED`.
- Source: [V] https://docs.polymarket.com/trading/combos/requesters

**Maker side**
- Connection: WS `wss://combos-rfq-gateway-quoter.polymarket.com/ws/rfq`, authenticated with CLOB API credentials.
- `RFQ_REQUEST` carries `rfq_id`, `requestor_public_id`, legs, `condition_id`, YES/NO position IDs, `direction`, `side`, `requested_size` and `submission_deadline`.
- So the **requester's direction is revealed**, pseudonymously.
- Quotes may be partial (`size`) and can come from collateral or from inventory.
- Cancels are acknowledged but do "not guarantee the quote was withdrawn from an RFQ that was already selected".
- Source: [V] https://docs.polymarket.com/trading/combos/market-makers

### 5.2 Price guards, routing, settlement, makers
- Venue guards:
  - `QUOTED_PRICE_ABOVE_SAFETY_THRESHOLD` ("BUY quote exceeds the `0.90909` safety maximum")
  - `QUOTED_PRICE_OUT_OF_RANGE` (>1)
  - `SIGNED_ORDER_PRICE_WORSE_THAN_QUOTE`
  - Source: [V] market-makers error table
- Docs warn makers that the CLOB midpoint is not a reliable reference. [V]
- Routing: combos exist only via RFQ. Combo position IDs are "complementary to CLOB token IDs". [V] overview
- Settlement: on-chain on Polygon (chain 137).
  - Both sides sign EIP-712 `Order` for "Polymarket CTF Exchange" v3, verifying contract `0xe3333700cA9d93003F00f0F71f8515005F6c00Aa`.
  - Order fields: salt, maker, signer, tokenId, makerAmount, takerAmount, side, signatureType, timestamp, metadata, builder.
  - Deposit-wallet signatures are ERC-7739-wrapped. [V] requesters page
- Fees:
  - The BUY budget "including fees". The fee formula `C × feeRate × p × (1−p)` applies to CLOB takers only, and "Makers are never charged fees". [V] https://docs.polymarket.com/trading/fees
  - A combo-specific fee rate is not stated. [U]
- Makers:
  - Any Polymarket account can open a quoting session (CLOB creds, trading approvals). [V]
  - **Last Look is gated**: "offered to makers with approximately $2,500 in Combo notional volume and an established line of communication". Makers that "reject more than 15% of selected quotes over a one-hour lookback window may be paused from quoting for a few minutes". [V] market-makers page
  - Builders use a separate Builder Gateway. [V] https://docs.polymarket.com/trading/combos/builders
  - Launch date [U].

---

## 6. Brief: OKX, Bybit, Aevo, Hyperliquid

### OKX block trading (Liquid Marketplace)

Source: [V] https://www.okx.com/docs-v5/en/#block-trading

- Eligibility: "To trade as either Taker or Maker, users need to deposit at least 100,000 USD"; "to become a Maker, Please complete the form".
- Taker: `POST /api/v5/rfq/create-rfq`.
  - Required `counterparties[]` (trader codes from `GET /api/v5/rfq/counterparties`; type `LP` = API auto-MMs).
  - Optional: `anonymous` ("not disclosed to maker even after trade execution"), `allowPartialExecution`, `acctAlloc`.
  - `legs[]` (max 15) with `side` and optional `lmtPx`: auto-execute when a quote is at least as good, not disclosed to makers.
  - RFQ "will expire after 10 minutes" if all legs are options, otherwise 2 minutes.
- Maker: `POST /api/v5/rfq/create-quote`.
  - Must quote the entire RFQ. `quoteSide` buy/sell. `expiresIn` 10–120 s (default 60).
  - "Only one active quote is allowed per RFQ… Two-sided quoting… is not supported". This contradicts the overview's "Multiple Maker(s) send a two way quote".
- Execute: `POST /api/v5/rfq/execute-quote` (rfqId, quoteId, leg sizes).
- Venue guard: maker-configured `makerPxBand` in ticks vs **mark price** ("If Bid price > Mark + 1 tick, it will be stopped"). Also `maxBlockSz`, via `maker-instrument-settings`.
- Makers have RFQ MMP (`/api/v5/rfq/mmp-config`).
- Trades are published minus counterparty info.

### Bybit RFQ (v5)

Sources: [V] https://bybit-exchange.github.io/docs/v5/rfq/basic-workflow, /docs/v5/rfq/trade/create-rfq, /create-quote, /execute-quote

- The inquirer sends to "the quoters of their choice" (`/v5/rfq/config` lists quoters).
- `POST /v5/rfq/create-rfq` takes `counterparties`, `anonymous`, `strategyType`, `list[]` of `{category, symbol, side, qty}` and an optional delta `hedge`.
  - No RFQs in the last 30 min before settlement.
  - UTA 2.0 only; not for demo users.
- Fees: "non-custom combinations have rate optimization, currently 50%; the transaction rate between LPs is currently 30%". [V] create-rfq
- `POST /v5/rfq/create-quote`: "One request reports in two directions" (`quoteBuyList`/`quoteSellList`), `expireIn` 10–120 s (default 60), `anonymous`.
- `POST /v5/rfq/execute-quote`: `quoteSide`, `isHedge`. Async (`PendingFill`).
- `/v5/rfq/accept-other-quote` accepts "non-LP OTC quotes".

### Aevo

Source: [V] https://api-docs.aevo.xyz/reference/postrfqs, https://api-docs.aevo.xyz/reference/postquotes

- `POST /rfqs` creates an "RFQ block" with `legs`, `is_buy` (direction revealed), `amount`, `full_size`, `duration` (s) and `counterparties`.
- `POST /quotes` is a signed maker quote: `block_id`, `account`, `amount`, `is_buy`, `salt`, `timestamp`, `signature`, `limit_price`, `legs`.
- Also: `PUT`/`DELETE /quotes/{id}`, `POST /quotes/preview`, `GET /rfqs/{block_id}/quotes`.
- Taker execution step, maker eligibility and fees [U].
- Aevo OTC: "Zero exchange fees", "Early unwind capabilities at mark price". [V] https://www.aevo.xyz/docs/aevo-products/aevo-otc/trading-on-aevo-otc

### Hyperliquid
- No RFQ, block-trade or request-for-quote page in the official docs index. [V] https://hyperliquid.gitbook.io/hyperliquid-docs/llms.txt (checked 2026-10-14)

---

## 7. Patterns worth noting (for a prediction-market CLOB on EVM) [I]

1. **Two families of RFQ**
   - *Desk-style block RFQ*: Derive, Deribit, Paradex/Paradigm, OKX, Bybit. Minutes-long lifetimes, approved or listed makers, multi-leg, two-way quotes, taker crosses with no last look.
   - *Retail-routed combo RFQ*: Kalshi, Polymarket. The UI auto-sends every combo order to RFQ with sub-second maker deadlines (400 ms; 3 s confirm) and optional or mandatory last look.
2. **Venue-side price guards are common**
   - Derive bands quotes vs spot/vol shocks and offers taker protection vs the book.
   - OKX uses maker bands vs mark. Paradex uses an acceptable band per RFQ.
   - Polymarket caps BUY quotes at 0.90909. Kalshi enforces `yes+no ≤ 1`.
3. **Signed-quote on-chain verification**
   - Derive: EIP-712 Action with RFQ_MODULE, nonce ±1 h, expiry ≥ RFQ expiry + 60 s and ≤ 1 day; ZK-batched to L1.
   - Polymarket: EIP-712 CTF Exchange v3 orders signed by both sides; Polygon.
   - Paradex block trades: Starknet signatures with nonce and expiration.
   - Kalshi, Deribit, OKX and Bybit are plain authenticated API calls.
4. **Last look is the exception**
   - Kalshi makes it mandatory: confirm within 30 s / 3 s.
   - Polymarket gates it behind volume and a ≤15% reject rate.
   - Derive, Deribit, Paradigm, OKX and Bybit have none; makers rely on MMP, cancel-on-disconnect and quote TTL instead.
5. **Taker reliability scoring**
   - Deribit `taker_rating` shown to makers.
   - Derive rewards makers by price distance from the taker's max cost and by response time.
