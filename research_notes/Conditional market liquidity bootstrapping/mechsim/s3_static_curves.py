"""S3: static analysis of the oracle-anchored delta-curve, the stock-numeraire LMSR, manipulation and
p-error sensitivity, and a capital comparison at equal depth.

delta-curve (keeper form, services/vault-keeper/src/model.ts):
    delta_hat = anchor - impact * imbalance / inventory   (impact in bps of delta per 1% of inventory)
    Y = s(1 + (1-p) delta_hat),  N = s(1 - p delta_hat)
A YES buy of T dollars moves delta by impact*1e-2*(T/V_s) (V_s = stock inventory in $), so Y moves by
(1-p) of that; average impact is half the move. Half-spread h is added on top.
Run: python3 -I s3_static_curves.py
"""
import math

def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

s, p, h = 100.0, 0.5, 0.003
print("Table S3a: delta-curve average all-in cost (half-spread 30 bp + avg impact) of a YES buy, p=0.5")
print("           vault C (half stock), impact = bps of delta per 1% of stock inventory")
for imp in (10, 25, 50):
    print(f" impact={imp}bp/1%:")
    for C in (50e3, 100e3, 250e3, 1e6):
        Vs = C / 2
        cells = []
        for T in (1e3, 1e4, 1e5):
            if T > Vs:
                cells.append(f"{'n/a (>inv)':>12}")
                continue
            dd = imp * 1e-2 * (T / Vs)
            avg = h + (1 - p) * dd / 2
            cells.append(f"{avg:>12.2%}")
        print(f"   C=${C/1e3:>5.0f}k " + " ".join(cells) + "   (trades $1k / $10k / $100k)")

print("\nS3b: steepest impact that keeps a $10k YES buy <= 1% all-in (h=30bp), and what discovery costs")
print("  discovery loss (today's $) when informed flow moves delta by eps on ONE leg: 0.5*p(1-p)*s*kappa*eps^2,")
print("  kappa = shares per unit of delta. Both legs (buy YES and sell NO) doubles it.")
for C in (50e3, 100e3, 250e3, 1e6):
    Vs = C / 2
    imp_max = 2 * (0.01 - h) / ((1 - p) * 1e-2 * (1e4 / Vs))
    I = Vs / s
    kappa = I / (imp_max * 1e-2)
    costs = [0.5 * p * (1 - p) * s * kappa * e ** 2 for e in (0.01, 0.02, 0.05, 0.10)]
    print(f"  C=${C/1e3:>5.0f}k: impact<= {imp_max:6.1f} bp/1%  kappa={kappa:8.0f} sh/unit delta; one-leg loss for"
          f" eps=1/2/5/10%: " + " / ".join(f"${c:,.0f}" for c in costs))
print("  Note: at a FIXED slippage target the discovery cost does not depend on C (kappa is pinned by the")
print("  $10k/1% target), and it is the same for every mechanism with the same single-leg depth.")

# Equal-depth calibration used across S3/S4: $10k single-leg buy at 1% all-in with h=30 bp.
k_imp = 2 * (0.01 - h) / (1e4 / s)  # marginal log impact per share (avg impact = k*q/2)
D = 1 / k_imp  # shares per unit log price
print(f"\nEqual-depth calibration: k = {k_imp:.2e} per share (avg impact 0.7% on 100 shares), D = {D:,.0f} sh")

print("\nTable S3c: LVR-type losses per 30-day event at that depth (today's $), by risk source")
T_ev = 30 / 365
for sig in (0.30, 0.45, 0.60):
    lvr = 0.5 * sig ** 2 * D * s * T_ev
    print(f"  stock-vol LVR (CPMM pair, no fee), sigma={sig:.0%}: ${lvr:,.0f}")
for dl in (0.02, 0.05, 0.10, 0.20, 0.40):
    # s-anchored curve that learns p: total p variance to resolution = p0(1-p0)
    pl = 0.5 * D * s * dl ** 2 * p * (1 - p)
    print(f"  p-learning LVR (s-anchored, no p oracle), delta={dl:.0%}: ${pl:,.0f} (to full resolution)")
for sd in (0.02, 0.05, 0.20, 0.50):
    dlvr = 0.5 * D * s * p * (1 - p) * sd ** 2 * T_ev
    print(f"  delta-LVR (all mechanisms), sigma_delta={sd:.0%}/sqrt(yr): ${dlvr:,.0f}")
for J in (0.02, 0.05, 0.10):
    print(f"  one delta jump of {J:.0%}: ${0.5*D*s*p*(1-p)*J**2:,.0f}")

print("\nTable S3d: stock-numeraire LMSR (YES-stock vs NO-stock against whole stock), equal depth")
print("  d ln Y/dq = (1-pi)/b  ->  b = (1-pi)/k; worst-case loss b*ln2 stock; expected loss to informed")
print("  traders up to cutoff = b*(H(pi0) - E[H(pi_c)]) with Gaussian-score p, 30-day event, cutoff 1 day before")
b = (1 - p) / k_imp
Tdays, cut = 30.0, 29.0
z0 = 0.0  # p0 = 0.5
# E[H(p_c)] with Z_c ~ N(z0, cut), p_c = Phi(Z_c/sqrt(Tdays-cut))
n = 4000
EH = 0.0
for i in range(n):
    u = (i + 0.5) / n
    # inverse normal by bisection
    lo, hi = -10, 10
    for _ in range(60):
        mid = (lo + hi) / 2
        if phi(mid) < u:
            lo = mid
        else:
            hi = mid
    zc = z0 + math.sqrt(cut) * mid
    pc = phi(zc / math.sqrt(Tdays - cut))
    pc = min(max(pc, 1e-12), 1 - 1e-12)
    EH += -(pc * math.log(pc) + (1 - pc) * math.log(1 - pc)) / n
H0 = math.log(2)
print(f"  b = {b:,.0f} stock; worst case {b*H0:,.0f} stock = ${b*H0*s:,.0f}; expected to cutoff "
      f"{b*(H0-EH):,.0f} stock = ${b*(H0-EH)*s:,.0f}  (E[H(p_c)]={EH:.3f} nats)")
print("  The LMSR loses because it sells event exposure (YES-stock for whole stock); branch-native")
print("  quoting (YES-stock for YES-USD) does not, which is why the exchange's books never need it.")

print("\nTable S3e: p-error sensitivity of the delta-curve: mispricing of BOTH legs = delta*dp (relative)")
print(f"{'delta':>7} " + " ".join(f"{'dp='+str(d):>9}" for d in (0.02, 0.05, 0.10, 0.20)))
for dl in (0.01, 0.03, 0.05, 0.10, 0.20, 0.40):
    print(f"{dl:>7.0%} " + " ".join(f"{dl*d:>9.2%}" for d in (0.02, 0.05, 0.10, 0.20)))
print("  Exploitable only beyond the half-spread (30 bp): needs delta*dp > 0.3%.")
print("  Profit of one p-manipulation (or stale-p) episode at depth D: 0.5*D*s*(delta*dp - h)^2 per leg:")
for dl, dp in ((0.05, 0.10), (0.10, 0.10), (0.20, 0.20), (0.40, 0.20)):
    e = max(0.0, dl * dp - h)
    print(f"    delta={dl:.0%}, dp={dp:.2f}: ${0.5*D*s*e**2:,.0f} per leg")

print("\nTable S3f: s-oracle staleness (delta-curve, full-set direction at depth D)")
sec_open = 252 * 6.5 * 3600
for sig in (0.45,):
    ss = sig * math.sqrt(0.75) / math.sqrt(sec_open)
    for lag in (1, 2, 10, 60, 300):
        e = ss * math.sqrt(lag)
        # expected profit per update of 0.5*D*s*E[(|e|-h)+^2] for e ~ N(0, e^2)
        m = 0.0
        N_ = 4000
        for i in range(N_):
            u = (i + 0.5) / N_
            lo, hi = -10, 10
            for _ in range(50):
                mid = (lo + hi) / 2
                if phi(mid) < u:
                    lo = mid
                else:
                    hi = mid
            x = abs(mid * e)
            m += max(0.0, x - h) ** 2 / N_
        per_day = 0.5 * D * s * m * (6.5 * 3600 / lag)
        print(f"  staleness {lag:>4}s: sd {e:.3%}; expected loss ${per_day:,.2f}/trading day")
print("  Push feed with 0.5% deviation threshold: error up to 0.5% before an update -> each crossing")
print(f"  costs up to 0.5*D*s*(0.5%-0.3%)^2 = ${0.5*D*s*(0.005-h)**2:,.0f}; daily crossings ~ (2.8%/0.5%)^2 ~ 31")

print("\nTable S3g: capital at equal depth (<=1% all-in on a $10k single-leg trade, both branches)")
rows = [
    ("CPMM pair, full range", 2 * 1e4 / 0.007),
    ("CPMM pair, +-30% range", 2 * 1e4 / 0.007 * (1 - 1.3 ** -0.5)),
    ("CPMM pair, +-20% range", 2 * 1e4 / 0.007 * (1 - 1.2 ** -0.5)),
    ("LMSR (stock numeraire), worst-case subsidy", b * H0 * s),
    ("delta-curve / s-anchored curve: deliverable inventory for one $10k fill", 2 * 1e4),
    ("delta-curve with imbalance cap of 5x the trade", 2 * 5e4),
]
for name, c in rows:
    print(f"  {name:<72} ${c:>12,.0f}")
