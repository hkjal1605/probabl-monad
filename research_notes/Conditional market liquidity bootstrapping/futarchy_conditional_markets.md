# Futarchy and decision/conditional markets: liquidity and price discovery on "price of X if event" vs "price of X if not"

Research date: 2026-10-11. Code facts on MetaDAO come from reading the source of `metaDAOproject/programs` (the `metaDAOproject/futarchy` URL redirects there) at commit `a8ca9f1d` (committed 2026-09-22, default branch `develop`), plus the tags `v0.3` and `v0.5.0`. "C:" below marks a claim read directly from code. Abbreviations: CPMM = constant-product market maker (x·y=k); TWAP = time-weighted average price; IL = impermanent loss.

## 1. MetaDAO (Solana): how its conditional-market liquidity evolved, and how the markets performed

### Takeaway
MetaDAO moved in three steps. First came proposer-run OpenBook v2 order books (Nov 2023–May 2024). Next came per-proposal pass/fail CPMMs, with the proposer required to lock LP liquidity (v0.3–v0.5, May 2024–Nov 2025). Today, in **v0.6 (released 2025-11-06)**, each DAO has one built-in "Futarchy AMM": when a proposal launches, **50% of the spot pool's reserves are split into a pass CPMM and a fail CPMM** that start at the spot price. Spot, pass and fail are arbitraged against each other inside every swap. At finalization the winning branch's reserves are redeemed and merged back into spot, and the losing branch's reserves become worthless. LPs cannot add or withdraw while a proposal is live. Proposal volume rose from $205K in Q3 2025 to $3.6M in Q4 2025, after this design shipped.

### Cited Findings

**Release timeline (GitHub release dates)**
- The releases are v0 (2023-11-13), v0.1 (2023-12-15), v0.2 (2024-04-03), v0.3 (2024-05-17), v0.4 (2025-03-09), delayed-twap-v0.4.1 (2025-03-13), proposal-duration-v0.4.2 (2025-03-21), v0.5.0 (2025-07-15) and v0.6.0 (2025-11-06). In the current README, `futarchy` v0.6.0 (`FUTARELBfJ…`) replaces the separate `autocrat` + `amm` programs. Later launchpad versions are v0.7.0 and v0.8.0, with `bid_wall` and `mint_governor` at v0.7.0. — [GitHub releases API / README](https://github.com/metaDAOproject/programs)

**Era 1: OpenBook v2 order books (historical, Nov 2023 – ~May 2024)**
- All early MetaDAO markets ran on OpenBook V2. No TWAP oracle existed for OpenBook, so the team built one modelled on Uniswap V2: the price is the mid of best bid and best offer, recorded before the first trade in a slot. Order accounts had to be cranked, and the trading period was then 10 days. — [Helius blog](https://www.helius.dev/blog/futarchy-and-governance-prediction-markets-meet-daos-on-solana)
- The "Switch from CLOBs to AMMs" proposal (HackMD, by joebuild, about early 2024) gave three reasons:
  - Order books struggle to attract liquidity in pass/fail markets, because uncertainty about the token's conditional value discourages limit orders near the mid. The author called this the main reason.
  - Small holders can push CLOB midpoints.
  - AMMs cost almost nothing in state rent, while each pass/fail order-book pair carried rent that could not be recouped.
  - It also proposed weighting price by the liquidity on the books over time. — [HackMD proposal](https://hackmd.io/@joebuild/proposal-clob-to-amm) (page could not be fetched directly; content via search summary)

**Era 2: per-proposal CPMMs with proposer-locked liquidity (v0.3, 2024-05-17 → v0.5)**
- MetaDAO's docs from this period describe three programs: a conditional vault, an AMM ("decision markets are facilitated through a constant-product AMM" with a Uniswap-V2-style TWAP), and autocrat. There are two vaults per proposal (base = DAO token, quote = USDC). Depositing 10 USDC yields 10 conditional-on-finalize and 10 conditional-on-revert USDC. There are two markets: pass-META/pass-USDC and fail-META/fail-USDC. After 3 days by default, autocrat passes the proposal if the pass TWAP exceeds the fail TWAP by more than a DAO-configured x%. — [MetaDAO docs, program-architecture.md](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/docs/implementation/program-architecture.md)
- C: In v0.3, `initialize_proposal` takes `pass_lp_tokens_to_lock` and `fail_lp_tokens_to_lock`. It checks that the locked LP is worth at least the DAO's `min_base_futarchic_liquidity` and `min_quote_futarchic_liquidity`, and the AMM must have been created within 5 minutes of the proposal. In v0.5, `finalize_proposal` returns the locked LP tokens to the proposer. — [v0.3 initialize_proposal.rs](https://github.com/metaDAOproject/programs/blob/v0.3/programs/autocrat/src/instructions/initialize_proposal.rs); [v0.5.0 finalize_proposal.rs](https://github.com/metaDAOproject/programs/blob/v0.5.0/programs/autocrat/src/instructions/finalize_proposal.rs)
- The DAO-creation docs say: "to prevent spam, proposers are required to lock AMM liquidity in their proposal markets… in both USDC and the futarchy's token." They recommend TWAP sensitivity of 1–5% of spot per minute. — [creating-a-dao.md](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/docs/using-the-platform/creating-a-dao.md)
- C: v0.5.0 ships a `shared_liquidity_manager` prototype, entirely commented out. Its design: "LPs provide liquidity that is by default stored in a Raydium constant-product pool, but that can be rented for the purpose of decision markets." When a draft proposal gets enough staked DAO tokens, the shared liquidity is moved into the proposal's markets, and after finalization it is all moved "to a new Raydium spot pool." This is the direct ancestor of v0.6. — [v0.5.0 shared_liquidity_manager/lib.rs](https://github.com/metaDAOproject/programs/blob/v0.5.0/programs/shared_liquidity_manager/src/lib.rs)
- The docs' own "drawbacks" page says conditional markets are zero-sum, which "will constrict liquidity and participation." It suggests subsidizing trading or liquidity, sustainable because good decisions are a positive externality. — [drawbacks.md](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/docs/futarchy/drawbacks.md)

**Era 3: the Futarchy AMM (v0.6, 2025-11-06 → current)**
- C: The DAO account embeds one `FutarchyAmm` whose `PoolState` is either `Spot{spot}` or `Futarchy{spot, pass, fail}`. Each `Pool` holds base and quote reserves, protocol-fee balances and its own `TwapOracle`. — [futarchy_amm.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/state/futarchy_amm.rs)
- C: Splitting at launch (`launch_proposal`): `base_to_lp = spot.base_reserves / 2` and `quote_to_lp = spot.quote_reserves / 2`. These are subtracted from spot, and **both** the pass pool and the fail pool are initialized with `(base_to_lp, quote_to_lp)`. One unit of underlying backs one pass claim and one fail claim, so half the spot liquidity gives full depth to both conditional pools. Both pools start at exactly the spot price, with fresh TWAP oracles from DAO parameters. Launch fails if either half is below the DAO's `min_*_futarchic_liquidity` or is zero. — [launch_proposal.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/instructions/launch_proposal.rs)
- C: Merging at finalization (`finalize_proposal`):
  - It computes pass and fail TWAPs and passes the proposal if `pass_twap > fail_twap × (10000 + threshold_bps)/10000`.
  - It resolves the conditional-vault question, `[0,1]` for pass or `[1,0]` for fail.
  - It adds the **winning** pool's reserves and fee balances back into `spot`, and calls `redeem_tokens` on the base and quote vaults so the AMM's conditional tokens become underlying.
  - It sets the state back to `Spot`. The losing pool's reserves are simply dropped (they redeem for 0). — [finalize_proposal.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/instructions/finalize_proposal.rs)
- C: LPs are locked during proposals. `provide_liquidity` and `withdraw_liquidity` both fail with `PoolNotInSpotState` unless the AMM is in `Spot` state. — [provide_liquidity.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/instructions/provide_liquidity.rs); [withdraw_liquidity.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/instructions/withdraw_liquidity.rs)
- C: Atomic arbitrage on every swap. In `Futarchy` state, every spot swap runs `arbitrage_after_spot_swap`: a 100-step grid search over a round trip that sells spot, then buys pass and fail with the same output (spot is splittable). Every pass or fail swap runs `arbitrage_after_conditional_swap`, the mirror trade that merges `min(pass_out, fail_out)` back into spot. Arbitrage legs are fee-less. The **profit goes to the protocol-fee balances**, not to LPs. On a conditional swap, the trader receives the profit in their own branch, and the other branch's share goes to protocol fees. Hard invariant checks ensure total pass-side and fail-side reserves change only by the trader's input and output, and that k never decreases. This keeps spot ≈ conditional prices without external arbitrageurs. — [futarchy_amm.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/state/futarchy_amm.rs)
- C: Fees in current code are `PROTOCOL_TAKER_FEE_BPS = 50` (0.5%) and `LP_TAKER_FEE_BPS = 0`. The CPMM swap math is "airlifted from uniswap v1." Other constants: `DEFAULT_PASS_THRESHOLD_BPS = 300`, `MAX_PASS_THRESHOLD_BPS = 1000`, team-sponsored threshold between −1000 and +1000 bps, `MIN_PROPOSAL_DURATION_SECONDS = 86400`, `MIN_QUOTE_LIQUIDITY = 100_000` (0.1 USDC). — [lib.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/lib.rs); [dao.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/state/dao.rs). **Conflict:** Solana Compass says Futarchy AMM trades pay 25 bps to the MetaDAO treasury — [Solana Compass](https://solanacompass.com/projects/metadao). The deployed v0.6.0 may differ from the v0.6.1 code head, so I could not confirm which is live.
- C: The TWAP is a "lagging price TWAP":
  - It updates at most once per 60 s.
  - Each observation can move only `max_observation_change_per_update` from the previous one.
  - The aggregator only accumulates after `start_delay_seconds`.
  - Code comments recommend an initial observation ≈ spot and a max change ≈ 2% of spot per update, so the market can reach 2× or 0 in about 50 minutes. The docs give the example of an initial $500 with a $5/update cap against a $550 market: the TWAP is $527.5 after 10 updates.
  - Rationale: Solana validators control slots and could otherwise spike the price in their own slots. — [price-oracle.md](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/docs/implementation/price-oracle.md); [dao.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/state/dao.rs)
- C: Proposals must reach a stake of DAO tokens (`base_to_stake`) before `launch_proposal` unless team-sponsored, replacing the old proposer liquidity lock. v0.6 also has "optimistic" team proposals that pass unless someone launches a futarchy market against them. — [launch_proposal.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/instructions/launch_proposal.rs)
- Pine Analytics says about 50% of proposal-market liquidity is "borrowed directly from the project's spot pool in the Futarchy AMM," removing the need for proposers to seed thin markets. — [Pine Analytics, Bull Case for $META](https://pineanalytics.substack.com/p/the-bull-case-for-meta) (via search summary). Kollan House (MetaDAO) describes it the same way. — [Solana Compass / Lightspeed interview](https://solanacompass.com/learn/Lightspeed/how-metadao-became-solanas-breakout-token-launchpad-kollan-house)

**Launchpad: raise → AMM liquidity (v0.6–v0.8, 2025–2026)**
- C: In v0.8 `settle_launch`:
  - Participants get 10M tokens, at price = raise / 10M.
  - `usdc_to_lp = raise / 5` (20%) goes with `TOKENS_TO_FUTARCHY_LIQUIDITY = 2M` tokens into the DAO's Futarchy AMM spot pool. This seeds the pool at exactly the sale price.
  - A further 900k tokens go single-sided into a Meteora DAMM v2 pool.
  - The rest goes to the treasury, capped at the minimum raise if a bid wall exists. The excess funds a `bid_wall` program, "a big wall of cash sitting at NAV."
  - The new DAO gets: TWAP initial observation = sale price, max change = 5% of sale price per update, 24 h TWAP start delay, 3-day proposals, 3% pass threshold, −3% for team-sponsored proposals, and a 1.5M-token stake (15% of float) to launch a proposal. — [v08_launchpad settle_launch.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/v08_launchpad/src/instructions/settle_launch.rs); [launchpad lib.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/launchpad/src/lib.rs); [bid_wall lib.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/bid_wall/src/lib.rs)
- Solana Compass gives these figures:
  - About $33M raised across 10 launches (early 2026) and 96 proposals across 14 organizations (mid-2026).
  - Undated: "$2–8M daily volume across all conditional markets" and about $13M TVL (DeFiLlama).
  - The launchpad seeding is "20% of raised funds plus a defined token allocation… creating an immediate price floor."
  - Futardio was renamed Backable on Oct 5, 2026.
  - [Solana Compass](https://solanacompass.com/projects/metadao). The $2–8M daily figure is undated and probably includes spot-state AMM volume, so treat it with caution.

**Performance data**
- Pine Analytics (published 2026-03-03) reports:
  - Proposal volume of $3.6M in Q4 2025, up from $205K in Q3 2025.
  - Six ICOs in Q4 2025 raising $18.7M, against one ($1.1M) in Q3.
  - Umbra was the first launch to use the Futarchy AMM.
  - Q4 protocol fee revenue of $2.51M, 54% from the Futarchy AMM and 46% from Meteora LP.
  - The report says nothing about manipulation or conditional-market depth. — [Pine Analytics Q4 2025](https://pineanalytics.substack.com/p/metadao-q4-2025-quarterly-report)
- An older third-party snapshot (undated) puts about $3.8M of cumulative decision-market volume across 65 proposals, or about $58k per proposal. — [Deep Waters Capital](https://deepwaters.capital/tpost/aiocd9mup1-metadao-market-considerations-amp-valuat) (via search summary)
- Kollan House estimated more than $60M of combined volume across Mountain Capital and OmniPair trading "since April" (2025). Mountain Capital raised $5.7M, traded below NAV, and was unwound by futarchy proposals that returned $0.57–0.60 per token. — [Alea Research podcast digest](https://alearesearch.io/podcast-digest/0xresearch-podcast/metadao-plasma-and-dats-crime-livestream)
- Manipulation test, Proposal 6 (historical, early 2024, order-book era):
  - Ben Hawkins proposed buying META from the treasury at about $33.33 (1,500 META for 50,000 USDC) while spot was about $55–60.
  - He reportedly committed more than $250,000 to buying pass and selling fail. The proposal failed.
  - Pantera's Proposal 7 (buy at a $100/META cap) and Hawkins's Proposal 8 (500 META) also failed. — [Helius](https://www.helius.dev/blog/futarchy-and-governance-prediction-markets-meet-daos-on-solana); [Hawkins' write-up](https://medium.com/@benhawkins18/stress-testing-the-futarchy-1f4fb6d0b4ba)
  - Hawkins concluded the market showed "surprising robustness" against a well-resourced actor. — [Hawkins' write-up](https://medium.com/@benhawkins18/stress-testing-the-futarchy-1f4fb6d0b4ba) (via search summary)
- Price discovery example (historical, 2024): on MetaDAO's own fundraise proposal, META traded about $435 in the pass market against $386 in fail, a spread of about 12.7%, and the proposal passed. — [CoinDesk, 2024-08-01](https://coindesk.com/tech/2024/08/01/crypto-vc-paradigm-invests-in-metadao-as-prediction-markets-boom) (via search summary)
- On Proposal 3 (a spot market for META), the market priced the impact at more than 2× the price, even though founder Proph3t wanted it to fail. — [Helius](https://www.helius.dev/blog/futarchy-and-governance-prediction-markets-meet-daos-on-solana)
- Drift proposed delegating part of its DRIFT voting power to MetaDAO, with a decision market per vote whose pass/fail price would set the delegate's vote. — [Drift governance forum](https://driftgov.discourse.group/t/request-for-delegates/236/9)

### Inferences
- The v0.6 Futarchy AMM fits the "liquidity via split" argument. Splitting half the spot reserves gives each conditional pool depth equal to half of spot, so pass and fail together quote as much depth as all of spot. Only one branch survives, so no extra capital is needed. The cost is (a) LP lockup during proposals and (b) a winning pool that may have drifted from where spot would have gone.
- MetaDAO's design leans on proposal effects being small (3% threshold). Seeding both branches at the spot price works when |Y−N|/s is a few percent. It would hand arbitrageurs value if the conditional prices were expected to differ a lot.
- The in-swap protocol arbitrage keeps spot, pass and fail consistent without keepers. Spot behaves like a merged pass+fail position (spot ≈ pass when pass is likely, and so on). Since arbitrage profit goes to the protocol, LPs do not capture it.
- The jump from $205K (Q3 2025) to $3.6M (Q4 2025) in proposal volume came alongside both the Futarchy AMM and many more launches. It is suggestive, not proof, that borrowed spot liquidity raised participation.

### Gaps
- I could not fetch the full HackMD CLOB→AMM text, metadao.fi/docs (HTTP 429), or Blockworks (HTTP 403). Exact dates for the governance vote on the AMM switch are unconfirmed.
- I found no per-proposal depth or slippage statistics, and no on-chain dashboard data, for pass/fail pools.
- I could not confirm whether the deployed v0.6.0 fee is 25 bps or 50 bps.
- I could not verify an undated secondary claim that one MetaDAO restructuring passed "with only seven wallets and <$700 volume." It is left out of the findings.

## 2. Seer, GnosisDAO and Kleros (futarchy.fi): conditional pools on Swapr/Algebra

### Takeaway
Seer's futarchy markets are MetaDAO's two-pool design on EVM. Splitting GNO and a currency token through the Gnosis Conditional Token Framework yields YES_GNO/NO_GNO and YES_cur/NO_cur. Two AMM pools trade YES_GNO/YES_cur and NO_GNO/NO_cur on Swapr, Gnosis Chain's Algebra-based DEX. Liquidity is DAO-granted and temporary: Kleros's first market had about $100k of full-range liquidity, and GnosisDAO's GIP-145 approved a $100k, 9-month pilot (Feb 2026) with concentrated positions of up to 5×. Participation so far has been thin.

### Cited Findings
- Seer futarchy market structure:
  - Creating a market with GNO as the token and wstETH as the currency mints YES_GNO, NO_GNO, YES_wstETH and NO_wstETH.
  - Two pools exist: YES_GNO/YES_wstETH and NO_GNO/NO_wstETH. YES and NO tokens trade directly against each other, not against a shared collateral.
  - A proposal is accepted if the YES pool price exceeds the NO pool price.
  - Users can split, merge, and redeem into the underlying.
  - There are no INVALID tokens; an invalid result counts as a failed proposal.
  - Futarchy markets are Gnosis Chain only. — [Seer docs, Futarchy Markets](https://seer-3.gitbook.io/seer-documentation/getting-started/navigate-our-site/futarchy-markets)
- Seer outcome tokens are ERC-20s traded through the Swapr DEX. Long-term liquidity provision is incentivized on Swapr and Bunni, and sDAI collateral earns yield while trading or LPing. — [Kleros's Seer announcement](https://typefully.com/Kleros_io/introducing-seer-crafting-smarter-GlNz8WU) (via search summary)
- GIP-145 ("9-month advisory futarchy pilot with $100k temporary liquidity"):
  - Proposed by Futarchy Labs (CEO Kelvin Santos; Robin Hanson is Chief Scientist). The forum thread opened 2025-11-17 and the Snapshot ran about Feb 7–14, 2026.
  - Funding: $100k in GNO plus WETH (possibly xDAI or sDAI), held by a 2/3 multisig, with permission for concentrated positions "of up to 5x".
  - Allocation caps: 20% for milestone-impact markets and 5% for "will it pass" markets.
  - Pools are YES_GNO/YES_sDAI and NO_GNO/NO_sDAI on Swapr "or alternative," with split, merge and redeem through Seer's FutarchyRouter. Oracle: reality.eth plus Kleros.
  - Signals: spot conditional prices and a 5-day TWAP ("calculated only when liquidity is sufficient"), with a recommendation if |impact| > 1%. Success is measured against the 24 h TWAP of real GNO after the outcome.
  - At resolution, positions are redeemed back to GNO and the currency. The GIP says IL matches a regular GNO/currency pool. LP fees, never principal, may go to Snapshot Labs.
  - Targets of more than 10 unique users and more than $20k volume per market are goals, not results.
  - Kelvin said a February 2026 example market had "limited participation," with YES TWAP about 2.5% above NO over 5 days. A delegate (NolanV) questioned trader incentives given gains under 0.5% and smart-contract risk. — [GIP-145 forum thread](https://forum.gnosis.io/t/gip-145-should-gnosis-dao-run-a-9-month-advisory-futarchy-pilot-with-100k-temporary-liquidity/11816)
- GIP-145 passed. GnosisDAO is partnering with Futarchy Labs, and a widget on Snapshot proposals shows the estimated % impact of a proposal on GNO price. — [GnosisDAO Governance Summary Feb 2026](https://gnosisdao.ghost.io/gnosisdao-governance-summary-february-2026/) (via search summary)
- Kleros KIP-76 (about 2025) requires futarchy tests for PNK-minting proposals. Its first market had "~100k full-range liquidity" on the pools. — [Kleros forum KIP-76](https://forum.kleros.io/t/kip-76-futarchy-based-governance-rule-for-pnk-minting/1347/2) (via search summary)
- Futarchy Labs says Kleros has used futarchy.fi for several months as an advisory tool and safeguard: a mint must win Snapshot **and** show positive expected price impact. Kleros markets frequently traded at |impact| > 4%, and one proposal was rejected after its market forecast negative impact. — [GIP-145 thread](https://forum.gnosis.io/t/gip-145-should-gnosis-dao-run-a-9-month-advisory-futarchy-pilot-with-100k-temporary-liquidity/11816)
- Historical, Nov 2020: GnosisDAO's first futarchy setup "requires Gnosis itself to provide liquidity for the vote based prediction markets," which "exposes the protocol to high losses when the market outcome becomes clear." As a result, "liquidity is too thin to be a meaningful measure of market sentiment." — [Tally Newsletter #7, 2020-11-24](https://newsletter.tally.xyz/p/the-tally-newsletter-issue-7). Launch coverage said the treasury would allocate 1,000 ETH and 20,000 GNO to the prediction markets. — [CoinDesk, 2020-11-23](https://coindesk-coindesk-prod.cdn.arcpublishing.com/tech/2020/11/23/new-gnosisdao-bets-on-futarchy-a-prediction-market-governance-model/) (via search summary)

### Inferences
- The 2020 GnosisDAO lesson matters for anyone seeding conditional or prediction markets with a market maker. The 2020 markets were binary "will it pass" markets, and an LP in such a market is picked off as the outcome becomes clear. Conditional-price pools such as YES_GNO/YES_cur do not have this problem in the same form. Their price is a conditional price, not a probability, so it does not have to swing to 0 or 1 as the event resolves.
- The GIP-145 claim that IL equals a regular GNO pool's IL matches the split-LP derivation in Section 6 below.

### Gaps
- I found no public volume, depth or trader-count results for Seer or GnosisDAO futarchy pools after Feb 2026. The 9-month pilot runs to about Nov 2026.
- The Swapr/Algebra fee tier and range settings actually used by these pools are unknown.

## 3. Butter (butter.money) Conditional Funding Markets: Optimism and Uniswap Foundation (2025)

### Takeaway
Butter ran two pilots. Optimism's (Mar–Jun 2025) was **play money**, with 50M PLAY of initial liquidity; prices anchored on that seed and TVL was overestimated by about $200M. The Uniswap Foundation's (July 2025) used real money. Each candidate had Funded and Not-Funded branch markets, with a $20k Merkl liquidity-mining subsidy. Volumes were small (about $19–20k against $5.6k at decision), and a capped TWAP cut decision reversals from 6 to about 1.

### Cited Findings
- **Optimism "Futarchy v1"** (historical, closed 2025-06-12):
  - Each new forecaster got 50 OP-PLAY. The post cites a "50M play token initial liquidity amount."
  - Forecasters predicted 84-day Superchain TVL increases for 22 projects. Futarchy and the Grants Council each picked 5 projects for 100K OP each.
  - Participation: 430 forecasters after filtering 4,122 suspected bots, making 5,898 trades.
  - Predictions "significantly overestimated" TVL, about $200M too high; a commenter cited a ~$239M predicted increase against ~$31M realized. The suspected causes are no downside in play money and the initial liquidity anchoring prices.
  - The futarchy cohort still showed about $32.5M more aggregate TVL growth than the Grants Council cohort, on a small sample.
  - Sybil attacks and gaming by participating projects were problems. — [Optimism forum, Futarchy v1 Preliminary Findings](https://gov.optimism.io/t/futarchy-v1-preliminary-findings/10062)
- **Uniswap Foundation growth CFM #1** (historical, opened 2025-07-07, decided 2025-07-11, KPI resolved 2025-08-10):
  - Candidates were Morpho and Euler, each with Funded and Not-Funded branches. The KPI was the 30-day trailing Unichain TVL. The prize was $100k USDC, won by Morpho.
  - Liquidity mining of $20k via Merkl ran from market start to decision + 48 h, paid pro-rata to LP share-time, with liquidity mining on Uniswap v2 on Unichain. LP depth rose steadily until the decision.
  - Funded-branch volume at decision was about $19–20k for Morpho against about $5.6k for Euler.
  - The instantaneous Funded−NotFunded spread reversed 6 times, but only about 1 material reversal remained under the capped TWAP.
  - Morpho's KPI rose $96.01M against a forecast counterfactual of $67.50M, confounded by an ETH rally.
  - Proposed improvements: adjacent KPI markets to share liquidity and information, and multi-winner or split allocations to reduce all-or-nothing distortions. — [Butter report (GitHub mirror)](https://github.com/buttermarkets/ggresearch/blob/main/topic/experiments/uniswap-foundation-growth-cfm-1-report.md); [GG Research forum](https://ggresear.ch/t/uniswap-foundation-growth-cfm-1-report/93)
- Butter's CFM design note:
  - Per project there are Yes and No conditional pairs of Long/Short scalar tokens over a metric with bounds, backed by sDAI.
  - Auction revenue from project slots is meant to bootstrap liquidity, and auction winners set the initial price by how they split 1 sDAI into Long and Short.
  - The DAO subsidizes LPs like liquidity mining, so rewards plus fees offset IL. LMSR is mentioned as a scoring rule of interest, and the maximum DAO loss per market equals the LMSR liquidity parameter.
  - Commenters suggested liquidity incentives proportional to the ask. — [Butter ggresearch, conditional-funding-markets.md](https://github.com/buttermarkets/ggresearch/blob/main/topic/gov-designs/conditional-funding-markets.md)
- A user review (Devansh Mehta) found the app hard to understand and argued thin pilots can be gamed by coordinated buying of "funded" tokens. — [X post](https://x.com/TheDevanshMehta/status/1944363379881349199) (opinion)

### Inferences
- Butter's results suggest small subsidies (about $20k) produce markets with tens of thousands of dollars in volume. Real price discovery and resistance to manipulation came from the decision rule (capped TWAP) more than from depth.
- Play-money seed liquidity anchors prices. A Probabl-style seed price sitting far from the true conditional price is an analogous risk with real money: arbitrageurs extract the difference.

### Gaps
- The AMM type used for Butter's conditional markets is not stated in the sources found; only the liquidity-mining pool is identified, as Uniswap v2 on Unichain. Cap parameters for the capped TWAP live in Butter docs I did not retrieve.

## 4. Other conditional and combinatorial markets: Hanson, Gnosis CTF/Omen, combos/parlays, others

### Takeaway
Hanson's canonical answer to thin decision markets is a **sponsor-paid subsidy via an automated market maker** (LMSR). Liquidity should be scheduled over time and scaled by p(1−p), and the unconditional and two conditional prices together imply the probability. Commercial "conditional" products in 2026, Kalshi Combos and Polymarket Combos, price multi-leg positions by **RFQ** to market makers rather than order books. I found no live product besides Probabl that trades event-conditional tokenized stocks.

### Cited Findings
- Hanson, "Futarchy Liquidity Details" (2025-06-12, addendum 06-20). Those who value the advice should subsidize market-maker liquidity. His liquidity schedule:
  - Zero before the markets open (A), then a continuous ramp up to a maximum (B).
  - Lower during a short, possibly randomized observation window (C–D).
  - High again from D to E so traders can exit.
  - At E the winning conditional market becomes the unconditional market and the loser disappears.
  - Liquidity may be scaled by about p(1−p), and price differences weighted by p(1−p), because conditional prices are less reliable when their condition is unlikely.
  - The unconditional price plus the two conditional prices imply p.
  - A trader's profit from moving a price by δ is about liquidity × δ², times the probability of the condition. — [Overcoming Bias](https://www.overcomingbias.com/p/futarchy-liquidity-details)
- LMSR (Hanson 2003) is the most applied automated market maker for prediction markets. Its liquidity constant *b* sets how far a trade moves prices, and the scoring rules "solve the problem of how to subsidize markets when natural trading volume is insufficient." — [Experimental paper, arXiv 1204.3457](https://arxiv.org/pdf/1204.3457) (via search summary)
- Chen, Kash, Ruberry and Shnayder, "Decision Markets with Good Incentives" (WINE 2011). In a decision market, only the chosen action's forecast is scored, so experts can profit by steering the decision. Strictly proper scoring needs the decision maker to take every action with positive probability (a stochastic decision rule). — [Harvard EconCS](https://econcs.seas.harvard.edu/resource/chenwine11pdf); [AAMAS paper PDF](https://cs.huji.ac.il/%7Ejeff/aamas11/papers/C1_R44.pdf)
- Critique: futarchy's conditional prices can be biased estimates of causal effect because the decision and the market are entangled, a failure mode separate from thin liquidity. Hanson responds that bringing the decision inside the market reduces this. — [LessWrong "Futarchy is parasitic…"](https://www.lesswrong.com/posts/mW4ypzR6cTwKqncvp/futarchy-is-parasitic-on-what-it-tries-to-govern); [LessWrong "No, futarchy doesn't have an EDT flaw"](https://www.lesswrong.com/posts/dEoyaWznnKtM5GMnM/no-futarchy-doesn-t-have-an-edt-flaw) (via search summary)
- Subsidy pricing critique: paying a small amount to tie up large capital in a market likely to resolve N/A can underpay for the risk. — [LessWrong "Where are all the decision markets"](https://www.lesswrong.com/posts/bDxqMn3GJEhPeqZey/where-are-all-the-decision-markets) (via search summary)
- Gnosis Conditional Tokens is an ERC-1155 framework in which a condition (question, oracle, outcome slots) locks collateral and issues position tokens. Omen (built on it) provided liquidity with a fixed-product market maker (FPMM) "resembling Uniswap." — [wikidocs summary](https://wikidocs.net/326751); [Omen summary (Japanese)](https://scrapbox.io/tkgshn/Omen); [FPMM code package](https://app.unpkg.com/@gnosis.pm/conditional-tokens-market-makers@1.8.1/files/test/test-fpmm-deterministic.js) (secondary sources only)
- Kalshi Combos went live 2026-05-22 with prices set by RFQ. Combos reportedly drew $3.5B in a week, more than single sports markets. Polymarket US Combos launched publicly 2026-08-21: 2–10 sports legs, sellable before resolution, $31.4M in 24 h (21.6% of Polymarket US volume). — [CasinoBeats](https://casinobeats.com/2026/08/18/polymarket-launching-parlays-in-us-as-kalshi-looks-to-cash-in-on-combos/); [SI](https://www.si.com/prediction-markets/usa/combos); [Lines.com](https://www.lines.com/prediction-market/polymarket-combo). These are affiliate or trade-press sources, and leg limits conflict (10 against 32).
- Nearest analogs to an "event-conditional asset" are Poloniex's TRUMPWIN/TRUMPLOSE tokens (2020, redeem $1 or $0), Robinhood's 2024 election contracts, and Roundhill's filed 2028 election ETFs. None of them is conditional stock. — [Decrypt](https://decrypt.co/46731/making-election-predictions-with-poloniex-trump-tokens); [Spectrum News](https://spectrumnews1.com/ca/la/politics/2024/10/28/robinhood-launches-presidential-election-trades)

### Inferences
- Kalshi and Polymarket chose RFQ over order books for combinatorial products. Professional market makers quoting on demand is the established way to supply liquidity where books would be empty. This maps onto Probabl's existing market-maker bot.

### Gaps
- I did not research Manifold conditional markets, Augur, "Futarchy for Ethereum" writings (e.g., Vitalik's info-finance post) or Jupiter's MetaDAO usage in depth. Searches returned nothing usable on Jupiter.
- I found no primary FPMM documentation, and no 2025–2026 launch of a product trading tokenized stocks conditional on an event, apart from Probabl.

## 5. Analysis of liquidity in conditional markets: why thin, the split argument, TWAP manipulation resistance, LP behaviour

### Takeaway
Every implementation reports thin conditional markets. Three causes recur: zero-sum and short-lived payoffs, capital locked across branches, and LPs exposed to adverse selection. The two fixes that worked best are (1) **splitting**, where one unit of collateral quotes in both branches (MetaDAO v0.6, Seer/GnosisDAO), and (2) **subsidy** through liquidity mining, sponsor-provided LMSR budgets or DAO-granted temporary liquidity. Where an on-chain decision reads the price, a manipulation-resistant oracle (lagging or capped TWAP) is the other essential piece. I found no futarchy-specific academic analysis of LP impermanent loss across pass/fail pools.

### Cited Findings
- Zero-sum conditional markets "will constrict liquidity and participation"; incentives can help. — [MetaDAO docs, drawbacks](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/docs/futarchy/drawbacks.md)
- Order books attract few limit orders near the mid in pass/fail markets because of conditional uncertainty. — [HackMD CLOB→AMM proposal](https://hackmd.io/@joebuild/proposal-clob-to-amm) (via search summary)
- Markets for proposals expected to fail can become "nihilistic and noisy" because of rational apathy. — [Helius](https://www.helius.dev/blog/futarchy-and-governance-prediction-markets-meet-daos-on-solana)
- Protocol-provided liquidity in binary vote markets loses heavily "when the market outcome becomes clear." — [Tally Newsletter #7](https://newsletter.tally.xyz/p/the-tally-newsletter-issue-7)
- Hanson recommends a liquidity schedule and scaling by p(1−p). — [Overcoming Bias](https://www.overcomingbias.com/p/futarchy-liquidity-details)
- Split capital efficiency in code: MetaDAO initializes both pass and fail pools with the *same* half of the spot reserves. — [launch_proposal.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/instructions/launch_proposal.rs)
- GIP-145 claims IL for split conditional positions "matches a regular GNO/currency pool." — [GIP-145](https://forum.gnosis.io/t/gip-145-should-gnosis-dao-run-a-9-month-advisory-futarchy-pilot-with-100k-temporary-liquidity/11816)
- On TWAP manipulation, MetaDAO's docs give these examples:
  - A last-15-minute 10× pump moves a 72-hour TWAP by only about 3%.
  - Validators controlling 1% of slots could spike prices in a plain TWAP, hence observation caps and 60 s minimum spacing.
  - Allowing a 1% move per slot would let a manipulator who lands every slot move the price 348%/minute, against about 45%/minute for normal trading. — [price-oracle.md](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/docs/implementation/price-oracle.md); [futarchy_amm.rs comments](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/state/futarchy_amm.rs)
- Butter's capped TWAP reduced decision reversals from 6 to about 1. — [Butter UF CFM report](https://github.com/buttermarkets/ggresearch/blob/main/topic/experiments/uniswap-foundation-growth-cfm-1-report.md)
- General AMM IL literature: price changes need not cause net losses because fees matter equally, and IL and LVR coincide for small moves. — [arXiv 2401.07689](https://arxiv.org/pdf/2401.07689); [arXiv 2410.00854](https://arxiv.org/pdf/2410.00854) (not futarchy-specific)

### Inferences
- The thinness has a structural cause. Traders get information value only if their branch wins, and LPs have historically been given no edge: MetaDAO pays LPs 0 bps and sends arbitrage to the protocol. Subsidies or protocol-owned liquidity have therefore been the real source of depth, in the form of MetaDAO's DAO spot pool, GnosisDAO's $100k, Kleros's ~$100k and Butter's $20k.

### Gaps
- I found no paper or blog that formally analyzes the payoff of an LP in split pass/fail CPMMs. Section 6 is my own derivation.

## 6. LP payoff when one unit of spot liquidity is split into a YES-branch CPMM and a NO-branch CPMM

### Takeaway
Suppose an LP deposits x stock and y USD (k = x·y, starting price s₀ = y/x), splits both, and seeds a YES CPMM and a NO CPMM. **The terminal payoff is the winning pool's reserves, redeemed 1:1. That equals the payoff of an ordinary spot CPMM LP whose price moved from s₀ to the winning branch's final price, i.e. the standard IL formula.** The losing branch costs the LP nothing extra, but all fees earned in the losing branch are lost. Before resolution, the split position is worth less than a spot LP by a Jensen gap that grows with |Y−N|. Using the exogenous event probability p, as Probabl can, LP risk does not depend on moves in p, only on moves in the conditional prices Y and N.

### Cited Findings
- MetaDAO's code does exactly this with half the spot pool. At finalization only the winning pool's reserves are added back to spot and redeemed, and the losing pool's are dropped. — [finalize_proposal.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/instructions/finalize_proposal.rs)
- GIP-145 states positions are redeemed to GNO plus the currency, with IL equal to a regular pool's. — [GIP-145](https://forum.gnosis.io/t/gip-145-should-gnosis-dao-run-a-9-month-advisory-futarchy-pilot-with-100k-temporary-liquidity/11816)

### Inferences
These are my derivation, checked numerically with a short Python script (no fees, pools arbitraged to their conditional prices):
- **Setup.** Deposit x stock and y USD. Splitting gives x YES-S, x NO-S, y YES-U and y NO-U. The YES pool holds (x YES-S, y YES-U) and the NO pool (x NO-S, y NO-U), both with k = xy, both starting at s₀. A CPMM at price P holds √(k/P) base and √(kP) quote.
- **If YES wins** with the final YES-book price Y_T, the LP redeems √(k/Y_T) stock and √(k·Y_T) USD, worth 2√(k·Y_T) when post-resolution spot ≈ Y_T. That is identical to a plain spot LP whose price went s₀ → Y_T. The IL against holding is 2√r/(1+r) − 1, with r = Y_T/s₀. The NO case mirrors this with N_T.
- **Numerical check** (x = 1, s₀ = 100):

  | Y / N | IL if YES wins | IL if NO wins |
  |---|---|---|
  | 110 / 90 | −0.11% | −0.14% |
  | 105 / 98 | −0.03% | −0.01% |
  | 150 / 50 | −2.02% | −5.72% |
  | 200 / 60 | −5.72% | −3.18% |

  In every case the split-LP terminal value equals the spot-LP-through-the-jump value exactly. Spreads of a few percent, MetaDAO-like, cost under 0.2%.
- **Before resolution**, the claims are valued with YES-USD worth p and NO-USD worth 1−p. The split LP is worth 2√k·[p√Y + (1−p)√N], while a spot LP at s = pY + (1−p)N is worth 2√(ks).
  - Example: p = 0.5, Y = 150, N = 50 gives a split LP of 193.19 against 200 for spot LP and for holding.
  - Example: p = 0.3, Y = 120, N = 90 gives 198.54 against 199.
  - The gap is the jump IL booked in advance. A spot LP pays the same cost at the resolution jump, so expected terminal values match.
- **Fees are lost in the losing branch.** Fees in the losing pool accrue in losing claims, which are worth 0. Fee APR should therefore be judged per branch, weighted by p or (1−p). The near-dead branch is effectively unpaid, which matches Hanson's p(1−p) and the "nihilistic markets" observation.
- **Seeding at s₀ is costly when Y₀ and N₀ differ from s₀.** If the fair conditional prices at launch are Y₀ ≠ s₀ and N₀ ≠ s₀, seeding both pools at s₀ (as MetaDAO does) lets the first arbitrageurs extract the IL from s₀ → Y₀ in the YES world and s₀ → N₀ in the NO world.
  - Seeding at Y₀ and N₀ from a single split leaves directional residual claims. For example, with Y₀ > s₀ > N₀ and all YES-U and NO-S used, the leftovers are x − y/Y₀ YES-S and y − x·N₀ NO-U.
  - The alternative is concentrated or oracle-anchored curves.
- **Exposure to p.** If only conditional prices are quoted, the pools hold steady while p moves. Arbitrage against the pools comes only from news about Y or N, not from news about the event's likelihood. A plain spot-stock LP, by contrast, is exposed to event-probability-driven moves.

### Gaps
- The result assumes the post-resolution spot price equals the final winning-branch price and ignores fees. Measuring real slippage, and how far Y_T sits from the post-resolution spot, would need empirical data from MetaDAO or Seer pools, which I did not find.

## Applicability to Probabl

### Takeaway
**Copy** MetaDAO v0.6's core idea: one deposit of stock and USDG, split by the conditional vaults, seeds **both** the YES and NO books with full depth, with consistency enforced inside the trade. Adapt it to Probabl's advantages: s (Chainlink) and p (Polymarket) are observable, and the event is exogenous. **Avoid** MetaDAO's equal seeding at spot when conditional spreads are large, long LP lockups with no exit, fee-less LPs, and over-engineered decision-oracle TWAPs Probabl doesn't need.

### Cited Findings
- MetaDAO's evidence base for each of these points is set out in Sections 1–6:
  - Split seeding and merge-back: [launch_proposal.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/instructions/launch_proposal.rs), [finalize_proposal.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/instructions/finalize_proposal.rs).
  - In-swap arbitrage: [futarchy_amm.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/state/futarchy_amm.rs).
  - LP lockup: [withdraw_liquidity.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/instructions/withdraw_liquidity.rs).
  - Launch seeding (20% of raise plus 2M tokens at the sale price): [settle_launch.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/v08_launchpad/src/instructions/settle_launch.rs).
  - Volume rose from $205K to $3.6M per quarter after the Futarchy AMM: [Pine](https://pineanalytics.substack.com/p/metadao-q4-2025-quarterly-report).
- Typical futarchy conditional spreads are small: MetaDAO's threshold is 3%, GnosisDAO's Feb 2026 example was +2.5%, and Kleros traded above 4%. MetaDAO's fundraise reached about 12.7% ($435 against $386). — [dao.rs/lib.rs](https://github.com/metaDAOproject/programs/blob/a8ca9f1d34ee8b135bf8fffe5ba7e8aa4cb10c9f/programs/futarchy/src/lib.rs); [GIP-145](https://forum.gnosis.io/t/gip-145-should-gnosis-dao-run-a-9-month-advisory-futarchy-pilot-with-100k-temporary-liquidity/11816); [CoinDesk](https://coindesk.com/tech/2024/08/01/crypto-vc-paradigm-invests-in-metadao-as-prediction-markets-boom)
- Subsidized or protocol-owned liquidity has been the source of depth in every implementation: GnosisDAO $100k, Kleros about $100k, Butter $20k via Merkl. Binary-outcome LPs lose money as outcomes become clear (GnosisDAO 2020), and play-money seed liquidity anchored prices (Optimism). — [GIP-145](https://forum.gnosis.io/t/gip-145-should-gnosis-dao-run-a-9-month-advisory-futarchy-pilot-with-100k-temporary-liquidity/11816); [KIP-76](https://forum.kleros.io/t/kip-76-futarchy-based-governance-rule-for-pnk-minting/1347/2); [Butter report](https://github.com/buttermarkets/ggresearch/blob/main/topic/experiments/uniswap-foundation-growth-cfm-1-report.md); [Tally #7](https://newsletter.tally.xyz/p/the-tally-newsletter-issue-7); [Optimism findings](https://gov.optimism.io/t/futarchy-v1-preliminary-findings/10062)
- Kalshi and Polymarket price combinatorial conditional products by RFQ. — [CasinoBeats](https://casinobeats.com/2026/08/18/polymarket-launching-parlays-in-us-as-kalshi-looks-to-cash-in-on-combos/)

### Inferences

**What to copy**
1. **Split-seeded twin CPMMs (or twin curves feeding the books).** An LP or protocol vault deposits stock and USDG. The vaults split them and seed a YES-stock/YES-USDG pool and a NO-stock/NO-USDG pool from the same collateral. That doubles quoted depth per dollar compared with funding each book separately. The terminal payoff equals a standard CPMM position through the winning branch's price path (Section 6), which is easy to explain to LPs: "your IL is exactly what a normal pool would have had, given the price the stock ends at in the world that happened."
   - At resolution, redeem the winning pool's claims 1:1, the same as MetaDAO's merge-back. For INVALID (½/½), both pools redeem at half each; the payoff is ½·V_YES + ½·V_NO, still at most the HODL value.
   - These pools could sit beside the existing on-chain order books as a resting backstop, or be expressed as a ladder of resting orders, so they remove the thin-book slippage problem from day one.
2. **Consistency arbitrage inside the trade, MetaDAO-style.** MetaDAO arbitrages spot against pass and fail inside every swap and gives the profit to the protocol. Probabl has no on-chain spot stock pool, but it has the no-arbitrage identity p·Y + (1−p)·N ≈ s, and merge/split is always available: 1 YES-S plus 1 NO-S makes 1 stock.
   - A router could atomically check trades against Chainlink s and Polymarket p, and route merge/split arbitrage between the YES and NO books.
   - Probabl must decide who receives that profit. MetaDAO keeps it for the protocol; giving it to LPs would help offset unpaid losing-branch fees.
3. **Seed from raise or treasury capital at a known fair price.** MetaDAO seeds 20% of every raise at the sale price. Probabl could seed protocol-owned twin pools per market from fee revenue or Δ-vault capital, at prices implied by s, p and an estimated spread. That turns the bootstrapping problem into a protocol-owned-liquidity budget per market, like GnosisDAO's $100k pilot.

**What to avoid or adapt**
4. **Do not seed both branches at s₀ when the expected |Y−N| is large.** MetaDAO's equal seeding is fine for spreads around 3%. Earnings- or FDA-type events could have 20–50% conditional spreads, and the first arbitrageurs would take the s₀→Y₀ and s₀→N₀ IL; per Section 6, a ±50% spread costs the LP 2–6%.
   - Seed at Y₀ and N₀ consistent with pY₀ + (1−p)N₀ = s. Accept a small directional residual of claims, or use concentrated ranges or oracle-anchored curves around Y₀ and N₀.
5. **Do not lock LPs for months.** MetaDAO locks LPs for 3-day proposals. Polymarket events can run for months. An LP who holds equal shares of both pools can always exit pro rata: withdraw both pools and merge the matched claims into stock and USDG, and receive the unmatched residual as claims. Offer that exit.
6. **Pay LPs.** MetaDAO's LP fee is 0 bps and its arbitrage profit goes to the protocol; that works only because DAOs supply protocol-owned liquidity. Third-party LPs need fees, rebates, or a share of the consistency-arbitrage profit. Losing-branch fees are worthless, so make the branch fee or reward depend on p, or move liquidity out of the near-dead branch as p → 0 or 1, following Hanson's p(1−p).
7. **Probabl needs less TWAP machinery than futarchy.** The event is exogenous; a Polymarket outcome does not depend on Y or N. So the Chen–Kash decision-incentive problem and the pass-pumping manipulation MetaDAO defends against do not apply to settlement.
   - Use MetaDAO-style lagging or capped TWAPs only where an on-chain mechanism reads book prices, such as Δ-vault rebalancing, liquidation or mark prices. MetaDAO's parameters are a sensible template: 60 s update spacing, 2–5% of price per update, a start delay.

**How futarchy price-discovery results inform Probabl's YES/NO legs**
8. Conditional books were thin even with real money: about $58k average per MetaDAO proposal (older snapshot) and $5–20k per Butter branch. Real discovery happened when liquidity was protocol-provided (MetaDAO v0.6) or subsidized, and when a well-capitalized manipulator met arbitrage (Proposal 6 failed despite more than $250k spent).
   - For Probabl, liquidity is the binding constraint, not oracle design. Expect the leg with lower probability to be the noisier, "nihilistic" leg.
   - Use p·Y + (1−p)·N ≈ s with Chainlink and Polymarket to anchor that leg's quotes: the market-maker bot or AMM can infer N from s, p and Y when the NO book is thin, and vice versa.
9. **RFQ as a complement.** Kalshi and Polymarket chose RFQ to the market-maker bot for multi-leg or conditional products. For 1-click trades in thin markets, an RFQ path to Probabl's market-maker bot can coexist with on-chain books and split-seeded pools.

### Gaps
- No empirical data was found on how far the winning conditional pool's final price sits from the post-resolution spot price, or on realized LP returns in MetaDAO or Seer pools. Either would be needed to calibrate fee and subsidy levels for Probabl's markets.
