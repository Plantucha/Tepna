<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
Wire Descartes' COVERAGE condition, add a no-op-splice guard, and retract the outlier claim. All three
from a parallel coder's review.

THE COVERAGE LEG WAS MISSING, AND IT WAS MOST OF THE SIGNAL. Descartes' rule has two conditions:
pseudo-tested iff COVERED **and** every applicable mutant survives. A function no test calls has all
mutants survive trivially — that is not-covered, a different and cheaper finding. Measured on hrvdex:
of 18 functions reported pseudo-tested, SIXTEEN had zero executions. Honest rate 2/37 = 5.4%, not
48.6%.

  hrvdex 18 -> 2    pulsedex 20 -> 2    glucodex 8 -> 4    cpapdex 6 -> 5    motiondex 3 -> 1

Every file now sits at or below the published 9-14% band. The "42-49% is a true property of those
files" claim is RETRACTED: it was uncovered functions in the wrong bucket.

AND IT DISSOLVES AN APPARENT CORROBORATION. c8 reporting hrvdex and pulsedex as the least-executed
files looked like a second instrument confirming pseudo-testedness. It was the SAME FACT — "these
functions are not executed" — read twice. Counting it as independent support was wrong.

Coverage is per-function from c8, scoped to the SAME group filter as the mutants: a function covered
only by another group is not reachable by this run's mutants either. Absent coverage FAILS CLOSED
rather than classifying without it.

THE NO-OP SPLICE GUARD. A function whose body already IS the replacement — `function f() { return
null; }` under the `return null` operator — produced byte-identical source, the suite passed because
nothing was mutated, and that vacuous pass scored as SURVIVED and pushed the function toward
pseudo-tested. Now skipped. Silent, and in the same direction as the brace bug.

THE BRACE FIX IS NOW EVIDENCED. "The numbers did not move" was not evidence for it — unchanged
numbers are equally consistent with the fix never engaging. The reviewer's canary settles it: count
functions whose computed range changed. On the dsp files, ZERO — the comparison was vacuous. On the
app files it fires: hrvdex-app +2 functions found only via the mask, ppgdex-app 3 ranges changed,
glucodex-app 2, ecgdex-app 3.

CORRECTION TO A PUBLISHED CLAIM: glucodex has NO fmtClock/fmtDate/fmtDateTime. The tool never listed
them; that node was added by hand when summarising. hrvdex's copies are NOT-COVERED (zero executions
even under the wider --group=hrvdex), so the Clock Contract finding was wrong in character too — not
"executed but unasserted" but "never executed".
