# Protocol v1 architecture

The filename is retained for existing links. Pricing and signing are now governed by
[protocol v2 raw-unit ratios](./raw-unit-ratio-v2.md), which supersedes v1 unit assumptions.
Order signatures now use v3 fee caps; [maker/taker fees](./trading-fees.md) supplements the settlement
and custody descriptions below. Market IDs and raw-unit ratios remain v2.

## Deployment graph

```text
ProtocolAuthority ─────┬── MarketRegistry ── ManualResolutionController ── ConditionalTokens
                       └── ConditionalExchange ──┬── OrderValidator
                                                ├── ConditionalSettlement ── ConditionalTokens
                                                └── IOCRouter

ConditionalTokens ─────── PositionRouter
ConditionalExchange ───── OrderRecoveryRouter
ProtocolAuthority ─────── ProtocolFeeVault ── ConditionalTokens
ConditionalSettlement ─── ProtocolFeeVault
```

Every connection is immutable or configured exactly once before use. Construction and configuration reject mismatched CTF, registry, controller-version, exchange, validator, settlement, router, or authority references. None of these contracts is a proxy.

## Responsibilities

| Component | Responsibility | Asset authority |
|---|---|---|
| `ProtocolAuthority` | Delayed default administration and operational role membership | None |
| `MarketRegistry` | Manual curated markets, immutable terms, exact USDG address, CTF condition preparation, lifecycle | None |
| `OrderValidator` | EIP-712 hash and EOA/ERC-1271 signature verification for one exchange | None |
| `ConditionalExchange` | Per-order escrow, sequences, nonces, caps, cancellation, fill accounting | Holds only live order reservations |
| `ConditionalSettlement` | Exchange-only atomic pull, CTF split, and output delivery | Transient fill amounts only; no admin or arbitrary transfer |
| `ProtocolFeeVault` | Admin-configurable maker/taker rates, isolated fee-claim custody and withdrawal | Only its own earned/donated claims; never user escrow |
| `IOCRouter` | At most 32 maker fills followed by atomic taker-remainder cancellation | None |
| `OrderRecoveryRouter` | At most 64 best-effort stale-order releases | None |
| `PositionRouter` | Optional exact-amount merge and redemption | Transient user-provided claims only |
| `ManualResolutionController` | One-time manual YES, NO, or invalid payout reporting with evidence reference | No collateral custody |
| `ConditionalTokens` | Canonical collateral splitting, merging, payout accounting, and redemption | Holds backing collateral |

The split is necessary because a monolithic exchange exceeded the EIP-170 runtime limit. The build targets the conservative `paris` EVM until exact Robinhood testnet opcode compatibility is proven. With Solidity 0.8.30, `via_ir`, and 7,500 optimizer runs, the fee-enabled exchange is 23,560 runtime bytes, below the 24,576-byte limit; rerun the size check after every change. Deployability does not imply production approval: audit M-02 remains open.

## GTC flow

1. A user signs the v3 `Order` with `maxFeeBps`, domain-separated by chain ID and `ConditionalExchange` address, with `limitPriceRawX18` expressed as raw quote/raw base scaled by `1e18`.
2. Anyone may relay `openOrder`; `OrderValidator` verifies the maker signature.
3. The exchange validates market state, expiry, nonce, tick, step, size, and caps, stores the reservation, then pulls exact funding from the maker.
4. The matcher submits crossing orders. The exchange re-hashes both originals, validates their stored state, and derives the maker price from their onchain sequences.
5. The exchange reduces reservations before calling `ConditionalSettlement`.
6. Settlement snapshots maker/taker rates and checks both signed caps, pulls exact fill funding, splits only whole-funded amounts, deducts fees from received active claims, and sends those fees to the immutable vault. Inactive claims are returned without deductions.
7. The exchange returns bid price improvement immediately and emits `OrderFilled`.

Any failure reverts the complete transaction.

The offchain price-level structures, canonical proposal format, fencing, and replay behavior are
specified in [Order-book matcher v1](./orderbook-matcher-v1.md).

## IOC flow

`IOCRouter.executeIOC` is one transaction. It opens a signed IOC taker, calls the exchange once per supplied GTC maker, then cancels any remainder. The maker list is capped at 32. The transaction is atomic; production matchers must simulate it and remove stale maker entries.

## Pause and recovery

| Operation | Trading pause | Market frozen | Awaiting/resolved |
|---|---:|---:|---:|
| Open order | Blocked | Blocked | Blocked |
| Fill | Blocked | Blocked | Blocked |
| Maker cancel | Allowed | Allowed | Allowed |
| Expiry/nonce release | Allowed | Allowed | Allowed |
| Closed-market release | N/A while open | Allowed | Allowed |
| Merge complete claims | Allowed | Allowed | Allowed |
| Redeem resolved claims | Allowed | Allowed | Allowed |

## Manual-only boundaries

Only `MARKET_ADMIN_ROLE` can create/open a market. Only `RESOLUTION_ADMIN_ROLE` can submit the reviewed payout. No contract calls Polygon, Polymarket, a bridge, a watcher, or a news/API endpoint. Offchain data can prepare a draft or evidence packet but can never cause an onchain state change without the explicit admin transaction.
