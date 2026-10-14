# Automated Market Makers and Liquidity Bootstrapping in Prediction Markets: Theory, Deployment History, and Applicability to Probabl

Notes compiled 2026-10-11. Historical facts carry dates. "Derived" marks arithmetic I did from cited formulas; it has no separate source. Sources rated weak are aggregator, vendor, or promotional pages and are flagged where they appear.

---

## Q1. Theory: scoring-rule market makers (LMSR, choosing b, liquidity-sensitive variants, the cost-function framework, combinatorial and conditional markets)

### Takeaway
Hanson's LMSR is a subsidized automated counterparty. Its price is the softmax of outstanding shares, and the operator's worst-case loss is fixed at b·ln n, set in advance. That is the right tool when nobody else would quote (thin markets). Its weaknesses are well documented: b is chosen ad hoc, and depth does not grow with volume. Liquidity-sensitive variants (LS-LMSR/OPRS) let depth grow with volume and can turn a profit by charging an implicit vig. The Abernethy–Chen–Wortman Vaughan framework generalizes all of these as convex cost functions. Every one of them prices Arrow–Debreu claims that pay $1 in a state, not assets such as shares of stock.

### Cited Findings
**Hanson's market scoring rules (2002 working paper; published 2003 and 2007)**
- Hanson's abstract (Jan 2002): "scoring rules elicit good probability estimates from individuals, while betting markets elicit good consensus estimates from groups." Market scoring rules combine the two, "with groups costing no more than individuals." — [Hanson 2002, mktscore.pdf](https://mason.gmu.edu/~rhanson/mktscore.pdf); published as Journal of Prediction Markets 1(1):3–15 (2007) — [RePEc](https://ideas.repec.org/a/buc/jpredm/v1y2007i1p3-15.html)
- Why thin markets: simple betting markets "cannot create price estimates unless several people coordinate to bet on the same event, and it typically seems irrational to participate". A market scoring rule acts "like a simple scoring rule when one person estimates an event once, yet can also act like a subsidized betting market." — [Hanson 2002](https://mason.gmu.edu/~rhanson/mktscore.pdf)
- The companion paper says market scoring rules aim to "overcome the thin market and irrational participation problems that plague standard information markets". They act as automated market makers in thick markets and as simple scoring rules in thin ones, and the logarithmic versions have cost and modularity advantages. — [Hanson 2003, "Combinatorial Information Market Design," Information Systems Frontiers](https://healy.econ.ohio-state.edu/pubfiles/infomkts/litreview/Hanson%20-%20Combinatorial%20Information%20Market%20Design%2003.pdf)
- Cost is path-independent. Total payout to all traders is s(r_T) − s(r_0), so it depends only on the initial and final reports, "and does not otherwise depend on how often or how many people use it". — [Hanson 2002](https://mason.gmu.edu/~rhanson/mktscore.pdf)
- The log scoring rule s_i = a_i + b·log(r_i) is equivalent to an "exponential market maker" with m_i(x) = exp((−a_i − x_i)/b) / Σ_j exp((−a_j − x_j)/b). That is the softmax price. — [Hanson 2002](https://mason.gmu.edu/~rhanson/mktscore.pdf)
- Subsidy: if traders become certain of the outcome, the principal's maximum expected payment is the entropy of the initial distribution π, −b·Σ π_i log π_i. With a uniform prior this equals b·ln n. Hanson writes: "For the price of a modest subsidy, automated market makers can also play this role," and cites the Hollywood Stock Exchange's market makers. — [Hanson 2002](https://mason.gmu.edu/~rhanson/mktscore.pdf)
- Conditional and modular property: "Regarding a bet on one event given another event, only logarithmic versions preserve the probability of the given event. Logarithmic versions also preserve the conditional probabilities of other events, and so preserve conditional independence relations." — [Hanson 2002](https://mason.gmu.edu/~rhanson/mktscore.pdf)

**LMSR mechanics and choosing b (Othman's CMU PhD thesis, 2012)**
- Standard form: C(q) = b·log Σ_i exp(q_i/b), with prices p_i = exp(q_i/b)/Σ_j exp(q_j/b) that sum to 1. Worst-case loss is b·log n. Worked example: moving the state from {5,3} to {6,3} costs about $0.56 at b = 10 and $0.92 at b = 1. — [Othman, "Automated Market Making: Theory and Practice," CMU-CS-12-123](https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf)
- LMSR is liquidity-insensitive: p_i(q) = p_i(q + α1). As a result, "prices change exactly the same amount for a one dollar bet placed at the start of the market … as after the market maker has matched millions of dollars." — [Othman thesis §4.2.2](https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf)
- Field data from the Gates Hillman Prediction Market (CMU, 365 outcomes, one per possible opening day, hundreds of traders, raffle-ticket currency, about $2,500 in prizes). It fixed **b = 32**, so the worst-case loss was about **190 tickets** (32·ln 365). That full amount was in fact transferred because the market converged on the correct day. "The ad hoc nature of selecting the liquidity parameter is an intrinsic feature of using the LMSR … The parameter we selected turned out to be too small." The field test also exposed "spikes", a pathology of differentiable pricing rules on large outcome partitions. — [Othman thesis ch. 4](https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf); EC'10 paper "Automated market-making in the large" cited there.

**Liquidity-sensitive LMSR (Othman, Pennock, Reeves, Sandholm, ACM EC 2010; "OPRS")**
- The abstract says existing binary-event market makers cannot adjust to liquidity and tend to run at a deficit. The paper builds one that "is both sensitive to liquidity and can run at a profit," with worst-case loss bounded for any starting liquidity and shrinking toward 0 as initial liquidity goes to 0. — [CMU theory lunch abstract, "A Practical Liquidity-Sensitive Automated Market Maker"](https://www.cs.cmu.edu/~./theorylunch/pastSemesterIndices/20100922.html)
- Formula: C(q) = b(q)·log Σ_i exp(q_i/b(q)), where **b(q) = α·Σ_i q_i**. Loss is bounded by C(q_0). Prices sum to between 1 and **1 + α·n·log n**, and the maximum is reached when all quantities are equal. That excess over 1 works as a bid–ask spread or vig. To emulate a commission of at most v, set **α = v/(n·log n)**. Human market makers and bookies charge "somewhere between 2 and 20 percent". With n = 2 and α = 0.05, the price sum peaks at about 1.07. Some regions of the state space give the market maker "outcome-independent profit". — [Othman thesis ch. 6](https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf)
- Generalization: liquidity-sensitive market makers are exactly the convex conjugates of compact convex sets in the non-negative orthant. — [Othman & Sandholm, "Liquidity-Sensitive Automated Market Makers via Homogeneous Risk Measures"](https://kilthub.cmu.edu/articles/journal_contribution/Liquidity-Sensitive_Automated_Market_Makers_via_Homogeneous_Risk_Measures/6606998)
- Constant-utility cost functions, a framework introduced by Chen and Pennock (2007), are the other main family of bounded-loss market makers. — [Othman thesis ch. 3](https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf)

**General cost-function framework (Abernethy, Chen, Wortman Vaughan; arXiv Nov 2010, later in ACM TEAC)**
- Markets that satisfy a set of intuitive conditions must price through a convex potential function. The reachable prices are the convex hull of the security payoffs, so the market can be designed for an arbitrary set of bounded-payoff securities. Relaxing no-arbitrage allows transaction fees and "market depth that grows with trading volume". Pricing "pair betting" with existing mechanisms is #P-hard, which shows how expensive combinatorial LMSR is to compute. — [arXiv:1011.1941](https://arxiv.org/abs/1011.1941)

### Inferences
- Derived for a binary LMSR: buying YES to move the price from p0 to p1 costs b·ln((1−p0)/(1−p1)) and buys b·(logit p1 − logit p0) shares. A $1,000 worst-case subsidy gives b = 1000/ln 2 ≈ 1,443. Moving 50%→60% then costs about $322 for about 585 shares (average price ≈ $0.55). This is the usual way to translate a budget into depth: b = budget / ln n.
- Hanson's modularity result has a direct structural analog in Probabl. A bet on A given B should not move P(B). Probabl's YES book trades only YES-claims against YES-claims, so trading there cannot move p; p stays anchored to Polymarket.
- LS-LMSR's "vig grows with liquidity" is effectively a built-in spread. That makes it closer to a market maker that charges for depth than to a pure subsidy.

### Gaps
- I did not open the original Othman et al. EC'10 PDF. The formulas come from the author's thesis, which restates them.
- I did not retrieve primary text for Chen & Pennock (2007) or for Chen et al. on the complexity of combinatorial LMSR. The #P-hardness claim comes from Abernethy et al.'s abstract.
- I did not separately retrieve Hanson's papers on decision and futarchy conditional markets. A parallel note (futarchy_conditional_markets.md in this folder) covers them.

---

## Q2. Theory: constant-function AMMs for outcome tokens (Gnosis FPMM, Manifold Maniswap, Paradigm pm-AMM) and their loss/LVR properties

### Takeaway
Outcome-token CFMMs (FPMM/CPMM, Maniswap, pm-AMM) are funded by LPs rather than by a fixed subsidy. In binary markets their LPs face a structural problem. One token always goes to 0, and LVR per dollar rises without bound as expiry approaches. Paradigm's pm-AMM, the best design known, still has LPs losing an expected half of their wealth over the life of the market. Empirically, Polymarket's FPMM LPs lost money in aggregate.

### Cited Findings
**Gnosis Fixed Product Market Maker (FPMM), as used by Omen and by Polymarket from 2020 to 2022**
- The invariant is the product of the pool's outcome-token balances. calcBuyAmount scales each other outcome's balance by poolBalance/(poolBalance + investmentAmountMinusFees), and the trader receives the reduction in the bought outcome's balance. The fee is taken from the gross investment (feeAmount = investmentAmount·fee/ONE), accrues to a fee pool, and is paid pro rata to LP shares. — [FixedProductMarketMaker.sol (gnosis/conditional-tokens-market-makers)](https://github.com/gnosis/conditional-tokens-market-makers/blob/master/contracts/FixedProductMarketMaker.sol)
- Adding funding to an unbalanced pool: the contract keeps the current ratio and returns the excess outcome tokens to the LP (sendBackAmounts[i] = addedFunds − addedFunds·poolBalances[i]/poolWeight). A "distribution hint" sets the initial ratio only at first funding. LP shares minted = addedFunds·supply/poolWeight. — [FPMM source](https://github.com/gnosis/conditional-tokens-market-makers/blob/master/contracts/FixedProductMarketMaker.sol)
- Polymarket's version charged a fee of "typically 2%" per trade, distributed to LPs, who received ERC-20 LP tokens. — [Singh, TUM MSc thesis, Sept 3, 2025](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf)

**Manifold "Maniswap" (play-money CPMM with a probability parameter)**
- Invariant **y^p · n^(1−p) = k**, implied probability **P = p·n / (p·n + (1−p)·y)**. Binary markets let p vary so that a subsidy is used without discarding shares. Example: with $100 at a 1/3 target, Maniswap deploys all 100 YES and 100 NO, where Uniswap-style CPMM would leave 50 NO unused. Multiple-choice markets (introduced 2023) and "Set" markets fix p = 0.5, which wastes subsidy when answers are far from 50%. In a worked case, a 1,000-mana subsidy on an 80/10/10 market added only about 377 mana of pool value. A 5,500-mana subsidy on a Set market lost about 3,000 mana to excess shares. — [Manifold community post by Eliza, Oct 31, 2025](https://manifold.markets/post/manifold-should-do-anything-other-t)
- The idea came from a top trader: "Pepe … suggested a clever way" to set the exponent to the initial probability. Manifold later stopped allowing subsidy withdrawals. LPs "receive back some of their mana when the market resolves," and "the more it has moved, the less you will get back." Adding liquidity solves for a new p while holding the probability P constant. — [Manifold-authored "Above the Fold" post and help-center text reproduced on a Manifold market page](https://manifold.markets/JoshuaB/will-i-understand-how-liquidity-and)
- Academic restatement: under Maniswap the AMM holds y^p·n^(1−p) constant, and at p = 0.5 it reduces exactly to the constant-product rule. — [arXiv:2503.03312, "How manipulable are prediction markets?"](https://arxiv.org/pdf/2503.03312) (search excerpt)

**Paradigm pm-AMM (Moallemi & Robinson, Nov 2024)**
- Model: a "Gaussian score dynamics" process dZ_t = σ·dB_t, with the token paying $1 if Z_T > 0. The price is **P_t = Φ(Z_t/(σ√(T−t)))**, so dP_t = φ(Φ⁻¹(P_t))/√(T−t)·dB_t. Price volatility depends only on the price level and the time remaining. — [Paradigm, "pm-AMM: A Uniform AMM for Prediction Markets"](https://www.paradigm.xyz/2024/11/pm-amm)
- Pool value for reference designs: CPMM √(xy) gives V(P) = 2L√(P(1−P)). LMSR, written as the invariant 2^(−x/L) + 2^(−y/L) = 1, gives V(P) = −L{P log₂P + (1−P) log₂(1−P)}. LVR_t = −½·φ(Φ⁻¹(P_t))²/(T−t)·V''(P_t). CPMM and LMSR both have large LVR as a fraction of pool value near prices of 0 and 1. — [Paradigm pm-AMM](https://www.paradigm.xyz/2024/11/pm-amm)
- **Static pm-AMM** invariant: **(y − x)·Φ((y − x)/L) + L·φ((y − x)/L) − y = 0**, with V(P) = L·φ(Φ⁻¹(P)) and y* − x* = L·Φ⁻¹(P). LVR is uniform across prices: **LVR_t = V_t/(2(T−t))**. Expected pool value decays as V̄_t = V₀·√((T−t)/T). — [Paradigm pm-AMM](https://www.paradigm.xyz/2024/11/pm-amm)
- **Dynamic pm-AMM**: liquidity L_t = L₀·√(T−t), giving the invariant (y−x)·Φ((y−x)/(L√(T−t))) + L√(T−t)·φ((y−x)/(L√(T−t))) − y = 0. LPs withdraw continuously, E[V_t] = V₀(T−t)/T, and **E[LVR_t] = V₀/(2T) is constant**. Expected terminal LP wealth is W₀/2: "half the initial wealth is lost by the end." — [Paradigm pm-AMM](https://www.paradigm.xyz/2024/11/pm-amm)
- Stated limitations: no fees or MEV recapture in the model, price assumed equal to probability, poor fit for one-shot surprise events ("earthquakes"), and better suited to predictable information flow (basketball rather than soccer). — [Paradigm pm-AMM](https://www.paradigm.xyz/2024/11/pm-amm)
- Follow-up: Moallemi, Robinson and Zhu, presented at AFT 2026, generalize the idea to "uniform AMMs", whose instantaneous LVR is proportional to pool value and independent of price, and extend it to dynamic liquidity. For geometric Brownian motion the unique uniform AMMs are geometric-mean market makers (Balancer, with Uniswap v2 as a special case). — [LIPIcs AFT 2026, paper 14](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.AFT.2026.14) (abstract via search). The full version is listed as arXiv 2607.17428, which I did not open.

**LVR benchmark for ordinary asset pairs**
- Loss-versus-rebalancing (Milionis, Moallemi, Roughgarden, Zhang, 2022) is the standard measure of what passive AMM LPs lose to arbitrageurs. For a 50/50 constant-product pool, instantaneous LVR = (σ²/8)·V. — [arXiv:2208.06046](https://arxiv.org/abs/2208.06046)

### Inferences
- An LP in a binary outcome-token AMM is short a "volatility that explodes at expiry". The pm-AMM result (an expected 50% wealth loss even with optimal liquidity decay) is a strong theoretical reason why LP-funded AMMs for binary claims needed subsidies, or lost money, in practice. Q4 gives the Polymarket FPMM data.
- Maniswap's p parameter only improves capital efficiency at market creation. It does not change the end-of-market loss problem; Manifold LPs still "get back less the more it has moved".

### Gaps
- No primary Manifold specification of Maniswap was readable. The Notion page returned an empty shell, and the formulas come from a Manifold community post and from a Manifold-authored post reproduced on a market page.
- I found no published LVR analysis specific to Gnosis FPMM pools with fees, beyond the pm-AMM comparison figure.

---

## Q3. Can scoring-rule or AMM designs handle continuous, price-valued payoffs (scalar markets, continuous LMSR, distribution markets, conditional-price markets)?

### Takeaway
Bounded-loss scoring rules break down on continuous outcome spaces. LMSR has unbounded loss over infinite spaces, and an impossibility result (Gao & Chen 2010) applies under natural conditions. In practice scalar markets are handled either by collapsing them to two cash-settled LONG/SHORT tokens (Gnosis CTF scalar, Augur scalar) or with new constructions such as Paradigm's Distribution Markets. All of these settle on a reported price at a date. Conditional-asset markets, where the payoff is an asset itself (futarchy pass-token vs pass-USDC, or Gnosis "deep" positions), sidestep scoring rules entirely. They run ordinary two-asset CFMMs or CLOBs on two conditional legs that share the same condition. That is Probabl's structure.

### Cited Findings
- LMSR "for n events has worst-case loss Θ(log n). Over infinite event spaces, however, it has unbounded loss (Gao et al., 2009)." Gao and Chen (2010) showed that a convex risk measure on the unit interval satisfying a continuity–monotonicity condition cannot have bounded loss. Othman builds bounded-loss market makers for countable and uncountable spaces by violating the second part of that condition, so tiny intervals do not cost ε. — [Othman thesis §5.1](https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf)
- Gnosis Conditional Tokens scalar conditions: two slots, LO and HI, with fractional payoutNumerators. For a range [0, 1000], a reported payout of [9/10, 1/10] means a score of 100, and [0, 1] means at least 1000. Positions on different conditions combine into deep positions whose value is "a product of the values of those outcome collections", for example $:(A|B)&(LO). Collateral can be any ERC-20. — [Gnosis CTF developer guide](https://conditional-tokens.readthedocs.io/en/latest/developer-guide.html)
- Paradigm "Distribution Markets" (Dave White, Dec 10, 2024): traders hold functions f(x) over a continuous outcome. The AMM is "a constant function AMM over functions" with a constant-norm invariant (‖f‖₂ = k). The AMM starts with backing b, holds h(x) = b − f(x), and must satisfy max f ≤ b. For Normal distributions the norm depends only on σ, so the AMM sells less mass to sharp forecasts and a minimum σ applies. Collateral for moving between Normals has no closed form. Prior work on means and oracle design is left open. — [Paradigm, Distribution Markets](https://www.paradigm.xyz/2024/12/distribution-markets)
- Futarchy conditional-asset AMMs (MetaDAO, Solana): each proposal creates two conditional vaults, one for USDC and one for META, plus two AMMs, pMETA/pUSDC and fMETA/fUSDC. "A previous version of the Metadao was implemented using Openbook, an on-chain CLOB. This led to liquidity problems for the on-chain markets. This new version uses a simple constant-product automated market maker instead." The proposer seeds the initial liquidity, locked until the proposal ends. Pass/fail is decided by TWAP with a margin. — [Neodyme security report on MetaDAO (2024)](https://www.neodyme.io/reports/MetaDAO.pdf), via search excerpt
- Seer, on Ethereum and Gnosis Chain, supports categorical, scalar, multi-outcome and futarchy markets. Outcome shares are ERC-20 tokens traded through the Swapr DEX, and LPs earn trading fees plus token incentives. — [Alchemy dapp listing for Seer](https://www.alchemy.com/dapps/seer) (weak source)

### Inferences
- Probabl's claims are physically settled: 1 YES-stock turns into 1 share of stock on YES. They are not a cash payout on a price at time T, so the outcome space a scoring rule would need is not a price grid. Each branch book is a two-asset exchange (conditional stock vs conditional USD). Bounded-loss scoring rules (LMSR, LS-LMSR, Distribution Markets) would only apply if Probabl introduced cash-settled "stock price at T" claims. Even then, loss grows as ln(number of bins), or as backing b for Distribution Markets.
- Within one branch the probability cancels: the YES book's price Y is a ratio of two YES-conditional assets. So a branch CFMM behaves like an ordinary stock/USD pool restricted to that branch. It does not behave like a binary outcome-token pool, and it does not suffer the binary "one leg goes to zero" collapse. MetaDAO's choice of plain constant-product pools for pass/fail conditional pairs is the working precedent.
- Gnosis CTF deep positions with a tokenized stock as collateral would give the same claim structure as Probabl's YES-stock and NO-stock. An existing CTF-plus-CFMM stack could therefore be a reference implementation.

### Gaps
- I did not retrieve Augur's whitepaper text on scalar markets (min/max range, long/short payout). The Augur scalar description in these notes is not separately sourced, so I have left it out of the findings.
- I found no paper or deployment of an LMSR-style bounded-loss market maker for physically settled conditional assets (stock-like payoffs).
- The MetaDAO details come from an audit excerpt and secondary summaries. The parallel note futarchy_conditional_markets.md should be treated as authoritative on futarchy.

---

## Q4. History and data of real deployments: mechanism, funding, spreads and slippage, and why each venue kept or abandoned its design

### Takeaway
Every venue that reached scale (Polymarket, Kalshi, Limitless, Opinion, Predict.fun) runs a CLOB with professional or incentivized makers, paid through rewards, rebates or MM agreements. AMM venues either stayed small (Augur Turbo, Omen, Myriad, Truemarkets, PNP) or moved away from AMMs (Polymarket). The two notable exceptions are Manifold, where play-money subsidies are cheap, and MetaDAO, which went from CLOB to AMM because short-lived conditional markets were too thin for a book. Polymarket's own on-chain data shows FPMM LPs lost money in aggregate, while CLOB makers were mostly profitable.

### Cited Findings
**Augur (Ethereum)**
- v2 launched on mainnet July 28–29, 2020. It moved to DAI-denominated bets, added an "invalid" outcome, and integrated 0x Mesh (off-chain order relay), Uniswap v2 oracles and IPFS. — [The Block, Jul 28, 2020](https://www.theblock.co/news/ecosystems/2020-07-28-augur-v2-launch-73057)
- A secondary characterization: Augur "struggled with thin liquidity and low market quality," and Ethereum mainnet gas made small trades uneconomical. It is described as effectively superseded. — [pm.wiki comparison](https://pm.wiki/es/compare/augur-vs-polymarket) (weak; the page itself notes incomplete data)
- Augur Turbo on Polygon (2021): daily sports and crypto markets priced by an AMM where users "supply liquidity on every side of a bet". "Without sufficient liquidity in a given market, a user's transaction will fail." It was bootstrapped with a **$1M "Augur-Matic Rewards" liquidity-mining program** funded by Polygon. — [Polygon blog, Sept 2021](https://polygon.technology/blog/augur-matic-rewards-1m-liquidity-mining-program-in-conjunction-with-augur) (via search excerpt; the page now returns 404)

**Gnosis / Omen**
- Omen is a permissionless prediction market on the Gnosis Conditional Token Framework using FPMM pools. It was originally created by DXdao, which deprioritized it in 2022. Gnosis then ran "AIOmen" as an environment for AI trading agents (Olas). — [DappRadar](https://dappradar.com/dapp/omen); [pm.wiki AIOmen profile](https://pm.wiki/uk/projects/aiomen) (weak)
- One recent snapshot cites DefiLlama at about $28.7k of 7-day prediction volume and $1.37M TVL across all Gnosis-chain prediction markets. — [Manifold market citing DefiLlama](https://manifold.markets/deletedaccount001/omenpresagio-reaches-5000-active-tr) (weak, and the date is unclear)

**Polymarket: the AMM era (2020–Q4 2022) and the CLOB era**
- "Launched in 2020 and originally based on the Gnosis CTF framework … the platform gradually transitioned from an AMM-based model to a CLOB design by the last quarter of 2022." Until then it used Polymarket's fork of FixedProductMarketMaker with a fee of about 2% to LPs. — [Singh, TUM thesis (2025)](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf)
- **FPMM LP economics on chain** (2,643 FPMM markets, Oct 2020–Nov 2024, about 3,000 LPs, about 21,000 market–LP pairs): average fees rise roughly linearly with volume, up to about $25K on the largest markets, but "across all bins, the realised impermanent loss exceeds the fees earned." Only **26% of LPs and about 24% of LP–market pairs were profitable**; among pairs with fees above $10 the figure was 31.4%, on $1.0M of total fees. The top fee-earning LP made more than $130K in fees and lost more than $400K to impermanent loss. — [TUM thesis](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf)
- LP behavior in the FPMM era: about 30,000 just-in-time add/remove events within 5 minutes captured about $15K in fees. Profitable LPs entered at a median price of about 0.81, meaning they waited until the market was nearly decided. LP shares collapsed toward zero before resolution. — [TUM thesis](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf)
- A separate ETH Zürich analysis of more than 2M Polymarket AMM-era transactions found that average liquidity drops as markets approach resolution, because LPs cut risk as prices converge. That raises slippage, and prices "do not converge fast enough to 0 or 1" (too high below 0.2, too low above 0.8). The author proposes a "Smooth Liquidity Market Maker". — [Kapp-Schwoerer, ETH Zürich, Mar 27, 2023](https://pub.tik.ee.ethz.ch/students/2022-HS/SA-2022-42.pdf)
- **CLOB-era maker economics** (3,100 markets, more than 1.2M matched orders, about 800 LPs): about **$9.3M in liquidity rewards** were paid over roughly 1.5 years (about Dec 2023–Aug 2025), with a peak week of **$242.4K in Q4 2024** during the US election. The top address earned more than $1M, and 46,653 addresses received rewards. The observed average spread was **2.3¢**, inside the typical 3¢ reward band. **69.7% of makers and 76.1% of maker–market pairs were profitable.** — [TUM thesis](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf)
- Conflicting claim: several secondary articles say Polymarket's AMM was LMSR. — [PANews/Movemaker](https://panews.io/articles/fz20kk02b04n); [ChainUp](https://chainup.com/blog/polymarket-prediction-markets/). This is contradicted by the on-chain FPMM data and by Polymarket's own conditional-tokens-market-makers fork, as cited in the [TUM thesis](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf). FPMM/CPMM is the better-supported answer.
- Secondary reasons given for the move: LMSR/AMMs spread liquidity across the whole 0–100% range, every trade pays slippage, and professional market makers prefer order books. — [PANews](https://panews.io/articles/fz20kk02b04n) (secondary; no Polymarket primary statement found)
- CTF Exchange match types: **COMPLEMENTARY** (buy vs sell, direct transfer), **MINT** (two buys on complementary outcomes, where collateral is split via the CTF) and **MERGE** (two sells, where tokens are merged back to collateral). The v2 exchange trades against a "PMCT" ERC-20 wrapper of USDC. — [Polymarket ctf-exchange-v2 repo](https://github.com/Polymarket/ctf-exchange-v2); [ChainSecurity audit](https://reports.chainsecurity.com/Polymarket/ChainSecurity_Polymarket_Exchange_Audit.pdf). Polymarket docs say CLOB V2 went live on April 28, 2026. — [Polymarket v2 migration doc](https://docs.polymarket.com/v2-migration.md) (via search excerpt)

**Polymarket incentives today (CLOB)**
- Liquidity rewards formula. Order score **S(v,s) = ((v − s)/v)²·b**, where v is the max qualifying spread, s is the distance from the size-cutoff-adjusted midpoint, and b is an in-game multiplier. Q_one sums scored bids on one outcome plus asks on the complement, and Q_two is the mirror. When the midpoint is in [0.10, 0.90], **Q_min = max(min(Q_one, Q_two), max(Q_one/c, Q_two/c)) with c = 3.0**, so one-sided liquidity is paid at one third. Outside that range only two-sided quotes count (Q_min = min). The book is sampled once per minute at a random offset (up to 1,440 samples per daily epoch). Scores are normalized per sample and per epoch, and rewards are paid daily at midnight UTC with a $1 minimum. Each market sets its own min size, max spread and reward pool. — [Polymarket docs: Liquidity Rewards](https://docs.polymarket.com/market-makers/liquidity-rewards)
- One example program: "Crypto TWAP" rewards of $1M split across 5-minute ($550K), 15-minute ($350K) and 4-hour ($100K) markets. The program has ended. — [Polymarket docs, programs/liquidity-rewards](https://docs.polymarket.com/programs/liquidity-rewards)
- Maker rebates funded by taker fees. Fee = C·feeRate·p·(1−p), symmetric around 50%. Taker fee rates are crypto 0.07, sports 0.05, finance/politics/mentions/tech 0.04, and economics/culture/weather/other 0.05, with geopolitics fee-free. Makers get back **20% (crypto), 15% (sports) or 25% (others) of fees**, allocated by each maker's fee-equivalent share per market, paid daily in pUSD, with no maker fee. — [Polymarket docs: Maker Rebates](https://docs.polymarket.com/market-makers/maker-rebates). An earlier version applied fees only to 15-minute and 5-minute crypto and some sports, with a maximum effective rate of 1.56% at 50%. — [The Block](https://www.theblock.co/post/384461/polymarket-adds-taker-fees-to-15-minute-crypto-markets-to-fund-liquidity-rebates); docs search excerpt
- Holding rewards: a variable **4.00% annualized** on eligible, mostly long-dated positions. Position value is sampled hourly at random, paid daily, funded by the Polymarket Treasury and can be capped. — [Polymarket docs: Holding Rewards](https://docs.polymarket.com/polymarket-learn/trading/holding-rewards) (via search excerpt)
- Spend estimate: "Polymarket currently spends an average of $17K/day on liquidity rewards," ranging "from $1/day to as much as $5K/day." No data source is given. The same author calls the IMO gold-medal market "pretty thin" at about $5/day of rewards. — [J. Richardson, LessWrong, May 5, 2025](https://www.lesswrong.com/posts/gvo6YZkucnwg5aPsC/proposal-liquid-prediction-markets-for-ai-forecasting)
- Third parties can now fund "sponsored" rewards on specific markets, for example about $70K added to one market in Feb 2026. — [Telonex research](https://telonex.io/research/sponsored-liquidity-rewards-jesus-market) (via search excerpt; not opened)

**Kalshi (CFTC-regulated CLOB)**
- Market Maker Program (2024 filing): participants sign a separate agreement and must "quote predetermined continuous two-sided markets, maintain maximum bid/offer spreads, maintain minimum quote sizes" in designated contracts and hours. Incentives are paid only when all obligations are met, and intra-firm trading is excluded. A June 2026 amendment added markets and let MMs opt out when liquidity conditions change. — [Kalshi filings on cftc.gov, e.g. rules02262412176](https://www.cftc.gov/filings/orgrules/rules02262412176.pdf) (from search excerpts; the specific filing was not opened)
- Liquidity Incentive Program: the book is snapshotted "once per second, at a random moment within each second". Each side has a Target Size of 100–20,000 contracts. The Reference Price is the first level where cumulative size reaches 1/5 of Target Size. Orders at or better than the reference get a 1.0x multiplier, and worse orders are discounted by factor^ticks. Payout is score share × period reward × (non-excluded snapshots / total). **Daily rewards are $1 to $1,000 per market**, with a $1 minimum payout. Affiliates and existing-agreement MMs are excluded. The help page says the program ends Jan 1, 2027. — [Kalshi Help: Liquidity Incentive Program](https://help.kalshi.com/incentive-programs/liquidity-incentive-program). A search excerpt instead gave a Sep 15, 2025–Sep 1, 2026 window, so the dates conflict.
- The Volume Incentive Program (launched March 2023) paid fixed pools by share of eligible CLOB volume, typically on trades priced $0.03–$0.97. On Sept 28, 2026 Kalshi filed to end it no earlier than Oct 13, 2026, moving up a scheduled Oct 1, 2027 end. This came amid allegations of inflated ETH-perp volume, which Kalshi denies. — [The Block, Sept 30, 2026](https://theblock.co/news/business/2026-09-30-kalshi-ends-trader-incentive-program-417247); [Gambling.com](https://www.gambling.com/us/news/kalshi-end-volume-incentive-program-october-13). The Block's headline calls it a "liquidity incentive program", but the body describes the Volume program.

**Manifold (play money)**
- Binary markets use Maniswap, a CPMM with parameter p (details in Q2). Subsidies are platform- or user-funded mana, and withdrawals are now disabled. Early multiple-choice markets used about 100 mana of subsidy, roughly 1,000 mana today after inflation. — [Manifold post, Oct 2025](https://manifold.markets/post/manifold-should-do-anything-other-t); [Manifold-authored post](https://manifold.markets/JoshuaB/will-i-understand-how-liquidity-and)

**Zeitgeist (Polkadot parachain)**
- The design evolved from a Balancer-style AMM to "Rikiddo", described as an LS-LMSR variant ([Zeitgeist on Subsocial](https://app.subsocial.network/@zeitgeist/18752), via search excerpt), and then to "neo-swaps", which uses LMSR "to determine spot prices and swap amounts". Neo-swaps tracks reserves internally to block price-manipulation-by-donation and distributes LP fees lazily through a segment tree. — [neo-swaps README](https://github.com/zeitgeistpm/zeitgeist/blob/main/zrml/neo-swaps/README.md); [Kliemann LMSR note](https://hackmd.io/RS5KDMKQSBasekp7UWZ6HA)
- ZIP-8 "Hybrid CDA" (Malte Kliemann, draft) introduced a zrml-hybrid-router pallet that atomically routes between zrml-neo-swaps and zrml-orderbook. Book orders come from an off-chain matcher, and on-chain routing avoids collisions when several trades land in one block. — [ZIP-8 on HackMD](https://hackmd.io/NBVKUY1QT--YnotR5KUx2w) (search excerpt). The router exposes buy/sell with max_price/min_price and a strategy for the remainder (ImmediateOrCancel or LimitOrder), choosing whichever venue "would result in the most favourable execution price". — [hybrid-router README](https://github.com/zeitgeistpm/zeitgeist/blob/main/zrml/hybrid-router/README.md)

**Drift BET (Solana)**
- Launched Aug 19, 2024 as an alpha with two US-election contracts. — [The Block](https://www.theblock.co/post/311888/solana-based-drift-protocol-launches-prediction-market). The co-founder claimed more than $3.5M of order-book liquidity in the first 24 hours, "on par" with Polymarket for the Trump/Harris markets, supported by Drift's existing deposits. — [Decrypt](https://decrypt.co/245565/new-solana-based-polymarket-rival-from-drift-draws-over-3-million-in-liquidity)
- Drift's general perp stack layers a JIT auction (market makers fill at or inside the oracle price), a decentralized limit order book, and a constant-product AMM "backstop" with inventory-dependent spreads. — [eco.com explainer](https://eco.com/support/en/articles/14801189-drift-protocol-perps-architecture-explained) (weak). I could not confirm whether BET uses the AMM backstop. Drift's docs now redirect to docs.velocity.exchange and returned an error.

**Newer EVM/BNB venues**
- Limitless (Base; founded Dec 2023; $3M pre-seed plus $4M strategic round in July 2025; more than $497M volume, undated) runs a CLOB with separate Yes/No books and split/merge into $1 sets. Its LP Rewards pay a daily USDC pool to limit orders near the midpoint, for example with a 3¢ max spread, a 100-share minimum, and one-sided rewards only between 5% and 95% odds. — [IQ.wiki](https://iq.wiki/en/wiki/limitless-exchange); [pm.wiki](https://pm.wiki/uk/projects/limitless-exchange) (secondary)
- Opinion (BNB Chain, launched Oct 2025, CLOB): about $1.5B of weekly volume four weeks after launch, and critics questioned whether that was organic. — [Cointelegraph](https://cointelegraph.com/news/cz-yzi-labs-prediction-market-opinion-beats-kalshi-polymarket). It raised $20M pre-Series A after a $5M seed. — [The Defiant](https://thedefiant.io/news/defi/top-bnb-chain-prediction-market-opinion-raises-usd20-million)
- Predict.fun (BNB Chain) is listed as an "On-chain CLOB" and launched around Dec 2025. — [Trust Wallet glossary](https://trustwallet.com/glossary/predict-fun) (weak)
- Myriad (launched Jan 2025 by Dastan, Decrypt's parent) uses an AMM that fills orders against a pool, so "it can function even when liquidity is low". Any user can LP. — [Decrypt explainer](https://decrypt.co/240824/what-are-decentralized-prediction-markets-myriad-polymarket-kalshi)
- Truemarkets (Base) runs YES/NO outcome tokens in Uniswap V3 pools, and LPs earn fees. — [GetBlock listing](https://getblock.io/marketplace/projects/truemarkets) (weak). One YES/WETH pool on Base showed about $1.28M of liquidity against about $448 of 24-hour volume (around Mar 2026). — [Bitquery](https://dexrabbit.bitquery.io/base/pool/0xdfcfdf5dd0569d591e0bce28b5da3b13de09e3cb). The pool's attribution to Truemarkets is uncertain.
- PNP Exchange (Solana) offers permissionless markets where users "trade their views directly against a bonding curve", explicitly to avoid order books and illiquid markets. Market creators earn pool fees. — [FXEmpire profile](https://www.fxempire.com/crypto/pnp-exchange) (weak; no formula found)
- MetaDAO: moved from an OpenBook CLOB to constant-product AMMs for its conditional markets because of "liquidity problems". — [Neodyme](https://www.neodyme.io/reports/MetaDAO.pdf). Proposal 8 example: a $100,000 USDC 50/50 AMM pool with a 1% fee, matched in META by the treasury. — [HackMD proposal](https://hackmd.io/@0xNallok/ryGLNC13a). The founder put proposal-market volume at about $100K–$500K each and credited Robin Hanson with suggesting the AMM approach. A later design combines spot liquidity with pass/fail markets and self-arbitrages, with 25 bps of fees to MetaDAO and 25 bps to LPs. — [Alea Research podcast digest](https://alearesearch.io/podcast-digest/metadao-plasma-and-dats-crime-livestream) (via search excerpt; the page body did not load)

### Inferences
- Polymarket's switch happened before its growth: FPMM through 2022, then CLOB volume peaking in the 2024 election. The on-chain data (LP losses vs profitable CLOB makers) is the strongest evidence that, for binary claims, LP-funded AMMs cannot keep passive capital, while a CLOB plus modest rewards (about $9M over 1.5 years) can.
- The 2.3¢ average spread under a 3¢ reward band suggests the reward design itself (the quadratic spread score and the two-sided min) sets equilibrium spreads in incentivized markets.
- MetaDAO's CLOB→AMM move is the counter-example that matters most for Probabl. Its markets are short-lived conditional-asset pairs with modest volume. When there are many small conditional books, a seeded CFMM beat an on-chain order book.

### Gaps
- I found no primary Polymarket announcement giving the exact CLOB launch date or its own stated rationale. The "late 2022" date rests on the TUM thesis and secondary press.
- I found no reliable data on AMM-era Polymarket LP reward programs (whether Polymarket paid AMM LPs on top of fees).
- Limitless: I could not verify, from any primary or secondary source, the premise that it moved from an AMM to a CLOB. Current sources describe only a CLOB.
- Hedgehog Markets (parimutuel/P2P): no usable source was found.
- Augur v1 (2018) order-book liquidity metrics, Augur Turbo's actual pool depth, and the Omen/AIOmen time series: no primary data was found.
- Drift BET's current status and whether it uses the vAMM backstop: unconfirmed (the docs redirect to velocity.exchange).
- Exact 2025–2026 Polymarket reward totals: a "$5M in April 2026 for sports/esports" figure appeared in search snippets but was not on the docs page I fetched.

---

## Q5. Trade-offs: subsidized bounded-loss AMMs vs LP-funded AMMs vs CLOBs with incentivized market makers, and when a hybrid makes sense

### Takeaway
- **Subsidized scoring rules** (LMSR, LS-LMSR) guarantee a quote at a known maximum cost. They are best for long-tail or new markets where information matters more than volume (Hanson, GHPM, Manifold), but they are rigid and capital-heavy at scale.
- **LP-funded CFMMs for binary claims** are structurally loss-making for LPs (pm-AMM theory; Polymarket FPMM data), so liquidity flees near resolution.
- **CLOBs with paid makers** give tight spreads where professionals participate, but they need active MMs plus rewards and are empty in the long tail.
- **Hybrids**, with an AMM as a router-level backstop under a CLOB, have been built by Zeitgeist (hybrid router), Drift (JIT + DLOB + AMM backstop in perps) and Manifold (AMM plus limit orders). They make sense when markets are numerous and thin and the protocol can fund a bounded backstop.

### Cited Findings
- Scoring rules' cost "does not otherwise depend on how often or how many people use it". The operator funds a fixed information subsidy (the entropy of the prior times b). — [Hanson 2002](https://mason.gmu.edu/~rhanson/mktscore.pdf)
- LMSR liquidity-insensitivity and the ad hoc choice of b caused practical problems in the GHPM (b = 32 was "too small"). — [Othman thesis](https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf)
- LS-LMSR adds a vig (price sum up to 1 + α·n·log n) and depth that grows with volume, and can be profitable. — [Othman thesis ch. 6](https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf)
- Binary CFMM LPs: pm-AMM LPs lose an expected 50% of wealth even with optimal dynamic liquidity, and CPMM/LMSR have high LVR near 0 and 1. — [Paradigm pm-AMM](https://www.paradigm.xyz/2024/11/pm-amm)
- Empirically, in Polymarket's FPMM era, IL exceeded fees in every volume bin and only 26% of LPs were profitable. In the CLOB era, 69.7% of makers were profitable at a 2.3¢ average spread with rewards. — [TUM thesis](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf)
- AMM liquidity drains as markets converge, which biases prices away from 0 and 1. — [ETH Zürich](https://pub.tik.ee.ethz.ch/students/2022-HS/SA-2022-42.pdf)
- Comparison of three ways to bootstrap a new (BTC-denominated) market:
  - Cross-market making against existing venues has "the friendliest risk profile" for users but needs professional MMs or platform subsidies.
  - AMMs are "simple to deploy but capital-inefficient" and expose LPs to permanent loss.
  - DeFi redirection reuses USDC liquidity but adds liquidation and exchange-rate risk.
  - [Shabashev, arXiv:2509.11990, Sept 15, 2025](https://arxiv.org/abs/2509.11990)
- On-chain CLOBs struggled where markets were thin and short-lived (MetaDAO on OpenBook). — [Neodyme](https://www.neodyme.io/reports/MetaDAO.pdf)
- Hybrid builders:
  - Zeitgeist's hybrid router splits orders between the AMM and the book at a price limit. — [hybrid-router README](https://github.com/zeitgeistpm/zeitgeist/blob/main/zrml/hybrid-router/README.md); [ZIP-8](https://hackmd.io/NBVKUY1QT--YnotR5KUx2w)
  - Drift's perp AMM serves "as a backstop liquidity provider when other sources are unavailable". — [eco.com](https://eco.com/support/en/articles/14801189-drift-protocol-perps-architecture-explained) (weak)
- Regulatory caution: an August 2026 CFTC staff advisory warned that MM stipends or rebates designed to guarantee profits or cover losses can create risks. — Kalshi incentive search excerpt referencing CFTC; primary advisory not opened.

### Inferences
- A hybrid is worth having when (a) there are many simultaneous thin markets, (b) professional MMs will not quote every market, and (c) the protocol can cap its backstop loss. The AMM then guarantees a finite-slippage quote, and the CLOB captures tight professional pricing where it exists. The router must check both venues atomically, as Zeitgeist does, to avoid collisions.
- The AMM backstop must not become the cheapest venue for informed flow. Otherwise it absorbs all the adverse selection while the CLOB makers keep the uninformed flow. The usual mitigations are wider fees on the AMM, oracle-anchored pricing, or letting the AMM only fill beyond the best book price.

### Gaps
- I found no rigorous published comparison, with venue data, of a hybrid AMM-under-CLOB against a pure CLOB in prediction markets. Zeitgeist's hybrid router has no published outcome metrics that I found.

---

## Q6. Practical numbers: LMSR b and subsidies, reward budgets, spreads and depth before and after transitions

### Takeaway
Published concrete parameters are scarce:
- **LMSR:** b = 32 on 365 outcomes, a worst case of about 190 units, fully paid out.
- **Polymarket rewards:** about $17K/day across all markets (May 2025, source unverified); $1–$5K/day per market; about $9.3M over about 1.5 years; peak week $242K.
- **Kalshi:** $1–$1,000/day per market.
- **Fees:** Polymarket's FPMM charged about 2%. Taker fees today are C·rate·p(1−p) with rates of 0.04–0.07, and 15–25% is rebated to makers.
- **Spreads:** about 2.3¢ under a 3¢ reward band.

### Cited Findings
- GHPM: b = 32, n = 365, worst case about 190 tickets, fully transferred. — [Othman thesis](https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf)
- LS-LMSR: α = v/(n·log n), with 2–20% being the typical commission. With α = 0.05 and n = 2, the price sum is at most about 1.07. — [Othman thesis](https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf)
- Polymarket FPMM fee about 2%. — [TUM thesis](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf). An example AMM fee of 0.5% appears in the ETH analysis. — [ETH Zürich](https://pub.tik.ee.ethz.ch/students/2022-HS/SA-2022-42.pdf)
- Polymarket rewards: about $17K/day on average and $1–$5K/day per market, according to [LessWrong, May 2025](https://www.lesswrong.com/posts/gvo6YZkucnwg5aPsC/proposal-liquid-prediction-markets-for-ai-forecasting). About $9.3M was paid over about 1.5 years, with a peak week of $242.4K, an average spread of 2.3¢ and a 3¢ typical max spread, according to the [TUM thesis](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf). Crypto TWAP $1M/month (ended) — [Polymarket docs](https://docs.polymarket.com/programs/liquidity-rewards)
- Polymarket fees and rebates: C·feeRate·p·(1−p). Rates are 0.04–0.07, rebates are 15–25% of fees, and the maker fee is 0. — [Polymarket docs](https://docs.polymarket.com/market-makers/maker-rebates). Holding rewards are 4% annualized. — [Polymarket docs](https://docs.polymarket.com/polymarket-learn/trading/holding-rewards)
- Kalshi LIP: $1–$1,000/day per market, Target Size 100–20,000 contracts, 1 snapshot per second. — [Kalshi Help](https://help.kalshi.com/incentive-programs/liquidity-incentive-program)
- MetaDAO: a $100K USDC + META 50/50 pool with a 1% fee per proposal (Proposal 8). — [HackMD](https://hackmd.io/@0xNallok/ryGLNC13a)
- Augur Turbo: a $1M MATIC liquidity-mining program. — [Polygon blog](https://polygon.technology/blog/augur-matic-rewards-1m-liquidity-mining-program-in-conjunction-with-augur)
- Drift BET: more than $3.5M of order-book depth in the first 24 hours (company claim). — [Decrypt](https://decrypt.co/245565/new-solana-based-polymarket-rival-from-drift-draws-over-3-million-in-liquidity)

### Inferences
- Derived from Milionis et al.: a full-range CPMM loses about σ²/8 of pool value per unit time to arbitrage. At σ = 50%/yr that is about 3.1%/yr of pool value, or about 0.8% over a 3-month market; at σ = 80% it is about 8%/yr. Fees and discrete block timing reduce it. Jumps (weekend gaps, earnings) increase it beyond the diffusion formula.
- Derived budget for an LMSR-style subsidy: a binary market with a $1,000 worst-case loss gives b ≈ 1,443, and a 10-point move from 50% costs about $322. Polymarket-scale reward budgets ($1–$5K/day on top markets) are far above what a long-tail market needs. The "pretty thin at $5/day" observation suggests that tens of dollars per day per market is the low end at which incentives start to matter.

### Gaps
- I found no published before/after spread or depth series for Polymarket's AMM→CLOB transition, or for any other venue's transition.
- I found no LMSR b values used by any crypto prediction-market deployment (Zeitgeist neo-swaps, Polkamarkets).

---

## Applicability to Probabl

### Takeaway
Probabl's YES and NO books each trade a pair of assets that share the same condition: YES-stock vs YES-USDG, and NO-stock vs NO-USDG. So the binary "one token goes to zero" problem that ruined outcome-token AMM LPs does not apply within a book. An LP depositing complete sets into both branches holds, after resolution, only the winning branch's pool, which is economically an ordinary stock/USD CFMM position. The best-fit bootstrapping design is a **per-branch CFMM backstop** (constant-product or concentrated, ideally oracle-anchored with dynamic fees), funded by complete-set deposits from the Δ-vaults or protocol-owned liquidity and routed together with the existing CLOB, as a hybrid. MetaDAO's conditional-pair AMMs are the precedent. Scoring rules (LMSR, LS-LMSR, Distribution Markets) and the pm-AMM fit poorly: they price $1 state claims or cash-settled prices, not physically settled conditional stock. History says the CLOB should remain the primary venue for professional MMs, with Polymarket/Kalshi-style rewards, and the AMM should serve as a bounded long-tail backstop.

### Cited Findings
- Same-condition conditional pairs (pass-token vs pass-USDC) have been run on plain constant-product AMMs after an on-chain CLOB "led to liquidity problems". The proposer or treasury seeds them, for example $100K USDC + META at a 1% fee. — [Neodyme](https://www.neodyme.io/reports/MetaDAO.pdf); [MetaDAO Proposal 8](https://hackmd.io/@0xNallok/ryGLNC13a)
- Gnosis CTF supports deep conditional positions on any ERC-20 collateral, with value equal to the product of the outcome collections. That is the same structure as YES-stock and NO-stock. — [Gnosis CTF guide](https://conditional-tokens.readthedocs.io/en/latest/developer-guide.html)
- Binary outcome-token AMMs lose about half of LP wealth by expiry even when optimized (pm-AMM), and Polymarket's FPMM LPs were net losers. — [Paradigm](https://www.paradigm.xyz/2024/11/pm-amm); [TUM thesis](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/_my_direct_uploads/20250903_Parshant_MA_Thesis.pdf)
- A CPMM on an ordinary asset pair loses LVR = (σ²/8)·V per unit time. — [Milionis et al., arXiv:2208.06046](https://arxiv.org/abs/2208.06046)
- LMSR over continuous outcomes has unbounded loss, and Distribution Markets need a cash-settled outcome and backing b with max f ≤ b. — [Othman thesis](https://www.csd.cmu.edu/sites/default/files/phd-thesis/CMU-CS-12-123.pdf); [Paradigm Distribution Markets](https://www.paradigm.xyz/2024/12/distribution-markets)
- Proven hybrid routing pattern: an atomic router across AMM and order book with price limits and IOC/limit-remainder strategies. — [Zeitgeist hybrid-router](https://github.com/zeitgeistpm/zeitgeist/blob/main/zrml/hybrid-router/README.md)
- Incentive templates for CLOB makers:
  - Polymarket's quadratic spread score with a two-sided min and c = 3, sampled each minute. — [Polymarket](https://docs.polymarket.com/market-makers/liquidity-rewards)
  - Kalshi's target size, reference price and discount factor, sampled each second. — [Kalshi](https://help.kalshi.com/incentive-programs/liquidity-incentive-program)
  - Fee-funded maker rebates. — [Polymarket](https://docs.polymarket.com/market-makers/maker-rebates)
- Cross-market making against deep reference venues (spot and Polymarket, for Probabl) is the user-friendliest bootstrap but needs professional MMs or subsidies. — [Shabashev, arXiv:2509.11990](https://arxiv.org/abs/2509.11990)

### Inferences
**Candidate designs, ranked by fit**
1. **Per-branch constant-product or concentrated CFMM (cond-stock / cond-USDG), funded by complete sets.**
   - *Loss:* an LP who deposits equal complete sets into the YES and NO pools ends up with the winning pool, so the loss is that pool's LVR plus divergence along the conditional price path (Y or N). Expected cost is about p·LVR_YES + (1−p)·LVR_NO. INVALID (½/½) leaves each pool worth half, with no extra loss. Worst case is bounded by the capital committed.
   - *Capital:* depth requires real stock and USDG, split into both branches. The Δ-vaults could be the LP instead of quoting through keepers.
   - *Per-branch-only LPs:* an LP who funds only one branch carries a p-bet and needs a warning or hedging.
   - *Why it fits:* there is no terminal collapse; the probability cancels inside the pair. MetaDAO is the precedent.
2. **Oracle-anchored CFMM/PMM per branch (centered on prices implied by s and p).**
   - *What the oracle can and cannot give:* spot s (stock oracle) and p (Polymarket) pin only p·Y + (1−p)·N = s. One equation leaves the conditional premium d = (Y − N)/s undetermined. So the AMM can follow s and p from oracles but must still discover d from flow. One parametrization is Y = s·(1 + (1−p)·d) and N = s·(1 − p·d), with d as the AMM's internal state.
   - *Benefit:* LVR from public moves in s and p falls sharply, leaving mainly adverse selection on d.
   - *Needs:* a low-latency stock oracle, and a Polymarket p feed that resists manipulation in thin Polymarket markets. It also needs wider fees or halts when the oracle is stale: weekends and off-hours for tokenized stocks, and around Polymarket news.
   - *Risk:* oracle-latency arbitrage, the classic risk for oracle AMMs.
3. **Hybrid (recommended architecture): keep the CLOB primary, put the AMM underneath as a backstop through an atomic router.**
   - The bot and Δ-vaults keep quoting tight on the book, and the AMM guarantees finite slippage on every market.
   - Taker orders sweep the book first, then the AMM up to the limit price, as in Zeitgeist's design.
   - A higher AMM fee than the maker spread keeps informed flow on the CLOB.
4. **Scoring rules (LMSR/LS-LMSR on a price grid), Distribution Markets, pm-AMM: poor fit.** They need cash-settled price-at-T claims or binary $1 tokens, carry ln(bins) or backing-b loss, and would introduce a new oracle-settled product. The pm-AMM would only matter if Probabl listed the event leg itself (YES-USDG vs NO-USDG), and that is unnecessary because p comes from Polymarket.

**What history implies**
- AMM-only venues stayed small; CLOB-plus-incentive venues scaled. The exception is MetaDAO-style thin conditional pairs, where an AMM beat an on-chain CLOB. Probabl sits in between: many thin conditional books, but deep, fast reference markets (spot stock and Polymarket) that arbitrageurs will use. So an AMM backstop will be arbitraged hard. Size it modestly, give it dynamic or oracle-aware fees, and treat its LVR as the bootstrap subsidy.
- A rough budget, derived: σ_Y²/8 per year of pool value for a full-range CPMM. For example, a $50K two-branch pool at σ = 60% would lose about 4.5%/yr (about $2.3K/yr) before fees and jumps. That is cheaper than Polymarket-level reward budgets on top markets, but jumps (earnings, weekend gaps, Polymarket shocks) can add materially.
- Polymarket can merge both outcomes into one book (MINT/MERGE) because YES + NO = $1. Probabl cannot merge its two books mechanically, because Y and N are linked only through the unobservable p and the relation p·Y + (1−p)·N ≈ s. Cross-branch liquidity therefore has to come from arbitrageurs or MMs hedging with spot and Polymarket, not from the matching engine.
- Reward-program design for CLOB makers on both legs: copy Polymarket's two-sided min, with single-sided quotes paid at 1/c. Score each branch book separately but require the presence of both (YES and NO) to earn the full rate, so neither leg is left empty. Random sampling (per minute or per second) deters quote flashing. Kalshi's experience (ending its volume program amid wash-trading allegations, and a CFTC warning on loss-covering stipends) argues for rewarding resting depth, not volume.

### Gaps
- I found no deployment of an AMM (or LMSR) on stock-like conditional assets paired against conditional stablecoins in an event-conditional equity setting. MetaDAO and Gnosis futarchy are the closest analogs, with governance tokens as the asset.
- I found no empirical LVR data for conditional-pair AMMs (MetaDAO pools): how much arbitrage loss vs fees their LPs or treasuries incurred.
- How Y and N behave when Polymarket p jumps, i.e. whether conditional prices are empirically stable to event news as theory suggests, is untested. It determines how much an oracle-anchored AMM can safely follow p.
