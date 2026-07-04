<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-03 (§3 code landed + headless-green; re-bundle + full gates remain. §1/§2 still PROPOSED) · **Created:** 2026-07-03 · **Executed-residue-of:** `INTEGRATOR-THREE-CORNERED-HAT-2026-07-02-BRIEF.md` (DONE 2026-07-03) · **Extends:** `INTEGRATOR-BUILD-BRIEF.md` §4.4 `fuseHRVConsensus` · **Links:** `PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-2026-07-02-BRIEF.md` (ACC co-motion ρ source) · an OxyDex per-epoch-HR node-export brief (TBD)

# Integrator three-cornered-hat — follow-ups (external-ρ · real-night firing · τ-curve)

> **One-line:** The TCH estimator + §1/§3/§5 wiring landed and gated (parent **DONE 2026-07-03**:
> `Dex-Test-Suite.html?full` all-green incl. TCH 17/17 + wiring 9/9 + Integrator render-coverage 9/9;
> `verify-provenance` GATE A/B clean, Integrator `manifestHash ca7b872a68e8`). Three deferred items
> remain — all **ADDITIVE** and all currently blocked on **upstream node-export data**, not on the
> estimator: (§1) a consumer-side common-mode ρ estimate, (§2) making TCH actually *fire* on a real
> night, (§3) the per-sensor Allan-deviation τ-curve sparkline.

---

## 0. Status recap — what already shipped (do NOT redo)
- **`integrator-tch.js`** — pure Gray–Allan: classic + external-ρ correlated solve + auto min-ρ
  non-negativity search; `inverseVarianceWeights`, `culprit`, `alignTriplet`, graceful degrade.
  `window.IntegratorTCH`. **Gated 17/17.**
- **§1** — `adaptEnvelopeNode` lifts `timeseries.epochs[]` → `rec.series.hrvEpochs` (additive,
  null-tolerant). **§3** — `fuseHRVConsensus._tchConsensus` attaches
  `block.tch{sigma2,sigma,weights,culprit,rho,method,coMotion}` + `block.tchStatus` +
  inverse-variance `block.rmssd.weightedMean` + a culprit call-out in `note`; degrades to
  `tch=null`/pairwise with <3 series-bearing nodes. **Gated 9/9.**
- **§5** — `integrator-render.js` per-sensor σ-bar card (noisiest-first, culprit flagged ▲, reconciled
  RMSSD, **experimental** `tch_error` badge). Render-coverage green.
- **Key:** the estimator's `opts.rho` path is **built + gated** (test 5c case 2). What is missing is
  the **consumer** computing a real ρ to pass in — see §1.

---

## §1 — external-ρ consumer-side estimate (parent finding §1)
**Problem.** Positive common-mode correlation biases classic TCH **without driving any variance
negative**, so the auto min-ρ fallback (which only fires on the negative-variance failure mode) can't
catch it. Demonstrated in the parent: injected per-sensor `{1, 16, 16}` read back as
`{7.05, 3.83, 4.21}`. To remove positive common-mode the **consumer must pass an external ρ** (`opts.rho`).

**Blocker (why it's deferred, not just unfinished).** A cross-node common-mode ρ needs a per-epoch
**motion** series correlated across **≥2 of the triplet's nodes**. Today only **PpgDex emits per-epoch
`motionIndex`**; ECGDex/OxyDex carry *posture*, not a per-epoch motion series. So ρ cannot be honestly
estimated yet — estimating it from one node's motion alone would be circular.

**Forward hook (already in place).** Each rec carries per-node `coMotion`, and `block.tch` surfaces it.
When ≥2 nodes carry an alignable per-epoch motion series, estimate ρ from their cross-correlation and
pass it as `opts.rho`; the natural source is the **ACC co-motion coefficient** from the PpgDex motion
gate (`PPGDEX-BEAT-DETECTION-PERF-AND-HRV-FIDELITY-2026-07-02-BRIEF.md`).

**Done when.** With ≥2 motion-bearing nodes, `_tchConsensus` derives ρ from cross-node motion and passes
`opts.rho`; a known-answer test recovers a planted positive common-mode (injected `{1,16,16}` within
tolerance, *not* `{7,3.8,4.2}`); degrades to classic (`rho:null`) with <2 motion series. Additive —
pairwise + the <3-node degrade stay byte-identical.

## §2 — make TCH *fire* on a real night (parent finding §3 — upstream node-export prerequisite)
**Problem.** The reference night can't exercise real TCH: OxyDex's export carries **no per-epoch HR
series** (no `timeseries` block), and only ECG+PPG carry an epoch HRV series — so **both** triplets lack
a 3rd series-bearing node and real-night TCH correctly degrades to pairwise. (Triplet membership is
metric-specific — HR-hat = ECG+PPG+**Oxy**; RMSSD-hat = ECG+PPG+**(HRVDex|PulseDex)** — parent finding §2.)

**This is NOT an Integrator fix** — the Integrator is export-only (`INTEGRATOR-BUILD-BRIEF.md` §0) and
`adaptEnvelopeNode` already lifts `timeseries.epochs[]` the moment a node provides it. The prerequisite is
upstream:
- **OxyDex** must emit a per-epoch pulse-HR series (`timeseries.epochs[].hr`) → the HR triplet gets its
  3rd node. Spin this into its **own OxyDex node-export brief** (fixture-moving; OxyDex's ritual).
- **and/or** a 3rd HRV-bearing node (HRVDex or PulseDex) overlaps the night → the RMSSD triplet gets its
  3rd node.

**Done when.** A committed reference night has ≥3 series-bearing cardiac nodes for ≥1 triplet; real-night
TCH fires (`block.tch` non-null, `tchStatus:ok`), names a culprit, and the fused RMSSD moves toward the
two agreeing nodes — captured as the **first code-gated Integrator fixture** (today's two are historical
byte-pinned; a firing-TCH export would carry a `manifestHash + inputHashes + outputHash` GATE-B triple).

## §3 — per-sensor Allan-deviation τ-curve sparkline (parent §2/§5)
**⏳ IN-PROGRESS (2026-07-03) — code landed + headless-green; re-bundle + full gates remain.**
- `integrator-tch.js` (VERSION→1.1.0): pure `allanDeviation(series,taus)` (overlapping Allan
  variance/deviation of one evenly-spaced series) + `allanTriplet(A,B,C,{taus,labels})` (per-sensor
  Allan variance via the classic Gray–Allan split on the pairwise-difference AVARs — truth cancels in
  the differences; non-negativity clamp-to-0, consistent with the σ-bar path). On `window.IntegratorTCH`.
- `integrator-dsp.js` `_tchConsensus`: attaches `block.tch.allan { taus:[1,2,4,8], tausMin (=m×median
  epoch-min), adev:{node:[…]}, epochMin, n }`. Additive; only when TCH fires → export-inert on the
  reference night (which degrades to pairwise).
- `integrator-render.js`: inline-SVG τ sparkline in `tchBars` (one node-coloured polyline per sensor,
  shared y-scale, "lower = steadier") + CSS.
- `tests/dex-tests.js` (both runners): known-answer `allanDeviation` (constant→0, ramp→c²/2,
  alternating→2a², too-short→null) + `allanTriplet` recovery ({4,9,25} at τ1, averages-down) +
  τ-curve wiring. **Headless: TCH 28/28 + wiring 11/11 — 1635 passed / 0 fail.**
- **REMAINING (resume here):** re-bundle `Integrator.html` (inliner on `Integrator.src.html`) → settle
  → re-read `manifestHash` → update `BUILD-MANIFEST.json` GATE A (GATE B unaffected — Integrator
  fixtures are historical) → `Dex-Test-Suite.html?full` all-green + `verify-provenance` clean → flip
  this §3 to DONE + add a BUILD-MANIFEST note + sync DOCS-INDEX. §1/§2 remain PROPOSED.

The parent proposed an optional **Allan-deviation-vs-averaging-time** curve per sensor (τ = 5, 10, 20,
40 min) so a reader sees *at which timescales* each sensor is trustworthy (dovetails ECGDex's
`hrvStability` slope). §5 shipped the σ bars + culprit + reconciled RMSSD but **not** the τ sparkline.

**Done when.** `integrator-tch.js` exposes a pure `allanDeviation(series, taus)` (known-answer gated);
`tchBars` renders a small inline-SVG τ sparkline per sensor with the experimental badge; degrades
cleanly when a series is too short for the larger τ. Render + pure-helper only → Integrator re-bundle +
`manifestHash` re-record (export-inert; Integrator fixtures stay historical unless §2's firing-TCH
fixture lands first).

---

## Ordering & dependency
§1 and §3 are Integrator-local and additive; §2 lives in **OxyDex**, not here, and is the gating
prerequisite for §1 to have real multi-node motion/HR to work on (and for a firing-TCH fixture).
Recommended: **§3** (self-contained render polish) → **§2** (OxyDex per-epoch-HR export, separate brief)
→ **§1** (needs §2's data before ρ estimation has anything to estimate from).

## Gates (per item)
- **Integrator-local (§1, §3):** re-bundle `Integrator.html`; after the build **settles**, RE-READ the
  new `manifestHash` and hand-update `BUILD-MANIFEST.json` (GATE A); add a `tests/dex-tests.js`
  known-answer + wiring group in **both** runners; `Dex-Test-Suite.html?full` all-green +
  `verify-provenance` GATE A/B clean.
- **§2 (OxyDex):** follows OxyDex's node-export ritual — the emit shape moves, so **regenerate +
  re-record** the OxyDex fixtures (`{manifestHash, inputHashes, outputHash}`), expect the OxyDex equiv
  leg to red until regenerated (GATE C working). A firing-TCH Integrator fixture then becomes GATE-B
  code-gated.

## Scope guard
Integrator-only + additive for §1/§3; §2 is explicitly an **upstream OxyDex** node-export change (do it
as an OxyDex brief). Must NOT re-ingest raw streams (`INTEGRATOR-BUILD-BRIEF.md` §0), touch the shared
`parseTimestamp` (Clock Contract mirror), or the Ganglior event schema / `fascia` alias. Degrade to the
existing pairwise consensus whenever <3 cardiac nodes overlap.
