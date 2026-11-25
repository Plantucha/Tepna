---
bump: patch
type: fixed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

Load clock.js in cohort-runner.html, so the Integrator fuses instead of throwing at every patient.
The page realm had no `DexClock`, so `integrator-dsp.js` threw at module evaluation, and all the
patients recorded a dead fusion. The worker realms already loaded the file.

The robustness benchmark then ran again on the current generator, with a `cohort-gen/1.9` control.
`papers/robustness-benchmark.html` holds the measurement, and
`analysis/published-numbers/robustness-benchmark-2026-11-25.json` holds the numbers. The paper also
stops calling an uncommitted file committed.

Two new tools: `tools/cohort-runner-headless.mjs` captures one arm, and
`tools/robustness-rerun-ab.mjs` judges two arms and emits a verdict.
