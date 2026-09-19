---
bump: patch
type: fixed
brief: ECG-SATURATION-ABSENCE-2026-09-18-BRIEF.md
---

The ECG rail leg keyed on a global constant and fired on nothing. `computeSQI`'s flatline/rail check
tested `|int16| > 31000`; measured over 597 deduplicated files it fires on 0 of 112 real saturation
runs, because the H10 saturates at ~18,100-19,500 at a rail that differs PER FILE — 29 distinct
values across the 62 files that carry one. A global constant is the wrong SHAPE, not the wrong
number: any single value repeats the defect at a different magnitude.

Rewired to `nightqc.rail_value`'s rule, ported: the rail is the histogram spike nearest the edge, not
the edge. The leg now finds rail samples in 62 of 62 of those files, where the constant found none.

THE PORT WAS MEASURED BEFORE IT WAS WRITTEN, because those constants were tuned on u8 pleth and this
is int16 uV. A rail qualifies on 62 of 62; `railHi` equals the observed maximum on 58 and differs on
4, so the spike search does real work rather than degenerating to min/max; and the median gap between
occupied values is 3 against `GAP_MAX = 4`, which is the port's margin and is thin.

AN UNQUALIFIED RAIL IS `absent`, NEVER A FALLBACK TO THE EXTREME — a file whose rail cannot be
qualified is unmeasured for saturation, not clean.

A MAJORITY GUARD, MEASURED NOT CHOSEN. Without it the rule convicts a silent baseline: an idealised
beat train on an exact-zero floor makes 0 both the edge value and 93.4 % of the record, so every beat
window contains baseline samples and every beat trips `flatBad`. That reddened the existing
composite-SQI weight group — a gate on working behaviour, and therefore a true positive about the
rule. "The rail must not be the modal value" was tried first and is WRONG: it loses 19 of 62 real
files, because a heavily-saturated record legitimately has its rail as its mode. The populations
separate on SHARE — real global-mode share 0.78-11.53 %, synthetic baseline 93.4 % — and the cut sits
between them at a half. After the guard, real detection is unchanged at 62 of 62.

⚠️ WHAT THIS DOES NOT REACH. The leg is still PEAK-CONDITIONAL, examining only +-130 ms around a
DETECTED peak, and saturation is what suppresses detection: 55 runs examined, 57 not. Repairing the
constant does not repair the coverage hole, and this must not read as having closed that finding.

⚠️ AND NO COMMITTED FIXTURE CAN EXPRESS THIS. All three committed ECG inputs are rail-absent with
zero at-rail samples, so the green equivalence gate is silent BY CONSTRUCTION rather than evidence of
safety. An adversarial committed twin is the missing coverage and is not added here.
