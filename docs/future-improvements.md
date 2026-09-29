The core instrument is not new, and a race to build the deepest order books is not a moat. What can be defensible is one number only this market produces, the conditional spread (defined below), plus a liquidity design built around it that nobody has published. Four research agents read about 100 sources to get here.

## Where you actually stand

The instrument has precedents:
- **The idea:** Wolfers & Zitzewitz proposed it in 2004: a contract paying P if Saddam is ousted, with the purchase price refunded otherwise.
- **The token mechanics:** Gnosis Conditional Tokens, MetaDAO and Seer already split tokens into YES/NO branches. They apply it only to governance tokens.
- **Stock-if-event pricing:** Butter already lists "AAPL if earnings beat", but it's cash-settled against an oracle median, and I couldn't verify that the equity markets are live.

No one delivers the real stock at resolution. That matters: settling on an oracle price has been manipulated at settlement time on Polymarket's Bitcoin markets, and delivering the actual shares avoids that.

Every earlier attempt at this kind of market died of the same thing: liquidity.
- Shiller's macro markets stayed thin. His description: "starting a new market is like opening a nightclub".
- Kalshi's multi-event combos are quoted on request by market makers. **None of 96 macro, crypto and weather quote requests got a single quote.**
- MetaDAO had to borrow half of its spot liquidity to keep its conditional markets alive.

So the edge has to come from making conditional liquidity **not depend on market makers at all**.

## The reframing: sell the one number only you can produce

Each market has three prices:
- **The stock's spot price, s.** Pyth already publishes it, and tokenized-stock perps trade about 50× spot volume.
- **The event's probability, p.** Polymarket and Kalshi publish it, at roughly $45–53B a month.
- **The conditional spread, Δ = price-if-event − price-if-not.** **Nobody else can see it.**
  - Options can't reveal it, because they only pay on price levels, never on a non-price event (Ross, 1976).
  - Merger-arbitrage models have to *assume* where the target falls if the deal breaks (NY Fed staff report 761).
  - Event studies swing from about 2% to 24% on the same election depending on method (Snowberg, Wolfers & Zitzewitz).

Branch prices follow directly: **YES = s + (1−p)·Δ, NO = s − p·Δ.** Everything below is built on that.

### 1. The Δ-Vault: a Uniswap-style design for conditional liquidity

One vault per stock. LPs deposit **plain NVDA and USDC once**. The vault quotes both branches of *every* event that touches NVDA, splitting stock into branches only when a trade needs them. Spot and probability come from oracles, so **the only thing LPs price and carry risk on is Δ**.

Worked example:
- NVDA is at $100, the chance of a Fed cut is 40%, and the market thinks NVDA ends $5 higher with a cut than without.
- Branch quotes: $103 if cut, $98 if not.
- The vault sells 100 NVDA-if-cut at $103 and is paid 10,300 USDC-if-cut.
- News then moves the odds. Spot shifts by Δ × (change in probability), but both branch prices stay put. The vault's value changes by +200·dp − 40·(5·dp) = **0**.

It is **event-neutral to first order**, because it's always paid in the same branch it sells. I checked that derivative by hand.

Why this matters:
- **Arbitrage losses:** arbitrageurs can only extract value from a move in Δ, not from moves in spot or odds. With illustrative numbers, their take per dollar of depth is about 1/1,600 of what a constant-product pool pays. That figure assumes Δ is far less volatile than the stock, which is exactly what a backtest has to prove.
- **Prior art:** no paper describes this design. MetaDAO's version is three constant-product pools plus a brute-force arbitrage loop.
- **The order books stay:** the vault posts its quotes into the existing books, so a book is never empty and professional market makers still compete on top.

Main risks:
- Oracle timing. Polymarket trades around the clock; equity feeds don't.
- Jumps in Δ when event details land.
- Net inventory left in one branch, which needs a hard cap per event.
- Who sets Δ's starting value. One option: auction that right, with rent paid to LPs.

### 2. Event universes: one pool of collateral per event, across the whole market

Change the accounting so that **USDC-if-tariffs is the same token in every market conditioned on tariffs**. Three things follow:
- **Scenario portfolios:** split once, then hold NVDA-if-tariffs, rotate into AAPL-if-tariffs, all inside one "world".
- **One shared USDC pool per event**, backing every vault conditioned on that event.
- **Leverage that can't be liquidated at resolution:** lend USDC-if-E against NVDA-if-E. Collateral and debt disappear together, so the resolution itself triggers no liquidation cascade. It can run as isolated Morpho markets; Morpho is already the main lender on Robinhood Chain. This is the only form of leverage that fits the product, given what we said about perps.

Paradigm proposed this "Multiverse Finance" design in May 2025. The research found only hobby prototypes. The contract change is to key quote claims and resolution by event instead of by market.

### 3. Event-locked orders: the product users actually feel

"Sell my TSLA at $250 **only if tariffs pass**." The trade is agreed today and there's no gap risk. Nothing in TradFi does this:
- Stop orders gap straight through their price. When the SNB removed its franc floor, EUR/CHF had almost no liquidity for about 40 minutes and FXCM lost $225M.
- Guaranteed stops trigger only on price.
- Deal-contingent hedges exist only as private OTC contracts on FX and interest rates.
- When-issued trading covers only the corporate action itself.

The places to start:
- **Merger arbitrage.** Capri fell 45% and Spirit 47% on court rulings blocking their deals. A fund can sell the "if-blocked" branch and keep the "if-closes" claim.
- **Biotech FDA decision dates.** Options suffer volatility collapse after the decision and misalign when the date slips.
- **Fed-meeting rotations.**

Wrap it in a portfolio view: *"your holdings if E vs if not"*, with one click to lock either scenario.

### 4. Δ as a data product

Publish price-if-E and price-if-not per stock. Quote each branch against its own branch-USDC; dividing by the probability becomes numerically unstable when the event is unlikely.

Who would pay:
- **Risk teams:** market-implied stress scenarios.
- **Equity lenders:** Aave V4's new market for Base tokenized equities sets 65–79% loan-to-value with no event calendar.
- **Funds and media.**

ICE paid up to $2B into Polymarket largely to distribute its event data, and conditional prices carry strictly more information than probabilities alone.

The caveat: this is a scenario price, not a causal effect. "NVDA if the Fed cuts" is confounded, because cuts signal weakness. That's fine for hedging and stress tests; don't sell it as causation.

### Later: options inside a universe

Something like "NVDA call if tariffs pass" would be a market in the conditional distribution. I found no venue listing these. Build it only once vault liquidity exists.

## What I'd deliberately not do
- Add more markets. Augur died of duplicate, illiquid markets.
- Build market-maker-quoted combos. Kalshi's non-sports quote requests got zero quotes.
- Move to cash settlement. Physical delivery is a real advantage; keep it.
- Grow through points. Pendle's liquidity fell off a cliff when its points program ended.

## Hard constraints
- **Regulation.** Conditional stock tokens are likely security-based swaps in the US, so keep geofencing. The SEC's September 2026 exemption for tokenized stocks excludes derivatives, and EU distribution would need PRIIPs disclosure documents.
- **Resolution.** Use only events with objective outcomes: court rulings, FDA decisions, Fed decisions, deal closings. Polymarket's $237M "Zelensky suit" market ended in a disputed vote-based resolution.
- **Issuer mechanics.** Coinbase's Base stock tokens can freeze wallets and restrict redemption for secondary buyers, and dividend/split multipliers can jump value in one transaction. Branch tokens have to pass all of this through.

## Order to build in
1. Event-keyed collateral and event-locked orders, launched on a calendar of killer events: US midterms on Nov 3, Fed meetings, mega-cap earnings and pending merger rulings. Ship the Δ API alongside.
2. A Δ-Vault backtest on historical Polymarket and equity data around past events, then version 1 behind the order books.
3. Same-universe lending on Morpho, and the Δ feed pitched to lending risk curators.
