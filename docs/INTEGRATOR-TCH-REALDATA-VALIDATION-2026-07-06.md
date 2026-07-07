<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living validation note) · **Created:** 2026-07-06 · **last-verified:** 2026-07-06
· **Executes:** `briefs/INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md` §1 (real-data ρ validation)

# Three-cornered-hat — real-data validation (Integrator TCH · ρ-from-motion · reference-free σ)

**One-line.** The Integrator's reference-free per-sensor HR-error σ (`_tchHat`) and its motion-derived ρ
(`_tchRhoFromMotion`) were validated **only synthetically** (the FU-II code-gated golden). This note records
the **first real-data validation**, on a genuine co-recorded **O2Ring + Polar H10 + Verity Sense** corpus —
the input FU-III §1 was blocked on. It is a validation write-up, **not a gate** (per the brief).

## 1. Data & method
- **Corpus:** one subject, nightly tri-device sleep recordings **2026-06-10 → 2026-07-05**. Devices: O2Ring
  (finger SpO₂/pulse, 1 Hz), Polar **H10** `H10-01` (chest ECG + device HR + 3-axis ACC), Polar **Verity
  Sense** `VERITY-01` (wrist raw PPG @ ~135 Hz + ACC). **20 nights are trio-eligible** (before 06-10 the Verity
  was not in service). The Verity `_HR.txt` stream is **all-zero** — the armband emits raw PPG only, so its HR
  corner is derived by PpgDex, not read from the device.
- **Tool:** `sensor-trio-power-analysis.html` (real-data arm). Per night, on the absolute floating-ms grid
  (Clock Contract): O2Ring native pulse · H10 device HR · **Verity HR via the production `PPGDSP`** (parsePPG →
  3-LED consensus systolic feet → `buildPPI` → Malik `correctRR`), then the **same TCH kernel** as the σ method
  (`σ²_A = ½(V_AB+V_AC−V_BC)` cyclically), with a per-window block-bootstrap CI. All local, one night per
  worker lane. A **quality gate** excludes a night whose Verity σ̂ > 12 bpm AND decorrelates from both other
  corners (rHV,rVO < 0.4) — failed PPG extraction (lost contact), not a real device σ.

## 2. Results (10 clean nights solved; 5 quality-excluded, 5 short-overlap, 1 no-Verity)
- **Reference-free σ̂ recovers on real data**, per device (median over solved nights):
  Verity (PPG) ≈ **2.8 bpm** (range 1.9–4.0) · O2Ring ≈ **1.4 bpm** (0.9–2.4) · H10 (ECG) ≈ **0.9 bpm**
  (0.7–1.1, on nights it resolves positive). Verity lands **below** the paper's planted 6.2 — expected: the
  SQI-gated production detector is cleaner than the earlier estimate.
- **Quiet-sensor-order regime — CONFIRMED on real data (FU-II §5).** H10↔O2 correlate at **rHO ≈ 0.85–0.92**
  every night (they track the same slow sleeping HR almost co-linearly), so their pairwise-difference variance
  is tiny and the hat drives the quieter of the two **negative** on **3/10 nights** (H10 σ returns null). This
  is exactly the `quietOrderUncertain` caveat the estimator already flags — the culprit (noisiest = Verity) is
  trustworthy; the two quiet corners' order is not. One night (06-12) inverts (H10 σ̂ ≈ 9.5, rHO 0.43) — a
  genuinely noisy chest-strap night, correctly surfaced.
- **Motion premise of ρ-from-motion — CONFIRMED (06-16 pilot, ~2.9 h tri-device overlap).**
  Two independent body accelerometers **co-vary positively**: O2Ring finger-motion ↔ H10 chest-accel SD,
  **Pearson r = 0.44** (30 s epochs) — motion is genuinely shared across devices, not anti-/un-correlated by
  construction. And **cross-device HR divergence tracks motion**: |ECG−Oxy| HR difference vs motion,
  **r = 0.60**; low-motion epochs agree to **0.24 bpm**, high-motion epochs diverge to **1.39 bpm (~6×)**.
  That shared, motion-driven divergence is precisely the correlated error `_tchRhoFromMotion` estimates a ρ for.

## 3. Verdict against the brief's asks
- ✓ **OxyDex vs PpgDex-side motion co-vary positively under real co-motion** — confirmed (via the O2Ring/H10
  accelerometer pair; positive, scale-invariant).
- ✓ **Motion drives cross-device HR divergence** — confirmed (r = 0.60; still 0.24 → motion 1.39 bpm). This is
  the physical premise that a motion-derived ρ is capturing real shared noise, not an artifact.
- ◐ **"ρ actually *reduces* cross-device HR divergence vs classic"** — the **premise is validated**, but the
  end-to-end A/B (run these real node-exports through the Integrator's own `_tchHat`/`fuseHRVConsensus` with ρ
  on vs off, per night, and compare recovered σ) has **not** been run yet. That is the remaining step (below).
- Method notes adopted per the brief: a **minimum aligned overlap** of ≥1000 s is enforced before a night is
  trusted; **z-scoring** per-node motion before correlating and using the **node-computed** `motionIndex`
  (rather than raw accel SD) would sharpen the O2Ring↔PPG co-variation figure — recommended for the follow-up.

## 4. Limitations & remaining work
- **Single subject; N = 10 clean nights.** A distribution, not a population estimate.
- **Motion co-variation** was quantified on one pilot night (06-16); extend to all trio nights.
- **End-to-end ρ-vs-classic** through the Integrator is the open piece — it needs each night's three node
  exports fed to `fuseHRVConsensus` with ρ on/off. Cheapest route: emit the 10 nights' node exports and run the
  existing `_diag/tch-golden-gen.html`-style harness on real inputs. (Tracked back in FU-III §1.)
- Verity PPG quality is **night-dependent** (5 nights auto-excluded for poor contact) — an honest capture
  finding, not a method failure.

## Cross-references
- `briefs/INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md` §1 (this executes its premise leg).
- `sensor-trio-power-analysis.html` / `sensor-trio-worker.js` (the real-data arm + production PPGDSP corner).
- `papers/sensor-trio-nights.html` (the power/sample-size preprint this real corpus feeds).
- Integrator TCH: `integrator-dsp.js` `_tchHat` / `_tchRhoFromMotion` / `fuseHRVConsensus`.
