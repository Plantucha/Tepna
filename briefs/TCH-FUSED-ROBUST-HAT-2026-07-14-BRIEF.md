<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-27 (⚠️ **date corrected: the label read 2026-07-14 while the body carried updates dated 2026-08-04 and 2026-08-09** — six weeks of drift between the status line and the work. Checked 2026-08-27 and NOT flipped: this brief's own header states its second Done-when box is *still blocked on* the `ms;hr;c` corpus re-derivation, and §2's `[~]` records the `loadReal` half as **deliberately not built** because landing code plus a gate for a path no committed input can exercise would be machinery that passes without checking anything. That is a park with a recorded reason, not a completion — so the date moves and the status does not.) · **Created:** 2026-07-14 · **Follows:** `TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md` (replaces its **§3 ESTIMATOR** — the cross-corner consensus gate — with the fused weighted-variance hat; ⚠️ **this is NOT a full supersession**: that brief stays LIVE and owns the confidence-carrying `ms;hr;c` corpus re-derivation this brief's own second Done-when box is still blocked on. A 2026-07-19 review misread this parenthesis as "superseded" and nearly retired it) · **Feeds:** `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md` · `SIGMA-PAPER-REWRITE-2026-07-06-BRIEF.md` · **DRAIN 2026-09-02 (Osprey) — BLOCKER RE-VERIFIED, still holds; status unchanged.** The second Done-when box needs the confidence-carrying `ms;hr;c` re-derivation, and #2036's full-corpus refold did NOT supply it: that refold regenerated **node exports** (115 nights under `uploads/trio/`, 72 carrying >=3 corners), which carry event-level `conf` on `ganglior_events` only — **no per-beat RR confidence**, because the export boundary summarises (~300x). Checked on 2026-06-10's ECGDex+PpgDex pair. So the blocker is the raw-RR re-derivation, not the fold. **Owner: the OWNER** — the new-generation fused triple (sigma 2.87/1.18/0.68, rho* 0.576) computed 2026-09-01 is with them as a planted-sigma decision, and the estimator choice gates this brief's remainder. **Next step:** owner ruling on the planted sigma; no fleet work is unblocked before it. · **RE-VERIFIED 2026-09-03 (Osprey) — and this brief's headline is explicitly NOT decayed, stated so nobody flags it later.** Its `1.51 / 1.56 / 2.59` is a **planted-recovery** result against synthetic ground truth (planted `1.50 / 1.56 / 2.60`), not a corpus measurement. The 2026-09-01 full-corpus refold (#2036) moved the real-corpus fused triple to `2.87 / 1.18 / 0.68`, and a reader comparing those two sets would reasonably but wrongly conclude this brief had rotted. **A planted recovery does not decay under a refold** — its input is generated, its answer is known, and the claim is that the estimator recovers what was planted. Recorded because the published-number sweep's whole subject is numbers moving underneath briefs, and this is the shape that invites a FALSE positive. Owner: Osprey; status otherwise unchanged from the 2026-08-27 re-check.

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
- [x] `beatConfidence` in ECGDSP + PPGDSP, unit-tested (burst → c≈0 in-window, clean/AF → c≈1) — **done 2026-07-14**; ECG confirmed on the REAL 06-12 night (density z 13–22 **and** SQI-depression z 8–10 both fire → c 0.00–0.51; benign sleep-onset high-density windows keep SQI high → c=1). **Permanent suite coverage added 2026-07-15** (was scratchpad-only): `ECGDSP.beatConfidence` known-answer group in `tests/dex-tests.js` — short<20→trust-all, clean→c≈1, 2× density **+ depressed SQI**→c≈0, and the AF contrast (2× density, **clean QRS ⇒ SQI ≥ baseline**→c≈1).
- [~] worker carries `cH`/`cV`; `tchSigmasFused` wired into both sigma tools + the power real-overlay. — **worker + `sigma-no-reference` DONE** (merged PR #114). **`tchSigmasFused` single-sourced into `analysis-stats.js` 2026-07-15** (the brief's "add it in the shared kernel"): the sigma page now DELEGATES (like `tchSigmas`), the worker keeps its Worker-local mirror, and a delegation-parity leg guards against a divergent copy. **STILL OPEN:** the **power tool's REAL overlay** (`sensor-trio-power-analysis.js` `loadReal`) still uses classic `tchSigmas` — its `derivedMap` reads 2-col `ms;hr` with no per-second confidence, so routing it through the fused hat needs a confidence-carrying (`ms;hr;c`) corpus re-derivation. Entangled with the N15-power work → **routed to `TRIO-ARTIFACT-GATE-AND-N15-POWER` / `TRIO-POWER-N15-FINDINGS`**.
  > **⊕ 2026-08-09 — the CORPUS half of this box is discharged; what remains is smaller and named.**
  > The `ms;hr;c` re-derivation this was routed away for now **exists** (#1014): `OxyDex timeseries.hr`
  > ships the 1 Hz pulse the O2Ring corner needs — measured before the change, **0 of 40 committed
  > OxyDex exports carried ANY HR timeseries**, so this leg was blocked on a missing corner, not on
  > effort — and `ECGDex timeseries.rr.conf` / `PpgDex timeseries.ppi.conf` carry the per-beat `c`
  > both nodes already computed and discarded. `tools/trio-batch.mjs` produces the corpus in one
  > command; `tools/tch-fused-corpus.mjs` runs the fused hat over it in Node and has (N = 17,
  > box-captured: O2Ring 2.99 / H10 1.78 / Verity 3.51 — see `SENSOR-TRIO-NIGHTS-PAPER-BRIEF`).
  >
  > **What is still owed here is only `loadReal` itself**, and it is small: `derivedMap`
  > (`sensor-trio-power-analysis.js:449`, 12 lines) reads `cc[0]=ms, cc[1]=hr` and would need an
  > optional `cc[2]=c` defaulting to 1, then `loadReal` routed through `tchSigmasFused` instead of
  > `tchSigmas`. Back-compatible by construction: a 2-column file yields c=1, which *is* the classic
  > hat.
  >
  > **DELIBERATELY NOT BUILT (2026-08-09), and the reason is the point.** That very back-compatibility
  > makes it **inert**: the committed derived files are 2-column, and the `ms;hr;c` corpus is
  > **not committed** — a settled owner decision (real biosignal data; see `SENSOR-TRIO-NIGHTS-PAPER`).
  > Landing the code plus a gate for a path no committed input can exercise would be machinery that
  > passes without checking anything — this repo's signature failure, and the one §1 of
  > `GENERATOR-FOLLOWUPS-III` exists to catch. **Build it together with an input that exercises it**:
  > either a committed 3-column fixture, or `loadReal` taught to read node-exports directly (which the
  > committed corpus already is). Until then this box is blocked on a DECISION, not on work.

  > **⚠️ RE-ROUTED 2026-08-04 — the routing above was a dead end, and the item sat orphaned for 16 days.**
  > This item was handed to `TRIO-ARTIFACT-GATE-AND-N15-POWER` / `TRIO-POWER-N15-FINDINGS`. Checked today:
  > **neither owns it.** `TRIO-POWER-N15-FINDINGS` never mentions `tchSigmasFused` or the real overlay at
  > all, and `TRIO-ARTIFACT-GATE-AND-N15-POWER`'s single mention is its ⚠️ DISPROVEN-§3 banner pointing
  > *back at this brief*. A routed item whose target does not accept it is not routed — it is dropped.
  > (Second instance of this pattern today: `CPAP-AUTOHARVEST-FOLLOWUPS-II` §2 was routed to "whoever
  > lands the PMD work", that work landed as `REFERENCE (living)`, and nobody took the item either.)
  >
  > **Measured, so the item is now stated in terms of what is actually true of the code:**
  > `sensor-trio-power-analysis.js:225` does not merely fail to use the *fused* hat — it carries its
  > **own local copy of the classic `tchSigmas`**, used at `:323`, `:480`, `:515`, instead of delegating
  > to `analysis-stats.js` the way the sigma page does. The copy is **numerically identical today**:
  > `max |local − shared| = 0.000e+0` over 300 random triplets, with no null-disagreements. The
  > differences are `var`→`const` and four diagnostic return fields (`negVar`, `dHV`, `dHO`, `dVO`) the
  > power tool never reads.
  >
  > **So there is no defect — there is an ungated duplicate.** The sigma page is protected by a
  > delegation-parity leg precisely so a divergent copy cannot appear; the power tool has no such guard,
  > so a future fix to the shared kernel silently would not reach the figures this tool produces.
  >
  > **The item therefore splits in two, and only one half needs the corpus:**
  > 1. **Delegate + parity-gate the CLASSIC hat** — free of the corpus entirely, and it removes the
  >    divergence risk. This is the next concrete step.
  > 2. **Wire the FUSED hat into the real overlay** — still genuinely blocked: `derivedMap` reads 2-col
  >    `ms;hr` with no per-second confidence, so it needs a confidence-carrying (`ms;hr;c`) corpus
  >    re-derivation. That half, and only that half, is what "awaits the corpus" means.
- [x] 06-12 σ_H10 across-night CI collapses (≈9.6→≈1.5 point; CI ±1.28→±0.3); clean nights bit-stable. — merged PR #114 (papers restated on 2.41/1.28/1.42).
- [x] AF-safety unit test: irregular-but-clean-QRS → 0 down-weighted. — **done 2026-07-15**, at BOTH tiers: `beatConfidence` (clean-QRS high density kept, above) and the hat (`tchSigmasFused` — a large **common-mode** excursion cancels in every difference & the cross-sensor spread ⇒ fused σ bit-unchanged; known-answer group asserts it).
- [x] Re-bundle + fixture regen; all gates green; corpus re-derived; papers restated on the clean numbers. — merged PR #114.

> **§Execution note 2026-07-15 (test-coverage + shared-kernel slice).** The fused hat shipped via PR #114
> with **zero permanent test coverage** (`beatConfidence`/`tchSigmasFused` were validated only in a since-deleted
> `scratchpad/fused-hat.mjs`). This pass closes that: (1) `tchSigmasFused` (+ its `_wvar`/`_consensusTrust`)
> **single-sourced into `analysis-stats.js`** — the sigma page delegates, delegation-parity gated, dead
> per-page `threeCorneredHat` alias removed; (2) known-answer + AF-safety groups added for both kernels
> (classic `var()` detonates to σ 11.16 on a planted H10 burst, fused recovers to 0.52 ≈ clean 0.68, clean
> O2 corner unbiased). **P3-safe:** touches only `analysis-stats.js` + the sigma page + tests + the 6
> re-bundled analysis-page HTMLs (via `build-analysis.mjs`) — **no app bundle, no fixture ledger, no
> `BUILD-MANIFEST`/`FIXTURE-PROVENANCE` write** (GATE A all-8 unchanged, `build.mjs --check` clean, no
> changeset owed). Gates green locally: tsc 0, full node suite 2512✓, GATE A/B PASS. Brief stays
> **IN-PROGRESS** on the one open item above (power-tool real overlay, routed to the N15-power briefs).
