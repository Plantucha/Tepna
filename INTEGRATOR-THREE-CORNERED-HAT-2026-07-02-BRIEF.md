<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-02 (estimator landed + gated; app-wiring remains) · **Created:** 2026-07-02 · **Charter:** ad-hoc (cross-node accuracy — reference-free per-sensor error) · **Extends:** `INTEGRATOR-BUILD-BRIEF.md` §4.4 `fuseHRVConsensus` · **Touches:** `integrator-dsp.js` (+ new `integrator-tch.js`) → re-bundle `Integrator.html` + both provenance gates

> **What.** Add a **three-cornered-hat (TCH)** estimator to the Integrator: from the three spatially-separate
> cardiac nodes measuring the same latent heartbeat — **ECGDex (chest), PpgDex (wrist), OxyDex (finger)** —
> recover *each sensor's own error variance with NO gold-standard reference*, then use inverse-variance to
> (a) weight the fused autonomic state and (b) attribute *which* node is the outlier in a divergence.
> This upgrades `fuseHRVConsensus` from "they disagree N%" to "**PpgDex is the one that's off here.**"
> **Re-bundle + re-record Integrator fixtures after any `integrator-dsp.js` edit.**

# Integrator — three-cornered-hat per-sensor error attribution (2026-07-02)

## ✅ Execution status — 2026-07-02
**DONE (landed + verified, no app bundle touched):**
- **`integrator-tch.js`** — pure, DOM-free, deterministic estimator: classic Gray–Allan;
  correlated solve with (a) a consumer-supplied external ρ and (b) an auto minimum-ρ non-negativity
  search (damped multi-start Newton); `inverseVarianceWeights`, `culprit`, `alignTriplet`, graceful
  degrade. Exposes `window.IntegratorTCH`.
- **§1 build the triplet** — `adaptEnvelopeNode` now lifts the per-epoch `timeseries.epochs[]`
  `{tMin,tMs,rmssd,hr,motion}` series into `rec.series.hrvEpochs` (additive, null-tolerant; nodes
  without an epoch grid carry none). PpgDex already emits `motionIndex` per epoch — the co-motion
  ρ source (finding §1) exists with **no PpgDex change required**.
- **§3 consume** — `fuseHRVConsensus` runs `_tchConsensus(like)`: picks the max-overlap triple of
  series-bearing nodes, aligns, calls `IntegratorTCH`, and attaches `block.tch{sigma2,sigma,weights,
  culprit,rho,method,coMotion}` + `block.tchStatus`, an inverse-variance `block.rmssd.weightedMean`,
  and a culprit call-out in `note`. Degrades to a reason-stamped null (pairwise consensus unchanged)
  when <3 nodes carry an alignable series.
- **Verification** — `tests/tch-selftest.html` **22/22**; canonical gate groups in `tests/dex-tests.js`:
  *“TCH — per-sensor error”* **15/15** + *“TCH wiring (§3)”* **9/9** (end-to-end: adaptEnvelopeNode →
  fuseHRVConsensus names the noisiest node PpgDex as culprit, weighted-mean present, degrade clean),
  wired into both runners' `env.IntegratorTCH`. All Integrator groups green.
- No app bundle loads `integrator-tch.js` yet → **no re-bundle / ledger churn** from this work; the
  headless regression floor is the applicable gate.

**🤝 Parallel-work note (2026-07-02):** another coder is executing
`PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-2026-07-02-BRIEF.md` — `ppgdex-dsp.js` is mid-rewrite
(TERMA + 3-LED consensus + worker pool landed). Their in-flight change reds two PpgDex-only gates
(FULL-lane waveform fidelity + the ppgdex Phase-9 equivalence leg) until they regenerate the ppgdex
fixture at their re-bundle — **expected, theirs, not this work.** This track stays OFF all `ppgdex-*`
files and the shared ledgers; Integrator re-bundle + ledger reconcile is deliberately deferred until
PpgDex lands so we don't race `BUILD-MANIFEST.json` / `FIXTURE-PROVENANCE.json`.

**REMAINING (next session, after PpgDex lands — the heavy gates):**
- **§5 render** finding-card upgrade in `integrator-render.js` (per-sensor σ bars + culprit call-out).
- Re-bundle `Integrator.html` (add `integrator-tch.js` to `Integrator.src.html`) → update
  `BUILD-MANIFEST.json` (GATE A) → regenerate + re-record Integrator fixtures (GATE B) →
  `Dex-Test-Suite.html?full` + `verify-provenance.html` green → flip DONE.
- **External-ρ refinement** (finding §1): estimate common-mode ρ from cross-node `coMotion` and pass
  it as `opts.rho` so positive co-motion bias is removed (today TCH runs classic/auto only).

**⚠ Findings surfaced during execution (fold into the remaining work / a follow-up):**
1. **Positive common-mode is undetectable reference-free.** The non-negativity/min-ρ fallback only fires
   on the *negative-variance* failure mode. A positive co-motion correlation **biases classic without
   driving any variance negative** (demonstrated: injected {1,16,16} read as {7.05,3.83,4.21}). So the
   consumer MUST pass an **external ρ** to remove it — and the natural ρ source is the **ACC co-motion**
   estimate from the PpgDex motion gate. This directly links to
   `PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-2026-07-02-BRIEF.md` (ACC-referenced work): pass that
   co-motion coefficient in as `opts.rho`.
2. **Triplet membership is metric-specific** (the original draft glossed this): HR-hat = ECG+PPG+**Oxy**;
   RMSSD-hat = ECG+PPG+**(HRVDex | PulseDex)** — OxyDex produces no RMSSD.
3. **The 2026-07-01_2143 reference night can't exercise real TCH.** OxyDex's export carries **no per-epoch
   HR series** (no `timeseries` block), and only ECG+PPG have epoch HRV series — so both triplets lack a
   3rd series/node and real-night TCH correctly **degrades to pairwise**. Making TCH fire on real data is
   an **upstream node-export requirement**: OxyDex must emit per-epoch pulse HR (and/or a 3rd HRV node
   must be present). Track as a node-export follow-up.


## Why this is well-posed here (and why NOT inside PpgDex)
TCH (Gray & Allan 1974) recovers three unknown variances from three pairwise-difference variances:
```
σ²_ECG = ½(V_ECG,PPG + V_ECG,Oxy − V_PPG,Oxy)
σ²_PPG = ½(V_ECG,PPG + V_PPG,Oxy − V_ECG,Oxy)     where V_A,B = var(seriesA − seriesB)
σ²_Oxy = ½(V_ECG,Oxy + V_PPG,Oxy − V_ECG,PPG)
```
It needs three estimators of the SAME quantity with **largely independent** noise. The three Dex nodes
sit at three body sites (chest / wrist / finger) with mostly-independent error → well-posed. (The
rejected sibling idea — a hat over the three co-located LEDs *inside* one PPG module — is degenerate:
motion is common-mode across those LEDs, and TCH cancels common-mode by construction, so it would report
false confidence in exactly the motion windows. That belongs in PpgDex as an ACC-referenced canceller, not
here. Cross-reference: `PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-2026-07-02-BRIEF.md` §5.)

## §1 — build the aligned triplet series (export-only, no raw re-analysis)
**Constraint.** Per `INTEGRATOR-BUILD-BRIEF.md` §0 the Integrator is NOT a raw re-analyzer — it consumes
node exports. So TCH runs on what nodes already emit: the per-5-min `timeseries.epochs[]` grid.
**Change.** For each overlapping night, build two co-registered triplets on the shared floating wall-clock
(Clock Contract — align by `tMin`/`tMs`, `getUTC*` only):
- **HR triplet** — `epochs[].hr` from ECGDex / PpgDex / OxyDex (OxyDex pulse HR).
- **HRV triplet** — `epochs[].rmssd` (the metric whose PpgDex inflation triggered all this).
Keep only epochs where all three report a value; require ≥ a minimum overlap (propose ≥ 12 epochs / 1 h).
**Scope honesty (state it in the export):** this attributes variance at the **5-min-epoch timescale**
(HR level, RMSSD level), NOT beat-to-beat jitter — the Integrator can't see individual beats. It's a
fusion-weighting + outlier signal, not a beat-level QC.

## §2 — the estimator: correlated / generalized TCH with non-negativity
**Finding.** Classic Gray-Allan assumes mutually uncorrelated noise; here an arousal or posture shift
moves the whole body and perturbs all three sites at once → partial common-mode → naive TCH throws
**negative variances** (its textbook failure).
**Change.** Use the **generalized/correlated three-cornered hat** (Premoli & Tavella 1993; Ekström &
Koppang 2006): estimate the full 3×3 difference-covariance, solve with a non-negativity constraint
(KKT / bounded least-squares), and report the correlation term you had to assume. Optionally emit an
**Allan-deviation-vs-averaging-time (τ)** curve per sensor (τ = 5, 10, 20, 40 min) so a reader sees *at
which timescales* each sensor is trustworthy — this dovetails with ECGDex's existing `hrvStability` slope.
**Done when:** on the reference night no σ² is negative; the estimator degrades gracefully (see §4).

## §3 — consume it: inverse-variance fusion weight + outlier attribution
**Change.** Extend `fuseHRVConsensus` (do not fork it):
- **Weight** the reconciled RMSSD/HR by inverse TCH variance `w_i ∝ 1/σ²_i` instead of a plain
  median/mean, so a noisy node contributes less to the single fused value.
- **Attribute** the outlier: when `divergencePct` trips the existing `>30 → 'divergent'` flag, name the
  node with the largest σ² as the probable cause in `note` (e.g. *"divergence driven by PpgDex, σ²≈…;
  ECGDex/OxyDex mutually consistent"*), rather than only reporting the spread.
**Done when:** the existing divergence flag still fires identically, but now carries a `culprit` field +
per-node `sigma2`; the fused RMSSD moves toward the two agreeing nodes on the reference night.

## §4 — honesty, gating, and graceful degrade
- **Precision, not trueness.** TCH measures noise/instability, not bias — say so in the finding's caveat.
  A bias shared by all three is invisible to it. (Fine here: the RMSSD-inflation problem *is* excess
  variance, which is exactly what TCH isolates.)
- **PTT is not constant** (tracks BP), so a slice of the wrist/finger differential is real physiology
  attributed as peripheral "noise" — note it; do not over-claim OxyDex/PpgDex are "worse."
- **Needs 3 overlapping cardiac nodes.** With only 2 (or non-overlapping windows) TCH is undefined →
  fall back to today's pairwise `fuseHRVConsensus` behavior, BYTE-IDENTICAL. TCH is strictly additive.
- **Evidence badge:** the new surfaced metric ships an **experimental** badge via `MetricRegistry`
  (COVERAGE MANDATE — every surfaced number is badged; `.ev-corner` on the finding card). Register the
  grade in the Integrator's registry; do not invent a global grade.

## §5 — surface (render)
One **HRV-consensus finding card** upgrade (reuse the existing card, inline-SVG idiom): a small per-sensor
σ bar (three bars, lowest = most trusted) + the τ-curve sparkline, the `culprit` call-out, and the honest
caveat line. No new view. Old 2-node inputs render the existing card unchanged.

## Gates & re-bundle (mandatory — touches `integrator-dsp.js` behavior)
1. Add `integrator-tch.js` (pure, DOM-free — unit-tested in BOTH runners), wire into `integrator-dsp.js`
   `fuseHRVConsensus`/`computeFusion`; update `Integrator.src.html` to load it; **re-bundle `Integrator.html`**.
2. Let the build settle, RE-READ the new `manifestHash`, hand-update Integrator's entry in
   `BUILD-MANIFEST.json` (GATE A hard-fails on stale).
3. If a committed Integrator fixture's OUTPUT moves, **regenerate it** (re-run on committed inputs +
   re-export, never hand-edit) and re-record `{manifestHash, inputHashes, outputHash}` in
   `FIXTURE-PROVENANCE.json`.
4. Add a `tests/dex-tests.js` group for `integrator-tch.js`: known-answer TCH on a synthetic triplet with
   injected per-sensor noise (recovers the injected σ² within tolerance), a negative-variance case (the
   generalized solver stays non-negative), and the <3-node degrade (identical to pairwise). Green in
   `run-tests.mjs` + `Dex-Test-Suite.html?full`.
5. `verify-provenance.html` GATE A + GATE B green (`__provenanceOK===true`). Stamp `Status: DONE — <date>`
   only once both gates are re-confirmed. Spawn a `-FOLLOWUPS-` brief for what surfaces (the correlated-term
   estimation choice, the τ-grid), or note "nothing surfaced".

## Scope guard
Integrator-only, additive — must NOT re-ingest raw streams (§0 of the build brief), must NOT touch the
node DSPs, the shared `parseTimestamp` (Clock Contract mirror), or the Ganglior event schema. Degrade to
the existing pairwise consensus whenever <3 cardiac nodes overlap. `BUS` stays a single constant.
