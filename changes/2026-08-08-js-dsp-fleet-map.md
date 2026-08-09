<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: []
brief: JS-DSP-MUTATION-FLEET-2026-08-08-BRIEF.md
---
`clock.js` has had four full mutation sweeps and sits at **84 %**. It is 414 lines. The nine `*-dsp.js` files are **~31,000 lines of shipped signal processing** and had **never been measured at all**. The Python side has had a ranked fleet map since 2026-08-04, and it is what decides which module gets worked next; the JS side had nothing equivalent. This is that map.

It is possible only because `--bail` (#1003) made it affordable — exhaustively the fleet is ~11,500 mutants ≈ 150 h; this sample cost under an hour.

**All nine sampled at 60 mutants each: 28 % – 68 %.** Not one reaches 70 %. Six sit between 28 % and 55 %. On `hrvdex-dsp.js`, roughly **seven of every ten sampled edits to shipped HRV code went unnoticed by its own tests**.

The ranking tracks in-tag test surface almost exactly — the top three by kill rate are the three broadest tags (`integrator` 73 groups/68 %, `ecgdex` 48/62 %, `oxydex` 39/58 %), the bottom is `hrvdex` (15/28 %). The one conspicuous exception is **`ppgdex-dsp.js`: 49 groups — more than `ecgdex` — and half the kill rate.** That also disposes of the obvious objection to a low scoped number, since "the tag is too narrow" cannot explain it.

Tag cost spans **300×** (1 s → 310 s per mutant), which cleanly splits the fleet: five files are exhaustively sweepable today, while `ecgdex` (~65 CPU-hours scoped), `integrator` (~150) and `oxydex` never will be — the argument for covering those with `--diff` per PR rather than an audit nobody runs.

Two caveats are load-bearing rather than footnotes, and are stated as such: every rate is a **scoped lower bound** whose penalty is *unmeasured for a DSP* (the 1-in-127 figure came from `clock.js`, whose 47-group tag is atypically broad), and **every run was unguarded** — no canary existed, so each is a hypothesis for a second pass. That framing is not caution for its own sake: every defect found today was in the *checking machinery*, not the code under test, and each survived inspection before dying to a comparison.

Docs only — no shipped source, no `manifestHash` movement, no fixture re-recorded.
