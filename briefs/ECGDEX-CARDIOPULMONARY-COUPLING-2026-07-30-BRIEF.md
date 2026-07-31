<!--
  ECGDEX-CARDIOPULMONARY-COUPLING-2026-07-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-31 · **Created:** 2026-07-30 · **Follows:** `DEEP-STAGE-DESAT-CONFOUND-2026-07-29-BRIEF.md` §9/§11 · **Relates:** `REM-STAGING-REDESIGN-2026-07-28-BRIEF.md` §8 · **Follow-up:** `ECGDEX-CARDIOPULMONARY-COUPLING-FOLLOWUPS-2026-07-31-BRIEF.md`

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

- [x] **CPC computed — but NOT from `edrU`/`hrU`.** §2 was wrong to nominate them: measured, those
      grids retain **0 % of VLFC and 0–22 % of LFC** (`_bandResp` drops < 0.1 Hz by its own comment;
      `_detrendMov(x, 40)` is a ~48 s high-pass at sleep HR). Building on them would have reported
      LFC ≈ 0 every night and read as a clean negative. CPC runs on `hrAbsU` + a new undetrended
      `edrRawU`, with a per-window LINEAR detrend.
- [x] **Window pinned at 512 s** (2048 samples @ 4 Hz), matching Thomas's *duration* rather than his
      sample count — resolution is 1/T, and the 4 Hz grid is already ~10× oversampled against a beat
      Nyquist of ~0.42 Hz at 50 bpm. `df = 0.00195 Hz`, ~3 bins across VLFC. Records too short return
      `null` rather than a degraded number.
- [x] **Estimator verified against a known-answer null.** The first `argmax` version was biased —
      on uncorrelated noise it gave VLFC 7.5 / LFC 32.5 / HFC 60.0 % against a bandwidth-proportional
      expectation of 1.5 / 23 / 76. Replaced with integrated band power: null now 1.6 / 23.6 / 74.8 %.
      Without this the first real reading ("LFC 54 %") would have been reported against an implicit
      null of zero.
- [x] **Validated against device-scored `residualAHI`, 39 paired nights (§9).** Partially: the
      published LFC prediction FAILED (r = −0.045); **HFC validated** (r = −0.408, p = 0.009) and beats
      the incumbent `cvhrIndex` (r = −0.151, p = 0.36).
- [x] **Exported; only `cpcHfc` registered, badged `emerging`.** LFC/VLFC exported deliberately
      unbadged — the shares are compositional (sum to 100.0 ± 0.1), so HFC falling forces the others
      up, and badging all three would publish one finding as three.
- [x] **Gated with teeth** — `CPC registers HFC only`, mutation-verified: registering `cpcLfc` "for
      symmetry" reds 2. NOT wired into the stager; §9.4 of `DEEP-STAGE-DESAT-CONFOUND` governs.
- [x] **`apnea.method` corrected / `estAHI` resolved — §9.5 option (a), executed 2026-07-31 (§10).**
      `estimatedAHI` AND `riskCategory` are removed (not nulled), `method` now names what is computed
      and quotes the measured correlation. §9.5's premise was wrong in one respect and understated
      the problem in another — see §10.

## 8 · Deliberately not in scope

- **No stager change.** §9.4 governs; `Deep` does not move on this brief.
- **No `estimatedAHI` back-fill from CVHR alone.** If CPC does not validate, the honest outcome is to
  retire the field and the claim, not to fill it with the half we happen to have.

---

## 9 · VALIDATED against device-scored residual AHI (2026-07-30) — partially, and the headline failed

CPC was computed on all 39 merged nights (exported, then re-folded so every night carries it from
merged sessions rather than a fragment) and paired to its ResMed night. AHI spread **1.1 – 8.0**, 7
nights in the abnormal band.

| predictor | Pearson r | 95 % CI | p | Spearman |
|---|---|---|---|---|
| **LFC %** | **−0.045** | [−0.356, 0.274] | 0.79 | 0.135 |
| VLFC % | +0.356 | [0.046, 0.604] | 0.025 | 0.138 |
| **HFC %** | **−0.408** | **[−0.641, −0.106]** | **0.009** | **−0.348** |
| `cvhrIndex` (incumbent) | −0.151 | [−0.445, 0.173] | 0.36 | −0.144 |

### 9.1 The published prediction did not hold

§3 predicted, from Thomas 2005 / Hilmisson 2019, that **LFC rises with apnea burden**. It does not:
r = −0.045, flat, CI straddling zero. Stated plainly because the brief committed to the prediction in
advance, and a literature-derived expectation that fails on our corpus is a result, not an
embarrassment to be re-described.

### 9.2 What DID validate: HFC, and it beats the incumbent

**HFC falls with apnea burden — r = −0.408, p = 0.009**, Pearson and Spearman agreeing (−0.408 /
−0.348), and it survives Bonferroni over the four predictors tested (α = 0.0125). Physiologically
coherent: HFC is the *stable-NREM* marker, and apnea destabilises NREM.

It also **beats what ECGDex already ships for this job** — `cvhrIndex` does not correlate with device
AHI at all (r = −0.151, p = 0.36). That is the first time in this whole line of work that a feature
has out-performed the incumbent against an independent label.

### 9.3 Why only HFC is registered — the shares are COMPOSITIONAL

Measured: `hfcPct + lfcPct + vlfcPct` = **100.0 ± 0.1** on every night. The three are not independent,
so **HFC falling FORCES LFC + VLFC to rise.** VLFC's nominal r = +0.356 is largely the arithmetic
complement of the HFC result, not a second discovery — and it fails Bonferroni, with Pearson and
Spearman diverging sharply (0.356 vs 0.138), the signature of a few high-leverage nights.

**So `cpcHfc` is registered `emerging`; LFC and VLFC are exported and deliberately left unbadged.**
Badging all three would publish one finding as three. This asymmetry is gate-backed
(`CPC registers HFC only`, mutation-verified: registering `cpcLfc` "for symmetry" reds 2), because
that tidy-up is exactly the plausible future edit that would undo the reasoning.

### 9.4 Limits, stated

- **One subject.** 39 nights from one person on CPAP. Nothing here generalises to a population.
- **A treated-apnea label.** Residual AHI on therapy spans 1.1–8.0; this says nothing about untreated
  burden or about severe disease.
- **`emerging`, not higher.** `CLAUDE.md` §📚 forbids upgrading a badge because the literature agrees;
  the badge rests on the r = −0.408 measured here, and the citation says so.
- **Not diagnostic, and not wired into staging.** §9.4 of `DEEP-STAGE-DESAT-CONFOUND` still governs —
  `Deep` does not move on this brief.

### 9.5 What this settles about `estAHI`

§7 asked for `estAHI` to be populated from CPC or retired. It is still **null on every night**, and
this validation does not license filling it: a single-band correlation of −0.408 is not an AHI
estimate. The honest options remain (a) retire the field and drop the CPC clause from `apnea.method`,
or (b) leave both pending a model that actually predicts AHI rather than correlating with it.
**Recommendation: (a)** — the field has published a method string it never implemented for its entire
existence, and one validated correlate does not change that.

---

## 10 · EXECUTED 2026-07-31 — and §9.5 had the diagnosis half-wrong

§9.5's recommendation (a) is enacted. Executing it turned up two things §9.5 did not know, one of
which makes the case stronger and one of which widens the scope.

### 10.1 `estimatedAHI` was not "still null" — it was live in the app

§9.5 said *"It is still null on every night."* That is true of the **batch corpus** it examined, and
false of the product. The field is computed in `ecgdex-profile.js` by `ECGProfile.personalize`, a
**browser-only** enrichment that `trio-batch.mjs` never runs — so every corpus export reads `null`
while the app itself populated it. In the app it rendered as a KPI (`Est. AHI ≈ N /h · Mild`), a hero
pill on the CVHR card, a detail-table row with a `<5` clinical target, and it rode the ⬇JSON button's
export. **The conclusion was right for a reason that was wrong**, and the reason mattered: "a dormant
null field" and "a clinically-labelled number on the user's screen" do not carry the same urgency.

*How the mistake was available to make:* the corpus is the only route anyone measures, so a
UI-layer derivation is invisible to every gate and every probe in this investigation. Worth
remembering the next time an audit concludes a field is unused.

### 10.2 What the "estimate" actually was

```js
estAHI = { value: +idx.toFixed(0), lo: +(idx*0.7).toFixed(0), hi: +(idx*1.3).toFixed(0),
           band: idx<5?'Normal':idx<15?'Mild':idx<30?'Moderate':'Severe' }   // idx = r.cvhr.index
```

`value` **is** the CVHR index, rounded. The `lo`/`hi` are an invented ±30 % interval — no error model,
no calibration, a decoration that reads as a confidence bound. The bands are AHI's own clinical
cut-points (5/15/30). So the field asserted that CVHR events convert 1:1 into apnea–hypopnea events,
which is exactly what §9 measured and refuted: **r = −0.151, p = 0.36** against device-scored residual
AHI over 39 paired nights. The suite even documented the identity — a pre-existing assertion read
`estimated AHI value = CVHR index`.

### 10.3 `riskCategory` had the same defect, and was retired with it

`apneaRisk(cvhrIndex, onCPAP)` mapped the same refuted index onto directive clinical strings —
`Moderate · 15–30/h · screen for OSA`, and on CPAP `Inadequate · therapy not controlling events`.
§7's box named only `estAHI`, but retiring one and leaving the other would have shipped the same
claim under a different name, so both went (owner decision, 2026-07-31). The hero's "Apnea risk"
chip, the severity colouring of the CVHR subscore, and the two CPAP-effectiveness sentences in the
readiness note all went with it.

**Nothing replaced them.** The one validated correlate (`cpc.hfcPct`, r = −0.408) is still not an AHI
estimate, and promoting it into the vacated slot would repeat the error with better inputs. The
surviving surfaces are `cvhrIndex` and `cpcHfc` under their own names — the subscore now reads
`CVHR/h`, uncoloured, because colouring needs a validated cut-point and §9 found none.

### 10.4 Two defects found on the way, both fixed here

- **The `Apnea/h` subscore was UNBADGED.** Its label resolved to no registry id, so
  `MetricRegistry.badge()` rendered empty — a surfaced measurement with no evidence badge, which
  CLAUDE.md §🎫 calls a bug of the same severity as a wrong unit. The replacement label `CVHR/h` is
  aliased to `cvhrIndex`, so it is badged by construction.
- **`cpc` shipped on ONE export route.** `ecgdex-dsp.js` gained it in #580; `ecgdex-app.js`'s
  `buildV2` did not — despite the DSP block declaring it "MIRRORS ecgdex-app.js buildV2
  field-for-field". So the app's own ⬇JSON export omitted the metric this brief validated. Both
  routes now carry it, and the divergence is gated.

### 10.5 What the gates did and did not prove

- **`computeHash` moved** (`f3969a38cada → 322bb5f5a6e6`), so this is **not** export-inert and
  re-verification was owed — the honest signal working as designed.
- **All three ECGDex fixtures regenerated to identical bytes.** That is **not** evidence of
  inertness: **none of them carries an `apnea` block at all** (the clip and both synthetics are too
  short for `longRec`). The changed path has **no committed-fixture coverage**, and saying "0
  fixtures moved" without that caveat would be precisely the false export-inert claim §🔒 was written
  to abolish. Dynamic coverage does exist — the Integrator RICH-export group builds a populated
  apnea block — and the new assertions live there.
- **The retirement is mutation-verified:** re-adding `estimatedAHI` "for back-compat" reds
  `rich: apnea.estimatedAHI is GONE, not nulled`. The `method` string is pinned twice (that it
  disclaims being an AHI, and that it carries the measured `−0.408`) so prose cannot soften back.

### 10.6 Deliberately NOT done

Consumers still read `apnea.estimatedAHI` from **legacy** exports — `integrator-dsp.js` (into
`summary.estAHI`), `oxydex-fusion.js`, `cpapdex-coimport.js`. They all null-guard, so they degrade
cleanly, and the Integrator prefers CPAP's device-scored `residualAHI` where present. Left in place
on purpose: touching them re-bundles three more apps for no user-visible correctness gain. Carried to
the follow-up brief, including the one case that is a real gap — a **non-CPAP** fusion reading a
legacy ECGDex export still inherits the retired number.
