# RFQ and intent-based order filling in DeFi spot trading: industry practice

Research date: 2026-10-14. Sources are mostly primary: official docs (fetched as current `.md` or HTML pages), GitHub source read through `gh api` at the `main`/`master` heads on that date, verified contract source (Sourcify), and live `eth_call`s where stated.

Markers used below:
- **[unverified]**: I could not confirm it from a primary source.
- **[inference]**: my own reading of the code or docs, not something a source says.
- **[conflict]**: sources disagree; both values are given.
- **DEPRECATED**: no longer the current path.

Spot checks done by hand while compiling these notes (all confirmed):
- UniswapX `WEBHOOK_TIMEOUT_MS_DEFAULT = 500`.
- Jupiter V1 quote timeout of 500 ms, 40 s swap timeout, 95% fill target and 55 s quote validity.
- 0x Settler `RFQ_VIP` commented out, and the `Consideration` witness fields.
- Hashflow's 750 ms `rfqTQuote` deadline.

Chain relevance for probabl: UniswapX DutchV3, 1inch Fusion/Fusion+ and BebopSettlement are all deployed on Robinhood Chain (4663). Details are in each section.

---

## 0. Cross-system summary

| System | Who gets the request | Push or pull | Maker deadline | Winner | Compared with AMM? | Last look | What the maker signs / settlement |
|---|---|---|---|---|---|---|---|
| 0x (current, Settler) | Curated maker list, filtered by pair and by integrator | Push, HTTP (legacy spec; current spec not public) | 600 ms (legacy `RFQT_REQUEST_MAX_RESPONSE_MS`) | Router mixes RFQ into the AMM route; RFQ only used where it beats the AMMs | Yes, two-phase routing | None in Settler RFQ; RFQ-M v1/v2 (legacy) had real maker last look | Permit2 `PermitWitnessTransferFrom` with a `Consideration` witness; `counterparty` = taker, `spender` = Settler |
| UniswapX | Uniswap-vetted quoter roster (S3 config), every enabled endpoint for the chain | Push, HTTP POST fan-out | 500 ms, all chains | Highest `amountOut` / lowest `amountIn`; gas not netted | Yes: Classic (AMM) quote fetched in parallel; UniswapX only shown if better (>300 USDC or ≥0.2% improvement) | None on-chain; fade circuit breaker off-chain | Swapper signs a Permit2 witness order; Uniswap cosigner adds the exclusive filler and amounts |
| 1inch Fusion | Order broadcast to all approved resolvers (KYC + Access NFT); optional exclusive-resolver RFQ | Orders pushed over WebSocket; exclusive quotes pushed as `POST /quote` | 500 ms (exclusive quote) | Dutch auction, first resolver to fill wins | User picks Fusion or Classic mode [unverified on automatic comparison] | None (resolvers just choose whether to fill); SLA for exclusive resolvers | Maker (user) signs a LOP v4 `Order`; the settlement extension enforces the resolver whitelist and the auction curve |
| Jupiter Z V1 | All registered webhooks advertising both tokens | Push, HTTP webhooks | 500 ms (newest docs) [conflict: 250 ms in older docs] | Best output, must pass simulation; competes with Metis, DFlow, OKX in the meta-aggregator | Yes | Explicit: `/swap` can be `rejected` | No signed struct; taker partially signs the Solana tx, maker co-signs last and sends; `expire_at` checked on-chain |
| Jupiter Z V2 | Makers stream books; only the winning maker gets `SWAP_AVAILABLE` | Pull from streamed books (gRPC) | n/a for quotes; 10 s to co-sign the swap | Metis quotes from the cached books | Yes | Yes: the maker may simply not co-sign | `rfq_v2` program `fill_exact_in`; maker co-signs as `fill_authority` |
| Hashflow | Allowlisted makers stream levels; only the winning maker(s) get `rfqT` | Pull from streamed levels; firm quote over WebSocket | 750 ms | Hashflow routes from levels; aggregators compare against AMMs | In the aggregator (e.g. Velora/ParaSwap) | None once signed | EIP-191 signature over packed `pool, trader, effectiveTrader, …, nonce, quoteExpiry, txid, chainid` |
| Bebop PMM | Only the maker(s) whose streamed levels give the best price | Pull from streamed levels; firm quote over WebSocket | 750 ms (p99 target ≤100 ms) | Best streamed price, can split across makers | Integrators told to compare themselves | Firm, no last look (legacy last-look path closed to new makers) | EIP-712 `SingleOrder`/`MultiOrder`/`AggregateOrder` (domain `BebopSettlement` v2) |
| Bebop JAM | Whitelisted solvers | Push, WebSocket | [unverified]; 2 s to confirm an execute request | "Best price" among solvers | [unverified] | Solver confirm step; rating penalties | Taker signs EIP-712 `JamOrder` (executor + `exclusivityDeadline`) |
| CoW Protocol | Every allow-listed (bonded) solver gets the whole auction | Push, `/solve` | 10 s default solve time (block-paced loop) | Fair combinatorial auction (CIP-67): score = surplus + protocol fees; second-price payment | Yes: EBBO rule (no worse than baseline AMMs), enforced after settlement by reimbursement and slashing | Solvers can fail to settle, which costs a negative reward and lowers their success-rate weight | User signs `GPv2Order.Data` (EIP-712, eth_sign, EIP-1271 or presign); `settle` is `onlySolver` |
| Velora Delta | Every registered agent (Portikus registry), minus integrator exclusions | Push, parallel sealed bids per round | [unverified] ("a few seconds") | Best **simulated** outcome among firm calldata bids (first-price) | `/v2/quote?mode=ALL` picks Delta or Market | None: "a commitment, not a quote… no second look"; a failed fill re-auctions the order | User signs a Portikus `Order` (EIP-712, ERC-2098 compact sig); settle is `onlyAuthorizedAgent` |
| Velora Market RFQ | Makers' cached ladders; firm `POST /firm` only to the chosen maker at tx build | Pull ladders, push the firm request | 4000 ms (`GET_FIRM_RATE_TIMEOUT_MS`) | Ladders routed alongside AMMs | Yes | Maker can refuse at `/firm`; repeated refusals can disable it | Maker signs an AugustusRFQ `Order` (EIP-712) with `taker` = Velora contract |

---

## 1. 0x

### 1.0 What is deprecated and what is current
- **0x API v1 was sunset on 2025-04-11.** In v2, token allowances are no longer set on the Exchange Proxy. https://docs.0x.org/docs/upgrading/upgrading-to-swap-v2.md
- **DEPRECATED legacy stack.** It all ran on the Exchange Proxy `0xdef1c0ded9bec7f1a1670819833240f027b25eff`:
  - RFQ-T: `NativeOrdersFeature.fillRfqOrder`, and `OtcOrdersFeature`.
  - RFQ-M: `MetaTransactionsFeature` and taker-signed OtcOrders.

  The proxy address is hard-coded as `RFQ_ALLOWANCE_TARGET` in https://github.com/0xProject/0x-api/blob/master/src/constants.ts. The repos `0xProject/0x-api` (last push 2024-09-15) and `0xProject/quote-server` are archived.
- **Current stack: 0x Settler with Permit2 and AllowanceHolder.** https://docs.0x.org/docs/core-concepts/contracts.md and https://github.com/0xProject/0x-settler
- **The only live RFQ action in Settler is `RFQ` (self-funded).**
  - `RFQ_VIP` is commented out in `src/Settler.sol` with the comment "RFQ_VIP is temporarily removed because Solver has no support for it" (commit `78e51e493d`, 2025-03-29). Checked by hand.
  - `METATXN_RFQ_VIP` is commented out in `src/SettlerMetaTxn.sol` (commit `e6d35d3a20`, 2025-04-30).
  - Sources: https://github.com/0xProject/0x-settler/blob/master/src/Settler.sol and https://github.com/0xProject/0x-settler/blob/master/src/SettlerMetaTxn.sol
- **The 0x FAQ is partly stale.** It still mentions `getOTCOrderInfo` and `expiryAndNonce` (legacy OtcOrder) in revert debugging. https://docs.0x.org/docs/introduction/faq.md

### 1.1 Who receives quote requests; push or pull; deadline
- **A curated list of makers.** "Each maker is identified by an HTTP endpoint URL, and each endpoint has an associated list of asset pairs… the 0x team is maintaining a list of trusted market makers." https://docs.0x.org/evm/0x-swap-api/additional-topics/about-the-rfq-system.md
- **Onboarding** is through the RFQ Interest Form and 0x team review. https://docs.0x.org/liquidity-integration/liquidity-integrations.md
- **Requests are pushed over HTTP to the maker's server (legacy reference implementation).**
  - Endpoints: `GET /price` (indicative), `GET /quote` (firm), `POST /submit` (RFQ-M v1), `GET rfqm/v2/price`, `POST rfqm/v2/sign`.
  - Authentication: `0x-api-key` header.
  - Source: https://github.com/0xProject/quote-server/blob/master/src/router.ts
  - Request parameters: `sellTokenAddress`, `buyTokenAddress`, `takerAddress`, `sellAmountBaseUnits`|`buyAmountBaseUnits`, `comparisonPrice`, `protocolVersion`, `txOrigin`, `isLastLook`, `fee`, `nonce`, `nonceBucket`. https://github.com/0xProject/quote-server/blob/master/src/types.ts
- **Maker config fields:** `makerId`, `apiKeyHashes`, `label`, `rfqtMakerUri`, `rfqtOrderTypes`/`rfqmOrderTypes` (`rfq`|`otc`), `rfqmMakerUri`. https://github.com/0xProject/0x-api/blob/master/src/schemas/rfq_maker_config.json
- **Filtering (legacy).**
  - By pair, through the `RfqMakerPairs` table.
  - By integrator: a code comment reads "Check if integrator ID specifically whitelists a set of maker URIs".
  - There is no performance-tier subset in the code I read.
  - Source: https://github.com/0xProject/0x-api/blob/master/src/services/swap_service.ts
- **Deadline (legacy).**
  - `RFQT_REQUEST_MAX_RESPONSE_MS` defaults to **600 ms** and is passed through as `makerEndpointMaxResponseTimeMs`. https://github.com/0xProject/0x-api/blob/master/src/config.ts
  - Internal RFQ-service calls time out at 600+150 ms for v1 and 3×600 ms for v2. https://github.com/0xProject/0x-api/blob/master/src/utils/rfq_client.ts
- **Current Settler-era maker API, transport and deadline: [unverified].** No public maker spec exists; the docs only point to the interest form.

### 1.2 Who sets the price and how the winner is picked
- **Makers set the price, but RFQ only enters the route if it beats the AMMs.** Maker quotes "may be included in the aggregated final price" only "if the market maker quotes are more competitive than AMM quotes". https://docs.0x.org/evm/0x-swap-api/additional-topics/about-the-rfq-system.md
- **No preference for RFQ.** "RFQ isn't routed to preferentially"; makers "must beat the on-chain AMM price". https://help.0x.org/articles/3310442497-understanding-0x-rfq-request-for-quote
- **Legacy routing was two-phase.**
  1. Optimise a route over DEX and orderbook liquidity only.
  2. Send that route's `wholeOrderPrice` to makers as `comparisonPrice`.
  3. Mix the RFQ quotes in and re-optimise.

  Firm quotes are then pruned to fillable amounts using a maker-balance cache (`PostgresRfqtFirmQuoteValidator`, 2-minute cache expiry). Sources: https://github.com/0xProject/0x-api/blob/master/src/asset-swapper/utils/market_operation_utils/index.ts and `src/services/postgres_rfqt_firm_quote_validator.ts`
- **Routes can split** across several RFQ makers and AMMs: responses show multiple `"source":"0x_RFQ"` fills with `proportionBps` next to Curve legs. https://docs.0x.org/docs/core-concepts/0x-cheat-sheet.md
- **2023 performance study (old).** RFQ gave the best price on 46% of trades across RFQ-enabled pairs, and 77% on the top-5 non-pegged pairs. https://0x.org/post/a-comprehensive-analysis-of-rfq-performance

### 1.3 Which orders go to RFQ
- **Current rules.**
  - RFQ needs the Customer API tier, not Standard. https://docs.0x.org/evm/0x-swap-api/additional-topics/about-the-rfq-system.md
  - It is included in `/quote` only when a `taker` is set. `/price` includes it without a taker. https://docs.0x.org/docs/upgrading/upgrading-to-swap-v2.md
  - No public size threshold [unverified].
- **Legacy gates, all required** (`swap_service.ts` and `market_operation_utils/index.ts` above):
  - the API key is on the RFQT ACL;
  - a taker address is present (or it is an ETH sell, or an indicative request);
  - a firm request has a `txOrigin`;
  - `isRfqSupported = !!(_opts.rfqt && !isTxOriginContract)`, so there is no RFQ when `tx.origin` is a contract;
  - `txOrigin` is not on a dynamic Postgres blacklist (30 s refresh, `RFQ_DYNAMIC_BLACKLIST_TTL`). https://github.com/0xProject/0x-api/blob/master/src/utils/rfq_blocked_address_utils.ts

### 1.4 Settlement code
**Current: the Settler `RFQ` action.** Source: https://github.com/0xProject/0x-settler/blob/master/src/core/RfqOrderSettlement.sol

```solidity
struct Consideration { IERC20 token; uint256 amount; address counterparty; bool partialFillAllowed; }
CONSIDERATION_TYPE    = "Consideration(address token,uint256 amount,address counterparty,bool partialFillAllowed)"
CONSIDERATION_WITNESS = "Consideration consideration)" + CONSIDERATION_TYPE + "TokenPermissions(address token,uint256 amount)"
RFQ_ORDER_TYPE        = "RfqOrder(Consideration makerConsideration,Consideration takerConsideration)" // hash only used in the log
// ISettlerActions:
function RFQ(address recipient, ISignatureTransfer.PermitTransferFrom permit, address maker, bytes makerSig, address takerToken, uint256 maxTakerAmount)
```

- **What the maker signs.** A Permit2 `PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,Consideration consideration)`:
  - `permitted` = {makerToken, makerAmount}
  - `spender` = the Settler instance
  - `nonce` = a Permit2 unordered nonce
  - `deadline` = expiry
  - `consideration` = {takerToken, takerAmount, counterparty = taker, partialFillAllowed}

  Source: https://github.com/0xProject/0x-settler/blob/master/README.md ("RFQ" section)
- **Verification.**
  - `fillRfqOrderSelfFunded` rebuilds the witness as `{token: takerToken, amount: maxTakerAmount, counterparty: _msgSender(), partialFillAllowed: true}` and calls `PERMIT2.permitWitnessTransferFrom`. Permit2 does the signature check (ECDSA or EIP-1271), the expiry check and the nonce bitmap. Checked by hand in source.
  - `_msgSender()` is the payer from transient storage: the taker, or the meta-transaction signer. So the quote is bound to the taker.
  - Signing `spender` binds the quote to one Settler deployment.
  - Forwarded calls revert (`ForwarderNotAllowed`). https://github.com/0xProject/0x-settler/blob/master/src/core/Permit2Payment.sol
- **Replay and expiry.** The README: "We use the Permit2 guarantees… RFQ Order cannot be filled more than once; RFQ Orders expire; RFQ Orders are signed by the Market Maker." (README above)
- **Partial fills.**
  - The taker's funds must already be in Settler (from an earlier hop). The taker amount is `min(balanceOf(Settler), maxTakerAmount)`.
  - The maker amount is pro-rated as `makerAmount*takerAmount/maxTakerAmount`, rounded down in the maker's favour. This absorbs slippage from an earlier AMM hop.
  - The nonce is consumed, so the quote is one-shot even if only partly filled [inference].
- **Removed `RFQ_VIP`.** It did two direct Permit2 transfers (taker→maker and maker→recipient) with `partialFillAllowed:false` on both sides.

**DEPRECATED: Exchange Proxy `LibNativeOrder`.** Source: https://github.com/0xProject/protocol/blob/development/contracts/zero-ex/contracts/src/features/libs/LibNativeOrder.sol

```solidity
struct RfqOrder { IERC20Token makerToken; IERC20Token takerToken; uint128 makerAmount; uint128 takerAmount;
  address maker; address taker; address txOrigin; bytes32 pool; uint64 expiry; uint256 salt; }
// "RfqOrder(address makerToken,address takerToken,uint128 makerAmount,uint128 takerAmount,address maker,address taker,address txOrigin,bytes32 pool,uint64 expiry,uint256 salt)"
// _RFQ_ORDER_TYPEHASH = 0xe593d3fdfa8b60e5e17a1b2204662ecbe15c23f2084b9ad5bae40359540a7da9
struct OtcOrder { IERC20Token makerToken; IERC20Token takerToken; uint128 makerAmount; uint128 takerAmount;
  address maker; address taker; address txOrigin; uint256 expiryAndNonce; } // [uint64 expiry | uint64 nonceBucket | uint128 nonce]
```

- **`fillRfqOrder(order, sig, takerTokenFillAmount)` via `_fillRfqOrderPrivate`.** https://github.com/0xProject/protocol/blob/development/contracts/zero-ex/contracts/src/features/native_orders/NativeOrdersSettlement.sol
  - The order status must be FILLABLE.
  - `order.txOrigin == tx.origin`, or the origin is registered through `registerAllowedRfqOrigins`.
  - `order.taker` is 0 or equal to the taker.
  - The EIP-712 signer is the maker, or a signer the maker registered with `registerAllowedOrderSigner`.
  - Partial fills are tracked in `orderHashToTakerTokenFilledAmount`. `fillOrKillRfqOrder` reverts on a partial fill.
- **Status rules** (https://github.com/0xProject/protocol/blob/development/contracts/zero-ex/contracts/src/features/native_orders/NativeOrdersInfo.sol):
  - EXPIRED if `expiry <= block.timestamp`;
  - CANCELLED if `minValidSalt > salt`, where the minimum is per (maker, makerToken, takerToken) and set by `cancelPairRfqOrders`;
  - INVALID if `txOrigin == 0`.
- **The `pool` field** is a bytes32 tag the maker can use for liquidity-pool attribution (field in the struct above).
- **How 0x-api filled it.** It set `takerAddress=0, txOrigin=user EOA`, so in practice the restriction was the user's `tx.origin`. (`swap_service.ts` above)
- **OtcOrders.** `fillOtcOrder` and `fillTakerSignedOtcOrder(order, makerSig, takerSig)`. Replay protection is `txOriginNonces[txOrigin][nonceBucket]`, which must strictly increase. https://github.com/0xProject/protocol/blob/development/contracts/zero-ex/contracts/src/features/OtcOrdersFeature.sol
- **RFQ-M v1** went through `MetaTransactionsFeature.executeMetaTransaction`, which allowed only the selectors `transformERC20`, `fillLimitOrder` and `fillRfqOrder`. https://github.com/0xProject/protocol/blob/development/contracts/zero-ex/contracts/src/features/MetaTransactionsFeature.sol
- **RFQ-M v2** used `fillTakerSignedOtcOrder` with 0x's relayer as `txOrigin` [inference].

### 1.5 Free option and last look
- **Firm, short-TTL quotes.** RFQ quotes are firm, valid for about 60 s on mainnet, and 0x recommends refreshing every ~30 s. https://help.0x.org/articles/3310442497-understanding-0x-rfq-request-for-quote and https://docs.0x.org/docs/introduction/faq.md
- **Legacy expiry filter.** `QUOTE_ORDER_EXPIRATION_BUFFER_MS = 60s` ("Ignore orders that expire in 60 seconds"). https://github.com/0xProject/0x-api/blob/master/src/constants.ts
- **DEPRECATED RFQ-M gave makers a true last look.**
  - `/submit` returned `{proceedWithFill: boolean ("must be true if maker agrees"), fee, signedOrderHash, takerTokenFillAmount}`.
  - `rfqm/v2/sign` received the taker-signed OtcOrder and returned `{proceedWithFill, makerSignature?, fee?}`. The maker signed only after the taker had committed.
  - Source: https://github.com/0xProject/quote-server/blob/master/src/types.ts
- **Settler RFQ has no on-chain last look**, because the maker's signature is already in the taker's calldata. A maker could still back out before inclusion by spending the Permit2 nonce or pulling allowance or balance [inference].
- **Wording trap.** 0x marketing says RFQ "grants your users… the last look", meaning the user, not the maker. https://0x.org/post/unlock-optimal-trades-in-swap-api-with-0x-rfq-liquidity
- **No public maker penalty, scorecard or offboarding policy found [unverified].**

### 1.6 Information leakage and MEV
- **Bound to the taker.** "The order can only be filled by the taker address specified in the order… prevents front-running". https://docs.0x.org/evm/0x-swap-api/additional-topics/about-the-rfq-system.md
- **MEV.** RFQ legs are "filled privately and atomically to prevent sandwiching/front-running". This does not cover the AMM legs of the same route. https://docs.0x.org/docs/introduction/faq.md
- **What makers learned (legacy).** Every polled maker saw `takerAddress`/`txOrigin` and the AMM benchmark `comparisonPrice`. That supports toxic-flow screening, and lets makers quote just inside the AMM price (`types.ts` above).

---

## 2. UniswapX

### 2.1 Who receives quote requests; push or pull; deadline
- **Quoters are permissioned.** "the set of quoters is vetted by Uniswap Labs". New quoters start in Beta and must show **5 valid exclusive RFQ fills** before moving to production. https://developers.uniswap.org/docs/liquidity/uniswapx/filling/mainnet/become-a-quoter.md
- **The roster is an S3 JSON config** (bucket `rfq-config`, keys `production.json` / `beta.json`). Each entry is `{name, hash, endpoint, headers, overrides.timeout, chainIds?, supportedVersions?}`. https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/constants.ts and https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/providers/webhook/index.ts
- **Requests are pushed** as an HTTP POST fan-out to **every** enabled endpoint, filtered only by:
  - the configured `chainIds`;
  - protocol version;
  - circuit-breaker status (skipped for permissioned tokens).

  There is no size or performance subset. https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/quoters/WebhookQuoter.ts
- **No per-chain whitelist.** "any MM that supports the chain receives RFQs once launched — no whitelist" (beyond the vetted roster). https://github.com/Uniswap/UniswapX/blob/main/playbook/NEW_CHAIN.md
- **Deadline: 500 ms on all chains.** `WEBHOOK_TIMEOUT_MS_DEFAULT = 500` (an earlier 250 ms value for non-mainnet chains was raised). Checked by hand. Per-endpoint `overrides.timeout` exists. https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/constants.ts
  - The docs say: "Respond to Every Quote Request Within 500ms… If you cannot quote, return a `204`". (become-a-quoter.md)
- **Infrastructure and load.** The quote server runs in AWS us-east-2, with source IPs to allow: prod `3.138.88.28`, beta `3.135.148.114`. Load is about 1 RPS on Ethereum. https://developers.uniswap.org/docs/liquidity/uniswapx/filling/faq.md
- **Request and response.**
  - Request: `requestId, quoteId, tokenInChainId, tokenOutChainId, swapper, tokenIn, tokenOut, amount, type (EXACT_INPUT|EXACT_OUTPUT), protocol, numOutputs`.
  - Response: `chainId, requestId, quoteId, tokenIn, amountIn, tokenOut, amountOut, filler`. `filler` is required because it is the attribution key for the circuit breaker.
  - Sources: become-a-quoter.md and https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/handlers/quote/schema.ts
- **Fillers are different from quoters.** Fillers pull open orders from `GET api.uniswap.org/v2/orders` (max 4 RPS, last 50 orders). Filler webhooks are DEPRECATED ("no longer onboarding"). https://developers.uniswap.org/docs/liquidity/uniswapx/filling/faq.md

### 2.2 Who sets the price and how the winner is picked
- **Winner selection.** `getBestQuote` takes the highest `amountOut` (exact-in) or lowest `amountIn` (exact-out). Gas is not netted at this stage. https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/quoters/best-quote.ts
- **Two RFQ rounds.**
  1. A soft (indicative) quote before the user signs (`POST /quote`).
  2. A hard quote after signing (`POST /hard-quote`). It re-runs the RFQ, has the cosigner sign, and posts the order.

  Quoters "cannot distinguish between indicative and hard quotes". https://developers.uniswap.org/docs/liquidity/uniswapx/concepts/uniswaprfq.md and https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/core/hard-quote.ts
- **AMM comparison.** The backend fetches a Classic (AMM) quote and the RFQ soft quote in parallel, and shows UniswapX only if it is better. https://developers.uniswap.org/docs/liquidity/uniswapx/concepts/auction-types.md
  - **Routing rule:** UniswapX is used when the order is >300 USDC equivalent, or when it beats the AMM by ≥0.2%. At or below 300 USDC the 0.2% improvement is required. https://developers.uniswap.org/docs/trading/swapping-api/amm-vs-uniswapx-routing.md
  - `routingPreference=FASTEST` excludes UniswapX (same page).
  - The trading-api `compareQuotes` code is private [unverified at code level].

### 2.3 Which orders go to RFQ
- **Size and deadline.** DutchV3 chains have a "$300 minimum order" and a 300 s deadline buffer (`DEFAULT_DUTCH_V3_ORDER_OVERRIDE`). https://github.com/Uniswap/UniswapX/blob/main/playbook/NEW_CHAIN.md
- **Tokens.** All tokens except those on the unsupported-token list. https://developers.uniswap.org/docs/liquidity/uniswapx/filling/faq.md
- **Kill switches:** `uniswapx_v3_rollout` (percentage rollout), `uniswapx_disabled_chains`, and a per-swapper `disable_uniswapx`. (NEW_CHAIN.md above)
- **Open orders without RFQ.** The hard-quote API supports `allowNoQuote` / `forceOpenOrder`, which create an open order with no exclusive filler. https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/handlers/hard-quote/schema.ts

### 2.4 Settlement code (https://github.com/Uniswap/UniswapX)
- **Reactors** (addresses from https://github.com/Uniswap/UniswapX/blob/main/README.md):
  - `V2DutchOrderReactor`, Ethereum mainnet: `0x00000011F84B9aa48e5f8aA8B9897600006289Be`
  - `V3DutchOrderReactor`, about 17 chains including Arbitrum, Base, Unichain, Monad, Ink and **Robinhood (4663)**: `0x000000007A1C8e570011EeDF86A2A35593013cBA`
  - `ExclusiveDutchOrderReactor` (v1.1): `0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4`
  - `PriorityOrderReactor`, Base: `0x000000001Ec5656dcdB24D90DFa42742738De729`
- **Flow.** `execute` / `executeBatch` / `executeWithCallback` / `executeBatchWithCallback`, then:
  1. `_resolve` (apply decay)
  2. `_prepare` (inject fees, `validate`, Permit2 pull)
  3. `reactorCallback` on `msg.sender`
  4. `_fill` (pull every output from the filler)

  https://github.com/Uniswap/UniswapX/blob/main/src/reactors/BaseReactor.sol
- **OrderInfo** (https://github.com/Uniswap/UniswapX/blob/main/src/lib/OrderInfoLib.sol):

  ```
  OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)
  ```

  `validate` reverts `InvalidReactor` unless `address(this) == info.reactor`, then calls `additionalValidationContract.validate(filler, order)`. https://github.com/Uniswap/UniswapX/blob/main/src/lib/ResolvedOrderLib.sol
- **V2DutchOrder** (mainnet), `{OrderInfo info; address cosigner; DutchInput baseInput; DutchOutput[] baseOutputs; CosignerData cosignerData; bytes cosignature}`.
  - `CosignerData = {decayStartTime, decayEndTime, exclusiveFiller, exclusivityOverrideBps, inputAmount, uint256[] outputAmounts}`.
  - The swapper's typehash is `V2DutchOrder(OrderInfo info,address cosigner,address baseInputToken,uint256 baseInputStartAmount,uint256 baseInputEndAmount,DutchOutput[] baseOutputs)` + `DutchOutput(address token,uint256 startAmount,uint256 endAmount,address recipient)` + OrderInfo.
  - **`cosignerData` is not in the swapper hash.** The cosigner signs `keccak256(orderHash || abi.encode(cosignerData))`, checked with `ecrecover`.
  - **Overrides can only improve terms for the swapper:** `InvalidCosignerInput` if input > start, `InvalidCosignerOutput` if output < start.
  - Sources: https://github.com/Uniswap/UniswapX/blob/main/src/lib/V2DutchOrderLib.sol and https://github.com/Uniswap/UniswapX/blob/main/src/reactors/V2DutchOrderReactor.sol
- **V3DutchOrder** (L2s), `{info, cosigner, startingBaseFee, V3DutchInput baseInput, V3DutchOutput[] baseOutputs, CosignerData{decayStartBlock, exclusiveFiller, exclusivityOverrideBps, inputAmount, outputAmounts[]}, cosignature}`.
  - **Block-based decay curve:** `NonlinearDutchDecay{uint256 relativeBlocks (16×uint16 packed); int256[] relativeAmounts}`, at most 16 points.
  - `V3DutchOutput{token,startAmount,curve,recipient,minAmount,adjustmentPerGweiBaseFee}`.
  - The cosigner digest adds the chain id: `keccak256(orderHash, block.chainid, abi.encode(cosignerData))`.
  - Expiry: `DeadlineReached` if `deadline < block.timestamp`.
  - On Arbitrum and Robinhood, block numbers come from `ArbSys.arbBlockNumber()` (via `BlockNumberish`). The Robinhood playbook warns that **block-based decay stalls when the chain is idle**.
  - Sources: https://github.com/Uniswap/UniswapX/blob/main/src/lib/V3DutchOrderLib.sol, https://github.com/Uniswap/UniswapX/blob/main/src/reactors/V3DutchOrderReactor.sol and https://github.com/Uniswap/UniswapX/blob/main/playbook/chains/robinhood.md
- **ExclusiveDutchOrder** (v1.1). The swapper signs the exclusivity fields directly; there is no cosigner. https://github.com/Uniswap/UniswapX/blob/main/src/lib/ExclusiveDutchOrderLib.sol

  ```
  ExclusiveDutchOrder(OrderInfo info,uint256 decayStartTime,uint256 decayEndTime,address exclusiveFiller,uint256 exclusivityOverrideBps,address inputToken,uint256 inputStartAmount,uint256 inputEndAmount,DutchOutput[] outputs)
  ```

- **PriorityOrder** (Base and OP-stack chains), `{info, cosigner, auctionStartBlock, baselinePriorityFeeWei, PriorityInput{token,amount,mpsPerPriorityFeeWei}, PriorityOutput[]{…,recipient}, PriorityCosignerData{auctionTargetBlock}, cosignature}`.
  - The price scales with `tx.gasprice - block.basefee - baseline`.
  - The Permit2 nonce is checked first, so losing transactions revert cheaply (`OrderAlreadyFilled`).
  - Sources: https://github.com/Uniswap/UniswapX/blob/main/src/lib/PriorityOrderLib.sol and https://github.com/Uniswap/UniswapX/blob/main/src/reactors/PriorityOrderReactor.sol
- **Signature, replay and expiry are handled by Permit2.**
  - Every reactor calls `permit2.permitWitnessTransferFrom(permit{token,maxAmount,nonce,deadline}, {to: filler, requestedAmount}, swapper, orderHash, "<Type> witness)…", sig)`. https://github.com/Uniswap/UniswapX/blob/main/src/lib/Permit2Lib.sol
  - Inside Permit2:
    - `SignatureExpired` if `block.timestamp > deadline`;
    - `InvalidAmount` if the amount is over the permitted amount;
    - EIP-1271 is supported;
    - the unordered nonce bitmap `nonceBitmap[owner][nonce>>8] ^= 1<<(nonce&0xff)` reverts `InvalidNonce` on reuse;
    - cancellation is `invalidateUnorderedNonces(wordPos, mask)`.

    https://github.com/Uniswap/permit2/blob/main/src/SignatureTransfer.sol
- **Who can fill.**
  - Anyone, as `msg.sender`. Since v1.1 the filling contract must itself call the reactor; v1.0 had a bug where a balance check could be met by filling another order. https://github.com/Uniswap/UniswapX/commit/cf53fc7dd48029a9189d26812d676a4ea9d08d6c
  - **ExclusivityLib.** The caller may fill if `exclusive==0 || now > exclusivityEnd || exclusive==msg.sender`. Otherwise it reverts `NoExclusiveOverride` when `overrideBps==0`, or the outputs are scaled by `(10000+bps)/10000`. https://github.com/Uniswap/UniswapX/blob/main/src/lib/ExclusivityLib.sol
  - **Hard exclusivity** is possible through `additionalValidationContract` (sample `ExclusiveFillerValidation`). https://github.com/Uniswap/UniswapX/blob/main/src/sample-validation-contracts/ExclusiveFillerValidation.sol
- **No partial fills.** The whole input is pulled once and all outputs are transferred in the same call; batching is the only aggregation. (BaseReactor.sol above)
- **Protocol fee** is capped at `MAX_FEE_BPS = 5`. https://github.com/Uniswap/UniswapX/blob/main/src/base/ProtocolFees.sol
- **Not in production:** `src/v4`, a modular Reactor with hooks and pluggable `IAuctionResolver`s (`HybridAuctionResolver`, a DCA hook). https://github.com/Uniswap/UniswapX/tree/main/src/v4

### 2.5 Free option, last look, exclusivity and penalties
**Cosigner defaults:**

| | Mainnet V2 | Arbitrum (legacy V2 path) | DutchV3 chains |
|---|---|---|---|
| Decay start | now + 24 s | now | current block + blocks for 5 s (`V3_DECAY_START_BUFFER_SECS = 5`, checked by hand) |
| Decay length | 60 s | 8 s | — |
| `exclusivityOverrideBps` | **100 (1%)** | 100 (1%) | **25** |

Sources: https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/core/hard-quote.ts and https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/constants.ts

- **Exclusivity has to be earned.** It is granted only if the hard quote beats the start amounts the swapper signed. Otherwise `exclusiveFiller = 0` and the order goes straight to the open Dutch auction. (hard-quote.ts and https://developers.uniswap.org/docs/liquidity/uniswapx/filling/faq.md)
- **[conflict] on window lengths.** The docs say about 24 s exclusivity on mainnet and about 2–4 s on DutchV3 chains, then "about one minute" of decay. The playbook says `V3_DECAY_DURATION_SECS = 8`. https://developers.uniswap.org/docs/liquidity/uniswapx/concepts/auction-types.md and https://github.com/Uniswap/UniswapX/blob/main/playbook/NEW_CHAIN.md
- **No on-chain last look.** The quoter's commitment is enforced off-chain by the **fade circuit breaker**.
- **What counts as a fade** (`classifyOutcome` in https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/cron/order-service-fades-source.ts):
  - V3: `fillBlock > decayStartBlock`. V2: `fillTimestamp > decayStartTime`.
  - Expired orders always count as fades.
  - Cancelled, insufficient-funds and error orders are excluded by default.
  - A fill by someone else after the window counts as the winner's fade; an override fill inside the window does not.
- **Breaker parameters in code** (10-minute cron, https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/core/circuit-breaker.ts):
  - Laplace-smoothed fade rate with α=1, β=19 (a 5% prior), over 24 h or the latest 100 orders per address.
  - The quoter is blocked when the rate exceeds `FADE_RATE_BLOCK_THRESHOLD = 0.12`.
  - Block length is `15 min × 2^consecutiveBlocks`, exponent capped at 7 (about 32 h). It takes 6 clean runs to decay one level.
  - A "chronic rate" watchlist also exists.
- **[conflict] the docs give an older formula:** `15 min × 1.5^(fades−1) × 2^(consecutiveOffenses)`, with removal from the quoter set above about 10% fade. https://developers.uniswap.org/docs/liquidity/uniswapx/filling/faq.md
- **Notifications and timeouts.** Benched quoters get a notice POST `{blockUntilTimestamp}` on their endpoint. Endpoints that keep timing out may be disabled at Uniswap's discretion. (become-a-quoter.md and WebhookQuoter.ts)

### 2.6 Information leakage and MEV
- **Two-sided requests and fresh IDs.** Every RFQ is sent together with an **inverse request**, in random order. Each request has a fresh on-the-wire `requestId` and a per-request `quoteId`, so makers can't tell which side is real or correlate requests across makers. Mismatched ids are rejected. https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/lib/quoters/WebhookQuoter.ts and the FAQ ("obfuscate the swapper's actual request and reduce the chances of front-running")
- **The swapper's address is still sent** in the request (schema.ts above).
- **The cosigner protects the price.** Only the cosigner (Uniswap Labs) can set terms inside the signed range, and only in the swapper's favour. https://developers.uniswap.org/docs/liquidity/uniswapx/concepts/uniswaprfq.md
- **Orders are public** once posted (orders API).

### 2.7 Deprecated or changed
- The original `DutchOrderReactor` (v1.0) is no longer in use (the bug above).
- RFQ v1 (one pre-signature quote) was replaced by v2 (indicative, then hard quote).
- Priority gas auctions are DEPRECATED; Base and Arbitrum moved to DutchV3 RFQ. https://developers.uniswap.org/docs/liquidity/uniswapx/filling/priority-chain/filling-on-op-stack.md
- "Gouda" was the internal codename (the `GoudaParameterizationStack` CDK stack). https://github.com/Uniswap/uniswapx-parameterization-api/blob/main/README.md

---

## 3. 1inch Fusion, Fusion+ and the Limit Order Protocol (LOP) v4

### 3.1 Who receives orders and quote requests
- **Orders are broadcast.** The Relayer API accepts orders and broadcasts them to resolvers over WebSocket (`wss://api.1inch.com/fusion/ws`). https://github.com/1inch/fusion-sdk/blob/main/src/ws-api/README.md
- **Exclusive Resolver API (RFQ-like, "testing phase").** A push `POST /quote` to approved resolver endpoints.
  - Request: `chainId, makerAsset, takerAsset, makerAmount, minTakerAmount, makerAddress, quoteId, gasBumpEstimate, gasPriceEstimate`.
  - Response: `grid[]` of up to 50 `{makerAmount, initialRateBump}` entries (1e7 = 100%).
  - **Deadline 500 ms including network.**
  - https://business.1inch.com/portal/assets/docs-v2/resolvers/exclusive-resolver-terms.md
- **On-chain whitelist (mainnet).** `WhitelistRegistry 0xcb8308fcB7BC2f84ed1bEa2C016991D34de5cc77`, read live with `eth_call`: `whitelistLimit()=10`, `resolverThreshold()=1e20` (100 Unicorn Power), token = PowerPod; 10 addresses whitelisted.
  - The deployed contract is older than repo `main`, which uses a percentage-of-supply threshold plus `clean()`. https://github.com/1inch/limit-order-settlement/blob/main/contracts/WhitelistRegistry.sol
- **Current access policy.** UP-based whitelisting, farming and exclusivity are "currently disabled for Fusion and Limit Orders as per 1IP-89". Access instead requires KYC/KYB, a compliance survey and a per-chain **Access NFT** (`KycNFT 0xAccE550000863572B867E661647CD7D97b72C507`).
  - Sources: https://business.1inch.com/portal/assets/docs-v2/resolvers/introduction.md and https://github.com/1inch/limit-order-settlement/blob/main/README.md
  - The 1IP-89 text itself: [unverified].
  - A 1RC forum proposal (2025-10-11) to drop the 5% UP threshold had 0 votes when checked. https://gov.1inch.network/t/1rc-update-to-resolver-access-requirements-for-fusion-order-flow/836

### 3.2 Price and winner
- **A Dutch auction on the LOP.** The rate decays from `initialRateBump` above `takingAmount` (the minimum return) down to zero over `auctionDuration`. The **first resolver to fill at the current rate wins**; the exclusive slot is the only off-chain best-bid step. https://business.1inch.com/portal/assets/docs-v2/apis/swap/intent-swap/introduction.md
- **Quoter presets.** The Quoter returns `presets {fast, medium, slow, custom}`, each with `auctionDuration, startAuctionIn, initialRateBump, auctionStartAmount, auctionEndAmount, points[], gasCost{gasBumpEstimate,gasPriceEstimate}, exclusiveResolver, allowPartialFills, allowMultipleFills`. It also returns `marketAmount` and `whitelist[]`. https://github.com/1inch/fusion-sdk/blob/main/src/api/quoter/types.ts
- **[unverified]:**
  - how the start price is derived (Pathfinder market rate) and the preset durations;
  - whether the Classic aggregator compares PMM/RFQ quotes against AMMs. LOP RFQ orders exist "for professional market makers". https://business.1inch.com/portal/assets/docs-v2/apis/orderbook/sdk/advanced-usage.md

### 3.3 Which orders go to resolvers
- **The user picks the mode:** Fusion (intent) or Classic. https://business.1inch.com/portal/assets/docs-v2/apis/swap/swap.md
- **Splitting.** 1inch recommends splitting orders into 6–10 parts for resolvers.
- **Chains.** Fusion is live on 18 chains, including **Robinhood Chain 4663 (Bitstamp RWAs)**. https://business.1inch.com/portal/assets/docs-v2/apis/swap/intent-swap/introduction.md

### 3.4 Settlement code (LOP v4 inside Router v6 `0x111111125421cA6dc452d289314280a0f8842A65`)
- **EIP-712 domain** `("1inch Limit Order Protocol","4")`. https://github.com/1inch/limit-order-protocol/blob/main/contracts/LimitOrderProtocol.sol
- **Order typehash.** When `HAS_EXTENSION` is set, the low 160 bits of `salt` must equal those of `keccak256(extension)`. https://github.com/1inch/limit-order-protocol/blob/main/contracts/OrderLib.sol

  ```
  Order(uint256 salt,address maker,address receiver,address makerAsset,address takerAsset,uint256 makingAmount,uint256 takingAmount,uint256 makerTraits)
  ```

- **makerTraits** (https://github.com/1inch/limit-order-protocol/blob/main/contracts/libraries/MakerTraitsLib.sol):
  - Flag bits: 255 `NO_PARTIAL_FILLS`, 254 `ALLOW_MULTIPLE_FILLS`, 252 PRE_INTERACTION, 251 POST_INTERACTION, 250 `NEED_CHECK_EPOCH_MANAGER`, 249 HAS_EXTENSION, 248 USE_PERMIT2, 247 UNWRAP_WETH.
  - Low bits: uint80 **allowedSender** (last 10 bytes of the address; 0 = anyone), uint40 **expiration**, uint40 nonceOrEpoch, uint40 series.
- **Fill functions.** `fillOrder(order, r, vs, amount, takerTraits)` and `fillOrderArgs(..., args)` for EOA makers (signature checked with `ECDSA.recover` on the first fill only). `fillContractOrder[Args]` for EIP-1271 makers.
- **Checks, in order:** `PrivateOrder` (allowedSender), `OrderExpired`, epoch, predicate, taker `threshold` (the taker's slippage limit), `PartialFillNotAllowed`. https://github.com/1inch/limit-order-protocol/blob/main/contracts/OrderMixin.sol
- **Replay protection.** https://github.com/1inch/limit-order-protocol/blob/main/contracts/libraries/BitInvalidatorLib.sol
  - If `!allowPartial || !allowMultiple`, a one-shot **BitInvalidator** bit per (maker, nonce) is used; mass cancel via `bitsInvalidateForOrder`.
  - Otherwise a **RemainingInvalidator**`[maker][orderHash]` tracks the remaining amount, which allows multiple partial fills.
- **DEPRECATED: separate RFQ orders.** "Separate RFQ order are deprecated in v4" (`fillOrderRFQ` removed). An RFQ is now a plain order with no multiple fills, a single partial fill allowed, an expiry, a nonce and an optional allowedSender. https://github.com/1inch/limit-order-protocol/blob/main/README.md and https://github.com/1inch/limit-order-sdk/blob/master/src/rfq-order/rfq-order.ts
- **Fusion order expiry** is `auctionStart + duration + orderExpirationDelay` (default 12 s). https://github.com/1inch/fusion-sdk/blob/main/src/fusion-order/fusion-order.ts
- **SimpleSettlement / Settlement extension** (`0x2Ad5004c60e16E54d5007C80CE329Adde5B51Ef5`) is both the amount getter and the post-interaction. https://github.com/1inch/limit-order-settlement/blob/main/contracts/SimpleSettlement.sol
  - **Auction encoding:** `AuctionDetails = {bytes3 gasBumpEstimate; bytes4 gasPriceEstimate; bytes4 auctionStartTime; bytes3 auctionDuration; bytes3 initialRateBump; (bytes3 rateBump, bytes2 timeDelta)[N]}`.
  - **Rate curve.** The bump is piecewise linear and held at `initialRateBump` before the start. `gasBump = gasBumpEstimate·basefee/gasPriceEstimate/1e6` is subtracted, and `taking = base·(1e7+bump)/1e7`.
  - **Whitelist and staggered access.** Whitelist data is `bytes4 allowedTime; uint8 size; (bytes10 addr, bytes2 delta)[]`, so each resolver unlocks at a cumulative delay. A non-listed taker reverts `AllowedTimeViolation` until the schedule ends, and must still hold the `ACCESS_TOKEN` (`OnlyWhitelistOrAccessToken`).
- **Fees** (https://github.com/1inch/limit-order-protocol/blob/main/contracts/extensions/AmountGetterWithFee.sol and `FeeTaker.sol`):
  - integrator fee and share;
  - resolver fee, discounted for whitelisted resolvers;
  - protocol surplus fee on output above `estimatedTakingAmount`.

  Limit-order fees are 5 bps on stable pairs and 30 bps otherwise (resolver introduction page above). Deployed bytecode may lag `main` [unverified].

### 3.5 Free option, exclusivity and penalties
- **Exclusive resolver.** `allowFrom=0` for that resolver, and `auctionStartTime` for everyone else. During `startAuctionIn` the exclusive resolver alone can fill at the top rate. https://github.com/1inch/fusion-sdk/blob/main/src/fusion-order/whitelist/whitelist.ts and https://github.com/1inch/fusion-sdk/blob/main/src/api/quoter/quote/quote.ts
- **Commitment and SLA for exclusive resolvers** (https://business.1inch.com/portal/assets/legal-docs/resolvers/terms-of_use_resolvers_20260727.pdf):
  - the filled maker amount must match the grid entry for that `initialRateBump`;
  - **fill rate ≥90% over a rolling 7 days, 500 ms response time**;
  - escalation: warning, then 7-day suspension, then 30-day block; 1inch may revoke the Access NFT at its discretion;
  - the Terms also ban using non-public Relayer or Exclusive API data to front-run.
- **Open auction: no last look.** Resolvers simply choose whether to fill.

### 3.6 MEV
- **Priority-fee cap.** The mainnet `Settlement` caps the priority fee at 70%, 50% or 65% of basefee depending on the basefee band (set by a 1inch DAO Snapshot), so resolvers can't burn the user's surplus on gas. https://github.com/1inch/limit-order-settlement/blob/main/contracts/Settlement.sol
- **Private flow.** Fills "never become a public pending transaction" (repo README).
- **Fusion+ (cross-chain).**
  - Escrows: the resolver fills on the LOP, which creates `EscrowSrc`, then funds `EscrowDst`, posting safety deposits on both chains.
  - The relayer releases the secret once both escrows are confirmed.
  - Partial fills use a Merkle tree of N+1 secrets.

  https://github.com/1inch/cross-chain-swap/blob/master/docs/protocol.md

---

## 4. Jupiter Z (Solana)

### 4.0 Status
- **Two maker integrations run side by side** (V2 does not replace V1).
  - **V1** uses HTTP webhooks and settles through the Order Engine program. https://developers.jup.ag/docs/swap/routing/rfq/v1/overview
  - **V2** uses gRPC streams. Metis reads the books, and fills go through the Jupiter v6 aggregator, which calls `rfq_v2`. https://developers.jup.ag/docs/swap/routing/rfq/v2/streaming
- **DEPRECATED: the Ultra Swap API** ("no longer actively maintained"). It is replaced by Swap API V2 `api.jup.ag/swap/v2` (same `/order` + `/execute` shape). https://developers.jup.ag/docs/api-reference/ultra/routers and https://developers.jup.ag/docs/swap
- **Standalone taker API:** `api.jup.ag/swap/v2/jupiterz/{order,global-order,execute}`. https://jupiterz.jup.ag/docs/integrators/order
- **[conflict] the sources disagree on V1 parameters:**

| Parameter | developers.jup.ag (newest) | GitHub README | jupiterz.jup.ag pages |
|---|---|---|---|
| Quote timeout | **500 ms** (checked by hand) | 250 ms | 250 ms |
| Swap timeout | **40 s** | — | 25 s |
| Circuit-breaker backoff | 2.5–15 min | — | 5–30 min |
| "Slow user" exclusion | 15 s | — | 20 s |

Sources: https://developers.jup.ag/docs/swap/routing/rfq/v1/webhook-api, https://developers.jup.ag/docs/swap/routing/rfq/v1/quoting, https://github.com/jup-ag/rfq-webhook-toolkit/blob/main/README.md, https://jupiterz.jup.ag/docs/faq, https://jupiterz.jup.ag/docs/circuit_breaker

### 4.1 Who receives requests; push or pull; deadline
- **V1 pushes `/quote` to every registered webhook at once**, filtered to makers that advertise both tokens via `GET /tokens` (polled every 10 min). https://github.com/jup-ag/rfq-webhook-toolkit/blob/main/README.md and https://developers.jup.ag/docs/swap/routing/rfq/v1/webhook-api
  - Speed only breaks exact ties. https://developers.jup.ag/docs/swap/routing/rfq/v1/settlement
  - **Whitelist.** Onboarding goes through a support form, then the Edge (pre-production) environment, then production. https://developers.jup.ag/docs/swap/routing/rfq/v1/overview
  - Only production webhooks are synced, and suspended webhooks get no requests. https://jupiterz.jup.ag/docs/api/permissioned-tokens and https://jupiterz.jup.ag/docs/circuit_breaker
  - **Deadline headers.** `x-request-start` and `x-request-timeout` ("currently 500 ms") are sent with each request; late quotes are excluded. https://developers.jup.ag/docs/swap/routing/rfq/v1/webhook-api
  - **No penalty for a 404** (not quoting the pair or size). (toolkit README)
- **V2 is a stream (pull) model.** Makers push multi-level book snapshots on `StreamQuotes`; the server keeps 5 levels per side. https://jupiterz.jup.ag/docs/v2/grpc-api
  - There is no per-request deadline. `quote_expiry_time` is in seconds, minimum 10.
  - Quotes are rejected unless the maker's `StreamSwap` is live, the maker is in `prod` status, sequence numbers strictly increase and the on-chain ATA balance covers the levels; levels above balance are dropped.
  - **Only the winning maker** receives `SWAP_AVAILABLE`. https://developers.jup.ag/docs/swap/routing/rfq/v2/streaming

### 4.2 Price and winner
- **Makers set the price.** The best value wins (highest output for ExactIn, lowest input for ExactOut), and quotes must pass simulation. https://jupiterz.jup.ag/docs/faq
  - A missing ATA or thin inventory fails simulation and the quote is silently dropped. https://developers.jup.ag/docs/swap/routing/rfq/v1/webhook-api
- **All routers compete in the meta-aggregator (`/order`):** Metis (Jupiter's AMM router), JupiterZ, DFlow and OKX. The `router` field names the winner. https://developers.jup.ag/docs/swap and https://developers.jup.ag/docs/swap/order-and-execute
- **Executed price, not quoted price.** Ultra "simulates and compares executed prices (not just quoted prices)" ("Predictive Execution"). https://developers.jup.ag/docs/ultra and https://developers.jup.ag/blog/ultra-v3
- **"Self-learning".** Juno has a mechanism that sidelines weak sources. https://docs.jup.ag/user-docs/trade/spot/ultra-mode
- **Hashflow as a source.** The user docs list it; the API router list does not [unverified for the API]. https://developers.jup.ag/docs/api-reference/ultra/routers
- **The exact net-of-fee/gas scoring formula is not published [unverified].** RFQ is gasless for the user, because the maker pays the fees.

### 4.3 Which orders go to RFQ
- **Only `/order` (meta-aggregator) routes to JupiterZ.** The `/build` path cannot, because RFQ transactions "cannot be modified" and makers hold last look. https://developers.jup.ag/docs/swap
- **What disables it.** JupiterZ is disabled by `payer ≠ taker` or `excludeRouters=jupiterz`; it stays eligible with `receiver` or referral params. https://developers.jup.ag/docs/swap/order-and-execute
- **Taker required for firm quotes.** Without a `taker`, quotes are indicative only. https://jupiterz.jup.ag/docs/integrators/order
- **ATA rent.** RFQ is skipped if the user needs an ATA and cannot pay rent. https://docs.jup.ag/user-docs/trade/spot/ultra-mode
- **No global size threshold.** Makers set size ranges by returning 404. https://jupiterz.jup.ag/docs/faq and the toolkit README
- **Permissioned (JIT mint/burn RWA) tokens such as xStocks and Ondo.** Quote simulation and balance checks are skipped (fixed 200k compute units), and the maker must mint or burn atomically, because the transaction message is already fixed. https://jupiterz.jup.ag/docs/api/permissioned-tokens

### 4.4 Settlement code
**V1: Order Engine `61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH`** (Offside Labs audit, Nov 2024; toolkit README)
- **One instruction:** `fill(input_amount: u64, output_amount: u64, expire_at: i64)`. https://github.com/jup-ag/rfq-webhook-toolkit/blob/main/programs/order-engine/src/lib.rs
  - Accounts: `taker: Signer`, `maker: Signer`, token accounts constrained by authority and mint, mints, token programs.
  - `require_gte!(expire_at, Clock.unix_timestamp)`. Token-2022 transfer-fee mints are rejected.
  - https://github.com/jup-ag/rfq-webhook-toolkit/blob/main/programs/order-engine/src/instructions/fill.rs
- **No signed struct and no nonce.** Both parties sign the whole Solana transaction message. Replay protection comes from Solana's signature and recent-blockhash dedup plus `expire_at` [inference].
- **Signing order.** The maker is the fee payer (signer 0); the taker is signer 1, or 2 when a third-party ATA payer is present. The **taker partially signs first, then the maker signs last and sends.** https://github.com/jup-ag/rfq-webhook-toolkit/blob/main/order-engine-sdk/src/fill.rs and https://developers.jup.ag/docs/swap/routing/rfq/v1/overview
- **Message validation.** `validate_similar_fill_sanitized_message` allows only compute-budget changes and extra Lighthouse assertion instructions (discriminators 5, 6, 9, 10). `MemoryWrite` is banned because it "can drain the signer". `validate_fill_sanitized_message` checks the fee payer, taker, amounts and `expire_at`. (order-engine-sdk/src/fill.rs)
- **Quote TTL** is fixed at **55 s**, with a 20 s buffer reserved for the maker. **No partial fills.** https://developers.jup.ag/docs/swap/routing/rfq/v1/quoting
- **Fee metadata.** The instruction carries 5 trailing bytes: `fee_bps u16 | flags u8 | integrator_fee_bps u16`. (quoting page)

**V2: `rfq_v2` `fd3nMFYTQjX1yr5ER8u7tPdHJB7qt8RpDpNtLQX2Br5`** (https://github.com/jup-ag/rfq-v2-sdk/blob/main/fill-decoder/idls/rfq_v2.json)
- **Instruction:** `fill_exact_in(taker_side: Side{Bid,Ask}, amount_in_atoms: u64, params: FillExactInParams{expire_at: u64, tick_size_qpb: u64, lot_size_base: u64, levels: Vec<Level{px_ticks, qty_lots}>})`.
  - Signers: `user` and `fill_authority` (the maker). The `instructions_sysvar` account is passed in.
- **Errors:** `StaleOrderbook` 6002, `InvalidLevelOrdering` 6003, `InvalidCaller` 6004, `MakerAppearsInOtherInstruction` 6005. The last one blocks "wrap and drain" attacks.
- **Signing.** The taker signs at index 0. The maker co-signs at index 1 and must not change any bytes; tampering puts the maker offline. The server submits. https://jupiterz.jup.ag/docs/v2/last-look-and-safety

### 4.5 Free option, last look and penalties
- **Last look is explicit.** https://developers.jup.ag/docs/swap
  - **V1:** `/swap` returns `accepted`, `rejected` or `rejectedWithReason` (`InsufficientBalance`, `InsufficientBalanceForAtaCreation`, `SignatureVerificationFailed`, `BotActivityDetected`). https://github.com/jup-ag/rfq-webhook-toolkit/tree/main/webhook-api/src
  - **V2:** the maker just doesn't co-sign within 10 s (the default). The swap expires with **no fallback to the next quote**. https://jupiterz.jup.ag/docs/v2/last-look-and-safety
- **The taker's free option is bounded.** The quote TTL is 55 s with a 20 s maker reserve; the frontend re-quotes every 3 s (5 s per the README) [conflict]. https://developers.jup.ag/docs/swap/routing/rfq/v1/quoting
- **V1 penalties.**
  - **Fill target ≥95% of quotes won.** The 24 h monitor only alerts (checked by hand). The README's older wording is that falling under 95% in 1 h switches the maker off.
  - **Circuit breaker.** Rejected, dropped and failed swaps count as failures; slow-user rejections are excluded. Each success decays the failure count by ×0.8. About 5 failures suspends the maker with exponential backoff; about 8 trips disables it permanently (manual recovery).
  - If more than 70% of makers are suspended, auto-suspension pauses.
  - Persistent 5xx errors suspend the webhook.
  - Sources: https://developers.jup.ag/docs/swap/routing/rfq/v1/settlement and https://jupiterz.jup.ag/docs/circuit_breaker
  - For permissioned pairs, Jupiter "only penalises rejections it finds dishonest". https://jupiterz.jup.ag/docs/api/permissioned-tokens
- **V2 penalties.** The fill-rate breaker is **off by default**. When on: 1 h window, at least 10 swaps, 50% threshold, 10 min suspension. Only no-response and late responses count; tampering is an instant offline. https://jupiterz.jup.ag/docs/v2/lifecycle-and-circuit-breaker

### 4.6 Information leakage and MEV
- **V1 leaks the request to every maker for the pair.** Quote requests carry `taker` (optional), `receiver`, `feeBps` and `source` (internal vs integrator). https://github.com/jup-ag/rfq-webhook-toolkit/tree/main/webhook-api/src
- **V2 book visibility.** `GetAllOrderbooks` accepts "an internal token or any valid maker API key", so makers can apparently see each other's books [inference]. https://jupiterz.jup.ag/docs/v2/grpc-api
- **MEV.**
  - Fills are zero-slippage and firm. https://jupiterz.jup.ag/docs/integrators/order
  - Ultra/Beam lands transactions privately. https://developers.jup.ag/docs/ultra
  - In V1 the maker lands the transaction itself, and Lighthouse assertions let wallets add guards.

---

## 5. Hashflow

### 5.0 Status
- **Current API is v3:** Maker API v3 (JSON WebSocket) and Taker API v3 (REST). https://docs.hashflow.com/hashflow/market-making/getting-started-api-v3.md and https://docs.hashflow.com/hashflow/taker/getting-started-api-v3.md
- **Chains.** The EVM factory is on Ethereum, Arbitrum, Optimism, Polygon, BSC, Avalanche and Base. The Solana program is `CRhtqXk98ATqo1R8gLg7qcpEMuvoPzqD5GNicPPqLMD`. (MM doc)
- **Contracts repo.** https://github.com/hashflownetwork/x-protocol (last commit 2025-02-15, "Deploy to Monad Testnet").
- **DEPRECATED: the old router.** It was retired on 2022-05-03. Lingering approvals were drained in June 2023 (about $600k; secondary source). https://www.theblock.co/post/234671/trading-firm-hashflow-faces-ongoing-exploit-with-600000-lost-so-far-peckshield
- **RFQ-M appears unused.** It still exists on-chain (`tradeRFQM`, `tradeRFQMLimitOrder`), but the v3 API docs only cover RFQ-T [inference].
- **HFT token news.** Reports of an Aug 2026 Binance delisting are secondary only [unverified].

### 5.1 Who receives the request; push or pull; deadline
- **Allowlisted makers.** Pool creators must be allowlisted by the Hashflow team. (MM doc)
- **Connection.** Makers connect to `wss://maker-ws.hashflow.com/v3` with the headers `marketmaker`, `authorization` and optional `marketmakerindex`. The server pings every 30 s. (MM doc)
- **Makers stream price levels.** They push `priceLevels` "every second for every supported pair".
  - The book is non-cumulative `{q, p}` levels: `buyLevels` = the maker buys base, `sellLevels` = the maker sells base.
  - The first level is the minimum size. Empty levels mean "not available".
  - Source: MM doc.
- **Only the winning maker(s) get the RFQ.** "The Hashflow servers determine the best way to route that RFQ among the existing Market Makers. The winning Market Maker(s) receive" an `rfqT` message `{rfqId, source, nonce, baseChain, quoteChain, baseToken, quoteToken, trader, effectiveTrader, baseTokenAmount|quoteTokenAmount, feesBps, baseTokenPriceUsd}`. (MM doc)
- **Deadline: `rfqTQuote` "within 750ms"** (checked by hand). (MM doc)
- **Taker controls.**
  - Takers can target `marketMakers[]` or `excludeMarketMakers[]`.
  - The API retries with the next-best maker unless `options.doNotRetryWithOtherMakers` is set.
  - `/taker/v3/market-makers` and `/taker/v3/price-levels` can be polled about once a second.
  - Source: taker doc.

### 5.2 Price and winner
- **Makers price, Hashflow routes.** The winner is chosen from the streamed levels.
- **Quotes are checked against levels.** Quotes must "respect the price level values sent… Hashflow servers will check the quote values for correctness against Price Levels and penalize Market Makers that do not respect the prices sent in advance." The form of the penalty is [unverified]. (MM doc)
- **Fees are applied by the maker.** `feesBps` is applied in the quote and remitted monthly to aggregators. (MM doc)
- **Protocol fees.** Dynamic on blue-chip pairs (adjusting about every 5 s), static otherwise. https://docs.hashflow.com/hashflow/hashflow/protocol-fees-and-revenue-share.md
- **The AMM comparison happens in the aggregator.** Example: Velora/ParaSwap's dex-lib.
  - It prices Hashflow from levels polled every 1 s (3 s cache, 100k gas modelled).
  - It requests a firm RFQ only when building the transaction, and only to the chosen maker (`marketMakers:[mm]`).
  - It rejects the quote if it is worse than the indicative price beyond the slippage factor.
  - Sources: https://github.com/paraswap/paraswap-dex-lib/blob/master/src/dex/hashflow/constants.ts and `src/dex/hashflow/hashflow.ts`

### 5.3 Which orders go to makers
- **Size and pairs are bounded by the levels:** the minimum is the first level, the maximum the sum of all levels. (taker doc)
- **Maker error codes:** `compliance`, `rate_limit` (with `expiryTimestampMs`), `insufficient_liquidity`, `pair_not_supported`, `market_conditions`. (MM doc)
- **Trader restrictions.** Makers can POST restrictions to `/maker/v3/restriction`; restricted traders are auto-routed to other makers. https://docs.hashflow.com/hashflow/market-making/how-to-guides.md
- **Taker credentials.** Every request needs a `source` and API key, issued by Hashflow. (taker doc)

### 5.4 Settlement code
Sources: https://github.com/hashflownetwork/x-protocol/blob/main/evm/contracts/interfaces/IQuote.sol, `evm/contracts/pools/HashflowPool.sol`, `evm/contracts/HashflowRouter.sol`

```solidity
struct RFQTQuote { address pool; address externalAccount; address trader; address effectiveTrader; address baseToken; address quoteToken;
  uint256 effectiveBaseTokenAmount; uint256 baseTokenAmount; uint256 quoteTokenAmount; uint256 quoteExpiry; uint256 nonce; bytes32 txid; bytes signature; }
struct RFQMQuote { address pool; address externalAccount; address trader; address baseToken; address quoteToken;
  uint256 baseTokenAmount; uint256 quoteTokenAmount; uint256 quoteExpiry; bytes32 txid; bytes takerSignature; bytes makerSignature; }
```

- **The maker's RFQ-T signature is EIP-191, not EIP-712**:
  `keccak256("\x19Ethereum Signed Message:\n32", keccak256(abi.encodePacked(address(this)/*pool*/, trader, effectiveTrader, externalAccount, baseToken, quoteToken, baseTokenAmount, quoteTokenAmount, nonce, quoteExpiry, txid, block.chainid)))`
  - `effectiveBaseTokenAmount` is not signed. `txid` is the `rfqId`.
- **Verification.**
  - `HashflowPool.tradeRFQT` can only be called by the router. It checks that the signature recovers to `signerConfiguration.signer`: one secp256k1 signer per pool, rotatable with `updateSigner`.
  - It also requires `signerConfiguration.enabled`, a killswitch the router owner controls through `killswitchPool`.
  - The pool exposes ERC-1271 `isValidSignature` against the same signer.
- **Router checks** (`_validateRFQTQuote`):
  - `effectiveBaseTokenAmount <= baseTokenAmount`
  - `quoteExpiry >= block.timestamp`
  - `nonce <= (block.timestamp+180)*1000`, which means nonces are millisecond timestamps [inference]
  - `authorizedPools[pool]`
- **Replay protection.** RFQ-T uses `nonce > nonces[effectiveTrader]` per pool, a monotonic nonce per trader; `txid` is not used here. RFQ-M uses `_usedTxids[txid]`.
- **Who can fill.** There is **no `msg.sender == trader` check** in RFQ-T. The router pulls from `_msgSender()` and pays `quote.trader`, so a third party could only fill with its own funds. That steals nothing but would burn the user's nonce [inference]. `trader` is the aggregator proxy and `effectiveTrader` the end user.
- **Partial fills.** RFQ-T is pro-rata, `quoteTokenAmount = effectiveBaseTokenAmount*quoteTokenAmount/baseTokenAmount` rounded down, which lets aggregators absorb upstream slippage. RFQ-M fills in full only.
- **RFQ-M taker signature.** EIP-712 under domain `('Hashflow - Router','1.0')`, typehash `Quote(bytes32 txid,address trader,address pool,address externalAccount,address baseToken,address quoteToken,uint256 baseTokenAmount,uint256 quoteTokenAmount,uint256 quoteExpiry)`. Limit orders add a `limitOrderGuardian` co-signature.
- **External accounts.** Makers can keep custody in an EOA or contract that approves the pool, so they can share liquidity across venues. (MM doc §6, §9)

### 5.5 Free option, last look and performance
- **Firm once signed; no on-chain last look.** Indirect cancels are possible by rotating the signer, using the killswitch, or pulling allowance [inference].
- **Expiry is set by the maker.** The legacy sample maker used `now+180s`. https://github.com/hashflownetwork/sample-market-maker/blob/main/messages.js
- **Pre-signature refusal.** The API v2 flow was `rfq` → unsigned `quote` → `signQuote`, so makers could refuse at the signing step. Whether a separate signing step still exists in v3 is [unverified].
- **Maker QA metrics.** Hashflow's QA tool measures success rate, "Avg bias" (quote vs levels plus fees, target 0 bps) and standard deviation. https://github.com/hashflownetwork/maker-tools/blob/main/README.md
  - Formal offboarding rules are [unverified].
- **Aggregator-side penalties (ParaSwap).** The same error more than 3 times in 1 h excludes the maker for 10–60 min depending on the error. Users flagged "restricted" are blacklisted for 7 days. (dex-lib `hashflow` files above)
- **Trade feed.** Makers can subscribe with `subscribeToTrades`: at-least-once delivery, 20 min of retries, `tradeAck`, and `canceled` on reorgs. (MM doc §8)

### 5.6 Information leakage and MEV
- **MEV claim.** "Market makers are required to cryptographically sign quotes that remain unchanged… cannot be front-run or sandwich attacked." https://docs.hashflow.com/hashflow/hashflow/introduction.md
- **Limited leakage.** Only the selected maker(s) see a firm RFQ, but it reveals `trader`, `effectiveTrader`, `source`, `feesBps` and a USD reference price, which lets makers screen flow. Maker books are visible to any authenticated taker via `/price-levels`. (MM and taker docs)

---

## 6. Bebop (PMM RFQ and JAM)

### 6.1 PMM RFQ (maker side)
**Transport.** Makers keep three WebSockets open (protobuf, Bearer key): `/v3/maker/pricing`, `/v3/maker/quote` and `/v3/maker/trades`. https://docs.bebop.xyz/market-makers/connection

- **Pricing stream.** `LevelsSchema{chain_id, msg_topic, msg_type, LevelMsg{levels[LevelInfo{base/quote address+decimals, bids/asks: repeated double [px,amt,...]}], maker_address}}`. https://docs.bebop.xyz/market-makers/trade-lifecycle/pricing
  - At most one update per 400 ms.
  - Spreads over 1000 bps are ignored, as are crossed books.
  - JSON pricing is DEPRECATED.
- **Quotes.** There is one request type, `taker_quote`. The maker fills in `maker_amount`, `maker_address` and a pre-fee `reference_price`, and signs, all in one message. https://docs.bebop.xyz/market-makers/trade-lifecycle/quotes
  - Server timeout **750 ms**, p99 target ≤100 ms. https://docs.bebop.xyz/market-makers/requirements

#### 6.1.1 Who receives requests
- **Only the winners do.** "Bebop's algorithm picks the maker(s) whose streamed levels produce the best price… If your price loses, you don't see the request". https://docs.bebop.xyz/market-makers/overview
- **Pre-filtering.** Makers are skipped for insufficient balance or allowance, and levels are capped at `min(balance, approval)`. https://docs.bebop.xyz/market-makers/core-concepts/routing and https://docs.bebop.xyz/market-makers/contracts-and-tokens
- **Opt-in subsets.**
  - "Speed-optimised" quotes: a latency subset of makers, Tokyo backend, <100 ms. https://docs.bebop.xyz/rfq-api/guides/speed-optimized-quotes
  - Short expiry: a 3–5 s TTL, per API key. https://docs.bebop.xyz/rfq-api/guides/short-expiry
- **Onboarding is whitelisted:** a test key, then a production key once `/maker-status` passes. About $20k+ capital is expected. https://docs.bebop.xyz/market-makers/requirements

#### 6.1.2 Price and winner
- **Streams must match firm quotes.** Makers set the price, but "Solvers precompute expected prices from your stream". Divergence is monitored, and repeated divergence leads to bans. https://docs.bebop.xyz/market-makers/trade-lifecycle/pricing
- **Splitting and routing.** Orders can be split across makers. Middle-token routing builds `MultiOrder`s, and each maker sees only its own legs. https://docs.bebop.xyz/market-makers/core-concepts/routing and https://docs.bebop.xyz/how-bebop-works
- **Fees.** The maker absorbs `fee_usd`; `fee_native` was removed on 2026-08-31. https://docs.bebop.xyz/market-makers/core-concepts/fees
- **AMM comparison.** The RFQ API does not claim to compare against AMMs. Integrators are told to compare the firm quote against AMM quotes net of slippage themselves. https://docs.bebop.xyz/rfq-api/guides/best-practices
  - BopAMM's `swapWithFallback` tries the BopAMM leg, then falls back to RFQ calldata. https://docs.bebop.xyz/bopamm/introduction
  - How the frontend routes between PMM and JAM is [unverified]; the docs only say "Use both… to automatically route each trade" (how-bebop-works).

#### 6.1.3 Which orders reach makers
- **Supported pairs.** Makers must support every combination of their tokens, including many-to-one and one-to-many. https://docs.bebop.xyz/market-makers/requirements
- **Open-API requests** carry no `source`, are rate-limited harder and get shorter expiries. https://docs.bebop.xyz/market-makers/core-concepts/toxic-flow
- **Integrator rules.** Integrators should pre-filter using the Price API and not slice or cherry-pick. https://docs.bebop.xyz/rfq-api/guides/best-practices

#### 6.1.4 Settlement: BebopSettlement `0xbbbbbBB520d69a9775E85b458C58c648259FAD5F`
Deployed on Arbitrum, BNB, Base, Ethereum, HyperEVM, Optimism, Polygon and **Robinhood (4663)** (https://docs.bebop.xyz/market-makers/contracts-and-tokens). There is no public GitHub repo; the source is verified on Sourcify: https://sourcify.dev/server/v2/contract/1/0xbbbbbBB520d69a9775E85b458C58c648259FAD5F?fields=sources (`src/libs/Order.sol`, `src/libs/Signature.sol`, `src/base/BebopSigning.sol`, `src/BebopSettlement.sol`)

```solidity
struct Single { uint256 expiry; address taker_address; address maker_address; uint256 maker_nonce;
  address taker_token; address maker_token; uint256 taker_amount; uint256 maker_amount;
  address receiver; uint256 packed_commands; uint256 flags; }
struct Multi { uint256 expiry; address taker_address; address maker_address; uint256 maker_nonce;
  address[] taker_tokens; address[] maker_tokens; uint256[] taker_amounts; uint256[] maker_amounts;
  address receiver; bytes commands; uint256 flags; }
struct Aggregate { uint256 expiry; address taker_address; address[] maker_addresses; uint256[] maker_nonces;
  address[][] taker_tokens; address[][] maker_tokens; uint256[][] taker_amounts; uint256[][] maker_amounts;
  address receiver; bytes commands; uint256 flags; }
```

- **Typehashes.** The domain is `"BebopSettlement"`, version `"2"`. https://docs.bebop.xyz/market-makers/trade-lifecycle/signing
  - `SingleOrder(uint64 partner_id,uint256 expiry,address taker_address,address maker_address,uint256 maker_nonce,address taker_token,address maker_token,uint256 taker_amount,uint256 maker_amount,address receiver,uint256 packed_commands)`
  - `MultiOrder(uint64 partner_id,uint256 expiry,address taker_address,address maker_address,uint256 maker_nonce,address[] taker_tokens,address[] maker_tokens,uint256[] taker_amounts,uint256[] maker_amounts,address receiver,bytes commands)`
  - `AggregateOrder(...)` follows the same pattern with arrays of makers and nonces.
  - `flags` is not signed: `partner_id` comes from `flags[64..127]`, and the event id from `flags[128..255]`.
- **Signature checks.** Maker signature types are EIP-712, EIP-1271 or ETH_SIGN (flag bits 0–1); bit 2 is makerUsingPermit2. `getRsv` enforces 65 bytes, low-s and v∈{27,28}. Makers can delegate a signer via `registerAllowedOrderSigner`.
- **Replay.** A `maker_nonce` bitmap per maker (`slot = nonce>>8`, `bit = nonce&0xff`); a zero nonce reverts. Bebop chooses the nonce and puts it in the request. (Sourcify source and quotes doc)
- **Expiry.** Reverts if `order.expiry <= block.timestamp`.
- **Who can fill.**
  - `swapSingle/Multi/Aggregate` (taker-submitted, RFQ-T style) require `msg.sender == taker_address`.
  - `settle*` (gasless, RFQ-M style) accepts a taker signature, and the maker may **improve** the amount (`order.maker_amount >= takerQuoteInfo.makerAmount`).
  - There is no tx.origin check in the settlement contract. BebopRouter (RFQA) has an optional `require(order.originAddress == 0 || tx.origin == order.originAddress)`. https://github.com/bebop-dex/bebop-rfqa
- **Partial fills.** `filledTakerAmount ≤ taker_amount`, with the maker amount scaled pro rata; not for many-to-one. The taker edits calldata at `partialFillOffset`. Makers always quote the full size. https://docs.bebop.xyz/rfq-api/guides/partial-fills and https://docs.bebop.xyz/market-makers/trade-lifecycle/trades
- **The "hidden sell" maker protection named in the brief was not found** in the source or docs [unverified].

#### 6.1.5 Free option, last look and penalties
- **Firm, no last look** on the current onboarding path: "The quote terms remain firm until expiry". https://docs.bebop.xyz/market-makers/overview
  - A `last_look` rejection exists only on the legacy signature-WebSocket path ("router-managed execution"), which is closed to new makers (DEPRECATED). https://docs.bebop.xyz/market-makers/reference/error-codes
- **Quote TTLs** (https://docs.bebop.xyz/market-makers/trade-lifecycle/quotes and https://docs.bebop.xyz/rfq-api/guides/short-expiry):

  | Quote type | Default | Ethereum |
  |---|---|---|
  | Public | 10 s | 30 s |
  | Authorised | 60 s | 75 s |
  | Short expiry | 3 s | 5 s |

  Short-expiry quotes must be **included in a block** before they expire.
- **Rejection codes.** `liquidity`, `rejected` and `unavailable` count against the maker; `min_size` and `denylist` do not. Makers can be disabled with a `ban_expiry`; the thresholds are not published. Bebop also spot-checks signatures at random. https://docs.bebop.xyz/market-makers/reference/error-codes and https://docs.bebop.xyz/market-makers/requirements
- **RFQA (BebopRouter `0xBeb0009ACa…bf2A`)** (https://docs.bebop.xyz/market-makers/rfqa and https://github.com/bebop-dex/bebop-rfqa):
  - An on-chain toxic-flow checker fee.
  - **Oracle slippage protection.** A Binance-mid / on-chain blend is pinned at quote time. If the market moved against the maker, the difference is deducted from the taker and refunded 50/50 to maker and protocol, so it only ever helps the maker.
  - Order struct: `BebopRouterOrder(uint256 fromAmount,uint256 toAmount,int256 limitAmount,address fromToken,address toToken,address pmmFromToken,address pmmToToken,address tokensOwner,address receiver,address originAddress,address oracle,address checker,uint256 info,uint256 routerNonce,bytes32 extraInfoHash,bytes32 hooksHash)`, co-signed by Bebop's `routerSigner`.

#### 6.1.6 Leakage and MEV
- **What the maker sees.** `taker_address`, `receiver`, and optional `origin_address` / `origin_target` / `origin_source`, all for toxic-flow screening. RFQA hides the end user (taker and receiver are the router). https://docs.bebop.xyz/market-makers/core-concepts/toxic-flow
- **Losing makers never see the request.** Maker levels are republished to integrators as indicative prices.
- **MEV.** Price and taker are bound in the signed order with zero slippage [inference]. An OFAC denylist is applied.

### 6.2 JAM (solver auction)
- **Contracts.** JamSettlement `0xbeb0b0623f66bE8cE162EbDfA2ec543A522F4ea6`; takers approve the BalanceManager. https://docs.bebop.xyz/core-concepts/settlement-smart-contracts
- **Solvers are whitelisted**, with no monetary barrier. https://web.archive.org/web/20251010030247/https://docs.bebop.xyz/bebop/solvers/introduction (archived; the live solver pages now redirect)
- **Requests are pushed over WebSocket**: `taker, receiver, expiry, exclusivity_deadline, nonce, slippage, hooks_data, partner_info, sell_tokens[], buy_tokens[], base_settle_gas, approval_type`. https://web.archive.org/web/20260211121530/https://docs.bebop.xyz/bebop/solvers/solver-api/respond-with-gasless-quote
  - Gasless mode: the solver returns a `fee` and its `executor`. Self-execution mode: `executor` = taker.
- **Winner.** "Best price" among solvers, with results visible via `/v2/competition/{quote_id}`. https://docs.bebop.xyz/aggregation-api/introduction
  - The ranking formula and the quote deadline are [unverified].
- **Struct and typehash** (https://github.com/bebop-dex/bebop-jam-contracts/blob/master/src/libraries/JamOrder.sol):

  ```solidity
  struct JamOrder { address taker; address receiver; uint256 expiry; uint256 exclusivityDeadline; uint256 nonce;
    address executor; uint256 partnerInfo; address[] sellTokens; address[] buyTokens;
    uint256[] sellAmounts; uint256[] buyAmounts; bool usingPermit2 /*not signed*/; }
  // "JamOrder(address taker,address receiver,uint256 expiry,uint256 exclusivityDeadline,uint256 nonce,address executor,uint256 partnerInfo,address[] sellTokens,address[] buyTokens,uint256[] sellAmounts,uint256[] buyAmounts,bytes32 hooksHash)"
  // domain "JamSettlement" version "2"
  ```

- **Validation** (https://github.com/bebop-dex/bebop-jam-contracts/blob/master/src/base/JamValidation.sol):
  - Signatures: EOA 65-byte or EIP-2098 64-byte, or EIP-1271. No signature is needed if `msg.sender == taker`.
  - Nonces: a standard bitmap, plus a separate limit-order bitmap when `expiry == 9999999999`. On the Permit2 path, Permit2's nonce is used.
  - **Executor exclusivity:** `require(executor == msg.sender || executor == 0 || block.timestamp > exclusivityDeadline)`. Expiry: `block.timestamp < expiry`.
- **No partial fills.** `buyAmounts` are minimums, and `settle` pays out the whole contract balance of each buy token. Interactions may not call the BalanceManager. Hooks are bound into the signature via `hooksHash`. `settleBebopBlend` routes PMM orders into BebopSettlement. https://github.com/bebop-dex/bebop-jam-contracts/blob/master/src/JamSettlement.sol
- **Penalties.** The solver has **2 s** to confirm an execute request. Confirming and then failing lowers its "solver rating", and repeated rejects can get it "excluded from quote flow". https://web.archive.org/web/20251010031604/https://docs.bebop.xyz/bebop/solvers/solver-api/execute-order

---

## 7. CoW Protocol (solver competition)

### 7.1 Who receives orders; push or pull; deadlines
- **The autopilot pushes `/solve` to every solver in parallel.** It builds one auction holding every order it thinks can settle. It drops expired orders, fill-or-kill orders with insufficient balance, missing approvals, unsupported tokens and invalid ERC-1271 signatures. There is no protocol filtering by pair or size; solvers choose what to bid on. https://docs.cow.fi/cow-protocol/tutorials/arbitrate/autopilot
- **Timing** (`RunLoopConfig`, checked by hand; https://github.com/cowprotocol/services/blob/main/crates/configs/src/autopilot/run_loop.rs):
  - `min_solve_time` defaults to **10 s**, or can be synced to end shortly before a block (`sync_solve_deadline_to_blockchain`);
  - `max_winners_per_auction` = 20;
  - `max_solutions_per_solver` = 3;
  - `max_delay` = 2 s: if the next loop would start more than 2 s after the last block, it waits for a new block, so the loop is paced by blocks;
  - submission deadline defaults to 5 blocks.
- **Production settlement deadlines**, in blocks after the settle request: Mainnet 3, Gnosis 3, Arbitrum 11, Base 4, Avalanche 8, Polygon 8, BNB 5, Linea 4, Plasma 5, Ink 5. https://docs.cow.fi/cow-protocol/reference/core/auctions/competition-rules
- **The `/api/v1/auction` endpoint is permissioned.** https://github.com/cowprotocol/services/blob/main/crates/orderbook/openapi.yml
- **Unfilled orders roll over.** A fill-or-kill order is re-auctioned until `validTo`; partially fillable orders can fill across several auctions. https://docs.cow.fi/cow-protocol/reference/core/auctions/the-problem

### 7.2 Who sets the price and how the winner is picked
- **Solvers propose clearing prices and routes.** A solution's score is surplus plus protocol fees, in a numéraire: sell order `(U(o)+f(o))·p(b)`, buy order `(U(o)+f(o))·p(b)·π`. https://docs.cow.fi/cow-protocol/reference/core/auctions/the-problem
- **Fair Combinatorial Auction (CIP-67) replaced the single-winner batch auction (DEPRECATED).**
  1. Take the best bid per directed token pair as the reference.
  2. Filter out batched bids that score below the reference on any pair.
  3. Choose a set of non-conflicting winners.
  - Rewards are paid by a second-price (VCG-like) rule. https://docs.cow.fi/cow-protocol/reference/core/auctions/competition-rules
  - The adoption date of about May 2025 is from a secondary source. https://arxiv.org/pdf/2607.21955
- **Uniform directional clearing prices** apply within a solution; orders with hooks are exempt. (competition-rules)
- **AMM comparison: EBBO (CIP-11 / CIP-52).** Users must get at least what "baseline" liquidity would give. On mainnet that is Uniswap v2/v3, Sushi, Swapr, Balancer v2 and Pancake, routed through WETH, DAI, USDC, USDT, COMP, MKR, WBTC and GNO.
  - Enforcement happens after the fact. The solver must reimburse within 72 h, or it is deny-listed and a slashing CIP follows. Incidents are only examined within 3 months.
  - https://docs.cow.fi/cow-protocol/reference/core/auctions/ebbo-rules

### 7.3 How RFQ / PMM liquidity enters
- **All solvable orders go to all solvers.** The solvers bring private liquidity: "Many solvers have access to off-chain liquidity through CEX inventory, integration with private market makers, or private liquidity of their own." https://docs.cow.fi/cow-protocol/concepts/introduction/intents
- **JIT orders.** A solution's `trades` can include `kind: "jit"` entries: a full order with `validTo`, `signingScheme` and `signature`, signed by a counterparty such as a market maker and settled in the same transaction. https://docs.cow.fi/cow-protocol/reference/core/auctions/schema and https://github.com/cowprotocol/services/blob/main/crates/solvers/openapi.yml
- **Surplus-capturing JIT owners.** Some owners, such as CoW AMMs, are listed in `surplusCapturingJitOrderOwners`; the surplus their orders capture counts toward the score. (the-problem page)
- **`/notify` callback.** The driver tells each solver its result, so a losing solver can release its private quotes at once. https://docs.cow.fi/cow-protocol/tutorials/solvers/evaluate
- **0x limit orders** are one of the reference driver's liquidity sources (`fillOrKillLimitOrder`). https://github.com/cowprotocol/services/blob/main/crates/driver/src/domain/liquidity/zeroex.rs
- **CoW AMM rules.** At most one AMM order per batch, a commit pre-interaction and a reset post-interaction; leaving the commit set is slashable. https://docs.cow.fi/cow-amm/tutorials/cow-amm-for-solvers [read through a search summary only; unverified in detail]

### 7.4 Settlement code (https://github.com/cowprotocol/contracts)
**GPv2Order.Data** (https://github.com/cowprotocol/contracts/blob/main/src/contracts/libraries/GPv2Order.sol). The typehash was checked by hand with `cast keccak`.

```solidity
struct Data { IERC20 sellToken; IERC20 buyToken; address receiver; uint256 sellAmount; uint256 buyAmount;
  uint32 validTo; bytes32 appData; uint256 feeAmount; bytes32 kind; bool partiallyFillable;
  bytes32 sellTokenBalance; bytes32 buyTokenBalance; }
// "Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)"
// TYPE_HASH = 0xd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489
```

- **Field encoding.** `kind` = keccak("sell"|"buy"). Balance markers are `erc20`, `external` or `internal` (Balancer Vault). `receiver == 0` means the owner.
- **Order id.** `orderUid` = `orderDigest(32) ‖ owner(20) ‖ validTo(4)`.
- **Domain.** EIP-712 `name "Gnosis Protocol"`, `version "v2"`. Mainnet settlement is `0x9008D19f58AAbD9eD0D60971565AA8510560ab41`.
- **Signing schemes** (`GPv2Signing`: Eip712, EthSign, Eip1271, PreSign). https://github.com/cowprotocol/contracts/blob/main/src/contracts/mixins/GPv2Signing.sol
  - EIP-1271 signature bytes are `owner(20) ‖ sig`.
  - PreSign: the owner calls `setPreSignature(orderUid, true)` from its own address.
- **Who can settle.** `settle(tokens, clearingPrices, trades, interactions[3])` is `nonReentrant onlySolver`, where `onlySolver` checks `authenticator.isSolver(msg.sender)`. https://github.com/cowprotocol/contracts/blob/main/src/contracts/GPv2Settlement.sol
  - `GPv2AllowListAuthentication.addSolver/removeSolver` are `onlyManager`. On-chain, the manager is the CoW DAO solver-payouts safe. https://github.com/cowprotocol/contracts/blob/main/src/contracts/GPv2AllowListAuthentication.sol
  - Interactions cannot target the vault relayer.
- **Per-trade checks:**
  - `validTo >= block.timestamp`
  - limit price `sellAmount·sellPrice >= buyAmount·buyPrice`
  - `filledAmount[orderUid]` is capped at the order amount (this is both the **replay guard and the partial-fill tracker**); fill-or-kill orders must fill completely
  - `invalidateOrder(uid)` sets `filledAmount = type(uint256).max`
  - (GPv2Settlement.sol)
- **No on-chain exclusivity.** Nothing on-chain ties a settlement to the auction winner. The rules require the winner to execute exactly as bid, and violations can mean deny-listing through the circuit-breaker validator. (competition-rules)

### 7.5 Free option, penalties and offboarding
- **Bonding.** A full bonding pool is $500k in (yield-bearing) stables plus 1.5M COW. A reduced pool (CIP-44) starts at $50k plus 500k COW. Solvers are vouched in through VouchRegister. https://docs.cow.fi/cow-protocol/reference/core/auctions/bonding-pools
- **Joining under the CoW DAO pool:** KYC, then shadow → staging → prod. CIP-48 takes a 15% service fee after 6 months. https://docs.cow.fi/cow-protocol/tutorials/solvers/onboard
- **Penalty for failing to settle a winning bid** (the solver's free option). https://docs.cow.fi/cow-protocol/reference/core/auctions/rewards
  - The reward `cap(totalScore − referenceScore_i − missingScore_i)` can be **negative**.
  - Lower cap = Σ over unsettled orders of `min(φ·volume, $20)`, with φ = 4 bps on mainnet, 1–3 bps elsewhere and 0.1 bps for correlated pairs.
  - Upper cap = β·protocol fee, with β = 50% on mainnet, Arbitrum, Base and BNB, and 100% elsewhere.
- **Other incentives** (same page):
  - Consistency rewards (CIP-85) weight payouts by `successRate`; metric v2 started 2026-06-30.
  - Quote rewards (CIP-88) go to the 5 most accurate quotes, weighted by 1/error². This replaces the older flat quote rewards (DEPRECATED).
- **Slashable or deny-listable conduct:** EBBO violations, score inflation, illegal use of buffers, surplus shifting, pennying or overbidding, and dropping hooks. (competition-rules)

### 7.6 Information leakage and MEV
- **Protections.** Uniform directed clearing prices, so order within the block does not matter. Coincidences of wants that never touch AMMs. Intents never enter the public mempool, and the solver carries the execution risk. https://docs.cow.fi/cow-protocol/concepts/benefits/mev-protection
- **Private submission.** The driver supports custom private submission mempools. https://github.com/cowprotocol/services/blob/main/crates/driver/example.toml
  - Which RPCs each solver actually uses is [unverified].
- **Leakage.** Every competing solver sees every order in the auction.

### 7.7 Deprecated
- **Signed `feeAmount` must be 0.** The orderbook rejects anything else with `NonZeroFee` ("Orders with positive signed fee amount are deprecated"). https://github.com/cowprotocol/services/blob/main/crates/shared/src/order_validation.rs
  - Current protocol fees: 50% of surplus or quote improvement (capped at 0.98% of volume), plus a 2 bps volume fee (0.3 bps on correlated pairs). https://docs.cow.fi/governance/fees/fees
- **The single-winner auction** has been replaced by CIP-67.
- **Whether `GPv2Settlement.swap()` (direct-to-Balancer) is still used** is [unverified].

---

## 8. Velora (formerly ParaSwap): Delta and Market RFQ

### 8.1 Delta: who receives orders and how the winner is picked
- **Sealed-bid rounds.** Each order is auctioned in rounds. Every round queries **all solvers in parallel** for one sealed bid each; bids are validated and **simulated**, and the best simulated outcome wins. If there is no viable bid, or the winning fill fails, the order goes into the next round until its deadline. Wording checked by hand. https://github.com/VeloraDEX/docs/blob/main/solver-network/sealed-bid-auctions.mdx
- **Bids are firm.** "A bid is a commitment, not a quote… exact calldata… There's no second look and no renegotiation." It is first-price. (same page)
- **Agent filters and roster.** Integrators can filter with `includeAgents` / `excludeAgents`. https://github.com/VeloraDEX/docs/blob/main/api-reference/specs/delta-v2.json
  - The agent list for chain 1 is `["Wrapped-Native","Laita","Laita-Go","Bitget","Elfomo","Chainza"]` (https://api.velora.xyz/v2/delta/agents/list/1). The Portikus registry `getAgents()` returns 10 addresses.
  - Agents must be registered in the on-chain Portikus registry. https://github.com/VeloraDEX/docs/blob/main/solver-network/portikus.mdx
- **The bid window and round cadence are [unverified].** The docs only say "a few seconds". https://github.com/VeloraDEX/docs/blob/main/integrate/trading-modes.mdx
- **Choosing Delta vs Market.** `GET /v2/quote?mode=ALL` picks Delta or Market server-side, with a `fallbackReason` when Delta can't price the trade. Delta is recommended for large trades; Market for small or latency-sensitive ones. (trading-modes.mdx)
  - No EBBO-style after-the-fact rule against AMMs was found.
- **Surplus split.** The protocol takes 50% of surplus above `expectedAmount`, optionally capped at 1%. The partner takes either a fixed fee (≤200 bps) or the other 50% of surplus. `FeeManagerLib.processSellFees` in the SwapSettlementModule source below.

### 8.2 Delta settlement code
- **Delta contract** `0x0000000000bbF5c5Fd284e657F01Bd000933C96D`, same address on all chains. It is a modular `Adapter` whose fallback delegatecalls the module for each selector (`PORTIKUS_V2.isModuleRegistered`). It has 43 modules on mainnet. https://sourcify.dev/server/v2/contract/1/0x0000000000bbF5c5Fd284e657F01Bd000933C96D
- **v2 Order.** From the SwapSettlementModule `0xDA30cD3c…1Ce3`, using the Sourcify-verified copy on Base: https://sourcify.dev/server/v2/contract/8453/0xDA30cD3c49A05b0854b05f0A1c4c2EbAC8f91Ce3

  ```solidity
  struct Order { address owner; address beneficiary; address srcToken; address destToken; uint256 srcAmount;
    uint256 destAmount; uint256 expectedAmount; uint256 deadline; OrderKind kind; uint256 nonce;
    uint256 partnerAndFee; bytes permit; bytes metadata; Bridge bridge; }
  struct Bridge { bytes4 protocolSelector; uint256 destinationChainId; address outputToken; int8 scalingFactor; bytes protocolData; }
  // "Order(address owner,address beneficiary,address srcToken,address destToken,uint256 srcAmount,uint256 destAmount,uint256 expectedAmount,uint256 deadline,uint8 kind,uint256 nonce,uint256 partnerAndFee,bytes permit,bytes metadata,Bridge bridge)Bridge(...)"
  // _ORDER_TYPEHASH = 0xc75d848e51cd0f81113e24c5a62c9b8566b0ff0d476245a7882709315eefbbf7 ; domain ("Portikus","2.0.0")
  ```

  The SDK builds the same layout: https://github.com/VeloraDEX/sdk/blob/master/src/methods/delta/helpers/buildDeltaOrderData.ts
- **Signature verification** (`SignatureLib.verify`):
  - EOAs must use 64-byte **ERC-2098 compact** signatures; contract owners use ERC-1271.
  - An optional `cosignature` only authorizes a `BridgeOverride`. It is not an award or exclusivity signature.
- **Replay protection.** `NonceManagerLib` keeps a per-owner bitmap, and `useNonce` reverts on reuse. `invalidateNonce(s)` lives in the NonceManagementModule. https://sourcify.dev/server/v2/contract/1/0xb18c54fa901F7f0EE2E9542a8f940038f63734b2
- **Who can fill.** Every settle function is `onlyAuthorizedAgent` (`isAgentRegistered(msg.sender)`). Any registered agent can settle any order it holds a signature for; **award exclusivity is off-chain only**.
- **`swapSettle`:**
  1. checks `deadline` and the order kind;
  2. runs the permit;
  3. moves `srcAmount` to the agent-chosen `executor`;
  4. calls it;
  5. checks that the destToken balance grew by at least `destAmount`;
  6. takes fees, then pays the beneficiary or bridges.
- **`directSettle` is the RFQ-like path:** the agent pays `destToken` from its own inventory. (https://sourcify.dev/server/v2/contract/1/0xD76E73Ae97A37cbCAbC9d4120d9df80d132263b6, v1 version)
- **Partial fills.** `FillableSwapSettlementModule.swapSettleFillable(..., fillPercent, ...)` takes the fill in bps and accumulates `filledSell[orderHash]` up to `srcAmount`. The nonce is consumed on the final fill and the permit runs only on the first. https://sourcify.dev/server/v2/contract/8453/0x2f2e28Ad971ce587f21a39d2143899b6C1D00865
- **Native ETH orders** use a pre-signature after a dETH deposit. https://github.com/VeloraDEX/docs/blob/main/delta/how-it-works.mdx

### 8.3 Delta free option and penalties
- **Failed fills are re-auctioned.** If the winning calldata reverts or goes stale, the order goes to the next round; "the failed solver wasted only its own auction slot". (sealed-bid-auctions.mdx)
- **No bond, slashing or penalty schedule is documented.** The only sanction is `unregisterAgent` from the registry. https://github.com/VeloraDEX/docs/blob/main/solver-network/portikus.mdx
  - Removal thresholds are [unverified].

### 8.4 Market-mode RFQ (maker integration)
- **Pull model.** The MM exposes `GET /tokens`, `/pairs` and `/prices` (bid/ask ladders of `[price, amount]`), optionally over WebSocket. Velora caches the ladder and routes it **alongside AMMs**: "Velora does not call you for every indicative user quote."
  - `POST /firm` is called only when the user executes, at transaction build time.
  - https://github.com/VeloraDEX/docs/blob/main/resources/market-makers/index.mdx and https://github.com/VeloraDEX/docs/blob/main/resources/market-makers/api-specification.mdx
- **Firm request code** (`GenericRFQ`, https://github.com/VeloraDEX/paraswap-dex-lib/blob/master/src/dex/generic-rfq/generic-rfq.ts and `rate-fetcher.ts`):
  - **`GET_FIRM_RATE_TIMEOUT_MS = 4000`** (checked by hand).
  - Sell orders over-order by 100 bps.
  - The firm amount must stay within the user's slippage of the indicative price, else `SlippageCheckError`.
  - Failures restrict the pair for a TTL (5 min after a timeout).
  - The maker's signature, balance and allowance are checked before use.
  - Requests can be HMAC-signed.
- **AugustusRFQ** (mainnet `0xe92b586627ccA7a83dC919cc7127196d70f55a06`; Robinhood 4663 `0xD8b841de9C1370f3C362531024AAF18974Eb11ef`). Sources: https://sourcify.dev/server/v2/contract/1/0xe92b586627ccA7a83dC919cc7127196d70f55a06 and https://github.com/VeloraDEX/docs/blob/main/resources/chains-and-contracts.mdx

  ```solidity
  contract AugustusRFQ is EIP712("AUGUSTUS RFQ", "1")
  struct Order { uint256 nonceAndMeta; uint128 expiry; address makerAsset; address takerAsset;
    address maker; address taker; uint256 makerAmount; uint256 takerAmount; }
  // "Order(uint256 nonceAndMeta,uint128 expiry,address makerAsset,address takerAsset,address maker,address taker,uint256 makerAmount,uint256 takerAmount)"
  ```

  - **Checks:** `expiry == 0 || now <= expiry`; `taker == 0 || taker == msg.sender`.
  - **State:** `remaining[maker][orderHash]` (0 = unfilled, 1 = filled or cancelled, otherwise remaining+1). The signature is checked on the first fill (EOA or ERC-1271).
  - **Partial fills:** `partialFillOrder(order, sig, takerTokenFillAmount)`. Cancellation is on-chain via `cancelOrder(s)`.
  - **How Velora fills it.** `taker` = a Velora execution contract (whitelist at `api.velora.xyz/adapters/contract-takers`). `nonceAndMeta = user | rand<<160`, and Velora checks that the embedded user matches. The firm `expiry` must be at least 2 min ahead. https://github.com/VeloraDEX/docs/blob/main/resources/market-makers/order-structure.mdx
- **Last look and penalties.** (index.mdx above)
  - The MM may refuse at `/firm`, but "repeated refusals can disable the integration".
  - Firm prices that drift from the ladder count as bad quotes.
  - Invalid signatures or missing allowance or inventory count against the MM.
  - A `/prices` error pauses trading (the MM's off switch).
  - MMs can blacklist users who request firm quotes but never execute.
  - No numeric thresholds are published [unverified].

### 8.5 Leakage, MEV and deprecations
- **Leakage and MEV.**
  - Delta orders never reach the public mempool, bids are sealed, and the signed floor is enforced on-chain. (sealed-bid-auctions.mdx)
  - In RFQ, the MM learns `userAddress` by design. Market-mode AMM swaps are public and can be sandwiched. (trading-modes.mdx)
- **Deprecated or legacy.**
  - Delta v1 API (`/delta/*`) is still supported, with the v1 `Order` (`expectedDestAmount`, no `kind`/`bridge`). https://github.com/VeloraDEX/docs/blob/main/resources/migrations/delta-v1-to-v2.mdx
  - "ParaSwap Limit Orders" on AugustusRFQ are now OTC/P2P only; "Limit Orders are a Delta product". (order-structure.mdx)
  - Augustus v5 and v6.1 are legacy; v6.2 is current. (chains-and-contracts.mdx)
  - No "ParaSwapPool" webhook-style PMM integration exists in the current docs [unverified]. Named PMMs (Hashflow, Bebop, Dexalot, Native, Swaap) are integrated in dex-lib. https://github.com/VeloraDEX/paraswap-dex-lib

---

## 9. Cross-cutting patterns (synthesis; my analysis, built on the sources above)

### 9.1 Two ways to deliver a request
**(a) Broadcast RFQ.** A request is fanned out to every vetted maker for the pair, with a hard deadline:
- UniswapX: 500 ms
- Jupiter Z V1: 500 ms
- 0x legacy: 600 ms
- 1inch exclusive quotes: 500 ms

**(b) Streamed levels, then a firm request to the winner only:**
- Hashflow: 750 ms, levels every 1 s
- Bebop: 750 ms, levels at most every 400 ms
- Jupiter Z V2
- Velora Market: 4 s firm timeout

Pattern (b) leaks less, because losing makers never see the order. In exchange, makers must keep their streamed levels honest, so both Hashflow and Bebop check firm quotes against the streams and penalise divergence.

### 9.2 Pricing
- **Makers always set the price.** The venue picks the best output, and only some venues net out gas or simulated execution (Jupiter's "executed price", Velora's simulation).
- **Every aggregator compares RFQ with AMM routes:**
  - 0x mixes RFQ into the route only where it beats the AMMs, and shares `comparisonPrice` with makers.
  - UniswapX needs >300 USDC or a 0.2% improvement over Classic.
  - CoW enforces EBBO after settlement.
  - Velora picks Delta or Market.
- **Size gates are rare.** UniswapX's $300 minimum on DutchV3 is the only explicit one. Elsewhere makers gate by declining (Jupiter 404, Hashflow and Bebop `min_size`).

### 9.3 What gets signed
**Maker-signed firm quotes:**

| System | Encoding | Replay guard | Bound to |
|---|---|---|---|
| 0x Settler | Permit2 witness | Permit2 nonce | taker + Settler (`spender`) |
| 0x legacy | `RfqOrder` | salt + `txOrigin` | `tx.origin` |
| Hashflow | EIP-191 packed | per-trader monotonic nonce | trader / effectiveTrader (any `msg.sender`) |
| Bebop | EIP-712 | maker nonce bitmap | `msg.sender == taker_address` |
| AugustusRFQ | EIP-712 | `remaining` map | `taker == msg.sender` |

**User-signed intents:**

| System | Encoding | Replay guard |
|---|---|---|
| UniswapX | Permit2 witness, plus cosigner overrides | Permit2 nonce bitmap |
| 1inch | LOP `Order` | bit or remaining invalidator |
| CoW | `GPv2Order` | `filledAmount[uid]` |
| Bebop JAM | `JamOrder` | nonce bitmap |
| Velora Delta | Portikus `Order` | nonce bitmap |

**Partial fills:**
- Pro-rata against a signed maximum: 0x Settler, Hashflow RFQ-T, Bebop, AugustusRFQ, 1inch, CoW, Velora fillable.
- Not supported: UniswapX, Jupiter Z, Bebop JAM.

### 9.4 Who may fill
- Solver/filler venues gate on-chain by allowlist:
  - CoW `onlySolver`
  - Velora `onlyAuthorizedAgent`
  - 1inch whitelist + Access NFT
- Award exclusivity is enforced on-chain only by:
  - UniswapX `exclusiveFiller` with override bps
  - 1inch staggered resolver unlock times
  - Bebop JAM `executor` + `exclusivityDeadline`
- CoW and Velora enforce exclusivity off-chain.

### 9.5 Free option and last look
- **Firm with no last look:** 0x Settler, Hashflow v3 RFQ-T, Bebop (current), Velora Delta.
- **Explicit last look:**
  - Jupiter Z (V1 `/swap` reject; V2 just doesn't co-sign)
  - Velora Market `/firm` refusal
  - legacy 0x RFQ-M (`proceedWithFill`)
  - legacy Bebop
  - Hashflow v2 `signQuote`
- **Commitment is enforced off-chain by statistics, not bonds:**
  - UniswapX: fade rate >12%, then exponential bench
  - Jupiter V1: 95% target plus failure breaker
  - 1inch exclusive: 90% / 7 days, then warning → 7 d → 30 d
  - Bebop: ban_expiry
  - Velora: disable integration
- **Only CoW uses money:** bonds, negative rewards and slashing.
- **The taker's free option is capped by short TTLs:**
  - 0x ~60 s
  - Jupiter 55 s (20 s maker reserve)
  - Bebop 3–75 s
  - Velora RFQ ≥2 min
  - Hashflow set by the maker (sample 180 s)
  - UniswapX exclusivity 24 s mainnet / ~2–8 s on L2s

### 9.6 Leakage controls seen
- **UniswapX:** paired inverse requests and fresh ids per maker, so makers can't tell which side is real or correlate requests.
- **Winner-only firm requests:** Hashflow, Bebop, Jupiter V2, Velora Market.
- **Hiding the end user:** Bebop RFQA.
- **Maker-side screening tools:** origin fields, `source` and restriction lists in Hashflow, Bebop and 0x; Velora user blacklists.
- **MEV:** all of them land through private or solver-controlled submission, and signed zero-slippage maker quotes remove the sandwich surface on RFQ legs.

---

## 10. Adjacent (outside DeFi spot; noted because probabl is a prediction market) [unverified: search-result snippet only, the page could not be fetched]
- **Polymarket RFQ.** Quotes are "unsigned intents". The requester accepts, then the chosen maker gets a final **last-look confirmation window (10 s)**; the request TTL is 10 min. Makers must be onboarded by address; status is early alpha.
  - https://docs.polymarket.com/developers/market-makers/rfq/overview and https://docs.polymarket.com/api-reference/maker/confirm-or-decline-last-look.md
