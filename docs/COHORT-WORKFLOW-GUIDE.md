<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Cohort Validation — How Synthetic Patients Are Built & How to Use the Harness

> **Audience:** anyone running or extending the Tepna cohort validation harness. This is the
> *workflow* guide — what a synthetic patient is, how it flows through the real Dex pipeline, how to
> run it, what numbers to expect, how long it takes, and **what classes of bug it is designed to
> catch.** For the build-time contracts see `COHORT-VALIDATION-BRIEF.md`; for EEGDex see
> `EEGDEX-BUILD-BRIEF.md`. Everything here is 100% local.

---

## 1. The files (what each one is)

| File | Role |
|---|---|
| `cohort-gen.js` | **Patient sampler.** `CohortGen.patient(seed)` → one synthetic patient (profile + nights + raw device files + ground truth). Pure, deterministic, depends only on `window.SYNTH`. |
| `cohort-worker.js` | **Web Worker.** One worker = one realm for one node-set kind (`oxy` / `rrgluco` / `full`). Loads the **real** Dex DSP modules and runs them headless; returns minimal node-export envelopes + scores. |
| `cohort-harness.html` | **Single-node iframe realm** (`?node=oxydex|pulsedex|glucodex`) — the single-thread engine and the regression gate reuse it. Same job as a worker, in an iframe. |
| `cohort-full.js` | **FULL-lane waveform layer.** Synthesizes raw int16 µV ECG from the night's RR beats so ECGDex's Pan-Tompkins must re-derive them (a real detector round-trip). |
| `cohort-runner.html` | **The cockpit.** UI + run loop + IndexedDB resume + real Integrator fusion + scoring + live dashboard + `summary.json` / `manifest.json` / `sample.jsonl` / sharded `results.jsonl` export. |
| `cohort-regression.html` + `.js` | **Real-corpus gate.** Runs the 5 canonical SubjectA nights through the same harness and diffs vs committed ground truth. |

---

## 2. How a synthetic patient is built (`CohortGen.patient(seed)`)

A patient is a **seeded draw over a physiological parameter space**, rendered into the *same file
formats the real devices export*, with a machine-checkable ground truth attached. `seed` fully
determines the patient — patient `k` is always `CohortGen.patient(k)`, byte-for-byte.

### Step 1 — sample the profile (`sampleProfile(seed)`)
A `mulberry32(seed)` PRNG draws:
- **demographics:** age 20–85, sex, BMI 19–48.
- **OSA severity** drawn from a **BMI + sex prior** (heavier → higher P(severe); **male → higher**,
  the male tilt fading with age as the post-menopausal female gap closes — males end up ~3 pts more
  "severe" and ~5 pts less "none" across the cohort); sets a base AHI in the stratum's range (none
  0–5, mild 5–15, mod 15–30, severe 30–80).
- **longitudinal arc** over 1–12 nights: `flat | improving | worsening | intervention` (intervention
  plants a CPAP-start night; AHI drops to residual after it).
- **CPAP state:** `untreated | new | adherent-residual | non-adherent` (caps AHI under therapy).
- **glycemia:** `normal | preDM | T2D`, with optional `nocturnalHypo` and `dawnPhenomenon` flags.
- **autonomic baseline:** an rMSSD baseline that declines with age + an individual offset; per-night
  rMSSD then drops with apnea burden and recovers on therapy.
- **artifact & missingness:** an extra-dropout fraction (finger-off/contact-loss bursts), motion
  density, occasional whole-patient off-body, and **per-night node dropout** (a node can be absent on
  a single night) and **per-patient node presence** (not everyone wears every device).
- nights are pinned to **May 2026** with pre-midnight bedtimes (so SYNTH's civil-date-pinned glucose
  hypo/dawn injectors land on the right absolute instants).

### Step 2 — per-night configs → master timelines
Each night gets a config (date, bedtime, duration ~6.8–8.2 h, that-night AHI from the arc, CPAP flag,
glucose story, target rMSSD). Each config is rendered by **`SYNTH.masterTimeline(cfg, seed+n)`** — the
*same* generator that built the single-subject corpus — into one coherent latent timeline (apnea/
hypopnea clusters, periodic breathing, desat morphology, RR series, a REM/supine sleep latent).

### Step 3 — render real device files from the timeline
The harness **reuses the SYNTH renderers unchanged**, so the bytes are indistinguishable from a real
export:
- `renderOxy(tl)` → **O2Ring CSV** (1 Hz SpO₂/pulse/motion). `injectDropout` then blanks a small
  fraction as 1–3 contact-loss bursts (confined to the middle 60%, so a clean validation span always
  survives).
- `renderRR(tl)` → **Polar H10 RR text** (`ISOnozone;RRms`) — feeds PulseDex *and* ECGDex.
- `renderGlucoAll(timelines)` → **continuous CGM CSV** across the patient's nights.
- `renderHRVAll(timelines)` → **Welltory HRV summary CSV** (one row/night).
- *(FULL lane)* `renderPPG(tl,win)` → **176 Hz Polar Sense PPG**; `cohort-full.js renderECGInt16` →
  **raw int16 µV ECG @130 Hz**; `CohortGen.buildCpapEdfSet` → **EDF-shaped CPAP set** (PLD detail +
  SA2 oximetry + EVE/CSL annotations, with residual AHI = round(ahi·hours) device-scored events).

### Step 4 — ground truth
`SYNTH.groundTruth(tl)` returns the planted events (each with absolute floating `t0Ms`, type,
duration, desat %, and `meta.rem`/`meta.supine`), periodic-breathing spans, the night's target AHI,
rMSSD target, CPAP flag, and glucose story. **This is what the scorer diffs the real DSP output
against** — the harness never grades the DSP against itself.

---

## 3. The two lanes

| | **FAST** (the 10k lane) | **FULL** (≤500 cert lane) |
|---|---|---|
| Nodes | OxyDex · PulseDex · GlucoDex · HRVDex · CPAPDex · Integrator | + ECGDex (raw int16 → real Pan-Tompkins) + PpgDex (176 Hz morphology) |
| Waveforms | none (PPI/summary level) | one representative ~9-min apnea-cluster window/patient |
| Use it for | population sweeps, calibration, edge-case coverage, distribution sanity | detector-grade fidelity (beat recovery, morphology, motion gating) |

Both engines (worker pool / single-thread iframe) produce **byte-identical results per seed** — the
pool is a pure speedup, not a different lane.

---

## 4. Workflow — how to actually use it

### A. Smoke test (30 s)
1. Open `cohort-runner.html`. 2. N = 20, engine = *worker pool*, lane = *FAST*. 3. **Start**.
4. Confirm: 0 fatal, 0 node-throws, 0 kernel mismatches, every multi-node patient shows fusion overlap.
This proves the real modules still load and the contracts still hold end-to-end.

### B. Calibration / distribution run (minutes)
N = 1,000–10,000, FAST. Watch the **calibration scatter** (OxyDex ODI vs truth-AHI), the **distribution
histograms**, and the **severity × arc coverage matrix** fill in. Download `summary.json` for the
percentiles + fits; `manifest.json` for the frozen-seed pins.

### C. Detector-fidelity run (minutes, capped 500)
Lane = *FULL*. Adds ECG beat-recovery, ECG−PPG agreement, and 176 Hz morphology timing. This is the
lane that exercises the actual signal-processing front-ends, not just the summaries.

### D. Regression gate (≈15 s) — run after ANY DSP change
Open `cohort-regression.html` → **Run**. It must stay **all green (26/26, calibration R² ≈ 0.93)**.
This is the cohort harness's own end-to-end check; it complements `Dex-Test-Suite.html` (unit/contract)
and `verify-provenance.html` (build-trace).

### E. Resume / failure audit
The runner appends every result to **IndexedDB** as it goes — refresh or crash and **Start** resumes
where it left off (it skips seeds already on disk). To audit failures: the **failure ledger** lists
each flagged patient by **seed** — reproduce any one exactly with `CohortGen.patient(seed)`. Export
`sample.jsonl` (random 200) or the full sharded `results.jsonl` (≤19 MB parts) for offline diffing.

> **Reproducibility:** nothing is stored as raw corpus. `summary.json.reproducibility{}` + `manifest.json`
> pin `cohortGenVersion` + `dexVersion` + `kernelHash`; re-running those versions regenerates every
> patient and every result bit-for-bit.

---

## 5. Expected run times (measured this build; ~6-core machine)

| Lane / engine | Throughput | 1k | 10k |
|---|---|---|---|
| FAST · single-thread (iframe) | ~3 patients/s | ~5 min | ~55 min |
| FAST · worker pool (6 cores) | ~5–6 patients/s | ~3 min | ~25–30 min |
| FULL · worker pool | ~0.2–0.3 patients/s (PPG-bound) | — | capped at 500 ≈ a few min |

**Per-node median wall-time / patient:** OxyDex ~210 ms · PulseDex ~100 ms · GlucoDex ~5 ms ·
CPAPDex sub-ms–ms/therapy-night · ECGDex ~775 ms (FULL) · **PpgDex ~3.3 s (FULL — the runtime driver,
as the brief predicted)**. FAST is generation-bound (rendering up-to-12-night CSV/RR strings), so the
worker speedup is ~1.8× rather than 6× — the lever is moving generation to its own lane.

---

## 6. Projected outcomes (the "known-good" envelope — alert if a run drifts off these)

These are the measured signatures of the current build. A run that lands here is healthy; a run that
*leaves* this envelope is the signal.

- **OxyDex ODI vs truth-AHI:** strongly **linear, R² ≈ 0.93**, but slope ≈ **0.14–0.21** — ODI-4
  *systematically under-scores* the planted AHI. This is **genuine, documented OxyDex behavior**
  (confirmed on the real SubjectA night 2: AHI 38 → `odi4` 7.6), not a harness artifact. The
  regression gate therefore checks the **correlation** (does ODI still track severity?), not the
  absolute ratio.
- **PulseDex rMSSD:** within ~8–120 ms, declining with apnea burden, recovering on therapy.
- **GlucoDex:** CV/GMI populate; nocturnal-hypo recall ≈ 1.0 on planted-hypo nights.
- **CPAPDex residual-AHI abs-err ≈ 1.5/h** (median) vs the planted residual; leak/central-index/pressure populate.
- **ECG beat-recovery (FULL) median = 1.0** — Pan-Tompkins recovers ~99.5% of true beats from the
  synthesized morphology, so ECG HRV is trustworthy.
- **ECG − PPG rMSSD Δ ≈ −29 ms** — PPG runs *hotter* than ECG on the same window (pulse-arrival-time
  jitter inflates PPG beat-to-beat variability). Expected, flagged as a cross-node coherence finding.
- **Integrator:** fusion overlap on every multi-node patient; **0 kernel mismatches**; **0 node throws**.

---

## 7. What errors this harness is designed to discover

This is the point of the whole thing. The harness catches bug classes that a single-file spot-check
and the unit suite miss, because it runs the **real** modules over a **wide, labelled** population.

**Contract / integration regressions**
- A DSP changes a **function signature, arg order, or return shape** and a downstream consumer breaks
  → shows up as a node-throw or a `summary.json` field going `null` across the cohort (the live
  render-coverage + the real Integrator wiring exercise the actual call paths).
- **Kernel/version drift** between nodes → `kernel mismatch` count > 0 in node-health.
- **Envelope/fusion breakage** → `no_overlap` flags spike, `anyOverlapRate` drops.

**Clock-Contract violations (the highest-value class)**
- A node that reverts to real-UTC epoch, mis-parses a vendor stamp, or fabricates a missing timestamp
  → `t0 matches truth` fails (regression gate), cross-node fusion overlap collapses (two nodes that
  recorded the same wall-clock minute no longer align), or events land on the wrong night. Overnight
  22:00→06:00 nights catch the past-midnight roll bug; the viewer-TZ test catches `getHours()` leaks.

**Calibration / accuracy drift**
- A detector that **stops tracking severity** → OxyDex ODI-vs-AHI R² drops below ~0.85 (regression
  gate goes red) even though per-night absolute numbers look plausible.
- rMSSD / CV / residual-AHI **bias or variance creep** → the distribution percentiles and abs-error
  medians move off the §6 envelope.

**Detector-front-end faults (FULL lane)**
- Pan-Tompkins **dropping or double-counting beats** → `ecg_beat_miscount` flag, beat-recovery median
  ≠ 1.0. PPG **motion-gate or SQI** regressions → analyzable/motion-rejected percentiles shift.

**Robustness / edge-case failures**
- **Artifact, dropout, off-body, partial nights, missing nodes, 1-night vs 12-night** patients are all
  in the draw — a node that crashes or returns garbage on a sparse/short/noisy night surfaces as a
  seeded failure-ledger entry (reproduce with `CohortGen.patient(seed)`).
- **Physiological-range guards** (`spo2_oob`, `odi_oob`, `rmssd_oob`, `cv_oob`, `cpap_ahi_oob`,
  `ecg_rmssd_oob`) catch any metric that escapes a sane range — i.e. a math bug that only triggers on
  certain parameter combinations the single demo file never hits.
- **Coverage matrix** makes a *gap* visible: if no patients land in `severe × intervention`, you know
  that corner is untested rather than silently passing.

**What it does NOT prove (honest scope)**
- Results validate against the **synthetic** ground truth this harness plants. They certify **pipeline
  behavior, internal coherence, and regression-freedom** — **not** real-world clinical accuracy. Real
  fidelity is a separate question answered (partially) by the real-corpus regression gate on SubjectA.

---

## 8. One-line cheat sheet
> Changed a `*-dsp.js`? → run `Dex-Test-Suite.html` (contracts) **and** `cohort-regression.html`
> (must stay green). Re-bundled an app? → `verify-provenance.html`. Want a population read or to
> hunt an edge-case bug? → `cohort-runner.html`, FAST 1k–10k, read the failure ledger by seed.
