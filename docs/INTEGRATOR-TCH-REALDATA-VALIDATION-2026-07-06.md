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
- ◑ **"ρ actually *reduces* cross-device HR divergence vs classic"** — the **premise is validated** AND the
  end-to-end A/B has now been **run through the Integrator's own `threeCorneredHat`** on the committed trio
  (§5). Result is nuanced: classic recovery + the quiet-order negative-variance regime both reproduce through
  the shipped code, but a **fixed** external ρ does **not** reduce divergence — it over-subtracts. The
  ρ-reduces-divergence verdict therefore requires the **per-night motion-derived** ρ (`_tchRhoFromMotion`),
  which needs committed per-node motion (still owed — §5).
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

## 5. Integrator-path A/B (2026-07-07) — classic vs external-ρ through the shipped TCH
Ran the committed trio's per-node HR series through the Integrator's OWN `integrator-tch.js`
(`threeCorneredHat` / `screenTriplet`, v1.2.0) — not the analysis-tool kernel — with **ρ off (classic)** vs a
**fixed external ρ = 0.44** (the premise's measured O2↔H10 co-motion r). Inputs: the committed
`h10-ecg-derived` / `verity-ppg-derived` / O2Ring pulse series per night, median-binned to a common **30-s
epoch grid** (their native cadences differ, 1–16 s), intersected on shared epochs. σ order = **H10 / Verity /
O2Ring** (bpm, epoch-HR).

| night | ~h | r HV/HO/VO | classic method | classic σ | Σσ² | ρ=0.44 σ | Σσ² |
|---|---|---|---|---|---|---|---|
| 06-11 | 5.9 | 0.53/0.83/0.54 | classic | 1.43/2.45/1.04 | 9.1 | 0.16/2.90/1.83 | 11.8 |
| 06-12 | 7.3 | 0.27/0.85/0.24 | classic | 1.50/3.70/1.19 | 17.4 | 0.96/4.33/2.13 | 24.2 |
| 06-13 | 7.0 | 0.39/0.50/0.75 | correlated **(NEG)** | 7.63/0.06/2.46 | 64.2 | 7.91/0.76/2.68 | 70.3 |
| 06-15 | 3.2 | 0.79/0.81/0.87 | classic | 1.30/0.72/0.57 | 2.5 | 1.55/0.15/0.98 | 3.4 |
| 06-16 | 6.9 | 0.81/0.87/0.90 | classic | 1.89/1.33/0.50 | 5.6 | *solve failed → classic* | 5.6 |

**Findings.**
1. **The shipped Integrator TCH runs end-to-end on real committed data** across 5 nights — the fusion code path
   itself (not only `sensor-trio-power-analysis`'s kernel) is now exercised on the real trio. This closes the
   "never run through the Integrator's own code" gap.
2. **Classic recovers plausible per-device σ**, and **06-13 reproduces the negative-variance failure mode**
   (classic goes negative → the auto min-ρ `correlated` branch engages) — the quiet-order regime confirmed
   through the shipped code, not just the analysis tool.
3. **A FIXED external ρ = 0.44 raises recovered σ on every solvable night** (+30 % 06-11, +39 % 06-12, +36 %
   06-15) and its solve **fails on the highest-agreement night** (06-16, r ≥ 0.81) → falls back to classic.
   **Interpretation (corrected):** a σ *rise* is the analytically **expected, correct direction** — the model
   `V_ij = s_i²+s_j² − 2ρ·s_i·s_j` means positive common-mode makes **classic UNDER-estimate** σ (shared noise
   cancels in pairwise differences), so any ρ > 0 un-biases σ *upward*. So the earlier framing "over-subtracts
   / makes it worse" was wrong: raising σ is what the correction is *for*. What a fixed global ρ gets wrong is
   the **magnitude** and **applying it uniformly** (incl. nights with little real co-motion) — that is what
   `_tchRhoFromMotion`'s **per-night** ρ fixes.
4. **The "ρ reduces divergence" claim targets the negative-variance / quiet-order nights** (e.g. 06-13), where
   classic *fails* (goes negative) and the fallback inflates — there an external ρ can give a cleaner, more
   accurate σ than the auto min-ρ clamp. On positive-variance nights (06-11/12/15/16) ρ merely un-biases σ
   upward, so those nights neither confirm nor refute "reduces divergence" — only the direction (up) is checkable
   reference-free.
5. **Caveat — epoch binning.** The committed derived series are at mixed native cadences (1–16 s), so a common
   30-s epoch grid was used; binning smooths beat-to-beat noise, lowering absolute σ and **attenuating** the
   negative-variance regime relative to the per-second premise (§1–§2). The A/B *comparison* (classic vs ρ) is
   unaffected by this; only the absolute magnitudes are.

**Still owed (verdict-blocking).** A faithful "ρ reduces divergence" test needs each night's **per-node motion**
series to compute `_tchRhoFromMotion(that night)` — O2Ring `Motion` is committed, but H10/Verity accel are not,
so the per-night motion ρ can't be reconstructed from committed data here. The verdict stays **owed**, now with
the tested caution that a global ρ must not stand in for it. Re-run this A/B once co-recorded per-node motion is
committed (or emit the nights' full node-exports incl. `motionIndex` and feed `fuseHRVConsensus`).

## 6. Faithful per-night motion-ρ run through the Integrator (2026-07-07) — real node exports
The **owed** leg — a per-night ρ derived from **real per-node motion** and fed to the Integrator's own solver.
Inputs (user-provided, single night **2026-07-06**, ~6.7 h): `ECGDex_2026-07-06_2243_summary.json` (H10) +
`PpgDex_2026-07-06_2243_summary.json` (Verity) `timeseries.epochs[]` (5-min `hr`; Verity also `motionIndex`) +
`O2Ring …_20260706224137.csv` (per-second `Pulse` + `Motion`). Aligned on absolute 5-min epochs (81 shared).

- **Per-node motion ρ** (`_tchRhoFromMotion`): both node-computed `motionIndex` series — **Verity `motionIndex`
  ↔ OxyDex `motionIndex`** — Pearson **r = 0.655** → external **ρ = 0.655** (real co-motion). HR-corr
  H10/Verity/OxyDex = 0.40 / **0.90** / 0.36 — the H10↔OxyDex pair is very tight (the O2Ring pulse is
  internally smoothed → the **quiet-sensor-order** setup).
- **classic** [auto `correlated`, **negative-variance**]: σ H10/Verity/OxyDex = **0.95 / 6.21 / 0.03** — the
  reference-free path drives the quieter (OxyDex) σ to a **pathological ≈ 0**, the quiet-order artifact.
- **external ρ = 0.655** [`correlated-external`]: σ = **1.21 / 6.83 / 1.02** — the measured motion ρ **rescues
  OxyDex σ from 0.03 → 1.02 bpm**, a physically-plausible value the reference-free solve cannot recover.

**Reading — the rescue the verdict needed.** Feeding all three canonical node exports (OxyDex HR as the O2Ring
corner) puts 07-06 squarely in the **quiet-order / negative-variance** regime (H10↔OxyDex r = 0.90). There the
reference-free auto-ρ leaves the smoothed O2Ring corner at σ ≈ 0.03 bpm — physically impossible (O2Ring pulse
is not noiseless). A **real measured co-motion ρ = 0.655** (Verity↔OxyDex `motionIndex`) lifts it to ≈ 1.0 bpm.
This is the first **end-to-end evidence on real data** that a motion-derived ρ **corrects the quiet-order
under-estimate the Integrator's own reference-free path cannot** — exactly the `_tchRhoFromMotion` design intent.
**Status: mechanism ✓ AND a demonstrated rescue on a real negative-variance night** (OxyDex σ 0.03 → 1.02).
Still single-subject / single-night — a distribution + a reference-anchored magnitude check want more trio
nights (each just needs the three tiny node-export JSONs, as here).

*(First pass, before the OxyDex export arrived, used the raw O2Ring `Motion` column vs Verity `motionIndex`:
r = 0.585 → ρ = 0.585, a **positive-variance** night [classic σ 1.22/5.95/0.99 → 1.67/6.90/1.78], showing only
the un-biasing direction. The canonical OxyDex-`motionIndex` run above supersedes it.)*

## Cross-references
- `briefs/INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md` §1 (this executes its premise leg).
- `sensor-trio-power-analysis.html` / `sensor-trio-worker.js` (the real-data arm + production PPGDSP corner).
- `papers/sensor-trio-nights.html` (the power/sample-size preprint this real corpus feeds).
- Integrator TCH: `integrator-dsp.js` `_tchHat` / `_tchRhoFromMotion` / `fuseHRVConsensus`.
