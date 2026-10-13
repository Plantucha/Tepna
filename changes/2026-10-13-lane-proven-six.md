---
bump: patch
type: fixed
brief: none
---

**Six RESIDUE defects close, each with a test that fails on main and passes with the fix.**

- `pat-feasibility-worker.js`: `coupledPAT` no longer publishes `inPhysPct`. The coupling loop admits only lags inside `[PLO, PHI]`, so the share read 1 on every night.
- `capture-host/capture.py`: a probe-fault frame with a valid SpO₂ now reads wear as unknown (`None`), not worn.
- `capture-host/timeline.py`: the midnight pooling gate now uses the same gap rule as the session split it guards.
- `capture-host/mutation_diff.py`: the survivor render no longer cuts a mutant's line at its annotation.
- `capture-host/tools/mutate.py`: a killed mutation generation is no longer reused as a complete one.
- `tools/wt-done.mjs`: the tool names its own repository with `git -C`, so a run from outside a checkout refuses with a sentence.
