---
bump: minor
type: added
brief: GENERATOR-FOLLOWUPS-II-BRIEF.md
---

**ECGDex joins the shared synthetic-patient axis — GENERATOR-FOLLOWUPS-II §3.**

The engine emits RR; the RR→PQRST µV renderer lived in `cohort-full.js`, a FULL-lane-worker file
ECGDex cannot load. That, not a design decision, is why this node stayed single-recording while every
other node moved onto `DexPatientGen`.

- **§3.1** — `pqrst` + `renderECGInt16` lifted into `synth-gen.js` (`SYNTH.renderECGInt16(tl, win)`).
  Byte-identical: same constants, same phase anchoring, same RNG. `cohort-full.js` delegates and
  keeps its 3-arg signature, so `qrs-yield` / `qrs-equiv` and the FULL-lane fidelity gate are unmoved.
- **§3.2** — `synth-gen.js` + `dex-patient-gen.js` wired into `ECGDex.src.html`; a second `.synth-line`
  offers the shared profile + **1–3 nights** (capped: raw µV at 130 Hz is ~3.4 M samples/night against
  an O2Ring night's ~1 k rows). Each night goes through the REAL `runPipeline`, keyed by floating
  `t0Ms`, so nights accumulate into the existing multi-recording switcher with no new plumbing. The
  existing scenario generator stays as the single-recording dev path.
- **§3.3** — coherence gated: an ECG night and an OxyDex night for the same profile+days inherit the
  same timeline `t0Ms` exactly, which is the Integrator's fusion key.

The parity gate is a **known-answer digest** recorded from the pre-lift renderer, not a comparison
against the delegate — the obvious version of that test is a tautology and was mutation-shown to miss
a 1 µV drift.
