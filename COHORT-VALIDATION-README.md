<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Cohort Validation Harness — Tepna (all 7 nodes)

**Reproducibility badge** — 🔒 *frozen seeds, byte-reproducible.* Patient `k` is exactly
`CohortGen.patient(k)` for `k ∈ [0,N)`; the corpus is regenerable from
`cohortGen + kernel` versions alone (no raw files stored). Worker-pool and single-thread
engines produce **bit-identical** per-seed results (verified). Every run stamps its pins
(`cohortGenVersion`, `dexVersion`, `kernelHash`) into `summary.json` → `reproducibility{}`
and the downloadable `manifest.json`. Honest scope: results are validated against the
**synthetic** ground truth this harness plants — they certify pipeline behavior and internal
coherence, **not** real-world clinical accuracy.

Self-running, local harness that generates N synthetic **patients**, runs each through the
**real** headless Dex pipeline, and harvests an aggregate `summary.json`. Generalizes the
single-subject corpus (`synth-gen.js`) across the parameter space. 100% local, no network.
See `COHORT-VALIDATION-BRIEF.md`.

## Files
- **`cohort-gen.js`** — `CohortGen.patient(seed) → {profile, nights[], files, groundTruth}`.
  Seeded draw over age × sex × BMI × OSA severity × arc × CPAP × glycemia × autonomic
  baseline × artifact × missingness × longitudinal arc (1–12 nights). Reuses the SYNTH
  renderers unchanged. Also exposes `buildCpapEdfSet(night)` — an AHI-parameterized
  EDF-shaped set (PLD detail @0.5 Hz + SA2 oximetry @1 Hz + EVE/CSL annotations) matching
  `buildSessionFromEdf`'s decoded-record input, so CPAPDex runs on real therapy nights.
  FAST mode (no 176 Hz PPG). Nights pinned to **May 2026** with pre-midnight bedtimes.
- **`cohort-harness.html`** — `?node=oxydex|pulsedex|glucodex`. One iframe **realm per
  node** so the plain-global DSP files (which collide on `parseCSV`/`parseTimestamp`/
  `mean`/`std`) never share a scope. Runs the REAL DSP, returns the **minimal** ganglior
  envelope the Integrator actually reads (per the brief's DSP I/O CONTRACT) + a scoring
  companion + per-call wall-time.
- **`cohort-worker.js`** — Web Worker (steps 2–3). One worker = one realm for one KIND of
  node set (`oxy` | `rrgluco` | `full`) so the colliding plain-global DSPs never share a
  scope and the heavy CSV/RR strings aren't double-rendered. Installs a permissive Proxy
  DOM + `window===self` shim before `importScripts` (OxyDex binds `#uploadArea` at load).
  The `full` kind loads the real ECGDex + PpgDex (+morph) engines.
- **`cohort-full.js`** — FULL-lane waveform layer. `CohortFull.renderECGInt16(tl,win)` is a
  PQRST-µV synthesizer that turns the SAME master-timeline RR beats into a raw int16 ECG
  @130 Hz (so ECGDex's Pan-Tompkins must *re-derive* the beats — a real detector round-trip,
  event-coherent with every other node). PPG reuses `SYNTH.renderPPG` (176 Hz Polar text).
  Lives in the harness, NOT the shipped DSP — so the regression + provenance gates stay green.
- **`cohort-regression.html` + `cohort-regression.js`** — real-corpus regression gate. Runs the
  5 canonical SubjectA nights (`uploads/synthetic/`) through the SAME OxyDex + PulseDex harness
  and diffs vs the committed `ground_truth_nightN.json`. Headline `#summary` pill (mirrors
  `Dex-Test-Suite.html`); **26/26 checks green, cross-night ODI-vs-AHI R² = 0.929.** Per-night
  bands are wide by design (the documented ODI-4 undercount); the real OxyDex gate is the
  cross-night calibration correlation — it catches a detector that stops tracking severity.
  Clock Contract is checked too: parsed `t0Ms` must equal each night's ground-truth `t0Ms`.
- **`cohort-runner.html`** — shell + UI (progress/ETA/throughput, calibration scatter,
  live histograms, severity×arc coverage, node-health, failure ledger), single-thread
  loop, IndexedDB append-only resume (refresh/crash-safe), real `IntegratorDSP.normalizeFile
  → runFusion`, scoring vs ground truth, `summary.json` + 200-patient `sample.jsonl` export.
  **Engine toggle:** *worker pool* (parallel, `navigator.hardwareConcurrency` split ~60/40
  oxy/rrgluco) or *iframe* (single-thread). Both share `finishPatient` — results are
  byte-identical per seed (verified), so the pool is a pure speedup, not a different lane.
  **Lane toggle:** *FAST* (10k, no waveform) or *FULL* (≤500 cert lane — adds real ECGDex +
  PpgDex morphology on one ~9-min apnea-cluster window/patient). Exports: `summary.json`,
  200-patient `sample.jsonl`, and full `results.jsonl` sharded to ≤19 MB parts (decision #3).

## Pilot scope → full lane set
FAST lane (the 10k lane): **OxyDex · PulseDex · GlucoDex · HRVDex · CPAPDex · Integrator** —
all parse/build → analyze → minimal-envelope, no waveform. HRVDex's real parse is DOM-bound,
so its rendered Welltory metrics are read directly. CPAPDex is headless via
`CpapFusion.cpapBuildExport` and runs only on nights the patient is on therapy (`cfg.cpap`).
FULL lane (≤500): additionally runs **ECGDex** (RR→int16 ECG → real Pan-Tompkins) and **PpgDex**
(176 Hz) on one representative window per patient.

## Measured timing (median ms/patient)
| node | FAST | FULL | notes |
|---|---|---|---|
| OxyDex | ~210 ms | (same) | full `processNight` on a ~7–8 h 1 Hz night |
| PulseDex | ~100 ms | (same) | RR parse + artifact-clean + time-domain HRV |
| GlucoDex | ~5 ms | (same) | continuous CGM across the patient's nights |
| CPAPDex | ~per-night | (same) | headless EDF→session→night→export; sub-ms–ms/night, runs on therapy nights |
| ECGDex | — | **~775 ms** | RR→PQRST int16 + real Pan-Tompkins + CVHR on a 9-min window |
| PpgDex | — | **~3.3 s** | 176 Hz beat-detect + morphology — **the runtime driver**, as predicted |

→ FAST: ~0.3 s/patient single-thread ⇒ 1k in minutes; worker pool parallelizes it.
→ FULL: ~4–8 s/patient (PPG-bound) ⇒ the ≤500 cap keeps the cert lane to ~minutes on a worker pool.

## What the harness already surfaces
- **Calibration:** OxyDex ODI vs truth-AHI is strongly **linear (R²≈0.93)** but
  systematically **under-scores** the planted AHI (slope ≈ 0.14–0.21). This is genuine
  OxyDex behavior, **confirmed against the real SubjectA corpus** (night 2, AHI 38 →
  `odi4` = 7.6): the discrete ODI-4 detector undercounts dense/sustained synthetic desats
  as the rolling baseline sags. A real est-vs-truth finding, not a harness artifact.
- **ECG beat-recovery median = 1.0** — Pan-Tompkins re-derives ~99.5% of the true beats from
  the synthesized PQRST morphology: the RR→ECG→detect round-trip is faithful, so ECG HRV is
  trustworthy.
- **ECG−PPG rMSSD Δ ≈ −29 ms (median)** — PPG reports higher rMSSD than ECG on the same window
  (pulse-arrival-time jitter inflates PPG beat-to-beat variability). Flagged for review as a
  cross-node coherence finding.
- **CPAP residual-AHI abs-err ≈ 1.5/h (median)** — CpapDsp recovers the planted (capped)
  residual AHI from the EVE annotations tightly; leak + central-index + pressure all populate.
- 0 node throws, 0 kernel mismatches, fusion overlap on every multi-node patient.
- Coverage matrix, distributions/percentiles, and a seed-reproducible failure ledger.

## Next (build order)
2. ~~Web-Worker pool~~ — **DONE.** Exact per-seed parity with single-thread; ~1.8× wall speedup
   (generation-bound).
3. ~~10k FAST + ≤500 FULL (ECGDex + PpgDex)~~ — **DONE.** FAST is resumable + parallel at 10k;
   FULL adds both waveform nodes with measured timing + sharded `results.jsonl` export.
4. ~~CPAPDex~~ — **DONE.** AHI-parameterized synthetic EDF set → real headless `cpapBuildExport`,
   folded into the FAST lane (rrgluco realm) + Integrator + scoring. All seven nodes now run.
5. ~~Freeze seeds + honest README badge~~ — **DONE.** Contiguous frozen seeds (patient k =
   `CohortGen.patient(k)`), `reproducibility{}` block in `summary.json` + downloadable
   `manifest.json`, and the honest-scope badge above. All build-order steps complete.
6. ~~Real-corpus regression gate~~ — **DONE.** `cohort-regression.html` runs the 5 canonical
   SubjectA nights through the same harness and diffs vs committed ground truth (26/26 green,
   calibration R² 0.929) — the harness's own end-to-end regression check, separate from the
   unit/contract suite.
