<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-11 · **Corpus:** 180 real CPAP nights (2026-01-11 → 07-10), 39 paired with O2Ring, 17 quad-modal · **Related:** `CPAPDEX-PHASE9-FOLLOWUPS-*-BRIEF.md`, `INTEGRATOR-BUILD-BRIEF.md`

# CPAP real corpus — what 180 nights exposed, and what the data still owes us

> **What this is.** The first time a *whole* ResMed SD card was driven through CPAPDex. Every node in
> the fleet has been exercised on real data except CPAPDex, whose equivalence gate is **synthetic-only**
> by explicit admission in `FIXTURE-PROVENANCE.json`. Running 180 real nights through
> `CPAPDex.compute()` found **six code defects that synthetic fixtures structurally cannot find**, and
> surfaced a data asset (a quad-modal 17-night overlap + two dated interventions) that unblocks work
> the `PAPERS-ROADMAP` currently lists as blocked-on-reference.
>
> **Nothing here is a therapy conclusion.** The medical read lives in the (gitignored) personal log;
> this brief is strictly about the code and the data.

---

## 1 · The assets

| id | asset | why it matters |
|---|---|---|
| **A1** | **180 CPAP nights** — 1139 EDF files, 486 MB, 222 sessions, 1237.6 therapy hours, 2026-01-11 → 07-10 (`Ecg nightly/CPAP/`, day-folder SD-card layout) | 60× the 2-night real-EDF fixture set. First corpus large enough to expose threshold/heuristic bugs. |
| **A2** | **39 nights CPAP ∩ O2Ring** (2026-05-03 → 07-07), ~6.6 h mean overlap | First real cross-node event↔event join in the fleet. |
| **A3** | **17 nights CPAP ∩ ECG (H10) ∩ PPG (Verity) ∩ O2Ring** (2026-06-10 → 07-06) — `uploads/trio/` ∩ the CPAP tree | **Quad-modal.** Four independent devices, one night, one clock. See §4 P6 — this is the valuable one. |
| **A4** | **Two dated step-interventions**: EPR 0→3 on **2026-06-12** (IPAP−EPAP gap steps `0.00 → 3.00` and reads *exactly* 3.00 every night since); min 7→9 / max 17→13 **~2026-06-21** | A **labelled change-point dataset** — ground truth for testing `CPAPCross` trend/change detection, which today only ever runs on synthetic nights with `sd: 0` and a `'stable'` label. |

A1–A2 are personal recordings and stay out of git (`.gitignore:16` `uploads/*`). A3's node-exports are
already committed under `!uploads/trio/**`.

---

## 2 · Code defects (none of these are findable with synthetic fixtures)

### F1 — the node-export throws away 17 of 32 computed metrics, including the ENTIRE ventilation lane ⚠️ **biggest**

`buildSessionFromEdf` computes 32 metrics. `cpapBuildExport` emits **15**. The 17 dropped, and whether
they are actually populated on real data:

| dropped | populated on real data | |
|---|---|---|
| `respRateMedian` `respRateRange` `tidVolMedian` `minVentMedian` `minVentStability` `breathCount` `breathRate` `ieRatio` | **176/180 nights** | the **whole ventilation lane** |
| `flowLimMean` `flowLimitedPct` `snorePct` `snorePressureCorr` | **168–176/180** | the **flow-limitation + snore lane** |
| `eprDelta` `maskOnLatency` `maxLeak` | **176–180/180** | |
| `compliancePct` `mode` | 0/180 (by design — longitudinal / string) | |

**15 of 17 carry real data on ≥168 of 180 nights and none of them reach the `ganglior` bus.** The
Integrator cannot see a single CPAP ventilation variable. This is not cosmetic: **§3 D2 shows the
dropped lane contains the strongest predictor of nightly event burden anywhere in this corpus**
(tidal volume, r≈0.5, t≈8) — far stronger than pressure (0.16–0.26) or leak (0.16), both of which
*are* exported. We export the weak predictors and drop the strong one.

*Fix:* additive fields on `cpapBuildExport` → **MINOR** bump (backwards-compatible, per §📦). Regenerate
the CPAP fixtures (output moves). Add the new metrics to `CPAP_REGISTRY` with evidence badges (the
ventilation ones are device-*measured* → `measured`; `snorePressureCorr` is derived → lower tier).

### F2 — the `mode` heuristic is noise on real data

`cpapdex-dsp.js:506` — `mode = pressIqr > 1.0 ? 'APAP' : 'CPAP'`. Across 180 real nights the label
**flips 57 times**, and **27% of nights sit within ±0.2 cmH₂O of the 1.0 cut** (median pressure IQR
is 1.34 — the threshold is inside the distribution, not outside it). It reads as a device setting and
is not one. Synthetic nights have a clean IQR, so the suite never sees this.

*Fix:* retire it, or add hysteresis, or derive it honestly — with F1 exporting `eprDelta`, a real
CPAP-vs-APAP call is available from `pressureRange` + `eprDelta` together rather than a bare IQR cut.
Whatever is chosen, **do not surface a per-night mode label without a stability guard.**

### F3 — CPAPDex's synthetic-only equivalence gate: the stated blocker is FALSE

`FIXTURE-PROVENANCE.json` states:

> *"CPAPDex can't join the Phase-9 'compute() ≡ committed export' equivalence gate (its real input is a
> BINARY multi-file EDF set, not a `{text}`/CSV)"*

So CPAPDex is the **only** node whose GATE-C leg is synthetic (`_synthEdfSet` → golden). Its two
real-EDF fixtures (`cpapdex-2026-06-12`, `cpapdex-2026-06-16`) are byte-pinned but **never re-run**.

**Disproved.** `fs.readFileSync` → `ArrayBuffer` → `CpapEdf.readEDF` → `CPAPDex.compute({edfSets})`
runs headless in a Node vm realm over binary multi-file EDF — demonstrated on **222 sessions**. A real
data equivalence leg is buildable today.

*Blocker to decide:* the fixture *exports* are un-ignored (`!uploads/cpapdex-2026-06-12.node-export.json`)
but the EDF **inputs** they hash against are **not** committed. A real-EDF equiv leg needs those ~10 EDF
files in git. That is a privacy call, not a technical one — note the derived exports are already committed.

### F4 — no ResMed ingest adapter

`adapters/` holds 8 vendor adapters (Polar ×3, Coospo, Wahoo, Libre, Welltory, OxyDex-SpO₂) and
**none for CPAP**. The SD-card tree → `edfSets` grouping had to be hand-rolled. The non-obvious rule:

> cluster by anchor stamp within ±60 s, **and a second file of the same type opens a NEW set.**

Without that last clause, **8 sessions silently lose an `EVE` file** (a brief mask-off/on inside one
minute writes a second CSL/EVE pair; a naive ±60 s cluster overwrites the first and under-counts events).

*Fix:* `adapters/resmed-edf.js` (folder → `edfSets`), registered like the others.

### F5 — `buildLongitudinal` returns `crossNight: null` over 180 nights

Returns `{compliancePct, nights, usageTrend7d, ahiTrend30d, crossNight: null}`. The other three
populate; `crossNight` does not. Either an opts requirement or a bug — 10-minute investigation.

### F6 — the SA2 oximetry lane has zero real coverage

**217/222** sessions report `oximeter-not-connected`, 5 report `no-spo2-channel`. Every SA2 file parses;
none carries SpO₂. The self-gated desat lane in `cpapdex-dsp.js` (`selfGateDesat` / `detectDesats` /
`oximetryLane`) has therefore **never run on real data**. Either wire a real oximeter to the AirSense,
or accept that the lane is exercised only synthetically and say so.

---

## 3 · Data findings

### D1 — central apneas do not desaturate; obstructive apneas do

688 central apneas across 39 paired nights. Fraction followed by an SpO₂ desat, vs a **circular
time-shift null** (±5–15 min surrogates — preserves both event and desat rates, destroys alignment):

| window | central (n=688) | obstructive (n=39) | hypopnea (n=214) |
|---|---|---|---|
| 0–30 s | 0.7% vs 1.2% — **×0.6** | 2.6% vs 0.5% — ×5.0 | 0.5% vs 0.7% — ×0.7 |
| 0–60 s | 1.7% vs 1.9% — **×0.9** | 5.1% vs 0.8% — ×6.7 | 0.5% vs 1.4% — ×0.3 |
| 0–90 s | 2.3% vs 2.4% — **×1.0** | 5.1% vs 1.3% — ×4.0 | 0.9% vs 1.7% — ×0.5 |
| 0–120 s | 2.8% vs 2.7% — **×1.0** | 5.1% vs 1.5% — ×3.3 | 0.9% vs 2.0% — ×0.5 |

Duration-stratified (the decisive check — long apneas *must* desaturate if they matter):
`≤15 s` n=385 ×1.4 · `15–25 s` n=261 ×0.4 · **`>25 s` n=42 ×0.0 — not one desaturated.**
Nightly: **r(CA, ODI4) = 0.06** · **r(OA, ODI4) = 0.51**.

### D2 — tidal volume is the strongest event-burden predictor in the corpus — and it is in the dropped lane

Detrended (residuals after removing the shared night-index trend, so this is not drift):

| | vs central index | vs obstructive index |
|---|---|---|
| `tidVolMedian` | **r = 0.514** (t=8.0) | **r = 0.480** (t=7.3) |
| `minVentMedian` | r = 0.277 (t=3.8) | — |
| `minVentStability` | r = 0.501 (t=7.7) | r = 0.288 (t=4.0) |
| *(exported)* `medianPressure` | 0.16 | −0.14 |
| *(exported)* `largeLeakPct` | 0.16 | −0.20 |

**Honest caveats, both important:**
- It is **NOT class-specific.** Tidal volume predicts obstructives (0.48) about as strongly as centrals
  (0.51), so this is an **event-burden** correlate, *not* the clean loop-gain/hypocapnia signature it
  first looked like. Do not sell it as a central-apnea mechanism.
- `minVentStability` is **probably circular** — an apnea *is* a gap in ventilation, so events inflate
  the instability metric that supposedly predicts them. `tidVolMedian` is a median over thousands of
  breaths and is *not* obviously circular; it is the one to trust.

Either way: the best predictor in 180 nights of data is a field the bus never sees (F1).

### D3 — flow limitation CONTRADICTS the airway-collapse mechanism

Flow limitation is the physiological *precursor* to airway collapse, so if a lower expiratory floor
caused more obstruction, `flowLimitedPct` should rise as the floor falls. **It falls:**

```
expiratory floor 7  →  flowLimitedPct 0.116  |  OA 0.159
expiratory floor 6  →  flowLimitedPct 0.082  |  OA 0.265
expiratory floor 4  →  flowLimitedPct 0.069  |  OA 0.490
```
and **r(flowLimitedPct, obstructiveIndex) = −0.002** across 180 nights. Zero.

The OA rise after 2026-06-12 is statistically solid (like-for-like on clean-leak nights only, permutation
**p = 0.0045**; a leak-suppresses-detection artifact was tested and **refuted** — within 151 pre-EPR
nights r(leak, OA) = −0.04 and clean vs leaky nights show identical OA, 0.054 vs 0.056). But the
**mechanism is not airway collapse.**

**Live alternative worth testing:** ResMed distinguishes central from obstructive apnea using a forced
oscillation probe. EPR changes the pressure waveform that probe rides on. The events may have been
**re-labelled, not created.** Testable with A3 (§4 P7): a re-labelled event has the same autonomic/arousal
signature as before; a newly-created obstruction does not.

### D4 — Clock Contract validated across device families

CPAP EDF (floating `tMs` from an EDF header) joined to O2Ring CSV (floating `tMs` from
`HH:MM:SS DD/MM/YYYY`) across 39 nights — two unrelated parsers, **zero timezone code**, exact
alignment. This is the contract's entire *raison d'être* demonstrated end-to-end, and nothing in the
suite currently pins it. Deserves a fixture.

---

## 4 · Proposals

| id | proposal | value | effort |
|---|---|---|---|
| **P1** | **Export the dropped lane** (F1) — ventilation + flow-limitation + snore + `eprDelta`/`maxLeak`/`maskOnLatency` onto `cpapBuildExport`; register + badge them. Additive → MINOR. | **high** | med |
| **P2** | **Real-EDF equivalence leg for CPAPDex** (F3) — closes the fleet's last synthetic-only GATE-C. Harness already exists. | **high** | low |
| **P3** | `adapters/resmed-edf.js` (F4) — SD-card tree → `edfSets`, incl. the second-file-of-type rule. | med | low |
| **P4** | Fix/retire the `mode` heuristic (F2); investigate F5; decide F6. | med | low |
| **P5** | **Cross-node event-coupling primitive with a shuffled-null baseline** — see below. | **high** | med |
| **P6** | **CPAP as a respiration REFERENCE for the reference-free σ programme** — see below. | **highest** | med |
| **P7** | Apnea → HR (CVHR) and apnea → motion-arousal coupling on A3; settles D3's re-labelling question. | high | med |
| **P8** | Use A4's dated change-points as ground truth for `CPAPCross` trend/change detection. | med | low |

### P5 — the coupling primitive

`cgm-hrv-coupling-analysis.js` is precedent (GlucoDex × PulseDex) but it validates a mechanism
**deliberately planted in the synthetic cohort generator** — it answers "did our detectors recover what
we injected?". What the CPAP × O2Ring work needed is the harder thing: **real data, no ground truth**,
so you need a surrogate null to answer *"is this co-occurrence better than chance?"*

Proposed shared surface — `event-coupling.js`:

```
coupling(eventsA, eventsB, {window:[lo,hi], nullShifts:[…]}) →
  { n, hits, observed%, chance%, lift, windowSweep[] }
```

Circular time-shift surrogates preserve marginal rates and destroy alignment. Generalizes immediately to
CPAPDex apnea × OxyDex desat, ECGDex arrhythmia × OxyDex desat, GlucoDex excursion × anything. ~40 lines.
**This is the missing "is it real or coincidence" primitive for the Integrator**, and D1 shows it changes
conclusions: the *dominant* event class turned out to be uncoupled from the outcome everyone assumes it drives.

### P6 — CPAP as a reference. The one that unblocks the σ programme.

The whole `sigma-no-reference-analysis` / three-cornered-hat programme exists **because there is no
reference** — you cannot measure a device's σ without a truth signal, so you triangulate three devices
instead and hope the estimator is sound. **You have never been able to check whether it is.**

CPAP's PLD channel writes **measured respiration**: `RespRate` (0.5 Hz), `TidVol`, `MinVent` — from a
calibrated flow sensor in the therapy path. That is a **genuine ventilation reference**, and on the 17
quad-modal nights (A3) it sits alongside ECG and PPG on the same clock.

So:
1. Build a **respiration triplet** — CPAP `RespRate` (measured) + ECG-derived respiration (EDR/RSA) +
   PPG-derived respiration.
2. Run the **existing reference-free TCH σ machinery** on it, exactly as it runs on the HR triplet.
3. **Compare its σ estimates against the CPAP reference.** For the first time you can ask: *does the
   reference-free estimator actually recover the true σ?*

That is a **validation of the method itself**, not just another application of it — the one experiment a
reference-free technique can normally never run, and precisely what a `PAPERS-ROADMAP` real-validation
item needs. It is also cheap: the data already exists and is already parsed.

---

## 5 · Claims made during this analysis and then RETRACTED

Recorded so nobody rebuilds them from the scrollback.

| claimed | verdict |
|---|---|
| "the mask reseal and the EPR change were separable in time (Jun 8 vs Jun 11)" | **FALSE.** Nightly data puts both on **2026-06-12**. They are confounded; weekly aggregates hid it. |
| "regime B (min 7 + EPR 3) beat regime C" | **NOT SIGNIFICANT.** Permutation p = 0.219 on AHI; a 9-night block. |
| "`eprDelta` reads null — DSP gap" | **FALSE.** It is computed correctly (0.000 / 2.911 / 3.000 across the three regimes). It is an **export** gap → F1. |
| "lower expiratory floor → airway collapse → more obstructives" | **The OA rise is real** (p=0.0045, leak artifact refuted) but **the collapse mechanism is not corroborated** — flow limitation moves the wrong way (D3). Re-labelling is a live alternative. |

---

## 6 · Done when

- [ ] **P1** — the 15 populated dropped metrics ride the `ganglior` bus; `CPAP_REGISTRY` + badges updated; CPAP fixtures regenerated (output moves → changeset, PATCH-or-MINOR per §📦); `registry-defs-parity` green.
- [ ] **P2** — a real-EDF `env.equiv.cpapdex_real` leg runs `compute({edfSets}) ≡ committed export` in **both** runners; the EDF inputs' commit status decided and acted on; `FIXTURE-PROVENANCE.json`'s "can't join" note **deleted**.
- [ ] **P3** — `adapters/resmed-edf.js` registered; the second-file-of-type rule has a unit test (the 8-session case).
- [ ] **P4** — `mode` fixed or retired (no bare-IQR label ships); F5 diagnosed; F6 decided and documented.
- [ ] **P5** — `event-coupling.js` in the shared spine with a self-test; D1 reproduced through it.
- [ ] **P6** — respiration triplet built on A3; TCH σ estimates compared against the CPAP reference; result written up (this is a `PAPERS-ROADMAP` item, not just a gate).
- [ ] `Dex-Test-Suite.html?full` all-green · `verify-provenance.html` GATE A/B clean · `node tools/build.mjs --check` clean.
- [ ] Follow-up brief spawned per §📌 with whatever P6 turns up.

## 7 · Reproducing

The four harnesses (scratchpad, to be promoted to `tools/` by P3):
`cpap-batch.mjs` (EDF tree → sessions/nights) · `cpap-dex.mjs` (→ 180 `ganglior.node-export`s) ·
`fold-o2ring.mjs` (+ OxyDex → 39 paired nights, coupling) · `cpap-lastmonth.mjs` (change-points, bootstrap CIs).
All four drive the **real** modules (`cpapdex-edf/dsp/fusion.js`, `oxydex-dsp.js`) in a vm realm co-loaded
exactly as `CPAPDex.src.html` does — no re-implemented parser, no hand-typed numbers.
