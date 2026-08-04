<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: VERITY-SIGMA-CORNER-BRIEF.md
---

Backlog sweep over the oldest undated open briefs — two closed by reconciliation, no code moved.

`VERITY-SIGMA-CORNER` stamped DONE: all seven §7 boxes verified against the shipped tool + paper
(`TRIOS[]`, per-window kernel, intersection builder, across-window bootstrap CI, negative-variance +
control-leg checks, derivation doc, paper Table 3 / Figure 2 / §6), achieved 26 nights / 291,561
simultaneous s against a §7 ask of 5–10 windows. Its §0 headline σ and its "commit `*-derived-*-HR.txt`"
step are both recorded as superseded.

`INTEGRATOR-EXPORT-FIX` stamped DONE: P1 verified at `integrator-dsp.js:6060`–`:6070` (`schema.version`
now `1.3`), P2 at `:5936`. Of its secondary list, items 1, 2 and 5 are closed or obsolete; 3 and 4 stay
open owner-decisions and are left with `AUDIT-FOLLOWUPS` §4 rather than spawning a duplicate brief.

`AUDIT-FOLLOWUPS` §4 updated in place: items 1 and 2 closed, item 3's `buildHash` costing flagged stale,
item 4's "not test-backed" premise corrected — `tests/dex-tests.js:6466`–`:6504` now gates every fusion
finding type against the grade map.

Two recorded gaps, deliberately not papered over: `GENERATOR-FOLLOWUPS-II` §3 cites a decision comment on
`ecgdex-app.js genSynthetic` that **never existed** (`git log -S` empty across all branches), so that
decision lives only in brief prose; and §3 is genuinely unbuilt (`ECGDex.src.html` includes neither
`synth-gen.js` nor `dex-patient-gen.js`). Left PROPOSED as an owner-decision.
