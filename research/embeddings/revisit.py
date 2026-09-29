# Revisit check for "Embeddings: worth it, and what they feed" (#374).
# Run compute.py first (it writes data.json). Then this fits a ridge of μ on the
# small-thumbnail CLIP embedding, weighted 1/σ², and reports the held-out
# correlation against μ over the wallpapers that are in a Comparison.
# Revisit Score prediction if the held-out Pearson r is >= 0.6 at Each ≈ 8.
import sqlite3, os, json, numpy as np
H = os.path.expanduser('~/.local/share/com.quantumff.walltare')
db = sqlite3.connect(f'file:{H}/walltare.db?mode=ro', uri=True)
rat = {i: (mu, s, n) for i, mu, s, n in db.execute(
    'select id, rating_mu, rating_sigma, comparisons_count from wallpapers')}
d = json.load(open('data.json'))['small']
keep = [k for k, i in enumerate(d['ids']) if rat[i][2] > 0]
X = np.array(d['E'])[keep]; A = np.array(d['A'])[keep]
y = np.array([rat[d['ids'][k]][0] for k in keep]); w = np.array([rat[d['ids'][k]][1] ** -2 for k in keep])
n = len(y); print('wallpapers in a Comparison:', n, ' mean Each:', np.mean([rat[d['ids'][k]][2] for k in keep]).round(1))
def fit(X, y, w, lam):
    m = np.average(X, 0, w); c = np.average(y, weights=w); Xc = X - m; W = w[:, None]
    b = np.linalg.solve(Xc.T @ (W * Xc) + lam * np.eye(X.shape[1]), Xc.T @ (w * (y - c)))
    return lambda Z: c + (Z - m) @ b
rng = np.random.default_rng(0); folds = rng.permutation(n) % 5
for lam in [0.1, 1, 10, 100]:
    p = np.empty(n)
    for f in range(5):
        tr = folds != f; p[~tr] = fit(X[tr], y[tr], w[tr], lam)(X[~tr])
    rs = np.corrcoef(np.argsort(np.argsort(p)), np.argsort(np.argsort(y)))[0, 1]
    print(f'ridge lambda={lam:<5} held-out pearson={np.corrcoef(p, y)[0,1]:.3f} spearman={rs:.3f}')
print(f'LAION aesthetic V1 (no training) pearson={np.corrcoef(A, y)[0,1]:.3f}')
