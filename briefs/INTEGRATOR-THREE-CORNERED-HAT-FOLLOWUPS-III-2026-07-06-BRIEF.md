<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-06 (§1 premise VALIDATED on real data — see `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md`; end-to-end ρ-vs-classic + §4 N-cornered still blocked) · **Created:** 2026-07-06 · **Executed-residue-of:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-II-2026-07-04-BRIEF.md` (DONE 2026-07-06) · **Extends:** `INTEGRATOR-BUILD-BRIEF.md` §4.4 `fuseHRVConsensus`

# Integrator three-cornered-hat — follow-ups III (real-data validation · N-cornered generalization)

> **One-line:** FU-I and FU-II are DONE. **FU-III STATUS (2026-07-06): §1 premise VALIDATED on real data**
> (a real tri-device O2Ring+H10+Verity corpus arrived and was processed — write-up
> `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md`); the §1 **end-to-end ρ-vs-classic A/B** through the
> Integrator is the one remaining owed piece. §2/§3 are LOW optional golden polish. §4 (N-cornered) stays
> blocked on EEGDex / a ≥4-sensor capture. The HR-hat + external-ρ + wall-clock alignment + τ-curve + quiet-
> order caveat all shipped and gated in FU-I/II, pinned by the code-gated golden
> (`uploads/integrator_tch_golden.node-export.json`, `cef329a4fec6`).

## 0. State recap — what shipped (do NOT redo)
- **HR-hat** (ECG+PPG+Oxy) + **external-ρ from cross-node motion** (`_tchHat`/`_tchRhoFromMotion`, FU-I §1/§2).
- **Absolute-wall-clock alignment** (`_epKey`, FU-II §1 — the correctness keystone; staggered-start gate `5f`).
- **τ-curve Allan-deviation sparkline** (FU-I §3) + **`block.tchHR` render card** (FU-II §3).
- **Quiet-sensor order caveat** (`quietOrderUncertain`/`quietSensors`, FU-II §5, gate `5g`).
- **The golden** (FU-II §2): three deterministic staggered node-exports rebuilt in-code → real
  `adaptEnvelopeNode`+`fuseHRVConsensus` → deep-diffed by the `equivalence gate` in both runners; GATE-B
  code-gated. Generator harness `_diag/tch-golden-gen.html`.

---

## §1 — real-data ρ validation (FU-II §4) — ◐ PREMISE VALIDATED 2026-07-06
> **EXECUTED (premise leg) — write-up `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md`.** A real
> co-recorded O2Ring + Polar H10 + Verity Sense corpus (20 trio-eligible nights 2026-06-10’07-05) was
> processed through `sensor-trio-power-analysis.html` (production `PPGDSP` Verity corner + the same TCH
> kernel). Confirmed on real data: (a) reference-free per-device σ̂ recovers (Verity ≈2.8, O2Ring ≈1.4, H10
> ≈0.9 bpm median over 10 clean nights); (b) the **quiet-sensor-order** regime (H10↔O2 rHO ≈0.85–0.92 → the
> quieter σ goes negative on 3/10 nights) — real-data confirmation of FU-II §5; (c) the **motion premise** of
> `_tchRhoFromMotion`: O2Ring↔H10 accel co-vary r=0.44, and cross-device HR divergence tracks motion (r=0.60;
> still 0.24 → motion 1.39 bpm). **REMAINING (still owed):** the end-to-end A/B — run these nights' node
> exports through the Integrator's own `_tchHat`/`fuseHRVConsensus` with ρ on vs off and confirm ρ *reduces*
> recovered divergence vs classic (the premise is validated; the Integrator-path comparison is not yet run).

`_tchRhoFromMotion` is a **proxy** (co-motion correlation stands in for the shared motion-driven noise the
reference-free estimator can't recover), validated only synthetically by the golden. **Blocked on a real
co-recorded O2Ring + Polar H10 + Verity Sense night** (the repo holds none — the equiv fixtures are different
nights/durations). When one is captured: confirm the motion-derived ρ actually *reduces* cross-device HR
divergence vs classic; confirm OxyDex `motionIndex` (O2Ring accel count) and PpgDex `motionIndex` (optical
index) genuinely co-vary positively under real co-motion (different scales — correlation is scale-invariant,
but verify not anti-/un-correlated by construction); consider z-scoring per-node motion before correlating and
a minimum aligned-motion overlap `n` before trusting ρ. **Validation write-up (`papers/` or `docs/`), not a gate.**

## §2 — a real-signal (not in-code) golden variant, once a synth raw-ECG generator exists 🟢 (LOW)
The §2 golden rebuilds its three inputs **in-code** (the `cpapdex_synthetic_golden` precedent) — deliberately, so
it gates on Integrator code alone. The heavier "run each node's real `compute()` on co-recorded raw streams"
path (FU-II §2 Approach B) was NOT taken because (a) no synthetic **raw-ECG** generator exists (`synth-gen.js`
emits RR/PPG/O2Ring, not 130 Hz ECG µV) and (b) a ≥60-min 176 Hz PPG set is tens of MB. If a synth raw-ECG
generator lands (or a real co-recorded night arrives, cf §1), a SECOND golden produced by three real node
computes would additionally pin the node→Integrator seam end-to-end. Optional; the in-code golden already closes
the "fusion has no code-gated fixture" hole.

## §3 — a classic-solve (ρ-null) golden leg for σ² magnitude recovery 🟢 (LOW)
The committed golden's `correlated-external` solve (ρ=0.356) recovers the culprit ORDER (OxyDex noisiest) but
**compresses** the σ² magnitudes (planted {1, 4.8, 20} → recovered {7.2, 11.6, 12.5}) — inherent to the
common-mode subtraction. A second in-code golden with **uncorrelated** motion (→ ρ null → classic solve) would
pin the near-exact magnitude recovery {≈1, ≈4.8, ≈20} as a complementary reference. Cheap, additive, Integrator-
local — but low value (the estimator's magnitude recovery is already unit-gated by `5e`/`5f`). Do only if a
magnitude-pinned golden is wanted.

## §4 — N-cornered hat (3 → N sensors), from FU-I §4 [blocked] 🟡
The estimator is fixed at THREE sensors (classic Gray–Allan closed form). **Blocked on** a real ≥4-sensor
co-recording (a 2nd PPG site / a second Verity / a Muse S PPG channel) AND, for the EEGDex corner, on **EEGDex
shipping** (`EEGDEX-BUILD-BRIEF.md`). When unblocked: add a sibling `nCorneredHat(seriesList, opts)` (least-
squares over all pairwise AVARs → per-sensor σ² + inverse-var weights + culprit + a covariance-ρ matrix;
Ekström–Koppang / Premoli–Tavella), have `_tchHat` pick the estimator by sensor count, keep the N=3 closed form
byte-identical. Additive. (Verbatim from FU-I §4 — recorded here so it survives FU-I's DONE stamp.)

---

## Ordering & dependency
**Updated 2026-07-06:** §1's **premise leg is DONE** (real corpus validated the motion-driven-divergence +
quiet-order regime + σ recovery — see the docs write-up). What's left: §1's **end-to-end ρ-vs-classic A/B**
(runnable NOW — feed the 10 clean nights' node exports through `fuseHRVConsensus` with ρ on/off; no longer
blocked); §2 + §3 are LOW optional polish on the already-gated golden; §4 (N-cornered) remains blocked on
EEGDex / a ≥4-sensor co-recording. Flip this brief to DONE once the §1 A/B lands (or is consciously dropped)
and §4 is either executed or explicitly re-deferred.

## Scope guard
Integrator-local + additive when eventually executed. Must NOT touch the shared `parseTimestamp` (Clock-Contract
parser), the Ganglior event schema / `fascia` alias, or re-ingest raw streams (`INTEGRATOR-BUILD-BRIEF.md` §0).
Keep the N=3 path (and the committed golden) byte-identical; any deliberate fusion-shape change REQUIRES
regenerating `uploads/integrator_tch_golden.node-export.json` + re-recording its GATE-B triple.
