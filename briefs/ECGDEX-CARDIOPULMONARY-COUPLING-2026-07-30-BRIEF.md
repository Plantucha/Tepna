<!--
  ECGDEX-CARDIOPULMONARY-COUPLING-2026-07-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-30 · **Follows:** `DEEP-STAGE-DESAT-CONFOUND-2026-07-29-BRIEF.md` §9/§11 · **Relates:** `REM-STAGING-REDESIGN-2026-07-28-BRIEF.md` §8

# The export cites cardiopulmonary coupling. Nothing computes it.

Every ECGDex night publishes this string:

```
apnea.method = "CVHR/cardiopulmonary-coupling proxy (Hilmisson 2019) — ECG-only, screen not diagnosis"
```

There is **no cardiopulmonary-coupling implementation anywhere in the codebase.** `cvhrIndex` is real
and populated (2.1–9.2 across 39 nights); the CPC half of that sentence is not implemented, and the
field the sentence describes — `apnea.estimatedAHI` — is **null on 39 of 39 nights**. The registry
carries the same claim: `estAHI` cites *"CVHR/CPC apnea proxy from ECG alone"* for a metric that has
never produced a value.

That is a method claim without an implementation, which `CLAUDE.md` §📚 exists to prevent. It should
be resolved in one of two directions — implement CPC, or stop claiming it. **This brief argues for
implementing it**, because the inputs already exist and the thing it measures is precisely what three
separate investigations have failed to measure another way.

---

## 1 · Why this is worth building rather than deleting

`DEEP-STAGE-DESAT-CONFOUND` spent three measurement rounds trying to separate apnea-disturbed sleep
from genuine deep sleep using HRV features, and concluded (§9.4, §11.3) **not actionable at current
label quality**:

| attempt | result |
|---|---|
| `rmssd` (what the Deep rule uses) | AUC 0.546 — not established |
| `lfhf` | AUC 0.477 — structurally blind to the VLF band |
| `vlf/lf` | AUC 0.599 [0.515, 0.683] vs break-even 0.684 |
| targeted CVHR band (`cvhrDensity`) | AUC 0.567 — worse |

**CPC is the published method for exactly this problem.** Thomas et al. 2005 derive coupling from the
coherence between heart-rate variability and ECG-derived respiration; **low-frequency coupling (LFC)**
is the validated signature of unstable, apnea-disturbed NREM, and **high-frequency coupling (HFC)**
marks stable NREM. Hilmisson 2019 — already cited in our own `method` string — applies it to apnea
screening. We are citing the literature that solves our problem and not running it.

## 2 · The inputs already exist — this is smaller than it looks

`cardiorespCoupling` (`ecgdex-dsp.js:~1560`) already does every hard part:

| CPC needs | already computed | where |
|---|---|---|
| R-peak amplitude per beat | `amp[k]` (max over ±2 samples at each R) | `:1570` |
| EDR = detrended amplitude | `edr = _detrendMov(amp, 40)` | `:1573` |
| HR series | `hrAbs`, detrended `hrR` | `:1574–1576` |
| **both on a uniform grid** | `edrU`, `hrU`, `hrAbsU` on a **4 Hz** grid | `:1585–1587` |
| FFT | `_fft(re, im)` | `:2991` |
| band-limiting / interpolation helpers | `_bandResp`, `_interpGrid`, `_detrendMov` | `:1489–1550` |

So the missing piece is **only** the cross-spectrum step: coherence and cross-power between two series
that are already sitting on a shared uniform grid. No new parsing, no new signal path, no new input.

## 3 · What to compute

Per sliding window over the night (Thomas 2005 uses 1024 samples with overlap; at our 4 Hz grid a
512-sample window is 128 s, so **window and step are parameters to pin, not to guess** — see §5):

1. Cross-spectral power `|Sxy(f)|` and magnitude-squared coherence `Cxy(f)` between `hrU` and `edrU`.
2. Coupling product `Cxy(f) · |Sxy(f)|` — the Thomas formulation.
3. Take the **dominant coupling frequency** in each window and bin it:

| band | range | meaning |
|---|---|---|
| **HFC** high-frequency coupling | 0.1–0.4 Hz | stable NREM |
| **LFC** low-frequency coupling | 0.01–0.1 Hz | **unstable NREM — the apnea signature** |
| **VLFC** very-low-frequency coupling | 0.004–0.01 Hz | REM / wake |

4. Report `hfcPct`, `lfcPct`, `vlfcPct` of analysable sleep, plus **e-LFC** (elevated LFC) which is the
   quantity Thomas/Hilmisson tie to apnea burden.

**Do NOT wire it into the stager.** This brief adds a measurement, not a rule change. `DEEP-STAGE-DESAT-CONFOUND`
§9.4 stands: nothing about `Deep` moves until a discriminator earns it, and CPC has to earn it here
first.

## 4 · The validation that makes this different

Every previous attempt was crippled by the label. "Contaminated" meant *an OxyDex desat overlapped* —
a delayed, threshold-gated **consequence** of apnea that many CPAP events never trigger. §9.6 bounded
the damage: ~50 % of "clean" epochs would have to hide unscored apnea before VLF cleared break-even.

**We now have a better label.** `tools/cpap-corpus.mjs` parses **199 nights** of device-scored ResMed
data (1359 therapy hours, 0 problems), and all 39 trio nights pair to a CPAP night with a
device-scored `residualAHI` spanning **1.1 → 8.0, 7 nights in the abnormal band**. That is the
independent, non-desat-derived ground truth §9.6 said was the only remaining lever.

So CPC can be validated the way none of the HRV features could:

- **r(e-LFC, device residualAHI)** across the paired nights — the dose-response §3 could never test.
- **AUC of LFC for apnea-burdened vs clean nights**, with the break-even computed from the actual
  prevalence, as in §11.2.
- The standing cross-signal falsifier (`tools/deep-desat-falsifier.mjs`) as a sanity check.

## 5 · Parameters that must be PINNED, not guessed

The lesson from `REM-STAGING-REDESIGN` §8 is that a plausible detector with unpinned thresholds is how
a bad metric ships. Before any number is published:

- **Window length + overlap.** Thomas specifies 1024 samples at his sampling rate; our grid is 4 Hz.
  Pin the window in SECONDS and state it, then verify the reported bands are stable across a
  reasonable range rather than an artifact of one choice.
- **Detrending.** `_detrendMov(x, 40)` is already applied to both series. CPC bands run down to
  0.004 Hz (250 s), so a 40-beat moving-average detrend may remove signal inside VLFC. **Check this
  explicitly** — it is the same class of error as `lfhf` being structurally blind to VLF (§8.3).
- **Minimum record length.** VLFC at 0.004 Hz needs ≫250 s. ECGDex already tiers records
  (`ultra-short` < 5 min withholds VLF); CPC must inherit an equivalent gate rather than publish a
  band it cannot resolve — the exact failure this suite already documents for 5-minute VLF.

## 6 · Evidence tier

`emerging` at most on first ship, and only if §4's validation passes. `measured`/`validated` requires
the published correlation to reproduce on our corpus, not merely to exist in the literature —
`CLAUDE.md` §📚: *no citation → it keeps the suite's own tier; never upgrade a badge on "the
literature says"*.

## 7 · Done when

- [ ] CPC computed from the existing `edrU`/`hrU` grids — coherence × cross-power, banded VLFC/LFC/HFC
- [ ] Window/overlap/detrend/min-length pinned per §5, each with a stated reason and a stability check
- [ ] `hfcPct` · `lfcPct` · `vlfcPct` · `e-LFC` exported and registered with an evidence badge
- [ ] Validated against device-scored `residualAHI` across the 39 paired nights (§4)
- [ ] `apnea.method` corrected — either it names what is now implemented, or the CPC clause is dropped
- [ ] `estAHI` resolved: populated from CPC, or its registry entry retired rather than left null-forever
- [ ] Gated with teeth (mutation-checked), and NOT wired into the stager

## 8 · Deliberately not in scope

- **No stager change.** §9.4 governs; `Deep` does not move on this brief.
- **No `estimatedAHI` back-fill from CVHR alone.** If CPC does not validate, the honest outcome is to
  retire the field and the claim, not to fill it with the half we happen to have.
