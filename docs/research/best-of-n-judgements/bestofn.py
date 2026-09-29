"""Best-of-N worth, in walltare's TrueSkill model (mu=25, sigma=8.333, beta=4.167, tau=0.083, no draws).

Parts:
  1. One judgement: exact posterior (Monte Carlo) vs joint EP vs sequential rate_1vs1.
  2. Mutual information per judgement (bits) for pair / best-of-N / best-worst / full rank.
"""
import math, sys
import numpy as np
from scipy.stats import norm
import trueskill

MU, SIG, BETA, TAU = 25.0, 8.333, 4.167, 0.083
env = trueskill.TrueSkill(mu=MU, sigma=SIG, beta=BETA, tau=TAU, draw_probability=0.0)
rng = np.random.default_rng(1)


# ---------- joint EP on the performance vector with linear truncations ----------
def ep_skills(mu, sig, A, iters=100, tol=1e-12):
    """Posterior skill marginals given constraints A @ p > 0, p_i ~ N(s_i, beta^2),
    s_i ~ N(mu_i, sig_i^2 + tau^2). One performance per item per judgement."""
    mu = np.asarray(mu, float); sp2 = np.asarray(sig, float) ** 2 + TAU ** 2
    v0 = sp2 + BETA ** 2
    K, n = A.shape
    ts = np.zeros(K); ns = np.zeros(K)
    P0 = np.diag(1 / v0); h0 = mu / v0
    for _ in range(iters):
        delta = 0.0
        for k in range(K):
            S = np.linalg.inv(P0 + A.T @ (ts[:, None] * A)); m = S @ (h0 + A.T @ ns)
            a = A[k]; mk = a @ m; vk = a @ S @ a
            tc = 1 / vk - ts[k]; nc = mk / vk - ns[k]
            mc, vc = nc / tc, 1 / tc
            z = mc / math.sqrt(vc)
            lam = math.exp(norm.logpdf(z) - norm.logcdf(z))
            mh = mc + math.sqrt(vc) * lam; vh = vc * (1 - lam * (lam + z))
            tn = 1 / vh - tc; nn = mh / vh - nc
            delta = max(delta, abs(tn - ts[k]), abs(nn - ns[k]))
            ts[k], ns[k] = tn, nn
        if delta < tol:
            break
    S = np.linalg.inv(P0 + A.T @ (ts[:, None] * A)); m = S @ (h0 + A.T @ ns)
    k_ = sp2 / v0
    post_mu = mu + k_ * (m - mu)
    post_var = sp2 - k_ * sp2 + k_ ** 2 * np.diag(S)
    return post_mu, np.sqrt(post_var)


def rows(n, pairs):
    A = np.zeros((len(pairs), n))
    for r, (i, j) in enumerate(pairs):
        A[r, i], A[r, j] = 1, -1
    return A


def best_pairs(n):          # item 0 beats every other
    return [(0, j) for j in range(1, n)]


def bw_pairs(n):            # item 0 best, item n-1 worst
    return [(0, j) for j in range(1, n)] + [(j, n - 1) for j in range(1, n - 1)]


def rank_pairs(n):          # 0 > 1 > ... > n-1, adjacent (TrueSkill's chain)
    return [(i, i + 1) for i in range(n - 1)]


def rank_full_pairs(n):     # all N(N-1)/2 relations
    return [(i, j) for i in range(n) for j in range(i + 1, n)]


# ---------- sequential rate_1vs1 ----------
def sequential(mu, sig, pairs):
    r = [env.create_rating(m, s) for m, s in zip(mu, sig)]
    for i, j in pairs:
        r[i], r[j] = env.rate_1vs1(r[i], r[j])
    return np.array([x.mu for x in r]), np.array([x.sigma for x in r])


# ---------- Monte Carlo ground truth ----------
def outcome_mask(p, fmt, n):
    if fmt == "best":
        return p[:, 0] > p[:, 1:].max(1)
    if fmt == "bw":
        return (p[:, 0] > p[:, 1:].max(1)) & (p[:, n - 1] < p[:, : n - 1].min(1))
    if fmt == "rank":
        return np.all(np.diff(p, axis=1) < 0, axis=1)


def truth(mu, sig, fmt, M=4_000_000):
    n = len(mu); mu = np.asarray(mu); sd = np.sqrt(np.asarray(sig) ** 2 + TAU ** 2)
    acc_s = []; tot = 0
    for _ in range(max(1, M // 1_000_000)):
        s = mu + sd * rng.standard_normal((1_000_000, n))
        p = s + BETA * rng.standard_normal((1_000_000, n))
        msk = outcome_mask(p, fmt, n)
        acc_s.append(s[msk]); tot += 1_000_000
    s = np.concatenate(acc_s)
    return s.mean(0), s.std(0), len(s)


# ---------- mutual information ----------
G = np.linspace(-9, 9, 721)  # grid in units of beta around each item
def mi_bits(mu, sig, fmt, S=6000):
    """I(skills; outcome) = H(Y) - E_s H(Y|s), exact inner integrals on a grid."""
    n = len(mu); mu = np.asarray(mu); sd = np.sqrt(np.asarray(sig) ** 2 + TAU ** 2)
    s = mu + sd * rng.standard_normal((S, n))
    lo, hi = s.min() - 8 * BETA, s.max() + 8 * BETA
    x = np.linspace(lo, hi, 1500); dx = x[1] - x[0]
    out = []
    for row in s:
        f = norm.pdf((x[None, :] - row[:, None]) / BETA) / BETA      # n x G
        F = norm.cdf((x[None, :] - row[:, None]) / BETA)
        if fmt == "best":
            logF = np.log(np.clip(F, 1e-300, None)); tot = logF.sum(0)
            P = np.array([(f[i] * np.exp(tot - logF[i])).sum() * dx for i in range(n)])
        elif fmt == "rank":
            import itertools
            P = []
            for perm in itertools.permutations(range(n)):
                # P(p_perm0 > p_perm1 > ...): chain via cumulative integrals from the bottom
                g = f[perm[-1]].copy()
                for k in reversed(perm[:-1]):
                    g = f[k] * np.cumsum(g) * dx
                P.append(g.sum() * dx)
            P = np.array(P)
        elif fmt == "bw":
            # P(b best, w worst) = int f_b(x) int_{y<x} f_w(y) prod_k [F_k(x)-F_k(y)] dy dx
            xs = x[::6]; dxs = xs[1] - xs[0]
            fs = norm.pdf((xs[None, :] - row[:, None]) / BETA) / BETA
            Fs = norm.cdf((xs[None, :] - row[:, None]) / BETA)
            D = np.clip(Fs[:, :, None] - Fs[:, None, :], 0, None)   # n x X x Y, F(x)-F(y)
            tri = np.tril(np.ones((len(xs), len(xs))), -1)          # y < x
            logD = np.log(np.clip(D, 1e-300, None)); totD = logD.sum(0)
            P = []
            for b in range(n):
                for w in range(n):
                    if b == w: continue
                    prod = np.exp(totD - logD[b] - logD[w]) * tri
                    P.append((fs[b][:, None] * fs[w][None, :] * prod).sum() * dxs * dxs)
            P = np.array(P)
        P = P / P.sum()
        out.append(P)
    P = np.array(out)
    Hcond = -(P * np.log2(np.clip(P, 1e-300, None))).sum(1).mean()
    Pm = P.mean(0); H = -(Pm * np.log2(np.clip(Pm, 1e-300, None))).sum()
    return H - Hcond, H


def fmt_row(label, m, s):
    return f"  {label:<22}" + "  ".join(f"{a:6.2f}±{b:5.2f}" for a, b in zip(m, s))


if __name__ == "__main__":
    part = sys.argv[1] if len(sys.argv) > 1 else "all"
    if part in ("check", "all"):
        print("== sanity: joint EP == rate_1vs1 for N=2; EP chain == env.rate for rank ==")
        a, b = env.rate_1vs1(env.create_rating(), env.create_rating())
        print("  rate_1vs1:", round(a.mu, 4), round(a.sigma, 4), round(b.mu, 4), round(b.sigma, 4))
        print("  ep       :", *np.round(ep_skills([MU, MU], [SIG, SIG], rows(2, [(0, 1)])), 4).ravel())
        rs = env.rate([(env.create_rating(),) for _ in range(4)], ranks=[0, 1, 2, 3])
        print("  env.rate rank4:", [(round(r[0].mu, 3), round(r[0].sigma, 3)) for r in rs])
        m, s = ep_skills([MU] * 4, [SIG] * 4, rows(4, rank_pairs(4)))
        print("  ep chain rank4:", list(zip(np.round(m, 3), np.round(s, 3))))

    if part in ("one", "all"):
        scen = {
            "fresh (mu 25, sigma 8.333)": lambda n: ([MU] * n, [SIG] * n),
            "settled, level (mu 25, sigma 3)": lambda n: ([MU] * n, [3.0] * n),
            "settled, upset (winner mu 22, others 25..28, sigma 3)":
                lambda n: ([22.0] + list(np.linspace(25, 28, n - 1)), [3.0] * n),
        }
        for name, mk in scen.items():
            print(f"\n== one judgement, {name} ==")
            for fmt, pf, extra in [("best", best_pairs, None), ("bw", bw_pairs, None),
                                   ("rank", rank_pairs, rank_full_pairs)]:
                for n in ([2, 3, 4, 6, 8] if fmt == "best" else [3, 4, 5] if fmt == "bw" else [3, 4, 5]):
                    if fmt != "best" and n == 2: continue
                    mu, sig = mk(n)
                    tm, ts_, acc = truth(mu, sig, fmt, M=8_000_000 if fmt == "rank" else 4_000_000)
                    em, es = ep_skills(mu, sig, rows(n, pf(n)))
                    sm, ss = sequential(mu, sig, (extra or pf)(n))
                    print(f" {fmt} N={n}  (MC accepted {acc})")
                    print(fmt_row("exact (MC)", tm, ts_))
                    print(fmt_row("joint EP", em, es))
                    print(fmt_row(f"sequential x{len((extra or pf)(n))}", sm, ss))
                    print("   sigma ratio seq/exact:", np.round(ss / ts_, 3),
                          " mu err (in exact sd):", np.round((sm - tm) / ts_, 2),
                          " EP sigma ratio:", np.round(es / ts_, 3))

    if part in ("mi", "all"):
        for label, sg in [("fresh sigma 8.333", SIG), ("sigma 4 (Evaluated line)", 4.0), ("sigma 2", 2.0)]:
            print(f"\n== mutual information, level mu, {label} ==")
            pair, _ = mi_bits([MU, MU], [sg, sg], "best")
            print(f"  pair: {pair:.3f} bits")
            for n in [3, 4, 5, 6, 8]:
                b, Hb = mi_bits([MU] * n, [sg] * n, "best")
                line = f"  N={n}: best {b:.3f} ({b/pair:.2f}x pair, H={Hb:.2f})"
                if n <= 5:
                    w, _ = mi_bits([MU] * n, [sg] * n, "bw", S=1500)
                    line += f" | best+worst {w:.3f} ({w/pair:.2f}x)"
                    r, _ = mi_bits([MU] * n, [sg] * n, "rank", S=1500 if n < 5 else 400)
                    line += f" | full rank {r:.3f} ({r/pair:.2f}x)"
                print(line, flush=True)
