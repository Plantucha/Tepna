<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-08-14

# The second sweep — five more fields, and a proof that one of our questions has no answer

Follows: [`CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md`](CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md) (DONE).
That brief swept pulsar timing, frequency metrology, network time transfer, neuroimaging methodology
and astrometry. This one sweeps **satellite remote sensing, econometrics, inertial navigation,
software-engineering reliability and experimental-physics methodology** — five fields it did not
touch — and opens with a result that is not from the literature at all.

The trigger was not a reading session. On 2026-08-14 a review of the suite's math turned up a
recommendation **this session had itself made two days earlier** and could not justify on inspection.
Checking it produced §1, and §1 is why the rest of the brief is organised the way it is: once the
question is known to be unanswerable from three sources, the literature stops being a menu of nice
ideas and becomes a list of the four things that actually close it.

⚠️ **Everything numbered here is either measured in this repo, verified by simulation recorded below,
or cited. Nothing is adopted yet.** The parent brief's §2 shipped a scout that then LOST to the method
it was meant to replace, and its §2 premise was retracted twice in one day. Sections here are ranked
by certainty, and the two at the bottom are explicitly speculative.

---

## 1 · 🔴 PROVEN — the TCH correlation ρ is NOT identifiable from three sources, and our "direct measurement" of it is the same three numbers rearranged

### 1.1 · The claim that failed

`integrator-dsp.js:2644` corrects the three-cornered hat for common-mode error using
`_tchRhoFromMotion` — a motion-derived proxy for ρ. A corpus measurement found that proxy correlating
only **0.173** with the "actual" residual correlation computed by `tools/tch-per-epoch-rho.mjs:104`,
and the recommendation that followed was: *stop using the proxy, measure the residual correlation
directly.*

**That recommendation is withdrawn.** The "direct" measurement is

```js
rho: corr(rs.map(r => r.ecg - r.cpap), rs.map(r => r.ppg - r.cpap))
```

and it is the **polarization identity**, i.e. a deterministic function of the three pairwise variances
TCH already consumes:

```
corr(a−c, b−c)  ≡  ½(V_AC + V_BC − V_AB) / √(V_AC · V_BC)
```

Verified by simulation over arbitrary correlation structure and arbitrary sigmas (errors built from
shared latent factors so that A↔B *and* A↔C are genuinely correlated):

| | value |
|---|---|
| residual correlation, measured directly | 0.774010325 |
| same, computed from `vAB`/`vAC`/`vBC` alone | 0.774010325 |
| difference | **5.0 × 10⁻¹⁵** |

It carries **zero** information beyond the pairwise variances. It cannot validate the motion proxy, it
cannot de-bias anything, and the 0.173 figure does not show the proxy is bad — it compared a weak
proxy against a quantity that was never an independent measurement.

### 1.2 · It is also biased as a correlation, by a computable amount

Treated as an estimate of the ECG↔PPG error correlation it is inflated by the *reference's own*
variance. With errors independent by construction,

```
E[corr(e_A − e_C, e_B − e_C)]  =  σ_C² / √((σ_A² + σ_C²)(σ_B² + σ_C²))
```

Monte Carlo, 200 000 draws per row, **true ρ = 0 in every row**:

| σ_A | σ_B | σ_C | measured | algebraic prediction |
|---|---|---|---|---|
| 1.00 | 1.00 | 1.00 | 0.498 | 0.500 |
| 1.00 | 1.00 | 0.50 | 0.198 | 0.200 |
| 1.00 | 1.00 | 2.00 | 0.800 | 0.800 |
| 1.00 | 1.00 | 0.10 | 0.008 | 0.010 |

So with three comparably-noisy sources it reports **ρ = 0.5 for a true 0**, and it is worst exactly
when the reference is the noisy member — which for the ECG/PPG/Oxy trio (σ 0.30 / 0.33 / 1.10 bpm,
TCH medians) is the ring.

### 1.3 · Why no rearrangement can fix it

Three sources give three pairwise variances. The correlated model has four unknowns —
σ_A, σ_B, σ_C, ρ:

```
V_AB = σ_A² + σ_B² − 2ρ σ_A σ_B
V_AC = σ_A² + σ_C²
V_BC = σ_B² + σ_C²
```

**Three equations, four unknowns. Underdetermined, permanently.** ρ must come from outside the triplet.
This is not a defect in our implementation; it is the reason `integrator-tch.js:30` already says ρ
"cannot be detected reference-free — pass `opts.rho`". That comment was right and the follow-up work
drifted away from it.

**Consequence for the shipped code: the motion proxy is the RIGHT SHAPE of answer.** It is external
information, which is the only kind that can close the system. The open question is whether that
particular proxy is any good — and §1.1 means we do not currently have a yardstick to answer it.

---

## 2 · The metrology literature solved this between 1981 and 2019 — and we should read it before writing more code

Frequency metrology has attacked correlated-clock TCH continuously for three decades. Four results
map directly onto open items here.

- **Premoli & Tavella (1993),** *A revisited three-cornered hat method for estimating frequency
  standard instability*, IEEE Trans. Instrum. Meas. — 140 citations.
  <https://consensus.app/papers/details/1ec56177e1025e48b82e00d4008fa6a9/>
  Drops the uncorrelation hypothesis *a priori*, treating it explicitly as **the cause of negative
  estimated variances**, and estimates the full covariance matrix under an optimisation criterion that
  guarantees positive-definiteness. This is the constrained estimator this repo has been circling.

- **Torcaso, Ekstrom, Burt & Matsakis (2000),** *Estimating the stability of N clocks with
  correlations*, IEEE Trans. UFFC.
  <https://consensus.app/papers/details/72943dfbc8f85952a46a45d63d8ee275/>
  Extends to N clocks under cross-correlation **and derives the minimum-variance combination weights**.
  That second half is what the Integrator needs when it fuses disagreeing nodes — it currently has no
  principled weighting under correlated error.

- **Groslambert covariance (GCOV).** Groslambert, Fest, Olivier & Gagnepain (1981),
  *Characterization of Frequency Fluctuations by Crosscorrelations and by Using Three or More
  Oscillators* <https://consensus.app/papers/details/3df797d6c26f5d1cba776a54178f3f9a/> ; revisited by
  Vernotte, Calosso & Rubiola (2016) <https://consensus.app/papers/details/63d41daa132852549ef7cae89b472dfb/>.
  An equivalent formulation that **rejects the instrument's own noise by construction**. Calosso et al.
  (2018) report the background converging to zero "out of the box", with no hypothesis that the
  channels are equally noisy. <https://consensus.app/papers/details/504e53a7599b5eb3a5834d4035381601/>

- **Confidence intervals, which we do not have at all.** Ekstrom & Koppang (2002), *Error bars for
  three-cornered hats* <https://consensus.app/papers/details/009210856c69548193b7c24bbb9c50fc/> derives
  the degrees of freedom. Lantz et al. (2019), **KLTS**
  <https://consensus.app/papers/details/423eebb7e5165f118d73599d925ce372/> gives a Bayesian CDF that
  yields intervals **reliable at one degree of freedom** and whose point estimator is **always
  positive**.

> ⚠️ **DO NOT SWAP TCH FOR GCOV ON THE STRENGTH OF "GCOV IS NON-NEGATIVE".** Schatzman (2021)
> <https://consensus.app/papers/details/a91094bfdd6f5b659727f825eccf416c/> compares the N-oscillator
> extensions of both and finds extended TCH **superior, especially at large τ**; notes GCOV *also*
> produces negative intermediaries needing special treatment; and states that TCH's negative-variance
> weakness "can be repaired by reformulating TCH as a maximum likelihood problem." The ML
> reformulation is likely the cheaper and better fix than a rewrite.

> 🔴 **AND DO NOT DELETE THE NEGATIVE-VARIANCE PATH.** `integrator-tch.js` uses a negative split as its
> **independence alarm** (`negativeAt` / `nNegative`, DA-V F6), and that alarm is load-bearing — it is
> how the broken-independence case surfaced at all. Any always-positive estimator must be added
> **alongside** the unconstrained solve, never in place of it. An estimator that cannot go negative
> cannot tell you the model is wrong.

---

## 3 · Geoscience calls it triple collocation, and has already built the fix for §1

Satellite validation faces the identical problem — no ground truth, three or more estimates of one
quantity — and developed **triple collocation (TC)** independently. Its literature has gone further
than metrology's on exactly our blocker.

- **Extended Quadruple Collocation (E-QC).** Pierdicca, Fascetti, Pulvirenti & Crapolicchio (2017),
  IEEE J-STARS. <https://consensus.app/papers/details/a75940498bf75b9cbed3c57dac543dd4/>
  Adds a fourth system and **automatically identifies WHICH PAIR carries the cross-correlated error**,
  then compensates for it, recovering each system's error SD — which is "otherwise biased if cross
  correlation is not taken into account". A synthetic experiment plus five real products (SMOS, ASCAT,
  SMAP, ERA-Interim, in-situ) confirm it localises the correlated pair. Companion IGARSS paper:
  <https://consensus.app/papers/details/a597735e88fe51bd97f2a1f343d367ef/>

  **This is strictly better than "add a fourth source".** It does not require assuming where the
  violation is; it finds it. §1.3 says ρ must come from outside the triplet — a fourth stream *is*
  outside the triplet, and E-QC is the estimator that spends it.

- **Which assumptions actually matter.** Balasubramaniam et al. (2025), *The Impact on Triple/N-Way
  Collocation-Based Validation of Remote Sensing Products Due to Non-Ideal Error Statistics*, Remote
  Sensing. <https://consensus.app/papers/details/c0f0e31fa0885edd83f430f78fc487e8/>
  Tests each TC assumption in a simulator, finds **error cross-correlation among the most damaging**
  when violated (others matter much less), and publishes corrections. This is the sensitivity analysis
  this repo has never run on its own hat.

- **Confidence intervals for unevenly-sampled series.** Chen, Crow, Bindlish et al. (2018), *Remote
  Sensing of Environment*, 225 citations.
  <https://consensus.app/papers/details/7b713504ae9259b28a2cfe4a0e0ccb3b/>
  Constructs intervals by **moving-block bootstrap designed to preserve temporal persistence** in
  unevenly-sampled series — which is precisely our epoch structure, and precisely why a naive
  bootstrap over epochs would be wrong.

- **Triplet choice is itself a variable.** He et al. (2023), Remote Sensing.
  <https://consensus.app/papers/details/2bbe0434c0ce56ed8498db49c17c607d/>
  Shows there is an *optimal* triplet — the one violating the assumptions least — and that removing
  seasonal (here: circadian / posture) variation substantially improves error estimation.

### 3.1 · ⚠️ MEASURED — E-QC resolves the pair only UP TO ITS COMPLEMENT, and our corpus cannot run it

The claim above ("runnable on the existing corpus with no new sensor") was **wrong on both halves**, and
both were found by pre-registering the power requirement before touching the corpus — the first actual
use of §7's blind-analysis discipline. `tools/eqc-power.mjs`, seeded, planted rho on one pair, real
measured sigmas (ECGDex 0.30 · PpgDex 0.33 · OxyDex 1.10; CPAPDex has no published sigma and is given
0.60, flagged rather than hidden).

**(a) A STRUCTURAL 2-FOLD AMBIGUITY the method's description does not mention.** Exact-pair accuracy
plateaus at a coin flip no matter how much data is supplied, while "pair or its complement" converges:

| N epochs | exact pair | pair-or-complement |
|---:|---:|---:|
| 174 | 35.0 % | 59.3 % |
| 1000 | 45.0 % | 86.3 % |
| 2000 | 50.0 % | 93.3 % |
| 5000 | **51.7 %** | **98.3 %** |

Chance is 16.7 % exact / 33.3 % class. The mechanism is combinatorial, not statistical: in K₄ every
consistency identity containing edge (a,b) — `V_ab + V_cd = V_ac + V_bd = V_ad + V_bc` — **also contains
its disjoint edge (c,d)**, so dropping either one absorbs the contamination equally well. No sample size
fixes this. E-QC therefore narrows the correlated pair from 6 candidates to **2**, which is real
information but is not "identifies which pair".

For us the 2-element classes are `{ECG–Ppg, Oxy–CPAP}`, `{ECG–Oxy, Ppg–CPAP}`, `{ECG–CPAP, Ppg–Oxy}`.
The physically interesting hypothesis — ECG and PPG sharing subject/posture error — sits in a class whose
other member (ring↔CPAP) is *a priori* implausible, so domain knowledge can break the tie. That is a
legitimate resolution, but it must be stated as an assumption rather than presented as a measurement.

**(b) 🔴 A FIRST ANSWER HERE WAS WRONG, AND THE ERROR IS THE INSTRUCTIVE PART.** This section originally
read "the corpus is underpowered by an order of magnitude — only **2 nights** carry both a CPAP recording
and a trio night". That was measured against **`uploads/`**, which holds 20 EDFs over 3 dates. The real
CPAP corpus is `Ecg nightly/CPAP/` — **1194 EDFs over 183 dates**, 2026-01-11 to 2026-07-20.

| | value |
|---|---|
| CPAP dates available | **183** |
| trio nights | 51 |
| **nights with BOTH** | **28** |
| epochs at ~87/night | **~2436** |
| class accuracy at N≈2000 (table above) | **93.3 %** |

**E-QC is well-powered and runnable now.** The fourth stream is `SA2.edf`'s **`Pulse.1s`** channel — 1 Hz
pulse rate, confirmed by reading the EDF header: `['Pulse.1s', 'SpO2.1s', 'Crc16']`.

The lesson is this repo's most-repeated one: **presence of a file is not presence of the data, and the
directory you happen to look in is not the corpus.** "Underpowered, reclassify as a capture-protocol
item" would have deferred a runnable analysis indefinitely, and it would have read as rigour because it
arrived with a power table. The power table was fine; the denominator was not.

⚠️ **AND IT REMOVES (a)'s ESCAPE HATCH.** Above, the 2-fold ambiguity was dismissed on the grounds that
the class `{ECG-Ppg, Oxy-CPAP}` has one *a priori* implausible member. It does not: the O2Ring and the
ResMed SA2 are **both pulse oximeters**, so shared optical/perfusion error between them is exactly as
plausible as shared subject/posture error between ECG and PPG. Both members of the one class we care
about are live hypotheses, so domain knowledge does **not** break this tie — which is precisely the case
the caveat exists for.

**We have four HR streams on CPAP nights** (OxyDex ring, ECGDex H10, PpgDex Verity, CPAPDex device
pulse rate). ⚠️ But see §3.1 — this was measured and the corpus does NOT support it.

---

## 4 · ❌ TESTED AND REJECTED — the one-sided estimator is right in theory and LOSES on the step

**This section proposed the change, the change was built and measured, and the measurement refuted
it. Both halves are kept, because the reasoning is still correct and the next session will otherwise
have the same idea.** Same pattern as the parent brief's §2, which shipped a Fourier-domain template
that then lost to the method it was meant to replace.

### 4.1 · The reasoning, which still stands

`DexClock.hostAxis` (`clock.js:432`) smooths host−device divergence with a **running median of width
21**, chosen against **symmetric ±100 ms jitter**. But BLE delivery delay is **one-sided** — a packet
arrives late, never early — so the contamination is a non-negative additive term and a median, which
assumes symmetry, discards the cleanest half of the data. NTP has selected the **minimum-delay**
sample from a sliding window since the 1980s, on the stated grounds that "as the delay increases, the
offset variation increases, so the best samples are those at the lowest delay".
<https://www.ntp.org/documentation/4.2.8-series/filter/>

And the repo already agrees with itself in the other lane: `capture-host/clock_offset.py` implements
Moon et al.'s lower-envelope LP **and Paxson's per-subset minimum**, and its docstring cross-references
`hostAxis` while doing it.

### 4.2 · 🔴 FIRST, A SEPARATE DEFECT — the width-21 experiment IS NOT IN THE REPOSITORY

CLAUDE.md §7 records the choice as "planted recovery against ±100 ms jitter on real geometry (9 → 77 ms
worst, 21 → 57, 41 → 168, 81 → 245)". **No harness producing those numbers is committed anywhere** —
not in `tools/`, not in `tests/`. They are prose. So the number governing the whole fleet's clock
smoothing could not be re-run, and no challenger could be scored against it.

Fixed here: **`tools/hostaxis-estimator-bakeoff.mjs`** — seeded RNG (never `Math.random`, which would
make a bakeoff as unreproducible as the thing it replaces), real anchor geometry read from a Polar
Sensor Logger export (3001 anchors over a 481 min span), the shipped `DexClock.hostAxis` loaded in a
co-loaded realm so the baseline is the real function and not a lookalike.

### 4.3 · THE MEASUREMENT — the answer inverts on whether the plant contains a clock STEP

Scored two ways on purpose: `shape-worst` removes a constant offset (what `correctionAt()` actually
consumes, since the node has already anchored `t0Ms`), `ABS-worst` keeps it (because `ppm` reads
`sm[n-1]`, where a constant bias does not fully cancel). A one-sided statistic is deliberately biased
downward by the noise floor, so scoring it on shape alone would flatter it exactly where it is weakest.

**Smooth non-linear drift only** — the one-sided family wins, exactly as predicted. At the shipped
width, under one-sided noise: `min-21` **8.0 ms** worst vs `median-21` **19.7 ms** — 59 % better.

**Add a 250 ms clock step mid-record and it inverts completely:**

| estimator | shape-worst | ABS-worst |
|---|---:|---:|
| **median-21 (shipped)** | **44.6 ms** | 49.6 |
| median-41 | 75.5 | 68.0 |
| median-81 | 95.9 | 97.2 |
| q25 / q10 / min, every width | 237–248 | 245–260 |

**The mechanism is not a tuning accident.** A windowed **minimum lags a FULL window** at a
discontinuity — it keeps returning pre-step values until the entire window has passed the step —
where a median lags only half. The one-sided family's ~240 ms error is essentially the whole step
size, i.e. it does not track the step at all.

That is disqualifying by CONTRACT and not merely by score: §7 states `maxStepMs` exists precisely to
surface a genuine clock step "rather than hiding it in a slope". An estimator that flattens steps
defeats the diagnostic the axis is required to publish.

### 4.4 · What this does and does not settle

- **Do not adopt a bare one-sided statistic in `hostAxis`.** Measured, twice, both metrics.
- `clock_offset.py` remains right for ITS problem: it fits a line through per-subset minima over a
  quiet offset series. `hostAxis` must track curvature AND steps in one pass. Different problems, and
  the difference is the step.
- ⚠️ **The harness still does not reproduce §7's recorded ordering** (this one's median row is roughly
  flat across widths; §7 has it sharply worse at 41 and 81). So the candidates were scored against *a*
  plant, not against *the* plant — §4.2 again, and it cannot be closed while the original is missing.
  Anyone re-opening this should say which plant they used before quoting a number.
- **The live candidate is a HYBRID, and it is real work rather than a transplant.** NTP does not rely
  on the filter alone; it pairs minimum-delay selection with spike/step handling. That is the only
  version of this idea still standing.

---

## 5 · The closure tolerance has a closed form — do not Monte-Carlo it first

`integrator-dsp.js:5466` sets the 3-source clock-closure tolerance to

```js
Math.max(5, 0.25 * Math.max(Math.abs(d1), Math.abs(d2), Math.abs(d3)))
```

Measured over the trio corpus, that model has **no support**: correlation between closure error and leg
magnitude is **r = −0.238** (slightly the wrong way), median |closure| is **8.4 ppm** against a 5 ppm
floor, and the distribution is **bimodal** — 12 nights ≤ 17.8 ppm, a 17 ppm gap, then two at 34.8 and
46.3. So roughly two nights have a genuinely wrong fit and about eight currently-voided nights are
threshold artifacts.

Both candidate replacements were rejected with reasons (#1231): naive OLS underestimates the observed
closure noise **10×** because block offsets are correlated; σ_y(τ_max) overestimates **~25×** because
ADEV answers a different question than "how precisely is a slope over T determined". `blocks_` was
exposed as the prerequisite and nothing was changed, on the principle that replacing one unjustified
constant with another is not a fix.

**Econometrics has the estimator for exactly "OLS slope uncertainty when residuals are
autocorrelated": Newey–West HAC.** The documented failure mode matches our measurement precisely — OLS
and HAC agree at zero autocorrelation, but "the OLS coverage rate drops rapidly as autocorrelation
increases". That is the 10× underestimate, named and solved.

> Newey & West (1987). Practical references: <https://www.econometrics-with-r.org/15.4-hac-standard-errors.html>
> · Stata `newey` <https://www.stata.com/manuals/tsnewey.pdf> · MATLAB `hac`
> <https://www.mathworks.com/help/econ/hac.html>

⚠️ **Bandwidth (lag truncation) selection is the judgement call**, and the sources agree sensitivity
analysis matters in small samples — our blocks-per-night count *is* a small sample. Report the
tolerance under two or three bandwidths before adopting one, and prefer §3's moving-block bootstrap as
the cross-check rather than as a competitor.

---

## 6 · Reading a noise type off an Allan slope is the known-weak step, and it is not our weakness alone

`DexClock.classifyAllan` names a noise type from the OLS slope of log-log ADEV points, refusing when a
category boundary lies within 1.96 SE (#1227). That refusal was the right instinct, and the reason is
structural rather than local: **the IEEE-standard procedure (647-2006, 952-2020) is explicitly
"human-based interpretation of linear trends"** — we automated an eyeball.

Two known weaknesses of our version, both real:

1. **Unweighted OLS over correlated points.** Overlapping ADEV estimates are correlated and long-τ
   points carry far fewer degrees of freedom, yet dominate the fit. Our own docstrings already say the
   SE is a **lower bound** for this reason.
2. **The EDF circularity** — equivalent degrees of freedom depend on the noise type, so a CI used to
   *decide* the noise type is circular at a boundary. Recorded in #1227 as a reason, not a TODO.

**The principled replacement is the Generalized Method of Wavelet Moments (GMWM)** — Guerrier, Stebler,
Skaloud & Victoria-Feser; *Generalized method of wavelet moments for inertial navigation filter
design*, IEEE Trans. Aerospace & Electronic Systems (2014) <https://ieeexplore.ieee.org/document/6965773/>.
It matches theoretical to sample wavelet variances, is **consistent and asymptotically normal**, and
supports model *selection* with proper intervals rather than slope-reading. The companion framework
paper states plainly that classical AV and PSD analysis **fail when trying to separate error processes
in the spectral domain** — which is our ambiguous-boundary case restated as a structural limit of the
method, not a shortage of data. <https://arxiv.org/pdf/1603.05297>

**Relevance beyond the clock: this entire field is MEMS IMU characterisation.** `motiondex-dsp.js`
analyses accelerometer/gyro data and does none of it. Allan-variance IMU noise identification (angle
random walk, bias instability, rate random walk) is standard practice with tooling and a standard
behind it. <https://www.mathworks.com/help/fusion/ug/inertial-sensor-noise-analysis-using-allan-variance.html>

⚠️ **Scope discipline.** GMWM is a substantially larger dependency-free implementation than anything
in this section. It is listed as the *correct* answer, not the *next* one. The cheap intermediate is
EDF-weighted least squares iterated to a fixed point, treating **non-convergence as the ambiguous
verdict** — which is the same finding as a straddling CI, and which `classifyAllan` already has a
`noise: null` path for.

---

## 7 · ADOPT AS A DISCIPLINE — common-mode blindness is a named, empirically settled failure class

The #1200 polarity defect was invisible to every inter-channel agreement statistic because it affected
all channels identically. The parent brief adopted Kriegeskorte's *double dipping* as a named
discipline (§3); this is its sibling and deserves the same treatment.

**Knight & Leveson (1986),** *An Experimental Evaluation of the Assumption of Independence in
Multi-Version Programming* — 27 programmers independently implemented one specification; the versions
were individually very reliable, but coincident failures were **substantially more frequent than
independence predicts**, and the authors concluded the independence assumption "does not hold".
<https://www.csc.kth.se/utbildning/kth/kurser/DA2210/vettig13/Seminarier/KnightLeveson.pdf> ·
Knight's reply to the critics <http://sunnyday.mit.edu/critics.pdf>

The mechanism transfers exactly: versions share a *specification*, and shared specifications produce
shared misinterpretations. Our three PPG LEDs share an optical path and a mounting; our three HR
sources share a subject and a posture. **Redundancy does not buy independence** — which is the same
conclusion §1 reaches algebraically and the parent brief's §4 reached by measurement (3-LED fusion
bought 2.3 %, not √3, "because the three optical paths share their error").

It was replicated in 2026 with AI coding agents rather than humans, with the same result.
<https://arxiv.org/abs/2606.20158>

**The portable countermeasure, from experimental physics: blind analysis.** Apply a hidden offset to
the parameter under study and unblind only once the analysis is frozen; the standard motivation is that
experimenter bias is "an unquantifiable systematic uncertainty".
<https://www.annualreviews.org/doi/full/10.1146/annurev.nucl.55.090704.151521> ·
<https://arxiv.org/pdf/2311.13542>

Given how often a threshold here is tuned until the corpus looks right, a **blinded protocol for
validating a new detector against a reference** is the concrete adoption. It is a process change, not
code, and it is the cheapest item in this brief.

---

## 8 · Comparable projects — what to compare against, not what to depend on

- **OSCAR (Open Source CPAP Analysis Reporter)** <https://www.sleepfiles.com/OSCAR/> — the closest
  analog to CPAPDex in the world: free, cross-platform, fully local, reads device data down to
  breath-by-breath, and is the de-facto reference the CPAP user community checks against. **If
  CPAPDex and OSCAR disagree on a night, that is a finding either way.** We already validate against
  the device's own `STR.edf` scoring to 0.05/h; OSCAR is a second, independent implementation of the
  same task and therefore a genuinely external check. Source: <https://gitlab.com/pholy/OSCAR-code>
- **NeuroKit2** <https://github.com/neuropsychology/NeuroKit> — ECG/PPG/EDA/EEG/EMG/RSP in Python,
  with a published HRV-in-sleep pipeline <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9307944/>. A
  comparator for PulseDex/HRVDex on the same committed inputs.
- **PhysioKit** <https://arxiv.org/pdf/2308.02756> — low-cost open physiological computing toolkit for
  single- and multi-user studies; the nearest published analog to the capture host.

⚠️ **None of these becomes a dependency.** The no-network / no-CDN / single-file bundle invariants are
not negotiable, and a Python toolkit cannot enter a `Foo.html`. Their value is as **independent
implementations to disagree with**, which §7 argues is the only thing that can see a common-mode error.

---

## 9 · Proposed order, by (certainty × payoff) ÷ cost

| # | item | cost | why this rank |
|---|---|---|---|
| — | ~~§4 one-sided estimator~~ | done | **TESTED AND REJECTED** — see §4.3. Kept in the table so it is not re-proposed as "the cheap one". |
| 1 | §7 blind-analysis protocol | very small | Process, not code. Addresses the failure class that shipped #1200. Now the cheapest item on the list. |
| 1= | §3 E-QC on the 28 CPAP+trio nights | medium | Makes §1's question answerable and is **runnable now** — 28 nights, ~2436 epochs, 93 % class accuracy. Report the CLASS, never the exact pair (§3.1a). |
| 3 | §5 Newey–West for the closure tolerance | medium | Closed form, standard tooling, `blocks_` already exposed. Held below E-QC only because the bandwidth choice needs its own sensitivity study. |
| 4 | §2 ML reformulation / KLTS intervals for TCH | medium | Do after E-QC — the estimator matters less than closing the identifiability gap. |
| 5 | §6 EDF-weighted slope, then GMWM | large | Correct, and the least urgent: `classifyAllan` currently refuses rather than lying, which is the safe failure. |

---

## 10 · What NOT to do

- **Do not re-derive ρ from the three series.** §1 is a proof, not an observation. Any future
  "measure the residual correlation directly" proposal is this same identity again.
- **Do not delete the negative-variance path** to adopt a non-negative estimator (§2). It is the
  independence alarm.
- **Do not swap TCH wholesale for GCOV** on the non-negativity argument alone — Schatzman measured
  extended TCH as better at large τ (§2).
- **Do not adopt a bare one-sided statistic in `hostAxis`** (§4.3). Measured on both metrics: it wins
  on a smooth plant and loses catastrophically on a STEP, because a windowed minimum lags a full
  window at a discontinuity where a median lags half. Only the NTP-style hybrid is still standing.
- **Do not quote a width-sweep number without saying which PLANT produced it** (§4.2/§4.4). The
  original experiment is not in the repository and its ordering has not been reproduced.
- **Do not add any of §8 as a dependency.** They are comparators.
- **Do not scope a corpus from `uploads/`** (§3.1b). It is a working subset: 3 CPAP dates against the
  real corpus's 183, and that difference turned "underpowered, defer" into "runnable now".
- **Do not break the 2-fold tie with "the other member is implausible"** for `{ECG-Ppg, Oxy-CPAP}`
  (§3.1b). Ring and ResMed SA2 are both pulse oximeters; that pairing is as plausible as the one being
  argued for.
- **Do not describe E-QC as "identifies which pair is correlated"** without the complement caveat. It
  narrows 6 candidates to 2; the tie is broken by domain knowledge, which is an assumption, not a
  measurement.
- **Do not quote the 0.173 motion-proxy figure** as evidence the proxy is poor. Per §1.1 it compared
  against a non-measurement. The proxy's quality is currently **unknown**, which is a different and
  more honest statement.

---

## Done when

- [ ] §1 is cross-referenced from `integrator-tch.js` and `tools/tch-per-epoch-rho.mjs` so the identity
      is visible at both call sites, and the withdrawn recommendation cannot be re-made from the code
- [x] §4 built (`tools/hostaxis-estimator-bakeoff.mjs` — the width-21 experiment is re-runnable for the
      first time), measured, and **REJECTED** with the numbers in §4.3
- [ ] §7 blinded validation protocol written down and used once, on a real detector change
- [x] §3 power-analysed BEFORE running (§7 discipline, first use): E-QC has a structural 2-fold
      ambiguity — pair vs its complement, 51.7 % exact / 98.3 % class at N=5000,
      N-independent
- [x] §3 corpus scoped CORRECTLY on the second attempt: 28 nights with both CPAP and trio (~2436
      epochs, 93 % class accuracy). The first scoping read `uploads/` and undercounted 183 dates to 3
- [ ] §3 E-QC actually run on those 28 nights, reporting the CLASS and not the exact pair
- [ ] §5 closure tolerance re-derived under HAC with a bandwidth sensitivity table, or explicitly
      deferred with the reason
- [ ] §6 either the weighted-slope fixed point lands, or the section is downgraded to REFERENCE with a
      note that `classifyAllan`'s refusal is the accepted behaviour

Related: [`CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md`](CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md) ·
[`ALLAN-DEVIATION-2026-08-12-BRIEF.md`](ALLAN-DEVIATION-2026-08-12-BRIEF.md) ·
[`HOSTAXIS-STABILITY-2026-08-13-BRIEF.md`](HOSTAXIS-STABILITY-2026-08-13-BRIEF.md) ·
[`INTEGRATOR-THREE-CORNERED-HAT-2026-07-02-BRIEF.md`](INTEGRATOR-THREE-CORNERED-HAT-2026-07-02-BRIEF.md)
