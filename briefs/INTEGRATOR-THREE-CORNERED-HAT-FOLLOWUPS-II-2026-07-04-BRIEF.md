<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-06 (**§1 + §3 + §5 DONE — 2026-07-05**; **§2 golden DONE — 2026-07-06**: `uploads/integrator_tch_golden.node-export.json` is the FIRST code-gated Integrator fixture — three staggered (+0/+5/+10 min) synthetic node-exports rebuilt IN-CODE → real `adaptEnvelopeNode` + `fuseHRVConsensus` → HR-hat fires [n=22, culprit OxyDex, ρ=0.356 from cross-node motion → correlated-external, reconciled HR 58.4 bpm], deep-diffed by the `equivalence gate` group in BOTH runners + GATE-B code-gated @ `cef329a4fec6`; both gates green [`Dex-Test-Suite?full` 2102 passed / 0 boot-skips · `verify-provenance` A/B clean]. **§4 real-data-ρ DEFERRED** — blocked on a real co-recorded O2Ring+H10+Verity night the repo doesn't hold; the golden validates the ρ-from-motion mechanism synthetically. Follow-up: `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md`) · **Created:** 2026-07-04 · **Executed-residue-of:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-2026-07-03-BRIEF.md` (§1/§2 code landed 2026-07-04) · **Extends:** `INTEGRATOR-BUILD-BRIEF.md` §4.4 `fuseHRVConsensus` · **Links:** `OXYDEX-PER-EPOCH-HR-EXPORT-2026-07-04-BRIEF.md` (DONE)

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
> **✅ DONE — 2026-07-05.** Fix landed tighter than the proposal below (the epochs ALREADY carried a
> floating `tMs` from `adaptEnvelopeNode`, so step-1 stamping was already done). Added `_epKey(e)` in
> `integrator-dsp.js` — the absolute 5-min wall-clock grid key `Math.round(e.tMs/300000)*5` when `tMs` is
> present, node-relative `e.tMin` fallback when `t0Ms` is unknown — and routed the four alignment/motion
> helpers (`_rmssdPts`, `_hrPts`, `_meanMotion`, `_tchAlignedMotion`) through it; `alignTriplet` +
> `r.levels` unchanged (they key on the pts objects' field, now the abs-grid key). **Same-start nights are
> byte-identical** (one shared `t0Ms` → the same monotonic key-shift on every node → the intersection
> membership/order, hence every σ²/weight/level, is unchanged — 5c/5d/5e stayed green, incl. the rmssd
> hat + `<3`-node degrade). New known-answer group **`5f`** (`Integrator TCH aligns on absolute
> wall-clock (staggered starts)`) plants ONE shared latent HR sampled by three nodes started +0/+15/+30
> min apart with per-sensor σ {1,2,5}: with the fix it recovers σ²(Oxy)=22.8 (planted 25), overlap n≈90,
> culprit OxyDex — the OLD `tMin` alignment would blow σ² into the hundreds (the assertions gate exactly
> that). Re-bundled `Integrator.html` (`62da4f43db2a → 6ce40baeb8d3`, GATE-A re-recorded; the 2 Integrator
> fixtures are `historical` → GATE B untouched) **and** `OverDex.html` (non-provenance orchestrator, also
> inlines `integrator-dsp.js`). Gates: `verify-provenance` GATE A/B green (`__provenanceOK` true);
> `Dex-Test-Suite.html` headless floor all-green incl. 5f. **Caveat (not this change):** the `?full`
> render-coverage shows OxyDex `21/22` on the *pre-existing* `computed numeric output reaches the DOM — 14
> numeric tokens` assertion (`minNums:15`, 5s async wait) — the flake CLAUDE.md §3 documents by name.
> OxyDex.html is provenance-identical to the earlier all-green run (`43bd047b12e8`), so this is a
> harness-timing brittleness independent of §1, not a regression; left for the owner (retuning
> `minNums`/`waitMs` is out of this brief's scope).

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
> **✅ DONE — 2026-07-06 (Approach A — the `cpapdex_synthetic_golden` precedent, owner-selected).** Instead of
> generating heavy raw streams for three real node computes (a ≥60-min 176 Hz PPG + a synthetic raw-ECG
> generator that doesn't exist), the golden is built the way CPAPDex's is: the `equivalence gate` group
> (`tests/dex-tests.js`, both runners) rebuilds THREE deterministic `ganglior.node-export`s (ECGDex+PpgDex+OxyDex)
> IN-CODE (seeded mulberry32; `_tchGoldenInputs()`), each carrying overlapping `timeseries.epochs[]` `{hr,motionIndex}`
> on **staggered** wall-clock starts (+0/+5/+10 min — so the golden actually exercises §1's absolute-grid alignment,
> as this section requires), adapts + fuses them through the REAL `adaptEnvelopeNode` + `fuseHRVConsensus`, and
> deep-diffs the WHOLE consensus against the committed `uploads/integrator_tch_golden.node-export.json`
> (reusing the group's `diff`/`EXCL`). Result: HR-hat fires (n=22), names culprit **OxyDex** (planted σ=4.5, the
> noisiest), derives **ρ=0.356** from cross-node motion (→ `correlated-external` solve), reconciles HR to **58.4 bpm**,
> and carries the §3 τ-sparkline `allan` block + §5 quiet-order caveat. Inputs rebuilt in-code (`inputHashes:{}` in
> `FIXTURE-PROVENANCE.json`) so the golden is a PURE function of INTEGRATOR code — an OxyDex/ECGDex/PpgDex DSP change
> cannot move it. Generator harness: `_diag/tch-golden-gen.html` (byte-identical builder). Gates: `Dex-Test-Suite?full`
> all-green (2102 passed, 0 boot-skips) · `verify-provenance` GATE A/B clean (the fixture reads `code-gated ·
> reproducible ✓ @ cef329a4fec6`). NO Integrator re-bundle (test + fixture + ledger only; `manifestHash` unchanged).
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
> **✅ DONE — 2026-07-05.** Generalized the three TCH render helpers (`tchBars`/`tchNote`/`tchTauSpark`)
> to take a `which` arg (default → RMSSD hat = **byte-identical** to the shipped card) and added a parallel
> **HR-hat card** (`Per-sensor HR error (TCH)`, units **bpm**, noisiest-first σ-bars, culprit ▲, reconciled
> HR line, `experimental` `tch_error` badge, common-mode ρ + method in the note, shared τ-sparkline), pushed
> right after the RMSSD card whenever `block.tchHR` is present. Added a positive **render-coverage** assertion
> to the Integrator rig in `Dex-Test-Suite.html` (a synthetic 3-node HR triplet, std {1,2,4}, is fused →
> `tchHR` fires → the DOM shows “Per-sensor HR error” + “Reconciled HR … bpm” — 3/3 green). Re-bundled
> `Integrator.html` (`6ce40baeb8d3 → 4dc0af834bb7`, GATE-A re-recorded; fixtures historical → GATE B
> untouched; OverDex does not inline `integrator-render.js`). Gates: `verify-provenance` GATE A/B green;
> `Dex-Test-Suite.html?full` **all-green, 2089 passed, bootSkips [] — and OxyDex render-coverage cleared to
> 22/22**, confirming the §1-run’s “14 numeric tokens” red was the documented nondeterministic flake, not a
> regression.

## §3 — surface `block.tchHR` in `integrator-render.js` (parent §5, not done)
The HR-hat payload (`block.tchHR` σ-bars, `hrReconciled`, culprit ▲, `rho` + `method`, the `allan`
τ-sparkline) is EMITTED but NOT rendered. Mirror the existing rmssd σ-bar card for the HR-hat (units
**bpm**, noisiest-first, culprit flagged, an `experimental` badge, show ρ + its source when
`method==='correlated-external'`). Render-only → Integrator re-bundle + `manifestHash` re-record
(export-inert; Integrator fixtures stay historical). Add a render-coverage assertion.

## §4 — real-data ρ validation + motion-semantics comparability
> **⏸ DEFERRED — 2026-07-06 (blocked, no code).** This is validation, not a gate, and it needs a **real**
> co-recorded O2Ring+H10+Verity night — which the repo does not hold (the equiv inputs are different
> nights/durations; SIGNAL-ADAPTER never captured a tri-device simultaneity). The §2 golden validates the
> ρ-from-motion **mechanism** synthetically (ρ=0.356 recovered, order-preserving); confirming it actually
> *reduces* cross-device HR divergence on a real night, plus the OxyDex↔PpgDex `motionIndex` scale-comparability
> check (z-score before correlating, min aligned-motion overlap n), waits on a real capture. Carried to
> `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md` as a blocked item.
`_tchRhoFromMotion` is a **proxy** (co-motion correlation stands in for the shared motion-driven noise
correlation the reference-free estimator can't recover), gated only synthetically. Validate on a real
co-recorded night: does the motion-derived ρ actually *reduce* cross-device HR divergence vs classic?
Also confirm **motion comparability**: OxyDex `motionIndex` (O2Ring accelerometer count) and PpgDex
`motionIndex` (optical motion index) are different scales — correlation is scale-invariant so the ρ
estimate is fine, but verify the two genuinely **co-vary positively** under real co-motion (not anti- or
un-correlated by construction). Consider z-scoring per-node motion before correlating, and requiring a
minimum aligned-motion overlap (n) before trusting ρ. Validation, not new gate.

## §5 — document the HR-hat recovery-precision LIMIT (consumer guidance)
> **✅ DONE — 2026-07-05.** `_tchHat` now attaches `quietOrderUncertain` (bool) + `quietSensors` (the two
> non-culprit nodes) to every hat block: TRUE when the two quietest σ² sit within a ×2 factor — the
> reference-free regime where sampling noise dominates the quiet split, so “both low, order uncertain.” A
> flag, NOT a change to the estimate. `integrator-render.js` `tchNote` appends the caveat (“Trust the
> culprit and its σ²; the two quieter sensors (…) are both low and their relative order is uncertain”).
> Known-answer group **`5g`**: two quiet sensors planted IDENTICAL (σ=2) + a loud culprit (σ=6) → recovered
> quiet σ² ≈ equal → caveat fires (robust, order-independent; 3/3 green). Re-bundled `Integrator.html`
> (`4dc0af834bb7 → cef329a4fec6`, GATE-A re-recorded; fixtures historical → GATE B untouched) + `OverDex.html`
> (inlines `integrator-dsp.js`). Gates: `verify-provenance` GATE A/B green; `Dex-Test-Suite.html?full`
> deterministic floor + all my groups green. **✅ OxyDex render-coverage flake FIXED 2026-07-05 (harness-only, no re-bundle):** the `computed numeric output reaches the DOM` assertion had a real defect — it re-tokenized an EARLY `txt` snapshot with `/\d[\d.,:]*/g` (which merges each `HH:MM:SS` clock token into one), so it undercounted vs the settle-gate's `_numTokens` and flaked 14-vs-15 on OxyDex whenever the dashboard rendered clock times (the CLAUDE.md §3 "14 numeric tokens" flake — a tokenizer mismatch, NOT timing or a borderline `minNums`). Fixed in `Dex-Test-Suite.html` to use `_numTokens(doc)` (the same tokenizer as the gate, read live) → OxyDex now reads 515 tokens, 22/22, `?full` all-green (2099 passed). Bar unchanged (`minNums:15`); a genuinely under-rendering bundle still times out at the gate.

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
