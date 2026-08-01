<!--
  WEARABLE-SYNC-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-31 · **Created:** 2026-07-31 · **Found while executing:** `POOLED-CLOCK-FIT-FOLLOWUPS-2026-07-31-BRIEF.md` · **Affects:** `integrator-dsp.js`, `tools/wearable-sync.mjs`, every cross-device timing claim the suite makes

# Nothing ever compared the wearables to each other, and they do not agree

Every clock estimator in this suite measures a wearable against the CPAP. **None of them
compared the wearables with each other**, and all of them assumed the wearables shared a
timeline. The assumption was never tested because no code made the comparison.

It is false. Measured from the raw accelerometers:

| capture path | nights | H10 ↔ Verity offset |
|---|---|---|
| phone (Polar Sensor Logger), 06-10 → 07-13 | 24 | **1.8 – 4.9 s, median 3.3 s — not one inside 1 s** |
| vigil box, 07-25 → 07-30 | 6 | **0.10 – 0.39 s, median 0.27 s** |

> **PRECISION FIX 2026-08-01.** This brief says "the H10 and Verity are ~3.3 s apart", which is true of
> the timeline the whole suite consumes but implies **device clocks**. It is not that. The measurement
> is taken on the `Phone timestamp` column — the HOST's receive stamp — while the devices' own
> `sensor timestamp [ns]` values live in **different device-local epochs** (599628… vs 834455…) and
> yield only per-device *rate*, never a shared origin. The phone stamp is the ONLY cross-device
> timeline that exists, which is why the offset matters and also why it cannot be side-stepped by
> "just use the sensor stamps". The mechanism is **host-stamping**, not quartz divergence — consistent
> with `papers/wearable-clock-drift.html` v2, which measured inter-device rate at ~1.5 ppm and
> correctly refuted a drift explanation for a different (beat-level) failure.

A **systematic** bias on one capture path, eliminated by the box. Systematic is better news than
random — it is correctable retroactively — but it means every cross-device timing result computed on
a phone-captured night carries an unbudgeted ~3.3 s error, including the latency ladder, the
`desat ≈ +105 s` figure, and the ±45 s "resolution" the pooled fit publishes.

---

## 1 · Why it was invisible

The suite had exactly one way to compare two wearables: the `movement_onset` **event** channel, ~30
events per night. Run that way it resolved only **8 of 31 nights**, and on those it reported +13 s and
+15 s for 2026-06-16 and 06-19 — figures this brief supersedes, because the event estimator was
inflating them. The raw accelerometers put the same nights at 2.6 s and 3.2 s using ~7 h of continuous
50 Hz data instead of thirty timestamps.

Two accelerometers strapped to one body see the same turn at the same instant — physics, with no
physiology in between. That makes ACC-vs-ACC the only contrast that can check every night rather than
a quarter of them.

## 2 · Method, and whose it is

Windowed normalized cross-correlation of accelerometer **norms**, with lag regressed against time so
that a constant offset and a clock **drift** come out of the same fit. This is published practice, not
a local invention:

- **Straczkiewicz M, Huang EJ, Onnela J-P (2021)** "Temporal Alignment of Dual Monitor Accelerometry
  Recordings." *Sensors* 21(14):4777. [doi:10.3390/s21144777](https://doi.org/10.3390/s21144777) —
  windowed cross-correlation of ACC norms; offset and drift modelled as linear in time.
- **"BMAR: Barometric and Motion-based Alignment and Refinement for Offline Signal Synchronization
  across Devices" (2025)**, [arXiv:2501.16015](https://arxiv.org/abs/2501.16015) — coarse pre-align
  then refine by correlating ACC in patches, explicitly for robustness to short-term misalignment.
- **Bent B et al. (2022)** "Time Synchronization of Multimodal Physiological Signals through Alignment
  of Common Signal Types." *J. Imaging* 8(5):120.
  [doi:10.3390/jimaging8050120](https://doi.org/10.3390/jimaging8050120) — align on a signal type both
  devices share, agnostic to which.
- **Knapp CH, Carter GC (1976)** "The Generalized Correlation Method for Estimation of Time Delay."
  *IEEE Trans. ASSP* 24(4):320-327.
  [doi:10.1109/TASSP.1976.1162830](https://doi.org/10.1109/TASSP.1976.1162830) — the reference
  treatment of correlation-based TDOA. **PHAT weighting is the documented next refinement here**; it
  whitens the cross-spectrum so peak sharpness stops depending on the signals' spectral colouring.
- **Theil H (1950)**; **Sen PK (1968)** *JASA* 63(324):1379-1389.
  [doi:10.1080/01621459.1968.10480934](https://doi.org/10.1080/01621459.1968.10480934) — the robust
  line fit used for the drift term.
- **Louis S, Borgelt C, Grün S (2010)** *Front. Comput. Neurosci.* 4:127.
  [doi:10.3389/fncom.2010.00127](https://doi.org/10.3389/fncom.2010.00127) — surrogate practice for the
  per-window null.

**Why windowed rather than one correlation per night:** one number cannot separate a constant offset
from a drifting one, and a single restless hour dominates it. Regressing lag against time yields both
terms plus the residual scatter as an honest quality measure. It also reaches the term this corpus
could never measure before — regressing the CPAP offset across 48 days gave −12.8 ± 6.3 ppm, marginal
at 2σ, because per-night precision (~50 s) was worse than the entire 48-day drift (~53 s). Measured
*within* a night, drift no longer has to fight that noise.

## 3 · Three wrong versions, and why the third is right

The confidence rule took three attempts. Recording them because each failure is a different way to
fool yourself with the same data.

**(a) Count of surviving windows — failed.** Each window's null admits ~1/(nullIters+1) of chance
windows, so across 143 windows about 7 survive by luck. The first version called **two unrelated
nights `confident`** on exactly that basis (4 usable of 47). A count is a multiple-comparisons trap.

**(b) Fraction of usable windows — failed on real data.** Requiring ≥25 % usable rejected **all six
box nights**, which agreed to within 0.2 s. Most of a sleeping night contains no movement at all, so
the fraction measures *how restless the subject was*, not whether the clocks agree. This is the
failure mode that only appears when a synthetic-tuned threshold meets a real night.

**(c) Concentration — correct.** A chance lag is ~uniform across the ±maxLag search, so the
probability it lands within ±tol of any particular value is `tol/maxLag`; *k* of *n* agreeing that
closely has an **exact binomial tail**. Real nights: 8 of 8 within 0.1 s over a ±30 s search,
p ≈ 4×10⁻¹⁸. Chance: scattered. This is the same concentration argument the pooled clock fit makes at
corpus level, applied within a night.

One subtlety is handled explicitly: the median is *taken from* the usable windows, so one window is
within tolerance **by construction**. The test runs on the remaining n−1 rather than scoring a
tautology.

## 4 · What shipped

- **`IntegratorDSP.activityEnvelope(x, y, z, dtSec)`** — gravity-removed activity envelope.
  First-differencing is the high-pass: it removes the 1 g vector *and* posture, so rolling onto one
  side cannot register as correlated motion. `log1p` stops one violent turn from owning the night.
- **`IntegratorDSP.alignEnvelopes(a, b, fsHz, opts)`** — `{offsetSec, driftPpm, nUsable, nWindows,
  nConcentrated, concP, madSec, medR, rmsResidSec, confident, underpowered, pFloor, reason, windows}`.
- **`tools/wearable-sync.mjs`** — runs it over a capture tree, per night, with `--json` for per-window
  detail. Not wired into `trio-batch`: the dispatching parent is deliberately a few-MB coordinator, and
  loading 70 MB accelerometer files there would break that.
- **Gate `integrator-dsp · acc-align`, 13 assertions** — planted offset both signs, **planted 400 ppm
  drift recovered to 417**, drift-free pair reports ~0 ppm, null control, concentration control,
  posture rejection, underpowered guard, determinism, and a refusal when the window is shorter than
  the search range.

Also fixed here, found while prototyping: **an NCC that could return r > 1**. Normalising over a whole
array and then correlating a subset is not a correlation; the prototype produced 1.044 and a
similarity score that can exceed 1 cannot be compared against a threshold or a null. `_ncc` now
normalises over exactly the samples it compares.

## 5 · What this obliges

- **Every cross-device timing result on a phone-captured night carries ~3.3 s.** The latency ladder,
  the transit-time work, and the bimodal `autonomic_surge ↔ movement_onset` finding all need
  re-checking against measured per-night offsets rather than an assumption. *(The bimodality itself
  survives — on the six box nights, where the offset is ~0.2 s, both modes still appear.)*
- **No device is a reference.** The estimator must solve every device's offset per night. This brief
  supplies the wearable-to-wearable leg; the CPAP leg still has no bridge, and the O2Ring has none at
  all.
- **The 3.3 s → 0.2 s step is a free validation fixture.** Same subject, same devices, two pipelines,
  a known change point. Any alignment method that cannot recover that step, or that reports one where
  there isn't one, is broken.

## 6 · Done when

- [x] `activityEnvelope` + `alignEnvelopes` exported and gated with planted-offset **and** planted-drift
      recovery, plus a null control (the pair, or neither).
- [x] The confidence rule is a test, not a threshold, and its two failed predecessors are recorded (§3).
- [x] `tools/wearable-sync.mjs` runs the corpus and reports per night with a reason when it cannot.
- [x] Methods cited in code and here, per the literature-use policy.
- [ ] The corpus is re-run with measured per-night wearable offsets APPLIED, and the downstream figures
      (latency ladder, transit, surge↔movement) restated against them.
- [ ] PHAT weighting evaluated against plain NCC on the same nights (§2, Knapp & Carter).
