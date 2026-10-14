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
