# Cross-chain order support: design and implementation plan

Status: proposal, not implemented. Date: 2026-09-29.

## Summary

One off-chain order book serves linked markets on several EVM chains, starting with Base and
Robinhood Chain. A trader on either chain can trade any linked market and choose which chains'
stock they are willing to receive.

- **Stock tokens never leave their native chain.** Each chain's exchange keeps custody of its own
  issuer's tokens, and every stock-side claim is pinned to the chain that holds its backing.
- **Only dollars cross chains**, and only as plain tokens, moved on request (Circle CCTP where
  available).
- **A cross-chain trade executes as two legs.** Each leg is a claim transfer on one chain, and an
  authenticated cross-chain message binds the two together. The funds that pay the second leg
  are locked before the match, so the second leg cannot fail for lack of funds.
- **Linked markets resolve from one signed event resolution** that every chain verifies. Each
  chain resolving on its own could produce different outcomes.

The new logic is added to the existing exchange as a delegatecalled extension, behind a
governance delay. Existing balances, markets, resting orders and on-chain trading keep working
unchanged, so nothing has to be migrated.

## 1. Goals and non-goals

Goals:

- A user on any supported chain can trade any linked market from one book.
- Buyers choose which chains' stock (which issuers) they accept.
- Settlement is physical, in the issuers' own tokens. No wrapped or synthetic stock.
- Today's single-chain behaviour, balances, markets and URLs stay valid. No liquidity migration.
- Moving user funds requires either the user's own signature or a delayed, publicly visible
  governance action. No single key or bridge can move them on its own.
- Blast radius is bounded by caps, rate limits and an operator bond.

Non-goals for the first version:

- Moving stock tokens between chains (impossible without issuer support, see §2).
- Merging dollar claims across chains (a later phase, §12.3).
- More than two chains at launch. The design supports N.
- Non-EVM chains.

## 2. Constraints

### 2.1 Chains

| | Base | Robinhood Chain |
|---|---|---|
| Stack | OP-stack origin; Base announced it is leaving the Superchain for its own stack (Feb 2026) | Arbitrum Orbit/Nitro L2 settling to Ethereum, chain ID 4663 (testnet 46630), mainnet since 2026-07-01 |
| Blocks and confirmation | ~200 ms Flashblocks, ~2 s L2 blocks | ~100 ms blocks, soft confirmation < 1 s |
| L1 finality | ~20 min | ~13 min after the batch is posted |
| Native dollar | USDC (native) | USDG (Paxos). No native USDC |
| Circle CCTP V2 | Yes (domain 6). Fast Transfer ~8 s, standard 15–19 min | No |
| Messaging | CCIP, LayerZero, Hyperlane, Across | CCIP (official provider; the Base↔Robinhood Chain lane is live), LayerZero (EID 30416), Hyperlane, Across (delivers USDC as USDG in ~2 s) |
| Trust notes | Withdrawals via L1: 5–7 days | L2BEAT: "not even Stage 0". A 7/8 multisig can upgrade instantly, and a transaction-filtering precompile exists |

CCIP's default finality policy waits about **18 min** for messages leaving Base, and about **1 s**
for messages leaving Robinhood Chain, which means it trusts the sequencer.

Sources:
- https://docs.robinhood.com/chain/transaction-finality/
- https://l2beat.com/scaling/projects/robinhood
- https://docs.chain.link/ccip/concepts/execution-latency/finality-by-chain
- https://developers.circle.com/cctp/cctp-supported-blockchains
- https://across.to/blog/bridge-to-robinhood-chain-with-across

### 2.2 Stock tokens

| | Coinbase stock tokens (Base) | Robinhood Stock Tokens (Robinhood Chain) |
|---|---|---|
| Legal form | Trust certificate of an ADGM SPV; Alpaca custodies the shares | Debt security of Robinhood Assets (Jersey) Ltd |
| Chains | Base only (a Base precompile) | Robinhood Chain only |
| Transfers | Permissionless by default. Policy scopes plus freeze and seize | Open by default. Blocklist, per-token pause and a global pause |
| Mint and redeem | Authorised participants mint. Only KYC'd "vested holders" can redeem | Authorised participants mint. KYC redemption only where no authorised participant is available |
| Eligibility | Reg S, non-US; UK excluded; full list unpublished | Excludes US, Canada, UK, Switzerland and sanctioned countries; reportedly also the UAE |
| Corporate actions | Multiplier (ERC-8056); the immediate path has no timelock | ERC-8056 `uiMultiplier`; dividends reinvested |

Consequences:

- Neither token can exist on the other chain.
- The two are not legally interchangeable.
- Their multipliers drift apart, so one raw unit of each is not the same number of shares.

Sources:
- https://docs.base.org/base-chain/specs/reference/b20
- https://docs.robinhood.com/chain/stock-tokens/
- https://docs.robinhood.com/rhj/restricted-jurisdictions
- https://governance.aave.com/t/coinbase-b20-equities-on-base-assessments/25690

### 2.3 Precedents and incidents

- **Orderly:** off-chain matching, a vault per chain, one settlement ledger.
- **Polymarket CTF Exchange:** off-chain matching of signed orders, on-chain settlement.
- **dYdX:** gates and rate-limits withdrawals.
- **Vertex Edge:** synchronized books across chains, with the operator taking the other side as
  principal. Shut down in August 2025.
- **KelpDAO, April 2026:** $292M lost because a bridge relied on a single verifier. Ronin's
  August 2024 loss was limited by a per-transaction cap. Both inform §13.

## 3. Design principles

1. **Pin the stock.** A stock-side claim is backed by, and redeemable on, exactly one chain.
2. **Only dollars cross, and only as plain tokens, on request.** Correctness never depends on
   bridging.
3. **Custody stays per chain.** An issuer freeze or chain outage on one chain cannot touch funds on
   another.
4. **Two legs, one message, locked funds.** The first leg executes directly and proves itself by
   message. The second leg debits funds that were locked before the match.
5. **One resolution per event**, signed once and verified on every chain.
6. **Add, never replace.** New behaviour arrives as extension functions behind a 14-day exit
   window. Existing functions and their guarantees never change.
7. **Fail closed, cap everything.** Unknown events halt indexing. Legs, chains and in-flight value
   are capped, and an operator bond covers operator error.

## 4. Architecture

```
            ┌──────────────────────── off-chain ─────────────────────────┐
  traders ─▶│ API gateway ─▶ matching engine ─▶ settlement service        │
  (signed   │      ▲              │                   │   │               │
   orders)  │  indexer(Base)  indexer(RHC)      submits legs, retries,   │
            └──────┼──────────────────────────────────┼───┼───────────────┘
                   │                                  │   │
        ┌──────────┴─────────── Base ─────┐   ┌──────┴───┴──── Robinhood Chain ─┐
        │ ConditionalStocks (unchanged)   │   │ ConditionalStocks (unchanged)   │
        │   └ CrossChainExtension ◀──┐    │   │   └ CrossChainExtension ◀──┐    │
        │ CrossChainPort ────────────┘    │   │ CrossChainPort ────────────┘    │
        └────────────┬────────────────────┘   └────────────┬────────────────────┘
                     └──── CCIP + second verifier ─────────┘
```

### On each chain

- **`ConditionalStocks` (existing, unchanged).** Custody, the ledger, markets, on-chain books,
  deposits and withdrawals.
- **`CrossChainExtension` (new).** A module reached by delegatecall through the extension
  registry added in Phase 0. It runs in the exchange's storage context and keeps its own state in
  ERC-7201 namespaced storage. It implements:
  - cross-chain balances (§6)
  - verification and fill tracking of signed orders (§7)
  - the two leg types (§9)
  - market links (§5)
  - event resolution (§11)
  - dollar bridge-out (§12)
- **`CrossChainPort` (new, standalone, holds no funds).** The only contract that talks to
  messaging protocols. It:
  - sends leg messages
  - accepts an inbound message only when **two independent verifiers** deliver the same payload
    hash: CCIP plus LayerZero DVNs or a Hyperlane ISM
  - enforces per-route rate limits
  - then calls `exchange.executeRemoteLeg(payload)`
  - is the only caller that `executeRemoteLeg` accepts

### Off-chain

- **Matching engine (new, `services/matching-engine`).** Books per market group, filter-aware
  price-time priority, balance and eligibility checks, and a published match log.
- **Settlement service (new, `services/settlement`).** Submits first legs in batches, tracks
  second legs, retries, alerts, and nets dollar movements.
- **Indexers (existing `services/indexer`), one per chain,** feeding the engine and API.
- **API gateway (existing `apps/server`),** extended to hold several deployments.
- **Dollar rebalancer.** CCTP where both chains support it; Across (USDC→USDG) otherwise.

## 5. Identities

| Identity | Definition | Where |
|---|---|---|
| Deployment | `chainId` plus exchange address. The domain string `${chainId}:${exchange}` already scopes every DB row | existing |
| Event key | `keccak256(abi.encode(polymarketCondition, yesIndex, noIndex))`. Same event and same YES semantics on every chain | Phase 0 (stored on-chain) |
| Underlying | A bytes32 ASCII asset id such as "US:NVDA", recorded per stock token by `listPool`. NVDA from any issuer maps to one underlying | Phase 0 (on-chain) |
| **Market (public)** | The product market: one event × one underlying stock. Its key is `keccak256(abi.encode(eventKey, underlying))` (the contract's `marketKey`); the public id is its first 8 bytes as 16 hex digits, shown in URLs with a readable slug (`nvda-<id>`). Chain-independent: it has one or more venues. This is the `group` field in orders and the engine's book key | Phase 0 |
| Venue | One on-chain market `(chainId, exchange, on-chain market id)` backing the public market with one issuer's token. Used internally for transactions, positions, indexing and evidence; never in URLs. Two venues can share a chain (for example two NVDA issuers on Base) | existing |
| Backing | The venue whose custody backs a stock claim | per claim |

A public market has at least one venue. Today every market has exactly one. Adding a venue on
another chain, or another issuer on the same chain, doesn't change the market's ID, URL or
history. Venues of one market must share the event key, the underlying and the cutoff.

**Linking.** On each chain the market admin calls `link(venueMarketId, publicMarketId, peers[])`
on the extension. The link is recorded only if all of these hold:

- the venue's event key matches the public market's
- cutoffs are equal
- tick and step express the same share-unit grid after multiplier normalization (§7.3)

Linking changes nothing for existing holders. It only allows cross-chain legs for that market.

## 6. Balances

Two kinds of balance exist on each chain.

**Regular balances** are today's `_credit` and per-market `_accounts` claims. Withdrawal stays
instant and is never pausable. On-chain trading uses only these.

**Cross-chain balances ("x-balances")** live in the extension's namespaced storage:
`xCredit[owner][token]` and `xClaims[market][branch][owner] = {quote, base}`.

- **Lock, instant.** `xLock(token | market-claim, amount)` moves regular balance into x-balance.
- **Release, delayed.** `xRequestRelease(...)` records a request. `xRelease(...)`, callable by
  anyone after `W`, moves the lesser of the requested amount and what is still available back to
  regular balance.
  - Requested funds stay available to legs until released.
  - The engine stops matching them the moment the request is seen.
- **Split, merge, redeem inside x-balances.** `xSplit`, `xMerge` and `xRedeem` mirror the core
  functions and update the same `_backing` and `_pools[token].liability` fields.
- **Gasless for remote users.** Every x-balance action can be authorized by EIP-712 signature and
  submitted by the relayer. A Base user who received claims on Robinhood Chain never needs
  Robinhood Chain gas.

Only x-balances can be debited by a cross-chain leg. The release delay guarantees that a second
leg arriving by message still finds the funds its order committed.

**Choosing `W`.** `W` must be at least 2 × (worst-case message latency under the finality policy)
plus the settlement service's retry SLA. Default is 2 h. The code enforces a minimum of 1 h, and
each chain can configure a higher value.

**Per-chain invariants.** Enforced in tests and checked by `services/indexer` reconciliation.

1. For each token: `_pools[token].liability = Σ credit + Σ xCredit + Σ market backing + escrow of
   resting orders`.
2. For each market and collateral: `backing = Σ YES claims = Σ NO claims`. The sums include
   x-claims, fees and escrow, and only apply before resolution.
3. The extension never creates or destroys value. Legs only move claims between owners;
   split and merge move value between credit and backing.

## 7. Orders

### 7.1 Signed order

```solidity
struct CrossOrder {
    address maker;         // signer; ERC-1271 allowed on the home chain
    uint64  homeChainId;   // the only chain that debits this order
    bytes32 group;         // market group
    uint8   branch;        // 0 YES, 1 NO
    uint8   side;          // 0 buy stock claims, 1 sell
    uint128 priceX18;      // quote per share unit x 1e18 (normalized, §7.3)
    uint128 shares;        // share units x 1e18
    uint64  accept;        // buys: bitmask of backing chains accepted; sells: own backing only
    uint16  maxFeeBps;
    uint40  expiry;
    uint64  nonce;
    uint64  epoch;         // bump to cancel all open orders
    address recipient;     // credited on remote chains (default: maker)
}
```

- **Domain.** A chain-agnostic EIP-712 domain,
  `EIP712Domain(string name,string version)` with name "Probabl Cross-Chain Order" and version "1",
  so the same order verifies on every chain.
- **One debit chain per order.** An order is only ever debited on its `homeChainId`, and its fill
  is tracked there (`filled[orderHash]`). It can therefore never be over-filled across chains.
- **Home chain by side.** A seller's home is the chain holding its stock claims. A buyer's home is
  the chain holding its dollars.

### 7.2 Cancellation

- **Off-chain cancel is instant.** The engine stops matching immediately.
- **On-chain cancel is delayed.** `xCancel(nonce)` or `xBumpEpoch()` takes effect after `W`, the
  same rule as releases. A leg for a match committed before the cancel must still succeed.
- **Expiry is absolute.** A leg whose match time is after the order's expiry reverts.

### 7.3 Units across issuers

The engine quotes in share units:

```
shares = raw × uiMultiplier / 1e18
```

The multiplier is read per token at match time; tokens without one use 1e18.

Legs carry raw amounts. Each leg recomputes the share quantity from its local multiplier and
reverts if it differs from the match by more than one raw unit. Rounding always favours the
maker. Quantities round down to the coarser of the two markets' step grids. A match that cannot
be expressed exactly on both legs is not made.

## 8. Matching engine

- **Books.** One book per `(group, branch)`. Each ask carries its backing; each bid carries its
  `accept` mask.
- **Priority.** Price-time priority with eligibility:
  - An incoming bid walks asks from best price, skipping backings it doesn't accept.
  - An incoming ask walks bids, skipping bids that don't accept its backing.
- **Depth display.** Depth is shown per accept filter. The default filter is the set of issuers
  the user is eligible for (§15).
- **Pre-trade checks.** Before each match the engine checks:
  - both markets are OPEN
  - x-balances cover the match, net of pending legs
  - no release request covers the funds
  - both parties pass issuer eligibility
  - per-user and per-group exposure caps hold
- **Fees.** Per chain, as today, at each leg's market's own maker and taker rates:
  - the buyer's fee is taken in base claims on the stock chain
  - the seller's fee is taken in quote claims on the dollar chain
  - the maker's rebate, its market's share of the taker's fee, is paid on the taker fee's chain

  This mirrors the existing `Trade` semantics.
- **Existing on-chain liquidity.** Resting on-chain orders appear as depth. A signed taker order
  can hit them only on the same chain: the operator, acting as the user's delegate through the
  existing delegation grants, calls today's `place`.
- **Match log.** Every match is appended to a hash-chained log with sequencer timestamps and
  published for audit.
- **Self-trade prevention** is by maker address across chains.

## 9. Settlement protocol

### 9.1 Match and legs

```
Match {
  matchId, time, group, branch,
  stockChain S, marketS, seller order hash, raw stock amount, buyer fee (base claims),
  dollarChain D, marketD, buyer order hash, raw quote amount, seller fee (quote claims),
  buyer recipient on S, seller recipient on D
}
```

**Stock leg, on S:**
- Debit the seller's x-claims (base, branch). If short, auto-split the seller's stock x-credit:
  the branch claim goes to the buyer and the opposite branch stays with the seller.
- Credit the buyer's recipient's x-claims with base claims, net of the buyer fee.
- Record `filled[sellerOrder]`.

**Dollar leg, on D:**
- Debit the buyer's x-claims (quote, branch). If short, auto-split the buyer's dollar x-credit.
- Credit the seller's recipient's x-claims with quote claims, net of the seller fee.
- Record `filled[buyerOrder]`.

**Order of execution.** The stock leg runs first, because stock is the scarce, non-bridgeable
asset. Its successful execution emits `LegExecuted(matchId, payloadHash)`, and the port sends the
payload to D, where the dollar leg executes.

**Same-chain matches (S = D)** execute both legs in one transaction, with no message.

### 9.2 Message

```
LegMessage {
  version, matchId, srcChainId, dstChainId, dstExchange,
  match fields for the destination leg,
  srcLegHash   // hash of the executed source leg
}
```

- **Delivery.** Through `CrossChainPort`, requiring an identical payload hash from both verifiers.
- **Batching.** One message may carry a batch (an array, or a Merkle root plus proofs).
- **Idempotency.** `executed[matchId]` on every chain; replays revert. Matches are independent,
  so delivery order doesn't matter.
- **Execution.** The destination leg verifies the counterparty's signed order (limit price,
  quantity, fee cap, expiry, recipient) before moving anything. A forged message alone can
  therefore only execute trades that a real user actually signed.

### 9.3 Failure handling

| Failure | Effect | Handling |
|---|---|---|
| First leg reverts (released funds, market frozen, engine bug) | Nothing moves, no message | Match marked failed; both parties notified; engine fixes its state |
| Second leg reverts (shouldn't happen: funds locked) | Port stores the message for manual re-execution (CCIP manual execution) | Extension pays the counterparty from the operator bond, then alerts |
| Message delayed beyond SLA | Funds stay locked (release delay `W`) | Alert; permissionless re-execution |
| Verifiers disagree | Port refuses | Incident; guardian pauses inbound legs on that route |
| Over-fill by the engine (buyer matched twice on S) | Second dollar leg fails its fill check | Bond covers the seller; the settlement service checks both chains' fill state before each submission |

**Operator bond.** A per-chain bond held by the extension. It must stay at least as large as the
in-flight value cap, and legs pause automatically when the bond falls below that cap.

### 9.4 Latency

| Path | First leg | Message | Second leg | User sees |
|---|---|---|---|---|
| Stock on Robinhood Chain, dollars on Base | < 1 s | ~1 s (CCIP, soft finality; capped amounts) or ~15 min (L1 finality, above the cap) | ~2 s | Fill instantly; settled in seconds or minutes |
| Stock on Base, dollars on Robinhood Chain | ~2 s | ~18 min (CCIP waits for Base finality) | < 1 s | Fill instantly; settled in ~20 min |

The second verifier's latency applies too. The effective latency is the slower of the two.

**Finality policy by size.** Legs below a per-route cap may use soft finality. Larger legs wait
for L1 finality.

## 10. Compatibility with today's single-chain trading

- On-chain books, regular balances, delegation, withdrawals and the current API behave exactly
  as now.
- x-balances are opt-in. A user who never locks funds is never exposed to a cross-chain leg.
- Linking a market adds cross-chain legs without changing its terms or anyone's claims.
- Signed-order takers can reach existing on-chain liquidity through the delegation path.
- Nothing is redeployed. The extension and port are added through the Phase 0 registry. A new
  chain gets its own fresh deployment, where new liquidity would arrive anyway.

## 11. Lifecycle, resolution, positions

- **Cutoff.** Linked markets share a cutoff. The engine stops cross-chain matching at cutoff.
  The extension refuses to begin resolution of a linked market before `cutoff + W`, and any leg
  arriving later reverts and is covered by the bond.
- **Freeze.** A guardian freeze on either chain stops the engine from matching that group.
  Legs of already-committed matches still execute, because legs are allowed in FROZEN.
- **Event resolution.** The resolution admin signs one chain-agnostic EIP-712 message:
  `EventResolution { eventKey, yes, no, evidenceHash, uri }`.
  - `resolveEvent(signature, marketIds[])` on each chain resolves every local linked market of
    that event to the same payouts.
  - For linked markets the per-market commit-and-resolve path is disabled. Unlinked markets keep
    using it.
  - Evidence packets gain a multi-deployment version. Today's `EvidenceDeployment` binds a packet
    to one deployment.
- **Redemption.** `xRedeem` turns x-claims into x-credit. Regular redemption is unchanged.
- **Merging.** Split and merge only combine claims of the same market on the same chain. A YES
  claim backed by one issuer and a NO claim backed by another are different assets and never
  merge. The UI labels every position with its backing.

## 12. Dollars

1. **Where each leg pays.** Each leg pays dollars in the dollar chain's quote token: USDC on Base,
   USDG on Robinhood Chain.
2. **Moving dollars between chains, only on request, and only plain dollars:**
   - With CCTP on both chains: `bridgeOut(amount, dstChainId, recipient)` burns via CCTP V2 and
     mints to the recipient. A destination hook can call the exchange's `depositFor`, making it
     arrive already deposited.
   - Without CCTP (Robinhood Chain today): Across, at a quoted fee, delivering USDC as USDG.
   - The settlement service nets flows, so the protocol itself never needs to bridge to stay
     correct.
3. **Later: merging dollar claims across chains.** Where dollars burn and mint 1:1, a user holding
   USDC-if-YES on one chain and USDC-if-NO on another can merge them. Burning both claims leaves
   each vault with backing for an unmatched claim in one world only. Paying the user 1 USDC on one
   chain leaves a one-world deficit there and a surplus on the other, which a CCTP transfer
   settles after resolution. This only works for dollars that burn and mint 1:1; never for stock.

**USDG caveat.** Until Robinhood Chain has native USDC with CCTP, dollars on the two chains are
different stablecoins. Cross-chain trades then carry a small USDC/USDG basis, and rebalancing
depends on Across relayers. Either the engine applies a configurable dollar-basis haircut, or
cross-chain matching is limited to one chain's quote currency.

## 13. Security model

### 13.1 Trust assumptions

| Actor | Can | Cannot |
|---|---|---|
| Operator (matching and settlement keys) | Order, delay or censor matches; spend bond on errors | Move funds without the owner's signed order; over-fill an order on its home chain; withdraw anything |
| Messaging (CCIP plus second verifier) | Delay delivery | Deliver a leg unless both verifiers agree; execute a trade no user signed |
| Admin (extension registry) | Add new functions after 14 days | Change existing functions; add code faster than the exit window |
| Guardian | Pause new legs, matching and inbound routes; cancel pending extensions | Pause withdrawals, releases or exits |
| Issuers and chains | Freeze or pause their own tokens on their own chain | Affect other chains' custody |

### 13.2 Threats

1. **Forged message.** Needs both verifiers compromised, and even then only executes orders users
   actually signed, which means paying without receiving. Mitigations:
   - per-leg and per-route caps
   - rate limits
   - delayed execution of large legs
   - the settlement service cross-checks both legs and the guardian auto-pauses on any mismatch
2. **Replay.** Prevented by `executed[matchId]`, per-order `filled`, `nonce` and `epoch`.
3. **Release or cancel races.** Prevented by the delay `W`, engine cut-off at request time, and
   the bond.
4. **Reorg of the first leg.** Finality policy by size (§9.4). Soft-finality routes are capped.
5. **Operator misbehaviour.** Bond, public match log, per-order limits and user-signed prices.
6. **Extension governance abuse.** 14-day delay, public events, guardian cancel, and the
   unpausable regular `withdraw`.
7. **Issuer freeze.** Isolated to that chain's custody. The engine stops matching affected
   backings.
8. **Compliance failure (ineligible recipient).** Pre-trade screening (§15) and default accept
   masks.

### 13.3 Caps and circuit breakers

- Total x-balance per chain
- Per-leg maximum
- In-flight value per route
- Per-user open cross-chain exposure
- Bond coverage ratio

Breaching any cap stops new matches; exits never stop. Monitoring covers the §6 invariants,
second-leg completion time, verifier agreement, bond ratio, and match-log continuity.

## 14. Liveness and exits

If the operator or messaging stops:

- Users request release and withdraw after `W`.
- Delivered messages can be executed by anyone.
- Signed orders expire.
- Legs that never arrive are covered by the bond, which is why in-flight value is capped at or
  below the bond.

## 15. Compliance

- Each issuer's eligibility is enforced separately. A buyer's default accept mask contains only
  issuers they are eligible for.
- Recipient addresses are pre-screened against Base's policy (`isAuthorized`) and Robinhood's
  blocklist registry.
- Geofencing continues as today.
- Open legal questions (§19): holding issuer tokens in custody for remote users, and the
  operator's status.

## 16. Data, API and UI

| Area | Change |
|---|---|
| DB | Tables `xorders`, `matches`, `legs` (state machine: matched → first-executed → second-executed or failed), `releases`. All domain-scoped like today |
| Indexer | One follower per chain (the follower is already per-domain). Replica support for the extension's events |
| API | `POST /v1/xorders`, `DELETE /v1/xorders/:hash`, `GET /v1/books/:group`, `GET /v1/matches/:id`, `POST /v1/x/release`; SSE for fills and settlement status; markets are addressed by the public market ID, and each market view lists its venues (`chainId`, exchange, on-chain market ID, base token, issuer) |
| Web | Accept filter, a backing label on every position, settlement status ("settling, ~18 min"), release timers, eligibility-aware default |
| Market maker / Δ-Vault | One vault per chain quoting its own backing into the shared book |

## 17. Implementation plan

### Phase 0: prepare the single-chain codebase — implemented (2026-09-29)

These are the changes whose later cost would be a migration or a breaking change. The product
stays single-chain and behaves as before; only market addressing changed (below).

| # | Change | As implemented |
|---|---|---|
| 0.1 | Extension registry with a 14-day exit window | `ConditionalStocksAdmin`: `proposeExtension(selectors, module)` (admin; module `address(0)` proposes removal), `activateExtension(selector)` (anyone, after 14 days), `cancelExtension(selector)` (admin or guardian), `extension(selector)` view, and a fallback that delegatecalls activated modules or reverts `UnknownSelector()`. The exchange's runtime is unchanged (24,159 B) |
| 0.2 | Event key per market on-chain | `createMarket` stores `keccak256(abi.encode(condition, yesIndex, noIndex))`; views `eventKey(id)` and `marketKey(id)` |
| 0.2b | Underlying per stock token on-chain | `listPool(token, underlying)` stores an immutable bytes32 asset id such as "US:NVDA" (`PoolListed` carries it); view `underlying(token)`. It comes from the asset catalog by the token's on-chain symbol (`packages/shared/src/token-catalog.ts`); unlisted tokens outside the catalog cannot be listed |
| 0.3 | Quote token pinned per chain | `scripts/evm/deploy.ts` refuses any quote other than Circle USDC on Base / Base Sepolia and Paxos USDG on Robinhood Chain (symbol check only on its testnet, which has no published address) |
| 0.4 | Chain-independent public market ids | `marketId = first 8 bytes of keccak256(abi.encode(eventKey, underlying))`, equal to the contract's `marketKey`. Every API view uses it as `id`/`marketId` and carries `venue { chainId, exchange, marketId }`; routes accept a public id, a slug (`nvda-<id>`), the full key or a numeric on-chain id. Web URLs are `/markets/<slug>`; numeric links redirect. `/markets` lists one venue per public market (an open one, else the newest not archived); `?venues=all` lists every venue (the admin console uses on-chain ids) |
| 0.5 | Deployment-list config | Web `deployments` (one entry from `NEXT_PUBLIC_*`); market transactions and explorer links resolve their deployment from the market's venue (`venueDeployment`, `explorerFor`); wallet-level flows use the default deployment. Order placement keeps sending the venue's on-chain market id, which the contract packs into the order |

Rules that hold for every extension:
- Selectors the exchange or admin module already implement never reach the fallback, so they can
  never be overridden (tested).
- Extensions inherit `ConditionalStocksBase`, keep their own state in ERC-7201 namespaced slots,
  and pause only their own non-exit functions. An extension's exit functions (release, withdraw)
  must never be pausable.
- Regular `withdraw` stays instant and unpausable, which is what makes the exit window real.
- The replica (`packages/evm-client/src/ledger.ts`) treats `ExtensionProposed`,
  `ExtensionActivated` and `ExtensionCancelled` as no-ops and throws on any other unknown event, so
  the indexer fails closed. Operators upgrade it during the 14 days before an activation.

Verification: 67 Foundry tests (11 new: delay, cancel, removal, re-proposal, no override,
namespaced storage, withdrawals during a proposal, identity storage), 283 TypeScript tests (new:
identity helpers, contract-vs-indexer key equality, public-id routes, duplicate venues, replica
events, admin catalogue checks, stream validation), and a full local run: 42 markets created
through the admin evidence pipeline, then API, web (slug and legacy URLs) and admin checks.

### Phase 1: signed orders on one chain (off-chain book, same-chain settlement)

- `CrossChainExtension` v1:
  - x-balances with lock, release, split, merge and redeem
  - EIP-712 `CrossOrder` verification (ERC-1271 on the home chain)
  - `filled` and `nonce`/`epoch` tracking
  - same-chain match settlement (both legs in one transaction)
  - operator bond, caps, pause
  - signed x-balance actions
- `services/matching-engine`: books, eligibility, priority, match log.
- `services/settlement`: batching and submission.
- API, DB and web additions from §16, minus the cross-chain parts.
- Deliverable: an off-chain book with gasless orders on one chain, coexisting with on-chain books.
- Estimate: 6–8 weeks, then audit scope 1.

### Phase 2: second chain and cross-chain legs

- Deploy to the second chain. The underlying registry and `link()`.
- `CrossChainPort` with CCIP plus a second verifier (LayerZero DVN or Hyperlane ISM), rate
  limits, stored-message retry.
- Stock and dollar legs split across chains; `executeRemoteLeg`; `executed[matchId]`.
- Engine: cross-chain eligibility and accept filters. Settlement: second-leg tracking and alerts.
- Two-chain test harness (§18); testnets Base Sepolia ↔ Robinhood Chain testnet (46630) on CCIP
  testnet lanes.
- Estimate: 6–8 weeks.

### Phase 3: dollars and resolution

- `bridgeOut` via CCTP V2, with a hook and `depositFor` on the destination; Across fallback.
- Settlement-service netting.
- `EventResolution` signing in the admin evidence flow, and multi-deployment evidence packets
  (`packages/market-data/src/evidence.ts`, `apps/server/src/admin/routes.ts`).
- Lifecycle sync: cutoff + `W`, freeze handling.
- Estimate: 3–4 weeks.

### Phase 4: hardening and launch

- Audits of the extension and the port. Bug bounty.
- Game days: kill the settlement service, halt messaging, simulate reorgs, simulate issuer
  freezes, force verifier disagreement.
- Mainnet with low caps. Raise caps gradually against bond size and incident-free time.
- Estimate: 4–6 weeks including audit turnaround.

**Total:** about 5–7 months for 2–3 engineers, plus two audits.

### Codebase touchpoints

| Package | Phases |
|---|---|
| `contracts/src/ConditionalStocksBase.sol`, `ConditionalStocksAdmin.sol` | 0 |
| `contracts/src/CrossChainExtension.sol` (new), `CrossChainPort.sol` (new) | 1–3 |
| `packages/evm-client` (ABI, order and resolution typed data, replica events) | 0–3 |
| `services/indexer` (multi-deployment, reconciliation of x-balances) | 0–2 |
| `packages/database` (xorders, matches, legs, releases) | 1–2 |
| `apps/server` (deployment map, new routes, relayer) | 0–3 |
| `apps/web`, `apps/admin` (deployment resolution, filters, backing labels, settlement status) | 0–3 |
| `services/market-maker` (market references, per-chain vaults) | 0, 2 |
| `services/matching-engine`, `services/settlement` (new) | 1–3 |
| `scripts/evm/deploy.ts` (quote token per chain, linking, port deployment) | 0, 2 |

## 18. Testing

- **Foundry unit tests** for every extension and port function, including every revert path.
- **Foundry invariant tests** for §6 on random sequences of lock, release, split, merge, legs,
  resolution and redemption.
- **Signature vectors** for `CrossOrder` and `EventResolution`, shared between Solidity and
  TypeScript.
- **Two-anvil harness:** two local chains and a mock messaging router that delays, drops,
  duplicates and reorders messages. Properties to check:
  - value is conserved across both chains
  - no double execution
  - the second leg always succeeds absent operator error
  - the bond covers every injected operator error
- **Engine tests:** eligibility matching, price-time priority, rounding across multipliers, and
  step-grid alignment.
- **Testnet end-to-end** on real CCIP lanes, measuring latency and cost per leg.
- **Chaos and game days** as in Phase 4.

## 19. Open decisions

1. Dollar asset on Robinhood Chain: USDG (native) versus bridged USDC. This decides the §12
   basis handling.
2. Values for `W`, bond size, caps, and the soft-finality threshold per route.
3. Second verifier: LayerZero DVN set versus Hyperlane ISM.
4. Whether to keep on-chain matching long-term, or route all takers through the engine.
5. Legal review:
   - holding each issuer's tokens for remote users
   - enforcing issuer eligibility
   - the operator's regulatory status
   - regulatory treatment of conditional stock tokens (see `docs/future-improvements.md`)
6. Fee split between legs, and who funds second-leg gas.

## Appendix A: worked example

Carol's dollars are on Robinhood Chain (D); Sam holds Coinbase NVDA on Base (S). The market is
"NVDA if the Fed cuts", linked on both chains.

1. Sam locks 10 NVDA as x-credit on Base and signs a sell: 10 shares of YES at 103, backing Base.
2. Carol locks 1,030 dollars as x-credit on Robinhood Chain and signs a buy: 10 shares of YES at
   103, accepting Base.
3. The engine matches them. Both see the fill.
4. **Stock leg on Base.** Sam's 10 NVDA x-credit auto-splits. 10 NVDA-YES go to Carol's x-claims
   on Base, net of her fee in base claims. Sam keeps 10 NVDA-NO. Base emits the leg event, and the
   port sends the message (~18 min under CCIP's Base finality policy).
5. **Dollar leg on Robinhood Chain.** Carol's 1,030 x-credit auto-splits. 1,030 dollars-YES go to
   Sam's x-claims, net of his fee. Carol keeps 1,030 dollars-NO.
6. **If the Fed cuts:**
   - Carol redeems NVDA-YES to NVDA on Base and withdraws there, gaslessly via the relayer.
   - Sam's dollars-YES become dollars on Robinhood Chain; he withdraws there or bridges them out.
7. **If it doesn't:**
   - Sam's NVDA-NO becomes his 10 NVDA back on Base.
   - Carol's dollars-NO become her 1,030 back on Robinhood Chain.

At no point does NVDA leave Base, and no message is needed after resolution.
