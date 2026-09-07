# Order and position API — v2 raw-unit payloads

The `/v1` route prefix and v2 raw-unit market identities are retained. Order signing is now EIP-712
version **3**, with a signed `maxFeeBps`; pre-fee signatures are incompatible.
See [trading fees](../architecture/trading-fees.md) and [raw-unit pricing](../architecture/raw-unit-ratio-v2.md).
Amount fields are raw token units; price fields are raw quote/raw base ratios scaled by `1e18`.
Prepare responses include verified token units and per-asset decimals for display.

Raw amount and price integers in request JSON are decimal strings. Enums and `maxFeeBps` are JSON
integers; the fee cap must be 0–1000. Responses also render bigint values as
decimal strings. State-changing submission endpoints require an `Idempotency-Key` header containing
8–128 safe ASCII characters.

## Authentication

- `POST /v1/auth/challenge` — `{ "address": "0x…" }`
- `POST /v1/auth/verify` — `{ "address", "challengeId", "signature" }`

Authenticated endpoints require `Authorization: Bearer <session>`. The authenticated address must
equal the order maker or transaction signer.

## Order schema

```json
{
  "maker": "0x...",
  "recipient": "0x...",
  "marketId": "0x...32-bytes",
  "branch": 0,
  "side": 0,
  "fundingKind": 0,
  "quantity": "1000000000000000000",
  "limitPriceRawX18": "200000000",
  "tif": 0,
  "expiry": "1800000000",
  "nonce": "0",
  "salt": "0x...32-bytes",
  "maxFeeBps": 0
}
```

Enums are `branch: YES=0, NO=1`, `side: BUY=0, SELL=1`, `fundingKind:
WHOLE_COLLATERAL=0, ACTIVE_CLAIM=1`, and `tif: GTC=0, IOC=1`.

The example buys one stock18 token at 200 USDG6. Its reservation is `200000000` raw USDG.
Its zero fee cap prohibits fee-bearing fills. An omitted cap defaults to zero only. An explicit
cap of 25 authorizes up to 0.25% of received active claims, not extra input collateral. Preparation
includes `fees.maxFeeBps`, the fee asset/basis, and a notice that payoff amounts are before fees.
An admin rate increase above the signed cap cannot fill the order; cancellation remains free.

## Endpoints

- `POST /v1/orders/prepare` — body `{ "order": Order }`; returns exact EIP-712 typed data, hash,
  safe-block context, reservation, approval call, and payoff preview.
- `POST /v1/orders/submit` — body `{ "order": Order, "signature": "0x…" }`. An optional
  `signedTransaction` selects the wallet-paid exact raw-transaction fallback.
- IOC submission additionally requires `protection: { maxQuantity, maxNotional,
  worstPriceRawX18 }`; it returns a durable intent in `waiting-match` until the matcher supplies a plan.
- `POST /v1/orders/cancel/prepare` — body `{ "orderHash": "0x…" }`; returns maker-only calldata.
- `POST /v1/orders/cancel/submit` — adds `signedTransaction` and broadcasts only after recovering
  and validating its signer, chain, target, value, and exact calldata.
- `GET /v1/orders/:orderHash` — returns `{ application, canonical }`; canonical data comes from
  Ponder.
- `GET /v1/operations/:operationId` — returns attempts, replacement links, persisted receipt, and
  current application state.
- `POST /v1/positions/merge/{prepare,submit}` — accepts `marketId`, `collateral` (`base` or `quote`),
  `amount`, and `recipient`; submit also accepts the exact wallet-signed transaction.
- `POST /v1/positions/redeem/{prepare,submit}` — accepts `marketId`, `collateral`, one or two unique
  index sets (`"1"` YES, `"2"` NO), matching amounts, and recipient. The preview uses the canonical
  manual resolution vector.

## Application states

- `accepted`: request and digest persisted.
- `prepared`: serialized signed transaction persisted before broadcast.
- `broadcast`: RPC accepted the exact transaction hash.
- `retryable`: a transient indexer/RPC failure occurred; retry the same idempotency key.
- `canonical`: Ponder indexed the transaction/order state; `finalReceipt` is persisted.
- `failed`: non-retryable validation, simulation, or canonical transaction failure.
- `submitted`: an IOC intent was durably handed to the settlement worker.

An API `202` is never evidence of escrow or execution. Clients must use canonical state.

## Error taxonomy

Errors have `{ error: { code, message, details, retryable } }`.

| Code | Meaning |
| --- | --- |
| `invalid-request` | Malformed field, unsafe number, raw transaction, or idempotency key |
| `not-authenticated` | Missing/expired session or wrong wallet |
| `signature-invalid` | Challenge or EIP-712 signature failed EOA/ERC-1271 verification |
| `chain-mismatch` | Configured RPC is on another chain |
| `order-invalid`, `order-expired`, `market-not-open` | Protocol constraints reject the order |
| `balance-insufficient`, `approval-missing`, `funding-invalid` | Exact reservation cannot be pulled |
| `wallet-cap-exceeded`, `market-cap-exceeded` | Onchain open-notional cap would be exceeded |
| `simulation-failed` | Safe/latest contract simulation rejected the exact call |
| `transaction-reverted` | RPC observed a mined revert; no protocol action was applied |
| `canonical-state-unavailable`, `rpc-unavailable` | Retryable dependency outage |
| `idempotency-conflict` | The key is already bound to a different request digest |
| `not-found` | Canonical order, market, resolution, or operation is absent |
