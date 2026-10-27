"""S5: (a) surprise resolution while trading is live, (b) opening batch auction for delta_0,
(c) JIT routing / pairing residual risk. Equal depth D = 7,143 shares per unit log price (S3).
Run: python3 -I s5_events.py
"""
import math, random

s, h = 100.0, 0.003
k = 2 * (0.01 - h) / 100.0
D = 1 / k
CAP = 1000  # inventory cap in shares ($100k) that bounds any single sweep

def sweep_loss(x):
    """Loss to an arbitrageur who trades a curve mispriced by x (log) down to fair, depth D, cap."""
    e = max(0.0, abs(x) - h)
    q = min(D * e, CAP)
    # integral of (e - u/D) du from 0 to q, times s
    return s * (e * q - q * q / (2 * D))

print("Table S5a: one-off loss when the outcome is announced while the curve still trades")
print("  A (CPMM pair): winning pool is already at Y* (or N*); losing pool's claims and quote are worthless")
print("  B (s-anchored, no p): quotes s_new*y with y = 1+(1-p)delta -> mispriced by (1-p)delta (YES) or p*delta (NO)")
print("  C (delta-curve): exact if p_or updates with s; stale p -> same as B until the p feed updates or trading halts")
print(f"{'delta':>6} {'p':>5} {'A':>6} {'B / C-stale, YES':>18} {'B / C-stale, NO':>17} {'expected':>10} {'C fresh p':>10}")
for dl in (0.02, 0.05, 0.10, 0.20, 0.40):
    for p in (0.2, 0.5, 0.8):
        ly = sweep_loss(math.log(1 + (1 - p) * dl))
        ln = sweep_loss(math.log(1 - p * dl))
        exp_ = p * ly + (1 - p) * ln
        print(f"{dl:>6.0%} {p:>5.1f} {0:>6} {ly:>18,.0f} {ln:>17,.0f} {exp_:>10,.0f} {0:>10}")

print("\nTable S5b: opening batch auction for delta_0 (uniform clearing), then the continuous curve")
print("  n informed bidders with signal noise sd_sig; clearing = precision-weighted mean of signals and the")
print("  curator's prior. Two-leg discovery loss afterwards = p(1-p)*s*kappa*E[err^2], kappa = 3,571 sh/delta.")
kappa = 3571.0
p = 0.5
for prior_sd, label in ((0.04, "small-delta event (prior sd 4%)"), (0.15, "merger/FDA event (prior sd 15%)")):
    print(f"  {label}:")
    for n in (0, 3, 10, 30):
        sig = 0.04
        if n == 0:
            err = prior_sd
        else:
            prec = 1 / prior_sd ** 2 + n / sig ** 2
            err = math.sqrt(1 / prec)
        loss = p * (1 - p) * s * kappa * err ** 2
        print(f"    n={n:>2}: opening error sd {err:6.2%}; expected discovery loss afterwards ${loss:,.0f}")

print("\nTable S5c: JIT routing / pairing. The router fills YES-stock buyers by buying stock on spot and")
print("  splitting; the NO-stock it keeps is an event bet until a NO buyer takes it. Paired flow (one YES")
print("  and one NO buyer) still leaves (Y-N) YES-USD minus p(Y-N) USD: an event bet of size Delta per pair.")
random.seed(3)
s0, p0, delta = 100.0, 0.4, 0.05
Y, N = s0 * (1 + (1 - p0) * delta), s0 * (1 - p0 * delta)
for share_yes in (0.5, 0.6, 0.75):
    days, per_day, size = 21, 50, 3000.0
    sims = 400
    maxI, endI, absI = [], [], []
    for _ in range(sims):
        I = 0.0  # >0: router holds NO-stock (after serving YES buyers); <0 holds YES-stock
        mx, tot = 0.0, 0.0
        for _d in range(days):
            for _t in range(per_day):
                if random.random() < share_yes:
                    I += size / Y
                else:
                    I -= size / N
                mx = max(mx, abs(I))
                tot += abs(I)
        maxI.append(mx)
        endI.append(I)
        absI.append(tot / (days * per_day))
    maxI.sort()
    m_end = sum(abs(x) for x in endI) / sims
    # event exposure of holding I NO-stock: pays N if NO, 0 if YES: sd = I*N*sqrt(p(1-p))
    sd_end = m_end * N * math.sqrt(p0 * (1 - p0))
    print(f"  YES share of buyers {share_yes:.0%}: mean |unmatched| {sum(absI)/sims:,.0f} sh, p95 max "
          f"{maxI[int(.95*sims)]:,.0f} sh, at cutoff {m_end:,.0f} sh -> event P&L sd ${sd_end:,.0f} unhedged;"
          f" stock bought on spot over the event ~${sum(abs(x) for x in endI)/sims*s0:,.0f}+")
pair_exposure = (Y - N)
print(f"  Per perfectly paired share: event exposure Delta = ${pair_exposure:.2f} long YES-USD vs ${p0*pair_exposure:.2f} USD:"
      f" P&L +${(1-p0)*pair_exposure:.2f} if YES, -${p0*pair_exposure:.2f} if NO; hedge = sell {pair_exposure:.0f} YES"
      f" on Polymarket (Polygon) per share")
