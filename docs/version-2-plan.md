# probabl v2: worlds, conditional payouts and a stablecoin vault

v2 lets a user say *"I'll buy NVDA if the US–China deal happens, Anthropic files its S-1 and OpenAI
orders GPUs"* and get a firm price for it. Three things make that work:

- **Worlds.** A world is up to six venue events (Polymarket or Kalshi) that must all go a chosen
  way, optionally with a stock's price at a fixing time.
- **Two cash-settled products on every world**, paid in the deployment's stablecoin (USDG on
  Robinhood Chain, USDC on Monad and Base):
  - the **conditional payout** ("pays $1 if NVDA closes above $240 on Dec 1, *if* the world
    happens; money back if it doesn't");
  - the **world bet** ("pays $1 if the world happens *and* NVDA closes above $240").
- **A stablecoin-only vault** that quotes both products over RFQ, from one pool, fully backed in
  every outcome.

v1 stays as it is. Its conditional stock markets (`ConditionalStocks`) and Δ-vaults are separate,
deliver the real stock, and keep running. v2 adds new contracts beside them and changes no v1
contract.

This plan follows from the product and quoting research of 2026-11-03 (products, user journey,
quoting and capital). The numbers in it use that research's example world; §18 restates it.

## Contents

1. Products
2. Design principles
3. System overview
4. Contracts: `EventOracle`
5. Contracts: `WorldBooks`
6. Contracts: `WorldVault`
7. The pricing engine
8. Quote charges and the risk engine
9. The LLM layer
10. Backend changes
11. UI changes
12. Admin and operations
13. Security, risk and failure modes
14. Economics
15. Testing and verification
16. Rollout phases
17. Open decisions
18. Appendix: the worked example
19. Users' worlds, as built (2026-11-04)

---

## 1. Products

### Terms

| Term | Meaning |
|---|---|
| **Leg** | One venue event and the outcome the world needs, e.g. "US–China trade deal by Nov 30: YES". |
| **World (W)** | Every leg going its chosen way. "¬W" is any leg failing. |
| **Book** | One world, plus optionally a stock feed, a fixing time and a list of strikes. Everything traded on a world lives in a book. |
| **Fixing** | The stock's price at the book's fixing time, read from its feed. |
| **Atom** | One outcome of a book. Exactly one atom wins. A book with *m* strikes has *m* + 2 atoms: atom 0 is ¬W, and atoms 1 to *m* + 1 are "W and the fixing in price bucket *j*". A book with no feed has two atoms: ¬W and W. |
| **Atom token** | Pays 1 stablecoin unit if its atom wins. One of every atom of a book (a **full set**) is always worth exactly $1. |
| **Bundle** | What a trade moves: *n* units of every atom in a set, plus *r* units of atom 0. |

Every product is a bundle of atom tokens. So the contracts only need one primitive (split $1 into a
full set, trade atoms, merge, redeem), and the vault only needs one pricing function (the
probability of each atom).

### The products as bundles

Strikes K₁ < … < Kₘ split the fixing into buckets: bucket 1 is S < K₁, bucket *j* is
K₍ⱼ₋₁₎ ≤ S < Kⱼ, and bucket *m* + 1 is S ≥ Kₘ. "Above K" means S ≥ K.

| Product | Bundle the buyer receives | Pays |
|---|---|---|
| World bet, "W and NVDA ≥ Kⱼ" | *n* × every bucket at or above Kⱼ | $1 per unit if the world happens and the fixing is at or above Kⱼ |
| World bet, "W and NVDA < Kⱼ" | *n* × every bucket below Kⱼ | likewise, below |
| World bet, range "W and Kᵢ ≤ NVDA < Kⱼ" | *n* × the buckets in between | likewise, inside the range |
| Event-only world bet, "W" | *n* × atom 1 of a no-feed book (or every bucket of a priced book) | $1 if the world happens |
| **Conditional payout** "if W, pays if NVDA ≥ Kⱼ" | *n* × buckets at or above Kⱼ, **plus r = stake units of atom 0** | refund of the stake if ¬W; $1 per unit if W and above; nothing if W and below |
| Cash-out (any product) | the same bundle, sold back | the vault's bid |

The refund is just atom 0. For a stake X, the buyer holds X units of atom 0, which pay X if the
world fails, and *n* = X / P(above | W) units of the buckets. That is 250 units for $100 at the
vault's 40¢ in-world price. Nothing in the contracts knows about "refunds".

### The example: Maya's world

NVDA is $209.06. The legs are a trade deal by Nov 30 (35%), Anthropic's S-1 (15%) and OpenAI's GPU
order (30%). The markets' odds give the world 2.8% (§18), with NVDA worth about $231.50 inside it.
The fixing is the Dec 1 4 pm ET close, at strike $240.

| | World bet | Conditional payout |
|---|---|---|
| Fair price per unit | 1.02¢ (2.8% × 36.6%) | 36.6¢ in the world |
| Vault's quote | 1.3¢ | 40¢ |
| Maya's stake | $20 → 1,538 units | $100 → 250 units + 100 refund units |
| World fails | −$20 | $100 back |
| World happens, NVDA ≥ $240 | +$1,518 | +$150 |
| World happens, NVDA < $240 | −$20 | −$100 |

Quotes in this plan are illustrative. §8 explains why a fully charged monthly world bet would quote
about 1.6¢.

### Out of scope for v2

- **Physical stock delivery in a world.** v1's conditional stock markets do that. A stablecoin
  vault can't deliver stock.
- **Uncapped stock exposure** (CFD-like). Every v2 payout is capped at $1 per unit, so it can be
  fully backed.
- **Call or put spreads** inside a world. A fine strike grid approximates them as a sum of buckets;
  a true spread is §17's follow-up.
- **Cross-book netting on chain.** Each book nets exactly within itself. Across books, the
  contracts add worst cases (§6).

---

## 2. Design principles

These are the research conclusions the plan is built on. Each is enforced somewhere below.

1. **Fully backed in every outcome.** Every atom token in existence is backed by $1 in its book.
   No promised payout ever depends on the vault being right.
2. **Capital efficiency comes only from exact netting.** One dollar may back outcomes that cannot
   both happen, never two that can. Spreading bets across worlds lowers the average loss, not the
   worst case, so it never reduces backing.
3. **One coherent joint model prices everything.** Every quote (worlds, their complements, single
   legs, every strike) comes from one set of atom probabilities. So a user can't buy from us in one
   book and sell to us in another for a guaranteed profit, and each leg's own chance matches its
   venue's price.
4. **Deterministic, in-memory pricing.** No LLM, no network call and no randomness on the quote
   path. The same inputs always give the same price, within the v1 RFQ window (500 ms) and adding
   no latency to it.
5. **LLMs work around the engine, never in it.** They turn opinions into legs, propose links
   between events and write first guesses. Code validates everything they produce, and they never
   set a price or check solvency.
6. **Reuse v1's proven pieces:**
   - RFQ, with contract makers verified by callback;
   - the two-key resolution flow and its evidence packets;
   - the shares and roles model of the Δ-vault;
   - the keeper's replica of chain state and its in-flight quote accounting;
   - one-click delegation.
7. **Users see what they need to decide** (from the user research): the maximum loss, the payout
   if right, the chance (ours beside the venues'), the earliest date money comes back, and the price
   split into world value and our fee.

---

## 3. System overview

```
                    ┌────────────────────── apps/web ──────────────────────┐
                    │ /worlds hub · world page · builder · ticket · cash-out │
                    └──────────────┬───────────────────────────┬────────────┘
                     parse / book  │ RFQ (firm quote)           │ indications, marks (SSE)
                    ┌──────────────▼───────────────────────────▼────────────┐
                    │ apps/server: world assistant (LLM, tools), book       │
                    │ registry, world RFQ fan-out, indexer views, evidence  │
                    └──────┬───────────────┬───────────────┬────────────────┘
          catalog, probs   │               │ world.rfq     │ evidence packets
   ┌───────────────────────▼──┐   ┌────────▼─────────┐   ┌─▼──────────────────────┐
   │ services/polymarket-     │   │ world-keeper:    │   │ market-automation:     │
   │ ingestor (Polymarket +   │──▶│ world pricer,    │   │ resolve-events, fix-   │
   │ Kalshi probs, history)   │   │ risk engine,     │   │ books, open-user-books │
   └──────────────────────────┘   │ quote signer,    │   └─────────┬──────────────┘
                                  │ marker           │             │
                                  └────────┬─────────┘             │
                     signed WorldQuote     │                       │ freeze / commit / resolve
   ┌───────────────────────────────────────▼───────────────────────▼──────────────┐
   │ chain: WorldBooks (books, atoms, split/merge, fills, fixing, redeem) ◀── EventOracle │
   │        WorldVault (+ WorldVaultAdmin): stablecoin LP pool, maker via onWorldFill     │
   │        price feeds (Chainlink-style, mirrored on testnet)                            │
   └──────────────────────────────────────────────────────────────────────────────┘
```

**A trade, end to end:**
1. The user builds or opens a world, picks a product, a strike and a stake, and sees live
   indications.
2. On submit, the API sends a `world.rfq` to the vault keeper and any approved makers.
3. Each maker prices the bundle and signs a `WorldQuote`.
4. The API awards the best quote. The user's one-click delegate (or the user) sends `fillQuote`.
5. `WorldBooks` takes the premium and fee, moves the bundle from the maker, splitting full sets
   from the maker's credit where its balance is short, and calls the vault's `onWorldFill`. The
   vault checks the signature and its caps on the new balances, or reverts.
6. Legs resolve one by one through `EventOracle`. The first leg that fails makes atom 0 redeemable.
   If all legs succeed, anyone fixes the price from the feed, and the winning bucket becomes
   redeemable.
7. One-click redeem pays winners. The vault merges and redeems its own atoms and posts batch marks
   for depositors.

---

## 4. Contracts: `EventOracle`

**Why a new contract.**
- The exchange resolves per *market* (`ConditionalStocksAdmin.resolve(id, yes, no, evidence,
  uri)`), and a world needs the outcome of an *event*, shared by every book that uses it.
- Adding selectors to the exchange goes through `proposeExtension` with a 14-day delay, and its
  runtime is close to EIP-170.
- So events resolve in their own contract.

**Identity.** An event is the same key the exchange uses: `eventKey = keccak256(condition,
yesIndex, noIndex)`, as in `_eventKeys`. The venue condition ids are the existing ones (Polymarket
condition ids; Kalshi ids derived from tickers by the ingestor), so v1 markets and v2 legs on the
same event agree.

**States.** `UNKNOWN → FROZEN → COMMITTED → YES | NO | INVALID`.

| Function | Role | Effect |
|---|---|---|
| `freeze(key, reason)` | market admin or guardian | Every book with this leg stops trading. Used when the result is known or imminent, mirroring `lifecycle` action 1. |
| `reopen(key, reason)` | market admin | Undoes a freeze or a pending commitment (clearing it), so books trade on the event again. |
| `commit(key, hash)` | market admin | Stores the commitment, freezing the event if it isn't already. Replaces a pending one. |
| `resolve(key, outcome, evidence, uri)` | resolution admin | Needs `hash == keccak256("PROBABL_EVM_EVENT_RESOLUTION_V1", chainid, this, key, outcome, evidence, keccak256(uri))`. Final: nothing changes it afterwards. |
| `outcome(key)`, `outcomes(keys)` | view | State and `resolvedAt`, one or many. |

It uses the same two keys as the exchange and the same flow as `resolve-markets` (freeze, commit
with an approved evidence packet, resolve), so production keeps the two-key setup.

**INVALID** (a venue's 50/50 or cancelled market) counts as the leg failing, so the world doesn't
happen. Holders of atom 0 (every conditional payout's refund) are paid, and world bets lose. The
ticket states this rule. §17 lists the alternative.

**Size.** It's small and reads cheaply: `outcome` costs one storage read per leg, and `WorldBooks`
reads at most six.

---

## 5. Contracts: `WorldBooks`

`WorldBooks` is the exchange for atom tokens. It deploys the same way as `ConditionalStocks`:
- a non-upgradeable core plus an admin module reached by `delegatecall`;
- OpenZeppelin 5.6, `ReentrancyGuardTransient` and `SafeERC20`;
- one immutable `QUOTE` stablecoin, the same token as the deployment's exchange.

It lives in `contracts/src/worlds/`.

### Custody

- `deposit(amount)` / `depositWithPermit(...)`, `withdraw(amount, to)`: plain credit,
  `_credit[owner]`, as on the exchange. A fee-on-transfer deposit credits its net. **`withdraw` is
  never paused.**
- `split(book, amount)`: debits credit and mints `amount` of every atom of the book. Allowed while
  the book is not yet decided.
- `merge(book, amount)`: burns a full set and credits `amount`. Allowed in any state, which is the
  same as v1's `merge`.
- `transferAtoms(book, atom, to, amount)`, in any state, as `transferClaim`.
- **Balances are internal**, packed `uint128` per atom (at most 10 atoms, so 5 slots per owner and
  book). This is the same internal-claims model as the exchange: no ERC-1155 receiver hooks and
  cheaper fills. An ERC-1155 wrapper can come later.

**Invariant, checked by the invariant suite:**
- before a book is decided, every atom's total supply equals the book's backing;
- after it, the winning atom's supply equals the backing;
- the book's backing plus all credit plus unclaimed fees equals `liability()`, which equals the
  contract's `QUOTE` balance.

### Books

```solidity
struct Leg { bytes32 eventKey; bool wantYes; }
struct BookDef {
    Leg[] legs;             // 1..MAX_LEGS (6), distinct events
    address feed;           // AggregatorV3 price feed; zero for an event-only book
    bytes32 underlying;     // e.g. "US:NVDA", as the exchange's listPool
    uint40  fixingTime;     // unix seconds; 0 for an event-only book
    uint32  maxStaleness;   // a fixing round must be at most this old at fixingTime
    uint128[] strikes;      // 0..MAX_STRIKES (8) ascending, in feed units
    uint40  cutoff;         // trading stops; ≤ fixingTime
    uint16  feeBps;         // taker fee on the premium, ≤ MAX_FEE_BPS
    bytes32 metadataHash;   // keccak of the metadata URI (titles, rules links)
}
```

- `createBook(def, uri)` is the book admin's (the market admin's). It returns a sequential
  `uint64 book`. `bookOf[keccak256(abi.encode(def))]` makes it idempotent: the same definition
  returns the existing book, which is how the API dedupes user-built worlds.
- **Phase 2** adds `fillQuoteNewBook`: a quote may carry a `BookDef` whose hash the maker signed,
  and the book is created in the fill. Spam then needs a maker's signature.
- **Validation:**
  - legs are distinct, nonzero, and every one still `UNKNOWN` in the oracle;
  - with a feed: 1 to 8 strikes, strictly ascending and nonzero; `cutoff ≤ fixingTime`;
    `maxStaleness` 1 s to 1 day; an underlying; a feed whose `decimals()` is at most 18;
  - without a feed: no strikes, fixing time, staleness or underlying;
  - `cutoff` in the future, `feeBps ≤ 1000`, and a metadata URI of 1 to 512 bytes hashing to
    `metadataHash`.

**Derived state.** Read by every fill, from at most six `EventOracle` reads:

| State | When | Trading |
|---|---|---|
| `TRADING` | before cutoff, no leg NO or INVALID, no unresolved leg frozen, not paused | yes |
| `HALTED` | an unresolved leg is frozen or committed, or the book is frozen (`setFrozen`, by the book admin or the guardian; only the book admin unfreezes) | no |
| `CLOSED` | past the cutoff, legs still pending (or all passed, before the fixing time) | no |
| `FAILED` | any leg NO or INVALID | no; atom 0 redeemable at once |
| `AWAITING_FIX` | every leg YES and now ≥ fixing time (or every leg YES, no feed: `PASSED` at once) | no |
| `PASSED` / `FIXED` | event-only book with all legs YES / fixing finalized | no; the winning atom is redeemable |

A leg that resolves the world's way mid-book doesn't stop trading. The book trades on with that
leg certain, and the pricer knows it. The global `pause` stops every fill but not custody,
positions, fixing or redemption. `FAILED` and `PASSED` latch on the first `settle`, `split` or
`redeem` that sees them.

### Fills

A quote names the maker, the bundle and the price:

```solidity
struct WorldQuote {
    address taker;   // the account the bundle goes to (or comes from, on a sell)
    uint64  book;
    uint16  mask;    // atoms 1..m+1 in the bundle
    uint128 units;   // n: units of each masked atom
    uint128 refund;  // r: units of atom 0 (the conditional payout's refund)
    bool    sell;    // false: taker buys the bundle; true: taker sells it to the maker
    uint128 price;   // total stablecoin paid (buy) or received (sell), before the fee
    uint40  expiry;
    uint64  makerData; // signed and passed to the maker's hook; the vault puts its quoteEpoch here
    uint256 nonce;   // < 2^96: wallet maker; ≥ 2^96: maker contract = nonce >> 96
}
```

- **EIP-712:** domain `"Probabl Worlds"`, version `"1"`. It is a typed struct, not a packed word:
  a fill is one quote, so readability wins over the few hundred gas.
- **Nonces:** the same scheme as v1 (bit `nonce % 256` of word `nonce / 256`; a contract maker's
  nonce is `address << 96 | counter`), so `contractQuoteNonce` and `quoteNonceMaker` carry over.
  The typehash is new: `WORLD_QUOTE_TYPEHASH`.
- **Signatures:** EIP-2098 compact `(r, vs)`. High-`s` (malleable) and zero-recovering
  signatures are refused. A garbage signature recovers some unknown address, which can only "make"
  out of the taker's own payment.
- **Entry points:** `fillQuote(q, r, vs)` by the taker, and `fillQuoteFor(q, r, vs)` by a delegate
  of `q.taker`. The quote's price is exact, so no separate limit is needed.
  - **Delegation:** `approveDelegate(delegate, expiresAt ≤ 90 d, maxBuy, totalBuy, maxSell,
    totalSell, maxFeeBps, permissions)`, with BUY 1 and SELL 2.
    - A buy spends price plus fee from the buy budget; a sell spends the bundle's largest payout
      from the sell budget. Neither refills.
    - `revokeDelegate` and `revokeAllDelegates` end grants.
  - So one-click trading works as in v1.
- **Refused fills:**
  - a maker equal to the taker or to the delegate;
  - a used nonce. Wallet makers can void theirs with `invalidateNonces(word, bits)`.

**Settlement, in one call:**
1. Check the fill is not paused, the quote is not expired, the bundle is valid, its price lies
   between the bundle's worst and best payout, and the book is `TRADING`. Then recover the wallet
   maker's signature, or name the maker contract, and spend the nonce.
2. **Buy:** move `price + fee` from the taker's credit (a `depositWithPermit` variant pulls it in
   the same transaction) and credit the maker `price`. Deliver the bundle from the maker's atom
   balances, splitting full sets from the maker's credit for any shortfall.
   **Sell:** take the bundle from the taker. The maker pays `price` from its credit: the taker
   gets `price − fee` and the protocol the fee. Then merge any full sets the maker now holds.
3. A contract maker gets `IWorldQuoteMaker.onWorldFill(digest, q, r, vs, makerCreditBefore)`.
   - It is a call, not a static call, made with the lock held and a gas cap (`FILL_HOOK_GAS` =
     1M). The vault's costliest hook measures about 300k on Ethereum's schedule, and Monad prices
     cold storage higher.
   - Anything but its selector, ABI-padded with zeros, reverts the whole fill: a revert, an
     out-of-gas, an empty or oversized return, or an address with no code.
   - The vault checks the signature and its caps against the **new** balances (§6).
   - Checking after the fact is simpler and safer than v1's static pre-check: the caps see exact
     state, and there's nothing to keep in sync.
4. Emit `WorldFill(book, maker, taker, bundle (mask | sell << 16), units, refund, price, fee, nonce,
   delegate)`. The event comes before the hook; a rejected hook reverts it too.

**Fees.**
- `feeBps` of `price`, rounded up, paid by the taker in plain stablecoin and non-refundable. On a
  sell it comes out of the proceeds, and it can never exceed them.
- Fees accrue to `_fees`. `claimFees(to, amount)` is the admin's and credits `to`.
- An up-front fee in real stablecoin is deliberate. The research showed that fees taken in
  branch claims (as v1 takes them, `_fees[mb]`) are worthless when a world fails, which is about
  97% of the time in the example.
- Maker rebates are not in v2.0.

**Bundle rules.**
- `mask` names atoms 1 and up that the book has (bit 0 is never set: atom 0 is `refund`).
- `units` is nonzero exactly when `mask` is.
- The bundle pays something.
- `units` and `refund` are raw units of `QUOTE`.
- `1 ≤ price` and `minPay ≤ price ≤ maxPay`: a bundle never trades for less than it is sure to pay
  or more than it can pay. So a full set trades at exactly its value.

### Fixing

The fixing is permissionless and needs no admin when the feed is healthy:

- **`proposeFix(book, roundId)`.** Needs `AWAITING_FIX`, and the feed's
  `getRoundData(roundId).updatedAt` in `[fixingTime − maxStaleness, fixingTime]` with a positive
  answer that fits 128 bits.
  - The round must also be **provably the last round at or before the fixing**. Either it is the
    feed's latest round (no later round can carry an earlier timestamp), or round `roundId + 1`
    exists and is past the fixing.
  - So nobody can pick an earlier round that suits them and wait out the window. That was the
    security review's M-1.
  - One proposal stands per book.
  - A feed with gaps in its round ids, or a Chainlink phase change at the fixing, can't prove
    either way and falls back to the two-key path.
  - `MockPriceFeed` keeps every round (`getRoundData`), so testnet works. The testnet relay should
    post consecutive round ids around fixings.
- **`finalizeFix(book)`.** After `FIX_WINDOW` (1 h) from the proposal, the bucket holding the
  proposed answer wins. The window is the guardian's chance to hold a provably-last round that is
  nonetheless wrong, such as a feed glitch.
- **Fallback.** If no valid round has been proposed `FIX_DEADLINE` (24 h) after the book reached
  `AWAITING_FIX`, the two-key path applies: `commitFix(book, hash)` by the market admin, then
  `resolveFix(book, price, evidence, uri)` by the resolution admin.
  - `AWAITING_FIX` starts at the later of the fixing time and the last leg's resolution, so a
    venue that resolves late (UMA can take days) never triggers the fallback early.
  - The historical round is still provable then, because `getRoundData` reads past rounds.
- **Guardian.** It may `holdFix(book)` at any time before the decision, freezing finalization for a
  person to resolve through the fallback; the fallback is then open at once. This is the answer to
  a manipulated or wrong round.
- **One path at a time.** Once a fallback price is committed, `proposeFix` and `finalizeFix` refuse
  (`FixHeld`), so the book has exactly one decision.

**Manipulation.**
- Feeds must price the *underlying share* from primary-market data (Robinhood's or Chainlink's),
  never a DEX price of the token.
- Fixing times are 4 pm ET closes on trading days for stocks, and any time for crypto.
- The testnet feed relay must post a round at each fixing (§10).

### Redemption

- `redeem(book)`: once `FAILED`, `PASSED` or `FIXED`, pays the caller's winning atom balance into
  its credit and zeroes its other balances of that book. A holder of only losing atoms clears them
  for zero; one with nothing at all is refused.
- `redeemMany(books)` lets one-click redeem pay many books in one transaction.
- `settle(book)` latches a decided outcome for anyone.

### Roles

| Role | Can | Cannot |
|---|---|---|
| Admin | `configure(bookAdmin, guardian, resolutionAdmin)`, two-step transfer with a 2-day delay, `claimFees` | move credit or atoms |
| Book admin (market admin) | `createBook`, `commitFix`, freeze and unfreeze a book | resolve |
| Resolution admin | `resolveFix` (events resolve in `EventOracle`) | create books |
| Guardian | `pause(bool, reason)` (fills only; it also unpauses, as on the exchange), freeze a book, `holdFix` | unfreeze a book, resolve |

### Size and gas targets

| | Measured (test/worlds/WorldGas.t.sol) |
|---|---|
| Wallet-maker fill, 7-atom book, maker splits the shortfall | 244k gas |
| Vault fill, 6 legs and 10 atoms, every vault slot cold | 554k gas |
| The vault's hook alone, risk growing in a fresh 6-leg book | 297k gas (`FILL_HOOK_GAS` is 1M) |

| Runtime size (`forge build --sizes`) | Bytes |
|---|---|
| `EventOracle` | 4,215 |
| `WorldBooks` | 14,490 |
| `WorldBooksAdmin` | 18,286 |
| `WorldVault` | 13,418 |
| `WorldVaultAdmin` | 17,476 |

All are under EIP-170's 24,576 bytes; `src/worlds/vault/**` compiles at 200 optimizer runs, like
the Δ-vault.

On Monad, gas is charged on the limit at 102 gwei, so a 400k fill costs about 0.04 MON. The
operator's gas budget (§10) must cover delegated fills.

---

## 6. Contracts: `WorldVault`

**What it is.**
- One pool of the deployment's stablecoin that makes markets in every eligible book. It is a maker
  on `WorldBooks` the way a Δ-vault is a maker on the exchange.
- It takes the Δ-vault's structure: `WorldVault` handles shares, deposits and withdrawals, and
  `WorldVaultAdmin` is a module reached by `delegatecall` that handles quoting, risk, curation and
  views.
- OZ: `ERC20` shares, `AccessControlDefaultAdminRules`, `Pausable`, `ReentrancyGuardTransient`.
- Nothing upgradeable, and no role can move holdings.

### What it holds, and why it is always solvent

- The vault holds credit on `WorldBooks` and atom balances in the books it has traded.
- Every atom it sold came from a full set it split, so **its counterparties' payouts are already
  backed in `WorldBooks`**.
- Its own risk is only how much its remaining atoms will be worth.

For each book *b* the vault tracks, updated in `onWorldFill`, `merge`, `settle` and `sync`:
- `lo_b` = minᵢ (its balance of atom *i*), what the book is guaranteed to return;
- `hi_b` = maxᵢ (its balance of atom *i*), the best case;
- `cost_b`, the net credit it has put into the book. Each fill's change in the vault's credit
  belongs to its book; `WorldBooks` passes the credit before the fill.
- `risk_b = max(0, cost_b − lo_b)`, the most the vault can lose in that book.
  - Atoms someone transfers to the vault only raise `lo`, so a gift can only lower the risk and
    can never freeze quoting. That was the security review's M-2: an earlier "largest swing"
    measure, `hi − lo`, let a gift block a leg.

Running totals: `guaranteed = credit + Σ lo_b` and `best = credit + Σ hi_b`.

**Netting is automatic.** The vault delivers from atoms it already holds before splitting new sets.

Example:
- Maya buys 1,538 units of "W and ≥ $240" for $20. The vault splits 1,538 sets, net $1,518 after
  her premium, and keeps 1,538 of every other atom.
- Ben then buys 3,000 units of "W and < $240" for $60. The vault delivers its 1,538 held units and
  splits 1,462 more: net **$1,402**, not $2,940.
- Order by order, the two would lock $4,458; netted, they lock $2,920.

The vault merges any full sets it ends up holding, which returns cash immediately.

### Eligibility (curator-set)

The vault quotes only books where:
- the feed (and `underlying`) is on its allowlist, or the book has no feed;
- the book has at most `maxLegs` legs (start at 4);
- the fixing is within `maxTenor` (start at 35 days);
- `feeBps ≤ maxFeeBps`.

No per-book registration is needed, so user-built worlds work without a transaction per book.
- The vault keeps no list of books: everything is per-book state plus running sums, so nothing
  ever loops over its books on chain.
- `settle(books)` (anyone) redeems the vault's atoms of decided books and clears their positions.
- `sync(book)` (anyone) re-reads a book after someone transfers atoms to the vault.
  - Balances can only *grow* behind the vault's back, so the tracked values never overstate.
  - A stale track can only make the vault more conservative.
- `merge(book, amount)` (keeper) turns full sets back into credit.

### `onWorldFill`: the on-chain bounds

Called by `WorldBooks` after it moves the balances. It reverts unless:
- the signer holds `KEEPER_ROLE` and the quote's `makerData` equals the vault's `quoteEpoch`. The
  guardian's pause increments the epoch, killing every outstanding quote at once.
- the vault is not paused, and the book is eligible;
- `expiry ≤ now + maxTtl` and `expiry + cutoffBuffer ≤ book.cutoff`;
- `makerData` carries the quote epoch (low 24 bits) and the keeper's signing time (the next 40).
  - The signing time may not be in the future.
  - The quote lives at most `maxTtl` *from signing*, and ends `cutoffBuffer` before the book's
    cutoff.
- the price keeps `marginBps` of the bundle's payout range inside it:
  - a sale at least `minPay + margin`, a buy-back at most `maxPay − margin`;
  - so no quote gives a bundle away, and buying back a full set always earns the vault the margin;
- the bundle's largest payout is at most `maxQuoteSize`, and its price at most `maxQuotePrice`;
- no leg of the book resolved at or after the quote's signing:
  - a quote signed before a leg resolved the world's way would otherwise fill at a stale,
    too-cheap price;
  - automation advances freeze, commit and resolve a step a minute, so a commit alone doesn't
    outlast every quote;
  - quotes signed afterwards fill at once;
- the day's **exposure** stays within `refNav × maxDailyExposureBps`. A fill's exposure is the
  most value it can move away from the vault whatever the true odds:
  - the payout given minus the price on a sale;
  - the price minus the bundle's sure payout on a buy-back.

  This is the bound on a stolen or broken keeper key, so it applies to **every** fill, unwinds
  included. Selling the vault's held atoms for almost nothing raises the guaranteed value and
  lowers the risk; without this budget it would have passed every other check (the security
  review's H-1). It is counted per calendar day, so a key can reach about twice the budget across
  midnight; size it for that.
- **if the fill grows the book's risk:**
  - the book must be eligible;
  - `risk_b ≤ maxBookRisk`;
  - each leg's risk `legRisk[ℓ] = Σ_{b ∋ ℓ} risk_b ≤ maxLegRisk`, updated incrementally for the at
    most six legs of the book;
- **if it lowers the guaranteed value,** that value stays at or above `refNav × (1 − maxLossBps)`.
  `refNav` is the last mark plus the deposits and minus the redemptions it processed.

**Unwinds always pass.**
- A fill that doesn't grow the book's risk skips eligibility and the risk caps, so de-listing a
  feed never traps a position (the security review's L-2).
- One that doesn't lower the guaranteed value skips the loss floor.
- The exposure budget still applies to both.
- The guaranteed value before the fill comes from `makerCreditBefore` plus the tracked sums, so
  the comparison is exact.

Theme caps (e.g. "all AI-boom worlds") are offchain, in the risk engine (§8). Legs carry no theme
on chain.

### Deposits and withdrawals: batches at a bounded mark

**Why not the Δ-vault's in-kind shares.**
- The Δ-vault prices nothing because a share is an exact slice of every holding. That works because
  it holds at most 48 markets.
- A world vault may hold thousands of books, so an in-kind slice of each can't fit in a
  transaction.
- So deposits and redemptions settle per batch, at a mark the contract bounds.

**A batch** takes requests until it closes.
- `requestDeposit(assets)` pulls the stablecoin; `requestRedeem(shares)` moves the shares into
  escrow. Both can be cancelled (`cancelDeposit`, `cancelRedeem`) while the batch is open.
- Anyone calls `closeBatch()` once the batch is `BATCH_PERIOD` (1 day) old and holds requests,
  provided no earlier batch awaits its mark.
  - It snapshots `guaranteed`, `best` and the share supply, and opens the next batch.
  - Trading carries on, and new requests join the next batch.
- The **marker** (`MARKER_ROLE`, never also the keeper) then posts `mark(batch, nav)`:
  - it must lie within `snapshot.guaranteed ≤ nav ≤ snapshot.best`;
  - and move at most `maxMarkMoveBps` per share from the last mark, unless the guardian approved
    exactly that value (`approveMark`);
  - the marker's `nav` is the pricer's mid value of the vault's atoms at the snapshot (§7).
- **Processing:**
  - Deposits mint shares at `nav / supply` (rounded down). If that buys nothing, the deposits are
    refunded whole.
  - The deposits move into `WorldBooks` credit first, so they help pay redemptions.
  - Redemptions pay `nav / supply` per share, for at most `withdrawLimitBps` of supply (at least
    10%) and what the vault's free credit covers.
  - The unfilled part is handed back as shares, pro rata.
- **Claims.** `claim(batch, owner)` (anyone) pays each owner's results, rounding every share down,
  so the totals are never exceeded.
- **Liveness.** If no mark arrives within `MARK_TIMEOUT` (3 days), anyone can process the batch:
  - redemptions at its guaranteed value, the price least favourable to whoever leaves, so exits
    never depend on the marker;
  - deposits refunded. The floor is the price most favourable to whoever *enters*, and buying in
    there would dilute the holders (the security review's M-1);
  - the last mark stays the reference for the next one, and `refNav` drops by what was paid.
- **Seed and inflation guard:**
  - the admin's `seed(assets)` mints `assets × 10^(18 − decimals)` shares (at least one whole
    share) and locks `DEAD_SHARES`, as in the Δ-vault;
  - deposits are capped by `depositCap` against `refNav` plus pending deposits;
  - the vault holds pending deposits and unclaimed results outside `WorldBooks`, and
    `held()` reports them.
- **v2.0 is protocol capital only.** Deposits are allowlisted (`DEPOSITOR_ROLE`). Public deposits
  come in Phase 3 (§16), with the same mechanism.

**What the mark is trusted with.**
- A wrong mark inside `[guaranteed, best]` moves value between depositors entering and leaving in
  that batch, never from users with payouts.
- The defences:
  - the bounds and the move limit;
  - a separate key;
  - forward pricing: the mark is posted after the batch's requests close;
  - publishing the mark's inputs (every atom's mid) so anyone can recompute it.

### Roles

| Role | Can | Cannot |
|---|---|---|
| Admin | grant and revoke roles (OpenZeppelin default-admin rules: two-step, with delay), `seed`, deposit cap, open deposits, withdrawal limit, mark move limit, unpause | move holdings, block exits |
| Curator | `setLimits` (TTL, cutoff buffer, tenor, legs, fee cap, margin, event-only), `setRisk` (sizes, book and leg risk, loss floor, daily exposure), the feed allowlist | quote, mark |
| Keeper | sign quotes, `merge`, `advanceQuoteEpoch` (rotation) | leave the bounds above |
| Marker | post batch marks within bounds | quote |
| Guardian | `pause` (also advances `quoteEpoch`), `advanceQuoteEpoch`, `approveMark` | unpause |
| Depositor (v2.0) | request deposits while deposits are not open | |

**Roles exclusive on chain.** `_grantRole` refuses:
- the keeper role to an account holding the marker, curator or admin role;
- the marker role to a keeper;
- the curator or admin role to a keeper, including through a default-admin transfer.

A stolen key then reaches only its own bounds.

---

## 7. The pricing engine

It is a new service, `services/world-keeper` (§10.5), not a module of `services/vault-keeper`.
- **Why separate.** The v1 keeper is built around one stock per vault, `ConditionalStocks` state
  and the Δ model. Worlds share none of that, and a bug in one service then can't stop the other's
  quotes.
- **What it reuses:** `@conditional-stocks/operator` (`Executor`, the journal), the generic
  `ChainFollower` over the world ledger, the ingestor's condition streams, and v1's in-flight
  quote accounting. Its gates copy v1's (reference age, the 2–98% floor, jump cooldown, the
  drawdown latch).
- **Where the numbers come from.** The method below was researched before it was built and is
  implemented as specified: `src/model/*` (the model), `src/pricing.ts` (the charges),
  `src/risk.ts` (the limits). Every constant is a config default in `src/config.ts` and
  `DEFAULT_PRICING`.

### Inputs

| Input | Source | Gate |
|---|---|---|
| Each leg's chance qᵢ | ingestor mid (Polymarket or Kalshi); half the venue spread and any cross-venue gap are its uncertainty | older than 45 s, spread over 6¢, or outside 2–98% → decline |
| Links between legs | pairwise latent correlations: a theme prior, a stated relation, a fit (below) | none missing: the prior always exists |
| The stock in each leg outcome | gaps gᵢ per (leg, underlying), with a standard error | the keeper's config, an admin's or a fitted value, else 0 with a 3% standard error |
| Volatility to the fixing | blended realized volatility, or an implied one when a vendor exists | floors: stock 20%, ETF 12%, crypto 35% |
| Spot S₀ | the API's spot and the feed, polled together in one multicall | older than 60 s, or the two disagree by more than 150 bps → decline |

### Joint probabilities: a Gaussian copula

Leg *i* goes the world's way when a latent score crosses its threshold, Xᵢ < cᵢ = Φ⁻¹(qᵢ). The
scores are standard normal with the legs' latent correlation matrix R (a leg needing NO flips its
sign).

- **Each pair's correlation**, best evidence first, combined by precision in Fisher z:
  1. **A stated relation** (an admin's, §12, or later the relation job's, §9) as P(B | A) and
     P(B | ¬A): the tetrachoric correlation that keeps both venue marginals, found by Plackett's
     identity, with a standard error of 0.12–0.20 in z.
  2. **A fit** from how the venues' probabilities move together: daily probit changes at
     20:00 UTC, days outside 3–97% or with spreads over 6¢ dropped, winsorized at the median
     ± 4 MAD; a Dimson lead-lag correlation (one day either side), at least 30 effective samples,
     and a stationary-bootstrap standard error.
  3. **A theme prior**: same theme 0.15 ± 0.15, adjacent themes 0.08 ± 0.12, unrelated
     0.03 ± 0.10.
- **The pair errors are correlated.** Each pair's error splits into a part common to every pair
  (½λ, λ the prior's share of the precision), a part per leg (1 − λ) and a part per pair (½λ), so
  two pairs sharing a leg or a prior move together, as they do in reality.
- **Computing it.** R is repaired to the nearest correlation matrix (Higham) and fit by the fewest
  factors (1 to 3) that reproduce every pair within 0.01. Given the factors the legs are
  independent, so every one of the 2ⁿ leg outcomes is a Gauss–Hermite integral. When no three
  factors fit within 0.01 (the research allowed 0.05, which moved P(W) by a quarter point on an
  awkward matrix), P(W) is computed on R itself by Genz's method on a fixed lattice, so it stays
  deterministic.
- **Logical constraints override the model:** a leg implied by another adds no condition;
  exclusive outcomes cannot both happen (P = 0); nested ladder strikes are implications.
- **Fréchet bounds as a guardrail.** No world is ever priced outside
  `[max(0, Σqᵢ − (n − 1)), min qᵢ]`.

The worked example (§18) reproduces: three legs at ρ 0.146 give P(W) = 2.80%.

### Systematic adjustments (one-sided)

Both apply only against the taker, never in the vault's favour on the other side:
- **Favourite–longshot bias.** A venue's long shots are overpriced and favourites underpriced,
  more so far from resolution. Calibrated chances are q → σ(b·logit q) with b 1.00 (under a day),
  1.03 (a week), 1.05 (a month), 1.10 (longer), +0.05 for politics, capped at 1.2.
- **Horizon attenuation.** Correlations fit on daily changes understate how much events co-move
  over a month; the shift to a horizon-adjusted correlation is charged one-sided.

### The stock in the world

The stock's forward in leg outcome ω is F_ω = c·S₀·exp(Σᵢ gᵢ(x̃ᵢ(ω) − qᵢ)), with *c* normalizing so
the stock averages to spot over every outcome (v1's Y/N identity).
- **A leg resolving after the fixing** moves the fixing only by the share φᵢ of its uncertainty
  resolved by then: x̃ᵢ = qᵢ + φᵢ(xᵢ − qᵢ), φᵢ = [Φ₂(cᵢ, cᵢ; τ_fix/τᵢ) − qᵢ²] / (qᵢ(1 − qᵢ)).
- **Gaps** come from the keeper's config, an admin (§12), or an event study on the stock's
  returns around large probability jumps (the nightly fit); with none, 0 with a 3% standard error.
  Each error becomes spread (§8).

### The fixing distribution

- **Variance in the world:** σ²τ, less the event variance an implied volatility already holds for
  legs resolved by the fixing, plus their jump dispersion (½|g|) and an earnings jump on realized
  volatility; floored at 0.7·σ²τ.
- **Business time:** stocks count trading days (each weekend or holiday gap adds 0.1 day) over
  252; crypto counts calendar days over 365.
- **Volatility:** 1.10 × √(0.4·YZ₂₁² + 0.4·YZ₆₃² + 0.2·EWMA²) from Yang–Zhang estimators on the
  feed's daily bars, with the floors above, until an implied source exists (§17).
- **The smile, not one volatility.** σ(k) = σ_ATM + ψ(τ)·k with k = ln(K/F) and
  ψ(τ) = ψ₁ₘ(τ/1M)^−0.4; priors ψ₁ₘ: stock −0.15 ± 0.1, ETF −0.30 ± 0.1, crypto 0 ± 0.1. The
  digital is D(K) = N(d₂) − φ(d₂)√τ·ψ, made monotone. A flat volatility would let a professional
  build our payout more cheaply from listed call spreads.

### Pricing a bundle

```
P(atom 0)              = 1 − P(W)
P(W and bucket j)      = P(W) · [D(K_{j−1}) − D(K_j)]
V_c(bundle)            = units · Σ_{j ∈ mask} P(W and j)  +  refund · P(atom 0)
```

- **The center V_c** is the posterior mean, not the point estimate: a 5-node Gauss–Hermite
  integral along the common correlation shift plus second-order terms for each leg's chance and
  the fixing inputs.
- **The Jacobian** of every atom against every uncertain input (pair correlations by Plackett's
  identity, the rest by central differences) is cached with the model, so a quote's model
  uncertainty is √(∇Vᵀ Σ ∇V), a few multiplications.
- **Caching.** A book's model is rebuilt when an input moves, at most once a second and at least
  once a minute; a quote request only reads it and applies §8.

**Coherence tests** (`services/world-keeper/test/model.test.ts`): atoms sum to 1; the weighted
forward equals spot; each leg's marginal is its venue price; the world stays within the Fréchet
bounds; a bundle plus its complement pays `units`; Plackett gradients match finite differences;
the Genz and factor paths agree.

---

## 8. Quote charges and the risk engine

### The quote

```
ask = V_c + z·SD_V + max(0, A_FLB) + max(0, A_hor) + I⁺ + O + C(ΔK) + R(ΔX)
bid = V_c − z·SD_V + min(0, A_FLB) + min(0, A_hor) − I⁻ − O − C(ΔK) − R(ΔX)
```

`WorldBooks` adds the book's fee on top of the maker's price (§5), so the quote never includes it.

1. **z·SD_V: model uncertainty.** SD_V = √(∇Vᵀ Σ ∇V) over every uncertain input at once (an
   ellipsoid, not box corners, which double count). z = 0.5, or 0.75 when every pair rests on
   priors alone. Spreads narrow on their own as fits shrink the errors.
2. **A_FLB, A_hor:** the one-sided adjustments of §7.
3. **I: information.** Each leg is tilted κᵢ in logit against the vault (multiplicative in odds,
   as Glosten–Milgrom implies for a binary) and the tilt is linearized through the bundle's
   sensitivity. κᵢ = 0.02 base + 0.02 for insider-prone themes + up to 0.10 ramped over the last
   24 h before a scheduled resolution + 0.05 for 30 min after a jump + the requester's excess
   markout, capped at 0.3.
4. **O: the stale-quote option.** A firm quote is a free option while it lives and its reference
   ages: O = 0.4·√(Δt · Σ(∂V/∂input · input volatility)²).
5. **C(ΔK): capital at its shadow cost.** C = τ_eff · NAV · ∫ r(x) dx over the utilization the fill
   moves through, on a kinked curve: 1% a year at zero, 5% at 60% utilization, 40% at 80% (the
   most the vault uses). τ_eff is the expected time until the book decides; a leg failing decides
   it early. Integrating means splitting an order saves nothing.
6. **R(ΔX): inventory.** R = (γ/2)(Var ΔX + 2·Cov(X, ΔX)) of the vault's terminal value, with
   γ = 1/(¼·NAV), doubled while the vault's stressed loss is over its soft limit. Covariances run
   across books through the union of their legs.
   - A trade that **offsets** existing exposure has a negative R and gets a better price.
   - R grows with size, which is the depth curve: no separate size ladder is needed.

**The fee credit.** While the vault is protocol capital (v2.0), the book's taker fee is counted as
vault revenue, so a quote improves by up to the fee, never past the bracket below. It is off once
outside LPs join (`feeCredit`).

**The bracket.** Every ask is at least 1% over V_c (and one tick per unit of the largest payout),
every bid 1% under. No quote crosses fair, so no round trip between books profits. For a
conditional payout the 1% is of the bet inside it, its value net of the refund units: the refund
is the stake coming back, and a markup on it would be many times the bet's.

**Size.** A stake is solved for units by bisection on the guarded ask, which rises with units.
At most what every on-chain cap leaves after the in-flight quotes (v1's rule: outstanding quotes
count as filled until they expire or are reported lost).

**Declines.**
- any input gate in §7, a book not trading, or within `cutoffBuffer`;
- a markup over 60%, or a conditional payout's in-world markup over 30%;
- a world bet under 0.5¢ a unit: Kalshi combos under 2¢ lost buyers 92¢ per dollar;
- an event-only world of one leg is clamped to the venue's touch plus a 2¢ hedge cost (it is the
  venue's own market, and quoting it off the touch only invites arbitrage); a multi-leg event-only
  world that one leg's venue dominates is declined;
- any limit of the risk engine, below;
- the drawdown latch (5% of NAV in a day).

**What it quotes.** Measured on the worked example (§18): Maya's monthly three-leg world at P(W)
2.80% asks 3.53¢. The charges are model uncertainty 0.38¢ (priors only, z = 0.75), capital 0.22¢,
information 0.10¢ and inventory 0.015¢. As fits replace the priors, z falls to 0.5 and the errors
shrink, which brings the markup down; weekly worlds pay a quarter of the capital charge.

### The risk engine

It runs in memory in the keeper, with the same replica pattern as v1:
- **Book state** from the world ledger (`WorldState`, §10.1) on a `ChainFollower`, restored from
  the API's world checkpoint via `WK_DATABASE_URL`, since nodes that prune history (ankr on
  Monad) can't replay from deployment.
- **On-chain mirrors.** The vault's hook (`onWorldFill`) is mirrored exactly: per-book risk, per
  leg risk, the daily exposure budget, the size caps and the margin. A quote the vault would refuse
  is never signed.
- **Soft limits** (fractions of NAV, `DEFAULT_RISK`):

| Limit | Value |
|---|---|
| One fill's added capital | 0.5% |
| One book's capital | 2% |
| One fill's Kelly share: ΔK ≤ ¼ · edge · NAV, edge = (price + credited fee − V_c) / (premium net of refund) | 25% |
| One leg's risk | 6% |
| One theme's stressed loss (its legs comonotone) | 15% |
| Stressed loss over all books (CVaR soft limit, γ doubles above it) | 10% |
| Utilization | 80% |
| One requester outstanding / share of a book's cap / per day | 0.5% / 25% / 1% |

- **Theme stress.** Every leg in a theme goes the vault's bad way together (a stressed
  correlation of 1 inside the theme), the "everything correlates in a crisis" case. Legs needing
  opposite sides of one event offset.
- **Requesters.** Each fill is marked out an hour later against the vault's fair value. A
  requester whose excess markout is positive pays it as part of κ and has its stake scaled down,
  to 5% for the sharpest. The record is checkpointed with the keeper's state.
- **In-flight quotes** count as filled until they fill or expire, so concurrent requests never
  overcommit.

**The netting example** (§18) holds on the replica: Maya's $20 world bet locks $1,518; Ben's
opposite $60 order then brings the book to $2,920 together, against $4,458 order by order
(`test/risk.test.ts`).

### Hedging (Phase 3)

The book's sensitivity to each leg's probability gives the leg exposures. Large ones are hedged by
buying the legs on Polymarket or Kalshi, and the stock-in-world exposure by the stock once a world
is likely. Hedges reduce economic risk but not on-chain backing, since they sit on other venues.

---

## 9. The LLM layer

LLMs do four jobs, all outside the quote path:

| Job | Where | Output, always validated by code |
|---|---|---|
| **Turn an opinion into legs** ("buy NVDA if the China deal happens and Anthropic files…") | `POST /v2/worlds/parse` in `apps/server` | a `WorldDraft`: underlying, legs as catalog ids with outcomes, a suggested fixing and product, ambiguities |
| **Propose links between legs** | nightly `label-relations` job | per pair: kind (independent, positive, negative, exclusive, implies), P(B \| A), P(B \| ¬A), confidence, reasoning |
| **First guesses at impacts** for legs with no history | the same job | a gap with a wide standard error |
| **Watch the news** (Phase 3) | `news-watch` job | a suggested freeze of a leg, for an operator or a rule to act on |

### Model and tools

- **Model.** Claude through the Anthropic API with tool use. Sonnet-class for the parser (latency
  and cost) and Opus-class for the nightly relation batch.
  - **Jev** (TypeSafe AI, `jev-1.13` on OpenRouter: probabilities only, about 0.5 s, about $0.05 per
    1,000 calls) is an optional second source of relation priors.
  - It must first pass the Phase 0 backtest: its P(B | A) must predict realized co-movement on
    resolved pairs better than the theme default.
- **Tools for the parser**, all read-only over our own data:
  - `search_events(query, venue?, closesBefore?, topic?)` over the event catalog (§10.3);
  - `get_event(id)`: title, full resolution rules, close time, current odds, liquidity;
  - `list_underlyings(query)` over `ASSET_CATALOG` (`packages/shared/src/token-catalog.ts`);
  - `submit_draft(draft)`: the final structured answer, as a JSON schema.

### Flow

1. The user's text goes to the parser with the tool definitions and a system prompt that says the
   output is only a proposal.
2. The server validates the draft:
   - every id exists in the catalog;
   - each leg is **eligible**:
     - objective rules;
     - closes before the fixing;
     - priced 2–98% with enough depth (the v1 `reference()` checks);
     - not one of the "Other" or placeholder outcomes market creation refuses;
   - legs are distinct, with no known exclusive pair that makes the world impossible;
   - at most `maxLegs` legs.
3. The UI shows each leg with its venue link, its rules, its current odds and the model's
   ambiguities ("'trade deal' here means a signed agreement, not a framework"). The user confirms or
   edits every leg. Nothing trades on an unconfirmed draft.

### Relations

- **Exact rules come first and the LLM can't override them:**
  - the same Polymarket negative-risk event means exclusive;
  - the same Kalshi series and fixing means nested;
  - the same event means a duplicate.
- **Consistency checks** on each LLM answer, after Paleka et al.: ask in both orders and with
  negations, require the Fréchet bounds, and sample twice. Inconsistent or low-confidence answers
  widen the uncertainty instead of setting a value.
- **Provenance.** Each relation stores its source (`rule`, `data`, `llm`, `jev`, `admin`) and its
  model.
- **Review.** For curated worlds an admin reviews relations before the book opens (§12).

### Guardrails

- **The LLM never sees vault state, never produces a price and never calls a signing path.**
  Call-count tests on the quote path assert zero model calls (§15).
- **Prompt injection.** User text can only steer which catalog ids are proposed, and those are
  validated. Text inside event rules is data, not instructions.
- **Limits.** Per-member rate limit (20 parses an hour), a daily cost budget with a hard stop, and a
  10 s timeout. The builder still works by search when the LLM is unavailable.
- **Audit.** `world_drafts` stores the input, the tool calls, the draft, the model and its cost.
- **Data terms.** Kalshi's terms restrict AI/ML training on Kalshi data. Parsing live data isn't
  training, but have the terms of both venues reviewed before mainnet (§17).

---

## 10. Backend changes

### 10.1 Shared packages

**`packages/evm-client`**
- ABIs `worldBooksAbi`, `worldVaultAbi` and `eventOracleAbi` in `abi.ts`.
- `worlds.ts`:
  - `BookDef` encoding and `bookDefHash` (matching Solidity);
  - `atoms(strikes)`, `bundleFor(product, strike, stake, price)` and `productOf(bundle)`, which
    names a holding;
  - `WORLD_QUOTE_TYPES` and `worldQuoteDomain`;
  - `contractQuoteNonce` reused as is.
- Transactions: `createBook`, `fillQuote`, `fillQuoteFor`, `split`, `merge`, `redeemMany`,
  `proposeFix`, `finalizeFix`, `approveDelegate` (worlds), `requestDeposit`, `requestRedeem`,
  `cancelDeposit`, `cancelRedeem`, `closeBatch`, `mark`, `claim`, plus `protocolError` cases for
  the new errors.
- `world-ledger.ts`: the `WorldState` replica (books, atom supplies, owner balances, the vault's
  `lo`/`hi`/`risk`, `legRisk`, fills, fixings, event outcomes), with
  `encodeWorldCheckpoint`/`restoreWorldState` and `WORLD_CHECKPOINT_VERSION = 1`.
  - It is the same event-sourced pattern as `ledger.ts`, followed as a second domain,
    `${chainId}:${worldBooks}`.
  - `ChainFollower` now takes a `Ledger` (decode, apply, clone, restore, evict), with
    `exchangeLedger` the default, so one follower implementation serves both domains and keeps
    its reorg, adaptive-range and checkpoint handling.
- `world-risk.ts`: `simulateFill` and `vaultHookProblem`, the books' fill and the vault's hook
  mirrored exactly, which the API's desk and the keeper both check quotes against.
- `world-admin.ts`: `worldEvidenceTransaction`, the transaction an approved packet authorizes,
  built from the packet alone (the API previews it, automation rebuilds and compares it).

**`packages/market-data`** (evidence, under `assertEvidenceIntegrity`):
- `EventResolutionEvidencePacket` (`kind: "event-resolution"`, schemaVersion 1):
  - the fields of `market-resolution` v4, keyed by `eventKey` instead of `localMarket`;
  - the `official` and `payout` fields;
  - the Polygon record for Polymarket, and `null` for Kalshi.
- `BookCreationEvidencePacket` (`"book-creation"`, 1), for curated books:
  - each leg's event evidence (`metadataSnapshotId`, `metadataRawHash`);
  - feed, underlying, fixing, strikes, cutoff, fee and rules hash.
- `BookFixingEvidencePacket` (`"book-fixing"`, 1), for the fallback fixing only: the feed rounds
  around the fixing, the source observations and the price.

**`packages/database`** (`SCHEMA_VERSION` 5 → 6; every statement is `IF NOT EXISTS`, so version 5
storage upgrades in place; queries in `src/worlds.ts`):

| Table | Holds |
|---|---|
| `world_fills` | finalized `WorldFill`s (book, tx, maker, taker, delegate, mask, units, refund, side, price, fee, nonce) for history, P&L and referrals |
| `world_books` | the def hash, the book number once created, title, `curated` or `user`, the legs' venue events (jsonb), the creation packet hash |
| `world_submissions` | the delegated-fill journal, as `delegated_submissions` |
| `event_probabilities` | one row per (condition, minute): mid and spread. The history the fit reads |
| `world_correlations` | per pair of events (a < b): latent correlation, its error in Fisher z, effective samples, method (`lead-lag` or `admin`) |
| `event_volatility` | per event: its probit volatility per √day |
| `world_gaps` | per (event, underlying): gap, standard error, method, fit time |
| `world_vols` | per underlying: blended volatility, its error, method |
| `leg_relations` | per pair: kind, P(B \| A), P(B \| ¬A), confidence, source, model, reviewer |
| `vault_marks` | per batch: nav, guaranteed, best, the inputs and their hash, transaction |
| `world_prices` | per (book, product, minute): the makers' best bid and ask |

Pairwise correlations replace the per-event `world_factors` loadings first planned: the copula
fits its factors per book from them (§7). `rfq_makers` gains a `worlds` flag. Admin estimates
(`method: "admin"`) survive later fits. Deferred with the builder (Phase 2): `event_catalog` and
`world_drafts`.

### 10.2 `apps/server` (the API)

**World indexer.**
- An `IndexerService`-like `WorldIndexer` is embedded beside the current one. It is a second
  `ChainFollower` domain over `WorldBooks`, `EventOracle` and `WorldVault`, with its own
  checkpoint.
- It persists finalized fills to `world_fills` and reconciles sampled storage against the replica,
  failing closed, as `reconcile.ts` does.
- **Routes** (`services/indexer/src/worlds/service.ts`):
  - `/v2/books` and `/v2/books/:book`: the def, state, each leg's status and venue event, atom
    supplies, the standard products with the makers' indications; `/v2/books/meta/:defHash`;
    `/v2/books/:book/fills`;
  - `/v2/positions/:owner` (owner-gated, like `/positions/:owner`): atom balances regrouped into
    products, with value at the makers' marks and maximum payout;
  - `/v2/vaults` and `/v2/vaults/:vault`: nav, guaranteed, best, batches, queue and caps;
    `/v2/vaults/:vault/marks`;
  - `/v2/fills?owner=`, `/v2/events/:key`, `/v2/health`, `/v2/reconciliation`,
    `/v2/deployment`;
  - `/v2/fixings?from=&to=`: upcoming fixings (book, feed, time), which the feed mirror reads
    (§10.4);
  - SSE `/v2/stream?owner=` with the `/stream` frame shape (`IndexUpdate` naming books and owners).

**Users' worlds** (§19, built 2026-11-04, replacing curated books): the event catalog search
(`/v2/worlds/events/search`), the world assistant (`POST /v2/worlds/parse`, §9), previews of a world
not created yet (`POST /v2/worlds/preview`), opening one (`POST /v2/worlds/open`, its book created
by automation), the public feed (`/v2/worlds/feed`) and holders (`/v2/books/:book/holders`). The
protocol lists no worlds of its own.

**World RFQ.** It extends `apps/server/src/rfq/` with protocol version 2 on the same
`/v1/rfq/stream`.
- Makers opt in per key: a `worlds` flag on the maker in `rfq_makers`, set on the admin RFQ makers
  page.
- `welcome` adds the `WorldQuote` signing domain for makers that have the flag.

| Message | Direction | Content |
|---|---|---|
| `world.rfq` | server → makers | id, deadline (500 ms window, `RFQ_QUOTE_WINDOW_MS`), the book (number, or def for a pending book), the bundle, side, the taker's limit, its stake |
| `world.quote` | maker → server | price, expiry, nonce, signature (`WorldQuote`) |
| `world.result` | server → maker | filled / unfilled / lost, with the transaction |
| `world.indications` | maker → server | bid and ask per (book, standard product), with a 30 s TTL as v1's `indications` |

- **Validation:**
  - the signer recovers with `ecrecover` for wallets, or ERC-1271 for contract makers (cached
    5 min, as v1 does);
  - the book is `TRADING` in the world indexer;
  - the bundle is valid;
  - `expiry ≥ now + RFQ_MIN_QUOTE_SECONDS`;
  - the price is within the taker's limit;
  - the maker can fund it from its credit plus atoms (and the premium, for a buy);
  - the nonce is unspent.
- **Awards:** one maker per fill (the best price; ties go to the earliest quote), checked again
  on the replica as it is at the award (`WorldDesk`, `src/worlds/desk.ts`). Splitting a bundle
  across makers isn't worth its gas in v2.0.
- **Cost.** A quote costs no RPC call and no database read; the window closes as soon as every
  maker online has answered. A delegated fill costs exactly what a v1 delegated order does
  (`test/worlds.test.ts` counts both).

**Trading.**
- `POST /v2/worlds/quote {order}`: a firm quote the wallet fills itself, with its `fillQuote`
  transaction.
- `POST /v2/worlds/submit {order, clientId}`: run the RFQ, then `fillQuoteFor` by the trading
  delegate (`TRADING_DELEGATE_PRIVATE_KEY`, sharing its nonce lock with v1). It is journaled in
  `world_submissions` before broadcast, idempotent by `clientId`, and inside the daily limit.
- `POST /v2/worlds/cashout {order, clientId}`: the same, as a sell.
- Transactions the wallet signs itself: `/v2/worlds/{deposit,withdraw,redeem,delegate,
  delegate/revoke}/prepare` and `/v2/vaults/:vault/{deposit,redeem,cancel-deposit,
  cancel-redeem,claim}/prepare`, simulated where the chain allows (a deposit after a new
  allowance cannot be).
- An order is a book, an outcome mask, a side, and a stake (buy) or units, refund and a limit
  (sell). `/v2/worlds/permission` reports the wallet's grant to the delegate and its credit.
- **Hub state.** RFQ hub state is per process today. With one API process per box that's fine; a
  second process would need the hub moved to Redis first, so the plan says so up front.

**Prices.** `/v2/worlds/prices` and its SSE `/v2/worlds/prices/stream`: the makers' best
indications per product; `/v2/books/:book/prices` the history.
- `WorldRecorder` adds one row per book product per minute to `world_prices`, for charts.
- It also writes `event_probabilities` for every condition in a live book, which the fit reads.

**Admin** (`src/worlds/admin.ts`, §12): the world evidence flow (prepare, review, preview,
reconcile) for book creation, event resolution and fallback fixings, and the keeper's pricing
inputs: `GET /v2/admin/pricing`, `POST /v2/admin/pricing/{relations,correlations,gaps,vols}`.

**Referrals.** `Referrals` accrues `shareBps` (1500) of the taker fees from `world_fills`, the
same rule as today's trades, unlocking on the first Monday after each fill. Fees are already in
stablecoin, so there's no conversion.

### 10.3 `services/polymarket-ingestor`

- **Subscriptions.** A book's legs are subscribed through the existing `track` path when its
  creation is reconciled (§10.2), so their books stream to the keeper.
- **History.** Built in the keeper's nightly `fit` instead of the ingestor
  (`services/world-keeper/src/backfill.ts`): before fitting, each live leg missing more than a
  tenth of its last 120 days is filled from its venue at the fit's 20:00 UTC cut: Polymarket's
  CLOB `prices-history` of the YES token (found on Gamma), and Kalshi's hourly candlesticks (the
  series found from the event; Kalshi omits quiet hours and its daily candles close at midnight
  New York, so the last candle at or before the cut is taken). Recorded minutes always win. Live
  minutes come from the API's `WorldRecorder`.
  - The Kalshi shapes were checked against the live API; Polymarket's API was unreachable from
    the development machine, so its path is tested against its documented shape only and should
    be checked once from the box.
- **Deferred with the builder (Phase 2):** the catalog crawler (`event_catalog`) for leg search.

### 10.4 `services/market-automation`

| Job | Every | Does |
|---|---|---|
| `resolve-events` | 60 s | For each event used by a live book, the `settleMarket` flow per event: freeze when the venue closes or the result is in; commit an `event-resolution` packet as the market admin after a fresh snapshot agrees; resolve as the resolution admin. It reuses `venues/polymarket.ts` (Polygon payout at `finalized`) and `venues/kalshi.ts`, and maps YES, NO and ½/½ (→ INVALID) as today. |
| `fix-books` | 60 s | For books awaiting their fixing: find the provably last round at or before the fixing (bisection over `getRoundData`), `proposeFix`, then `finalizeFix` after `FIX_WINDOW`. A held fixing, or none provable by the deadline, is reported for the two-key fallback (`/v2/admin/books/:book/fixing/prepare`). |
| `open-user-books` | 2 s | Create the book of every world a member opened (§19): the API approves a member's world by its rules and lists it at `/v2/admin/user-books` from memory; each is executed once, oldest first, through the evidence flow's execute step (rebuilt locally, signed only when it matches the API's preview). The curated-world job and its config were removed: worlds are users' own. |

The vault's decided books are redeemed by the keeper's housekeeping (§10.5), not a separate job.

The admin key and the two-key resolution are unchanged. `RESOLUTION_ADMIN_PRIVATE_KEY` still stays
off this host in production.

**Feeds.** Every underlying a book may fix on needs a feed:
- On testnet, `scripts/evm/deploy-mock-feeds.ts` covers more stocks than the vaults use today.
- `feed-mirror.ts` reads `/v2/fixings?from=&to=` (`FIXINGS_API_URL`) and **posts a round at every
  fixing time**, so `proposeFix` has a round within `maxStaleness`. The 24 h heartbeat and the
  150 bps deviation threshold on Monad would otherwise leave rounds up to a day old.
- This costs gas on every fixing, which the gas runway in §12 must include.

### 10.5 `services/world-keeper` (new)

| Entry | Key | Does |
|---|---|---|
| `quote` | `WK_PRIVATE_KEY` (keeper role only) | Pricer (§7), risk engine (§8), RFQ maker (one WebSocket, `world.*` messages), indications every 10 s, merge and redeem transactions |
| `mark` | `WK_MARKER_PRIVATE_KEY` (marker role only) | After each batch closes: compute the mid nav at the snapshot, check it against the on-chain bounds and the move limit, post `mark`, store the inputs in `vault_marks`; close batches that are due |
| `fit` | none (writes the DB only) | Nightly (03:30 UTC): pairwise correlations from probability co-movement, each event's probit volatility, the volatility blend from the feed's daily bars, event-study gaps. Relation labelling (§9) is deferred with the LLM layer |

- **Config.** `WK_CONFIG_PATH` (`config.example.json`) holds themes and their adjacency, the
  pricing policy (§8's constants), the risk limits, the reference gates, underlyings (kind,
  volatility, skew, earnings) and reviewed gap overrides.
- **Other env:** `WK_RPC_URL`, `WK_CHAIN_ID`, `WK_BOOKS_ADDRESS`, `WK_VAULT_ADDRESSES`,
  `WK_DEPLOYMENT_BLOCK`, `WK_API_ORIGIN`, `WK_RFQ_URL`, `WK_RFQ_API_KEY`, `WK_DATABASE_URL`,
  `WK_STATE_DIR` (mode 700, checked at startup like v1's "State directory must be private"), and
  `WK_MODE=live` with `--execute` to sign.
- **Key rules.** It refuses a keeper key that holds admin, curator or marker rights, and a marker
  key that holds keeper rights.
- **Hot path.** `quote` answers from memory with **zero I/O per request**, asserted by a
  call-count test (`test/engine.test.ts`); a quote in flight counts against the limits until it
  fills or expires.

### 10.6 Ops

- PM2 on each box adds `world-keeper` and `world-marker`, with env files at mode 600.
- `ops/ec2/nginx.conf`:
  - `/v1/rfq/stream` is unchanged (the same WebSocket);
  - `/v2/*` goes to the API;
  - the SSE routes keep the HTTP/2 stream limit in mind (`limit_conn` 50/IP counts each stream). So
    the UI multiplexes them (§11).
- **Monad.** The Monad box is a t4g.micro with about 180 MB free under six services, so two more
  processes need a larger instance or a merged keeper and marker process there (§17).

---

## 11. UI changes (`apps/web`)

**The same rules as today:**
- every page is a thin server shell around a `"use client"` module in `modules/*PageModule`;
- no `route.ts` under `src/app`, with calls going straight to the API (`live-routes.test.ts`);
- no Radix or raw buttons outside `components/ui/` (`base-ui.test.ts`);
- the `"use client"` directive stays first;
- `npx next build --webpack` after edits;
- no `enableCacheInterception`;
- `bun run smoke:prefetch` after every deploy.

### Routes

| Route | Module | Render |
|---|---|---|
| `/worlds` | `WorldsPageModule`: say what you think (the composer), and every world people trade | prerendered shell |
| `/worlds/new?q=` | `WorldBuilderPageModule`: the opinion read into an editable sentence, priced live, and the ticket | prerendered shell |
| `/worlds/[book]` | `WorldDetailPageModule`: the public world page (legs, chance chain, outcomes, who's in, activity) and its ticket | on demand, as market detail |
| `/worlds/me` | `MyWorldsPageModule`: world balance, one-tap trading, positions as leg trackers, cash-out, collect | prerendered shell |
| `/portfolio` | adds a **Worlds** tab beside Trading Account / Positions / Orders / Claims / Trade History | existing |
| `/resolution?book=` | leg and fixing evidence | existing module, extended |
| `/vaults/world` | the LP page (deposit and withdraw requests, nav, utilization, exposures) | prerendered shell |

**Home.**
- A **Worlds** tab in `MARKET_TABS` (`lib/markets/categories.ts`), hidden by `visibleTabs()` while
  no world trades.
- A featured world in `HomeBanner` beside `ResolvingSoon`.
- On every `EventCard`, a "Use in a world" action that opens the builder with that leg.

### The world page

- **Legs.** Each leg's question, venue badge, live odds (the existing
  `/v1/probabilities/stream`, multiplexed up to 50 per connection) and status chip: open, frozen,
  YES, NO, INVALID.
- **The world's chance:** ours, next to "if unrelated" (the product of the venue odds), with one
  line explaining the gap: "these events tend to happen together".
- **The stock:** spot, and the world's forward ("NVDA if this world happens: ~$231.50").
- **The distribution** over the book's buckets, as a bar chart of P(bucket | W).

### The ticket: `WorldTicket`

- **Product, chosen from a belief.** Two sentences the user picks between:
  - "I think this world happens *and* NVDA ends above $X" → world bet;
  - "*If* this world happens, NVDA ends above $X" → conditional payout.

  Above, below and range variants come from the book's strikes. An event-only book offers "This
  world happens".
- **Stake**, with the minimum shown, and **a strike** from the book's grid.
- **The four numbers the research said users need**, always visible:
  1. maximum loss;
  2. payout if right, as dollars and as a multiple;
  3. the chance (our odds, next to the venues' odds for the legs);
  4. the earliest date money comes back (the next leg deadline for a refund, the fixing for a
     payout).
- **Price breakdown.** Fair value, our spread and the fee. For a conditional payout: "$100 comes
  back if the world doesn't happen".
- **Rules line:** "If any event is cancelled or resolves 50/50, the world counts as not happening."
- **Styling.** A world bet uses a bet-slip look (multiplier first). A conditional payout uses a
  trade-ticket look (stake and payout first).
- **Live price.** The best `world.indications`, rescaled to the stake. A firm quote comes at
  submit through `/v2/worlds/submit`.
- **Guardrails:**
  - a confirm step for a world bet under 2¢ ("This pays only if all 3 things happen; the markets
    give it 1.3%");
  - per-member stake caps from the API;
  - the geofence notice.
- **Account steps.** `useAccountStep()` as today (connect, network, sign in, invite), then:
  - **"Enable worlds"**: one `approveWorldDelegate` transaction, a card like
    `TradingPermissionCard`;
  - **"Deposit"** into `WorldBooks` credit.
- **Transactions** are built locally with `@conditional-stocks/evm-client` and checked against the
  API's copy with `verifyEnvelope`, as `lib/trading/vault.ts` does.

**Two credits.** `WorldBooks` keeps its own credit, separate from the exchange's. The Trading
Account tab shows both, with a **Move** action (an exchange withdraw, then a `WorldBooks`
deposit). A shared credit is §17's open decision.

### Portfolio: the Worlds tab

- **One card per book** (reusing `PortfolioEventCard` and `MarketGroup` styling):
  - legs and their status;
  - the holding named as products (`productOf`: "1,538 × world and NVDA ≥ $240", "$100 refund");
  - value (mid), cash-out value (bid) and maximum payout.
- **Actions:**
  - **Cash out**: a sell bundle through `/v2/worlds/cashout`, with a confirm showing the bid;
  - **Redeem**: `WorldRedeemDialog`, one `redeemMany` transaction for every decided book, the same
    pattern as `RedeemDialog`;
  - **Refund**: what Redeem shows for atom 0.
- `portfolioValue()` (`lib/portfolio/summary.ts`) adds world positions at mid, and returns null if a
  book can't be valued, as it does for claims.

### The builder: `/worlds/new` (Phase 2)

1. **Stock:** search `ASSET_CATALOG`.
2. **Conditions:** search (`/v2/legs/search`), or type a sentence for the assistant
   (`/v2/worlds/parse`). Each proposed leg shows its venue link, rules, odds, a YES/NO toggle and
   the assistant's ambiguity notes. The user confirms each one. Validation errors are explained
   ("these two can't both happen", "this closes after your date", "this is already 99% decided").
3. **Date and strike:** fixing dates allowed by the legs' deadlines, and strikes with their
   in-world chances.
4. **Product and stake:** the same `WorldTicket`.

### Performance

- **One SSE per kind**, multiplexed: world prices, the index stream and probabilities.
- No per-card streams, because of the Oct 21 flicker lesson in the nginx memory.
- Batched book reads (`/v2/books?ids=`), with no extra calls on the ticket's hot path.

---

## 12. Admin and operations (`apps/admin`)

New pages in `AdminShell`:

| Page | Does |
|---|---|
| **Worlds** (`/worlds`) | Create curated books: legs (Polymarket slug or Kalshi ticker plus outcome), underlying, fixing, strikes, fee. Builds a `book-creation` packet through the existing review queue (prepare → review → transaction → execute → reconcile). |
| **World risk** (`/world-risk`) | Vault caps and eligibility lists (curator transactions), utilization, the worst case per theme, `legRisk` top list, drawdown latch, pause. |
| **Leg relations** (`/relations`) | Proposed relations with source and reasoning: approve, override or mark exclusive. Required before a curated book opens. |
| **Fixings** (`/fixings`) | Upcoming fixings, proposed rounds, `holdFix`, the fallback packet. |
| **Vault marks** (`/marks`) | Epoch marks against their bounds, the guardian's co-sign for a large move, the request queue. |

`loadOperators()` (`lib/operator-access.ts`) adds the roles of `WorldBooks`, `EventOracle` and
`WorldVault`.

The API behind these pages is built (§10.2): the world evidence routes for books, resolutions and
fallback fixings, and `/v2/admin/pricing` for relations, correlations, gaps and volatilities. The
pages themselves are UI work and are not built yet.

### Operations

- **Low-balance alerts for every operational wallet before launch.** Feed relay, market admin,
  resolution admin, world keeper, marker, delegate, faucet, referral payout. The Oct 29 Robinhood
  quote outage and the Nov 2 Monad outage were both wallets running dry. v2 adds more wallets and a
  fixing that fails silently without a feed round.
- **Gas runway per wallet** in the ops dashboard, from the `Executor`'s daily spend.
- **Dashboard:**
  - RFQ requests, answer rate and declines by reason;
  - quote latency (p50/p99);
  - fills;
  - nav, guaranteed and best;
  - the worst case per theme;
  - feed freshness;
  - books by state;
  - the fixing pipeline;
  - assistant cost and errors.

---

## 13. Security, risk and failure modes

| Threat | Defence |
|---|---|
| Keeper key stolen or keeper bug | On-chain floor price, size caps, `maxBookRisk`, `maxLegRisk`, utilization, and the daily loss latch, all in `onWorldFill`. The guardian's pause bumps `quoteEpoch`, which kills every live quote. The keeper key holds nothing else. |
| Marker key stolen | `nav` is bounded by `[guaranteed, best]` and by the move limit, posted after requests close, with recomputable inputs. Users' payouts are never affected. |
| Wrong leg resolution | Two keys (commit and resolve), evidence packets with a fresh venue snapshot that must agree, guardian freeze. This is the same trust model as v1, with no on-chain dispute. |
| Stale or manipulated fixing | Primary-market feeds, the last round at or before the fixing within `maxStaleness`, later rounds replacing earlier ones, `FIX_WINDOW`, `holdFix`, two-key fallback. |
| Correlation model wrong | Uncertainty corners in the price, theme caps with stressed correlation 1, per-leg caps, the Fréchet guardrail, the Phase 0 backtest. Spreads widen with standard errors. |
| Insiders (an S-1 leak, early results) | Information charge, per-member caps, markout-based widening, freezes on news, no quotes near a leg's resolution. |
| Stale quotes | Quote TTL ≤ 10 s, reference-age and skew gates, jump cooldown, `quoteEpoch`. |
| LLM prompt injection or hallucination | It only proposes catalog ids, schema-validated and confirmed by the user. It is never on the quote or signing path, which call-count tests check. |
| Book spam | Phase 1: book creation is permissioned. Phase 2: books are created only inside a fill a maker signed. |
| Reentrancy through `onWorldFill` | The transient lock is held during the hook, the hook has a gas cap, and state is written before the hook. |
| Rounding | Whole units only, fees round up, mark division rounds against the depositor. |
| Stablecoin pause or blacklist | Credit stays on `WorldBooks`, and withdrawals retry, as the vault's `_payout` handles token refusals. |
| Ops gas outage | Alerts and runways (§12), and the operator's `minGasWei` refusal so no transaction half-sends. |
| Regulation | Stock-price payouts are option-like contracts on securities. Keep geofencing, and get a legal read before mainnet (§17). |

### Security review of the contracts (2026-11-03)

Two independent adversarial reviews covered `WorldBooks` with `EventOracle`, and the vault with
its hook. Each finding was proven with a failing test before it was fixed, and each fix has a
regression test.

| Finding | Severity | Resolution |
|---|---|---|
| A stolen keeper could sell the vault's held atoms for almost nothing, or overpay a buy-back. That raises the guaranteed value and lowers risk, so no loss check ran. | High | The daily exposure budget on every fill (§6) |
| A fixing could finalize on an earlier round than the last one before the fixing time, if nobody proposed a later one within the window. | Medium | Proposals must prove they are the last round (§5) |
| Floor processing priced deposits at the guaranteed value, diluting the holders. | Medium | The floor refunds deposits and keeps the last mark (§6) |
| Donating cheap atoms in an ineligible book that shares legs, then calling `sync`, could freeze quoting on those legs. | Medium | Risk is the vault's own worst-case loss, `cost − lo`, which a gift can only lower (§6) |
| De-listing a feed trapped existing positions. | Low | Fills that don't grow risk skip eligibility (§6) |
| The stale-quote guard depended on the mutable `maxTtl`. | Low | Quotes carry their signing time, and only those signed before a resolution are refused (§6) |
| Two rounds with the same timestamp couldn't replace each other. | Low | Moot: only the provably-last round can be proposed |
| Atoms or fees could be sent to `WorldBooks` itself and stranded. | Info | Refused |

**Accepted and documented, not changed:**
- **A wallet maker's quote stays fillable until expiry** after a leg resolves the world's way.
  Makers keep expiries short or call `invalidateNonces`. The vault protects itself.
- **Re-approving a delegate replaces its budget whole.** A key watching the mempool could spend
  the old budget first; to cut a budget, revoke and re-approve. This is v1's behaviour.
- **The guardian can unpause `WorldBooks`**, as it can the exchange.
- **`EventOracle.reopen` lets the market admin alone resume trading** on a committed event.
  Resolving still takes both keys.
- **Contract makers must verify signatures in their hook.** `WorldBooks` checks none for them, and
  the `IWorldQuoteMaker` NatSpec says so.
- **The vault's limits:**
  - the daily exposure budget is per calendar day, so about twice the budget is reachable across
    midnight;
  - `maxLossBps` is measured from the last mark;
  - an event-only book's tenor is measured to its cutoff, and its legs may resolve later;
  - redemptions that don't fill are handed back pro rata, not queued;
  - a taker can partly delay exits by buying from the vault just before processing, at the cost of
    the spread twice.
- **Trust in the testnet feed relay:** `MockPriceFeed`'s owner can backdate a round.
  Chainlink's timestamps can't be backdated.

**Invariants the code must keep** (and §15 tests):
1. Before a decision, every atom's supply equals its book's backing.
2. Credit + Σ backing + fees equals the stablecoin balance of `WorldBooks`.
3. The vault's tracked `lo`, `hi`, `risk`, `legRisk`, `guaranteed` and `best` equal a recomputation
   from balances.
4. No fill without a valid maker signature (or a successful contract hook).
5. No fill takes a cap past its limit, except a fill that only shrinks the vault's risk.
6. `withdraw` from `WorldBooks` credit is always possible.

---

## 14. Economics

**Revenue.**
- **Protocol:** the taker fee, up front, in stablecoin.
- **Vault:** the spread over fair. The vault is protocol capital in v2.0, so both are ours.

**Starting parameters**, to tune on testnet data:

| Parameter | Start | Why |
|---|---|---|
| `feeBps`, world bets | 100 (1% of the premium) | small next to the spread on long shots |
| `feeBps`, conditional payouts | 50 (0.5% of the stake) | the refund part earns the vault nothing, so the fee carries the revenue (the research's point on fees taken in branch claims) |
| World bet margin over fair | ≤ 15% | at or below Kalshi combos (~15%) and under sportsbook parlays (18–21%) |
| Capital excess return *r* | 5% a year | over what idle stablecoin earns |
| `maxLossBps` | 5000 | the guaranteed value never falls below half the reference value |
| `maxDailyExposureBps` | 1000 | at most 10% of it can move away in a day, even with a stolen keeper key |
| Min world bet price | 0.5¢ | the longshot guardrail |

**Maya's two trades:**

| | World bet, $20 at 1.3¢ | Conditional payout, $100 at 40¢ |
|---|---|---|
| Fee to the protocol | $0.20 | $0.50 |
| Vault's expected edge | $4.23 | $0.24 (it only earns if the world happens) |
| Vault capital locked | $1,518 for 28 days | $150 |
| Capital charge at 5% | $5.82 | $0.58 |

So a lone monthly long shot at 1.3¢ doesn't pay for its capital. The engine's charges price it
near 1.6¢, and three things bring the real price down:
- **weekly tenors** (the charge drops to $1.46);
- **netting** (Ben's trade halves his charge);
- **narrower uncertainty** as data accumulates.

Referrals pay 15% of the net fees for six months, as today.

---

## 15. Testing and verification

**Contracts** (Foundry, `forge test --root contracts`, in the house style: the own `Vm`
interface, `Base.t.sol`-style helpers, the mocks `MockUSDG` and `MockPriceFeed`):
- **Unit suites:** `EventOracle.t.sol`, `WorldBooks.t.sol` (custody, books, every bundle shape,
  fills both ways, fees, delegation), `Fixing.t.sol` (round rules, replacement, window, hold,
  fallback), `WorldVault.t.sol` (hook bounds, risk caps, roles) and `WorldVaultBatches.t.sol`
  (batches, marks, liveness, claims).
- **Invariant suites** for §13's six invariants, with random books, fills, splits, merges,
  resolutions and fixings. The `ci` profile runs 1,000 runs at depth 128.
- **Fuzz:** bundle encodings, prices at the floors, extreme strikes, 18-decimal feeds.
- **Gas and size:** the targets in §5 and `forge build --sizes` in CI scripts.
- **Profiles.** The vault compiles under the 200-run `vault` profile, like the Δ-vault.

**TypeScript** (`bun test`, with `scripts/evm/with-database.ts` where the DB is needed):
- `evm-client`:
  - `bookDefHash`, quote digests and bundle encoding match Solidity, in a shared fixture test;
  - `WorldState` replay and checkpoint round trip.
- **Pricing properties:**
  - atoms sum to 1;
  - the forward averages to spot;
  - marginals match the venues;
  - Fréchet bounds hold;
  - bundle plus complement equals the units;
  - the appendix's numbers reproduce exactly.
- **Risk engine:**
  - the Maya and Ben netting example ($4,458 per order → $2,920);
  - in-flight quotes count against the caps;
  - theme worst cases.
- **Call counts:**
  - one `world-keeper` quote makes zero I/O and zero model calls;
  - `/v2/worlds/submit` makes the exact set of DB, RPC and RFQ calls, in the style of
    `delegated-rfq.test.ts`.
- **RFQ v2 hub:** fake makers, the window, awards, rejections (`rfq-hub.test.ts` style).
- **Assistant:**
  - with a fake model: schema validation, invalid ids rejected, injection strings in event rules
    ignored;
  - with the real model: a recorded set of 50 opinions with expected legs, which must reach ≥ 90%
    correct mapping before Phase 2 ships.
- **Web:** `base-ui.test`, `live-routes.test`, and new tests for `WorldTicket`'s four numbers,
  `productOf` naming and the redeem plan.

**As built (backend, 2026-11-03).** Each suite runs alone; together with the existing suites
they touch, 320 tests pass:
- `services/world-keeper/test`: `model.test.ts` (the coherence properties above, the appendix's
  numbers, Plackett gradients, Genz against the factor path), `risk.test.ts` (the netting
  example, in-flight quotes, the day's budget, theme stress, requester markouts),
  `engine.test.ts` (quotes, fills, conditional payouts, sells and marks on anvil, zero I/O per
  quote) and `backfill.test.ts`.
- `apps/server/test/worlds.test.ts`: the `/v2` API on anvil and PostgreSQL with the keeper
  connected in process: books, positions, a wallet fill, a delegated fill and a cash-out,
  refusals, persistence, reconciliation, a checkpoint restart, the admin evidence flow and the
  pricing inputs; a quote costs no RPC or database call, a delegated fill exactly v1's set.
- `services/indexer/test/world-storage.test.ts` (the version 5 → 6 migration and every world
  query), `packages/market-data/tests/world-evidence.test.ts`,
  `packages/evm-client/test/worlds.test.ts` (hashes against the contracts, the hook mirror, a
  full replay) and `services/market-automation/test/worlds.test.ts` (scheduling, and every admin
  transaction accepted on anvil).
- Not yet: the backtests below, `smoke-world-order.ts`, and the end-to-end run with the UI.

**Backtests (Phase 0):**
- **Factor model:** on resolved Polymarket and Kalshi pairs and triples from the backfill, compare
  predicted joint probabilities with outcomes (Brier score and calibration) against independence
  and the theme default.
- **Gaps:** event-study estimates against realized moves on resolution.
- **Jev:** the relation-prior test in §9.

**End to end** on the local anvil stack (`bootstrap.ts` plus the API, keeper and UI): create a
book, quote, fill, cash out, a leg fails (refund path), all legs pass and the price fixes, redeem.

**Testnet:**
- Robinhood testnet first, then the Monad copy through the usual upstream sync.
- `scripts/evm/smoke-world-order.ts` places a real world bet and a conditional payout from a
  throwaway wallet, as `smoke-market-order.ts` does.

---

## 16. Rollout phases

**Phase 0: data and backtests (about 2 weeks).**
- Probability history tables, the backfill and the catalog crawler.
- Factor fit, gap fit and the backtest report.
- Choosing a volatility source.
- Starting the legal read.
- **Exit:** the factor model beats independence and the theme default out of sample, and the
  appendix numbers reproduce.

**Phase 1: worlds on testnet (about 5 weeks).** *As built, Phase 1 and the builder of Phase 2
shipped together, with users' worlds only (§19).*
- `EventOracle`, `WorldBooks` and `WorldVault` with full tests and deploy scripts
  (`scripts/evm/deploy-worlds.ts`, recorded in `deployments/<chainId>-worlds-deployment.json`).
- Automation: `resolve-events`, `fix-books`, `open-user-books`, fixing rounds in the feed relay.
- `world-keeper` (`quote`, `mark`, `fit`); API world indexer, RFQ v2, submit, cash-out, prices.
- UI: `/worlds`, the world page, `WorldTicket`, the portfolio tab, redeem.
- Admin: Worlds, World risk, Relations, Fixings, Marks. Low-balance alerts.
- Users' worlds only, with protocol capital as the only maker.
- **Exit:**
  - 100+ fills across both products;
  - at least one refund path, one fixed payout and one cash-out verified on chain;
  - all invariants green;
  - quote p99 ≤ 5 ms;
  - no stuck book.

**Phase 2: user-built worlds (about 4 weeks).**
- `/v2/legs/search`, the assistant and `label-relations`, with admin review for curated books.
- Lazy book creation (`fillQuoteNewBook`), the builder UI, theme caps and marginal-risk pricing
  live.
- **Exit:**
  - assistant mapping ≥ 90% on the recorded set;
  - zero model calls on the quote path (call-count tests);
  - theme caps exercised in a load test.

**Phase 3: scale.**
- External makers on world RFQ (the admin RFQ makers page plus the `worlds` capability).
- Public LP deposits through batches (`setOpenDeposits`).
- Hedging on Polymarket and Kalshi.
- Interest on idle and locked stablecoin (mainnet).
- A first-loss tranche for LPs.
- An ERC-1155 wrapper for atoms.
- Call and put spreads.

**Mainnet gate:**
- an external audit of the three contracts;
- legal sign-off and geofencing;
- a mainnet fixing oracle for each underlying;
- multisig admin and guardian;
- alerts live;
- the key rotation already planned before mainnet.

---

## 17. Open decisions

1. **INVALID legs.** Proposed: the world fails, so refunds pay and world bets lose. The
   alternative is a sportsbook-style void, removing the leg and repricing. That needs per-trade
   records, which conflicts with transferable atoms.
2. **Fee levels and the margin target** (§14).
3. **A volatility source for US stocks on mainnet.** There's none today. Choose an options-data
   vendor, or start with realized volatility × a multiplier and wider spreads.
4. **The mainnet fixing oracle on Robinhood Chain** for the underlying shares. This is unverified;
   the Δ-vault uses Chainlink-style feeds.
5. **Event-only worlds** (pure parlays with no stock). Easy to support, but off our stock focus and
   with a different regulatory profile.
6. **The LLM vendor and budget**, and whether Jev is used after its backtest.
7. **When public LP deposits open.**
8. **Limits:** `maxLegs` (4 → 6), `maxTenor` (35 days) and the strike-grid template.
9. **A shared credit** between the v1 exchange and `WorldBooks`. That's better UX, but couples
   two contracts.
10. **Venue data terms** (Kalshi's AI/ML clause; the Polymarket data-terms flag from October).
11. **Monad capacity:** a bigger instance, or a merged keeper and marker.

---

## 18. Appendix: the worked example

**Legs:**

| Leg | Venue odds | Gap on NVDA |
|---|---|---|
| A. US–China trade deal by Nov 30 | 35% | 8% |
| B. Anthropic files its S-1 | 15% | 2% |
| C. OpenAI announces a GPU order | 30% | 5% |

**Joint probability.** A one-factor model with equal loadings of 0.382 (latent correlation 0.146)
gives P(W) = 2.80%, against 1.57% if the legs were unrelated.

| Latent correlation | P(W) | World bet "W and ≥ $240", fair |
|---|---|---|
| 0 | 1.57% | 0.58¢ |
| 0.10 | 2.38% | 0.87¢ |
| 0.15 | 2.80% | 1.02¢ |
| 0.20 | 3.32% | 1.22¢ |
| 0.40 | 5.59% | 2.05¢ |
| 0.70 | 10.06% | 3.68¢ |

**The stock in the world.** NVDA's forward in the world is $231.50 against spot $209.06 (product
form). The fixing spread is σ√τ = 0.13: 28 days at about 47% a year, flat for the illustration.

**A five-strike book** (strikes $220, $230, $240, $250, $260) has seven atoms:

| Atom | Outcome | P(· \| W) | P |
|---|---|---|---|
| 0 | some leg fails | | 97.20% |
| 1 | W, NVDA < $220 | 37.19% | 1.041% |
| 2 | W, $220 ≤ NVDA < $230 | 13.41% | 0.376% |
| 3 | W, $230 ≤ NVDA < $240 | 12.80% | 0.358% |
| 4 | W, $240 ≤ NVDA < $250 | 11.02% | 0.309% |
| 5 | W, $250 ≤ NVDA < $260 | 8.68% | 0.243% |
| 6 | W, NVDA ≥ $260 | 16.90% | 0.473% |

- **"W and ≥ $240"** = atoms 4 + 5 + 6 = 36.6% in the world, so 1.02¢ fair.
- **The conditional payout** "if W, ≥ $240" for $100 at 40¢: 250 units of atoms 4–6 plus 100 units
  of atom 0.

**Netting.**
- Maya buys 1,538 units of atoms 4–6 for $20. The vault splits 1,538 sets: $1,518 net.
- Ben buys 3,000 units of atoms 1–3 for $60. The vault delivers 1,538 held units and splits 1,462:
  **$1,402 net**, not $2,940.
- Together that's **$2,920 locked, against $4,458** order by order.

**Capital charge** at *r* = 5%:
- Maya alone: $5.82 (0.38¢ a unit) for 28 days, or $1.46 (0.095¢) for a 7-day world.
- Ben, netted: $5.38 instead of $11.28.

**References:**
- [Leigh, Wolfers & Zitzewitz: Iraq war and markets](https://www.nber.org/papers/w9587)
- [Kroer et al.: combinatorial market making](https://arxiv.org/abs/1606.02825)
- [Paleka et al.: LLM consistency checks](https://arxiv.org/abs/2412.18544)
- [Bürgi, Deng & Whelan: the Kalshi market](https://www.karlwhelan.com/Papers/Kalshi.pdf)
- [Gnosis conditional tokens](https://docs.gnosis.io/conditionaltokens/docs/devguide05/)
- [Polymarket negative risk](https://docs.polymarket.com/concepts/negative-risk)
- [Sportico: Kalshi combos](https://www.sportico.com/business/sports-betting/2025/kalshi-parlay-combo-rfq-explainer-1234877038/)
- [Overtime parlay proposal](https://gl.app/dao/thalesgov.eth/proposals/0x8bd576e1b96c1d5a7082d04149176376e20a9c498aa805e8bcfe5bccc7bc5324)
- [ForecastBench](https://forecastingresearch.substack.com/introducing-the-brier-index)
- [JevGym](https://github.com/ruyianry/JevGym/wiki)
- [Kalshi interest on positions](https://help.kalshi.com/navigating-the-exchange/your-portfolio/apy-on-kalshi)

---

## 19. Users' worlds, as built (2026-11-04)

The protocol lists no worlds. Every world starts as someone's opinion in their own words; once a
member holds a position in it, it is public, and anyone can back it, take the other side, or say
their own. Fills are RFQ only (no order book). The design follows
`reports/Worlds power-user research and UI options.md`.

### The flow

1. **Say it** (`/worlds`). A composer that never starts blank (real opinions cycle as placeholders;
   "a stock" and "an event" start one).
2. **Read it** (`POST /v2/worlds/parse`). Rules first: the stock (ticker or name), above or below,
   a price ($240, 10%, 120k) and a date ("Dec 19", "Friday", "end of month"); the rest split into
   clauses, each searched in the event catalog. With `ANTHROPIC_API_KEY`, Claude
   (`WORLD_ASSISTANT_MODEL`, default `claude-sonnet-5-5`) picks legs and sides from the candidates
   it was shown (one more search allowed); ids it was not shown are dropped. Without a key, or on
   failure or over the daily budget (`WORLD_ASSISTANT_DAILY_USD`, default $25), each clause's best
   match is the draft. Negations ("no shutdown") pick NO. Every read is audited in `world_drafts`.
3. **See it** (`/worlds/new`). The world as one sentence with editable chips (an event's side or
   another event, the stock, above or below, the price with a slider around spot, the date); each
   leg with its venue, odds, deadline and rules; the chance chain on a base of 1,000 with the
   unrelated chain beside it; every ending with its chance, payout and date; a 1,000-dot grid.
4. **The offer** (`POST /v2/worlds/preview`). The API builds the world's one canonical book and asks
   the makers to price it before it exists (`world.preview`); the keeper prices it through the very
   quote path of a real book against the replica with the book added (every guard, cap and the
   vault's hook), from memory, in a few milliseconds. All-in and Money-back at their stakes, the four
   numbers at equal weight, the cost in dollars (spread over fair, plus the fee), a confirm line
   under 10 in 1,000. In the end-to-end run the preview's units matched the firm fill within 0.003%.
5. **Trade it.** The ticket walks the account steps (connect, network, sign in, invite, one-tap
   trading, funds on the world books), then opens the world if it is new (`POST /v2/worlds/open`:
   the member's packet, approved by the API's rules; automation creates the book within seconds),
   waits for its first price (the keeper announces a newly modelled book at once) and fills by RFQ
   through the trading delegate with a 3% tolerance on units. A receipt links the public page.
6. **Public** (`/worlds/[book]`, `/v2/worlds/feed`). The feed lists every world with a position:
   its sentence, chance, the $20 All-in payout, traders (current holders, from the replica) and the
   last trades. The world page shows who's in and every trade (positions are public, as fills are on
   chain), "Same view / Other side" (the same events, the stock on the other side of the price), and
   "Say your own".
7. **Ride and exit** (`/worlds/me`). Each position as a leg tracker (each event happened, open with
   today's odds, or not), the stock against its price, worth now, payout if right, the chance now,
   what happens next; cash-out at the vault's firm bid shown beside the middle price; collect when
   settled (a failed world's Money-back stake comes back whole).

### One opinion, one world

A world's canonical book: legs ordered by venue deadline, one strike at the user's price (feed
units), the fixing at 16:00 New York on the user's date, the cutoff an hour before (an event-only
world: an hour before its last leg's deadline), `WORLD_USER_FEE_BPS` (default 100). Its spec hash
covers the deployment, legs and sides, feed, strike, direction, fixing, cutoff and fee, never the
words; `world_books.spec_hash` is unique, so the same view opened twice trades in one market.
A world's public wording comes only from venue text ("Will CPI be above 3%?" reads "CPI is above
3%"), never a user's words.

Checks before pricing (`worldProblems`): the vault's legs, tenor and event-only limits, legs
already almost decided (under 3% or over 97%) or without a two-sided price, two YES outcomes of
one exclusive event, a date too soon. Opening needs a member session; at most 20 opens an hour and
40 a day per member.

### Pieces

| Where | What |
|---|---|
| `services/polymarket-ingestor/src/catalog.ts` | The event catalog: Kalshi open events with their markets and Gamma's active events by volume, crawled every `CATALOG_CRAWL_MS` (15 min), sports, entertainment and weather left out, within 60 days; an inverted index with synonyms; `fresh(ids)` prices a few entries (a tracked leg's live book, else one venue read per 20 s). Internal routes `/internal/catalog/{search,entries,status}`; off with `CATALOG_ENABLED=false`. |
| `apps/server/src/worlds/assistant.ts` | Reading an opinion (rules, then the model). |
| `apps/server/src/worlds/opinion.ts` | The canonical world, its problems, the preview book, the offer. |
| `apps/server/src/worlds/opinions.ts` | The routes: stocks, event search, parse, preview, open, open status, feed, holders. |
| `apps/server/src/worlds/admin.ts` | `prepareUserBook` (fresh venue snapshots checked against the catalog entry seen) and `/v2/admin/user-books`. |
| `apps/server/src/worlds/underlyings.ts` | The stocks a world can fix on: the feeds of `WORLD_FEEDS_PATH` (default `deployments/<chainId>-mock-feeds.json`) the vault allows, with spot (reference prices, else the feed). |
| `apps/server/src/rfq` | `world.preview` / `world.previewed` (first priced answer wins; every maker declining ends it), and analytics on `world.indications` (each open leg's chance, the chance chain and the unrelated one, P(W), spot, the world's forward, the move to the fixing). Maker frames up to 32 KB; the keeper sends 12 books a frame. |
| `services/world-keeper` | `preview()`, analytics in indications, new books announced at once, `WK_FEEDS_PATH` giving every listed stock settings and its token's spot. |
| `services/market-automation` | `open-user-books` (2 s) replaces `curate-worlds`. |
| `packages/database` | `world_books.creator`, `world_books.spec_hash` (unique), `world_drafts`; schema 6 extended in place. |
| `apps/web` | The four pages, `components/worlds/*` (sentence, chips, chance chain, outcomes, dot grid, ticket, world card, leg rows, people), `hooks/useWorlds`, `hooks/useWorldAccount`, `lib/worlds/*`; `NEXT_PUBLIC_WORLD_BOOKS_ADDRESS` pins the books every wallet transaction is checked against. |

### Verified end to end (local anvil, 2026-11-04)

A scratch stack (anvil, the world contracts and vault, a fake Kalshi, the ingestor and catalog, the
API, the keeper, automation and the production UI) driven in Chromium with an injected wallet:
opinions read into the right legs (a "no shutdown" read as NO), previews priced, a new world opened
and filled 15 s after "Place" (3 s to create its book, about 9 s to its first price), joining an
existing world filled in 4 s, cash-out at the vault's bid, and a world failed by automation's event
resolution (freeze, commit, resolve) refunding a Money-back stake through "Collect".

### Follow-ups

- The header's portfolio value covers the exchange only, not world balances and positions.
- Fixings and fixed payouts were not run end to end (they need chain time at the fixing).
- Polymarket's catalog crawl is tested against its documented shape only (Gamma is unreachable
  from the development machine).
- Money-back is declined when its price inside the world would sit over 30% above fair (the
  keeper's guard); worlds on priors alone hit it more often until fits exist for their legs.
