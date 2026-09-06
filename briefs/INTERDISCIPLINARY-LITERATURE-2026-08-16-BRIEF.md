<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** REFERENCE (living — last-verified 2026-08-18) · **Created:** 2026-08-16 · **Affects:** `papers/`, `docs/`, `audits/CITATION-VERIFICATION-2026-08-05.json` · **Follows:** `LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`, `PAPERS-ROADMAP-2026-06-24-BRIEF.md`

> **The measured gap:** this repository holds **86 author-verified DOIs**, and **exactly one** is
> outside clinical medicine. Meanwhile the suite's live problems are a three-cornered hat, a host
> clock axis, an identifiability failure, an integer-ambiguity alignment, and an oracle problem —
> none of which are biomedical. This brief is a reading queue for that gap, with citations verified
> to author · year · venue and, where one exists, DOI.

---

> **Why REFERENCE and not PROPOSED or DONE** (status corrected 2026-08-18). §0 states what this is:
> *"a reading queue, not a set of adopted methods"*, whose entries are *"surfaced by search and checked
> for existence, author and venue"* rather than read end to end. Nothing here is executable, so there is
> no state in which it becomes DONE — **a reading queue is never finished, only current.** `PROPOSED`
> was wrong for the opposite reason: it reads as *work not yet started* on a document already in daily
> use through `tools/doc-search.mjs`, and this repo has just paid for a stale status line
> (`FABRICATED-DEFAULTS-FLEET` read PROPOSED for two days after every fix in it had shipped, and nearly
> bought a full reimplementation of 11 guard sites). `CLAUDE.md` §📌 reserves `REFERENCE (living …)`
> with a `last-verified` date for exactly this shape. All four tracked action items closed 2026-08-17;
> **re-stamp `last-verified` when entries are added, rather than waiting for a DONE that cannot arrive.**

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

⚠️ **ADJACENCY IS NOT EQUIVALENCE — the failure mode this brief must be read against.**
This is a reading queue, and it will be consumed through semantic search (`tools/doc-search.mjs`,
which now indexes `papers/` and `.html` as well as briefs). **A near-neighbour index systematically
places the two nearest-but-DISTINCT methods side by side**, because near-in-meaning is exactly what it
ranks on. The measured instance in this repo: a *"two-line lag-1 autocorrelation"* (a **correlation
test** — is this series correlated at all) ranks adjacent to **Riley & Greenhall lag-1** (a
**noise-type identifier** — which power law, analytically). Same two words, different statistic,
different question. The reader opens the right file and draws the wrong inference from its neighbour.

So: **an entry's neighbours in a search result are not its synonyms**, and two entries in this brief
being retrieved together is not evidence they address the same problem. Where two are genuinely
confusable they are separated explicitly — see §2's lag-1 warning and §13d.4. (Design point owed to
Mutator, who put it in `doc-search`'s output footer for the same reason.)

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
| **Allan, D. W. (1966)** — *Statistics of atomic frequency standards*, Proc. IEEE 54(2):221–230 | already cited in `sigma-no-reference` | verified · **ledgered** `10.1109/PROC.1966.4634` |
| **Gray, J. E. & Allan, D. W. (1974)** — *A method for estimating the frequency stability of an individual oscillator*, Proc. 28th Ann. Symp. Frequency Control | the three-cornered hat | verified · **ledgered 2026-08-17** `10.1109/FREQ.1974.200027` |
| **Premoli, A. & Tavella, P. (1993)** — *A revisited three-cornered hat method…*, IEEE Trans. Instrum. Meas. 42(1):7–13 | negative variance handling | verified · **ledgered** `10.1109/19.206671` |
| **Torcaso, F., Ekstrom, C. R., Burt, E. A. & Matsakis, D. N. (1998)** — *Estimating frequency stability and cross-correlations*, Proc. 30th PTTI | correlated corners — the assumption the σ paper concedes is bent | verified · **no DOI — not ledgerable** (proceedings) |
| **Riley, W. J. (2008)** — *Handbook of Frequency Stability Analysis*, NIST Special Publication 1065 | σ_y(τ), TDEV, Hadamard, noise-type-by-slope | verified · **no DOI — not ledgerable** (NIST SP) |
| **Riley, W. J. & Greenhall, C. A. (2004)** — *Power law noise identification using the lag 1 autocorrelation*, 18th European Frequency and Time Forum, Guildford — **DOI 10.1049/cp:20040932** | **names the dominant noise type analytically, from phase or frequency data, at any averaging factor, WITHOUT fitting a slope** | verified + DOI |
| *Power law noise identification using the lag 1 autocorrelation by overlapping samples* — IEEE Xplore document **6037776** | extends the above to the overlapping estimator we actually use | **RESOLVED 2026-08-17** — `10.1109/icemi.2011.6037776`, Zhou Chunlei / Zhang Qi / Yan Shuhua, 2011, ICEMI · ledgered |
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

⚠️ **TWO DIFFERENT STATISTICS SHARE THE WORDS "lag-1 autocorrelation" — do not conflate them.**
`METROLOGY-METHOD-ADOPTION` §5 celebrates a "two-line lag-1 autocorrelation" that settled in one
measurement what the Allan family could not. That is a **plain correlation test** — *is this series
correlated at all*. Riley & Greenhall 2004 is a **noise-type identifier** — *which power law is this*,
analytically, without fitting a slope. Same two words, different statistics, different questions. A
reader citing METROLOGY §5 as evidence that lag-1 retires the SE band would be wrong, and the two
briefs sit close enough in a semantic search to invite exactly that. (Raised by Brief runner.)

**Also owed:** ~~the five entries marked *unledgered* are cited in `papers/sigma-no-reference.html`
prose today and are invisible to `citation-ledger`. Adding them is cheap and closes a real hole.~~

> ### ⚠️ HALF-TRUE — CORRECTED 2026-08-17. Ledgering them does NOT close that hole.
>
> The premise is right and the remedy is not, because **`citation-ledger` is DOI-DRIVEN**: it walks the
> DOIs *on a reader-facing surface* and asserts the surrounding text names the ledger's author within
> ±1 year. A work named in prose **with no DOI beside it** is invisible to the gate whether or not the
> ledger knows the DOI. Adding a ledger row for a DOI the paper does not print changes nothing.
>
> Measured in `papers/sigma-no-reference.html`:
>
> | work | in the paper | ledger | gate sees it? |
> |---|---|---|---|
> | Allan 1966 | DOI `10.1109/PROC.1966.4634` printed | ✅ | **yes** |
> | Premoli 1993 | DOI `10.1109/19.206671` printed | ✅ | **yes** |
> | **Gray** (×3), **Torcaso**, **Riley** | **prose only, no DOI** | ✅ (Gray added today) | **no** |
>
> **So the hole closes at the PAPER, not at the ledger** — the DOI has to be printed beside the prose
> mention. **DONE 2026-08-17, in this same change**, because printing a DOI and ledgering it must land
> together: `10.1109/FREQ.1974.200027` is now printed beside Gray & Allan 1974 in
> `papers/sigma-no-reference.html`, the served twin is rebuilt, and the gate now *reaches* it — verified
> by corrupting the author beside that DOI and watching `every DOI on a source surface names the ledger's
> first author and a year within ±1` red with *citation does not name "Gray"*, then restore.
>
> ⚠️ **The ordering is not optional, and the gate proved it.** The paper edit was first made on a branch
> off `main`, where the ledger row did not yet exist, and `citation-ledger` immediately red'd with
> *every DOI on a source surface is present in the ledger — got [10.1109/FREQ.1974.200027]*. Printing a
> DOI whose ledger row is in an unmerged branch breaks `main`. **Same PR, or ledger first.**
>
> **Torcaso 1998 and Riley SP 1065 stay uncovered, and that is the honest end state** — neither has a
> DOI, so the gate cannot see them and nothing should be added to make it look as though it can.
> Torcaso and Riley SP 1065 have no DOI at all, so for those two the honest end state is a named citation
> without one — the gate cannot cover them and should not be made to look as though it does.


> ### ✅ LEDGERED 2026-08-17 — and the "five unledgered" was an over-count, three ways
>
> Resolved at author time against `api.crossref.org` (the resolver the ledger names). Of the five rows
> marked *unledgered*:
>
> - **two were already there** — Allan 1966 `10.1109/PROC.1966.4634` and Premoli 1993 `10.1109/19.206671`,
>   both matching Crossref exactly. The column was stale, not the ledger.
> - **one was genuinely missing and is now added** — Gray & Allan 1974 `10.1109/FREQ.1974.200027`.
> - **two cannot be ledgered at all**: Torcaso et al. 1998 (Proc. 30th PTTI) and Riley 2008 (NIST SP 1065)
>   **have no DOI**, and this ledger is DOI-keyed. They are marked *no DOI — not ledgerable* rather than
>   left reading as an outstanding task, and emphatically not given a fabricated key.
>
> Also added: **Riley & Greenhall 2004** `10.1049/cp:20040932`, which carried a DOI in this table and was
> absent from the ledger.
>
> **The `AUTHORS AND YEAR UNVERIFIED` row is resolved** (the brief's own rule: no unverified DOI leaves
> `briefs/`). *"IEEE Xplore document 6037776"* is **`10.1109/icemi.2011.6037776`** — the DOI contains the
> document number — **Zhou Chunlei, Zhang Qi, Yan Shuhua (2011)**, *IEEE 10th International Conference on
> Electronic Measurement & Instruments*. It carries an `authorAliases: ["Zhou"]` with
> `aliasSource: crossref-variant`, because Crossref puts the **whole name in `family`** with `given` empty
> (`family='Zhou Chunlei'`); the surname is Zhou. That is a Crossref spelling variant, not a name read off
> the paper, so it is the `crossref-variant` class and not `from-paper`.
>
> ⚠️ **The ledger's `_count` read 92 against 93 actual records** before this change — corrected to 96. No
> gate asserts `_count`, so it had drifted silently; it is metadata, not the oracle, but a wrong count in
> the file that IS the oracle is worth not leaving.
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

> ### ✅ CLOSED 2026-08-17 — [REINVENTED]. The suite HAS the ratio test; the last sentence above is out of date.
>
> **Correcting this entry's own claim first.** *"which the suite currently cannot answer at all"* is
> false as of `INTEGRATOR-PAT-VASCULAR` §2-RESULT-IV, which built exactly the third step:
>
> - the R↔foot offset is *"ambiguous **modulo one RR**, and beat **times** cannot resolve it"* — the
>   carrier-phase integer ambiguity, in the suite's own words;
> - resolved by normalised cross-correlation of the ECG **RR** sequence against the PPG **PPI**
>   sequence **over integer beat-index lags** — an integer search, on the aperiodic feature
>   ([[beat-trains-align-only-mod-rr]]);
> - **validated by the margin between the best and second-best lag**, reported per night, with the two
>   populations separating by three orders of magnitude (recoverable on 2 of 29 nights: ncc 0.995–0.996,
>   margin 0.196–0.223, PAT SD **28.1 / 36.8 ms** — inside `pat-gate`'s 60 ms bar).
>
> **That margin IS the GNSS ratio test** — best-vs-second-best of the integer candidates, used as an
> accept/reject on the fix. Independently rebuilt, under a different name, on a different signal.
> Naming the correspondence is the value; the estimator needs nothing.
>
> **What GNSS still has that the suite does not — one item, and it is real:**
> **the fixed-failure-rate ratio test** (Teunissen & Verhagen) sets the acceptance threshold from a
> *target false-fix probability* rather than a fixed constant. §2-RESULT-IV needs no threshold today
> precisely because its separation is 10³; that is a property of this corpus, not of the method, and the
> principled threshold is what to reach for the moment a night lands in the gap.
>
> **REJECTED, with the reason, so nobody imports it:** **LAMBDA's decorrelation step does not apply.**
> The Z-transformation exists because a *multi-dimensional* float-ambiguity covariance is elongated and
> makes the integer least-squares search expensive. The beat-lag ambiguity is **one-dimensional** — a
> single integer lag — where integer least-squares is just rounding and decorrelation is a no-op.
> Importing the LAMBDA toolbox here would be machinery for a dimension the problem does not have.
>
> **STILL OPEN, and this half of the entry stands:** **cycle-slip detection.** A dropped or inserted
> beat is formally a cycle slip, GNSS detects those explicitly, and the suite does not — `JOINT-UNWRAP-
> ATTEMPT` measured slips wrecking a cumulative unwrap and had no detector for them. That is the
> importable piece.
>
> ⚠️ **Method note, because it is why this was found at all.** Grep could not reach it: the reading
> queue says *"integer ambiguity"*, the repo says *"ambiguous modulo one RR"* and *"margin"*, and the
> two share no token. A loopback `bge-m3` semantic index over all 4374 brief sections surfaced
> §2-RESULT-IV at rank 3 for the field's own description. **Calibrated before use** with a control
> ladder — three known-answer rungs landing 0.60–0.66 and a nonsense rung flooring at 0.42 — and every
> hit was then opened and read. The retrieval is a candidate generator; the claims above come from the
> sections themselves.

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

~~**Do:** deterministic jitter is **bounded**, random jitter is **unbounded Gaussian**, and they
separate by tail-fitting. BLE's 7.5 ms connection interval is textbook bounded DJ — arrival latency
spans 0 to exactly one interval — while scheduler contention is unbounded RJ. One `spreadMs`
conflates a hard physical bound with a tail that has no worst case.~~

🔴 **FALSIFIED BY THE CORPUS, 2026-08-16 (Vigil box). Do not act on the struck text above.** The
physics is right and the *conclusion drawn from it* is wrong: the connection interval genuinely is a
bound, but it is **negligible beside the term that dominates**, so decomposing into DJ + RJ answers a
question the data does not pose.

The dual-Dirac decomposition was implemented and **validated against planted cases first** — Q-scale
tail fit, RJ recovered within 5 %, DJ conservative by ~13 % (the estimator's known bias, DJ(δδ) being
an effective separation):

```
planted DJ 10.0 RJ 2.0  ->  8.43 / 2.10
planted DJ 30.0 RJ 5.0  -> 26.06 / 5.26
planted DJ  0.0 RJ 4.0  ->  ~0   / 3.92
```

It then returned **NEGATIVE DJ on most real streams** — −651 ms (H10 acc), −554 (ecg), −114 (Verity
ppg). A negative DJ means the right tail's extrapolated intercept sits *below* the left's, which a
two-lobe distribution cannot produce. The diagnostic that explains it:

```
excess kurtosis:  H10 acc +1901 · H10 ecg +1400 · Verity ppg +124
```

**A dual-Dirac has NEGATIVE excess kurtosis** — two deltas smeared by Gaussians is flat-topped. These
are single, violently heavy-tailed peaks — so the *dual-Dirac model* does not fit, which was the
question being asked.

🔴 **SECOND CORRECTION, 2026-08-17 (#1412): "there is no bounded component" was WRONG, and the reason
is the transferable part — KURTOSIS CANNOT SEE A LATTICE.** There **is** a bounded, deterministic
component on every Polar stream: delivery delay is **quantised to an integer number of BLE connection
events**, and it was recovered from arrival timestamps alone.

```
Polar H10 ecg   44.902 ms  ->  35.92 → 36 units × 1.25 ms = 45.00    R 0.937   9/9 streams
Polar H10 acc   44.944 ms  ->  35.96 → 36                            R 0.927   8/8
Polar Verity    30.014 ms  ->  24.01 → 24 units × 1.25 ms = 30.00    R 0.843   332/343
Wellue O2Ring   REFUSED — no PER-SAMPLE device clock (1 Hz counter only)
```

⚠️ **The refusal stands; its stated reason was too broad (corrected 2026-09-06).** This method
differences a per-sample device timestamp against arrival, and the ring publishes none — so it is
rightly refused. But the ring is not clockless: every `0x04` frame carries `duration_s`, a 1 Hz
session counter, which cannot resolve a 1.25 ms lattice by three orders of magnitude and so changes
nothing here. Recorded because "no device clock at all" propagated as a device fact when it is a
statement about the sample stream — residue `2026-09-06-ring-duration-counter-bimodal`.

`R` is the circular concentration `|mean(exp(2πix/s))|` on the differenced delay: **1** for a lattice,
**~1/√n** for anything continuous.

**This result validates itself, which is rare here.** 1.25 ms is the **BLE specification's**
connection-interval quantum — not a fitted constant, not a config value. Recovering **36 × 1.25** and
**24 × 1.25** from noisy arrival stamps on two different chipsets means the method landed on integers
it had no way to know in advance: **a known-answer test the protocol supplied.** The negative control
is the other half — adding `U(0, 45 ms)` to the H10 series collapses R from **0.976 → 0.005**.

⚠️ **And the H10 carries the STRONGEST comb in the corpus (R = 0.95) together with POSITIVE excess
kurtosis (+8.6 / +5.5).** The statistic that "excluded" a bounded component was blind to it *by
construction* — a lattice has no effect on the fourth moment. The flat-topped Verity streams later
cited as possibly dual-Dirac are **discrete spikes with empty bins between**: a comb, not two
Gaussian-smeared humps.

**What actually follows, and it is a harder wall than the original entry claimed:**

- **45 ms is a FLOOR on anything derived from arrival stamps — 4.5× PAT's 10 ms budget** — and it is
  *independent* of the 2.2 s per-connection offset in `PAT-PACKET-ARRIVAL`. Anyone reviving PAT from
  arrival stamps now faces **two structural walls, not one**. Device stamps + `hostAxis` remain the path.
- It survives `hostAxis`'s width-21 running median as **3.21 ms** (30 ms → 2.15 ms) — inside PAT's
  budget, but an **unbudgeted term that is inside only because of the median width**. That entangles it
  with the width's own justification (the 9 → 77 / 21 → 57 / 41 → 168 / 81 → 245 planted-jitter table):
  retune the width on other evidence and this term moves silently. Recorded because nothing else says so.
- ⚠️ **Measured every session, never assumed** — the interval is negotiated per connection and the box
  has two chipsets. Every figure above is "what the Realtek negotiated on these nights".

⚠️ It was **not shipped**, and the reason is the reusable part: feeding `abs(dj)/√12` into an
uncertainty budget as a "bounded" term would have fabricated a quantity **from a model the data
contradicts** — and a negative DJ passed through `abs()` would have looked like a *large* bounded
component. That is the worst available failure shape, and it is [[queries-that-examined-nothing]] in
estimator form: the fit ran, converged, and reported a number about a structure that was not there.

**What shipped instead answers the same question without the assumption: MTIE** (#1392). ITU-T G.810
defines MTIE and TDEV as a pair precisely because RMS cannot express a worst case, and the TDEV half
already existed (#1255). Known-answer validated before the citation was written down — a ramp of
slope 3 gives MTIE(τ) = 3τ exactly, a planted step of 42 gives 42.000, and Bregni & Maccabruni's
binary decomposition (IEEE T-IM 49(6), Dec 2000) is byte-identical to the O(N·W) definition at seven τ.

```
H10 ecg    MTIE@1s 5757 ms    MTIE@256s 5817 ms    RMS-style (adev·tau) 85 ms
```

**68×.** And MTIE being *flat across τ* says those six seconds are **ONE STALL, not accumulating
drift** — validated against a planted spike (500/500) versus a random walk (3.7 → 44.1). That
distinction changes what you would do about it, and no RMS statistic can express it.

⚠️ Limits stated by the measurer: the kurtosis figures are one night's streams read per-file, and an
O2Ring reading of +29394 is inflated by session boundaries in a concatenated read (the shipped code
processes per file and would not see it). The H10 and Verity numbers stand.

**The transferable lesson, which is why this correction is kept in full rather than deleted:** the
entry was not wrong about the physics. It was wrong about **which term dominates at the scale we
measure** — and that only surfaced by fitting the model and watching it fail. A literature entry that
is theoretically correct can still be practically inverted, and the only way to find out is to run it.

**And the correction needed its own correction.** The first pass falsified the DJ/RJ *decomposition*
correctly and then over-reached into "no bounded component at all" — a claim the chosen statistic
could not support in either direction. **A refutation is a claim too, and inherits the burden of
proof it just imposed.**

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

### 11a · ⚠️ TCE and the asymmetry that makes a false equivalence worse than a survivor

**Trivial Compiler Equivalence** (Papadakis et al.) detects equivalent mutants by compiling mutant and
original and comparing the emitted code: identical output proves behavioural equivalence, so the
mutant can be **removed from the denominator** rather than chased. It is the standard answer to
mutation testing's oldest cost — the equivalent-mutant problem is undecidable in general, and TCE
converts a slice of it into a compiler invocation.

**Carry this caveat wherever TCE or any equivalence heuristic is used here, because the two errors are
not symmetric:**

- A **surviving** mutant that is actually equivalent costs *effort* — someone investigates and finds
  nothing. Annoying, bounded, and self-correcting.
- A **falsely-declared equivalent** mutant is removed from the denominator **permanently**. The score
  rises, the mutant is never generated again, and **the test gap it represented becomes invisible** —
  there is no later run in which it reappears to be re-examined.

So the two failure directions have different half-lives, and only one is recoverable. **An equivalence
claim needs stronger evidence than a survivor claim**, not equal evidence.

⚠️ **This is not hypothetical here.** `se = se || 0` in `clock.js` was declared EQUIVALENT in #1302
and was not: every DexClock fixture used `:00` seconds, where `'00' && 0` and `'00' || 0` are both
`0`, so the mutant genuinely could not be distinguished **on the data that existed**. That is a
property of the FIXTURES read as a property of the CODE — a test gap wearing the shape of an
equivalence. It was retired only when someone re-applied the mutant to current `main` and found **7
assertions failing, of which only 3 were the ones added to catch it** — the other four had landed
since, by accident. Nothing false reached `mutate-equivalence.json` (clock.js carries 3 entries, all
`real-gap`), so the denominator survived; that it survived was luck rather than process.

**Practical rule:** TCE's *positive* answer is a proof and can be trusted. Every other route to
"equivalent" — reading the code, reasoning about the operator, a model's judgement — is a
**hypothesis**, and the honest record is `not-separable-by <the observable you tried>` rather than
`equivalent`. Related: [[assertions-encode-shape-not-contract]], [[equivalence-claims-age]].

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

## 13b · ROUND THREE — from consulting the other sessions (2026-08-16)

The first two passes were mine and were breadth. This round asked Brief runner, Mutator and Vigil box
what they were *about to hand-roll*. It produced the single best find in the brief.

### 13b.1 · VACUITY — a query whose empty result is indistinguishable from a true negative

**This repo has reinvented a 1997 result down to the name.** The canonical case in model checking:
verify `G(req -> F ack)`, it passes, and it passes because `req` never holds on any reachable path.
The property was never exercised; the tool reports success about something it never examined. IBM
measured roughly **a fifth of passing properties vacuous** on real hardware verification.

| work | detail | status |
|---|---|---|
| **Beer, I., Ben-David, S., Eisner, C. & Rodeh, Y. (1997)** — *Efficient detection of vacuity in ACTL formulas*, CAV 1997 — **DOI 10.1007/3-540-63166-6_28** | introduces vacuity + the **interesting witness** requirement | verified + DOI |
| **Beer, Ben-David, Eisner & Rodeh (2001)** — *Efficient detection of vacuity in temporal model checking*, Formal Methods in System Design 18(2):141–162 — **DOI 10.1023/A:1008779610539** | journal version | verified + DOI |
| **Kupferman, O. & Vardi, M. Y. (2003)** — *Vacuity detection in temporal model checking*, STTT | the general formulation | verified · DOI unverified |
| **Armoni, R. et al. (2003)** — *Enhanced vacuity detection in linear temporal logic*, CAV 2003 | LTL | verified · DOI unverified |

**The suite already calls these legs `ANTI-VACUITY`** — the field's own word, arrived at
independently, which is evidence the mapping is real rather than a stretch. **The transferable idea is
the one we do not have: vacuity checking there is automatic and universal.** The model checker derives
the witness obligation *from the property itself*; it does not depend on each author remembering to
add a non-emptiness leg by hand. Ours are hand-added, so they exist exactly where someone thought of
them.

**Five instances measured in one day, across three sessions**, all the same shape — a query that
examined nothing, reporting cleanly: a `grep -c` on a failed gate whose `✕` lines are indented; a
`git diff` returning zero lines from a diff already staged by `--3way`; `EINVAL` from binding HCI
device `0` instead of `0xFFFF`, reading exactly like a capability finding; a gate regex whose
`[^)]*se` matched `se_unused=None` by substring; and "Codex is not installed" asserted from
recollection about a package present for three weeks.

**And the boundary against mutation testing is worth stating**, because it decides which tool applies:
mutation testing catches *a check nobody has watched fail*; vacuity catches *a check with nothing to
look at*. The gate-regex hole was mutation-shaped and died to a mutant. The `grep -c` was
vacuity-shaped and **no mutant would have found it** — the code was correct and the input was empty.

### 13b.2 · Oracle quality — measuring whether a check examined anything

| work | detail | status |
|---|---|---|
| **Schuler, D. & Zeller, A. (2011)** — *Assessing oracle quality with checked coverage*, ICST 2011, Berlin | statements executed **that also influence an oracle**, via dynamic program slicing | verified |
| **Schuler, D. & Zeller, A. (2013)** — *Checked coverage: an indicator for oracle quality*, STVR — **DOI 10.1002/stvr.1497** | journal extension | verified + DOI |
| **A brief survey on oracle-based test adequacy metrics** — arXiv 2212.06118 | situates checked coverage against alternatives | verified, preprint |

Their finding: checked coverage is *"a sure indicator for oracle quality and even more sensitive than
mutation testing."*

**It changes the economics, not only the framing** (Mutator's measurement): Level B pseudo-testedness
costs **one full suite run PER STATEMENT** — ~285 s each, 179 subjects on `clock.js` alone. Checked
coverage answers the same question from **one** instrumented run plus a slice. If their sensitivity
result holds, the deletion experiment is the *expensive approximation* of the cheap measurement —
O(statements) suite runs against O(1). That is not an argument to stop Level B, which found four real
gaps today with three merged as tests; it is an argument about what to build next. **The blocker is a
JS dynamic slicer, which is not a weekend's work.**

⚠️ **Do not treat it as a drop-in.** Their result is over seven open-source **Java** projects. This
suite's oracles are unusual — many assert on **exported JSON structures** and cross-node contracts
rather than on returned values, and a backwards slice from `T.eq(export.foo, X)` passes through
serialisation in a way that may flatter or destroy the metric. That is an open empirical question
about our shape, not a doubt about theirs. **High coverage with low checked coverage is precisely "the check ran and examined
nothing"** — a metric for §13b.1's failure class. Pseudo-testedness and an assertion-strength ranker
are two hand-rolled halves of this one published measure.

### 13b.3 · Absence of evidence — the same shape in three other fields

| work | detail | status |
|---|---|---|
| **Altman, D. G. & Bland, J. M. (1995)** — *Absence of evidence is not evidence of absence*, BMJ 311:485 | two pages; the canonical citation | verified · DOI unverified |
| **Zobel, J. (1998)** — *How reliable are the results of large-scale information retrieval experiments?*, SIGIR 1998 | **pooling bias** — unjudged documents scored non-relevant, so absence from the pool reads as evidence of irrelevance | verified · DOI unverified |
| **Lipsitch, M., Tchetgen Tchetgen, E. & Cohen, T. (2010)** — *Negative controls: a tool for detecting confounding and bias in observational studies*, Epidemiology 21(3):383–388 | the control-ladder practice, formally | verified · DOI unverified |
| **ICH E10** — *Choice of control group in clinical trials* | **assay sensitivity**: a non-inferiority trial finding no difference may simply have been unable to detect one | verified, guideline |

**`assay sensitivity` is the exact term for "this instrument may have been blind"** — the property
every null result in this suite needs and few state.

### 13b.4 · Allan-family estimators on gapped and irregular data

**Tepna problem** (Vigil box): `allan.py` assumes a uniform grid; BLE arrivals are not uniform, and
1 s pre-binning is the workaround. Pre-averaging ahead of a variance estimator **must** alter measured
stability — it is decimation with averaging, not resampling.

| work | detail | status |
|---|---|---|
| **Barnes, J. A. & Allan, D. W. (1990)** — *Variances based on data with dead time between the measurements*, NIST Technical Note 1318 | the classical treatment of **dead time**; bias functions | verified, NIST TN |
| **Sesia, I. & Tavella, P. (2008)** — *Estimating the Allan variance in the presence of long periods of missing data and outliers*, Metrologia 45(6):S134 — **DOI 10.1088/0026-1394/45/6/S19** | unbiased AVAR with missing data, unequal spacing and outliers | verified + DOI |
| **Malkin, Z. (2016)** — *Application of the Allan variance to time series analysis in astrometry and geodesy: a review*, arXiv 1607.04712 | AVAR on irregularly spaced data | verified, preprint |
| *Allan variance calculation for nonuniformly spaced input data* — DTIC ADA616850 | direct treatment | verified, tech report |

**Note the convergence:** the irregular-sampling problem is solved in **pulsar timing** (§9), where
"observations are quite irregularly spaced in time" is the normal condition. The field already in this
brief for a different reason is also the answer here.

> ### ✅ ADOPTED 2026-08-17 — measured in BOTH lanes, and they do not agree. This entry conflates them.
>
> **The premise is correct for the lane it names and false for the other, so the adoption is bounded.**
> `allan.py` (Python) and `allanFromPhase` (the JS spine) both take a `tau0` and both assume a uniform
> grid — but they are handed **different series**, and only one of them is irregular.
>
> **Arrival lane** (`nightqc._tau0_of` → `allan.stability`, indexed on BLE packet-arrival host stamps).
> 120 `*_PMDARRIVAL.csv` sidecars on the box, per `(device, meas)` series, as mean-τ₀ ÷ median-Δ:
>
> | series | n | median Δ | mean-τ₀ / median | worst gap ÷ median |
> |---|---|---|---|---|
> | H10 ecg | 7 | 541 ms | 1.04 | 9× |
> | H10 acc | 7 | 720 ms | 0.98–0.99 | 10× |
> | **Verity ppg** | **79** | 300 ms | **0.87 – 1.16** | 4× |
> | Verity acc | 8 | 2416 ms | 0.94–1.06 | 2× |
> | Verity ppi | 2 | 4897 ms | **0.52 – 0.97** | 1× |
> | O2Ring duration | 10 | 1005 ms | 1.00 | 1× |
>
> **Node lane** (`DexClock.hostAxis(...).stability`, indexed on the device counter). 439 ECG/PPG streams,
> 17 box nights: Polar **0.9999 – 1.0066**, worst gap **1.0–1.4×**; O2Ring 0.9990 – 1.0510, one gap 208×.
>
> **So: the arrival axis is irregular and the device axis is not.** §13b.4 says *"BLE arrivals are not
> uniform"* — true, and this is the number: on the most-populated stream (Verity ppg, 79 series) the mean
> packet interval runs **0.87–1.16×** the median, i.e. up to a **16 % error in the τ label**, and Verity
> ppi reaches 0.52. Nothing in the node lane is close to that.
>
> **What the τ error does and does not do — the part worth stating, because it bounds the cost.** A
> *uniform rescaling* of τ shifts the curve horizontally in log-log and leaves the **slope invariant**, so
> the noise-type classification — the thing this suite actually branches on — is immune to it. What moves
> is *where on the curve* a σ is quoted: `optimal_tau`, `tauMaxSec`, and any cross-stream comparison read
> at a fixed τ. Separately and additionally, genuinely *irregular* spacing biases AVAR itself (dead time —
> Barnes & Allan 1990, NIST TN 1318), which a τ relabel does not fix. Two distinct effects; only the first
> is a scale error.
>
> **ADOPTED: Sesia & Tavella (2008)**, *Estimating the Allan variance in the presence of long periods of
> missing data and outliers*, Metrologia **45**(6):S134, DOI `10.1088/0026-1394/45/6/S19` — the unbiased
> AVAR for missing data and unequal spacing, which is exactly the arrival lane's condition.
> **REJECTED for the node lane**, on measurement: its input is uniform to ≤0.7 % on every Polar stream, so
> an unbiased-AVAR rewrite there would add machinery to correct a bias that is not present. The O2Ring is
> the one node-lane exception and it is already refused twice over (drawn axis; incoherent cross-fragment
> rate), so a third refusal is confirmatory.
>
> **Owed, and deliberately not done here:** the arrival lane should publish the mean-to-median ratio beside
> its curve so a reader can see when the τ label is trustworthy — cheap, Python-side, no bundle. The
> unbiased-AVAR swap is a larger change and should follow the ratio, not precede it: measure how often the
> bias matters before importing an estimator to remove it.
>
> ⚠️ **The trap this entry set, recorded because it nearly worked.** I measured the node lane first, found
> it uniform, and was one step from writing "the premise is refuted". The two lanes share an entry, a
> vocabulary and an estimator, and differ in the only thing that mattered — which series they index on.

### 13b.5 · Delay-variation estimation — is the residual a clock at all?

**Tepna problem** (Vigil box, self-identified as the highest-value of their five): stability is computed
on `host_ms − last_sensor_ns` and the residual is called "clock". It contains transport as well as
oscillator.

| work | detail | status |
|---|---|---|
| **RFC 3393** — *IP packet delay variation metric for IPPM* | the standing IPDV definition | verified, RFC |
| **RFC 5481** — *Packet delay variation applicability statement* | the PDV-vs-IPDV distinction, and when each is appropriate | verified, RFC |

One-way-delay literature already knows delay has **a floor plus a heavy right tail** —
`writers.PmdArrivalLogWriter.floor_ms` is a hand-rolled minimum-filter over exactly that structure.

### 13b.6 · Pooling k noisy estimates of one quantity with unequal precision

**Tepna problem** (Vigil box): Verity fragments are **length-biased** — many short, few long — and the
estimator's variance depends on length, so any pooled figure is dominated by its noisiest members.

**Do:** inverse-variance weighting and random-effects meta-analysis, **including the heterogeneity
question** — whether a common value exists across fragments at all. The alternative currently in use
is a median, and hope. Standard references: DerSimonian & Laird (1986); Higgins & Thompson's *I²*
(2002). Both **verified by name, DOI unverified.**

### 13b.7 · Diagnostic-accuracy methodology — a defect that should become a methods section

**Tepna problem** (Brief runner, found today): `odi-bias-analysis` selected `ahi_a0h4` as the reference
AHI — hypopneas scored only at ≥4 % desaturation — while the *index* test is a ≥4 % desaturation index.
Reference and index shared the scoring criterion, so the events ODI cannot see were absent from **both
sides** and the bias would have read near zero.

| work | detail | status |
|---|---|---|
| **incorporation bias / criterion contamination** | the index test contributes to the reference standard — a named, well-treated bias | concept, multiple sources |
| **Whiting, P. F. et al. (2011)** — *QUADAS-2: a revised tool for the quality assessment of diagnostic accuracy studies*, Annals of Internal Medicine 155(8):529–536 | the appraisal framework any reviewer will apply | verified · DOI unverified |
| **Bossuyt, P. M. et al. (2015)** — *STARD 2015: an updated list of essential items for reporting diagnostic accuracy studies*, BMJ 351:h5527 | reporting requirement | verified · DOI unverified |

**Do:** name the bias, state which AHI definition was used as reference, and report the
desaturation-only definition as a **secondary** result — because the gap between the two curves *is*
the arousal-terminated hypopnea population, which is the finding. This converts a defect into the
paper's methods section.

### 13b.8 · Inter-scorer agreement — the ceiling on any apnea validation

**Tepna problem.** No algorithm can be validated past the agreement of the humans defining truth.

**AASM Inter-scorer Reliability Program, respiratory events** (JCSM, DOI **10.5664/jcsm.3630**):
overall respiratory-event agreement **93.9 % (κ = 0.92)** including event-free epochs, but on epochs
where an event was scored, **88.4 % (κ = 0.77)** — and by type: obstructive apnea **77.1 % (κ = 0.71)**,
**hypopnea 65.4 % (κ = 0.57)**, **central apnea 52.4 % (κ = 0.41)**. Sleep-stage scoring meta-analysis:
Cohen's κ **0.76**. *(verified + DOI for the respiratory-events paper.)*

**Do:** any CPAPDex or ODI validation reporting agreement above these figures is measuring something
other than truth. Central apnea at κ = 0.41 is the number to keep in view.

### 13b.9 · A gate-design correction that outranks the algorithm choice

Not literature, but it came out of the same consultation and it changes §2's precondition. Brief
runner's argument: **a table-equality gate is the wrong gate.** It pins *representation*, so it
forbids the change we want and permits two lanes that share a table and diverge in arithmetic. The
stronger gate exists in outline already — `allanFromPhase` has a cross-language **known-answer** using
MINSTD. Extend that to `classify`, and table-equality becomes redundant. **Order: build the
known-answer → delete the table-equality → then swap the algorithm.**

Also, before treating lag-1 identification as free: **it identifies the dominant type assuming a pure
power law**, so *mixed noise is its failure mode*. It removes the boundary problem; it does not remove
the modelling assumption.

### 13b.10 · What NOT to reach for — recorded because it is instructive

For "two sessions edited different sections of one brief and the result contradicts itself":
**operational transform** (Ellis & Gibbs, SIGMOD 1989) and **CRDTs** (Shapiro et al., 2011) are the
wrong tools. They guarantee **convergence** — every replica byte-identical, no conflict. Applied to
`GENERATOR-FOLLOWUPS-III` they would have merged both edits silently and called it success.

**The failure is not divergence; it is convergence on a document that asserts a claim and its
rebuttal.** The nearer literature is speculative/semantic conflict detection — Brun, Holmes, Ernst &
Notkin, *Proactive detection of collaboration conflicts* (FSE 2011, Crystal), and Sarma et al.'s
Palantír. But it stops short honestly: detecting "these two sections contradict" needs an oracle for
contradiction, which for prose is a language model, and **this repo's own rule is that model output
cannot be evidence.** So it stays prevention, and `stale-file` plus required-read is the tractable
proxy rather than a compromise.

## 13c · ROUND FOUR — the Anglophone bias, and what searching in Chinese found

### 13c.1 · The bias was in the retrieval, not the judgement

Rounds 1–3 were searched **entirely in English**, against a tool documented as US-only. The skew
entered before any assessment happened, and calling something "the canonical work" partly describes
Scopus/WoS indexing coverage rather than quality. Two concrete errors this produced:

**(a) The change-point section cited the procedure and omitted the theorem.** §9 listed Page (1954,
CUSUM) and Adams & MacKay (2007). It did not list:

| work | detail | status |
|---|---|---|
| **Shiryaev, A. N. (1963)** — *On optimum methods in quickest detection problems*, Theory of Probability and Its Applications 8(1):22–46 — **DOI 10.1137/1108002** | Bayesian quickest-detection theory; thresholding the posterior probability of an active change is **strictly optimal**, minimising average detection delay at a given false-alarm rate | verified + DOI |
| **Shiryaev–Roberts procedure** | under generalised-Bayesian and multi-cyclic optimality, "the best one can do" given specified pre/post-change distributions | concept, multiple sources |

Citing CUSUM without Shiryaev is citing a method while omitting the result that says when it is optimal.

**(b) Time-frequency was treated as NIST + BIPM.** For a project whose core problem is *comparing
clocks with no reference*, omitting two national timing institutes is coverage failure:

- **NTSC** (National Time Service Center, Chinese Academy of Sciences, Xi'an) — keeps UTC(NTSC) on
  22 caesium clocks and 8 hydrogen masers, publishes BeiDou time transfer in *Metrologia*, operates an
  ⁸⁷Sr optical lattice clock measured against TAI.
- **VNIIFTRI** (Russia) — the equivalent role for UTC(SU) and GLONASS timing.

**Probable but UNVERIFIED, and recorded as such:** Allan variance is a second-order structure
function of phase, and **Kolmogorov's (1941) structure-function formalism** is the general treatment
of processes with **stationary increments** — which is exactly what a clock phase is. If that holds,
the σ_y(τ) slope taxonomy is a special case of a broader framework. **No source stating the
equivalence directly was found.** Related Soviet-school work in scope: **Kotelnikov** (sampling, 1933,
predating Shannon) and **Kolmogorov–Wiener** prediction/filtering of stationary sequences — the
foundation under the interpolation `hostAxis` performs.

⚠️ **Asymmetry to state, not hide:** these were verified for *existence*, but much is published in
Russian or Chinese and would be assessed via translated abstracts rather than read. That is weaker
footing than the English-language entries above, and they are not equivalently vetted.

### 13c.2 · A METHOD from the Chinese satellite-clock literature — and a gap it exposes

Searching in Chinese (`钟差建模`, `周期项提取`, `重叠哈达玛方差`) returns a **standard pipeline** for
BeiDou on-board clock analysis that the English-language time-frequency sources did not surface,
because the GNSS community works with clocks carrying *known* periodic terms (orbital period, thermal
cycling) and therefore treats periodicity extraction as routine:

```
1. 二次多项式拟合  quadratic fit           → remove trend (offset + rate + drift)
2. 周期项提取      periodic extraction     → from the FIT RESIDUAL, not the raw series
3. FFT 频谱图      spectrum of the residual→ identify which periods are present
4. 重叠哈达玛方差  overlapping Hadamard    → stability on what remains
```

**Decomposition BEFORE stability.** Trend → periodic → noise, and the variance estimator only ever
sees the residual.

**THE GAP THIS EXPOSES, measured 2026-08-16:**

```
grep -c 'fft|periodog|periodic|spectral'   capture-host/allan.py → 0
                                            clock.js             → 0
```

…while `allan.py:270` and `clock.js` both **print** to the caller:

> `"drift"` — *"deterministic — fit and remove it, never average through it"*

**The advice is given and never acted on.** Nothing detrends, and nothing looks for periodicity at
all. A periodic component in the phase would be classified as a **noise type** by the slope
classifier rather than identified as a deterministic term — the exact error the string warns about,
one category over.

Tepna has physical reasons to expect periodicity: the **7.5 ms BLE connection interval**, the
**~90 s Verity reconnect cycle**, and overnight **thermal cycling**. None has ever been looked for.

### 13c.3 · A second method, and it lands on an open problem

The same literature (`一种基于MAD改进的GNSS高程时间序列粗差探测方法`; `一种基于小波分析的卫星钟差数据粗差处理方法`)
uses `σ = median{|cd_j| / 0.6745}` on wavelet coefficients and MAD with parameter 5 for outlier
rejection — **and states the limitation directly**:

> 常用的 GNSS 时间序列粗差剔除方法主要有 3σ 法、中位数(MAD)法、四分位距(IQR)法等，但这些方法都存在
> **数据剔除效果在很大程度上受限于数据长度**的缺陷。
>
> *(3σ, MAD and IQR outlier rejection are all substantially limited by series length.)*

That is **Vigil box's length-biased Verity fragment problem**, already characterised by a field that
hit it first. Worth reading before hand-rolling a fragment-length correction.

### 13c.4 · A retrieval failure mode worth recording

Searching `三角帽` (three-cornered hat) returned Stardew Valley and 18th-century millinery — the term
is also the ordinary word for a **tricorne**. **Homonym collision in the target language** is a
distinct failure from the English-only bias: the query was right and the corpus answered a different
question. When searching a second language, verify the technical term is not also a common noun, and
prefer a phrase that cannot collide (`时频 三角帽 方差` rather than `三角帽`).

## 13d · ROUND FIVE — six languages, searched for METHODS not citations

Russian · Japanese · Korean · Czech · German · French. Ordered by what each actually yielded.

### 13d.1 · KOREAN — the most actionable find in this brief

**Tepna problem.** Vigil box established that there is **no standard HCI anchor** for ACL/GATT
notifications, that kernel-side timestamps need `CAP_NET_RAW` (an owner action), and that BLE's
**7.5 ms connection interval** is a floor beneath everything. The conclusion was that better alignment
requires privileged access.

| work | claim | status |
|---|---|---|
| *Application-layer time synchronization and data alignment method for multichannel biosignal sensors using BLE protocol* — PMC10144216 | sync + alignment implemented **in the BLE application layer**, no additional hardware | verified exists · **claim unread** |
| *Comparison between two time synchronization and data alignment methods for multi-channel wearable biosensor systems using BLE* — PMC10007376 | **absolute time alignment error < 1.8 ms**, transferable between commercial MCUs | verified exists · **claim unread** |
| *Wireless body-area network time synchronization using R peak reference broadcasts* — US 10375659 | uses the **R peak as a shared reference event** across devices | verified exists |

**Why this matters:** < 1.8 ms is *below the 7.5 ms connection interval*, achieved **at the
application layer with no extra hardware** — i.e. a route around the exact blocker that currently
needs owner sign-off. ⚠️ I have not read these; the number may be measured under conditions we cannot
meet (a controlled MCU firmware we do not own, rather than stock Polar devices). **Read before
believing.** But if it holds even approximately, it reopens a question recorded as closed.

The R-peak reference broadcast is the second idea: both devices observe the *same heartbeat*, so a
physiological event becomes a shared timestamp. Note this is **not** the beat-train alignment that
fails mod-one-RR — it is an explicit broadcast of a marker, which is the aperiodic-anchor shape the
suite's own briefs call for.

### 13d.2 · RUSSIAN — a decomposition that fits the gap round four exposed

The productive term is **разладка** (*disorder*) — the Shiryaev school's own word, and searching
`change point` in English does not reach this literature.

**SSA — Singular Spectrum Analysis** (*Особенности применения метода SSA для обнаружения разладки во
временных рядах*) decomposes a series into **trend + oscillatory + noise components
non-parametrically**, with no model assumed. Also found: *Математические модели временных рядов с
трендом в задачах обнаружения разладки* — change-point detection **against a trend background** for
quasi-periodic series.

**This lands exactly on §13c.2's gap.** Tepna prints *"deterministic — fit and remove it"* and never
detrends or looks for periodicity. The Chinese GNSS pipeline does it parametrically (quadratic fit →
FFT → residual). SSA does it **non-parametrically**, which matters because we do not know the periods
in advance — 7.5 ms interval beating, ~90 s reconnect cycle and thermal drift are hypotheses, not
knowns. *(All entries: verified exist · authors/DOIs unverified.)*

### 13d.3 · JAPANESE — a way around the PAT wall rather than through it

**Tepna problem.** `dead-ends` wall 7: cross-device PAT is unrecoverable, and the cause is **open**.

The Japanese PTT literature reports that **PTT derived from the fingertip PPG waveform alone —
without ECG — is comparable at rest to PTT derived from ECG + PPG together**
(光産業創成大学院大学 dissertation; 中央大学 土肥 tonometry work).

**If that transfers, it dissolves the blocker rather than solving it.** Tepna's PAT wall is a
*cross-device clock* problem; a single-device interval has no cross-device clock in it. The suite has
never tested whether the intra-device PPG-only interval carries the information, because it went
looking for the two-device version first.

⚠️ The same literature is candid about the limits: 脈波は血圧以外の影響を受ける — the pulse wave is
affected by things other than blood pressure — and PTT correlates poorly with *spontaneous*
within-subject BP variation. So this is a route to a **timing** measurement, not a BP claim.

### 13d.4 · FRENCH — already integrated, and the papers under-cite it

**A correction to my own round-four self-criticism.** I said the search had been Anglophone. In
*this* area it was not, and the codebase proves it:

```
Vernotte     briefs=4  docs=1  code=1   papers=0
Groslambert  briefs=4  docs=1  code=1   papers=0
KLTS         briefs=1  docs=0  code=1   papers=0
```

**Groslambert Covariance** (FEMTO-ST / Vernotte, Besançon) is the French alternative to the
three-cornered hat, and it is the method built for the case where **TCH returns negative variance** —
which `tch-multinight` hits on 8 of 53 nights. It is already implemented here. **KLTS**
(Karhunen–Loève Transform using Sufficient statistics, arXiv 1904.05849) is the rigorous
confidence-interval method for both TCH and GCov.

**The gap is not knowledge, it is publication.** `papers=0` across all three: `sigma-no-reference`
reports an across-night **bootstrap** CI and never mentions that a rigorous CI method exists and is
known internally. The papers under-cite what the codebase already does.

### 13d.5 · CZECH and GERMAN — institutional context, no new method

- **ÚFE Prague** (Ústav fotoniky a elektroniky AV ČR) — Laboratoř Státního etalonu času a frekvence,
  the associated ČMI laboratory realising **UTC(TP)** on 5071A caesium standards, with time transfer
  by satellite and optical fibre. Worth knowing: NTSC's own BeiDou common-view work was **China–Czech,
  against UTC(TP)** — the national lab nearest this project is already in that network.
- **PTB** (Physikalisch-Technische Bundesanstalt) — extensive GUM and traceability material, but it is
  the same GUM already covered in §1. No new method; a good teaching source for uncertainty budgets.

### 13d.6 · What the multilingual round says about the method

Six languages, and the yield was **uneven in an informative way**: Korean and Russian produced
methods, Japanese produced a reframing, French produced a *correction to my own criticism*, Czech and
German produced context. The lesson is not "search everything" — it is that **the fields organise
differently by language community**, so the same query reaches different work:

- GNSS/satellite-clock work is heavily Chinese-language → periodicity extraction is routine there.
- Sequential change-point theory is heavily Russian → *разладка*, and CUSUM without Shiryaev is
  half the field.
- Wearable BLE sync engineering is heavily Korean → application-layer alignment is a live subfield.
- Time-frequency estimator theory has a strong French school → GCov, KLTS.

⚠️ **Everything in §13d is verified for EXISTENCE only.** None has been read; several are behind
translation. The claim I would most like to be true — < 1.8 ms application-layer BLE alignment — is
exactly the one I would trust least until read, because it contradicts a conclusion this project
reached by measurement.

## 13e · ROUND SIX — beyond clocks: the mathematics the physiology needs

Rounds 1–5 over-indexed on time handling because that is where the recent work sat. Tepna is also
oximetry, HRV, ECG, PPG, CGM, CPAP and respiration. Four fields, each with a **checkable** consequence.

### 13e.1 · Point-process modelling of heartbeats — and an ORACLE we do not have

**Tepna problem.** rMSSD and SDNN are computed over *windows*, so every HRV number is a σ-per-window
figure with the same defect limitation (x) documents for the hat. Worse, there is no way to ask
whether a beat series is *well described* at all.

| work | detail | status |
|---|---|---|
| **Barbieri, R., Matten, E. C., Alabi, A. A. & Brown, E. N. (2005)** — *A point-process model of human heartbeat intervals: new definitions of heart rate and heart rate variability*, Am. J. Physiol. Heart Circ. Physiol. | history-dependent **inverse Gaussian** model; yields **instantaneous** HR and HR-variability rather than window averages | verified · PMID 15374824 · DOI unverified |
| **Brown, E. N. et al. (2002)** — *The time-rescaling theorem and its application to neural spike train data analysis*, Neural Computation 14(2) — **DOI `10.1162/08997660252741149`** | KS test on rescaled inter-event times | verified + DOI **(resolved 2026-08-17)** |
| *Characterizing nonlinear heartbeat dynamics within a point process framework* | PMID 20172783 | verified |

**Two consequences, and the second is the important one.**

1. **Instantaneous HRV removes the window-length parameter** from the same class of quantity the σ
   paper had to caveat.
2. **The time-rescaling KS test is a goodness-of-fit oracle for a beat series** — and this project's
   defining constraint is that it has *no reference*. A KS test on rescaled intervals does not need
   one: it asks whether the observed beats are consistent with **any** point process of the fitted
   form. A night whose beats fail it has a detection problem, and that verdict is available **without
   a second device**. Given `dead-ends` wall 2 (a per-beat SQI stays green while beat-yield fails,
   inflating rMSSD a median +83 %), this is a candidate detector for exactly the failure the SQI misses.

### 13e.2 · Compositional data analysis — sleep-stage proportions are not ordinary numbers

**Tepna problem.** Sleep-stage proportions sum to 1. Standard statistics on such data is invalid:
components are not free to vary independently, so a correlation between "% deep" and anything else is
partly an artifact of closure.

| work | detail | status |
|---|---|---|
| **Aitchison, J.** — log-ratio analysis of compositional data | scale invariance, permutation invariance, **subcompositional coherence** | verified, foundational |
| **isometric log-ratio (ILR) transform** | preserves metric properties; the standard pre-analysis step | verified, method |
| *Reframing sleep architecture: a compositional and temporal approach to sleep data analysis* | bioRxiv 2025 — treats stage proportions as compositional; notes this is still **novel** in sleep research | verified, preprint |
| 24-hour movement / time-use literature | log-ratio **balances** for sleep vs sedentary vs active | verified, established |

**Do:** any analysis relating a stage proportion to an outcome — `DEEP-STAGE-DESAT-CONFOUND` is the
live one — should use ILR coordinates rather than raw proportions, or state that closure was ignored.

### 13e.3 · Extreme value theory — nadir SpO₂ is length-dependent, and we compare it across nights

**Tepna problem, and it is checkable.** The nadir is the **minimum of a series**. The expected minimum
falls as the series lengthens, *for purely sampling reasons and with no change in physiology*. Our
nights run **4,372 s to 30,410 s — a 7× range.**

Measured 2026-08-16:

```
nadirDensity = nadirCount / durationHr        ← count IS normalised by duration ✓
tools/cpap-sa2-agreement.mjs:191              ← the nadir VALUE is a plain running minimum ✗
```

`OXYDEX-NADIR-HONESTY` (RUNAWAY-FIX-FOLLOWUPS §1/§2) already excludes **non-physiological** lows —
perfusion-settling ramps and self-gated artifact desaturations. **That is validity of the reading, not
the sampling effect, and the two are independent.** A perfectly valid minimum is still expected to be
lower on a longer night.

| work | detail | status |
|---|---|---|
| **Generalized Extreme Value (GEV) distribution** | limiting law for block minima/maxima; gives a *distribution* for the nadir rather than a point | verified, foundational |
| **Block minima** vs **peaks-over-threshold (POT)** | POT is the closer fit: T90 and desaturation events are already threshold exceedances | verified, method |
| Fisher–Tippett–Gnedenko; Pickands–Balkema–de Haan | the two limit theorems underneath | verified, foundational |

**Do:** either report nadir with its night duration attached — the same discipline §7 already imposes
on `ppm` — or model it as a GEV/POT quantity so nights of different length are comparable. Note the
suite is *already* doing POT without naming it: an ODI event **is** a threshold exceedance.

### 13e.4 · Tissue optics — why finger and wrist PPG are not two samples of one thing

**Tepna problem.** O2Ring finger PPG and Verity wrist PPG are treated as two optical corners of a hat
whose assumption is uncorrelated errors. The physics says they sample **different tissue volumes over
different path lengths**.

| work | detail | status |
|---|---|---|
| *Monte Carlo analysis of optical interactions in reflectance and transmittance finger photoplethysmography* — PMC6412556 | transmittance (finger clip) vs reflectance (wrist) are **different optical problems** | verified |
| *Impact of sensor configuration and melanin concentration on reflective pulse oximetry using Monte Carlo simulations* — Sci. Rep. 2025 | sensor geometry and melanin both shift the result | verified |
| **modified Beer–Lambert law** and its failure | it models the site as a non-scattering cuvette; tissue is **highly scattering**, so mean photon path length is wavelength-dependent and not the geometric distance | verified, foundational |

**Two consequences.** The red/IR **optical paths and penetration depths differ**, and the deviation
grows with source–detector separation — so a 3-LED consensus is combining channels that did not
traverse the same tissue. And the finger/wrist difference is **structural, not a quality difference**:
transmittance through a finger and reflectance at a wrist are different measurements of different
volumes, which bears directly on whether their errors can be assumed independent.

⚠️ Also worth knowing for any accuracy claim: **melanin concentration shifts reflective pulse
oximetry** — a documented equity issue, and this is a single-subject corpus.

### 13e.5 · Fields checked and NOT recommended

Recorded so nobody re-walks them: **econometric cointegration** for two drifting clocks is a real
formal match, but the suite's clock work is already better served by the time-frequency estimators it
uses. **Queueing theory** for BLE arrivals is subsumed by the IPDV/PDV literature in §13b.5, which is
closer to the measurement. Neither is wrong; both are longer routes to somewhere §2 and §13b already
reach.

## 13f · ROUND SEVEN — the bias was CANON, not language

### 13f.1 · The language framing in §13d was itself a bad model

§13d organised the search by language and drew a lesson about "which community owns a problem". That
is half right and it obscured the larger effect. **Most current research worldwide publishes in
English** — India, Brazil, Iran, Turkey, Poland, Israel, the Nordics — so a language-based search does
not reach it either, and the absence had a different cause:

> **Searching for "the canonical work" systematically retrieves the oldest, most-cited paper in a
> field, which is disproportionately mid-20th-century and Western. Searching for CURRENT work
> retrieves a globally distributed set, in English, that the canonical query never surfaces.**

Tested rather than asserted. Rounds 1–4 asked for foundations and returned Allan 1966, Page 1954,
Cronbach 1972, Isermann 1984, Julier 1997. One query phrased for *recency* on the same subject matter
returned a 2022 benchmark, a 2025 algorithm paper, four public datasets and three 2025–26 foundation
models — none of which any canonical query had produced.

### 13f.2 · What the recency query found, and the one thing it leaves open

**Already known here, and correctly closed — recorded so nobody re-opens it:**

`PPGDEX-ALGORITHM-DEEP-DIVE` §… already cites **Charlton et al. (2022)**, *Detecting beats in the
photoplethysmogram: benchmarking open-source algorithms*, Physiol. Meas. 43 — **DOI
10.1088/1361-6579/ac826d** — knows it ranks **MSPTD** and **qppg** top, and concludes with evidence
that *"MSPTDfast v.2's published F1 is statistically indistinguishable from the shipped TERMA on
wearable-at-rest data … there is no headroom to buy."* Measured baseline: beat sensitivity median
**1.0000** (IQR 0.928–1.000, **range 0.609–1.000**), PPV median 1.0000 (range 0.610–1.000). The
distribution is reported honestly; the algorithm question is settled.

**The remainder is narrow and real: those figures are tagged `[CORPUS]`.** They are agreement against
our own H10 ECG on our own recordings — a **transfer standard**, which `sigma-no-reference` itself
names as a distinct validation mode from a reference. Meanwhile:

| dataset | status here |
|---|---|
| **CapnoBase** | 0 mentions |
| **BIDMC** | 0 mentions |
| **MIMIC PERform** | 0 mentions |
| **PPG-DaLiA** | 0 mentions |

These are **public corpora with expert-annotated beats** — a genuine external reference, not a second
device. They are the corpora Charlton's benchmark itself runs on, so a score computed on them is
directly comparable to published numbers.

**The distinction this exposes is worth more than the datasets.** This project's founding constraint
is "we have no reference". That is true of **our recordings**. It is *not* true of **our detector**:

> A detector can be validated on externally-annotated public data; a recording cannot.
> The suite has treated these as one problem, and they are two.

**Do:** run `ppgdex-dsp.js`'s detector on CapnoBase/BIDMC and report sensitivity/PPV against the
expert annotations. It converts a transfer-standard agreement into an **external known-answer**, is
directly comparable to a published benchmark, needs no new capture, and is the same argument Vigil box
made for checking `allan.py` against AllanTools. Also worth noting the worst night here is **0.609** —
an external corpus would say whether that is a hard night or a detector limit.

**Also surfaced, not evaluated:** PPG foundation models (Pulse-PPG, PaPaGei-S, ~20 M segments) and a
2026 Biosignale benchmark of ten open-source R-peak detectors across five datasets including
ambulatory and arrhythmic rhythms. Recorded for completeness; neither is a fit for a suite whose rule
is that model output cannot be evidence.

### 13f.3 · The revised search rule

Both effects are real and they compound. For future literature work in this project:

1. **Ask for the canon AND ask for the last three years.** They return disjoint sets, and the second
   set is where the global distribution of researchers actually appears.
2. **Ask which community owns the problem** (§13d.6) — GNSS clock analysis, sequential detection,
   wearable BLE engineering and estimator theory each concentrate somewhere.
3. **Ask what public annotated data exists** before concluding a quantity has no reference. That
   question was never asked in six rounds, and it had an answer.

## 13g · ROUND EIGHT — asking a Chinese-trained model, and what it could and could not do

**The question (owner, 2026-08-16): can we ask a Chinese AI for science relevant to Tepna?**
Answered by running it, because the interesting result is not the reading list — it is what the
model turned out to be good and bad at, which is measurable and was measured.

**Setup.** No API access to DeepSeek or any Chinese cloud service, and none was used — nobody was
queried or flooded. But **Qwen is Alibaba's**, and three Qwen builds already sit on this disk under
Ollama. So the Chinese-model question was answerable locally: `qwen3.8:27b`, one prompt, temperature
0.3, no network, no cost. The prompt named our five real problems (non-linear ppm drift with no
reference clock; PPG beat detection under nocturnal motion; PRV-vs-HRV and ectopic correction;
nadir-SpO₂ statistics; non-stationary decomposition) and asked for work a Western search would miss.
It carried one instruction that turned out to matter: **do not invent DOIs; write "uncertain" instead.**

### What it did well — and it is not what I expected

**It obeyed the honesty instruction, unprompted-by-example.** It emitted **no DOIs at all**, labelled
its own author lists *"Representative names from NIM/CAS groups"*, and closed by saying the citations
should be looked up in **CNKI (中国知网) and Wanfang (万方)** rather than taken from it. A model that
volunteers "I have given you method names and likely venues, not papers" is behaving correctly, and
that is worth recording against the assumption that these models simply fabricate.

**Its one genuinely actionable output was a pointer to the DATABASES, not to any paper.** That is the
round's real finding, and it is a structural gap rather than a citation gap:

| | files in repo |
|---|---|
| `CNKI` | **0** |
| `Wanfang` / `万方` | **0** |

Rounds four and five searched *in Chinese* — but through Western-indexed channels. **The Chinese-language
databases where this literature actually lives have never been queried at all.** No amount of better
prompting fixes that; it needs a different index.

### What it did badly — measured, not assumed

- **It produced zero retrievable Chinese-language papers.** Every Chinese title it offered
  (《基于鲁棒估计的三叉戟法时钟噪声分离》, 《非平稳时钟噪声的改进阿伦方差分析》, and eight more) is a
  *plausible-looking title for a paper it could not confirm exists*. Its verifiable output consisted
  entirely of methods that are canonical **internationally** — which is the opposite of what was asked.
- **It mis-attributed a Western measure to Chinese groups, and we already had it.** Its
  "Hypoxemia Area Index … from West China Hospital or Peking University Third Hospital" is the
  **hypoxic burden** measure — Azarbarzin et al., already present in **25–27 files here**. Had the
  claim not been checked it would have entered as both a new finding and a new attribution, and both
  would have been wrong.
- **The failure mode is the round-seven mechanism again, from the other side.** Round seven found our
  *searching* was canon-biased. The model is canon-biased **in its training**, so asking it for
  non-canonical work returns canonical work wearing non-canonical labels. It cannot be the fix for the
  bias it shares.

**Verdict on the technique: worth one prompt, not a programme.** It is the generation/retrieval axis
from `qwen_run.py`'s banner — the output was a set of *pointers to check* (cheap when wrong) and it was
right about the shape of the field while wrong about its contents. Do not query it again for citations.
**Do act on the CNKI/Wanfang gap**, which is the one thing it told us that we could not have told
ourselves.

### What the round actually adds to the reading queue

**A. The EMD / Hilbert–Huang family is entirely absent — and that is an unexamined gap, not a decision.**
Measured across `briefs/ papers/ docs/ audits/ *.js capture-host/`:

| term | files |
|---|---|
| `empirical mode decomposition` · `EEMD` · `CEEMDAN` · `Hilbert-Huang` | **0** |
| `variational mode decomposition` | **0** |

⚠️ A prior grep for `VMD` returned **8 files** and every one was a false positive — the base64 fragment
`…VMd8yV9…` inside a bundled hash in `docs/*.html`. Case-insensitive acronym greps over bundles are
unreliable; that hit would have been reported as "we already know VMD". *(§0's adjacency warning has a
cousin: substring ≠ mention.)*

All four verified against Crossref (author · year · venue confirmed, DOIs resolve):

- **Huang, N. et al. (1998).** The empirical mode decomposition and the Hilbert spectrum… *Proc. R. Soc. Lond. A.* [`10.1098/rspa.1998.0193`](https://doi.org/10.1098/rspa.1998.0193)
- **Wu, Z. & Huang, N. (2009).** Ensemble empirical mode decomposition: a noise-assisted data analysis method. *Adv. Adapt. Data Anal.* [`10.1142/S1793536909000047`](https://doi.org/10.1142/S1793536909000047)
- **Torres, M. et al. (2011).** A complete EMD with adaptive noise (CEEMDAN). *IEEE ICASSP.* [`10.1109/ICASSP.2011.5947265`](https://doi.org/10.1109/ICASSP.2011.5947265)
- **Dragomiretskiy, K. & Zosso, D. (2014).** Variational Mode Decomposition. *IEEE Trans. Signal Process.* [`10.1109/TSP.2013.2288675`](https://doi.org/10.1109/TSP.2013.2288675)

**Read these with the criticism attached, not as a recommendation.** EMD is empirical — no
convergence theory, mode mixing, endpoint effects, and it is *sensitive to sampling and noise
realisation*, which for a timing pipeline is the property that matters most. VMD's variational
formulation is the principled member of the family. **CHECKABLE CONSEQUENCE, and the only honest way
to evaluate it here:** decompose a PPG segment, extract beats from the reconstruction, and compare beat
times to the simultaneous ECG R-peaks — if IMF-based beats are not *more* stable against the ECG
reference than the current detector, the family is not worth its cost. That is a test we can already
run on the trio corpus, and it can come out negative.

**B. Three-cornered hat has a large applied literature outside metrology — and it is N ≥ 3.**
§3 of `CROSS-DOMAIN-METHODS-FOLLOWUPS` already records triple collocation and E-QC, so **this is not
new ground**; what is new is that atmospheric and hydrological science run TCH itself at scale, with
generalisations past three datasets and explicit negative-variance handling:

- **Sjoberg, J. et al. (2021).** The Three-Cornered Hat Method for Estimating Error Variances of Three
  or More Atmospheric Datasets, Part I. *J. Atmos. Oceanic Technol.*
  [`10.1175/JTECH-D-19-0217.1`](https://doi.org/10.1175/JTECH-D-19-0217.1) — verified.
- Adjacent and unread here: Bayesian TCH (BTCH) for merging; TCH extensions to four gridded products;
  TCH under two error-correlated datasets — the last being **exactly our case**, since H10 and Verity
  share one phone host and their errors are therefore not independent.

**C. Extreme-value treatment of nadir SpO₂ remains absent** (`generalized extreme value` · `extreme
value theory` → **0 files**), confirming an open recommendation already on record rather than adding a
new one.

### Method note for whoever runs the next round

Three of this session's searches converged on material the repo already held (triple collocation,
intersecting tangents, Groslambert covariance). That is [[convergence-is-correlated-ignorance]] in its
literal form: **an independent search reproducing a known answer is evidence about the search, not
about the field.** Grep the repo *before* writing a find up, not after — and grep for the method name,
not the acronym.

## 13h · ROUND NINE — online round (2026-08-17): the phase we already measure is circular statistics, and beat trains are spike trains

> **Method for this round, stated per §13f's rule.** Candidates were proposed from the author's own
> canon, then checked online for applied precedent and every DOI resolved against `api.crossref.org`
> at author time — so this round is **canon-biased by construction** and says so. What the search
> added beyond the canon: the SPIKE-distance being **parameter-free**, and an EMD-based rate-robust
> variant (2019). Each entry below names the MEASURED Tepna problem it lands on; a shared vocabulary
> alone was not enough to enter.

### 13h.1 · Circular statistics — the concentration statistic JOINT-UNWRAP built ad hoc has a field, and the field has its NULL

**Tepna problem (measured).** `JOINT-UNWRAP-ATTEMPT` §5 gates on *"phase concentration 0.15–0.38,
where 1 is total agreement"* and reads *"concentration rising 0.29 → 0.59 with block length"* by eye.
That statistic **is the mean resultant length R̄** of circular statistics — the per-block offsets
wrapped modulo one RR are angles on a circle of circumference one RR, and every wrapped quantity in
the PAT family is circular data whether or not it is called that.

**What the field adds that the ad-hoc version lacks: the null.** The **Rayleigh test** answers "at
this n, is this R̄ distinguishable from a uniform phase?" — which is exactly the falsifier *"is there
a phase to regress"* that §5 needed and answered with a threshold chosen by eye. The von Mises
concentration κ is the calibrated version of "how locked", with small-n bias corrections the ad-hoc
statistic silently lacks.

| work | detail | status |
|---|---|---|
| **Berens, P. (2009)** — *CircStat: a MATLAB toolbox for circular statistics*, J. Stat. Software 31(10) — **DOI `10.18637/jss.v031.i10`** | R̄, Rayleigh, von Mises κ, the practical formulas | verified + DOI |
| **Mardia, K. V. & Jupp, P. E.** — *Directional Statistics*, Wiley — **DOI `10.1002/9780470316979`** | the standard reference | verified + DOI · ⚠️ Crossref dates it **1999**, the print convention says 2000 — recorded so a citation matches the ledger, not the habit |

**Do.** Next time a wrapped-phase concentration gates a decision, quote R̄ **with the Rayleigh p at
that n** instead of an eyeballed threshold. Cheap: both are three-line formulas over angles already
computed. **Confidence: HIGH** — the correspondence is an identity, not an analogy.

> ### ✅ BUILT 2026-08-17 — `tools/circular-stats.mjs`, gated `tools · circular-stats`
>
> `rayleighP(n, rBar)` (Zar's approximation, the one CircStat's `circ_rtest` ships) +
> `meanResultantLength`, the latter **pinned by the gate against the DSP-style inline computation** so
> the exported statistic and `_wrappedSlopeFit`'s `concentration` cannot drift apart. Wired into
> `tools/integrator-block-precision.mjs`, which now prints `Rayleigh p<0.01 on k/n` beside the
> concentration it already reported.
>
> **The demonstration that the eyeballed threshold could not carry:** the SAME R̄ = 0.3 is
> uniform-plausible at n = 10 blocks (p ≈ 0.42) and decisive at n = 100 (p ≈ 10⁻⁴). JOINT-UNWRAP §5
> read 0.15–0.38 as "no phase to regress" — whether that judgement is right **depends on the block
> count**, and only the test carries that dependence. Both exact limits are asserted as identities
> (R̄=0 ⇒ p=1; R̄=1 ⇒ p < 10⁻⁷⁰), refusals fire on n<2 / R̄>1 / non-finite input.
>
> **Scope, stated:** the p tests uniformity under an independence assumption; adjacent blocks share
> physiology, so it is mildly anticonservative — a diagnostic beside the statistic, not a gate, the
> `slopeSE` posture. And `integrator-dsp.js`'s own `wrappedConcentration` field is deliberately
> untouched: adding a p there is a compute-closure change that re-verifies the Integrator golden, so
> it **rides the next behavioural re-bundle** — the same economics as `tau0Uniformity`'s wiring.

### 13h.2 · Spike-train distance metrics — the beat-correspondence audit already has a formal object, with the alignment for free

**Tepna problem (named, twice).** `papers/dead-ends.html` §2.7's correction names the outstanding
measurement verbatim: *"a beat-correspondence audit: matching beat counts to 0.02 % refutes net
dropout but not local insertion/deletion pairs, which preserve the total while scrambling which foot
belongs to which beat."* And `JOINT-UNWRAP` measured slips — a dropped or inserted beat — wrecking a
cumulative unwrap with no detector for them. §4's GNSS **cycle-slip** line was closed 2026-08-17 as
not-owed *for the unwrap construction*; this entry is the form that survives that objection, because
an edit-distance alignment **never unwraps — it aligns**.

**Correspondence.** The **Victor–Purpura distance** is an edit distance on point processes: minimum
cost to transform train A into train B, insert/delete at cost 1, shift a spike by Δt at cost q·|Δt|.
**2/q is the timescale at which moving a beat costs as much as delete+insert** — precisely the "same
beat shifted, or a different beat?" boundary the audit needs, made explicit as a parameter instead of
implicit in a matching window. And the dynamic programme that computes the distance returns the
**alignment itself** — which beats pair, which are insertions, which deletions — i.e. the audit, not
just a score. The **van Rossum distance** is the kernel form of the same object; the **SPIKE-distance**
is **parameter-free**, relevant in a repo whose measured failure mode is tuned knobs.

| work | detail | status |
|---|---|---|
| **Victor, J. D. & Purpura, K. P. (1996)** — *Nature and precision of temporal coding in visual cortex*, J. Neurophysiol. 76(2):1310 — **DOI `10.1152/jn.1996.76.2.1310`** | the edit distance; the q timescale | verified + DOI |
| **van Rossum, M. C. W. (2001)** — *A novel spike distance*, Neural Computation 13(4):751 — **DOI `10.1162/089976601300014321`** | kernel form | verified + DOI · ⚠️ Crossref family is **"Rossum"** — a `crossref-variant` alias is owed if this is ever ledgered |
| **Kreuz, T. et al. (2013)** — *Monitoring spike train synchrony*, J. Neurophysiol. — **DOI `10.1152/jn.00873.2012`** | SPIKE-distance, parameter-free | verified + DOI |

**Do — and it is one measurement, on data already in hand.** Run a VP alignment between the ECG
R-peak train and the PPG foot train on the two `INTEGRATOR-PAT-VASCULAR` §2-RESULT-IV nights where the
anchor is identifiable (ncc 0.995–0.996) — **count the insertion/deletion pairs directly**. That IS the
beat-correspondence audit `dead-ends` says is outstanding. Sweep q around 1/(the honest beat-to-beat
SD) for sensitivity. ⚠️ The diagnosis §3.4's warning transfers verbatim: an association method
quantifies ambiguity; it must never be used to *force* a coupling result. **Confidence: HIGH** on the
correspondence; the measurement is the cheap test of whether it earns adoption.

> ### 📏 BUILT AND RUN 2026-08-17 — `tools/beat-correspondence.mjs`, gated `tools · beat-correspondence`
>
> The pure core (banded VP alignment + interval-NCC anchor) is planted-truth tested: 7 planted
> deletions + 4 insertions recovered **exactly**, a −25-beat lag recovered from intervals, an
> out-of-band lag **refuses** rather than reporting, and the q extremes bracket the audit in opposite
> directions. Three of those assertions encode bugs the first version shipped with — worth naming
> because each is a lesson this brief family already teaches, re-learned in miniature:
>
> - **The offset estimator was poisoned by the thing being counted.** Index-paired median: one planted
>   insertion shifts every later pairing by a whole beat, 90 % of deltas land one RR off, the median
>   picks the wrong population (planted 1 insertion → reported d=1, i=2). Fixed nearest-neighbour.
> - **The estimated offset is the MEDIAN of sampled deltas, so one residual is exactly 0 by
>   construction** — and matches at ANY q. An "every beat is an indel" expectation is unsatisfiable
>   without an explicit off-median offset. The code was right; the expectation was wrong, twice.
> - **The mod-RR plane is an integer ambiguity and is resolved the §4 way**: on a phone capture there
>   is no shared clock, so the offset is knowable only mod one RR — the nearest-neighbour estimator
>   landed on the *previous cycle's foot* (offset 44.6 ms where transit is ~400+). The sweep runs the
>   alignment per candidate plane (base + k·medianRR), VP distance is the per-plane cost, and the
>   **margin between best and second-best plane is the ratio test**.
>
> **Measured, on the wrist pair (H10 ECG × Verity PPG — NOT §2-RESULT-IV's finger pair):**
>
> | night | beats (ECG/PPG) | anchor ncc · margin | best plane margin | indel rate | mean·max |Δt| |
> |---|---|---|---|---|---|
> | 2026-07-09 | 24 895 / 24 879 | 0.829 · **0.0002** | **1.2 %** | 37.6 % | 143 · 300 ms |
> | 2026-07-12 | 20 698 / 20 672 | 0.753 · 0.081 | 9.8 % | 43.6 % | 129 · 300 ms |
>
> **⚠️ THESE ARE UPPER BOUNDS UNDER A GLOBAL-OFFSET MODEL, NOT SCRAMBLE MEASUREMENTS — the tool's own
> refusal machinery says so.** Three confounds, all named by the run itself: (1) the beat counts match
> to 0.06–0.13 % while the alignment path walks **±2000 beats** mid-night — large *asynchronous
> dropout segments*, exactly the "counts match, identity scrambled" shape the audit exists for, but a
> dropout is not a scramble; (2) phone captures carry ~7 ppm inter-device drift ≈ 176 ms over the
> night — comparable to the 300 ms budget, so a single global offset cannot fit both ends, and the
> residual max piling at exactly 2/q is the truncation signature; (3) the 07-09 plane margin is 1.2 %,
> i.e. the ratio test does **not** confidently resolve the plane there. Also note the wrist anchors
> (ncc 0.75–0.83) are far below RESULT-IV's finger anchors (0.995+) — a harder signal, not the same
> experiment.
>
> **Next steps, stated rather than smuggled:** per-window offsets (the repo's per-block precedent)
> remove the drift term without beat-circularity beyond a constant per window; and the finger pair
> (O2Ring `.dat`) is the RESULT-IV experiment proper. Neither is done here.

### 13h.3 · The alignment substrate, and probabilistic linkage — recorded so the next searcher stops here

The dynamic programme under 13h.2 is **Needleman–Wunsch** (global) / **Smith–Waterman** (local) —
*Needleman & Wunsch 1970*, DOI `10.1016/0022-2836(70)90057-4`; *Smith & Waterman 1981*, DOI
`10.1016/0022-2836(81)90087-5`; both verified. Sakoe–Chiba DTW is already in the diagnosis (§3.4)
with the do-not-force-coupling warning. And **Fellegi & Sunter 1969** (*A theory for record linkage*,
JASA, DOI `10.1080/01621459.1969.10501049`, verified) is the formal frame if device-pairing ever
needs **quantified match/non-match error rates** rather than nearest-stamp heuristics — LOW priority,
no current consumer; recorded so it is findable, not proposed.

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

- [x] **DONE 2026-08-17** — §2's time-frequency citations ledgered. Three added (Gray & Allan 1974, Riley & Greenhall 2004, Zhou Chunlei 2011); two were already present; two have **no DOI** and cannot be ledger-keyed. See the ✅ block in §2.
- [x] ~~Riley & Greenhall 2004 evaluated against the `1.96·SE` refusal band~~ — **NOT tracked here.** The same question is `HOSTAXIS-STABILITY-FOLLOWUPS` §3 and is being answered there. Tracking it in two briefs is the shape that produced the GENERATOR-FOLLOWUPS-III collision, and `stale-file` cannot see it because the two live in different files.
- [x] **DONE 2026-08-17 — §13b.4 adopted for the arrival lane and rejected for the node lane, both on measurement** (see the ✅ block there). Sesia & Tavella 2008 in; unbiased-AVAR in the JS spine out, because its input is uniform to ≤0.7 %.
- [x] **DONE 2026-08-17** — the one `AUTHORS AND YEAR UNVERIFIED` row (IEEE Xplore 6037776) resolves to `10.1109/icemi.2011.6037776`, Zhou Chunlei et al. 2011, ICEMI — ledgered with a `crossref-variant` alias.
