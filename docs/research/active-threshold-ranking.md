# Research: active ranking toward a threshold with TrueSkill

**Ticket:** [QuantumFF/walltare#364](https://github.com/QuantumFF/walltare/issues/364)
(map [#362](https://github.com/QuantumFF/walltare/issues/362))
**Date:** 2026-09-29

## Question

What do the primary sources say about choosing Comparisons when the goal is to
classify wallpapers relative to a threshold (the **Bar**), or to find the
top or bottom k, rather than to rank every wallpaper? The ticket asks for
threshold and top-k bandits (LUCB, APT and relatives), expected-information-gain
and match-quality pair choice under TrueSkill, and noisy-sorting results. For
each candidate it asks for the stopping rule, the vote savings reported over
uniform sampling, and the noise assumption. The output feeds the pair-selection
decision ([#370](https://github.com/QuantumFF/walltare/issues/370)) and the
Decided rule ([#368](https://github.com/QuantumFF/walltare/issues/368)).

Vocabulary is from `CONTEXT.md`. The papers call the Bar a "threshold" and a
wallpaper an "arm" or "item". This note keeps their words only when it
describes a paper.

## TL;DR

1. **The map's goal already has a name in the literature.** It is the
   *thresholding bandit problem with an indifference zone*. You classify every
   item as above or below a known threshold τ. Items within ±ε of τ may be
   classified either way at no cost, which is the map's "the middle may stay
   fuzzy" ([Locatelli et al. 2016](#apt)). There are two ways to measure it:
   - *Fixed-confidence*: keep going until every item is classified. This is
     "Decided".
   - *Fixed-budget*: minimise the error after T votes. Either the chance of
     any error ([APT](#apt)) or the expected number of misclassified items
     ([LSA](#lsa), [Opt-KG](#optkg)).
2. **Every threshold algorithm has the same shape.** Sample the item whose
   side of the threshold is least certain, relative to how much it has already
   been sampled. Stop sampling an item once its confidence interval clears the
   threshold. The closest match to TrueSkill's Gaussian (μ, σ) is
   [LSE](#lse) (Gotovos et al. 2013):
   - **Stop rule:** classify an item once μ − kσ + ε > Bar or μ + kσ − ε ≤ Bar.
   - **Selection rule:** sample the unclassified item with the largest
     *ambiguity*, kσ − |μ − Bar|. With k = 1.96 this is the older
     *straddle* rule.

   Each step is O(n) over the pool's (μ, σ). That is what `select_pair`
   already reads.
3. **Reported savings over uniform sampling are real but depend on the
   instance.** They are stated as asymptotic bounds, not headline percentages:
   - Uniform allocation needs roughly K · max Δ⁻² samples. Adaptive
     allocation needs roughly H = Σ Δ⁻², where Δ is the distance to τ plus ε.
   - LSA's authors show uniform "may need Ω(K) times more budget".
   - For pairwise top-k, AR's authors show active vs. passive is "as large as a
     factor of n" (n² vs n³ comparisons in their example).
   - Under BTL, Mohajer et al.'s gain is only Ω(log n / log log n).

   None of these are vote counts for our voter. The harness
   ([#363](https://github.com/QuantumFF/walltare/issues/363)) has to measure
   them.
4. **TrueSkill's match quality is not information gain, and it points the
   wrong way on σ.** The TrueSkill paper defines match quality as a relative
   draw probability, a criterion for *fun, balanced games*. For one-vs-one
   Comparisons, [BALD](#bald) gives a closed-form expected information gain.
   I checked it against numerical integration (table below).
   - Two confident, equal wallpapers (σ = 1) have match quality 0.97 but
     carry **0.03 bits** of expected information.
   - Two new wallpapers (σ = 8.333) have match quality 0.45 but carry
     **0.54 bits**.

   So information-gain opponent choice (technique 3) should use BALD's EIG,
   not `quality_1vs1`.
5. **Full-posterior EIG methods (ASAP, Hybrid-MST, Crowd-BT) optimise score
   RMSE across all items, not the side of the Bar.** They save about 75% of
   comparisons against a full pairwise design (Hybrid-MST), and ASAP beats
   Hybrid-MST by a further ~33% (7,065 vs 10,550 comparisons at n = 200).
   But they spend votes making the far ends precise, which the Bar doesn't
   need. Maystre & Grossglauser also found that plain *uncertainty sampling*
   (compare the closest-μ pair) was "nearly indistinguishable" from the
   Bayesian EIG methods on synthetic BT data. Today's μ-proximity opponent
   already approximates that.
6. **Noisy sorting mostly does not apply.** Its main results assume a fixed
   flip probability p, independent of how far apart two items are
   ([Braverman & Mossel](#bm), [Gu & Xu](#guxu)). Under Thurstone/TrueSkill,
   neighbours near the Bar are close to coin flips, so exact order there is
   unaffordable. That is why the problem should be posed as thresholding with
   an ε band, not as sorting. One useful piece remains, noisy binary search
   ([Karp & Kleinberg](#kk)): an item can find its place against an ordered
   reference in O(log n / ε²) comparisons. This bears on a triage pass
   (technique 4).

**Most promising for walltare, for the harness to test (in this order):**

- **(a) LSE/straddle-style first pick, with a Decided stop rule.**
  - First pick: the Undecided wallpaper with the largest kσ − |μ − Bar|.
  - Decided wallpapers stop being drawn first.
  - It needs only (μ, σ) and it is parameter-light (k, ε).
  - Its stop rule is exactly the Decided rule #368 is converging on.
- **(b) An APT/LSA-style index as an alternative first pick.**
  - APT: minimise (|μ − Bar| + ε)/σ. LSA adds a log-count term, so hopeless
    items near the Bar don't soak up the budget.
  - These are the fixed-budget-optimal rules. The index form matters because
    the curator stops whenever they like; there is no fixed confidence target.
- **(c) BALD closed-form EIG for the opponent.**
  - Each candidate costs O(1), so an opponent pick costs O(n).
  - Prefer it over match quality (μ-proximity alone).
  - Also test a threshold-aware variant: a one-step lookahead through
    `rate_1vs1` that scores the expected drop in misclassification
    probability. This is knowledge-gradient in the style of Opt-KG.

Full-posterior EIG (ASAP) and noisy sorting look like the wrong fit here.

## The problem, stated in the papers' terms

| walltare | thresholding-bandit literature |
|---|---|
| Wallpaper | arm / item |
| Score (μ) and its uncertainty (σ) | posterior mean and std (Bayesian); empirical mean and confidence width (frequentist) |
| Bar | threshold τ (APT), θ (LSA), h (LSE) |
| Decided | classified: its confidence region lies wholly on one side of τ ± ε (LSE lines 7–10; LUCB's stopping rule) |
| "the middle may stay fuzzy" | indifference zone of width 2ε (APT); aggregate-regret objective, which may give up on very hard arms (LSA, Opt-KG) |
| Comparison | **not** a direct sample of the arm. It is a noisy sign of s_i − s_j, so every pull involves a second item |

The last row is the main mismatch. Bandit papers pull an arm and observe its
reward. We only observe who won, so the opponent choice changes how much a
Comparison says about the first pick. The pairwise papers ([AR](#ar),
[Mohajer](#mohajer)) handle this by fixing the opponent: a uniformly random
opponent in AR, a tournament in Mohajer. The Bayesian pair papers
([ASAP](#asap), [BALD](#bald)) handle it by scoring the pair.

## Candidates

Summary (details and quotes follow):

| Candidate | Goal | Selection | Stopping rule | Savings reported vs uniform | Noise assumption |
|---|---|---|---|---|---|
| [APT](#apt) (Locatelli, Gutzeit, Carpentier, ICML 2016) | threshold, fixed budget | pull argmin √Tᵢ·(\|μ̂ᵢ − τ\| + ε) | none; anytime, output {μ̂ ≥ τ} when stopped | error ≤ exp(−T/(64R²H)) with H = Σ(\|μᵢ−τ\|+ε)⁻², proven optimal; plots only, beaten only by UCBE tuned with the unknown H | R-sub-Gaussian rewards, R not needed |
| [LSA](#lsa) (Tao et al. 2019) | threshold, fixed budget, expected # misclassified | pull argmin α·Tᵢ·Δ̂ᵢ² + ½ ln Tᵢ | none; anytime | uniform "may need Ω(K) times more budget" (their App. C) | rewards in [0,1] |
| [AugUCB](#augucb) (Mukherjee et al. 2017) | threshold, fixed budget | UCB with variance estimates, eliminates explored arms | elimination | "significantly better" than APT/CSAR in their simulations | bounded rewards, uses variance |
| [LUCB](#lucb) (Kalyanakrishnan et al., ICML 2012) | top-m, fixed confidence | sample the two "most likely to be wrong" arms, h* and l* | stop when UCB(l*) − LCB(h*) < ε | expected samples O(H^{ε/2} log(H^{ε/2}/δ)) vs Halving's O((n/ε²) log(m/δ)); no experiments | rewards in [0,1] (Hoeffding) |
| [LSE](#lse) (Gotovos et al., IJCAI 2013) | threshold (level set), fixed confidence | sample argmax ambiguity min(max C − h, h − min C) = β^½σ − \|μ − h\| | classify when interval ± ε clears h; stop when none left | beats max-variance sampling; ≈ straddle; implicit (relative) thresholds much costlier | Gaussian process, Gaussian noise |
| [Opt-KG](#optkg) (Chen, Lin, Zhou 2014) | threshold 0.5 on soft label, fixed budget, Bayesian | argmax over items of the *optimistic* one-step gain in expected accuracy | none (budget) | beats uniform, KG, Gittins in plots; low budget puts most-ambiguous items aside | Beta–Bernoulli per item |
| [AR](#ar) (Heckel, Shah, Ramchandran, Wainwright, AoS 2019) | top-k / any rank partition, pairwise, fixed confidence | every unassigned item vs a uniformly random opponent | assign item when its Borda-score CI clears the boundary; stop when all assigned | active vs passive up to factor n (n² vs n³ in their example); parametric models help only by log factors | none beyond P bounded away from 0/1 |
| [Mohajer](#mohajer) (Mohajer, Suh, Elmahdy, ICML 2017) | top-K, pairwise | tournament + heap, repeated comparisons | fixed repetition count set from Δ_K | Ω(log n / log log n) under BTL; larger under uniform noise | general, includes BTL, SST, uniform noise |
| [Match quality](#ts) (Herbrich, Minka, Graepel, NIPS 2006) | fair/fun matches | maximise relative draw probability | n/a | none claimed for information | TrueSkill (Thurstone, β) |
| [BALD](#bald) (Houlsby et al. 2011) | EIG for probit/preference | argmax closed-form mutual information | n/a | (classification experiments) | probit likelihood, Gaussian posterior |
| [ASAP](#asap) (Mikhailiuk et al., ICPR 2020) | score accuracy (RMSE), pairwise | argmax expected KL over full posterior; MST batches | none (budget) | 7,065 vs 10,550 comparisons (Hybrid-MST) to RMSE 0.15 at n=200 | Thurstone Case V, TrueSkill-like EP |
| [Hybrid-MST](#hmst) (Li et al., NeurIPS 2018) | score accuracy, pairwise | EIG (global max or MST batch) | none | 74.9–77.1% fewer than full pairwise design at 15 repetitions | Bradley–Terry |
| [Just sort it](#sort) (Maystre & Grossglauser, ICML 2017) | full ranking | repeated Quicksort | none | "much better than random"; uncertainty sampling ≈ Bayesian EIG | Bradley–Terry |
| [Noisy sorting](#bm) (Braverman & Mossel 2008; Gu & Xu 2023) | exact order | sorting network / insertion | n/a | Θ(n log n) comparisons | fixed flip probability p, independent of the gap |
| [Noisy binary search](#kk) (Karp & Kleinberg, SODA 2007) | insert one item in an ordered list | weighted-belief binary search | output a "good coin" | O(log n / ε²) flips, optimal | coins with monotone heads probabilities |

### Threshold and top-k bandits

<a id="apt"></a>
**APT, "An optimal algorithm for the Thresholding Bandit Problem".**
Locatelli, Gutzeit, Carpentier, ICML 2016
([arXiv:1605.08671](https://arxiv.org/abs/1605.08671)).

- *Goal:* "correctly discriminate arms that belong to S_{τ+ε} from those in
  S^C_{τ−ε}". The loss is 1 if any arm outside the 2ε strip is misclassified.
  "For arms that lie inside this 2ε strip, mistakes on the other hand bear no
  cost" (§2.1).
- *Rule:* pull every arm once, then pull argmin_k B_k(t) with
  B_i(t+1) = √T_i(t) · (|μ̂_i(t) − τ| + ε) (Eq. 4–5). Output Ŝ_τ = {k : μ̂_k(T) ≥ τ}
  (Algorithm 1). The heuristic: a near-optimal static allocation has T_k·Δ_k²
  constant across k, so you pull the arm that minimises an estimate of it.
- *Stopping:* none. APT is fixed-budget and anytime, and it does not need to
  know T.
- *Guarantee:* E[L(T)] ≤ exp(−T/(64R²H) + 2 log((log T + 1)K)), where
  H = Σ_i (|μ_i − τ| + ε)⁻² (Theorem 2). It is minimax-optimal up to constants
  over problems of complexity H.
- *Noise:* R-sub-Gaussian arms. "One does not need to know R in order to
  implement the algorithm." The paper sketches heavy-tailed extensions.
- *Savings:* shown only as plots (K = 10 Bernoulli and Gaussian arms,
  T = 500, 5,000 runs). APT is "only outperformed by methods that have an
  advantage": UCBE given the unknown H. Other UCBE settings fall to
  "comparable to the naive strategy UA" (uniform allocation). The paper notes
  that uniform allocation "is known to be optimal if all arms are equally
  difficult to classify".
- *Arithmetic, not from the paper:* uniform gives each arm T/K pulls. It
  therefore needs T on the order of K · max_i Δ_i⁻², against APT's H = Σ Δ_i⁻².
  The saving is the ratio of those two numbers. An illustration: 500
  wallpapers with Scores spread evenly within ±10 of the Bar and ε = 1 give
  Σ Δ⁻² ≈ 45 vs K·max Δ⁻² = 500, about 11× fewer samples. These are bandit
  samples, not votes, so this does not replace the harness.

<a id="lsa"></a>
**LSA, "Thresholding Bandit with Optimal Aggregate Regret".** Tao, Blanco,
Peng, Zhou, NeurIPS 2019 ([arXiv:1905.11046](https://arxiv.org/abs/1905.11046)).

- *Goal:* aggregate regret, "the expected number of errors after T samples".
  This is the right metric if a few wallpapers on the Bar may stay Undecided.
  "If a few tasks are extremely ambiguous … a good learner may turn to
  accurately label the less ambiguous tasks."
- *Rule:* pull argmin_i α·T_i·Δ̂_i² + ½ ln T_i (Algorithm 1, α = 1.35 in the
  experiments). This is APT without ε plus a log-count incentive.
- *On APT:* "the choice of precision parameter ε has significant influence …
  the optimal selection … may differ significantly across the instances, and
  also depends on the budget T."
- *Savings:* "the uniform sampling approach may need Ω(K) times more budget
  than the optimal algorithm to achieve the same aggregate regret" (App. C).
  It is instance-wise asymptotically optimal.
- *Noise:* rewards supported on [0, 1].

<a id="augucb"></a>
**AugUCB, "Thresholding Bandits with Augmented UCB".** Mukherjee et al.,
IJCAI 2017 ([arXiv:1704.02281](https://arxiv.org/abs/1704.02281)). A
fixed-budget variant that "uses both mean and variance estimates to eliminate
arms that have been sufficiently explored". It is "significantly better than
… APT, CSAR" in their simulations. It is included for completeness; our
posterior already carries a variance (σ²), which is its selling point.

<a id="lucb"></a>
**LUCB, "PAC Subset Selection in Stochastic Multi-armed Bandits".**
Kalyanakrishnan, Tewari, Auer, Stone, ICML 2012
([PDF](https://icml.cc/2012/papers/359.pdf)).

- *Goal:* return m arms that are all ε-close to the true top m, with
  probability ≥ 1 − δ (fixed confidence).
- *Stopping rule* (§3.1): h* is the lowest-LCB arm among the empirical top m;
  l* is the highest-UCB arm among the rest. "Terminate iff
  p̂_{l*} + β(u_{l*}, t) − (p̂_{h*} − β(u_{h*}, t)) < ε." The rule is separate
  from the sampling strategy, and it is correct under *any* sampling strategy
  (Theorem 1).
- *Sampling* (§3.2): "sample arms h*_t and l*_t", "the arms that are most
  likely to lead to a mistake".
- *Guarantee:* expected sample complexity O(H^{ε/2} log(H^{ε/2}/δ)), where
  H^γ = Σ_a 1/max(Δ_a, γ)². Halving "uniformly has a sample complexity of
  O((n/ε²) log(m/δ)) … inefficient except on those instances for which
  H^{ε/2} ≈ n/ε²".
- *Noise:* rewards in [0, 1], via Hoeffding. There are no experiments.
- *Relevance:* LUCB is the top-m form. It fits if the Bar is a *quantile*
  ("clear out the worst 50") rather than a Score. The boundary it separates
  is then between the m-th and (m+1)-th wallpaper, and the algorithm has to
  learn where that is.

<a id="lse"></a>
**LSE, "Active Learning for Level Set Estimation".** Gotovos, Casati, Hitz,
Krause, IJCAI 2013 ([PDF](https://www.ijcai.org/Proceedings/13/Papers/202.pdf)).

- *Why it matters most:* the posterior over each point is Gaussian (μ_t, σ_t),
  as TrueSkill's is.
- *Classification* (Algorithm 1): each point keeps a confidence region C_t(x),
  the intersection of successive intervals μ ± β^½σ.
  - "if min(C_t(x)) + ε > h then … H_t ← H_t ∪ {x}".
  - "else if max(C_t(x)) − ε ≤ h then … L_t ← L_t ∪ {x}".
  - "LSE uses a monotonic classification scheme … once a point has been
    classified, it stays so." Open question 1 below covers what this means
    for #368.
- *Selection:* "a_t(x) = min{max(C_t(x)) − h, h − min(C_t(x))}, which we call
  ambiguity". Pick the unclassified x with the largest a_t. Using the plain
  interval gives β^½σ − |μ − h|. "For β^½ = 1.96, this is identical to the
  straddle [Bryan et al., 2005] selection rule."
- *Stopping:* "The algorithm terminates when all points in D have been
  classified". Theorem 1 bounds the iterations via the GP information gain.
- *Empirical:* LSE ≈ straddle, and both clearly beat max-variance sampling
  ("deemed unsuitable for the task of level set estimation"). F1 is plotted
  against samples; there is no headline percentage.
- *Two lessons for the Bar:*
  1. **Implicit thresholds cost more.** When the threshold is defined relative
     to the data (ω × max), it takes "notably larger sampling cost", and
     "the naive STR_imp algorithm completely fails … since the straddle rule
     is not sufficiently exploratory". A Bar tied to where the library sits
     now, such as a quantile, is in this harder class.
  2. **Top-B batches are redundant.** Taking the B highest-straddle points as
     a batch "performs significantly worse … since it selects a lot of
     redundant samples". Bear this in mind for best-of-N (technique 2).

<a id="optkg"></a>
**Opt-KG, "Statistical Decision Making for Optimal Budget Allocation in Crowd
Labeling".** Chen, Lin, Zhou, ICML 2013 / JMLR 2015
([arXiv:1403.3080](https://arxiv.org/abs/1403.3080)).

- *Model:* each item has a Beta posterior over its soft label θ_i. The item
  is positive iff θ_i ≥ 0.5, which makes this a threshold problem in Bayesian
  form.
- *Objective:* expected accuracy Σ_i h(P_i), where h(x) = max(x, 1 − x)
  (Eq. 7–8). This is the Bayesian form of LSA's aggregate regret.
- *Rule:* the stage reward R(a, b) is the one-step expected gain in accuracy
  from labelling an item. Plain KG "is not consistent"; randomized KG "behaves
  similarly to the uniform sampling". Opt-KG picks argmax_i
  max(R₁(aᵢ, bᵢ), R₂(aᵢ, bᵢ)), the *optimistic* outcome (Algorithm 1). It is
  consistent (Theorem 4.2).
- *Behaviour:* "when the budget is limited, we should simply put those few
  highly ambiguous instances aside to save budget for labeling less difficult
  instances". Ambiguous items get more labels, except at low budget (Fig. 4).
- *Savings:* plots (K = 50, T = 2K–20K, and the RTE dataset). Opt-KG
  "outperforms all the other competitors in most settings", and "randomized
  KG only slightly improves that of uniform sampling".
- *Noise:* Beta–Bernoulli, extended to workers of varying reliability.

<a id="ar"></a>
**AR, "Active Ranking from Pairwise Comparisons and when Parametric
Assumptions Don't Help".** Heckel, Shah, Ramchandran, Wainwright, Annals of
Statistics 2019 ([arXiv:1606.08842](https://arxiv.org/abs/1606.08842)).

- *Goal:* any partition by rank (top-k, several bands, or a full ranking) of
  the Borda score τ_i, "the probability that item i beats an item chosen
  uniformly at random".
- *Rule* (Algorithm 1): "For every i ∈ S: compare item i to an item chosen
  uniformly at random from [n] \ {i}".
- *Stopping:* an item is assigned to a band once its score estimate is
  4α_t clear of the neighbouring band boundary. The theory uses
  α_t = √(log(125 n log(1.12t)/δ)/t). The algorithm terminates "if S = ∅".
  The authors call this constant "very conservative"; a ~¼ constant was still
  δ-accurate (§5.2).
- *Savings:* active top-k needs about Σ_{i≤k} (τ_i − τ_{k+1})⁻² +
  Σ_{i>k} (τ_k − τ_i)⁻² comparisons, up to logs. Passive needs
  n log n / (τ_k − τ_{k+1})². "The difference in sample complexity can be as
  large as a factor of n": with gaps of order 1/n, active needs n² and
  passive n³.
- *Noise:* none beyond pairwise probabilities bounded away from 0 and 1.
  "Parametric models … offer at most logarithmic gains", and algorithms built
  for parametric models "start to break down even if the parametric modeling
  assumption is only slightly violated" (§5).
- *Relevance:* this is the robustness argument against leaning too hard on
  TrueSkill's Thurstone model with a fixed β. A curator's taste drifts, and
  wallpapers are not transitive in the way players are.

<a id="mohajer"></a>
**"Active Learning for Top-K Rank Aggregation from Noisy Comparisons".**
Mohajer, Suh, Elmahdy, ICML 2017
([PDF](https://proceedings.mlr.press/v70/mohajer17a/mohajer17a.pdf)).
It splits the items into K subsets, finds each subset's winner by a
single-elimination tournament with *repeated* comparisons, and then runs a
max-heap. It needs O((n + K log K)·max(log log n, log K)/Δ_K) samples. The gain
over passive "is Ω(log n / log log n), which is not quite significant" under
BTL, and larger under uniform noise. The repetition count depends on the
separation Δ_K. It is a fixed design, not a posterior-driven one, and a poor
fit for an app that already keeps a posterior.

### Pair choice under TrueSkill: match quality and information gain

<a id="ts"></a>
**TrueSkill match quality.** Herbrich, Minka, Graepel, "TrueSkill™: A Bayesian
Skill Rating System", NIPS 2006
([PDF](https://papers.nips.cc/paper_files/paper/2006/file/f44ee263952e65b3610b8ba51229d1f9-Paper.pdf)).

- *Definition:* "Pairwise matchmaking of players is performed using a match
  quality criterion derived as the draw probability relative to the highest
  possible draw probability in the limit ε → 0" (Eq. 7). For one-vs-one it is
  q = √(2β²/c²) · exp(−(μᵢ − μⱼ)²/(2c²)), with c² = 2β² + σᵢ² + σⱼ².
- *Check:* with walltare's constants two new wallpapers give
  q = √(34.73/173.6) = 0.447. That matches the reference library's documented
  "44.7% chance to draw" ([trueskill.org](https://trueskill.org/);
  [`quality_1vs1`](https://github.com/sublee/trueskill/blob/master/trueskill/__init__.py)
  returns `env.quality`, "the draw probability").
- *Purpose:* Microsoft's project page says "the more even the skills of match
  participants, … the more interesting and fun the match will be". It also
  says TrueSkill's purpose is "to minimize the number of games necessary to
  find out a gamer's skill". Its table puts "2 Players Free-For-All" at 12
  games per gamer, "up to three times higher depending on … the availability
  of well-matched opponents"
  ([MSR project page](https://www.microsoft.com/en-us/research/project/trueskill-ranking-system/)).
- *Evaluation:* match quality is evaluated for predicting draws, not for
  information.
- *What's wrong with it:* q *rises* as σ falls (the √(2β²/c²) factor). So it
  prefers two well-known wallpapers of equal Score, and that Comparison teaches
  the app almost nothing. See the table below.

<a id="bald"></a>
**BALD, "Bayesian Active Learning for Classification and Preference
Learning".** Houlsby, Huszár, Ghahramani, Lengyel 2011
([arXiv:1112.5745](https://arxiv.org/abs/1112.5745)).

- *Formula:* for a probit likelihood with a Gaussian posterior f ~ N(m, v),
  the mutual information between the outcome and the parameters is
  I ≈ h(Φ(m/√(v+1))) − C/√(v+C²) · exp(−m²/(2(v+C²))), with
  C = √(π ln 2 / 2) and h the binary entropy in bits (Eq. 3–4). "Fig. 1
  depicts the striking accuracy of this simple approximation."
- *Preference learning:* it "is equivalent to GPC with a particular class of
  kernels". The outcome depends only on g = f(u) − f(v).
- *TrueSkill mapping (mine):* P(i beats j | s) = Φ((sᵢ − sⱼ)/(√2 β)). So
  m = (μᵢ − μⱼ)/(√2 β) and v = (σᵢ² + σⱼ²)/(2β²). Note that
  m/√(v+1) = (μᵢ − μⱼ)/c, which is TrueSkill's own predicted win probability.
  Each candidate costs a handful of flops, so choosing among n opponents is
  O(n).

Verification (script in the session scratchpad; "exact" is numerical
integration over s_i − s_j, β = 4.167):

| Δμ | σᵢ | σⱼ | exact EIG (bits) | BALD EIG | match quality q |
|---:|---:|---:|---:|---:|---:|
| 0 | 8.333 | 8.333 | 0.5385 | 0.5374 | 0.447 |
| 0 | 8.333 | 1 | 0.4099 | 0.4090 | 0.575 |
| 0 | 4 | 4 | 0.2646 | 0.2641 | 0.721 |
| 0 | 2 | 2 | 0.0916 | 0.0915 | 0.902 |
| 0 | 1 | 1 | 0.0255 | 0.0254 | 0.972 |
| 5 | 8.333 | 8.333 | 0.5060 | 0.5050 | 0.416 |
| 5 | 2 | 2 | 0.0732 | 0.0725 | 0.673 |
| 10 | 4 | 4 | 0.1432 | 0.1417 | 0.341 |

BALD is within 0.002 bits of exact. Match quality is anti-correlated with
information whenever σ varies.

Pair EIG is information about *both* Scores. For the Bar we care only about
Undecided wallpapers' sides. A Comparison against a Decided opponent is worth
the information it gives about the Undecided one. That is not a published rule;
open question 3 below covers it.

<a id="asap"></a>
**ASAP, "Active Sampling for Pairwise Comparisons via Approximate Message
Passing and Information Gain Maximization".** Mikhailiuk, Wilmot,
Pérez-Ortiz, Yue, Mantiuk, ICPR 2020
([arXiv:2004.05691](https://arxiv.org/abs/2004.05691)).

- *Model:* "similar to Thurstone's model Case V". The posterior is a factor
  graph "inspired by TrueSkill" with EP moment matching, and
  σ²_ij = σᵢ² + σⱼ² + β².
- *EIG* (Eq. 5): the outcome-weighted KL divergence between the updated
  posterior and the prior.
  - Full selection is O(n²(n + t)).
  - "ASAP-approx" updates online (ADF, i.e. TrueSkill-style) in O(n²).
  - "Selective EIG" evaluates only pairs with probability
    Qᵢⱼ = min(pᵢⱼ, pⱼᵢ), saving "up to 80%" of computations.
  - Batches form a minimum spanning tree on 1/EIG, which avoids imbalanced
    designs.
- *Findings:*
  - ASAP with the full posterior update is "the most accurate by a
    substantial margin".
  - ASAP-approx, which is closest to what walltare stores, only "offers a
    modest but consistent improvement … over Hybrid-MST".
  - "TS-sampling" (TrueSkill matchmaking) is "among the worst methods for the
    small range".
  - To reach RMSE 0.15 at n = 200, ASAP needs 7,065 comparisons against
    Hybrid-MST's 10,550.
  - "For SROCC [rank correlation], EIG-based methods do not show a clear
    advantage over sorting methods".
- *Stopping:* none; it runs to a budget. The objective is score RMSE, not
  side-of-Bar.

<a id="hmst"></a>
**Hybrid-MST.** Li, Mantiuk, Wang, Ling, Le Callet, NeurIPS 2018
([arXiv:1810.08851](https://arxiv.org/abs/1810.08851)). It uses Bradley–Terry
EIG, switching between the global maximum and an MST batch by budget. Against
a full pairwise design repeated 15 times, "The obtained Bs [budget saved] for
Kendall, PLCC and RMSE are 77.11%, 74.89% and 74.89%". Crowd-BT saved 78.43%
on Kendall only.

<a id="sort"></a>
**"Just Sort It! A Simple and Effective Approach to Active Preference
Learning".** Maystre & Grossglauser, ICML 2017
([arXiv:1502.05556](https://arxiv.org/abs/1502.05556)).

- *Strategy:* repeatedly run Quicksort. It uses O(n log n) comparisons per
  run, and O(log⁵ n) aggregated runs recover all but a vanishing fraction of
  ranks under BT.
- *Uncertainty sampling* (pick the pair with argmin |θᵢ − θⱼ|): the two
  Bayesian methods "perform the best … but are nearly indistinguishable from
  uncertainty sampling" (synthetic, n = 200). Sorting reaps "most of the
  benefits".
- *Cost:* Bayesian EIG took 40–71 s to pick one pair at n = 10³, against
  "ε" for sorting (Table 1). BT and full ranking throughout, with no stopping
  rule.

### Noisy sorting

<a id="bm"></a>
**Braverman & Mossel, "Noisy sorting without resampling"**
([arXiv:0707.1051](https://arxiv.org/abs/0707.1051)). Each pair's answer is
right "with probability at least 1/2 + γ … errors are independent". It finds
the maximum-likelihood order with O_γ(n log n) samples, and even that order
has max displacement Θ(log n).

<a id="guxu"></a>
**Gu & Xu, "Optimal Bounds for Noisy Sorting"**, STOC 2023
([arXiv:2302.12440](https://arxiv.org/abs/2302.12440)). With a fixed flip
probability p, (1 ± o(1))·(1/I(p) + 1/((1−2p) log₂((1−p)/p)))·n log₂ n
comparisons are necessary and sufficient. The same holds for noisy binary
search.

<a id="kk"></a>
**Karp & Kleinberg, "Noisy binary search and its applications"**, SODA 2007
([PDF](https://www.cs.cornell.edu/~rdk/papers/karpr2.pdf)). Coins are ordered
by an unknown, monotone heads probability. The task is to find where a target
τ falls, "admitting new members into an organization ranked by ability, such
as a tennis ladder". It needs O(log n / ε²) expected flips, and O((log n +
log log(1/ε))/ε²) when ε is unknown. Both are optimal.

**Why noisy sorting doesn't fit the Bar:** its flip probability is fixed.
Under TrueSkill it grows toward ½ as two Scores approach each other, so every
wallpaper is hard to order against its neighbours. The thresholding papers'
Δ and ε are the tools for that. Noisy binary search does transfer to the
*triage* technique: it places a new wallpaper against a ladder of
confident reference wallpapers.

## What today's `select_pair` is, in these terms

`ranking::select_pair` draws the least-compared wallpaper first, which makes
Comparison counts nearly equal. That is **uniform allocation** (APT's "UA"),
optimal only "if all arms are equally difficult to classify". It then picks an
opponent with weight exp(−½((μⱼ − μᵢ)/σᵢ)²). That is close to **uncertainty
sampling**, and to the exp term of match quality with σᵢ in place of c. So the
opponent half is already near what Maystre & Grossglauser found competitive.
The first pick is where the thresholding literature says the votes go to
waste.

## Translating the candidates to walltare (synthesis, needs the harness)

None of these papers uses TrueSkill posteriors with a Bar. The rules below are
direct translations, not published algorithms. The harness should rank them.

- **Decided (for #368):** Undecided while |μ − Bar| < kσ − ε (LSE's rule,
  plain interval). k plays the role of β^½ (LSE used 3 in experiments, 1.96
  for straddle). ε is the fuzzy middle.
- **First pick (technique 1), candidates:**
  1. *Straddle/LSE:* argmax over Undecided of kσ − |μ − Bar|.
  2. *APT:* argmin (|μ − Bar| + ε)/σ. σ plays the role of 1/√T. The log-count
     term from LSA can be added as a tie-breaker so that wallpapers sitting on
     the Bar don't soak up the budget.
  3. *Opt-KG:* argmax over Undecided of the optimistic gain in
     max(P, 1 − P), where P = Φ((μ − Bar)/σ), taking the better of the two
     `rate_1vs1` outcomes.
- **Opponent (technique 3), candidates:**
  1. Today's μ-proximity (uncertainty sampling).
  2. BALD pair EIG (closed form above).
  3. A threshold-aware one-step lookahead. For each candidate j, run
     `rate_1vs1` both ways (it is cheap) and score the expected drop in
     Σ over Undecided wallpapers of min(P, 1 − P). Only the two wallpapers in
     the Comparison change, so it is O(1) per candidate.

   Avoid `quality_1vs1`.
- **Once everything is Decided:** the literature just stops, or keeps spending
  the budget on the hardest items (APT/LSA never stop). The product decision
  sits with #370.

## Open questions this research can't settle

1. **Can Decided revert?** LSE classifies monotonically: once classified,
   always classified. TrueSkill posteriors can move back toward the Bar after
   an upset, and τ = 0.083 inflates σ slightly on every Comparison a
   wallpaper takes part in. Whether a Decided wallpaper becomes Undecided
   again is #368's call. The LSE design exists because letting intervals
   re-widen breaks its termination proof.
2. **Is the Bar a Score or a quantile?** An absolute Score is the explicit
   threshold (APT, LSE). "The worst N" is top-k or implicit (LUCB, AR, LSE_imp),
   and it "requires notably larger sampling cost" (LSE). `CONTEXT.md` says a
   Score is only comparable within one library, which a fixed Score Bar
   ignores.
3. **Opponents that are already Decided.** Pair EIG counts information about
   both sides. If the opponent is Decided, only the first pick's information
   matters. Anchoring against low-σ wallpapers near the Bar looks efficient,
   because their information goes to the Undecided side. That is how Karp &
   Kleinberg's coins work, but it is not a published rule for this setting.
4. **Model misspecification.** AR shows parametric structure buys at most log
   factors in the stochastic regime, and that parametric algorithms degrade
   under slight violation. The harness should use a voter that is *not*
   exactly Thurstone with β = 4.167 (Bradley–Terry, drifting taste, or
   occasional random clicks). Otherwise it will flatter any posterior-driven
   rule.

## Sources

Primary sources, all read in full text:

- Locatelli, Gutzeit, Carpentier. *An optimal algorithm for the Thresholding Bandit Problem.* ICML 2016. https://arxiv.org/abs/1605.08671
- Tao, Blanco, Peng, Zhou. *Thresholding Bandit with Optimal Aggregate Regret.* NeurIPS 2019. https://arxiv.org/abs/1905.11046
- Mukherjee, Purushothama, Sudarsanam, Ravindran. *Thresholding Bandits with Augmented UCB.* IJCAI 2017. https://arxiv.org/abs/1704.02281
- Kalyanakrishnan, Tewari, Auer, Stone. *PAC Subset Selection in Stochastic Multi-armed Bandits.* ICML 2012. https://icml.cc/2012/papers/359.pdf
- Gotovos, Casati, Hitz, Krause. *Active Learning for Level Set Estimation.* IJCAI 2013. https://www.ijcai.org/Proceedings/13/Papers/202.pdf
- Chen, Lin, Zhou. *Statistical Decision Making for Optimal Budget Allocation in Crowd Labeling.* https://arxiv.org/abs/1403.3080
- Heckel, Shah, Ramchandran, Wainwright. *Active Ranking from Pairwise Comparisons and when Parametric Assumptions Don't Help.* https://arxiv.org/abs/1606.08842
- Mohajer, Suh, Elmahdy. *Active Learning for Top-K Rank Aggregation from Noisy Comparisons.* ICML 2017. https://proceedings.mlr.press/v70/mohajer17a/mohajer17a.pdf
- Herbrich, Minka, Graepel. *TrueSkill™: A Bayesian Skill Rating System.* NIPS 2006. https://papers.nips.cc/paper_files/paper/2006/file/f44ee263952e65b3610b8ba51229d1f9-Paper.pdf
- Microsoft Research, TrueSkill project page. https://www.microsoft.com/en-us/research/project/trueskill-ranking-system/
- python-trueskill 0.4.5 docs and source. https://trueskill.org/, https://github.com/sublee/trueskill/blob/master/trueskill/__init__.py
- Houlsby, Huszár, Ghahramani, Lengyel. *Bayesian Active Learning for Classification and Preference Learning.* https://arxiv.org/abs/1112.5745
- Mikhailiuk, Wilmot, Pérez-Ortiz, Yue, Mantiuk. *Active Sampling for Pairwise Comparisons via Approximate Message Passing and Information Gain Maximization.* ICPR 2020. https://arxiv.org/abs/2004.05691
- Li, Mantiuk, Wang, Ling, Le Callet. *Hybrid-MST: A Hybrid Active Sampling Strategy for Pairwise Preference Aggregation.* NeurIPS 2018. https://arxiv.org/abs/1810.08851
- Maystre, Grossglauser. *Just Sort It! A Simple and Effective Approach to Active Preference Learning.* ICML 2017. https://arxiv.org/abs/1502.05556
- Braverman, Mossel. *Noisy sorting without resampling.* SODA 2008. https://arxiv.org/abs/0707.1051
- Gu, Xu. *Optimal Bounds for Noisy Sorting.* STOC 2023. https://arxiv.org/abs/2302.12440
- Karp, Kleinberg. *Noisy binary search and its applications.* SODA 2007. https://www.cs.cornell.edu/~rdk/papers/karpr2.pdf
