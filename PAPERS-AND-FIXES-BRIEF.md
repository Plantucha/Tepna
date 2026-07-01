# Papers & Fixes — Continuation Brief

**Status:** CHECKPOINT (living backlog) · **Created:** 2026-06 (undated) · last-verified 2026-06-23
<!-- Not a single-shot brief — a continuation checkpoint over the open papers/fixes backlog (live ledger:
     papers/papers.html). Some items shipped (PPG 2:1-halving fix; render-coverage + hang gates), others
     remain open (PpgDex residual over-detection, Integrator bundled-samples 404, OxyDex cleanArtifactHR
     hardening — batched for a final re-bundle pass). Leave as CHECKPOINT; do not stamp DONE while the
     backlog is open. -->

Checkpoint for resuming the working-preprint backlog and the pilot-finding fixes in fresh
(token-light) threads. **Read `CLAUDE.md` first** (conventions, Clock Contract, the gate
contracts). The live backlog + open-findings ledger is **`papers/papers.html`** — this brief
captures only what that page doesn't: gate state, the cheap-vs-expensive change split, and the
recommended order. Start each fresh thread from this brief + `CLAUDE.md`, scoped to ONE step.

---

## Governing principle — batch the expensive changes
Two classes of change, gated differently:

- **Cheap** — `synth-gen.js` / `cohort-*.js` / analysis tools / `tests/*` / new papers. Gated
  ONLY by the regression suite (`Dex-Test-Suite.html` → all green; `node tests/run-tests.mjs`
  for shared groups). No bundle changes ⇒ **no provenance impact**.
- **Expensive** — any shipped `*-dsp.js` / `*-app.js` / `*.src.html`. Requires re-bundling
  `Foo.html` (the inliner) → run `verify-provenance.html` clean afterward. Note: only a `.src.html`
  change actually **shifts `buildHash`** (the hash covers the `__bundler/template` skeleton, not the
  `*.js`) and so flips that app's committed `uploads/*.json` fixture to *stale/red* → regenerate it; a
  JS/CSS-only re-bundle leaves the hash unchanged and the fixtures reproducible. Either way, regenerate
  any fixture whose underlying *code* changed (the hash won't catch JS drift). **Do all expensive fixes
  in ONE re-bundle pass at the end**, never piecemeal.

---

## Gate state (built this cycle — all green: 563 / 39 groups)
- **FULL-lane waveform fidelity** — shared group 24 in `tests/dex-tests.js` (runs in Node CI +
  browser). Renders `renderPPG` / `renderECGInt16`, runs real `PPGDSP`/`ECGDSP`, asserts beat
  recovery (PPG 0.80–1.30, ECG 0.90–1.10). `SYNTH`/`CohortGen`/`CohortFull` are wired into env
  in BOTH runners. This is the gate that the PPG 2:1-halving bug slipped past before.
- **App-bundle render-coverage** — browser-only groups in `Dex-Test-Suite.html` for all 8 apps.
  OxyDex/PulseDex/HRVDex/GlucoDex/PpgDex inject synthetic data (`SYNTH.*`) through the real
  input path; Integrator is structural (boot + UI controls); ECGDex/CPAPDex bespoke (pre-existing).
- **OxyDex heavy-dropout hang guard** — `tests/oxy-hang.worker.js` + a bounded browser-only
  group. Runs the real `parseCSV→processNight` over a heavy-dropout patient pool in a **worker**,
  watchdog-timed (12 s) so a true hang can't freeze the suite.

**FULL lane works end-to-end** (`cohort-runner.html` lane=FULL → `cohort-worker.js`
`runECGfull`/`runPPGfull` on real DSP). ECG arm is production-quality; PPG arm fixed (see below).

---

## Backlog candidate papers (`papers/papers.html` → pipeline)
1. **QRS-detector yield under apnea/artifact** (FULL lane). **BUILDABLE NOW, no fix dependency** —
   ECGDex beat-recovery 1.00, SQI ~0.95. Thesis: PPG/ECG beat yield vs SQI + apnea state, and the
   downstream HRV bias. The genuine apnea-perfusion yield signal is already isolated (low-amplitude
   apnea beats missed while SQI stays high). Build a paper-specific analysis tool on the FULL lane
   (pattern: like `nights-icc-analysis.*` / `cgm-hrv-coupling-analysis.*` — iframe/worker realms,
   real DSP, deterministic figure, honest synthetic-ground-truth framing).
2. **Three-way rMSSD equivalence** (PulseDex / PpgDex / ECGDex, Bland–Altman triplet). **Blocked on
   step "PpgDex over-detection" below** — until trimmed, PPG rMSSD carries residual false-positive
   inflation, not just PAT jitter.
3. **Reproducible robustness benchmark** — write up the `cohort-runner.html` failure ledger +
   severity×arc coverage matrix as a "where do consumer sleep detectors break" suite. Low fix-
   dependency; reuses the new render-coverage + hang gates as part of the story.

---

## Pilot findings → fixes (status + cost)
- **PpgDex over-detection (~3–10% on synthetic vs ~1% on real)** — CHEAP (in `renderPPG`,
  `synth-gen.js`; gated by test suite only). The 2:1 *halving* is already fixed (dropout step →
  baseline flatline; recovery 0.60→1.05). Residual: the detector now finds slightly too many beats
  on synthetic (dicrotic / low-perfusion false positives), inflating PPG rMSSD. **Do before the
  equivalence paper.** Tune the dicrotic/diastolic shape or per-sample noise so synthetic beat
  recovery sits ~1.00–1.05; re-run the FULL-lane fidelity gate + `cohort-runner` FULL lane.
- **Integrator "Load bundled samples" → deleted fixtures** — EXPENSIVE (in `integrator-app.js`
  `bindSamples()`; the two hardcoded `uploads/…` paths 404). Repoint at existing exports (or commit
  a fresh demo pair) → re-bundle `Integrator.html` + provenance. **Batch into the final re-bundle pass.**
- **OxyDex `cleanArtifactHR` hardening** — EXPENSIVE (in `oxydex-dsp.js`). The hang is currently
  *unreachable* (parseCSV strips `--`; constants make `j` always advance), so a 1-line progress
  guard (`i = j>i ? j : i+1`) was prepared and **deferred**. **Batch into the final re-bundle pass.**
- **GlucoDex `nocturnalHypo` under-detects on single-night slices** — caveat, not a code fix; needs
  a full-day-context run to characterize the event-level CGM↔HRV hypo arm (exploratory).

---

## Recommended order (one fresh thread each)
1. **QRS-yield paper** (candidate #1) — no dependency, pure value.
2. **Fix PpgDex over-detection** in `renderPPG` (cheap; re-run FULL-lane gate).
3. **Three-way rMSSD equivalence paper** (candidate #2) — now clean.
4. **Robustness benchmark paper** (candidate #3).
5. **Batched re-bundle pass (LAST):** Integrator samples fix + OxyDex hardening → re-bundle both →
   regenerate provenance fixtures → `verify-provenance.html` clean.

Gate discipline every thread: after any `synth/dsp/cohort/test` change run `Dex-Test-Suite.html`
(must be all green) before `done`; after any re-bundle also run `verify-provenance.html`.
