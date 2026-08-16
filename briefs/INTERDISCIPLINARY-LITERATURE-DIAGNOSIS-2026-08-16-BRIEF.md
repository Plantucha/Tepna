<!--
  INTERDISCIPLINARY-LITERATURE-DIAGNOSIS-2026-08-16-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE · **Created:** 2026-08-16 · **last-verified:** 2026-08-16

# Interdisciplinary literature diagnosis — established methods around Tepna

> **📎 PROVENANCE — this brief was ADOPTED, not authored here.** It was found **untracked** in the
> shared checkout on 2026-08-16 (16,721 bytes, in no commit on any branch, so that path was the only
> copy), and committed at the owner's direction. **The author is unknown and the analysis is theirs.**
> It is committed as written except for two clearly-marked adopter's notes — §2.1, where half the
> recommended action was already closed against by measurement, and §6, where a claim was verified
> rather than passed on unchecked.
>
> It was also **reddening `docs-ledger` for every session** while it sat untracked
> (`check3 · every briefs/*.md appears in DOCS-INDEX.md — unindexed (1)`), which is a second reason
> committing it beat leaving it in place. If it is yours, say so and the authorship line is yours.

> **What this is.** A cross-field diagnosis of the methods actually present in
> Tepna's source, tests, briefs, audits, and papers. Its purpose is not to find
> wearable-physiology papers that share vocabulary. It asks whether the mathematics
> or validation practice corresponds to an established method from another field;
> whether Tepna has independently rebuilt it, implemented only part of it, omitted a
> directly applicable part, or applied it unusually.

> **Relation to existing work.** `CROSS-DOMAIN-METHODS-2026-08-12-BRIEF.md` is an
> earlier, implementation-oriented sweep with concrete adopted/rejected methods.
> This brief is broader and names the common framework: timing metrology,
> identifiability, signal processing, fusion, and validation methodology. It does
> not supersede measured findings in their owning briefs.

## 0 · Classification and evidence rule

Use one of these labels only after establishing a mathematical or methodological
correspondence:

- **[REINVENTED]** — Tepna independently implements the core of an established
  method, often under local terminology.
- **[APPROXIMATION]** — the same problem is being addressed but a material
  assumption, uncertainty model, calibration, or theorem is missing.
- **[ALREADY CORRECT]** — Tepna's implementation is substantially the established
  method for its stated purpose.
- **[MISSING]** — an established technique is directly applicable and absent.
- **[UNUSUAL APPLICATION]** — established method, unusual Tepna application.
- **[POSSIBLE NOVELTY]** — a potentially new combination; not a priority claim and
  requires external verification.

Each diagnosis must state: the exact code/function, external discipline and method,
what Tepna does, what the established method requires, material benefit, two or
more primary/authoritative references where available, and confidence. A shared
name alone is never enough.

Separate **observed code** from **documented claims**, **inference**, and **not
established**. In particular, a paper's retrospective explanation is not proof that
the currently shipped code has the property it describes.

## 1 · Directly observed system seams

| concern | observed implementation surface |
|---|---|
| device/host time | `clock.js` `hostAxis`; `capture-host/host_clock.py`; `capture-host/allan.py`; capture-host monotonic host timestamps |
| timing metadata | `independent`, `deviceDrawn`, `timingSource`, ppm/spread/stability fields and correction functions |
| cross-device timing | `integrator-dsp.js` offset/drift/closure/pooling paths; `integrator-tch.js` three-cornered hat |
| ECG/PPG | `ecgdex-dsp.js` Pan–Tompkins-like QRS path, redundant detection/SQI, Lomb/PRSA/DFA; `ppgdex-dsp.js` channel detection/consensus, feet/PPI, Lomb/DFA |
| motion | `motiondex-dsp.js` median-delta sample-rate inference and Viterbi-like respiratory-ridge tracking that treats uncovered windows as uninformative |
| pairing/fusion | `pat-align.js`, `pat-gate.js`, `event-coupling.js`, `integrator-dsp.js` confidence composition and quality/authority checks |
| validation | seeded `synth-gen.js`; known-answer and mutation-labelled tests; `tools/mutate.mjs`; deterministic provenance/manifest gates; no-network canary |
| scientific correction | `papers/wearable-clock-drift.html`, `papers/effort-typing-null.html`, `papers/dead-ends.html` |

Two timing facts are especially consequential. `hostAxis` may call an axis
`independent` while it is still synthesized from device timing; consumers must also
consider `deviceDrawn` and `timingSource`. And a host time suitable for absolute
labeling is not necessarily sufficiently disciplined to serve as the rate reference:
the capture-host policy distinguishes those conditions.

## 2 · Time, clock, and metrology

### 2.1 [ALREADY CORRECT] Allan-deviation stability analysis

**Tepna:** `clock.js` and `capture-host/allan.py` compute overlapping
Allan-deviation-style stability over averaging scales rather than one drift number.

**Correspondence:** frequency metrology uses Allan variance/deviation because normal
sample deviation is unsuitable for common oscillator noise processes. The
correspondence is direct, including use of slope as a noise-type diagnostic.

**Action:** retain it. Improve only with confidence/equivalent-degrees-of-freedom
reporting and a documented check that the input is a valid phase/time-error series.

> ⚠️ **ADOPTER'S NOTE 2026-08-16 — the EDF half of that action is already CLOSED, and closed
> AGAINST.** `CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14` §6 measured the weighted-OLS/EDF route and
> **rejected** it: the correction is *"real and immaterial"* — it moves an answer only for a curve
> near a boundary, which is exactly where `classifyAllan` already returns `noise: null`, so the two
> mechanisms cover the same case and the refusal is cheaper and more honest.
> `HOSTAXIS-STABILITY-FOLLOWUPS-2026-08-15` §3 then decided (2026-08-16) that **the 1.96·SE band
> stays**, and records the burden any future proposal carries. The EDF circularity that motivated this
> item is moot when the fix it would enable moves nothing.
>
> The **other half is not closed and is a good idea**: a documented check that the input really is a
> phase/time-error series. `clock.js` already publishes `timingSource` and `deviceDrawn` precisely
> because a drawn axis is not a clock — asserting that at the `stability()` boundary is the live part
> of this recommendation.

**References:** D. Allan, 1966, DOI `10.1109/PROC.1966.4634`; NIST SP 1065,
*Handbook of Frequency Stability Analysis*.

**Confidence:** HIGH.

### 2.2 [APPROXIMATION] Host-axis clock discipline

**Tepna:** `hostAxis` derives a residual host-minus-device correction from anchors,
smooths it, estimates ppm and spread, and guards some untrustworthy axes. BLE arrival
time is therefore treated as qualified evidence, not automatically as sample time.

**Correspondence:** NTP/PTP-style clock estimation separates offset, fractional
frequency, path delay, and delay asymmetry. A one-way BLE arrival timestamp generally
cannot identify device event time, device offset, and transport delay separately
without a delay model, two-way exchange, or independent reference.

**Action:** formalize the observation model and attach uncertainty to each anchor and
event. Do **not** replace this with “use PTP”: PTP needs an appropriate timing
exchange/hardware-timestamp architecture and is not a cure for BLE arrival jitter.

**References:** RFC 5905 (NTP); IEEE 1588-2019 (PTP); NIST SP 1065.

**Confidence:** HIGH.

### 2.3 [MISSING] Measurement-uncertainty propagation

**Tepna:** timing quality appears as gates, ppm, spread, and stability summaries;
PAT/coupling confidence does not appear to receive a full propagated event-time
uncertainty distribution.

**Correspondence:** the GUM measurement model requires identifying inputs and their
uncertainties (oscillator, anchor ambiguity, packet delay, fiducial/interpolation,
model selection), then propagating them to the measurand. NIST guidance also requires
residual/model sensitivity checks.

**Action:** add per-event timing uncertainty and correlation handling before making
new cross-device timing claims. This is material; a binary “trusted” flag cannot
distinguish a 1-ms result from a 50-ms result.

**References:** JCGM 100:2008 (GUM), DOI `10.59161/JCGM100-2008E`; NIST TN 1900,
DOI `10.6028/NIST.TN.1900`; JCGM 101 Monte-Carlo supplement.

**Confidence:** HIGH.

### 2.4 [REINVENTED] / [UNUSUAL APPLICATION] Three-cornered hat

**Tepna:** `integrator-tch.js` and `analysis-stats.js` perform three-source relative
stability decomposition.

**Correspondence:** the three-cornered hat estimates individual oscillator variance
from pairwise differences. The normal derivation assumes independence; correlated
sources require a covariance-aware extension.

**Action:** retain the approach but report correlation sensitivity/confidence bounds
and state that it estimates relative stability, not truth. Applying it to wearable
timing and physiological streams is unusual and useful if those assumptions are
enforced.

**References:** Gray & Allan, 1974, DOI `10.1109/FREQ.1974.200027`; Premoli &
Tavella, 1993, DOI `10.1109/19.206671`; NIST SP 1065.

**Confidence:** HIGH.

### 2.5 [MISSING] Joint clock-network estimation

**Tepna:** Integrator has pairwise offsets, pooled fits, and closure checks.

**Correspondence:** distributed-measurement systems estimate all clock offsets/skews
and anchor constraints jointly with weighted least squares/state estimation and a
covariance model.

**Action:** investigate only on a graph of demonstrably independent timing edges;
otherwise optimization converts unidentifiable assumptions into confident numbers.

**References:** RFC 5905; IEEE 1588-2019; GUM.

**Confidence:** MEDIUM-HIGH.

## 3 · Signal processing and event construction

### 3.1 [ALREADY CORRECT] QRS detection, redundant evidence, and SQI

`ecgdex-dsp.js` implements the familiar bandpass/derivative/square/integrate QRS
chain and cross-checks detector agreement, plausibility, morphology/amplitude, and
RR. This is a Pan–Tompkins-family detector plus signal-quality reasoning, not a new
method under a new name. `ppgdex-dsp.js` likewise uses multichannel evidence rather
than trusting one optical channel.

**Action:** calibration against labeled artifact strata is more valuable than
replacing the base detector.

**References:** Pan & Tompkins, 1985, DOI `10.1109/TBME.1985.325532`; Charlton et
al., 2021 PPG review, DOI `10.1109/RBME.2021.3121476`; PPG SQI review, DOI
`10.3390/app12199582`.

**Confidence:** HIGH.

### 3.2 [ALREADY CORRECT] Uneven-sampling spectral estimation

The Dex paths use Lomb–Scargle directly on irregular beat intervals rather than
interpolating them to an FFT grid. That is the established astronomical solution for
unevenly sampled scalar observations.

**Action:** preserve the direct method. If a spectral peak becomes a published
significance claim, calibrate it against colored/nonstationary nulls and the actual
windowing; Lomb–Scargle does not make those issues disappear.

**References:** Scargle, 1982, DOI `10.1086/160554`; VanderPlas, 2018, DOI
`10.3847/1538-4365/AAB766`; Baluev, 2011, DOI `10.1051/0004-6361/201014079`.

**Confidence:** HIGH.

### 3.3 [APPROXIMATION] Viterbi ridge tracking

`motiondex-dsp.js` has Viterbi-like temporal tracking of respiratory spectral
ridges. Crucially, uncovered windows receive neutral likelihood rather than a
spectrum manufactured by interpolation. That missing-data behavior is sound.

The emission/transition scores appear heuristic rather than a calibrated hidden
Markov model. A full HMM is not automatically better: it can create false certainty
without representative labels.

**References:** Rabiner, 1989, DOI `10.1109/5.18626`; Rubin, 1976, DOI
`10.1093/biomet/63.3.581`; NIST TN 1900.

**Confidence:** HIGH.

### 3.4 [MISSING, conditional] Ambiguous ECG–PPG correspondence

`pat-align.js` and `pat-gate.js` constrain ECG R-to-PPG-foot matches. Their present
refusal behavior is preferable to forcing a result from a non-independent clock.

Once timing is independently validated, constrained data association or tightly
bounded dynamic time warping can quantify association ambiguity. Neither should be
used to make weak clock evidence look physiological.

**References:** Bar-Shalom & Tse, 1975, DOI `10.1016/0005-1098(75)90021-7`;
Sakoe & Chiba, 1978, DOI `10.1109/TASSP.1978.1163055`; PAT/PTT review, DOI
`10.1007/s13534-019-00096-x`.

**Confidence:** HIGH.

## 4 · Identifiability and fusion

### 4.1 [MISSING] Explicit observability/identifiability protocol

The documents correctly withdraw causal and timing claims when controls fail, but
there is no universal pre-analysis procedure that asks whether the stated data can
uniquely distinguish the target mechanism from alternatives.

For every new cross-sensor claim, write candidate mechanisms, observations,
independent timing edges, nuisance parameters, and discriminating interventions or
known-answer simulations before estimating effects. This is observability/practical
identifiability, not merely “more statistics.”

**References:** Villaverde, 2019, DOI `10.1155/2019/8497093`; Cobelli & DiStefano,
1980, DOI `10.1152/ajpregu.1980.239.1.R7`; Wieland et al., 2021, DOI
`10.1016/j.coisb.2021.03.005`.

**Confidence:** HIGH.

### 4.2 [APPROXIMATION] Confidence fusion under unknown dependence

Integrator’s confidence composition resembles noisy-OR, while code and documents
recognize separate signal authority and quality. Shared motion, timebases, or
preprocessing can make evidence correlated; independent-evidence fusion then becomes
overconfident.

Covariance intersection is a standard conservative option when cross-correlation is
unknown, but it requires covariance-bearing estimates and is not a direct replacement
for categorical event labels.

**References:** Julier & Uhlmann, 1997, DOI `10.1109/ACC.1997.609105`; Julier &
Uhlmann, 2006, DOI `10.1016/j.robot.2006.06.011`; GUM.

**Confidence:** MEDIUM-HIGH.

## 5 · Validation methodology

### 5.1 [ALREADY CORRECT] Executable validation substrate

The seeded synthetic corpus, known-answer injections, mutation-pinned tests,
metamorphic checks, mutation canary, provenance gates, and no-network canary match
established practice in simulation validation, mutation testing, metamorphic testing,
and reproducible builds. The strongest property is that some controls test the
validator itself, not only the product.

**Action:** retain this architecture. Its incompleteness is claim-level closure: do
not assume every paper result is universally regenerated from a pinned private corpus
and pre-specified analysis merely because code provenance is deterministic.

**References:** Reproducible Builds project documentation; Chen et al., 2018, DOI
`10.1109/TSE.2016.2532875`; NIST TN 1900.

**Confidence:** HIGH.

### 5.2 [UNUSUAL APPLICATION] Missingness as “no measurement”

The motion/ragged-coverage paths avoid treating interpolated values as observed and
allow null/uncovered states to remain uninformative. This corresponds to explicit
missing-data likelihood/censoring treatment. It is an unusually appropriate
application in wearable fusion, where dropout itself is often correlated with motion
and signal quality.

**Action:** retain the distinction. Do not claim missing-at-random without studying
the capture mechanism.

**References:** Rubin, 1976, DOI `10.1093/biomet/63.3.581`; GUM; NIST TN 1900.

**Confidence:** MEDIUM-HIGH.

## 6 · Documented claim discipline

The papers show the desired direction of travel: `wearable-clock-drift.html` records
retracted explanations and the limits of a single-phone clock; `effort-typing-null.html`
keeps an insufficient classifier withdrawn; `dead-ends.html` states that a negative
result requires a known-answer sensitivity control. These are documented claims,
not independent validation of every physical mechanism they discuss.

One known documentation inconsistency requires resolution before citing
`dead-ends.html` as a settled PAT mechanism: its corrected abstract says the claimed
approximately 96-ms peripheral scatter was an acceptance-window/rate artifact and
the cause remains open, while a later §2.7 passage still presents that scatter as the
actual fundamental limit. Cite the correction record, not the stale mechanistic
sentence, until reconciled.

> ✅ **VERIFIED ON ADOPTION, 2026-08-16 — this is real, and here are both halves.** The abstract
> (`papers/dead-ends.html`, result 7) reads: *"corrected 2026-08-13 — the ~96 ms of 'peripheral
> beat-to-beat scatter' that v2 named as the real limit is **itself an artifact**: it is the standard
> deviation of a fixed 450 ms acceptance window (450/√12 = 129.90 ms) … The wall's cause is now
> **open**, not settled."* The body still opens with *"**What actually limits it:** ~**96 ms** of
> beat-to-beat scatter in the peripheral pulse-foot time, against a 60 ms requirement"* and shifts the
> disposition to *"needs better peripheral foot timing"* **on that basis**.
>
> So a reader meets the stale mechanism in the section that states the finding, and the retraction only
> in the abstract — the same ordering hazard as a stale `PROPOSED` header. Corroborated independently:
> every PAT SD in this corpus measures that 450 ms window, and the honest beat-to-beat figure is ~68 ms.
>
> **Deliberately NOT fixed here.** `papers/` has a served `docs/` twin, so editing the paper stales
> `build-docs` and owes a rebuild — a separate work-unit, not a footnote to adopting this brief. The
> brief's own instruction (cite the correction record, not the stale sentence) is the correct interim.

## 7 · Immediate priorities

1. Build a GUM-style timing-to-event uncertainty budget and propagate it.
2. Specify offset/skew/delay observation assumptions for every `hostAxis` anchor.
3. Require an identifiability table and planted discriminator before new PAT/coupling
   claims.
4. Add covariance/correlation sensitivity to TCH and fusion results.
5. Use joint clock calibration only where independent clock edges exist.
6. Keep Lomb–Scargle direct-on-irregular data; add proper null calibration only for
   inferential claims.
7. Treat association methods as quantifiers of ambiguity, never as a means to force
   a coupling result.
8. Make the paper/brief correction chain mechanically visible where possible.

## 8 · What this diagnosis cannot establish

- That PPS is physically connected, hardware-timestamped, and continuously monitored
  on a deployed capture host; code policy is not deployment evidence.
- That all private-corpus paper figures are reproducible by an outside clone.
- That synthetic BLE delay/oscillator/fiducial models span every supported device.
- That any combination described here is novel in the publication-priority sense.

## References

- Allan, D. W. (1966). *Statistics of atomic frequency standards.* DOI
  `10.1109/PROC.1966.4634`.
- NIST SP 1065. *Handbook of Frequency Stability Analysis.*
- RFC 5905. *Network Time Protocol Version 4.*
- IEEE 1588-2019. *Precision Clock Synchronization Protocol.*
- JCGM 100:2008. *Guide to the Expression of Uncertainty in Measurement.* DOI
  `10.59161/JCGM100-2008E`.
- Possolo, A. (2015). NIST TN 1900. DOI `10.6028/NIST.TN.1900`.
- Pan, J. & Tompkins, W. (1985). DOI `10.1109/TBME.1985.325532`.
- Scargle, J. (1982). DOI `10.1086/160554`.
- Rabiner, L. (1989). DOI `10.1109/5.18626`.
- Villaverde, A. (2019). DOI `10.1155/2019/8497093`.
- Julier, S. & Uhlmann, J. (1997). DOI `10.1109/ACC.1997.609105`.

<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
