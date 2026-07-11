<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-07 (§1 premise VALIDATED 2026-07-06; **end-to-end A/B through the Integrator's OWN `threeCorneredHat` — with a DEMONSTRATED RESCUE**. On real user-provided node exports for 2026-07-06 (all three: ECGDex+PpgDex+OxyDex), the canonical run lands in the **quiet-order / negative-variance** regime (H10↔OxyDex r=0.90); classic drives the smoothed OxyDex σ to a pathological **0.03 bpm**, and a **real measured co-motion ρ=0.655** (Verity↔OxyDex `motionIndex`) **rescues it to 1.02 bpm** — first end-to-end evidence that a motion-derived ρ corrects the quiet-order under-estimate the reference-free path can't. See `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md` §5–§6. Mechanism ✓ + rescue ✓ on one night; a distribution/reference-anchored magnitude check wants more trio nights. **2026-07-10: the ad-hoc §5/§6 runs are now a COMMITTED reproducible harness — `tools/tch-multinight.mjs`** (multi-night classic-vs-motion-ρ A/B through the shipped `IntegratorTCH` kernel; `--selftest` reproduces the §6 rescue as a deterministic known-answer distribution across 6 synthetic nights [30/30 checks green], `--dir` ingests real trio node-export triples via the identical path). The real multi-night distribution is now **data-gated, not code-gated** — it needs more nights' three node-export JSONs committed. §4 N-cornered EEGDex-blocked.) · **Created:** 2026-07-06 · **Executed-residue-of:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-II-2026-07-04-BRIEF.md` (DONE 2026-07-06) · **Extends:** `INTEGRATOR-BUILD-BRIEF.md` §4.4 `fuseHRVConsensus`

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
> recovered divergence vs classic. **PARTLY EXECUTED 2026-07-07 (write-up §5):** the A/B was run through the
Integrator's OWN `threeCorneredHat` on the committed 5-night trio (30-s epoch-binned) — the shipped fusion
code reproduces classic σ recovery + the 06-13 negative-variance regime, closing the "never run through the
Integrator's own code" gap. But a FIXED external ρ=0.44 does NOT reduce divergence — it over-subtracts (Σσ²
rises on every solvable night; the solve fails on the highest-agreement night), empirically confirming the ρ
must be PER-NIGHT motion-derived (`_tchRhoFromMotion`), not a constant. **STILL OWED:** the per-night-motion-ρ
verdict needs committed per-node motion (O2Ring `Motion` is committed; H10/Verity accel are not).
**UPDATE 2026-07-07 (write-up §6):** a **faithful per-night motion-ρ run** was executed end-to-end through the
shipped `threeCorneredHat` on real user-provided node exports for **2026-07-06**. **First pass** (raw O2Ring
`Motion` ↔ Verity `motionIndex`, r=0.585→ρ=0.585) was a positive-variance night — σ merely un-biased upward.
**Canonical run** (all three node exports — ECGDex+PpgDex+**OxyDex**, using both node `motionIndex`) landed in the
**quiet-order / negative-variance** regime (H10↔OxyDex r=0.90): classic drove the smoothed OxyDex σ to a
pathological **0.03 bpm**, and the **real measured co-motion ρ=0.655** (Verity↔OxyDex) **RESCUED it to 1.02 bpm**
— the first end-to-end evidence on real data that a motion-derived ρ corrects the quiet-order under-estimate the
reference-free path cannot (the `_tchRhoFromMotion` design intent). **Mechanism ✓ + rescue ✓.** (My earlier
"over-subtracts" reading was analytically WRONG — classic UNDER-estimates under positive common-mode; ρ un-biases
upward.) **Still open:** a distribution + reference-anchored magnitude check — more trio nights (each just the
three tiny node-export JSONs, as here); no raw-ACC ingest needed.

`_tchRhoFromMotion` is a **proxy** (co-motion correlation stands in for the shared motion-driven noise the
reference-free estimator can't recover), validated only synthetically by the golden. **Blocked on a real
co-recorded O2Ring + Polar H10 + Verity Sense night** (the repo holds none — the equiv fixtures are different
nights/durations). When one is captured: confirm the motion-derived ρ actually *reduces* cross-device HR
divergence vs classic; confirm OxyDex `motionIndex` (O2Ring accel count) and PpgDex `motionIndex` (optical
index) genuinely co-vary positively under real co-motion (different scales — correlation is scale-invariant,
but verify not anti-/un-correlated by construction); consider z-scoring per-node motion before correlating and
a minimum aligned-motion overlap `n` before trusting ρ. **Validation write-up (`papers/` or `docs/`), not a gate.**

**UPDATE 2026-07-10 — reproducible multi-night harness landed (`tools/tch-multinight.mjs`).** The §5/§6
runs were ad-hoc on off-repo files; they are now a committed, deterministic Node tool that runs the
classic-vs-per-night-motion-ρ A/B across N nights through the shipped `IntegratorTCH` kernel (mirroring
`_tchRhoFromMotion`). `--selftest` reproduces the §6 rescue as a **known-answer distribution** on a
planted-correlation synthetic corpus (6 nights, both regimes, 30/30 checks green: culprit = planted-loudest
every night; culprit σ within ×1.6/×2 of planted; the 3 quiet-order nights drive classic OxyDex σ ≈0 and
the motion-ρ rescues it; median culprit σ 3.06 ≈ the real corpus's 2.8). `--dir <path>` ingests real trio
node-export triples (the §6 input contract) via the identical path. So the **remaining owed work is DATA,
not code** — commit ≥~5 more nights' three node-export JSONs and `--dir` prints the real distribution. A
subtlety surfaced (docs §7): the mean-of-all-pairs ρ dilutes when only one pair is tightly coupled, so a
coupled-pair-weighted ρ is a candidate `_tchRhoFromMotion` refinement if the real distribution confirms it.
Write-up: `docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md` §7.

**UPDATE 2026-07-11 — literature-anchored magnitude check PASSES (docs §8).** The reference-anchored leg now
has a second, independent anchor beyond committed trio nights: published wearable-HR validation vs gold-standard
ECG. Our reference-free σ̂ (Verity 2.8 / O2Ring 1.4 / H10 0.9 bpm) matches both the **ranking** (H10 = the
criterion device → most accurate; arm/finger PPG next) and the **order of magnitude** (Polar Verity Sense
upper-arm MAE 1.43 bpm → σ-equiv ≈1.8 via σ=MAE·√(π/2); Schweizer & Gilgen-Ammann 2025, JMIR Cardio
`10.2196/67110`). MAE≠σ and it's a single external anchor, so this does NOT retire the committed-trio
distribution — but it confirms 2.8 bpm is a physically plausible arm-PPG σ. Details + citations in docs §8.

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
