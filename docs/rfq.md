# RFQ for market makers

Every market order a member submits through one-click trading first goes out as a request for
quotes to the makers the market admin approved.

- **The window.** Makers have 500 ms to answer with a signed price. The request closes earlier
  once every maker online has answered.
- **One transaction.** The order then fills best price first from the book's resting orders and
  the quotes together. The exchange checks each quote's signature and fills it straight from your
  exchange balance; you never rest an order.
- **Priority.** At equal prices the book fills first, so resting limit orders keep their place.

Limit orders never go out for quotes, and a wallet's own orders are never sent to it.

## Getting access

1. **API key.** The market admin approves your wallet in the admin console (RFQ makers).
   - The key, `pbl_rfq_…`, is shown once; the API keeps only its SHA-256.
   - Your quotes must be signed by that wallet.
   - Revoking the key closes your connections at once.
2. **Deposit.** A quote fills from your exchange balance:
   - plain credit (`fundingKind` 0), keeping the other branch's claim of what you deliver;
   - or your claims on the order's branch (1).

   Sells deliver the stock, buys the quote token. A quote your balance cannot fund is refused, and
   one your balance can no longer fund when the order lands is skipped.

## Connection

```
GET wss://<api>/v1/rfq/stream
Authorization: Bearer pbl_rfq_…
```

- **Frames.** One JSON text frame per message. Frames over 4 KB close the connection.
- **Failover.** A key may hold two connections at once; each receives every request, and your
  latest quote from either counts.
- **Keepalive.** The server pings, so keep the socket reading.
- **Close codes.** `4001` key revoked, `4002` too many connections for the key, `1001` server
  restarting (reconnect).

## Messages from the server

**`welcome`**, once per connection:

```json
{ "type": "welcome", "version": 1,
  "maker": { "id": "…", "label": "Desk one", "wallet": "0x…" },
  "quoteWindowMs": 500, "chainId": 46630, "exchange": "0x…",
  "signing": { "domain": { "name": "Probabl", "version": "1", "chainId": 46630,
                           "verifyingContract": "0x…" },
               "types": { "Quote": [{ "name": "taker", "type": "address" },
                                    { "name": "terms", "type": "uint256" },
                                    { "name": "nonce", "type": "uint256" }] } },
  "minQuoteSeconds": 3 }
```

**`rfq`**, for every market order:

```json
{ "type": "rfq", "version": 1, "id": "2b0c…",
  "sentAt": 1760000000000, "quoteDeadline": 1760000000500,
  "chainId": 46630, "exchange": "0x…",
  "market": { "id": "3", "condition": "0x…",
              "base": { "token": "0x…", "decimals": 18 },
              "quote": { "token": "0x…", "decimals": 6 },
              "tick": "10000", "step": "1000000000000000", "maxSteps": "1000000",
              "minNotional": "1000000", "maxOrder": "100000000000",
              "open": "…", "cutoff": "…",
              "makerFeeBps": 20, "takerFeeBps": 50, "rebateBps": 0 },
  "order": { "taker": "0x…", "branch": 0, "side": 0,
             "quantity": "4000000000000000000", "limitPriceRawX18": "102000000",
             "fundingKind": 0, "tif": 1, "expiry": "…", "maxFeeBps": 50 },
  "quoteSide": 1,
  "book": { "bestBid": null, "bestAsk": "101000000" },
  "signing": { "domain": { … }, "types": { … }, "primaryType": "Quote",
               "taker": "0x…", "minQuoteSeconds": 3 } }
```

- **Units.** Amounts are raw token units as decimal strings. Prices are raw quote units per raw
  base unit × 10^18, as on the exchange: in the example, 102000000 is $102 per share.
- **`order`** is the taker's order. `branch` 0 is YES and 1 is NO; `side` 0 is a buy and 1 a sell;
  `limitPriceRawX18` is the worst price the taker accepts.
- **`quoteSide`** is your side: 1 means you sell to a buying taker.
- **`book`** gives the best live prices on the branch when the request went out.
- **`quoteDeadline`** is in ms since the epoch. Quotes that arrive after it are refused.

**`quote.accepted`** / **`quote.rejected`** (with `reason`) answer each quote once it is checked.

**`rfq.result`**, after the taker's transaction:

```json
{ "type": "rfq.result", "rfqId": "2b0c…", "outcome": "filled",
  "awarded": "1000000000000000000", "filled": "1000000000000000000",
  "price": "100500000", "transaction": "0x…", "reason": null }
```

`outcome` is one of:
- `filled` or `partially_filled`;
- `unfilled`: awarded, but the order's transaction failed or skipped the quote;
- `lost`: other quotes or resting orders filled the order at better prices.

**`pong`** answers a ping. **`error`** reports a malformed frame.

## Messages to the server

```json
{ "type": "quote", "rfqId": "2b0c…", "price": "100500000", "quantity": "1000000000000000000",
  "fundingKind": 0, "expiry": "1760000030", "nonce": "17", "signature": "0x…" }
{ "type": "decline", "rfqId": "2b0c…" }
{ "type": "ping", "id": "optional-id" }
{ "type": "indications", "prices": [{ "market": 1, "branch": 0, "bid": "99500000", "ask": "100500000" }] }
```

**What a quote is.** A firm offer to fill up to `quantity` at `price` for this taker until `expiry`
(unix seconds). Quantities above the order's size are capped at it.

**What you sign.** Your wallet signs the EIP-712 struct `Quote(address taker, uint256 terms,
uint256 nonce)` under the `signing.domain`, with `taker` = `signing.taker` and:

```
terms = market | flags << 32 | expiry << 56 | (price / tick) << 96 | quantity << 160
flags = branch | quoteSide << 1 | fundingKind << 2
```

- **Signature format.** Send it as 65 bytes (r, s, v) or 64 bytes (EIP-2098).
- **TypeScript helpers.** `@conditional-stocks/evm-client` exports `packQuoteTerms`, `quoteDomain`
  and `QUOTE_TYPES`.

**Nonces.** Each nonce fills once: bit `nonce % 256` of word `nonce / 256`. Use them sequentially;
the first nonce of each 256-nonce word costs about 17k more gas.

**What a quote must satisfy.** It is refused unless:
- it is signed by your approved wallet;
- `price` is a multiple of the tick and within the taker's limit;
- `quantity` is a multiple of the step;
- it stays valid at least `minQuoteSeconds` after it arrives;
- its nonce has not filled before;
- your balance can fund it.

**Updates.** Up to five quotes per request: each replaces your previous one. A `decline` withdraws
your quote and tells the server not to wait for you.

**Indications.** Your current prices for a standard $100 order on each market branch you quote:
unsigned and not binding (a market order still asks you for a firm quote).
- **What the app shows.** The app shows the best bid and ask across makers as a branch's price, folded
  into its book's, and charts their midpoint once a minute. Anyone can read them at
  `GET /v1/rfq/prices`, and as they change at `GET /v1/rfq/prices/stream` (SSE, event `prices`).
- **Format.** Up to 256 entries per frame; `bid` and `ask` are raw prices or `null`, with `bid` at or
  below `ask`.
- **Replacing them.** Each frame replaces your previous one. Prices stand for 30 seconds and go when
  your last connection closes, so post them at least every 30 seconds while you quote. Δ-vault
  keepers post them every 10.

## Contract makers (Δ-vaults)

A contract cannot sign, so a maker contract such as a Δ-vault names itself in its quotes' nonce:
`nonce = makerAddress << 96 | counter` (counter below 2^96; a wallet's nonces stay below 2^96).

- **On chain.** For such a quote the exchange recovers no wallet. Before filling, it asks the
  contract `acceptQuote(digest, terms, fill, r, vs)` (`IQuoteMaker`), as a static call with a
  bounded gas budget. Anything but the function's own selector skips the quote.
- **The vault's check.** A Δ-vault accepts only quotes signed by a wallet holding its
  `KEEPER_ROLE`. Each must also fit the limits the vault enforces on its resting orders: a
  registered market, quoting not paused, the band around its Chainlink price, the order lifetime
  and cutoff buffer, the per-order cap, and the worst-case YES-minus-NO cap once filled.
- **The API's check.** The API confirms the signer before awarding: it asks the contract's ERC-1271
  `isValidSignature` once per signer, and trusts the answer for five minutes.
- **Approval.** The market admin approves the vault's address as the maker's wallet, as for any
  maker.

## How a request is decided

1. **The window.** The request stays open for `quoteWindowMs` (500 ms), or until every maker
   online has quoted or declined, whichever comes first.
2. **One ranking.** The book's resting orders and the standing quotes are ranked together, best
   price first. At equal prices, resting orders come first, then quotes in the order they arrived.
   One transaction carries at most eight resting orders and eight quotes.
3. **Awards.** Each quote in the fill is awarded the part it wins.
4. **Settlement.** The order's transaction carries each award with your signature. The exchange
   verifies it, spends the nonce and fills exactly the award from your balance, before the book's
   orders. You are the maker of that fill: you pay the maker fee and receive the maker rebate.
5. **What the exchange skips.** A quote that has expired, whose nonce is spent, or that your
   balance no longer covers fills nothing; the order still takes the book.

## Fees

You pay the market's maker fee on every fill. The taker pays the taker fee, and you receive the
market's maker rebate out of it.

## World orders (protocol version 2)

A maker the market admin also approved for worlds receives world orders on the same connection.
Its `welcome` then carries `worlds`: the world books' address, the vaults, and the `WorldQuote`
signing domain. A world order is a bundle of a book's outcomes (`mask`), bought with a `stake` or
by `units`, or sold back (`side: "sell"`). Amounts are decimal strings of raw quote units.

### Two ways an order is asked

**An open request** (`open: true`) is how members trade worlds.

- **It stays open.** Until `quoteDeadline`, 15 minutes after it was asked by default (never past
  the book's cutoff), or until its taker fills or cancels it.
- **The taker chooses.** The taker sees every standing quote, each with its maker's name, its
  terms and its own `expiry`, and fills the one they choose. Nothing fills by itself, and the
  taker may choose none. The API's trading delegate sends the fill, so the taker never holds
  your signature.
- **Quote when you like.** You can quote any time before the deadline, including long after the
  request was asked. A later quote replaces your earlier one (up to 256 quotes per request).
- **Your expiry is yours.** Set each quote's `expiry` to as long as you will honour it. It must
  be at least `minQuoteSeconds` away when it arrives. A quote that runs out leaves the request;
  quote again if you still want the trade. The world vault quotes five minutes at a time and
  gives a request two quotes of its own accord (the first, and one more when that runs out or
  the price moves against it); after that it quotes again only when the taker asks again.
- **Withdraw with `decline`.** Declining a request you quoted withdraws your quote at once. A
  quote the taker has already chosen still fills.
- **Late joiners.** When you connect, you are sent every open request you hold no quote on, with
  `replay: true`, in bursts of 25. You are sent a request again when its taker asks for fresh
  quotes and you hold none on it that still fills.
- **Offline means withdrawn.** When your last connection closes, your standing quotes leave with
  it: you could no longer withdraw them. Quote again when you reconnect.

**An auction** (`open: false`) fills at once: the request closes after `quoteWindowMs`, or as soon
as every maker online has answered, and the best quote fills in the same call.

### Messages

**`world.rfq`**, for every world order:

```json
{ "type": "world.rfq", "version": 2, "id": "7d1f…", "sentAt": 1794284040657,
  "quoteDeadline": 1794285840657, "open": true, "replay": false,
  "chainId": 46630, "books": "0x…",
  "book": { "id": "12", "defHash": "0x…", "atoms": 3, "feeBps": 100,
            "cutoff": "1797019200", "fixingTime": "1797022800", "state": "trading" },
  "order": { "taker": "0x…", "side": "buy", "mask": 2, "units": null, "refund": "0",
             "stake": "20000000", "conditional": false, "limit": "0" },
  "signing": { "domain": { "name": "Probabl Worlds", "version": "1", "chainId": 46630,
                           "verifyingContract": "0x…" },
               "types": { "WorldQuote": [ … ] }, "primaryType": "WorldQuote",
               "minQuoteSeconds": 3 } }
```

`sentAt` is when the order was asked: a request sent again keeps it.

**`world.quote`**, your answer, a signed `WorldQuote`:

```json
{ "type": "world.quote", "rfqId": "7d1f…", "units": "81200000", "refund": "0",
  "price": "20000000", "expiry": "1794284340", "makerData": "0", "nonce": "41",
  "signature": "0x…" }
```

- **A buy by stake** is quoted at `price` = the stake, with the `units` you give for it (and
  `refund` = the stake for a conditional payout). More units is the better quote.
- **A buy by units** is quoted at the `price` you sell the bundle for; a **sell** at the `price`
  you pay for it.
- **`limit`** is the taker's worst acceptable terms: the fewest units for a stake, the most it
  pays for units, the least it takes for a sell.

**`quote.accepted` / `quote.rejected`** answer each quote, as in version 1. A rejected quote
never fills.

**`world.declined`**, when the taker turns your standing quote down:

```json
{ "type": "world.declined", "rfqId": "7d1f…" }
```

Your quote left the request and fills no more. The request is still open: you may quote it
again, and you are sent it again if the taker asks for fresh quotes.

**`world.result`**, when a request you hold a quote on ends:

- `filled`: the taker chose your quote, with the fill's `transaction`;
- `lost`: the taker chose another maker's quote;
- `unfilled`: the request was cancelled or ran out (`reason` says which), or for an auction the
  order's transaction did not fill your quote.

**`world.closed`**, to every world maker online when an open request ends:

```json
{ "type": "world.closed", "rfqId": "7d1f…", "reason": "filled" }
```

`reason` is `filled`, `cancelled` or `expired`. Take the request off your board.

**`world.indications`** carries your current, unsigned prices per book, as `indications` does for
market branches.

### What a world quote must satisfy

It is checked when it arrives, again whenever the taker reads the request, and once more before
it fills:

- it answers the bundle asked for, within the taker's limit;
- it is signed by your approved wallet, or for a world vault by one of its keepers for its
  current quote epoch, within every limit its `onWorldFill` hook enforces;
- its nonce has not filled before;
- the book is trading, and both sides can fund the fill.

A standing quote that stops passing is shown to the taker as not fillable, with the reason, and
cannot be chosen.

