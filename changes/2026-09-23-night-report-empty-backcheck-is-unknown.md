---
bump: patch
type: fixed
brief: none
---

`night_report.back_check` returns `unknown` when it examined nothing, instead of `("ok", 0, 0)`. An
empty `class_b` list is what a night produces when `class_b_quality` skipped every PPG file it could
not judge, so "0 spans, back-check ok" was a clean verdict over an unobserved night —
indistinguishable from one that was watched and went well, and contradicting render's own footer
("A missing input is never a 0"). Three places in the tree already stated the correct meaning; this
was the one that did not.

The exposure is the FALLBACK path only: `backcheck_verdict` already publishes a population and
refuses `eligible > 0, checked == 0`, and `back_check_from_verdict` is tried first. This path serves
nights written before those verdicts existed.

ABSENCE-SURVEY row `night_report.py:129` (aggregate-over-absence, high).
