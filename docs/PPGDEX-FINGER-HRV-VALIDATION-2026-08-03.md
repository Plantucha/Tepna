<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living validation note) · **Created:** 2026-08-03 · **last-verified:** 2026-08-03
· **Executes:** `briefs/O2RING-FINGER-HRV-VALIDATION-2026-07-21-BRIEF.md` §6 item 3 (per-metric tier verdict)
· **Method:** §3 of that brief · **Apparatus:** `tools/ppi-jitter-vs-ecg.mjs` (committed 2026-08-03, PR #756)

# O2Ring finger PPG — per-metric HRV tier verdict against paired chest ECG

**One-line verdict: NO metric is promoted. Every criterion in §4 fails, measured.** `sdnnRobust`,
whole-record RMSSD and the jitter budget all miss their bars on the ≥10-night corpus, so the finger's HRV
family stays **`emerging`** — which is a legitimate outcome §4 names explicitly, not a deferral.

## 1 · Data & method

- **Corpus:** live-BLE captures, `/home/michal/tepna-smoketest/captures/`, through 2026-08-01. **16 O2Ring
  finger nights** and **15 Polar Verity Sense wrist nights**, each paired to a simultaneous Polar H10
  `_ECG.txt`. Real recordings are gitignored (personal biosignal data); the apparatus re-derives
  everything from them.
- **Reference:** H10 raw-ECG Pan–Tompkins via the shipped `ECGDSP`, with **sub-sample R-peak refinement**
  (§3.2) — parabolic vertex on `ECGDSP.bandpass`, the same filtered signal the detector peaks on.
- **Alignment:** per-epoch (§3.3), 5-min epochs. Coarse lag by instantaneous-HR **envelope**
  cross-correlation — the envelope is aperiodic, so it cannot alias by a whole beat as a beat-train
  correlation would — then local refinement, then ±75 ms one-to-one matching.
- **Shipped code only** (§3.5): `PPGDSP` / `ECGDSP` co-loaded in a `vm` realm. No reimplemented HRV math;
  RMSSD/SDNN come from each node's own `analyze()`.
- **Both devices through the SAME instrument.** This is load-bearing — see §4.

## 2 · Results

| endpoint | O2Ring **finger** | Verity **wrist** | §4 bar | verdict |
|---|---|---|---|---|
| **PPI-jitter sd** (primary) | **8.16 ms** (IQR 6.52–21.46) | 8.36 ms (IQR 4.63–31.61) | ≤ 4.98 ms ⇒ 2 % | **FAIL** |
| beat match rate | 99.3 % (IQR 94.7–100) | 100 % (IQR 86.7–100) | — | (context) |
| **RMSSD bias** vs ECG | **+37.7 %** (IQR 29.7–59.7) | +15.3 % | ~2 % | **FAIL** |
| **`sdnnRobust`** vs ECG `dispSd` | **+10.6 %** (IQR −5.2–+17.0) | +18.7 % (IQR +3.2–+28.4) | ±3.5 % | **FAIL** |
| CVHR agreement | not run | not run | — | **open** |

## 3 · Per-metric verdict

- **`sdnnRobust` → STAYS `emerging`.** §4's bar is a median bias within ~±3.5 %; measured **+10.6 %** with
  an IQR spanning −5.2 to +17.0. The IQR crosses zero, so the *direction* is not even stable across
  nights. This was the metric §4 thought most likely to promote; it does not.
- **Whole-record RMSSD → STAYS `emerging`**, as §4 predicted it would. +37.7 % bias, and the jitter that
  drives it (8.16 ms) is well outside the closed-form budget (≤ 4.98 ms ⇒ 2 %; ≤ 7.93 ms ⇒ 5 %).
- **CVHR → UNDECIDED, not run.** §4 requires agreement on **sleep** nights; that endpoint is not in this
  apparatus. Recorded as open rather than assumed either way.
- **No tier string changes anywhere.** `integrator-dsp.js` is untouched; §4 reserves ratification for a
  person, and there is nothing to ratify because nothing passed.

## 4 · The finding that matters most, and it is not about the finger

**§1 of the brief predicted the single-channel finger would be NOISIER than the 3-LED wrist.** Measured
like-for-like, the medians differ by **0.2 ms** (8.16 vs 8.36) and the finger's IQR is *tighter*. On
`sdnnRobust` the finger is clearly **better** (+10.6 % vs +18.7 %). The single-channel-cannot-vote argument
does not survive contact with the corpus.

**And two published reference figures do not reproduce under this apparatus:**

| claim | source | measured here |
|---|---|---|
| Verity PPI-jitter **5.92 ms** | `PPGDEX-ALGORITHM-DEEP-DIVE` §2.1, `[CORPUS]` | **8.36 ms** (+41 %) |
| `sdnnRobust` **~+3.5 % vs ECG truth** | shipped string, `ppgdex-dsp.js` `hrv.time.sdnnNote` | **+18.7 %** on the Verity |

**Neither discrepancy can be attributed.** The deep-dive's §2.2 apparatus was never committed — it
describes the method and names no tool — so there is nothing to diff against: corpus, method, or the
original figure could each explain it. What *is* established is that both claims **fail to reproduce under
the only committed instrument that exists**.

The second one ships to users as guidance (*"use sdnnRobust for cross-node SDNN comparison"*), so it owes
a re-derivation. That edit is on the compute path and belongs with §4's ratifier; it is recorded here as a
finding, not actioned.

## 5 · Why the instrument is the headline

Three numbers in this work were wrong before they were right, and **all three came from the apparatus, not
the data** — each plausible enough to have been published:

| reported | cause |
|---|---|
| 26 ms finger jitter | coarse 1 s lag binning against a ±75 ms matching tolerance — 13× too coarse |
| 3.14 ms reference error | integer R-peak indices; §3.2's sub-sample refinement was missing |
| −29 % SDNN bias | the wrong ECG field (`sdnn` vs `dispSd`), misread as a missing capability |

**Two of the three were caught only by pointing the same instrument at a second device.** An artifact of
construction shows up as a *constant across devices*; a real device property does not. The −29 % read
identically on finger and wrist, which is what exposed it. Running the reference leg was not diligence —
it was the detector.

This is why §2's table reports both devices even though the brief is about one, and why the apparatus is
committed with a corpus-free `--selftest` whose sharpest assertion is that the **coarse alignment stage is
insufficient on its own** — a future version that drops the refinement fails loudly instead of quietly
reporting grid-quantised lags.

## 6 · What would change the verdict

- **CVHR agreement on sleep nights** — the one §4 criterion not yet measured.
- **A re-derivation of the two non-reproducing reference figures**, or an explanation of the gap. Until
  then, cross-node SDNN guidance rests on a number this corpus does not support.
- **Jitter reduction at source.** The budget is closed-form (`PPGDEX-ALGORITHM-DEEP-DIVE` §2.1): whole-record
  RMSSD cannot reach 2 % bias until PPI jitter drops to ≤ 4.98 ms. At 8.16 ms the finger is ~1.6× over.
  Any accuracy proposal should be scored in *milliseconds of jitter removed*, or it is not addressing this.
