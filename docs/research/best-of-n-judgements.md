# Research: how much a best-of-N judgement is worth

Resolves [QuantumFF/walltare#365](https://github.com/QuantumFF/walltare/issues/365),
part of the map [#362](https://github.com/QuantumFF/walltare/issues/362). Feeds
the grilling ticket [#373](https://github.com/QuantumFF/walltare/issues/373).

## Question

How much ranking information does one multi-way judgement carry compared with a
pairwise Comparison, and how should it enter TrueSkill? This note compares three
formats: pick the best of N, pick the best and the worst (MaxDiff), and rank all N.
It also covers:

- recording a pick as N−1 pairwise updates versus one joint TrueSkill update, and
  how overconfident the pairwise version is;
- the N at which rater fatigue and error start to eat the gain;
- how published designs group items.

## TL;DR

- **Recommendation: N = 4, best and worst.** Record each judgement as one
  judgement and give it **one joint TrueSkill update**. Do not run five
  sequential `rate_1vs1` calls.
- **Worth, in walltare's own model.** One judgement carries this many pairwise
  Comparisons' worth of information (mutual information, bits):

  | Format | Worth |
  |---|---|
  | best-of-4 | ≈ 2.1 |
  | best+worst-of-4 | ≈ 3.4 |
  | full rank of 4 | ≈ 3.6–4.0 |

  The ratios barely move between a fresh library (σ 8.33) and a settled one
  (σ 2). A worth below the implied-relation count (3, 5 and 6) is expected,
  because the relations share wallpapers.
- **N−1 sequential pairwise updates are overconfident, and the error
  compounds.**
  - Per judgement, the winner's σ comes out 6% too small at N = 4 and 16% too
    small at N = 8. Its μ overshoots by up to 1 posterior standard deviation.
  - Losers are penalised by processing order.
  - In a 200-wallpaper simulation after 8 judgements per wallpaper, the 95%
    intervals of best-of-4 cover the truth only 56% of the time, against 90% for
    a joint update. For best-of-6 the figure is 32%. Wallpapers would look
    Evaluated or Decided before they are.
- **The joint update is cheap and exact enough.** It is expectation propagation
  over one performance per wallpaper, as in the TrueSkill paper. It reproduces
  python-trueskill's `rate_1vs1` and ranked `rate()` to the printed precision
  (3–4 decimals). For
  best-of-N it lands within 1–3% of the exact posterior σ.
  - python-trueskill cannot express "winner, then unordered rest". Tied ranks
    at `draw_probability = 0` mean "exactly equal performance", which is worse
    still: loser σ 5.43 against an exact 7.26.
- **N.** Published MaxDiff practice converges on 4–5 items per set:
  - Sawtooth's recommendation and Chrzan & Patterson 2006 say 4–5. Task time
    rises with N, and precision gains are "minimal" past 5.
  - Hollis 2020 finds that 6 per trial minimises error *per trial* for word
    judgements.
  - Four wallpapers fit a 2×2 grid at a size where they can still be judged.
    This point is an inference, not a published result.
- **Break-even.** Best+worst-of-4 pays off if one judgement takes less than
  about 3× as long as a pairwise vote; best-of-4 pays off below about 2×.
  MaxDiff timing on text items rises roughly 15% per extra item (Chrzan &
  Patterson), well inside that margin. Image timing has to be measured.

## 1. Information per judgement

### Implied relations

One judgement over N items implies this many pairwise relations:

| Format | Relations implied | N = 4 |
|---|---|---|
| best-of-N | N − 1 | 3 of 6 |
| best+worst-of-N | 2N − 3 (N ≥ 3) | 5 of 6 |
| full rank of N | N(N − 1)/2 | 6 of 6 |

Kiritchenko & Mohammad (2017) state the "five out of six item–item pair-wise
comparisons" figure for best-worst on 4-tuples. The relations are not
independent pieces of evidence. They share wallpapers, and in TrueSkill's model
each wallpaper has **one** performance per game (Herbrich et al. 2007). The
honest count is therefore information, not relations.

### Mutual information

The table below gives the mutual information between the skills and the
outcome, I(s; Y). It is computed exactly on a quadrature grid over the TrueSkill
likelihood with walltare's constants (β = 4.167, τ = 0.083), with all N
wallpapers at the same μ. That is the regime `select_pair` aims for. Each cell
shows bits, then the multiple of one pairwise Comparison.

| σ of each wallpaper | pair | best-of-3 | best-of-4 | best-of-6 | best-of-8 | best+worst-of-4 | best+worst-of-5 | rank-4 | rank-5 |
|---|---|---|---|---|---|---|---|---|---|
| 8.333 (fresh) | 0.540 | 0.867 (1.6×) | 1.123 (2.1×) | 1.484 (2.7×) | 1.738 (3.2×) | 1.896 (3.5×) | 2.383 (4.4×) | 2.181 (4.0×) | 3.105 (5.8×) |
| 4 (the default Evaluated line) | 0.264 | 0.443 (1.7×) | 0.561 (2.1×) | 0.756 (2.9×) | 0.903 (3.4×) | 0.909 (3.4×) | 1.125 (4.3×) | 0.996 (3.8×) | 1.471 (5.6×) |
| 2 (settled) | 0.091 | 0.152 (1.7×) | 0.202 (2.2×) | 0.273 (3.0×) | 0.328 (3.6×) | 0.303 (3.3×) | 0.396 (4.4×) | 0.324 (3.6×) | 0.486 (5.3×) |

Notes on the table:

- **Monte Carlo noise is about ±0.03 bits.** Check: best+worst-of-3 and
  rank-of-3 carry the same information and come out at 1.275 and 1.311.
- **Best-of-N grows roughly with log N.** Its ceiling is H(Y) = log₂ N.
  Best+worst adds 1.5–1.7× on top of best-only at N = 4, for one extra click.
- **The multiples barely change with σ.** A best+worst-of-4 judgement is worth
  about 3.4 Comparisons early and late alike.
- **This does not contradict Saha & Gopalan (2019).** They prove that with
  winner-only feedback, the samples needed to *identify the single best item*
  under Plackett-Luce are O(n/ε² ln 1/δ), "independent of k", the same as
  pairwise duelling. With top-m ranking feedback the samples fall by a factor of
  m. Their result is about the winner. Mutual information counts what is learnt
  about every wallpaper in the group. In best-of-N the losers learn little each,
  but there are N−1 of them. For walltare the ends of the Score range matter:
  Review clears out the worst and confirms the best. That makes the worst pick
  worth having, and Saha & Gopalan's top-m result points the same way (more
  ranked positions, proportionally fewer samples).

### Judgements needed to reach pairwise quality

This is an indicative pool simulation, not the map's harness. It uses 200
wallpapers with true skills drawn from the prior, and the curator's choice is
drawn from the TrueSkill likelihood. A group is drawn like `select_pair`: the
least-compared first, then the rest weighted by μ proximity. Figures are
averaged over 12 seeds.

| judgements | pair ρ / bottom-20% hit | best-of-4 joint | best+worst-of-4 joint |
|---|---|---|---|
| 200 (1 per wallpaper) | 0.652 / 0.51 | 0.788 / 0.48 | 0.881 / 0.73 |
| 400 | 0.793 / 0.65 | 0.904 / 0.69 | 0.944 / 0.82 |
| 800 | 0.896 / 0.75 | 0.961 / 0.82 | 0.975 / 0.88 |
| 1600 | 0.952 / 0.82 | 0.983 / 0.89 | 0.988 / 0.92 |

- ρ is the Spearman correlation of μ with the true skill.
- Bottom-20% hit is the share of the true bottom fifth found in the estimated
  bottom fifth.
- Best+worst-of-4 reaches the quality of 1600 pairwise Comparisons in about 400
  judgements, a quarter as many. Best-of-4 needs about half as many (800). This
  agrees with the 3.4× and 2.1× worth above.

## 2. Recording: N−1 pairwise updates versus one joint update

### What TrueSkill's model says a multi-way game is

Herbrich, Minka & Graepel (2007) give each player a performance
pᵢ ~ N(sᵢ, β²) per game. A ranking outcome is the event that the performances
fall in that order. They write it as a chain of adjacent differences with
truncation factors. The truncation messages are non-Gaussian and are
approximated by moment matching (EP), so the schedule "iterate[s] over all
messages … until the approximate marginals do not change anymore". Between
games the posterior is kept as independent Gaussians ("Gaussian density
filtering"). python-trueskill's `rate()` builds exactly that chain from
`ranks`.

A best-of-N pick is a **partial** ranking: the winner's performance exceeds
every other, and the rest are unordered. That does not fit the chain.

- Passing the losers as tied ranks turns each adjacent factor into a *draw*
  factor. The draw margin is `ppf((p + 1)/2) · √size · β`
  (`trueskill/__init__.py`, `calc_draw_margin`). With walltare's
  `draw_probability = 0` that margin is 0, so "tied" means "exactly equal
  performance". Measured with python-trueskill 0.4.5 on four fresh wallpapers
  with ranks `[0, 1, 1, 1]`:
  - winner: 30.15 ± 6.55, against an exact 32.67 ± 6.42;
  - each loser: 23.28 ± **5.43**, against an exact 22.44 ± **7.26**.

  **Do not use tied ranks.**
- The correct factor graph has one constraint pᵂ > pⱼ per loser (a star), all
  sharing the winner's single performance. Best+worst adds pᵢ > p_worst for each
  middle wallpaper.

### How the three recordings compare

The comparison uses `docs/research/best-of-n-judgements/bestofn.py`. The exact
posterior comes from Monte Carlo rejection sampling of the TrueSkill generative
model (0.5–4 M accepted samples). The **joint EP** update runs EP over the
performance vector with one truncation site per implied relation. It is checked
against python-trueskill: it gives `rate_1vs1` = 29.2052 ± 7.1946 /
20.7948 ± 7.1946, and the ranked `rate()` for four players to three decimals.
**Sequential** means python-trueskill `rate_1vs1` once per implied relation.

Each cell gives the winner's σ ratio against exact, with its μ error in exact
posterior standard deviations in brackets.

| judgement | fresh (σ 8.33): sequential | fresh: joint | settled, level (σ 3): sequential | settled, level: joint | upset (winner μ 22, rest 25–28, σ 3): sequential | upset: joint |
|---|---|---|---|---|---|---|
| best-of-3 | 0.97 (+0.06) | 1.00 | 0.98 (+0.11) | 1.00 | 0.97 (+0.18) | 1.00 |
| best-of-4 | 0.94 (+0.11) | 0.99 | 0.95 (+0.23) | 1.00 | 0.94 (+0.37) | 1.00 |
| best-of-6 | 0.88 (+0.19) | 0.99 | 0.90 (+0.47) | 1.00 | 0.88 (+0.73) | 1.00 |
| best-of-8 | 0.84 (+0.24) | 0.99 | 0.85 (+0.67) | 1.00 | 0.82 (+1.01) | 1.00 |
| best+worst-of-4 (winner / worst) | 0.94 / 0.89 | 0.98 / 0.98 | 0.95 / 0.94 | 0.99 / 0.99 | 0.94 / 0.94 | 0.99 / 1.00 |
| rank-of-5, all 10 pairs (worst) | 0.80 (−0.34) | 1.00 | 0.91 (−0.39) | 1.00 | 0.90 (−0.58) | 1.00 |

### Why sequential goes wrong

- **The winner is overcounted.** Each `rate_1vs1` draws a fresh performance for
  the winner. Three separate wins are stronger evidence than one good
  performance that beat three wallpapers at once. The error grows with N and is
  worst for an upset, which is exactly the case where the Score should move
  carefully.
- **Losers depend on processing order.** With four fresh wallpapers the exact
  posterior gives every loser 22.44. Sequential gives 20.79, 21.68 and 22.23,
  depending only on which loser is processed first. Shuffling the order hides
  this but does not remove it.

### The error compounds

The same pool simulation measures calibration: the share of wallpapers whose
true skill lies inside μ ± 1.96σ. It should be 0.95.

| judgements per wallpaper | pair | best-of-4 sequential | best-of-4 joint | best-of-6 sequential | best-of-6 joint | best+worst-of-4 sequential | best+worst-of-4 joint |
|---|---|---|---|---|---|---|---|
| 1 | 0.955 | 0.919 | 0.949 | 0.850 | 0.941 | 0.909 | 0.946 |
| 2 | 0.955 | 0.874 | 0.939 | 0.690 | 0.933 | 0.865 | 0.933 |
| 4 | 0.950 | 0.765 | 0.929 | 0.465 | 0.902 | 0.785 | 0.904 |
| 8 | 0.936 | 0.559 | 0.900 | 0.318 | 0.866 | 0.672 | 0.875 |

- **Ranking quality is almost identical.** Sequential and joint give ρ within
  0.01 of each other. The damage is to σ: at the same number of judgements a
  sequential σ ends 12–19% smaller (best-of-4 at 4 per wallpaper: 2.01 against
  2.30).
- **σ drives the domain.** The Evaluated threshold (ADR 0046) and the Bar/Decided
  work (#362) both read σ. Sequential recording would declare wallpapers
  Evaluated or Decided early, and wrongly often enough to matter.
- **Joint EP still drifts a little** (0.87–0.90 at 8 per wallpaper). Keeping
  only independent marginals between judgements discards correlations. Multi-way
  judgements build more correlation than pairs do.

### What the literature says about the same flaw

- **Weng & Lin (2011)** factor a k-team game either into adjacent pairs
  ("partial-pair") or into all k(k−1)/2 pairs ("full-pair"). Their full-pair
  Thurstone-Mosteller model "uses the same likelihood as TrueSkill". It performs
  worst on Free-for-All, and they suggest this "might be that σᵢ quickly goes to
  zero". Damping the variance update to γ = 1/k "significantly improves" it.
  That is the same overconfidence, found on Halo 2 data.
- **Azari Soufiani, Parkes & Xia (2014)**, on rank-breaking:
  - Under Plackett-Luce, a breaking is consistent iff it is a union of
    position-k breakings (Theorem 2). Winner-versus-each-loser is position-1,
    so it is consistent.
  - Under any location model with symmetric noise, including the Gaussian
    (Thurstone) noise TrueSkill uses, **"the only consistent breaking is the
    full breaking"** (Theorem 4). Breaking a best-of-N pick into N−1 pairs is
    inconsistent under TrueSkill's own likelihood.
- **Khetan & Oh (2016)**: "naive rank-breaking approaches can result in
  inconsistent estimates". The fix is to "treat the pairwise comparisons
  unequally".

The last two papers are about batch estimators (GMM and MLE), not TrueSkill's
online filter, but the cause is the same: pairs cut from one judgement are not
independent.

### What the joint update costs

- One judgement is N Gaussian performances and N−1 truncation sites (2N−4 for
  best+worst). For N = 4 that is a dense 4×4 system, iterated to convergence
  (the script uses a tolerance of 1e-12 on the site parameters).
- This stays inside the no-dependency hand-rolled approach of
  `docs/research/trueskill-rust.md`, with small dense matrices.
- For best-of-N the graph is a tree (a star), so python-trueskill-style message
  passing also works. For best+worst it has loops, and EP on the joint Gaussian
  of the performances is the simple general form.

## 3. Where fatigue and error eat the gain

**Chrzan & Patterson (2006)** ran three commercial MaxDiff studies with items
per set varied between cells: 884, 1,236 and 904 respondents, 3 to 8 items. The
table gives seconds per question, from median section length divided by the
number of questions:

| items per set | Study 1 (17 questions) | Study 2 (19) | Study 3 (12) |
|---|---|---|---|
| 3 | — | 10.9 | 7.9 |
| 4 | 12.9 | — | — |
| 5 | 14.6 | 15.4 | 11.6 |
| 6 | 16.4 | — | — |
| 7 | 22.9 | — | 11.5 |
| 8 | — | 19.0 | — |

- Dropout rose weakly with set size in Study 1 (10.0% → 14.9%, p < .11) and was
  mixed in the other two studies.
- Hit rates and holdout RMSE showed "no significant differences", with "a hint"
  that 3 items is worse.
- Conclusion: "we recommend using 4 or 5 items per question". "Smaller
  questions are shorter questions", so more questions with fewer items beats
  fewer, larger ones.

**Sawtooth (Lighthouse Studio manual, "Designing the Study")**:

- "Generally, we recommend displaying either four or five items at a time."
- "The gains in precision of the estimates are minimal when using more than
  five items at a time per set", and they "may be offset by respondent fatigue
  or confusion".
- Do not show more than half the study's items at once.

**Hollis (2020)**, on best-worst over lexical norms: "in the general case, six
items per trial better reduces errors in the latent value estimates", from
simulation and behavioural data. The measure is error per trial, not per
second.

**Mantiuk, Tomaszewska & Mantiuk (2012)** compared single-stimulus,
double-stimulus, forced-choice pairwise and similarity judgements for image
quality. Forced-choice pairwise gave "the smallest measurement variance" and was
"the most time-efficient, assuming a moderate number of compared conditions".
They did not test best-of-N. The point for walltare is that pairwise is a strong
baseline for images, so multi-way has to earn its keep in time as well as
information.

### Reading this for wallpapers (inference, not published)

- **Time.** Text MaxDiff costs about 1.6 s, or about 15%, per extra item
  (Study 2: 10.9 → 15.4 → 19.0 s for 3 → 5 → 8). A wallpaper takes longer to
  look at than a word. Even at double a pairwise vote's time, best+worst-of-4
  (3.4× the information) is about 1.7× faster to a given quality.
  - Measure it directly: `comparisons.voted_at` stamps each vote (to the
    second), so pairwise latency can be read from existing data.
  - A prototype can log best-of-4 latency the same way.
- **Screen.** Four 16:9 wallpapers fill a 2×2 grid at a size where they can
  still be judged. Six need 3×2 at a third of the width, where detail that
  decides wallpaper taste (noise, compression, small subjects) stops being
  visible. That pushes against Hollis's 6 even though 6 is better per trial.
- **Error.** Per-item error grows with N, so the model's β is less right as N
  grows. None of the cited studies found a sharp break between 4 and 5.

## 4. How published designs group items

- **Balanced designs (Sawtooth, BIBD tradition).** Each item appears "three to
  five times per respondent", which gives about 3K/k sets for K items at k per
  set. "One-way frequencies are nearly equivalent" and "two-way frequencies are
  also nearly equivalent". Each version must have connectivity, and position is
  balanced within and across sets. For very large lists (sparse designs), each
  item should be seen "at least 500 times and preferably 1000 times" across the
  sample.
- **Random tuples with a frequency constraint (Kiritchenko & Mohammad 2017).**
  2N random 4-tuples cover N = 3,207 terms. Each term appears in eight tuples
  and never twice in one tuple, and 10 annotators judge each tuple. With only 3N
  annotations, best-worst matched the split-half reliability (ρ = 0.95) that
  rating scales reached with ten annotations per term.
- **Unbalanced, many-item designs (Hollis 2018).** Scoring best-worst data for
  thousands of items where each is seen in few trials. The new scoring
  algorithms "consistently outperformed" counting-style scores. This is the
  regime walltare is in, and model-based scoring (TrueSkill) is the right side
  of it.
- **Adaptive grouping (TrueSkill).** Herbrich et al. match players by "match
  quality", the draw probability relative to its maximum. That groups
  near-equal skills, as `select_pair`'s μ-proximity weighting does. The pool
  simulation drew groups that way. Which wallpapers to draw is #370's question.
  The only finding here is that μ-proximate groups make the ratios above hold.

## 5. For #373

These are open design points this research raises. They are not decided.

- **What a Comparison means.** A Comparison is currently "one pairwise vote"
  (`CONTEXT.md`), stored as `comparisons(winner_id, loser_id, voted_at)` and
  applied incrementally in `voting.rs`. A best+worst-of-4 judgement can be
  stored as its five implied Comparisons for history, the no-repeat exclusion
  and Round counts. The rating update must still be joint.
  - If ratings are ever replayed from `comparisons`, the rows need a judgement
    id to regroup them. That likely needs an ADR.
- **`comparisons_count` and Round.** Should a wallpaper in a four-way judgement
  count one, or the number of relations it took part in? Round and
  Participated read this count.
- **Evaluated threshold.** σ 4 was chosen against pairwise σ trajectories.
  Under a joint update σ stays honest, so the threshold keeps its meaning.
  Under sequential recording it would not.

## Sources

- R. Herbrich, T. Minka, T. Graepel, "TrueSkill™: A Bayesian Skill Rating System", NIPS 19 (2006/2007). <https://proceedings.neurips.cc/paper_files/paper/2006/file/f44ee263952e65b3610b8ba51229d1f9-Paper.pdf>
- python-trueskill 0.4.5 source, `trueskill/__init__.py` (`calc_draw_margin`, `factor_graph_builders`, `build_trunc_layer`, `v_draw`/`w_draw`). <https://pypi.org/project/trueskill/0.4.5/>
- R. C. Weng, C.-J. Lin, "A Bayesian Approximation Method for Online Ranking", JMLR 12 (2011) 267–300, §3.3, §6.2. <https://www.jmlr.org/papers/volume12/weng11a/weng11a.pdf>
- H. Azari Soufiani, D. Parkes, L. Xia, "Computing Parametric Ranking Models via Rank-Breaking", ICML 2014, Theorems 2 and 4. <https://proceedings.mlr.press/v32/soufiani14.html>
- A. Khetan, S. Oh, "Data-driven Rank Breaking for Efficient Rank Aggregation", JMLR 2016. <https://arxiv.org/abs/1601.05495>
- A. Saha, A. Gopalan, "PAC Battling Bandits in the Plackett-Luce Model", ALT 2019, PMLR 98:700–737. <https://arxiv.org/abs/1808.04008>
- K. Chrzan, M. Patterson, "Testing for the Optimal Number of Attributes in MaxDiff Questions", Sawtooth Software Research Paper (2006). <https://sawtoothsoftware.com/resources/technical-papers/testing-for-the-optimal-number-of-attributes-in-maxdiff-questions>
- Sawtooth Software, Lighthouse Studio manual, "MaxDiff: Designing the Study". <https://sawtoothsoftware.com/help/lighthouse-studio/manual/maxdiff-designing-study.html>
- G. Hollis, "The role of number of items per trial in best–worst scaling experiments", Behavior Research Methods 52 (2020) 694–722. <https://doi.org/10.3758/s13428-019-01270-w>
- G. Hollis, "Scoring best-worst data in unbalanced many-item designs, with applications to crowdsourcing semantic judgments", Behavior Research Methods 50 (2018) 711–729. <https://doi.org/10.3758/s13428-017-0898-2>
- S. Kiritchenko, S. M. Mohammad, "Best–Worst Scaling More Reliable than Rating Scales: A Case Study on Sentiment Intensity Annotation", ACL 2017. <https://aclanthology.org/P17-2074.pdf>
- R. K. Mantiuk, A. Tomaszewska, R. Mantiuk, "Comparison of Four Subjective Methods for Image Quality Assessment", Computer Graphics Forum 31(8) (2012). <https://www.cl.cam.ac.uk/~rkm38/pdfs/mantiuk12cfms.pdf>

## Reproducing

The scripts live in `docs/research/best-of-n-judgements/`.

```sh
uv venv /tmp/ts && uv pip install --python /tmp/ts/bin/python trueskill==0.4.5 numpy scipy
cd docs/research/best-of-n-judgements
/tmp/ts/bin/python bestofn.py check   # EP vs python-trueskill
/tmp/ts/bin/python bestofn.py one     # single-judgement tables (~20 s)
/tmp/ts/bin/python bestofn.py mi      # mutual information (~5 min)
/tmp/ts/bin/python pool.py 12         # pool simulation, 12 seeds (~8 min)
```
