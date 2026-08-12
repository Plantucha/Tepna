<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
43 of hrvdex `computeDerived`'s 149 survivors killed — the fleet's largest single cluster.

WHY 149 SURVIVED, which is structural rather than a coverage gap. The existing group pins all 52
derived columns on ONE fully-populated row. Every derivation is written `a && b ? f(a,b) : NaN` or
`x > 0 ? g(x) : NaN`, so when every seed is present and non-zero, `a && b` and `a || b` take the SAME
branch and `x > 0` and `x >= 0` are both true. A row on which everything works cannot separate them.

The new group zeroes each seed IN TURN. Zero does two jobs: falsy, so it flips the boolean guards,
and exactly on the boundary, so it flips the comparisons. What is pinned is the SET of columns that
fall to NaN — the observable behaviour of a guard, and what the source's own comment promises ("the
honest answer when age/sex/BP were never supplied", never a fabricated number).

MEASURED, 24 -> 43 -> 43, and the middle step is the one worth recording:

  · the first predicate recorded "not finite", which collapses NaN and ±Infinity. That made
    `x > 0` and `x >= 0` indistinguishable on a zeroed seed — the original returns NaN, the mutant
    computes `Math.log(0)` and returns -Infinity, and both are !isFinite. 24 of 149. Distinguishing
    them took it to 43.
  · a VALUE digest per zeroed row (count + rounded sum of the finite columns) added 21 assertions
    and killed ZERO more. The hypothesis — that mutants keep the NaN-set while changing numbers —
    measured FALSE. The assertions are kept for regression value and this line says plainly what
    they do not do.

THE CONTROL FAILED TWICE AND CORRECTED THE FIXTURE BOTH TIMES, which is the only reason the numbers
mean anything. A one-row fixture left `d_vo2_roll7` NaN; adding rows did not fix it because the
window is DATE-KEYED and the rows had no `_tMs` at all, so nothing entered it. Four rows on four
distinct UTC days fixed it and incidentally drive `utcDayKey`, which the equivalence probe had to
withhold verdicts on for want of a control. `d_vo2_delta` is named as the one permitted exception —
it needs a profile VO2 ground truth this headless fixture deliberately does not supply.

THE REMAINING 106 ARE A DIFFERENT SHAPE, and the next lever is known rather than guessed: multi-
operand guards (`r._amo50 && r._mode && r._mxdmn`), where zeroing one field flips one operand and the
others short-circuit the same way; and environment guards (`typeof DexUnits !== 'undefined' &&
DexUnits && ...`) which cannot move while quantity.js is loaded. Those need combination rows and a
DexUnits-absent realm.
