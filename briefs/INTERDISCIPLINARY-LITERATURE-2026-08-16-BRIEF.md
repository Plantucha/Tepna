<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED · **Created:** 2026-08-16 · **Affects:** `papers/`, `docs/`, `audits/CITATION-VERIFICATION-2026-08-05.json` · **Follows:** `LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`, `PAPERS-ROADMAP-2026-06-24-BRIEF.md`

> **The measured gap:** this repository holds **86 author-verified DOIs**, and **exactly one** is
> outside clinical medicine. Meanwhile the suite's live problems are a three-cornered hat, a host
> clock axis, an identifiability failure, an integer-ambiguity alignment, and an oracle problem —
> none of which are biomedical. This brief is a reading queue for that gap, with citations verified
> to author · year · venue and, where one exists, DOI.

---

## 0 · Why this exists, and what it is not

`LITERATURE-USE-POLICY` §2 already governs *how* a paper may enter the suite. This brief answers a
prior question: **which literatures should we be reading at all?** The answer is not "more
physiology". Measured over `audits/CITATION-VERIFICATION-2026-08-05.json`:

| container | DOIs |
|---|---|
| Physiological Measurement | 7 |
| Sensors | 6 |
| IEEE Trans. Biomedical Engineering | 4 |
| Diabetes Care | 4 |
| Chest · Lancet · JAMA · JCSM · Sleep & Breathing · … | ~63 |
| **outside biomedicine** | **1** |

**This is a reading queue, not a set of adopted methods.** Nothing below has been read end to end by
the author of this brief; every entry was surfaced by search and checked for existence, author and
venue. Per `LITERATURE-USE-POLICY` §2, a paper-sourced number is `validated`-tier **only** with a
real, checkable citation — so each entry is ledgered at the point it enters a document, not here.

⚠️ **`briefs/` is deliberately outside the `citation-ledger` gate** (a brief quotes a wrong
attribution *in order to say it is wrong*, so gating it runs ~35 % false positives). That exemption
is why this brief can carry unledgered DOIs — and why moving any of them into `papers/`, `docs/**.md`
or a root `*.js` **requires** a `CITATION-VERIFICATION` entry naming the right first author, or
`citation-ledger` reds.

---

## 1 · Metrology and measurement uncertainty

**Tepna problem.** The suite repeatedly asks "do these two sensors agree?" and answers with a
difference. Metrology asks a stricter question — are the results *compatible given their
uncertainties* — and that is a different test.

| work | detail | status |
|---|---|---|
| **JCGM 200:2008** — *International Vocabulary of Metrology (VIM3)* | defines **metrological compatibility**: two results are compatible when \|difference\| < k · u(difference) | verified, no DOI (standards body) |
| **JCGM GUM-6:2020** — *Guide to the expression of uncertainty in measurement — Developing and using measurement models* | the measurement model as the object of study | verified, no DOI |
| **Possolo & Toman**, NIST — *Assessing differences between results determined according to the GUM* | compatibility testing vs the pairwise **Birge test** | PMC4548867 · DOI unverified |
| **Koepke, Lafarge, Possolo & Toman**, NIST — *Combining results from multiple evaluations of the same measurand* | directly applicable to the Integrator's fusion layer | PMC4551221 · DOI unverified |

**Do:** replace "A and B agree" with a compatibility statement wherever the agreement gate, the
equivalence legs, or the H10↔Verity comparisons make one.

## 2 · Time and frequency metrology

**Tepna problem.** `hostAxis`, Allan deviation and the drift work were arrived at independently. The
vocabulary is mature and mostly already cited **in prose but not in the ledger**.

| work | detail | status |
|---|---|---|
| **Allan, D. W. (1966)** — *Statistics of atomic frequency standards*, Proc. IEEE 54(2):221–230 | already cited in `sigma-no-reference` | verified · **unledgered** |
| **Gray, J. E. & Allan, D. W. (1974)** — *A method for estimating the frequency stability of an individual oscillator*, Proc. 28th Ann. Symp. Frequency Control | the three-cornered hat | verified · **unledgered** |
| **Premoli, A. & Tavella, P. (1993)** — *A revisited three-cornered hat method…*, IEEE Trans. Instrum. Meas. 42(1):7–13 | negative variance handling | verified · **unledgered** |
| **Torcaso, F., Ekstrom, C. R., Burt, E. A. & Matsakis, D. N. (1998)** — *Estimating frequency stability and cross-correlations*, Proc. 30th PTTI | correlated corners — the assumption the σ paper concedes is bent | verified · **unledgered** |
| **Riley, W. J. (2008)** — *Handbook of Frequency Stability Analysis*, NIST Special Publication 1065 | σ_y(τ), TDEV, Hadamard, noise-type-by-slope | verified · **unledgered** |
| **Riley, W. J. & Greenhall, C. A. (2004)** — *Power law noise identification using the lag 1 autocorrelation*, 18th European Frequency and Time Forum, Guildford — **DOI 10.1049/cp:20040932** | **names the dominant noise type analytically, from phase or frequency data, at any averaging factor, WITHOUT fitting a slope** | verified + DOI |
| **Zhou, Greenhall & Howe (2011)** — *Power law noise identification using the lag 1 autocorrelation by overlapping samples*, IEEE | extends the above to the overlapping estimator we actually use | venue verified · DOI unverified |
| **IEEE Std 1139** — *Definitions of Physical Quantities for Fundamental Frequency and Time Metrology* | TIE, TDEV, MDEV; phase vs frequency noise | verified, standard |

⚠️ **PRECONDITION, added 2026-08-16 after Vigil box's review — do not adopt this before the parity
story is settled.** `#1334` pinned **three** implementations of the slope-threshold rule (`clock.js`
`CK_ALLAN_NOISE`, `ppgdex-dsp.js` `ALLAN_NOISE`, `capture-host/allan.py` `_NOISE`) with a gate holding
their tables equal. Replacing only the Python one with a lag-1 identifier would put the lanes on
**genuinely different algorithms** rather than the same algorithm with different rounding — a
divergence a table-equality gate structurally cannot express. Either all three move, or the gate must
be redesigned first. Mitigating factor: **AllanTools implements lag-1 identification**
(anderswallin.net, 2018), so a Python implementation has a real known-answer reference to check
against rather than a re-derivation — which `allan.py` is otherwise short of.

**Do (highest value in this brief).** `classifyAllan` / `allan.py classify` name a noise type by a
strict `<` against a **point estimate** near a boundary, which is why a `1.96·SE` refusal band exists
and why a full Riley EDF treatment is circular (EDF needs the noise type). **Riley & Greenhall 2004
breaks that circle**: an analytic identification that never computes a slope has no boundary to sit
near. That would retire the refusal band rather than tune it.

**Also owed:** the five entries marked *unledgered* are cited in `papers/sigma-no-reference.html`
prose today and are invisible to `citation-ledger`. Adding them is cheap and closes a real hole.

## 3 · Identifiability and observability

**Tepna problem.** "The algorithm could not recover this" is the wrong sentence. "Is this parameter
identifiable from these observations?" has an answer, a method, and a literature.

| work | detail | status |
|---|---|---|
| **Raue, A., Kreutz, C., Maiwald, T., Bachmann, J., Schilling, M., Klingmüller, U. & Timmer, J. (2009)** — *Structural and practical identifiability analysis of partially observed dynamical models by exploiting the profile likelihood*, Bioinformatics 25(15):1923–1929 | separates **structural** non-identifiability (no data can fix it) from **practical** (this data cannot); yields CIs in the same pass | verified · PMID 19505944 |
| **Wieland, Hauber, Rosenblatt, Tönsing & Timmer (2021)** — *On structural and practical identifiability*, Current Opinion in Systems Biology | review | verified · DOI unverified |

**Do:** three live problems are identifiability problems in disguise — offset + frequency over a short
span (structurally non-identifiable *together*), beat alignment modulo one RR, and the O2Ring having
no oscillator at all (a model-class failure, not an estimator failure). Naming them correctly changes
which experiment comes next.

## 4 · Integer ambiguity resolution — GNSS

**Tepna problem.** "Beat-train alignment pins a clock offset only modulo one RR interval" is the
**carrier-phase integer ambiguity problem**. Satellite navigation has thirty years on it.

| work | detail | status |
|---|---|---|
| **Teunissen, P. J. G. (1995)** — *The least-squares ambiguity decorrelation adjustment: a method for fast GPS integer ambiguity estimation*, Journal of Geodesy 70:65–82 — **DOI 10.1007/BF00863419** | the LAMBDA method | verified + DOI |
| **Teunissen & Massarweh (2024)** — *New LAMBDA toolbox for mixed-integer models: estimation and evaluation*, GPS Solutions — **DOI 10.1007/s10291-024-01738-z** | current implementation | verified + DOI |

**Do — and this is the concrete gap.** GNSS resolves ambiguity in three steps: estimate the float
value → search the best integer set → **validate the fix**. Tepna's beat alignment does the first two
and stops. Two importable things: a **cycle slip** is exactly a dropped or inserted beat and has
formal detection; and the **ratio test / integer success rate** answers "is this alignment
trustworthy on this night?", which the suite currently cannot answer at all.

## 5 · Multisensor estimation under unknown correlation

**Tepna problem.** `sigma-no-reference` limitation (v) concedes the uncorrelated-error assumption is
bent by the O2Ring's smoothing and the Verity's instantaneous derivation. There is an estimator built
for exactly that concession.

| work | detail | status |
|---|---|---|
| **Julier, S. J. & Uhlmann, J. K. (1997)** — *A non-divergent estimation algorithm in the presence of unknown correlations*, Proc. American Control Conference, pp. 2369–2373 — **DOI 10.1109/ACC.1997.609105** | Covariance Intersection: provably consistent under **unknown** cross-correlation | verified + DOI |
| **Noack, Sijs, Reinhardt & Hanebeck (2017)** — *Decentralized data fusion with inverse covariance intersection*, Automatica 79:35–41 | CI is often too conservative; ICI tightens it | verified · DOI unverified |
| **Sijs & Lazar (2012)** — *State fusion with unknown correlation: ellipsoidal intersection*, Automatica 48(8):1874–1878 | alternative bound | verified · DOI unverified |

**Do:** CI degrades to *conservative* rather than to *wrong* when correlation is unknown — the right
failure direction for a suite whose whole discipline is refusing to overclaim.

## 6 · Fault detection and isolation

**Tepna problem.** "Which sensor is lying?" is a forty-year-old question in process control and
aerospace, and the answer is architectural.

| work | detail | status |
|---|---|---|
| **Isermann, R. (1984)** — *Process fault detection based on modeling and estimation methods — a survey*, Automatica 20(4):387–404 | founding survey | verified · DOI unverified |
| **Chow, E. Y. & Willsky, A. S. (1984)** — *Analytical redundancy and the design of robust failure detection systems*, IEEE Trans. Automatic Control 29(7):603–614 | analytical redundancy | verified · DOI unverified |
| **Gertler, J. (1988)** — *Survey of model-based failure detection and isolation in complex plants*, IEEE Control Systems Magazine 8(6):3–11 | **structured vs fixed-direction residuals** — the isolation mechanism | verified · DOI unverified |
| **Patton, R. J. & Chen, J. (1994)** — *Review of parity space approaches to fault diagnosis for aerospace systems*, AIAA J. Guidance, Control & Dynamics 17(2):278–285 | parity space | verified · DOI unverified |
| **Chen, J., Patton, R. J. & Zhang, H.-Y. (1996)** — *Design of unknown input observers and robust fault detection filters*, Int. J. Control 63(1):85–105 | decoupling residuals from unmeasurable disturbances | verified · DOI unverified |

**Do:** shift from "can I compute something from this sensor?" to "can the system **detect** that this
sensor cannot support the inference being attempted?" `timingSource`, `axisDrawn` and the closure
verdict are already primitive structured residuals; the literature says how to design them so faults
are **isolable**, not merely detectable.

## 7 · Jitter decomposition — RJ / DJ

**Tepna problem.** The box's `spreadMs` spans 101–5124 ms and is published as one number.

| work | detail | status |
|---|---|---|
| **Keysight (formerly Agilent)** — *Jitter Analysis: The Dual-Dirac Model, RJ/DJ, and Q-Scale*, application note 5989-3206 | the standard treatment | verified, vendor note |
| **Tektronix** — *Dual-Dirac scope histograms and BERTScan measurements* | practical estimation | verified, vendor note |

**Do:** deterministic jitter is **bounded**, random jitter is **unbounded Gaussian**, and they
separate by tail-fitting. BLE's 7.5 ms connection interval is textbook bounded DJ — arrival latency
spans 0 to exactly one interval — while scheduler contention is unbounded RJ. One `spreadMs`
conflates a hard physical bound with a tail that has no worst case. Allan deviation names noise
*types*; it does not distinguish bounded from unbounded.

## 8 · Generalizability theory

**Tepna problem.** "Is that variance the device, the adapter, or the night?" — and "how many nights do
I need?", which `sensor-trio-nights` currently answers by Monte Carlo under a planted model whose
stated limitation is being fully synthetic.

| work | detail | status |
|---|---|---|
| **Cronbach, L. J., Gleser, G. C., Nanda, H. & Rajaratnam, N. (1972)** — *The Dependability of Behavioral Measurements*, Wiley | replaces one error term with a variance component per **facet** and per interaction | verified, book |
| **Brennan, R. L. (2001)** — *Generalizability Theory*, Springer | standard reference; G-coefficient (relative) vs Φ (absolute) | verified, book |
| **Moore et al. (2024)** — *GeneralizIT: a Python solution for generalizability theory computations*, arXiv 2411.17880 | runnable today | verified, preprint |

**Do — the D-study is the finding.** A **G-study** estimates each variance component from real data; a
**D-study** then projects the reliability of *alternative designs*. That is exactly `sensor-trio-nights`'
question, answered **analytically from the corpus already on disk**. It also subsumes `nights-icc`
(ICC is the single-facet case), and turns `device × adapter × night` from an informal worry into an
estimable interaction term.

## 9 · Change-point detection

**Tepna problem.** ODI, desaturation, apnea and periodic breathing are all "where did this series
change?". The ODI-4 under-count traced to a **trailing-mean baseline artifact** is a known failure
mode of threshold-on-a-moving-average.

| work | detail | status |
|---|---|---|
| **Killick, R., Fearnhead, P. & Eckley, I. A. (2012)** — *Optimal detection of changepoints with a linear computational cost*, JASA 107(500):1590–1598 — **DOI 10.1080/01621459.2012.737745** | PELT: exact, linear-time, penalised segmentation | verified + DOI |
| **Adams, R. P. & MacKay, D. J. C. (2007)** — *Bayesian online changepoint detection*, arXiv 0710.3742 | posterior over change locations, not a threshold crossing | verified, preprint |
| **Page, E. S. (1954)** — *Continuous inspection schemes*, Biometrika 41(1/2):100–115 | CUSUM; still correct for online monitoring | verified · DOI unverified |

**Do:** PELT partitions the **whole** series at once by minimising a global penalised cost, so a deep
event cannot drag the baseline meant to catch it — structurally immune to the artifact that produced
the ODI-4 slope of 0.23. BOCPD adds what no detector here has: a posterior over event locations.

## 10 · Scientific software testing and the oracle problem

**Tepna problem.** The fixture ledger and GATE-B are a hand-rolled answer to a named, surveyed problem.

| work | detail | status |
|---|---|---|
| **Barr, E. T., Harman, M., McMinn, P., Shahbaz, M. & Yoo, S. (2015)** — *The oracle problem in software testing: a survey*, IEEE Trans. Software Engineering 41(5):507–525 — **DOI 10.1109/TSE.2014.2372785** | the survey | verified + DOI |
| **Weyuker, E. J. (1982)** — *On testing non-testable programs*, The Computer Journal 25(4):465–470 | the origin | verified · DOI unverified |
| **Kanewala, U. & Bieman, J. M. (2016)** — *Predicting metamorphic relations for testing scientific software*, Software Testing, Verification & Reliability — **DOI 10.1002/stvr.1594** | how to *find* relations you have not thought of | verified + DOI |

**Do:** the Clock Contract's invariants **are** metamorphic relations — re-render under a changed `TZ`
→ identical clock; zoned `+02:00` ≡ local for one instant → same `tMs`; DMY `13/05` ≡ MDY `05/13`.
Naming them buys a method for discovering the ones not yet written.

## 11 · Mutation testing beyond score

| work | detail | status |
|---|---|---|
| **Jia, Y. & Harman, M. (2011)** — *An analysis and survey of the development of mutation testing*, IEEE Trans. Software Engineering 37(5):649–678 | four cost-reduction families | verified · DOI unverified |
| **Papadakis, M., Kintis, M., Zhang, J., Jia, Y., Le Traon, Y. & Harman (2019)** — *Mutation testing advances: an analysis and survey*, Advances in Computers 112:275–378 | the past decade; open problems | verified · DOI unverified |

**Do:** the useful question is not "how high can the score go?" but **"what classes of scientifically
meaningful error can this suite detect?"** — which is where mutation testing meets experimental
validation.

## 12 · Forensic statistics for fabricated data

**Tepna problem.** `axisDrawn` already detects a synthesized axis by a ≥99 % delta-concentration bound
tuned on 381 sidecars. That is a hand-rolled quantization-signature test.

| work | detail | status |
|---|---|---|
| **Hartgerink et al.** — *Statistical detection of potentially fabricated data*, arXiv 1311.5517 | terminal-digit and distributional tests | verified, preprint |
| **Benford's law / terminal-digit χ² uniformity** | invented numbers over-represent round values and specific terminal digits | method, not a single citation |

**Do:** a terminal-digit or quantization test carries a **stated false-positive rate** rather than a
fitted threshold, and generalises to fabrication subtler than a constant delta.

## 13 · Precision timing from noisy periodic signals — pulsar timing

| work | detail | status |
|---|---|---|
| **Hobbs, G. B., Edwards, R. T. & Manchester, R. N. (2006)** — *tempo2, a new pulsar-timing package — I. An overview*, MNRAS 369(2):655–672 | overview | verified · DOI unverified |
| **Edwards, R. T., Hobbs, G. B. & Manchester, R. N. (2006)** — *tempo2 — II. The timing model and precision estimates*, MNRAS 372(4):1549–1574 | the model: observatory clock chain, propagation, dispersion — to 1 ns | verified · DOI unverified |

**Do:** the transferable idea is the **residual**. Pulsar timing does not measure arrival times; it
compares observed arrivals against a *model* with every clock and propagation term named and
separately estimated, and studies what is left over. Applied here, the host axis stops being an
alignment and becomes a timing model whose residual is the object of study.

## 14 · Lower priority — technique already used, justification missing

| field | work | why |
|---|---|---|
| Robust statistics | **Huber (1981)**, *Robust Statistics*; **Hampel et al. (1986)**, *Robust Statistics: The Approach Based on Influence Functions* | turns "we used a median" into "this estimator, under this contamination model, guarantees this" |
| Experimental design | Montgomery, *Design and Analysis of Experiments* | the BLE-adapter observation becomes a `device × adapter × night` factorial, and variance gets **attributed** rather than argued about |
| Distributed clock sync | IEEE 1588 (PTP); Mills, NTP; **Cristian (1989)**, *Probabilistic clock synchronization*, Distributed Computing 3:146–158 | offset/delay estimation under **delay asymmetry** — the assumption BLE violates hardest |
| BLE capture | *Methods for microsecond accuracy synchronization of Wireless Body Area Networks for biosignal acquisition using BLE*, Measurement (2025) | our exact topology; timestamps on a hardware interrupt at the connection event |

---

## Verification status — read before citing any of this

- **verified + DOI** — author, year, venue and DOI confirmed against a resolver. Safe to ledger.
- **verified · DOI unverified** — author, year and venue confirmed; DOI not retrieved. **Retrieve it
  before the citation enters `papers/`, `docs/**.md` or a root `*.js`**, or `citation-ledger` reds.
- **verified, book / standard / preprint / vendor note** — no DOI exists or none is conventional.
- **unledgered** — already cited in shipped prose and absent from `CITATION-VERIFICATION`. This is a
  live hole in the citation gate, not a future one.

**Nothing here has been read end to end.** Per `LITERATURE-USE-POLICY` §2 no number from any of these
may be quoted as `validated`-tier until it has been, with the citation checked at that point.

## Done when

- [ ] §2's five unledgered time-frequency citations added to `CITATION-VERIFICATION-2026-08-05.json`
- [ ] Riley & Greenhall 2004 evaluated against the `1.96·SE` refusal band — does analytic noise-ID retire it?
- [ ] One field adopted or rejected in writing, with the reason (a reading queue that never closes an item is a wish list)
- [ ] Any DOI marked *unverified* resolved before it leaves `briefs/`
