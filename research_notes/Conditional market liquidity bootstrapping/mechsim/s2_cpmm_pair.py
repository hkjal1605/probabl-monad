"""S2: split-seeded conditional CPMM pair (MetaDAO-style), static analysis.

LP deposits C dollars, half stock and half USD. Splitting gives the YES pool R/s YES-stock + R YES-USD
and the NO pool R/s NO-stock + R NO-USD with R = C/2: the same capital seeds both branches.
 - Average price impact of a buy of T quote units in a full-range pool with quote reserve R: T/R.
 - Concentrated range [P/(1+r), P(1+r)]: capital efficiency factor 1/(1 - (1+r)^-1/2).
 - LVR (Milionis et al.): l/V = sigma^2/8 for a full-range CPMM; a range position with the same L has
   the same l, so LVR per unit DEPTH is fixed, and per dollar of capital it scales with the factor.
 - With fees gamma and Poisson blocks at rate lam: ARB ~= LVR * P_trade, P_trade = 1/(1+sqrt(2 lam) gamma/sigma).
Run: python3 -I s2_cpmm_pair.py
"""
import math, random

print("Table S2a: average price impact (excl. fees) of one buy, full-range split-seeded pair")
caps = [50e3, 250e3, 1e6, 5e6]
print(f"{'trade':>8} " + " ".join(f"{'C=$'+format(c/1e3,'.0f')+'k':>10}" for c in caps))
for T in [1e3, 1e4, 1e5]:
    row = []
    for C in caps:
        R = C / 2
        row.append(f"{T/R:>10.2%}")
    print(f"{'$'+format(T/1e3,'.0f')+'k':>8} " + " ".join(row))

def factor(r):
    return 1 / (1 - (1 + r) ** -0.5)

print("\nTable S2b: capital for <=1% average impact on a $10k buy (both branches), by range")
target = 0.01
R_need = 1e4 / target  # virtual quote reserve
print(f"{'range':>8} {'factor':>7} {'capital':>11} {'LVR/yr per $ capital (sig=30/45/60%)':>40}")
for r in [None, 0.5, 0.3, 0.2, 0.1, 0.05]:
    f = 1.0 if r is None else factor(r)
    cap = 2 * R_need / f
    lv = [s ** 2 / 8 * f for s in (0.30, 0.45, 0.60)]
    name = "full" if r is None else f"+-{r:.0%}"
    print(f"{name:>8} {f:>7.1f} {'$'+format(cap,',.0f'):>11}   " + "  ".join(f"{x:>8.1%}" for x in lv))

print("\nTable S2c: LVR in $ for the depth above (virtual V_full = $2M per branch pool; today's $ =")
print("p*LVR_YES + (1-p)*LVR_NO = sigma^2/8 * $2M) per year and per 30-day event, no fees")
for sig in (0.30, 0.45, 0.60):
    yr = sig ** 2 / 8 * 2 * R_need
    print(f"  sigma={sig:.0%}: ${yr:,.0f}/yr, ${yr*30/365:,.0f} per 30 days; volume needed at 30 bp fee to "
          f"cover it: ${yr*30/365/0.003:,.0f} per 30 days")

print("\nTable S2d: fraction of LVR that survives fees, P_trade = 1/(1+sqrt(2*lam)*gamma/sigma_sec)")
sec_year_open = 252 * 6.5 * 3600
for sig in (0.30, 0.45, 0.60):
    s_sec = sig * math.sqrt(0.75) / math.sqrt(sec_year_open)  # 75% of variance in open hours
    cells = []
    for dt in (2, 12, 60):
        lam = 1 / dt
        for g in (0.001, 0.003):
            cells.append(1 / (1 + math.sqrt(2 * lam) * g / s_sec))
    print(f"  sigma={sig:.0%}: " + "  ".join(
        f"dt={dt}s,g={g*1e4:.0f}bp:{c:.1%}" for (dt, g), c in zip(
            [(d, gg) for d in (2, 12, 60) for gg in (0.001, 0.003)], cells)))
print("  Overnight/weekend gaps are discrete jumps: block speed does not reduce them (see S4).")

# Range exit: probability that the branch price leaves +-r within 30 days (GBM, sigma 45%).
print("\nTable S2e: probability a concentrated range is exited within a 30-day event (GBM, MC 20k paths)")
random.seed(1)
sig = 0.45
days = 21  # trading days
paths = 20000
for r in (0.05, 0.1, 0.2, 0.3):
    lo, hi = -math.log(1 + r), math.log(1 + r)
    out = 0
    for _ in range(paths):
        x = 0.0
        for _d in range(days):
            x += random.gauss(0, sig / math.sqrt(252))
            if x < lo or x > hi:
                out += 1
                break
    print(f"  +-{r:.0%}: {out/paths:.1%} of events leave the range (zero depth on one side once out)")

# Resolution payoff check: LP payoff equals the winning pool's reserves.
print("\nS2f: resolution payoff check (random trades on both pools, then resolve)")
random.seed(7)
s0, p = 100.0, 0.4
R = 50_000.0
pools = {"YES": [R / s0, R], "NO": [R / s0, R]}  # [stock claims, quote claims]
for _ in range(200):
    leg = random.choice(["YES", "NO"])
    x, y = pools[leg]
    k = x * y
    T = random.uniform(-3000, 3000)  # quote in (+) = buy stock claims
    y2 = y + T
    pools[leg] = [k / y2, y2]
ST = 108.0
for outcome in ("YES", "NO"):
    x, y = pools[outcome]
    lp = x * ST + y  # winning pool reserves become real stock + real USD
    print(f"  {outcome}: winning pool holds {x:,.1f} stock + ${y:,.0f} -> LP worth ${lp:,.0f} at S_T={ST};"
          f" the losing pool's reserves pay 0")
print("  So LP payoff = a CPMM LP position on the winning branch only, started at that branch's seed price.")
