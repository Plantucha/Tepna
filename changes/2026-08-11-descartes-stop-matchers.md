<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
Port Descartes' stop-matchers, and fix the empty outcome set they exposed.

AN EMPTY OUTCOME SET WAS BEING SCORED AS TESTED. `classifyExtreme([])` returns `not-applicable`, and
the worker's if/else-if/else filed that under the final `else` — `noticed++`. So a function for which
every operator was skipped counted as TESTED, on the strength of an experiment that never ran. It now
produces NO REPORT ENTRY and no denominator entry, which is what Descartes does.

The byte-identical splice guard shipped last commit is Descartes' `constant` stop-matcher rediscovered
by crashing into it. The rest of that list is the same argument, so it is ported rather than waited
for: `constant`, `return_this`, `return_param`, `setter`, `getter`, `empty`. Scope differs from the
guard deliberately — the guard SKIPS ONE OPERATOR, Descartes EXCLUDES THE FUNCTION, and they come
apart exactly when the skipped operator is the only applicable one.

Conservative by construction: anything unrecognised is NOT trivial, so it over-runs mutants rather
than dropping a finding. Verified non-vacuous on real source — it fires on 5 functions across the
2419 in the root `*.js` (`riskGauge`, `_ageSDNN`, `mkChart`, `barChart`, `_synthPrefKey`) and declines
on the other 2414. Zero in all eight `*-dsp.js`, which is why the DSP numbers do not move.

Emptiness is judged on the mask; everything else on the RAW text. The mask blanks string literals
outright — `return "x";` masks to `return    ;`, indistinguishable from a bare `return;` — which made
the string case decline. Safe only because every pattern is fully anchored.

The reported percentage now has an honest denominator: the CLASSIFIED population, not every function
in the file. An uncovered or excluded function was never put to the question, so counting it below
the line states a rate over experiments that did not run.

The canary is drawn from a genuinely-noticed function. `bodies.find(b => !pseudo.includes(b))` would
elect an uncovered or excluded one — whose mutant was never run — and a canary that cannot fail
guards nothing.

`notCovered` was missing from `--json` (present only in the text summary), so a machine reader saw
the bucket as empty. hrvdex: 37 functions = 2 pseudo + 20 not-covered + 15 tested, partition verified.
