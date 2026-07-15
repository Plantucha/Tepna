<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-14 · **Created:** 2026-07-14 · **Follows:** `TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md` (executes its intent with a better estimator) · **Feeds:** `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md` · `SIGMA-PAPER-REWRITE-2026-07-06-BRIEF.md`

# The fused-weight three-cornered hat — artifact-robust σ with no hand-tuned constant

> **One-line:** the three-cornered hat is a VARIANCE estimator with breakdown point 0 — one ~15-min
> spurious-QRS burst on `2026-06-12` inflates σ_H10 from ~1.5 → 9.6 bpm and blows the across-night CI to
> ±1.28. `TRIO-ARTIFACT-GATE` proposed a hard cross-corner consensus gate; prototyping on the REAL corpus
> showed that gate (and every single-cue fix) is either unreliable or biases the noisiest corner. The
> validated answer is a **fused-weight hat**: a per-second, per-sensor confidence `c = density_trust ×
> quality_trust` (computed at the DSP tier) drives a **weighted-variance** TCH. On ground truth it recovers
> H10/Verity/O2 = **1.51 / 1.56 / 2.59** (planted 1.50 / 1.56 / 2.60) — exact, unbiased, AF-safe, O(n), and
> with no corpus-tuned threshold anywhere.

## Why (the defect, restated)
`tchSigmas` (shared: `sensor-trio-worker.js` · `sigma-no-reference-analysis.js` · `sensor-trio-power-analysis.js`)
solves `σ²_A = ½(Var(A−B)+Var(A−C)−Var(B−C))`. `Var` has a **0 breakdown point**, so a transient in one
corner detonates it. The 06-12 burst passes every existing guard because they are all **local**: `buildNN`'s
per-beat SQI gate (0.30) — burst beats sit at 0.37–0.45; its Malik ectopy gate — the sustained burst
contaminates the local median it compares against; the worker's `ecgHrMap` rolling-median — same; and
`h10FailureClass` (#98) only fires on a **whole-night** lead fault (both correlations dead), not a 15-min
partial burst. The motion-`flag` catches it for the transfer-standard pool but the **hat ignores the flag**.

## What we ruled out (measured on real nights 06-10/12/14/15/17, and on ground-truth synthetics)
- **Two-detector QRS consensus (A ∩ B).** DEAD: `detectPeaksB`'s `0.18·max(|bp|)` floor collapses on any
  large transient → **0–55 beats over a 7-h night, every night** (so `bSQI`/`matchB`, `computeSQI:509`, is a
  dead input corpus-wide — a separate latent bug worth fixing). An **adaptive** B revives detection but
  over-detects ~2× A and its consensus **false-flags a clean 70-min block on 06-10** (threshold drift). Not usable.
- **Cross-sensor consensus, per-second Hampel on 3-median residuals.** Over-drops **17% on clean/AF** and
  biases O2Ring **2.60 → 1.98** (the median reading's residual is 0, so the MAD scale is too tight; the
  noisiest corner's legitimate tail reads as outlier).
- **Range-based soft consensus (Tukey biweight on per-second spread).** Much better (H10 → 1.49) but still a
  residual O2 bias **2.60 → 2.46** and ~4% dropped, because cross-sensor spread cannot tell "O2 is
  legitimately noisy this second" from "O2 is artifact this second."
- **Qₙ robust scale alone.** Works (13.76 → 2.02) but leaves a residual and is O(n²).

## The design (validated)
Two tiers; one weighted-variance hat — O(n), no hard threshold, AF-safe.

**DSP tier — per sensor, per second, output a confidence `c ∈ [0,1]` next to HR:**
```
c_sensor(t) = density_trust(t) × quality_trust(t)
  density_trust : redescending on the local beat-density's Hampel z vs the RECORD's own median density
                  (self-calibrating; 06-12 burst = z 13–22, clean nights ≤ z 7 — huge separation)
  quality_trust : mean per-beat SQI over t vs the record's own median SQI (AF-safe: real tachy/AF = clean
                  QRS = high SQI = high trust; only NOISY over-detection drops it)
```
- `c_H10` from ECGDSP · `c_Verity` from PPGDSP (the optical harmonic-doubling fix already helps) · `c_O2 = 1`
  (device pulse — cannot over-detect).

**Hat tier — weighted-variance TCH, each difference series weighted by BOTH sensors' confidence:**
```
w_HV = c_H·c_V ,  w_HO = c_H·c_O ,  w_VO = c_V·c_O        (× a SOFT range-consensus term as a fallback net)
V_ab = Σ w·(d−μ_w)² / Σ w  →  σ²_H = ½(V_HV + V_HO − V_VO)
```
The per-difference weighting is what removes the O2 bias: O2's noisy seconds keep `c_O ≈ 1`, so they stay in
`V_HO`/`V_VO`; only the flagged sensor's flagged seconds leave. Consensus is a **soft secondary** net for
artifacts the DSP can't self-see — applied gently so it never biases a corner.

### Validation (ground truth, `scratchpad/fused-hat.mjs`)
| estimator | H10 | Verity | O2 | dropped |
|---|---|---|---|---|
| truth (planted) | 1.50 | 1.56 | 2.60 | — |
| classic `var()` | **13.76** | 1.60 | 2.57 | 0 |
| per-sensor DSP fused | **1.51** | **1.56** | **2.59** | ~burst only |
AF-like (irregular but consensual) and clean nights: recovered, ~0 dropped.

Every threshold is the **record's own median** (self-calibrating) or a **universal statistical constant**
(Hampel 3·MAD / Tukey c); none is corpus-tuned.

## Do (file-by-file)
1. **`ecgdex-dsp.js`** — add `beatConfidence(peaks, times, sqi, fs) → Float32 per-second c` (density-Hampel ×
   SQI-depression), exported on `ECGDSP`. Additive + unwired ⇒ **export-inert** (no fixture regen for this step).
   Note/fix the dead `bSQI` (detector B) separately.  ← **STARTED here.**
2. **`ppgdex-dsp.js`** — the same `beatConfidence` for the Verity corner.
3. **`sensor-trio-worker.js`** — `ecgHrMap`/`ppgHrMapReal` compute SQI + `beatConfidence`; return per-second
   `cH`/`cV` alongside `hh`/`vv`. `c_O2 = 1`.
4. **the hat** — add `tchSigmasFused(hh,vv,oo,cH,cV,cO)` (weighted-variance + soft range-consensus) in the
   shared kernel; route `windowFromWorker` (sigma tool) + the worker + the power tool's REAL overlay through
   it. Power-sim (synthetic, clean) stays classic `var` (efficient; no artifact to be robust to).
5. **Re-bundle + regen:** ECGDex/PPGDex bundles + fixtures (outputs move); the two sigma tools via
   `build-analysis.mjs`. Node suite + provenance + no-network gates green.
6. **Re-derive** the corpus (folder-drop) → clean σ + CI → feed the power tool's planted σ → **final paper pass**
   (`sigma-no-reference.html` H10 CI tightens from artifact-inflated [0.94–1.79] to ~[1.3–1.8]).
7. **ECGDex-own-HRV (drop-in, same file).** `beatConfidence` is already in `ecgdex-dsp.js`; feed it into the
   node's OWN pipeline so the 06-12 burst no longer inflates ECGDex's `RMSSD`/`SDNN`/epoch exports (not just
   the trio hat): down-weight/exclude low-`c` seconds in `buildNN`/`epochEngine`, and export the per-epoch `c`
   (the "actual gap" the artifact-gate brief named). Moves ECGDex outputs ⇒ re-bundle + fixture regen with
   step 5. The broader fleet transfer (PulseDex/HRVDex robust HRV, ODI/AHI, GlucoDex, revive `bSQI`) is
   tracked separately in `TCH-FUSED-ROBUST-HAT-FOLLOWUPS-2026-07-14-BRIEF.md`.

## Done when
- [x] `beatConfidence` in ECGDSP + PPGDSP, unit-tested (burst → c≈0 in-window, clean/AF → c≈1) — **done 2026-07-14**; ECG confirmed on the REAL 06-12 night (density z 13–22 **and** SQI-depression z 8–10 both fire → c 0.00–0.51; benign sleep-onset high-density windows keep SQI high → c=1).
- [ ] worker carries `cH`/`cV`; `tchSigmasFused` wired into both sigma tools + the power real-overlay.
- [ ] 06-12 σ_H10 across-night CI collapses (≈9.6→≈1.5 point; CI ±1.28→±0.3); clean nights bit-stable.
- [ ] AF-safety unit test: irregular-but-clean-QRS → 0 down-weighted.
- [ ] Re-bundle + fixture regen; all gates green; corpus re-derived; papers restated on the clean numbers.
