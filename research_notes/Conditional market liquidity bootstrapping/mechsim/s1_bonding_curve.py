"""S1: a pump.fun-style virtual-reserve CPMM on one branch of an anchored conditional stock.

Setting: s = 100, p = 0.4, true conditional gap delta = 5%  ->  Y* = 103, N* = 98.
The curve sells YES-stock claims (which must be REAL: each one comes from splitting one stock)
against YES-USD with a virtual quote reserve V, as pump.fun does with virtual SOL.
Start price P0 = V / X.  Arbitrageurs buy until the curve price reaches Y*.

Closed form for x*y = k: buying until price P gives dx = X - sqrt(k/P), dy = sqrt(kP) - V,
giveaway (in YES-USD) = dx*P - dy = X*(sqrt(Y*) - sqrt(P0))^2.
Run: python3 -I s1_bonding_curve.py
"""
import math

s, p, delta = 100.0, 0.4, 0.05
Y = s * (1 + (1 - p) * delta)
N = s * (1 - p * delta)
print(f"Fair branch prices: Y*={Y:.2f}  N*={N:.2f}  check p*Y+(1-p)*N={p*Y+(1-p)*N:.2f} (= s)")

X = 1000.0  # real YES-stock claims the curve holds (requires splitting 1,000 stock = $100k)
print("\nTable S1a: virtual-reserve curve started at P0, arbitraged to Y*")
print(f"{'P0':>6} {'claims sold':>12} {'% of curve':>10} {'paid (YES-USD)':>15} "
      f"{'giveaway YES-USD':>17} {'giveaway today $':>17} {'% of backing':>12}")
for P0 in [1, 10, 25, 50, 75, 90, 98, 103]:
    V = P0 * X
    k = V * X
    if P0 >= Y:
        dx = dy = 0.0
    else:
        dx = X - math.sqrt(k / Y)
        dy = math.sqrt(k * Y) - V
    give = dx * Y - dy  # value transferred to the arbitrageur, in YES-USD
    closed = X * (math.sqrt(Y) - math.sqrt(P0)) ** 2 if P0 < Y else 0.0
    assert abs(give - closed) < 1e-6
    backing = X * s  # today's $ of the stock that had to be split
    print(f"{P0:>6} {dx:>12.1f} {dx/X:>10.1%} {dy:>15.0f} {give:>17.0f} {p*give:>17.0f} "
          f"{p*give/backing:>12.2%}")

# Static no-arbitrage band and the riskless arbitrage against a low curve price.
print("\nS1b: static arbitrage when the YES curve quotes P0 < N* < s (NO book at N*)")
for P0 in [50, 90, 97]:
    M = max(P0, N)  # whole USD to split so both legs can be paid
    leftover = M - P0  # YES-USD left after paying P0 YES-USD
    profit_riskless = s - M  # merge YES+NO stock into 1 stock, sell at s
    value_leftover = p * leftover  # YES-USD worth p each (hedge on Polymarket by buying NO)
    print(f"  P0={P0}: pay {M:.0f} USD, merge to 1 stock worth {s:.0f}: riskless {profit_riskless:+.2f}"
          f" + leftover {leftover:.0f} YES-USD worth {value_leftover:.2f} -> total {profit_riskless+value_leftover:+.2f}/share")
print("  Static band without Polymarket: min(Y,N) <= s <= max(Y,N); with a Polymarket hedge for the"
      " leftover claims: p*Y + (1-p)*N = s within hedge costs.")

# The backing problem: what the curve operator holds after the curve is seeded.
print("\nS1c: backing. Seeding a YES curve with X real claims requires splitting X stock:")
print(f"  X={X:.0f} stock -> {X:.0f} YES-stock (in the curve) + {X:.0f} NO-stock (left over).")
print(f"  Left-over NO-stock is worth (1-p)*N = {(1-p)*N:.1f} each today and pays {N:.0f}-ish only if NO:"
      f" an unhedged event bet of ${X*(1-p)*N:,.0f} unless a NO curve sells it (= split-seeded pair, S2).")
print("  pump.fun mints its token from nothing, so its curve needs no backing; a stock claim cannot be minted.")
