<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-13 · **Executed-residue-of:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md` (DONE 2026-07-13) · **Extends:** `INTEGRATOR-BUILD-BRIEF.md` §4.4 `fuseHRVConsensus` · **Evidence:** `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md` §11

# Integrator three-cornered-hat — follow-ups IV (coupled-pair-weighted ρ · carried polish · N-cornered)

> **One-line.** FU-III is DONE: its §1 owed leg landed (the real 17-night distribution + magnitude check, docs
> §11), and it produced **one actionable finding** — `_tchRhoFromMotion`'s mean-of-pairwise ρ is **diluted
> exactly in the quiet-order shape it exists to rescue**, which is why 3 of 7 quiet-order nights were left with a
> quiet corner pinned at σ ≈ 0. §1 below is that fix, now *indicated* by real data rather than hypothesized.
> §2 (LOW golden polish) and §3 (N-cornered, still blocked) are carried from FU-III so they survive its DONE stamp.

## 0. State recap — what FU-III settled (do NOT redo)
- The **distribution + reference-anchored magnitude check** — 17/17 nights solve; median σ ECGDex **0.95** /
  OxyDex **1.19** / PpgDex **1.85** bpm; ranking preserved; the Verity corner sits on the independent literature
  anchor (≈1.8, docs §8). **This is done. Do not re-run it as if it were open.**
- The **rescue mechanism** — real, reproduced on 4 of 7 quiet-order nights, incl. the §6 night (OxyDex σ
  0.04 → 1.00 bpm).
- **No HR-only estimator escapes the quiet-order ambiguity** (docs §10 bake-off: GCOV ≡ classic at N=3; GCOV/NNLS
  merely *relocate* which quiet corner is driven to ≈0). **Only external ρ recovers both quiet corners.** So the
  external ρ's *quality* is the binding constraint — which is precisely what §1 attacks.

---

## §1 — coupled-pair-weighted `_tchRhoFromMotion` 🔴 (the payload; INDICATED by real data)
**The finding (docs §11).** On every **rescued** night the measured ρ_motion (0.64–0.90) exceeded the ρ the
geometry needs; on every **failed** night it fell short (0.04–0.39 vs a required 0.59–0.69). When the supplied ρ
is too small to yield a non-negative solve, `threeCorneredHat` (`integrator-tch.js:275`) **falls through** the
`correlated-external` branch into the auto `correlated` min-ρ search — which is **boundary-seeking by
construction** (it returns the *smallest* ρ restoring non-negativity), so it pins the quiet corner's σ at the
≈0.0x boundary. **The kernel is not the bug** (it behaves as designed and flags the night via
`quietOrderUncertain`); the **ρ estimate feeding it** is too small.

**Why it is systematically too small.** `_tchRhoFromMotion` aggregates the **mean of the positive pairwise motion
correlations**. The quiet-order shape is *one tightly-coupled pair* (e.g. H10↔OxyDex r≈0.9) against two loose ones
(≈0.4) — so the mean **dilutes** the very signal the rescue depends on. FU-III §6 got a strong rescue partly *by
accident*: H10 motion was unavailable, so ρ came from the single coupled Verity↔OxyDex pair. This is FU-III §7's
hypothesis, now **confirmed on real nights**.

**The work.**
1. Replace the mean-of-positive-pairs aggregation with a **coupled-pair-weighted** ρ (weight each pairwise ρ by
   its own magnitude / couple-strength, or take the max-coupled pair, or solve per-pair) in `_tchRhoFromMotion`
   (`integrator-dsp.js`). Consider z-scoring per-node motion before correlating, and require a minimum aligned
   overlap `n` before trusting ρ (both were flagged as open in FU-III §1 and are still unaddressed).
2. **Acceptance = the three failed nights.** 2026-06-24 (needs 0.69, got 0.04) · 2026-06-29 (needs 0.39, applied
   but too small) · 2026-07-05 (needs 0.59, got 0.37) must rescue — the quiet corner lifting clearly off the ≈0
   boundary — **without disturbing the 4 already-rescued nights or the 10 positive-variance ones** (the §5
   invariant: ρ must not *lower* Σσ²). `node tools/tch-multinight.mjs --dir uploads/trio` prints the whole
   before/after in one command; `--selftest` (30/30) must stay green.
3. **Watch for over-correction.** A weighted ρ is strictly ≥ the mean, so it can push a *positive-variance* night
   into over-subtraction. The bound to respect is the geometry's own: the ρ that makes the solve non-negative is a
   *floor*, not a target — an aggregation that always returns ≈0.9 would "rescue" everything and mean nothing.
4. **Consider surfacing the fall-through.** When a consumer supplies `opts.rho` and the kernel silently falls
   through to the auto branch, the caller can only detect it by comparing `method` (`'correlated'` vs
   `'correlated-external'`). An explicit `externalRhoRejected: true` (additive, back-compat) would make the
   under-rescue legible instead of inferable. Cheap; decide during §1.

**Gate cost.** This CHANGES fusion output → `uploads/integrator_tch_golden.node-export.json` must be regenerated
and its GATE-B triple re-recorded (`_diag/tch-golden-gen.html`), the Integrator re-bundled, and
`Dex-Test-Suite.html?full` + `verify-provenance.html` re-run. Per §📦 this is a **MINOR** (the estimator's
recovered values move; no contract shape changes) and needs a changeset. Serialize against other bundle work.

## §2 — carried golden polish from FU-III §2/§3 🟢 (LOW — optional, unchanged)
Both are **verbatim carries**, re-deferred at FU-III's DONE stamp, still LOW:
- **A real-signal golden variant** (FU-III §2) — a second golden produced by three *real* node `compute()` runs on
  co-recorded raw streams, pinning the node→Integrator seam end-to-end. Still blocked on a synthetic **raw-ECG**
  generator (`synth-gen.js` emits RR/PPG/O2Ring, not 130 Hz ECG µV). *Note: the 17 committed trio nights are
  node-**exports**, not raw streams, so they do not unblock this.*
- **A classic-solve (ρ-null) golden leg** (FU-III §3) — pins near-exact σ² magnitude recovery as a complement to
  the committed `correlated-external` golden, whose common-mode subtraction compresses magnitudes. Cheap, additive,
  low value (already unit-gated by `5e`/`5f`). Do only if a magnitude-pinned golden is wanted.

## §3 — N-cornered hat (3 → N sensors) 🟡 [STILL BLOCKED — carried verbatim from FU-III §4 / FU-I §4]
Unchanged and **not** executed: the estimator is fixed at THREE sensors (classic Gray–Allan closed form).
**Blocked on** a real **≥4-sensor co-recording** (a 2nd PPG site / a second Verity / a Muse S PPG channel) AND, for
the EEGDex corner, on **EEGDex shipping** (`EEGDEX-BUILD-BRIEF.md`). When unblocked: add a sibling
`nCorneredHat(seriesList, opts)` (least-squares over all pairwise AVARs → per-sensor σ² + inverse-var weights +
culprit + a covariance-ρ matrix; Ekström–Koppang / Premoli–Tavella), have `_tchHat` pick the estimator by sensor
count, keep the N=3 closed form byte-identical. Additive. **This is also where the ML-TCH / least-squares-AVAR
path lands** (docs §10): its advantages — non-negativity by construction, per-estimate uncertainties — only
materialize under **over-determination** (N≥4), which is exactly why the N=3 bake-off returned a clean negative.
*Recorded here so it survives FU-III's DONE stamp, exactly as it survived FU-I's.*

## §4 — two artifact nights, handed to the artifact gate 🟡 (small, cross-brief)
Docs §11 surfaced two nights whose recovered σ is not physiologically credible: **2026-06-12** → σ[ECGDex] =
**8.64 bpm** (the H10 is the *criterion* device — an 8.6 bpm chest-strap σ is not a sensor property) and the
uncommitted **2026-07-04** → σ[PpgDex] = **10.5 bpm**. Both most likely reflect an **alignment or beat-detection
failure on one corner**, not a noisy sensor. They are the intended prey of the cross-corner consensus gate in
`TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md` — **hand them over as two known positives** to test that
gate against. Do NOT hand-exclude them from the corpus here; a gate that cannot catch them is the actual finding.

## §5 — commit the remaining trio nights? 🟢 (owner decision, 5 min)
Seven further trio night-dirs exist on the capture host but are **uncommitted** (`2026-06-20`, `07-04`, `07-07`,
`07-08`, `07-09`, `07-11`, `07-12`). Committing them takes the reproducible corpus **17 → 24 nights** (the 24-night
superset gives 24/24 solve, medians 0.79/1.08/2.20 bpm — the same story, tighter). They are tiny JSONs, and the
privacy posture already permits node-exports (17 are committed). **Owner call**, not an agent's: they were not
created by this work-unit.

---

## Ordering & dependency
**§1 is the only substantive item** and is unblocked *now* (the corpus, the harness, and the acceptance nights all
exist). §4 is a hand-off, not work. §5 is a 5-minute owner decision that makes §1's acceptance stronger. §2 is
optional polish; §3 stays blocked on hardware + EEGDex. Flip this brief to DONE once §1 lands (or is consciously
dropped) and §3 is either executed or — again — explicitly re-deferred.

## Scope guard
Integrator-local. Must NOT touch the shared `parseTimestamp` (Clock-Contract parser), the Ganglior event schema /
`fascia` alias, or re-ingest raw streams (`INTEGRATOR-BUILD-BRIEF.md` §0). §1 deliberately changes fusion output,
so it REQUIRES regenerating `uploads/integrator_tch_golden.node-export.json` + re-recording its GATE-B triple; the
N=3 *kernel* (`integrator-tch.js` `threeCorneredHat`) should stay byte-identical — the fix belongs in
`_tchRhoFromMotion` (`integrator-dsp.js`), i.e. in the ρ **estimate**, not the solver.
