"""S4: Monte Carlo of LP alpha per 30-day event for three mechanisms at EQUAL single-leg depth
(<= 1% all-in on a $10k trade with a 30 bp fee/half-spread).

  A  split-seeded CPMM pair, no oracle (virtual full-range liquidity with the same marginal depth)
  B  s-anchored per-branch curves: Y = s_or*y, N = s_or*n, y and n learned from flow (no p oracle)
  C  s- and p-anchored delta-curve (Delta-vault model, on chain): Y = s_or(1+(1-p_or)d)e^{-mu J},
     N = s_or(1-p_or d)e^{-mu J}; d learned from YES-minus-NO flow, J = net stock sold (full-set skew)

World: Y* = X(1+(1-p0)g), N* = X(1-p0 g) (event-news invariant), s = pY* + (1-p)N*.
  X: non-event stock level, sigma 45%/yr, 75% of variance in open hours (1-min steps), 25% in gaps
  g: conditional gap, random walk sigma_delta + Poisson jumps
  p: Gaussian-score dynamics (pm-AMM paper): p = Phi(Z/sqrt(T-t)), Z Brownian in days
  Trading: 21 sessions of 390 minutes; cutoff after the 21st session (30-day event).
Arbitrageurs know Y*, N* exactly (worst case for LPs) and trade every minute to the no-arb band.
Noise traders: Poisson, $3k each, random leg/side, open hours only.
LP alpha = sum over trades of (execution - fair) valued at today's state prices (p for YES, 1-p NO).
Run: python3 -I s4_mc.py [paths]
"""
import math, random, sys

def Phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

BASE = dict(
    sigma=0.45, open_share=0.75, sig_delta=0.05, jump_rate=1.0, jump_sd=0.02, g0=0.05, p0=0.5,
    e0=0.02, Ls=0, Lp=0, policy="halt", noise_per_day=150e3, noise_size=3e3, h=0.003,
    mu_ratio=1.0, p_bias=0.0, sessions=21,
)

def run(cfg, paths, seed):
    rnd = random.Random(seed)
    sig_m = cfg["sigma"] * math.sqrt(cfg["open_share"]) / math.sqrt(252 * 390)
    sig_gap = cfg["sigma"] * math.sqrt(1 - cfg["open_share"]) / math.sqrt(252)
    h = cfg["h"]
    s0, p0 = 100.0, cfg["p0"]
    q10 = 1e4 / s0
    k = 2 * (0.01 - h) / q10  # marginal log impact per share
    # C calibration: YES buy local impact (1-p)lam + mu/2 = k with mu = mu_ratio*k
    mu_C = cfg["mu_ratio"] * k
    lam_C = (k - mu_C / 2) / (1 - p0)
    Tdays = 30.0
    rate = cfg["noise_per_day"] / cfg["noise_size"] / 390
    res = {m: [] for m in "ABC"}
    parts = {m: [0.0, 0.0] for m in "ABC"}  # noise, arb
    maxinv = {"B": 0.0, "C": 0.0}
    for path in range(paths):
        X, g = s0, cfg["g0"]
        z = math.sqrt(Tdays) * 0.0 if p0 == 0.5 else None
        # Z0 such that Phi(Z0/sqrt(T)) = p0
        lo, hi = -10.0, 10.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if Phi(mid) < p0:
                lo = mid
            else:
                hi = mid
        Z = mid * math.sqrt(Tdays)
        t = 0.0  # days
        p = p0
        d0 = g + rnd.gauss(0, cfg["e0"])  # everyone's starting estimate of delta
        Ystar = X * (1 + (1 - p0) * g)
        Nstar = X * (1 - p0 * g)
        s = p * Ystar + (1 - p) * Nstar
        Y0 = s * (1 + (1 - p) * d0)
        N0 = s * (1 - p * d0)
        # A: CPMM virtual reserves, marginal d lnP/dq = 2/x = k
        xA = [2 / k, 2 / k]
        yA = [xA[0] * Y0, xA[1] * N0]
        # B: log relative prices
        uB = [math.log(Y0 / s), math.log(N0 / s)]
        invB = [0.0, 0.0]
        # C: delta and full-set skew
        dC, JC = d0, 0.0
        invC = [0.0, 0.0]
        hist_s = [s]
        hist_p = [p]
        alpha = {m: 0.0 for m in "ABC"}
        last_open_s, last_open_p = s, p

        def pv(leg):
            return p if leg == 0 else 1 - p

        # ---------- trade primitives (return AMM edge in branch currency, update state) ----------
        def cpmm_trade(leg, F, noise_side=0, notional=0.0):
            # noise_side: +1 buy notional $, -1 sell notional $; 0 = arbitrage to F
            x, y = xA[leg], yA[leg]
            kk = x * y
            P = y / x
            f = h
            if noise_side == 0:
                if P * (1 + f) < F:
                    P2 = F / (1 + f)
                elif P * (1 - f) > F:
                    P2 = F / (1 - f)
                else:
                    return 0.0
                x2 = math.sqrt(kk / P2)
                y2 = math.sqrt(kk * P2)
            elif noise_side > 0:
                y2 = y + notional / (1 + f)
                x2 = kk / y2
            else:
                q = notional / P
                x2 = x + q
                y2 = kk / x2
            dx = x2 - x  # >0: AMM bought stock claims
            dy = y2 - y
            if dx < 0:  # trader bought -dx, paid dy*(1+f)
                edge = dy * (1 + f) - (-dx) * F
            else:  # trader sold dx, received -dy*(1-f)
                edge = dx * F - (-dy) * (1 - f)
            xA[leg], yA[leg] = x2, y2
            return edge

        def exp_trade(M, kl, F, noise_side=0, notional=0.0):
            """Returns (q bought by trader (+) / sold (-), edge for AMM)."""
            if noise_side == 0:
                if M * (1 + h) < F:
                    q = math.log(F / (M * (1 + h))) / kl
                elif M * (1 - h) > F:
                    q = -math.log(M * (1 - h) / F) / kl
                else:
                    return 0.0, 0.0
            elif noise_side > 0:
                q = math.log(1 + notional * kl / ((1 + h) * M)) / kl
            else:
                qq = notional / M
                arg = 1 - (1 - math.exp(-kl * qq))  # = exp(-kl*qq)
                q = -qq
            if q > 0:
                cost = (1 + h) * M * (math.exp(kl * q) - 1) / kl
                edge = cost - q * F
            else:
                qs = -q
                proceeds = (1 - h) * M * (1 - math.exp(-kl * qs)) / kl
                edge = qs * F - proceeds
            return q, edge

        def B_trade(leg, F, s_or, noise_side=0, notional=0.0):
            M = s_or * math.exp(uB[leg])
            q, edge = exp_trade(M, k, F, noise_side, notional)
            uB[leg] += k * q
            invB[leg] -= q
            return edge

        def C_mid(leg, s_or, p_or):
            sk = math.exp(-mu_C * JC)
            if leg == 0:
                return s_or * (1 + (1 - p_or) * dC) * sk
            return s_or * (1 - p_or * dC) * sk

        def C_trade(leg, F, s_or, p_or, noise_side=0, notional=0.0):
            nonlocal dC, JC
            M = C_mid(leg, s_or, p_or)
            if leg == 0:
                kl = (1 - p_or) * lam_C * s_or / max(M, 1e-9) * math.exp(-mu_C * JC) + mu_C / 2
            else:
                kl = p_or * lam_C * s_or / max(M, 1e-9) * math.exp(-mu_C * JC) + mu_C / 2
            q, edge = exp_trade(M, kl, F, noise_side, notional)
            if q != 0.0:
                dC += lam_C * q if leg == 0 else -lam_C * q
                JC -= q / 2
                invC[leg] -= q
            return edge

        def arb_all(s_or, p_or, Ys, Ns, do_A=True, do_BC=True):
            if do_A:
                for leg, F in ((0, Ys), (1, Ns)):
                    e = cpmm_trade(leg, F)
                    alpha["A"] += pv(leg) * e
                    parts["A"][1] += pv(leg) * e
            if do_BC:
                for _ in range(4):
                    traded = False
                    for leg, F in ((0, Ys), (1, Ns)):
                        e = B_trade(leg, F, s_or)
                        if e != 0.0:
                            traded = True
                            alpha["B"] += pv(leg) * e
                            parts["B"][1] += pv(leg) * e
                        e = C_trade(leg, F, s_or, p_or)
                        if e != 0.0:
                            traded = True
                            alpha["C"] += pv(leg) * e
                            parts["C"][1] += pv(leg) * e
                    if not traded:
                        break

        sessions = cfg["sessions"]
        dt_min = 1 / (24 * 60)
        for day in range(sessions):
            for minute in range(390):
                # world moves
                X *= math.exp(sig_m * rnd.gauss(0, 1) - 0.5 * sig_m * sig_m)
                g += cfg["sig_delta"] * math.sqrt(dt_min / 365) * rnd.gauss(0, 1)
                if rnd.random() < cfg["jump_rate"] / (sessions * 390 * 1.0) * 0.8:
                    g += rnd.gauss(0, cfg["jump_sd"])
                Z += math.sqrt(dt_min) * rnd.gauss(0, 1)
                t += dt_min
                p = Phi(Z / math.sqrt(max(Tdays - t, 1e-6)))
                Ystar = X * (1 + (1 - p0) * g)
                Nstar = X * (1 - p0 * g)
                s = p * Ystar + (1 - p) * Nstar
                hist_s.append(s)
                hist_p.append(p)
                s_or = hist_s[-1 - cfg["Ls"]] if len(hist_s) > cfg["Ls"] else hist_s[0]
                p_or = hist_p[-1 - cfg["Lp"]] if len(hist_p) > cfg["Lp"] else hist_p[0]
                p_or = min(max(p_or + cfg["p_bias"], 0.01), 0.99)
                # noise traders
                n = 0
                r = rnd.random()
                lam = rate
                # Poisson draw (small rate)
                prob = math.exp(-lam)
                cum = prob
                while r > cum and n < 10:
                    n += 1
                    prob *= lam / n
                    cum += prob
                for _ in range(n):
                    leg = 0 if rnd.random() < 0.5 else 1
                    side = 1 if rnd.random() < 0.5 else -1
                    F = Ystar if leg == 0 else Nstar
                    e = cpmm_trade(leg, F, side, cfg["noise_size"])
                    alpha["A"] += pv(leg) * e
                    parts["A"][0] += pv(leg) * e
                    e = B_trade(leg, F, s_or, side, cfg["noise_size"])
                    alpha["B"] += pv(leg) * e
                    parts["B"][0] += pv(leg) * e
                    e = C_trade(leg, F, s_or, p_or, side, cfg["noise_size"])
                    alpha["C"] += pv(leg) * e
                    parts["C"][0] += pv(leg) * e
                arb_all(s_or, p_or, Ystar, Nstar)
                last_open_s, last_open_p = s_or, p_or
                maxinv["B"] = max(maxinv["B"], abs(invB[0]), abs(invB[1]))
                maxinv["C"] = max(maxinv["C"], abs(invC[0]), abs(invC[1]))
            if day == sessions - 1:
                break
            # closed period: overnight (17.5h) or weekend (65.5h) every 5th session
            hours = 65.5 if day % 5 == 4 else 17.5
            dtc = hours / 24
            gapsd = sig_gap * (1.5 if hours > 20 else 1.0)
            X *= math.exp(gapsd * rnd.gauss(0, 1) - 0.5 * gapsd * gapsd)
            g += cfg["sig_delta"] * math.sqrt(dtc / 365) * rnd.gauss(0, 1)
            if rnd.random() < cfg["jump_rate"] * 0.2 / max(sessions - 1, 1):
                g += rnd.gauss(0, cfg["jump_sd"])
            Z += math.sqrt(dtc) * rnd.gauss(0, 1)
            t += dtc
            p = Phi(Z / math.sqrt(max(Tdays - t, 1e-6)))
            Ystar = X * (1 + (1 - p0) * g)
            Nstar = X * (1 - p0 * g)
            s = p * Ystar + (1 - p) * Nstar
            # A trades through the gap (it never stops); B/C per policy
            if cfg["policy"] == "live":
                arb_all(last_open_s, p if True else last_open_p, Ystar, Nstar)
            elif cfg["policy"] == "aligned":
                arb_all(last_open_s, last_open_p, Ystar, Nstar)
            else:
                arb_all(0, 0, Ystar, Nstar, do_A=True, do_BC=False)
            hist_s.append(s)
            hist_p.append(p)
        for m in "ABC":
            res[m].append(alpha[m])
    out = {}
    for m in "ABC":
        v = res[m]
        mean = sum(v) / len(v)
        sd = math.sqrt(sum((x - mean) ** 2 for x in v) / max(len(v) - 1, 1))
        vs = sorted(v)
        out[m] = (mean, sd / math.sqrt(len(v)), vs[int(0.05 * len(v))], parts[m][0] / len(v),
                  parts[m][1] / len(v))
    return out, maxinv

SCEN = [
    ("base: delta 5%, sig_delta 5%, halt when closed", {}),
    ("no noise flow (pure arbitrage losses)", dict(noise_per_day=0.0)),
    ("high-delta event: delta 20%, start error 5%", dict(g0=0.20, e0=0.05)),
    ("jumpy delta: sig_delta 50%, 3 jumps sd 5%", dict(sig_delta=0.50, jump_rate=3.0, jump_sd=0.05)),
    ("s-oracle lag 5 min (B, C)", dict(Ls=5)),
    ("p-oracle lag 5 min (C)", dict(Lp=5)),
    ("p-oracle bias +3 pts (C)", dict(p_bias=0.03)),
    ("closed hours: live p, frozen s (C), frozen s (B)", dict(policy="live")),
    ("closed hours: frozen s and aligned p", dict(policy="aligned")),
    ("C with deep full-set side (mu = 0.1k)", dict(mu_ratio=0.1)),
    ("p0 = 0.2", dict(p0=0.2)),
    ("high-delta + live closed hours", dict(g0=0.20, e0=0.05, policy="live")),
    ("s-oracle lag 1 min (B, C)", dict(Ls=1)),
    ("s-oracle lag 1 min, C deep full-set side (mu=0.1k)", dict(Ls=1, mu_ratio=0.1)),
    ("high-delta + p-oracle lag 5 min (C)", dict(g0=0.20, e0=0.05, Lp=5)),
    ("noise $50k/day", dict(noise_per_day=50e3)),
    ("no noise, no gaps (all variance intraday)", dict(noise_per_day=0.0, open_share=0.9999)),
    ("no noise, no delta moves/jumps/start error", dict(noise_per_day=0.0, sig_delta=0.0, jump_rate=0.0, e0=0.0)),
]

if __name__ == "__main__":
    paths = int(sys.argv[1]) if len(sys.argv) > 1 else 120
    only = sys.argv[2] if len(sys.argv) > 2 else None
    print(f"S4 Monte Carlo, {paths} paths per scenario; LP alpha per event in today's $ (mean +- s.e.)")
    print("Equal depth: $10k single-leg buy costs 1% all-in at t=0 in every mechanism.")
    print(f"{'scenario':<52} {'A: CPMM pair':>26} {'B: s-anchored':>26} {'C: delta-curve':>26}")
    for i, (name, over) in enumerate(SCEN):
        if only is not None and str(i) not in only.split(","):
            continue
        cfg = dict(BASE)
        cfg.update(over)
        out, maxinv = run(cfg, paths, seed=1000 + i)
        cells = []
        for m in "ABC":
            mean, se, p5, nz, ab = out[m]
            cells.append(f"{mean:>9,.0f}+-{se:<5,.0f}(p5 {p5:>7,.0f})")
        print(f"{name:<52} " + " ".join(f"{c:>26}" for c in cells))
        print(f"{'   split: noise edge / arbitrage edge':<52} " + " ".join(
            f"{out[m][3]:>12,.0f} /{out[m][4]:>10,.0f}  " for m in "ABC"))
        print(f"{'   max |claims inventory| B, C (shares)':<52} {'':>26} {maxinv['B']:>26,.0f} {maxinv['C']:>26,.0f}")
        sys.stdout.flush()
