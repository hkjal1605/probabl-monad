# Worlds: how power users think, and how probabl should present them

*Research report for the v2 UI, 2026-11-04. Nothing in it is built yet.*

**The short version.** The people most likely to trade worlds already think in "if this happens, then that stock moves." No product today pays on that sentence. They express it with two instruments that don't fit it (an event contract and a stock option), multiply the odds in their heads, and often lose even when they were right. The UI must do three things:
- **Start from the moment their idea starts:** a catalyst, a headline, an event or stock they already follow.
- **Translate the idea into the product for them,** so they never choose a "product."
- **Show four honest numbers and the shrinking chance of everything happening,** in a form people can read correctly at a glance.

Three presentation options follow (§7). I recommend combining them (§8):
- a catalyst feed of curated worlds as the front door;
- a "+ World" action on every event and stock page;
- a sentence ("If … then …") as the language of every world page and ticket.

---

## Contents

1. [Method and confidence](#1-method-and-confidence)
2. [Who the power user is](#2-who-the-power-user-is)
3. [The journey from idea to trade](#3-the-journey-from-idea-to-trade)
4. [How they read numbers, and where they go wrong](#4-how-they-read-numbers-and-where-they-go-wrong)
5. [Principles for a zero-effort experience](#5-principles-for-a-zero-effort-experience)
6. [The building blocks every option shares](#6-the-building-blocks-every-option-shares)
7. [Three ways to present the product](#7-three-ways-to-present-the-product)
8. [Recommendation](#8-recommendation)
9. [Naming and copy](#9-naming-and-copy)
10. [Guardrails: honest without killing the fun](#10-guardrails-honest-without-killing-the-fun)
11. [What the backend needs for this UI](#11-what-the-backend-needs-for-this-ui)
12. [How to validate before building it all](#12-how-to-validate-before-building-it-all)
13. [Decisions for you](#13-decisions-for-you)
14. [Sources](#14-sources)

---

## 1. Method and confidence

**Five research tracks ran in parallel:**
- prediction-market power users;
- parlay and combo psychology and bet-builder design;
- event-driven stock and options traders;
- interface patterns that make complex finance feel simple;
- scenario and conditional products, and how people judge joint chances.

Together they ran about 200 web searches and read about 150 pages and papers.

**How far to trust it:**
- **Strong:** the cognitive science (Tversky & Kahneman 1983, Bar-Hillel 1973, natural-frequency and icon-array studies), the betting field studies (Brown, Grasley & Guido 2026; Newall et al.; Bennett et al. 2024) and the options-loss studies (de Silva, Smith & So; Bryzgalova, Pavlova & Sikorskaya). These come from primary sources.
- **Weaker:** many 2026 industry numbers (combo volume shares, platform launches) come from trade press and are approximate. Notional "volume" overstates real money by roughly ten times for combos.
- **Indirect voices:** Reddit and X could not be read directly. Traders' own words come through interviews, podcasts and press (NPR/OPB, CNBC, ChinaTalk).
- **Labelled:** anything marked *(unverified)* is a single secondary source.
- **No direct study of worlds exists.** No study tests a product like worlds, or the word "world." Where the report recommends something new, it says so, and §12 lists how to test it.

---

## 2. Who the power user is

Three kinds of power user will meet on probabl. A fourth (bots and market makers) matters for liquidity, not for the UI.

| | **The catalyst trader** | **The prediction-market pro** | **The story builder** |
|---|---|---|---|
| Today | Options and leveraged ETFs on Robinhood, Webull or moomoo; follows finance accounts on X, Reddit and Discord | Trades Polymarket and Kalshi daily: news, politics, macro | Kalshi or Robinhood combos, same-game parlays, PrizePicks |
| How they think | "If the Fed hikes, small caps dump." "If tariffs get delayed, NVDA rips." | "YES is 35¢; I think it's 45." Cents are probabilities; edge is the gap. | "I see it playing out like this." A story, or a target ("turn $10 into $500") |
| Where an idea starts | The earnings and macro calendar, a headline, their own holdings | Breaking news ("more than three seconds and you've missed it"), primary sources, whale alerts | A game or event they care about; curated "popular" combos |
| What hurts today | **Right but lost:** the stock moved their way and the option still fell (volatility collapse, time decay). Retail loses 5–9% per earnings trade on average, up to 14% when a big move is expected. | Unclear rules and resolution disputes, thin books, fees, capital locked for months, a separate tool for every job | Low payout odds they can't see, pricing that feels opaque, quotes that change or fail at submit |
| What they need from probabl | **Get paid on what they're right about:** the event and the close. Known maximum loss, Friday-close dates, their stock front and centre. | **Rules first,** our price next to the venues' and the naive product, a quote at their size, an exit price at all times, speed | **Live payout as they build,** one-tap curated worlds, sharing, and (for their own good) the real chance shown as clearly as the payout |
| Share of the opportunity | The core new market (no product serves them) | Small in number, outsized in volume and trust | Largest by count; drives volume; carries the regulatory risk |

**What all three share:**
- **They already think conditionally.** Sell-side scenarios ("bull/base/bear"), "the Trump trade," the "TACO" tariff trade, "5 ETFs that move if the Senate odds are wrong." Coverage is written as "if X, then Y" ([Benzinga/Yahoo, 2026](https://finance.yahoo.com/markets/stocks/articles/kalshi-polymarket-put-democrats-senate-172147075.html); [Goldman's policy baskets](https://investing.com/news/stock-market-news/trump-win-would-push-republican-stock-basket-up-8-goldman-says-3661896)).
- **Nobody prices the joint outcome.** Event contracts pay on the event, options pay on price, volatility and time, and nothing pays on "event *and* move." The traders who want "if X then Y" hold two positions and reason about the link themselves. Arbitrage across logically linked markets on Polymarket came to about $95k, against $39.6M within single markets ([IMDEA 2025](https://arxiv.org/html/2508.03474v1)). This is the gap worlds fill.
- **They act on catalysts.** The earnings week, the FOMC meeting, the election night ([de Silva et al.](https://mitsloan.mit.edu/ideas-made-to-matter/retail-investors-lose-big-options-markets-research-shows); [Robinhood Q3 2026](https://www.stocktitan.net/articles/robinhood-q3-2026-earnings-prediction-markets-crypto): the Fed decision was its single largest event contract).
- **They want a defined maximum loss.** 95% of retail same-day options trades have a known maximum loss at entry ([Cboe 2025](https://www.cboe.com/insights/posts/0-dt-es-decoded-positioning-trends-and-market-impact)).
- **They lose most on long shots.** On Kalshi, contracts under 10¢ lose buyers over 60% of their money ([Bürgi, Deng & Whelan 2026](https://www.karlwhelan.com/Papers/Kalshi.pdf)). Takers on combos have lost about $1B, roughly 14% of stakes ([InGame](https://www.ingame.com/kalshi-parlay-taker-losses-top-1b/)). Worlds are long shots by construction, so this shapes the whole design (§4, §10).

**Skill is concentrated.** About 3% of Polymarket accounts are measurably skilled, and they react faster to news. In the authors' words, the majority "does not produce accuracy; rather, it funds it" ([Gómez-Cram et al. 2026](https://insights.som.yale.edu/insights/wisdom-of-the-few-prediction-markets-are-driven-by-small-number-of-skilled-traders)). The pros are few, but they set prices, spread ideas and judge whether probabl is honest. Design for their checks and the rest benefit.

---

## 3. The journey from idea to trade

Every power user walks the same seven steps. The UI's job is to answer the question at each step before it is asked.

| Step | What goes through their head | What fails today | What probabl must do |
|---|---|---|---|
| **1. Trigger** | "CPI is Thursday." "Trump just tweeted about tariffs." "NVDA reports next week." | Ideas start on X, the news or a calendar; the trading app comes later | Meet them at the catalyst: a calendar of what's coming, worlds built around each event, a "what moves my stock" view |
| **2. Thesis** | "If the deal happens, NVDA rips." "Deal *and* the S-1 *and* the GPU order: that's the AI super-week." | The story is clear in their head and in nobody's product | Let them say it in their words: a sentence, or pick the events they believe in |
| **3. Translation** | "So what do I buy? Calls? Which strike? The Kalshi contract too? How do I combine them?" | **This is where they drop off or mis-trade.** Options pay on volatility and time, not the event; combos don't include stocks | **Do the translation:** turn the sentence into the right bundle and show what it pays. The user never picks a "product" |
| **4. Checks** | "What exactly counts? Is this price fair? What can I lose? When do I get paid? Can I get out?" | Rules hidden, odds in American format, prices that change at submit, unclear refunds | Four numbers always visible, rules one tap away, our odds next to the venues' and the naive product, a live exit price |
| **5. Commit** | "Fast. Don't make me fill a form." | Multi-step wallets, fill-or-kill rejections, requotes | One deliberate gesture, a frozen quote with a visible timer, the stake remembered |
| **6. Ride** | "Deal happened! Two to go. Where's NVDA vs $240?" | Positions shown as tokens or numbers, not as a story in progress | A leg tracker: each event ticked, the stock's distance to the strike, today's exit price, "what happens next" |
| **7. Exit** | "Take profit? Hold to Friday? The world broke: do I get my money back?" | Retail holds earnings trades about two weeks too long; refunds and redemptions are unclear | Prompt at the right moment ("Your event resolved: cash out at $X or hold to Friday"); automatic, neutral refunds; one-tap redeem |

### Where they start (entry points, in order of evidence)

1. **A catalyst coming up.** Earnings, FOMC, CPI, elections, court rulings, FDA dates. This is the strongest evidence of all. probabl already has a catalyst calendar, which is the right foundation.
2. **A stock they hold or watch.** "What could move NVDA this month?" The catalyst trader starts from the ticker.
3. **An event they already follow or hold.** "I'm long the trade deal on Polymarket: what does it do to NVDA?" The prediction-market pro starts from the event.
4. **A ready-made story.** Curated or popular worlds. Every operator that succeeded with combos launched curated ones first (Robinhood's preset combos came a month before custom ones; FanDuel's Parlay Hub; DraftKings' Quick SGP).
5. **A shared link.** 61% of investors under 35 use influencer recommendations ([FINRA Foundation 2026](https://finrafoundation.org/sites/finrafoundation/files/2026-03/FINRA_Foundation_Research_Brief_Social_Media_Finfluencers.pdf)), and Kalshi's ratings fell when it removed combo sharing ([mwm.ai](https://mwm.ai/articles/app-updates/kalshi-v9-9-113-ui-overhaul-feature-removal-and-chart-changes-spark-backlash-in-august-2026), *(unverified)*).

### The ten-second check a pro runs

Before any trade, a pro answers six questions, usually in this order:
1. **What exactly counts?** The rules before the price ([Domer](https://www.chinatalk.media/p/prediction-markets-101)). Does the event have to *happen* or be *announced* by the date? Who decides? Polymarket's resolution disputes in 2026 (1,150+ disputed markets, lawsuits over the Strategy BTC market) make this the first question, not the last.
2. **Is the price fair?** Their number against ours, and ours against the venues' and the naive product of the legs. They will compute it themselves and assume the house is skimming.
3. **What does it cost me?** The spread and fee in dollars. "A 3-point edge disappears after fees."
4. **How much, and how long?** The size they can get at this price, and how long the money is locked. Kalshi and Polymarket now pay 3.25–4% on positions, so a refunded stake that earned nothing has a visible cost.
5. **Can I get out?** The bid, at their size.
6. **What do I win and lose?**

Story builders skip to question 6. That is exactly why question 6 must carry the chance at equal weight (§4).

---

## 4. How they read numbers, and where they go wrong

### Each group's native format

| Group | Reads | Example |
|---|---|---|
| Prediction-market pro | cents as probability | "YES 35¢" |
| Story builder | payout and multiple | "$20 → $1,538, 77×" |
| Catalyst trader | % chance, max loss, expected move | "1.3% chance, max loss $20, NVDA's expected move ±6%" |

One screen has to serve all three, so every world shows: the dollars, the multiple, the chance and the date. Never American odds: in a trial with over 4,000 US adults, American odds pushed people into riskier bets, and readers put a 4%-chance parlay at 53% on average ([BIT 2025](https://www.bi.team/blogs/american-odds-lead-to-riskier-sports-betting/)). The CFTC's staff warned against them in August 2026.

### The four traps worlds fall into

1. **Joint chances feel bigger than they are.**
   - In Tversky & Kahneman's studies, 85% judged "bank teller and feminist" likelier than "bank teller." Professional forecasters rated a detailed two-part scenario 3.4× likelier than one of its own parts.
   - People overestimate "all of these happen" and underestimate "at least one fails" ([Bar-Hillel 1973](https://cris.huji.ac.il/en/publications/on-the-subjective-probability-of-compound-events/)).
   - A world is "all of these happen."
2. **Building a story makes it feel likelier.** Imagining an outcome raises its felt probability, and later behaviour too (Carroll 1978; Gregory, Cialdini & Carpenter 1982). Giving a world a vivid name and narrative will inflate how likely it feels. The UI must use the story to attract and the numbers to inform.
3. **Parlay players are the most overoptimistic bettors, and history doesn't fix it.**
   - Bettors with more money on parlays were 18¢ per dollar more overoptimistic ([Brown, Grasley & Guido 2026](https://mattbrownecon.github.io/assets/papers/jmp/sportsbetting.pdf)).
   - Showing them their past results didn't help: "they just thought the future would be different."
   - The correction has to sit **on the bet, at the moment of the bet**, not on a history page.
4. **"If" is read two ways.**
   - About half of people read "if A then B" as the chance of B given A, and most of the rest as the chance of A and B together ([Evans, Handley & Over 2003](https://dro.dur.ac.uk/2900)).
   - A conditional payout headline will be misread by half the audience unless both numbers are shown: the chance the world happens, and the chance of the stock condition inside it.

### What fixes it (the strongest evidence in this report)

- **Walk the conjunction step by step on a fixed base of 1,000.** Asking for each part's frequency first, then "how many of the 100…", cut conjunction errors from 65% to 11% (T&K 1983). Natural frequencies roughly sextuple correct answers on conditional-probability problems (about 4% → 24%; McDowell & Jacobs 2017).
- **One denominator, never "1 in X."** "1 in 77" feels likelier than "13 in 1,000," the "1-in-X effect" ([Pighin et al.](https://jfbonnefon.github.io/publication/mdm11/mdm11.pdf)). Keep the same denominator across the whole screen (Spiegelhalter's group).
- **A grid of 1,000 dots for small chances.** Icon arrays help readers at every level of numeracy ([Galesic et al. 2009](https://pmc.ncbi.nlm.nih.gov/articles/PMC2775772)). Use them where a chance is under about 5%.
- **An outcome table, not a payoff diagram.** Payoff diagrams hide the chance of losing; adding the probabilities made investors judge a structured product "much more critically" ([Anic & Wallmeier 2019](https://www.unifr.ch/finance/assets/public/documents/articles/jbf19.pdf)). A row per outcome with dollars, chance and date is both clearer and more honest.
- **House-edge framing for the cost.** "On average, bets like this cost about 7¢ per dollar" was understood by 66.5% of gamblers, against 45.6% for return-to-player framing ([Newall et al. 2020](https://onlinelibrary.wiley.com/doi/full/10.1111/add.14954)).
- **Say "in worlds where," never "because."** Our NVDA-in-the-world price is evidential, not causal. "In worlds where the deal happens, NVDA averages $231," not "the deal will push NVDA to $231."

### The correlation surprise

When legs tend to happen together, our chance (2.8%) is *higher* than multiplying the venues' odds (1.6%). So our payout is *lower* than a naive calculator shows, the same complaint same-game-parlay bettors have. It needs a one-line reason every time: "These tend to happen together: in worlds with a trade deal, the S-1 is 19% likely, against 15% overall." That line also proves that the model knows something: it is probabl's insight, shown.

---

## 5. Principles for a zero-effort experience

Each comes from the evidence above.

1. **Start from what they believe, not from a product.** The user says "if this, then that"; the app picks the bundle (Robinhood's strategy builder starts from an outlook, OptionStrat from a target price).
2. **Curated first, custom second.** Featured worlds on day one; building one is a step down, never the front door. No flow deeper than two levels of disclosure (NN/g).
3. **One story, one sentence, everywhere.** Every world reads as a sentence: "If the trade deal, Anthropic's S-1 and OpenAI's GPU order all happen, NVDA closes at or above $240 on Dec 1." Cards, tickets, receipts and positions all use the same sentence.
4. **Four numbers, equal weight, always visible:**
   - what you pay (= the most you can lose);
   - what you get if right, in dollars and as a multiple;
   - the chance, as "N in 1,000";
   - when money comes back.
5. **Show the shrinking chain, not one number.** 1,000 → 350 → 65 → 28 → 10. The chain is the explanation of the product and its honesty in one line.
6. **Outcome cards, not charts.** Every possible ending with its dollars, chance and date. Charts are for the curious, one tap down.
7. **Live payout on every tap.** Indicative while building, firm at review, with the quote frozen for its lifetime and a visible timer. A requote shows old → new and asks again.
8. **Rules one tap from every leg.** The venue, the exact deadline wording ("happens" or "announced"), the resolution source, and what a cancelled or 50/50 result does to the world.
9. **Prices in their units, cost in dollars:** "YES 35¢" for each leg, the world in cents and as N in 1,000, and the spread and fee in plain dollars.
10. **The position is a story in progress:** ✓ / ● / ✗ per event, the stock's distance to the strike, the live exit price next to its fair value, and "what happens next."
11. **Calm, not casino:** no flashing prices, confetti, streaks, points or boosts that grow with each added leg. The FCA found flashing prices cut attention to key information by 10%. Massachusetts made Robinhood drop confetti.
12. **Shareable, with terms attached:** a world card that carries the sentence, chance and payout, opening to the world's outcome card. It shares the idea, not a screenshot of a win.
13. **Price before sign-in:** anyone can explore and price a world before the invite gate; ask for the wallet at commit (Duolingo's lesson-before-signup pattern).

---

## 6. The building blocks every option shares

All three options in §7 are arrangements of the same seven components, shown with the worked example from the plan:
- **Legs:** a US–China trade deal by Nov 30 (35%), Anthropic files its S-1 (15%), OpenAI announces a GPU order (30%), all YES.
- **The stock:** NVDA at $209, fixing at the Dec 1 close.

The numbers come from the keeper's model at a latent correlation of 0.146. Prices are illustrative.

### 6.1 The world card (the unit of the product)

```
┌──────────────────────────────────────────────┐
│ AI super-month                     ⏱ Dec 1   │
│ Trade deal · Anthropic S-1 · OpenAI GPUs     │
│ → NVDA ≥ $240                                │
│                                              │
│  $20 → $1,538      77×      10 in 1,000      │
│                                              │
│  Polymarket 35¢ · Kalshi 15¢ · Polymarket 30¢│
└──────────────────────────────────────────────┘
```

- Story name, legs as chips, the stock condition, the date: the sentence in compact form.
- The three numbers in one row, equal size: dollars, multiple, chance.
- Leg prices in the pros' units, with venue badges.
- The same card is the share card and the open-graph image.

### 6.2 The chance chain (the explanation)

```
How likely is this world?
1,000 worlds
 └ 350  have the trade deal          (Polymarket 35%)
    └ 65  also get Anthropic's S-1   (19% given the deal · 15% alone)
       └ 28  also get OpenAI's GPUs  (43% given both)
          └ 10  also see NVDA ≥ $240 on Dec 1   (37% in this world)
If the events were unrelated: 350 → 52 → 16 → 6
```

- It shows each step on the same base. This is the sequence that cut conjunction errors from 65% to 11%.
- It shows where correlation enters ("19% given the deal · 15% alone") and why our chance differs from the naive one.
- A 1,000-dot grid can sit beside it, with 10 dots lit.
- Tapping a step opens that event's rules and venue.

### 6.3 The outcome card (replaces the payoff diagram)

For the conditional payout, "$100 if the world happens, pays if NVDA ≥ $240; otherwise money back":

```
How this can end                     chance     you get       when
World happens, NVDA ≥ $240          10 in 1,000   $250        Dec 1
World happens, NVDA < $240          18 in 1,000   $0          Dec 1
Any event doesn't happen           972 in 1,000   $100 back   when it fails (by Nov 30)
```

For the world bet ("$20 on all three and NVDA ≥ $240"):

```
All three happen and NVDA ≥ $240    10 in 1,000   $1,538      Dec 1
Anything else                      990 in 1,000   $0          —
```

- Every row reads as a sentence, and the rows add up to 1,000.
- The disjunctive row ("any event doesn't happen") is shown, which corrects the "at least one fails" underestimate.
- A refund is a neutral row, never a "win."

### 6.4 The ticket (a bottom sheet)

```
┌──────────────────────────────────────────────┐
│ If all 3 happen, NVDA closes ≥ [$240 ▾] Dec 1│
│                                              │
│ ( ) Bet it all happens  →  $20 wins $1,538   │
│ (•) Money back if it doesn't → $100 gets $250│
│                                              │
│ Stake  [$10] [$25] [$100] [custom]           │
│                                              │
│ You pay      $100   (most you can lose)      │
│ If right     $250   2.5×                     │
│ Chance       10 in 1,000 world & ≥ $240      │
│              972 in 1,000 you get $100 back  │
│ Paid         Dec 1 · refund as soon as a     │
│              leg fails                       │
│ Cost         $0.25 spread + $1.00 fee *      │
│                                              │
│ Quote holds 8s          ━━━━━━━━━ slide to buy│
└──────────────────────────────────────────────┘
```

- **\* The fee line shows a problem.** The book's 1% fee is charged on the whole $100, including the $97 or so that is expected to come back. That is $1.00 against about $2.80 actually at risk (§13, decision 7).
- **The belief sentence is the header, with the strike as an editable chip.** The two products are two sentences, not two jargon names. This is the plan's §11 rule, kept.
- **The four numbers stay in fixed places.** The chance line for the money-back product shows *both* numbers (the half who read "if" as joint and the half who read it as conditional both see their number).
- **Stake chips are small,** remember the last stake, and allow a target-payout mode ("I want $500 if right").
- **The slide gesture commits.** The quote freezes for its lifetime, with a timer; a requote shows old → new.
- **Below 10 in 1,000, one extra line:** "This pays only if all 3 happen and NVDA ends above $240: about 10 in 1,000 worlds."

### 6.5 The rules drawer (one per leg)

- The question as the venue words it, its venue (Polymarket or Kalshi) with a link, and the exact deadline wording.
- The resolution source, and any dispute or clarification status.
- What happens to the world if this leg is cancelled or resolves 50/50: "The world counts as not happening; money-back stakes are refunded."
- The live venue price and its spread; "venues disagree" when two list it.

### 6.6 The position (a leg tracker)

```
AI super-month · Money back · $100
 ✓ Trade deal — happened Nov 18
 ● Anthropic S-1 — open · venue 41% (was 15%)
 ● OpenAI GPU order — open · venue 52%
 ◷ NVDA $236.40 → needs ≥ $240 on Dec 1 (1.5% away)

Now: about 200 in 1,000 this pays $250 · otherwise $100 back
Cash out now: $118   (fair $122)
What's next: S-1 deadline Nov 30. If it doesn't file, your $100 comes back that day.
```

- Each event shows ✓ happened, ● open (with today's venue odds) or ✗ didn't happen.
- The stock leg shows the distance to the strike and the time left.
- The live exit price next to its fair value, and one sentence on what happens next.
- Factual, opt-in notifications only for the things the user asked about: a leg resolved, the fixing day. Never price swings, and no "one away!" hype.

### 6.7 The receipt and share card

- The sentence, the stake, the four numbers and the leg sources, as an image and a link.
- The link opens the world's outcome card with "Price this world." It loads the idea, not a one-tap copy of someone's bet, which limits herding (the OSC found social feeds and copy trading raised trading in promoted names by 12–18%).

---

## 7. Three ways to present the product

### Option A: "What's coming" (a catalyst feed of curated worlds)

**The idea:** the home tab for worlds is a timeline of upcoming catalysts. Each catalyst holds a few curated worlds, written as stories. You browse what's coming, tap the story that matches your view, adjust one thing, and trade.

**Who it serves best:** catalyst traders and story builders; every new user. Pros use it to spot what's live.

```
Worlds                                    [This week ▾]  [My stocks]
──────────────────────────────────────────────────────────────────
THU · CPI (Nov 13)
  ┌ Soft landing ─────────────────────┐ ┌ Hot CPI, Fed hikes ────────┐
  │ CPI ≤ 2.6% · Fed holds Dec         │ │ CPI ≥ 3.0% · Fed hikes Dec │
  │ → IWM ≥ $240 Dec 12                │ │ → IWM < $220 Dec 12        │
  │ $20 → $260 · 13× · 75 in 1,000     │ │ $20 → $610 · 30× · 30/1,000│
  └────────────────────────────────────┘ └────────────────────────────┘
WED · NVDA earnings (Nov 19)
  ┌ Beat and raise ───────────────────┐ ┌ Sell the news ─────────────┐
  │ Data-centre rev ≥ $X (Kalshi)      │ │ Beat · NVDA < $200 Fri     │
  │ → NVDA ≥ $225 Fri                  │ │                            │
  └────────────────────────────────────┘ └────────────────────────────┘
NOV 30 · AI super-month
  ┌ Trade deal · Anthropic S-1 · OpenAI GPUs → NVDA ≥ $240 Dec 1 ┐
  │ $20 → $1,538 · 77× · 10 in 1,000                               │
  └────────────────────────────────────────────────────────────────┘
```

*(The CPI and earnings worlds, and their numbers, are made up for layout.)*

**The flow:**
1. Browse catalysts. The "My stocks" filter shows only worlds on stocks you hold or watch.
2. Tap a world. The world page shows the sentence, the chance chain, the outcome card and the legs' rules.
3. Adjust one thing: the strike chip, swap one leg, or flip a leg's side ("what if the Fed hikes instead?").
4. The ticket slides up: choose "bet it all happens" or "money back if it doesn't," set the stake, slide.

**Why it works:**
- It starts where ideas start: the calendar is where catalyst traders live, and probabl already has one.
- Curated-first is what made combos take off at Robinhood, FanDuel and DraftKings.
- Every card shows the three numbers, so browsing teaches the product.
- It is the least effort of the three: a tap and a slide.
- Story names make worlds memorable and shareable.

**Risks and mitigations:**
- **Stories inflate felt probability.** Every card carries "N in 1,000" at equal size, and the world page leads with the chain.
- **Curated worlds may not match a pro's view.** "Swap a leg" and "+ World" (Option C) cover it.
- **Curation takes work every week.** The curate-worlds job and its config already create the books. Add a weekly editorial pass, which can be assisted later by the relation job.

**Fit with today's app:** the strongest of the three. It reuses the event calendar, the market tabs (a "Worlds" tab), the home banner and the event card styling. It needs only curated books, which the backend already supports.

### Option B: "Say what you think" (the thesis builder)

**The idea:** a sentence with blanks is the whole interface. "If [events] happen, [stock] closes [above] [$240] on [date]." Each blank is a chip: tap to fill from suggestions, or type. The app answers with two or three ways to trade it, ranked by chance and payout, OptionStrat-style.

**Who it serves best:** catalyst traders with a specific thesis; pros building a world nobody curated.

```
If  [ US–China trade deal ✓ ] [ + add an event ]
    happens,
    [ NVDA ▾ ]  closes  [ above ▾ ]  [ $240 ▾ ]  on  [ Dec 1 ▾ ]

Suggested events that move NVDA:   Anthropic S-1 (+2%) · OpenAI GPU order (+5%)
                                   · Export curbs lifted (+4%)

Ways to trade it                         chance       pays
  Money back if no deal  $100 → $210     in-world 48%  refund 650/1,000
  Bet both happen        $20 → $96       4.8×          170 in 1,000
  Just the deal (Polymarket YES 35¢)     $20 → $57     350 in 1,000
──────────────────────────────────────────────
  More return ←──────●──────→ More chance
```

*(Numbers are illustrative for a one-leg world.)*

**The flow:**
1. Start from a stock ("what moves NVDA?"), from an event ("+ Add to a world"), or by typing a sentence. Natural-language parsing is the Phase 2 assistant (the user skipped it for now). Chips and suggestions work without it.
2. Suggestions rank events by how much they move the stock (the gaps), and flag contradictions and duplicates as they're added ("these can't both happen").
3. The answer is a ranked list of outcome-card summaries, with one control: a slider from "more return" to "more chance." It moves the strike and the leg count.
4. Tap one, and the ticket slides up.

**Why it works:**
- It removes the translation step completely: the user states the view and the app finds the instrument. That is the pain catalyst traders describe most ("right but lost").
- "Chance versus multiple" is the trade-off traders already use (OptionStrat's optimizer, delta as "probability").
- Defaulting the strike to the options-implied move gives a sensible start ("very bullish" = twice the expected move).
- It works for any world, not just curated ones, and leads naturally into the Phase 2 builder.

**Risks and mitigations:**
- **A blank sentence is a blank page for newcomers.** Always start it filled from context: the stock page, the event card, or a curated world. Never start empty.
- **More choices can overload** (Chernev et al. 2015: complex sets and unclear preferences, both true here). Show at most three ways to trade, with one recommended.
- **The slider invites piling on legs for payout.** It never adds legs beyond three by default, and the chance line stays prominent.
- **Building a custom world needs a book.** Curated books exist today; user-made books are Phase 2 (created in their first fill). Until then, the builder can only offer worlds that exist, or that the market admin creates on request.

**Fit with today's app:** medium. It reuses the stock pages, event search and the ticket. The suggestions need the per-event gaps that the fit already produces (§11).

### Option C: "+ World" (a world slip that follows you)

**The idea:** a sportsbook bet slip for worlds. Every event card and every stock page gains a "+ World" button. Tapping it adds the leg (or the stock condition) to a slip docked at the bottom of the screen. The slip reprices live and shows the chain as it grows. Open it to review and trade.

**Who it serves best:** prediction-market pros (they browse events and know what they think of each); story builders who build by accumulating.

```
… browsing markets …
┌ Will the US and China sign a trade deal by Nov 30? ────────┐
│ YES 35¢   NO 66¢          [ + World: YES ]  [ + World: NO ] │
└─────────────────────────────────────────────────────────────┘
┌ Will Anthropic file an S-1 by Nov 30? ──────────────────────┐
│ YES 15¢   NO 86¢          [ + World: YES ]  [ + World: NO ] │
└─────────────────────────────────────────────────────────────┘

╔═ Your world · 2 events ════════════════════════════════════╗
║ Trade deal YES · Anthropic S-1 YES   + add NVDA condition   ║
║ 65 in 1,000 (if unrelated 52) · $20 → $290 · 14.5×   Open ▲ ║
╚═════════════════════════════════════════════════════════════╝
```

**The flow:**
1. Browse events as today. "+ World: YES/NO" adds a leg; the slip appears.
2. The slip reprices on every add, showing the chain and our chance against the naive product. It warns on contradictions ("these can't both happen: remove one to keep building").
3. "Add a stock condition" offers the stocks these events move most, with a strike default.
4. Open the slip: the world page and the ticket, the same components as Options A and B.

**Why it works:**
- It's the pattern a hundred million sports bettors already know. Building happens where the events are, not in a separate tool.
- The live reprice on every add is what makes builders feel effortless (Polymarket's climbing multiplier, FanDuel's slip).
- It serves the pro's natural path: they arrive from an event they hold or follow.
- It doubles as the entry for Option B's sentence: the slip's contents *are* the sentence.

**Risks and mitigations:**
- **It encourages adding legs** (Kalshi's median combo is about 6 legs; the 11+ leg combos are 47% of notional). Cap at six legs. Show each added leg's effect on the chance ("−73% chance, +4× payout"). Never boost payouts for more legs. Default the guidance to 2–3 legs.
- **Without a stock condition, it's just a combo.** That's allowed (event-only worlds), but the slip should invite the stock condition, since that is what's unique to probabl.
- **As with Option B, an arbitrary combination needs a book.** Phase 2 again. Before then, the slip can match the legs to existing books, or say "This world isn't trading yet."

**Fit with today's app:** good. It reuses the event cards and the market list; a docked bottom element is new.

### A fourth surface, later: the pro view

A dense view for the pro and the quant, in the way Kalshi Pro sits apart from Kalshi's app:
- a book's full outcome grid (every strike bucket, in and out of the world), with bid, ask and fair per product;
- our chance against the naive product, and the size available at each price;
- keyboard entry and API links.

It keeps the main app simple without failing the pros. It is not a v2.0 need: the API already serves the data.

### Side by side

| | A: Catalyst feed | B: Thesis builder | C: World slip |
|---|---|---|---|
| Effort to understand | Lowest: tap a story | Medium: a sentence to fill | Low for sports or prediction-market users, medium for others |
| Speed for a pro with a view | Medium | High | High |
| Teaches the product while browsing | Yes, every card | Yes, with the "ways to trade" list | Partly |
| Risk of overoptimism | Story inflation | Slider gaming | Leg stacking |
| Needs user-made books | No | For custom worlds | For arbitrary slips |
| Reuses today's app | Calendar, tabs, banner, cards | Stock pages, search, ticket | Event cards, market list |
| Build effort | Low | Medium (Phase 2 for full form) | Medium |

---

## 8. Recommendation

**Use all three, each where it fits, on one set of components:**

1. **Front door = Option A.** The Worlds tab and home banner show "what's coming," with curated worlds grouped by catalyst and filterable to "my stocks." This is what v2.0 can ship with curated books only, and it is the lowest-effort path to a first trade.
2. **The sentence from Option B is the language everywhere.** Every world card, world page, ticket, receipt and position reads as the same "If … then …" sentence. On the world page, the sentence's chips are editable (strike, side, swap a leg), which gives Option B's flexibility within existing books. The full builder (blank sentence, any events, typed input) arrives with Phase 2's user-made books.
3. **"+ World" from Option C is the universal gesture.** It appears on every event card and stock page from v2.1, feeding the same world page. Until user-made books exist, it matches the slip to existing worlds ("2 worlds use these events").
4. **The pro view comes later,** after real pro traffic shows what they look at.

**Why this combination:**
- It meets each archetype at its entry point: the catalyst trader at the calendar and their stock, the pro at the event, the story builder at the curated story.
- It keeps one mental model (a world is a sentence; trading it is a slide) and one set of numbers across all three doors.

**Order of work** (UI only; the backend exists):

| Release | Ships | Needs |
|---|---|---|
| v2.0 | Worlds tab (Option A), world page (sentence, chain, outcome card, rules), ticket, positions (leg tracker), receipts and share cards | Curated books, plus the small backend additions in §11 |
| v2.1 | "+ World" on event cards and stock pages, matched to existing worlds; editable sentence chips on the world page | §11's suggestion endpoint |
| Phase 2 | The full thesis builder with any events and typed input; worlds from the slip created in their first fill | User-made books, the leg search and the assistant (plan §9–10) |

---

## 9. Naming and copy

### "World": keep it, define it, test it

**For:**
- It is how forecasters already speak ("in worlds where the deal happens…").
- It pairs naturally with the natural-frequency format the evidence favours: "10 in 1,000 worlds."
- It is distinctive. "Combo" and "parlay" are the trade press's words for products now under regulatory fire: Pennsylvania and Ohio bills target parlays, and a Connecticut judge said parlays have "no independent financial, economic, or commercial consequence."

**Against:**
- It is vivid, which feeds the "imagining makes it likely" effect.
- It can sound like gaming jargon.

**Recommendation:**
- Keep "World" as the noun, defined on first contact: "A world is a set of real events that all happen."
- Describe the category as "scenario trading" where a serious tone helps (landing page, press).
- Never call a world a parlay. Explain it to pros in their words: "a combo of real Polymarket and Kalshi events, plus a stock condition."
- No study compares these words, so run the five-second test in §12 on "world" against "scenario."

### The two products: sentences, not names

Users choose between two beliefs, so label the choice with the beliefs:

| Today's plan name | Label in the ticket | Short name (cards, positions) |
|---|---|---|
| World bet | "Bet it all happens" | **All-in** |
| Conditional payout | "If it happens, I want NVDA ≥ $240. Otherwise, my money back." | **Money-back** |
| Event-only world | "Bet these all happen" | **All-in** (no stock) |

"Money-back" carries the refund, the product's best feature for the risk-averse, in the name itself. It works the way parlay insurance and PrizePicks' Flex play reassure users. The short names are proposals; test them with the rest.

### Vocabulary by audience

| Use | With |
|---|---|
| YES/NO, ¢, implied %, bid/ask, cash out, resolves, rules, venue | everyone; the pros' native terms |
| "closes above $240 on Dec 1," "Friday close," "expected move" | catalyst traders (options habits) |
| "$20 → $1,538," "77×" | story builders, always next to the chance |
| "in worlds where…," "N in 1,000," "these tend to happen together" | every probability statement |

**Never use:**
- "guaranteed," "risk-free" (the CFTC advisory names "risk-free" promotions);
- "free money," "jackpot," "lock";
- American odds;
- "because" for our correlations.

---

## 10. Guardrails: honest without killing the fun

The evidence is clear on two points:
- Combos drive volume, and their buyers lose the most.
- The corrections that work sit on the bet itself, not on history pages.

The guardrails below keep the fun (the story, the multiple, the live payout, sharing) and put the truth beside it:

1. **Equal prominence:** the chance is the same size as the payout, everywhere a payout appears.
2. **The chain on every world page,** with "if unrelated" next to ours.
3. **The cost in dollars,** on the ticket and the receipt: spread plus fee. Optionally in house-edge form: "worlds like this return about 93¢ per $1 on average."
4. **No rewards for piling on legs:** no leg-count boosts, a six-leg cap, and default guidance of 2–3. Never feature a world under 10 in 1,000 (Kalshi drew criticism for promoting 11- and 30-leg combos).
5. **A confirm line under 10 in 1,000:** "This pays only if all 3 happen and NVDA ends above $240: about 10 in 1,000."
6. **Neutral refunds:** "$100 returned," never a celebration. No confetti, points or streaks, and no celebration of losses disguised as wins (the UK Gambling Commission banned these).
7. **Honest cash-out:** the bid next to the fair value, and no "lock it in!" prompts in a swing. Simply offering cash-out made bets up to 35% larger in experiments (Bennett et al. 2024).
8. **Notifications are factual and opt-in.** Pennsylvania's bill would ban betting push notifications altogether.
9. **Limits from day one:** per-member stake caps (already in the API) and an optional self-set limit and cool-off.
10. **An optional "guess first" nudge:** before showing the chance, let users guess it, then show the gap. It turns the conjunction fallacy into a moment of learning, and pros will enjoy beating it.

Several of these are also a commercial advantage. The pros already assume combo pricing is rigged. Showing our chance, the venues' prices and our margin in plain sight is a differentiator no sportsbook-style combo offers.

---

## 11. What the backend needs for this UI

Most of what the UI needs already exists in the keeper's model and the API. These are small additions, all derivable from data we hold:

| UI element | Needs | Status |
|---|---|---|
| Chance chain | Each step's probability given the earlier legs (and the "if unrelated" chain) | The keeper's joint distribution has every leg outcome; add the sequential conditionals to its indications or the book view |
| "These tend to happen together" lines | Per pair: P(B given A) against P(B) | From the same joint distribution |
| Outcome card counts | Every product's chance in and out of the world | Have: atom probabilities; expose as "N in 1,000" |
| Sibling worlds (optional) | The chance of every combination of the legs | From the joint distribution (2ⁿ outcomes, at most 64) |
| Exit price vs fair | Bid and mid per held product | Have: indications carry marks and bids; add the mid per position |
| Strike default | The options-implied or volatility-implied move to the fixing | Have: the fixing volatility; expose "expected move ±x%" |
| "Events that move NVDA" suggestions | Each event's gap on a stock | Have: `world_gaps`; add a read route |
| Money-back date | The earliest date a leg can fail and the latest leg deadline | Have: legs' end times; compute per book |
| Quote timer | The quote's expiry | Have: firm quotes carry `expiry` (10 s by default) |
| Share card and OG image | A rendered card per world | New: render in the web worker, as the og:video work did |

None of this changes the pricing; it exposes what the model already knows. It should be specified with the UI designs, then built in one pass.

---

## 12. How to validate before building it all

Run quick tests on clickable prototypes, with 5–8 people per archetype: catalyst traders, prediction-market traders and combo players.

1. **The five-second test.** Show one world card for five seconds, then ask "What does this pay, and when?" Run it for "world" against "scenario" and for "All-in / Money-back" against alternatives. Target: 80% can say what the card is.
2. **The comprehension check.** After the ticket, ask for:
   - the most they can lose;
   - what they get if right;
   - the chance;
   - when money comes back;
   - for Money-back, what happens if one event fails.

   Target: 80% get all five right without help. If the chance is the one they miss, the chain or the grid isn't working.
3. **The calibration check.** Before and after the chain, ask "how likely is this world?" Their guesses should move toward ours: we want the chain to correct, not decorate.
4. **The task test.** Ask each archetype to do its own task:
   - catalyst trader: "trade your view on next week's CPI";
   - prediction-market pro: "you're long the trade deal; express its effect on NVDA";
   - story builder: "find a world you like for $20".

   Measure time to a priced ticket, and where people hesitate.
5. **Live metrics after launch:**
   - comprehension (an optional one-question check on the first trade);
   - the share of first trades that are Money-back;
   - average legs per world;
   - cash-out timing;
   - complaints about rules or resolution;
   - repeat rate after a refund.

---

## 13. Decisions for you

1. **Yield on money-back stakes.** About 97% of Money-back stakes come straight back, but they're locked until a leg fails. Kalshi and Polymarket pay 3.25–4% on positions, and futarchy users cite capital lock-up as the main reason not to take part. Should locked stakes earn the vault's idle yield?
2. **Our margin, shown how?** In dollars on the ticket (recommended), as house-edge copy, or both?
3. **Explore before sign-in.** Should anyone be able to price worlds before the invite gate (recommended), with the wallet asked only at commit?
4. **Sharing and copying.** Share cards that open the outcome card (recommended) or one-tap copy? The latter raises engagement and herding alike.
5. **Default leg count.** Curate 1–3-leg worlds only at launch (recommended), or allow up to six in curated worlds too?
6. **Names.** "World," "All-in" and "Money-back" go into the five-second test, or another shortlist?
7. **The fee on Money-back stakes (found while writing this report).**
   - `WorldBooks` charges the book's fee on the whole price, refund units included.
   - On a $100 Money-back trade at 1%, that is $1.00 against about $2.80 actually at risk, roughly a 36% charge on the bet inside the world. It makes the product the research favours for cautious users the most expensive one.
   - **Options:** charge the fee on the price net of the refund units' face value, give refund units their own lower rate, or price Money-back books with a lower fee.
   - Any of these is a contracts change, best made before deployment.

---

## 14. Sources

**Prediction-market traders**
- Gómez-Cram, Guo, Jensen & Kung (2026), skill concentration on Polymarket: [Yale Insights](https://insights.som.yale.edu/insights/wisdom-of-the-few-prediction-markets-are-driven-by-small-number-of-skilled-traders), [SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6617059)
- Bürgi, Deng & Whelan (2026), Kalshi returns by price: [paper](https://www.karlwhelan.com/Papers/Kalshi.pdf)
- Becker, Kalshi microstructure and the "optimism tax": [jbecker.dev](https://www.jbecker.dev/research/prediction-market-microstructure)
- Arbitrage on Polymarket (IMDEA, AFT 2025): [arXiv](https://arxiv.org/html/2508.03474v1)
- Domer interview: [ChinaTalk](https://www.chinatalk.media/p/prediction-markets-101); podcast: [Risk of Ruin](https://www.buzzsprout.com/1267901/episodes/17230634-betting-on-chaos)
- Full-time traders: [OPB/NPR](https://www.opb.org/article/2026/01/17/how-kalshi-and-polymarket-prediction-market-traders-make-money/), [CNBC](https://www.cnbc.com/2026/08/01/traders-go-full-time-on-prediction-markets-using-ai-bots-and-antennas.html)
- Copy-trading test: [Action Network](https://www.actionnetwork.com/news/is-it-possible-to-beat-polymarket-reddit-user-attempts-10-different-trading-strategies)
- Resolution disputes: [The Block](https://www.theblock.co/news/regulation/2026-07-07-two-traders-sue-polymarket-strategy-bitcoin-sale-407368), [CoinDesk](https://www.coindesk.com/markets/2026/06/02/strategy-sold-bitcoin-in-late-may-and-told-the-market-in-june-here-s-how-polymarket-bettors-are-fighting-over-when-it-counts)
- Yield on positions: [Kalshi](https://help.kalshi.com/navigating-the-exchange/your-portfolio/apy-on-kalshi), [Polymarket](https://docs.polymarket.com/polymarket-learn/trading/holding-rewards)

**Catalyst and options traders**
- de Silva, Smith & So, retail earnings options losses: [MIT Sloan](https://mitsloan.mit.edu/ideas-made-to-matter/retail-investors-lose-big-options-markets-research-shows)
- Bryzgalova, Pavlova & Sikorskaya (JF 2023): [LBS](https://lbsresearch.london.edu/id/eprint/2827/)
- Cboe, 0DTE positioning: [Cboe](https://www.cboe.com/insights/posts/0-dt-es-decoded-positioning-trends-and-market-impact)
- IV crush, "right but lost": [OIC](https://prd-web.optionseducation.org/news/the-crush-is-real), [Paragon Signals](https://buttondown.com/Paragon-Signals/archive/you-were-right-and-still-lost-money/)
- FINRA Foundation, finfluencers: [brief](https://finrafoundation.org/sites/finrafoundation/files/2026-03/FINRA_Foundation_Research_Brief_Social_Media_Finfluencers.pdf)
- Robinhood HOOD Summit 2026 and Q3 2026: [newsroom](https://robinhood.com/newsroom/hood-summit-2026/), [StockTitan](https://www.stocktitan.net/articles/robinhood-q3-2026-earnings-prediction-markets-crypto)
- Election odds and DJT: [Quiver Quant](https://www.quiverquant.com/news/Trump+Media+Stock+%28DJT%29+Linked+to+Election+Odds%3F+Our+Investigation+)
- OptionStrat optimizer: [OptionStrat](https://optionstrat.com/tutorials/strategy-optimizer)

**Combos and parlays**
- Brown, Grasley & Guido (2026), overoptimism and parlays: [paper](https://mattbrownecon.github.io/assets/papers/jmp/sportsbetting.pdf), [Stanford brief](https://ifdm.stanford.edu/sites/g/files/sbiybj30991/files/media/file/the-rise-of-sports-betting-and-the-line-between-entertainment-and-behavioral-bias-4-29.pdf)
- Newall et al., custom bets and harm: [Goldsmiths](https://research.gold.ac.uk/id/eprint/29307)
- Bennett et al. (2024), cash-out raises bet size: [Warwick](https://wrap.warwick.ac.uk/id/eprint/186229/7/bennett-et-al-2024-people-place-larger-bets-when-risky-choices-provide-a-postbet-option-to-cash-out.pdf)
- Kalshi combos economics: [InGame](https://www.ingame.com/kalshi-parlay-taker-losses-top-1b/), [InGame leg counts](https://www.ingame.com/kalshi-longest-parlay-odds/), [LSR](https://www.legalsportsreport.com/258357/kalshi-parlay-volume-surges-but-sports-prediction-economics-still-lag-sportsbooks/), [CNBC](https://www.cnbc.com/2026/10/06/prediction-market-combo-contract-volume.html)
- Polymarket combos: [InGame](https://www.ingame.com/polymarket-us-launches-parlays/); Robinhood combos: [CNBC](https://www.cnbc.com/2025/12/16/robinhood-is-rolling-out-nfl-parlay-and-prop-bets-on-prediction-markets-platform.html), [Covers](https://www.covers.com/industry/robinhood-launches-custom-combos-on-prediction-markets-to-mimic-parlays-jan-16-2026)
- Bet builders: [FanDuel Parlay Hub](https://www.fanduel.com/research/fanduel-parlay-hub-features-new-improved-filters-and-more-parlay-options), [DraftKings boosts](https://sbcamericas.com/2025/01/03/draftkings-subscription-parlay-boosts/)
- Regulation: [Pennsylvania HB 2879](https://www.legalsportsreport.com/284197/bipartisan-bills-would-ban-micro-bets-cap-online-casino-losses-in-pennsylvania/), [CNBC on scrutiny](https://www.cnbc.com/2026/08/14/prediction-markets-scrutiny-mounts-from-regulators-and-banks.html)

**Judgement and risk communication**
- Tversky & Kahneman (1983), the conjunction fallacy: [PDF](https://pages.ucsd.edu/~mckenzie/TverskyKahneman1983PsychRev.pdf)
- Bar-Hillel (1973), compound events: [HUJI](https://cris.huji.ac.il/en/publications/on-the-subjective-probability-of-compound-events/)
- Mellers, Hertwig & Kahneman (2001): [PDF](https://faculty.wharton.upenn.edu/wp-content/uploads/2015/07/2001---do-frequency-representations-eliminate-conjunction-effects.pdf)
- Evans, Handley & Over (2003), reading "if": [Durham](https://dro.dur.ac.uk/2900)
- Galesic et al. (2009), icon arrays: [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2775772)
- The 1-in-X effect: [Pighin et al.](https://jfbonnefon.github.io/publication/mdm11/mdm11.pdf), [Warwick](https://wrap.warwick.ac.uk/91940/)
- Natural frequencies: [Weber et al. citing McDowell & Jacobs](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6194348/)
- Newall et al. (2020), house-edge labels: [Addiction](https://onlinelibrary.wiley.com/doi/full/10.1111/add.14954)
- BIT, American odds trial: [BIT](https://www.bi.team/blogs/american-odds-lead-to-riskier-sports-betting/)
- Anic & Wallmeier (2019), payoff diagrams vs probabilities: [PDF](https://www.unifr.ch/finance/assets/public/documents/articles/jbf19.pdf)
- Fagerlin, Zikmund-Fisher & Ubel, risk communication: [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3218625)

**Scenario and conditional products**
- Pennock on Predictalot: [Freakonomics](https://freakonomics.com/2011/03/a-prediction-market-trading-pit-for-the-digital-age-a-guest-post-from-david-pennock/)
- Decision markets' adoption problems: [LessWrong](https://www.lesswrong.com/posts/bDxqMn3GJEhPeqZey/where-are-all-the-decision-markets), [Optimism futarchy findings](https://gov.optimism.io/t/futarchy-v1-preliminary-findings/10062)
- Metaculus conditional pairs: [EA Forum](https://forum.effectivealtruism.org/posts/qELZknyx8eBg7HskH/metaculus-introduces-new-conditional-pair-forecast-questions)
- Conditional is not causal: [Dynomight](https://dynomight.net/prediction-market-causation)
- Shell scenarios: [Shell](https://www.shell.com/news-and-insights/scenarios/what-are-shell-scenarios/)
- FiveThirtyEight on correlated states: [538](https://fivethirtyeight.com/features/a-users-guide-to-fivethirtyeights-2016-general-election-forecast)

**Interface patterns and regulation**
- Robinhood: [Strategy Builder](https://robinhood.com/us/en/support/articles/about-the-options-strategy-builder), [Simulated Returns](https://www.robinhood.com/us/en/support/articles/simulated-returns/)
- NN/g, progressive disclosure: [NN/g](https://www.nngroup.com/articles/progressive-disclosure/)
- Chernev et al. (2015), choice overload: [Kellogg](https://www.kellogg.northwestern.edu/faculty/research/detail/2015/when-product-assortment-leads-to-choice-overload-a-conceptual)
- FCA, digital engagement practices: [FCA](https://www.fca.org.uk/publications/research-notes/research-note-digital-engagement-practices-trading-apps-experiment)
- OSC, gamification: [Advisor.ca](https://advisor.ca/news/industry-news/worthless-rewards-drive-trading-activity-osc-study/)
- Massachusetts v. Robinhood: [WealthManagement](https://www.wealthmanagement.com/regulation-compliance/robinhood-pays-7-5m-to-settle-massachusetts-gamification-charge)
- UK Gambling Commission design rules: [UKGC](https://www.gamblingcommission.gov.uk/news/article/gambling-commission-announces-package-of-changes-which-make-online-games)
- CFTC on American odds: [Bloomberg](https://www.bloomberg.com/news/articles/2026-08-07/cftc-warns-prediction-markets-against-american-style-casino-odds)
- Baymard, accidental taps: [Baymard](https://baymard.com/blog/handling-accidental-taps-on-touch-devices)
