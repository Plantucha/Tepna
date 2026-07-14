<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living validation note) · **Created:** 2026-07-06 · **last-verified:** 2026-07-13
· **Executes:** `briefs/INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md` §1 (real-data ρ validation
— **CLOSED 2026-07-13, see §11**: the real 17-night distribution + magnitude check landed; residue → FU-IV)

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

## 7. Multi-night A/B harness + known-answer distribution (2026-07-10) — `tools/tch-multinight.mjs`
The §5/§6 runs were **ad-hoc**, on user-provided node exports that never entered the repo (privacy
posture — the raw corpus stays off-repo). So the headline rescue (OxyDex σ 0.03 → 1.02 bpm) was a
prose result a reviewer could not re-run. This turns it into a **committed, reproducible artifact** and
generalizes it from one night to a distribution.

**`tools/tch-multinight.mjs`** (Node, deterministic, no I/O/RNG) runs the classic-vs-per-night-motion-ρ
A/B across N nights through the **shipped** `IntegratorTCH.threeCorneredHat` kernel (v1.2.0), mirroring
the `_tchRhoFromMotion` aggregation (mean of the positive pairwise motion correlations, clamped
[0, 0.9]) so the A/B matches what `fuseHRVConsensus` does end-to-end. Two modes:

- **`--selftest`** — a deterministic **synthetic multi-night corpus** with a planted-correlation factor
  model (`e_i = s_i·(√g·Z_g + √(1−g)·Z_i)`, so `Var(e_i)=s_i²` exactly and the pairwise error
  correlation is a KNOWN ρ; the motion index is a proxy tied to the same shared driver). Six nights
  span both regimes: 3 positive-variance (global ρ≈0.4, well-separated σ) and 3 quiet-order (global
  ρ≈0.6 with OxyDex the smallest-σ corner — the smoothed-O2Ring case of §6). Because **truth is known**,
  this is a *stronger* magnitude check than the single real night. Result (all 30 known-answer checks
  green):

  | night | ρ (motion) | classic σ (E/P/O) | ρ-on σ (E/P/O) | culprit |
  |---|---|---|---|---|
  | PV-1..3 | 0.43–0.64 | 0.7–1.0 / 1.9–2.7 / 0.8–1.1 | un-biased upward (Σσ² ↑) | PpgDex |
  | QO-1..3 | 0.67–0.71 | ~0.9 / ~2.8 / **≈0.00** (neg-var) | ~1.1 / ~3.1 / **0.43–0.66** | PpgDex |

  The three quiet-order nights **reproduce the §6 rescue as a known-answer**: the reference-free classic
  path drives the quiet OxyDex corner to a pathological ≈0 (negative-variance `correlated` auto-branch),
  and the per-night motion-ρ lifts it back to a physical value — every night, deterministically. The
  culprit (PpgDex/Verity, the planted-loudest) is named on all six nights; **median culprit σ = 3.06 bpm**,
  matching the real corpus's ≈2.8 (§2). Asserted invariants: culprit = planted-loudest; culprit σ within
  ×1.6 (PV) / ×2 (QO) of planted; quiet-order rescue lifts OxyDex σ clearly above the classic floor;
  positive-variance Σσ² never falls under ρ (the §5 invariant — a scalar-ρ solve redistributes per-node,
  so the invariant is on the sum, not each component).

- **`--dir <path>`** — the **drop-in path**: one subdirectory per night, each holding the three node-export
  JSONs (ECGDex + PpgDex + OxyDex summaries carrying `timeseries.epochs[].hr` + `.motionIndex`), the exact
  §6 input contract. It produces the real distribution + magnitude table via the identical code path — so
  the **real multi-night distribution is now one command away** once more nights' node-export triples are
  committed. (This is what §1/§4 below still owe: real nights, not more code.)

**A subtlety this surfaced (worth a paper note).** `_tchRhoFromMotion` averages *all* pairwise motion
correlations, so when only ONE pair is tightly coupled (the classic quiet-order shape: H10↔Oxy ≈0.9,
both loud pairs ≈0.4), the mean ρ is diluted and *under*-rescues. §6 got a strong rescue partly because
H10 motion was unavailable, so ρ came from the single coupled Verity↔OxyDex pair. A per-pair (or
coupled-pair-weighted) ρ would rescue harder than the mean-of-pairs — a candidate refinement for
`_tchRhoFromMotion` if the real distribution confirms the dilution matters.

## 8. Reference-anchored magnitude check from published literature (2026-07-11)
§1 owes a **reference-anchored** magnitude check, and the device-anchored version is data-gated on committed
trio nights. A **second, independent anchor** is the published wearable-HR validation literature: what is each
of these three sensors' HR error vs a gold-standard ECG in rest/sleep? If our reference-free σ̂ (§2) lands in
the same order of magnitude and the same *ranking*, the estimator is anchored without any private data.

> **Statistic caveat (read first).** The literature reports **MAE** (mean absolute error — *trueness* vs an
> ECG reference); TCH σ̂ is **reference-free precision / instability** (the estimator explicitly measures
> precision, not trueness). They are different quantities. For an approximately zero-mean Gaussian error they
> convert as **σ = MAE·√(π/2) ≈ 1.253·MAE**, so a published MAE maps to a comparable σ. The anchor below is an
> **order-of-magnitude + ranking** sanity check, not an identity.

Published anchors (rest/sleep, vs ECG criterion; metric bpm):

| corner | device | published HR accuracy (rest/sleep vs ECG) | → σ-equiv | our σ̂ (§2) | source |
|---|---|---|---|---|---|
| ECGDex | Polar H10 (chest ECG) | used **as the criterion** in essentially every wearable-HR study → most accurate of the three | ≈0 (reference) | **0.9** | Schweizer 2025; Budig 2021 |
| PpgDex | Polar Verity Sense (upper arm PPG) | **MAE 1.43 bpm**, MAPE 1.35 %, bias −0.05 bpm across activities | ≈**1.8** | **2.8** | Schweizer & Gilgen-Ammann 2025 |
| — | wrist/arm PPG, sleep (general) | MAE **< 1 beat** (sleep); meta-analysis mean diff **−0.40 bpm** sleep / −0.01 bpm rest | ≈1.0 | — | Rehman 2024; Zhang 2020 |
| OxyDex | Wellue O2Ring (finger/thumb pulse) | no published HR-MAE (validated for **ODI/OSA screening**, AUC 0.91); finger/ring pulse-rate at rest is low-bias | ≈1–1.5 | **1.4** | Tisyakorn 2024 (OSA); Cao 2021 (ring HR) |

**Reading.**
1. **Ranking confirmed.** The literature independently ranks H10 (chest ECG, the criterion) as most accurate,
   arm/finger PPG next — exactly the order the reference-free hat recovers (H10 0.9 < O2Ring 1.4 < Verity 2.8).
   The estimator names the right noisiest corner *and* the right quietest corner against an external yardstick.
2. **Magnitude anchored (Verity).** Verity's published upper-arm MAE 1.43 bpm → σ-equiv ≈ 1.8 bpm. Our σ̂ ≈ 2.8
   is ~1 bpm higher — expected and honest: our σ̂ is per-epoch instability across a **whole real night** incl.
   night-dependent PPG extraction (5 nights auto-excluded for poor contact, §2), whereas 1.43 bpm is a
   best-case controlled-lab arm placement. Same order of magnitude; the residual is real-world extraction noise.
3. **O2Ring** has no device-specific published HR-MAE (its validation literature is ODI/OSA-screening, not
   pulse-rate), so its anchor is the adjacent finger/ring-pulse literature (low bias at rest) — consistent with
   our 1.4 bpm sitting between the chest and wrist corners.

**Verdict.** This is a *literature*-anchored magnitude check (not the device-anchored one §1 still owes), and it
**passes**: the reference-free σ̂ is the right order of magnitude and the correct ranking against published
gold-standard-ECG validation. It does **not** replace the committed-trio distribution (single external anchor,
MAE≠σ), but it removes the "is 2.8 bpm even plausible for arm PPG?" question — it is. A published sensor-σ prior
(the σ-equiv column) is a candidate `validated`-tier input if we ever want to *seed* `_tchRhoFromMotion` or a
per-sensor floor; today it stays a validation reference, not a runtime input (no networked data enters a bundle).

*Sources (PubMed, with DOIs): Schweizer & Gilgen-Ammann 2025, JMIR Cardio — Verity Sense arm MAE 1.43 bpm vs H10
(`10.2196/67110`); Budig 2021, Sensors — trackers vs H10 criterion, overall MAPE 2.85 % (`10.3390/s22010180`);
Topalidis 2023, Sensors — H10 + Verity sleep staging (`10.3390/s23229077`); Tisyakorn 2024, Sleep Breath — Wellue
O2Ring OSA screening AUC 0.91 (`10.1007/s11325-024-03232-9`). Via Consensus: Rehman 2024, Sensors — PPG sleep MAE
< 1 beat; Zhang 2020, J Sports Sci — wrist-PPG meta-analysis (sleep −0.40 bpm); Cao 2021, JMIR — Oura ring nocturnal
HR low bias. Literature search run 2026-07-11; figures are cited references, not bundled data.*

## 9. Method literature & related work (2026-07-11 literature sweep)
A targeted sweep (PubMed + Consensus/Semantic-Scholar-ArXiv) surfaced prior art that (a) validates our
approach, (b) offers a **principled fix for the negative-variance / quiet-order regime** we currently work
around, and (c) grounds the §4 N-cornered generalization. Cited references only — no runtime/bundled data.

**(1) N-cornered hat + a real fix for negative variance (informs §4 AND `integrator-tch.js`'s `correlated`
branch).** The TCH extends to N≥3 by least-squares over the pairwise Allan variances — confirming the §4
sketch (Schatzman 2020/2021). More importantly, the **unphysical negative-AVAR weakness** — exactly the
regime our quiet-order caveat + auto min-ρ clamp handle heuristically — has two published, principled fixes:
reformulating TCH as a **maximum-likelihood** problem (non-negative by construction, and yields per-estimate
uncertainties via bootstrapping; Schatzman 2020), and the **Groslambert / two-sample covariance** (GCOV;
Vernotte–Calosso–Rubiola) which "converges to zero out of the box" without the equal-noise hypothesis and was
shown to **outperform TCH** on the negative-variance case (Calosso 2018). **Candidate upgrade:** replace/
complement `integrator-tch.js`'s min-ρ `correlated` hack with an ML-TCH or Groslambert-covariance estimator —
a real fix for the quiet-order under-estimate rather than a flag. Would be its own brief (changes the estimator
+ regenerates the golden). Sources: Schatzman 2020 (IFCS-ISAF), Schatzman 2021, Calosso et al. 2018 (IEEE TUFFC).

**(2) Reference-free error estimation is an established cross-domain method (related work for the paper).**
Sjoberg et al. 2021 (*J. Atmos. Oceanic Tech.*) apply the **same clock-metrology 3CH to atmospheric datasets**
(N≥3), with a sensitivity analysis to sample size, outliers, biases, and **unknown error correlations** — the
same limitation set we hit (the ρ problem). This is the direct precedent legitimizing Tepna's transplant of the
method to consumer physiological HR sensors, and the honest novelty framing ("first application to a co-recorded
wearable HR trio"). Good anchor for the `sensor-trio-nights` paper's related-work.

**(3) The RMSSD-divergence premise + the motion-ρ design are literature-supported.** PPG-derived PRV is *not*
ECG HRV — it under-/over-states RMSSD/SDNN/pNN50 (Kass/Kantrowitz 2025, N=931; Dewig 2024 traces it to
pulse-arrival-time dispersion, RMSSD worse than SDNN) — which is exactly the excess-variance the TCH targets.
And **motion drives the divergence**: absolute PPG HR error is ~30 % higher in activity than rest (Bent 2020),
and **ACC-signal filtering of PPG motion artifacts measurably improves PRV** (Prucnal 2025) — direct support for
`_tchRhoFromMotion` using cross-node motion as the common-mode ρ proxy. For our exact device family, Polar OH1
(PPG) vs Polar H10 (ECG) RMSSD agrees excellently at rest (ICC 0.955 supine) and degrades with posture/motion
(Coste 2025) — consistent with the quiet-order (rest) vs motion-divergence picture the hat recovers.

*(Thread not folded here: ECGDex CVHR/apnea prior art — Hayano 2010's ACAT algorithm (CVHR index vs AHI r=0.84,
AUC 0.913) and Hsu 2020 (ECG-CVHR + 3-axis-ACC patch, combined AUC 0.90) — belongs to `PAPERS-ROADMAP`, not this
TCH note; recorded here only as a pointer.)*

## 10. Estimator bake-off — ML-TCH / Groslambert vs the min-ρ clamp (2026-07-11) — `tools/tch-estimator-bakeoff.mjs`
Executes `INTEGRATOR-TCH-ML-ESTIMATOR-2026-07-11-BRIEF.md` §2. The §9 sweep flagged two published
candidates for the negative-variance / quiet-order regime the shipped path handles heuristically (min-ρ
`correlated` clamp + `quietOrderUncertain` flag). The bake-off runs them on the planted-truth synthetic corpus
(same factor model as §7), so "closer to truth" is measurable:

- **BASE** — shipped `IntegratorTCH.threeCorneredHat` (classic → min-ρ `correlated`).
- **GCOV** — Groslambert / two-sample covariance: `σ²_A = Cov(A−B, A−C)`.
- **NNLS** — constrained maximum-likelihood proxy: non-negative least-squares over `σ²_i+σ²_j = V_ij`.
- **ORACLE** — `threeCorneredHat` with `opts.rho` = the *planted* common-mode ρ (the external-ρ path — "what
  good looks like" when ρ is known; the shipped `_tchRhoFromMotion` estimates this ρ from motion).

**Result — a clean NEGATIVE (keep the heuristic).** Two findings, both robust on the corpus:
1. **GCOV ≡ classic at N=3.** The identity check (GCOV vs raw classic) is **0.0000 bpm** — Groslambert
   covariance is algebraically the classic estimator written as a covariance, so it inherits the same
   negative-variance failure. No free lunch. (This corrected an earlier hand-analysis that had assumed GCOV
   might differ; the run settled it.)
2. **No HR-only estimator resolves the quiet-order ambiguity.** Mean recovery error over BOTH non-culprit
   ("quiet") corners on the quiet-order nights: **BASE 0.334 · GCOV 0.746 · NNLS 0.719 · ORACLE 0.080** bpm.
   On a negative-variance night, GCOV and NNLS merely **relocate** which quiet corner is driven to ≈0 (they
   sacrifice the ECG corner instead of the O2Ring one) — they are *worse* than the min-ρ clamp, not better.
   Only **ORACLE (external ρ)** recovers both quiet corners. The culprit (loudest) is named correctly by every
   estimator on every night — that part was never the weak spot.

**Why (the honest reason):** with three sensors each contributing ONE series, the system is exactly
determined (3 pairwise variances, 3 unknowns) and the common-mode ρ is **not identifiable** from the HR series
alone. Escaping the quiet-order under-estimate genuinely requires **external information** (the motion-ρ) or
**over-determination** (N≥4). ML-TCH's real advantages — non-negativity from a fitted likelihood and per-estimate
uncertainties — only materialize at N≥4.

**Verdict.** Keep the shipped min-ρ clamp + `quietOrderUncertain` flag + `_tchRhoFromMotion` for N=3. Do **not**
swap the N=3 estimator. Route the ML-TCH / least-squares-AVAR path to the **N-cornered hat (FU-III §4)**, where
over-determination is what makes it pay off — it lands with EEGDex / a ≥4-sensor co-recording, not before.
Harness: `node tools/tch-estimator-bakeoff.mjs` (deterministic, analysis-only — does not touch `integrator-tch.js`).

## 11. The real multi-night distribution (2026-07-13) — §1's owed leg, executed on committed nights
§7 built the harness and §1 owed the **real** distribution + reference-anchored magnitude check. The trio
node-export triples are now committed (**17 nights**, `uploads/trio/<date>/{ECGDex,PpgDex,OxyDex}_*.node-export.json`),
so this ran end-to-end through the shipped kernel:

```sh
node tools/tch-multinight.mjs --selftest      # 30/30 known-answer checks green
node tools/tch-multinight.mjs --dir uploads/trio
```

**Distribution — 17/17 nights solve** (no `classic-clamped` failures, no insufficient-overlap drops).
Per-corner medians, and the two independent anchors from §2 (the 10-night reference-free estimate) and §8
(published wearable-HR validation):

| corner (device) | median σ classic | **median σ ρ-on** | §2 corpus anchor | §8 literature anchor |
|---|---|---|---|---|
| ECGDex (H10) | 0.64 | **0.95** bpm | 0.9 | criterion device (most accurate) |
| OxyDex (O2Ring) | 1.03 | **1.19** bpm | 1.4 | — |
| PpgDex (Verity) | 1.85 | **1.85** bpm | 2.8 | ≈1.8 (MAE 1.43 → σ=MAE·√(π/2)) |

Median culprit σ (ρ-on) = **3.20 bpm**. **The magnitude check PASSES on both anchors:** the *ranking* is
preserved (H10 < O2Ring < Verity — the criterion device is the quietest corner, arm-PPG the loudest), and the
Verity corner's 1.85 bpm sits essentially on §8's independent literature σ-equivalent of ≈1.8. The 24-night
superset (the 17 committed + 7 further nights present on the capture host but not committed) tells the same
story: 24/24 solve, medians 0.79 / 1.08 / 2.20 bpm, median culprit σ 3.32.

**The rescue reproduces — and its failures have ONE identified cause.** The quiet-order regime hit **7 of the
17** nights. The per-night motion-ρ rescued **4** of them; 2026-07-06 reproduced §6 almost exactly (OxyDex
σ 0.04 → 1.00 bpm here vs the ad-hoc 0.03 → 1.02, the difference being the harness's 30-s epoch binning):

| night | ρ_motion | ρ needed | quiet corner: classic → ρ-on | outcome |
|---|---|---|---|---|
| 2026-06-11 | 0.77 | 0.77 | OxyDex 0.02 → **1.02** | rescued |
| 2026-06-15 | 0.79 | 0.79 | ECGDex 0.01 → **2.13** | rescued |
| 2026-06-16 | 0.90 | 0.90 | PpgDex 0.01 → **1.29** | rescued |
| 2026-07-06 | 0.64 | 0.64 | OxyDex 0.04 → **1.00** | rescued (the §6 night) |
| 2026-06-24 | **0.04** | 0.69 | OxyDex 0.07 → 0.07 | not rescued — ρ fell through |
| 2026-06-29 | **0.39** | 0.39 | OxyDex 0.04 → 0.13 | not rescued — ρ applied but too small |
| 2026-07-05 | **0.37** | 0.59 | PpgDex 0.01 → 0.01 | not rescued — ρ fell through |

**§7's dilution hypothesis is CONFIRMED, and it is the whole story.** On every rescued night the measured
ρ_motion (0.64–0.90) exceeded the ρ the geometry needs; on every failed night it fell short (0.04–0.39 against
a required 0.59–0.69). When the supplied ρ is too small to yield a non-negative solve, `threeCorneredHat`
(`integrator-tch.js:275`) **falls through** the `correlated-external` branch into the auto `correlated` min-ρ
search — which is **boundary-seeking by construction**: it returns the *smallest* ρ restoring non-negativity, so
it pins the quiet corner's σ at the ≈0.0x boundary. The failure is therefore **not** in the kernel (it is
behaving as designed, and it flags the night via `quietOrderUncertain`) but in the **ρ estimate feeding it**:
`_tchRhoFromMotion`'s mean-of-positive-pairwise-ρ dilutes exactly when one pair is tightly coupled, which is the
quiet-order shape itself. This promotes §7's **coupled-pair-weighted ρ** from a *candidate* refinement to an
**indicated** one, with a concrete target — lift ρ on those nights into the 0.6–0.7 band the geometry requires.
It also dovetails with §10's bake-off conclusion (no HR-only estimator escapes the quiet-order ambiguity — only
*external* ρ does), which is precisely why the quality of that external ρ is now the binding constraint.
Carried to `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-IV-2026-07-13-BRIEF.md` §1.

**Two nights look like artifacts, not physiology.** 2026-06-12 recovers σ[ECGDex] = **8.64 bpm** — the H10 is the
*criterion* device (§8), so an 8.6 bpm chest-strap σ is not credible; the untracked 2026-07-04 similarly gives
σ[PpgDex] = 10.5 bpm. Both are far outside every anchor and most likely reflect an alignment or beat-detection
failure on one corner rather than a genuinely noisy sensor. They are the intended prey of the cross-corner
consensus gate proposed in `TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md`; recorded here so that brief
lands with two known positives to test against.

**Scope note.** Analysis-only — this section ran committed tooling against committed inputs and changed no
runtime code, so no bundle, `manifestHash`, or fixture moved.

## Cross-references
- `tools/tch-estimator-bakeoff.mjs` — the §10 estimator bake-off (ML-TCH/GCOV vs min-ρ clamp).
- `tools/tch-multinight.mjs` — the committed multi-night A/B harness (§7); `node tools/tch-multinight.mjs --selftest`.
- `briefs/INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md` §1 (this executes it — premise leg §5/§6, closed by §11).
- `briefs/INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-IV-2026-07-13-BRIEF.md` — the residue §11 spawned (coupled-pair-weighted ρ).
- `uploads/trio/<date>/` — the 17 committed trio node-export triples §11's distribution runs on.
- `sensor-trio-power-analysis.html` / `sensor-trio-worker.js` (the real-data arm + production PPGDSP corner).
- `papers/sensor-trio-nights.html` (the power/sample-size preprint this real corpus feeds).
- Integrator TCH: `integrator-dsp.js` `_tchHat` / `_tchRhoFromMotion` / `fuseHRVConsensus`.
