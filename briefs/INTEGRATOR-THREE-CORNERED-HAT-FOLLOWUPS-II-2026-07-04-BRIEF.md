<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED — 2026-07-04 · **Created:** 2026-07-04 · **Executed-residue-of:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-2026-07-03-BRIEF.md` (§1/§2 code landed 2026-07-04) · **Extends:** `INTEGRATOR-BUILD-BRIEF.md` §4.4 `fuseHRVConsensus` · **Links:** `OXYDEX-PER-EPOCH-HR-EXPORT-2026-07-04-BRIEF.md` (DONE)

# Integrator three-cornered-hat — follow-ups II (alignment · golden · render · ρ-validation)

> **One-line:** The HR-hat (§2) + external-ρ-from-motion (§1) shipped and are headless + provenance
> gated by a synthetic `5e` known-answer group. FIVE items surfaced *during that execution* and still
> need addressing — **§1 is a genuine CORRECTNESS gap** (cross-node epoch alignment); the rest are
> completeness/hardening/validation.

## 0. State recap — what landed 2026-07-04 (do NOT redo)
- **OxyDex** emits a TOP-LEVEL `timeseries.epochs[]` `{tMin, hr(median), motionIndex(mean)}` 5-min series
  (`OXYDEX-PER-EPOCH-HR-EXPORT-2026-07-04-BRIEF.md`, DONE; export-inert; OxyDex `4d3b2194d942`).
- **`integrator-dsp.js`**: `_tchConsensus`→`_tchHat(like, ptsFn, metric)`; `fuseHRVConsensus` attaches
  `block.tchHR` (HR-hat over ECG+PPG+**Oxy**, unioning overlapping hr-bearing non-HRV nodes) +
  `block.hrReconciled` + culprit + note; `_tchRhoFromMotion` derives ρ from cross-node per-epoch motion
  (mean positive pairwise Pearson, clamp [0,0.9]; degrade to classic <2 motion series). Integrator
  `62da4f43db2a`. `block.tch`/`tchStatus` (rmssd hat) + the <3-node degrade are **byte-unchanged**.
- Gate: `tests/dex-tests.js` group **5e** (`Integrator HR-hat + external-ρ from motion (FU §1/§2)`).

---

## §1 (⚠ HIGHEST — CORRECTNESS) — cross-node epoch alignment keys on NODE-RELATIVE `tMin`, not absolute wall-clock
**Problem.** `adaptEnvelopeNode` carries each epoch's **node-relative** `tMin` (minutes from *that node's*
`t0Ms`), and `IntegratorTCH.alignTriplet` keys on `tMin`. So ECG `tMin=5` is paired with PPG `tMin=5` and
Oxy `tMin=5` — but those are the same *offset*, **not the same wall-clock instant**. Co-recorded devices
start minutes apart (O2Ring vs Polar H10 vs Verity Sense), so a shared `tMin` maps to a *different*
absolute time per node. For HR/RMSSD that vary minute-to-minute, this misalignment inflates every
pairwise-difference variance → **biases all TCH σ² upward and can mis-rank the culprit**. It is
**pre-existing** (the rmssd hat shares the exact alignment path), but the HR-hat + the "fire on a real
co-recorded night" goal make it acute — and it contradicts the **Clock Contract**, whose entire purpose
is floating wall-clock `tMs` for cross-node sync. (Today's `5e` test hides it: all synthetic nodes share
one `t0Ms`, so node-relative `tMin` *happens* to equal the absolute grid.)

**Fix (proposed).**
1. `adaptEnvelopeNode` — stamp each lifted epoch with an absolute floating `tMs = rec.t0Ms + tMin*60000`
   (in `series.hrvEpochs[]`, alongside `tMin`), null when `t0Ms` is unknown.
2. TCH alignment — key on a **quantized absolute wall-clock bin** (round `tMs` to the 5-min grid) instead
   of node-relative `tMin`. When two nodes' 5-min bin boundaries are offset (start times not multiples of
   5 min apart), use nearest-neighbour-within-tolerance (≤½ epoch) matching, or re-bin onto one shared
   grid. Apply to BOTH `_rmssdPts`/`_hrPts` alignment paths (one shared change).
3. Degrade to the current node-relative behaviour only when a node carries no `t0Ms`.

**Done when.** A known-answer test with **staggered** node start times (e.g. ECG 23:00, PPG 23:03,
Oxy 23:06 on one shared latent HR) recovers the planted σ² (today it would NOT — the offset injects
false divergence); same-start nights stay byte-identical; Clock-Contract viewer-TZ-independence holds
(align on `getUTC*`-derived `tMs`, never local getters).

## §2 — the committed reference-night golden = the FIRST code-gated Integrator fixture (from FU-I §2 "Done when")
FU-I §2 wants real-night TCH captured as the first code-gated Integrator fixture (today's two Integrator
fusions are `historical:true`, byte-pinned only). Build a **co-recorded** night from the seeded synth
generator (`synth-gen.js` / `dex-patient-gen.js` — one subject, every device on the same floating
wall-clock), run each node's headless `compute()` → three `ganglior.node-export`s carrying overlapping
`timeseries.epochs[]` → fuse via the Integrator → `block.tchHR.ok`, a named culprit, a reconciled HR that
moves toward the two agreeing nodes. Commit the three input exports + the fusion output and record the
GATE-B triple (`{manifestHash, inputHashes, outputHash}`) in `FIXTURE-PROVENANCE.json`; add an
equiv/golden test that re-runs the fusion on the committed inputs and deep-diffs the `tchHR` block
(volatile-stripped). **Order after §1** (or the golden with same-start inputs will *mask* the alignment
bug); prefer **staggered** starts so the golden actually exercises §1's fix.

## §3 — surface `block.tchHR` in `integrator-render.js` (parent §5, not done)
The HR-hat payload (`block.tchHR` σ-bars, `hrReconciled`, culprit ▲, `rho` + `method`, the `allan`
τ-sparkline) is EMITTED but NOT rendered. Mirror the existing rmssd σ-bar card for the HR-hat (units
**bpm**, noisiest-first, culprit flagged, an `experimental` badge, show ρ + its source when
`method==='correlated-external'`). Render-only → Integrator re-bundle + `manifestHash` re-record
(export-inert; Integrator fixtures stay historical). Add a render-coverage assertion.

## §4 — real-data ρ validation + motion-semantics comparability
`_tchRhoFromMotion` is a **proxy** (co-motion correlation stands in for the shared motion-driven noise
correlation the reference-free estimator can't recover), gated only synthetically. Validate on a real
co-recorded night: does the motion-derived ρ actually *reduce* cross-device HR divergence vs classic?
Also confirm **motion comparability**: OxyDex `motionIndex` (O2Ring accelerometer count) and PpgDex
`motionIndex` (optical motion index) are different scales — correlation is scale-invariant so the ρ
estimate is fine, but verify the two genuinely **co-vary positively** under real co-motion (not anti- or
un-correlated by construction). Consider z-scoring per-node motion before correlating, and requiring a
minimum aligned-motion overlap (n) before trusting ρ. Validation, not new gate.

## §5 — document the HR-hat recovery-precision LIMIT (consumer guidance)
`5e` (planted per-sensor σ² `{1,4,16}`) recovered the **dominant** error well (16 → 15.4) but the two
**quiet** sensors were poorly determined and mis-ordered (`{1,4}` → `{4.7,2.2}`). This is inherent to
reference-free TCH: the quiet sensors' pairwise-difference variance is small, so sampling noise
dominates their split. Surface it as a caveat on the block/note ("trust the culprit + its σ²; the two
quieter sensors are 'both low, order uncertain'") and consider a confidence flag when the top-two σ² sit
within a factor (say ×2). Documentation + a small flag, not a numeric change to the estimator.

---

## Ordering & dependency
**§1 (alignment) is the correctness keystone — land it FIRST**, and before/with the §2 golden so the
golden exercises the fix (staggered starts). §3 (render) and §5 (caveat) are independent + cheap. §4 is
validation, not code. §1 + §2 together finally satisfy FU-I §2's "real night" intent honestly.

## Gates (per item)
- **Integrator-local (§1, §3, §5):** re-bundle `Integrator.html`; after the build **settles**, RE-READ the
  new `manifestHash` and hand-update `BUILD-MANIFEST.json` (GATE A); add known-answer + wiring assertions
  in `tests/dex-tests.js` (both runners); `Dex-Test-Suite.html?full` all-green + `verify-provenance`
  GATE A/B clean. (Integrator fixtures are historical → GATE B unaffected by §1/§3/§5.)
- **§2 (golden):** commit the 3 input node-exports + the fusion output; record the GATE-B triple in
  `FIXTURE-PROVENANCE.json`; add the equiv/golden diff test. This makes the Integrator's first
  code-gated fixture (GATE-C reproducibility surface).
- **§4:** validation write-up (a `papers/` or `docs/` note), no gate.

## Scope guard
Integrator-local + additive. Must NOT touch the shared `parseTimestamp` (Clock-Contract parser), the
Ganglior event schema / `fascia` alias, or re-ingest raw streams (`INTEGRATOR-BUILD-BRIEF.md` §0).
Degrade to the current node-relative alignment only when a node lacks `t0Ms`. Keep `block.tch` (rmssd
hat) + the <3-node pairwise degrade **byte-identical**. The alignment change (§1) is shared by both hats
— verify the rmssd hat's existing tests + the `5d` wiring group stay green.
