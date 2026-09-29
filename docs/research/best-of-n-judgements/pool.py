"""Indicative pool simulation (NOT the map's harness): does best-of-N help per judgement,
and does the sequential N-1 pairwise recording miscalibrate over many judgements?"""
import math, sys
import numpy as np
from scipy.stats import norm, spearmanr
from bestofn import ep_skills, rows, best_pairs, bw_pairs, MU, SIG, BETA, TAU


def rate_1vs1(mw, sw, ml, sl):
    sw2, sl2 = sw * sw + TAU * TAU, sl * sl + TAU * TAU
    c = math.sqrt(2 * BETA * BETA + sw2 + sl2); t = (mw - ml) / c
    v = math.exp(norm.logpdf(t) - norm.logcdf(t)); w = v * (v + t)
    return (mw + sw2 / c * v, math.sqrt(sw2 * (1 - sw2 / c / c * w)),
            ml - sl2 / c * v, math.sqrt(sl2 * (1 - sl2 / c / c * w)))


def pick_group(mu, sg, cnt, n, rng):
    least = cnt.min(); ties = np.flatnonzero(cnt == least)
    first = rng.choice(ties)
    others = np.delete(np.arange(len(mu)), first)
    wts = np.exp(-0.5 * ((mu[others] - mu[first]) / sg[first]) ** 2)
    wts = wts / wts.sum() if wts.sum() > 0 else None
    rest = rng.choice(others, size=n - 1, replace=False, p=wts)
    return np.concatenate([[first], rest])


def run(n_items, N, fmt, method, J, seed):
    rng = np.random.default_rng(seed)
    s = MU + SIG * rng.standard_normal(n_items)
    mu = np.full(n_items, MU); sg = np.full(n_items, SIG); cnt = np.zeros(n_items, int)
    for _ in range(J):
        g = pick_group(mu, sg, cnt, N, rng)
        p = s[g] + BETA * rng.standard_normal(N)
        order = np.argsort(-p)                    # observed only partially
        if fmt == "best" or N == 2:
            ordered = np.concatenate([[order[0]], rng.permutation(order[1:])])
            pairs = best_pairs(N)
        else:  # bw
            mid = rng.permutation(order[1:-1])
            ordered = np.concatenate([[order[0]], mid, [order[-1]]])
            pairs = bw_pairs(N)
        idx = g[ordered]                          # position 0 = best, last = worst (bw)
        if method == "seq":
            for i, j in pairs:
                a, b = idx[i], idx[j]
                mu[a], sg[a], mu[b], sg[b] = rate_1vs1(mu[a], sg[a], mu[b], sg[b])
        else:
            m2, s2 = ep_skills(mu[idx], sg[idx], rows(N, pairs))
            mu[idx], sg[idx] = m2, s2
        cnt[idx] += 1
    rho = spearmanr(mu, s)[0]
    z = np.abs(mu - s) / sg
    cover = (z < 1.96).mean()
    k = n_items // 5
    bottom_true = set(np.argsort(s)[:k]); bottom_est = set(np.argsort(mu)[:k])
    return rho, cover, len(bottom_true & bottom_est) / k, sg.mean()


if __name__ == "__main__":
    n_items = 200; seeds = range(int(sys.argv[1]) if len(sys.argv) > 1 else 12)
    configs = [("pair", 2, "best", "seq")] + [
        (f"best-of-{N} {m}", N, "best", m) for N in (3, 4, 6) for m in ("seq", "ep")] + [
        (f"best+worst-of-{N} {m}", N, "bw", m) for N in (4, 5) for m in ("seq", "ep")]
    for per_item in (1, 2, 4, 8):
        J = per_item * n_items
        print(f"\n== {J} judgements over {n_items} wallpapers (={per_item} per wallpaper) ==")
        print(f"  {'format':<24}{'spearman':>9}{'95% cover':>11}{'bottom20% hit':>15}{'mean sigma':>12}")
        for name, N, fmt, m in configs:
            r = np.array([run(n_items, N, fmt, m, J, sd) for sd in seeds]).mean(0)
            print(f"  {name:<24}{r[0]:9.3f}{r[1]:11.3f}{r[2]:15.3f}{r[3]:12.2f}", flush=True)
