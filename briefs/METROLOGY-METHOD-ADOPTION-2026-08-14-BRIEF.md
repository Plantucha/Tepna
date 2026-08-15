<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-14 · **Follows:** `CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md` · `CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md` · **Feeds:** `PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md` · `PAT-OFFSET-ESTIMATOR-FOLLOWUPS-2026-08-12-BRIEF.md` · `ALLAN-DEVIATION-2026-08-12-BRIEF.md`

# Adopting the metrology toolbox — which methods, where they land, and in what order

A survey of fourteen method families from frequency metrology, network time synchronisation, pulsar
timing, particle tracking and robust statistics, assessed against **what this repo already contains**,
and turned into a build order.

> **The organising idea, in one line.** A *filter* asks "which observations do I keep?" A *model* asks
> "what process could have generated all of these observations?" Every method below moves one estimator
> from the first question to the second. That is the whole thesis, and it is also why the order matters:
> a model needs a measurement whose uncertainty is known, so the uncertainty work comes first.

---

## §0 · The rule this brief exists to enforce: **census before adoption**

The single most expensive mistake available here is re-implementing something the suite already has
under a different name. The census below was run over the real source tree (`*.js`, `tools/*.mjs`,
`capture-host/*.py`, `adapters/*.js`) on 2026-08-14, with word boundaries — a first pass using
substring matching returned thousands of false hits and would have made almost every row read "absent".

| Method family | Present? | Where |
|---|---|---|
| Template / matched-filter TOA | ✅ **ECG only** | `ecgdex-morph.js:84` — median-beat template from high-SQI normal beats, normalised, cross-correlated (`:50`) |
| | ❌ **PPG** | `ppgdex-dsp.js:1249–1279` places feet by intersecting tangent, per beat, independently |
| Allan deviation | ⚠️ **ADEV only** | `capture-host/allan.py` — `adev` (overlapping), `_octave_taus`, `slope`, `slope_se`, `classify`, `stability` |
| MDEV · TDEV · HDEV · TOTDEV | ❌ | — |
| Ensemble time scale (AT1-style) | ❌ | `DexClock.hostAxis` is single-reference (host), running median width 21 |
| Kalman / state-space | ❌ | **zero occurrences in the tree** |
| Network delay / asymmetry modelling | ✅ **substantially** | `capture-host/clock_offset.py` — per-subset minima, Theil–Sen through minima, lower-envelope hull |
| Monte-Carlo propagation | ⚠️ **for power, not uncertainty** | `sensor-trio-power-analysis.js`, `sensor-trio-gpu.js`, `sensor-trio-worker.js` |
| Bootstrap CIs | ✅ | `tools/tch-bootstrap-ci.mjs` (moving block), plus 8 analysis surfaces |
| Robust regression | ✅ | Theil–Sen ×4 (`clock_offset.py`, `integrator-dsp.js`, `pat-feasibility-worker.js`, `tools/beat-comb-analysis.mjs`); RANSAC ×6 analysis tools |
| Robust scale | ✅ | MADn (`tools/cgm-variability-check.mjs`), median-absolute (`tools/trio-batch.mjs`), running median (`hostAxis`), Malik `correctRR` |
| Huber / Tukey biweight | ❌ | — |
| Track-before-detect | ✅ **MotionDex only** | `motiondex-dsp.js:824` `respViterbi` — ridge tracking, measured **MAE 1.18 vs 1.54** against greedy peak-picking |
| Change-point detection | ✅ **unnamed** | `analysis-stats.js`, `cpapdex-cross.js`, `cpapdex-render.js`, `treatment-response-analysis.js` |
| CUSUM · PELT · BOCPD by name | ❌ | — |
| Entropy / complexity | ✅ | SampEn (`pulsedex-dsp.js:338`), ApEn + SpO₂/HR entropy (`oxydex-dsp.js`), DFA α1 (several) |
| Mutual information | ❌ | — |
| SPRT | ❌ | — |
| Hidden Markov (general) | ❌ | Viterbi decoding exists only inside MotionDex's respiratory ridge tracker |
| N-cornered hat / redundancy | ✅ | `integrator-tch.js`, fused-weight hat, `tools/tch-fused-corpus.mjs` |
| **Fault isolation** | ❌ | TCH reports σ per corner; nothing says *which* corner is inconsistent with the others |

**Read this table before opening any section below.** Six of the fourteen families are already here in
some form, and two of them (Theil–Sen through minima; Viterbi ridge tracking) are the *exact* methods
being recommended, already measured and already winning.

---

## §1 · The constraint that reorders everything: most nights have only ONE clock

Four of the highest-rated proposals — ensemble time scales, Kalman clock state, TDEV as a device
characterisation, and any fault-isolation over clocks — require **two independent clocks**. Most of this
corpus does not have them.

Clock Contract §7 already states the discriminator and the measurement: a host column that the capture
app *derived from the device stamp* is the absence of a measurement wearing the shape of one, and the
residual **spread** separates the two populations bimodally — box captures 101.89 ms – 5124 ms, phone
captures **0.13 – 1.00 ms**, nothing in between. `DexClock.hostAxis` publishes `spreadMs` and
`independent`; on a phone-captured night `independent` is **false**.

**Consequence for the build order:**

- The **raw** capture tree is phone-captured throughout, so it carries no second clock at all.
- The **box** tree does, and `uploads/trio/` commits **25 post-host-axis nights** from it.
- So every clock-ensemble method below has **N = 25**, not 37+, and anything trialled on phone nights
  would be measuring a clock against a rounded copy of itself.

This is not a reason to skip the ensemble work. It is the reason it is **Phase 3** rather than Phase 1,
and the reason Phase 1 is a *statistic* (needs one clock) rather than an *estimator over clocks*.

---

## §2 · The build order

| Phase | What | Lane | Bundle cost | Blocked by |
|---|---|---|---|---|
| **1** | MDEV · TDEV · HDEV in `allan.py` | `capture-host/` | **none** | — |
| **2** | Template-TOA + track-before-detect PPG foot | `ppgdex-dsp.js` | **high** — `computeHash` moves, corpus re-verification owed | — |
| **3** | GUM / Monte-Carlo uncertainty budget for PAT | `tools/` | **none** | Phase 2 |
| **4** | Ensemble time scale; Kalman *only if it beats the median* | `clock.js` + `tools/` | high | Phases 1–3, and the 25-night box corpus |

The ordering principle is **cheap-and-certain first, and never build a model on an input whose
uncertainty is unknown.** Phases 1 and 3 add no bundle, no GATE A/B and no fixture churn; Phase 2 is a
real work-unit; Phase 4 must earn its place against an incumbent that was chosen by measurement.

---

## §3 · Phase 1 — the rest of the Allan family (`capture-host/allan.py`)

**Why first.** Cheapest, most certain, and a strict superset of what exists. `adev()` already computes
the overlapping second difference of phase; the additions reuse `_octave_taus`, `slope`, `slope_se` and
the classification machinery unchanged. It runs in the Python lane under `capture-host/check.sh` — **no
bundle, no GATE A/B, no fixture re-verification.**

**Why it matters more than "one more statistic".** ADEV answers *how stable is the oscillator*. It
cannot answer *how much timing error does this clock contribute over a 5-minute window* — and that
second question is the one a PAT uncertainty budget needs. TDEV is exactly that quantity, by definition.

### 3.1 · What each one adds, and the formulas as implemented

Overlapping estimators throughout, matching `adev`'s existing choice, on a phase (time-error) series
`x` with sample interval τ₀ and τ = m·τ₀.

**MDEV — modified Allan deviation** (Allan & Barnes 1981; Riley 2008 §5.2.2)

```
Mod σ_y²(τ) = 1 / (2 m² τ² (N − 3m + 1)) · Σ_j [ Σ_{i=j}^{j+m−1} (x[i+2m] − 2x[i+m] + x[i]) ]²
```

The inner average over m phase-differences is the whole point: it applies a software bandwidth that
scales with τ, which **separates white phase noise from flicker phase noise** — a distinction ADEV
structurally cannot make, because both give it τ⁻¹.

**TDEV — time deviation** (Allan, Weiss & Jespersen 1991; ITU-T G.810; Riley 2008 §5.2.3)

```
σ_x(τ) = (τ / √3) · Mod σ_y(τ)
```

Reported in **time units**, not fractional frequency. This is the number that drops directly into an
uncertainty budget, and the reason this phase exists.

**HDEV — Hadamard deviation** (Baugh 1971; Hutsell 1995; Riley 2008 §5.2.4)

```
H σ_y²(τ) = 1 / (6 τ² (N − 3m)) · Σ_i (x[i+3m] − 3x[i+2m] + 3x[i+m] − x[i])²
```

The **third** difference, so it is insensitive to a linear frequency drift where ADEV's second
difference is not. Directly relevant: the O2Ring's real error is non-linear and large
(−3035 ppm decaying to −1622 ppm), and ADEV on a drifting clock reports the drift rather than the noise.

### 3.2 · Three traps, each of which would ship a silently wrong number

1. **Each estimator needs its own term count — but be precise about WHICH check protects you.**
   `_octave_taus` stops where `n − 2m` falls below `_MIN_TERMS`; MDEV needs `N − 3m + 1` terms and HDEV
   `N − 3m`. So the ADEV ladder offers averaging times those two cannot support, and each estimator
   passes its own counter.

   ⚠️ **CORRECTED 2026-08-14, by the mutation gate, against this brief's own first draft.** That draft
   said reusing ADEV's count would "publish exactly the thin estimate the docstring exists to prevent".
   **It would not.** The in-loop `if terms < _MIN_TERMS: continue` runs on every tau regardless of how
   the ladder was built, so an over-generous ladder produces a longer *candidate* list and an
   **identical result list**. Measured: original vs mutant over 784 (series, estimator) pairs — every
   n in 10..399 plus 1000 and 4096, both estimators — **zero output differences**, which is why the
   diff-scoped gate reported those mutants as surviving. Passing `terms_at` is an efficiency and intent
   refinement; **the in-loop guard is the correctness guard**, and unlike `terms_at` it is killable and
   is pinned by test. Recorded in `capture-host/tools/mutate-equivalence.json` as
   `no-distinguishing-input` with the probe.

   The general lesson, which is the one this repo keeps relearning: *a guard you did not watch fail is
   not known to guard anything.* Two checks defended the same property here and only one of them was
   load-bearing; nothing but the mutation gate distinguished them.

2. **`classify()` must NOT be applied to an MDEV slope.** The canonical exponents differ, and that
   difference *is* MDEV's reason to exist:

   | noise | ADEV | MDEV |
   |---|---|---|
   | white PM | τ⁻¹ | **τ⁻³ᐟ²** |
   | flicker PM | τ⁻¹ | **τ⁻¹** |
   | white FM | τ⁻¹ᐟ² | τ⁻¹ᐟ² |
   | flicker FM | τ⁰ | τ⁰ |
   | random-walk FM | τ⁺¹ᐟ² | τ⁺¹ᐟ² |

   Feeding an MDEV curve to the ADEV table would name white PM as flicker PM every time. A separate
   table is required — and the **pair** of slopes is more informative than either alone, which is the
   capability worth publishing.

3. **Cost.** A naive MDEV inner sum is O(N·m) per tau, i.e. O(N²) over an octave ladder, on series of
   25 000 samples. The inner sum is a sliding window over the second differences and must be carried
   incrementally, O(N) per tau.

### 3.3 · TOTDEV is deliberately NOT in this phase

Total deviation (Howe 1999; Riley 2008 §5.2.5) buys confidence **at long τ**, where overlapping
estimates run out of independent spans. That benefit appears as τ approaches T/2. `_octave_taus`
already stops at `m ≤ n / (2 · _MIN_SPAN_MULTIPLE)` — i.e. **τ_max ≤ T/8** — so the regime where TOTDEV
wins is one this module declines to report in the first place. Adopting it would add a reflected-series
extension and its branch-coverage burden to buy accuracy in a range that is already refused.

Revisit if `_MIN_SPAN_MULTIPLE` is ever relaxed; until then this is a measured deferral, not a backlog item.

### 3.4 · Done when (Phase 1)

- `mdev`, `tdev`, `hdev` in `capture-host/allan.py`, each with its own term-count guard.
- A `classify_mdev` (or equivalent) with the MDEV exponent table, and a paired ADEV+MDEV
  disambiguation that names white PM vs flicker PM.
- Known-answer tests on synthetic series of **known noise type**, asserting the expected slope for each
  estimator — including one series where ADEV and MDEV **disagree**, which is the whole point.
- `capture-host/check.sh` green: ruff · shellcheck · `pytest -q --cov --cov-branch --cov-fail-under=100`.

---

### 3.5 · MEASURED ON THE WHOLE BOX CORPUS, 2026-08-14 — 27 streams, and two first-pass claims REFUTED

Everything in §3.1–§3.3 was validated against synthetics of known noise type. That proves the estimators
compute what they claim; it never proves the claim is worth computing. So they were run over **every
`*_PMDARRIVAL.csv` on the capture box** — 398 files, 73 MB, of which **27 streams carry ≥ 2000 packets**
(the Verity writes many short fragments; most files are too small to fit a curve). All **box-captured**,
which is the precondition from §1 — on a phone night the host column is the device stamp *rounded*, so
this analysis would be measuring a clock against a copy of itself.

Phase series is `host_ms − last_sensor_ns/1e6`, the construction `nightqc.py` already uses. TDEV is
quoted at the tau nearest **300 s** for every stream, so the columns are commensurable.

| device / stream | n | median ADEV slope | median MDEV slope | MDEV verdict | TDEV @ ~300 s |
|---|---|---|---|---|---|
| Polar H10 · ecg | 4 | −0.993 | **−1.421** | white-phase 3, refuse 1 | **2.07 ms** |
| Polar H10 · acc | 4 | −0.991 | **−1.416** | white-phase 3, refuse 1 | **1.92 ms** |
| Verity · ppg | 13 | −0.994 | **−1.336** | white-phase 8, refuse 5 | **3.51 ms** |
| Verity · acc | 5 | −0.997 | **−1.478** | white-phase 5 | 10.96 ms |
| Verity · ppi | 1 | −0.297 | −0.342 | white-frequency | 5028 ms ⚠️ |

#### What the corpus CONFIRMS, more strongly than one night could

- **ADEV cannot separate these links; MDEV can.** ADEV returned `white/flicker-phase` for **26 of 27**
  streams — one label for the entire corpus. MDEV resolved **19 of 27** to `white-phase` and refused 8.
  That is the whole argument for computing a second curve, and it now rests on 27 streams.
- **No drift anywhere.** Median `|HDEV slope − ADEV slope|` is **0.0005** (H10) and **0.0007** (Verity),
  max 0.033. The drift-immune estimator agrees with ADEV wherever there is no drift to be immune to —
  the clean negative result, corpus-wide, on a chrony-disciplined host.

#### 🔴 What the corpus REFUTES — both claims were mine, from a single night

1. **"The H10 sits between white and flicker phase and the classifier refuses it" — WRONG.** That came
   from one night reading −1.284 (ecg) and −1.277 (acc). Across **8 H10 streams** the median is
   **−1.421**, i.e. **white phase noise**, and the verdict is white-phase on 6 of 8. The night first
   examined sits at the extreme end of the device's range — **−1.277 is the MAXIMUM** of the eight.
2. **"Two independent H10 streams corroborate it" — that was not independent evidence.** Both streams
   came from the *same recording*, so they share that night's link conditions, its posture, its
   interference. Agreement between two streams of one night measures the *within-night* consistency of
   the estimator, not the *between-night* behaviour of the clock. Two numbers from one night is n = 1.
3. **The TDEV comparison INVERTED under a fair reading.** The first pass reported "H10 3.4 ms vs Verity
   0.85 ms", read at each stream's **longest tau** — but the longest tau differs per stream, so those
   are not the same quantity. At a **common tau ≈ 300 s** the ordering reverses: **H10 ≈ 2.0 ms, Verity
   ppg ≈ 3.5 ms, Verity acc ≈ 11 ms.** The chest strap is the *better* link, not the worse one.

The lesson is the one this repo keeps paying for, and it is worth stating plainly because the first pass
was careful and still wrong: **an existence result read off one recording is not a property of the
device**, and **two numbers that share a confound are one number**. The estimators were right both
times; the inference from three streams was not.

#### The number Phase 3 was waiting for — conclusion UNCHANGED, on better evidence

Every device's clock term sits between **~2 ms and ~11 ms** at 300 s of averaging, against a beat-to-beat
PAT error of **~68 ms**. The clock is **6–30× below the fiducial term** whichever device you take, so the
Phase 2 / Phase 4 ordering stands: **the uncertainty lives in the PPG foot, not the timebase.** An
ensemble time scale would be refining a term that is already negligible against the one Phase 2 addresses.
That conclusion survived the refutation above because it never depended on which device was better — only
on all of them being far below 68 ms, which 27 streams now show.

⚠️ **Limits.** Only 27 of 398 files clear 2000 packets, and the H10 contributes just 8 streams from a
handful of nights — enough to refute a one-night claim, not enough for a distribution. The phase series
is **arrival delay**, so it contains BLE transport as well as the oscillator: TDEV here is an **upper
bound** on the clock's own contribution, which strengthens the conclusion above rather than weakening it.
The `ppi` row is **not comparable** — it is a derived interval series rather than a packet-arrival series,
and its 5-second TDEV and white-frequency slope say so loudly; it is listed only so its exclusion is visible.

## §4 · Phase 2 — the PPG foot as a time-of-arrival estimate

**The gap, stated as the repo already measures it.** Every PAT standard deviation currently quoted here
is the width of the **450 ms physiological search window** (450/√12 = 129.90 ms), not a beat-to-beat
timing error; the honest beat-to-beat figure is ~68 ms. There is no per-foot uncertainty to separate
them, because a foot is a *sample index* rather than an estimate.

**The method.** Pulsar timing does not select a clean-looking point on a pulse; it fits an arrival time
against a template and reports it with an uncertainty (Taylor 1992; Hobbs, Edwards & Manchester 2006).
Applied here, each foot becomes `(t̂, σ_t, q)` instead of `sample 18392`.

**Both halves are already proven in this repo, separately:**

- the **template** half — `ecgdex-morph.js:84` builds a median-beat template from high-SQI normal beats
  and cross-correlates against it;
- the **tracking** half — `motiondex-dsp.js:824` `respViterbi` maximises `Σ log S[t,f] − (Δbrpm)²/2σ²`
  and beat greedy peak-picking on this data, **MAE 1.18 vs 1.54**.

So Phase 2 is not speculative transfer from another field; it is applying two locally-validated
techniques to the one node that has neither. The tracking half is the particle-physics idea — infer a
latent event *sequence* under a continuity constraint rather than detecting each beat independently
(Frühwirth 1987) — and the local Viterbi result is the evidence it works on wearable data.

**Robust weighting replaces deletion.** A low-confidence foot should contribute `w = 0.18`, not be
deleted. The suite already prefers this style (Theil–Sen, RANSAC, running medians); Huber (1964) and
Tukey's biweight are the standard weight functions if a smooth one is wanted.

⚠️ **Cost is real and must be budgeted.** This is a `ppgdex-dsp.js` change, so `manifestHash` **and**
`computeHash` both move, the export moves, and a real-corpus fixture re-verification is owed via
`tools/verify-fixtures.mjs` per §🔏. It is a work-unit, not an afternoon.

⚠️ **Known confound to design against:** six corpus nights show PPG beat alternation that inflates
rMSSD 3–6×. A template fitted across alternating beats will smear; the alternation must be detected
(the shipped detector is `rMSSD > sdnnRobust`) and handled, not averaged through.

---

## §5 · Phase 3 — a GUM uncertainty budget for PAT

**The framework.** JCGM 100:2008 (the GUM) plus **JCGM 101:2008**, its Monte-Carlo supplement, which
propagates *distributions* through the actual measurement model instead of linearising. The supplement
is the right tool precisely when the model is non-linear or the components are large — both true here.

**The model.**

```
PAT = f(t_ECG, t_PPG, clock_A, clock_B, transport, template, alignment)
```

Each component carries a distribution; the output is `PAT = 127 ms [95 %: 116–141]` **plus a variance
decomposition naming which term dominates**. That decomposition is the actual deliverable — it says
where to spend the next engineering effort, which is a question this project has repeatedly answered by
intuition.

**Where the inputs come from:** `σ_t` per foot from Phase 2; the clock term from Phase 1's **TDEV** at
the relevant averaging time; the transport term from `clock_offset.py`'s existing delay work.

**Strictly after Phase 2**, and this is a hard ordering, not a preference: with no per-foot distribution
there is nothing to propagate, and a Monte-Carlo over invented inputs is machinery that passes without
checking anything — this repo's signature failure mode.

**Lane:** `tools/`, no bundle cost. Reuse the moving-block bootstrap in `tools/tch-bootstrap-ci.mjs`
(Künsch 1989) for any resampling, since consecutive epochs share posture, perfusion and wander.

---

## §6 · Phase 4 — ensemble time scale, and Kalman only if it earns it

**The idea.** NIST's AT1 does not nominate a reference clock. It estimates each clock's behaviour,
predicts its error, weights by demonstrated stability, and de-weights a clock whose prediction error
grows (Allan 1987; Weiss, Allan & Peppler 1989; Kalman-filter time scales after Jones & Tryon 1983).
Applied here, `hostAxis` stops asking *which clock do I trust* and starts asking *what time axis best
explains all of these observations, and what uncertainty does it carry*.

**Fault isolation is the part worth having.** Aerospace redundancy does not stop at "confidence 72 %";
it isolates *which* sensor is inconsistent with the others under the current dynamics. The TCH already
produces per-corner σ — and its independence alarm fires on **41.7 % of bootstrap replicates**, which is
precisely a fault-isolation problem being reported as a scalar.

### ⚠️ Two standing objections that Phase 4 must answer before any code

1. **The incumbent was chosen by measurement, not by default.** `hostAxis` uses a running **median of
   width 21, not a fit**, because planted-jitter recovery measured 9 → 77 ms, **21 → 57**, 41 → 168,
   81 → 245 — and because the O2Ring's error is non-linear, so a line is the *wrong model*, not merely
   an imprecise one. **A Kalman filter must beat 57 ms on held-out nights before it replaces this.**
   Replacing transparent mathematics with a black box that performs the same is a regression.

2. **Identifiability.** Beat-train matching pins a clock offset only **modulo one heartbeat**, so an
   ensemble built on beat alignment is unidentifiable without an aperiodic feature. And per §1, only the
   25 box-captured nights carry a genuine second clock.

**Recommended shape:** build the *measurement model* first (Phases 1–3 produce it), then test an
ensemble against the incumbent on held-out box nights. Adopt only on a measured win.

---

## §7 · Deliberately NOT adopted, with reasons

| Method | Why not |
|---|---|
| **PTP delay/asymmetry framework** | The methodology is already here under other names — `clock_offset.py` implements per-subset minima (Paxson 1998), a Theil–Sen slope through them (Sen 1968), and a lower-envelope hull (Moon, Skelly & Towsley 1999). Relabelling it PTP adds nothing. The decomposition `D = D_fixed + D_jitter + D_asym + D_queue + D_retx` is worth writing down as documentation, not as new code. |
| **Gaussian-process correlated-noise models** | Expensive, and the covariance-structure question is already answered more cheaply by Allan (clock side) and multiscale entropy (physiological side). Revisit if Phase 3 shows the correlated term dominating. Reference if so: Coles et al. 2011; van Haasteren & Levin 2013. |
| **SPRT** | Elegant and a genuinely better shape than `quality > 0.7`, but no consumer needs it yet. Reconsider when Phase 2 produces per-beat likelihoods, at which point the ratio is nearly free (Wald 1945). |
| **General HMM state layer** | Speculative. The one instance that pays for itself (`respViterbi`) already exists; a fleet-wide latent-state layer is a large surface with no measured demand. |
| **Huber / Tukey specifically** | The robust *philosophy* is already in place via Theil–Sen, RANSAC, MADn and medians. Adopt a smooth weight function inside Phase 2 where weights are needed, not as a standalone project. |
| **Named change-point algorithms (CUSUM/PELT/BOCPD)** | Change-point logic already exists in four modules. Worth **naming and consolidating** into `analysis-stats.js` rather than adding a new algorithm; a rewrite that changes detections would owe fixture re-verification for no measured gain. |
| **TOTDEV** | See §3.3 — it improves the τ range this module already declines to report. |

---

## §8 · Cost model — why the order is what it is

Surfacing a metric in this suite costs: a `<node>-registry.js` entry with an evidence tier · a badge on
every surface it reaches (the coverage mandate) · a matching `*_DEFS` projection or `registry-defs-parity`
reds · an additive export field ⇒ MINOR bump + changeset · re-bundle ⇒ GATE A `manifestHash` **and**
`computeHash` move ⇒ fixture re-verification against the real corpus.

So the rule is: **build in `tools/` and `capture-host/` first, prove it separates something, and only
then pay to surface it.** Phases 1 and 3 sit entirely in the free zone. Phase 2 does not, which is why
it is a single deliberate work-unit rather than an increment.

**Evidence tiering:** anything derived from these methods enters at the tier its own validation
supports. MDEV/TDEV/HDEV are textbook estimators with checkable references and are `validated` as
*estimators*; any physiological claim built on them is not, and inherits the node's own tier. Never
upgrade a badge because "the literature says" — `LITERATURE-USE-POLICY-2026-07-11-BRIEF.md` §2.

---

## §9 · Done when

- [ ] **Phase 1** — MDEV · TDEV · HDEV shipped in `allan.py` with per-estimator term guards, an MDEV
      noise table, ADEV↔MDEV disambiguation, known-answer tests including one ADEV/MDEV disagreement,
      and `capture-host/check.sh` green at 100 % branch coverage.
- [ ] **Phase 2** — PPG feet published as `(t̂, σ_t, q)`; template built from high-SQI beats; continuity
      constraint across beats; alternation nights handled explicitly; corpus re-verification complete.
- [ ] **Phase 3** — a PAT uncertainty budget with a variance decomposition, in `tools/`, driven by
      Phase 2's σ_t and Phase 1's TDEV.
- [ ] **Phase 4** — an ensemble estimator evaluated against `hostAxis`'s measured 57 ms on held-out box
      nights, adopted only on a win, with fault isolation reported per corner.

---

## §10 · References

⚠️ **Verification note.** Author/year/venue below are given as the adoption record. This brief is
outside the `citation-ledger` gate by design (briefs quote attributions in order to dispute them). **Any
DOI that later migrates to a reader-facing surface — a reference guide, `papers/**`, `docs/**.md`, or a
root `*.js` — must first be added to `audits/CITATION-VERIFICATION-*.json` with `firstAuthor`/`year`/
`container`,** and the surrounding text must name that author and a year within ±1, or the gate reds.

**Frequency metrology**
- Allan, D. W. (1966). Statistics of atomic frequency standards. *Proc. IEEE* 54(2), 221–230.
- Allan, D. W., & Barnes, J. A. (1981). A modified "Allan variance" with increased oscillator characterization ability. *Proc. 35th Annual Frequency Control Symposium*, 470–475. — **MDEV**
- Allan, D. W., Weiss, M. A., & Jespersen, J. L. (1991). A frequency-domain view of time-domain characterization of clocks and time and frequency distribution systems. *Proc. 45th Annual Frequency Control Symposium*. — **TDEV**
- ITU-T Recommendation G.810 (1996). Definitions and terminology for synchronization networks. — TDEV in telecom use
- Baugh, R. A. (1971). Frequency modulation analysis with the Hadamard variance. *Proc. 25th Annual Frequency Control Symposium*. — **HDEV**
- Hutsell, S. T. (1995). Relating the Hadamard variance to MCS Kalman filter clock estimation. *Proc. PTTI*.
- Howe, D. A. (1999). Total variance explained. *Proc. 13th EFTF / IEEE IFCS*. — **TOTDEV**
- Riley, W. J. (2008). *Handbook of Frequency Stability Analysis*. NIST Special Publication 1065. — the canonical reference for all of the above, and already cited in `CLAUDE.md` §7
- Allan, D. W. (1987). Time and frequency (time-domain) characterization, estimation, and prediction of precision clocks and oscillators. *IEEE Trans. UFFC* 34(6), 647–654.
- Weiss, M. A., Allan, D. W., & Peppler, T. K. (1989). A study of the NBS time scale algorithm. *IEEE Trans. Instrum. Meas.* 38(2), 631–635. — **AT1 ensemble**
- Jones, R. H., & Tryon, P. V. (1983). Estimating time from atomic clocks. *J. Res. NBS* 88(1), 17–24. — **Kalman time scale**
- Kalman, R. E. (1960). A new approach to linear filtering and prediction problems. *Trans. ASME J. Basic Eng.* 82, 35–45.

**N-cornered hat / collocation**
- Gray, J. E., & Allan, D. W. (1974). A method for estimating the frequency stability of an individual oscillator. *Proc. 28th Annual Frequency Control Symposium*.
- Premoli, A., & Tavella, P. (1993). A revisited three-cornered hat method for estimating frequency standard instability. *IEEE Trans. Instrum. Meas.* 42(1), 7–13.
- Ekstrom, C. R., & Koppang, P. A. (2006). Error bars for three-cornered hats. *IEEE Trans. UFFC* 53(9), 1971–1977.
- Stoffelen, A. (1998). Toward the true near-surface wind speed: error modeling and calibration using triple collocation. *J. Geophys. Res.* 103(C4), 7755–7766.
- McColl, K. A., et al. (2014). Extended triple collocation. *Geophys. Res. Lett.* 41(17), 6229–6236.

**Network time synchronisation**
- Mills, D. L. (1991). Internet time synchronization: the Network Time Protocol. *IEEE Trans. Comm.* 39(10), 1482–1493.
- Paxson, V. (1998). On calibrating measurements of packet transit times. *ACM SIGMETRICS*.
- Moon, S. B., Skelly, P., & Towsley, D. (1999). Estimation and removal of clock skew from network delay measurements. *IEEE INFOCOM*.
- IEEE Std 1588-2019. Precision Clock Synchronization Protocol for Networked Measurement and Control Systems.

**Uncertainty**
- JCGM 100:2008. *Evaluation of measurement data — Guide to the expression of uncertainty in measurement (GUM)*.
- JCGM 101:2008. *Supplement 1 to the GUM — Propagation of distributions using a Monte Carlo method*.

**Pulsar timing / correlated noise**
- Taylor, J. H. (1992). Pulsar timing and relativistic gravity. *Phil. Trans. R. Soc. A* 341, 117–134.
- Hobbs, G. B., Edwards, R. T., & Manchester, R. N. (2006). TEMPO2, a new pulsar-timing package. *MNRAS* 369(2), 655–672.
- Coles, W., Hobbs, G., Champion, D. J., Manchester, R. N., & Verbiest, J. P. W. (2011). Pulsar timing analysis in the presence of correlated noise. *MNRAS* 418(1), 561–570.
- van Haasteren, R., & Levin, Y. (2013). Understanding and analysing time-correlated stochastic signals in pulsar timing. *MNRAS* 428(2), 1147–1159.

**Robust statistics and estimation**
- Huber, P. J. (1964). Robust estimation of a location parameter. *Ann. Math. Statist.* 35(1), 73–101.
- Sen, P. K. (1968). Estimates of the regression coefficient based on Kendall's tau. *JASA* 63(324), 1379–1389.
- Fischler, M. A., & Bolles, R. C. (1981). Random sample consensus. *Comm. ACM* 24(6), 381–395.
- Künsch, H. R. (1989). The jackknife and the bootstrap for general stationary observations. *Ann. Statist.* 17(3), 1217–1241.
- Newey, W. K., & West, K. D. (1987). A simple, positive semi-definite, heteroskedasticity and autocorrelation consistent covariance matrix. *Econometrica* 55(3), 703–708.

**Detection, tracking and change points**
- Viterbi, A. J. (1967). Error bounds for convolutional codes and an asymptotically optimum decoding algorithm. *IEEE Trans. Inf. Theory* 13(2), 260–269.
- Frühwirth, R. (1987). Application of Kalman filtering to track and vertex fitting. *Nucl. Instrum. Methods A* 262(2–3), 444–450.
- Wald, A. (1945). Sequential tests of statistical hypotheses. *Ann. Math. Statist.* 16(2), 117–186.
- Page, E. S. (1954). Continuous inspection schemes. *Biometrika* 41(1/2), 100–115.
- Killick, R., Fearnhead, P., & Eckley, I. A. (2012). Optimal detection of changepoints with a linear computational cost. *JASA* 107(500), 1590–1598.
- Adams, R. P., & MacKay, D. J. C. (2007). Bayesian online changepoint detection. arXiv:0710.3742.

**Complexity / information**
- Richman, J. S., & Moorman, J. R. (2000). Physiological time-series analysis using approximate entropy and sample entropy. *Am. J. Physiol.* 278, H2039–H2049.
- Costa, M., Goldberger, A. L., & Peng, C.-K. (2002). Multiscale entropy analysis of complex physiologic time series. *Phys. Rev. Lett.* 89, 068102.
- Costa, M., Goldberger, A. L., & Peng, C.-K. (2005). Multiscale entropy analysis of biological signals. *Phys. Rev. E* 71, 021906.
- Peng, C.-K., et al. (1995). Quantification of scaling exponents and crossover phenomena in nonstationary heartbeat time series. *Chaos* 5(1), 82–87.
