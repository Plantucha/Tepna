<!--
  DEEP-SCOUT-HOLLOW-GATES-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-07-18 · **Created:** 2026-07-18

# Deep-scout hollow-gate wave — findings ledger (40 NEW hollow gates)

Executes `TEST-AUDIT-FINDINGS-FOLLOWUPS-2026-07-18-BRIEF.md` **§3** (the deep-scout second wave). The
first audit planted a fixed 99 mutations; this wave planted **fresh** mutations in the *under-covered*
clusters the 99 never probed, ran each against the **full suite WITH the real corpus**
(`DEX_UPLOADS=…/uploads` — the equiv/GATE-C legs boot), and recorded a gate as **hollow** only when it
stayed green under a real, behavior-changing defect (semantic no-ops rejected; every finding reverted,
tree left clean). Orchestrated as an 8-cluster `Workflow` of worktree-isolated scout agents.

**Result: 40 confirmed NEW hollow gates** (3 high, 30 medium, 7 low) across 5 clusters. Three clusters
(**render**, **self-ingest**, **gluco-cpap-oxy-deep**) returned nothing — their scout agents died on the
session rate-limit before reporting, so those are **NOT cleared, only un-scanned** (see §Re-scout).

| cluster | found | status |
|---|---|---|
| crossnight-deep | 8 | **DONE** — closed PR #173 (both-direction verified) |
| adapters | 7 | OPEN |
| integrator-fusion | 8 | OPEN |
| kernel-registry | 8 | OPEN |
| ecg-ppg-detect-deep | 9 | OPEN |
| render · self-ingest · gluco-cpap-oxy-deep | 0 (agents died) | **un-scanned — re-scout owed** |

## §CN — crossnight-deep (8) — **DONE 2026-07-18, PR #173**

The `Cross §1 — per-node crossNightBlock` group pinned only `central.sd`/baseline (wave-1) and
labels/evidence. Every **other surfaced cross-night estimator** was hollow, and because each `*-cross.js`
carries its **own copy** of `median`/`quantile`/`ols`/`mannKendall`, a defect in any one node escaped.
Closed with **22 known-answer pins** across all 5 nodes (OxyDex `meanSpo2`, PulseDex/PpgDex/ECGDex
`rmssd`, CPAPDex `usageHours`+`residualAHI` on a non-degenerate falling series): `central.median`,
`central.iqr`, `min`, `max`, `trend.slopePerDay`, `trend.mannKendall.tau`/`.p`. Both-direction verified
(median even-n collapse, IQR interp break, Mann-Kendall S sign-flip each RED their node's pin). Full
corpus suite green **2886 · 2 skipped**.

| sev | file · invariant | mutation caught |
|--|--|--|
| high | `oxydex-cross.js` — `central.median` even-n = avg of two middles | `(b[n/2−1]+b[n/2])/2 → b[n/2−1]` |
| high | `ecgdex-cross.js` — `trend.slopePerDay` = OLS vs days (day = ms/86400000) | `p.t − pts[0].t → p.t` |
| high | `cpapdex-cross.js` — personal baseline = mean/sd of all-but-latest; `zLatest` off it | `vals.slice(0,n−1) → vals.slice(1,n)` |
| medium | `pulsedex-cross.js` — Mann-Kendall `Var(S)=n(n−1)(2n+5)/18` (feeds `.p`) | `2n+5 → 2n+3` |
| medium | `ppgdex-cross.js` — `central.iqr = Q75 − Q25` | `quantile(.75) → quantile(.70)` |
| medium | `pulsedex-cross.js` — `central.min = min(vals)` | `Math.min → Math.max` |
| medium | `ecgdex-cross.js` — `change.ci95` = 2.5/97.5 bootstrap quantiles | `0.025 → 0.05` |
| medium | `ppgdex-cross.js` — `central.cv` = percent CV = 100·sd/mean | `(100*s)/m → s/m` |

## §AD — adapters (7) — OPEN

The raw→SignalFrame→compute boundary. **Off-suite harness owed** (some of these need a small
adapter-level driver, harder than the sync test lane).

| sev | file · invariant | mutation that stays green |
|--|--|--|
| medium | `nsrr-adapter.js` `to1Hz` valid window INCLUSIVE at top (SpO2 100 / HR 240 legit) | `v <= validHi → v < validHi` |
| medium | `nsrr-adapter.js` `to1Hz` valid window INCLUSIVE at bottom (SpO2 40 / HR 20 legit) | `v >= validLo → v > validLo` |
| medium | `nsrr-adapter.js` `analyzeRecord` est-AHI surrogate = ODI-4 × **1.1** | `×1.1 → ×1.3` |
| low | `nsrr-adapter.js` all-invalid HR → seeded fallback baseline = `validLo` | `firstValid = validLo → = v` |
| low | `nsrr-adapter.js` 1 Hz length FLOORs partial trailing second | `Math.floor(n/fs) → Math.ceil` |
| low | `adapters/resmed-edf.js` SD-card session cluster window INCLUSIVE at ±60 s | `<= 60 → < 60` |
| low | `adapters/resmed-edf.js` BRP Flow default fs = 25 Hz when channel carries none | `|| 25 → || 20` |

## §IF — integrator-fusion (8) — OPEN

Fusion internals beyond the first wave. Two are **high** (verdict-flipping).

| sev | file · invariant | mutation that stays green |
|--|--|--|
| high | `integrator-dsp.js` HRV divergence >30% flips qc `agreement→divergent` | `worst > 30 → worst > 300` |
| high | `integrator-dsp.js` staging REM-frac gap >0.2 must surface `disagreement:true` (branch UNTESTED) | `remGapThresh 0.2 → 0.9` |
| medium | `integrator-dsp.js` `rmssd.weightedMean` = inverse-variance (w∝1/σ² from TCH hat) | `_acc += w*o.v → _acc += o.v` (unweighted) |
| medium | `integrator-dsp.js` positional apnea needs supine frac ≥ 0.7 | `>= 0.7 → >= 0.8` |
| medium | `integrator-dsp.js` positional apnea needs supine ≥ 2× non-supine | `>= 2 → >= 3` |
| medium | `integrator-tch.js` TCH inverse-var weight floor `floorFrac = 0.08` | `0.08 → 0.40` |
| medium | `integrator-dsp.js` PB corroboration tier-weight `emerging = 0.8` | `0.8 → 0.4` |
| low | `integrator-dsp.js` external-ρ = mean of POSITIVE pairwise motion corr | `Math.max(0,r) → r` |

## §KR — kernel-registry (8) — OPEN

`dex-profile.js` classification thresholds + NHANES/ACSM interpolation — all surface in the PulseDex
**Derived** panel. Clean test-only closes (the `Dex-Profile engine` group already co-loads the module).

| sev | file · invariant | mutation that stays green |
|--|--|--|
| medium | `dex-profile.js` `bmiLabel` WHO cut = 25 (`bmiCat`) | `b < 25 → b < 27` |
| medium | `dex-profile.js` `vo2Category` ACSM band `r >= 0.8 Fair` (`vo2Cat`) | `0.8 → 0.7` |
| medium | `dex-profile.js` `vo2Percentile` slope = 50 + (v/n−1)·**120** (`vo2Pct`) | `120 → 100` |
| medium | `dex-profile.js` `whtrRisk` Ashwell cut = 0.5 (`whtrRisk`) | `0.5 → 0.4` |
| medium | `dex-profile.js` `_interp2` NHANES **weight** interp = `tbl[i][1] + f·Δ` | `+ f·Δ → − f·Δ` |
| medium | `dex-profile.js` `_interp2` NHANES **height** interp = `tbl[i][2] + f·Δ` | `+ f·Δ → − f·Δ` |
| low | `dex-profile.js` `_interp1` VO2-norm interp = `round(tbl[i][1] + f·Δ)` | `+ f·Δ → − f·Δ` |
| low | `dex-profile.js` `VO2_NORM` male age-45 anchor = 39 mL/kg/min | `[45,39] → [45,44]` |

## §EP — ecg-ppg-detect-deep (9) — OPEN

Spectral/nonlinear detector internals. These live **below** the equiv/GATE-C fixtures (the committed ECG
/PPG fixtures are "light" — they don't exercise deep spectral/DFA/SampEn/PRSA math), so a direct
known-answer per constant is owed (a fuller fixture, or a co-loaded DSP unit pin).

| sev | file:line · invariant | mutation that stays green |
|--|--|--|
| high | `ecgdex-dsp.js:1022` Lomb-Scargle LF/HF band edge 0.15 Hz (Task Force 1996) | `f < 0.15 → f < 0.12` |
| high | `ecgdex-dsp.js:1127` PRSA DC/AC normalization `(X2+X3−X1−X0)/4` (Bauer 2006) | `/4 → /2` |
| medium | `ecgdex-dsp.js:1053` DFA α1 box sizes n=4..16 beats | `<= 16 → <= 11` |
| medium | `ecgdex-dsp.js:1990` SampEn tol r = 0.2·SD (Richman-Moorman) | `0.2 → 0.15` |
| medium | `ppgdex-dsp.js:1019` DFA α1 box sizes s=4..16 | `<= 16 → <= 11` |
| medium | `ppgdex-dsp.js:948` VLF/LF band edge 0.04 Hz | `0.04 → 0.05` |
| medium | `ecgdex-dsp.js:1416` EDR resp autocorr period search [2.5,10] s | window shrunk |
| medium | `ecgdex-dsp.js:776` per-beat composite SQI weights (0.30·kSQI + …) | `0.30 → 0.50` |
| low | `ppgdex-dsp.js:1068` SampEn default tol r = 0.2·SD | `0.2 → 0.15` |

## §Re-scout — the three clusters whose agents died

**render** (`*-render.js` display/unit-conversion/badge/threshold), **self-ingest** (`loadOwnExport`
round-trip losslessness), **gluco-cpap-oxy-deep** (GMI/TIR/LBGI/MAGE · AHI subindices/leak/pressure pct ·
ODI/T90/desat-cluster/REM arithmetic) reported **0** because their scout agents were killed by the
session rate-limit, not because they are clean. Re-run those three scout prompts (in `scratchpad/
deepscout.js`) before declaring the deep-scout wave complete.

## Done when

Each OPEN cluster is either gated (a both-direction-verified assertion per finding, PASS clean + RED
under the exact mutation) or explicitly dispositioned in a further follow-up; the three dead clusters have
been re-scouted; and this brief flips to `DONE`. Land each cluster as its own gated PR (crossnight-deep =
PR #173 already). Prioritize the two **high** integrator verdict-flips (§IF) and the ecg-ppg spectral
band edges (§EP) — those move surfaced clinical numbers.
